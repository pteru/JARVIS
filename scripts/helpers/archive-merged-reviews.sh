#!/bin/bash
# Archives PR review files for PRs that have been merged or closed.
# Moves them from reports/pr-reviews/ to reports/pr-reviews/archived/
# Usage: archive-merged-reviews.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
REVIEWS_DIR="$ORCHESTRATOR_HOME/reports/pr-reviews"
ARCHIVE_DIR="$REVIEWS_DIR/archived"
INBOX_FILE="$ORCHESTRATOR_HOME/reports/pr-inbox.json"
ORG="strokmatic"

mkdir -p "$ARCHIVE_DIR"

ARCHIVED=0
KEPT=0

for review_file in "$REVIEWS_DIR"/*.md; do
    [[ -f "$review_file" ]] || continue

    filename=$(basename "$review_file" .md)

    # Extract repo and PR number from filename: <repo>-<number>.md
    # PR number is the last dash-separated segment
    pr_number="${filename##*-}"
    repo="${filename%-*}"

    # Check PR state via gh CLI
    pr_state=$(gh pr view "$pr_number" --repo "$ORG/$repo" --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")

    if [[ "$pr_state" == "MERGED" || "$pr_state" == "CLOSED" ]]; then
        mv "$review_file" "$ARCHIVE_DIR/"
        log_info "Archived: $filename ($pr_state)"
        ARCHIVED=$((ARCHIVED + 1))
    else
        KEPT=$((KEPT + 1))
    fi
done

log_info "Done. Archived: $ARCHIVED, Kept: $KEPT"

# Log dispatch for dashboard
"$SCRIPT_DIR/log-dispatch.sh" "pr-archive" "Archived $ARCHIVED merged PR reviews, $KEPT kept" "orchestrator" "none" "complete" 2>/dev/null || true
