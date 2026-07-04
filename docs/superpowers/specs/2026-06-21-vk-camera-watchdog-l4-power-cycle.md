# vk-camera-watchdog — L4 remote power-cycle (24VDC)

**Status:** Draft
**Author:** Pedro / JARVIS session 2026-06-21
**Supersedes:** Section 3.4 of [2026-06-20-vk-camera-watchdog-design.md](2026-06-20-vk-camera-watchdog-design.md) ("Level 4 — N/A in this deployment")

---

## 1. Why we need L4

Today, 2026-06-21, the second incident in 24h reproduced the same firmware deadlock on the 4× Hikrobot MV-CS020-10UM USB3 cameras at 03002:

- Symptom: `USB3Vision write_memory error ((null)) (3)` on every camera control feature write, then containers freeze at "Configurando Resolução Inicial: 1240x1624" and never emit a frame.
- L1 (`docker restart`) — no effect.
- L2 (USB ioctl `USBDEVFS_RESET`) — clears the `write_memory error` but cameras stay frozen at the same step.
- L3 (GenICam `DeviceReset` via MVS SDK) — fired today; cameras re-enumerated on the USB bus with new device numbers, `0 write_memory errors` afterwards, but still frozen at "Resolução Inicial". **L3 is not sufficient.**
- **Only physical 24VDC power-cycle has cleared the deadlock** — confirmed twice.

The original spec (2026-06-20) marked L4 as "N/A in this deployment" because:
1. vk01 has no outbound internet, so an alerting webhook (Telegram, etc.) was deemed pointless;
2. We assumed L3 would be enough.

Both assumptions are wrong:
1. We don't need internet — we need a **LAN-side actuator** that can physically cycle the camera power rail. That actuator lives on the same LAN as vk01, so internet is irrelevant.
2. L3 is provably not enough.

So L4 is the missing rung: a network-controlled relay on the 24VDC line feeding the cameras, driven by the watchdog after L3 fails.

## 2. Decision

Insert a 4-channel IP-controlled industrial relay between the existing 24VDC supply and the camera bundle. The watchdog opens each contact for `POWER_CYCLE_DURATION_SECONDS=5` then closes it, dropping power to the cameras for that interval and forcing a cold reboot of the firmware.

The relay is the **only** component capable of recovering from this deadlock without human intervention — so L4 is wired tightly to the existing L1→L2→L3 escalation but **separately gated** by safety knobs (it's physically destructive: every L4 fires a real power-cycle of production hardware).

## 3. Architecture

```
              ┌──────────────────────────────────────────────────────┐
              │                   strokmatic LAN                     │
              │  10.244.70.x                                         │
              │                                                      │
              │   ┌──────────┐         ┌────────────────┐            │
              │   │  vk01    │ HTTP/   │ Relay 4-ch IP  │            │
              │   │ watchdog ├────────►│  e.g. .80      │            │
              │   └────┬─────┘         └──────┬─────────┘            │
              │        │                      │ NC contacts          │
              └────────┼──────────────────────┼──────────────────────┘
                       │ USB3                 │
                       │                      ▼
                  ┌────┴───┐         ┌─────────────────┐
                  │ 4× CAM ├────24V──┤ Fonte 24VDC DIN │ ◄── AC mains
                  └────────┘   ▲     └─────────────────┘
                               │
                             relay opens here
```

**Power flow:** AC mains → 24VDC DIN-rail supply (unchanged) → 4-channel relay (one channel per camera, fail-safe **normally-closed**) → 4 cameras.

**Control flow:** watchdog on vk01 → HTTP/Modbus TCP to relay's IP on the strokmatic LAN → relay opens contact N → camera N loses 24V → wait → contact closes → camera N boots fresh.

**Fail-safe:** NC contacts. If the relay loses power or comes back from a reset, cameras stay powered. The watchdog never relies on the relay being healthy to keep cameras on.

**Per-camera vs all-at-once:** the relay has 4 separate channels, but L4 cycles **all four cameras simultaneously** for simplicity and to avoid weird states where 1 camera has a different firmware boot generation than the other 3. (Future option: per-camera if we ever localize the deadlock to a single device.)

## 4. Hardware options

| # | Option | Cost | Lead time | Industrial | Notes |
|---|---|---|---|---|---|
| 1 | **Phoenix Contact `EEM-MA770`** or **Wago 750-352** (Ethernet I/O DIN-rail, 4 DO 24V, Modbus TCP) | R$ 1.5k-3k | 2-4 weeks (cotação) | ✅ | Recommended for permanent install. Survives ArcelorMittal EMI/vibration/temp. |
| 2 | **Lindy IP PDU 4 outlets DC** | R$ 800-1.5k | 1-2 weeks | ⚠️ commercial-grade | Plug-and-play, less elegant install. |
| 3 | **ESP32 + 4-ch relay board + IP65 box** | R$ 150-300 | 3-5 days (DIY) | ❌ DIY | MVP only — useful to validate the software flow this week. Replace with #1 in next maintenance window. |

**Recommended path:** option 3 this week (unblock 03002 + exercise the software integration), order option 1 in parallel for permanent install.

## 5. Software contract (relay endpoint)

Driver-agnostic — the watchdog talks to a thin shim (`recover_l4`) that wraps whichever relay the deployment has. Per-node override goes in `/etc/vk-camera-watchdog.conf`:

```bash
# /etc/vk-camera-watchdog.conf  — vk01 example
POWER_CYCLE_ENABLED=true
POWER_CYCLE_DRIVER=http             # http | modbus
POWER_CYCLE_ENDPOINT=http://10.244.70.80/relay/cycle
POWER_CYCLE_TIMEOUT_SECONDS=10
POWER_CYCLE_DURATION_SECONDS=5
POWER_CYCLE_RECOVERY_WAIT_SECONDS=30   # wait after relay closes before resuming probes
MAX_POWER_CYCLES_PER_DAY=2             # very strict — physical wear
MIN_INTERVAL_BETWEEN_POWER_CYCLES_SECONDS=1800  # 30 min between attempts
```

### 5.1 HTTP driver

Simple endpoint contract, easy to implement on ESP32 or any industrial relay with an HTTP layer:

```
POST /relay/cycle
Content-Type: application/json
Body: {"channels": [1,2,3,4], "duration_seconds": 5}

Response (success):
  200 OK
  {"status":"cycled","channels":[1,2,3,4],"duration":5}

Response (any error):
  Non-2xx + JSON body with {"error":"..."}
```

The watchdog treats any non-2xx **or** timeout **or** missing `"status":"cycled"` as L4 failure → escalates to manual intervention flag.

### 5.2 Modbus TCP driver (for Phoenix/Wago)

Coil-write per channel:

```
Open  channel N  → write coil N = 1   (relay open, camera off)
Close channel N  → write coil N = 0   (relay closed, camera on)
```

`recover_l4` opens all 4 coils, sleeps `POWER_CYCLE_DURATION_SECONDS`, closes all 4 coils. No batch op needed — simple sequential.

## 6. Integration with the watchdog

### 6.1 `decide_next_level` extension

```bash
# scripts/vk-camera-watchdog/watchdog.sh
decide_next_level() {
  local last="$1"
  case "$last" in
    0) echo 1 ;;
    1) echo 2 ;;
    2) echo 3 ;;
    3) echo 4 ;;                # NEW
    *) return 1 ;;              # L4 already done — exhausted
  esac
  return 0
}
```

### 6.2 `recover_l4` in `recover.sh`

```bash
# scripts/vk-camera-watchdog/recover.sh
recover_l4() {
  local cams=("$@")
  : "${POWER_CYCLE_ENABLED:=false}"
  : "${POWER_CYCLE_DRIVER:=http}"
  : "${POWER_CYCLE_DURATION_SECONDS:=5}"
  : "${POWER_CYCLE_RECOVERY_WAIT_SECONDS:=30}"

  if [[ "$POWER_CYCLE_ENABLED" != "true" ]]; then
    log_warn "L4 power-cycle not enabled (POWER_CYCLE_ENABLED=false) — manual intervention required"
    touch "$MANUAL_INTERVENTION_FLAG"
    return 1
  fi

  log_warn "L4 power-cycle attempting via ${POWER_CYCLE_DRIVER} → ${POWER_CYCLE_ENDPOINT}"

  # Stop containers BEFORE cutting power (clean GenICam disconnect)
  $DOCKER_CMD stop "${cams[@]}" || true

  local rc
  case "$POWER_CYCLE_DRIVER" in
    http)   _power_cycle_http;   rc=$? ;;
    modbus) _power_cycle_modbus; rc=$? ;;
    *)      log_warn "Unknown POWER_CYCLE_DRIVER=${POWER_CYCLE_DRIVER}"; rc=2 ;;
  esac

  # ALWAYS try to bring containers back, even on failure
  sleep "$POWER_CYCLE_RECOVERY_WAIT_SECONDS"
  $DOCKER_CMD start "${cams[@]}" || true

  return $rc
}
```

`_power_cycle_http` and `_power_cycle_modbus` are thin curl / `mbpoll` wrappers — tested in isolation under hermetic test harness.

### 6.3 Safety gates (new)

Added to `decide_safety_skip` (or a dedicated `decide_safety_skip_l4`):

| Knob | Default | Why |
|---|---|---|
| `MAX_POWER_CYCLES_PER_DAY` | 2 | Physical wear on relay contacts + camera capacitors. Daily cap is hard — if we hit it, the deadlock is reproducing too fast and needs root cause, not more cycles. |
| `MIN_INTERVAL_BETWEEN_POWER_CYCLES_SECONDS` | 1800 (30 min) | Avoids hammering hardware if L4 itself doesn't recover (e.g. relay broken, camera dead). |
| `POWER_CYCLE_ENABLED` | `false` | **Default off**. Even with hardware installed, deployment must explicitly opt-in via `/etc/vk-camera-watchdog.conf`. Prevents accidental power-cycle if config gets templated to a node without the relay. |
| `MIN_UPTIME_AFTER_POWER_CYCLE_SECONDS` | 120 | Skip all subsequent probes for 2 min after L4 fires (cameras boot + enumerate + GenICam ready). |

State changes:

```json
// state.json (additions)
"power_cycles_today": [<epoch>, ...],     // separate from recoveries_today
"last_power_cycle_at_epoch": <int>
```

`MAX_POWER_CYCLES_PER_DAY` uses its own counter so a runaway L1/L2/L3 loop can't burn through the L4 budget.

### 6.4 Outcome handling

| L4 outcome | Action |
|---|---|
| HTTP/Modbus call returned success, frames table moves within `LEVEL_VALIDATE_WINDOW=90s` after L4 + recovery wait | `state_history_push 4 success`; reset `consecutive_failures`; `last_level_attempted=0` (the cycle worked, next stall starts fresh at L1) |
| Call succeeded but frames still stale → confirmed L4 didn't fix it (hardware or camera fully dead) | `state_history_push 4 failed`; touch `MANUAL_INTERVENTION_FLAG`; **DO NOT** auto-retry L4 inside `MIN_INTERVAL_BETWEEN_POWER_CYCLES_SECONDS`. Skip until manual reset. |
| Call failed (relay unreachable / timeout) | `state_history_push 4 dispatch-failed`; touch `MANUAL_INTERVENTION_FLAG`; log loud. |

## 7. Manual-intervention flag — now meaningful

The existing `MANUAL_INTERVENTION_REQUIRED` flag (planned but unused) becomes real with L4:

- Created when L4 dispatch fails OR when L4 succeeded but pipeline didn't recover.
- A separate central poller (knowledge-hub or health-monitor on `192.168.15.2`, which DOES have internet) SSHs to vk01 every N minutes, checks for the flag, and forwards the alert to Google Chat / Telegram. This split keeps the watchdog network-free.
- Watchdog refuses to attempt any further recovery while the flag exists. Operator must `sudo rm /opt/vk-camera-watchdog/MANUAL_INTERVENTION_REQUIRED` after on-site verification.

## 8. Testing strategy

### 8.1 Hermetic unit tests (offline)

Same pattern as existing `tests/vk-camera-watchdog/`:

- `recover.test.mjs`:
  - `recover_l4` calls `docker stop` → http/modbus → `docker start` in order
  - `POWER_CYCLE_ENABLED=false` → skips dispatch, touches flag
  - HTTP non-2xx → returns failure, still calls `docker start`
  - HTTP timeout → returns failure with `dispatch-failed`
- `watchdog.test.mjs`:
  - `decide_next_level 3 → 4`
  - `decide_next_level 4 → exit 1` (exhausted)
  - new safety helper for `MAX_POWER_CYCLES_PER_DAY`

Use cli-stub for `curl`, `docker`, `mbpoll`.

### 8.2 Lab integration test

Before installing at 03002:

- ESP32 firmware (option 3) running on the bench
- Vk-camera-watchdog running on a vk01-equivalent box with `POWER_CYCLE_ENABLED=true` + endpoint pointing at the bench ESP32
- Trigger an artificial stall (e.g., `iptables -A INPUT -p tcp --dport 6379 -j DROP` to starve frames)
- Observe full L1→L2→L3→L4 escalation with bench relay clicking
- Validate state.json transitions

### 8.3 Production smoke (post-install)

- Install hardware, leave `POWER_CYCLE_ENABLED=false` for 7 days.
- Manually trigger one full cycle via `curl` from vk01 shell during planned downtime → confirm cameras boot clean.
- Set `POWER_CYCLE_ENABLED=true`. Stay in `ACT=false` (dry-run for the whole watchdog) for another 7 days. Verify the dry-run log would have called L4 in plausible windows.
- Flip `ACT=true`. Monitor closely.

## 9. Open questions

| Question | Where to resolve |
|---|---|
| Per-camera vs ganged power-cycle — does cycling just the deadlocked one help, or is the deadlock correlated (e.g., shared USB controller transaction)? | Need 1+ more incident with per-camera logging to know. For now: gang. |
| Should L4 cycle the **fonte 24VDC** itself (AC input) instead of relays on the DC output? | Cleaner electrically (no inrush concerns on individual cameras), but takes longer to recover (~10s capacitor discharge + boot). For the MVP, DC output is fine. Reconsider after first incident report. |
| Is the deadlock a Hikrobot firmware bug we should escalate to the vendor? | Yes — open a ticket with reproduction (write_memory error 3 → freeze at "Configurando Resolução Inicial" requires AC power-cycle). 2 incidents in 24h is enough evidence. Independent of L4. |
| What about the firmware bug recurring while ACT=true → looped power-cycles → MAX_POWER_CYCLES_PER_DAY hit → operator paged → still no fix? | That's the right escalation path. L4 is a recovery for **intermittent** deadlock; if the deadlock is now permanent, hardware (camera or supply) is dying and needs replacement. |

## 10. Phased rollout

1. **This week (MVP):** order ESP32 + relay board, write firmware, write `recover_l4` + tests + 7-day bench validation.
2. **Next week:** install MVP at 03002, keep `POWER_CYCLE_ENABLED=false`, run dry-run.
3. **+ 2 weeks:** order Phoenix Contact / Wago relay, swap hardware on next maintenance window, keep same software.
4. **+ 1 month:** enable `POWER_CYCLE_ENABLED=true` after 2 weeks of clean dry-run logs.

In parallel: open Hikrobot vendor ticket. If they fix the firmware, L4 becomes a fallback rather than a daily-use feature.

## 11. Changelog

- 2026-06-21: initial draft after second incident at 03002 (this session).
