# Changelog Reviewer

## Purpose
Reviews unreleased changelog entries across workspaces and proposes deployment plans with git branch/commit structures. Parses Keep a Changelog formatted files to extract unreleased entries, groups them by type (Added/Fixed/Changed/Removed), and generates actionable git commands for deploying changes.

## MCP Tools
- **review_changelog** — Review unreleased changelog entries for one or all workspaces, returns grouped entries by section
- **propose_deployment_plan** — Analyze unreleased entries and generate a deployment plan with branch names, commit messages, and file hints
- **execute_deployment_plan** — Approve or reject a previously proposed plan; if approved, returns git commands to execute
- **list_unreleased_changes** — Quick summary of unreleased entry counts across workspaces, sorted by count

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk, crypto (for plan UUIDs)
- No external dependencies beyond the MCP SDK and shared lib

## Configuration
- Changelogs directory: `changelogs/<workspace>-changelog.md`
- Workspace config: `config/orchestrator/workspaces.json` (for workspace-local CHANGELOG.md paths)
- Deployment plans stored in: `logs/deployment-plans.json`
- Uses `ORCHESTRATOR_HOME` from `../lib/config-loader.js`

## Integration Points
- Reads changelog files written by the changelog-writer MCP server
- Proposed plans reference workspace git repositories for branch/commit operations
- Works alongside the task-dispatcher to coordinate release workflows

## Key Files
- `index.js` — Single-file server with changelog parsing, branch grouping heuristics, and plan storage
