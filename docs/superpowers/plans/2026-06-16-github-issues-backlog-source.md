# GitHub Issues as Backlog Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the JARVIS orchestrator's backlog consumers (dispatch loop, dashboard hook, `backlog-manager` MCP) from local `backlogs/**/*.md` to GitHub Issues, with a cached read layer and explicit manual-only dispatch.

**Architecture:** A single deep module `scripts/lib/backlog-source.mjs` wraps `gh` + a per-repo JSON cache + workspace→repo resolution, exposing both an importable API (for the node MCP) and a CLI (for shell callers). The cron stops auto-dispatching and instead refreshes the cache; the dashboard reads the cache; the MCP `add`/`complete` tools create/close issues via `gh`; `sync_backlog` and the `BacklogPreloader` hook are retired; a new `orchestrator.sh dispatch-issue` is the explicit manual trigger.

**Tech Stack:** Node 20 ESM (`node --test`), Bash, GitHub CLI (`gh`, already authed as `teruelskm`), JSON config.

**Spec:** `docs/superpowers/specs/2026-06-16-github-issues-backlog-source-design.md`

**Conventions for every commit in this plan:**
- Branch is `develop` (verify with `git branch --show-current`).
- Scan staged files for credentials before `git add` (none expected here).
- Stage only the exact paths listed; never `git add -A`.
- End commit messages with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Run the full suite with `npm test` (`node --test tests/`); it must stay green.

---

## File structure

**Create**
- `config/orchestrator/issue-repos.json` — pinned list of the 10 issue-bearing repos + default label.
- `scripts/lib/backlog-source.mjs` — the deep module (import API + CLI). Owns all `gh`/cache/resolution logic.
- `tests/orchestrator/helpers/gh-stub.mjs` — test helper that installs a fake `gh` on `PATH` and records argv.
- `tests/orchestrator/backlog-source.test.mjs` — unit + integration tests for the module.
- `tests/orchestrator/dispatch-issue.test.mjs` — `dispatch-issue --dry-run` argv test.

**Modify**
- `scripts/lib/config.sh` — add `BACKLOG_CACHE_DIR`.
- `.gitignore` — ignore `data/backlog-cache/`.
- `mcp-servers/backlog-manager/index.js` — rewrite `list`/`add`/`complete` over `backlog-source`; delete `sync_backlog` + merge/baseline/push helpers.
- `mcp-servers/backlog-manager/.claude/context.md` — tool descriptions.
- `.claude/hooks/DashboardSummary.hook.sh` — backlog section reads the cache.
- `tests/orchestrator/dashboard-summary.test.mjs` — assert the new section.
- `scripts/orchestrator.sh` — hard-rename `process_backlogs` → `refresh_backlog_cache`; add `dispatch-issue`; update `daily)` + usage.
- `config/orchestrator/schedules.json` — `process_backlogs` → `refresh_backlog_cache`.
- `.claude/settings.local.json` — remove the two `BacklogPreloader` registrations.
- `README.md`, `docs/SKILLS.md` — tool/hook descriptions.

**Delete**
- `.claude/hooks/BacklogPreloader.hook.sh`

**Live-system deploy action (not a repo file)**
- crontab line `orchestrator.sh process-backlogs` → `refresh-backlog-cache`.

---

## Task 1: Scaffolding — config, gitignore, cache dir variable

**Files:**
- Create: `config/orchestrator/issue-repos.json`
- Modify: `.gitignore`
- Modify: `scripts/lib/config.sh`

- [ ] **Step 1: Create the pinned repo list**

Create `config/orchestrator/issue-repos.json`:

```json
{
  "repos": [
    "strokmatic/visionking",
    "strokmatic/spotfusion",
    "strokmatic/diemaster",
    "strokmatic/sdk",
    "strokmatic/sdk-observability-stack",
    "strokmatic/sdk-message-poster",
    "strokmatic/strokmatic-eip",
    "strokmatic/infra",
    "strokmatic/sdk-agent-standards",
    "pteru/JARVIS"
  ],
  "default_label": "backlog"
}
```

- [ ] **Step 2: Ignore the cache directory**

Append to `.gitignore` (after the existing `data/` block, near line 128):

```
data/backlog-cache/
```

- [ ] **Step 3: Add the cache dir variable for shell callers**

In `scripts/lib/config.sh`, immediately after the line `JARVIS_BACKLOG_DIR="${ORCHESTRATOR_HOME}/backlogs/jarvis"`, add:

```bash
BACKLOG_CACHE_DIR="${ORCHESTRATOR_HOME}/data/backlog-cache"
```

- [ ] **Step 4: Verify JSON parses**

Run: `node -e "console.log(require('./config/orchestrator/issue-repos.json').repos.length)"`
Expected: `10`

- [ ] **Step 5: Commit**

```bash
git add config/orchestrator/issue-repos.json .gitignore scripts/lib/config.sh
git commit -m "feat(backlog): scaffold issue-repos config + backlog-cache ignore/var

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `backlog-source.mjs` — repo resolution

**Files:**
- Create: `scripts/lib/backlog-source.mjs`
- Test: `tests/orchestrator/backlog-source.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/backlog-source.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemote, resolveRepo, configuredRepos } from '../../scripts/lib/backlog-source.mjs';

describe('backlog-source · repo resolution', () => {
  it('parses an ssh remote', () => {
    assert.deepEqual(parseRemote('git@github.com:strokmatic/diemaster.git'),
      { owner: 'strokmatic', repo: 'diemaster', slug: 'strokmatic/diemaster' });
  });

  it('parses an https remote (with and without .git)', () => {
    assert.equal(parseRemote('https://github.com/strokmatic/infra.git').slug, 'strokmatic/infra');
    assert.equal(parseRemote('https://github.com/strokmatic/infra').slug, 'strokmatic/infra');
  });

  it('returns null for a non-github or empty remote', () => {
    assert.equal(parseRemote(''), null);
    assert.equal(parseRemote('git@gitlab.com:x/y.git'), null);
  });

  it('resolves the orchestrator workspace to pteru/JARVIS', async () => {
    assert.equal((await resolveRepo('orchestrator')).slug, 'pteru/JARVIS');
  });

  it('accepts an owner/repo slug verbatim', async () => {
    assert.equal((await resolveRepo('strokmatic/visionking')).slug, 'strokmatic/visionking');
  });

  it('resolves a real workspace via workspaces.json remotes.origin', async () => {
    assert.equal((await resolveRepo('strokmatic.diemaster')).slug, 'strokmatic/diemaster');
  });

  it('lists the 10 configured repos', async () => {
    assert.equal((await configuredRepos()).length, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/orchestrator/backlog-source.test.mjs`
Expected: FAIL — `Cannot find module '../../scripts/lib/backlog-source.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/backlog-source.mjs`:

```js
#!/usr/bin/env node
/**
 * backlog-source — single source of GitHub-Issues logic for the JARVIS orchestrator.
 * Used both as an importable API (by the backlog-manager MCP) and as a CLI (by shell).
 * Wraps the `gh` CLI + a per-repo JSON cache + workspace→repo resolution.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, 'JARVIS');
const CACHE_DIR = path.join(ORCHESTRATOR_HOME, 'data', 'backlog-cache');
const CONFIG_DIR = path.join(ORCHESTRATOR_HOME, 'config', 'orchestrator');
const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_LABEL = 'backlog';

export function parseRemote(remoteUrl) {
  if (!remoteUrl) return null;
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], slug: `${m[1]}/${m[2]}` };
}

export async function resolveRepo(workspace) {
  if (workspace === 'orchestrator') return { owner: 'pteru', repo: 'JARVIS', slug: 'pteru/JARVIS' };
  if (/^[^/\s]+\/[^/\s]+$/.test(workspace)) {
    const [owner, repo] = workspace.split('/');
    return { owner, repo, slug: `${owner}/${repo}` };
  }
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'workspaces.json'), 'utf-8'));
    return parseRemote(cfg.workspaces?.[workspace]?.remotes?.origin);
  } catch {
    return null;
  }
}

export async function configuredRepos() {
  const cfg = JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'issue-repos.json'), 'utf-8'));
  return cfg.repos || [];
}

/** Find the workspace key whose remotes.origin matches a given owner/repo slug. */
export async function resolveWorkspaceByRepo(slug) {
  if (slug === 'pteru/JARVIS') return 'orchestrator';
  const cfg = JSON.parse(await fs.readFile(path.join(CONFIG_DIR, 'workspaces.json'), 'utf-8'));
  const matches = Object.entries(cfg.workspaces || {})
    .filter(([, w]) => parseRemote(w.remotes?.origin)?.slug === slug)
    .map(([k]) => k);
  return matches[0] || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/orchestrator/backlog-source.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/backlog-source.mjs tests/orchestrator/backlog-source.test.mjs
git commit -m "feat(backlog): backlog-source repo resolution (parseRemote/resolveRepo)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `backlog-source.mjs` — cache + refresh + listIssues (stubbed gh)

**Files:**
- Create: `tests/orchestrator/helpers/gh-stub.mjs`
- Modify: `scripts/lib/backlog-source.mjs`
- Modify: `tests/orchestrator/backlog-source.test.mjs`

- [ ] **Step 1: Write the gh stub helper**

Create `tests/orchestrator/helpers/gh-stub.mjs`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Installs a fake `gh` on PATH that records argv and emits canned output.
 * Returns { dir, logFile, env, readArgs(), cleanup() }.
 * Control the stub via the returned env object (merge into process.env or child env):
 *   GH_STUB_LIST_JSON  — file path whose contents are emitted for `gh issue list`
 *   GH_STUB_CREATE_URL — URL emitted for `gh issue create`
 *   GH_STUB_EXIT       — exit code (default 0; use 1 to simulate failure)
 */
export function installGhStub(prefix = 'gh-stub-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const logFile = path.join(dir, 'argv.log');
  const ghPath = path.join(dir, 'gh');
  fs.writeFileSync(ghPath, `#!/usr/bin/env bash
{ for a in "$@"; do printf '%s\\n' "$a"; done; echo '==='; } >> "\${GH_STUB_LOG}"
sub="$1 $2"
case "$sub" in
  "issue list")   if [[ -n "\${GH_STUB_LIST_JSON:-}" ]]; then cat "\${GH_STUB_LIST_JSON}"; else echo '[]'; fi ;;
  "issue create") echo "\${GH_STUB_CREATE_URL:-https://github.com/o/r/issues/1}" ;;
  *) : ;;
esac
exit "\${GH_STUB_EXIT:-0}"
`, { mode: 0o755 });
  const env = { GH_STUB_LOG: logFile, PATH: `${dir}:${process.env.PATH}` };
  return {
    dir, logFile, env,
    readArgs() {
      if (!fs.existsSync(logFile)) return [];
      return fs.readFileSync(logFile, 'utf-8').split('===\n').map(s => s.trim().split('\n').filter(Boolean)).filter(a => a.length);
    },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/orchestrator/backlog-source.test.mjs`:

```js
import { refreshCache, listIssues } from '../../scripts/lib/backlog-source.mjs';
import { installGhStub } from './helpers/gh-stub.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function withTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-home-'));
  fs.mkdirSync(path.join(home, 'config', 'orchestrator'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config', 'orchestrator', 'issue-repos.json'),
    JSON.stringify({ repos: ['o/r'], default_label: 'backlog' }));
  fs.writeFileSync(path.join(home, 'config', 'orchestrator', 'workspaces.json'),
    JSON.stringify({ workspaces: {} }));
  return home;
}

const SAMPLE = JSON.stringify([
  { number: 7, title: 'Do a thing', body: 'b', state: 'OPEN', url: 'https://github.com/o/r/issues/7',
    updatedAt: '2026-06-16T00:00:00Z', labels: [{ name: 'backlog' }, { name: 'complex' }] },
]);

describe('backlog-source · cache + listIssues', () => {
  it('refreshes the cache from gh and lists issues with flattened labels', async () => {
    const home = withTempHome();
    const issuesJson = path.join(home, 'issues.json');
    fs.writeFileSync(issuesJson, SAMPLE);
    const gh = installGhStub();
    const prevHome = process.env.ORCHESTRATOR_HOME, prevPath = process.env.PATH;
    process.env.ORCHESTRATOR_HOME = home;
    process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    process.env.GH_STUB_LIST_JSON = issuesJson;
    try {
      const res = await refreshCache(['o/r']);
      assert.deepEqual(res, [{ repo: 'o/r', count: 1 }]);
      const issues = await listIssues('o/r', { refresh: 'never' });
      assert.equal(issues.length, 1);
      assert.deepEqual(issues[0].labels, ['backlog', 'complex']);
      // gh was invoked with the expected list args
      const argv = gh.readArgs().find(a => a[0] === 'issue' && a[1] === 'list');
      assert.ok(argv.includes('--repo') && argv.includes('o/r') && argv.includes('--label') && argv.includes('backlog'));
    } finally {
      process.env.ORCHESTRATOR_HOME = prevHome; process.env.PATH = prevPath;
      delete process.env.GH_STUB_LIST_JSON; gh.cleanup();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('serves stale cache when gh fails (refresh never throws on read)', async () => {
    const home = withTempHome();
    const cacheDir = path.join(home, 'data', 'backlog-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'o__r.json'),
      JSON.stringify({ fetchedAt: '2000-01-01T00:00:00Z', repo: 'o/r',
        issues: [{ number: 1, title: 'old', body: '', labels: ['backlog'], state: 'open', url: 'u', updatedAt: 'x' }] }));
    const gh = installGhStub();
    const prevHome = process.env.ORCHESTRATOR_HOME, prevPath = process.env.PATH;
    process.env.ORCHESTRATOR_HOME = home;
    process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    process.env.GH_STUB_EXIT = '1'; // gh fails
    try {
      const issues = await listIssues('o/r', { refresh: 'if-stale' });
      assert.equal(issues.length, 1);
      assert.equal(issues[0].title, 'old');
    } finally {
      process.env.ORCHESTRATOR_HOME = prevHome; process.env.PATH = prevPath;
      delete process.env.GH_STUB_EXIT; gh.cleanup();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/orchestrator/backlog-source.test.mjs`
Expected: FAIL — `refreshCache`/`listIssues` are not exported

- [ ] **Step 4: Implement cache + refresh + listIssues**

Add to `scripts/lib/backlog-source.mjs` (after `resolveWorkspaceByRepo`):

```js
function cacheFile(slug) {
  return path.join(CACHE_DIR, slug.replace('/', '__') + '.json');
}

function normalizeIssue(i) {
  return {
    number: i.number,
    title: i.title,
    body: i.body ?? '',
    labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    state: (i.state || 'open').toLowerCase(),
    url: i.url,
    updatedAt: i.updatedAt,
  };
}

async function readCache(slug) {
  try {
    return JSON.parse(await fs.readFile(cacheFile(slug), 'utf-8'));
  } catch {
    return null;
  }
}

/** Pull open backlog issues for each repo into the cache. Never throws; per-repo errors are reported. */
export async function refreshCache(repos, { label = DEFAULT_LABEL } = {}) {
  const list = repos && repos.length ? repos : await configuredRepos();
  const out = [];
  await fs.mkdir(CACHE_DIR, { recursive: true });
  for (const slug of list) {
    try {
      const { stdout } = await execFileAsync('gh', [
        'issue', 'list', '--repo', slug, '--label', label, '--state', 'open',
        '--limit', '200', '--json', 'number,title,body,labels,state,url,updatedAt',
      ]);
      const issues = JSON.parse(stdout).map(normalizeIssue);
      await fs.writeFile(cacheFile(slug),
        JSON.stringify({ fetchedAt: new Date().toISOString(), repo: slug, issues }, null, 2));
      out.push({ repo: slug, count: issues.length });
    } catch (e) {
      out.push({ repo: slug, count: null, error: e.message.split('\n')[0] });
    }
  }
  return out;
}

/**
 * List cached issues for a workspace/repo.
 * refresh: 'if-stale' (default) refreshes when cache older than TTL and gh is reachable;
 *          'never' is cache-only (used by the dashboard session hook — never blocks on network).
 */
export async function listIssues(workspace, { label = DEFAULT_LABEL, state = 'open', refresh = 'if-stale' } = {}) {
  const r = await resolveRepo(workspace);
  if (!r) return [];
  let cached = await readCache(r.slug);
  const stale = !cached || Date.now() - new Date(cached.fetchedAt).getTime() > TTL_MS;
  if (refresh === 'if-stale' && stale) {
    const res = await refreshCache([r.slug], { label });
    if (!res[0]?.error) cached = await readCache(r.slug);
  }
  let issues = cached?.issues || [];
  if (label) issues = issues.filter((i) => i.labels.includes(label));
  if (state && state !== 'all') issues = issues.filter((i) => i.state === state.toLowerCase());
  return issues;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/orchestrator/backlog-source.test.mjs`
Expected: PASS (all backlog-source tests)

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/backlog-source.mjs tests/orchestrator/backlog-source.test.mjs tests/orchestrator/helpers/gh-stub.mjs
git commit -m "feat(backlog): backlog-source cache + refresh + listIssues (stale-tolerant)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `backlog-source.mjs` — createIssue + closeIssue (stubbed gh)

**Files:**
- Modify: `scripts/lib/backlog-source.mjs`
- Modify: `tests/orchestrator/backlog-source.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/orchestrator/backlog-source.test.mjs`:

```js
import { createIssue, closeIssue } from '../../scripts/lib/backlog-source.mjs';

describe('backlog-source · createIssue/closeIssue', () => {
  it('ensures labels then creates an issue and returns number+url', async () => {
    const home = withTempHome();
    const gh = installGhStub();
    const prev = { home: process.env.ORCHESTRATOR_HOME, path: process.env.PATH };
    process.env.ORCHESTRATOR_HOME = home;
    process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    process.env.GH_STUB_CREATE_URL = 'https://github.com/o/r/issues/42';
    try {
      const res = await createIssue('o/r', { title: 'T', body: 'B', labels: ['backlog', 'medium'] });
      assert.deepEqual(res, { number: 42, url: 'https://github.com/o/r/issues/42' });
      const argv = gh.readArgs();
      assert.ok(argv.some(a => a[0] === 'label' && a[1] === 'create' && a.includes('backlog')));
      const create = argv.find(a => a[0] === 'issue' && a[1] === 'create');
      assert.ok(create.includes('--title') && create.includes('T') && create.includes('--label') && create.includes('backlog'));
    } finally {
      process.env.ORCHESTRATOR_HOME = prev.home; process.env.PATH = prev.path;
      delete process.env.GH_STUB_CREATE_URL; gh.cleanup();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('closes an issue with a comment', async () => {
    const home = withTempHome();
    const gh = installGhStub();
    const prev = { home: process.env.ORCHESTRATOR_HOME, path: process.env.PATH };
    process.env.ORCHESTRATOR_HOME = home;
    process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    try {
      const res = await closeIssue('o/r', { number: 7, comment: 'done' });
      assert.equal(res.number, 7);
      const close = gh.readArgs().find(a => a[0] === 'issue' && a[1] === 'close');
      assert.ok(close.includes('7') && close.includes('--comment') && close.includes('done'));
    } finally {
      process.env.ORCHESTRATOR_HOME = prev.home; process.env.PATH = prev.path;
      gh.cleanup(); fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/orchestrator/backlog-source.test.mjs`
Expected: FAIL — `createIssue`/`closeIssue` not exported

- [ ] **Step 3: Implement createIssue + closeIssue**

Add to `scripts/lib/backlog-source.mjs`:

```js
/** Best-effort: ensure a label exists without resetting its color (ignore "already exists"). */
async function ensureLabel(slug, label) {
  try {
    await execFileAsync('gh', ['label', 'create', label, '--repo', slug]);
  } catch {
    /* already exists or insufficient perms — non-fatal */
  }
}

export async function createIssue(workspace, { title, body = '', labels = [] }) {
  const r = await resolveRepo(workspace);
  if (!r) throw new Error(`Cannot resolve repo for workspace "${workspace}"`);
  for (const lbl of labels) await ensureLabel(r.slug, lbl);
  const args = ['issue', 'create', '--repo', r.slug, '--title', title, '--body', body];
  for (const lbl of labels) args.push('--label', lbl);
  const { stdout } = await execFileAsync('gh', args);
  const url = stdout.trim().split('\n').filter(Boolean).pop();
  const number = Number(url.match(/\/(\d+)$/)?.[1]) || null;
  await refreshCache([r.slug]);
  return { number, url };
}

export async function closeIssue(workspace, { number, comment } = {}) {
  const r = await resolveRepo(workspace);
  if (!r) throw new Error(`Cannot resolve repo for workspace "${workspace}"`);
  const args = ['issue', 'close', String(number), '--repo', r.slug];
  if (comment) args.push('--comment', comment);
  await execFileAsync('gh', args);
  await refreshCache([r.slug]);
  return { number: Number(number), url: `https://github.com/${r.slug}/issues/${number}` };
}
```

Note: `createIssue` calls `refreshCache([slug])` which invokes `gh issue list`; the stub serves `[]` for it, which is fine — the test asserts the create argv, not the post-refresh cache.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/orchestrator/backlog-source.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/backlog-source.mjs tests/orchestrator/backlog-source.test.mjs
git commit -m "feat(backlog): backlog-source createIssue/closeIssue via gh

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `backlog-source.mjs` — CLI surface

**Files:**
- Modify: `scripts/lib/backlog-source.mjs`
- Modify: `tests/orchestrator/backlog-source.test.mjs`

- [ ] **Step 1: Write the failing test (CLI via child process)**

Append to `tests/orchestrator/backlog-source.test.mjs`:

```js
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODULE = fileURLToPath(new URL('../../scripts/lib/backlog-source.mjs', import.meta.url));

describe('backlog-source · CLI', () => {
  it('resolve-repo prints the slug', () => {
    const out = execFileSync('node', [MODULE, 'resolve-repo', 'strokmatic/visionking'], { encoding: 'utf-8' });
    assert.equal(out.trim(), 'strokmatic/visionking');
  });

  it('list --json reads the cache and prints issues', () => {
    const home = withTempHome();
    const cacheDir = path.join(home, 'data', 'backlog-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'o__r.json'),
      JSON.stringify({ fetchedAt: new Date().toISOString(), repo: 'o/r',
        issues: [{ number: 3, title: 'cli', body: '', labels: ['backlog'], state: 'open', url: 'u', updatedAt: 'x' }] }));
    try {
      const out = execFileSync('node', [MODULE, 'list', 'o/r', '--json'],
        { encoding: 'utf-8', env: { ...process.env, ORCHESTRATOR_HOME: home } });
      const parsed = JSON.parse(out);
      assert.equal(parsed[0].number, 3);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/orchestrator/backlog-source.test.mjs`
Expected: FAIL — CLI prints nothing / unknown command (module has no entrypoint yet)

- [ ] **Step 3: Implement the CLI entrypoint**

Append to the end of `scripts/lib/backlog-source.mjs`:

```js
// ---------------------------------------------------------------------------
// CLI surface (used by shell callers). Importers never reach this.
// ---------------------------------------------------------------------------
function parseFlags(argv) {
  const flags = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { flags[key] = argv[++i]; }
      else flags[key] = true;
    } else positional.push(argv[i]);
  }
  return { flags, positional };
}

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  switch (cmd) {
    case 'resolve-repo': {
      const r = await resolveRepo(positional[0]);
      if (!r) { console.error(`No GitHub repo for "${positional[0]}"`); process.exit(2); }
      console.log(r.slug); break;
    }
    case 'refresh': {
      const res = await refreshCache(positional.length ? positional : undefined);
      for (const r of res) console.log(`${r.repo}: ${r.error ? 'ERROR ' + r.error : r.count + ' open'}`);
      break;
    }
    case 'list': {
      const issues = await listIssues(positional[0], {
        label: flags.label ?? 'backlog',
        state: flags.state ?? 'open',
        refresh: 'never',
      });
      if (flags.json) console.log(JSON.stringify(issues, null, 2));
      else for (const i of issues) console.log(`#${i.number}\t${i.title}\t[${i.labels.join(',')}]\t${i.url}`);
      break;
    }
    case 'create': {
      const res = await createIssue(positional[0], {
        title: flags.title, body: flags.body ?? '',
        labels: (flags.labels ? String(flags.labels).split(',') : []).filter(Boolean),
      });
      console.log(res.url); break;
    }
    case 'close': {
      const res = await closeIssue(positional[0], { number: positional[1], comment: flags.comment });
      console.log(res.url); break;
    }
    default:
      console.error(`Usage: backlog-source <resolve-repo|refresh|list|create|close> ...`);
      process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  cli(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/orchestrator/backlog-source.test.mjs`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (all prior tests + new backlog-source tests)

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/backlog-source.mjs tests/orchestrator/backlog-source.test.mjs
git commit -m "feat(backlog): backlog-source CLI (resolve-repo/refresh/list/create/close)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Rewire the `backlog-manager` MCP

**Files:**
- Modify: `mcp-servers/backlog-manager/index.js`
- Create: `tests/mcp-servers/lib/backlog-manager-issues.test.mjs`

The MCP keeps its 3 public tools `list_backlog_tasks` / `add_backlog_task` / `complete_backlog_task` but routes them through `backlog-source`. `sync_backlog` is removed. To keep the methods unit-testable, refactor the three handlers into pure-ish functions that call the importable API.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-servers/lib/backlog-manager-issues.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installGhStub } from '../../orchestrator/helpers/gh-stub.mjs';
import { listTasks, addTask, completeTask } from '../../../mcp-servers/backlog-manager/issues.mjs';

function tmpHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-home-'));
  fs.mkdirSync(path.join(home, 'config', 'orchestrator'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config', 'orchestrator', 'issue-repos.json'), JSON.stringify({ repos: ['o/r'] }));
  fs.writeFileSync(path.join(home, 'config', 'orchestrator', 'workspaces.json'), JSON.stringify({ workspaces: {} }));
  const cacheDir = path.join(home, 'data', 'backlog-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'o__r.json'), JSON.stringify({
    fetchedAt: new Date().toISOString(), repo: 'o/r',
    issues: [{ number: 5, title: 'Existing task', body: '', labels: ['backlog', 'simple'], state: 'open', url: 'u', updatedAt: 'x' }],
  }));
  return home;
}

describe('backlog-manager · issue-backed handlers', () => {
  it('list returns cached open issues as task objects', async () => {
    const home = tmpHome();
    const prev = process.env.ORCHESTRATOR_HOME; process.env.ORCHESTRATOR_HOME = home;
    try {
      const tasks = await listTasks('o/r');
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].number, 5);
      assert.equal(tasks[0].complexity, 'simple');
    } finally { process.env.ORCHESTRATOR_HOME = prev; fs.rmSync(home, { recursive: true, force: true }); }
  });

  it('add creates an issue with backlog + complexity labels', async () => {
    const home = tmpHome();
    const gh = installGhStub();
    const prev = { home: process.env.ORCHESTRATOR_HOME, path: process.env.PATH };
    process.env.ORCHESTRATOR_HOME = home; process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    process.env.GH_STUB_CREATE_URL = 'https://github.com/o/r/issues/9';
    try {
      const out = await addTask('o/r', 'New thing', 'high', 'complex');
      assert.match(out, /issues\/9/);
      const create = gh.readArgs().find(a => a[0] === 'issue' && a[1] === 'create');
      assert.ok(create.includes('backlog') && create.includes('complex'));
    } finally {
      process.env.ORCHESTRATOR_HOME = prev.home; process.env.PATH = prev.path;
      delete process.env.GH_STUB_CREATE_URL; gh.cleanup(); fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('complete closes by issue number', async () => {
    const home = tmpHome();
    const gh = installGhStub();
    const prev = { home: process.env.ORCHESTRATOR_HOME, path: process.env.PATH };
    process.env.ORCHESTRATOR_HOME = home; process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    try {
      const out = await completeTask('o/r', '5');
      assert.match(out, /issues\/5/);
      const close = gh.readArgs().find(a => a[0] === 'issue' && a[1] === 'close');
      assert.ok(close.includes('5'));
    } finally {
      process.env.ORCHESTRATOR_HOME = prev.home; process.env.PATH = prev.path;
      gh.cleanup(); fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp-servers/lib/backlog-manager-issues.test.mjs`
Expected: FAIL — `Cannot find module '.../backlog-manager/issues.mjs'`

- [ ] **Step 3: Create the issue-backed handler module**

Create `mcp-servers/backlog-manager/issues.mjs`:

```js
/**
 * Issue-backed backlog handlers for the backlog-manager MCP.
 * Thin adapters over scripts/lib/backlog-source.mjs (GitHub Issues = source of truth).
 */
import { listIssues, createIssue, closeIssue } from '../../scripts/lib/backlog-source.mjs';

const COMPLEXITY_LABELS = ['simple', 'medium', 'complex'];

function complexityOf(issue) {
  return issue.labels.find((l) => COMPLEXITY_LABELS.includes(l)) || 'medium';
}

/** List open backlog issues for a workspace as task objects. */
export async function listTasks(workspace, priority = 'all') {
  const issues = await listIssues(workspace, { label: 'backlog', state: 'open' });
  return issues
    .filter((i) => priority === 'all' || i.labels.includes(priority))
    .map((i) => ({
      number: i.number,
      priority: ['high', 'medium', 'low'].find((p) => i.labels.includes(p)) || null,
      complexity: complexityOf(i),
      description: i.title,
      url: i.url,
    }));
}

/** Create a backlog issue. Returns a human-readable string with the URL. */
export async function addTask(workspace, task, priority, complexity = 'medium') {
  const title = task.split('\n')[0].slice(0, 80);
  const body = `${task}\n\n— filed via JARVIS backlog-manager`;
  const labels = ['backlog', complexity, priority].filter(Boolean);
  const { url } = await createIssue(workspace, { title, body, labels });
  return `Created backlog issue: ${url}`;
}

/**
 * Close a backlog issue. `pattern` is an issue number (or #N), or a title substring
 * that must match exactly one open issue.
 */
export async function completeTask(workspace, pattern) {
  const today = new Date().toISOString().split('T')[0];
  const numeric = String(pattern).replace(/^#/, '');
  if (/^\d+$/.test(numeric)) {
    const { url } = await closeIssue(workspace, { number: numeric, comment: `Completed via JARVIS on ${today}.` });
    return `Closed ${url}`;
  }
  const issues = await listIssues(workspace, { label: 'backlog', state: 'open' });
  const matches = issues.filter((i) => i.title.toLowerCase().includes(String(pattern).toLowerCase()));
  if (matches.length === 0) return `No open backlog issue matches "${pattern}".`;
  if (matches.length > 1) {
    return `Ambiguous — ${matches.length} issues match "${pattern}": ${matches.map((m) => '#' + m.number).join(', ')}. Pass an issue number.`;
  }
  const { url } = await closeIssue(workspace, { number: matches[0].number, comment: `Completed via JARVIS on ${today}.` });
  return `Closed ${url}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mcp-servers/lib/backlog-manager-issues.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the handlers into the MCP server and remove sync_backlog**

In `mcp-servers/backlog-manager/index.js`:

(a) Add to the imports at the top (after the existing `config-loader` import):

```js
import { listTasks, addTask, completeTask } from "./issues.mjs";
```

(b) In `setupToolHandlers`, **remove** the entire `sync_backlog` tool object from the `tools: [ ... ]` array (the object spanning `name: "sync_backlog"`).

(c) Replace the `CallToolRequestSchema` switch body so the three cases delegate to the new handlers and `sync_backlog` is gone:

```js
        switch (name) {
          case "list_backlog_tasks":
            return this.textResult(JSON.stringify(await listTasks(args.workspace, args.priority ?? "all"), null, 2));

          case "add_backlog_task":
            return this.textResult(await addTask(args.workspace, args.task, args.priority, args.complexity));

          case "complete_backlog_task":
            return this.textResult(await completeTask(args.workspace, args.task_pattern));

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
```

(d) **Delete** the now-dead methods and helpers from the class: `parseBacklog`, `mergeTasks`, `reconstructBacklog`, `extractHeader`, `syncBacklog`, `pushToWorkspace`, `listBacklogTasks`, `addBacklogTask`, `completeBacklogTask`, and the top-level `resolveBacklogPath` function. Keep `getWorkspacePath` only if still referenced (it is not, after this — remove it too). Keep `textResult`, the constructor, `setupToolHandlers`, and `run`.

(e) Update the `complete_backlog_task` tool description/inputSchema: change the `task_pattern` description to `"Issue number (e.g. 5 or #5) or a title substring matching exactly one open issue"`.

- [ ] **Step 6: Verify the server still loads and lists exactly 3 tools**

Run:
```bash
node -e "import('./mcp-servers/backlog-manager/index.js').catch(e=>{console.error('LOAD FAIL',e.message);process.exit(1)})" &
sleep 1; kill %1 2>/dev/null; echo "loaded ok"
grep -c 'name: "sync_backlog"' mcp-servers/backlog-manager/index.js
```
Expected: `loaded ok`, and the grep prints `0`.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add mcp-servers/backlog-manager/index.js mcp-servers/backlog-manager/issues.mjs tests/mcp-servers/lib/backlog-manager-issues.test.mjs
git commit -m "feat(backlog): route backlog-manager MCP through GitHub Issues; drop sync_backlog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: DashboardSummary hook reads the cache

**Files:**
- Modify: `.claude/hooks/DashboardSummary.hook.sh`
- Modify: `tests/orchestrator/dashboard-summary.test.mjs`

- [ ] **Step 1: Update the regression test to expect the GitHub-backed section**

Replace the body of `tests/orchestrator/dashboard-summary.test.mjs` describe block with:

```js
describe('DashboardSummary hook — backlog summary (GitHub Issues cache)', () => {
  it('renders the Pending Backlog Issues section', () => {
    const out = runHook();
    assert.match(out, /-- Pending Backlog Issues \(GitHub\) --/);
  });

  it('reports per-repo counts from the cache, or a refresh hint when empty', () => {
    const out = runHook();
    const section = out.split('-- Pending Backlog Issues (GitHub) --')[1] || '';
    assert.match(section, /open|refresh-backlog-cache/,
      `expected counts or a refresh hint, got:\n${section.slice(0, 400)}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/orchestrator/dashboard-summary.test.mjs`
Expected: FAIL — old hook prints `-- Pending Backlog Tasks --`

- [ ] **Step 3: Replace the backlog section of the hook**

In `.claude/hooks/DashboardSummary.hook.sh`, replace the block from the comment line starting `# Backlog summary` through the `[[ "$found" -eq 0 ]] && echo "  (none)"` line (lines 30–45) with:

```bash
# Backlog summary — read the GitHub Issues cache (data/backlog-cache/*.json).
# GitHub is the source of truth; the cron `refresh-backlog-cache` keeps the cache fresh.
echo ""
echo "-- Pending Backlog Issues (GitHub) --"
cache_dir="${ORCHESTRATOR_HOME}/data/backlog-cache"
if compgen -G "${cache_dir}/*.json" > /dev/null; then
  newest=0
  for f in "${cache_dir}"/*.json; do
    repo="$(jq -r '.repo // "?"' "$f" 2>/dev/null)"
    count="$(jq -r '[.issues[] | select((.state // "open") == "open")] | length' "$f" 2>/dev/null || echo 0)"
    [[ "$count" -gt 0 ]] && echo "  ${repo}: ${count} open"
    mtime="$(date -r "$f" +%s 2>/dev/null || echo 0)"
    [[ "$mtime" -gt "$newest" ]] && newest="$mtime"
  done
  if [[ "$newest" -gt 0 ]]; then
    age_h=$(( ( $(date +%s) - newest ) / 3600 ))
    echo "  (cache age: ${age_h}h — run \`orchestrator.sh refresh-backlog-cache\` to update)"
  fi
else
  echo "  (no cache — run \`orchestrator.sh refresh-backlog-cache\`)"
fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/orchestrator/dashboard-summary.test.mjs`
Expected: PASS (the hook prints the new header; with no cache it prints the refresh hint, which the test accepts)

- [ ] **Step 5: Manual smoke with a fixture cache**

Run:
```bash
mkdir -p data/backlog-cache && printf '%s' '{"repo":"strokmatic/visionking","fetchedAt":"2026-06-16T00:00:00Z","issues":[{"number":1,"state":"open","labels":["backlog"]}]}' > data/backlog-cache/strokmatic__visionking.json
ORCHESTRATOR_HOME="$PWD" bash .claude/hooks/DashboardSummary.hook.sh | sed -n '/Pending Backlog Issues/,/cache age/p'
rm -f data/backlog-cache/strokmatic__visionking.json
```
Expected: shows `strokmatic/visionking: 1 open` and a `cache age:` line.

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/DashboardSummary.hook.sh tests/orchestrator/dashboard-summary.test.mjs
git commit -m "feat(backlog): dashboard reads GitHub Issues cache (cache-only, non-blocking)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: orchestrator.sh — hard rename to `refresh-backlog-cache`

**Files:**
- Modify: `scripts/orchestrator.sh`
- Modify: `config/orchestrator/schedules.json`
- Create: `tests/orchestrator/refresh-rename.test.mjs`

- [ ] **Step 1: Write the failing regression test (no dangling old name)**

Create `tests/orchestrator/refresh-rename.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('process_backlogs hard rename → refresh_backlog_cache', () => {
  it('orchestrator.sh defines refresh_backlog_cache and the refresh-backlog-cache mode', () => {
    const src = readFileSync(join(ROOT, 'scripts/orchestrator.sh'), 'utf-8');
    assert.match(src, /refresh_backlog_cache\(\)/);
    assert.match(src, /refresh-backlog-cache\)/);
  });

  it('no live caller references the old process[-_]backlogs name', () => {
    for (const rel of ['scripts/orchestrator.sh', 'config/orchestrator/schedules.json']) {
      const src = readFileSync(join(ROOT, rel), 'utf-8');
      assert.doesNotMatch(src, /process[-_]backlogs/, `${rel} still references process-backlogs`);
    }
  });

  it('schedules.json daily task is refresh_backlog_cache', () => {
    const s = JSON.parse(readFileSync(join(ROOT, 'config/orchestrator/schedules.json'), 'utf-8'));
    assert.ok((s.schedules?.daily || []).some(e => e.task === 'refresh_backlog_cache'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/orchestrator/refresh-rename.test.mjs`
Expected: FAIL — old name still present

- [ ] **Step 3: Replace the `process_backlogs` function**

In `scripts/orchestrator.sh`, replace the whole `process_backlogs() { ... }` function (lines ~90–165) with:

```bash
refresh_backlog_cache() {
    log_section "Refreshing Backlog Cache (GitHub Issues)"
    if ! command -v gh >/dev/null 2>&1; then
        log_error "gh CLI not found — cannot refresh backlog cache"
        return 1
    fi
    # Pull open backlog issues for every configured repo into data/backlog-cache/.
    node "$ORCHESTRATOR_HOME/scripts/lib/backlog-source.mjs" refresh || {
        log_warn "Backlog cache refresh reported errors (see above) — keeping existing cache"
    }
    log_info "Backlog cache refreshed. Dispatch is manual: orchestrator.sh dispatch-issue <workspace|repo> <issue#>"
}
```

Also delete the now-unused `MAX_TASKS` block (lines ~80–88, the `Read max_tasks_per_workspace …` node call) since nothing dispatches per-task anymore.

- [ ] **Step 4: Update the mode dispatcher and usage string**

In the `case "$MODE"` block near the bottom of `scripts/orchestrator.sh`:
- change `process-backlogs) process_backlogs ;;` to `refresh-backlog-cache) refresh_backlog_cache ;;`
- change `daily)            process_backlogs ;;` to `daily)            refresh_backlog_cache ;;`
- in the `Usage:` echo, change `<process-backlogs|` to `<refresh-backlog-cache|`

- [ ] **Step 5: Update schedules.json**

In `config/orchestrator/schedules.json`, change the daily entry from:

```json
    { "time": "09:00", "task": "process_backlogs", "workspaces": ["all"], "max_tasks_per_workspace": 1 }
```

to:

```json
    { "time": "09:00", "task": "refresh_backlog_cache", "workspaces": ["all"] }
```

- [ ] **Step 6: Run tests + a syntax check**

Run: `bash -n scripts/orchestrator.sh && node --test tests/orchestrator/refresh-rename.test.mjs`
Expected: no syntax error; PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add scripts/orchestrator.sh config/orchestrator/schedules.json tests/orchestrator/refresh-rename.test.mjs
git commit -m "feat(backlog): hard-rename process_backlogs → refresh_backlog_cache (no auto-dispatch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: orchestrator.sh — `dispatch-issue` (manual trigger)

**Files:**
- Modify: `scripts/orchestrator.sh`
- Create: `tests/orchestrator/dispatch-issue.test.mjs`

- [ ] **Step 1: Write the failing dry-run test**

Create `tests/orchestrator/dispatch-issue.test.mjs`:

```js
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
    // stub gh that returns an issue with a "complex" label
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/orchestrator/dispatch-issue.test.mjs`
Expected: FAIL — unknown mode `dispatch-issue`

- [ ] **Step 3: Implement the `dispatch_issue` function**

In `scripts/orchestrator.sh`, add this function (next to `refresh_backlog_cache`):

```bash
dispatch_issue() {
    local target="$1" number="$2" dry=""
    [[ "$3" == "--dry-run" || "$4" == "--dry-run" ]] && dry="1"
    if [[ -z "$target" || -z "$number" ]]; then
        log_error "Usage: orchestrator.sh dispatch-issue <workspace|owner/repo> <issue#> [--dry-run]"
        return 1
    fi

    # Resolve a workspace key + repo slug from the target.
    local workspace repo
    if [[ "$target" == */* ]]; then
        repo="$target"
        workspace="$(node "$ORCHESTRATOR_HOME/scripts/lib/backlog-source.mjs" resolve-workspace "$repo" 2>/dev/null)"
    else
        workspace="$target"
        repo="$(node "$ORCHESTRATOR_HOME/scripts/lib/backlog-source.mjs" resolve-repo "$workspace" 2>/dev/null)"
    fi
    if [[ -z "$workspace" || -z "$repo" ]]; then
        log_error "Could not resolve workspace/repo for '$target'"
        return 1
    fi

    # Fetch the issue.
    local issue_json
    issue_json="$(gh issue view "$number" --repo "$repo" --json title,body,labels,url 2>/dev/null)" || {
        log_error "Failed to fetch issue #$number from $repo"
        return 1
    }

    local title body url complexity
    title="$(echo "$issue_json" | jq -r '.title')"
    body="$(echo "$issue_json" | jq -r '.body')"
    url="$(echo "$issue_json" | jq -r '.url')"
    complexity="$(echo "$issue_json" | jq -r '[.labels[].name] | map(select(. == "simple" or . == "medium" or . == "complex")) | (.[0] // "medium")')"

    local prompt="GitHub issue ${url}

# ${title}

${body}

Reference this issue (${url}) in your branch name, commit message, and PR. Do not close the issue automatically."

    if [[ -n "$dry" ]]; then
        echo "workspace: $workspace"
        echo "repo: $repo"
        echo "complexity: $complexity"
        echo "would run: task-dispatcher.sh \"$workspace\" <prompt for ${url}> \"$complexity\""
        return 0
    fi

    log_info "Dispatching ${url} → $workspace ($complexity)"
    "$SCRIPT_DIR/task-dispatcher.sh" "$workspace" "$prompt" "$complexity"
}
```

- [ ] **Step 4: Wire the mode + add the `resolve-workspace` CLI command**

(a) In `scripts/orchestrator.sh` `case "$MODE"`, add:

```bash
    dispatch-issue)   dispatch_issue "$2" "$3" "$4" "$5" ;;
```

and add `dispatch-issue` to the `Usage:` echo.

(b) In `scripts/lib/backlog-source.mjs` `cli()` switch, add a `resolve-workspace` case (used by `dispatch_issue` when given an `owner/repo`):

```js
    case 'resolve-workspace': {
      const ws = await resolveWorkspaceByRepo(positional[0]);
      if (!ws) { console.error(`No workspace for "${positional[0]}"`); process.exit(2); }
      console.log(ws); break;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/orchestrator/dispatch-issue.test.mjs`
Expected: PASS

- [ ] **Step 6: Run the full suite + syntax check**

Run: `bash -n scripts/orchestrator.sh && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/orchestrator.sh scripts/lib/backlog-source.mjs tests/orchestrator/dispatch-issue.test.mjs
git commit -m "feat(backlog): add manual 'dispatch-issue' command (issue → task-dispatcher)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Retire the `BacklogPreloader` hook

**Files:**
- Delete: `.claude/hooks/BacklogPreloader.hook.sh`
- Modify: `.claude/settings.local.json`
- Create: `tests/orchestrator/no-backlog-preloader.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/orchestrator/no-backlog-preloader.test.mjs`:

```js
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

  it('settings.local.json no longer registers it', () => {
    const raw = readFileSync(join(ROOT, '.claude/settings.local.json'), 'utf-8');
    assert.doesNotMatch(raw, /BacklogPreloader/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/orchestrator/no-backlog-preloader.test.mjs`
Expected: FAIL — file and registration still present

- [ ] **Step 3: Remove the hook registrations**

In `.claude/settings.local.json`, in the `PreToolUse` array:
- From the `mcp__task-dispatcher__dispatch_task` matcher, remove the `BacklogPreloader.hook.sh` hook entry (keep `PreDispatchValidator.hook.sh`).
- Remove the **entire** `mcp__backlog-manager__list_backlog_tasks` matcher object (its only hook was `BacklogPreloader`).

Resulting `PreToolUse` should contain a single matcher object for `mcp__task-dispatcher__dispatch_task` with just `PreDispatchValidator.hook.sh`.

- [ ] **Step 4: Delete the hook file**

Run: `git rm .claude/hooks/BacklogPreloader.hook.sh`

- [ ] **Step 5: Validate settings JSON + run test**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf-8')); console.log('valid json')" && node --test tests/orchestrator/no-backlog-preloader.test.mjs`
Expected: `valid json`; PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add .claude/settings.local.json tests/orchestrator/no-backlog-preloader.test.mjs
git commit -m "chore(backlog): retire BacklogPreloader hook (.md sync obsolete under GitHub SoT)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Docs, changelog, and crontab deploy

**Files:**
- Modify: `mcp-servers/backlog-manager/.claude/context.md`
- Modify: `README.md`
- Modify: `docs/SKILLS.md`
- Modify: `changelogs/CHANGELOG.md` (via changelog-writer MCP if available, else edit directly)
- Live: crontab

- [ ] **Step 1: Update the MCP context + tool docs**

In `mcp-servers/backlog-manager/.claude/context.md`, remove the `sync_backlog` bullet and update the three remaining bullets to state they operate on GitHub Issues (cache-backed reads; `gh`-backed writes).

In `README.md` (the MCP tools table ~lines 238–241 and the hooks table ~line 428): remove the `sync_backlog` row; change `list/add/complete` descriptions to "(GitHub Issues)"; remove the `BacklogPreloader` hook row.

In `docs/SKILLS.md` (lines ~9–11): update the three backlog tool descriptions to reference GitHub Issues; `complete_backlog_task` param becomes `workspace`, `task_pattern` (issue # or title substring).

- [ ] **Step 2: Add a changelog entry**

Append under a `## 2026-06-16` header in `changelogs/CHANGELOG.md`:

```markdown
### Changed
- Backlog source of truth moved from local `backlogs/**/*.md` to GitHub Issues. New
  `scripts/lib/backlog-source.mjs` (gh + JSON cache) backs the `backlog-manager` MCP,
  the dashboard hook, and a cached cron refresh.
- `orchestrator.sh process-backlogs` renamed to `refresh-backlog-cache`; the cron no
  longer auto-dispatches. Dispatch is now explicit via `orchestrator.sh dispatch-issue
  <workspace|repo> <issue#>`.

### Removed
- `backlog-manager` `sync_backlog` tool and the `BacklogPreloader` hook (local `.md`
  three-way sync is obsolete under GitHub source of truth).
```

- [ ] **Step 3: Run the full suite one final time**

Run: `npm test`
Expected: PASS (all suites green)

- [ ] **Step 4: Audit for any remaining stale references**

Run: `grep -rn 'process[-_]backlogs\|sync_backlog\|BacklogPreloader' --include='*.sh' --include='*.js' --include='*.mjs' --include='*.json' . | grep -v node_modules | grep -v releases/FORGE | grep -v docs/superpowers`
Expected: no hits outside `changelogs/` history.

- [ ] **Step 5: Commit the docs**

```bash
git add mcp-servers/backlog-manager/.claude/context.md README.md docs/SKILLS.md changelogs/CHANGELOG.md
git commit -m "docs(backlog): document GitHub-Issues backlog source; changelog 2026-06-16

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Update the live crontab (deploy action — do last)**

The repo change is complete; now flip the live cron so the 09:00 job calls the new mode. Run:

```bash
crontab -l | sed 's#orchestrator.sh process-backlogs#orchestrator.sh refresh-backlog-cache#' | crontab -
crontab -l | grep -n 'refresh-backlog-cache'
```
Expected: the 09:00 line now reads `orchestrator.sh refresh-backlog-cache`. (Run an immediate `ORCHESTRATOR_HOME=$PWD scripts/orchestrator.sh refresh-backlog-cache` once to populate the cache.)

---

## Done criteria

- `npm test` green (backlog-source unit/integration, MCP issue handlers, dashboard, rename, dispatch-issue, no-preloader).
- `data/backlog-cache/*.json` populated by `refresh-backlog-cache`; dashboard shows per-repo open counts.
- `backlog-manager` exposes exactly 3 tools, all issue-backed; `sync_backlog` gone.
- `dispatch-issue` dispatches a chosen issue to the right workspace with complexity-derived model; never auto-closes.
- No live references to `process-backlogs` / `sync_backlog` / `BacklogPreloader`.
- Crontab 09:00 job runs `refresh-backlog-cache`.
