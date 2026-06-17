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

MODE="${1:-refresh-backlog-cache}"
DATE=$(date +%Y-%m-%d)

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Claude Orchestrator - ${MODE}                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log_info "Date: $DATE"
log_info "Mode: $MODE"

WORKSPACES_CONFIG="$ORCHESTRATOR_HOME/config/orchestrator/workspaces.json"

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

dispatch_issue() {
    local target="$1" number="$2" dry=""
    [[ "$3" == "--dry-run" || "$4" == "--dry-run" ]] && dry="1"
    if [[ -z "$target" || -z "$number" ]]; then
        log_error "Usage: orchestrator.sh dispatch-issue <workspace|owner/repo> <issue#> [--dry-run]"
        return 1
    fi

    # Resolve a workspace key + repo slug from the target.
    # `|| true` keeps set -e from killing the script when the resolver exits
    # non-zero (exit 2 = not found); the empty-guard below reports it cleanly.
    local workspace repo
    if [[ "$target" == */* ]]; then
        repo="$target"
        workspace="$(node "$SCRIPT_DIR/lib/backlog-source.mjs" resolve-workspace "$repo" 2>/dev/null)" || true
    else
        workspace="$target"
        repo="$(node "$SCRIPT_DIR/lib/backlog-source.mjs" resolve-repo "$workspace" 2>/dev/null)" || true
    fi
    if [[ -z "$workspace" || -z "$repo" ]]; then
        log_error "Could not resolve workspace/repo for '$target'"
        return 1
    fi

    # Fetch the issue.
    local issue_json
    issue_json="$(gh issue view "$number" --repo "$repo" --json title,body,labels,url 2>/dev/null)" || {
        log_error "Failed to fetch issue #$number from $repo"
        return 1
    }

    local title body url complexity
    title="$(echo "$issue_json" | jq -r '.title // ""')"
    body="$(echo "$issue_json" | jq -r '.body // ""')"
    url="$(echo "$issue_json" | jq -r '.url // ""')"
    complexity="$(echo "$issue_json" | jq -r '[(.labels // [])[].name] | map(select(. == "simple" or . == "medium" or . == "complex")) | (.[0] // "medium")')"

    local prompt="GitHub issue ${url}

# ${title}

${body}

Reference this issue (${url}) in your branch name, commit message, and PR. Do not close the issue automatically."

    if [[ -n "$dry" ]]; then
        echo "workspace: $workspace"
        echo "repo: $repo"
        echo "complexity: $complexity"
        echo "would run: task-dispatcher.sh \"$workspace\" <prompt for ${url}> \"$complexity\""
        return 0
    fi

    log_info "Dispatching ${url} → $workspace ($complexity)"
    "$SCRIPT_DIR/task-dispatcher.sh" "$workspace" "$prompt" "$complexity"
}

refresh_backlog_cache() {
    log_section "Refreshing Backlog Cache (GitHub Issues)"
    if ! command -v gh >/dev/null 2>&1; then
        log_error "gh CLI not found — cannot refresh backlog cache"
        return 1
    fi
    # Pull open backlog issues for every configured repo into data/backlog-cache/.
    node "$SCRIPT_DIR/lib/backlog-source.mjs" refresh || {
        log_warn "Backlog cache refresh reported errors (see above) — keeping existing cache"
    }
    log_info "Backlog cache refreshed. Dispatch is manual: orchestrator.sh dispatch-issue <workspace|repo> <issue#>"
}

generate_daily_report() {
    log_section "Generating Daily Report"

    REPORT_FILE="$ORCHESTRATOR_HOME/reports/daily/daily-${DATE}.md"
    DISPATCHES="$ORCHESTRATOR_HOME/logs/dispatches.json"
    CHANGELOG_DIR="$ORCHESTRATOR_HOME/changelogs"
    mkdir -p "$(dirname "$REPORT_FILE")"

    {
        echo "# Daily Report - $DATE"
        echo ""

        # --- Dispatches for today ---
        echo "## Dispatches"
        echo ""
        if [[ -f "$DISPATCHES" ]]; then
            DISPATCH_SUMMARY=$(node -e "
                const d = JSON.parse(require('fs').readFileSync('$DISPATCHES','utf-8'));
                const today = d.filter(e => (e.created_at||'').startsWith('$DATE'));
                if (!today.length) { console.log('No dispatches today.'); process.exit(0); }
                const byStatus = {};
                today.forEach(e => { byStatus[e.status] = (byStatus[e.status]||0)+1; });
                console.log('| Status | Count |');
                console.log('|--------|-------|');
                Object.entries(byStatus).forEach(([s,c]) => console.log('| ' + s + ' | ' + c + ' |'));
                console.log('');
                console.log('### Details');
                console.log('');
                today.forEach(e => {
                    const ws = (e.workspace||'').split('.').slice(1,3).join('.');
                    console.log('- **[' + e.status + ']** ' + ws + ' — ' + (e.task||'').slice(0,80));
                });
            " 2>/dev/null || echo "Could not parse dispatches.")
            echo "$DISPATCH_SUMMARY"
        else
            echo "No dispatch log found."
        fi
        echo ""

        # --- Changelog entries for today ---
        echo "## Changelog Entries"
        echo ""
        FOUND_CHANGELOG=false
        for f in "$CHANGELOG_DIR"/*-changelog.md; do
            [[ -f "$f" ]] || continue
            if grep -q "## $DATE" "$f" 2>/dev/null; then
                WS_NAME=$(basename "$f" | sed 's/-changelog\.md$//')
                echo "### $WS_NAME"
                sed -n "/^## $DATE/,/^## [0-9]/p" "$f" | head -30 | sed '$d'
                echo ""
                FOUND_CHANGELOG=true
            fi
        done
        if [[ "$FOUND_CHANGELOG" == "false" ]]; then
            echo "No changelog entries for today."
        fi
        echo ""

        # --- Git activity ---
        echo "## Git Commits"
        echo ""
        git -C "$ORCHESTRATOR_HOME" log --oneline --since="$DATE" --until="$(date -d "$DATE + 1 day" +%Y-%m-%d)" 2>/dev/null || echo "No commits today."
        echo ""

        # --- Backlog summary ---
        echo "## Backlog Summary"
        echo ""
        echo "| Product | Pending |"
        echo "|---------|---------|"
        for product in diemaster spotfusion visionking sdk; do
            COUNT=$(node "$SCRIPT_DIR/lib/backlog-source.mjs" list "strokmatic/${product}" --json 2>/dev/null | jq 'length' 2>/dev/null || echo 0)
            echo "| $product | ${COUNT:-0} |"
        done
    } > "$REPORT_FILE"

    log_info "Report saved: $REPORT_FILE"
}

generate_weekly_report() {
    log_section "Generating Weekly Report"

    REPORT_FILE="$ORCHESTRATOR_HOME/reports/weekly/weekly-${DATE}.md"
    DISPATCHES="$ORCHESTRATOR_HOME/logs/dispatches.json"
    CHANGELOG_DIR="$ORCHESTRATOR_HOME/changelogs"
    WEEK_START=$(date -d "$DATE - 7 days" +%Y-%m-%d)
    mkdir -p "$(dirname "$REPORT_FILE")"

    {
        echo "# Weekly Report - Week ending $DATE"
        echo ""

        # --- Dispatch summary for the week ---
        echo "## Dispatch Summary ($WEEK_START to $DATE)"
        echo ""
        if [[ -f "$DISPATCHES" ]]; then
            node -e "
                const d = JSON.parse(require('fs').readFileSync('$DISPATCHES','utf-8'));
                const start = '$WEEK_START', end = '$DATE';
                const week = d.filter(e => { const dt = (e.created_at||'').slice(0,10); return dt >= start && dt <= end; });
                if (!week.length) { console.log('No dispatches this week.'); process.exit(0); }
                // By status
                const byStatus = {};
                week.forEach(e => { byStatus[e.status] = (byStatus[e.status]||0)+1; });
                console.log('**Total: ' + week.length + ' dispatches**');
                console.log('');
                console.log('| Status | Count |');
                console.log('|--------|-------|');
                Object.entries(byStatus).forEach(([s,c]) => console.log('| ' + s + ' | ' + c + ' |'));
                console.log('');
                // By product
                const byProduct = {};
                week.forEach(e => {
                    const p = (e.workspace||'').split('.')[1] || 'other';
                    byProduct[p] = (byProduct[p]||0)+1;
                });
                console.log('| Product | Dispatches |');
                console.log('|---------|------------|');
                Object.entries(byProduct).sort((a,b)=>b[1]-a[1]).forEach(([p,c]) => console.log('| ' + p + ' | ' + c + ' |'));
                console.log('');
                // By type
                const byType = {};
                week.forEach(e => { byType[e.type||'task'] = (byType[e.type||'task']||0)+1; });
                console.log('| Type | Count |');
                console.log('|------|-------|');
                Object.entries(byType).sort((a,b)=>b[1]-a[1]).forEach(([t,c]) => console.log('| ' + t + ' | ' + c + ' |'));
            " 2>/dev/null || echo "Could not parse dispatches."
        else
            echo "No dispatch log found."
        fi
        echo ""

        # --- Changelog entries for the week ---
        echo "## Changelog Entries"
        echo ""
        FOUND_CHANGELOG=false
        for f in "$CHANGELOG_DIR"/*-changelog.md; do
            [[ -f "$f" ]] || continue
            WS_NAME=$(basename "$f" | sed 's/-changelog\.md$//')
            # Extract date headers within range
            ENTRIES=$(awk -v start="$WEEK_START" -v end="$DATE" '
                /^## [0-9]{4}-[0-9]{2}-[0-9]{2}/ {
                    dt = substr($2, 1, 10)
                    in_range = (dt >= start && dt <= end)
                }
                in_range { print }
            ' "$f" 2>/dev/null)
            if [[ -n "$ENTRIES" ]]; then
                echo "### $WS_NAME"
                echo "$ENTRIES"
                echo ""
                FOUND_CHANGELOG=true
            fi
        done
        if [[ "$FOUND_CHANGELOG" == "false" ]]; then
            echo "No changelog entries this week."
        fi
        echo ""

        # --- Git activity ---
        echo "## Git Commits"
        echo ""
        git -C "$ORCHESTRATOR_HOME" log --oneline --since="$WEEK_START" 2>/dev/null || echo "No commits this week."
        echo ""

        # --- Backlog summary ---
        echo "## Backlog Summary"
        echo ""
        echo "| Product | Pending |"
        echo "|---------|---------|"
        for product in diemaster spotfusion visionking sdk; do
            COUNT=$(node "$SCRIPT_DIR/lib/backlog-source.mjs" list "strokmatic/${product}" --json 2>/dev/null | jq 'length' 2>/dev/null || echo 0)
            echo "| $product | ${COUNT:-0} |"
        done
    } > "$REPORT_FILE"

    log_info "Report saved: $REPORT_FILE"
}

suggest_weekly_goals() {
    log_section "Suggesting Weekly Goals"

    for repo in $(jq -r '.repos[]' "$ORCHESTRATOR_HOME/config/orchestrator/issue-repos.json" 2>/dev/null); do
        PENDING=$(node "$SCRIPT_DIR/lib/backlog-source.mjs" list "$repo" --json 2>/dev/null | jq 'length' 2>/dev/null || echo 0)
        log_info "  ${repo}: ${PENDING:-0} pending"
    done
    log_info "Review GitHub Issues (label:backlog) and add new goals for the week."
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

run_pr_inbox() {
    log_section "PR Inbox & Review"

    log_info "Step 1/3: Fetching open PRs..."
    "$SCRIPT_DIR/fetch-open-prs.sh" || {
        log_error "Failed to fetch open PRs"
        return 1
    }

    log_info "Step 2/3: Reviewing PRs..."
    "$SCRIPT_DIR/review-pr.sh" --all || {
        log_warn "Some PR reviews failed (continuing)"
    }

    log_info "Step 3/3: Building PR inbox report..."
    node "$SCRIPT_DIR/helpers/build-pr-inbox.mjs" || {
        log_error "Failed to build PR inbox markdown"
        return 1
    }

    log_info "PR inbox pipeline complete"
}

case "$MODE" in
    refresh-backlog-cache) refresh_backlog_cache ;;
    daily-report)     generate_daily_report ;;
    weekly-report)    generate_weekly_report ;;
    suggest-goals)    suggest_weekly_goals ;;
    fetch-remotes)    "$SCRIPT_DIR/fetch-all-remotes.sh" ;;
    update-access)    "$SCRIPT_DIR/update-access-matrix.sh" ;;
    pr-inbox)         run_pr_inbox ;;
    vk-health)
        log_section "Running VK Health Check"
        VK_SSH_PASSWORD="$(cat ~/.secrets/vk-ssh-password 2>/dev/null)" \
        VK_RABBIT_PASSWORD="$(cat ~/.secrets/vk-rabbit-password 2>/dev/null)" \
        "$SCRIPT_DIR/vk-health/run.sh" "${2:-03002}"
        ;;
    manual)           run_manual "$@" ;;
    dispatch-issue)   dispatch_issue "$2" "$3" "$4" "$5" ;;
    # Legacy aliases
    daily)            refresh_backlog_cache ;;
    weekly)           generate_weekly_report ;;
    *)
        echo "Usage: orchestrator.sh <refresh-backlog-cache|daily-report|weekly-report|suggest-goals|fetch-remotes|update-access|pr-inbox|vk-health|manual|dispatch-issue <ws|repo> <issue#>> [args...]"
        exit 1
        ;;
esac

echo ""
log_info "Orchestrator '$MODE' completed."

# Log dispatch for dashboard visibility
"$SCRIPT_DIR/helpers/log-dispatch.sh" "orchestrator" "orchestrator.sh $MODE" "orchestrator" "none" "complete" 2>/dev/null || true

echo ""
