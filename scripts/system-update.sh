#!/usr/bin/env bash
# JARVIS — System Update
# Consolidated update script for all JARVIS subsystems.
# Usage: system-update.sh [--full] [--data] [--libs] [--docker] [--ai]
#                         [--skip TARGET] [--only TARGET] [--dry-run] [--quiet]
#
# Default (no flags): runs data + libs groups.
# --full: runs all groups (data + libs + docker + ai).
# Groups can be combined: --data --docker
# --skip/--only accept target names (e.g., --skip apt --skip vk-health)
# --dry-run: show what would run without executing
# --quiet: minimal output (for cron)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"

# ─── Defaults ────────────────────────────────────────────────────────────────

DRY_RUN=false
QUIET=false
FULL=false
declare -A GROUP_ENABLED=()
declare -a SKIP_TARGETS=()
declare -a ONLY_TARGETS=()

# ─── Argument parsing ────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)     FULL=true; shift ;;
    --data)     GROUP_ENABLED[data]=1; shift ;;
    --libs)     GROUP_ENABLED[libs]=1; shift ;;
    --docker)   GROUP_ENABLED[docker]=1; shift ;;
    --ai)       GROUP_ENABLED[ai]=1; shift ;;
    --skip)     SKIP_TARGETS+=("$2"); shift 2 ;;
    --only)     ONLY_TARGETS+=("$2"); shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --quiet)    QUIET=true; shift ;;
    -h|--help)
      head -14 "$0" | tail -12
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# If --full, enable everything
if $FULL; then
  GROUP_ENABLED[data]=1
  GROUP_ENABLED[libs]=1
  GROUP_ENABLED[docker]=1
  GROUP_ENABLED[ai]=1
fi

# If --only is used, ignore group flags
if [[ ${#ONLY_TARGETS[@]} -gt 0 ]]; then
  # Only mode — groups don't matter, we filter by target name
  :
elif [[ ${#GROUP_ENABLED[@]} -eq 0 ]]; then
  # Default: data + libs
  GROUP_ENABLED[data]=1
  GROUP_ENABLED[libs]=1
fi

# ─── Target registry ─────────────────────────────────────────────────────────
# Order matters — targets run in the order defined here.

declare -a TARGET_ORDER=()
declare -A TARGET_GROUP=()
declare -A TARGET_CMD=()
declare -A TARGET_DESC=()

register() {
  local name="$1" group="$2" desc="$3" cmd="$4"
  TARGET_ORDER+=("$name")
  TARGET_GROUP[$name]="$group"
  TARGET_DESC[$name]="$desc"
  TARGET_CMD[$name]="$cmd"
}

# --- data group ---
register "fetch-remotes"  "data" "Fetch all git remotes"           "bash ${SCRIPT_DIR}/fetch-all-remotes.sh"
register "dirty-scan"     "data" "Scan dirty workspaces"           "bash ${SCRIPT_DIR}/workspace-git-analysis.sh"
register "access-matrix"  "data" "Update GitHub access matrix"     "bash ${SCRIPT_DIR}/update-access-matrix.sh"
register "email-ingest"   "data" "Ingest & classify new emails"    "bash ${SCRIPT_DIR}/email-ingest.sh"
register "fetch-prs"      "data" "Fetch open pull requests"        "bash ${SCRIPT_DIR}/fetch-open-prs.sh"
register "context-update" "data" "Update context.md & ws types"    "node ${SCRIPT_DIR}/populate-workspace-metadata.mjs"
register "vk-health"      "data" "VK health snapshot (03002)"      "bash ${SCRIPT_DIR}/vk-health/run.sh 03002"
register "system-health"  "data" "System health check (12 checks)" "bash ${SCRIPT_DIR}/system-health-check.sh --quiet"

# --- libs group ---
register "apt"              "libs" "System packages (apt)"          "sudo apt-get update -qq && sudo apt-get upgrade -y -qq"
register "claude-cli"       "libs" "Claude Code CLI (global npm)"   "npm update -g @anthropic-ai/claude-code"
register "mcp-servers"      "libs" "MCP servers (npm workspace)"    "cd ${ORCHESTRATOR_HOME}/mcp-servers && npm update"
register "meeting-assistant" "libs" "Meeting assistant (standalone)" "cd ${ORCHESTRATOR_HOME}/mcp-servers/meeting-assistant && npm update"
register "dashboard"        "libs" "Orchestrator dashboard (npm)"   "cd ${ORCHESTRATOR_HOME}/tools/orchestrator-dashboard && npm update"
register "python-tools"     "libs" "Python tools (pip)"             "source ${ORCHESTRATOR_HOME}/tools/.venv/bin/activate && pip install --upgrade -r ${ORCHESTRATOR_HOME}/tools/requirements.txt -q"

# --- ai group ---
register "pr-review"  "ai"     "AI review of open PRs"       "bash ${SCRIPT_DIR}/review-pr.sh --all --parallel"

# --- docker group ---
register "sandbox"       "docker" "Rebuild sandbox image"        "docker build -t jarvis-sandbox:latest ${SCRIPT_DIR}/sandbox/"
register "pmo-dashboard" "docker" "Rebuild PMO dashboard"        "cd ${ORCHESTRATOR_HOME}/tools/pmo-dashboard && docker-compose build --pull"

# ─── Target filtering ────────────────────────────────────────────────────────

is_skipped() {
  local name="$1"
  for s in "${SKIP_TARGETS[@]+"${SKIP_TARGETS[@]}"}"; do
    [[ "$s" == "$name" ]] && return 0
  done
  return 1
}

is_selected() {
  local name="$1"
  # --only mode: only run explicitly named targets
  if [[ ${#ONLY_TARGETS[@]} -gt 0 ]]; then
    for o in "${ONLY_TARGETS[@]}"; do
      [[ "$o" == "$name" ]] && return 0
    done
    return 1
  fi
  # Group mode: check if target's group is enabled
  local group="${TARGET_GROUP[$name]}"
  [[ "${GROUP_ENABLED[$group]:-}" == "1" ]] && return 0
  return 1
}

# ─── Output helpers ──────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log() { $QUIET || echo -e "$@"; }
log_status() {
  local status="$1" name="$2" elapsed="$3" desc="$4"
  $QUIET && return
  case "$status" in
    OK)   printf "  ${GREEN}[  OK  ]${RESET} %-22s %-40s ${CYAN}(%s)${RESET}\n" "$name" "$desc" "$elapsed" ;;
    FAIL) printf "  ${RED}[ FAIL ]${RESET} %-22s %-40s ${CYAN}(%s)${RESET}\n" "$name" "$desc" "$elapsed" ;;
    SKIP) printf "  ${YELLOW}[ SKIP ]${RESET} %-22s %s\n" "$name" "$desc" ;;
    DRY)  printf "  ${BLUE}[ DRY  ]${RESET} %-22s %s\n" "$name" "$desc" ;;
  esac
}

# ─── Runner ──────────────────────────────────────────────────────────────────

declare -a RESULT_NAMES=()
declare -A RESULT_STATUS=()
declare -A RESULT_ELAPSED=()
TOTAL_OK=0
TOTAL_FAIL=0
TOTAL_SKIP=0

run_target() {
  local name="$1"
  local cmd="${TARGET_CMD[$name]}"
  local desc="${TARGET_DESC[$name]}"

  RESULT_NAMES+=("$name")

  if is_skipped "$name"; then
    RESULT_STATUS[$name]="SKIP"
    RESULT_ELAPSED[$name]="—"
    TOTAL_SKIP=$((TOTAL_SKIP + 1))
    log_status "SKIP" "$name" "" "$desc"
    return 0
  fi

  if ! is_selected "$name"; then
    RESULT_STATUS[$name]="SKIP"
    RESULT_ELAPSED[$name]="—"
    TOTAL_SKIP=$((TOTAL_SKIP + 1))
    return 0
  fi

  if $DRY_RUN; then
    RESULT_STATUS[$name]="DRY"
    RESULT_ELAPSED[$name]="—"
    log_status "DRY" "$name" "" "$desc"
    log "         ${CYAN}→ $cmd${RESET}"
    return 0
  fi

  printf "  ${BOLD}▶${RESET} %-22s %s\n" "$name" "$desc"

  local start_ts end_ts elapsed rc
  start_ts=$(date +%s)

  # Run in subshell, capture output
  set +e
  if $QUIET; then
    bash -c "$cmd" >> "$LOG_FILE" 2>&1
    rc=$?
  else
    bash -c "$cmd" >> "$LOG_FILE" 2>&1
    rc=$?
  fi
  set -e

  end_ts=$(date +%s)
  elapsed="$(( end_ts - start_ts ))s"

  RESULT_ELAPSED[$name]="$elapsed"

  if [[ $rc -eq 0 ]]; then
    RESULT_STATUS[$name]="OK"
    TOTAL_OK=$((TOTAL_OK + 1))
    # Move cursor up one line and overwrite the "▶" line
    $QUIET || echo -ne "\033[1A\033[2K"
    log_status "OK" "$name" "$elapsed" "$desc"
  else
    RESULT_STATUS[$name]="FAIL"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    $QUIET || echo -ne "\033[1A\033[2K"
    log_status "FAIL" "$name" "$elapsed" "$desc"
  fi
}

# ─── Setup logging ───────────────────────────────────────────────────────────

LOG_DIR="${ORCHESTRATOR_HOME}/logs"
REPORT_DIR="${ORCHESTRATOR_HOME}/reports/system-update"
mkdir -p "$LOG_DIR" "$REPORT_DIR"

TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="${LOG_DIR}/system-update-${TIMESTAMP}.log"
REPORT_FILE="${REPORT_DIR}/update-${TIMESTAMP}.md"

echo "# System Update Log — ${TIMESTAMP}" > "$LOG_FILE"
echo "" >> "$LOG_FILE"

# ─── Main ────────────────────────────────────────────────────────────────────

log ""
log "  ${BOLD}JARVIS System Update${RESET}"
log "  $(date '+%Y-%m-%d %H:%M:%S')"
if $DRY_RUN; then
  log "  ${YELLOW}(dry run — no commands will execute)${RESET}"
fi
log ""

for name in "${TARGET_ORDER[@]}"; do
  run_target "$name"
done

# ─── Summary ─────────────────────────────────────────────────────────────────

TOTAL_RUN=$((TOTAL_OK + TOTAL_FAIL))
log ""
log "  ${BOLD}Summary${RESET}  OK: ${GREEN}${TOTAL_OK}${RESET}  Failed: ${RED}${TOTAL_FAIL}${RESET}  Skipped: ${YELLOW}${TOTAL_SKIP}${RESET}  Total: ${#TARGET_ORDER[@]}"

if [[ $TOTAL_FAIL -gt 0 ]]; then
  log ""
  log "  ${RED}Failed targets:${RESET}"
  for name in "${RESULT_NAMES[@]}"; do
    [[ "${RESULT_STATUS[$name]}" == "FAIL" ]] && log "    - $name"
  done
fi

log ""
log "  Log: ${LOG_FILE}"
log "  Report: ${REPORT_FILE}"
log ""

# Telegram reminder (MCP-only target)
if is_selected "fetch-remotes" 2>/dev/null || $FULL; then
  log "  ${YELLOW}Note:${RESET} Run 'check_telegram_inbox' via MCP to poll Telegram messages."
  log ""
fi

# ─── Write report ────────────────────────────────────────────────────────────

# Build mode string
MODE_STR=""
if $FULL; then
  MODE_STR="full"
elif [[ ${#ONLY_TARGETS[@]} -gt 0 ]]; then
  MODE_STR="only: ${ONLY_TARGETS[*]}"
else
  MODE_STR="groups:"
  for g in "${!GROUP_ENABLED[@]}"; do MODE_STR+=" $g"; done
fi

{
  echo "# System Update Report"
  echo ""
  echo "**Date:** ${TIMESTAMP}<br>"
  echo "**Mode:** ${MODE_STR}<br>"
  echo "**Dry run:** $DRY_RUN"
  echo ""
  echo "## Results"
  echo ""
  echo "| Target | Group | Status | Time |"
  echo "|--------|-------|--------|------|"
  for name in "${RESULT_NAMES[@]}"; do
    local_status="${RESULT_STATUS[$name]}"
    local_elapsed="${RESULT_ELAPSED[$name]}"
    local_group="${TARGET_GROUP[$name]}"
    # Only include targets that actually ran, explicitly skipped, or shown in dry-run
    if [[ "$local_status" != "SKIP" ]]; then
      echo "| ${name} | ${local_group} | ${local_status} | ${local_elapsed} |"
    fi
  done
  echo ""
  echo "## Summary"
  echo ""
  echo "- **OK:** ${TOTAL_OK}"
  echo "- **Failed:** ${TOTAL_FAIL}"
  echo "- **Skipped:** ${TOTAL_SKIP}"
  echo "- **Total targets:** ${#TARGET_ORDER[@]}"
  echo ""
  echo "## Log"
  echo ""
  echo "Full output: \`${LOG_FILE}\`"
} > "$REPORT_FILE"

# Symlink latest
ln -sf "$(basename "$REPORT_FILE")" "${REPORT_DIR}/latest.md"

# Exit code: non-zero if any target failed
[[ $TOTAL_FAIL -eq 0 ]] || exit 1
