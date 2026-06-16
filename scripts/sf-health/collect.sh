#!/usr/bin/env bash
# =============================================================================
# collect.sh — SpotFusion Production Health Data Collector
#
# Connects to the SF server via SSH and collects:
#   1. Prometheus metrics (CPU, RAM, disk, containers)
#   2. Service data (Docker, Redis 3 instances, PostgreSQL)
#   3. Direct HTTP GUI health checks (LAN-accessible ports)
#   4. RabbitMQ API queue data (LAN-accessible on :15672)
#
# Single-server architecture (no parallel node collection needed).
#
# Usage:
#   collect.sh [deployment-id]    (default: 02006)
#
# Required env vars:
#   SF_SSH_PASSWORD     — SSH password for the SF server (used by sshpass)
#   SF_RABBIT_PASSWORD  — RabbitMQ management API password
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="1.0.0"
COLLECTION_START=$(date +%s)

# ---------------------------------------------------------------------------
# Source shared libraries
# ---------------------------------------------------------------------------
# shellcheck source=lib/config.sh
source "$SCRIPT_DIR/lib/config.sh" "${1:-02006}"

# shellcheck source=lib/ssh.sh
source "$SCRIPT_DIR/lib/ssh.sh"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

# ---------------------------------------------------------------------------
# Validate prerequisites
# ---------------------------------------------------------------------------
if [[ -z "${SF_SSH_PASSWORD:-}" ]]; then
    log "ERROR: SF_SSH_PASSWORD env var is required"
    exit 1
fi
if [[ -z "${SF_RABBIT_PASSWORD:-}" ]]; then
    log "WARNING: SF_RABBIT_PASSWORD not set, RabbitMQ collection will use guest credentials"
    SF_RABBIT_PASSWORD="guest"
fi
if ! command -v sshpass &>/dev/null; then
    log "ERROR: sshpass not installed. Run: sudo apt install sshpass"
    exit 1
fi
if ! command -v jq &>/dev/null; then
    log "ERROR: jq not installed. Run: sudo apt install jq"
    exit 1
fi

# ---------------------------------------------------------------------------
# Output paths
# ---------------------------------------------------------------------------
TODAY=$(date -u '+%Y-%m-%d')
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
SNAPSHOT_TIME=$(date -u '+%H-%M-%S')
SNAPSHOT_DIR="$DATA_DIR/$TODAY"
SNAPSHOT_FILE="$SNAPSHOT_DIR/snapshot-${SNAPSHOT_TIME}.json"
mkdir -p "$SNAPSHOT_DIR"

# Temp directory for collection data
TMPDIR_COLLECT=$(mktemp -d "/tmp/sf-health-collect.XXXXXX")
trap 'rm -rf "$TMPDIR_COLLECT"' EXIT

log "Starting collection for deployment $DEPLOYMENT_ID"
log "Nodes: ${NODE_NAMES[*]}"

# ---------------------------------------------------------------------------
# Helper: Query Prometheus and extract scalar value
# ---------------------------------------------------------------------------
prom_query() {
    local node="$1" query="$2" default="${3:-null}"
    local encoded_query result

    encoded_query=$(printf '%s' "$query" | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))" 2>/dev/null || echo "$query")

    result=$(ssh_cmd "$node" \
        "NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 curl -sf --max-time 5 'localhost:8110/api/v1/query?query=${encoded_query}'" 2>/dev/null) || {
        echo "$default"
        return 0
    }

    echo "$result" | jq -r '.data.result[0].value[1] // empty' 2>/dev/null || echo "$default"
}

# Helper: Query Prometheus for vector results (multiple series — containers)
prom_query_vector() {
    local node="$1" query="$2"
    local encoded_query result

    encoded_query=$(printf '%s' "$query" | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))" 2>/dev/null || echo "$query")

    result=$(ssh_cmd "$node" \
        "NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 curl -sf --max-time 5 'localhost:8110/api/v1/query?query=${encoded_query}'" 2>/dev/null) || {
        echo "[]"
        return 0
    }

    echo "$result" | jq '.data.result // []' 2>/dev/null || echo "[]"
}

# ---------------------------------------------------------------------------
# Helper: Check HTTP endpoint status code
# ---------------------------------------------------------------------------
http_status() {
    local url="$1"
    local code
    code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null) || code="000"
    echo "$code"
}

# ===========================================================================
# Per-node collection function
# ===========================================================================
collect_node() {
    local node="$1"
    local node_host role
    local node_tmp="$TMPDIR_COLLECT/${node}.json"

    # Use set +e so individual failures don't kill the node collection
    set +e

    node_host=$(jq -r ".nodes.${node}.host" "$CONFIG_FILE")
    role=$(jq -r ".nodes.${node}.role" "$CONFIG_FILE")

    log "[$node] Collecting from ${node_host} (role=$role)"

    # -----------------------------------------------------------------
    # Connectivity check
    # -----------------------------------------------------------------
    if ! ssh_cmd "$node" "echo ok" &>/dev/null; then
        log "[$node] UNREACHABLE via SSH"
        jq -n '{reachable: false}' > "$node_tmp"
        return 0
    fi

    log "[$node] SSH connected"

    # -----------------------------------------------------------------
    # Step 1: Prometheus Metrics
    # -----------------------------------------------------------------
    log "[$node] Querying Prometheus metrics..."

    local cpu_pct ram_pct disk_pct uptime_s
    cpu_pct=$(prom_query "$node" \
        '100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)')
    ram_pct=$(prom_query "$node" \
        '(1 - node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes) * 100')
    disk_pct=$(prom_query "$node" \
        '(1 - node_filesystem_avail_bytes{mountpoint="/"}/node_filesystem_size_bytes{mountpoint="/"}) * 100')
    uptime_s=$(prom_query "$node" \
        'node_time_seconds - node_boot_time_seconds')

    # Container metrics (vector queries — multiple series)
    log "[$node] Querying container metrics..."
    local container_cpu_json container_mem_json
    container_cpu_json=$(prom_query_vector "$node" \
        'rate(container_cpu_usage_seconds_total{name!=""}[5m])')
    container_mem_json=$(prom_query_vector "$node" \
        'container_memory_usage_bytes{name!=""}')

    # Build container metrics object: { "name": {"cpu_rate": x, "mem_bytes": y} }
    local containers_prom
    containers_prom=$(jq -n \
        --argjson cpu "$container_cpu_json" \
        --argjson mem "$container_mem_json" '
        (reduce ($cpu[]?) as $item ({}; .[$item.metric.name] += {"cpu_rate": ($item.value[1] | tonumber? // 0)})) as $cpu_map |
        (reduce ($mem[]?) as $item ({}; .[$item.metric.name] += {"mem_bytes": ($item.value[1] | tonumber? // 0)})) as $mem_map |
        ($cpu_map | keys) + ($mem_map | keys) | unique | reduce .[] as $name ({};
            .[$name] = {
                cpu_rate: ($cpu_map[$name].cpu_rate // 0),
                mem_bytes: ($mem_map[$name].mem_bytes // 0)
            }
        )
    ' 2>/dev/null || echo '{}')

    # Ensure containers_prom is valid JSON
    if [[ -z "$containers_prom" ]] || ! echo "$containers_prom" | jq '.' &>/dev/null; then
        containers_prom='{}'
    fi

    # Assemble prometheus JSON (no GPU metrics for SpotFusion)
    local prom_json
    prom_json=$(jq -n \
        --arg cpu "$cpu_pct" \
        --arg ram "$ram_pct" \
        --arg disk "$disk_pct" \
        --arg uptime "$uptime_s" \
        --argjson containers "$containers_prom" '
        {
            cpu_pct: (if $cpu != "null" and $cpu != "" then ($cpu | tonumber) else null end),
            ram_pct: (if $ram != "null" and $ram != "" then ($ram | tonumber) else null end),
            disk_root_pct: (if $disk != "null" and $disk != "" then ($disk | tonumber) else null end),
            uptime_seconds: (if $uptime != "null" and $uptime != "" then ($uptime | tonumber) else null end),
            containers: $containers
        }
    ')

    # -----------------------------------------------------------------
    # Step 2: Service data via single SSH session
    # -----------------------------------------------------------------
    log "[$node] Collecting service data via SSH..."

    local service_json
    # SCP the assembler script, then run data collection + assembly
    local remote_tmp
    remote_tmp=$(ssh_cmd "$node" "mktemp -d")
    scp_to "$node" "$SCRIPT_DIR/lib/assemble_server.py" "$remote_tmp/assemble.py"

    local collect_script="export TMPD=${remote_tmp};"

    # Docker info
    collect_script+="docker ps --format '{{json .}}' > \$TMPD/docker_ps.jsonl 2>/dev/null || true;"
    # collect_script+="for cname in \$(docker ps --format '{{.Names}}' 2>/dev/null); do docker logs --since 15m \$cname 2>&1 | grep -iE 'error|exception|traceback|warning|fatal|oom' | tail -50 > \$TMPD/err_\${cname}.log 2>/dev/null || true; done;"
    collect_script+="for cname in \$(docker ps --format '{{.Names}}' 2>/dev/null); do docker logs \$cname 2>&1 | tail -5000 > \$TMPD/err_\${cname}.log 2>/dev/null || true; done;"

    # Redis — 3 separate containers (each uses DB0 only)
    collect_script+="docker exec sparkeyes-plc-cache redis-cli DBSIZE 2>/dev/null | awk '{print \$2}' > \$TMPD/redis_plc_cache_dbsize.txt || echo 0 > \$TMPD/redis_plc_cache_dbsize.txt;"
    collect_script+="docker exec sparkeyes-plc-cache redis-cli KEYS '*' 2>/dev/null > \$TMPD/redis_plc_cache_keys.txt || true;"
    collect_script+="for key in \$(cat \$TMPD/redis_plc_cache_keys.txt 2>/dev/null | head -30); do [ -z \"\$key\" ] && continue; docker exec sparkeyes-plc-cache redis-cli HGETALL \"\$key\" 2>/dev/null > \$TMPD/redis_plc_cache_\${key}.txt || true; done;"

    collect_script+="docker exec sparkeyes-global-cache redis-cli DBSIZE 2>/dev/null | awk '{print \$2}' > \$TMPD/redis_global_cache_dbsize.txt || echo 0 > \$TMPD/redis_global_cache_dbsize.txt;"
    collect_script+="docker exec sparkeyes-global-cache redis-cli KEYS '*' 2>/dev/null > \$TMPD/redis_global_cache_keys.txt || true;"

    collect_script+="docker exec sparkeyes-server-log redis-cli DBSIZE 2>/dev/null | awk '{print \$2}' > \$TMPD/redis_server_log_dbsize.txt || echo 0 > \$TMPD/redis_server_log_dbsize.txt;"

    # PostgreSQL
    collect_script+="docker exec -i pg-server psql -U strokmatic -d sparkeyes -t -A -c \"SELECT count(*) FROM pg_stat_activity WHERE state='active'\" > \$TMPD/pg_active.txt 2>/dev/null || echo 0 > \$TMPD/pg_active.txt;"
    collect_script+="docker exec -i pg-server psql -U strokmatic -d sparkeyes -t -A -c \"SELECT pg_database_size('sparkeyes')\" > \$TMPD/pg_dbsize.txt 2>/dev/null || echo 0 > \$TMPD/pg_dbsize.txt;"

    collect_script+="python3 \$TMPD/assemble.py; rm -rf \$TMPD"

    service_json=$(ssh_cmd "$node" "$collect_script") || service_json='{"docker":{"containers":[],"error_logs":{}},"redis":{"plc_cache":{"container":"sparkeyes-plc-cache","keys":0,"key_list":[],"values":{}},"global_cache":{"container":"sparkeyes-global-cache","keys":0,"key_list":[]},"server_log":{"container":"sparkeyes-server-log","keys":0}},"postgresql":{"active_connections":0,"db_size_bytes":0}}'

    # Validate service_json is valid JSON; fallback to empty object
    if [[ -z "$service_json" ]] || ! echo "$service_json" | jq '.' &>/dev/null; then
        log "[$node] WARNING: Service data JSON is invalid, using empty fallback"
        service_json='{"docker":{"containers":[],"error_logs":{}},"redis":{"plc_cache":{"container":"sparkeyes-plc-cache","keys":0,"key_list":[],"values":{}},"global_cache":{"container":"sparkeyes-global-cache","keys":0,"key_list":[]},"server_log":{"container":"sparkeyes-server-log","keys":0}},"postgresql":{"active_connections":0,"db_size_bytes":0}}'
    fi

    # -----------------------------------------------------------------
    # Step 3: RabbitMQ API (LAN-accessible on :15672)
    # -----------------------------------------------------------------
    local rabbitmq_json='{"queues":[]}'
    log "[$node] Querying RabbitMQ API..."
    local rabbit_user
    rabbit_user=$(jq -r '.rabbitmq_user // "guest"' "$CONFIG_FILE")
    local rabbit_raw
    rabbit_raw=$(curl -sf --max-time 10 \
        -u "${rabbit_user}:${SF_RABBIT_PASSWORD}" \
        "http://${node_host}:15672/api/queues" 2>/dev/null) || rabbit_raw='[]'

    rabbitmq_json=$(echo "$rabbit_raw" | jq '{
        queues: [.[]? | {
            name: .name,
            messages: (.messages // 0),
            consumers: (.consumers // 0),
            messages_ready: (.messages_ready // 0),
            messages_unacked: (.messages_unacknowledged // 0),
            publish_rate: (.message_stats.publish_details.rate // 0),
            deliver_rate: (.message_stats.deliver_get_details.rate // 0),
            state: (.state // "unknown")
        }]
    }' 2>/dev/null || echo '{"queues":[]}')

    # -----------------------------------------------------------------
    # Assemble full node JSON (write to files to avoid ARG_MAX limits)
    # -----------------------------------------------------------------
    log "[$node] Assembling node data..."
    local svc_file="$TMPDIR_COLLECT/${node}_services.json"
    local rmq_file="$TMPDIR_COLLECT/${node}_rabbitmq.json"
    echo "$service_json" > "$svc_file"
    echo "$rabbitmq_json" > "$rmq_file"

    jq -n \
        --argjson prometheus "$prom_json" \
        --slurpfile services "$svc_file" \
        --slurpfile rabbitmq "$rmq_file" \
        '{
            reachable: true,
            prometheus: $prometheus
        } + $services[0] + {
            rabbitmq: $rabbitmq[0]
        }
    ' > "$node_tmp"

    log "[$node] Collection complete"
}

# ===========================================================================
# GUI health checks (direct HTTP from JARVIS — no SSH needed)
# ===========================================================================
collect_gui_status() {
    log "Collecting GUI endpoint health checks..."
    local gui_tmp="$TMPDIR_COLLECT/gui_status.json"
    local gui_json='{}'

    for node in "${NODE_NAMES[@]}"; do
        local node_host
        node_host=$(jq -r ".nodes.${node}.host" "$CONFIG_FILE")

        local checks
        checks=$(jq -r ".gui_checks.${node}[]" "$CONFIG_FILE" 2>/dev/null)

        while IFS= read -r port_spec; do
            [[ -z "$port_spec" ]] && continue
            local port="${port_spec#:}"
            local proto="http"

            # HTTPS for 443, 9443
            if [[ "$port" == "443" || "$port" == "9443" ]]; then
                proto="https"
            fi

            local url="${proto}://${node_host}:${port}"
            local key="${node}_port_${port}"

            # Map port numbers to service names
            case "$port" in
                80)    key="${node}_frontend" ;;
                443)   key="${node}_frontend_https" ;;
                5000)  key="${node}_backend" ;;
                8000)  key="${node}_redis_insight" ;;
                8080)  key="${node}_portainer" ;;
                8100)  key="${node}_grafana" ;;
                15672) key="${node}_rabbitmq_ui" ;;
                5050)  key="${node}_pgadmin" ;;
                *)     key="${node}_port_${port}" ;;
            esac

            local status
            status=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")

            gui_json=$(echo "$gui_json" | jq --arg k "$key" --arg v "$status" '. + {($k): ($v | tonumber)}')
        done <<< "$checks"
    done

    echo "$gui_json" > "$gui_tmp"
    log "GUI health checks complete"
}

# ===========================================================================
# Main: Collect from all nodes (single server, no parallelism needed)
# ===========================================================================

# Launch node collection
for node in "${NODE_NAMES[@]}"; do
    collect_node "$node" &
done

# Launch GUI checks in parallel (they don't need SSH)
collect_gui_status &

# Wait for all background jobs
log "Waiting for all collection jobs to complete..."
wait
log "All collection jobs finished"

# ===========================================================================
# Merge all per-node JSON files + GUI status into final snapshot
# ===========================================================================
log "Merging node data into final snapshot..."

COLLECTION_END=$(date +%s)
COLLECTION_DURATION=$((COLLECTION_END - COLLECTION_START))

GUI_FILE="$TMPDIR_COLLECT/gui_status.json"

# Ensure GUI file exists
[[ -f "$GUI_FILE" ]] || echo '{}' > "$GUI_FILE"

# Ensure each node has a JSON file (mark unreachable if missing)
for node in "${NODE_NAMES[@]}"; do
    node_tmp="$TMPDIR_COLLECT/${node}.json"
    if [[ ! -f "$node_tmp" ]]; then
        log "WARNING: No data file for $node"
        echo '{"reachable": false}' > "$node_tmp"
    fi
done

# Assemble final snapshot using python3 (reads from files, no ARG_MAX issue)
python3 -c "
import json, sys, os

tmpd = sys.argv[1]
nodes = sys.argv[2].split(',')
out_path = sys.argv[3]

result = {
    'meta': {
        'deployment_id': sys.argv[4],
        'timestamp': sys.argv[5],
        'collection_duration_seconds': int(sys.argv[6]),
        'version': sys.argv[7]
    },
    'nodes': {},
    'gui_status': {}
}

for node in nodes:
    fp = os.path.join(tmpd, node + '.json')
    try:
        with open(fp) as f:
            result['nodes'][node] = json.load(f)
    except:
        result['nodes'][node] = {'reachable': False}

gui_fp = os.path.join(tmpd, 'gui_status.json')
try:
    with open(gui_fp) as f:
        result['gui_status'] = json.load(f)
except:
    result['gui_status'] = {}

with open(out_path, 'w') as f:
    json.dump(result, f, indent=2)
" "$TMPDIR_COLLECT" "$(IFS=,; echo "${NODE_NAMES[*]}")" "$SNAPSHOT_FILE" \
  "$DEPLOYMENT_ID" "$TIMESTAMP" "$COLLECTION_DURATION" "$VERSION"

# Validate output
if jq '.' "$SNAPSHOT_FILE" &>/dev/null; then
    log "Snapshot saved: $SNAPSHOT_FILE"
    log "Collection completed in ${COLLECTION_DURATION}s"
    echo "$SNAPSHOT_FILE"
else
    log "ERROR: Generated snapshot is invalid JSON!"
    exit 1
fi
