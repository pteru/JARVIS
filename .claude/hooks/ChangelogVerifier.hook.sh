#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/utils.sh"

require_jq
read_hook_input

workspace="$(get_input_field '.tool_input.workspace')"

if [[ -z "$workspace" ]]; then
  exit 0
fi

today="$(date +%Y-%m-%d)"
changelog="${CHANGELOG_DIR}/${workspace}.md"

if [[ -f "$changelog" ]] && grep -q "## ${today}" "$changelog" 2>/dev/null; then
  exit 0
fi

echo "[WARNING] No changelog entry for '${workspace}' dated ${today}. Consider adding one."
