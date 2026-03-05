# Changelog - orchestrator

All notable changes to the orchestrator workspace.

## 2026-03-05

### Added
- Multi-bot Telegram routing (Phase 4): 4 bots registered (jarvis-main, jarvis-alerts, jarvis-ops, jarvis-daily) with domain-based routing to separate chats — alerts go to group, everything else to personal chat
### Changed
- Disabled VK health pipeline (03002 `enabled: false`) — VPN disconnect alerts were firing while monitoring is not needed
- Enabled `bot_manager_enabled` in notifications.json — domain-based routing now active

### Fixed
- Updated Telegram group chat ID after supergroup migration (-5179349649 → -1003505195531)
- Notifier test_notification no longer hardcodes `task-dispatch` domain fallback — unknown/missing domain correctly falls back to `default_bot`


## 2026-03-03

### Fixed
- Google Workspace MCP: added `supportsAllDrives: true` to all `drive.files.*` API calls — fixes download/export failures for files on Shared Drives

## 2026-02-23

### Added
- `/system-update` skill and `scripts/system-update.sh` — consolidated system update command with 17 targets across 4 groups (data, libs, ai, docker). Supports `--full`, `--data`, `--libs`, `--docker`, `--ai`, `--skip`, `--only`, `--dry-run`, `--quiet` flags. Generates report in `reports/system-update/`.
- Telegram Bot Manager: multi-bot routing with `config/orchestrator/telegram-bots.json` registry, `scripts/lib/telegram-router.sh` shared library, and `scripts/helpers/validate-telegram-bots.sh` validation script

Format: [Keep a Changelog](https://keepachangelog.com/)
### Changed
- VK health `telegram.sh` and `morning-report.sh` migrated to use `telegram-router.sh` with transparent legacy fallback
- Notifier MCP server (v1.3.0): domain-based routing via `resolveRoute()` — all Telegram operations now route through bot manager when `bot_manager_enabled=true`

