#!/bin/bash
# VK Health Monitor — Daily trend aggregation
# Reads all snapshots from today, computes per-node metric trends, and saves to trends.json.
# Also applies 90-day retention policy on old snapshot directories.
# Usage: trends.sh [deployment-id] (default: 03002)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source config (sets DATA_DIR, DEPLOYMENT_ID, NODE_NAMES, etc.)
source "$SCRIPT_DIR/lib/config.sh" "${1:-03002}"

LOG_DIR="$ORCHESTRATOR_HOME/logs"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [trends] $*" >&2; }

TODAY=$(date +%Y-%m-%d)
SNAPSHOT_DIR="$DATA_DIR/$TODAY"

# ---------------------------------------------------------------------------
# Validate snapshot directory
# ---------------------------------------------------------------------------
if [[ ! -d "$SNAPSHOT_DIR" ]]; then
    log "No snapshot directory for today: $SNAPSHOT_DIR"
    exit 0
fi

SNAPSHOT_FILES=$(ls "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null || true)
SNAPSHOT_COUNT=$(echo "$SNAPSHOT_FILES" | grep -c '\.json$' || echo 0)

if [[ "$SNAPSHOT_COUNT" -eq 0 ]]; then
    log "No snapshots found in $SNAPSHOT_DIR"
    exit 0
fi

log "Processing $SNAPSHOT_COUNT snapshot(s) for $TODAY"

# ---------------------------------------------------------------------------
# Build trends JSON using jq
# ---------------------------------------------------------------------------
# For each node, extract cpu_pct, ram_pct, disk_root_pct, gpu_util_pct, gpu_mem_pct
# from all snapshots and compute min, max, avg

build_node_trends() {
    local node="$1"
    local metric="$2"
    local jq_path="$3"

    # Collect all values for this metric across snapshots
    local values=()
    while IFS= read -r snap_file; do
        [[ -z "$snap_file" ]] && continue
        local val
        val=$(jq -r --arg n "$node" "$jq_path" "$snap_file" 2>/dev/null)
        if [[ -n "$val" && "$val" != "null" && "$val" != "" ]]; then
            values+=("$val")
        fi
    done <<< "$SNAPSHOT_FILES"

    local count=${#values[@]}
    if [[ "$count" -eq 0 ]]; then
        echo '{"min": null, "max": null, "avg": null, "samples": 0}'
        return
    fi

    # Compute min, max, avg using awk
    printf '%s\n' "${values[@]}" | awk '
        BEGIN { min=999999; max=-999999; sum=0; n=0 }
        {
            val=$1+0;
            if(val<min) min=val;
            if(val>max) max=val;
            sum+=val;
            n++
        }
        END {
            printf "{\"min\": %.2f, \"max\": %.2f, \"avg\": %.2f, \"samples\": %d}\n", min, max, sum/n, n
        }
    '
}

# Build the full trends object
TRENDS_JSON=$(jq -n --arg date "$TODAY" --arg id "$DEPLOYMENT_ID" --argjson count "$SNAPSHOT_COUNT" '{
    meta: {
        deployment_id: $id,
        date: $date,
        snapshot_count: $count,
        generated_at: (now | todate)
    },
    nodes: {}
}')

for node in "${NODE_NAMES[@]}"; do
    log "Computing trends for node: $node"

    cpu_trend=$(build_node_trends "$node" "cpu_pct" '.prometheus[$n].cpu_pct // empty')
    ram_trend=$(build_node_trends "$node" "ram_pct" '.prometheus[$n].ram_pct // empty')

    # Disk: try to get root mount usage
    disk_trend=$(build_node_trends "$node" "disk_root_pct" '
        .prometheus[$n].disk
        | if type == "array" then
            (map(select(.mountpoint == "/")) | .[0].usage_pct // .[0].used_pct // empty)
          elif type == "object" then
            .root_pct // empty
          elif type == "number" then
            .
          else empty end
    ')

    # GPU metrics (will return null for non-GPU nodes)
    gpu_util_trend=$(build_node_trends "$node" "gpu_util_pct" '.prometheus[$n].gpu.utilization_pct // empty')
    gpu_mem_trend=$(build_node_trends "$node" "gpu_mem_pct" '.prometheus[$n].gpu.memory_pct // empty')

    # Add node to trends JSON
    TRENDS_JSON=$(echo "$TRENDS_JSON" | jq \
        --arg n "$node" \
        --argjson cpu "$cpu_trend" \
        --argjson ram "$ram_trend" \
        --argjson disk "$disk_trend" \
        --argjson gpu_util "$gpu_util_trend" \
        --argjson gpu_mem "$gpu_mem_trend" \
        '.nodes[$n] = {
            cpu_pct: $cpu,
            ram_pct: $ram,
            disk_root_pct: $disk,
            gpu_util_pct: $gpu_util,
            gpu_mem_pct: $gpu_mem
        }')
done

# ---------------------------------------------------------------------------
# Save trends file
# ---------------------------------------------------------------------------
TRENDS_FILE="$SNAPSHOT_DIR/trends.json"
echo "$TRENDS_JSON" | jq '.' > "$TRENDS_FILE"
log "Trends saved to $TRENDS_FILE"

# ---------------------------------------------------------------------------
# Retention policy: delete snapshot directories older than 90 days
# ---------------------------------------------------------------------------
RETENTION_DAYS=90
CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y-%m-%d 2>/dev/null)

if [[ -n "$CUTOFF_DATE" ]]; then
    DELETED_COUNT=0
    for dir in "$DATA_DIR"/????-??-??; do
        [[ ! -d "$dir" ]] && continue
        dir_date=$(basename "$dir")

        # Compare date strings lexicographically (YYYY-MM-DD format sorts correctly)
        if [[ "$dir_date" < "$CUTOFF_DATE" ]]; then
            log "Deleting expired snapshot directory: $dir (older than ${RETENTION_DAYS} days)"
            rm -rf "$dir"
            DELETED_COUNT=$((DELETED_COUNT + 1))
        fi
    done

    if [[ "$DELETED_COUNT" -gt 0 ]]; then
        log "Retention cleanup: deleted $DELETED_COUNT directory(ies) older than $CUTOFF_DATE"
    else
        log "Retention cleanup: no directories older than $CUTOFF_DATE"
    fi
else
    log "WARNING: Could not compute retention cutoff date, skipping cleanup"
fi

log "Trend aggregation complete for deployment $DEPLOYMENT_ID"
