import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('reports source backlog counts from GitHub Issues, not .md', () => {
  it('orchestrator.sh no longer defines resolve_backlog_path and the report funcs call backlog-source', () => {
    const src = readFileSync(join(ROOT, 'scripts/orchestrator.sh'), 'utf-8');
    assert.doesNotMatch(src, /resolve_backlog_path/, 'resolve_backlog_path should be fully removed');
    // the report backlog-summary should invoke the backlog-source CLI
    assert.match(src, /backlog-source\.mjs"? list/, 'reports must count via backlog-source list');
  });

  it('daily-report Backlog Summary reflects the GitHub Issues cache, not the local stubs', () => {
    const home = mkdtempSync(join(tmpdir(), 'jarvis-rep-'));
    try {
      // minimal config: 4 product workspaces with github remotes
      mkdirSync(join(home, 'config', 'orchestrator'), { recursive: true });
      const ws = {};
      for (const p of ['diemaster', 'spotfusion', 'visionking', 'sdk'])
        ws[`strokmatic.${p}`] = { path: join(home, p), remotes: { origin: `git@github.com:strokmatic/${p}.git` } };
      writeFileSync(join(home, 'config/orchestrator/workspaces.json'), JSON.stringify({ workspaces: ws }));
      writeFileSync(join(home, 'config/orchestrator/issue-repos.json'),
        JSON.stringify({ repos: ['strokmatic/diemaster','strokmatic/spotfusion','strokmatic/visionking','strokmatic/sdk'], default_label: 'backlog' }));
      writeFileSync(join(home, 'config/orchestrator/schedules.json'), JSON.stringify({ schedules: { daily: [] } }));
      // cache: give visionking 3 open backlog issues
      const cacheDir = join(home, 'data', 'backlog-cache');
      mkdirSync(cacheDir, { recursive: true });
      const mk = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: 't' + i, body: '', labels: ['backlog'], state: 'open', url: 'u', updatedAt: 'x' }));
      writeFileSync(join(cacheDir, 'strokmatic__visionking.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), repo: 'strokmatic/visionking', issues: mk(3) }));
      for (const p of ['diemaster','spotfusion'])
        writeFileSync(join(cacheDir, `strokmatic__${p}.json`), JSON.stringify({ fetchedAt: new Date().toISOString(), repo: `strokmatic/${p}`, issues: [] }));
      writeFileSync(join(cacheDir, 'strokmatic__sdk.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), repo: 'strokmatic/sdk', issues: mk(1) }));

      execFileSync('bash', [join(ROOT, 'scripts/orchestrator.sh'), 'daily-report'],
        { encoding: 'utf-8', env: { ...process.env, ORCHESTRATOR_HOME: home } });

      const dailyDir = join(home, 'reports', 'daily');
      const file = readdirSync(dailyDir).find(f => f.startsWith('daily-'));
      const report = readFileSync(join(dailyDir, file), 'utf-8');
      // visionking row must show 3 (from cache), not 0 (from stubs)
      assert.match(report, /visionking\s*\|\s*3\b/, `expected visionking|3 in report, got:\n${report.slice(0, 800)}`);
      assert.match(report, /sdk\s*\|\s*1\b/, `expected sdk|1 (slug-resolved) in report, got:\n${report.slice(0, 800)}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
