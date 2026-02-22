# Telegram Bot Manager — Multi-Bot Notification Routing

**Status:** Planned
**Priority:** Medium
**Estimated complexity:** Medium

---

## Overview

Replace the current single-bot, single-chat Telegram notification setup with a multi-bot manager that routes notifications to separate bots/channels based on their source domain. Each domain (health monitoring, task dispatches, daily reports, command intake, etc.) gets its own Telegram bot with a dedicated chat, so users can mute, prioritize, or filter notification streams independently.

## Problem Statement

Today, all JARVIS notifications flow through one bot (`8551367137`) to one group chat (`-5179349649`):

- **VK health alerts** (critical disk/RAM/GPU warnings) compete with **morning briefings**
- **Task dispatch results** (completed/failed) sit alongside **command intake confirmations**
- As new sources are added (Telegram Command Intake Pipeline, Android app responses, backlog-add confirmations, shopping list updates), the single channel will become increasingly noisy
- Users can't mute low-priority notifications (morning reports) without also muting critical ones (health alerts)
- No way to route specific notification types to different people or groups

The shell scripts (`scripts/vk-health/lib/telegram.sh`, `scripts/morning-report.sh`) and the MCP server (`mcp-servers/notifier/index.js`) all independently read from `config/orchestrator/notifications.json` and use the same bot token + chat ID.

## Architecture / Components

### Bot Registry

A new config file `config/orchestrator/telegram-bots.json` that maps domains to bots:

```json
{
  "bots": {
    "jarvis-alerts": {
      "token": "BOT_TOKEN_1",
      "description": "Critical alerts and health monitoring",
      "domains": ["vk-health", "gpu-watchdog"]
    },
    "jarvis-ops": {
      "token": "BOT_TOKEN_2",
      "description": "Task dispatches, PR reviews, cron results",
      "domains": ["dispatch", "pr-review", "cron"]
    },
    "jarvis-assistant": {
      "token": "BOT_TOKEN_3",
      "description": "Command intake, backlog-add, shopping list, notes",
      "domains": ["command-intake", "backlog-add", "shopping-list", "quick-note"]
    },
    "jarvis-daily": {
      "token": "BOT_TOKEN_4",
      "description": "Morning reports, weekly summaries, trends",
      "domains": ["morning-report", "weekly-report", "trends"]
    }
  },
  "channels": {
    "alerts": {
      "chat_id": "-CHAT_ID_ALERTS",
      "bot": "jarvis-alerts",
      "description": "Critical notifications only"
    },
    "operations": {
      "chat_id": "-CHAT_ID_OPS",
      "bot": "jarvis-ops",
      "description": "Dispatch and PR review results"
    },
    "assistant": {
      "chat_id": "PERSONAL_CHAT_ID",
      "bot": "jarvis-assistant",
      "description": "Personal assistant interactions"
    },
    "reports": {
      "chat_id": "-CHAT_ID_REPORTS",
      "bot": "jarvis-daily",
      "description": "Scheduled reports and summaries"
    }
  },
  "routing": {
    "vk-health": { "channel": "alerts", "priority": "high" },
    "gpu-watchdog": { "channel": "alerts", "priority": "critical" },
    "dispatch": { "channel": "operations", "priority": "medium" },
    "pr-review": { "channel": "operations", "priority": "medium" },
    "command-intake": { "channel": "assistant", "priority": "medium" },
    "backlog-add": { "channel": "assistant", "priority": "low" },
    "shopping-list": { "channel": "assistant", "priority": "low" },
    "morning-report": { "channel": "reports", "priority": "low" },
    "weekly-report": { "channel": "reports", "priority": "low" }
  },
  "defaults": {
    "fallback_bot": "jarvis-ops",
    "fallback_channel": "operations"
  }
}
```

### Routing Logic

```
[Notification Source]
       │
       ▼
┌─────────────────┐
│  Bot Manager     │
│                  │
│  1. Identify     │──► domain from caller (e.g. "vk-health")
│     domain       │
│                  │
│  2. Look up      │──► routing table → channel + bot
│     route        │
│                  │
│  3. Select bot   │──► bot token from registry
│     + channel    │
│                  │
│  4. Send via     │──► Telegram Bot API with correct token + chat_id
│     Telegram API │
│                  │
│  5. Log with     │──► logs/notifications.json (existing, add domain field)
│     domain tag   │
└─────────────────┘
```

### Components to Modify

1. **`mcp-servers/notifier/index.js`** — The core notification MCP server
   - Add `domain` parameter to `send_notification` tool
   - Load bot registry from `telegram-bots.json`
   - Route to correct bot + channel based on domain
   - Backward compatible: if no domain specified, use `defaults.fallback_bot`
   - Add new `list_bots` tool to show registered bots and their domains

2. **`scripts/vk-health/lib/telegram.sh`** — VK health alert sender
   - Accept optional `$DOMAIN` parameter (default: `vk-health`)
   - Read bot token + chat ID from `telegram-bots.json` routing table
   - Fallback to `notifications.json` if `telegram-bots.json` doesn't exist (backward compat)

3. **`scripts/morning-report.sh`** — Morning briefing sender
   - Use domain `morning-report` to route to the reports channel/bot

4. **`config/orchestrator/notifications.json`** — Keep as fallback/legacy
   - Add `"bot_manager_enabled": true/false` toggle
   - When disabled, everything works as today (single bot)
   - When enabled, routing defers to `telegram-bots.json`

### Shared Library

Create `lib/telegram-router.sh` as a shared helper:

```bash
# Usage: send_routed_telegram "domain" "message"
# Reads telegram-bots.json, resolves bot+channel, sends via API
send_routed_telegram() {
  local domain="$1"
  local message="$2"
  # ... resolve bot token + chat_id from routing table
  # ... POST to Telegram API
}
```

All shell scripts (`alert.sh`, `morning-report.sh`, future scripts) source this instead of duplicating Telegram API calls.

## File Structure

```
config/orchestrator/
├── notifications.json          # EXISTING — add bot_manager_enabled toggle
└── telegram-bots.json          # NEW — bot registry, channels, routing

lib/
└── telegram-router.sh          # NEW — shared shell helper for routed sends

mcp-servers/notifier/
└── index.js                    # MODIFY — add domain-based routing

scripts/vk-health/lib/
└── telegram.sh                 # MODIFY — use routed sends

scripts/
└── morning-report.sh           # MODIFY — use routed sends

scripts/helpers/
└── create-telegram-bot.sh      # NEW — helper to create a new bot via BotFather + register
```

## MCP Tools / Skills

**Modified tools:**
- `send_notification` — add optional `domain` parameter for routing
- `reply_telegram` — add optional `bot` parameter to reply via specific bot

**New tools:**
- `list_bots` — list all registered bots with their domains and channels

## Implementation Phases

1. **Phase 1: Bot Registry + Router Library** (~4h)
   - Create `telegram-bots.json` schema and initial config (can start with 1 bot, expand later)
   - Create `lib/telegram-router.sh` shared helper
   - Create `scripts/helpers/create-telegram-bot.sh` helper (automates BotFather instructions + registration)
   - Add `bot_manager_enabled` toggle to `notifications.json`
   - All backward compatible — toggle defaults to `false`

2. **Phase 2: MCP Server Migration** (~4h)
   - Add `domain` parameter to `send_notification` tool in `notifier/index.js`
   - Add bot registry loading + routing logic
   - Add `list_bots` tool
   - Update `reply_telegram` to support bot selection
   - Keep backward compat: missing domain → fallback bot

3. **Phase 3: Shell Script Migration** (~3h)
   - Migrate `scripts/vk-health/lib/telegram.sh` to use `send_routed_telegram`
   - Migrate `scripts/morning-report.sh` to use `send_routed_telegram`
   - Migrate `scripts/vk-health/alert.sh` alert calls
   - Test each script individually

4. **Phase 4: Create Bots + Go Live** (~3h)
   - Create 3–4 Telegram bots via BotFather (jarvis-alerts, jarvis-ops, jarvis-assistant, jarvis-daily)
   - Add bots to appropriate group chats
   - Populate `telegram-bots.json` with real tokens and chat IDs
   - Enable `bot_manager_enabled: true`
   - Monitor for 24h to verify routing

## Testing Strategy

- **Unit test**: `send_routed_telegram "vk-health" "test"` → verify correct bot token + chat ID used
- **Fallback test**: Remove `telegram-bots.json` → verify fallback to `notifications.json` single-bot mode
- **Toggle test**: Set `bot_manager_enabled: false` → verify single-bot behavior preserved
- **Domain coverage**: Send test notification for each domain → verify arrives in correct channel
- **Unknown domain test**: Send notification with unregistered domain → verify fallback channel used
- **MCP integration**: Call `send_notification` with `domain: "vk-health"` → verify routing
- **End-to-end**: Trigger VK health alert → arrives in alerts channel, not operations channel

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1: Registry + Router Library | 4 | — |
| Phase 2: MCP Server Migration | 4 | Phase 1 |
| Phase 3: Shell Script Migration | 3 | Phase 1 |
| Phase 4: Create Bots + Go Live | 3 | Phase 2 + Phase 3 |
| **Total** | **14** | |

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| BotFather rate limits on bot creation | Can't create all bots at once | Create bots one at a time, space out by minutes |
| Telegram group chat bot limits | Bots can't be added to groups | Use separate group chats per domain, or use channels instead |
| Credential management for 4+ bot tokens | Security surface increases | Store tokens in `~/.secrets/telegram-bots.json`, not in repo. Config references secret file path. |
| Backward compatibility break | Existing scripts stop working | Toggle-based migration: `bot_manager_enabled` must be explicitly set to `true` |
| Too many Telegram chats to monitor | User notification fatigue shifts from noise to fragmentation | Start with 2–3 bots (alerts + everything else), expand only when needed |
