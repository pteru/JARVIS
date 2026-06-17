import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readFileSync(join(ROOT, 'scripts/task-dispatcher.sh'), 'utf-8');

// task-dispatcher.sh builds the prompt via the shared prompt-builder.sh lib
// (multi-line/special-char-safe bash substitution). The actual substitution
// behavior is covered by prompt-builder.test.mjs; this guards the wiring so the
// dispatcher can never silently regress to a hand-rolled (sed/awk) substitution.
describe('task-dispatcher.sh wires prompt substitution through prompt-builder.sh', () => {
  it('sources prompt-builder.sh via $SCRIPT_DIR and builds the prompt with build_task_prompt', () => {
    assert.match(SRC, /source\s+"?\$SCRIPT_DIR\/lib\/prompt-builder\.sh/,
      'task-dispatcher.sh must source the shared prompt-builder lib');
    assert.match(SRC, /\bbuild_task_prompt\b/,
      'task-dispatcher.sh must build the prompt via build_task_prompt');
  });

  it('no longer hand-rolls the awk literal-splice substitution', () => {
    assert.doesNotMatch(SRC, /function lit\(/, 'the awk lit() splice should be gone');
    assert.doesNotMatch(SRC, /ENVIRON\["TASK_DESCRIPTION"\]/, 'the awk ENVIRON substitution should be gone');
  });
});
