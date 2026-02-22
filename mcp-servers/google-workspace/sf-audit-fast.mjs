#!/usr/bin/env node
/**
 * SpotFusion Drive Audit - Fast version
 * Limits: max 5000 files per root folder, max depth 6
 * Writes results incrementally to /tmp/sf-audit-*.json per drive
 */
import { google } from "googleapis";
import fs from "fs/promises";

const CREDS = "/home/teruel/JARVIS/config/credentials/gcp-service-account.json";
const OUT = "/tmp/sf-audit";

const DRIVES = [
  ["PRIMARY", "0AAUuVGQz7cyDUk9PVA"],
  ["INSTALL_ARCH", "0APT3mc0PMiq6Uk9PVA"],
  ["REGISTRO_MODELOS", "0ALkKjiUvsY1wUk9PVA"],
  ["RAW_DATASETS", "0AIoTK7RQO9oSUk9PVA"],
  ["EXTERNO_ENTREGAVEIS", "0ACPgAPIjYEECUk9PVA"],
  ["EXTERNO_HISTORICO", "0AElZNEH3ofBVUk9PVA"],
];

const MAX_FILES = 5000;
const MAX_DEPTH = 6;

async function getAuth() {
  const k = JSON.parse(await fs.readFile(CREDS, "utf-8"));
  return new google.auth.GoogleAuth({
    credentials: k,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "pedro@lumesolutions.com" },
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function retry(fn, n=5) {
  for (let i=1; i<=n; i++) {
    try { return await fn(); }
    catch(e) {
      const s = e?.response?.status;
      if ((s===429||s===503||s===500) && i<n) { await sleep(2000*i); continue; }
      throw e;
    }
  }
}

async function scan(drive, folderId, prefix, depth, counter) {
  if (depth > MAX_DEPTH || counter.n > MAX_FILES) return { files: [], folders: [] };
  const FM = "application/vnd.google-apps.folder";
  const files = [], folders = [];
  let pt = null;

  do {
    if (counter.n > MAX_FILES) break;
    const res = await retry(() =>
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
    for (const f of (res.data.files||[])) {
      if (counter.n > MAX_FILES) break;
      const p = prefix ? `${prefix}/${f.name}` : f.name;
      if (f.mimeType === FM) {
        folders.push({ id: f.id, name: f.name, path: p+"/", depth: depth+1 });
        const sub = await scan(drive, f.id, p, depth+1, counter);
        files.push(...sub.files);
        folders.push(...sub.folders);
      } else {
        counter.n++;
        files.push({
          name: f.name, path: p, mimeType: f.mimeType,
          modifiedTime: f.modifiedTime, createdTime: f.createdTime,
          size: f.size ? parseInt(f.size) : 0, depth: depth+1,
        });
      }
    }
    pt = res.data.nextPageToken;
  } while (pt);
  return { files, folders };
}

function fmtSize(b) {
  if (!b) return "0 B";
  const u = ["B","KB","MB","GB","TB"];
  let i=0, s=b;
  while (s>=1024&&i<4) {s/=1024;i++;}
  return `${s.toFixed(1)} ${u[i]}`;
}

function getMimeCat(mt) {
  if (!mt) return "Unknown";
  if (mt === "application/vnd.google-apps.document") return "Google Doc";
  if (mt === "application/vnd.google-apps.spreadsheet") return "Google Sheet";
  if (mt === "application/vnd.google-apps.presentation") return "Google Slides";
  if (mt === "application/vnd.google-apps.form") return "Google Form";
  if (mt === "application/vnd.google-apps.drawing") return "Google Drawing";
  if (mt === "application/vnd.google-apps.shortcut") return "Shortcut";
  if (mt.startsWith("image/")) return "Image";
  if (mt === "application/pdf") return "PDF";
  if (mt.includes("spreadsheet")||mt.includes("excel")) return "Excel";
  if (mt.includes("word")) return "Word";
  if (mt.includes("presentation")||mt.includes("powerpoint")) return "PowerPoint";
  if (mt.includes("video/")) return "Video";
  if (mt.includes("zip")||mt.includes("compressed")||mt.includes("rar")||mt.includes("7z")) return "Archive";
  if (mt.includes("text/")) return "Text";
  if (mt.includes("octet-stream")) return "Binary";
  return "Other ("+mt+")";
}

function getExt(name) {
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "(none)";
}

function analyze(files) {
  const r = { totalFiles: files.length, totalSize: 0, byExt: {}, byCat: {},
    oldest: null, newest: null, googleNative: [], topLevelFolders: [] };
  for (const f of files) {
    r.totalSize += f.size||0;
    const ext = getExt(f.name);
    r.byExt[ext] = (r.byExt[ext]||0)+1;
    const cat = getMimeCat(f.mimeType);
    r.byCat[cat] = (r.byCat[cat]||0)+1;
    const d = f.modifiedTime;
    if (d) {
      if (!r.oldest||d<r.oldest) r.oldest = d;
      if (!r.newest||d>r.newest) r.newest = d;
    }
    if (f.mimeType?.startsWith("application/vnd.google-apps.")&&
        !f.mimeType.includes("folder")&&!f.mimeType.includes("shortcut")) {
      r.googleNative.push({ name:f.name, path:f.path, type:cat });
    }
  }
  r.totalSizeHuman = fmtSize(r.totalSize);
  return r;
}

async function main() {
  const auth = await getAuth();
  const drive = google.drive({ version: "v3", auth });

  for (const [key, driveId] of DRIVES) {
    const outFile = `${OUT}-${key}.json`;
    console.error(`\n========== ${key} ==========`);

    try {
      // List root
      let pt = null;
      const rootItems = [];
      do {
        const res = await retry(() =>
          drive.files.list({
            q: `'${driveId}' in parents and trashed=false`,
            pageSize: 1000,
            fields: "files(id,name,mimeType,modifiedTime,size),nextPageToken",
            orderBy: "folder,name",
            pageToken: pt||undefined,
            includeItemsFromAllDrives: true, supportsAllDrives: true,
            driveId, corpora: "drive",
          })
        );
        rootItems.push(...(res.data.files||[]));
        pt = res.data.nextPageToken;
      } while (pt);

      console.error(`  Root: ${rootItems.length} items`);
      const driveResult = { driveId, rootItemCount: rootItems.length, folders: {} };

      for (const item of rootItems) {
        const isFolder = item.mimeType === "application/vnd.google-apps.folder";
        if (isFolder) {
          console.error(`  >> ${item.name}`);
          const counter = { n: 0 };
          try {
            const result = await scan(drive, item.id, item.name, 0, counter);
            const stats = analyze(result.files);
            driveResult.folders[item.name] = {
              id: item.id,
              totalFiles: stats.totalFiles,
              totalFolders: result.folders.length,
              totalSize: stats.totalSize,
              totalSizeHuman: stats.totalSizeHuman,
              oldest: stats.oldest,
              newest: stats.newest,
              byExt: stats.byExt,
              byCat: stats.byCat,
              googleNative: stats.googleNative,
              subfolders: result.folders.filter(f => f.depth <= 2).map(f => f.path),
              truncated: counter.n >= MAX_FILES,
              sampleFiles: result.files.slice(0, 30).map(f => ({ name:f.name, path:f.path, mimeType:f.mimeType, size:f.size })),
            };
            console.error(`    ${stats.totalFiles} files, ${result.folders.length} folders, ${stats.totalSizeHuman}${counter.n >= MAX_FILES ? " [TRUNCATED]" : ""}`);
          } catch (e) {
            console.error(`    ERROR: ${e.message}`);
            driveResult.folders[item.name] = { id: item.id, error: e.message };
          }
          await sleep(200);
        } else {
          if (!driveResult.rootFiles) driveResult.rootFiles = [];
          driveResult.rootFiles.push({
            name: item.name, mimeType: item.mimeType,
            size: item.size ? parseInt(item.size) : 0, modifiedTime: item.modifiedTime,
          });
        }
      }

      await fs.writeFile(outFile, JSON.stringify(driveResult, null, 2));
      console.error(`  => ${outFile}`);
    } catch (e) {
      console.error(`  DRIVE ERROR: ${e.message}`);
      await fs.writeFile(outFile, JSON.stringify({ driveId, error: e.message }));
    }
  }

  console.error("\nALL DONE");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
