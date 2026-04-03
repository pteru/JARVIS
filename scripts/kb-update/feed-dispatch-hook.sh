#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/page-mapper.sh"

# Read dispatch metadata from hook input (stdin or args)
WORKSPACE="${1:-unknown}"
TASK_STATUS="${2:-unknown}"
TASK_ID="${3:-unknown}"

# Only process completed tasks
[ "$TASK_STATUS" != "complete" ] && exit 0

echo "[$(date -Iseconds)] Feed 2: Dispatch complete for $WORKSPACE (task: $TASK_ID)" >> "$KB_LOG"

# Get workspace path
WS_PATH=$(jq -r --arg ws "$WORKSPACE" '.workspaces[$ws].path // empty' "${ORCHESTRATOR_HOME}/config/orchestrator/workspaces.json" 2>/dev/null)
[ -z "$WS_PATH" ] && exit 0
[ -d "$WS_PATH/.git" ] || exit 0

# Get latest commit SHA
LATEST_SHA=$(git -C "$WS_PATH" rev-parse HEAD 2>/dev/null || echo "unknown")

# Get files changed in last commit
CHANGED_FILES=$(git -C "$WS_PATH" diff --name-only HEAD~1..HEAD 2>/dev/null || true)
[ -z "$CHANGED_FILES" ] && exit 0

# Map to KB pages
AFFECTED=$(get_affected_kb_pages "$WORKSPACE" "$CHANGED_FILES")
if [ -n "$AFFECTED" ]; then
  while IFS= read -r page; do
    [ -z "$page" ] && continue
    echo "  - KB page affected: $page" >> "$KB_LOG"

    # Record in kb-updates.json (Feed 2 has priority over Feed 1)
    jq --arg page "$page" --arg ws "$WORKSPACE" --arg sha "$LATEST_SHA" --arg ts "$(date -Iseconds)" --arg tid "$TASK_ID" \
      '.updates += [{"page": $page, "workspace": $ws, "commit_sha": $sha, "feed": "dispatch-hook", "task_id": $tid, "timestamp": $ts, "status": "pending"}]' \
      "$KB_UPDATES_FILE" > "${KB_UPDATES_FILE}.tmp" && mv "${KB_UPDATES_FILE}.tmp" "$KB_UPDATES_FILE"
  done <<< "$AFFECTED"
fi
