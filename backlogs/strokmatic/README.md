# Strokmatic Product Backlogs

> **Retired 2026-06-16 — these task lists moved to GitHub Issues.** GitHub is now the source of
> truth for product task tracking. The per-product `.md` files below are pointer stubs (kept for
> history); do not add tasks to them. Migration evidence:
> [`reports/backlog-reconciliation-2026-06-16.md`](../../reports/backlog-reconciliation-2026-06-16.md).

## Task Backlogs → GitHub Issues

| Product | Open `backlog` issues | Stub |
|---------|------------------------|------|
| DieMaster | [strokmatic/diemaster](https://github.com/strokmatic/diemaster/issues?q=is%3Aopen+label%3Abacklog) (#216–#226) | [diemaster.md](diemaster.md) |
| SpotFusion | [strokmatic/spotfusion](https://github.com/strokmatic/spotfusion/issues?q=is%3Aopen+label%3Abacklog) (#74–#84) | [spotfusion.md](spotfusion.md) |
| VisionKing | [strokmatic/visionking](https://github.com/strokmatic/visionking/issues?q=is%3Aopen+label%3Abacklog) (#93–#112) | [visionking.md](visionking.md) |
| SDK | [strokmatic/sdk](https://github.com/strokmatic/sdk/issues?q=is%3Aopen+label%3Abacklog) (epic #1) + family repos | [sdk.md](sdk.md) |
| General | [strokmatic/infra](https://github.com/strokmatic/infra/issues?q=is%3Aopen+label%3Abacklog) (#66–#69) | [general.md](general.md) |

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

> **Superseded 2026-06-16.** Task tracking now lives in GitHub Issues per repo (see table above).
> The legacy sync machinery below is inert against these retired stubs and will be removed when the
> orchestrator is rewired to read/write GitHub Issues (Phase 2).

- ~~**ClickUp → here:** Manual (`scripts/sync-clickup-to-backlogs.sh`)~~
- ~~**Here → monorepos:** Automatic via `backlog-manager` MCP `sync_backlog` tool~~
