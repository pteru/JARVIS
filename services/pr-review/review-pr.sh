#!/bin/bash
# Review open pull requests using Claude.
# Adapted from scripts/review-pr.sh for the remote PR review service.
# Key difference: CLAUDE.md content is embedded in the prompt (no workspace clones needed).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [review] $*"; }

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
        --all)      MODE="all"; shift ;;
        --repo)     TARGET_REPO="$2"; shift 2 ;;
        --pr)       TARGET_PR="$2"; shift 2 ;;
        *)          usage ;;
    esac
done

if [[ "$MODE" != "all" && ( -z "$TARGET_REPO" || -z "$TARGET_PR" ) ]]; then
    usage
fi

if [[ ! -f "$INBOX_FILE" ]]; then
    log "ERROR: PR inbox not found at $INBOX_FILE. Run fetch-open-prs.sh first."
    exit 1
fi

if [[ ! -f "$WORKSPACES_CONFIG" ]]; then
    log "ERROR: Workspaces config not found at $WORKSPACES_CONFIG"
    exit 1
fi

# Map a GitHub repo name to product using workspaces.json remotes
map_repo_to_product() {
    local repo_name="$1"
    node -e "
        const config = JSON.parse(require('fs').readFileSync('$WORKSPACES_CONFIG', 'utf-8'));
        const repoName = process.argv[1];
        for (const [wsName, ws] of Object.entries(config.workspaces || {})) {
            for (const url of Object.values(ws.remotes || {})) {
                const match = url.match(/[\/:]([^\/]+?)(?:\.git)?$/);
                if (match && match[1] === repoName) {
                    console.log(ws.product || 'other');
                    process.exit(0);
                }
            }
        }
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
        log "Skipping $repo#$number — review is current"
        return 0
    fi

    local complexity
    complexity=$(get_complexity "$additions" "$deletions" "$changed_files")

    local product
    product=$(map_repo_to_product "$repo")

    log "Reviewing $repo#$number: $title"
    log "  Size: +$additions/-$deletions, $changed_files files | Complexity: $complexity | Product: ${product:-unknown}"

    # Build review prompt with embedded CLAUDE.md context
    local review_prompt=""

    # Embed product-specific CLAUDE.md if available
    local context_file="$CLAUDE_MD_DIR/${product}.md"
    if [[ -n "$product" && -f "$context_file" ]]; then
        review_prompt="## Project Context (from CLAUDE.md)\n\n$(cat "$context_file")\n\n---\n\n"
        log "  Embedded CLAUDE.md for product: $product"
    fi

    review_prompt+="$(cat <<PROMPT_EOF
You are reviewing Pull Request #${number} in the repository strokmatic/${repo}.

Steps:
1. Run: gh pr view ${number} --repo strokmatic/${repo}
2. Run: gh pr diff ${number} --repo strokmatic/${repo}
3. Perform a thorough code review covering:
   - **Correctness**: Logic errors, edge cases, null handling
   - **Security (OWASP)**: Injection, auth issues, secrets exposure, input validation
   - **Standards compliance**: Code style, naming conventions, error handling patterns
   - **Test coverage**: Are new paths tested? Are existing tests updated?
4. Output the complete review to stdout (do NOT use Write tool or Bash to write files).

Output the review in EXACTLY this format:

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
)"

    # Determine model from complexity
    local model
    model=$("$SCRIPT_DIR/model-selector.sh" "$complexity" "code review" 2>/dev/null || echo "sonnet")

    log "  Model: $model"

    # Run Claude — no workspace cd needed, the prompt embeds all context
    mkdir -p "$(dirname "$review_file")"
    local tmp_review
    tmp_review=$(mktemp "${review_file}.tmp.XXXXXX")

    echo -e "$review_prompt" | claude --model "$model" --print --allowedTools 'Bash(gh:*)' > "$tmp_review" 2>&1 || {
        log "ERROR: Review failed for $repo#$number"
        rm -f "$tmp_review"
        if [[ -f "$review_file" ]]; then
            log "Keeping previous review: $review_file"
        fi
        return 1
    }

    # Clean the review output (remove Claude preamble/footnotes)
    if [[ -x "$SCRIPT_DIR/clean-review.sh" ]]; then
        local cleaned
        cleaned=$("$SCRIPT_DIR/clean-review.sh" "$tmp_review" 2>/dev/null || cat "$tmp_review")
        echo "$cleaned" > "$tmp_review"
    fi

    mv -f "$tmp_review" "$review_file"
    log "Review complete: $review_file"
}

# Track results
REVIEWED=0
SKIPPED=0
FAILED=0

# Get PRs to review
if [[ "$MODE" == "all" ]]; then
    PR_LIST=$(node -e "
        const inbox = JSON.parse(require('fs').readFileSync('$INBOX_FILE', 'utf-8'));
        const prs = inbox.pull_requests || [];
        const toReview = prs.filter(pr => !pr.is_draft && pr.review_decision !== 'APPROVED');
        toReview.forEach(pr => {
            console.log([pr.repo, pr.number, pr.title, pr.additions, pr.deletions, pr.changed_files, pr.updated_at].join('\t'));
        });
    " 2>/dev/null || true)

    if [[ -z "$PR_LIST" ]]; then
        log "No PRs need review."
        exit 0
    fi

    TOTAL=$(echo "$PR_LIST" | wc -l | tr -d ' ')
    log "$TOTAL PR(s) to review"

    CURRENT=0
    while IFS=$'\t' read -r repo number title additions deletions changed_files updated_at; do
        CURRENT=$((CURRENT + 1))
        log "[$CURRENT/$TOTAL] $repo#$number"

        if review_single_pr "$repo" "$number" "$title" "$additions" "$deletions" "$changed_files" "$updated_at"; then
            if review_is_current "$REVIEWS_DIR/${repo}-${number}.md" "$updated_at" 2>/dev/null; then
                REVIEWED=$((REVIEWED + 1))
            else
                SKIPPED=$((SKIPPED + 1))
            fi
        else
            FAILED=$((FAILED + 1))
        fi
    done <<< "$PR_LIST"

    log "Review summary: $REVIEWED reviewed, $SKIPPED skipped, $FAILED failed"
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
        log "ERROR: PR $TARGET_REPO#$TARGET_PR not found in inbox."
        exit 1
    fi

    IFS=$'\t' read -r repo number title additions deletions changed_files updated_at <<< "$PR_DATA"
    review_single_pr "$repo" "$number" "$title" "$additions" "$deletions" "$changed_files" "$updated_at"
fi
