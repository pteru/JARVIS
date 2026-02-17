# Workspace Git Analysis Report

**Report Date:** 2026-02-17
**Report Type:** Automated Git Status Scan
**Analysis Scope:** DieMaster, SDK, SpotFusion, VisionKing

---

## Executive Summary

Automated scan of all 97 configured workspaces. All workspace paths are under `/home/teruel/JARVIS/workspaces/strokmatic/`.

| Metric | Count |
|--------|-------|
| Total Workspaces Configured | 97 |
| Existing on Disk | 97 |
| Missing from Disk | 0 |
| Dirty (uncommitted changes) | 64 |
| On Feature/Fix Branches | 25 |
| GSR Remaining | 8 |
| Without Develop Branch | 31 |

### Per-Product Breakdown

| Product | Configured | Existing |
|---------|-----------|----------|
| diemaster | 18 | 18 |
| sdk | 13 | 13 |
| spotfusion | 36 | 36 |
| visionking | 30 | 30 |

---

## Diemaster Repositories

| Workspace | Branch | Master | Develop | Remote | Last Commit | Status | Sync |
|-----------|--------|--------|---------|--------|-------------|--------|------|
| ~monorepo~ | `chore/rename-submodules` | ✓ | ✓ | origin | 2026-02-16 | dirty | ✓ |
| ds.pamstamp-io | `master` | ✓ | — | origin | 2024-11-25 | clean | ✓ |
| firmware.firmware-hub | `feat/868fnjkzz-broadcast-udp` | ✓ | ✓ | origin | 2025-10-05 | dirty | ✓ |
| firmware.firmware-switch | `feat/868fnjkqc-broadcast-udp` | ✓ | — | origin | 2025-10-05 | dirty | ✓ |
| legacy.sim-generator | `feat--parse-simplificado` | ✓ | — | origin | 2025-04-06 | dirty | ✓ |
| legacy.smart-die | `production` | ✓ | — | origin | 2023-08-22 | dirty | ✓ |
| services.backend | `develop` | — | ✓ | origin | 2025-10-03 | dirty | ↑0↓15 |
| services.connect | `master` | ✓ | — | origin | 2025-10-21 | dirty | ✓ |
| services.database-writer | `feat--insercao-via-json` | — | ✓ | origin | 2025-04-25 | dirty | ✓ |
| services.data-processing | `master` | ✓ | — | origin | 2025-10-29 | dirty | ✓ |
| services.frontend | `master` | ✓ | — | origin | 2024-08-05 | dirty | ↑0↓1 |
| services.get-data | `master` | ✓ | — | origin | 2025-10-29 | dirty | ↑0↓2 |
| services.infra-setup | `feat-schema-completo-e-lógica-batch` | ✓ | ✓ | origin | 2025-05-07 | dirty | ✓ |
| services.loader | `master` | ✓ | — | origin | 2025-10-29 | dirty | ↑0↓2 |
| services.plc-monitor | `master` | ✓ | — | origin | 2025-10-21 | clean | ✓ |
| services.setting | `master` | ✓ | — | origin | 2025-01-09 | dirty | ↑0↓9 |
| services.status | `master` | ✓ | — | origin | 2026-02-16 | clean | ✓ |
| services.trigger | `master` | ✓ | — | origin | 2025-10-28 | clean | ✓ |

---

## Sdk Repositories

| Workspace | Branch | Master | Develop | Remote | Last Commit | Status | Sync |
|-----------|--------|--------|---------|--------|-------------|--------|------|
| 3d-model-convert-to-gltf | `master` | ✓ | — | origin | 2021-10-12 | dirty | ↑0↓2 |
| project-organizer | `chore/reference-standards` | ✓ | — |  | 2026-02-15 | dirty | — |
| sdk-agent-standards | `master` | ✓ | ✓ | origin | 2026-02-15 | dirty | ✓ |
| sdk-bos6000-toolkit | `master` | ✓ | ✓ | github | 2025-12-03 | dirty | ✓ |
| sdk-defect-visualizer | `master` | ✓ | ✓ | github | 2025-11-25 | dirty | ✓ |
| sdk-image-extractor | `master` | ✓ | ✓ | github | 2025-11-13 | dirty | ↑0↓4 |
| sdk-label-studio-toolkit | `master` | ✓ | ✓ | github | 2025-12-08 | dirty | ✓ |
| sdk-lib-rabbit-client | `master` | ✓ | ✓ | github | 2025-12-01 | dirty | ✓ |
| sdk-message-poster | `master` | ✓ | ✓ | origin | 2025-08-27 | dirty | ✓ |
| sdk-observability-stack | `feat/angular-embedding` | ✓ | ✓ | github | 2025-12-23 | dirty | ✓ |
| sdk-redis-trendline-monitor | `master` | ✓ | ✓ | github | 2025-11-09 | dirty | ✓ |
| sdk-repository-reader | `master` | ✓ | ✓ | origin | 2025-10-20 | dirty | ✓ |
| sdk-video-cronoanalysis | `master` | ✓ | ✓ | github | 2025-10-30 | dirty | ✓ |

---

## Spotfusion Repositories

| Workspace | Branch | Master | Develop | Remote | Last Commit | Status | Sync |
|-----------|--------|--------|---------|--------|-------------|--------|------|
| ~monorepo~ | `chore/rename-submodules` | ✓ | ✓ | origin | 2026-02-16 | dirty | ✓ |
| ds.dataset-toolkit | `master` | ✓ | — | google | 2024-07-30 | dirty | ✓ |
| ds.spotfusion-ds-training | `chore/unificacao-branches` | ✓ | ✓ | origin | 2025-12-29 | dirty | ↑0↓2 |
| legacy.new_sparkeyes_modeling | `feature/integrar_sistema_votacao` | ✓ | — | origin | 2024-11-08 | dirty | ✓ |
| libs.lldpd | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| libs.opener | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.backend | `develop` | ✓(main) | ✓ | origin | 2024-10-24 | dirty | — |
| services.backend-vision | `develop` | ✓ | ✓ | origin | 2024-07-01 | clean | — |
| services.camera-acquisition | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.database-cleanup | `develop` | ✓ | ✓ | origin | 2025-01-30 | clean | — |
| services.database-writer | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.data-enrichment | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.data-processing | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.default-module | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.device-controller | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.frontend | `develop` | ✓ | ✓ | origin | 2024-11-08 | clean | — |
| services.frontend-vision | `develop` | ✓ | ✓ | origin | 2024-07-02 | clean | — |
| services.get-data | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.get-image | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.get-result | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.image-processing | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.modified-setup.setup | `deploy-fz` | ✓ | — | origin | 2025-10-25 | dirty | — |
| services.module-a | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.plc-monitor-camera | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.plc-monitor-camera-opener | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.plc-monitor | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.plc-result | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.setup | `master` | ✓ | — | origin | 2025-10-25 | dirty | — |
| services.tag-monitor | `develop` | ✓ | ✓ | origin | 2026-02-16 | clean | — |
| services.tag-monitor-siemens | `develop` | ✓ | ✓ | origin | 2025-10-22 | clean | — |
| toolkit.data-scraping | `develop` | ✓ | ✓ | origin | 2023-11-15 | clean | — |
| toolkit.server-installer | `develop` | ✓ | ✓ | origin | 2024-02-28 | clean | — |
| toolkit.spotfusion-deploy-toolkit | `feat/viewer-interactive-charts` | ✓ | ✓ | github | 2026-02-16 | dirty | ✓ |
| toolkit.spotfusion-smartcam-toolkit | `master` | ✓ | ✓ | origin | 2026-02-02 | dirty | ✓ |
| toolkit.spotfusion-toolkit | `feature/single_container` | ✓ | — | origin | 2024-07-25 | dirty | ✓ |
| toolkit.vision-installer | `develop` | ✓ | ✓ | origin | 2024-03-25 | clean | — |

---

## Visionking Repositories

| Workspace | Branch | Master | Develop | Remote | Last Commit | Status | Sync |
|-----------|--------|--------|---------|--------|-------------|--------|------|
| ~monorepo~ | `chore/rename-submodules` | ✓ | ✓ | origin | 2026-02-16 | dirty | ✓ |
| ds.label-predictor.label-studio-ml-backend | `master` | ✓ | — | origin | 2025-06-13 | dirty | ↑0↓40 |
| ds.label-predictor | `master` | ✓ | ✓ | origin | 2025-06-18 | dirty | ✓ |
| ds.training | `feat/clearml-integration` | ✓ | ✓ | origin | 2026-01-05 | dirty | ✓ |
| ds.yolov11.ultralytics | `main` | ✓(main) | — | origin | 2024-10-30 | dirty | ↑0↓1788 |
| legacy.cloud-pipeline-draft | `master` | ✓ | — | origin | 2025-02-12 | dirty | ↑0↓1 |
| legacy.cloud-pipeline | `feat/ad-hoc-para-bypassar-makefile` | ✓ | ✓ | origin | 2025-06-09 | dirty | — |
| legacy.defect-aggregator | `master` | ✓ | — | origin | 2025-11-05 | dirty | ✓ |
| legacy.underbody | `master` | ✓ | ✓ | github | 2026-01-08 | dirty | ✓ |
| services.backend-ds | `develop` | ✓ | ✓ | origin | 2025-11-24 | dirty | ✓ |
| services.backend | `master` | ✓ | ✓ | origin | 2025-12-17 | dirty | ✓ |
| services.bd-sis-surface | `master` | ✓ | — | origin | 2025-01-11 | dirty | ✓ |
| services.camera-acquisition | `fix/trigger-level-high` | ✓ | ✓ | origin | 2025-12-10 | dirty | ✓ |
| services.controller | `develop` | ✓ | ✓ | origin | 2024-08-20 | dirty | ✓ |
| services.database-writer | `feat/aio-pika` | ✓ | ✓ | origin | 2026-02-15 | dirty | ✓ |
| services.frontend | `develop` | ✓ | ✓ | origin | 2026-02-09 | dirty | ✓ |
| services.frontend-ds | `develop` | ✓ | ✓ | origin | 2025-11-21 | dirty | ✓ |
| services.image-saver | `develop` | ✓ | ✓ | origin | 2025-12-02 | dirty | ✓ |
| services.inference | `feat/implementacao-aio-pika` | ✓ | ✓ | origin | 2025-06-13 | dirty | ✓ |
| services.length-measure | `master` | ✓ | ✓ | origin | 2025-08-12 | dirty | ✓ |
| services.pixel-to-object | `feat/kalman-filter` | ✓ | ✓ | origin | 2025-12-02 | dirty | ✓ |
| services.plc-monitor-eip | `master` | ✓ | — | origin | 2025-11-21 | clean | ✓ |
| services.plc-monitor | `master` | ✓ | — | origin | 2026-02-03 | dirty | ✓ |
| services.result | `develop` | ✓ | ✓ | origin | 2026-02-04 | dirty | ✓ |
| services.setup | `fix/logica-funcoes` | ✓ | ✓ | origin | 2025-12-17 | dirty | ✓ |
| services.storage-monitor | `master` | ✓ | — | origin | 2025-10-04 | dirty | ✓ |
| services.visualizer | `feat/suporte-poligonos` | ✓ | — | origin | 2025-11-07 | dirty | ✓ |
| toolkit.data-manager | `master` | ✓ | — | origin | 2025-12-08 | clean | ✓ |
| toolkit.defect-report-toolkit | `chore/reference-standards` | ✓ | ✓ | origin | 2026-02-15 | dirty | ✓ |
| toolkit.toolkit | `master` | ✓ | — | origin | 2025-10-01 | clean | ✓ |

---

## Active Feature Branches

| Workspace | Branch | Last Commit |
|-----------|--------|-------------|
| diemaster | `chore/rename-submodules` | 2026-02-16 |
| diemaster.firmware.firmware-hub | `feat/868fnjkzz-broadcast-udp` | 2025-10-05 |
| diemaster.firmware.firmware-switch | `feat/868fnjkqc-broadcast-udp` | 2025-10-05 |
| diemaster.legacy.sim-generator | `feat--parse-simplificado` | 2025-04-06 |
| diemaster.legacy.smart-die | `production` | 2023-08-22 |
| diemaster.services.database-writer | `feat--insercao-via-json` | 2025-04-25 |
| diemaster.services.infra-setup | `feat-schema-completo-e-lógica-batch` | 2025-05-07 |
| sdk.project-organizer | `chore/reference-standards` | 2026-02-15 |
| sdk.sdk-observability-stack | `feat/angular-embedding` | 2025-12-23 |
| spotfusion | `chore/rename-submodules` | 2026-02-16 |
| spotfusion.ds.spotfusion-ds-training | `chore/unificacao-branches` | 2025-12-29 |
| spotfusion.legacy.new_sparkeyes_modeling | `feature/integrar_sistema_votacao` | 2024-11-08 |
| spotfusion.services.modified-setup.setup | `deploy-fz` | 2025-10-25 |
| spotfusion.toolkit.spotfusion-deploy-toolkit | `feat/viewer-interactive-charts` | 2026-02-16 |
| spotfusion.toolkit.spotfusion-toolkit | `feature/single_container` | 2024-07-25 |
| visionking | `chore/rename-submodules` | 2026-02-16 |
| visionking.ds.training | `feat/clearml-integration` | 2026-01-05 |
| visionking.legacy.cloud-pipeline | `feat/ad-hoc-para-bypassar-makefile` | 2025-06-09 |
| visionking.services.camera-acquisition | `fix/trigger-level-high` | 2025-12-10 |
| visionking.services.database-writer | `feat/aio-pika` | 2026-02-15 |
| visionking.services.inference | `feat/implementacao-aio-pika` | 2025-06-13 |
| visionking.services.pixel-to-object | `feat/kalman-filter` | 2025-12-02 |
| visionking.services.setup | `fix/logica-funcoes` | 2025-12-17 |
| visionking.services.visualizer | `feat/suporte-poligonos` | 2025-11-07 |
| visionking.toolkit.defect-report-toolkit | `chore/reference-standards` | 2026-02-15 |

---

## Dirty Repositories

| Workspace | Branch | Product |
|-----------|--------|---------|
| diemaster | `chore/rename-submodules` | diemaster |
| diemaster.firmware.firmware-hub | `feat/868fnjkzz-broadcast-udp` | diemaster |
| diemaster.firmware.firmware-switch | `feat/868fnjkqc-broadcast-udp` | diemaster |
| diemaster.legacy.sim-generator | `feat--parse-simplificado` | diemaster |
| diemaster.legacy.smart-die | `production` | diemaster |
| diemaster.services.backend | `develop` | diemaster |
| diemaster.services.connect | `master` | diemaster |
| diemaster.services.data-processing | `master` | diemaster |
| diemaster.services.database-writer | `feat--insercao-via-json` | diemaster |
| diemaster.services.frontend | `master` | diemaster |
| diemaster.services.get-data | `master` | diemaster |
| diemaster.services.infra-setup | `feat-schema-completo-e-lógica-batch` | diemaster |
| diemaster.services.loader | `master` | diemaster |
| diemaster.services.setting | `master` | diemaster |
| sdk.3d-model-convert-to-gltf | `master` | sdk |
| sdk.project-organizer | `chore/reference-standards` | sdk |
| sdk.sdk-agent-standards | `master` | sdk |
| sdk.sdk-bos6000-toolkit | `master` | sdk |
| sdk.sdk-defect-visualizer | `master` | sdk |
| sdk.sdk-image-extractor | `master` | sdk |
| sdk.sdk-label-studio-toolkit | `master` | sdk |
| sdk.sdk-lib-rabbit-client | `master` | sdk |
| sdk.sdk-message-poster | `master` | sdk |
| sdk.sdk-observability-stack | `feat/angular-embedding` | sdk |
| sdk.sdk-redis-trendline-monitor | `master` | sdk |
| sdk.sdk-repository-reader | `master` | sdk |
| sdk.sdk-video-cronoanalysis | `master` | sdk |
| spotfusion | `chore/rename-submodules` | spotfusion |
| spotfusion.ds.dataset-toolkit | `master` | spotfusion |
| spotfusion.ds.spotfusion-ds-training | `chore/unificacao-branches` | spotfusion |
| spotfusion.legacy.new_sparkeyes_modeling | `feature/integrar_sistema_votacao` | spotfusion |
| spotfusion.services.backend | `develop` | spotfusion |
| spotfusion.services.modified-setup.setup | `deploy-fz` | spotfusion |
| spotfusion.services.setup | `master` | spotfusion |
| spotfusion.toolkit.spotfusion-deploy-toolkit | `feat/viewer-interactive-charts` | spotfusion |
| spotfusion.toolkit.spotfusion-smartcam-toolkit | `master` | spotfusion |
| spotfusion.toolkit.spotfusion-toolkit | `feature/single_container` | spotfusion |
| visionking | `chore/rename-submodules` | visionking |
| visionking.ds.label-predictor | `master` | visionking |
| visionking.ds.label-predictor.label-studio-ml-backend | `master` | visionking |
| visionking.ds.training | `feat/clearml-integration` | visionking |
| visionking.ds.yolov11.ultralytics | `main` | visionking |
| visionking.legacy.cloud-pipeline | `feat/ad-hoc-para-bypassar-makefile` | visionking |
| visionking.legacy.cloud-pipeline-draft | `master` | visionking |
| visionking.legacy.defect-aggregator | `master` | visionking |
| visionking.legacy.underbody | `master` | visionking |
| visionking.services.backend | `master` | visionking |
| visionking.services.backend-ds | `develop` | visionking |
| visionking.services.bd-sis-surface | `master` | visionking |
| visionking.services.camera-acquisition | `fix/trigger-level-high` | visionking |
| visionking.services.controller | `develop` | visionking |
| visionking.services.database-writer | `feat/aio-pika` | visionking |
| visionking.services.frontend | `develop` | visionking |
| visionking.services.frontend-ds | `develop` | visionking |
| visionking.services.image-saver | `develop` | visionking |
| visionking.services.inference | `feat/implementacao-aio-pika` | visionking |
| visionking.services.length-measure | `master` | visionking |
| visionking.services.pixel-to-object | `feat/kalman-filter` | visionking |
| visionking.services.plc-monitor | `master` | visionking |
| visionking.services.result | `develop` | visionking |
| visionking.services.setup | `fix/logica-funcoes` | visionking |
| visionking.services.storage-monitor | `master` | visionking |
| visionking.services.visualizer | `feat/suporte-poligonos` | visionking |
| visionking.toolkit.defect-report-toolkit | `chore/reference-standards` | visionking |

---

## Sync Issues (Ahead/Behind Remote)

| Workspace | Branch | Sync Status |
|-----------|--------|------------|
| diemaster.services.backend | `develop` | ↑0↓15 |
| diemaster.services.frontend | `master` | ↑0↓1 |
| diemaster.services.get-data | `master` | ↑0↓2 |
| diemaster.services.loader | `master` | ↑0↓2 |
| diemaster.services.setting | `master` | ↑0↓9 |
| sdk.3d-model-convert-to-gltf | `master` | ↑0↓2 |
| sdk.sdk-image-extractor | `master` | ↑0↓4 |
| spotfusion.ds.spotfusion-ds-training | `chore/unificacao-branches` | ↑0↓2 |
| visionking.ds.label-predictor.label-studio-ml-backend | `master` | ↑0↓40 |
| visionking.ds.yolov11.ultralytics | `main` | ↑0↓1788 |
| visionking.legacy.cloud-pipeline-draft | `master` | ↑0↓1 |

---

## Google Source Repositories (GSR) — Remaining

| Workspace | Branch | Remote URL |
|-----------|--------|-----------|
| diemaster.legacy.sim-generator | `feat--parse-simplificado` | https://source.developers.google.com/p/smart-die/r/sim-generator |
| diemaster.legacy.smart-die | `production` | https://source.developers.google.com/p/smartdie-software/r/smart-die |
| spotfusion.ds.dataset-toolkit | `master` | ssh://pedro@lumesolutions.com@source.developers.google.com:2022/p/spark-eyes/r/dataset-toolkit |
| spotfusion.legacy.new_sparkeyes_modeling | `feature/integrar_sistema_votacao` | https://source.developers.google.com/p/sparkeyes-data-science/r/new_sparkeyes_modeling |
| spotfusion.toolkit.spotfusion-toolkit | `feature/single_container` | https://source.developers.google.com/p/spark-eyes/r/sparkeyes-toolkit |
| visionking.legacy.cloud-pipeline | `feat/ad-hoc-para-bypassar-makefile` | https://source.developers.google.com/p/sis-surface/r/cloud-pipeline |
| visionking.legacy.cloud-pipeline-draft | `master` | https://source.developers.google.com/p/sis-surface/r/cloud-pipeline |
| visionking.services.bd-sis-surface | `master` | https://source.developers.google.com/p/sis-surface/r/bd-sis-surface |

---

## Repos Without Develop Branch

- diemaster.ds.pamstamp-io (diemaster)
- diemaster.firmware.firmware-switch (diemaster)
- diemaster.legacy.sim-generator (diemaster)
- diemaster.legacy.smart-die (diemaster)
- diemaster.services.connect (diemaster)
- diemaster.services.data-processing (diemaster)
- diemaster.services.frontend (diemaster)
- diemaster.services.get-data (diemaster)
- diemaster.services.loader (diemaster)
- diemaster.services.plc-monitor (diemaster)
- diemaster.services.setting (diemaster)
- diemaster.services.status (diemaster)
- diemaster.services.trigger (diemaster)
- sdk.3d-model-convert-to-gltf (sdk)
- sdk.project-organizer (sdk)
- spotfusion.ds.dataset-toolkit (spotfusion)
- spotfusion.legacy.new_sparkeyes_modeling (spotfusion)
- spotfusion.services.modified-setup.setup (spotfusion)
- spotfusion.services.setup (spotfusion)
- spotfusion.toolkit.spotfusion-toolkit (spotfusion)
- visionking.ds.label-predictor.label-studio-ml-backend (visionking)
- visionking.ds.yolov11.ultralytics (visionking)
- visionking.legacy.cloud-pipeline-draft (visionking)
- visionking.legacy.defect-aggregator (visionking)
- visionking.services.bd-sis-surface (visionking)
- visionking.services.plc-monitor (visionking)
- visionking.services.plc-monitor-eip (visionking)
- visionking.services.storage-monitor (visionking)
- visionking.services.visualizer (visionking)
- visionking.toolkit.data-manager (visionking)
- visionking.toolkit.toolkit (visionking)

---

*Report generated on 2026-02-17 by JARVIS workspace-git-analysis*
