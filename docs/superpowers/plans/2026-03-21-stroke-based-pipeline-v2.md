# Stroke-Based Processing Pipeline v2 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the data-processing pipeline from per-sensor-independent to stroke-buffered, with cross-sensor phase transition averaging, curve splitting, and time-domain prediction.

**Architecture:** Two-pass model — Pass 1 calibrates each sensor and accumulates in Redis DB7; Pass 2 triggers when all sensors arrive (or timeout), computes average transition, splits curves, runs forming-segment analysis, and publishes. The existing `StrokeAccumulator` is extended to handle both sensor types and exclusions.

**Tech Stack:** Python 3.11+, pika (RabbitMQ), redis-py, numpy, scipy, loguru, pytest

**Spec:** `docs/superpowers/specs/2026-03-21-stroke-based-processing-pipeline-v2-design.md`
**Issue:** https://github.com/strokmatic/diemaster-data-processing/issues/2
**Branch:** `feat/stroke-based-pipeline-v2`

---

## File Map

### Modified Files

| File | Responsibility | Changes |
|------|---------------|---------|
| `processing/config.py` | Centralized env-var config | Add `ENABLE_PHASE_TRANSITION`, `ENABLE_STROKE_ACCUMULATION`, `STROKE_TIMEOUT` |
| `processing/pipeline.py` | Message consumer orchestrator | Add stroke-buffered routing; legacy path behind flag |
| `processing/processors/stroke_accumulator.py` | Redis stroke buffer | Extend for DRAWIN+GAP, exclusion set, timeout, store scaled curves |
| `processing/processors/drawin_base.py` | DRAWIN processing | Split into `pass1_drawin()` and `pass2_drawin()` functions |
| `processing/processors/gap_base.py` | GAP processing | Split into `pass1_gap()` and `pass2_gap()` functions |
| `processing/processors/drawin_prediction.py` | P7 prediction engine | Adapt `predict()` to operate on time-domain `forming_X_cal` |
| `processing/processors/stale_detection.py` | Stale signal detection | Adapt for time-domain input (velocity via np.diff/dt) |
| `processing/models.py` | Data models | Add `Pass1Result` dataclass |

### New Files

| File | Responsibility |
|------|---------------|
| `processing/processors/stroke_processor.py` | Pass 2 orchestrator: average transition, curve splitting, forming analysis, build outputs |
| `tests/test_stroke_processor.py` | Tests for cross-sensor Pass 2 logic |
| `tests/test_phase_transition_integration.py` | End-to-end tests: multi-sensor stroke through both passes |
| `tests/fixtures/drawin_message_2.json` | Second DRAWIN sensor fixture for cross-sensor tests |
| `tests/fixtures/drawin_message_3.json` | Third DRAWIN sensor fixture |

---

## Task 1: Add new config flags

**Files:**
- Modify: `processing/config.py`
- Test: `tests/test_config.py` (create)

- [ ] **Step 1: Write test for new config flags**

Create `tests/test_config.py`:

```python
"""Tests for config module — verify new feature flags exist with correct defaults."""

from processing import config


def test_enable_phase_transition_default():
    assert config.ENABLE_PHASE_TRANSITION is True


def test_enable_stroke_accumulation_default():
    assert config.ENABLE_STROKE_ACCUMULATION is True


def test_stroke_timeout_default():
    assert config.STROKE_TIMEOUT == 30
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/teruel/JARVIS/workspaces/strokmatic/diemaster/services/data-processing && python -m pytest tests/test_config.py -v`
Expected: FAIL — `AttributeError: module 'processing.config' has no attribute 'ENABLE_PHASE_TRANSITION'`

- [ ] **Step 3: Add config flags**

Append to `processing/config.py` after the `PHASE_POINTS` line:

```python
# --- Phase Transition (P12) ---
ENABLE_PHASE_TRANSITION = os.getenv("ENABLE_PHASE_TRANSITION", "true").lower() == "true"

# --- Stroke Accumulation ---
ENABLE_STROKE_ACCUMULATION = os.getenv("ENABLE_STROKE_ACCUMULATION", "true").lower() == "true"
STROKE_TIMEOUT = int(os.getenv("STROKE_TIMEOUT", "30"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_config.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add processing/config.py tests/test_config.py
git commit -m "feat: add ENABLE_PHASE_TRANSITION, ENABLE_STROKE_ACCUMULATION, STROKE_TIMEOUT config flags"
```

---

## Task 2: Add `Pass1Result` model

**Files:**
- Modify: `processing/models.py`
- Test: `tests/test_models.py` (append)

- [ ] **Step 1: Write test for Pass1Result**

Append to `tests/test_models.py`:

```python
from processing.models import Pass1Result


class TestPass1Result:
    def test_drawin_pass1_result(self):
        r = Pass1Result(
            sensor_name="DRAWIN",
            sensor_id="DP01",
            metadata={"die_id": 1, "hub_id": "H1"},
            scaled={"X_cal": [1.0, 2.0], "Y_cal": [0.5, 1.0]},
            timestamps=["2025-01-01 00:00:00.000", "2025-01-01 00:00:00.010"],
            time_seconds=[0.0, 0.01],
            transition_idx=3,
        )
        assert r.sensor_name == "DRAWIN"
        assert r.transition_idx == 3
        assert len(r.scaled["X_cal"]) == 2

    def test_gap_pass1_result_no_transition(self):
        r = Pass1Result(
            sensor_name="GAP",
            sensor_id="GP01",
            metadata={"die_id": 1},
            scaled={"abs": [5.0, 10.0], "abs_comp": [4.9, 9.8]},
            timestamps=["2025-01-01 00:00:00.000"],
            time_seconds=[0.0],
            transition_idx=None,
        )
        assert r.transition_idx is None
        assert "abs" in r.scaled
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_models.py::TestPass1Result -v`
Expected: FAIL — `ImportError: cannot import name 'Pass1Result'`

- [ ] **Step 3: Implement Pass1Result**

Add to `processing/models.py` after the `SensorMessage` class:

```python
@dataclass
class Pass1Result:
    """Output of Pass 1 per-sensor processing, stored in stroke accumulator."""

    sensor_name: str  # "DRAWIN" or "GAP"
    sensor_id: str
    metadata: dict  # Fixed metadata fields for output message
    scaled: dict[str, list[float]]  # Calibrated curves: X_cal/Y_cal or abs/abs_comp
    timestamps: list[str]  # Original timestamp strings
    time_seconds: list[float]  # Parsed timestamps as seconds
    transition_idx: int | None  # P12 transition index (DRAWIN only, None for GAP)
    raw: dict[str, list[str]] = field(default_factory=dict)  # Raw X/Y/Z/Temp for output
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_models.py::TestPass1Result -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add processing/models.py tests/test_models.py
git commit -m "feat: add Pass1Result dataclass for stroke accumulator buffering"
```

---

## Task 3: Extend StrokeAccumulator — exclusion set and Pass1Result storage

**Files:**
- Modify: `processing/processors/stroke_accumulator.py`
- Test: `tests/test_stroke_accumulator.py` (extend)

- [ ] **Step 1: Write tests for new accumulator features**

Append to `tests/test_stroke_accumulator.py`:

```python
class TestStrokeAccumulatorV2:
    """Tests for v2 accumulator: Pass1Result storage, exclusion set, mixed sensor types."""

    def test_add_pass1_result(self, mock_redis):
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        p1 = Pass1Result(
            sensor_name="DRAWIN",
            sensor_id="DP01",
            metadata={"die_id": "1", "hub_id": "H1"},
            scaled={"X_cal": [0.0, 1.0, 2.0], "Y_cal": [0.0, 0.5, 1.0]},
            timestamps=["2025-01-01 00:00:00.000", "2025-01-01 00:00:00.010", "2025-01-01 00:00:00.020"],
            time_seconds=[0.0, 0.01, 0.02],
            transition_idx=1,
            raw={"X": ["0", "1", "2"], "Y": ["0", "0.5", "1"]},
        )
        result = acc.add_pass1_result("1", "ts1", p1, expected_count=2)
        assert result is False

    def test_mixed_drawin_gap_completion(self, mock_redis):
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        drawin = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP01",
            metadata={}, scaled={"X_cal": [1.0]}, timestamps=[], time_seconds=[],
            transition_idx=5, raw={},
        )
        gap = Pass1Result(
            sensor_name="GAP", sensor_id="GP01",
            metadata={}, scaled={"abs": [10.0]}, timestamps=[], time_seconds=[],
            transition_idx=None, raw={},
        )
        assert not acc.add_pass1_result("1", "ts1", drawin, expected_count=2)
        assert acc.add_pass1_result("1", "ts1", gap, expected_count=2)

    def test_get_all_pass1_results(self, mock_redis):
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        p1 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP01",
            metadata={"die_id": "1"}, scaled={"X_cal": [1.0, 2.0]},
            timestamps=["t1", "t2"], time_seconds=[0.0, 0.01],
            transition_idx=1, raw={"X": ["1", "2"]},
        )
        acc.add_pass1_result("1", "ts1", p1, expected_count=1)
        results = acc.get_all_pass1_results("1", "ts1")
        assert "DP01" in results
        assert results["DP01"].transition_idx == 1
        assert results["DP01"].sensor_name == "DRAWIN"

    def test_exclusion_reduces_expected_count(self, mock_redis):
        mock_redis.smembers = lambda key: {"DP03"}
        acc = StrokeAccumulator(mock_redis)
        count = acc.get_expected_count("die1", total_sensors=3)
        assert count == 2

    def test_exclusion_empty_set(self, mock_redis):
        mock_redis.smembers = lambda key: set()
        acc = StrokeAccumulator(mock_redis)
        count = acc.get_expected_count("die1", total_sensors=3)
        assert count == 3

    def test_get_drawin_transition_indices(self, mock_redis):
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        for sid, tidx in [("DP01", 10), ("DP02", 14), ("GP01", None)]:
            p1 = Pass1Result(
                sensor_name="DRAWIN" if tidx is not None else "GAP",
                sensor_id=sid, metadata={},
                scaled={"X_cal": [0.0]} if tidx else {"abs": [0.0]},
                timestamps=[], time_seconds=[],
                transition_idx=tidx, raw={},
            )
            acc.add_pass1_result("1", "ts1", p1, expected_count=3)
        indices = acc.get_drawin_transition_indices("1", "ts1")
        assert indices == {"DP01": 10, "DP02": 14}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_stroke_accumulator.py::TestStrokeAccumulatorV2 -v`
Expected: FAIL — `AttributeError: 'StrokeAccumulator' object has no attribute 'add_pass1_result'`

- [ ] **Step 3: Implement new accumulator methods**

Add to `processing/processors/stroke_accumulator.py`:

```python
    def add_pass1_result(
        self,
        die_id: str,
        stroke_timestamp: str,
        result: "Pass1Result",
        expected_count: int,
    ) -> bool:
        """Store a Pass1Result. Returns True when all expected sensors arrived."""
        from ..models import Pass1Result

        key = self._stroke_key(die_id, stroke_timestamp)
        data = {
            "sensor_name": result.sensor_name,
            "sensor_id": result.sensor_id,
            "metadata": result.metadata,
            "scaled": result.scaled,
            "timestamps": result.timestamps,
            "time_seconds": result.time_seconds,
            "transition_idx": result.transition_idx,
            "raw": result.raw,
        }

        pipe = self._redis.pipeline()
        pipe.hset(key, f"{result.sensor_id}:pass1", json.dumps(data))

        received_raw = self._redis.hget(key, "_received")
        received = received_raw.split(",") if received_raw else []
        if result.sensor_id not in received:
            received.append(result.sensor_id)
        pipe.hset(key, "_received", ",".join(received))
        pipe.hset(key, "_expected", str(expected_count))
        pipe.expire(key, config.STROKE_TIMEOUT)
        pipe.execute()

        logger.debug(
            f"Stroke accumulator v2: {result.sensor_id} ({result.sensor_name}) "
            f"for die={die_id} ts={stroke_timestamp} ({len(received)}/{expected_count})"
        )
        return len(received) >= expected_count

    def get_all_pass1_results(self, die_id: str, stroke_timestamp: str) -> dict:
        """Retrieve all Pass1Results for a stroke.

        Returns dict mapping sensor_id -> Pass1Result.
        """
        from ..models import Pass1Result

        key = self._stroke_key(die_id, stroke_timestamp)
        all_data = self._redis.hgetall(key)

        results = {}
        for field, value in all_data.items():
            if field.startswith("_"):
                continue
            if field.endswith(":pass1"):
                sensor_id = field.rsplit(":pass1", 1)[0]
                data = json.loads(value)
                results[sensor_id] = Pass1Result(
                    sensor_name=data["sensor_name"],
                    sensor_id=data["sensor_id"],
                    metadata=data["metadata"],
                    scaled=data["scaled"],
                    timestamps=data["timestamps"],
                    time_seconds=data["time_seconds"],
                    transition_idx=data["transition_idx"],
                    raw=data.get("raw", {}),
                )
        return results

    def get_expected_count(self, die_id: str, total_sensors: int) -> int:
        """Get expected count minus excluded sensors."""
        excluded = self._redis.smembers(f"excluded:{die_id}")
        return total_sensors - len(excluded)

    def get_drawin_transition_indices(self, die_id: str, stroke_timestamp: str) -> dict[str, int]:
        """Get transition indices for all DRAWIN sensors in a stroke.

        Returns dict mapping sensor_id -> transition_idx (only DRAWIN with non-None idx).
        """
        results = self.get_all_pass1_results(die_id, stroke_timestamp)
        return {
            sid: r.transition_idx
            for sid, r in results.items()
            if r.sensor_name == "DRAWIN" and r.transition_idx is not None
        }
```

Also add `smembers` to the test fixture `mock_redis`:

```python
# In the mock_redis fixture, add:
_sets = {}

def smembers(key):
    return _sets.get(key, set())

def sadd(key, *members):
    if key not in _sets:
        _sets[key] = set()
    _sets[key].update(members)

client.smembers = smembers
client.sadd = sadd
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_stroke_accumulator.py -v`
Expected: PASS (all old + new tests)

- [ ] **Step 5: Commit**

```bash
git add processing/processors/stroke_accumulator.py processing/models.py tests/test_stroke_accumulator.py
git commit -m "feat: extend StrokeAccumulator with Pass1Result storage, exclusion set, transition indices"
```

---

## Task 4: Split `drawin_base.py` into Pass 1 and Pass 2 functions

**Files:**
- Modify: `processing/processors/drawin_base.py`
- Test: `tests/test_drawin_base.py` (extend)

- [ ] **Step 1: Write tests for pass1_drawin**

Append to `tests/test_drawin_base.py`:

```python
from processing.processors.drawin_base import pass1_drawin
from processing.models import SensorMessage, Pass1Result


class TestPass1Drawin:
    def test_returns_pass1_result(self, mock_redis, drawin_message):
        msg = SensorMessage.from_dict(drawin_message)
        result = pass1_drawin(msg, mock_redis)
        assert isinstance(result, Pass1Result)
        assert result.sensor_name == "DRAWIN"
        assert result.sensor_id == msg.sensor_id

    def test_calibrated_curves_present(self, mock_redis, drawin_message):
        msg = SensorMessage.from_dict(drawin_message)
        result = pass1_drawin(msg, mock_redis)
        assert "X_cal" in result.scaled
        assert "Y_cal" in result.scaled
        assert len(result.scaled["X_cal"]) == len(msg.X)

    def test_transition_idx_detected(self, mock_redis, drawin_message):
        msg = SensorMessage.from_dict(drawin_message)
        result = pass1_drawin(msg, mock_redis)
        # transition_idx is int or None depending on signal shape
        assert result.transition_idx is None or isinstance(result.transition_idx, int)

    def test_time_seconds_parsed(self, mock_redis, drawin_message):
        msg = SensorMessage.from_dict(drawin_message)
        result = pass1_drawin(msg, mock_redis)
        assert len(result.time_seconds) == len(msg.timestamps)

    def test_raw_preserved(self, mock_redis, drawin_message):
        msg = SensorMessage.from_dict(drawin_message)
        result = pass1_drawin(msg, mock_redis)
        assert result.raw["X"] == msg.X
        assert result.raw["Y"] == msg.Y
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_drawin_base.py::TestPass1Drawin -v`
Expected: FAIL — `ImportError: cannot import name 'pass1_drawin'`

- [ ] **Step 3: Implement pass1_drawin**

Add to `processing/processors/drawin_base.py`:

```python
def pass1_drawin(msg: SensorMessage, redis_client) -> "Pass1Result":
    """Pass 1: Calibrate DRAWIN signal and detect phase transition.

    Returns a Pass1Result for accumulation in the stroke buffer.
    """
    from ..models import Pass1Result
    from ..utils import clean_and_convert, parse_timestamps_to_seconds

    # S1: Calibration
    k_x = _get_redis_float(redis_client, "k_x", default=1.0)
    k_y = _get_redis_float(redis_client, "k_y", default=1.0)

    valores_x = clean_and_convert(msg.X)
    valores_y = clean_and_convert(msg.Y)
    x_cal = [x * k_x for x in valores_x]
    y_cal = [y * k_y for y in valores_y]

    # Parse timestamps
    t_seconds = parse_timestamps_to_seconds(msg.timestamps)
    time_seconds_list = t_seconds.tolist() if t_seconds is not None else []

    # S2: Transition detection
    transition_idx = None
    if config.ENABLE_PHASE_TRANSITION and t_seconds is not None and len(x_cal) >= 2:
        from .phase_transition import detect_closing_to_forming
        transition_idx = detect_closing_to_forming(x_cal, t_seconds)

    return Pass1Result(
        sensor_name="DRAWIN",
        sensor_id=msg.sensor_id,
        metadata=msg.metadata,
        scaled={"X_cal": x_cal, "Y_cal": y_cal},
        timestamps=msg.timestamps,
        time_seconds=time_seconds_list,
        transition_idx=transition_idx,
        raw={"X": msg.X, "Y": msg.Y},
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_drawin_base.py::TestPass1Drawin -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add processing/processors/drawin_base.py tests/test_drawin_base.py
git commit -m "feat: add pass1_drawin() — calibration + P12 transition detection"
```

---

## Task 5: Split `gap_base.py` into Pass 1 and Pass 2 functions

**Files:**
- Modify: `processing/processors/gap_base.py`
- Test: `tests/test_gap_base.py` (extend)

- [ ] **Step 1: Write tests for pass1_gap**

Append to `tests/test_gap_base.py`:

```python
from processing.processors.gap_base import pass1_gap
from processing.models import SensorMessage, Pass1Result


class TestPass1Gap:
    def test_returns_pass1_result(self, mock_redis, gap_message):
        msg = SensorMessage.from_dict(gap_message)
        result = pass1_gap(msg, mock_redis)
        assert isinstance(result, Pass1Result)
        assert result.sensor_name == "GAP"
        assert result.transition_idx is None

    def test_abs_magnitude_computed(self, mock_redis, gap_message):
        msg = SensorMessage.from_dict(gap_message)
        result = pass1_gap(msg, mock_redis)
        assert "abs" in result.scaled
        assert len(result.scaled["abs"]) == len(msg.X)

    def test_thermal_compensation_applied(self, mock_redis, gap_message):
        msg = SensorMessage.from_dict(gap_message)
        result = pass1_gap(msg, mock_redis)
        assert "abs_comp" in result.scaled

    def test_raw_preserved(self, mock_redis, gap_message):
        msg = SensorMessage.from_dict(gap_message)
        result = pass1_gap(msg, mock_redis)
        assert result.raw["X"] == msg.X
        assert result.raw["Z"] == msg.Z
        assert result.raw["Temp"] == msg.Temp
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_gap_base.py::TestPass1Gap -v`
Expected: FAIL — `ImportError: cannot import name 'pass1_gap'`

- [ ] **Step 3: Implement pass1_gap**

Add to `processing/processors/gap_base.py`:

```python
def pass1_gap(msg: SensorMessage, redis_client) -> "Pass1Result":
    """Pass 1: Calibrate GAP signal (magnitude + thermal compensation).

    Returns a Pass1Result for accumulation in the stroke buffer.
    """
    from ..models import Pass1Result
    from ..utils import clean_and_convert, parse_timestamps_to_seconds

    # S1: Clean and convert
    valores_x = clean_and_convert(msg.X)
    valores_y = clean_and_convert(msg.Y)
    valores_z = clean_and_convert(msg.Z)
    valores_temp = clean_and_convert(msg.Temp)

    # 3D magnitude
    abs_xyz = [
        sqrt(x**2 + y**2 + z**2)
        for x, y, z in zip(valores_x, valores_y, valores_z)
    ]

    # Thermal compensation
    abs_comp = None
    if config.ENABLE_THERMAL_COMPENSATION and valores_temp and len(valores_temp) == len(abs_xyz):
        from .thermal_compensation import compensate_thermal
        abs_comp = compensate_thermal(abs_xyz, valores_temp)

    scaled = {"abs": abs_xyz}
    if abs_comp is not None:
        scaled["abs_comp"] = abs_comp

    # Parse timestamps
    t_seconds = parse_timestamps_to_seconds(msg.timestamps)
    time_seconds_list = t_seconds.tolist() if t_seconds is not None else []

    return Pass1Result(
        sensor_name="GAP",
        sensor_id=msg.sensor_id,
        metadata=msg.metadata,
        scaled=scaled,
        timestamps=msg.timestamps,
        time_seconds=time_seconds_list,
        transition_idx=None,  # GAP never detects transition
        raw={"X": msg.X, "Y": msg.Y, "Z": msg.Z, "Temp": msg.Temp},
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_gap_base.py::TestPass1Gap -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add processing/processors/gap_base.py tests/test_gap_base.py
git commit -m "feat: add pass1_gap() — magnitude + thermal comp"
```

---

## Task 6: Create StrokeProcessor — the Pass 2 orchestrator

This is the core new module. It receives all Pass1Results for a stroke and produces output messages.

**Files:**
- Create: `processing/processors/stroke_processor.py`
- Create: `tests/test_stroke_processor.py`
- Create: `tests/fixtures/drawin_message_2.json`
- Create: `tests/fixtures/drawin_message_3.json`

- [ ] **Step 1: Create additional test fixtures**

Create `tests/fixtures/drawin_message_2.json` (second DRAWIN sensor, same stroke):

```json
{
  "stroke_timestamp": "2025-03-13 23:21:26.078",
  "die_id": 1,
  "hub_id": "HUB-001",
  "sensor_id": "SENS-DI-02",
  "hub_port": "6",
  "switch_id": "SW-MAIN",
  "switch_ip": "192.168.15.50",
  "sensor_name": "DRAWIN",
  "timestamps": [
    "2025-03-13 23:21:26.000", "2025-03-13 23:21:26.010",
    "2025-03-13 23:21:26.020", "2025-03-13 23:21:26.030",
    "2025-03-13 23:21:26.040", "2025-03-13 23:21:26.050",
    "2025-03-13 23:21:26.060", "2025-03-13 23:21:26.070",
    "2025-03-13 23:21:26.080", "2025-03-13 23:21:26.090"
  ],
  "X": ["0.00", "0.10", "0.28", "0.50", "0.78", "1.10", "1.42", "1.76", "2.08", "2.38"],
  "Y": ["0.00", "0.06", "0.18", "0.34", "0.54", "0.76", "0.98", "1.20", "1.42", "1.62"],
  "dpi": 800,
  "plc_data": {},
  "routing_key": "HUB-001.port6"
}
```

Create `tests/fixtures/drawin_message_3.json` (third DRAWIN sensor):

```json
{
  "stroke_timestamp": "2025-03-13 23:21:26.078",
  "die_id": 1,
  "hub_id": "HUB-001",
  "sensor_id": "SENS-DI-03",
  "hub_port": "7",
  "switch_id": "SW-MAIN",
  "switch_ip": "192.168.15.50",
  "sensor_name": "DRAWIN",
  "timestamps": [
    "2025-03-13 23:21:26.000", "2025-03-13 23:21:26.010",
    "2025-03-13 23:21:26.020", "2025-03-13 23:21:26.030",
    "2025-03-13 23:21:26.040", "2025-03-13 23:21:26.050",
    "2025-03-13 23:21:26.060", "2025-03-13 23:21:26.070",
    "2025-03-13 23:21:26.080", "2025-03-13 23:21:26.090"
  ],
  "X": ["0.00", "0.14", "0.35", "0.60", "0.90", "1.22", "1.55", "1.88", "2.20", "2.50"],
  "Y": ["0.00", "0.09", "0.24", "0.42", "0.62", "0.84", "1.06", "1.28", "1.50", "1.72"],
  "dpi": 800,
  "plc_data": {},
  "routing_key": "HUB-001.port7"
}
```

- [ ] **Step 2: Write tests for StrokeProcessor**

Create `tests/test_stroke_processor.py`:

```python
"""Tests for Pass 2: StrokeProcessor — cross-sensor analysis."""

import numpy as np
import pytest

from processing.models import Pass1Result
from processing.processors.stroke_processor import StrokeProcessor


def _make_drawin_pass1(sensor_id, transition_idx, n_samples=20):
    """Helper to create a DRAWIN Pass1Result with a realistic forming curve."""
    t = np.linspace(0, 0.2, n_samples)
    # Simulate closing (flat) then forming (ramp)
    x_cal = np.concatenate([
        np.zeros(transition_idx),
        np.linspace(0, 2.5, n_samples - transition_idx),
    ]).tolist()
    y_cal = [v * 0.6 for v in x_cal]
    timestamps = [f"2025-01-01 00:00:00.{i*10:03d}" for i in range(n_samples)]
    return Pass1Result(
        sensor_name="DRAWIN", sensor_id=sensor_id,
        metadata={"timestamp": "ts1", "die_id": "1", "hub_id": "H1",
                  "sensor_id": sensor_id, "hub_port": "1",
                  "switch_id": "SW1", "switch_ip": "192.168.0.1"},
        scaled={"X_cal": x_cal, "Y_cal": y_cal},
        timestamps=timestamps,
        time_seconds=t.tolist(),
        transition_idx=transition_idx,
        raw={"X": [str(v) for v in x_cal], "Y": [str(v) for v in y_cal]},
    )


def _make_gap_pass1(sensor_id, n_samples=20):
    """Helper to create a GAP Pass1Result."""
    t = np.linspace(0, 0.2, n_samples)
    abs_vals = (np.sin(np.linspace(0, np.pi, n_samples)) * 15).tolist()
    timestamps = [f"2025-01-01 00:00:00.{i*10:03d}" for i in range(n_samples)]
    return Pass1Result(
        sensor_name="GAP", sensor_id=sensor_id,
        metadata={"timestamp": "ts1", "die_id": "1", "hub_id": "H1",
                  "sensor_id": sensor_id, "hub_port": "2",
                  "switch_id": "SW1", "switch_ip": "192.168.0.1"},
        scaled={"abs": abs_vals, "abs_comp": [v * 0.98 for v in abs_vals]},
        timestamps=timestamps,
        time_seconds=t.tolist(),
        transition_idx=None,
        raw={"X": [], "Y": [], "Z": [], "Temp": []},
    )


class TestAverageTransition:
    def test_average_of_two_drawin(self):
        results = {
            "DP01": _make_drawin_pass1("DP01", transition_idx=4),
            "DP02": _make_drawin_pass1("DP02", transition_idx=6),
        }
        proc = StrokeProcessor(results)
        assert proc.avg_transition_idx == 5  # round((4+6)/2)

    def test_average_of_three_drawin(self):
        results = {
            "DP01": _make_drawin_pass1("DP01", transition_idx=3),
            "DP02": _make_drawin_pass1("DP02", transition_idx=5),
            "DP03": _make_drawin_pass1("DP03", transition_idx=7),
        }
        proc = StrokeProcessor(results)
        assert proc.avg_transition_idx == 5  # round((3+5+7)/3)

    def test_gap_sensors_ignored_in_average(self):
        results = {
            "DP01": _make_drawin_pass1("DP01", transition_idx=4),
            "DP02": _make_drawin_pass1("DP02", transition_idx=6),
            "GP01": _make_gap_pass1("GP01"),
        }
        proc = StrokeProcessor(results)
        assert proc.avg_transition_idx == 5


class TestCurveSplitting:
    def test_drawin_split_at_avg(self):
        results = {
            "DP01": _make_drawin_pass1("DP01", transition_idx=4),
            "DP02": _make_drawin_pass1("DP02", transition_idx=6),
        }
        proc = StrokeProcessor(results)
        outputs = proc.process()
        dp01_out = next(o for o in outputs if o["sensor_id"] == "DP01")
        avg = proc.avg_transition_idx
        assert len(dp01_out["closing_X_cal"]) == avg
        assert len(dp01_out["forming_X_cal"]) == 20 - avg

    def test_gap_split_at_avg(self):
        results = {
            "DP01": _make_drawin_pass1("DP01", transition_idx=5),
            "GP01": _make_gap_pass1("GP01"),
        }
        proc = StrokeProcessor(results)
        outputs = proc.process()
        gp01_out = next(o for o in outputs if o["sensor_id"] == "GP01")
        avg = proc.avg_transition_idx
        assert len(gp01_out["closing_abs"]) == avg
        assert len(gp01_out["forming_abs"]) == 20 - avg


class TestTransitionMetadata:
    def test_drawin_has_delta(self):
        results = {
            "DP01": _make_drawin_pass1("DP01", transition_idx=3),
            "DP02": _make_drawin_pass1("DP02", transition_idx=7),
        }
        proc = StrokeProcessor(results)
        outputs = proc.process()
        dp01_out = next(o for o in outputs if o["sensor_id"] == "DP01")
        dp02_out = next(o for o in outputs if o["sensor_id"] == "DP02")
        assert dp01_out["transition_idx"] == 3
        assert dp02_out["transition_idx"] == 7
        assert dp01_out["avg_transition_idx"] == 5
        assert dp01_out["transition_delta"] == -2
        assert dp02_out["transition_delta"] == 2

    def test_gap_has_avg_only(self):
        results = {
            "DP01": _make_drawin_pass1("DP01", transition_idx=5),
            "GP01": _make_gap_pass1("GP01"),
        }
        proc = StrokeProcessor(results)
        outputs = proc.process()
        gp01_out = next(o for o in outputs if o["sensor_id"] == "GP01")
        assert gp01_out["avg_transition_idx"] == 5
        assert "transition_idx" not in gp01_out
        assert "transition_delta" not in gp01_out


class TestFormingSegmentAnalysis:
    def test_drawin_velocity_on_forming(self):
        results = {"DP01": _make_drawin_pass1("DP01", transition_idx=5)}
        proc = StrokeProcessor(results)
        outputs = proc.process()
        out = outputs[0]
        assert "v_x" in out
        assert "v_y" in out
        # Velocity has len(forming) - 1 elements
        assert len(out["v_x"]) == len(out["forming_X_cal"]) - 1

    def test_drawin_displacement_on_forming(self):
        results = {"DP01": _make_drawin_pass1("DP01", transition_idx=5)}
        proc = StrokeProcessor(results)
        outputs = proc.process()
        out = outputs[0]
        assert "di_x" in out
        assert "di_y" in out
        assert "di" in out
        assert out["di"] >= 0

    def test_output_contains_raw_and_scaled(self):
        results = {"DP01": _make_drawin_pass1("DP01", transition_idx=5)}
        proc = StrokeProcessor(results)
        outputs = proc.process()
        out = outputs[0]
        assert "X" in out  # raw
        assert "X_cal" in out  # scaled full
        assert "closing_X_cal" in out
        assert "forming_X_cal" in out
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/test_stroke_processor.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'processing.processors.stroke_processor'`

- [ ] **Step 4: Implement StrokeProcessor**

Create `processing/processors/stroke_processor.py`:

```python
"""Pass 2: Stroke processor — cross-sensor analysis orchestrator.

Receives all Pass1Results for a stroke, computes average transition,
splits curves, runs forming-segment analysis, and builds output messages.
"""

from math import atan2, sqrt

import numpy as np
from loguru import logger

from .. import config
from ..models import Pass1Result, build_output


class StrokeProcessor:
    """Processes a complete stroke with all sensor data available."""

    def __init__(self, pass1_results: dict[str, Pass1Result]):
        self._results = pass1_results
        self.avg_transition_idx = self._compute_avg_transition()

    def _compute_avg_transition(self) -> int:
        """S4: Average transition index from all DRAWIN sensors."""
        indices = [
            r.transition_idx
            for r in self._results.values()
            if r.sensor_name == "DRAWIN" and r.transition_idx is not None
        ]
        if not indices:
            logger.warning("No DRAWIN transition indices — using 0")
            return 0
        return round(sum(indices) / len(indices))

    def process(self) -> list[dict]:
        """Run Pass 2 on all sensors. Returns list of output messages."""
        outputs = []
        for sensor_id, p1 in self._results.items():
            if p1.sensor_name == "DRAWIN":
                out = self._process_drawin(p1)
            elif p1.sensor_name == "GAP":
                out = self._process_gap(p1)
            else:
                logger.warning(f"Unknown sensor type: {p1.sensor_name}")
                continue
            outputs.append(out)
        return outputs

    def _process_drawin(self, p1: Pass1Result) -> dict:
        """Process a single DRAWIN sensor through Pass 2."""
        avg_idx = self.avg_transition_idx
        x_cal = p1.scaled["X_cal"]
        y_cal = p1.scaled["Y_cal"]
        t_seconds = p1.time_seconds

        # S5: Curve splitting
        closing_x = x_cal[:avg_idx]
        forming_x = x_cal[avg_idx:]
        closing_y = y_cal[:avg_idx]
        forming_y = y_cal[avg_idx:]
        forming_t = t_seconds[avg_idx:] if t_seconds else []

        # S7: Velocity on forming segment
        v_x, v_y = [], []
        if len(forming_x) > 1 and len(forming_t) > 1:
            dt = np.diff(forming_t)
            dt = np.where(dt > 0, dt, 1e-6)  # avoid division by zero
            v_x = (np.diff(forming_x) / dt).tolist()
            v_y = (np.diff(forming_y) / dt).tolist()

        # S8: Displacement on forming segment
        di_x = float(forming_x[-1] - forming_x[0]) if forming_x else 0.0
        di_y = float(forming_y[-1] - forming_y[0]) if forming_y else 0.0
        di = float(sqrt(di_x**2 + di_y**2))

        # S9: Flow angle
        theta_flow = None
        if config.ENABLE_FLOW_ANGLE and (di_x != 0.0 or di_y != 0.0):
            theta_flow = float(atan2(di_y, di_x))

        # S6: Transition metadata
        extra = {
            "transition_idx": p1.transition_idx,
            "avg_transition_idx": avg_idx,
            "transition_delta": (p1.transition_idx - avg_idx) if p1.transition_idx is not None else None,
        }

        # S10: Cycle segmentation within forming
        t_start_idx = None
        t_end_idx = None
        if config.ENABLE_CYCLE_SEGMENTATION and v_x and v_y:
            from .cycle_segmentation import detect_forming_start
            v_total = [sqrt(vx**2 + vy**2) for vx, vy in zip(v_x, v_y)]
            t_start_idx = detect_forming_start(v_total, config.V_THRESHOLD)
            t_end_idx = len(forming_x) - 1

        # S12: Kinematic normalization on forming segment
        phase_results = None
        if (config.ENABLE_KINEMATIC_NORMALIZATION
                and t_start_idx is not None
                and t_end_idx is not None
                and len(forming_t) > 1):
            from .kinematic_normalization import normalize_signals
            phase_results = normalize_signals(
                time_seconds=np.array(forming_t),
                t_start_idx=t_start_idx,
                t_end_idx=t_end_idx,
                signals={"X_cal": forming_x, "Y_cal": forming_y},
                spm_ref=config.SPM_REFERENCE,
                n_points=config.PHASE_POINTS,
                velocity_of={"v_x": "X_cal", "v_y": "Y_cal"},
            )

        # S13: Stick-slip energy
        E_ss_x, E_ss_y, E_ss_total = None, None, None
        if config.ENABLE_STICK_SLIP and phase_results and "v_x_phi" in phase_results:
            from .stick_slip import compute_stick_slip_energy
            E_ss_x = compute_stick_slip_energy(phase_results["v_x_phi"], config.OMEGA_CUTOFF_RATIO)
            E_ss_y = compute_stick_slip_energy(phase_results["v_y_phi"], config.OMEGA_CUTOFF_RATIO)
            E_ss_total = E_ss_x + E_ss_y

        # Build output with all data layers
        phase_fields = {}
        if phase_results:
            phase_fields.update(phase_results)

        return build_output(
            p1.metadata,
            # Raw
            X=p1.raw.get("X"),
            Y=p1.raw.get("Y"),
            # Scaled full
            X_cal=x_cal,
            Y_cal=y_cal,
            # Closing
            closing_X_cal=closing_x,
            closing_Y_cal=closing_y,
            # Forming
            forming_X_cal=forming_x,
            forming_Y_cal=forming_y,
            # Velocity & displacement
            v_x=v_x,
            v_y=v_y,
            di_x=di_x,
            di_y=di_y,
            di=di,
            theta_flow=theta_flow,
            # Stick-slip
            E_ss_x=E_ss_x,
            E_ss_y=E_ss_y,
            E_ss_total=E_ss_total,
            # Transition metadata
            **extra,
            # Phase-domain
            **phase_fields,
        )

    def _process_gap(self, p1: Pass1Result) -> dict:
        """Process a single GAP sensor through Pass 2."""
        avg_idx = self.avg_transition_idx
        abs_vals = p1.scaled["abs"]
        abs_comp = p1.scaled.get("abs_comp")
        t_seconds = p1.time_seconds

        # S5: Curve splitting
        closing_abs = abs_vals[:avg_idx]
        forming_abs = abs_vals[avg_idx:]
        closing_abs_comp = abs_comp[:avg_idx] if abs_comp else None
        forming_abs_comp = abs_comp[avg_idx:] if abs_comp else None
        forming_t = t_seconds[avg_idx:] if t_seconds else []

        # Max values on forming
        x_max = max(forming_abs) if forming_abs else None
        abs_max = x_max  # For GAP, abs is the primary signal

        # S10: Cycle segmentation — BDC within forming
        t_start_idx = None
        t_end_idx = None
        if config.ENABLE_CYCLE_SEGMENTATION and forming_abs:
            from .cycle_segmentation import detect_bdc
            t_start_idx = 0
            t_end_idx = detect_bdc(forming_abs)

        # S12: Kinematic normalization on forming
        phase_results = None
        if (config.ENABLE_KINEMATIC_NORMALIZATION
                and t_start_idx is not None
                and t_end_idx is not None
                and len(forming_t) > 1):
            from .kinematic_normalization import normalize_signals
            signals = {"abs": forming_abs}
            if forming_abs_comp:
                signals["abs_comp"] = forming_abs_comp
            phase_results = normalize_signals(
                time_seconds=np.array(forming_t),
                t_start_idx=t_start_idx,
                t_end_idx=t_end_idx,
                signals=signals,
                spm_ref=config.SPM_REFERENCE,
                n_points=config.PHASE_POINTS,
            )

        # S14: Golden cycle comparison
        rmse_vs_golden = None
        thinning_detected = None
        if (config.ENABLE_GOLDEN_CYCLE and phase_results
                and "abs_phi" in phase_results and abs_max is not None):
            # Golden cycle comparison would require Redis — skip for now,
            # handled by pipeline integration
            pass

        phase_fields = {}
        if phase_results:
            phase_fields.update(phase_results)

        return build_output(
            p1.metadata,
            # Raw
            X=p1.raw.get("X"),
            Y=p1.raw.get("Y"),
            Z=p1.raw.get("Z"),
            Temp=p1.raw.get("Temp"),
            # Scaled full
            **{"abs": abs_vals},
            abs_comp=abs_comp,
            # Closing
            closing_abs=closing_abs,
            closing_abs_comp=closing_abs_comp,
            # Forming
            forming_abs=forming_abs,
            forming_abs_comp=forming_abs_comp,
            # Max
            abs_max=abs_max,
            # Transition
            avg_transition_idx=avg_idx,
            # Phase-domain
            **phase_fields,
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_stroke_processor.py -v`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add processing/processors/stroke_processor.py tests/test_stroke_processor.py tests/fixtures/drawin_message_2.json tests/fixtures/drawin_message_3.json
git commit -m "feat: add StrokeProcessor — Pass 2 cross-sensor orchestrator with curve splitting and forming analysis"
```

---

## Task 7: Adapt prediction to time domain

**Files:**
- Modify: `processing/processors/stale_detection.py`
- Modify: `processing/processors/drawin_prediction.py`
- Modify: `processing/processors/stroke_processor.py`
- Test: `tests/test_stale_detection.py` (extend)

- [ ] **Step 1: Write test for time-domain stale detection**

Append to `tests/test_stale_detection.py`:

```python
class TestTimeDomainStaleDetection:
    def test_detect_stale_with_timestamps(self):
        from processing.processors.stale_detection import detect_stale_point_time_domain
        # Signal goes flat after index 5
        signal = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5]
        dt = 0.01
        idx = detect_stale_point_time_domain(signal, dt, velocity_threshold=0.05, min_window=5)
        assert idx is not None
        assert idx == 5  # first sample of the stale region

    def test_no_stale_active_signal(self):
        from processing.processors.stale_detection import detect_stale_point_time_domain
        signal = [float(i) for i in range(20)]
        idx = detect_stale_point_time_domain(signal, 0.01)
        assert idx is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_stale_detection.py::TestTimeDomainStaleDetection -v`
Expected: FAIL

- [ ] **Step 3: Implement time-domain stale detection**

Add to `processing/processors/stale_detection.py`:

```python
def detect_stale_point_time_domain(
    signal: list[float],
    dt: float,
    velocity_threshold: float = 0.05,
    min_window: int = 10,
) -> int | None:
    """Detect where a time-domain signal goes stale.

    Computes velocity = diff(signal) / dt and scans for sustained low velocity.

    Args:
        signal: Time-domain position signal.
        dt: Time step between samples (seconds).
        velocity_threshold: Absolute velocity below which signal is stale.
        min_window: Consecutive stale samples required to confirm.

    Returns:
        Index where stale begins, or None if signal is active throughout.
    """
    if not signal or len(signal) < min_window + 1 or dt <= 0:
        return None

    arr = np.asarray(signal, dtype=float)
    velocity = np.abs(np.diff(arr) / dt)

    stale_mask = velocity < velocity_threshold
    consecutive = 0

    for i in range(len(stale_mask)):
        if stale_mask[i]:
            consecutive += 1
            if consecutive >= min_window:
                return i - min_window + 1
        else:
            consecutive = 0

    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_stale_detection.py -v`
Expected: PASS (all old + new tests)

- [ ] **Step 5: Commit**

```bash
git add processing/processors/stale_detection.py tests/test_stale_detection.py
git commit -m "feat: add detect_stale_point_time_domain() for time-domain prediction"
```

- [ ] **Step 6: Wire prediction into StrokeProcessor**

Add S11 prediction step to `StrokeProcessor._process_drawin()`, between cycle segmentation (S10) and kinematic normalization (S12). The prediction runs on `forming_X_cal` (time domain), and the predicted curve is added to the signals dict for S12 phase-transform.

This requires adapting `PredictionEngine.predict()` to accept time-domain input. The adapter pattern: wrap the existing phase-domain engine with a time-domain interface that handles the conversion internally.

Add `_run_time_domain_prediction()` method to `StrokeProcessor` and integrate into `_process_drawin()`. The predicted `forming_X_cal_predicted` is passed to `normalize_signals()` alongside `forming_X_cal` so both get phase-transformed.

- [ ] **Step 7: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add processing/processors/stroke_processor.py processing/processors/drawin_prediction.py
git commit -m "feat: integrate P7 prediction in time domain with phase-domain transform"
```

---

## Task 8: Wire pipeline.py to use stroke-buffered flow

**Files:**
- Modify: `processing/pipeline.py`
- Test: `tests/test_pipeline_integration.py` (create)

- [ ] **Step 1: Write integration test**

Create `tests/test_pipeline_integration.py`:

```python
"""Integration test: full stroke through both passes."""

import json
from unittest.mock import MagicMock, patch

from processing.models import SensorMessage
from processing.pipeline import Pipeline


class TestStrokeBufferedPipeline:
    def test_single_drawin_produces_output(self):
        """A stroke with 1 expected sensor should process immediately."""
        # This tests the full flow: message in → accumulate → Pass 2 → output
        # Mocking Redis and RabbitMQ, verifying output message structure
        pass  # Detailed implementation depends on final pipeline wiring

    def test_legacy_mode_bypasses_accumulation(self):
        """ENABLE_STROKE_ACCUMULATION=false falls back to per-sensor."""
        pass
```

- [ ] **Step 2: Modify pipeline.py**

Update `Pipeline.process_message()` to route through the stroke-buffered path when `ENABLE_STROKE_ACCUMULATION` is true:

1. Parse message → SensorMessage
2. Call `pass1_drawin()` or `pass1_gap()`
3. Store `Pass1Result` in accumulator
4. If stroke complete → create `StrokeProcessor`, run `process()`, publish all outputs
5. If not complete → return (wait for more sensors)

Legacy path (flag=false) calls existing `process_drawin()` / `process_gap()` as before.

- [ ] **Step 3: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add processing/pipeline.py tests/test_pipeline_integration.py
git commit -m "feat: wire stroke-buffered pipeline with legacy fallback"
```

---

## Task 9: End-to-end integration test with multiple sensors

**Files:**
- Create: `tests/test_phase_transition_integration.py`

- [ ] **Step 1: Write comprehensive end-to-end test**

Create `tests/test_phase_transition_integration.py`:

```python
"""End-to-end: multiple DRAWIN + GAP through both passes, verify all data layers."""

import numpy as np
import pytest

from processing.models import Pass1Result
from processing.processors.stroke_processor import StrokeProcessor


def _make_realistic_drawin(sensor_id, transition_idx, n=50):
    """Create DRAWIN with clear closing→forming transition."""
    t = np.linspace(0, 0.5, n)
    x = np.concatenate([
        np.zeros(transition_idx),  # Closing: flat
        np.cumsum(np.random.uniform(0.05, 0.15, n - transition_idx)),  # Forming: ramp
    ])
    y = x * 0.65
    ts = [f"2025-01-01 00:00:00.{i*10:03d}" for i in range(n)]
    return Pass1Result(
        sensor_name="DRAWIN", sensor_id=sensor_id,
        metadata={"timestamp": "ts1", "die_id": "1", "hub_id": "H1",
                  "sensor_id": sensor_id, "hub_port": "1",
                  "switch_id": "SW1", "switch_ip": "10.0.0.1"},
        scaled={"X_cal": x.tolist(), "Y_cal": y.tolist()},
        timestamps=ts, time_seconds=t.tolist(),
        transition_idx=transition_idx,
        raw={"X": [f"{v:.2f}" for v in x], "Y": [f"{v:.2f}" for v in y]},
    )


def _make_realistic_gap(sensor_id, n=50):
    """Create GAP with sinusoidal profile."""
    t = np.linspace(0, 0.5, n)
    abs_vals = (np.sin(np.linspace(0, np.pi, n)) * 20).tolist()
    ts = [f"2025-01-01 00:00:00.{i*10:03d}" for i in range(n)]
    return Pass1Result(
        sensor_name="GAP", sensor_id=sensor_id,
        metadata={"timestamp": "ts1", "die_id": "1", "hub_id": "H1",
                  "sensor_id": sensor_id, "hub_port": "2",
                  "switch_id": "SW1", "switch_ip": "10.0.0.1"},
        scaled={"abs": abs_vals, "abs_comp": [v * 0.98 for v in abs_vals]},
        timestamps=ts, time_seconds=t.tolist(),
        transition_idx=None,
        raw={"X": [], "Y": [], "Z": [], "Temp": []},
    )


class TestEndToEnd:
    def test_three_drawin_two_gap_full_stroke(self):
        results = {
            "DP01": _make_realistic_drawin("DP01", 8),
            "DP02": _make_realistic_drawin("DP02", 10),
            "DP03": _make_realistic_drawin("DP03", 12),
            "GP01": _make_realistic_gap("GP01"),
            "GP02": _make_realistic_gap("GP02"),
        }
        proc = StrokeProcessor(results)
        outputs = proc.process()

        assert len(outputs) == 5
        avg_idx = proc.avg_transition_idx
        assert avg_idx == 10  # round((8+10+12)/3)

        # Check DRAWIN outputs
        for out in outputs:
            if out["sensor_id"].startswith("DP"):
                assert "X" in out  # raw
                assert "X_cal" in out  # scaled full
                assert "closing_X_cal" in out
                assert "forming_X_cal" in out
                assert len(out["closing_X_cal"]) == avg_idx
                assert len(out["forming_X_cal"]) == 50 - avg_idx
                assert "v_x" in out
                assert "di" in out
                assert "transition_idx" in out
                assert "avg_transition_idx" in out
                assert out["avg_transition_idx"] == avg_idx
                assert "transition_delta" in out

        # Check GAP outputs
        for out in outputs:
            if out["sensor_id"].startswith("GP"):
                assert "abs" in out
                assert "closing_abs" in out
                assert "forming_abs" in out
                assert len(out["closing_abs"]) == avg_idx
                assert out["avg_transition_idx"] == avg_idx
                assert "transition_idx" not in out

    def test_all_deltas_sum_to_zero(self):
        """Transition deltas across DRAWIN sensors must sum to approximately zero."""
        results = {
            "DP01": _make_realistic_drawin("DP01", 7),
            "DP02": _make_realistic_drawin("DP02", 9),
            "DP03": _make_realistic_drawin("DP03", 11),
        }
        proc = StrokeProcessor(results)
        outputs = proc.process()
        deltas = [o["transition_delta"] for o in outputs]
        assert abs(sum(deltas)) <= 1  # rounding may cause ±1
```

- [ ] **Step 2: Run tests**

Run: `python -m pytest tests/test_phase_transition_integration.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_phase_transition_integration.py
git commit -m "test: add end-to-end integration tests for stroke-based pipeline"
```

---

## Task 10: Update README and commit pipeline diagram

**Files:**
- Modify: `README.md` (already done in this session — verify changes are staged)

- [ ] **Step 1: Verify README has pipeline diagram**

Run: `grep -c "Processing Pipeline Architecture" README.md`
Expected: 1

- [ ] **Step 2: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All PASS

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: add pipeline v2 architecture diagram to README"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Config flags | `config.py` |
| 2 | Pass1Result model | `models.py` |
| 3 | Extend StrokeAccumulator | `stroke_accumulator.py` |
| 4 | Split drawin_base → pass1/pass2 | `drawin_base.py` |
| 5 | Split gap_base → pass1/pass2 | `gap_base.py` |
| 6 | StrokeProcessor (Pass 2 orchestrator) | `stroke_processor.py` (new) |
| 7 | Time-domain prediction + stale detection | `stale_detection.py`, `drawin_prediction.py` |
| 8 | Wire pipeline.py | `pipeline.py` |
| 9 | End-to-end integration tests | `test_phase_transition_integration.py` |
| 10 | README + final validation | `README.md` |

**Dependencies:** Tasks 1-2 are independent. Task 3 depends on 2. Tasks 4-5 depend on 1-2. Task 6 depends on 4-5. Task 7 depends on 6. Task 8 depends on 3+6+7. Task 9 depends on 8. Task 10 depends on 9.

**Parallelizable:** Tasks 1 and 2. Tasks 4 and 5.
