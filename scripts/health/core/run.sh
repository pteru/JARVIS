#!/bin/bash
# Health Monitor — generic config-driven orchestrator
# Usage: run.sh <product> <deployment>
#
# Gate ladder (config-driven, no hardcoded product strings):
#   1. Campaign gate  — PIPELINE_ENABLED; skip + exit 0 when false
#   2. Connectivity   — ping CONNECTIVITY_NODES; send cooldown-deduped alert + exit 1 when 0 reachable
#   3. Lock           — flock /tmp/health-<product>-<deployment>.lock; exit 0 on contention
#   4. Collect        — bash $HEALTH_COLLECTOR_DIR/<product>.sh <deployment>
#   5. Analyze        — throttled by THROTTLE_MINUTES; bash $HEALTH_CORE_DIR/analyze.sh
#   6. Alert          — bash $HEALTH_CORE_DIR/alert.sh
#   7. Heartbeat      — "all clear" when last-alert-count==0 AND alert exited 0; cooldown deduped
#   8. Log dispatch   — optional, fail-open
#
# Overridable dirs (for testing):
#   HEALTH_COLLECTOR_DIR  default: $SCRIPT_DIR/../collectors
#   HEALTH_CORE_DIR       default: $SCRIPT_DIR  (run.sh lives in core/)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"

# Overridable dirs — set before sourcing config so tests can inject stubs
HEALTH_COLLECTOR_DIR="${HEALTH_COLLECTOR_DIR:-$SCRIPT_DIR/../collectors}"
HEALTH_CORE_DIR="${HEALTH_CORE_DIR:-$SCRIPT_DIR}"

# ---------------------------------------------------------------------------
# Source config + libraries
# ---------------------------------------------------------------------------
# shellcheck source=../lib/config.sh
source "$LIB_DIR/config.sh"
load_health_config "${1:?product required}" "${2:?deployment required}"

# shellcheck source=../lib/telegram.sh
source "$LIB_DIR/telegram.sh"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] [run] $*" >&2; }

# ---------------------------------------------------------------------------
# Gate 1 — Campaign flag
# ---------------------------------------------------------------------------
if [[ "$PIPELINE_ENABLED" != "true" ]]; then
    log "Pipeline disabled for ${HEALTH_PRODUCT}/${HEALTH_DEPLOYMENT} — exiting"
    exit 0
fi

# ---------------------------------------------------------------------------
# Gate 2 — Connectivity check
# ---------------------------------------------------------------------------
CONNECTIVITY_ALERT_STATE="$DATA_DIR/connectivity-alert-state.json"
TOTAL_NODES=${#CONNECTIVITY_NODES[@]}
REACHABLE_COUNT=0

for node in "${CONNECTIVITY_NODES[@]}"; do
    if ping -c 1 -W 2 "$node" &>/dev/null; then
        REACHABLE_COUNT=$((REACHABLE_COUNT + 1))
    fi
done

if [[ "$REACHABLE_COUNT" -eq 0 ]]; then
    log "Connectivity check FAILED: 0/${TOTAL_NODES} nodes reachable via ${CONNECTIVITY_LABEL}"

    # Cooldown dedup — avoid alert spam
    SEND_CONN_ALERT=true
    if [[ -f "$CONNECTIVITY_ALERT_STATE" ]]; then
        LAST_SENT=$(jq -r '.last_sent // empty' "$CONNECTIVITY_ALERT_STATE")
        if [[ -n "$LAST_SENT" ]]; then
            LAST_EPOCH=$(date -d "$LAST_SENT" +%s 2>/dev/null || echo 0)
            NOW_EPOCH=$(date +%s)
            COOLDOWN=$((ALERT_COOLDOWN_MINUTES * 60))
            if [[ $((NOW_EPOCH - LAST_EPOCH)) -lt "$COOLDOWN" ]]; then
                SEND_CONN_ALERT=false
                log "Connectivity alert suppressed (cooldown active)"
            fi
        fi
    fi

    if [[ "$SEND_CONN_ALERT" == "true" ]]; then
        HOSTNAME_LOCAL=$(hostname)
        CONN_MSG="$(printf '\xF0\x9F\x94\xB4') CONNECTIVITY LOST — ${HEALTH_NAME}

Cannot reach any ${CONNECTIVITY_LABEL} node from ${HOSTNAME_LOCAL}.
Pipeline aborted — this is NOT a node failure.

Nodes tried: ${CONNECTIVITY_NODES[*]}
Time: $(date -u '+%Y-%m-%d %H:%M UTC')
---
JARVIS Health Monitor"

        HTTP_CODE=$(send_telegram "$CONN_MSG" "health-${HEALTH_PRODUCT}")
        if [[ "$HTTP_CODE" == "200" ]]; then
            log "Connectivity alert sent to Telegram"
        else
            log "ERROR: Failed to send connectivity alert (HTTP $HTTP_CODE)"
        fi

        mkdir -p "$DATA_DIR"
        jq -n --arg ts "$(date -Iseconds)" '{ last_sent: $ts }' > "$CONNECTIVITY_ALERT_STATE"
    fi

    exit 1

else
    log "Connectivity OK: ${REACHABLE_COUNT}/${TOTAL_NODES} ${CONNECTIVITY_LABEL} nodes reachable"
    # Clear alert state on recovery
    rm -f "$CONNECTIVITY_ALERT_STATE"
fi

# ---------------------------------------------------------------------------
# Gate 3 — Lock (prevent overlapping runs)
# ---------------------------------------------------------------------------
LOCK_FILE="/tmp/health-${HEALTH_PRODUCT}-${HEALTH_DEPLOYMENT}.lock"
exec 200>"$LOCK_FILE"
flock -n 200 || {
    log "Another instance is already running for ${HEALTH_PRODUCT}/${HEALTH_DEPLOYMENT}"
    exit 0
}

# ---------------------------------------------------------------------------
# Pipeline start
# ---------------------------------------------------------------------------
log "Starting health check pipeline: ${HEALTH_PRODUCT}/${HEALTH_DEPLOYMENT}"
PIPELINE_START=$(date +%s)
EXIT_STATUS=0

# ---------------------------------------------------------------------------
# Step 1: Collect
# ---------------------------------------------------------------------------
log "Step 1/3: Data collection"
STEP_START=$(date +%s)
if bash "$HEALTH_COLLECTOR_DIR/${HEALTH_PRODUCT}.sh" "$HEALTH_DEPLOYMENT"; then
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "Collection completed in ${STEP_DURATION}s"
else
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "ERROR: Collection failed after ${STEP_DURATION}s"
    EXIT_STATUS=1
fi

# ---------------------------------------------------------------------------
# Step 2: Analyze (with throttle)
# ---------------------------------------------------------------------------
ANALYSIS_STATE_FILE="$DATA_DIR/analysis-state.json"
RUN_ANALYSIS=false

if [[ "$EXIT_STATUS" -ne 0 ]]; then
    log "Step 2/3: Skipping analysis (collection failed)"
else
    # Check throttle
    if [[ -f "$ANALYSIS_STATE_FILE" ]]; then
        LAST_RUN=$(jq -r '.last_run // empty' "$ANALYSIS_STATE_FILE")
        if [[ -n "$LAST_RUN" ]]; then
            LAST_EPOCH=$(date -d "$LAST_RUN" +%s 2>/dev/null || echo 0)
            NOW_EPOCH=$(date +%s)
            THROTTLE_SECONDS=$((THROTTLE_MINUTES * 60))
            ELAPSED=$((NOW_EPOCH - LAST_EPOCH))
            if [[ "$ELAPSED" -lt "$THROTTLE_SECONDS" ]]; then
                REMAINING=$(( (THROTTLE_SECONDS - ELAPSED) / 60 ))
                log "Step 2/3: Skipping analysis (throttled — next in ${REMAINING}m)"
            else
                RUN_ANALYSIS=true
            fi
        else
            RUN_ANALYSIS=true
        fi
    else
        RUN_ANALYSIS=true
    fi
fi

if [[ "$RUN_ANALYSIS" == "true" ]]; then
    log "Step 2/3: AI analysis"
    STEP_START=$(date +%s)
    if bash "$HEALTH_CORE_DIR/analyze.sh" "$HEALTH_PRODUCT" "$HEALTH_DEPLOYMENT"; then
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "Analysis completed in ${STEP_DURATION}s"
        mkdir -p "$DATA_DIR"
        jq -n --arg ts "$(date -Iseconds)" '{ last_run: $ts }' > "$ANALYSIS_STATE_FILE"
    else
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "ERROR: Analysis failed after ${STEP_DURATION}s"
        EXIT_STATUS=1
    fi
fi

# ---------------------------------------------------------------------------
# Step 3: Alert
# ---------------------------------------------------------------------------
log "Step 3/3: Alert checks"
STEP_START=$(date +%s)
ALERT_EXIT=0
if bash "$HEALTH_CORE_DIR/alert.sh" "$HEALTH_PRODUCT" "$HEALTH_DEPLOYMENT"; then
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "Alert checks completed in ${STEP_DURATION}s"
else
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "ERROR: Alert checks failed after ${STEP_DURATION}s"
    ALERT_EXIT=1
    EXIT_STATUS=1
fi

# ---------------------------------------------------------------------------
# Gate 7 — Heartbeat "all clear"
# Send only when: last-alert-count == 0 AND alert stage exited 0
# Never when alerts are live OR alert send failed (alert.sh writes real count
# even on telegram failure, so last-alert-count>0 blocks a false all-clear).
# ---------------------------------------------------------------------------
HEARTBEAT_STATE_FILE="$DATA_DIR/heartbeat-state.json"
LAST_ALERT_COUNT_FILE="$DATA_DIR/last-alert-count"
ALERTS_SENT=0

if [[ -f "$LAST_ALERT_COUNT_FILE" ]]; then
    ALERTS_SENT=$(cat "$LAST_ALERT_COUNT_FILE" 2>/dev/null || echo 0)
fi

if [[ "$ALERTS_SENT" -eq 0 && "$ALERT_EXIT" -eq 0 ]]; then
    SEND_HEARTBEAT=false
    NOW_EPOCH=$(date +%s)
    HB_COOLDOWN=$((HEARTBEAT_INTERVAL_MINUTES * 60))

    if [[ -f "$HEARTBEAT_STATE_FILE" ]]; then
        LAST_HB=$(jq -r '.last_sent // empty' "$HEARTBEAT_STATE_FILE")
        if [[ -n "$LAST_HB" ]]; then
            LAST_HB_EPOCH=$(date -d "$LAST_HB" +%s 2>/dev/null || echo 0)
            ELAPSED=$((NOW_EPOCH - LAST_HB_EPOCH))
            if [[ "$ELAPSED" -ge "$HB_COOLDOWN" ]]; then
                SEND_HEARTBEAT=true
            fi
        else
            SEND_HEARTBEAT=true
        fi
    else
        SEND_HEARTBEAT=true
    fi

    if [[ "$SEND_HEARTBEAT" == "true" ]]; then
        HB_MSG="$(printf '\xF0\x9F\x9F\xA2') ALL CLEAR — ${HEALTH_NAME}

All ${TOTAL_NODES} ${CONNECTIVITY_LABEL} nodes healthy. Pipeline running normally.
Time: $(date -u '+%Y-%m-%d %H:%M UTC')
---
JARVIS Health Monitor"

        HTTP_CODE=$(send_telegram "$HB_MSG" "health-${HEALTH_PRODUCT}")
        if [[ "$HTTP_CODE" == "200" ]]; then
            log "Heartbeat sent to Telegram"
            mkdir -p "$DATA_DIR"
            jq -n --arg ts "$(date -Iseconds)" '{ last_sent: $ts }' > "$HEARTBEAT_STATE_FILE"
        else
            log "ERROR: Failed to send heartbeat (HTTP $HTTP_CODE)"
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Step 8 — Log dispatch (optional, fail-open)
# ---------------------------------------------------------------------------
PIPELINE_END=$(date +%s)
PIPELINE_DURATION=$((PIPELINE_END - PIPELINE_START))

if [[ "$EXIT_STATUS" -eq 0 ]]; then
    STATUS="complete"
else
    STATUS="partial"
fi

log "Pipeline ${STATUS} in ${PIPELINE_DURATION}s"

LOG_DISPATCH="${ORCHESTRATOR_HOME}/scripts/helpers/log-dispatch.sh"
if [[ -x "$LOG_DISPATCH" ]]; then
    "$LOG_DISPATCH" \
        "health-${HEALTH_PRODUCT}" \
        "Health check ${HEALTH_DEPLOYMENT}" \
        "strokmatic.health" \
        "${CLAUDE_MODEL:-opus}" \
        "$STATUS" \
        "$PIPELINE_DURATION" || log "WARNING: log-dispatch.sh failed (non-fatal)"
else
    log "log-dispatch.sh not found or not executable — skipping"
fi

exit "$EXIT_STATUS"
