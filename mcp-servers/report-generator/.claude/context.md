# Report Generator

## Purpose
Generates daily, weekly, and workspace-specific activity reports by aggregating changelog entries across workspaces. Produces markdown reports with summaries of active workspaces and task counts, saved to the reports directory.

## MCP Tools
- **generate_daily_report** — Generate a daily activity report across all workspaces for a given date (defaults to today), summarizing task counts and changelog entries
- **generate_weekly_report** — Generate a weekly summary report for the week ending on a specified date (defaults to last Friday)
- **generate_workspace_report** — Generate a detailed report for a specific workspace over a configurable timeframe (day/week/month)

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk
- Uses `ORCHESTRATOR_HOME` env var directly (not the shared config-loader)

## Configuration
- Changelogs directory: `changelogs/` (reads `*-changelog.md` files)
- Report output: `reports/daily-<date>.md`, `reports/weekly-<date>.md`
- Requires `ORCHESTRATOR_HOME` environment variable

## Integration Points
- Reads changelog files maintained by the changelog-writer MCP server
- Daily/weekly reports are used by the morning report script and Telegram notifications
- Workspace reports can inform task prioritization

## Key Files
- `index.js` — Single-file server with report generation and markdown formatting
