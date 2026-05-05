#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, dataDir } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { SheetClient } from './lib/sheet-client.mjs';
import { TABS, validateRow, validateForeignKeys } from './lib/sheet-schema.mjs';
import { readSnapshotWithFallback } from './lib/snapshot-loader.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('sync-sheet');
const args = process.argv.slice(2);
const VALIDATE_ONLY = args.includes('--validate-only');
const argDate = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);

const NOW_ISO = new Date().toISOString();

function nowMeta(origin) { return { _origem: origin, _atualizado_em: NOW_ISO }; }

async function main() {
  const cfg = loadConfig();
  if (!cfg.sheet_id) throw new Error('config.sheet_id missing — run bootstrap first');
  const { sheets } = buildClients(cfg);
  const client = new SheetClient(sheets, cfg.sheet_id);

  // Load existing data first (validate FKs even in dry run)
  const existing = await client.readAll();
  log.info('loaded existing rows', Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, v.length])));

  if (VALIDATE_ONLY) {
    const fkErrors = validateForeignKeys(TABS, existing);
    const rowErrors = TABS.flatMap(tab => existing[tab.name]?.flatMap((row, i) => validateRow(tab, row).map(e => `[row ${i + 2}] ${e}`)) ?? []);
    const report = { fk_errors: fkErrors, row_errors: rowErrors };
    console.log(JSON.stringify(report, null, 2));
    if (fkErrors.length + rowErrors.length > 0) process.exitCode = 1;
    return;
  }

  // Load snapshots
  const sg3 = readSnapshotWithFallback(argDate, 'sg3');
  const drive = readSnapshotWithFallback(argDate, 'drive');
  const email = readSnapshotWithFallback(argDate, 'email');

  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });
  const report = {
    started_at: NOW_ISO, sources: {
      sg3:   { status: sg3.snapshot?.status ?? 'missing',   date_used: sg3.dateUsed },
      drive: { status: drive.snapshot?.status ?? 'missing', date_used: drive.dateUsed },
      email: { status: email.snapshot?.status ?? 'missing', date_used: email.dateUsed },
    }, inserted: {}, updated: {}, fk_errors: [], row_errors: [],
  };

  // Apply per-tab merges
  await applySg3(client, existing, sg3.snapshot, report);
  await applyDrive(client, existing, drive.snapshot, report);
  await applyEmail(client, existing, email.snapshot, report);

  // Re-read for final FK validation
  const after = await client.readAll();
  report.fk_errors = validateForeignKeys(TABS, after);

  const path = resolve(out, 'sync-report.json');
  writeFileSync(path, JSON.stringify(report, null, 2));
  log.info('sync done', { path, fk_errors: report.fk_errors.length });
}

async function applySg3(client, existing, snap, report) {
  if (!snap || snap.status !== 'ok') return;

  // FK targets (plantas, colaboradores, pessoas_gm) must be inserted before alocacoes/cadastros_sg3
  await insertOnlyByPrimary(client, 'plantas', snap.plantas ?? [], existing, report);
  await insertOnlyByPrimary(client, 'colaboradores', snap.colaboradores ?? [], existing, report);
  await insertOnlyByPrimary(client, 'pessoas_gm', snap.pessoas_gm ?? [], existing, report);

  await upsertByPrimary(client, 'cadastros_sg3', snap.cadastros_sg3 ?? [], existing, report,
    ['status_aprovacao', 'data_aprovacao', 'data_vencimento', 'sg3_url', 'responsavel_planta_id']);

  await upsertByPrimary(client, 'alocacoes', snap.alocacoes ?? [], existing, report,
    ['status_sg3', 'pendencias_sg3', 'data_inicio', 'data_vencimento_propria', 'decl_resp_id', 'colaborador_id', 'cadastro_sg3_id']);

  // New: docs sourced from the Documentos screen
  await insertOnlyByPrimary(client, 'docs_empresa', snap.docs_empresa ?? [], existing, report);
  await insertOnlyByPrimary(client, 'docs_colaborador', snap.docs_colaborador ?? [], existing, report);
  await insertOnlyByPrimary(client, 'declaracoes_responsabilidade', snap.declaracoes_responsabilidade ?? [], existing, report);
}

async function insertOnlyByPrimary(client, tabName, incoming, existing, report) {
  const tab = TABS.find(t => t.name === tabName);
  const cols = tab.columns.map(c => c.name);
  const seen = new Set((existing[tabName] ?? []).map(r => r.id).filter(Boolean));
  const newRows = (incoming ?? []).filter(r => r.id && !seen.has(r.id))
    .map(r => ({ ...r, _origem: r._origem ?? 'sg3', _atualizado_em: NOW_ISO }));
  if (newRows.length > 0) await client.writeRows(tabName, newRows, cols);
  if (newRows.length) report.inserted[tabName] = (report.inserted[tabName] ?? 0) + newRows.length;
}

async function applyDrive(client, existing, snap, report) {
  if (!snap || snap.status !== 'ok') return;

  // contratos_drive (upsert by id = file_id)
  const driveRows = (snap.contratos_drive ?? []).map(c => ({
    id: c.file_id,
    file_name: c.file_name,
    file_url: c.file_url,
    file_mime_type: c.file_mime_type,
    data_criacao: c.data_criacao,
    data_modificacao: c.data_modificacao,
    contrato_id: '', // preserved by upsert if already set
    status_drive: c.status_drive ?? '',
    em_sg3: '', // calculated downstream
    notas: '',
    ...nowMeta('drive'),
  }));
  await upsertByPrimary(client, 'contratos_drive', driveRows, existing, report,
    ['file_name', 'file_url', 'file_mime_type', 'data_criacao', 'data_modificacao', 'status_drive']);

  // contratos (upsert by id = contrato_id; only fill empty fields)
  const contratos = (snap.contratos_drive ?? [])
    .filter(c => c.contrato_id_inferido)
    .map(c => ({
      id: c.contrato_id_inferido,
      cliente: 'GM',
      objeto: c.extracao?.objeto ?? '',
      data_inicio: c.extracao?.dataInicio ?? '',
      data_fim: c.extracao?.dataFim ?? '',
      responsavel_contrato_id: '', // resolved later when pessoas_gm is built
      extracao_status: c.extracao?.extracaoStatus ?? 'manual',
      extracao_warnings: (c.extracao?.warnings ?? []).join('; '),
      notas: '',
      ...nowMeta('drive'),
    }));
  await upsertContratos(client, contratos, existing, report);

  // also: when classify-as VENC, prepare suggestions (but don't auto-write to docs_empresa/docs_colaborador since we can't classify ownership)
  // We log them in the report instead so humans can act.
  report.docs_com_venc_filename = (snap.docs_com_venc_filename ?? []).length;
}

async function applyEmail(client, existing, snap, report) {
  if (!snap || snap.status !== 'ok') return;
  const seen = new Set((existing.aprovacoes_email ?? []).map(r => r.gmail_message_id));
  const newRows = (snap.aprovacoes_email ?? []).filter(r => !seen.has(r.gmail_message_id)).map(r => ({
    id: 'email-' + r.gmail_message_id,
    tipo: r.tipo,
    carta_id: '',
    aprovador_id: '',
    data_email: r.data_email ?? '',
    remetente: r.remetente ?? '',
    assunto: r.assunto ?? '',
    corpo_resumido: r.corpo_resumido ?? '',
    prazo_definido: r.extracao?.prazo_definido ?? '',
    gmail_message_id: r.gmail_message_id,
    gmail_link: r.gmail_link ?? '',
    status: r.extracao?.status ?? '',
    _revisado_humano: r.confirmacao_humana ? 'false' : 'true',
    ...nowMeta('email'),
  }));
  if (newRows.length === 0) return;
  const cols = TABS.find(t => t.name === 'aprovacoes_email').columns.map(c => c.name);
  await client.writeRows('aprovacoes_email', newRows, cols);
  report.inserted.aprovacoes_email = newRows.length;
}

async function upsertByPrimary(client, tabName, incoming, existing, report, dynamicCols) {
  const tab = TABS.find(t => t.name === tabName);
  const cols = tab.columns.map(c => c.name);
  const byId = new Map((existing[tabName] ?? []).map((r, i) => [r.id, { row: r, index: i }]));

  let inserted = 0, updated = 0;
  const newRows = [];
  const overwrites = [];

  for (const row of incoming) {
    const r = { ...row, ...nowMeta(row._origem ?? 'sg3') };
    if (!byId.has(r.id)) {
      newRows.push(r);
      inserted++;
    } else {
      const { row: existingRow, index } = byId.get(r.id);
      const merged = { ...existingRow };
      for (const col of dynamicCols) merged[col] = r[col] ?? existingRow[col] ?? '';
      merged._atualizado_em = NOW_ISO;
      merged._origem = r._origem ?? merged._origem;
      overwrites.push({ name: tabName, rowIndex0Based: index, columns: cols, row: merged });
      updated++;
    }
  }

  if (overwrites.length > 0) await client.batchOverwriteRows(overwrites);
  if (newRows.length > 0) await client.writeRows(tabName, newRows, cols);
  if (inserted) report.inserted[tabName] = (report.inserted[tabName] ?? 0) + inserted;
  if (updated)  report.updated[tabName]  = (report.updated[tabName]  ?? 0) + updated;
}

async function upsertContratos(client, incoming, existing, report) {
  const tab = TABS.find(t => t.name === 'contratos');
  const cols = tab.columns.map(c => c.name);
  const byId = new Map((existing.contratos ?? []).map((r, i) => [r.id, { row: r, index: i }]));

  let inserted = 0, updated = 0;
  const newRows = [];
  const overwrites = [];

  for (const row of incoming) {
    if (!byId.has(row.id)) { newRows.push(row); inserted++; continue; }
    const { row: existingRow, index } = byId.get(row.id);
    const merged = { ...existingRow };
    for (const col of cols) {
      if (col === 'notas' || col === 'responsavel_contrato_id' || col.startsWith('_')) continue;
      if (!merged[col]) merged[col] = row[col] ?? '';
    }
    merged._atualizado_em = NOW_ISO;
    overwrites.push({ name: 'contratos', rowIndex0Based: index, columns: cols, row: merged });
    updated++;
  }

  if (overwrites.length > 0) await client.batchOverwriteRows(overwrites);
  if (newRows.length > 0) await client.writeRows('contratos', newRows, cols);
  if (inserted) report.inserted.contratos = (report.inserted.contratos ?? 0) + inserted;
  if (updated)  report.updated.contratos  = (report.updated.contratos  ?? 0) + updated;
}

async function insertOnlyByDedupe(client, tabName, incoming, existing, dedupeKey, report) {
  const tab = TABS.find(t => t.name === tabName);
  const cols = tab.columns.map(c => c.name);
  const seen = new Set((existing[tabName] ?? []).map(r => r[dedupeKey]).filter(Boolean));
  const newRows = incoming.filter(r => r[dedupeKey] && !seen.has(r[dedupeKey])).map(r => ({ ...r, ...nowMeta(r._origem ?? 'sg3') }));
  if (newRows.length > 0) await client.writeRows(tabName, newRows, cols);
  if (newRows.length) report.inserted[tabName] = (report.inserted[tabName] ?? 0) + newRows.length;
}

main().catch(err => {
  log.error('sync-sheet failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
