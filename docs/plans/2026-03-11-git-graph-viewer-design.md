# Git Graph Viewer — Design Document

**Date:** 2026-03-11
**Author:** JARVIS + Pedro Teruel
**Status:** Approved
**Location:** New tab in orchestrator dashboard (`localhost:8090/git.html`)

---

## Overview

An interactive, multi-workspace git visualization tool integrated into the JARVIS orchestrator dashboard. Provides a comprehensive view of branch states, commit history, merge topology, sync status, and cross-repo activity across all 98 registered workspaces.

### Existing Tooling (What This Replaces)

- `scripts/workspace-git-analysis.sh` — static markdown report generator (branch, dirty, sync per workspace)
- `reports/workspace-git-analysis.md` — output of above (last run 2026-03-05)
- `mcp-servers/workspace-analyzer/` — only counts uncommitted changes

The new viewer replaces the static report with a live, interactive dashboard and adds commit graph visualization, branch comparison, and cross-repo timeline — features that don't exist today.

### Why Custom (Not Off-the-Shelf)

No existing open-source tool handles this use case:
- **git-dashboard** (kojung): CLI-only, basic status
- **gat Graph**: Web-based but single-repo, hosted service, public repos only
- **GitGraph.js**: Archived, illustrative diagrams only (not real topology)
- **Mermaid gitGraph**: Static, no interactivity
- **Grafana + GitHub plugin**: Heavy infra, can't see local state (uncommitted changes, local branches)
- **GitHub Repository Dashboard**: GitHub-hosted, no local workspace awareness

---

## Architecture

### Tech Stack

- **Backend:** Express.js (existing `server.js` in `tools/orchestrator-dashboard/`)
- **Frontend:** Vanilla JS + D3.js (SVG commit graphs) + Tailwind CSS (dark theme)
- **Data:** Direct `git` CLI calls via `child_process.execFile` (no shell injection)
- **CDN deps:** D3.js v7 (same CDN pattern as Chart.js in existing dashboard)

### New Files

```
tools/orchestrator-dashboard/
  parsers/git-status.js       # Git data collection module
  public/
    git.html                  # Standalone page (linked from main dashboard header)
    git-app.js                # Overview grid + D3 graph + timeline logic
    git-graph.js              # D3.js DAG rendering engine
```

### API Endpoints (Added to server.js)

| Endpoint | Method | Purpose | Cache TTL |
|----------|--------|---------|-----------|
| `/api/git/overview` | GET | All workspaces: branch, status, sync, last commit | 60s |
| `/api/git/workspace/:name` | GET | Full commit DAG for one workspace | 30s |
| `/api/git/compare/:name` | GET | Branch-vs-branch diff (`?base=X&head=Y`) | 30s |
| `/api/git/timeline` | GET | Cross-repo commits (`?since=30d`) | 60s |

---

## View 1: Overview Grid

The landing view when opening `git.html`.

### Top Bar
- Product filter buttons: All | DieMaster | SpotFusion | VisionKing | SDK
- Search box (filters by workspace name, branch name)
- Refresh button (clears cache, re-scans)
- "Last scanned: Xs ago" timestamp

### Summary Stats (4 Cards)
- Total Workspaces
- Dirty Repos (red if > 0)
- Feature Branches (count of non-main/develop branches)
- Sync Issues (count of ahead/behind tracking)

### Workspace Table (Collapsible Product Groups)

Each product is a collapsible section with a header showing summary:
> **DieMaster (18)** — 3 dirty, 2 feature branches, 1 sync issue

Expanded rows show:

| Column | Content | Styling |
|--------|---------|---------|
| Workspace | Short name (e.g., `services.backend`) | Clickable |
| Branch | Current branch name | Color-coded: master=gray, develop=blue, feat=green, fix=amber, hotfix=red |
| Master | Checkmark if exists | |
| Develop | Checkmark if exists | |
| Status | clean / dirty | Green/red badge |
| Sync | In sync / ↑N ↓M | Green check or yellow text |
| Last Commit | Date | Fades: white(today) → yellow(>7d) → red(>30d) |
| Message | Truncated commit message | Tooltip with full message |

Click a row → opens the Detail Panel.

### Data Source

```javascript
// GET /api/git/overview
// For each workspace in workspaces.json:
git -C <path> branch --show-current
git -C <path> status --porcelain | head -1   // dirty check
git -C <path> rev-list --left-right --count @{upstream}...HEAD
git -C <path> log -1 --format='%H|%aI|%an|%s'
git -C <path> rev-parse --verify master/main/develop
git -C <path> branch -a --format='%(refname:short)'
```

Parallelized: 10 concurrent workspace scans via Promise pool. Expected ~5-8s for 98 repos.

---

## View 2: Detail Panel (Single Workspace)

Slides in from the right (~70% width) when clicking a workspace row. Overview remains visible on the left.

### Header
- Workspace full name, product badge
- Current branch, remote URL (clickable if GitHub)
- Dirty/clean status, sync status
- Close button (X) or Escape key

### Branch Selector (Left Sidebar Within Panel)

Vertical list of all local + remote branches:
- Name, last commit date, ahead/behind tracking
- Click to highlight in the graph
- Select 2 branches → "Compare" button appears
- Current branch pre-highlighted

### Commit Graph (Main Area)

D3.js SVG rendering of the commit DAG:

- **Lanes:** Each branch gets a vertical column, color-coded (consistent with overview colors)
- **Nodes:** Circle for each commit. Regular commits = small (6px), merge commits = larger (8px)
- **Edges:** Lines connecting child → parent(s). Straight within a lane, curved for cross-lane merges
- **Labels:** Branch name tags at branch tips, tag labels on tagged commits
- **Scroll:** Vertical (most recent at top), infinite scroll loads more history
- **Zoom & Pan:** Mouse wheel zoom, drag to pan
- **Hover:** Shows tooltip with full SHA, author, date, full message
- **Click:** Expands commit detail (changed files count, full message)

### DAG Data Structure

```json
{
  "nodes": [
    {
      "sha": "abc123...",
      "parents": ["def456..."],
      "author": "pedro",
      "date": "2026-03-11T10:30:00-03:00",
      "message": "feat: add stress test fixtures",
      "refs": ["HEAD -> feat/stress-test", "origin/feat/stress-test"]
    }
  ],
  "branches": [
    { "name": "develop", "sha": "...", "isRemote": false, "tracking": "origin/develop", "ahead": 0, "behind": 0 },
    { "name": "origin/develop", "sha": "...", "isRemote": true }
  ],
  "tags": [
    { "name": "v1.0.0", "sha": "..." }
  ]
}
```

### Data Source

```javascript
// GET /api/git/workspace/:name
git -C <path> log --all --format='%H|%P|%an|%aI|%D|%s' --topo-order
git -C <path> branch -a --format='%(refname:short)|%(objectname:short)|%(upstream:short)|%(upstream:track,nobracket)'
git -C <path> tag --list --format='%(refname:short)|%(objectname:short)'
```

Parsed server-side into the DAG structure. Expected <1s for most repos.

---

## View 3: Branch Comparison

Triggered by selecting 2 branches in the branch selector and clicking "Compare".

### Layout (Replaces Graph Area Temporarily)

Three-column layout:
- **Left:** "Commits only in `base`" (what base has that head doesn't)
- **Center:** Merge base commit info
- **Right:** "Commits only in `head`" (what head has that base doesn't)

Each commit shows: short SHA, author, date, one-line message.

Summary at top: "develop is 3 commits behind and 5 commits ahead of master"

### Data Source

```javascript
// GET /api/git/compare/:name?base=develop&head=feat/xyz
git -C <path> merge-base <base> <head>
git -C <path> log <base>..<head> --format='%h|%an|%aI|%s'   // ahead
git -C <path> log <head>..<base> --format='%h|%an|%aI|%s'   // behind
```

---

## View 4: Cross-Repo Timeline

Accessible via a "Timeline" toggle in the top bar (switches between Overview Grid and Timeline).

### Visualization

- **Horizontal time axis** (last 30/60/90 days, configurable via dropdown)
- **Vertical swim lanes** per product (DieMaster, SpotFusion, VisionKing, SDK)
- **Commit dots** positioned on the time axis within their product lane
- **Color:** By product (matching product filter colors)
- **Density:** Areas with many commits appear as denser clusters
- **Brush selection:** Drag to zoom into a time range
- **Hover:** Tooltip with workspace, branch, author, message
- **Filters:** By product, author, branch pattern (regex)

### Data Source

```javascript
// GET /api/git/timeline?since=30d
// For each workspace:
git -C <path> log --all --since='30 days ago' --format='%aI|%an|%H|%s'
// Server merges, sorts by date, adds workspace/product metadata
```

Expected ~3-5s for 30 days across 98 repos. Cached 60s.

---

## Performance & Caching Strategy

| Endpoint | Parallelism | Cache | Invalidation |
|----------|-------------|-------|-------------|
| Overview | 10 concurrent git calls | In-memory, 60s TTL | Manual refresh button |
| Workspace detail | Single repo, sequential git calls | In-memory, 30s TTL | Auto-refresh on panel open |
| Compare | 3 git calls for 1 repo | No cache (fast) | N/A |
| Timeline | 10 concurrent, 98 repos | In-memory, 60s TTL | Manual refresh button |

### Error Handling
- Missing `.git` directory → "unavailable" gray badge in overview, skip in timeline
- Git command timeout (>10s per repo) → skip with warning
- Broken repo (corrupt objects) → report error message in overview status column

---

## UI/UX Specifications

### Theme
- Same dark theme as main dashboard: `surface: #1a1b2e`, `card: #242640`, `accent: #6c63ff`
- Same Tailwind config, same badge/card patterns

### Product Colors (Consistent Everywhere)
- DieMaster: `#f59e0b` (amber)
- SpotFusion: `#3b82f6` (blue)
- VisionKing: `#22c55e` (green)
- SDK: `#8b5cf6` (purple)

### Branch Colors (In Commit Graph)
- `master` / `main`: `#6b7280` (gray)
- `develop`: `#3b82f6` (blue)
- `feat/*`: `#22c55e` (green)
- `fix/*`: `#f59e0b` (amber)
- `hotfix/*`: `#ef4444` (red)
- Other: `#8b5cf6` (purple)

### Navigation
- Main dashboard header gets a "Git" link next to the JARVIS logo
- `git.html` header mirrors the main dashboard header style
- Back link to main dashboard

### Responsive
- Desktop-first (primary use case is LAN desktop)
- Minimum width: 1200px for full graph view
- Overview table is horizontally scrollable on smaller screens

---

## Dependencies

### Backend (Node.js)
- No new npm packages. Uses built-in `child_process.execFile` for git commands.
- New parser module follows same pattern as existing `parsers/dispatches.js`.

### Frontend (CDN)
- **D3.js v7**: `https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js` (same CDN as Chart.js)
- Tailwind CSS (existing)
- Chart.js (existing, not needed for git page)

---

## Out of Scope (Future Enhancements)

- File-level diff viewer (show actual code changes per commit)
- Git operations from the UI (checkout, pull, push, merge)
- Webhooks / auto-refresh on git events
- Stale branch cleanup automation
- Integration with PR inbox (link commits to open PRs)
