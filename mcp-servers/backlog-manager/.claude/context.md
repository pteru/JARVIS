# Backlog Manager

## Purpose
Manages per-workspace task backlogs backed by GitHub Issues. Supports listing, adding, and closing issues. GitHub Issues are the source of truth; reads are served from a local JSON cache at `data/backlog-cache/`, refreshed by `orchestrator.sh refresh-backlog-cache`.

## MCP Tools
- **list_backlog_tasks** — List open `backlog`-labeled GitHub issues for a workspace (read from the local cache).
- **add_backlog_task** — Create a `backlog` GitHub issue (with complexity + priority labels) via `gh`.
- **complete_backlog_task** — Close a backlog issue by number (or unique title substring) via `gh`.

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk
- No external dependencies beyond the MCP SDK and shared lib

## Configuration
- Issue cache: `data/backlog-cache/<workspace>.json` (stale-tolerant)
- Issue repo mapping: `config/orchestrator/issue-repos.json`
- Workspace config: `config/orchestrator/workspaces.json`
- Uses `ORCHESTRATOR_HOME` from `../lib/config-loader.js`

## Integration Points
- Cache refreshed by `scripts/lib/backlog-source.mjs` (invoked via `orchestrator.sh refresh-backlog-cache`)
- Task dispatcher reads the cache to identify available work
- Orchestrator sessions use this to close issues after dispatch

## Key Files
- `index.js` — Single-file server with GitHub issue ops and MCP tool handlers
- `scripts/lib/backlog-source.mjs` — `gh`-backed cache manager (resolveRepo / refresh / listIssues / createIssue / closeIssue)
