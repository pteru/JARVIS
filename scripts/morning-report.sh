#!/bin/bash
# JARVIS Morning Report — runs claude CLI with /jarvis prompt, sends summary via Telegram
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$ORCHESTRATOR_HOME/config/orchestrator/notifications.json"
LOG_DIR="$ORCHESTRATOR_HOME/logs"
REPORT_DIR="$ORCHESTRATOR_HOME/reports/morning"
DATE=$(date +%Y-%m-%d)

mkdir -p "$LOG_DIR" "$REPORT_DIR"

log() { echo "[$(date +%H:%M:%S)] $1" >> "$LOG_DIR/cron-morning.log"; }

log "Starting JARVIS morning report"

# Pull the top open backlog issues from the GitHub Issues cache (populated by the
# refresh-backlog-cache cron). GitHub is the source of truth; the old workspace-local
# backlog stub files are retired.
backlog_top() {
  node "$SCRIPT_DIR/lib/backlog-source.mjs" list "$1" --json 2>/dev/null \
    | jq -r '.[:3][] | "- #\(.number) \(.title)"' 2>/dev/null || true
}
VK_ITEMS="$(backlog_top strokmatic/visionking)"
DM_ITEMS="$(backlog_top strokmatic/diemaster)"
[[ -z "$VK_ITEMS" ]] && VK_ITEMS="- (none open)"
[[ -z "$DM_ITEMS" ]] && DM_ITEMS="- (none open)"

# Generate the report using claude CLI in non-interactive mode
REPORT=$(claude -p \
  --model haiku \
  --dangerously-skip-permissions \
  --no-session-persistence \
  --output-format text \
  "IMPORTANT: Output ONLY the report below, with no preamble, no thinking, no commentary before or after. Start directly with the --- line.

You are JARVIS. Generate a concise morning briefing for sir. Read these files and produce a Telegram-friendly plain text report (no markdown special chars, use simple dashes and arrows):

1. /home/teruel/JARVIS/config/orchestrator/workspaces.json — count workspaces by product
2. /home/teruel/JARVIS/workspaces/strokmatic/spotfusion/.claude/context.md — SpotFusion status
3. /home/teruel/JARVIS/reports/vk-health/03002/latest.md — Latest VisionKing health analysis (if exists)
4. /home/teruel/JARVIS/reports/vk-health/03002/improvements.md — Recent improvement suggestions (last 5 entries)

HIGH-PRIORITY BACKLOG (from GitHub Issues — use these verbatim for the HIGH-PRIORITY ITEMS section; do not invent others):
VisionKing:
${VK_ITEMS}
DieMaster:
${DM_ITEMS}

Also run 'git -C /home/teruel/JARVIS status --short' and 'git -C /home/teruel/JARVIS log --oneline -3' to get repo status.

Format the report as:
---
Good morning, sir. JARVIS daily briefing for DATE.

SYSTEMS STATUS:
- Orchestrator: branch, clean/dirty
- Workspaces: N registered (X VisionKing, Y SpotFusion, Z DieMaster, W SDK)

HIGH-PRIORITY ITEMS:
- VisionKing: list top 3 items (ID + short desc)
- DieMaster: list top 3 items (ID + short desc)

VK PRODUCTION HEALTH:
- Overall status: HEALTHY/WARNING/CRITICAL
- Key findings: (1-2 most important items from latest analysis)
- Open improvements: N items pending

RECENT ACTIVITY:
- last 3 commits

Ready when you are, sir.
---
Keep it under 800 characters total." 2>>"$LOG_DIR/cron-morning.log") || {
  log "ERROR: claude CLI failed"
  REPORT="JARVIS morning report failed - claude CLI error. Check logs at $LOG_DIR/cron-morning.log"
}

# Save report to file
echo "$REPORT" > "$REPORT_DIR/morning-${DATE}.txt"
log "Report saved to $REPORT_DIR/morning-${DATE}.txt"

# Send via Telegram
ROUTER_PATH="$ORCHESTRATOR_HOME/scripts/lib/telegram-router.sh"
if [[ -f "$ROUTER_PATH" ]]; then
  source "$ROUTER_PATH"
  resolve_telegram_route "morning-report"
  BOT_TOKEN="$RESOLVED_BOT_TOKEN"
  CHAT_ID="$RESOLVED_CHAT_ID"
else
  # Legacy fallback: inline node-based resolution
  BOT_TOKEN=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf-8'));const tg=c.backends.telegram;if(tg.bot_token){console.log(tg.bot_token)}else if(tg.bot_token_file){console.log(require('fs').readFileSync(tg.bot_token_file.replace(/^~/,process.env.HOME),'utf-8').trim())}" 2>/dev/null)
  CHAT_ID=$(node -e "const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf-8'));console.log(c.backends.telegram.chat_id)" 2>/dev/null)
fi

if [[ -n "$BOT_TOKEN" && -n "$CHAT_ID" ]]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "$(node -e "console.log(JSON.stringify({chat_id:'$CHAT_ID',text:require('fs').readFileSync('/dev/stdin','utf-8').slice(0,4000)}))" <<< "$REPORT")")

  if [[ "$HTTP_CODE" == "200" ]]; then
    log "Telegram notification sent successfully"
  else
    log "ERROR: Telegram send failed with HTTP $HTTP_CODE"
  fi
else
  log "ERROR: Could not read Telegram config from $CONFIG"
fi

log "Morning report complete"
