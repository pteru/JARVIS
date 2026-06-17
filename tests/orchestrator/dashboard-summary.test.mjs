import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function runHook() {
  try {
    return execFileSync('bash', [join(ROOT, '.claude/hooks/DashboardSummary.hook.sh')], {
      cwd: ROOT,
      env: { ...process.env, ORCHESTRATOR_HOME: ROOT },
      encoding: 'utf-8',
    });
  } catch (e) {
    // hook may exit non-zero on unrelated warnings; still assert on captured stdout
    return (e.stdout || '').toString();
  }
}

describe('DashboardSummary hook — backlog summary (GitHub Issues cache)', () => {
  it('renders the Pending Backlog Issues section', () => {
    const out = runHook();
    assert.match(out, /-- Pending Backlog Issues \(GitHub\) --/);
  });

  it('reports per-repo counts from the cache, or a refresh hint when empty', () => {
    const out = runHook();
    const section = out.split('-- Pending Backlog Issues (GitHub) --')[1] || '';
    assert.match(section, /open|refresh-backlog-cache/,
      `expected counts or a refresh hint, got:\n${section.slice(0, 400)}`);
  });
});
