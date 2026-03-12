#!/bin/bash
# PR Review Service — Pipeline Orchestrator
# Runs the full pipeline: fetch → detect → review → report → upload → chat → notify → housekeep
# Uses flock-based locking to prevent overlapping runs.
# Designed to run via cron every 5 minutes on 192.168.15.2.
#
# Usage: run.sh [--force]
#   --force    Skip change detection, review all eligible PRs
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_DIR="${SERVICE_DIR:-$SCRIPT_DIR}"
source "$SCRIPT_DIR/lib/config.sh"

LOG_FILE="$LOGS_DIR/run-$(date +%Y-%m-%d).log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [run] $*" | tee -a "$LOG_FILE" >&2; }

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
    FORCE=true
fi

# ─── Prevent overlapping runs ────────────────────────────────────────────────
LOCK_FILE="/tmp/jarvis-pr-review.lock"
exec 200>"$LOCK_FILE"
flock -n 200 || {
    log "Another instance is already running"
    exit 0
}

# ─── Gate 1: Internet connectivity ───────────────────────────────────────────
log "Gate 1: Checking internet connectivity"
if ! ping -c 1 -W 3 api.github.com &>/dev/null; then
    log "ERROR: Cannot reach api.github.com — aborting"
    exit 1
fi

# ─── Gate 2: Claude CLI available ────────────────────────────────────────────
log "Gate 2: Checking Claude CLI"
if ! command -v claude &>/dev/null; then
    log "ERROR: claude CLI not found in PATH"
    exit 1
fi

# ─── Gate 3: gh CLI available and authenticated ──────────────────────────────
log "Gate 3: Checking gh CLI"
if ! command -v gh &>/dev/null; then
    log "ERROR: gh CLI not found in PATH"
    exit 1
fi
if ! gh auth status &>/dev/null; then
    log "ERROR: gh CLI not authenticated"
    exit 1
fi

# ─── Pipeline start ─────────────────────────────────────────────────────────
log "=== PR Review Pipeline START ==="
PIPELINE_START=$(date +%s)
EXIT_STATUS=0
NEW_REVIEWS=0

# ─── Step 1: Fetch open PRs ─────────────────────────────────────────────────
log "Step 1/8: Fetching open PRs"
STEP_START=$(date +%s)
if "$SCRIPT_DIR/fetch-open-prs.sh" >> "$LOG_FILE" 2>&1; then
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "Fetch completed in ${STEP_DURATION}s"
else
    STEP_DURATION=$(($(date +%s) - STEP_START))
    log "ERROR: Fetch failed after ${STEP_DURATION}s"
    EXIT_STATUS=1
fi

# ─── Step 2: Detect changes ─────────────────────────────────────────────────
CHANGES_DETECTED=false

if [[ "$EXIT_STATUS" -ne 0 ]]; then
    log "Step 2/8: Skipping detection (fetch failed)"
elif [[ "$FORCE" == "true" ]]; then
    log "Step 2/8: Force mode — skipping detection"
    CHANGES_DETECTED=true
elif [[ ! -f "$PREV_INBOX_FILE" ]]; then
    log "Step 2/8: No previous inbox — treating as changed"
    CHANGES_DETECTED=true
else
    log "Step 2/8: Detecting changes"
    CHANGES_DETECTED=$(node -e "
        const fs = require('fs');
        const prev = JSON.parse(fs.readFileSync('$PREV_INBOX_FILE', 'utf-8'));
        const curr = JSON.parse(fs.readFileSync('$INBOX_FILE', 'utf-8'));
        const prevMap = new Map((prev.pull_requests || []).map(p => [p.repo + '#' + p.number, p.updated_at]));
        const changed = (curr.pull_requests || []).filter(p => {
            const key = p.repo + '#' + p.number;
            return prevMap.get(key) !== p.updated_at;
        });
        const removed = (prev.pull_requests || []).filter(p => {
            const key = p.repo + '#' + p.number;
            return !(curr.pull_requests || []).some(c => c.repo === p.repo && c.number === p.number);
        });
        if (changed.length > 0 || removed.length > 0) {
            console.log('true');
            if (changed.length > 0) console.error('Changed PRs: ' + changed.map(p => p.repo + '#' + p.number).join(', '));
            if (removed.length > 0) console.error('Closed PRs: ' + removed.map(p => p.repo + '#' + p.number).join(', '));
        } else {
            console.log('false');
        }
    " 2>> "$LOG_FILE" || echo "true")
fi

if [[ "$CHANGES_DETECTED" != "true" && "$EXIT_STATUS" -eq 0 ]]; then
    log "No changes detected — pipeline complete (early exit)"
    # Still rotate inbox
    cp -f "$INBOX_FILE" "$PREV_INBOX_FILE" 2>/dev/null || true
    # Send heartbeat if needed
    "$SCRIPT_DIR/notify.sh" heartbeat >> "$LOG_FILE" 2>&1 || true
    PIPELINE_DURATION=$(($(date +%s) - PIPELINE_START))
    log "=== PR Review Pipeline END (${PIPELINE_DURATION}s, no changes) ==="
    exit 0
fi

# ─── Step 3: Review PRs ─────────────────────────────────────────────────────
if [[ "$EXIT_STATUS" -eq 0 ]]; then
    log "Step 3/8: Reviewing PRs"
    STEP_START=$(date +%s)

    # Snapshot review count before running
    REVIEWS_BEFORE=0
    if [[ -d "$REVIEWS_DIR" ]]; then
        REVIEWS_BEFORE=$(find "$REVIEWS_DIR" -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
    fi
    # Mark time before reviews start (for mtime comparison)
    REVIEW_TIMESTAMP=$(date +%s)

    if "$SCRIPT_DIR/review-pr.sh" --all >> "$LOG_FILE" 2>&1; then
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "Review completed in ${STEP_DURATION}s"
    else
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "WARNING: Review had failures after ${STEP_DURATION}s"
        # Don't set EXIT_STATUS — partial reviews are still useful
    fi

    # Count reviews written/updated during this run (mtime >= REVIEW_TIMESTAMP)
    NEW_REVIEWS=0
    if [[ -d "$REVIEWS_DIR" ]]; then
        NEW_REVIEWS=$(find "$REVIEWS_DIR" -name '*.md' -type f -newermt "@${REVIEW_TIMESTAMP}" 2>/dev/null | wc -l | tr -d ' ')
    fi
    # Fallback: if find -newermt not supported, compare total counts
    if [[ "$NEW_REVIEWS" -eq 0 ]]; then
        REVIEWS_AFTER=$(find "$REVIEWS_DIR" -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
        NEW_REVIEWS=$((REVIEWS_AFTER - REVIEWS_BEFORE))
        if [[ $NEW_REVIEWS -lt 0 ]]; then NEW_REVIEWS=0; fi
    fi
    log "New reviews generated: $NEW_REVIEWS"
fi

# ─── Step 4: Build inbox report ─────────────────────────────────────────────
if [[ "$EXIT_STATUS" -eq 0 ]]; then
    log "Step 4/8: Building inbox report"
    STEP_START=$(date +%s)
    if node "$SCRIPT_DIR/build-inbox.mjs" >> "$LOG_FILE" 2>&1; then
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "Report built in ${STEP_DURATION}s"
    else
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "ERROR: Report build failed after ${STEP_DURATION}s"
        EXIT_STATUS=1
    fi
fi

# ─── Step 5: Upload to Google Drive ─────────────────────────────────────────
if [[ "$EXIT_STATUS" -eq 0 ]]; then
    log "Step 5/8: Uploading to Google Drive"
    STEP_START=$(date +%s)
    if node "$SCRIPT_DIR/upload-to-drive.mjs" >> "$LOG_FILE" 2>&1; then
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "Upload completed in ${STEP_DURATION}s"
    else
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "WARNING: Upload failed after ${STEP_DURATION}s (non-fatal)"
        # Don't set EXIT_STATUS — Drive upload failure is non-fatal
    fi
fi

# ─── Step 6: Google Chat DMs ────────────────────────────────────────────────
if [[ "$EXIT_STATUS" -eq 0 && "$NEW_REVIEWS" -gt 0 ]]; then
    log "Step 6/8: Sending Google Chat DMs"
    STEP_START=$(date +%s)
    if node "$SCRIPT_DIR/notify-chat.mjs" >> "$LOG_FILE" 2>&1; then
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "Chat notifications sent in ${STEP_DURATION}s"
    else
        STEP_DURATION=$(($(date +%s) - STEP_START))
        log "WARNING: Chat notifications failed after ${STEP_DURATION}s (non-fatal)"
    fi
else
    log "Step 6/8: Skipping Chat DMs (no new reviews)"
fi

# ─── Step 7: Telegram summary ───────────────────────────────────────────────
if [[ "$NEW_REVIEWS" -gt 0 ]]; then
    log "Step 7/8: Sending Telegram summary"
    if "$SCRIPT_DIR/notify.sh" summary >> "$LOG_FILE" 2>&1; then
        log "Telegram notification sent"
    else
        log "WARNING: Telegram notification failed (non-fatal)"
    fi
else
    log "Step 7/8: Sending heartbeat"
    "$SCRIPT_DIR/notify.sh" heartbeat >> "$LOG_FILE" 2>&1 || true
fi

# ─── Step 8: Housekeeping ───────────────────────────────────────────────────
log "Step 8/8: Housekeeping"

# Rotate inbox
cp -f "$INBOX_FILE" "$PREV_INBOX_FILE" 2>/dev/null || true

# Clean up uploaded reviews marker
rm -f "$DATA_DIR/last-uploaded-reviews.json" 2>/dev/null || true

# Update state file
node -e "
    const fs = require('fs');
    const stateFile = '$STATE_FILE';
    const state = fs.existsSync(stateFile)
        ? JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
        : {};
    state.last_run = new Date().toISOString();
    state.last_status = '$EXIT_STATUS' === '0' ? 'success' : 'partial';
    state.last_new_reviews = parseInt('$NEW_REVIEWS') || 0;
    state.total_runs = (state.total_runs || 0) + 1;
    state.total_reviews = (state.total_reviews || 0) + (parseInt('$NEW_REVIEWS') || 0);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
" 2>/dev/null || true

# Trim old log files (keep 7 days)
find "$LOGS_DIR" -name 'run-*.log' -mtime +7 -delete 2>/dev/null || true

# ─── Pipeline complete ───────────────────────────────────────────────────────
PIPELINE_END=$(date +%s)
PIPELINE_DURATION=$((PIPELINE_END - PIPELINE_START))

if [[ "$EXIT_STATUS" -eq 0 ]]; then
    STATUS="success"
else
    STATUS="partial"
fi

log "=== PR Review Pipeline END (${PIPELINE_DURATION}s, ${STATUS}, ${NEW_REVIEWS} new reviews) ==="
exit "$EXIT_STATUS"
