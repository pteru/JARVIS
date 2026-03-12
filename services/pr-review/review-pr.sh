#!/bin/bash
# Review open pull requests using Claude.
# Adapted from scripts/review-pr.sh for the remote PR review service.
# Key difference: CLAUDE.md content is embedded in the prompt (no workspace clones needed).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"
source "$SCRIPT_DIR/lib/review-metadata.sh"
source "$SCRIPT_DIR/lib/pr-context.sh"

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

# Check if review is current using commit SHA comparison.
# Falls back to mtime-based check for reviews without metadata (backward compat).
# Args:
#   $1 - review file path
#   $2 - PR updated_at timestamp (for mtime fallback)
#   $3 - PR head_sha (optional, for SHA-based comparison)
review_is_current() {
    local review_file="$1"
    local pr_updated_at="$2"
    local pr_head_sha="${3:-}"

    if [[ ! -f "$review_file" ]]; then
        return 1  # No review exists
    fi

    # Extract repo-number from review file path for metadata lookup
    local basename
    basename=$(basename "$review_file" .md)

    # SHA-based check: compare current head SHA with reviewed head SHA
    if [[ -n "$pr_head_sha" ]]; then
        local reviewed_sha
        # Parse repo and number from basename (e.g. "my-repo-123" -> repo="my-repo" number="123")
        local repo number
        number="${basename##*-}"
        repo="${basename%-*}"
        reviewed_sha=$(read_review_metadata "$repo" "$number" "current_head_sha")

        if [[ -n "$reviewed_sha" ]]; then
            if [[ "$reviewed_sha" == "$pr_head_sha" ]]; then
                return 0  # Review matches current head SHA — current
            else
                return 1  # SHA mismatch — stale, needs re-review
            fi
        fi
        # No metadata SHA found — fall through to mtime check
    fi

    # Fallback: mtime-based check for reviews without metadata
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

# Archive the current review file before overwriting it.
# Gated by the archive_review_versions feature flag.
# Args:
#   $1 - repo name
#   $2 - PR number
#   $3 - review file path
archive_previous_review() {
    local repo="$1"
    local number="$2"
    local review_file="$3"

    if [[ ! -f "$review_file" ]]; then
        return 0
    fi

    # Check feature flag
    local archive_enabled
    archive_enabled=$(node -e "
        const c = JSON.parse(require('fs').readFileSync('$SERVICE_CONFIG','utf-8'));
        console.log(c.archive_review_versions === true ? 'true' : 'false');
    " 2>/dev/null || echo "false")

    if [[ "$archive_enabled" != "true" ]]; then
        return 0
    fi

    local version
    version=$(read_review_metadata "$repo" "$number" "current_version")
    if [[ -z "$version" ]]; then
        version="0"
    fi

    local archive_subdir="$ARCHIVE_DIR/${repo}-${number}"
    mkdir -p "$archive_subdir"
    cp "$review_file" "$archive_subdir/v${version}.md"
    log "  Archived previous review as v${version}: $archive_subdir/v${version}.md"
}

# Build a contextual re-review prompt that includes the previous review,
# new commits since last review, and PR comments.
# Gated by the re_review_include_previous feature flag.
# Args:
#   $1 - repo name
#   $2 - PR number
#   $3 - review file path (previous review)
#   $4 - title
#   $5 - complexity
# Output: the contextual prompt section to stdout, or empty if flag is off / no previous review
build_rereview_context() {
    local repo="$1"
    local number="$2"
    local review_file="$3"
    local title="$4"
    local complexity="$5"

    # Not a re-review if no previous review exists
    if [[ ! -f "$review_file" ]]; then
        return 0
    fi

    # Check feature flag
    local flag_value
    flag_value=$(node -e "
        const c = JSON.parse(require('fs').readFileSync('$SERVICE_CONFIG','utf-8'));
        console.log(c.re_review_include_previous === true ? 'true' : 'false');
    " 2>/dev/null || echo "false")

    if [[ "$flag_value" != "true" ]]; then
        return 0
    fi

    # Gather metadata from previous review
    local prev_version prev_date prev_sha
    prev_version=$(read_review_metadata "$repo" "$number" "current_version")
    prev_date=$(read_review_metadata "$repo" "$number" "current_reviewed_at")
    prev_sha=$(read_review_metadata "$repo" "$number" "current_head_sha")

    if [[ -z "$prev_version" ]]; then
        prev_version="1"
    fi
    if [[ -z "$prev_date" ]]; then
        prev_date="unknown"
    fi

    local previous_content
    previous_content=$(cat "$review_file")

    # Fetch new commits and PR comments
    local new_commits=""
    if [[ -n "$prev_sha" ]]; then
        new_commits=$(fetch_commits_since "$repo" "$number" "$prev_sha")
    else
        new_commits="(Previous review SHA not available — showing full diff)"
    fi

    local pr_comments
    pr_comments=$(fetch_pr_comments "$repo" "$number")

    # Build the contextual section
    cat <<CONTEXT_EOF
## Previous Review (v${prev_version}, reviewed ${prev_date})

${previous_content}

## Changes Since Previous Review

### New Commits (since ${prev_sha:-unknown})
${new_commits}

### PR Comments
${pr_comments}

---

You are RE-REVIEWING PR #${number} in strokmatic/${repo}.
Focus on NEW CHANGES since commit ${prev_sha:-unknown}.
Acknowledge previously-raised findings that have been addressed.
Note any findings from the previous review that remain unresolved.

CONTEXT_EOF
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
    local head_sha="${8:-}"

    local review_file="$REVIEWS_DIR/${repo}-${number}.md"

    # Check if already reviewed and current (SHA-based with mtime fallback)
    if review_is_current "$review_file" "$updated_at" "$head_sha"; then
        log "Skipping $repo#$number — review is current"
        return 0
    fi

    local complexity
    complexity=$(get_complexity "$additions" "$deletions" "$changed_files")

    local product
    product=$(map_repo_to_product "$repo")

    # Detect if this is a re-review (previous review exists but is stale)
    local is_rereview="false"
    if [[ -f "$review_file" ]]; then
        is_rereview="true"
    fi

    log "Reviewing $repo#$number: $title"
    log "  Size: +$additions/-$deletions, $changed_files files | Complexity: $complexity | Product: ${product:-unknown}"
    if [[ "$is_rereview" == "true" ]]; then
        log "  Mode: re-review (previous review exists)"
    fi

    # Build review prompt with embedded CLAUDE.md context
    local review_prompt=""

    # Embed product-specific CLAUDE.md if available
    local context_file="$CLAUDE_MD_DIR/${product}.md"
    if [[ -n "$product" && -f "$context_file" ]]; then
        review_prompt="## Project Context (from CLAUDE.md)\n\n$(cat "$context_file")\n\n---\n\n"
        log "  Embedded CLAUDE.md for product: $product"
    fi

    # Build contextual re-review prompt if applicable
    local rereview_context=""
    if [[ "$is_rereview" == "true" ]]; then
        rereview_context=$(build_rereview_context "$repo" "$number" "$review_file" "$title" "$complexity")
    fi

    if [[ -n "$rereview_context" ]]; then
        # Contextual re-review prompt: includes previous review + delta instructions
        review_prompt+="${rereview_context}"
        review_prompt+="$(cat <<PROMPT_EOF
Steps:
1. Run: gh pr view ${number} --repo strokmatic/${repo}
2. Run: gh pr diff ${number} --repo strokmatic/${repo}
3. Review the FULL diff but focus your attention on changes since the previous review.
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

## Delta from Previous Review

### Addressed Findings
<list findings from previous review that have been resolved, or "None">

### Unresolved Findings
<list findings from previous review that remain unresolved, or "None">

### New Findings
<list new issues found in changes since the previous review, or "None">

## Verdict
<One of: APPROVE | APPROVE WITH COMMENTS | CHANGES REQUESTED>

<Brief justification for verdict>
PROMPT_EOF
)"
        log "  Prompt: contextual re-review (with previous review context)"
    else
        # Standard first-review or re-review without context (flag off)
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
    fi

    # Determine model from complexity
    local model
    model=$("$SCRIPT_DIR/model-selector.sh" "$complexity" "code review" 2>/dev/null || echo "sonnet")

    log "  Model: $model"

    # Archive previous review before overwriting (if applicable)
    if [[ "$is_rereview" == "true" ]]; then
        archive_previous_review "$repo" "$number" "$review_file"
    fi

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

    # Write review metadata sidecar with the head SHA
    if write_review_metadata "$repo" "$number" "$head_sha"; then
        log "Metadata written: ${repo}-${number}.meta.json"
    else
        log "WARNING: Failed to write metadata for $repo#$number"
    fi

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
            console.log([pr.repo, pr.number, pr.title, pr.additions, pr.deletions, pr.changed_files, pr.updated_at, pr.head_sha || ''].join('\t'));
        });
    " 2>/dev/null || true)

    if [[ -z "$PR_LIST" ]]; then
        log "No PRs need review."
        exit 0
    fi

    TOTAL=$(echo "$PR_LIST" | wc -l | tr -d ' ')
    log "$TOTAL PR(s) to review"

    CURRENT=0
    while IFS=$'\t' read -r repo number title additions deletions changed_files updated_at head_sha; do
        CURRENT=$((CURRENT + 1))
        log "[$CURRENT/$TOTAL] $repo#$number"

        if review_single_pr "$repo" "$number" "$title" "$additions" "$deletions" "$changed_files" "$updated_at" "$head_sha"; then
            if review_is_current "$REVIEWS_DIR/${repo}-${number}.md" "$updated_at" "$head_sha" 2>/dev/null; then
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
            console.log([pr.repo, pr.number, pr.title, pr.additions, pr.deletions, pr.changed_files, pr.updated_at, pr.head_sha || ''].join('\t'));
        } else {
            process.exit(1);
        }
    " 2>/dev/null || true)

    if [[ -z "$PR_DATA" ]]; then
        log "ERROR: PR $TARGET_REPO#$TARGET_PR not found in inbox."
        exit 1
    fi

    IFS=$'\t' read -r repo number title additions deletions changed_files updated_at head_sha <<< "$PR_DATA"
    review_single_pr "$repo" "$number" "$title" "$additions" "$deletions" "$changed_files" "$updated_at" "$head_sha"
fi
