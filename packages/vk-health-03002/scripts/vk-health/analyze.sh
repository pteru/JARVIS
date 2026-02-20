#!/bin/bash
# VK Health Monitor — AI Analysis
# Reads the latest snapshot, computes trends, and runs Claude AI analysis.
# Usage: analyze.sh [deployment-id] (default: 03002)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source config (sets ORCHESTRATOR_HOME, DATA_DIR, REPORT_DIR, DEPLOYMENT_ID, etc.)
source "$SCRIPT_DIR/lib/config.sh" "${1:-03002}"

export PATH="$HOME/.local/bin:$PATH"

LOG_DIR="$ORCHESTRATOR_HOME/logs"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [analyze] $*" >&2; }

TODAY=$(date -u +%Y-%m-%d)
SNAPSHOT_DIR="$DATA_DIR/$TODAY"

# ---------------------------------------------------------------------------
# Find the latest snapshot
# ---------------------------------------------------------------------------
if [[ ! -d "$SNAPSHOT_DIR" ]]; then
    log "ERROR: No snapshot directory for today: $SNAPSHOT_DIR"
    exit 1
fi

LATEST_SNAPSHOT=$(ls -t "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null | head -n 1)
if [[ -z "$LATEST_SNAPSHOT" ]]; then
    log "ERROR: No snapshots found in $SNAPSHOT_DIR"
    exit 1
fi
log "Latest snapshot: $LATEST_SNAPSHOT"

# ---------------------------------------------------------------------------
# Find the previous snapshot (second most recent, or yesterday's latest)
# ---------------------------------------------------------------------------
PREVIOUS_SNAPSHOT=$(ls -t "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null | sed -n '2p')

if [[ -z "$PREVIOUS_SNAPSHOT" ]]; then
    # Try yesterday
    YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d 2>/dev/null)
    YESTERDAY_DIR="$DATA_DIR/$YESTERDAY"
    if [[ -d "$YESTERDAY_DIR" ]]; then
        PREVIOUS_SNAPSHOT=$(ls -t "$YESTERDAY_DIR"/snapshot-*.json 2>/dev/null | head -n 1)
    fi
fi

if [[ -n "$PREVIOUS_SNAPSHOT" ]]; then
    log "Previous snapshot: $PREVIOUS_SNAPSHOT"
    PREVIOUS_JSON=$(cat "$PREVIOUS_SNAPSHOT")
else
    log "No previous snapshot available"
    PREVIOUS_JSON="No previous snapshot available"
fi

CURRENT_JSON=$(cat "$LATEST_SNAPSHOT")

# ---------------------------------------------------------------------------
# Compute 24h trend summary from today's snapshots
# ---------------------------------------------------------------------------
compute_trends() {
    local snapshots
    snapshots=$(ls -t "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null)
    local count
    count=$(echo "$snapshots" | wc -l)

    if [[ "$count" -lt 2 ]]; then
        echo "Insufficient data for trends (only $count snapshot(s) today)"
        return
    fi

    # Use jq to extract metrics from all snapshots and compute min/max/avg per node
    local trend_output=""
    for node in "${NODE_NAMES[@]}"; do
        local cpu_vals ram_vals disk_vals disk_img_vals gpu_util_vals gpu_mem_vals
        cpu_vals=""
        ram_vals=""
        disk_vals=""
        disk_img_vals=""
        gpu_util_vals=""
        gpu_mem_vals=""

        while IFS= read -r snap_file; do
            [[ -z "$snap_file" ]] && continue

            local cpu ram disk disk_img gpu_util gpu_mem
            cpu=$(jq -r --arg n "$node" '.nodes[$n].prometheus.cpu_pct // empty' "$snap_file" 2>/dev/null)
            ram=$(jq -r --arg n "$node" '.nodes[$n].prometheus.ram_pct // empty' "$snap_file" 2>/dev/null)
            disk=$(jq -r --arg n "$node" '.nodes[$n].prometheus.disk_root_pct // empty' "$snap_file" 2>/dev/null)
            disk_img=$(jq -r --arg n "$node" '.nodes[$n].prometheus.disk_img_saved_pct // empty' "$snap_file" 2>/dev/null)
            gpu_util=$(jq -r --arg n "$node" '.nodes[$n].prometheus.gpu_util_pct // empty' "$snap_file" 2>/dev/null)
            gpu_mem=$(jq -r --arg n "$node" '.nodes[$n].prometheus.gpu_mem_pct // empty' "$snap_file" 2>/dev/null)

            [[ -n "$cpu" && "$cpu" != "null" ]] && cpu_vals="$cpu_vals $cpu"
            [[ -n "$ram" && "$ram" != "null" ]] && ram_vals="$ram_vals $ram"
            [[ -n "$disk" && "$disk" != "null" ]] && disk_vals="$disk_vals $disk"
            [[ -n "$disk_img" && "$disk_img" != "null" ]] && disk_img_vals="$disk_img_vals $disk_img"
            [[ -n "$gpu_util" && "$gpu_util" != "null" ]] && gpu_util_vals="$gpu_util_vals $gpu_util"
            [[ -n "$gpu_mem" && "$gpu_mem" != "null" ]] && gpu_mem_vals="$gpu_mem_vals $gpu_mem"
        done <<< "$snapshots"

        trend_output="${trend_output}Node: $node ($count samples)\n"

        for metric_name in cpu_pct ram_pct disk_root_pct disk_img_saved_pct gpu_util_pct gpu_mem_pct; do
            local vals_var
            case "$metric_name" in
                cpu_pct)            vals_var="$cpu_vals" ;;
                ram_pct)            vals_var="$ram_vals" ;;
                disk_root_pct)      vals_var="$disk_vals" ;;
                disk_img_saved_pct) vals_var="$disk_img_vals" ;;
                gpu_util_pct)       vals_var="$gpu_util_vals" ;;
                gpu_mem_pct)        vals_var="$gpu_mem_vals" ;;
            esac

            if [[ -n "$vals_var" ]]; then
                local stats
                stats=$(echo "$vals_var" | tr ' ' '\n' | grep -v '^$' | awk '
                    BEGIN { min=999999; max=-999999; sum=0; n=0 }
                    {
                        val=$1+0;
                        if(val<min) min=val;
                        if(val>max) max=val;
                        sum+=val;
                        n++
                    }
                    END {
                        if(n>0) printf "min=%.1f max=%.1f avg=%.1f", min, max, sum/n;
                        else print "no data"
                    }
                ')
                trend_output="${trend_output}  ${metric_name}: ${stats}\n"
            fi
        done
        trend_output="${trend_output}\n"
    done

    echo -e "$trend_output"
}

log "Computing 24h trends..."
TREND_SUMMARY=$(compute_trends)

# ---------------------------------------------------------------------------
# Read existing improvements
# ---------------------------------------------------------------------------
IMPROVEMENTS_FILE="$REPORT_DIR/improvements.md"
if [[ -f "$IMPROVEMENTS_FILE" ]]; then
    IMPROVEMENTS_CONTENT=$(cat "$IMPROVEMENTS_FILE")
else
    IMPROVEMENTS_CONTENT="No previous improvements"
fi

# ---------------------------------------------------------------------------
# Build the AI analysis prompt
# ---------------------------------------------------------------------------
PROMPT="You are JARVIS, analyzing a VisionKing industrial visual inspection system.

DEPLOYMENT: VisionKing ${DEPLOYMENT_ID} (Laminacao/Steel)
ARCHITECTURE: 3-node deployment — vk01/vk02 are processing nodes (GPU inference, camera acquisition, Redis, RabbitMQ), vk03 is dashboard-only (backend, frontend, PostgreSQL).
PIPELINE: Cameras -> Redis DB0 (frame cache) -> Image Saver -> RabbitMQ -> Inference (GPU/ONNX) -> Database Writers -> PostgreSQL -> Backend API -> Frontend

CURRENT SNAPSHOT:
${CURRENT_JSON}

PREVIOUS SNAPSHOT:
${PREVIOUS_JSON}

24H TREND SUMMARY:
${TREND_SUMMARY}

EXISTING IMPROVEMENTS (do NOT repeat these — only add genuinely NEW findings):
${IMPROVEMENTS_CONTENT}

ANALYSIS INSTRUCTIONS:
Produce a structured analysis report with these sections:

### SEVERITY: HEALTHY|WARNING|CRITICAL

### Executive Summary
2-3 sentence overview.

### Node Status
| Node | CPU | RAM | Disk | GPU | Containers | Status |
For each node, include key metrics.

### Pipeline Health
Analyze the camera -> inference -> database writer flow. Check:
- Are queues building up? (queue depth > 0 sustained = processing bottleneck)
- Container restart counts (instability indicator)
- Error log patterns across services

### PLC & Production State
Redis DB1 contains PLC state: speed, material position, part presence, tracking triggers.
Interpret what this means for production line activity:
- Is the line running? (speed > 0, part presence active)
- What speed is it running at?
- Are triggers firing? (camera acquisition active)

### GUI & Infrastructure Status
Are all web interfaces responding? Flag any non-200 status codes.

### Changes Since Last Check
Delta between current and previous snapshot. Highlight significant changes.

### Trending Concerns
Based on 24h trends, what metrics are moving in a concerning direction?

### Error Log Analysis
Cross-correlate errors across services. Look for:
- Cascade failures (one service error causing others)
- Repeated patterns
- OOM or resource exhaustion signals

### Recommendations
- Immediate (fix now)
- Short-term (this week)
- Long-term (architectural)

### NEW IMPROVEMENTS
Numbered list of new actionable findings not already in the existing improvements list. Format:
1. [WARNING|SUGGESTION|INFO] Description — specific recommendation"

# ---------------------------------------------------------------------------
# Run Claude AI analysis
# ---------------------------------------------------------------------------
log "Running Claude AI analysis (this may take 1-2 minutes)..."
ANALYSIS_START=$(date +%s)

CLAUDE_STDERR=$(mktemp)
ANALYSIS_OUTPUT=$(echo "$PROMPT" | claude -p \
    --model claude-opus-4-6 \
    --output-format text \
    --no-session-persistence \
    --dangerously-skip-permissions 2>"$CLAUDE_STDERR") || {
    log "ERROR: Claude AI analysis failed (exit code $?)"
    if [[ -s "$CLAUDE_STDERR" ]]; then
        log "ERROR: stderr: $(cat "$CLAUDE_STDERR")"
    fi
    if [[ -n "$ANALYSIS_OUTPUT" ]]; then
        log "ERROR: stdout: $(echo "$ANALYSIS_OUTPUT" | head -5)"
    fi
    rm -f "$CLAUDE_STDERR"
    exit 1
}
# Append stderr to main log (warnings, progress info)
if [[ -s "$CLAUDE_STDERR" ]]; then
    cat "$CLAUDE_STDERR" >> "$LOG_DIR/cron-vk-health.log"
fi
rm -f "$CLAUDE_STDERR"

ANALYSIS_END=$(date +%s)
ANALYSIS_DURATION=$((ANALYSIS_END - ANALYSIS_START))
log "AI analysis completed in ${ANALYSIS_DURATION}s"

# ---------------------------------------------------------------------------
# Save the full report
# ---------------------------------------------------------------------------
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
REPORT_FILE="$REPORT_DIR/analysis-${TIMESTAMP}.md"
LATEST_FILE="$REPORT_DIR/latest.md"

echo "$ANALYSIS_OUTPUT" > "$REPORT_FILE"
log "Report saved: $REPORT_FILE"

# Create/update latest symlink
ln -sf "$REPORT_FILE" "$LATEST_FILE"
log "Latest symlink updated: $LATEST_FILE"

# ---------------------------------------------------------------------------
# Extract NEW IMPROVEMENTS and append to improvements.md
# ---------------------------------------------------------------------------
extract_improvements() {
    local output="$1"

    # Extract everything after "### NEW IMPROVEMENTS" until the next ### heading or end of file
    local improvements
    improvements=$(echo "$output" | awk '
        /^### NEW IMPROVEMENTS/ { found=1; next }
        found && /^### / { exit }
        found { print }
    ')

    # Trim leading/trailing blank lines
    improvements=$(echo "$improvements" | sed '/^[[:space:]]*$/d')

    echo "$improvements"
}

NEW_IMPROVEMENTS=$(extract_improvements "$ANALYSIS_OUTPUT")

if [[ -n "$NEW_IMPROVEMENTS" ]]; then
    # Extract severity from the report
    SEVERITY=$(echo "$ANALYSIS_OUTPUT" | grep -oP '#{2,4} SEVERITY:\s*\K\w+' | head -1) || true
    SEVERITY="${SEVERITY:-UNKNOWN}"

    IMPROVEMENT_HEADER="## $(date '+%Y-%m-%d %H:%M') -- ${SEVERITY}"

    # Create file with header if it does not exist
    if [[ ! -f "$IMPROVEMENTS_FILE" ]]; then
        echo "# VisionKing ${DEPLOYMENT_ID} -- Live Improvements Report" > "$IMPROVEMENTS_FILE"
        echo "" >> "$IMPROVEMENTS_FILE"
    fi

    {
        echo ""
        echo "$IMPROVEMENT_HEADER"
        echo "$NEW_IMPROVEMENTS"
    } >> "$IMPROVEMENTS_FILE"

    log "Appended $(echo "$NEW_IMPROVEMENTS" | wc -l) improvement(s) to $IMPROVEMENTS_FILE"
else
    log "No new improvements extracted from analysis"
fi

log "Analysis pipeline complete for deployment $DEPLOYMENT_ID"
