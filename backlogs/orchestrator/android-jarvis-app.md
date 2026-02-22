# Android JARVIS App — Voice Command Intake

**Status:** Planned
**Priority:** Medium
**Estimated complexity:** Very Large

---

## Overview

Native Android app that listens for the "Jarvis" wake word, captures speech, and sends it to the JARVIS command processing pipeline (built in the Telegram Command Intake spec) for intent classification and action routing. Supports both English and PT-BR. Provides a minimal, sleek UI with real-time status feedback. This is the second intake channel after Telegram, sharing the same backend pipeline.

## Problem Statement

The Telegram Command Intake Pipeline (Phase 1) provides command intake via text and voice messages, but requires opening Telegram, recording a voice message, and waiting for processing. This has friction:

- Must unlock phone → open Telegram → tap record → speak → release → wait
- Not truly hands-free — can't use while driving or cooking
- No ambient listening — must actively initiate each interaction
- Telegram voice messages have a minimum interaction of ~4 taps

An Android app with always-on wake word detection ("Jarvis") enables true hands-free operation: just say "Jarvis, add to backlog: implement dark mode for PMO dashboard" and it happens.

## Architecture / Components

```
┌─────────────────────────────────────────────────────┐
│                   Android App                        │
│                                                      │
│  [Porcupine Wake Word] ──► [Android STT] ──┐        │
│       "Jarvis"               (on-device)    │        │
│                                             ▼        │
│  ┌──────────────────────────────────────────────┐    │
│  │  Command Display                              │    │
│  │  "Add to backlog: implement dark mode..."    │    │
│  │                                               │    │
│  │  [Send]  [Cancel]  [Re-record]               │    │
│  └──────────────────────────────────────────────┘    │
│                         │                            │
└─────────────────────────┼────────────────────────────┘
                          │ HTTPS POST
                          ▼
              ┌──────────────────────┐
              │  JARVIS Intake API   │
              │  (same pipeline as   │
              │   Telegram intake)   │
              └──────────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │  Action Pipelines    │
              │  • backlog-add       │
              │  • shopping-list     │
              │  • quick-note        │
              └──────────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │  Push Notification   │
              │  → Android app       │
              └──────────────────────┘
```

### Core Components

1. **Wake Word Detection (On-Device)**
   - **Porcupine** (Picovoice) Android SDK — custom "Jarvis" keyword model
   - Runs as a foreground service with persistent notification
   - Near-zero battery impact (~2% per day)
   - Plays acknowledgment tone on detection

2. **Speech-to-Text (On-Device)**
   - Android's built-in `SpeechRecognizer` API (Google STT, free, offline-capable)
   - Language: auto-detect or user preference (EN-US / PT-BR)
   - VAD for automatic endpoint detection (stops listening after silence)
   - Fallback: Groq Whisper API if on-device STT fails

3. **Command Preview & Confirmation**
   - Shows transcribed text before sending
   - Quick actions: Send (confirm), Cancel, Re-record
   - Auto-send option (configurable) — skip confirmation for high-confidence transcriptions
   - Haptic feedback on wake word detection

4. **JARVIS API Client**
   - HTTPS POST to JARVIS intake endpoint (runs on home server)
   - Sends: `{ text, language, source: "android", timestamp }`
   - Receives: `{ status, intent, action_result, message }`
   - Auth: API key stored in Android Keystore
   - Handles offline: queues commands for later delivery

5. **JARVIS Intake API** (server-side, extends Telegram pipeline)
   - New HTTP endpoint alongside existing Telegram polling
   - Accepts commands from any channel (Telegram, Android, future web UI)
   - Routes through the same intent classifier + pipeline router
   - Returns structured response for display in the app

6. **Response Display + Push Notifications**
   - Shows action result in-app (e.g., "Created FEAT-08 in VisionKing backlog")
   - Firebase Cloud Messaging (FCM) for async results (when pipeline takes >5s)
   - Notification with action summary + tap to view details

### UI Design (Minimal)

```
┌─────────────────────────────────┐
│  ╔═══════════════════════════╗  │
│  ║      JARVIS               ║  │
│  ║                           ║  │
│  ║    ◉ Listening...         ║  │
│  ║                           ║  │
│  ║  ┌─────────────────────┐  ║  │
│  ║  │ "Adicionar ao       │  ║  │
│  ║  │  backlog: melhorar  │  ║  │
│  ║  │  testes do backend" │  ║  │
│  ║  └─────────────────────┘  ║  │
│  ║                           ║  │
│  ║  [✓ Send] [✕ Cancel]     ║  │
│  ║  [🔄 Re-record]          ║  │
│  ║                           ║  │
│  ║  ── Recent Commands ──   ║  │
│  ║  ✓ backlog-add: FEAT-08  ║  │
│  ║  ✓ shopping: milk, eggs  ║  │
│  ║  ✕ unknown intent        ║  │
│  ╚═══════════════════════════╝  │
└─────────────────────────────────┘
```

- Dark theme (AMOLED-friendly)
- Single-screen app — no navigation needed
- Large touch targets for quick confirm/cancel
- Command history at bottom

## File Structure

```
# Server-side (extends existing JARVIS)
scripts/telegram-intake/
├── api-server.sh          # HTTP API wrapper around the intake pipeline
└── handlers/              # (shared with Telegram — already exists)

config/telegram-intake/
├── pipelines.json         # (shared, already exists)
└── api-keys.json          # API key registry for Android + future clients

# Android app (new repository)
android-jarvis/
├── app/
│   ├── src/main/
│   │   ├── java/com/jarvis/app/
│   │   │   ├── MainActivity.kt
│   │   │   ├── WakeWordService.kt        # Foreground service with Porcupine
│   │   │   ├── SpeechRecognizerHelper.kt # On-device STT wrapper
│   │   │   ├── JarvisApiClient.kt        # HTTP client for intake API
│   │   │   ├── CommandQueue.kt           # Offline command queue
│   │   │   └── NotificationHandler.kt    # FCM push notifications
│   │   ├── res/
│   │   │   ├── layout/activity_main.xml
│   │   │   ├── values/strings.xml        # EN strings
│   │   │   ├── values-pt-rBR/strings.xml # PT-BR strings
│   │   │   └── raw/jarvis_wakeword.ppn   # Porcupine keyword model
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts
├── build.gradle.kts
└── settings.gradle.kts
```

## MCP Tools / Skills

**Existing tools reused:**
- Intent classifier from Telegram Command Intake Pipeline
- Pipeline router from Telegram Command Intake Pipeline
- `reply_telegram` (for cross-channel notifications, optional)

**New components:**
- HTTP intake API endpoint (lightweight, could be Express.js or Flask)
- API key authentication middleware

## Implementation Phases

1. **Phase 1: JARVIS Intake HTTP API** (~8h)
   - Extract the intent classification + pipeline routing from the Telegram-specific scripts into a generic API
   - Build a simple HTTP server (Express.js or Python Flask) that accepts POST requests
   - Endpoint: `POST /api/command` with `{ text, language, source, api_key }`
   - API key auth with key stored in `config/telegram-intake/api-keys.json`
   - Return: `{ status, intent, confidence, action_result, message }`
   - Deploy alongside existing JARVIS services

2. **Phase 2: Android App — Wake Word + STT** (~12h)
   - New Android project (Kotlin, min SDK 26 / Android 8.0)
   - Integrate Porcupine Android SDK with custom "Jarvis" keyword
   - Foreground service with persistent notification ("JARVIS listening...")
   - On wake word: activate Android `SpeechRecognizer` for on-device STT
   - Display transcribed text in main activity
   - Battery optimization whitelist request

3. **Phase 3: Android App — API Integration** (~10h)
   - Build `JarvisApiClient` with Retrofit/OkHttp
   - API key stored in Android Keystore (encrypted)
   - Send command → display result
   - Offline queue: store commands in Room DB, retry when connection available
   - Loading states, error handling, timeout management

4. **Phase 4: Push Notifications + Polish** (~8h)
   - Firebase Cloud Messaging integration
   - Server sends push notification for async pipeline results
   - Dark theme implementation (Material 3, AMOLED-optimized)
   - Bilingual UI strings (EN + PT-BR)
   - Command history view (last 20 commands, stored in Room DB)
   - Settings: auto-send toggle, language preference, server URL config

5. **Phase 5: Testing + Release** (~6h)
   - Unit tests for API client, command queue, speech recognizer wrapper
   - Integration test: wake word → STT → API → result display
   - Manual testing on physical device (Samsung, Pixel)
   - Build signed APK / AAB
   - Internal distribution via Firebase App Distribution or direct APK

## Testing Strategy

- **Server API**: curl-based integration tests (send test commands, verify responses)
- **Wake Word**: Manual testing in quiet + noisy environments
- **STT Accuracy**: Test with 20 commands in EN + 20 in PT-BR, measure transcription accuracy
- **End-to-end**: Voice command → backlog entry created → push notification received
- **Offline mode**: Airplane mode → queue command → re-enable → verify delivery
- **Battery**: 24h battery test with wake word service running

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1: Intake HTTP API | 8 | Telegram Command Intake Pipeline (Phase 3) |
| Phase 2: Wake Word + STT | 12 | Porcupine license (free tier available) |
| Phase 3: API Integration | 10 | Phase 1 + Phase 2 |
| Phase 4: Notifications + Polish | 8 | Phase 3, Firebase project |
| Phase 5: Testing + Release | 6 | Phase 4 |
| **Total** | **44** | |

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Porcupine free tier limits | Can't ship custom wake word | Use free "Jarvis" keyword (included in Porcupine demos), or pay $5/mo for custom |
| Android battery drain from always-on mic | Users disable the app | Porcupine is DSP-optimized (~2% battery/day), document battery impact |
| Home server not reachable from mobile network | Commands fail outside home | Expose API via Tailscale/WireGuard VPN, or use Cloudflare Tunnel |
| On-device STT accuracy for PT-BR | Misheard commands | Preview + confirm step before sending, Groq Whisper fallback for low confidence |
| Google Play Store restrictions on background mic access | Can't publish to Play Store | Distribute via APK sideload or Firebase App Distribution (internal use) |
| Latency: wake → response > 10s | Poor user experience | On-device STT (~1s) + API call (~2s) + pipeline (~3s) = ~6s target |
