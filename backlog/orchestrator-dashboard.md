# Spec: Orchestrator Dashboard

**Status:** Idea
**Type:** Standalone web UI (local)
**ClickUp ID:** _(not yet created)_

## Overview

A local web dashboard providing live and historical visibility into the orchestrator's activity, resource consumption, and health. Intended for daily use by the operator to understand what the system is doing, how much it's consuming, and where to focus attention.

---

## Panels & Features

### 1. Scheduled Tasks
- List of all upcoming cron-scheduled runs with next execution time
- Source: `config/schedules.json` + system crontab
- Shows: task name, target workspaces, time until next run, last run result (success / failed / skipped)

### 2. Currently Running Tasks
- Live view of in-progress dispatches
- Source: `logs/dispatches.json` (status = `running`)
- Shows: workspace, task description, model in use, elapsed time, live log tail if available

### 3. Plan Usage — Session & Weekly
- API usage against known plan limits
- **By session**: tokens used in the current Claude Code session
- **By week**: rolling 7-day total vs. weekly allowance
- Visual indicator: green / amber / red based on % consumed
- Source: usage logs from Claude API responses (to be captured in a new `logs/usage.json`)

### 4. Model Usage Breakdown
- How many tasks and tokens were consumed per model
- Shown as a summary table and a proportional bar or pie chart
- Models: Haiku, Sonnet, Opus
- Filters: by date range, by workspace

### 5. Token Usage Over Time
- Time-series graph (line or area chart) of token consumption
- **Filters:**
  - By model (Haiku / Sonnet / Opus)
  - By task (individual dispatch)
  - By workspace
  - By date range (day / week / month / custom)
- Secondary axis or stacked view for input vs. output tokens

---

## Suggested Additional Panels

### 6. Backlog Health
- Pending task count per workspace, broken down by priority (high / medium / low)
- Age of oldest pending task (flag tasks that have been waiting too long)
- Completion rate: tasks dispatched vs. tasks completed in the last 7 days

### 7. Task History & Results
- Paginated log of all past dispatches with outcome (completed / failed / pending)
- Searchable and filterable by workspace, model, complexity, date
- Click to expand full task prompt and result summary

### 8. Workspace Activity Heatmap
- Calendar-style heatmap (GitHub-style) showing dispatch frequency per day
- Switchable between: all workspaces combined, or per-workspace view
- Helps identify idle periods and overloaded days

### 9. Cost Estimator
- Estimated cost in USD based on token usage and current public API pricing per model
- Shows: cost this session, this week, this month
- Burn rate: projected monthly cost based on recent daily average
- Note: pricing table should be configurable (update when Anthropic changes rates)

### 10. Alerts & Anomalies Panel
- Highlights that require operator attention:
  - Tasks that failed in the last run
  - Workspaces with no activity in N days (configurable threshold)
  - Plan usage approaching limit (>80%)
  - Dispatch queue growing faster than it is being cleared

---

## Technical Approach

- **Stack:** Lightweight local web server (e.g. Node + a minimal UI framework, or a Python + FastAPI + HTMX approach)
- **Data sources:**
  - `logs/dispatches.json` — task history and status
  - `logs/usage.json` — token/model usage per dispatch (new log to be introduced)
  - `config/schedules.json` + crontab — scheduled task info
  - `config/workspaces.json` — workspace metadata
  - `backlogs/*.md` — pending task counts
- **Refresh:** polling or file-watch based live updates; no database required initially
- **Access:** localhost only, no authentication needed for v1
- **Deployment:** started via `co-dashboard` alias or as part of the install

## Dependencies & Prerequisites

- `logs/usage.json` schema must be defined and populated by the task-dispatcher MCP server during execution
- Token capture requires either Claude API usage metadata from responses or a proxy layer — implementation path TBD

## Implementation Notes

- Start with a static HTML read of the JSON logs (no server needed for v1)
- Introduce a live-refresh server in v2 once data sources are stable
- Charts: prefer a zero-dependency or CDN-loaded library (e.g. Chart.js) to avoid heavy build tooling
- All time displays in the operator's local timezone
