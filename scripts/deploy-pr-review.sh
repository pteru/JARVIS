#!/bin/bash
# Deploy the PR review service to the remote infrastructure server.
# Target: strokmatic@192.168.15.2:/opt/jarvis-pr-review/
#
# Uses sshpass for password-based SSH auth.
# Password is read from ~/.secrets/vk-ssh-password (same as VK health monitor).
#
# Steps:
# 1. Build stripped workspaces.json
# 2. Copy CLAUDE.md files from workspace repos
# 3. Secret scan before rsync
# 4. rsync service files to remote
# 5. scp credentials separately (never in rsync --delete)
# 6. Copy Telegram bot token
# 7. npm install --production on remote
# 8. Set up cron (idempotent)
# 9. Set file permissions
# 10. Deploy dashboard container
# 11. Smoke test (fetch + dashboard)
set -euo pipefail

AUTO_CONFIRM=false
if [[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]]; then
    AUTO_CONFIRM=true
fi

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SERVICE_SRC="$ORCHESTRATOR_HOME/services/pr-review"
REMOTE_USER="strokmatic"
REMOTE_HOST="192.168.15.2"
REMOTE_DIR="/opt/jarvis-pr-review"
REMOTE="$REMOTE_USER@$REMOTE_HOST"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── SSH with password ───────────────────────────────────────────────────────
SSH_PASS_FILE="$HOME/.secrets/vk-ssh-password"
if [[ ! -f "$SSH_PASS_FILE" ]]; then
    log_error "SSH password file not found at $SSH_PASS_FILE"
    exit 1
fi

if ! command -v sshpass &>/dev/null; then
    log_error "sshpass not installed (sudo apt install sshpass)"
    exit 1
fi

SSH_PASS=$(cat "$SSH_PASS_FILE")
SSH_OPTS="-o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new"

# Wrapper functions for remote commands
remote_ssh() {
    sshpass -p "$SSH_PASS" ssh $SSH_OPTS "$REMOTE" "$@"
}

remote_rsync() {
    sshpass -p "$SSH_PASS" rsync -e "ssh $SSH_OPTS" "$@"
}

remote_scp() {
    sshpass -p "$SSH_PASS" scp -o PreferredAuthentications=password -o PubkeyAuthentication=no "$@"
}

# ─── Pre-flight checks ──────────────────────────────────────────────────────
log_info "Pre-flight checks..."

if ! ping -c 1 -W 3 "$REMOTE_HOST" &>/dev/null; then
    log_error "Cannot reach $REMOTE_HOST — check VPN/network"
    exit 1
fi

if ! remote_ssh "echo ok" &>/dev/null; then
    log_error "SSH connection to $REMOTE failed"
    exit 1
fi

log_info "Remote host reachable"

# ─── Step 1: Build stripped workspaces.json ──────────────────────────────────
log_info "Step 1/11: Building stripped workspaces.json"

node -e "
const config = JSON.parse(require('fs').readFileSync('$ORCHESTRATOR_HOME/config/orchestrator/workspaces.json', 'utf-8'));
const stripped = { workspaces: {} };
for (const [name, ws] of Object.entries(config.workspaces || {})) {
    const githubRemotes = {};
    for (const [key, url] of Object.entries(ws.remotes || {})) {
        if (url.includes('github.com')) githubRemotes[key] = url;
    }
    if (Object.keys(githubRemotes).length > 0) {
        stripped.workspaces[name] = {
            product: ws.product || 'other',
            remotes: githubRemotes
        };
    }
}
console.log(JSON.stringify(stripped, null, 2));
" > "$SERVICE_SRC/config/workspaces.json"

# ─── Step 2: Copy CLAUDE.md files from workspace repos ──────────────────────
log_info "Step 2/11: Copying CLAUDE.md files"

for product in diemaster spotfusion visionking; do
    WORKSPACE_DIR="$ORCHESTRATOR_HOME/workspaces/strokmatic/$product"
    CLAUDE_MD="$WORKSPACE_DIR/.claude/CLAUDE.md"
    TARGET="$SERVICE_SRC/config/claude-md/${product}.md"

    if [[ -f "$CLAUDE_MD" ]]; then
        cp "$CLAUDE_MD" "$TARGET"
        log_info "  Copied $product CLAUDE.md ($(wc -l < "$TARGET") lines)"
    else
        log_warn "  No CLAUDE.md found for $product at $CLAUDE_MD"
    fi
done

# ─── Step 3: Secret scan ────────────────────────────────────────────────────
log_info "Step 3/11: Scanning for secrets"

LEAK_FOUND=false
PATTERNS=(
    '\.env$'
    '\.key$'
    '\.pem$'
    'service-account.*\.json'
    'PRIVATE KEY'
    'bot_token.*='
    'password.*='
)

# Only scan actual script/config files, not credentials dir
while IFS= read -r -d '' file; do
    for pattern in "${PATTERNS[@]}"; do
        if grep -qEi "$pattern" "$file" 2>/dev/null; then
            log_warn "  Potential secret in: $file (pattern: $pattern)"
            LEAK_FOUND=true
        fi
    done
done < <(find "$SERVICE_SRC" -type f \( -name '*.sh' -o -name '*.mjs' -o -name '*.json' \) \
    -not -path '*/credentials/*' \
    -not -path '*/node_modules/*' \
    -not -name 'package-lock.json' \
    -print0)

if [[ "$LEAK_FOUND" == "true" ]]; then
    log_warn "Secret scan found potential leaks — review above"
    if [[ "$AUTO_CONFIRM" == "true" ]]; then
        log_info "  Auto-confirmed (--yes flag)"
    else
        read -r -p "Continue deployment? [y/N] " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            log_error "Deployment aborted by user"
            exit 1
        fi
    fi
fi

# ─── Step 4: rsync service files ────────────────────────────────────────────
log_info "Step 4/11: Syncing service files to $REMOTE:$REMOTE_DIR"

remote_ssh "echo '$SSH_PASS' | sudo -S mkdir -p $REMOTE_DIR && echo '$SSH_PASS' | sudo -S chown $REMOTE_USER:$REMOTE_USER $REMOTE_DIR"

remote_rsync -avz --delete \
    --exclude 'data/' \
    --exclude 'reviews/' \
    --exclude 'reports/' \
    --exclude 'logs/' \
    --exclude 'credentials/' \
    --exclude 'node_modules/' \
    --exclude '.git/' \
    "$SERVICE_SRC/" "$REMOTE:$REMOTE_DIR/"

log_info "  Files synced"

# ─── Step 5: Deploy credentials separately ───────────────────────────────────
log_info "Step 5/11: Deploying credentials"

GCP_KEY="$ORCHESTRATOR_HOME/config/credentials/gcp-service-account.json"
if [[ -f "$GCP_KEY" ]]; then
    remote_ssh "mkdir -p $REMOTE_DIR/credentials"
    remote_scp "$GCP_KEY" "$REMOTE:$REMOTE_DIR/credentials/gcp-service-account.json"
    remote_ssh "chmod 600 $REMOTE_DIR/credentials/gcp-service-account.json"
    log_info "  GCP service account key deployed"
else
    log_warn "  GCP key not found at $GCP_KEY — Drive upload will fail"
fi

# ─── Step 6: Copy Telegram bot token ────────────────────────────────────────
log_info "Step 6/11: Deploying Telegram bot token"

LOCAL_TOKEN="$HOME/.secrets/telegram-bot-token"
if [[ -f "$LOCAL_TOKEN" ]]; then
    remote_ssh "mkdir -p ~/.secrets"
    remote_scp "$LOCAL_TOKEN" "$REMOTE:~/.secrets/telegram-bot-token"
    remote_ssh "chmod 600 ~/.secrets/telegram-bot-token"
    log_info "  Telegram token deployed"
else
    log_warn "  Local token not found at $LOCAL_TOKEN"
fi

# ─── Step 7: npm install on remote ──────────────────────────────────────────
log_info "Step 7/11: Installing npm dependencies"

remote_ssh "source ~/.nvm/nvm.sh && cd $REMOTE_DIR && npm install --production" 2>&1 | while IFS= read -r line; do
    echo "  [remote] $line"
done

# ─── Step 8: Set up cron ────────────────────────────────────────────────────
log_info "Step 8/11: Setting up cron job"

# Cron needs nvm sourced to find node/claude
CRON_ENTRY="*/5 * * * * source /home/strokmatic/.nvm/nvm.sh && $REMOTE_DIR/run.sh >> $REMOTE_DIR/logs/cron.log 2>&1"

# Check if cron entry already exists
if remote_ssh "crontab -l 2>/dev/null | grep -qF 'jarvis-pr-review/run.sh'"; then
    log_info "  Cron entry already exists — updating"
    remote_ssh "crontab -l 2>/dev/null | grep -vF 'jarvis-pr-review/run.sh' | { cat; echo '$CRON_ENTRY'; } | crontab -"
else
    log_info "  Adding cron entry"
    remote_ssh "{ crontab -l 2>/dev/null; echo '$CRON_ENTRY'; } | crontab -"
fi

# ─── Step 9: Set file permissions ────────────────────────────────────────────
log_info "Step 9/11: Setting file permissions"

remote_ssh "
    chmod +x $REMOTE_DIR/run.sh
    chmod +x $REMOTE_DIR/fetch-open-prs.sh
    chmod +x $REMOTE_DIR/review-pr.sh
    chmod +x $REMOTE_DIR/model-selector.sh
    chmod +x $REMOTE_DIR/clean-review.sh
    chmod +x $REMOTE_DIR/notify.sh
    chmod +x $REMOTE_DIR/post-review.sh 2>/dev/null || true
    chmod +x $REMOTE_DIR/label-prs.sh 2>/dev/null || true
    chmod +x $REMOTE_DIR/build-check.sh 2>/dev/null || true
    chmod +x $REMOTE_DIR/scripts/backfill-metadata.sh 2>/dev/null || true
    mkdir -p $REMOTE_DIR/{data,reviews,reviews/archive,reports,logs}
"

# ─── Step 10: Deploy dashboard ──────────────────────────────────────────────
DASHBOARD_SRC="$ORCHESTRATOR_HOME/tools/pr-review-dashboard"
DASHBOARD_REMOTE_DIR="/opt/jarvis-pr-review-dashboard"

if [[ -d "$DASHBOARD_SRC" ]]; then
    log_info "Step 10/11: Deploying PR review dashboard"

    remote_ssh "echo '$SSH_PASS' | sudo -S mkdir -p $DASHBOARD_REMOTE_DIR && echo '$SSH_PASS' | sudo -S chown $REMOTE_USER:$REMOTE_USER $DASHBOARD_REMOTE_DIR"

    remote_rsync -avz --delete \
        --exclude 'node_modules/' \
        --exclude 'frontend/node_modules/' \
        --exclude 'frontend/dist/' \
        --exclude '__pycache__/' \
        --exclude '.venv/' \
        --exclude 'static/' \
        "$DASHBOARD_SRC/" "$REMOTE:$DASHBOARD_REMOTE_DIR/"

    log_info "  Dashboard files synced"

    # Build and start container
    if remote_ssh "command -v docker-compose &>/dev/null || command -v docker &>/dev/null"; then
        log_info "  Building and starting dashboard container"
        remote_ssh "
            cd $DASHBOARD_REMOTE_DIR
            if command -v docker-compose &>/dev/null; then
                docker-compose up -d --build 2>&1 | tail -5
            else
                docker compose up -d --build 2>&1 | tail -5
            fi
        " 2>&1 | while IFS= read -r line; do
            echo "  [remote] $line"
        done
        log_info "  Dashboard container deployed"
    else
        log_warn "  Docker not found on remote — dashboard container not started"
    fi
else
    log_info "Step 10/11: Skipping dashboard (source not found at $DASHBOARD_SRC)"
fi

# ─── Step 11: Smoke test ────────────────────────────────────────────────────
log_info "Step 11/11: Running smoke tests"

# Test 1: Fetch open PRs
log_info "  Smoke test 1: PR fetch"
SMOKE_RESULT=$(remote_ssh "
    source ~/.nvm/nvm.sh
    export SERVICE_DIR=$REMOTE_DIR
    cd $REMOTE_DIR
    bash fetch-open-prs.sh 2>&1 | tail -3
" 2>&1 || echo "SMOKE TEST FAILED")

echo "$SMOKE_RESULT" | while IFS= read -r line; do
    log_info "  [smoke] $line"
done

if echo "$SMOKE_RESULT" | grep -q "Done\.\|open PR"; then
    log_info "  PR fetch smoke test PASSED"
else
    log_warn "  PR fetch smoke test may have failed — check output above"
fi

# Test 2: Dashboard health
if [[ -d "$DASHBOARD_SRC" ]]; then
    log_info "  Smoke test 2: Dashboard"
    DASHBOARD_RESULT=$(remote_ssh "curl -sf http://localhost:8091/api/pipeline/status 2>&1 | head -1" 2>/dev/null || echo "FAILED")
    if echo "$DASHBOARD_RESULT" | grep -q '{'; then
        log_info "  Dashboard smoke test PASSED (API responding)"
    else
        log_warn "  Dashboard smoke test FAILED — API not responding yet (may need a moment to start)"
    fi
fi

# ─── Done ────────────────────────────────────────────────────────────────────
log_info ""
log_info "Deployment complete!"
log_info "  Service: $REMOTE:$REMOTE_DIR"
log_info "  Dashboard: $REMOTE:$DASHBOARD_REMOTE_DIR (http://$REMOTE_HOST:8091)"
log_info "  Cron: every 5 minutes"
log_info ""
log_info "Next steps:"
log_info "  1. Verify: ssh $REMOTE '$REMOTE_DIR/run.sh --force'"
log_info "  2. Monitor: ssh $REMOTE 'tail -f $REMOTE_DIR/logs/run-\$(date +%Y-%m-%d).log'"
log_info "  3. Dashboard: http://$REMOTE_HOST:8091"
