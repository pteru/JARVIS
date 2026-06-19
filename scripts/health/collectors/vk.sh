#!/bin/bash
# Health Monitor — VisionKing collector
# Usage: vk.sh <deployment>
#
# Connects (via lib/ssh.sh) to each node in config/health/vk/<deployment>.json,
# collects a minimal set of metrics, and writes a schema:1 snapshot JSON to
# $DATA_DIR/<utc-date>/snapshot-<utc-time>.json.
#
# Per-node metrics emitted (skipped silently when the underlying command is
# absent so heterogeneous nodes don't crash the run):
#   node.<name>.reachable            1|0
#   node.<name>.disk.root.pct        df / on the node
#   node.<name>.disk.img_saved.pct   df ~/Downloads/img_saved (image-saver NVMe)
#   node.<name>.gpu.0.mem.pct        nvidia-smi mem used / total
#
# Fail-open per node — an unreachable node only emits `reachable:0`, never
# zero-filled metrics that would silently suppress alerts.
#
# Interfaces:
#   Consumes: lib/config.sh (load_health_config → HEALTH_PRODUCT, HEALTH_DEPLOYMENT,
#             DATA_DIR, CONFIG_FILE, HEALTH_SSH_SECRET)
#             lib/ssh.sh    (ssh_cmd, is_node_reachable)
#   Writes:   $DATA_DIR/<utc-date>/snapshot-<utc-time>.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"

# shellcheck source=../lib/config.sh
source "$LIB_DIR/config.sh"
load_health_config "vk" "${1:?deployment required}"

# shellcheck source=../lib/ssh.sh
source "$LIB_DIR/ssh.sh"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] [vk-collector] $*" >&2; }

TODAY=$(date -u +%Y-%m-%d)
SNAPSHOT_TIME=$(date -u +%H-%M-%S)
COLLECTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SNAPSHOT_DIR="$DATA_DIR/$TODAY"
mkdir -p "$SNAPSHOT_DIR"
SNAPSHOT_FILE="$SNAPSHOT_DIR/snapshot-${SNAPSHOT_TIME}.json"

mapfile -t NODE_NAMES < <(jq -r '.nodes | keys[]' "$CONFIG_FILE")
if [[ "${#NODE_NAMES[@]}" -eq 0 ]]; then
    log "ERROR: No nodes defined in config — refusing to write empty snapshot"
    exit 1
fi

log "Collecting from ${#NODE_NAMES[@]} node(s): ${NODE_NAMES[*]}"

nodes_json='[]'
metrics_json='{}'

# add_metric <key> <integer-value>
add_metric() {
    local key="$1" val="$2"
    metrics_json=$(jq --arg k "$key" --argjson v "$val" '. + {($k): $v}' <<<"$metrics_json")
}

# Capture a numeric-only df pct (e.g. "89") or empty string.
df_pct() {
    local node="$1" path="$2"
    local out
    out=$(ssh_cmd "$node" "df --output=pcent '$path' 2>/dev/null | tail -1 | tr -d ' %'" 2>/dev/null || true)
    [[ "$out" =~ ^[0-9]+$ ]] && echo "$out" || echo ""
}

# Capture gpu 0 mem percent from nvidia-smi, or empty string if absent.
gpu_mem_pct() {
    local node="$1"
    local raw
    raw=$(ssh_cmd "$node" "nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1" 2>/dev/null || true)
    # Expect "used, total" where each is integer MiB.
    if [[ "$raw" =~ ^[[:space:]]*([0-9]+)[[:space:]]*,[[:space:]]*([0-9]+)[[:space:]]*$ ]]; then
        local used="${BASH_REMATCH[1]}" total="${BASH_REMATCH[2]}"
        if [[ "$total" -gt 0 ]]; then
            echo $(( used * 100 / total ))
            return
        fi
    fi
    echo ""
}

for node in "${NODE_NAMES[@]}"; do
    if is_node_reachable "$node"; then
        log "$node reachable"
        nodes_json=$(jq --arg n "$node" '. + [{name: $n, reachable: true}]' <<<"$nodes_json")
        add_metric "node.${node}.reachable" 1

        disk_root=$(df_pct "$node" "/")
        [[ -n "$disk_root" ]] && add_metric "node.${node}.disk.root.pct" "$disk_root"

        disk_img=$(df_pct "$node" "~/Downloads/img_saved")
        [[ -n "$disk_img" ]] && add_metric "node.${node}.disk.img_saved.pct" "$disk_img"

        gpu_mem=$(gpu_mem_pct "$node")
        [[ -n "$gpu_mem" ]] && add_metric "node.${node}.gpu.0.mem.pct" "$gpu_mem"
    else
        log "$node unreachable"
        nodes_json=$(jq --arg n "$node" '. + [{name: $n, reachable: false}]' <<<"$nodes_json")
        add_metric "node.${node}.reachable" 0
    fi
done

jq -n \
    --arg product "$HEALTH_PRODUCT" \
    --arg deployment "$HEALTH_DEPLOYMENT" \
    --arg collected_at "$COLLECTED_AT" \
    --argjson nodes "$nodes_json" \
    --argjson metrics "$metrics_json" '{
        schema: 1,
        product: $product,
        deployment: $deployment,
        collected_at: $collected_at,
        nodes: $nodes,
        metrics: $metrics
    }' > "$SNAPSHOT_FILE"

if jq -e . "$SNAPSHOT_FILE" >/dev/null 2>&1; then
    log "Snapshot written: $SNAPSHOT_FILE"
    echo "$SNAPSHOT_FILE"
else
    log "ERROR: Generated snapshot is invalid JSON: $SNAPSHOT_FILE"
    exit 1
fi
