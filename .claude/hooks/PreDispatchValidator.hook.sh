#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/utils.sh"

require_jq
read_hook_input

workspace="$(get_input_field '.tool_input.workspace')"

# Validate workspace exists in config
if [[ -n "$workspace" ]] && [[ -f "$WORKSPACES_CONFIG" ]]; then
  ws_path="$(jq -r --arg ws "$workspace" '.workspaces[$ws].path // empty' "$WORKSPACES_CONFIG" 2>/dev/null || true)"
  if [[ -z "$ws_path" ]]; then
    echo "{\"decision\":\"block\",\"reason\":\"Workspace '${workspace}' not found in workspaces.json\"}"
    exit 0
  fi

  # Check workspace path is accessible
  if [[ ! -d "$ws_path" ]]; then
    echo "{\"decision\":\"block\",\"reason\":\"Workspace path '${ws_path}' is not accessible\"}"
    exit 0
  fi
fi

echo '{"decision":"allow"}'
