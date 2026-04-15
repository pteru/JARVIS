# gdrive-index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `gdrive-index` as a cron service at `/opt/jarvis-gdrive-index/` that indexes Drive folders per project daily and pushes `drive-index.json` to the PMO repo via git.

**Architecture:** Node.js ESM service with pure/I/O separation. Two shared libs in `services/_shared/` (new: `google-auth.mjs`, `pmo-git.mjs`) established here for reuse by email-index and meeting-index. Service account + DWD for Drive API; git SSH for PMO push. State.json canonical for health-monitor integration.

**Tech Stack:** Node.js 20+ ESM, `googleapis` npm, `node:test` runner, bash scripts, cron, git, SSH.

**Spec reference:** `docs/superpowers/specs/2026-04-15-gdrive-index-design.md`

**Repository:** `workspaces/strokmatic/infra/` (strokmatic/infra GitHub repo). Work happens on branch `feature/gdrive-index` off `master`.

---

## Phase 0: Worktree + Scaffolding

### Task 0.1: Create feature branch worktree

**Files:**
- Create: `/home/teruel/worktrees/infra-gdrive-index/` (worktree checkout)

- [ ] **Step 1: Confirm infra repo state**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git fetch origin
git log --oneline origin/master -5
```

Expected: recent commits from master (workflow docs, github-clickup-sync fix).

- [ ] **Step 2: Create worktree from origin/master**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git worktree add -b feature/gdrive-index /home/teruel/worktrees/infra-gdrive-index origin/master
```

Expected: new worktree at `/home/teruel/worktrees/infra-gdrive-index/` on branch `feature/gdrive-index`.

- [ ] **Step 3: Verify worktree**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git branch --show-current
ls services/
```

Expected: `feature/gdrive-index`, services list includes `_shared`, `context-refresh`, `github-clickup-sync`, `health-monitor`, `pr-review`.

### Task 0.2: Scaffold services/gdrive-index/

**Files:**
- Create: `services/gdrive-index/` dir tree per spec §4.2

- [ ] **Step 1: Create directory structure**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
mkdir -p services/gdrive-index/{config,lib,test,data,logs}
touch services/gdrive-index/{run.sh,deploy.sh,package.json,index.mjs}
touch services/gdrive-index/config/service.json
touch services/gdrive-index/lib/{config,drive-client,project-indexer,change-detector,pmo-git-wrapper}.mjs
touch services/gdrive-index/test/{project-indexer,change-detector}.test.mjs
touch services/gdrive-index/test/test-integration.mjs
touch services/gdrive-index/.gitignore
```

- [ ] **Step 2: Write .gitignore**

Content of `services/gdrive-index/.gitignore`:
```
data/pmo-clone/
data/state.json
logs/
node_modules/
```

- [ ] **Step 3: Write initial package.json**

Content of `services/gdrive-index/package.json`:
```json
{
  "name": "@strokmatic/gdrive-index",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test test/",
    "start": "node index.mjs"
  },
  "dependencies": {
    "googleapis": "^144.0.0"
  }
}
```

- [ ] **Step 4: Verify layout**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
tree services/gdrive-index -I 'node_modules'
```

Expected tree matches spec §4.2.

- [ ] **Step 5: Commit scaffolding**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git add services/gdrive-index/
git commit -m "feat(gdrive-index): scaffold directory structure

Empty tree for gdrive-index service per spec §4.2.
Following health-monitor pattern.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1: `services/_shared/google-auth.mjs`

This shared lib is created here for gdrive-index but used by all 3 indexers. Mirrors `mcp-servers/lib/google-auth.mjs` in JARVIS with factory conveniences.

**Files:**
- Create: `services/_shared/google-auth.mjs`
- Create: `services/_shared/package.json`
- Create: `services/_shared/test/google-auth.test.mjs`

### Task 1.1: Write failing test

- [ ] **Step 1: Create test skeleton**

Content of `services/_shared/test/google-auth.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAuth, getDriveClient, getGmailClient } from '../google-auth.mjs';

const FAKE_KEY = {
  type: 'service_account',
  project_id: 'test',
  private_key_id: 'abc',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvwIBA...\n-----END PRIVATE KEY-----\n',
  client_email: 'test@test.iam.gserviceaccount.com',
  client_id: '0',
};

function writeFakeKey() {
  const dir = mkdtempSync(join(tmpdir(), 'gauth-test-'));
  const path = join(dir, 'key.json');
  writeFileSync(path, JSON.stringify(FAKE_KEY), 'utf-8');
  return path;
}

test('createAuth returns GoogleAuth with scopes and subject', () => {
  const keyPath = writeFakeKey();
  const auth = createAuth({
    credentialsPath: keyPath,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: 'pedro@lumesolutions.com',
  });
  assert.ok(auth);
  assert.equal(typeof auth.getClient, 'function');
});

test('createAuth throws on missing key file', () => {
  assert.throws(
    () => createAuth({ credentialsPath: '/does/not/exist.json', scopes: ['x'] }),
    /ENOENT/
  );
});

test('createAuth throws on invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gauth-test-'));
  const path = join(dir, 'bad.json');
  writeFileSync(path, 'not json', 'utf-8');
  assert.throws(() => createAuth({ credentialsPath: path, scopes: ['x'] }));
});

test('getDriveClient returns a v3 drive client', () => {
  const keyPath = writeFakeKey();
  const client = getDriveClient({
    credentialsPath: keyPath,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: 'pedro@lumesolutions.com',
  });
  assert.ok(client);
  assert.ok(client.files);
  assert.equal(typeof client.files.list, 'function');
});

test('getGmailClient returns a v1 gmail client', () => {
  const keyPath = writeFakeKey();
  const client = getGmailClient({
    credentialsPath: keyPath,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    subject: 'pedro@lumesolutions.com',
  });
  assert.ok(client);
  assert.ok(client.users);
  assert.equal(typeof client.users.messages.list, 'function');
});

test('getDriveClient uses GCP_SERVICE_ACCOUNT_KEY env var when credentialsPath omitted', () => {
  const keyPath = writeFakeKey();
  process.env.GCP_SERVICE_ACCOUNT_KEY = keyPath;
  try {
    const client = getDriveClient({ scopes: ['https://www.googleapis.com/auth/drive'] });
    assert.ok(client);
  } finally {
    delete process.env.GCP_SERVICE_ACCOUNT_KEY;
  }
});
```

- [ ] **Step 2: Write minimal shared package.json**

Content of `services/_shared/package.json`:
```json
{
  "name": "@strokmatic/services-shared",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test test/"
  },
  "dependencies": {
    "googleapis": "^144.0.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/_shared
npm install
```

- [ ] **Step 4: Run tests (should fail)**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/_shared
npm test
```

Expected: FAIL — `google-auth.mjs` doesn't export the required functions.

### Task 1.2: Implement `google-auth.mjs`

- [ ] **Step 1: Write minimal implementation**

Content of `services/_shared/google-auth.mjs`:
```javascript
/**
 * Shared Google API authentication helper for infra services.
 * Mirrors mcp-servers/lib/google-auth.mjs in JARVIS repo, adding factory
 * conveniences for Drive and Gmail clients.
 *
 * Used by: gdrive-index, email-index, meeting-index.
 */
import { readFileSync } from 'node:fs';
import { google } from 'googleapis';

const DEFAULT_KEY_PATH = process.env.GCP_SERVICE_ACCOUNT_KEY ||
  '/home/strokmatic/.secrets/gcp-service-account.json';

export function createAuth({ credentialsPath, scopes, subject }) {
  if (!scopes || scopes.length === 0) {
    throw new Error('scopes is required');
  }
  const path = credentialsPath || DEFAULT_KEY_PATH;
  const credentials = JSON.parse(readFileSync(path, 'utf-8'));
  const options = { credentials, scopes };
  if (subject) options.clientOptions = { subject };
  return new google.auth.GoogleAuth(options);
}

export function getDriveClient({ credentialsPath, scopes, subject } = {}) {
  const auth = createAuth({ credentialsPath, scopes, subject });
  return google.drive({ version: 'v3', auth });
}

export function getGmailClient({ credentialsPath, scopes, subject } = {}) {
  const auth = createAuth({ credentialsPath, scopes, subject });
  return google.gmail({ version: 'v1', auth });
}
```

- [ ] **Step 2: Run tests (should pass)**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/_shared
npm test
```

Expected: PASS — 6 tests.

- [ ] **Step 3: Commit shared lib**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git add services/_shared/
git commit -m "feat(_shared): add google-auth.mjs with Drive/Gmail factories

Service account + DWD auth for infra services. Mirrors JARVIS
mcp-servers/lib/google-auth.mjs pattern; adds getDriveClient and
getGmailClient factories. Key path from GCP_SERVICE_ACCOUNT_KEY
env or /home/strokmatic/.secrets/gcp-service-account.json.

Tests: 6 passing with fake key, 0 real API calls.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: `services/_shared/pmo-git.mjs`

Shared lib wrapping git clone/pull/add/commit/push targeting the PMO repo. Used by gdrive-index, email-index, meeting-index.

**Files:**
- Create: `services/_shared/pmo-git.mjs`
- Create: `services/_shared/test/pmo-git.test.mjs`

### Task 2.1: Write failing tests

- [ ] **Step 1: Create test skeleton**

Content of `services/_shared/test/pmo-git.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPmoGit } from '../pmo-git.mjs';

function makeBareRemote() {
  const dir = mkdtempSync(join(tmpdir(), 'pmo-remote-'));
  execSync('git init --bare', { cwd: dir });
  return dir;
}

function seedBareRemote(remoteDir) {
  const seed = mkdtempSync(join(tmpdir(), 'pmo-seed-'));
  execSync('git init -b master', { cwd: seed });
  execSync('git config user.email "seed@test.internal"', { cwd: seed });
  execSync('git config user.name "seed"', { cwd: seed });
  writeFileSync(join(seed, 'README.md'), '# PMO seed\n', 'utf-8');
  execSync('git add .', { cwd: seed });
  execSync('git commit -m "initial"', { cwd: seed });
  execSync(`git remote add origin ${remoteDir}`, { cwd: seed });
  execSync('git push origin master', { cwd: seed });
  return seed;
}

test('cloneOrPull clones from remote when clone path does not exist', async () => {
  const remote = makeBareRemote();
  seedBareRemote(remote);
  const cloneDir = join(mkdtempSync(join(tmpdir(), 'pmo-work-')), 'clone');
  const git = createPmoGit({
    url: remote,
    branch: 'master',
    clonePath: cloneDir,
    author: { name: 'test', email: 'test@test.internal' },
  });
  await git.cloneOrPull();
  assert.ok(existsSync(join(cloneDir, '.git')));
  assert.ok(existsSync(join(cloneDir, 'README.md')));
});

test('cloneOrPull pulls when clone already exists', async () => {
  const remote = makeBareRemote();
  const seed = seedBareRemote(remote);
  const cloneDir = join(mkdtempSync(join(tmpdir(), 'pmo-work-')), 'clone');
  const git = createPmoGit({
    url: remote,
    branch: 'master',
    clonePath: cloneDir,
    author: { name: 'test', email: 'test@test.internal' },
  });
  await git.cloneOrPull();
  // Push a new commit to remote via seed
  writeFileSync(join(seed, 'NEW.md'), 'new\n', 'utf-8');
  execSync('git add .', { cwd: seed });
  execSync('git commit -m "add new"', { cwd: seed });
  execSync('git push origin master', { cwd: seed });
  // Pull again
  await git.cloneOrPull();
  assert.ok(existsSync(join(cloneDir, 'NEW.md')));
});

test('writeProject writes file into clone; commitAll creates commit; push sends to remote', async () => {
  const remote = makeBareRemote();
  seedBareRemote(remote);
  const cloneDir = join(mkdtempSync(join(tmpdir(), 'pmo-work-')), 'clone');
  const git = createPmoGit({
    url: remote,
    branch: 'master',
    clonePath: cloneDir,
    author: { name: 'test', email: 'test@test.internal' },
  });
  await git.cloneOrPull();
  await git.writeProject('01001', 'drive-index.json', { project: '01001', entries: [] });
  assert.ok(existsSync(join(cloneDir, 'projects/01001/drive-index.json')));
  const committed = await git.commitAll('test: add drive-index');
  assert.equal(committed, true);
  await git.push();
  // Verify remote has commit
  const verify = mkdtempSync(join(tmpdir(), 'pmo-verify-'));
  execSync(`git clone ${remote} ${verify}`);
  assert.ok(existsSync(join(verify, 'projects/01001/drive-index.json')));
});

test('commitAll returns false when working tree clean', async () => {
  const remote = makeBareRemote();
  seedBareRemote(remote);
  const cloneDir = join(mkdtempSync(join(tmpdir(), 'pmo-work-')), 'clone');
  const git = createPmoGit({
    url: remote,
    branch: 'master',
    clonePath: cloneDir,
    author: { name: 'test', email: 'test@test.internal' },
  });
  await git.cloneOrPull();
  const result = await git.commitAll('nothing');
  assert.equal(result, false);
});

test('writeProject overwrites existing file deterministically', async () => {
  const remote = makeBareRemote();
  seedBareRemote(remote);
  const cloneDir = join(mkdtempSync(join(tmpdir(), 'pmo-work-')), 'clone');
  const git = createPmoGit({
    url: remote,
    branch: 'master',
    clonePath: cloneDir,
    author: { name: 'test', email: 'test@test.internal' },
  });
  await git.cloneOrPull();
  await git.writeProject('01001', 'drive-index.json', { v: 1 });
  await git.writeProject('01001', 'drive-index.json', { v: 2 });
  const content = JSON.parse(readFileSync(join(cloneDir, 'projects/01001/drive-index.json'), 'utf-8'));
  assert.equal(content.v, 2);
});

test('push fails on rejection but pulls-rebase then retries successfully', async () => {
  const remote = makeBareRemote();
  const seed = seedBareRemote(remote);
  const cloneDir = join(mkdtempSync(join(tmpdir(), 'pmo-work-')), 'clone');
  const git = createPmoGit({
    url: remote,
    branch: 'master',
    clonePath: cloneDir,
    author: { name: 'test', email: 'test@test.internal' },
  });
  await git.cloneOrPull();
  // Make local change
  await git.writeProject('01001', 'a.json', { a: 1 });
  await git.commitAll('local change');
  // Make remote diverge
  writeFileSync(join(seed, 'REMOTE.md'), 'x\n', 'utf-8');
  execSync('git add .', { cwd: seed });
  execSync('git commit -m "remote change"', { cwd: seed });
  execSync('git push origin master', { cwd: seed });
  // Push should succeed via pull-rebase
  await git.push();
  // Verify remote has both
  const verify = mkdtempSync(join(tmpdir(), 'pmo-verify-'));
  execSync(`git clone ${remote} ${verify}`);
  assert.ok(existsSync(join(verify, 'REMOTE.md')));
  assert.ok(existsSync(join(verify, 'projects/01001/a.json')));
});
```

- [ ] **Step 2: Run tests (should fail)**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/_shared
npm test
```

Expected: FAIL — `pmo-git.mjs` doesn't exist.

### Task 2.2: Implement `pmo-git.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/_shared/pmo-git.mjs`:
```javascript
/**
 * Shared git wrapper for infra services that publish to PMO repo.
 * Responsibilities: clone/pull, atomic writeProject, commit, push with
 * pull-rebase retry on rejection.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

async function git(cwd, args, env = {}) {
  return await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 50 * 1024 * 1024,
  });
}

function atomicWriteJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

export function createPmoGit({ url, branch, clonePath, author }) {
  if (!url || !branch || !clonePath || !author?.name || !author?.email) {
    throw new Error('url, branch, clonePath, author.name, author.email are required');
  }

  async function cloneOrPull() {
    if (!existsSync(join(clonePath, '.git'))) {
      mkdirSync(dirname(clonePath), { recursive: true });
      await git(dirname(clonePath), ['clone', '--branch', branch, url, clonePath]);
      await git(clonePath, ['config', 'user.name', author.name]);
      await git(clonePath, ['config', 'user.email', author.email]);
    } else {
      await git(clonePath, ['fetch', 'origin']);
      await git(clonePath, ['checkout', branch]);
      await git(clonePath, ['reset', '--hard', `origin/${branch}`]);
    }
  }

  async function writeProject(projectCode, relPath, data) {
    const target = join(clonePath, 'projects', projectCode, relPath);
    atomicWriteJson(target, data);
  }

  async function writeAtRelPath(relPath, data) {
    const target = join(clonePath, relPath);
    atomicWriteJson(target, data);
  }

  async function commitAll(message) {
    const status = await git(clonePath, ['status', '--porcelain']);
    if (!status.stdout.trim()) {
      return false;
    }
    await git(clonePath, ['add', '-A']);
    await git(clonePath, ['commit', '-m', message]);
    return true;
  }

  async function push() {
    try {
      await git(clonePath, ['push', 'origin', branch]);
    } catch (err) {
      // Pull-rebase + retry once
      await git(clonePath, ['pull', '--rebase', 'origin', branch]);
      await git(clonePath, ['push', 'origin', branch]);
    }
  }

  async function headSha() {
    const { stdout } = await git(clonePath, ['rev-parse', 'HEAD']);
    return stdout.trim();
  }

  return { cloneOrPull, writeProject, writeAtRelPath, commitAll, push, headSha };
}
```

- [ ] **Step 2: Run tests (should pass)**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/_shared
npm test
```

Expected: PASS — 6 google-auth tests + 6 pmo-git tests = 12 tests total.

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git add services/_shared/
git commit -m "feat(_shared): add pmo-git.mjs for PMO repo transport

Clone/pull + atomic writeProject + commit + push with pull-rebase
retry on rejection. Used by gdrive-index (first consumer), to be
reused by email-index and meeting-index.

Tests: 6 passing with local bare remote fixtures; covers clone,
pull, write, commit (including no-op), push, and divergence.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: `change-detector.mjs` (PURE)

Signature: `diff(oldIndex, newIndex) → {changed, added, removed, modified}`.

**Files:**
- Create: `services/gdrive-index/lib/change-detector.mjs`
- Create: `services/gdrive-index/test/change-detector.test.mjs`

### Task 3.1: Write tests first (TDD)

- [ ] **Step 1: Create failing test file**

Content of `services/gdrive-index/test/change-detector.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff } from '../lib/change-detector.mjs';

function entry(id, path, modifiedTime = '2026-01-01T00:00:00Z', size = 100) {
  return { id, path, type: path.endsWith('/') ? 'folder' : 'file', size, modifiedTime };
}

function index(entries = []) {
  return {
    sources: [{ folderId: 'root', entries }],
  };
}

test('null oldIndex → changed=true with all entries as added', () => {
  const newIdx = index([entry('a', 'file.txt')]);
  const result = diff(null, newIdx);
  assert.equal(result.changed, true);
  assert.deepEqual(result.added.map(e => e.id), ['a']);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.modified, []);
});

test('identical indexes → changed=false', () => {
  const a = index([entry('a', 'file.txt')]);
  const b = index([entry('a', 'file.txt')]);
  const result = diff(a, b);
  assert.equal(result.changed, false);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.modified, []);
});

test('entry added in new', () => {
  const a = index([entry('a', 'f1.txt')]);
  const b = index([entry('a', 'f1.txt'), entry('b', 'f2.txt')]);
  const result = diff(a, b);
  assert.equal(result.changed, true);
  assert.deepEqual(result.added.map(e => e.id), ['b']);
});

test('entry removed from new', () => {
  const a = index([entry('a', 'f1.txt'), entry('b', 'f2.txt')]);
  const b = index([entry('a', 'f1.txt')]);
  const result = diff(a, b);
  assert.equal(result.changed, true);
  assert.deepEqual(result.removed.map(e => e.id), ['b']);
});

test('entry modified by modifiedTime', () => {
  const a = index([entry('a', 'f.txt', '2026-01-01T00:00:00Z')]);
  const b = index([entry('a', 'f.txt', '2026-01-02T00:00:00Z')]);
  const result = diff(a, b);
  assert.equal(result.changed, true);
  assert.deepEqual(result.modified.map(e => e.id), ['a']);
});

test('entry modified by size', () => {
  const a = index([entry('a', 'f.txt', '2026-01-01T00:00:00Z', 100)]);
  const b = index([entry('a', 'f.txt', '2026-01-01T00:00:00Z', 200)]);
  const result = diff(a, b);
  assert.equal(result.changed, true);
  assert.deepEqual(result.modified.map(e => e.id), ['a']);
});

test('combined add + remove + modify', () => {
  const a = index([
    entry('a', 'f1.txt', '2026-01-01T00:00:00Z'),
    entry('b', 'f2.txt'),
  ]);
  const b = index([
    entry('a', 'f1.txt', '2026-01-02T00:00:00Z'),
    entry('c', 'f3.txt'),
  ]);
  const result = diff(a, b);
  assert.equal(result.changed, true);
  assert.deepEqual(result.added.map(e => e.id), ['c']);
  assert.deepEqual(result.removed.map(e => e.id), ['b']);
  assert.deepEqual(result.modified.map(e => e.id), ['a']);
});
```

- [ ] **Step 2: Install deps and run tests**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/gdrive-index
npm install
npm test
```

Expected: FAIL — `diff` not exported.

### Task 3.2: Implement `change-detector.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/gdrive-index/lib/change-detector.mjs`:
```javascript
/**
 * PURE: compare two drive-index objects and return {changed, added, removed, modified}.
 * Keys entries by `id` across all sources.
 */

function flatten(index) {
  if (!index || !Array.isArray(index.sources)) return [];
  return index.sources.flatMap(s => s.entries || []);
}

function byId(entries) {
  const map = new Map();
  for (const e of entries) map.set(e.id, e);
  return map;
}

export function diff(oldIndex, newIndex) {
  if (!oldIndex) {
    const newEntries = flatten(newIndex);
    return {
      changed: newEntries.length > 0,
      added: newEntries,
      removed: [],
      modified: [],
    };
  }
  const oldMap = byId(flatten(oldIndex));
  const newMap = byId(flatten(newIndex));
  const added = [];
  const removed = [];
  const modified = [];
  for (const [id, entry] of newMap) {
    if (!oldMap.has(id)) {
      added.push(entry);
    } else {
      const prev = oldMap.get(id);
      if (prev.modifiedTime !== entry.modifiedTime || prev.size !== entry.size) {
        modified.push(entry);
      }
    }
  }
  for (const [id, entry] of oldMap) {
    if (!newMap.has(id)) removed.push(entry);
  }
  return {
    changed: added.length > 0 || removed.length > 0 || modified.length > 0,
    added,
    removed,
    modified,
  };
}
```

- [ ] **Step 2: Run tests**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/gdrive-index
npm test
```

Expected: PASS — 7 tests.

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git add services/gdrive-index/lib/change-detector.mjs services/gdrive-index/test/change-detector.test.mjs services/gdrive-index/package.json services/gdrive-index/package-lock.json
git commit -m "feat(gdrive-index): add change-detector with TDD

Pure function diff(old, new) → {changed, added, removed, modified}.
Keys entries by id; detects modifications via modifiedTime OR size.
Null oldIndex treated as empty (all entries added).

Tests: 7 passing covering null, identical, add, remove, modify by
modifiedTime, modify by size, combined cases.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: `project-indexer.mjs` (mostly PURE with injected deps)

Responsibility: given project_code + drive.folders[] config + injected drive-client, produce a full drive-index.json object.

**Files:**
- Create: `services/gdrive-index/lib/project-indexer.mjs`
- Create: `services/gdrive-index/test/project-indexer.test.mjs`

### Task 4.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/gdrive-index/test/project-indexer.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectIndex } from '../lib/project-indexer.mjs';

function makeMockClient(fixture) {
  return {
    async listFolder(id) {
      return fixture[id] || { folders: [], files: [] };
    },
  };
}

test('single folder with 2 files', async () => {
  const client = makeMockClient({
    'root-1': {
      folders: [],
      files: [
        { id: 'f1', name: 'a.txt', mimeType: 'text/plain', size: 100, modifiedTime: '2026-01-01T00:00:00Z' },
        { id: 'f2', name: 'b.txt', mimeType: 'text/plain', size: 200, modifiedTime: '2026-01-02T00:00:00Z' },
      ],
    },
  });
  const result = await buildProjectIndex({
    client,
    projectCode: '01001',
    projectName: 'Test',
    sources: [{ name: 'src1', driveName: 'drv', role: 'internal', folderId: 'root-1' }],
    config: { max_depth: 10, skip_folders: [], skip_mime_types: [] },
  });
  assert.equal(result.project, '01001');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].entries.length, 2);
  assert.equal(result.stats.files, 2);
  assert.equal(result.stats.folders, 0);
});

test('recursive: folder with nested folder', async () => {
  const client = makeMockClient({
    'root-1': {
      folders: [{ id: 'sub-1', name: 'subdir', mimeType: 'application/vnd.google-apps.folder' }],
      files: [],
    },
    'sub-1': {
      folders: [],
      files: [
        { id: 'f1', name: 'nested.txt', mimeType: 'text/plain', size: 50, modifiedTime: '2026-01-01T00:00:00Z' },
      ],
    },
  });
  const result = await buildProjectIndex({
    client,
    projectCode: '01001',
    projectName: 'Test',
    sources: [{ name: 'src1', driveName: 'drv', role: 'internal', folderId: 'root-1' }],
    config: { max_depth: 10, skip_folders: [], skip_mime_types: [] },
  });
  const paths = result.sources[0].entries.map(e => e.path);
  assert.ok(paths.includes('subdir/'));
  assert.ok(paths.includes('subdir/nested.txt'));
  assert.equal(result.stats.files, 1);
  assert.equal(result.stats.folders, 1);
});

test('skip_folders excludes matching folders', async () => {
  const client = makeMockClient({
    'root-1': {
      folders: [
        { id: 'keep', name: 'keep', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'cache', name: 'cache', mimeType: 'application/vnd.google-apps.folder' },
      ],
      files: [],
    },
    'keep': { folders: [], files: [] },
    'cache': { folders: [], files: [{ id: 'x', name: 'x.txt', mimeType: 'text/plain', size: 1, modifiedTime: '2026-01-01T00:00:00Z' }] },
  });
  const result = await buildProjectIndex({
    client,
    projectCode: '01001',
    projectName: 'T',
    sources: [{ name: 's', driveName: 'd', role: 'internal', folderId: 'root-1' }],
    config: { max_depth: 10, skip_folders: ['cache'], skip_mime_types: [] },
  });
  const paths = result.sources[0].entries.map(e => e.path);
  assert.ok(paths.includes('keep/'));
  assert.ok(!paths.some(p => p.startsWith('cache')));
});

test('max_depth limits recursion', async () => {
  const client = makeMockClient({
    'root-1': { folders: [{ id: 'd1', name: 'd1', mimeType: 'application/vnd.google-apps.folder' }], files: [] },
    'd1': { folders: [{ id: 'd2', name: 'd2', mimeType: 'application/vnd.google-apps.folder' }], files: [] },
    'd2': { folders: [], files: [{ id: 'f', name: 'deep.txt', mimeType: 'text/plain', size: 1, modifiedTime: '2026-01-01T00:00:00Z' }] },
  });
  const result = await buildProjectIndex({
    client,
    projectCode: '01001',
    projectName: 'T',
    sources: [{ name: 's', driveName: 'd', role: 'internal', folderId: 'root-1' }],
    config: { max_depth: 1, skip_folders: [], skip_mime_types: [] },
  });
  const paths = result.sources[0].entries.map(e => e.path);
  assert.ok(paths.includes('d1/'));
  assert.ok(!paths.some(p => p.includes('d2')));
});

test('entries sorted by path lexicographically', async () => {
  const client = makeMockClient({
    'root-1': {
      folders: [],
      files: [
        { id: '3', name: 'c.txt', mimeType: 'text/plain', size: 1, modifiedTime: '2026-01-01T00:00:00Z' },
        { id: '1', name: 'a.txt', mimeType: 'text/plain', size: 1, modifiedTime: '2026-01-01T00:00:00Z' },
        { id: '2', name: 'b.txt', mimeType: 'text/plain', size: 1, modifiedTime: '2026-01-01T00:00:00Z' },
      ],
    },
  });
  const result = await buildProjectIndex({
    client,
    projectCode: '01001',
    projectName: 'T',
    sources: [{ name: 's', driveName: 'd', role: 'internal', folderId: 'root-1' }],
    config: { max_depth: 10, skip_folders: [], skip_mime_types: [] },
  });
  const paths = result.sources[0].entries.map(e => e.path);
  assert.deepEqual(paths, ['a.txt', 'b.txt', 'c.txt']);
});

test('listFolder throws → stats.skipped counted + error bubbles as partial', async () => {
  const client = {
    async listFolder(id) {
      if (id === 'broken') throw new Error('API fail');
      return { folders: [], files: [] };
    },
  };
  const result = await buildProjectIndex({
    client,
    projectCode: '01001',
    projectName: 'T',
    sources: [{ name: 's', driveName: 'd', role: 'internal', folderId: 'broken' }],
    config: { max_depth: 10, skip_folders: [], skip_mime_types: [] },
  });
  assert.equal(result.stats.skipped, 1);
});

test('skip_mime_types excludes matching files', async () => {
  const client = makeMockClient({
    'root-1': {
      folders: [],
      files: [
        { id: 'a', name: 'doc.txt', mimeType: 'text/plain', size: 1, modifiedTime: '2026-01-01T00:00:00Z' },
        { id: 'b', name: 'shortcut', mimeType: 'application/vnd.google-apps.shortcut', size: 0, modifiedTime: '2026-01-01T00:00:00Z' },
      ],
    },
  });
  const result = await buildProjectIndex({
    client,
    projectCode: '01001',
    projectName: 'T',
    sources: [{ name: 's', driveName: 'd', role: 'internal', folderId: 'root-1' }],
    config: { max_depth: 10, skip_folders: [], skip_mime_types: ['application/vnd.google-apps.shortcut'] },
  });
  const ids = result.sources[0].entries.map(e => e.id);
  assert.deepEqual(ids, ['a']);
});

test('generated field is ISO timestamp', async () => {
  const client = makeMockClient({ 'root-1': { folders: [], files: [] } });
  const result = await buildProjectIndex({
    client,
    projectCode: '01001',
    projectName: 'T',
    sources: [{ name: 's', driveName: 'd', role: 'internal', folderId: 'root-1' }],
    config: { max_depth: 10, skip_folders: [], skip_mime_types: [] },
  });
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(result.generated));
});
```

### Task 4.2: Implement `project-indexer.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/gdrive-index/lib/project-indexer.mjs`:
```javascript
/**
 * Build a drive-index.json shape for one project given:
 *   - client: { listFolder(id) → {folders: [...], files: [...]} }
 *   - projectCode, projectName
 *   - sources: [{name, driveName, role, folderId}]
 *   - config: {max_depth, skip_folders, skip_mime_types}
 */

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function walk({ client, folderId, parentPath, depth, maxDepth, skipFolders, skipMimeTypes, stats, entries }) {
  if (depth >= maxDepth) return;
  let listing;
  try {
    listing = await client.listFolder(folderId);
  } catch (err) {
    stats.skipped += 1;
    return;
  }
  for (const f of (listing.folders || [])) {
    if (skipFolders.includes(f.name)) continue;
    const path = `${parentPath}${f.name}/`;
    entries.push({
      path,
      type: 'folder',
      id: f.id,
      mimeType: FOLDER_MIME,
      size: 0,
    });
    stats.folders += 1;
    await walk({ client, folderId: f.id, parentPath: path, depth: depth + 1, maxDepth, skipFolders, skipMimeTypes, stats, entries });
  }
  for (const file of (listing.files || [])) {
    if (skipMimeTypes.includes(file.mimeType)) continue;
    entries.push({
      path: `${parentPath}${file.name}`,
      type: 'file',
      id: file.id,
      mimeType: file.mimeType,
      size: Number(file.size ?? 0),
      modifiedTime: file.modifiedTime,
    });
    stats.files += 1;
  }
}

export async function buildProjectIndex({ client, projectCode, projectName, sources, config }) {
  const stats = { folders: 0, files: 0, skipped: 0 };
  const outSources = [];
  for (const src of sources) {
    const entries = [];
    await walk({
      client,
      folderId: src.folderId,
      parentPath: '',
      depth: 0,
      maxDepth: config.max_depth ?? 10,
      skipFolders: config.skip_folders ?? [],
      skipMimeTypes: config.skip_mime_types ?? [],
      stats,
      entries,
    });
    entries.sort((a, b) => a.path.localeCompare(b.path));
    outSources.push({
      name: src.name,
      driveName: src.driveName,
      role: src.role,
      folderId: src.folderId,
      entries,
    });
  }
  return {
    project: projectCode,
    name: projectName,
    generated: new Date().toISOString(),
    stats,
    sources: outSources,
  };
}
```

- [ ] **Step 2: Run tests**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/gdrive-index
npm test
```

Expected: PASS — 8 tests (change-detector 7 + project-indexer 8 = but individual files show their own counts).

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git add services/gdrive-index/lib/project-indexer.mjs services/gdrive-index/test/project-indexer.test.mjs
git commit -m "feat(gdrive-index): add project-indexer (recursive walk)

Pure function buildProjectIndex builds full drive-index.json given
injected client + sources + config. Walks folders recursively with
max_depth cap, applies skip_folders and skip_mime_types filters,
returns entries sorted by path for deterministic git diffs.

Tests: 8 passing covering single folder, recursive nested, skip
rules, max_depth, sort, listFolder error (stats.skipped), mime
skip, generated timestamp format.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: `drive-client.mjs` (I/O wrapper)

Wraps `googleapis` Drive v3 `files.list` with pagination + retry backoff in 429/5xx. Also exposes `listFolder(id)` returning `{folders, files}`.

**Files:**
- Create: `services/gdrive-index/lib/drive-client.mjs`
- Create: `services/gdrive-index/test/drive-client.test.mjs`

### Task 5.1: Write tests (mocking the underlying API)

- [ ] **Step 1: Create test file**

Content of `services/gdrive-index/test/drive-client.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveClient } from '../lib/drive-client.mjs';

function makeRaw({ pages = [[]], shouldFailWith = null, failTimes = 0 }) {
  let callCount = 0;
  let currentFailures = 0;
  return {
    files: {
      async list({ pageToken }) {
        callCount += 1;
        if (currentFailures < failTimes) {
          currentFailures += 1;
          const err = new Error('simulated');
          err.code = shouldFailWith;
          throw err;
        }
        const pageIndex = pageToken ? parseInt(pageToken, 10) : 0;
        const page = pages[pageIndex] || [];
        const next = pageIndex + 1 < pages.length ? String(pageIndex + 1) : undefined;
        return {
          data: { files: page, nextPageToken: next },
        };
      },
    },
    _callCount: () => callCount,
  };
}

test('listFolder returns { folders, files } split by mimeType', async () => {
  const raw = makeRaw({
    pages: [[
      { id: 'a', name: 'subdir', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'b', name: 'f.txt', mimeType: 'text/plain', size: '100', modifiedTime: '2026-01-01T00:00:00Z' },
    ]],
  });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  const result = await client.listFolder('root');
  assert.equal(result.folders.length, 1);
  assert.equal(result.files.length, 1);
  assert.equal(result.folders[0].id, 'a');
  assert.equal(result.files[0].id, 'b');
});

test('listFolder handles pagination (2 pages)', async () => {
  const raw = makeRaw({
    pages: [
      [{ id: 'a', name: 'f1', mimeType: 'text/plain', size: '1', modifiedTime: '2026-01-01T00:00:00Z' }],
      [{ id: 'b', name: 'f2', mimeType: 'text/plain', size: '1', modifiedTime: '2026-01-01T00:00:00Z' }],
    ],
  });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  const result = await client.listFolder('root');
  assert.equal(result.files.length, 2);
});

test('listFolder retries on 429 up to configured attempts', async () => {
  const raw = makeRaw({
    pages: [[{ id: 'x', name: 'f.txt', mimeType: 'text/plain', size: '1', modifiedTime: '2026-01-01T00:00:00Z' }]],
    shouldFailWith: 429,
    failTimes: 2,
  });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 2, backoffMs: 1 } });
  const result = await client.listFolder('root');
  assert.equal(result.files.length, 1);
});

test('listFolder gives up after exhausting retries and throws', async () => {
  const raw = makeRaw({
    pages: [[]],
    shouldFailWith: 429,
    failTimes: 100,
  });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 2, backoffMs: 1 } });
  await assert.rejects(() => client.listFolder('root'), /simulated/);
});

test('listFolder does not retry on 404', async () => {
  const raw = makeRaw({ pages: [[]], shouldFailWith: 404, failTimes: 1 });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 3, backoffMs: 1 } });
  await assert.rejects(() => client.listFolder('missing'), /simulated/);
  assert.equal(raw._callCount(), 1);
});
```

### Task 5.2: Implement `drive-client.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/gdrive-index/lib/drive-client.mjs`:
```javascript
/**
 * Drive client wrapping googleapis Drive v3 with pagination + retry.
 * Returns {folders, files} keyed by mimeType for each folder.
 */

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const RETRIABLE_CODES = new Set([429, 500, 502, 503, 504]);
const FIELDS = 'nextPageToken, files(id, name, mimeType, size, modifiedTime)';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createDriveClient({ rawClient, retry = { attempts: 2, backoffMs: 2000 } }) {
  async function callWithRetry(fn) {
    let lastErr;
    for (let i = 0; i <= retry.attempts; i += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!RETRIABLE_CODES.has(err.code)) throw err;
        if (i < retry.attempts) {
          await sleep(retry.backoffMs * Math.pow(2, i));
        }
      }
    }
    throw lastErr;
  }

  async function listFolder(folderId, { pageSize = 100 } = {}) {
    const folders = [];
    const files = [];
    let pageToken;
    do {
      const res = await callWithRetry(() => rawClient.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: FIELDS,
        pageSize,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }));
      const batch = res.data.files || [];
      for (const f of batch) {
        if (f.mimeType === FOLDER_MIME) folders.push(f);
        else files.push(f);
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return { folders, files };
  }

  async function getMetadata(id) {
    return await callWithRetry(() => rawClient.files.get({
      fileId: id,
      fields: 'id, name, mimeType, size, modifiedTime',
      supportsAllDrives: true,
    }));
  }

  return { listFolder, getMetadata };
}
```

- [ ] **Step 2: Run tests**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/gdrive-index
npm test
```

Expected: PASS — 5 drive-client tests.

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git add services/gdrive-index/lib/drive-client.mjs services/gdrive-index/test/drive-client.test.mjs
git commit -m "feat(gdrive-index): add drive-client wrapper with retry

googleapis Drive v3 wrapper: listFolder returns {folders, files}
split by mimeType; paginates via pageToken; retries 429/5xx with
exponential backoff up to configured attempts; does NOT retry 404.
supportsAllDrives=true on all calls.

Tests: 5 passing with mocked raw client covering split, pagination,
retry success, retry exhaustion, and no-retry on 404.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6: `config.mjs` + wiring

Loads `service.json` + reads `project-codes.json` from the PMO clone.

**Files:**
- Create: `services/gdrive-index/config/service.json`
- Create: `services/gdrive-index/lib/config.mjs`
- Create: `services/gdrive-index/test/config.test.mjs`

### Task 6.1: Write `service.json`

- [ ] **Step 1: Write production config**

Content of `services/gdrive-index/config/service.json`:
```json
{
  "pmo_repo": {
    "url": "git@github.com:teruelskm/pmo.git",
    "branch": "master",
    "clone_path": "/opt/jarvis-gdrive-index/data/pmo-clone",
    "commit_author_name": "JARVIS gdrive-index",
    "commit_author_email": "jarvis-gdrive-index@strokmatic.internal"
  },
  "project_codes_path": "config/project-codes.json",
  "output_path_template": "projects/{code}/drive-index.json",
  "drive": {
    "max_depth": 10,
    "page_size": 100,
    "skip_folders": ["cache", "node_modules", ".git"],
    "skip_mime_types": []
  },
  "retry": {
    "attempts": 2,
    "backoff_ms": 2000
  }
}
```

### Task 6.2: Write config tests

- [ ] **Step 1: Create test file**

Content of `services/gdrive-index/test/config.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig, loadProjectCodes } from '../lib/config.mjs';

test('loadConfig reads valid service.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 'service.json');
  writeFileSync(path, JSON.stringify({
    pmo_repo: { url: 'git@x', branch: 'master', clone_path: '/tmp/x', commit_author_name: 'n', commit_author_email: 'e@x' },
    project_codes_path: 'p',
    output_path_template: 'projects/{code}/drive-index.json',
    drive: { max_depth: 10, page_size: 100, skip_folders: [], skip_mime_types: [] },
    retry: { attempts: 2, backoff_ms: 1 },
  }));
  const cfg = loadConfig(path);
  assert.equal(cfg.pmo_repo.branch, 'master');
});

test('loadConfig throws on missing required fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 'bad.json');
  writeFileSync(path, JSON.stringify({ pmo_repo: {} }));
  assert.throws(() => loadConfig(path));
});

test('loadProjectCodes filters projects with drive.folders populated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 'project-codes.json');
  writeFileSync(path, JSON.stringify({
    projects: [
      { code: '01001', name: 'A', product: 'diemaster', drive: { folders: [{ id: '1', name: 'f', role: 'internal' }] } },
      { code: '02008', name: 'B', product: 'spotfusion', drive: { folders: [] } },
      { code: '03002', name: 'C', product: 'visionking' },
    ],
  }));
  const { enabled, skipped } = loadProjectCodes(path);
  assert.equal(enabled.length, 1);
  assert.equal(enabled[0].code, '01001');
  assert.equal(skipped.length, 2);
});
```

### Task 6.3: Implement `config.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/gdrive-index/lib/config.mjs`:
```javascript
import { readFileSync } from 'node:fs';

const REQUIRED = [
  ['pmo_repo', 'url'],
  ['pmo_repo', 'branch'],
  ['pmo_repo', 'clone_path'],
  ['pmo_repo', 'commit_author_name'],
  ['pmo_repo', 'commit_author_email'],
  ['project_codes_path'],
  ['output_path_template'],
];

function get(obj, path) {
  return path.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

export function loadConfig(configPath) {
  const content = readFileSync(configPath, 'utf-8');
  const cfg = JSON.parse(content);
  for (const path of REQUIRED) {
    if (get(cfg, path) == null) {
      throw new Error(`missing required config: ${path.join('.')}`);
    }
  }
  return cfg;
}

export function loadProjectCodes(path) {
  const content = readFileSync(path, 'utf-8');
  const raw = JSON.parse(content);
  const list = Array.isArray(raw.projects) ? raw.projects : [];
  const enabled = [];
  const skipped = [];
  for (const p of list) {
    if (p.drive?.folders?.length > 0) enabled.push(p);
    else skipped.push(p);
  }
  return { enabled, skipped };
}
```

- [ ] **Step 2: Run tests**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/gdrive-index
npm test
```

Expected: PASS — all tests.

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git add services/gdrive-index/config/service.json services/gdrive-index/lib/config.mjs services/gdrive-index/test/config.test.mjs
git commit -m "feat(gdrive-index): add config loader + production service.json

loadConfig validates required fields from service.json.
loadProjectCodes splits projects into enabled (drive.folders
populated) vs skipped.

Production service.json has PMO repo URL, paths, Drive defaults
(max_depth=10, skip node_modules/.git/cache), retry (2x backoff
2s).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7: `index.mjs` orchestrator + integration smoke

Glues everything together. Writes state.json via the shared state-writer.

**Files:**
- Create: `services/gdrive-index/index.mjs`
- Create: `services/gdrive-index/test/test-integration.mjs`

### Task 7.1: Write orchestrator

- [ ] **Step 1: Implement `index.mjs`**

Content of `services/gdrive-index/index.mjs`:
```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDriveClient } from '../_shared/google-auth.mjs';
import { createPmoGit } from '../_shared/pmo-git.mjs';

import { loadConfig, loadProjectCodes } from './lib/config.mjs';
import { createDriveClient } from './lib/drive-client.mjs';
import { buildProjectIndex } from './lib/project-indexer.mjs';
import { diff } from './lib/change-detector.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.HM_DATA_DIR || join(__dirname, 'data');
const CONFIG_PATH = process.env.HM_CONFIG_PATH || join(__dirname, 'config/service.json');
const STATE_PATH = join(DATA_DIR, 'state.json');

const DRY_RUN = process.env.HM_DRY_RUN === '1';
const SKIP_PUSH = process.env.HM_SKIP_PUSH === '1';
const ONLY_PROJECT = process.env.HM_ONLY_PROJECT || null;

function writeState({ startedAt, status, exitCode, details }) {
  mkdirSync(DATA_DIR, { recursive: true });
  const state = {
    service: 'gdrive-index',
    last_run: new Date().toISOString(),
    last_status: status,
    duration_ms: Date.now() - startedAt,
    exit_code: exitCode,
    details,
  };
  const tmp = `${STATE_PATH}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmp, STATE_PATH);
}

async function main() {
  const startedAt = Date.now();
  const details = {
    projects_scanned: 0,
    projects_indexed: 0,
    projects_skipped_no_drive_config: 0,
    projects_with_changes: 0,
    projects_failed: 0,
    total_files_indexed: 0,
    git_commit_sha: null,
    pushed: false,
  };

  let cfg;
  try {
    cfg = loadConfig(CONFIG_PATH);
  } catch (err) {
    console.error('[gdrive-index] fatal: config load failed', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details: { ...details, error: String(err.message) } });
    process.exit(1);
  }

  const pmoGit = createPmoGit({
    url: cfg.pmo_repo.url,
    branch: cfg.pmo_repo.branch,
    clonePath: cfg.pmo_repo.clone_path,
    author: { name: cfg.pmo_repo.commit_author_name, email: cfg.pmo_repo.commit_author_email },
  });

  try {
    await pmoGit.cloneOrPull();
  } catch (err) {
    console.error('[gdrive-index] fatal: pmo clone/pull failed', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details: { ...details, error: String(err.message) } });
    process.exit(1);
  }

  const projectCodesPath = join(cfg.pmo_repo.clone_path, cfg.project_codes_path);
  const { enabled, skipped } = loadProjectCodes(projectCodesPath);
  details.projects_scanned = enabled.length + skipped.length;
  details.projects_skipped_no_drive_config = skipped.length;

  let rawDriveClient;
  try {
    rawDriveClient = getDriveClient({
      scopes: ['https://www.googleapis.com/auth/drive'],
      subject: 'pedro@lumesolutions.com',
    });
  } catch (err) {
    console.error('[gdrive-index] fatal: drive auth failed', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details });
    process.exit(1);
  }
  const driveClient = createDriveClient({
    rawClient: rawDriveClient,
    retry: cfg.retry && { attempts: cfg.retry.attempts, backoffMs: cfg.retry.backoff_ms },
  });

  const selected = ONLY_PROJECT ? enabled.filter(p => p.code === ONLY_PROJECT) : enabled;
  const changedProjects = [];

  for (const project of selected) {
    try {
      const outPath = join(cfg.pmo_repo.clone_path, cfg.output_path_template.replace('{code}', project.code));
      const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf-8')) : null;
      const newIndex = await buildProjectIndex({
        client: driveClient,
        projectCode: project.code,
        projectName: project.name,
        sources: project.drive.folders,
        config: cfg.drive,
      });
      const d = diff(existing, newIndex);
      details.total_files_indexed += newIndex.stats.files;
      details.projects_indexed += 1;
      if (d.changed) {
        if (!DRY_RUN) {
          await pmoGit.writeAtRelPath(
            cfg.output_path_template.replace('{code}', project.code),
            newIndex
          );
        }
        details.projects_with_changes += 1;
        changedProjects.push(project.code);
        console.log(`[gdrive-index] ${project.code}: +${d.added.length} -${d.removed.length} ~${d.modified.length}`);
      } else {
        console.log(`[gdrive-index] ${project.code}: no changes`);
      }
    } catch (err) {
      console.error(`[gdrive-index] project ${project.code} failed:`, err.message);
      details.projects_failed += 1;
    }
  }

  if (!DRY_RUN && details.projects_with_changes > 0) {
    const msg = `chore(gdrive-index): daily refresh — ${details.projects_with_changes} projects with changes\n\nChanged: ${changedProjects.join(', ')}\n`;
    const committed = await pmoGit.commitAll(msg);
    if (committed) {
      details.git_commit_sha = (await pmoGit.headSha()).slice(0, 7);
      if (!SKIP_PUSH) {
        try {
          await pmoGit.push();
          details.pushed = true;
        } catch (err) {
          console.error('[gdrive-index] push failed:', err.message);
          details.pushed = false;
        }
      }
    }
  }

  let status = 'success';
  if (details.projects_failed > 0) status = 'partial';
  if (details.projects_with_changes > 0 && !details.pushed && !DRY_RUN && !SKIP_PUSH) status = 'partial';
  const exitCode = status === 'failed' ? 1 : 0;
  writeState({ startedAt, status, exitCode, details });
  process.exit(exitCode);
}

main().catch(async (err) => {
  console.error('[gdrive-index] uncaught:', err);
  process.exit(1);
});
```

### Task 7.2: Write integration smoke test

- [ ] **Step 1: Create smoke test**

Content of `services/gdrive-index/test/test-integration.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = dirname(__dirname);

function setupFakePmoRemote() {
  const remote = mkdtempSync(join(tmpdir(), 'pmo-remote-'));
  execSync('git init --bare', { cwd: remote });
  const seed = mkdtempSync(join(tmpdir(), 'pmo-seed-'));
  execSync('git init -b master', { cwd: seed });
  execSync('git config user.email "seed@test.internal"', { cwd: seed });
  execSync('git config user.name "seed"', { cwd: seed });
  mkdirSync(join(seed, 'config'));
  writeFileSync(join(seed, 'config/project-codes.json'), JSON.stringify({
    projects: [
      { code: '99999', name: 'Test', product: 'test', drive: { folders: [] } },
    ],
  }), 'utf-8');
  execSync('git add .', { cwd: seed });
  execSync('git commit -m "seed"', { cwd: seed });
  execSync(`git remote add origin ${remote}`, { cwd: seed });
  execSync('git push origin master', { cwd: seed });
  return { remote };
}

test('integration: DRY_RUN + no enabled projects → success with scanned counts', async () => {
  const { remote } = setupFakePmoRemote();
  const dataDir = mkdtempSync(join(tmpdir(), 'gdrive-data-'));
  const cloneDir = join(dataDir, 'pmo-clone');
  const configPath = join(mkdtempSync(join(tmpdir(), 'gdrive-cfg-')), 'service.json');
  writeFileSync(configPath, JSON.stringify({
    pmo_repo: {
      url: remote,
      branch: 'master',
      clone_path: cloneDir,
      commit_author_name: 'test',
      commit_author_email: 'test@test.internal',
    },
    project_codes_path: 'config/project-codes.json',
    output_path_template: 'projects/{code}/drive-index.json',
    drive: { max_depth: 10, page_size: 100, skip_folders: [], skip_mime_types: [] },
    retry: { attempts: 0, backoff_ms: 1 },
  }), 'utf-8');

  const result = spawnSync('node', ['index.mjs'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      HM_DATA_DIR: dataDir,
      HM_CONFIG_PATH: configPath,
      HM_DRY_RUN: '1',
      HM_SKIP_PUSH: '1',
      GCP_SERVICE_ACCOUNT_KEY: '/home/strokmatic/.secrets/gcp-service-account.json',
    },
    encoding: 'utf-8',
  });

  // Allow failure if auth fails (local dev without key) — but check state.json regardless
  const statePath = join(dataDir, 'state.json');
  assert.ok(existsSync(statePath), `state.json should exist: stdout=${result.stdout}, stderr=${result.stderr}`);
  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  assert.equal(state.service, 'gdrive-index');
  // If auth works (running on server), projects_scanned should be 1 + 0 skipped
  if (state.last_status !== 'failed') {
    assert.equal(state.details.projects_scanned, 1);
    assert.equal(state.details.projects_skipped_no_drive_config, 1);
  }
});
```

- [ ] **Step 2: Make index.mjs executable**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/gdrive-index
chmod +x index.mjs
```

- [ ] **Step 3: Run integration smoke**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/gdrive-index
node --test test/test-integration.mjs
```

Expected: PASS if GCP key exists locally, or `state.last_status === 'failed'` if it doesn't (both accepted by the test).

- [ ] **Step 4: Run full test suite**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/gdrive-index
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit orchestrator + smoke**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git add services/gdrive-index/index.mjs services/gdrive-index/test/test-integration.mjs
git commit -m "feat(gdrive-index): add orchestrator index.mjs + integration smoke

End-to-end pipeline: loadConfig → auth → cloneOrPull → iterate
projects → buildIndex → diff → write (skip if unchanged) → commit
(if changes) → push. Emits state.json canonical with details
(projects_scanned, indexed, with_changes, failed, total_files,
commit_sha, pushed).

Env flags: HM_DRY_RUN skips writes/commits; HM_SKIP_PUSH keeps
commits local; HM_ONLY_PROJECT scopes iteration; HM_DATA_DIR and
HM_CONFIG_PATH override defaults.

Integration smoke: 1 test using bare local remote + fake
project-codes; tolerates auth fail for local dev environments.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8: Shell scaffolding

Production-ready `run.sh` and `deploy.sh` matching infra patterns.

**Files:**
- Create: `services/gdrive-index/run.sh`
- Create: `services/gdrive-index/deploy.sh`

### Task 8.1: `run.sh`

- [ ] **Step 1: Write run.sh**

Content of `services/gdrive-index/run.sh`:
```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Rotate log daily
LOG_FILE="$SCRIPT_DIR/logs/run-$(date -u +%Y-%m-%d).log"
mkdir -p "$SCRIPT_DIR/logs"

# Concurrency guard — avoid overlap if previous run still going
LOCK_FILE="$SCRIPT_DIR/data/run.lock"
mkdir -p "$SCRIPT_DIR/data"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date -u +%FT%TZ)] gdrive-index: previous run still in flight, skipping" >> "$LOG_FILE"
  exit 0
fi

{
  echo "[$(date -u +%FT%TZ)] gdrive-index: starting"
  node index.mjs
  echo "[$(date -u +%FT%TZ)] gdrive-index: done (exit $?)"
} >> "$LOG_FILE" 2>&1
```

- [ ] **Step 2: Make executable**

```bash
chmod +x services/gdrive-index/run.sh
```

### Task 8.2: `deploy.sh`

- [ ] **Step 1: Write deploy.sh**

Content of `services/gdrive-index/deploy.sh`:
```bash
#!/bin/bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-strokmatic@192.168.15.2}"
REMOTE_DIR="${REMOTE_DIR:-/opt/jarvis-gdrive-index}"
SHARED_REMOTE_DIR="${SHARED_REMOTE_DIR:-/opt/_shared}"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 22 * * *}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Require SSHPASS env
: "${SSHPASS:?SSHPASS env var required}"

SSH="sshpass -e ssh -o StrictHostKeyChecking=no"
RSYNC="sshpass -e rsync -e 'ssh -o StrictHostKeyChecking=no'"

echo "==> ensuring remote directories"
$SSH "$REMOTE_HOST" "sudo -S mkdir -p $REMOTE_DIR $SHARED_REMOTE_DIR && sudo -S chown -R strokmatic:strokmatic $REMOTE_DIR $SHARED_REMOTE_DIR" <<< "$SSHPASS"

echo "==> syncing _shared to $SHARED_REMOTE_DIR"
bash -c "$RSYNC -a --delete --exclude 'node_modules' --exclude 'test' \"$SCRIPT_DIR/../_shared/\" \"$REMOTE_HOST:$SHARED_REMOTE_DIR/\""

echo "==> installing _shared deps on remote"
$SSH "$REMOTE_HOST" ". /home/strokmatic/.nvm/nvm.sh && cd $SHARED_REMOTE_DIR && npm install --omit=dev"

echo "==> syncing gdrive-index to $REMOTE_DIR"
bash -c "$RSYNC -a --delete --exclude 'node_modules' --exclude 'data' --exclude 'logs' --exclude 'test' \"$SCRIPT_DIR/\" \"$REMOTE_HOST:$REMOTE_DIR/\""

echo "==> installing gdrive-index deps on remote"
$SSH "$REMOTE_HOST" ". /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && npm install --omit=dev"

echo "==> patching import path from '../_shared/' to '$SHARED_REMOTE_DIR/'"
$SSH "$REMOTE_HOST" "sed -i 's|from '\''../_shared/|from '\''$SHARED_REMOTE_DIR/|g' $REMOTE_DIR/index.mjs $REMOTE_DIR/lib/*.mjs" || true

echo "==> installing cron"
$SSH "$REMOTE_HOST" "crontab -l 2>/dev/null | grep -v 'gdrive-index' > /tmp/cron.new; echo '$CRON_SCHEDULE . /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && bash run.sh' >> /tmp/cron.new; crontab /tmp/cron.new"

echo "==> deploy complete"
$SSH "$REMOTE_HOST" "crontab -l | grep gdrive-index"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x services/gdrive-index/deploy.sh
```

- [ ] **Step 3: Commit shell scaffolding**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git add services/gdrive-index/run.sh services/gdrive-index/deploy.sh
git commit -m "feat(gdrive-index): add run.sh and deploy.sh

run.sh: flock concurrency guard, daily log rotation, sources
nvm, calls node index.mjs.

deploy.sh: rsync _shared + gdrive-index to remote via sshpass,
install deps, patch import paths from '../_shared/' to
/opt/_shared/, install cron 0 22 * * * pattern per infra
convention.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 9: Deploy + dry-run

Deploy to `192.168.15.2`. Prerequisites: GCP key already copied (if not, replicate here).

### Task 9.1: Copy GCP key to server (one-time)

- [ ] **Step 1: Check if key already on server**

```bash
SSHPASS='<skm-password>' sshpass -e ssh -o StrictHostKeyChecking=no strokmatic@192.168.15.2 "ls -la /home/strokmatic/.secrets/gcp-service-account.json 2>&1 || echo MISSING"
```

If MISSING, continue to step 2; otherwise skip to Task 9.2.

- [ ] **Step 2: Copy key**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 "mkdir -p ~/.secrets && chmod 700 ~/.secrets"
SSHPASS='<skm-password>' sshpass -e scp -o StrictHostKeyChecking=no /home/teruel/JARVIS/config/credentials/gcp-service-account.json strokmatic@192.168.15.2:/home/strokmatic/.secrets/gcp-service-account.json
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 "chmod 600 /home/strokmatic/.secrets/gcp-service-account.json"
```

- [ ] **Step 3: Verify**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 "ls -la /home/strokmatic/.secrets/gcp-service-account.json"
```

Expected: `-rw------- 1 strokmatic strokmatic ...`

### Task 9.2: Deploy + dry-run

- [ ] **Step 1: Deploy**

```bash
cd /home/teruel/worktrees/infra-gdrive-index/services/gdrive-index
SSHPASS='<skm-password>' bash deploy.sh
```

Expected: rsync output, npm install complete, cron entry visible.

- [ ] **Step 2: Run dry-run manually**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-gdrive-index && HM_DRY_RUN=1 node index.mjs 2>&1 | tail -50"
```

Expected: output showing projects enumerated, per-project `+N -N ~N` or `no changes`, final exit.

- [ ] **Step 3: Check state.json after dry-run**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 "cat /opt/jarvis-gdrive-index/data/state.json"
```

Expected: `last_status: success`, `projects_scanned: ~25`, `projects_indexed: ~22`.

### Task 9.3: Single-project real run

- [ ] **Step 1: Run ONLY for 03002 (VisionKing) without dry-run**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-gdrive-index && HM_ONLY_PROJECT=03002 node index.mjs 2>&1 | tail -30"
```

- [ ] **Step 2: Verify commit in PMO repo**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git pull origin master
ls projects/03002/drive-index.json
```

Expected: file exists, recent timestamp.

- [ ] **Step 3: Spot-check the diff quality**

```bash
git log -1 -- projects/03002/drive-index.json
```

Expected: a commit from "JARVIS gdrive-index".

---

## Phase 10: Full activation + health-monitor registration

### Task 10.1: Register in health-monitor

**Files:**
- Modify: `services/health-monitor/config/services.json`

- [ ] **Step 1: Read current services.json**

```bash
cat services/health-monitor/config/services.json
```

- [ ] **Step 2: Add gdrive-index entry**

Add to `services` array:
```json
{
  "name": "gdrive-index",
  "state_path": "/opt/jarvis-gdrive-index/data/state.json",
  "max_staleness_minutes": 1500,
  "alert_on_status": ["failed"],
  "alert_on_partial": true,
  "added_at": null
}
```

(Staleness 1500min = 25h, giving 1h buffer past the 24h cron cycle.)

- [ ] **Step 3: Sync to server**

```bash
SSHPASS='<skm-password>' sshpass -e rsync -e 'ssh -o StrictHostKeyChecking=no' services/health-monitor/config/services.json strokmatic@192.168.15.2:/opt/jarvis-health-monitor/config/services.json
```

- [ ] **Step 4: Commit**

```bash
git add services/health-monitor/config/services.json
git commit -m "feat(health-monitor): register gdrive-index service

added_at=null leaves monitoring disabled until first successful
run. Will flip to timestamp after Phase 4 ativação plena.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 10.2: First scheduled run

- [ ] **Step 1: Wait for next cron 22:00 UTC OR trigger manually**

Manual trigger:
```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-gdrive-index && bash run.sh"
```

- [ ] **Step 2: Check log**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 "tail -50 /opt/jarvis-gdrive-index/logs/run-\$(date -u +%Y-%m-%d).log"
```

- [ ] **Step 3: Check state.json**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 "cat /opt/jarvis-gdrive-index/data/state.json | python3 -m json.tool"
```

Expected: `last_status: success`, all projects indexed, expected `total_files_indexed`.

- [ ] **Step 4: Flip `added_at` in services.json**

```bash
NOW=$(date -u +%FT%TZ)
# Update local services.json file to set added_at to $NOW, then rsync.
```

Edit `services/health-monitor/config/services.json`: change `"added_at": null` to the timestamp.

```bash
SSHPASS='<skm-password>' sshpass -e rsync services/health-monitor/config/services.json strokmatic@192.168.15.2:/opt/jarvis-health-monitor/config/services.json
git add services/health-monitor/config/services.json
git commit -m "chore(health-monitor): activate gdrive-index monitoring

Flip added_at to current timestamp after successful first run.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 11: Deprecate old script + PR

### Task 11.1: Deprecate JARVIS host script

- [ ] **Step 1: Move old script**

In JARVIS repo (separate from infra worktree):
```bash
cd /home/teruel/JARVIS
git checkout -b deprecate/gdrive-index-script
mkdir -p scripts/deprecated
git mv scripts/gdrive-index.sh scripts/deprecated/gdrive-index.sh.DEPRECATED
```

- [ ] **Step 2: Add deprecation note header to the moved file**

Prepend to `scripts/deprecated/gdrive-index.sh.DEPRECATED`:
```bash
#!/bin/bash
# DEPRECATED 2026-04-15 — replaced by infra service at /opt/jarvis-gdrive-index/
# Spec: docs/superpowers/specs/2026-04-15-gdrive-index-design.md
# Plan: docs/superpowers/plans/2026-04-15-gdrive-index.md
# Do not use. Kept only for reference during rollback window.
exit 1
```

- [ ] **Step 3: Commit and merge later (separate PR to JARVIS repo)**

```bash
git add scripts/deprecated/gdrive-index.sh.DEPRECATED
git commit -m "chore(scripts): deprecate gdrive-index.sh

Replaced by infra service. Kept with DEPRECATED suffix for rollback
reference; guarded with 'exit 1' to prevent accidental use.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 11.2: Open PR for infra feature branch

- [ ] **Step 1: Push feature branch**

```bash
cd /home/teruel/worktrees/infra-gdrive-index
git push -u origin feature/gdrive-index
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(gdrive-index): new service for daily Drive indexing" --body "$(cat <<'EOF'
## Summary

- Ships `gdrive-index` as cron service at `/opt/jarvis-gdrive-index/`
- Establishes `services/_shared/google-auth.mjs` + `services/_shared/pmo-git.mjs` (consumed by email-index and meeting-index later)
- Pushes `drive-index.json` per project to PMO repo (`teruelskm/pmo`) via git
- Registered in health-monitor (initially `added_at: null`, flipped after first successful run)

## Architecture

Spec: [`docs/superpowers/specs/2026-04-15-gdrive-index-design.md`](https://github.com/teruelskm/JARVIS/blob/master/docs/superpowers/specs/2026-04-15-gdrive-index-design.md)
Plan: [`docs/superpowers/plans/2026-04-15-gdrive-index.md`](https://github.com/teruelskm/JARVIS/blob/master/docs/superpowers/plans/2026-04-15-gdrive-index.md)

## Test plan

- [x] `_shared/google-auth.mjs`: 6 tests passing
- [x] `_shared/pmo-git.mjs`: 6 tests passing (bare-repo fixtures)
- [x] `change-detector.mjs`: 7 tests passing
- [x] `project-indexer.mjs`: 8 tests passing
- [x] `drive-client.mjs`: 5 tests passing
- [x] `config.mjs`: 3 tests passing
- [x] Integration smoke with fake remote
- [x] Deploy dry-run on server OK
- [x] Single-project run (03002) OK
- [x] First full cron run OK
- [x] Health-monitor reports healthy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Await review; merge when approved**

(Manual step; PR URL reported to user.)

---

## Self-review checkpoints

### Spec coverage
- §4.1 runtime → Phase 0 + Phase 8 run.sh
- §4.2 tree → Phase 0 scaffolding
- §4.3 module table → Phases 1-6
- §4.4 flow → Phase 7 index.mjs
- §5 schemas → Phase 6 service.json, Phase 7 state.json shape
- §6 error handling → Phase 7 orchestrator try/catch
- §7 integration → Phase 9-11
- §8 tests → Phases 1-7 each with tests
- §9 rollout → Phases 9-11 map 1:1 (Fase 0-5)
- §10 success criteria → Phase 10 Task 10.2 monitors

### Type consistency
- `drive-client.listFolder(id)` returns `{folders, files}` throughout
- `project-indexer.buildProjectIndex` takes injected `client` with that shape
- `change-detector.diff` takes two indexes with `{sources: [{entries: [...]}]}` shape
- `pmo-git.writeProject(code, relPath, data)` AND `writeAtRelPath(relPath, data)` both available; orchestrator uses `writeAtRelPath` since path template includes `projects/{code}/`
- `getDriveClient`, `getGmailClient` return raw googleapis clients (wrapped by service-level clients)

### Scope
- Single service + 2 shared libs. Coherent unit. Not too big.

---

**Execution handoff:** plan complete and saved to `docs/superpowers/plans/2026-04-15-gdrive-index.md`. Recommended to execute via **superpowers:subagent-driven-development** for fast iteration with per-task review. Alternative: **superpowers:executing-plans** for inline execution with checkpoints.
