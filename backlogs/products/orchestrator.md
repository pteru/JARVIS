# Orchestrator Backlog

## High Priority
- [ ] [complex] Sandbox Dev Environment — Docker-based sandbox for autonomous Claude Code task execution. Pre-built base image + disposable per-task containers + git patch review. Spec: `backlogs/orchestrator/sandbox-dev-environment.md`
- [ ] [medium] PR review skip by commit SHA — Store reviewed commit SHA in sidecar file, compare against headRefOid instead of mtime vs updated_at (avoids one unnecessary re-review after posting)
- [ ] [medium] PR inbox dashboard widget — Add PR inbox visualization to JARVIS dashboard. Show open PR count by product, review status, stale PRs, links to review files. Read from `reports/pr-inbox.json`

## Medium Priority
- [ ] [complex] PMO Dashboard — Web UI for project tracking (design/procurement/quoting phases). Supplier management, email timeline, live Gantt, RFQ automation, quote comparison, deadline alerts. FastAPI + Vue 3 + SQLite. Spec: `backlogs/orchestrator/pmo-dashboard.md`
- [ ] [complex] Dashboard Modular Sidenav — Restructure orchestrator dashboard into modular sidenav layout. General overview + per-tool tabs (PR Review, Health Check, Dispatches, Backlogs, Changelog). Spec: `backlogs/orchestrator/dashboard-modules.md`
- [ ] [medium] `/cleanup` Skill — Post-task cleanup: check worktree + branches, stage/commit changes, update context files + changelog, rerun checks. Spec: `backlogs/orchestrator/cleanup-skill.md`
- [ ] [complex] Google Drive ↔ PMO Integration — Cloud-first Drive integration for PMO projects. Browse/read files in-place, organize in Drive. Drive index, AI-assisted organization, `/gdrive` + `/gdrive-setup` skills. Spec: `backlogs/orchestrator/gdrive-pmo-sync.md`
- [ ] [medium] Meeting Minutes Cron (GDrive) — Cron-based Google Calendar + Drive scanner for auto-organizing meeting minutes/recordings. AI analysis of transcripts. Spec: `backlogs/orchestrator/meeting-minutes-cron.md`
- [ ] [medium] GWorkspace Tools Package — Package google-workspace MCP server + skills as distributable npm/Docker artifact. Config-driven setup, template credentials, install wizard. Spec: `backlogs/orchestrator/gworkspace-tools-package.md`
- [ ] [complex] Modified Third-Party Libs Repo — Centralized repo for custom forks of ultralytics, pylogix, GenICam-SKM, OpENer. Private PyPI for internal packages. Spec: `backlogs/orchestrator/modified-third-party-libs.md`
- [ ] [complex] Telegram Command Intake Pipeline — Telegram bot → NLP intent classifier → action pipeline router. Bilingual EN/PT-BR. Spec: `backlogs/orchestrator/telegram-command-intake.md`

## Low Priority
- [ ] [complex] JARVIS Voice Interface — Wake word → Whisper STT → Claude → ElevenLabs TTS. Reactive visual identity (WebGL/Three.js energy orb). Spec: `backlogs/orchestrator/voice-interface.md`
- [ ] [complex] JARVIS Distribution — Strokmatic — Non-personal distribution for colleagues. Strip personal data, keep product context. Build script + config wizard. Spec: `backlogs/orchestrator/jarvis-dist-strokmatic.md`
- [ ] [complex] JARVIS Distribution — Generic — Fully sanitized distribution. Template-based with onboarding guide. Depends on Strokmatic dist. Spec: `backlogs/orchestrator/jarvis-dist-generic.md`
- [ ] [complex] Multi-User Network Interface — Web-based multi-user Claude Code/JARVIS gateway. User auth, session isolation, activity tracking. Spec: `backlogs/orchestrator/multi-user-interface.md`
- [ ] [complex] Android JARVIS App — "Jarvis" wake word → on-device STT → JARVIS intake API. Bilingual, dark theme, offline queue. Spec: `backlogs/orchestrator/android-jarvis-app.md`
- [ ] [medium] Voice Interface — Session Tracker — Real-time tracking of active Claude sessions/projects. Overlay panel in visual identity. Spec: `backlogs/orchestrator/voice-interface.md`
