# Telegram Command Intake Pipeline

**Status:** Planned
**Priority:** High
**Estimated complexity:** Large

---

## Overview

Turn the existing Telegram bot into a command intake channel that captures voice and text messages, classifies intent using an NLP pipeline, and routes commands to action pipelines (starting with `/backlog-add`). Supports both English and PT-BR input. This creates the shared intent classification + routing layer that the Android app (and future intake channels) will also use.

## Problem Statement

Today, JARVIS has a Telegram integration (v1.2.0) that handles inbound message polling, basic command parsing, and voice transcription via Groq Whisper. However:

- Messages land in a passive inbox — they're stored but not acted upon automatically
- There's no intent classification: "add pytest to visionking backend" and "buy milk" look the same
- No routing to action pipelines — a user can't say "JARVIS, add to backlog: implement dark mode" and have it create a backlog entry
- No bilingual support for intent detection (PT-BR commands are common)

The goal is to build a **command processing pipeline** that sits between Telegram message reception and JARVIS action execution, enabling hands-free task dispatch from a phone.

## Architecture / Components

```
                         ┌──────────────────────┐
[Telegram Bot]           │  Intake Router       │
  ├─ Text messages ──────►                      │
  └─ Voice messages ─┐   │  1. Language detect  │    ┌─────────────────┐
                      │   │  2. STT (if audio)  │    │ Action Pipelines│
  [Android App]       │   │  3. Intent classify  ├───►│                 │
  └─ Audio stream ────┘   │  4. Entity extract  │    │ • backlog-add   │
                          │  5. Route to pipe   │    │ • shopping-list │
  [Future channels...]    │  6. Confirm + reply  │    │ • reminder      │
                          └──────────────────────┘    │ • quick-note    │
                                                      │ • ...           │
                                                      └─────────────────┘
```

### Core Components

1. **Message Receiver** (extends existing `check_telegram_inbox` MCP tool)
   - Hooks into the existing Telegram polling loop
   - Detects "command" messages vs casual conversation
   - Trigger: messages starting with "JARVIS" / "Jarvis" / `/j` prefix, or voice messages

2. **Language Detector**
   - Detects EN vs PT-BR from message text
   - Uses `langdetect` or simple heuristic (PT-BR has "ç", "ã", "ê", common words)
   - Tags message with detected language for downstream processing

3. **Speech-to-Text** (for voice messages)
   - Reuses existing Groq Whisper integration from Telegram inbox v1.2.0
   - Passes `language` hint to Whisper for better accuracy
   - Returns transcribed text + detected language

4. **Intent Classifier**
   - Uses `claude --print` with a focused system prompt for intent classification
   - Input: transcribed/typed text + language tag
   - Output: `{ intent: string, entities: object, confidence: number }`
   - Supported intents (extensible):
     - `backlog_add` → route to `/backlog-add` skill
     - `shopping_list` → append to shopping list file
     - `reminder` → create a reminder (future)
     - `quick_note` → append to daily notes
     - `status_check` → query system status
     - `unknown` → ask for clarification
   - Bilingual: understands "adicionar ao backlog" = "add to backlog"

5. **Pipeline Router**
   - Maps classified intent → action handler
   - Each handler is a function that:
     - Extracts relevant entities from the classifier output
     - Calls the appropriate JARVIS tool/skill
     - Returns a confirmation message (in the user's detected language)
   - First pipeline: `backlog_add` → calls `claude --print` with `/backlog-add` skill context

6. **Response Handler**
   - Sends confirmation back to the user via Telegram (`reply_telegram` MCP tool)
   - Responds in the same language as the input
   - Includes action summary (e.g., "Added to VisionKing backlog: TEST-03 — Add pytest coverage")

## File Structure

```
scripts/telegram-intake/
├── intake.sh              # Main entry point (cron-triggered or daemon)
├── classify-intent.sh     # Calls claude --print with classifier prompt
├── route-pipeline.sh      # Routes classified intent to handler
├── handlers/
│   ├── backlog-add.sh     # Handler for backlog_add intent
│   ├── shopping-list.sh   # Handler for shopping_list intent
│   └── quick-note.sh      # Handler for quick_note intent
├── prompts/
│   ├── intent-classifier.md   # System prompt for intent classification
│   └── entity-extractor.md   # System prompt for entity extraction
└── config.json            # Pipeline configuration (enabled intents, language prefs)

config/telegram-intake/
└── pipelines.json         # Pipeline registry: intent → handler mapping
```

## MCP Tools / Skills

**Existing tools used:**
- `check_telegram_inbox` — poll for new messages
- `reply_telegram` — send response back
- Groq Whisper — voice transcription (already integrated)

**New MCP tools (optional, if we want programmatic access):**
- `classify_intent` — classify a text string into intent + entities
- `route_command` — process a command through the full pipeline

**Skills used:**
- `/backlog-add` — first action pipeline target

## Implementation Phases

1. **Phase 1: Command Detection + Language Detection** (~4h)
   - Extend Telegram polling to detect command-prefixed messages ("JARVIS ...", `/j ...`)
   - Add language detection (EN/PT-BR)
   - Voice messages: reuse existing Groq Whisper transcription
   - Log detected commands to `logs/telegram-intake.json`

2. **Phase 2: Intent Classifier** (~6h)
   - Create classifier prompt (bilingual, ~20 intent examples per language)
   - Call `claude --print` with Haiku for fast, cheap classification
   - Parse structured JSON output: `{ intent, entities, confidence, language }`
   - Add confidence threshold (>0.7 → auto-route, <0.7 → ask for clarification)

3. **Phase 3: Pipeline Router + Backlog Handler** (~8h)
   - Build router that maps intent → handler script
   - Implement `backlog-add` handler:
     - Extract item description + product hints from entities
     - Call `claude --print` with `/backlog-add` context to create the backlog entry
     - Return structured result (spec file path, task code, etc.)
   - Send confirmation via `reply_telegram`

4. **Phase 4: Additional Handlers + Polish** (~6h)
   - Implement `shopping-list` handler (append to `data/shopping-list.md`)
   - Implement `quick-note` handler (append to daily notes)
   - Add bilingual response templates (EN + PT-BR)
   - Error handling: graceful failures with user-friendly messages
   - Add `/pipelines` status command to list available intents

5. **Phase 5: Cron/Daemon Mode + Monitoring** (~4h)
   - Option A: Cron-based polling (every 30s–1min)
   - Option B: Long-polling daemon with systemd service
   - Add dispatch logging to `dispatches.json`
   - Add basic metrics (commands processed, intents distribution, error rate)

## Testing Strategy

- **Unit tests**: Intent classifier accuracy on 50+ bilingual test cases (25 EN, 25 PT-BR)
- **Integration test**: Send test Telegram message → verify backlog entry created
- **Bilingual test**: Same command in EN and PT-BR → same intent classification
- **Edge cases**: Empty messages, very long messages, mixed-language messages, low-confidence intents
- **Manual smoke test**: Send voice message in PT-BR → verify transcription → classification → backlog entry

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1: Command + Language Detection | 4 | Existing Telegram integration |
| Phase 2: Intent Classifier | 6 | Phase 1 |
| Phase 3: Pipeline Router + Backlog Handler | 8 | Phase 2, `/backlog-add` skill |
| Phase 4: Additional Handlers | 6 | Phase 3 |
| Phase 5: Cron/Daemon + Monitoring | 4 | Phase 4 |
| **Total** | **28** | |

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Groq Whisper latency on long voice messages | Slow response (>10s) | Set max voice duration (60s), use streaming if available |
| Intent classifier hallucinating intents | Wrong action executed | Confidence threshold + confirmation prompt for destructive actions |
| PT-BR intent classification accuracy | Misrouted commands | Include 25+ PT-BR examples in classifier prompt, test extensively |
| Telegram polling rate limits | Missed messages | Use long polling, respect Telegram API limits (30 req/s) |
| `claude --print` cost for every message | Unexpected API spend | Use Haiku for classification (~$0.001/call), only Sonnet for action execution |
