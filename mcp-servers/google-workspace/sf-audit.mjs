#!/usr/bin/env node
/**
 * SpotFusion Google Drive Deep Audit Script
 * Read-only — lists all files/folders across all SF drives
 */

import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";

const CREDS_PATH = "/home/teruel/JARVIS/config/credentials/gcp-service-account.json";
const OUTPUT_PATH = "/tmp/sf-drive-audit-results.json";

// All SpotFusion drives to audit
const DRIVES = {
  "PRIMARY": "0AAUuVGQz7cyDUk9PVA",
  "INSTALL_ARCH": "0APT3mc0PMiq6Uk9PVA",
  "REGISTRO_MODELOS": "0ALkKjiUvsY1wUk9PVA",
  "RAW_DATASETS": "0AIoTK7RQO9oSUk9PVA",
  "EXTERNO_ENTREGAVEIS": "0ACPgAPIjYEECUk9PVA",
  "EXTERNO_HISTORICO": "0AElZNEH3ofBVUk9PVA",
};

async function getAuth() {
  const keyContent = await fs.readFile(CREDS_PATH, "utf-8");
  const key = JSON.parse(keyContent);
  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "pedro@lumesolutions.com" },
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, max = 5, delay = 2000) {
  for (let i = 1; i <= max; i++) {
    try { return await fn(); }
    catch (e) {
      const s = e?.response?.status || e?.code;
      if ((s === 429 || s === 503 || s === 500) && i < max) {
        console.error(`  retry ${i}/${max} status=${s}`);
        await sleep(delay * i);
        continue;
      }
      throw e;
    }
  }
}

async function listAllInFolder(drive, folderId, prefix = "", depth = 0, maxDepth = 10) {
  if (depth > maxDepth) return { files: [], folders: [] };
  const allFiles = [];
  const allFolders = [];
  const FM = "application/vnd.google-apps.folder";
  let pt = null;

  do {
    const res = await withRetry(() =>
      drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        pageSize: 1000,
        fields: "files(id,name,mimeType,modifiedTime,createdTime,size),nextPageToken",
        orderBy: "folder,name",
        pageToken: pt || undefined,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      })
    );
    for (const f of (res.data.files || [])) {
      const p = prefix ? `${prefix}/${f.name}` : f.name;
      if (f.mimeType === FM) {
        allFolders.push({ id: f.id, name: f.name, path: p + "/", depth: depth + 1 });
        const sub = await listAllInFolder(drive, f.id, p, depth + 1, maxDepth);
        allFiles.push(...sub.files);
        allFolders.push(...sub.folders);
      } else {
        allFiles.push({
          id: f.id, name: f.name, path: p, mimeType: f.mimeType,
          modifiedTime: f.modifiedTime, createdTime: f.createdTime,
          size: f.size ? parseInt(f.size) : 0, depth: depth + 1,
        });
      }
    }
    pt = res.data.nextPageToken;
  } while (pt);
  return { files: allFiles, folders: allFolders };
}

async function listDriveRoot(drive, driveId) {
  let pt = null;
  const items = [];
  do {
    const res = await withRetry(() =>
      drive.files.list({
        q: `'${driveId}' in parents and trashed=false`,
        pageSize: 1000,
        fields: "files(id,name,mimeType,modifiedTime,createdTime,size),nextPageToken",
        orderBy: "folder,name",
        pageToken: pt || undefined,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        driveId, corpora: "drive",
      })
    );
    items.push(...(res.data.files || []));
    pt = res.data.nextPageToken;
  } while (pt);
  return items;
}

function getMimeCat(mt) {
  if (mt === "application/vnd.google-apps.document") return "Google Doc";
  if (mt === "application/vnd.google-apps.spreadsheet") return "Google Sheet";
  if (mt === "application/vnd.google-apps.presentation") return "Google Slides";
  if (mt === "application/vnd.google-apps.form") return "Google Form";
  if (mt === "application/vnd.google-apps.drawing") return "Google Drawing";
  if (mt === "application/vnd.google-apps.shortcut") return "Shortcut";
  if (mt?.startsWith("image/")) return "Image";
  if (mt === "application/pdf") return "PDF";
  if (mt?.includes("spreadsheet") || mt?.includes("excel")) return "Excel";
  if (mt?.includes("word")) return "Word";
  if (mt?.includes("presentation") || mt?.includes("powerpoint")) return "PowerPoint";
  if (mt?.includes("video/")) return "Video";
  if (mt?.includes("zip") || mt?.includes("compressed") || mt?.includes("rar")) return "Archive";
  if (mt?.includes("text/")) return "Text";
  return "Other";
}

function getExt(name) {
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "(none)";
}

function analyze(files) {
  const r = { totalFiles: files.length, totalSize: 0, byExt: {}, byCat: {}, oldest: null, newest: null, googleNative: [] };
  for (const f of files) {
    r.totalSize += f.size || 0;
    const ext = getExt(f.name);
    r.byExt[ext] = (r.byExt[ext] || 0) + 1;
    const cat = getMimeCat(f.mimeType);
    r.byCat[cat] = (r.byCat[cat] || 0) + 1;
    const d = f.modifiedTime ? new Date(f.modifiedTime) : null;
    if (d) {
      if (!r.oldest || d < new Date(r.oldest)) r.oldest = f.modifiedTime;
      if (!r.newest || d > new Date(r.newest)) r.newest = f.modifiedTime;
    }
    if (f.mimeType?.startsWith("application/vnd.google-apps.") && !f.mimeType.includes("folder") && !f.mimeType.includes("shortcut")) {
      r.googleNative.push({ name: f.name, path: f.path, type: cat });
    }
  }
  return r;
}

function fmtSize(b) {
  if (!b) return "0 B";
  const u = ["B","KB","MB","GB"];
  let i = 0, s = b;
  while (s >= 1024 && i < 3) { s /= 1024; i++; }
  return `${s.toFixed(1)} ${u[i]}`;
}

async function main() {
  const auth = await getAuth();
  const drive = google.drive({ version: "v3", auth });
  const report = { timestamp: new Date().toISOString(), drives: {} };

  // Scan each drive
  for (const [key, driveId] of Object.entries(DRIVES)) {
    console.error(`\n=== Scanning drive: ${key} ===`);
    try {
      const rootItems = await listDriveRoot(drive, driveId);
      console.error(`  Root: ${rootItems.length} items`);

      const driveReport = { driveId, rootItems: [], projects: {}, otherFolders: {}, rootFiles: [] };

      for (const item of rootItems) {
        const isFolder = item.mimeType === "application/vnd.google-apps.folder";
        driveReport.rootItems.push({
          id: item.id, name: item.name, isFolder, mimeType: item.mimeType,
          size: item.size ? parseInt(item.size) : 0, modifiedTime: item.modifiedTime,
        });

        if (isFolder) {
          console.error(`  >> Scanning folder: "${item.name}"`);
          try {
            const result = await listAllInFolder(drive, item.id, item.name);
            const stats = analyze(result.files);
            const folderData = {
              id: item.id,
              stats: { ...stats, totalFolders: result.folders.length, totalSizeHuman: fmtSize(stats.totalSize) },
              subfolders: result.folders.map(f => f.path),
              files: result.files.map(f => ({
                name: f.name, path: f.path, mimeType: f.mimeType,
                size: f.size, modifiedTime: f.modifiedTime, depth: f.depth,
              })),
            };

            // Determine if it's a project folder (starts with [02)
            if (item.name.match(/^\[02/)) {
              driveReport.projects[item.name] = folderData;
            } else {
              driveReport.otherFolders[item.name] = folderData;
            }
            console.error(`    ${result.files.length} files, ${result.folders.length} folders, ${fmtSize(stats.totalSize)}`);
          } catch (err) {
            console.error(`    ERROR: ${err.message}`);
            const target = item.name.match(/^\[02/) ? driveReport.projects : driveReport.otherFolders;
            target[item.name] = { id: item.id, error: err.message };
          }
          await sleep(300);
        } else {
          driveReport.rootFiles.push({
            id: item.id, name: item.name, mimeType: item.mimeType,
            size: item.size ? parseInt(item.size) : 0, modifiedTime: item.modifiedTime,
          });
        }
      }

      report.drives[key] = driveReport;
    } catch (err) {
      console.error(`  DRIVE ERROR: ${err.message}`);
      report.drives[key] = { driveId, error: err.message };
    }
  }

  // Write output
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.error(`\nDone! Report written to ${OUTPUT_PATH}`);
  console.log(OUTPUT_PATH);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
