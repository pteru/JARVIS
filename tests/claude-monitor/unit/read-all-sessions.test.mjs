import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAllSessions } from '../../../scripts/claude-monitor/lib/sessions.mjs';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'claude-monitor-test-'));
}

test('readAllSessions returns empty array for empty dir', () => {
  const dir = makeTempDir();
  try {
    const result = readAllSessions(dir, { now: 1_000_000, isPidAlive: () => true });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAllSessions parses one valid session file', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '12345.json'), JSON.stringify({
      pid: 12345, sessionId: 'abc-123', cwd: '/x', name: 'one', status: 'busy', updatedAt: 900_000,
    }));
    const result = readAllSessions(dir, { now: 1_000_000, isPidAlive: () => true });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'one');
    assert.equal(result[0].displayStatus, 'running');
    assert.equal(result[0].ageMs, 100_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAllSessions skips non-.json files', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'README'), 'not json');
    writeFileSync(join(dir, '12345.json'), JSON.stringify({
      pid: 12345, sessionId: 'abc', cwd: '/x', name: 'a', status: 'idle', updatedAt: 1_000_000,
    }));
    const result = readAllSessions(dir, { now: 1_000_000, isPidAlive: () => true });
    assert.equal(result.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAllSessions ignores malformed JSON files', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'broken.json'), '{not valid');
    writeFileSync(join(dir, '12345.json'), JSON.stringify({
      pid: 12345, sessionId: 'abc', cwd: '/x', name: 'ok', status: 'idle', updatedAt: 1_000_000,
    }));
    const result = readAllSessions(dir, { now: 1_000_000, isPidAlive: () => true });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAllSessions passes PID through to isPidAlive', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, '111.json'), JSON.stringify({
      pid: 111, sessionId: 'a', cwd: '/x', name: 'alive', status: 'busy', updatedAt: 1_000_000,
    }));
    writeFileSync(join(dir, '222.json'), JSON.stringify({
      pid: 222, sessionId: 'b', cwd: '/x', name: 'dead', status: 'busy', updatedAt: 1_000_000,
    }));
    const seenPids = [];
    const result = readAllSessions(dir, {
      now: 1_000_000,
      isPidAlive: (pid) => { seenPids.push(pid); return pid === 111; },
    });
    assert.deepEqual(seenPids.sort(), [111, 222]);
    const byName = Object.fromEntries(result.map((r) => [r.name, r.displayStatus]));
    assert.equal(byName.alive, 'running');
    assert.equal(byName.dead, 'ended');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAllSessions returns empty array when dir does not exist', () => {
  const result = readAllSessions('/nonexistent/path/claude-monitor-test', {
    now: 1_000_000,
    isPidAlive: () => true,
  });
  assert.deepEqual(result, []);
});
