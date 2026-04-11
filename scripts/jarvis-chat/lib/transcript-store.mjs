import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function safeSpaceDir(spaceId) {
  return spaceId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function dayFileName(iso) {
  return `${iso.substring(0, 10)}.jsonl`;
}

export function appendMessage(transcriptsRoot, message) {
  const safe = safeSpaceDir(message.space_id);
  const dir = join(transcriptsRoot, safe);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, dayFileName(message.ts));
  appendFileSync(file, JSON.stringify(message) + '\n');
}

export function readMessagesSince(transcriptsRoot, spaceId, sinceIso) {
  const safe = safeSpaceDir(spaceId);
  const dir = join(transcriptsRoot, safe);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
  const out = [];
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (sinceIso && new Date(m.ts) <= new Date(sinceIso)) continue;
      out.push(m);
    }
  }
  return out;
}
