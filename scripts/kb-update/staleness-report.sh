#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"

echo "[$(date -Iseconds)] Staleness report starting" >> "$KB_LOG"

REPORT_FILE="${ORCHESTRATOR_HOME}/reports/kb-staleness-$(date +%Y-%m-%d).md"
STALE_COUNT=0
NOW_EPOCH=$(date +%s)

cat > "$REPORT_FILE" << 'HEADER'
# Relatorio de Obsolescencia — KB

> Gerado automaticamente pelo JARVIS

## Paginas Potencialmente Desatualizadas

| Pagina | Ultima Atualizacao | Limiar (dias) | Gap (dias) | Status |
|--------|-------------------|---------------|------------|--------|
HEADER

# Scan all KB pages
find "$KB_REPO_PATH" -name "*.md" -not -path "*/.git/*" -not -name "kb-updates.json" | sort | while read -r page; do
  REL_PATH="${page#$KB_REPO_PATH/}"

  # Determine page type for threshold
  PAGE_TYPE="default"
  case "$REL_PATH" in
    */servicos/*) PAGE_TYPE="servicos" ;;
    */arquitetura*) PAGE_TYPE="arquitetura" ;;
    */deploys/*) PAGE_TYPE="deploys" ;;
    operacoes/*) PAGE_TYPE="operacoes" ;;
    pmo/*) PAGE_TYPE="pmo" ;;
    referencias/*) PAGE_TYPE="referencias" ;;
    decisoes/*) PAGE_TYPE="decisoes" ;;
  esac

  THRESHOLD=$(jq -r --arg type "$PAGE_TYPE" '.thresholds_days[$type] // .thresholds_days.default' "$KB_STALENESS" 2>/dev/null || echo 30)

  # Get page last modified date from git
  PAGE_DATE=$(git -C "$KB_REPO_PATH" log -1 --format="%aI" -- "$REL_PATH" 2>/dev/null || echo "")
  [ -z "$PAGE_DATE" ] && continue

  PAGE_EPOCH=$(date -d "$PAGE_DATE" +%s 2>/dev/null || continue)
  GAP_DAYS=$(( (NOW_EPOCH - PAGE_EPOCH) / 86400 ))

  if [ "$GAP_DAYS" -gt "$THRESHOLD" ]; then
    STATUS="DESATUALIZADA"
    STALE_COUNT=$((STALE_COUNT + 1))
  else
    continue  # Only show stale pages
  fi

  SHORT_DATE=$(date -d "$PAGE_DATE" +%Y-%m-%d)
  echo "| \`$REL_PATH\` | $SHORT_DATE | $THRESHOLD | $GAP_DAYS | $STATUS |" >> "$REPORT_FILE"
done

# Add pending updates section
PENDING=$(jq -r '.updates[] | select(.status == "pending") | "\(.page) (\(.feed), \(.timestamp[:10]))"' "$KB_UPDATES_FILE" 2>/dev/null || true)
if [ -n "$PENDING" ]; then
  echo "" >> "$REPORT_FILE"
  echo "## Atualizacoes Pendentes (detectadas mas nao aplicadas)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "$PENDING" | while read -r line; do
    echo "- $line" >> "$REPORT_FILE"
  done
fi

echo "" >> "$REPORT_FILE"
echo "---" >> "$REPORT_FILE"
echo "*Gerado em $(date -Iseconds) por JARVIS*" >> "$REPORT_FILE"

echo "[$(date -Iseconds)] Staleness report: $STALE_COUNT stale pages found -> $REPORT_FILE" >> "$KB_LOG"
