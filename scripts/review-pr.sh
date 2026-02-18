#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INBOX_FILE="$ORCHESTRATOR_HOME/reports/pr-inbox.json"
REVIEWS_DIR="$ORCHESTRATOR_HOME/reports/pr-reviews"
WORKSPACES_CONFIG="$ORCHESTRATOR_HOME/config/orchestrator/workspaces.json"
ORG="strokmatic"

mkdir -p "$REVIEWS_DIR"

usage() {
    echo "Usage: review-pr.sh --all | --repo <repo-name> --pr <number>"
    echo ""
    echo "Review open pull requests using Claude."
    echo ""
    echo "Options:"
    echo "  --all                Review all unreviewed open PRs"
    echo "  --repo <name>        GitHub repo name (e.g. visionking-backend)"
    echo "  --pr <number>        PR number"
    exit 1
}

# Parse args
MODE=""
TARGET_REPO=""
TARGET_PR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --all)    MODE="all"; shift ;;
        --repo)   TARGET_REPO="$2"; shift 2 ;;
        --pr)     TARGET_PR="$2"; shift 2 ;;
        *)        usage ;;
    esac
done

if [[ "$MODE" != "all" && ( -z "$TARGET_REPO" || -z "$TARGET_PR" ) ]]; then
    usage
fi

if [[ ! -f "$INBOX_FILE" ]]; then
    log_error "PR inbox not found at $INBOX_FILE. Run fetch-open-prs.sh first."
    exit 1
fi

if [[ ! -f "$WORKSPACES_CONFIG" ]]; then
    log_error "Workspaces config not found at $WORKSPACES_CONFIG"
    exit 1
fi

# Map a GitHub repo name to workspace name using workspaces.json remotes
map_repo_to_workspace() {
    local repo_name="$1"
    node -e "
        const config = JSON.parse(require('fs').readFileSync('$WORKSPACES_CONFIG', 'utf-8'));
        const repoName = process.argv[1];
        for (const [wsName, ws] of Object.entries(config.workspaces || {})) {
            for (const url of Object.values(ws.remotes || {})) {
                // Extract repo name from git URL (handles ssh and https)
                const match = url.match(/[\/:]([^\/]+?)(?:\.git)?$/);
                if (match && match[1] === repoName) {
                    console.log(wsName);
                    process.exit(0);
                }
            }
        }
        // Not found
        process.exit(1);
    " "$repo_name" 2>/dev/null || echo ""
}

# Determine complexity from PR size
get_complexity() {
    local additions="$1"
    local deletions="$2"
    local changed_files="$3"
    local total_lines=$((additions + deletions))

    if [[ $total_lines -gt 500 || $changed_files -gt 10 ]]; then
        echo "complex"
    elif [[ $total_lines -ge 100 || $changed_files -ge 5 ]]; then
        echo "medium"
    else
        echo "simple"
    fi
}

# Check if review is stale (PR updated after review was written)
review_is_current() {
    local review_file="$1"
    local pr_updated_at="$2"

    if [[ ! -f "$review_file" ]]; then
        return 1  # No review exists
    fi

    # Compare PR updated_at with review file mtime
    local review_mtime
    review_mtime=$(date -r "$review_file" +%s 2>/dev/null || stat -c %Y "$review_file" 2>/dev/null || echo 0)
    local pr_epoch
    pr_epoch=$(date -d "$pr_updated_at" +%s 2>/dev/null || echo 0)

    if [[ $review_mtime -ge $pr_epoch ]]; then
        return 0  # Review is current
    else
        return 1  # Review is stale
    fi
}

# Review a single PR
review_single_pr() {
    local repo="$1"
    local number="$2"
    local title="$3"
    local additions="$4"
    local deletions="$5"
    local changed_files="$6"
    local updated_at="$7"

    local review_file="$REVIEWS_DIR/${repo}-${number}.md"

    # Check if already reviewed and current
    if review_is_current "$review_file" "$updated_at"; then
        log_info "Skipping $repo#$number — review is current"
        return 0
    fi

    local complexity
    complexity=$(get_complexity "$additions" "$deletions" "$changed_files")

    local workspace
    workspace=$(map_repo_to_workspace "$repo")

    if [[ -z "$workspace" ]]; then
        log_warn "No workspace mapping for repo '$repo' — using orchestrator home"
        workspace=""
    fi

    log_info "Reviewing $repo#$number: $title"
    log_info "  Size: +$additions/-$deletions, $changed_files files | Complexity: $complexity"

    local review_prompt
    review_prompt=$(cat <<PROMPT_EOF
You are reviewing Pull Request #${number} in the repository strokmatic/${repo}.

Steps:
1. Run: gh pr view ${number} --repo strokmatic/${repo}
2. Run: gh pr diff ${number} --repo strokmatic/${repo}
3. Perform a thorough code review covering:
   - **Correctness**: Logic errors, edge cases, null handling
   - **Security (OWASP)**: Injection, auth issues, secrets exposure, input validation
   - **Standards compliance**: Code style, naming conventions, error handling patterns
   - **Test coverage**: Are new paths tested? Are existing tests updated?
4. Write the review to: ${review_file}

The review file must follow this format:

# PR Review: ${repo}#${number}
**Title:** ${title}
**Reviewed:** $(date -Iseconds)
**Complexity:** ${complexity}

## Summary
<2-3 sentence summary of what this PR does>

## Findings

### Critical
<list critical issues or "None">

### Warnings
<list warnings or "None">

### Suggestions
<list suggestions or "None">

## Verdict
<One of: APPROVE | APPROVE WITH COMMENTS | CHANGES REQUESTED>

<Brief justification for verdict>
PROMPT_EOF
)

    # Determine model from complexity
    local model
    model=$("$SCRIPT_DIR/model-selector.sh" "$complexity" "code review" 2>/dev/null || echo "sonnet")

    # Determine working directory
    local work_dir="$ORCHESTRATOR_HOME"
    if [[ -n "$workspace" ]]; then
        local ws_path
        ws_path=$(node -e "
            const c = JSON.parse(require('fs').readFileSync('$WORKSPACES_CONFIG','utf-8'));
            const ws = c.workspaces?.['$workspace'];
            if (ws) console.log(ws.path);
        " 2>/dev/null || true)
        if [[ -n "$ws_path" && -d "$ws_path" ]]; then
            work_dir="$ws_path"
        fi
    fi

    log_info "  Model: $model | Dir: $work_dir"

    # Run Claude and capture output to the review file
    mkdir -p "$(dirname "$review_file")"
    cd "$work_dir"
    echo "$review_prompt" | claude --model "$model" --print --allowedTools 'Bash(gh:*)' > "$review_file" 2>&1 || {
        log_error "Review failed for $repo#$number"
        rm -f "$review_file"
        return 1
    }
    cd "$ORCHESTRATOR_HOME"

    # Log dispatch for dashboard visibility
    "$SCRIPT_DIR/helpers/log-dispatch.sh" "pr-review" "Review $repo#$number: $title" "$workspace" "$model" "complete" 2>/dev/null || true

    log_info "Review complete: $review_file"
}

# Get PRs to review
if [[ "$MODE" == "all" ]]; then
    # Review all non-draft PRs that need review
    PR_LIST=$(node -e "
        const inbox = JSON.parse(require('fs').readFileSync('$INBOX_FILE', 'utf-8'));
        const prs = inbox.pull_requests || [];
        // Filter: not draft, not already approved
        const toReview = prs.filter(pr => !pr.is_draft && pr.review_decision !== 'APPROVED');
        toReview.forEach(pr => {
            console.log([pr.repo, pr.number, pr.title, pr.additions, pr.deletions, pr.changed_files, pr.updated_at].join('\t'));
        });
    " 2>/dev/null || true)

    if [[ -z "$PR_LIST" ]]; then
        log_info "No PRs need review."
        exit 0
    fi

    TOTAL=$(echo "$PR_LIST" | wc -l | tr -d ' ')
    CURRENT=0
    REVIEWED=0
    SKIPPED=0
    FAILED=0

    log_info "$TOTAL PR(s) to review"

    while IFS=$'\t' read -r repo number title additions deletions changed_files updated_at; do
        CURRENT=$((CURRENT + 1))
        log_info "[$CURRENT/$TOTAL] $repo#$number"

        if review_single_pr "$repo" "$number" "$title" "$additions" "$deletions" "$changed_files" "$updated_at"; then
            # Check if it was skipped (review file existed and was current)
            if review_is_current "$REVIEWS_DIR/${repo}-${number}.md" "$updated_at" 2>/dev/null; then
                REVIEWED=$((REVIEWED + 1))
            else
                SKIPPED=$((SKIPPED + 1))
            fi
        else
            FAILED=$((FAILED + 1))
        fi
    done <<< "$PR_LIST"

    log_info "Review summary: $REVIEWED reviewed, $SKIPPED skipped, $FAILED failed"
else
    # Single PR mode
    PR_DATA=$(node -e "
        const inbox = JSON.parse(require('fs').readFileSync('$INBOX_FILE', 'utf-8'));
        const pr = (inbox.pull_requests || []).find(p => p.repo === '$TARGET_REPO' && p.number === $TARGET_PR);
        if (pr) {
            console.log([pr.repo, pr.number, pr.title, pr.additions, pr.deletions, pr.changed_files, pr.updated_at].join('\t'));
        } else {
            process.exit(1);
        }
    " 2>/dev/null || true)

    if [[ -z "$PR_DATA" ]]; then
        log_error "PR $TARGET_REPO#$TARGET_PR not found in inbox. Run fetch-open-prs.sh first."
        exit 1
    fi

    IFS=$'\t' read -r repo number title additions deletions changed_files updated_at <<< "$PR_DATA"
    review_single_pr "$repo" "$number" "$title" "$additions" "$deletions" "$changed_files" "$updated_at"
fi
