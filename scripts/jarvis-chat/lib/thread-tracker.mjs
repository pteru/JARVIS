import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export function loadThreads(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveThreads(filePath, state) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function getThread(state, threadId) {
  return state[threadId] || null;
}

export function upsertThread(state, threadRecord) {
  state[threadRecord.thread_id] = threadRecord;
}

export function pruneExpired(state, nowIso, config) {
  const nowMs = new Date(nowIso).getTime();
  for (const id of Object.keys(state)) {
    const t = state[id];
    if (t.status === 'expired') {
      delete state[id];
      continue;
    }
    const lastMs = new Date(t.last_jarvis_reply_at).getTime();
    if ((nowMs - lastMs) / 60000 > config.thread_window_minutes) {
      delete state[id];
    }
  }
}
