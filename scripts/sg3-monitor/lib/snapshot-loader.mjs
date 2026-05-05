import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT_DIR } from './config.mjs';

const ROOT = resolve(ROOT_DIR, 'data/sg3-monitor');

function snapshotDir(date) { return resolve(ROOT, date); }

export function readSnapshot(date, kind) {
  const path = resolve(snapshotDir(date), `${kind}-snapshot.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function readSnapshotWithFallback(date, kind, maxBackDays = 7) {
  const today = readSnapshot(date, kind);
  if (today && today.status === 'ok') return { snapshot: today, dateUsed: date };

  if (!existsSync(ROOT)) return { snapshot: today ?? null, dateUsed: today ? date : null };

  const dirs = readdirSync(ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < date).sort().reverse();
  for (const d of dirs.slice(0, maxBackDays)) {
    const s = readSnapshot(d, kind);
    if (s && s.status === 'ok') return { snapshot: s, dateUsed: d };
  }
  return { snapshot: today ?? null, dateUsed: today ? date : null };
}
