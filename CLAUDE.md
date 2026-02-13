# Claude Orchestrator - Master Guidelines

## Purpose
This is an automated orchestration system that dispatches coding tasks to Claude Code across multiple workspaces.

## Coding Principles
- Keep changes minimal and focused on the task at hand
- Follow existing code style and conventions in each workspace
- Write tests for new functionality when a test framework is present
- Never commit secrets, credentials, or environment-specific configuration

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
2. Existing tests still pass
3. No linting or type errors introduced
4. Changelog entry added via the changelog-writer MCP tool
5. Backlog task marked complete via the backlog-manager MCP tool

## MCP Tools Available
- **backlog-manager**: Manage task backlogs per workspace
- **changelog-writer**: Record changes to workspace changelogs
- **workspace-analyzer**: Analyze workspace health and suggest tasks
- **task-dispatcher**: Dispatch tasks with model selection
- **report-generator**: Generate daily/weekly activity reports

## Session Directives
- At the end of each session, add meaningful lessons learned to the **Lessons Learned** section below (only if they do not conflict with existing directives)
- After each session, add any ideas for improving the orchestrator itself (new skills, features, integrations) to `backlog.md` in the repo root
- Always work within virtual environments (Python `venv`, Node local installs, etc.) — never install dependencies into the global system environment

## File Structure
- `backlogs/` - Per-workspace task backlogs (markdown)
- `changelogs/` - Per-workspace changelogs (Keep a Changelog format)
- `reports/` - Generated daily and weekly reports
- `logs/` - Dispatch logs and cron output
- `config/` - Workspace, model, and schedule configuration
- `backlog.md` - Self-improvement ideas and feature backlog for the orchestrator itself

## Lessons Learned
<!-- Lessons from past sessions are appended here -->
