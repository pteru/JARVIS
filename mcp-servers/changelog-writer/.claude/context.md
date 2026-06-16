# Changelog Writer

## Purpose
Records changes to workspace changelogs in Keep a Changelog format. Maintains both a central changelog per workspace (in the orchestrator repo) and a workspace-local CHANGELOG.md. Supports querying recent changes across workspaces for a given date range.

## MCP Tools
- **add_changelog_entry** — Add an entry under a section (Added/Changed/Fixed/Removed) for today's date to a workspace changelog
- **get_changelog** — Retrieve the full changelog content for a workspace
- **get_recent_changes** — Get changelog entries from the last N days across all or a specific workspace

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk
- No external dependencies beyond the MCP SDK and shared lib

## Configuration
- Central changelogs: `changelogs/<workspace>-changelog.md`
- Workspace config: `config/orchestrator/workspaces.json` (for writing workspace-local CHANGELOG.md)
- Uses `ORCHESTRATOR_HOME` from `../lib/config-loader.js`

## Integration Points
- Task completion checklist requires calling this server to record changes
- Changelog-reviewer reads the files this server writes
- Report-generator reads changelogs for daily/weekly report content

## Key Files
- `index.js` — Single-file server with changelog file management and date-section insertion logic
