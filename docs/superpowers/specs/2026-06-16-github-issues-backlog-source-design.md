# GitHub Issues as Backlog Source of Truth — Design

> **Date:** 2026-06-16
> **Status:** Approved (design) — pending implementation plan
> **Topic:** Rewire the JARVIS orchestrator so GitHub Issues replace the local
> `backlogs/**/*.md` task lists as the source of truth for product/orchestrator
> task tracking.
> **Predecessor:** Phase 1 (issue migration) created 63 issues across 10 repos and
> retired the local `.md` task lists to pointer stubs
> (`reports/backlog-reconciliation-2026-06-16.md`, commit `aa5da06`).

## 1. Purpose & context

Phase 1 migrated every open backlog task into GitHub Issues and reduced the seven
local task-list files to pointer stubs (zero `- [ ]` lines). The orchestrator's
backlog consumers still *read and write* those `.md` files — they simply find
nothing now. Phase 2 repoints those consumers at GitHub Issues so that:

- The dashboard reports real, live pending work from GitHub.
- The MCP write tools (`add` / `complete`) act on issues, not `.md`.
- Dispatch becomes an **explicit, human-triggered** action (no autonomous loop).

### Decisions locked by the user (2026-06-16)

1. **Dispatch = manual only.** The cron `process_backlogs` loop must **not**
   auto-run `claude --print` against issues. The orchestrator reads/reports;
   dispatch is triggered explicitly per issue.
2. **Cache + scheduled refresh.** Reads come from a local JSON cache refreshed by
   a cron task; writes hit GitHub directly and then refresh the affected slice.
3. **All at once.** Read path + write path + retirement of obsolete sync plumbing
   ship in one spec/plan.

### Non-goals

- No ClickUp re-integration (the legacy `sync-clickup-to-backlogs` path stays
  retired/inert).
- No rewrite of git history to purge the plaintext credentials that remain in the
  pre-retirement `.md` revisions (pre-existing; out of scope).
- No `ready`/`dispatch` opt-in label workflow (rejected in favor of fully manual
  dispatch). The design leaves room to add one later without rework.

## 2. Current consumers (what Phase 2 touches)

**Read path**
- `scripts/orchestrator.sh` → `process_backlogs()` — greps `^\- \[ \]` from the
  resolved `.md` and auto-dispatches up to `max_tasks_per_workspace` per workspace.
- `.claude/hooks/DashboardSummary.hook.sh` — globs `backlogs/jarvis/*.md` +
  `backlogs/strokmatic/*.md`, counts `- [ ]`.
- `mcp-servers/backlog-manager/index.js` → `list_backlog_tasks`.

**Write path** (all in `backlog-manager`)
- `add_backlog_task` — appends to central `.md`, then pushes a copy to
  `<workspace>/.claude/backlog.md` + baseline.
- `complete_backlog_task` — marks `[x]` by substring match.
- `sync_backlog` — three-way merge of workspace-local vs central `.md`.

**Obsolete sync plumbing**
- `.claude/hooks/BacklogPreloader.hook.sh` — copies `<ws>/.claude/backlog.md` →
  central `${BACKLOG_DIR}/<ws>.md` when local is newer.

**Unchanged**
- `.claude/hooks/ChangelogVerifier.hook.sh` — triggers on `complete_backlog_task`,
  warns on a missing changelog entry. Stays (changelog concern, not backlog source).

## 3. Architecture: one deep module, two callers

Both shell and node need identical GitHub/cache logic. A single module owns it; a
thin CLI surface lets shell call it and an importable surface lets the MCP use it.

### `scripts/lib/backlog-source.mjs`

A deep module with a small interface hiding `gh`, the JSON cache, and repo
resolution. Dual-mode by an `import.meta`/`process.argv` entrypoint check.

**Importable API (used by the MCP):**

```js
resolveRepo(workspace)        // → { owner, repo, slug } | null
listIssues(workspace, {       // → Issue[] from cache
  label = 'backlog', state = 'open',
  refresh = 'if-stale' })     // 'if-stale' (default) | 'never' (cache-only, never
                              //   touches the network — used by the dashboard hook)
createIssue(workspace, {      // → { number, url } ; gh issue create + refresh slice
  title, body, labels })
closeIssue(workspace, {       // → { number, url } ; gh issue close + refresh slice
  number, comment })
refreshCache(repos = ALL)     // → { repo, count }[] ; pull issues → cache
```

`Issue` shape (mirrors `gh --json`): `{ number, title, body, labels:string[],
state, url, updatedAt }`.

**CLI surface (used by shell):**

```
node scripts/lib/backlog-source.mjs resolve-repo <workspace>
node scripts/lib/backlog-source.mjs list  <workspace|owner/repo> [--label backlog] [--state open] [--json]
node scripts/lib/backlog-source.mjs refresh [owner/repo ...]        # default: all configured repos
node scripts/lib/backlog-source.mjs create <workspace|owner/repo> --title T --body B --labels a,b
node scripts/lib/backlog-source.mjs close  <workspace|owner/repo> <number> [--comment C]
```

Exit non-zero with a stderr message on gh/auth failure; `list` falls back to stale
cache (exit 0) when GitHub is unreachable.

### Repo resolution

`resolveRepo(workspace)`:
1. `workspace === "orchestrator"` → `pteru/JARVIS` (hard-coded; JARVIS is a private
   repo outside the strokmatic org).
2. Else read `workspaces.json[workspace].remotes.origin` and parse the owner/repo
   from both forms:
   - `git@github.com:strokmatic/diemaster.git` → `strokmatic/diemaster`
   - `https://github.com/strokmatic/diemaster.git` → `strokmatic/diemaster`
3. Return `null` if no remote or not a github.com URL (caller treats as
   "no backlog → skip").

`config/orchestrator/issue-repos.json` pins the canonical list of issue-bearing
repos so `refresh` (no args) doesn't enumerate all 111 workspaces/submodules:

```json
{
  "repos": [
    "strokmatic/visionking", "strokmatic/spotfusion", "strokmatic/diemaster",
    "strokmatic/sdk", "strokmatic/sdk-observability-stack",
    "strokmatic/sdk-message-poster", "strokmatic/strokmatic-eip",
    "strokmatic/infra", "strokmatic/sdk-agent-standards", "pteru/JARVIS"
  ],
  "default_label": "backlog"
}
```

### Cache

- One file per repo: `data/backlog-cache/<owner>__<repo>.json`
  `{ fetchedAt, repo, issues: Issue[] }`.
- `data/backlog-cache/` is git-ignored (generated state).
- **Refresh** = `gh issue list --repo <r> --label backlog --state open
  --limit 200 --json number,title,body,labels,state,url,updatedAt` → write file.
- **Staleness**: TTL 6h. `listIssues` refreshes if `now - fetchedAt > TTL` and
  GitHub is reachable; otherwise serves whatever is cached. Missing cache + offline
  → empty list (logged), never a hard error on the read path.

## 4. Read-path rewire

### 4.1 `process_backlogs` → `refresh-backlog-cache`

The 09:00 cron stops dispatching. Its replacement:
- Calls `backlog-source refresh` for all configured repos.
- Logs a per-repo pending summary (counts) to the cron log + `dispatches.json`
  (status `complete`, task `refresh-backlog-cache`) for dashboard continuity.
- **Removes** the `grep '^\- \[ \]' … task-dispatcher.sh` auto-dispatch block.

`scripts/orchestrator.sh`: **hard rename** — the `process-backlogs` mode and the
`process_backlogs()` function are removed and replaced by `refresh-backlog-cache` /
`refresh_backlog_cache()`. No deprecated alias. Because nothing keeps the old name
alive, every in-repo caller flips in the **same change** (audit-all-consumers
before rename):
- the `daily)` dispatcher case (currently `process_backlogs`) → `refresh_backlog_cache`,
- the usage string,
- `config/orchestrator/schedules.json` daily entry `task: process_backlogs` →
  `refresh_backlog_cache` (drop `max_tasks_per_workspace`),
- the crontab line (`orchestrator.sh process-backlogs` → `refresh-backlog-cache`).

`grep -rn 'process[-_]backlogs'` must return zero hits outside historical
changelogs/specs after the change.

### 4.2 `DashboardSummary` hook

Replace the `.md` glob with a cache read:

```
-- Pending Backlog Issues (GitHub) --
  strokmatic/visionking: 20 open
  strokmatic/spotfusion: 11 open
  ...
  (cache age: 2h — run `orchestrator.sh refresh-backlog-cache` to update)
```

Uses `listIssues(ws, { refresh: 'never' })` — cache-only, so the session hook
never blocks on a network call. If the cache is absent, prints a one-line hint to
run the refresh.

### 4.3 MCP `list_backlog_tasks`

Delegates to `listIssues(workspace, { label, state })`. The `priority` filter is
reinterpreted: priority is not a first-class GitHub field, so `priority` maps to an
optional label filter (`high|medium|low` → same-named label if present) and
otherwise returns all open backlog issues. Output lists `#<number> <title> [labels]
— <url>`.

## 5. Write-path rewire

### 5.1 `add_backlog_task(workspace, task, priority, complexity)`

→ `createIssue(workspace, { title, body, labels })`:
- `title` = first line of `task` (truncated ~80 chars); `body` = full `task` +
  a footer noting it was filed via JARVIS.
- `labels` = `['backlog', complexity?]` + `priority` as a label if the repo uses
  priority labels (best-effort; skip unknown labels rather than fail).
- Ensures the `backlog` (and complexity) labels exist via `gh label create
  --force` before `gh issue create` (mirrors the Phase-1 `mklabels` lesson — issue
  creation aborts on a missing label).
- Returns the created issue URL. Drops the `.md` append and the
  `pushToWorkspace`/baseline writes entirely.

### 5.2 `complete_backlog_task(workspace, task_pattern)`

→ resolve the issue, then `closeIssue`:
- If `task_pattern` is numeric (or `#N`), close issue N directly.
- Else substring-match `task_pattern` against cached open-issue titles; if exactly
  one matches, close it; if 0 or >1, return a disambiguation message (no close).
- Close with a comment: `Completed via JARVIS on <date>.`
- Refresh the repo's cache slice after closing.

### 5.3 `sync_backlog` — retired

Remove the tool from the `ListTools` response and the `CallTool` switch. The
`pushToWorkspace`, baseline, and three-way-merge code is deleted. (Document the
removal in the changelog; `sync_backlog` was the only consumer of the baseline
machinery.)

## 6. Manual dispatch (new)

`orchestrator.sh dispatch-issue <workspace|owner/repo> <issue-number>`:
1. Resolve the workspace (if given `owner/repo`, find the workspace whose
   `remotes.origin` matches; error if ambiguous/none).
2. `gh issue view <number> --repo <r> --json title,body,labels,url`.
3. Derive complexity from labels (`simple|medium|complex`, default `medium`).
4. Build the task prompt: title + body + a line linking the issue URL and
   instructing the agent to reference it in the PR/commit.
5. `task-dispatcher.sh <workspace> "<prompt>" <complexity>`.
6. Print the issue URL + dispatched model. **Does not** auto-close the issue —
   completion is a separate, deliberate `complete_backlog_task` / `gh issue close`.

`--dry-run` prints the resolved workspace, complexity, and the exact
`task-dispatcher.sh` invocation without executing (used by tests).

## 7. Retirement & cleanup

- Delete `.claude/hooks/BacklogPreloader.hook.sh` and unregister it from
  `.claude/settings*.json` hook config.
- Remove `sync_backlog` (tool + code) and the baseline/push helpers from
  `backlog-manager`.
- `scripts/lib/config.sh`: keep `BACKLOG_DIR`/`JARVIS_BACKLOG_DIR` (the stubs +
  READMEs still live there) but they are no longer a task source.
- Add `data/backlog-cache/` to `.gitignore`.
- The pointer stubs and index READMEs from Phase 1 are unchanged.

## 8. Error handling

| Condition | Behavior |
|---|---|
| `gh` not authed / network down on **read** | serve stale cache; if no cache, empty list + logged warning; never throw on read |
| `gh` failure on **write** (create/close) | surface the gh stderr to the MCP caller as an error result; cache untouched |
| Cron refresh offline | log warning per repo, leave existing cache intact, exit 0 |
| Unknown workspace / non-github remote | `resolveRepo` → null; caller skips (same as today's "no backlog") |
| `complete` pattern matches 0 or >1 | return disambiguation message; do not close anything |
| Missing label on `create` | `gh label create --force` first, then create |

## 9. Testing strategy

All tests run offline by putting a **stub `gh`** first on `PATH` (a small script
that echoes canned `--json` payloads and records its argv), per the existing
`node --test` harness.

**Unit**
- `resolveRepo`: ssh form, https form, `orchestrator → pteru/JARVIS`, missing
  remote → null.
- cache read/parse + TTL staleness boundary (fresh vs >6h).
- complexity-from-labels mapping (incl. default `medium`).
- `add` label assembly (`backlog` + complexity + best-effort priority).

**Integration (stubbed gh)**
- `backlog-source list` returns parsed issues; falls back to stale cache when the
  stub simulates a network error.
- `create` invokes `gh label create` then `gh issue create` with the right
  `--label` args (assert recorded argv); returns the URL.
- `close` invokes `gh issue close --comment …`.
- `DashboardSummary` hook renders the "Pending Backlog Issues" section from a
  fixture cache.
- `dispatch-issue --dry-run` emits the correct `task-dispatcher.sh` argv for a
  given fixture issue + complexity label.

**Regression**
- Existing `dashboard-summary.test.mjs` is updated for the new section header.
- `config-loader` / `script-conventions` tests stay green.

## 10. Rollout

1. Land `backlog-source.mjs` + `issue-repos.json` + cache + tests (no consumer
   touches yet) — provably correct in isolation.
2. Switch the read path **atomically** (hard rename has no fallback): the
   `orchestrator.sh` mode + `daily)` alias + usage, the dashboard hook,
   `list_backlog_tasks`, and `schedules.json`. The live crontab line is updated in
   the same step (a deploy action, since crontab is outside the repo) — once the
   mode is renamed, the old `process-backlogs` cron would error otherwise.
3. Switch the write path (`add`/`complete`), retire `sync_backlog` +
   `BacklogPreloader`.
4. Add `dispatch-issue`.
5. Changelog entry; update `README.md` + `docs/SKILLS.md` tool descriptions.

A follow-up (not this spec) may add an opt-in `ready` label + an
`--all-ready` batch dispatch if the manual flow proves too slow.
