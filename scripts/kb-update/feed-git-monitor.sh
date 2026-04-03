#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/page-mapper.sh"

echo "[$(date -Iseconds)] Feed 1: Git activity monitor starting" >> "$KB_LOG"

WORKSPACES_JSON="${ORCHESTRATOR_HOME}/config/orchestrator/workspaces.json"
STALE_PAGES=""

# Get last run timestamp from kb-updates.json
LAST_RUN=$(jq -r '.last_run // "1970-01-01T00:00:00Z"' "$KB_UPDATES_FILE" 2>/dev/null || echo "1970-01-01T00:00:00Z")

# Check each workspace for recent merges to master/main
jq -r '.workspaces | to_entries[] | select(.value.remotes.origin != null) | "\(.key)\t\(.value.path)"' "$WORKSPACES_JSON" | \
while IFS=$'\t' read -r ws_key ws_path; do
  [ -d "$ws_path/.git" ] || continue

  # Find commits merged since last run
  RECENT_COMMITS=$(git -C "$ws_path" log --since="$LAST_RUN" --oneline --format="%H" origin/master 2>/dev/null || true)
  [ -z "$RECENT_COMMITS" ] && continue

  # Get changed files across all recent commits
  CHANGED_FILES=$(git -C "$ws_path" diff --name-only "$(git -C "$ws_path" log --since="$LAST_RUN" --format="%H" origin/master | tail -1)..origin/master" 2>/dev/null || true)
  [ -z "$CHANGED_FILES" ] && continue

  # Check if already covered by Feed 2 (dispatch hook)
  LATEST_SHA=$(echo "$RECENT_COMMITS" | head -1)
  ALREADY_COVERED=$(jq -r --arg sha "$LATEST_SHA" '.updates[] | select(.commit_sha == $sha) | .commit_sha' "$KB_UPDATES_FILE" 2>/dev/null || true)
  [ -n "$ALREADY_COVERED" ] && continue

  # Map changed files to KB pages
  AFFECTED=$(get_affected_kb_pages "$ws_key" "$CHANGED_FILES")
  if [ -n "$AFFECTED" ]; then
    while IFS= read -r page; do
      STALE_PAGES="${STALE_PAGES}${page}|${ws_key}|${LATEST_SHA}"$'\n'
    done <<< "$AFFECTED"
  fi
done

# Update last_run timestamp
jq --arg ts "$(date -Iseconds)" '.last_run = $ts' "$KB_UPDATES_FILE" > "${KB_UPDATES_FILE}.tmp" && mv "${KB_UPDATES_FILE}.tmp" "$KB_UPDATES_FILE"

if [ -n "$STALE_PAGES" ]; then
  PAGE_COUNT=$(echo "$STALE_PAGES" | grep -c '.' || true)
  echo "[$(date -Iseconds)] Feed 1: Found $PAGE_COUNT potentially stale KB pages" >> "$KB_LOG"

  # Log affected pages
  echo "$STALE_PAGES" | while IFS='|' read -r page ws sha; do
    [ -z "$page" ] && continue
    echo "  - $page (workspace: $ws, commit: ${sha:0:7})" >> "$KB_LOG"

    # Record in kb-updates.json
    jq --arg page "$page" --arg ws "$ws" --arg sha "$sha" --arg ts "$(date -Iseconds)" \
      '.updates += [{"page": $page, "workspace": $ws, "commit_sha": $sha, "feed": "git-monitor", "timestamp": $ts, "status": "pending"}]' \
      "$KB_UPDATES_FILE" > "${KB_UPDATES_FILE}.tmp" && mv "${KB_UPDATES_FILE}.tmp" "$KB_UPDATES_FILE"
  done
else
  echo "[$(date -Iseconds)] Feed 1: No stale pages detected" >> "$KB_LOG"
fi
