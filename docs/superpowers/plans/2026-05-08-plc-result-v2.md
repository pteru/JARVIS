---
type: Implementation Plan
title: plc-result-v2 Implementation Plan
description: In scope:
timestamp: 2026-05-08
---

# plc-result-v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `spotfusion/services/plc-result/` (pylogix Class 1 + monolithic try/except) with an SDK-based Python plugin that sits behind the certified `strokmatic-eip` adapter, owns byte lane 32–47 of the I/O assembly, and preserves the v1 handshake bit-for-bit.

**Architecture:** Pure-function state machine + lane codec + thin runner. The runner reads 16 bytes from `io:in:<plc_key>[32:48]` via `strokmatic_comm_sdk.PLCBus`, calls `state_machine.step()` (no I/O), executes any returned `get-result`-coordination actions against application Redis, writes 16 bytes to `io:out:<plc_key>[32:48]`, ticks the heartbeat, sleeps `cycle_period_ms`. Config in `cfg:plc-result-v2:<cell>`; status in `status:plc-result-v2:<cell>`; audit in `audit:plc-result-v2:<cell>`. Repo: new branch `v2/sdk-based` on `strokmatic/spotfusion-plc-result`.

**Tech Stack:** Python 3.11+, Pydantic v2, `strokmatic-comm-sdk` v0.1.0, `redis-py` 5.x, pytest, Docker. No new infra dependencies beyond what camera plugin v2 already uses.

**Spec:** `docs/superpowers/specs/2026-05-08-plc-result-v2-design.md`

---

## Scope

In scope:
- New branch `v2/sdk-based` on `strokmatic/spotfusion-plc-result`
- Plugin package `plc_result_v2/` with: `runner.py`, `state_machine.py`, `lane.py`, `config.py`, `get_result_client.py`, `errors.py`
- Test suite: unit (`test_config.py`, `test_lane.py`, `test_state_machine.py`, `test_get_result_client.py`), integration (`test_runner_integration.py`), parity scaffold (`test_parity.py`)
- Container packaging: `plc-result-v2.Dockerfile`, `plc-result-v2.yml`, `plc-result-v2.req`, `pyproject.toml`, `cloudbuild.yaml`
- GitHub Actions CI workflow for the plugin (pytest only — strokmatic-eip's "no GHA" rule does NOT apply to spotfusion plugins; camera v2 has CI too)

Out of scope (per spec §12):
- Changes to the `get-result` service
- Changes to the PLC-side ladder
- Multi-PLC support
- Telemetry beyond status + audit
- A live virtual PLC for tests

---

## File Structure

```
spotfusion-plc-result/                         # branch v2/sdk-based
├── README.md                                  # describes v2; deprecation note linking to v1
├── pyproject.toml                             # standard Python project layout
├── plc-result-v2.Dockerfile                   # runtime container
├── plc-result-v2.yml                          # docker-compose
├── plc-result-v2.req                          # pip requirements
├── cloudbuild.yaml                            # mirrors v1's GCP build (new image tag)
├── .github/workflows/ci.yml                   # pytest in CI
├── plc_result_v2/
│   ├── __init__.py                            # package marker
│   ├── errors.py                              # plugin-specific exception types
│   ├── config.py                              # PlcResultV2IoMap, PlcResultV2Config
│   ├── lane.py                                # InLane / OutLane dataclasses + encode_out / decode_in
│   ├── state_machine.py                       # State enum + pure step()
│   ├── get_result_client.py                   # thin Redis wrapper for the 3 legacy hash keys
│   └── runner.py                              # main loop wiring everything together
└── tests/v2/
    ├── __init__.py
    ├── conftest.py                            # redis_client + clean_redis + fake_bus fixtures
    ├── test_config.py
    ├── test_lane.py
    ├── test_state_machine.py
    ├── test_get_result_client.py
    ├── test_runner_integration.py
    └── test_parity.py                         # parity harness (lab acceptance)
```

**Module responsibilities (one purpose each):**

| Module | Responsibility | I/O? |
|---|---|---|
| `errors.py` | Plugin-specific exception types (`PlcResultLaneError`, etc.) | None |
| `config.py` | Pydantic `PlcResultV2IoMap` + `PlcResultV2Config` (extends SDK `PluginConfig`) | None (load/save go through SDK) |
| `lane.py` | `InLane` / `OutLane` dataclasses; `decode_in(bytes16, io_map) -> InLane`; `encode_out(out_state, io_map) -> bytes16` | None |
| `state_machine.py` | `State` enum + pure `step(in_lane, prev_state, cfg) -> StepResult` (action list for get-result) | None |
| `get_result_client.py` | Thin wrapper: `request()`, `is_confirmed()`, `read_returned()`, `clear()` against application Redis | Redis only |
| `runner.py` | Orchestration: read lane → step → apply actions → write lane → heartbeat → sleep. Validates `LANE_RANGE` at startup. | All I/O paths |

This split lets every module be tested in isolation; `runner.py` stays under 150 LoC.

---

## Tasks

### Task 1: Set up v2 working tree

**Files:**
- Create: working tree at `/home/teruel/worktrees/plc-result-v2/`

- [ ] **Step 1: Locate the existing repo and remote**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/spotfusion/services/plc-result
git remote -v
git branch -a
```

Expected: remote `origin` points at `git@github.com:strokmatic/spotfusion-plc-result.git` (per the parent `.gitmodules`).

- [ ] **Step 2: Create v2 branch and worktree**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/spotfusion/services/plc-result
git fetch origin
git checkout -b v2/sdk-based origin/develop 2>&1 | head -3 \
  || git checkout -b v2/sdk-based origin/main 2>&1 | head -3 \
  || git checkout -b v2/sdk-based origin/master
git worktree add /home/teruel/worktrees/plc-result-v2 v2/sdk-based
cd /home/teruel/worktrees/plc-result-v2
git branch --show-current
```

Expected: working tree at `/home/teruel/worktrees/plc-result-v2`, branch = `v2/sdk-based`.

- [ ] **Step 3: Add requirements file**

Create `/home/teruel/worktrees/plc-result-v2/plc-result-v2.req`:

```
redis>=5,<6
pydantic>=2.5,<3
strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.1.0
```

- [ ] **Step 4: Commit**

```bash
cd /home/teruel/worktrees/plc-result-v2
git add plc-result-v2.req
git commit -m "chore(v2): add requirements for SDK-based v2"
```

---

### Task 2: pyproject.toml + package scaffold + conftest

**Files:**
- Create: `/home/teruel/worktrees/plc-result-v2/pyproject.toml`
- Create: `/home/teruel/worktrees/plc-result-v2/plc_result_v2/__init__.py`
- Create: `/home/teruel/worktrees/plc-result-v2/plc_result_v2/errors.py`
- Create: `/home/teruel/worktrees/plc-result-v2/tests/v2/__init__.py`
- Create: `/home/teruel/worktrees/plc-result-v2/tests/v2/conftest.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
[build-system]
requires = ["setuptools>=64"]
build-backend = "setuptools.build_meta"

[project]
name = "plc-result-v2"
version = "0.1.0"
description = "SpotFusion plc-result handshake — v2 (SDK-based, replaces legacy pylogix path)"
requires-python = ">=3.11"
dependencies = [
    "redis>=5,<6",
    "pydantic>=2.5,<3",
    "strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8"]

[tool.setuptools.packages.find]
include = ["plc_result_v2*"]

[tool.pytest.ini_options]
testpaths = ["tests/v2"]
```

- [ ] **Step 2: Create package marker**

Create `plc_result_v2/__init__.py` (empty file — just a marker).

- [ ] **Step 3: Create errors module**

Create `plc_result_v2/errors.py`:

```python
class PlcResultError(Exception):
    """Base class for plc-result-v2 errors."""


class LaneOutOfRangeError(PlcResultError):
    """Raised when any io_map offset falls outside the configured LANE_RANGE."""


class GetResultBackendError(PlcResultError):
    """Raised when the get-result coordination Redis is unreachable or returns garbage."""
```

- [ ] **Step 4: Create tests fixtures**

Create `tests/v2/__init__.py` (empty).

Create `tests/v2/conftest.py`:

```python
import os

import pytest
import redis as redis_lib


@pytest.fixture(scope="session")
def redis_client():
    host = os.environ.get("REDIS_HOST", "localhost")
    port = int(os.environ.get("REDIS_PORT", "6379"))
    client = redis_lib.Redis(host=host, port=port, decode_responses=False)
    client.ping()
    yield client
    client.close()


@pytest.fixture(autouse=True)
def clean_redis(redis_client):
    """Wipe v2-related keys before every test for isolation."""
    keys = (
        redis_client.keys("io:*")
        + redis_client.keys("cfg:*")
        + redis_client.keys("status:*")
        + redis_client.keys("audit:*")
        + redis_client.keys("schema:*")
        + redis_client.keys("*_GET_RESULT")
        + redis_client.keys("*_GET_RESULT_CONFIRM")
        + redis_client.keys("*_RETURNED_RESULT")
    )
    if keys:
        redis_client.delete(*keys)
    yield


@pytest.fixture
def fake_bus():
    from strokmatic_comm_sdk import FakePLCBus
    return FakePLCBus(lane_range=(32, 47))


@pytest.fixture
def lane_range():
    return (32, 47)
```

- [ ] **Step 5: Install and verify import**

```bash
cd /home/teruel/worktrees/plc-result-v2
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -c "import plc_result_v2; from plc_result_v2.errors import PlcResultError; print('ok')"
```

Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml plc_result_v2/ tests/v2/
git commit -m "feat(v2): scaffold package, errors, test fixtures"
```

---

### Task 3: Config schema (TDD)

**Files:**
- Create: `plc_result_v2/config.py`
- Test: `tests/v2/test_config.py`

- [ ] **Step 1: Write failing tests**

Create `tests/v2/test_config.py`:

```python
import pytest
from pydantic import ValidationError

from plc_result_v2.config import PlcResultV2Config, PlcResultV2IoMap


def test_default_io_map_offsets():
    cfg = PlcResultV2Config(plc_key="192.168.15.10", cell="BSL01", redis_app_host="localhost",
                            get_result_key="192.168.15.10_GET_RESULT",
                            get_result_confirm_key="192.168.15.10_GET_RESULT_CONFIRM",
                            returned_result_key="192.168.15.10_RETURNED_RESULT")
    # Inputs (PLC → device)
    assert cfg.io_map.request_result_off == 32
    assert cfg.io_map.result_write_comp_plc_off == 33
    assert cfg.io_map.fault_reset_extend_off == 34
    # Outputs (device → PLC) — result is u32 LE at 32-35
    assert cfg.io_map.result_off == 32
    assert cfg.io_map.result_write_comp_dev_off == 36
    assert cfg.io_map.in_cycle_off == 37
    assert cfg.io_map.fault_reset_off == 38


def test_cycle_period_default_is_50ms():
    cfg = PlcResultV2Config(plc_key="x", cell="x", redis_app_host="x",
                            get_result_key="x", get_result_confirm_key="x",
                            returned_result_key="x")
    assert cfg.cycle_period_ms == 50


def test_cycle_period_must_be_positive():
    with pytest.raises(ValidationError):
        PlcResultV2Config(plc_key="x", cell="x", redis_app_host="x",
                          get_result_key="x", get_result_confirm_key="x",
                          returned_result_key="x", cycle_period_ms=0)


def test_cycle_period_capped_at_1000():
    with pytest.raises(ValidationError):
        PlcResultV2Config(plc_key="x", cell="x", redis_app_host="x",
                          get_result_key="x", get_result_confirm_key="x",
                          returned_result_key="x", cycle_period_ms=1001)


def test_tryout_defaults_false():
    cfg = PlcResultV2Config(plc_key="x", cell="x", redis_app_host="x",
                            get_result_key="x", get_result_confirm_key="x",
                            returned_result_key="x")
    assert cfg.tryout is False


def test_extra_fields_rejected():
    with pytest.raises(ValidationError):
        PlcResultV2Config.model_validate({
            "plc_key": "x", "cell": "x", "redis_app_host": "x",
            "get_result_key": "x", "get_result_confirm_key": "x",
            "returned_result_key": "x",
            "unknown_field": 1,
        })


def test_io_map_extra_fields_rejected():
    with pytest.raises(ValidationError):
        PlcResultV2IoMap(unknown_off=99)


def test_load_save_roundtrip(redis_client):
    cfg = PlcResultV2Config(
        plc_key="192.168.15.10", cell="BSL01",
        redis_app_host="localhost",
        get_result_key="192.168.15.10_GET_RESULT",
        get_result_confirm_key="192.168.15.10_GET_RESULT_CONFIRM",
        returned_result_key="192.168.15.10_RETURNED_RESULT",
        tryout=True, cycle_period_ms=25,
    )
    cfg.save(redis_client, plugin_name="plc-result-v2", instance="BSL01", actor="test")

    loaded = PlcResultV2Config.load(
        redis_client, plugin_name="plc-result-v2", instance="BSL01",
    )
    assert loaded.tryout is True
    assert loaded.cycle_period_ms == 25
    assert loaded.plc_key == "192.168.15.10"


def test_io_map_offsets_can_exceed_lane_range_in_schema():
    """Schema accepts any int; LANE_RANGE enforcement is at runner startup."""
    iomap = PlcResultV2IoMap(request_result_off=999)
    assert iomap.request_result_off == 999
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /home/teruel/worktrees/plc-result-v2
source .venv/bin/activate
pytest tests/v2/test_config.py -v
```

Expected: ImportError on `plc_result_v2.config`.

- [ ] **Step 3: Implement config**

Create `plc_result_v2/config.py`:

```python
from pydantic import BaseModel, ConfigDict, Field

from strokmatic_comm_sdk import PluginConfig


class PlcResultV2IoMap(BaseModel):
    """Byte offsets within the result lane (default 32-47).

    Inputs (PLC → device, read by plugin):
        bytes 32-34 — request_result, result_write_comp_plc, fault_reset_extend

    Outputs (device → PLC, written by plugin):
        bytes 32-35 — result (u32 LE, occupies 32-35)
        bytes 36-38 — result_write_comp_dev, in_cycle, fault_reset

    Offsets are validated against LANE_RANGE at runner startup, not in this
    schema (the model itself accepts any int — runner rejects out-of-range
    values before the main loop begins).
    """

    model_config = ConfigDict(extra="forbid")

    # Input bytes (PLC → device)
    request_result_off: int = 32
    result_write_comp_plc_off: int = 33
    fault_reset_extend_off: int = 34

    # Output bytes (device → PLC)
    result_off: int = 32  # u32 LE, occupies 32-35
    result_write_comp_dev_off: int = 36
    in_cycle_off: int = 37
    fault_reset_off: int = 38


class PlcResultV2Config(PluginConfig):
    model_config = ConfigDict(extra="forbid")

    plc_key: str
    cell: str
    io_map: PlcResultV2IoMap = Field(default_factory=PlcResultV2IoMap)

    redis_app_host: str
    redis_app_port: int = 6379
    get_result_key: str
    get_result_confirm_key: str
    returned_result_key: str

    tryout: bool = False
    cycle_period_ms: int = Field(50, ge=1, le=1000)
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/v2/test_config.py -v
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plc_result_v2/config.py tests/v2/test_config.py
git commit -m "feat(v2): config schema with IoMap defaults and load/save roundtrip"
```

---

### Task 4: Lane codec — `InLane` / `OutLane` + encode/decode (TDD)

**Files:**
- Create: `plc_result_v2/lane.py`
- Test: `tests/v2/test_lane.py`

- [ ] **Step 1: Write failing tests**

Create `tests/v2/test_lane.py`:

```python
import pytest

from plc_result_v2.config import PlcResultV2IoMap
from plc_result_v2.lane import InLane, OutLane, decode_in, encode_out


def test_decode_in_all_zero():
    raw = bytes(48)  # 0-47 all zero
    in_lane = decode_in(raw, PlcResultV2IoMap())
    assert in_lane.request_result is False
    assert in_lane.result_write_comp_plc is False
    assert in_lane.fault_reset_extend is False


def test_decode_in_all_flags_set():
    raw = bytearray(48)
    raw[32] = 1  # request_result
    raw[33] = 1  # result_write_comp_plc
    raw[34] = 1  # fault_reset_extend
    in_lane = decode_in(bytes(raw), PlcResultV2IoMap())
    assert in_lane.request_result is True
    assert in_lane.result_write_comp_plc is True
    assert in_lane.fault_reset_extend is True


def test_decode_in_nonzero_treated_as_true():
    """Any non-zero u8 is truthy (matches v1's `eval()` of '1' / '2' / '255')."""
    raw = bytearray(48)
    raw[32] = 7
    raw[33] = 255
    in_lane = decode_in(bytes(raw), PlcResultV2IoMap())
    assert in_lane.request_result is True
    assert in_lane.result_write_comp_plc is True


def test_encode_out_zero_state():
    out_lane = OutLane(result=0, result_write_comp_dev=False, in_cycle=False, fault_reset=False)
    raw = encode_out(out_lane, PlcResultV2IoMap())
    assert len(raw) == 16
    assert raw == bytes(16)


def test_encode_out_result_u32_little_endian():
    """result occupies 4 bytes starting at lane offset 0 (= byte 32 abs)."""
    out_lane = OutLane(result=0x01020304, result_write_comp_dev=False, in_cycle=False, fault_reset=False)
    raw = encode_out(out_lane, PlcResultV2IoMap())
    # Lane bytes 0-3 (= absolute 32-35) are LE u32
    assert raw[0:4] == b"\x04\x03\x02\x01"


def test_encode_out_result_max_u32_fits():
    out_lane = OutLane(result=0xFFFFFFFF, result_write_comp_dev=False, in_cycle=False, fault_reset=False)
    raw = encode_out(out_lane, PlcResultV2IoMap())
    assert raw[0:4] == b"\xff\xff\xff\xff"


def test_encode_out_result_overflow_raises():
    out_lane = OutLane(result=2**32, result_write_comp_dev=False, in_cycle=False, fault_reset=False)
    with pytest.raises(OverflowError):
        encode_out(out_lane, PlcResultV2IoMap())


def test_encode_out_result_negative_raises():
    out_lane = OutLane(result=-1, result_write_comp_dev=False, in_cycle=False, fault_reset=False)
    with pytest.raises(OverflowError):
        encode_out(out_lane, PlcResultV2IoMap())


def test_encode_out_flags():
    out_lane = OutLane(result=0, result_write_comp_dev=True, in_cycle=True, fault_reset=True)
    raw = encode_out(out_lane, PlcResultV2IoMap())
    # Lane-relative offsets: 36-32=4, 37-32=5, 38-32=6
    assert raw[4] == 1  # result_write_comp_dev
    assert raw[5] == 1  # in_cycle
    assert raw[6] == 1  # fault_reset


def test_round_trip_pure_lane_bytes():
    """encode_out → put into a 48-byte buffer at offset 32 → decode_in must NOT
    cross-pollute: encode writes only outputs, decode reads only inputs."""
    out = OutLane(result=42, result_write_comp_dev=True, in_cycle=True, fault_reset=True)
    out_bytes = encode_out(out, PlcResultV2IoMap())
    # Build a synthetic full buffer
    buf = bytearray(48)
    buf[32:48] = out_bytes
    # decode_in reads input offsets (32, 33, 34) — those happen to overlap
    # with output bytes (result LSB at 32, etc). The point of this test is to
    # document that the IoMap is symmetric on byte 32 but the SEMANTICS
    # diverge per direction; the codec stays pure.
    in_lane = decode_in(bytes(buf), PlcResultV2IoMap())
    # request_result lives at byte 32, where result LSB happens to be 42
    assert in_lane.request_result is True  # 42 != 0
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pytest tests/v2/test_lane.py -v
```

Expected: ImportError on `plc_result_v2.lane`.

- [ ] **Step 3: Implement lane codec**

Create `plc_result_v2/lane.py`:

```python
from dataclasses import dataclass

from plc_result_v2.config import PlcResultV2IoMap


@dataclass(frozen=True)
class InLane:
    """Decoded PLC → device lane state."""

    request_result: bool
    result_write_comp_plc: bool
    fault_reset_extend: bool


@dataclass(frozen=True)
class OutLane:
    """Decoded device → PLC lane state."""

    result: int  # u32 LE
    result_write_comp_dev: bool
    in_cycle: bool
    fault_reset: bool


# Lane starts at this absolute byte offset in io:in / io:out.
# Hard-coded rather than read from io_map because all offsets in the default
# IoMap are absolute (32-47); the conversion is a single subtract per field.
LANE_BASE = 32


def decode_in(buf: bytes, io_map: PlcResultV2IoMap) -> InLane:
    """Decode 48 bytes of io:in (we read the whole buffer, index by absolute offset).

    Any non-zero u8 is treated as True (matches v1's eval() truthiness).
    """
    if len(buf) < 48:
        raise ValueError(f"decode_in needs >= 48 bytes, got {len(buf)}")
    return InLane(
        request_result=bool(buf[io_map.request_result_off]),
        result_write_comp_plc=bool(buf[io_map.result_write_comp_plc_off]),
        fault_reset_extend=bool(buf[io_map.fault_reset_extend_off]),
    )


def encode_out(out: OutLane, io_map: PlcResultV2IoMap) -> bytes:
    """Encode an OutLane to a 16-byte lane chunk (lane-relative offsets).

    Returns exactly 16 bytes ready to write at SETRANGE offset 32.
    Raises OverflowError if `result` is outside u32 range.
    """
    if out.result < 0 or out.result > 0xFFFFFFFF:
        raise OverflowError(f"result {out.result} outside u32 range")

    buf = bytearray(16)
    # u32 LE for result, at lane-relative offset (io_map.result_off - LANE_BASE)
    result_off = io_map.result_off - LANE_BASE
    buf[result_off : result_off + 4] = out.result.to_bytes(4, "little")
    buf[io_map.result_write_comp_dev_off - LANE_BASE] = 1 if out.result_write_comp_dev else 0
    buf[io_map.in_cycle_off - LANE_BASE] = 1 if out.in_cycle else 0
    buf[io_map.fault_reset_off - LANE_BASE] = 1 if out.fault_reset else 0
    return bytes(buf)
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/v2/test_lane.py -v
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plc_result_v2/lane.py tests/v2/test_lane.py
git commit -m "feat(v2): lane codec — InLane/OutLane + encode/decode (u32 LE result)"
```

---

### Task 5: State machine (pure, TDD)

**Files:**
- Create: `plc_result_v2/state_machine.py`
- Test: `tests/v2/test_state_machine.py`

- [ ] **Step 1: Write failing tests**

Create `tests/v2/test_state_machine.py`:

```python
import pytest

from plc_result_v2.config import PlcResultV2Config
from plc_result_v2.lane import InLane, OutLane
from plc_result_v2.state_machine import (
    Action,
    State,
    StepResult,
    initial_state,
    step,
)


def make_cfg(tryout=False, returned_result=0):
    """Test cfg builder. `returned_result` is what the fake get-result service returns."""
    return PlcResultV2Config(
        plc_key="192.168.15.10", cell="BSL01",
        redis_app_host="localhost",
        get_result_key="192.168.15.10_GET_RESULT",
        get_result_confirm_key="192.168.15.10_GET_RESULT_CONFIRM",
        returned_result_key="192.168.15.10_RETURNED_RESULT",
        tryout=tryout,
    )


def in_lane(request_result=False, result_write_comp_plc=False, fault_reset_extend=False):
    return InLane(request_result=request_result,
                  result_write_comp_plc=result_write_comp_plc,
                  fault_reset_extend=fault_reset_extend)


def test_initial_state_is_idle():
    assert initial_state() == State.IDLE


def test_idle_with_no_input_stays_idle_clear_outputs():
    r = step(in_lane(), State.IDLE, make_cfg(), get_result_confirmed=False, returned_result=0)
    assert r.next_state == State.IDLE
    assert r.out == OutLane(result=0, result_write_comp_dev=False, in_cycle=False, fault_reset=False)
    assert r.actions == [Action.CLEAR_GET_RESULT]


def test_fault_reset_passthrough_in_idle():
    r = step(in_lane(fault_reset_extend=True), State.IDLE, make_cfg(),
             get_result_confirmed=False, returned_result=0)
    assert r.next_state == State.IDLE
    assert r.out.fault_reset is True
    # fault-reset passthrough is independent of state; in_cycle stays False
    assert r.out.in_cycle is False


def test_idle_to_requesting_when_request_result_rises():
    r = step(in_lane(request_result=True), State.IDLE, make_cfg(),
             get_result_confirmed=False, returned_result=0)
    assert r.next_state == State.REQUESTING
    assert r.out.in_cycle is True
    assert r.out.result == 0  # not yet
    assert r.actions == [Action.SET_GET_RESULT_1]


def test_requesting_in_tryout_does_not_emit_set_get_result():
    """TRYOUT short-circuits: ack via in_cycle, but never asks get-result service."""
    r = step(in_lane(request_result=True), State.IDLE, make_cfg(tryout=True),
             get_result_confirmed=False, returned_result=0)
    assert r.next_state == State.REQUESTING
    assert r.out.in_cycle is True
    assert Action.SET_GET_RESULT_1 not in r.actions


def test_requesting_to_waiting_no_change_until_confirm():
    r = step(in_lane(request_result=True), State.REQUESTING, make_cfg(),
             get_result_confirmed=False, returned_result=0)
    assert r.next_state == State.WAITING_RESULT
    assert r.out.in_cycle is True
    assert r.out.result == 0


def test_waiting_to_wrote_when_get_result_confirmed():
    r = step(in_lane(request_result=True), State.WAITING_RESULT, make_cfg(),
             get_result_confirmed=True, returned_result=42)
    assert r.next_state == State.WROTE_RESULT
    assert r.out.result == 42
    assert r.out.result_write_comp_dev is True
    assert r.out.in_cycle is True


def test_wrote_holds_result_until_plc_acks():
    r = step(in_lane(request_result=True), State.WROTE_RESULT, make_cfg(),
             get_result_confirmed=True, returned_result=42)
    assert r.next_state == State.WROTE_RESULT
    assert r.out.result == 42
    assert r.out.result_write_comp_dev is True


def test_wrote_to_idle_when_plc_acks_write_complete():
    r = step(in_lane(request_result=True, result_write_comp_plc=True),
             State.WROTE_RESULT, make_cfg(),
             get_result_confirmed=True, returned_result=42)
    assert r.next_state == State.IDLE
    assert r.out.result == 0
    assert r.out.result_write_comp_dev is False
    assert r.out.in_cycle is False
    assert Action.CLEAR_GET_RESULT in r.actions


def test_any_state_back_to_idle_when_request_clears():
    """When PLC clears request_result, return to IDLE and clear outputs from any state."""
    for state in (State.REQUESTING, State.WAITING_RESULT, State.WROTE_RESULT):
        r = step(in_lane(request_result=False), state, make_cfg(),
                 get_result_confirmed=False, returned_result=0)
        assert r.next_state == State.IDLE, f"from {state}"
        assert r.out.result == 0
        assert r.out.in_cycle is False
        assert Action.CLEAR_GET_RESULT in r.actions


def test_large_result_value_u32_range():
    """u32 range (0..2**32-1) flows through end-to-end."""
    r = step(in_lane(request_result=True), State.WAITING_RESULT, make_cfg(),
             get_result_confirmed=True, returned_result=2**32 - 1)
    assert r.out.result == 2**32 - 1


def test_fault_reset_passthrough_in_every_state():
    for state in (State.IDLE, State.REQUESTING, State.WAITING_RESULT, State.WROTE_RESULT):
        r = step(in_lane(request_result=(state != State.IDLE), fault_reset_extend=True),
                 state, make_cfg(), get_result_confirmed=False, returned_result=0)
        assert r.out.fault_reset is True, f"fault_reset must pass through in {state}"


def test_step_result_is_immutable():
    """StepResult and OutLane are frozen so the runner can't accidentally mutate them."""
    r = step(in_lane(), State.IDLE, make_cfg(), get_result_confirmed=False, returned_result=0)
    with pytest.raises((AttributeError, TypeError)):
        r.out.in_cycle = True  # type: ignore[misc]
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/v2/test_state_machine.py -v
```

Expected: ImportError on `plc_result_v2.state_machine`.

- [ ] **Step 3: Implement state machine**

Create `plc_result_v2/state_machine.py`:

```python
from dataclasses import dataclass
from enum import Enum, auto

from plc_result_v2.config import PlcResultV2Config
from plc_result_v2.lane import InLane, OutLane


class State(Enum):
    IDLE = auto()
    REQUESTING = auto()
    WAITING_RESULT = auto()
    WROTE_RESULT = auto()


class Action(Enum):
    """Side-effects the runner must apply after step() returns."""

    SET_GET_RESULT_1 = auto()
    CLEAR_GET_RESULT = auto()  # also clears confirm + returned_result


@dataclass(frozen=True)
class StepResult:
    next_state: State
    out: OutLane
    actions: tuple[Action, ...]


def initial_state() -> State:
    return State.IDLE


def step(
    in_lane: InLane,
    prev_state: State,
    cfg: PlcResultV2Config,
    *,
    get_result_confirmed: bool,
    returned_result: int,
) -> StepResult:
    """Pure step function. No I/O. Decisions only.

    Returns the next state, the OutLane to write, and a list of get-result
    actions for the runner to execute.

    `get_result_confirmed` and `returned_result` come from the runner reading
    application Redis BEFORE calling step(); the runner is responsible for
    those reads each cycle.
    """
    # Fault-reset is always-on, every state, every cycle (matches v1 line ~118).
    fault_reset_out = in_lane.fault_reset_extend

    # Request cleared at any point → reset.
    if not in_lane.request_result:
        return StepResult(
            next_state=State.IDLE,
            out=OutLane(
                result=0,
                result_write_comp_dev=False,
                in_cycle=False,
                fault_reset=fault_reset_out,
            ),
            actions=(Action.CLEAR_GET_RESULT,),
        )

    # PLC has latched the result → cleanup and return to IDLE.
    if prev_state == State.WROTE_RESULT and in_lane.result_write_comp_plc:
        return StepResult(
            next_state=State.IDLE,
            out=OutLane(
                result=0,
                result_write_comp_dev=False,
                in_cycle=False,
                fault_reset=fault_reset_out,
            ),
            actions=(Action.CLEAR_GET_RESULT,),
        )

    if prev_state == State.IDLE:
        # Rising edge: request_result went 0 → 1.
        actions: tuple[Action, ...] = () if cfg.tryout else (Action.SET_GET_RESULT_1,)
        return StepResult(
            next_state=State.REQUESTING,
            out=OutLane(result=0, result_write_comp_dev=False, in_cycle=True, fault_reset=fault_reset_out),
            actions=actions,
        )

    if prev_state == State.REQUESTING:
        # Move into the polling state on the next cycle.
        return StepResult(
            next_state=State.WAITING_RESULT,
            out=OutLane(result=0, result_write_comp_dev=False, in_cycle=True, fault_reset=fault_reset_out),
            actions=(),
        )

    if prev_state == State.WAITING_RESULT:
        if get_result_confirmed:
            return StepResult(
                next_state=State.WROTE_RESULT,
                out=OutLane(
                    result=returned_result,
                    result_write_comp_dev=True,
                    in_cycle=True,
                    fault_reset=fault_reset_out,
                ),
                actions=(),
            )
        # still waiting
        return StepResult(
            next_state=State.WAITING_RESULT,
            out=OutLane(result=0, result_write_comp_dev=False, in_cycle=True, fault_reset=fault_reset_out),
            actions=(),
        )

    # WROTE_RESULT, request still high, PLC hasn't acked: hold the value.
    return StepResult(
        next_state=State.WROTE_RESULT,
        out=OutLane(
            result=returned_result,
            result_write_comp_dev=True,
            in_cycle=True,
            fault_reset=fault_reset_out,
        ),
        actions=(),
    )
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/v2/test_state_machine.py -v
```

Expected: all 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plc_result_v2/state_machine.py tests/v2/test_state_machine.py
git commit -m "feat(v2): pure state machine (IDLE/REQUESTING/WAITING_RESULT/WROTE_RESULT)"
```

---

### Task 6: Get-result Redis client (TDD)

**Files:**
- Create: `plc_result_v2/get_result_client.py`
- Test: `tests/v2/test_get_result_client.py`

- [ ] **Step 1: Write failing tests**

Create `tests/v2/test_get_result_client.py`:

```python
import pytest

from plc_result_v2.config import PlcResultV2Config
from plc_result_v2.get_result_client import GetResultClient


@pytest.fixture
def cfg():
    return PlcResultV2Config(
        plc_key="192.168.15.10", cell="BSL01",
        redis_app_host="localhost",
        get_result_key="192.168.15.10_GET_RESULT",
        get_result_confirm_key="192.168.15.10_GET_RESULT_CONFIRM",
        returned_result_key="192.168.15.10_RETURNED_RESULT",
    )


def test_request_sets_redis_key_to_1(redis_client, cfg):
    client = GetResultClient(redis_client, cfg)
    client.request()
    assert redis_client.get(cfg.get_result_key) == b"1"


def test_clear_resets_all_three_keys(redis_client, cfg):
    redis_client.set(cfg.get_result_key, "1")
    redis_client.set(cfg.get_result_confirm_key, "1")
    redis_client.set(cfg.returned_result_key, "42")

    client = GetResultClient(redis_client, cfg)
    client.clear()

    assert redis_client.get(cfg.get_result_key) == b"0"
    assert redis_client.get(cfg.get_result_confirm_key) == b"0"
    assert redis_client.get(cfg.returned_result_key) == b"0"


def test_is_confirmed_returns_false_when_key_missing(redis_client, cfg):
    client = GetResultClient(redis_client, cfg)
    assert client.is_confirmed() is False


def test_is_confirmed_returns_false_when_key_is_zero(redis_client, cfg):
    redis_client.set(cfg.get_result_confirm_key, "0")
    client = GetResultClient(redis_client, cfg)
    assert client.is_confirmed() is False


def test_is_confirmed_returns_true_when_key_is_one(redis_client, cfg):
    redis_client.set(cfg.get_result_confirm_key, "1")
    client = GetResultClient(redis_client, cfg)
    assert client.is_confirmed() is True


def test_is_confirmed_returns_true_for_any_truthy_int(redis_client, cfg):
    """v1 used `eval()` of the string — any non-zero int is truthy."""
    redis_client.set(cfg.get_result_confirm_key, "42")
    client = GetResultClient(redis_client, cfg)
    assert client.is_confirmed() is True


def test_read_returned_zero_when_missing(redis_client, cfg):
    client = GetResultClient(redis_client, cfg)
    assert client.read_returned() == 0


def test_read_returned_parses_int(redis_client, cfg):
    redis_client.set(cfg.returned_result_key, "12345")
    client = GetResultClient(redis_client, cfg)
    assert client.read_returned() == 12345


def test_read_returned_large_u32_value(redis_client, cfg):
    """u32 range (up to 4_294_967_295) must round-trip."""
    redis_client.set(cfg.returned_result_key, "4294967295")
    client = GetResultClient(redis_client, cfg)
    assert client.read_returned() == 4294967295


def test_read_returned_rejects_non_numeric(redis_client, cfg):
    redis_client.set(cfg.returned_result_key, "garbage")
    client = GetResultClient(redis_client, cfg)
    from plc_result_v2.errors import GetResultBackendError
    with pytest.raises(GetResultBackendError):
        client.read_returned()


def test_read_returned_rejects_negative(redis_client, cfg):
    redis_client.set(cfg.returned_result_key, "-1")
    client = GetResultClient(redis_client, cfg)
    from plc_result_v2.errors import GetResultBackendError
    with pytest.raises(GetResultBackendError):
        client.read_returned()


def test_read_returned_rejects_overflow(redis_client, cfg):
    redis_client.set(cfg.returned_result_key, str(2**32))
    client = GetResultClient(redis_client, cfg)
    from plc_result_v2.errors import GetResultBackendError
    with pytest.raises(GetResultBackendError):
        client.read_returned()
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/v2/test_get_result_client.py -v
```

Expected: ImportError on `plc_result_v2.get_result_client`.

- [ ] **Step 3: Implement client**

Create `plc_result_v2/get_result_client.py`:

```python
import redis

from plc_result_v2.config import PlcResultV2Config
from plc_result_v2.errors import GetResultBackendError


class GetResultClient:
    """Thin wrapper over the 3 legacy redis hash keys that coordinate with
    the separate `get-result` service. Backward-compatible with v1 — same key
    names, same value semantics."""

    def __init__(self, redis_client: redis.Redis, cfg: PlcResultV2Config):
        self.r = redis_client
        self._req_key = cfg.get_result_key
        self._confirm_key = cfg.get_result_confirm_key
        self._returned_key = cfg.returned_result_key

    def request(self) -> None:
        """Ask the get-result service to compute a result for the current part."""
        self.r.set(self._req_key, "1")

    def clear(self) -> None:
        """Clear all three coordination keys (idempotent)."""
        self.r.set(self._req_key, "0")
        self.r.set(self._confirm_key, "0")
        self.r.set(self._returned_key, "0")

    def is_confirmed(self) -> bool:
        """True if the get-result service has signalled a result is ready."""
        raw = self.r.get(self._confirm_key)
        if raw is None:
            return False
        try:
            return int(raw) != 0
        except ValueError:
            return False

    def read_returned(self) -> int:
        """Read the get-result service's computed result. Must fit in u32."""
        raw = self.r.get(self._returned_key)
        if raw is None:
            return 0
        try:
            v = int(raw)
        except ValueError as exc:
            raise GetResultBackendError(
                f"non-numeric value in {self._returned_key}: {raw!r}"
            ) from exc
        if v < 0 or v > 0xFFFFFFFF:
            raise GetResultBackendError(
                f"value in {self._returned_key} out of u32 range: {v}"
            )
        return v
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/v2/test_get_result_client.py -v
```

Expected: all 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plc_result_v2/get_result_client.py tests/v2/test_get_result_client.py
git commit -m "feat(v2): get-result Redis client (request/clear/is_confirmed/read_returned)"
```

---

### Task 7: Runner — orchestration (TDD with FakePLCBus)

**Files:**
- Create: `plc_result_v2/runner.py`
- Test: `tests/v2/test_runner_integration.py`

- [ ] **Step 1: Write failing tests**

Create `tests/v2/test_runner_integration.py`:

```python
import time

import pytest

from plc_result_v2.config import PlcResultV2Config
from plc_result_v2.lane import LANE_BASE
from plc_result_v2.runner import Runner


@pytest.fixture
def cfg():
    return PlcResultV2Config(
        plc_key="192.168.15.10", cell="BSL01",
        redis_app_host="localhost",
        get_result_key="192.168.15.10_GET_RESULT",
        get_result_confirm_key="192.168.15.10_GET_RESULT_CONFIRM",
        returned_result_key="192.168.15.10_RETURNED_RESULT",
        cycle_period_ms=10,  # fast for tests
    )


def test_idle_cycle_writes_zero_lane(fake_bus, redis_client, cfg):
    runner = Runner(cfg, fake_bus, redis_client)
    runner.run_one_cycle()
    # All output bytes 32-47 zero
    assert fake_bus.get_output(32, 16) == bytes(16)


def test_fault_reset_passes_through_in_idle(fake_bus, redis_client, cfg):
    # PLC sets fault_reset_extend
    fake_bus.set_input(cfg.io_map.fault_reset_extend_off, b"\x01")
    runner = Runner(cfg, fake_bus, redis_client)
    runner.run_one_cycle()
    # Device echoes via fault_reset out
    out = fake_bus.get_output(cfg.io_map.fault_reset_off, 1)
    assert out == b"\x01"


def test_full_handshake_happy_path(fake_bus, redis_client, cfg):
    runner = Runner(cfg, fake_bus, redis_client)

    # Cycle 1: PLC raises request_result
    fake_bus.set_input(cfg.io_map.request_result_off, b"\x01")
    runner.run_one_cycle()
    # Plugin should have set in_cycle=1 and HSET get_result_key=1
    assert fake_bus.get_output(cfg.io_map.in_cycle_off, 1) == b"\x01"
    assert redis_client.get(cfg.get_result_key) == b"1"

    # Cycle 2: same input — moves to WAITING_RESULT, still no result
    runner.run_one_cycle()
    assert fake_bus.get_output(cfg.io_map.result_off, 4) == b"\x00\x00\x00\x00"

    # Cycle 3: get-result service responds
    redis_client.set(cfg.get_result_confirm_key, "1")
    redis_client.set(cfg.returned_result_key, "42")
    runner.run_one_cycle()
    # Plugin writes result + ack
    assert fake_bus.get_output(cfg.io_map.result_off, 4) == (42).to_bytes(4, "little")
    assert fake_bus.get_output(cfg.io_map.result_write_comp_dev_off, 1) == b"\x01"

    # Cycle 4: PLC ack write complete
    fake_bus.set_input(cfg.io_map.result_write_comp_plc_off, b"\x01")
    runner.run_one_cycle()
    # Plugin clears its outputs and the coordination keys
    assert fake_bus.get_output(cfg.io_map.result_off, 4) == b"\x00\x00\x00\x00"
    assert fake_bus.get_output(cfg.io_map.in_cycle_off, 1) == b"\x00"
    assert redis_client.get(cfg.get_result_key) == b"0"
    assert redis_client.get(cfg.get_result_confirm_key) == b"0"
    assert redis_client.get(cfg.returned_result_key) == b"0"


def test_tryout_mode_skips_get_result_call(fake_bus, redis_client, cfg):
    cfg_tryout = cfg.model_copy(update={"tryout": True})
    runner = Runner(cfg_tryout, fake_bus, redis_client)

    fake_bus.set_input(cfg.io_map.request_result_off, b"\x01")
    runner.run_one_cycle()

    # in_cycle is set, but get_result_key was NEVER set to "1"
    assert fake_bus.get_output(cfg.io_map.in_cycle_off, 1) == b"\x01"
    assert redis_client.get(cfg.get_result_key) in (None, b"0")


def test_request_clears_mid_handshake_resets_state(fake_bus, redis_client, cfg):
    runner = Runner(cfg, fake_bus, redis_client)
    fake_bus.set_input(cfg.io_map.request_result_off, b"\x01")
    runner.run_one_cycle()  # → REQUESTING
    runner.run_one_cycle()  # → WAITING_RESULT

    # PLC suddenly drops request
    fake_bus.set_input(cfg.io_map.request_result_off, b"\x00")
    runner.run_one_cycle()

    assert fake_bus.get_output(cfg.io_map.in_cycle_off, 1) == b"\x00"
    assert redis_client.get(cfg.get_result_key) == b"0"


def test_lane_range_violation_at_startup_raises(redis_client, cfg):
    """If io_map points outside LANE_RANGE, runner fail-fasts before the loop."""
    from strokmatic_comm_sdk import FakePLCBus

    bad_iomap = cfg.io_map.model_copy(update={"request_result_off": 99})
    bad_cfg = cfg.model_copy(update={"io_map": bad_iomap})
    bus = FakePLCBus(lane_range=(32, 47))

    from plc_result_v2.errors import LaneOutOfRangeError
    with pytest.raises(LaneOutOfRangeError):
        Runner(bad_cfg, bus, redis_client)


def test_heartbeat_updates_every_cycle(fake_bus, redis_client, cfg):
    runner = Runner(cfg, fake_bus, redis_client)
    runner.run_one_cycle()
    h = redis_client.hgetall(f"status:plc-result-v2:{cfg.cell}")
    assert b"last_beat_ms" in h
    assert b"state" in h
    assert h[b"state"] == b"IDLE"
    assert h[b"cycle_period_ms"] == str(cfg.cycle_period_ms).encode()


def test_result_count_increments_on_each_wrote_transition(fake_bus, redis_client, cfg):
    runner = Runner(cfg, fake_bus, redis_client)
    # Drive a full happy path
    fake_bus.set_input(cfg.io_map.request_result_off, b"\x01")
    runner.run_one_cycle()  # IDLE → REQUESTING
    runner.run_one_cycle()  # REQUESTING → WAITING_RESULT
    redis_client.set(cfg.get_result_confirm_key, "1")
    redis_client.set(cfg.returned_result_key, "7")
    runner.run_one_cycle()  # WAITING_RESULT → WROTE_RESULT (count++)
    fake_bus.set_input(cfg.io_map.result_write_comp_plc_off, b"\x01")
    runner.run_one_cycle()  # WROTE_RESULT → IDLE

    h = redis_client.hgetall(f"status:plc-result-v2:{cfg.cell}")
    assert h[b"result_count"] == b"1"


def test_tryout_counter_increments_on_each_tryout_cycle(fake_bus, redis_client, cfg):
    cfg_tryout = cfg.model_copy(update={"tryout": True})
    runner = Runner(cfg_tryout, fake_bus, redis_client)
    fake_bus.set_input(cfg.io_map.request_result_off, b"\x01")
    runner.run_one_cycle()  # IDLE → REQUESTING (tryout=True; counted)

    h = redis_client.hgetall(f"status:plc-result-v2:{cfg.cell}")
    assert h[b"tryout_count"] == b"1"


def test_1000_synthetic_cycles_stable(fake_bus, redis_client, cfg):
    """Stress: 1000 cycles toggling request_result every 10 cycles, ensure
    state stays consistent and no exception bubbles up."""
    runner = Runner(cfg, fake_bus, redis_client)
    for i in range(1000):
        # Toggle request_result every 10 cycles
        if i % 20 < 10:
            fake_bus.set_input(cfg.io_map.request_result_off, b"\x01")
        else:
            fake_bus.set_input(cfg.io_map.request_result_off, b"\x00")
        # Simulate get-result confirming after 3 cycles into a request burst
        if i % 20 == 3:
            redis_client.set(cfg.get_result_confirm_key, "1")
            redis_client.set(cfg.returned_result_key, str(i))
        runner.run_one_cycle()

    h = redis_client.hgetall(f"status:plc-result-v2:{cfg.cell}")
    assert int(h[b"result_count"]) > 0
    assert int(h.get(b"error_count", b"0")) == 0
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/v2/test_runner_integration.py -v
```

Expected: ImportError on `plc_result_v2.runner`.

- [ ] **Step 3: Implement runner**

Create `plc_result_v2/runner.py`:

```python
import os
import time
from typing import Protocol

import redis

from plc_result_v2.config import PlcResultV2Config
from plc_result_v2.errors import LaneOutOfRangeError
from plc_result_v2.get_result_client import GetResultClient
from plc_result_v2.lane import LANE_BASE, decode_in, encode_out
from plc_result_v2.state_machine import Action, State, initial_state, step


class _BusLike(Protocol):
    """Subset of strokmatic_comm_sdk.PLCBus / FakePLCBus we depend on."""

    def read_lane(self, offset: int, length: int) -> bytes: ...
    def write_lane(self, offset: int, data: bytes) -> None: ...


_PLUGIN_NAME = "plc-result-v2"


class Runner:
    """Main loop: read lane → step → apply actions → write lane → heartbeat → sleep.

    Validates io_map offsets against LANE_RANGE at construction; raises
    LaneOutOfRangeError before any I/O if any offset is outside the lane.
    """

    def __init__(
        self,
        cfg: PlcResultV2Config,
        bus: _BusLike,
        app_redis: redis.Redis,
    ):
        self.cfg = cfg
        self.bus = bus
        self.app_redis = app_redis
        self._validate_lane_range()
        self._gr = GetResultClient(app_redis, cfg)
        self._state: State = initial_state()
        self._status_key = f"status:{_PLUGIN_NAME}:{cfg.cell}"
        self._result_count = 0
        self._tryout_count = 0
        self._error_count = 0
        # On startup, mirror cycle_period_ms into the status hash so dashboards see it.
        app_redis.hset(self._status_key, "cycle_period_ms", cfg.cycle_period_ms)

    def _validate_lane_range(self) -> None:
        low_high = os.environ.get("LANE_RANGE", "32-47")
        try:
            low_s, high_s = low_high.split("-")
            low, high = int(low_s), int(high_s)
        except (ValueError, AttributeError) as exc:
            raise LaneOutOfRangeError(
                f"LANE_RANGE env var malformed: {low_high!r}"
            ) from exc

        m = self.cfg.io_map
        offsets = {
            "request_result_off": m.request_result_off,
            "result_write_comp_plc_off": m.result_write_comp_plc_off,
            "fault_reset_extend_off": m.fault_reset_extend_off,
            "result_off": m.result_off,
            "result_off_end": m.result_off + 3,  # u32 LE spans 4 bytes
            "result_write_comp_dev_off": m.result_write_comp_dev_off,
            "in_cycle_off": m.in_cycle_off,
            "fault_reset_off": m.fault_reset_off,
        }
        for name, off in offsets.items():
            if off < low or off > high:
                raise LaneOutOfRangeError(
                    f"io_map.{name} = {off} outside LANE_RANGE [{low}..{high}]"
                )

    def run_one_cycle(self) -> None:
        """One iteration of the main loop. Called from run_forever() or tests."""
        t0 = time.perf_counter()
        try:
            # 1. Read entire prefix of io:in so absolute offsets work in decode.
            raw_in = self.bus.read_lane(0, 48)
            in_lane = decode_in(raw_in, self.cfg.io_map)

            # 2. Snapshot get-result coordination state.
            confirmed = self._gr.is_confirmed()
            returned = self._gr.read_returned() if confirmed else 0

            # 3. Step the state machine (pure function).
            prev = self._state
            r = step(
                in_lane,
                prev,
                self.cfg,
                get_result_confirmed=confirmed,
                returned_result=returned,
            )

            # 4. Apply any get-result actions.
            for action in r.actions:
                if action == Action.SET_GET_RESULT_1:
                    self._gr.request()
                elif action == Action.CLEAR_GET_RESULT:
                    self._gr.clear()

            # 5. Update counters.
            if prev != State.WROTE_RESULT and r.next_state == State.WROTE_RESULT:
                self._result_count += 1
            if self.cfg.tryout and prev == State.IDLE and r.next_state == State.REQUESTING:
                self._tryout_count += 1
            self._state = r.next_state

            # 6. Write the 16-byte output lane in one SETRANGE.
            self.bus.write_lane(LANE_BASE, encode_out(r.out, self.cfg.io_map))

            # 7. Heartbeat + state hash.
            cycle_us = int((time.perf_counter() - t0) * 1_000_000)
            self.app_redis.hset(
                self._status_key,
                mapping={
                    "last_beat_ms": int(time.time() * 1000),
                    "last_cycle_us": cycle_us,
                    "cycle_period_ms": self.cfg.cycle_period_ms,
                    "state": self._state.name,
                    "result_count": self._result_count,
                    "tryout_count": self._tryout_count,
                    "error_count": self._error_count,
                },
            )
        except Exception as exc:
            self._error_count += 1
            self.app_redis.hset(
                self._status_key,
                mapping={
                    "error_count": self._error_count,
                    "last_error": str(exc)[:200],
                },
            )
            raise

    def run_forever(self) -> None:
        period_s = self.cfg.cycle_period_ms / 1000.0
        while True:
            try:
                self.run_one_cycle()
            except Exception:
                # Already accounted for in status; do not crash the container.
                pass
            time.sleep(period_s)
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/v2/test_runner_integration.py -v
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plc_result_v2/runner.py tests/v2/test_runner_integration.py
git commit -m "feat(v2): runner — lane validation, main loop, status counters"
```

---

### Task 8: Entry point + container packaging

**Files:**
- Create: `plc_result_v2/__main__.py`
- Create: `plc-result-v2.Dockerfile`
- Create: `plc-result-v2.yml`
- Create: `README.md`

- [ ] **Step 1: Create __main__ entry point**

Create `plc_result_v2/__main__.py`:

```python
"""Entry point for `python -m plc_result_v2`.

Reads cfg:plc-result-v2:<CELL> from Redis (host/port from REDIS_HOST/REDIS_PORT
env vars, application-side coordination from REDIS_APP_HOST/REDIS_APP_PORT),
constructs Runner, calls run_forever().
"""

import logging
import os
import sys

import redis

from plc_result_v2.config import PlcResultV2Config
from plc_result_v2.runner import Runner
from strokmatic_comm_sdk import PLCBus


def main() -> int:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    logger = logging.getLogger("plc-result-v2")

    cell = os.environ["CELL"]  # required
    io_redis = redis.Redis(
        host=os.environ.get("REDIS_HOST", "localhost"),
        port=int(os.environ.get("REDIS_PORT", "6379")),
        decode_responses=False,
    )
    app_redis = redis.Redis(
        host=os.environ.get("REDIS_APP_HOST", os.environ.get("REDIS_HOST", "localhost")),
        port=int(os.environ.get("REDIS_APP_PORT", os.environ.get("REDIS_PORT", "6379"))),
        decode_responses=False,
    )

    cfg = PlcResultV2Config.load(io_redis, plugin_name="plc-result-v2", instance=cell)
    logger.info("loaded cfg for cell=%s plc_key=%s tryout=%s cycle=%dms",
                cell, cfg.plc_key, cfg.tryout, cfg.cycle_period_ms)

    bus = PLCBus(
        plc_key=cfg.plc_key,
        redis_client=io_redis,
        lane_range=tuple(int(p) for p in os.environ.get("LANE_RANGE", "32-47").split("-")),
    )
    runner = Runner(cfg, bus, app_redis)
    logger.info("entering run_forever() period=%dms", cfg.cycle_period_ms)
    runner.run_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Create Dockerfile**

Create `plc-result-v2.Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# OS deps (none beyond base — pure Python plugin)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml plc-result-v2.req ./
COPY plc_result_v2/ plc_result_v2/

# Install. We pull strokmatic-comm-sdk from git over SSH; in the build
# environment the SSH key must be mounted via BuildKit secrets or the SDK
# must be available at a local index.
RUN pip install --no-cache-dir -e .

ENV LANE_RANGE=32-47
# CELL must be supplied at run time
ENTRYPOINT ["python", "-m", "plc_result_v2"]
```

- [ ] **Step 3: Create docker-compose**

Create `plc-result-v2.yml`:

```yaml
version: "3.8"

services:
  plc-result-v2:
    image: ${REGISTRY:-strokmatic}/plc-result-v2:${TAG:-latest}
    build:
      context: .
      dockerfile: plc-result-v2.Dockerfile
    environment:
      CELL: ${CELL}                     # e.g. BSL01
      LANE_RANGE: "32-47"
      REDIS_HOST: ${REDIS_HOST}         # IO bus Redis (same instance as strokmatic-eip)
      REDIS_PORT: ${REDIS_PORT:-6379}
      REDIS_APP_HOST: ${REDIS_APP_HOST} # application-coordination Redis (where get-result lives)
      REDIS_APP_PORT: ${REDIS_APP_PORT:-6379}
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
    restart: unless-stopped
    depends_on: []
```

- [ ] **Step 4: Create README**

Create `README.md`:

````markdown
# plc-result-v2

SDK-based replacement for the legacy SpotFusion `plc-result` service.

This plugin sits behind the ODVA-certified `strokmatic-eip` C adapter and
owns byte lane **32–47** of the I/O assembly. It preserves the v1 handshake
bit-for-bit: same coordination with the separate `get-result` service over
Redis, same TRYOUT mode, same fault-reset pass-through.

## Architecture

See `docs/superpowers/specs/2026-05-08-plc-result-v2-design.md` in the
JARVIS orchestrator repo for the full design. Short version:

```
PLC ←→ strokmatic-eip (C) ←→ Redis io:in/out ←→ plc-result-v2 (this) ←→ Redis (app) ←→ get-result service
```

## Configuration

Plugin reads its config from `cfg:plc-result-v2:<CELL>` (JSON, Pydantic-validated).
Use the `plc-comm-ops` UI to edit live; never `redis.SET` directly.

## Running

```bash
CELL=BSL01 REDIS_HOST=10.0.0.5 REDIS_APP_HOST=10.0.0.6 \
  docker compose -f plc-result-v2.yml up -d
```

## Status

`status:plc-result-v2:<CELL>` — hash with `last_beat_ms`, `last_cycle_us`,
`state`, `result_count`, `tryout_count`, `error_count`, `last_error`.

## Migrating from v1

The v1 service (`main` branch) is frozen except for critical fixes once v2
ships. v2 deployments replace v1 on a cell-by-cell basis; no parallel run
required after lab parity is green.

See the spec for the parity-test methodology.
````

- [ ] **Step 5: Smoke-test the entry point**

```bash
cd /home/teruel/worktrees/plc-result-v2
source .venv/bin/activate
# Pre-seed cfg
python -c "
import redis
from plc_result_v2.config import PlcResultV2Config
r = redis.Redis()
cfg = PlcResultV2Config(plc_key='127.0.0.1', cell='TEST',
    redis_app_host='localhost',
    get_result_key='127.0.0.1_GET_RESULT',
    get_result_confirm_key='127.0.0.1_GET_RESULT_CONFIRM',
    returned_result_key='127.0.0.1_RETURNED_RESULT')
cfg.save(r, 'plc-result-v2', 'TEST', 'smoke')
"
# Run for 2 seconds then SIGINT
CELL=TEST timeout 2 python -m plc_result_v2 || true
# Check status
redis-cli HGETALL status:plc-result-v2:TEST | head -20
```

Expected: status hash populated with `last_beat_ms`, `state=IDLE`, `cycle_period_ms=50`.

- [ ] **Step 6: Create cloudbuild.yaml**

Create `cloudbuild.yaml` (mirrors v1's GCP build with the new image name):

```yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --tag=gcr.io/$PROJECT_ID/plc-result-v2:$SHORT_SHA
      - --tag=gcr.io/$PROJECT_ID/plc-result-v2:latest
      - --file=plc-result-v2.Dockerfile
      - .
  - name: gcr.io/cloud-builders/docker
    args: [push, gcr.io/$PROJECT_ID/plc-result-v2:$SHORT_SHA]
  - name: gcr.io/cloud-builders/docker
    args: [push, gcr.io/$PROJECT_ID/plc-result-v2:latest]

options:
  logging: CLOUD_LOGGING_ONLY
```

- [ ] **Step 7: Commit**

```bash
git add plc_result_v2/__main__.py plc-result-v2.Dockerfile plc-result-v2.yml cloudbuild.yaml README.md
git commit -m "feat(v2): entry point + Dockerfile + compose + cloudbuild + README"
```

---

### Task 9: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [v2/sdk-based, main, master, develop]
  pull_request:
    branches: [main, master, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7
        ports: ["6379:6379"]
        options: --health-cmd "redis-cli ping" --health-interval 5s --health-timeout 3s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install (with SDK access)
        env:
          SDK_SSH_KEY: ${{ secrets.STROKMATIC_COMM_SDK_DEPLOY_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$SDK_SSH_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan github.com >> ~/.ssh/known_hosts
          pip install -e ".[dev]"
      - name: Run tests
        env:
          REDIS_HOST: localhost
          REDIS_PORT: "6379"
        run: pytest tests/v2/ -v --tb=short
```

- [ ] **Step 2: Document the secret requirement**

Add a note to README.md about the deploy key. Append this section to README.md:

```markdown

## CI deploy key

CI fetches `strokmatic-comm-sdk` over SSH (private repo). The workflow
requires repo secret `STROKMATIC_COMM_SDK_DEPLOY_KEY` to be set to a
read-only deploy key configured on the SDK repo. Without this, the install
step fails with `Permission denied (publickey)`.
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: pytest workflow with SDK deploy-key secret"
```

---

### Task 10: Cycle-period stability sweep (lab acceptance scaffolding)

**Files:**
- Create: `tests/v2/test_cycle_period_sweep.py`

This test is marked `@pytest.mark.lab` and **not** run by default CI (the runtime is several minutes); it's invoked manually as part of the lab acceptance phase per spec §9.4.

- [ ] **Step 1: Configure pytest to recognize the lab marker**

Edit `pyproject.toml`, add to `[tool.pytest.ini_options]`:

```toml
markers = [
    "lab: tests intended for lab acceptance, not default CI run",
]
addopts = "-m 'not lab'"
```

- [ ] **Step 2: Write the sweep test**

Create `tests/v2/test_cycle_period_sweep.py`:

```python
"""Cycle-period stability sweep — spec §9.4.

Drives 200 synthetic handshake cycles at each of {10, 25, 50, 100, 250} ms
cycle periods. Asserts:
  - PLC never sees a missed handshake step (every WAITING_RESULT eventually
    transitions to WROTE_RESULT when the fake get-result confirms)
  - status.last_cycle_us stays at < 25 % of the configured period
  - error_count stays at 0
  - result_count matches the number of complete handshakes driven

Run with: pytest tests/v2/test_cycle_period_sweep.py -v -m lab
"""

import time

import pytest

from plc_result_v2.config import PlcResultV2Config
from plc_result_v2.runner import Runner


pytestmark = pytest.mark.lab


@pytest.mark.parametrize("period_ms", [10, 25, 50, 100, 250])
def test_handshake_stable_at_period(fake_bus, redis_client, period_ms):
    cfg = PlcResultV2Config(
        plc_key="192.168.15.10", cell="SWEEP",
        redis_app_host="localhost",
        get_result_key="192.168.15.10_GET_RESULT",
        get_result_confirm_key="192.168.15.10_GET_RESULT_CONFIRM",
        returned_result_key="192.168.15.10_RETURNED_RESULT",
        cycle_period_ms=period_ms,
    )
    runner = Runner(cfg, fake_bus, redis_client)

    # Drive 50 complete handshakes; each takes ~5 cycles
    expected_results = 50
    for handshake in range(expected_results):
        # Cycle 1: PLC raises request
        fake_bus.set_input(cfg.io_map.request_result_off, b"\x01")
        runner.run_one_cycle()
        time.sleep(period_ms / 1000.0)
        # Cycle 2: → WAITING
        runner.run_one_cycle()
        time.sleep(period_ms / 1000.0)
        # Cycle 3: get-result confirms
        redis_client.set(cfg.get_result_confirm_key, "1")
        redis_client.set(cfg.returned_result_key, str(handshake + 1))
        runner.run_one_cycle()
        time.sleep(period_ms / 1000.0)
        # Cycle 4: PLC acks
        fake_bus.set_input(cfg.io_map.result_write_comp_plc_off, b"\x01")
        runner.run_one_cycle()
        time.sleep(period_ms / 1000.0)
        # Cycle 5: PLC drops request
        fake_bus.set_input(cfg.io_map.request_result_off, b"\x00")
        fake_bus.set_input(cfg.io_map.result_write_comp_plc_off, b"\x00")
        runner.run_one_cycle()
        time.sleep(period_ms / 1000.0)

    h = redis_client.hgetall(f"status:plc-result-v2:{cfg.cell}")
    assert int(h[b"result_count"]) == expected_results, (
        f"expected {expected_results} result writes at {period_ms}ms; got {int(h[b'result_count'])}"
    )
    assert int(h.get(b"error_count", b"0")) == 0
    # Loop body must comfortably fit in cycle period
    last_cycle_us = int(h[b"last_cycle_us"])
    budget_us = period_ms * 1000 // 4
    assert last_cycle_us < budget_us, (
        f"last_cycle_us={last_cycle_us} exceeds 25 % budget {budget_us} at period {period_ms}ms"
    )
```

- [ ] **Step 3: Run the sweep locally to confirm it passes**

```bash
cd /home/teruel/worktrees/plc-result-v2
source .venv/bin/activate
pytest tests/v2/test_cycle_period_sweep.py -v -m lab
```

Expected: 5 parametrized cases PASS (~30 s total runtime).

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml tests/v2/test_cycle_period_sweep.py
git commit -m "test(v2): cycle-period stability sweep (10/25/50/100/250ms) — lab marker"
```

---

### Task 11: Parity test harness scaffolding

**Files:**
- Create: `tests/v2/test_parity.py`
- Create: `tests/v2/fixtures/parity_replay.jsonl` (placeholder)

The actual recorded scenarios will be captured in the lab when a v1 deployment is available; this task creates the harness so that step is mechanical.

- [ ] **Step 1: Create the parity replay fixture format**

Create `tests/v2/fixtures/parity_replay.jsonl`:

```jsonl
{"_doc": "JSONL of recorded v1 cycles. Each line:"}
{"_doc": "  ts_ms (int), in_state (dict of in-lane fields), get_result_confirm (0/1), returned_result (int), expected_out (dict of out-lane fields), expected_actions (list of action names)"}
{"_doc": "Capture procedure documented in tests/v2/PARITY_CAPTURE.md. Lines will be appended from a v1 deployment recording before the lab acceptance gate runs."}
```

- [ ] **Step 2: Write the parity harness**

Create `tests/v2/test_parity.py`:

```python
"""Bit-for-bit parity gate — spec §9.3.

Replays a recorded sequence of v1 plc-result cycles and asserts v2 produces
identical output bytes and the same get-result coordination actions.

The recorded sequence is in tests/v2/fixtures/parity_replay.jsonl. Until a
real recording is captured in the lab, the file contains only comments and
this test is skipped.

Run with: pytest tests/v2/test_parity.py -v -m lab
"""

import json
from pathlib import Path

import pytest

from plc_result_v2.config import PlcResultV2Config
from plc_result_v2.lane import InLane
from plc_result_v2.state_machine import State, initial_state, step


pytestmark = pytest.mark.lab


FIXTURE = Path(__file__).parent / "fixtures" / "parity_replay.jsonl"


def _load_cycles():
    cycles = []
    for line in FIXTURE.read_text().splitlines():
        if not line.strip() or line.startswith("{\"_doc"):
            continue
        cycles.append(json.loads(line))
    return cycles


def test_parity_replay_matches_v1():
    cycles = _load_cycles()
    if not cycles:
        pytest.skip("no recorded parity cycles yet — capture from a live v1 deployment first")

    cfg = PlcResultV2Config(
        plc_key="192.168.15.10", cell="PARITY",
        redis_app_host="localhost",
        get_result_key="192.168.15.10_GET_RESULT",
        get_result_confirm_key="192.168.15.10_GET_RESULT_CONFIRM",
        returned_result_key="192.168.15.10_RETURNED_RESULT",
    )

    state = initial_state()
    for i, c in enumerate(cycles):
        in_lane = InLane(**c["in_state"])
        r = step(
            in_lane,
            state,
            cfg,
            get_result_confirmed=bool(c["get_result_confirm"]),
            returned_result=int(c["returned_result"]),
        )
        # Field-by-field compare against the v1-recorded expected_out
        for field, expected in c["expected_out"].items():
            actual = getattr(r.out, field)
            assert actual == expected, (
                f"cycle {i} field {field}: v2={actual} vs v1={expected}"
            )
        actual_actions = [a.name for a in r.actions]
        assert actual_actions == c["expected_actions"], (
            f"cycle {i} actions: v2={actual_actions} vs v1={c['expected_actions']}"
        )
        state = r.next_state
```

- [ ] **Step 3: Document the capture procedure**

Create `tests/v2/PARITY_CAPTURE.md`:

````markdown
# Parity replay capture procedure

This document describes how to populate `tests/v2/fixtures/parity_replay.jsonl`
from a live v1 deployment for the bit-for-bit parity gate (spec §9.3).

## What we need per cycle

```json
{
  "ts_ms": 1715000000000,
  "in_state": {
    "request_result": true,
    "result_write_comp_plc": false,
    "fault_reset_extend": false
  },
  "get_result_confirm": 0,
  "returned_result": 0,
  "expected_out": {
    "result": 0,
    "result_write_comp_dev": false,
    "in_cycle": true,
    "fault_reset": false
  },
  "expected_actions": ["SET_GET_RESULT_1"]
}
```

## Capture strategy

Instrument the v1 `plc-result.py` `RUN()` method to log, per iteration:
- the values it reads from Redis (`TAG_REQUEST_RESULT_P`, `TAG_RESULT_WRITE_COMP_P`, `TAG_FAULT_RESET_EXTEND_P`, `<IP>_GET_RESULT_CONFIRM`, `<IP>_RETURNED_RESULT`)
- the values it writes (PLC.WRITE arg pairs + Redis SET operations)

Run for ≥1 hour against a live cell that processes ≥50 parts.

Convert the logs to the JSONL format above.

## Acceptance gate

`pytest tests/v2/test_parity.py -m lab` must produce zero failures. A single
divergent byte or missing action fails the gate.
````

- [ ] **Step 4: Commit**

```bash
git add tests/v2/test_parity.py tests/v2/fixtures/parity_replay.jsonl tests/v2/PARITY_CAPTURE.md
git commit -m "test(v2): parity replay harness + capture procedure (lab marker)"
```

---

### Task 12: Push branch + open draft PR

**Files:** none new — this is a git/GitHub-side task.

- [ ] **Step 1: Verify the test suite is green**

```bash
cd /home/teruel/worktrees/plc-result-v2
source .venv/bin/activate
pytest tests/v2/ -v
```

Expected: all non-lab tests PASS.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin v2/sdk-based
```

- [ ] **Step 3: Open draft PR**

```bash
gh pr create --draft --title "plc-result-v2: SDK-based replacement for legacy pylogix path" --body "$(cat <<'EOF'
## Summary

Replaces the legacy pylogix Class 1 `plc-result.py` with an SDK-based plugin
that sits behind the certified `strokmatic-eip` C adapter and owns byte
lane 32–47 of the I/O assembly. Strict behavioral parity with v1.

See `docs/superpowers/specs/2026-05-08-plc-result-v2-design.md` (JARVIS repo)
for the full design.

## Acceptance gates

- [ ] Unit + integration tests green (this PR)
- [ ] Cycle-period stability sweep at 10/25/50/100/250 ms (run `pytest -m lab` locally before merging)
- [ ] Bit-for-bit parity against v1 on a recorded tag stream — captured in lab, see `tests/v2/PARITY_CAPTURE.md`

## Out of scope

- Changes to the `get-result` service
- Changes to the PLC-side ladder
- Multi-PLC support
- Telemetry beyond status + audit

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 4: Confirm CI is running**

```bash
gh pr checks --watch
```

Expected: CI status visible (may take ~3 min); pytest job should PASS.

---

## Summary

12 tasks total. Module-by-module TDD (no implementation without a failing test). Each task is one logical unit and ends in a commit. Final task (12) leaves a draft PR open with the lab-gated items (cycle-period sweep, parity replay) explicitly listed as acceptance gates that ship before merge-to-main.

The lab work is deliberately scaffolded but not run in CI:
- Task 10 — cycle-period stability sweep (`-m lab`)
- Task 11 — parity replay (`-m lab`, fixture empty until capture)

CI runs only the default-marker tests on every push.

---

## Test plan

- **Default CI**: `pytest tests/v2/` (lab tests skipped) — runs on every push/PR
- **Pre-merge lab**: `pytest tests/v2/ -m lab` after capturing parity fixture from a live v1 cell
- **Post-merge in production**: blue-green migrate one cell at a time; keep v1 image available for instant rollback for the first 30 days

---

## Out of scope

Per spec §12:
- Replacing the `get-result` service
- Changing the PLC-side ladder logic
- Multi-PLC support per container
- Configurable lane size > 16 bytes
- Built-in test PLC
- Telemetry beyond status hash + audit stream
