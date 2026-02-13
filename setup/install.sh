#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"
CLAUDE_CONFIG_DIR="$HOME/.claude"
MCP_SERVERS_PATH="$CLAUDE_CONFIG_DIR/mcp_servers"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Claude Orchestrator Installation                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log_info "Repository: $REPO_ROOT"
log_info "Installation target: $ORCHESTRATOR_HOME"
log_info "Claude Code config: $CLAUDE_CONFIG_DIR"
log_info "MCP servers: $MCP_SERVERS_PATH"
echo ""

# Check prerequisites
log_info "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    log_error "npm is not installed"
    exit 1
fi

if ! command -v claude-code &> /dev/null; then
    log_warn "Claude Code is not installed or not in PATH"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if orchestrator directory exists
if [[ -d "$ORCHESTRATOR_HOME" ]]; then
    log_warn "Directory $ORCHESTRATOR_HOME already exists"
    read -p "Overwrite existing installation? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Installation cancelled"
        exit 1
    fi
    log_info "Backing up existing installation..."
    mv "$ORCHESTRATOR_HOME" "$ORCHESTRATOR_HOME.backup.$(date +%Y%m%d-%H%M%S)"
fi

# Create directory structure
log_info "Creating directory structure..."
mkdir -p "$ORCHESTRATOR_HOME"/{config/orchestrator,backlogs,changelogs,reports,logs,scripts,prompts/templates}

# Copy orchestrator files
log_info "Copying orchestrator files..."
cp -r "$REPO_ROOT/scripts/"* "$ORCHESTRATOR_HOME/scripts/"
cp -r "$REPO_ROOT/prompts/"* "$ORCHESTRATOR_HOME/prompts/"
cp "$REPO_ROOT/CLAUDE.md" "$ORCHESTRATOR_HOME/"

# Copy config files
cp -r "$REPO_ROOT/config/orchestrator/"* "$ORCHESTRATOR_HOME/config/"

# Create workspaces.json from example
if [[ -f "$REPO_ROOT/config/orchestrator/workspaces.json.example" ]]; then
    cp "$REPO_ROOT/config/orchestrator/workspaces.json.example" \
       "$ORCHESTRATOR_HOME/config/workspaces.json"
    log_info "Created workspaces.json from example - edit with your workspaces"
fi

# Make scripts executable
chmod +x "$ORCHESTRATOR_HOME/scripts/"*.sh

# Install MCP servers
log_info "Installing MCP servers..."
mkdir -p "$MCP_SERVERS_PATH"

# Backup existing Claude config
if [[ -f "$CLAUDE_CONFIG_DIR/config.json" ]]; then
    log_info "Backing up existing Claude config..."
    cp "$CLAUDE_CONFIG_DIR/config.json" \
       "$CLAUDE_CONFIG_DIR/config.json.backup.$(date +%Y%m%d-%H%M%S)"
fi

# Copy all MCP servers
for mcp_dir in "$REPO_ROOT/mcp-servers/"*/; do
    if [[ -d "$mcp_dir" ]]; then
        mcp_name=$(basename "$mcp_dir")
        log_info "  Installing MCP server: $mcp_name"
        
        # Remove existing if present
        rm -rf "$MCP_SERVERS_PATH/$mcp_name"
        
        # Copy MCP server
        cp -r "$mcp_dir" "$MCP_SERVERS_PATH/"
        
        # Install npm dependencies
        if [[ -f "$MCP_SERVERS_PATH/$mcp_name/package.json" ]]; then
            log_info "    Installing dependencies for $mcp_name..."
            (cd "$MCP_SERVERS_PATH/$mcp_name" && npm install --silent --no-progress) || {
                log_error "Failed to install dependencies for $mcp_name"
                exit 1
            }
        fi
    fi
done

# Create Claude config
log_info "Configuring Claude Code..."

# Read template and replace placeholders
CONFIG_TEMPLATE=$(cat "$REPO_ROOT/config/claude/config.json")
CONFIG_TEMPLATE="${CONFIG_TEMPLATE//\{\{MCP_SERVERS_PATH\}\}/$MCP_SERVERS_PATH}"
CONFIG_TEMPLATE="${CONFIG_TEMPLATE//\{\{ORCHESTRATOR_HOME\}\}/$ORCHESTRATOR_HOME}"
CONFIG_TEMPLATE="${CONFIG_TEMPLATE//\{\{HOME\}\}/$HOME}"

echo "$CONFIG_TEMPLATE" > "$CLAUDE_CONFIG_DIR/config.json"

# Copy Claude settings if present
if [[ -f "$REPO_ROOT/config/claude/settings.json" ]]; then
    cp "$REPO_ROOT/config/claude/settings.json" "$CLAUDE_CONFIG_DIR/"
fi

# Set up shell integration
log_info "Setting up shell integration..."

SHELL_RC="$HOME/.zshrc"
[[ "$SHELL" == */bash ]] && SHELL_RC="$HOME/.bashrc"

if ! grep -q "# Claude Orchestrator" "$SHELL_RC" 2>/dev/null; then
    cat >> "$SHELL_RC" << EOF

# Claude Orchestrator
export ORCHESTRATOR_HOME="$ORCHESTRATOR_HOME"
export PATH="\$ORCHESTRATOR_HOME/scripts:\$PATH"

# Aliases
alias co-daily="\$ORCHESTRATOR_HOME/scripts/orchestrator.sh daily"
alias co-weekly="\$ORCHESTRATOR_HOME/scripts/orchestrator.sh weekly"
alias co-verify="\$ORCHESTRATOR_HOME/scripts/verify-setup.sh"
alias co-init="\$ORCHESTRATOR_HOME/scripts/init-workspace.sh"
alias co-status="cat \$ORCHESTRATOR_HOME/config/workspaces.json | jq '.workspaces | keys'"
EOF
    log_info "Added shell integration to $SHELL_RC"
else
    log_warn "Shell integration already exists in $SHELL_RC"
fi

# Optional: Install cron jobs
echo ""
read -p "Install automated cron jobs? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Installing cron jobs..."
    
    # Backup current crontab
    crontab -l > /tmp/crontab.backup 2>/dev/null || true
    
    # Create temp cron file
    TEMP_CRON=$(mktemp)
    crontab -l 2>/dev/null > "$TEMP_CRON" || true
    
    # Add orchestrator jobs if not present
    if ! grep -q "claude-orchestrator" "$TEMP_CRON"; then
        cat "$REPO_ROOT/config/cron/orchestrator.cron" | \
        sed "s|{{ORCHESTRATOR_HOME}}|$ORCHESTRATOR_HOME|g" >> "$TEMP_CRON"
        
        crontab "$TEMP_CRON"
        log_info "Cron jobs installed"
    else
        log_warn "Cron jobs already exist"
    fi
    
    rm "$TEMP_CRON"
else
    log_info "Skipped cron installation"
    log_info "You can manually install later from: $REPO_ROOT/config/cron/orchestrator.cron"
fi

# Verify installation
echo ""
log_info "Running verification..."
"$ORCHESTRATOR_HOME/scripts/verify-setup.sh"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Installation Complete!                                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log_info "Next steps:"
echo ""
echo "  1. Reload your shell:"
echo "     source $SHELL_RC"
echo ""
echo "  2. Edit workspace configuration:"
echo "     vim $ORCHESTRATOR_HOME/config/workspaces.json"
echo ""
echo "  3. Initialize a workspace:"
echo "     co-init <workspace-name> <workspace-path>"
echo ""
echo "  4. Verify setup:"
echo "     co-verify"
echo ""
echo "  5. Run daily tasks:"
echo "     co-daily"
echo ""
log_info "MCP servers installed:"
for mcp_dir in "$MCP_SERVERS_PATH/"*/; do
    if [[ -d "$mcp_dir" ]]; then
        echo "  - $(basename "$mcp_dir")"
    fi
done
echo ""
log_info "Documentation: $REPO_ROOT/docs/"
echo ""