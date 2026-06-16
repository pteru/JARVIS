import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAllSessions } from '../../../scripts/claude-monitor/lib/sessions.mjs';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'claude-monitor-recap-'));
  const sessionsDir = join(root, 'sessions');
  const projectsDir = join(root, 'projects');
  mkdirSync(sessionsDir);
  mkdirSync(projectsDir);
  return { sessionsDir, projectsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('readAllSessions attaches recap from away_summary', () => {
  const { sessionsDir, projectsDir, cleanup } = setup();
  try {
    writeFileSync(join(sessionsDir, '1.json'), JSON.stringify({
      pid: 1, sessionId: 'sess-R', cwd: '/x', name: 'r', status: 'idle', updatedAt: 100,
    }));
    mkdirSync(join(projectsDir, '-x'));
    writeFileSync(join(projectsDir, '-x', 'sess-R.jsonl'),
      JSON.stringify({ type: 'system', subtype: 'away_summary', content: 'Goal: X. Next: Y.', sessionId: 'sess-R' }) + '\n');

    const result = readAllSessions(sessionsDir, { now: 200, isPidAlive: () => true, projectsDir });
    assert.equal(result[0].recap, 'Goal: X. Next: Y.');
  } finally { cleanup(); }
});

test('readAllSessions sets recap to null when transcript has none', () => {
  const { sessionsDir, projectsDir, cleanup } = setup();
  try {
    writeFileSync(join(sessionsDir, '1.json'), JSON.stringify({
      pid: 1, sessionId: 'sess-N', cwd: '/x', name: 'n', status: 'idle', updatedAt: 100,
    }));
    mkdirSync(join(projectsDir, '-x'));
    writeFileSync(join(projectsDir, '-x', 'sess-N.jsonl'),
      JSON.stringify({ type: 'assistant', message: {} }) + '\n');
    const result = readAllSessions(sessionsDir, { now: 200, isPidAlive: () => true, projectsDir });
    assert.equal(result[0].recap, null);
  } finally { cleanup(); }
});

test('readAllSessions omits recap when projectsDir not given', () => {
  const { sessionsDir, cleanup } = setup();
  try {
    writeFileSync(join(sessionsDir, '1.json'), JSON.stringify({
      pid: 1, sessionId: 'sess-X', cwd: '/x', name: 'x', status: 'idle', updatedAt: 100,
    }));
    const result = readAllSessions(sessionsDir, { now: 200, isPidAlive: () => true });
    assert.equal(result[0].recap, undefined);
  } finally { cleanup(); }
});
