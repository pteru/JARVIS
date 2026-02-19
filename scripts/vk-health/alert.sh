#!/bin/bash
# VK Health Monitor — Threshold alerting with deduplication
# Reads the latest snapshot, checks against thresholds, sends Telegram alerts.
# Usage: alert.sh [deployment-id] (default: 03002)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source config (sets thresholds, DATA_DIR, REPORT_DIR, DEPLOYMENT_ID, NODE_NAMES, etc.)
source "$SCRIPT_DIR/lib/config.sh" "${1:-03002}"
source "$SCRIPT_DIR/lib/telegram.sh"

LOG_DIR="$ORCHESTRATOR_HOME/logs"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [alert] $*" >&2; }

TODAY=$(date -u +%Y-%m-%d)
SNAPSHOT_DIR="$DATA_DIR/$TODAY"
ALERT_STATE_FILE="$DATA_DIR/alert-state.json"
DEPLOYMENT_NAME=$(jq -r '.name // empty' "$CONFIG_FILE")
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-VisionKing $DEPLOYMENT_ID}"

# ---------------------------------------------------------------------------
# Find the latest snapshot
# ---------------------------------------------------------------------------
if [[ ! -d "$SNAPSHOT_DIR" ]]; then
    log "ERROR: No snapshot directory for today: $SNAPSHOT_DIR"
    exit 1
fi

LATEST_SNAPSHOT=$(ls -t "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null | head -n 1)
if [[ -z "$LATEST_SNAPSHOT" ]]; then
    log "ERROR: No snapshots found in $SNAPSHOT_DIR"
    exit 1
fi
log "Using snapshot: $LATEST_SNAPSHOT"

# ---------------------------------------------------------------------------
# Load alert state (deduplication)
# ---------------------------------------------------------------------------
if [[ -f "$ALERT_STATE_FILE" ]]; then
    ALERT_STATE=$(cat "$ALERT_STATE_FILE")
else
    ALERT_STATE='{}'
fi

# Current time in epoch seconds
NOW_EPOCH=$(date +%s)
COOLDOWN_SECONDS=$((ALERT_COOLDOWN_MINUTES * 60))

# ---------------------------------------------------------------------------
# Alert dedup check: returns 0 if alert should be sent, 1 if still in cooldown
# ---------------------------------------------------------------------------
should_send_alert() {
    local alert_key="$1"
    local last_sent
    last_sent=$(echo "$ALERT_STATE" | jq -r --arg k "$alert_key" '.[$k].last_sent // empty')

    if [[ -z "$last_sent" ]]; then
        return 0  # Never sent before
    fi

    local last_epoch
    last_epoch=$(date -d "$last_sent" +%s 2>/dev/null || echo 0)
    local elapsed=$((NOW_EPOCH - last_epoch))

    if [[ "$elapsed" -ge "$COOLDOWN_SECONDS" ]]; then
        return 0  # Cooldown expired
    else
        return 1  # Still in cooldown
    fi
}

# ---------------------------------------------------------------------------
# Record that an alert was sent
# ---------------------------------------------------------------------------
record_alert_sent() {
    local alert_key="$1"
    local now_iso
    now_iso=$(date -Iseconds)

    local prev_count
    prev_count=$(echo "$ALERT_STATE" | jq -r --arg k "$alert_key" '.[$k].count // 0')
    local new_count=$((prev_count + 1))

    ALERT_STATE=$(echo "$ALERT_STATE" | jq \
        --arg k "$alert_key" \
        --arg ts "$now_iso" \
        --argjson c "$new_count" \
        '.[$k] = { last_sent: $ts, count: $c }')
}

# ---------------------------------------------------------------------------
# Accumulate alerts: array of "SEVERITY|alert_key|message"
# ---------------------------------------------------------------------------
ALERTS=()

add_alert() {
    local severity="$1"
    local alert_key="$2"
    local message="$3"

    if should_send_alert "$alert_key"; then
        ALERTS+=("${severity}|${alert_key}|${message}")
        log "Alert queued: [$severity] $alert_key — $message"
    else
        log "Alert suppressed (cooldown): [$severity] $alert_key"
    fi
}

# ---------------------------------------------------------------------------
# Run threshold checks
# ---------------------------------------------------------------------------
log "Running threshold checks..."

for node in "${NODE_NAMES[@]}"; do

    # --- Node reachable ---
    local_reachable=$(jq -r --arg n "$node" '.nodes[$n].reachable // true' "$LATEST_SNAPSHOT")
    if [[ "$local_reachable" == "false" ]]; then
        add_alert "CRITICAL" "${node}_unreachable" "Node ${node} is unreachable via SSH"
        continue  # Skip further checks for unreachable nodes
    fi

    # --- Root disk usage (system disk — high thresholds, less critical) ---
    disk_pct=$(jq -r --arg n "$node" '.nodes[$n].prometheus.disk_root_pct // empty' "$LATEST_SNAPSHOT" 2>/dev/null)

    if [[ -n "$disk_pct" && "$disk_pct" != "null" ]]; then
        disk_int=${disk_pct%.*}  # Truncate to integer
        if [[ "$disk_int" -ge 95 ]]; then
            add_alert "CRITICAL" "${node}_disk_root_critical" "Root disk at ${disk_pct}% on ${node}"
        elif [[ "$disk_int" -ge 90 ]]; then
            add_alert "WARNING" "${node}_disk_root_warning" "Root disk at ${disk_pct}% on ${node}"
        fi
    fi

    # --- Image storage disk (~/Downloads/img_saved — the critical production disk) ---
    disk_img_pct=$(jq -r --arg n "$node" '.nodes[$n].prometheus.disk_img_saved_pct // empty' "$LATEST_SNAPSHOT" 2>/dev/null)
    if [[ -n "$disk_img_pct" && "$disk_img_pct" != "null" ]]; then
        disk_img_int=${disk_img_pct%.*}
        if [[ "$disk_img_int" -ge "$DISK_CRITICAL_PCT" ]]; then
            add_alert "CRITICAL" "${node}_disk_img_critical" "Image storage disk at ${disk_img_pct}% on ${node} (threshold: ${DISK_CRITICAL_PCT}%)"
        elif [[ "$disk_img_int" -ge "$DISK_WARNING_PCT" ]]; then
            add_alert "WARNING" "${node}_disk_img_warning" "Image storage disk at ${disk_img_pct}% on ${node} (threshold: ${DISK_WARNING_PCT}%)"
        fi
    fi

    # --- RAM usage ---
    ram_pct=$(jq -r --arg n "$node" '.nodes[$n].prometheus.ram_pct // empty' "$LATEST_SNAPSHOT" 2>/dev/null)
    if [[ -n "$ram_pct" && "$ram_pct" != "null" ]]; then
        ram_int=${ram_pct%.*}
        if [[ "$ram_int" -ge "$RAM_CRITICAL_PCT" ]]; then
            add_alert "CRITICAL" "${node}_ram_critical" "RAM usage at ${ram_pct}% on ${node} (threshold: ${RAM_CRITICAL_PCT}%)"
        elif [[ "$ram_int" -ge "$RAM_WARNING_PCT" ]]; then
            add_alert "WARNING" "${node}_ram_warning" "RAM usage at ${ram_pct}% on ${node} (threshold: ${RAM_WARNING_PCT}%)"
        fi
    fi

    # --- GPU memory (only for GPU nodes) ---
    has_gpu=$(jq -r --arg n "$node" '.nodes[$n].has_gpu // false' "$CONFIG_FILE")
    if [[ "$has_gpu" == "true" ]]; then
        gpu_mem_pct=$(jq -r --arg n "$node" '.nodes[$n].prometheus.gpu_mem_pct // empty' "$LATEST_SNAPSHOT" 2>/dev/null)
        if [[ -n "$gpu_mem_pct" && "$gpu_mem_pct" != "null" ]]; then
            gpu_mem_int=${gpu_mem_pct%.*}
            if [[ "$gpu_mem_int" -ge "$GPU_MEM_CRITICAL_PCT" ]]; then
                add_alert "CRITICAL" "${node}_gpu_mem_critical" "GPU memory at ${gpu_mem_pct}% on ${node} (threshold: ${GPU_MEM_CRITICAL_PCT}%)"
            elif [[ "$gpu_mem_int" -ge "$GPU_MEM_WARNING_PCT" ]]; then
                add_alert "WARNING" "${node}_gpu_mem_warning" "GPU memory at ${gpu_mem_pct}% on ${node} (threshold: ${GPU_MEM_WARNING_PCT}%)"
            fi
        fi
    fi

    # --- Container status (from docker data) ---
    container_statuses=$(jq -r --arg n "$node" '
        .nodes[$n].docker.containers // []
        | .[]
        | select(.State != null and .State != "running")
        | "\(.Names)=\(.State)"
    ' "$LATEST_SNAPSHOT" 2>/dev/null || true)

    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        container_name="${line%%=*}"
        container_status="${line#*=}"
        add_alert "CRITICAL" "${node}_container_${container_name}" "Container ${container_name} is ${container_status} on ${node}"
    done <<< "$container_statuses"

    # --- Container restart counts (from Prometheus container data) ---
    restart_entries=$(jq -r --arg n "$node" '
        .nodes[$n].prometheus.containers // {}
        | to_entries[]
        | select(.value.restart_count != null and (.value.restart_count | tonumber) > 0)
        | "\(.key)=\(.value.restart_count)"
    ' "$LATEST_SNAPSHOT" 2>/dev/null || true)

    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        container_name="${line%%=*}"
        restart_count="${line#*=}"
        restart_int=${restart_count%.*}
        if [[ "$restart_int" -ge "$RESTART_CRITICAL" ]]; then
            add_alert "CRITICAL" "${node}_restart_${container_name}" "Container ${container_name} has ${restart_count} restarts on ${node} (threshold: ${RESTART_CRITICAL})"
        elif [[ "$restart_int" -ge "$RESTART_WARNING" ]]; then
            add_alert "WARNING" "${node}_restart_${container_name}" "Container ${container_name} has ${restart_count} restarts on ${node} (threshold: ${RESTART_WARNING})"
        fi
    done <<< "$restart_entries"

    # --- Queue depth (RabbitMQ — processing nodes only) ---
    queue_entries=$(jq -r --arg n "$node" '
        .nodes[$n].rabbitmq.queues // []
        | .[]
        | select(.messages != null)
        | "\(.name // .queue)=\(.messages)"
    ' "$LATEST_SNAPSHOT" 2>/dev/null || true)

    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        queue_name="${line%%=*}"
        queue_depth="${line#*=}"
        queue_int=${queue_depth%.*}
        if [[ "$queue_int" -ge "$QUEUE_CRITICAL" ]]; then
            add_alert "CRITICAL" "${node}_queue_${queue_name}" "Queue ${queue_name} depth at ${queue_depth} on ${node} (threshold: ${QUEUE_CRITICAL})"
        elif [[ "$queue_int" -ge "$QUEUE_WARNING" ]]; then
            add_alert "WARNING" "${node}_queue_${queue_name}" "Queue ${queue_name} depth at ${queue_depth} on ${node} (threshold: ${QUEUE_WARNING})"
        fi
    done <<< "$queue_entries"

    # --- Image-saver health (processing nodes only) ---
    is_health=$(jq -r --arg n "$node" '.nodes[$n].health_endpoints.image_saver.status // empty' "$LATEST_SNAPSHOT" 2>/dev/null)
    if [[ -n "$is_health" && "$is_health" != "null" && "$is_health" != "ok" && "$is_health" != "healthy" ]]; then
        add_alert "WARNING" "${node}_image_saver_health" "Image-saver health check returned '${is_health}' on ${node}"
    fi

    # --- Uptime / recent reboot ---
    uptime_secs=$(jq -r --arg n "$node" '.nodes[$n].prometheus.uptime_seconds // empty' "$LATEST_SNAPSHOT" 2>/dev/null)
    if [[ -n "$uptime_secs" && "$uptime_secs" != "null" ]]; then
        uptime_int=${uptime_secs%.*}
        if [[ "$uptime_int" -lt 1800 ]]; then
            uptime_min=$((uptime_int / 60))
            add_alert "WARNING" "${node}_recent_reboot" "Node ${node} recently rebooted (uptime: ${uptime_min} minutes)"
        fi
    fi

done

# --- GUI endpoint checks ---
# 200 and 302 (login redirect) are both healthy; 0 means unreachable
gui_bad=$(jq -r '
    .gui_status // {}
    | to_entries[]
    | select(.value != 200 and .value != 302 and .value != null)
    | "\(.key)=\(.value)"
' "$LATEST_SNAPSHOT" 2>/dev/null || true)

while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    endpoint_name="${line%%=*}"
    status_code="${line#*=}"
    if [[ "$status_code" == "0" ]]; then
        add_alert "WARNING" "gui_${endpoint_name}" "GUI endpoint ${endpoint_name} is unreachable (connection refused)"
    else
        add_alert "WARNING" "gui_${endpoint_name}" "GUI endpoint ${endpoint_name} returned HTTP ${status_code}"
    fi
done <<< "$gui_bad"

# ---------------------------------------------------------------------------
# Send alerts via Telegram
# ---------------------------------------------------------------------------
ALERT_COUNT=${#ALERTS[@]}
CRITICAL_COUNT=0
WARNING_COUNT=0

if [[ "$ALERT_COUNT" -eq 0 ]]; then
    log "No alerts to send"
else
    log "Processing $ALERT_COUNT alert(s)..."

    # Separate CRITICAL and WARNING alerts
    CRITICAL_MSGS=""
    WARNING_MSGS=""

    for alert_entry in "${ALERTS[@]}"; do
        IFS='|' read -r severity alert_key message <<< "$alert_entry"

        case "$severity" in
            CRITICAL)
                CRITICAL_MSGS="${CRITICAL_MSGS}\n- ${message}"
                CRITICAL_COUNT=$((CRITICAL_COUNT + 1))
                ;;
            WARNING)
                WARNING_MSGS="${WARNING_MSGS}\n- ${message}"
                WARNING_COUNT=$((WARNING_COUNT + 1))
                ;;
        esac
    done

    # Build combined Telegram message
    TELEGRAM_MSG=""
    NOW_FORMATTED=$(date '+%Y-%m-%d %H:%M')

    if [[ "$CRITICAL_COUNT" -gt 0 ]]; then
        TELEGRAM_MSG="${TELEGRAM_MSG}$(printf '\xF0\x9F\x94\xB4') CRITICAL -- ${DEPLOYMENT_NAME}

Issues (${CRITICAL_COUNT}):$(echo -e "$CRITICAL_MSGS")

Time: ${NOW_FORMATTED}"
    fi

    if [[ "$WARNING_COUNT" -gt 0 ]]; then
        if [[ -n "$TELEGRAM_MSG" ]]; then
            TELEGRAM_MSG="${TELEGRAM_MSG}

---

"
        fi
        TELEGRAM_MSG="${TELEGRAM_MSG}$(printf '\xF0\x9F\x9F\xA1') WARNING -- ${DEPLOYMENT_NAME}

Issues (${WARNING_COUNT}):$(echo -e "$WARNING_MSGS")

Time: ${NOW_FORMATTED}"
    fi

    TELEGRAM_MSG="${TELEGRAM_MSG}

---
JARVIS Health Monitor"

    # Send the combined message
    HTTP_CODE=$(send_telegram "$TELEGRAM_MSG")
    if [[ "$HTTP_CODE" == "200" ]]; then
        log "Telegram notification sent successfully (${ALERT_COUNT} alert(s))"

        # Record all alerts as sent
        for alert_entry in "${ALERTS[@]}"; do
            IFS='|' read -r severity alert_key message <<< "$alert_entry"
            record_alert_sent "$alert_key"
        done
    else
        log "ERROR: Telegram send failed with HTTP $HTTP_CODE"
    fi
fi

# ---------------------------------------------------------------------------
# Persist alert state
# ---------------------------------------------------------------------------
echo "$ALERT_STATE" | jq '.' > "$ALERT_STATE_FILE"
log "Alert state saved to $ALERT_STATE_FILE"

log "Alert check complete: $CRITICAL_COUNT critical, $WARNING_COUNT warning out of $ALERT_COUNT total"
