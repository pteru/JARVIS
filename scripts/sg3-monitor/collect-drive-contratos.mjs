#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig, dataDir } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { classifyDriveFile } from './lib/contract-name-parser.mjs';
import { parseContractPdf } from './lib/contract-pdf-parser.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('collect-drive');
const argDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

async function listRecursive(drive, folderId, parentName, acc = []) {
  let pageToken;
  do {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, createdTime, modifiedTime, parents)',
      pageSize: 100,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    for (const f of r.data.files ?? []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        await listRecursive(drive, f.id, f.name, acc);
      } else {
        acc.push({ ...f, parentName });
      }
    }
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  return acc;
}

async function downloadToTmp(drive, fileId) {
  const tmp = mkdtempSync(join(tmpdir(), 'sg3-drive-'));
  const dest = join(tmp, fileId + '.pdf');
  const fs = await import('node:fs');
  const ws = fs.createWriteStream(dest);
  const r = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
  await new Promise((res, rej) => {
    r.data.on('end', res).on('error', rej).pipe(ws);
  });
  return dest;
}

async function main() {
  const cfg = loadConfig();
  const { drive } = buildClients(cfg);
  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });

  log.info('listing root folder', { folderId: cfg.drive_root_folder_id });
  const rootFolder = await drive.files.get({ fileId: cfg.drive_root_folder_id, fields: 'name', supportsAllDrives: true });
  const files = await listRecursive(drive, cfg.drive_root_folder_id, rootFolder.data.name);
  log.info(`listed ${files.length} files`);

  const contratosDrive = [];
  const docsComVenc = [];
  const ignorados = [];

  for (const f of files) {
    const cls = classifyDriveFile({ name: f.name, parentName: f.parentName });

    if (cls.kind === 'contrato_gm') {
      let extracao = { extracaoStatus: 'manual', warnings: ['parser não executado'] };
      try {
        const pdfPath = await downloadToTmp(drive, f.id);
        extracao = await parseContractPdf({ pdfPath });
      } catch (err) {
        log.warn(`PDF parse failed for ${f.name}`, { err: err.message });
        extracao = { extracaoStatus: 'falhou', warnings: [err.message] };
      }
      contratosDrive.push({
        file_id: f.id, file_name: f.name, file_url: f.webViewLink,
        file_mime_type: f.mimeType, data_criacao: f.createdTime, data_modificacao: f.modifiedTime,
        contrato_id_inferido: cls.contratoId, status_drive: cls.statusDrive,
        extracao,
      });
    } else if (cls.kind === 'doc_with_venc') {
      docsComVenc.push({
        file_id: f.id, file_name: f.name, file_url: f.webViewLink,
        data_vencimento_extraida: cls.dataVencimento, descricao: cls.descricao,
      });
    } else if (cls.kind === 'danfe' || cls.kind === 'template') {
      ignorados.push({ file_name: f.name, razao: cls.kind });
    } else {
      contratosDrive.push({
        file_id: f.id, file_name: f.name, file_url: f.webViewLink,
        file_mime_type: f.mimeType, data_criacao: f.createdTime, data_modificacao: f.modifiedTime,
        contrato_id_inferido: null, status_drive: null,
        extracao: { extracaoStatus: 'manual', warnings: ['filename pattern não reconhecido'] },
      });
    }
  }

  const snapshot = {
    collected_at: new Date().toISOString(),
    status: 'ok',
    contratos_drive: contratosDrive,
    docs_com_venc_filename: docsComVenc,
    ignorados,
  };

  const path = resolve(out, 'drive-snapshot.json');
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  log.info('snapshot written', { path, contratos: contratosDrive.length, docsComVenc: docsComVenc.length, ignorados: ignorados.length });
}

main().catch(err => {
  log.error('collect-drive failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
