#!/bin/bash
# VK Health Monitor — Monthly Consolidation
# Aggregates all daily consolidated reports for a given month into a single
# monthly summary report using Claude AI analysis.
# Monthly reports are kept permanently (never pruned by cleanup-reports.sh).
# Usage: monthly-consolidate.sh [deployment-id] [YYYY-MM]
#   deployment-id: defaults to 03002
#   YYYY-MM:       defaults to previous month
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source config (sets ORCHESTRATOR_HOME, DATA_DIR, REPORT_DIR, DEPLOYMENT_ID, etc.)
source "$SCRIPT_DIR/lib/config.sh" "${1:-03002}"

export PATH="$HOME/.local/bin:$PATH"

LOG_DIR="$ORCHESTRATOR_HOME/logs"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [monthly] $*" >&2; }

# ---------------------------------------------------------------------------
# Determine target month
# ---------------------------------------------------------------------------
if [[ -n "${2:-}" ]]; then
    TARGET_MONTH="$2"
    # Validate format YYYY-MM
    if ! [[ "$TARGET_MONTH" =~ ^[0-9]{4}-[0-9]{2}$ ]]; then
        log "ERROR: Invalid month format '$TARGET_MONTH' — expected YYYY-MM (e.g. 2026-02)"
        exit 1
    fi
else
    TARGET_MONTH=$(date -d "last month" +%Y-%m 2>/dev/null || date -v-1m +%Y-%m 2>/dev/null)
    if [[ -z "$TARGET_MONTH" ]]; then
        log "ERROR: Could not compute previous month"
        exit 1
    fi
fi

log "Target month: $TARGET_MONTH (deployment: $DEPLOYMENT_ID)"

# ---------------------------------------------------------------------------
# Check for existing monthly report (idempotent overwrite with warning)
# ---------------------------------------------------------------------------
MONTHLY_FILE="$REPORT_DIR/monthly-${TARGET_MONTH}.md"

if [[ -f "$MONTHLY_FILE" ]]; then
    log "WARNING: Monthly report already exists — will overwrite: $MONTHLY_FILE"
fi

# ---------------------------------------------------------------------------
# Gather daily consolidated reports for the target month
# ---------------------------------------------------------------------------
CONSOLIDATED_FILES=$(ls "$REPORT_DIR"/consolidated-${TARGET_MONTH}-*.md 2>/dev/null || true)

if [[ -z "$CONSOLIDATED_FILES" ]]; then
    log "ERROR: No consolidated reports found for $TARGET_MONTH in $REPORT_DIR"
    exit 1
fi

REPORT_COUNT=$(echo "$CONSOLIDATED_FILES" | wc -l)
log "Found $REPORT_COUNT consolidated report(s) for $TARGET_MONTH"

# ---------------------------------------------------------------------------
# Pre-compute severity distribution from daily reports
# ---------------------------------------------------------------------------
HEALTHY_COUNT=0
WARNING_COUNT=0
CRITICAL_COUNT=0
UNKNOWN_COUNT=0

while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    h=$(grep -c '— HEALTHY$' "$file" 2>/dev/null || echo 0)
    w=$(grep -c '— WARNING$' "$file" 2>/dev/null || echo 0)
    c=$(grep -c '— CRITICAL$' "$file" 2>/dev/null || echo 0)
    u=$(grep -c '— UNKNOWN$' "$file" 2>/dev/null || echo 0)
    HEALTHY_COUNT=$((HEALTHY_COUNT + h))
    WARNING_COUNT=$((WARNING_COUNT + w))
    CRITICAL_COUNT=$((CRITICAL_COUNT + c))
    UNKNOWN_COUNT=$((UNKNOWN_COUNT + u))
done <<< "$CONSOLIDATED_FILES"

TOTAL_CHECKS=$((HEALTHY_COUNT + WARNING_COUNT + CRITICAL_COUNT + UNKNOWN_COUNT))
log "Severity distribution: HEALTHY=$HEALTHY_COUNT WARNING=$WARNING_COUNT CRITICAL=$CRITICAL_COUNT UNKNOWN=$UNKNOWN_COUNT (total=$TOTAL_CHECKS)"

# ---------------------------------------------------------------------------
# Gather trends.json files for the target month (if available)
# ---------------------------------------------------------------------------
TRENDS_CONTENT=""
TRENDS_COUNT=0
for trends_file in "$DATA_DIR"/${TARGET_MONTH}-*/trends.json; do
    [[ ! -f "$trends_file" ]] && continue
    TRENDS_COUNT=$((TRENDS_COUNT + 1))
    TRENDS_CONTENT="${TRENDS_CONTENT}
--- $(basename "$(dirname "$trends_file")") ---
$(cat "$trends_file")
"
done

if [[ "$TRENDS_COUNT" -gt 0 ]]; then
    log "Found $TRENDS_COUNT trends.json file(s)"
else
    log "No trends.json files found for $TARGET_MONTH (will proceed without metric trends)"
    TRENDS_CONTENT="No trends data available for this month."
fi

# ---------------------------------------------------------------------------
# Concatenate all daily consolidated content
# ---------------------------------------------------------------------------
DAILY_CONTENT=""
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    DAILY_CONTENT="${DAILY_CONTENT}
================================================================================
FILE: $(basename "$file")
================================================================================
$(cat "$file")
"
done <<< "$CONSOLIDATED_FILES"

# ---------------------------------------------------------------------------
# Build the AI analysis prompt
# ---------------------------------------------------------------------------
PROMPT="You are JARVIS, producing a monthly health consolidation report for a VisionKing industrial visual inspection system.

DEPLOYMENT: VisionKing ${DEPLOYMENT_ID} (Laminacao/Steel)
MONTH: ${TARGET_MONTH}
ARCHITECTURE: 3-node deployment — vk01/vk02 are processing nodes (GPU inference, camera acquisition, Redis, RabbitMQ), vk03 is dashboard-only (backend, frontend, PostgreSQL).

SEVERITY DISTRIBUTION FOR THE MONTH:
- HEALTHY checks: ${HEALTHY_COUNT}
- WARNING checks: ${WARNING_COUNT}
- CRITICAL checks: ${CRITICAL_COUNT}
- UNKNOWN checks: ${UNKNOWN_COUNT}
- Total checks: ${TOTAL_CHECKS}

DAILY CONSOLIDATED REPORTS (${REPORT_COUNT} days):
${DAILY_CONTENT}

DAILY METRIC TRENDS (${TRENDS_COUNT} days with trends data):
${TRENDS_CONTENT}

REPORT INSTRUCTIONS:
Produce a monthly consolidation report with the following structure. This report will be kept permanently for long-term trend analysis.

# VisionKing ${DEPLOYMENT_ID} — Monthly Report: ${TARGET_MONTH}

## Overview
Executive summary paragraph covering the month's overall health posture, uptime, and key events.

## Severity Distribution
| Severity | Count | Percentage |
Present the pre-computed severity counts in a table with percentages.

## System Availability & Uptime
Estimate availability based on the severity distribution. Note any extended outage periods visible in the daily reports.

## Recurring Issues
Top 3-5 recurring problems observed across the month, with:
- Frequency (how many days affected)
- Current status (resolved / ongoing / intermittent)
- Root cause if identifiable

## Metric Trends
Summarize CPU, RAM, disk, and GPU trends across the month using the trends.json data. Identify any concerning trajectories (e.g., steadily increasing disk usage).

## Key Events & Incidents
Chronological list of significant events (outages, recoveries, deployments, threshold breaches).

## Recommendations Tracker
| # | Recommendation | Status | Notes |
Track recommendations that appeared during the month: resolved, carried forward, or new.

## Risk Assessment
Overall assessment: IMPROVING / STABLE / DEGRADING
Justify with specific data points from the month."

# ---------------------------------------------------------------------------
# Run Claude AI analysis
# ---------------------------------------------------------------------------
log "Running Claude AI monthly consolidation (this may take 2-3 minutes)..."
ANALYSIS_START=$(date +%s)

CLAUDE_STDERR=$(mktemp)
ANALYSIS_OUTPUT=$(echo "$PROMPT" | claude -p \
    --model claude-opus-4-6 \
    --output-format text \
    --no-session-persistence \
    --dangerously-skip-permissions 2>"$CLAUDE_STDERR") || {
    log "ERROR: Claude AI analysis failed (exit code $?)"
    if [[ -s "$CLAUDE_STDERR" ]]; then
        log "ERROR: stderr: $(cat "$CLAUDE_STDERR")"
    fi
    rm -f "$CLAUDE_STDERR"
    exit 1
}
# Append stderr to main log (warnings, progress info)
if [[ -s "$CLAUDE_STDERR" ]]; then
    cat "$CLAUDE_STDERR" >> "$LOG_DIR/cron-vk-health.log"
fi
rm -f "$CLAUDE_STDERR"

ANALYSIS_END=$(date +%s)
ANALYSIS_DURATION=$((ANALYSIS_END - ANALYSIS_START))
log "Monthly consolidation completed in ${ANALYSIS_DURATION}s"

# ---------------------------------------------------------------------------
# Save the monthly report
# ---------------------------------------------------------------------------
echo "$ANALYSIS_OUTPUT" > "$MONTHLY_FILE"
log "Monthly report saved: $MONTHLY_FILE"

# ---------------------------------------------------------------------------
# Log dispatch for dashboard visibility
# ---------------------------------------------------------------------------
if [[ -x "$ORCHESTRATOR_HOME/scripts/helpers/log-dispatch.sh" ]]; then
    "$ORCHESTRATOR_HOME/scripts/helpers/log-dispatch.sh" \
        "vk-monthly" \
        "Monthly consolidation ${TARGET_MONTH} (${REPORT_COUNT} days, ${TOTAL_CHECKS} checks)" \
        "strokmatic.visionking" \
        "claude-opus-4-6" \
        "complete" \
        "$ANALYSIS_DURATION"
    log "Dispatch logged"
fi

log "Monthly consolidation complete for deployment $DEPLOYMENT_ID ($TARGET_MONTH)"
