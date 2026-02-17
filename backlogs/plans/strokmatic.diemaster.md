# DieMaster Implementation Plans -- Deep Dive Analysis

## System Architecture Overview

The DieMaster system is an industrial IoT platform for monitoring stamping dies. The data flow is:

```
Firmware (Hub/Switch) --> get-data (binary decode + Redis/RabbitMQ) --> data-processing (sensor math) --> database-writer (PostgreSQL via stored function) --> backend (NestJS REST API) --> frontend (Angular)
```

**Infrastructure**: PostgreSQL, RabbitMQ (message broker), KeyDB/Redis (cache + state), Docker Compose, GCP Cloud Build.

**Two codebases coexist**: `services/` (active, refactored) and `legacy/smart-die/` (original Dash/Python monolith).

---

## HIGH PRIORITY TASKS

### SEC-01: Remove Hardcoded Credentials from Entire Codebase

**Current State**: 35 files contain hardcoded passwords. Credentials found:
- `SmartDie@@2022` -- Redis password, RabbitMQ password (in services/connect, data-processing, get-data, loader, status, trigger, plc-monitor, firmware-switch, firmware-hub, infra-setup YAMLs, legacy code, toolkit)
- `skm@@2022` -- WiFi password in `firmware/firmware-switch/src/main.cpp`, RabbitMQ in `services/database-writer/.env`, legacy compose files
- `writer@@2022` -- DB password in `services/database-writer/.env`
- GCP service account JSON: `/home/teruel/JARVIS/workspaces/strokmatic/diemaster/smart-die-4f1b2a81536c.json` (2.3KB, in repo root)

**Scope of Work**:
1. Replace all hardcoded env defaults in Python services with empty strings or raise-on-missing patterns
2. Create `.env.example` templates for each service
3. For firmware (C/C++), move credentials to a `secrets.h` file excluded via `.gitignore`, or use build-time defines
4. Delete GCP JSON from repo, add to `.gitignore`, rotate the key in GCP console
5. Update all Docker Compose and cloudbuild YAML files to use environment variable references
6. Add `.env` and `*secrets*` patterns to root `.gitignore`

**Repositories Involved**: All 14 service repos, both firmware repos, legacy/smart-die, infra-setup, toolkit, repo root

**Testing Effort**: Manual verification that services start with env vars provided. 1 smoke test per service = ~14 tests. No automated tests needed beyond that.

**Testing Infrastructure**: None exists for this. Manual docker-compose up with `.env` file.

**Dependencies**: None (can be done independently). Should be done first as it touches all repos.

**Hours Estimate**: 12 hours

---

### SEC-02: Remove eval() Usage in redis_handlers.py

**Current State**: `eval()` is called in 6 distinct files across legacy code, all in the pattern `eval(value.decode())` for Redis deserialization. Additionally, `eval()` is used extensively in `legacy/smart-die/dashboard/src/app.py` (15+ occurrences) and in processing/enrichment/setup modules.

Total eval() occurrences: ~40 across legacy codebase.

**Scope of Work**:
1. Replace `eval(value.decode())` with `json.loads(value.decode())` in all 4 copies of `redis_handlers.py` (connection, enrichment, processing, dashboard, setup)
2. Replace `eval()` in `dashboard/src/app.py` (~15 occurrences) with `json.loads()` or `ast.literal_eval()`
3. Replace `eval()` in `setup/src/utils/sensor_config.py`, `SQLreader.py` (2 copies), `sensor_map_builder.py` (2 copies)
4. Replace `eval()` in `enrichment/src/enrich_consumer.py`, `enrich_data.py`, `database/src/WriteData.py`

**Repositories Involved**: `legacy/smart-die/` only

**Testing Effort**: 8 unit tests -- one per replaced file verifying JSON deserialization equivalence. Need to test with actual Redis data samples (from `dashboard/data/` JSON/CSV files).

**Testing Infrastructure**: No tests exist in legacy. Would need to add pytest to each legacy service.

**Dependencies**: None.

**Hours Estimate**: 8 hours

---

### FW-01: Test and Stabilize Firmware Implementations

**Current State**:
- `firmware-hub/src/app.c` (994 lines): MPLAB Harmony-based PIC32/SAM firmware. State machine with TCP/IP client, MQTT task, debug server. Line 814: `default: /* TODO: Handle error in application's state machine. */` -- falls through silently on unknown state. Error state (line 808): `while(1);` -- infinite loop, no recovery or watchdog kick.
- `firmware-switch/src/main.cpp` (~500+ lines): ESP32 with W5500 Ethernet, WiFi, Redis client. Hardcoded IP `192.168.15.94`, hostname `switch_93309290`.
- Both have hardcoded Redis/MQTT credentials and IP addresses.
- No unit test framework exists for either firmware.

**Scope of Work**:
1. Add error handling in `app.c` default case (log + reset state to init or safe state)
2. Replace `while(1)` in error state with watchdog reset or exponential backoff reconnect
3. Audit all firmware state transitions for unhandled edge cases
4. Add configurable parameters (IP addresses, credentials) via build defines or NVS (for ESP32)
5. Create hardware abstraction layer (HAL) for testable logic separation

**Repositories Involved**: `firmware/firmware-hub/`, `firmware/firmware-switch/`

**Testing Effort**: Firmware testing requires physical hardware or emulators. Estimated 10 test scenarios for hub state machine, 8 for switch. Would need Unity test framework for C or PlatformIO test runner for ESP32.

**Testing Infrastructure**: `firmware-switch/test/README` exists (PlatformIO placeholder). No actual tests. Would need to set up PlatformIO test runner for switch; MPLAB X test harness or Unity for hub.

**Dependencies**: Requires physical hardware or QEMU-based emulation. Should be done after SEC-01 (credential cleanup).

**Hours Estimate**: 40 hours

---

### TEST-01: Add Automated Test Suites Across All Services

**Current State**:
- **backend**: Jest configured (`jest.config.ts`), 4 spec files exist: `auth.controller.spec.ts`, `auth.service.spec.ts`, `user.service.spec.ts`, `app.e2e-spec.ts`. CI runs `yarn test:core` (only `src/core/parsing/__tests__/` -- 3 spec files for boolean/numeric/url parsing).
- **database-writer**: 1 pytest file (`parsing_test.py`) with 4 test functions, ~10 parametrized cases. Excellent coverage of parsing module.
- **All other services** (connect, data-processing, get-data, loader, setting, plc-monitor, status, trigger): Zero tests. No test framework configured.
- **frontend**: Angular default spec files exist (7 `.spec.ts` files) but are likely default scaffolds.
- **legacy**: Zero tests.

**Scope of Work**:
1. Add pytest + fixtures for each Python service (connect, data-processing, get-data, loader, plc-monitor, status, trigger)
2. For each Python service, test: message parsing, Redis read/write, RabbitMQ publish, error handling
3. Extend backend Jest tests: production service (currently 0 tests), sensor CRUD, panel CRUD, batch operations
4. Frontend: verify Angular Karma/Jasmine runs, add service-level tests
5. Target: 70% code coverage for critical path (get-data decode, data-processing math, database-writer parsing)

**Repositories Involved**: All 14 service repos, frontend

**Testing Effort**: ~120 test cases total:
| Service | Est. Tests |
|---------|-----------|
| get-data (binary decode) | 20 |
| data-processing (DRAWIN/GAP math) | 15 |
| database-writer (expand existing) | 10 |
| connect (network scan mock) | 8 |
| backend (production service) | 25 |
| backend (auth, user) | 15 |
| frontend (services/components) | 20 |
| Other Python services | 7 |

**Testing Infrastructure**: Backend has Jest + CI (GitHub Actions). Python services: need pytest + pytest-mock + pytest-cov added to each `*.req` file. No CI for Python services.

**Dependencies**: Depends on SEC-01 (credentials need to be in env vars for test configs). FEAT-02 (mock data) would accelerate this significantly.

**Hours Estimate**: 48 hours

---

### QUAL-01: Fix Bare Except Clauses Across Legacy Codebase

**Current State**: 7 bare `except:` clauses found in:
- `legacy/smart-die/setup/src/utils/sensor_config.py:34`
- `legacy/smart-die/dashboard/src/app.py:1019, 1045, 1112, 1145`
- `legacy/smart-die/application/processing/src/drawin_features.py:114, 139`

**Scope of Work**: Replace each bare `except:` with specific exception types (`except (ValueError, KeyError) as e:`) and add logging.

**Repositories Involved**: `legacy/smart-die/` only

**Testing Effort**: 3 test cases verifying error handling behavior. Minimal.

**Dependencies**: None.

**Hours Estimate**: 2 hours

---

### QUAL-02: Deduplicate format.py Across Legacy Services

**Current State**: `format.py` exists in 3 locations:
- `legacy/smart-die/dashboard/src/format.py`
- `legacy/smart-die/application/enrichment/src/format.py`
- `legacy/smart-die/setup/src/utils/format.py`

**Scope of Work**:
1. Diff the 3 files to confirm they are identical
2. Extract to a shared library (e.g., `legacy/smart-die/libs/format.py`)
3. Update imports in dashboard, enrichment, and setup
4. Update Dockerfiles to COPY the shared lib

**Repositories Involved**: `legacy/smart-die/`

**Testing Effort**: 2 tests -- import verification and functional equivalence.

**Dependencies**: None.

**Hours Estimate**: 3 hours

---

### GIT-01: Resolve Unmerged Feature Branches and Stale Work

**Current State**: Backlog mentions 8 unmerged legacy branches, 2 stalled firmware README branches. Cannot verify without accessing remotes.

**Scope of Work**:
1. List all branches across all submodule repos
2. Identify stale branches (>90 days, no recent commits)
3. Cherry-pick or merge valuable work
4. Delete stale branches
5. Document branch cleanup in commit messages

**Repositories Involved**: All repos (as submodules)

**Testing Effort**: None -- manual review.

**Dependencies**: Should be done before major feature work to avoid conflicts.

**Hours Estimate**: 6 hours

---

### CICD-01: Complete CI/CD Pipeline with Testing and Deployment

**Current State**:
- **backend**: GitHub Actions CI (`services/backend/.github/workflows/ci.yml`) runs on PRs to feature/bugfix/docs/refactor/develop branches. Steps: `yarn install --frozen-lockfile` (but CI config says `cache: 'npm'` -- mismatch with yarn), `yarn format`, `yarn lint:check`, `yarn test:core`, `yarn build`. Also runs Dive image analysis for dev and prod Docker images.
- **Python services**: Each has a `cloudbuild.yaml` for GCP Cloud Build -- but these only build Docker images, no test steps.
- **No deployment automation** exists anywhere. No staging/production deploy scripts.
- Inconsistency: backend uses `yarn` but `package-lock.json` also exists (npm artifact).

**Scope of Work**:
1. Fix yarn/npm inconsistency in backend (choose one, remove the other lockfile)
2. Add test steps to Python service cloudbuild.yaml files (run pytest before docker build)
3. Create GitHub Actions for Python services (lint + test)
4. Add deployment stages (staging, production) to CI/CD
5. Create GCP Cloud Run or Compute Engine deployment scripts
6. Add Docker Compose-based integration test step

**Repositories Involved**: All service repos, infra-setup

**Testing Effort**: CI pipeline itself is the test. Verify each service builds and tests pass in CI.

**Dependencies**: Depends on TEST-01 (need tests to run in CI). Depends on SEC-01 (secrets management for CI).

**Hours Estimate**: 24 hours

---

### DOC-01: Create Architecture Documentation

**Current State**: `/architecture/` directory is empty. No service interaction diagrams. Individual READMEs exist in some services but are minimal.

**Scope of Work**:
1. Create system architecture diagram (services, message queues, databases, Redis DBs, firmware)
2. Document data flow: firmware binary protocol -> get-data decode -> RabbitMQ `data-queue` -> data-processing -> RabbitMQ `pd-queue` -> database-writer -> PostgreSQL `process_acquisition_json()`
3. Document Redis DB assignments (DB 0: stroke timestamps, DB 2: connected_die + acq_rate, DB 3: connected_die mirror)
4. Document database schema (already in `infra-setup/infra-structure/database/`)
5. Document API endpoints (backend has Swagger)

**Repositories Involved**: Repo root (`architecture/`, `doc/`)

**Testing Effort**: None.

**Dependencies**: None, but benefits from understanding gained during FEAT-01.

**Hours Estimate**: 8 hours

---

### DOC-02: Create Deployment Runbook and Environment Setup Guide

**Current State**: `/deployments/` and `/scripts/` directories are empty. No onboarding docs. Docker compose files exist in `legacy/smart-die/` and `services/infra-setup/` but no unified guide.

**Scope of Work**:
1. Document infrastructure requirements (PostgreSQL, RabbitMQ, KeyDB, network setup)
2. Create `.env.example` for every service
3. Write step-by-step deployment guide (Docker Compose for local, GCP for production)
4. Document firmware flashing procedure
5. Create troubleshooting guide (common issues, log locations)

**Repositories Involved**: Repo root, infra-setup

**Testing Effort**: Verify guide by following it on a clean machine.

**Dependencies**: Depends on SEC-01 (env var patterns).

**Hours Estimate**: 10 hours

---

## MEDIUM PRIORITY TASKS

### INFRA-01: Implement Database Migration Versioning

**Current State**: Raw SQL files in `services/infra-setup/infra-structure/database/sql/`: `schema.sql`, `insert_acquisition_function.sql`, `create_users.sql`, `first_insert_die_sensor_hub.sql`, `determine_and_insert_batches.sql`, `loader_functions.sql`, `trg_panel_determine_batches_on_insert.sql`. No migration tool. The `entrypoint.sh` likely runs these in order on container start.

**Scope of Work**:
1. Choose migration tool: Flyway (SQL-based, fits existing pattern) or golang-migrate
2. Convert existing SQL files into numbered migrations (V1__schema.sql, V2__functions.sql, etc.)
3. Add migration runner to Docker entrypoint or CI
4. Create rollback scripts for each migration
5. Document migration workflow

**Repositories Involved**: `services/infra-setup/`

**Testing Effort**: 5 tests -- migrate up, migrate down, idempotency, fresh install, upgrade from existing.

**Dependencies**: None.

**Hours Estimate**: 12 hours

---

### INFRA-02: Add Monitoring and Centralized Logging

**Current State**: All Python services use `loguru` writing to stderr. Backend uses NestJS default logger. No health endpoints. No Prometheus metrics. No centralized log aggregation.

**Scope of Work**:
1. Add `/health` endpoints to each service (HTTP for backend, TCP check for Python services)
2. Add structured JSON logging output option
3. Set up log aggregation (ELK stack or Loki+Grafana)
4. Add Prometheus metrics endpoint to backend
5. Create Grafana dashboards for key metrics

**Repositories Involved**: All service repos, infra-setup

**Testing Effort**: 1 health check test per service = 14 tests.

**Dependencies**: None.

**Hours Estimate**: 20 hours

---

### OPT-01: Optimize Network Scanning in smartdie-connect

**Current State**: `services/connect/smartdie-connect.py` performs ARP scan of full `/24` subnet every 5 seconds with 2-second timeout. Uses `ThreadPoolExecutor(max_workers=20)` to HTTP GET each discovered IP to check for `switch_*` hostname response.

**Scope of Work**:
1. Cache known switch IPs and only scan those + periodic full scan (e.g., every 60s)
2. Reduce scan interval to only rescan on state change
3. Use mDNS/SSDP for switch discovery instead of brute-force ARP scan
4. Add exponential backoff on failed scans
5. Reduce max_workers to match expected switch count

**Repositories Involved**: `services/connect/`

**Testing Effort**: 5 tests -- mock network responses, verify caching, verify fallback to full scan.

**Dependencies**: None.

**Hours Estimate**: 6 hours

---

### OPT-02: Fix cJSON O(n^2) Algorithm in Firmware

**Current State**: The cJSON library is embedded in the firmware-hub codebase. The specific issue at cJSON.c:3145 is a known cJSON limitation with linear key lookup in objects.

**Scope of Work**:
1. Evaluate if cJSON can be upgraded to latest version (which may have improvements)
2. If performance is critical, replace cJSON with a hash-based JSON library or pre-compile key lookups
3. Profile actual firmware JSON parsing to confirm bottleneck

**Repositories Involved**: `firmware/firmware-hub/`

**Testing Effort**: Performance benchmark before/after. Requires hardware or emulator.

**Dependencies**: FW-01.

**Hours Estimate**: 8 hours

---

### QUAL-03: Resolve All Open TODOs (18 total)

**Current State**: Key TODOs mentioned:
- `processing_consumer.py:49` -- concentrador_id handling
- `gap_features.py:45` -- Redis value interpretation
- `app.c:814` -- state machine error handling (overlaps FW-01)

**Scope of Work**: Audit all 18 TODOs, categorize as fix/remove/document, implement fixes.

**Repositories Involved**: Multiple (legacy, firmware, services)

**Testing Effort**: 1 test per resolved TODO where applicable. ~10 testable TODOs.

**Dependencies**: Overlaps with FW-01, QUAL-01.

**Hours Estimate**: 8 hours

---

## PRODUCT FEATURES

### FEAT-01: Implement Full Data Processing Pipeline

**Current State**:

The pipeline exists but has gaps and the data-processing service contains a full copy of commented-out old code (lines 1-236) alongside the new active code (lines 238-477). The end-to-end flow:

1. **Firmware Hub** (`app.c`): Reads sensors via SPI, packs binary data with protocol version byte, sensor type byte, then sensor-specific payload. Publishes via MQTT to RabbitMQ.

2. **get-data** (`smartdie-get-data.py`): Consumes from `data-queue`. Decodes binary protocol: protocol_version (uint8), sensor_type (uint8), then DRAWIN or GAP payload. DRAWIN payload: hub_id (16B), sensor_name (16B), spi_port (uint16), sensor_id (8B), stroke_timestamp (uint32 seconds + uint16 ms), num_samples (uint16), dpi (int16), then N samples of (delta_ms uint16, x float32, y float32). GAP payload: similar header + samples of (delta_ms uint16, x/y/z uint16, temp float32). After decode, formats to text, re-parses text via regex to extract fields, enriches with Redis data (PLC timestamp lookup, connected_die info), and publishes JSON to `pd-queue`.

3. **data-processing** (`smartdie-processing-data.py`): Consumes from `pd-queue`. For DRAWIN: applies calibration factors (k_x, k_y from Redis), computes velocities (v_x, v_y), displacement (di_x, di_y, di). For GAP: computes absolute magnitude (abs_xyz), normalizes by range. Publishes enriched JSON to `dw-smart-die-queue`.

4. **database-writer** (`dw-smart-die.py`): Consumes from `dw-smart-die-queue`. Decodes byte string to dict, calls PostgreSQL stored function `process_acquisition_json(jsonb)` which: looks up die by internal_die_id, finds hub, finds sensor, creates/finds panel (by die_id + stroke_timestamp), then iterates over all remaining JSON keys storing each as a field+acquisition record.

5. **backend** (NestJS): Exposes REST API. **CRITICAL MISMATCH**: Backend entities (`sensor.entity.ts`, `sensor-reading.entity.ts`, `panel.entity.ts`, etc.) use a completely different schema than the actual production database (`infra-setup/database/sql/schema.sql`). The backend models are simplified/demo models (e.g., `SensorType` enum has temperature/pressure/vibration/displacement vs. actual DB `sensor_type` table). The `production.service.ts` has stub implementations (`getSensorData` returns "Not implemented yet").

**Scope of Work**:

1. **Fix get-data decode-to-text-to-regex anti-pattern**: The service decodes binary to structured data, then formats to text, then re-parses via regex. This is fragile and lossy. Refactor to pass the decoded dict directly to JSON output, skipping the text formatting round-trip.

2. **Align backend entities with actual DB schema**: Replace demo entities with entities matching `schema.sql` tables: `site`, `line`, `press`, `die`, `sensor_type`, `field`, `batch`, `hub`, `sensor`, `panel`, `acquisition`. This is a major refactor of the backend.

3. **Implement backend API endpoints for actual data**: Replace stub implementations in `production.service.ts`. Add endpoints for: panels with acquisitions, sensor history, batch management, die configuration.

4. **Remove commented-out old code** from `smartdie-processing-data.py` (lines 1-236).

5. **Add message schema validation** at each pipeline stage (JSON Schema or Pydantic models for Python services, DTO validation for NestJS).

6. **Add dead letter queue handling**: Currently `auto_ack=True` in get-data (line 735), meaning messages are lost on failure. data-processing also uses `auto_ack=True`.

7. **Fix data-processing Redis connection**: Creates a new Redis connection on every message (line 320: `redis_client = conectar_redis()`). Should use a connection pool.

**Repositories Involved**: `services/get-data`, `services/data-processing`, `services/database-writer`, `services/backend`

**Testing Effort**:
| Component | Tests |
|-----------|-------|
| get-data binary decode (DRAWIN) | 8 |
| get-data binary decode (GAP) | 8 |
| get-data JSON output format | 5 |
| data-processing DRAWIN math | 8 |
| data-processing GAP math | 6 |
| database-writer integration | 5 |
| backend new entity models | 10 |
| backend API endpoints | 15 |
| End-to-end pipeline | 5 |
| **Total** | **70** |

**Testing Infrastructure**: Need pytest for Python services, Jest for backend. Docker Compose test environment with PostgreSQL + RabbitMQ + Redis.

**Dependencies**: SEC-01 (credentials), INFRA-01 (DB migrations), TEST-01 foundation.

**Hours Estimate**: 80 hours

---

### FEAT-02: Create Mock Data Generator

**Current State**:
- `toolkit/parse_mock_data/` has `parse_to_redis.py`, `parse_to_sql.py`, and `93309290_layout.csv` -- basic utilities for loading real data but no synthetic generator.
- Binary protocol is well-defined in `get-data` (protocol_version, sensor_type, then DRAWIN/GAP payloads with specific struct formats).
- JSON schema for processed messages is defined by the data-processing output (see fields in `mensagem_dw` dicts).
- Database schema is in `infra-setup/database/sql/schema.sql` with tables: site, line, press, die, sensor_type, field, batch, hub, sensor, panel, acquisition.
- `legacy/smart-die/dashboard/data/` contains sample data: `all_sensors.json`, `test_data.json`, `treated_drawin.csv`, `treated_gap.csv`, `timeline_test_df.csv`.
- `backend/sample-data.sql` has demo insert statements but uses the wrong schema (backend demo entities, not production schema).

**Scope of Work**:

1. **Binary message generator**: Python tool that generates valid binary packets matching the firmware protocol. Configurable: number of sensors, samples per stroke, noise levels, timestamp ranges. For DRAWIN: protocol_version(1) + sensor_type(1=DRAWIN) + hub_id(16B) + sensor_name(16B) + spi_port(2B) + sensor_id(8B) + stroke_ts(4B+2B) + num_samples(2B) + dpi(2B) + N*(delta_ms 2B + x float32 + y float32). For GAP: similar with x/y/z uint16 + temp float32.

2. **JSON message generator**: Generate messages at each pipeline stage (get-data output, data-processing output, database-writer input).

3. **Database seed generator**: Generate SQL INSERT statements for the production schema (site, line, press, die, hub, sensor, panel, acquisition).

4. **Anomaly injection**: Configurable profiles for: missing fields, out-of-range values, timestamp gaps, sensor dropouts.

5. **Redis state generator**: Populate Redis DBs with calibration parameters (k_x, k_y, dpi, range, acq_rate) and connected_die state.

6. **CLI interface**: `python mock_generator.py --profile=normal --strokes=100 --sensors=8 --output=binary|json|sql`

**Repositories Involved**: New tool in `toolkit/mock-data-generator/` (or `libs/mock-data-generator/`). Depends on understanding from `services/get-data`, `services/data-processing`, `services/infra-setup`.

**Testing Effort**:
| Component | Tests |
|-----------|-------|
| Binary DRAWIN packet generation | 5 |
| Binary GAP packet generation | 5 |
| JSON message generation | 5 |
| SQL seed generation | 3 |
| Anomaly injection | 5 |
| Redis state generation | 3 |
| CLI interface | 4 |
| **Total** | **30** |

**Testing Infrastructure**: pytest. Validate generated binary packets by feeding them through the actual get-data decoder.

**Dependencies**: FEAT-01 (need to understand exact data formats). SEC-01 (sample configs without real credentials).

**Hours Estimate**: 32 hours

---

### FEAT-03: Create Integrated Testing Suite

**Current State**:
- **backend**: Jest configured, GitHub Actions CI runs lint + test:core + build + Dive image analysis. 3 parsing spec files, 3 auth/user spec files (likely scaffolds), 1 e2e spec.
- **database-writer**: pytest with 1 test file, 4 functions, ~10 parametrized cases. Well-written.
- **All other Python services**: Zero tests, zero CI.
- **frontend**: Angular default spec files, no CI.
- **Legacy**: Zero tests, zero CI.
- **No integration tests exist anywhere**.
- **No Docker Compose test environment** defined.

**Scope of Work**:

1. **Docker Compose test environment**: Create `docker-compose.test.yml` with PostgreSQL, RabbitMQ, KeyDB, and all services. Pre-seed database with schema + test data.

2. **Unit test suites** (per service, extends TEST-01):
   - get-data: Binary decode tests with known payloads
   - data-processing: Math computation tests for DRAWIN/GAP
   - database-writer: Extend existing parsing tests + add PostgreSQL integration tests
   - connect: Mock ARP scan + Redis write tests
   - backend: Full service/controller tests for production module

3. **Integration tests** (cross-service):
   - Binary packet -> get-data -> verify JSON on pd-queue
   - JSON on pd-queue -> data-processing -> verify enriched JSON on dw-queue
   - JSON on dw-queue -> database-writer -> verify PostgreSQL records
   - Full pipeline: binary packet -> all services -> verify API response from backend
   - Frontend -> backend API contract tests

4. **CI/CD integration**:
   - GitHub Actions workflow for each Python service (lint + test)
   - Add integration test stage to backend CI
   - Create nightly full-pipeline test run

5. **Coverage reporting**: Set up pytest-cov for Python, Jest coverage for TypeScript, with minimums (70% for critical path services).

**Repositories Involved**: All service repos, infra-setup (test compose), repo root (CI configs)

**Testing Effort**:
| Category | Tests |
|----------|-------|
| Unit: get-data | 20 |
| Unit: data-processing | 15 |
| Unit: database-writer | 15 |
| Unit: connect | 8 |
| Unit: backend | 30 |
| Unit: frontend | 20 |
| Unit: other Python services | 12 |
| Integration: get-data->processing | 5 |
| Integration: processing->db-writer | 5 |
| Integration: full pipeline | 5 |
| Integration: backend API | 10 |
| E2E: frontend->backend | 5 |
| **Total** | **150** |

**Testing Infrastructure**: Need to create: `docker-compose.test.yml`, pytest configs per service, GitHub Actions workflows, coverage config. Use testcontainers or fixture-based PostgreSQL/RabbitMQ/Redis for integration tests.

**Dependencies**: TEST-01 (foundation), FEAT-02 (mock data for test fixtures), SEC-01 (env var configs for test environments), FEAT-01 (fixes that make services testable).

**Hours Estimate**: 60 hours

---

## LOW PRIORITY TASKS

### CLEAN-01: Clean Up Repository Artifacts

**Current State**: `__pycache__` likely tracked in legacy. `libs/`, `topologies/`, `scripts/`, `deployments/`, `architecture/` contain only `.gitkeep`.

**Scope of Work**:
1. Add `__pycache__/`, `*.pyc` to `.gitignore` at root and per-service
2. Remove tracked `__pycache__` from git history
3. Remove or populate empty scaffold directories
4. Document submodule structure

**Repositories Involved**: Repo root, legacy

**Testing Effort**: None.

**Dependencies**: None.

**Hours Estimate**: 2 hours

---

### TOOL-01: Document and Integrate Toolkit Utilities

**Current State**: `toolkit/parse_mock_data/` contains `parse_to_redis.py`, `parse_to_sql.py`, `93309290_layout.csv`. No README, no validation.

**Scope of Work**:
1. Add README to parse_mock_data
2. Add input validation and error handling
3. Add CLI argument parsing (argparse)
4. Document data formats and usage

**Repositories Involved**: `toolkit/`

**Testing Effort**: 3 tests for each script.

**Dependencies**: None.

**Hours Estimate**: 3 hours

---

## ESTIMATES SUMMARY

| Task ID | Priority | Complexity | Hours | Dependencies |
|---------|----------|------------|-------|--------------|
| SEC-01 | High | Complex | 12 | None |
| SEC-02 | High | Medium | 8 | None |
| FW-01 | High | Complex | 40 | SEC-01 |
| TEST-01 | High | Complex | 48 | SEC-01 |
| QUAL-01 | High | Medium | 2 | None |
| QUAL-02 | High | Medium | 3 | None |
| GIT-01 | High | Medium | 6 | None |
| CICD-01 | High | Complex | 24 | TEST-01, SEC-01 |
| DOC-01 | High | Medium | 8 | None |
| DOC-02 | High | Medium | 10 | SEC-01 |
| INFRA-01 | Medium | Medium | 12 | None |
| INFRA-02 | Medium | Medium | 20 | None |
| OPT-01 | Medium | Medium | 6 | None |
| OPT-02 | Medium | Medium | 8 | FW-01 |
| QUAL-03 | Medium | Medium | 8 | FW-01, QUAL-01 |
| FEAT-01 | Complex | Complex | 80 | SEC-01, INFRA-01 |
| FEAT-02 | Complex | Complex | 32 | FEAT-01 |
| FEAT-03 | Complex | Complex | 60 | TEST-01, FEAT-02 |
| CLEAN-01 | Low | Simple | 2 | None |
| TOOL-01 | Low | Simple | 3 | None |
| **TOTAL** | | | **382** | |

## RECOMMENDED EXECUTION ORDER

**Phase 1 -- Foundation (Weeks 1-2)**: SEC-01, QUAL-01, QUAL-02, CLEAN-01, TOOL-01
**Phase 2 -- Quality (Weeks 3-4)**: SEC-02, GIT-01, TEST-01 (start), DOC-01
**Phase 3 -- Infrastructure (Weeks 5-6)**: INFRA-01, DOC-02, CICD-01 (start), TEST-01 (finish)
**Phase 4 -- Pipeline (Weeks 7-10)**: FEAT-01, CICD-01 (finish)
**Phase 5 -- Testing & Tools (Weeks 11-13)**: FEAT-02, FEAT-03
**Phase 6 -- Optimization (Weeks 14-15)**: FW-01, OPT-01, OPT-02, QUAL-03, INFRA-02

## CRITICAL FINDINGS

1. **Schema Mismatch**: The backend NestJS entities use a completely different schema than the actual PostgreSQL database defined in `infra-setup/sql/schema.sql`. The backend has demo entities (`production_batches`, `panels` with chart types, `sensors` with temperature/pressure types) while the real DB has industrial schema (`die`, `hub`, `sensor`, `panel` as stroke records, `acquisition` as field-value pairs). This is the single largest blocker for FEAT-01.

2. **get-data Anti-Pattern**: The service decodes binary data to a structured dict, then formats it to human-readable text, then re-parses that text via regex. This loses type information and is fragile. Direct dict-to-JSON would eliminate an entire class of bugs.

3. **Security**: 35 files with hardcoded credentials, a GCP service account JSON in the repo root, and extensive `eval()` usage in the legacy codebase create significant security risks.

4. **data-processing Redundancy**: The file contains the entire old implementation commented out (236 lines) followed by the new implementation. The old code should be removed.

5. **Auto-ack Without DLQ**: Both `get-data` and `data-processing` use `auto_ack=True`, meaning failed messages are silently lost. Only `database-writer` properly handles ack/nack.
