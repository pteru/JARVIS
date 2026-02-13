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

## File Structure
- `backlogs/` - Per-workspace task backlogs (markdown)
- `changelogs/` - Per-workspace changelogs (Keep a Changelog format)
- `reports/` - Generated daily and weekly reports
- `logs/` - Dispatch logs and cron output
- `config/` - Workspace, model, and schedule configuration
