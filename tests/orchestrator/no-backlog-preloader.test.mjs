import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('BacklogPreloader retirement', () => {
  it('the hook file is gone', () => {
    assert.equal(existsSync(join(ROOT, '.claude/hooks/BacklogPreloader.hook.sh')), false);
  });

  it('settings.local.json no longer registers it (when present — it is gitignored)', () => {
    const settings = join(ROOT, '.claude/settings.local.json');
    if (!existsSync(settings)) return; // machine-local/gitignored: absent ⇒ trivially unregistered
    const raw = readFileSync(settings, 'utf-8');
    assert.doesNotMatch(raw, /BacklogPreloader/);
  });
});
