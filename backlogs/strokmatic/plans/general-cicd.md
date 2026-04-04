# CICD-01: Implementation Plan -- Update Cloud Build Links for Migrated GitHub Repos

## 1. Inventory

### 1.1 Key Observations

**None of the 45 cloudbuild files contain explicit repo URLs or `source.developers.google.com` references.** The cloudbuild YAML files only define build steps (docker build/push) and Artifact Registry image paths. The repo source is configured externally in the GCP Cloud Build **trigger** configuration, not inside the YAML files themselves.

The cloudbuild files are therefore **already correct in terms of build logic**. The migration concern is about:
1. **Cloud Build trigger source configuration** (GCP Console side) -- which repos the triggers point to
2. **Artifact Registry image paths** -- these are fine, they reference Artifact Registry (not the source repo)
3. **Git submodule initialization** -- `git submodule update --init --recursive` works regardless of source, as long as `.gitmodules` is correct

### 1.2 Full Cloudbuild File Inventory

| # | Product | Service | File | GCP Project | Artifact Registry | Image Name | Notes |
|---|---------|---------|------|-------------|-------------------|------------|-------|
| 1 | VisionKing | bd-sis-surface | `services/bd-sis-surface/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | bd-sis-surface | Workspace remote: Google Source Repos |
| 2 | VisionKing | visualizer | `services/visualizer/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-visualizer | Workspace remote: GitHub |
| 3 | VisionKing | controller | `services/controller/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-controller | Workspace remote: GitHub; downloads lib from Artifact Registry |
| 4 | VisionKing | plc-monitor | `services/plc-monitor/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-plc-monitor | Workspace remote: GitHub |
| 5 | VisionKing | storage-monitor | `services/storage-monitor/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-storage-monitor | Workspace remote: GitHub |
| 6 | VisionKing | result | `services/result/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-result | Workspace remote: GitHub; uses BuildKit cache |
| 7 | VisionKing | pixel-to-object | `services/pixel-to-object/infra/gcp/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-pixel-to-object | Workspace remote: GitHub; custom serviceAccount |
| 8 | VisionKing | pixel-to-object (dev) | `services/pixel-to-object/infra/gcp/cloudbuild-dev.yaml` | sis-surface | us-central1 / sis-surface | dev-visionking-pixel-to-object | dev variant; custom serviceAccount |
| 9 | VisionKing | image-saver | `services/image-saver/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-image-saver | Workspace remote: GitHub |
| 10 | VisionKing | camera-acquisition | `services/camera-acquisition/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-camera-acquisition | Workspace remote: GitHub; E2_HIGHCPU_8, 200GB disk |
| 11 | VisionKing | camera-acquisition (dev) | `services/camera-acquisition/cloudbuild-dev.yaml` | sis-surface | us-central1 / sis-surface | dev-visionking-camera-acquisition | dev variant |
| 12 | VisionKing | inference | `services/inference/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | dm-sis-surface | **Suspicious**: image name is `dm-sis-surface`, not inference-related |
| 13 | VisionKing | database-writer | `services/database-writer/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-database-writer | Workspace remote: GitHub |
| 14 | VisionKing | database-writer (dev) | `services/database-writer/cloudbuild-dev.yaml` | sis-surface | us-central1 / sis-surface | dev-visionking-database-writer | dev variant |
| 15 | VisionKing | plc-monitor-eip | `services/plc-monitor-eip/cloudbuild.yaml` | sis-surface | us-central1 / sis-surface | visionking-plc-monitor-eip | New service, no workspace entry |
| 16 | SpotFusion | plc-monitor | `services/plc-monitor/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | plc-monitor | Workspace remote: Google Source Repos |
| 17 | SpotFusion | default-module | `services/default-module/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | default-module | Workspace remote: Google Source Repos |
| 18 | SpotFusion | get-result | `services/get-result/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | get-result | Workspace remote: Google Source Repos |
| 19 | SpotFusion | plc-result | `services/plc-result/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | plc-result | Workspace remote: Google Source Repos |
| 20 | SpotFusion | module-a | `services/module-a/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | module-a | Workspace remote: Google Source Repos |
| 21 | SpotFusion | plc-monitor-camera | `services/plc-monitor-camera/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | plc-monitor-camera | Workspace remote: Google Source Repos |
| 22 | SpotFusion | image-processing | `services/image-processing/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | processing-image | Workspace remote: Google Source Repos |
| 23 | SpotFusion | data-processing | `services/data-processing/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | processing-data | New service in monorepo, no standalone workspace |
| 24 | SpotFusion | data-enrichment | `services/data-enrichment/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | data-enrichment | New service in monorepo |
| 25 | SpotFusion | database-cleanup | `services/database-cleanup/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | database-cleanup | New service in monorepo |
| 26 | SpotFusion | tag-monitor | `services/tag-monitor/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | tag-monitor | New service in monorepo |
| 27 | SpotFusion | tag-monitor-siemens | `services/tag-monitor-siemens/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | tag-monitor-siemens | New service in monorepo |
| 28 | SpotFusion | camera-acquisition | `services/camera-acquisition/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | camera-acquisition | Workspace remote: Google Source Repos; custom genicam submodule branch |
| 29 | SpotFusion | device-controller | `services/device-controller/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | controler-devices | Workspace remote: Google Source Repos |
| 30 | SpotFusion | database-writer | `services/database-writer/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | database-write | New service in monorepo |
| 31 | SpotFusion | get-data | `services/get-data/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | get-data | Workspace remote: Google Source Repos |
| 32 | SpotFusion | get-data (dev) | `services/get-data/cloudbuild-dev.yaml` | spark-eyes | southamerica-east1 / spark-eyes | dev-get-data | dev variant |
| 33 | SpotFusion | get-image | `services/get-image/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | get-image | Workspace remote: Google Source Repos |
| 34 | SpotFusion | plc-monitor-camera-opener | `services/plc-monitor-camera-opener/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | plc-monitor-camera-opener | New service in monorepo |
| 35 | SpotFusion | backend | `services/backend/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | sparkeyes-back-end | Workspace remote: Google Source Repos |
| 36 | SpotFusion | frontend | `services/frontend/cloudbuild.yaml` | spark-eyes | southamerica-east1 / spark-eyes | sparkeyes-front-end | Workspace remote: Google Source Repos (smartdie-front-end entry) |
| 37 | DieMaster | get-data | `services/get-data/cloudbuild.yaml` | smart-die | southamerica-east1 / smart-die | smartdie-get-data | Workspace remote: GitHub |
| 38 | DieMaster | database-writer | `services/database-writer/cloudbuild.yaml` | smart-die | southamerica-east1 / smart-die | dw-smart-die | Workspace remote: GitHub |
| 39 | DieMaster | loader | `services/loader/cloudbuild.yaml` | smart-die | southamerica-east1 / smart-die | smartdie-loader | Workspace remote: GitHub |
| 40 | DieMaster | data-processing | `services/data-processing/cloudbuild.yaml` | smart-die | southamerica-east1 / smart-die | smartdie-processing-data | Workspace remote: GitHub |
| 41 | DieMaster | connect | `services/connect/cloudbuild.yaml` | smart-die | southamerica-east1 / smart-die | smartdie-connect | Workspace remote: GitHub |
| 42 | DieMaster | plc-monitor | `services/plc-monitor/cloudbuild.yaml` | smart-die | southamerica-east1 / smart-die | smartdie-plc-monitor | New service in monorepo |
| 43 | DieMaster | trigger | `services/trigger/cloudbuild.yaml` | smart-die | southamerica-east1 / smart-die | smartdie-trigger | New service in monorepo |
| 44 | DieMaster | status | `services/status/cloudbuild.yaml` | smart-die | southamerica-east1 / smart-die | smartdie-status | New service in monorepo |
| 45 | DieMaster | setting | `services/setting/cloudbuild.yaml` | smart-die | -- | -- | **EMPTY FILE** (1 line, no content) |

### 1.3 Migration State by Workspace Remote

From `workspaces.json`, services still pointing to Google Source Repos (`source.developers.google.com`):

| Product | Workspace | Old Remote (Google Source Repos) | Needs GitHub Migration |
|---------|-----------|--------------------------------|----------------------|
| VisionKing | bd-sis-surface | `p/sis-surface/r/bd-sis-surface` | Yes |
| VisionKing | cloud-pipeline | `p/sis-surface/r/cloud-pipeline` | Yes |
| VisionKing | cloud-pipeline-draft | `p/sis-surface/r/cloud-pipeline` | Yes |
| SpotFusion | dataset-toolkit | `p/spark-eyes/r/dataset-toolkit` | Yes |
| SpotFusion | new_sparkeyes_modeling | `p/sparkeyes-data-science/r/new_sparkeyes_modeling` | Yes |
| SpotFusion | camera-acquisiiton | `p/spark-eyes/r/camera-acquisiiton` | Yes |
| SpotFusion | controler-devices | `p/spark-eyes/r/controler-devices` | Yes |
| SpotFusion | default-module | `p/spark-eyes/r/default-module` | Yes |
| SpotFusion | get-data | `p/spark-eyes/r/get-data` | Yes |
| SpotFusion | get-image | `p/spark-eyes/r/get-image` | Yes |
| SpotFusion | get-result | `p/spark-eyes/r/get-result` | Yes |
| SpotFusion | module-a | `p/spark-eyes/r/module-a` | Yes |
| SpotFusion | plc-monitor | `p/spark-eyes/r/plc-monitor` | Yes |
| SpotFusion | plc-monitor-camera | `p/spark-eyes/r/plc-monitor-camera` | Yes |
| SpotFusion | plc-result | `p/spark-eyes/r/plc-result` | Yes |
| SpotFusion | processing-image | `p/spark-eyes/r/processing-image` | Yes |
| SpotFusion | setup | `p/spark-eyes/r/setup` | Yes |
| SpotFusion | sparkeyes-back-end | `p/spark-eyes/r/sparkeyes-back-end` | Yes |
| SpotFusion | sparkeyes-toolkit | `p/spark-eyes/r/sparkeyes-toolkit` | Yes |
| SpotFusion | Various Ibroker/Icache/Ilog/Ineural/Iplc/pylogix submodules | `p/spark-eyes/r/*` | Yes |
| DieMaster | sim-generator | `p/smart-die/r/sim-generator` | Yes |
| DieMaster | smart-die (legacy) | `p/smartdie-software/r/smart-die` | Yes |
| DieMaster | pm-smart-die | `p/smart-die/r/pm-smart-die` | Yes |
| DieMaster | setting-smart-die | `p/smart-die/r/setting-smart-die` | Yes |
| DieMaster | smartdie-front-end | `p/smart-die/r/smartdie-front-end` | Yes |
| DieMaster | tr-smart-die | `p/smart-die/r/tr-smart-die` | Yes |

---

## 2. Scope of Work

### 2.1 Cloudbuild YAML Files -- No Changes Needed

**All 45 cloudbuild YAML files require ZERO modifications.** They do not contain repo source URLs. They only define:
- Docker build commands with Artifact Registry image paths
- Docker push commands
- Machine type and timeout options

The Artifact Registry paths (`us-central1-docker.pkg.dev/sis-surface/...`, `southamerica-east1-docker.pkg.dev/spark-eyes/...`, `southamerica-east1-docker.pkg.dev/smart-die/...`) are correct and independent of the source repo location.

### 2.2 Anomalies to Address (Separate from Migration)

| Issue | File | Description |
|-------|------|-------------|
| Wrong image name | `visionking/services/inference/cloudbuild.yaml` | Image is `dm-sis-surface` which appears to be a DieMaster name, not a VisionKing inference image. Likely a copy-paste error. |
| Empty file | `diemaster/services/setting/cloudbuild.yaml` | File exists but is empty. Needs to be populated or removed. |

### 2.3 What Actually Needs to Change -- Git Submodule Remotes

For the **monorepo** approach (VisionKing, SpotFusion, DieMaster each have a parent repo with services as submodules), the `.gitmodules` files in each monorepo need updating to point submodules from Google Source Repos to GitHub. This is a prerequisite for Cloud Build triggers to work after migration.

### 2.4 What Actually Needs to Change -- Cloud Build Triggers (GCP Console)

Each Cloud Build trigger currently points to either:
- A **Google Source Repos** mirror, or
- A **GitHub** repo (via Cloud Build GitHub app connection)

Triggers that still point to Google Source Repos need to be re-pointed to GitHub.

---

## 3. GCP Console Changes (Manual Steps)

These cannot be automated via YAML file changes. They must be done in the GCP Console or via `gcloud` CLI.

### 3.1 Per GCP Project

#### Project: `sis-surface` (VisionKing) -- 15 triggers

For each of the 15 VisionKing cloudbuild files, check if a trigger exists and update its source:

1. **Connect GitHub repo** (if not already done):
   ```bash
   # Verify existing connections
   gcloud builds connections list --project=sis-surface --region=us-central1
   ```

2. **For each trigger**, update the source from Google Source Repos to GitHub:
   ```bash
   # List existing triggers
   gcloud builds triggers list --project=sis-surface --region=us-central1
   
   # For each trigger, note the trigger ID and update
   # Example: update trigger to use GitHub source
   gcloud builds triggers update <TRIGGER_ID> \
     --project=sis-surface \
     --region=us-central1 \
     --repository=projects/sis-surface/locations/us-central1/connections/<CONNECTION>/repositories/<REPO> \
     --branch-pattern="^main$" \
     --build-config="services/<service>/cloudbuild.yaml"
   ```

3. **Services needing trigger updates** (those still on Google Source Repos per workspaces.json):
   - bd-sis-surface

4. **Services already on GitHub** (likely already have correct triggers):
   - All other VisionKing services (visualizer, controller, plc-monitor, storage-monitor, result, pixel-to-object, image-saver, camera-acquisition, inference, database-writer, plc-monitor-eip)

#### Project: `spark-eyes` (SpotFusion) -- 21 triggers

**This is the largest scope.** Most SpotFusion services still reference Google Source Repos.

1. **Connect GitHub repo**:
   ```bash
   gcloud builds connections list --project=spark-eyes --region=southamerica-east1
   ```

2. **SpotFusion is now a monorepo** (`git@github.com:strokmatic/spotfusion.git`). All 21 services are subdirectories of this monorepo. Triggers need to:
   - Point to the `strokmatic/spotfusion` GitHub repo
   - Use the correct `cloudbuild.yaml` path within the monorepo (e.g., `services/plc-monitor/cloudbuild.yaml`)
   - Use path filters so only changes to a service's directory trigger its build

3. **All 21 SpotFusion triggers need updating** to point to the monorepo.

#### Project: `smart-die` (DieMaster) -- 9 triggers

1. **DieMaster is now a monorepo** (`git@github.com:strokmatic/diemaster.git`). Similar to SpotFusion.

2. **All 9 DieMaster triggers need updating** (8 active + 1 empty setting).

### 3.2 Trigger Configuration Template

For each monorepo service trigger:

```
Trigger Name:     <product>-<service>-build
Event:            Push to branch
Source:           GitHub (2nd gen) -> strokmatic/<monorepo>
Branch:           ^main$ (or ^develop$)
Build Config:     services/<service>/cloudbuild.yaml
Included files:   services/<service>/**
```

### 3.3 Full Trigger Update Checklist

| # | GCP Project | Trigger Name | GitHub Repo | Build Config Path | Include Filter |
|---|-------------|-------------|-------------|-------------------|----------------|
| 1 | sis-surface | vk-bd-sis-surface | strokmatic/visionking | services/bd-sis-surface/cloudbuild.yaml | services/bd-sis-surface/** |
| 2 | sis-surface | vk-visualizer | strokmatic/visionking | services/visualizer/cloudbuild.yaml | services/visualizer/** |
| 3 | sis-surface | vk-controller | strokmatic/visionking | services/controller/cloudbuild.yaml | services/controller/** |
| 4 | sis-surface | vk-plc-monitor | strokmatic/visionking | services/plc-monitor/cloudbuild.yaml | services/plc-monitor/** |
| 5 | sis-surface | vk-storage-monitor | strokmatic/visionking | services/storage-monitor/cloudbuild.yaml | services/storage-monitor/** |
| 6 | sis-surface | vk-result | strokmatic/visionking | services/result/cloudbuild.yaml | services/result/** |
| 7 | sis-surface | vk-pixel-to-object | strokmatic/visionking | services/pixel-to-object/infra/gcp/cloudbuild.yaml | services/pixel-to-object/** |
| 8 | sis-surface | vk-pixel-to-object-dev | strokmatic/visionking | services/pixel-to-object/infra/gcp/cloudbuild-dev.yaml | services/pixel-to-object/** |
| 9 | sis-surface | vk-image-saver | strokmatic/visionking | services/image-saver/cloudbuild.yaml | services/image-saver/** |
| 10 | sis-surface | vk-camera-acquisition | strokmatic/visionking | services/camera-acquisition/cloudbuild.yaml | services/camera-acquisition/** |
| 11 | sis-surface | vk-camera-acquisition-dev | strokmatic/visionking | services/camera-acquisition/cloudbuild-dev.yaml | services/camera-acquisition/** |
| 12 | sis-surface | vk-inference | strokmatic/visionking | services/inference/cloudbuild.yaml | services/inference/** |
| 13 | sis-surface | vk-database-writer | strokmatic/visionking | services/database-writer/cloudbuild.yaml | services/database-writer/** |
| 14 | sis-surface | vk-database-writer-dev | strokmatic/visionking | services/database-writer/cloudbuild-dev.yaml | services/database-writer/** |
| 15 | sis-surface | vk-plc-monitor-eip | strokmatic/visionking | services/plc-monitor-eip/cloudbuild.yaml | services/plc-monitor-eip/** |
| 16 | spark-eyes | sf-plc-monitor | strokmatic/spotfusion | services/plc-monitor/cloudbuild.yaml | services/plc-monitor/** |
| 17 | spark-eyes | sf-default-module | strokmatic/spotfusion | services/default-module/cloudbuild.yaml | services/default-module/** |
| 18 | spark-eyes | sf-get-result | strokmatic/spotfusion | services/get-result/cloudbuild.yaml | services/get-result/** |
| 19 | spark-eyes | sf-plc-result | strokmatic/spotfusion | services/plc-result/cloudbuild.yaml | services/plc-result/** |
| 20 | spark-eyes | sf-module-a | strokmatic/spotfusion | services/module-a/cloudbuild.yaml | services/module-a/** |
| 21 | spark-eyes | sf-plc-monitor-camera | strokmatic/spotfusion | services/plc-monitor-camera/cloudbuild.yaml | services/plc-monitor-camera/** |
| 22 | spark-eyes | sf-image-processing | strokmatic/spotfusion | services/image-processing/cloudbuild.yaml | services/image-processing/** |
| 23 | spark-eyes | sf-data-processing | strokmatic/spotfusion | services/data-processing/cloudbuild.yaml | services/data-processing/** |
| 24 | spark-eyes | sf-data-enrichment | strokmatic/spotfusion | services/data-enrichment/cloudbuild.yaml | services/data-enrichment/** |
| 25 | spark-eyes | sf-database-cleanup | strokmatic/spotfusion | services/database-cleanup/cloudbuild.yaml | services/database-cleanup/** |
| 26 | spark-eyes | sf-tag-monitor | strokmatic/spotfusion | services/tag-monitor/cloudbuild.yaml | services/tag-monitor/** |
| 27 | spark-eyes | sf-tag-monitor-siemens | strokmatic/spotfusion | services/tag-monitor-siemens/cloudbuild.yaml | services/tag-monitor-siemens/** |
| 28 | spark-eyes | sf-camera-acquisition | strokmatic/spotfusion | services/camera-acquisition/cloudbuild.yaml | services/camera-acquisition/** |
| 29 | spark-eyes | sf-device-controller | strokmatic/spotfusion | services/device-controller/cloudbuild.yaml | services/device-controller/** |
| 30 | spark-eyes | sf-database-writer | strokmatic/spotfusion | services/database-writer/cloudbuild.yaml | services/database-writer/** |
| 31 | spark-eyes | sf-get-data | strokmatic/spotfusion | services/get-data/cloudbuild.yaml | services/get-data/** |
| 32 | spark-eyes | sf-get-data-dev | strokmatic/spotfusion | services/get-data/cloudbuild-dev.yaml | services/get-data/** |
| 33 | spark-eyes | sf-get-image | strokmatic/spotfusion | services/get-image/cloudbuild.yaml | services/get-image/** |
| 34 | spark-eyes | sf-plc-monitor-camera-opener | strokmatic/spotfusion | services/plc-monitor-camera-opener/cloudbuild.yaml | services/plc-monitor-camera-opener/** |
| 35 | spark-eyes | sf-backend | strokmatic/spotfusion | services/backend/cloudbuild.yaml | services/backend/** |
| 36 | spark-eyes | sf-frontend | strokmatic/spotfusion | services/frontend/cloudbuild.yaml | services/frontend/** |
| 37 | smart-die | dm-get-data | strokmatic/diemaster | services/get-data/cloudbuild.yaml | services/get-data/** |
| 38 | smart-die | dm-database-writer | strokmatic/diemaster | services/database-writer/cloudbuild.yaml | services/database-writer/** |
| 39 | smart-die | dm-loader | strokmatic/diemaster | services/loader/cloudbuild.yaml | services/loader/** |
| 40 | smart-die | dm-data-processing | strokmatic/diemaster | services/data-processing/cloudbuild.yaml | services/data-processing/** |
| 41 | smart-die | dm-connect | strokmatic/diemaster | services/connect/cloudbuild.yaml | services/connect/** |
| 42 | smart-die | dm-plc-monitor | strokmatic/diemaster | services/plc-monitor/cloudbuild.yaml | services/plc-monitor/** |
| 43 | smart-die | dm-trigger | strokmatic/diemaster | services/trigger/cloudbuild.yaml | services/trigger/** |
| 44 | smart-die | dm-status | strokmatic/diemaster | services/status/cloudbuild.yaml | services/status/** |

---

## 4. Testing Plan

### 4.1 Pre-Migration Verification

1. **Audit current triggers**: Run `gcloud builds triggers list` on all 3 GCP projects and document existing trigger configurations as a rollback reference
2. **Verify GitHub connections exist**: Confirm Cloud Build GitHub App is installed on `strokmatic` org for all 3 GCP projects

### 4.2 Per-Trigger Verification

For each updated trigger:

1. **Manual trigger test**: `gcloud builds triggers run <TRIGGER_NAME> --branch=main --project=<PROJECT>`
2. **Verify build succeeds**: Check that:
   - Git clone from GitHub works
   - `git submodule update --init --recursive` succeeds (critical -- `.gitmodules` must use accessible URLs)
   - Docker build completes
   - Image is pushed to Artifact Registry with correct tags
3. **Verify image is pullable**: `docker pull <ARTIFACT_REGISTRY_PATH>:latest`

### 4.3 Post-Migration Smoke Test

1. Push a trivial change (e.g., comment in Dockerfile) to one service per product
2. Confirm the trigger fires automatically from the GitHub push event
3. Confirm the build completes end-to-end

### 4.4 Rollback Plan

- Keep old triggers disabled (not deleted) for 2 weeks
- If a new trigger fails, re-enable the old one while debugging

---

## 5. Hours Estimate

| Task | Hours |
|------|-------|
| **Audit**: List all existing triggers across 3 GCP projects, document current state | 1.5 |
| **GitHub Connection Setup**: Ensure Cloud Build GitHub connections exist for all 3 projects/regions | 1.0 |
| **VisionKing Triggers** (15 triggers): Create/update triggers in `sis-surface` | 2.5 |
| **SpotFusion Triggers** (21 triggers): Create/update triggers in `spark-eyes` | 3.5 |
| **DieMaster Triggers** (8 triggers): Create/update triggers in `smart-die` | 1.5 |
| **Fix anomalies**: inference image name, empty setting cloudbuild | 0.5 |
| **Submodule verification**: Check `.gitmodules` in all 3 monorepos for Google Source Repos URLs | 1.0 |
| **Testing**: Manual trigger runs + push-event verification for all 44 triggers | 3.0 |
| **Documentation**: Update workspaces.json remotes, write migration notes | 1.0 |
| **Buffer** (unexpected issues, auth problems, submodule breakage) | 2.0 |
| **Total** | **17.5 hours** |

### Risk Factors That Could Increase Estimate

- **Submodule chains**: SpotFusion services have nested submodules (Ibroker, Icache, Ilog, etc.) still on Google Source Repos. If these are fetched during `git submodule update --init --recursive` in Cloud Build, they will fail unless also migrated to GitHub or made accessible. This alone could add 4-8 hours.
- **GitHub App permissions**: The Cloud Build GitHub App may need repo-level permissions on the `strokmatic` org.
- **Branch patterns**: Triggers currently watching specific branches on Google Source Repos may need different patterns for the monorepo (e.g., path-based filtering).