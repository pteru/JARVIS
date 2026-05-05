#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, loadClientConfig, dataDir, ROOT_DIR } from './lib/config.mjs';
import { withSg3Session, scrapeCadastros, scrapeAlocacoes, scrapeDocumentos } from './lib/sg3-client.mjs';
import { syncDocuments, loadState } from './lib/document-downloader.mjs';
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

  // ─── Incremental document download ─────────────────────────────────────────
  let dlResult = null;
  const hasAnyDocs = (
    (merged.docs_empresa?.length ?? 0) +
    (merged.docs_colaborador?.length ?? 0) +
    (merged.declaracoes_responsabilidade?.length ?? 0)
  ) > 0;

  if (hasAnyDocs && keys.length > 0) {
    const baseDir = resolve(ROOT_DIR, 'data/sg3-monitor/documentos');
    const statePath = resolve(ROOT_DIR, 'data/sg3-monitor/documents-state.json');
    const authDir = resolve(ROOT_DIR, clientCfg.playwright.auth_session_dir);

    // Attach category field (already set by scrapeDocumentos, but re-apply defensively)
    const allDocs = [
      ...(merged.docs_empresa ?? []).map(d => ({ ...d, category: d.category ?? 'empresa' })),
      ...(merged.docs_colaborador ?? []).map(d => ({ ...d, category: d.category ?? 'colaborador' })),
      ...(merged.declaracoes_responsabilidade ?? []).map(d => ({ ...d, category: d.category ?? 'declaracao' })),
    ];

    try {
      dlResult = await syncDocuments({
        docs: allDocs,
        baseDir,
        statePath,
        authDir,
        credentialsKey: keys[0],
        rootDir: ROOT_DIR,
        log,
      });

      // Populate arquivo_url from full state (covers both newly downloaded + previously downloaded)
      const fullState = loadState(statePath);
      if (Object.keys(fullState).length > 0) {
        // Build id→file_path map: state is keyed by sg3_doc_id, docs have sg3_doc_id field
        for (const kind of ['docs_empresa', 'docs_colaborador', 'declaracoes_responsabilidade']) {
          for (const doc of (merged[kind] ?? [])) {
            const entry = doc.sg3_doc_id ? fullState[doc.sg3_doc_id] : null;
            if (entry?.file_path) doc.arquivo_url = entry.file_path;
          }
        }
      }
    } catch (err) {
      log.error('document sync failed (non-fatal)', { err: err.message });
      dlResult = { error: err.message };
    }
  }

  const snapshot = {
    collected_at: new Date().toISOString(),
    source: 'playwright',
    status: aggregateStatus === 'ok' ? 'ok' : aggregateStatus,
    per_login: perLogin.map(p => ({ credentialsKey: p.credentialsKey, status: p.status, error: p.error })),
    ...merged,
    ...(dlResult !== null ? { documents_sync: dlResult } : {}),
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
