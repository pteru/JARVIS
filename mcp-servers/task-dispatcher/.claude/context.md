# Task Dispatcher

## Purpose
Central task dispatch system that assigns coding tasks to workspaces with automatic model selection based on complexity and keyword analysis. Manages the full task lifecycle (pending -> running -> verifying -> complete/failed) with acceptance criteria extraction, verification checks, batch dispatch support, and outcome tracking with token usage.

## MCP Tools
- **dispatch_task** — Dispatch a task to a workspace with automatic model selection; injects workspace and product context; extracts acceptance criteria from the task description
- **get_task_status** — Get the full status record of a dispatched task by ID
- **list_dispatched_tasks** — List all dispatched tasks with optional workspace/status filter and computed duration
- **update_task_status** — Update task status with lifecycle validation (enforces valid transitions: pending->running->verifying->complete/failed)
- **verify_task_completion** — Run acceptance and universal criteria checks (file existence, test pass, content match, command success)
- **update_task_outcome** — Record task outcome (success/failure/partial) with execution time and token usage
- **mark_task_complete_override** — Manually mark a task complete, bypassing verification checks
- **dispatch_batch** — Dispatch multiple tasks to different workspaces in parallel with configurable concurrency
- **get_batch_status** — Get progress and status of a batch dispatch
- **cancel_batch** — Cancel a running batch, marking all pending tasks as failed

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk
- Uses `ORCHESTRATOR_HOME` from `../lib/config-loader.js`

## Configuration
- Workspace config: `config/orchestrator/workspaces.json` (workspace paths, product associations)
- Model config: `config/orchestrator/models.json` (complexity-to-model mapping, keyword rules)
- Dispatch log: `logs/dispatches.json` (all dispatch records and batch records)
- Workspace context: `<workspace-path>/.claude/context.md` (injected into task prompts)
- Product context: `workspaces/strokmatic/<product>/.claude/context.md`

## Integration Points
- Notifier MCP server receives task_completed/task_failed events
- Changelog-writer records changes after task completion
- Backlog-manager marks tasks complete in backlogs
- Model-learning-analyzer and self-improvement-miner analyze dispatch history
- Shell scripts (`scripts/task-dispatcher.sh`) wrap this server for CLI usage
- Verification uses `lib/verify-criteria.js` to check file existence, run commands, and match content

## Key Files
- `index.js` — Main server (~1200 lines) with dispatch logic, model selection, criteria extraction, lifecycle management, and batch support
- `lib/verify-criteria.js` — Acceptance criteria verification (file_exists, test_pass, content_match, command_success)
