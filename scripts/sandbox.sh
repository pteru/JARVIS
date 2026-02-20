#!/bin/bash
set -euo pipefail

# ============================================================
# JARVIS Sandbox Launcher
# Autonomous Claude Code execution in a disposable container
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$SCRIPT_DIR/sandbox"
JARVIS_HOME="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="jarvis-sandbox"
IMAGE_TAG="latest"
CONTAINER_PREFIX="jarvis-sandbox"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Defaults
TASK=""
SPEC=""
BRANCH=""
BASE_BRANCH="develop"
NETWORK="bridge"
MEMORY="4g"
CPUS="2"
MODEL="opus"
INTERACTIVE="false"
AUTO_APPLY="false"
TIMEOUT="30m"
MOUNT_SECRETS=()
ACTION=""

# ============================================================
# Usage
# ============================================================
usage() {
    cat <<EOF
${BOLD}JARVIS Sandbox${NC} — Autonomous Claude Code in a disposable container

${BOLD}Usage:${NC}
  $(basename "$0") --task "description" [options]
  $(basename "$0") --build-image
  $(basename "$0") --list
  $(basename "$0") --attach <container-id>

${BOLD}Required:${NC}
  --task <text>          Task description for Claude

${BOLD}Options:${NC}
  --spec <path>          Path to spec file (relative to JARVIS root)
  --branch <name>        Git branch name (default: sandbox/<timestamp>)
  --base-branch <name>   Base branch to diff against (default: develop)
  --network <mode>       Network: full, lan, offline (default: full)
  --memory <limit>       Memory limit (default: 4g)
  --cpus <count>         CPU limit (default: 2)
  --model <name>         Claude model: opus, sonnet, haiku (default: opus)
  --mount-secret <path>  Mount a secret file read-only (repeatable)
  --interactive          Attach TTY for interactive Claude session
  --auto-apply           Auto-apply changes if task succeeds (skip review)
  --timeout <duration>   Max runtime (default: 30m)

${BOLD}Commands:${NC}
  --build-image          Build/rebuild the sandbox base image
  --list                 List running sandbox containers
  --attach <id>          Attach to a running sandbox container

${BOLD}Examples:${NC}
  $(basename "$0") --task "Implement /cleanup skill" --spec backlogs/orchestrator/cleanup-skill.md
  $(basename "$0") --task "Fix pylogix imports" --network offline --model haiku
  $(basename "$0") --build-image
EOF
    exit 0
}

# ============================================================
# Parse arguments
# ============================================================
while [[ $# -gt 0 ]]; do
    case "$1" in
        --task)         TASK="$2"; shift 2 ;;
        --spec)         SPEC="$2"; shift 2 ;;
        --branch)       BRANCH="$2"; shift 2 ;;
        --base-branch)  BASE_BRANCH="$2"; shift 2 ;;
        --network)      NETWORK="$2"; shift 2 ;;
        --memory)       MEMORY="$2"; shift 2 ;;
        --cpus)         CPUS="$2"; shift 2 ;;
        --model)        MODEL="$2"; shift 2 ;;
        --mount-secret) MOUNT_SECRETS+=("$2"); shift 2 ;;
        --interactive)  INTERACTIVE="true"; shift ;;
        --auto-apply)   AUTO_APPLY="true"; shift ;;
        --timeout)      TIMEOUT="$2"; shift 2 ;;
        --build-image)  ACTION="build"; shift ;;
        --list)         ACTION="list"; shift ;;
        --attach)       ACTION="attach"; ATTACH_ID="$2"; shift 2 ;;
        --help|-h)      usage ;;
        *)              echo -e "${RED}Unknown option: $1${NC}"; usage ;;
    esac
done

# ============================================================
# Build image
# ============================================================
build_image() {
    echo -e "${CYAN}Building sandbox base image...${NC}"
    echo ""
    docker build \
        -t "${IMAGE_NAME}:${IMAGE_TAG}" \
        -f "$SANDBOX_DIR/Dockerfile" \
        "$SANDBOX_DIR"
    echo ""
    echo -e "${GREEN}Image built: ${IMAGE_NAME}:${IMAGE_TAG}${NC}"
    docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "  Size: {{.Size}}  Created: {{.CreatedAt}}"
}

# ============================================================
# List running containers
# ============================================================
list_containers() {
    echo -e "${BOLD}Running sandbox containers:${NC}"
    echo ""
    local containers
    containers=$(docker ps --filter "name=${CONTAINER_PREFIX}" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.RunningFor}}" 2>/dev/null)
    if [ -z "$containers" ] || [ "$(echo "$containers" | wc -l)" -le 1 ]; then
        echo "  No running sandboxes."
    else
        echo "$containers"
    fi
}

# ============================================================
# Attach to container
# ============================================================
attach_container() {
    echo -e "${CYAN}Attaching to sandbox: ${ATTACH_ID}${NC}"
    docker exec -it "$ATTACH_ID" bash
}

# ============================================================
# Ensure image exists
# ============================================================
ensure_image() {
    if ! docker image inspect "${IMAGE_NAME}:${IMAGE_TAG}" &>/dev/null; then
        echo -e "${YELLOW}Sandbox image not found. Building...${NC}"
        echo ""
        build_image
        echo ""
    fi
}

# ============================================================
# Map network mode
# ============================================================
get_network_flag() {
    case "$NETWORK" in
        full)    echo "bridge" ;;
        lan)     echo "host" ;;
        offline) echo "none" ;;
        *)       echo "bridge" ;;
    esac
}

# ============================================================
# Run sandbox task
# ============================================================
run_task() {
    if [ -z "$TASK" ]; then
        echo -e "${RED}Error: --task is required${NC}"
        echo ""
        usage
    fi

    ensure_image

    # Generate container name and branch
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)
    local container_name="${CONTAINER_PREFIX}-${timestamp}"
    [ -z "$BRANCH" ] && BRANCH="sandbox/${timestamp}"

    # Create temp output directory
    local output_dir
    output_dir=$(mktemp -d "/tmp/jarvis-sandbox-${timestamp}-XXXXX")

    echo ""
    echo -e "${BOLD}============================================${NC}"
    echo -e "${BOLD}  JARVIS Sandbox — Task Launcher${NC}"
    echo -e "${BOLD}============================================${NC}"
    echo -e "  Task:      ${CYAN}${TASK}${NC}"
    [ -n "$SPEC" ] && echo -e "  Spec:      ${DIM}${SPEC}${NC}"
    echo -e "  Branch:    ${DIM}${BRANCH}${NC}"
    echo -e "  Model:     ${DIM}${MODEL}${NC}"
    echo -e "  Network:   ${DIM}${NETWORK}${NC}"
    echo -e "  Memory:    ${DIM}${MEMORY}${NC}"
    echo -e "  CPUs:      ${DIM}${CPUS}${NC}"
    echo -e "  Timeout:   ${DIM}${TIMEOUT}${NC}"
    echo -e "  Mode:      ${DIM}$([ "$INTERACTIVE" = "true" ] && echo "interactive" || echo "autonomous")${NC}"
    echo -e "  Container: ${DIM}${container_name}${NC}"
    echo -e "  Output:    ${DIM}${output_dir}${NC}"
    echo -e "${BOLD}============================================${NC}"
    echo ""

    # Build docker run command
    local docker_args=(
        run
        --name "$container_name"
        --memory "$MEMORY"
        --cpus "$CPUS"
        --network "$(get_network_flag)"
        -v "${JARVIS_HOME}:/repo-source:ro"
        -v "${output_dir}:/output"
        -v "${HOME}/.claude:/home/sandbox/.claude-host:ro"
        -v "${HOME}/.claude.json:/home/sandbox/.claude.json.host:ro"
        -e "SANDBOX_TASK=${TASK}"
        -e "SANDBOX_SPEC=${SPEC}"
        -e "SANDBOX_BRANCH=${BRANCH}"
        -e "SANDBOX_BASE_BRANCH=${BASE_BRANCH}"
        -e "SANDBOX_MODEL=${MODEL}"
        -e "SANDBOX_INTERACTIVE=${INTERACTIVE}"
        -e "GIT_AUTHOR_NAME=${GIT_AUTHOR_NAME:-JARVIS Sandbox}"
        -e "GIT_AUTHOR_EMAIL=${GIT_AUTHOR_EMAIL:-jarvis-sandbox@strokmatic.com}"
    )

    # Pass ANTHROPIC_API_KEY if set (optional — Claude Code uses its own auth)
    if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
        docker_args+=(-e "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}")
    fi

    # Mount secrets if requested
    for secret in "${MOUNT_SECRETS[@]+"${MOUNT_SECRETS[@]}"}"; do
        if [ -f "$secret" ]; then
            local secret_name
            secret_name=$(basename "$secret")
            docker_args+=(-v "${secret}:/secrets/${secret_name}:ro")
            echo -e "  Secret:    ${DIM}${secret_name} (mounted)${NC}"
        else
            echo -e "${YELLOW}  Warning: Secret file not found: ${secret}${NC}"
        fi
    done

    # Interactive mode needs TTY
    if [ "$INTERACTIVE" = "true" ]; then
        docker_args+=(-it)
    fi

    # Add image name
    docker_args+=("${IMAGE_NAME}:${IMAGE_TAG}")

    # Run with timeout
    echo -e "${CYAN}Launching sandbox...${NC}"
    echo ""

    local start_time
    start_time=$(date +%s)
    local exit_code=0
    if [ "$INTERACTIVE" = "true" ]; then
        docker "${docker_args[@]}" || exit_code=$?
    else
        timeout "$TIMEOUT" docker "${docker_args[@]}" || exit_code=$?
        if [ $exit_code -eq 124 ]; then
            echo ""
            echo -e "${YELLOW}Sandbox timed out after ${TIMEOUT}. Stopping container...${NC}"
            docker stop "$container_name" &>/dev/null || true
        fi
    fi

    echo ""
    echo -e "${BOLD}============================================${NC}"
    echo -e "${BOLD}  Sandbox Complete${NC}"
    echo -e "${BOLD}============================================${NC}"

    # Run review
    review_results "$output_dir" "$container_name" "$exit_code" "$start_time"
}

# ============================================================
# Generate review report (markdown)
# Combines Claude's implementation report with patch metadata
# ============================================================
generate_review_report() {
    local output_dir="$1"
    local exit_code="$2"
    local start_time="$3"
    local end_time
    end_time=$(date +%s)

    local report_dir="${JARVIS_HOME}/reports/sandbox"
    mkdir -p "$report_dir"

    # Derive report filename from branch name
    local report_name
    report_name=$(echo "$BRANCH" | tr '/' '-')
    local report_file="${report_dir}/${report_name}.md"

    # Calculate duration
    local duration=$(( end_time - start_time ))
    local dur_min=$(( duration / 60 ))
    local dur_sec=$(( duration % 60 ))

    # Count patches
    local patch_count
    patch_count=$(find "${output_dir}" -name '*.patch' -type f 2>/dev/null | wc -l)
    patch_count=$(echo "$patch_count" | tr -d '[:space:]')

    # --- Header ---
    cat > "$report_file" <<EOF
# Sandbox Report: ${BRANCH}

**Date:** $(date '+%Y-%m-%d %H:%M')<br>
**Task:** ${TASK}<br>
**Spec:** ${SPEC:-none}<br>
**Model:** ${MODEL}<br>
**Branch:** ${BRANCH}<br>
**Base:** ${BASE_BRANCH}<br>
**Duration:** ${dur_min}m ${dur_sec}s<br>
**Exit code:** ${exit_code}<br>
**Patches:** ${patch_count}

---

EOF

    # --- Claude's Implementation Report (the core content) ---
    if [ -f "${output_dir}/REPORT.md" ]; then
        cat "${output_dir}/REPORT.md" >> "$report_file"
        echo "" >> "$report_file"
        echo "---" >> "$report_file"
        echo "" >> "$report_file"
    else
        cat >> "$report_file" <<'EOF'
## Implementation Report

> **Warning:** The sandbox agent did not produce an implementation report.
> Only mechanical diff analysis is available below.

EOF
    fi

    # --- Safety Audit (always run by host, not dependent on Claude) ---
    if [ "$patch_count" -gt 0 ]; then
        cat >> "$report_file" <<'EOF'
## Safety Audit

EOF
        local has_warnings=false

        for patch in "${output_dir}"/*.patch; do
            local sensitive
            sensitive=$(grep -E '^\+\+\+ b/.*\.(env|pem|key|p12|pfx)$|^\+\+\+ b/.*credentials.*\.json|^\+\+\+ b/.*secret.*\.json|^\+\+\+ b/.*service-account.*\.json' "$patch" 2>/dev/null || true)
            if [ -n "$sensitive" ]; then
                has_warnings=true
                echo "**WARNING — Sensitive files in patch:**" >> "$report_file"
                echo '```' >> "$report_file"
                echo "$sensitive" >> "$report_file"
                echo '```' >> "$report_file"
                echo "" >> "$report_file"
            fi

            local big_adds
            big_adds=$(git apply --numstat "$patch" 2>/dev/null | awk '$1 > 500 {print $1 " additions in " $3}' || true)
            if [ -n "$big_adds" ]; then
                has_warnings=true
                echo "**Note — Large additions:**" >> "$report_file"
                echo '```' >> "$report_file"
                echo "$big_adds" >> "$report_file"
                echo '```' >> "$report_file"
                echo "" >> "$report_file"
            fi
        done

        if [ "$has_warnings" = false ]; then
            echo "No sensitive files or suspicious patterns detected." >> "$report_file"
            echo "" >> "$report_file"
        fi

        # --- Diff Summary ---
        cat >> "$report_file" <<'EOF'
## Diff Summary

```
EOF
        for patch in "${output_dir}"/*.patch; do
            git apply --stat "$patch" 2>/dev/null >> "$report_file" || true
        done
        echo '```' >> "$report_file"
        echo "" >> "$report_file"

        # --- Full Diff (per file) ---
        cat >> "$report_file" <<'EOF'
## Full Diff

EOF
        for patch in "${output_dir}"/*.patch; do
            local patch_name
            patch_name=$(basename "$patch")

            echo "### Patch: ${patch_name}" >> "$report_file"
            echo "" >> "$report_file"

            local in_diff=false
            while IFS= read -r line; do
                if [[ "$line" == "diff --git"* ]]; then
                    if [ "$in_diff" = true ]; then
                        echo '```' >> "$report_file"
                        echo "" >> "$report_file"
                    fi
                    local current_file
                    current_file=$(echo "$line" | sed 's|diff --git a/.* b/||')
                    echo "#### \`${current_file}\`" >> "$report_file"
                    echo "" >> "$report_file"
                    echo '```diff' >> "$report_file"
                    in_diff=true
                elif [ "$in_diff" = true ]; then
                    if [[ "$line" == "-- " ]]; then
                        echo '```' >> "$report_file"
                        echo "" >> "$report_file"
                        in_diff=false
                    else
                        echo "$line" >> "$report_file"
                    fi
                fi
            done < "$patch"

            if [ "$in_diff" = true ]; then
                echo '```' >> "$report_file"
                echo "" >> "$report_file"
            fi
        done
    fi

    # --- Apply Instructions ---
    cat >> "$report_file" <<EOF
---

## Apply Instructions

Patches at: \`${output_dir}/\`

\`\`\`bash
# Apply
cd ${JARVIS_HOME} && git am ${output_dir}/*.patch

# Discard
rm -rf ${output_dir}
\`\`\`
EOF

    echo "$report_file"
}

# ============================================================
# Review results and apply/discard
# ============================================================
review_results() {
    local output_dir="$1"
    local container_name="$2"
    local exit_code="$3"
    local start_time="$4"

    # Generate the review report
    echo -e "${CYAN}Generating review report...${NC}"
    local report_file
    report_file=$(generate_review_report "$output_dir" "$exit_code" "$start_time")
    echo -e "  Report: ${GREEN}${report_file}${NC}"
    echo ""

    # Count patches
    local patch_count
    patch_count=$(find "${output_dir}" -name '*.patch' -type f 2>/dev/null | wc -l)
    patch_count=$(echo "$patch_count" | tr -d '[:space:]')

    if [ "$patch_count" -eq 0 ]; then
        echo -e "${YELLOW}No patches produced. Nothing to apply.${NC}"
        if [ -f "${output_dir}/SANDBOX-NOTES.md" ]; then
            echo ""
            echo -e "${YELLOW}--- Sandbox Notes (blockers) ---${NC}"
            cat "${output_dir}/SANDBOX-NOTES.md"
        fi
        cleanup_container "$container_name" "$output_dir"
        return
    fi

    echo -e "${GREEN}${patch_count} patch file(s) ready for review.${NC}"
    echo ""

    # Auto-apply mode
    if [ "$AUTO_APPLY" = "true" ] && [ "$exit_code" -eq 0 ]; then
        echo -e "${CYAN}Auto-apply enabled. Applying patches...${NC}"
        apply_patches "$output_dir"
        cleanup_container "$container_name" "$output_dir"
        return
    fi

    # Check if stdin is a terminal (interactive review only if TTY available)
    if [ ! -t 0 ]; then
        echo -e "${YELLOW}Non-interactive mode — skipping review prompt.${NC}"
        echo -e "  Review the report and apply manually:"
        echo -e "  ${DIM}git am ${output_dir}/*.patch${NC}"
        return
    fi

    # Interactive review
    while true; do
        echo -e "  ${BOLD}[V]${NC}iew report   ${BOLD}[A]${NC}pply to host   ${BOLD}[D]${NC}iscard   ${BOLD}[S]${NC}hell into container"
        echo -n "  Choice: "
        read -r choice

        case "${choice,,}" in
            v|view)
                echo ""
                cat "$report_file"
                echo ""
                ;;
            a|apply)
                apply_patches "$output_dir"
                cleanup_container "$container_name" "$output_dir"
                return
                ;;
            d|discard)
                echo -e "${YELLOW}Discarding changes. Container will be removed.${NC}"
                cleanup_container "$container_name" "$output_dir"
                return
                ;;
            s|shell)
                echo -e "${CYAN}Opening shell in container (type 'exit' to return)...${NC}"
                docker start "$container_name" &>/dev/null || true
                docker exec -it "$container_name" bash || true
                echo ""
                ;;
            *)
                echo -e "${RED}Invalid choice. Use V, A, D, or S.${NC}"
                ;;
        esac
    done
}

# ============================================================
# Apply patches to host repo
# ============================================================
apply_patches() {
    local output_dir="$1"

    echo ""
    echo -e "${CYAN}Applying patches to host repository...${NC}"

    cd "$JARVIS_HOME"

    local applied=0
    local failed=0

    for patch in "${output_dir}"/*.patch; do
        local patch_name
        patch_name=$(basename "$patch")

        # Test apply first
        if git apply --check "$patch" 2>/dev/null; then
            git am --quiet "$patch"
            echo -e "  ${GREEN}Applied: ${patch_name}${NC}"
            ((applied++))
        else
            echo -e "  ${RED}Failed:  ${patch_name} (conflict or incompatible)${NC}"
            echo -e "  ${DIM}  Saved at: ${patch}${NC}"
            ((failed++))
            # Abort the am if it was started
            git am --abort 2>/dev/null || true
        fi
    done

    echo ""
    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}All ${applied} patch(es) applied successfully.${NC}"
    else
        echo -e "${YELLOW}${applied} applied, ${failed} failed. Failed patches saved in: ${output_dir}${NC}"
    fi
}

# ============================================================
# Cleanup
# ============================================================
cleanup_container() {
    local container_name="$1"
    local output_dir="$2"

    # Remove container
    docker rm -f "$container_name" &>/dev/null || true
    echo -e "${DIM}Container ${container_name} removed.${NC}"

    # Keep output dir if there were failures
    if [ -z "$(ls "${output_dir}"/*.patch 2>/dev/null)" ]; then
        rm -rf "$output_dir"
    else
        echo -e "${DIM}Patch files preserved at: ${output_dir}${NC}"
    fi
}

# ============================================================
# Main
# ============================================================
case "${ACTION:-run}" in
    build)  build_image ;;
    list)   list_containers ;;
    attach) attach_container ;;
    run)    run_task ;;
esac
