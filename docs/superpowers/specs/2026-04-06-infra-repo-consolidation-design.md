---
type: Design Spec
title: Design: `strokmatic/infra` Standalone Repository
description: Transform `workspaces/strokmatic/infra/` from a JARVIS sub-checkout into a standalone `strokmatic/infra` GitHub repository. Consolidate all on-premise infrastructure assets — equipment documentatio...
timestamp: 2026-04-06
---

# Design: `strokmatic/infra` Standalone Repository

**Date:** 2026-04-06
**Status:** Approved
**Author:** JARVIS + Pedro

## Summary

Transform `workspaces/strokmatic/infra/` from a JARVIS sub-checkout into a standalone `strokmatic/infra` GitHub repository. Consolidate all on-premise infrastructure assets — equipment documentation, deployed services, dashboards, and deploy scripts — into a single repo that serves as the source of truth for everything running on `192.168.15.2`.

## Motivation

Currently the infra workspace points to `pteru/JARVIS.git` (the parent repo), the PR review dashboard lives separately at `tools/pr-review-dashboard/`, and deploy scripts are scattered in `scripts/`. This makes it unclear what belongs to the infrastructure server vs. the orchestrator. A dedicated repo gives the infra stack its own identity, versioning, and deploy lifecycle.

## Scope

### In scope
- Convert `workspaces/strokmatic/infra/` to a standalone git repo
- Move `tools/pr-review-dashboard/` into `services/pr-review/dashboard/`
- Move `scripts/deploy-pr-review.sh` into `services/pr-review/deploy.sh`
- Move `scripts/deploy-context-refresh.sh` into `services/context-refresh/deploy.sh`
- Update deploy script paths to work from the new repo root
- Add `.gitignore` and `README.md`
- Update `context.md` to reflect the expanded scope
- Register the new repo in JARVIS `workspaces.json`
- Delete moved files from JARVIS

### Out of scope
- Changing anything on the remote server (`192.168.15.2`)
- Modifying cron jobs, container names, or ports
- Moving other JARVIS tools or scripts
- Creating the GitHub remote (user will do this manually)

## Final Directory Structure

```
strokmatic/infra/
├── .claude/
│   └── context.md                 # Updated repo description
├── .gitignore
├── README.md
├── equipment/
│   └── Bosch PSI7000/             # Unchanged
│       ├── 011F000C01300200_EIP_PRC7xxx_0105/
│       ├── BoschRexroth_PRC7xxx_0105_EtherCAT.xml
│       ├── SETUP-GUIDE-EtherNetIP-CompactLogix.md
│       └── TypeSpecificManual/
├── services/
│   ├── pr-review/
│   │   ├── dashboard/             # ← from tools/pr-review-dashboard/
│   │   │   ├── backend/
│   │   │   │   ├── app/
│   │   │   │   │   ├── __init__.py
│   │   │   │   │   ├── config.py
│   │   │   │   │   ├── drive_client.py
│   │   │   │   │   ├── main.py
│   │   │   │   │   ├── parsers.py
│   │   │   │   │   ├── routers/
│   │   │   │   │   └── schemas.py
│   │   │   │   ├── __init__.py
│   │   │   │   └── requirements.txt
│   │   │   ├── frontend/
│   │   │   │   ├── index.html
│   │   │   │   ├── package.json
│   │   │   │   ├── src/
│   │   │   │   └── vite.config.js
│   │   │   ├── .dockerignore
│   │   │   ├── .gitignore
│   │   │   ├── docker-compose.yml
│   │   │   ├── Dockerfile
│   │   │   └── nginx.conf
│   │   ├── .claude/
│   │   ├── config/
│   │   ├── lib/
│   │   ├── scripts/
│   │   ├── archive-reviews.sh
│   │   ├── build-check.sh
│   │   ├── build-inbox.mjs
│   │   ├── clean-review.sh
│   │   ├── deploy.sh              # ← from scripts/deploy-pr-review.sh
│   │   ├── fetch-open-prs.sh
│   │   ├── label-prs.sh
│   │   ├── model-selector.sh
│   │   ├── notify-chat.mjs
│   │   ├── notify.sh
│   │   ├── package.json
│   │   ├── post-review.sh
│   │   ├── review-pr.sh
│   │   ├── run.sh
│   │   └── upload-to-drive.mjs
│   └── context-refresh/
│       ├── dashboard/              # Already in place
│       │   ├── app.py
│       │   ├── docker-compose.yml
│       │   ├── Dockerfile
│       │   └── requirements.txt
│       ├── .claude/
│       ├── config/
│       ├── lib/
│       ├── collect.sh
│       ├── deploy.sh              # ← from scripts/deploy-context-refresh.sh
│       ├── generate-report.sh
│       ├── notify.sh
│       ├── package.json
│       ├── run.sh
│       └── upload-to-drive.mjs
```

## File Movements

| Source (JARVIS)                          | Destination (infra repo)              | Action in JARVIS |
|------------------------------------------|---------------------------------------|------------------|
| `tools/pr-review-dashboard/*`            | `services/pr-review/dashboard/`       | Delete directory  |
| `scripts/deploy-pr-review.sh`            | `services/pr-review/deploy.sh`        | Delete file       |
| `scripts/deploy-context-refresh.sh`      | `services/context-refresh/deploy.sh`  | Delete file       |

## Deploy Script Changes

Both deploy scripts (`deploy.sh`) need path updates since they'll now run from within the infra repo instead of from `$ORCHESTRATOR_HOME/scripts/`.

### `services/pr-review/deploy.sh`

**Before:**
```bash
SERVICE_SRC="$ORCHESTRATOR_HOME/workspaces/strokmatic/infra/services/pr-review"
# ...
DASHBOARD_SRC="$ORCHESTRATOR_HOME/tools/pr-review-dashboard"
```

**After:**
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="$SCRIPT_DIR"
# ...
DASHBOARD_SRC="$SCRIPT_DIR/dashboard"
```

The dashboard deploy step (step 10) already rsync's from `$DASHBOARD_SRC/` to the remote — only the source path changes. Remote paths (`/opt/jarvis-pr-review/`, `/opt/jarvis-pr-review-dashboard/`) remain unchanged.

### `services/context-refresh/deploy.sh`

Same pattern — `SERVICE_SRC` becomes relative to the script's own directory.

## JARVIS Updates

### `config/orchestrator/workspaces.json`

Add new entry for the infra repo:
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

### References to update

Any JARVIS code that references the moved paths:
- `scripts/review-pr.sh` — if it references the deploy script
- `scripts/helpers/` — if any helper references `tools/pr-review-dashboard/`
- Cron entries on the JARVIS host (`.84`) — unlikely, since cron runs on `.2`

## .gitignore

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

## Git Setup Sequence

1. Remove existing `.git/` in `workspaces/strokmatic/infra/` (currently points to JARVIS repo)
2. Move files into place (dashboard, deploy scripts)
3. Create `.gitignore` and `README.md`
4. `git init` + `git add .` + initial commit on `master`
5. User creates `strokmatic/infra` on GitHub (private)
6. `git remote add origin git@github.com:strokmatic/infra.git`
7. `git push -u origin master`

## What Does NOT Change

- Remote deployment targets: `/opt/jarvis-pr-review/`, `/opt/jarvis-context-refresh/`, `/opt/jarvis-pr-review-dashboard/`
- Cron jobs on `192.168.15.2` (still point to `/opt/` paths)
- Container names: `jarvis-pr-review-dashboard` (port 8091), `jarvis-context-dashboard` (port 8092)
- Service behavior, dependencies, or configuration
- Equipment documentation content

## Risks

- **Dangling references in JARVIS**: After deleting `tools/pr-review-dashboard/` and the deploy scripts, any JARVIS code that imports or references them will break. Mitigated by grepping for all references before deletion.
- **`.git` removal**: The current `.git` in `infra/` is a JARVIS checkout. Removing it is safe since all history lives in the JARVIS repo. The infra repo starts with a clean initial commit.
