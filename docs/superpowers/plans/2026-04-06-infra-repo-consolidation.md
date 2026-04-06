# Infra Repo Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform `workspaces/strokmatic/infra/` into a standalone `strokmatic/infra` GitHub repo with all services, dashboards, and deploy scripts consolidated.

**Architecture:** Remove the JARVIS `.git` from the infra directory, move the pr-review dashboard and both deploy scripts into it, initialize a fresh git repo, and clean up JARVIS.

**Tech Stack:** Git, Bash, shell scripts, Node.js (services), Python/FastAPI + Vue 3 (dashboard)

**Spec:** `docs/superpowers/specs/2026-04-06-infra-repo-consolidation-design.md`

---

### Task 1: Remove JARVIS `.git` from infra directory

**Files:**
- Modify: `workspaces/strokmatic/infra/.git` (remove)

This directory currently contains a `.git` pointing to `pteru/JARVIS.git`. It must be removed before we can `git init` a new repo.

- [ ] **Step 1: Verify the `.git` is a JARVIS checkout**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git remote -v
# Expected: origin  git@github.com:pteru/JARVIS.git
```

- [ ] **Step 2: Remove the `.git` directory**

```bash
rm -rf /home/teruel/JARVIS/workspaces/strokmatic/infra/.git
```

- [ ] **Step 3: Verify no `.git` remains**

```bash
ls -la /home/teruel/JARVIS/workspaces/strokmatic/infra/.git 2>&1
# Expected: No such file or directory
```

---

### Task 2: Move pr-review dashboard into infra

**Files:**
- Source: `tools/pr-review-dashboard/` (entire directory)
- Destination: `workspaces/strokmatic/infra/services/pr-review/dashboard/`

- [ ] **Step 1: Verify source exists and destination does not**

```bash
ls /home/teruel/JARVIS/tools/pr-review-dashboard/Dockerfile
# Expected: file exists

ls /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review/dashboard/ 2>&1
# Expected: No such file or directory
```

- [ ] **Step 2: Copy the dashboard into the service directory**

Use `cp -r` (not `mv`) so we can verify before deleting the original.

```bash
cp -r /home/teruel/JARVIS/tools/pr-review-dashboard/ \
      /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review/dashboard/
```

- [ ] **Step 3: Verify the copy is complete**

```bash
diff <(cd /home/teruel/JARVIS/tools/pr-review-dashboard && find . -type f -not -path './node_modules/*' -not -path './.venv/*' -not -path './__pycache__/*' -not -path './frontend/node_modules/*' -not -path './static/*' | sort) \
     <(cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review/dashboard && find . -type f -not -path './node_modules/*' -not -path './.venv/*' -not -path './__pycache__/*' -not -path './frontend/node_modules/*' -not -path './static/*' | sort)
# Expected: no output (identical file lists)
```

---

### Task 3: Move deploy scripts into infra

**Files:**
- Source: `scripts/deploy-pr-review.sh` → Destination: `workspaces/strokmatic/infra/services/pr-review/deploy.sh`
- Source: `scripts/deploy-context-refresh.sh` → Destination: `workspaces/strokmatic/infra/services/context-refresh/deploy.sh`

- [ ] **Step 1: Copy both deploy scripts**

```bash
cp /home/teruel/JARVIS/scripts/deploy-pr-review.sh \
   /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review/deploy.sh

cp /home/teruel/JARVIS/scripts/deploy-context-refresh.sh \
   /home/teruel/JARVIS/workspaces/strokmatic/infra/services/context-refresh/deploy.sh
```

- [ ] **Step 2: Verify copies**

```bash
diff /home/teruel/JARVIS/scripts/deploy-pr-review.sh \
     /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review/deploy.sh
# Expected: no output

diff /home/teruel/JARVIS/scripts/deploy-context-refresh.sh \
     /home/teruel/JARVIS/workspaces/strokmatic/infra/services/context-refresh/deploy.sh
# Expected: no output
```

---

### Task 4: Update deploy script paths

Both deploy scripts use `$ORCHESTRATOR_HOME` to locate the service source and dashboard source. Since they now live inside the infra repo, paths should be relative to the script's own directory.

**Files:**
- Modify: `workspaces/strokmatic/infra/services/pr-review/deploy.sh`
- Modify: `workspaces/strokmatic/infra/services/context-refresh/deploy.sh`

- [ ] **Step 1: Update `services/pr-review/deploy.sh`**

Replace lines 27-28:
```bash
ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SERVICE_SRC="$ORCHESTRATOR_HOME/workspaces/strokmatic/infra/services/pr-review"
```

With:
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SERVICE_SRC="$SCRIPT_DIR"
```

Also replace line 247:
```bash
DASHBOARD_SRC="$ORCHESTRATOR_HOME/tools/pr-review-dashboard"
```

With:
```bash
DASHBOARD_SRC="$SCRIPT_DIR/dashboard"
```

And replace line 89 (the workspaces.json source path in the Node snippet):
```javascript
const config = JSON.parse(require('fs').readFileSync('$ORCHESTRATOR_HOME/config/orchestrator/workspaces.json', 'utf-8'));
```

Keep this line unchanged — the deploy script still reads workspaces.json from JARVIS to build a stripped config for the remote. `$ORCHESTRATOR_HOME` is still defined for this purpose.

- [ ] **Step 2: Update `services/context-refresh/deploy.sh`**

Replace lines 13-14:
```bash
ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SERVICE_SRC="$ORCHESTRATOR_HOME/workspaces/strokmatic/infra/services/context-refresh"
```

With:
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
SERVICE_SRC="$SCRIPT_DIR"
```

The context-refresh deploy script already uses `$SERVICE_SRC/dashboard` for the dashboard path (line 173), so no further changes needed there.

- [ ] **Step 3: Verify no remaining references to old paths**

```bash
grep -n "tools/pr-review-dashboard" /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review/deploy.sh
# Expected: no output

grep -n "workspaces/strokmatic/infra/services" /home/teruel/JARVIS/workspaces/strokmatic/infra/services/*/deploy.sh
# Expected: no output
```

---

### Task 5: Create `.gitignore` for infra repo

**Files:**
- Create: `workspaces/strokmatic/infra/.gitignore`

- [ ] **Step 1: Create the `.gitignore`**

```gitignore
# Runtime data (generated on remote, not committed)
services/*/data/
services/*/logs/
services/*/reviews/
services/*/reports/
services/*/credentials/
services/*/node_modules/
services/*/package-lock.json

# Dashboard build artifacts
services/*/dashboard/frontend/node_modules/
services/*/dashboard/frontend/dist/
services/*/dashboard/__pycache__/
services/*/dashboard/.venv/
services/*/dashboard/static/
```

---

### Task 6: Update `.claude/context.md`

**Files:**
- Modify: `workspaces/strokmatic/infra/.claude/context.md`

- [ ] **Step 1: Rewrite `context.md` to reflect the expanded scope**

The current context.md describes only the Bosch PSI7000 equipment docs. Update it to describe the full repo: equipment docs + services (pr-review, context-refresh) + deploy scripts + dashboards. Include the service inventory and remote deployment targets.

Key sections:
- Purpose (updated to include services)
- Contents (equipment + services)
- Services overview (pr-review pipeline + dashboard, context-refresh pipeline + dashboard)
- Remote deployment targets (`192.168.15.2`, paths, ports)
- How to deploy (`services/<name>/deploy.sh`)

---

### Task 7: Create `README.md`

**Files:**
- Create: `workspaces/strokmatic/infra/README.md`

- [ ] **Step 1: Create a concise README**

Include:
- One-line description
- Directory structure overview
- Services: what they do, deploy target, how to deploy
- Equipment: what's documented
- Prerequisites (SSH access, secrets, nvm)

---

### Task 8: Initialize git repo and make initial commit

**Files:**
- Create: `workspaces/strokmatic/infra/.git` (via `git init`)

- [ ] **Step 1: Initialize the repo**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git init
git checkout -b master
```

- [ ] **Step 2: Stage all files**

```bash
git add .
```

- [ ] **Step 3: Verify what's being committed (no secrets, no node_modules)**

```bash
git status
# Verify: no credentials/, node_modules/, data/, logs/ directories
# Verify: .gitignore is working
```

- [ ] **Step 4: Check for secrets in staged files**

```bash
git diff --cached --name-only | xargs grep -l -E '(PRIVATE KEY|password|bot_token|api_key|secret)' 2>/dev/null || echo "No secrets found"
# Expected: No secrets found (deploy scripts read from ~/.secrets, not inline)
```

- [ ] **Step 5: Create initial commit**

```bash
git commit -m "Initial commit: Strokmatic infrastructure repo

Consolidates on-premise infrastructure assets:
- equipment/: Bosch PSI7000 documentation and device files
- services/pr-review/: PR review pipeline + dashboard (port 8091)
- services/context-refresh/: Context refresh pipeline + dashboard (port 8092)

Deploy target: strokmatic@192.168.15.2
Previously spread across JARVIS tools/, scripts/, and workspaces/."
```

- [ ] **Step 6: Add remote and verify**

```bash
git remote add origin git@github.com:strokmatic/infra.git
git remote -v
# Expected: origin  git@github.com:strokmatic/infra.git (fetch/push)
```

- [ ] **Step 7: Push to remote**

```bash
git push -u origin master
```

---

### Task 9: Clean up JARVIS — delete moved files

**Files:**
- Delete: `tools/pr-review-dashboard/` (entire directory)
- Delete: `scripts/deploy-pr-review.sh`
- Delete: `scripts/deploy-context-refresh.sh`

- [ ] **Step 1: Verify the infra repo has everything before deleting**

```bash
ls /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review/dashboard/Dockerfile
ls /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review/deploy.sh
ls /home/teruel/JARVIS/workspaces/strokmatic/infra/services/context-refresh/deploy.sh
# Expected: all three exist
```

- [ ] **Step 2: Delete the originals from JARVIS**

```bash
rm -rf /home/teruel/JARVIS/tools/pr-review-dashboard/
rm /home/teruel/JARVIS/scripts/deploy-pr-review.sh
rm /home/teruel/JARVIS/scripts/deploy-context-refresh.sh
```

- [ ] **Step 3: Verify no dangling references in JARVIS scripts**

```bash
grep -r "deploy-pr-review\|deploy-context-refresh\|tools/pr-review-dashboard" \
  /home/teruel/JARVIS/scripts/ \
  /home/teruel/JARVIS/config/ \
  --include='*.sh' --include='*.json' --include='*.mjs' 2>/dev/null || echo "No dangling references"
# Expected: No dangling references
```

---

### Task 10: Register infra repo in JARVIS workspaces.json

**Files:**
- Modify: `config/orchestrator/workspaces.json`

- [ ] **Step 1: Add the `strokmatic.infra` workspace entry**

Add to the `workspaces` object:

```json
"strokmatic.infra": {
  "path": "/home/teruel/JARVIS/workspaces/strokmatic/infra",
  "type": "mixed",
  "category": "infrastructure",
  "product": "strokmatic",
  "priority": "high",
  "auto_review": true,
  "remotes": {
    "origin": "git@github.com:strokmatic/infra.git"
  }
}
```

- [ ] **Step 2: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('/home/teruel/JARVIS/config/orchestrator/workspaces.json', 'utf-8')); console.log('Valid JSON')"
# Expected: Valid JSON
```

---

### Task 11: Commit JARVIS cleanup

- [ ] **Step 1: Stage deletions and workspaces.json update**

```bash
cd /home/teruel/JARVIS
git add -u tools/pr-review-dashboard/
git add -u scripts/deploy-pr-review.sh
git add -u scripts/deploy-context-refresh.sh
git add config/orchestrator/workspaces.json
git add docs/superpowers/specs/2026-04-06-infra-repo-consolidation-design.md
git add docs/superpowers/plans/2026-04-06-infra-repo-consolidation.md
```

- [ ] **Step 2: Verify staged changes**

```bash
git diff --cached --stat
# Expected: deletions for tools/pr-review-dashboard/*, scripts/deploy-*.sh
#           modification of workspaces.json
#           addition of spec and plan docs
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: extract strokmatic/infra as standalone repo

- Move tools/pr-review-dashboard/ into infra/services/pr-review/dashboard/
- Move scripts/deploy-pr-review.sh into infra/services/pr-review/deploy.sh
- Move scripts/deploy-context-refresh.sh into infra/services/context-refresh/deploy.sh
- Register strokmatic.infra in workspaces.json
- Delete moved files from JARVIS"
```
