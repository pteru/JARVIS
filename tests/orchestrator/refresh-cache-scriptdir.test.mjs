import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { installGhStub } from './helpers/gh-stub.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('refresh-backlog-cache: SCRIPT_DIR locates the module, ORCHESTRATOR_HOME drives config/cache', () => {
  it('writes the cache under an overridden ORCHESTRATOR_HOME (script found via SCRIPT_DIR)', () => {
    const home = fs.mkdtempSync(join(os.tmpdir(), 'jarvis-refresh-'));
    fs.mkdirSync(join(home, 'config', 'orchestrator'), { recursive: true });
    fs.writeFileSync(join(home, 'config/orchestrator/issue-repos.json'),
      JSON.stringify({ repos: ['o/r'], default_label: 'backlog' }));
    // At least one workspace is required — the script exits early (exit 0) if workspaces is empty
    fs.writeFileSync(join(home, 'config/orchestrator/workspaces.json'), JSON.stringify({
      workspaces: { 'strokmatic.test': { priority: 'low', path: home } },
    }));
    fs.writeFileSync(join(home, 'config/orchestrator/schedules.json'), JSON.stringify({ schedules: { daily: [] } }));
    const issues = join(home, 'issues.json');
    fs.writeFileSync(issues, JSON.stringify([
      { number: 1, title: 't', body: '', state: 'OPEN', url: 'u', updatedAt: 'x', labels: [{ name: 'backlog' }] },
    ]));
    const gh = installGhStub();
    try {
      execFileSync('bash', [join(ROOT, 'scripts/orchestrator.sh'), 'refresh-backlog-cache'], {
        encoding: 'utf-8',
        env: { ...process.env, ORCHESTRATOR_HOME: home, PATH: gh.env.PATH, GH_STUB_LOG: gh.env.GH_STUB_LOG, GH_STUB_LIST_JSON: issues },
      });
      // cache written under the OVERRIDDEN home, proving the module ran (located via SCRIPT_DIR) and used ORCHESTRATOR_HOME for the cache dir
      const cacheFile = join(home, 'data', 'backlog-cache', 'o__r.json');
      assert.ok(fs.existsSync(cacheFile), 'expected cache file under overridden ORCHESTRATOR_HOME');
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      assert.equal(cached.issues.length, 1);
    } finally {
      gh.cleanup();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
