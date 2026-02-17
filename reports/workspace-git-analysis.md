# Workspace Git Analysis Report

**Report Date:** 2026-02-16
**Report Type:** Post-Migration Status Update
**Analysis Scope:** DieMaster, SDK, SpotFusion, VisionKing

---

## Executive Summary

### Overview
This report reflects the **current state** of all Strokmatic repositories after completing the major renaming and migration work on **2026-02-16**. All three product monorepos (DieMaster, SpotFusion, VisionKing) have successfully merged their `chore/rename-submodules` branches into `develop`.

### Repository Counts
- **Total GitHub Repositories:** ~85
  - DieMaster: 16 (15 submodules + 1 monorepo)
  - SDK: 12 (11 submodules + 1 project-organizer)
  - SpotFusion: 33 (28 migrated services/libs + 5 toolkit/legacy)
  - VisionKing: 24 (22 submodules + 1 monorepo + 1 legacy)
- **Google Source Repositories (GSR) Remaining:** 9
  - SpotFusion: 5 (dataset-toolkit, new_sparkeyes_modeling, sparkeyes-hash, tests, spotfusion-toolkit)
  - DieMaster: 2 (sim-generator, smart-die legacy)
  - VisionKing: 2 (bd-sis-surface, cloud-pipeline family)
- **Third-Party Repos:** 1 (3d-model-convert-to-gltf)
- **Local-Only Repos:** 1 (project-organizer)
- **Migration Progress:** **90%** (85 of 94 organizational repos on GitHub)

### Migration Activity (2026-02-16)

#### SpotFusion Migration (28 Repositories)
**Directory Renaming:**
- `camera-acquisiiton` → `camera-acquisition` (typo fix)
- `controler-devices` → `device-controller`
- `data-enritchment` → `data-enrichment` (typo fix)
- All other services maintained consistent naming

**Remote Configuration:**
- Removed all GSR remotes from migrated repositories
- Standardized remote name to `origin` (GitHub)
- All 28 service/lib repos now point to `git@github.com:strokmatic/spotfusion-*.git`

**Code Changes:**
- Inlined nested submodules (Ilog, Icache, Iconfig, etc.) as local code
- Removed submodule references for inlined components

#### DieMaster Migration (15 Repositories)
**GitHub Repository Renaming:**
- `smartdie-*` → `diemaster-*` naming convention applied across all repos
- Examples: `smartdie-back-end` → `diemaster-back-end`

**Directory Cleanup:**
- Organized services under `services/` directory
- Added firmware subdirectory structure

**New Repositories Added (4):**
- `diemaster-pamstamp-io` (new)
- `diemaster-plc-monitor` (new)
- `diemaster-status` (new)
- `diemaster-trigger` (new)

**Removed:**
- `pm-smart-die` (duplicate, functionality merged)
- `tr-smart-die` (duplicate, functionality merged)

#### VisionKing Migration
**Directory Renaming:**
- Dropped `visionking-` prefix from all submodule directories
- Example: `services/visionking-backend` → `services/backend`

**New Repositories Added (4):**
- `visionking-plc-monitor-eip` (new EtherNet/IP monitor)
- `visionking-data-manager` (new)
- `visionking-defect-report-toolkit` (renamed from defect-collection-toolkit)
- `visionking-toolkit` (new)

**GitHub Repository Renaming:**
- `defect-collection-toolkit` → `defect-report-toolkit`

#### All Monorepos
**Branch Status:**
- All three `chore/rename-submodules` branches merged into `develop`
- Submodule references updated to new paths and remotes
- `.gitmodules` files reflect current structure

---

## DieMaster Repositories

| Workspace | GitHub Repo Name | Master | Develop | Remote Name | Current Branch |
|-----------|------------------|--------|---------|-------------|----------------|
| diemaster | diemaster | ✓ | ✓ | origin | chore/rename-submodules |
| diemaster/ds/pamstamp-io | diemaster-pamstamp-io | ✓ | — | origin | master (new) |
| diemaster/ds/sim-generator | *GSR: sim-generator* | ✓ | — | origin | feat--parse-simplificado |
| diemaster/firmware/firmware-hub | diemaster-firmware-hub | ✓ | ✓ | origin | feat/868fnjkzz-broadcast-udp |
| diemaster/firmware/firmware-switch | diemaster-firmware-switch | ✓ | — | origin | feat/868fnjkqc-broadcast-udp |
| diemaster/legacy/smart-die | *GSR: smart-die* | ✓ | — | origin | production |
| diemaster/services/backend | diemaster-back-end | — | ✓ | origin | develop |
| diemaster/services/connect | diemaster-connect | ✓ | — | origin | master |
| diemaster/services/database-writer | diemaster-database-writer | — | ✓ | origin | feat--insercao-via-json |
| diemaster/services/data-processing | diemaster-processing-data | ✓ | — | origin | master |
| diemaster/services/frontend | diemaster-front-end | ✓ | — | origin | master |
| diemaster/services/get-data | diemaster-get-data | ✓ | — | origin | master |
| diemaster/services/infra-setup | diemaster-infra-setup | ✓ | ✓ | origin | feat-schema-completo-e-lógica-batch |
| diemaster/services/loader | diemaster-loader | ✓ | — | origin | master |
| diemaster/services/plc-monitor | diemaster-plc-monitor | ✓ | — | origin | master (new) |
| diemaster/services/setting | diemaster-setting | ✓ | — | origin | master |
| diemaster/services/status | diemaster-status | ✓ | — | origin | master (new) |
| diemaster/services/trigger | diemaster-trigger | ✓ | — | origin | master (new) |

**Notes:**
- **New repos:** pamstamp-io, plc-monitor, status, trigger
- **GSR repos remaining:** sim-generator, smart-die (legacy)
- **Repos without develop branch:** 14 of 18 (needs branch strategy alignment)
- **Backend:** Currently on `develop` (no master branch)

---

## SDK Repositories

| Workspace | GitHub Repo Name | Master | Develop | Remote Name | Current Branch |
|-----------|------------------|--------|---------|-------------|----------------|
| sdk/3d-model-convert-to-gltf | *3rd party (wangerzi)* | ✓ | — | origin | master |
| sdk/project-organizer | *(local only)* | ✓ | — | none | chore/reference-standards |
| sdk/sdk-agent-standards | sdk-agent-standards | ✓ | ✓ | origin | master |
| sdk/sdk-bos6000-toolkit | sdk-bos6000-toolkit | ✓ | ✓ | github | master |
| sdk/sdk-defect-visualizer | sdk-defect-visualizer | ✓ | ✓ | github | master |
| sdk/sdk-image-extractor | sdk-image-exporter | ✓ | ✓ | github | master |
| sdk/sdk-label-studio-toolkit | sdk-label-studio-toolkit | ✓ | ✓ | github | master |
| sdk/sdk-lib-rabbit-client | sdk-lib-rabbit-client | ✓ | ✓ | github | master |
| sdk/sdk-message-poster | sdk-message-poster | ✓ | ✓ | origin | master |
| sdk/sdk-observability-stack | sdk-observability-stack | ✓ | ✓ | github | feat/angular-embedding |
| sdk/sdk-redis-trendline-monitor | sdk-redis-trendline-monitor | ✓ | ✓ | github | master |
| sdk/sdk-repository-reader | sdk-repository-reader | ✓ | ✓ | origin | master |
| sdk/sdk-video-cronoanalysis | sdk-video-cronoanalysis | ✓ | ✓ | github | master |

**Notes:**
- **All SDK repos have both master and develop branches** (except 3rd party and local-only)
- **Non-standard remote name:** 8 repos use "github" instead of "origin" (see section below)
- **3rd party:** 3d-model-convert-to-gltf from wangerzi
- **Local only:** project-organizer (no remote configured)

---

## SpotFusion Repositories

| Workspace | GitHub Repo Name | Master | Develop | Remote Name | Current Branch |
|-----------|------------------|--------|---------|-------------|----------------|
| spotfusion | spotfusion | ✓ | ✓ | origin | chore/rename-submodules |
| **Data Science** |
| spotfusion/ds/dataset-toolkit | *GSR: dataset-toolkit* | ✓ | — | google | master |
| spotfusion/ds/new_sparkeyes_modeling | *GSR: new_sparkeyes_modeling* | ✓ | — | origin | feature/integrar_sistema_votacao |
| spotfusion/ds/spotfusion-ds-training | spotfusion-ds-training | ✓ | ✓ | origin | chore/unificacao-branches |
| **Intellectual Property** |
| spotfusion/ip/sparkeyes-hash | *GSR: sparkeyes-hash* | ✓ | ✓ | origin | develop |
| **Libraries** |
| spotfusion/libs/lldpd | spotfusion-lldpd | ✓ | ✓ | origin | develop |
| spotfusion/libs/opener | spotfusion-opener | ✓ | ✓ | origin | develop |
| **Services (28 repos - all migrated to GitHub)** |
| spotfusion/services/backend | spotfusion-backend | ✓ | ✓ | origin | develop |
| spotfusion/services/backend-vision | spotfusion-backend-vision | ✓ | ✓ | origin | develop |
| spotfusion/services/camera-acquisition | spotfusion-camera-acquisition | ✓ | ✓ | origin | develop |
| spotfusion/services/database-cleanup | spotfusion-database-cleanup | ✓ | ✓ | origin | develop |
| spotfusion/services/database-writer | spotfusion-database-writer | ✓ | ✓ | origin | develop |
| spotfusion/services/data-enrichment | spotfusion-data-enrichment | ✓ | ✓ | origin | develop |
| spotfusion/services/data-processing | spotfusion-data-processing | ✓ | ✓ | origin | develop |
| spotfusion/services/default-module | spotfusion-default-module | ✓ | ✓ | origin | develop |
| spotfusion/services/device-controller | spotfusion-device-controller | ✓ | ✓ | origin | develop |
| spotfusion/services/frontend | spotfusion-frontend | ✓ | ✓ | origin | develop |
| spotfusion/services/frontend-vision | spotfusion-frontend-vision | ✓ | ✓ | origin | develop |
| spotfusion/services/get-data | spotfusion-get-data | ✓ | ✓ | origin | develop |
| spotfusion/services/get-image | spotfusion-get-image | ✓ | ✓ | origin | develop |
| spotfusion/services/get-result | spotfusion-get-result | ✓ | ✓ | origin | develop |
| spotfusion/services/image-processing | spotfusion-image-processing | ✓ | ✓ | origin | develop |
| spotfusion/services/module-a | spotfusion-module-a | ✓ | ✓ | origin | develop |
| spotfusion/services/plc-monitor | spotfusion-plc-monitor | ✓ | ✓ | origin | develop |
| spotfusion/services/plc-monitor-camera | spotfusion-plc-monitor-camera | ✓ | ✓ | origin | develop |
| spotfusion/services/plc-monitor-camera-opener | spotfusion-plc-monitor-camera-opener | ✓ | ✓ | origin | develop |
| spotfusion/services/plc-result | spotfusion-plc-result | ✓ | ✓ | origin | develop |
| spotfusion/services/setup | spotfusion-setup | ✓ | — | origin | master |
| spotfusion/services/tag-monitor | spotfusion-tag-monitor | ✓ | ✓ | origin | develop |
| spotfusion/services/tag-monitor-siemens | spotfusion-tag-monitor-siemens | ✓ | ✓ | origin | develop |
| **Tests** |
| spotfusion/tests | *GSR: tests* | ✓ | ✓ | origin | develop |
| **Toolkits** |
| spotfusion/toolkit/data-scraping | spotfusion-data-scraping | ✓ | ✓ | origin | develop |
| spotfusion/toolkit/server-installer | spotfusion-server-installer | ✓ | ✓ | origin | develop |
| spotfusion/toolkit/spotfusion-deploy-toolkit | spotfusion-deploy-toolkit | ✓ | ✓ | github | feat/viewer-interactive-charts |
| spotfusion/toolkit/spotfusion-smartcam-toolkit | spotfusion-smartcam-toolkit | ✓ | ✓ | origin | master |
| spotfusion/toolkit/spotfusion-toolkit | *GSR: sparkeyes-toolkit* | ✓ | — | origin | feature/single_container |
| spotfusion/toolkit/vision-installer | spotfusion-vision-installer | ✓ | ✓ | origin | develop |

**Notes:**
- **Major achievement:** 28 service/library repos successfully migrated from GSR to GitHub
- **Directory renaming completed:** camera-acquisiiton→camera-acquisition, controler-devices→device-controller, data-enritchment→data-enrichment
- **Inlined submodules:** Ilog, Icache, Iconfig, and other nested components are now local code (no longer tracked as separate repos)
- **GSR repos remaining (5):** dataset-toolkit, new_sparkeyes_modeling, sparkeyes-hash, tests, spotfusion-toolkit
- **All migrated services:** Currently on `develop` branch with both master and develop branches maintained
- **Setup service:** Only on master (no develop branch)

---

## VisionKing Repositories

| Workspace | GitHub Repo Name | Master | Develop | Remote Name | Current Branch |
|-----------|------------------|--------|---------|-------------|----------------|
| visionking | visionking | ✓ | ✓ | origin | chore/rename-submodules |
| **Data Science** |
| visionking/ds/label-predictor | visionking-ds-label-predictor | ✓ | ✓ | origin | master |
| visionking/ds/training | visionking-ds-training | ✓ | ✓ | origin | feat/clearml-integration |
| **Legacy** |
| visionking/legacy/underbody | underbody | ✓ | ✓ | github | master |
| visionking/legacy/visionking-defect-aggregator | visionking-defect-aggregator | ✓ | — | origin | master |
| **Services (17 repos)** |
| visionking/services/backend | visionking-backend | ✓ | ✓ | origin | master |
| visionking/services/backend-ds | visionking-backend-ds | ✓ | ✓ | origin | develop |
| visionking/services/camera-acquisition | visionking-camera-acquisition | ✓ | ✓ | origin | fix/trigger-level-high |
| visionking/services/controller | visionking-controller | ✓ | ✓ | origin | develop |
| visionking/services/database-writer | visionking-database-writer | ✓ | ✓ | origin | feat/aio-pika |
| visionking/services/frontend | visionking-frontend | ✓ | ✓ | origin | develop |
| visionking/services/frontend-ds | visionking-frontend-ds | ✓ | ✓ | origin | develop |
| visionking/services/image-saver | visionking-image-saver | ✓ | ✓ | origin | develop |
| visionking/services/inference | visionking-inference | ✓ | ✓ | origin | feat/implementacao-aio-pika |
| visionking/services/length-measure | visionking-length-measure | ✓ | ✓ | origin | master |
| visionking/services/pixel-to-object | visionking-pixel-to-object | ✓ | ✓ | origin | feat/kalman-filter |
| visionking/services/plc-monitor | visionking-plc-monitor | ✓ | — | origin | master |
| visionking/services/plc-monitor-eip | visionking-plc-monitor-eip | ✓ | — | origin | master (new) |
| visionking/services/result | visionking-result | ✓ | ✓ | origin | develop |
| visionking/services/setup | visionking-setup | ✓ | ✓ | origin | fix/logica-funcoes |
| visionking/services/storage-monitor | visionking-storage-monitor | ✓ | — | origin | master |
| visionking/services/visualizer | visionking-visualizer | ✓ | — | origin | feat/suporte-poligonos |
| **GSR Services** |
| visionking/services/bd-sis-surface | *GSR: bd-sis-surface* | ✓ | — | origin | master |
| **Toolkits** |
| visionking/toolkit/cloud-pipeline | *GSR: cloud-pipeline* | ✓ | ✓ | origin | feat/ad-hoc-para-bypassar-makefile |
| visionking/toolkit/cloud-pipeline-draft | *GSR: cloud-pipeline* | ✓ | — | origin | master |
| visionking/toolkit/data-manager | visionking-data-manager | ✓ | — | origin | master (new) |
| visionking/toolkit/defect-report-toolkit | visionking-defect-report-toolkit | ✓ | ✓ | origin | chore/reference-standards |
| visionking/toolkit/toolkit | visionking-toolkit | ✓ | — | origin | master (new) |

**Notes:**
- **Directory renaming completed:** Dropped `visionking-` prefix from all submodule directories
- **New repos (4):** plc-monitor-eip, data-manager, toolkit, defect-report-toolkit (renamed from defect-collection-toolkit)
- **GSR repos remaining (3):** bd-sis-surface, cloud-pipeline (appears twice with different local names)
- **Repos without develop branch:** 7 of 26
- **Non-standard remote:** underbody uses "github" remote name

---

## Migration Status: Google Source Repositories (GSR)

### Remaining GSR Repositories (9 total)

#### SpotFusion (5 repos)
1. **dataset-toolkit** (`spotfusion/ds/dataset-toolkit`)
   - Remote: `ssh://...source.developers.google.com.../spark-eyes/r/dataset-toolkit`
   - Branch: master
   - Status: Active data science tool

2. **new_sparkeyes_modeling** (`spotfusion/ds/new_sparkeyes_modeling`)
   - Remote: `https://source.developers.google.com/p/sparkeyes-data-science/r/new_sparkeyes_modeling`
   - Branch: feature/integrar_sistema_votacao
   - Status: Active development

3. **sparkeyes-hash** (`spotfusion/ip/sparkeyes-hash`)
   - Remote: `https://source.developers.google.com/p/spark-eyes/r/sparkeyes-hash`
   - Branch: develop
   - Status: Intellectual property, has both master and develop

4. **tests** (`spotfusion/tests`)
   - Remote: `https://source.developers.google.com/p/spark-eyes/r/tests`
   - Branch: develop
   - Status: Test suite, has both master and develop

5. **spotfusion-toolkit** (`spotfusion/toolkit/spotfusion-toolkit`)
   - Remote: `https://source.developers.google.com/p/spark-eyes/r/sparkeyes-toolkit`
   - Branch: feature/single_container
   - Status: Legacy toolkit

#### DieMaster (2 repos)
1. **sim-generator** (`diemaster/ds/sim-generator`)
   - Remote: `https://source.developers.google.com/p/smart-die/r/sim-generator`
   - Branch: feat--parse-simplificado
   - Status: Data science tool

2. **smart-die** (`diemaster/legacy/smart-die`)
   - Remote: `https://source.developers.google.com/p/smartdie-software/r/smart-die`
   - Branch: production
   - Status: Legacy system

#### VisionKing (2 repos, 3 workspace references)
1. **bd-sis-surface** (`visionking/services/bd-sis-surface`)
   - Remote: `https://source.developers.google.com/p/sis-surface/r/bd-sis-surface`
   - Branch: master
   - Status: Database service

2. **cloud-pipeline** (appears in 2 workspaces)
   - `visionking/toolkit/cloud-pipeline` - Branch: feat/ad-hoc-para-bypassar-makefile
   - `visionking/toolkit/cloud-pipeline-draft` - Branch: master
   - Remote: `https://source.developers.google.com/p/sis-surface/r/cloud-pipeline`
   - Status: Deployment pipeline tooling

### Migration Priority
**High Priority (Active Development):**
- sparkeyes-hash (IP asset with active develop branch)
- new_sparkeyes_modeling (active feature branch)
- tests (shared test infrastructure)
- bd-sis-surface (core service)

**Medium Priority:**
- dataset-toolkit (data science utility)
- sim-generator (development tool)
- cloud-pipeline (deployment tooling)

**Low Priority:**
- smart-die (legacy, production branch stable)
- spotfusion-toolkit (superseded by newer tooling)

---

## Non-Standard Remote Names

The following repositories use "github" as the remote name instead of the standardized "origin":

### SDK (8 repos)
1. sdk/sdk-bos6000-toolkit
2. sdk/sdk-defect-visualizer
3. sdk/sdk-image-extractor
4. sdk/sdk-label-studio-toolkit
5. sdk/sdk-lib-rabbit-client
6. sdk/sdk-observability-stack
7. sdk/sdk-redis-trendline-monitor
8. sdk/sdk-video-cronoanalysis

### SpotFusion (1 repo)
9. spotfusion/toolkit/spotfusion-deploy-toolkit

### VisionKing (1 repo)
10. visionking/legacy/underbody

**Recommendation:** Standardize all GitHub remotes to "origin" for consistency across the organization.

---

## Branch Strategy Analysis

### Repos Without Develop Branch

#### DieMaster (14 repos)
- pamstamp-io, connect, data-processing, frontend, get-data, loader, plc-monitor, setting, status, trigger
- sim-generator (GSR), smart-die (GSR), firmware-switch
- data-processing on master

**Pattern:** Most DieMaster services only have master branch

#### SpotFusion (1 repo)
- setup (only master)

**Pattern:** SpotFusion highly standardized with master + develop on all migrated repos

#### VisionKing (7 repos)
- visionking-defect-aggregator, plc-monitor, plc-monitor-eip, storage-monitor, visualizer
- data-manager, toolkit
- bd-sis-surface (GSR), cloud-pipeline-draft (GSR)

**Pattern:** New repos and legacy/GSR repos tend to have master only

### Repos on Feature/Fix Branches (Not master/develop)

#### DieMaster
- firmware-hub: feat/868fnjkzz-broadcast-udp
- firmware-switch: feat/868fnjkqc-broadcast-udp
- database-writer: feat--insercao-via-json
- infra-setup: feat-schema-completo-e-lógica-batch
- sim-generator: feat--parse-simplificado

#### SpotFusion
- ds-training: chore/unificacao-branches
- sparkeyes-hash: develop (GSR)
- deploy-toolkit: feat/viewer-interactive-charts
- new_sparkeyes_modeling: feature/integrar_sistema_votacao (GSR)
- spotfusion-toolkit: feature/single_container (GSR)

#### VisionKing
- ds/training: feat/clearml-integration
- camera-acquisition: fix/trigger-level-high
- database-writer: feat/aio-pika
- inference: feat/implementacao-aio-pika
- pixel-to-object: feat/kalman-filter
- setup: fix/logica-funcoes
- visualizer: feat/suporte-poligonos
- cloud-pipeline: feat/ad-hoc-para-bypassar-makefile (GSR)
- defect-report-toolkit: chore/reference-standards

**Pattern:** Active feature development across all products, especially around async messaging (aio-pika), ML integration (ClearML), and infrastructure improvements.

---

## Anomalies and Issues

### 1. Duplicate Repository References
**cloud-pipeline** in VisionKing appears twice:
- `visionking/toolkit/cloud-pipeline` (feat/ad-hoc-para-bypassar-makefile)
- `visionking/toolkit/cloud-pipeline-draft` (master)

Both point to the same GSR: `https://source.developers.google.com/p/sis-surface/r/cloud-pipeline`

**Resolution needed:** Clarify which is canonical, consider removing draft or merging branches.

### 2. Inconsistent Backend Branch Strategy
**DieMaster backend** has no master branch (only develop), while most other repos have master as primary.

**Impact:** May cause issues with deployment automation expecting master branch.

### 3. Repository Name Mismatches (GitHub vs Local Directory)
Some GitHub repos have different names than expected:
- `sdk-image-exporter` (GitHub) vs `sdk-image-extractor` (local directory)
- `diemaster-processing-data` (GitHub) vs `data-processing` (local directory)

**Note:** These are acceptable as long as documented; submodule URLs are correct.

### 4. Monorepo Current Branch Status
All three monorepos still on `chore/rename-submodules` branch:
- diemaster: chore/rename-submodules
- spotfusion: chore/rename-submodules
- visionking: chore/rename-submodules

**Status per user:** These branches have been **merged into develop**, so monorepos should be switched to develop branch for ongoing work.

### 5. Third-Party Repository
**3d-model-convert-to-gltf** from wangerzi in SDK workspace:
- Remote: https://github.com/wangerzi/3d-model-convert-to-gltf
- Status: Fork or vendored dependency?
- Risk: Updates outside our control

**Recommendation:** Document purpose and consider forking to strokmatic org if modifications are needed.

### 6. Local-Only Repository
**project-organizer** in SDK has no remote configured:
- Risk: No backup, not shareable with team
- Status: On chore/reference-standards branch

**Recommendation:** Create GitHub repository and push if this is active work.

---

## Recommendations

### Immediate Actions
1. **Switch monorepo branches:** Move diemaster, spotfusion, and visionking from `chore/rename-submodules` to `develop`
2. **Standardize remote names:** Rename "github" remotes to "origin" in SDK and other repos (10 repos total)
3. **Resolve cloud-pipeline duplication:** Merge or remove cloud-pipeline-draft in VisionKing
4. **Document backend strategy:** Clarify DieMaster backend's develop-only approach

### Short-Term (Next Sprint)
5. **Migrate high-priority GSR repos:**
   - sparkeyes-hash (IP asset)
   - new_sparkeyes_modeling (active development)
   - bd-sis-surface (core service)
6. **Establish develop branches:** Create develop branches for repos that need active development workflow
7. **Create GitHub repo for project-organizer:** If still in active use

### Long-Term (Next Quarter)
8. **Complete GSR migration:** Migrate remaining 9 GSR repositories to GitHub
9. **Standardize branch strategy:** Document and implement consistent master/develop strategy across all products
10. **Review third-party dependencies:** Evaluate if 3d-model-convert-to-gltf should be forked to strokmatic org

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total Repositories | ~97 |
| GitHub Repositories | ~85 |
| GSR Repositories | 9 |
| Third-Party Repos | 1 |
| Local-Only Repos | 1 |
| Repos with master branch | ~94 |
| Repos with develop branch | ~70 |
| Repos on feature/fix branches | ~20 |
| Repos needing remote rename | 10 |
| **Migration Progress** | **90%** (85/94 org repos) |

---

## Changelog

### 2026-02-16 - Major Renaming & Migration Milestone
- **SpotFusion:** Migrated 28 repositories from GSR to GitHub
  - Fixed directory typos (camera-acquisiiton, controler-devices, data-enritchment)
  - Standardized all remotes to "origin"
  - Inlined nested submodules (Ilog, Icache, Iconfig)
- **DieMaster:** Renamed all GitHub repos from smartdie-* to diemaster-*
  - Added 4 new repositories (pamstamp-io, plc-monitor, status, trigger)
  - Removed duplicate repos (pm-smart-die, tr-smart-die)
- **VisionKing:** Dropped visionking- prefix from directory names
  - Added 4 new repositories (plc-monitor-eip, data-manager, toolkit, defect-report-toolkit)
  - Renamed defect-collection-toolkit to defect-report-toolkit on GitHub
- **All monorepos:** Merged chore/rename-submodules branches into develop

### Next Report Due
2026-03-16 (monthly cadence)

---

*Report generated on 2026-02-16 | Strokmatic Engineering*
