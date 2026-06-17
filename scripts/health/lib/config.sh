#!/bin/bash
# Health Monitor — unified config loader
# Usage: source scripts/health/lib/config.sh
#        load_health_config <product> <deployment>
#
# Exports the full set of variables consumed by the core pipeline.
# Reads from: config/health/<product>/<deployment>.json

load_health_config() {
  local product="$1"
  local deployment="$2"

  # Resolve ORCHESTRATOR_HOME
  ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"

  # Core paths
  export HEALTH_PRODUCT="$product"
  export HEALTH_DEPLOYMENT="$deployment"
  export CONFIG_FILE="$ORCHESTRATOR_HOME/config/health/$product/$deployment.json"

  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: Health config not found: $CONFIG_FILE" >&2
    return 1
  fi

  # Identity
  export HEALTH_NAME
  HEALTH_NAME="$(jq -r '.name' "$CONFIG_FILE")"

  # Data / report directories (data_root and reports_root are relative to ORCHESTRATOR_HOME)
  local data_root reports_root
  data_root="$(jq -r '.data_root' "$CONFIG_FILE")"
  reports_root="$(jq -r '.reports_root' "$CONFIG_FILE")"
  export DATA_DIR
  DATA_DIR="$ORCHESTRATOR_HOME/$data_root/$deployment"
  export REPORT_DIR
  REPORT_DIR="$ORCHESTRATOR_HOME/$reports_root/$deployment"

  # Assembler and model
  export ASSEMBLER
  ASSEMBLER="$(jq -r '.assembler' "$CONFIG_FILE")"
  export CLAUDE_MODEL
  CLAUDE_MODEL="$(jq -r '.claude_model // "claude-opus-4-6"' "$CONFIG_FILE")"

  # Connectivity
  export CONNECTIVITY_LABEL
  CONNECTIVITY_LABEL="$(jq -r '.connectivity.label' "$CONFIG_FILE")"
  mapfile -t CONNECTIVITY_NODES < <(jq -r '.connectivity.nodes[]' "$CONFIG_FILE")
  export CONNECTIVITY_NODES

  # Secrets — expand leading ~ to $HOME
  local ssh_path rabbit_path
  ssh_path="$(jq -r '.secrets.ssh' "$CONFIG_FILE")"
  rabbit_path="$(jq -r '.secrets.rabbit' "$CONFIG_FILE")"
  export HEALTH_SSH_SECRET
  HEALTH_SSH_SECRET="${ssh_path/#\~/$HOME}"
  export HEALTH_RABBIT_SECRET
  HEALTH_RABBIT_SECRET="${rabbit_path/#\~/$HOME}"

  # Timing / throttle
  export THROTTLE_MINUTES
  THROTTLE_MINUTES="$(jq -r '.throttle_minutes // 240' "$CONFIG_FILE")"
  export ALERT_COOLDOWN_MINUTES
  ALERT_COOLDOWN_MINUTES="$(jq -r '.alert_cooldown_minutes // 60' "$CONFIG_FILE")"
  export HEARTBEAT_INTERVAL_MINUTES
  HEARTBEAT_INTERVAL_MINUTES="$(jq -r '.heartbeat_interval_minutes // 60' "$CONFIG_FILE")"

  # Pipeline control
  export PIPELINE_ENABLED
  PIPELINE_ENABLED="$(jq -r 'if .enabled == false then "false" else "true" end' "$CONFIG_FILE")"
}
