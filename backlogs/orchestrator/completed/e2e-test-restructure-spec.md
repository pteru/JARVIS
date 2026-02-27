# VisionKing Test Suite Restructure — E2E Umbrella Unification

## Objective

Restructure `workspaces/strokmatic/visionking/tests/` so that **`e2e/` becomes the umbrella** for all system-level testing (contracts, benchmarks, services, pipelines, UI), while maintaining the ability to test individual layers independently.

## Current Structure

```
tests/
├── conftest.py                    # Root pytest — validates docker infra running
├── pytest.ini                     # Markers: integration, performance; asyncio_mode=auto
├── requirements-test.txt          # Python test deps
├── docker-compose.test.yml        # Lightweight: RabbitMQ:5673, Redis:6380, PostgreSQL:5433
├── helpers/                       # Shared utils: postgres_helpers, rabbit_helpers, redis_helpers, timing
├── factories/                     # Message generators: make_pipeline_message(), make_redis_frame_hash()
├── fixtures/                      # pytest fixtures: env, postgres, rabbit, redis_fixture
├── integration/                   # 3 contract test files (async, aio-pika)
│   ├── test_full_pipeline.py
│   ├── test_inference_to_p2o.py
│   └── test_p2o_to_dbwriter.py
├── performance/                   # 2 benchmark files (latency, throughput)
│   ├── test_latency.py
│   └── test_throughput.py
└── e2e/
    ├── docker-compose.yml         # Full stack: 3x Postgres, Redis, Backend, Frontend, Visualizer, Playwright
    ├── .env                       # Test env vars (PROFILE=steel)
    ├── Makefile                   # e2e-up, e2e-test, e2e-down, etc.
    ├── README.md
    ├── .gitignore
    ├── playwright/                # Playwright TypeScript tests
    │   ├── Dockerfile
    │   ├── package.json
    │   ├── playwright.config.ts
    │   └── tests/
    │       ├── auth.setup.ts
    │       └── steel/ (5 spec files)
    ├── shared/                    # Common: postgres entrypoint, visualizer mock
    │   ├── config/
    │   │   ├── postgres/entrypoint.sh
    │   │   └── visualizer/ (Dockerfile + app.py)
    │   └── sql/ (00-extensions, 90-seed-users)
    └── steel/                     # Profile: SQL seeds + image generator
        ├── generate-test-images.py
        ├── images/
        └── sql/ (01-schema through 25-seed-alert-history — 15 SQL files)
```

## Target Structure

```
tests/
├── conftest.py                    # UPDATED: unified infra check (detect which profile is running)
├── pytest.ini                     # UPDATED: new markers, new testpaths
├── requirements-test.txt          # UPDATED: add any new deps
├── helpers/                       # STAYS (shared Python utilities)
├── factories/                     # STAYS (message generators)
├── fixtures/                      # STAYS (pytest fixtures)
│
└── e2e/
    ├── docker-compose.yml         # UPDATED: profiles for selective startup
    ├── .env                       # STAYS
    ├── Makefile                   # UPDATED: layer-based targets
    ├── README.md                  # UPDATED: new architecture docs
    ├── .gitignore                 # STAYS
    ├── conftest.py                # NEW: e2e-wide fixtures, shared test data, layer detection
    │
    ├── contracts/                  # ← MOVED from tests/integration/
    │   ├── __init__.py
    │   ├── conftest.py            # Queue setup/teardown (moved from integration tests' inline fixtures)
    │   ├── test_full_pipeline.py
    │   ├── test_inference_to_p2o.py
    │   └── test_p2o_to_dbwriter.py
    │
    ├── benchmarks/                 # ← MOVED from tests/performance/
    │   ├── __init__.py
    │   ├── test_latency.py
    │   └── test_throughput.py
    │
    ├── services/                   # NEW: single-service black-box tests (scaffold)
    │   ├── __init__.py
    │   ├── conftest.py            # Service container management fixtures
    │   ├── test_database_writer.py
    │   └── test_image_saver.py
    │
    ├── pipelines/                  # NEW: multi-service segment tests (scaffold)
    │   ├── __init__.py
    │   ├── conftest.py            # Pipeline fixtures
    │   ├── test_steel_pipeline.py
    │   └── test_multipoint.py
    │
    ├── ui/                         # ← MOVED from e2e/playwright/
    │   ├── Dockerfile
    │   ├── package.json
    │   ├── playwright.config.ts
    │   └── tests/
    │       ├── auth.setup.ts
    │       └── steel/
    │           ├── monitoring.spec.ts
    │           ├── search.spec.ts
    │           ├── defect-detail.spec.ts
    │           ├── multipoint.spec.ts
    │           └── alarm-history.spec.ts
    │
    ├── shared/                     # STAYS (common DB config, visualizer mock)
    │   ├── config/
    │   └── sql/
    │
    └── steel/                      # STAYS (profile-specific data + SQL seeds)
        ├── generate-test-images.py
        ├── images/
        └── sql/
```

## Detailed Implementation Steps

### Step 1: Read and Understand Current Code

Before making any changes, read ALL of these files completely:

- `tests/conftest.py`
- `tests/pytest.ini`
- `tests/requirements-test.txt`
- `tests/docker-compose.test.yml`
- All files in `tests/helpers/`
- All files in `tests/factories/`
- All files in `tests/fixtures/`
- All files in `tests/integration/`
- All files in `tests/performance/`
- `tests/e2e/docker-compose.yml`
- `tests/e2e/.env`
- `tests/e2e/Makefile`
- `tests/e2e/README.md`
- `tests/e2e/playwright/playwright.config.ts`
- `tests/e2e/playwright/package.json`
- `tests/e2e/playwright/tests/auth.setup.ts`
- All files in `tests/e2e/playwright/tests/steel/`
- `tests/e2e/shared/config/postgres/entrypoint.sh`
- `tests/e2e/shared/config/visualizer/app.py`
- `tests/e2e/shared/config/visualizer/Dockerfile`
- `tests/e2e/steel/generate-test-images.py`
- At least the first 3 SQL files in `tests/e2e/steel/sql/` to understand the schema

### Step 2: Move Files

**IMPORTANT:** Use `git mv` for all moves to preserve history.

#### 2a. Move integration → e2e/contracts
```bash
mkdir -p workspaces/strokmatic/visionking/tests/e2e/contracts
touch workspaces/strokmatic/visionking/tests/e2e/contracts/__init__.py
git mv workspaces/strokmatic/visionking/tests/integration/test_full_pipeline.py workspaces/strokmatic/visionking/tests/e2e/contracts/
git mv workspaces/strokmatic/visionking/tests/integration/test_inference_to_p2o.py workspaces/strokmatic/visionking/tests/e2e/contracts/
git mv workspaces/strokmatic/visionking/tests/integration/test_p2o_to_dbwriter.py workspaces/strokmatic/visionking/tests/e2e/contracts/
```

Then check if `tests/integration/` has a conftest.py or __init__.py — if so, move or adapt.

#### 2b. Move performance → e2e/benchmarks
```bash
mkdir -p workspaces/strokmatic/visionking/tests/e2e/benchmarks
touch workspaces/strokmatic/visionking/tests/e2e/benchmarks/__init__.py
git mv workspaces/strokmatic/visionking/tests/performance/test_latency.py workspaces/strokmatic/visionking/tests/e2e/benchmarks/
git mv workspaces/strokmatic/visionking/tests/performance/test_throughput.py workspaces/strokmatic/visionking/tests/e2e/benchmarks/
```

#### 2c. Move playwright → e2e/ui
```bash
# Move entire playwright/ directory contents to ui/
git mv workspaces/strokmatic/visionking/tests/e2e/playwright workspaces/strokmatic/visionking/tests/e2e/ui
```

After moving, update the docker-compose.yml playwright service's build context from `./playwright` to `./ui`.

#### 2d. Remove empty directories
```bash
rm -rf workspaces/strokmatic/visionking/tests/integration/
rm -rf workspaces/strokmatic/visionking/tests/performance/
```

#### 2e. Remove the old lightweight docker-compose
```bash
git rm workspaces/strokmatic/visionking/tests/docker-compose.test.yml
```

### Step 3: Update pytest Markers and Configuration

**`tests/pytest.ini`** — Update to:
```ini
[pytest]
markers =
    contract: message schema contract tests between services (require broker infrastructure)
    benchmark: performance benchmarks for latency and throughput (require broker infrastructure)
    service: single-service black-box tests (require full docker-compose)
    pipeline: multi-service pipeline segment tests (require full docker-compose)
asyncio_mode = auto
testpaths = e2e/contracts e2e/benchmarks e2e/services e2e/pipelines
pythonpath = .
```

The `pythonpath = .` ensures imports like `from factories.messages import ...` work from the new locations.

### Step 4: Update Test Markers

In the moved contract tests, rename the marker:
- `@pytest.mark.integration` → `@pytest.mark.contract`

In the moved benchmark tests, rename the marker:
- `@pytest.mark.performance` → `@pytest.mark.benchmark`

### Step 5: Update docker-compose.yml with Profiles

The unified `tests/e2e/docker-compose.yml` should support Docker Compose profiles:

Add a `rabbitmq` service (from the old `docker-compose.test.yml`) with profile `broker`:
```yaml
  rabbitmq:
    image: rabbitmq:3-management-alpine
    container_name: vk-test-rabbitmq
    ports:
      - "5673:5672"
      - "15673:15672"
    environment:
      RABBITMQ_DEFAULT_USER: test
      RABBITMQ_DEFAULT_PASS: test
    healthcheck:
      test: rabbitmq-diagnostics -q ping
      interval: 5s
      timeout: 10s
      retries: 5
    profiles: ["broker", "pipeline", "full"]
```

Similarly for a test Redis and a simple test PostgreSQL (single instance for contracts):
```yaml
  pg-test:
    image: postgres:15-alpine
    container_name: vk-test-postgres
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: visionking_test
    healthcheck:
      test: pg_isready -U test
      interval: 5s
      timeout: 10s
      retries: 5
    profiles: ["broker", "pipeline"]
```

The existing services (pg-point1, pg-point2, pg-point3, redis, backend, frontend, visualizer, playwright) should get profile `full`.

**Profile mapping:**
| Profile | Services | Use case |
|---------|----------|----------|
| `broker` | rabbitmq, redis-test, pg-test | Contract tests, benchmarks |
| `pipeline` | broker + pipeline services (future) | Service/pipeline tests |
| `full` | All existing services + broker | UI tests |

**IMPORTANT**: The existing services that currently have NO profile should be updated to have `profiles: ["full"]`, EXCEPT the services that are needed for multiple profiles. If a service has no `profiles:` key, Docker Compose starts it by default — we want selective startup.

### Step 6: Update Root conftest.py

The root `tests/conftest.py` should be updated to detect which infrastructure is available and skip tests accordingly. It should check for:
1. Broker infrastructure (RabbitMQ on 5673) → enables contract + benchmark tests
2. Full infrastructure (backend on 5777, frontend on 4280) → enables service + pipeline + UI tests

```python
import subprocess, socket, pytest

def _port_open(host, port, timeout=2):
    """Check if a TCP port is accepting connections."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (ConnectionRefusedError, TimeoutError, OSError):
        return False

@pytest.fixture(scope="session", autouse=True)
def check_infrastructure(request):
    """Auto-detect available test infrastructure and skip incompatible tests."""
    markers = [m.name for m in request.node.iter_markers()]

    rabbit_host = os.environ.get("TEST_RABBIT_HOST", "localhost")
    broker_up = _port_open(rabbit_host, 5673)
    backend_up = _port_open("localhost", 5777)

    # Contract and benchmark tests need broker
    if request.node.get_closest_marker("contract") or request.node.get_closest_marker("benchmark"):
        if not broker_up:
            pytest.skip("Broker infrastructure not running (RabbitMQ:5673). Start with: make e2e-up LAYER=broker")

    # Service and pipeline tests need full stack
    if request.node.get_closest_marker("service") or request.node.get_closest_marker("pipeline"):
        if not backend_up:
            pytest.skip("Full infrastructure not running (backend:5777). Start with: make e2e-up LAYER=full")
```

### Step 7: Create e2e/conftest.py

A new conftest at the e2e level that provides shared fixtures for all e2e test layers:

```python
"""E2E-wide fixtures and shared test data from the steel seed."""
import pytest

# Known test data from SQL seeds — use these in service and pipeline tests
# to validate against real seeded data instead of synthetic factories.

STEEL_SEED = {
    "barras": {
        # Barra code → { host_id, material_id, peca_count, expected_defect_count }
        "F18021100501": {"host_id": 1, "material_id": 99, "peca_count": 10, "defects": 138},
        "F04842000201": {"host_id": 1, "material_id": 167, "peca_count": 10, "defects": 2108},
        "F21641200201": {"host_id": 2, "material_id": 68, "peca_count": 9, "defects": 0},
        "F19801300101": {"host_id": 2, "material_id": 61, "peca_count": 9, "defects": 3434},
    },
    "defect_classes": [
        "Defeito", "Risco", "Pó Fluxante", "Marca Mecânica",
        "Carepa", "Amassamento", "Risco Leve", "Trinca"
    ],
    "total_pecas": 271,
    "total_frames": 1084,
    "total_defects": 32098,
    "cameras_per_peca": 2,
    "frames_per_camera": 2,
    "frame_dimensions": {"width": 1624, "height": 1240},
}
```

Expand this with more data points extracted from the SQL seed files. Read the SQL files carefully to get accurate numbers.

### Step 8: Update Makefile

The Makefile at `tests/e2e/Makefile` needs layer-based targets. Update it to support:

```makefile
PROFILE ?= steel
LAYER ?= all

# === Infrastructure Lifecycle ===

# Start broker-only infrastructure (for contracts + benchmarks)
e2e-up-broker:
	docker-compose -f docker-compose.yml --profile broker up -d --build --wait

# Start full infrastructure (for UI + service + pipeline tests)
e2e-up-full: e2e-images
	docker-compose -f docker-compose.yml --profile full up -d --build --wait

# Smart start: detect layer and start appropriate infra
e2e-up:
ifeq ($(LAYER),contracts)
	$(MAKE) e2e-up-broker
else ifeq ($(LAYER),benchmarks)
	$(MAKE) e2e-up-broker
else
	$(MAKE) e2e-up-full
endif

# === Test Execution ===

# Run contract tests
e2e-test-contracts:
	cd .. && python -m pytest e2e/contracts/ -v -m contract

# Run benchmark tests
e2e-test-benchmarks:
	cd .. && python -m pytest e2e/benchmarks/ -v -m benchmark

# Run service tests
e2e-test-services:
	cd .. && python -m pytest e2e/services/ -v -m service

# Run pipeline tests
e2e-test-pipelines:
	cd .. && python -m pytest e2e/pipelines/ -v -m pipeline

# Run UI tests via Playwright in Docker
e2e-test-ui:
	docker-compose -f docker-compose.yml --profile test run --rm playwright

# Run UI tests locally (requires npm install)
e2e-test-ui-local:
	cd ui && npx playwright test

# Smart test: detect layer
e2e-test:
ifeq ($(LAYER),contracts)
	$(MAKE) e2e-test-contracts
else ifeq ($(LAYER),benchmarks)
	$(MAKE) e2e-test-benchmarks
else ifeq ($(LAYER),services)
	$(MAKE) e2e-test-services
else ifeq ($(LAYER),pipelines)
	$(MAKE) e2e-test-pipelines
else ifeq ($(LAYER),ui)
	$(MAKE) e2e-test-ui
else
	$(MAKE) e2e-test-contracts
	$(MAKE) e2e-test-benchmarks
	$(MAKE) e2e-test-services
	$(MAKE) e2e-test-pipelines
	$(MAKE) e2e-test-ui
endif

# === Cleanup ===
e2e-down:
	docker-compose -f docker-compose.yml --profile full --profile broker down -v
```

Keep ALL existing targets that still make sense (e2e-images, e2e-status, e2e-logs, e2e-db-shell, etc.).

### Step 9: Create Service Test Scaffolds

Create `tests/e2e/services/test_database_writer.py`:

```python
"""
Black-box tests for the database-writer service.

These tests start the database-writer container, publish messages
to its input queue, and verify rows appear in PostgreSQL.

Uses real seed data structure to validate the same message format
that production uses.

Requires: make e2e-up LAYER=full
"""
import pytest
import uuid
from factories.messages import make_pipeline_message

pytestmark = [pytest.mark.service, pytest.mark.asyncio]


class TestDatabaseWriter:
    """Verify database-writer correctly persists pipeline messages to PostgreSQL."""

    async def test_single_frame_persisted(self):
        """Publish one complete message → verify frame + peca rows created."""
        # TODO: Implement when database-writer is added to docker-compose
        # 1. Publish message to dw-sis-surface-queue
        # 2. Wait for processing (poll DB or use a short sleep)
        # 3. Query pg-point1 for the frame by UUID
        # 4. Assert frame row exists with correct metadata
        # 5. Assert peca row exists
        # 6. Assert defect rows match message defect count
        pytest.skip("Requires database-writer service in docker-compose")

    async def test_defects_with_3d_coordinates(self):
        """Publish message with 3D coords → verify defeitos table has x_ct, y_ct, z_ct."""
        pytest.skip("Requires database-writer service in docker-compose")

    async def test_batch_mode_processes_multiple_messages(self):
        """Publish 5 messages rapidly → verify all 5 frames persisted."""
        pytest.skip("Requires database-writer service in docker-compose")

    async def test_duplicate_frame_uuid_handled(self):
        """Publish same frame_uuid twice → verify no crash, idempotent insert."""
        pytest.skip("Requires database-writer service in docker-compose")

    async def test_vk_steel_message_with_tracking(self):
        """Publish vk-steel message → verify PLC tracking fields stored."""
        pytest.skip("Requires database-writer service in docker-compose")
```

Create `tests/e2e/services/test_image_saver.py`:

```python
"""
Black-box tests for the image-saver service.

Publishes messages to the image-saver input queue and verifies
that frame images are saved to disk and the message is enriched
with frame_path before being forwarded.

Requires: make e2e-up LAYER=full
"""
import pytest
from factories.messages import make_pipeline_message

pytestmark = [pytest.mark.service, pytest.mark.asyncio]


class TestImageSaver:
    """Verify image-saver saves frames and enriches messages."""

    async def test_frame_saved_to_disk(self):
        """Publish frame message → verify .bin file created in img_saved/."""
        pytest.skip("Requires image-saver service in docker-compose")

    async def test_message_enriched_with_frame_path(self):
        """Publish message → consume from output queue → verify frame_path added."""
        pytest.skip("Requires image-saver service in docker-compose")

    async def test_directory_structure_matches_convention(self):
        """Verify saved path follows img_saved/{part_uuid}/{camera_serial}/{frame_uuid}.bin."""
        pytest.skip("Requires image-saver service in docker-compose")
```

### Step 10: Create Pipeline Test Scaffolds

Create `tests/e2e/pipelines/test_steel_pipeline.py`:

```python
"""
End-to-end pipeline tests for the vk-steel application profile.

Publishes raw camera-acquisition messages and traces them through
the full pipeline: image-saver → inference → pixel-to-object → database-writer.

Verifies that data is correctly persisted and matches the expected
seed data patterns (defect classes, bounding boxes, 3D coordinates).

Uses real seed data from tests/e2e/steel/sql/ as reference.

Requires: make e2e-up LAYER=full (with pipeline services)
"""
import pytest
from factories.messages import make_pipeline_message

pytestmark = [pytest.mark.pipeline, pytest.mark.asyncio]


class TestSteelPipeline:
    """Full vk-steel pipeline: camera → image-saver → inference → p2o → db-writer."""

    async def test_frame_flows_through_complete_pipeline(self):
        """
        Publish camera-acquisition message with known frame data.
        Wait for pipeline completion.
        Verify: image saved, defects detected, 3D coords computed, DB row created.
        """
        # TODO: Implement when all pipeline services are in docker-compose
        # 1. Create message matching seed data format
        # 2. Publish to image-saver input queue
        # 3. Poll database-writer output (DB rows) with timeout
        # 4. Verify frame + peca + defects persisted
        pytest.skip("Requires full pipeline services in docker-compose")

    async def test_clean_frame_no_defects(self):
        """Frame with no defects should flow through and create frame row with 0 defeitos."""
        pytest.skip("Requires full pipeline services in docker-compose")

    async def test_plc_tracking_preserved_end_to_end(self):
        """PLC tracking fields (corrida, comp_tar, secao_tar) survive all 4 hops."""
        pytest.skip("Requires full pipeline services in docker-compose")

    async def test_multiple_cameras_same_peca(self):
        """Two frames from different cameras for the same peca → both persisted correctly."""
        pytest.skip("Requires full pipeline services in docker-compose")
```

Create `tests/e2e/pipelines/test_multipoint.py`:

```python
"""
Multi-point pipeline tests.

Verifies that data from different inspection points (host_id 1 vs 2)
is correctly routed to the appropriate PostgreSQL instances and that
the aggregate database (point 3) receives all data.

Uses the 3-point PostgreSQL topology from docker-compose.yml.

Requires: make e2e-up LAYER=full
"""
import pytest

pytestmark = [pytest.mark.pipeline, pytest.mark.asyncio]


class TestMultipoint:
    """Multi-point data routing and aggregation."""

    async def test_host1_data_in_point1_only(self):
        """Data tagged host_id=1 appears in pg-point1 but not pg-point2."""
        pytest.skip("Requires pipeline services in docker-compose")

    async def test_host2_data_in_point2_only(self):
        """Data tagged host_id=2 appears in pg-point2 but not pg-point1."""
        pytest.skip("Requires pipeline services in docker-compose")

    async def test_aggregate_has_all_data(self):
        """pg-point3 (aggregate) contains data from both hosts."""
        pytest.skip("Requires pipeline services in docker-compose")
```

### Step 11: Update docker-compose.yml References

After moving `playwright/` → `ui/`, update ALL references in:
- `docker-compose.yml`: playwright service build context `./playwright` → `./ui`
- `Makefile`: any path references to `playwright/` → `ui/`
- `README.md`: update all path references

### Step 12: Update README.md

Rewrite the README to document the new architecture:

- Layer diagram showing contracts → benchmarks → services → pipelines → ui
- How to run each layer independently
- Infrastructure requirements per layer
- Data flow from seed SQL → factories → test assertions

### Step 13: Create conftest.py files for new directories

Each new directory (contracts, benchmarks, services, pipelines) needs a `conftest.py` that:
1. Imports the appropriate fixtures from `tests/fixtures/`
2. Sets up any layer-specific fixtures

For `contracts/conftest.py`:
```python
"""Contract test fixtures — queue declaration and purge."""
import pytest
import pytest_asyncio
from helpers.rabbit_helpers import get_connection, purge_queue

# Import shared fixtures so they're available to tests
from fixtures.env import test_env  # noqa: F401
from fixtures.rabbit import rabbit_connection, rabbit_channel  # noqa: F401
```

### Step 14: Verify Imports Work

After all moves, verify that imports still resolve:
```bash
cd workspaces/strokmatic/visionking/tests
python -c "from factories.messages import make_pipeline_message; print('OK')"
python -c "from helpers.rabbit_helpers import get_connection; print('OK')"
python -c "from fixtures.env import test_env; print('OK')"
```

If these fail, add `sys.path` manipulation in the root conftest.py:
```python
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
```

### Step 15: Validate Everything Works

**This step is MANDATORY before committing.** You must verify that the restructure didn't break anything.

#### 15a. Verify Python imports resolve from the new locations

```bash
cd workspaces/strokmatic/visionking/tests
python -c "from factories.messages import make_pipeline_message; print('factories OK')"
python -c "from helpers.rabbit_helpers import get_connection; print('helpers OK')"
python -c "from helpers.postgres_helpers import get_connection; print('postgres helpers OK')"
python -c "from helpers.redis_helpers import get_redis_client; print('redis helpers OK')"
python -c "from helpers.timing import TimingResult, LatencyTracker; print('timing OK')"
```

#### 15b. Verify pytest collects all tests correctly

```bash
cd workspaces/strokmatic/visionking/tests

# Collect contract tests (should find 3 files with all their test methods)
python -m pytest e2e/contracts/ --collect-only -q 2>&1 | tail -5

# Collect benchmark tests (should find 2 files)
python -m pytest e2e/benchmarks/ --collect-only -q 2>&1 | tail -5

# Collect service tests (should find 2 files, all skipped)
python -m pytest e2e/services/ --collect-only -q 2>&1 | tail -5

# Collect pipeline tests (should find 2 files, all skipped)
python -m pytest e2e/pipelines/ --collect-only -q 2>&1 | tail -5

# Collect ALL pytest tests
python -m pytest --collect-only -q 2>&1 | tail -10
```

If `--collect-only` fails with import errors, fix them before proceeding. Common issues:
- Missing `__init__.py` files
- `pythonpath` not set in pytest.ini
- Fixture imports not resolving

#### 15c. Dry-run the contract and benchmark tests (they will skip if infra is down, but must not error)

```bash
cd workspaces/strokmatic/visionking/tests
python -m pytest e2e/contracts/ e2e/benchmarks/ -v --tb=short 2>&1 | tail -20
```

Expected: all tests should be **SKIPPED** (not ERROR) because the broker infrastructure isn't running inside the sandbox. If any test shows ERROR instead of SKIP, fix the issue.

#### 15d. Run the scaffold tests (should all skip cleanly)

```bash
cd workspaces/strokmatic/visionking/tests
python -m pytest e2e/services/ e2e/pipelines/ -v --tb=short 2>&1 | tail -20
```

Expected: all tests show SKIPPED with clear messages.

#### 15e. Verify old directories are gone

```bash
# These directories should NOT exist anymore
ls workspaces/strokmatic/visionking/tests/integration/ 2>&1   # Should say "No such file"
ls workspaces/strokmatic/visionking/tests/performance/ 2>&1   # Should say "No such file"
ls workspaces/strokmatic/visionking/tests/docker-compose.test.yml 2>&1  # Should say "No such file"
ls workspaces/strokmatic/visionking/tests/e2e/playwright/ 2>&1  # Should say "No such file"
```

#### 15f. Verify new structure exists

```bash
# These should all exist
ls workspaces/strokmatic/visionking/tests/e2e/contracts/test_full_pipeline.py
ls workspaces/strokmatic/visionking/tests/e2e/benchmarks/test_latency.py
ls workspaces/strokmatic/visionking/tests/e2e/ui/playwright.config.ts
ls workspaces/strokmatic/visionking/tests/e2e/services/test_database_writer.py
ls workspaces/strokmatic/visionking/tests/e2e/pipelines/test_steel_pipeline.py
ls workspaces/strokmatic/visionking/tests/e2e/conftest.py
```

#### 15g. Verify Makefile syntax

```bash
cd workspaces/strokmatic/visionking/tests/e2e
make -n e2e-test-contracts 2>&1  # Dry-run, should show the pytest command
make -n e2e-test-benchmarks 2>&1
make -n e2e-test-ui 2>&1
```

#### 15h. Verify docker-compose.yml is valid YAML with profiles

```bash
cd workspaces/strokmatic/visionking/tests/e2e
docker compose config --profiles 2>&1 | head -5  # Should list: broker, full, pipeline, test
# OR if docker compose is not available:
python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml')); print('YAML valid')"
```

**If any validation step fails, fix the issue before committing.** Do not proceed to commits with broken imports, collection errors, or invalid YAML.

### Step 16: Commit

Make multiple focused commits:
1. `refactor(tests): move integration tests to e2e/contracts`
2. `refactor(tests): move performance tests to e2e/benchmarks`
3. `refactor(tests): move playwright tests to e2e/ui`
4. `feat(tests): add service and pipeline test scaffolds`
5. `feat(tests): update docker-compose with profile support`
6. `feat(tests): update Makefile with layer-based targets`
7. `docs(tests): update README with new test architecture`

## Important Notes

- **All paths are relative to the JARVIS repo root** (e.g., `workspaces/strokmatic/visionking/tests/...`)
- **DO NOT modify any service source code** — only touch files under `tests/`
- **Preserve all existing test logic** — moves should not change test behavior
- **Factories, helpers, fixtures stay at `tests/` level** — they're shared across all layers
- **Use `git mv`** for all file moves to preserve git history
- **The old `docker-compose.test.yml`** at `tests/` level should be removed (its services are merged into `e2e/docker-compose.yml` as the `broker` profile)
- **Keep the `.gitignore` in e2e/** — it excludes generated images (~550MB), node_modules, and test artifacts
- **The service and pipeline tests are intentionally scaffolds with `pytest.skip()`** — they document the test plan for when those services are added to docker-compose
