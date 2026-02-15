#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/utils.sh"

require_jq

echo "=== Orchestrator Dashboard ==="

# Dispatch status summary
if [[ -f "$DISPATCHES_LOG" ]]; then
  echo ""
  echo "-- Dispatches by Status --"
  jq -r '
    group_by(.status) | map({status: .[0].status, count: length})
    | sort_by(.status) | .[] | "  \(.status): \(.count)"
  ' "$DISPATCHES_LOG" 2>/dev/null || echo "  (could not parse dispatches)" >&2

  echo ""
  echo "-- Last 3 Dispatches --"
  jq -r '
    sort_by(.updated_at // .created_at) | reverse | .[0:3]
    | .[] | "  [\(.status)] \(.workspace) - \(.original_task // .task | .[0:60])"
  ' "$DISPATCHES_LOG" 2>/dev/null || echo "  (none)" >&2
else
  echo "  No dispatch log found."
fi

# Backlog summary
echo ""
echo "-- Pending Backlog Tasks --"
found=0
if [[ -d "$BACKLOG_DIR" ]]; then
  for f in "${BACKLOG_DIR}"/*.md; do
    [[ -f "$f" ]] || continue
    ws_name="$(basename "$f" .md)"
    count="$(grep -cE '^\s*-\s*\[ \]' "$f" 2>/dev/null || echo 0)"
    if [[ "$count" -gt 0 ]]; then
      echo "  ${ws_name}: ${count} pending"
      found=1
    fi
  done
fi
[[ "$found" -eq 0 ]] && echo "  (none)"

echo ""
echo "==========================="
