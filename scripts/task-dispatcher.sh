#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    echo "Usage: task-dispatcher.sh <workspace-name> <task-description> [complexity]"
    echo ""
    echo "Dispatch a task to a workspace using the appropriate Claude model."
    echo ""
    echo "Arguments:"
    echo "  workspace-name     Target workspace name"
    echo "  task-description   Task prompt to send to Claude"
    echo "  complexity         simple|medium|complex (default: medium)"
    exit 1
}

WORKSPACE="$1"
TASK="$2"
COMPLEXITY="${3:-medium}"

if [[ -z "$WORKSPACE" || -z "$TASK" ]]; then
    usage
fi

# Load workspace path from config
WORKSPACES_CONFIG="$ORCHESTRATOR_HOME/config/workspaces.json"
if [[ ! -f "$WORKSPACES_CONFIG" ]]; then
    log_error "workspaces.json not found"
    exit 1
fi

WORKSPACE_PATH=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('$WORKSPACES_CONFIG','utf-8'));
    const ws = c.workspaces?.['$WORKSPACE'];
    if (ws) console.log(ws.path);
    else process.exit(1);
" 2>/dev/null)

if [[ -z "$WORKSPACE_PATH" ]]; then
    log_error "Workspace '$WORKSPACE' not found in workspaces.json"
    exit 1
fi

if [[ ! -d "$WORKSPACE_PATH" ]]; then
    log_error "Workspace path does not exist: $WORKSPACE_PATH"
    exit 1
fi

# Select model
MODEL=$("$SCRIPT_DIR/model-selector.sh" "$COMPLEXITY" "$TASK")
log_info "Workspace: $WORKSPACE ($WORKSPACE_PATH)"
log_info "Model: $MODEL"
log_info "Complexity: $COMPLEXITY"
log_info "Task: $TASK"

# Build prompt from template if available
PROMPT_TEMPLATE="$ORCHESTRATOR_HOME/prompts/templates/task-prompt.md"
if [[ -f "$PROMPT_TEMPLATE" ]]; then
    FULL_PROMPT=$(sed \
        -e "s|{{WORKSPACE_NAME}}|$WORKSPACE|g" \
        -e "s|{{TASK_DESCRIPTION}}|$TASK|g" \
        -e "s|{{COMPLEXITY}}|$COMPLEXITY|g" \
        "$PROMPT_TEMPLATE")
else
    FULL_PROMPT="$TASK"
fi

# Log dispatch
LOG_FILE="$ORCHESTRATOR_HOME/logs/dispatches.log"
mkdir -p "$(dirname "$LOG_FILE")"
echo "[$(date -Iseconds)] workspace=$WORKSPACE model=$MODEL complexity=$COMPLEXITY task=\"$TASK\"" >> "$LOG_FILE"

# Execute task with Claude
log_info "Dispatching task..."
echo ""

cd "$WORKSPACE_PATH"
claude --model "$MODEL" --print "$FULL_PROMPT" 2>&1 || {
    log_error "Task execution failed"
    exit 1
}

echo ""
log_info "Task completed for workspace: $WORKSPACE"
