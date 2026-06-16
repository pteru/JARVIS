import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAllSessions, renderTable } from '../../../scripts/claude-monitor/lib/sessions.mjs';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'claude-monitor-int-'));
  const sessionsDir = join(root, 'sessions');
  const projectsDir = join(root, 'projects');
  mkdirSync(sessionsDir);
  mkdirSync(projectsDir);
  return { root, sessionsDir, projectsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('readAllSessions attaches permissionMode when projectsDir is given', () => {
  const { sessionsDir, projectsDir, cleanup } = setup();
  try {
    writeFileSync(join(sessionsDir, '1.json'), JSON.stringify({
      pid: 1, sessionId: 'sess-A', cwd: '/x', name: 'a', status: 'busy', updatedAt: 100,
    }));
    mkdirSync(join(projectsDir, '-x'));
    writeFileSync(join(projectsDir, '-x', 'sess-A.jsonl'),
      '{"type":"permission-mode","permissionMode":"auto","sessionId":"sess-A"}\n');

    const result = readAllSessions(sessionsDir, {
      now: 200,
      isPidAlive: () => true,
      projectsDir,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].permissionMode, 'auto');
  } finally { cleanup(); }
});

test('readAllSessions sets permissionMode to null when JSONL missing', () => {
  const { sessionsDir, projectsDir, cleanup } = setup();
  try {
    writeFileSync(join(sessionsDir, '1.json'), JSON.stringify({
      pid: 1, sessionId: 'sess-B', cwd: '/x', name: 'b', status: 'idle', updatedAt: 100,
    }));
    const result = readAllSessions(sessionsDir, {
      now: 200, isPidAlive: () => true, projectsDir,
    });
    assert.equal(result[0].permissionMode, null);
  } finally { cleanup(); }
});

test('readAllSessions omits permissionMode when projectsDir not given (back-compat)', () => {
  const { sessionsDir, cleanup } = setup();
  try {
    writeFileSync(join(sessionsDir, '1.json'), JSON.stringify({
      pid: 1, sessionId: 'sess-C', cwd: '/x', name: 'c', status: 'idle', updatedAt: 100,
    }));
    const result = readAllSessions(sessionsDir, { now: 200, isPidAlive: () => true });
    assert.equal(result[0].permissionMode, undefined);
  } finally { cleanup(); }
});

test('renderTable includes a MODE column when any session has a mode', () => {
  const sessions = [
    { name: 'one', displayStatus: 'running', waitingFor: null, cwd: '/x', ageMs: 60_000, pid: 1, permissionMode: 'auto' },
  ];
  const out = renderTable(sessions, { now: 1_000_000, home: '/home/teruel', useColor: false });
  assert.match(out, /MODE/);
  assert.match(out, /auto/);
});

test('renderTable omits MODE column when no session has a mode', () => {
  const sessions = [
    { name: 'one', displayStatus: 'running', waitingFor: null, cwd: '/x', ageMs: 60_000, pid: 1 },
  ];
  const out = renderTable(sessions, { now: 1_000_000, home: '/home/teruel', useColor: false });
  assert.doesNotMatch(out, /MODE/);
});

test('renderTable shows dash for null/undefined permissionMode', () => {
  const sessions = [
    { name: 'one', displayStatus: 'running', waitingFor: null, cwd: '/x', ageMs: 60_000, pid: 1, permissionMode: 'auto' },
    { name: 'two', displayStatus: 'idle', waitingFor: null, cwd: '/y', ageMs: 60_000, pid: 2, permissionMode: null },
  ];
  const out = renderTable(sessions, { now: 1_000_000, home: '/home/teruel', useColor: false });
  assert.match(out, /MODE/);
  assert.match(out, /auto/);
  // Dash for the null one
  assert.match(out, /two\s+idle\s+\S*\s*\S*\s*—/);
});
