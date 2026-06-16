import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAllSessions } from '../../../scripts/claude-monitor/lib/sessions.mjs';

test('readAllSessions attaches absolute filepath of source JSON to each session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-monitor-fp-'));
  try {
    const f = join(dir, '1.json');
    writeFileSync(f, JSON.stringify({
      pid: 1, sessionId: 'abc', cwd: '/x', name: 'a', status: 'idle', updatedAt: 1,
    }));
    const result = readAllSessions(dir, { now: 100, isPidAlive: () => true });
    assert.equal(result[0].filepath, f);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
