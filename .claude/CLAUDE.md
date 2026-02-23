# Claude Orchestrator - Master Guidelines

## Master Directive

Always run /jarvis at the start of every session.

## Purpose

This is an automated orchestration system that dispatches coding tasks to Claude Code across multiple workspaces.

## Coding Principles

- Keep changes minimal and focused on the task at hand
- Follow existing code style and conventions in each workspace
- Follow TDD guidelines (`docs/tdd-guidelines.md`). Write tests before implementation for new features; write regression tests for bug fixes
- Never commit secrets, credentials, or environment-specific configuration

## Markdown Report Conventions

When writing PMO reports (in `workspaces/strokmatic/pmo/*/reports/md/`):

- Consecutive bold metadata lines in the header (e.g., `**Projeto:**`, `**Data:**`, `**Autor:**`) must end with `<br>` to preserve line breaks in HTML/PDF rendering. Without `<br>`, single newlines collapse into one line.
- Export to PDF using `md-to-pdf`: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npx --yes md-to-pdf <file>.md`
- Never use pandoc/LaTeX for PDF export (poor typography).
- PMO report structure: `reports/md/` for markdown source, `reports/pdf/` for exported PDFs.

## Changelog Format

Use [Keep a Changelog](https://keepachangelog.com/) format:

- **Added** for new features
- **Changed** for changes in existing functionality
- **Fixed** for bug fixes
- **Removed** for removed features

Entries go under date headers (`## YYYY-MM-DD`) with section headers (`### Added`, etc.).

## Task Completion Checklist

Before marking any task as complete:

1. Code changes are implemented and working
2. New tests written for new functionality (test-first preferred per `docs/tdd-guidelines.md`)
3. Existing tests still pass
4. No linting or type errors introduced
5. Changelog entry added via the changelog-writer MCP tool
6. Backlog task marked complete via the backlog-manager MCP tool

## MCP Tools Available

- **backlog-manager**: Manage task backlogs per workspace
- **changelog-writer**: Record changes to workspace changelogs
- **workspace-analyzer**: Analyze workspace health and suggest tasks
- **task-dispatcher**: Dispatch tasks with model selection
- **report-generator**: Generate daily/weekly activity reports

## Session Directives

- At the end of each session, add meaningful lessons learned to **MEMORY.md** (organized by topic) and append session logs to `docs/lessons-learned.md`
- After each session, add any ideas for improving the orchestrator itself (new skills, features, integrations) to `backlogs/orchestrator/README.md`
- Always work within virtual environments (Python `venv`, Node local installs, etc.) — never install dependencies into the global system environment

## File Structure

- `backlogs/products/` - Per-workspace product task backlogs (`strokmatic.<product>.md`)
- `backlogs/plans/` - Detailed implementation plans per product (`strokmatic.<product>.md`)
- `backlogs/orchestrator/` - Orchestrator self-improvement specs and index
- `changelogs/` - Per-workspace changelogs (Keep a Changelog format)
- `reports/` - Generated daily and weekly reports
- `logs/` - Dispatch logs and cron output
- `config/` - Workspace, model, and schedule configuration

## Key Principles

Distilled from past sessions. Full historical logs archived in `docs/lessons-learned.md`.

- **Audit all consumers before renaming files or paths.** Use `grep -r` across the codebase to find every reference before changing names, paths, or conventions.
- **Scan for credentials before any `git add`.** Search for `.env`, `*.key`, `*.pem`, service account JSON files before staging.
- **Always verify the active git branch before committing.** Run `git branch --show-current` before any commit.
- **Single source of truth for configuration paths.** Use `scripts/lib/config.sh` (shell) and `mcp-servers/lib/config-loader.js` (ESM) — never hardcode `ORCHESTRATOR_HOME` in individual scripts.
- **Trace new data fields through every consumer.** Store → API → serializer → builder → frontend. A mismatch at any layer silently drops data.
- **Pipe prompts to `claude --print` via stdin**, not as CLI args. Use `--allowedTools` for non-interactive usage. Clean output before posting externally.
- **Establish naming conventions before generating content.** Renaming after generation wastes time and risks missed references.
- **Hooks fail-open silently.** Path errors in `lib/utils.sh` produce no errors — just silently skip operations. Always verify hook behavior manually.
- **Backlog tasks should describe the desired end-state**, not just "refactor." Specific tasks enable autonomous execution.
