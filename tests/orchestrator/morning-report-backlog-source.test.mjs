import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readFileSync(join(ROOT, 'scripts/morning-report.sh'), 'utf-8');

describe('morning-report sources high-priority items from GitHub Issues, not retired .md stubs', () => {
  it('no longer reads the workspace-local .claude/backlog.md stubs', () => {
    assert.doesNotMatch(SRC, /\.claude\/backlog\.md/,
      'morning-report still references the retired workspace backlog.md stubs');
  });

  it('fetches backlog items via the backlog-source CLI', () => {
    assert.match(SRC, /backlog-source\.mjs"? list/,
      'morning-report must pull high-priority items from the GitHub Issues cache');
  });

  it('locates the module via SCRIPT_DIR (so an overridden ORCHESTRATOR_HOME only redirects config/cache)', () => {
    assert.match(SRC, /SCRIPT_DIR=/, 'morning-report must define SCRIPT_DIR');
    assert.match(SRC, /\$SCRIPT_DIR"?\/lib\/backlog-source\.mjs/,
      'morning-report must invoke backlog-source via $SCRIPT_DIR');
  });
});
