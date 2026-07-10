---
type: Design Spec
title: DieMaster Data Pipeline Debug Fixes — Design Spec
description: Two bugs discovered during physical testing block ~100% of data flow through the processing pipeline:
timestamp: 2026-03-24
---

# DieMaster Data Pipeline Debug Fixes — Design Spec

**Date:** 2026-03-24
**Repo:** `strokmatic/diemaster-data-processing`
**Branch:** `fix/data-pipeline-debug-01001`
**Issues:** [#7](https://github.com/strokmatic/diemaster-data-processing/issues/7), [#8](https://github.com/strokmatic/diemaster-data-processing/issues/8)
**Context:** 01001 (GM SJC S10) debug session on 2026-03-23 with physical hubs H1 + H2

---

## Problem Summary

Two bugs discovered during physical testing block ~100% of data flow through the processing pipeline:

1. **CubicSpline crashes on duplicate timestamps** — firmware generates 1ms-resolution timestamps for 500-1000 samples per stroke. Collisions cause `ValueError: x must be strictly increasing sequence` in scipy's `CubicSpline`, rejecting ~50% of sensors.

2. **Stroke accumulator never completes** — H1 and H2 generate independent `stroke_timestamp` values (~1s apart) for the same physical press stroke. The accumulator keys on `die_id:stroke_timestamp`, creating two incomplete buckets that never reach the expected 16 sensors. After 30s, Redis passively expires the keys with no data processed.

---

## Fix 1: Timestamp Deduplication Guard (Issue #8)

### Approach

Add a private helper `_ensure_strictly_increasing()` inside `kinematic_normalization.py` that filters out samples with duplicate phase values before constructing `CubicSpline`.

### Design

**New function in `kinematic_normalization.py`:**

```python
def _ensure_strictly_increasing(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Remove samples where x is not strictly increasing, keeping first occurrence."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = np.concatenate(([True], np.diff(x) > 0))
    return x[mask], y[mask]
```

**Applied in two call sites:**

1. `resample_to_phase_domain()` — before `CubicSpline(phase, signal)`
2. `compute_phase_derivative()` — before `CubicSpline(phase, signal)`

These two functions are the only places `CubicSpline` is constructed. All higher-level callers (`normalize_signals()`, `drawin_base.py`, `gap_base.py`, `StrokeProcessor`) reach CubicSpline through these two functions, so the fix covers all paths transitively.

After deduplication, if `len(phase) < 2`, fall back to the existing single-sample path (return constant array).

A debug log message records the number of dropped samples for observability.

**Note:** The `np.diff(x) > 0` mask also filters non-monotonic values (where x decreases). This is intentional — phase arrays should be monotonically increasing; backward timestamps from malformed firmware payloads are silently dropped rather than crashing the pipeline.

### Files Modified

- `processing/processors/kinematic_normalization.py` — add helper, apply in 2 sites

### Tests (in `test_kinematic_normalization.py`)

| Test | Description |
|------|-------------|
| `test_duplicate_phase_values_handled` | Input with repeated phase values produces valid output without raising |
| `test_all_duplicates_except_one` | Extreme case (all same phase) returns constant array |
| `test_no_duplicates_unchanged` | Clean input passes through untouched, identical results |

---

## Fix 2: Stroke Accumulator — Tolerance Window + Active Flush (Issue #7)

### Approach

Combine two mechanisms:
- **Timestamp tolerance window** — merge hub timestamps within ±500ms into the same stroke bucket (solves the multi-hub divergence)
- **Active timeout flush** — force-process partial strokes after STROKE_TIMEOUT seconds (adds production resilience for sensor failures)

### Part A: Timestamp Tolerance Window

**New config in `config.py`:**

```python
STROKE_TIMESTAMP_TOLERANCE_MS = int(os.getenv("STROKE_TIMESTAMP_TOLERANCE_MS", "500"))
```

**New methods in `stroke_accumulator.py`:**

- `_parse_stroke_ts_ms(stroke_timestamp: str) -> float` — reuses `parse_timestamps_to_seconds()` from `processing/utils.py` (same `"%Y-%m-%d %H:%M:%S.%f"` format), converting the result to milliseconds (`* 1000`). No duplicate parsing logic.

- `_find_nearby_stroke_key(die_id: str, stroke_timestamp: str) -> str` — before creating a new Redis key:
  1. Compute incoming timestamp as epoch ms
  2. SCAN for existing keys matching `stroke:{die_id}:*`
  3. For each candidate, parse its timestamp and compare
  4. If `|candidate_ts - incoming_ts| <= STROKE_TIMESTAMP_TOLERANCE_MS`, return that key
  5. If multiple candidates match, pick the closest
  6. If no match, return the standard key `stroke:{die_id}:{stroke_timestamp}`

**Modified methods:**

- `add_pass1_result()` — calls `_find_nearby_stroke_key()` to resolve the key before storing
- `add_sensor()` (v1) — same change for backward compatibility

**Design constraints:**

- SCAN pattern `stroke:{die_id}:*` is scoped to one die — at most 1-3 active keys, negligible performance cost
- The original `stroke_timestamp` is preserved in hash metadata for traceability — only the Redis key is unified
- `STROKE_TIMESTAMP_TOLERANCE_MS=0` disables merging (exact-match, backward compatible)
- **Key parsing:** The Redis key `stroke:{die_id}:{stroke_timestamp}` contains colons in the timestamp portion (e.g., `HH:MM:SS`). Extract timestamp via `key.split(":", 2)[2]` to split only on the first two colons.
- **Race condition:** Between SCAN and HSET, a concurrent message could create a duplicate key. Accepted risk — at 16 sensors/stroke the window is ~1ms; in practice the pipeline processes messages sequentially (single-threaded pika consumer). No lock needed.

### Part B: Active Timeout Flush

**New field in stroke hash:** `_last_seen` — unix timestamp (float), updated on every `add_pass1_result()` call via the Redis pipeline.

**New method in `stroke_accumulator.py`:**

- `flush_stale_strokes(die_id: str) -> list[tuple[str, str, dict[str, Pass1Result]]]` —
  1. SCAN for `stroke:{die_id}:*` keys
  2. For each key, read `_last_seen` and `_received`
  3. If `now - _last_seen > STROKE_TIMEOUT` and `len(_received) >= 1`:
     - Collect all Pass1Results via `get_all_pass1_results()`
     - Extract `stroke_timestamp` from key via `key.split(":", 2)[2]`
     - Return `(die_id, stroke_timestamp, results)` tuple
  4. Return list of tuples ready for Pass 2
  5. Log each flushed stroke at INFO level: sensor count received vs expected, die_id, timestamp

**Modified file: `pipeline.py`**

In `_process_stroke_buffered()`, after the normal accumulation logic (whether the stroke completed or not):

```python
stale = accumulator.flush_stale_strokes(die_id)
for die_id_s, stroke_ts_s, results_s in stale:
    processor = StrokeProcessor(results_s, prediction_engine=prediction_engine)
    outputs = processor.process()
    for output in outputs:
        publish_message(channel, config.DW_QUEUE, output)
    accumulator.cleanup(die_id_s, stroke_ts_s)
```

**Design constraints:**

- Piggybacks on incoming messages — no separate timer thread needed
- Only scans keys for the `die_id` of the current message — avoids cross-die scanning
- If pipeline is idle, Redis EXPIRE still cleans up (active flush is best-effort improvement). Data in expired keys is lost without processing — accepted trade-off; a timer thread is a future enhancement if needed.
- **Timeout constant:** `flush_stale_strokes()` uses `config.STROKE_TIMEOUT` for the staleness check. Both `add_pass1_result()` (which uses `config.STROKE_TIMEOUT` for EXPIRE) and `add_sensor()` (which uses `config.PREDICTION_STROKE_TIMEOUT`) set Redis EXPIRE on their keys. Since both default to 30s and `flush_stale_strokes()` runs before EXPIRE fires, the check is consistent. If the two constants diverge in the future, the flush will still work — it just means v1 keys may expire before being flushed (accepted, since v1 is legacy).

### Files Modified

| File | Change |
|------|--------|
| `processing/config.py` | Add `STROKE_TIMESTAMP_TOLERANCE_MS` |
| `processing/processors/stroke_accumulator.py` | Add `_find_nearby_stroke_key()`, `_parse_stroke_ts_ms()`, `flush_stale_strokes()`. Update `add_pass1_result()` and `add_sensor()` for tolerance + `_last_seen` |
| `processing/pipeline.py` | Call `flush_stale_strokes()` in `_process_stroke_buffered()` |

### Test Infrastructure

The `mock_redis` fixture in `test_stroke_accumulator.py` must be extended with `scan_iter(match=...)` support, backed by the existing `_store` dict. This is a prerequisite for all tolerance and flush tests. Implementation: filter `_store.keys()` against the glob pattern (convert `*` to regex or use `fnmatch`).

### Tests

**In `test_stroke_accumulator.py`:**

| Test | Description |
|------|-------------|
| `test_nearby_timestamps_merged_into_same_bucket` | Two sensors with 200ms difference → same stroke |
| `test_distant_timestamps_create_separate_buckets` | 2000ms apart → two separate strokes |
| `test_tolerance_zero_disables_merging` | Exact match only when tolerance=0 |
| `test_closest_key_selected_when_multiple_candidates` | Picks nearest match from multiple candidates |
| `test_stale_stroke_flushed_after_timeout` | Stroke with `_last_seen` older than STROKE_TIMEOUT → returned |
| `test_fresh_stroke_not_flushed` | Stroke within timeout → not returned |
| `test_flush_returns_empty_when_no_stale` | Clean state returns empty list |
| `test_flushed_stroke_includes_all_accumulated_sensors` | Partial stroke (5/16 sensors) returns all 5 |

**In `test_pipeline_integration.py`:**

| Test | Description |
|------|-------------|
| `test_stale_flush_triggers_pass2` | Accumulate 3 sensors, advance time past timeout, send 4th message → stale stroke flushed and published |

---

## File Change Summary

| File | Change | Issue |
|------|--------|-------|
| `processing/processors/kinematic_normalization.py` | Add `_ensure_strictly_increasing()`, apply in 2 CubicSpline call sites | #8 |
| `processing/processors/stroke_accumulator.py` | Add tolerance window + active flush methods, update `add_pass1_result()` and `add_sensor()` | #7 |
| `processing/pipeline.py` | Call `flush_stale_strokes()` after accumulation | #7 |
| `processing/config.py` | Add `STROKE_TIMESTAMP_TOLERANCE_MS` | #7 |
| `tests/test_kinematic_normalization.py` | 3 new tests | #8 |
| `tests/test_stroke_accumulator.py` | 8 new tests | #7 |
| `tests/test_pipeline_integration.py` | 1 new test | #7 |

**Files NOT modified:** `drawin_base.py`, `gap_base.py`, `utils.py`, `connections.py`

---

## Backward Compatibility

- `STROKE_TIMESTAMP_TOLERANCE_MS=0` → exact-match behavior (current)
- `ENABLE_STROKE_ACCUMULATION=false` → bypass all accumulator logic (current)
- Timestamp dedup is transparent — produces same results minus the crash
- The v1 `add_sensor()` method (still called from `drawin_base.py` in the legacy prediction path when `ENABLE_PREDICTION=true` + `ENABLE_STROKE_ACCUMULATION=false`) gets the same tolerance window changes and continues to work correctly
- No database changes, no protocol changes, no firmware changes

## Deployment

Set in docker-compose environment:
```yaml
- STROKE_TIMESTAMP_TOLERANCE_MS=500
```

No other deployment changes required.
