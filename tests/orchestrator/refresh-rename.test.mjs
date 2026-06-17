import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('process_backlogs hard rename → refresh_backlog_cache', () => {
  it('orchestrator.sh defines refresh_backlog_cache and the refresh-backlog-cache mode', () => {
    const src = readFileSync(join(ROOT, 'scripts/orchestrator.sh'), 'utf-8');
    assert.match(src, /refresh_backlog_cache\(\)/);
    assert.match(src, /refresh-backlog-cache\)/);
  });

  it('no live caller references the old process[-_]backlogs name', () => {
    for (const rel of ['scripts/orchestrator.sh', 'config/orchestrator/schedules.json']) {
      const src = readFileSync(join(ROOT, rel), 'utf-8');
      assert.doesNotMatch(src, /process[-_]backlogs/, `${rel} still references process-backlogs`);
    }
  });

  it('schedules.json daily task is refresh_backlog_cache', () => {
    const s = JSON.parse(readFileSync(join(ROOT, 'config/orchestrator/schedules.json'), 'utf-8'));
    assert.ok((s.schedules?.daily || []).some(e => e.task === 'refresh_backlog_cache'));
  });
});
