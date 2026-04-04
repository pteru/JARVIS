# GCP Cloud Build Standardization — Implementation Plan

## Objective

Add standardized validation (lint + test + build) to all GCP Cloud Build pipelines across VisionKing, SpotFusion, and DieMaster, while respecting each product's existing GCP project, registry, and file placement conventions.

---

## Current State Summary

### Registry & Projects (unchanged per user decision)

| Product | GCP Project | Registry | Region |
|---------|-------------|----------|--------|
| VisionKing | `sis-surface` | `us-central1-docker.pkg.dev/sis-surface/sis-surface/` | us-central1 |
| SpotFusion | `spark-eyes` | `southamerica-east1-docker.pkg.dev/spark-eyes/spark-eyes/` | southamerica-east1 |
| DieMaster | `smart-die` | `southamerica-east1-docker.pkg.dev/smart-die/smart-die/` | southamerica-east1 |

> **Note**: DieMaster inference currently uses a different registry (`us-central1-docker.pkg.dev/strokmatic/strokmatic/`). As part of this work, it will be migrated to the standard DieMaster registry above for consistency.

### Cloudbuild File Locations

The **desired standard** is to place cloudbuild files inside `infra/gcp/` with separate subdirectories per environment, following the pattern already established by DM data-processing, frontend, and backend:

```
services/<name>/
└── infra/
    └── gcp/
        ├── develop/
        │   └── cloudbuild.yaml      # triggered on push to develop
        └── production/
            └── cloudbuild.yaml      # triggered on push to master/main
```

The two files are nearly identical — the only differences are:
- **Image name prefix**: `dev-<service-name>` for develop, `<service-name>` for production
- Any environment-specific build args or labels (e.g., `environment=development` vs `environment=production`)

Currently, most services still use a **root-level** `services/<name>/cloudbuild.yaml` single-file pattern. As part of this work, services that currently have only a root-level file will be migrated to the `infra/gcp/{develop,production}/` structure to enable per-branch triggers.

Note: DM backend uses `infra/glp/` (typo for `gcp`) — will be corrected as part of this work.

### Current Validation Coverage

- **0 out of ~50 services** have lint+test in Cloud Build (except DM frontend production)
- All pipelines are build-and-push only
- DieMaster backend has GitHub Actions CI separately (lint+test+dive) but not in Cloud Build

### Service Stacks

| Stack | Products | Validation Commands Available |
|-------|----------|-------------------------------|
| **Python** (pika/aio-pika pipeline services) | VK (11), DM (8), SF (16) | None configured — need ruff + pytest |
| **NestJS** (backend APIs) | VK (2), DM (1), SF (1) | `npm run lint:check`, `npm run test`, `npm run build` — ready |
| **Angular** (frontend SPAs) | VK (2), DM (1), SF (1) | `npm run lint`, `npm run test:ci`, `npm run build:prod` — ready |
| **C++** (acquisition/control) | VK (3), DM (0), SF (1) | No validation tooling — skip in Phase 1 |

---

## Design Decisions

1. **Keep existing GCP projects** — no consolidation
2. **Phased validation** — lint + test + build now; security scans (gitleaks, trivy) later
3. **Templates per-product monorepo root** — `ci/` directory in each product repo
4. **Standardize to `infra/gcp/{develop,production}/`** — migrate root-level cloudbuild files into the two-file structure. Each service gets a develop and production cloudbuild, with corresponding Cloud Build triggers per branch
5. **C++ services excluded** from Phase 1 (no test/lint tooling exists)

---

## Implementation Plan

### Phase 1: Python Linter Bootstrap (prerequisite)

**Goal**: Add `ruff` configuration to all Python services so lint steps have something to run.

**Steps**:

1. Create a shared `ruff.toml` in each product's monorepo root (`ci/ruff.toml`) with sensible defaults:
   ```toml
   [lint]
   select = ["E", "F", "W", "I"]  # pyflakes, pycodestyle, isort
   ignore = ["E501"]               # line length (legacy code)

   [format]
   quote-style = "double"
   ```

2. For each Python service, add a `pyproject.toml` (or extend existing) with:
   ```toml
   [tool.ruff]
   extend = "../../ci/ruff.toml"   # relative path to monorepo root
   ```

3. Validate: run `ruff check .` in each Python service directory to verify no blocking errors (fix or suppress as needed).

**Services affected**:
- VK: database-writer, image-saver, inference, pixel-to-object, defect-aggregator, result, length-measure, point-cloud-processor, sealer-bead-measurement, wifi-camera-acquisition, spark-test-controller
- SF: plc-monitor, get-data, data-processing, image-processing, data-enrichment, database-writer, database-cleanup, get-result, plc-result, default-module, module-a, get-image, tag-monitor, tag-monitor-siemens, tag-monitor-profinet, camera-acquisition
- DM: get-data, database-writer, data-processing, loader, connect, trigger, status, setting

**Estimated effort**: 2-3 hours (bulk of time is fixing/suppressing initial ruff errors)

---

### Phase 2: Cloud Build Templates

**Goal**: Create reusable Cloud Build step snippets per stack type in each product's `ci/` directory.

**Directory structure** (per product monorepo):
```
ci/
├── ruff.toml                        # shared Python lint config
├── templates/
│   ├── python-validate.yaml          # lint + test steps for Python services
│   ├── nestjs-validate.yaml          # lint + test + build steps for NestJS
│   ├── angular-validate.yaml         # lint + test + build steps for Angular
│   └── README.md                     # usage guide
```

**Estimated effort**: 1-2 hours

---

### Phase 3: Apply Validation Steps to Existing Cloudbuild Files

**Goal**: Prepend the appropriate validation steps to every existing `cloudbuild.yaml`, preserving the existing build+push steps.

**Strategy**: For each service:
1. Identify stack type (Python / NestJS / Angular / C++)
2. If C++ → skip (Phase 2 future work)
3. **Migrate to `infra/gcp/` structure**: If the service currently has a root-level `cloudbuild.yaml`, move it to `infra/gcp/production/cloudbuild.yaml` and create a `infra/gcp/develop/cloudbuild.yaml` variant with `dev-` image prefix
4. If the service already has `infra/gcp/` files, update in-place
5. Prepend the matching validation steps before the Docker build step
6. Ensure Docker build `waitFor` references the last validation step ID
7. Keep all existing build+push steps, tags, options, and timeout unchanged

**Rollout order** (safest first):
1. **DieMaster** (smallest, 14 files, backend already has GH Actions as safety net)
2. **SpotFusion** (medium, 22 files, all root-level — simpler)
3. **VisionKing** (largest, 16 files, mixed locations)

**Additional fixes during this phase**:
- Fix DM backend `infra/glp/` typo → rename to `infra/gcp/`
- Add `.gcloudignore` to services that lack it (exclude `tests/`, `docs/`, `*.md`, `.git/`)
- Standardize `timeout` values (currently range from 200s to 1200s — normalize per stack)

**Estimated effort**: 4-6 hours (bulk of the work — ~50 files to update)

---

### Phase 4: Verification & Documentation

**Goal**: Validate all updated pipelines and document the standard.

**Steps**:

1. **Dry-run validation**: For each updated `cloudbuild.yaml`, run YAML validation to catch syntax errors

2. **Test on one service per stack per product** (9 total):
   - VK: database-writer (Python), backend (NestJS), frontend (Angular)
   - SF: get-data (Python), backend (NestJS), frontend (Angular)
   - DM: get-data (Python), backend (NestJS), frontend (Angular)

3. **Create `ci/README.md`** per product documenting:
   - Template usage guide
   - How to add validation to a new service
   - Stack-specific notes (Chrome for Angular tests, pytest discovery, etc.)
   - How to run validation locally before pushing

4. **Update product backlogs**: Mark CICD-01 items as partially complete; add follow-up items for C++ services and security scans (Phase 2)

**Estimated effort**: 2-3 hours

---

### Phase 4b: Create Cloud Build Triggers

**Goal**: Create two Cloud Build triggers per service (develop + production) in each GCP project, pointed at the corresponding `infra/gcp/<env>/cloudbuild.yaml` file.

**Trigger naming convention**: `<service-name>-<env>` (e.g., `diemaster-data-processing-develop`, `diemaster-data-processing-production`)

**Per-product GCP project mapping**:

| Product | GCP Project | GitHub Owner |
|---------|-------------|--------------|
| DieMaster | `smart-die` | `strokmatic` |
| SpotFusion | `spark-eyes` | `strokmatic` |
| VisionKing | `sis-surface` | `strokmatic` |

**For each service, create two triggers using `gcloud`**:

```bash
# Develop trigger — fires on push to develop branch
gcloud builds triggers create github \
  --project=<gcp-project> \
  --name="<service-name>-develop" \
  --repo-name=<github-repo> \
  --repo-owner=strokmatic \
  --branch-pattern="^develop$" \
  --build-config="infra/gcp/develop/cloudbuild.yaml" \
  --description="Build <service-name> on develop push"

# Production trigger — fires on push to master branch
gcloud builds triggers create github \
  --project=<gcp-project> \
  --name="<service-name>-production" \
  --repo-name=<github-repo> \
  --repo-owner=strokmatic \
  --branch-pattern="^master$" \
  --build-config="infra/gcp/production/cloudbuild.yaml" \
  --description="Build <service-name> on master push"
```

**Steps**:

1. **Audit existing triggers**: For each GCP project, list current triggers to identify what already exists and avoid duplicates:
   ```bash
   gcloud builds triggers list --project=<gcp-project> --format="table(name,filename,github.push.branch)"
   ```

2. **Delete root-level triggers**: Services migrated from root `cloudbuild.yaml` to `infra/gcp/` will have stale triggers pointing at the old file path. Delete these before creating new ones:
   ```bash
   gcloud builds triggers delete <trigger-name> --project=<gcp-project>
   ```

3. **Create develop + production triggers**: Using the `gcloud` commands above, create both triggers per service. Batch this with a script per product to avoid manual repetition.

4. **Verify trigger connectivity**: After creation, confirm each trigger is connected to the correct GitHub repo and branch by listing triggers and cross-referencing:
   ```bash
   gcloud builds triggers list --project=<gcp-project> --format="table(name,filename,github.name,github.push.branch)"
   ```

5. **Test one trigger per product**: Push a no-op commit (e.g., whitespace change in a comment) to `develop` on one service per product and confirm the correct cloudbuild file is picked up.

**Service account requirements**: Each GCP project must have the Cloud Build service account (`<project-number>@cloudbuild.gserviceaccount.com`) with `roles/artifactregistry.writer` on the Artifact Registry repository. DieMaster already uses `deploy-assistant@smart-die.iam.gserviceaccount.com` — verify this is configured on all triggers via `--service-account`.

**Estimated effort**: 2-3 hours (scripted bulk creation + manual verification)

---

### Phase 5 (Future): Security Scans

Not in scope for this implementation, but documented for planning:

- **gitleaks**: Scan for secrets in committed code (pre-build step)
- **trivy**: Scan built Docker images for CVEs (post-build step)
- **Docker Slim / dive**: Analyze image efficiency
- Add as optional Cloud Build steps gated by substitution variable `_ENABLE_SECURITY_SCAN`

---

## Service Inventory (complete)

### VisionKing (16 cloudbuild files)

| Service | Stack | Current Location | Target Location | Has Tests | Action |
|---------|-------|-----------------|-----------------|-----------|--------|
| database-writer | Python | root (×2) | infra/gcp/{develop,production}/ | pytest in deps | Add lint+test + migrate |
| image-saver | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| inference | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| result | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| pixel-to-object | Python | infra/gcp/ (×2) | infra/gcp/{develop,production}/ | No | Add lint only (already in place) |
| length-measure | Python | infra/gcp/ | infra/gcp/{develop,production}/ | No | Add lint only (already in place) |
| camera-acquisition | C++ | root (×2) | infra/gcp/{develop,production}/ | No | Skip Phase 1 |
| controller | C++ | root | infra/gcp/{develop,production}/ | No | Skip Phase 1 |
| plc-monitor | C++ | root | infra/gcp/{develop,production}/ | No | Skip Phase 1 |
| plc-monitor-eip | C++ | root | infra/gcp/{develop,production}/ | No | Skip Phase 1 |
| storage-monitor | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| bd-sis-surface | NestJS | root | infra/gcp/{develop,production}/ | Jest ready | Add lint+test+build + migrate |
| visualizer | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |

### SpotFusion (22 cloudbuild files)

| Service | Stack | Current Location | Target Location | Has Tests | Action |
|---------|-------|-----------------|-----------------|-----------|--------|
| backend | NestJS | root | infra/gcp/{develop,production}/ | Jest ready | Add lint+test+build + migrate |
| frontend | Angular | root | infra/gcp/{develop,production}/ | Karma ready | Add lint+test+build + migrate |
| plc-monitor | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| get-data | Python | root (×2) | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| data-processing | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| image-processing | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| data-enrichment | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| database-writer | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| database-cleanup | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| get-result | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| plc-result | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| default-module | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| module-a | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| get-image | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| tag-monitor | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| tag-monitor-siemens | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| tag-monitor-profinet | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| camera-acquisition | C++/Python | root | infra/gcp/{develop,production}/ | No | Skip Phase 1 |
| device-controller | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| plc-monitor-camera | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| plc-monitor-camera-opener | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |

### DieMaster (14 cloudbuild files)

| Service | Stack | Current Location | Target Location | Has Tests | Action |
|---------|-------|-----------------|-----------------|-----------|--------|
| backend | NestJS | infra/glp/{develop,production}/ | infra/gcp/{develop,production}/ | Jest ready | Add lint+test+build + fix typo |
| frontend | Angular | infra/gcp/{develop,production}/ | infra/gcp/{develop,production}/ | Karma ready | Already has validation — verify |
| get-data | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| database-writer | Python | root | infra/gcp/{develop,production}/ | pytest in deps | Add lint+test + migrate |
| data-processing | Python | infra/gcp/{develop,production}/ | infra/gcp/{develop,production}/ | pytest ready | Already migrated — add validation |
| loader | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| connect | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| plc-monitor | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| trigger | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| status | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| setting | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate |
| inference | Python | root | infra/gcp/{develop,production}/ | No | Add lint only + migrate + migrate registry |

---

### Registry Migration: DieMaster Inference

The `diemaster-inference` service currently pushes to `us-central1-docker.pkg.dev/$PROJECT_ID/strokmatic/diemaster-inference:$SHORT_SHA`. This will be updated to match all other DieMaster services:

- **Registry**: `southamerica-east1-docker.pkg.dev/smart-die/smart-die/diemaster-inference:$COMMIT_SHA`
- **Tag convention**: `$COMMIT_SHA` (not `$SHORT_SHA`) for consistency with sibling services
- **File**: `services/inference/cloudbuild.yaml`

This is a one-line registry path change plus tag variable rename in the existing cloudbuild file.

---

## Effort Summary

| Phase | Description | Estimated Hours |
|-------|-------------|-----------------|
| 1 | Python linter bootstrap (ruff) | 2-3h |
| 2 | Cloud Build templates (`ci/`) | 1-2h |
| 3 | Apply validation to ~50 cloudbuild files + migrate to `infra/gcp/` | 4-6h |
| 4 | Verification & documentation | 2-3h |
| 4b | Create Cloud Build triggers (develop + production per service) | 2-3h |
| **Total** | | **11-17h** |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Ruff finds hundreds of errors in legacy Python | Use `--fix` for auto-fixable, `noqa` for the rest. Lenient initial ruleset (E, F, W only). |
| Cloud Build validation steps add build time | Validation steps run in parallel where possible (`waitFor`). Typical overhead: 30-60s. |
| Tests fail in Cloud Build but pass locally | Use same base images (`python:3.10-alpine`, `node:22-alpine`) for consistency. |
| Breaking a production pipeline | Rollout service-by-service. Test one per stack first. Keep `-dev` variants as canaries. |
| Angular tests need Chrome in alpine | Already solved in DM frontend template — `apk add chromium` in the test step. |
