import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadThreads, saveThreads, getThread, upsertThread, pruneExpired } from '../lib/thread-tracker.mjs';

function tmpFile() {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-tt-'));
  return join(dir, 'active.json');
}

const threadA = {
  thread_id: 'spaces/AAQ/threads/A',
  space_id: 'spaces/AAQ',
  engaged_at: '2026-04-10T14:00:00Z',
  last_jarvis_reply_at: '2026-04-10T14:00:00Z',
  follow_ups_used: 0,
  status: 'active',
};

test('loadThreads: missing file returns empty object', () => {
  const f = tmpFile();
  assert.deepEqual(loadThreads(f), {});
});

test('saveThreads + loadThreads roundtrip', () => {
  const f = tmpFile();
  saveThreads(f, { [threadA.thread_id]: threadA });
  const loaded = loadThreads(f);
  assert.equal(loaded[threadA.thread_id].follow_ups_used, 0);
});

test('upsertThread + getThread', () => {
  const state = {};
  upsertThread(state, { ...threadA, follow_ups_used: 2 });
  assert.equal(getThread(state, threadA.thread_id).follow_ups_used, 2);
});

test('pruneExpired removes status="expired" and time-stale active threads', () => {
  const state = {
    [threadA.thread_id]: { ...threadA, status: 'expired' },
    'spaces/AAQ/threads/B': { ...threadA, thread_id: 'spaces/AAQ/threads/B', last_jarvis_reply_at: '2025-01-01T00:00:00Z' },
    'spaces/AAQ/threads/C': { ...threadA, thread_id: 'spaces/AAQ/threads/C', last_jarvis_reply_at: '2026-04-10T14:00:00Z' },
  };
  pruneExpired(state, '2026-04-10T14:01:00Z', { thread_window_minutes: 5 });
  assert.equal(state[threadA.thread_id], undefined);
  assert.equal(state['spaces/AAQ/threads/B'], undefined);
  assert.ok(state['spaces/AAQ/threads/C']);
});

test('loadThreads: malformed JSON returns empty object', () => {
  const f = tmpFile();
  writeFileSync(f, 'not json');
  assert.deepEqual(loadThreads(f), {});
});
