#!/usr/bin/env bash
# Shared prompt-building utilities for orchestrator scripts.
#
# Provides:
#   - Template variable substitution
#   - Context injection (reading workspace context files)
#   - Common prompt formatting
#
# Usage:
#   source "$ORCHESTRATOR_HOME/scripts/lib/prompt-builder.sh"

# Substitute {{VAR_NAME}} placeholders in a template string.
# Args:
#   $1 - template file path
#   ... - pairs of VAR_NAME VALUE (e.g., WORKSPACE_NAME myworkspace)
# Output: substituted text to stdout
substitute_template() {
    local template_file="$1"
    shift

    if [[ ! -f "$template_file" ]]; then
        return 1
    fi

    local content
    content=$(cat "$template_file")

    # Process variable pairs
    while [[ $# -ge 2 ]]; do
        local var_name="$1"
        local var_value="$2"
        content="${content//\{\{${var_name}\}\}/${var_value}}"
        shift 2
    done

    echo "$content"
}

# Read workspace context file (CLAUDE.md or similar) if available.
# Args:
#   $1 - workspace path
#   $2 - context filename (default: .claude/CLAUDE.md)
# Output: file contents to stdout, or empty if not found
read_workspace_context() {
    local workspace_path="$1"
    local context_file="${2:-.claude/CLAUDE.md}"
    local full_path="${workspace_path}/${context_file}"

    if [[ -f "$full_path" ]]; then
        cat "$full_path"
    fi
}

# Build a prompt from template with optional workspace context injection.
# Args:
#   $1 - template file path
#   $2 - workspace name
#   $3 - task description
#   $4 - complexity (simple|medium|complex)
#   $5 - workspace path (optional, for context injection)
# Output: complete prompt to stdout
build_task_prompt() {
    local template_file="$1"
    local workspace="$2"
    local task="$3"
    local complexity="$4"
    local workspace_path="${5:-}"

    if [[ -f "$template_file" ]]; then
        local prompt
        prompt=$(substitute_template "$template_file" \
            "WORKSPACE_NAME" "$workspace" \
            "TASK_DESCRIPTION" "$task" \
            "COMPLEXITY" "$complexity")

        # Inject workspace context if available
        if [[ -n "$workspace_path" ]]; then
            local context
            context=$(read_workspace_context "$workspace_path")
            if [[ -n "$context" ]]; then
                prompt="${prompt/\{\{WORKSPACE_CONTEXT\}\}/${context}}"
            fi
        fi

        echo "$prompt"
    else
        # No template — return raw task
        echo "$task"
    fi
}
