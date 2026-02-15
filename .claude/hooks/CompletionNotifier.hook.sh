#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/utils.sh"

require_jq
read_hook_input

new_status="$(get_input_field '.tool_input.status')"
task_id="$(get_input_field '.tool_input.task_id')"

if [[ "$new_status" == "complete" ]]; then
  echo "[TASK COMPLETE] ${task_id} finished successfully."
elif [[ "$new_status" == "failed" ]]; then
  error="$(get_input_field '.tool_input.error_message')"
  echo "[TASK FAILED] ${task_id} failed.${error:+ Error: ${error}}"
fi
