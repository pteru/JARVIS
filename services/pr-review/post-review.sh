#!/bin/bash
# Post reviews as GitHub PR comments.
# Posts cleaned review content as a comment (not a formal review),
# so developers see the feedback but it doesn't block merge.
#
# Usage: post-review.sh --all | --repo <repo> --pr <number>
#
# Idempotent: only re-posts if review content has changed (md5sum hash comparison).
# Skips draft PRs.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"
source "$SCRIPT_DIR/lib/review-metadata.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [post-review] $*"; }

usage() {
    echo "Usage: post-review.sh --all | --repo <repo> --pr <number>"
    echo ""
    echo "Post review comments to GitHub PRs."
    echo ""
    echo "Options:"
    echo "  --all                Post all pending reviews"
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
    log "ERROR: PR inbox not found at $INBOX_FILE"
    exit 1
fi

# Get the service version from package.json (if available)
SERVICE_VERSION=$(node -e "
    try {
        const p = JSON.parse(require('fs').readFileSync('$SCRIPT_DIR/package.json','utf-8'));
        console.log(p.version || 'unknown');
    } catch(e) { console.log('unknown'); }
" 2>/dev/null || echo "unknown")

# Post a single review as a GitHub PR comment.
# Args:
#   $1 - repo name
#   $2 - PR number
post_single_review() {
    local repo="$1"
    local number="$2"
    local review_file="$REVIEWS_DIR/${repo}-${number}.md"
    local meta_file="$REVIEWS_DIR/${repo}-${number}.meta.json"

    if [[ ! -f "$review_file" ]]; then
        log "Skipping $repo#$number — no review file"
        return 0
    fi

    if [[ ! -f "$meta_file" ]]; then
        log "Skipping $repo#$number — no metadata file"
        return 0
    fi

    # Check if PR is draft
    local is_draft
    is_draft=$(node -e "
        const inbox = JSON.parse(require('fs').readFileSync('$INBOX_FILE', 'utf-8'));
        const pr = (inbox.pull_requests || []).find(p => p.repo === '$repo' && p.number === $number);
        if (!pr) { console.log('not_found'); process.exit(0); }
        console.log(pr.is_draft === true ? 'true' : 'false');
    " 2>/dev/null || echo "not_found")

    if [[ "$is_draft" == "true" ]]; then
        log "Skipping $repo#$number — draft PR"
        return 0
    fi

    if [[ "$is_draft" == "not_found" ]]; then
        log "Skipping $repo#$number — not found in inbox"
        return 0
    fi

    # Clean the review content
    local cleaned_content
    if [[ -x "$SCRIPT_DIR/clean-review.sh" ]]; then
        cleaned_content=$("$SCRIPT_DIR/clean-review.sh" "$review_file" 2>/dev/null || cat "$review_file")
    else
        cleaned_content=$(cat "$review_file")
    fi

    # Compute hash of cleaned content
    local current_hash
    current_hash=$(echo "$cleaned_content" | md5sum | cut -d' ' -f1)

    # Check if already posted with same content
    local posted_hash
    posted_hash=$(read_review_metadata "$repo" "$number" "posted_to_github" 2>/dev/null || echo "")

    if [[ -n "$posted_hash" ]]; then
        # Extract the review_hash from the posted_to_github object
        local existing_hash
        existing_hash=$(node -e "
            const fs = require('fs');
            const meta = JSON.parse(fs.readFileSync('$meta_file', 'utf-8'));
            const p = meta.posted_to_github;
            if (p && p.review_hash) { console.log(p.review_hash); }
            else { console.log(''); }
        " 2>/dev/null || echo "")

        if [[ "$existing_hash" == "$current_hash" ]]; then
            log "Skipping $repo#$number — already posted (hash matches)"
            return 0
        fi

        log "Review content changed for $repo#$number — will update comment"
    fi

    # Determine the model used (from metadata or fallback)
    local model="claude"

    # Prepend banner
    local banner
    banner="> :robot: **JARVIS AI Review** (v${SERVICE_VERSION}, ${model}) — auto-generated"
    local body
    body="${banner}"$'\n\n'"${cleaned_content}"

    # Post or update comment
    local comment_id
    local existing_comment_id
    existing_comment_id=$(node -e "
        const fs = require('fs');
        try {
            const meta = JSON.parse(fs.readFileSync('$meta_file', 'utf-8'));
            const p = meta.posted_to_github;
            if (p && p.comment_id) { console.log(p.comment_id); }
            else { console.log(''); }
        } catch(e) { console.log(''); }
    " 2>/dev/null || echo "")

    if [[ -n "$existing_comment_id" ]]; then
        # Update existing comment via API
        log "Updating existing comment $existing_comment_id on $repo#$number"
        local update_response
        update_response=$(gh api \
            "repos/${ORG}/${repo}/issues/comments/${existing_comment_id}" \
            --method PATCH \
            --field body="$body" \
            --jq '.id' 2>/dev/null || echo "")

        if [[ -n "$update_response" ]]; then
            comment_id="$update_response"
            log "Updated comment $comment_id on $repo#$number"
        else
            log "WARNING: Failed to update comment $existing_comment_id — posting new comment"
            existing_comment_id=""
        fi
    fi

    if [[ -z "$existing_comment_id" ]]; then
        # Post new comment via API (returns JSON with .id)
        comment_id=$(gh api \
            "repos/${ORG}/${repo}/issues/${number}/comments" \
            --method POST \
            --field body="$body" \
            --jq '.id' 2>/dev/null || echo "")

        if [[ -z "$comment_id" ]]; then
            log "ERROR: Failed to post comment on $repo#$number"
            return 1
        fi

        log "Posted comment $comment_id on $repo#$number"
    fi

    # Update metadata with posted info
    if update_posted_metadata "$repo" "$number" "$comment_id" "$current_hash"; then
        log "Metadata updated for $repo#$number"
    else
        log "WARNING: Failed to update posted metadata for $repo#$number"
    fi

    return 0
}

# Track results
POSTED=0
SKIPPED=0
FAILED=0

if [[ "$MODE" == "all" ]]; then
    # Iterate all review files that have corresponding open PRs
    PR_LIST=$(node -e "
        const fs = require('fs');
        const inbox = JSON.parse(fs.readFileSync('$INBOX_FILE', 'utf-8'));
        const prs = inbox.pull_requests || [];
        const reviewsDir = '$REVIEWS_DIR';

        // Only post for PRs that have review files
        prs.filter(pr => !pr.is_draft).forEach(pr => {
            const reviewFile = reviewsDir + '/' + pr.repo + '-' + pr.number + '.md';
            if (fs.existsSync(reviewFile)) {
                console.log(pr.repo + '\t' + pr.number);
            }
        });
    " 2>/dev/null || true)

    if [[ -z "$PR_LIST" ]]; then
        log "No reviews to post."
        exit 0
    fi

    TOTAL=$(echo "$PR_LIST" | wc -l | tr -d ' ')
    log "Found $TOTAL review(s) to check for posting"

    while IFS=$'\t' read -r repo number; do
        if post_single_review "$repo" "$number"; then
            POSTED=$((POSTED + 1))
        else
            FAILED=$((FAILED + 1))
        fi
    done <<< "$PR_LIST"

    log "Post summary: $POSTED posted/checked, $FAILED failed"
else
    # Single PR mode
    if post_single_review "$TARGET_REPO" "$TARGET_PR"; then
        POSTED=1
    else
        FAILED=1
    fi
fi

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi

exit 0
