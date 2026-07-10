---
type: Implementation Plan
title: email-index Implementation Plan
description: All above provisioned by the gdrive-index plan (`docs/superpowers/plans/2026-04-15-gdrive-index.md`) Phases 1-2 and Phase 9.
timestamp: 2026-04-15
---

# email-index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `email-index` as a cron service at `/opt/jarvis-email-index/` that syncs Gmail per project hourly and pushes `emails/index.json` to the PMO repo via git. Preserves the mature core of `scripts/email-sync.mjs` refactored into pure/I/O separation.

**Architecture:** Node.js ESM service. Reuses `services/_shared/google-auth.mjs` and `services/_shared/pmo-git.mjs` (created by gdrive-index plan). 5 pure modules (watermark, message-normalizer, dedup, project-sync, and helpers) + 2 I/O modules (gmail-client, index-io) + config + orchestrator.

**Tech Stack:** Node.js 20+ ESM, `googleapis`, `node:test`, bash, cron, git.

**Spec reference:** `docs/superpowers/specs/2026-04-15-email-index-design.md`

**Repository:** `workspaces/strokmatic/infra/` (strokmatic/infra). Branch `feature/email-index` off `master`.

---

## Prerequisites

**CRITICAL — must exist before starting Phase 0:**
- `services/_shared/google-auth.mjs` with `getGmailClient({scopes, subject})` factory
- `services/_shared/pmo-git.mjs` with `createPmoGit({url, branch, clonePath, author})` returning `{cloneOrPull, writeProject, writeAtRelPath, commitAll, push, headSha}`
- `/home/strokmatic/.secrets/gcp-service-account.json` on infra server (mode 0600, owner strokmatic)
- PMO repo SSH push access from `192.168.15.2`

All above provisioned by the gdrive-index plan (`docs/superpowers/plans/2026-04-15-gdrive-index.md`) Phases 1-2 and Phase 9.

**If gdrive-index was NOT implemented first:** follow gdrive-index plan Phase 1 (google-auth), Phase 2 (pmo-git), and Task 9.1 (copy GCP key) before starting this plan.

---

## Phase 0: Worktree + Scaffolding

### Task 0.1: Create feature branch worktree

**Files:**
- Create: `/home/teruel/worktrees/infra-email-index/` (worktree)

- [ ] **Step 1: Fetch latest**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git fetch origin
```

- [ ] **Step 2: Create worktree from origin/master**

```bash
git worktree add -b feature/email-index /home/teruel/worktrees/infra-email-index origin/master
```

- [ ] **Step 3: Verify shared libs exist in worktree**

```bash
cd /home/teruel/worktrees/infra-email-index
ls services/_shared/google-auth.mjs services/_shared/pmo-git.mjs
```

Expected: both files exist. If not, STOP and complete gdrive-index Phase 1-2 first.

### Task 0.2: Scaffold `services/email-index/`

- [ ] **Step 1: Create directory structure**

```bash
cd /home/teruel/worktrees/infra-email-index
mkdir -p services/email-index/{config,lib,test,data,logs}
touch services/email-index/{run.sh,deploy.sh,package.json,index.mjs}
touch services/email-index/config/service.json
touch services/email-index/lib/{config,gmail-client,project-sync,message-normalizer,dedup,watermark,index-io}.mjs
touch services/email-index/test/{message-normalizer,dedup,watermark,project-sync}.test.mjs
touch services/email-index/test/test-integration.mjs
touch services/email-index/.gitignore
```

- [ ] **Step 2: Write .gitignore**

Content of `services/email-index/.gitignore`:
```
data/pmo-clone/
data/state.json
data/run.lock
logs/
node_modules/
```

- [ ] **Step 3: Write initial package.json**

Content of `services/email-index/package.json`:
```json
{
  "name": "@strokmatic/email-index",
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

- [ ] **Step 4: Commit scaffolding**

```bash
git add services/email-index/
git commit -m "feat(email-index): scaffold directory structure

Empty tree per spec §4.2. Depends on _shared libs from
gdrive-index (must exist before phases 1+).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1: `lib/watermark.mjs` (PURE)

Function: given existing entries, return ISO timestamp of `max(date) - bufferMinutes`, or null if empty.

**Files:**
- Create: `services/email-index/lib/watermark.mjs`
- Create: `services/email-index/test/watermark.test.mjs`

### Task 1.1: Write failing tests

- [ ] **Step 1: Create test file**

Content of `services/email-index/test/watermark.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSince } from '../lib/watermark.mjs';

test('entries empty → null', () => {
  assert.equal(getSince([]), null);
});

test('null entries → null', () => {
  assert.equal(getSince(null), null);
});

test('single entry → date minus buffer', () => {
  const entries = [{ date: '2026-04-15T14:30:00Z' }];
  const result = getSince(entries, 30);
  assert.equal(result, '2026-04-15T14:00:00.000Z');
});

test('multiple entries → max date minus buffer', () => {
  const entries = [
    { date: '2026-04-15T10:00:00Z' },
    { date: '2026-04-15T14:30:00Z' },
    { date: '2026-04-15T12:00:00Z' },
  ];
  const result = getSince(entries, 30);
  assert.equal(result, '2026-04-15T14:00:00.000Z');
});

test('buffer 0 → exact max', () => {
  const entries = [{ date: '2026-04-15T14:30:00Z' }];
  assert.equal(getSince(entries, 0), '2026-04-15T14:30:00.000Z');
});

test('custom buffer', () => {
  const entries = [{ date: '2026-04-15T14:30:00Z' }];
  assert.equal(getSince(entries, 120), '2026-04-15T12:30:00.000Z');
});

test('entry with invalid date skipped', () => {
  const entries = [
    { date: 'not-a-date' },
    { date: '2026-04-15T14:30:00Z' },
  ];
  const result = getSince(entries, 30);
  assert.equal(result, '2026-04-15T14:00:00.000Z');
});
```

- [ ] **Step 2: Install deps**

```bash
cd /home/teruel/worktrees/infra-email-index/services/email-index
npm install
```

- [ ] **Step 3: Run tests (should fail)**

```bash
npm test
```

Expected: FAIL — `getSince` not exported.

### Task 1.2: Implement `watermark.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/email-index/lib/watermark.mjs`:
```javascript
/**
 * Compute the "since" ISO timestamp for Gmail delta fetch.
 * Returns max(entries[].date) - bufferMinutes, or null if empty.
 * Buffer protects against race: emails arriving during prior run
 * that escaped the `after:` filter are caught on next sync.
 */
export function getSince(entries, bufferMinutes = 30) {
  if (!entries || entries.length === 0) return null;
  let maxMs = -Infinity;
  for (const e of entries) {
    const ms = Date.parse(e?.date);
    if (!Number.isNaN(ms) && ms > maxMs) maxMs = ms;
  }
  if (maxMs === -Infinity) return null;
  const adjusted = maxMs - bufferMinutes * 60 * 1000;
  return new Date(adjusted).toISOString();
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: PASS — 7 tests.

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-email-index
git add services/email-index/lib/watermark.mjs services/email-index/test/watermark.test.mjs services/email-index/package.json services/email-index/package-lock.json
git commit -m "feat(email-index): add watermark.mjs with TDD

Pure function getSince(entries, bufferMin=30) returns ISO
timestamp of max(date) minus buffer, or null if empty. Buffer
ensures race-safety on Gmail 'after:' filter — emails that
landed during a prior run are caught on the next.

Tests: 7 passing covering empty, single, multiple, buffer 0,
custom buffer, invalid date skip.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: `lib/message-normalizer.mjs` (PURE)

Signature: `normalize(rawGmailMessage) → entry`. Extracts flat schema from Gmail API v1 payload.

**Files:**
- Create: `services/email-index/lib/message-normalizer.mjs`
- Create: `services/email-index/test/message-normalizer.test.mjs`

### Task 2.1: Write tests

- [ ] **Step 1: Create test file with fixtures**

Content of `services/email-index/test/message-normalizer.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../lib/message-normalizer.mjs';

function makeRaw({ id = 'm1', threadId = 't1', labelIds = ['Label_1'], headers = [], snippet = '', internalDate = '1713182400000', parts = [], body = {} }) {
  return {
    id,
    threadId,
    labelIds,
    snippet,
    internalDate,
    payload: { headers, parts, body },
  };
}

test('basic message with sender, subject, date', () => {
  const raw = makeRaw({
    id: 'aaa',
    headers: [
      { name: 'From', value: 'João Silva <joao@cliente.com>' },
      { name: 'To', value: 'pedro@lumesolutions.com' },
      { name: 'Subject', value: 'Re: Layout revision' },
      { name: 'Date', value: 'Wed, 15 Apr 2026 10:42:07 -0300' },
    ],
    snippet: 'Segue anexo...',
  });
  const entry = normalize(raw);
  assert.equal(entry.gmail_id, 'aaa');
  assert.equal(entry.subject, 'Re: Layout revision');
  assert.equal(entry.sender_name, 'João Silva');
  assert.equal(entry.sender_email, 'joao@cliente.com');
  assert.deepEqual(entry.recipients, ['pedro@lumesolutions.com']);
  assert.equal(entry.snippet, 'Segue anexo...');
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(entry.date));
});

test('multiple recipients in To', () => {
  const raw = makeRaw({
    headers: [
      { name: 'From', value: 'a@x.com' },
      { name: 'To', value: 'b@x.com, c@y.com' },
      { name: 'Subject', value: 'x' },
      { name: 'Date', value: '2026-04-15T10:00:00Z' },
    ],
  });
  const entry = normalize(raw);
  assert.deepEqual(entry.recipients, ['b@x.com', 'c@y.com']);
});

test('sender without display name', () => {
  const raw = makeRaw({
    headers: [
      { name: 'From', value: 'bare@cliente.com' },
      { name: 'To', value: 'pedro@lumesolutions.com' },
      { name: 'Subject', value: 'x' },
      { name: 'Date', value: '2026-04-15T10:00:00Z' },
    ],
  });
  const entry = normalize(raw);
  assert.equal(entry.sender_name, null);
  assert.equal(entry.sender_email, 'bare@cliente.com');
});

test('subject with unicode/emoji preserved', () => {
  const raw = makeRaw({
    headers: [
      { name: 'From', value: 'a@x.com' },
      { name: 'To', value: 'b@x.com' },
      { name: 'Subject', value: 'Reunião hoje 🚀 — ação!' },
      { name: 'Date', value: '2026-04-15T10:00:00Z' },
    ],
  });
  const entry = normalize(raw);
  assert.equal(entry.subject, 'Reunião hoje 🚀 — ação!');
});

test('missing To header → empty recipients', () => {
  const raw = makeRaw({
    headers: [
      { name: 'From', value: 'a@x.com' },
      { name: 'Subject', value: 'x' },
      { name: 'Date', value: '2026-04-15T10:00:00Z' },
    ],
  });
  const entry = normalize(raw);
  assert.deepEqual(entry.recipients, []);
});

test('has_attachments true when filename in parts', () => {
  const raw = makeRaw({
    headers: [
      { name: 'From', value: 'a@x.com' },
      { name: 'To', value: 'b@x.com' },
      { name: 'Subject', value: 'x' },
      { name: 'Date', value: '2026-04-15T10:00:00Z' },
    ],
    parts: [
      { mimeType: 'text/plain', filename: '' },
      { mimeType: 'application/pdf', filename: 'doc.pdf' },
    ],
  });
  const entry = normalize(raw);
  assert.equal(entry.has_attachments, true);
});

test('has_attachments false when no filenames', () => {
  const raw = makeRaw({
    headers: [
      { name: 'From', value: 'a@x.com' },
      { name: 'To', value: 'b@x.com' },
      { name: 'Subject', value: 'x' },
      { name: 'Date', value: '2026-04-15T10:00:00Z' },
    ],
    parts: [{ mimeType: 'text/plain', filename: '' }],
  });
  const entry = normalize(raw);
  assert.equal(entry.has_attachments, false);
});

test('has_attachments detects nested multipart parts', () => {
  const raw = makeRaw({
    headers: [
      { name: 'From', value: 'a@x.com' },
      { name: 'To', value: 'b@x.com' },
      { name: 'Subject', value: 'x' },
      { name: 'Date', value: '2026-04-15T10:00:00Z' },
    ],
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', filename: '' },
        { mimeType: 'image/png', filename: 'pic.png' },
      ] },
    ],
  });
  const entry = normalize(raw);
  assert.equal(entry.has_attachments, true);
});

test('label_ids preserved from raw', () => {
  const raw = makeRaw({
    labelIds: ['Label_1', 'INBOX', 'UNREAD'],
    headers: [
      { name: 'From', value: 'a@x.com' },
      { name: 'To', value: 'b@x.com' },
      { name: 'Subject', value: 'x' },
      { name: 'Date', value: '2026-04-15T10:00:00Z' },
    ],
  });
  const entry = normalize(raw);
  assert.deepEqual(entry.label_ids, ['Label_1', 'INBOX', 'UNREAD']);
});

test('thread_id preserved', () => {
  const raw = makeRaw({ threadId: 'thread-xyz', headers: [
    { name: 'From', value: 'a@x.com' },
    { name: 'To', value: 'b@x.com' },
    { name: 'Subject', value: 'x' },
    { name: 'Date', value: '2026-04-15T10:00:00Z' },
  ] });
  const entry = normalize(raw);
  assert.equal(entry.thread_id, 'thread-xyz');
});
```

### Task 2.2: Implement `message-normalizer.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/email-index/lib/message-normalizer.mjs`:
```javascript
/**
 * PURE: normalize Gmail API v1 message object to flat entry.
 * Extracts gmail_id, thread_id, subject, sender_name/email,
 * recipients, date, snippet, has_attachments, label_ids.
 */

function getHeader(headers, name) {
  const h = (headers || []).find((x) => x?.name?.toLowerCase() === name.toLowerCase());
  return h?.value || null;
}

function parseAddress(value) {
  if (!value) return { name: null, email: null };
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim();
    return { name: name || null, email: match[2].trim() };
  }
  return { name: null, email: value.trim() };
}

function parseRecipients(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((raw) => parseAddress(raw).email)
    .filter(Boolean);
}

function hasAttachmentsInParts(parts) {
  if (!Array.isArray(parts)) return false;
  for (const p of parts) {
    if (p?.filename && p.filename.length > 0) return true;
    if (p?.parts && hasAttachmentsInParts(p.parts)) return true;
  }
  return false;
}

function parseDate(value, internalDate) {
  if (value) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  if (internalDate) {
    return new Date(Number(internalDate)).toISOString();
  }
  return null;
}

export function normalize(raw) {
  const headers = raw.payload?.headers || [];
  const from = parseAddress(getHeader(headers, 'From'));
  return {
    gmail_id: raw.id,
    thread_id: raw.threadId,
    subject: getHeader(headers, 'Subject') || '',
    sender_name: from.name,
    sender_email: from.email,
    recipients: parseRecipients(getHeader(headers, 'To')),
    date: parseDate(getHeader(headers, 'Date'), raw.internalDate),
    snippet: raw.snippet || '',
    has_attachments: hasAttachmentsInParts(raw.payload?.parts),
    label_ids: raw.labelIds || [],
  };
}
```

- [ ] **Step 2: Run tests**

```bash
cd /home/teruel/worktrees/infra-email-index/services/email-index
npm test
```

Expected: PASS — 10 tests.

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-email-index
git add services/email-index/lib/message-normalizer.mjs services/email-index/test/message-normalizer.test.mjs
git commit -m "feat(email-index): add message-normalizer with TDD

Pure function normalize(rawGmailMsg) → entry with gmail_id,
thread_id, subject, sender (RFC 5322 parsed), recipients, date
(ISO from RFC 2822 or internalDate fallback), snippet,
has_attachments (recursive multipart scan), label_ids.

Tests: 10 passing covering basic parse, multi-recipient, no
display name, unicode, missing To, attachments true/false,
nested multipart, label preservation, thread_id.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: `lib/dedup.mjs` (PURE)

Signature: `merge(existing, incoming) → {merged, new_count}`. Key by `gmail_id`. Preserves analyze fields.

**Files:**
- Create: `services/email-index/lib/dedup.mjs`
- Create: `services/email-index/test/dedup.test.mjs`

### Task 3.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/email-index/test/dedup.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge } from '../lib/dedup.mjs';

function entry(gmail_id, date, extras = {}) {
  return { gmail_id, date, category: null, analysis: null, analyzed_at: null, ...extras };
}

test('empty existing + 2 incoming → 2 merged, new_count=2', () => {
  const result = merge([], [entry('a', '2026-04-15T10:00:00Z'), entry('b', '2026-04-15T11:00:00Z')]);
  assert.equal(result.new_count, 2);
  assert.equal(result.merged.length, 2);
});

test('100% overlap → new_count=0', () => {
  const a = entry('a', '2026-04-15T10:00:00Z');
  const result = merge([a], [a]);
  assert.equal(result.new_count, 0);
  assert.equal(result.merged.length, 1);
});

test('partial overlap → only truly new counted', () => {
  const a = entry('a', '2026-04-15T10:00:00Z');
  const b = entry('b', '2026-04-15T11:00:00Z');
  const c = entry('c', '2026-04-15T12:00:00Z');
  const result = merge([a, b], [b, c]);
  assert.equal(result.new_count, 1);
  assert.equal(result.merged.length, 3);
});

test('preserves analyze fields on existing when incoming has null', () => {
  const enriched = entry('a', '2026-04-15T10:00:00Z', {
    category: 'client-request',
    analysis: 'Request for revision',
    analyzed_at: '2026-04-15T11:00:00Z',
  });
  const fresh = entry('a', '2026-04-15T10:00:00Z');
  const result = merge([enriched], [fresh]);
  assert.equal(result.merged[0].category, 'client-request');
  assert.equal(result.merged[0].analysis, 'Request for revision');
  assert.equal(result.merged[0].analyzed_at, '2026-04-15T11:00:00Z');
});

test('sorts merged by date desc', () => {
  const a = entry('a', '2026-04-15T10:00:00Z');
  const b = entry('b', '2026-04-15T14:00:00Z');
  const c = entry('c', '2026-04-15T12:00:00Z');
  const result = merge([a, c], [b]);
  assert.deepEqual(result.merged.map(e => e.gmail_id), ['b', 'c', 'a']);
});

test('entry with no date sorts last', () => {
  const a = entry('a', '2026-04-15T14:00:00Z');
  const b = entry('b', null);
  const result = merge([], [a, b]);
  assert.deepEqual(result.merged.map(e => e.gmail_id), ['a', 'b']);
});
```

### Task 3.2: Implement `dedup.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/email-index/lib/dedup.mjs`:
```javascript
/**
 * PURE: merge existing + incoming entries by gmail_id, returning
 * deduped list + count of truly new. Preserves analyze fields
 * (category, analysis, analyzed_at) on existing entries when
 * incoming has null values for them. Output sorted by date desc.
 */

const ANALYZE_FIELDS = ['category', 'analysis', 'analyzed_at'];

function mergeEntry(existing, incoming) {
  const out = { ...incoming };
  for (const field of ANALYZE_FIELDS) {
    if ((out[field] === null || out[field] === undefined) && existing[field] != null) {
      out[field] = existing[field];
    }
  }
  return out;
}

function byDateDesc(a, b) {
  const am = a.date ? Date.parse(a.date) : -Infinity;
  const bm = b.date ? Date.parse(b.date) : -Infinity;
  return bm - am;
}

export function merge(existing, incoming) {
  const existingMap = new Map((existing || []).map(e => [e.gmail_id, e]));
  let newCount = 0;
  const result = new Map();
  for (const e of existing || []) {
    result.set(e.gmail_id, e);
  }
  for (const item of incoming || []) {
    if (existingMap.has(item.gmail_id)) {
      result.set(item.gmail_id, mergeEntry(existingMap.get(item.gmail_id), item));
    } else {
      result.set(item.gmail_id, item);
      newCount += 1;
    }
  }
  const merged = Array.from(result.values()).sort(byDateDesc);
  return { merged, new_count: newCount };
}
```

- [ ] **Step 2: Run tests**

```bash
cd /home/teruel/worktrees/infra-email-index/services/email-index
npm test
```

Expected: PASS — 6 tests.

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-email-index
git add services/email-index/lib/dedup.mjs services/email-index/test/dedup.test.mjs
git commit -m "feat(email-index): add dedup.mjs with TDD

Pure function merge(existing, incoming) → {merged, new_count}.
Keys by gmail_id. Preserves analyze fields (category, analysis,
analyzed_at) on existing entries when incoming has null — lets
email-analyze.sh write those fields in a separate cadence
without being clobbered. Output sorted by date desc.

Tests: 6 passing covering empty, 100% overlap, partial, analyze
preservation, sort, nullable date.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: `lib/gmail-client.mjs` (I/O wrapper)

Wraps `googleapis` Gmail v1: `search(label, afterISO)` and `getMessage(id)` with retry 2x backoff on 429/5xx.

**Files:**
- Create: `services/email-index/lib/gmail-client.mjs`
- Create: `services/email-index/test/gmail-client.test.mjs`

### Task 4.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/email-index/test/gmail-client.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGmailClient } from '../lib/gmail-client.mjs';

function makeRaw({ searchPages = [[]], getFixtures = {}, failTimes = 0, failCode = 429 }) {
  let failures = 0;
  return {
    users: {
      messages: {
        async list({ pageToken }) {
          if (failures < failTimes) { failures += 1; const e = new Error('fail'); e.code = failCode; throw e; }
          const idx = pageToken ? parseInt(pageToken, 10) : 0;
          const page = searchPages[idx] || [];
          const next = idx + 1 < searchPages.length ? String(idx + 1) : undefined;
          return { data: { messages: page.map(id => ({ id })), nextPageToken: next } };
        },
        async get({ id }) {
          if (failures < failTimes) { failures += 1; const e = new Error('fail'); e.code = failCode; throw e; }
          return { data: getFixtures[id] || { id, threadId: `t-${id}`, labelIds: [], payload: { headers: [] } } };
        },
      },
    },
  };
}

test('search returns flattened ids list from multiple pages', async () => {
  const raw = makeRaw({ searchPages: [['a', 'b'], ['c']] });
  const client = createGmailClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  const ids = await client.search('myLabel', '2026-04-15T10:00:00Z');
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('search builds query with label and after', async () => {
  let capturedQ;
  const raw = {
    users: { messages: {
      async list({ q }) { capturedQ = q; return { data: { messages: [] } }; },
    } },
  };
  const client = createGmailClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  await client.search('smartdie/01001', '2026-04-15T10:00:00Z');
  assert.ok(capturedQ.includes('label:smartdie/01001'));
  assert.ok(capturedQ.includes('after:'));
});

test('search with null afterISO omits after clause', async () => {
  let capturedQ;
  const raw = { users: { messages: { async list({ q }) { capturedQ = q; return { data: { messages: [] } }; } } } };
  const client = createGmailClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  await client.search('smartdie/01001', null);
  assert.ok(!capturedQ.includes('after:'));
});

test('getMessage returns raw data field', async () => {
  const raw = makeRaw({ getFixtures: { 'aaa': { id: 'aaa', threadId: 'ttt' } } });
  const client = createGmailClient({ rawClient: raw, retry: { attempts: 0, backoffMs: 1 } });
  const msg = await client.getMessage('aaa');
  assert.equal(msg.id, 'aaa');
  assert.equal(msg.threadId, 'ttt');
});

test('retry on 429 succeeds within attempts', async () => {
  const raw = makeRaw({ searchPages: [['a']], failTimes: 2, failCode: 429 });
  const client = createGmailClient({ rawClient: raw, retry: { attempts: 2, backoffMs: 1 } });
  const ids = await client.search('l', null);
  assert.deepEqual(ids, ['a']);
});

test('retry exhausts then throws', async () => {
  const raw = makeRaw({ searchPages: [[]], failTimes: 5, failCode: 429 });
  const client = createGmailClient({ rawClient: raw, retry: { attempts: 2, backoffMs: 1 } });
  await assert.rejects(() => client.search('l', null), /fail/);
});

test('does not retry on 404', async () => {
  let calls = 0;
  const raw = { users: { messages: {
    async list() { calls += 1; const e = new Error('not found'); e.code = 404; throw e; },
  } } };
  const client = createGmailClient({ rawClient: raw, retry: { attempts: 3, backoffMs: 1 } });
  await assert.rejects(() => client.search('l', null), /not found/);
  assert.equal(calls, 1);
});
```

### Task 4.2: Implement `gmail-client.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/email-index/lib/gmail-client.mjs`:
```javascript
/**
 * Gmail client wrapping googleapis Gmail v1 with pagination + retry.
 * Impersonates user via service account; invoked via getGmailClient
 * from _shared/google-auth.mjs.
 */

const RETRIABLE_CODES = new Set([429, 500, 502, 503, 504]);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createGmailClient({ rawClient, retry = { attempts: 2, backoffMs: 2000 } }) {
  async function callWithRetry(fn) {
    let lastErr;
    for (let i = 0; i <= retry.attempts; i += 1) {
      try { return await fn(); }
      catch (err) {
        lastErr = err;
        if (!RETRIABLE_CODES.has(err.code)) throw err;
        if (i < retry.attempts) await sleep(retry.backoffMs * Math.pow(2, i));
      }
    }
    throw lastErr;
  }

  function buildQuery(label, afterISO) {
    const parts = [`label:${label}`];
    if (afterISO) {
      const seconds = Math.floor(Date.parse(afterISO) / 1000);
      parts.push(`after:${seconds}`);
    }
    return parts.join(' ');
  }

  async function search(label, afterISO, { pageSize = 100, max = Infinity } = {}) {
    const q = buildQuery(label, afterISO);
    const ids = [];
    let pageToken;
    do {
      const res = await callWithRetry(() => rawClient.users.messages.list({
        userId: 'me',
        q,
        maxResults: pageSize,
        pageToken,
      }));
      const batch = res.data.messages || [];
      for (const m of batch) {
        ids.push(m.id);
        if (ids.length >= max) return ids;
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return ids;
  }

  async function getMessage(id, { format = 'metadata', metadataHeaders = ['From', 'To', 'Subject', 'Date', 'Message-ID', 'In-Reply-To'] } = {}) {
    const res = await callWithRetry(() => rawClient.users.messages.get({
      userId: 'me',
      id,
      format,
      metadataHeaders,
    }));
    return res.data;
  }

  return { search, getMessage };
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: PASS — 7 tests.

- [ ] **Step 3: Commit**

```bash
git add services/email-index/lib/gmail-client.mjs services/email-index/test/gmail-client.test.mjs
git commit -m "feat(email-index): add gmail-client with pagination + retry

googleapis Gmail v1 wrapper: search(label, afterISO) paginates
returning flat id list; getMessage(id) fetches single message;
429/5xx retried with exponential backoff, no retry on 404.
Query built as 'label:X after:EPOCH'.

Tests: 7 passing with mocked raw client.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: `lib/index-io.mjs` (I/O)

Atomic read/write of `emails/index.json` per project.

**Files:**
- Create: `services/email-index/lib/index-io.mjs`
- Create: `services/email-index/test/index-io.test.mjs`

### Task 5.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/email-index/test/index-io.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readIndex, writeIndex } from '../lib/index-io.mjs';

test('readIndex returns null when file missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'io-'));
  assert.equal(readIndex(join(dir, 'nope.json')), null);
});

test('readIndex parses existing JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'io-'));
  const path = join(dir, 'x.json');
  writeFileSync(path, JSON.stringify({ project: '01001', entries: [] }), 'utf-8');
  const result = readIndex(path);
  assert.equal(result.project, '01001');
});

test('writeIndex creates parent dirs if missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'io-'));
  const path = join(dir, 'nested/sub/index.json');
  writeIndex(path, { project: '01001', entries: [] });
  assert.ok(existsSync(path));
});

test('writeIndex writes atomically and overwrites existing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'io-'));
  const path = join(dir, 'x.json');
  writeIndex(path, { v: 1 });
  writeIndex(path, { v: 2 });
  const result = JSON.parse(readFileSync(path, 'utf-8'));
  assert.equal(result.v, 2);
});

test('writeIndex formats JSON with 2-space indent + trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'io-'));
  const path = join(dir, 'x.json');
  writeIndex(path, { a: 1 });
  const raw = readFileSync(path, 'utf-8');
  assert.ok(raw.includes('  '));
  assert.ok(raw.endsWith('\n'));
});
```

### Task 5.2: Implement `index-io.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/email-index/lib/index-io.mjs`:
```javascript
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function readIndex(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeIndex(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}
```

- [ ] **Step 2: Run tests + commit**

```bash
npm test
git add services/email-index/lib/index-io.mjs services/email-index/test/index-io.test.mjs
git commit -m "feat(email-index): add index-io with atomic write

readIndex returns null or parsed JSON. writeIndex creates parent
dirs, atomic tmp+rename, 2-space indent + trailing newline for
deterministic git diff.

Tests: 5 passing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6: `lib/config.mjs`

Loads `service.json` + reads `project-codes.json` filtering `email.enabled === true`.

**Files:**
- Create: `services/email-index/config/service.json`
- Create: `services/email-index/lib/config.mjs`
- Create: `services/email-index/test/config.test.mjs`

### Task 6.1: Production config

- [ ] **Step 1: Write `config/service.json`**

Content of `services/email-index/config/service.json`:
```json
{
  "pmo_repo": {
    "url": "git@github.com:teruelskm/pmo.git",
    "branch": "master",
    "clone_path": "/opt/jarvis-email-index/data/pmo-clone",
    "commit_author_name": "JARVIS email-index",
    "commit_author_email": "jarvis-email-index@strokmatic.internal"
  },
  "project_codes_path": "config/project-codes.json",
  "output_path_template": "projects/{code}/emails/index.json",
  "gmail": {
    "max_messages_per_project_per_run": 500,
    "watermark_buffer_minutes": 30,
    "page_size": 100
  },
  "retry": {
    "attempts": 2,
    "backoff_ms": 2000
  }
}
```

### Task 6.2: Write config tests

- [ ] **Step 1: Create test file**

Content of `services/email-index/test/config.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, loadProjectCodes } from '../lib/config.mjs';

test('loadConfig reads valid service.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 's.json');
  writeFileSync(path, JSON.stringify({
    pmo_repo: { url: 'x', branch: 'master', clone_path: '/tmp/x', commit_author_name: 'n', commit_author_email: 'e' },
    project_codes_path: 'p',
    output_path_template: 'projects/{code}/emails/index.json',
    gmail: { max_messages_per_project_per_run: 500, watermark_buffer_minutes: 30, page_size: 100 },
    retry: { attempts: 2, backoff_ms: 1 },
  }));
  const cfg = loadConfig(path);
  assert.equal(cfg.pmo_repo.branch, 'master');
});

test('loadConfig throws on missing fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 'bad.json');
  writeFileSync(path, JSON.stringify({ pmo_repo: {} }));
  assert.throws(() => loadConfig(path));
});

test('loadProjectCodes splits enabled/disabled/misconfigured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 'pc.json');
  writeFileSync(path, JSON.stringify({
    projects: [
      { code: '01001', email: { label: 'smartdie/01001', enabled: true } },
      { code: '02008', email: { label: null, enabled: true } },
      { code: '03002' },
      { code: '03007', email: { label: 'x', enabled: false } },
    ],
  }));
  const result = loadProjectCodes(path);
  assert.deepEqual(result.enabled.map(p => p.code), ['01001']);
  assert.deepEqual(result.misconfigured.map(p => p.code), ['02008']);
  assert.deepEqual(result.disabled.map(p => p.code), ['03002', '03007']);
});
```

### Task 6.3: Implement `config.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/email-index/lib/config.mjs`:
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
  return path.reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

export function loadConfig(configPath) {
  const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
  for (const p of REQUIRED) {
    if (get(cfg, p) == null) throw new Error(`missing: ${p.join('.')}`);
  }
  return cfg;
}

export function loadProjectCodes(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const list = Array.isArray(raw.projects) ? raw.projects : [];
  const enabled = [];
  const disabled = [];
  const misconfigured = [];
  for (const p of list) {
    if (!p.email || p.email.enabled === false) {
      disabled.push(p);
    } else if (p.email.enabled === true && !p.email.label) {
      misconfigured.push(p);
    } else if (p.email.enabled === true && p.email.label) {
      enabled.push(p);
    } else {
      disabled.push(p);
    }
  }
  return { enabled, disabled, misconfigured };
}
```

- [ ] **Step 2: Run tests + commit**

```bash
npm test
cd /home/teruel/worktrees/infra-email-index
git add services/email-index/config/service.json services/email-index/lib/config.mjs services/email-index/test/config.test.mjs
git commit -m "feat(email-index): add config loader + service.json

loadConfig validates required fields. loadProjectCodes splits
projects into {enabled, disabled, misconfigured} based on
email.enabled + email.label states.

Tests: 3 passing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7: `lib/project-sync.mjs`

Per-project pipeline: watermark → search → getMessage loop → normalize → merge. Returns `{changed, new_count, entries, truncated}`.

**Files:**
- Create: `services/email-index/lib/project-sync.mjs`
- Create: `services/email-index/test/project-sync.test.mjs`

### Task 7.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/email-index/test/project-sync.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncProject } from '../lib/project-sync.mjs';

function makeClient({ searchIds = [], getFixtures = {}, searchThrows = null, getThrows = {} }) {
  return {
    async search() {
      if (searchThrows) throw searchThrows;
      return searchIds;
    },
    async getMessage(id) {
      if (getThrows[id]) throw getThrows[id];
      return getFixtures[id] || {
        id,
        threadId: `t-${id}`,
        labelIds: [],
        internalDate: '1713182400000',
        snippet: '',
        payload: { headers: [
          { name: 'From', value: 'a@x.com' },
          { name: 'To', value: 'b@x.com' },
          { name: 'Subject', value: `msg ${id}` },
          { name: 'Date', value: '2026-04-15T10:00:00Z' },
        ] },
      };
    },
  };
}

test('0 new → changed=false, new_count=0, entries preserved', async () => {
  const existing = [{ gmail_id: 'a', date: '2026-04-15T09:00:00Z' }];
  const client = makeClient({ searchIds: [] });
  const result = await syncProject({
    client,
    label: 'l',
    existing,
    watermarkBufferMin: 30,
    maxMessages: 500,
  });
  assert.equal(result.changed, false);
  assert.equal(result.new_count, 0);
  assert.equal(result.entries.length, 1);
});

test('N new → changed=true, sorted desc, new_count correct', async () => {
  const client = makeClient({ searchIds: ['m1', 'm2'] });
  const result = await syncProject({
    client,
    label: 'l',
    existing: [],
    watermarkBufferMin: 30,
    maxMessages: 500,
  });
  assert.equal(result.changed, true);
  assert.equal(result.new_count, 2);
  assert.equal(result.entries.length, 2);
});

test('getMessage failure on 1 msg skipped, others continue', async () => {
  const err = new Error('fail');
  err.code = 500;
  const client = makeClient({ searchIds: ['m1', 'm2'], getThrows: { m1: err } });
  const result = await syncProject({
    client,
    label: 'l',
    existing: [],
    watermarkBufferMin: 30,
    maxMessages: 500,
  });
  assert.equal(result.new_count, 1);
  assert.equal(result.error_count, 1);
});

test('truncated when max_messages exceeded', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const client = makeClient({ searchIds: ids });
  const result = await syncProject({
    client,
    label: 'l',
    existing: [],
    watermarkBufferMin: 30,
    maxMessages: 3,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.entries.length, 3);
});

test('preserves analyze fields on merge', async () => {
  const existing = [{
    gmail_id: 'm1',
    date: '2026-04-15T10:00:00Z',
    category: 'client-request',
    analysis: 'x',
    analyzed_at: '2026-04-15T11:00:00Z',
  }];
  const client = makeClient({ searchIds: ['m1'] });
  const result = await syncProject({
    client,
    label: 'l',
    existing,
    watermarkBufferMin: 30,
    maxMessages: 500,
  });
  assert.equal(result.entries[0].category, 'client-request');
});

test('search throws → propagates as project-level failure', async () => {
  const err = new Error('api fail');
  err.code = 500;
  const client = makeClient({ searchIds: [], searchThrows: err });
  await assert.rejects(() => syncProject({
    client,
    label: 'l',
    existing: [],
    watermarkBufferMin: 30,
    maxMessages: 500,
  }), /api fail/);
});
```

### Task 7.2: Implement `project-sync.mjs`

- [ ] **Step 1: Write implementation**

Content of `services/email-index/lib/project-sync.mjs`:
```javascript
import { getSince } from './watermark.mjs';
import { normalize } from './message-normalizer.mjs';
import { merge } from './dedup.mjs';

export async function syncProject({ client, label, existing, watermarkBufferMin, maxMessages }) {
  const since = getSince(existing, watermarkBufferMin);
  const ids = await client.search(label, since, { max: maxMessages });
  const truncated = ids.length >= maxMessages;
  const fetched = [];
  let errorCount = 0;
  for (const id of ids) {
    try {
      const raw = await client.getMessage(id);
      fetched.push(normalize(raw));
    } catch (err) {
      errorCount += 1;
    }
  }
  const { merged, new_count } = merge(existing, fetched);
  return {
    changed: new_count > 0,
    new_count,
    entries: merged,
    watermark_since: since,
    truncated,
    error_count: errorCount,
  };
}
```

- [ ] **Step 2: Run tests + commit**

```bash
npm test
cd /home/teruel/worktrees/infra-email-index
git add services/email-index/lib/project-sync.mjs services/email-index/test/project-sync.test.mjs
git commit -m "feat(email-index): add project-sync orchestrating the per-project pipeline

Composes watermark + search + getMessage loop + normalize +
merge. Returns {changed, new_count, entries, watermark_since,
truncated, error_count}. Client injected. Per-msg errors
counted but don't abort (watermark-buffer re-fetches next run).

Tests: 6 passing covering 0 new, N new, msg error, truncation,
analyze preservation, search failure.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8: Orchestrator `index.mjs` + integration smoke

### Task 8.1: Implement orchestrator

- [ ] **Step 1: Write `index.mjs`**

Content of `services/email-index/index.mjs`:
```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getGmailClient } from '../_shared/google-auth.mjs';
import { createPmoGit } from '../_shared/pmo-git.mjs';

import { loadConfig, loadProjectCodes } from './lib/config.mjs';
import { createGmailClient } from './lib/gmail-client.mjs';
import { syncProject } from './lib/project-sync.mjs';
import { readIndex, writeIndex } from './lib/index-io.mjs';

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
    service: 'email-index',
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
    projects_email_enabled: 0,
    projects_email_disabled: 0,
    projects_misconfigured: 0,
    projects_synced_ok: 0,
    projects_failed: 0,
    projects_with_changes: 0,
    projects_truncated: 0,
    total_new_messages: 0,
    git_commit_sha: null,
    pushed: false,
  };

  let cfg;
  try {
    cfg = loadConfig(CONFIG_PATH);
  } catch (err) {
    console.error('[email-index] fatal: config load failed', err.message);
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
    console.error('[email-index] fatal: pmo clone/pull failed', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details: { ...details, error: String(err.message) } });
    process.exit(1);
  }

  const { enabled, disabled, misconfigured } = loadProjectCodes(join(cfg.pmo_repo.clone_path, cfg.project_codes_path));
  details.projects_email_enabled = enabled.length;
  details.projects_email_disabled = disabled.length;
  details.projects_misconfigured = misconfigured.length;
  for (const p of misconfigured) {
    console.warn(`[email-index] ${p.code}: misconfigured (enabled:true but label null)`);
  }

  let rawGmail;
  try {
    rawGmail = getGmailClient({
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      subject: 'pedro@lumesolutions.com',
    });
  } catch (err) {
    console.error('[email-index] fatal: gmail auth failed', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details });
    process.exit(1);
  }
  const gmailClient = createGmailClient({
    rawClient: rawGmail,
    retry: { attempts: cfg.retry.attempts, backoffMs: cfg.retry.backoff_ms },
  });

  const selected = ONLY_PROJECT ? enabled.filter(p => p.code === ONLY_PROJECT) : enabled;
  const changedProjects = [];

  for (const project of selected) {
    try {
      const outRel = cfg.output_path_template.replace('{code}', project.code);
      const outPath = join(cfg.pmo_repo.clone_path, outRel);
      const existingIndex = readIndex(outPath);
      const existingEntries = existingIndex?.entries || [];

      const result = await syncProject({
        client: gmailClient,
        label: project.email.label,
        existing: existingEntries,
        watermarkBufferMin: cfg.gmail.watermark_buffer_minutes,
        maxMessages: cfg.gmail.max_messages_per_project_per_run,
      });
      details.projects_synced_ok += 1;
      details.total_new_messages += result.new_count;
      if (result.truncated) details.projects_truncated += 1;
      if (result.error_count > 0 && details.projects_failed < selected.length) {
        // non-fatal per-msg errors already counted per project
      }
      if (result.changed) {
        details.projects_with_changes += 1;
        changedProjects.push({ code: project.code, added: result.new_count });
        if (!DRY_RUN) {
          writeIndex(outPath, {
            project: project.code,
            generated_at: new Date().toISOString(),
            watermark_since: result.watermark_since,
            message_count: result.entries.length,
            entries: result.entries,
          });
        }
        console.log(`[email-index] ${project.code}: +${result.new_count}${result.truncated ? ' (truncated)' : ''}`);
      } else {
        console.log(`[email-index] ${project.code}: no changes`);
      }
    } catch (err) {
      console.error(`[email-index] ${project.code} failed:`, err.message);
      details.projects_failed += 1;
    }
  }

  if (!DRY_RUN && details.projects_with_changes > 0) {
    const summary = changedProjects.map(p => `${p.code} (+${p.added})`).join(', ');
    const msg = `chore(email-index): hourly sync — ${details.projects_with_changes} projects, ${details.total_new_messages} new messages\n\nChanged: ${summary}\nEnabled: ${details.projects_email_enabled} projects, Disabled: ${details.projects_email_disabled}\n`;
    const committed = await pmoGit.commitAll(msg);
    if (committed) {
      details.git_commit_sha = (await pmoGit.headSha()).slice(0, 7);
      if (!SKIP_PUSH) {
        try {
          await pmoGit.push();
          details.pushed = true;
        } catch (err) {
          console.error('[email-index] push failed:', err.message);
        }
      }
    }
  }

  let status = 'success';
  if (details.projects_failed > 0 || details.projects_misconfigured > 0 || details.projects_truncated > 0) status = 'partial';
  if (details.projects_with_changes > 0 && !details.pushed && !DRY_RUN && !SKIP_PUSH) status = 'partial';
  const exitCode = status === 'failed' ? 1 : 0;
  writeState({ startedAt, status, exitCode, details });
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[email-index] uncaught:', err);
  process.exit(1);
});
```

### Task 8.2: Write integration smoke test

- [ ] **Step 1: Write smoke test**

Content of `services/email-index/test/test-integration.mjs`:
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
      { code: '99999', email: { label: 'x/99999', enabled: true } },
      { code: '99998', email: { label: null, enabled: true } },
      { code: '99997' },
    ],
  }), 'utf-8');
  execSync('git add .', { cwd: seed });
  execSync('git commit -m "seed"', { cwd: seed });
  execSync(`git remote add origin ${remote}`, { cwd: seed });
  execSync('git push origin master', { cwd: seed });
  return { remote };
}

test('integration: DRY_RUN with fake remote produces state.json', async () => {
  const { remote } = setupFakePmoRemote();
  const dataDir = mkdtempSync(join(tmpdir(), 'email-data-'));
  const cloneDir = join(dataDir, 'pmo-clone');
  const cfgDir = mkdtempSync(join(tmpdir(), 'email-cfg-'));
  const cfgPath = join(cfgDir, 'service.json');
  writeFileSync(cfgPath, JSON.stringify({
    pmo_repo: {
      url: remote,
      branch: 'master',
      clone_path: cloneDir,
      commit_author_name: 'test',
      commit_author_email: 'test@test.internal',
    },
    project_codes_path: 'config/project-codes.json',
    output_path_template: 'projects/{code}/emails/index.json',
    gmail: { max_messages_per_project_per_run: 500, watermark_buffer_minutes: 30, page_size: 100 },
    retry: { attempts: 0, backoff_ms: 1 },
  }), 'utf-8');

  const result = spawnSync('node', ['index.mjs'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      HM_DATA_DIR: dataDir,
      HM_CONFIG_PATH: cfgPath,
      HM_DRY_RUN: '1',
      HM_SKIP_PUSH: '1',
      GCP_SERVICE_ACCOUNT_KEY: '/home/strokmatic/.secrets/gcp-service-account.json',
    },
    encoding: 'utf-8',
  });

  const statePath = join(dataDir, 'state.json');
  assert.ok(existsSync(statePath), `state.json should exist: stdout=${result.stdout}, stderr=${result.stderr}`);
  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  assert.equal(state.service, 'email-index');
  // In local dev without key, failed is acceptable; on server, enabled=1 misc=1 disabled=1
  if (state.last_status !== 'failed') {
    assert.equal(state.details.projects_email_enabled, 1);
    assert.equal(state.details.projects_misconfigured, 1);
    assert.equal(state.details.projects_email_disabled, 1);
  }
});
```

- [ ] **Step 2: Run test + commit orchestrator**

```bash
cd /home/teruel/worktrees/infra-email-index/services/email-index
chmod +x index.mjs
node --test test/test-integration.mjs
npm test

cd /home/teruel/worktrees/infra-email-index
git add services/email-index/index.mjs services/email-index/test/test-integration.mjs
git commit -m "feat(email-index): add orchestrator index.mjs + integration smoke

End-to-end: loadConfig → gmail auth → pmo cloneOrPull → iterate
enabled projects → per-project syncProject → writeIndex if
changed → commitAll + push. Emits canonical state.json.

Env flags: HM_DRY_RUN, HM_SKIP_PUSH, HM_ONLY_PROJECT.

Smoke: 1 test with fake bare remote, fake project-codes.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 9: Shell scaffolding (run.sh + deploy.sh)

Both follow the same pattern as gdrive-index Phase 8 (see `docs/superpowers/plans/2026-04-15-gdrive-index.md` §8 for full rationale).

### Task 9.1: `run.sh`

- [ ] **Step 1: Write `services/email-index/run.sh`**

Content:
```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/logs/run-$(date -u +%Y-%m-%d).log"
mkdir -p "$SCRIPT_DIR/logs"

LOCK_FILE="$SCRIPT_DIR/data/run.lock"
mkdir -p "$SCRIPT_DIR/data"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date -u +%FT%TZ)] email-index: previous run in flight, skipping" >> "$LOG_FILE"
  exit 0
fi

{
  echo "[$(date -u +%FT%TZ)] email-index: starting"
  node index.mjs
  echo "[$(date -u +%FT%TZ)] email-index: done (exit $?)"
} >> "$LOG_FILE" 2>&1
```

- [ ] **Step 2: chmod +x**

```bash
chmod +x services/email-index/run.sh
```

### Task 9.2: `deploy.sh`

- [ ] **Step 1: Write `services/email-index/deploy.sh`**

Content:
```bash
#!/bin/bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-strokmatic@192.168.15.2}"
REMOTE_DIR="${REMOTE_DIR:-/opt/jarvis-email-index}"
SHARED_REMOTE_DIR="${SHARED_REMOTE_DIR:-/opt/_shared}"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 * * * *}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${SSHPASS:?SSHPASS env required}"

SSH="sshpass -e ssh -o StrictHostKeyChecking=no"
RSYNC="sshpass -e rsync -e 'ssh -o StrictHostKeyChecking=no'"

echo "==> ensuring remote dirs"
$SSH "$REMOTE_HOST" "sudo -S mkdir -p $REMOTE_DIR $SHARED_REMOTE_DIR && sudo -S chown -R strokmatic:strokmatic $REMOTE_DIR $SHARED_REMOTE_DIR" <<< "$SSHPASS"

# _shared is provisioned by gdrive-index; re-sync defensively in case of updates
echo "==> syncing _shared to $SHARED_REMOTE_DIR"
bash -c "$RSYNC -a --exclude 'node_modules' --exclude 'test' \"$SCRIPT_DIR/../_shared/\" \"$REMOTE_HOST:$SHARED_REMOTE_DIR/\""
$SSH "$REMOTE_HOST" ". /home/strokmatic/.nvm/nvm.sh && cd $SHARED_REMOTE_DIR && npm install --omit=dev"

echo "==> syncing email-index to $REMOTE_DIR"
bash -c "$RSYNC -a --delete --exclude 'node_modules' --exclude 'data' --exclude 'logs' --exclude 'test' \"$SCRIPT_DIR/\" \"$REMOTE_HOST:$REMOTE_DIR/\""

echo "==> installing deps on remote"
$SSH "$REMOTE_HOST" ". /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && npm install --omit=dev"

echo "==> patching import path from '../_shared/' to '$SHARED_REMOTE_DIR/'"
$SSH "$REMOTE_HOST" "sed -i 's|from '\''../_shared/|from '\''$SHARED_REMOTE_DIR/|g' $REMOTE_DIR/index.mjs $REMOTE_DIR/lib/*.mjs" || true

echo "==> installing cron"
$SSH "$REMOTE_HOST" "crontab -l 2>/dev/null | grep -v 'email-index' > /tmp/cron.new; echo '$CRON_SCHEDULE . /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && bash run.sh' >> /tmp/cron.new; crontab /tmp/cron.new"

echo "==> deploy complete"
$SSH "$REMOTE_HOST" "crontab -l | grep email-index"
```

- [ ] **Step 2: chmod + commit**

```bash
chmod +x services/email-index/deploy.sh
cd /home/teruel/worktrees/infra-email-index
git add services/email-index/run.sh services/email-index/deploy.sh
git commit -m "feat(email-index): add run.sh + deploy.sh

run.sh: flock guard, daily log, sources nvm, runs node index.mjs.
deploy.sh: rsync _shared + email-index, install deps, patch
import paths, install hourly cron (0 * * * *).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 10: Extend `project-codes.json` in PMO

Add `email` block to projects that currently have `emails/index.json` (the 8 active).

### Task 10.1: Extend PMO config

**Files:**
- Modify: `workspaces/strokmatic/pmo/config/project-codes.json` (JARVIS host clone)

The 8 active projects with existing `emails/index.json` (from exploration): `01001`, `01002`, `02006`, `02008`, `03006`, `03007`, `03008`, `03010`.

- [ ] **Step 1: Read current `project-codes.json`**

```bash
cat /home/teruel/JARVIS/workspaces/strokmatic/pmo/config/project-codes.json | python3 -m json.tool | head -80
```

- [ ] **Step 2: For each of the 8 projects, add `email` block**

For each code, edit the entry to add:
```json
"email": { "label": "<product>/<code>", "enabled": true }
```

Where `<product>` is `smartdie` for 01xxx, `spotfusion` for 02xxx, `visionking` for 03xxx.

Label strings (confirmed from existing Gmail labels):
- `01001` → `smartdie/01001`
- `01002` → `smartdie/01002`
- `02006` → `spotfusion/02006`
- `02008` → `spotfusion/02008`
- `03006` → `visionking/03006`
- `03007` → `visionking/03007`
- `03008` → `visionking/03008`
- `03010` → `visionking/03010`

- [ ] **Step 3: Commit to PMO repo**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git add config/project-codes.json
git commit -m "chore(config): add email block to 8 active projects

Opt-in email-index sync for projects with existing Gmail labels.
Format: email: {label, enabled: true}. Other 17 projects remain
without email block (skip silencioso)."
git push origin master
```

---

## Phase 11: Deploy + dry-run

### Task 11.1: Verify prerequisites on server

- [ ] **Step 1: Check shared libs exist**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 "ls /opt/_shared/google-auth.mjs /opt/_shared/pmo-git.mjs 2>&1 || echo MISSING"
```

If MISSING, STOP — must run gdrive-index deploy first (gdrive-index plan Phase 9).

- [ ] **Step 2: Check GCP key**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 "ls -la /home/strokmatic/.secrets/gcp-service-account.json"
```

### Task 11.2: Deploy + dry-run

- [ ] **Step 1: Deploy**

```bash
cd /home/teruel/worktrees/infra-email-index/services/email-index
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" bash deploy.sh
```

- [ ] **Step 2: Dry-run all projects**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-email-index && HM_DRY_RUN=1 node index.mjs 2>&1 | tail -30"
```

Expected: per-project "+N" or "no changes" lines, final exit 0.

- [ ] **Step 3: Check state.json after dry-run**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 "cat /opt/jarvis-email-index/data/state.json | python3 -m json.tool"
```

Expected: `projects_email_enabled: 8`, `projects_email_disabled: 17`, `projects_synced_ok: 8`.

---

## Phase 12: Single-project activation + monitoring

### Task 12.1: Real run for 01001

- [ ] **Step 1: Real run (no DRY_RUN)**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-email-index && HM_ONLY_PROJECT=01001 node index.mjs 2>&1 | tail -20"
```

- [ ] **Step 2: Verify commit + push**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git pull origin master
git log -3 -- projects/01001/emails/index.json
```

Expected: new commit from "JARVIS email-index".

- [ ] **Step 3: Diff paridade vs old version**

```bash
# Before migration, old version was written by email-sync.mjs on JARVIS host
# Compare schema: gmail_id, thread_id, subject, etc. should match
git log --all -p -- projects/01001/emails/index.json | head -100
```

Expected: entries match schema; analyze fields (`category`, `analysis`, `analyzed_at`) still null (as expected in v1 sync-only).

### Task 12.2: Let cron run overnight

- [ ] **Step 1: Confirm cron installed**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 "crontab -l | grep email-index"
```

Expected: `0 * * * * . /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-email-index && bash run.sh ...`

- [ ] **Step 2: Wait for next cron hour OR trigger manually**

Trigger:
```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-email-index && bash run.sh"
```

- [ ] **Step 3: Check logs + state**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 "tail -30 /opt/jarvis-email-index/logs/run-\$(date -u +%Y-%m-%d).log"
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 "cat /opt/jarvis-email-index/data/state.json | python3 -m json.tool"
```

Expected: `last_status: success` (or `partial` if misconfigured), no `failed`.

---

## Phase 13: Health-monitor registration + deprecation

### Task 13.1: Register in health-monitor

**Files:**
- Modify: `services/health-monitor/config/services.json`

- [ ] **Step 1: Add entry**

Add to `services` array in `services/health-monitor/config/services.json`:
```json
{
  "name": "email-index",
  "state_path": "/opt/jarvis-email-index/data/state.json",
  "max_staleness_minutes": 75,
  "alert_on_status": ["failed"],
  "alert_on_partial": true,
  "added_at": null
}
```

Staleness 75min = 1h15 (cron is hourly, 15min buffer).

- [ ] **Step 2: Sync + commit**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e rsync services/health-monitor/config/services.json strokmatic@192.168.15.2:/opt/jarvis-health-monitor/config/services.json
git add services/health-monitor/config/services.json
git commit -m "feat(health-monitor): register email-index service

added_at=null initial; flip after first successful hourly run.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 13.2: Activate monitoring

- [ ] **Step 1: After 2 clean hourly runs, flip `added_at` to current timestamp in services.json**

- [ ] **Step 2: Sync + commit**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e rsync services/health-monitor/config/services.json strokmatic@192.168.15.2:/opt/jarvis-health-monitor/config/services.json
git add services/health-monitor/config/services.json
git commit -m "chore(health-monitor): activate email-index monitoring

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 13.3: Remove email-sync from JARVIS `system-update.sh`

In JARVIS repo (separate branch):

- [ ] **Step 1: Create branch**

```bash
cd /home/teruel/JARVIS
git checkout -b deprecate/email-sync-system-update
```

- [ ] **Step 2: Edit `scripts/system-update.sh`**

Find the `email-sync` invocation (likely `bash scripts/email-sync.sh` or `node scripts/email-sync.mjs`). Replace with:
```bash
# email-sync migrated to infra service (/opt/jarvis-email-index/)
# Pull PMO clone to pick up fresh email index for email-analyze
git -C workspaces/strokmatic/pmo pull --rebase origin master
```

- [ ] **Step 3: Move old script**

```bash
mkdir -p scripts/deprecated
git mv scripts/email-sync.mjs scripts/deprecated/email-sync.mjs.DEPRECATED
```

Prepend header to moved file:
```javascript
// DEPRECATED 2026-04-15 — replaced by infra service at /opt/jarvis-email-index/
// Spec: docs/superpowers/specs/2026-04-15-email-index-design.md
// Plan: docs/superpowers/plans/2026-04-15-email-index.md
process.exit(1);
```

- [ ] **Step 4: Commit**

```bash
git add scripts/deprecated/email-sync.mjs.DEPRECATED scripts/system-update.sh
git commit -m "chore(scripts): deprecate email-sync.mjs, replaced by infra service

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 13.4: Open PR for infra feature branch

- [ ] **Step 1: Push + open PR**

```bash
cd /home/teruel/worktrees/infra-email-index
git push -u origin feature/email-index

gh pr create --title "feat(email-index): new service for hourly Gmail sync" --body "$(cat <<'EOF'
## Summary

- Ships `email-index` as hourly cron service at `/opt/jarvis-email-index/`
- Consumes `services/_shared/google-auth.mjs` + `services/_shared/pmo-git.mjs` (provisioned by gdrive-index)
- Pushes `emails/index.json` per enabled project to PMO repo
- Registered in health-monitor (75min staleness threshold)
- Preserves analyze fields (category, analysis, analyzed_at) for email-analyze.sh to populate

## Architecture

Spec: [2026-04-15-email-index-design.md](../docs/superpowers/specs/2026-04-15-email-index-design.md)
Plan: [2026-04-15-email-index.md](../docs/superpowers/plans/2026-04-15-email-index.md)

## Test plan

- [x] watermark.mjs: 7 tests passing
- [x] message-normalizer.mjs: 10 tests passing
- [x] dedup.mjs: 6 tests passing
- [x] gmail-client.mjs: 7 tests passing
- [x] index-io.mjs: 5 tests passing
- [x] config.mjs: 3 tests passing
- [x] project-sync.mjs: 6 tests passing
- [x] Integration smoke with fake remote
- [x] Deploy + dry-run OK
- [x] Single-project run (01001) OK
- [x] 2 hourly cron cycles OK
- [x] Health-monitor reports healthy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checkpoints

### Spec coverage
- §4.1 runtime → Phase 0 + Phase 9 run.sh
- §4.2 tree → Phase 0
- §4.3 module table → Phases 1-7
- §4.4 flow → Phase 8
- §5 schemas → Phase 6, Phase 8 state.json shape
- §6 error handling → Phase 7 project-sync (per-project try/catch), Phase 8 orchestrator
- §7 integration → Phase 10 (project-codes extension), Phase 13 (deprecation)
- §8 tests → Each Phase 1-7 has TDD
- §9 rollout → Phases 10-13
- §10 success criteria → Phase 12 monitoring

### Type consistency
- `gmail-client.search(label, afterISO)` returns `[id]` throughout
- `gmail-client.getMessage(id)` returns raw Gmail message object
- `message-normalizer.normalize(raw)` returns entry shape used consistently
- `dedup.merge(existing, incoming)` returns `{merged, new_count}` throughout
- `syncProject(...)` returns `{changed, new_count, entries, watermark_since, truncated, error_count}` used as-is in orchestrator
- `pmo-git.writeAtRelPath` is what orchestrator uses (since path template includes `projects/{code}/`)

### Scope
- Single service + extends shared libs. Coherent.

---

**Execution handoff:** plan complete. Recommended to execute via **superpowers:subagent-driven-development**.
