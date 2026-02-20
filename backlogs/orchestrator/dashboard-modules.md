# Dashboard Modular Sidenav — Restructured Orchestrator Dashboard

## Summary

Restructure the current single-page orchestrator dashboard (`dashboard/`) into a modular layout with a sidenav containing separate tabs for each tool/domain. A General tab provides a summarized overview of everything, while dedicated tabs (PR Review, Health Check, Dispatches, Backlogs, Changelog) show detailed views. Alert badges on tab icons notify when there are pending or new actions requiring attention.

## Problem Statement

The current orchestrator dashboard (`dashboard/server.js` + `public/`) is a single long page with all panels stacked vertically:
- 11 data panels on one page — overwhelming, no hierarchy
- No way to focus on a specific tool (PR reviews vs health checks vs dispatches)
- No notification of which areas need attention — user must scroll through everything
- No client-side routing — everything renders on page load
- The PMO Dashboard (`tools/pmo-dashboard/`) has proper routing and tabs, but is separate

The goal is to bring the orchestrator dashboard up to the same quality as the PMO Dashboard, with focused views and proactive alerting.

## Architecture

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  JARVIS Orchestrator                              [user] [gear]  │
├──────────┬───────────────────────────────────────────────────────┤
│          │                                                       │
│ [*] Gen  │  ┌─────────────────────────────────────────────────┐  │
│          │  │  Main Content Area                              │  │
│ [!] PRs  │  │                                                 │  │
│          │  │  (changes based on selected sidenav tab)        │  │
│ [*] VK   │  │                                                 │  │
│  Health  │  │  General: 4 stat cards + mini panels            │  │
│          │  │  PR Review: full PR inbox table + review status │  │
│ [ ] Disp │  │  Health: VK 03002 dashboard + trends            │  │
│          │  │  Backlogs: per-workspace backlog health          │  │
│ [ ] Back │  │  Changelog: recent changes across workspaces    │  │
│  logs    │  │  Dispatches: full dispatch table + charts        │  │
│          │  │                                                 │  │
│ [ ] Chan │  └─────────────────────────────────────────────────┘  │
│  gelog   │                                                       │
│          │                                                       │
│ [ ] Disp │                                                       │
│  atches  │                                                       │
│          │                                                       │
├──────────┴───────────────────────────────────────────────────────┤
│  Last refresh: 30s ago   |  Auto-refresh: ON (60s)   [Refresh]  │
└──────────────────────────────────────────────────────────────────┘
```

### Sidenav Tabs

| Tab | Icon | Alert Badge Condition | Data Source |
|-----|------|----------------------|-------------|
| **General** | `pi-home` | Always visible (no badge) | All sources (summarized) |
| **PR Review** | `pi-git-pull-request` | Unreviewed PRs > 0 OR PRs open > 3 days | `reports/pr-inbox.json` + `reports/pr-reviews/` |
| **VK Health** | `pi-heart-pulse` | Any severity >= WARNING in latest report | `reports/vk-health/03002/latest.md` |
| **Dispatches** | `pi-bolt` | Failed dispatches in last 24h > 0 | `logs/dispatches.json` |
| **Backlogs** | `pi-list-check` | High-priority tasks > threshold (configurable) | `backlogs/products/*.md` |
| **Changelog** | `pi-history` | (informational, no alert) | `changelogs/strokmatic.*.md` |

### Alert Badge System

```javascript
// Badge states
const BADGE_STATES = {
  none: null,                    // No badge — all clear
  info: { color: '#3b82f6', icon: 'dot' },      // Blue dot — new items
  warning: { color: '#f59e0b', icon: 'number' }, // Amber with count — needs attention
  danger: { color: '#ef4444', icon: '!' }         // Red exclamation — urgent
};

// Per-tab badge rules
function computePrBadge(prData) {
  const unreviewed = prData.filter(pr => !pr.review_decision);
  const stale = prData.filter(pr => daysSince(pr.created_at) > 3);
  if (stale.length > 0) return { state: 'danger', count: stale.length };
  if (unreviewed.length > 0) return { state: 'warning', count: unreviewed.length };
  return { state: 'none' };
}

function computeHealthBadge(latestReport) {
  if (latestReport.includes('CRITICAL')) return { state: 'danger' };
  if (latestReport.includes('WARNING')) return { state: 'warning' };
  return { state: 'none' };
}

function computeDispatchBadge(dispatches) {
  const recentFailed = dispatches.filter(d =>
    d.status === 'failed' && hoursSince(d.completed_at) < 24
  );
  if (recentFailed.length > 0) return { state: 'danger', count: recentFailed.length };
  return { state: 'none' };
}
```

### Tab Content — General Overview

The General tab shows a condensed summary of everything:

```
┌─────────────────────────────────────────────────────┐
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐           │
│  │ 143  │  │  7   │  │  92  │  │ 3/3  │           │
│  │ tasks│  │ PRs  │  │ back │  │ nodes│           │
│  │ done │  │ open │  │ log  │  │ up   │           │
│  └──────┘  └──────┘  └──────┘  └──────┘           │
│                                                     │
│  ┌─ PR Review (mini) ──┐  ┌─ Health (mini) ──────┐ │
│  │ 3 unreviewed PRs    │  │ All systems nominal  │ │
│  │ 1 stale (>3 days)   │  │ vk01: 82% disk      │ │
│  │ Last review: 2h ago │  │ Last check: 12m ago  │ │
│  └─────────────────────┘  └──────────────────────┘ │
│                                                     │
│  ┌─ Recent Dispatches (mini, last 5) ─────────────┐ │
│  │ [complete] visionking - Health check 03002      │ │
│  │ [complete] visionking - Health check 03002      │ │
│  │ [complete] visionking - Health check 03002      │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Backlog Summary ──────────────────────────────┐ │
│  │ DM: 21 pending (2 high)                        │ │
│  │ SF: 27 pending (4 high)                        │ │
│  │ VK: 32 pending (9 high)                        │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

Each mini-panel is clickable → navigates to the full tab.

### Tab Content — PR Review (detailed)

- Full PR table with all columns (repo, title, author, age, size, review status)
- Filter bar: by product, by review status, by age
- Review file viewer: click PR → show review markdown
- Actions: "Open in GitHub", "Run review now"
- Stats: total open, reviewed %, avg review time

### Tab Content — VK Health (detailed)

- Latest health report rendered as formatted HTML
- Trend charts (disk usage over time, queue depth, container restarts)
- Node cards (vk01, vk02, vk03) with traffic-light status
- Alert history (last 7 days)
- Quick actions: "Run health check now", "View raw snapshot"

### Tab Content — Dispatches (detailed)

- Full dispatch table (sortable, filterable)
- Charts: dispatches per day, model usage pie, workspace activity bar
- Status breakdown: completed/failed/partial/running
- Duration histogram
- Filter: by workspace, by model, by status, by date range

### Tab Content — Backlogs (detailed)

- Per-workspace backlog panels with progress bars
- Task list: expandable per workspace, filterable by priority
- Completion trend chart (tasks completed per week)
- High-priority task highlight

### Tab Content — Changelog (detailed)

- Timeline view of recent changes across all workspaces
- Filter by workspace/product
- Grouped by date with section headers (Added, Changed, Fixed, Removed)

### Tech Stack Decision

**Option A — Upgrade existing Express + vanilla JS dashboard:**
- Add client-side routing (hash-based or History API)
- Add sidenav component manually
- Pros: Minimal dependencies, fast
- Cons: More manual work, no component library

**Option B — Migrate to Vue 3 + PrimeVue (same as PMO Dashboard):**
- Rewrite frontend as Vue SPA
- Reuse PrimeVue components (Sidebar, TabMenu, Badge, DataTable)
- Keep Express backend for API
- Pros: Consistent with PMO Dashboard, rich component library, dark theme built-in
- Cons: Migration effort, adds build step (Vite)

**Recommendation: Option B** — consistency with PMO Dashboard is worth the migration cost. Shared component patterns, dark theme, and PrimeVue's Badge/TabMenu/DataTable components directly match the requirements.

### API Enhancements

New/modified endpoints for the modular dashboard:

```
GET /api/overview          → General tab summary (aggregated stats)
GET /api/pr-inbox          → Full PR data (existing, enhanced)
GET /api/pr-inbox/badges   → Badge computation result
GET /api/health/latest     → Latest VK health report + status
GET /api/health/trends     → Time-series data for health metrics
GET /api/health/badges     → Badge computation result
GET /api/dispatches        → Full dispatch data (existing)
GET /api/dispatches/badges → Badge computation result
GET /api/backlogs          → Backlog data (existing, enhanced)
GET /api/backlogs/badges   → Badge computation result
GET /api/changelog         → Changelog entries (existing)
GET /api/badges            → All badge states in one call (for sidenav)
```

The `/api/badges` endpoint returns all badge states in a single call, polled every 60s:

```json
{
  "pr_review": { "state": "warning", "count": 3 },
  "health": { "state": "none" },
  "dispatches": { "state": "danger", "count": 1 },
  "backlogs": { "state": "info" },
  "changelog": { "state": "none" }
}
```

## Complexity Analysis

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Scope** | Medium-Large | Frontend rewrite + new API endpoints + badge system |
| **Risk** | Low | No production impact — dashboard is internal tool |
| **Dependencies** | None | Standalone; reads existing data files |
| **Testing** | Medium | Manual testing + visual verification across all tabs |
| **Maintenance** | Medium | New data sources need new tabs/parsers |

**Overall Complexity: Medium-High**

## Development Phases

### Phase 1 — Vue 3 Migration + Sidenav Shell
**Estimate: 4-5 hours**

1. Set up Vite + Vue 3 + PrimeVue in `dashboard/frontend/`
2. Create sidenav layout with tab icons (PrimeVue Sidebar + Menu)
3. Set up Vue Router with hash-based routing (`#/general`, `#/pr-review`, etc.)
4. Migrate General overview from current `app.js` to Vue component
5. Keep existing Express backend, serve Vue build from `public/`
6. Dark theme configuration (match PMO Dashboard tokens)
7. Verify: sidenav navigation works, General tab shows current data

### Phase 2 — Per-Tool Tabs (PR Review, Health, Dispatches)
**Estimate: 4-5 hours**

1. Create PRReviewView component (full table, filters, review viewer)
2. Create HealthView component (latest report, node cards, trends placeholder)
3. Create DispatchesView component (table, charts, filters)
4. Add new API endpoints where needed (`/api/health/latest`, `/api/overview`)
5. Implement auto-refresh (60s poll, configurable)

### Phase 3 — Remaining Tabs + Badge System
**Estimate: 3-4 hours**

1. Create BacklogsView component (per-workspace panels, progress bars)
2. Create ChangelogView component (timeline, filters)
3. Implement badge computation logic (per-tab rules)
4. Add `/api/badges` endpoint
5. Wire badges into sidenav icons (PrimeVue Badge component)
6. Add badge polling (60s, independent of content refresh)

### Phase 4 — Polish & Integration
**Estimate: 2-4 hours**

1. Add clickable mini-panels on General tab → navigate to full tab
2. Add responsive layout (collapsible sidenav on small screens)
3. Add keyboard shortcuts (1-6 for tab switching)
4. Update `docker-compose` if needed
5. Test all tabs with live data
6. Update orchestrator startup hook to reference new dashboard

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1 — Vue migration + sidenav | 4-5h | None |
| Phase 2 — Tool tabs | 4-5h | Phase 1 |
| Phase 3 — Remaining tabs + badges | 3-4h | Phase 2 |
| Phase 4 — Polish | 2-4h | Phase 3 |
| **Total** | **13-18h** | |

## References

- Current orchestrator dashboard: `dashboard/` (Express + vanilla JS, port 3000)
- PMO Dashboard (reference architecture): `tools/pmo-dashboard/` (Vue 3 + PrimeVue + FastAPI, port 8090)
- PrimeVue components: Badge, Sidebar, TabMenu, DataTable, Chart
- Data sources: `logs/dispatches.json`, `reports/pr-inbox.json`, `reports/vk-health/`, `backlogs/products/`, `changelogs/`
