import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLatestPermissionMode } from '../../../scripts/claude-monitor/lib/sessions.mjs';

test('findLatestPermissionMode returns null when no events present', () => {
  const text = '{"type":"user","message":{"content":"hi"}}\n{"type":"assistant","message":{}}\n';
  assert.equal(findLatestPermissionMode(text), null);
});

test('findLatestPermissionMode returns null for empty input', () => {
  assert.equal(findLatestPermissionMode(''), null);
});

test('findLatestPermissionMode returns the only event when one exists', () => {
  const text = '{"type":"permission-mode","permissionMode":"acceptEdits","sessionId":"x"}\n';
  assert.equal(findLatestPermissionMode(text), 'acceptEdits');
});

test('findLatestPermissionMode returns the LAST event among many', () => {
  const text = [
    '{"type":"permission-mode","permissionMode":"default","sessionId":"x"}',
    '{"type":"user","message":{"content":"hi"}}',
    '{"type":"permission-mode","permissionMode":"auto","sessionId":"x"}',
    '{"type":"assistant","message":{}}',
    '{"type":"permission-mode","permissionMode":"acceptEdits","sessionId":"x"}',
    '{"type":"user","message":{"content":"bye"}}',
  ].join('\n') + '\n';
  assert.equal(findLatestPermissionMode(text), 'acceptEdits');
});

test('findLatestPermissionMode ignores user messages mentioning permissionMode', () => {
  // A user message could embed a JSON-looking string, but it's not a top-level permission-mode event.
  const text = '{"type":"user","message":{"content":"how do I set permissionMode to auto?"}}\n';
  assert.equal(findLatestPermissionMode(text), null);
});

test('findLatestPermissionMode tolerates malformed lines', () => {
  const text = [
    'not-json',
    '{"type":"permission-mode","permissionMode":"auto","sessionId":"x"}',
    '{broken',
    '{"type":"permission-mode","permissionMode":"default","sessionId":"x"}',
  ].join('\n') + '\n';
  assert.equal(findLatestPermissionMode(text), 'default');
});
