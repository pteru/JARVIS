#!/bin/bash
# SG3 Compliance Monitor — Orchestrator
# Runs the daily pipeline: 3 collectors in parallel, then sync, then check.
set -uo pipefail   # NOT -e: collector failures must not abort the whole pipeline

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
DATE=$(date +%F)
OUT="$ORCHESTRATOR_HOME/data/sg3-monitor/$DATE"
LOG_DIR="$ORCHESTRATOR_HOME/logs"
mkdir -p "$OUT" "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [run] $*" | tee -a "$LOG_DIR/sg3-monitor.log"; }

cd "$ORCHESTRATOR_HOME"

log "starting collectors in parallel"
node scripts/sg3-monitor/collect-sg3.mjs              "$DATE" > "$OUT/sg3.log"   2>&1 &
node scripts/sg3-monitor/collect-drive-contratos.mjs  "$DATE" > "$OUT/drive.log" 2>&1 &
node scripts/sg3-monitor/collect-emails.mjs           "$DATE" > "$OUT/email.log" 2>&1 &
wait
log "collectors done"

log "syncing sheet"
node scripts/sg3-monitor/sync-sheet.mjs "$DATE" > "$OUT/sync.log" 2>&1 || log "sync exited non-zero"

log "checking expiries"
node scripts/sg3-monitor/check-expiries.mjs "$DATE" > "$OUT/check.log" 2>&1 || log "check exited non-zero"

log "done"
