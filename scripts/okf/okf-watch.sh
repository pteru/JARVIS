#!/usr/bin/env bash
# OKF daily watch (cron, report-only): cascade backlog, conformance,
# dead links, journal hygiene.
#
# Alerts via Telegram (domain "okf-watch") when:
#   1) any cascade topic has >=1 unabsorbed journal entry (entries older than
#      3 days are flagged);
#   2) OKF conformance drops below 100%;
#   3) NEW dead links appear vs the persisted baseline (ratchet: baseline
#      auto-lowers when links are fixed, never rises on its own);
#   4) journal hygiene drifts: pages missing from an index.md, or journal
#      entries whose tags match NO roster topic (invisible to specialist
#      boots and cascade).
# Never writes to any repo (state lives in logs/). Exit 0 always (cron-safe).
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

# --- 3) Dead links vs baseline (ratchet) -------------------------------------
LINT_OUT=$(python3 scripts/okf/okf.py lint 2>/dev/null || true)
BASELINE_FILE="logs/okf-watch-deadlinks.baseline"
CURRENT=$(grep 'dead link' <<<"$LINT_OUT" | sed 's/^ *! //' | sort -u || true)
if [[ ! -f "$BASELINE_FILE" ]]; then
    printf '%s\n' "$CURRENT" > "$BASELINE_FILE"
    echo "$(date -Is) dead-link baseline initialized ($(grep -c . "$BASELINE_FILE") links)"
else
    NEW_LINKS=$(comm -13 "$BASELINE_FILE" <(printf '%s\n' "$CURRENT") | grep . || true)
    if [[ -n "$NEW_LINKS" ]]; then
        MSG+=$'\n'"🔗 Dead links NOVOS (vs baseline):"$'\n'"${NEW_LINKS}"$'\n'
    fi
    # ratchet down: fixed links shrink the baseline automatically
    if [[ $(grep -c . <<<"$CURRENT") -lt $(grep -c . "$BASELINE_FILE") && -z "$NEW_LINKS" ]]; then
        printf '%s\n' "$CURRENT" > "$BASELINE_FILE"
        echo "$(date -Is) dead-link baseline lowered to $(grep -c . "$BASELINE_FILE")"
    fi
fi

# --- 4) Journal hygiene (report-only) ----------------------------------------
MISSING_IDX=$(grep 'missing entry for' <<<"$LINT_OUT" | sed 's/^ *! //' || true)
if [[ -n "$MISSING_IDX" ]]; then
    MSG+=$'\n'"🗂️ Páginas fora do index (rodar okf.py index no diretório):"$'\n'"${MISSING_IDX}"$'\n'
fi
ORPHANS=$(python3 - <<'PYEOF' 2>/dev/null || true
import sys
sys.path.insert(0, "scripts/okf")
from pathlib import Path
import cascade
topics = {r["topic"] for r in cascade.load_rows(Path("journal/CASCADE.md"))}
for name, tags in cascade.journal_entries(Path("journal")):
    if not topics & set(tags):
        print(f"{name} (tags: {', '.join(tags) or 'nenhuma'})")
PYEOF
)
if [[ -n "$ORPHANS" ]]; then
    MSG+=$'\n'"🏷️ Entradas de journal órfãs (sem tag de tópico do roster):"$'\n'"${ORPHANS}"$'\n'
fi
RECUR=$(python3 - <<'PYEOF' 2>/dev/null || true
import sys
sys.path.insert(0, "scripts/okf")
from collections import Counter
from pathlib import Path
import cascade
j = Path("journal")
known = cascade.roster_topics(j) | {r["topic"] for r in cascade.load_rows(j / "CASCADE.md")}
counts = Counter(tags[0] for _, tags in cascade.journal_entries(j)
                 if tags and tags[0] not in known)
for tag, n in sorted(counts.items()):
    if n >= 2:
        print(f"{tag}: {n} entradas — candidato a especialista "
              f"(new_specialist.py {tag} --class ... --terms ... --tags \"{tag},...\")")
PYEOF
)
if [[ -n "$RECUR" ]]; then
    MSG+=$'\n'"🌱 Temas emergentes recorrentes (aprovar criação de especialista?):"$'\n'"${RECUR}"$'\n'
fi

# --- send --------------------------------------------------------------------
if [[ -n "$MSG" ]]; then
    HTTP_CODE=$(send_telegram_routed "okf-watch" "$MSG")
    echo "$(date -Is) alert sent (http ${HTTP_CODE})"
else
    echo "$(date -Is) ok — sem backlog de cascade, conformidade 100%"
fi
exit 0
