# Changelog - orchestrator

All notable changes to the orchestrator workspace.

## 2026-02-23

### Added
- Telegram Bot Manager: multi-bot routing with `config/orchestrator/telegram-bots.json` registry, `scripts/lib/telegram-router.sh` shared library, and `scripts/helpers/validate-telegram-bots.sh` validation script

Format: [Keep a Changelog](https://keepachangelog.com/)
### Changed
- VK health `telegram.sh` and `morning-report.sh` migrated to use `telegram-router.sh` with transparent legacy fallback
- Notifier MCP server (v1.3.0): domain-based routing via `resolveRoute()` — all Telegram operations now route through bot manager when `bot_manager_enabled=true`

