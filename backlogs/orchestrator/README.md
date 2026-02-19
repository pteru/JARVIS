# Claude Orchestrator - Self-Improvement Backlog

Ideas for new features, skills, and integrations. Full specs live in this directory.

---

## New Skills / MCP Servers

| Item | Status | Spec |
|------|--------|------|
| ClickUp Connector | **Done** | [completed/clickup-connector.md](completed/clickup-connector.md) |
| Changelog Reviewer | **Done** | [completed/changelog-reviewer.md](completed/changelog-reviewer.md) |
| Orchestrator Dashboard | **Done** | [completed/orchestrator-dashboard.md](completed/orchestrator-dashboard.md) |
| PR Inbox & Reviewer | **Done** | [pr-inbox-reviewer.md](pr-inbox-reviewer.md) |
| Mechanical File Tool | **Done** | [completed/mechanical-tool.md](completed/mechanical-tool.md) |
| Email Organizer Tool + MCP | **Done** | [completed/email-organizer.md](completed/email-organizer.md) |
| Google Workspace Connector | **Done** | [google-workspace-connector.md](google-workspace-connector.md) |
| Meeting Assistant | **Planned** | [meeting-assistant.md](meeting-assistant.md) |

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
| Google Workspace Connector | **Done** | — | 2026-02-18 | [spec](google-workspace-connector.md) | MCP server for Docs, Sheets, Slides, Drive.<br>Dual auth: Service Account + OAuth2. Skills: `/gdoc`, `/gsheet`, `/gslides`. |
| PR review dispatch logging | **Done** | — | 2026-02-18 | — | Created `log-dispatch.sh` helper. Wired into `fetch-open-prs.sh`, `review-pr.sh`,<br>`archive-merged-reviews.sh`, and `orchestrator.sh`. All cron tasks now log to `dispatches.json`. |
| PR review skip by commit SHA | **Planned** | — | — | — | Currently compares review mtime vs PR `updated_at`, but posting our own review bumps `updated_at` causing one unnecessary re-review.<br>Store reviewed commit SHA in sidecar file, compare against `headRefOid`. |
| PR inbox dashboard widget | **Planned** | — | — | — | Add PR inbox visualization to the JARVIS dashboard.<br>Show open PR count by product, review status, stale PRs, and links to review files.<br>Read from `reports/pr-inbox.json` and `reports/pr-reviews/`. |
| Meeting Assistant | **Planned** | — | — | [spec](meeting-assistant.md) | Real-time meeting transcription, minutes, proactive actions.<br>Hybrid audio: system capture + platform bots (Meet/Zoom/Teams).<br>Configurable STT: Deepgram (cloud) / faster-whisper (local).<br>Real-time alerts + post-meeting batch processing. 5 implementation phases. |
| PMO Dashboard | **Planned** | — | — | [spec](pmo-dashboard.md) | Web UI for project tracking (design/procurement/quoting phases).<br>Supplier management, email timeline, live Gantt, RFQ automation,<br>quote comparison, deadline alerts. FastAPI + Vue 3 + SQLite.<br>LAN-accessible (IP:PORT, ~10 users). 4 phases, builds on email-organizer + PMO folders. |
| JARVIS Voice Interface | **Planned** | — | — | [spec](voice-interface.md) | Voice-activated assistant with Paul Bettany JARVIS voice.<br>Wake word ("JARVIS") → Whisper STT → Claude → ElevenLabs TTS (voice clone).<br>Reactive visual identity: WebGL/Three.js energy orb that pulses with speech amplitude,<br>shifts color by state (listening=blue, thinking=amber, speaking=cyan).<br>Alt local pipeline: faster-whisper + XTTS v2 + RVC v2 (fully offline, GPU required). |
