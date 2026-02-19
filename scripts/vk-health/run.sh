#!/bin/bash
# VK Health Monitor — Orchestrator
# Runs the full pipeline: collect -> analyze -> alert with flock-based locking.
# Usage: run.sh [deployment-id] (default: 03002)
set -euo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_ID="${1:-03002}"

LOG_DIR="$ORCHESTRATOR_HOME/logs"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [run] $*" >&2; }

# ---------------------------------------------------------------------------
# Prevent overlapping runs using flock
# ---------------------------------------------------------------------------
LOCK_FILE="/tmp/vk-health-${DEPLOYMENT_ID}.lock"
exec 200>"$LOCK_FILE"
flock -n 200 || {
    log "Another instance is already running for deployment $DEPLOYMENT_ID"
    exit 0
}

log "Starting health check pipeline for deployment $DEPLOYMENT_ID"
PIPELINE_START=$(date +%s)

# Track exit status across steps
EXIT_STATUS=0

# ---------------------------------------------------------------------------
# Step 1: Collect
# ---------------------------------------------------------------------------
log "Step 1/3: Data collection"
STEP_START=$(date +%s)
if "$SCRIPT_DIR/collect.sh" "$DEPLOYMENT_ID"; then
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "Collection completed in ${STEP_DURATION}s"
else
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "ERROR: Collection failed after ${STEP_DURATION}s"
    EXIT_STATUS=1
fi

# ---------------------------------------------------------------------------
# Step 2: Analyze (only if collection succeeded)
# ---------------------------------------------------------------------------
if [[ "$EXIT_STATUS" -eq 0 ]]; then
    log "Step 2/3: AI analysis"
    STEP_START=$(date +%s)
    if "$SCRIPT_DIR/analyze.sh" "$DEPLOYMENT_ID"; then
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "Analysis completed in ${STEP_DURATION}s"
    else
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "ERROR: Analysis failed after ${STEP_DURATION}s"
        EXIT_STATUS=1
    fi
else
    log "Step 2/3: Skipping analysis (collection failed)"
fi

# ---------------------------------------------------------------------------
# Step 3: Alert (runs even if analysis failed, as long as collection succeeded)
# ---------------------------------------------------------------------------
if [[ -d "$ORCHESTRATOR_HOME/data/vk-health/$DEPLOYMENT_ID/$(date -u +%Y-%m-%d)" ]]; then
    log "Step 3/3: Alert checks"
    STEP_START=$(date +%s)
    if "$SCRIPT_DIR/alert.sh" "$DEPLOYMENT_ID"; then
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "Alert checks completed in ${STEP_DURATION}s"
    else
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "ERROR: Alert checks failed after ${STEP_DURATION}s"
        EXIT_STATUS=1
    fi
else
    log "Step 3/3: Skipping alerts (no snapshot data available)"
fi

# ---------------------------------------------------------------------------
# Log dispatch
# ---------------------------------------------------------------------------
PIPELINE_END=$(date +%s)
PIPELINE_DURATION=$((PIPELINE_END - PIPELINE_START))

if [[ "$EXIT_STATUS" -eq 0 ]]; then
    STATUS="complete"
else
    STATUS="partial"
fi

log "Pipeline ${STATUS} in ${PIPELINE_DURATION}s"

LOG_DISPATCH="$ORCHESTRATOR_HOME/scripts/helpers/log-dispatch.sh"
if [[ -x "$LOG_DISPATCH" ]]; then
    "$LOG_DISPATCH" \
        "vk-health" \
        "Health check ${DEPLOYMENT_ID}" \
        "strokmatic.visionking" \
        "opus" \
        "$STATUS" \
        "$PIPELINE_DURATION" || log "WARNING: Failed to log dispatch"
else
    log "WARNING: log-dispatch.sh not found at $LOG_DISPATCH"
fi

exit "$EXIT_STATUS"
