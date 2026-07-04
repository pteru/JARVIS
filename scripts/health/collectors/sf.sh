#!/bin/bash
# Health Monitor — SpotFusion collector
# Usage: sf.sh <deployment>
#
# Connects (via lib/ssh.sh) to each node in config/health/sf/<deployment>.json,
# collects a minimal set of metrics, and writes a schema:1 snapshot JSON to
# $DATA_DIR/<utc-date>/snapshot-<utc-time>.json.
#
# Per-node metrics emitted (skipped silently when the underlying command or
# service is absent so heterogeneous nodes don't crash the run):
#   node.<name>.reachable              1|0
#   node.<name>.disk.root.pct          df / on the node
#   node.<name>.ram.pct                free (used/total)
#   node.<name>.queue.messages.total   RabbitMQ management API :15672 (summed)
#
# SF nodes have no GPU. RabbitMQ is queried over HTTP from this host (the
# management port is exposed) using the "guest"-style user from the config
# (`rabbitmq_user`, default guest) and the password from HEALTH_RABBIT_SECRET.
#
# Fail-open per node — an unreachable node only emits `reachable:0`, and a
# down RabbitMQ API only omits the queue metric; never zero-filled values
# that would silently suppress alerts.
#
# Interfaces:
#   Consumes: lib/config.sh (load_health_config → HEALTH_PRODUCT, HEALTH_DEPLOYMENT,
#             DATA_DIR, CONFIG_FILE, HEALTH_SSH_SECRET, HEALTH_RABBIT_SECRET)
#             lib/ssh.sh    (ssh_cmd, is_node_reachable, node_host)
#   Writes:   $DATA_DIR/<utc-date>/snapshot-<utc-time>.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"

# shellcheck source=../lib/config.sh
source "$LIB_DIR/config.sh"
load_health_config "sf" "${1:?deployment required}"

# shellcheck source=../lib/ssh.sh
source "$LIB_DIR/ssh.sh"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] [sf-collector] $*" >&2; }

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

# Capture RAM used percent from free, or empty string.
ram_pct() {
    local node="$1"
    local out
    out=$(ssh_cmd "$node" "free 2>/dev/null | awk '/^Mem:/ {printf \"%d\", \$3*100/\$2}'" 2>/dev/null || true)
    [[ "$out" =~ ^[0-9]+$ ]] && echo "$out" || echo ""
}

# Total messages across all RabbitMQ queues via the management API, or empty.
rabbit_queue_total() {
    local node="$1"
    local host user pass raw total
    host=$(node_host "$node")
    user=$(jq -r '.rabbitmq_user // "guest"' "$CONFIG_FILE")
    pass=""
    [[ -n "${HEALTH_RABBIT_SECRET:-}" && -f "${HEALTH_RABBIT_SECRET}" ]] && pass="$(<"$HEALTH_RABBIT_SECRET")"
    raw=$(curl -sf --max-time 10 -u "${user}:${pass%$'\n'}" \
        "http://${host}:15672/api/queues" 2>/dev/null) || return 0
    total=$(jq -r '[.[]?.messages // 0] | add // empty' <<<"$raw" 2>/dev/null || true)
    [[ "$total" =~ ^[0-9]+$ ]] && echo "$total" || echo ""
}

for node in "${NODE_NAMES[@]}"; do
    if is_node_reachable "$node"; then
        log "$node reachable"
        nodes_json=$(jq --arg n "$node" '. + [{name: $n, reachable: true}]' <<<"$nodes_json")
        add_metric "node.${node}.reachable" 1

        disk_root=$(df_pct "$node" "/")
        [[ -n "$disk_root" ]] && add_metric "node.${node}.disk.root.pct" "$disk_root"

        ram=$(ram_pct "$node")
        [[ -n "$ram" ]] && add_metric "node.${node}.ram.pct" "$ram"

        queue_total=$(rabbit_queue_total "$node")
        [[ -n "$queue_total" ]] && add_metric "node.${node}.queue.messages.total" "$queue_total"
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
