#!/bin/bash
# Send Telegram summary notification when new reviews are ready.
# Includes cooldown to avoid spamming and heartbeat support.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [notify] $*"; }

# ─── Telegram helpers ─────────────────────────────────────────────────────────

load_telegram_config() {
    if [[ ! -f "$NOTIFICATIONS_CONFIG" ]]; then
        log "ERROR: Notifications config not found at $NOTIFICATIONS_CONFIG"
        return 1
    fi

    TELEGRAM_ENABLED=$(node -e "
        const c = JSON.parse(require('fs').readFileSync('$NOTIFICATIONS_CONFIG','utf-8'));
        console.log(c.telegram?.enabled === true ? 'true' : 'false');
    " 2>/dev/null || echo "false")

    if [[ "$TELEGRAM_ENABLED" != "true" ]]; then
        log "Telegram notifications disabled"
        return 1
    fi

    TELEGRAM_CHAT_ID=$(node -e "
        const c = JSON.parse(require('fs').readFileSync('$NOTIFICATIONS_CONFIG','utf-8'));
        console.log(c.telegram?.chat_id || '');
    " 2>/dev/null || echo "")

    local token_file
    token_file=$(node -e "
        const c = JSON.parse(require('fs').readFileSync('$NOTIFICATIONS_CONFIG','utf-8'));
        const f = c.telegram?.bot_token_file || '';
        console.log(f.replace('~', process.env.HOME));
    " 2>/dev/null || echo "")

    if [[ -z "$TELEGRAM_CHAT_ID" || -z "$token_file" || ! -f "$token_file" ]]; then
        log "ERROR: Telegram config incomplete (chat_id or token file missing)"
        return 1
    fi

    TELEGRAM_BOT_TOKEN=$(cat "$token_file")
    return 0
}

send_telegram() {
    local message="$1"
    local url="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "$url" \
        -H "Content-Type: application/json" \
        -d "$(node -e "
            console.log(JSON.stringify({
                chat_id: '$TELEGRAM_CHAT_ID',
                text: process.argv[1],
                parse_mode: 'Markdown'
            }));
        " "$message")")

    echo "$http_code"
}

# ─── Cooldown check ──────────────────────────────────────────────────────────

NOTIFY_STATE_FILE="$DATA_DIR/notify-state.json"

check_cooldown() {
    local cooldown_minutes="${1:-30}"

    if [[ ! -f "$NOTIFY_STATE_FILE" ]]; then
        return 0  # No state, proceed
    fi

    local last_sent
    last_sent=$(node -e "
        const s = JSON.parse(require('fs').readFileSync('$NOTIFY_STATE_FILE','utf-8'));
        console.log(s.last_sent || '');
    " 2>/dev/null || echo "")

    if [[ -z "$last_sent" ]]; then
        return 0
    fi

    local last_epoch
    last_epoch=$(date -d "$last_sent" +%s 2>/dev/null || echo 0)
    local now_epoch
    now_epoch=$(date +%s)
    local cooldown_secs=$((cooldown_minutes * 60))

    if [[ $((now_epoch - last_epoch)) -lt $cooldown_secs ]]; then
        return 1  # Still in cooldown
    fi

    return 0
}

update_notify_state() {
    local reviews_sent="$1"
    node -e "
        const fs = require('fs');
        const state = fs.existsSync('$NOTIFY_STATE_FILE')
            ? JSON.parse(fs.readFileSync('$NOTIFY_STATE_FILE','utf-8'))
            : {};
        state.last_sent = new Date().toISOString();
        state.last_reviews_count = parseInt(process.argv[1]) || 0;
        state.total_sent = (state.total_sent || 0) + 1;
        fs.writeFileSync('$NOTIFY_STATE_FILE', JSON.stringify(state, null, 2));
    " "$reviews_sent"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

MODE="${1:-summary}"  # "summary" or "heartbeat"

if ! load_telegram_config; then
    exit 0
fi

if [[ "$MODE" == "heartbeat" ]]; then
    # Heartbeat mode — check every 6 hours
    if ! check_cooldown 360; then
        log "Heartbeat suppressed (cooldown active)"
        exit 0
    fi

    # Count open PRs and reviews
    OPEN_PRS=0
    REVIEWED=0
    if [[ -f "$INBOX_FILE" ]]; then
        OPEN_PRS=$(node -e "
            const d = JSON.parse(require('fs').readFileSync('$INBOX_FILE','utf-8'));
            console.log((d.pull_requests || []).length);
        " 2>/dev/null || echo "0")
    fi
    if [[ -d "$REVIEWS_DIR" ]]; then
        REVIEWED=$(find "$REVIEWS_DIR" -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
    fi

    MSG=$(printf '\xF0\x9F\x9F\xA2')  # Green circle
    MSG+=" *PR Review Service — Heartbeat*"
    MSG+=$'\n'"${OPEN_PRS} open PRs, ${REVIEWED} reviewed."
    MSG+=$'\n'"_$(date '+%Y-%m-%d %H:%M') — $(hostname)_"

    HTTP_CODE=$(send_telegram "$MSG")
    if [[ "$HTTP_CODE" == "200" ]]; then
        log "Heartbeat sent"
        update_notify_state 0
    else
        log "ERROR: Heartbeat failed (HTTP $HTTP_CODE)"
    fi
    exit 0
fi

# Summary mode — notify about newly reviewed PRs
UPLOADED_FILE="$DATA_DIR/last-uploaded-reviews.json"

if [[ ! -f "$UPLOADED_FILE" ]]; then
    log "No recent uploads to notify about"
    exit 0
fi

REVIEW_COUNT=$(node -e "
    const d = JSON.parse(require('fs').readFileSync('$UPLOADED_FILE','utf-8'));
    console.log((d.reviews || []).length);
" 2>/dev/null || echo "0")

if [[ "$REVIEW_COUNT" -eq 0 ]]; then
    log "No new reviews to notify about"
    exit 0
fi

if ! check_cooldown 30; then
    log "Notification suppressed (cooldown active)"
    exit 0
fi

# Build summary message
REVIEW_LINES=$(node -e "
    const fs = require('fs');
    const uploaded = JSON.parse(fs.readFileSync('$UPLOADED_FILE','utf-8'));
    const reviewsDir = '$REVIEWS_DIR';
    const lines = [];
    for (const f of (uploaded.reviews || [])) {
        const path = reviewsDir + '/' + f;
        if (!fs.existsSync(path)) continue;
        const content = fs.readFileSync(path, 'utf-8');
        const vm = content.match(/## Verdict\s*\n+\**(APPROVE|APPROVE WITH COMMENTS|CHANGES REQUESTED)\**/i);
        const verdict = vm ? vm[1] : 'REVIEWED';
        const name = f.replace('.md', '');
        const emoji = verdict === 'APPROVE' ? '\u2705'
            : verdict === 'APPROVE WITH COMMENTS' ? '\u2705'
            : verdict === 'CHANGES REQUESTED' ? '\u274C'
            : '\u2139\uFE0F';
        lines.push(emoji + ' ' + name + ': ' + verdict);
    }
    console.log(lines.join('\n'));
" 2>/dev/null || echo "")

# Get Drive folder link
DRIVE_LINK=""
if [[ -f "$DATA_DIR/upload-state.json" ]]; then
    FOLDER_ID=$(node -e "
        const d = JSON.parse(require('fs').readFileSync('$DATA_DIR/upload-state.json','utf-8'));
        console.log(d.folder_id || '');
    " 2>/dev/null || echo "")
    if [[ -n "$FOLDER_ID" ]]; then
        DRIVE_LINK="https://drive.google.com/drive/folders/${FOLDER_ID}"
    fi
fi

MSG=$(printf '\xF0\x9F\x93\x8B')  # Clipboard
MSG+=" *PR Review Service — ${REVIEW_COUNT} new review(s)*"
MSG+=$'\n'
MSG+=$'\n'"${REVIEW_LINES}"
if [[ -n "$DRIVE_LINK" ]]; then
    MSG+=$'\n'$'\n'"[View on Google Drive](${DRIVE_LINK})"
fi
MSG+=$'\n'"_$(date '+%Y-%m-%d %H:%M')_"

HTTP_CODE=$(send_telegram "$MSG")
if [[ "$HTTP_CODE" == "200" ]]; then
    log "Summary notification sent ($REVIEW_COUNT reviews)"
    update_notify_state "$REVIEW_COUNT"
else
    log "ERROR: Notification failed (HTTP $HTTP_CODE)"
fi
