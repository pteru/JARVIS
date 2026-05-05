#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { loadConfig, dataDir, ROOT_DIR } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { SheetClient } from './lib/sheet-client.mjs';
import { TABS } from './lib/sheet-schema.mjs';
import { evaluateTemporal, prazoEfetivoCarta, prazoLiberacaoEfetivo } from './lib/expiry-rules.mjs';
import { Notifier } from './lib/notifier.mjs';
import { AlertasLog } from './lib/alertas-log.mjs';
import { buildReport, emptyDayMessage } from './lib/report-builder.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('check-expiries');
const args = process.argv.slice(2);
const argDate = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);
const MOCK_TODAY = args.find(a => a.startsWith('--mock-today='))?.split('=')[1];
const DRY_RUN = process.env.DRY_RUN === '1';

function hojeIso() {
  return MOCK_TODAY ?? new Date().toISOString().slice(0, 10);
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.sheet_id) throw new Error('config.sheet_id missing — run bootstrap first');
  const clients = buildClients(cfg);
  const client = new SheetClient(clients.sheets, cfg.sheet_id);
  const data = await client.readAll();
  const hoje = hojeIso();
  log.info('checking', { hoje });

  // Annotate with tab name for alert ids
  for (const tab of TABS) for (const r of data[tab.name] ?? []) r.__tabName = tab.name;

  const empresasById         = new Map((data.empresas ?? []).map(r => [r.id, r]));
  const colaboradoresById    = new Map((data.colaboradores ?? []).map(r => [r.id, r]));
  const plantasById          = new Map((data.plantas ?? []).map(r => [r.id, r]));
  const contratosById        = new Map((data.contratos ?? []).map(r => [r.id, r]));
  const cadastrosById        = new Map((data.cadastros_sg3 ?? []).map(r => [r.id, r]));
  const declaracoesByPair    = new Map((data.declaracoes_responsabilidade ?? []).map(r => [`${r.colaborador_id}-${r.planta_id}`, r]));
  const cartasByContrato     = mapByMany(data.cartas_subcontratacao ?? [], 'contrato_id');
  const cndsLumeByEmpresa    = mapByMany(data.docs_empresa ?? [], 'empresa_id');
  const docsColabByColab     = mapByMany(data.docs_colaborador ?? [], 'colaborador_id');
  const aprovacoesByCarta    = mapByMany(data.aprovacoes_email ?? [], 'carta_id');

  // Pre-compute prazo_efetivo for cartas, then write back
  const cartasCalc = computeCartasPrazoEfetivo(data, cndsLumeByEmpresa, contratosById);
  await writeBackPrazoEfetivo(client, data, cartasCalc);

  // 1. Temporal alerts
  const temporals = collectTemporal(data, cfg.lead_times, hoje);

  // 2. State alerts
  const estado = collectEstado(data, declaracoesByPair, hoje);

  // 3. Active liberations
  const ativas = computeAtivas({
    data, cadastrosById, contratosById, colaboradoresById, plantasById,
    cartasByContrato, cndsLumeByEmpresa, docsColabByColab, declaracoesByPair, aprovacoesByCarta, empresasById,
  });
  await writeBackPrazoLiberacao(client, data, ativas);

  // 4. Drift
  const drift = collectDrift(data);

  // 5. Health
  const saude = readSaude(argDate);

  // Dedupe and emit
  const logPath = resolve(ROOT_DIR, 'data/sg3-monitor/alertas-log.json');
  const dedupe = new AlertasLog(logPath);
  const allTemporal = [...temporals.prazos, ...temporals.vencidos];
  const fresh = allTemporal.filter(a => !dedupe.has(dedupe.keyFor({ linhaId: a.linhaId, diasRestantes: a.diasRestantes, dia: hoje })));

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${cfg.sheet_id}/edit`;
  const isEmpty = fresh.length + estado.length + drift.length + ativas.length === 0;
  const report = isEmpty ? emptyDayMessage(hoje) : buildReport({
    date: hoje,
    ativas,
    prazos: fresh.filter(a => a.diasRestantes >= 0),
    vencidos: fresh.filter(a => a.diasRestantes < 0),
    estado,
    drift,
    saude,
    sheetUrl,
  });

  // Persist last report locally
  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'last-report.md'), report);

  if (DRY_RUN) {
    log.info('DRY_RUN — not posting');
    console.log(report);
    return;
  }

  const notifier = new Notifier({ chat: clients.chat, config: cfg });
  const result = await notifier.postPrimary(report);
  log.info('posted', result);

  for (const a of fresh) {
    dedupe.record(dedupe.keyFor({ linhaId: a.linhaId, diasRestantes: a.diasRestantes, dia: hoje }), {
      messageId: result.messageId, channel: result.channel,
    });
  }
  dedupe.save();

  // Escalation
  const escalators = temporals.vencidos.filter(v => /alocacao/.test(v.linhaId)).slice(0, 5);
  if (escalators.length > 0 && cfg.escalation) {
    await notifier.postEscalation(escalators.map(e => `❌ ${e.titulo} — ${e.detalhe}`).join('\n'));
  }
}

function mapByMany(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function collectTemporal(data, leadTimes, hoje) {
  const out = { prazos: [], vencidos: [] };
  const push = ({ prazos, vencidos }) => { out.prazos.push(...prazos); out.vencidos.push(...vencidos); };

  push(byTab(data.docs_colaborador ?? [], 'docs_colaborador',
    (r) => r.tipo, leadTimes, hoje,
    r => `${(r.tipo || '').toUpperCase()} de ${r.colaborador_id}`,
    r => `Vence: ${r.data_vencimento}`));

  push(byTab(data.docs_empresa ?? [], 'docs_empresa',
    (r) => r.tipo, leadTimes, hoje,
    r => `${(r.tipo || '').toUpperCase()} ${r.empresa_id}`,
    r => `Vence: ${r.data_vencimento}`));

  push(byTab(data.cartas_subcontratacao ?? [], 'cartas_subcontratacao',
    () => 'carta_subcontratacao', leadTimes, hoje,
    r => `Carta de subcontratação ${r.id}`,
    r => `Prazo efetivo: ${r.prazo_efetivo || r.data_vencimento_propria}`));

  push(byTab(data.aprovacoes_email ?? [], 'aprovacoes_email',
    (r) => r.tipo === 'juridico_gm' ? 'aprovacao_juridico' : 'default', leadTimes, hoje,
    r => `Aprovação ${r.tipo} (email ${r.assunto})`,
    r => `Prazo: ${r.prazo_definido}`));

  push(byTab(data.cadastros_sg3 ?? [], 'cadastros_sg3',
    () => 'cadastro_sg3', leadTimes, hoje,
    r => `Cadastro SG3 contrato ${r.contrato_id} planta ${r.planta_id}`,
    r => `Vence: ${r.data_vencimento}`));

  push(byTab(data.alocacoes ?? [], 'alocacoes',
    () => 'alocacao', leadTimes, hoje,
    r => `Alocação ${r.colaborador_id} × ${r.cadastro_sg3_id}`,
    r => `Vence: ${r.data_vencimento_propria}`));

  return out;
}

function byTab(rows, tabName, tipoFn, leadTimes, hoje, titleFn, detailFn) {
  const out = { prazos: [], vencidos: [] };
  for (const row of rows) {
    if (row.snooze_until && row.snooze_until > hoje) continue;
    const venc = row.data_vencimento ?? row.prazo_efetivo ?? row.data_vencimento_propria ?? row.prazo_definido;
    if (!venc) continue;
    const r = evaluateTemporal({ tipo: tipoFn(row), dataVencimento: venc, hoje, leadTimes });
    if (!r) continue;
    const item = {
      diasRestantes: r.diasRestantes,
      titulo: titleFn(row),
      detalhe: detailFn(row),
      linhaId: `${tabName}:${row.id}`,
    };
    (r.severity === 'PRAZO' ? out.prazos : out.vencidos).push(item);
  }
  return out;
}

function collectEstado(data, declaracoesByPair, hoje) {
  const out = [];
  const cadastrosById = new Map((data.cadastros_sg3 ?? []).map(r => [r.id, r]));

  for (const a of (data.alocacoes ?? [])) {
    const cad = cadastrosById.get(a.cadastro_sg3_id);
    if (a.status_sg3 === 'aprovada' && a.pendencias_sg3) {
      out.push({
        titulo: `Alocação ${a.colaborador_id} × ${a.cadastro_sg3_id} aprovada com pendências`,
        detalhe: `Pendências: ${a.pendencias_sg3}`,
      });
    }
    if (a.status_sg3 === 'liberada' && !a.data_email_patrimonial) {
      out.push({
        titulo: `Alocação ${a.colaborador_id} × ${a.cadastro_sg3_id} liberada sem email à patrimonial`,
        detalhe: `Planta ${cad?.planta_id ?? '?'} — enviar email à patrimonial`,
      });
    }
    if (a.decl_resp_uploaded_sg3 === 'false' && a.decl_resp_id) {
      const decl = (data.declaracoes_responsabilidade ?? []).find(d => d.id === a.decl_resp_id);
      if (decl?.assinaturas === 'completa') {
        out.push({
          titulo: `Declaração de responsabilidade pronta mas não enviada ao SG3`,
          detalhe: `Alocação ${a.id} — fazer upload da decl_resp_id ${a.decl_resp_id}`,
        });
      }
    }
  }

  for (const d of (data.declaracoes_responsabilidade ?? [])) {
    if (d.assinaturas !== 'completa') {
      const dependentes = (data.alocacoes ?? []).filter(a => a.decl_resp_id === d.id && (a.status_sg3 === 'aprovada' || a.status_sg3 === 'docs_pendentes'));
      if (dependentes.length > 0) {
        out.push({
          titulo: `Declaração ${d.id} ainda em ${d.assinaturas}`,
          detalhe: `${dependentes.length} alocação(ões) ativas dependem dela`,
        });
      }
    }
  }

  return out;
}

function computeCartasPrazoEfetivo(data, cndsLumeByEmpresa, contratosById) {
  const out = new Map();
  for (const c of (data.cartas_subcontratacao ?? [])) {
    const cnds = (cndsLumeByEmpresa.get(c.subcontratada_id) ?? [])
      .filter(d => d.tipo.startsWith('cnd_'))
      .map(d => ({ dataVencimento: d.data_vencimento }));
    const contrato = contratosById.get(c.contrato_id);
    const r = prazoEfetivoCarta({
      cartaVencimento: c.data_vencimento_propria,
      contratoFim: contrato?.data_fim,
      cndsLume: cnds,
    });
    if (r) out.set(c.id, r);
  }
  return out;
}

async function writeBackPrazoEfetivo(client, data, cartasCalc) {
  const tabName = 'cartas_subcontratacao';
  const cols = TABS.find(t => t.name === tabName).columns.map(c => c.name);
  const rows = data[tabName] ?? [];
  for (let i = 0; i < rows.length; i++) {
    const calc = cartasCalc.get(rows[i].id);
    if (!calc) continue;
    if (rows[i].prazo_efetivo === calc.data) continue;
    rows[i] = { ...rows[i], prazo_efetivo: calc.data, _atualizado_em: new Date().toISOString() };
    await client.overwriteRow(tabName, i, cols, rows[i]);
  }
}

function computeAtivas(ctx) {
  const out = [];
  const cadastrosById = ctx.cadastrosById;
  const cartasByContrato = ctx.cartasByContrato;
  const aprovacoesByCarta = ctx.aprovacoesByCarta;

  for (const a of (ctx.data.alocacoes ?? [])) {
    if (a.status_sg3 !== 'liberada') continue;

    const cad = cadastrosById.get(a.cadastro_sg3_id);
    const contrato = ctx.contratosById.get(cad?.contrato_id);
    const colaborador = ctx.colaboradoresById.get(a.colaborador_id);
    const planta = ctx.plantasById.get(cad?.planta_id);
    const decl = ctx.declaracoesByPair.get(`${a.colaborador_id}-${cad?.planta_id}`);
    const carta = cartasByContrato.get(cad?.contrato_id)?.[0];
    const aprovacaoJur = carta ? (aprovacoesByCarta.get(carta.id) ?? []).find(e => e.tipo === 'juridico_gm') : null;
    const docsColaborador = (ctx.docsColabByColab.get(a.colaborador_id) ?? []).map(d => ({ ...d, colaboradorNome: colaborador?.nome_completo }));
    const docsEmpresa = colaborador?.empresa_id !== 'strokmatic'
      ? (ctx.cndsLumeByEmpresa.get(colaborador?.empresa_id) ?? [])
      : [];
    const docsEmpresaNamed = docsEmpresa.map(d => ({ ...d, empresaNome: ctx.empresasById.get(d.empresa_id)?.razao_social }));

    const r = prazoLiberacaoEfetivo({
      alocacao: a,
      cadastroSg3: cad,
      contrato,
      docsColaborador,
      docsEmpresaSubcontratada: docsEmpresaNamed,
      cartaSubcontratacao: carta,
      aprovacaoJuridico: aprovacaoJur,
      declaracaoResponsabilidade: decl,
    });

    if (r.bloqueada) continue;
    out.push({
      alocacaoId: a.id,
      colaboradorNome: colaborador?.nome_completo ?? a.colaborador_id,
      plantaNome: planta?.nome ?? cad?.planta_id,
      prazoEfetivo: r.data ?? '?',
      bottleneck: r.bottleneck,
    });
  }

  return out.sort((x, y) => (x.prazoEfetivo ?? '').localeCompare(y.prazoEfetivo ?? ''));
}

async function writeBackPrazoLiberacao(client, data, ativas) {
  const tabName = 'alocacoes';
  const cols = TABS.find(t => t.name === tabName).columns.map(c => c.name);
  const rows = data[tabName] ?? [];
  const byId = new Map(ativas.map(a => [a.alocacaoId, a]));
  for (let i = 0; i < rows.length; i++) {
    const calc = byId.get(rows[i].id);
    if (!calc) continue;
    if (rows[i].prazo_liberacao_efetivo === calc.prazoEfetivo && rows[i].bottleneck_doc === calc.bottleneck) continue;
    rows[i] = { ...rows[i], prazo_liberacao_efetivo: calc.prazoEfetivo, bottleneck_doc: calc.bottleneck, _atualizado_em: new Date().toISOString() };
    await client.overwriteRow(tabName, i, cols, rows[i]);
  }
}

function collectDrift(data) {
  const out = [];
  const semMap = (data.contratos_drive ?? []).filter(r => !r.contrato_id);
  if (semMap.length > 0) out.push({ titulo: `${semMap.length} contrato(s) no Drive sem mapeamento`, detalhe: semMap.map(r => `"${r.file_name}"`).join(', ') });

  const contratoIds = new Set((data.contratos ?? []).map(r => r.id));
  const cadastrosByContrato = new Set((data.cadastros_sg3 ?? []).map(r => r.contrato_id));
  const semCadastro = [...contratoIds].filter(id => !cadastrosByContrato.has(id));
  if (semCadastro.length > 0) out.push({ titulo: `${semCadastro.length} contrato(s) sem cadastro_sg3`, detalhe: semCadastro.join(', ') });

  const driveContratoIds = new Set((data.contratos_drive ?? []).map(r => r.contrato_id).filter(Boolean));
  const cadastroSemDrive = (data.cadastros_sg3 ?? []).filter(r => !driveContratoIds.has(r.contrato_id));
  if (cadastroSemDrive.length > 0) out.push({ titulo: `${cadastroSemDrive.length} cadastro(s) SG3 sem PDF no Drive`, detalhe: cadastroSemDrive.map(r => r.contrato_id).join(', ') });

  return out;
}

function readSaude(argDate) {
  const tryRead = (kind) => {
    const p = resolve(ROOT_DIR, 'data/sg3-monitor', argDate, `${kind}-snapshot.json`);
    if (!existsSync(p)) return { ok: false, detalhe: 'snapshot ausente' };
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    return j.status === 'ok' ? { ok: true, detalhe: 'ok' } : { ok: false, detalhe: j.status ?? 'falha' };
  };
  return {
    'SG3 collect': tryRead('sg3'),
    'Drive collect': tryRead('drive'),
    'Email collect': tryRead('email'),
  };
}

main().catch(err => {
  log.error('check-expiries failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
