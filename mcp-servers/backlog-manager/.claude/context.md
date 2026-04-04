# Backlog Manager

## Purpose
Manages per-workspace product backlogs stored as markdown files. Supports listing, adding, and completing tasks organized by priority (high/medium/low) and complexity. Implements three-way merge reconciliation between central backlogs and workspace-local copies to prevent overwrites when both sides are edited independently.

## MCP Tools
- **list_backlog_tasks** — List all incomplete tasks from a workspace backlog, optionally filtered by priority
- **add_backlog_task** — Add a new task to a workspace backlog under the specified priority section with a complexity tag
- **complete_backlog_task** — Mark a task as complete by matching a substring pattern, adds completion date
- **sync_backlog** — Pull workspace-local backlog changes and three-way merge with the central copy; reports conflicts

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk
- No external dependencies beyond the MCP SDK and shared lib

## Configuration
- Strokmatic product backlogs: `backlogs/strokmatic/<product>.md`
- JARVIS orchestrator backlog: `backlogs/jarvis/backlog.md`
- Legacy path (deprecated): `backlogs/products/<workspace>.md`
- Workspace config: `config/orchestrator/workspaces.json` (provides workspace paths for push/sync)
- Uses `ORCHESTRATOR_HOME` from `../lib/config-loader.js`

## Integration Points
- Pushes backlog copies to `<workspace-path>/.claude/backlog.md` with a `.baseline` for three-way merge
- Task dispatcher reads backlogs to identify available work
- Orchestrator sessions use this to mark tasks complete after dispatch

## Key Files
- `index.js` — Single-file server with backlog parsing, merge logic, and MCP tool handlers
