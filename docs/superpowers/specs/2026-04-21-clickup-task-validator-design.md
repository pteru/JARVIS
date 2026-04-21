# ClickUp Task Validator — Design Spec

> Periodic validation service for ClickUp tasks across DieMaster, SpotFusion, and VisionKing. Detects organizational, metadata, status, and cross-system issues; proposes auto-fixes reviewed via dashboard.

**Goal:** Daily validation of all active ClickUp tasks (334+) against 18 rules covering location, metadata, status consistency, and GitHub↔ClickUp sync. Generates human-reviewable fix plans applied via dashboard.

**Status:** Design approved 2026-04-21. Hosted inside `services/sprint-agents/` as a new mode.

---

## 1. Architecture

```
ClickUp API (source of truth)
    ↓ scan all active + sprint tasks
services/sprint-agents/
  run-validate.mjs (daily 08:00)
    ↓
  lib/validate/
    ├── checks/ (18 pure check functions)
    ├── rules.mjs (config-driven severity + enabled flags)
    ├── inference.mjs (prefix → list heuristics)
    ├── reporter.mjs (JSON + Markdown)
    ├── fix-planner.mjs (generate fix-plan)
    └── fix-applier.mjs (apply fix-plan)
    ↓
data/validation/
  ├── latest.json (current state)
  ├── report-YYYY-MM-DD.md (human-readable report)
  ├── fix-plan-YYYY-MM-DD.md (proposed auto-fixes, editable)
  ├── fix-applied-history.json (applied ops)
  └── plans-archive/ (historical plans)
    ↓
Consumers:
  ├── Google Chat alert (critical new issues only)
  └── knowledge-hub dashboard (new "Validation" tab)
         ↓
       POST /validation/apply → spawns run-validate-apply.mjs
```

**Modules:**
- **checks/*.mjs** — pure functions `(task, context) → issue[]`. Context includes config, project lists, sprint state, GitHub state.
- **rules.mjs** — loads `config/validation-rules.json`, applies severity and thresholds.
- **inference.mjs** — maps task name prefix to target list (config-driven via `prefix-mapping.json`).
- **reporter.mjs** — formats JSON (for dashboard/API) and Markdown (for humans).
- **fix-planner.mjs** — generates `fix-plan-{date}.md` with fixable issues only.
- **fix-applier.mjs** — reads fix-plan, executes approved fixes via ClickUp API, logs results.

---

## 2. Data Model

### Issue

```json
{
  "id": "sha1(task_id+check_id)",
  "check_id": "primary-not-sprint",
  "category": "location",
  "severity": "critical",
  "task": {
    "id": "868j5b9h7",
    "name": "iris-gvt: testar modelo tipo 3",
    "url": "https://app.clickup.com/t/868j5b9h7",
    "product": "visionking",
    "primary_list": { "id": "901113495009", "name": "VK Sprint 30" }
  },
  "description": "Primary location is a Sprint. Expected: product list.",
  "fixable": true,
  "fix_proposal": {
    "action": "move_primary",
    "params": { "target_list_id": "901111455897", "target_list_name": "[03006] IRIS GM-GVT-Body" },
    "inferred_from": "task name prefix 'iris-gvt'"
  },
  "detected_at": "2026-04-21T08:00:00Z"
}
```

### latest.json

```json
{
  "run_id": "2026-04-21T08:00:00Z",
  "total_tasks_scanned": 334,
  "by_severity": { "critical": 3, "warning": 45, "info": 12 },
  "by_product": { "diemaster": 18, "spotfusion": 22, "visionking": 20 },
  "by_category": { "location": 8, "metadata": 30, "status": 15, "github-sync": 7 },
  "issues": [ /* Issue[] */ ]
}
```

### fix-applied-history.json

```json
{
  "applied": [
    {
      "issue_id": "abc123",
      "task_id": "868j5b9h7",
      "action": "move_primary",
      "params": { "target_list_id": "901111455897" },
      "applied_at": "2026-04-21T10:15:00Z",
      "result": "success"
    }
  ]
}
```

### validation-rules.json

```json
{
  "checks": {
    "primary-not-sprint": { "severity": "critical", "enabled": true },
    "secondary-in-sprint": { "severity": "warning", "enabled": true },
    "project-folder-match": { "severity": "critical", "enabled": true },
    "orphan-task": { "severity": "critical", "enabled": true },
    "closed-sprint-open-tasks": { "severity": "warning", "enabled": true },
    "missing-project-code": { "severity": "warning", "enabled": true },
    "missing-product": { "severity": "warning", "enabled": true },
    "missing-task-lane": { "severity": "warning", "enabled": true },
    "missing-assignee-inprogress": { "severity": "warning", "enabled": true },
    "missing-dates-in-sprint": { "severity": "warning", "enabled": true },
    "missing-priority": { "severity": "info", "enabled": true },
    "overdue": { "severity": "warning", "enabled": true },
    "blocked-too-long": { "severity": "warning", "enabled": true, "threshold_days": 7 },
    "in-progress-too-long": { "severity": "warning", "enabled": true, "threshold_days": 7 },
    "github-issue-missing": { "severity": "critical", "enabled": true, "lane": "Software" },
    "github-status-divergent": { "severity": "warning", "enabled": true, "lane": "Software" },
    "done-without-closing-pr": { "severity": "warning", "enabled": true, "lane": "Software" },
    "storm-duplicate-not-closed": { "severity": "warning", "enabled": true, "lane": "Software" }
  },
  "alert": {
    "chat_space_id": "spaces/AAQADpGfnS4",
    "critical_only": true
  }
}
```

---

## 3. v1 Checks (18)

### Category 1 — Location (5)
| ID | Description | Severity | Fixable |
|---|---|---|---|
| `primary-not-sprint` | Task's primary location is a Sprint | critical | yes (infer from prefix) |
| `secondary-in-sprint` | Task missing sprint as secondary when it should | warning | yes |
| `project-folder-match` | Primary list is in wrong product folder (e.g., DM task in VK folder) | critical | no (ambiguous) |
| `orphan-task` | Task has no valid location | critical | no (manual diagnosis) |
| `closed-sprint-open-tasks` | Closed sprint has non-done tasks | warning | yes (move to next sprint) |

### Category 2 — Metadata (6)
| ID | Description | Severity | Fixable |
|---|---|---|---|
| `missing-project-code` | Custom field `project_code` empty | warning | yes (from `[XXXXX]` in list name) |
| `missing-product` | Custom field `product` empty | warning | yes (from task_folder_id) |
| `missing-task-lane` | Custom field `task_lane` empty | warning | no (no heuristic) |
| `missing-assignee-inprogress` | Task "in progress" without assignee | warning | no (human decides) |
| `missing-dates-in-sprint` | Task in sprint without start/due date | warning | yes (copy from sprint dates) |
| `missing-priority` | Active task without priority | info | no (human decides) |

### Category 3 — Status consistency (3)
| ID | Description | Severity | Fixable |
|---|---|---|---|
| `overdue` | Due date passed + status non-done | warning | no |
| `blocked-too-long` | Status "blocked" for >7 days | warning | no |
| `in-progress-too-long` | Status "in progress" for >7 days | warning | no |

### Category 4 — GitHub↔ClickUp sync (4, Software lane only)
| ID | Description | Severity | Fixable |
|---|---|---|---|
| `github-issue-missing` | `github_issue_url` set but issue doesn't exist | critical | no |
| `github-status-divergent` | GitHub issue open but task done (or vice versa) | warning | no |
| `done-without-closing-pr` | Task done but `closing_pr` empty | warning | no |
| `storm-duplicate-not-closed` | Issue labeled `storm-duplicate` but task still open | warning | yes (close as not_planned) |

**Conditional execution:** Category 4 checks skip if `task_lane != "Software"`. If `task_lane` is empty, report `missing-task-lane` (#8) and skip Category 4.

### Note on "done tasks in sprint"
Done tasks remaining in a sprint as **secondary** location is the **correct** behavior — it records which sprint the task was closed in. This is not a violation.

---

## 4. Prefix Mapping (inference)

Configuration in `config/prefix-mapping.json`:

```json
{
  "by_product": {
    "diemaster": {
      "sjc": "900701761455",
      "flint": "900701761583",
      "DEMESTAA": "901113447652",
      "sw": "205149538",
      "ds": "901107101218",
      "ml": "901107101218",
      "hardware": "901107101206"
    },
    "spotfusion": {
      "sjc": "217010888",
      "scds": "901109508049",
      "gvt": null,
      "sw": "901109560051",
      "ds": "901109635130",
      "db": "901109635130",
      "vision": "217010835",
      "hardware": "217010835"
    },
    "visionking": {
      "arcelor": "901109407841",
      "vk-arcelor": "901109407841",
      "arcelor-bm": "901109407841",
      "iris-gvt": "901111455897",
      "sealer": "901112079252",
      "hyundai": "901112079252",
      "sw": "901109471398",
      "ds": "901109474226",
      "vision": "901109715764",
      "hardware": "901109715764"
    }
  },
  "ambiguous": ["iris-scds", "gvt", "vk-body"]
}
```

Ambiguous prefixes are detected and reported but **not** auto-fixable — human must choose.

---

## 5. Google Chat Alert

Fires only when **new critical** issues exist compared to the previous run.

**Message format:**
```
🚨 ClickUp Validator — 3 critical issues
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• VisionKing: 1 critical (orphan-task)
• SpotFusion: 1 critical (github-issue-missing)
• DieMaster: 1 critical (primary-not-sprint)

Total: 3 critical | 45 warnings | 12 info

Review: http://192.168.15.2:8091/dashboard/validation
Fix plan: data/validation/fix-plan-2026-04-21.md
```

**Dedup logic:**
- Compare current critical issues vs previous `latest.json`
- If set is identical (no new, no resolved) → no alert (avoid spam)
- If at least one critical is new OR one resolved → alert with delta
- `--force-alert` flag bypasses dedup for manual testing

**Target space:** `spaces/AAQADpGfnS4` (Infra Alerts) — same space used by health-monitor and knowledge-hub lint.

**Reuses** `alert-sender.mjs` pattern from knowledge-hub (googleapis + DWD).

---

## 6. Dashboard — Validation Tab

**URL:** `http://192.168.15.2:8091/dashboard/validation`

**Layout (dark theme, consistent with D3 knowledge graph):**
- **Header:** total stats (by severity, by product, last run) + "Run now" button
- **Filters:** All / Critical / Warning / Info pills + product pills (DM / SF / VK / All)
- **Issue list:** grouped by category, expandable cards. Each card shows:
  - Task name + link to ClickUp
  - Problem description
  - If fixable: checkbox (default checked); else: "manual" badge
- **Fix Plan footer:** "N auto-fixes selected" + [Preview plan] [Apply Selected]
- **History tab:** list of past reports and fix-plans with date + totals

**Endpoints consumed:**
- `GET /validation/latest` → returns latest.json
- `GET /validation/plan/current` → returns today's fix-plan
- `POST /validation/apply` → spawns `run-validate-apply.mjs`, returns `{ job_id, started_at }`
- `GET /validation/apply/:job_id` → returns apply status + fix-applied-{date}.md path when done
- `GET /validation/history` → list of historical runs

**Tech:** vanilla JS + fetch API (consistent with existing D3 dashboard). No build step.

---

## 7. Fix Plan Lifecycle

### Daily generation (08:00)

1. Validator runs, generates:
   - `data/validation/latest.json` (current state)
   - `data/validation/report-{date}.md` (human-readable, read-only)
   - `data/validation/fix-plan-{date}.md` (editable, excludes already-applied fixes)
2. If any new critical → Google Chat alert

### Human approval flow

Human opens dashboard → reviews issues → checks/unchecks fixable items → clicks "Apply Selected".

**Dashboard POST /validation/apply:**
- Payload: `{ fix_date: "2026-04-21", selected_issue_ids: ["abc1", "abc2"] }`
- Server spawns `node run-validate-apply.mjs 2026-04-21 --selected=abc1,abc2`
- Returns `{ job_id, started_at }` immediately
- Dashboard polls `GET /validation/apply/:job_id` for result

### Next-day run (conflict handling)

- New `fix-plan-{next_date}.md` generated
- Previous plan preserved on disk (historical, not applied)
- **Rule: latest-only apply** — `run-validate-apply` rejects if not the latest plan:
  ```
  Error: fix-plan-2026-04-21.md is stale. Latest: fix-plan-2026-04-22.md. Review and apply the latest.
  ```
- Already-applied fixes tracked in `fix-applied-history.json` and excluded from new plans
- Dashboard always shows the current plan; history tab shows older ones

---

## 8. File Structure

### sprint-agents (expansion)
```
services/sprint-agents/
├── run-validate.mjs              # CLI entry (NEW)
├── run-validate-apply.mjs        # CLI apply (NEW)
├── lib/
│   ├── validate/                 # NEW
│   │   ├── checks/
│   │   │   ├── location.mjs      # 5 checks
│   │   │   ├── metadata.mjs      # 6 checks
│   │   │   ├── status.mjs        # 3 checks
│   │   │   └── github-sync.mjs   # 4 checks
│   │   ├── rules.mjs
│   │   ├── inference.mjs
│   │   ├── reporter.mjs
│   │   ├── fix-planner.mjs
│   │   ├── fix-applier.mjs
│   │   └── alert-diff.mjs
│   └── (existing: clickup-client, sprint-detector, etc.)
├── config/
│   ├── service.json              # (modified: add validation settings)
│   ├── validation-rules.json     # NEW
│   └── prefix-mapping.json       # NEW
├── data/
│   └── validation/
│       ├── latest.json
│       ├── report-YYYY-MM-DD.md
│       ├── fix-plan-YYYY-MM-DD.md
│       ├── fix-applied-history.json
│       └── plans-archive/
├── test/
│   └── validate/                 # NEW
│       ├── checks/
│       │   ├── location.test.mjs
│       │   ├── metadata.test.mjs
│       │   ├── status.test.mjs
│       │   └── github-sync.test.mjs
│       ├── inference.test.mjs
│       ├── fix-planner.test.mjs
│       └── alert-diff.test.mjs
└── run.sh                        # (modified: add 'validate' mode)
```

### knowledge-hub (expansion)
```
services/knowledge-hub/
├── lib/
│   └── validation-proxy.mjs      # NEW: file reader + CLI spawner
├── dashboard/
│   ├── validation.html           # NEW: SPA page
│   ├── validation.js             # NEW: validation UI logic
│   └── (existing: index.html, graph.js, etc.)
└── lib/server.mjs                # (modified: add /validation/* routes)
```

### Cron entry
```
# Daily validation (runs before 08:00 followup)
0 8 * * * bash run.sh validate >> logs/cron.log 2>&1
```

---

## 9. Testing Strategy

**Unit tests (pure, TDD):**
- Each check in `checks/*.mjs` — minimum 3 tests (happy, edge, no-issue)
- `inference.mjs` — prefix mapping coverage
- `fix-planner.mjs` — plan generation with mixed severities
- `alert-diff.mjs` — new vs resolved vs unchanged
- `rules.mjs` — config loading + validation

Target: ~40 tests total.

**Integration (smoke tests, manual):**
- `fix-applier.mjs` — manual dry-run against test workspace
- `reporter.mjs` — verify MD/JSON output formatting
- `validation-proxy.mjs` (knowledge-hub) — spawn CLI and capture output
- Dashboard — load validation.html, click through flows

**No unit tests for:**
- ClickUp API client (already tested in sprint-agents main suite)
- Markdown/JSON file I/O (trivial)
- HTTP routes (integration only)

---

## 10. Deploy

- **Path:** `/opt/jarvis-sprint-agents/` (existing) + `/opt/jarvis-knowledge-hub/` (existing)
- **New cron:** `0 8 * * * bash /opt/jarvis-sprint-agents/run.sh validate`
- **Environment:** reuses existing `CLICKUP_TOKEN`, `GCP_SERVICE_ACCOUNT_KEY` env vars
- **Secrets:** none new
- **Health-monitor integration:** new service entry `sprint-agents-validate` with 24h cadence
- **Logs:** `/opt/jarvis-sprint-agents/logs/validate-{date}.log`

---

## 11. Scope Boundaries

### In scope (v1)
- 18 checks across 4 categories
- Daily run + Google Chat alert for critical
- JSON + Markdown reports
- Fix-plan generation with 7 auto-fixable check types
- Dashboard validation tab with Apply button
- Latest-only apply rule
- Fix-applied history tracking
- Prefix-based inference for location fixes

### Out of scope (v2)
- **Category 5** — Naming conventions (prefix-missing, name-too-short, etc.)
- **Category 6** — Sprint hygiene (empty-sprint, overloaded-assignee, etc.)
- **Category 7** — Relationships (subtask-project-mismatch, circular-dependency)
- **Category 8** — Stale/abandonment (no-comments-30d, assignee-not-member)
- **Category 9** — Compliance (financial values, credentials, PII detection)
- **Category 10** — Custom field consistency (product-folder-mismatch, etc.)
- Auto-fix expanded to more check types
- Comment-based approval (ClickUp comments as approval channel)
- Integration with JARVIS chat-bot ("@jarvis validate")
- Trending charts (issues over time)
- Batch operations (select N tasks, apply same mutation)
