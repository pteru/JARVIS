#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${BLUE}═══ $1 ═══${NC}\n"; }

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M:%S)

log_section "Update GitHub Access Matrix"
log_info "Date: $DATE $TIME"

ORG="strokmatic"
ACCESS_TSV="/tmp/gh-access-data.tsv"
PROTECTION_TSV="/tmp/gh-branch-protection.tsv"
BUILDER="$SCRIPT_DIR/helpers/build-access-matrix.mjs"
OUTPUT="$ORCHESTRATOR_HOME/reports/github-access-matrix.md"

# Ensure helper exists
if [[ ! -f "$BUILDER" ]]; then
    log_error "Helper not found: $BUILDER"
    exit 1
fi

# Step 1: Fetch collaborator permissions
log_info "Fetching collaborator permissions..."
> "$ACCESS_TSV"
REPOS=$(gh api "orgs/$ORG/repos" --paginate --jq '.[].name' 2>/dev/null | sort)

for repo in $REPOS; do
    gh api "repos/$ORG/$repo/collaborators" --paginate \
        --jq ".[] | \"$repo\t\(.login)\t\(.role_name)\"" 2>/dev/null >> "$ACCESS_TSV" || true
done
ACCESS_COUNT=$(wc -l < "$ACCESS_TSV" | tr -d ' ')
log_info "Collected $ACCESS_COUNT access entries"

# Step 2: Fetch branch protection status
log_info "Fetching branch protection status..."
> "$PROTECTION_TSV"

for repo in $REPOS; do
    for branch in develop master main; do
        status=$(gh api "repos/$ORG/$repo/branches/$branch/protection" 2>/dev/null) || continue
        pr_required=$(echo "$status" | node -e "
            const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
            console.log(d.required_pull_request_reviews ? 'yes' : 'no');
        " 2>/dev/null)
        echo -e "$repo\t$branch\t$pr_required" >> "$PROTECTION_TSV"
    done
done
PROT_COUNT=$(wc -l < "$PROTECTION_TSV" | tr -d ' ')
log_info "Collected $PROT_COUNT protection entries"

# Step 3: Build the markdown report
log_info "Generating report..."
node "$BUILDER"

log_info "Report written to: $OUTPUT"
