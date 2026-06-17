#!/bin/bash
# Health Monitor — Report Cleanup (generic)
# Deletes per-run analysis files older than analysis_retention_days (default 7),
# but ONLY after consolidation has run (verified via consolidation-state.json).
# Deletes consolidated daily reports older than consolidated_retention_days (default 30).
# Monthly reports (monthly-*.md) have PERMANENT retention and are never deleted.
#
# Usage: cleanup-reports.sh <product> <deployment>
#
# Interfaces:
#   Consumes: lib/config.sh (load_health_config → REPORT_DIR, CONFIG_FILE)
#   Manages:  $REPORT_DIR/analysis-*.md
#             $REPORT_DIR/consolidated-*.md
#             $REPORT_DIR/monthly-*.md   (never deleted)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"

# shellcheck source=../lib/config.sh
source "$LIB_DIR/config.sh"
load_health_config "${1:?product required}" "${2:?deployment required}"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] [cleanup] $*" >&2; }

# ---------------------------------------------------------------------------
# Read retention windows from config (with defaults)
# ---------------------------------------------------------------------------
ANALYSIS_RETENTION_DAYS=$(jq -r '.analysis_retention_days // 7' "$CONFIG_FILE" 2>/dev/null)
ANALYSIS_RETENTION_DAYS="${ANALYSIS_RETENTION_DAYS:-7}"

CONSOLIDATED_RETENTION_DAYS=$(jq -r '.consolidated_retention_days // 30' "$CONFIG_FILE" 2>/dev/null)
CONSOLIDATED_RETENTION_DAYS="${CONSOLIDATED_RETENTION_DAYS:-30}"

CONSOLIDATION_STATE="$REPORT_DIR/consolidation-state.json"

# ---------------------------------------------------------------------------
# Gate: consolidation must have run before we delete per-run analysis files
# ---------------------------------------------------------------------------
if [[ ! -f "$CONSOLIDATION_STATE" ]]; then
  log "WARN: No consolidation-state.json found — skipping per-run analysis cleanup (consolidation must run first)"
else
  LAST_CONSOLIDATED=$(jq -r '.last_consolidated // empty' "$CONSOLIDATION_STATE" 2>/dev/null)
  if [[ -z "$LAST_CONSOLIDATED" ]]; then
    log "WARN: Could not read last_consolidated timestamp — skipping analysis cleanup"
  else
    log "Last consolidation: $LAST_CONSOLIDATED"

    # -------------------------------------------------------------------------
    # Delete per-run analysis files older than ANALYSIS_RETENTION_DAYS
    # -------------------------------------------------------------------------
    DELETED=0
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      if find "$file" -mtime +"${ANALYSIS_RETENTION_DAYS}" -print -quit 2>/dev/null | grep -q .; then
        rm "$file"
        DELETED=$((DELETED + 1))
      fi
    done < <(find "$REPORT_DIR" -maxdepth 1 -name 'analysis-*.md' -type f 2>/dev/null)

    if [[ "$DELETED" -gt 0 ]]; then
      log "Deleted $DELETED per-run analysis file(s) older than ${ANALYSIS_RETENTION_DAYS} days"
    else
      log "No per-run analysis files to clean up"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Delete old consolidated daily reports older than CONSOLIDATED_RETENTION_DAYS
# ---------------------------------------------------------------------------
CONSOLIDATED_DELETED=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if find "$file" -mtime +"${CONSOLIDATED_RETENTION_DAYS}" -print -quit 2>/dev/null | grep -q .; then
    rm "$file"
    CONSOLIDATED_DELETED=$((CONSOLIDATED_DELETED + 1))
  fi
done < <(find "$REPORT_DIR" -maxdepth 1 -name 'consolidated-*.md' -type f 2>/dev/null)

if [[ "$CONSOLIDATED_DELETED" -gt 0 ]]; then
  log "Deleted $CONSOLIDATED_DELETED consolidated report(s) older than ${CONSOLIDATED_RETENTION_DAYS} days"
else
  log "No consolidated reports to clean up"
fi

# ---------------------------------------------------------------------------
# Monthly reports — permanent retention (informational only)
# ---------------------------------------------------------------------------
MONTHLY_COUNT=$(find "$REPORT_DIR" -maxdepth 1 -name 'monthly-*.md' -type f 2>/dev/null | wc -l)
if [[ "$MONTHLY_COUNT" -gt 0 ]]; then
  log "Preserving $MONTHLY_COUNT monthly report(s) (permanent retention)"
fi

log "Cleanup complete for ${HEALTH_PRODUCT}/${HEALTH_DEPLOYMENT}"
