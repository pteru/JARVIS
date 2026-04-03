#!/usr/bin/env bash
# Given a workspace key and a list of changed files, returns KB pages that need updating.
# Usage: get_affected_kb_pages <workspace_key> <changed_files_newline_separated>

get_affected_kb_pages() {
  local workspace_key="$1"
  local changed_files="$2"
  local page_map="${KB_PAGE_MAP}"
  local affected_pages=""

  # Read mappings for this workspace
  local mappings
  mappings=$(jq -r --arg ws "$workspace_key" \
    '.mappings[] | select(.workspace == $ws or (.workspace | startswith($ws))) | "\(.path_prefix)\t\(.kb_page)"' \
    "$page_map" 2>/dev/null)

  while IFS=$'\t' read -r prefix kb_page; do
    if echo "$changed_files" | grep -q "^${prefix}"; then
      affected_pages="${affected_pages}${kb_page}"$'\n'
    fi
  done <<< "$mappings"

  # Deduplicate
  echo "$affected_pages" | sort -u | grep -v '^$'
}
