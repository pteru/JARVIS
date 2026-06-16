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

describe('DashboardSummary hook — backlog summary (regression: dead BACKLOG_DIR)', () => {
  it('renders the Pending Backlog Tasks section', () => {
    const out = runHook();
    assert.match(out, /-- Pending Backlog Tasks --/);
  });

  it('reports real pending counts from the curated backlogs, not an empty (none)', () => {
    const out = runHook();
    const section = out.split('-- Pending Backlog Tasks --')[1] || '';
    // backlogs/jarvis + backlogs/strokmatic hold 100+ open "- [ ]" tasks, so counts must show
    assert.match(section, /\d+ pending/, `expected "<n> pending" lines, got:\n${section.slice(0, 400)}`);
  });
});
