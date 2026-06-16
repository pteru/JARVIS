import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renameSessionFile } from '../../../scripts/claude-monitor/lib/sessions.mjs';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'claude-monitor-rn-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('renameSessionFile updates the name and preserves other fields', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, '1.json');
    writeFileSync(p, JSON.stringify({
      pid: 1, sessionId: 'abc', cwd: '/x', name: 'old', status: 'idle', updatedAt: 1, version: '2.1.0',
    }));
    renameSessionFile(p, 'new-name');
    const after = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(after.name, 'new-name');
    assert.equal(after.pid, 1);
    assert.equal(after.sessionId, 'abc');
    assert.equal(after.cwd, '/x');
    assert.equal(after.status, 'idle');
    assert.equal(after.updatedAt, 1);
    assert.equal(after.version, '2.1.0');
  } finally { cleanup(); }
});

test('renameSessionFile sets name on a file with no prior name', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, '1.json');
    writeFileSync(p, JSON.stringify({ pid: 1, sessionId: 'abc', cwd: '/x' }));
    renameSessionFile(p, 'fresh');
    const after = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(after.name, 'fresh');
  } finally { cleanup(); }
});

test('renameSessionFile throws when file does not exist', () => {
  assert.throws(() => renameSessionFile('/nonexistent/path/xyz.json', 'foo'));
});

test('renameSessionFile throws when file content is invalid JSON', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, '1.json');
    writeFileSync(p, 'not json{');
    assert.throws(() => renameSessionFile(p, 'foo'));
  } finally { cleanup(); }
});

test('renameSessionFile rejects empty/whitespace name', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, '1.json');
    writeFileSync(p, JSON.stringify({ pid: 1, sessionId: 'abc', cwd: '/x', name: 'old' }));
    assert.throws(() => renameSessionFile(p, ''));
    assert.throws(() => renameSessionFile(p, '   '));
    // Original name unchanged
    const after = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(after.name, 'old');
  } finally { cleanup(); }
});

test('renameSessionFile trims surrounding whitespace from new name', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, '1.json');
    writeFileSync(p, JSON.stringify({ pid: 1, sessionId: 'abc', cwd: '/x', name: 'old' }));
    renameSessionFile(p, '  spaced  ');
    const after = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(after.name, 'spaced');
  } finally { cleanup(); }
});
