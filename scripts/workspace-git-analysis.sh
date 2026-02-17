#!/bin/bash
# Generates reports/workspace-git-analysis.md from config/orchestrator/workspaces.json
# Usage: ./scripts/workspace-git-analysis.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JARVIS_HOME="$(dirname "$SCRIPT_DIR")"
CONFIG="$JARVIS_HOME/config/orchestrator/workspaces.json"
OUTPUT="$JARVIS_HOME/reports/workspace-git-analysis.md"
DATE=$(date +%Y-%m-%d)

if [ ! -f "$CONFIG" ]; then
    echo "ERROR: workspaces.json not found at $CONFIG" >&2
    exit 1
fi

WORKSPACES=$(node -e "
const c = JSON.parse(require('fs').readFileSync('$CONFIG', 'utf-8'));
Object.entries(c.workspaces).forEach(([name, w]) => {
    console.log(name + '|' + w.path + '|' + (w.product || 'unknown') + '|' + (w.category || 'unknown'));
});
" 2>/dev/null)

TOTAL=0; EXISTING=0; DIRTY=0; ON_FEATURE=0
declare -A PC PE

ALL=""

while IFS='|' read -r name ws_path product category; do
    TOTAL=$((TOTAL + 1))
    PC[$product]=$(( ${PC[$product]:-0} + 1 ))

    if [ ! -d "$ws_path/.git" ] && [ ! -f "$ws_path/.git" ]; then
        ALL+="MISS|$product|$name|N/A|—|—|—|N/A|N/A|N/A|$ws_path|none|
"
        continue
    fi

    EXISTING=$((EXISTING + 1))
    PE[$product]=$(( ${PE[$product]:-0} + 1 ))

    branch=$(git -C "$ws_path" branch --show-current 2>/dev/null || echo "detached")

    has_master="—"
    has_develop="—"
    git -C "$ws_path" rev-parse --verify master >/dev/null 2>&1 && has_master="✓"
    git -C "$ws_path" rev-parse --verify main >/dev/null 2>&1 && has_master="✓(main)"
    git -C "$ws_path" rev-parse --verify develop >/dev/null 2>&1 && has_develop="✓"

    remote_name=$(git -C "$ws_path" remote 2>/dev/null | head -1)
    remote_url=""
    if [ -n "$remote_name" ]; then
        remote_url=$(git -C "$ws_path" remote get-url "$remote_name" 2>/dev/null)
    fi

    last_date=$(git -C "$ws_path" log -1 --format="%ci" 2>/dev/null | cut -d' ' -f1)
    last_msg=$(git -C "$ws_path" log -1 --format="%s" 2>/dev/null | head -c 55)

    dirty="clean"
    if [ -n "$(git -C "$ws_path" status --porcelain 2>/dev/null | head -1)" ]; then
        dirty="dirty"
        DIRTY=$((DIRTY + 1))
    fi

    sync="—"
    tracking=$(git -C "$ws_path" rev-parse --abbrev-ref "@{upstream}" 2>/dev/null)
    if [ -n "$tracking" ]; then
        ab=$(git -C "$ws_path" rev-list --left-right --count "$tracking"...HEAD 2>/dev/null)
        behind=$(echo "$ab" | awk '{print $1}')
        ahead=$(echo "$ab" | awk '{print $2}')
        if [ "$ahead" = "0" ] && [ "$behind" = "0" ]; then
            sync="✓"
        else
            sync="↑${ahead}↓${behind}"
        fi
    fi

    if [ "$branch" != "master" ] && [ "$branch" != "main" ] && [ "$branch" != "develop" ]; then
        ON_FEATURE=$((ON_FEATURE + 1))
    fi

    rtype="github"
    echo "$remote_url" | grep -q "source.developers.google.com" && rtype="GSR"
    [ -z "$remote_name" ] && rtype="none"

    ALL+="OK|$product|$name|$branch|$has_master|$has_develop|$remote_name|$last_date|$dirty|$sync|$last_msg|$rtype|$remote_url
"
done <<< "$WORKSPACES"

# Count GSR repos
GSR_COUNT=$(echo "$ALL" | grep -c "|GSR|" || true)
GITHUB_COUNT=$((EXISTING - GSR_COUNT))
NO_DEVELOP=$(echo "$ALL" | grep "^OK|" | while IFS='|' read -r s p n b hm hd rest; do [ "$hd" = "—" ] && echo x; done | wc -l | tr -d ' ')

# === Generate report ===
{
cat << HEADER
# Workspace Git Analysis Report

**Report Date:** $DATE
**Report Type:** Automated Git Status Scan
**Analysis Scope:** DieMaster, SDK, SpotFusion, VisionKing

---

## Executive Summary

Automated scan of all $TOTAL configured workspaces. All workspace paths are under \`$JARVIS_HOME/workspaces/strokmatic/\`.

| Metric | Count |
|--------|-------|
| Total Workspaces Configured | $TOTAL |
| Existing on Disk | $EXISTING |
| Missing from Disk | $((TOTAL - EXISTING)) |
| Dirty (uncommitted changes) | $DIRTY |
| On Feature/Fix Branches | $ON_FEATURE |
| GSR Remaining | $GSR_COUNT |
| Without Develop Branch | $NO_DEVELOP |

### Per-Product Breakdown

| Product | Configured | Existing |
|---------|-----------|----------|
HEADER

for prod in diemaster sdk spotfusion visionking; do
    echo "| $prod | ${PC[$prod]:-0} | ${PE[$prod]:-0} |"
done

echo ""
echo "---"
echo ""

# Per-product tables
for prod in diemaster sdk spotfusion visionking; do
    PROD_UPPER=$(echo "$prod" | sed 's/./\U&/')
    echo "## $PROD_UPPER Repositories"
    echo ""
    echo "| Workspace | Branch | Master | Develop | Remote | Last Commit | Status | Sync |"
    echo "|-----------|--------|--------|---------|--------|-------------|--------|------|"
    echo "$ALL" | grep "^OK|$prod|" | sort -t'|' -k3 | while IFS='|' read -r status product ws_name branch has_master has_develop remote_name last_date drt sync last_msg rtype rurl; do
        short=$(echo "$ws_name" | sed "s/^strokmatic\.$prod$/~monorepo~/" | sed "s/^strokmatic\.$prod\.//")
        echo "| $short | \`$branch\` | $has_master | $has_develop | $remote_name | $last_date | $drt | $sync |"
    done
    MISS=$(echo "$ALL" | grep "^MISS|$prod|")
    if [ -n "$MISS" ]; then
        echo ""
        echo "**Missing from disk:**"
        echo "$MISS" | while IFS='|' read -r s p n b m d r ld di sy path rt ru; do
            echo "- \`$n\` → \`$path\`"
        done
    fi
    echo ""
    echo "---"
    echo ""
done

# Feature branches
echo "## Active Feature Branches"
echo ""
echo "| Workspace | Branch | Last Commit |"
echo "|-----------|--------|-------------|"
echo "$ALL" | grep "^OK|" | while IFS='|' read -r status product ws_name branch hm hd rn last_date drt sync lm rt ru; do
    if [ "$branch" != "master" ] && [ "$branch" != "main" ] && [ "$branch" != "develop" ] && [ "$branch" != "detached" ] && [ -n "$branch" ]; then
        short=$(echo "$ws_name" | sed 's/^strokmatic\.//')
        echo "| $short | \`$branch\` | $last_date |"
    fi
done
echo ""
echo "---"
echo ""

# Dirty repos
echo "## Dirty Repositories"
echo ""
echo "| Workspace | Branch | Product |"
echo "|-----------|--------|---------|"
echo "$ALL" | grep "^OK|" | while IFS='|' read -r status product ws_name branch hm hd rn ld drt sync lm rt ru; do
    if [ "$drt" = "dirty" ]; then
        short=$(echo "$ws_name" | sed 's/^strokmatic\.//')
        echo "| $short | \`$branch\` | $product |"
    fi
done
echo ""
echo "---"
echo ""

# Sync issues
echo "## Sync Issues (Ahead/Behind Remote)"
echo ""
echo "| Workspace | Branch | Sync Status |"
echo "|-----------|--------|------------|"
echo "$ALL" | grep "^OK|" | while IFS='|' read -r status product ws_name branch hm hd rn ld drt sync lm rt ru; do
    if [ "$sync" != "✓" ] && [ "$sync" != "—" ]; then
        short=$(echo "$ws_name" | sed 's/^strokmatic\.//')
        echo "| $short | \`$branch\` | $sync |"
    fi
done
echo ""
echo "---"
echo ""

# GSR repos
echo "## Google Source Repositories (GSR) — Remaining"
echo ""
echo "| Workspace | Branch | Remote URL |"
echo "|-----------|--------|-----------|"
echo "$ALL" | grep "^OK|" | while IFS='|' read -r status product ws_name branch hm hd rn ld drt sync lm rtype rurl; do
    if [ "$rtype" = "GSR" ]; then
        short=$(echo "$ws_name" | sed 's/^strokmatic\.//')
        echo "| $short | \`$branch\` | $rurl |"
    fi
done
echo ""
echo "---"
echo ""

# No develop branch
echo "## Repos Without Develop Branch"
echo ""
echo "$ALL" | grep "^OK|" | while IFS='|' read -r status product ws_name branch has_master has_develop rn ld drt sync lm rt ru; do
    if [ "$has_develop" = "—" ]; then
        short=$(echo "$ws_name" | sed 's/^strokmatic\.//')
        echo "- $short ($product)"
    fi
done
echo ""
echo "---"
echo ""
echo "*Report generated on $DATE by JARVIS workspace-git-analysis*"

} > "$OUTPUT"

echo "Report written to $OUTPUT"
echo "  Workspaces: $TOTAL | Existing: $EXISTING | Dirty: $DIRTY | Feature branches: $ON_FEATURE | GSR: $GSR_COUNT"
