/**
 * document-downloader.mjs
 *
 * Incremental PDF downloader for SG3 Documentos.
 * Uses DATA ENVIO (as data_envio) for change detection.
 * Fetches S3 pre-signed URLs from the SG3 view page using session cookies.
 * No Playwright — pure fetch + fs.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { makeLogger } from './logger.mjs';

const log = makeLogger('document-downloader');

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}

// ─── State management ─────────────────────────────────────────────────────────

/**
 * Load downloader state map from disk.
 * State shape: { [sg3_doc_id]: { data_envio, file_path, sha256, downloaded_at } }
 */
export function loadState(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    log.warn('failed to parse state file; starting fresh', { path, err: err.message });
    return {};
  }
}

/**
 * Persist downloader state map to disk (atomic-ish: write then rename is ideal,
 * but writeFileSync is good enough here given single-process use).
 */
export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

// ─── Cookie extraction ────────────────────────────────────────────────────────

/**
 * Read Playwright storage state and return a Cookie header string.
 * @param {string} authDir  - directory containing {key}-storage-state.json
 * @param {string} credentialsKey - e.g. 'gm-lume'
 */
export function getStorageCookies(authDir, credentialsKey) {
  const stateFile = resolve(expandHome(authDir), `${credentialsKey}-storage-state.json`);
  if (!existsSync(stateFile)) {
    throw new Error(`Storage state file not found: ${stateFile}`);
  }
  const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
  const cookies = (state.cookies ?? [])
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
  return cookies;
}

// ─── S3 URL resolver ──────────────────────────────────────────────────────────

const S3_URL_RE = /https:\/\/sg3-gm\.s3\.amazonaws\.com\/[^\s"'<>]+\.pdf[^\s"'<>]*/;

/**
 * Fetch the SG3 view page and extract the embedded S3 pre-signed PDF URL.
 * Returns the URL string or null if not found.
 */
export async function resolveS3Url(viewUrl, cookies) {
  let res;
  try {
    res = await fetch(viewUrl, {
      headers: {
        Cookie: cookies,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
  } catch (err) {
    log.warn('fetch failed for view URL', { viewUrl, err: err.message });
    return null;
  }

  if (!res.ok) {
    log.warn('view page returned non-OK status', { viewUrl, status: res.status });
    return null;
  }

  const html = await res.text();
  const match = html.match(S3_URL_RE);
  if (!match) {
    log.warn('S3 URL pattern not found in view page HTML', { viewUrl, htmlLen: html.length });
    return null;
  }

  // Clean up any HTML entities that might have crept in (&amp; → &)
  return match[0].replace(/&amp;/g, '&');
}

// ─── File downloader ──────────────────────────────────────────────────────────

/**
 * Download a pre-signed S3 URL to destPath, compute SHA256.
 * Returns { sha256, size_bytes }.
 */
export async function downloadDocument(s3Url, destPath) {
  const res = await fetch(s3Url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`S3 fetch failed: ${res.status} ${res.statusText} for ${s3Url.slice(0, 80)}...`);
  }

  mkdirSync(dirname(destPath), { recursive: true });

  const hash = createHash('sha256');
  let size_bytes = 0;

  // Stream body to disk while computing hash
  const fileStream = createWriteStream(destPath);
  const bodyStream = Readable.fromWeb(res.body);

  await new Promise((resolveP, rejectP) => {
    bodyStream.on('data', chunk => {
      hash.update(chunk);
      size_bytes += chunk.length;
    });
    bodyStream.on('error', rejectP);
    fileStream.on('error', rejectP);
    fileStream.on('finish', resolveP);
    bodyStream.pipe(fileStream);
  });

  return { sha256: hash.digest('hex'), size_bytes };
}

// ─── Sync orchestrator ────────────────────────────────────────────────────────

/**
 * Incrementally sync PDFs for a set of document rows.
 *
 * @param {object} opts
 * @param {Array}  opts.docs         - rows with sg3_doc_id, data_envio, status_sg3, category, tipo, empresa_id, colaborador_id, planta_id
 * @param {string} opts.baseDir      - local root for PDF storage (absolute)
 * @param {string} opts.statePath    - JSON file tracking {sg3_doc_id → meta}
 * @param {string} opts.authDir      - directory containing Playwright storage-state files
 * @param {string} opts.credentialsKey - key used to load cookies (e.g. 'gm-lume')
 * @param {Function} [opts.log]      - optional logger (defaults to module logger)
 * @param {string} opts.rootDir      - project root for making relative file_path in state
 */
export async function syncDocuments({ docs, baseDir, statePath, authDir, credentialsKey, rootDir, log: extLog }) {
  const logger = extLog ?? log;
  const state = loadState(statePath);

  // Fetch cookies once for all requests
  let cookies;
  try {
    cookies = getStorageCookies(authDir, credentialsKey);
  } catch (err) {
    logger.error('cannot load session cookies — aborting document sync', { err: err.message });
    return {
      downloaded: [],
      skipped_unchanged: [],
      skipped_no_envio: [],
      failed: [{ reason: `no_cookies: ${err.message}` }],
    };
  }

  const downloaded = [];
  const skipped_unchanged = [];
  const skipped_no_envio = [];
  const failed = [];

  for (const doc of docs) {
    const { sg3_doc_id, data_envio, status_sg3, category, tipo, empresa_id, colaborador_id, planta_id } = doc;

    if (!sg3_doc_id) {
      skipped_no_envio.push({ id: doc.id, reason: 'no_sg3_id' });
      continue;
    }

    if (!data_envio || (status_sg3 ?? '').toUpperCase() !== 'CONFORME') {
      skipped_no_envio.push({ sg3_doc_id, id: doc.id, reason: 'no_envio_or_not_conforme', status_sg3 });
      continue;
    }

    // Check if unchanged since last run
    const prev = state[sg3_doc_id];
    if (prev && prev.data_envio === data_envio) {
      skipped_unchanged.push({ sg3_doc_id, id: doc.id, data_envio });
      continue;
    }

    // Compute destination path
    const viewUrl = `https://sg3.executiva.adm.br/gm/index.php?r=instancia-documento/view&id=${sg3_doc_id}`;

    let destPath;
    const safeId = String(sg3_doc_id);
    const safeEmpresa = empresa_id || 'unknown';
    const safeColab = colaborador_id || 'unknown';
    const safePlanta = planta_id || 'unknown';
    const safeTipo = tipo || 'doc';

    if (category === 'empresa') {
      destPath = resolve(baseDir, 'empresa', safeEmpresa, `${safeId}-${safeTipo}.pdf`);
    } else if (category === 'colaborador') {
      destPath = resolve(baseDir, 'colaborador', safeColab, `${safeId}-${safeTipo}.pdf`);
    } else {
      // declaracao
      destPath = resolve(baseDir, 'declaracao', `${safeColab}-${safePlanta}`, `${safeId}.pdf`);
    }

    logger.info('downloading document', { sg3_doc_id, category, destPath: destPath.slice(-60) });

    // Resolve S3 URL from view page
    let s3Url;
    try {
      s3Url = await resolveS3Url(viewUrl, cookies);
    } catch (err) {
      logger.warn('resolveS3Url threw', { sg3_doc_id, err: err.message });
      s3Url = null;
    }

    if (!s3Url) {
      logger.warn('could not resolve S3 URL', { sg3_doc_id, viewUrl });
      failed.push({ sg3_doc_id, id: doc.id, reason: 'no_s3_url', viewUrl });
      continue;
    }

    // Download
    let meta;
    try {
      meta = await downloadDocument(s3Url, destPath);
    } catch (err) {
      logger.warn('download failed', { sg3_doc_id, err: err.message });
      failed.push({ sg3_doc_id, id: doc.id, reason: `download_error: ${err.message}` });
      continue;
    }

    const file_path = rootDir ? relative(rootDir, destPath) : destPath;
    state[sg3_doc_id] = {
      data_envio,
      file_path,
      sha256: meta.sha256,
      size_bytes: meta.size_bytes,
      downloaded_at: new Date().toISOString(),
    };

    downloaded.push({
      sg3_doc_id,
      id: doc.id,
      category,
      file_path,
      sha256: meta.sha256,
      size_bytes: meta.size_bytes,
    });
  }

  saveState(statePath, state);
  logger.info('document sync complete', {
    downloaded: downloaded.length,
    skipped_unchanged: skipped_unchanged.length,
    skipped_no_envio: skipped_no_envio.length,
    failed: failed.length,
  });

  return { downloaded, skipped_unchanged, skipped_no_envio, failed };
}
