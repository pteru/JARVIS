#!/bin/bash
# VK Health Monitor — Configuration loader
# Sourced by other scripts to set up paths, load deployment config, and export thresholds.

set -euo pipefail

# ---------------------------------------------------------------------------
# Base paths
# ---------------------------------------------------------------------------
ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
DEPLOYMENT_ID="${1:-03002}"
CONFIG_FILE="$ORCHESTRATOR_HOME/config/vk-deployments/${DEPLOYMENT_ID}.json"
DATA_DIR="$ORCHESTRATOR_HOME/data/vk-health/${DEPLOYMENT_ID}"
REPORT_DIR="$ORCHESTRATOR_HOME/reports/vk-health/${DEPLOYMENT_ID}"

# ---------------------------------------------------------------------------
# Validate config file
# ---------------------------------------------------------------------------
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: Deployment config not found: $CONFIG_FILE" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Create runtime directories
# ---------------------------------------------------------------------------
mkdir -p "$DATA_DIR" "$REPORT_DIR"

# ---------------------------------------------------------------------------
# Export node names array
# ---------------------------------------------------------------------------
mapfile -t NODE_NAMES < <(jq -r '.nodes | keys[]' "$CONFIG_FILE")
export NODE_NAMES

# ---------------------------------------------------------------------------
# Export threshold values
# ---------------------------------------------------------------------------
DISK_WARNING_PCT=$(jq -r '.thresholds.disk_warning_pct' "$CONFIG_FILE")
DISK_CRITICAL_PCT=$(jq -r '.thresholds.disk_critical_pct' "$CONFIG_FILE")
RAM_WARNING_PCT=$(jq -r '.thresholds.ram_warning_pct' "$CONFIG_FILE")
RAM_CRITICAL_PCT=$(jq -r '.thresholds.ram_critical_pct' "$CONFIG_FILE")
GPU_MEM_WARNING_PCT=$(jq -r '.thresholds.gpu_mem_warning_pct' "$CONFIG_FILE")
GPU_MEM_CRITICAL_PCT=$(jq -r '.thresholds.gpu_mem_critical_pct' "$CONFIG_FILE")
QUEUE_WARNING=$(jq -r '.thresholds.queue_warning' "$CONFIG_FILE")
QUEUE_CRITICAL=$(jq -r '.thresholds.queue_critical' "$CONFIG_FILE")
RESTART_WARNING=$(jq -r '.thresholds.restart_warning' "$CONFIG_FILE")
RESTART_CRITICAL=$(jq -r '.thresholds.restart_critical' "$CONFIG_FILE")
ALERT_COOLDOWN_MINUTES=$(jq -r '.thresholds.alert_cooldown_minutes' "$CONFIG_FILE")

export ORCHESTRATOR_HOME DEPLOYMENT_ID CONFIG_FILE DATA_DIR REPORT_DIR
export DISK_WARNING_PCT DISK_CRITICAL_PCT
export RAM_WARNING_PCT RAM_CRITICAL_PCT
export GPU_MEM_WARNING_PCT GPU_MEM_CRITICAL_PCT
export QUEUE_WARNING QUEUE_CRITICAL
export RESTART_WARNING RESTART_CRITICAL
export ALERT_COOLDOWN_MINUTES
