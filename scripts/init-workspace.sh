#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

source "$(dirname "$0")/lib/config.sh"

usage() {
    echo "Usage: init-workspace.sh <workspace-name> <workspace-path> [type] [priority] [auto_review]"
    echo ""
    echo "Initialize a workspace for orchestrator management."
    echo ""
    echo "Arguments:"
    echo "  workspace-name   Short name for the workspace (e.g., api-backend)"
    echo "  workspace-path   Absolute path to the workspace directory"
    echo "  type             Project type: nodejs, react, python, etc. (default: nodejs)"
    echo "  priority         high|medium|low (default: medium)"
    echo "  auto_review      true|false (default: false)"
    exit 1
}

WORKSPACE_NAME="$1"
WORKSPACE_PATH="$2"
WS_TYPE="${3:-nodejs}"
WS_PRIORITY="${4:-medium}"
WS_AUTO_REVIEW="${5:-false}"

if [[ -z "$WORKSPACE_NAME" || -z "$WORKSPACE_PATH" ]]; then
    usage
fi

if [[ ! -d "$WORKSPACE_PATH" ]]; then
    log_error "Workspace path does not exist: $WORKSPACE_PATH"
    exit 1
fi

log_info "Initializing workspace: $WORKSPACE_NAME"
log_info "Path: $WORKSPACE_PATH"
log_info "Type: $WS_TYPE | Priority: $WS_PRIORITY | Auto-review: $WS_AUTO_REVIEW"

# Create workspace CLAUDE.md
CLAUDE_DIR="$WORKSPACE_PATH/.claude"
mkdir -p "$CLAUDE_DIR"

if [[ -f "$CLAUDE_DIR/CLAUDE.md" ]]; then
    log_warn "CLAUDE.md already exists at $CLAUDE_DIR/CLAUDE.md"
else
    TEMPLATE="$ORCHESTRATOR_HOME/prompts/templates/workspace-claude.md"
    if [[ -f "$TEMPLATE" ]]; then
        sed "s/{{WORKSPACE_NAME}}/$WORKSPACE_NAME/g" "$TEMPLATE" > "$CLAUDE_DIR/CLAUDE.md"
    else
        cat > "$CLAUDE_DIR/CLAUDE.md" << EOF
# $WORKSPACE_NAME - Claude Code Guidelines

## Project Overview
<!-- Describe this workspace/project -->

## Coding Standards
- Follow existing code style and conventions
- Write tests for new functionality
- Update documentation when making changes

## Task Completion Checklist
- [ ] Code changes implemented
- [ ] Tests pass
- [ ] No linting errors
- [ ] Changelog updated
EOF
    fi
    log_info "Created $CLAUDE_DIR/CLAUDE.md"
fi

# Add .claude to .gitignore if not present
GITIGNORE="$WORKSPACE_PATH/.gitignore"
if [[ -f "$GITIGNORE" ]]; then
    if ! grep -q "^\.claude/" "$GITIGNORE" 2>/dev/null; then
        echo ".claude/" >> "$GITIGNORE"
        log_info "Added .claude/ to .gitignore"
    fi
else
    echo ".claude/" > "$GITIGNORE"
    log_info "Created .gitignore with .claude/ entry"
fi

# Create backlog file
BACKLOG="$ORCHESTRATOR_HOME/backlogs/${WORKSPACE_NAME}-backlog.md"
if [[ ! -f "$BACKLOG" ]]; then
    mkdir -p "$(dirname "$BACKLOG")"
    cat > "$BACKLOG" << EOF
# Backlog - $WORKSPACE_NAME

## High Priority

## Medium Priority

## Low Priority
EOF
    log_info "Created backlog: $BACKLOG"
else
    log_warn "Backlog already exists: $BACKLOG"
fi

# Create changelog file
CHANGELOG="$ORCHESTRATOR_HOME/changelogs/${WORKSPACE_NAME}-changelog.md"
if [[ ! -f "$CHANGELOG" ]]; then
    mkdir -p "$(dirname "$CHANGELOG")"
    cat > "$CHANGELOG" << EOF
# Changelog - $WORKSPACE_NAME

All notable changes to the $WORKSPACE_NAME workspace.

Format: [Keep a Changelog](https://keepachangelog.com/)
EOF
    log_info "Created changelog: $CHANGELOG"
else
    log_warn "Changelog already exists: $CHANGELOG"
fi

# Add workspace to workspaces.json
WORKSPACES_CONFIG="$ORCHESTRATOR_HOME/config/workspaces.json"
if [[ -f "$WORKSPACES_CONFIG" ]]; then
    if node -e "
        const c = JSON.parse(require('fs').readFileSync('$WORKSPACES_CONFIG','utf-8'));
        process.exit(c.workspaces?.['$WORKSPACE_NAME'] ? 0 : 1);
    " 2>/dev/null; then
        log_warn "Workspace '$WORKSPACE_NAME' already in workspaces.json"
    else
        node -e "
            const fs = require('fs');
            const c = JSON.parse(fs.readFileSync('$WORKSPACES_CONFIG','utf-8'));
            if (!c.workspaces) c.workspaces = {};
            c.workspaces['$WORKSPACE_NAME'] = {
                path: '$WORKSPACE_PATH',
                type: '$WS_TYPE',
                priority: '$WS_PRIORITY',
                auto_review: '$WS_AUTO_REVIEW' === 'true'
            };
            fs.writeFileSync('$WORKSPACES_CONFIG', JSON.stringify(c, null, 2) + '\n');
        " 2>/dev/null
        log_info "Added '$WORKSPACE_NAME' to workspaces.json"
    fi
else
    log_warn "workspaces.json not found — create it from workspaces.json.example"
fi

echo ""
log_info "Workspace '$WORKSPACE_NAME' initialized successfully!"
echo ""
echo "  Backlog:   $BACKLOG"
echo "  Changelog: $CHANGELOG"
echo "  CLAUDE.md: $CLAUDE_DIR/CLAUDE.md"
echo ""
