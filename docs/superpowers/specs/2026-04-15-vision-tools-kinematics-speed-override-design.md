# Strokmatic Vision Tools — Kinematics + Adjustable Car Speed (v1.3.0)

**Date:** 2026-04-15
**Product:** VisionKing (Strokmatic Vision Tools Blender add-on)
**Location:** `workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/motion_export/`
**Prerequisite:** Vision Tools v1.2.0 (built 2026-04-14)

## Problem Statement

The v1.2.0 motion exporter captures per-component body-local positions but delivers only spatial data. Engineering also needs:

1. **Velocity and acceleration profiles** for each actuator — to size motors, specify ramp times, and verify safe limits. These are derivatives of position data we already have.

2. **An adjustable car speed** — the `.blend` animation runs the car at whatever speed Tiago designed it at (currently ~350 mm/s on the v4 GM scene). Engineering may need to evaluate the same spatial layout at a different production speed (e.g. 500 mm/s, 1000 mm/s) to check whether the actuators can keep up. Re-animating the scene each time is impractical; re-scaling the time axis of the export is sufficient since the spatial relationships don't change.

Both are additive and backward-compatible with v1.2.0 output.

## Domain Context

- The v4 GM scene has the car moving at 350 mm/s along +Y axis (computed: 7000 mm over 20 s, twice — two camera passes).
- Real production speeds may be higher. Engineering wants a knob to evaluate "what if the car moves at X mm/s?" without editing keyframes.
- Actuator velocity and acceleration limits are typically in the single-digit m/s and g (≈10 m/s²) range. The current v4 N15-high rig goes from 2130 to 2760 mm in about 2.5 s — roughly 250 mm/s peak velocity with significant acceleration during the ramp.

## Solution

Two additive features:

1. **Per-component kinematics CSV** — for every `<component>.csv` in the export, emit an accompanying `<component>_kinematics.csv` with velocity and acceleration (numerical derivatives).

2. **Adjustable car speed** — a UI field that overrides the car's detected speed. When set, the tool linearly rescales the `time_s` axis of every CSV (and the corresponding velocity/acceleration values) as if the entire motion sequence had been animated at the target speed.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Kinematics output format | Separate `*_kinematics.csv` per component | Cleaner separation of position vs. derivatives; engineering can open pos + kin side-by-side |
| Derivative method | Central-difference numerical derivative | Standard and sufficient; 2nd-order accurate; endpoints use forward/backward |
| Speed detection axis | Auto-detect by largest-range translation channel on car reference | Works for any sweep direction without config |
| Speed override unit | mm/s (integer input) | Matches engineering hand-off convention; same as position unit |
| Override default | 0 = auto-detect mode | Zero is never a valid physical speed, so it's a safe sentinel |
| Time rescaling | Linear scale of `time_s` column; position unchanged; velocity/accel rescaled | Preserves the spatial motion law while changing its execution speed |

## Tool Specification

### Car Speed Detection

At the end of the sampling pass (when all samples have been collected), compute:

```
ranges = {axis: max(positions[axis]) - min(positions[axis]) for axis in "XYZ"}
detected_axis = axis with maximum range
range_mm = ranges[detected_axis]  # in millimeters (already converted)
total_time_s = (sample_count - 1) * stride / fps
detected_speed_mm_s = range_mm / total_time_s
```

This is the **average** speed across the animation. Non-linear animations (car accelerates, pauses, etc.) are treated as having a single representative average speed. A more sophisticated per-frame car speed could be computed from `car_motion.csv` itself, but the average is what the time-rescale uses.

When the car motion is effectively zero (range < 1 mm), detection returns `(None, 0.0)` and the override is ignored.

### Override Semantics

User provides `override_speed_mm_s`. Behavior:

- `override_speed_mm_s == 0` (or absent/None): use detected speed, no rescaling
- `override_speed_mm_s > 0` and `detected_speed_mm_s > 0`:
  - `time_scale_factor = detected_speed_mm_s / override_speed_mm_s`
  - All `time_s` values multiplied by `time_scale_factor`
  - All velocities multiplied by `1 / time_scale_factor` (= override/detected — faster car = higher velocities)
  - All accelerations multiplied by `(1 / time_scale_factor) ** 2` (= (override/detected)²)
- `override_speed_mm_s > 0` but `detected_speed_mm_s == 0` (car didn't move in animation): override is ignored, a warning is logged in the manifest, no rescaling occurs

### Manifest Additions

New top-level block `car_speed`:

```json
{
  "car_speed": {
    "detected_axis": "Y",
    "detected_mm_s": 350.09,
    "override_mm_s": 0,
    "used_mm_s": 350.09,
    "time_scale_factor": 1.0
  }
}
```

When override is active:

```json
{
  "car_speed": {
    "detected_axis": "Y",
    "detected_mm_s": 350.09,
    "override_mm_s": 500.0,
    "used_mm_s": 500.0,
    "time_scale_factor": 0.7002
  }
}
```

### Kinematics CSV Format

For each component `<name>.csv`, an additional `<name>_kinematics.csv`:

```
frame,time_s,vx_mm_s,vy_mm_s,vz_mm_s,vrx_deg_s,vry_deg_s,vrz_deg_s,ax_mm_s2,ay_mm_s2,az_mm_s2,arx_deg_s2,ary_deg_s2,arz_deg_s2
```

- `time_s` matches the position CSV (after any rescaling)
- Velocities: mm/s for translation, deg/s for rotation
- Accelerations: mm/s² for translation, deg/s² for rotation
- Numerical derivative method:
  - Interior samples: central difference `v[i] = (x[i+1] - x[i-1]) / (2 * dt_rescaled)`
  - First sample: forward difference `v[0] = (x[1] - x[0]) / dt_rescaled`
  - Last sample: backward difference `v[-1] = (x[-1] - x[-2]) / dt_rescaled`
  - Same applied for acceleration, operating on the computed velocity sequence
- Where `dt_rescaled = (time_s[i+1] - time_s[i])` — consistent with the rescaled time axis

The car reference also gains `car_motion_kinematics.csv` with the same structure (showing the car's own velocity profile — should be a constant ≈ detected_speed in the active axis for linear sweeps).

### UI Additions

New fields in the Motion Export section of `SKM_PT_VisionTools`:

| Field | Type | Description |
|-------|------|-------------|
| **Override Car Speed (mm/s)** | Float, default 0.0, min 0.0 | 0 = auto-detect from animation; > 0 = rescale time axis |
| **Detected Speed** (read-only label) | Label | Shown only after a successful export — populated from the last-run manifest |

The scene property name: `skm_motion_override_speed_mm_s`.

The "Detected Speed" label is optional polish — it can be derived from an in-memory state set by the export operator. If we don't implement state-keeping, we document the detected speed as part of the success message (the operator's `self.report` already surfaces info text).

### Public API Change

```python
def export_motion(context, output_path, sample_rate_hz=None, frame_start=None,
                  frame_end=None, auto_detect=True,
                  override_speed_mm_s=None):
    ...
```

New parameter `override_speed_mm_s`: float or None. None/0 = use detected speed. `>0` = time-rescale.

### Module Changes

**`motion_export/analyzer.py`** — add three functions (no signature changes to existing):

```python
def detect_car_speed(car_samples, total_time_s):
    """Find the axis with largest range on the car reference and return
    (axis_name, speed_mm_s). Returns (None, 0.0) if no motion."""
    ...

def compute_kinematics(samples_by_frame, dt_s):
    """Compute velocity and acceleration arrays from a (N, 6) position
    array. Returns (velocity, acceleration) arrays of same shape. Uses
    central difference with forward/backward at endpoints. ``dt_s`` is
    a scalar (uniform stride assumed)."""
    ...

def apply_time_scale(samples, scale_factor):
    """Return a new samples list with time_s multiplied by scale_factor.
    Does not mutate the input."""
    ...
```

**`motion_export/writer.py`** — add:

```python
def kinematics_csv_rows(samples, component_name, kinematics_by_component):
    """Build kinematics CSV rows (header + data) for one component."""
    ...
```

And update `write_motion_zip()` to also write `components/<name>_kinematics.csv` for each component (and `car_motion_kinematics.csv`).

**`motion_export/__init__.py`** — `export_motion` orchestrates:

1. Sample positions (existing)
2. Call `detect_car_speed` → determine actual speed + axis
3. If `override_speed_mm_s > 0` and detected > 0 → compute `time_scale_factor` and apply via `apply_time_scale`
4. Convert position samples to numpy arrays per component
5. Call `compute_kinematics` per component (using rescaled `dt_s = stride / fps * scale_factor`)
6. Build manifest (add `car_speed` block)
7. Call `write_motion_zip` with both position and kinematics data

**`motion_export/operators.py`** — `SKM_OT_ExportMotion.execute` passes `scene.skm_motion_override_speed_mm_s` to `export_motion`. If the detected speed is reported in the manifest, surface it in the success report: `"Detected: 350 mm/s; Using: 500 mm/s"`.

**`strokmatic_vision_tools/ui_panel.py`** — add `skm_motion_override_speed_mm_s: FloatProperty(default=0.0, min=0.0, ...)` plus the UI field in the Motion Export section.

**`strokmatic_vision_tools/__init__.py`** — version bump to `(1, 3, 0)`, description unchanged.

**`strokmatic_vision_tools/blender_manifest.toml`** — `version = "1.3.0"`.

### Testing

**Pure Python additions to `tests/test_motion_export_units.py`:**

- `test_compute_kinematics_constant_velocity`: linearly increasing position → constant velocity, zero acceleration
- `test_compute_kinematics_zero_motion`: constant position → zero velocity, zero acceleration
- `test_compute_kinematics_quadratic_position`: `x = t²` → `v = 2t`, `a = 2` (uniform acceleration)
- `test_detect_car_speed_largest_range_y`: samples with largest range on Y → returns ("Y", speed_mm_s)
- `test_detect_car_speed_zero_motion`: constant samples → returns (None, 0.0)
- `test_apply_time_scale_halves_time`: scale factor 0.5 → time_s values halved, positions unchanged

**Integration additions to `tests/test_motion_export_integration.py`:**

- `test_export_with_override_rescales_time_axis`: export at 100 fps scene with detected speed 10 mm/s, override 20 mm/s → verify last `time_s` ≈ (frame_count / fps) * 0.5
- `test_export_includes_kinematics_csvs`: export default, verify ZIP contains `components/<name>_kinematics.csv` for each component and `car_motion_kinematics.csv`
- `test_manifest_contains_car_speed_block`: verify `manifest["car_speed"]` has all 5 keys

### Performance

Negligible — the derivative computations are two numpy `diff` calls per component. All work is already O(N) in the number of samples.

### Out of Scope

- Non-linear time remapping (keyframe → keyframe speed control). Only constant-factor rescaling is supported.
- Per-frame speed analysis of the car (e.g. detecting acceleration phases in the source animation). The detected_speed is a single scalar average.
- Smoothing / filtering of the numerical derivative. Central difference is used as-is; noisy input animation will produce noisy derivatives.
- Actuator limit checking (warning when peak velocity/acceleration exceeds engineering thresholds). Engineering reviews the output.
