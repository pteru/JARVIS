#!/usr/bin/env bash
#
# deploy-monitoring.sh — Deploy the VisionKing monitoring stack to a target node
#
# Usage:
#   deploy-monitoring.sh <target-node> <gpu|no-gpu>
#
# Environment variables:
#   VK_SSH_PASSWORD  — SSH password for sshpass (required)
#
# Node addresses (internal network, SSH port 8050):
#   vk01  10.244.70.26
#   vk02  10.244.70.50
#   vk03  10.244.70.25
#
# Examples:
#   VK_SSH_PASSWORD=secret ./deploy-monitoring.sh vk01 gpu
#   VK_SSH_PASSWORD=secret ./deploy-monitoring.sh vk03 no-gpu

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_PORT=8050
SSH_OPTS="-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -p ${SSH_PORT}"
REMOTE_DEPLOY_DIR="/opt/monitoring"

declare -A NODE_IPS=(
    [vk01]="10.244.70.26"
    [vk02]="10.244.70.50"
    [vk03]="10.244.70.25"
)

# Images to pull/save — base set
BASE_IMAGES=(
    "prom/prometheus:latest"
    "grafana/grafana:latest"
    "prom/node-exporter:latest"
    "gcr.io/cadvisor/cadvisor:latest"
)

GPU_IMAGE="nvcr.io/nvidia/k8s/dcgm-exporter:latest"

# vk01 is the image source node (has internet or pre-pulled images)
SOURCE_NODE="vk01"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
err()  { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; }
die()  { err "$@"; exit 1; }

ssh_cmd() {
    local user="$1" host="$2"; shift 2
    sshpass -e ssh ${SSH_OPTS} "${user}@${host}" "$@"
}

scp_cmd() {
    local user="$1" host="$2" src="$3" dst="$4"
    sshpass -e scp -P "${SSH_PORT}" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$src" "${user}@${host}:${dst}"
}

usage() {
    echo "Usage: $0 <target-node> <gpu|no-gpu>"
    echo ""
    echo "target-node:  vk01, vk02, or vk03"
    echo "gpu|no-gpu:   whether the target has an NVIDIA GPU"
    echo ""
    echo "Required env: VK_SSH_PASSWORD"
    exit 1
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

[[ $# -eq 2 ]] || usage

TARGET_NODE="$1"
GPU_MODE="$2"

[[ -n "${VK_SSH_PASSWORD:-}" ]] || die "VK_SSH_PASSWORD environment variable is not set"
[[ -n "${NODE_IPS[$TARGET_NODE]+x}" ]] || die "Unknown node: ${TARGET_NODE}. Valid: ${!NODE_IPS[*]}"
[[ "$GPU_MODE" == "gpu" || "$GPU_MODE" == "no-gpu" ]] || die "Second argument must be 'gpu' or 'no-gpu'"

TARGET_IP="${NODE_IPS[$TARGET_NODE]}"
TARGET_USER="$TARGET_NODE"  # SSH username matches node name (vk01, vk02, vk03)
SOURCE_USER="$SOURCE_NODE"
export SSHPASS="${VK_SSH_PASSWORD}"

# Select compose and prometheus files based on GPU mode
if [[ "$GPU_MODE" == "gpu" ]]; then
    COMPOSE_FILE="docker-compose.monitoring-gpu.yml"
    PROMETHEUS_FILE="prometheus/prometheus.yml"
else
    COMPOSE_FILE="docker-compose.monitoring-no-gpu.yml"
    PROMETHEUS_FILE="prometheus/prometheus-no-gpu.yml"
fi

# ---------------------------------------------------------------------------
# Pre-flight: check if already deployed
# ---------------------------------------------------------------------------

log "Checking if monitoring stack is already deployed on ${TARGET_NODE} (${TARGET_IP})..."

ALREADY_DEPLOYED=false
if ssh_cmd "${TARGET_USER}" "${TARGET_IP}" "test -f ${REMOTE_DEPLOY_DIR}/docker-compose.yml" 2>/dev/null; then
    ALREADY_DEPLOYED=true
    RUNNING=$(ssh_cmd "${TARGET_USER}" "${TARGET_IP}" "cd ${REMOTE_DEPLOY_DIR} && docker compose ps --format '{{.Name}}' 2>/dev/null | wc -l" || echo "0")
    log "Monitoring stack already exists on ${TARGET_NODE} (${RUNNING} containers running)."
    read -rp "Redeploy? This will restart all monitoring containers. [y/N] " confirm
    if [[ "${confirm,,}" != "y" ]]; then
        log "Aborted."
        exit 0
    fi
    log "Stopping existing stack..."
    ssh_cmd "${TARGET_USER}" "${TARGET_IP}" "cd ${REMOTE_DEPLOY_DIR} && docker compose down" || true
fi

# ---------------------------------------------------------------------------
# Step 1: Save Docker images on source node
# ---------------------------------------------------------------------------

IMAGES=("${BASE_IMAGES[@]}")
if [[ "$GPU_MODE" == "gpu" ]]; then
    IMAGES+=("$GPU_IMAGE")
fi

IMAGE_LIST="${IMAGES[*]}"
ARCHIVE="/tmp/monitoring-images.tar.gz"

log "Step 1/5: Saving Docker images on ${SOURCE_NODE}..."
log "  Images: ${IMAGE_LIST}"

if [[ "$TARGET_NODE" == "$SOURCE_NODE" ]]; then
    log "  Target is the source node — skipping image transfer."
else
    SOURCE_IP="${NODE_IPS[$SOURCE_NODE]}"

    # Save and compress on source node
    ssh_cmd "${SOURCE_USER}" "${SOURCE_IP}" "docker save ${IMAGE_LIST} | gzip > ${ARCHIVE}"
    log "  Images saved to ${SOURCE_NODE}:${ARCHIVE}"

    # ---------------------------------------------------------------------------
    # Step 2: Transfer images from source to target (internal network)
    # ---------------------------------------------------------------------------

    log "Step 2/5: Transferring images from ${SOURCE_NODE} to ${TARGET_NODE}..."
    ssh_cmd "${SOURCE_USER}" "${SOURCE_IP}" "sshpass -e scp -P ${SSH_PORT} -o StrictHostKeyChecking=accept-new ${ARCHIVE} ${TARGET_USER}@${TARGET_IP}:${ARCHIVE}"
    log "  Transfer complete."

    # ---------------------------------------------------------------------------
    # Step 3: Load images on target
    # ---------------------------------------------------------------------------

    log "Step 3/5: Loading Docker images on ${TARGET_NODE}..."
    ssh_cmd "${TARGET_USER}" "${TARGET_IP}" "gunzip -c ${ARCHIVE} | docker load && rm -f ${ARCHIVE}"
    log "  Images loaded."

    # Clean up archive on source
    ssh_cmd "${SOURCE_USER}" "${SOURCE_IP}" "rm -f ${ARCHIVE}"
fi

# ---------------------------------------------------------------------------
# Step 4: Transfer compose + config files to target
# ---------------------------------------------------------------------------

log "Step 4/5: Deploying configuration files to ${TARGET_NODE}:${REMOTE_DEPLOY_DIR}..."

# Create remote directory structure
ssh_cmd "${TARGET_USER}" "${TARGET_IP}" "mkdir -p ${REMOTE_DEPLOY_DIR}/prometheus ${REMOTE_DEPLOY_DIR}/grafana/provisioning/datasources ${REMOTE_DEPLOY_DIR}/grafana/provisioning/dashboards ${REMOTE_DEPLOY_DIR}/grafana/dashboards"

# Copy compose file as docker-compose.yml (standardized name)
scp_cmd "${TARGET_USER}" "${TARGET_IP}" "${SCRIPT_DIR}/${COMPOSE_FILE}" "${REMOTE_DEPLOY_DIR}/docker-compose.yml"

# Copy prometheus config (always as prometheus.yml regardless of source name)
scp_cmd "${TARGET_USER}" "${TARGET_IP}" "${SCRIPT_DIR}/${PROMETHEUS_FILE}" "${REMOTE_DEPLOY_DIR}/prometheus/prometheus.yml"

# Copy grafana provisioning
scp_cmd "${TARGET_USER}" "${TARGET_IP}" "${SCRIPT_DIR}/grafana/provisioning/datasources/datasource.yml" "${REMOTE_DEPLOY_DIR}/grafana/provisioning/datasources/datasource.yml"
scp_cmd "${TARGET_USER}" "${TARGET_IP}" "${SCRIPT_DIR}/grafana/provisioning/dashboards/dashboard.yml" "${REMOTE_DEPLOY_DIR}/grafana/provisioning/dashboards/dashboard.yml"

# Copy grafana dashboards (one by one to avoid glob issues with scp)
for json_file in "${SCRIPT_DIR}/grafana/dashboards/"*.json; do
    scp_cmd "${TARGET_USER}" "${TARGET_IP}" "$json_file" "${REMOTE_DEPLOY_DIR}/grafana/dashboards/"
done

log "  Configuration deployed."

# ---------------------------------------------------------------------------
# Step 5: Start the monitoring stack
# ---------------------------------------------------------------------------

log "Step 5/5: Starting monitoring stack on ${TARGET_NODE}..."
ssh_cmd "${TARGET_USER}" "${TARGET_IP}" "cd ${REMOTE_DEPLOY_DIR} && docker compose up -d"

# Verify
sleep 3
RUNNING=$(ssh_cmd "${TARGET_USER}" "${TARGET_IP}" "cd ${REMOTE_DEPLOY_DIR} && docker compose ps --format '{{.Name}}' 2>/dev/null" || echo "(unable to list)")
log "Running containers:"
echo "$RUNNING" | while read -r name; do
    [[ -n "$name" ]] && log "  - ${name}"
done

log ""
log "Deployment complete on ${TARGET_NODE} (${TARGET_IP})."
log ""
log "Access points:"
log "  Grafana:       http://${TARGET_IP}:8100"
log "  Prometheus:    http://${TARGET_IP}:8110"
log "  Node Exporter: http://${TARGET_IP}:8111/metrics"
log "  cAdvisor:      http://${TARGET_IP}:8112"
if [[ "$GPU_MODE" == "gpu" ]]; then
    log "  NVIDIA GPU:    http://${TARGET_IP}:8114/metrics"
fi
