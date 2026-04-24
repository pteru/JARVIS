# Knowledge Hub — Manual Graph Editing, Round A

**Date:** 2026-04-24
**Service:** `knowledge-hub`
**Status:** Design (pending implementation)

## Goal

Second round of manual-graph-editing features, addressing gaps discovered in the Round 1 implementation and user feedback. Four connected capabilities:

1. **Preserve manual entity edits across ingestor re-runs.** Fixes a real bug in Round 1 where ingestor `upsertEntity` clobbers `canonical_id` (and any user rename or property edit).
2. **Suppress ingestor-created relations.** Soft-delete a wrong edge so it stays hidden even after ingestor re-runs. Optional user reason/note.
3. **Inline entity property editing.** Rename an entity, set city/country on a plant, correct project_code or product after the fact.
4. **Audit view.** A dedicated page listing every manual mutation with before/after payloads; plus a per-entity history tab on the existing side panel.

## Context

Round 1 shipped in `strokmatic/infra#37` and deployed to `192.168.15.2`. Manual triples, entity merging, and plant-company hierarchy now work. During the PR review, a real correctness bug surfaced: `lib/graph.mjs::upsertEntity` uses `INSERT OR REPLACE` which deletes the existing row and inserts a fresh one, so `canonical_id` (which ingestors don't include) gets wiped on every re-ingest. Result: user merges silently undone on next ingest.

This round fixes that plus extends curation coverage. The user chose scope A (these four features together, in one spec) with enrichment ideas (auto-suggestions, lint, aliases, undo) deferred to Round B.

## Scope

### In scope

- Schema: 4 new lock columns on `entities`, new `suppressions` table, new `graph_audit` table.
- Refactor `lib/graph.mjs::upsertEntity` to `INSERT ... ON CONFLICT DO UPDATE` with per-field `CASE WHEN *_locked = 0` guards.
- New `graph-editor.mjs` exports: `editEntity`, `unlockField`, `suppressTriple`, `unsuppressTriple`, `logAudit` (private helper).
- 5 new write routes + 2 new read routes on `lib/server.mjs`.
- Suppression filter applied in all read endpoints that emit triples (`/graph/entity/:id` relations, `/graph/view`, `/graph/neighbors/:id`).
- UI: Edit button on panel opening an edit modal; × icon on ingestor-created edges triggering suppress flow; new `/audit.html` page; new "History" tab on the side panel.
- Unit, integration, migration tests for each piece.

### Out of scope

- Duplicate-suggestion panel, auto-plant linking, alias/AKA metadata, graph lint rules, undo/redo stack, CSV export. All deferred to Round B.
- Changing the audit log into a full event-sourced system. The audit table is a log, not the source of truth.
- Bulk operations on audit entries (select multiple → batch revert). Single-action undo only.
- Editing `type` or `id` — semantically dangerous, rare in practice, use merge or re-create.

## Data Model & Invariants

### Schema migrations

All additive and idempotent — wired into the existing `runMigrations(db)` in `lib/db.mjs`:

```sql
ALTER TABLE entities ADD COLUMN name_locked INTEGER DEFAULT 0;
ALTER TABLE entities ADD COLUMN properties_locked INTEGER DEFAULT 0;
ALTER TABLE entities ADD COLUMN project_code_locked INTEGER DEFAULT 0;
ALTER TABLE entities ADD COLUMN product_locked INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS suppressions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suppressions_triple ON suppressions(subject, predicate, object);

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
```

`suppressions.id` is deterministic: `md5(subject|predicate|object)` first 16 hex chars. Prevents duplicate suppression rows for the same logical edge.

### Action enum for `graph_audit`

- `create_entity`, `edit_entity`, `delete_entity`, `merge_entities`, `unmerge_entity`
- `create_triple`, `delete_manual_triple`
- `suppress_triple`, `unsuppress_triple`
- `unlock_field`

Payload format per action:
- `create_entity`: `{ after: {id, name, type, ...} }`
- `edit_entity`: `{ before: {name:"X", properties:{...}, ...}, after: {name:"Y", properties:{...}, ...}, fields: ["name","properties"] }`
- `merge_entities`: `{ from: "person:a", into: "person:b", canonical: "person:b" }` (canonical = flattened)
- `unmerge_entity`: `{ entity_id: "person:a", previous_canonical: "person:b" }`
- `create_triple`: `{ after: {id, subject, predicate, object, source, ...} }`
- `delete_manual_triple`: `{ before: {id, subject, predicate, object, source, ...} }`
- `suppress_triple`: `{ subject, predicate, object, reason }`
- `unsuppress_triple`: `{ subject, predicate, object }`
- `unlock_field`: `{ entity_id, field, previous_value }`

### Invariants

1. **Ingestor `upsertEntity` never overwrites a locked field.** The SQL is one `INSERT ... ON CONFLICT(id) DO UPDATE SET` with four `CASE WHEN X_locked = 0 THEN excluded.X ELSE X END` clauses for name/properties/project_code/product. `canonical_id` remains omitted from the UPDATE SET (preserved by absence). `type` is also not in the UPDATE SET (entity type never changes post-creation).
2. **Editing a field via the editor always sets its lock to 1 and logs to `graph_audit`.** There's no "edit without locking" — if you meant the ingestor to own it, don't edit it. Explicit `unlockField()` returns the field to ingestor ownership.
3. **Suppressions are a read-time overlay.** Underlying triples remain; ingestors keep writing them. All triple-emitting read endpoints LEFT JOIN suppressions and exclude matches. Unsuppressing restores visibility without any data touch.
4. **Every manual mutation logs one `graph_audit` row** within the same transaction as the mutation itself. `db.transaction(() => { ... })` wraps the write + log together; either both land or neither.
5. **Deterministic IDs for suppressions and triples** means re-applying the same suppression (or re-creating a suppressed triple) is safe — `INSERT OR IGNORE` / `INSERT OR REPLACE` collapse duplicates.

## `lib/graph-editor.mjs` additions

Pure functions, db first arg, same style as Round 1 exports. Throw typed errors.

```
editEntity(db, { id, name?, properties?, project_code?, product? })
  Looks up current row. For each field provided, sets the value AND
  sets *_locked = 1. Updates row with ON CONFLICT DO UPDATE. Logs one
  `edit_entity` audit row with before/after diff + list of changed fields.
  Throws NotFoundError if id missing.
  Throws ValidationError if no editable field provided.
  Returns updated entity (with all fields including the new lock values).

unlockField(db, entityId, fieldName)
  Valid field names: name, properties, project_code, product.
  Sets *_locked = 0. Logs `unlock_field` with previous value.
  Throws ValidationError if fieldName not in allowed set.
  Throws NotFoundError if entity missing.
  Returns updated entity.

suppressTriple(db, { subject, predicate, object, reason? })
  Computes deterministic suppression id.
  INSERT OR IGNORE into suppressions (so re-suppressing is idempotent).
  Logs `suppress_triple` audit row.
  Returns the suppression row.

unsuppressTriple(db, { subject, predicate, object })
  DELETE FROM suppressions WHERE ... LIMIT 1.
  Logs `unsuppress_triple` audit row (even if no row was deleted —
  the action was requested). Returns { removed: boolean }.

listAudit(db, { entity_id?, triple_id?, action?, since?, limit?, offset? })
  Reads graph_audit with optional filters, ordered by created_at DESC.
  Returns array of rows with payload_json parsed into payload.

listSuppressions(db, { limit?, offset? })
  Reads suppressions, ordered by created_at DESC. For the audit UI's
  "currently suppressed" section.

-- internal helper (not exported) --
logAudit(db, { action, entity_id?, triple_id?, payload, reason? })
  Inserts one row; called inside every mutation's transaction.
```

All existing exports (`createEntity`, `addManualTriple`, `deleteManualTriple`, `mergeEntities`, `unmergeEntity`) gain `logAudit` calls inside their transactions, preserving current behavior but adding the audit trail.

## `lib/graph.mjs::upsertEntity` refactor

Current (buggy) implementation:

```javascript
db.prepare(`
  INSERT OR REPLACE INTO entities (id, name, type, properties, project_code, product)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(id, name, type, JSON.stringify(properties), project_code, product);
```

New implementation:

```javascript
db.prepare(`
  INSERT INTO entities (id, name, type, properties, project_code, product)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name         = CASE WHEN name_locked         = 0 THEN excluded.name         ELSE name         END,
    properties   = CASE WHEN properties_locked   = 0 THEN excluded.properties   ELSE properties   END,
    project_code = CASE WHEN project_code_locked = 0 THEN excluded.project_code ELSE project_code END,
    product      = CASE WHEN product_locked      = 0 THEN excluded.product      ELSE product      END
`).run(id, name, type, JSON.stringify(properties), project_code, product);
```

Notes:
- `canonical_id` preserved (not in SET — no more DELETE+INSERT).
- `type` also preserved (not in SET). Ingestors never change an entity's type anyway.
- `id` is the conflict key and inherently preserved.
- Four lock columns have `DEFAULT 0`, so pre-existing entities behave exactly as before the migration.

Regression test: merge two entities, run an ingestor upsert for one of them, verify `canonical_id` still set. Edit an entity's name, run an ingestor upsert with a different name, verify the edited name persists.

## Read-path suppression filter

Add a helper in `lib/graph.mjs`:

```javascript
export function isSuppressed(db, subject, predicate, object) {
  return db.prepare(`
    SELECT 1 FROM suppressions
    WHERE subject = ? AND predicate = ? AND object = ?
  `).get(subject, predicate, object) !== undefined;
}
```

Or, for batch filtering (preferred for efficiency):

```javascript
export function filterSuppressed(db, triples) {
  if (!triples.length) return triples;
  // Build a set of (subject, predicate, object) keys for all suppressions
  const rows = db.prepare('SELECT subject, predicate, object FROM suppressions').all();
  const suppressed = new Set(rows.map(r => `${r.subject}|${r.predicate}|${r.object}`));
  return triples.filter(t => !suppressed.has(`${t.subject}|${t.predicate}|${t.object}`));
}
```

Applied to:
- `GET /graph/entity/:id` — after fetching relations for canonical + alias ids, filter with `filterSuppressed(db, relations)`.
- `GET /graph/view` — already iterates triples substituting canonical ids; add a filter pass at the end.
- `GET /graph/neighbors/:id` — apply filter before expanding frontier.

The filter operates on the post-alias-substitution triples (a suppression on `(alias_subject, p, o)` still takes effect because we suppress by exact (s,p,o) before substitution — the suppression check happens on the raw triple row).

## Server routes

All writes gated by `isAuthorized(req)`. Routes added:

```
POST   /graph/entities/:id               editEntity                body: partial entity
POST   /graph/entities/:id/unlock/:field  unlockField
DELETE /graph/entities/:id               deleteEntity              (for create_entity undo; 409 if inbound edges exist)
POST   /graph/suppressions               suppressTriple            body: { subject, predicate, object, reason? }
DELETE /graph/suppressions                unsuppressTriple          body: { subject, predicate, object }
GET    /graph/suppressions               listSuppressions          (read, no auth)
GET    /graph/audit                      listAudit                 (read, no auth)
  query params: entity_id, triple_id, action, since, limit (default 100), offset (default 0)
GET    /graph/audit/entity/:id           listAudit filtered        shorthand for ?entity_id=:id
```

`deleteEntity(db, id)` — new `graph-editor.mjs` export:
- Rejects if entity has any inbound or outbound triples (with `ValidationError 'entity has edges; merge or remove edges first'`).
- Rejects if entity is the canonical target of an alias (`ValidationError 'entity is a canonical; unmerge alias first'`).
- Logs `create_entity`-reverse audit row as action `delete_entity`.
- Adds `delete_entity` to the action enum.

Error mapping identical to Round 1: ValidationError → 400, NotFoundError → 404, CycleError → 409.

The UI will use `GET /graph/audit/entity/:id` for the per-entity history tab; `/audit.html` uses `/graph/audit` with pagination.

## UI

### Entity detail panel additions

- **Edit button** next to existing `+ Relation` / `Merge into…` buttons. Opens a new modal with name / properties (JSON editor) / project_code / product fields prefilled.
- **Lock indicator per field**: after saving an edit, a small 🔒 icon appears next to the field in the panel. Clicking the icon shows an "Unlock — ingestor owns this again" option.
- **× on ingestor-created edges**: currently auto-hidden (only manual edges show ×). Change: ingestor edges get a trashcan icon (🗑) on hover that triggers a suppression modal (with optional reason). Manual edges keep the red × (actual delete).
- **Alias banner already exists** (from Round 1) — unchanged.
- **New "History" tab** on the panel. Tabs: `Relations` (current default view) | `History`. History shows audit entries for this entity, paginated (20 per page), with action icon, timestamp, before/after diff. "Revert" button on each supported action (see Undo section).

### `/audit.html` top-level page

Layout mirrors `/validation.html`:

- Filter controls: action type dropdown, date range, entity-id search, free-text search across reasons.
- Table: timestamp | action | target (entity or triple) | reason | details (expands inline to show before/after JSON).
- Each row has a "Revert" button when the action supports it.
- Pagination (20 rows per page).

Linked from the dashboard header: `Dashboard | Validation | Audit`.

### Suppression modal

Triggered from the trashcan (🗑) on an ingestor-created edge:

- Shows the edge's (subject → predicate → object).
- One text field: "Reason (optional) — will be visible in the audit log".
- Buttons: Cancel / Suppress.
- On confirm: `POST /graph/suppressions` with the triple + reason, panel refreshes.

### Edit Entity modal

Similar to Create Entity modal (prefilled with current values):

- `name` — text field.
- `properties` — JSON text editor (single textarea with validation: must parse as JSON). Preview parsed result below.
- `project_code` — text field, 5-digit validation.
- `product` — dropdown (diemaster/spotfusion/visionking) + empty option.
- Save button wires to `POST /graph/entities/:id` with only the changed fields.
- Server computes diff against the stored row and logs before/after.

### Undo semantics

For v1, supported undo actions:
- `create_entity` → revert via `DELETE /graph/entities/:id` (new route, gated by the entity having no inbound edges — otherwise UI warns and user must merge/manually clean first).
- `edit_entity` → revert by calling `editEntity` with the "before" payload.
- `merge_entities` → `unmergeEntity` the alias.
- `unmerge_entity` → re-merge with the previous canonical.
- `create_triple` → `deleteManualTriple`.
- `delete_manual_triple` → re-add with the same subject/predicate/object via `addManualTriple`.
- `suppress_triple` → `unsuppressTriple`.
- `unsuppress_triple` → `suppressTriple`.
- `unlock_field` → NOT directly undoable; just re-edit the field with the old value.

Revert button maps action → reverse API call. UI pattern: confirm dialog with the reverse-action summary, then call the API, then refresh the audit list. Reverts themselves are audit-logged (so "revert of edit" appears as a fresh `edit_entity` entry — the audit log is append-only).

The `delete_entity` route is a new addition in this round, used only for undo.

## Ingestor interaction

Zero ingestor code changes required. The new SQL in `upsertEntity` is backward-compatible:

- Pre-existing entities have `*_locked = 0` (column default). Their ingestor upserts behave identically to before (fields get overwritten from `excluded.*`).
- Only after a user manually edits does a lock become 1, and only then does the CASE WHEN kick in.
- Suppressions are read-time overlays; ingestors don't see them at all.
- Audit is logged by editor code only; ingestor writes are not audited (intentional — they're noise in the audit view).

## Testing strategy

### Unit tests — `test/graph-editor.test.mjs` additions

- `editEntity` sets locks for changed fields only (editing only `name` leaves `properties_locked = 0`).
- `editEntity` rejects unknown id, missing fields.
- `unlockField` clears the lock; subsequent ingestor upsert updates the field.
- `suppressTriple` is idempotent (second call doesn't add a second row).
- `unsuppressTriple` returns `{ removed: true }` if row existed, `{ removed: false }` otherwise.
- `listAudit` filters by entity_id, paginates correctly.

### Regression tests — `test/graph.test.mjs` additions

- After merging `A → B`, a subsequent `upsertEntity(A)` does NOT clear `canonical_id`.
- After `editEntity(id, {name: 'New'})`, a subsequent `upsertEntity({id, name: 'Old'})` preserves `'New'`.
- After `unlockField(id, 'name')`, the next `upsertEntity` does update `name`.

### Integration tests — `test/server-editor.test.mjs` additions

- `POST /graph/entities/:id` — auth-gated, diff-logs to audit, locks set.
- `POST /graph/suppressions` — auth-gated, idempotent.
- `GET /graph/audit` — returns paginated list, filters work.
- Suppressed triple absent from `/graph/entity/:id` relations, `/graph/view` edges, `/graph/neighbors/:id`.
- Unsuppressing restores visibility.

### Migration test — `test/migration.test.mjs` additions

- Existing DB without lock columns / suppressions / graph_audit: migration adds them.
- Pre-existing entities have `*_locked = 0` after migration.
- Idempotent re-run.

### UI smoke (manual, post-deploy checklist)

- Rename an entity via Edit modal. Run an ingest. Name sticks.
- Suppress an ingestor-created edge via the 🗑 icon with a reason. Reload the graph. Edge gone.
- Visit `/audit.html`. See the suppression + rename entries. Revert the suppression. Edge returns.
- Check per-entity History tab — shows just that entity's actions.

## Approved decisions (brainstorming summary)

| # | Decision | Value |
|---|---|---|
| 1 | Scope split | Round A (these 4) now; enrichment features (suggestions, lint, aliases, undo stack, export) → Round B |
| 2 | Suppression semantics | By exact `(subject, predicate, object)` with optional user reason |
| 3 | Audit log format | Full before/after payloads stored as JSON |
| 4 | Editable entity fields | `name`, `properties`, `project_code`, `product` (not `type` or `id`) |
| 5 | Audit UI location | Both — top-level `/audit.html` page + per-entity History tab on the side panel |
| 6 | Persistence architecture | Approach A — extend `entities` with 4 lock columns; new `suppressions` + `graph_audit` tables |
