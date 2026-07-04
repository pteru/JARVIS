# workspaces/ Disk Inventory — 2026-07-04 (C7, inventory only)

**Scope:** 157 GB `workspaces/` tree, 34 nested git clones. Nothing was pruned,
gc'd, or modified — measurements only.

## Headline numbers

- **43 regenerable env dirs (node_modules / .venv / venv): 34.9 GB** — 22% of the tree.
- **.git storage across clones: ~1.9 GB**, loose-object counts modest (worst:
  sdk-inspection-grouping-optimizer 3,986, infra 2,450, sdk-blender-tools 2,124).
  Expected `git gc` yield is small (~100–300 MB total) — low priority.
- **39 of 43 env dirs sit in repos with UNCOMMITTED CHANGES** — the workspace
  fleet is broadly dirty (see separate observation below).

## Top env dirs by size

| Size | Path | Repo last commit | Dirty? |
|---|---|---|---|
| 6.8 GB | visionking/services/inference/.venv | 2026-03-06 | dirty |
| 5.8 GB | visionking/ds/training/.venv | 2026-01-05 | dirty |
| 2.8 GB | spotfusion/legacy/new_sparkeyes_modeling/.venv | **2024-11-08** | dirty |
| 2.5 GB | visionking-sealer-provisioning/toolkit/sealer-provisioning/.venv | **ACTIVE worktree — keep** | — |
| 2.3 GB | spotfusion/services/default-module/.venv | 2026-02-16 | clean |
| 1.6 GB | pmo/projects/01001/edge-predictor/.venv | 2026-07-04 (pmo repo) | dirty |
| 1.3 GB | sdk/sdk-inspection-grouping-optimizer/.venv | 2026-04-22 | dirty |
| 1.2 GB | sdk/sdk-model-comparison/venv | not a git repo | — |

## Prune candidates (repo last commit > 60 days ago) — ~12.4 GB

| Size | Env dir | Last commit |
|---|---|---|
| 5.8 GB | visionking/ds/training/.venv | 2026-01-05 |
| 2.8 GB | spotfusion/legacy/new_sparkeyes_modeling/.venv | 2024-11-08 |
| 789 MB | visionking/legacy/cloud-pipeline/.venv | 2025-06-09 |
| 786 MB | visionking/services/pixel-to-object/.venv | 2025-12-02 |
| 580 MB | visionking/services/frontend-ds/node_modules | 2025-11-21 |
| 496 MB | sdk/sdk-redis-trendline-monitor/.venv | 2025-11-09 |
| 474 MB | sdk/sdk-label-studio-toolkit/.venv | 2025-12-08 |
| 272 MB | diemaster/services/data-processing/.venv | 2026-03-10* |
| 189 MB | sdk/sdk-bos6000-toolkit/.venv | 2025-12-03 |
| 163 MB | spotfusion/toolkit/spotfusion-toolkit/view-r-extractor/.venv | 2024-07-25 |
| 87 MB | sdk/sdk-repository-reader/.venv | 2025-10-20 |

\* borderline (~4 months). Pruning an env dir never touches tracked files or
uncommitted work — reinstall is `pip install -r requirements.txt` / `npm install`.

**Explicitly NOT prune candidates:** the active sealer-provisioning worktree
venv (2.5 GB), pmo edge-predictor (repo committed today), sdk-blender-tools
(committed today), inference .venv (recent + likely in use for 03002 work),
personal/ projects (no git history to judge by).

## Separate observation: fleet-wide dirty state

Nearly every product clone carries uncommitted changes (visionking + most of
its service repos, diemaster, pmo, most sdk-* repos). Worth a dedicated triage
session: commit/stash/discard per repo. `reports/workspace-git-analysis.md`
covers this angle.

## Deferred (not executed, per inventory-only decision)

1. Selective prune of the ~12.4 GB stale-repo env dirs.
2. `git gc` sweep (low yield).
3. `repos.txt` manifest (path + remote + branch per clone) for disaster recovery.
