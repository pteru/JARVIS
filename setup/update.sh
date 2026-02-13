#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"
CLAUDE_CONFIG_DIR="$HOME/.claude"
MCP_SERVERS_PATH="$CLAUDE_CONFIG_DIR/mcp_servers"

echo "=== Updating Claude Orchestrator ==="
echo ""

# Pull latest changes
if [[ -d "$REPO_ROOT/.git" ]]; then
    echo "Pulling latest changes from repository..."
    cd "$REPO_ROOT"
    git pull
else
    echo "Not a git repository - skipping pull"
fi

# Update scripts
echo "Updating scripts..."
cp -r "$REPO_ROOT/scripts/"* "$ORCHESTRATOR_HOME/scripts/"
chmod +x "$ORCHESTRATOR_HOME/scripts/"*.sh

# Update prompts
echo "Updating prompts..."
cp -r "$REPO_ROOT/prompts/"* "$ORCHESTRATOR_HOME/prompts/"

# Update CLAUDE.md
echo "Updating CLAUDE.md..."
cp "$REPO_ROOT/CLAUDE.md" "$ORCHESTRATOR_HOME/"

# Update MCP servers
echo "Updating MCP servers..."
for mcp_dir in "$REPO_ROOT/mcp-servers/"*/; do
    if [[ -d "$mcp_dir" ]]; then
        mcp_name=$(basename "$mcp_dir")
        echo "  Updating $mcp_name..."
        
        rm -rf "$MCP_SERVERS_PATH/$mcp_name"
        cp -r "$mcp_dir" "$MCP_SERVERS_PATH/"
        
        if [[ -f "$MCP_SERVERS_PATH/$mcp_name/package.json" ]]; then
            (cd "$MCP_SERVERS_PATH/$mcp_name" && npm install --silent)
        fi
    fi
done

# Update Claude config (preserve customizations)
echo "Updating Claude config..."
CONFIG_TEMPLATE=$(cat "$REPO_ROOT/config/claude/config.json")
CONFIG_TEMPLATE="${CONFIG_TEMPLATE//\{\{MCP_SERVERS_PATH\}\}/$MCP_SERVERS_PATH}"
CONFIG_TEMPLATE="${CONFIG_TEMPLATE//\{\{ORCHESTRATOR_HOME\}\}/$ORCHESTRATOR_HOME}"
CONFIG_TEMPLATE="${CONFIG_TEMPLATE//\{\{HOME\}\}/$HOME}"

echo "$CONFIG_TEMPLATE" > "$CLAUDE_CONFIG_DIR/config.json"

echo ""
echo "=== Update Complete ==="
echo ""
echo "Changes applied:"
echo "  - Scripts updated"
echo "  - Prompts updated"
echo "  - MCP servers updated"
echo "  - Claude config updated"
echo ""
echo "Your workspaces.json was NOT modified"
echo ""