#!/bin/bash
set -e

# Model Selector - reads models.json and selects appropriate model based on complexity
# Usage: model-selector.sh <complexity> [task-description]
# Output: model string to stdout

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/claude-orchestrator}"
MODELS_CONFIG="$ORCHESTRATOR_HOME/config/models.json"

COMPLEXITY="${1:-medium}"
TASK_DESC="${2:-}"

if [[ ! -f "$MODELS_CONFIG" ]]; then
    # Fallback defaults if no config
    case "$COMPLEXITY" in
        simple)  echo "claude-haiku-4-5-20251001" ;;
        complex) echo "claude-opus-4-5-20251101" ;;
        *)       echo "claude-sonnet-4-5-20250929" ;;
    esac
    exit 0
fi

node -e "
const config = JSON.parse(require('fs').readFileSync('$MODELS_CONFIG', 'utf-8'));
const complexity = '$COMPLEXITY';
const task = process.argv[1].toLowerCase();

// Apply rules (keyword matching)
if (task && Array.isArray(config.rules)) {
    for (const rule of config.rules) {
        const cond = rule.if.toLowerCase();
        const target = rule.use.toLowerCase();

        // Rule: task contains 'architecture' or 'design' -> opus (complex)
        if ((cond.includes('architecture') || cond.includes('design')) &&
            (task.includes('architecture') || task.includes('design'))) {
            console.log(config.task_complexity.complex.model);
            process.exit(0);
        }

        // Rule: task contains 'documentation' or 'readme' -> haiku (simple)
        if ((cond.includes('documentation') || cond.includes('readme')) &&
            (task.includes('documentation') || task.includes('readme') || task.includes('docs'))) {
            console.log(config.task_complexity.simple.model);
            process.exit(0);
        }
    }
}

// Fall back to complexity mapping
const model = config.task_complexity?.[complexity]?.model
    || config.task_complexity?.medium?.model
    || 'claude-sonnet-4-5-20250929';
console.log(model);
" "$TASK_DESC" 2>/dev/null || echo "claude-sonnet-4-5-20250929"
