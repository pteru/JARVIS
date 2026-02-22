#!/bin/bash
# VK Health Monitor — Report Cleanup
# Deletes per-run analysis files older than 7 days, but only if they have been
# included in a consolidated report (verified via consolidation-state.json).
# Also deletes old consolidated daily reports older than 30 days.
# Usage: cleanup-reports.sh [deployment-id] (default: 03002)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh" "${1:-03002}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [cleanup] $*" >&2; }

CONSOLIDATION_STATE="$REPORT_DIR/consolidation-state.json"
RETENTION_DAYS=7
CONSOLIDATED_RETENTION_DAYS=30

# ---------------------------------------------------------------------------
# Check consolidation state
# ---------------------------------------------------------------------------
if [[ ! -f "$CONSOLIDATION_STATE" ]]; then
    log "WARN: No consolidation-state.json found — skipping per-run cleanup (consolidation must run first)"
    exit 0
fi

LAST_CONSOLIDATED=$(jq -r '.last_consolidated // empty' "$CONSOLIDATION_STATE" 2>/dev/null)
if [[ -z "$LAST_CONSOLIDATED" ]]; then
    log "WARN: Could not read last_consolidated timestamp — skipping"
    exit 0
fi

log "Last consolidation: $LAST_CONSOLIDATED"

# ---------------------------------------------------------------------------
# Delete per-run analysis files older than retention period
# ---------------------------------------------------------------------------
DELETED=0
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    # Extract timestamp from filename: analysis-YYYY-MM-DD_HH-MM-SS.md
    FILE_TS=$(basename "$file" | sed -n 's/analysis-\([0-9_-]*\)\.md/\1/p')
    if [[ -z "$FILE_TS" ]]; then
        continue
    fi
    # Convert filename timestamp to comparable format
    FILE_DATE=$(echo "$FILE_TS" | cut -d'_' -f1)

    # Check file age via find
    if find "$file" -mtime +${RETENTION_DAYS} -print -quit 2>/dev/null | grep -q .; then
        rm "$file"
        DELETED=$((DELETED + 1))
    fi
done < <(find "$REPORT_DIR" -maxdepth 1 -name 'analysis-*.md' -type f 2>/dev/null)

if [[ "$DELETED" -gt 0 ]]; then
    log "Deleted $DELETED per-run analysis files older than ${RETENTION_DAYS} days"
else
    log "No per-run analysis files to clean up"
fi

# ---------------------------------------------------------------------------
# Delete old consolidated daily reports
# ---------------------------------------------------------------------------
CONSOLIDATED_DELETED=0
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if find "$file" -mtime +${CONSOLIDATED_RETENTION_DAYS} -print -quit 2>/dev/null | grep -q .; then
        rm "$file"
        CONSOLIDATED_DELETED=$((CONSOLIDATED_DELETED + 1))
    fi
done < <(find "$REPORT_DIR" -maxdepth 1 -name 'consolidated-*.md' -type f 2>/dev/null)

if [[ "$CONSOLIDATED_DELETED" -gt 0 ]]; then
    log "Deleted $CONSOLIDATED_DELETED consolidated reports older than ${CONSOLIDATED_RETENTION_DAYS} days"
fi

log "Cleanup complete"
