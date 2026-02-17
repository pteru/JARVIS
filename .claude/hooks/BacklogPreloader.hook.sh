#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/utils.sh"

require_jq
read_hook_input

workspace="$(get_input_field '.tool_input.workspace')"

if [[ -z "$workspace" ]]; then
  echo '{"decision":"allow"}'
  exit 0
fi

ws_path="$(get_workspace_path "$workspace")"

if [[ -z "$ws_path" ]] || [[ ! -d "$ws_path" ]]; then
  echo '{"decision":"allow"}'
  exit 0
fi

local_backlog="${ws_path}/.claude/backlog.md"
central_backlog="${BACKLOG_DIR}/${workspace}.md"
# Also check with strokmatic prefix
if [[ ! -f "$central_backlog" ]]; then
  central_backlog="${BACKLOG_DIR}/strokmatic.${workspace}.md"
fi

# Sync local backlog to central if local is newer
if [[ -f "$local_backlog" ]]; then
  if [[ ! -f "$central_backlog" ]] || [[ "$local_backlog" -nt "$central_backlog" ]]; then
    mkdir -p "$BACKLOG_DIR"
    cp "$local_backlog" "$central_backlog"
    echo "Synced backlog from ${workspace} workspace." >&2
  fi
fi

echo '{"decision":"allow"}'
