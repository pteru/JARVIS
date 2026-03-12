#!/bin/bash
# Fetch all open PRs across the Strokmatic GitHub org.
# Adapted from scripts/fetch-open-prs.sh for the remote PR review service.
# Output: $DATA_DIR/pr-inbox.json
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [fetch] $*"; }

log "Fetching repos for org: $ORG"

# Fetch all repos (paginated), excluding archived and disabled
REPOS=$(gh api --paginate "orgs/$ORG/repos?per_page=100&type=all" \
    --jq '.[] | select(.archived == false and .disabled == false) | .name' 2>/dev/null || true)

if [[ -z "$REPOS" ]]; then
    log "ERROR: No repos found for org $ORG (check gh auth status)"
    exit 1
fi

REPO_COUNT=$(echo "$REPOS" | wc -l | tr -d ' ')
log "Found $REPO_COUNT repos"

# Start building JSON
FETCHED_AT=$(date -Iseconds)
ALL_PRS="[]"
PROCESSED=0
PRS_FOUND=0

for REPO in $REPOS; do
    PROCESSED=$((PROCESSED + 1))

    # Fetch open PRs with required fields
    PR_JSON=$(gh pr list \
        --repo "$ORG/$REPO" \
        --state open \
        --json number,title,author,createdAt,updatedAt,headRefName,baseRefName,headRefOid,additions,deletions,changedFiles,url,isDraft,reviewDecision,labels,comments \
        2>/dev/null || echo "[]")

    PR_COUNT=$(echo "$PR_JSON" | node -e "
        const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
        console.log(Array.isArray(d) ? d.length : 0);
    " 2>/dev/null || echo "0")

    if [[ "$PR_COUNT" -gt 0 ]]; then
        log "[$PROCESSED/$REPO_COUNT] $REPO: $PR_COUNT open PR(s)"
        PRS_FOUND=$((PRS_FOUND + PR_COUNT))

        # Transform and merge PRs
        ALL_PRS=$(node -e "
            const existing = JSON.parse(process.argv[1]);
            const prs = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
            const repo = process.argv[2];
            const mapped = prs.map(pr => ({
                repo: repo,
                number: pr.number,
                title: pr.title,
                author: pr.author?.login || 'unknown',
                created_at: pr.createdAt,
                updated_at: pr.updatedAt,
                head: pr.headRefName,
                base: pr.baseRefName,
                head_sha: pr.headRefOid || '',
                additions: pr.additions || 0,
                deletions: pr.deletions || 0,
                changed_files: pr.changedFiles || 0,
                url: pr.url,
                is_draft: pr.isDraft || false,
                review_decision: pr.reviewDecision || '',
                labels: (pr.labels || []).map(l => l.name),
                comments_count: (pr.comments || []).length
            }));
            console.log(JSON.stringify([...existing, ...mapped]));
        " "$ALL_PRS" "$REPO" <<< "$PR_JSON" 2>/dev/null || echo "$ALL_PRS")
    else
        # Only log every 10th empty repo to reduce noise
        if (( PROCESSED % 10 == 0 )); then
            log "[$PROCESSED/$REPO_COUNT] Scanning..."
        fi
    fi
done

# Write final output
node -e "
    const prs = JSON.parse(process.argv[1]);
    const output = {
        fetched_at: process.argv[2],
        pull_requests: prs
    };
    console.log(JSON.stringify(output, null, 2));
" "$ALL_PRS" "$FETCHED_AT" > "$INBOX_FILE"

log "Done. $PRS_FOUND open PR(s) across $REPO_COUNT repos → $INBOX_FILE"
