# Workspace Analyzer

## Purpose
Analyzes workspace code quality, structure, and health. Checks for the presence of package.json, README, CLAUDE.md, test directories, and git status. Suggests improvement tasks based on findings, provides code statistics, and can auto-generate initial context.md files with detected tech stack and purpose.

## MCP Tools
- **analyze_workspace_health** — Analyze a workspace for package.json (test/lint scripts, dependency count), README, CLAUDE.md, test directories, and git status (uncommitted changes)
- **suggest_tasks** — Analyze workspace health and suggest improvement tasks with priority and complexity (missing docs, tests, linting, uncommitted changes)
- **get_workspace_stats** — Get code statistics: JS/TS file count, lines of code, total git commits
- **generate_workspace_context** — Auto-generate a `.claude/context.md` file for a workspace based on tech stack detection and README extraction

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk, child_process (for git and find commands)
- Uses `ORCHESTRATOR_HOME` env var directly

## Configuration
- No config files required; operates on workspace paths provided as tool arguments
- Tech stack detection checks: package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, pom.xml, Makefile, Dockerfile

## Integration Points
- Task-dispatcher uses workspace health data for dispatch decisions
- Self-improvement-miner's workspace-health analyzer builds on similar checks
- Generated context.md files are injected into task prompts by the task-dispatcher
- Suggest-tasks output can feed into backlog-manager for task creation

## Key Files
- `index.js` — Single-file server with health analysis, tech stack detection, code stats, and context generation
