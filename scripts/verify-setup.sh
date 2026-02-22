#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

source "$(dirname "$0")/lib/config.sh"
ERRORS=0
WARNINGS=0

check_pass() { echo -e "  ${GREEN}✓${NC} $1"; }
check_fail() { echo -e "  ${RED}✗${NC} $1"; ERRORS=$((ERRORS + 1)); }
check_warn() { echo -e "  ${YELLOW}!${NC} $1"; WARNINGS=$((WARNINGS + 1)); }

echo ""
echo "Claude Orchestrator - Setup Verification"
echo "========================================="
echo ""
echo "ORCHESTRATOR_HOME: $ORCHESTRATOR_HOME"
echo ""

# Check directory structure
echo "Directories:"
for dir in config backlogs changelogs reports logs scripts prompts/templates; do
    if [[ -d "$ORCHESTRATOR_HOME/$dir" ]]; then
        check_pass "$dir/"
    else
        check_fail "$dir/ missing"
    fi
done

echo ""
echo "Configuration:"

# Check CLAUDE.md
if [[ -f "$ORCHESTRATOR_HOME/CLAUDE.md" ]]; then
    check_pass "CLAUDE.md"
else
    check_fail "CLAUDE.md missing"
fi

# Check workspaces.json
if [[ -f "$ORCHESTRATOR_HOME/config/workspaces.json" ]]; then
    check_pass "config/workspaces.json"
    # Validate JSON
    if node -e "JSON.parse(require('fs').readFileSync('$ORCHESTRATOR_HOME/config/workspaces.json','utf-8'))" 2>/dev/null; then
        check_pass "config/workspaces.json is valid JSON"
    else
        check_fail "config/workspaces.json is invalid JSON"
    fi
else
    check_warn "config/workspaces.json missing (copy from workspaces.json.example)"
fi

# Check models.json
if [[ -f "$ORCHESTRATOR_HOME/config/models.json" ]]; then
    check_pass "config/models.json"
else
    check_fail "config/models.json missing"
fi

# Check schedules.json
if [[ -f "$ORCHESTRATOR_HOME/config/schedules.json" ]]; then
    check_pass "config/schedules.json"
else
    check_warn "config/schedules.json missing"
fi

echo ""
echo "Scripts:"
for script in model-selector.sh verify-setup.sh init-workspace.sh task-dispatcher.sh orchestrator.sh; do
    if [[ -f "$ORCHESTRATOR_HOME/scripts/$script" ]]; then
        if [[ -x "$ORCHESTRATOR_HOME/scripts/$script" ]]; then
            check_pass "$script (executable)"
        else
            check_warn "$script (not executable)"
        fi
    else
        check_fail "$script missing"
    fi
done

echo ""
echo "MCP Servers:"
CLAUDE_CONFIG="$HOME/.claude/config.json"
MCP_SERVERS_PATH="$HOME/.claude/mcp_servers"

for server_name in backlog-manager changelog-writer workspace-analyzer task-dispatcher report-generator; do
    if [[ -d "$MCP_SERVERS_PATH/$server_name" ]]; then
        if [[ -f "$MCP_SERVERS_PATH/$server_name/index.js" ]]; then
            if [[ -d "$MCP_SERVERS_PATH/$server_name/node_modules" ]]; then
                check_pass "$server_name (installed)"
            else
                check_warn "$server_name (dependencies not installed)"
            fi
        else
            check_fail "$server_name (index.js missing)"
        fi
    else
        check_fail "$server_name not installed"
    fi
done

# Check Claude config
echo ""
echo "Claude Code Config:"
if [[ -f "$CLAUDE_CONFIG" ]]; then
    check_pass "config.json exists"
    if node -e "JSON.parse(require('fs').readFileSync('$CLAUDE_CONFIG','utf-8'))" 2>/dev/null; then
        check_pass "config.json is valid JSON"
    else
        check_fail "config.json is invalid JSON"
    fi
else
    check_fail "Claude config.json not found at $CLAUDE_CONFIG"
fi

# Summary
echo ""
echo "========================================="
if [[ $ERRORS -eq 0 && $WARNINGS -eq 0 ]]; then
    echo -e "${GREEN}All checks passed!${NC}"
elif [[ $ERRORS -eq 0 ]]; then
    echo -e "${YELLOW}Passed with $WARNINGS warning(s)${NC}"
else
    echo -e "${RED}$ERRORS error(s), $WARNINGS warning(s)${NC}"
fi
echo ""

exit $ERRORS
