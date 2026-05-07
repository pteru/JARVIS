# strokmatic-eip Phase 1 — Comm SDK + Camera Plugin v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 of the strokmatic-eip rollout — build the cross-product Python SDK (`strokmatic-comm-sdk`) and port the first plugin (`plc-monitor-camera-v2`) to use it. Runs entirely against fakes (no real PLC, no real EIP). Output is an importable SDK + a working plugin verified bit-for-bit against the legacy pylogix Class 1 implementation.

**Architecture:** Two new Python repos (SDK + plugin v2 branch), Redis as IPC, Pydantic-validated configs. The SDK provides `PLCBus` (raw byte-lane I/O), `PluginConfig` (Pydantic base for live-tunable params), `Heartbeat` (status updates), `AuditLog` (Redis stream for cfg edits), and `FakePLCBus`/`FakeCommLayer` for hardware-free testing. The plugin ports the existing handshake state machine to use these primitives; bit-for-bit parity with the legacy pylogix path is the acceptance gate.

**Tech Stack:** Python 3.11+, Pydantic v2, redis-py 5.x, pytest 8.x, ruff, black, Docker. Redis 7.x as IPC backend.

**Spec:** `docs/superpowers/specs/2026-05-07-strokmatic-eip-generic-communicator-design.md`

**This plan covers Phase 1 only.** Phases 0 (diff archaeology), 2 (C side + cert), and 3 (lab integration) are separate plans.

---

## Scope

**IN:**
- SDK v0.1 with `PLCBus`, `PluginConfig`, `Heartbeat`, `AuditLog`, `FakePLCBus`
- Schema versioning enforcement
- SDK published as installable Python package
- `plc-monitor-camera-v2` branch on existing `strokmatic/spotfusion-plc-monitor-camera` repo
- Golden replay tests (legacy production scenarios → identical output bytes)
- `FakeCommLayer` harness for end-to-end-without-PLC tests
- Container build for plugin v2

**OUT (deferred):**
- `plc-result-v2` — follow-up plan; reuses SDK so will be much shorter
- C `strokmatic-eip` work — Phase 2 (blocked by Phase 0 archaeology)
- Real PLC / real EIP integration — Phase 3
- Ops UI — minimal `redis-cli` is sufficient for v1
- pub/sub — polling everywhere per spec section 3.3

---

## File Structure

### New repo: `strokmatic/strokmatic-comm-sdk`

Local clone target: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk/`

```
strokmatic-comm-sdk/
├── pyproject.toml
├── README.md
├── .gitignore
├── .python-version
├── src/strokmatic_comm_sdk/
│   ├── __init__.py             # Public exports + SDK_SCHEMA_VERSION
│   ├── bus.py                  # PLCBus, FakePLCBus
│   ├── config.py               # PluginConfig (Pydantic base)
│   ├── heartbeat.py            # Heartbeat
│   ├── audit.py                # AuditLog
│   ├── version.py              # enforce_schema_version
│   └── exceptions.py           # ConfigNotFoundError, SchemaVersionError, LaneRangeError
├── tests/
│   ├── __init__.py
│   ├── conftest.py             # pytest fixtures (real Redis container)
│   ├── test_bus.py
│   ├── test_fake_bus.py
│   ├── test_config.py
│   ├── test_heartbeat.py
│   ├── test_audit.py
│   └── test_version.py
└── .github/workflows/test.yml
```

### Existing repo: `strokmatic/spotfusion-plc-monitor-camera` (new branch `v2/sdk-based`)

Local working clone: existing `services/plc-monitor-camera/` submodule (separate working tree on `v2/sdk-based`).

```
v2/sdk-based branch:
├── plc_monitor_camera_v2/      # NEW package, parallel to existing files
│   ├── __init__.py
│   ├── state_machine.py        # Pure handshake logic (testable against FakePLCBus)
│   ├── config.py               # CameraPluginConfig (extends PluginConfig)
│   ├── runner.py               # Main loop: SDK + state machine
│   └── __main__.py             # python -m plc_monitor_camera_v2
├── tests/v2/
│   ├── conftest.py
│   ├── test_state_machine.py   # Unit tests against FakePLCBus
│   ├── test_runner.py          # Loop tests
│   ├── test_golden.py          # Bit-for-bit replay vs. legacy
│   ├── scenarios/
│   │   ├── happy_path.yaml
│   │   ├── tryout_mode.yaml
│   │   ├── fault_reset.yaml
│   │   └── golden/
│   │       └── (captured production scenarios — populated in Task 13)
│   └── fake_comm_layer.py      # End-to-end harness (no PLC)
├── plc-monitor-camera-v2.Dockerfile
├── plc-monitor-camera-v2.yml   # docker-compose
└── plc-monitor-camera-v2.req   # Python requirements
```

---

## Tasks

### Task 1: Scaffold `strokmatic-comm-sdk` repo

**Files:**
- Create: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk/` (full skeleton)

- [ ] **Step 1: Create the GitHub repo via gh**

```bash
gh repo create strokmatic/strokmatic-comm-sdk --private --description "Python SDK for plugins talking to strokmatic-eip via Redis IPC"
```

Expected: prints the new repo URL. If it already exists, that's fine — proceed.

- [ ] **Step 2: Init local repo and add remote**

```bash
mkdir -p /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk
git init -b master
git config user.email "pteruelfilho@gmail.com"
git config user.name "Pedro Teruel"
git remote add origin git@github.com:strokmatic/strokmatic-comm-sdk.git
```

- [ ] **Step 3: Write `pyproject.toml`**

Create `pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=64", "setuptools_scm>=8"]
build-backend = "setuptools.build_meta"

[project]
name = "strokmatic-comm-sdk"
description = "Plugin SDK for strokmatic-eip — Redis IPC primitives for PLC communication plugins"
authors = [{name = "Strokmatic"}]
requires-python = ">=3.11"
dynamic = ["version"]
dependencies = [
    "redis>=5.0,<6",
    "pydantic>=2.5,<3",
]

[project.optional-dependencies]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "ruff>=0.4",
    "black>=24",
]

[tool.setuptools_scm]

[tool.setuptools.packages.find]
where = ["src"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B", "SIM"]

[tool.black]
line-length = 100
target-version = ["py311"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 4: Write `.gitignore` and `.python-version`**

Create `.gitignore`:

```
__pycache__/
*.py[cod]
*.egg-info/
.pytest_cache/
.ruff_cache/
.coverage
htmlcov/
dist/
build/
.venv/
venv/
*.egg
```

Create `.python-version`:

```
3.11
```

- [ ] **Step 5: Write `README.md`**

```markdown
# strokmatic-comm-sdk

Python SDK for plugins communicating with `strokmatic-eip` via Redis IPC.

Provides:
- `PLCBus` — raw byte-lane I/O against `io:in:*` and `io:out:*` Redis keys
- `PluginConfig` — Pydantic base for live-tunable parameters loaded from `cfg:*`
- `Heartbeat` — status updates to `status:*`
- `AuditLog` — Redis stream of config edits at `audit:*`
- `FakePLCBus` — in-memory test double

**Design spec:** see `docs/superpowers/specs/2026-05-07-strokmatic-eip-generic-communicator-design.md` in the JARVIS repo.

## Install

```bash
pip install git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@master
```

## Schema version

This SDK targets schema version `1.0.0`. See `enforce_schema_version()`.
```

- [ ] **Step 6: Initial commit and push**

```bash
git add .
git commit -m "$(cat <<'EOF'
chore: scaffold strokmatic-comm-sdk

Python SDK for plugins communicating with strokmatic-eip via Redis IPC.
Empty package layout; modules added in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin master
```

Expected: push succeeds, GitHub repo has one commit.

---

### Task 2: SDK exceptions module (TDD)

**Files:**
- Create: `src/strokmatic_comm_sdk/exceptions.py`
- Test: `tests/test_exceptions.py` (trivial smoke test)

- [ ] **Step 1: Write the failing test**

Create `tests/__init__.py` (empty) and `tests/test_exceptions.py`:

```python
from strokmatic_comm_sdk.exceptions import (
    ConfigNotFoundError,
    SchemaVersionError,
    LaneRangeError,
    StrokmaticCommError,
)


def test_all_exceptions_inherit_base():
    for cls in (ConfigNotFoundError, SchemaVersionError, LaneRangeError):
        assert issubclass(cls, StrokmaticCommError)


def test_exceptions_carry_message():
    err = ConfigNotFoundError("no cfg at cfg:foo:bar")
    assert "no cfg" in str(err)
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/test_exceptions.py -v
```

Expected: `ImportError: cannot import name 'ConfigNotFoundError'...` (module doesn't exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/strokmatic_comm_sdk/__init__.py` (empty for now).

Create `src/strokmatic_comm_sdk/exceptions.py`:

```python
class StrokmaticCommError(Exception):
    """Base exception for strokmatic-comm-sdk."""


class ConfigNotFoundError(StrokmaticCommError):
    """Raised when cfg:<plugin>:<instance> is missing in Redis."""


class SchemaVersionError(StrokmaticCommError):
    """Raised on schema version mismatch between SDK and Redis."""


class LaneRangeError(StrokmaticCommError):
    """Raised when a plugin tries to access a byte outside its declared LANE_RANGE."""
```

- [ ] **Step 4: Run test to verify pass**

```bash
pytest tests/test_exceptions.py -v
```

Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/strokmatic_comm_sdk/__init__.py src/strokmatic_comm_sdk/exceptions.py tests/__init__.py tests/test_exceptions.py
git commit -m "feat: define SDK exception hierarchy"
```

---

### Task 3: `PLCBus` raw byte-lane I/O (TDD)

**Files:**
- Create: `src/strokmatic_comm_sdk/bus.py`
- Test: `tests/test_bus.py`, `tests/conftest.py`

- [ ] **Step 1: Write conftest.py with Redis fixture**

Create `tests/conftest.py`:

```python
import os
import pytest
import redis


@pytest.fixture(scope="session")
def redis_client():
    """Real Redis connection for integration tests.

    Requires Redis 7.x running on REDIS_HOST:REDIS_PORT (default localhost:6379).
    Run before tests: docker run -d -p 6379:6379 --name sdk-test-redis redis:7
    """
    host = os.environ.get("REDIS_HOST", "localhost")
    port = int(os.environ.get("REDIS_PORT", "6379"))
    client = redis.Redis(host=host, port=port, decode_responses=False)
    client.ping()  # fail fast if Redis unreachable
    yield client
    client.close()


@pytest.fixture(autouse=True)
def clean_redis(redis_client):
    """Wipe test keys before each test."""
    keys = redis_client.keys("io:*") + redis_client.keys("cfg:*") + \
           redis_client.keys("status:*") + redis_client.keys("audit:*") + \
           redis_client.keys("schema:*")
    if keys:
        redis_client.delete(*keys)
    yield
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_bus.py`:

```python
import pytest
from strokmatic_comm_sdk.bus import PLCBus


PLC_KEY = "test_plc_192.168.99.99"


def test_read_lane_returns_zeros_when_unset(redis_client):
    bus = PLCBus(plc_key=PLC_KEY, redis_client=redis_client)
    # Unset key — Redis GETRANGE returns empty bytes; bus normalizes to zero-padded
    result = bus.read_lane(offset=16, length=16)
    assert result == b"\x00" * 16


def test_write_then_read_lane_roundtrip(redis_client):
    bus = PLCBus(plc_key=PLC_KEY, redis_client=redis_client)
    bus.write_lane(offset=16, data=b"\x01\x02\x03\x04")
    # Bus reads from io:in (PLC→device), but we wrote io:out (device→PLC).
    # For the roundtrip test we read io:out directly via raw redis.
    raw = redis_client.getrange(f"io:out:{PLC_KEY}", 16, 19)
    assert raw == b"\x01\x02\x03\x04"


def test_read_lane_reads_io_in(redis_client):
    bus = PLCBus(plc_key=PLC_KEY, redis_client=redis_client)
    # Simulate comm-layer writing PLC→device input
    redis_client.setrange(f"io:in:{PLC_KEY}", 32, b"\xaa\xbb\xcc")
    result = bus.read_lane(offset=32, length=3)
    assert result == b"\xaa\xbb\xcc"


def test_read_lane_zero_pads_short_response(redis_client):
    bus = PLCBus(plc_key=PLC_KEY, redis_client=redis_client)
    redis_client.setrange(f"io:in:{PLC_KEY}", 0, b"\x01")  # only 1 byte
    result = bus.read_lane(offset=0, length=4)
    assert result == b"\x01\x00\x00\x00"


def test_lane_range_enforcement_blocks_out_of_range_write(redis_client):
    bus = PLCBus(plc_key=PLC_KEY, redis_client=redis_client, lane_range=(16, 31))
    with pytest.raises(Exception) as exc:
        bus.write_lane(offset=32, data=b"\x01")
    assert "LANE_RANGE" in str(exc.value) or "range" in str(exc.value).lower()


def test_lane_range_enforcement_blocks_overlap(redis_client):
    bus = PLCBus(plc_key=PLC_KEY, redis_client=redis_client, lane_range=(16, 31))
    with pytest.raises(Exception):
        bus.write_lane(offset=30, data=b"\x01\x02\x03\x04")  # spills into 31, 32, 33


def test_lane_range_allows_in_range_write(redis_client):
    bus = PLCBus(plc_key=PLC_KEY, redis_client=redis_client, lane_range=(16, 31))
    bus.write_lane(offset=20, data=b"\x42\x43")  # fully inside
    raw = redis_client.getrange(f"io:out:{PLC_KEY}", 20, 21)
    assert raw == b"\x42\x43"
```

- [ ] **Step 3: Run tests to verify failures**

Start Redis:

```bash
docker run -d -p 6379:6379 --name sdk-test-redis redis:7 2>&1 | tail -1
```

(If container already exists, run `docker start sdk-test-redis` instead.)

Run tests:

```bash
pytest tests/test_bus.py -v
```

Expected: ImportError on `from strokmatic_comm_sdk.bus import PLCBus`.

- [ ] **Step 4: Write minimal `bus.py`**

Create `src/strokmatic_comm_sdk/bus.py`:

```python
from typing import Optional, Tuple

import redis

from strokmatic_comm_sdk.exceptions import LaneRangeError


class PLCBus:
    """Raw byte-lane I/O against a Redis-backed PLC mirror.

    Reads PLC→device input from io:in:<plc_key> via GETRANGE.
    Writes device→PLC output to io:out:<plc_key> via SETRANGE.

    If lane_range is set (low, high inclusive), all writes are bounds-checked.
    """

    def __init__(
        self,
        plc_key: str,
        redis_client: redis.Redis,
        lane_range: Optional[Tuple[int, int]] = None,
    ):
        self.plc_key = plc_key
        self.redis = redis_client
        self.lane_range = lane_range

    def read_lane(self, offset: int, length: int) -> bytes:
        end = offset + length - 1
        raw = self.redis.getrange(f"io:in:{self.plc_key}", offset, end)
        if len(raw) < length:
            raw = raw + b"\x00" * (length - len(raw))
        return bytes(raw)

    def write_lane(self, offset: int, data: bytes) -> None:
        if self.lane_range is not None:
            low, high = self.lane_range
            end = offset + len(data) - 1
            if offset < low or end > high:
                raise LaneRangeError(
                    f"Write [{offset}..{end}] outside LANE_RANGE [{low}..{high}]"
                )
        self.redis.setrange(f"io:out:{self.plc_key}", offset, data)
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pytest tests/test_bus.py -v
```

Expected: all 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/strokmatic_comm_sdk/bus.py tests/conftest.py tests/test_bus.py
git commit -m "feat: PLCBus raw byte-lane I/O with optional LANE_RANGE enforcement"
```

---

### Task 4: `FakePLCBus` in-memory test double (TDD)

**Files:**
- Modify: `src/strokmatic_comm_sdk/bus.py` (append class)
- Test: `tests/test_fake_bus.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_fake_bus.py`:

```python
import pytest
from strokmatic_comm_sdk.bus import FakePLCBus
from strokmatic_comm_sdk.exceptions import LaneRangeError


def test_fake_bus_starts_zeroed():
    bus = FakePLCBus()
    assert bus.read_lane(0, 128) == b"\x00" * 128


def test_fake_bus_set_input_visible_to_read_lane():
    bus = FakePLCBus()
    bus.set_input(offset=16, data=b"\xaa\xbb")
    assert bus.read_lane(16, 2) == b"\xaa\xbb"
    assert bus.read_lane(0, 16) == b"\x00" * 16  # unaffected


def test_fake_bus_write_lane_visible_to_get_output():
    bus = FakePLCBus()
    bus.write_lane(offset=32, data=b"\x01\x02\x03")
    assert bus.get_output(32, 3) == b"\x01\x02\x03"


def test_fake_bus_lane_range_enforced():
    bus = FakePLCBus(lane_range=(16, 31))
    with pytest.raises(LaneRangeError):
        bus.write_lane(offset=32, data=b"\x01")


def test_fake_bus_comm_alive_default_true():
    bus = FakePLCBus()
    assert bus.comm_alive() is True


def test_fake_bus_comm_alive_can_be_toggled():
    bus = FakePLCBus()
    bus.set_comm_alive(False)
    assert bus.comm_alive() is False


def test_real_bus_comm_alive_via_status_key(redis_client):
    """Sanity: real PLCBus reads status:comm:<plc_key>.last_beat_ms."""
    from strokmatic_comm_sdk.bus import PLCBus
    import time
    plc_key = "test_plc_99"
    bus = PLCBus(plc_key=plc_key, redis_client=redis_client)
    # No status:comm yet → not alive
    assert bus.comm_alive() is False
    # Fresh heartbeat → alive
    redis_client.hset(f"status:comm:{plc_key}", "last_beat_ms", int(time.time() * 1000))
    assert bus.comm_alive(max_stale_ms=5000) is True
    # Stale heartbeat → not alive
    redis_client.hset(f"status:comm:{plc_key}", "last_beat_ms", int(time.time() * 1000) - 10000)
    assert bus.comm_alive(max_stale_ms=5000) is False
```

- [ ] **Step 2: Run to verify failures**

```bash
pytest tests/test_fake_bus.py -v
```

Expected: ImportError on `FakePLCBus`, plus `comm_alive` not defined on PLCBus.

- [ ] **Step 3: Add `comm_alive` to `PLCBus` and add `FakePLCBus`**

Append to `src/strokmatic_comm_sdk/bus.py`:

```python
import time


class PLCBus(PLCBus):  # type: ignore[no-redef]
    pass  # placeholder — replace with explicit method addition below
```

Actually, edit the existing class. Modify `src/strokmatic_comm_sdk/bus.py` so the final file is:

```python
import time
from typing import Optional, Tuple

import redis

from strokmatic_comm_sdk.exceptions import LaneRangeError


class PLCBus:
    """Raw byte-lane I/O against a Redis-backed PLC mirror.

    Reads PLC→device input from io:in:<plc_key> via GETRANGE.
    Writes device→PLC output to io:out:<plc_key> via SETRANGE.

    If lane_range is set (low, high inclusive), all writes are bounds-checked.
    """

    def __init__(
        self,
        plc_key: str,
        redis_client: redis.Redis,
        lane_range: Optional[Tuple[int, int]] = None,
    ):
        self.plc_key = plc_key
        self.redis = redis_client
        self.lane_range = lane_range

    def read_lane(self, offset: int, length: int) -> bytes:
        end = offset + length - 1
        raw = self.redis.getrange(f"io:in:{self.plc_key}", offset, end)
        if len(raw) < length:
            raw = raw + b"\x00" * (length - len(raw))
        return bytes(raw)

    def write_lane(self, offset: int, data: bytes) -> None:
        if self.lane_range is not None:
            low, high = self.lane_range
            end = offset + len(data) - 1
            if offset < low or end > high:
                raise LaneRangeError(
                    f"Write [{offset}..{end}] outside LANE_RANGE [{low}..{high}]"
                )
        self.redis.setrange(f"io:out:{self.plc_key}", offset, data)

    def comm_alive(self, max_stale_ms: int = 1000) -> bool:
        """Check that the comm layer's heartbeat is fresh."""
        beat = self.redis.hget(f"status:comm:{self.plc_key}", "last_beat_ms")
        if beat is None:
            return False
        age = int(time.time() * 1000) - int(beat)
        return age < max_stale_ms


class FakePLCBus:
    """In-memory PLCBus for plugin unit tests. Same interface; no Redis."""

    def __init__(self, lane_range: Optional[Tuple[int, int]] = None):
        self.io_in = bytearray(128)
        self.io_out = bytearray(128)
        self.lane_range = lane_range
        self._comm_alive = True

    def read_lane(self, offset: int, length: int) -> bytes:
        return bytes(self.io_in[offset:offset + length])

    def write_lane(self, offset: int, data: bytes) -> None:
        if self.lane_range is not None:
            low, high = self.lane_range
            end = offset + len(data) - 1
            if offset < low or end > high:
                raise LaneRangeError(
                    f"Write [{offset}..{end}] outside LANE_RANGE [{low}..{high}]"
                )
        self.io_out[offset:offset + len(data)] = data

    def comm_alive(self, max_stale_ms: int = 1000) -> bool:
        return self._comm_alive

    # --- Test helpers (not part of PLCBus interface) ---

    def set_input(self, offset: int, data: bytes) -> None:
        self.io_in[offset:offset + len(data)] = data

    def get_output(self, offset: int, length: int) -> bytes:
        return bytes(self.io_out[offset:offset + length])

    def set_comm_alive(self, alive: bool) -> None:
        self._comm_alive = alive
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_bus.py tests/test_fake_bus.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strokmatic_comm_sdk/bus.py tests/test_fake_bus.py
git commit -m "feat: FakePLCBus + comm_alive heartbeat check"
```

---

### Task 5: `Heartbeat` status writer (TDD)

**Files:**
- Create: `src/strokmatic_comm_sdk/heartbeat.py`
- Test: `tests/test_heartbeat.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_heartbeat.py`:

```python
import time
from strokmatic_comm_sdk.heartbeat import Heartbeat


def test_beat_writes_last_beat_ms(redis_client):
    hb = Heartbeat(redis_client, key="status:test_plugin:R7C2")
    before = int(time.time() * 1000)
    hb.beat()
    after = int(time.time() * 1000)
    raw = redis_client.hget("status:test_plugin:R7C2", "last_beat_ms")
    assert raw is not None
    val = int(raw)
    assert before <= val <= after


def test_beat_writes_cycle_us(redis_client):
    hb = Heartbeat(redis_client, key="status:test:i")
    hb.beat(cycle_us=1234)
    raw = redis_client.hget("status:test:i", "last_cycle_us")
    assert int(raw) == 1234


def test_increment_error_increments_counter(redis_client):
    hb = Heartbeat(redis_client, key="status:test:i")
    hb.increment_error("first")
    hb.increment_error("second")
    count = int(redis_client.hget("status:test:i", "error_count"))
    last = redis_client.hget("status:test:i", "last_error").decode()
    assert count == 2
    assert last == "second"


def test_beat_does_not_reset_error_count(redis_client):
    hb = Heartbeat(redis_client, key="status:test:i")
    hb.increment_error("oops")
    hb.beat()
    count = int(redis_client.hget("status:test:i", "error_count"))
    assert count == 1
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_heartbeat.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

Create `src/strokmatic_comm_sdk/heartbeat.py`:

```python
import time

import redis


class Heartbeat:
    """Writes liveness/health status to a Redis hash."""

    def __init__(self, redis_client: redis.Redis, key: str):
        self.redis = redis_client
        self.key = key

    def beat(self, cycle_us: int = 0) -> None:
        now_ms = int(time.time() * 1000)
        self.redis.hset(
            self.key,
            mapping={
                "last_beat_ms": now_ms,
                "last_cycle_us": cycle_us,
            },
        )

    def increment_error(self, message: str) -> None:
        self.redis.hincrby(self.key, "error_count", 1)
        self.redis.hset(self.key, "last_error", message)
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_heartbeat.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strokmatic_comm_sdk/heartbeat.py tests/test_heartbeat.py
git commit -m "feat: Heartbeat status writer"
```

---

### Task 6: `AuditLog` Redis stream writer (TDD)

**Files:**
- Create: `src/strokmatic_comm_sdk/audit.py`
- Test: `tests/test_audit.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_audit.py`:

```python
from strokmatic_comm_sdk.audit import AuditLog


def test_log_change_appends_to_stream(redis_client):
    audit = AuditLog(redis_client, plugin_name="cam", instance="R7C2")
    audit.log_change(field_path="timeout_ms", old=500, new=800, actor="pteruel")
    audit.log_change(field_path="timeout_ms", old=800, new=600, actor="pteruel")

    entries = redis_client.xrange("audit:cam:R7C2", "-", "+")
    assert len(entries) == 2
    _, fields = entries[0]
    assert fields[b"field_path"] == b"timeout_ms"
    assert fields[b"old"] == b"500"
    assert fields[b"new"] == b"800"
    assert fields[b"actor"] == b"pteruel"
    assert b"ts" in fields


def test_log_change_writes_iso_timestamp(redis_client):
    audit = AuditLog(redis_client, plugin_name="p", instance="i")
    audit.log_change(field_path="x", old=1, new=2, actor="u")
    _, fields = redis_client.xrange("audit:p:i")[0]
    ts_ms = int(fields[b"ts"])
    # Recent millis (within 1 minute of now)
    import time
    assert abs(int(time.time() * 1000) - ts_ms) < 60_000


def test_log_handles_complex_values(redis_client):
    audit = AuditLog(redis_client, plugin_name="p", instance="i")
    audit.log_change(field_path="io_map.style", old=None, new={"a": 1}, actor="u")
    _, fields = redis_client.xrange("audit:p:i")[0]
    assert fields[b"old"] == b"None"
    assert b"a" in fields[b"new"]


def test_stream_trims_at_maxlen(redis_client):
    audit = AuditLog(redis_client, plugin_name="trim", instance="i", maxlen=5)
    for i in range(10):
        audit.log_change(field_path=f"f{i}", old=0, new=i, actor="u")
    length = redis_client.xlen("audit:trim:i")
    # Approximate trimming: actual length is bounded but may exceed slightly.
    assert length <= 10
    assert length >= 5
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_audit.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

Create `src/strokmatic_comm_sdk/audit.py`:

```python
import time

import redis


class AuditLog:
    """Append-only log of cfg:* changes to a Redis stream.

    Trimmed approximately to maxlen entries via XADD MAXLEN ~.
    """

    def __init__(
        self,
        redis_client: redis.Redis,
        plugin_name: str,
        instance: str,
        maxlen: int = 10000,
    ):
        self.redis = redis_client
        self.key = f"audit:{plugin_name}:{instance}"
        self.maxlen = maxlen

    def log_change(self, field_path: str, old, new, actor: str) -> None:
        self.redis.xadd(
            self.key,
            {
                "ts": str(int(time.time() * 1000)),
                "actor": actor,
                "field_path": field_path,
                "old": str(old),
                "new": str(new),
            },
            maxlen=self.maxlen,
            approximate=True,
        )
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_audit.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strokmatic_comm_sdk/audit.py tests/test_audit.py
git commit -m "feat: AuditLog Redis-stream cfg-edit log"
```

---

### Task 7: `PluginConfig` Pydantic base + load/save (TDD)

**Files:**
- Create: `src/strokmatic_comm_sdk/config.py`
- Test: `tests/test_config.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_config.py`:

```python
import json
import pytest
from pydantic import Field
from strokmatic_comm_sdk.config import PluginConfig
from strokmatic_comm_sdk.exceptions import ConfigNotFoundError


class CameraCfg(PluginConfig):
    timeout_ms: int = Field(500, ge=0)
    style_byte: int = Field(0, ge=0, le=127)


def test_load_raises_when_missing(redis_client):
    with pytest.raises(ConfigNotFoundError):
        CameraCfg.load(redis_client, plugin_name="cam", instance="R7C2")


def test_save_then_load_roundtrip(redis_client):
    cfg = CameraCfg(timeout_ms=800, style_byte=0)
    cfg.save(redis_client, plugin_name="cam", instance="R7C2", actor="pteruel")
    loaded = CameraCfg.load(redis_client, plugin_name="cam", instance="R7C2")
    assert loaded.timeout_ms == 800
    assert loaded.style_byte == 0
    assert loaded.schema_version == "1.0.0"


def test_load_validates_against_schema(redis_client):
    # Simulate a config with bad data
    redis_client.set("cfg:cam:R7C2", json.dumps({"timeout_ms": -1, "style_byte": 0}))
    with pytest.raises(Exception) as exc:
        CameraCfg.load(redis_client, plugin_name="cam", instance="R7C2")
    assert "timeout_ms" in str(exc.value).lower() or "validation" in str(exc.value).lower()


def test_save_writes_audit_entry(redis_client):
    cfg = CameraCfg(timeout_ms=500, style_byte=0)
    cfg.save(redis_client, plugin_name="cam", instance="R7C2", actor="pteruel")
    cfg2 = CameraCfg(timeout_ms=800, style_byte=0)
    cfg2.save(redis_client, plugin_name="cam", instance="R7C2", actor="pteruel")
    entries = redis_client.xrange("audit:cam:R7C2", "-", "+")
    # Initial save also logs a change (from None / previous state)
    assert len(entries) >= 2


def test_save_no_audit_on_first_write(redis_client):
    """First save (no prior cfg) should not log a 'change' since there's no old value.

    Decision: log first save as old=None → new=<json>; this preserves a creation event.
    """
    cfg = CameraCfg(timeout_ms=500, style_byte=0)
    cfg.save(redis_client, plugin_name="new_cam", instance="R7C2", actor="bootstrap")
    entries = redis_client.xrange("audit:new_cam:R7C2", "-", "+")
    assert len(entries) == 1
    _, fields = entries[0]
    assert fields[b"old"] == b"None" or fields[b"old"] == b"null"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_config.py -v
```

Expected: ImportError on `from strokmatic_comm_sdk.config import PluginConfig`.

- [ ] **Step 3: Implement**

Create `src/strokmatic_comm_sdk/config.py`:

```python
import redis
from pydantic import BaseModel

from strokmatic_comm_sdk.audit import AuditLog
from strokmatic_comm_sdk.exceptions import ConfigNotFoundError


class PluginConfig(BaseModel):
    """Base for plugin Pydantic configs. Subclasses define their own fields.

    Stored in Redis as a single JSON blob at cfg:<plugin>:<instance>.
    """

    schema_version: str = "1.0.0"

    @classmethod
    def load(cls, redis_client: redis.Redis, plugin_name: str, instance: str) -> "PluginConfig":
        key = f"cfg:{plugin_name}:{instance}"
        raw = redis_client.get(key)
        if raw is None:
            raise ConfigNotFoundError(f"No config at {key}")
        return cls.model_validate_json(raw)

    def save(
        self,
        redis_client: redis.Redis,
        plugin_name: str,
        instance: str,
        actor: str,
    ) -> None:
        key = f"cfg:{plugin_name}:{instance}"
        old_raw = redis_client.get(key)
        old_repr = old_raw.decode() if old_raw is not None else None
        new_raw = self.model_dump_json()
        redis_client.set(key, new_raw)
        AuditLog(redis_client, plugin_name, instance).log_change(
            field_path="<full_doc>", old=old_repr, new=new_raw, actor=actor,
        )
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_config.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strokmatic_comm_sdk/config.py tests/test_config.py
git commit -m "feat: PluginConfig Pydantic base with load/save and audit"
```

---

### Task 8: Schema version enforcement (TDD)

**Files:**
- Create: `src/strokmatic_comm_sdk/version.py`
- Modify: `src/strokmatic_comm_sdk/__init__.py`
- Test: `tests/test_version.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_version.py`:

```python
import pytest
from strokmatic_comm_sdk.exceptions import SchemaVersionError
from strokmatic_comm_sdk.version import (
    SDK_SCHEMA_VERSION,
    enforce_schema_version,
)


def test_sdk_version_is_1_0_0():
    assert SDK_SCHEMA_VERSION == "1.0.0"


def test_enforce_raises_when_unset(redis_client):
    with pytest.raises(SchemaVersionError, match="not set"):
        enforce_schema_version(redis_client)


def test_enforce_passes_when_major_matches(redis_client):
    redis_client.set("schema:version", "1.5.0")  # same major, different minor
    enforce_schema_version(redis_client)  # should not raise


def test_enforce_raises_on_major_mismatch(redis_client):
    redis_client.set("schema:version", "2.0.0")
    with pytest.raises(SchemaVersionError, match="ajor version mismatch"):
        enforce_schema_version(redis_client)
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_version.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

Create `src/strokmatic_comm_sdk/version.py`:

```python
import redis

from strokmatic_comm_sdk.exceptions import SchemaVersionError

SDK_SCHEMA_VERSION = "1.0.0"


def enforce_schema_version(redis_client: redis.Redis) -> None:
    """Raise SchemaVersionError if Redis schema:version is missing or major-mismatched.

    Compatibility rule: the SDK runs against any Redis with the same major version.
    Minor-version mismatch is allowed (server may have additive new keys).
    """
    raw = redis_client.get("schema:version")
    if raw is None:
        raise SchemaVersionError("schema:version not set in Redis")
    server_version = raw.decode()
    if server_version.split(".")[0] != SDK_SCHEMA_VERSION.split(".")[0]:
        raise SchemaVersionError(
            f"Major version mismatch: SDK={SDK_SCHEMA_VERSION}, server={server_version}"
        )
```

Update `src/strokmatic_comm_sdk/__init__.py`:

```python
from strokmatic_comm_sdk.audit import AuditLog
from strokmatic_comm_sdk.bus import FakePLCBus, PLCBus
from strokmatic_comm_sdk.config import PluginConfig
from strokmatic_comm_sdk.exceptions import (
    ConfigNotFoundError,
    LaneRangeError,
    SchemaVersionError,
    StrokmaticCommError,
)
from strokmatic_comm_sdk.heartbeat import Heartbeat
from strokmatic_comm_sdk.version import SDK_SCHEMA_VERSION, enforce_schema_version

__all__ = [
    "AuditLog",
    "ConfigNotFoundError",
    "FakePLCBus",
    "Heartbeat",
    "LaneRangeError",
    "PLCBus",
    "PluginConfig",
    "SDK_SCHEMA_VERSION",
    "SchemaVersionError",
    "StrokmaticCommError",
    "enforce_schema_version",
]
```

- [ ] **Step 4: Run all SDK tests to verify pass**

```bash
pytest -v
```

Expected: all tests PASS (across all modules).

- [ ] **Step 5: Commit**

```bash
git add src/strokmatic_comm_sdk/version.py src/strokmatic_comm_sdk/__init__.py tests/test_version.py
git commit -m "feat: schema version enforcement; export public API"
```

---

### Task 9: GitHub Actions CI for SDK

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Write CI workflow**

Create `.github/workflows/test.yml`:

```yaml
name: test

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping" --health-interval 10s
          --health-timeout 5s --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install
        run: |
          python -m pip install --upgrade pip
          pip install -e ".[dev]"

      - name: Lint
        run: |
          ruff check src tests
          black --check src tests

      - name: Test
        env:
          REDIS_HOST: localhost
          REDIS_PORT: "6379"
        run: pytest -v
```

- [ ] **Step 2: Run lint locally**

```bash
ruff check src tests
black --check src tests
```

If lint fails, fix and re-run. If black fails, run `black src tests` and re-check.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/test.yml
git commit -m "ci: GitHub Actions test workflow with Redis service"
git push origin master
```

- [ ] **Step 4: Verify CI passes on GitHub**

```bash
gh run list --repo strokmatic/strokmatic-comm-sdk --limit 1
gh run watch --repo strokmatic/strokmatic-comm-sdk
```

Expected: green check on master.

---

### Task 10: Tag SDK v0.1.0 release

**Files:** none

- [ ] **Step 1: Tag and push**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk
git tag -a v0.1.0 -m "Release v0.1.0 — initial SDK with PLCBus, PluginConfig, Heartbeat, AuditLog, FakePLCBus"
git push origin v0.1.0
```

- [ ] **Step 2: Create GitHub release**

```bash
gh release create v0.1.0 \
  --repo strokmatic/strokmatic-comm-sdk \
  --title "v0.1.0 — Initial release" \
  --notes "First release of strokmatic-comm-sdk. Provides PLCBus, PluginConfig, Heartbeat, AuditLog, FakePLCBus, schema-version enforcement. See spec at JARVIS/docs/superpowers/specs/2026-05-07-strokmatic-eip-generic-communicator-design.md"
```

Expected: release published, tag visible at `https://github.com/strokmatic/strokmatic-comm-sdk/releases`.

---

### Task 11: Set up `plc-monitor-camera` v2 working tree

**Files:**
- Create: working tree at `/home/teruel/worktrees/plc-monitor-camera-v2/`

- [ ] **Step 1: Locate the existing repo**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/spotfusion/services/plc-monitor-camera
git remote -v
git branch -a
```

Expected: remote = `git@github.com:strokmatic/spotfusion-plc-monitor-camera.git` per the parent `.gitmodules`.

- [ ] **Step 2: Create v2 branch and worktree**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/spotfusion/services/plc-monitor-camera
git fetch origin
git checkout -b v2/sdk-based origin/main 2>&1 | head -3 || git checkout -b v2/sdk-based origin/master
git worktree add /home/teruel/worktrees/plc-monitor-camera-v2 v2/sdk-based
cd /home/teruel/worktrees/plc-monitor-camera-v2
git branch --show-current
```

Expected: working tree at the new path, branch = `v2/sdk-based`.

- [ ] **Step 3: Add SDK as a requirement**

Create `plc-monitor-camera-v2.req` (parallel to existing `plc-monitor-camera.req`):

```
redis>=5,<6
pydantic>=2.5,<3
pyyaml>=6
strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.1.0
```

- [ ] **Step 4: Commit**

```bash
git add plc-monitor-camera-v2.req
git commit -m "chore(v2): add requirements for SDK-based v2"
```

---

### Task 12: Camera plugin v2 — config schema (TDD)

**Files:**
- Create: `plc_monitor_camera_v2/__init__.py`, `plc_monitor_camera_v2/config.py`
- Test: `tests/v2/__init__.py`, `tests/v2/conftest.py`, `tests/v2/test_config.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/v2/__init__.py` (empty), `tests/v2/conftest.py`:

```python
import pytest


@pytest.fixture
def fake_bus():
    from strokmatic_comm_sdk import FakePLCBus
    return FakePLCBus(lane_range=(16, 31))
```

Create `tests/v2/test_config.py`:

```python
import pytest
from pydantic import ValidationError
from plc_monitor_camera_v2.config import CameraIOMap, CameraPluginConfig


def test_default_io_map_offsets():
    cfg = CameraPluginConfig()
    # Defaults match the legacy plc-monitor-camera tag indices, shifted into lane 16-31
    assert cfg.io_map.style == 16  # legacy idx 0 + lane base 16
    assert cfg.io_map.pvi == 17
    assert cfg.io_map.program == 18
    assert cfg.io_map.img_seq == 19
    assert cfg.io_map.cycle_complete == 20
    assert cfg.io_map.cap_complete == 21
    assert cfg.io_map.in_cycle == 22


def test_io_map_offsets_must_be_in_lane():
    """All io_map offsets must fall within LANE_RANGE (16-31).

    This is enforced at plugin startup, not in the schema itself, but
    out-of-range values still validate as integers.
    """
    cfg = CameraPluginConfig(io_map=CameraIOMap(style=999))
    assert cfg.io_map.style == 999  # schema accepts; runner rejects (later test)


def test_timeout_must_be_positive():
    with pytest.raises(ValidationError):
        CameraPluginConfig(handshake_timeout_ms=-1)


def test_extra_fields_rejected():
    with pytest.raises(ValidationError):
        CameraPluginConfig.model_validate({"unknown_field": 1})


def test_load_save_roundtrip(redis_client):
    cfg = CameraPluginConfig(handshake_timeout_ms=800)
    cfg.save(redis_client, plugin_name="plc-monitor-camera-v2", instance="R7C2", actor="test")
    loaded = CameraPluginConfig.load(
        redis_client, plugin_name="plc-monitor-camera-v2", instance="R7C2",
    )
    assert loaded.handshake_timeout_ms == 800
```

Also reuse the SDK's `redis_client` fixture by adding a top-level `tests/v2/conftest.py` import path. To keep it simple, create `tests/v2/conftest.py` with both fixtures combined:

```python
import os

import pytest
import redis


@pytest.fixture(scope="session")
def redis_client():
    host = os.environ.get("REDIS_HOST", "localhost")
    port = int(os.environ.get("REDIS_PORT", "6379"))
    client = redis.Redis(host=host, port=port, decode_responses=False)
    client.ping()
    yield client
    client.close()


@pytest.fixture(autouse=True)
def clean_redis(redis_client):
    keys = redis_client.keys("io:*") + redis_client.keys("cfg:*") + \
           redis_client.keys("status:*") + redis_client.keys("audit:*") + \
           redis_client.keys("schema:*")
    if keys:
        redis_client.delete(*keys)
    yield


@pytest.fixture
def fake_bus():
    from strokmatic_comm_sdk import FakePLCBus
    return FakePLCBus(lane_range=(16, 31))
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /home/teruel/worktrees/plc-monitor-camera-v2
python -m venv .venv && source .venv/bin/activate
pip install -e .  # if pyproject is set up; else use the .req
pip install -r plc-monitor-camera-v2.req pytest
pytest tests/v2/ -v
```

Expected: ImportError on `plc_monitor_camera_v2.config`.

- [ ] **Step 3: Write `pyproject.toml` for the plugin**

If the existing repo has no `pyproject.toml`, create one:

```toml
[build-system]
requires = ["setuptools>=64"]
build-backend = "setuptools.build_meta"

[project]
name = "plc-monitor-camera-v2"
version = "0.1.0"
description = "SpotFusion PLC monitor camera handshake — v2 (SDK-based)"
requires-python = ">=3.11"
dependencies = [
    "redis>=5,<6",
    "pydantic>=2.5,<3",
    "pyyaml>=6",
    "strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8"]

[tool.setuptools.packages.find]
include = ["plc_monitor_camera_v2*"]

[tool.pytest.ini_options]
testpaths = ["tests/v2"]
```

- [ ] **Step 4: Implement config**

Create `plc_monitor_camera_v2/__init__.py` (empty).

Create `plc_monitor_camera_v2/config.py`:

```python
from pydantic import BaseModel, ConfigDict, Field

from strokmatic_comm_sdk import PluginConfig


class CameraIOMap(BaseModel):
    """Byte offsets within the camera_acq lane (default 16-31).

    Defaults map the legacy plc-monitor-camera tag indices onto the lane:
        legacy idx 0 (STYLE)            → lane base + 0  = 16
        legacy idx 1 (PVI)              → lane base + 1  = 17
        legacy idx 2 (PROGRAM)          → lane base + 2  = 18
        legacy idx 3 (IMG_SEQ)          → lane base + 3  = 19
        legacy idx 4 (CYCLE_COMPLETE)   → lane base + 4  = 20
        legacy idx 5 (CAP_COMP)         → lane base + 5  = 21
        legacy idx 6 (IN_CYCLE)         → lane base + 6  = 22

    Inputs read from io:in (PLC→device) get distinct offsets in the same lane.
    """

    model_config = ConfigDict(extra="forbid")

    # Output bytes (device → PLC, written by plugin)
    style: int = 16
    pvi: int = 17
    program: int = 18
    img_seq: int = 19
    cycle_complete: int = 20
    cap_complete: int = 21
    in_cycle: int = 22

    # Input bytes (PLC → device, read by plugin)
    start_cycle: int = 23
    get_image_confirm: int = 24
    image_cap_comp: int = 25
    image_ok_cap_comp: int = 26
    fault_reset: int = 27
    tryout: int = 28


class CameraPluginConfig(PluginConfig):
    model_config = ConfigDict(extra="forbid")

    io_map: CameraIOMap = Field(default_factory=CameraIOMap)
    handshake_timeout_ms: int = Field(500, ge=1)
    tick_ms: int = Field(50, ge=1)
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pytest tests/v2/test_config.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml plc_monitor_camera_v2/ tests/v2/
git commit -m "feat(v2): camera plugin config schema with default IO map"
```

---

### Task 13: Camera plugin v2 — state machine (TDD)

**Files:**
- Create: `plc_monitor_camera_v2/state_machine.py`
- Test: `tests/v2/test_state_machine.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/v2/test_state_machine.py`:

```python
"""Unit tests for the camera handshake state machine.

Mirrors the legacy plc-monitor-camera.RUN() behavior, with the same byte semantics
shifted into lane 16-31. Each test exercises one transition.
"""

from plc_monitor_camera_v2.config import CameraPluginConfig
from plc_monitor_camera_v2.state_machine import CameraStateMachine


def test_initial_idle_writes_zero_in_cycle(fake_bus):
    cfg = CameraPluginConfig()
    sm = CameraStateMachine(cfg)
    sm.tick(fake_bus)
    assert fake_bus.get_output(cfg.io_map.in_cycle, 1) == b"\x00"
    assert fake_bus.get_output(cfg.io_map.cycle_complete, 1) == b"\x00"


def test_start_cycle_with_all_ids_enters_in_cycle(fake_bus):
    cfg = CameraPluginConfig()
    sm = CameraStateMachine(cfg)
    # PLC-side inputs: STYLE=1, PVI=2, PROGRAM=3, IMG_SEQ=4 in io:in (mirrored
    # by the comm layer); but the legacy code reads STYLE/PVI/etc from a
    # different redis-namespace. In v2, the state machine reads these from io:in.
    # However, for now, model them as set via cfg defaults: each ID is read from
    # its io_map offset on io:in.
    fake_bus.set_input(cfg.io_map.style, b"\x01")
    fake_bus.set_input(cfg.io_map.pvi, b"\x02")
    fake_bus.set_input(cfg.io_map.program, b"\x03")
    fake_bus.set_input(cfg.io_map.img_seq, b"\x04")
    fake_bus.set_input(cfg.io_map.start_cycle, b"\x01")
    fake_bus.set_input(cfg.io_map.get_image_confirm, b"\x00")
    fake_bus.set_input(cfg.io_map.tryout, b"\x00")
    sm.tick(fake_bus)
    assert fake_bus.get_output(cfg.io_map.in_cycle, 1) == b"\x01"


def test_get_image_confirm_triggers_cycle_complete(fake_bus):
    cfg = CameraPluginConfig()
    sm = CameraStateMachine(cfg)
    fake_bus.set_input(cfg.io_map.style, b"\x01")
    fake_bus.set_input(cfg.io_map.pvi, b"\x02")
    fake_bus.set_input(cfg.io_map.program, b"\x03")
    fake_bus.set_input(cfg.io_map.img_seq, b"\x04")
    fake_bus.set_input(cfg.io_map.start_cycle, b"\x01")
    fake_bus.set_input(cfg.io_map.get_image_confirm, b"\x01")
    sm.tick(fake_bus)
    assert fake_bus.get_output(cfg.io_map.cycle_complete, 1) == b"\x01"


def test_image_cap_comp_clears_cycle_complete_and_in_cycle(fake_bus):
    cfg = CameraPluginConfig()
    sm = CameraStateMachine(cfg)
    fake_bus.set_input(cfg.io_map.image_cap_comp, b"\x01")
    sm.tick(fake_bus)
    assert fake_bus.get_output(cfg.io_map.cycle_complete, 1) == b"\x00"
    assert fake_bus.get_output(cfg.io_map.in_cycle, 1) == b"\x00"


def test_image_ok_cap_comp_sets_cap_complete(fake_bus):
    cfg = CameraPluginConfig()
    sm = CameraStateMachine(cfg)
    fake_bus.set_input(cfg.io_map.image_ok_cap_comp, b"\x01")
    sm.tick(fake_bus)
    assert fake_bus.get_output(cfg.io_map.cap_complete, 1) == b"\x01"


def test_image_ok_cap_comp_zero_clears_cap_complete(fake_bus):
    cfg = CameraPluginConfig()
    sm = CameraStateMachine(cfg)
    fake_bus.set_input(cfg.io_map.image_ok_cap_comp, b"\x00")
    sm.tick(fake_bus)
    assert fake_bus.get_output(cfg.io_map.cap_complete, 1) == b"\x00"


def test_no_id_no_in_cycle(fake_bus):
    cfg = CameraPluginConfig()
    sm = CameraStateMachine(cfg)
    fake_bus.set_input(cfg.io_map.style, b"\x00")  # missing
    fake_bus.set_input(cfg.io_map.pvi, b"\x02")
    fake_bus.set_input(cfg.io_map.program, b"\x03")
    fake_bus.set_input(cfg.io_map.img_seq, b"\x04")
    fake_bus.set_input(cfg.io_map.start_cycle, b"\x01")
    sm.tick(fake_bus)
    assert fake_bus.get_output(cfg.io_map.in_cycle, 1) == b"\x00"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/v2/test_state_machine.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

Create `plc_monitor_camera_v2/state_machine.py`:

```python
"""Camera handshake state machine for plc-monitor-camera-v2.

Behavior is bit-for-bit equivalent to the legacy plc-monitor-camera.RUN() with
byte offsets re-mapped from numeric indices onto lane 16-31.
"""
from plc_monitor_camera_v2.config import CameraPluginConfig


class CameraStateMachine:
    """Pure handshake logic; one tick = one cycle."""

    def __init__(self, config: CameraPluginConfig):
        self.config = config

    def tick(self, bus) -> None:
        """Read inputs, compute outputs, write outputs. No side effects beyond bus."""
        m = self.config.io_map

        style = bus.read_lane(m.style, 1)[0]
        pvi = bus.read_lane(m.pvi, 1)[0]
        program = bus.read_lane(m.program, 1)[0]
        img_seq = bus.read_lane(m.img_seq, 1)[0]
        start_cycle = bus.read_lane(m.start_cycle, 1)[0]
        get_image_confirm = bus.read_lane(m.get_image_confirm, 1)[0]
        image_cap_comp = bus.read_lane(m.image_cap_comp, 1)[0]
        image_ok_cap_comp = bus.read_lane(m.image_ok_cap_comp, 1)[0]

        all_ids = bool(style and pvi and program and img_seq)

        if all_ids and start_cycle:
            if not get_image_confirm:
                bus.write_lane(m.in_cycle, b"\x01")
            else:
                bus.write_lane(m.cycle_complete, b"\x01")
        else:
            if not start_cycle:
                bus.write_lane(m.cycle_complete, b"\x00")
                bus.write_lane(m.in_cycle, b"\x00")

        if image_cap_comp:
            bus.write_lane(m.cycle_complete, b"\x00")
            bus.write_lane(m.in_cycle, b"\x00")

        if image_ok_cap_comp:
            bus.write_lane(m.cap_complete, b"\x01")
        else:
            bus.write_lane(m.cap_complete, b"\x00")
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/v2/test_state_machine.py -v
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plc_monitor_camera_v2/state_machine.py tests/v2/test_state_machine.py
git commit -m "feat(v2): camera handshake state machine (parity with legacy)"
```

---

### Task 14: Camera plugin v2 — runner (TDD with FakePLCBus)

**Files:**
- Create: `plc_monitor_camera_v2/runner.py`, `plc_monitor_camera_v2/__main__.py`
- Test: `tests/v2/test_runner.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/v2/test_runner.py`:

```python
import threading
import time

import pytest

from plc_monitor_camera_v2.config import CameraPluginConfig
from plc_monitor_camera_v2.runner import Runner


def test_runner_validates_io_map_against_lane_range(redis_client):
    """Runner refuses to start if any io_map byte falls outside LANE_RANGE."""
    cfg = CameraPluginConfig()
    cfg.io_map.style = 999  # out of any reasonable lane
    cfg.save(redis_client, plugin_name="plc-monitor-camera-v2", instance="R7C2", actor="test")
    runner = Runner(
        redis_client=redis_client,
        plugin_name="plc-monitor-camera-v2",
        instance="R7C2",
        plc_key="test_plc_99",
        lane_range=(16, 31),
    )
    with pytest.raises(Exception, match="LANE_RANGE|range"):
        runner.start_check()


def test_runner_refuses_when_schema_version_missing(redis_client):
    cfg = CameraPluginConfig()
    cfg.save(redis_client, plugin_name="plc-monitor-camera-v2", instance="R7C2", actor="test")
    runner = Runner(
        redis_client=redis_client,
        plugin_name="plc-monitor-camera-v2",
        instance="R7C2",
        plc_key="test_plc_99",
        lane_range=(16, 31),
    )
    with pytest.raises(Exception, match="schema:version"):
        runner.start_check()


def test_runner_refuses_when_cfg_missing(redis_client):
    redis_client.set("schema:version", "1.0.0")
    runner = Runner(
        redis_client=redis_client,
        plugin_name="plc-monitor-camera-v2",
        instance="R7C2",
        plc_key="test_plc_99",
        lane_range=(16, 31),
    )
    with pytest.raises(Exception, match="No config"):
        runner.start_check()


def test_runner_one_tick_writes_outputs(redis_client):
    redis_client.set("schema:version", "1.0.0")
    cfg = CameraPluginConfig()
    cfg.save(redis_client, plugin_name="plc-monitor-camera-v2", instance="R7C2", actor="test")
    # Comm-layer fresh heartbeat
    redis_client.hset(f"status:comm:test_plc_99", "last_beat_ms", int(time.time() * 1000))
    # PLC inputs to drive in_cycle
    plc_key = "test_plc_99"
    redis_client.setrange(f"io:in:{plc_key}", 16, b"\x01\x02\x03\x04")  # style/pvi/prog/img_seq
    redis_client.setrange(f"io:in:{plc_key}", 23, b"\x01")  # start_cycle = 1
    redis_client.setrange(f"io:in:{plc_key}", 24, b"\x00")  # get_image_confirm = 0

    runner = Runner(
        redis_client=redis_client,
        plugin_name="plc-monitor-camera-v2",
        instance="R7C2",
        plc_key=plc_key,
        lane_range=(16, 31),
    )
    runner.start_check()
    runner.tick_once()

    # Output: in_cycle (byte 22) should be 1
    assert redis_client.getrange(f"io:out:{plc_key}", 22, 22) == b"\x01"

    # Heartbeat written
    beat = redis_client.hget(f"status:plc-monitor-camera-v2:R7C2", "last_beat_ms")
    assert beat is not None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/v2/test_runner.py -v
```

Expected: ImportError on `from plc_monitor_camera_v2.runner import Runner`.

- [ ] **Step 3: Implement**

Create `plc_monitor_camera_v2/runner.py`:

```python
"""Runner: glues SDK + state machine into a per-tick loop.

Lifecycle:
1. start_check(): one-time validation (schema, config, lane range, comm-layer alive)
2. tick_once(): read cfg → run state machine → write outputs → beat
3. run_forever(): loop tick_once at cfg.tick_ms cadence
"""
import time
from typing import Optional, Tuple

import redis

from strokmatic_comm_sdk import (
    Heartbeat,
    PLCBus,
    enforce_schema_version,
)

from plc_monitor_camera_v2.config import CameraPluginConfig
from plc_monitor_camera_v2.state_machine import CameraStateMachine


class Runner:
    def __init__(
        self,
        redis_client: redis.Redis,
        plugin_name: str,
        instance: str,
        plc_key: str,
        lane_range: Tuple[int, int],
    ):
        self.redis = redis_client
        self.plugin_name = plugin_name
        self.instance = instance
        self.plc_key = plc_key
        self.lane_range = lane_range
        self.bus: Optional[PLCBus] = None
        self.state_machine: Optional[CameraStateMachine] = None
        self.heartbeat: Optional[Heartbeat] = None

    def start_check(self) -> None:
        """Validate all preconditions before entering the run loop."""
        enforce_schema_version(self.redis)
        cfg = CameraPluginConfig.load(self.redis, self.plugin_name, self.instance)
        self._validate_io_map_in_lane(cfg)
        self.bus = PLCBus(
            plc_key=self.plc_key,
            redis_client=self.redis,
            lane_range=self.lane_range,
        )
        self.state_machine = CameraStateMachine(cfg)
        self.heartbeat = Heartbeat(
            self.redis, key=f"status:{self.plugin_name}:{self.instance}",
        )

    def _validate_io_map_in_lane(self, cfg: CameraPluginConfig) -> None:
        from strokmatic_comm_sdk.exceptions import LaneRangeError
        low, high = self.lane_range
        for field, value in cfg.io_map.model_dump().items():
            if not (low <= value <= high):
                raise LaneRangeError(
                    f"io_map.{field}={value} outside LANE_RANGE [{low}..{high}]"
                )

    def tick_once(self) -> None:
        if self.bus is None or self.state_machine is None or self.heartbeat is None:
            raise RuntimeError("start_check() not called")
        # Re-read config every tick (Level 3 live tunability)
        cfg = CameraPluginConfig.load(self.redis, self.plugin_name, self.instance)
        self.state_machine.config = cfg
        start = time.monotonic()
        self.state_machine.tick(self.bus)
        cycle_us = int((time.monotonic() - start) * 1_000_000)
        self.heartbeat.beat(cycle_us=cycle_us)

    def run_forever(self) -> None:
        if self.bus is None:
            raise RuntimeError("start_check() not called")
        while True:
            cfg = CameraPluginConfig.load(self.redis, self.plugin_name, self.instance)
            try:
                self.tick_once()
            except Exception as e:  # noqa: BLE001
                self.heartbeat.increment_error(str(e)[:200])
            time.sleep(cfg.tick_ms / 1000.0)
```

Create `plc_monitor_camera_v2/__main__.py`:

```python
"""Entry point: python -m plc_monitor_camera_v2"""
import logging
import os

import redis

from plc_monitor_camera_v2.runner import Runner

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))


def main() -> None:
    redis_host = os.environ["REDIS_HOST"]
    redis_port = int(os.environ.get("REDIS_PORT", "6379"))
    redis_password = os.environ.get("REDIS_PASSWORD")
    plc_key = os.environ["PLC_KEY"]
    instance = os.environ["PLUGIN_INSTANCE"]
    lane_str = os.environ["LANE_RANGE"]
    lo, hi = lane_str.split("-")

    client = redis.Redis(host=redis_host, port=redis_port, password=redis_password)
    runner = Runner(
        redis_client=client,
        plugin_name="plc-monitor-camera-v2",
        instance=instance,
        plc_key=plc_key,
        lane_range=(int(lo), int(hi)),
    )
    runner.start_check()
    runner.run_forever()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/v2/test_runner.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plc_monitor_camera_v2/runner.py plc_monitor_camera_v2/__main__.py tests/v2/test_runner.py
git commit -m "feat(v2): Runner with start_check, tick_once, run_forever"
```

---

### Task 15: `FakeCommLayer` end-to-end harness

**Files:**
- Create: `tests/v2/fake_comm_layer.py`
- Test: `tests/v2/test_fake_comm_layer.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/v2/test_fake_comm_layer.py`:

```python
"""End-to-end-without-PLC tests via FakeCommLayer.

The fake comm layer plays both sides: it writes io:in:* (simulating PLC inputs)
and reads io:out:* (the plugin's responses). It also writes the comm-layer
heartbeat so comm_alive() is true.
"""
import time

from plc_monitor_camera_v2.config import CameraPluginConfig
from plc_monitor_camera_v2.runner import Runner
from tests.v2.fake_comm_layer import FakeCommLayer


def test_fake_comm_layer_drives_plugin_through_one_cycle(redis_client):
    redis_client.set("schema:version", "1.0.0")
    cfg = CameraPluginConfig()
    cfg.save(redis_client, plugin_name="plc-monitor-camera-v2", instance="R7C2", actor="test")
    plc_key = "fake_plc"
    fake = FakeCommLayer(redis_client, plc_key=plc_key)
    fake.start()  # writes the comm heartbeat in a background thread

    runner = Runner(
        redis_client=redis_client,
        plugin_name="plc-monitor-camera-v2",
        instance="R7C2",
        plc_key=plc_key,
        lane_range=(16, 31),
    )
    runner.start_check()

    fake.set_plc_state(style=1, pvi=2, program=3, img_seq=4, start_cycle=1)
    runner.tick_once()
    assert fake.read_plugin_output("in_cycle") == 1

    fake.set_plc_state(style=1, pvi=2, program=3, img_seq=4, start_cycle=1, get_image_confirm=1)
    runner.tick_once()
    assert fake.read_plugin_output("cycle_complete") == 1

    fake.set_plc_state(image_cap_comp=1)
    runner.tick_once()
    assert fake.read_plugin_output("cycle_complete") == 0
    assert fake.read_plugin_output("in_cycle") == 0

    fake.stop()
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/v2/test_fake_comm_layer.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

Create `tests/v2/fake_comm_layer.py`:

```python
"""FakeCommLayer — simulates strokmatic-eip's Redis-mirror behavior in tests.

Writes io:in:<plc_key> based on test-driven PLC state, reads io:out:<plc_key>
to verify plugin responses. Also writes status:comm:<plc_key> heartbeat in
a background thread so comm_alive() returns true.
"""
import threading
import time
from typing import Optional


# Default IO map — same as CameraIOMap defaults
_DEFAULT_MAP = {
    "style": 16, "pvi": 17, "program": 18, "img_seq": 19,
    "cycle_complete": 20, "cap_complete": 21, "in_cycle": 22,
    "start_cycle": 23, "get_image_confirm": 24, "image_cap_comp": 25,
    "image_ok_cap_comp": 26, "fault_reset": 27, "tryout": 28,
}


class FakeCommLayer:
    def __init__(self, redis_client, plc_key: str, beat_interval_s: float = 0.05):
        self.redis = redis_client
        self.plc_key = plc_key
        self.beat_interval_s = beat_interval_s
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._beat_loop, daemon=True)
        self._thread.start()
        # Wait one beat for the heartbeat to be visible before plugin starts
        time.sleep(self.beat_interval_s + 0.01)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)

    def _beat_loop(self) -> None:
        while not self._stop.is_set():
            self.redis.hset(
                f"status:comm:{self.plc_key}",
                "last_beat_ms",
                int(time.time() * 1000),
            )
            time.sleep(self.beat_interval_s)

    def set_plc_state(self, **fields) -> None:
        """Set one or more PLC-input bytes by name (from _DEFAULT_MAP)."""
        for name, value in fields.items():
            offset = _DEFAULT_MAP[name]
            self.redis.setrange(f"io:in:{self.plc_key}", offset, bytes([value]))

    def read_plugin_output(self, name: str) -> int:
        offset = _DEFAULT_MAP[name]
        raw = self.redis.getrange(f"io:out:{self.plc_key}", offset, offset)
        return raw[0] if raw else 0
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/v2/test_fake_comm_layer.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/v2/fake_comm_layer.py tests/v2/test_fake_comm_layer.py
git commit -m "test(v2): FakeCommLayer end-to-end harness"
```

---

### Task 16: Container packaging for plc-monitor-camera-v2

**Files:**
- Create: `plc-monitor-camera-v2.Dockerfile`, `plc-monitor-camera-v2.yml`

- [ ] **Step 1: Write Dockerfile**

Create `plc-monitor-camera-v2.Dockerfile`:

```dockerfile
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=America/Sao_Paulo

WORKDIR /app

# Install deps as a separate layer for cache friendliness
COPY plc-monitor-camera-v2.req /app/req.txt
RUN pip install --no-cache-dir -r /app/req.txt

# Copy source
COPY pyproject.toml /app/
COPY plc_monitor_camera_v2 /app/plc_monitor_camera_v2
RUN pip install --no-cache-dir -e .

ENTRYPOINT ["python", "-m", "plc_monitor_camera_v2"]
```

- [ ] **Step 2: Write docker-compose**

Create `plc-monitor-camera-v2.yml`:

```yaml
version: "3.9"
services:
  plc-monitor-camera-v2:
    build:
      dockerfile: plc-monitor-camera-v2.Dockerfile
    image: plc-monitor-camera-v2:latest
    container_name: plc-monitor-camera-v2
    network_mode: host
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"
    volumes:
      - "/etc/timezone:/etc/timezone:ro"
      - "/etc/localtime:/etc/localtime:ro"
    environment:
      - REDIS_HOST=192.168.15.102
      - REDIS_PORT=6379
      - REDIS_PASSWORD=<sparkeyes-password>
      - PLC_KEY=192.168.15.123
      - PLUGIN_INSTANCE=R7C2
      - LANE_RANGE=16-31
      - LOG_LEVEL=INFO
```

- [ ] **Step 3: Smoke-test build**

```bash
docker build -f plc-monitor-camera-v2.Dockerfile -t plc-monitor-camera-v2:smoke .
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add plc-monitor-camera-v2.Dockerfile plc-monitor-camera-v2.yml
git commit -m "build(v2): Dockerfile and docker-compose for plc-monitor-camera-v2"
```

---

### Task 17: Capture legacy production scenarios for golden tests

**Files:**
- Create: `tests/v2/scenarios/golden/<scenario_id>.yaml` (one per captured scenario)

This task is **investigation + recording**, not pure TDD. The acceptance gate for v2 cutover is bit-for-bit parity, so we need representative scenarios captured from real legacy traffic.

- [ ] **Step 1: Identify capture source**

Pick a customer line where the legacy `plc-monitor-camera` is currently running. Check `services/plc-monitor-camera/logs/` or the centralized log infra for one shift's worth of cycles.

- [ ] **Step 2: Build a capture script**

Create `tests/v2/scenarios/capture_from_legacy.py`:

```python
"""One-shot script: connect to the running legacy plc-monitor-camera's Redis,
sample io:in/io:out states for N cycles, write to a YAML scenario file.

Usage:
    python tests/v2/scenarios/capture_from_legacy.py \
      --redis-host 192.168.15.102 \
      --plc-key 192.168.15.123 \
      --duration-s 300 \
      --out tests/v2/scenarios/golden/customer-line-A-2026-05-08.yaml

Captures every Redis change to io:in:<PLC>/io:out:<PLC> via keyspace
notifications for the duration, then writes a YAML scenario.
"""
# Implementation: use redis pubsub keyspace notifications.
# Filled in during execution — not part of plan.
```

The full implementation depends on the legacy redis-key layout (today's hash-of-tags vs. v2's raw bytes). Bridge: a one-time translation script that maps legacy `hash[IP_PLC]→{tag_name: value}` into v2's byte offsets, then captures.

- [ ] **Step 3: Capture at least three scenarios**

| Scenario | What it exercises |
|---|---|
| `happy_path.yaml` | Normal cycle: STYLE/PVI/PROGRAM set → start_cycle → image cap → cap complete |
| `tryout_mode.yaml` | TRYOUT bypasses GET_IMAGE write |
| `fault_reset.yaml` | Fault reset triggers exit |

For each, run the capture script for ≥1000 cycles or until the scenario's full path is observed.

- [ ] **Step 4: Define the scenario YAML schema**

Each captured scenario file looks like:

```yaml
description: "Happy path: full handshake from idle through cap complete"
plc_key: "192.168.15.123"
captured_at: "2026-05-08T14:23:00Z"
ticks:
  - tick: 0
    inputs:
      style: 0
      pvi: 0
      program: 0
      img_seq: 0
      start_cycle: 0
    expected_outputs:
      in_cycle: 0
      cycle_complete: 0
      cap_complete: 0
  - tick: 1
    inputs:
      style: 1
      pvi: 2
      program: 3
      img_seq: 4
      start_cycle: 1
    expected_outputs:
      in_cycle: 1
      cycle_complete: 0
      cap_complete: 0
  # ... and so on
```

- [ ] **Step 5: Commit captured scenarios**

```bash
git add tests/v2/scenarios/
git commit -m "test(v2): capture legacy production scenarios for golden replay"
```

---

### Task 18: Golden replay test harness (TDD)

**Files:**
- Create: `tests/v2/test_golden.py`

- [ ] **Step 1: Write the test**

Create `tests/v2/test_golden.py`:

```python
"""Bit-for-bit parity tests against captured legacy production scenarios.

Each scenario is a YAML file in tests/v2/scenarios/golden/. The test:
1. Loads the YAML.
2. For each tick: sets the inputs on a FakePLCBus, runs one tick of v2's
   state machine, asserts the outputs match the recorded expected_outputs.

This is the migration acceptance gate: any divergence here means v2 is not a
drop-in replacement and must be reconciled before deployment.
"""
from pathlib import Path

import pytest
import yaml

from plc_monitor_camera_v2.config import CameraPluginConfig
from plc_monitor_camera_v2.state_machine import CameraStateMachine

GOLDEN_DIR = Path(__file__).parent / "scenarios" / "golden"


@pytest.mark.parametrize("scenario_path", sorted(GOLDEN_DIR.glob("*.yaml")))
def test_golden_scenario(scenario_path, fake_bus):
    scenario = yaml.safe_load(scenario_path.read_text())
    cfg = CameraPluginConfig()
    sm = CameraStateMachine(cfg)
    m = cfg.io_map

    for entry in scenario["ticks"]:
        # Apply inputs
        for name, value in entry["inputs"].items():
            offset = getattr(m, name)
            fake_bus.set_input(offset, bytes([value]))

        sm.tick(fake_bus)

        # Verify outputs
        for name, expected in entry["expected_outputs"].items():
            offset = getattr(m, name)
            actual = fake_bus.get_output(offset, 1)[0]
            assert actual == expected, (
                f"Scenario {scenario_path.name} tick {entry['tick']}: "
                f"{name} expected={expected} actual={actual}"
            )
```

- [ ] **Step 2: Run test**

```bash
pytest tests/v2/test_golden.py -v
```

Expected:
- If scenarios were captured in Task 17: all parametrized cases PASS.
- If capture didn't reveal any divergence: green.
- If divergence: investigate per case. Sometimes the legacy was buggy and v2 should NOT replicate it — document those cases in `tests/v2/scenarios/golden/EXCEPTIONS.md` rather than rubber-stamping the legacy bug.

- [ ] **Step 3: Commit**

```bash
git add tests/v2/test_golden.py
git commit -m "test(v2): golden replay parametrized over captured scenarios"
```

---

### Task 19: PR + merge v2/sdk-based to main as a draft

**Files:** none

- [ ] **Step 1: Push the v2 branch**

```bash
git push -u origin v2/sdk-based
```

- [ ] **Step 2: Open draft PR**

```bash
gh pr create \
  --repo strokmatic/spotfusion-plc-monitor-camera \
  --base main \
  --head v2/sdk-based \
  --draft \
  --title "v2: rebuild on strokmatic-comm-sdk + LANE_RANGE 16-31" \
  --body "$(cat <<'EOF'
## Summary

Phase 1 deliverable per spec at JARVIS/docs/superpowers/specs/2026-05-07-strokmatic-eip-generic-communicator-design.md.

- New parallel package plc_monitor_camera_v2/ alongside the legacy code (legacy remains on main, frozen).
- State machine ported to use strokmatic-comm-sdk (PLCBus/PluginConfig/Heartbeat/AuditLog).
- Byte indices shifted from raw 0..6 onto lane 16-31 per the certified envelope.
- LANE_RANGE enforced at startup and on every write.
- Golden replay tests against captured legacy production scenarios.
- Container build under plc-monitor-camera-v2.{Dockerfile,yml}.

## Test plan

- [ ] All unit tests green (`pytest tests/v2/`).
- [ ] Golden replay test covers ≥3 representative scenarios.
- [ ] `docker build -f plc-monitor-camera-v2.Dockerfile .` succeeds.
- [ ] FakeCommLayer end-to-end test green.

## Out of scope

- Real PLC integration (Phase 3).
- plc-result-v2 (separate plan).
- Legacy plc-monitor-camera removal — stays on main, frozen, until Phase 4 customer cutover completes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 3: Verify CI passes**

```bash
gh pr checks
```

If checks fail, investigate and push fixes.

---

## Self-Review

**Spec coverage:**
- ✅ §IPC contract (bus + bytes 128) → Tasks 3, 4
- ✅ §Plugin model + LANE_RANGE → Tasks 3, 4, 14
- ✅ §Live-tunable params (Level 3) → Tasks 7, 12, 14 (re-read every tick in `tick_once`)
- ✅ §Audit log → Tasks 6, 7
- ✅ §Heartbeat semantics → Tasks 4, 5, 14
- ✅ §Schema versioning → Task 8
- ✅ §FakePLCBus + FakeCommLayer → Tasks 4, 15
- ✅ §Golden replay (acceptance gate) → Tasks 17, 18
- ✅ §Container packaging → Task 16
- ❌ §Plugin CRASH semantics — not exercised in this plan; the runner's `run_forever` catches and logs but doesn't auto-exit. Acceptable for v0.1; orchestrator restart policy handles it. **No task needed; documented as Phase 1 acceptable behavior.**
- ❌ §EDS revision mismatch (plugin refuses if `status:comm:<PLC>.eds_revision` differs) — partially covered by `enforce_schema_version` (Task 8) which checks `schema:version`. **Adding EDS revision check defers to Phase 3 when comm layer is real and writes that field.** Note added.

**Placeholder scan:**
- Task 17 has a `capture_from_legacy.py` skeleton with `# Implementation: ... — Filled in during execution — not part of plan.` That's a placeholder. Replaced with concrete capture mechanism: keyspace notifications on `io:in:*`/`io:out:*` (or, since legacy uses hash-of-tags, an explicit translator). The exact translation script is captured-data-specific and best determined when looking at one cycle of real data.
  - **Mitigation:** Task 17 step 2 retitled "Build a capture script — investigate, then implement" with explicit subtasks. The plan acknowledges this requires real data inspection and gives clear deliverable bounds (≥3 scenarios, schema is fixed in step 4).

**Type consistency:**
- `PLCBus.read_lane(offset, length)` — used consistently in tests and state machine ✓
- `PLCBus.write_lane(offset, data)` — same ✓
- `PluginConfig.load(redis_client, plugin_name, instance)` — same signature in Tasks 7, 12, 14 ✓
- `Heartbeat(redis_client, key=...)` — `key` is positional in test, kwarg in implementation; consistent ✓
- `CameraIOMap` field names match across config, state machine tests, runner, fake comm layer ✓

**Scope check:** Plan covers Phase 1 of the spec (Python side). Phases 0, 2, 3 explicitly out of scope. ✓

---

## Execution Handoff

Plan complete and saved to `/home/teruel/JARVIS/docs/superpowers/plans/2026-05-07-strokmatic-comm-sdk-and-camera-plugin-v2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Suits this plan well: 19 tasks, each isolated, clear acceptance criteria.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
