# DISPLAY-01: VisionKing Display App — Android TV Kiosk + Bidirectional Server Communication

## Overview

Android TV application for 75" Smart TV (Google TV / TCL 75P7K) that displays the VisionKing frontend in kiosk mode and maintains bidirectional communication with the Boxer-6641 backend via WebSocket. Includes anti burn-in measures and remote management capabilities.

**Target hardware:** TCL 75P7K (QLED, Google TV, ~R$ 4.230)
**Target deployment:** 03008 — Estação de Inspeção de Sealer, Hyundai Piracicaba
**Network:** TV connected via Ethernet to switch interno (porta 5), same subnet as Boxer-6641

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Smart TV (Google TV)                │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │           VK Display App (Kotlin)                │ │
│  │                                                   │ │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │ │
│  │  │ WebView  │  │ WS Client│  │ Burn-in Guard │ │ │
│  │  │ (Kiosk)  │  │ (OkHttp) │  │ (Pixel Shift) │ │ │
│  │  └────┬─────┘  └────┬─────┘  └───────┬───────┘ │ │
│  │       │              │                │          │ │
│  └───────┼──────────────┼────────────────┼──────────┘ │
│          │              │                │            │
└──────────┼──────────────┼────────────────┼────────────┘
           │              │                │
      HTTP :80       WS :3000         CSS inject
           │              │
    ┌──────┴──────────────┴──────────────────────┐
    │            Boxer-6641 (Ubuntu)               │
    │                                               │
    │  ┌─────────────┐  ┌────────────────────────┐ │
    │  │  Frontend    │  │  Backend (NestJS)       │ │
    │  │  (Angular)   │  │                         │ │
    │  │  :80         │  │  ┌──────────────────┐  │ │
    │  │              │  │  │ display-manager   │  │ │
    │  │              │  │  │ WS Gateway :3000  │  │ │
    │  │              │  │  │ REST /api/v1/     │  │ │
    │  │              │  │  │   displays        │  │ │
    │  │              │  │  └──────────────────┘  │ │
    │  └──────────────┘  └────────────────────────┘ │
    └───────────────────────────────────────────────┘
```

---

## Component 1: Android TV App (`apps/display-tv/`)

### Tech Stack

- **Language:** Kotlin
- **Min SDK:** API 31 (Android 12, covers Google TV)
- **Target SDK:** API 34
- **Dependencies:**
  - `androidx.leanback` — Android TV UI framework
  - `okhttp3` + `okhttp3-ws` — WebSocket client
  - `android.webkit.WebView` — kiosk browser
  - `androidx.datastore` — persistent config (replaces SharedPreferences)
  - `kotlinx.serialization` — JSON parsing

### Module: Kiosk WebView

**Purpose:** Display the VisionKing frontend in immersive fullscreen.

```kotlin
// Core behavior
- Activity launches WebView in SYSTEM_UI_FLAG_IMMERSIVE_STICKY
- URL loaded from DataStore config (default: http://192.168.1.100:80)
- JavaScript enabled, DOM storage enabled
- WebViewClient overrides: suppress navigation outside allowed domain
- Back button intercepted (no exit from kiosk)
- Hardware acceleration enabled
- Cache mode: LOAD_DEFAULT (network first, cache fallback)
- Error page: custom offline.html bundled in assets/
```

**Auto-start on boot:**

```kotlin
// BroadcastReceiver registered for BOOT_COMPLETED
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val launchIntent = Intent(context, KioskActivity::class.java)
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(launchIntent)
        }
    }
}
```

**Manifest permissions:**

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-feature android:name="android.software.leanback" android:required="true" />
```

### Module: WebSocket Client

**Purpose:** Bidirectional communication with the Boxer backend.

**Connection:**

```
ws://<boxer-ip>:3000/display?tv_id=<uuid>&app_version=<version>
```

**Heartbeat (TV → Server, every 30s):**

```json
{
  "type": "heartbeat",
  "tv_id": "uuid",
  "app_version": "1.0.0",
  "uptime_seconds": 3600,
  "current_url": "http://192.168.1.100:80/portal/sealer",
  "current_view": "sealer-dashboard",
  "screen_on": true,
  "network": {
    "type": "ethernet",
    "ip": "192.168.1.200",
    "signal_strength": null
  },
  "last_user_interaction_at": "2026-03-17T14:30:00Z",
  "memory_usage_mb": 512,
  "burn_in_guard": {
    "pixel_offset_x": 2,
    "pixel_offset_y": -1,
    "current_rotation_index": 0,
    "sleep_mode": false
  }
}
```

**Commands (Server → TV):**

| Command | Payload | Action |
|---------|---------|--------|
| `switch_view` | `{ "url": "/portal/sealer/trends" }` | WebView navigates to URL |
| `sleep` | `{}` | Screen goes full black, WebView paused |
| `wake` | `{}` | Resume WebView, restore last URL |
| `reboot_app` | `{}` | Kill and restart the kiosk activity |
| `update_config` | `{ "server_url": "...", "rotation_interval_s": 120 }` | Persist new config, apply immediately |
| `show_message` | `{ "text": "Manutenção em 5 min", "duration_s": 10 }` | Toast overlay on top of WebView |
| `identify` | `{}` | Flash screen border purple for 5s (to identify which TV) |

**Command acknowledgment (TV → Server):**

```json
{
  "type": "command_ack",
  "command_id": "uuid",
  "status": "ok|error",
  "error": null
}
```

**Reconnection strategy:**

- Initial connect on boot
- On disconnect: exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Show subtle "offline" indicator (small dot in corner) when disconnected
- Queue heartbeats during disconnect, send last state on reconnect

### Module: Anti Burn-in Guard

**Purpose:** Prevent image retention on consumer LED/QLED panels.

**Strategies:**

1. **Pixel shifting** — Every 30 minutes, inject CSS transform on the WebView root:
   ```javascript
   document.body.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
   ```
   - Offset range: ±3px in X and Y
   - Pattern: cycle through 8 positions (corners + edges of a 6×6px grid)
   - Invisible to the user at 75" viewing distance

2. **View rotation** — Configurable timer (default: 2 minutes) cycles through a list of frontend URLs:
   ```json
   {
     "rotation_views": [
       "/portal/sealer/dashboard",
       "/portal/sealer/trends",
       "/portal/sealer/3d-viewer"
     ],
     "rotation_interval_s": 120
   }
   ```
   - List configurable from server via `update_config` command
   - Smooth transition: fade out 300ms → navigate → fade in 300ms

3. **Sleep schedule** — Configurable daily schedule (local time):
   ```json
   {
     "sleep_schedule": {
       "enabled": true,
       "sleep_at": "18:00",
       "wake_at": "06:00"
     }
   }
   ```
   - During sleep: screen full black, WebView `onPause()`, heartbeat continues (reports `screen_on: false`)
   - Wake: `onResume()`, reload current URL

4. **Backlight reminder** — On first setup, config screen shows warning:
   > "Para prolongar a vida útil da TV, reduza a Luz de Fundo (Backlight) para 50-60% nas configurações de imagem da TV."

### Module: Config Screen

**Access:** Long-press OK button on remote for 5 seconds → settings overlay appears.

**Fields:**

| Setting | Default | Description |
|---------|---------|-------------|
| Server URL | `http://192.168.1.100:80` | Boxer frontend address |
| WebSocket URL | `ws://192.168.1.100:3000/display` | Backend WS endpoint |
| TV Name | `Display 1` | Friendly name for identification |
| TV ID | `(auto-generated UUID)` | Unique identifier, persisted |
| View Rotation | ON | Enable/disable automatic view cycling |
| Rotation Interval | 120s | Seconds between view switches |
| Sleep Schedule | OFF | Enable timed sleep |
| Sleep Time | 18:00 | Local time to enter sleep |
| Wake Time | 06:00 | Local time to exit sleep |

**Persistence:** `androidx.datastore.preferences` (survives app updates and reboots).

### Deployment

- APK built via Android Studio or Gradle CLI
- Sideload via ADB over network:
  ```bash
  adb connect <tv-ip>:5555
  adb install -r vk-display-tv.apk
  ```
- TV must have Developer Options enabled (Settings → About → Build Number × 7) and USB Debugging (ADB over network) ON
- No Play Store publication needed

### Project Structure

```
apps/display-tv/
├── app/
│   ├── src/main/
│   │   ├── java/com/strokmatic/vkdisplay/
│   │   │   ├── KioskActivity.kt          # Main WebView activity
│   │   │   ├── BootReceiver.kt           # BOOT_COMPLETED receiver
│   │   │   ├── ws/
│   │   │   │   ├── DisplayWebSocket.kt   # OkHttp WS client
│   │   │   │   ├── CommandHandler.kt     # Process server commands
│   │   │   │   └── HeartbeatService.kt   # Periodic heartbeat
│   │   │   ├── burnin/
│   │   │   │   ├── PixelShifter.kt       # CSS injection for shifting
│   │   │   │   ├── ViewRotator.kt        # Automatic URL cycling
│   │   │   │   └── SleepManager.kt       # Sleep schedule logic
│   │   │   ├── config/
│   │   │   │   ├── ConfigStore.kt        # DataStore wrapper
│   │   │   │   └── ConfigActivity.kt     # Settings overlay (Leanback)
│   │   │   └── util/
│   │   │       ├── NetworkMonitor.kt     # Connectivity state
│   │   │       └── Constants.kt
│   │   ├── res/
│   │   │   ├── layout/
│   │   │   │   ├── activity_kiosk.xml
│   │   │   │   └── activity_config.xml
│   │   │   └── values/
│   │   │       └── strings.xml
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts
├── build.gradle.kts
├── settings.gradle.kts
└── README.md
```

---

## Component 2: Backend Display Manager (`backend/src/modules/display-manager/`)

### Tech Stack

Follows existing VisionKing backend patterns (NestJS + Sequelize + PostgreSQL).

### Database

**Table: `display_devices`**

```sql
CREATE TABLE display_devices (
    tv_id           UUID PRIMARY KEY,
    friendly_name   VARCHAR(100) NOT NULL DEFAULT 'Display 1',
    app_version     VARCHAR(20),
    current_view    VARCHAR(200),
    is_online       BOOLEAN NOT NULL DEFAULT FALSE,
    last_heartbeat  JSONB,
    last_seen_at    TIMESTAMP WITH TIME ZONE,
    config          JSONB NOT NULL DEFAULT '{
        "rotation_views": ["/portal/sealer/dashboard", "/portal/sealer/trends"],
        "rotation_interval_s": 120,
        "sleep_schedule": {"enabled": false, "sleep_at": "18:00", "wake_at": "06:00"}
    }'::jsonb,
    registered_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Mark offline if no heartbeat in 2 minutes
-- (handled by a periodic NestJS cron, not DB trigger)
```

**Migration:** `migrations/004_display_devices.sql`

### WebSocket Gateway

**Endpoint:** `ws://<boxer>:3000/display`

```typescript
@WebSocketGateway({ path: '/display' })
export class DisplayGateway implements OnGatewayConnection, OnGatewayDisconnect {

  handleConnection(client: Socket) {
    // Extract tv_id from query params
    // Register/update display_devices row
    // Set is_online = true
  }

  handleDisconnect(client: Socket) {
    // Set is_online = false, last_seen_at = NOW()
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(client: Socket, payload: HeartbeatDto) {
    // Update last_heartbeat JSONB, last_seen_at, current_view, app_version
  }

  @SubscribeMessage('command_ack')
  handleCommandAck(client: Socket, payload: CommandAckDto) {
    // Log command result
  }

  // Called by REST controller or internal service
  sendCommand(tvId: string, command: DisplayCommand) {
    // Find connected client by tv_id
    // Emit command with UUID
    // Return command_id for tracking
  }
}
```

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/displays` | List all registered displays (tv_id, name, is_online, last_seen, current_view, app_version) |
| `GET` | `/api/v1/displays/:tvId` | Get display detail (full heartbeat, config) |
| `POST` | `/api/v1/displays/:tvId/command` | Send command to display (`{ "command": "switch_view", "payload": {...} }`) |
| `PATCH` | `/api/v1/displays/:tvId/config` | Update display config (rotation views, sleep schedule) — pushes `update_config` command via WS |
| `DELETE` | `/api/v1/displays/:tvId` | Unregister display |

**Swagger:** `@ApiTags('displays')`

### Offline Detection Cron

```typescript
@Cron('*/60 * * * * *')  // Every 60 seconds
async markOfflineDisplays() {
  // UPDATE display_devices SET is_online = false
  // WHERE is_online = true AND last_seen_at < NOW() - INTERVAL '2 minutes'
}
```

### NestJS Module Structure

```
backend/src/modules/display-manager/
├── display-manager.module.ts
├── display.gateway.ts            # WebSocket gateway
├── display.controller.ts         # REST endpoints
├── display.service.ts            # Business logic
├── display.repository.ts         # Sequelize queries
├── entities/
│   └── display-device.entity.ts  # Sequelize model
├── dto/
│   ├── heartbeat.dto.ts
│   ├── command.dto.ts
│   ├── display-config.dto.ts
│   └── display-response.dto.ts
└── display.provider.ts           # Sequelize provider
```

---

## Communication Protocol Summary

```
┌─────────┐                    ┌──────────┐
│   TV    │                    │  Boxer   │
│  App    │                    │ Backend  │
└────┬────┘                    └────┬─────┘
     │   WS connect (tv_id, ver)    │
     │─────────────────────────────>│  Register/update display
     │                              │
     │   heartbeat (every 30s)      │
     │─────────────────────────────>│  Update last_seen, state
     │                              │
     │   switch_view command        │
     │<─────────────────────────────│  (from REST or cron)
     │                              │
     │   command_ack (ok)           │
     │─────────────────────────────>│  Log result
     │                              │
     │   [disconnect]               │
     │──────────X                   │  Mark is_online=false
     │                              │
     │   [reconnect after backoff]  │
     │─────────────────────────────>│  Restore state
     │                              │
```

---

## Testing Strategy

### Android App

- **Unit tests:** ConfigStore, CommandHandler, PixelShifter logic (JUnit + Mockk)
- **Integration test:** WebSocket connect/heartbeat/command cycle against mock server (OkHttp MockWebServer)
- **Manual test:** sideload on TCL 75P7K, verify boot-start, kiosk mode, remote long-press config

### Backend Module

- **Unit tests:** DisplayService (mock repository), CommandHandler (mock gateway)
- **E2E tests:** WebSocket lifecycle (connect → heartbeat → command → ack → disconnect) using `@nestjs/testing` + `socket.io-client`
- **Contract tests:** heartbeat JSON schema validation, command payload validation

---

## Acceptance Criteria

1. App auto-starts on TV boot in immersive kiosk mode (no system UI visible)
2. WebSocket connects to backend and sends heartbeat every 30s
3. Server can send `switch_view`, `sleep`, `wake`, `reboot_app` commands and receive acknowledgment
4. Anti burn-in pixel shifting active (±3px, 30min cycle)
5. View rotation cycles through configured URLs at configurable interval
6. Config screen accessible via long-press OK (5s) on remote
7. Backend `display-manager` module: WS gateway + 5 REST endpoints + PostgreSQL table
8. Offline detection marks displays as offline after 2 minutes without heartbeat
9. Works on TCL 75P7K (Google TV, API 31+)
10. APK sideloadable via ADB over network

---

## Dependencies

- **SEALER-07** (frontend module) — provides the Angular views/routes that the TV will display
- VisionKing backend running on Boxer-6641 with NestJS + PostgreSQL

## Estimates

| Component | Effort |
|-----------|--------|
| Android TV app (kiosk + WS + burn-in + config) | 3–4 days |
| Backend display-manager module (WS + REST + DB) | 1–2 days |
| Testing + TCL 75P7K validation | 1 day |
| **Total** | **5–7 days** |
