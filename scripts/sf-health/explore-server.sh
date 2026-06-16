#!/bin/bash
# =============================================================================
# SF Health Monitor — Server Exploration Script
#
# Collects comprehensive system, Docker, Redis, RabbitMQ, PostgreSQL,
# Prometheus, and network information from the SpotFusion production server.
#
# This script runs from a machine on the same LAN (192.168.100.x or 192.168.0.x)
# and executes commands on the SF server via SSH.
#
# Usage: explore-server.sh
# Output: sf-exploration-<timestamp>.txt
#
# Required: sshpass (apt install sshpass)
# =============================================================================

set -euo pipefail

SF_HOST="192.168.100.1"
SF_USER="spotfusion"
SF_PORT=22
SF_PASS="<skm-password>"

OUTPUT_FILE="sf-exploration-$(date +%Y%m%d-%H%M%S).txt"

# ---------------------------------------------------------------------------
# Validate dependencies
# ---------------------------------------------------------------------------
if ! command -v sshpass &>/dev/null; then
    echo "ERROR: sshpass not installed. Run: sudo apt install sshpass"
    exit 1
fi

export SSHPASS="$SF_PASS"
SSH_OPTS=(-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR)

ssh_cmd() {
    sshpass -e ssh "${SSH_OPTS[@]}" -p "$SF_PORT" "${SF_USER}@${SF_HOST}" "$@" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Connectivity check
# ---------------------------------------------------------------------------
echo "Testing SSH connectivity to ${SF_USER}@${SF_HOST}:${SF_PORT}..."
if ! ssh_cmd "echo ok" &>/dev/null; then
    echo "ERROR: Cannot connect to ${SF_HOST} via SSH"
    exit 1
fi
echo "Connected successfully. Collecting data..."

# ---------------------------------------------------------------------------
# Collect data with delimited sections
# ---------------------------------------------------------------------------
{
    echo "================================================================"
    echo "SF SERVER EXPLORATION — $(date -Iseconds)"
    echo "Host: ${SF_HOST} | User: ${SF_USER} | Port: ${SF_PORT}"
    echo "================================================================"

    # === SECTION 1: System Info ===
    echo ""
    echo "=== SECTION 1: SYSTEM INFO ==="
    echo "--- uname -a ---"
    ssh_cmd "uname -a" || echo "(failed)"

    echo ""
    echo "--- hostname ---"
    ssh_cmd "hostname" || echo "(failed)"

    echo ""
    echo "--- nproc ---"
    ssh_cmd "nproc" || echo "(failed)"

    echo ""
    echo "--- free -h ---"
    ssh_cmd "free -h" || echo "(failed)"

    echo ""
    echo "--- df -h ---"
    ssh_cmd "df -h" || echo "(failed)"

    echo ""
    echo "--- ip -4 addr ---"
    ssh_cmd "ip -4 addr" || echo "(failed)"

    echo ""
    echo "--- /etc/os-release ---"
    ssh_cmd "cat /etc/os-release" || echo "(failed)"

    # === SECTION 2: Docker ===
    echo ""
    echo "=== SECTION 2: DOCKER ==="
    echo "--- docker ps -a (full) ---"
    ssh_cmd "docker ps -a --format 'table {{.ID}}\t{{.Image}}\t{{.Command}}\t{{.CreatedAt}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}'" || echo "(failed)"

    echo ""
    echo "--- docker ps -a (json) ---"
    ssh_cmd "docker ps -a --format '{{json .}}'" || echo "(failed)"

    echo ""
    echo "--- docker stats --no-stream ---"
    ssh_cmd "docker stats --no-stream" || echo "(failed)"

    echo ""
    echo "--- docker compose ls ---"
    ssh_cmd "docker compose ls 2>/dev/null || docker-compose ls 2>/dev/null" || echo "(failed)"

    # === SECTION 3: Redis (3 instances) ===
    echo ""
    echo "=== SECTION 3: REDIS ==="

    for container in sparkeyes-plc-cache sparkeyes-global-cache sparkeyes-server-log; do
        echo ""
        echo "--- Redis: ${container} ---"
        echo "-- INFO keyspace --"
        ssh_cmd "docker exec ${container} redis-cli INFO keyspace" || echo "(failed)"

        echo ""
        echo "-- DBSIZE --"
        ssh_cmd "docker exec ${container} redis-cli DBSIZE" || echo "(failed)"

        echo ""
        echo "-- KEYS (first 50) --"
        ssh_cmd "docker exec ${container} redis-cli KEYS '*' | head -50" || echo "(failed)"
    done

    # PLC cache — deep inspection of key schemas
    echo ""
    echo "--- Redis PLC Cache: Key schemas (HGETALL on each key) ---"
    ssh_cmd "
        for key in \$(docker exec sparkeyes-plc-cache redis-cli KEYS '*' | head -20); do
            echo \"--- KEY: \$key ---\"
            type=\$(docker exec sparkeyes-plc-cache redis-cli TYPE \"\$key\" | tr -d '\\r')
            echo \"TYPE: \$type\"
            case \$type in
                hash)   docker exec sparkeyes-plc-cache redis-cli HGETALL \"\$key\" ;;
                string) docker exec sparkeyes-plc-cache redis-cli GET \"\$key\" ;;
                list)   docker exec sparkeyes-plc-cache redis-cli LRANGE \"\$key\" 0 10 ;;
                set)    docker exec sparkeyes-plc-cache redis-cli SMEMBERS \"\$key\" ;;
                zset)   docker exec sparkeyes-plc-cache redis-cli ZRANGE \"\$key\" 0 10 WITHSCORES ;;
                *)      echo \"(unknown type)\" ;;
            esac
            echo \"\"
        done
    " || echo "(failed)"

    # Global cache — inspect key schemas
    echo ""
    echo "--- Redis Global Cache: Key schemas ---"
    ssh_cmd "
        for key in \$(docker exec sparkeyes-global-cache redis-cli KEYS '*' | head -20); do
            echo \"--- KEY: \$key ---\"
            type=\$(docker exec sparkeyes-global-cache redis-cli TYPE \"\$key\" | tr -d '\\r')
            echo \"TYPE: \$type\"
            case \$type in
                hash)   docker exec sparkeyes-global-cache redis-cli HGETALL \"\$key\" ;;
                string) docker exec sparkeyes-global-cache redis-cli GET \"\$key\" ;;
                list)   docker exec sparkeyes-global-cache redis-cli LRANGE \"\$key\" 0 10 ;;
                *)      echo \"(other: \$type)\" ;;
            esac
            echo \"\"
        done
    " || echo "(failed)"

    # === SECTION 4: RabbitMQ ===
    echo ""
    echo "=== SECTION 4: RABBITMQ ==="
    echo "--- rabbitmqctl list_queues ---"
    ssh_cmd "docker exec message-broker rabbitmqctl list_queues name messages consumers" || echo "(failed)"

    echo ""
    echo "--- rabbitmqctl list_users ---"
    ssh_cmd "docker exec message-broker rabbitmqctl list_users" || echo "(failed)"

    echo ""
    echo "--- Management API: queues ---"
    ssh_cmd "curl -sf -u guest:guest http://localhost:15672/api/queues/%2F/ 2>/dev/null || echo '(guest:guest failed, trying strokmatic)'; curl -sf -u strokmatic:strokmatic http://localhost:15672/api/queues/%2F/ 2>/dev/null || echo '(strokmatic:strokmatic failed)'" || echo "(failed)"

    echo ""
    echo "--- Management API: overview ---"
    ssh_cmd "curl -sf -u guest:guest http://localhost:15672/api/overview 2>/dev/null | head -200 || echo '(failed)'" || echo "(failed)"

    # === SECTION 5: PostgreSQL ===
    echo ""
    echo "=== SECTION 5: POSTGRESQL ==="
    echo "--- DB size ---"
    ssh_cmd "docker exec pg-server psql -U strokmatic -d sparkeyes -t -A -c \"SELECT pg_database_size('sparkeyes')\"" || echo "(failed)"

    echo ""
    echo "--- Active connections ---"
    ssh_cmd "docker exec pg-server psql -U strokmatic -d sparkeyes -t -A -c \"SELECT count(*) FROM pg_stat_activity WHERE state='active'\"" || echo "(failed)"

    echo ""
    echo "--- Table listing with row counts ---"
    ssh_cmd "docker exec pg-server psql -U strokmatic -d sparkeyes -t -A -c \"
        SELECT schemaname, relname, n_live_tup
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 30
    \"" || echo "(failed)"

    echo ""
    echo "--- Table sizes ---"
    ssh_cmd "docker exec pg-server psql -U strokmatic -d sparkeyes -t -A -c \"
        SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
        FROM pg_catalog.pg_statio_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 20
    \"" || echo "(failed)"

    echo ""
    echo "--- PostgreSQL version ---"
    ssh_cmd "docker exec pg-server psql -U strokmatic -d sparkeyes -t -A -c 'SELECT version()'" || echo "(failed)"

    # === SECTION 6: Prometheus ===
    echo ""
    echo "=== SECTION 6: PROMETHEUS ==="
    echo "--- Prometheus targets ---"
    ssh_cmd "curl -sf http://localhost:8110/api/v1/targets 2>/dev/null" || echo "(failed)"

    echo ""
    echo "--- Prometheus config ---"
    ssh_cmd "curl -sf http://localhost:8110/api/v1/status/config 2>/dev/null | head -100" || echo "(failed)"

    # === SECTION 7: Network ===
    echo ""
    echo "=== SECTION 7: NETWORK ==="
    echo "--- Listening ports ---"
    ssh_cmd "ss -tlnp" || echo "(failed)"

    echo ""
    echo "--- Docker networks ---"
    ssh_cmd "docker network ls" || echo "(failed)"

    echo ""
    echo "--- Docker network inspect (bridge networks) ---"
    ssh_cmd "for net in \$(docker network ls --format '{{.Name}}' | grep -v '^host$\|^none$'); do echo \"=== \$net ===\"; docker network inspect \$net --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{println}}{{end}}' 2>/dev/null; done" || echo "(failed)"

    # === SECTION 8: Tool availability ===
    echo ""
    echo "=== SECTION 8: TOOL AVAILABILITY ==="
    ssh_cmd "which jq python3 sshpass curl 2>/dev/null; echo '---'; jq --version 2>/dev/null; python3 --version 2>/dev/null" || echo "(failed)"

    # === SECTION 9: Docker compose files ===
    echo ""
    echo "=== SECTION 9: DOCKER COMPOSE FILES ==="
    ssh_cmd "find /home/spotfusion -maxdepth 4 -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' 2>/dev/null | sort" || echo "(failed)"

    echo ""
    echo "--- Contents of found compose files ---"
    ssh_cmd "
        for f in \$(find /home/spotfusion -maxdepth 4 -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' 2>/dev/null | sort); do
            echo \"=== FILE: \$f ===\"
            cat \"\$f\"
            echo \"\"
        done
    " || echo "(failed)"

    # === SECTION 10: Docker logs (recent errors) ===
    echo ""
    echo "=== SECTION 10: DOCKER LOGS (recent errors) ==="
    for container in sparkeyes-back-end sparkeyes-front-end database-write tag-monitor-siemens bos-connector default-module-sheets; do
        echo ""
        echo "--- Errors: ${container} (last 15m) ---"
        ssh_cmd "docker logs --since 15m ${container} 2>&1 | grep -iE 'error|exception|traceback|warning|fatal|oom' | tail -30" || echo "(no errors or container not found)"
    done

    # Also check get-data and plc-monitor containers
    echo ""
    echo "--- Errors: get-data-* (last 15m) ---"
    ssh_cmd "for c in \$(docker ps --format '{{.Names}}' | grep 'get-data'); do echo \"== \$c ==\"; docker logs --since 15m \$c 2>&1 | grep -iE 'error|exception|traceback|warning|fatal|oom' | tail -20; done" || echo "(failed)"

    echo ""
    echo "--- Errors: plc-monitor-* (last 15m) ---"
    ssh_cmd "for c in \$(docker ps --format '{{.Names}}' | grep 'plc-monitor'); do echo \"== \$c ==\"; docker logs --since 15m \$c 2>&1 | grep -iE 'error|exception|traceback|warning|fatal|oom' | tail -20; done" || echo "(failed)"

    echo ""
    echo "================================================================"
    echo "EXPLORATION COMPLETE — $(date -Iseconds)"
    echo "================================================================"

} > "$OUTPUT_FILE" 2>&1

echo "Exploration complete. Output saved to: $OUTPUT_FILE"
echo "File size: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo ""
echo "Next step: Copy this file back and feed it to JARVIS for config generation."
