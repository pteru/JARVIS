# Strokmatic Product Backlogs

Source of truth for product task tracking. Items here mirror ClickUp (primary system) and are synced to product monorepos via backlog-manager MCP.

## Task Backlogs (Summary)

| Product | File | Pending | High Priority |
|---------|------|---------|---------------|
| DieMaster | [diemaster.md](diemaster.md) | 21 | FEAT-04 (inference), SEC-01 (credentials) |
| SpotFusion | [spotfusion.md](spotfusion.md) | 19 | SEC-01 (credentials), OPT-01 (repo cleanup) |
| VisionKing | [visionking.md](visionking.md) | 40 | SEALER-* suite, SEC-01 (credentials) |
| SDK | [sdk.md](sdk.md) | 12 | FEAT-01 (EIP connector), sdk-reorganization |
| General | [general.md](general.md) | 1 | CICD-01 (Cloud Build links) |

## Strategic Documents

- [roadmap.md](roadmap.md) — Strokmatic 2026 Gantt (H1-H3)
- [workflow.md](workflow.md) — Integrated ClickUp + GitHub + Drive workflow plan

## Detailed Plans (per feature)

### DieMaster
| Plan | Status |
|------|--------|
| [diemaster-plans.md](plans/diemaster-plans.md) | Deep-dive implementation specs |
| [diemaster-inference-spec.md](plans/diemaster-inference-spec.md) | FEAT-04: async ML inference worker |
| [diemaster-drawin-prediction.md](plans/diemaster-drawin-prediction.md) | Draw-in prediction algorithm research |
| [diemaster-p7-downstream.md](plans/diemaster-p7-downstream.md) | P7 downstream services integration |
| [diemaster-pr25-remediation.md](plans/diemaster-pr25-remediation.md) | PR #25/#37 review remediation |
| [diemaster-relatorio-visualizacao.md](plans/diemaster-relatorio-visualizacao.md) | Frontend visualization report |

### SpotFusion
| Plan | Status |
|------|--------|
| [spotfusion-plans.md](plans/spotfusion-plans.md) | Deep-dive implementation specs |

### VisionKing
| Plan | Status |
|------|--------|
| [visionking-plans.md](plans/visionking-plans.md) | Deep-dive implementation specs |
| [visionking-display-01.md](plans/visionking-display-01.md) | DISPLAY-01: Android TV kiosk app |
| [visionking-pipeline-v2.md](../../docs/superpowers/specs/2026-03-21-stroke-based-processing-pipeline-v2-design.md) | Stroke-based processing pipeline v2 |
| [visionking-healthchecks.md](../../docs/superpowers/specs/2026-03-23-vk-docker-healthchecks-design.md) | Docker healthchecks design |
| [visionking-data-pipeline-fixes.md](../../docs/superpowers/specs/2026-03-24-data-pipeline-debug-fixes-design.md) | Data pipeline debug/fixes |
| [visionking-sparktest-profile.md](../../docs/plans/2026-03-04-sparktest-deployment-profile-design.md) | SparkTest deployment profile |

### SDK
| Plan | Status |
|------|--------|
| [sdk-plans.md](plans/sdk-plans.md) | SDK consolidation implementation |
| [sdk-tool-08-weld-grouping.md](plans/sdk-tool-08-weld-grouping.md) | TOOL-08: Weld grouping optimizer (DONE) |

### Cross-Product
| Plan | Status |
|------|--------|
| [general-cicd.md](plans/general-cicd.md) | CICD-01: Cloud Build link updates |
| [general-cloudbuild.md](plans/general-cloudbuild.md) | Cloud Build standardization across products |

## Sync

- **ClickUp → here:** Manual (run `scripts/sync-clickup-to-backlogs.sh` when needed)
- **Here → monorepos:** Automatic via `backlog-manager` MCP `sync_backlog` tool (baseline tracking)
