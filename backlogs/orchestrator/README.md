# Claude Orchestrator - Self-Improvement Backlog

Ideas for new features, skills, and integrations. Full specs live in this directory.

---

## New Skills / MCP Servers

| Item | Status | Spec |
|------|--------|------|
| ClickUp Connector | **Done** | [completed/clickup-connector.md](completed/clickup-connector.md) |
| Changelog Reviewer | **Done** | [completed/changelog-reviewer.md](completed/changelog-reviewer.md) |
| Orchestrator Dashboard | **Done** | [completed/orchestrator-dashboard.md](completed/orchestrator-dashboard.md) |
| PR Inbox & Reviewer | **Done** | [completed/pr-inbox-reviewer.md](completed/pr-inbox-reviewer.md) |
| Mechanical File Tool | **Done** | [completed/mechanical-tool.md](completed/mechanical-tool.md) |
| Email Organizer Tool + MCP | **Done** | [completed/email-organizer.md](completed/email-organizer.md) |
| Google Workspace Connector | **Done** | [completed/google-workspace-connector.md](completed/google-workspace-connector.md) |
| Meeting Assistant | **Done** | [completed/meeting-assistant.md](completed/meeting-assistant.md) |
| `/backlog-add` Skill | **Done** | — |
| `/system-update` Skill | **Done** | — |
| Sandbox Dev Environment | **In Progress** | [sandbox-dev-environment.md](sandbox-dev-environment.md) |
| Google Drive ↔ PMO Integration | **Planned** | [gdrive-pmo-sync.md](gdrive-pmo-sync.md) |
| Meeting Minutes Cron (GDrive) | **Planned** | [meeting-minutes-cron.md](meeting-minutes-cron.md) |
| Multi-User Network Interface | **Planned** | [multi-user-interface.md](multi-user-interface.md) |
| Telegram Command Intake Pipeline | **Planned** | [telegram-command-intake.md](telegram-command-intake.md) |
| Android JARVIS App | **Planned** | [android-jarvis-app.md](android-jarvis-app.md) |

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
| Google Workspace Connector | **Done** | — | 2026-02-18 | [spec](completed/google-workspace-connector.md) | MCP server for Docs, Sheets, Slides, Drive.<br>Dual auth: Service Account + OAuth2. Skills: `/gdoc`, `/gsheet`, `/gslides`. |
| PR review dispatch logging | **Done** | — | 2026-02-18 | — | Created `log-dispatch.sh` helper. Wired into `fetch-open-prs.sh`, `review-pr.sh`,<br>`archive-merged-reviews.sh`, and `orchestrator.sh`. All cron tasks now log to `dispatches.json`. |
| PR review skip by commit SHA | **Planned** | — | — | — | Currently compares review mtime vs PR `updated_at`, but posting our own review bumps `updated_at` causing one unnecessary re-review.<br>Store reviewed commit SHA in sidecar file, compare against `headRefOid`. |
| PR inbox dashboard widget | **Planned** | — | — | — | Add PR inbox visualization to the JARVIS dashboard.<br>Show open PR count by product, review status, stale PRs, and links to review files.<br>Read from `reports/pr-inbox.json` and `reports/pr-reviews/`. |
| Meeting Assistant | **Done** | v0.3.0 | 2026-02-23 | [spec](completed/meeting-assistant.md) | MCP server with 9 tools: start/stop meeting, inject transcript, live notes,<br>minutes generation, action item extraction, backlog integration.<br>PipeWire + Deepgram STT pipeline with graceful fallback to manual mode. 65 tests. |
| Meeting Assistant async spawn fix | **Done** | v0.3.1 | 2026-02-23 | — | Replace blocking `spawnSync` with async `spawn` in live-notes and minutes-generator.<br>Concurrency guard prevents overlapping cycles. Circuit breaker (3 failures) pauses engine.<br>Fixes VSCode freeze / MCP server unresponsiveness during meetings. |
| Meeting Assistant audio capture + language | **Done** | v0.3.2 | 2026-02-26 | — | Fix PipeWire sink monitor capture via `stream.capture.sink=true` property.<br>Add per-meeting `language` parameter to `start_meeting` (e.g. `pt-br`, `en`).<br>Previously `pw-record --target=<sink>` was redirected to mic by WirePlumber. |
| E2E Test Infrastructure (3 products) | **Done** | — | 2026-02-25 | [spec](completed/e2e-test-restructure-spec.md) | Unified layered test architecture for VK (PR #7), DM (PR #6+#7), SF (PR #7).<br>Contract, benchmark, service, pipeline layers. Docker Compose profiles. |
| PMO Dashboard | **Planned** | — | — | [spec](pmo-dashboard.md) | Web UI for project tracking (design/procurement/quoting phases).<br>Supplier management, email timeline, live Gantt, RFQ automation,<br>quote comparison, deadline alerts. FastAPI + Vue 3 + SQLite.<br>LAN-accessible (IP:PORT, ~10 users). 4 phases, builds on email-organizer + PMO folders. |
| JARVIS Voice Interface | **Planned** | — | — | [spec](voice-interface.md) | Voice-activated assistant with Paul Bettany JARVIS voice.<br>Wake word ("JARVIS") → Whisper STT → Claude → ElevenLabs TTS (voice clone).<br>Reactive visual identity: WebGL/Three.js energy orb that pulses with speech amplitude,<br>shifts color by state (listening=blue, thinking=amber, speaking=cyan).<br>Alt local pipeline: faster-whisper + XTTS v2 + RVC v2 (fully offline, GPU required). |
| Google Drive ↔ PMO Integration | **Planned** | — | — | [spec](gdrive-pmo-sync.md) | Cloud-first Drive integration for PMO projects. Browse/read files in-place, organize in Drive.<br>6 new MCP tools: `list_folder`, `get_file_metadata`, `download_file`, `upload_file`, `move_file`, `create_folder`.<br>Drive index (metadata-only), AI-assisted organization, `/gdrive` + `/gdrive-setup` skills.<br>Download only when essential. 5 phases, ~7-10h estimated effort. |
| Modified Third-Party Libs Repo | **Superseded** | — | — | — | ~~Standalone repo for forks.~~ Superseded by SDK Reorganization — third-party forks now a category within SDK. Spec removed. |
| SDK Monorepo Reorganization | **Planned** | — | — | [spec](sdk-reorganization.md) | Full restructure of SDK into categorized subfolders (libs, tools, infra, third-party, ds, standards, experimental).<br>Consolidate 7 duplicate tool clusters, centralize 7 third-party forks (pylogix ×8, ultralytics ×3, GenICam-SKM, OpENer, lldpd, 3d-gltf, label-studio-ml-backend).<br>Product monorepos consume SDK tools as submodules via `toolkit/`. 5 phases, ~34-47h. |
| Meeting Minutes Cron (GDrive) | **Planned** | — | — | [spec](meeting-minutes-cron.md) | Cron-based Google Calendar + Drive scanner for auto-organizing meeting minutes/recordings.<br>AI analysis of transcripts (action items, decisions, follow-ups). Routes to PMO project folders.<br>Builds on google-workspace MCP + meeting-assistant spec. 4 phases, ~10-14h. |
| GWorkspace Tools Package | **Planned** | — | — | [spec](gworkspace-tools-package.md) | Package google-workspace MCP server + skills as distributable npm/Docker artifact.<br>Config-driven setup (no hardcoded service accounts). Template credentials, install wizard.<br>3 phases, ~8-12h. |
| JARVIS Distribution — Strokmatic | **Planned** | — | — | [spec](jarvis-dist-strokmatic.md) | Non-personal Strokmatic JARVIS distribution for colleagues in `releases/JARVIS-strokmatic/`.<br>Strip personal data (teruel paths, personal emails). Keep product context, skills, MCP servers.<br>Build script with sanitization + config wizard. 4 phases, ~15-20h. |
| JARVIS Distribution — Generic | **Planned** | — | — | [spec](jarvis-dist-generic.md) | Fully sanitized JARVIS distribution removing all Strokmatic-specific data.<br>Template-based: generic product examples, placeholder configs, onboarding guide.<br>Depends on Strokmatic distribution first. 3 phases, ~10-15h. |
| Multi-User Network Interface | **Planned** | — | — | [spec](multi-user-interface.md) | Web-based multi-user Claude Code/JARVIS gateway accessible over LAN.<br>User auth (local accounts), session isolation, per-user history/storage, activity tracking.<br>Reverse proxy to `claude` CLI processes. Most complex item. 5 phases, ~40-60h. |
| `/cleanup` Skill | **Planned** | — | — | [spec](cleanup-skill.md) | Post-task cleanup skill: check worktree + branches, stage/commit changes,<br>update context files + changelog, rerun checks. Standardized end-of-task ritual. ~4-6h. |
| Sandbox Dev Environment | **In Progress** | — | — | [spec](sandbox-dev-environment.md) | Docker-based sandbox for autonomous Claude Code task execution.<br>Pre-built base image + disposable per-task containers + git patch review.<br>`--dangerouslySkipPermissions` safe inside container. ~4-6h. |
| Dashboard Modular Sidenav | **Planned** | — | — | [spec](dashboard-modules.md) | Restructure orchestrator dashboard into modular sidenav layout.<br>General overview tab + per-tool tabs (PR Review, Health Check, Dispatches, Backlogs, Changelog).<br>Alert badges on tab icons for pending/new actions. 4 phases, ~12-18h. |
| Voice Interface — Session Tracker | **Planned** | — | — | [spec](voice-interface.md) | Extension to JARVIS Voice Interface: real-time tracking of active Claude sessions/projects,<br>running status, loaded skills, resource usage. Overlay panel in visual identity. ~6-8h addendum. |
| Telegram Command Intake Pipeline | **Planned** | — | — | [spec](telegram-command-intake.md) | Telegram bot → NLP intent classifier → action pipeline router.<br>Bilingual EN/PT-BR. First pipeline: `/backlog-add`. Builds on existing Telegram integration. 5 phases, ~28h. |
| Android JARVIS App | **Planned** | — | — | [spec](android-jarvis-app.md) | Android app with "Jarvis" wake word (Porcupine) → on-device STT → JARVIS intake API.<br>Bilingual, dark theme, offline queue. Shares pipeline with Telegram intake. 5 phases, ~44h. |
| Telegram Bot Manager | **Done** | v1.3.0 | 2026-02-22 | [spec](telegram-bot-manager.md) | Multi-bot notification routing. Separate bots per domain (alerts, ops, assistant, reports).<br>Config-driven registry, shared router library, backward compatible toggle. 4 phases, ~14h. |
| `/backlog-add` Skill | **Done** | — | 2026-02-22 | — | Unified backlog item creator: classifies orchestrator vs product, duplicate detection,<br>spec generation, task code assignment, index updates. Prompt-only skill in `.claude/skills/backlog-add/`. |
