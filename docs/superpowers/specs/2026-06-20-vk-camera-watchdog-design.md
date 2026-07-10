---
type: Design Spec
title: vk-camera-watchdog — Design Spec
description: On 2026-06-20, the vk01 capture pipeline stalled for **~3h10min** (16:18 → 19:27) after a cascade triggered by a manual `docker restart database-server` that hit SIGTERM timeout. Final cause was th...
timestamp: 2026-06-20
---

# vk-camera-watchdog — Design Spec

**Issue:** [strokmatic/visionking#115](https://github.com/strokmatic/visionking/issues/115)
**Date:** 2026-06-20
**Status:** Draft (spec only — not implemented)
**Target nodes:** vk01 (cameras ponto 1, devices DA3488406-9) and vk02 (cameras ponto 2)

## 1. Motivation

On 2026-06-20, the vk01 capture pipeline stalled for **~3h10min** (16:18 → 19:27) after a cascade triggered by a manual `docker restart database-server` that hit SIGTERM timeout. Final cause was that the 4 Hikrobot MV-CS020-10UM cameras stayed in a firmware deadlock (preserved by the 24VDC auxiliary supply) and the `genicam_cpp` workers inside `ca-sis-surface-{1..4}` looped at "Configurando Resolução Inicial" without producing any frame.

Recovery required manual intervention sequence (USB ioctl reset → GenICam `DeviceReset` → physical 24VDC power-cycle on the plant floor). A local watchdog can detect this exact pattern automatically and run the **first 3 recovery steps unattended**, escalating to a human alert only when software cannot resolve it.

The watchdog mirrors the existing `gpu-watchdog` at `vk01:/opt/gpu-watchdog/` in style, safety mechanisms, and operational footprint.

## 2. Detection (multi-signal AND, fail-closed against false positives)

A "capture stall" event is declared **only when all required signals are true**, all measured within the same probe pass.

### 2.1 Required signals

| # | Signal | Source | Default threshold |
|---|---|---|---|
| 1 | **PLC active** | `docker logs --since 1m visionking-plc-monitor \| grep Velocidade_Tratada` — at least N samples with value > V_MIN | N=10, V_MIN=100 |
| 2 | **All camera-acquisition containers up** | `docker inspect ca-sis-surface-{N..M} --format '{{.State.Running}}'` | all 4 = true |
| 3 | **Pipeline starved** (at least ONE of the sub-signals) | see 2.2 | varies |

### 2.2 Starvation sub-signals (OR)

| Source | Probe | Default threshold |
|---|---|---|
| Postgres `frames` table | `SELECT max(frame_captured_at) FROM frames` against deployment DB (vk01 / vk02) | last insert > **2 min** ago |
| img_saved filesystem | `find ~/Downloads/img_saved -type f -mmin -2 \| head -1` | empty result |
| RabbitMQ queue | `rabbitmqctl list_queues name messages_ready publish_rate` filtered by `is-sis-surface-queue` | publish_rate == 0 for ≥ **2 min** |

The `find` is bounded by `-maxdepth 4` and time-limited via `timeout 5s` to avoid the multi-TB tree-walk cost (we hit this in the manual diagnostic).

### 2.3 Corroborating signal (optional, increases confidence)

`docker logs --since 30s ca-sis-surface-1 | grep -c "Configurando Resolução Inicial"` — if count > 100 in 30 s, the deadlock signature observed on 2026-06-20 is confirmed. Used to bias confidence; not strictly required.

### 2.4 Confirmation delay

Two-stage confirmation, mirroring `gpu-watchdog` plus an extra cross-cycle gate observed as necessary during the 2026-06-21 dry-run readout:

1. **In-tick:** after the first detection, wait `CONFIRMATION_DELAY=20s` and re-probe. If the re-probe clears, log `RECOVERED` and reset `consecutive_failures`.
2. **Cross-cycle:** if the re-probe still shows stall, increment `consecutive_failures`. Only escalate when `consecutive_failures >= MIN_CONSECUTIVE_CONFIRMATIONS=2` — i.e. the in-tick re-probe failed on **two consecutive cron cycles**. Single-tick bursts during line slowdowns are logged as `STALL persisted (1/2)` and absorbed without action.

The dry-run on 2026-06-21 (≈1h, 50 cycles) showed 33 in-tick STALL preliminaries, 30 of which cleared during the 20-30s delay. The cross-cycle gate filters the remaining 3 isolated escalations down to whatever stays sustained for ≥2 minutes.

## 3. Recovery — escalated ladder

Each level has its own cooldown. If level N fails to restore the pipeline within `LEVEL_VALIDATE_WINDOW=90s` (a single post-action probe pass), the watchdog escalates to level N+1. The state file records `last_level_attempted` so the next run starts there (avoids re-running L1 every minute if it's known to fail).

### Level 1 — Soft container restart
```
docker restart ca-sis-surface-{N..M}
```
Cost: ~10 s. Resolves: deadlock at the supervisor / genicam_cpp child level when USB session is still healthy. **Historically does NOT resolve** the firmware-internal deadlock observed on 2026-06-20 (cameras stay in `write_memory error`), but cheap to try first.

### Level 2 — USB ioctl reset
```
docker stop ca-sis-surface-{N..M}
sudo python3 -c "<USBDEVFS_RESET on each device>"   # see hik_device_reset.py for the ioctl pattern
docker start ca-sis-surface-{N..M}
```
Cost: ~25 s. Resolves: stuck USB session; lets the kernel re-enumerate. **Confirmed on 2026-06-20** to clear the `USB3Vision write_memory error` warnings but did **not** fully unstick the cameras (firmware deadlock survived bus reset).

### Level 3 — GenICam `DeviceReset` via MVS SDK
```
docker stop ca-sis-surface-{N..M}
LD_LIBRARY_PATH=/opt/MVS/lib/64 \
MVCAM_COMMON_RUNENV=/opt/MVS/lib \
python3 /opt/vk-camera-watchdog/hik_device_reset.py
sleep 20
docker start ca-sis-surface-{N..M}
```
Cost: ~50 s. Resolves: firmware-internal deadlock IF the camera still accepts a control session. **Untested in the wild** — the cameras on 2026-06-20 had to be physically 24VDC-cycled before they accepted any new session. Worth attempting before declaring software-defeat.

### Level 4 — N/A in this deployment

Originally planned a Telegram alert for human intervention (power-cycle 24VDC). **Dropped** because vk01 has no outbound internet access — no notification channel reaches the operator from the node.

L3 is therefore the **terminal level**. If L3 fails to restore the pipeline within `LEVEL_VALIDATE_WINDOW`, the watchdog:

- Logs `CRITICAL: software recovery exhausted — manual intervention required (24VDC power-cycle)`
- Increments `consecutive_failures` in state
- Stops attempting further recovery until cooldown expires
- Writes a marker file `/opt/vk-camera-watchdog/MANUAL_INTERVENTION_REQUIRED` (consumable by central health-monitor — a separate process that *does* have internet, polls vk01 via SSH, and forwards the alert)

This split keeps the local watchdog network-free while still allowing the operator to be notified through the existing alerting plane.

## 4. Safety

Mirroring `gpu-watchdog`:

| Knob | Default | Purpose |
|---|---|---|
| `MIN_UPTIME_SECONDS` | 600 | Refuse to act during the first 10 min after boot (avoid boot-loop interaction with any other watchdog) |
| `RECOVERY_COOLDOWN_SECONDS` | 300 | Min interval between any two recovery attempts (same or different levels) |
| `MAX_RECOVERIES_PER_DAY` | 5 | Daily ceiling; on exhaustion, watchdog skips and emits an alert at the next run |
| `IDLE_LINE_THRESHOLD_SECONDS` | 1800 | If PLC has reported `Velocidade_Tratada == 0` continuously for > 30 min, treat as planned production pause and do NOT act (no false-positive during shift change) |
| `CONFIRMATION_DELAY` | 20 | Seconds between first detection and re-probe within the same cron tick |
| `MIN_CONSECUTIVE_CONFIRMATIONS` | 2 | Number of consecutive cron cycles that must confirm the stall (after the in-tick re-probe) before escalating |
| `FRAMES_STALE_WINDOW` | 180 | Seconds since last `frames.frame_captured_at` to flag as stale (bumped from 120 after dry-run showed frames trailing PLC by ~60-90s under load) |
| `LEVEL_VALIDATE_WINDOW` | 90 | After acting, how long to give the pipeline before judging success |

State persists in `/opt/vk-camera-watchdog/state.json`:
```json
{
  "last_check_at_epoch": 1718900000,
  "last_recovery_at_epoch": 0,
  "last_level_attempted": 0,
  "consecutive_failures": 0,
  "recoveries_today": [],
  "history": [
    {"ts": "...", "level": 1, "outcome": "success|failed", "evidence": "..."}
  ]
}
```

Old `history` entries are truncated to keep the file under 10 KB.

## 5. Architecture

Identical layout to `gpu-watchdog`:

```
/opt/vk-camera-watchdog/
├── watchdog.sh           # main entry — cron-driven
├── probe.sh              # signal collection (PLC, frames, queue, img_saved)
├── recover.sh            # level dispatcher (calls L1/L2/L3)
├── hik_device_reset.py   # SDK MVS Python script (already exists at ~/Downloads, will be moved here)
├── state.json            # state per §4
└── README.md             # operator's runbook
```

**Cron** (in `/etc/cron.d/vk-camera-watchdog`, owned by root):
```
* * * * * root /opt/vk-camera-watchdog/watchdog.sh >> /var/log/vk-camera-watchdog.log 2>&1
```

Same `* * * * *` cadence as `gpu-watchdog`.

## 6. Deployment surface — per-node parameters

A small config block at the top of `watchdog.sh` sets node-specific values. Same script body deploys to both vk01 and vk02:

| Variable | vk01 | vk02 |
|---|---|---|
| `DEPLOYMENT` | `03002` | `03002` |
| `CAMERA_CONTAINERS` | `ca-sis-surface-1..4` | `ca-sis-surface-5..8` |
| `CAMERA_USB_PATHS` | `/dev/bus/usb/002/{005,006,007,008}` (will resolve dynamically — bus numbers shift) | analog |
| `PG_DB` | `vk01` | `vk02` |
| `PG_CONTAINER` | `database-server` | `database-server` |
| `REDIS_PASSWORD_ENV` | `$(cat ~/.secrets/vk-rabbit-password)` | (TBD — check vk02 plc-monitor env) |
| `RABBITMQ_QUEUE` | `is-sis-surface-queue` | same |
| `PLC_MONITOR_CONTAINER` | `visionking-plc-monitor` | same |

USB device paths are not stable across reboots (re-enumeration changes device numbers — saw it move from 005-008 → 009-012 on 2026-06-20). The script must resolve them dynamically:
```bash
HIKROBOT_DEVS=$(lsusb | awk '/2bdf:0001/{gsub(":","",$4); printf "/dev/bus/usb/002/%s\n", $4}')
```

## 7. Probes — implementation details

### PLC active probe
```bash
samples=$(docker logs --since 1m "$PLC_MONITOR_CONTAINER" 2>&1 \
  | grep -oE '"Velocidade_Tratada":"[0-9.]+"' \
  | grep -oE '[0-9.]+')
active=$(echo "$samples" | awk -v T=100 'BEGIN{n=0} {if($1>T)n++} END{print n}')
[[ "$active" -ge 10 ]]   # exit 0 if PLC is active
```

### Containers running
```bash
all_up=true
for c in $CAMERA_CONTAINERS; do
  running=$(docker inspect "$c" --format '{{.State.Running}}' 2>/dev/null)
  [[ "$running" != "true" ]] && { all_up=false; break; }
done
$all_up
```

### Frames table staleness (Postgres)
```bash
last=$(docker exec -i "$PG_CONTAINER" psql -U strokmatic -d "$PG_DB" -t -A -c \
  "SELECT EXTRACT(EPOCH FROM (now() - max(frame_captured_at))) FROM frames" 2>/dev/null)
[[ "${last%.*}" -gt 120 ]]   # > 2 min stale
```

### img_saved staleness (bounded find)
```bash
recent=$(timeout 5 find ~/Downloads/img_saved -maxdepth 4 -type f -mmin -2 2>/dev/null | head -1)
[[ -z "$recent" ]]
```

### RabbitMQ publish starvation
```bash
rate=$(docker exec "$RABBIT_CONTAINER" rabbitmqctl list_queues name messages_ready 2>/dev/null \
  | awk -v Q="$RABBITMQ_QUEUE" '$1==Q{print $2}')
# Combined with a cached previous-count to derive publish rate over 2 probe cycles.
```

## 8. Test plan

Hermetic tests live under `tests/vk-camera-watchdog/` and follow the same Node + bash-stub pattern as `tests/health/`:

- **(a)** PLC inactive → no action (false positive guard).
- **(b)** PLC active + pipeline healthy (frames advancing) → no action.
- **(c)** PLC active + frames stale 3+ min → L1 triggered.
- **(d)** After L1 + still stale → L2 triggered (state advances `last_level_attempted`).
- **(e)** After L3 + still stale → terminal log + `MANUAL_INTERVENTION_REQUIRED` marker file written.
- **(f)** Cooldown: two stalls within 5 min → second one skipped.
- **(g)** Daily cap: 6th stall in 24 h → skipped with alert.
- **(h)** Confirmation delay: first probe stale but second probe healthy → no action (transient).

Stubs for `docker`, `psql`, `rabbitmqctl`, `find`, `lsusb` are installed via the same `installCliStub` helper used by health tests.

## 9. Roll-out — proposed phases

| Phase | Scope | Owner |
|---|---|---|
| Phase 0 | Spec review + sign-off (this document) — **done 2026-06-20** | Pedro |
| Phase 1 | Implement watchdog.sh + probe.sh + recover.sh on develop branch, hermetic tests green. **Check-in with Pedro before Phase 2.** | engineering |
| Phase 2 | Deploy on vk01 in **dry-run mode** (`ACT=false`) for a window agreed at the Phase 1 check-in — only logs decisions, never acts. Verify no false positives during normal operation, planned pauses, shift changes, and any organic stall. | engineering |
| Phase 3 | Promote vk01 to active mode. Monitor. | engineering |
| Phase 4 | Replicate to vk02 once vk02 is back in stable operation (hardware status from #113 pending). | engineering |

## 10. Out of scope

- Recovery for non-camera pipeline components (rabbitmq, database-server, inference) — separate watchdogs if needed.
- Auto-reboot of the host on capture stall — never. This watchdog is explicitly **scoped to the camera subsystem**. The `gpu-watchdog` handles host-level reboots.
- Remote orchestration from JARVIS — local-only by design (resilient to VPN issues).
- vk03 (dashboard node) — has no cameras.

## 11. Open questions (parking lot — not blocking Phase 1)

1. **Q1**: Is `MAX_RECOVERIES_PER_DAY=5` the right cap? Lower (3) is safer but might starve recovery in a bad day. Higher (10) increases risk of disruption from a misbehaving probe.
2. **Q2**: Should L3 (DeviceReset GenICam) be enabled by default in Phase 2 dry-run, or guarded behind a config flag? It's untested in the wild — Phase 2 may want it disabled.
3. **Q3**: Cooldown window for the daily cap — fixed UTC midnight reset, or rolling 24 h?
4. **Q4**: Central health-monitor poll of `MANUAL_INTERVENTION_REQUIRED` marker — design and implement as a separate task once Phase 3 lands.

## 12. References

- `gpu-watchdog`: `vk01:/opt/gpu-watchdog/gpu-watchdog.sh`
- DeviceReset script: `vk01:/home/vk01/Downloads/hik_device_reset.py`
- Forensics of 2026-06-20: `data/vk01-forensics-20260620-191334/`
- Health monitor (sibling, configuration-driven): `scripts/health/`
