# Claude Orchestrator - Self-Improvement Backlog

Ideas for new features, skills, and integrations. Full specs live in `backlog/`.

---

## New Skills / MCP Servers

| Item | Status | Spec |
|------|--------|------|
| ClickUp Connector | Idea | [backlog/clickup-connector.md](backlog/clickup-connector.md) |
| Changelog Reviewer | Idea | [backlog/changelog-reviewer.md](backlog/changelog-reviewer.md) |
| Orchestrator Dashboard | **Done** | [backlog/orchestrator-dashboard.md](backlog/orchestrator-dashboard.md) |

---

## Improvements

| Item | Status | Version | Completed | Spec | Notes |
|------|--------|---------|-----------|------|-------|
| Backlog pull/reconcile | **Done** | v1.1.0 | 2026-02-15 | [spec](backlog/backlog-pull-reconcile.md) | Three-way merge with baseline tracking.<br>`sync_backlog` tool in backlog-manager MCP. |
| Push notifications | **Done** | v1.1.0 | 2026-02-15 | [spec](backlog/push-notifications.md) | Telegram Bot API + Discord backends.<br>Duration-aware routing, MarkdownV2 formatting. |
| Telegram inbox + bidirectional messaging | **Done** | v1.2.0 | 2026-02-15 | [spec](backlog/telegram-inbox.md) | Inbound polling, command parsing, voice transcription (Groq Whisper),<br>inbox storage. 3 new tools: `check_telegram_inbox`, `get_inbox`, `reply_telegram`. |
| Task lifecycle tracking | **Done** | v1.2.0 | 2026-02-15 | [spec](backlog/task-lifecycle-tracking.md) | State machine `pending→running→verifying→complete\|failed`.<br>`update_task_status`, `verify_task_completion`, `mark_task_complete_override` tools. |
| Constraint extraction on dispatch | **Done** | v1.2.0 | 2026-02-15 | [spec](backlog/constraint-extraction-on-dispatch.md) | Extracts file_exists, test_pass, content_match, command_success criteria.<br>Universal criteria from package.json/pyproject.toml. |
| Model selection learning | **Done** | v1.0.0 | 2026-02-15 | [spec](backlog/model-selection-learning.md) | New `model-learning-analyzer` MCP server.<br>4 tools: analyze, suggest, apply, reject model routing rules. |
| Workspace context files (TELOS-style) | **Done** | v1.1.0 | 2026-02-15 | [spec](backlog/workspace-context-files.md) | `generate_workspace_context` tool in workspace-analyzer.<br>Bootstrap script created 97 context files. Context injected into dispatches. |
| Parallel workspace dispatch | Idea | — | — | [spec](backlog/parallel-workspace-dispatch.md) | Batch dispatch with configurable concurrency.<br>Workspace locking and failure isolation. |
| Observability dashboard | **Done** | v1.0.0 | 2026-02-15 | [spec](backlog/observability-dashboard.md) | Express.js dashboard with Chart.js.<br>Dispatch history, model usage, workspace activity, cost tracking. |
| Hook system | Idea | — | — | [spec](backlog/hook-system.md) | 6 Claude Code hooks: pre-dispatch validation, backlog preload,<br>dispatch tracking, dashboard summary, completion notify, changelog verify. |
| Self-improvement mining | **Done** | v1.0.0 | 2026-02-15 | [spec](backlog/self-improvement-mining.md) | New `self-improvement-miner` MCP server.<br>3 tools: analyze_patterns, generate_meta_report, apply_proposal. |
