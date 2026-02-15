# Changelog - claude-orchestrator

All notable changes to the claude-orchestrator system.

Format: [Keep a Changelog](https://keepachangelog.com/)

## 2026-02-15

### Added (v1.2.0)
- `check_telegram_inbox` tool — polls Telegram for inbound messages, parses commands (`/status`, `/dispatch`, `/cancel`), transcribes voice messages via Groq Whisper API, stores unroutable messages in inbox
- `get_inbox` tool — retrieves stored inbox messages with optional status filter and mark-read support
- `reply_telegram` tool — sends freeform replies to Telegram with optional message threading
- Voice transcription support using Groq Whisper API (`whisper-1`) for Telegram voice messages
- Inbox persistence in `logs/inbox.json` (capped at 200 entries) with offset tracking in `logs/telegram_update_offset.json`
- Inbound configuration section in `config/orchestrator/notifications.json`

### Added
- `sync_backlog` tool in backlog-manager MCP for bidirectional backlog synchronization between central and workspace backlogs
- Three-way merge engine (baseline/central/workspace) with conflict detection and HTML comment conflict markers
- Baseline tracking: `pushToWorkspace()` now writes `backlog.md.baseline` for future reconciliation
- Automatic `.gitignore` management to exclude baseline files from version control
- **notifier MCP server** (`mcp-servers/notifier/`) with WhatsApp (CallMeBot) and Discord webhook backends
- `send_notification` tool — sends task event notifications to all enabled backends with duration-aware routing
- `test_notification` tool — verifies backend connectivity
- Rate-limited WhatsApp message queue (2.5s between messages for CallMeBot compliance)
- Notification history logging to `logs/notifications.json` (last 500 entries)
- Config template at `config/orchestrator/notifications.json`

### Fixed
- Config path for `workspaces.json` corrected from `config/workspaces.json` to `config/orchestrator/workspaces.json` in backlog-manager, changelog-writer, and task-dispatcher MCP servers
- Config path for `models.json` corrected in task-dispatcher MCP server

### Changed
- backlog-manager MCP server version bumped from 1.0.0 to 1.1.0
- **notifier MCP server** migrated from WhatsApp (CallMeBot) to Telegram Bot API — MarkdownV2 formatting, no rate-limiting queue needed, bidirectional messaging support for future use
- notifier MCP server version bumped from 1.0.0 to 1.1.0
