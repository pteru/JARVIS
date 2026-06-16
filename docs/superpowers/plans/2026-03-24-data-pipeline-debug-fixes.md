# DieMaster Data Pipeline Debug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two production-blocking bugs in `diemaster-data-processing`: CubicSpline crash on duplicate timestamps (#8) and stroke accumulator never completing with multi-hub setups (#7).

**Architecture:** Issue #8 is a surgical guard inside `kinematic_normalization.py` before CubicSpline calls. Issue #7 combines a timestamp tolerance window (merge nearby stroke keys) with an active timeout flush (force-process stale partial strokes). All changes are backward-compatible and behind existing config flags.

**Tech Stack:** Python 3.11, numpy, scipy, redis-py, pika, pytest, loguru

**Spec:** `docs/superpowers/specs/2026-03-24-data-pipeline-debug-fixes-design.md`

**Working directory:** `/home/teruel/JARVIS/workspaces/strokmatic/diemaster/services/data-processing`

**Branch:** `fix/data-pipeline-debug-01001` (off `develop`)

**Baseline:** 192 tests passing

---

## Task 1: Timestamp Deduplication Guard — Tests (Issue #8)

**Files:**
- Modify: `tests/test_kinematic_normalization.py`

- [ ] **Step 1: Write 3 failing tests for deduplication**

Append to class `TestResampleToPhaseDomain` in `tests/test_kinematic_normalization.py`:

```python
def test_duplicate_phase_values_handled(self):
    """Duplicate phase values are filtered — CubicSpline does not raise."""
    # Phase with duplicates at indices 2-3 and 5-6
    phase = np.array([0.0, 100.0, 200.0, 200.0, 400.0, 500.0, 500.0, 700.0, 800.0, 1000.0])
    signal = np.array([0.0, 1.0, 2.0, 2.1, 4.0, 5.0, 5.1, 7.0, 8.0, 10.0])
    result = resample_to_phase_domain(phase, signal, n_points=1001)
    assert len(result) == 1001
    # Endpoints should still be reasonable
    assert result[0] == pytest.approx(0.0, abs=0.5)
    assert result[-1] == pytest.approx(10.0, abs=0.5)

def test_all_duplicates_except_one_returns_constant(self):
    """Extreme case: all same phase value → falls back to constant array."""
    phase = np.array([500.0, 500.0, 500.0, 500.0, 500.0])
    signal = np.array([3.0, 3.1, 3.2, 3.3, 3.4])
    result = resample_to_phase_domain(phase, signal, n_points=1001)
    assert len(result) == 1001
    # Should be a constant (first value)
    np.testing.assert_allclose(result, 3.0, atol=1e-10)

def test_no_duplicates_unchanged(self):
    """Clean input with no duplicates produces identical results to baseline."""
    phase = np.linspace(0, 1000, 20)
    signal = np.sin(np.linspace(0, np.pi, 20))
    result = resample_to_phase_domain(phase, signal, n_points=1001)
    # Verify against direct CubicSpline (no dedup needed)
    from scipy.interpolate import CubicSpline
    cs = CubicSpline(phase, signal, extrapolate=True)
    expected = cs(np.linspace(0, 1000, 1001))
    np.testing.assert_allclose(result, expected, atol=1e-10)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_kinematic_normalization.py::TestResampleToPhaseDomain::test_duplicate_phase_values_handled tests/test_kinematic_normalization.py::TestResampleToPhaseDomain::test_all_duplicates_except_one_returns_constant tests/test_kinematic_normalization.py::TestResampleToPhaseDomain::test_no_duplicates_unchanged -v`

Expected: First two FAIL with `ValueError: x must be strictly increasing sequence`. Third may pass (no duplicates).

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/test_kinematic_normalization.py
git commit -m "test: add failing tests for CubicSpline duplicate timestamp crash (#8)"
```

---

## Task 2: Timestamp Deduplication Guard — Implementation (Issue #8)

**Files:**
- Modify: `processing/processors/kinematic_normalization.py`

- [ ] **Step 1: Add `_ensure_strictly_increasing()` helper**

Add after the imports (after line 14) in `processing/processors/kinematic_normalization.py`:

```python
def _ensure_strictly_increasing(
    x: np.ndarray, y: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Remove samples where x is not strictly increasing, keeping first occurrence.

    Filters both duplicate and non-monotonic x values. This handles firmware
    timestamps at 1ms resolution where consecutive samples can collide.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = np.concatenate(([True], np.diff(x) > 0))
    n_dropped = len(x) - mask.sum()
    if n_dropped > 0:
        logger.debug(f"Dropped {n_dropped}/{len(x)} non-increasing samples before CubicSpline")
    return x[mask], y[mask]
```

- [ ] **Step 2: Apply guard in `resample_to_phase_domain()`**

In `resample_to_phase_domain()`, replace the block after `len(phase) < 2` check (current lines 65-70) with:

```python
    if len(phase) < 2:
        return np.full(n_points, signal[0] if len(signal) > 0 else 0.0)

    phase, signal = _ensure_strictly_increasing(phase, signal)

    if len(phase) < 2:
        return np.full(n_points, signal[0] if len(signal) > 0 else 0.0)

    phi_grid = np.linspace(0, 1000, n_points)
    cs = CubicSpline(phase, signal, extrapolate=True)
    return cs(phi_grid)
```

- [ ] **Step 3: Apply guard in `compute_phase_derivative()`**

In `compute_phase_derivative()`, replace the block after `len(phase) < 2` check (current lines 87-92) with:

```python
    if len(phase) < 2:
        return np.zeros(n_points)

    phase, signal = _ensure_strictly_increasing(phase, signal)

    if len(phase) < 2:
        return np.zeros(n_points)

    phi_grid = np.linspace(0, 1000, n_points)
    cs = CubicSpline(phase, signal, extrapolate=True)
    return cs(phi_grid, 1)  # 1st derivative
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `python -m pytest tests/test_kinematic_normalization.py -v`

Expected: All tests pass, including the 3 new ones.

- [ ] **Step 5: Run full test suite for regressions**

Run: `python -m pytest tests/ -q --tb=short`

Expected: 195 passed (192 baseline + 3 new)

- [ ] **Step 6: Commit**

```bash
git add processing/processors/kinematic_normalization.py
git commit -m "fix: guard CubicSpline against duplicate timestamps (#8)

Add _ensure_strictly_increasing() filter before CubicSpline construction
in resample_to_phase_domain() and compute_phase_derivative(). Firmware
generates 1ms-resolution timestamps for 500-1000 samples/stroke —
collisions caused ValueError in ~50% of sensors."
```

---

## Task 3: Add `STROKE_TIMESTAMP_TOLERANCE_MS` Config

**Files:**
- Modify: `processing/config.py`

- [ ] **Step 1: Add config variable**

Add after line 64 (`STROKE_TIMEOUT`) in `processing/config.py`:

```python
STROKE_TIMESTAMP_TOLERANCE_MS = int(os.getenv("STROKE_TIMESTAMP_TOLERANCE_MS", "500"))
```

- [ ] **Step 2: Commit**

```bash
git add processing/config.py
git commit -m "config: add STROKE_TIMESTAMP_TOLERANCE_MS (default 500ms) (#7)"
```

---

## Task 4: Extend `mock_redis` Fixture with `scan_iter` Support

**Files:**
- Modify: `tests/test_stroke_accumulator.py`

- [ ] **Step 1: Add `scan_iter` and `time` to mock_redis fixture**

In `tests/test_stroke_accumulator.py`, inside the `mock_redis` fixture, add after the `sadd` definition (before `client.hset = hset`):

```python
    def scan_iter(match=None):
        """Simulate Redis SCAN with glob pattern matching."""
        import fnmatch
        pattern = match or "*"
        for key in list(_store.keys()):
            if fnmatch.fnmatch(key, pattern):
                yield key
```

Then add the binding alongside the other mock methods:

```python
    client.scan_iter = scan_iter
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `python -m pytest tests/test_stroke_accumulator.py -v`

Expected: All 12 existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add tests/test_stroke_accumulator.py
git commit -m "test: extend mock_redis fixture with scan_iter support (#7)"
```

---

## Task 5: Timestamp Tolerance Window — Tests

**Files:**
- Modify: `tests/test_stroke_accumulator.py`

- [ ] **Step 1: Write 4 failing tests for tolerance window**

Append a new test class at the end of `tests/test_stroke_accumulator.py`:

```python
class TestTimestampTolerance:
    """Tests for stroke timestamp tolerance window — merging nearby timestamps."""

    def test_nearby_timestamps_merged_into_same_bucket(self, mock_redis):
        """Two sensors with 200ms timestamp difference → same stroke bucket."""
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        ts1 = "2025-01-01 12:00:00.000"
        ts2 = "2025-01-01 12:00:00.200"  # 200ms later

        p1 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP01",
            metadata={}, scaled={"X_cal": [1.0]}, timestamps=[ts1],
            time_seconds=[0.0], transition_idx=None, raw={},
        )
        p2 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP02",
            metadata={}, scaled={"X_cal": [2.0]}, timestamps=[ts2],
            time_seconds=[0.0], transition_idx=None, raw={},
        )

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 500
            acc.add_pass1_result("die1", ts1, p1, expected_count=2)
            complete = acc.add_pass1_result("die1", ts2, p2, expected_count=2)

        assert complete is True  # Both in same bucket → complete

    def test_distant_timestamps_create_separate_buckets(self, mock_redis):
        """Two sensors with 2000ms difference → separate stroke buckets."""
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        ts1 = "2025-01-01 12:00:00.000"
        ts2 = "2025-01-01 12:00:02.000"  # 2000ms later

        p1 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP01",
            metadata={}, scaled={"X_cal": [1.0]}, timestamps=[ts1],
            time_seconds=[0.0], transition_idx=None, raw={},
        )
        p2 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP02",
            metadata={}, scaled={"X_cal": [2.0]}, timestamps=[ts2],
            time_seconds=[0.0], transition_idx=None, raw={},
        )

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 500
            acc.add_pass1_result("die1", ts1, p1, expected_count=2)
            complete = acc.add_pass1_result("die1", ts2, p2, expected_count=2)

        assert complete is False  # Different buckets → not complete

    def test_tolerance_zero_disables_merging(self, mock_redis):
        """With tolerance=0, even 1ms difference creates separate buckets."""
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        ts1 = "2025-01-01 12:00:00.000"
        ts2 = "2025-01-01 12:00:00.001"  # 1ms later

        p1 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP01",
            metadata={}, scaled={"X_cal": [1.0]}, timestamps=[ts1],
            time_seconds=[0.0], transition_idx=None, raw={},
        )
        p2 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP02",
            metadata={}, scaled={"X_cal": [2.0]}, timestamps=[ts2],
            time_seconds=[0.0], transition_idx=None, raw={},
        )

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 0
            acc.add_pass1_result("die1", ts1, p1, expected_count=2)
            complete = acc.add_pass1_result("die1", ts2, p2, expected_count=2)

        assert complete is False  # No merging → separate buckets

    def test_closest_key_selected_when_multiple_candidates(self, mock_redis):
        """When multiple stroke keys are within tolerance, pick the closest."""
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        # ts1 and ts2 are 1500ms apart → beyond 500ms tolerance → separate keys
        ts1 = "2025-01-01 12:00:00.000"
        ts2 = "2025-01-01 12:00:01.500"
        # ts3 is 1300ms from ts1 (beyond tolerance) but only 200ms from ts2 (within)
        ts3 = "2025-01-01 12:00:01.300"

        p1 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP01",
            metadata={}, scaled={"X_cal": [1.0]}, timestamps=[ts1],
            time_seconds=[0.0], transition_idx=None, raw={},
        )
        p2 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP02",
            metadata={}, scaled={"X_cal": [2.0]}, timestamps=[ts2],
            time_seconds=[0.0], transition_idx=None, raw={},
        )
        p3 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP03",
            metadata={}, scaled={"X_cal": [3.0]}, timestamps=[ts3],
            time_seconds=[0.0], transition_idx=None, raw={},
        )

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 500

            # ts1 creates key stroke:die1:2025-01-01 12:00:00.000
            acc.add_pass1_result("die1", ts1, p1, expected_count=3)
            # ts2 is 1500ms from ts1 → beyond tolerance → creates separate key
            acc.add_pass1_result("die1", ts2, p2, expected_count=3)
            # ts3 is 200ms from ts2 (within tolerance), 1300ms from ts1 (beyond)
            # → merges into ts2's bucket
            acc.add_pass1_result("die1", ts3, p3, expected_count=3)

        # DP03 should have merged into ts2's bucket (closest within tolerance)
        results_ts2 = acc.get_all_pass1_results("die1", ts2)
        assert "DP02" in results_ts2
        assert "DP03" in results_ts2
        # ts1's bucket should only have DP01
        results_ts1 = acc.get_all_pass1_results("die1", ts1)
        assert "DP01" in results_ts1
        assert len(results_ts1) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_stroke_accumulator.py::TestTimestampTolerance -v`

Expected: FAIL — `_find_nearby_stroke_key` method does not exist yet.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/test_stroke_accumulator.py
git commit -m "test: add failing tests for stroke timestamp tolerance window (#7)"
```

---

## Task 6: Timestamp Tolerance Window — Implementation

**Files:**
- Modify: `processing/processors/stroke_accumulator.py`

- [ ] **Step 1: Add imports and helper methods**

At the top of `processing/processors/stroke_accumulator.py`, update imports (after the existing `from loguru import logger`):

```python
import time as _time
from datetime import datetime
```

Add after the `_stroke_key` method (after line 29):

```python
    @staticmethod
    def _parse_stroke_ts_ms(stroke_timestamp: str) -> float | None:
        """Parse firmware timestamp string to epoch milliseconds."""
        try:
            dt = datetime.strptime(stroke_timestamp, "%Y-%m-%d %H:%M:%S.%f")
            return dt.timestamp() * 1000.0
        except (ValueError, TypeError):
            return None

    def _find_nearby_stroke_key(self, die_id: str, stroke_timestamp: str) -> str:
        """Find an existing stroke key within the tolerance window, or create a new one.

        Scans Redis for stroke:{die_id}:* keys. If any existing key's timestamp
        is within STROKE_TIMESTAMP_TOLERANCE_MS of the incoming timestamp, returns
        that key (picking the closest if multiple match). Otherwise returns the
        standard key for the incoming timestamp.
        """
        tolerance = config.STROKE_TIMESTAMP_TOLERANCE_MS
        if tolerance <= 0:
            return self._stroke_key(die_id, stroke_timestamp)

        incoming_ms = self._parse_stroke_ts_ms(stroke_timestamp)
        if incoming_ms is None:
            return self._stroke_key(die_id, stroke_timestamp)

        best_key = None
        best_delta = float("inf")

        for key in self._redis.scan_iter(match=f"stroke:{die_id}:*"):
            candidate_ts = key.split(":", 2)[2] if isinstance(key, str) else key.decode().split(":", 2)[2]
            candidate_ms = self._parse_stroke_ts_ms(candidate_ts)
            if candidate_ms is None:
                continue
            delta = abs(candidate_ms - incoming_ms)
            if delta <= tolerance and delta < best_delta:
                best_delta = delta
                best_key = key if isinstance(key, str) else key.decode()

        if best_key is not None:
            logger.debug(
                f"Tolerance merge: incoming ts={stroke_timestamp} → existing key "
                f"(delta={best_delta:.0f}ms)"
            )
            return best_key

        return self._stroke_key(die_id, stroke_timestamp)
```

- [ ] **Step 2: Update `add_sensor()` to use tolerance and write `_last_seen`**

Replace the first line of `add_sensor()` body (current line 51 `key = self._stroke_key(...)`) with:

```python
        key = self._find_nearby_stroke_key(die_id, stroke_timestamp)
```

And add `_last_seen` to the pipeline, after `pipe.expire(key, ...)` (before `pipe.execute()`):

```python
        pipe.hset(key, "_last_seen", str(_time.time()))
```

- [ ] **Step 3: Update `add_pass1_result()` to use tolerance and write `_last_seen`**

Replace the first line of `add_pass1_result()` body (current line 106 `key = self._stroke_key(...)`) with:

```python
        key = self._find_nearby_stroke_key(die_id, stroke_timestamp)
```

And add `_last_seen` to the pipeline, after `pipe.expire(key, ...)` (before `pipe.execute()`):

```python
        pipe.hset(key, "_last_seen", str(_time.time()))
```

- [ ] **Step 4: Run tolerance tests**

Run: `python -m pytest tests/test_stroke_accumulator.py::TestTimestampTolerance -v`

Expected: All 4 PASS.

- [ ] **Step 5: Run full accumulator tests for regression**

Run: `python -m pytest tests/test_stroke_accumulator.py -v`

Expected: All tests pass (12 existing + 4 new = 16).

- [ ] **Step 6: Commit**

```bash
git add processing/processors/stroke_accumulator.py processing/config.py
git commit -m "feat: add timestamp tolerance window to stroke accumulator (#7)

Merge sensor data from different hubs whose stroke_timestamp differs by
≤ STROKE_TIMESTAMP_TOLERANCE_MS (default 500ms). H1 and H2 generate
independent timestamps ~1s apart — tolerance window unifies them into
a single stroke bucket."
```

---

## Task 7: Active Timeout Flush — Tests

**Files:**
- Modify: `tests/test_stroke_accumulator.py`

- [ ] **Step 1: Write 4 failing tests for active flush**

Append a new test class at the end of `tests/test_stroke_accumulator.py`:

```python
class TestActiveTimeoutFlush:
    """Tests for active flush of stale stroke buffers."""

    def test_stale_stroke_flushed_after_timeout(self, mock_redis):
        """Stroke with _last_seen older than STROKE_TIMEOUT is returned for processing."""
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        ts = "2025-01-01 12:00:00.000"
        p1 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP01",
            metadata={}, scaled={"X_cal": [1.0]}, timestamps=[ts],
            time_seconds=[0.0], transition_idx=None, raw={},
        )

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 0
            acc.add_pass1_result("die1", ts, p1, expected_count=16)

        # Manually backdate _last_seen to simulate timeout
        key = f"stroke:die1:{ts}"
        mock_redis.hset(key, "_last_seen", str(_time.time() - 60))  # 60s ago

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 0
            stale = acc.flush_stale_strokes("die1")

        assert len(stale) == 1
        die_id, stroke_ts, results = stale[0]
        assert die_id == "die1"
        assert stroke_ts == ts
        assert "DP01" in results

    def test_fresh_stroke_not_flushed(self, mock_redis):
        """Stroke within timeout window is not returned."""
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        ts = "2025-01-01 12:00:00.000"
        p1 = Pass1Result(
            sensor_name="DRAWIN", sensor_id="DP01",
            metadata={}, scaled={"X_cal": [1.0]}, timestamps=[ts],
            time_seconds=[0.0], transition_idx=None, raw={},
        )

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 0
            acc.add_pass1_result("die1", ts, p1, expected_count=16)

        # _last_seen was just set (within timeout)
        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 0
            stale = acc.flush_stale_strokes("die1")

        assert len(stale) == 0

    def test_flush_returns_empty_when_no_stale(self, mock_redis):
        """No stroke keys at all → empty list."""
        acc = StrokeAccumulator(mock_redis)

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 0
            stale = acc.flush_stale_strokes("die1")

        assert stale == []

    def test_flushed_stroke_includes_all_accumulated_sensors(self, mock_redis):
        """Partial stroke with 3/16 sensors returns all 3 when flushed."""
        from processing.models import Pass1Result

        acc = StrokeAccumulator(mock_redis)
        ts = "2025-01-01 12:00:00.000"

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 0
            for sid in ["DP01", "DP02", "GP01"]:
                stype = "DRAWIN" if sid.startswith("DP") else "GAP"
                p = Pass1Result(
                    sensor_name=stype, sensor_id=sid,
                    metadata={}, scaled={"X_cal": [1.0]} if stype == "DRAWIN" else {"abs": [1.0]},
                    timestamps=[ts], time_seconds=[0.0],
                    transition_idx=5 if stype == "DRAWIN" else None, raw={},
                )
                acc.add_pass1_result("die1", ts, p, expected_count=16)

        # Backdate _last_seen
        key = f"stroke:die1:{ts}"
        mock_redis.hset(key, "_last_seen", str(_time.time() - 60))

        with patch("processing.processors.stroke_accumulator.config") as mock_config:
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 0
            stale = acc.flush_stale_strokes("die1")

        assert len(stale) == 1
        _, _, results = stale[0]
        assert len(results) == 3
        assert "DP01" in results
        assert "DP02" in results
        assert "GP01" in results
```

Also add the import at the top of the file (alongside existing imports):

```python
import time as _time
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_stroke_accumulator.py::TestActiveTimeoutFlush -v`

Expected: FAIL — `flush_stale_strokes` method does not exist yet.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/test_stroke_accumulator.py
git commit -m "test: add failing tests for active stroke timeout flush (#7)"
```

---

## Task 8: Active Timeout Flush — Implementation

**Files:**
- Modify: `processing/processors/stroke_accumulator.py`

- [ ] **Step 1: Add `flush_stale_strokes()` method**

Add at the end of the `StrokeAccumulator` class in `processing/processors/stroke_accumulator.py`:

```python
    def flush_stale_strokes(self, die_id: str) -> list[tuple[str, str, dict]]:
        """Flush stale stroke buffers that have timed out with partial data.

        Scans for stroke:{die_id}:* keys where _last_seen exceeds STROKE_TIMEOUT.
        Returns list of (die_id, stroke_timestamp, pass1_results) ready for Pass 2.
        """
        stale = []
        now = _time.time()

        for key in self._redis.scan_iter(match=f"stroke:{die_id}:*"):
            key_str = key if isinstance(key, str) else key.decode()
            last_seen_raw = self._redis.hget(key_str, "_last_seen")
            if last_seen_raw is None:
                continue

            last_seen = float(last_seen_raw)
            if now - last_seen <= config.STROKE_TIMEOUT:
                continue

            received_raw = self._redis.hget(key_str, "_received")
            if not received_raw:
                continue

            received = received_raw.split(",")
            stroke_ts = key_str.split(":", 2)[2]

            results = self.get_all_pass1_results(die_id, stroke_ts)
            if results:
                expected_raw = self._redis.hget(key_str, "_expected")
                expected = int(expected_raw) if expected_raw else "?"
                logger.info(
                    f"Flushing stale stroke: die={die_id} ts={stroke_ts} "
                    f"({len(received)}/{expected} sensors, stale for "
                    f"{now - last_seen:.0f}s)"
                )
                stale.append((die_id, stroke_ts, results))

        return stale
```

- [ ] **Step 2: Run flush tests**

Run: `python -m pytest tests/test_stroke_accumulator.py::TestActiveTimeoutFlush -v`

Expected: All 4 PASS.

- [ ] **Step 3: Run full accumulator test suite**

Run: `python -m pytest tests/test_stroke_accumulator.py -v`

Expected: All tests pass (16 + 4 = 20).

- [ ] **Step 4: Commit**

```bash
git add processing/processors/stroke_accumulator.py
git commit -m "feat: add active timeout flush for stale stroke buffers (#7)

flush_stale_strokes() scans for stroke keys where _last_seen exceeds
STROKE_TIMEOUT and returns partial results for Pass 2 processing.
Adds production resilience for sensor failures and multi-hub timing."
```

---

## Task 9: Pipeline Integration — Stale Flush in `_process_stroke_buffered()`

**Files:**
- Modify: `processing/pipeline.py`
- Modify: `tests/test_pipeline_integration.py`

- [ ] **Step 1: Write failing integration test**

Append to `tests/test_pipeline_integration.py`:

```python
import time as _time


class TestStaleFlushIntegration:
    def test_stale_flush_triggers_pass2(self):
        """Stale stroke is flushed and published when new message arrives."""
        with patch('processing.pipeline.config') as mock_config:
            mock_config.ENABLE_STROKE_ACCUMULATION = True
            mock_config.PREDICTION_REDIS_DB = 7
            mock_config.STROKE_TIMEOUT = 30
            mock_config.STROKE_TIMESTAMP_TOLERANCE_MS = 0
            mock_config.DW_QUEUE = "dw-queue"
            mock_config.REDIS_HASH = "DP01"
            mock_config.ENABLE_PHASE_TRANSITION = False
            mock_config.ENABLE_THERMAL_COMPENSATION = False
            mock_config.ENABLE_PREDICTION = False

            pipeline = Pipeline()
            mock_redis = MagicMock()
            mock_redis.hget.side_effect = lambda h, f: {
                "k_x": "1.0", "k_y": "1.0"
            }.get(f)
            pipeline.redis_client = mock_redis

            # Mock the accumulator
            mock_accumulator = MagicMock()
            mock_accumulator.add_pass1_result.return_value = False  # not complete
            mock_accumulator.get_expected_count.return_value = 16

            # Simulate a stale stroke ready to flush
            from processing.models import Pass1Result
            stale_results = {
                "DP01": Pass1Result(
                    sensor_name="DRAWIN", sensor_id="DP01",
                    metadata={"timestamp": "t", "die_id": 1, "hub_id": "H1",
                              "sensor_id": "DP01", "hub_port": "1",
                              "switch_id": "SW1", "switch_ip": "10.0.0.1"},
                    scaled={"X_cal": [0.0, 1.0]}, timestamps=["t1", "t2"],
                    time_seconds=[0.0, 0.01], transition_idx=None, raw={},
                ),
            }
            mock_accumulator.flush_stale_strokes.return_value = [
                ("1", "2025-01-01 12:00:00.000", stale_results)
            ]

            pipeline._accumulator = mock_accumulator
            pipeline._redis_db7 = MagicMock()
            pipeline._redis_db7.hget.return_value = "16"

            with patch('processing.pipeline.pass1_drawin') as mock_pass1:
                mock_pass1.return_value = Pass1Result(
                    sensor_name="DRAWIN", sensor_id="S1",
                    metadata={"timestamp": "t", "die_id": 1, "hub_id": "H1",
                              "sensor_id": "S1", "hub_port": "1",
                              "switch_id": "SW1", "switch_ip": "10.0.0.1"},
                    scaled={"X_cal": [0.0, 1.0]}, timestamps=["t1", "t2"],
                    time_seconds=[0.0, 0.01], transition_idx=None, raw={},
                )

                channel = MagicMock()
                msg = {
                    "stroke_timestamp": "2025-01-01 12:00:01.000",
                    "die_id": 1, "hub_id": "H1", "sensor_id": "S1",
                    "sensor_name": "DRAWIN", "hub_port": "1",
                    "switch_id": "SW1", "switch_ip": "10.0.0.1",
                    "timestamps": ["2025-01-01 00:00:00.000", "2025-01-01 00:00:00.010"],
                    "X": ["0.0", "1.0"], "Y": ["0.0", "0.5"], "dpi": 800,
                }
                body = json.dumps(msg).encode()

                with patch('processing.pipeline.publish_message') as mock_publish:
                    with patch('processing.pipeline.StrokeProcessor') as mock_sp:
                        mock_sp.return_value.process.return_value = [{"result": "data"}]
                        mock_sp.return_value.avg_transition_idx = None
                        pipeline.process_message(channel, body)

                        # flush_stale_strokes should have been called
                        mock_accumulator.flush_stale_strokes.assert_called_once()
                        # StrokeProcessor should have been called for the stale stroke
                        mock_sp.assert_called_once()
                        # Result should have been published
                        mock_publish.assert_called()
                        # Cleanup should have been called
                        mock_accumulator.cleanup.assert_called_with("1", "2025-01-01 12:00:00.000")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_pipeline_integration.py::TestStaleFlushIntegration -v`

Expected: FAIL — pipeline doesn't call `flush_stale_strokes` yet.

- [ ] **Step 3: Add flush call to `_process_stroke_buffered()`**

In `processing/pipeline.py`, in `_process_stroke_buffered()`, add after the `if stroke_complete:` block (after the cleanup at line 139, before the log at line 141), add a new block for stale flush. The full method ending should be:

```python
        if stroke_complete:
            logger.info(
                f"Stroke complete: die={die_id} ts={stroke_ts} — running Pass 2"
            )
            # Pass 2: cross-sensor analysis
            all_results = accumulator.get_all_pass1_results(die_id, stroke_ts)
            prediction_engine = self._get_prediction_engine(die_id)
            processor = StrokeProcessor(all_results, prediction_engine=prediction_engine)
            outputs = processor.process()

            for output in outputs:
                publish_message(channel, config.DW_QUEUE, output)

            # Cleanup stroke buffer
            accumulator.cleanup(die_id, stroke_ts)

            logger.info(
                f"Stroke published: {len(outputs)} sensors, "
                f"avg_transition_idx={processor.avg_transition_idx}"
            )

        # Flush any stale strokes for this die
        stale = accumulator.flush_stale_strokes(die_id)
        for die_id_s, stroke_ts_s, results_s in stale:
            logger.info(
                f"Processing stale stroke: die={die_id_s} ts={stroke_ts_s} "
                f"({len(results_s)} sensors)"
            )
            prediction_engine = self._get_prediction_engine(die_id_s)
            processor = StrokeProcessor(results_s, prediction_engine=prediction_engine)
            outputs = processor.process()

            for output in outputs:
                publish_message(channel, config.DW_QUEUE, output)

            accumulator.cleanup(die_id_s, stroke_ts_s)

            logger.info(
                f"Stale stroke published: {len(outputs)} sensors, "
                f"avg_transition_idx={processor.avg_transition_idx}"
            )
```

- [ ] **Step 4: Run integration test**

Run: `python -m pytest tests/test_pipeline_integration.py::TestStaleFlushIntegration -v`

Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `python -m pytest tests/ -q --tb=short`

Expected: 204 passed (192 baseline + 12 new)

- [ ] **Step 6: Commit**

```bash
git add processing/pipeline.py tests/test_pipeline_integration.py
git commit -m "feat: integrate stale stroke flush into pipeline (#7)

_process_stroke_buffered() now calls flush_stale_strokes() after each
message. Stale partial strokes are force-processed through Pass 2 and
published to dw-queue, preventing silent data loss on timeout."
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`

Expected: 204 passed, 0 failed.

- [ ] **Step 2: Run ruff lint**

Run: `ruff check .`

Expected: No errors.

- [ ] **Step 3: Verify git log**

Run: `git log --oneline develop..HEAD`

Expected: 8 commits (alternating test → implementation pairs).

- [ ] **Step 4: Push branch**

```bash
git push -u origin fix/data-pipeline-debug-01001
```
