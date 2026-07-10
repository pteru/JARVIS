---
type: Design Spec
title: Stroke-Based Processing Pipeline v2
description: The current data-processing pipeline processes each sensor message independently as it arrives from `pd-queue`. This prevents cross-sensor analysis at the phase-transition level — each DRAWIN senso...
timestamp: 2026-03-21
---

# Stroke-Based Processing Pipeline v2

**Date:** 2026-03-21
**Product:** DieMaster
**Service:** data-processing (`diemaster-data-processing`)
**Status:** Draft

## Problem Statement

The current data-processing pipeline processes each sensor message independently as it arrives from `pd-queue`. This prevents cross-sensor analysis at the phase-transition level — each DRAWIN sensor detects its own closing→forming boundary in isolation, and GAP sensors use a separate heuristic (BDC detection). The P12 phase-transition module exists but is not wired into the pipeline.

The desired behavior is:
- Compute the closing→forming transition for each DRAWIN sensor individually.
- Average those transitions across the stroke to produce a single, consistent split point.
- Apply that averaged split to ALL sensors (DRAWIN + GAP) so that time-aligned analysis is preserved.
- Save multiple data layers per sensor: raw, scaled full curve, closing segment, forming segment, and phase-normalized forming segment.
- Run all derived computations (velocity, displacement, flow angle, stick-slip, golden cycle, prediction) on the forming segment only.
- Predict draw-in curves in time domain, then transform predictions to phase domain alongside actual curves.

## Architecture

The pipeline shifts from per-sensor-independent processing to a stroke-buffered model.

```
pd-queue → Pass 1 (per-sensor) → Redis DB7 accumulator → Pass 2 (cross-sensor) → dw-queue
```

**Pass 1** runs on each inbound message: calibration, individual transition detection, and accumulation into a Redis stroke buffer.

**Pass 2** triggers when all expected sensors have arrived (or on timeout): computes the average transition, splits all curves, runs forming-phase analysis, and publishes the complete stroke.

## Processing Sequence

### Pass 1 — Per-Sensor (on each pd-queue message)

| Step | Name | Applies To | Description |
|------|------|------------|-------------|
| S1 | Calibration | DRAWIN: `X_cal = X·k_x`, `Y_cal = Y·k_y` (from Redis DB1). GAP: `abs = √(x²+y²+z²)`, thermal compensation (P3). | Produces calibrated/scaled full curves. |
| S2 | Transition detection | DRAWIN only | Run `detect_closing_to_forming(x_cal, time_seconds)` from `phase_transition.py`. Produces `transition_idx` per sensor. GAP sensors skip this step. |
| S3 | Accumulate | All sensors | Store in Redis DB7 stroke buffer: scaled curves, timestamps, transition_idx (DRAWIN), sensor metadata. Check if stroke is complete. |

### Pass 2 — Cross-Sensor (when stroke complete or timeout)

| Step | Name | Description |
|------|------|-------------|
| S4 | Average transition | Compute `avg_transition_idx = round(mean(transition_idx))` from all available DRAWIN sensors. |
| S5 | Curve splitting | For every sensor (DRAWIN + GAP): split scaled curve at `avg_transition_idx` into closing segment `[0 : avg_idx]` and forming segment `[avg_idx : end]`. |
| S6 | Transition metadata | Per DRAWIN sensor: `transition_delta = transition_idx - avg_transition_idx`. Attach `transition_idx`, `avg_transition_idx`, `transition_delta` to output. Per GAP sensor: attach `avg_transition_idx` only. |
| S7 | Velocity | DRAWIN forming segment: `v_x = diff(forming_X_cal) / dt`, `v_y = diff(forming_Y_cal) / dt`. |
| S8 | Displacement | DRAWIN forming segment: `di_x`, `di_y`, `di = √(di_x² + di_y²)`. |
| S9 | Flow angle | DRAWIN: `θ_flow = atan2(di_y, di_x)` from forming-segment displacement. |
| S10 | Cycle segmentation | Within forming segment only. DRAWIN: `t_start` from velocity threshold. GAP: `t_end` from BDC (argmax of abs within forming segment). |
| S11 | Draw-in prediction | P7: cross-sensor prediction on `forming_X_cal` (time domain). Stale detection on time-domain forming segment. Produces `forming_X_cal_predicted` in time domain. Corner sensors provide reference; middle sensors get predictions. |
| S12 | Kinematic normalization | Phase-domain resampling φ ∈ {0..1000} on the forming segment window defined by S10. Transforms both actual curves AND predicted curves (`forming_X_cal` → `X_cal_phi`, `forming_X_cal_predicted` → `X_cal_phi_predicted`). |
| S13 | Stick-slip energy | DRAWIN: `E_ss` from phase-domain velocity (requires S12). |
| S14 | Golden cycle | GAP: RMSE vs. golden reference + thinning detection (requires S12). |
| S15 | Publish | All sensors in the stroke → `dw-queue`, each with all data layers. |

## Data Layers Per Sensor

Each sensor message published to `dw-queue` contains multiple data layers.

### DRAWIN Sensor Output

| Field | Content | Domain |
|---|---|---|
| `X`, `Y` | Raw values as received from get-data | Time |
| `X_cal`, `Y_cal` | Calibrated full curve | Time |
| `closing_X_cal`, `closing_Y_cal` | Scaled curve `[0 : avg_transition_idx]` | Time |
| `forming_X_cal`, `forming_Y_cal` | Scaled curve `[avg_transition_idx : end]` | Time |
| `X_cal_phi`, `Y_cal_phi` | Phase-resampled forming segment | Phase |
| `v_x`, `v_y` | Velocity on forming segment | Time |
| `v_x_phi`, `v_y_phi` | Phase-domain velocity on forming segment | Phase |
| `di_x`, `di_y`, `di` | Total displacement (forming segment) | Scalar |
| `theta_flow` | Flow angle (forming segment) | Scalar |
| `E_ss_x`, `E_ss_y`, `E_ss_total` | Stick-slip energy | Scalar |
| `transition_idx` | Individual sensor transition index | Scalar |
| `avg_transition_idx` | Stroke-wide average transition index | Scalar |
| `transition_delta` | Individual − average | Scalar |
| `spm` | Instantaneous strokes per minute | Scalar |
| `t_start_idx`, `t_end_idx` | Forming window within forming segment | Scalar |
| **P7 Prediction (middle sensors only):** | | |
| `forming_X_cal_predicted` | Predicted forming curve (observed + predicted tail) | Time |
| `X_cal_phi_predicted` | Predicted forming curve (phase-transformed) | Phase |
| `di_predicted` | Predicted total displacement | Scalar |
| `di_x_predicted` | Predicted X displacement | Scalar |
| `stale_idx` | Time-domain index within forming segment where sensor went stale | Scalar |
| `prediction_confidence` | Confidence score 0..1 | Scalar |
| `prediction_noise_ratio` | Noise-to-signal ratio | Scalar |
| `prediction_method` | Algorithm identifier (`shape_selection`) | Scalar |
| `best_shape_idx` | Selected training shape index | Scalar |

P7 prediction fields are only present for middle sensors. Corner sensors do not receive predictions.

### GAP Sensor Output

| Field | Content | Domain |
|---|---|---|
| `X`, `Y`, `Z`, `Temp` | Raw values as received | Time |
| `abs` | 3D magnitude full curve `√(x²+y²+z²)` | Time |
| `abs_comp` | Thermally compensated full curve | Time |
| `closing_abs`, `closing_abs_comp` | Closing segment `[0 : avg_transition_idx]` | Time |
| `forming_abs`, `forming_abs_comp` | Forming segment `[avg_transition_idx : end]` | Time |
| `abs_phi` | Phase-resampled forming segment | Phase |
| `abs_comp_phi` | Phase-resampled compensated forming | Phase |
| `x_max`, `y_max`, `z_max`, `abs_max` | Max values (forming segment) | Scalar |
| `rmse_vs_golden` | RMSE against golden cycle | Scalar |
| `thinning_detected` | Boolean thinning flag | Scalar |
| `avg_transition_idx` | Stroke-wide average (from DRAWIN sensors) | Scalar |
| `spm` | Instantaneous strokes per minute | Scalar |

### Common Metadata (all sensors)

```json
{
  "timestamp": "<stroke_timestamp>",
  "die_id": "<die_id>",
  "hub_id": "<hub_id>",
  "sensor_id": "<sensor_id>",
  "hub_port": "<hub_port>",
  "switch_id": "<switch_id>",
  "switch_ip": "<switch_ip>"
}
```

## Stroke Completion & Sensor Exclusion

### Expected Sensor Count

Derived from existing Redis config per die (`config:{die_id}` in DB7), minus sensors in the exclusion set. Both DRAWIN and GAP sensors contribute to the expected count.

### Sensor Exclusion Set

**Key:** `excluded:{die_id}` in Redis DB7 — a Redis set of sensor IDs marked offline.

**Effect:** The accumulator subtracts excluded sensors from the expected count. A stroke with 16 total sensors and 2 excluded waits for 14.

**Management:** Backend API endpoint:
- `POST /api/v1/production/sensors/:id/exclude` — add sensor to exclusion set
- `DELETE /api/v1/production/sensors/:id/exclude` — remove sensor from exclusion set
- `GET /api/v1/production/sensors/excluded?dieId=<id>` — list excluded sensors

### Timeout Fallback

**Default timeout:** 30 seconds (configurable via `STROKE_TIMEOUT` env var).

**Behavior when timeout fires:**
1. Pass 2 runs with all sensors that have arrived so far.
2. Average transition computed from available DRAWIN sensors only.
3. Missing sensors are logged with a warning.
4. If zero DRAWIN sensors arrived, the stroke is dropped with an error log (no transition can be computed).
5. If DRAWIN sensors arrived but some GAP sensors are missing, the stroke proceeds — GAP analysis is simply absent for those sensors.

**Timeout mechanism:** Redis key expiry with a polling check in the consumer loop, or a dedicated timer thread per active stroke.

## Feature Flags

All existing feature flags are preserved. New flags:

| Flag | Default | Controls |
|------|---------|----------|
| `ENABLE_PHASE_TRANSITION` | `true` | S2: Individual transition detection |
| `ENABLE_STROKE_ACCUMULATION` | `true` | S3–S15: Full stroke-buffered mode. When `false`, falls back to legacy per-sensor processing for backward compatibility. |

Existing flags and their new scope:

| Flag | Default | New Scope |
|------|---------|-----------|
| `ENABLE_FLOW_ANGLE` | `true` | S9: computed on forming segment |
| `ENABLE_CYCLE_SEGMENTATION` | `true` | S10: within forming segment |
| `ENABLE_KINEMATIC_NORMALIZATION` | `true` | S12: on forming segment (actual + predicted curves) |
| `ENABLE_STICK_SLIP` | `true` | S13: requires S12 |
| `ENABLE_GOLDEN_CYCLE` | `true` | S14: requires S12 |
| `ENABLE_THERMAL_COMPENSATION` | `true` | S1: GAP thermal comp (before accumulation) |
| `ENABLE_PREDICTION` | `false` | S11: prediction in time domain, phase-transformed in S12 |

## Redis DB7 Schema

### Stroke Buffer

**Key pattern:** `stroke:{die_id}:{stroke_timestamp}`
**Type:** Hash
**TTL:** `STROKE_TIMEOUT` seconds (default 30)

| Hash Field | Value |
|---|---|
| `{sensor_id}:data` | JSON: `{ "sensor_name": "DRAWIN"\|"GAP", "scaled": { "X_cal": [...], "Y_cal": [...] } or { "abs": [...], "abs_comp": [...] }, "timestamps": [...], "time_seconds": [...], "transition_idx": N\|null, "metadata": {...} }` |
| `_received` | Comma-separated sensor IDs |
| `_expected` | Integer count (total − excluded) |

### Exclusion Set

**Key pattern:** `excluded:{die_id}`
**Type:** Redis Set
**TTL:** None (persistent until explicitly removed)

### Prediction Config (existing, unchanged)

**Key pattern:** `config:{die_id}`

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `processing/pipeline.py` | Route to stroke-buffered flow when `ENABLE_STROKE_ACCUMULATION` is true. Legacy path preserved behind flag. |
| `processing/config.py` | Add `ENABLE_PHASE_TRANSITION`, `ENABLE_STROKE_ACCUMULATION`, `STROKE_TIMEOUT` settings. |
| `processing/processors/drawin_base.py` | Split into Pass 1 function (calibrate + detect transition → return partial result for accumulator) and Pass 2 function (forming-segment analysis: velocity, displacement, flow angle). Remove inline P7 accumulation logic (moved to pipeline level). |
| `processing/processors/gap_base.py` | Split into Pass 1 function (calibrate + thermal comp → return partial result) and Pass 2 function (forming-segment analysis using avg_transition_idx: normalization, max values, golden cycle). |
| `processing/processors/stroke_accumulator.py` | Extend to handle both DRAWIN and GAP sensors. Add exclusion set logic. Add timeout handling. Store scaled curves + transition indices. |
| `processing/processors/drawin_prediction.py` | Adapt `PredictionEngine.predict()` to operate on time-domain `forming_X_cal` instead of phase-domain `X_cal_phi`. Stale detection on time-domain forming segment. |
| `processing/processors/stale_detection.py` | Adapt `detect_stale_point()` to accept time-domain signal (velocity via `np.diff` instead of phase-domain derivative). |
| `processing/models.py` | Add `StrokeResult` model for the cross-sensor output. |

### New Files

| File | Purpose |
|------|---------|
| `processing/processors/stroke_processor.py` | Pass 2 orchestrator: computes average transition, iterates all sensors, splits curves, runs forming-segment analysis (S4–S14), builds output messages for S15. |

### Test Files

| File | Purpose |
|------|---------|
| `tests/test_stroke_processor.py` | Cross-sensor processing: average transition computation, curve splitting, forming-segment analysis, prediction in time domain. |
| `tests/test_phase_transition_integration.py` | End-to-end: multiple DRAWIN + GAP sensors through both passes, verify all data layers present in output. |
| Updates to existing test files | Adjust for new Pass 1/Pass 2 split in `drawin_base` and `gap_base`. Adjust prediction tests for time-domain input. |

## Backward Compatibility

When `ENABLE_STROKE_ACCUMULATION=false`:
- Pipeline falls back to current per-sensor processing.
- No accumulation, no cross-sensor averaging.
- P12 transition detection still runs per-sensor if `ENABLE_PHASE_TRANSITION=true`, but the result is only used locally (no averaging).
- Output format remains unchanged from current behavior.

When `ENABLE_STROKE_ACCUMULATION=true` (new default):
- Output messages contain additional fields (closing/forming segments, transition metadata, predicted curves).
- The `database-writer` service must handle the new fields. Unknown fields should be stored as-is in the acquisition table's value column (existing behavior — the writer uses dynamic field insertion).

## Database Impact

The `database-writer` service inserts acquisition records with `(panel_id, sensor_id, field_id, value)`. New output fields (e.g., `closing_X_cal`, `forming_X_cal`, `forming_X_cal_predicted`, `transition_idx`, `avg_transition_idx`, `transition_delta`) will create new entries in the `field` table automatically if the writer handles unknown fields dynamically.

**Verification needed:** Confirm that `database-writer` inserts new field names into the `field` table on first encounter, or whether the field table needs to be pre-seeded.

## Open Questions

1. **Timer implementation:** Redis key expiry with polling vs. dedicated timer thread vs. delayed message re-queue. Recommend Redis expiry + polling as simplest approach consistent with current architecture.
2. **Pre-seeding field table:** Verify database-writer behavior with new field names.
