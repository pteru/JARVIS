#!/bin/bash
# Health Monitor — generic config-driven alert stage
# Usage: alert.sh <product> <deployment>
#
# Runs the check engine over the latest snapshot, fires Telegram alerts for
# warn/crit verdicts with cooldown dedup, writes last-alert-count.
#
# Interfaces:
#   Consumes: lib/config.sh, lib/checks.sh, lib/telegram.sh
#   Reads:    $DATA_DIR/<utc-date>/snapshot-<utc-time>.json (newest)
#   Writes:   $DATA_DIR/alert-state.json  (dedup state)
#             $DATA_DIR/last-alert-count  (read by run.sh / orchestrator)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"

# ---------------------------------------------------------------------------
# Load config + libraries
# ---------------------------------------------------------------------------
# shellcheck source=../lib/config.sh
source "$LIB_DIR/config.sh"
load_health_config "${1:?product required}" "${2:?deployment required}"

# shellcheck source=../lib/checks.sh
source "$LIB_DIR/checks.sh"
# shellcheck source=../lib/telegram.sh
source "$LIB_DIR/telegram.sh"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] [alert] $*" >&2; }

# ---------------------------------------------------------------------------
# Find latest snapshot (today UTC)
# ---------------------------------------------------------------------------
TODAY_UTC=$(date -u +%Y-%m-%d)
SNAPSHOT_DIR="$DATA_DIR/$TODAY_UTC"
ALERT_STATE_FILE="$DATA_DIR/alert-state.json"

if [[ ! -d "$SNAPSHOT_DIR" ]]; then
    log "No snapshot directory for today ($SNAPSHOT_DIR) — skipping"
    mkdir -p "$DATA_DIR"
    echo "0" > "$DATA_DIR/last-alert-count"
    exit 0
fi

LATEST_SNAPSHOT=$(ls -1 "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null | sort | tail -n 1 || true)
if [[ -z "$LATEST_SNAPSHOT" ]]; then
    log "No snapshot files in $SNAPSHOT_DIR — skipping"
    mkdir -p "$DATA_DIR"
    echo "0" > "$DATA_DIR/last-alert-count"
    exit 0
fi
log "Using snapshot: $LATEST_SNAPSHOT"

# ---------------------------------------------------------------------------
# Alert dedup state
# ---------------------------------------------------------------------------
if [[ -f "$ALERT_STATE_FILE" ]]; then
    ALERT_STATE=$(cat "$ALERT_STATE_FILE")
else
    ALERT_STATE='{}'
fi

NOW_EPOCH=$(date +%s)
COOLDOWN_SECONDS=$(( ALERT_COOLDOWN_MINUTES * 60 ))

# Returns 0 if alert should be sent, 1 if still in cooldown
should_send_alert() {
    local alert_key="$1"
    local last_sent
    last_sent=$(echo "$ALERT_STATE" | jq -r --arg k "$alert_key" '.[$k].last_sent // empty')

    if [[ -z "$last_sent" ]]; then
        return 0  # Never sent
    fi

    local last_epoch
    last_epoch=$(date -d "$last_sent" +%s 2>/dev/null || echo 0)
    local elapsed=$(( NOW_EPOCH - last_epoch ))

    if [[ "$elapsed" -ge "$COOLDOWN_SECONDS" ]]; then
        return 0  # Cooldown expired
    else
        return 1  # Still in cooldown
    fi
}

# Record that an alert key was sent (updates ALERT_STATE in-memory)
record_alert_sent() {
    local alert_key="$1"
    local now_iso
    now_iso=$(date -Iseconds)

    local prev_count
    prev_count=$(echo "$ALERT_STATE" | jq -r --arg k "$alert_key" '.[$k].count // 0')
    local new_count=$(( prev_count + 1 ))

    ALERT_STATE=$(echo "$ALERT_STATE" | jq \
        --arg k "$alert_key" \
        --arg ts "$now_iso" \
        --argjson c "$new_count" \
        '.[$k] = { last_sent: $ts, count: $c }')
}

# ---------------------------------------------------------------------------
# Run check engine and collect warn/crit rows
# ---------------------------------------------------------------------------
log "Running check engine..."

CRITICAL_MSGS=""
WARNING_MSGS=""
CRITICAL_KEYS=()
WARNING_KEYS=()

while IFS=$'\t' read -r severity label metric_key value _threshold; do
    case "$severity" in
        crit|warn) ;;
        *) continue ;;  # ok / unknown — skip
    esac

    # alert_key = metric_key (stable, per-check-instance identifier)
    alert_key="$metric_key"

    if ! should_send_alert "$alert_key"; then
        log "Alert suppressed (cooldown): [$severity] $label ($alert_key)"
        continue
    fi

    local_msg="- ${label} (${metric_key}): ${value}"
    log "Alert queued: [$severity] $local_msg"

    if [[ "$severity" == "crit" ]]; then
        CRITICAL_MSGS="${CRITICAL_MSGS}${CRITICAL_MSGS:+$'\n'}${local_msg}"
        CRITICAL_KEYS+=("$alert_key")
    else
        WARNING_MSGS="${WARNING_MSGS}${WARNING_MSGS:+$'\n'}${local_msg}"
        WARNING_KEYS+=("$alert_key")
    fi

done < <(evaluate_checks "$LATEST_SNAPSHOT" "$CONFIG_FILE")

CRITICAL_COUNT=${#CRITICAL_KEYS[@]}
WARNING_COUNT=${#WARNING_KEYS[@]}
ALERT_COUNT=$(( CRITICAL_COUNT + WARNING_COUNT ))

# ---------------------------------------------------------------------------
# Send grouped Telegram message
# ---------------------------------------------------------------------------
if [[ "$ALERT_COUNT" -eq 0 ]]; then
    log "No alerts to send"
else
    log "Sending $ALERT_COUNT alert(s) ($CRITICAL_COUNT critical, $WARNING_COUNT warning)..."

    NOW_FORMATTED=$(date -u '+%Y-%m-%d %H:%M UTC')
    TELEGRAM_MSG=""

    if [[ "$CRITICAL_COUNT" -gt 0 ]]; then
        TELEGRAM_MSG="${TELEGRAM_MSG}🔴 CRITICAL — ${HEALTH_NAME}

Issues (${CRITICAL_COUNT}):
${CRITICAL_MSGS}

Time: ${NOW_FORMATTED}"
    fi

    if [[ "$WARNING_COUNT" -gt 0 ]]; then
        if [[ -n "$TELEGRAM_MSG" ]]; then
            TELEGRAM_MSG="${TELEGRAM_MSG}

---

"
        fi
        TELEGRAM_MSG="${TELEGRAM_MSG}🟡 WARNING — ${HEALTH_NAME}

Issues (${WARNING_COUNT}):
${WARNING_MSGS}

Time: ${NOW_FORMATTED}"
    fi

    TELEGRAM_MSG="${TELEGRAM_MSG}

---
JARVIS Health Monitor"

    HTTP_CODE=$(send_telegram "$TELEGRAM_MSG")
    if [[ "$HTTP_CODE" == "200" ]]; then
        log "Telegram notification sent (HTTP 200)"
        # Record all sent keys
        for k in "${CRITICAL_KEYS[@]}"; do record_alert_sent "$k"; done
        for k in "${WARNING_KEYS[@]}";  do record_alert_sent "$k"; done
    else
        log "ERROR: Telegram send failed with HTTP $HTTP_CODE"
        # Don't record — allow retry on next run.
        # ALERT_COUNT is intentionally NOT reset so the real count is written to
        # last-alert-count, preventing a false "all clear" while alerts are live
        # but the send channel is temporarily unavailable.
    fi
fi

# ---------------------------------------------------------------------------
# Persist state and write count
# ---------------------------------------------------------------------------
mkdir -p "$DATA_DIR"
echo "$ALERT_STATE" | jq '.' > "$ALERT_STATE_FILE"
echo "$ALERT_COUNT" > "$DATA_DIR/last-alert-count"
log "Alert state saved. Count: $ALERT_COUNT"
