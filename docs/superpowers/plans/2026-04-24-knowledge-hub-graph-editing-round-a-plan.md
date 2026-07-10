---
type: Implementation Plan
title: Knowledge Hub — Manual Graph Editing Round A — Implementation Plan
description: Expected: worktree created, `node_modules/` installed.
timestamp: 2026-04-24
---

# Knowledge Hub — Manual Graph Editing Round A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Round A of the knowledge-hub graph-editing feature per `docs/superpowers/specs/2026-04-24-knowledge-hub-graph-editing-round-a-design.md`. Four capabilities: preserve manual edits across ingestor re-runs, soft-delete ingestor-created edges, inline entity property editing, and an audit view.

**Architecture:** Extend `entities` with 4 lock columns; add `suppressions` and `graph_audit` tables. Refactor ingestor `upsertEntity` to `INSERT ... ON CONFLICT DO UPDATE` with per-field `CASE WHEN *_locked = 0` guards. Suppressions are a read-time overlay applied in existing graph read endpoints. Audit log is append-only, written inside each mutation's transaction.

**Tech Stack:** Node.js ES modules, `better-sqlite3`, raw `http`, D3 dashboard, `node --test`.

---

## Phase 0 — Worktree + baseline

### Task 0: Create feature branch and worktree

**Files:**
- Create: `/home/teruel/worktrees/infra-kh-graph-round-a` (worktree)

- [ ] **Step 1: Fetch + create worktree**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git fetch origin master
git worktree add -b feat/kh-graph-round-a /home/teruel/worktrees/infra-kh-graph-round-a origin/master
cd /home/teruel/worktrees/infra-kh-graph-round-a/services/knowledge-hub
npm install
```

Expected: worktree created, `node_modules/` installed.

- [ ] **Step 2: Baseline tests**

```bash
cd /home/teruel/worktrees/infra-kh-graph-round-a/services/knowledge-hub
node --test test/
```

Expected: all tests pass. Record pass count as baseline (should be 151 from Round 1, plus any subsequent).

---

## Phase 1 — Schema migration

### Task 1: Add lock columns + suppressions + graph_audit tables

**Files:**
- Modify: `services/knowledge-hub/lib/db.mjs` — extend `runMigrations()` and `SCHEMA_SQL`
- Modify: `services/knowledge-hub/test/migration.test.mjs`

- [ ] **Step 1: Append failing tests**

Add to `test/migration.test.mjs` (before the existing `cleanup` test):

```javascript
test('migration adds 4 lock columns to entities', () => {
  const p = path.join(os.tmpdir(), `kh-migration-locks-${Date.now()}.db`);
  const d = initDb(p);
  const cols = d.prepare("PRAGMA table_info(entities)").all().map(c => c.name);
  for (const c of ['name_locked', 'properties_locked', 'project_code_locked', 'product_locked']) {
    assert.ok(cols.includes(c), `${c} column missing`);
  }
  d.close();
  fs.unlinkSync(p);
});

test('migration creates suppressions table', () => {
  const p = path.join(os.tmpdir(), `kh-migration-supp-${Date.now()}.db`);
  const d = initDb(p);
  const cols = d.prepare("PRAGMA table_info(suppressions)").all().map(c => c.name).sort();
  assert.deepEqual(cols, ['created_at', 'id', 'object', 'predicate', 'reason', 'subject']);
  d.close();
  fs.unlinkSync(p);
});

test('migration creates graph_audit table', () => {
  const p = path.join(os.tmpdir(), `kh-migration-audit-${Date.now()}.db`);
  const d = initDb(p);
  const cols = d.prepare("PRAGMA table_info(graph_audit)").all().map(c => c.name).sort();
  assert.deepEqual(cols, ['action', 'created_at', 'entity_id', 'id', 'payload_json', 'reason', 'triple_id']);
  d.close();
  fs.unlinkSync(p);
});

test('migration is idempotent on pre-Round-A DB', () => {
  const p = path.join(os.tmpdir(), `kh-migration-pre-${Date.now()}.db`);
  const raw = new (await import('better-sqlite3')).default(p);
  // Simulate pre-Round-A schema: entities table without lock columns
  raw.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      properties TEXT DEFAULT '{}', project_code TEXT, product TEXT,
      canonical_id TEXT
    );
    CREATE TABLE triples (
      id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT,
      valid_from TEXT, valid_to TEXT, confidence REAL DEFAULT 1.0,
      source TEXT, created_at TEXT
    );
  `);
  raw.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('test:pre', 'Pre', 'person');
  raw.close();

  const upgraded = initDb(p);
  const cols = upgraded.prepare("PRAGMA table_info(entities)").all().map(c => c.name);
  assert.ok(cols.includes('name_locked'));
  assert.ok(cols.includes('properties_locked'));
  assert.ok(cols.includes('project_code_locked'));
  assert.ok(cols.includes('product_locked'));
  const row = upgraded.prepare('SELECT * FROM entities WHERE id = ?').get('test:pre');
  assert.equal(row.name, 'Pre');
  assert.equal(row.name_locked, 0);
  // Re-run idempotent
  upgraded.close();
  const re = initDb(p);
  re.close();
  fs.unlinkSync(p);
});
```

- [ ] **Step 2: Run test, expect failures**

```bash
node --test test/migration.test.mjs
```

Expected: 4 new tests fail (columns/tables missing).

- [ ] **Step 3: Extend `runMigrations()` in `lib/db.mjs`**

Replace the current `runMigrations` with:

```javascript
function runMigrations(db) {
  const cols = db.prepare("PRAGMA table_info(entities)").all();
  const hasCanonical = cols.some(c => c.name === 'canonical_id');
  if (!hasCanonical) {
    db.exec(`ALTER TABLE entities ADD COLUMN canonical_id TEXT;`);
  }
  const lockCols = ['name_locked', 'properties_locked', 'project_code_locked', 'product_locked'];
  for (const col of lockCols) {
    if (!cols.some(c => c.name === col)) {
      db.exec(`ALTER TABLE entities ADD COLUMN ${col} INTEGER DEFAULT 0;`);
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_canonical_id ON entities(canonical_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_triples_source ON triples(source);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS suppressions (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_suppressions_triple ON suppressions(subject, predicate, object);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_id TEXT,
      triple_id TEXT,
      payload_json TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON graph_audit(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_entity_id ON graph_audit(entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_triple_id ON graph_audit(triple_id);
  `);
}
```

Also update `SCHEMA_SQL`'s `CREATE TABLE entities` to include the 4 lock columns so fresh DBs match:

```sql
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  properties TEXT DEFAULT '{}',
  project_code TEXT,
  product TEXT,
  canonical_id TEXT,
  name_locked INTEGER DEFAULT 0,
  properties_locked INTEGER DEFAULT 0,
  project_code_locked INTEGER DEFAULT 0,
  product_locked INTEGER DEFAULT 0
);
```

- [ ] **Step 4: Run tests**

```bash
node --test test/migration.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Run full suite**

```bash
node --test test/
```

Expected: all prior tests still pass + 4 new. Total = baseline + 4.

- [ ] **Step 6: Commit**

```bash
git add services/knowledge-hub/lib/db.mjs services/knowledge-hub/test/migration.test.mjs
git commit -m "feat(knowledge-hub): Round A schema — lock cols + suppressions + graph_audit"
```

---

## Phase 2 — `upsertEntity` refactor

### Task 2: Rewrite `upsertEntity` to respect locks

**Files:**
- Modify: `services/knowledge-hub/lib/graph.mjs`
- Modify: `services/knowledge-hub/test/graph.test.mjs`

- [ ] **Step 1: Append failing regression tests**

Add to `test/graph.test.mjs`:

```javascript
test('upsertEntity preserves canonical_id on re-upsert', () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:pres_a', 'PA', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:pres_b', 'PB', 'person');
  db.prepare('UPDATE entities SET canonical_id = ? WHERE id = ?').run('person:pres_b', 'person:pres_a');
  // Ingestor re-upserts pres_a with a new name
  upsertEntity(db, { id: 'person:pres_a', name: 'PA Updated', type: 'person' });
  const row = db.prepare('SELECT * FROM entities WHERE id = ?').get('person:pres_a');
  assert.equal(row.canonical_id, 'person:pres_b', 'canonical_id must not be cleared');
  assert.equal(row.name, 'PA Updated', 'unlocked name SHOULD update');
});

test('upsertEntity preserves locked name on re-upsert', () => {
  db.prepare('INSERT INTO entities (id,name,type,name_locked) VALUES (?,?,?,1)').run('person:lock_name', 'Manual Name', 'person');
  upsertEntity(db, { id: 'person:lock_name', name: 'Ingestor Name', type: 'person' });
  const row = db.prepare('SELECT name FROM entities WHERE id = ?').get('person:lock_name');
  assert.equal(row.name, 'Manual Name');
});

test('upsertEntity updates unlocked name on re-upsert', () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('person:unlock_name', 'Old', 'person');
  upsertEntity(db, { id: 'person:unlock_name', name: 'New', type: 'person' });
  const row = db.prepare('SELECT name FROM entities WHERE id = ?').get('person:unlock_name');
  assert.equal(row.name, 'New');
});

test('upsertEntity preserves locked properties', () => {
  db.prepare(`INSERT INTO entities (id,name,type,properties,properties_locked) VALUES (?,?,?,?,1)`)
    .run('plant:locked_props', 'LP', 'plant', JSON.stringify({ city: 'Manual City' }));
  upsertEntity(db, { id: 'plant:locked_props', name: 'LP', type: 'plant', properties: { city: 'Ingestor City' } });
  const row = db.prepare('SELECT properties FROM entities WHERE id = ?').get('plant:locked_props');
  assert.equal(JSON.parse(row.properties).city, 'Manual City');
});

test('upsertEntity preserves type (never changes post-creation)', () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('type:x', 'X', 'person');
  upsertEntity(db, { id: 'type:x', name: 'X', type: 'company' });
  const row = db.prepare('SELECT type FROM entities WHERE id = ?').get('type:x');
  assert.equal(row.type, 'person');
});
```

- [ ] **Step 2: Run test, expect failures**

```bash
node --test test/graph.test.mjs
```

Expected: 5 new failures (current INSERT OR REPLACE wipes canonical_id, doesn't respect locks).

- [ ] **Step 3: Rewrite `upsertEntity` in `lib/graph.mjs`**

Replace the existing function:

```javascript
export function upsertEntity(db, { id, name, type, properties = {}, project_code = null, product = null }) {
  db.prepare(`
    INSERT INTO entities (id, name, type, properties, project_code, product)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name         = CASE WHEN name_locked         = 0 THEN excluded.name         ELSE name         END,
      properties   = CASE WHEN properties_locked   = 0 THEN excluded.properties   ELSE properties   END,
      project_code = CASE WHEN project_code_locked = 0 THEN excluded.project_code ELSE project_code END,
      product      = CASE WHEN product_locked      = 0 THEN excluded.product      ELSE product      END
  `).run(id, name, type, JSON.stringify(properties), project_code, product);
}
```

Note the deliberate omissions from `ON CONFLICT DO UPDATE SET`: `type`, `canonical_id`, and the 4 lock columns are preserved.

- [ ] **Step 4: Run tests**

```bash
node --test test/graph.test.mjs
```

Expected: all pass (old tests + 5 new).

- [ ] **Step 5: Run full suite**

```bash
node --test test/
```

Expected: no regressions. Total = previous + 5.

- [ ] **Step 6: Commit**

```bash
git add services/knowledge-hub/lib/graph.mjs services/knowledge-hub/test/graph.test.mjs
git commit -m "fix(knowledge-hub): upsertEntity preserves canonical_id + locked fields"
```

---

## Phase 3 — `graph-editor.mjs` additions

### Task 3: `logAudit` helper + wire into existing mutations

**Files:**
- Modify: `services/knowledge-hub/lib/graph-editor.mjs`
- Modify: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Append failing test**

Add to `test/graph-editor.test.mjs`:

```javascript
test('createEntity logs to graph_audit', () => {
  createEntity(db, { id: 'audit:ce', name: 'CE', type: 'person' });
  const row = db.prepare(`SELECT * FROM graph_audit WHERE entity_id = ? AND action = 'create_entity'`).get('audit:ce');
  assert.ok(row);
  const payload = JSON.parse(row.payload_json);
  assert.equal(payload.after.id, 'audit:ce');
  assert.equal(payload.after.name, 'CE');
});

test('addManualTriple logs to graph_audit', () => {
  createEntity(db, { id: 'audit:ts', name: 'TS', type: 'person' });
  createEntity(db, { id: 'audit:to', name: 'TO', type: 'project', product: 'diemaster' });
  const t = addManualTriple(db, { subject: 'audit:ts', predicate: 'works_on', object: 'audit:to' });
  const row = db.prepare(`SELECT * FROM graph_audit WHERE triple_id = ? AND action = 'create_triple'`).get(t.id);
  assert.ok(row);
});

test('mergeEntities logs to graph_audit', () => {
  createEntity(db, { id: 'audit:ma', name: 'MA', type: 'person' });
  createEntity(db, { id: 'audit:mb', name: 'MB', type: 'person' });
  mergeEntities(db, { fromId: 'audit:ma', intoId: 'audit:mb' });
  const row = db.prepare(`SELECT * FROM graph_audit WHERE entity_id = ? AND action = 'merge_entities'`).get('audit:ma');
  assert.ok(row);
  const payload = JSON.parse(row.payload_json);
  assert.equal(payload.from, 'audit:ma');
  assert.equal(payload.into, 'audit:mb');
});

test('unmergeEntity logs to graph_audit', () => {
  createEntity(db, { id: 'audit:ua', name: 'UA', type: 'person' });
  createEntity(db, { id: 'audit:ub', name: 'UB', type: 'person' });
  mergeEntities(db, { fromId: 'audit:ua', intoId: 'audit:ub' });
  unmergeEntity(db, 'audit:ua');
  const row = db.prepare(`SELECT * FROM graph_audit WHERE entity_id = ? AND action = 'unmerge_entity'`).get('audit:ua');
  assert.ok(row);
});

test('deleteManualTriple logs to graph_audit', () => {
  createEntity(db, { id: 'audit:dts', name: 'DTS', type: 'person' });
  createEntity(db, { id: 'audit:dto', name: 'DTO', type: 'project', product: 'diemaster' });
  const t = addManualTriple(db, { subject: 'audit:dts', predicate: 'works_on', object: 'audit:dto' });
  deleteManualTriple(db, t.id);
  const row = db.prepare(`SELECT * FROM graph_audit WHERE triple_id = ? AND action = 'delete_manual_triple'`).get(t.id);
  assert.ok(row);
});
```

- [ ] **Step 2: Run, expect failures**

```bash
node --test test/graph-editor.test.mjs
```

- [ ] **Step 3: Add `logAudit` + wire into existing mutations**

In `lib/graph-editor.mjs`, add after the error classes and slug helper, before `createEntity`:

```javascript
function logAudit(db, { action, entity_id = null, triple_id = null, payload = null, reason = null }) {
  db.prepare(`
    INSERT INTO graph_audit (action, entity_id, triple_id, payload_json, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    action,
    entity_id,
    triple_id,
    payload != null ? JSON.stringify(payload) : null,
    reason,
    new Date().toISOString()
  );
}
```

Wrap `createEntity` body in a transaction + log:

```javascript
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
  const result = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM entities WHERE id = ?').get(entityId);
    if (existing) {
      throw new ValidationError(`entity already exists: ${entityId}`);
    }
    db.prepare(`
      INSERT INTO entities (id, name, type, properties, project_code, product, canonical_id)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(entityId, name, type, JSON.stringify(properties), project_code, product);
    const entity = { id: entityId, name, type, properties, project_code, product, canonical_id: null };
    logAudit(db, { action: 'create_entity', entity_id: entityId, payload: { after: entity } });
    return entity;
  })();
  return result;
}
```

Rewrite `addManualTriple` to wrap its work in a transaction + log. Replace the existing function body with:

```javascript
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

  return db.transaction(() => {
    const id = tripleId(subject, pred, object, 'manual');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO triples (id, subject, predicate, object, valid_from, valid_to, confidence, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, subject, pred, object, valid_from, valid_to, 1.0, 'manual', now);
    const tripleRow = { id, subject, predicate: pred, object, valid_from, valid_to, confidence: 1.0, source: 'manual', created_at: now };
    logAudit(db, { action: 'create_triple', triple_id: id, entity_id: subject, payload: { after: tripleRow } });
    return tripleRow;
  })();
}
```

Rewrite `deleteManualTriple` to read-before-delete + log:

```javascript
export function deleteManualTriple(db, tripleId) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM triples WHERE id = ?').get(tripleId);
    if (!row) throw new NotFoundError(`triple not found: ${tripleId}`);
    if (row.source !== 'manual') {
      throw new ValidationError(`can only delete triples with source='manual' (got '${row.source}')`);
    }
    db.prepare('DELETE FROM triples WHERE id = ?').run(tripleId);
    logAudit(db, { action: 'delete_manual_triple', triple_id: tripleId, payload: { before: row } });
  })();
}
```

Rewrite `mergeEntities` to log:

```javascript
export function mergeEntities(db, { fromId, intoId }) {
  if (fromId === intoId) {
    throw new ValidationError('cannot merge entity into itself');
  }
  return db.transaction(() => {
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
    logAudit(db, {
      action: 'merge_entities',
      entity_id: fromId,
      payload: { from: fromId, into: intoId, canonical: flattened },
    });
    return { fromId, canonicalId: flattened };
  })();
}
```

Rewrite `unmergeEntity` to read-before-update + log:

```javascript
export function unmergeEntity(db, entityId) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId);
    if (!row) throw new NotFoundError(`entity not found: ${entityId}`);
    const previousCanonical = row.canonical_id;
    db.prepare('UPDATE entities SET canonical_id = NULL WHERE id = ?').run(entityId);
    logAudit(db, {
      action: 'unmerge_entity',
      entity_id: entityId,
      payload: { entity_id: entityId, previous_canonical: previousCanonical },
    });
    return { ...row, canonical_id: null, properties: JSON.parse(row.properties || '{}') };
  })();
}
```

- [ ] **Step 4: Run tests**

```bash
node --test test/graph-editor.test.mjs
```

Expected: all pass (old + 5 new).

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/graph-editor.mjs services/knowledge-hub/test/graph-editor.test.mjs
git commit -m "feat(knowledge-hub): graph_audit log + wire into existing mutations"
```

---

### Task 4: `editEntity` + `unlockField`

**Files:**
- Modify: `services/knowledge-hub/lib/graph-editor.mjs`
- Modify: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Append failing tests**

```javascript
import { editEntity, unlockField } from '../lib/graph-editor.mjs';

test('editEntity updates name and sets name_locked', () => {
  createEntity(db, { id: 'edit:one', name: 'Original', type: 'person' });
  const after = editEntity(db, { id: 'edit:one', name: 'Edited' });
  assert.equal(after.name, 'Edited');
  const row = db.prepare('SELECT name, name_locked FROM entities WHERE id = ?').get('edit:one');
  assert.equal(row.name, 'Edited');
  assert.equal(row.name_locked, 1);
});

test('editEntity updates only specified fields', () => {
  createEntity(db, { id: 'edit:partial', name: 'P', type: 'person', properties: { role: 'dev' } });
  editEntity(db, { id: 'edit:partial', properties: { role: 'lead' } });
  const row = db.prepare('SELECT name, properties, name_locked, properties_locked FROM entities WHERE id = ?').get('edit:partial');
  assert.equal(row.name, 'P');
  assert.equal(JSON.parse(row.properties).role, 'lead');
  assert.equal(row.name_locked, 0);
  assert.equal(row.properties_locked, 1);
});

test('editEntity rejects unknown id', () => {
  assert.throws(() => editEntity(db, { id: 'edit:ghost', name: 'x' }), { name: 'NotFoundError' });
});

test('editEntity rejects call with no editable fields', () => {
  createEntity(db, { id: 'edit:empty', name: 'E', type: 'person' });
  assert.throws(() => editEntity(db, { id: 'edit:empty' }), { name: 'ValidationError' });
});

test('editEntity logs before/after to graph_audit', () => {
  createEntity(db, { id: 'edit:audit', name: 'Audit', type: 'person' });
  editEntity(db, { id: 'edit:audit', name: 'Audited' });
  const row = db.prepare(`SELECT * FROM graph_audit WHERE entity_id = ? AND action = 'edit_entity'`).get('edit:audit');
  assert.ok(row);
  const p = JSON.parse(row.payload_json);
  assert.equal(p.before.name, 'Audit');
  assert.equal(p.after.name, 'Audited');
  assert.deepEqual(p.fields, ['name']);
});

test('unlockField clears the lock column', () => {
  createEntity(db, { id: 'unlock:one', name: 'U', type: 'person' });
  editEntity(db, { id: 'unlock:one', name: 'UM' });
  unlockField(db, 'unlock:one', 'name');
  const row = db.prepare('SELECT name_locked FROM entities WHERE id = ?').get('unlock:one');
  assert.equal(row.name_locked, 0);
});

test('unlockField rejects invalid field name', () => {
  createEntity(db, { id: 'unlock:bad', name: 'X', type: 'person' });
  assert.throws(() => unlockField(db, 'unlock:bad', 'canonical_id'), { name: 'ValidationError' });
});

test('unlockField rejects unknown entity', () => {
  assert.throws(() => unlockField(db, 'unlock:ghost', 'name'), { name: 'NotFoundError' });
});
```

- [ ] **Step 2: Run, expect failures**

- [ ] **Step 3: Implement `editEntity` and `unlockField`**

Append to `lib/graph-editor.mjs`:

```javascript
const LOCKABLE_FIELDS = new Set(['name', 'properties', 'project_code', 'product']);

export function editEntity(db, { id, name, properties, project_code, product }) {
  const fields = [];
  if (name !== undefined)        fields.push('name');
  if (properties !== undefined)  fields.push('properties');
  if (project_code !== undefined) fields.push('project_code');
  if (product !== undefined)     fields.push('product');
  if (fields.length === 0) {
    throw new ValidationError('editEntity requires at least one of: name, properties, project_code, product');
  }
  return db.transaction(() => {
    const before = db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
    if (!before) throw new NotFoundError(`entity not found: ${id}`);
    before.properties = JSON.parse(before.properties || '{}');

    const sets = [];
    const params = [];
    if (fields.includes('name'))         { sets.push('name = ?', 'name_locked = 1');         params.push(name); }
    if (fields.includes('properties'))   { sets.push('properties = ?', 'properties_locked = 1'); params.push(JSON.stringify(properties)); }
    if (fields.includes('project_code')) { sets.push('project_code = ?', 'project_code_locked = 1'); params.push(project_code); }
    if (fields.includes('product'))      { sets.push('product = ?', 'product_locked = 1');    params.push(product); }
    params.push(id);
    db.prepare(`UPDATE entities SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    const after = db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
    after.properties = JSON.parse(after.properties || '{}');

    logAudit(db, {
      action: 'edit_entity',
      entity_id: id,
      payload: { before, after, fields },
    });
    return after;
  })();
}

export function unlockField(db, entityId, fieldName) {
  if (!LOCKABLE_FIELDS.has(fieldName)) {
    throw new ValidationError(`field not lockable: ${fieldName}`);
  }
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(entityId);
    if (!row) throw new NotFoundError(`entity not found: ${entityId}`);
    const lockCol = `${fieldName}_locked`;
    const previousValue = row[fieldName];
    db.prepare(`UPDATE entities SET ${lockCol} = 0 WHERE id = ?`).run(entityId);
    logAudit(db, {
      action: 'unlock_field',
      entity_id: entityId,
      payload: { entity_id: entityId, field: fieldName, previous_value: previousValue },
    });
    return db.prepare(`SELECT * FROM entities WHERE id = ?`).get(entityId);
  })();
}
```

- [ ] **Step 4: Run tests**, expect pass.

- [ ] **Step 5: Commit**

```bash
git add services/knowledge-hub/lib/graph-editor.mjs services/knowledge-hub/test/graph-editor.test.mjs
git commit -m "feat(knowledge-hub): editEntity + unlockField with lock management"
```

---

### Task 5: `deleteEntity` (for create_entity undo)

**Files:**
- Modify: `services/knowledge-hub/lib/graph-editor.mjs`
- Modify: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
import { deleteEntity } from '../lib/graph-editor.mjs';

test('deleteEntity removes an entity with no edges', () => {
  createEntity(db, { id: 'del:solo', name: 'Solo', type: 'person' });
  deleteEntity(db, 'del:solo');
  const row = db.prepare('SELECT id FROM entities WHERE id = ?').get('del:solo');
  assert.equal(row, undefined);
});

test('deleteEntity rejects when inbound or outbound edges exist', () => {
  createEntity(db, { id: 'del:withedge_a', name: 'A', type: 'person' });
  createEntity(db, { id: 'del:withedge_b', name: 'B', type: 'project', product: 'diemaster' });
  addManualTriple(db, { subject: 'del:withedge_a', predicate: 'works_on', object: 'del:withedge_b' });
  assert.throws(() => deleteEntity(db, 'del:withedge_a'), { name: 'ValidationError' });
  assert.throws(() => deleteEntity(db, 'del:withedge_b'), { name: 'ValidationError' });
});

test('deleteEntity rejects when canonical of an alias', () => {
  createEntity(db, { id: 'del:canon', name: 'C', type: 'person' });
  createEntity(db, { id: 'del:alias', name: 'A', type: 'person' });
  mergeEntities(db, { fromId: 'del:alias', intoId: 'del:canon' });
  assert.throws(() => deleteEntity(db, 'del:canon'), { name: 'ValidationError' });
});

test('deleteEntity logs to graph_audit', () => {
  createEntity(db, { id: 'del:audit', name: 'DA', type: 'person' });
  deleteEntity(db, 'del:audit');
  const row = db.prepare(`SELECT * FROM graph_audit WHERE entity_id = ? AND action = 'delete_entity'`).get('del:audit');
  assert.ok(row);
});

test('deleteEntity rejects unknown id', () => {
  assert.throws(() => deleteEntity(db, 'del:ghost'), { name: 'NotFoundError' });
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Append to `lib/graph-editor.mjs`:

```javascript
export function deleteEntity(db, entityId) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId);
    if (!row) throw new NotFoundError(`entity not found: ${entityId}`);

    const edgeCount = db.prepare(`
      SELECT COUNT(*) AS c FROM triples WHERE subject = ? OR object = ?
    `).get(entityId, entityId).c;
    if (edgeCount > 0) {
      throw new ValidationError(`entity has ${edgeCount} edges; remove or merge them first`);
    }

    const aliasCount = db.prepare(`SELECT COUNT(*) AS c FROM entities WHERE canonical_id = ?`).get(entityId).c;
    if (aliasCount > 0) {
      throw new ValidationError(`entity is the canonical of ${aliasCount} aliases; unmerge first`);
    }

    db.prepare('DELETE FROM entities WHERE id = ?').run(entityId);
    row.properties = JSON.parse(row.properties || '{}');
    logAudit(db, { action: 'delete_entity', entity_id: entityId, payload: { before: row } });
  })();
}
```

- [ ] **Step 4: Run tests**, expect pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(knowledge-hub): deleteEntity with edge + alias guards"
```

---

### Task 6: `suppressTriple` + `unsuppressTriple`

**Files:**
- Modify: `services/knowledge-hub/lib/graph-editor.mjs`
- Modify: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
import { suppressTriple, unsuppressTriple } from '../lib/graph-editor.mjs';

test('suppressTriple inserts a row with deterministic id', () => {
  const s = suppressTriple(db, { subject: 'a', predicate: 'b', object: 'c', reason: 'wrong' });
  assert.ok(s.id);
  assert.equal(s.subject, 'a');
  assert.equal(s.reason, 'wrong');
  const row = db.prepare('SELECT * FROM suppressions WHERE id = ?').get(s.id);
  assert.ok(row);
});

test('suppressTriple is idempotent on (s,p,o)', () => {
  suppressTriple(db, { subject: 'dup:a', predicate: 'x', object: 'dup:b' });
  suppressTriple(db, { subject: 'dup:a', predicate: 'x', object: 'dup:b', reason: 'again' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM suppressions WHERE subject = ? AND predicate = ? AND object = ?').get('dup:a', 'x', 'dup:b').c;
  assert.equal(count, 1);
});

test('suppressTriple logs to graph_audit', () => {
  suppressTriple(db, { subject: 'log:s', predicate: 'p', object: 'log:o', reason: 'r' });
  const row = db.prepare(`SELECT * FROM graph_audit WHERE action = 'suppress_triple' ORDER BY id DESC LIMIT 1`).get();
  assert.ok(row);
  const p = JSON.parse(row.payload_json);
  assert.equal(p.subject, 'log:s');
  assert.equal(p.reason, 'r');
});

test('unsuppressTriple removes the row', () => {
  suppressTriple(db, { subject: 'u:a', predicate: 'x', object: 'u:b' });
  const r = unsuppressTriple(db, { subject: 'u:a', predicate: 'x', object: 'u:b' });
  assert.equal(r.removed, true);
  const row = db.prepare('SELECT * FROM suppressions WHERE subject = ? AND predicate = ? AND object = ?').get('u:a', 'x', 'u:b');
  assert.equal(row, undefined);
});

test('unsuppressTriple returns removed=false on missing row', () => {
  const r = unsuppressTriple(db, { subject: 'nope:a', predicate: 'x', object: 'nope:b' });
  assert.equal(r.removed, false);
});

test('unsuppressTriple logs to graph_audit even on no-op', () => {
  unsuppressTriple(db, { subject: 'noop:a', predicate: 'x', object: 'noop:b' });
  const row = db.prepare(`SELECT * FROM graph_audit WHERE action = 'unsuppress_triple' ORDER BY id DESC LIMIT 1`).get();
  assert.ok(row);
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Append:

```javascript
function suppressionId(subject, predicate, object) {
  return crypto.createHash('md5').update(`${subject}|${predicate}|${object}`).digest('hex').slice(0, 16);
}

export function suppressTriple(db, { subject, predicate, object, reason = null }) {
  return db.transaction(() => {
    const id = suppressionId(subject, predicate, object);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO suppressions (id, subject, predicate, object, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, subject, predicate, object, reason, now);
    logAudit(db, {
      action: 'suppress_triple',
      payload: { subject, predicate, object, reason },
      reason,
    });
    return db.prepare('SELECT * FROM suppressions WHERE id = ?').get(id);
  })();
}

export function unsuppressTriple(db, { subject, predicate, object }) {
  return db.transaction(() => {
    const info = db.prepare(`
      DELETE FROM suppressions WHERE subject = ? AND predicate = ? AND object = ?
    `).run(subject, predicate, object);
    logAudit(db, {
      action: 'unsuppress_triple',
      payload: { subject, predicate, object },
    });
    return { removed: info.changes > 0 };
  })();
}
```

- [ ] **Step 4: Run tests**, expect pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(knowledge-hub): suppressTriple + unsuppressTriple"
```

---

### Task 7: `listAudit` + `listSuppressions`

**Files:**
- Modify: `services/knowledge-hub/lib/graph-editor.mjs`
- Modify: `services/knowledge-hub/test/graph-editor.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
import { listAudit, listSuppressions } from '../lib/graph-editor.mjs';

test('listAudit returns rows desc by created_at with parsed payload', () => {
  createEntity(db, { id: 'la:one', name: 'One', type: 'person' });
  const rows = listAudit(db, { entity_id: 'la:one', limit: 5 });
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].action, 'create_entity');
  assert.equal(typeof rows[0].payload, 'object');
  assert.equal(rows[0].payload.after.id, 'la:one');
});

test('listAudit paginates with limit and offset', () => {
  for (let i = 0; i < 5; i++) {
    createEntity(db, { id: `la:page_${i}`, name: `P${i}`, type: 'person' });
  }
  const page1 = listAudit(db, { action: 'create_entity', limit: 2, offset: 0 });
  const page2 = listAudit(db, { action: 'create_entity', limit: 2, offset: 2 });
  assert.equal(page1.length, 2);
  assert.equal(page2.length, 2);
  assert.notEqual(page1[0].id, page2[0].id);
});

test('listSuppressions returns rows desc by created_at', () => {
  suppressTriple(db, { subject: 'ls:a', predicate: 'x', object: 'ls:b' });
  const rows = listSuppressions(db, { limit: 5 });
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].subject, 'ls:a');
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Append:

```javascript
export function listAudit(db, { entity_id = null, triple_id = null, action = null, since = null, limit = 100, offset = 0 } = {}) {
  const conds = [];
  const params = [];
  if (entity_id) { conds.push('entity_id = ?'); params.push(entity_id); }
  if (triple_id) { conds.push('triple_id = ?'); params.push(triple_id); }
  if (action)    { conds.push('action = ?');    params.push(action); }
  if (since)     { conds.push('created_at >= ?'); params.push(since); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit, offset);
  const rows = db.prepare(`
    SELECT * FROM graph_audit ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params);
  return rows.map(r => ({ ...r, payload: r.payload_json ? JSON.parse(r.payload_json) : null }));
}

export function listSuppressions(db, { limit = 100, offset = 0 } = {}) {
  return db.prepare(`
    SELECT * FROM suppressions ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}
```

- [ ] **Step 4: Run tests**, expect pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(knowledge-hub): listAudit + listSuppressions"
```

---

## Phase 4 — Read-path suppression filter

### Task 8: Filter suppressed triples in read endpoints

**Files:**
- Modify: `services/knowledge-hub/lib/graph.mjs` — add `filterSuppressed` export
- Modify: `services/knowledge-hub/lib/server.mjs` — apply filter in 3 existing read handlers
- Modify: `services/knowledge-hub/test/server.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
test('GET /graph/entity/:id hides suppressed triples', async () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('sup:e1', 'E1', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('sup:e2', 'E2', 'project');
  db.prepare(`INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at)
              VALUES ('sup_t1','sup:e1','works_on','sup:e2',1.0,'email:x',?)`).run(new Date().toISOString());
  db.prepare(`INSERT INTO suppressions (id,subject,predicate,object,created_at)
              VALUES ('sup_s1','sup:e1','works_on','sup:e2',?)`).run(new Date().toISOString());
  const res = await request('GET', '/graph/entity/sup:e1');
  assert.equal(res.status, 200);
  assert.equal((res.body.relations || []).length, 0, 'suppressed edge should be absent');
});

test('GET /graph/view hides suppressed edges', async () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('vsup:e1', 'VE1', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('vsup:e2', 'VE2', 'project');
  db.prepare(`INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at)
              VALUES ('vsup_t1','vsup:e1','works_on','vsup:e2',1.0,'email:x',?)`).run(new Date().toISOString());
  db.prepare(`INSERT INTO suppressions (id,subject,predicate,object,created_at)
              VALUES ('vsup_s1','vsup:e1','works_on','vsup:e2',?)`).run(new Date().toISOString());
  const res = await request('GET', '/graph/view');
  assert.equal(res.status, 200);
  const edges = res.body.edges || res.body.triples || [];
  const hit = edges.find(e => e.subject === 'vsup:e1' && e.object === 'vsup:e2');
  assert.equal(hit, undefined);
});

test('GET /graph/neighbors hides suppressed edges', async () => {
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('nsup:e1', 'NE1', 'person');
  db.prepare('INSERT INTO entities (id,name,type) VALUES (?,?,?)').run('nsup:e2', 'NE2', 'project');
  db.prepare(`INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at)
              VALUES ('nsup_t1','nsup:e1','works_on','nsup:e2',1.0,'email:x',?)`).run(new Date().toISOString());
  db.prepare(`INSERT INTO suppressions (id,subject,predicate,object,created_at)
              VALUES ('nsup_s1','nsup:e1','works_on','nsup:e2',?)`).run(new Date().toISOString());
  const res = await request('GET', '/graph/neighbors/nsup:e1?depth=1');
  const nodes = (res.body.nodes || res.body.entities || []).map(n => n.id);
  assert.ok(!nodes.includes('nsup:e2'));
});
```

- [ ] **Step 2: Run, expect failures**

- [ ] **Step 3: Add `filterSuppressed` to `lib/graph.mjs`**

Append:

```javascript
/**
 * Filter out triples whose (subject, predicate, object) appears in the
 * suppressions table. Read-time overlay — the underlying triples stay in
 * place, but the editor's suppression marks hide them from clients.
 */
export function filterSuppressed(db, triples) {
  if (!triples.length) return triples;
  const rows = db.prepare('SELECT subject, predicate, object FROM suppressions').all();
  if (!rows.length) return triples;
  const suppressed = new Set(rows.map(r => `${r.subject}|${r.predicate}|${r.object}`));
  return triples.filter(t => !suppressed.has(`${t.subject}|${t.predicate}|${t.object}`));
}
```

- [ ] **Step 4: Apply in `lib/server.mjs`**

In the `/graph/entity/:id` handler: after fetching `relations`, wrap with `filterSuppressed(db, relations)`.

In the `/graph/view` handler: after building the substituted triples array, wrap with `filterSuppressed(db, triples)`.

In the `/graph/neighbors/:id` handler: apply `filterSuppressed` on the triple set before expanding frontier (or after — whatever works; the important thing is nodes reachable ONLY through suppressed edges don't appear).

Add `import { ..., filterSuppressed } from './graph.mjs';` if not already there.

- [ ] **Step 5: Run tests**, expect pass.

- [ ] **Step 6: Commit**

```bash
git add services/knowledge-hub/lib/graph.mjs services/knowledge-hub/lib/server.mjs services/knowledge-hub/test/server.test.mjs
git commit -m "feat(knowledge-hub): read-time suppression filter in graph endpoints"
```

---

## Phase 5 — Write + read routes

### Task 9: `POST /graph/entities/:id` (edit)

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server-editor.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
test('POST /graph/entities/:id edits name (auth required)', async () => {
  await req('POST', '/graph/entities', { id: 'rt:edit_a', name: 'Before', type: 'person' }, { 'x-api-key': 'test-api-key' });
  const noAuth = await req('POST', '/graph/entities/rt:edit_a', { name: 'X' });
  assert.equal(noAuth.status, 401);
  const res = await req('POST', '/graph/entities/rt:edit_a', { name: 'After' }, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'After');
  assert.equal(res.body.name_locked, 1);
});

test('POST /graph/entities/:id returns 404 for unknown', async () => {
  const res = await req('POST', '/graph/entities/rt:ghost', { name: 'x' }, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 404);
});

test('POST /graph/entities/:id returns 400 when no fields given', async () => {
  await req('POST', '/graph/entities', { id: 'rt:empty', name: 'E', type: 'person' }, { 'x-api-key': 'test-api-key' });
  const res = await req('POST', '/graph/entities/rt:empty', {}, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run, expect failures**

- [ ] **Step 3: Add handler**

```javascript
const editEntityMatch = pathname.match(/^\/graph\/entities\/([^/]+)$/);
if (editEntityMatch && req.method === 'POST') {
  if (!isAuthorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const id = decodeURIComponent(editEntityMatch[1]);
  const body = await readJsonBody(req);
  try {
    const entity = editEntity(db, { id, ...body });
    return sendJson(res, 200, entity);
  } catch (e) {
    if (e.name === 'ValidationError') return sendJson(res, 400, { error: e.message, code: 'ValidationError' });
    if (e.name === 'NotFoundError')   return sendJson(res, 404, { error: e.message, code: 'NotFoundError' });
    throw e;
  }
}
```

Update import to include `editEntity`.

**IMPORTANT:** place this handler BEFORE the `POST /graph/entities` (create) handler, since the regex `/graph/entities/([^/]+)$` would match but the existing create handler is `pathname === '/graph/entities'` (no trailing path), so they don't collide — but verify ordering: the prefix-match variant must match first. Actually `pathname === '/graph/entities'` won't match `/graph/entities/foo`, so collision is impossible. Order doesn't matter; place this with the other edit routes for readability.

- [ ] **Step 4: Run tests**, expect pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(knowledge-hub): POST /graph/entities/:id edits entity"
```

---

### Task 10: `POST /graph/entities/:id/unlock/:field` + `DELETE /graph/entities/:id`

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server-editor.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
test('POST /graph/entities/:id/unlock/:field clears the lock', async () => {
  await req('POST', '/graph/entities', { id: 'rt:unlock', name: 'U', type: 'person' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/entities/rt:unlock', { name: 'UM' }, { 'x-api-key': 'test-api-key' });
  const res = await req('POST', '/graph/entities/rt:unlock/unlock/name', null, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name_locked, 0);
});

test('DELETE /graph/entities/:id removes solo entity', async () => {
  await req('POST', '/graph/entities', { id: 'rt:del_solo', name: 'S', type: 'person' }, { 'x-api-key': 'test-api-key' });
  const res = await req('DELETE', '/graph/entities/rt:del_solo', null, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 204);
});

test('DELETE /graph/entities/:id returns 400 when edges exist', async () => {
  await req('POST', '/graph/entities', { id: 'rt:del_edge', name: 'DE', type: 'person' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/entities', { id: 'rt:del_proj', name: 'dp', type: 'project', product: 'diemaster' }, { 'x-api-key': 'test-api-key' });
  await req('POST', '/graph/triples', { subject: 'rt:del_edge', predicate: 'works_on', object: 'rt:del_proj' }, { 'x-api-key': 'test-api-key' });
  const res = await req('DELETE', '/graph/entities/rt:del_edge', null, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Add handlers**

```javascript
const unlockMatch = pathname.match(/^\/graph\/entities\/([^/]+)\/unlock\/([a-z_]+)$/);
if (unlockMatch && req.method === 'POST') {
  if (!isAuthorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const id = decodeURIComponent(unlockMatch[1]);
  const field = unlockMatch[2];
  try {
    const out = unlockField(db, id, field);
    return sendJson(res, 200, out);
  } catch (e) {
    if (e.name === 'ValidationError') return sendJson(res, 400, { error: e.message, code: 'ValidationError' });
    if (e.name === 'NotFoundError')   return sendJson(res, 404, { error: e.message, code: 'NotFoundError' });
    throw e;
  }
}

const deleteEntityMatch = pathname.match(/^\/graph\/entities\/([^/]+)$/);
if (deleteEntityMatch && req.method === 'DELETE') {
  if (!isAuthorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const id = decodeURIComponent(deleteEntityMatch[1]);
  try {
    deleteEntity(db, id);
    res.statusCode = 204; return res.end();
  } catch (e) {
    if (e.name === 'ValidationError') return sendJson(res, 400, { error: e.message, code: 'ValidationError' });
    if (e.name === 'NotFoundError')   return sendJson(res, 404, { error: e.message, code: 'NotFoundError' });
    throw e;
  }
}
```

Update imports to include `unlockField, deleteEntity`.

**Ordering:** The unlock match regex must precede the plain-edit regex (both match `/graph/entities/:id`). Place `unlockMatch` block BEFORE `editEntityMatch` block.

- [ ] **Step 4: Run tests**, expect pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(knowledge-hub): unlock-field + delete-entity routes"
```

---

### Task 11: `POST/DELETE /graph/suppressions` + `GET /graph/suppressions` + `GET /graph/audit`

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`
- Modify: `services/knowledge-hub/test/server-editor.test.mjs`

- [ ] **Step 1: Append tests**

```javascript
test('POST /graph/suppressions creates a suppression (auth required)', async () => {
  const noAuth = await req('POST', '/graph/suppressions', { subject: 'a', predicate: 'b', object: 'c' });
  assert.equal(noAuth.status, 401);
  const res = await req('POST', '/graph/suppressions', { subject: 'a', predicate: 'b', object: 'c', reason: 'wrong' }, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 201);
  assert.equal(res.body.reason, 'wrong');
});

test('DELETE /graph/suppressions removes a suppression', async () => {
  await req('POST', '/graph/suppressions', { subject: 'd', predicate: 'e', object: 'f' }, { 'x-api-key': 'test-api-key' });
  const res = await req('DELETE', '/graph/suppressions', { subject: 'd', predicate: 'e', object: 'f' }, { 'x-api-key': 'test-api-key' });
  assert.equal(res.status, 200);
  assert.equal(res.body.removed, true);
});

test('GET /graph/suppressions lists (no auth)', async () => {
  await req('POST', '/graph/suppressions', { subject: 'g', predicate: 'h', object: 'i' }, { 'x-api-key': 'test-api-key' });
  const res = await req('GET', '/graph/suppressions');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.suppressions));
});

test('GET /graph/audit lists (no auth) with filters', async () => {
  await req('POST', '/graph/entities', { id: 'rt:audit_e', name: 'AE', type: 'person' }, { 'x-api-key': 'test-api-key' });
  const res = await req('GET', '/graph/audit?entity_id=rt:audit_e&limit=5');
  assert.equal(res.status, 200);
  const entries = res.body.audit || res.body.entries || [];
  assert.ok(entries.length >= 1);
  assert.equal(entries[0].entity_id, 'rt:audit_e');
});

test('GET /graph/audit/entity/:id is shorthand', async () => {
  await req('POST', '/graph/entities', { id: 'rt:audit_f', name: 'AF', type: 'person' }, { 'x-api-key': 'test-api-key' });
  const res = await req('GET', '/graph/audit/entity/rt:audit_f');
  assert.equal(res.status, 200);
  const entries = res.body.audit || res.body.entries || [];
  assert.ok(entries.every(e => e.entity_id === 'rt:audit_f'));
});
```

- [ ] **Step 2: Run, expect failures**

- [ ] **Step 3: Add handlers**

```javascript
if (pathname === '/graph/suppressions' && req.method === 'POST') {
  if (!isAuthorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const body = await readJsonBody(req);
  try {
    const s = suppressTriple(db, body);
    return sendJson(res, 201, s);
  } catch (e) {
    if (e.name === 'ValidationError') return sendJson(res, 400, { error: e.message, code: 'ValidationError' });
    throw e;
  }
}

if (pathname === '/graph/suppressions' && req.method === 'DELETE') {
  if (!isAuthorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const body = await readJsonBody(req);
  try {
    const out = unsuppressTriple(db, body);
    return sendJson(res, 200, out);
  } catch (e) {
    throw e;
  }
}

if (pathname === '/graph/suppressions' && req.method === 'GET') {
  const limit  = parseInt(params.limit  || '100', 10);
  const offset = parseInt(params.offset || '0',   10);
  const suppressions = listSuppressions(db, { limit, offset });
  return sendJson(res, 200, { suppressions });
}

if (pathname === '/graph/audit' && req.method === 'GET') {
  const filters = {
    entity_id: params.entity_id || null,
    triple_id: params.triple_id || null,
    action:    params.action    || null,
    since:     params.since     || null,
    limit:     parseInt(params.limit || '100', 10),
    offset:    parseInt(params.offset || '0', 10),
  };
  return sendJson(res, 200, { audit: listAudit(db, filters) });
}

const auditEntityMatch = pathname.match(/^\/graph\/audit\/entity\/(.+)$/);
if (auditEntityMatch && req.method === 'GET') {
  const id = decodeURIComponent(auditEntityMatch[1]);
  const limit  = parseInt(params.limit  || '100', 10);
  const offset = parseInt(params.offset || '0',   10);
  return sendJson(res, 200, { audit: listAudit(db, { entity_id: id, limit, offset }) });
}
```

Update imports to include `suppressTriple, unsuppressTriple, listAudit, listSuppressions`.

- [ ] **Step 4: Run tests**, expect pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(knowledge-hub): suppression + audit REST endpoints"
```

---

## Phase 6 — UI

### Task 12: `editor.css` lock + history styles, `index.html` modals + Audit link

**Files:**
- Modify: `services/knowledge-hub/dashboard/editor.css`
- Modify: `services/knowledge-hub/dashboard/index.html`

- [ ] **Step 1: Extend `editor.css`**

Append:

```css
/* Round A additions */
.panel-field-lock { font-size: 0.7em; cursor: pointer; color: var(--accent, #3b7dd8); margin-left: 4px; }
.panel-field-lock:hover { color: var(--warning, #cc8); }
.panel-tabs { display: flex; border-bottom: 1px solid var(--border, #333); margin-bottom: 8px; }
.panel-tab { padding: 6px 12px; cursor: pointer; border-bottom: 2px solid transparent; }
.panel-tab.active { border-bottom-color: var(--accent, #3b7dd8); color: var(--fg, #e8e8ea); }
.panel-relation-suppress { margin-left: 8px; cursor: pointer; color: var(--muted, #888); opacity: 0.5; }
.panel-relation-suppress:hover { opacity: 1; color: var(--warning, #cc8); }
.panel-history-entry { padding: 6px 8px; border-bottom: 1px solid var(--border, #222); font-size: 0.85em; }
.panel-history-action { font-weight: bold; color: var(--accent, #3b7dd8); }
.panel-history-time { font-size: 0.75em; color: var(--muted, #888); margin-left: 8px; }
.panel-history-diff { font-family: monospace; font-size: 0.8em; margin-top: 4px; white-space: pre-wrap; }

/* Audit page table */
.audit-table { width: 100%; border-collapse: collapse; }
.audit-table th, .audit-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--border, #333); font-size: 0.9em; }
.audit-table th { background: var(--panel-bg, #1a1a1d); position: sticky; top: 0; }
.audit-table tr.audit-row-expanded { background: var(--hover, #2a2a2e); }
.audit-details { font-family: monospace; font-size: 0.8em; white-space: pre-wrap; background: var(--input-bg, #111); padding: 8px; border-radius: 4px; margin: 4px 0; }
.audit-revert-btn { padding: 2px 8px; font-size: 0.8em; }
.audit-filters { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid var(--border, #333); }
.audit-filters label { display: flex; flex-direction: column; font-size: 0.85em; color: var(--muted, #9a9aa0); }
.audit-filters input, .audit-filters select { padding: 4px 8px; font-size: 0.9em; }
```

- [ ] **Step 2: Extend `index.html`**

Add an Audit link in the header. Find the existing `<a class="nav-link" href="/validation.html">Validation</a>` (or near-equivalent) and add right after:

```html
<a class="nav-link" href="/audit.html">Audit</a>
```

Add a new modal for Edit Entity (similar to Create Entity). Place with the other modal divs:

```html
<div id="kh-modal-edit-entity" class="kh-modal-backdrop">
  <div class="kh-modal">
    <h3>Edit Entity</h3>
    <p id="kh-edit-id-label" style="color:#9a9aa0;font-size:0.85em;"></p>
    <label>Name <input id="kh-edit-name" type="text"></label>
    <label>Properties (JSON) <textarea id="kh-edit-properties" rows="4"></textarea></label>
    <label>Project code <input id="kh-edit-project-code" type="text" placeholder="01001 (optional)"></label>
    <label>Product
      <select id="kh-edit-product">
        <option value="">(none)</option>
        <option value="diemaster">diemaster</option>
        <option value="spotfusion">spotfusion</option>
        <option value="visionking">visionking</option>
      </select>
    </label>
    <div class="row-buttons">
      <button id="kh-edit-cancel">Cancel</button>
      <button id="kh-edit-save" class="primary">Save Changes</button>
    </div>
  </div>
</div>

<div id="kh-modal-suppress" class="kh-modal-backdrop">
  <div class="kh-modal">
    <h3>Suppress Relation</h3>
    <p id="kh-suppress-edge-label" style="color:#9a9aa0;font-size:0.85em; font-family: monospace;"></p>
    <label>Reason (optional) <input id="kh-suppress-reason" type="text" placeholder="e.g. wrong extraction from email"></label>
    <p style="margin-top:12px;color:#9a9aa0;font-size:0.85em;">The underlying triple stays in the database. Reads across all endpoints will hide this edge until you unsuppress.</p>
    <div class="row-buttons">
      <button id="kh-suppress-cancel">Cancel</button>
      <button id="kh-suppress-save" class="primary">Suppress</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Smoke**

```bash
cd /home/teruel/worktrees/infra-kh-graph-round-a/services/knowledge-hub
KH_PORT=8899 KH_DB_PATH=/tmp/kh-phase6-smoke.db node index.mjs &
SERVER_PID=$!
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:8899/dashboard/editor.css; echo
curl -s http://localhost:8899/dashboard/ | grep -c 'kh-modal-edit-entity'
kill $SERVER_PID; rm -f /tmp/kh-phase6-smoke.db
```

Expected: 200 + 1.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(knowledge-hub): editor.css + index.html modals for edit/suppress"
```

---

### Task 13: `editor.js` — Edit + Suppress modals, revert, audit helpers

**Files:**
- Modify: `services/knowledge-hub/dashboard/editor.js`

- [ ] **Step 1: Append to the IIFE**

Add after the existing modal wiring (Create Entity section):

```javascript
  // ── Edit Entity modal ───────────────────────────────────────────────
  let editEntityId = null;

  function wireEditModal() {
    document.getElementById('kh-edit-cancel').addEventListener('click', () => closeModal('kh-modal-edit-entity'));
    document.getElementById('kh-edit-save').addEventListener('click', async () => {
      if (!editEntityId) return;
      const body = {};
      const name = document.getElementById('kh-edit-name').value.trim();
      const propsRaw = document.getElementById('kh-edit-properties').value.trim();
      const pc = document.getElementById('kh-edit-project-code').value.trim();
      const prod = document.getElementById('kh-edit-product').value;
      if (name) body.name = name;
      if (propsRaw) {
        try { body.properties = JSON.parse(propsRaw); }
        catch { alert('Properties must be valid JSON'); return; }
      }
      if (pc) body.project_code = pc;
      if (prod) body.product = prod;
      if (Object.keys(body).length === 0) { alert('Change at least one field'); return; }
      try {
        const res = await authFetch(`/graph/entities/${encodeURIComponent(editEntityId)}`, {
          method: 'POST', body: JSON.stringify(body),
        });
        if (!res.ok) { const err = await res.json(); alert(`Error: ${err.error || res.status}`); return; }
        closeModal('kh-modal-edit-entity');
        if (window.kh_reloadPanel) window.kh_reloadPanel(editEntityId);
      } catch (e) { alert(e.message); }
    });
  }

  // ── Suppress modal ──────────────────────────────────────────────────
  let suppressEdge = null;

  function wireSuppressModal() {
    document.getElementById('kh-suppress-cancel').addEventListener('click', () => closeModal('kh-modal-suppress'));
    document.getElementById('kh-suppress-save').addEventListener('click', async () => {
      if (!suppressEdge) return;
      const reason = document.getElementById('kh-suppress-reason').value.trim() || null;
      try {
        const res = await authFetch('/graph/suppressions', {
          method: 'POST',
          body: JSON.stringify({ ...suppressEdge, reason }),
        });
        if (!res.ok) { const err = await res.json(); alert(`Error: ${err.error || res.status}`); return; }
        closeModal('kh-modal-suppress');
        if (window.kh_reloadPanel && currentEntityId) window.kh_reloadPanel(currentEntityId);
      } catch (e) { alert(e.message); }
    });
  }
```

Extend the public API on `window.kh_editor`:

```javascript
    openEditEntity(entity) {
      editEntityId = entity.id;
      document.getElementById('kh-edit-id-label').textContent = `Editing: ${entity.id}`;
      document.getElementById('kh-edit-name').value = entity.name || '';
      document.getElementById('kh-edit-properties').value = JSON.stringify(entity.properties || {}, null, 2);
      document.getElementById('kh-edit-project-code').value = entity.project_code || '';
      document.getElementById('kh-edit-product').value = entity.product || '';
      openModal('kh-modal-edit-entity');
    },
    async unlockField(entityId, field) {
      if (!confirm(`Unlock '${field}'? The ingestor will own this field again on next run.`)) return;
      try {
        const res = await authFetch(`/graph/entities/${encodeURIComponent(entityId)}/unlock/${encodeURIComponent(field)}`, { method: 'POST' });
        if (!res.ok) { const err = await res.json(); alert(`Error: ${err.error || res.status}`); return; }
        if (window.kh_reloadPanel) window.kh_reloadPanel(entityId);
      } catch (e) { alert(e.message); }
    },
    openSuppressEdge(subject, predicate, object) {
      suppressEdge = { subject, predicate, object };
      document.getElementById('kh-suppress-edge-label').textContent = `${subject}  ${predicate}  ${object}`;
      document.getElementById('kh-suppress-reason').value = '';
      openModal('kh-modal-suppress');
    },
    async unsuppressEdge(subject, predicate, object) {
      try {
        const res = await authFetch('/graph/suppressions', {
          method: 'DELETE',
          body: JSON.stringify({ subject, predicate, object }),
        });
        if (!res.ok) { const err = await res.json(); alert(`Error: ${err.error || res.status}`); return; }
        if (window.kh_reloadPanel && currentEntityId) window.kh_reloadPanel(currentEntityId);
      } catch (e) { alert(e.message); }
    },
    async revertAuditEntry(entry) {
      // Dispatch based on action
      try {
        let res;
        switch (entry.action) {
          case 'create_entity':
            res = await authFetch(`/graph/entities/${encodeURIComponent(entry.entity_id)}`, { method: 'DELETE' });
            break;
          case 'edit_entity': {
            const body = {};
            for (const f of entry.payload.fields) body[f] = entry.payload.before[f];
            res = await authFetch(`/graph/entities/${encodeURIComponent(entry.entity_id)}`, {
              method: 'POST', body: JSON.stringify(body),
            });
            break;
          }
          case 'merge_entities':
            res = await authFetch(`/graph/unmerge/${encodeURIComponent(entry.payload.from)}`, { method: 'POST' });
            break;
          case 'unmerge_entity':
            res = await authFetch('/graph/merge', {
              method: 'POST',
              body: JSON.stringify({ from: entry.entity_id, into: entry.payload.previous_canonical }),
            });
            break;
          case 'create_triple':
            res = await authFetch(`/graph/triples/${encodeURIComponent(entry.triple_id)}`, { method: 'DELETE' });
            break;
          case 'delete_manual_triple': {
            const b = entry.payload.before;
            res = await authFetch('/graph/triples', {
              method: 'POST',
              body: JSON.stringify({ subject: b.subject, predicate: b.predicate, object: b.object }),
            });
            break;
          }
          case 'suppress_triple': {
            const p = entry.payload;
            res = await authFetch('/graph/suppressions', {
              method: 'DELETE',
              body: JSON.stringify({ subject: p.subject, predicate: p.predicate, object: p.object }),
            });
            break;
          }
          case 'unsuppress_triple': {
            const p = entry.payload;
            res = await authFetch('/graph/suppressions', {
              method: 'POST',
              body: JSON.stringify(p),
            });
            break;
          }
          case 'delete_entity': {
            const b = entry.payload.before;
            res = await authFetch('/graph/entities', {
              method: 'POST',
              body: JSON.stringify({
                id: b.id, name: b.name, type: b.type,
                properties: b.properties, project_code: b.project_code, product: b.product,
              }),
            });
            break;
          }
          default:
            alert(`Revert not supported for action: ${entry.action}`);
            return;
        }
        if (!res.ok && res.status !== 204) {
          const err = await res.json();
          alert(`Revert failed: ${err.error || res.status}`);
        }
        return res.ok;
      } catch (e) { alert(e.message); return false; }
    },
```

Add `wireEditModal();` and `wireSuppressModal();` calls in the DOMContentLoaded block.

- [ ] **Step 2: Smoke**

```bash
KH_PORT=8899 KH_DB_PATH=/tmp/kh-phase6.db node index.mjs &
sleep 2
curl -s http://localhost:8899/dashboard/editor.js | grep -c 'openEditEntity'
kill %1; rm -f /tmp/kh-phase6.db
```

Expected: ≥1.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(knowledge-hub): editor.js — edit, suppress, unlock, revert"
```

---

### Task 14: `panel.js` — Edit button, 🗑 on ingestor edges, History tab, lock indicators

**Files:**
- Modify: `services/knowledge-hub/dashboard/panel.js`

- [ ] **Step 1: Add an "Edit" button**

Next to `+ Relation` / `Merge into…`, add:

```javascript
<button class="panel-btn" id="panel-edit-entity" title="Edit entity">Edit</button>
```

Wire after rendering:

```javascript
document.getElementById('panel-edit-entity')?.addEventListener('click', () => {
  window.kh_editor.openEditEntity(entity);
});
```

- [ ] **Step 2: Lock indicators next to editable fields**

When rendering the entity properties block, for each locked field show a 🔒 icon clickable to unlock:

```javascript
const lockIcon = (field) => entity[`${field}_locked`]
  ? `<span class="panel-field-lock" data-field="${field}" title="Click to unlock — ingestor will own this field again">🔒</span>`
  : '';

// Example for name:
html += `<div class="panel-field"><b>Name:</b> ${escapeHtml(entity.name)}${lockIcon('name')}</div>`;
// Similar for properties, project_code, product
```

Wire:

```javascript
document.querySelectorAll('.panel-field-lock').forEach(el => {
  el.addEventListener('click', () => window.kh_editor.unlockField(entity.id, el.dataset.field));
});
```

- [ ] **Step 3: 🗑 on ingestor edges (replace existing "auto" label)**

Change the relation rendering so ingestor-source edges get a 🗑 icon:

```javascript
const isManual = rel.source === 'manual';
const suppressAffordance = isManual ? '' : `<span class="panel-relation-suppress" data-subject="${escapeHtml(rel.subject)}" data-predicate="${escapeHtml(rel.predicate)}" data-object="${escapeHtml(rel.object)}" title="Suppress this relation">🗑</span>`;
html += `
  <div class="panel-relation" data-entity-id="${escapeHtml(otherId)}" data-triple-id="${escapeHtml(rel.id)}">
    <span class="panel-relation-target">${escapeHtml(otherName)}</span>
    ${dateStr ? `<span class="panel-relation-date">${escapeHtml(dateStr)}</span>` : ''}
    ${isManual
      ? `<span class="panel-relation-delete" data-triple-id="${escapeHtml(rel.id)}" title="Delete manual relation">×</span>`
      : suppressAffordance}
  </div>
`;
```

Wire:

```javascript
document.querySelectorAll('.panel-relation-suppress').forEach(el => {
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    window.kh_editor.openSuppressEdge(el.dataset.subject, el.dataset.predicate, el.dataset.object);
  });
});
```

- [ ] **Step 4: History tab**

Add tab UI:

```javascript
html += `
  <div class="panel-tabs">
    <div class="panel-tab active" data-tab="relations">Relations</div>
    <div class="panel-tab" data-tab="history">History</div>
  </div>
  <div id="panel-tab-relations" class="panel-tab-content">${relationsHtml}</div>
  <div id="panel-tab-history" class="panel-tab-content" style="display:none;"></div>
`;
```

Wire:

```javascript
document.querySelectorAll('.panel-tab').forEach(el => {
  el.addEventListener('click', async () => {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    const rel = document.getElementById('panel-tab-relations');
    const his = document.getElementById('panel-tab-history');
    if (el.dataset.tab === 'history') {
      rel.style.display = 'none';
      his.style.display = 'block';
      // Fetch audit for this entity
      const r = await fetch(`/graph/audit/entity/${encodeURIComponent(entity.id)}?limit=50`);
      const data = await r.json();
      const entries = data.audit || data.entries || [];
      his.innerHTML = entries.map(e => `
        <div class="panel-history-entry">
          <span class="panel-history-action">${escapeHtml(e.action)}</span>
          <span class="panel-history-time">${escapeHtml(e.created_at)}</span>
          ${e.reason ? `<div>Reason: ${escapeHtml(e.reason)}</div>` : ''}
          <div class="panel-history-diff">${escapeHtml(JSON.stringify(e.payload, null, 2))}</div>
        </div>
      `).join('') || '<div class="panel-history-entry">No history.</div>';
    } else {
      rel.style.display = 'block';
      his.style.display = 'none';
    }
  });
});
```

- [ ] **Step 5: Smoke**

Load dashboard, click a node, verify Edit button appears, switching tabs loads history.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(knowledge-hub): panel.js — edit, suppress, lock indicators, history tab"
```

---

### Task 15: `/audit.html` + `audit.js`

**Files:**
- Create: `services/knowledge-hub/dashboard/audit.html`
- Create: `services/knowledge-hub/dashboard/audit.js`

- [ ] **Step 1: Create `audit.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Audit — Knowledge Hub</title>
  <link rel="stylesheet" href="/dashboard/style.css">
  <link rel="stylesheet" href="/dashboard/editor.css">
</head>
<body>
  <header class="header">
    <div class="header-left">
      <h1 class="logo">Knowledge Hub — Audit</h1>
    </div>
    <div class="header-right">
      <a class="nav-link" href="/">Dashboard</a>
      <a class="nav-link" href="/validation.html">Validation</a>
    </div>
  </header>

  <div class="audit-filters">
    <label>Action
      <select id="audit-action">
        <option value="">(all)</option>
        <option>create_entity</option>
        <option>edit_entity</option>
        <option>delete_entity</option>
        <option>merge_entities</option>
        <option>unmerge_entity</option>
        <option>create_triple</option>
        <option>delete_manual_triple</option>
        <option>suppress_triple</option>
        <option>unsuppress_triple</option>
        <option>unlock_field</option>
      </select>
    </label>
    <label>Entity ID <input id="audit-entity-id" type="text" placeholder="person:..."></label>
    <label>Since (ISO) <input id="audit-since" type="text" placeholder="2026-04-24"></label>
    <label style="visibility:hidden">Apply <button id="audit-apply" class="primary" style="padding:4px 12px;">Apply</button></label>
  </div>

  <div id="audit-list" style="padding:12px 0;"></div>
  <div style="padding:12px; text-align:center;">
    <button id="audit-more">Load more</button>
  </div>

  <!-- Edit and Suppress modals + editor.js so revert can route through existing flows -->
  <!-- Include the same modal scaffolds as index.html for editor.js to bind -->
  <script src="/dashboard/editor.js"></script>
  <script src="/dashboard/audit.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `audit.js`**

```javascript
(function () {
  let offset = 0;
  const limit = 50;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function buildQuery() {
    const action = document.getElementById('audit-action').value;
    const entity = document.getElementById('audit-entity-id').value.trim();
    const since  = document.getElementById('audit-since').value.trim();
    const qs = new URLSearchParams();
    if (action) qs.set('action', action);
    if (entity) qs.set('entity_id', entity);
    if (since)  qs.set('since', since);
    qs.set('limit', limit);
    qs.set('offset', offset);
    return qs.toString();
  }

  async function load(append = false) {
    const r = await fetch(`/graph/audit?${buildQuery()}`);
    const data = await r.json();
    const entries = data.audit || [];
    const container = document.getElementById('audit-list');
    if (!append) container.innerHTML = '';
    container.innerHTML += entries.map(e => {
      const payload = e.payload ? JSON.stringify(e.payload, null, 2) : '';
      return `
        <div class="panel-history-entry" data-id="${e.id}">
          <span class="panel-history-action">${escapeHtml(e.action)}</span>
          <span class="panel-history-time">${escapeHtml(e.created_at)}</span>
          ${e.entity_id ? `<span style="margin-left:8px; color:#888;">entity=${escapeHtml(e.entity_id)}</span>` : ''}
          ${e.triple_id ? `<span style="margin-left:8px; color:#888;">triple=${escapeHtml(e.triple_id)}</span>` : ''}
          ${e.reason ? `<div>Reason: ${escapeHtml(e.reason)}</div>` : ''}
          <div class="audit-details">${escapeHtml(payload)}</div>
          <button class="audit-revert-btn" data-action="revert" data-id="${e.id}">Revert</button>
        </div>
      `;
    }).join('');
    offset += entries.length;

    container.querySelectorAll('.audit-revert-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.bound) return; btn.dataset.bound = '1';
        const id = Number(btn.dataset.id);
        const entry = entries.find(x => x.id === id);
        if (!entry) return;
        if (!confirm(`Revert this ${entry.action}?`)) return;
        const ok = await window.kh_editor.revertAuditEntry(entry);
        if (ok) { offset = 0; load(false); }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('audit-apply').addEventListener('click', () => { offset = 0; load(false); });
    document.getElementById('audit-more').addEventListener('click', () => load(true));
    load(false);
  });
})();
```

Note: audit.html does NOT include the modal DOM (edit / suppress / create). The revert function uses existing endpoints but the confirmation flow is plain `confirm()`, no modals needed. editor.js is still included for `authFetch` and `revertAuditEntry`.

- [ ] **Step 3: Smoke**

```bash
KH_PORT=8899 KH_DB_PATH=/tmp/kh-audit.db node index.mjs &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:8899/audit.html
curl -s -o /dev/null -w "%{http_code}" http://localhost:8899/dashboard/audit.js
kill %1; rm -f /tmp/kh-audit.db
```

Expected: both 200.

- [ ] **Step 4: Commit**

```bash
git add services/knowledge-hub/dashboard/audit.html services/knowledge-hub/dashboard/audit.js
git commit -m "feat(knowledge-hub): /audit.html page with filters + revert"
```

---

## Phase 7 — Deploy + smoke

### Task 16: Full test run + PR

**Files:** none (run-only)

- [ ] **Step 1: Full suite**

```bash
cd /home/teruel/worktrees/infra-kh-graph-round-a/services/knowledge-hub
node --test test/
```

Expected: all pass; new test count ≈ baseline + 35 or so (exact number may vary based on baseline).

- [ ] **Step 2: End-to-end smoke**

Write `/tmp/kh-round-a-smoke.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
WORKTREE=/home/teruel/worktrees/infra-kh-graph-round-a/services/knowledge-hub
DB=/tmp/kh-round-a-smoke.db
KEY=smoke-round-a-key
KEY_FILE=/tmp/kh-round-a-key.txt
PORT=8899

rm -f "$DB" "$KEY_FILE"
echo -n "$KEY" > "$KEY_FILE"

cd "$WORKTREE"
KH_PORT=$PORT KH_DB_PATH="$DB" KH_API_KEY_FILE="$KEY_FILE" node index.mjs > /tmp/kh-round-a-server.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; rm -f "$DB" "$KEY_FILE"; }
trap cleanup EXIT
for i in $(seq 1 30); do curl -s http://localhost:$PORT/health > /dev/null 2>&1 && break; sleep 0.2; done

PASS=0; FAIL=0
check() { [[ "$3" == "$2" ]] && { echo "  PASS $1 (HTTP $3)"; PASS=$((PASS+1)); } || { echo "  FAIL $1 (expected $2, got $3)"; FAIL=$((FAIL+1)); }; }

echo "=== Create + edit + ingestor upsert preserves edit ==="
curl -s -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:$PORT/graph/entities -d '{"id":"person:ra_edit","name":"Original","type":"person"}' > /dev/null
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:$PORT/graph/entities/person:ra_edit -d '{"name":"Manually Edited"}')
check "edit entity" 200 "$code"
sqlite3 "$DB" "SELECT name_locked FROM entities WHERE id='person:ra_edit';" | grep -q '^1$' && { echo "  PASS name_locked=1"; PASS=$((PASS+1)); } || { echo "  FAIL name_locked"; FAIL=$((FAIL+1)); }

# Simulate ingestor re-upsert: call upsertEntity via a tiny inline node script
node -e "
import('$WORKTREE/lib/db.mjs').then(async db => {
  const g = await import('$WORKTREE/lib/graph.mjs');
  const d = db.initDb('$DB');
  g.upsertEntity(d, { id: 'person:ra_edit', name: 'Ingestor Clobbered', type: 'person' });
  const row = d.prepare('SELECT name FROM entities WHERE id=?').get('person:ra_edit');
  console.log('  after-upsert name:', row.name);
}).catch(e => { console.error(e); process.exit(1); });
"

echo "=== Suppress + unsuppress flow ==="
curl -s -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:$PORT/graph/entities -d '{"id":"person:ra_sup_a","name":"SA","type":"person"}' > /dev/null
curl -s -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:$PORT/graph/entities -d '{"id":"project:ra_sup_b","name":"SB","type":"project","product":"diemaster"}' > /dev/null
# Insert an ingestor-style triple directly
sqlite3 "$DB" "INSERT INTO triples (id,subject,predicate,object,confidence,source,created_at) VALUES ('ra_sup_t','person:ra_sup_a','works_on','project:ra_sup_b',1.0,'email:x','2026-04-24T00:00:00Z');"
# Suppress
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:$PORT/graph/suppressions -d '{"subject":"person:ra_sup_a","predicate":"works_on","object":"project:ra_sup_b","reason":"test"}')
check "suppress" 201 "$code"
# Read should not see it
body=$(curl -s http://localhost:$PORT/graph/entity/person:ra_sup_a)
echo "$body" | grep -q "project:ra_sup_b" && { echo "  FAIL suppressed edge still visible"; FAIL=$((FAIL+1)); } || { echo "  PASS suppressed edge hidden"; PASS=$((PASS+1)); }
# Unsuppress
code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:$PORT/graph/suppressions -d '{"subject":"person:ra_sup_a","predicate":"works_on","object":"project:ra_sup_b"}')
check "unsuppress" 200 "$code"
body=$(curl -s http://localhost:$PORT/graph/entity/person:ra_sup_a)
echo "$body" | grep -q "project:ra_sup_b" && { echo "  PASS edge visible after unsuppress"; PASS=$((PASS+1)); } || { echo "  FAIL edge still hidden"; FAIL=$((FAIL+1)); }

echo "=== Merge survives ingestor upsert ==="
curl -s -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:$PORT/graph/entities -d '{"id":"person:ra_m_a","name":"MA","type":"person"}' > /dev/null
curl -s -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:$PORT/graph/entities -d '{"id":"person:ra_m_b","name":"MB","type":"person"}' > /dev/null
curl -s -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:$PORT/graph/merge -d '{"from":"person:ra_m_a","into":"person:ra_m_b"}' > /dev/null
node -e "
import('$WORKTREE/lib/db.mjs').then(async db => {
  const g = await import('$WORKTREE/lib/graph.mjs');
  const d = db.initDb('$DB');
  g.upsertEntity(d, { id: 'person:ra_m_a', name: 'MA ingestor', type: 'person' });
  const row = d.prepare('SELECT canonical_id FROM entities WHERE id=?').get('person:ra_m_a');
  if (row.canonical_id === 'person:ra_m_b') { console.log('  PASS canonical_id preserved'); process.exit(0); }
  console.log('  FAIL canonical_id:', row.canonical_id); process.exit(1);
}).catch(e => { console.error(e); process.exit(1); });
" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

echo "=== Audit log captured all actions ==="
count=$(sqlite3 "$DB" "SELECT COUNT(*) FROM graph_audit;")
[[ "$count" -ge 8 ]] && { echo "  PASS audit has $count entries"; PASS=$((PASS+1)); } || { echo "  FAIL audit count $count"; FAIL=$((FAIL+1)); }

echo "============================"
echo "TOTAL PASS: $PASS"
echo "TOTAL FAIL: $FAIL"
[[ "$FAIL" -eq 0 ]]
```

Run it:

```bash
chmod +x /tmp/kh-round-a-smoke.sh
bash /tmp/kh-round-a-smoke.sh
```

Expected: all PASS, exit 0.

- [ ] **Step 3: Push branch**

```bash
cd /home/teruel/worktrees/infra-kh-graph-round-a
git push -u origin feat/kh-graph-round-a
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --repo strokmatic/infra --base master --head feat/kh-graph-round-a \
  --title "feat(knowledge-hub): Round A — preservation + suppression + edit + audit" \
  --body "$(cat <<'EOF'
## Summary

Round A of knowledge-hub manual graph editing, addressing the Round 1 preservation bug plus three new capabilities. See spec at `docs/superpowers/specs/2026-04-24-knowledge-hub-graph-editing-round-a-design.md` (JARVIS repo).

## What ships

1. **Preserve manual edits across ingestor re-runs** — 4 new lock columns on `entities`; `upsertEntity` refactored to `INSERT ON CONFLICT DO UPDATE` with `CASE WHEN *_locked = 0` guards. Also fixes the Round 1 bug where `canonical_id` was wiped on every ingest.
2. **Suppress ingestor-created edges** — new `suppressions` table + `POST /graph/suppressions` route. Read-time overlay hides suppressed edges from all graph read endpoints.
3. **Inline entity editing** — new `editEntity` mutation + `POST /graph/entities/:id` route. Editable fields: name, properties, project_code, product.
4. **Audit view** — new `graph_audit` table logs every manual mutation with before/after JSON. Served by `GET /graph/audit` + a new `/audit.html` page; per-entity History tab on the side panel.

Complete plan at `docs/superpowers/plans/2026-04-24-knowledge-hub-graph-editing-round-a-plan.md` (JARVIS repo).

## Test plan

- [x] All automated tests pass
- [x] End-to-end smoke script passes
- [ ] Deploy via `services/knowledge-hub/deploy.sh`
- [ ] Browser smoke: edit an entity, ingest, verify name persists; suppress an edge, verify hidden; revert from /audit.html

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait for review, merge, deploy**

```bash
gh pr merge <PR#> --repo strokmatic/infra --merge
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git checkout master
git pull origin master
export SSHPASS=$(cat ~/.secrets/vk-ssh-password)
cd services/knowledge-hub
bash deploy.sh
```

Expected: deploy.sh completes; health endpoint returns 200.

- [ ] **Step 6: Post-deploy migration sanity**

```bash
sshpass -e ssh strokmatic@192.168.15.2 "sqlite3 /opt/jarvis-knowledge-hub/data/knowledge-hub.db 'PRAGMA table_info(entities);' | grep -E 'name_locked|properties_locked'"
```

Expected: both columns listed.

```bash
sshpass -e ssh strokmatic@192.168.15.2 "sqlite3 /opt/jarvis-knowledge-hub/data/knowledge-hub.db 'SELECT name FROM sqlite_master WHERE type=\"table\" AND name IN (\"suppressions\",\"graph_audit\");'"
```

Expected: both table names listed.

---

## Final

After merge + deploy, manual browser smoke against `http://192.168.15.2:8093/`:

- [ ] Edit an entity (rename). Save. Reload dashboard. Name persists.
- [ ] Wait for an ingest cycle (or trigger via `bash run.sh ingest` on server). Name still the edited value.
- [ ] Suppress an ingestor-created edge on any node. Reload. Edge gone from the panel + from the graph canvas.
- [ ] Navigate to `/audit.html`. See the edit + suppression entries. Click Revert on the suppression. Edge returns.
- [ ] Click the History tab on any edited entity. See that entity's audit trail only.
- [ ] Click a 🔒 lock icon next to a field. Unlock. Next ingest restores the ingestor's value.
