# Claude Orchestrator - Self-Improvement Backlog

Ideas for new features, skills, and integrations. Full specs live in `backlog/`.

---

## New Skills / MCP Servers

| Item | Status | Spec |
|------|--------|------|
| ClickUp Connector | Idea | [backlog/clickup-connector.md](backlog/clickup-connector.md) |
| Changelog Reviewer | Idea | [backlog/changelog-reviewer.md](backlog/changelog-reviewer.md) |
| Orchestrator Dashboard | Idea | [backlog/orchestrator-dashboard.md](backlog/orchestrator-dashboard.md) |

---

## Improvements

| Item | Status | Version | Completed | Spec | Notes |
|------|--------|---------|-----------|------|-------|
| Backlog pull/reconcile | **Done** | v1.1.0 | 2026-02-15 | [spec](backlog/backlog-pull-reconcile.md) | Three-way merge with baseline tracking.<br>`sync_backlog` tool in backlog-manager MCP. |
| Push notifications | **Done** | v1.1.0 | 2026-02-15 | [spec](backlog/push-notifications.md) | Telegram Bot API + Discord backends.<br>Duration-aware routing, MarkdownV2 formatting. |
| Telegram inbox + bidirectional messaging | **Done** | v1.2.0 | 2026-02-15 | [spec](backlog/telegram-inbox.md) | Inbound polling, command parsing, voice transcription (Groq Whisper),<br>inbox storage. 3 new tools: `check_telegram_inbox`, `get_inbox`, `reply_telegram`. |
| Task lifecycle tracking | Idea | — | — | [spec](backlog/task-lifecycle-tracking.md) | `pending → running → verifying → complete → failed`.<br>New `update_task_status` tool in task-dispatcher. |
| Constraint extraction on dispatch | Idea | — | — | [spec](backlog/constraint-extraction-on-dispatch.md) | Extract acceptance criteria from task descriptions.<br>Verify each criterion before marking done. |
| Model selection learning | Idea | — | — | [spec](backlog/model-selection-learning.md) | Track model+complexity success rates.<br>Surface patterns to update `models.json` automatically. |
| Workspace context files (TELOS-style) | Idea | — | — | [spec](backlog/workspace-context-files.md) | Per-workspace `.claude/context.md` with purpose, tech stack, goals.<br>Injected into dispatch prompts. |
| Parallel workspace dispatch | Idea | — | — | [spec](backlog/parallel-workspace-dispatch.md) | Batch dispatch with configurable concurrency.<br>Workspace locking and failure isolation. |
| Observability dashboard | Idea | — | — | [spec](backlog/observability-dashboard.md) | Implementation plan for the [existing spec](backlog/orchestrator-dashboard.md).<br>Three-phase rollout: static → live → analytics. |
| Hook system | Idea | — | — | [spec](backlog/hook-system.md) | 6 Claude Code hooks: pre-dispatch validation, backlog preload,<br>dispatch tracking, dashboard summary, completion notify, changelog verify. |
| Self-improvement mining | Idea | — | — | [spec](backlog/self-improvement-mining.md) | 5-stage pipeline mining dispatch logs + changelogs.<br>Section-targeted upgrade proposals with confidence scores. |
