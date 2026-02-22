#!/usr/bin/env bash
# JARVIS — System Health Check
# Runs 12 automated checks and produces a scored report.
# Usage: system-health-check.sh [--quiet]
#   --quiet: only output the report path (for cron usage)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"

QUIET=false
[[ "${1:-}" == "--quiet" ]] && QUIET=true

REPORT_DIR="${ORCHESTRATOR_HOME}/reports/system-health"
mkdir -p "$REPORT_DIR"

NOW=$(date '+%Y-%m-%d')
REPORT_FILE="${REPORT_DIR}/health-${NOW}.md"

# Scoring
TOTAL_CHECKS=12
PASSED=0
WARNINGS=0
FAILURES=0

# Collector arrays (bash 4+)
declare -a PASS_LINES=()
declare -a WARN_LINES=()
declare -a FAIL_LINES=()
declare -a ACTION_LINES=()

pass() { PASSED=$((PASSED + 1)); PASS_LINES+=("- [PASS] $1"); }
warn() { WARNINGS=$((WARNINGS + 1)); WARN_LINES+=("- [WARN] $1"); [[ -n "${2:-}" ]] && ACTION_LINES+=("- $2"); }
fail() { FAILURES=$((FAILURES + 1)); FAIL_LINES+=("- [FAIL] $1"); [[ -n "${2:-}" ]] && ACTION_LINES+=("- $2"); }

# ---------------------------------------------------------------------------
# CHECK 01: Stale paths — grep for 'claude-orchestrator'
# ---------------------------------------------------------------------------
STALE_COUNT=$({ grep -rl 'claude-orchest''rator' \
  "${ORCHESTRATOR_HOME}/scripts/" \
  "${ORCHESTRATOR_HOME}/mcp-servers/" \
  "${ORCHESTRATOR_HOME}/tools/orchestrator-dashboard/" \
  "${ORCHESTRATOR_HOME}/setup/" \
  --include='*.sh' --include='*.js' --include='*.mjs' \
  --exclude='system-health-check.sh' 2>/dev/null \
  | grep -v node_modules || true; } | wc -l)

if [[ "$STALE_COUNT" -eq 0 ]]; then
  pass "CHECK_01 STALE_PATHS: No stale 'claude-orchestrator' references"
else
  fail "CHECK_01 STALE_PATHS: ${STALE_COUNT} files with stale paths" \
    "Run: \`grep -rl 'claude-orchestrator' scripts/ mcp-servers/ setup/\` and update"
fi

# ---------------------------------------------------------------------------
# CHECK 02: Gitignore gaps — verify key patterns exist
# ---------------------------------------------------------------------------
GITIGNORE="${ORCHESTRATOR_HOME}/.gitignore"
MISSING_PATTERNS=""
for pattern in '**/.venv/' '__pycache__/' '*.pyc' '.env'; do
  if ! grep -qF "$pattern" "$GITIGNORE" 2>/dev/null; then
    MISSING_PATTERNS="${MISSING_PATTERNS} ${pattern}"
  fi
done

if [[ -z "$MISSING_PATTERNS" ]]; then
  pass "CHECK_02 GITIGNORE_GAPS: All expected patterns present"
else
  warn "CHECK_02 GITIGNORE_GAPS: Missing patterns:${MISSING_PATTERNS}" \
    "Add missing patterns to .gitignore:${MISSING_PATTERNS}"
fi

# ---------------------------------------------------------------------------
# CHECK 03: Report accumulation — VK health analysis files
# ---------------------------------------------------------------------------
VK_ANALYSIS_COUNT=0
for dir in "${ORCHESTRATOR_HOME}"/reports/vk-health/*/; do
  [[ -d "$dir" ]] || continue
  COUNT=$(find "$dir" -maxdepth 1 -name 'analysis-*.md' -type f 2>/dev/null | wc -l)
  VK_ANALYSIS_COUNT=$((VK_ANALYSIS_COUNT + COUNT))
done

if [[ "$VK_ANALYSIS_COUNT" -le 50 ]]; then
  pass "CHECK_03 REPORT_ACCUMULATION: ${VK_ANALYSIS_COUNT} VK analysis files (threshold: 50)"
elif [[ "$VK_ANALYSIS_COUNT" -le 100 ]]; then
  warn "CHECK_03 REPORT_ACCUMULATION: ${VK_ANALYSIS_COUNT} VK analysis files accumulating" \
    "Run cleanup: \`scripts/vk-health/cleanup-reports.sh\`"
else
  fail "CHECK_03 REPORT_ACCUMULATION: ${VK_ANALYSIS_COUNT} VK analysis files — cleanup overdue" \
    "Run cleanup: \`scripts/vk-health/cleanup-reports.sh\`"
fi

# ---------------------------------------------------------------------------
# CHECK 04: Log sizes — warn if any log exceeds 10 MB
# ---------------------------------------------------------------------------
BIG_LOGS=""
if [[ -d "${ORCHESTRATOR_HOME}/logs" ]]; then
  while IFS= read -r logfile; do
    [[ -z "$logfile" ]] && continue
    SIZE_KB=$(du -k "$logfile" 2>/dev/null | cut -f1)
    if [[ "$SIZE_KB" -gt 10240 ]]; then
      BIG_LOGS="${BIG_LOGS} $(basename "$logfile")(${SIZE_KB}KB)"
    fi
  done < <(find "${ORCHESTRATOR_HOME}/logs" -maxdepth 1 -type f -name '*.log' -o -name '*.json' 2>/dev/null)
fi

if [[ -z "$BIG_LOGS" ]]; then
  pass "CHECK_04 LOG_SIZES: All logs under 10 MB"
else
  warn "CHECK_04 LOG_SIZES: Large logs:${BIG_LOGS}" \
    "Consider rotating large log files"
fi

# ---------------------------------------------------------------------------
# CHECK 05: Untracked file count
# ---------------------------------------------------------------------------
UNTRACKED=$(git -C "$ORCHESTRATOR_HOME" ls-files --others --exclude-standard 2>/dev/null | wc -l)

if [[ "$UNTRACKED" -le 50 ]]; then
  pass "CHECK_05 UNTRACKED_COUNT: ${UNTRACKED} untracked files"
elif [[ "$UNTRACKED" -le 200 ]]; then
  warn "CHECK_05 UNTRACKED_COUNT: ${UNTRACKED} untracked files (threshold: 200)" \
    "Review untracked files: \`git ls-files --others --exclude-standard\`"
else
  fail "CHECK_05 UNTRACKED_COUNT: ${UNTRACKED} untracked files — .gitignore likely incomplete" \
    "Audit .gitignore patterns — run: \`git ls-files --others --exclude-standard | head -50\`"
fi

# ---------------------------------------------------------------------------
# CHECK 06: npm deduplication — workspaces configured
# ---------------------------------------------------------------------------
if [[ -f "${ORCHESTRATOR_HOME}/mcp-servers/package.json" ]]; then
  HAS_WORKSPACES=$(jq -r '.workspaces // empty | length' "${ORCHESTRATOR_HOME}/mcp-servers/package.json" 2>/dev/null)
  if [[ "$HAS_WORKSPACES" -gt 0 ]]; then
    pass "CHECK_06 NODE_DEDUP: npm workspaces configured (${HAS_WORKSPACES} servers)"
  else
    warn "CHECK_06 NODE_DEDUP: package.json exists but no workspaces defined" \
      "Add workspaces array to mcp-servers/package.json"
  fi
else
  fail "CHECK_06 NODE_DEDUP: No root package.json — MCP servers have duplicated dependencies" \
    "Create mcp-servers/package.json with workspaces config"
fi

# ---------------------------------------------------------------------------
# CHECK 07: Unused MCP servers — cross-ref against hooks + skills
# ---------------------------------------------------------------------------
MCP_DIRS=""
UNUSED_MCP=""
if [[ -d "${ORCHESTRATOR_HOME}/mcp-servers" ]]; then
  for mcp_dir in "${ORCHESTRATOR_HOME}"/mcp-servers/*/; do
    [[ -d "$mcp_dir" ]] || continue
    [[ "$(basename "$mcp_dir")" == "lib" ]] && continue
    [[ "$(basename "$mcp_dir")" == "node_modules" ]] && continue
    MCP_NAME=$(basename "$mcp_dir")
    MCP_DIRS="${MCP_DIRS} ${MCP_NAME}"
    # Check if referenced in hooks or skills
    HOOK_REF=$({ grep -rl "${MCP_NAME}" "${ORCHESTRATOR_HOME}/.claude/hooks/" 2>/dev/null || true; } | wc -l)
    SKILL_REF=$({ grep -rl "${MCP_NAME}" "${ORCHESTRATOR_HOME}/.claude/skills/" 2>/dev/null || true; } | wc -l)
    SCRIPT_REF=$({ grep -rl "${MCP_NAME}" "${ORCHESTRATOR_HOME}/scripts/" 2>/dev/null | grep -v node_modules || true; } | wc -l)
    if [[ "$HOOK_REF" -eq 0 && "$SKILL_REF" -eq 0 && "$SCRIPT_REF" -eq 0 ]]; then
      UNUSED_MCP="${UNUSED_MCP} ${MCP_NAME}"
    fi
  done
fi

if [[ -z "$UNUSED_MCP" ]]; then
  pass "CHECK_07 UNUSED_MCP: All MCP servers are referenced"
else
  warn "CHECK_07 UNUSED_MCP: Unreferenced servers:${UNUSED_MCP}" \
    "Review if these MCP servers are still needed:${UNUSED_MCP}"
fi

# ---------------------------------------------------------------------------
# CHECK 08: Context.md stubs — count "No description available"
# ---------------------------------------------------------------------------
STUB_COUNT=0
TOTAL_CONTEXTS=0
if [[ -f "$WORKSPACES_CONFIG" ]]; then
  while IFS= read -r ws_path; do
    [[ -z "$ws_path" ]] && continue
    CTX="${ws_path}/.claude/context.md"
    if [[ -f "$CTX" ]]; then
      TOTAL_CONTEXTS=$((TOTAL_CONTEXTS + 1))
      if grep -q "No description available" "$CTX" 2>/dev/null; then
        STUB_COUNT=$((STUB_COUNT + 1))
      fi
    fi
  done < <(jq -r '.workspaces | to_entries[] | .value.path' "$WORKSPACES_CONFIG" 2>/dev/null)
fi

STUB_PCT=0
if [[ "$TOTAL_CONTEXTS" -gt 0 ]]; then
  STUB_PCT=$(( (STUB_COUNT * 100) / TOTAL_CONTEXTS ))
fi

if [[ "$STUB_PCT" -le 30 ]]; then
  pass "CHECK_08 CONTEXT_STUBS: ${STUB_COUNT}/${TOTAL_CONTEXTS} stubs (${STUB_PCT}%)"
elif [[ "$STUB_PCT" -le 70 ]]; then
  warn "CHECK_08 CONTEXT_STUBS: ${STUB_COUNT}/${TOTAL_CONTEXTS} stubs (${STUB_PCT}%)" \
    "Run: \`node scripts/populate-workspace-metadata.mjs\`"
else
  fail "CHECK_08 CONTEXT_STUBS: ${STUB_COUNT}/${TOTAL_CONTEXTS} stubs (${STUB_PCT}%) — most contexts are empty" \
    "Run: \`node scripts/populate-workspace-metadata.mjs\`"
fi

# ---------------------------------------------------------------------------
# CHECK 09: Workspace types — count type="unknown"
# ---------------------------------------------------------------------------
UNKNOWN_TYPES=0
TOTAL_WORKSPACES=0
if [[ -f "$WORKSPACES_CONFIG" ]]; then
  TOTAL_WORKSPACES=$(jq '.workspaces | length' "$WORKSPACES_CONFIG" 2>/dev/null || echo 0)
  UNKNOWN_TYPES=$(jq '[.workspaces | to_entries[] | select(.value.type == "unknown")] | length' "$WORKSPACES_CONFIG" 2>/dev/null || echo 0)
fi

UNKNOWN_PCT=0
if [[ "$TOTAL_WORKSPACES" -gt 0 ]]; then
  UNKNOWN_PCT=$(( (UNKNOWN_TYPES * 100) / TOTAL_WORKSPACES ))
fi

if [[ "$UNKNOWN_PCT" -le 30 ]]; then
  pass "CHECK_09 WORKSPACE_TYPES: ${UNKNOWN_TYPES}/${TOTAL_WORKSPACES} unknown (${UNKNOWN_PCT}%)"
elif [[ "$UNKNOWN_PCT" -le 70 ]]; then
  warn "CHECK_09 WORKSPACE_TYPES: ${UNKNOWN_TYPES}/${TOTAL_WORKSPACES} unknown (${UNKNOWN_PCT}%)" \
    "Run: \`node scripts/populate-workspace-metadata.mjs\`"
else
  fail "CHECK_09 WORKSPACE_TYPES: ${UNKNOWN_TYPES}/${TOTAL_WORKSPACES} unknown (${UNKNOWN_PCT}%)" \
    "Run: \`node scripts/populate-workspace-metadata.mjs\` or manually set types"
fi

# ---------------------------------------------------------------------------
# CHECK 10: CLAUDE.md health — Lessons Learned line count
# ---------------------------------------------------------------------------
CLAUDE_MD="${ORCHESTRATOR_HOME}/.claude/CLAUDE.md"
if [[ -f "$CLAUDE_MD" ]]; then
  TOTAL_LINES=$(wc -l < "$CLAUDE_MD")
  # Count lines after "## Key Principles" or "## Lessons"
  LESSONS_LINES=$(sed -n '/^## Key Principles/,/^## /p' "$CLAUDE_MD" 2>/dev/null | wc -l || echo 0)

  if [[ "$TOTAL_LINES" -le 100 ]]; then
    pass "CHECK_10 MEMORY_HEALTH: CLAUDE.md at ${TOTAL_LINES} lines (threshold: 100)"
  elif [[ "$TOTAL_LINES" -le 150 ]]; then
    warn "CHECK_10 MEMORY_HEALTH: CLAUDE.md at ${TOTAL_LINES} lines — growing" \
      "Consider trimming CLAUDE.md and extracting to MEMORY.md"
  else
    fail "CHECK_10 MEMORY_HEALTH: CLAUDE.md at ${TOTAL_LINES} lines — too large" \
      "Extract session-specific content to docs/lessons-learned.md and MEMORY.md"
  fi
else
  warn "CHECK_10 MEMORY_HEALTH: CLAUDE.md not found" \
    "Create .claude/CLAUDE.md with project guidelines"
fi

# ---------------------------------------------------------------------------
# CHECK 11: VK consolidation lag
# ---------------------------------------------------------------------------
CONSOLIDATION_OK=true
for dir in "${ORCHESTRATOR_HOME}"/reports/vk-health/*/; do
  [[ -d "$dir" ]] || continue
  STATE_FILE="${dir}consolidation-state.json"
  OLDEST_ANALYSIS=""

  if [[ -f "$STATE_FILE" ]]; then
    LAST_CONSOLIDATED=$(jq -r '.last_consolidated // empty' "$STATE_FILE" 2>/dev/null)
    # Find oldest analysis file
    OLDEST_ANALYSIS=$(find "$dir" -maxdepth 1 -name 'analysis-*.md' -type f -printf '%T@ %p\n' 2>/dev/null \
      | sort -n | head -1 | awk '{print $2}')

    if [[ -n "$OLDEST_ANALYSIS" ]]; then
      # Check if oldest file is more than 7 days old
      if find "$OLDEST_ANALYSIS" -mtime +7 -print -quit 2>/dev/null | grep -q .; then
        CONSOLIDATION_OK=false
      fi
    fi
  else
    # No consolidation state — check if there are analysis files at all
    ANALYSIS_COUNT=$(find "$dir" -maxdepth 1 -name 'analysis-*.md' -type f 2>/dev/null | wc -l)
    if [[ "$ANALYSIS_COUNT" -gt 0 ]]; then
      CONSOLIDATION_OK=false
    fi
  fi
done

if $CONSOLIDATION_OK; then
  pass "CHECK_11 CONSOLIDATION_LAG: VK consolidation is current"
else
  warn "CHECK_11 CONSOLIDATION_LAG: Analysis files older than 7 days not consolidated" \
    "Run: \`scripts/vk-health/cleanup-reports.sh\`"
fi

# ---------------------------------------------------------------------------
# CHECK 12: Hook matchers — verify all reference existing MCP servers
# ---------------------------------------------------------------------------
SETTINGS_FILE="${ORCHESTRATOR_HOME}/.claude/settings.local.json"
INVALID_HOOKS=""
if [[ -f "$SETTINGS_FILE" ]]; then
  MATCHERS=$(jq -r '[.hooks // {} | to_entries[] | .value[] | .matcher // empty] | unique | .[]' "$SETTINGS_FILE" 2>/dev/null)
  for matcher in $MATCHERS; do
    SERVER_DIR=$(echo "$matcher" | sed -n 's/^mcp__\(.*\)__[^_]*$/\1/p' | tr '_' '-')
    if [[ -n "$SERVER_DIR" ]]; then
      MCP_PATH="${ORCHESTRATOR_HOME}/mcp-servers/${SERVER_DIR}/index.js"
      if [[ ! -f "$MCP_PATH" ]]; then
        INVALID_HOOKS="${INVALID_HOOKS} ${matcher}"
      fi
    fi
  done
fi

if [[ -z "$INVALID_HOOKS" ]]; then
  pass "CHECK_12 HOOK_MATCHERS: All hook matchers reference valid MCP servers"
else
  fail "CHECK_12 HOOK_MATCHERS: Invalid matchers:${INVALID_HOOKS}" \
    "Fix hook matchers in .claude/settings.local.json"
fi

# ---------------------------------------------------------------------------
# Calculate score
# ---------------------------------------------------------------------------
# Each check: PASS=100%, WARN=50%, FAIL=0%
SCORE=$(( (PASSED * 100 + WARNINGS * 50) * 100 / (TOTAL_CHECKS * 100) ))

# ---------------------------------------------------------------------------
# Generate report
# ---------------------------------------------------------------------------
{
  echo "# JARVIS System Health Report — ${NOW}"
  echo ""
  echo "**Score: ${SCORE}/100**"
  echo ""
  echo "| Status | Count |"
  echo "|--------|-------|"
  echo "| Passed | ${PASSED} |"
  echo "| Warnings | ${WARNINGS} |"
  echo "| Failures | ${FAILURES} |"
  echo ""

  if [[ ${#FAIL_LINES[@]} -gt 0 ]]; then
    echo "## Critical Issues (${FAILURES})"
    echo ""
    printf '%s\n' "${FAIL_LINES[@]}"
    echo ""
  fi

  if [[ ${#WARN_LINES[@]} -gt 0 ]]; then
    echo "## Warnings (${WARNINGS})"
    echo ""
    printf '%s\n' "${WARN_LINES[@]}"
    echo ""
  fi

  if [[ ${#PASS_LINES[@]} -gt 0 ]]; then
    echo "## Healthy (${PASSED})"
    echo ""
    printf '%s\n' "${PASS_LINES[@]}"
    echo ""
  fi

  if [[ ${#ACTION_LINES[@]} -gt 0 ]]; then
    echo "## Recommended Actions"
    echo ""
    printf '%s\n' "${ACTION_LINES[@]}"
    echo ""
  fi

  echo "---"
  echo "*Generated by \`scripts/system-health-check.sh\` on $(date '+%Y-%m-%d %H:%M:%S')*"
} > "$REPORT_FILE"

# Also save as latest
cp "$REPORT_FILE" "${REPORT_DIR}/latest.md"

# Cleanup old reports (keep 12 weeks)
find "$REPORT_DIR" -name 'health-*.md' -mtime +84 -delete 2>/dev/null || true

# Output
if $QUIET; then
  echo "$REPORT_FILE"
else
  cat "$REPORT_FILE"
fi
