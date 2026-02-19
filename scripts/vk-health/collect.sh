#!/usr/bin/env bash
# =============================================================================
# collect.sh — VisionKing Production Health Data Collector
#
# Connects to all deployment nodes in parallel (via SSH port 8050) and collects:
#   1. Prometheus metrics (CPU, RAM, disk, GPU, containers)
#   2. Service data (Docker, Redis, PostgreSQL, image-saver health)
#   3. Direct HTTP GUI health checks (VPN-accessible ports)
#   3b. RabbitMQ API queue data (VPN-accessible on :8002)
#
# Outputs a single JSON snapshot file.
#
# Usage:
#   collect.sh [deployment-id]    (default: 03002)
#
# Required env vars:
#   VK_SSH_PASSWORD     — SSH password for all nodes (used by sshpass)
#   VK_RABBIT_PASSWORD  — RabbitMQ management API password
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
source "$SCRIPT_DIR/lib/config.sh" "${1:-03002}"

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
if [[ -z "${VK_SSH_PASSWORD:-}" ]]; then
    log "ERROR: VK_SSH_PASSWORD env var is required"
    exit 1
fi
if [[ -z "${VK_RABBIT_PASSWORD:-}" ]]; then
    log "ERROR: VK_RABBIT_PASSWORD env var is required"
    exit 1
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

# Temp directory for per-node data
TMPDIR_COLLECT=$(mktemp -d "/tmp/vk-health-collect.XXXXXX")
trap 'rm -rf "$TMPDIR_COLLECT"' EXIT

log "Starting collection for deployment $DEPLOYMENT_ID"
log "Nodes: ${NODE_NAMES[*]}"

# ---------------------------------------------------------------------------
# Helper: Query Prometheus and extract scalar value
# ---------------------------------------------------------------------------
prom_query() {
    local node="$1" query="$2" default="${3:-null}"
    local encoded_query result

    # URL-encode the query (pipe through stdin to avoid shell quoting issues)
    encoded_query=$(printf '%s' "$query" | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))" 2>/dev/null || echo "$query")

    result=$(ssh_cmd "$node" \
        "NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 curl -sf --max-time 5 'localhost:8110/api/v1/query?query=${encoded_query}'" 2>/dev/null) || {
        echo "$default"
        return 0
    }

    # Extract value: .data.result[0].value[1]
    echo "$result" | jq -r '.data.result[0].value[1] // empty' 2>/dev/null || echo "$default"
}

# Helper: Query Prometheus for vector results (multiple series — containers)
prom_query_vector() {
    local node="$1" query="$2"
    local encoded_query result

    # URL-encode the query (pipe through stdin to avoid shell quoting issues)
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
    local node_host has_gpu role
    local node_tmp="$TMPDIR_COLLECT/${node}.json"

    # Use set +e so individual failures don't kill the node collection
    set +e

    node_host=$(jq -r ".nodes.${node}.host" "$CONFIG_FILE")
    has_gpu=$(jq -r ".nodes.${node}.has_gpu" "$CONFIG_FILE")
    role=$(jq -r ".nodes.${node}.role" "$CONFIG_FILE")

    log "[$node] Collecting from ${node_host} (role=$role, gpu=$has_gpu)"

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

    # GPU metrics (vk01/vk02 only)
    local gpu_util gpu_mem gpu_temp
    if [[ "$has_gpu" == "true" ]]; then
        log "[$node] Querying GPU metrics..."
        gpu_util=$(prom_query "$node" \
            'DCGM_FI_DEV_GPU_UTIL')
        gpu_mem=$(prom_query "$node" \
            'DCGM_FI_DEV_FB_USED / (DCGM_FI_DEV_FB_USED + DCGM_FI_DEV_FB_FREE) * 100')
        gpu_temp=$(prom_query "$node" \
            'DCGM_FI_DEV_GPU_TEMP')
    else
        gpu_util="null"
        gpu_mem="null"
        gpu_temp="null"
    fi

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

    # Query img_saved disk usage via SSH (separate NVMe, not in Prometheus)
    local disk_img_pct="null"
    if [[ "$role" == "processing" ]]; then
        disk_img_pct=$(ssh_cmd "$node" "df --output=pcent ~/Downloads/img_saved 2>/dev/null | tail -1 | tr -d ' %'" 2>/dev/null || echo "null")
        [[ -z "$disk_img_pct" ]] && disk_img_pct="null"
    fi

    # Assemble prometheus JSON
    local prom_json
    prom_json=$(jq -n \
        --arg cpu "$cpu_pct" \
        --arg ram "$ram_pct" \
        --arg disk "$disk_pct" \
        --arg disk_img "$disk_img_pct" \
        --arg gpu_u "$gpu_util" \
        --arg gpu_m "$gpu_mem" \
        --arg gpu_t "$gpu_temp" \
        --arg uptime "$uptime_s" \
        --argjson containers "$containers_prom" '
        {
            cpu_pct: (if $cpu != "null" and $cpu != "" then ($cpu | tonumber) else null end),
            ram_pct: (if $ram != "null" and $ram != "" then ($ram | tonumber) else null end),
            disk_root_pct: (if $disk != "null" and $disk != "" then ($disk | tonumber) else null end),
            disk_img_saved_pct: (if $disk_img != "null" and $disk_img != "" then ($disk_img | tonumber) else null end),
            gpu_util_pct: (if $gpu_u != "null" and $gpu_u != "" then ($gpu_u | tonumber) else null end),
            gpu_mem_pct: (if $gpu_m != "null" and $gpu_m != "" then ($gpu_m | tonumber) else null end),
            gpu_temp_c: (if $gpu_t != "null" and $gpu_t != "" then ($gpu_t | tonumber) else null end),
            uptime_seconds: (if $uptime != "null" and $uptime != "" then ($uptime | tonumber) else null end),
            containers: $containers
        }
    ')

    # -----------------------------------------------------------------
    # Step 2: Service data via single SSH session
    # -----------------------------------------------------------------
    log "[$node] Collecting service data via SSH..."

    local service_json
    if [[ "$role" == "processing" ]]; then
        # Processing node: docker + redis + postgresql + image-saver health
        # SCP the assembler script, then run data collection + assembly
        local remote_tmp
        remote_tmp=$(ssh_cmd "$node" "mktemp -d")
        scp_to "$node" "$SCRIPT_DIR/lib/assemble_processing.py" "$remote_tmp/assemble.py"
        local collect_script="export TMPD=${remote_tmp};"
        collect_script+="docker ps --format '{{json .}}' > \$TMPD/docker_ps.jsonl 2>/dev/null || true;"
        collect_script+="for cname in \$(docker ps --format '{{.Names}}' 2>/dev/null); do docker logs --since 15m \$cname 2>&1 | grep -iE 'error|exception|traceback|warning|fatal|oom' | tail -50 > \$TMPD/err_\${cname}.log 2>/dev/null || true; done;"
        collect_script+="redis-cli -p 4000 -n 0 DBSIZE 2>/dev/null | awk '{print \$2}' > \$TMPD/redis_db0.txt || echo 0 > \$TMPD/redis_db0.txt;"
        collect_script+="redis-cli -p 4000 -n 1 KEYS '*' 2>/dev/null > \$TMPD/redis_db1_keys.txt || true;"
        collect_script+="for key in \$(cat \$TMPD/redis_db1_keys.txt 2>/dev/null); do [ -z \$key ] && continue; redis-cli -p 4000 -n 1 HGETALL \$key 2>/dev/null > \$TMPD/redis_db1_\${key}.txt || true; done;"
        collect_script+="redis-cli -p 4000 -n 2 DBSIZE 2>/dev/null | awk '{print \$2}' > \$TMPD/redis_db2.txt || echo 0 > \$TMPD/redis_db2.txt;"
        collect_script+="redis-cli -p 4000 -n 3 KEYS '*' 2>/dev/null > \$TMPD/redis_db3_keys.txt || true;"
        collect_script+="docker exec -i database-server psql -U strokmatic -d visionking -t -A -c \"SELECT count(*) FROM pg_stat_activity WHERE state='active'\" > \$TMPD/pg_active.txt 2>/dev/null || echo 0 > \$TMPD/pg_active.txt;"
        collect_script+="docker exec -i database-server psql -U strokmatic -d visionking -t -A -c \"SELECT pg_database_size('visionking')\" > \$TMPD/pg_dbsize.txt 2>/dev/null || echo 0 > \$TMPD/pg_dbsize.txt;"
        collect_script+="NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 curl -sf --max-time 5 localhost:5000/health > \$TMPD/img_health.json 2>/dev/null || echo '{\"status\":\"unreachable\"}' > \$TMPD/img_health.json;"
        collect_script+="python3 \$TMPD/assemble.py; rm -rf \$TMPD"
        service_json=$(ssh_cmd "$node" "$collect_script") || service_json='{"docker":{"containers":[],"error_logs":{}},"redis":{"db0_cache":{"keys":0},"db1_plc":{"keys":[],"values":{}},"db2_camera":{"keys":0},"db3_settings":{"keys":[]}},"postgresql":{"active_connections":0,"db_size_bytes":0},"health_endpoints":{"image_saver":{"status":"ssh_error"}}}'

    else
        # Dashboard node: SCP assembler, collect data, assemble
        local remote_tmp
        remote_tmp=$(ssh_cmd "$node" "mktemp -d")
        scp_to "$node" "$SCRIPT_DIR/lib/assemble_dashboard.py" "$remote_tmp/assemble.py"
        local collect_script="export TMPD=${remote_tmp};"
        collect_script+="docker ps --format '{{json .}}' > \$TMPD/docker_ps.jsonl 2>/dev/null || true;"
        collect_script+="for cname in \$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE 'backend|frontend|postgres'); do docker logs --since 15m \$cname 2>&1 | grep -iE 'error|exception|traceback|warning|fatal|oom' | tail -50 > \$TMPD/err_\${cname}.log 2>/dev/null || true; done;"
        collect_script+="docker exec -i database-server psql -U strokmatic -d visionking -t -A -c \"SELECT count(*) FROM pg_stat_activity WHERE state='active'\" > \$TMPD/pg_active.txt 2>/dev/null || echo 0 > \$TMPD/pg_active.txt;"
        collect_script+="docker exec -i database-server psql -U strokmatic -d visionking -t -A -c \"SELECT pg_database_size('visionking')\" > \$TMPD/pg_dbsize.txt 2>/dev/null || echo 0 > \$TMPD/pg_dbsize.txt;"
        collect_script+="python3 \$TMPD/assemble.py; rm -rf \$TMPD"
        service_json=$(ssh_cmd "$node" "$collect_script") || service_json='{"docker":{"containers":[],"error_logs":{}},"postgresql":{"active_connections":0,"db_size_bytes":0}}'
    fi

    # Validate service_json is valid JSON; fallback to empty object
    if [[ -z "$service_json" ]] || ! echo "$service_json" | jq '.' &>/dev/null; then
        log "[$node] WARNING: Service data JSON is invalid, using empty fallback"
        if [[ "$role" == "processing" ]]; then
            service_json='{"docker":{"containers":[],"error_logs":{}},"redis":{"db0_cache":{"keys":0},"db1_plc":{"keys":[],"values":{}},"db2_camera":{"keys":0},"db3_settings":{"keys":[]}},"postgresql":{"active_connections":0,"db_size_bytes":0},"health_endpoints":{"image_saver":{"status":"parse_error"}}}'
        else
            service_json='{"docker":{"containers":[],"error_logs":{}},"postgresql":{"active_connections":0,"db_size_bytes":0}}'
        fi
    fi

    # -----------------------------------------------------------------
    # Step 3b: RabbitMQ API (VPN-accessible on :8002, processing nodes only)
    # -----------------------------------------------------------------
    local rabbitmq_json='{"queues":[]}'
    if [[ "$role" == "processing" ]]; then
        log "[$node] Querying RabbitMQ API..."
        local rabbit_raw
        rabbit_raw=$(curl -sf --max-time 10 \
            -u "strokmatic:${VK_RABBIT_PASSWORD}" \
            "http://${node_host}:8002/api/queues" 2>/dev/null) || rabbit_raw='[]'

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
    fi

    # -----------------------------------------------------------------
    # Assemble full node JSON
    # -----------------------------------------------------------------
    log "[$node] Assembling node data..."
    jq -n \
        --argjson prometheus "$prom_json" \
        --argjson services "$service_json" \
        --argjson rabbitmq "$rabbitmq_json" \
        '{
            reachable: true,
            prometheus: $prometheus
        } + $services + {
            rabbitmq: $rabbitmq
        }
    ' > "$node_tmp"

    log "[$node] Collection complete"
}

# ===========================================================================
# Step 3: GUI health checks (direct HTTP from JARVIS — no SSH needed)
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
            local curl_extra=""

            # Portainer uses HTTPS on 443
            if [[ "$port" == "443" ]]; then
                proto="https"
                curl_extra="-k"
            fi

            local url="${proto}://${node_host}:${port}"
            local key="${node}_port_${port}"

            # Map port numbers to service names
            case "$port" in
                80)   key="${node}_frontend" ;;
                443)  key="${node}_portainer" ;;
                8001) key="${node}_redis_insight" ;;
                8002) key="${node}_rabbitmq_ui" ;;
                8003) key="${node}_pgadmin" ;;
                8100) key="${node}_grafana" ;;
                8501) key="${node}_visualizer" ;;
                *)    key="${node}_port_${port}" ;;
            esac

            local status
            status=$(curl -sk $curl_extra -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")

            gui_json=$(echo "$gui_json" | jq --arg k "$key" --arg v "$status" '. + {($k): ($v | tonumber)}')
        done <<< "$checks"
    done

    echo "$gui_json" > "$gui_tmp"
    log "GUI health checks complete"
}

# ===========================================================================
# Main: Collect from all nodes in parallel
# ===========================================================================

# Launch per-node collection in parallel background subshells
for node in "${NODE_NAMES[@]}"; do
    collect_node "$node" &
done

# Launch GUI checks in parallel too (they don't need SSH)
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

# Build the nodes object using a Python script to avoid jq ARG_MAX limits
# Each node's data is already in $TMPDIR_COLLECT/${node}.json
NODES_FILE="$TMPDIR_COLLECT/_nodes.json"
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
