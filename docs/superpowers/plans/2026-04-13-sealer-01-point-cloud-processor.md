# SEALER-01: Point Cloud Processor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `point-cloud-processor` Python microservice that accumulates multi-frame 3D scans per VIN, merges point clouds, **best-fit registers them against the part CAD STL (Stage 5, added 2026-05-07)**, stitches 2D images, and generates depth maps for the VisionKing sealer pipeline. `merged.ply`, `depth_map.npy`, and the published message are all expressed in CAD coordinates on success.

**Architecture:** Redis-based scan accumulator (DieMaster StrokeAccumulator pattern) with async aio-pika RabbitMQ consumer. Processing pipeline runs **7 sequential stages** when a scan completes. Runtime-tunable parameters stored in Redis DB3 `settings` hash.

**Tech Stack:** Python 3.10, Open3D, OpenCV, numpy, aio-pika, redis, loguru, pydantic, pytest, fakeredis

**Spec:** `docs/superpowers/specs/2026-04-13-sealer-01-point-cloud-processor-design.md`

**Monorepo:** `workspaces/strokmatic/visionking/`

**Service path:** `services/point-cloud-processor/`

---

## File Structure

```
services/point-cloud-processor/
├── visionking-point-cloud-processor.py              # Entry point (async main)
├── visionking-point-cloud-processor.req             # Python dependencies
├── visionking-point-cloud-processor.Dockerfile      # Two-stage slim build
├── src/
│   ├── __init__.py
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── read_env_var.py                          # PCP_* env vars
│   │   └── connections.py                           # Redis + RabbitMQ factory
│   ├── communication_clients/
│   │   ├── __init__.py
│   │   ├── rabbit_client.py                         # Async aio-pika (copy from database-writer)
│   │   ├── config.py                                # BrokerConfig dataclasses (copy from database-writer)
│   │   └── exceptions.py                            # RabbitMQ exceptions (copy from database-writer)
│   ├── accumulator/
│   │   ├── __init__.py
│   │   └── scan_accumulator.py                      # Redis hash accumulation per VIN
│   ├── settings/
│   │   ├── __init__.py
│   │   └── redis_settings.py                        # Read runtime settings from Redis DB3
│   ├── calibration/
│   │   ├── __init__.py
│   │   ├── factory_calibration.py                   # Camera intrinsics from Hikrobot .hibag
│   │   └── cad_loader.py                            # Stage 5 helper: STL load + sample + mtime cache
│   └── pipeline/
│       ├── __init__.py
│       ├── runner.py                                # Orchestrate stages 1-7
│       ├── loader.py                                # Stage 1: load PLY + BIN from disk
│       ├── outlier_removal.py                       # Stage 2: SOR per frame
│       ├── registration.py                          # Stage 3: translation by encoder position
│       ├── merge.py                                 # Stage 4: concatenation + voxel downsample
│       ├── cad_registration.py                      # Stage 5: best-fit ICP merged ↔ part.stl
│       ├── stitching.py                             # Stage 6: undistort + translate + feathering
│       └── depth_map.py                             # Stage 7: Z projection (CAD frame) to numpy + origin/resolution metadata
└── tests/
    ├── __init__.py
    ├── conftest.py                                  # Shared fixtures (fakeredis, tmpdir, synthetic data)
    ├── test_scan_accumulator.py
    ├── test_redis_settings.py
    ├── test_loader.py
    ├── test_outlier_removal.py
    ├── test_registration.py
    ├── test_merge.py
    ├── test_cad_loader.py
    ├── test_cad_registration.py
    ├── test_stitching.py
    ├── test_depth_map.py
    ├── test_integration_cad.py
    └── test_runner.py
```

---

## Task 1: Scaffold service and copy shared infrastructure

**Files:**
- Create: `services/point-cloud-processor/visionking-point-cloud-processor.req`
- Create: `services/point-cloud-processor/visionking-point-cloud-processor.Dockerfile`
- Create: `services/point-cloud-processor/src/__init__.py`
- Create: `services/point-cloud-processor/src/utils/__init__.py`
- Create: `services/point-cloud-processor/src/utils/read_env_var.py`
- Create: `services/point-cloud-processor/src/utils/connections.py`
- Copy: `services/point-cloud-processor/src/communication_clients/` (from database-writer)
- Create: `services/point-cloud-processor/tests/__init__.py`

- [ ] **Step 1: Create requirements file**

```
# visionking-point-cloud-processor.req
open3d==0.18.0
numpy>=1.24,<2.0
opencv-python-headless>=4.8,<5.0
aio-pika==9.5.5
redis>=5.0,<6.0
fakeredis>=2.20,<3.0
loguru>=0.7,<1.0
pydantic>=2.0,<3.0
python-dotenv>=1.0,<2.0
pytest>=8.0,<9.0
pytest-asyncio>=0.23,<1.0
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
# visionking-point-cloud-processor.Dockerfile
# Stage 1: Build
FROM python:3.10-slim as builder
ENV TZ=America/Sao_Paulo
RUN python3 -m venv /venv
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libgl1-mesa-glx libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*
COPY *.req .
RUN /venv/bin/pip install --no-cache-dir -r *.req

# Stage 2: Runtime
FROM python:3.10-slim
COPY --from=builder /venv /venv
ENV TZ=America/Sao_Paulo
ENV PATH="/venv/bin:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1000 strokmatic && useradd -u 1000 -g strokmatic -m strokmatic
WORKDIR /home/strokmatic
COPY . .
CMD ["python3", "./visionking-point-cloud-processor.py"]
```

- [ ] **Step 3: Create read_env_var.py**

```python
# src/utils/read_env_var.py
import os
import json

# RabbitMQ
PCP_RABBIT_BROKER_HOST = os.getenv("PCP_RABBIT_BROKER_HOST", os.getenv("BROKER_HOST", "localhost"))
PCP_RABBIT_PORT = int(os.getenv("PCP_RABBIT_PORT", os.getenv("RABBIT_PORT", "5672")))
PCP_RABBIT_USER = os.getenv("PCP_RABBIT_USER", os.getenv("RABBIT_USER", "guest"))
PCP_RABBIT_PASS = os.getenv("PCP_RABBIT_PASS", os.getenv("RABBIT_PASS", "guest"))
PCP_RABBIT_INPUT_QUEUE = os.getenv("PCP_RABBIT_INPUT_QUEUE", "sealer-processed-queue")
PCP_RABBIT_MEASUREMENT_QUEUE = os.getenv("PCP_RABBIT_MEASUREMENT_QUEUE", "sealer-measurement-queue")
PCP_RABBIT_INFERENCE_QUEUE = os.getenv("PCP_RABBIT_INFERENCE_QUEUE", "sealer-inference-queue")
PCP_RABBIT_DURABLE = os.getenv("PCP_RABBIT_DURABLE", "True").strip().lower() == "true"
PCP_RABBIT_PREFETCH_COUNT = int(os.getenv("PCP_RABBIT_PREFETCH_COUNT", "1"))
PCP_RABBIT_MAX_RETRIES = int(os.getenv("PCP_RABBIT_MAX_RETRIES", "10"))

# Redis — accumulator
PCP_REDIS_HOST = os.getenv("PCP_REDIS_HOST", os.getenv("REDIS_HOST", "localhost"))
PCP_REDIS_PORT = int(os.getenv("PCP_REDIS_PORT", os.getenv("REDIS_PORT", "4000")))
PCP_REDIS_PASS = os.getenv("PCP_REDIS_PASS", os.getenv("REDIS_PASSWORD", ""))
PCP_REDIS_DB_ACCUMULATOR = int(os.getenv("PCP_REDIS_DB_ACCUMULATOR", "5"))

# Redis — settings (DB3)
PCP_REDIS_DB_SETTINGS = int(os.getenv("PCP_REDIS_DB_SETTINGS", os.getenv("REDIS_DB_SETTINGS", "3")))
PCP_REDIS_HASH_SETTINGS = os.getenv("PCP_REDIS_HASH_SETTINGS", "settings")

# Accumulator
PCP_SCAN_TIMEOUT = int(os.getenv("PCP_SCAN_TIMEOUT", "30"))
PCP_SCAN_TTL = int(os.getenv("PCP_SCAN_TTL", "300"))
PCP_FRAME_TIMESTAMP_TOLERANCE_MS = int(os.getenv("PCP_FRAME_TIMESTAMP_TOLERANCE_MS", "60000"))

# Processing — fixed at deploy
PCP_SHIFT_UNIT_VECTOR = json.loads(os.getenv("PCP_SHIFT_UNIT_VECTOR", "[0, 1, 0]"))
PCP_CAMERA_CALIBRATION_FILE = os.getenv("PCP_CAMERA_CALIBRATION_FILE", "")

# Logging
PCP_LOGGING_LEVEL = os.getenv("PCP_LOGGING_LEVEL", os.getenv("LOG_LEVEL", "INFO")).upper()
```

- [ ] **Step 4: Create connections.py**

```python
# src/utils/connections.py
import redis
from loguru import logger

from src.communication_clients.rabbit_client import RabbitClient
from src.communication_clients.config import BrokerConfig, BrokerAddress, Credentials
from src.utils.read_env_var import *


def create_rabbit_client() -> RabbitClient:
    """Create async RabbitMQ client (not yet connected)."""
    config = BrokerConfig(
        broker_address=BrokerAddress(ip=PCP_RABBIT_BROKER_HOST, port=PCP_RABBIT_PORT),
        credentials=Credentials(user=PCP_RABBIT_USER, password=PCP_RABBIT_PASS),
        input_queue=PCP_RABBIT_INPUT_QUEUE,
        output_queue=[PCP_RABBIT_MEASUREMENT_QUEUE, PCP_RABBIT_INFERENCE_QUEUE],
        durable=PCP_RABBIT_DURABLE,
        prefetch_count=PCP_RABBIT_PREFETCH_COUNT,
        max_retries=PCP_RABBIT_MAX_RETRIES,
        retry_delay=5,
    )
    return RabbitClient(config)


def create_redis_accumulator() -> redis.Redis:
    """Create Redis client for scan accumulation."""
    return redis.Redis(
        host=PCP_REDIS_HOST,
        port=PCP_REDIS_PORT,
        password=PCP_REDIS_PASS or None,
        db=PCP_REDIS_DB_ACCUMULATOR,
        decode_responses=True,
    )


def create_redis_settings() -> redis.Redis:
    """Create Redis client for settings (DB3)."""
    return redis.Redis(
        host=PCP_REDIS_HOST,
        port=PCP_REDIS_PORT,
        password=PCP_REDIS_PASS or None,
        db=PCP_REDIS_DB_SETTINGS,
        decode_responses=True,
    )
```

- [ ] **Step 5: Copy communication_clients from database-writer**

Copy these files from `services/database-writer/src/communication_clients/`:
- `rabbit_client.py`
- `config.py`
- `exceptions.py`
- `__init__.py`

No modifications needed — they are generic.

```bash
cd workspaces/strokmatic/visionking
mkdir -p services/point-cloud-processor/src/communication_clients
cp services/database-writer/src/communication_clients/{rabbit_client,config,exceptions,__init__}.py \
   services/point-cloud-processor/src/communication_clients/
```

- [ ] **Step 6: Create empty __init__.py files**

```bash
touch services/point-cloud-processor/src/__init__.py
touch services/point-cloud-processor/src/utils/__init__.py
touch services/point-cloud-processor/src/accumulator/__init__.py
touch services/point-cloud-processor/src/settings/__init__.py
touch services/point-cloud-processor/src/pipeline/__init__.py
touch services/point-cloud-processor/tests/__init__.py
```

- [ ] **Step 7: Commit scaffold**

```bash
cd workspaces/strokmatic/visionking
git add services/point-cloud-processor/
git commit -m "feat(sealer): scaffold point-cloud-processor service

SEALER-01: directory structure, requirements, Dockerfile,
env vars, connections, and shared communication clients."
```

---

## Task 2: Redis Settings Reader

**Files:**
- Create: `services/point-cloud-processor/src/settings/redis_settings.py`
- Create: `services/point-cloud-processor/tests/conftest.py`
- Create: `services/point-cloud-processor/tests/test_redis_settings.py`

- [ ] **Step 1: Write conftest.py with shared fixtures**

```python
# tests/conftest.py
import pytest
import fakeredis


@pytest.fixture
def redis_accumulator():
    """Fake Redis for accumulator DB."""
    r = fakeredis.FakeRedis(decode_responses=True)
    yield r
    r.flushdb()


@pytest.fixture
def redis_settings():
    """Fake Redis for settings DB3."""
    r = fakeredis.FakeRedis(decode_responses=True)
    yield r
    r.flushdb()
```

- [ ] **Step 2: Write failing tests for redis_settings**

```python
# tests/test_redis_settings.py
import json
import pytest
from src.settings.redis_settings import SealerSettings


class TestSealerSettings:
    def test_reads_model_frames_map(self, redis_settings):
        redis_settings.hset("settings", "sealer_model_frames_map",
                            json.dumps({"CRETA_2026": 20, "HB20_2025": 18}))
        settings = SealerSettings(redis_settings, "settings")

        assert settings.get_expected_frames("CRETA_2026") == 20
        assert settings.get_expected_frames("HB20_2025") == 18

    def test_returns_none_when_model_type_absent(self, redis_settings):
        redis_settings.hset("settings", "sealer_model_frames_map",
                            json.dumps({"CRETA_2026": 20}))
        settings = SealerSettings(redis_settings, "settings")

        assert settings.get_expected_frames("UNKNOWN_MODEL") is None

    def test_returns_none_when_hash_missing(self, redis_settings):
        settings = SealerSettings(redis_settings, "settings")

        assert settings.get_expected_frames("CRETA_2026") is None

    def test_returns_none_when_field_missing(self, redis_settings):
        redis_settings.hset("settings", "other_field", "value")
        settings = SealerSettings(redis_settings, "settings")

        assert settings.get_expected_frames("CRETA_2026") is None

    def test_reads_outlier_nb_neighbors_default(self, redis_settings):
        settings = SealerSettings(redis_settings, "settings")
        assert settings.outlier_nb_neighbors == 20

    def test_reads_outlier_nb_neighbors_from_redis(self, redis_settings):
        redis_settings.hset("settings", "sealer_outlier_nb_neighbors", "30")
        settings = SealerSettings(redis_settings, "settings")
        settings.reload()
        assert settings.outlier_nb_neighbors == 30

    def test_reads_outlier_std_ratio_default(self, redis_settings):
        settings = SealerSettings(redis_settings, "settings")
        assert settings.outlier_std_ratio == 2.0

    def test_reads_voxel_size_default(self, redis_settings):
        settings = SealerSettings(redis_settings, "settings")
        assert settings.voxel_size == 0.5

    def test_reads_depth_map_resolution_default(self, redis_settings):
        settings = SealerSettings(redis_settings, "settings")
        assert settings.depth_map_resolution_mm == 0.5

    def test_reads_image_pixels_per_mm_default(self, redis_settings):
        settings = SealerSettings(redis_settings, "settings")
        assert settings.image_pixels_per_mm is None

    def test_reads_image_pixels_per_mm_from_redis(self, redis_settings):
        redis_settings.hset("settings", "sealer_image_pixels_per_mm", "2.5")
        settings = SealerSettings(redis_settings, "settings")
        settings.reload()
        assert settings.image_pixels_per_mm == 2.5

    def test_reload_picks_up_changes(self, redis_settings):
        redis_settings.hset("settings", "sealer_voxel_size", "0.3")
        settings = SealerSettings(redis_settings, "settings")
        settings.reload()
        assert settings.voxel_size == 0.3

        redis_settings.hset("settings", "sealer_voxel_size", "0.8")
        settings.reload()
        assert settings.voxel_size == 0.8
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd workspaces/strokmatic/visionking/services/point-cloud-processor
python -m pytest tests/test_redis_settings.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.settings.redis_settings'`

- [ ] **Step 4: Implement redis_settings.py**

```python
# src/settings/redis_settings.py
"""Runtime settings reader from Redis DB3 `settings` hash.

All sealer-specific settings are prefixed with `sealer_` in the hash.
Settings are read on-demand via reload() — call before each scan pipeline.
"""

import json
from typing import Optional

from loguru import logger


class SealerSettings:
    """Reads sealer processing parameters from Redis DB3 settings hash."""

    def __init__(self, redis_client, hash_name: str = "settings"):
        self._redis = redis_client
        self._hash = hash_name

        # Defaults
        self.outlier_nb_neighbors: int = 20
        self.outlier_std_ratio: float = 2.0
        self.voxel_size: float = 0.5
        self.image_pixels_per_mm: Optional[float] = None
        self.depth_map_resolution_mm: float = 0.5

        self._model_frames_map: dict[str, int] = {}

    def reload(self) -> None:
        """Reload all settings from Redis. Call before each scan pipeline."""
        self._load_field_int("sealer_outlier_nb_neighbors", "outlier_nb_neighbors", 20)
        self._load_field_float("sealer_outlier_std_ratio", "outlier_std_ratio", 2.0)
        self._load_field_float("sealer_voxel_size", "voxel_size", 0.5)
        self._load_field_float("sealer_image_pixels_per_mm", "image_pixels_per_mm", None)
        self._load_field_float("sealer_depth_map_resolution_mm", "depth_map_resolution_mm", 0.5)
        self._load_model_frames_map()

    def get_expected_frames(self, model_type: str) -> Optional[int]:
        """Get expected frame count for a model type. Returns None if unknown."""
        self._load_model_frames_map()
        return self._model_frames_map.get(model_type)

    def _load_model_frames_map(self) -> None:
        raw = self._redis.hget(self._hash, "sealer_model_frames_map")
        if raw is None:
            self._model_frames_map = {}
            return
        try:
            self._model_frames_map = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            logger.warning(f"Invalid JSON in sealer_model_frames_map: {raw}")
            self._model_frames_map = {}

    def _load_field_int(self, redis_field: str, attr: str, default: int) -> None:
        raw = self._redis.hget(self._hash, redis_field)
        if raw is not None:
            try:
                setattr(self, attr, int(raw))
            except (ValueError, TypeError):
                logger.warning(f"Invalid int for {redis_field}: {raw}, using default {default}")
                setattr(self, attr, default)

    def _load_field_float(self, redis_field: str, attr: str, default: Optional[float]) -> None:
        raw = self._redis.hget(self._hash, redis_field)
        if raw is not None:
            try:
                setattr(self, attr, float(raw))
            except (ValueError, TypeError):
                logger.warning(f"Invalid float for {redis_field}: {raw}, using default {default}")
                setattr(self, attr, default)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd workspaces/strokmatic/visionking/services/point-cloud-processor
python -m pytest tests/test_redis_settings.py -v
```

Expected: all 12 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/settings/ tests/conftest.py tests/test_redis_settings.py
git commit -m "feat(sealer): add Redis settings reader for point-cloud-processor

Reads sealer_* fields from Redis DB3 settings hash with defaults.
Supports reload() for runtime parameter changes."
```

---

## Task 3: ScanAccumulator

**Files:**
- Create: `services/point-cloud-processor/src/accumulator/scan_accumulator.py`
- Create: `services/point-cloud-processor/tests/test_scan_accumulator.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_scan_accumulator.py
import json
import time
import pytest
from src.accumulator.scan_accumulator import ScanAccumulator


def _make_frame_msg(vin, model_type, frame_number, encoder_position,
                    part_uuid="part-001", camera_serial="HK3D001"):
    return {
        "frame_uuid": f"frame-{frame_number}",
        "part_uuid": part_uuid,
        "vin_number": vin,
        "model_type": model_type,
        "camera_serial_number": camera_serial,
        "frame_number": str(frame_number),
        "frame_path": f"/img_saved/{part_uuid}/{camera_serial}/",
        "frame_file": f"f{frame_number}.ply",
        "image_file": f"f{frame_number}.bin",
        "encoder_position_mm": encoder_position,
        "frame_created_at": "2026-05-27T14:30:05.123Z",
        "frame_captured_at": "2026-05-27T14:30:05.100Z",
    }


class TestScanAccumulator:
    def test_add_frame_creates_scan_key(self, redis_accumulator):
        acc = ScanAccumulator(redis_accumulator, scan_timeout=30, scan_ttl=300,
                              timestamp_tolerance_ms=60000)
        msg = _make_frame_msg("VIN001", "CRETA_2026", 0, 50.0)

        complete = acc.add_frame(msg, expected_count=3)

        assert complete is False
        keys = list(redis_accumulator.scan_iter(match="scan:VIN001:*"))
        assert len(keys) == 1

    def test_completes_when_all_frames_received(self, redis_accumulator):
        acc = ScanAccumulator(redis_accumulator, scan_timeout=30, scan_ttl=300,
                              timestamp_tolerance_ms=60000)

        acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 0, 50.0), expected_count=3)
        acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 1, 150.0), expected_count=3)
        complete = acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 2, 250.0), expected_count=3)

        assert complete is True

    def test_completes_with_none_expected(self, redis_accumulator):
        """When expected_count is None (timeout-only mode), never returns True."""
        acc = ScanAccumulator(redis_accumulator, scan_timeout=30, scan_ttl=300,
                              timestamp_tolerance_ms=60000)

        complete = acc.add_frame(
            _make_frame_msg("VIN001", "CRETA_2026", 0, 50.0), expected_count=None)

        assert complete is False

    def test_ignores_duplicate_frame_number(self, redis_accumulator):
        acc = ScanAccumulator(redis_accumulator, scan_timeout=30, scan_ttl=300,
                              timestamp_tolerance_ms=60000)

        acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 0, 50.0), expected_count=3)
        acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 0, 50.0), expected_count=3)

        key = list(redis_accumulator.scan_iter(match="scan:VIN001:*"))[0]
        received = redis_accumulator.hget(key, "_received")
        assert received == "0"

    def test_get_scan_frames_returns_all_metadata(self, redis_accumulator):
        acc = ScanAccumulator(redis_accumulator, scan_timeout=30, scan_ttl=300,
                              timestamp_tolerance_ms=60000)

        acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 0, 50.0), expected_count=2)
        acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 1, 150.0), expected_count=2)

        key = list(redis_accumulator.scan_iter(match="scan:VIN001:*"))[0]
        frames = acc.get_scan_frames(key)

        assert len(frames) == 2
        assert frames[0]["encoder_position_mm"] == 50.0
        assert frames[1]["encoder_position_mm"] == 150.0

    def test_cleanup_deletes_key(self, redis_accumulator):
        acc = ScanAccumulator(redis_accumulator, scan_timeout=30, scan_ttl=300,
                              timestamp_tolerance_ms=60000)

        acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 0, 50.0), expected_count=2)

        key = list(redis_accumulator.scan_iter(match="scan:VIN001:*"))[0]
        acc.cleanup(key)

        remaining = list(redis_accumulator.scan_iter(match="scan:VIN001:*"))
        assert len(remaining) == 0

    def test_flush_stale_returns_timed_out_scans(self, redis_accumulator):
        acc = ScanAccumulator(redis_accumulator, scan_timeout=1, scan_ttl=300,
                              timestamp_tolerance_ms=60000)

        acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 0, 50.0), expected_count=5)

        # Simulate time passing by backdating _last_seen
        key = list(redis_accumulator.scan_iter(match="scan:VIN001:*"))[0]
        redis_accumulator.hset(key, "_last_seen", str(time.time() - 10))

        stale = acc.flush_stale_scans()
        assert len(stale) == 1
        assert stale[0][0] == key

    def test_flush_stale_ignores_fresh_scans(self, redis_accumulator):
        acc = ScanAccumulator(redis_accumulator, scan_timeout=30, scan_ttl=300,
                              timestamp_tolerance_ms=60000)

        acc.add_frame(_make_frame_msg("VIN001", "CRETA_2026", 0, 50.0), expected_count=5)

        stale = acc.flush_stale_scans()
        assert len(stale) == 0

    def test_get_scan_metadata(self, redis_accumulator):
        acc = ScanAccumulator(redis_accumulator, scan_timeout=30, scan_ttl=300,
                              timestamp_tolerance_ms=60000)
        msg = _make_frame_msg("VIN001", "CRETA_2026", 0, 50.0)
        acc.add_frame(msg, expected_count=20)

        key = list(redis_accumulator.scan_iter(match="scan:VIN001:*"))[0]
        meta = acc.get_scan_metadata(key)

        assert meta["vin_number"] == "VIN001"
        assert meta["model_type"] == "CRETA_2026"
        assert meta["part_uuid"] == "part-001"
        assert meta["camera_serial"] == "HK3D001"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_scan_accumulator.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement scan_accumulator.py**

```python
# src/accumulator/scan_accumulator.py
"""Redis-based scan accumulator for multi-frame VIN aggregation.

Follows the DieMaster StrokeAccumulator pattern: stores frame metadata
in Redis hashes keyed by VIN, completes when expected frame count is
reached or times out for partial processing.
"""

from __future__ import annotations

import json
import time as _time
from typing import Optional

from loguru import logger


class ScanAccumulator:
    """Accumulates frame metadata in Redis until a scan is complete."""

    def __init__(
        self,
        redis_client,
        scan_timeout: int = 30,
        scan_ttl: int = 300,
        timestamp_tolerance_ms: int = 60000,
    ):
        self._redis = redis_client
        self._scan_timeout = scan_timeout
        self._scan_ttl = scan_ttl
        self._timestamp_tolerance_ms = timestamp_tolerance_ms

    def add_frame(self, msg: dict, expected_count: Optional[int]) -> bool:
        """Store one frame's metadata. Returns True when scan is complete.

        Args:
            msg: Decoded frame message with vin_number, frame_number, etc.
            expected_count: Expected total frames, or None for timeout-only mode.

        Returns:
            True if all expected frames have arrived (never True if expected_count is None).
        """
        vin = msg["vin_number"]
        frame_number = str(msg["frame_number"])

        key = self._find_or_create_key(vin, msg)

        # Check for duplicate
        received_raw = self._redis.hget(key, "_received")
        received = received_raw.split(",") if received_raw else []
        if frame_number in received:
            logger.info(f"Duplicate frame {frame_number} for vin={vin}, ignoring")
            return False

        received.append(frame_number)

        # Atomic write
        pipe = self._redis.pipeline()
        pipe.hset(key, f"frame:{frame_number}", json.dumps(msg))
        pipe.hset(key, "_received", ",".join(received))
        if expected_count is not None:
            pipe.hset(key, "_expected", str(expected_count))
        pipe.hset(key, "_model_type", msg.get("model_type", ""))
        pipe.hset(key, "_part_uuid", msg.get("part_uuid", ""))
        pipe.hset(key, "_camera_serial", msg.get("camera_serial_number", ""))
        pipe.hset(key, "_last_seen", str(_time.time()))
        pipe.expire(key, self._scan_ttl)
        pipe.execute()

        logger.debug(
            f"Scan accumulator: frame {frame_number} for vin={vin} "
            f"({len(received)}/{expected_count or '?'})"
        )

        if expected_count is not None and len(received) >= expected_count:
            return True
        return False

    def get_scan_frames(self, key: str) -> list[dict]:
        """Retrieve all frame metadata for a scan, ordered by encoder_position_mm."""
        all_data = self._redis.hgetall(key)
        frames = []
        for field, value in all_data.items():
            if field.startswith("frame:"):
                frames.append(json.loads(value))
        frames.sort(key=lambda f: float(f.get("encoder_position_mm", 0)))
        return frames

    def get_scan_metadata(self, key: str) -> dict:
        """Get scan-level metadata (vin, model_type, part_uuid, camera_serial)."""
        return {
            "vin_number": self._redis.hget(key, "_model_type") and key.split(":")[1],
            "model_type": self._redis.hget(key, "_model_type") or "",
            "part_uuid": self._redis.hget(key, "_part_uuid") or "",
            "camera_serial": self._redis.hget(key, "_camera_serial") or "",
        }

    def cleanup(self, key: str) -> None:
        """Delete scan key after processing is complete."""
        self._redis.delete(key)
        logger.debug(f"Scan key deleted: {key}")

    def flush_stale_scans(self) -> list[tuple[str, list[dict]]]:
        """Flush scans that have timed out with partial data.

        Returns:
            List of (key, frames) tuples ready for processing.
        """
        stale = []
        now = _time.time()

        for key in self._redis.scan_iter(match="scan:*"):
            key_str = key if isinstance(key, str) else key.decode()
            last_seen_raw = self._redis.hget(key_str, "_last_seen")
            if last_seen_raw is None:
                continue

            last_seen = float(last_seen_raw)
            if now - last_seen <= self._scan_timeout:
                continue

            received_raw = self._redis.hget(key_str, "_received")
            if not received_raw:
                continue

            received = received_raw.split(",")
            expected_raw = self._redis.hget(key_str, "_expected")
            expected = int(expected_raw) if expected_raw else "?"

            logger.info(
                f"Flushing stale scan: {key_str} "
                f"({len(received)}/{expected} frames, stale for "
                f"{now - last_seen:.0f}s)"
            )

            frames = self.get_scan_frames(key_str)
            if frames:
                stale.append((key_str, frames))

        return stale

    def _find_or_create_key(self, vin: str, msg: dict) -> str:
        """Find existing scan key for this VIN or create a new one."""
        for key in self._redis.scan_iter(match=f"scan:{vin}:*"):
            key_str = key if isinstance(key, str) else key.decode()
            return key_str

        timestamp = msg.get("frame_created_at", str(_time.time()))
        return f"scan:{vin}:{timestamp}"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_scan_accumulator.py -v
```

Expected: all 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/accumulator/ tests/test_scan_accumulator.py
git commit -m "feat(sealer): add ScanAccumulator for multi-frame VIN aggregation

Redis hash-based accumulation with completion detection by frame count
and timeout-based flush for partial scans. Follows DieMaster StrokeAccumulator pattern."
```

---

## Task 4: Pipeline Stage 1 — Loader

**Files:**
- Create: `services/point-cloud-processor/src/pipeline/loader.py`
- Create: `services/point-cloud-processor/tests/test_loader.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_loader.py
import os
import struct
import numpy as np
import pytest
from src.pipeline.loader import load_frames, detect_image_format, FrameData


@pytest.fixture
def scan_dir(tmp_path):
    """Create a temporary scan directory with synthetic PLY and BIN files."""
    d = tmp_path / "img_saved" / "part-001" / "HK3D001"
    d.mkdir(parents=True)
    return d


def _write_ply(path, points):
    """Write a minimal ASCII PLY file."""
    with open(path, "w") as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        f.write("end_header\n")
        for p in points:
            f.write(f"{p[0]} {p[1]} {p[2]}\n")


def _write_jpeg_bin(path):
    """Write a minimal JPEG header as .bin."""
    # JPEG SOI marker
    with open(path, "wb") as f:
        f.write(b"\xff\xd8\xff\xe0" + b"\x00" * 100)


def _write_png_bin(path):
    """Write a minimal PNG header as .bin."""
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)


class TestDetectImageFormat:
    def test_detects_jpeg(self, tmp_path):
        path = tmp_path / "test.bin"
        _write_jpeg_bin(path)
        assert detect_image_format(str(path)) == "jpeg"

    def test_detects_png(self, tmp_path):
        path = tmp_path / "test.bin"
        _write_png_bin(path)
        assert detect_image_format(str(path)) == "png"

    def test_returns_none_for_unknown(self, tmp_path):
        path = tmp_path / "test.bin"
        path.write_bytes(b"\x00\x01\x02\x03" * 10)
        assert detect_image_format(str(path)) is None


class TestLoadFrames:
    def test_loads_ply_and_bin(self, scan_dir):
        points = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
        _write_ply(scan_dir / "f0.ply", points)
        _write_jpeg_bin(scan_dir / "f0.bin")

        frames_meta = [
            {
                "frame_path": str(scan_dir) + "/",
                "frame_file": "f0.ply",
                "image_file": "f0.bin",
                "encoder_position_mm": 50.0,
            }
        ]

        result = load_frames(frames_meta)
        assert len(result) == 1
        assert result[0].encoder_position_mm == 50.0
        assert result[0].point_cloud is not None
        assert len(np.asarray(result[0].point_cloud.points)) == 3
        assert result[0].image is not None

    def test_orders_by_encoder_position(self, scan_dir):
        for i in [2, 0, 1]:
            _write_ply(scan_dir / f"f{i}.ply", [[i, 0, 0]])
            _write_jpeg_bin(scan_dir / f"f{i}.bin")

        frames_meta = [
            {"frame_path": str(scan_dir) + "/", "frame_file": f"f{i}.ply",
             "image_file": f"f{i}.bin", "encoder_position_mm": float(i) * 100}
            for i in [2, 0, 1]
        ]

        result = load_frames(frames_meta)
        positions = [f.encoder_position_mm for f in result]
        assert positions == [0.0, 100.0, 200.0]

    def test_marks_missing_ply_as_none(self, scan_dir):
        _write_jpeg_bin(scan_dir / "f0.bin")

        frames_meta = [
            {"frame_path": str(scan_dir) + "/", "frame_file": "missing.ply",
             "image_file": "f0.bin", "encoder_position_mm": 50.0}
        ]

        result = load_frames(frames_meta)
        assert len(result) == 1
        assert result[0].point_cloud is None
        assert result[0].missing is True

    def test_marks_missing_bin_image_as_none(self, scan_dir):
        _write_ply(scan_dir / "f0.ply", [[0, 0, 0]])

        frames_meta = [
            {"frame_path": str(scan_dir) + "/", "frame_file": "f0.ply",
             "image_file": "missing.bin", "encoder_position_mm": 50.0}
        ]

        result = load_frames(frames_meta)
        assert result[0].point_cloud is not None
        assert result[0].image is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_loader.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement loader.py**

```python
# src/pipeline/loader.py
"""Stage 1: Load PLY point clouds and BIN images from disk."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np
import open3d as o3d
from loguru import logger


# Magic bytes for image format detection
_JPEG_MAGIC = b"\xff\xd8\xff"
_PNG_MAGIC = b"\x89PNG"


@dataclass
class FrameData:
    """Loaded frame data from disk."""
    encoder_position_mm: float
    point_cloud: Optional[o3d.geometry.PointCloud] = None
    image: Optional[np.ndarray] = None
    missing: bool = False
    frame_meta: dict = field(default_factory=dict)


def detect_image_format(file_path: str) -> Optional[str]:
    """Detect image format by reading magic bytes from a .bin file."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(8)
    except (IOError, OSError):
        return None

    if header[:3] == _JPEG_MAGIC:
        return "jpeg"
    if header[:4] == _PNG_MAGIC:
        return "png"
    return None


def _load_point_cloud(file_path: str) -> Optional[o3d.geometry.PointCloud]:
    """Load a PLY file as an Open3D point cloud."""
    try:
        pcd = o3d.io.read_point_cloud(file_path)
        if len(pcd.points) == 0:
            logger.warning(f"Empty point cloud: {file_path}")
            return None
        return pcd
    except Exception as e:
        logger.error(f"Failed to read PLY {file_path}: {e}")
        return None


def _load_image(file_path: str) -> Optional[np.ndarray]:
    """Load a .bin image file, detecting format by magic bytes."""
    fmt = detect_image_format(file_path)
    if fmt is None:
        logger.warning(f"Unknown image format in {file_path}")
        return None

    try:
        raw = open(file_path, "rb").read()
        buf = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img is None:
            logger.warning(f"cv2.imdecode returned None for {file_path}")
        return img
    except Exception as e:
        logger.error(f"Failed to decode image {file_path}: {e}")
        return None


def load_frames(frames_meta: list[dict]) -> list[FrameData]:
    """Load all frames from disk, ordered by encoder_position_mm.

    Args:
        frames_meta: List of frame metadata dicts from ScanAccumulator.

    Returns:
        List of FrameData ordered by encoder_position_mm ascending.
    """
    results = []

    for meta in frames_meta:
        base_path = meta["frame_path"]
        ply_path = os.path.join(base_path, meta["frame_file"])
        bin_path = os.path.join(base_path, meta["image_file"])
        encoder_pos = float(meta["encoder_position_mm"])

        pcd = None
        image = None
        missing = False

        if os.path.isfile(ply_path):
            pcd = _load_point_cloud(ply_path)
        else:
            logger.error(f"PLY not found: {ply_path}")
            missing = True

        if os.path.isfile(bin_path):
            image = _load_image(bin_path)
        else:
            logger.warning(f"BIN not found: {bin_path}")

        results.append(FrameData(
            encoder_position_mm=encoder_pos,
            point_cloud=pcd,
            image=image,
            missing=missing or (pcd is None),
            frame_meta=meta,
        ))

    results.sort(key=lambda f: f.encoder_position_mm)
    return results
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_loader.py -v
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/loader.py tests/test_loader.py
git commit -m "feat(sealer): add frame loader — PLY + BIN with magic byte detection

Stage 1 of processing pipeline. Reads PLY via Open3D, detects
JPEG/PNG from .bin magic bytes, orders by encoder position."
```

---

## Task 5: Pipeline Stage 2 — Outlier Removal

**Files:**
- Create: `services/point-cloud-processor/src/pipeline/outlier_removal.py`
- Create: `services/point-cloud-processor/tests/test_outlier_removal.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_outlier_removal.py
import numpy as np
import open3d as o3d
import pytest
from src.pipeline.outlier_removal import remove_outliers


def _make_cloud_with_outliers(n_good=100, n_outliers=5):
    """Create a point cloud with a cluster + distant outliers."""
    rng = np.random.default_rng(42)
    good_points = rng.normal(0, 0.1, (n_good, 3))
    outlier_points = rng.normal(10, 0.1, (n_outliers, 3))
    all_points = np.vstack([good_points, outlier_points])

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(all_points)
    return pcd, n_good, n_outliers


class TestRemoveOutliers:
    def test_removes_distant_outliers(self):
        pcd, n_good, n_outliers = _make_cloud_with_outliers()
        filtered = remove_outliers(pcd, nb_neighbors=20, std_ratio=2.0)
        # Should remove most/all outliers
        assert len(filtered.points) < len(pcd.points)
        assert len(filtered.points) >= n_good - 5  # tolerance for edge cases

    def test_preserves_clean_cloud(self):
        rng = np.random.default_rng(42)
        points = rng.normal(0, 0.01, (100, 3))
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)

        filtered = remove_outliers(pcd, nb_neighbors=20, std_ratio=2.0)
        # Should keep most points in a clean cloud
        assert len(filtered.points) >= 90

    def test_returns_empty_for_empty_cloud(self):
        pcd = o3d.geometry.PointCloud()
        filtered = remove_outliers(pcd, nb_neighbors=20, std_ratio=2.0)
        assert len(filtered.points) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_outlier_removal.py -v
```

- [ ] **Step 3: Implement outlier_removal.py**

```python
# src/pipeline/outlier_removal.py
"""Stage 2: Statistical Outlier Removal per frame."""

import open3d as o3d
from loguru import logger


def remove_outliers(
    pcd: o3d.geometry.PointCloud,
    nb_neighbors: int = 20,
    std_ratio: float = 2.0,
) -> o3d.geometry.PointCloud:
    """Apply Statistical Outlier Removal to a point cloud.

    Args:
        pcd: Input point cloud.
        nb_neighbors: Number of neighbors for mean distance calculation.
        std_ratio: Standard deviation multiplier threshold.

    Returns:
        Filtered point cloud with outliers removed.
    """
    if len(pcd.points) == 0:
        return pcd

    filtered, indices = pcd.remove_statistical_outlier(
        nb_neighbors=nb_neighbors, std_ratio=std_ratio
    )

    removed = len(pcd.points) - len(filtered.points)
    if removed > 0:
        logger.debug(f"SOR: removed {removed}/{len(pcd.points)} outliers")

    return filtered
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_outlier_removal.py -v
```

Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/outlier_removal.py tests/test_outlier_removal.py
git commit -m "feat(sealer): add statistical outlier removal (stage 2)

Open3D SOR with configurable nb_neighbors and std_ratio parameters."
```

---

## Task 6: Pipeline Stage 3 — Registration

**Files:**
- Create: `services/point-cloud-processor/src/pipeline/registration.py`
- Create: `services/point-cloud-processor/tests/test_registration.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_registration.py
import numpy as np
import open3d as o3d
import pytest
from src.pipeline.registration import translate_cloud, compute_translations


class TestTranslateCloud:
    def test_translates_along_y(self):
        points = np.array([[0, 0, 0], [1, 0, 0]], dtype=np.float64)
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)

        result = translate_cloud(pcd, shift_mm=100.0, unit_vector=[0, 1, 0])
        result_points = np.asarray(result.points)

        np.testing.assert_allclose(result_points[0], [0, 100, 0])
        np.testing.assert_allclose(result_points[1], [1, 100, 0])

    def test_translates_along_custom_vector(self):
        points = np.array([[0, 0, 0]], dtype=np.float64)
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)

        result = translate_cloud(pcd, shift_mm=50.0, unit_vector=[1, 0, 0])
        result_points = np.asarray(result.points)

        np.testing.assert_allclose(result_points[0], [50, 0, 0])

    def test_zero_shift_no_change(self):
        points = np.array([[5, 5, 5]], dtype=np.float64)
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)

        result = translate_cloud(pcd, shift_mm=0.0, unit_vector=[0, 1, 0])
        result_points = np.asarray(result.points)

        np.testing.assert_allclose(result_points[0], [5, 5, 5])


class TestComputeTranslations:
    def test_computes_relative_shifts(self):
        positions = [50.0, 150.0, 250.0]
        shifts = compute_translations(positions)

        assert shifts == [0.0, 100.0, 200.0]

    def test_single_position(self):
        shifts = compute_translations([50.0])
        assert shifts == [0.0]

    def test_unordered_still_relative_to_first(self):
        positions = [100.0, 50.0, 200.0]
        shifts = compute_translations(positions)
        assert shifts == [0.0, -50.0, 100.0]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_registration.py -v
```

- [ ] **Step 3: Implement registration.py**

```python
# src/pipeline/registration.py
"""Stage 3: Point cloud registration via known encoder translation."""

import numpy as np
import open3d as o3d


def compute_translations(encoder_positions: list[float]) -> list[float]:
    """Compute relative shifts from absolute encoder positions.

    Args:
        encoder_positions: Absolute positions in mm (ordered by frame).

    Returns:
        Relative shifts in mm (first frame is always 0.0).
    """
    if not encoder_positions:
        return []
    origin = encoder_positions[0]
    return [pos - origin for pos in encoder_positions]


def translate_cloud(
    pcd: o3d.geometry.PointCloud,
    shift_mm: float,
    unit_vector: list[float],
) -> o3d.geometry.PointCloud:
    """Translate a point cloud by shift_mm along unit_vector.

    Args:
        pcd: Input point cloud (modified in place and returned).
        shift_mm: Distance to translate in mm.
        unit_vector: Direction vector [x, y, z].

    Returns:
        The translated point cloud.
    """
    if shift_mm == 0.0:
        return pcd

    vec = np.array(unit_vector, dtype=np.float64)
    translation = vec * shift_mm

    transform = np.eye(4)
    transform[:3, 3] = translation

    pcd.transform(transform)
    return pcd
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_registration.py -v
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/registration.py tests/test_registration.py
git commit -m "feat(sealer): add point cloud registration via encoder position (stage 3)

Translation-only registration using known linear axis positions.
Configurable shift unit vector."
```

---

## Task 7: Pipeline Stage 4 — Merge

**Files:**
- Create: `services/point-cloud-processor/src/pipeline/merge.py`
- Create: `services/point-cloud-processor/tests/test_merge.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_merge.py
import numpy as np
import open3d as o3d
import pytest
from src.pipeline.merge import merge_clouds


def _make_cloud(points):
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(np.array(points, dtype=np.float64))
    return pcd


class TestMergeClouds:
    def test_merges_two_clouds(self):
        c1 = _make_cloud([[0, 0, 0], [1, 0, 0]])
        c2 = _make_cloud([[2, 0, 0], [3, 0, 0]])

        merged = merge_clouds([c1, c2], voxel_size=0.0)  # no downsampling
        assert len(merged.points) == 4

    def test_voxel_downsampling_reduces_overlap(self):
        # Two clouds with identical points (full overlap)
        c1 = _make_cloud([[0, 0, 0], [1, 0, 0], [2, 0, 0]])
        c2 = _make_cloud([[0, 0, 0], [1, 0, 0], [2, 0, 0]])

        merged = merge_clouds([c1, c2], voxel_size=0.5)
        # Voxel downsample should reduce from 6 to ~3
        assert len(merged.points) <= 4

    def test_single_cloud_passthrough(self):
        c1 = _make_cloud([[0, 0, 0], [1, 0, 0]])
        merged = merge_clouds([c1], voxel_size=0.0)
        assert len(merged.points) == 2

    def test_empty_list_returns_empty_cloud(self):
        merged = merge_clouds([], voxel_size=0.5)
        assert len(merged.points) == 0

    def test_preserves_non_overlap_points(self):
        # Points far apart — no overlap
        c1 = _make_cloud([[0, 0, 0]])
        c2 = _make_cloud([[100, 0, 0]])

        merged = merge_clouds([c1, c2], voxel_size=0.5)
        assert len(merged.points) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_merge.py -v
```

- [ ] **Step 3: Implement merge.py**

```python
# src/pipeline/merge.py
"""Stage 4: Merge translated point clouds + voxel downsampling."""

import open3d as o3d
from loguru import logger


def merge_clouds(
    clouds: list[o3d.geometry.PointCloud],
    voxel_size: float = 0.5,
) -> o3d.geometry.PointCloud:
    """Concatenate point clouds and apply voxel downsampling.

    Args:
        clouds: List of pre-translated point clouds.
        voxel_size: Voxel grid size in mm. Set to 0 to skip downsampling.

    Returns:
        Merged and optionally downsampled point cloud.
    """
    merged = o3d.geometry.PointCloud()

    if not clouds:
        return merged

    for cloud in clouds:
        merged += cloud

    total_before = len(merged.points)

    if voxel_size > 0:
        merged = merged.voxel_down_sample(voxel_size=voxel_size)

    total_after = len(merged.points)
    if total_before > 0:
        reduction = (1 - total_after / total_before) * 100
        logger.info(
            f"Merge: {total_before} → {total_after} points "
            f"({reduction:.1f}% reduction, voxel={voxel_size}mm)"
        )

    return merged
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_merge.py -v
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/merge.py tests/test_merge.py
git commit -m "feat(sealer): add point cloud merge + voxel downsampling (stage 4)

Concatenation with configurable voxel grid for overlap normalization."
```

---

## Task 8: Pipeline Stage 5 — Image Stitching

**Files:**
- Create: `services/point-cloud-processor/src/pipeline/stitching.py`
- Create: `services/point-cloud-processor/tests/test_stitching.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_stitching.py
import numpy as np
import cv2
import pytest
from src.pipeline.stitching import stitch_images, undistort_image


def _make_gradient_image(h=100, w=200, color=(255, 0, 0)):
    """Create a synthetic gradient image."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    for c in range(3):
        img[:, :, c] = color[c]
    # Add a horizontal gradient so images are distinguishable
    gradient = np.linspace(0, 255, w, dtype=np.uint8)
    img[:, :, 0] = gradient[np.newaxis, :]
    return img


def _identity_calibration():
    """Camera matrix with no distortion (identity-like)."""
    K = np.array([[500, 0, 100], [0, 500, 50], [0, 0, 1]], dtype=np.float64)
    D = np.zeros(5, dtype=np.float64)
    return K, D


class TestUndistortImage:
    def test_identity_distortion_preserves_image(self):
        img = _make_gradient_image()
        K, D = _identity_calibration()
        result = undistort_image(img, K, D)
        assert result.shape == img.shape

    def test_returns_none_for_none_image(self):
        K, D = _identity_calibration()
        result = undistort_image(None, K, D)
        assert result is None


class TestStitchImages:
    def test_stitches_two_images(self):
        img1 = _make_gradient_image(h=100, w=200)
        img2 = _make_gradient_image(h=100, w=200)
        K, D = _identity_calibration()

        result = stitch_images(
            images=[img1, img2],
            encoder_positions=[0.0, 50.0],
            pixels_per_mm=2.0,
            camera_matrix=K,
            dist_coeffs=D,
        )

        # Canvas should be wider than a single image
        assert result.shape[1] > 200
        assert result.shape[0] == 100

    def test_single_image_returns_undistorted(self):
        img = _make_gradient_image(h=100, w=200)
        K, D = _identity_calibration()

        result = stitch_images(
            images=[img],
            encoder_positions=[0.0],
            pixels_per_mm=2.0,
            camera_matrix=K,
            dist_coeffs=D,
        )

        assert result.shape == img.shape

    def test_skips_none_images(self):
        img1 = _make_gradient_image(h=100, w=200)
        K, D = _identity_calibration()

        result = stitch_images(
            images=[img1, None],
            encoder_positions=[0.0, 50.0],
            pixels_per_mm=2.0,
            camera_matrix=K,
            dist_coeffs=D,
        )

        # Should still produce a valid image from the non-None frame
        assert result is not None
        assert result.shape[0] == 100

    def test_empty_list_returns_none(self):
        K, D = _identity_calibration()
        result = stitch_images([], [], 2.0, K, D)
        assert result is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_stitching.py -v
```

- [ ] **Step 3: Implement stitching.py**

```python
# src/pipeline/stitching.py
"""Stage 5: 2D image stitching with undistortion and linear feathering."""

from typing import Optional

import cv2
import numpy as np
from loguru import logger


def undistort_image(
    image: Optional[np.ndarray],
    camera_matrix: np.ndarray,
    dist_coeffs: np.ndarray,
) -> Optional[np.ndarray]:
    """Correct lens distortion using camera intrinsics.

    Args:
        image: Input BGR image or None.
        camera_matrix: 3×3 camera intrinsic matrix (K).
        dist_coeffs: Distortion coefficients (5 or 8 elements).

    Returns:
        Undistorted image, or None if input is None.
    """
    if image is None:
        return None
    return cv2.undistort(image, camera_matrix, dist_coeffs)


def stitch_images(
    images: list[Optional[np.ndarray]],
    encoder_positions: list[float],
    pixels_per_mm: float,
    camera_matrix: np.ndarray,
    dist_coeffs: np.ndarray,
) -> Optional[np.ndarray]:
    """Stitch a sequence of images using known encoder positions.

    Args:
        images: List of BGR images (some may be None).
        encoder_positions: Absolute encoder positions in mm per frame.
        pixels_per_mm: Conversion factor from mm to pixels.
        camera_matrix: 3×3 camera intrinsic matrix for undistortion.
        dist_coeffs: Distortion coefficients for undistortion.

    Returns:
        Stitched image as BGR numpy array, or None if no valid images.
    """
    if not images:
        return None

    # Undistort all valid images
    undistorted = []
    valid_positions = []
    for img, pos in zip(images, encoder_positions):
        ud = undistort_image(img, camera_matrix, dist_coeffs)
        if ud is not None:
            undistorted.append(ud)
            valid_positions.append(pos)

    if not undistorted:
        return None

    if len(undistorted) == 1:
        return undistorted[0]

    # Compute pixel offsets from encoder positions
    origin = valid_positions[0]
    offsets_px = [int((pos - origin) * pixels_per_mm) for pos in valid_positions]

    h = undistorted[0].shape[0]
    w = undistorted[0].shape[1]

    # Canvas dimensions
    max_offset = max(offsets_px)
    canvas_w = max_offset + w
    canvas = np.zeros((h, canvas_w, 3), dtype=np.float64)
    weight = np.zeros((h, canvas_w), dtype=np.float64)

    for img, offset in zip(undistorted, offsets_px):
        img_w = img.shape[1]
        x_start = offset
        x_end = offset + img_w

        # Linear weight ramp (1.0 at center, tapering at edges)
        ramp = np.ones(img_w, dtype=np.float64)
        feather = min(img_w // 4, 50)  # feather zone in pixels
        if feather > 0:
            ramp[:feather] = np.linspace(0, 1, feather)
            ramp[-feather:] = np.linspace(1, 0, feather)

        ramp_2d = np.tile(ramp, (h, 1))

        canvas[:, x_start:x_end, :] += img.astype(np.float64) * ramp_2d[:, :, np.newaxis]
        weight[:, x_start:x_end] += ramp_2d

    # Normalize by accumulated weights
    mask = weight > 0
    for c in range(3):
        canvas[:, :, c][mask] /= weight[mask]

    result = np.clip(canvas, 0, 255).astype(np.uint8)

    logger.info(f"Stitched {len(undistorted)} images → {canvas_w}×{h} canvas")
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_stitching.py -v
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/stitching.py tests/test_stitching.py
git commit -m "feat(sealer): add image stitching with undistortion + feathering (stage 5)

Translation-based stitching using encoder positions, lens distortion
correction via camera intrinsics, linear feathering in overlap zones."
```

---

## Task 9: Pipeline Stage 6 — Depth Map

**Files:**
- Create: `services/point-cloud-processor/src/pipeline/depth_map.py`
- Create: `services/point-cloud-processor/tests/test_depth_map.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_depth_map.py
import numpy as np
import open3d as o3d
import pytest
from src.pipeline.depth_map import generate_depth_map


def _make_cloud(points):
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(np.array(points, dtype=np.float64))
    return pcd


class TestGenerateDepthMap:
    def test_generates_2d_array(self):
        # Flat plane at Z=5 with some points
        points = [[x, y, 5.0] for x in range(10) for y in range(10)]
        pcd = _make_cloud(points)

        depth = generate_depth_map(pcd, resolution_mm=1.0)

        assert isinstance(depth, np.ndarray)
        assert depth.dtype == np.float32
        assert depth.ndim == 2

    def test_resolution_affects_size(self):
        points = [[x, y, 5.0] for x in range(100) for y in range(100)]
        pcd = _make_cloud(points)

        depth_fine = generate_depth_map(pcd, resolution_mm=0.5)
        depth_coarse = generate_depth_map(pcd, resolution_mm=2.0)

        assert depth_fine.size > depth_coarse.size

    def test_empty_pixels_are_nan(self):
        # Sparse cloud — most pixels should be NaN
        points = [[0, 0, 5], [50, 50, 10]]
        pcd = _make_cloud(points)

        depth = generate_depth_map(pcd, resolution_mm=1.0)
        assert np.any(np.isnan(depth))

    def test_depth_values_match_z_coords(self):
        points = [[0, 0, 3.0], [1, 0, 7.0]]
        pcd = _make_cloud(points)

        depth = generate_depth_map(pcd, resolution_mm=1.0)
        # The non-NaN values should contain 3.0 and 7.0
        values = depth[~np.isnan(depth)]
        assert 3.0 in values or np.isclose(values, 3.0).any()

    def test_empty_cloud_returns_empty_array(self):
        pcd = o3d.geometry.PointCloud()
        depth = generate_depth_map(pcd, resolution_mm=1.0)
        assert depth.size == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_depth_map.py -v
```

- [ ] **Step 3: Implement depth_map.py**

```python
# src/pipeline/depth_map.py
"""Stage 6: Generate 2D depth map from merged point cloud."""

import numpy as np
import open3d as o3d
from loguru import logger


def generate_depth_map(
    pcd: o3d.geometry.PointCloud,
    resolution_mm: float = 0.5,
) -> np.ndarray:
    """Project a 3D point cloud to a 2D depth map (top-down XY view).

    Each pixel contains the Z value of the nearest point. Empty pixels are NaN.

    Args:
        pcd: Merged point cloud.
        resolution_mm: Size of each pixel in mm.

    Returns:
        2D numpy array (float32) with Z depth values. Empty pixels = NaN.
    """
    points = np.asarray(pcd.points)

    if len(points) == 0:
        return np.array([], dtype=np.float32)

    x_min, y_min, _ = points.min(axis=0)
    x_max, y_max, _ = points.max(axis=0)

    cols = int(np.ceil((x_max - x_min) / resolution_mm)) + 1
    rows = int(np.ceil((y_max - y_min) / resolution_mm)) + 1

    depth = np.full((rows, cols), np.nan, dtype=np.float32)

    # Map each point to a grid cell
    col_idx = ((points[:, 0] - x_min) / resolution_mm).astype(int)
    row_idx = ((points[:, 1] - y_min) / resolution_mm).astype(int)

    # Clamp indices
    col_idx = np.clip(col_idx, 0, cols - 1)
    row_idx = np.clip(row_idx, 0, rows - 1)

    # For each cell, keep the Z value closest to camera (minimum Z)
    for i in range(len(points)):
        r, c = row_idx[i], col_idx[i]
        z = points[i, 2]
        if np.isnan(depth[r, c]) or z < depth[r, c]:
            depth[r, c] = z

    logger.info(f"Depth map: {rows}×{cols} ({resolution_mm} mm/px), "
                f"{np.count_nonzero(~np.isnan(depth))}/{rows * cols} filled pixels")

    return depth
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_depth_map.py -v
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/depth_map.py tests/test_depth_map.py
git commit -m "feat(sealer): add depth map generation from merged cloud (stage 6)

Top-down XY projection with configurable resolution. NaN for empty pixels."
```

---

## Task 10: Pipeline Runner (orchestrates stages 1-6)

**Files:**
- Create: `services/point-cloud-processor/src/pipeline/runner.py`
- Create: `services/point-cloud-processor/tests/test_runner.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_runner.py
import os
import json
import numpy as np
import open3d as o3d
import pytest
from unittest.mock import MagicMock
from tests.test_loader import _write_ply, _write_jpeg_bin
from src.pipeline.runner import PipelineRunner


@pytest.fixture
def scan_dir(tmp_path):
    d = tmp_path / "img_saved" / "part-001" / "HK3D001"
    d.mkdir(parents=True)
    return d


@pytest.fixture
def mock_settings():
    s = MagicMock()
    s.outlier_nb_neighbors = 20
    s.outlier_std_ratio = 2.0
    s.voxel_size = 0.5
    s.image_pixels_per_mm = 2.0
    s.depth_map_resolution_mm = 0.5
    return s


def _populate_scan(scan_dir, num_frames=3, points_per_frame=50):
    """Create synthetic PLY + BIN files and return frame metadata list."""
    frames = []
    rng = np.random.default_rng(42)
    for i in range(num_frames):
        ply_name = f"f{i}.ply"
        bin_name = f"f{i}.bin"
        points = rng.normal(0, 1, (points_per_frame, 3))
        points[:, 1] += i * 100  # shift along Y
        _write_ply(scan_dir / ply_name, points.tolist())
        _write_jpeg_bin(scan_dir / bin_name)
        frames.append({
            "frame_path": str(scan_dir) + "/",
            "frame_file": ply_name,
            "image_file": bin_name,
            "encoder_position_mm": float(i * 100),
        })
    return frames


class TestPipelineRunner:
    def test_run_produces_three_outputs(self, scan_dir, mock_settings):
        frames = _populate_scan(scan_dir, num_frames=3)
        runner = PipelineRunner(
            settings=mock_settings,
            shift_unit_vector=[0, 1, 0],
            camera_matrix=np.eye(3),
            dist_coeffs=np.zeros(5),
        )

        result = runner.run(frames, output_dir=str(scan_dir))

        assert os.path.isfile(result["merged_ply_path"])
        assert os.path.isfile(result["depth_map_path"])
        assert os.path.isfile(result["stitched_image_path"])
        assert result["total_points"] > 0

    def test_run_with_missing_frame(self, scan_dir, mock_settings):
        frames = _populate_scan(scan_dir, num_frames=2)
        # Add a frame referencing missing files
        frames.append({
            "frame_path": str(scan_dir) + "/",
            "frame_file": "nonexistent.ply",
            "image_file": "nonexistent.bin",
            "encoder_position_mm": 300.0,
        })
        runner = PipelineRunner(
            settings=mock_settings,
            shift_unit_vector=[0, 1, 0],
            camera_matrix=np.eye(3),
            dist_coeffs=np.zeros(5),
        )

        result = runner.run(frames, output_dir=str(scan_dir))

        assert result["degraded"] is False  # 1/3 missing = 33% → degraded
        assert result["total_points"] > 0

    def test_result_contains_timing(self, scan_dir, mock_settings):
        frames = _populate_scan(scan_dir, num_frames=2)
        runner = PipelineRunner(
            settings=mock_settings,
            shift_unit_vector=[0, 1, 0],
            camera_matrix=np.eye(3),
            dist_coeffs=np.zeros(5),
        )

        result = runner.run(frames, output_dir=str(scan_dir))

        assert "pipeline_duration_ms" in result
        assert "load_ms" in result
        assert "merge_ms" in result
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_runner.py -v
```

- [ ] **Step 3: Implement runner.py**

```python
# src/pipeline/runner.py
"""Pipeline runner — orchestrates stages 1-6 for a completed scan."""

import os
import time
from typing import Optional

import cv2
import numpy as np
import open3d as o3d
from loguru import logger

from src.pipeline.loader import load_frames
from src.pipeline.outlier_removal import remove_outliers
from src.pipeline.registration import compute_translations, translate_cloud
from src.pipeline.merge import merge_clouds
from src.pipeline.stitching import stitch_images
from src.pipeline.depth_map import generate_depth_map


class PipelineRunner:
    """Runs the 6-stage processing pipeline on a completed scan."""

    def __init__(
        self,
        settings,
        shift_unit_vector: list[float],
        camera_matrix: np.ndarray,
        dist_coeffs: np.ndarray,
    ):
        self._settings = settings
        self._shift_unit_vector = shift_unit_vector
        self._camera_matrix = camera_matrix
        self._dist_coeffs = dist_coeffs

    def run(self, frames_meta: list[dict], output_dir: str) -> dict:
        """Execute the full pipeline and save outputs.

        Args:
            frames_meta: Frame metadata dicts from ScanAccumulator.
            output_dir: Directory to save merged.ply, stitched.png, depth_map.npy.

        Returns:
            Dict with output paths, point counts, timing, and status flags.
        """
        timings = {}
        t_start = time.monotonic()

        # Stage 1: Load
        t0 = time.monotonic()
        frame_data = load_frames(frames_meta)
        timings["load_ms"] = _elapsed_ms(t0)

        total_frames = len(frame_data)
        missing_count = sum(1 for f in frame_data if f.missing)
        valid_frames = [f for f in frame_data if not f.missing]

        if not valid_frames:
            logger.error("No valid frames to process")
            return self._empty_result(output_dir, total_frames, missing_count, timings, t_start)

        # Stage 2: SOR per frame
        t0 = time.monotonic()
        for f in valid_frames:
            if f.point_cloud is not None:
                f.point_cloud = remove_outliers(
                    f.point_cloud,
                    nb_neighbors=self._settings.outlier_nb_neighbors,
                    std_ratio=self._settings.outlier_std_ratio,
                )
        timings["sor_ms"] = _elapsed_ms(t0)

        # Stage 3: Registration
        t0 = time.monotonic()
        positions = [f.encoder_position_mm for f in valid_frames]
        shifts = compute_translations(positions)
        for f, shift in zip(valid_frames, shifts):
            if f.point_cloud is not None:
                translate_cloud(f.point_cloud, shift, self._shift_unit_vector)
        timings["registration_ms"] = _elapsed_ms(t0)

        # Stage 4: Merge
        t0 = time.monotonic()
        clouds = [f.point_cloud for f in valid_frames if f.point_cloud is not None]
        merged = merge_clouds(clouds, voxel_size=self._settings.voxel_size)
        timings["merge_ms"] = _elapsed_ms(t0)

        # Save merged PLY
        merged_path = os.path.join(output_dir, "merged.ply")
        o3d.io.write_point_cloud(merged_path, merged, write_ascii=False)

        # Stage 5: Image stitching
        t0 = time.monotonic()
        images = [f.image for f in valid_frames]
        stitch_positions = [f.encoder_position_mm for f in valid_frames]
        pixels_per_mm = self._settings.image_pixels_per_mm

        stitched_path = os.path.join(output_dir, "stitched.png")
        if pixels_per_mm is not None and any(img is not None for img in images):
            stitched = stitch_images(
                images, stitch_positions, pixels_per_mm,
                self._camera_matrix, self._dist_coeffs,
            )
            if stitched is not None:
                cv2.imwrite(stitched_path, stitched)
        else:
            logger.warning("Skipping stitching: no pixels_per_mm or no valid images")
            # Create empty placeholder
            cv2.imwrite(stitched_path, np.zeros((1, 1, 3), dtype=np.uint8))
        timings["stitch_ms"] = _elapsed_ms(t0)

        # Stage 6: Depth map
        t0 = time.monotonic()
        depth = generate_depth_map(merged, resolution_mm=self._settings.depth_map_resolution_mm)
        depth_path = os.path.join(output_dir, "depth_map.npy")
        np.save(depth_path, depth)
        timings["depth_map_ms"] = _elapsed_ms(t0)

        total_points = len(merged.points)
        degraded = missing_count > 0 and (missing_count / total_frames) > 0.3

        timings["pipeline_duration_ms"] = _elapsed_ms(t_start)

        logger.info(
            f"Pipeline complete: {total_frames} frames, {missing_count} missing, "
            f"{total_points} points, {timings['pipeline_duration_ms']:.0f}ms"
        )

        return {
            "merged_ply_path": merged_path,
            "stitched_image_path": stitched_path,
            "depth_map_path": depth_path,
            "total_points": total_points,
            "total_frames": total_frames - missing_count,
            "frames_missing": missing_count,
            "degraded": degraded,
            **timings,
        }

    def _empty_result(self, output_dir, total, missing, timings, t_start):
        timings["pipeline_duration_ms"] = _elapsed_ms(t_start)
        return {
            "merged_ply_path": "",
            "stitched_image_path": "",
            "depth_map_path": "",
            "total_points": 0,
            "total_frames": 0,
            "frames_missing": missing,
            "degraded": True,
            **timings,
        }


def _elapsed_ms(start: float) -> float:
    return (time.monotonic() - start) * 1000
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_runner.py -v
```

Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/runner.py tests/test_runner.py
git commit -m "feat(sealer): add pipeline runner orchestrating stages 1-6

Loads frames, applies SOR, registers by encoder, merges clouds,
stitches images, generates depth map. Returns paths + timing metrics."
```

---

## Task 11: Entry Point — Main Service

**Files:**
- Create: `services/point-cloud-processor/visionking-point-cloud-processor.py`

- [ ] **Step 1: Implement entry point**

```python
# visionking-point-cloud-processor.py
"""VisionKing Point Cloud Processor — sealer multi-frame aggregation service."""

import sys
import os
import json
import asyncio
from datetime import datetime, timezone

import cv2
import numpy as np
from dotenv import load_dotenv
from loguru import logger
from aio_pika.abc import AbstractIncomingMessage

load_dotenv()

# --- Loguru Configuration ---
logger.remove()
logger.level("INFO", color="<blue>")
logger.level("SUCCESS", color="<green>")
logger.level("WARNING", color="<yellow>")
logger.level("ERROR", color="<red>")
logger.level("DEBUG", color="<magenta>")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.dirname(SCRIPT_DIR))

from src.utils.read_env_var import *

logger.add(
    sys.stderr,
    level=PCP_LOGGING_LEVEL,
    format="<cyan>{time:YYYY-MM-DD HH:mm:ss}</cyan> | <level>[{level}]</level> | {message}",
    colorize=True,
)

from src.utils.connections import create_rabbit_client, create_redis_accumulator, create_redis_settings
from src.accumulator.scan_accumulator import ScanAccumulator
from src.settings.redis_settings import SealerSettings
from src.pipeline.runner import PipelineRunner

APP_STARTUP_RETRY_DELAY = int(os.getenv("APP_STARTUP_RETRY_DELAY_SECONDS", "10"))

# Globals
_accumulator: ScanAccumulator = None
_settings: SealerSettings = None
_runner: PipelineRunner = None
_rabbit_client = None


def _load_calibration():
    """Load camera calibration from file or return identity defaults."""
    cal_file = PCP_CAMERA_CALIBRATION_FILE
    if cal_file and os.path.isfile(cal_file):
        fs = cv2.FileStorage(cal_file, cv2.FILE_STORAGE_READ)
        K = fs.getNode("camera_matrix").mat()
        D = fs.getNode("dist_coeffs").mat().flatten()
        fs.release()
        logger.info(f"Camera calibration loaded from {cal_file}")
        return K, D

    logger.warning("No camera calibration file — using identity (no undistortion)")
    return np.eye(3, dtype=np.float64), np.zeros(5, dtype=np.float64)


async def _process_scan(key: str, frames: list[dict]) -> None:
    """Run the pipeline on a completed scan and publish results."""
    global _settings, _runner, _rabbit_client, _accumulator

    meta = _accumulator.get_scan_metadata(key)

    _settings.reload()

    if not frames:
        logger.error(f"No frames for scan {key}")
        _accumulator.cleanup(key)
        return

    output_dir = frames[0]["frame_path"]
    result = await asyncio.to_thread(_runner.run, frames, output_dir)

    # Build output message
    output_msg = {
        "part_uuid": meta["part_uuid"],
        "vin_number": meta["vin_number"],
        "model_type": meta["model_type"],
        "camera_serial_number": meta["camera_serial"],
        "total_frames": result["total_frames"],
        "partial": result.get("frames_missing", 0) > 0,
        "degraded": result.get("degraded", False),
        "merged_ply_path": result["merged_ply_path"],
        "depth_map_path": result["depth_map_path"],
        "stitched_image_path": result["stitched_image_path"],
        "total_points": result["total_points"],
        "scan_duration_ms": int(result.get("pipeline_duration_ms", 0)),
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }

    msg_bytes = json.dumps(output_msg).encode("utf-8")

    # Publish to both downstream queues
    try:
        await _rabbit_client.send_message(msg_bytes)
        logger.success(
            f"Published results for {meta['vin_number']} "
            f"({result['total_points']} points, {result.get('pipeline_duration_ms', 0):.0f}ms)"
        )
    except Exception as e:
        logger.error(f"Failed to publish results: {e}")
        raise

    # Log structured metrics
    logger.info(json.dumps({
        "event": "scan_processed",
        "vin": meta["vin_number"],
        "model_type": meta["model_type"],
        "frames_expected": _settings.get_expected_frames(meta["model_type"]),
        "frames_received": result["total_frames"],
        "frames_missing": result.get("frames_missing", 0),
        "partial": result.get("frames_missing", 0) > 0,
        "degraded": result.get("degraded", False),
        "total_points": result["total_points"],
        "pipeline_duration_ms": result.get("pipeline_duration_ms", 0),
        "load_ms": result.get("load_ms", 0),
        "sor_ms": result.get("sor_ms", 0),
        "registration_ms": result.get("registration_ms", 0),
        "merge_ms": result.get("merge_ms", 0),
        "stitch_ms": result.get("stitch_ms", 0),
        "depth_map_ms": result.get("depth_map_ms", 0),
    }))

    _accumulator.cleanup(key)


async def process_message(message: AbstractIncomingMessage) -> None:
    """Process a single frame message from sealer-processed-queue."""
    global _accumulator, _settings

    async with message.process(requeue=False):
        body = message.body

        if body is None or len(body) == 0:
            logger.warning("Empty message body received, auto-ACK")
            return

        try:
            msg = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            logger.error(f"Failed to decode message: {e}")
            raise ValueError("Malformed message") from e

        required = ["vin_number", "model_type", "frame_number",
                     "frame_path", "frame_file", "encoder_position_mm"]
        missing = [f for f in required if f not in msg]
        if missing:
            logger.error(f"Missing required fields: {missing}")
            raise ValueError(f"Missing fields: {missing}")

        # Get expected count from settings
        expected = _settings.get_expected_frames(msg["model_type"])
        if expected is None:
            logger.warning(
                f"model_type '{msg['model_type']}' not in sealer_model_frames_map, "
                "using timeout-only mode"
            )

        complete = _accumulator.add_frame(msg, expected_count=expected)

        # Check for stale scans
        stale = _accumulator.flush_stale_scans()
        for key, frames in stale:
            await _process_scan(key, frames)

        # Process if complete
        if complete:
            vin = msg["vin_number"]
            for key in _accumulator._redis.scan_iter(match=f"scan:{vin}:*"):
                key_str = key if isinstance(key, str) else key.decode()
                frames = _accumulator.get_scan_frames(key_str)
                await _process_scan(key_str, frames)
                break


async def main():
    """Main async entry point."""
    global _accumulator, _settings, _runner, _rabbit_client

    logger.info("Starting visionking-point-cloud-processor...")

    # Redis connections
    redis_acc = create_redis_accumulator()
    redis_settings = create_redis_settings()

    _accumulator = ScanAccumulator(
        redis_acc,
        scan_timeout=PCP_SCAN_TIMEOUT,
        scan_ttl=PCP_SCAN_TTL,
        timestamp_tolerance_ms=PCP_FRAME_TIMESTAMP_TOLERANCE_MS,
    )

    _settings = SealerSettings(redis_settings, PCP_REDIS_HASH_SETTINGS)
    _settings.reload()

    # Check settings availability
    has_settings = redis_settings.exists(PCP_REDIS_HASH_SETTINGS)
    if not has_settings:
        logger.warning(
            f"Settings hash '{PCP_REDIS_HASH_SETTINGS}' not found in Redis DB{PCP_REDIS_DB_SETTINGS}. "
            "Running in timeout-only mode for all model types."
        )

    # Camera calibration
    K, D = _load_calibration()

    _runner = PipelineRunner(
        settings=_settings,
        shift_unit_vector=PCP_SHIFT_UNIT_VECTOR,
        camera_matrix=K,
        dist_coeffs=D,
    )

    # Flush stale scans from previous run
    stale = _accumulator.flush_stale_scans()
    for key, frames in stale:
        await _process_scan(key, frames)
    if stale:
        logger.info(f"Recovered {len(stale)} stale scans from previous session")

    # RabbitMQ
    _rabbit_client = create_rabbit_client()

    while True:
        try:
            await _rabbit_client.connect()
            logger.success("RabbitMQ connection established.")
            break
        except Exception as e:
            logger.error(f"Failed to connect to RabbitMQ: {e}. Retrying in {APP_STARTUP_RETRY_DELAY}s...")
            await asyncio.sleep(APP_STARTUP_RETRY_DELAY)

    try:
        logger.info(f"Starting consumption from {PCP_RABBIT_INPUT_QUEUE}")
        await _rabbit_client.consume_messages(process_message)
    except KeyboardInterrupt:
        logger.info("Application interrupted by user")
    except Exception:
        logger.critical("Critical error in main loop", exc_info=True)
    finally:
        logger.info("Shutting down visionking-point-cloud-processor...")
        await _rabbit_client.close_connection()
        logger.info("Resources released. Application terminated.")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Verify imports work**

```bash
cd workspaces/strokmatic/visionking/services/point-cloud-processor
python -c "from src.utils.read_env_var import *; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add visionking-point-cloud-processor.py
git commit -m "feat(sealer): add point-cloud-processor entry point

Async main with RabbitMQ consumer, Redis accumulation, pipeline
execution, and downstream message publishing."
```

---

## Task 12: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
cd workspaces/strokmatic/visionking/services/point-cloud-processor
python -m pytest tests/ -v --tb=short
```

Expected: all tests PASS (across all test files)

- [ ] **Step 2: Verify Docker build**

```bash
cd workspaces/strokmatic/visionking
docker build -f services/point-cloud-processor/visionking-point-cloud-processor.Dockerfile \
  -t visionking-point-cloud-processor:test \
  services/point-cloud-processor/
```

Expected: build succeeds

- [ ] **Step 3: Final commit with all files**

```bash
git add services/point-cloud-processor/
git commit -m "feat(sealer): SEALER-01 point-cloud-processor service complete

Multi-frame VIN aggregation with Redis accumulator, 6-stage processing
pipeline (load, SOR, registration, merge, stitching, depth map),
runtime-tunable settings via Redis DB3, full test suite."
```

---

# CAD Registration Stage (added 2026-05-07)

> **Added 2026-05-07** — depends on existing branch `feat/post-review-investigations` being merged or rebased onto. New tasks in this section assume Stages 1-4 from prior tasks are complete and tested.
>
> **Spec reference:** `docs/superpowers/specs/2026-04-13-sealer-01-point-cloud-processor-design.md` Section 4 Stage 5, Section 5 Configuration, Section 6 Service Structure, Section 7 Error Handling, Section 9 Testing, Section 13 Revision History.
>
> **Goal:** Insert a new pipeline stage between merge (Stage 4) and stitching (renumbered to Stage 6) that best-fit registers the merged cloud against the part STL via ICP point-to-plane, applies `T_part→CAD` in place, and publishes the consolidated cloud + depth map already in CAD frame, plus diagnostics in the output message.
>
> **Renumbering:** Existing pipeline stages 5 (stitching) and 6 (depth map) become Stage 6 and Stage 7. Tasks below only touch the new Stage 5 wiring, the depth-map metadata extension, the runner orchestration, the output schema, the settings, and the env vars — they do **not** rewrite any existing implementation.

---

## Task 13: Test fixtures — synthetic STL and pose-perturbation helpers

**Intent:** Provide deterministic synthetic CAD data so every CAD-registration test is reproducible without real customer STEP/STL files. Cube + cylinder bead is enough geometry to exercise both planar surface and bead alignment.

**Files:**
- Create: `services/point-cloud-processor/tests/fixtures/cad/TEST_MODEL/part.stl` (generated via fixture script, committed)
- Create: `services/point-cloud-processor/tests/fixtures/cad/__init__.py`
- Create: `services/point-cloud-processor/tests/fixtures/cad/build_test_stl.py`
- Update: `services/point-cloud-processor/tests/conftest.py` (add `cad_fixtures_dir`, `synthetic_part_cloud`, `apply_pose_perturbation` fixtures)
- Update: `services/point-cloud-processor/visionking-point-cloud-processor.req` (add `trimesh>=4.0,<5.0` to test deps if not yet present)

- [ ] **Step 1: Write failing tests for fixtures**

```python
# tests/test_cad_fixtures.py
import os
import numpy as np
import pytest


class TestCadFixtures:
    def test_test_model_stl_exists(self, cad_fixtures_dir):
        stl_path = os.path.join(cad_fixtures_dir, "TEST_MODEL", "part.stl")
        assert os.path.isfile(stl_path)
        assert os.path.getsize(stl_path) > 0

    def test_synthetic_part_cloud_aligns_with_stl(self, synthetic_part_cloud):
        # Cloud is dense enough for ICP to converge
        assert len(synthetic_part_cloud.points) >= 5000

    def test_small_pose_perturbation_within_bounds(self, apply_pose_perturbation,
                                                   synthetic_part_cloud):
        perturbed, T = apply_pose_perturbation(
            synthetic_part_cloud, max_translation_mm=10.0, max_rotation_deg=2.0
        )
        # Translation magnitude
        assert np.linalg.norm(T[:3, 3]) <= 10.0 + 1e-6
        # Rotation angle from trace
        cos_theta = (np.trace(T[:3, :3]) - 1) / 2
        angle_deg = np.degrees(np.arccos(np.clip(cos_theta, -1.0, 1.0)))
        assert angle_deg <= 2.0 + 1e-6

    def test_large_pose_perturbation_within_bounds(self, apply_pose_perturbation,
                                                   synthetic_part_cloud):
        perturbed, T = apply_pose_perturbation(
            synthetic_part_cloud, min_translation_mm=50.0, min_rotation_deg=30.0
        )
        assert np.linalg.norm(T[:3, 3]) >= 50.0 - 1e-6
        cos_theta = (np.trace(T[:3, :3]) - 1) / 2
        angle_deg = np.degrees(np.arccos(np.clip(cos_theta, -1.0, 1.0)))
        assert angle_deg >= 30.0 - 1e-6
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_cad_fixtures.py -v
```

- [ ] **Step 3: Implement `tests/fixtures/cad/build_test_stl.py`**

```python
# tests/fixtures/cad/build_test_stl.py
"""Generate a deterministic synthetic STL (cube + cylinder bead) for tests.

Run once: `python tests/fixtures/cad/build_test_stl.py`.
The output `TEST_MODEL/part.stl` is committed so CI does not need trimesh.
"""

from pathlib import Path

import numpy as np
import trimesh


def build() -> trimesh.Trimesh:
    cube = trimesh.creation.box(extents=(100.0, 100.0, 5.0))
    bead = trimesh.creation.cylinder(radius=2.0, height=80.0, sections=24)
    bead.apply_translation([0.0, 0.0, 2.5 + 1.0])
    bead.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    return trimesh.util.concatenate([cube, bead])


def main():
    out_dir = Path(__file__).parent / "TEST_MODEL"
    out_dir.mkdir(parents=True, exist_ok=True)
    mesh = build()
    mesh.export(out_dir / "part.stl", file_type="stl")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Generate the STL once and commit it**

```bash
python tests/fixtures/cad/build_test_stl.py
ls -la tests/fixtures/cad/TEST_MODEL/part.stl
```

- [ ] **Step 5: Add fixtures to `tests/conftest.py`**

```python
# tests/conftest.py — append
import os
import numpy as np
import open3d as o3d
import pytest


@pytest.fixture
def cad_fixtures_dir() -> str:
    return os.path.join(os.path.dirname(__file__), "fixtures", "cad")


@pytest.fixture
def synthetic_part_cloud(cad_fixtures_dir):
    """Sample TEST_MODEL/part.stl into a dense point cloud (CAD frame)."""
    stl_path = os.path.join(cad_fixtures_dir, "TEST_MODEL", "part.stl")
    mesh = o3d.io.read_triangle_mesh(stl_path)
    mesh.compute_vertex_normals()
    return mesh.sample_points_uniformly(number_of_points=20000, seed=42)


@pytest.fixture
def apply_pose_perturbation():
    """Return a callable that applies a random rigid perturbation (deterministic seed)."""

    def _apply(pcd, max_translation_mm=10.0, max_rotation_deg=2.0,
              min_translation_mm=0.0, min_rotation_deg=0.0, seed=7):
        rng = np.random.default_rng(seed)
        # Translation
        tdir = rng.normal(size=3)
        tdir /= np.linalg.norm(tdir)
        tmag = rng.uniform(min_translation_mm, max_translation_mm)
        t = tdir * tmag
        # Rotation
        rdir = rng.normal(size=3)
        rdir /= np.linalg.norm(rdir)
        rmag = np.radians(rng.uniform(min_rotation_deg, max_rotation_deg))
        K = np.array([[0, -rdir[2], rdir[1]],
                      [rdir[2], 0, -rdir[0]],
                      [-rdir[1], rdir[0], 0]])
        R = np.eye(3) + np.sin(rmag) * K + (1 - np.cos(rmag)) * (K @ K)
        T = np.eye(4)
        T[:3, :3] = R
        T[:3, 3] = t
        moved = o3d.geometry.PointCloud(pcd)
        moved.transform(T)
        return moved, T

    return _apply
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
python -m pytest tests/test_cad_fixtures.py -v
```

Expected: all 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/cad/ tests/test_cad_fixtures.py tests/conftest.py \
        visionking-point-cloud-processor.req
git commit -m "test(point-cloud): synthetic CAD STL + pose perturbation fixtures

Cube + cylinder bead generated via trimesh, deterministic seed.
Fixtures for small (<=10mm/2deg) and large (>=50mm/30deg) perturbations
used by the upcoming CAD registration tests."
```

---

## Task 14: CAD loader — STL load, sample, mtime cache

**Intent:** Centralise per-`model_type` STL loading and target sampling. Cache by `(model_type, mtime)` so hot-swap of CAD assets does not require a service restart.

**Files:**
- Create: `services/point-cloud-processor/src/calibration/cad_loader.py`
- Create: `services/point-cloud-processor/tests/test_cad_loader.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_cad_loader.py
import os
import time
from unittest.mock import patch

import numpy as np
import open3d as o3d
import pytest

from src.calibration.cad_loader import load_cad_target, _CACHE


@pytest.fixture(autouse=True)
def _clear_cache():
    _CACHE.clear()
    yield
    _CACHE.clear()


class TestLoadCadTarget:
    def test_loads_stl_for_known_model(self, cad_fixtures_dir):
        with patch.dict(os.environ, {"PCP_CAD_DIR": cad_fixtures_dir}):
            target = load_cad_target("TEST_MODEL", sample_size=5000)
        assert isinstance(target, o3d.geometry.PointCloud)
        assert len(target.points) == 5000
        # Normals computed for point-to-plane ICP
        assert target.has_normals()

    def test_deterministic_sampling(self, cad_fixtures_dir):
        with patch.dict(os.environ, {"PCP_CAD_DIR": cad_fixtures_dir}):
            t1 = load_cad_target("TEST_MODEL", sample_size=5000, cache=False)
            t2 = load_cad_target("TEST_MODEL", sample_size=5000, cache=False)
        np.testing.assert_array_equal(np.asarray(t1.points), np.asarray(t2.points))

    def test_cache_hit_returns_same_instance(self, cad_fixtures_dir):
        with patch.dict(os.environ, {"PCP_CAD_DIR": cad_fixtures_dir}):
            t1 = load_cad_target("TEST_MODEL", sample_size=5000)
            t2 = load_cad_target("TEST_MODEL", sample_size=5000)
        assert t1 is t2

    def test_mtime_change_invalidates_cache(self, cad_fixtures_dir, tmp_path):
        # Copy STL to a writable location
        stl_dir = tmp_path / "TEST_MODEL"
        stl_dir.mkdir()
        src = os.path.join(cad_fixtures_dir, "TEST_MODEL", "part.stl")
        dst = stl_dir / "part.stl"
        dst.write_bytes(open(src, "rb").read())

        with patch.dict(os.environ, {"PCP_CAD_DIR": str(tmp_path)}):
            t1 = load_cad_target("TEST_MODEL", sample_size=2000)
            # Bump mtime
            future = time.time() + 10
            os.utime(dst, (future, future))
            t2 = load_cad_target("TEST_MODEL", sample_size=2000)
        assert t1 is not t2

    def test_missing_stl_raises_filenotfound(self, tmp_path):
        with patch.dict(os.environ, {"PCP_CAD_DIR": str(tmp_path)}):
            with pytest.raises(FileNotFoundError):
                load_cad_target("UNKNOWN_MODEL", sample_size=1000)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_cad_loader.py -v
```

- [ ] **Step 3: Implement `src/calibration/cad_loader.py`**

```python
# src/calibration/cad_loader.py
"""Per-model_type STL loader with mtime-based cache.

Samples each STL into an Open3D point cloud with normals (required for
point-to-plane ICP in the CAD registration stage). Sampling uses a fixed
seed so the same STL produces the same target across runs.
"""

import os
from typing import Tuple

import open3d as o3d
from loguru import logger


_CACHE: dict[str, Tuple[float, int, o3d.geometry.PointCloud]] = {}
"""model_type -> (mtime, sample_size, target_cloud)."""

_SAMPLE_SEED = 42


def _resolve_stl_path(model_type: str) -> str:
    base = os.environ.get("PCP_CAD_DIR", "/cad/sealer/")
    return os.path.join(base, model_type, "part.stl")


def load_cad_target(
    model_type: str,
    sample_size: int = 50_000,
    cache: bool = True,
) -> o3d.geometry.PointCloud:
    """Load + sample the part STL for `model_type`.

    Args:
        model_type: subdirectory name under PCP_CAD_DIR.
        sample_size: number of points to sample uniformly (deterministic).
        cache: if True, reuse cached target when STL mtime is unchanged.

    Returns:
        Point cloud with vertex normals computed.

    Raises:
        FileNotFoundError: if `${PCP_CAD_DIR}/${model_type}/part.stl` is absent.
        ValueError: if the STL is unreadable / has no faces.
    """
    stl_path = _resolve_stl_path(model_type)
    if not os.path.isfile(stl_path):
        raise FileNotFoundError(f"CAD STL missing for model_type={model_type}: {stl_path}")

    mtime = os.path.getmtime(stl_path)
    if cache:
        cached = _CACHE.get(model_type)
        if cached is not None and cached[0] == mtime and cached[1] == sample_size:
            return cached[2]

    mesh = o3d.io.read_triangle_mesh(stl_path)
    if len(mesh.triangles) == 0:
        raise ValueError(f"CAD STL has no triangles: {stl_path}")
    mesh.compute_vertex_normals()
    target = mesh.sample_points_uniformly(number_of_points=sample_size, seed=_SAMPLE_SEED)
    target.estimate_normals()
    target.orient_normals_consistent_tangent_plane(k=20)

    if cache:
        _CACHE[model_type] = (mtime, sample_size, target)
    logger.info(
        f"Loaded CAD target: model_type={model_type}, sample_size={sample_size}, "
        f"mtime={mtime:.0f}, cached={cache}"
    )
    return target
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_cad_loader.py -v
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/calibration/cad_loader.py tests/test_cad_loader.py
git commit -m "feat(point-cloud): per-model_type STL loader with mtime cache

Deterministic uniform sampling (seed=42) + normals for point-to-plane ICP.
Cache invalidates when STL mtime changes — supports CAD hot-swap without
service restart. Missing STL raises FileNotFoundError so the runner can
NACK->DLX as a config error."
```

---

## Task 15: CAD registration module — best-fit ICP

**Intent:** Implement Stage 5 as a pure function with no side effects on the merged cloud unless registration succeeds. Returns a structured result the runner can serialise into the output message.

**Files:**
- Create: `services/point-cloud-processor/src/pipeline/cad_registration.py`
- Create: `services/point-cloud-processor/tests/test_cad_registration.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_cad_registration.py
import copy

import numpy as np
import open3d as o3d
import pytest

from src.pipeline.cad_registration import (
    register_to_cad,
    RegistrationResult,
    CadRegistrationSettings,
)


@pytest.fixture
def default_settings():
    return CadRegistrationSettings(
        voxel_size_mm=1.0,
        max_correspondence_distance_mm=5.0,
        max_iterations=50,
        rmse_threshold_mm=3.0,
        min_fitness=0.7,
    )


class TestRegisterToCad:
    def test_identity_input_returns_near_identity(self, synthetic_part_cloud,
                                                  default_settings):
        merged = copy.deepcopy(synthetic_part_cloud)
        target = synthetic_part_cloud

        result = register_to_cad(merged, target, default_settings)

        assert isinstance(result, RegistrationResult)
        assert result.converged is True
        np.testing.assert_allclose(result.T, np.eye(4), atol=0.5)
        assert result.rmse_mm < 0.5

    def test_recovers_small_perturbation(self, synthetic_part_cloud,
                                         apply_pose_perturbation, default_settings):
        target = synthetic_part_cloud
        perturbed, T_applied = apply_pose_perturbation(
            target, max_translation_mm=10.0, max_rotation_deg=2.0
        )

        result = register_to_cad(perturbed, target, default_settings)

        assert result.converged is True
        # T_recovered approximates the inverse of the applied perturbation
        T_recovered = result.T @ T_applied
        np.testing.assert_allclose(T_recovered, np.eye(4), atol=2.0)

    def test_rejects_large_perturbation(self, synthetic_part_cloud,
                                        apply_pose_perturbation, default_settings):
        target = synthetic_part_cloud
        perturbed, _ = apply_pose_perturbation(
            target, min_translation_mm=50.0, max_translation_mm=80.0,
            min_rotation_deg=30.0, max_rotation_deg=45.0
        )

        result = register_to_cad(perturbed, target, default_settings)

        assert result.converged is False
        np.testing.assert_array_equal(result.T, np.eye(4))

    def test_respects_rmse_threshold(self, synthetic_part_cloud, default_settings):
        # Tight threshold should reject even an OK alignment
        tight = CadRegistrationSettings(**{**default_settings.__dict__,
                                            "rmse_threshold_mm": 1e-6,
                                            "min_fitness": 0.0})
        result = register_to_cad(synthetic_part_cloud, synthetic_part_cloud, tight)
        assert result.converged is False

    def test_respects_min_fitness(self, synthetic_part_cloud, default_settings):
        impossible = CadRegistrationSettings(**{**default_settings.__dict__,
                                                 "min_fitness": 1.5})
        result = register_to_cad(synthetic_part_cloud, synthetic_part_cloud, impossible)
        assert result.converged is False

    def test_applies_transform_in_place_only_on_success(self, synthetic_part_cloud,
                                                        apply_pose_perturbation,
                                                        default_settings):
        target = synthetic_part_cloud
        perturbed, _ = apply_pose_perturbation(
            target, max_translation_mm=10.0, max_rotation_deg=2.0
        )
        before = np.asarray(perturbed.points).copy()

        result = register_to_cad(perturbed, target, default_settings,
                                 apply_in_place=True)

        after = np.asarray(perturbed.points)
        if result.converged:
            assert not np.allclose(before, after)
        else:
            np.testing.assert_array_equal(before, after)

    def test_does_not_apply_when_apply_in_place_false(self, synthetic_part_cloud,
                                                      apply_pose_perturbation,
                                                      default_settings):
        target = synthetic_part_cloud
        perturbed, _ = apply_pose_perturbation(
            target, max_translation_mm=5.0, max_rotation_deg=1.0
        )
        before = np.asarray(perturbed.points).copy()

        register_to_cad(perturbed, target, default_settings, apply_in_place=False)

        np.testing.assert_array_equal(before, np.asarray(perturbed.points))

    def test_empty_source_cloud_returns_failure(self, synthetic_part_cloud,
                                                default_settings):
        empty = o3d.geometry.PointCloud()
        result = register_to_cad(empty, synthetic_part_cloud, default_settings)
        assert result.converged is False
        np.testing.assert_array_equal(result.T, np.eye(4))
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_cad_registration.py -v
```

- [ ] **Step 3: Implement `src/pipeline/cad_registration.py`**

```python
# src/pipeline/cad_registration.py
"""Stage 5: Best-fit ICP point-to-plane registration of merged cloud against CAD.

Returns T_part_to_CAD (4x4) plus diagnostics. Applies the transform to the
merged cloud in place only when registration is accepted (rmse below
threshold AND fitness above minimum).
"""

from dataclasses import dataclass

import numpy as np
import open3d as o3d
from loguru import logger


@dataclass(frozen=True)
class CadRegistrationSettings:
    voxel_size_mm: float
    max_correspondence_distance_mm: float
    max_iterations: int
    rmse_threshold_mm: float
    min_fitness: float


@dataclass
class RegistrationResult:
    T: np.ndarray  # 4x4
    rmse_mm: float
    fitness: float
    iterations: int | None  # None when Open3D does not expose actual count; -1 reserved for future provider
    converged: bool


def _initial_alignment(source: o3d.geometry.PointCloud,
                       target: o3d.geometry.PointCloud) -> np.ndarray:
    """Centroid-to-centroid translation as warm start."""
    if len(source.points) == 0 or len(target.points) == 0:
        return np.eye(4)
    src_c = np.asarray(source.points).mean(axis=0)
    tgt_c = np.asarray(target.points).mean(axis=0)
    T = np.eye(4)
    T[:3, 3] = tgt_c - src_c
    return T


def register_to_cad(
    merged: o3d.geometry.PointCloud,
    cad_target: o3d.geometry.PointCloud,
    settings: CadRegistrationSettings,
    apply_in_place: bool = True,
) -> RegistrationResult:
    """Best-fit register `merged` to `cad_target`.

    On success applies T to `merged` in place (if `apply_in_place=True`) and
    returns `converged=True`. On failure (empty cloud, ICP exception, RMSE or
    fitness outside thresholds), returns `T = identity, converged=False` and
    leaves `merged` untouched.
    """
    if len(merged.points) == 0 or len(cad_target.points) == 0:
        logger.warning("CAD registration skipped: empty source or target cloud")
        return RegistrationResult(np.eye(4), float("inf"), 0.0, None, False)

    # Downsample source for ICP performance + density normalisation
    src_ds = merged.voxel_down_sample(settings.voxel_size_mm)
    if not src_ds.has_normals():
        src_ds.estimate_normals()

    T_init = _initial_alignment(src_ds, cad_target)

    try:
        criteria = o3d.pipelines.registration.ICPConvergenceCriteria(
            relative_fitness=1e-6,
            relative_rmse=1e-6,
            max_iteration=settings.max_iterations,
        )
        reg = o3d.pipelines.registration.registration_icp(
            source=src_ds,
            target=cad_target,
            max_correspondence_distance=settings.max_correspondence_distance_mm,
            init=T_init,
            estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPlane(),
            criteria=criteria,
        )
    except Exception as e:
        logger.error(f"ICP raised: {e}")
        return RegistrationResult(np.eye(4), float("inf"), 0.0, None, False)

    rmse_mm = float(reg.inlier_rmse)
    fitness = float(reg.fitness)
    # Open3D's `registration_icp` does not expose the actual iteration count.
    # Publish None so consumers don't read max_iterations as "ran-to-completion".
    # If a future Open3D version exposes it, replace with reg.num_iterations.
    iterations: int | None = None
    accepted = (
        rmse_mm < settings.rmse_threshold_mm
        and fitness > settings.min_fitness
    )

    logger.info(
        f"CAD registration: rmse={rmse_mm:.3f}mm, fitness={fitness:.3f}, "
        f"accepted={accepted}"
    )

    if not accepted:
        return RegistrationResult(np.eye(4), rmse_mm, fitness, iterations, False)

    T = np.asarray(reg.transformation).copy()
    if apply_in_place:
        merged.transform(T)
    return RegistrationResult(T, rmse_mm, fitness, iterations, True)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_cad_registration.py -v
```

Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/cad_registration.py tests/test_cad_registration.py
git commit -m "feat(point-cloud): cad-aligned merged cloud via best-fit ICP

Point-to-plane ICP with centroid warm-start. Accept rule: rmse below
threshold AND fitness above min. On failure returns identity T and leaves
the cloud untouched so the runner can publish in part frame with
degraded=true. Returns RegistrationResult dataclass for downstream
serialisation."
```

---

## Task 16: Extend `SealerSettings` with CAD fields

**Intent:** Make Stage 5 tunable at runtime via the same Redis DB3 hash that already drives the rest of the pipeline.

**Files:**
- Update: `services/point-cloud-processor/src/settings/redis_settings.py`
- Update: `services/point-cloud-processor/tests/test_redis_settings.py`

- [ ] **Step 1: Add failing tests for new fields**

```python
# tests/test_redis_settings.py — append
class TestCadSettings:
    def test_cad_defaults_when_redis_empty(self, fake_redis):
        settings = SealerSettings(fake_redis, "settings")
        settings.reload()
        assert settings.cad_target_sample_size == 50_000
        assert settings.cad_icp_voxel_size_mm == 1.0
        assert settings.cad_icp_max_correspondence_distance_mm == 5.0
        assert settings.cad_icp_max_iterations == 50
        assert settings.cad_registration_rmse_threshold_mm == 3.0
        assert settings.cad_registration_min_fitness == 0.7

    def test_cad_redis_overrides_defaults(self, fake_redis):
        fake_redis.hset("settings", "sealer_cad_target_sample_size", 80000)
        fake_redis.hset("settings", "sealer_cad_icp_voxel_size_mm", 0.5)
        fake_redis.hset("settings", "sealer_cad_icp_max_correspondence_distance_mm", 8.0)
        fake_redis.hset("settings", "sealer_cad_icp_max_iterations", 100)
        fake_redis.hset("settings", "sealer_cad_registration_rmse_threshold_mm", 1.5)
        fake_redis.hset("settings", "sealer_cad_registration_min_fitness", 0.85)

        settings = SealerSettings(fake_redis, "settings")
        settings.reload()

        assert settings.cad_target_sample_size == 80000
        assert settings.cad_icp_voxel_size_mm == 0.5
        assert settings.cad_icp_max_correspondence_distance_mm == 8.0
        assert settings.cad_icp_max_iterations == 100
        assert settings.cad_registration_rmse_threshold_mm == 1.5
        assert settings.cad_registration_min_fitness == 0.85
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_redis_settings.py::TestCadSettings -v
```

- [ ] **Step 3: Extend `SealerSettings`**

```python
# src/settings/redis_settings.py — in __init__, add:
self.cad_target_sample_size: int = 50_000
self.cad_icp_voxel_size_mm: float = 1.0
self.cad_icp_max_correspondence_distance_mm: float = 5.0
self.cad_icp_max_iterations: int = 50
self.cad_registration_rmse_threshold_mm: float = 3.0
self.cad_registration_min_fitness: float = 0.7

# in reload(), add:
self._load_field_int("sealer_cad_target_sample_size",
                     "cad_target_sample_size", 50_000)
self._load_field_float("sealer_cad_icp_voxel_size_mm",
                       "cad_icp_voxel_size_mm", 1.0)
self._load_field_float("sealer_cad_icp_max_correspondence_distance_mm",
                       "cad_icp_max_correspondence_distance_mm", 5.0)
self._load_field_int("sealer_cad_icp_max_iterations",
                     "cad_icp_max_iterations", 50)
self._load_field_float("sealer_cad_registration_rmse_threshold_mm",
                       "cad_registration_rmse_threshold_mm", 3.0)
self._load_field_float("sealer_cad_registration_min_fitness",
                       "cad_registration_min_fitness", 0.7)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_redis_settings.py -v
```

Expected: existing + 2 new tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/settings/redis_settings.py tests/test_redis_settings.py
git commit -m "feat(point-cloud): add CAD registration settings to Redis DB3

Six new sealer_cad_* fields with spec defaults. Tunable at runtime
without service restart, like the rest of the sealer pipeline."
```

---

## Task 17: Add `PCP_CAD_DIR` env var

**Intent:** Single deploy-time knob for where customer STLs live.

**Files:**
- Update: `services/point-cloud-processor/src/utils/read_env_var.py`

- [ ] **Step 1: Add the env var**

```python
# src/utils/read_env_var.py — append (Processing — fixed at deploy)
PCP_CAD_DIR = os.getenv("PCP_CAD_DIR", "/cad/sealer/")
```

- [ ] **Step 2: Verify import**

```bash
python -c "from src.utils.read_env_var import PCP_CAD_DIR; print(PCP_CAD_DIR)"
```

Expected: `/cad/sealer/`

- [ ] **Step 3: Commit**

```bash
git add src/utils/read_env_var.py
git commit -m "feat(point-cloud): add PCP_CAD_DIR env var (default /cad/sealer/)

Per-model_type STL lives at \${PCP_CAD_DIR}/\${model_type}/part.stl, populated
by the SEALER provisioning CLI."
```

---

## Task 18: Update depth map to emit origin and resolution metadata

**Intent:** Downstream services (sealer-2d inference) need to map pixels back to CAD-frame mm. Returning the grid origin + resolution alongside the array makes that explicit.

**Files:**
- Update: `services/point-cloud-processor/src/pipeline/depth_map.py`
- Update: `services/point-cloud-processor/tests/test_depth_map.py`

- [ ] **Step 1: Add failing tests for the new return shape**

```python
# tests/test_depth_map.py — extend / add
class TestGenerateDepthMapMetadata:
    def test_returns_array_origin_resolution(self):
        points = [[10, 20, 5.0], [60, 70, 8.0]]
        pcd = _make_cloud(points)
        depth, origin, resolution = generate_depth_map(pcd, resolution_mm=1.0)
        assert isinstance(depth, np.ndarray)
        assert origin == pytest.approx([10.0, 20.0])
        assert resolution == pytest.approx(1.0)

    def test_empty_cloud_returns_default_origin(self):
        pcd = o3d.geometry.PointCloud()
        depth, origin, resolution = generate_depth_map(pcd, resolution_mm=0.5)
        assert depth.size == 0
        assert origin == [0.0, 0.0]
        assert resolution == pytest.approx(0.5)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_depth_map.py -v
```

- [ ] **Step 3: Audit all callers of `generate_depth_map`**

Before changing the signature, verify what code consumes the current return value. Run from the service root:

```bash
git grep -n "generate_depth_map" -- '*.py'
```

Expected callers as of branch `feat/post-review-investigations` @ `7f66f89`:
- `src/pipeline/runner.py` — calls `depth = generate_depth_map(...)` and immediately `np.save(depth_path, depth)`. Must be updated to unpack the tuple and persist origin/resolution alongside (handled in Task 19).
- `tests/test_depth_map.py` — existing test class `TestGenerateDepthMap` expects an `np.ndarray`. Update each call site to `depth, _, _ = generate_depth_map(...)` to keep prior assertions valid.

If the grep surfaces other callers (scripts, notebooks, integration tests), update each one in the same commit so the breakage window is zero. Add the discovered call sites to this checklist before proceeding.

- [ ] **Step 4: Update `generate_depth_map` signature and existing tests**

Change the return type from `np.ndarray` to `tuple[np.ndarray, list[float], float]`.

```python
# src/pipeline/depth_map.py — replace generate_depth_map
def generate_depth_map(
    pcd: o3d.geometry.PointCloud,
    resolution_mm: float = 0.5,
) -> tuple[np.ndarray, list[float], float]:
    """Top-down XY projection in CAD frame.

    Returns (depth_array, [x_min_mm, y_min_mm], resolution_mm). Empty pixels
    are NaN. Empty input cloud returns (empty_array, [0.0, 0.0], resolution).
    """
    points = np.asarray(pcd.points)

    if len(points) == 0:
        return np.array([], dtype=np.float32), [0.0, 0.0], float(resolution_mm)

    x_min, y_min, _ = points.min(axis=0)
    x_max, y_max, _ = points.max(axis=0)
    # ... existing implementation ...
    return depth, [float(x_min), float(y_min)], float(resolution_mm)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
python -m pytest tests/test_depth_map.py -v
```

Expected: all tests PASS (including new metadata tests)

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/depth_map.py tests/test_depth_map.py
git commit -m "feat(point-cloud): depth map emits origin + resolution metadata

Returns (array, [x_min_mm, y_min_mm], resolution_mm) so downstream services
can map pixels<->CAD mm without re-deriving the grid."
```

---

## Task 19: Wire Stage 5 into `PipelineRunner`

**Intent:** Insert the new stage between merge (existing Stage 4) and stitching (renumber to Stage 6) in `runner.py`. Save `merged.ply` after the CAD transform so the on-disk cloud is in CAD frame on success. Pass through new metrics (`cad_registration_ms`, `cad_registration_rmse_mm`, etc.) and the `cad_registration` block (with `T`, `rmse`, `fitness`, `iterations`, `converged`, `stl_path`, `stl_mtime`).

**Files:**
- Update: `services/point-cloud-processor/src/pipeline/runner.py`
- Update: `services/point-cloud-processor/tests/test_runner.py`

- [ ] **Step 1: Add failing runner tests**

```python
# tests/test_runner.py — append
class TestRunnerCadStage:
    def test_cad_stage_runs_between_merge_and_stitch(self, monkeypatch, runner_with_fake_settings,
                                                     synthetic_frames_meta, tmp_path):
        # Spy on call order: merge -> cad_registration -> stitching -> depth_map
        order = []
        monkeypatch.setattr("src.pipeline.runner.merge_clouds",
                            lambda *a, **kw: (order.append("merge") or _make_cloud(...)))
        monkeypatch.setattr("src.pipeline.runner.register_to_cad",
                            lambda *a, **kw: (order.append("cad") or _ok_result()))
        monkeypatch.setattr("src.pipeline.runner.stitch_images",
                            lambda *a, **kw: (order.append("stitch") or None))
        monkeypatch.setattr("src.pipeline.runner.generate_depth_map",
                            lambda *a, **kw: (order.append("depth") or
                                              (np.zeros((1, 1), np.float32), [0.0, 0.0], 0.5)))
        runner_with_fake_settings.run(synthetic_frames_meta, str(tmp_path))
        assert order == ["merge", "cad", "stitch", "depth"]

    def test_merged_ply_saved_after_cad_transform(self, runner_with_fake_settings,
                                                  synthetic_frames_meta, tmp_path):
        result = runner_with_fake_settings.run(synthetic_frames_meta, str(tmp_path))
        # Cloud on disk must equal merged AFTER T_part_to_CAD applied
        saved = o3d.io.read_point_cloud(result["merged_ply_path"])
        # ... compare against expected CAD-frame cloud ...
        assert result["cad_registration"]["converged"] is True

    def test_depth_map_uses_cad_frame_cloud(self, runner_with_fake_settings,
                                            synthetic_frames_meta, tmp_path):
        result = runner_with_fake_settings.run(synthetic_frames_meta, str(tmp_path))
        # depth_map_origin_mm reflects CAD-frame bounding box, not part frame
        assert "depth_map_origin_mm" in result
        assert "depth_map_resolution_mm" in result

    def test_icp_failure_sets_degraded_and_identity(self, runner_with_fake_settings_failing_icp,
                                                    synthetic_frames_meta, tmp_path):
        result = runner_with_fake_settings_failing_icp.run(synthetic_frames_meta, str(tmp_path))
        assert result["degraded"] is True
        assert result["cad_registration"]["converged"] is False
        np.testing.assert_array_equal(result["cad_registration"]["T_part_to_CAD"],
                                      np.eye(4).tolist())

    def test_missing_stl_raises_to_caller(self, runner_with_missing_stl,
                                          synthetic_frames_meta, tmp_path):
        # Caller (entry point) translates this into NACK->DLX
        with pytest.raises(FileNotFoundError):
            runner_with_missing_stl.run(synthetic_frames_meta, str(tmp_path))

    def test_cad_registration_timing_recorded(self, runner_with_fake_settings,
                                              synthetic_frames_meta, tmp_path):
        result = runner_with_fake_settings.run(synthetic_frames_meta, str(tmp_path))
        assert "cad_registration_ms" in result
        assert isinstance(result["cad_registration_ms"], (int, float))
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_runner.py::TestRunnerCadStage -v
```

- [ ] **Step 3: Modify `src/pipeline/runner.py`**

Insert between Stage 4 (merge) and existing Stage 5 (stitching). Renumber stitching to Stage 6 and depth map to Stage 7 in comments. Order:

1. After `merge_clouds(...)`, before `o3d.io.write_point_cloud(merged_path, ...)`:
   - Look up `model_type` from `frames_meta[0]["model_type"]`
   - Call `cad_target = load_cad_target(model_type, sample_size=settings.cad_target_sample_size)` — let `FileNotFoundError` propagate (entry point will NACK->DLX)
   - Build `CadRegistrationSettings` from `self._settings`
   - Call `register_to_cad(merged, cad_target, cad_settings, apply_in_place=True)`
   - On `result.converged is False`: set `degraded = True` (merge with existing degraded logic), keep `T = identity`
   - Record `timings["cad_registration_ms"] = _elapsed_ms(t0)`
2. **Then** save `merged.ply` (so the file is in CAD frame on success).
3. Stitching (Stage 6) — unchanged code, just comment renumbered.
4. Depth map (Stage 7) — unpack new tuple `depth, origin_mm, resolution_mm` and forward both into the result dict.
5. Build the `cad_registration` block in the returned dict:

```python
"cad_registration": {
    "T_part_to_CAD": result.T.tolist(),
    "rmse_mm": result.rmse_mm,
    "fitness": result.fitness,
    "iterations": result.iterations,
    "converged": result.converged,
    "stl_path": _resolve_stl_path(model_type),
    "stl_mtime": _format_iso_mtime(_resolve_stl_path(model_type)),
},
"depth_map_origin_mm": origin_mm,
"depth_map_resolution_mm": resolution_mm,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_runner.py -v
```

Expected: all existing + 6 new runner tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/runner.py tests/test_runner.py
git commit -m "feat(point-cloud): wire CAD registration as new pipeline stage 5

Runs between merge (stage 4) and stitching (renumbered to 6). merged.ply
is saved after T_part_to_CAD is applied so the on-disk cloud is always in
CAD frame on success. ICP non-convergence -> degraded=true with identity
T, cloud kept in part frame. Missing STL propagates as FileNotFoundError
for the entry point to translate into NACK->DLX. Adds cad_registration_ms
timing and depth_map_origin_mm + depth_map_resolution_mm to the result."
```

---

## Task 20: Extend output message in entry point

**Intent:** Surface the new `cad_registration` block plus depth-map origin/resolution in the JSON published to both `sealer-measurement-queue` and `sealer-inference-queue`. Translate `FileNotFoundError` from a missing STL into NACK->DLX.

**Files:**
- Update: `services/point-cloud-processor/visionking-point-cloud-processor.py`
- Update: `services/point-cloud-processor/tests/test_entry_point.py` (create if missing — minimal coverage of `_process_scan` + `process_message` error handling)

- [ ] **Step 1: Add failing tests for the new payload**

```python
# tests/test_entry_point.py — append (or new)
class TestProcessScanPayload:
    @pytest.mark.asyncio
    async def test_payload_includes_cad_registration_block(self, monkeypatch, ...):
        # Mock _runner.run to return a result with cad_registration populated
        # Call _process_scan
        # Capture published bytes via spy on _rabbit_client.send_message
        # Assert payload has cad_registration with all fields
        ...

    @pytest.mark.asyncio
    async def test_payload_includes_depth_map_metadata(self, ...):
        ...

    @pytest.mark.asyncio
    async def test_missing_stl_nacks_without_requeue(self, monkeypatch, ...):
        # Mock _runner.run to raise FileNotFoundError
        # Call process_message; assert message.process(requeue=False) was used
        # Assert no message was published downstream
        ...
```

- [ ] **Step 2: Update `_process_scan` to propagate the new fields**

```python
output_msg = {
    # ... existing fields ...
    "cad_registration": result.get("cad_registration", {
        "T_part_to_CAD": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
        "rmse_mm": float("nan"),
        "fitness": 0.0,
        "iterations": 0,
        "converged": False,
        "stl_path": "",
        "stl_mtime": "",
    }),
    "depth_map_origin_mm": result.get("depth_map_origin_mm", [0.0, 0.0]),
    "depth_map_resolution_mm": result.get("depth_map_resolution_mm", 0.5),
}
```

Also extend the structured `scan_processed` log entry with `cad_registration_ms`, `cad_registration_rmse_mm`, `cad_registration_fitness`, `cad_registration_converged`.

- [ ] **Step 3: Map missing-STL to NACK->DLX in `process_message`**

```python
try:
    result = await asyncio.to_thread(_runner.run, frames, output_dir)
except FileNotFoundError as e:
    logger.error(f"CAD STL missing — NACK->DLX: {e}")
    raise  # async with message.process(requeue=False) sends to DLX
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/test_entry_point.py -v
```

Expected: all new tests PASS

- [ ] **Step 5: Commit**

```bash
git add visionking-point-cloud-processor.py tests/test_entry_point.py
git commit -m "feat(point-cloud): publish T_part_to_CAD + depth-map metadata

Output message gains cad_registration block (T, rmse, fitness, iterations,
converged, stl_path, stl_mtime), depth_map_origin_mm, and
depth_map_resolution_mm. Missing STL now NACKs without requeue (DLX) so
operators can provision the CAD before reprocessing. Both
sealer-measurement-queue and sealer-inference-queue receive the same
payload via the existing fanout publish."
```

---

## Task 21: End-to-end integration test

**Intent:** Prove that with a synthetic STL + 5 frames, the merged cloud written to disk is in CAD frame and the published message has a populated `cad_registration` block.

**Files:**
- Create: `services/point-cloud-processor/tests/test_integration_cad.py`

- [ ] **Step 1: Write the integration test**

```python
# tests/test_integration_cad.py
import json
import os
from unittest.mock import patch

import numpy as np
import open3d as o3d
import pytest

from src.pipeline.runner import PipelineRunner


@pytest.mark.integration
class TestCadEndToEnd:
    def test_merged_ply_in_cad_frame(self, cad_fixtures_dir, synthetic_frames_meta_5,
                                     tmp_path, fake_settings):
        with patch.dict(os.environ, {"PCP_CAD_DIR": cad_fixtures_dir}):
            # frames_meta has model_type="TEST_MODEL"
            runner = PipelineRunner(
                settings=fake_settings,
                shift_unit_vector=[0, 1, 0],
                camera_matrix=np.eye(3),
                dist_coeffs=np.zeros(5),
            )
            result = runner.run(synthetic_frames_meta_5, str(tmp_path))

        # Reload merged.ply from disk
        merged = o3d.io.read_point_cloud(result["merged_ply_path"])

        # Mean point-to-mesh distance to STL must be < 1mm in CAD frame
        stl_path = os.path.join(cad_fixtures_dir, "TEST_MODEL", "part.stl")
        mesh = o3d.io.read_triangle_mesh(stl_path)
        mesh.compute_vertex_normals()
        scene = o3d.t.geometry.RaycastingScene()
        scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(mesh))
        query = o3d.core.Tensor(np.asarray(merged.points), dtype=o3d.core.Dtype.Float32)
        distances = scene.compute_distance(query).numpy()
        assert distances.mean() < 1.0

        # Output dict has populated cad_registration
        assert result["cad_registration"]["converged"] is True
        assert result["cad_registration"]["rmse_mm"] < 3.0
        assert len(result["cad_registration"]["T_part_to_CAD"]) == 4
```

- [ ] **Step 2: Run the integration test**

```bash
python -m pytest tests/test_integration_cad.py -v
```

Expected: PASS (slow — may take several seconds for ICP)

- [ ] **Step 3: Commit**

```bash
git add tests/test_integration_cad.py
git commit -m "test(point-cloud): e2e CAD registration integration test

Synthetic STL + 5 frames. Asserts merged.ply on disk is in CAD frame
(mean point-to-mesh distance to TEST_MODEL/part.stl < 1mm) and the
published message has a populated cad_registration block."
```

---

## Task 22: Documentation and changelog

**Intent:** Land the design change in user-visible docs.

**Files:**
- Update: `services/point-cloud-processor/README.md`
- Update: `services/point-cloud-processor/CHANGELOG.md` (create if absent — Keep a Changelog format)

- [ ] **Step 1: Update README**

In the pipeline-stages section of `README.md`, insert Stage 5 (CAD Registration) and renumber stitching/depth map to 6/7. Mention `PCP_CAD_DIR`, the `sealer_cad_*` settings, and that `merged.ply` and `depth_map.npy` are published in CAD frame on success (degraded=true with identity T on failure).

- [ ] **Step 2: Add a CHANGELOG entry**

Keep a Changelog format (https://keepachangelog.com): an `## [Unreleased]` section at the top accumulates upcoming changes; on release it gets renamed to `## [X.Y.Z] - YYYY-MM-DD`. Append under the existing `## [Unreleased]` (create the section if absent).

```markdown
## [Unreleased]

### Added
- CAD Registration stage (Stage 5): best-fit ICP point-to-plane between merged
  cloud and per-`model_type` STL. `merged.ply` and `depth_map.npy` are now
  published in CAD frame; `T_part_to_CAD` is included in the output message
  so downstream services can project CAD-defined ROIs into pixel space
  without re-running ICP.
- `PCP_CAD_DIR` env var (default `/cad/sealer/`) and six runtime settings
  (`sealer_cad_*`) in Redis DB3.
- `depth_map_origin_mm` and `depth_map_resolution_mm` in the output message
  to make pixel<->CAD mapping unambiguous for downstream consumers.

### Changed
- Stitching renumbered from Stage 5 to Stage 6.
- Depth map renumbered from Stage 6 to Stage 7.
- `generate_depth_map` now returns `(array, [x_min_mm, y_min_mm], resolution_mm)`.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(point-cloud): document CAD registration stage and outputs

README pipeline section + CHANGELOG entry under Unreleased/Added."
```

---

## CAD Registration — Effort Estimate

- **Implementation: 2 days** (Tasks 13-21 — fixtures, cad_loader, cad_registration module, settings, env var, runner wiring, output schema, depth-map metadata, integration test)
- **Adjustments + tuning: 1 day** (real-customer STL on bench, threshold calibration against measured drift, performance pass to confirm <500 ms stage budget)
- **Total: 3 days for William, on top of his current `feat/post-review-investigations` work**
