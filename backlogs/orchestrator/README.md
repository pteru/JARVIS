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
| Google Drive ↔ PMO Integration | **Planned** | [gdrive-pmo-sync.md](gdrive-pmo-sync.md) |
| Modified Third-Party Libs Repo | **Planned** | [modified-third-party-libs.md](modified-third-party-libs.md) |
| Meeting Minutes Cron (GDrive) | **Planned** | [meeting-minutes-cron.md](meeting-minutes-cron.md) |
| Multi-User Network Interface | **Planned** | [multi-user-interface.md](multi-user-interface.md) |
| `/cleanup` Skill | **Planned** | [cleanup-skill.md](cleanup-skill.md) |

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
| Google Drive ↔ PMO Integration | **Planned** | — | — | [spec](gdrive-pmo-sync.md) | Cloud-first Drive integration for PMO projects. Browse/read files in-place, organize in Drive.<br>6 new MCP tools: `list_folder`, `get_file_metadata`, `download_file`, `upload_file`, `move_file`, `create_folder`.<br>Drive index (metadata-only), AI-assisted organization, `/gdrive` + `/gdrive-setup` skills.<br>Download only when essential. 5 phases, ~7-10h estimated effort. |
| Modified Third-Party Libs Repo | **Planned** | — | — | [spec](modified-third-party-libs.md) | Centralized repo for custom forks of ultralytics, pylogix, GenICam-SKM, OpENer.<br>Private PyPI (devpi/Artifactory) for internal packages. CI for custom builds.<br>Eliminates 6+ vendored pylogix copies. 3 phases, ~12-18h. |
| Meeting Minutes Cron (GDrive) | **Planned** | — | — | [spec](meeting-minutes-cron.md) | Cron-based Google Calendar + Drive scanner for auto-organizing meeting minutes/recordings.<br>AI analysis of transcripts (action items, decisions, follow-ups). Routes to PMO project folders.<br>Builds on google-workspace MCP + meeting-assistant spec. 4 phases, ~10-14h. |
| GWorkspace Tools Package | **Planned** | — | — | [spec](gworkspace-tools-package.md) | Package google-workspace MCP server + skills as distributable npm/Docker artifact.<br>Config-driven setup (no hardcoded service accounts). Template credentials, install wizard.<br>3 phases, ~8-12h. |
| JARVIS Distribution — Strokmatic | **Planned** | — | — | [spec](jarvis-dist-strokmatic.md) | Non-personal Strokmatic JARVIS distribution for colleagues in `releases/JARVIS-strokmatic/`.<br>Strip personal data (teruel paths, personal emails). Keep product context, skills, MCP servers.<br>Build script with sanitization + config wizard. 4 phases, ~15-20h. |
| JARVIS Distribution — Generic | **Planned** | — | — | [spec](jarvis-dist-generic.md) | Fully sanitized JARVIS distribution removing all Strokmatic-specific data.<br>Template-based: generic product examples, placeholder configs, onboarding guide.<br>Depends on Strokmatic distribution first. 3 phases, ~10-15h. |
| Multi-User Network Interface | **Planned** | — | — | [spec](multi-user-interface.md) | Web-based multi-user Claude Code/JARVIS gateway accessible over LAN.<br>User auth (local accounts), session isolation, per-user history/storage, activity tracking.<br>Reverse proxy to `claude` CLI processes. Most complex item. 5 phases, ~40-60h. |
| `/cleanup` Skill | **Planned** | — | — | [spec](cleanup-skill.md) | Post-task cleanup skill: check worktree + branches, stage/commit changes,<br>update context files + changelog, rerun checks. Standardized end-of-task ritual. ~4-6h. |
| Dashboard Modular Sidenav | **Planned** | — | — | [spec](dashboard-modules.md) | Restructure orchestrator dashboard into modular sidenav layout.<br>General overview tab + per-tool tabs (PR Review, Health Check, Dispatches, Backlogs, Changelog).<br>Alert badges on tab icons for pending/new actions. 4 phases, ~12-18h. |
| Voice Interface — Session Tracker | **Planned** | — | — | [spec](voice-interface.md) | Extension to JARVIS Voice Interface: real-time tracking of active Claude sessions/projects,<br>running status, loaded skills, resource usage. Overlay panel in visual identity. ~6-8h addendum. |
