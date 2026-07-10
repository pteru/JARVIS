---
type: Implementation Plan
title: KH Graph-Editing — Overnight Run Status (2026-04-24)
description: The feature branch needs to be merged to `master` on `strokmatic/infra` and deployed to `strokmatic@192.168.15.2`. Both are shared-infra changes that require your explicit consent — I did not proce...
timestamp: 2026-04-23
---

# KH Graph-Editing — Overnight Run Status (2026-04-24)

## Summary

**All backend + UI implementation complete. Only manual deploy + browser smoke remaining.**

- Branch: `feat/kh-graph-editing` in worktree `/home/teruel/worktrees/infra-kh-graph-editing`
- Commits on top of master: 20 (1 migration + 5 module + 5 alias + 6 routes + 1 seed + 6 UI = check `git log --oneline master..HEAD`)
- Automated tests: **151/151 pass**
- End-to-end API smoke: **22/22 pass** (see "Smoke transcript" below)

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Worktree + baseline | ✅ | 97/97 baseline |
| 1 Migration (Task 1) | ✅ | `canonical_id` column added, idempotent |
| 2 graph-editor module (Tasks 2-6) | ✅ | 5 functions, 25 tests, 3 typed errors |
| 3 Alias resolution (Tasks 7-11) | ✅ | `resolveAlias` + `listAliasesOf`; 4 read endpoints + search rewired |
| 4 Write routes (Tasks 12-17) | ✅ | 6 endpoints, auth-gated via `isAuthorized()` |
| 5 Plant bootstrap (Task 18) | ✅ | `config/plants.json` + idempotent seed script |
| 6 Dashboard UI (Tasks 19-24) | ✅ | 3 modals, editor.js/css, panel + search tweaks |
| 7 Deploy + E2E smoke (Tasks 25-26) | ⚠️ **Blocked** | Requires your consent |

## Blockers

### 1. Merge to master + deploy to production (Task 25)

The feature branch needs to be merged to `master` on `strokmatic/infra` and deployed to `strokmatic@192.168.15.2`. Both are shared-infra changes that require your explicit consent — I did not proceed unsupervised.

Exact commands, ready to run:

```bash
# 1. Visual review of commits before merge
cd /home/teruel/worktrees/infra-kh-graph-editing
git log --oneline master..HEAD

# 2. Merge to master with merge commit
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git fetch origin master
git checkout master
git merge --no-ff feat/kh-graph-editing
git push origin master

# 3. Deploy
export SSHPASS=$(cat ~/.secrets/vk-ssh-password)
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/knowledge-hub
bash deploy.sh

# 4. Seed plants in production
sshpass -e ssh strokmatic@192.168.15.2 \
  ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-knowledge-hub && node scripts/seed-plants.mjs"

# Expected: "seeded 3 companies and their plants"

# 5. Verify plants landed
sshpass -e ssh strokmatic@192.168.15.2 \
  "sqlite3 /opt/jarvis-knowledge-hub/data/knowledge-hub.db 'SELECT id, name FROM entities WHERE type=\"plant\" LIMIT 10;'"

# Expected: 6 rows (GM SJC, GM Gravataí, GM Flint, Nissan Smyrna, Nissan Canton, ArcelorMittal Tubarão)
```

### 2. Browser manual smoke checklist (Task 26)

Can only be done with a live browser. Run against `http://192.168.15.2:8093/dashboard/` (or `/` — not `/dashboard/` directly; see note below).

- [ ] Page loads with no console errors.
- [ ] Click any node → panel shows `+ Relation`, `Merge into…` buttons.
- [ ] Click `+ Relation`, pick `works_on`, autocomplete a project, save. On first write, API key prompt appears; enter key; relation appears.
- [ ] Search bar: type a non-existent name → "+ Create new entity" row appears; click → modal opens prefilled.
- [ ] Create a plant entity via the modal. Find it in search.
- [ ] Add a `part_of` relation from the new plant to an existing company. Graph view: the plant is distinctly colored (type-based style — `plant` should pick up a new color automatically from graph.js type-to-color mapping).
- [ ] Try to add a reverse `part_of` — expect a 409 error surfaced in the UI via the `alert()`.
- [ ] Merge a duplicate entity: click one of the duplicates → `Merge into…` → pick target → confirm. Panel refreshes to show canonical with combined relations.
- [ ] Reload the page; search for the merged-away name → it appears with a `↳ canonical_name` indicator.
- [ ] Click the alias in search → lands on canonical panel with the banner "This entity was merged into…"; `Unmerge` button is visible.
- [ ] Click `Unmerge` → alias reappears as its own node in the graph view.
- [ ] Delete a manual relation (×) on the panel → relation row disappears.
- [ ] Try to delete an "auto" relation → no × icon present (control is absent).

### 3. Pre-existing `/dashboard/` trailing-slash 500

Smoke run caught this (not new — existed before Phase 6):

```
GET /dashboard/     → HTTP 500
GET /dashboard/index.html → HTTP 200
GET /              → HTTP 200
```

The `serveDashboardPath` handler resolves `/dashboard/` (trailing slash) to the directory itself and `readFile()` on a directory fails. Unrelated to this feature; fix is a one-liner (serve `index.html` when the path resolves to a directory). Flagging it because some users might land on `/dashboard/` as a bookmark and get a 500.

Suggested fix (not done yet):

```javascript
// In the dashboard static handler, before readFile:
const stat = fs.statSync(fullPath);
if (stat.isDirectory()) { fullPath = path.join(fullPath, 'index.html'); }
```

## Notes for review

- **TDD discipline**: Phase 2 was written as one module then tests appended per-task (disclosed by implementer). Not strict red-green-red-green but the final state + commit narrative are correct.
- **Phase 9 `getGraphView` duplication**: The `/graph/view` route handler now has inline alias-aware logic. The existing `getGraphView()` in `lib/graph.mjs` is unchanged and kept for other callers. Cosmetic duplication — fold together later if it bothers you.
- **Task 11 `/search/suggest` shape**: Existing `suggest()` returns chunk snippets (FTS5). Implementer added an entity LIKE-search beside it so entity rows with `id`/`canonical_id`/`canonical_name` appear after chunks. The dashboard's autocomplete expects `id` + `name`, so entity results are what the UI needs. Revisit if the mixed shape causes surprises.
- **Auth**: All 6 write routes gate via `isAuthorized()` from `lib/auth.mjs`. The test suite creates a temp key file and sets `KH_API_KEY_FILE`. In production the key should already be at `~/.secrets/knowledge-hub-api-key` (existing config).

## Smoke transcript (local, 2026-04-24 05:03 UTC)

```
=== 1. Health ===
  PASS GET /health (HTTP 200)
=== 2. GET /graph/predicates (no auth) ===
  PASS GET /graph/predicates (HTTP 200)
  PASS works_on in predicates
=== 3. Auth gating ===
  PASS POST /graph/entities no key (HTTP 401)
  PASS POST /graph/entities wrong key (HTTP 401)
=== 4. Create entities ===
  PASS create person:smoke_alice (HTTP 201)
  PASS create project:smoke_proj (HTTP 201)
  PASS create plant auto-id (HTTP 201)
  PASS create with bad type (HTTP 400)
=== 5. Create triples ===
  PASS manual source tag
  PASS triple with missing subject (HTTP 404)
=== 6. Merge + read-time resolution ===
  PASS create person:smoke_alias (HTTP 201)
  PASS merge canonicalId
  PASS alias redirects to canonical (GET /graph/entity/person:smoke_alias → id=person:smoke_alice, requested_id=person:smoke_alias)
=== 7. Unmerge ===
  PASS unmerge clears canonical_id
=== 8. Seed plants ===
  PASS seeded 7 plants (expected >= 6)
  PASS seeded 6 part_of edges
=== 9. Dashboard assets ===
  PASS GET /dashboard/editor.css (HTTP 200)
  PASS GET /dashboard/editor.js (HTTP 200)
  PASS GET /dashboard/panel.js (HTTP 200)
  PASS GET /dashboard/search.js (HTTP 200)
  PASS GET /dashboard/style.css (HTTP 200)

TOTAL PASS: 22 / TOTAL FAIL: 0
```

Smoke script is saved at `/tmp/kh-smoke.sh` if you want to re-run.
