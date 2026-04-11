import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendMessage, readMessagesSince } from '../lib/transcript-store.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jarvis-tx-')); }

const sampleMsg = {
  ts: '2026-04-10T14:00:00Z',
  space_id: 'spaces/AAQ',
  thread_id: 'spaces/AAQ/threads/T1',
  message_id: 'spaces/AAQ/messages/M1',
  sender: { id: 'users/1', name: 'Pedro' },
  text: 'oi',
  is_bot: false,
};

test('appendMessage writes JSONL partitioned by space and UTC day', () => {
  const dir = tmp();
  try {
    appendMessage(dir, sampleMsg);
    const all = readMessagesSince(dir, 'spaces/AAQ', null);
    assert.equal(all.length, 1);
    assert.equal(all[0].text, 'oi');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readMessagesSince: cursor filters older messages', () => {
  const dir = tmp();
  try {
    appendMessage(dir, { ...sampleMsg, ts: '2026-04-10T14:00:00Z' });
    appendMessage(dir, { ...sampleMsg, message_id: 'M2', ts: '2026-04-10T14:05:00Z', text: 'segunda' });
    const after = readMessagesSince(dir, 'spaces/AAQ', '2026-04-10T14:02:00Z');
    assert.equal(after.length, 1);
    assert.equal(after[0].text, 'segunda');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readMessagesSince: nonexistent space returns empty', () => {
  const dir = tmp();
  try {
    assert.deepEqual(readMessagesSince(dir, 'spaces/MISSING', null), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appendMessage + readMessagesSince: handles messages spanning two UTC days', () => {
  const dir = tmp();
  try {
    appendMessage(dir, { ...sampleMsg, message_id: 'M1', ts: '2026-04-09T23:59:00Z', text: 'day1' });
    appendMessage(dir, { ...sampleMsg, message_id: 'M2', ts: '2026-04-10T00:01:00Z', text: 'day2' });
    const all = readMessagesSince(dir, 'spaces/AAQ', null);
    assert.equal(all.length, 2);
    assert.ok(all.find(m => m.text === 'day1'));
    assert.ok(all.find(m => m.text === 'day2'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
