# meeting-index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `meeting-index` as a daily cron service at `/opt/jarvis-meeting-index/` that scans Gemini meeting notes in `Meu Drive/Meet Recordings`, classifies dailies and sprint meetings per product, moves them to `[0N] Produto / 00 - Anotações Reuniões/`, and pushes `products/{produto}/meetings/index.json` to PMO repo.

**Architecture:** Node.js ESM service. Reuses `services/_shared/google-auth.mjs` and `services/_shared/pmo-git.mjs` (from gdrive-index plan). Pure modules: classifier (regex permissivo), dedup (per-product index). I/O modules: drive-client (list/move/metadata with `supportsAllDrives=true`), index-writer (clone-local), config.

**Tech Stack:** Node.js 20+ ESM, `googleapis`, `node:test`, bash, cron, git.

**Spec reference:** `docs/superpowers/specs/2026-04-15-meeting-index-design.md`

**Repository:** `workspaces/strokmatic/infra/`. Branch `feature/meeting-index` off `master`.

---

## Prerequisites

**CRITICAL — must exist before starting Phase 1:**
- `services/_shared/google-auth.mjs` with `getDriveClient({scopes, subject})` factory
- `services/_shared/pmo-git.mjs` with `createPmoGit(...)` factory
- `/home/strokmatic/.secrets/gcp-service-account.json` on server
- PMO repo SSH push access

All provisioned by the gdrive-index plan (`docs/superpowers/plans/2026-04-15-gdrive-index.md`) Phases 1-2 and Phase 9.1.

---

## Phase 0: Manual setup (Drive folder IDs)

Must be done one-time before Phase 1 — resolves IDs that populate `config/products.json`.

### Task 0.1: Resolve target folder IDs

- [ ] **Step 1: Use Google Drive UI or list_folder via MCP to find these IDs:**

For each product, navigate to product drive and find the `00 - Anotações Reuniões` folder, record the ID:

- `[01] SMART DIE / 00 - Anotações Reuniões` → TARGET_DIEMASTER
- `[02] SPOT FUSION / 00 - Anotações Reuniões` → TARGET_SPOTFUSION
- `[03] VISION KING / 00 - Anotações Reuniões` → TARGET_VISIONKING

Use:
```bash
# Interactive via JARVIS host Claude Code session:
claude --print --allowedTools 'mcp__google-workspace__list_folder' 'list folder [01] SMART DIE, then find 00 - Anotações Reuniões and give me the ID'
```

- [ ] **Step 2: Create fallback folder**

Create `Meu Drive / Meet Recordings / Não classificado` via Drive UI, record ID as UNCLASSIFIED_ID.

- [ ] **Step 3: Record product drive IDs**

From MEMORY.md references:
- DieMaster drive: `0ALpYWXApVGjKUk9PVA`
- SpotFusion drive: `0AAUuVGQz7cyDUk9PVA`
- VisionKing drive: `0ALRu7RfQZ9ukUk9PVA`
- Source Meet Recordings: `1joPKNyMqkyqtyboMJ0xxq8nLXbABmCm2`

Keep these IDs noted for Phase 6.

---

## Phase 1: Worktree + Scaffolding

### Task 1.1: Create worktree

- [ ] **Step 1: Fetch + create branch**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git fetch origin
git worktree add -b feature/meeting-index /home/teruel/worktrees/infra-meeting-index origin/master
```

- [ ] **Step 2: Verify shared libs**

```bash
cd /home/teruel/worktrees/infra-meeting-index
ls services/_shared/google-auth.mjs services/_shared/pmo-git.mjs
```

Expected: both files exist. If not, STOP.

### Task 1.2: Scaffold

- [ ] **Step 1: Create tree**

```bash
cd /home/teruel/worktrees/infra-meeting-index
mkdir -p services/meeting-index/{config,lib,test,data,logs}
touch services/meeting-index/{run.sh,deploy.sh,package.json,index.mjs}
touch services/meeting-index/config/{products.json,patterns.json,service.json}
touch services/meeting-index/lib/{config,drive-client,classifier,index-writer,dedup}.mjs
touch services/meeting-index/test/{classifier,dedup,config}.test.mjs
touch services/meeting-index/test/test-integration.mjs
touch services/meeting-index/.gitignore
```

- [ ] **Step 2: Write .gitignore + package.json**

Content of `services/meeting-index/.gitignore`:
```
data/pmo-clone/
data/state.json
data/run.lock
logs/
node_modules/
```

Content of `services/meeting-index/package.json`:
```json
{
  "name": "@strokmatic/meeting-index",
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

- [ ] **Step 3: Commit**

```bash
git add services/meeting-index/
git commit -m "feat(meeting-index): scaffold directory structure

Empty tree per spec §4.2. Depends on _shared libs from
gdrive-index.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: `lib/classifier.mjs` (PURE)

Regex permissivo sobre filename → `{product, meeting_type, matched_text}` ou `null`.

**Files:**
- Create: `services/meeting-index/lib/classifier.mjs`
- Create: `services/meeting-index/test/classifier.test.mjs`

### Task 2.1: Write tests (many cases)

- [ ] **Step 1: Create test file**

Content of `services/meeting-index/test/classifier.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lib/classifier.mjs';

const CFG = {
  products: {
    diemaster: { aliases: ['Smart Die', 'SmartDie', 'Die Master', 'DieMaster'] },
    spotfusion: { aliases: ['Spot Fusion', 'SpotFusion', 'Spark Eyes', 'SparkEyes'] },
    visionking: { aliases: ['Vision King', 'VisionKing', 'VK'] },
  },
  meeting_types: [
    { type: 'daily', aliases: ['Daily', 'Daily Standup', 'Standup'] },
    { type: 'sprint_start', aliases: ['Início de Sprint', 'Inicio de Sprint', 'Abertura de Sprint'] },
    { type: 'sprint_end', aliases: ['Encerramento de Sprint', 'Final de Sprint', 'Fim de Sprint', 'Encerramento de Sprint e Refinamento'] },
  ],
  gemini_suffix_pattern: '\\s*-\\s*\\d{4}[/-]\\d{2}[/-]\\d{2}\\s+\\d{2}:\\d{2}.*Anotações do Gemini$',
};

test('Daily Smart Die matches diemaster + daily', () => {
  const result = classify('Daily Smart Die - 2026/04/15 08:30 GMT-03:00 - Anotações do Gemini', CFG);
  assert.equal(result.product, 'diemaster');
  assert.equal(result.meeting_type, 'daily');
});

test('Smart Die - Daily (reversed order) matches', () => {
  const result = classify('Smart Die - Daily - 2026/04/15 08:30 - Anotações do Gemini', CFG);
  assert.equal(result.product, 'diemaster');
  assert.equal(result.meeting_type, 'daily');
});

test('DieMaster single-word matches diemaster', () => {
  const result = classify('Daily DieMaster - 2026/04/15 10:00 - Anotações do Gemini', CFG);
  assert.equal(result.product, 'diemaster');
});

test('SmartDie single-word matches diemaster', () => {
  const result = classify('Daily SmartDie - 2026/04/15 10:00 - Anotações do Gemini', CFG);
  assert.equal(result.product, 'diemaster');
});

test('Spark Eyes alias matches spotfusion', () => {
  const result = classify('Daily Spark Eyes - 2026/04/15 08:00 - Anotações do Gemini', CFG);
  assert.equal(result.product, 'spotfusion');
});

test('SparkEyes alias matches spotfusion', () => {
  const result = classify('SparkEyes Daily - 2026/04/15 08:00 - Anotações do Gemini', CFG);
  assert.equal(result.product, 'spotfusion');
});

test('VK abbreviation matches visionking', () => {
  const result = classify('Daily VK - 2026/04/15 08:00 - Anotações do Gemini', CFG);
  assert.equal(result.product, 'visionking');
});

test('Vision King two-word matches visionking', () => {
  const result = classify('Vision King Daily - 2026/04/15 08:00 - Anotações do Gemini', CFG);
  assert.equal(result.product, 'visionking');
});

test('Início de Sprint (with accent) matches sprint_start', () => {
  const result = classify('Início de Sprint Smart Die - 2026/04/01 09:00 - Anotações do Gemini', CFG);
  assert.equal(result.meeting_type, 'sprint_start');
  assert.equal(result.product, 'diemaster');
});

test('Inicio de Sprint (no accent) matches sprint_start', () => {
  const result = classify('Inicio de Sprint Smart Die - 2026/04/01 09:00 - Anotações do Gemini', CFG);
  assert.equal(result.meeting_type, 'sprint_start');
});

test('Encerramento de Sprint e Refinamento matches sprint_end', () => {
  const result = classify('Encerramento de Sprint e Refinamento VK - 2026/04/15 17:00 - Anotações do Gemini', CFG);
  assert.equal(result.meeting_type, 'sprint_end');
  assert.equal(result.product, 'visionking');
});

test('Reunião COMAU (client meeting) returns null', () => {
  const result = classify('Reunião COMAU - 2026/04/15 14:00 - Anotações do Gemini', CFG);
  assert.equal(result, null);
});

test('Alinhamento Geral returns null (no product alias)', () => {
  const result = classify('Alinhamento Geral - 2026/04/15 10:00 - Anotações do Gemini', CFG);
  assert.equal(result, null);
});

test('Gemini default name returns null', () => {
  const result = classify('Reunião iniciada às 2026/04/15 10:00 - Anotações do Gemini', CFG);
  assert.equal(result, null);
});

test('meeting type with no product returns null', () => {
  const result = classify('Daily Standup - 2026/04/15 08:00 - Anotações do Gemini', CFG);
  assert.equal(result, null);
});

test('product with no meeting type returns null', () => {
  const result = classify('Conversa DieMaster - 2026/04/15 10:00 - Anotações do Gemini', CFG);
  assert.equal(result, null);
});

test('matched_text returned without Gemini suffix', () => {
  const result = classify('Daily Smart Die - 2026/04/15 08:30 - Anotações do Gemini', CFG);
  assert.equal(result.matched_text, 'Daily Smart Die');
});

test('mixed case works', () => {
  const result = classify('DAILY SMART DIE - 2026/04/15 08:00 - Anotações do Gemini', CFG);
  assert.equal(result.product, 'diemaster');
  assert.equal(result.meeting_type, 'daily');
});

test('empty filename returns null', () => {
  assert.equal(classify('', CFG), null);
});

test('only Gemini suffix returns null', () => {
  assert.equal(classify(' - 2026/04/15 10:00 - Anotações do Gemini', CFG), null);
});
```

### Task 2.2: Implement classifier

- [ ] **Step 1: Write implementation**

Content of `services/meeting-index/lib/classifier.mjs`:
```javascript
/**
 * PURE: classify filename to {product, meeting_type, matched_text}
 * or null. Regex permissivo: aliases can appear in any order; case
 * insensitive; accents normalized.
 */

function stripSuffix(filename, pattern) {
  const re = new RegExp(pattern);
  const match = filename.match(re);
  if (!match) return filename;
  return filename.slice(0, match.index).trim();
}

function normalize(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function findAlias(haystackNormalized, aliases) {
  for (const alias of aliases) {
    const aliasNorm = normalize(alias);
    if (haystackNormalized.includes(aliasNorm)) return alias;
  }
  return null;
}

export function classify(filename, config) {
  if (!filename) return null;
  const title = stripSuffix(filename, config.gemini_suffix_pattern);
  if (!title) return null;
  const haystack = normalize(title);

  let meetingType = null;
  for (const mt of config.meeting_types) {
    if (findAlias(haystack, mt.aliases)) {
      meetingType = mt.type;
      break;
    }
  }
  if (!meetingType) return null;

  let product = null;
  for (const [key, pcfg] of Object.entries(config.products)) {
    if (findAlias(haystack, pcfg.aliases)) {
      product = key;
      break;
    }
  }
  if (!product) return null;

  return { product, meeting_type: meetingType, matched_text: title };
}
```

- [ ] **Step 2: Install + run tests**

```bash
cd /home/teruel/worktrees/infra-meeting-index/services/meeting-index
npm install
npm test
```

Expected: PASS — 20 tests.

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-meeting-index
git add services/meeting-index/lib/classifier.mjs services/meeting-index/test/classifier.test.mjs services/meeting-index/package.json services/meeting-index/package-lock.json
git commit -m "feat(meeting-index): add classifier with TDD

Pure classifier: strips Gemini suffix, normalizes (NFD + lowercase
+ whitespace collapse), searches for first meeting_type alias, then
first product alias. Both must match. Returns {product,
meeting_type, matched_text} or null.

Tests: 20 passing covering all products × types, aliases (Smart
Die/DieMaster, Spark Eyes/SparkEyes, VK), order invariance,
accented/unaccented, client meetings rejected, Gemini defaults
rejected, edge cases.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: `lib/dedup.mjs` (PURE)

Filter scanned files against existing per-product indexes. Key: `drive_file_id`.

**Files:**
- Create: `services/meeting-index/lib/dedup.mjs`
- Create: `services/meeting-index/test/dedup.test.mjs`

### Task 3.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/meeting-index/test/dedup.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterNew } from '../lib/dedup.mjs';

function fileEntry(id, name = `file-${id}`) {
  return { id, name };
}

function indexEntry(id) {
  return { drive_file_id: id };
}

test('empty indexes → all scanned are new', () => {
  const scanned = [fileEntry('a'), fileEntry('b')];
  const result = filterNew(scanned, { diemaster: { meetings: [] }, spotfusion: { meetings: [] } });
  assert.equal(result.length, 2);
});

test('full overlap → 0 new', () => {
  const scanned = [fileEntry('a'), fileEntry('b')];
  const result = filterNew(scanned, { diemaster: { meetings: [indexEntry('a'), indexEntry('b')] } });
  assert.equal(result.length, 0);
});

test('partial overlap → only truly new', () => {
  const scanned = [fileEntry('a'), fileEntry('b'), fileEntry('c')];
  const result = filterNew(scanned, { diemaster: { meetings: [indexEntry('a')] } });
  assert.deepEqual(result.map(f => f.id), ['b', 'c']);
});

test('file in index of different product → still skip', () => {
  const scanned = [fileEntry('a')];
  const result = filterNew(scanned, { diemaster: { meetings: [indexEntry('a')] }, visionking: { meetings: [] } });
  assert.equal(result.length, 0);
});

test('null index for product treated as empty', () => {
  const scanned = [fileEntry('a')];
  const result = filterNew(scanned, { diemaster: null, visionking: { meetings: [indexEntry('a')] } });
  assert.equal(result.length, 0);
});

test('malformed index entry (no drive_file_id) ignored', () => {
  const scanned = [fileEntry('a')];
  const result = filterNew(scanned, { diemaster: { meetings: [{ no_id: true }] } });
  assert.equal(result.length, 1);
});

test('empty scanned → empty result', () => {
  assert.deepEqual(filterNew([], { diemaster: { meetings: [] } }), []);
});

test('scanned without id ignored', () => {
  const result = filterNew([fileEntry('a'), { name: 'noId' }], { diemaster: { meetings: [] } });
  assert.equal(result.length, 1);
});
```

### Task 3.2: Implement

- [ ] **Step 1: Write `dedup.mjs`**

Content of `services/meeting-index/lib/dedup.mjs`:
```javascript
/**
 * PURE: filter scanned files to only those not already present in
 * any product index. Key: drive_file_id. Defensive against missing
 * or malformed index entries.
 */
export function filterNew(scannedFiles, allIndexes) {
  const seen = new Set();
  for (const idx of Object.values(allIndexes || {})) {
    const meetings = idx?.meetings || [];
    for (const m of meetings) {
      if (m?.drive_file_id) seen.add(m.drive_file_id);
    }
  }
  return (scannedFiles || []).filter((f) => f?.id && !seen.has(f.id));
}
```

- [ ] **Step 2: Run tests + commit**

```bash
npm test
cd /home/teruel/worktrees/infra-meeting-index
git add services/meeting-index/lib/dedup.mjs services/meeting-index/test/dedup.test.mjs
git commit -m "feat(meeting-index): add dedup with TDD

Pure function filterNew(scanned, allIndexes) returns scanned files
not already indexed in any product. Key: drive_file_id.

Tests: 8 passing covering empty, overlap, partial, cross-product,
null index, malformed entries, edge cases.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: `lib/drive-client.mjs` (I/O wrapper)

Different from gdrive-index's drive-client — this one needs `moveFile` (addParents + removeParents) with `supportsAllDrives`.

**Files:**
- Create: `services/meeting-index/lib/drive-client.mjs`
- Create: `services/meeting-index/test/drive-client.test.mjs`

### Task 4.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/meeting-index/test/drive-client.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveClient } from '../lib/drive-client.mjs';

function makeRaw({ listPages = [[]], moveCalls = [], metadataFixtures = {}, listFailTimes = 0, moveFailTimes = 0, failCode = 429 }) {
  let listFailures = 0;
  let moveFailures = 0;
  return {
    files: {
      async list({ pageToken }) {
        if (listFailures < listFailTimes) { listFailures += 1; const e = new Error('fail'); e.code = failCode; throw e; }
        const idx = pageToken ? parseInt(pageToken, 10) : 0;
        const page = listPages[idx] || [];
        const next = idx + 1 < listPages.length ? String(idx + 1) : undefined;
        return { data: { files: page, nextPageToken: next } };
      },
      async update({ fileId, addParents, removeParents, supportsAllDrives }) {
        if (moveFailures < moveFailTimes) { moveFailures += 1; const e = new Error('fail'); e.code = failCode; throw e; }
        moveCalls.push({ fileId, addParents, removeParents, supportsAllDrives });
        return { data: { id: fileId } };
      },
      async get({ fileId }) {
        return { data: metadataFixtures[fileId] || { id: fileId, name: 'x', mimeType: 'application/vnd.google-apps.document' } };
      },
    },
  };
}

test('listFolder returns all files in folder (non-trashed)', async () => {
  const raw = makeRaw({ listPages: [[
    { id: 'a', name: 'f1', mimeType: 'application/vnd.google-apps.document' },
    { id: 'b', name: 'f2', mimeType: 'application/vnd.google-apps.document' },
  ]] });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  const files = await client.listFolder('root');
  assert.equal(files.length, 2);
});

test('listFolder paginates', async () => {
  const raw = makeRaw({ listPages: [
    [{ id: 'a', name: 'f1', mimeType: 'application/vnd.google-apps.document' }],
    [{ id: 'b', name: 'f2', mimeType: 'application/vnd.google-apps.document' }],
  ] });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  const files = await client.listFolder('root');
  assert.equal(files.length, 2);
});

test('moveFile issues addParents + removeParents with supportsAllDrives=true', async () => {
  const moveCalls = [];
  const raw = makeRaw({ moveCalls });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  await client.moveFile('file-1', 'dest-parent', 'source-parent');
  assert.equal(moveCalls.length, 1);
  assert.equal(moveCalls[0].fileId, 'file-1');
  assert.equal(moveCalls[0].addParents, 'dest-parent');
  assert.equal(moveCalls[0].removeParents, 'source-parent');
  assert.equal(moveCalls[0].supportsAllDrives, true);
});

test('retry on 429 succeeds', async () => {
  const raw = makeRaw({ listPages: [[{ id: 'a', name: 'x', mimeType: 'application/vnd.google-apps.document' }]], listFailTimes: 2 });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 2, backoffMs: 1 } });
  const files = await client.listFolder('root');
  assert.equal(files.length, 1);
});

test('getMetadata returns data field', async () => {
  const raw = makeRaw({ metadataFixtures: { 'x': { id: 'x', name: 'Daily VK', mimeType: 'application/vnd.google-apps.document' } } });
  const client = createDriveClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  const meta = await client.getMetadata('x');
  assert.equal(meta.name, 'Daily VK');
});
```

### Task 4.2: Implement

- [ ] **Step 1: Write `drive-client.mjs`**

Content of `services/meeting-index/lib/drive-client.mjs`:
```javascript
/**
 * Drive client for meeting-index: list folder, get metadata, move
 * (add/remove parents). All calls use supportsAllDrives=true for
 * Shared Drive compatibility. Retry 2x backoff on 429/5xx.
 */

const RETRIABLE = new Set([429, 500, 502, 503, 504]);
const FIELDS = 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink)';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function createDriveClient({ rawClient, retry = { attempts: 2, backoffMs: 2000 } }) {
  async function withRetry(fn) {
    let last;
    for (let i = 0; i <= retry.attempts; i += 1) {
      try { return await fn(); }
      catch (err) {
        last = err;
        if (!RETRIABLE.has(err.code)) throw err;
        if (i < retry.attempts) await sleep(retry.backoffMs * Math.pow(2, i));
      }
    }
    throw last;
  }

  async function listFolder(folderId, { pageSize = 100 } = {}) {
    const all = [];
    let pageToken;
    do {
      const res = await withRetry(() => rawClient.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: FIELDS,
        pageSize,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }));
      for (const f of (res.data.files || [])) all.push(f);
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return all;
  }

  async function getMetadata(fileId) {
    const res = await withRetry(() => rawClient.files.get({
      fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners',
      supportsAllDrives: true,
    }));
    return res.data;
  }

  async function moveFile(fileId, destParent, sourceParent) {
    return await withRetry(() => rawClient.files.update({
      fileId,
      addParents: destParent,
      removeParents: sourceParent,
      supportsAllDrives: true,
      fields: 'id, parents',
    }));
  }

  return { listFolder, getMetadata, moveFile };
}
```

- [ ] **Step 2: Run tests + commit**

```bash
npm test
cd /home/teruel/worktrees/infra-meeting-index
git add services/meeting-index/lib/drive-client.mjs services/meeting-index/test/drive-client.test.mjs
git commit -m "feat(meeting-index): add drive-client with list/get/move

googleapis Drive v3 wrapper. listFolder paginated, getMetadata,
moveFile with addParents/removeParents. All supportsAllDrives=true
for Shared Drive compat. Retry 2x backoff on 429/5xx.

Tests: 5 passing with mocked raw client.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: `lib/index-writer.mjs` (I/O)

Reads and writes product meeting indexes inside the PMO clone.

**Files:**
- Create: `services/meeting-index/lib/index-writer.mjs`
- Create: `services/meeting-index/test/index-writer.test.mjs`

### Task 5.1: Tests + impl

- [ ] **Step 1: Test file**

Content of `services/meeting-index/test/index-writer.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProductIndex, writeProductIndex } from '../lib/index-writer.mjs';

test('readProductIndex returns null when file missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iw-'));
  assert.equal(readProductIndex(dir, 'diemaster'), null);
});

test('readProductIndex parses existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iw-'));
  mkdirSync(join(dir, 'products/diemaster/meetings'), { recursive: true });
  writeFileSync(join(dir, 'products/diemaster/meetings/index.json'), JSON.stringify({ product: 'diemaster', meetings: [] }), 'utf-8');
  const result = readProductIndex(dir, 'diemaster');
  assert.equal(result.product, 'diemaster');
});

test('writeProductIndex creates dirs + atomic write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iw-'));
  writeProductIndex(dir, 'diemaster', { product: 'diemaster', meetings: [{ drive_file_id: 'a' }] });
  assert.ok(existsSync(join(dir, 'products/diemaster/meetings/index.json')));
});

test('writeProductIndex sorts meetings by meeting_date desc', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iw-'));
  writeProductIndex(dir, 'diemaster', {
    product: 'diemaster',
    meetings: [
      { drive_file_id: 'a', meeting_date: '2026-04-10' },
      { drive_file_id: 'b', meeting_date: '2026-04-15' },
      { drive_file_id: 'c', meeting_date: '2026-04-12' },
    ],
  });
  const content = JSON.parse(readFileSync(join(dir, 'products/diemaster/meetings/index.json'), 'utf-8'));
  assert.deepEqual(content.meetings.map(m => m.drive_file_id), ['b', 'c', 'a']);
});
```

- [ ] **Step 2: Write `index-writer.mjs`**

Content:
```javascript
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

function relPath(product) {
  return `products/${product}/meetings/index.json`;
}

export function readProductIndex(cloneRoot, product) {
  const path = join(cloneRoot, relPath(product));
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeProductIndex(cloneRoot, product, data) {
  const path = join(cloneRoot, relPath(product));
  mkdirSync(dirname(path), { recursive: true });
  const sorted = Array.isArray(data.meetings)
    ? [...data.meetings].sort((a, b) => (b.meeting_date || '').localeCompare(a.meeting_date || ''))
    : [];
  const out = { ...data, meetings: sorted };
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

export { relPath as productIndexRelPath };
```

- [ ] **Step 3: Run tests + commit**

```bash
npm test
cd /home/teruel/worktrees/infra-meeting-index
git add services/meeting-index/lib/index-writer.mjs services/meeting-index/test/index-writer.test.mjs
git commit -m "feat(meeting-index): add index-writer with TDD

read/write of products/{prod}/meetings/index.json inside PMO clone.
Atomic tmp+rename. Sorts meetings by meeting_date desc on write for
deterministic git diff.

Tests: 4 passing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6: `lib/config.mjs` + `config/products.json` + `config/patterns.json` + `config/service.json`

### Task 6.1: Production configs

- [ ] **Step 1: Write `config/products.json`** (fill IDs from Phase 0)

Content:
```json
{
  "source_folder_id": "1joPKNyMqkyqtyboMJ0xxq8nLXbABmCm2",
  "unclassified_folder_id": "<UNCLASSIFIED_ID>",
  "products": {
    "diemaster": {
      "aliases": ["Smart Die", "SmartDie", "Die Master", "DieMaster"],
      "product_drive_id": "0ALpYWXApVGjKUk9PVA",
      "target_folder_id": "<TARGET_DIEMASTER>"
    },
    "spotfusion": {
      "aliases": ["Spot Fusion", "SpotFusion", "Spark Eyes", "SparkEyes"],
      "product_drive_id": "0AAUuVGQz7cyDUk9PVA",
      "target_folder_id": "<TARGET_SPOTFUSION>"
    },
    "visionking": {
      "aliases": ["Vision King", "VisionKing", "VK"],
      "product_drive_id": "0ALRu7RfQZ9ukUk9PVA",
      "target_folder_id": "<TARGET_VISIONKING>"
    }
  }
}
```

Replace `<...>` placeholders with actual IDs from Phase 0.

- [ ] **Step 2: Write `config/patterns.json`**

Content:
```json
{
  "meeting_types": [
    { "type": "daily", "aliases": ["Daily", "Daily Standup", "Standup"] },
    { "type": "sprint_start", "aliases": ["Início de Sprint", "Inicio de Sprint", "Abertura de Sprint"] },
    { "type": "sprint_end", "aliases": ["Encerramento de Sprint", "Final de Sprint", "Fim de Sprint", "Encerramento de Sprint e Refinamento"] }
  ],
  "gemini_suffix_pattern": "\\s*-\\s*\\d{4}[/-]\\d{2}[/-]\\d{2}\\s+\\d{2}:\\d{2}.*Anotações do Gemini$"
}
```

- [ ] **Step 3: Write `config/service.json`**

Content:
```json
{
  "pmo_repo": {
    "url": "git@github.com:teruelskm/pmo.git",
    "branch": "master",
    "clone_path": "/opt/jarvis-meeting-index/data/pmo-clone",
    "commit_author_name": "JARVIS meeting-index",
    "commit_author_email": "jarvis-meeting-index@strokmatic.internal"
  },
  "retry": {
    "attempts": 2,
    "backoff_ms": 2000
  }
}
```

### Task 6.2: Write config loader + tests

- [ ] **Step 1: Test file**

Content of `services/meeting-index/test/config.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.mjs';

test('loadConfig merges service + products + patterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(join(dir, 'service.json'), JSON.stringify({
    pmo_repo: { url: 'x', branch: 'master', clone_path: '/tmp/x', commit_author_name: 'n', commit_author_email: 'e' },
    retry: { attempts: 2, backoff_ms: 1 },
  }), 'utf-8');
  writeFileSync(join(dir, 'products.json'), JSON.stringify({
    source_folder_id: 'src',
    unclassified_folder_id: 'unc',
    products: { diemaster: { aliases: ['X'], product_drive_id: 'd', target_folder_id: 't' } },
  }), 'utf-8');
  writeFileSync(join(dir, 'patterns.json'), JSON.stringify({
    meeting_types: [{ type: 'daily', aliases: ['Daily'] }],
    gemini_suffix_pattern: 'sfx',
  }), 'utf-8');

  const cfg = loadConfig(dir);
  assert.equal(cfg.service.pmo_repo.branch, 'master');
  assert.equal(cfg.products.source_folder_id, 'src');
  assert.equal(cfg.patterns.meeting_types[0].type, 'daily');
});

test('loadConfig throws on missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  assert.throws(() => loadConfig(dir));
});
```

- [ ] **Step 2: Implement `config.mjs`**

Content:
```javascript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadConfig(configDir) {
  const service = JSON.parse(readFileSync(join(configDir, 'service.json'), 'utf-8'));
  const products = JSON.parse(readFileSync(join(configDir, 'products.json'), 'utf-8'));
  const patterns = JSON.parse(readFileSync(join(configDir, 'patterns.json'), 'utf-8'));
  if (!service.pmo_repo?.url) throw new Error('service.json: pmo_repo.url required');
  if (!products.source_folder_id) throw new Error('products.json: source_folder_id required');
  if (!patterns.meeting_types?.length) throw new Error('patterns.json: meeting_types required');
  return { service, products, patterns };
}

export function classifierConfig(cfg) {
  return {
    products: cfg.products.products,
    meeting_types: cfg.patterns.meeting_types,
    gemini_suffix_pattern: cfg.patterns.gemini_suffix_pattern,
  };
}
```

- [ ] **Step 3: Run tests + commit**

```bash
npm test
cd /home/teruel/worktrees/infra-meeting-index
git add services/meeting-index/config/ services/meeting-index/lib/config.mjs services/meeting-index/test/config.test.mjs
git commit -m "feat(meeting-index): add config loader + production JSONs

loadConfig reads service.json + products.json + patterns.json
and validates required fields. classifierConfig extracts shape
expected by classifier.

Tests: 2 passing.

Production configs have placeholder target_folder_ids — fill
after Phase 0 (manual ID resolution).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7: Orchestrator `index.mjs` + integration smoke

### Task 7.1: Implement `index.mjs`

- [ ] **Step 1: Write orchestrator**

Content of `services/meeting-index/index.mjs`:
```javascript
#!/usr/bin/env node
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDriveClient } from '../_shared/google-auth.mjs';
import { createPmoGit } from '../_shared/pmo-git.mjs';

import { loadConfig, classifierConfig } from './lib/config.mjs';
import { createDriveClient } from './lib/drive-client.mjs';
import { classify } from './lib/classifier.mjs';
import { filterNew } from './lib/dedup.mjs';
import { readProductIndex, writeProductIndex, productIndexRelPath } from './lib/index-writer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.HM_DATA_DIR || join(__dirname, 'data');
const CONFIG_DIR = process.env.HM_CONFIG_DIR || join(__dirname, 'config');
const STATE_PATH = join(DATA_DIR, 'state.json');

const DRY_RUN = process.env.HM_DRY_RUN === '1';
const SKIP_PUSH = process.env.HM_SKIP_PUSH === '1';
const SKIP_MOVE = process.env.HM_SKIP_MOVE === '1';

function writeState({ startedAt, status, exitCode, details }) {
  mkdirSync(DATA_DIR, { recursive: true });
  const state = {
    service: 'meeting-index',
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

function parseMeetingDate(matched) {
  const m = matched.match(/(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function buildEntry(file, classification, destFolderId) {
  return {
    drive_file_id: file.id,
    drive_web_link: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`,
    title_original: file.name,
    title_clean: classification.matched_text,
    meeting_type: classification.meeting_type,
    meeting_date: parseMeetingDate(file.name) || file.createdTime?.slice(0, 10) || null,
    created_time: file.createdTime,
    modified_time: file.modifiedTime,
    size_bytes: Number(file.size || 0),
    indexed_at: new Date().toISOString(),
    moved_to_folder_id: destFolderId,
    classification_confidence: 'exact_match',
  };
}

async function main() {
  const startedAt = Date.now();
  const details = {
    files_scanned: 0,
    files_classified: 0,
    files_moved: 0,
    files_unclassified: 0,
    files_skipped_dedup: 0,
    errors: 0,
    git_commit_sha: null,
    pushed: false,
  };

  let cfg;
  try {
    cfg = loadConfig(CONFIG_DIR);
  } catch (err) {
    console.error('[meeting-index] fatal: config load', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details: { ...details, error: err.message } });
    process.exit(1);
  }

  const pmoGit = createPmoGit({
    url: cfg.service.pmo_repo.url,
    branch: cfg.service.pmo_repo.branch,
    clonePath: cfg.service.pmo_repo.clone_path,
    author: {
      name: cfg.service.pmo_repo.commit_author_name,
      email: cfg.service.pmo_repo.commit_author_email,
    },
  });

  try {
    await pmoGit.cloneOrPull();
  } catch (err) {
    console.error('[meeting-index] fatal: pmo clone/pull', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details: { ...details, error: err.message } });
    process.exit(1);
  }

  let rawDrive;
  try {
    rawDrive = getDriveClient({
      scopes: ['https://www.googleapis.com/auth/drive'],
      subject: 'pedro@lumesolutions.com',
    });
  } catch (err) {
    console.error('[meeting-index] fatal: drive auth', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details });
    process.exit(1);
  }
  const driveClient = createDriveClient({
    rawClient: rawDrive,
    retry: { attempts: cfg.service.retry.attempts, backoffMs: cfg.service.retry.backoff_ms },
  });

  let scanned;
  try {
    scanned = await driveClient.listFolder(cfg.products.source_folder_id);
  } catch (err) {
    console.error('[meeting-index] fatal: source listFolder', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details: { ...details, error: err.message } });
    process.exit(1);
  }
  details.files_scanned = scanned.length;

  const allIndexes = {};
  for (const p of Object.keys(cfg.products.products)) {
    allIndexes[p] = readProductIndex(cfg.service.pmo_repo.clone_path, p);
  }
  const newFiles = filterNew(scanned, allIndexes);
  details.files_skipped_dedup = scanned.length - newFiles.length;

  const classifierCfg = classifierConfig(cfg);
  const byProduct = {};
  const unclassified = [];

  for (const file of newFiles) {
    const cls = classify(file.name, classifierCfg);
    if (!cls) {
      unclassified.push(file);
      continue;
    }
    details.files_classified += 1;
    const product = cfg.products.products[cls.product];
    if (!product.target_folder_id) {
      console.warn(`[meeting-index] ${cls.product} target_folder_id null; leaving ${file.id} in Meet Recordings`);
      continue;
    }
    try {
      if (!SKIP_MOVE && !DRY_RUN) {
        await driveClient.moveFile(file.id, product.target_folder_id, cfg.products.source_folder_id);
      }
      const entry = buildEntry(file, cls, product.target_folder_id);
      (byProduct[cls.product] ||= []).push(entry);
      details.files_moved += 1;
    } catch (err) {
      console.error(`[meeting-index] moveFile ${file.id} failed:`, err.message);
      details.errors += 1;
    }
  }
  details.files_unclassified = unclassified.length;

  if (cfg.products.unclassified_folder_id && !SKIP_MOVE && !DRY_RUN) {
    for (const file of unclassified) {
      try {
        await driveClient.moveFile(file.id, cfg.products.unclassified_folder_id, cfg.products.source_folder_id);
      } catch (err) {
        console.error(`[meeting-index] unclassified move ${file.id} failed:`, err.message);
        details.errors += 1;
      }
    }
  }

  if (!DRY_RUN) {
    for (const [product, newEntries] of Object.entries(byProduct)) {
      const existing = allIndexes[product] || { product, meetings: [] };
      const merged = [...(existing.meetings || []), ...newEntries];
      writeProductIndex(cfg.service.pmo_repo.clone_path, product, {
        product,
        generated_at: new Date().toISOString(),
        meetings: merged,
      });
    }
  }

  if (!DRY_RUN && details.files_moved > 0) {
    const parts = Object.entries(byProduct).map(([p, list]) => `${p} (+${list.length})`).join(', ');
    const msg = `chore(meeting-index): daily refresh — ${details.files_moved} meetings classified\n\n${parts}\nUnclassified: ${details.files_unclassified}\n`;
    const committed = await pmoGit.commitAll(msg);
    if (committed) {
      details.git_commit_sha = (await pmoGit.headSha()).slice(0, 7);
      if (!SKIP_PUSH) {
        try {
          await pmoGit.push();
          details.pushed = true;
        } catch (err) {
          console.error('[meeting-index] push failed:', err.message);
        }
      }
    }
  }

  let status = 'success';
  if (details.errors > 0) status = 'partial';
  if (details.files_moved > 0 && !details.pushed && !DRY_RUN && !SKIP_PUSH) status = 'partial';
  const exitCode = status === 'failed' ? 1 : 0;
  writeState({ startedAt, status, exitCode, details });
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[meeting-index] uncaught:', err);
  process.exit(1);
});
```

### Task 7.2: Integration smoke

- [ ] **Step 1: Write `test/test-integration.mjs`**

Content:
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
  writeFileSync(join(seed, 'README.md'), '# seed\n', 'utf-8');
  execSync('git add .', { cwd: seed });
  execSync('git commit -m "seed"', { cwd: seed });
  execSync(`git remote add origin ${remote}`, { cwd: seed });
  execSync('git push origin master', { cwd: seed });
  return remote;
}

test('integration: DRY_RUN + SKIP_MOVE produces state.json', async () => {
  const remote = setupFakePmoRemote();
  const dataDir = mkdtempSync(join(tmpdir(), 'mtg-data-'));
  const cloneDir = join(dataDir, 'pmo-clone');
  const cfgDir = mkdtempSync(join(tmpdir(), 'mtg-cfg-'));

  writeFileSync(join(cfgDir, 'service.json'), JSON.stringify({
    pmo_repo: { url: remote, branch: 'master', clone_path: cloneDir, commit_author_name: 't', commit_author_email: 't@x' },
    retry: { attempts: 0, backoff_ms: 1 },
  }), 'utf-8');
  writeFileSync(join(cfgDir, 'products.json'), JSON.stringify({
    source_folder_id: 'fake-src',
    unclassified_folder_id: null,
    products: {
      diemaster: { aliases: ['Smart Die'], product_drive_id: 'd', target_folder_id: null },
    },
  }), 'utf-8');
  writeFileSync(join(cfgDir, 'patterns.json'), JSON.stringify({
    meeting_types: [{ type: 'daily', aliases: ['Daily'] }],
    gemini_suffix_pattern: '\\s*-\\s*\\d{4}[/-]\\d{2}[/-]\\d{2}\\s+\\d{2}:\\d{2}.*Anotações do Gemini$',
  }), 'utf-8');

  const result = spawnSync('node', ['index.mjs'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      HM_DATA_DIR: dataDir,
      HM_CONFIG_DIR: cfgDir,
      HM_DRY_RUN: '1',
      HM_SKIP_MOVE: '1',
      HM_SKIP_PUSH: '1',
      GCP_SERVICE_ACCOUNT_KEY: '/home/strokmatic/.secrets/gcp-service-account.json',
    },
    encoding: 'utf-8',
  });

  const statePath = join(dataDir, 'state.json');
  assert.ok(existsSync(statePath), `state.json missing. stdout=${result.stdout} stderr=${result.stderr}`);
  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  assert.equal(state.service, 'meeting-index');
});
```

- [ ] **Step 2: Commit orchestrator**

```bash
cd /home/teruel/worktrees/infra-meeting-index/services/meeting-index
chmod +x index.mjs
npm test

cd /home/teruel/worktrees/infra-meeting-index
git add services/meeting-index/index.mjs services/meeting-index/test/test-integration.mjs
git commit -m "feat(meeting-index): add orchestrator + integration smoke

Pipeline: loadConfig → drive auth → pmo cloneOrPull → listFolder
source → read 3 product indexes → dedup filter → classify each
new file → move to product target (or unclassified) → upsert
product index → writeProductIndex atomic → commitAll + push.

Env flags: HM_DRY_RUN, HM_SKIP_PUSH, HM_SKIP_MOVE, HM_CONFIG_DIR,
HM_DATA_DIR.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8: Shell scaffolding

Same pattern as gdrive-index Phase 8 and email-index Phase 9. Cron schedule: daily 23:00 UTC.

### Task 8.1: `run.sh`

- [ ] **Step 1: Write `services/meeting-index/run.sh`** (same shape as other 2 indexers)

Content same as email-index Phase 9.1 but with `meeting-index` in service name. Commit.

### Task 8.2: `deploy.sh`

- [ ] **Step 1: Write `services/meeting-index/deploy.sh`**

Same shape as email-index Phase 9.2 with:
- `REMOTE_DIR=/opt/jarvis-meeting-index`
- `CRON_SCHEDULE="0 23 * * *"`

- [ ] **Step 2: chmod + commit**

```bash
chmod +x services/meeting-index/run.sh services/meeting-index/deploy.sh
cd /home/teruel/worktrees/infra-meeting-index
git add services/meeting-index/run.sh services/meeting-index/deploy.sh
git commit -m "feat(meeting-index): add run.sh + deploy.sh

run.sh: flock guard, daily log rotation, sources nvm.
deploy.sh: rsync _shared + meeting-index, install deps, patch
import paths, install daily 23:00 UTC cron.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 9: Deploy + dry-run

### Task 9.1: Verify prerequisites

Same as email-index Phase 11.1:

- [ ] **Step 1: Check `/opt/_shared/*.mjs` exists**
- [ ] **Step 2: Check GCP key**

If missing, complete gdrive-index Phase 9 first.

### Task 9.2: Deploy + dry-run full

- [ ] **Step 1: Deploy**

```bash
cd /home/teruel/worktrees/infra-meeting-index/services/meeting-index
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" bash deploy.sh
```

- [ ] **Step 2: Dry-run**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-meeting-index && HM_DRY_RUN=1 HM_SKIP_MOVE=1 node index.mjs 2>&1 | tail -50"
```

Expected: scanned Meet Recordings count, per-file classification output (product + type) or "unclassified".

- [ ] **Step 3: Review classifier output with Pedro**

Check for:
- False positives (non-meeting files classified)
- False negatives (meetings not recognized)
- Product mismatch

If aliases insufficient: edit `services/meeting-index/config/patterns.json` or `config/products.json`, redeploy, re-run.

---

## Phase 10: Single-product ativação

### Task 10.1: Activate VisionKing first

VK has most stable naming (per spec §9 Fase 3).

- [ ] **Step 1: Edit `config/products.json` on server**

Set `visionking.target_folder_id` to real ID; leave others null.

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 "vi /opt/jarvis-meeting-index/config/products.json"
```

Alternatively sync from local after edit:
```bash
cd /home/teruel/worktrees/infra-meeting-index
# Edit services/meeting-index/config/products.json locally
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e rsync services/meeting-index/config/products.json strokmatic@192.168.15.2:/opt/jarvis-meeting-index/config/products.json
```

- [ ] **Step 2: Real run (no DRY)**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-meeting-index && node index.mjs 2>&1 | tail -20"
```

- [ ] **Step 3: Verify moves in Drive UI**

Check `[03] VISION KING / 00 - Anotações Reuniões/` for new files. Meet Recordings should no longer have them.

- [ ] **Step 4: Verify commit in PMO**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git pull origin master
cat products/visionking/meetings/index.json | python3 -m json.tool | head -30
git log -1 -- products/visionking/meetings/index.json
```

### Task 10.2: Monitor 1 week, then activate other products

After 1 week of clean VK runs:
- Fill `diemaster.target_folder_id` and `spotfusion.target_folder_id`
- Redeploy or rsync config

---

## Phase 11: Health-monitor + PR

### Task 11.1: Register in health-monitor

Similar to email-index Phase 13.1:

Add to `services/health-monitor/config/services.json`:
```json
{
  "name": "meeting-index",
  "state_path": "/opt/jarvis-meeting-index/data/state.json",
  "max_staleness_minutes": 1500,
  "alert_on_status": ["failed"],
  "alert_on_partial": true,
  "added_at": null
}
```

Flip `added_at` after 2 clean daily runs.

- [ ] **Step 1: Sync + commit** (same pattern as previous indexers)

### Task 11.2: Open PR

- [ ] **Step 1: Push feature branch + open PR**

```bash
cd /home/teruel/worktrees/infra-meeting-index
git push -u origin feature/meeting-index

gh pr create --title "feat(meeting-index): new service for Gemini meeting note organization" --body "$(cat <<'EOF'
## Summary

- Ships `meeting-index` as daily (23:00 UTC) cron service at `/opt/jarvis-meeting-index/`
- Classifies Gemini daily + sprint meetings in Meu Drive/Meet Recordings
- Moves classified files to `[0N] Produto / 00 - Anotações Reuniões/` per product
- Maintains `products/{produto}/meetings/index.json` in PMO repo
- Consumes shared libs from gdrive-index
- Registered in health-monitor (1500min staleness for daily cycle)

## Architecture

Spec: [2026-04-15-meeting-index-design.md](../docs/superpowers/specs/2026-04-15-meeting-index-design.md)
Plan: [2026-04-15-meeting-index.md](../docs/superpowers/plans/2026-04-15-meeting-index.md)

## Test plan

- [x] classifier: 20 tests passing (all aliases, order invariance, false pos/neg)
- [x] dedup: 8 tests
- [x] drive-client: 5 tests (list/move/metadata + retry)
- [x] index-writer: 4 tests
- [x] config: 2 tests
- [x] Integration smoke
- [x] Deploy + DRY_RUN OK
- [x] VK single-product 1-week monitoring OK
- [x] DieMaster + SpotFusion activation OK
- [x] Health-monitor healthy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checkpoints

### Spec coverage
- §4.1 runtime → Phase 1 + 8 (run.sh)
- §4.2 tree → Phase 1
- §4.3 module table → Phases 2-6
- §4.4 flow → Phase 7
- §5 schemas → Phase 5, Phase 6, Phase 7 state.json shape
- §6 error handling → Phase 7 orchestrator try/catch
- §7 integration → Phase 11
- §8 tests → Each Phase 2-7 has TDD
- §9 rollout → Phase 0 (manual) + 9-11
- §10 success criteria → Phase 10 VK monitoring

### Type consistency
- `drive-client.listFolder(folderId)` returns flat `[file]` list (note: different from gdrive-index's `{folders, files}` split — meeting-index only needs flat files since Meet Recordings has no subfolders)
- `drive-client.moveFile(fileId, destParent, sourceParent)` always with supportsAllDrives
- `classify(filename, config) → {product, meeting_type, matched_text} | null`
- `filterNew(scanned, allIndexes) → [file]`
- `readProductIndex(cloneRoot, product) → {meetings: [...]} | null`
- `writeProductIndex(cloneRoot, product, data)` — writes + sorts

### Scope
- Single service consuming existing shared libs. Coherent unit.

---

**Execution handoff:** plan complete. Recommended to execute via **superpowers:subagent-driven-development**.
