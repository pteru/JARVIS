# Spec: Push Notifications for Task Completion

**Status:** Implemented
**Type:** New MCP Server + Integration

## Overview

Send real-time push notifications via Telegram when dispatched tasks complete or fail. Uses the Telegram Bot API as the primary backend (free, rich formatting, bidirectional messaging support) with Discord webhooks as an optional secondary channel for team visibility. Notifications include task details, execution time, and status, with duration-aware routing that escalates long-running tasks to higher priority.

The notifier MCP server is backend-agnostic — backends are swappable via config. Telegram was chosen over CallMeBot/WhatsApp for its bidirectional capabilities (user can message Jarvis back), voice message support (future STT integration), and reliability.

---

## Design

### Notification Backends

#### 1. Telegram Bot API (Primary)
- **Protocol:** HTTP POST to `https://api.telegram.org/bot<TOKEN>/sendMessage`
- **Delivery:** Fire-and-forget; response parsed for success confirmation
- **Use case:** Personal notifications + bidirectional messaging with Jarvis
- **Setup:** Create bot via @BotFather, get token, send `/start` to get chat_id
- **Rate limit:** 30 messages/second (effectively unlimited for our use case)
- **Message format:** MarkdownV2 with bold, code blocks, and emoji support
- **Future:** Inbound messages via `getUpdates` long-polling for bidirectional control; voice messages via Whisper/Deepgram STT

#### 2. Discord Webhook (Optional, Team Channel)
- **Protocol:** HTTP POST to Discord webhook URL
- **Delivery:** Fire-and-forget; optionally log failures
- **Use case:** Team notifications, async updates to stakeholders
- **Features:**
  - Rich embeds with color-coded status (green = success, red = failure, orange = warning)
  - Structured fields (workspace, model, duration, task description)
  - Mentions/role pings for critical failures

### Duration-Aware Routing

Tasks are classified by execution duration to adjust notification urgency:

| Duration | Category | WhatsApp Behavior | Discord Behavior |
|----------|---------|-------------------|------------------|
| < 2 min  | Quick   | Standard message | Silent embed (no ping) |
| 2-10 min | Standard| Standard message | Standard embed |
| 10-30 min| Long    | Prefixed with ⚠️ | Highlighted embed |
| > 30 min | Extended| Prefixed with 🚨 | Mention operator role + embed |

### Bidirectional Messaging (Future)

Telegram supports inbound messages via the `getUpdates` long-polling API. This enables:
- **Text commands:** Reply to Jarvis to query task status, cancel tasks, or trigger dispatches
- **Voice messages:** Send `.ogg` Opus voice notes, transcribed via Whisper/Deepgram/Google STT
- No public webhook or server required — long-polling works from the MCP server process

### Notification Trigger Points

| Event | When | Include in Notification |
|-------|------|------------------------|
| **Task Completed** | After successful execution | workspace, duration, model, task excerpt |
| **Task Failed** | On error/timeout | workspace, error message, duration, log path |
| **Task Timeout** | Exceeds configurable max duration (default: 60 min) | workspace, partial output, warning |
| **Task Started** | Immediately after dispatch (disabled by default) | workspace, task description, model |

---

## Implementation Steps

### Phase 1: Core Notifier MCP Server

**File:** `/home/teruel/JARVIS/mcp-servers/notifier/index.js`

1. **Scaffold MCP Server**
   - Initialize new Node.js MCP server using `@modelcontextprotocol/sdk`
   - Follow existing patterns from `/home/teruel/JARVIS/mcp-servers/task-dispatcher/index.js`
   - Set up stdio transport and error handling

2. **Configuration Schema**
   - Create `/home/teruel/JARVIS/config/orchestrator/notifications.json`:
     ```json
     {
       "enabled": true,
       "backends": {
         "telegram": {
           "enabled": true,
           "bot_token": "YOUR_BOT_TOKEN",
           "chat_id": "YOUR_CHAT_ID"
         },
         "discord": {
           "enabled": false,
           "webhook_url": "",
           "mention_role_id": null,
           "silent_threshold_minutes": 2
         }
       },
       "duration_thresholds": {
         "quick_max": 120,
         "standard_max": 600,
         "long_max": 1800,
         "timeout": 3600
       },
       "events": {
         "task_started": false,
         "task_completed": true,
         "task_failed": true,
         "task_timeout": true
       }
     }
     ```

3. **Implement Backend Handlers**
   - **Telegram Bot API handler:**
     ```javascript
     async sendTelegram(config, text) {
       const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
       const res = await fetch(url, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ chat_id: config.chat_id, text, parse_mode: "MarkdownV2" }),
         signal: AbortSignal.timeout(10000),
       });
       const data = await res.json();
       return { success: data.ok };
     }
     ```
   - **Discord handler:**
     - HTTP POST to webhook URL with JSON embed payload
     - Color-coded status, structured fields
     - Conditionally add role mention for extended/failed tasks
   - Both handlers are fire-and-forget — failures are logged but never block

4. **Message Formatting**
   - **Telegram messages** (MarkdownV2 formatted):
     ```
     ✅ *Task completed* — api-backend
     Refactor authentication module
     🕒 Duration: 15m 30s | Model: sonnet-4.5
     ```
     For failures:
     ```
     ❌ *Task failed* — api-backend
     Implement payment gateway
     📋 Error: `Missing API credentials`
     🕒 Duration: 8m 12s | Model: opus-4.6
     ```
     For extended tasks (> 30 min):
     ```
     🚨 *Long task completed* — api-backend
     Full codebase refactor
     🕒 Duration: 42m 18s | Model: opus-4.6
     ```
   - **Discord embeds:** Color-coded, structured fields, timestamps

### Phase 2: Integration with task-dispatcher

**File:** `/home/teruel/JARVIS/mcp-servers/task-dispatcher/index.js`

5. **Instrument Dispatch Lifecycle**
   - After task status changes (via future `update_task_status` tool from the task-lifecycle-tracking spec), call `send_notification` with the appropriate event
   - Calculate `duration_seconds` from dispatch `created_at` to now
   - Store `notification_sent` flag in dispatch record

### Phase 3: Optional Enhancements

6. **Rate Limiting** — CallMeBot allows ~1 msg/2s; queue messages and flush with delay if multiple tasks complete simultaneously
7. **Notification History** — Log all sent notifications to `/home/teruel/JARVIS/logs/notifications.json`
8. **Batching** — Group multiple quick task completions into a single summary message (configurable batch window)
9. **DND Mode** — Config toggle to suppress all notifications during specified hours

---

## MCP Tool Interface

### `send_notification`

Sends a notification about a task event to all enabled backends.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "event_type": {
      "type": "string",
      "enum": ["task_completed", "task_failed", "task_started", "task_timeout"],
      "description": "Type of task event"
    },
    "workspace": {
      "type": "string",
      "description": "Workspace name"
    },
    "message": {
      "type": "string",
      "description": "Task description or summary"
    },
    "duration_seconds": {
      "type": "number",
      "description": "Task execution duration in seconds"
    },
    "metadata": {
      "type": "object",
      "description": "Optional: model, task_id, error, changelog_path"
    }
  },
  "required": ["event_type", "workspace", "message"]
}
```

**Output:**
```json
{
  "content": [{
    "type": "text",
    "text": "{\"backends_notified\": [\"telegram\"], \"errors\": []}"
  }]
}
```

### `test_notification`

Sends a test notification to verify backend configuration.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "backend": {
      "type": "string",
      "enum": ["telegram", "discord", "all"],
      "description": "Which backend to test"
    }
  },
  "required": ["backend"]
}
```

---

## Edge Cases & Risks

### Edge Cases

1. **Burst of Completions** — Multiple tasks complete within seconds
   - Telegram allows 30 msg/s so no queuing needed; send immediately

2. **Very Short Tasks (< 5 seconds)** — Task completes before "started" notification
   - Skip "started" notification; only send completion

3. **Telegram API Down**
   - Log failure, continue task execution. Notifications are non-critical.

4. **Bot Token Rotation**
   - Revoke via @BotFather `/revoke`, get new token, update `notifications.json`

5. **Sensitive Information in Task Descriptions**
   - Implement optional message sanitization (redact patterns like `token=...`, `password=...`)

### Risks

1. **Telegram API Reliability** — Free service, but highly reliable with 99.9%+ uptime
   - **Mitigation:** Design for swappable backends. If needed, swap to Twilio or other providers

2. **Notification Fatigue** — Too many messages
   - **Mitigation:** Default to only completed + failed events; duration-aware routing suppresses low-priority quick tasks

3. **Bot Token Leakage** — Telegram bot token in config file
   - **Mitigation:** `notifications.json` is in `.gitignore`; environment variables as alternative

4. **Notification Spam from Misconfigured Schedules**
   - **Mitigation:** Event toggle in config; alert if threshold exceeded

---

## Dependencies & Prerequisites

### External Dependencies
- `@modelcontextprotocol/sdk` (already present)
- Node.js built-in `fetch` (Node 18+, no additional packages)

### Configuration Files
- **New:** `/home/teruel/JARVIS/config/orchestrator/notifications.json`

### User Setup (One-Time)
1. Open Telegram and search for **@BotFather**
2. Send `/newbot`, choose a name (e.g. "Jarvis Notifier") and username (e.g. `jarvis_orchestrator_bot`)
3. Copy the bot token from BotFather's reply
4. Open a chat with your new bot and send `/start`
5. Get your chat ID by visiting `https://api.telegram.org/bot<TOKEN>/getUpdates` — your chat_id is in `result[0].message.chat.id`
6. Add `bot_token` and `chat_id` to `config/orchestrator/notifications.json`
7. Run `test_notification` tool with backend `telegram` to verify delivery

### MCP Server Registration
Add to `~/.claude/config.json`:
```json
{
  "mcpServers": {
    "notifier": {
      "command": "node",
      "args": ["/home/teruel/JARVIS/mcp-servers/notifier/index.js"],
      "env": {
        "ORCHESTRATOR_HOME": "/home/teruel/JARVIS"
      }
    }
  }
}
```

### Integration Points
- **Reads from:** `config/orchestrator/notifications.json`, `logs/dispatches.json`
- **Writes to:** `logs/notifications.json` (history, optional)
- **Called by:** task-dispatcher after status changes

---

## Future Enhancements

- **Bidirectional messaging:** Implement `getUpdates` long-polling to receive inbound Telegram messages and route to orchestrator commands
- **Voice-to-text:** Transcribe Telegram voice messages via Whisper/Deepgram/Google STT for hands-free task dispatch
- **Slack integration:** Add as third backend option
- **Twilio fallback:** Add WhatsApp via Twilio as backup backend for paid reliability
- **Web dashboard integration:** Display recent notifications in the orchestrator dashboard
- **Notification rules engine:** User-defined rules (e.g., "only notify for high-priority workspaces", "mute on weekends")
