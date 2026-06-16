# Notifier

## Purpose
Sends notifications about task events to Telegram and Discord backends, with domain-based bot routing, duration classification, and message formatting. Also handles inbound Telegram messages: polls for new messages, parses commands (/status, /dispatch, /cancel), transcribes voice messages via Deepgram/Groq/OpenAI Whisper, and maintains an inbox for unroutable messages.

## MCP Tools
- **send_notification** — Send a notification about a task event (completed/failed/started/timeout) to all enabled backends with model info and duration
- **test_notification** — Send a test message to verify backend configuration, optionally testing a specific routing domain
- **check_telegram_inbox** — Poll Telegram for new inbound messages; parses commands, transcribes voice messages, stores non-command messages in inbox
- **get_inbox** — Retrieve stored inbox messages, optionally filtered by status (pending/read) and marking as read
- **reply_telegram** — Send a freeform reply message to the user on Telegram, optionally threading to a specific message

## Tech Stack
- Node.js (ESM), @modelcontextprotocol/sdk
- Telegram Bot API, Discord Webhooks
- Voice transcription: Deepgram, Groq Whisper, or OpenAI Whisper

## Configuration
- Notifications config: `config/orchestrator/notifications.json` (enabled backends, event toggles, duration thresholds)
- Bot registry: `config/orchestrator/telegram-bots.json` (multi-bot routing by domain)
- Bot token: `~/.secrets/telegram-bot-token` (referenced via `bot_token_file`)
- Voice transcription API key: configured per provider in notifications.json (file-based or env var)
- Notification log: `logs/notifications.json` (last 500 entries)
- Inbox: `logs/inbox.json` (last 200 messages)
- Update offset: `logs/telegram_update_offset.json`

## Integration Points
- Task-dispatcher and shell scripts call send_notification on task completion/failure
- Bot manager routes notifications to different Telegram bots by domain (vk-health, task-dispatch, morning-report, pr-review, inbound)
- Morning report and VK health scripts use the Telegram notification backend
- Inbound commands can trigger task dispatches

## Key Files
- `index.js` — Single-file server (~910 lines) with Telegram/Discord backends, voice transcription, command parsing, and inbox management
