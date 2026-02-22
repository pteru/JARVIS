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

source "$(dirname "$0")/lib/config.sh"
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M:%S)

log_section "Fetch All Remotes"
log_info "Date: $DATE $TIME"

if [[ ! -f "$WORKSPACES_CONFIG" ]]; then
    log_error "workspaces.json not found at $WORKSPACES_CONFIG"
    exit 1
fi

# Extract unique workspace paths that have at least one remote
WORKSPACE_PATHS=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('$WORKSPACES_CONFIG', 'utf-8'));
    const ws = c.workspaces || {};
    const seen = new Set();
    Object.values(ws).forEach(w => {
        const remotes = Object.keys(w.remotes || {});
        if (remotes.length > 0 && !seen.has(w.path)) {
            seen.add(w.path);
            console.log(w.path);
        }
    });
" 2>/dev/null)

if [[ -z "$WORKSPACE_PATHS" ]]; then
    log_warn "No workspaces with remotes found"
    exit 0
fi

TOTAL=$(echo "$WORKSPACE_PATHS" | wc -l | tr -d ' ')
SUCCESS=0
FAILED=0
SKIPPED=0

log_info "Workspaces with remotes: $TOTAL"

while IFS= read -r ws_path; do
    ws_name=$(basename "$ws_path")

    if [[ ! -d "$ws_path/.git" && ! -f "$ws_path/.git" ]]; then
        log_warn "[$ws_name] Not a git repo — skipping"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    if timeout 30 git -C "$ws_path" fetch --all --quiet 2>/dev/null; then
        log_info "[$ws_name] fetched"
        SUCCESS=$((SUCCESS + 1))
    else
        log_error "[$ws_name] fetch failed or timed out"
        FAILED=$((FAILED + 1))
    fi
done <<< "$WORKSPACE_PATHS"

echo ""
log_section "Summary"
log_info "Success: $SUCCESS | Failed: $FAILED | Skipped: $SKIPPED | Total: $TOTAL"
