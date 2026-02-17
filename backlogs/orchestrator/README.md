# Claude Orchestrator - Self-Improvement Backlog

Ideas for new features, skills, and integrations. Full specs live in this directory.

---

## New Skills / MCP Servers

| Item | Status | Spec |
|------|--------|------|
| ClickUp Connector | **Done** | [completed/clickup-connector.md](completed/clickup-connector.md) |
| Changelog Reviewer | **Done** | [completed/changelog-reviewer.md](completed/changelog-reviewer.md) |
| Orchestrator Dashboard | **Done** | [completed/orchestrator-dashboard.md](completed/orchestrator-dashboard.md) |
| PR Inbox & Reviewer | **Planned** | [pr-inbox-reviewer.md](pr-inbox-reviewer.md) |

---

## Improvements

| Item | Status | Version | Completed | Spec | Notes |
|------|--------|---------|-----------|------|-------|
| Backlog pull/reconcile | **Done** | v1.1.0 | 2026-02-15 | [spec](completed/backlog-pull-reconcile.md) | Three-way merge with baseline tracking.<br>`sync_backlog` tool in backlog-manager MCP. |
| Push notifications | **Done** | v1.1.0 | 2026-02-15 | [spec](completed/push-notifications.md) | Telegram Bot API + Discord backends.<br>Duration-aware routing, MarkdownV2 formatting. |
| Telegram inbox + bidirectional messaging | **Done** | v1.2.0 | 2026-02-15 | [spec](completed/telegram-inbox.md) | Inbound polling, command parsing, voice transcription (Groq Whisper),<br>inbox storage. 3 new tools: `check_telegram_inbox`, `get_inbox`, `reply_telegram`. |
| Task lifecycle tracking | **Done** | v1.2.0 | 2026-02-15 | [spec](completed/task-lifecycle-tracking.md) | State machine `pending→running→verifying→complete\|failed`.<br>`update_task_status`, `verify_task_completion`, `mark_task_complete_override` tools. |
| Constraint extraction on dispatch | **Done** | v1.2.0 | 2026-02-15 | [spec](completed/constraint-extraction-on-dispatch.md) | Extracts file_exists, test_pass, content_match, command_success criteria.<br>Universal criteria from package.json/pyproject.toml. |
| Model selection learning | **Done** | v1.0.0 | 2026-02-15 | [spec](completed/model-selection-learning.md) | New `model-learning-analyzer` MCP server.<br>4 tools: analyze, suggest, apply, reject model routing rules. |
| Workspace context files (TELOS-style) | **Done** | v1.1.0 | 2026-02-15 | [spec](completed/workspace-context-files.md) | `generate_workspace_context` tool in workspace-analyzer.<br>Bootstrap script created 97 context files. Context injected into dispatches. |
| Parallel workspace dispatch | **Done** | v1.3.0 | 2026-02-15 | [spec](completed/parallel-workspace-dispatch.md) | `dispatch_batch`, `get_batch_status`, `cancel_batch` tools.<br>Batch executor with concurrency control and workspace locking. |
| Observability dashboard | **Done** | v1.0.0 | 2026-02-15 | [spec](completed/observability-dashboard.md) | Express.js dashboard with Chart.js.<br>Dispatch history, model usage, workspace activity, cost tracking. |
| Hook system | **Done** | v1.0.0 | 2026-02-15 | [spec](completed/hook-system.md) | 5 hooks: PreDispatchValidator, BacklogPreloader, DashboardSummary,<br>CompletionNotifier, ChangelogVerifier. Registered in settings.local.json. |
| Self-improvement mining | **Done** | v1.0.0 | 2026-02-15 | [spec](completed/self-improvement-mining.md) | New `self-improvement-miner` MCP server.<br>3 tools: analyze_patterns, generate_meta_report, apply_proposal. |
