# Knowledge Hub — Manual Graph Editing Design

**Date:** 2026-04-23
**Service:** `knowledge-hub`
**Status:** Design (pending implementation)

## Goal

Let a human curate the knowledge-hub graph through the dashboard UI. Three connected capabilities:

1. **Manual relations** — add and delete edges between entities (e.g., link a person to a project the ingestor missed).
2. **Entity merging** — collapse duplicates produced by divergent ingestor slugs (e.g., `person:fabio_sena` and `person:fabio_sena_strokmatic`) into a single canonical node with all edges transferred.
3. **Company → plant hierarchy** — introduce a new `plant` entity type and a `part_of` relation so real factories (GM Gravataí, GM SJC, Nissan Smyrna) can be distinguished from their parent companies. A person can link to either the company or a specific plant.

All three ship together as one unified feature (the user chose a single-spec scope).

## Context

The knowledge-hub already exposes a D3 graph + side panel at `http://192.168.15.2:8093/dashboard/`. Entities and triples are written exclusively by ingestors today; there are no POST/DELETE routes. The `triples.source` column tags every edge with its originating ingestor, and each ingestor cleans its own triples on every run. That existing contract is the natural seam for this feature: manual edges get tagged `source='manual'` and are invisible to all ingestor cleanup paths.

For merging we chose **alias-based merge** (`canonical_id` pointer) over permanent merge so re-ingests don't undo user curation. For plants we chose a **new entity type** (not a schema column) so existing type-aware UI code (color/icon/filter) picks up plants for free.

## Scope

### In scope

- Schema: one nullable column `entities.canonical_id`
- New `entities.type` value: `plant`
- New `triples.source` values: `manual`, `seed:plants`
- New module `lib/graph-editor.mjs` with merge/unmerge/triple/entity mutators
- Six new write routes on `server.mjs`, all API-key-gated
- Four existing read routes updated for alias resolution
- New `dashboard/editor.js` + `editor.css`, panel.js/search.js tweaks
- One-shot bootstrap script `scripts/seed-plants.mjs` and `config/plants.json`
- Unit, integration, migration, and seed-script tests

### Out of scope

- Bulk/canvas-level edge editing (drag-between-nodes). Deferred until demand is proven.
- Full audit log table. We rely on `triples.created_at` and `entities.canonical_id` alone for v1.
- Ingestor auto-merge (consulting aliases before upsert). Read-time resolution makes this unnecessary for correctness; it would only clean up cosmetic duplicate rows.
- Plant inference from project names/locations. Future ingestor, separate spec.
- Role-based access or multi-user auth. Single shared API key.

## Data Model & Invariants

### Schema migration

One migration, additive, idempotent:

```sql
ALTER TABLE entities ADD COLUMN canonical_id TEXT;
CREATE INDEX IF NOT EXISTS idx_entities_canonical_id ON entities(canonical_id);
```

Applied at service start. If `lib/db.mjs` has no migration runner today
(likely — ingestors currently write into a schema declared at init),
the implementation plan will introduce a small idempotent pattern:
check `PRAGMA table_info(entities)` for the `canonical_id` column and
issue the `ALTER TABLE` once on first boot after upgrade.

### New values (no schema work)

- `entities.type`: `plant` is now a permitted value (column is `TEXT`, so no DDL needed). Validation enforced at write time in `graph-editor.mjs`.
- `triples.source`: `manual` (edges you add in the UI) and `seed:plants` (edges from the plant bootstrap script) join the existing prefixes (`email:`, `meeting:`, `pmo_report:`, `kb_pages:`, `chat_fact:`, `clickup_task:`, `drive_index:`).

### Load-bearing invariants

1. **The editor only touches rows where `source='manual'`.** Never mutates ingestor-created or seed triples.
2. **Ingestors never touch rows where `source='manual'` or `source='seed:*'`.** Already true — each ingestor only deletes rows matching its own `source` prefix via `deleteTriplesBySource(db, sourceKey)`.
3. **An entity with `canonical_id IS NOT NULL` is an alias.**
   - Hidden from the default graph view and `/graph/view`
   - Still returned by search and entity-detail lookups (by redirect to the canonical), so aliases remain findable by their old name
   - Ingestors upserting an alias just refresh its name/properties; its edges stay on the alias row until you unmerge. Read-time resolution shows those edges on the canonical (see "Alias resolution" below).
4. **`canonical_id` is never self-referential, never forms a cycle, and is flattened on merge.** If you merge A into B and B is already an alias of C, A's `canonical_id` is set to C directly (not B).

## `lib/graph-editor.mjs`

Pure functions, `db` passed as first argument, same style as `lib/graph.mjs`. All throw typed errors for `server.mjs` to map to HTTP codes.

### Exports

```
createEntity(db, { id?, name, type, properties?, project_code?, product? })
  Validates type is in allowed set (person|company|plant|project|product|role).
  Auto-generates id as `${type}:${slug(name)}` if not provided, where
    slug(s) = s.normalize('NFD').replace(/[̀-ͯ]/g,'')
              .toLowerCase().replace(/[^\w]+/g,'_').replace(/^_|_$/g,'')
    (matches the existing convention in `lib/ingestors/emails.mjs` and
    `meetings.mjs`).
  Rejects existing id (returns ValidationError).
  Enforces conditional fields: type=project requires product.
  Returns the created entity.

addManualTriple(db, { subject, predicate, object, valid_from?, valid_to? })
  Validates subject and object exist (NotFoundError otherwise).
  Normalizes predicate: lowercase, strip leading/trailing whitespace, replace
    spaces and hyphens with underscores.
  Blocks `part_of` cycles only (walks up existing `part_of` chain from
    object; cycles on other predicates are allowed). Rationale: `part_of`
    is the only hierarchical predicate in v1; other predicates can
    legitimately form cycles (e.g., `collaborates_with`).
  Generates id = `manual:${md5(subject|predicate|object)}` so the same edge
    is idempotent.
  Inserts with source='manual', confidence=1.0, created_at=now.
  Returns the triple.

deleteManualTriple(db, tripleId)
  Fetches the triple; rejects with ValidationError if source !== 'manual'.
  Rejects with NotFoundError if not found.
  Deletes.

mergeEntities(db, { fromId, intoId })
  Rejects fromId === intoId (ValidationError).
  Rejects if fromId already has canonical_id pointing elsewhere (guidance:
    "merge into the canonical instead").
  Flattens intoId: if intoId itself has canonical_id, substitute with its
    canonical.
  Sets fromId.canonical_id = (flattened) intoId.
  Returns { fromId, canonicalId }.

unmergeEntity(db, fromId)
  Clears canonical_id.
  Returns the updated entity.
```

### Error types

- `ValidationError` → HTTP 400
- `NotFoundError` → HTTP 404
- `CycleError` → HTTP 409
- Anything else → HTTP 500

Error response shape: `{ "error": "<message>", "code": "<error_type>" }`.

## Server routes

All new routes live in `lib/server.mjs` and are gated by `apiKeyMiddleware`, which reads `X-API-Key` from request headers and compares to the file at `config.api_key_file` (single shared key; eq-in-constant-time).

```
POST   /graph/entities       createEntity
POST   /graph/triples        addManualTriple
DELETE /graph/triples/:id    deleteManualTriple
POST   /graph/merge          mergeEntities     body: { from, into }
POST   /graph/unmerge/:id    unmergeEntity
GET    /graph/predicates     list of curated predicates + distinct
                             predicates currently in DB (for the dropdown;
                             no auth)
```

**Curated predicates** returned by `/graph/predicates` (v1 list):

`works_on`, `works_at`, `works_for`, `has_role`, `belongs_to`, `part_of`, `involves`, `client_of`, `supplies_to`, `reports_to`, `collaborates_with`, `mentions`, `depends_on`, `about`.

The endpoint merges this list with `SELECT DISTINCT predicate FROM triples` so recent custom predicates surface in the dropdown too.

## Alias resolution in existing read endpoints

The editor never rewrites triples. Existing reads transparently resolve aliases.

### `GET /graph/entity/:id`

- If the requested entity has `canonical_id`, the endpoint internally redirects (server-side fetch; not HTTP 3xx) to the canonical and returns it, with `{ requested_id: "<original>", canonical_id: "<target>" }` added to the body. The UI uses this to render "Fábio Sena (also: Fábio Sena | Strokmatic)".
- Relations listed for the canonical include triples whose subject/object is **either** the canonical id **or** any of its aliases. Aliases are discovered via `SELECT id FROM entities WHERE canonical_id = ?`. Result: edges that originally pointed at the alias appear on the canonical's panel automatically.

### `GET /graph/view`

- `WHERE canonical_id IS NULL` on entities → aliased entities don't render as nodes.
- Triples whose subject or object is aliased: the aliased id is substituted with its canonical in the emitted payload. Resulting duplicates are de-duped by `(subject, predicate, object, source)`.

### `GET /graph/neighbors/:id?depth=N`

- Resolves `:id` through `canonical_id` first, then walks from the canonical.
- Substitution rules as in `/graph/view`.

### `GET /graph/path?from=X&to=Y`

- Both endpoints resolved through `canonical_id` before path search.

### `GET /search/suggest`

- Returns aliases too, marked with a small `↳ <canonical name>` indicator so the user knows clicking it lands on the canonical page.

### Why read-time resolution

- Unmerge is a single column update; no edge history to reconstruct
- Ingestors can re-upsert aliased entities without any coordination; their edges naturally resolve through the canonical on the next read
- Merge is a single-row UPDATE — fast, atomic, easy to test

## UI

### `dashboard/panel.js` (existing, small additions)

- Header strip gets three buttons alongside the close button: **+ Relation**, **Merge into…**, and — visible only when the current entity has `canonical_id` — **Unmerge**.
- Each relation row gets a trailing `×` icon; only clickable when `source === 'manual'`. Ingestor-created edges show a muted `auto` badge instead.
- When the entity is itself an alias, a banner at the top: *"This entity was merged into [canonical name]. Click here to view the canonical."* Banner wired to navigate to the canonical.

### `dashboard/editor.js` (new, ~250 LOC)

Owns all modal lifecycles, fetch calls, and form state.

**Add Relation modal**
- **Predicate** — `<select>` populated from `GET /graph/predicates`, with a final "Custom…" option that reveals a text input. Normalization preview shown under the input (`Works For → works_for`).
- **Target entity** — autocomplete calling `GET /search/suggest?q=…&types=person,company,plant,project,product,role`. Results show id, name, type badge. An always-present "+ Create new entity" pseudo-result opens the Create Entity modal inline; on save, returns to this modal with the new entity pre-filled.
- **valid_from** / **valid_to** — collapsed optional date inputs.
- Submit → `POST /graph/triples`. Optimistic update with rollback on 4xx/5xx.

**Merge Entities modal**
- One field: target entity, same autocomplete.
- Confirm dialog: *"This will redirect all edges from [A] onto [B]. You can unmerge later."*
- Submit → `POST /graph/merge`. On success, panel refreshes and shows the canonical entity (with the "also known as" banner).

**Create Entity modal**
- Fields: `type` (dropdown: person / company / plant / project / product / role), `name` (text), `product` (shown only for `type=project`), `project_code` (optional for plant/person).
- Submit → `POST /graph/entities`. Used standalone (from search "no results") and inline from Add Relation.

### `dashboard/search.js` (existing, one addition)

- When `GET /search/suggest` returns zero results, show a `+ Create new entity "<query>"` row that launches the Create Entity modal prefilled.

### Authentication

- On dashboard load, if the user has ever made a write, the key is stored in `localStorage.kh_api_key`. The first write prompts for the key via a tiny dialog, stores it, and uses it on subsequent requests.
- All write fetches include the `X-API-Key` header. 401 → clear the key, re-prompt.

### Styling

- Reuse existing `style.css` variables (dark theme, existing color tokens). Modals follow the pattern already in `validation.html`/`validation.js` (backdrop + centered card). One new file `dashboard/editor.css` for modal-specific rules.

## Plant bootstrap

`config/plants.json` — small seed file:

```json
{
  "company:gm": {
    "name": "General Motors",
    "plants": [
      { "id": "plant:gm_sjc",      "name": "GM São José dos Campos", "city": "São José dos Campos", "country": "BR" },
      { "id": "plant:gm_gravatai", "name": "GM Gravataí",             "city": "Gravataí",            "country": "BR" },
      { "id": "plant:gm_flint",    "name": "GM Flint",                "city": "Flint",               "country": "US" }
    ]
  },
  "company:nissan": { "name": "Nissan", "plants": [ ... ] },
  "company:arcelormittal": { "name": "ArcelorMittal", "plants": [ ... ] }
}
```

**One-shot script** `scripts/seed-plants.mjs` (run via `node scripts/seed-plants.mjs`, idempotent):

- For each company: upsert the company entity (name from file wins), then for each plant upsert the plant entity (`type=plant`, `properties={city, country}`), then insert a `part_of` triple (plant → company) with `source='seed:plants'`.
- Deterministic triple IDs (`seed:plants:${md5(subject|predicate|object)}`) so duplicates collapse on re-run.
- Safe to re-run: `INSERT OR REPLACE` on entities; triple IDs are stable.
- **NOT deletable from the UI.** The UI only deletes `source='manual'`. To amend seed data, edit the JSON and re-run the script.

Initial plant list (targets real projects in `config/project-codes.json`): GM SJC, GM Gravataí, GM Flint; Nissan Smyrna, Nissan Canton; ArcelorMittal Tubarão. Expandable in-file without code changes.

## Ingestor interaction

Deliberately zero coordination required between ingestors and the editor.

- Ingestors upsert entities and triples exactly as today.
- If an ingestor upserts an entity that has been aliased manually, the upsert still hits the alias row. The canonical stays authoritative via read-time resolution.
- Ingestors still do clean rebuilds per source (`deleteChunksBySource` + `deleteTriplesBySource`). Since the editor's source tags (`manual`, `seed:plants`) never match any ingestor's sourceType prefix, those deletions can never touch editor-written rows.

**Future (out of scope):** an "auto-merge-on-ingest" feature could consult the aliases and redirect upserts before they happen, removing the cosmetic duplicate rows. Read-time resolution means this is a cleanup optimization, not a correctness fix.

## Domain → company map

`config/domain-company-map.json` is untouched by this feature. Emails ingestor continues to resolve email domains to companies (not plants). If someone's email is `joe@gm.com`, they're linked to `company:gm`. Moving them to a specific plant is a manual edit in the UI.

## Testing

### Unit tests — `test/graph-editor.test.mjs`

Pure-function testing, fast, no filesystem or network.

- `createEntity`: slug generation, duplicate-id rejection, type validation, conditional field requirements.
- `addManualTriple`: predicate normalization, `part_of` cycle detection, missing-subject/object 404, deterministic ID hashing.
- `deleteManualTriple`: rejects non-manual deletion, rejects unknown id.
- `mergeEntities`: self-merge rejected, alias-flattening (A→B→C collapses to C, not B), merge-into-alias works, triples unchanged on disk, `canonical_id` set.
- `unmergeEntity`: clears `canonical_id`, leaves edges untouched.
- Alias-resolution helpers: unknown entity, resolving chains, resolving to self (no-op).

### Integration tests — `test/server-editor.test.mjs`

In-memory DB seeded with representative fixtures.

- API-key gating: missing/wrong/correct.
- Each route: happy path + one error path.
- Read-time resolution: after merge, `GET /graph/entity/:fromId` returns the canonical body with `requested_id`; `GET /graph/view` omits the alias; `/graph/neighbors` resolves.

### Migration test — `test/migration.test.mjs`

- Fresh DB starts at current schema.
- Existing DB without `canonical_id`: migration adds the column, existing rows untouched.
- Idempotent on re-run.

### Seed-script test — `test/seed-plants.test.mjs`

- Runs against a temp DB; inserts plants + `part_of`; re-runs and asserts row counts don't grow.

### UI (manual smoke)

No automated UI tests (existing dashboard isn't instrumented). Manual checklist to be executed as part of the implementation plan's last task:

- Add a relation between existing entities → appears in graph on refresh.
- Create a new plant entity and `part_of` edge to company → plant appears with distinct color.
- Merge a duplicate person → canonical shows combined relations; aliased name still searchable.
- Unmerge → alias reappears with its original relations.
- API-key prompt fires on first write; persists after.

## Open questions / future work

- **Ingestor auto-merge** — when an ingestor upserts an aliased entity, could it redirect the upsert to the canonical to prevent cosmetic duplicate rows? Read-time resolution handles correctness, so this is pure cleanup. Revisit once we see how much noise the alias rows generate.
- **Plant inference** — a future ingestor could extract plant signals from project names (e.g., `GM-SJC-S10_CC_LE` → `plant:gm_sjc`) and create `located_at` edges automatically. Separate spec.
- **Audit log table** — if we ever need "who edited what when" beyond the built-in `created_at`, a dedicated `graph_audit` table slots in cleanly. YAGNI for v1 (single-user system).
- **Bulk canvas editing** — drag-between-nodes, right-click delete on the graph canvas. Evaluate after observing actual edit patterns.

## Approved decisions (brainstorming summary)

| # | Decision | Value |
|---|---|---|
| 1 | Scope of this spec | One unified design covering manual edges + merge + hierarchy |
| 2 | Plant representation | New entity type `plant` (no schema column) |
| 3 | Merge semantics | Alias (`canonical_id`), reversible, ingestor-safe |
| 4 | Predicate vocabulary | Hybrid — curated dropdown + custom free-text with normalization |
| 5 | UI surface | In-panel editing (existing side panel + three modals) |
| 6 | Auth | API-key on writes, read stays open |
| 7 | Plant bootstrap | Seed file + one-shot script; manual additions thereafter |
