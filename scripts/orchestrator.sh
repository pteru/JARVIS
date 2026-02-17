#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${BLUE}═══ $1 ═══${NC}\n"; }

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="${1:-process-backlogs}"
DATE=$(date +%Y-%m-%d)

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Claude Orchestrator - ${MODE}                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log_info "Date: $DATE"
log_info "Mode: $MODE"

WORKSPACES_CONFIG="$ORCHESTRATOR_HOME/config/orchestrator/workspaces.json"
SCHEDULES_CONFIG="$ORCHESTRATOR_HOME/config/orchestrator/schedules.json"

if [[ ! -f "$WORKSPACES_CONFIG" ]]; then
    log_error "workspaces.json not found at $WORKSPACES_CONFIG"
    exit 1
fi

# Get workspaces sorted by priority (high first, then medium, then low)
WORKSPACES=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('$WORKSPACES_CONFIG', 'utf-8'));
    const ws = c.workspaces || {};
    const order = { high: 0, medium: 1, low: 2 };
    Object.entries(ws)
        .sort(([, a], [, b]) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1))
        .forEach(([k]) => console.log(k));
" 2>/dev/null)

if [[ -z "$WORKSPACES" ]]; then
    log_warn "No workspaces found"
    exit 0
fi

WORKSPACE_COUNT=$(echo "$WORKSPACES" | wc -l | tr -d ' ')
log_info "Workspaces: $WORKSPACE_COUNT (sorted by priority)"

# Read max_tasks_per_workspace from schedules.json (process_backlogs entry)
MAX_TASKS=1
if [[ -f "$SCHEDULES_CONFIG" ]]; then
    MAX_TASKS=$(node -e "
        const s = JSON.parse(require('fs').readFileSync('$SCHEDULES_CONFIG', 'utf-8'));
        const entry = (s.schedules?.daily || []).find(e => e.task === 'process_backlogs');
        console.log(entry?.max_tasks_per_workspace ?? 1);
    " 2>/dev/null || echo 1)
fi

process_backlogs() {
    log_section "Processing Backlogs"
    log_info "Max tasks per workspace: $MAX_TASKS"

    for ws in $WORKSPACES; do
        log_section "Workspace: $ws"

        # Read workspace metadata
        WS_META=$(node -e "
            const c = JSON.parse(require('fs').readFileSync('$WORKSPACES_CONFIG', 'utf-8'));
            const ws = c.workspaces['$ws'] || {};
            console.log(JSON.stringify(ws));
        " 2>/dev/null || echo "{}")

        AUTO_REVIEW=$(echo "$WS_META" | node -e "
            const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
            console.log(d.auto_review === true ? 'true' : 'false');
        " 2>/dev/null || echo "false")

        WS_PRIORITY=$(echo "$WS_META" | node -e "
            const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
            console.log(d.priority || 'medium');
        " 2>/dev/null || echo "medium")

        log_info "Priority: $WS_PRIORITY | Auto-review: $AUTO_REVIEW"

        BACKLOG="$ORCHESTRATOR_HOME/backlogs/products/${ws}.md"
        if [[ ! -f "$BACKLOG" ]]; then
            log_warn "No backlog for $ws — skipping"
            continue
        fi

        # Process up to MAX_TASKS tasks
        TASKS_RUN=0
        while IFS= read -r TASK_LINE; do
            if [[ $TASKS_RUN -ge $MAX_TASKS ]]; then
                break
            fi

            [[ -z "$TASK_LINE" ]] && continue

            # Extract complexity tag
            COMPLEXITY="medium"
            if echo "$TASK_LINE" | grep -qi '\[simple\]'; then
                COMPLEXITY="simple"
            elif echo "$TASK_LINE" | grep -qi '\[complex\]'; then
                COMPLEXITY="complex"
            fi

            # Clean task text
            TASK_TEXT=$(echo "$TASK_LINE" \
                | sed 's/^- \[ \] \[SIMPLE\] //i' \
                | sed 's/^- \[ \] \[MEDIUM\] //i' \
                | sed 's/^- \[ \] \[COMPLEX\] //i' \
                | sed 's/^- \[ \] //')

            log_info "Task: $TASK_TEXT"
            log_info "Complexity: $COMPLEXITY"

            "$SCRIPT_DIR/task-dispatcher.sh" "$ws" "$TASK_TEXT" "$COMPLEXITY" || {
                log_error "Failed to dispatch task for $ws"
                continue
            }

            TASKS_RUN=$((TASKS_RUN + 1))

            if [[ "$AUTO_REVIEW" == "true" ]]; then
                log_info "Auto-review enabled for $ws — review output above before continuing"
            fi
        done < <(grep '^\- \[ \]' "$BACKLOG" 2>/dev/null || true)

        if [[ $TASKS_RUN -eq 0 ]]; then
            log_info "No pending tasks for $ws"
        fi
    done
}

generate_daily_report() {
    log_section "Generating Daily Report"

    REPORT_FILE="$ORCHESTRATOR_HOME/reports/daily-${DATE}.md"
    mkdir -p "$(dirname "$REPORT_FILE")"

    {
        echo "# Daily Report - $DATE"
        echo ""
        echo "## Workspace Activity"
        echo ""

        for ws in $WORKSPACES; do
            CHANGELOG="$ORCHESTRATOR_HOME/changelogs/${ws}-changelog.md"
            if [[ -f "$CHANGELOG" ]] && grep -q "$DATE" "$CHANGELOG" 2>/dev/null; then
                echo "### $ws"
                grep -A 20 "## $DATE" "$CHANGELOG" 2>/dev/null | head -25 || true
                echo ""
            fi
        done
    } > "$REPORT_FILE"

    log_info "Report saved: $REPORT_FILE"
}

generate_weekly_report() {
    log_section "Generating Weekly Report"

    REPORT_FILE="$ORCHESTRATOR_HOME/reports/weekly-${DATE}.md"
    mkdir -p "$(dirname "$REPORT_FILE")"

    {
        echo "# Weekly Report - Week ending $DATE"
        echo ""
        echo "## Summary"
        echo ""

        for ws in $WORKSPACES; do
            CHANGELOG="$ORCHESTRATOR_HOME/changelogs/${ws}-changelog.md"
            if [[ -f "$CHANGELOG" ]]; then
                echo "### $ws"
                # Last 7 days of entries
                head -60 "$CHANGELOG" 2>/dev/null || true
                echo ""
            fi
        done
    } > "$REPORT_FILE"

    log_info "Report saved: $REPORT_FILE"
}

suggest_weekly_goals() {
    log_section "Suggesting Weekly Goals"

    for ws in $WORKSPACES; do
        log_info "Workspace: $ws"

        BACKLOG="$ORCHESTRATOR_HOME/backlogs/products/${ws}.md"
        if [[ -f "$BACKLOG" ]]; then
            PENDING=$(grep -c '^\- \[ \]' "$BACKLOG" 2>/dev/null || echo 0)
            log_info "  Pending tasks: $PENDING"
        fi
    done

    log_info "Review backlogs and add new goals for the week."
}

run_manual() {
    WORKSPACE="$2"
    TASK="$3"

    if [[ -z "$WORKSPACE" || -z "$TASK" ]]; then
        echo "Usage: orchestrator.sh manual <workspace> <task> [complexity]"
        exit 1
    fi

    log_section "Manual Task Dispatch"
    "$SCRIPT_DIR/task-dispatcher.sh" "$WORKSPACE" "$TASK" "${4:-medium}"
}

case "$MODE" in
    process-backlogs) process_backlogs ;;
    daily-report)     generate_daily_report ;;
    weekly-report)    generate_weekly_report ;;
    suggest-goals)    suggest_weekly_goals ;;
    fetch-remotes)    "$SCRIPT_DIR/fetch-all-remotes.sh" ;;
    update-access)    "$SCRIPT_DIR/update-access-matrix.sh" ;;
    manual)           run_manual "$@" ;;
    # Legacy aliases
    daily)            process_backlogs ;;
    weekly)           generate_weekly_report ;;
    *)
        echo "Usage: orchestrator.sh <process-backlogs|daily-report|weekly-report|suggest-goals|fetch-remotes|update-access|manual> [args...]"
        exit 1
        ;;
esac

echo ""
log_info "Orchestrator '$MODE' completed."
echo ""
