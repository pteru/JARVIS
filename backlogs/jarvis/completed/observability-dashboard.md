# Spec: Observability Dashboard — Implementation Plan

**Status:** Idea
**Type:** Standalone web UI (local)
**Parent Spec:** [orchestrator-dashboard.md](orchestrator-dashboard.md)

## Overview

This is the concrete implementation plan for the Orchestrator Dashboard spec. The dashboard will provide live and historical visibility into orchestrator activity, resource consumption, and health. It will be built as a lightweight local web application with a phased rollout: v1 (static read-only), v2 (live updates), v3 (advanced analytics).

The implementation leverages existing data sources (`logs/`, `config/`, `backlogs/`) and introduces new logging schemas to capture token usage and dispatch lifecycle events.

---

## Design

### Tech Stack

**Backend:**
- **Node.js + Express** (v18+) — minimal HTTP server for file serving and API endpoints
- **File System Watchers** (`fs.watch` or `chokidar`) — detect changes to logs and configs
- **Server-Sent Events (SSE)** — push live updates to frontend without WebSockets complexity

**Frontend:**
- **Vanilla HTML/CSS/JavaScript** — no build tooling required for v1
- **Chart.js** (CDN-loaded) — zero-dependency charting library
- **Tailwind CSS** (CDN-loaded, optional) — utility-first styling for rapid UI development
- **Alpine.js** (CDN-loaded, optional) — lightweight reactive framework for interactive panels

**Data Storage:**
- **JSON files only** — no database required (follows orchestrator's file-based architecture)
- All data sources already exist or will be created as part of this implementation

**Deployment:**
- Runs on `localhost:3000` (configurable port)
- Started via `npm run dashboard` from `/home/teruel/JARVIS/`
- No authentication required for v1 (local-only access)

---

## Data Sources & Schemas

### 1. Dispatch Log — `/home/teruel/JARVIS/logs/dispatches.json`

**Current Status:** Does not exist yet. Must be created by task-dispatcher MCP server.

**Schema:**
```json
{
  "dispatches": [
    {
      "id": "uuid-v4",
      "timestamp": "2026-02-15T14:30:00.000Z",
      "workspace": "strokmatic.diemaster.services.smartdie-back-end",
      "task": {
        "description": "Fix authentication timeout in login flow",
        "complexity": "medium",
        "priority": "high",
        "source": "backlog"
      },
      "model": "claude-sonnet-4-5-20250929",
      "status": "completed",
      "started_at": "2026-02-15T14:30:00.000Z",
      "completed_at": "2026-02-15T14:45:12.000Z",
      "duration_seconds": 912,
      "result": {
        "success": true,
        "files_changed": 3,
        "tests_passed": true,
        "changelog_updated": true,
        "error": null
      }
    }
  ]
}
```

**Status Values:** `pending`, `running`, `completed`, `failed`

### 2. Usage Log — `/home/teruel/JARVIS/logs/usage.json`

**Current Status:** Does not exist. Must be created during dispatch execution.

**Schema:**
```json
{
  "usage": [
    {
      "dispatch_id": "uuid-v4",
      "timestamp": "2026-02-15T14:45:12.000Z",
      "workspace": "strokmatic.diemaster.services.smartdie-back-end",
      "model": "claude-sonnet-4-5-20250929",
      "tokens": {
        "input": 12450,
        "output": 3200,
        "total": 15650
      },
      "cache": {
        "read": 8500,
        "write": 1200
      },
      "cost_usd": 0.234
    }
  ]
}
```

**Cost Calculation:** Based on pricing table in `/home/teruel/JARVIS/config/orchestrator/pricing.json` (new file).

### 3. Workspace Config — `/home/teruel/JARVIS/config/orchestrator/workspaces.json`

Already exists. Used for workspace metadata (name, category, priority).

### 4. Schedules Config — `/home/teruel/JARVIS/config/orchestrator/schedules.json`

Already exists. Used to display upcoming scheduled tasks.

### 5. Models Config — `/home/teruel/JARVIS/config/orchestrator/models.json`

Already exists. Used for model selection context.

### 6. Backlog Files — `/home/teruel/JARVIS/backlogs/*.md`

**Current Status:** Does not exist yet. Will be created by backlog-manager MCP server.

**Purpose:** Parse markdown to extract pending task counts per workspace.

**Example Structure:**
```markdown
# Backlog: strokmatic.diemaster.services.smartdie-back-end

## High Priority
- [ ] Fix authentication timeout in login flow
- [ ] Add rate limiting to API endpoints

## Medium Priority
- [ ] Refactor database connection pooling
```

**Parsing Logic:** Count unchecked `- [ ]` items under each priority heading.

### 7. Changelog Files — `/home/teruel/JARVIS/changelogs/*.md`

**Current Status:** Does not exist yet. Will be created by changelog-writer MCP server.

**Purpose:** Parse to determine completion history and recent activity.

**Example Structure:**
```markdown
# Changelog: strokmatic.diemaster.services.smartdie-back-end

## 2026-02-15

### Fixed
- Authentication timeout in login flow (#123)

### Added
- Rate limiting middleware to all API routes
```

**Parsing Logic:** Count entries under each date to build activity timeline.

---

## Implementation Steps

### Phase 1: Foundation (v1 — Static Dashboard)

**Goal:** Read-only dashboard displaying historical data from JSON logs.

**Tasks:**

1. **Create dashboard directory structure**
   ```
   /home/teruel/JARVIS/dashboard/
   ├── server.js          # Express server with SSE support
   ├── public/
   │   ├── index.html     # Main dashboard page
   │   ├── style.css      # Custom styles
   │   ├── app.js         # Frontend logic
   │   └── lib/
   │       └── (empty)    # CDN resources loaded via <script> tags
   ├── parsers/
   │   ├── backlogs.js    # Parse backlog markdown files
   │   ├── changelogs.js  # Parse changelog markdown files
   │   └── schedules.js   # Parse schedule configs
   ├── package.json       # Dependencies: express, chokidar
   └── README.md          # Setup and run instructions
   ```

2. **Initialize Node.js project**
   ```bash
   cd /home/teruel/JARVIS/dashboard
   npm init -y
   npm install express chokidar
   ```

3. **Create Express server (`server.js`)**
   - Serve static files from `public/`
   - Expose API endpoints:
     - `GET /api/dispatches` — return `logs/dispatches.json`
     - `GET /api/usage` — return `logs/usage.json`
     - `GET /api/workspaces` — return `config/orchestrator/workspaces.json`
     - `GET /api/schedules` — return parsed schedule data
     - `GET /api/backlogs` — return parsed backlog summaries
     - `GET /api/changelogs` — return parsed changelog activity
   - Add CORS headers for localhost development

4. **Build frontend HTML structure (`public/index.html`)**
   - Use semantic HTML5 structure
   - CDN imports:
     ```html
     <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
     <script src="https://cdn.jsdelivr.net/npm/alpinejs@3"></script>
     <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css" rel="stylesheet">
     ```
   - Panel containers for all 10 features from spec

5. **Implement data parsers**
   - `parsers/backlogs.js`: Read all `.md` files in `backlogs/`, parse markdown, count unchecked tasks by priority
   - `parsers/changelogs.js`: Read all `.md` files in `changelogs/`, extract date sections, count entries per day
   - `parsers/schedules.js`: Read `config/orchestrator/schedules.json`, calculate next execution times

6. **Build frontend panels (static data)**
   - Panel 1: Scheduled Tasks — table with task name, next run time, countdown
   - Panel 2: Currently Running Tasks — table (empty in v1, data source not yet populated)
   - Panel 3: Plan Usage — progress bars for session and weekly token limits (hardcoded limits for v1)
   - Panel 4: Model Usage Breakdown — pie chart using Chart.js
   - Panel 5: Token Usage Over Time — line chart with filter controls
   - Panel 6: Backlog Health — per-workspace task count + age of oldest task
   - Panel 7: Task History & Results — paginated table with search/filter
   - Panel 8: Workspace Activity Heatmap — GitHub-style calendar grid
   - Panel 9: Cost Estimator — summary cards for session/week/month, burn rate calculation
   - Panel 10: Alerts & Anomalies — color-coded alert cards

7. **Add orchestrator launch script**
   - Create `scripts/start-dashboard.sh`:
     ```bash
     #!/bin/bash
     cd /home/teruel/JARVIS/dashboard
     node server.js
     ```
   - Make executable: `chmod +x scripts/start-dashboard.sh`
   - Add to orchestrator README

8. **Create pricing config**
   - File: `/home/teruel/JARVIS/config/orchestrator/pricing.json`
   - Schema:
     ```json
     {
       "models": {
         "claude-haiku-4-5-20251001": {
           "input_per_1m": 0.25,
           "output_per_1m": 1.25,
           "cache_write_per_1m": 0.30,
           "cache_read_per_1m": 0.025
         },
         "claude-sonnet-4-5-20250929": {
           "input_per_1m": 3.00,
           "output_per_1m": 15.00,
           "cache_write_per_1m": 3.75,
           "cache_read_per_1m": 0.30
         },
         "claude-opus-4-5-20251101": {
           "input_per_1m": 15.00,
           "output_per_1m": 75.00,
           "cache_write_per_1m": 18.75,
           "cache_read_per_1m": 1.50
         }
       },
       "last_updated": "2026-02-15"
     }
     ```

9. **Test with mock data**
   - Create sample `logs/dispatches.json` with 20 example dispatches
   - Create sample `logs/usage.json` with corresponding usage records
   - Verify all panels render correctly

**Deliverable:** Functional read-only dashboard accessible at `http://localhost:3000`

---

### Phase 2: Live Updates (v2)

**Goal:** Real-time data updates without manual refresh.

**Tasks:**

1. **Add Server-Sent Events endpoint**
   - Route: `GET /api/stream`
   - Use `chokidar` to watch:
     - `logs/dispatches.json`
     - `logs/usage.json`
     - `config/orchestrator/workspaces.json`
   - On file change, push SSE event to all connected clients

2. **Update frontend to consume SSE**
   - Replace static data fetch with SSE listener
   - Update panels reactively when new events arrive
   - Add connection status indicator (green = connected, red = disconnected)

3. **Add live log tailing for running tasks**
   - New endpoint: `GET /api/dispatches/:id/logs`
   - Stream tail of dispatch log file (if task-dispatcher writes per-dispatch logs)
   - Display in "Currently Running Tasks" panel

4. **Add auto-refresh for schedule countdown**
   - JavaScript interval timer to update "time until next run" every second
   - Highlight tasks that are due to run within 5 minutes

**Deliverable:** Dashboard updates automatically when logs change.

---

### Phase 3: Advanced Analytics (v3)

**Goal:** Deeper insights, historical trends, and predictive features.

**Tasks:**

1. **Add date range filters**
   - UI controls to select custom date ranges for all charts
   - Store filter state in URL query params for shareability

2. **Implement workspace comparison view**
   - Side-by-side comparison of 2-4 selected workspaces
   - Metrics: task completion rate, token usage, cost, activity frequency

3. **Add anomaly detection**
   - Flag dispatches that:
     - Exceeded 2x median duration for same workspace + complexity
     - Used >80% of daily token allowance in one dispatch
     - Failed after previously succeeding for same task type
   - Display anomalies in dedicated alerts panel

4. **Build trend analysis**
   - Week-over-week comparison for:
     - Total tasks completed
     - Token consumption
     - Cost
   - Sparkline charts for quick visual trends

5. **Add export functionality**
   - Export filtered dispatch history as CSV
   - Export usage summary as JSON for external analysis tools

6. **Introduce caching layer**
   - Cache parsed backlog/changelog data in memory
   - Invalidate cache when source files change
   - Reduces file I/O for large workspace sets

**Deliverable:** Production-ready dashboard with advanced analytics.

---

## MCP Tool Interface

The dashboard does NOT require a new MCP server. However, it depends on tools from existing MCP servers:

### Required Updates to Existing MCP Servers

**1. task-dispatcher MCP Server**

Add lifecycle hooks to write dispatch records:

- **On dispatch start:** Append entry to `logs/dispatches.json` with `status: "running"`
- **On dispatch complete:** Update entry with `status: "completed"`, `completed_at`, `result`
- **On dispatch fail:** Update entry with `status: "failed"`, `error` message

Capture usage data:

- **Parse Claude API response** to extract token counts (input, output, cache read/write)
- **Append to `logs/usage.json`** with calculated cost
- **Store dispatch ID** to link usage to specific tasks

**2. backlog-manager MCP Server**

Ensure backlog files are written to:
- `/home/teruel/JARVIS/backlogs/<workspace-slug>.md`

Format must be parseable:
- Use `- [ ]` for pending tasks
- Use `## <Priority>` headings
- Include task creation timestamps if possible

**3. changelog-writer MCP Server**

Ensure changelog files are written to:
- `/home/teruel/JARVIS/changelogs/<workspace-slug>.md`

Follow Keep a Changelog format strictly:
- `## YYYY-MM-DD` date headers
- `### Added`, `### Changed`, `### Fixed` section headers

---

## Edge Cases & Risks

### 1. Missing Log Files

**Problem:** Dashboard crashes if `logs/dispatches.json` doesn't exist yet.

**Solution:**
- Dashboard server checks for file existence on startup
- If missing, create empty file with `{ "dispatches": [] }` structure
- Display "No data yet" message in panels

### 2. Large Log Files

**Problem:** `dispatches.json` grows unbounded, causing slow parsing.

**Solution:**
- Implement log rotation: archive entries older than 90 days to `logs/archive/dispatches-YYYY-MM.json`
- Dashboard reads both active and archived logs
- Add config option to limit dashboard history depth (default: 30 days)

### 3. Concurrent Writes

**Problem:** Multiple dispatches writing to `dispatches.json` simultaneously could corrupt file.

**Solution:**
- Use file locking library (`proper-lockfile` npm package) in task-dispatcher
- Implement retry logic with exponential backoff

### 4. Pricing Changes

**Problem:** Anthropic updates API pricing, dashboard shows incorrect costs.

**Solution:**
- Store `pricing.json` with `last_updated` timestamp
- Dashboard checks if pricing is >30 days old, displays warning banner
- Operator updates pricing manually when notified
- Future: scrape pricing from Anthropic docs (requires WebFetch tool)

### 5. Timezone Handling

**Problem:** Logs stored in UTC, operator in different timezone.

**Solution:**
- All timestamps stored in ISO 8601 format with UTC timezone
- Frontend converts to local timezone using `Intl.DateTimeFormat`
- Display timezone abbreviation next to timestamps

### 6. Browser Compatibility

**Problem:** Older browsers may not support SSE or modern JavaScript.

**Solution:**
- Add feature detection for SSE support
- Fallback to polling every 5 seconds if SSE unavailable
- Target Chrome 90+, Firefox 88+, Safari 14+ (all support required features)

### 7. Port Conflicts

**Problem:** Port 3000 already in use by another service.

**Solution:**
- Make port configurable via environment variable `DASHBOARD_PORT`
- Default to 3000, auto-increment if unavailable
- Log actual port to console on startup

---

## Dependencies & Prerequisites

### Infrastructure

1. **Node.js 18+ installed** at `/home/teruel/JARVIS/dashboard/`
2. **Logs directory exists:** `/home/teruel/JARVIS/logs/`
3. **Config directory exists:** `/home/teruel/JARVIS/config/orchestrator/`
4. **Backlog directory created:** `/home/teruel/JARVIS/backlogs/`
5. **Changelog directory created:** `/home/teruel/JARVIS/changelogs/`

### Data Sources

1. **task-dispatcher MCP server updated** to write `logs/dispatches.json` and `logs/usage.json`
2. **backlog-manager MCP server** writes backlogs to `backlogs/*.md`
3. **changelog-writer MCP server** writes changelogs to `changelogs/*.md`
4. **Pricing config created:** `/home/teruel/JARVIS/config/orchestrator/pricing.json`

### External Dependencies

- **npm packages:**
  - `express` — HTTP server
  - `chokidar` — File watching
  - `proper-lockfile` — File locking (for concurrent writes)
- **CDN resources (loaded at runtime):**
  - Chart.js 4.x
  - Alpine.js 3.x
  - Tailwind CSS 3.x (optional)

---

## Phased Rollout Timeline

| Phase | Description | Estimated Effort | Target Date |
|-------|-------------|------------------|-------------|
| **v1** | Static dashboard with manual refresh | 2-3 days | Week 1 |
| **v2** | Live updates via SSE | 1 day | Week 2 |
| **v3** | Advanced analytics and export | 2-3 days | Week 3-4 |

**Critical Path:**
1. Update task-dispatcher to write logs (prerequisite for all phases)
2. Create pricing config (prerequisite for cost estimator)
3. Build v1 dashboard (foundation for v2/v3)

---

## Testing Strategy

### Unit Tests
- Test log file parsers with edge cases (empty files, malformed JSON, missing fields)
- Test pricing calculator with various token counts and models

### Integration Tests
- Start dashboard server, verify all API endpoints return expected data
- Simulate file changes, verify SSE events are emitted

### Manual Testing
- Verify dashboard renders correctly on Chrome, Firefox, Safari
- Test with 0 dispatches, 1 dispatch, 1000 dispatches
- Test with missing log files, empty log files, corrupted log files
- Test timezone conversion for operator in UTC-8, UTC+2, UTC+5:30

### Performance Testing
- Benchmark dashboard load time with 10,000 dispatch records
- Measure memory usage during 24-hour SSE connection

---

## Future Enhancements (Post-v3)

1. **Export to ClickUp:** Sync dispatch failures to ClickUp as tasks (requires ClickUp Connector spec)
2. **Mobile responsive design:** Optimize UI for tablet/phone viewing
3. **Dark mode:** Add theme toggle for low-light environments
4. **Custom alerts:** Let operator define custom alert rules via config file
5. **Model performance leaderboard:** Rank models by success rate, avg duration, cost-per-task
6. **Workspace recommendations:** Suggest which workspaces need attention based on backlog growth rate

---

## Success Criteria

- [ ] Dashboard accessible at `http://localhost:3000` without errors
- [ ] All 10 panels from spec are implemented and functional
- [ ] Dashboard updates within 3 seconds of log file changes (v2)
- [ ] Supports 100+ workspaces without performance degradation
- [ ] Cost calculations accurate within $0.01 of actual API billing
- [ ] No crashes with missing/corrupted log files
- [ ] Documentation includes setup and troubleshooting guide
