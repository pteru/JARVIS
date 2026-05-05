#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, loadClientConfig, dataDir } from './lib/config.mjs';
import { withSg3Session, scrapeCadastros, scrapeAlocacoes, scrapeDocumentos } from './lib/sg3-client.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('collect-sg3');
const argDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

async function main() {
  const cfg = loadConfig();
  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });

  let clientCfg;
  try {
    clientCfg = loadClientConfig('gm');
  } catch (err) {
    if (err.code === 'ENOENT') {
      log.warn('clients/gm.json not yet present — SG3 spike not done. Writing failed snapshot.');
      const snapshot = {
        collected_at: new Date().toISOString(),
        source: 'playwright',
        status: 'failed',
        error: 'config/sg3-monitor/clients/gm.json not found — run Task 23 (SG3 spike) first',
      };
      writeFileSync(resolve(out, 'sg3-snapshot.json'), JSON.stringify(snapshot, null, 2));
      log.info('placeholder snapshot written', { status: snapshot.status });
      return;
    }
    throw err;
  }

  const keys = clientCfg.playwright.credentials_keys ?? [];
  const perLogin = [];
  let aggregateStatus = 'ok';

  for (const key of keys) {
    try {
      const partial = await withSg3Session(clientCfg, key, async (page) => {
        const cadastros = await scrapeCadastros(page, clientCfg.playwright.scrape_targets?.cadastros_contrato_url);
        const alocacoes = await scrapeAlocacoes(page, clientCfg.playwright.scrape_targets?.alocacoes_status_url);
        const documentos = await scrapeDocumentos(page);
        return { credentialsKey: key, status: 'ok', ...cadastros, ...alocacoes, ...documentos };
      });
      perLogin.push(partial);
    } catch (err) {
      log.error('sg3 scrape failed for credential', { key, err: err.message });
      aggregateStatus = /credentials|mfa|login/i.test(err.message) ? 'auth_expired' : 'failed';
      perLogin.push({ credentialsKey: key, status: aggregateStatus, error: err.message });
    }
  }

  const merged = mergeByPrimary(perLogin, ['cadastros_sg3', 'colaboradores', 'plantas', 'pessoas_gm', 'alocacoes', 'docs_empresa', 'docs_colaborador', 'declaracoes_responsabilidade']);

  const snapshot = {
    collected_at: new Date().toISOString(),
    source: 'playwright',
    status: aggregateStatus === 'ok' ? 'ok' : aggregateStatus,
    per_login: perLogin.map(p => ({ credentialsKey: p.credentialsKey, status: p.status, error: p.error })),
    ...merged,
  };

  const path = resolve(out, 'sg3-snapshot.json');
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  log.info('snapshot written', { path, status: snapshot.status, logins: keys.length });
}

function mergeByPrimary(perLogin, kinds) {
  const out = Object.fromEntries(kinds.map(k => [k, []]));
  for (const p of perLogin) {
    if (p.status !== 'ok') continue;
    for (const kind of kinds) {
      const existing = new Map(out[kind].map(r => [r.id, r]));
      for (const row of (p[kind] ?? [])) {
        const prev = existing.get(row.id);
        if (!prev) { out[kind].push(row); existing.set(row.id, row); }
        else {
          // shallow merge — fill empty fields from new row
          for (const k of Object.keys(row)) if (prev[k] == null || prev[k] === '') prev[k] = row[k];
        }
      }
    }
  }
  return out;
}

main().catch(err => {
  log.error('collect-sg3 fatal', { err: err.message });
  process.exitCode = 1;
});
