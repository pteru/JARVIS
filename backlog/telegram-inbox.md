# Telegram Bidirectional Messaging + Inbox

## Status: Done (v1.2.0)

## Summary
Extend the notifier MCP server with inbound Telegram message handling: command parsing, voice transcription via Groq Whisper, and an inbox for unroutable messages.

## New MCP Tools

### `check_telegram_inbox`
- Polls Telegram `getUpdates` with stored offset
- Filters to configured `chat_id` only (security)
- Parses commands: `/status`, `/dispatch <ws> <task>`, `/cancel <id>`
- Voice messages: downloads `.ogg`, transcribes via Groq Whisper API
- Unroutable messages stored in `logs/inbox.json`
- Sends Telegram reply confirming receipt

### `get_inbox`
- Reads `logs/inbox.json`, returns pending messages
- Optional `status` filter and `mark_read` flag

### `reply_telegram`
- Sends a freeform reply to user on Telegram
- Supports `reply_to_message_id` for threading

## Storage
- `logs/inbox.json` — capped at 200 entries
- `logs/telegram_update_offset.json` — getUpdates pagination offset

## Voice Transcription
- Groq Whisper API (`whisper-1`) — ~$0.006/min
- API key via `GROQ_API_KEY` env var
- Configurable in `config/orchestrator/notifications.json` under `backends.telegram.inbound`
