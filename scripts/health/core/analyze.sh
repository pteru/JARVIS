#!/bin/bash
# Health Monitor — generic config-driven Claude reporter
# Usage: analyze.sh <product> <deployment>
#
# Loads latest+previous snapshot, computes 24h trends, asks Claude to write a
# narrative health report, and saves all report artifacts.
#
# Interfaces:
#   Consumes: lib/config.sh (load_health_config)
#   Reads:    $DATA_DIR/<utc-date>/snapshot-*.json (newest + previous)
#   Writes:   $REPORT_DIR/analysis-<timestamp>.md
#             $REPORT_DIR/latest.md
#             $REPORT_DIR/consolidated-<utc-date>.md  (appended)
#             $REPORT_DIR/improvements.md             (appended)
#             $REPORT_DIR/consolidation-state.json    (state)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"

# ---------------------------------------------------------------------------
# Load config
# ---------------------------------------------------------------------------
# shellcheck source=../lib/config.sh
source "$LIB_DIR/config.sh"
load_health_config "${1:?product required}" "${2:?deployment required}"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] [analyze] $*" >&2; }

mkdir -p "$REPORT_DIR"

TODAY=$(date -u +%Y-%m-%d)
SNAPSHOT_DIR="$DATA_DIR/$TODAY"

# ---------------------------------------------------------------------------
# Find the latest snapshot
# ---------------------------------------------------------------------------
if [[ ! -d "$SNAPSHOT_DIR" ]]; then
    log "ERROR: No snapshot directory for today: $SNAPSHOT_DIR"
    exit 1
fi

LATEST_SNAPSHOT=$(ls -t "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null | head -n 1 || true)
if [[ -z "$LATEST_SNAPSHOT" ]]; then
    log "ERROR: No snapshots found in $SNAPSHOT_DIR"
    exit 1
fi
log "Latest snapshot: $LATEST_SNAPSHOT"

# ---------------------------------------------------------------------------
# Find the previous snapshot (second most recent, or yesterday's latest)
# ---------------------------------------------------------------------------
PREVIOUS_SNAPSHOT=$(ls -t "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null | sed -n '2p' || true)

if [[ -z "$PREVIOUS_SNAPSHOT" ]]; then
    # Try yesterday
    YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d 2>/dev/null)
    YESTERDAY_DIR="$DATA_DIR/$YESTERDAY"
    if [[ -d "$YESTERDAY_DIR" ]]; then
        PREVIOUS_SNAPSHOT=$(ls -t "$YESTERDAY_DIR"/snapshot-*.json 2>/dev/null | head -n 1 || true)
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
# Iterates the flat metrics object (keys from the first snapshot).
# ---------------------------------------------------------------------------
compute_trends() {
    local snapshots
    snapshots=$(ls -t "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null || true)
    local count
    count=$(echo "$snapshots" | grep -c 'snapshot' || true)

    if [[ "$count" -lt 2 ]]; then
        echo "Insufficient data for trends (only $count snapshot(s) today)"
        return
    fi

    # Collect all metric keys from the first snapshot's .metrics object
    local first_snap
    first_snap=$(echo "$snapshots" | tail -n 1)
    local metric_keys
    metric_keys=$(jq -r '.metrics // {} | keys[]' "$first_snap" 2>/dev/null || true)

    if [[ -z "$metric_keys" ]]; then
        echo "No metrics found in snapshots for trend computation"
        return
    fi

    local trend_output="Trend summary ($count samples):"$'\n'

    while IFS= read -r metric_key; do
        local vals=""
        while IFS= read -r snap_file; do
            [[ -z "$snap_file" ]] && continue
            local v
            v=$(jq -r --arg k "$metric_key" '.metrics[$k] // empty' "$snap_file" 2>/dev/null || true)
            # Only accumulate numeric values
            if [[ -n "$v" && "$v" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
                vals="$vals $v"
            fi
        done <<< "$snapshots"

        if [[ -n "$vals" ]]; then
            local stats
            stats=$(echo "$vals" | tr ' ' '\n' | grep -v '^$' | awk '
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
            trend_output="${trend_output}  ${metric_key}: ${stats}"$'\n'
        fi
    done <<< "$metric_keys"

    echo "$trend_output"
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
PROMPT="You are JARVIS, analyzing an industrial monitoring deployment.

DEPLOYMENT: ${HEALTH_NAME}

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
For each node, include key metrics and current status.

### Pipeline Health
Analyze the data pipeline flow. Check:
- Are queues building up?
- Container restart counts (instability indicator)
- Error log patterns across services

### Infrastructure State
Interpret what the current snapshot reveals about operational state.

### GUI & Infrastructure Status
Are all web interfaces responding? Flag any non-200 status codes.

### Changes Since Last Check
Delta between current and previous snapshot. Highlight significant changes.

### Trending Concerns
Based on 24h trends, what metrics are moving in a concerning direction?

### Error Log Analysis
Cross-correlate errors across services. Look for:
- Cascade failures
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
    --model "$CLAUDE_MODEL" \
    --output-format text \
    --no-session-persistence \
    --dangerously-skip-permissions 2>"$CLAUDE_STDERR") || {
    log "ERROR: Claude AI analysis failed (exit code $?)"
    if [[ -s "$CLAUDE_STDERR" ]]; then
        log "ERROR: stderr: $(cat "$CLAUDE_STDERR")"
    fi
    rm -f "$CLAUDE_STDERR"
    exit 1
}
if [[ -s "$CLAUDE_STDERR" ]]; then
    cat "$CLAUDE_STDERR" >&2
fi
rm -f "$CLAUDE_STDERR"

ANALYSIS_END=$(date +%s)
ANALYSIS_DURATION=$((ANALYSIS_END - ANALYSIS_START))
log "AI analysis completed in ${ANALYSIS_DURATION}s"

# ---------------------------------------------------------------------------
# Save the full report
# ---------------------------------------------------------------------------
TIMESTAMP=$(date -u '+%Y-%m-%d_%H-%M-%S')
REPORT_FILE="$REPORT_DIR/analysis-${TIMESTAMP}.md"
LATEST_FILE="$REPORT_DIR/latest.md"

echo "$ANALYSIS_OUTPUT" > "$REPORT_FILE"
log "Report saved: $REPORT_FILE"

# Copy to latest (not symlink — per-run files get cleaned up)
cp "$REPORT_FILE" "$LATEST_FILE"
log "Latest report updated: $LATEST_FILE"

# ---------------------------------------------------------------------------
# Consolidate into rolling daily report
# ---------------------------------------------------------------------------
CONSOLIDATED_FILE="$REPORT_DIR/consolidated-${TODAY}.md"
CONSOLIDATION_STATE="$REPORT_DIR/consolidation-state.json"

# Extract severity and executive summary for the consolidated report
REPORT_SEVERITY=$(echo "$ANALYSIS_OUTPUT" | grep -oP '#{2,4} SEVERITY:\s*\K\w+' | head -1) || true
REPORT_SEVERITY="${REPORT_SEVERITY:-UNKNOWN}"
EXEC_SUMMARY=$(echo "$ANALYSIS_OUTPUT" | awk '/^### Executive Summary/{found=1; next} found && /^### /{exit} found{print}' | sed '/^[[:space:]]*$/d')

if [[ ! -f "$CONSOLIDATED_FILE" ]]; then
    echo "# ${HEALTH_NAME} — Consolidated Report ${TODAY}" > "$CONSOLIDATED_FILE"
    echo "" >> "$CONSOLIDATED_FILE"
fi

{
    echo "---"
    echo "## $(date -u '+%H:%M') — ${REPORT_SEVERITY}"
    echo ""
    if [[ -n "$EXEC_SUMMARY" ]]; then
        echo "$EXEC_SUMMARY"
        echo ""
    fi
    RECS=$(echo "$ANALYSIS_OUTPUT" | awk '/^### Recommendations/{found=1; next} found && /^### /{exit} found{print}' | sed '/^[[:space:]]*$/d')
    if [[ -n "$RECS" ]]; then
        echo "**Recommendations:**"
        echo "$RECS"
        echo ""
    fi
} >> "$CONSOLIDATED_FILE"

# Update consolidation state
echo "{\"last_consolidated\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\", \"report_file\": \"$REPORT_FILE\"}" > "$CONSOLIDATION_STATE"
log "Consolidated into $CONSOLIDATED_FILE"

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

    IMPROVEMENT_HEADER="## ${TODAY} -- ${SEVERITY}"

    # Create file with header if it does not exist
    if [[ ! -f "$IMPROVEMENTS_FILE" ]]; then
        echo "# ${HEALTH_NAME} -- Live Improvements Report" > "$IMPROVEMENTS_FILE"
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

log "Analysis pipeline complete for ${HEALTH_NAME} (${HEALTH_DEPLOYMENT})"
