import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAllSessions } from '../../../scripts/claude-monitor/lib/sessions.mjs';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'claude-monitor-turn-'));
  const sessionsDir = join(root, 'sessions');
  const projectsDir = join(root, 'projects');
  mkdirSync(sessionsDir);
  mkdirSync(projectsDir);
  return { sessionsDir, projectsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function transcript() {
  return [
    JSON.stringify({ type: 'user', isMeta: false, isSidechain: false, message: { role: 'user', content: 'big task' }, timestamp: '2026-05-15T10:00:00.000Z' }),
    JSON.stringify({ type: 'assistant', message: {}, timestamp: '2026-05-15T10:11:00.000Z' }),
  ].join('\n') + '\n';
}

test('readAllSessions attaches lastTurnDurationMs and lastTurnEndTs', () => {
  const { sessionsDir, projectsDir, cleanup } = setup();
  try {
    writeFileSync(join(sessionsDir, '1.json'), JSON.stringify({
      pid: 1, sessionId: 'sess-T', cwd: '/x', name: 't', status: 'idle', updatedAt: 100,
    }));
    mkdirSync(join(projectsDir, '-x'));
    writeFileSync(join(projectsDir, '-x', 'sess-T.jsonl'), transcript());

    const result = readAllSessions(sessionsDir, { now: 200, isPidAlive: () => true, projectsDir });
    assert.equal(result[0].lastTurnDurationMs, 11 * 60_000);
    assert.equal(result[0].lastTurnEndTs, Date.parse('2026-05-15T10:11:00.000Z'));
  } finally { cleanup(); }
});

test('readAllSessions sets turn fields to null when transcript missing', () => {
  const { sessionsDir, projectsDir, cleanup } = setup();
  try {
    writeFileSync(join(sessionsDir, '1.json'), JSON.stringify({
      pid: 1, sessionId: 'sess-NO', cwd: '/x', name: 'n', status: 'idle', updatedAt: 100,
    }));
    const result = readAllSessions(sessionsDir, { now: 200, isPidAlive: () => true, projectsDir });
    assert.equal(result[0].lastTurnDurationMs, null);
    assert.equal(result[0].lastTurnEndTs, null);
  } finally { cleanup(); }
});

test('readAllSessions omits turn fields when projectsDir not given', () => {
  const { sessionsDir, cleanup } = setup();
  try {
    writeFileSync(join(sessionsDir, '1.json'), JSON.stringify({
      pid: 1, sessionId: 'sess-X', cwd: '/x', name: 'x', status: 'idle', updatedAt: 100,
    }));
    const result = readAllSessions(sessionsDir, { now: 200, isPidAlive: () => true });
    assert.equal(result[0].lastTurnDurationMs, undefined);
    assert.equal(result[0].lastTurnEndTs, undefined);
  } finally { cleanup(); }
});
