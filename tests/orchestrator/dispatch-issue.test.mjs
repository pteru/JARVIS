import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('orchestrator.sh dispatch-issue --dry-run', () => {
  it('resolves workspace + complexity from a stubbed gh issue and prints the task-dispatcher invocation', () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'di-gh-'));
    fs.writeFileSync(join(dir, 'gh'), `#!/usr/bin/env bash
echo '{"title":"Fix the thing","body":"details","url":"https://github.com/strokmatic/diemaster/issues/216","labels":[{"name":"backlog"},{"name":"complex"}]}'
`, { mode: 0o755 });
    try {
      const out = execFileSync('bash', [join(ROOT, 'scripts/orchestrator.sh'), 'dispatch-issue', 'strokmatic.diemaster', '216', '--dry-run'],
        { encoding: 'utf-8', env: { ...process.env, ORCHESTRATOR_HOME: ROOT, PATH: `${dir}:${process.env.PATH}` } });
      assert.match(out, /strokmatic\.diemaster/);
      assert.match(out, /complex/);
      assert.match(out, /task-dispatcher\.sh/);
      assert.match(out, /issues\/216/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
