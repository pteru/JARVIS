import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(ROOT, 'scripts/lib/prompt-builder.sh');

// Run a snippet with prompt-builder.sh sourced. Functions only — safe under set -e.
function runBash(snippet) {
  return execFileSync('bash', ['-c', `set -e\nsource ${JSON.stringify(LIB)}\n${snippet}`], { encoding: 'utf-8' });
}

function tmpTemplate(contents) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'pb-'));
  const f = join(dir, 'task-prompt.md');
  fs.writeFileSync(f, contents);
  return f;
}

describe('prompt-builder.sh', () => {
  it('substitute_template replaces {{VARS}} with multi-line, special-char values — literally', () => {
    const tmpl = tmpTemplate('WS={{WORKSPACE_NAME}}\nC={{COMPLEXITY}}\nTASK={{TASK_DESCRIPTION}}\n');
    // Mirrors the dispatch-issue case: a multi-line body with sed/awk metacharacters.
    const snippet = `TASK="GitHub issue https://github.com/x/y/issues/216

# Fix A & B | uses \\\\backslash and {{NOT_A_PLACEHOLDER}}

details"
substitute_template ${JSON.stringify(tmpl)} WORKSPACE_NAME "strokmatic.diemaster" TASK_DESCRIPTION "$TASK" COMPLEXITY "complex"`;
    const out = runBash(snippet);
    // Real substitution happened (no leftover placeholders).
    assert.doesNotMatch(out, /\{\{WORKSPACE_NAME\}\}/);
    assert.doesNotMatch(out, /\{\{TASK_DESCRIPTION\}\}/);
    assert.doesNotMatch(out, /\{\{COMPLEXITY\}\}/);
    // Values present.
    assert.match(out, /WS=strokmatic\.diemaster/);
    assert.match(out, /C=complex/);
    assert.match(out, /issues\/216/);
    // Special chars survive literally (sed/gsub would have mangled & \ |).
    assert.match(out, /Fix A & B \| uses \\backslash/);
    // An unrelated {{...}} token in the value is left untouched.
    assert.match(out, /\{\{NOT_A_PLACEHOLDER\}\}/);
    fs.rmSync(dirname(tmpl), { recursive: true, force: true });
  });

  it('build_task_prompt substitutes the 3 standard vars when a template exists', () => {
    const tmpl = tmpTemplate('[{{WORKSPACE_NAME}}|{{COMPLEXITY}}] {{TASK_DESCRIPTION}}');
    const out = runBash(`build_task_prompt ${JSON.stringify(tmpl)} "ws1" "do a thing" "simple"`);
    assert.equal(out.trim(), '[ws1|simple] do a thing');
    fs.rmSync(dirname(tmpl), { recursive: true, force: true });
  });

  it('build_task_prompt falls back to the raw task when the template is missing', () => {
    const out = runBash(`build_task_prompt "/no/such/template.md" "ws1" "raw task body" "medium"`);
    assert.equal(out.trim(), 'raw task body');
  });
});
