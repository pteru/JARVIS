---
type: Implementation Plan
title: KB Auto-Update (Phase 2) Implementation Plan
description: Map workspace path prefixes to KB page paths. When a git merge touches files under a prefix, the corresponding KB page is flagged.
timestamp: 2026-04-03
---

# KB Auto-Update (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the knowledge base automatically updated as code changes and JARVIS tasks complete.

**Architecture:** Three feeds write to the KB repo: (1) a daily cron job detects git merges and flags stale pages, (2) a post-dispatch hook logs task completions to `kb-updates.json`, (3) a weekly staleness report surfaces pages that need attention. All feeds use `gh` CLI to open PRs on the KB repo with suggested updates.

**Tech Stack:** Bash (cron scripts), Node.js (helpers), `claude --print` (content generation), `gh` CLI (PR creation), jq (JSON manipulation)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `scripts/kb-update/feed-git-monitor.sh` | Feed 1: daily cron — detect merges, map to KB pages, flag stale |
| `scripts/kb-update/feed-dispatch-hook.sh` | Feed 2: post-dispatch hook — log task completion to kb-updates.json |
| `scripts/kb-update/staleness-report.sh` | Weekly cron — generate staleness report, notify via Telegram |
| `scripts/kb-update/lib/page-mapper.sh` | Maps git paths to KB pages (e.g., `services/inference/` → `produtos/visionking/servicos/inference.md`) |
| `scripts/kb-update/lib/config.sh` | KB-specific config (repo path, thresholds, page map) |
| `config/orchestrator/kb-page-map.json` | Mapping: workspace paths → KB page paths |
| `config/orchestrator/kb-staleness.json` | Staleness thresholds per page type |
| `workspaces/strokmatic/knowledge-base/kb-updates.json` | Dedup log: which pages were updated, by which feed, at which commit SHA |

---

### Task 1: KB Config and Page Mapper

**Files:**
- Create: `scripts/kb-update/lib/config.sh`
- Create: `config/orchestrator/kb-page-map.json`
- Create: `config/orchestrator/kb-staleness.json`

- [ ] **Step 1: Create KB config loader**

```bash
# scripts/kb-update/lib/config.sh
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../lib/config.sh"

KB_REPO_PATH="${ORCHESTRATOR_HOME}/workspaces/strokmatic/knowledge-base"
KB_REMOTE="origin"
KB_BRANCH="master"
KB_UPDATES_FILE="${KB_REPO_PATH}/kb-updates.json"
KB_PAGE_MAP="${ORCHESTRATOR_HOME}/config/orchestrator/kb-page-map.json"
KB_STALENESS="${ORCHESTRATOR_HOME}/config/orchestrator/kb-staleness.json"
KB_LOG="${ORCHESTRATOR_HOME}/logs/cron-kb-update.log"
```

- [ ] **Step 2: Create page mapping config**

Map workspace path prefixes to KB page paths. When a git merge touches files under a prefix, the corresponding KB page is flagged.

```json
// config/orchestrator/kb-page-map.json
{
  "mappings": [
    { "workspace": "strokmatic.visionking", "path_prefix": "services/inference", "kb_page": "produtos/visionking/servicos/inference.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "services/camera-acquisition", "kb_page": "produtos/visionking/servicos/camera-acquisition.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "services/image-saver", "kb_page": "produtos/visionking/servicos/image-saver.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "services/database-writer", "kb_page": "produtos/visionking/servicos/database-writer.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "services/plc-monitor", "kb_page": "produtos/visionking/servicos/plc-monitor.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "services/pixel-to-object", "kb_page": "produtos/visionking/servicos/pixel-to-object.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "services/defect-aggregator", "kb_page": "produtos/visionking/servicos/defect-aggregator.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "services/result", "kb_page": "produtos/visionking/servicos/result.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "services/backend", "kb_page": "produtos/visionking/servicos/backend.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "services/frontend", "kb_page": "produtos/visionking/servicos/frontend.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "topologies/", "kb_page": "produtos/visionking/arquitetura.md" },
    { "workspace": "strokmatic.visionking", "path_prefix": "docker-compose", "kb_page": "produtos/visionking/arquitetura.md" },
    { "workspace": "strokmatic.diemaster.services.backend", "path_prefix": "src/", "kb_page": "produtos/diemaster/servicos/backend.md" },
    { "workspace": "strokmatic.diemaster", "path_prefix": "services/get-data", "kb_page": "produtos/diemaster/servicos/get-data.md" },
    { "workspace": "strokmatic.diemaster", "path_prefix": "services/data-processing", "kb_page": "produtos/diemaster/servicos/data-processing.md" },
    { "workspace": "strokmatic.diemaster", "path_prefix": "services/database-writer", "kb_page": "produtos/diemaster/servicos/database-writer.md" },
    { "workspace": "strokmatic.diemaster", "path_prefix": "services/inference", "kb_page": "produtos/diemaster/servicos/inference.md" },
    { "workspace": "strokmatic.diemaster", "path_prefix": "services/firmware", "kb_page": "produtos/diemaster/firmware/" },
    { "workspace": "strokmatic.spotfusion", "path_prefix": "services/backend", "kb_page": "produtos/spotfusion/servicos/backend.md" },
    { "workspace": "strokmatic.spotfusion", "path_prefix": "services/inference", "kb_page": "produtos/spotfusion/servicos/inference.md" },
    { "workspace": "strokmatic.spotfusion", "path_prefix": "services/camera-acquisition", "kb_page": "produtos/spotfusion/servicos/camera-acquisition.md" },
    { "workspace": "strokmatic.spotfusion", "path_prefix": "services/database-writer", "kb_page": "produtos/spotfusion/servicos/database-writer.md" },
    { "workspace": "strokmatic.spotfusion", "path_prefix": "services/default-module", "kb_page": "produtos/spotfusion/servicos/default-module.md" }
  ],
  "_comment": "Add more mappings as KB grows. Unmapped paths trigger a generic staleness flag on the product arquitetura.md page."
}
```

- [ ] **Step 3: Create staleness thresholds config**

```json
// config/orchestrator/kb-staleness.json
{
  "thresholds_days": {
    "servicos": 14,
    "arquitetura": 30,
    "deploys": 60,
    "operacoes": 30,
    "pmo": 7,
    "referencias": 90,
    "decisoes": 9999,
    "default": 30
  }
}
```

- [ ] **Step 4: Initialize kb-updates.json in KB repo**

```json
// workspaces/strokmatic/knowledge-base/kb-updates.json
{
  "last_run": null,
  "updates": []
}
```

- [ ] **Step 5: Commit config files**

```bash
git add scripts/kb-update/lib/config.sh config/orchestrator/kb-page-map.json config/orchestrator/kb-staleness.json
git commit -m "feat(kb): add auto-update config and page mapper"
```

---

### Task 2: Feed 1 — Git Activity Monitor

**Files:**
- Create: `scripts/kb-update/feed-git-monitor.sh`
- Create: `scripts/kb-update/lib/page-mapper.sh`

- [ ] **Step 1: Create the page mapper library**

```bash
# scripts/kb-update/lib/page-mapper.sh
#!/usr/bin/env bash
# Given a workspace key and a list of changed files, returns KB pages that need updating.
# Usage: get_affected_kb_pages <workspace_key> <changed_files_newline_separated>

get_affected_kb_pages() {
  local workspace_key="$1"
  local changed_files="$2"
  local page_map="${KB_PAGE_MAP}"
  local affected_pages=""

  # Read mappings for this workspace
  local mappings
  mappings=$(jq -r --arg ws "$workspace_key" \
    '.mappings[] | select(.workspace == $ws or (.workspace | startswith($ws))) | "\(.path_prefix)\t\(.kb_page)"' \
    "$page_map" 2>/dev/null)

  while IFS=$'\t' read -r prefix kb_page; do
    if echo "$changed_files" | grep -q "^${prefix}"; then
      affected_pages="${affected_pages}${kb_page}"$'\n'
    fi
  done <<< "$mappings"

  # Deduplicate
  echo "$affected_pages" | sort -u | grep -v '^$'
}
```

- [ ] **Step 2: Create the git monitor script**

```bash
# scripts/kb-update/feed-git-monitor.sh
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/page-mapper.sh"

echo "[$(date -Iseconds)] Feed 1: Git activity monitor starting" >> "$KB_LOG"

WORKSPACES_JSON="${ORCHESTRATOR_HOME}/config/orchestrator/workspaces.json"
STALE_PAGES=""

# Get last run timestamp from kb-updates.json
LAST_RUN=$(jq -r '.last_run // "1970-01-01T00:00:00Z"' "$KB_UPDATES_FILE" 2>/dev/null || echo "1970-01-01T00:00:00Z")

# Check each workspace for recent merges to master/main
jq -r '.workspaces | to_entries[] | select(.value.remotes.origin != null) | "\(.key)\t\(.value.path)"' "$WORKSPACES_JSON" | \
while IFS=$'\t' read -r ws_key ws_path; do
  [ -d "$ws_path/.git" ] || continue

  # Find commits merged since last run
  RECENT_COMMITS=$(git -C "$ws_path" log --since="$LAST_RUN" --oneline --format="%H" origin/master 2>/dev/null || true)
  [ -z "$RECENT_COMMITS" ] && continue

  # Get changed files across all recent commits
  CHANGED_FILES=$(git -C "$ws_path" diff --name-only "$(git -C "$ws_path" log --since="$LAST_RUN" --format="%H" origin/master | tail -1)..origin/master" 2>/dev/null || true)
  [ -z "$CHANGED_FILES" ] && continue

  # Check if already covered by Feed 2 (dispatch hook)
  LATEST_SHA=$(echo "$RECENT_COMMITS" | head -1)
  ALREADY_COVERED=$(jq -r --arg sha "$LATEST_SHA" '.updates[] | select(.commit_sha == $sha) | .commit_sha' "$KB_UPDATES_FILE" 2>/dev/null || true)
  [ -n "$ALREADY_COVERED" ] && continue

  # Map changed files to KB pages
  AFFECTED=$(get_affected_kb_pages "$ws_key" "$CHANGED_FILES")
  if [ -n "$AFFECTED" ]; then
    while IFS= read -r page; do
      STALE_PAGES="${STALE_PAGES}${page}|${ws_key}|${LATEST_SHA}"$'\n'
    done <<< "$AFFECTED"
  fi
done

# Update last_run timestamp
jq --arg ts "$(date -Iseconds)" '.last_run = $ts' "$KB_UPDATES_FILE" > "${KB_UPDATES_FILE}.tmp" && mv "${KB_UPDATES_FILE}.tmp" "$KB_UPDATES_FILE"

if [ -n "$STALE_PAGES" ]; then
  PAGE_COUNT=$(echo "$STALE_PAGES" | grep -c '.' || true)
  echo "[$(date -Iseconds)] Feed 1: Found $PAGE_COUNT potentially stale KB pages" >> "$KB_LOG"

  # Log affected pages
  echo "$STALE_PAGES" | while IFS='|' read -r page ws sha; do
    [ -z "$page" ] && continue
    echo "  - $page (workspace: $ws, commit: ${sha:0:7})" >> "$KB_LOG"

    # Record in kb-updates.json
    jq --arg page "$page" --arg ws "$ws" --arg sha "$sha" --arg ts "$(date -Iseconds)" \
      '.updates += [{"page": $page, "workspace": $ws, "commit_sha": $sha, "feed": "git-monitor", "timestamp": $ts, "status": "pending"}]' \
      "$KB_UPDATES_FILE" > "${KB_UPDATES_FILE}.tmp" && mv "${KB_UPDATES_FILE}.tmp" "$KB_UPDATES_FILE"
  done
else
  echo "[$(date -Iseconds)] Feed 1: No stale pages detected" >> "$KB_LOG"
fi
```

- [ ] **Step 3: Make executable and test**

```bash
chmod +x scripts/kb-update/feed-git-monitor.sh scripts/kb-update/lib/page-mapper.sh
# Dry run
bash scripts/kb-update/feed-git-monitor.sh
cat logs/cron-kb-update.log
```

- [ ] **Step 4: Commit**

```bash
git add scripts/kb-update/
git commit -m "feat(kb): add Feed 1 — git activity monitor"
```

---

### Task 3: Feed 2 — Post-Dispatch Hook

**Files:**
- Create: `scripts/kb-update/feed-dispatch-hook.sh`

- [ ] **Step 1: Create the dispatch hook**

```bash
# scripts/kb-update/feed-dispatch-hook.sh
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"
source "${SCRIPT_DIR}/lib/page-mapper.sh"

# Read dispatch metadata from hook input (stdin or args)
WORKSPACE="${1:-unknown}"
TASK_STATUS="${2:-unknown}"
TASK_ID="${3:-unknown}"

# Only process completed tasks
[ "$TASK_STATUS" != "complete" ] && exit 0

echo "[$(date -Iseconds)] Feed 2: Dispatch complete for $WORKSPACE (task: $TASK_ID)" >> "$KB_LOG"

# Get workspace path
WS_PATH=$(jq -r --arg ws "$WORKSPACE" '.workspaces[$ws].path // empty' "${ORCHESTRATOR_HOME}/config/orchestrator/workspaces.json" 2>/dev/null)
[ -z "$WS_PATH" ] && exit 0
[ -d "$WS_PATH/.git" ] || exit 0

# Get latest commit SHA
LATEST_SHA=$(git -C "$WS_PATH" rev-parse HEAD 2>/dev/null || echo "unknown")

# Get files changed in last commit
CHANGED_FILES=$(git -C "$WS_PATH" diff --name-only HEAD~1..HEAD 2>/dev/null || true)
[ -z "$CHANGED_FILES" ] && exit 0

# Map to KB pages
AFFECTED=$(get_affected_kb_pages "$WORKSPACE" "$CHANGED_FILES")
if [ -n "$AFFECTED" ]; then
  while IFS= read -r page; do
    [ -z "$page" ] && continue
    echo "  - KB page affected: $page" >> "$KB_LOG"

    # Record in kb-updates.json (Feed 2 has priority over Feed 1)
    jq --arg page "$page" --arg ws "$WORKSPACE" --arg sha "$LATEST_SHA" --arg ts "$(date -Iseconds)" --arg tid "$TASK_ID" \
      '.updates += [{"page": $page, "workspace": $ws, "commit_sha": $sha, "feed": "dispatch-hook", "task_id": $tid, "timestamp": $ts, "status": "pending"}]' \
      "$KB_UPDATES_FILE" > "${KB_UPDATES_FILE}.tmp" && mv "${KB_UPDATES_FILE}.tmp" "$KB_UPDATES_FILE"
  done <<< "$AFFECTED"
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/kb-update/feed-dispatch-hook.sh
```

- [ ] **Step 3: Register hook in settings.local.json**

Add `KBAutoUpdater` to the post-task-dispatch hooks. Read current settings, add the hook entry.

- [ ] **Step 4: Commit**

```bash
git add scripts/kb-update/feed-dispatch-hook.sh
git commit -m "feat(kb): add Feed 2 — post-dispatch hook"
```

---

### Task 4: Weekly Staleness Report

**Files:**
- Create: `scripts/kb-update/staleness-report.sh`

- [ ] **Step 1: Create staleness report script**

```bash
# scripts/kb-update/staleness-report.sh
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/config.sh"

echo "[$(date -Iseconds)] Staleness report starting" >> "$KB_LOG"

REPORT_FILE="${ORCHESTRATOR_HOME}/reports/kb-staleness-$(date +%Y-%m-%d).md"
STALE_COUNT=0
NOW_EPOCH=$(date +%s)

cat > "$REPORT_FILE" << 'HEADER'
# Relatorio de Obsolescencia — KB

> Gerado automaticamente pelo JARVIS

## Paginas Potencialmente Desatualizadas

| Pagina | Ultima Atualizacao | Limiar (dias) | Gap (dias) | Status |
|--------|-------------------|---------------|------------|--------|
HEADER

# Scan all KB pages
find "$KB_REPO_PATH" -name "*.md" -not -path "*/.git/*" -not -name "kb-updates.json" | sort | while read -r page; do
  REL_PATH="${page#$KB_REPO_PATH/}"

  # Determine page type for threshold
  PAGE_TYPE="default"
  case "$REL_PATH" in
    */servicos/*) PAGE_TYPE="servicos" ;;
    */arquitetura*) PAGE_TYPE="arquitetura" ;;
    */deploys/*) PAGE_TYPE="deploys" ;;
    operacoes/*) PAGE_TYPE="operacoes" ;;
    pmo/*) PAGE_TYPE="pmo" ;;
    referencias/*) PAGE_TYPE="referencias" ;;
    decisoes/*) PAGE_TYPE="decisoes" ;;
  esac

  THRESHOLD=$(jq -r --arg type "$PAGE_TYPE" '.thresholds_days[$type] // .thresholds_days.default' "$KB_STALENESS" 2>/dev/null || echo 30)

  # Get page last modified date from git
  PAGE_DATE=$(git -C "$KB_REPO_PATH" log -1 --format="%aI" -- "$REL_PATH" 2>/dev/null || echo "")
  [ -z "$PAGE_DATE" ] && continue

  PAGE_EPOCH=$(date -d "$PAGE_DATE" +%s 2>/dev/null || continue)
  GAP_DAYS=$(( (NOW_EPOCH - PAGE_EPOCH) / 86400 ))

  if [ "$GAP_DAYS" -gt "$THRESHOLD" ]; then
    STATUS="⚠️ DESATUALIZADA"
    STALE_COUNT=$((STALE_COUNT + 1))
  else
    continue  # Only show stale pages
  fi

  SHORT_DATE=$(date -d "$PAGE_DATE" +%Y-%m-%d)
  echo "| \`$REL_PATH\` | $SHORT_DATE | $THRESHOLD | $GAP_DAYS | $STATUS |" >> "$REPORT_FILE"
done

# Add pending updates section
PENDING=$(jq -r '.updates[] | select(.status == "pending") | "\(.page) (\(.feed), \(.timestamp[:10]))"' "$KB_UPDATES_FILE" 2>/dev/null || true)
if [ -n "$PENDING" ]; then
  echo "" >> "$REPORT_FILE"
  echo "## Atualizacoes Pendentes (detectadas mas nao aplicadas)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "$PENDING" | while read -r line; do
    echo "- $line" >> "$REPORT_FILE"
  done
fi

echo "" >> "$REPORT_FILE"
echo "---" >> "$REPORT_FILE"
echo "*Gerado em $(date -Iseconds) por JARVIS*" >> "$REPORT_FILE"

echo "[$(date -Iseconds)] Staleness report: $STALE_COUNT stale pages found → $REPORT_FILE" >> "$KB_LOG"
```

- [ ] **Step 2: Make executable and test**

```bash
chmod +x scripts/kb-update/staleness-report.sh
bash scripts/kb-update/staleness-report.sh
cat reports/kb-staleness-$(date +%Y-%m-%d).md
```

- [ ] **Step 3: Commit**

```bash
git add scripts/kb-update/staleness-report.sh
git commit -m "feat(kb): add weekly staleness report"
```

---

### Task 5: Register Cron Jobs

**Files:**
- Modify: `config/cron/orchestrator.cron`

- [ ] **Step 1: Add KB cron entries**

Add to `config/cron/orchestrator.cron`:
```cron
# KB Auto-Update
0 8 * * * cd $HOME/JARVIS && bash scripts/kb-update/feed-git-monitor.sh >> logs/cron-kb-update.log 2>&1
0 22 * * 5 cd $HOME/JARVIS && bash scripts/kb-update/staleness-report.sh >> logs/cron-kb-update.log 2>&1
```

- Feed 1 (git monitor): Daily at 8:00 AM (after fetch-remotes at 7:30)
- Staleness report: Friday at 10:00 PM

- [ ] **Step 2: Install crontab**

```bash
crontab config/cron/orchestrator.cron
crontab -l  # verify
```

- [ ] **Step 3: Commit**

```bash
git add config/cron/orchestrator.cron
git commit -m "feat(kb): register auto-update cron jobs"
```
