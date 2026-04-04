# JARVIS Orchestrator Backlog

> Full specs in `specs/`. Implementation plans in `plans/`. Completed specs in `completed/`.
> Master index with status tracking: [README.md](README.md)

## High Priority
- [ ] [complex] Sandbox Dev Environment — Docker-based sandbox for autonomous Claude Code task execution. Spec: `specs/sandbox-dev-environment.md` — **In Progress**
- [ ] [medium] PR review skip by commit SHA — Store reviewed commit SHA in sidecar file, compare against headRefOid (avoids re-review after posting)
- [ ] [medium] PR inbox dashboard widget — PR inbox visualization in JARVIS dashboard. Read from `reports/pr-inbox.json`

## Medium Priority
- [ ] [complex] PMO Dashboard — Web UI for project tracking. FastAPI + Vue 3 + SQLite. Spec: `specs/pmo-dashboard.md`
- [ ] [complex] Dashboard Modular Sidenav — Restructure dashboard into modular sidenav. Spec: `specs/dashboard-modules.md`
- [ ] [medium] `/cleanup` Skill — Post-task cleanup ritual. Spec: `specs/cleanup-skill.md`
- [ ] [complex] Google Drive ↔ PMO Integration — Browse/read Drive files in-place. Spec: `specs/gdrive-pmo-sync.md`
- [ ] [medium] Meeting Minutes Cron (GDrive) — Auto-organize meeting minutes via Calendar + Drive. Spec: `specs/meeting-minutes-cron.md`
- [ ] [medium] GWorkspace Tools Package — Package google-workspace MCP as distributable artifact. Spec: `specs/gworkspace-tools-package.md`
- [ ] [complex] SDK Monorepo Reorganization — Restructure SDK into categorized subfolders. Spec: `specs/sdk-reorganization.md`
- [ ] [medium] Gmail API Migration — Add Gmail tools to Google Workspace MCP. Spec: `specs/gmail-api-migration.md`
- [ ] [complex] Telegram Command Intake Pipeline — Telegram bot → NLP intent → action router. Spec: `specs/telegram-command-intake.md`
- [ ] [complex] PR Review Service v2 — Smart re-review, auto-post, labels, build checks. Plan: `plans/pr-review-v2.md`
- [ ] [complex] JARVIS Restructuring + Marketplace — Shared libs cleanup + marketplace plan. Plan: `plans/jarvis-restructuring.md`
- [ ] [complex] Document Templates Plugin — Strokmatic plugin for doc templates. Plan: `plans/document-templates-plugin.md`
- [ ] [COMPLEX] Blender Python (bpy) toolkit — Vision simulation: camera placement, reflection calibration, synthetic data, lighting optimization. Based on underbody-blender-syndata.
- [ ] [COMPLEX] NX Open API investigation — Research Siemens NX programming API for CAD/CAM automation. Evaluate MCP server feasibility.

## Low Priority
- [ ] [complex] JARVIS Voice Interface — Wake word → STT → Claude → TTS. Energy orb visual. Spec: `specs/voice-interface.md`
- [ ] [complex] JARVIS Distribution — Strokmatic — Non-personal distribution for colleagues. Spec: `specs/jarvis-dist-strokmatic.md`
- [ ] [complex] JARVIS Distribution — Generic — Fully sanitized distribution. Spec: `specs/jarvis-dist-generic.md`
- [ ] [complex] Multi-User Network Interface — Web-based multi-user Claude Code gateway. Spec: `specs/multi-user-interface.md`
- [ ] [complex] Android JARVIS App — Wake word → on-device STT → JARVIS API. Spec: `specs/android-jarvis-app.md`
- [ ] [medium] Voice Interface — Session Tracker — Real-time session tracking overlay. Spec: `specs/voice-interface.md`
- [ ] [low] Evaluate `gws` CLI — googleworkspace/cli as potential replacement for custom google-workspace MCP. Watch for v1.0 release. Blockers: pre-v1.0, DWD untested.

## Completed
- [x] Knowledge Base Phase 1 — 128-page PT-BR KB at `teruelskm/knowledge-base` (2026-04-03)
- [x] Knowledge Base Phase 2 — Auto-update: git monitor + dispatch hook + staleness report (2026-04-03)
- [x] Knowledge Base Phase 3 — Google Chat @JARVIS bot with RAG + Q&A logging (2026-04-03)
- [x] Telegram Bot Manager — Multi-bot notification routing, v1.3.0 (2026-02-22)
- [x] `/backlog-add` Skill — Unified backlog item creator with duplicate detection (2026-02-22)
- [x] `/system-update` Skill — Consolidated system update (2026-03-05)
- [x] Backlog Reorganization — Consolidated from 8 locations to 2 domains: `backlogs/strokmatic/` + `backlogs/jarvis/` (2026-04-03)
- [x] Modified Third-Party Libs Repo — **Superseded** by SDK Reorganization
- [x] ClickUp Connector, Changelog Reviewer, Dashboard, PR Inbox, Mechanical Tool, Email Organizer, Google Workspace, Meeting Assistant — See `completed/` directory
