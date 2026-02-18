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
ORG="strokmatic"
OUTPUT_FILE="$ORCHESTRATOR_HOME/reports/pr-inbox.json"

mkdir -p "$(dirname "$OUTPUT_FILE")"

log_info "Fetching repos for org: $ORG"

# Fetch all repos (paginated), excluding archived and disabled
REPOS=$(gh api --paginate "orgs/$ORG/repos?per_page=100&type=all" \
    --jq '.[] | select(.archived == false and .disabled == false) | .name' 2>/dev/null || true)

if [[ -z "$REPOS" ]]; then
    log_error "No repos found for org $ORG (check gh auth status)"
    exit 1
fi

REPO_COUNT=$(echo "$REPOS" | wc -l | tr -d ' ')
log_info "Found $REPO_COUNT repos"

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
        --json number,title,author,createdAt,updatedAt,headRefName,baseRefName,additions,deletions,changedFiles,url,isDraft,reviewDecision \
        2>/dev/null || echo "[]")

    PR_COUNT=$(echo "$PR_JSON" | node -e "
        const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
        console.log(Array.isArray(d) ? d.length : 0);
    " 2>/dev/null || echo "0")

    if [[ "$PR_COUNT" -gt 0 ]]; then
        log_info "[$PROCESSED/$REPO_COUNT] $REPO: $PR_COUNT open PR(s)"
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
                additions: pr.additions || 0,
                deletions: pr.deletions || 0,
                changed_files: pr.changedFiles || 0,
                url: pr.url,
                is_draft: pr.isDraft || false,
                review_decision: pr.reviewDecision || ''
            }));
            console.log(JSON.stringify([...existing, ...mapped]));
        " "$ALL_PRS" "$REPO" <<< "$PR_JSON" 2>/dev/null || echo "$ALL_PRS")
    else
        # Only log every 10th empty repo to reduce noise
        if (( PROCESSED % 10 == 0 )); then
            log_info "[$PROCESSED/$REPO_COUNT] Scanning..."
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
" "$ALL_PRS" "$FETCHED_AT" > "$OUTPUT_FILE"

log_info "Done. $PRS_FOUND open PR(s) across $REPO_COUNT repos."
log_info "Output: $OUTPUT_FILE"

# Log dispatch for dashboard
"$SCRIPT_DIR/helpers/log-dispatch.sh" "pr-fetch" "Fetched $PRS_FOUND open PRs across $REPO_COUNT repos" "orchestrator" "none" "complete" 2>/dev/null || true
