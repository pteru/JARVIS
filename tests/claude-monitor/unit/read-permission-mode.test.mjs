import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPermissionModeForSession } from '../../../scripts/claude-monitor/lib/sessions.mjs';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'claude-monitor-pm-'));
  return {
    root: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('returns null when projects dir does not exist', () => {
  assert.equal(readPermissionModeForSession('/nonexistent/path/xxx', 'abc'), null);
});

test('returns null when session JSONL not found in any project dir', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-home-foo'), { recursive: true });
    mkdirSync(join(root, '-home-bar'), { recursive: true });
    assert.equal(readPermissionModeForSession(root, 'missing-id'), null);
  } finally { cleanup(); }
});

test('finds JSONL in single project dir and returns latest mode', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-home-foo'), { recursive: true });
    writeFileSync(join(root, '-home-foo', 'sess1.jsonl'), [
      '{"type":"user","message":{}}',
      '{"type":"permission-mode","permissionMode":"default","sessionId":"sess1"}',
      '{"type":"permission-mode","permissionMode":"acceptEdits","sessionId":"sess1"}',
    ].join('\n') + '\n');
    assert.equal(readPermissionModeForSession(root, 'sess1'), 'acceptEdits');
  } finally { cleanup(); }
});

test('searches across multiple project dirs', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-home-foo'), { recursive: true });
    mkdirSync(join(root, '-home-bar'), { recursive: true });
    writeFileSync(join(root, '-home-bar', 'sessX.jsonl'),
      '{"type":"permission-mode","permissionMode":"auto","sessionId":"sessX"}\n');
    assert.equal(readPermissionModeForSession(root, 'sessX'), 'auto');
  } finally { cleanup(); }
});

test('returns null when JSONL has no permission-mode events', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-home-foo'), { recursive: true });
    writeFileSync(join(root, '-home-foo', 'sessY.jsonl'),
      '{"type":"user","message":{}}\n{"type":"assistant","message":{}}\n');
    assert.equal(readPermissionModeForSession(root, 'sessY'), null);
  } finally { cleanup(); }
});

test('uses tail-read for large files (still finds last event near end)', () => {
  const { root, cleanup } = setup();
  try {
    mkdirSync(join(root, '-home-foo'), { recursive: true });
    // Build a file larger than the default tail size (1MB).
    const filler = '{"type":"user","message":{"content":"' + 'x'.repeat(200) + '"}}\n';
    const lines = [];
    for (let i = 0; i < 6000; i++) lines.push(filler); // ~1.4MB
    lines.push('{"type":"permission-mode","permissionMode":"auto","sessionId":"big"}');
    writeFileSync(join(root, '-home-foo', 'big.jsonl'), lines.join(''));
    assert.equal(readPermissionModeForSession(root, 'big'), 'auto');
  } finally { cleanup(); }
});
