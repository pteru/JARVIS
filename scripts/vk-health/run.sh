#!/bin/bash
# VK Health Monitor — Orchestrator
# Runs the full pipeline: collect -> analyze -> alert with flock-based locking.
# Includes pre-flight checks: campaign flag, VPN connectivity, analysis throttle, heartbeat.
# Usage: run.sh [deployment-id] (default: 03002)
set -euo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_ID="${1:-03002}"

LOG_DIR="$ORCHESTRATOR_HOME/logs"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [run] $*" >&2; }

# Source config (sets DATA_DIR, CONFIG_FILE, PIPELINE_ENABLED, etc.)
source "$SCRIPT_DIR/lib/config.sh" "$DEPLOYMENT_ID"
source "$SCRIPT_DIR/lib/telegram.sh"

# ===========================================================================
# Gate 1 — Campaign flag
# ===========================================================================
if [[ "$PIPELINE_ENABLED" == "false" ]]; then
    log "Pipeline disabled (campaign inactive) for deployment $DEPLOYMENT_ID"
    exit 0
fi

# ---------------------------------------------------------------------------
# Prevent overlapping runs using flock
# ---------------------------------------------------------------------------
LOCK_FILE="/tmp/vk-health-${DEPLOYMENT_ID}.lock"
exec 200>"$LOCK_FILE"
flock -n 200 || {
    log "Another instance is already running for deployment $DEPLOYMENT_ID"
    exit 0
}

# ===========================================================================
# Gate 2 — VPN connectivity via ping
# ===========================================================================
VPN_ALERT_STATE="$DATA_DIR/vpn-alert-state.json"

# Extract all node IPs from config
mapfile -t NODE_IPS < <(jq -r '.nodes[].host' "$CONFIG_FILE")
REACHABLE_COUNT=0
TOTAL_NODES=${#NODE_IPS[@]}

for ip in "${NODE_IPS[@]}"; do
    if ping -c 1 -W 2 "$ip" &>/dev/null; then
        REACHABLE_COUNT=$((REACHABLE_COUNT + 1))
    fi
done

if [[ "$REACHABLE_COUNT" -eq 0 ]]; then
    log "VPN check FAILED: 0/${TOTAL_NODES} nodes reachable"

    # Check cooldown to avoid spamming
    SEND_VPN_ALERT=true
    if [[ -f "$VPN_ALERT_STATE" ]]; then
        LAST_VPN_ALERT=$(jq -r '.last_sent // empty' "$VPN_ALERT_STATE")
        if [[ -n "$LAST_VPN_ALERT" ]]; then
            LAST_VPN_EPOCH=$(date -d "$LAST_VPN_ALERT" +%s 2>/dev/null || echo 0)
            NOW_EPOCH=$(date +%s)
            VPN_COOLDOWN=$((ALERT_COOLDOWN_MINUTES * 60))
            if [[ $((NOW_EPOCH - LAST_VPN_EPOCH)) -lt "$VPN_COOLDOWN" ]]; then
                SEND_VPN_ALERT=false
                log "VPN alert suppressed (cooldown active)"
            fi
        fi
    fi

    if [[ "$SEND_VPN_ALERT" == "true" ]]; then
        HOSTNAME_LOCAL=$(hostname)
        VPN_MSG="$(printf '\xF0\x9F\x94\xB4') VPN DISCONNECTED — $(jq -r '.name' "$CONFIG_FILE")

Cannot reach any VK node from ${HOSTNAME_LOCAL}.
Pipeline aborted — this is NOT a node failure.

Nodes tried: ${NODE_IPS[*]}
Time: $(date '+%Y-%m-%d %H:%M')
---
JARVIS Health Monitor"

        HTTP_CODE=$(send_telegram "$VPN_MSG")
        if [[ "$HTTP_CODE" == "200" ]]; then
            log "VPN disconnect alert sent to Telegram"
        else
            log "ERROR: Failed to send VPN alert (HTTP $HTTP_CODE)"
        fi

        # Update VPN alert state
        jq -n --arg ts "$(date -Iseconds)" '{ last_sent: $ts }' > "$VPN_ALERT_STATE"
    fi

    exit 0
else
    log "VPN check OK: ${REACHABLE_COUNT}/${TOTAL_NODES} nodes reachable"
    # Clear VPN alert state on successful connectivity
    if [[ -f "$VPN_ALERT_STATE" ]]; then
        rm -f "$VPN_ALERT_STATE"
    fi
fi

# ===========================================================================
# Pipeline start
# ===========================================================================
log "Starting health check pipeline for deployment $DEPLOYMENT_ID"
PIPELINE_START=$(date +%s)

# Track exit status across steps
EXIT_STATUS=0

# ---------------------------------------------------------------------------
# Step 1: Collect
# ---------------------------------------------------------------------------
log "Step 1/3: Data collection"
STEP_START=$(date +%s)
if "$SCRIPT_DIR/collect.sh" "$DEPLOYMENT_ID"; then
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "Collection completed in ${STEP_DURATION}s"
else
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "ERROR: Collection failed after ${STEP_DURATION}s"
    EXIT_STATUS=1
fi

# ---------------------------------------------------------------------------
# Step 2: Analyze (with frequency throttle)
# ---------------------------------------------------------------------------
ANALYSIS_STATE_FILE="$DATA_DIR/analysis-state.json"
SKIP_ANALYSIS=false

if [[ "$EXIT_STATUS" -ne 0 ]]; then
    log "Step 2/3: Skipping analysis (collection failed)"
    SKIP_ANALYSIS=true
elif [[ "$ANALYSIS_ENABLED" == "false" ]]; then
    log "Step 2/3: Skipping analysis (disabled in config)"
    SKIP_ANALYSIS=true
else
    # Check analysis frequency throttle
    if [[ -f "$ANALYSIS_STATE_FILE" ]]; then
        LAST_ANALYSIS=$(jq -r '.last_run // empty' "$ANALYSIS_STATE_FILE")
        if [[ -n "$LAST_ANALYSIS" ]]; then
            LAST_ANALYSIS_EPOCH=$(date -d "$LAST_ANALYSIS" +%s 2>/dev/null || echo 0)
            NOW_EPOCH=$(date +%s)
            ANALYSIS_COOLDOWN=$((ANALYSIS_INTERVAL_MINUTES * 60))
            ELAPSED=$((NOW_EPOCH - LAST_ANALYSIS_EPOCH))
            if [[ "$ELAPSED" -lt "$ANALYSIS_COOLDOWN" ]]; then
                REMAINING=$(( (ANALYSIS_COOLDOWN - ELAPSED) / 60 ))
                log "Step 2/3: Skipping analysis (next in ${REMAINING}m)"
                SKIP_ANALYSIS=true
            fi
        fi
    fi
fi

if [[ "$SKIP_ANALYSIS" == "false" ]]; then
    log "Step 2/3: AI analysis"
    STEP_START=$(date +%s)
    if "$SCRIPT_DIR/analyze.sh" "$DEPLOYMENT_ID"; then
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "Analysis completed in ${STEP_DURATION}s"
        # Update analysis state with current timestamp
        jq -n --arg ts "$(date -Iseconds)" '{ last_run: $ts }' > "$ANALYSIS_STATE_FILE"
    else
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "ERROR: Analysis failed after ${STEP_DURATION}s"
        EXIT_STATUS=1
    fi
fi

# ---------------------------------------------------------------------------
# Step 3: Alert (runs even if analysis failed/skipped, as long as collection succeeded)
# ---------------------------------------------------------------------------
if [[ -d "$ORCHESTRATOR_HOME/data/vk-health/$DEPLOYMENT_ID/$(date -u +%Y-%m-%d)" ]]; then
    log "Step 3/3: Alert checks"
    STEP_START=$(date +%s)
    if "$SCRIPT_DIR/alert.sh" "$DEPLOYMENT_ID"; then
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "Alert checks completed in ${STEP_DURATION}s"
    else
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "ERROR: Alert checks failed after ${STEP_DURATION}s"
        EXIT_STATUS=1
    fi
else
    log "Step 3/3: Skipping alerts (no snapshot data available)"
fi

# ===========================================================================
# Gate 4 — Heartbeat "all clear"
# ===========================================================================
HEARTBEAT_STATE_FILE="$DATA_DIR/heartbeat-state.json"
LAST_ALERT_COUNT_FILE="$DATA_DIR/last-alert-count"
ALERTS_SENT=0

if [[ -f "$LAST_ALERT_COUNT_FILE" ]]; then
    ALERTS_SENT=$(cat "$LAST_ALERT_COUNT_FILE" 2>/dev/null || echo 0)
fi

# Only send heartbeat if no alerts were sent this cycle
if [[ "$ALERTS_SENT" -eq 0 && "$EXIT_STATUS" -eq 0 ]]; then
    SEND_HEARTBEAT=false
    NOW_EPOCH=$(date +%s)
    HEARTBEAT_COOLDOWN=$((HEARTBEAT_INTERVAL_MINUTES * 60))

    if [[ -f "$HEARTBEAT_STATE_FILE" ]]; then
        LAST_HEARTBEAT=$(jq -r '.last_sent // empty' "$HEARTBEAT_STATE_FILE")
        if [[ -n "$LAST_HEARTBEAT" ]]; then
            LAST_HB_EPOCH=$(date -d "$LAST_HEARTBEAT" +%s 2>/dev/null || echo 0)
            ELAPSED=$((NOW_EPOCH - LAST_HB_EPOCH))
            if [[ "$ELAPSED" -ge "$HEARTBEAT_COOLDOWN" ]]; then
                SEND_HEARTBEAT=true
            fi
        else
            SEND_HEARTBEAT=true
        fi
    else
        SEND_HEARTBEAT=true
    fi

    if [[ "$SEND_HEARTBEAT" == "true" ]]; then
        DEPLOYMENT_NAME=$(jq -r '.name' "$CONFIG_FILE")
        HB_MSG="$(printf '\xF0\x9F\x9F\xA2') ALL CLEAR — ${DEPLOYMENT_NAME}

All ${TOTAL_NODES} nodes healthy. Pipeline running normally.
Time: $(date '+%Y-%m-%d %H:%M')
---
JARVIS Health Monitor"

        HTTP_CODE=$(send_telegram "$HB_MSG")
        if [[ "$HTTP_CODE" == "200" ]]; then
            log "Heartbeat sent to Telegram"
            jq -n --arg ts "$(date -Iseconds)" '{ last_sent: $ts }' > "$HEARTBEAT_STATE_FILE"
        else
            log "ERROR: Failed to send heartbeat (HTTP $HTTP_CODE)"
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Log dispatch
# ---------------------------------------------------------------------------
PIPELINE_END=$(date +%s)
PIPELINE_DURATION=$((PIPELINE_END - PIPELINE_START))

if [[ "$EXIT_STATUS" -eq 0 ]]; then
    STATUS="complete"
else
    STATUS="partial"
fi

log "Pipeline ${STATUS} in ${PIPELINE_DURATION}s"

LOG_DISPATCH="$ORCHESTRATOR_HOME/scripts/helpers/log-dispatch.sh"
if [[ -x "$LOG_DISPATCH" ]]; then
    "$LOG_DISPATCH" \
        "vk-health" \
        "Health check ${DEPLOYMENT_ID}" \
        "strokmatic.visionking" \
        "opus" \
        "$STATUS" \
        "$PIPELINE_DURATION" || log "WARNING: Failed to log dispatch"
else
    log "WARNING: log-dispatch.sh not found at $LOG_DISPATCH"
fi

exit "$EXIT_STATUS"
