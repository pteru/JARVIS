#!/usr/bin/env bash
# OKF daily watch (cron, report-only): cascade backlog + conformance regression.
#
# Alerts via Telegram (domain "okf-watch") when:
#   1) any cascade topic has >=1 unabsorbed journal entry (entries older than
#      3 days are flagged), or
#   2) OKF conformance drops below 100%.
# Never writes to any repo. Exit 0 always (cron-safe).
set -uo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-/home/teruel/JARVIS}"
cd "$ORCHESTRATOR_HOME"
# shellcheck source=scripts/lib/telegram-router.sh
source scripts/lib/telegram-router.sh

MSG=""

# --- 1) Cascade backlog: >=1 unabsorbed entry alerts; >3 days flagged -------
BACKLOG=$(python3 scripts/okf/cascade.py status --quiet 2>/dev/null || true)
if [[ -n "$BACKLOG" ]]; then
    CUTOFF=$(date -d '3 days ago' +%Y-%m-%d)
    FLAGGED=""
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        flag=""
        for f in $(grep -oE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' <<<"$line"); do
            if [[ "$f" < "$CUTOFF" ]]; then
                flag=" ⚠️ >3d"
                break
            fi
        done
        FLAGGED+="${line}${flag}"$'\n'
    done <<<"$BACKLOG"
    MSG+="📥 Cascade backlog (rodar /okf-cascade):"$'\n'"${FLAGGED}"
fi

# --- 2) Conformance regression: expected 100% -------------------------------
PCT=$(python3 scripts/okf/okf.py lint --pct-only 2>/dev/null || echo "erro")
if [[ "$PCT" != "100" ]]; then
    PROBLEMS=$(python3 scripts/okf/okf.py lint 2>/dev/null \
        | grep -E "missing/empty 'type'|no parseable frontmatter" | head -10 || true)
    MSG+=$'\n'"🔴 Conformidade OKF: ${PCT}% (esperado 100)"$'\n'"${PROBLEMS}"$'\n'
fi

# --- send --------------------------------------------------------------------
if [[ -n "$MSG" ]]; then
    HTTP_CODE=$(send_telegram_routed "okf-watch" "$MSG")
    echo "$(date -Is) alert sent (http ${HTTP_CODE})"
else
    echo "$(date -Is) ok — sem backlog de cascade, conformidade 100%"
fi
exit 0
