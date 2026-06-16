import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walkShell(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.venv', '.git'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkShell(p, acc);
    else if (e.name.endsWith('.sh')) acc.push(p);
  }
  return acc;
}

const USES_SCRIPT_DIR_PATH = /"\$\{?SCRIPT_DIR\}?\//; // builds a "$SCRIPT_DIR/..." path
const DEFINES_SCRIPT_DIR = /^[^#\n]*\bSCRIPT_DIR=/m; // a non-comment SCRIPT_DIR= assignment

describe('shell script conventions (regression: undefined $SCRIPT_DIR)', () => {
  it('every script that builds a "$SCRIPT_DIR/..." path also defines SCRIPT_DIR', () => {
    const offenders = [];
    for (const f of walkShell(join(ROOT, 'scripts'))) {
      const src = readFileSync(f, 'utf-8');
      if (USES_SCRIPT_DIR_PATH.test(src) && !DEFINES_SCRIPT_DIR.test(src)) {
        offenders.push(f.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(offenders, [], `these scripts use $SCRIPT_DIR without defining it: ${offenders.join(', ')}`);
  });

  it('the two regression-fixed scripts define SCRIPT_DIR', () => {
    for (const rel of ['scripts/fetch-open-prs.sh', 'scripts/helpers/archive-merged-reviews.sh']) {
      const src = readFileSync(join(ROOT, rel), 'utf-8');
      assert.match(src, DEFINES_SCRIPT_DIR, `${rel} must define SCRIPT_DIR before use`);
    }
  });
});
