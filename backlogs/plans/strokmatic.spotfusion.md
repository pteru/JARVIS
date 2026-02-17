# SpotFusion Backlog -- Detailed Implementation Plans

## Executive Summary

The SpotFusion codebase consists of 24+ microservices under `services/`, a data science training pipeline under `ds/`, and a configuration wizard under `toolkit/spotfusion-deploy-toolkit/app_wizard/`. The codebase has severe copy-paste duplication of utility modules, widespread hardcoded credentials (272 occurrences), pervasive unsafe `eval()` calls (153 occurrences), and no automated test infrastructure beyond ad-hoc files. There are 22 Cloud Build configurations that only build/push Docker images with zero test or security gates.

---

## HIGH PRIORITY

---

### SEC-01: Remove All Hardcoded Credentials

**Current State:**
- **272 occurrences** of hardcoded credentials found across the codebase (excluding `.venv/` directories):
  - `SparkEyes@@2022` -- Redis password, hardcoded in every `redis_read.py` and `redis_write.py` copy (line 8-9 in each file). Used as the default when no password parameter is provided.
  - `skm@@2022` -- Used for PostgreSQL, RabbitMQ, PgAdmin, and Redis in YAML deployment files.
- Credentials appear in:
  - Python source files (`Icache/redis_read.py`, `Icache/redis_write.py`) -- approximately 40+ copies across services
  - Docker Compose YAML files under `services/modified-setup/setup/deploy/` -- 50+ YAML files with passwords in environment variables
  - The `yml_generator_vision.py` script that generates YAML files with embedded passwords

**Scope of Work:**
1. Create a `.env.template` file with all credential placeholders
2. Modify all `redis_read.py` / `redis_write.py` instances to read password from environment variable (`os.environ.get('REDIS_PASSWORD')`) instead of hardcoding the default
3. Update all YAML deployment files to use `${VARIABLE}` syntax or Docker secrets
4. Update `yml_generator_vision.py` to emit environment variable references instead of literal passwords
5. Add `.env` to `.gitignore`
6. Run `git filter-branch` or `BFG Repo Cleaner` to scrub credentials from git history

**Repositories Involved:** spotfusion (monorepo)

**Testing Effort:**
- Verify each service starts with env-based credentials: 1 integration test per service pattern (approximately 5 unique patterns)
- Verify YAML generation produces correct variable references: 3 unit tests
- **Estimated test cases: 8**

**Testing Infrastructure:** No test framework currently exists in services. Tests would be manual Docker-based smoke tests initially.

**Dependencies:** Should be done BEFORE QUAL-01 (consolidation), since credentials will be centralized. Independent of other tasks.

**Hours Estimate: 16 hours**

---

### SEC-02: Replace All eval() Calls with Safe Alternatives

**Current State:**
- **153 eval() occurrences** in service Python files (excluding `.venv/`).
- Three distinct usage patterns:
  1. **Redis data deserialization** (`redis_read.py` line 18): `df[key] = eval(value.decode())` -- appears in every copy of `Icache/redis_read.py` (approximately 30 copies). Used to reconstruct Python objects from Redis string values. Fix: use `json.loads()` or `ast.literal_eval()`.
  2. **Log record construction** (`log.py` lines 26, 32): `record = eval(str('{' + record + '}'))` and `level = eval(self.READER.read_hkey('level'))`. Fix: use `json.loads()` or `ast.literal_eval()`.
  3. **Service-level eval for PLC data** (e.g., `get-image.py` lines 96, 185, 189, 197, 212, 217, 223, 229, 235, 240, 251, 258, 269, 338; `data-enrichment.py` lines 86, 117, 166, 190; `plc-monitor.py` lines 50, 54; `get-result.py` lines 83, 89, 94; `tag-monitor-class1.py` line 40; `module-a.py` line 33). These parse Redis string values like `\"True\"`, `\"False\"`, integers, lists, and dicts. Fix: `ast.literal_eval()` for data, `json.loads()` for structured data, explicit type casting for booleans/integers.

**Scope of Work:**
1. Replace all `eval(value.decode())` in redis_read.py copies with `ast.literal_eval(value.decode())`
2. Replace `eval(str('{' + record + '}'))` in log.py with `json.loads('{' + record + '}')`
3. Replace all service-level `eval()` calls with `ast.literal_eval()` or `json.loads()` depending on data format
4. Add `import ast` and `import json` where needed
5. Ensure Redis writers serialize data as JSON if not already

**Repositories Involved:** spotfusion (monorepo)

**Testing Effort:**
- Unit test for each replacement pattern (3 patterns x 2-3 cases each)
- Integration smoke test for 3 representative services
- **Estimated test cases: 12**

**Testing Infrastructure:** None. Would require setting up a basic pytest configuration.

**Dependencies:** Best done AFTER QUAL-01 so changes only need to be made once in the shared library. If done before QUAL-01, changes must be applied to all 30+ copies.

**Hours Estimate: 20 hours** (if before QUAL-01) / **6 hours** (if after QUAL-01)

---

### SEC-03: Fix Bare Except Clauses

**Current State:**
- **25 bare `except:` clauses** in first-party code (excluding `.venv/` and vendored `pylogix/` library).
- **120 additional** in vendored `pylogix/` copies (third-party, lower priority).
- All first-party occurrences are in `log.py` copies (line 33 in each): `except:` after `eval(self.READER.read_hkey('level'))`. This silently swallows `SystemExit`, `KeyboardInterrupt`, and all other exceptions, defaulting log level to `'DEBUG'`.

**Scope of Work:**
1. Replace all `except:` with `except Exception:` in first-party `log.py` files (approximately 15 copies)
2. For pylogix copies: evaluate whether these are unchanged vendored copies; if so, mark as known third-party debt

**Repositories Involved:** spotfusion (monorepo)

**Testing Effort:**
- Verify services start correctly after change: manual smoke test per unique service
- Unit test that `KeyboardInterrupt` propagates
- **Estimated test cases: 4**

**Testing Infrastructure:** None.

**Dependencies:** Best done alongside or after QUAL-01.

**Hours Estimate: 4 hours** (if before QUAL-01) / **1 hour** (if after QUAL-01)

---

### TEST-01: Establish Automated Test Framework and CI Test Gates

**Current State:**
- 6 ad-hoc test files in `tests/` directory: `crop_visualizer.py`, `get_db_data.py`, `tags_record.py`, `tags_viewer.ipynb`, `test_plc.py`, `yml_generator.py`. None use pytest. No `conftest.py`, no `pytest.ini`.
- The config wizard (`app_wizard/backend/`) has proper pytest tests: `test_validator.py` (12 test cases) and `test_serializer.py` (12 test cases). These are well-structured with fixtures and assertions.
- 22 Cloud Build configurations (`cloudbuild.yaml`) across services -- all follow the identical pattern: `git submodule update`, `docker build`, `docker push`. Zero test steps.

**Scope of Work:**
1. Create root-level `pytest.ini` or `pyproject.toml` with pytest configuration
2. Create `conftest.py` with shared fixtures (Redis mock, RabbitMQ mock)
3. Convert existing ad-hoc test files to pytest format
4. Add pytest step to each `cloudbuild.yaml` before the build step
5. Create a reusable Cloud Build include for test execution
6. Add minimum code coverage gates (suggest 30% initial threshold)

**Repositories Involved:** spotfusion (monorepo)

**Testing Effort:**
- Meta-task: this IS the testing infrastructure
- Initial test suite: migrate 6 existing files + 24 existing wizard tests
- **Estimated test cases to create: 20 (conversions) + framework setup**

**Testing Infrastructure:** This task CREATES the infrastructure.

**Dependencies:** None. Should be done early to support all other tasks.

**Hours Estimate: 24 hours**

---

### QUAL-01: Consolidate Duplicated Utility Modules into Shared Library

**Current State:**
Exact copy counts from the codebase:

| Module | Distinct Copies Found | Files per Copy | Key Files |
|--------|----------------------|----------------|-----------|\n| **Icache** | 30+ directories | 3 files each (`__init__.py`, `redis_read.py`, `redis_write.py`) | ~90 files total |
| **Ilog** | 15+ directories | 2-3 files each (`__init__.py`, `log.py`, + nested Icache) | ~60 files total |
| **Ibroker** | 9 directories | 2 files each (`__init__.py`, `message_broker.py`) | 18 files total |
| **Ineural** | 2 directories (module-a, default-module) | 2-3 files each | 5 files total |

The copies are deeply nested: some services have `utils/Ilog/utils/Icache/` (Ilog contains its own Icache copy), and some also have `utils/Iplc/utils/Ilog/utils/Icache/` (three levels deep). This means a single service like `tag-monitor` has 5+ copies of `redis_read.py`.

The canonical implementation is identical across all copies:
- `redis_read.py`: 39 lines, `reader` class with Redis hash operations
- `redis_write.py`: similar structure, `writer` class
- `log.py`: 54 lines, `log` class wrapping loguru with Redis-based log storage
- `message_broker.py`: 118 lines, `communicator` class wrapping pika for RabbitMQ

**Scope of Work:**
1. Create a `libs/spotfusion-common/` Python package with:
   - `spotfusion_common/cache/redis_read.py`
   - `spotfusion_common/cache/redis_write.py`
   - `spotfusion_common/log/log.py`
   - `spotfusion_common/broker/message_broker.py`
   - `spotfusion_common/neural/neural_network.py`
2. Publish as a pip-installable local package (or use relative path in Docker builds)
3. Update all service Dockerfiles to install the shared package
4. Update all service imports from `from utils.Icache.redis_read import reader` to `from spotfusion_common.cache.redis_read import reader`
5. Remove all duplicated `utils/Ilog/`, `utils/Icache/`, `utils/Ibroker/`, `utils/Ineural/` directories
6. Update docker-compose volume mounts if the shared lib is mounted

**Repositories Involved:** spotfusion (monorepo), affects 15+ services

**Testing Effort:**
- Unit tests for each module in the shared library: 5 test files
- Integration test that each service starts correctly with the shared lib
- **Estimated test cases: 25**

**Testing Infrastructure:** Requires TEST-01 to be done first (or at least a basic pytest setup).

**Dependencies:** TEST-01 (for test framework). SEC-01, SEC-02, SEC-03 can be done either before (on duplicated files) or after (once on the shared lib). Strongly recommended to do AFTER -- fixes only need to be applied once.

**Hours Estimate: 32 hours**

---

### QUAL-02: Fix Directory Naming Typo (camera-acquisiiton)

**Current State:**
- The directory is actually named `camera-acquisition` (correct spelling). Grep for `camera-acquisiiton` returns zero results. This task may have already been completed, or the backlog description may refer to a different context (e.g., a docker-compose reference or CI file that has since been fixed).
- The current directory at `services/camera-acquisition/` exists with correct spelling.

**Scope of Work:**
1. Verify the typo no longer exists anywhere in the codebase
2. If found in any branch or deployment config, rename and update references
3. Close task if already resolved

**Repositories Involved:** spotfusion

**Testing Effort:** Grep verification only. **Estimated test cases: 0**

**Dependencies:** None.

**Hours Estimate: 1 hour** (verification only)

---

### GIT-01: Fix Upstream Tracking and Establish Branch Strategy

**Current State:**
- Repository has only 2 commits on master. 23+ untracked directories suggest these may be submodules or independent repos that were copied in.
- No branch protection rules visible.

**Scope of Work:**
1. Set up proper remote tracking (`git remote set-url origin ...`)
2. Establish branching strategy: `main` (production), `develop` (integration), `feat/*`, `fix/*` branches
3. Configure `.gitmodules` for proper submodule tracking if submodules are used
4. Add branch protection rules on `main` and `develop`
5. Create initial tagged release

**Repositories Involved:** spotfusion

**Testing Effort:** Manual verification. **Estimated test cases: 0**

**Dependencies:** None. Can be done anytime.

**Hours Estimate: 8 hours**

---

### CICD-01: Add Testing and Security Scanning to Cloud Build

**Current State:**
- 22 `cloudbuild.yaml` files, all identical pattern:
  1. `git submodule update --init --recursive`
  2. `docker build` with commit SHA tag
  3. `docker build` with `latest` tag
  4. `docker push` (SHA tag)
  5. `docker push` (latest tag)
- No test steps, no security scanning, no linting.
- Build timeout: 200s, machine: E2_MEDIUM.

**Scope of Work:**
1. Create a shared Cloud Build template or include file
2. Add a pytest execution step (requires TEST-01)
3. Add `bandit` static security scan step
4. Add `trivy` container image vulnerability scan step
5. Add build failure on test/scan failures
6. Update all 22 cloudbuild.yaml files

**Repositories Involved:** spotfusion

**Testing Effort:**
- Verify CI pipeline runs correctly: 1 test per changed service
- **Estimated test cases: 3 (pipeline validation)**

**Dependencies:** TEST-01 (for pytest step to have tests to run).

**Hours Estimate: 12 hours**

---

### DOC-01: Create Root-Level README and Architecture Documentation

**Current State:**
- No root-level README. The `architecture/` directory exists but is empty/unused.
- The only README is in `tests/README.md` and `toolkit/spotfusion-deploy-toolkit/README.md`.

**Scope of Work:**
1. Create root `README.md` with project overview, service list, quickstart
2. Create `architecture/ARCHITECTURE.md` with system diagram (Mermaid)
3. Document message flow: PLC -> Redis -> RabbitMQ -> services
4. Document data flow: camera -> image-processing -> neural network -> result

**Repositories Involved:** spotfusion

**Testing Effort:** None. **Estimated test cases: 0**

**Dependencies:** None.

**Hours Estimate: 8 hours**

---

### DOC-02: Create Deployment and Onboarding Documentation

**Current State:**
- No setup guide exists. ZeroTier VPN configuration is scattered across various YAML files.
- The wizard README provides Docker setup only for the wizard itself.

**Scope of Work:**
1. Create `doc/DEPLOYMENT.md` with full deployment guide
2. Create `doc/ONBOARDING.md` with developer setup instructions
3. Document ZeroTier VPN configuration
4. Create troubleshooting guide

**Repositories Involved:** spotfusion

**Testing Effort:** None. **Estimated test cases: 0**

**Dependencies:** None.

**Hours Estimate: 8 hours**

---

## MEDIUM PRIORITY

---

### OPT-01: Clean Repository (venvs, pycache, large artifacts)

**Current State:**
- Repository is 42 GB. Contains `.venv/` directories inside services (e.g., `services/default-module/.venv/` with full TensorFlow installation). Contains `__pycache__/` and `.pyc` files.
- Only 2 `requirements.txt` files found in services (`get-data/` and `camera-acquisition/utils/genicam-skm/`). The `get-data/requirements.txt` alone has 127 dependencies including PyTorch, TensorFlow, LangChain, and NVIDIA CUDA libraries.

**Scope of Work:**
1. Add comprehensive `.gitignore` (venvs, pycache, .pyc, model weights, etc.)
2. Remove all `.venv/` directories from tracking
3. Remove all `__pycache__/` directories
4. Use `git filter-branch` or BFG to remove large binary artifacts from history
5. Create `requirements.txt` for services that lack them (frozen from their venvs)
6. Document venv creation in each service README

**Repositories Involved:** spotfusion

**Testing Effort:** Verify services still build after cleanup. **Estimated test cases: 3**

**Dependencies:** None, but coordinate with SEC-01 (credential scrubbing from history).

**Hours Estimate: 12 hours**

---

### OPT-02: Replace Blocking I/O with Async Patterns

**Current State:**
- All services use synchronous I/O with `time.sleep()` polling loops. The `message_broker.py` uses `pika.BlockingConnection`. Redis clients use synchronous `redis.Redis`.
- No connection pooling.

**Scope of Work:**
1. Replace `pika.BlockingConnection` with `aio-pika` (async RabbitMQ)
2. Replace `redis.Redis` with `redis.asyncio.Redis`
3. Replace `time.sleep()` loops with async event-driven patterns
4. Add connection pooling for Redis and RabbitMQ

**Repositories Involved:** spotfusion (shared lib after QUAL-01)

**Testing Effort:** Performance benchmarks + functional tests for each converted service. **Estimated test cases: 15**

**Dependencies:** QUAL-01 (do once in shared lib).

**Hours Estimate: 40 hours**

---

### INFRA-01: Add Docker Healthchecks and Service Dependencies

**Current State:**
- The wizard `docker-compose.yml` has a proper healthcheck. Zero other services have healthchecks.
- All service compose files use `privileged: true` instead of `depends_on` with health conditions.

**Scope of Work:**
1. Add healthcheck to each service docker-compose YAML (approximately 20 files)
2. Implement real health check endpoints in services (HTTP or TCP based)
3. Add `depends_on` with `condition: service_healthy` for dependent services
4. Fix `plc_connector.py:122` TODO that always returns True

**Repositories Involved:** spotfusion

**Testing Effort:** Verify each service reports health correctly. **Estimated test cases: 10**

**Dependencies:** None.

**Hours Estimate: 16 hours**

---

### INFRA-02: Implement Centralized Logging and Monitoring

**Current State:**
- Custom `Ilog` class writes logs to Redis hashes with TTL. No log aggregation, no metrics, no tracing. Log level is controlled via Redis key.

**Scope of Work:**
1. Deploy an ELK/EFK stack or Loki+Grafana
2. Modify shared Ilog to emit structured JSON logs to stdout (Docker logging driver picks them up)
3. Add Prometheus metrics endpoints to services
4. Add Grafana dashboards

**Repositories Involved:** spotfusion, infra/deployment configs

**Testing Effort:** Verify log ingestion and dashboard display. **Estimated test cases: 5**

**Dependencies:** QUAL-01 (centralize Ilog first).

**Hours Estimate: 32 hours**

---

### QUAL-03: Add Input Validation for PLC and Camera Parameters

**Current State:**
- PLC tags, camera settings, and Redis data are consumed via `eval()` with no validation. Environment variables are read with `os.environ.get()` and used directly without type checking.

**Scope of Work:**
1. Define Pydantic models for PLC data structures
2. Add validation decorators/functions for Redis data reads
3. Add environment variable validation at startup (fail fast with clear error)
4. Add camera parameter bounds checking

**Repositories Involved:** spotfusion (shared lib after QUAL-01)

**Testing Effort:** Unit tests for each validation model. **Estimated test cases: 20**

**Dependencies:** QUAL-01 and SEC-02.

**Hours Estimate: 20 hours**

---

### DS-01: Resolve Data Science TODOs and Stabilize Training

**Current State:**
- Searched for `TODO/FIXME/HACK` in `ds/spotfusion-ds-training/chisel-gm/search_model.py` -- zero matches found. The backlog mentions 11 TODOs but they may have been resolved or are in other files.
- The `ds/` directory contains 4 training pipelines: `chisel-gm`, `chisel-matheus`, `nugget-diameter`, `sheet-counter`, `thickness`.
- Each has its own `src/` with `model/`, `preprocessor/`, `Optmization/`, `Utils/` directories.

**Scope of Work:**
1. Audit all TODOs across the ds/ directory
2. Fix configuration management (likely hardcoded paths and parameters)
3. Add data augmentation pipelines if missing
4. Standardize experiment tracking (ClearML is partially integrated)

**Repositories Involved:** spotfusion/ds

**Testing Effort:** Model training validation runs. **Estimated test cases: 10**

**Dependencies:** None (independent from services).

**Hours Estimate: 24 hours**

---

## PRODUCT FEATURES

---

### FEAT-01: Finish and Deploy Config-Wizard

**Current State:**
The config-wizard at `toolkit/spotfusion-deploy-toolkit/app_wizard/` is the most mature component in the codebase:

**Backend** (`app_wizard/backend/app/`):
- **Framework:** FastAPI with SQLAlchemy ORM + Pydantic schemas
- **Files:** `main.py`, `database.py`, `schemas.py`, `models/orm.py`, `models/yaml_schema.py`, `routers/projects.py`, `routers/visualization.py`, `services/serializer.py`, `services/validator.py`, `services/exporter.py`, `services/graph_builder.py`
- **Features implemented:** RESTful CRUD for projects, snapshot versioning, SSOT YAML export, state validation (cross-referential integrity checks), graph/flow visualization
- **Test coverage:** 24 tests across `test_validator.py` (12 tests) and `test_serializer.py` (12 tests). Well-structured with fixtures.
- **Docker:** Dockerfile exists, healthcheck configured

**Frontend** (`app_wizard/frontend/src/`):
- **Framework:** Vue 3 + Vite + Pinia
- **Views:** `DashboardView.vue`, `WizardView.vue`, `ViewerView.vue`
- **Wizard Steps (7):** `StepLines.vue`, `StepHierarchy.vue` (areas), `StepStations.vue`, `StepDevices.vue` (PLCs/DAQs/edge panels/cameras), `StepProducts.vue` + `StepPanels.vue` + `StepStackups.vue`, `StepWeldProcess.vue` + `StepProcessFlow.vue`, `StepInspection.vue` + `StepNetwork.vue`
- **Viewer:** `ProductionFlowTab.vue`, `PLCNetworkTab.vue`, `CameraCoverageTab.vue`, `MetricsTab.vue`, `GraphControls.vue`, `NodeDetailsPanel.vue`
- **Custom components:** `DataGrid.vue`, `MultiSelect.vue`, `TagsInput.vue`, `OrderedTagsInput.vue`

**Docker Compose:** Both services orchestrated, backend on port 8102, frontend on port 8103. Backend has healthcheck.

**What is missing / needs finishing:**
1. No E2E tests for the frontend
2. CORS origins are hardcoded to `localhost` only -- production deployment needs real hostnames
3. No production deployment configuration (Kubernetes manifests, Cloud Run, etc.)
4. No authentication/authorization
5. No CI/CD pipeline for the wizard (no `cloudbuild.yaml`)
6. Frontend serves static via Nginx in production but `frontend_dist` path mount in `main.py` suggests an alternative static serving mode
7. The `app_viewer/` (legacy viewer) integration with the wizard is unclear

**Scope of Work:**
1. Add production CORS configuration via environment variable
2. Create `cloudbuild.yaml` for wizard deployment
3. Add E2E tests (Cypress or Playwright) for critical wizard flows
4. Add authentication layer (OAuth2 or simple API key)
5. Create Kubernetes/Cloud Run deployment manifests
6. Test all 7 wizard steps end-to-end with YAML export verification
7. Integrate with the legacy `app_viewer` or fully replace it

**Repositories Involved:** spotfusion-deploy-toolkit (subtree of spotfusion)

**Testing Effort:**
- Backend: add API integration tests (currently only unit tests for validator/serializer): 15 tests
- Frontend: E2E tests for each wizard step: 7 tests
- YAML export round-trip: 5 tests
- **Estimated test cases: 27**

**Testing Infrastructure:** Backend has pytest (working). Frontend needs Vitest/Cypress setup.

**Dependencies:** None (self-contained). DOC-02 should reference the wizard.

**Hours Estimate: 40 hours**

---

## LOW PRIORITY

---

### TOOL-01: Document and Improve Toolkit Utilities

**Current State:**
- 7 toolkit directories: `data-scraping`, `plant-data-parser`, `server-installer`, `spotfusion-deploy-toolkit`, `spotfusion-smartcam-toolkit`, `spotfusion-toolkit`, `vision-installer`. Only `spotfusion-deploy-toolkit` has a README.

**Scope of Work:**
1. Add README.md to each of the 6 undocumented toolkit directories
2. Add input validation to toolkit scripts
3. Add usage examples

**Repositories Involved:** spotfusion/toolkit

**Testing Effort:** **Estimated test cases: 6**

**Dependencies:** None.

**Hours Estimate: 8 hours**

---

### INFRA-03: Remove Privileged Container Mode Where Unnecessary

**Current State:**
- 20+ docker-compose YAML files contain `privileged: true`. These include services like `data-processing`, `database-writer`, `get-data`, and others that likely do not need privileged access. Services like `camera-acquisition` (which accesses USB/GenICam devices) may legitimately need `--device` access.

**Scope of Work:**
1. Audit each privileged service for actual device/kernel needs
2. Replace `privileged: true` with specific `--device` or `--cap-add` flags
3. Only keep privileged for services requiring raw hardware access (camera, PLC)

**Repositories Involved:** spotfusion

**Testing Effort:** Verify each service starts and functions correctly without privileged mode. **Estimated test cases: 10**

**Dependencies:** None.

**Hours Estimate: 8 hours**

---

### QUAL-04: Pin All Python Dependency Versions

**Current State:**
- Only 2 `requirements.txt` files found in services: `get-data/requirements.txt` (127 pinned deps) and `camera-acquisition/utils/genicam-skm/requirements.txt`.
- Most services lack `requirements.txt` entirely and rely on pre-built Docker images or `.venv/` directories committed to the repo.

**Scope of Work:**
1. Generate `requirements.txt` from each service's `.venv/` (before OPT-01 removes them)
2. Add `pip-audit` step to CI
3. Create `requirements-dev.txt` with test dependencies

**Repositories Involved:** spotfusion

**Testing Effort:** Verify Docker builds succeed with pinned versions. **Estimated test cases: 5**

**Dependencies:** Should be done BEFORE OPT-01 (which removes the venvs).

**Hours Estimate: 8 hours**

---

## Summary Estimates Table

| Task ID | Priority | Complexity | Hours | Dependencies | Key Metric |
|---------|----------|-----------|-------|--------------|------------|
| SEC-01 | High | Complex | 16 | None | 272 credential occurrences |
| SEC-02 | High | Complex | 20 (or 6 after QUAL-01) | QUAL-01 recommended | 153 eval() calls |
| SEC-03 | High | Complex | 4 (or 1 after QUAL-01) | QUAL-01 recommended | 25 bare except (first-party) |
| TEST-01 | High | Complex | 24 | None | 0 CI test gates -> 22 |
| QUAL-01 | High | Complex | 32 | TEST-01 | 170+ duplicated files |
| QUAL-02 | High | Simple | 1 | None | Likely already fixed |
| GIT-01 | High | Medium | 8 | None | 2 commits, no branches |
| CICD-01 | High | Medium | 12 | TEST-01 | 22 cloudbuild files |
| DOC-01 | High | Medium | 8 | None | 0 READMEs at root |
| DOC-02 | High | Medium | 8 | None | 0 deployment docs |
| OPT-01 | Medium | Medium | 12 | QUAL-04 first | 42 GB -> target <2 GB |
| OPT-02 | Medium | Medium | 40 | QUAL-01 | All services sync I/O |
| INFRA-01 | Medium | Medium | 16 | None | 0 healthchecks in services |
| INFRA-02 | Medium | Medium | 32 | QUAL-01 | 0 centralized logging |
| QUAL-03 | Medium | Medium | 20 | QUAL-01, SEC-02 | 0 validation |
| DS-01 | Medium | Complex | 24 | None | 5 training pipelines |
| FEAT-01 | Feature | Complex | 40 | None | Wizard 80% complete |
| TOOL-01 | Low | Simple | 8 | None | 6 dirs undocumented |
| INFRA-03 | Low | Simple | 8 | None | 20+ privileged containers |
| QUAL-04 | Low | Simple | 8 | Before OPT-01 | 2 of 24 services have reqs |
| **TOTAL** | | | **~331 hours** | | |

## Recommended Execution Order

1. **Phase 1 -- Foundation (48h):** TEST-01 + QUAL-04 + GIT-01
2. **Phase 2 -- Security (20h):** SEC-01 (must be before any public deployment)
3. **Phase 3 -- Consolidation (32h):** QUAL-01 (unlocks cheaper SEC-02, SEC-03, OPT-02, INFRA-02, QUAL-03)
4. **Phase 4 -- Security Cleanup (8h):** SEC-02 + SEC-03 (now on shared lib only)
5. **Phase 5 -- CI/CD + Infra (28h):** CICD-01 + INFRA-01
6. **Phase 6 -- Feature (40h):** FEAT-01 (config wizard)
7. **Phase 7 -- Docs + Cleanup (29h):** DOC-01 + DOC-02 + OPT-01 + QUAL-02
8. **Phase 8 -- Performance (60h):** OPT-02 + INFRA-02 + QUAL-03
9. **Phase 9 -- Low Priority (40h):** DS-01 + TOOL-01 + INFRA-03
