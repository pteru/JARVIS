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

# Backlog summary — read the GitHub Issues cache (data/backlog-cache/*.json).
# GitHub is the source of truth; the cron `refresh-backlog-cache` keeps the cache fresh.
echo ""
echo "-- Pending Backlog Issues (GitHub) --"
cache_dir="${ORCHESTRATOR_HOME}/data/backlog-cache"
if compgen -G "${cache_dir}/*.json" > /dev/null; then
  newest=0
  for f in "${cache_dir}"/*.json; do
    repo="$(jq -r '.repo // "?"' "$f" 2>/dev/null)"
    count="$(jq -r '[.issues[] | select((.state // "open") == "open")] | length' "$f" 2>/dev/null || echo 0)"
    [[ "$count" -gt 0 ]] && echo "  ${repo}: ${count} open"
    mtime="$(date -r "$f" +%s 2>/dev/null || echo 0)"
    [[ "$mtime" -gt "$newest" ]] && newest="$mtime"
  done
  if [[ "$newest" -gt 0 ]]; then
    age_h=$(( ( $(date +%s) - newest ) / 3600 ))
    echo "  (cache age: ${age_h}h — run \`orchestrator.sh refresh-backlog-cache\` to update)"
  fi
else
  echo "  (no cache — run \`orchestrator.sh refresh-backlog-cache\`)"
fi

# Hook matcher validation
SETTINGS_FILE="${SCRIPT_DIR}/../settings.local.json"
if [[ -f "$SETTINGS_FILE" ]]; then
  # Extract all MCP tool matchers from hooks config
  MATCHERS=$(jq -r '
    [.hooks // {} | to_entries[] | .value[] | .matcher // empty] | unique | .[]
  ' "$SETTINGS_FILE" 2>/dev/null)

  INVALID=""
  for matcher in $MATCHERS; do
    # Parse: mcp__<server>__<tool>
    server=$(echo "$matcher" | sed -n 's/^mcp__\([^_]*\)__.*$/\1/p')
    server="${server//-/_}"  # tool names use underscores
    # Check that the MCP server directory exists
    server_dir=$(echo "$matcher" | sed -n 's/^mcp__\(.*\)__[^_]*$/\1/p' | tr '_' '-')
    # Try both the raw name and with hyphens
    if [[ -n "$server_dir" ]]; then
      mcp_path="${ORCHESTRATOR_HOME}/mcp-servers/${server_dir}/index.js"
      if [[ ! -f "$mcp_path" ]]; then
        INVALID="${INVALID}\n  WARN: Hook matcher '${matcher}' — MCP server not found at ${mcp_path}"
      fi
    fi
  done

  if [[ -n "$INVALID" ]]; then
    echo ""
    echo "-- Hook Warnings --"
    echo -e "$INVALID"
  fi
fi

echo ""
echo "==========================="
