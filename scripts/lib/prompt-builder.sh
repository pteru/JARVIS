#!/usr/bin/env bash
# Shared prompt-building utilities for orchestrator scripts.
#
# Provides:
#   - Template variable substitution (literal, multi-line & special-char safe)
#   - Context injection (reading workspace context files)
#   - Common prompt formatting
#
# Usage:
#   source "$ORCHESTRATOR_HOME/scripts/lib/prompt-builder.sh"

# Substitute {{VAR_NAME}} placeholders in a template file.
# Args:
#   $1  - template file path
#   ... - pairs of VAR_NAME VALUE (e.g., WORKSPACE_NAME myworkspace)
# Output: substituted text to stdout (no trailing newline added).
# Returns 1 if the template file does not exist.
#
# Substitution is LITERAL: values may be multi-line and contain |, &, #, \ etc.
# We avoid `sed s|||` (breaks on newlines), awk gsub() (reinterprets & and \ in the
# replacement), and bash ${//} (bash >=5.1 treats & in the replacement as the matched
# text). Instead we splice with awk index/substr over a single whole-file record, and
# pass the VAR/VALUE pairs through the environment so the shell never has to quote them
# into the awk program.
substitute_template() {
    local template_file="$1"
    shift

    if [[ ! -f "$template_file" ]]; then
        return 1
    fi

    local -a passenv=()
    local n=0
    while [[ $# -ge 2 ]]; do
        passenv+=("PB_K${n}={{$1}}" "PB_V${n}=$2")
        shift 2
        n=$((n + 1))
    done

    env "${passenv[@]}" "PB_N=$n" awk '
    function lit(s, ph, repl,   out, i) {
        if (ph == "") return s
        out = ""
        while ((i = index(s, ph)) > 0) {
            out = out substr(s, 1, i - 1) repl
            s = substr(s, i + length(ph))
        }
        return out s
    }
    BEGIN { RS = "\0" }
    {
        count = ENVIRON["PB_N"] + 0
        for (k = 0; k < count; k++)
            $0 = lit($0, ENVIRON["PB_K" k], ENVIRON["PB_V" k])
        printf "%s", $0
    }' "$template_file"
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

# Build a prompt from a template with optional workspace-context injection.
# Args:
#   $1 - template file path
#   $2 - workspace name
#   $3 - task description
#   $4 - complexity (simple|medium|complex)
#   $5 - workspace path (optional, enables {{WORKSPACE_CONTEXT}} injection)
# Output: complete prompt to stdout. If the template is missing, the raw task.
build_task_prompt() {
    local template_file="$1"
    local workspace="$2"
    local task="$3"
    local complexity="$4"
    local workspace_path="${5:-}"

    if [[ ! -f "$template_file" ]]; then
        printf '%s' "$task"
        return 0
    fi

    local context=""
    if [[ -n "$workspace_path" ]]; then
        context="$(read_workspace_context "$workspace_path")"
    fi

    # One literal pass over all placeholders. {{WORKSPACE_CONTEXT}} is a no-op when
    # the template doesn't use it (and context is empty when no workspace path given).
    substitute_template "$template_file" \
        "WORKSPACE_NAME" "$workspace" \
        "TASK_DESCRIPTION" "$task" \
        "COMPLEXITY" "$complexity" \
        "WORKSPACE_CONTEXT" "$context"
}
