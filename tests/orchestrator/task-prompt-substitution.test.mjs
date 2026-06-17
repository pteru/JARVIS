import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TASK_DISPATCHER = join(ROOT, 'scripts/task-dispatcher.sh');
const TEMPLATE = join(ROOT, 'prompts/templates/task-prompt.md');

// Regression for the sed→awk fix: task-dispatcher.sh must substitute a
// multi-line task (with sed/awk metacharacters) into the prompt template
// without crashing. The old `sed -e "s|{{TASK_DESCRIPTION}}|$TASK|g"` aborted
// with "command 's' not terminated" the moment $TASK contained a newline.
// We extract the substitution block from the script and run it in isolation so
// the test never has to invoke Claude.
function extractSubstitution() {
  const src = fs.readFileSync(TASK_DISPATCHER, 'utf-8');
  const start = src.indexOf('PROMPT_TEMPLATE=');
  assert.ok(start !== -1, 'PROMPT_TEMPLATE assignment not found in task-dispatcher.sh');
  const fiMarker = '\nfi\n';
  const end = src.indexOf(fiMarker, start);
  assert.ok(end !== -1, 'end of substitution block not found');
  return src.slice(start, end + fiMarker.length);
}

describe('task-dispatcher.sh prompt substitution', () => {
  it('splices a multi-line task with special chars into the template without crashing', () => {
    const block = extractSubstitution();
    const script = `set -e
ORCHESTRATOR_HOME=${JSON.stringify(ROOT)}
WORKSPACE="strokmatic.diemaster"
COMPLEXITY="complex"
TASK="GitHub issue https://github.com/x/y/issues/216

# Fix A & B | uses \\\\backslash and {{NOT_A_PLACEHOLDER}}

details"
${block}
printf '%s' "$FULL_PROMPT"
`;
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf-8' });

    // Placeholders are gone (no crash, real substitution happened).
    assert.doesNotMatch(out, /\{\{WORKSPACE_NAME\}\}/);
    assert.doesNotMatch(out, /\{\{TASK_DESCRIPTION\}\}/);
    assert.doesNotMatch(out, /\{\{COMPLEXITY\}\}/);
    // Substituted values are present.
    assert.match(out, /strokmatic\.diemaster/);
    assert.match(out, /issues\/216/);
    assert.match(out, /complex/);
    // Special chars survive literally (gsub & / \ would have mangled these).
    assert.match(out, /Fix A & B \| uses \\backslash/);
    // An unrelated {{...}} token in the task text is left untouched.
    assert.match(out, /\{\{NOT_A_PLACEHOLDER\}\}/);
  });
});
