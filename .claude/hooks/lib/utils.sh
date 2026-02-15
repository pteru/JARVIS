#!/usr/bin/env bash
set -euo pipefail

# Shared utilities for Claude Code hooks

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-/home/teruel/claude-orchestrator}"

# Config paths
WORKSPACES_CONFIG="${ORCHESTRATOR_HOME}/config/orchestrator/workspaces.json"
MODELS_CONFIG="${ORCHESTRATOR_HOME}/config/orchestrator/models.json"
DISPATCHES_LOG="${ORCHESTRATOR_HOME}/logs/dispatches.json"
BACKLOG_DIR="${ORCHESTRATOR_HOME}/backlog"
CHANGELOG_DIR="${ORCHESTRATOR_HOME}/changelogs"

# Check that jq is available; fail-open if missing
require_jq() {
  if ! command -v jq &>/dev/null; then
    echo '{"decision":"allow"}' # fail-open for PreToolUse
    echo "WARN: jq not found, skipping hook logic" >&2
    exit 0
  fi
}

# Read hook input JSON from stdin into HOOK_INPUT global
read_hook_input() {
  HOOK_INPUT="$(cat)"
}

# Extract a field from the hook input
# Usage: get_input_field '.tool_input.workspace'
get_input_field() {
  echo "${HOOK_INPUT}" | jq -r "$1 // empty" 2>/dev/null || true
}

# Resolve workspace path from workspaces.json
get_workspace_path() {
  local ws="$1"
  if [[ -f "$WORKSPACES_CONFIG" ]]; then
    jq -r --arg ws "$ws" '.workspaces[$ws].path // empty' "$WORKSPACES_CONFIG" 2>/dev/null || true
  fi
}
