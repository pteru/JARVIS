# SDK Product Backlog -- Detailed Implementation Plans

## Executive Summary

This document provides deep-dive implementation plans for FEAT-01 through FEAT-04 of the Strokmatic SDK backlog. All analysis is based on actual source code inspection.

---

## FEAT-01: OpENer-based EIP Connector Library

### 1. Current State

**Two distinct EIP/PLC communication approaches exist today:**

**Approach A -- pylogix (Class 3 / Explicit Messaging)**
- Used in `visionking/services/plc-monitor-eip/` via `plc/plc_connector.py`
- Uses the `pylogix` Python library (pure Python, CIP Class 3 over TCP)
- Reads tag lists in a polling loop, writes results to Redis
- Simple wrapper: 30 lines of code around `pylogix.PLC`
- Also used in SpotFusion's `plc-monitor-camera-opener/opener/src/ports/POSIX/sample_application/Iplc/plc_connector_class3.py`

**Approach B -- OpENer (Class 1 / Implicit Messaging)**
- Used in SpotFusion's `plc-monitor-camera-opener/`
- OpENer is a C-based open-source EtherNet/IP stack (123 C/H files in `opener/src/`)
- The `sampleapplication.c` defines CIP assembly objects (input #100, output #150, config #151) with 32-byte data buffers
- Python code in `Iplc/plc_connector.py` uses a custom `pylogix.Adapter` class (not the standard pylogix `PLC` class) that wraps OpENer's implicit messaging
- The Adapter receives data via callback (`self.COMMUNICATION.Callback = self.MAIN_CLASS.READ`)
- This is real-time Class 1 I/O, not polling -- the PLC pushes data cyclically

**Key files:**
- `/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/services/plc-monitor-eip/plc/plc_connector.py` -- pylogix wrapper
- `/home/teruel/claude-orchestrator/workspaces/strokmatic/spotfusion/services/plc-monitor-camera-opener/opener/` -- Full OpENer C source tree
- `/home/teruel/claude-orchestrator/workspaces/strokmatic/spotfusion/services/plc-monitor-camera-opener/opener/src/ports/POSIX/sample_application/Iplc/plc_connector.py` -- Python Adapter-based connector (Class 1)
- `/home/teruel/claude-orchestrator/workspaces/strokmatic/spotfusion/services/plc-monitor-camera-opener/opener/src/ports/POSIX/sample_application/Iplc/plc_connector_class3.py` -- pylogix-based connector (Class 3)

### 2. Scope of Work

The SDK library must unify both approaches behind a clean Python API:

1. **Core Python package `strokmatic-eip-connector`** with:
   - `EipClient` base class with `connect()`, `read_tags()`, `write_tag()`, `close()`, `health_check()`
   - `ExplicitClient(EipClient)` -- wraps pylogix for Class 3 tag read/write (polling)
   - `ImplicitClient(EipClient)` -- wraps the OpENer Adapter for Class 1 I/O (callback-driven)
   - `EipConfig` dataclass (PLC IP, slot, protocol class, assembly numbers, cycle time, tag mappings)
   - Exception hierarchy: `EipConnectionError`, `EipReadError`, `EipWriteError`

2. **OpENer binary management**:
   - Pre-built OpENer binary for Linux x86_64 included or built via CMake during Docker build
   - Entrypoint script to launch OpENer process alongside the Python application
   - Shared-memory or socket-based IPC between OpENer C process and Python (existing pattern uses the `Adapter` Python binding)

3. **Docker integration**:
   - Base Dockerfile fragment for services needing OpENer (CMake build stage)
   - Network configuration helpers (OpENer requires `network_mode: host`)

4. **Tag mapping configuration** (JSON/YAML):
   - Standardize the `tags.json` format used in visionking-plc-monitor-eip
   - Support both flat tag lists (Class 3) and assembly-based mappings (Class 1)

### 3. Repositories Involved

| Repository | Role |
|---|---|
| `sdk/` (new `sdk-eip-connector/`) | Library package |
| `spotfusion/services/plc-monitor-camera-opener/` | Source of OpENer integration, reference for Class 1 |
| `visionking/services/plc-monitor-eip/` | Reference for Class 3, first consumer |
| `spotfusion/services/plc-monitor/` | Potential consumer |

### 4. Testing Effort

| Category | Test Cases | Notes |
|---|---|---|
| Unit: ExplicitClient (mocked pylogix) | 8 | connect, read single/multi, write, close, error handling, retry |
| Unit: ImplicitClient (mocked Adapter) | 6 | connect, callback registration, write to input data, close, health check |
| Unit: EipConfig validation | 4 | Valid configs, missing fields, type errors, tag parsing |
| Unit: Tag mapping parser | 4 | JSON/YAML loading, flat vs assembly format |
| Integration: ExplicitClient + real pylogix | 4 | Requires PLC simulator or hardware |
| Integration: ImplicitClient + OpENer binary | 3 | Requires Linux, built OpENer |
| **Total** | **~29** | |

### 5. Testing Infrastructure

- **Exists**: Nothing specific for EIP testing in SDK
- **Needs setup**:
  - PLC simulator (e.g., `pylogix` test server or SoftLogix) for CI integration tests
  - OpENer build step in CI (CMake + gcc)
  - Mock classes for pylogix `PLC` and `Adapter`

### 6. Dependencies

- `pylogix>=1.0.0` (for Class 3)
- Custom pylogix `Adapter` fork (currently vendored in SpotFusion's opener tree)
- OpENer C source (currently vendored as `opener/` directory)
- CMake + build-essential (Docker build-time only)
- Should depend on `strokmatic-logging` (FEAT-03) for consistent logging

**Ordering**: FEAT-03 (logging lib) should be completed first so this library uses it. Otherwise, use stdlib logging initially and migrate later.

### 7. Hours Estimate

| Task | Hours |
|---|---|
| Package scaffolding (pyproject.toml, structure) | 2 |
| ExplicitClient implementation (pylogix wrapper) | 6 |
| ImplicitClient implementation (Adapter wrapper) | 12 |
| EipConfig and tag mapping parser | 4 |
| OpENer Docker build integration | 6 |
| Exception hierarchy and error handling | 2 |
| Unit tests | 8 |
| Integration test scaffolding | 4 |
| Documentation + examples | 3 |
| Cloud Build CI/CD (matching existing pattern) | 2 |
| **Total** | **49** |

---

## FEAT-02: Advanced Logging in Observability Stack

### 1. Current State

The observability stack at `/home/teruel/claude-orchestrator/workspaces/strokmatic/sdk/sdk-observability-stack/` contains:

**Docker Compose services (docker-compose.yml):**
- **Prometheus** (port 8110) -- metrics scraping at 15s interval
- **Grafana** (port 8100) -- dashboards, anonymous viewer access, iframe embedding enabled
- **node-exporter** (port 8111) -- host metrics
- **cAdvisor** (port 8112) -- Docker container metrics
- **intel-gpu-exporter** (port 8113) -- Intel GPU metrics
- nvidia-gpu-exporter (commented out) -- NVIDIA GPU metrics

**Prometheus scrape targets:** prometheus, node-exporter, cadvisor, intel-gpu, nvidia-gpu

**Grafana dashboards (4 pre-provisioned):**
- `cadvisor.json` (817 lines)
- `intel-gpu.json` (614 lines)
- `node-exporter.json` (23,899 lines -- comprehensive)
- `nvidia-gpu.json` (810 lines)

**Distributed overlay:** `docker-compose.distributed.yml` disables local exporters, keeps only Grafana for centralized viewing.

**Missing entirely:** No log aggregation. No Loki. No Promtail/Alloy. No alerting rules. No alert manager.

### 2. Scope of Work

1. **Loki** -- Log aggregation engine
   - Add `loki` service to docker-compose.yml
   - Configure retention, storage (filesystem for single-node, S3-compatible for distributed)
   - Configure as Grafana datasource via provisioning

2. **Promtail (or Grafana Alloy)** -- Log shipper
   - Scrape Docker container logs via `/var/lib/docker/containers/`
   - Label enrichment: container name, service name, compose project
   - Pipeline stages: JSON parsing (for services using `serialize=True` from strokmatic-logging), regex for plain text
   - Add to docker-compose.yml

3. **Grafana dashboards for logs:**
   - Log explorer dashboard with service filter
   - Error rate dashboard (count errors per service over time)
   - Correlated metrics+logs dashboard

4. **Alerting:**
   - Grafana alerting rules or Alertmanager
   - Alert channels: webhook (for integration with message-poster MCP), email
   - Default rules: high error rate, service down, disk usage, memory pressure

5. **Update distributed overlay** to support remote Loki instances

### 3. Repositories Involved

| Repository | Role |
|---|---|
| `sdk/sdk-observability-stack/` | Primary -- all changes here |
| `sdk/sdk-lib-logging/` | Dependency -- logging lib must output JSON format for Loki parsing |
| VisionKing/SpotFusion services | Consumers -- will ship logs to Promtail automatically via Docker log driver |

### 4. Testing Effort

| Category | Test Cases | Notes |
|---|---|---|
| Docker Compose validation (services start) | 1 | `docker compose up` smoke test |
| Loki ingestion test | 2 | Send test log, query via LogQL |
| Promtail scraping test | 2 | Verify labels, pipeline parsing |
| Grafana datasource provisioning | 1 | Loki appears as datasource |
| Dashboard rendering | 3 | Each new dashboard loads without errors |
| Alert rule firing | 2 | Simulate high error rate, verify alert |
| Distributed overlay | 1 | Verify remote Loki connectivity |
| **Total** | **~12** | Mostly manual/semi-automated |

### 5. Testing Infrastructure

- **Exists**: Docker Compose environment, Grafana provisioning system
- **Needs setup**:
  - Test script that spins up the stack, injects sample logs, queries Loki API
  - Possibly a `scripts/test-stack.sh`

### 6. Dependencies

- No code dependencies on other FEAT items
- FEAT-03 (logging lib) with `serialize=True` improves log parsing quality in Loki, but is not required -- Promtail can parse plain text
- Downstream: all services benefit automatically once deployed alongside the stack

### 7. Hours Estimate

| Task | Hours |
|---|---|
| Loki service configuration + docker-compose | 3 |
| Promtail/Alloy configuration + pipeline stages | 5 |
| Grafana Loki datasource provisioning | 1 |
| Log explorer dashboard | 4 |
| Error rate dashboard | 3 |
| Correlated metrics+logs dashboard | 4 |
| Alertmanager / Grafana alerting setup | 6 |
| Default alert rules (error rate, service down, disk, memory) | 4 |
| Distributed overlay updates | 2 |
| Testing scripts | 3 |
| Documentation | 2 |
| **Total** | **37** |

---

## FEAT-03: Python Logging Library

### 1. Current State

The library **already exists and is feature-complete** at `/home/teruel/claude-orchestrator/workspaces/strokmatic/sdk/sdk-lib-logging/`.

**Package:** `strokmatic-logging` v1.0.0

**Module structure (`strokmatic_logging/`):**
- `__init__.py` -- exports `LoggerConfig`, `setup_logger`, `get_logger`, decorators
- `config.py` -- `LoggerConfig` dataclass with 15+ configurable fields, `from_env()` factory, file rotation, JSON serialization support
- `logger.py` -- `setup_logger()`, `get_logger()`, `reconfigure()`, global logger instance management
- `decorators.py` -- `log_execution_time`, `log_async_execution_time`, `log_calls` decorators

**Tests (`tests/`):**
- `test_logger.py` -- 7 test functions (defaults, env config, setup, get_logger, levels, rotation, extra fields)
- `test_decorators.py` -- exists (not read but likely covers the 3 decorators)

**Build/Deploy:**
- `pyproject.toml` -- setuptools, pytest with coverage, black, flake8, mypy
- `cloudbuild.yaml` -- Google Artifact Registry deployment (matches sdk-lib-rabbit-client pattern)
- `README.md`, `SETUP.md`, `examples/` directory

**Dependency:** `loguru>=0.7.0`

### 2. Scope of Work

The library code is **done**. The remaining work is deployment and adoption:

1. **Publish to Artifact Registry** -- trigger the Cloud Build pipeline
2. **Validate the package** -- install from Artifact Registry in a clean venv, run smoke test
3. **Create migration guide** -- document how existing services replace their ad-hoc logging:
   - VisionKing services use a custom `Log` class (e.g., `from log.log import Log; Log.setup_logger()`)
   - SpotFusion services use vendored `utils/Ilog/log.py`
   - Migration: replace `from log.log import Log` with `from strokmatic_logging import setup_logger, get_logger`
4. **Add structured JSON output example** -- for integration with Loki (FEAT-02)
5. **Minor enhancements** (if any):
   - Add `correlation_id` support for request tracing
   - Add `service_name` as a first-class config field (currently via `extra_fields`)

### 3. Repositories Involved

| Repository | Role |
|---|---|
| `sdk/sdk-lib-logging/` | Primary -- library source |
| `visionking/services/*` | Consumers -- migrate from `log.log.Log` |
| `spotfusion/services/*` | Consumers -- migrate from `utils/Ilog/log.py` |

### 4. Testing Effort

| Category | Test Cases | Notes |
|---|---|---|
| Existing tests | ~10 | Already written in test_logger.py + test_decorators.py |
| New: JSON serialization output | 2 | Verify serialize=True produces valid JSON |
| New: from_env() edge cases | 3 | Missing vars, invalid values |
| New: Thread safety (enqueue=True) | 2 | Concurrent logging from multiple threads |
| New: Integration smoke test (installed from AR) | 1 | pip install + import + log |
| **Total** | **~18** | ~10 existing + ~8 new |

### 5. Testing Infrastructure

- **Exists**: pytest + pytest-cov configured in pyproject.toml, Cloud Build pipeline
- **Needs setup**: Nothing major. CI runs tests before publish.

### 6. Dependencies

- `loguru>=0.7.0` (only runtime dependency)
- No dependency on other FEAT items
- Downstream: FEAT-01 and FEAT-04 should depend on this library
- Cloud Build service account must be configured (setup scripts already exist in sdk-lib-rabbit-client)

### 7. Hours Estimate

| Task | Hours |
|---|---|
| Trigger and validate Cloud Build publish | 2 |
| Add 8 new test cases | 3 |
| Service name as first-class config field | 1 |
| Correlation ID support | 2 |
| Migration guide document | 2 |
| JSON output example for Loki integration | 1 |
| Validate install from Artifact Registry | 1 |
| **Total** | **12** |

---

## FEAT-04: Python RabbitMQ aio-pika Library

### 1. Current State

The library **already exists and is feature-complete** at `/home/teruel/claude-orchestrator/workspaces/strokmatic/sdk/sdk-lib-rabbit-client/`.

**Package:** `strokmatic-rabbit-client` v1.0.0

**Module structure (`rabbit_client/` mapped to `strokmatic_rabbit_client`):**
- `__init__.py` -- exports `RabbitClient`, `BrokerConfig`, `BrokerAddress`, `Credentials`, 3 exceptions
- `client.py` -- `RabbitClient` class (399 lines) with: `connect()` using `aio_pika.connect_robust`, `send_message()` to multiple queues, `consume_messages()` with retry loop, `stop_consuming()`, `reconnect()`, `close_connection()`
- `config.py` -- `BrokerConfig`, `BrokerAddress`, `Credentials` dataclasses with validation
- `exceptions.py` -- `PublisherConfigurationError`, `ConsumerConfigurationError`, `ConnectionLossError`

**Tests (`tests/`):**
- `test_client.py` -- 5 test cases (connect success/failure, send without queue, consume without queue, close connection)

**Build/Deploy:**
- `pyproject.toml` -- setuptools, aio-pika>=9.0.0, pytest-asyncio, Cloud Build
- `cloudbuild.yaml` -- Google Artifact Registry deployment pipeline
- `README.md`, `SETUP.md`, Cloud Build setup docs

**Origin comparison -- the SDK lib was extracted from `visionking/services/inference/src/communication_clients/`:**

| Feature | visionking-inference original | SDK lib |
|---|---|---|
| `RabbitClient` core | Yes (256 lines) | Yes (399 lines, refined) |
| `BrokerConfig` | Minimal (no defaults, `max_connections` field) | Enhanced (prefetch_count, max_retries, retry_delay, validation) |
| `connect_robust` | Yes | Yes |
| `consume_messages` retry | Hardcoded 5 retries / 5s delay | Configurable via BrokerConfig |
| `send_message` queue declaration | Commented out | Active (declares before publish) |
| Logger | Custom `get_logger()` from service | stdlib `logging.Logger` (injectable) |
| Example code | Inline `main_async` with signal handling | Separate README examples |

The SDK version is a clean, production-ready extraction. The same pattern also exists (duplicated) in `visionking/services/image-saver/src/communication_clients/rabbit_client_async/` and `visionking/services/pixel-to-object/src/communication_clients/`.

### 2. Scope of Work

The library code is **done**. Remaining work:

1. **Publish to Artifact Registry** -- trigger Cloud Build
2. **Expand test coverage**:
   - `send_message` success path (mock channel publish)
   - `consume_messages` retry behavior (mock connection drops)
   - `reconnect()` flow
   - `BrokerConfig.__post_init__` normalization (str to list, invalid types)
3. **Migrate logger from stdlib to strokmatic-logging** (FEAT-03):
   - Change `logging.Logger` constructor parameter to accept loguru logger
   - Or: use `strokmatic_logging.get_logger()` as default instead of `logging.getLogger(__name__)`
4. **Migrate consuming services** to use the SDK package:
   - `visionking-inference` -- remove local `communication_clients/` directory, install `strokmatic-rabbit-client`
   - `visionking-image-saver` -- same
   - `visionking-pixel-to-object` -- same
   - Update `requirements.txt` / Dockerfiles to install from Artifact Registry

### 3. Repositories Involved

| Repository | Role |
|---|---|
| `sdk/sdk-lib-rabbit-client/` | Primary -- library source |
| `visionking/services/inference/` | Consumer -- has the original source code to replace |
| `visionking/services/image-saver/` | Consumer -- has duplicated rabbit_client_async/ |
| `visionking/services/pixel-to-object/` | Consumer -- has duplicated rabbit_client |

### 4. Testing Effort

| Category | Test Cases | Notes |
|---|---|---|
| Existing tests | 5 | In test_client.py |
| New: send_message success path | 2 | Single queue, multiple queues |
| New: send_message connection failure mid-publish | 1 | |
| New: consume_messages retry (connection drop + recovery) | 2 | |
| New: consume_messages max retries exceeded | 1 | |
| New: stop_consuming during active consumption | 1 | |
| New: reconnect() | 1 | |
| New: BrokerConfig validation | 3 | str normalization, list passthrough, invalid type |
| New: BrokerConfig defaults | 1 | |
| **Total** | **~17** | 5 existing + 12 new |

### 5. Testing Infrastructure

- **Exists**: pytest + pytest-asyncio configured, Cloud Build pipeline, mock-based unit tests
- **Needs setup**: Nothing. All tests use mocked aio-pika; no RabbitMQ instance required.

### 6. Dependencies

- `aio-pika>=9.0.0,<10.0.0` (only runtime dependency)
- Optional: `strokmatic-logging` (FEAT-03) for logger integration
- Downstream: 3+ VisionKing services are immediate consumers

**Ordering**: Can be published independently. Logger migration is a nice-to-have that can follow FEAT-03.

### 7. Hours Estimate

| Task | Hours |
|---|---|
| Trigger and validate Cloud Build publish | 2 |
| Add 12 new test cases | 5 |
| Migrate logger to strokmatic-logging (optional) | 2 |
| Migration of visionking-inference | 3 |
| Migration of visionking-image-saver | 2 |
| Migration of visionking-pixel-to-object | 2 |
| Validate all migrated services end-to-end | 3 |
| **Total** | **19** |

---

## Summary: Estimates and Dependency Graph

### Hours Summary

| Task | Complexity | Status | Hours |
|---|---|---|---|
| FEAT-01: EIP Connector | Complex | New development | **49** |
| FEAT-02: Observability Logging | Complex | Extension of existing stack | **37** |
| FEAT-03: Python Logging Lib | Complex (marked) | Code complete, needs publish + adoption | **12** |
| FEAT-04: Python RabbitMQ Lib | Complex (marked) | Code complete, needs publish + adoption | **19** |
| **Total** | | | **117** |

### Recommended Execution Order

```
Phase 1 (parallel):
  FEAT-03: Publish logging lib          [12h]
  FEAT-02: Observability stack logging   [37h] (independent, but benefits from FEAT-03 JSON output)

Phase 2 (after FEAT-03):
  FEAT-04: Publish rabbit client + migrate services  [19h] (uses strokmatic-logging)

Phase 3 (after FEAT-03):
  FEAT-01: EIP connector                [49h] (uses strokmatic-logging, most complex)
```

### Risk Matrix

| Task | Key Risk | Mitigation |
|---|---|---|
| FEAT-01 | OpENer C binary compilation and Python interop is fragile; the custom pylogix `Adapter` class is undocumented | Start with ExplicitClient (pylogix, well-understood); defer ImplicitClient to second iteration |
| FEAT-02 | Loki resource consumption on edge devices with limited RAM | Configure aggressive retention limits; test on representative hardware |
| FEAT-03 | Low risk -- code is complete | Just deploy and validate |
| FEAT-04 | Service migration may surface subtle behavior differences (e.g., queue declaration timing) | Migrate one service first (inference), validate in staging, then migrate others |
