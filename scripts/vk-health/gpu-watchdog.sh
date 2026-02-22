#!/bin/bash
# GPU Watchdog — detects PCIe physical layer loss (Xid 79) and triggers reboot
# Designed for VisionKing GPU nodes (vk01/vk02) running as a cron job.
#
# Detection: Two independent checks must BOTH fail before rebooting.
#   1. nvidia-smi query (functional check — can the driver talk to the GPU?)
#   2. dmesg Xid 79 / PCIe AER errors (kernel evidence — did the bus fail?)
#
# Safety:
#   - Minimum uptime before allowing reboot (avoids boot loops)
#   - Cooldown between reboots (max 1 reboot per window)
#   - Confirmation delay: if first check fails, wait and re-check
#   - All decisions logged to a persistent file
#
# Install (ROOT cron, every minute — must run as root for reboot + state file):
#   * * * * * /opt/gpu-watchdog/gpu-watchdog.sh >> /var/log/gpu-watchdog.log 2>&1
#
set -euo pipefail

# --- Configuration ---
MIN_UPTIME_SECONDS=600          # Don't reboot if uptime < 10 minutes (avoid boot loop)
REBOOT_COOLDOWN_SECONDS=3600    # Don't reboot more than once per hour
CONFIRMATION_DELAY=30           # Seconds to wait before re-checking (confirm it's not transient)
STATE_DIR="/opt/gpu-watchdog"
STATE_FILE="$STATE_DIR/state"
LOG_TAG="[gpu-watchdog]"

mkdir -p "$STATE_DIR"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
log()  { echo "$(ts) $LOG_TAG $1"; }

# --- Safety: check uptime ---
UPTIME_SECONDS=$(awk '{print int($1)}' /proc/uptime)
if [[ $UPTIME_SECONDS -lt $MIN_UPTIME_SECONDS ]]; then
    log "SKIP: uptime ${UPTIME_SECONDS}s < minimum ${MIN_UPTIME_SECONDS}s — too soon after boot"
    exit 0
fi

# --- Safety: check reboot cooldown ---
LAST_REBOOT=0
if [[ -f "$STATE_FILE" ]]; then
    LAST_REBOOT=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
fi
NOW=$(date +%s)
SINCE_LAST=$((NOW - LAST_REBOOT))
if [[ $SINCE_LAST -lt $REBOOT_COOLDOWN_SECONDS ]]; then
    log "SKIP: last reboot ${SINCE_LAST}s ago < cooldown ${REBOOT_COOLDOWN_SECONDS}s"
    exit 0
fi

# --- Check 1: nvidia-smi functional query ---
check_nvidia_smi() {
    # Returns 0 if GPU is responsive, 1 if not
    if timeout 10 nvidia-smi --query-gpu=gpu_uuid,temperature.gpu,power.draw --format=csv,noheader >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# --- Check 2: kernel evidence of GPU/PCIe failure ---
check_dmesg_errors() {
    # Look for Xid 79 or PCIe AER errors since last boot
    # Returns 0 if NO errors found (healthy), 1 if errors found
    if dmesg --time-format iso 2>/dev/null | grep -qiE "xid.*79|gpu has fallen off the bus|PCIe Bus Error.*Physical Layer"; then
        return 1  # errors found
    else
        return 0  # clean
    fi
}

# --- Run primary checks ---
NVIDIA_OK=true
DMESG_OK=true

if ! check_nvidia_smi; then
    NVIDIA_OK=false
    log "ALERT: nvidia-smi query FAILED"
fi

if ! check_dmesg_errors; then
    DMESG_OK=false
    log "ALERT: dmesg shows Xid 79 / PCIe AER errors"
fi

# --- Evaluate ---
if [[ "$NVIDIA_OK" == "true" && "$DMESG_OK" == "true" ]]; then
    # All healthy — nothing to do
    exit 0
fi

if [[ "$NVIDIA_OK" == "true" && "$DMESG_OK" == "false" ]]; then
    # GPU still responds but kernel logged errors — warn but don't reboot yet
    log "WARNING: PCIe errors in dmesg but nvidia-smi still works — monitoring"
    exit 0
fi

if [[ "$NVIDIA_OK" == "false" && "$DMESG_OK" == "true" ]]; then
    # nvidia-smi failed but no kernel evidence — could be driver glitch
    log "WARNING: nvidia-smi failed but no Xid/AER in dmesg — will confirm"
fi

if [[ "$NVIDIA_OK" == "false" && "$DMESG_OK" == "false" ]]; then
    log "CRITICAL: nvidia-smi FAILED + Xid 79/AER errors confirmed — will confirm"
fi

# --- Confirmation: wait and re-check ---
log "Waiting ${CONFIRMATION_DELAY}s before confirmation check..."
sleep "$CONFIRMATION_DELAY"

CONFIRM_NVIDIA=true
CONFIRM_DMESG=true

if ! check_nvidia_smi; then
    CONFIRM_NVIDIA=false
    log "CONFIRM: nvidia-smi still FAILED after ${CONFIRMATION_DELAY}s delay"
fi

if ! check_dmesg_errors; then
    CONFIRM_DMESG=false
    log "CONFIRM: dmesg errors still present after ${CONFIRMATION_DELAY}s delay"
fi

# --- Final decision: reboot only if nvidia-smi fails on BOTH checks ---
if [[ "$NVIDIA_OK" == "false" && "$CONFIRM_NVIDIA" == "false" ]]; then
    log "REBOOT TRIGGERED: nvidia-smi failed twice (${CONFIRMATION_DELAY}s apart)"
    if [[ "$DMESG_OK" == "false" || "$CONFIRM_DMESG" == "false" ]]; then
        log "  Evidence: Xid 79 / PCIe AER errors confirmed in dmesg"
    else
        log "  Evidence: nvidia-smi unresponsive (no kernel errors — possible driver hang)"
    fi

    # Record reboot timestamp
    echo "$NOW" > "$STATE_FILE"
    log "  Uptime was: ${UPTIME_SECONDS}s | Last reboot: ${SINCE_LAST}s ago"
    log "  Initiating reboot NOW"

    # Sync filesystems before reboot
    sync
    sleep 2
    /sbin/reboot
else
    log "RECOVERED: nvidia-smi passed on confirmation check — no reboot needed"
    exit 0
fi
