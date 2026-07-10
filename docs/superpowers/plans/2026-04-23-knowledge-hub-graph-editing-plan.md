---
type: Implementation Plan
title: Knowledge Hub — Manual Graph Editing Implementation Plan
description: Expected: worktree created; branch `feat/kh-graph-editing` tracks `master`; `node_modules/` installed.
timestamp: 2026-04-23
---

# Knowledge Hub — Manual Graph Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the manual graph-editing feature defined in `docs/superpowers/specs/2026-04-23-knowledge-hub-graph-editing-design.md` — manual edges, entity merging via aliases, and a company→plant hierarchy — all driven from the existing dashboard side panel.

**Architecture:** A new `lib/graph-editor.mjs` module encapsulates all mutations (pure functions, `db` first arg, typed errors). `lib/server.mjs` gains 6 write routes gated by the existing `lib/auth.mjs` key check. `lib/graph.mjs` grows alias-resolution helpers that `server.mjs` calls from its existing GET routes — so read endpoints transparently resolve merged entities. A small `scripts/seed-plants.mjs` bootstraps plant entities from `config/plants.json`. Dashboard adds one new JS/CSS file plus small edits to `panel.js`/`search.js`.

**Tech Stack:** Node.js (ES modules), `better-sqlite3`, native `http` module, raw DOM + D3 (no framework). Test runner: `node --test`. Temp-file SQLite fixtures per test.

---

## Phase 0 — Worktree + branch

### Task 0: Create feature branch and worktree

**Files:**
- Create: `/home/teruel/worktrees/infra-kh-graph-editing` (worktree)

- [ ] **Step 1: Create branch and worktree**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git worktree add -b feat/kh-graph-editing /home/teruel/worktrees/infra-kh-graph-editing master
cd /home/teruel/worktrees/infra-kh-graph-editing/services/knowledge-hub
npm install
```

Expected: worktree created; branch `feat/kh-graph-editing` tracks `master`; `node_modules/` installed.

- [ ] **Step 2: Run existing tests to establish baseline**

```bash
cd /home/teruel/worktrees/infra-kh-graph-editing/services/knowledge-hub
node --test test/
```

Expected: all existing tests pass. Record pass count for Task 26 regression baseline.

---

## Phase 1 — Schema migration

### Task 1: Add `canonical_id` column and index

**Files:**
- Modify: `services/knowledge-hub/lib/db.mjs` (add `runMigrations()` + call from `initDb()`)
- Create: `services/knowledge-hub/test/migration.test.mjs`

- [ ] **Step 1: Write failing test**

Create `test/migration.test.mjs`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initDb } from '../lib/db.mjs';

const dbPath = path.join(os.tmpdir(), `kh-migration-test-${Date.now()}.db`);
let db;

after(() => {
  if (db) db.close();
  try { fs.unlinkSync(dbPath); } catch {}
});

test('initDb adds canonical_id column on fresh DB', () => {
  db = initDb(dbPath);
  const cols = db.prepare("PRAGMA table_info(entities)").all();
  const names = cols.map(c => c.name);
  assert.ok(names.includes('canonical_id'), 'canonical_id column missing');
});

test('migration is idempotent (re-running initDb does not fail)', () => {
  db.close();
  db = initDb(dbPath);
  const cols = db.prepare("PRAGMA table_info(entities)").all();
  assert.equal(cols.filter(c => c.name === 'canonical_id').length, 1);
});

test('migration upgrades pre-existing DB without canonical_id', () => {
  const legacyPath = path.join(os.tmpdir(), `kh-legacy-${Date.now()}.db`);
  const raw = new Database(legacyPath);
  raw.exec(`CREATE TABLE entities (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
    properties TEXT DEFAULT '{}', project_code TEXT, product TEXT
  )`);
  raw.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)')
    .run('test:one', 'One', 'person');
  raw.close();

  const upgraded = initDb(legacyPath);
  const cols = upgraded.prepare("PRAGMA table_info(entities)").all();
  assert.ok(cols.some(c => c.name === 'canonical_id'));
  const row = upgraded.prepare('SELECT * FROM entities WHERE id = ?').get('test:one');
  assert.equal(row.name, 'One');
  assert.equal(row.canonical_id, null);
  upgraded.close();
  fs.unlinkSync(legacyPath);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/migration.test.mjs
```

Expected: all 3 tests fail with "canonical_id column missing" (fresh DB), or no change on re-run (idempotent), or column not added (legacy DB).

- [ ] **Step 3: Add `runMigrations()` to `lib/db.mjs`**

Add this function just before `export function initDb(dbPath)`:

```javascript
function runMigrations(db) {
  const cols = db.prepare("PRAGMA table_info(entities)").all();
  const hasCanonical = cols.some(c => c.name === 'canonical_id');
  if (!hasCanonical) {
    db.exec(`ALTER TABLE entities ADD COLUMN canonical_id TEXT;`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_canonical_id ON entities(canonical_id);`);
}
```

In `initDb()`, call `runMigrations(db)` on the line immediately after `db.exec(SCHEMA_SQL);`:

```javascript
export function initDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  sqliteVec.load(db);
  db.exec(SCHEMA_SQL);
  runMigrations(db);          // <-- add this
  db.exec(FTS_SQL);
  // ... rest unchanged
}
```

Also update `SCHEMA_SQL`: add `canonical_id TEXT` to the `CREATE TABLE entities` block so fresh DBs get the column from the initial `CREATE` (the migration is a no-op for fresh DBs, but makes the schema statement the source of truth). The column line goes right after `product TEXT,`:

```sql
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  properties TEXT DEFAULT '{}',
  project_code TEXT,
  product TEXT,
  canonical_id TEXT
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test test/migration.test.mjs
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run full suite to ensure no regression**

```bash
node --test test/
```

Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add services/knowledge-hub/lib/db.mjs services/knowledge-hub/test/migration.test.mjs
git commit -m "feat(knowledge-hub): add canonical_id column + idempotent migration"
```

---

## Phase 2 — `graph-editor.mjs` core (mutations, pure)

### Task 2: Module scaffold + `createEntity`

**Files:**
- Create: `services/knowledge-hub/lib/graph-editor.mjs`
- Create: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `test/graph-editor.test.mjs`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../lib/db.mjs';
import { createEntity, ValidationError } from '../lib/graph-editor.mjs';

const dbPath = path.join(os.tmpdir(), `kh-editor-test-${Date.now()}.db`);
let db;

before(() => { db = initDb(dbPath); });
after(() => {
  if (db) db.close();
  try { fs.unlinkSync(dbPath); } catch {}
});

test('createEntity auto-generates id from name', () => {
  const e = createEntity(db, { name: 'GM Gravataí', type: 'plant' });
  assert.equal(e.id, 'plant:gm_gravatai');
  assert.equal(e.name, 'GM Gravataí');
  assert.equal(e.type, 'plant');
});

test('createEntity accepts explicit id', () => {
  const e = createEntity(db, { id: 'plant:gm_flint', name: 'GM Flint', type: 'plant' });
  assert.equal(e.id, 'plant:gm_flint');
});

test('createEntity rejects duplicate id', () => {
  assert.throws(
    () => createEntity(db, { id: 'plant:gm_flint', name: 'dup', type: 'plant' }),
    { name: 'ValidationError' }
  );
});

test('createEntity rejects unknown type', () => {
  assert.throws(
    () => createEntity(db, { name: 'X', type: 'robot' }),
    { name: 'ValidationError' }
  );
});

test('createEntity requires product when type=project', () => {
  assert.throws(
    () => createEntity(db, { id: 'project:99999', name: '99999', type: 'project' }),
    { name: 'ValidationError' }
  );
});

test('createEntity slug normalizes accents and punctuation', () => {
  const e = createEntity(db, { name: "Fábio D'Assunção | Strokmatic", type: 'person' });
  assert.equal(e.id, 'person:fabio_d_assuncao_strokmatic');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/graph-editor.test.mjs
```

Expected: "Cannot find module '../lib/graph-editor.mjs'".

- [ ] **Step 3: Implement `graph-editor.mjs`**

Create `lib/graph-editor.mjs`:

```javascript
/**
 * Graph Editor — mutation functions for the manual graph-editing feature.
 * Pure: accepts db as first arg, throws typed errors on invalid input.
 * All writes use source='manual' or are entity-row changes (canonical_id).
 * Never touches ingestor-created triples.
 */

const ALLOWED_TYPES = new Set(['person', 'company', 'plant', 'project', 'product', 'role']);

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}
export class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; }
}
export class CycleError extends Error {
  constructor(message) { super(message); this.name = 'CycleError'; }
}

function slug(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function createEntity(db, { id, name, type, properties = {}, project_code = null, product = null }) {
  if (!ALLOWED_TYPES.has(type)) {
    throw new ValidationError(`type must be one of: ${[...ALLOWED_TYPES].join(', ')}`);
  }
  if (!name || !String(name).trim()) {
    throw new ValidationError('name is required');
  }
  if (type === 'project' && !product) {
    throw new ValidationError('type=project requires a product');
  }
  const entityId = id || `${type}:${slug(name)}`;
  if (!entityId.includes(':')) {
    throw new ValidationError('id must be of the form <type>:<slug>');
  }
  const existing = db.prepare('SELECT id FROM entities WHERE id = ?').get(entityId);
  if (existing) {
    throw new ValidationError(`entity already exists: ${entityId}`);
  }
  db.prepare(`
    INSERT INTO entities (id, name, type, properties, project_code, product, canonical_id)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(entityId, name, type, JSON.stringify(properties), project_code, product);
  return { id: entityId, name, type, properties, project_code, product, canonical_id: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test test/graph-editor.test.mjs
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/graph-editor.mjs services/knowledge-hub/test/graph-editor.test.mjs
git commit -m "feat(knowledge-hub): graph-editor scaffold + createEntity"
```

---

### Task 3: `addManualTriple` with cycle detection

**Files:**
- Modify: `services/knowledge-hub/lib/graph-editor.mjs`
- Modify: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Append failing tests**

Add at bottom of `test/graph-editor.test.mjs`:

```javascript
import { addManualTriple } from '../lib/graph-editor.mjs';

test('addManualTriple creates edge with source=manual', () => {
  createEntity(db, { id: 'person:alice', name: 'Alice', type: 'person' });
  createEntity(db, { id: 'project:01001', name: '01001', type: 'project', product: 'diemaster' });
  const t = addManualTriple(db, { subject: 'person:alice', predicate: 'works_on', object: 'project:01001' });
  assert.equal(t.source, 'manual');
  assert.equal(t.predicate, 'works_on');
  const row = db.prepare('SELECT * FROM triples WHERE id = ?').get(t.id);
  assert.equal(row.source, 'manual');
});

test('addManualTriple normalizes predicate', () => {
  createEntity(db, { id: 'person:bob', name: 'Bob', type: 'person' });
  const t = addManualTriple(db, { subject: 'person:bob', predicate: 'Works For', object: 'person:alice' });
  assert.equal(t.predicate, 'works_for');
});

test('addManualTriple rejects missing subject', () => {
  assert.throws(
    () => addManualTriple(db, { subject: 'person:ghost', predicate: 'x', object: 'project:01001' }),
    { name: 'NotFoundError' }
  );
});

test('addManualTriple rejects missing object', () => {
  assert.throws(
    () => addManualTriple(db, { subject: 'person:alice', predicate: 'x', object: 'project:ghost' }),
    { name: 'NotFoundError' }
  );
});

test('addManualTriple blocks part_of cycle', () => {
  createEntity(db, { id: 'plant:a', name: 'A', type: 'plant' });
  createEntity(db, { id: 'plant:b', name: 'B', type: 'plant' });
  createEntity(db, { id: 'plant:c', name: 'C', type: 'plant' });
  addManualTriple(db, { subject: 'plant:a', predicate: 'part_of', object: 'plant:b' });
  addManualTriple(db, { subject: 'plant:b', predicate: 'part_of', object: 'plant:c' });
  assert.throws(
    () => addManualTriple(db, { subject: 'plant:c', predicate: 'part_of', object: 'plant:a' }),
    { name: 'CycleError' }
  );
});

test('addManualTriple allows cycle on non-hierarchy predicate', () => {
  createEntity(db, { id: 'person:x', name: 'X', type: 'person' });
  createEntity(db, { id: 'person:y', name: 'Y', type: 'person' });
  addManualTriple(db, { subject: 'person:x', predicate: 'collaborates_with', object: 'person:y' });
  // reverse edge should be allowed:
  const t = addManualTriple(db, { subject: 'person:y', predicate: 'collaborates_with', object: 'person:x' });
  assert.ok(t.id);
});

test('addManualTriple is idempotent by subject/predicate/object', () => {
  const t1 = addManualTriple(db, { subject: 'person:alice', predicate: 'works_on', object: 'project:01001' });
  const t2 = addManualTriple(db, { subject: 'person:alice', predicate: 'works_on', object: 'project:01001' });
  assert.equal(t1.id, t2.id);
});
```

- [ ] **Step 2: Run to verify failures**

```bash
node --test test/graph-editor.test.mjs
```

Expected: 7 new tests fail with "addManualTriple is not a function".

- [ ] **Step 3: Implement `addManualTriple`**

Append to `lib/graph-editor.mjs`:

```javascript
import crypto from 'node:crypto';

function normalizePredicate(p) {
  return String(p || '').trim().toLowerCase().replace(/[\s\-]+/g, '_');
}

function wouldFormPartOfCycle(db, subjectId, objectId) {
  // Walk up existing part_of edges from objectId; if we reach subjectId, cycle.
  const stmt = db.prepare(`SELECT object FROM triples WHERE subject = ? AND predicate = 'part_of'`);
  const visited = new Set();
  let frontier = [objectId];
  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      if (node === subjectId) return true;
      if (visited.has(node)) continue;
      visited.add(node);
      const rows = stmt.all(node);
      for (const r of rows) next.push(r.object);
    }
    frontier = next;
  }
  return false;
}

function tripleId(subject, predicate, object, source) {
  const hash = crypto.createHash('md5')
    .update(`${subject}|${predicate}|${object}|${source}`)
    .digest('hex').slice(0, 16);
  return `${source}:${hash}`;
}

export function addManualTriple(db, { subject, predicate, object, valid_from = null, valid_to = null }) {
  const subjRow = db.prepare('SELECT id FROM entities WHERE id = ?').get(subject);
  if (!subjRow) throw new NotFoundError(`subject not found: ${subject}`);
  const objRow = db.prepare('SELECT id FROM entities WHERE id = ?').get(object);
  if (!objRow) throw new NotFoundError(`object not found: ${object}`);

  const pred = normalizePredicate(predicate);
  if (!pred) throw new ValidationError('predicate is required');

  if (pred === 'part_of' && wouldFormPartOfCycle(db, subject, object)) {
    throw new CycleError(`part_of cycle: ${subject} → ... → ${object} → ${subject}`);
  }

  const id = tripleId(subject, pred, object, 'manual');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO triples (id, subject, predicate, object, valid_from, valid_to, confidence, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, subject, pred, object, valid_from, valid_to, 1.0, 'manual', now);
  return { id, subject, predicate: pred, object, valid_from, valid_to, confidence: 1.0, source: 'manual', created_at: now };
}
```

- [ ] **Step 4: Verify tests pass**

```bash
node --test test/graph-editor.test.mjs
```

Expected: all 13 tests PASS (6 from Task 2 + 7 new).

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/graph-editor.mjs services/knowledge-hub/test/graph-editor.test.mjs
git commit -m "feat(knowledge-hub): addManualTriple with part_of cycle detection"
```

---

### Task 4: `deleteManualTriple`

**Files:**
- Modify: `services/knowledge-hub/lib/graph-editor.mjs`
- Modify: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Append failing tests**

```javascript
import { deleteManualTriple } from '../lib/graph-editor.mjs';

test('deleteManualTriple removes a manual triple', () => {
  createEntity(db, { id: 'person:delme', name: 'DelMe', type: 'person' });
  createEntity(db, { id: 'project:delme', name: 'delme', type: 'project', product: 'diemaster' });
  const t = addManualTriple(db, { subject: 'person:delme', predicate: 'works_on', object: 'project:delme' });
  deleteManualTriple(db, t.id);
  const row = db.prepare('SELECT * FROM triples WHERE id = ?').get(t.id);
  assert.equal(row, undefined);
});

test('deleteManualTriple rejects non-manual triple', () => {
  const id = 'seed:plants:abc123';
  db.prepare(`INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at)
              VALUES (?,?,?,?,1.0,'seed:plants',?)`)
    .run(id, 'person:alice', 'x', 'project:01001', new Date().toISOString());
  assert.throws(() => deleteManualTriple(db, id), { name: 'ValidationError' });
});

test('deleteManualTriple rejects unknown id', () => {
  assert.throws(() => deleteManualTriple(db, 'manual:doesnotexist'), { name: 'NotFoundError' });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/graph-editor.test.mjs
```

Expected: 3 new failures "deleteManualTriple is not a function".

- [ ] **Step 3: Implement**

Append to `lib/graph-editor.mjs`:

```javascript
export function deleteManualTriple(db, tripleId) {
  const row = db.prepare('SELECT id, source FROM triples WHERE id = ?').get(tripleId);
  if (!row) throw new NotFoundError(`triple not found: ${tripleId}`);
  if (row.source !== 'manual') {
    throw new ValidationError(`can only delete triples with source='manual' (got '${row.source}')`);
  }
  db.prepare('DELETE FROM triples WHERE id = ?').run(tripleId);
}
```

- [ ] **Step 4: Verify tests pass**

```bash
node --test test/graph-editor.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/graph-editor.mjs services/knowledge-hub/test/graph-editor.test.mjs
git commit -m "feat(knowledge-hub): deleteManualTriple with source gate"
```

---

### Task 5: `mergeEntities` with flattening

**Files:**
- Modify: `services/knowledge-hub/lib/graph-editor.mjs`
- Modify: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Append failing tests**

```javascript
import { mergeEntities } from '../lib/graph-editor.mjs';

test('mergeEntities sets canonical_id on source entity', () => {
  createEntity(db, { id: 'person:fabio_a', name: 'Fábio A', type: 'person' });
  createEntity(db, { id: 'person:fabio_b', name: 'Fábio B', type: 'person' });
  const result = mergeEntities(db, { fromId: 'person:fabio_a', intoId: 'person:fabio_b' });
  assert.equal(result.canonicalId, 'person:fabio_b');
  const row = db.prepare('SELECT canonical_id FROM entities WHERE id = ?').get('person:fabio_a');
  assert.equal(row.canonical_id, 'person:fabio_b');
});

test('mergeEntities leaves triples unchanged', () => {
  createEntity(db, { id: 'person:m1', name: 'M1', type: 'person' });
  createEntity(db, { id: 'person:m2', name: 'M2', type: 'person' });
  createEntity(db, { id: 'project:merge', name: 'merge', type: 'project', product: 'diemaster' });
  const t = addManualTriple(db, { subject: 'person:m1', predicate: 'works_on', object: 'project:merge' });
  mergeEntities(db, { fromId: 'person:m1', intoId: 'person:m2' });
  const row = db.prepare('SELECT subject FROM triples WHERE id = ?').get(t.id);
  assert.equal(row.subject, 'person:m1', 'triple subject must NOT be rewritten');
});

test('mergeEntities flattens when intoId is already an alias', () => {
  createEntity(db, { id: 'person:f_a', name: 'FA', type: 'person' });
  createEntity(db, { id: 'person:f_b', name: 'FB', type: 'person' });
  createEntity(db, { id: 'person:f_c', name: 'FC', type: 'person' });
  mergeEntities(db, { fromId: 'person:f_b', intoId: 'person:f_c' });
  // Now merge FA into FB — should flatten to FC
  mergeEntities(db, { fromId: 'person:f_a', intoId: 'person:f_b' });
  const row = db.prepare('SELECT canonical_id FROM entities WHERE id = ?').get('person:f_a');
  assert.equal(row.canonical_id, 'person:f_c');
});

test('mergeEntities rejects self-merge', () => {
  createEntity(db, { id: 'person:self', name: 'Self', type: 'person' });
  assert.throws(
    () => mergeEntities(db, { fromId: 'person:self', intoId: 'person:self' }),
    { name: 'ValidationError' }
  );
});

test('mergeEntities rejects when source already aliased to different canonical', () => {
  createEntity(db, { id: 'person:p1', name: 'P1', type: 'person' });
  createEntity(db, { id: 'person:p2', name: 'P2', type: 'person' });
  createEntity(db, { id: 'person:p3', name: 'P3', type: 'person' });
  mergeEntities(db, { fromId: 'person:p1', intoId: 'person:p2' });
  assert.throws(
    () => mergeEntities(db, { fromId: 'person:p1', intoId: 'person:p3' }),
    { name: 'ValidationError' }
  );
});

test('mergeEntities rejects unknown from or into', () => {
  assert.throws(
    () => mergeEntities(db, { fromId: 'person:ghost_a', intoId: 'person:ghost_b' }),
    { name: 'NotFoundError' }
  );
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/graph-editor.test.mjs
```

Expected: 6 new failures "mergeEntities is not a function".

- [ ] **Step 3: Implement**

Append to `lib/graph-editor.mjs`:

```javascript
function resolveCanonical(db, id) {
  const seen = new Set();
  let cur = id;
  while (!seen.has(cur)) {
    seen.add(cur);
    const row = db.prepare('SELECT canonical_id FROM entities WHERE id = ?').get(cur);
    if (!row || !row.canonical_id) return cur;
    cur = row.canonical_id;
  }
  return cur;
}

export function mergeEntities(db, { fromId, intoId }) {
  if (fromId === intoId) {
    throw new ValidationError('cannot merge entity into itself');
  }
  const fromRow = db.prepare('SELECT id, canonical_id FROM entities WHERE id = ?').get(fromId);
  if (!fromRow) throw new NotFoundError(`from entity not found: ${fromId}`);
  const intoRow = db.prepare('SELECT id, canonical_id FROM entities WHERE id = ?').get(intoId);
  if (!intoRow) throw new NotFoundError(`into entity not found: ${intoId}`);

  const flattened = resolveCanonical(db, intoId);
  if (flattened === fromId) {
    throw new ValidationError('merge would create alias cycle');
  }

  if (fromRow.canonical_id && fromRow.canonical_id !== flattened) {
    throw new ValidationError(
      `${fromId} is already merged into ${fromRow.canonical_id}; unmerge first, or merge into the existing canonical`
    );
  }

  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run(flattened, fromId);
  return { fromId, canonicalId: flattened };
}
```

- [ ] **Step 4: Verify tests pass**

```bash
node --test test/graph-editor.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/graph-editor.mjs services/knowledge-hub/test/graph-editor.test.mjs
git commit -m "feat(knowledge-hub): mergeEntities with alias flattening"
```

---

### Task 6: `unmergeEntity`

**Files:**
- Modify: `services/knowledge-hub/lib/graph-editor.mjs`
- Modify: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Append failing tests**

```javascript
import { unmergeEntity } from '../lib/graph-editor.mjs';

test('unmergeEntity clears canonical_id', () => {
  createEntity(db, { id: 'person:u1', name: 'U1', type: 'person' });
  createEntity(db, { id: 'person:u2', name: 'U2', type: 'person' });
  mergeEntities(db, { fromId: 'person:u1', intoId: 'person:u2' });
  const out = unmergeEntity(db, 'person:u1');
  assert.equal(out.canonical_id, null);
  const row = db.prepare('SELECT canonical_id FROM entities WHERE id = ?').get('person:u1');
  assert.equal(row.canonical_id, null);
});

test('unmergeEntity on non-alias is a no-op', () => {
  createEntity(db, { id: 'person:notaliased', name: 'NA', type: 'person' });
  const out = unmergeEntity(db, 'person:notaliased');
  assert.equal(out.canonical_id, null);
});

test('unmergeEntity rejects unknown id', () => {
  assert.throws(() => unmergeEntity(db, 'person:ghost_unmerge'), { name: 'NotFoundError' });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/graph-editor.test.mjs
```

Expected: 3 new failures.

- [ ] **Step 3: Implement**

Append to `lib/graph-editor.mjs`:

```javascript
export function unmergeEntity(db, entityId) {
  const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId);
  if (!row) throw new NotFoundError(`entity not found: ${entityId}`);
  db.prepare('UPDATE entities SET canonical_id = NULL WHERE id = ?').run(entityId);
  return { ...row, canonical_id: null, properties: JSON.parse(row.properties || '{}') };
}
```

- [ ] **Step 4: Verify tests pass**

```bash
node --test test/graph-editor.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/graph-editor.mjs services/knowledge-hub/test/graph-editor.test.mjs
git commit -m "feat(knowledge-hub): unmergeEntity"
```

---

## Phase 3 — Alias resolution in read endpoints

### Task 7: `resolveAlias` + `listAliasesOf` helpers in `graph.mjs`

**Files:**
- Modify: `services/knowledge-hub/lib/graph.mjs` (add exports)
- Modify: `services/knowledge-hub/test/graph.test.mjs`

- [ ] **Step 1: Append failing tests to `test/graph.test.mjs`**

```javascript
import { resolveAlias, listAliasesOf } from '../lib/graph.mjs';

test('resolveAlias returns entity id when not aliased', () => {
  assert.equal(resolveAlias(db, 'project:01001'), 'project:01001');
});

test('resolveAlias follows canonical_id chain', () => {
  // Set up a chain: person:r1 → person:r2 → person:r3 (final canonical)
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:r1', 'R1', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:r2', 'R2', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:r3', 'R3', 'person');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:r3', 'person:r2');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:r2', 'person:r1');
  assert.equal(resolveAlias(db, 'person:r1'), 'person:r1'); // r1 is NOT aliased (it's the canonical)
  // Reverse: set up correctly — r1 is alias of r2, r2 is alias of r3
  db.prepare('UPDATE entities SET canonical_id = NULL WHERE id = ?').run('person:r1');
  db.prepare('UPDATE entities SET canonical_id = NULL WHERE id = ?').run('person:r2');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:r2', 'person:r1');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:r3', 'person:r2');
  assert.equal(resolveAlias(db, 'person:r1'), 'person:r3');
});

test('resolveAlias is cycle-safe', () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:cy1', 'C1', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:cy2', 'C2', 'person');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:cy2', 'person:cy1');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:cy1', 'person:cy2');
  // Should terminate, not loop forever
  const result = resolveAlias(db, 'person:cy1');
  assert.ok(['person:cy1', 'person:cy2'].includes(result));
});

test('resolveAlias returns null for unknown id', () => {
  assert.equal(resolveAlias(db, 'person:utterly_unknown'), null);
});

test('listAliasesOf returns ids that point at canonical', () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:canon', 'Canon', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:alias_a', 'A', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:alias_b', 'B', 'person');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:canon', 'person:alias_a');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:canon', 'person:alias_b');
  const aliases = listAliasesOf(db, 'person:canon').sort();
  assert.deepEqual(aliases, ['person:alias_a', 'person:alias_b']);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/graph.test.mjs
```

Expected: 5 new failures "resolveAlias is not a function".

- [ ] **Step 3: Implement in `lib/graph.mjs`**

Append to `lib/graph.mjs`:

```javascript
// ── Alias resolution ──────────────────────────────────────────────────────

/**
 * Follow canonical_id chain. Cycle-safe. Returns the resolved id, or the
 * entity's own id if it has no alias, or null if entity doesn't exist.
 */
export function resolveAlias(db, id) {
  const seen = new Set();
  let cur = id;
  const stmt = db.prepare('SELECT canonical_id FROM entities WHERE id = ?');
  while (!seen.has(cur)) {
    seen.add(cur);
    const row = stmt.get(cur);
    if (!row) return null;
    if (!row.canonical_id) return cur;
    cur = row.canonical_id;
  }
  return cur;
}

/**
 * Return all entity ids that are aliases of the given canonical id.
 */
export function listAliasesOf(db, canonicalId) {
  return db.prepare('SELECT id FROM entities WHERE canonical_id = ?')
    .all(canonicalId).map(r => r.id);
}
```

- [ ] **Step 4: Verify tests pass**

```bash
node --test test/graph.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/graph.mjs services/knowledge-hub/test/graph.test.mjs
git commit -m "feat(knowledge-hub): resolveAlias + listAliasesOf helpers"
```

---

### Task 8: Update `GET /graph/entity/:id` for alias resolution

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs` (find the existing `/graph/entity/` handler and update it)
- Modify: `services/knowledge-hub/test/server.test.mjs`

- [ ] **Step 1: Append failing test to `test/server.test.mjs`**

```javascript
test('GET /graph/entity/:id follows alias and includes requested_id', async () => {
  // Seed: person:alias_x aliased to person:canon_x
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:canon_x', 'CanonX', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:alias_x', 'AliasX', 'person');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:canon_x', 'person:alias_x');

  const res = await request('GET', '/graph/entity/person:alias_x');
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'person:canon_x');
  assert.equal(res.body.requested_id, 'person:alias_x');
  assert.equal(res.body.canonical_id, 'person:canon_x');
});

test('GET /graph/entity/:id lists relations from both canonical and its aliases', async () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:canon_r', 'CanonR', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:alias_r', 'AliasR', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('project:for_canon', 'F', 'project');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:canon_r', 'person:alias_r');
  // Edge was on the alias before merge:
  db.prepare(`INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at)
              VALUES ('t1','person:alias_r','works_on','project:for_canon',1.0,'email:x',?)`)
    .run(new Date().toISOString());

  const res = await request('GET', '/graph/entity/person:canon_r');
  assert.equal(res.status, 200);
  const objects = (res.body.relations || []).map(r => r.object);
  assert.ok(objects.includes('project:for_canon'), 'alias edge should appear on canonical');
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/server.test.mjs
```

Expected: 2 new failures.

- [ ] **Step 3: Update the handler in `lib/server.mjs`**

Find the existing handler that matches `/graph/entity/:id` (search for `'/graph/entity/'`). Modify it to:

```javascript
// /graph/entity/<id>
const entityMatch = pathname.match(/^\/graph\/entity\/(.+)$/);
if (entityMatch && req.method === 'GET') {
  const requestedId = decodeURIComponent(entityMatch[1]);
  const canonicalId = resolveAlias(db, requestedId);
  if (!canonicalId) return sendJson(res, 404, { error: 'entity not found' });
  const entity = getEntity(db, canonicalId);
  if (!entity) return sendJson(res, 404, { error: 'entity not found' });

  const aliasIds = listAliasesOf(db, canonicalId);
  const idsForRelations = [canonicalId, ...aliasIds];
  const placeholders = idsForRelations.map(() => '?').join(',');
  const relations = db.prepare(`
    SELECT * FROM triples
    WHERE subject IN (${placeholders}) OR object IN (${placeholders})
  `).all(...idsForRelations, ...idsForRelations);

  return sendJson(res, 200, {
    ...entity,
    requested_id: requestedId !== canonicalId ? requestedId : undefined,
    canonical_id: requestedId !== canonicalId ? canonicalId : undefined,
    relations,
  });
}
```

Add imports at top of `lib/server.mjs`:

```javascript
import { resolveAlias, listAliasesOf, getEntity } from './graph.mjs';
```

(Adjust import if `getEntity` is already imported.)

- [ ] **Step 4: Verify tests pass**

```bash
node --test test/server.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server.test.mjs
git commit -m "feat(knowledge-hub): /graph/entity resolves aliases"
```

---

### Task 9: Update `GET /graph/view` to hide aliases

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server.test.mjs`

- [ ] **Step 1: Append failing test**

```javascript
test('GET /graph/view omits aliased entities and substitutes edge endpoints', async () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:vcanon', 'VC', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:valias', 'VA', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('project:vproj', 'VP', 'project');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:vcanon', 'person:valias');
  db.prepare(`INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at)
              VALUES ('vt1','person:valias','works_on','project:vproj',1.0,'email:x',?)`)
    .run(new Date().toISOString());

  const res = await request('GET', '/graph/view');
  assert.equal(res.status, 200);
  const nodeIds = (res.body.nodes || res.body.entities || []).map(n => n.id);
  assert.ok(!nodeIds.includes('person:valias'), 'alias should not appear as node');
  assert.ok(nodeIds.includes('person:vcanon'), 'canonical should appear');
  const edges = res.body.edges || res.body.triples || [];
  const substituted = edges.find(e => e.object === 'project:vproj' && (e.subject === 'person:vcanon' || e.subject === 'person:valias'));
  assert.ok(substituted, 'edge should be present after alias substitution');
  assert.equal(substituted.subject, 'person:vcanon', 'edge subject should be substituted to canonical');
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/server.test.mjs
```

Expected: new failure.

- [ ] **Step 3: Update `/graph/view` handler**

Find the `/graph/view` handler in `lib/server.mjs` and modify node + edge emission:

```javascript
// In /graph/view handler, change the entities query to exclude aliases:
const entities = db.prepare(`
  SELECT * FROM entities WHERE canonical_id IS NULL ${productFilter ? 'AND product = ?' : ''}
`).all(...(productFilter ? [productFilter] : []));

// Fetch triples as today, then substitute + dedupe:
const rawTriples = db.prepare('SELECT * FROM triples').all();
const seen = new Set();
const triples = [];
for (const t of rawTriples) {
  const subj = resolveAlias(db, t.subject) || t.subject;
  const obj  = resolveAlias(db, t.object)  || t.object;
  const key = `${subj}|${t.predicate}|${obj}|${t.source}`;
  if (seen.has(key)) continue;
  seen.add(key);
  triples.push({ ...t, subject: subj, object: obj });
}
return sendJson(res, 200, { entities, triples });
```

(Adjust to match actual variable names in the existing handler. Look at lines near `'/graph/view'` in `lib/server.mjs` first.)

- [ ] **Step 4: Verify tests pass**

```bash
node --test test/server.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server.test.mjs
git commit -m "feat(knowledge-hub): /graph/view hides aliases, substitutes edges"
```

---

### Task 10: Update `/graph/neighbors/:id` and `/graph/path`

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server.test.mjs`

- [ ] **Step 1: Append failing tests**

```javascript
test('GET /graph/neighbors resolves alias before walking', async () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:ncanon', 'NC', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:nalias', 'NA', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('project:nproj', 'NP', 'project');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:ncanon', 'person:nalias');
  db.prepare(`INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at)
              VALUES ('nt1','person:ncanon','works_on','project:nproj',1.0,'email:x',?)`)
    .run(new Date().toISOString());

  const res = await request('GET', '/graph/neighbors/person:nalias?depth=1');
  assert.equal(res.status, 200);
  const nodes = (res.body.nodes || res.body.entities || []).map(n => n.id);
  assert.ok(nodes.includes('project:nproj'), 'should reach neighbors of canonical');
});

test('GET /graph/path resolves both endpoints', async () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:p_from', 'PF', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:p_into', 'PI', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:p_end', 'PE', 'person');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:p_into', 'person:p_from');
  db.prepare(`INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at)
              VALUES ('pt1','person:p_into','works_on','person:p_end',1.0,'email:x',?)`)
    .run(new Date().toISOString());

  // from=p_from (alias resolves to p_into), to=p_end
  const res = await request('GET', '/graph/path?from=person:p_from&to=person:p_end');
  assert.equal(res.status, 200);
  assert.ok(res.body.path && res.body.path.length > 0);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/server.test.mjs
```

Expected: new failures.

- [ ] **Step 3: Update both handlers**

In `/graph/neighbors/:id` handler, first line of body:

```javascript
const requestedId = decodeURIComponent(neighborsMatch[1]);
const id = resolveAlias(db, requestedId);
if (!id) return sendJson(res, 404, { error: 'entity not found' });
// ... rest continues using `id` as before
```

In `/graph/path` handler:

```javascript
const from = resolveAlias(db, params.from);
const to = resolveAlias(db, params.to);
if (!from || !to) return sendJson(res, 404, { error: 'entity not found' });
// ... rest uses `from` and `to`
```

- [ ] **Step 4: Verify tests pass**

```bash
node --test test/server.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server.test.mjs
git commit -m "feat(knowledge-hub): /graph/neighbors and /graph/path resolve aliases"
```

---

### Task 11: Update `/search/suggest` to mark aliases

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs` (or wherever search handler is)
- Modify: `services/knowledge-hub/test/search.test.mjs`

- [ ] **Step 1: Read `test/search.test.mjs` first** to see whether tests invoke the search function directly (import + call) or go through the HTTP handler (via a `request()` helper). The assertion pattern below is written against the HTTP-handler pattern; if the existing tests import the function, adapt the call accordingly.

- [ ] **Step 2: Append failing test to `test/search.test.mjs`**

```javascript
test('search suggest annotates aliases with canonical_name', async () => {
  // Seed canonical + alias
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:scanon', 'Alice Scanon', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:salias', 'Alice Salias', 'person');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:scanon', 'person:salias');

  // Search for the alias name specifically
  const res = await request('GET', '/search/suggest?q=Alice%20Salias');
  assert.equal(res.status, 200);
  const items = res.body.results || res.body.items || [];
  const alias = items.find(r => r.id === 'person:salias');
  assert.ok(alias, 'aliased entity should still appear in search');
  assert.equal(alias.canonical_name, 'Alice Scanon');

  // Canonical itself should not have canonical_name (it's not an alias)
  const canonRes = await request('GET', '/search/suggest?q=Alice%20Scanon');
  const canon = (canonRes.body.results || canonRes.body.items || []).find(r => r.id === 'person:scanon');
  assert.ok(canon);
  assert.equal(canon.canonical_name, undefined);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/search.test.mjs
```

Expected: new failure.

- [ ] **Step 3: Update the search/suggest handler**

Find `/search/suggest` (or equivalent) in `lib/server.mjs` or `lib/search.mjs`. After building the result list, annotate each:

```javascript
for (const r of results) {
  if (r.canonical_id) {
    const canon = getEntity(db, r.canonical_id);
    if (canon) r.canonical_name = canon.name;
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
node --test test/search.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/search.test.mjs
git commit -m "feat(knowledge-hub): search suggest annotates aliases"
```

---

## Phase 4 — Write routes

### Task 12: `POST /graph/entities` + auth middleware

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Create: `services/knowledge-hub/test/server-editor.test.mjs`

- [ ] **Step 1: Create test file with auth + happy-path tests**

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { initDb } from '../lib/db.mjs';
import { startServer } from '../lib/server.mjs';  // export startServer from server.mjs

const dbPath = path.join(os.tmpdir(), `kh-editor-srv-${Date.now()}.db`);
const apiKeyPath = path.join(os.tmpdir(), `kh-key-${Date.now()}.txt`);
fs.writeFileSync(apiKeyPath, 'test-api-key');
let db, server, baseUrl;

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const r = http.request(`${baseUrl}${path}`, opts, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

before(async () => {
  db = initDb(dbPath);
  const result = await startServer({
    port: 0, db, apiKeyFile: apiKeyPath
  });
  server = result.server;
  baseUrl = `http://127.0.0.1:${result.port}`;
});
after(() => {
  if (server) server.close();
  if (db) db.close();
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(apiKeyPath); } catch {}
});

test('POST /graph/entities rejects without api key', async () => {
  const res = await req('POST', '/graph/entities', { name: 'x', type: 'person' });
  assert.equal(res.status, 401);
});

test('POST /graph/entities rejects wrong api key', async () => {
  const res = await req('POST', '/graph/entities', { name: 'x', type: 'person' }, { 'x-api-key': 'wrong' });
  assert.equal(res.status, 401);
});

test('POST /graph/entities creates entity with auth', async () => {
  const res = await req('POST', '/graph/entities',
    { name: 'New Person', type: 'person' },
    { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 201);
  assert.equal(res.body.type, 'person');
  assert.equal(res.body.id, 'person:new_person');
});

test('POST /graph/entities returns 400 for validation error', async () => {
  const res = await req('POST', '/graph/entities',
    { name: 'Bad', type: 'robot' },
    { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/server-editor.test.mjs
```

Expected: tests fail because route doesn't exist / `startServer` isn't exported.

- [ ] **Step 3: Ensure `startServer` is exported**

Check `lib/server.mjs` for a top-level `createServer`/`listen` call. If the server is started directly on import, refactor so it exports a function:

```javascript
export async function startServer({ port, db, apiKeyFile } = {}) {
  // ... existing server setup, but use passed-in db/apiKeyFile if provided
  const server = http.createServer(handler);
  await new Promise((resolve, reject) =>
    server.listen(port, (err) => err ? reject(err) : resolve()));
  return { server, port: server.address().port };
}
```

If `server.mjs` is currently a script that starts on import, wrap the existing body in this function and guard the auto-start with `import.meta.url === \`file://${process.argv[1]}\``.

- [ ] **Step 4: Add `apiKeyMiddleware` + `POST /graph/entities`**

Add at the top of the request handler:

```javascript
function requireApiKey(req) {
  const headerKey = req.headers['x-api-key'] || '';
  const expected = _apiKey.trim();  // from config.api_key_file, read at startup
  if (!expected || headerKey !== expected) return false;
  return true;
}
```

Route handler:

```javascript
if (pathname === '/graph/entities' && req.method === 'POST') {
  if (!requireApiKey(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const body = await readJsonBody(req);
  try {
    const entity = createEntity(db, body);
    return sendJson(res, 201, entity);
  } catch (e) {
    if (e.name === 'ValidationError') return sendJson(res, 400, { error: e.message, code: 'ValidationError' });
    if (e.name === 'NotFoundError')   return sendJson(res, 404, { error: e.message, code: 'NotFoundError' });
    throw e;
  }
}
```

Add imports at top of `lib/server.mjs`:

```javascript
import { createEntity } from './graph-editor.mjs';
```

Add a `readJsonBody(req)` helper if one doesn't exist:

```javascript
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf-8');
  return s ? JSON.parse(s) : {};
}
```

- [ ] **Step 5: Verify tests pass**

```bash
node --test test/server-editor.test.mjs
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server-editor.test.mjs
git commit -m "feat(knowledge-hub): POST /graph/entities + auth middleware"
```

---

### Task 13: `POST /graph/triples`

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server-editor.test.mjs`

- [ ] **Step 1: Append failing tests**

```javascript
test('POST /graph/triples creates manual edge', async () => {
  await req('POST', '/graph/entities', { id: 'person:pa', name: 'PA', type: 'person' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/entities', { id: 'project:pb', name: 'pb', type: 'project', product: 'diemaster' }, { 'x-api-key': 'test-api-key' });
  const res = await req('POST', '/graph/triples',
    { subject: 'person:pa', predicate: 'works_on', object: 'project:pb' },
    { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 201);
  assert.equal(res.body.source, 'manual');
});

test('POST /graph/triples returns 404 for missing entities', async () => {
  const res = await req('POST', '/graph/triples',
    { subject: 'person:ghost_pt', predicate: 'x', object: 'project:pb' },
    { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 404);
});

test('POST /graph/triples returns 409 for part_of cycle', async () => {
  await req('POST', '/graph/entities', { id: 'plant:pt_a', name: 'PTA', type: 'plant' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/entities', { id: 'plant:pt_b', name: 'PTB', type: 'plant' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/triples',
    { subject: 'plant:pt_a', predicate: 'part_of', object: 'plant:pt_b' },
    { 'x-api-key': 'test-api-key' });
  const res = await req('POST', '/graph/triples',
    { subject: 'plant:pt_b', predicate: 'part_of', object: 'plant:pt_a' },
    { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 409);
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Add handler in `lib/server.mjs`**

```javascript
if (pathname === '/graph/triples' && req.method === 'POST') {
  if (!requireApiKey(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const body = await readJsonBody(req);
  try {
    const triple = addManualTriple(db, body);
    return sendJson(res, 201, triple);
  } catch (e) {
    if (e.name === 'ValidationError') return sendJson(res, 400, { error: e.message, code: 'ValidationError' });
    if (e.name === 'NotFoundError')   return sendJson(res, 404, { error: e.message, code: 'NotFoundError' });
    if (e.name === 'CycleError')      return sendJson(res, 409, { error: e.message, code: 'CycleError' });
    throw e;
  }
}
```

Add import: `import { createEntity, addManualTriple } from './graph-editor.mjs';`

- [ ] **Step 4: Verify tests pass**

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server-editor.test.mjs
git commit -m "feat(knowledge-hub): POST /graph/triples"
```

---

### Task 14: `DELETE /graph/triples/:id`

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server-editor.test.mjs`

- [ ] **Step 1: Append failing tests**

```javascript
test('DELETE /graph/triples/:id removes manual triple', async () => {
  await req('POST', '/graph/entities', { id: 'person:dt', name: 'DT', type: 'person' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/entities', { id: 'project:dt', name: 'dt', type: 'project', product: 'diemaster' }, { 'x-api-key': 'test-api-key' });
  const ins = await req('POST', '/graph/triples',
    { subject: 'person:dt', predicate: 'works_on', object: 'project:dt' },
    { 'x-api-key': 'test-api-key' });
  const delRes = await req('DELETE', `/graph/triples/${ins.body.id}`, null, { 'x-api-key': 'test-api-key' });
  assert.equal(delRes.status, 204);
});

test('DELETE /graph/triples/:id returns 400 for non-manual', async () => {
  db.prepare(`INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at)
              VALUES ('seed:plants:xyz','person:dt','x','project:dt',1.0,'seed:plants',?)`)
    .run(new Date().toISOString());
  const res = await req('DELETE', '/graph/triples/seed:plants:xyz', null, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Add handler**

```javascript
const tripleDelMatch = pathname.match(/^\/graph\/triples\/(.+)$/);
if (tripleDelMatch && req.method === 'DELETE') {
  if (!requireApiKey(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const id = decodeURIComponent(tripleDelMatch[1]);
  try {
    deleteManualTriple(db, id);
    res.statusCode = 204; return res.end();
  } catch (e) {
    if (e.name === 'ValidationError') return sendJson(res, 400, { error: e.message, code: 'ValidationError' });
    if (e.name === 'NotFoundError')   return sendJson(res, 404, { error: e.message, code: 'NotFoundError' });
    throw e;
  }
}
```

Update import: `import { createEntity, addManualTriple, deleteManualTriple } from './graph-editor.mjs';`

- [ ] **Step 4: Verify tests pass**

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server-editor.test.mjs
git commit -m "feat(knowledge-hub): DELETE /graph/triples/:id"
```

---

### Task 15: `POST /graph/merge`

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server-editor.test.mjs`

- [ ] **Step 1: Append failing tests**

```javascript
test('POST /graph/merge sets canonical_id and read-time resolves', async () => {
  await req('POST', '/graph/entities', { id: 'person:ma', name: 'MA', type: 'person' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/entities', { id: 'person:mb', name: 'MB', type: 'person' }, { 'x-api-key': 'test-api-key' });

  const res = await req('POST', '/graph/merge', { from: 'person:ma', into: 'person:mb' }, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 200);
  assert.equal(res.body.canonicalId, 'person:mb');

  // Verify read-time resolution
  const get = await req('GET', '/graph/entity/person:ma');
  assert.equal(get.body.id, 'person:mb');
  assert.equal(get.body.requested_id, 'person:ma');
});

test('POST /graph/merge rejects self-merge (400)', async () => {
  await req('POST', '/graph/entities', { id: 'person:self_m', name: 'SM', type: 'person' }, { 'x-api-key': 'test-api-key' });
  const res = await req('POST', '/graph/merge',
    { from: 'person:self_m', into: 'person:self_m' },
    { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Add handler**

```javascript
if (pathname === '/graph/merge' && req.method === 'POST') {
  if (!requireApiKey(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const body = await readJsonBody(req);
  try {
    const out = mergeEntities(db, { fromId: body.from, intoId: body.into });
    return sendJson(res, 200, out);
  } catch (e) {
    if (e.name === 'ValidationError') return sendJson(res, 400, { error: e.message, code: 'ValidationError' });
    if (e.name === 'NotFoundError')   return sendJson(res, 404, { error: e.message, code: 'NotFoundError' });
    throw e;
  }
}
```

Import: `import { createEntity, addManualTriple, deleteManualTriple, mergeEntities } from './graph-editor.mjs';`

- [ ] **Step 4: Verify tests pass**

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server-editor.test.mjs
git commit -m "feat(knowledge-hub): POST /graph/merge"
```

---

### Task 16: `POST /graph/unmerge/:id`

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server-editor.test.mjs`

- [ ] **Step 1: Append failing test**

```javascript
test('POST /graph/unmerge/:id reverses a merge', async () => {
  await req('POST', '/graph/entities', { id: 'person:unm_a', name: 'UA', type: 'person' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/entities', { id: 'person:unm_b', name: 'UB', type: 'person' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/merge', { from: 'person:unm_a', into: 'person:unm_b' }, { 'x-api-key': 'test-api-key' });

  const res = await req('POST', '/graph/unmerge/person:unm_a', null, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 200);
  assert.equal(res.body.canonical_id, null);

  const get = await req('GET', '/graph/entity/person:unm_a');
  assert.equal(get.body.id, 'person:unm_a');
  assert.equal(get.body.canonical_id, undefined); // not aliased anymore
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Add handler**

```javascript
const unmergeMatch = pathname.match(/^\/graph\/unmerge\/(.+)$/);
if (unmergeMatch && req.method === 'POST') {
  if (!requireApiKey(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const id = decodeURIComponent(unmergeMatch[1]);
  try {
    const out = unmergeEntity(db, id);
    return sendJson(res, 200, out);
  } catch (e) {
    if (e.name === 'NotFoundError') return sendJson(res, 404, { error: e.message, code: 'NotFoundError' });
    throw e;
  }
}
```

Import: `import { createEntity, addManualTriple, deleteManualTriple, mergeEntities, unmergeEntity } from './graph-editor.mjs';`

- [ ] **Step 4: Verify tests pass**

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server-editor.test.mjs
git commit -m "feat(knowledge-hub): POST /graph/unmerge/:id"
```

---

### Task 17: `GET /graph/predicates`

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server-editor.test.mjs`

- [ ] **Step 1: Append failing test**

```javascript
test('GET /graph/predicates returns curated + DB predicates (no auth required)', async () => {
  const res = await req('GET', '/graph/predicates');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.predicates));
  assert.ok(res.body.predicates.includes('works_on'));
  assert.ok(res.body.predicates.includes('part_of'));
  assert.ok(res.body.predicates.includes('mentions'));
});
```

- [ ] **Step 2: Run to confirm failure**

- [ ] **Step 3: Add handler**

Near top of `lib/server.mjs` (outside request handler):

```javascript
const CURATED_PREDICATES = [
  'works_on', 'works_at', 'works_for', 'has_role',
  'belongs_to', 'part_of', 'involves', 'client_of', 'supplies_to',
  'reports_to', 'collaborates_with', 'mentions', 'depends_on', 'about',
];
```

Handler:

```javascript
if (pathname === '/graph/predicates' && req.method === 'GET') {
  const rows = db.prepare('SELECT DISTINCT predicate FROM triples').all();
  const fromDb = rows.map(r => r.predicate);
  const set = new Set([...CURATED_PREDICATES, ...fromDb]);
  return sendJson(res, 200, { predicates: [...set].sort() });
}
```

- [ ] **Step 4: Verify tests pass**

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server-editor.test.mjs
git commit -m "feat(knowledge-hub): GET /graph/predicates"
```

---

## Phase 5 — Plant bootstrap

### Task 18: `config/plants.json` + `scripts/seed-plants.mjs`

**Files:**
- Create: `services/knowledge-hub/config/plants.json`
- Create: `services/knowledge-hub/scripts/seed-plants.mjs`
- Create: `services/knowledge-hub/test/seed-plants.test.mjs`

- [ ] **Step 1: Create `config/plants.json`**

```json
{
  "company:gm": {
    "name": "General Motors",
    "plants": [
      { "id": "plant:gm_sjc",      "name": "GM São José dos Campos",   "city": "São José dos Campos", "country": "BR" },
      { "id": "plant:gm_gravatai", "name": "GM Gravataí",                "city": "Gravataí",            "country": "BR" },
      { "id": "plant:gm_flint",    "name": "GM Flint",                   "city": "Flint",               "country": "US" }
    ]
  },
  "company:nissan": {
    "name": "Nissan",
    "plants": [
      { "id": "plant:nissan_smyrna", "name": "Nissan Smyrna", "city": "Smyrna", "country": "US" },
      { "id": "plant:nissan_canton", "name": "Nissan Canton", "city": "Canton", "country": "US" }
    ]
  },
  "company:arcelormittal": {
    "name": "ArcelorMittal",
    "plants": [
      { "id": "plant:arcelormittal_tubarao", "name": "ArcelorMittal Tubarão", "city": "Vitória", "country": "BR" }
    ]
  }
}
```

- [ ] **Step 2: Write failing test**

Create `test/seed-plants.test.mjs`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../lib/db.mjs';
import { seedPlants } from '../scripts/seed-plants.mjs';

const dbPath = path.join(os.tmpdir(), `kh-seed-test-${Date.now()}.db`);
let db;

before(() => { db = initDb(dbPath); });
after(() => {
  if (db) db.close();
  try { fs.unlinkSync(dbPath); } catch {}
});

const SEED = {
  'company:testco': {
    name: 'Test Co',
    plants: [
      { id: 'plant:testco_one', name: 'TestCo One', city: 'A', country: 'BR' },
      { id: 'plant:testco_two', name: 'TestCo Two', city: 'B', country: 'BR' },
    ],
  },
};

test('seedPlants upserts companies and plants with part_of edges', () => {
  seedPlants(db, SEED);
  const co = db.prepare('SELECT * FROM entities WHERE id = ?').get('company:testco');
  assert.equal(co.name, 'Test Co');
  const plants = db.prepare('SELECT * FROM entities WHERE type = ?').all('plant');
  assert.equal(plants.length, 2);
  const edges = db.prepare(`SELECT * FROM triples WHERE predicate='part_of' AND source='seed:plants'`).all();
  assert.equal(edges.length, 2);
  for (const e of edges) {
    assert.equal(e.object, 'company:testco');
  }
});

test('seedPlants is idempotent', () => {
  const before = db.prepare("SELECT COUNT(*) c FROM triples WHERE source='seed:plants'").get().c;
  seedPlants(db, SEED);
  const after = db.prepare("SELECT COUNT(*) c FROM triples WHERE source='seed:plants'").get().c;
  assert.equal(before, after);
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
node --test test/seed-plants.test.mjs
```

Expected: "Cannot find module '../scripts/seed-plants.mjs'".

- [ ] **Step 4: Create `scripts/seed-plants.mjs`**

```javascript
#!/usr/bin/env node
/**
 * Seed plants and companies from config/plants.json.
 * Idempotent: re-running overwrites entity rows and reinserts triples
 * with deterministic IDs (so no duplicates accumulate).
 *
 * Usage: node scripts/seed-plants.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initDb } from '../lib/db.mjs';
import { loadConfig } from '../lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, '..', 'config', 'plants.json');

function tripleId(subject, predicate, object) {
  const h = crypto.createHash('md5').update(`${subject}|${predicate}|${object}|seed:plants`).digest('hex').slice(0, 16);
  return `seed:plants:${h}`;
}

export function seedPlants(db, seed) {
  const upsertEntity = db.prepare(`
    INSERT INTO entities (id, name, type, properties, project_code, product, canonical_id)
    VALUES (?, ?, ?, ?, NULL, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, properties=excluded.properties
  `);
  const upsertTriple = db.prepare(`
    INSERT OR REPLACE INTO triples (id, subject, predicate, object, confidence, source, created_at)
    VALUES (?, ?, ?, ?, 1.0, 'seed:plants', ?)
  `);
  const now = new Date().toISOString();

  for (const [companyId, cfg] of Object.entries(seed)) {
    upsertEntity.run(companyId, cfg.name, 'company', '{}');
    for (const plant of cfg.plants || []) {
      upsertEntity.run(plant.id, plant.name, 'plant', JSON.stringify({ city: plant.city, country: plant.country }));
      upsertTriple.run(tripleId(plant.id, 'part_of', companyId), plant.id, 'part_of', companyId, now);
    }
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const db = initDb(config.db_path);
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  seedPlants(db, seed);
  console.log(`[seed-plants] seeded ${Object.keys(seed).length} companies and their plants`);
}
```

- [ ] **Step 5: Verify tests pass**

```bash
node --test test/seed-plants.test.mjs
```

Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add services/knowledge-hub/config/plants.json services/knowledge-hub/scripts/seed-plants.mjs services/knowledge-hub/test/seed-plants.test.mjs
git commit -m "feat(knowledge-hub): plants.json + idempotent seed script"
```

---

## Phase 6 — Dashboard UI

### Task 19: `editor.css` + modal scaffolding in `index.html`

**Files:**
- Create: `services/knowledge-hub/dashboard/editor.css`
- Modify: `services/knowledge-hub/dashboard/index.html`
- Modify: `services/knowledge-hub/dashboard/validation.html` (add editor.css/editor.js to share styles if needed — leave alone if it causes issues)

- [ ] **Step 1: Create `dashboard/editor.css`**

```css
/* Modals for manual graph editing — matches existing validation.css patterns */
.kh-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999; display: none;
}
.kh-modal-backdrop.active { display: flex; }
.kh-modal {
  background: var(--panel-bg, #1a1a1d);
  color: var(--fg, #e8e8ea);
  border-radius: 8px;
  width: 420px; max-width: 90vw;
  padding: 20px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
}
.kh-modal h3 { margin-top: 0; font-size: 1.1rem; }
.kh-modal label { display: block; margin-top: 12px; font-size: 0.9rem; color: var(--muted, #9a9aa0); }
.kh-modal input, .kh-modal select, .kh-modal textarea {
  width: 100%; box-sizing: border-box;
  margin-top: 4px; padding: 6px 8px;
  background: var(--input-bg, #111); color: inherit;
  border: 1px solid var(--border, #333); border-radius: 4px;
}
.kh-modal .row-buttons { margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px; }
.kh-modal button { padding: 6px 14px; border-radius: 4px; border: 1px solid var(--border, #333); background: var(--btn-bg, #222); color: inherit; cursor: pointer; }
.kh-modal button.primary { background: var(--accent, #3b7dd8); border-color: var(--accent, #3b7dd8); }
.kh-autocomplete { position: relative; }
.kh-autocomplete-results {
  position: absolute; left: 0; right: 0; top: 100%;
  background: var(--panel-bg, #1a1a1d);
  border: 1px solid var(--border, #333);
  max-height: 180px; overflow: auto;
  z-index: 10;
}
.kh-autocomplete-result { padding: 6px 10px; cursor: pointer; }
.kh-autocomplete-result:hover { background: var(--hover, #2a2a2e); }
.panel-relation-delete {
  margin-left: 8px; cursor: pointer; color: var(--danger, #c74); opacity: 0.5;
}
.panel-relation-delete:hover { opacity: 1; }
.panel-relation-auto { font-size: 0.75em; color: var(--muted, #666); margin-left: 8px; }
.panel-alias-banner {
  padding: 8px 12px; margin: 8px 0;
  background: var(--warning-bg, #442); border-left: 3px solid var(--warning, #cc8);
  font-size: 0.9em; cursor: pointer;
}
```

- [ ] **Step 2: Add `<link>` + `<script>` + modal markup to `dashboard/index.html`**

Inside `<head>`, after existing `<link rel="stylesheet" href="/dashboard/style.css">`:

```html
<link rel="stylesheet" href="/dashboard/editor.css">
```

Just before `</body>`, after existing `<script>` tags:

```html
<!-- Manual graph editing modals -->
<div id="kh-modal-add-relation" class="kh-modal-backdrop">
  <div class="kh-modal">
    <h3>Add Relation</h3>
    <label>Predicate
      <select id="kh-rel-predicate"></select>
    </label>
    <div id="kh-rel-custom-wrap" style="display:none;">
      <label>Custom predicate
        <input id="kh-rel-custom" type="text" placeholder="e.g. subcontracts_to">
      </label>
      <div id="kh-rel-custom-preview" style="font-size:0.8em;color:#888;margin-top:4px;"></div>
    </div>
    <label>Target entity
      <div class="kh-autocomplete">
        <input id="kh-rel-target" type="text" placeholder="Type to search…" autocomplete="off">
        <div id="kh-rel-target-results" class="kh-autocomplete-results"></div>
      </div>
    </label>
    <div class="row-buttons">
      <button id="kh-rel-cancel">Cancel</button>
      <button id="kh-rel-save" class="primary">Add Relation</button>
    </div>
  </div>
</div>

<div id="kh-modal-merge" class="kh-modal-backdrop">
  <div class="kh-modal">
    <h3>Merge Into…</h3>
    <p id="kh-merge-from-label" style="color:#9a9aa0;font-size:0.9em;"></p>
    <label>Target entity
      <div class="kh-autocomplete">
        <input id="kh-merge-target" type="text" placeholder="Type to search…" autocomplete="off">
        <div id="kh-merge-target-results" class="kh-autocomplete-results"></div>
      </div>
    </label>
    <p style="margin-top:12px;color:#9a9aa0;font-size:0.85em;">All edges from this entity will resolve to the selected target. You can unmerge later.</p>
    <div class="row-buttons">
      <button id="kh-merge-cancel">Cancel</button>
      <button id="kh-merge-save" class="primary">Merge</button>
    </div>
  </div>
</div>

<div id="kh-modal-create" class="kh-modal-backdrop">
  <div class="kh-modal">
    <h3>Create Entity</h3>
    <label>Type
      <select id="kh-create-type">
        <option value="person">person</option>
        <option value="company">company</option>
        <option value="plant">plant</option>
        <option value="project">project</option>
        <option value="product">product</option>
        <option value="role">role</option>
      </select>
    </label>
    <label>Name
      <input id="kh-create-name" type="text">
    </label>
    <label id="kh-create-product-wrap" style="display:none;">Product
      <select id="kh-create-product">
        <option value="diemaster">diemaster</option>
        <option value="spotfusion">spotfusion</option>
        <option value="visionking">visionking</option>
      </select>
    </label>
    <label id="kh-create-project-code-wrap" style="display:none;">Project code (optional)
      <input id="kh-create-project-code" type="text" placeholder="01001">
    </label>
    <div class="row-buttons">
      <button id="kh-create-cancel">Cancel</button>
      <button id="kh-create-save" class="primary">Create</button>
    </div>
  </div>
</div>

<script src="/dashboard/editor.js"></script>
```

- [ ] **Step 3: Smoke-test by loading the page**

```bash
cd services/knowledge-hub && node lib/server.mjs &
# Then open http://localhost:8093/dashboard/ and check browser console for errors.
# No styling changes visible until editor.js is wired; just verify no 404s in network tab for editor.css / editor.js.
kill %1
```

(editor.js doesn't exist yet; expect one 404 for it — that's fine.)

- [ ] **Step 4: Commit**

```bash
git add services/knowledge-hub/dashboard/editor.css services/knowledge-hub/dashboard/index.html
git commit -m "feat(knowledge-hub): dashboard modal scaffolds + editor.css"
```

---

### Task 20: `editor.js` — Add Relation modal + API key manager

**Files:**
- Create: `services/knowledge-hub/dashboard/editor.js`

- [ ] **Step 1: Implement editor.js (first pass — Add Relation + API key)**

```javascript
// Graph Editor — modal lifecycles and fetch calls for manual graph editing.
// Relies on markup in index.html (#kh-modal-*).

(function () {
  const API_KEY_STORAGE = 'kh_api_key';

  function getApiKey() {
    return localStorage.getItem(API_KEY_STORAGE) || '';
  }
  function setApiKey(k) { localStorage.setItem(API_KEY_STORAGE, k); }
  function promptApiKey() {
    const k = prompt('Enter knowledge-hub API key:', getApiKey());
    if (k) setApiKey(k);
    return k || '';
  }

  async function authFetch(url, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    let key = getApiKey();
    if (!key) key = promptApiKey();
    headers['X-API-Key'] = key;
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      localStorage.removeItem(API_KEY_STORAGE);
      const retryKey = promptApiKey();
      if (!retryKey) throw new Error('API key required');
      headers['X-API-Key'] = retryKey;
      return fetch(url, Object.assign({}, opts, { headers }));
    }
    return res;
  }

  // ── Modals ────────────────────────────────────────────────────────────
  function openModal(id) { document.getElementById(id).classList.add('active'); }
  function closeModal(id) { document.getElementById(id).classList.remove('active'); }

  // ── Autocomplete helper ──────────────────────────────────────────────
  function wireAutocomplete(inputEl, resultsEl, onSelect) {
    let currentValue = null;
    let timer = null;
    inputEl.addEventListener('input', () => {
      clearTimeout(timer);
      const q = inputEl.value.trim();
      if (!q) { resultsEl.innerHTML = ''; return; }
      timer = setTimeout(async () => {
        try {
          const r = await fetch(`/search/suggest?q=${encodeURIComponent(q)}`);
          const data = await r.json();
          const items = data.results || data.items || [];
          resultsEl.innerHTML = items.map(it =>
            `<div class="kh-autocomplete-result" data-id="${it.id}">${it.name} <span style="color:#888;font-size:0.8em">(${it.type})</span>${it.canonical_name ? ` <span style="color:#c88;font-size:0.8em">↳ ${it.canonical_name}</span>` : ''}</div>`
          ).join('');
          [...resultsEl.querySelectorAll('.kh-autocomplete-result')].forEach(el => {
            el.addEventListener('click', () => {
              currentValue = el.dataset.id;
              inputEl.value = el.textContent;
              resultsEl.innerHTML = '';
              onSelect(currentValue);
            });
          });
        } catch (e) { console.error('autocomplete', e); }
      }, 200);
    });
    return { getValue: () => currentValue, reset: () => { currentValue = null; inputEl.value = ''; resultsEl.innerHTML = ''; } };
  }

  // ── Add Relation modal ───────────────────────────────────────────────
  let currentEntityId = null;
  let relTarget = null;

  async function loadPredicates() {
    const sel = document.getElementById('kh-rel-predicate');
    try {
      const r = await fetch('/graph/predicates');
      const data = await r.json();
      sel.innerHTML = data.predicates.map(p => `<option value="${p}">${p}</option>`).join('') +
        '<option value="__custom__">Custom…</option>';
    } catch (e) { console.error(e); }
  }

  function normalizePredicate(s) {
    return s.trim().toLowerCase().replace(/[\s\-]+/g, '_');
  }

  function wireAddRelationModal() {
    const sel = document.getElementById('kh-rel-predicate');
    const customWrap = document.getElementById('kh-rel-custom-wrap');
    const customInput = document.getElementById('kh-rel-custom');
    const customPreview = document.getElementById('kh-rel-custom-preview');
    sel.addEventListener('change', () => {
      customWrap.style.display = sel.value === '__custom__' ? 'block' : 'none';
    });
    customInput.addEventListener('input', () => {
      customPreview.textContent = customInput.value ? `→ ${normalizePredicate(customInput.value)}` : '';
    });

    const targetInput = document.getElementById('kh-rel-target');
    const targetResults = document.getElementById('kh-rel-target-results');
    const targetAC = wireAutocomplete(targetInput, targetResults, (id) => { relTarget = id; });

    document.getElementById('kh-rel-cancel').addEventListener('click', () => closeModal('kh-modal-add-relation'));
    document.getElementById('kh-rel-save').addEventListener('click', async () => {
      const rawPred = sel.value === '__custom__' ? customInput.value : sel.value;
      const pred = normalizePredicate(rawPred);
      if (!pred || !relTarget || !currentEntityId) return;
      try {
        const res = await authFetch('/graph/triples', {
          method: 'POST',
          body: JSON.stringify({ subject: currentEntityId, predicate: pred, object: relTarget }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(`Error: ${err.error || res.status}`);
          return;
        }
        closeModal('kh-modal-add-relation');
        targetAC.reset();
        // Refresh panel by re-fetching entity
        if (window.kh_reloadPanel) window.kh_reloadPanel(currentEntityId);
      } catch (e) { alert(e.message); }
    });
  }

  // ── Public API used by panel.js ──────────────────────────────────────
  window.kh_editor = {
    openAddRelation(entityId) {
      currentEntityId = entityId;
      relTarget = null;
      openModal('kh-modal-add-relation');
    },
    // openMerge and openCreate added in later tasks
  };

  // ── Init ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    loadPredicates();
    wireAddRelationModal();
  });
})();
```

- [ ] **Step 2: Manual smoke — load dashboard, verify no console errors**

```bash
cd services/knowledge-hub && node lib/server.mjs &
# Open http://localhost:8093/dashboard/, open browser devtools → Console.
# Expected: no red errors. Network tab: editor.js loads 200.
# The Add Relation button isn't wired yet (panel.js edit in Task 23), so you can't test it end-to-end.
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add services/knowledge-hub/dashboard/editor.js
git commit -m "feat(knowledge-hub): dashboard/editor.js — Add Relation modal + auth"
```

---

### Task 21: `editor.js` — Merge modal

**Files:**
- Modify: `services/knowledge-hub/dashboard/editor.js`

- [ ] **Step 1: Append merge modal logic**

Append inside the IIFE, before the `window.kh_editor` block:

```javascript
  // ── Merge modal ─────────────────────────────────────────────────────
  let mergeFromId = null;
  let mergeTarget = null;

  function wireMergeModal() {
    const targetInput = document.getElementById('kh-merge-target');
    const targetResults = document.getElementById('kh-merge-target-results');
    const targetAC = wireAutocomplete(targetInput, targetResults, (id) => { mergeTarget = id; });

    document.getElementById('kh-merge-cancel').addEventListener('click', () => closeModal('kh-modal-merge'));
    document.getElementById('kh-merge-save').addEventListener('click', async () => {
      if (!mergeFromId || !mergeTarget) return;
      try {
        const res = await authFetch('/graph/merge', {
          method: 'POST',
          body: JSON.stringify({ from: mergeFromId, into: mergeTarget }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(`Error: ${err.error || res.status}`);
          return;
        }
        closeModal('kh-modal-merge');
        targetAC.reset();
        if (window.kh_reloadPanel) window.kh_reloadPanel(mergeTarget);
      } catch (e) { alert(e.message); }
    });
  }
```

Extend the public API:

```javascript
  window.kh_editor = {
    openAddRelation(entityId) { ... existing ... },
    openMerge(entityId, entityName) {
      mergeFromId = entityId;
      mergeTarget = null;
      document.getElementById('kh-merge-from-label').textContent = `Merging: ${entityName} (${entityId})`;
      openModal('kh-modal-merge');
    },
    async unmerge(entityId) {
      try {
        const res = await authFetch(`/graph/unmerge/${encodeURIComponent(entityId)}`, { method: 'POST' });
        if (!res.ok) {
          const err = await res.json();
          alert(`Error: ${err.error || res.status}`);
          return;
        }
        if (window.kh_reloadPanel) window.kh_reloadPanel(entityId);
      } catch (e) { alert(e.message); }
    },
  };
```

In the `DOMContentLoaded` handler, add `wireMergeModal();`.

- [ ] **Step 2: Manual smoke**

Reload dashboard; confirm no console errors.

- [ ] **Step 3: Commit**

```bash
git add services/knowledge-hub/dashboard/editor.js
git commit -m "feat(knowledge-hub): editor.js — Merge + Unmerge wiring"
```

---

### Task 22: `editor.js` — Create Entity modal + delete manual triple

**Files:**
- Modify: `services/knowledge-hub/dashboard/editor.js`

- [ ] **Step 1: Append Create Entity logic and deleteTriple**

Before `window.kh_editor`:

```javascript
  // ── Create Entity modal ─────────────────────────────────────────────
  let createInlineCallback = null;

  function wireCreateModal() {
    const typeSel = document.getElementById('kh-create-type');
    const nameInput = document.getElementById('kh-create-name');
    const productWrap = document.getElementById('kh-create-product-wrap');
    const projectCodeWrap = document.getElementById('kh-create-project-code-wrap');

    function updateConditional() {
      productWrap.style.display = typeSel.value === 'project' ? 'block' : 'none';
      projectCodeWrap.style.display = (typeSel.value === 'plant' || typeSel.value === 'person') ? 'block' : 'none';
    }
    typeSel.addEventListener('change', updateConditional);
    updateConditional();

    document.getElementById('kh-create-cancel').addEventListener('click', () => {
      closeModal('kh-modal-create');
      createInlineCallback = null;
    });
    document.getElementById('kh-create-save').addEventListener('click', async () => {
      const body = { type: typeSel.value, name: nameInput.value.trim() };
      if (!body.name) { alert('name is required'); return; }
      if (body.type === 'project') body.product = document.getElementById('kh-create-product').value;
      const pc = document.getElementById('kh-create-project-code').value.trim();
      if (pc) body.project_code = pc;
      try {
        const res = await authFetch('/graph/entities', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) {
          const err = await res.json();
          alert(`Error: ${err.error || res.status}`);
          return;
        }
        const entity = await res.json();
        closeModal('kh-modal-create');
        if (createInlineCallback) { createInlineCallback(entity); createInlineCallback = null; }
      } catch (e) { alert(e.message); }
    });
  }
```

Extend public API:

```javascript
  window.kh_editor = {
    // ... existing ...
    openCreate(prefillName, onCreate) {
      document.getElementById('kh-create-name').value = prefillName || '';
      createInlineCallback = onCreate || null;
      openModal('kh-modal-create');
    },
    async deleteTriple(tripleId) {
      if (!confirm('Delete this relation?')) return;
      try {
        const res = await authFetch(`/graph/triples/${encodeURIComponent(tripleId)}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) {
          const err = await res.json();
          alert(`Error: ${err.error || res.status}`);
          return;
        }
        if (window.kh_reloadPanel && currentEntityId) window.kh_reloadPanel(currentEntityId);
      } catch (e) { alert(e.message); }
    },
  };
```

Add `wireCreateModal();` in `DOMContentLoaded`.

- [ ] **Step 2: Manual smoke**

- [ ] **Step 3: Commit**

```bash
git add services/knowledge-hub/dashboard/editor.js
git commit -m "feat(knowledge-hub): editor.js — Create Entity + deleteTriple"
```

---

### Task 23: `panel.js` — wire buttons + × delete + alias banner

**Files:**
- Modify: `services/knowledge-hub/dashboard/panel.js`

- [ ] **Step 1: Add buttons to panel header**

Find where the panel header/title is rendered. Add three buttons after the existing close button:

```javascript
// Pseudo-code — adapt to actual panel.js structure.
// After the close button HTML:
headerHtml += `
  <button class="panel-btn" id="panel-add-relation" title="Add relation">+ Relation</button>
  <button class="panel-btn" id="panel-merge" title="Merge into…">Merge into…</button>
  ${entity.canonical_id ? `<button class="panel-btn" id="panel-unmerge" title="Unmerge">Unmerge</button>` : ''}
`;
```

Wire these buttons after the panel is rendered:

```javascript
document.getElementById('panel-add-relation')?.addEventListener('click', () => {
  window.kh_editor.openAddRelation(entity.id);
});
document.getElementById('panel-merge')?.addEventListener('click', () => {
  window.kh_editor.openMerge(entity.id, entity.name);
});
document.getElementById('panel-unmerge')?.addEventListener('click', () => {
  window.kh_editor.unmerge(entity.id);
});
```

- [ ] **Step 2: Add × delete affordance to manual relations (line ~103 in panel.js)**

Find the relation rendering block and extend:

```javascript
const isManual = rel.source === 'manual';
html += `
  <div class="panel-relation" data-entity-id="${escapeHtml(otherId)}" data-triple-id="${escapeHtml(rel.id)}">
    <span class="panel-relation-target">${escapeHtml(otherName)}</span>
    ${dateStr ? `<span class="panel-relation-date">${escapeHtml(dateStr)}</span>` : ''}
    ${isManual
      ? `<span class="panel-relation-delete" data-triple-id="${escapeHtml(rel.id)}" title="Delete">×</span>`
      : `<span class="panel-relation-auto" title="Auto-created by ingestor">auto</span>`}
  </div>
`;
```

After rendering, wire the delete:

```javascript
document.querySelectorAll('.panel-relation-delete').forEach(el => {
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    window.kh_editor.deleteTriple(el.dataset.tripleId);
  });
});
```

- [ ] **Step 3: Add alias banner**

At the top of the panel body, if the current entity response has `requested_id`:

```javascript
if (entity.requested_id && entity.canonical_id) {
  html += `<div class="panel-alias-banner" data-canonical-id="${escapeHtml(entity.canonical_id)}">
    This entity was merged into <strong>${escapeHtml(entity.name)}</strong>. Click to view the canonical.
  </div>`;
}
```

Wire click:

```javascript
document.querySelector('.panel-alias-banner')?.addEventListener('click', (ev) => {
  window.kh_reloadPanel(ev.currentTarget.dataset.canonicalId);
});
```

- [ ] **Step 4: Expose `kh_reloadPanel`**

Wherever the panel-rendering function lives (e.g., `renderPanel(entityId)`), assign it to `window.kh_reloadPanel`:

```javascript
window.kh_reloadPanel = renderPanel;
```

- [ ] **Step 5: Manual smoke**

Load dashboard, click a node → panel shows buttons. Verify no console errors.

- [ ] **Step 6: Commit**

```bash
git add services/knowledge-hub/dashboard/panel.js
git commit -m "feat(knowledge-hub): panel.js — edit buttons + × delete + alias banner"
```

---

### Task 24: `search.js` — "+ Create new entity" when no results

**Files:**
- Modify: `services/knowledge-hub/dashboard/search.js`

- [ ] **Step 1: Append zero-results row**

Find the search results rendering block. After rendering the results array, append the "Create new" row when empty:

```javascript
if (!results.length) {
  resultsEl.innerHTML = `<div class="search-no-results">No matches.</div>
    <div class="kh-autocomplete-result kh-create-entity" id="search-create-new">+ Create new entity "${escapeHtml(query)}"</div>`;
  document.getElementById('search-create-new').addEventListener('click', () => {
    window.kh_editor.openCreate(query, (entity) => {
      // Optional: select the newly-created entity
      if (window.kh_reloadPanel) window.kh_reloadPanel(entity.id);
    });
  });
  return;
}
```

- [ ] **Step 2: Manual smoke** — search for "xyz123unknown", see the "+ Create new" option.

- [ ] **Step 3: Commit**

```bash
git add services/knowledge-hub/dashboard/search.js
git commit -m "feat(knowledge-hub): search.js — + Create new when no results"
```

---

## Phase 7 — Deploy + E2E smoke + regression

### Task 25: Full local test suite + deploy

**Files:**
- Run only (no code changes)

- [ ] **Step 1: Run full suite**

```bash
cd /home/teruel/worktrees/infra-kh-graph-editing/services/knowledge-hub
node --test test/
```

Expected: all tests pass. If anything fails, fix in a focused commit before proceeding.

- [ ] **Step 2: Merge feature branch to master**

```bash
cd /home/teruel/worktrees/infra-kh-graph-editing
git log --oneline master..HEAD  # show all feature commits
# After visual review, merge to master:
git checkout master
git merge --no-ff feat/kh-graph-editing
git push origin master
```

- [ ] **Step 3: Deploy**

```bash
export SSHPASS=$(cat ~/.secrets/vk-ssh-password)
cd /home/teruel/worktrees/infra-kh-graph-editing/services/knowledge-hub
bash deploy.sh
```

Expected: deploy.sh completes without error, service restarts, `/health` returns 200.

- [ ] **Step 4: Run seed-plants once in production**

```bash
sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-knowledge-hub && node scripts/seed-plants.mjs"
```

Expected: `seeded 3 companies and their plants` in stdout.

- [ ] **Step 5: Verify plant entities exist**

```bash
sshpass -e ssh strokmatic@192.168.15.2 "sqlite3 /opt/jarvis-knowledge-hub/data/knowledge-hub.db 'SELECT id, name FROM entities WHERE type=\"plant\" LIMIT 10;'"
```

Expected: `plant:gm_sjc|GM São José dos Campos`, etc.

---

### Task 26: Manual smoke checklist

Execute against `http://192.168.15.2:8093/dashboard/` with a browser. Tick each box as it passes. For any failures, file a follow-up fix before calling the plan complete.

- [ ] Dashboard loads with no console errors.
- [ ] Click any node → panel shows `+ Relation`, `Merge into…` buttons.
- [ ] Click `+ Relation`, pick `works_on`, autocomplete a project, save. On first write, API key prompt appears; enter key; relation appears on panel after auto-refresh.
- [ ] Search bar: type a non-existent name → "+ Create new entity" row appears; click it; create modal opens prefilled.
- [ ] Create a plant entity via the modal (type=plant, name="Test Plant"). Find it in search.
- [ ] Add a `part_of` relation from the new plant to an existing company. Graph view: the new plant is distinctly colored (type-based style).
- [ ] Try to add a reverse `part_of` — expect a 409 error surfaced in the UI.
- [ ] Merge a duplicate entity: click one of the duplicates → `Merge into…` → pick target → confirm. Panel refreshes to show canonical with combined relations.
- [ ] Reload the page; search for the merged-away name → it appears with a `↳ canonical_name` indicator.
- [ ] Click the alias in search → lands on canonical panel with the banner "This entity was merged into…"; `Unmerge` button is visible.
- [ ] Click `Unmerge` → alias banner disappears; alias reappears as its own node in the graph view.
- [ ] Delete a manual relation (×) on the panel → relation row disappears. Refresh panel; it's gone.
- [ ] Try to delete an "auto" relation → no × icon present (control is absent).

- [ ] **Step 7: Final commit if any smoke fixes were made**

```bash
git status
# commit any follow-up fixes on master with descriptive messages, then:
git push origin master
# Re-deploy if fixes were made
bash services/knowledge-hub/deploy.sh
```

- [ ] **Step 8: Close out**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git pull origin master  # refresh the main workspace
git worktree remove /home/teruel/worktrees/infra-kh-graph-editing
```

Feature is live. Document it in MEMORY.md (append a line under the Knowledge Hub section referencing `docs/superpowers/specs/2026-04-23-knowledge-hub-graph-editing-design.md`).
