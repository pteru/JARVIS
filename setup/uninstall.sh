#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"
MCP_SERVERS_PATH="$HOME/.claude/mcp_servers"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Claude Orchestrator Uninstall                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

echo "This will remove:"
echo "  - Orchestrator directory: $ORCHESTRATOR_HOME"
echo "  - MCP servers: $MCP_SERVERS_PATH/{backlog-manager,changelog-writer,workspace-analyzer,task-dispatcher,report-generator}"
echo "  - Cron jobs containing 'claude-orchestrator'"
echo "  - Shell aliases from .zshrc/.bashrc"
echo ""

read -p "Are you sure? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

# Remove MCP servers
log_info "Removing MCP servers..."
for server in backlog-manager changelog-writer workspace-analyzer task-dispatcher report-generator; do
    if [[ -d "$MCP_SERVERS_PATH/$server" ]]; then
        rm -rf "$MCP_SERVERS_PATH/$server"
        log_info "  Removed $server"
    fi
done

# Remove cron jobs
log_info "Removing cron jobs..."
if crontab -l 2>/dev/null | grep -q "claude-orchestrator"; then
    crontab -l 2>/dev/null | grep -v "claude-orchestrator" | crontab -
    log_info "  Cron jobs removed"
else
    log_info "  No cron jobs found"
fi

# Remove shell integration
log_info "Removing shell aliases..."
for rcfile in "$HOME/.zshrc" "$HOME/.bashrc"; do
    if [[ -f "$rcfile" ]] && grep -q "# Claude Orchestrator" "$rcfile"; then
        sed -i '/# Claude Orchestrator/,/^$/d' "$rcfile"
        log_info "  Cleaned $rcfile"
    fi
done

# Remove orchestrator directory
log_info "Removing orchestrator directory..."
if [[ -d "$ORCHESTRATOR_HOME" ]]; then
    rm -rf "$ORCHESTRATOR_HOME"
    log_info "  Removed $ORCHESTRATOR_HOME"
fi

# Note about Claude config
log_warn "Claude Code config (~/.claude/config.json) was NOT modified."
log_warn "You may want to remove the orchestrator MCP server entries manually."

echo ""
log_info "Uninstall complete."
echo ""
