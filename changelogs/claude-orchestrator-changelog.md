# Changelog - claude-orchestrator

All notable changes to the claude-orchestrator system.

Format: [Keep a Changelog](https://keepachangelog.com/)

## 2026-02-15

### Added (task-dispatcher v1.3.0)
- `dispatch_batch` tool — dispatch tasks to multiple workspaces in parallel with configurable concurrency
- `get_batch_status` tool — query batch execution progress with aggregated counts
- `cancel_batch` tool — cancel running batches, marking pending tasks as failed
- `scripts/execute-batch.mjs` — standalone batch executor with semaphore-based concurrency control
- Workspace locking via `logs/workspace-locks.json` with 30-minute stale lock detection
- Per-dispatch log files under `logs/<batch_id>/` directories
- SIGINT/SIGTERM handling for graceful batch cancellation
- `config/orchestrator/dispatcher.json` — concurrency and timeout configuration

### Added (hook system v1.0.0)
- Claude Code hook system with 5 hooks registered in `.claude/settings.local.json`
- `PreDispatchValidator` hook — blocks dispatch to non-existent workspaces or inaccessible paths
- `BacklogPreloader` hook — auto-syncs workspace-local backlogs to central store before dispatch/list operations
- `DashboardSummary` hook — displays orchestrator health dashboard (dispatch status, pending backlogs) at session start
- `CompletionNotifier` hook — announces task completion or failure via PostToolUse on `update_task_status`
- `ChangelogVerifier` hook — warns if no changelog entry exists for today when completing a backlog task
- Shared hook utilities library at `.claude/hooks/lib/utils.sh`

### Added (task-dispatcher v1.2.0)
- Task lifecycle state machine (`pending → running → verifying → complete | failed`) with transition validation and status history
- `update_task_status` tool — transition tasks through lifecycle with notes and error tracking
- `verify_task_completion` tool — run extracted acceptance criteria checks (file_exists, test_pass, content_match, command_success)
- `mark_task_complete_override` tool — manually complete tasks bypassing verification
- `update_task_outcome` tool — record outcome (success/failure/partial), execution time, and token usage
- Acceptance criteria extraction from task descriptions (file paths, test mentions, must-contain patterns, command mentions)
- Universal criteria generation from workspace package.json/pyproject.toml (test/lint commands)
- Workspace context injection — reads `.claude/context.md` and prepends to dispatched task prompts in `<workspace-context>` tags
- Task keyword extraction for categorization (architecture, design, refactor, bug, fix, test, docs, api, database, performance, security)
- Legacy dispatch record migration on load

### Added (workspace-analyzer v1.1.0)
- `generate_workspace_context` tool — generates `.claude/context.md` with purpose, tech stack, goals, and constraints
- Tech stack detection (Node.js/React/Angular/Vue/Next.js/NestJS/Express, Python, Rust, Go, Java, C/C++, Docker)
- Purpose extraction from README.md
- `scripts/bootstrap-context-files.mjs` — standalone script to bootstrap context files for all configured workspaces (97 created)

### Added (model-learning-analyzer v1.0.0)
- New MCP server for model selection optimization based on dispatch history
- `analyze_model_performance` tool — aggregates success rates, execution times, and token usage by model
- `suggest_model_rules` tool — generates routing rule suggestions from performance patterns
- `apply_model_suggestion` / `reject_model_suggestion` tools — accept or dismiss suggested rules

### Added (self-improvement-miner v1.0.0)
- New MCP server for orchestrator self-analysis and improvement proposals
- `analyze_patterns` tool — mines dispatch patterns, workspace health, and model routing data
- `generate_meta_report` tool — produces comprehensive improvement reports with scored proposals
- `apply_proposal` tool — applies accepted improvement proposals
- Three analyzer modules: dispatch-patterns, workspace-health, model-routing

### Added (observability dashboard v1.0.0)
- Express.js dashboard at `dashboard/` with Chart.js visualizations
- Dispatch history timeline, model usage breakdown, workspace activity, and cost tracking
- Parsers for backlogs, changelogs, and dispatch logs
- Claude model pricing configuration at `config/orchestrator/pricing.json`

### Added (notifier v1.2.0)
- `check_telegram_inbox` tool — polls Telegram for inbound messages, parses commands (`/status`, `/dispatch`, `/cancel`), transcribes voice messages via Groq Whisper API, stores unroutable messages in inbox
- `get_inbox` tool — retrieves stored inbox messages with optional status filter and mark-read support
- `reply_telegram` tool — sends freeform replies to Telegram with optional message threading
- Voice transcription support using Groq Whisper API (`whisper-1`) for Telegram voice messages
- Inbox persistence in `logs/inbox.json` (capped at 200 entries) with offset tracking in `logs/telegram_update_offset.json`
- Inbound configuration section in `config/orchestrator/notifications.json`

### Added
- `sync_backlog` tool in backlog-manager MCP for bidirectional backlog synchronization between central and workspace backlogs
- Three-way merge engine (baseline/central/workspace) with conflict detection and HTML comment conflict markers
- Baseline tracking: `pushToWorkspace()` now writes `backlog.md.baseline` for future reconciliation
- Automatic `.gitignore` management to exclude baseline files from version control
- **notifier MCP server** (`mcp-servers/notifier/`) with WhatsApp (CallMeBot) and Discord webhook backends
- `send_notification` tool — sends task event notifications to all enabled backends with duration-aware routing
- `test_notification` tool — verifies backend connectivity
- Rate-limited WhatsApp message queue (2.5s between messages for CallMeBot compliance)
- Notification history logging to `logs/notifications.json` (last 500 entries)
- Config template at `config/orchestrator/notifications.json`

### Fixed
- Config path for `workspaces.json` corrected from `config/workspaces.json` to `config/orchestrator/workspaces.json` in backlog-manager, changelog-writer, and task-dispatcher MCP servers
- Config path for `models.json` corrected in task-dispatcher MCP server

### Changed
- backlog-manager MCP server version bumped from 1.0.0 to 1.1.0
- **notifier MCP server** migrated from WhatsApp (CallMeBot) to Telegram Bot API — MarkdownV2 formatting, no rate-limiting queue needed, bidirectional messaging support for future use
- notifier MCP server version bumped from 1.0.0 to 1.1.0
