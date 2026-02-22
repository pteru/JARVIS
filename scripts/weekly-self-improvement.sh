#!/usr/bin/env bash
# JARVIS — Weekly Self-Improvement Analysis
# Runs the self-improvement-miner analyzers directly and generates a report.
# Cron: 0 22 * * 0  (Sunday at 22:00)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [self-improvement] $*" >&2; }

REPORT_DIR="${ORCHESTRATOR_HOME}/reports/self-improvement"
mkdir -p "$REPORT_DIR"

log "Starting weekly self-improvement analysis..."

# Run the standalone report generator
node "${ORCHESTRATOR_HOME}/scripts/generate-self-improvement-report.mjs" 2>&1

REPORT_FILE="${REPORT_DIR}/report-$(date '+%Y-%m-%d').md"
if [[ -f "$REPORT_FILE" ]]; then
    log "Report generated: $REPORT_FILE"

    # Copy as latest
    cp "$REPORT_FILE" "${REPORT_DIR}/latest.md"
    log "Updated latest.md"

    # Cleanup old reports (keep 12 weeks)
    find "$REPORT_DIR" -name 'report-*.md' -mtime +84 -delete 2>/dev/null || true
else
    log "WARN: Report file not found at $REPORT_FILE"
fi

log "Weekly self-improvement analysis complete"
