#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadConfig, ROOT_DIR } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { TABS } from './lib/sheet-schema.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('bootstrap');

async function ensureSheet(sheetsApi, drive, cfg) {
  if (cfg.sheet_id) {
    log.info('sheet_id already set in config; skipping creation');
    return cfg.sheet_id;
  }

  log.info('creating new spreadsheet');
  const r = await sheetsApi.spreadsheets.create({
    requestBody: {
      properties: { title: cfg.sheet_name },
      sheets: TABS.map(tab => ({
        properties: { title: tab.name },
        data: [{ rowData: [{ values: tab.columns.map(c => ({ userEnteredValue: { stringValue: c.name } })) }] }],
      })),
    },
  });
  const sheetId = r.data.spreadsheetId;
  log.info('spreadsheet created', { sheetId });

  // Persist sheet_id back to config.json
  const configPath = resolve(ROOT_DIR, 'config/sg3-monitor/config.json');
  const updated = { ...cfg, sheet_id: sheetId };
  writeFileSync(configPath, JSON.stringify(updated, null, 2));
  log.info('config.json updated with sheet_id');

  return sheetId;
}

async function shareSheet(driveApi, sheetId, emails) {
  for (const email of emails) {
    try {
      await driveApi.permissions.create({
        fileId: sheetId,
        requestBody: { role: 'writer', type: 'user', emailAddress: email },
        sendNotificationEmail: false,
      });
      log.info('shared with', { email });
    } catch (err) {
      log.warn('share failed', { email, err: err.message });
    }
  }
}

async function main() {
  const cfg = loadConfig();
  const { sheets, drive, gmail } = buildClients(cfg);

  // 1. Sheet
  const sheetId = await ensureSheet(sheets, drive, cfg);
  await shareSheet(drive, sheetId, [cfg.impersonate_subject]);
  log.info('sheet ready', { url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` });

  // 2. SG3 spike — note for the operator
  log.info('next: run the SG3 spike manually to populate config/sg3-monitor/clients/gm.json. ' +
           'Open Chrome DevTools on the SG3 portal, observe network calls, and either: ' +
           '(a) configure use_api=true with endpoints; or (b) configure Playwright with selectors. ' +
           'See clients/gm.json.example for the schema.');

  if (!existsSync(resolve(ROOT_DIR, 'config/sg3-monitor/clients/gm.json'))) {
    log.warn('gm.json not yet populated — extraction skipped. Re-run bootstrap after spike.');
    return;
  }

  // 3-5. Run the 3 collectors
  const today = new Date().toISOString().slice(0, 10);
  for (const script of ['collect-sg3.mjs', 'collect-drive-contratos.mjs', 'collect-emails.mjs']) {
    log.info(`running ${script}`);
    const r = spawnSync('node', [resolve(ROOT_DIR, 'scripts/sg3-monitor', script), today], { stdio: 'inherit' });
    if (r.status !== 0) log.warn(`${script} exited non-zero`);
  }

  // 6. Sync
  log.info('running sync-sheet.mjs');
  spawnSync('node', [resolve(ROOT_DIR, 'scripts/sg3-monitor/sync-sheet.mjs'), today], { stdio: 'inherit' });

  // 7. Gap report
  await writeGapReport(today, sheets, sheetId);
}

async function writeGapReport(today, sheetsApi, sheetId) {
  const out = resolve(ROOT_DIR, 'data/sg3-monitor/bootstrap');
  mkdirSync(out, { recursive: true });
  // Read all tabs and compute gaps
  const r = await sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: TABS.map(t => `${t.name}!A1:ZZ`),
  });

  const data = {};
  r.data.valueRanges.forEach((vr, i) => {
    const [header, ...rows] = vr.values ?? [[]];
    data[TABS[i].name] = rows.map(row => Object.fromEntries((header ?? []).map((h, j) => [h, row[j] ?? ''])));
  });

  const gaps = [];
  for (const c of (data.colaboradores ?? [])) {
    const asos = (data.docs_colaborador ?? []).filter(d => d.colaborador_id === c.id && d.tipo === 'aso');
    if (asos.length === 0) gaps.push(`- Colaborador ${c.id} sem ASO em docs_colaborador`);
  }
  for (const p of (data.plantas ?? [])) {
    if (!p.patrimonial_email) gaps.push(`- Planta ${p.id} sem patrimonial_email`);
  }
  for (const e of (data.empresas ?? [])) {
    if (e.tipo === 'subcontratada' || e.tipo === 'mei') {
      const cnds = (data.docs_empresa ?? []).filter(d => d.empresa_id === e.id && d.tipo.startsWith('cnd_'));
      if (cnds.length === 0) gaps.push(`- Empresa ${e.id} (${e.tipo}) sem CNDs cadastradas`);
    }
    if (e.tipo === 'principal' || e.tipo === 'subcontratada') {
      const pgr = (data.docs_empresa ?? []).find(d => d.empresa_id === e.id && d.tipo === 'pgr');
      const pcmso = (data.docs_empresa ?? []).find(d => d.empresa_id === e.id && d.tipo === 'pcmso');
      if (!pgr) gaps.push(`- Empresa ${e.id} sem PGR`);
      if (!pcmso) gaps.push(`- Empresa ${e.id} sem PCMSO`);
    }
  }
  for (const pg of (data.pessoas_gm ?? [])) {
    if (!pg.email) gaps.push(`- pessoas_gm ${pg.id} sem email`);
    if (!pg.papeis) gaps.push(`- pessoas_gm ${pg.id} sem papeis declarados`);
  }

  const md = [
    `# SG3 Bootstrap Gap Report — ${today}`, '',
    `Lacunas detectadas (${gaps.length}). Preencha manualmente na Sheet:`, '',
    ...gaps,
  ].join('\n');
  writeFileSync(resolve(out, 'gap-report.md'), md);
  log.info('gap report written', { count: gaps.length });
}

main().catch(err => {
  log.error('bootstrap failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
