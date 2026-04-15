# Vision Tools v1.3.0 — Kinematics + Adjustable Car Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-component velocity/acceleration derivative CSVs and an adjustable car speed (override) to the Motion Export feature in the Strokmatic Vision Tools Blender add-on.

**Architecture:** Three additions to the existing `motion_export/` sub-package — a pair of new analyzer functions (`detect_car_speed`, `compute_kinematics`, `apply_time_scale`), a new writer helper for kinematics CSVs, and a time-rescaling pass in `export_motion` between sampling and manifest construction. UI gains one new scene property for speed override. No breaking changes to existing API or manifest fields.

**Tech Stack:** Blender Python API (`bpy`), numpy (bundled), Python stdlib (`csv`, `json`).

**Spec:** `docs/superpowers/specs/2026-04-15-vision-tools-kinematics-speed-override-design.md`

**Base path:** `workspaces/strokmatic/sdk/sdk-blender-tools/`

---

## Testing Approach

Same pattern as v1.2.0:
- **Pure Python** (analyzer math, time scaling, derivatives): `python3 tests/test_motion_export_units.py`
- **Blender** (full integration including file writing): `blender --background --python tests/test_motion_export_integration.py`
- All pure-Python test files must import from the module file directly (not through the package) to avoid triggering `__init__.py` which imports `bpy`.

---

## File Structure

```
strokmatic_vision_tools/
├── __init__.py                      # Modify: version to (1, 3, 0)
├── blender_manifest.toml            # Modify: version to "1.3.0"
├── ui_panel.py                      # Modify: add skm_motion_override_speed_mm_s property + UI field
└── motion_export/
    ├── __init__.py                  # Modify: export_motion signature + orchestration
    ├── sampler.py                   # Unchanged
    ├── analyzer.py                  # Modify: add detect_car_speed, compute_kinematics, apply_time_scale
    ├── writer.py                    # Modify: add kinematics_csv_rows; update write_motion_zip
    └── operators.py                 # Modify: pass override_speed to export_motion

tests/
├── test_motion_export_units.py      # Modify: add 6 new tests for kinematics + speed detect + time scale
└── test_motion_export_integration.py # Modify: add 3 new tests for override + kinematics CSVs + manifest
```

---

## Task 1: Analyzer additions (pure Python)

**Files:**
- Modify: `strokmatic_vision_tools/motion_export/analyzer.py`
- Modify: `tests/test_motion_export_units.py`

- [ ] **Step 1: Add new tests to `tests/test_motion_export_units.py`**

Append the following to the existing test file (after the final existing test, before the `if __name__` block):

```python
def test_compute_kinematics_constant_velocity():
    """x = 2*t → v = 2, a = 0."""
    import numpy as np
    from analyzer import compute_kinematics
    N = 10
    dt_s = 0.1
    pos = np.zeros((N, 6), dtype=np.float64)
    pos[:, 1] = np.arange(N) * 0.2  # 2 units/s in Y: x(t) = 0.2 * frame_idx, dt=0.1 → v_y = 2
    vel, acc = compute_kinematics(pos, dt_s)
    # Interior points: v_y ≈ 2, a_y ≈ 0
    assert abs(vel[5, 1] - 2.0) < 1e-6, f"Interior velocity Y should be 2, got {vel[5, 1]}"
    assert abs(acc[5, 1]) < 1e-6, f"Interior acceleration Y should be 0, got {acc[5, 1]}"


def test_compute_kinematics_zero_motion():
    """Constant position → zero velocity, zero acceleration."""
    import numpy as np
    from analyzer import compute_kinematics
    pos = np.ones((5, 6), dtype=np.float64) * 3.0
    vel, acc = compute_kinematics(pos, 0.1)
    assert np.allclose(vel, 0.0)
    assert np.allclose(acc, 0.0)


def test_compute_kinematics_quadratic_position():
    """x(t) = t² → v(t) = 2t, a(t) = 2 (uniform acceleration)."""
    import numpy as np
    from analyzer import compute_kinematics
    N = 20
    dt_s = 0.05
    t = np.arange(N) * dt_s
    pos = np.zeros((N, 6), dtype=np.float64)
    pos[:, 0] = t ** 2  # x = t²
    vel, acc = compute_kinematics(pos, dt_s)
    # Interior acceleration should be ≈ 2 everywhere (central difference is exact for quadratic)
    assert abs(acc[N // 2, 0] - 2.0) < 1e-4, f"Expected a≈2, got {acc[N // 2, 0]}"
    # Interior velocity at t=N//2 * dt_s should be ≈ 2 * t
    expected_v = 2.0 * (N // 2) * dt_s
    assert abs(vel[N // 2, 0] - expected_v) < 1e-4, f"Expected v≈{expected_v}, got {vel[N // 2, 0]}"


def test_detect_car_speed_largest_range_y():
    """Car samples with largest range on Y → returns ('Y', speed_mm_s)."""
    import numpy as np
    from analyzer import detect_car_speed
    # 10 samples, total_time_s = 1s, Y moves from -5 to 5 (range = 10 units = 10_000 mm)
    N = 10
    total_time_s = 1.0
    car_samples = np.zeros((N, 6), dtype=np.float64)
    car_samples[:, 1] = np.linspace(-5.0, 5.0, N)  # Y channel in meters
    axis, speed = detect_car_speed(car_samples, total_time_s)
    assert axis == "Y", f"Expected Y, got {axis}"
    # Range 10m over 1s → 10,000 mm/s
    assert abs(speed - 10000.0) < 1e-3, f"Expected 10000 mm/s, got {speed}"


def test_detect_car_speed_zero_motion():
    """Constant car samples → (None, 0.0)."""
    import numpy as np
    from analyzer import detect_car_speed
    car_samples = np.ones((10, 6), dtype=np.float64)
    axis, speed = detect_car_speed(car_samples, 1.0)
    assert axis is None
    assert speed == 0.0


def test_apply_time_scale_halves_time():
    """scale_factor 0.5 → time_s values halved; positions unchanged."""
    from analyzer import apply_time_scale
    samples = [
        {"frame": 0, "time_s": 0.0, "transforms": {"a": (1.0, 2.0, 3.0, 0, 0, 0)},
         "car_world": {"_car": (0, -1, 0, 0, 0, 0)}},
        {"frame": 10, "time_s": 1.0, "transforms": {"a": (1.1, 2.1, 3.1, 0, 0, 0)},
         "car_world": {"_car": (0, 0, 0, 0, 0, 0)}},
        {"frame": 20, "time_s": 2.0, "transforms": {"a": (1.2, 2.2, 3.2, 0, 0, 0)},
         "car_world": {"_car": (0, 1, 0, 0, 0, 0)}},
    ]
    scaled = apply_time_scale(samples, 0.5)
    assert scaled[0]["time_s"] == 0.0
    assert abs(scaled[1]["time_s"] - 0.5) < 1e-9
    assert abs(scaled[2]["time_s"] - 1.0) < 1e-9
    # Positions unchanged
    assert scaled[1]["transforms"]["a"] == (1.1, 2.1, 3.1, 0, 0, 0)
    assert scaled[1]["car_world"]["_car"] == (0, 0, 0, 0, 0, 0)
    # Frame unchanged
    assert scaled[1]["frame"] == 10
    # Original is not mutated
    assert samples[1]["time_s"] == 1.0
```

Also update the `if __name__ == "__main__":` block at the bottom — add calls to each new test so they all run:

```python
    test_compute_kinematics_constant_velocity()
    test_compute_kinematics_zero_motion()
    test_compute_kinematics_quadratic_position()
    test_detect_car_speed_largest_range_y()
    test_detect_car_speed_zero_motion()
    test_apply_time_scale_halves_time()
```

- [ ] **Step 2: Run tests — verify failures**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_motion_export_units.py 2>&1 | tail -15
```

Expected: `ImportError` or `AttributeError` on `detect_car_speed` / `compute_kinematics` / `apply_time_scale`.

- [ ] **Step 3: Add the three new functions to `strokmatic_vision_tools/motion_export/analyzer.py`**

Append to the bottom of the existing file (after the existing `analyze_channels` function):

```python
# ---------------------------------------------------------------------------
# Car speed detection, kinematics, time rescaling (v1.3.0)
# ---------------------------------------------------------------------------

import numpy as _np


# Minimum range (in Blender meters) to consider the car "moving" on an axis
_CAR_SPEED_MOTION_THRESHOLD_M = 0.001  # 1 mm


def detect_car_speed(car_samples, total_time_s):
    """Detect the car reference's sweep axis and average speed.

    The axis with the largest range across all samples is declared the
    sweep axis. Speed is ``range_mm / total_time_s``.

    Args:
        car_samples: numpy array of shape (N, 6) with columns
            (x, y, z, rx, ry, rz) in Blender internal units (m, rad).
        total_time_s: Total elapsed time across the sampled frames.

    Returns:
        Tuple (axis_name, speed_mm_s). ``axis_name`` is one of "X", "Y",
        "Z" or None if no motion exceeds the threshold. ``speed_mm_s``
        is 0.0 in that case.
    """
    if car_samples.shape[0] < 2 or total_time_s <= 0:
        return (None, 0.0)

    ranges_m = {}
    for col, name in enumerate(("X", "Y", "Z")):
        r = float(car_samples[:, col].max() - car_samples[:, col].min())
        ranges_m[name] = r

    best_axis = max(ranges_m, key=ranges_m.get)
    best_range = ranges_m[best_axis]
    if best_range < _CAR_SPEED_MOTION_THRESHOLD_M:
        return (None, 0.0)

    speed_mm_s = convert_translation_to_mm(best_range) / total_time_s
    return (best_axis, round(speed_mm_s, 6))


def compute_kinematics(positions, dt_s):
    """Compute velocity and acceleration from a sequence of positions.

    Uses central-difference for interior samples and forward/backward
    difference at the endpoints. Rotation channels (columns 3-5) are
    handled identically — the caller is responsible for unit conversion
    (rad vs. deg) on the output if desired; this function's outputs are
    in ``units/s`` and ``units/s²`` where ``units`` are the input's
    (i.e. meters + radians, matching ``samples_by_frame``).

    Args:
        positions: numpy array of shape (N, 6) with columns
            (x, y, z, rx, ry, rz) in Blender internal units.
        dt_s: Scalar time delta between consecutive samples (seconds).

    Returns:
        Tuple (velocity, acceleration) — both numpy arrays of shape (N, 6).
    """
    if positions.shape[0] < 2:
        zero = _np.zeros_like(positions)
        return zero, zero

    N = positions.shape[0]
    velocity = _np.zeros_like(positions, dtype=_np.float64)
    acceleration = _np.zeros_like(positions, dtype=_np.float64)

    # Velocity: central difference for interior, forward/backward at endpoints
    velocity[0] = (positions[1] - positions[0]) / dt_s
    velocity[-1] = (positions[-1] - positions[-2]) / dt_s
    if N > 2:
        velocity[1:-1] = (positions[2:] - positions[:-2]) / (2.0 * dt_s)

    # Acceleration: same pattern applied to velocity
    acceleration[0] = (velocity[1] - velocity[0]) / dt_s
    acceleration[-1] = (velocity[-1] - velocity[-2]) / dt_s
    if N > 2:
        acceleration[1:-1] = (velocity[2:] - velocity[:-2]) / (2.0 * dt_s)

    return velocity, acceleration


def apply_time_scale(samples, scale_factor):
    """Return a new samples list with time_s multiplied by scale_factor.

    Does not mutate the input. Preserves all other keys (frame,
    transforms, car_world) as-is.

    Args:
        samples: List of sample dicts with a "time_s" float field.
        scale_factor: Positive float to multiply time_s by.

    Returns:
        New list of shallow-copied sample dicts.
    """
    return [
        {**s, "time_s": round(s["time_s"] * scale_factor, 6)}
        for s in samples
    ]
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_motion_export_units.py 2>&1 | tail -5
```

Expected: `OK: all motion_export units tests passed` (now covering 18 tests including the 6 new ones).

- [ ] **Step 5: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/analyzer.py tests/test_motion_export_units.py
git commit -m "feat(motion_export): add detect_car_speed, compute_kinematics, apply_time_scale analyzer helpers"
```

---

## Task 2: Writer additions — kinematics CSVs

**Files:**
- Modify: `strokmatic_vision_tools/motion_export/writer.py`
- Modify: `tests/test_motion_export_writer.py`

- [ ] **Step 1: Add tests to `tests/test_motion_export_writer.py`**

Append before the `if __name__` block:

```python
def test_kinematics_csv_rows_header_and_units():
    """Kinematics rows have the correct header with v/a columns in mm/s and deg/s."""
    sys_path = os.path.join(os.path.dirname(__file__), "..", "strokmatic_vision_tools", "motion_export")
    if sys_path not in sys.path:
        sys.path.insert(0, sys_path)
    from writer import kinematics_csv_rows
    import numpy as np

    samples = [
        {"frame": 0, "time_s": 0.0, "transforms": {"compA": (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)}},
        {"frame": 1, "time_s": 0.1, "transforms": {"compA": (0.1, 0.0, 0.0, 0.0, 0.0, 0.0)}},
        {"frame": 2, "time_s": 0.2, "transforms": {"compA": (0.2, 0.0, 0.0, 0.0, 0.0, 0.0)}},
    ]
    # Velocity X = 1 m/s = 1000 mm/s (constant along X)
    vel = np.zeros((3, 6))
    vel[:, 0] = 1.0  # 1 m/s
    acc = np.zeros((3, 6))
    kin_by_comp = {"compA": (vel, acc)}

    rows = kinematics_csv_rows(samples, "compA", kin_by_comp)
    assert rows[0] == [
        "frame", "time_s",
        "vx_mm_s", "vy_mm_s", "vz_mm_s",
        "vrx_deg_s", "vry_deg_s", "vrz_deg_s",
        "ax_mm_s2", "ay_mm_s2", "az_mm_s2",
        "arx_deg_s2", "ary_deg_s2", "arz_deg_s2",
    ]
    # First data row: frame=0, time_s=0.0, vx=1000 mm/s, other zeros
    assert rows[1][0] == 0
    assert rows[1][1] == 0.0
    assert rows[1][2] == 1000.0  # 1 m/s → 1000 mm/s
    assert rows[1][3] == 0.0
    assert rows[1][8] == 0.0  # ax = 0


def test_write_motion_zip_includes_kinematics():
    """Writer should emit kinematics CSVs alongside position CSVs."""
    import tempfile
    import zipfile
    import numpy as np

    sys_path = os.path.join(os.path.dirname(__file__), "..", "strokmatic_vision_tools", "motion_export")
    if sys_path not in sys.path:
        sys.path.insert(0, sys_path)
    from writer import write_motion_zip

    samples = [
        {"frame": 0, "time_s": 0.0, "transforms": {"compA": (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)}},
        {"frame": 1, "time_s": 0.1, "transforms": {"compA": (0.1, 0.0, 0.0, 0.0, 0.0, 0.0)}},
    ]
    car_samples = [
        {"frame": 0, "time_s": 0.0, "transforms": {"_car": (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)}},
        {"frame": 1, "time_s": 0.1, "transforms": {"_car": (0.0, 0.5, 0.0, 0.0, 0.0, 0.0)}},
    ]
    vel = np.zeros((2, 6))
    acc = np.zeros((2, 6))
    kin = {
        "compA": (vel.copy(), acc.copy()),
        "_car": (vel.copy(), acc.copy()),
    }
    manifest = {
        "car_reference": "car",
        "frame_range": [0, 1],
        "sample_rate_hz": 10,
        "stride": 1,
        "samples": 2,
        "fps": 10,
        "scene": "Scene",
        "blend_file": "test.blend",
        "exported_at": "2026-04-15T00:00:00Z",
        "units": {"translation": "mm", "rotation": "degrees", "time": "seconds"},
        "car_speed": {
            "detected_axis": "Y", "detected_mm_s": 5000.0,
            "override_mm_s": 0, "used_mm_s": 5000.0, "time_scale_factor": 1.0,
        },
        "components": [{
            "name": "compA", "type": "MESH", "csv": "components/compA.csv",
            "channels": {ch: {"free": False, "value": 0.0} for ch in (
                "x_mm", "y_mm", "z_mm", "rx_deg", "ry_deg", "rz_deg")},
        }],
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        out = os.path.join(tmpdir, "motion.zip")
        write_motion_zip(
            output_path=out, manifest=manifest,
            car_motion_samples=car_samples, component_samples=samples,
            kinematics_by_component=kin,
        )
        with zipfile.ZipFile(out, "r") as zf:
            names = sorted(zf.namelist())
            assert "components/compA.csv" in names
            assert "components/compA_kinematics.csv" in names
            assert "car_motion_kinematics.csv" in names
```

Update the `if __name__ == "__main__":` block to include both new tests.

- [ ] **Step 2: Run writer tests — verify failures**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_motion_export_writer.py 2>&1 | tail -5
```

Expected: `ImportError` on `kinematics_csv_rows`, or `TypeError` about unexpected `kinematics_by_component` argument.

- [ ] **Step 3: Update `strokmatic_vision_tools/motion_export/writer.py`**

Add the kinematics header constant after the existing `CSV_HEADER`:

```python
KINEMATICS_HEADER = [
    "frame", "time_s",
    "vx_mm_s", "vy_mm_s", "vz_mm_s",
    "vrx_deg_s", "vry_deg_s", "vrz_deg_s",
    "ax_mm_s2", "ay_mm_s2", "az_mm_s2",
    "arx_deg_s2", "ary_deg_s2", "arz_deg_s2",
]
```

Add the new function after `component_csv_rows`:

```python
def kinematics_csv_rows(samples, component_name, kinematics_by_component):
    """Build kinematics CSV rows (header + data) for one component.

    Args:
        samples: Same list-of-dict structure as component_csv_rows. Used
            only for the per-row ``frame`` and ``time_s`` columns.
        component_name: Which component's kinematics to write.
        kinematics_by_component: Dict mapping component name to a tuple
            (velocity_array, acceleration_array). Each array is numpy
            shape (N, 6) matching the order of ``samples``; values are
            in Blender internal units (m/s, rad/s, m/s², rad/s²).

    Returns:
        List of rows (lists). First row is the header.

    Raises:
        KeyError: If component_name missing from kinematics_by_component.
    """
    if component_name not in kinematics_by_component:
        raise KeyError(f"Component '{component_name}' missing from kinematics map")

    velocity, acceleration = kinematics_by_component[component_name]
    rows = [list(KINEMATICS_HEADER)]
    for i, s in enumerate(samples):
        vx, vy, vz, vrx, vry, vrz = velocity[i]
        ax, ay, az, arx, ary, arz = acceleration[i]
        rows.append([
            s["frame"],
            s["time_s"],
            round(convert_translation_to_mm(vx), 6),
            round(convert_translation_to_mm(vy), 6),
            round(convert_translation_to_mm(vz), 6),
            round(convert_rotation_to_degrees(vrx), 6),
            round(convert_rotation_to_degrees(vry), 6),
            round(convert_rotation_to_degrees(vrz), 6),
            round(convert_translation_to_mm(ax), 6),
            round(convert_translation_to_mm(ay), 6),
            round(convert_translation_to_mm(az), 6),
            round(convert_rotation_to_degrees(arx), 6),
            round(convert_rotation_to_degrees(ary), 6),
            round(convert_rotation_to_degrees(arz), 6),
        ])
    return rows
```

Update `write_motion_zip` to accept and use kinematics data. Replace the function body with:

```python
def write_motion_zip(output_path, manifest, car_motion_samples, component_samples,
                    kinematics_by_component=None):
    """Write the full motion export ZIP.

    Args:
        output_path: Absolute path of the .zip to write.
        manifest: Dict; will be serialized to manifest.json.
        car_motion_samples: The car reference's own world position samples.
            Component key inside transforms is "_car".
        component_samples: List of sample dicts for all tracked components.
        kinematics_by_component: Optional dict mapping component name
            (including "_car") to (velocity, acceleration) numpy arrays.
            When provided, emits a *_kinematics.csv for each entry.
    """
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

        car_rows = component_csv_rows(car_motion_samples, "_car")
        zf.writestr("car_motion.csv", _rows_to_csv_bytes(car_rows))

        for comp in manifest["components"]:
            name = comp["name"]
            csv_path = comp["csv"]
            rows = component_csv_rows(component_samples, name)
            zf.writestr(csv_path, _rows_to_csv_bytes(rows))

        if kinematics_by_component:
            # Car kinematics
            if "_car" in kinematics_by_component:
                car_kin_rows = kinematics_csv_rows(
                    car_motion_samples, "_car", kinematics_by_component
                )
                zf.writestr("car_motion_kinematics.csv", _rows_to_csv_bytes(car_kin_rows))
            # Per-component kinematics
            for comp in manifest["components"]:
                name = comp["name"]
                if name in kinematics_by_component:
                    kin_path = comp["csv"].replace(".csv", "_kinematics.csv")
                    kin_rows = kinematics_csv_rows(
                        component_samples, name, kinematics_by_component
                    )
                    zf.writestr(kin_path, _rows_to_csv_bytes(kin_rows))
```

- [ ] **Step 4: Run writer tests — verify they pass**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_motion_export_writer.py 2>&1 | tail -5
```

Expected: `OK: all motion_export writer tests passed`.

- [ ] **Step 5: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/writer.py tests/test_motion_export_writer.py
git commit -m "feat(motion_export): writer — kinematics_csv_rows + write_motion_zip kinematics support"
```

---

## Task 3: Orchestration — `export_motion` wiring

**Files:**
- Modify: `strokmatic_vision_tools/motion_export/__init__.py`
- Modify: `tests/test_motion_export_integration.py`

- [ ] **Step 1: Add integration tests to `tests/test_motion_export_integration.py`**

Append before the `if __name__` block (retain all existing tests):

```python
def test_manifest_contains_car_speed_block():
    """Default export manifest should include car_speed with all 5 keys."""
    scene, car, cz, cxyz, stationary, tagged = _build_scene()

    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = os.path.join(tmpdir, "motion.zip")
        manifest = export_motion(
            context=bpy.context, output_path=out_path,
            sample_rate_hz=24, frame_start=0, frame_end=100, auto_detect=True,
        )
    assert "car_speed" in manifest
    cs = manifest["car_speed"]
    for key in ("detected_axis", "detected_mm_s", "override_mm_s",
                "used_mm_s", "time_scale_factor"):
        assert key in cs, f"car_speed missing key {key}: {cs}"
    # Car moves +1m in Y over 100 frames at 24fps ≈ 4.17s → ~240 mm/s
    assert cs["detected_axis"] == "Y"
    assert 200 < cs["detected_mm_s"] < 300
    assert cs["override_mm_s"] == 0
    assert cs["used_mm_s"] == cs["detected_mm_s"]
    assert cs["time_scale_factor"] == 1.0


def test_export_with_override_rescales_time_axis():
    """Override = 2 * detected → time_s values halved."""
    scene, car, cz, cxyz, stationary, tagged = _build_scene()

    import csv
    import tempfile
    import zipfile
    with tempfile.TemporaryDirectory() as tmpdir:
        # First run default to measure detected speed
        base_path = os.path.join(tmpdir, "base.zip")
        base = export_motion(
            context=bpy.context, output_path=base_path,
            sample_rate_hz=24, frame_start=0, frame_end=100, auto_detect=True,
        )
        detected = base["car_speed"]["detected_mm_s"]
        assert detected > 0, "Detected speed must be > 0 to test override"

        # Now run with override at 2x the detected speed
        target = detected * 2.0
        over_path = os.path.join(tmpdir, "over.zip")
        over = export_motion(
            context=bpy.context, output_path=over_path,
            sample_rate_hz=24, frame_start=0, frame_end=100, auto_detect=True,
            override_speed_mm_s=target,
        )
        assert abs(over["car_speed"]["time_scale_factor"] - 0.5) < 1e-3
        assert abs(over["car_speed"]["used_mm_s"] - target) < 1e-3

        # Read one component CSV and confirm time_s is halved vs base
        with zipfile.ZipFile(base_path) as zb, zipfile.ZipFile(over_path) as zo:
            base_rows = list(csv.reader(zb.read("components/comp_z.csv").decode().splitlines()))
            over_rows = list(csv.reader(zo.read("components/comp_z.csv").decode().splitlines()))
            base_last_t = float(base_rows[-1][1])
            over_last_t = float(over_rows[-1][1])
            # Allow 1% tolerance
            assert abs(over_last_t - base_last_t * 0.5) < 0.01, \
                f"Expected override time_s = base * 0.5, got base={base_last_t} over={over_last_t}"


def test_export_includes_kinematics_csvs():
    """Default export writes a _kinematics.csv per component + car."""
    scene, car, cz, cxyz, stationary, tagged = _build_scene()

    import tempfile
    import zipfile
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = os.path.join(tmpdir, "motion.zip")
        export_motion(
            context=bpy.context, output_path=out_path,
            sample_rate_hz=24, frame_start=0, frame_end=100, auto_detect=True,
        )
        with zipfile.ZipFile(out_path) as zf:
            names = set(zf.namelist())
            assert "car_motion_kinematics.csv" in names
            assert "components/comp_z_kinematics.csv" in names
            assert "components/comp_xyz_kinematics.csv" in names
            # Kinematics header includes velocity and acceleration columns
            header = zf.read("components/comp_z_kinematics.csv").decode().splitlines()[0]
            assert "vx_mm_s" in header
            assert "ax_mm_s2" in header
```

Update `if __name__ == "__main__":` to add calls for the three new tests.

- [ ] **Step 2: Run integration tests — verify failures**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_motion_export_integration.py 2>&1 | tail -10
```

Expected: failures on the three new tests (unexpected `override_speed_mm_s` parameter, missing `car_speed` manifest key, missing kinematics CSVs).

- [ ] **Step 3: Update `strokmatic_vision_tools/motion_export/__init__.py`**

Replace the file with the following version (incorporates the three new concerns: car-speed detection, override rescaling, kinematics computation):

```python
"""Motion curve exporter sub-package.

Exports body-relative motion of all moving components across the scene's
frame range as a ZIP with manifest.json + per-component position and
kinematics CSVs.

Public API: ``export_motion(context, output_path, ...)``
"""
import datetime
import os

import bpy
import numpy as np

from .analyzer import (
    CHANNEL_NAMES,
    analyze_channels,
    apply_time_scale,
    compute_kinematics,
    compute_sample_stride,
    convert_rotation_to_degrees,
    convert_translation_to_mm,
    detect_car_speed,
)
from .sampler import (
    find_car_reference,
    find_tracked_components,
    sample_motion,
)
from .writer import write_motion_zip


def _build_manifest(scene, car_ref, components, samples, sample_rate_hz, stride,
                    frame_start, frame_end, blend_path, car_speed_block):
    component_entries = []
    for comp in components:
        rows = np.array(
            [s["transforms"][comp.name] for s in samples],
            dtype=np.float64,
        )
        flags = analyze_channels(rows)
        component_entries.append({
            "name": comp.name,
            "type": comp.type,
            "csv": f"components/{comp.name}.csv",
            "channels": flags,
        })

    return {
        "exported_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "blend_file": os.path.basename(blend_path) if blend_path else "",
        "scene": scene.name,
        "frame_range": [frame_start, frame_end],
        "sample_rate_hz": sample_rate_hz,
        "stride": stride,
        "samples": len(samples),
        "fps": scene.render.fps,
        "car_reference": car_ref.name,
        "car_speed": car_speed_block,
        "units": {
            "translation": "mm",
            "rotation": "degrees",
            "time": "seconds",
        },
        "components": component_entries,
    }


def export_motion(context, output_path, sample_rate_hz=None, frame_start=None,
                  frame_end=None, auto_detect=True, override_speed_mm_s=None):
    """Export body-local motion + kinematics of all tracked components to a ZIP.

    Args:
        context: Blender context.
        output_path: Absolute path where the ZIP is written.
        sample_rate_hz: Samples per second. Defaults to scene fps.
        frame_start: First frame (inclusive). Defaults to scene.frame_start.
        frame_end: Last frame (inclusive). Defaults to scene.frame_end.
        auto_detect: If True, auto-detect animated components. If False,
            only export objects tagged ``skm_track_motion``.
        override_speed_mm_s: Optional float. If > 0 and the car reference
            has measurable motion, rescale the time axis and kinematics
            so the car moves at the target speed.

    Returns:
        The manifest dict written into the ZIP.
    """
    scene = context.scene
    fps = scene.render.fps if scene.render.fps > 0 else 24

    if sample_rate_hz is None:
        sample_rate_hz = fps
    if frame_start is None:
        frame_start = scene.frame_start
    if frame_end is None:
        frame_end = scene.frame_end

    car_ref = find_car_reference(context)
    if car_ref is None:
        raise ValueError(
            "No car reference tagged. Tag an object with skm_is_car_reference first."
        )

    components = find_tracked_components(context, car_ref, auto_detect)
    if not components:
        raise ValueError(
            "No tracked components found. Either animate some objects (auto-detect "
            "mode) or tag them with skm_track_motion (tag mode)."
        )

    stride = compute_sample_stride(fps=fps, sample_rate_hz=sample_rate_hz)
    samples = sample_motion(
        scene=scene, car_ref=car_ref, components=components,
        frame_start=frame_start, frame_end=frame_end, stride=stride,
    )

    # Total elapsed time BEFORE any rescaling (measured from the scene's fps)
    total_time_s = samples[-1]["time_s"] - samples[0]["time_s"] if len(samples) > 1 else 0.0

    # --- Car speed detection and optional time rescaling ---------------------
    car_positions = np.array(
        [s["car_world"]["_car"] for s in samples],
        dtype=np.float64,
    )
    detected_axis, detected_speed = detect_car_speed(car_positions, total_time_s)

    override = float(override_speed_mm_s or 0.0)
    if override > 0 and detected_speed > 0:
        time_scale_factor = detected_speed / override
        used_speed = override
        samples = apply_time_scale(samples, time_scale_factor)
    else:
        time_scale_factor = 1.0
        used_speed = detected_speed

    car_speed_block = {
        "detected_axis": detected_axis,
        "detected_mm_s": round(detected_speed, 6),
        "override_mm_s": round(override, 6),
        "used_mm_s": round(used_speed, 6),
        "time_scale_factor": round(time_scale_factor, 6),
    }

    # --- Kinematics --------------------------------------------------------
    # dt_s in the rescaled time basis: stride/fps * time_scale_factor
    dt_s = (stride / fps) * time_scale_factor

    kinematics_by_component = {}
    for comp in components:
        positions = np.array(
            [s["transforms"][comp.name] for s in samples],
            dtype=np.float64,
        )
        velocity, acceleration = compute_kinematics(positions, dt_s)
        kinematics_by_component[comp.name] = (velocity, acceleration)

    # Car kinematics too (useful for sanity checks)
    car_vel, car_acc = compute_kinematics(car_positions, dt_s)
    kinematics_by_component["_car"] = (car_vel, car_acc)

    # --- Manifest + write --------------------------------------------------
    blend_path = bpy.data.filepath if bpy.data.filepath else ""
    manifest = _build_manifest(
        scene=scene, car_ref=car_ref, components=components, samples=samples,
        sample_rate_hz=sample_rate_hz, stride=stride,
        frame_start=frame_start, frame_end=frame_end, blend_path=blend_path,
        car_speed_block=car_speed_block,
    )

    car_motion_samples = [
        {"frame": s["frame"], "time_s": s["time_s"], "transforms": s["car_world"]}
        for s in samples
    ]

    write_motion_zip(
        output_path=output_path,
        manifest=manifest,
        car_motion_samples=car_motion_samples,
        component_samples=samples,
        kinematics_by_component=kinematics_by_component,
    )
    return manifest
```

- [ ] **Step 4: Run integration tests — verify they pass**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_motion_export_integration.py 2>&1 | tail -10
```

Expected: `OK: all motion_export integration tests passed` covering the existing 7 tests plus the 3 new ones.

- [ ] **Step 5: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/__init__.py tests/test_motion_export_integration.py
git commit -m "feat(motion_export): export_motion orchestrates car-speed detection, time rescale, kinematics"
```

---

## Task 4: UI + operator + version bump

**Files:**
- Modify: `strokmatic_vision_tools/motion_export/operators.py`
- Modify: `strokmatic_vision_tools/ui_panel.py`
- Modify: `strokmatic_vision_tools/__init__.py`
- Modify: `strokmatic_vision_tools/blender_manifest.toml`

- [ ] **Step 1: Update `strokmatic_vision_tools/motion_export/operators.py`**

Locate the `SKM_OT_ExportMotion.execute` method. Change the `export_motion(...)` call to pass the override speed and surface the detected speed in the report. Replace the existing `execute` method with:

```python
    def execute(self, context):
        scene = context.scene
        try:
            manifest = export_motion(
                context=context,
                output_path=self.filepath,
                sample_rate_hz=scene.skm_motion_sample_rate_hz,
                frame_start=scene.skm_motion_frame_start,
                frame_end=scene.skm_motion_frame_end,
                auto_detect=scene.skm_motion_auto_detect,
                override_speed_mm_s=scene.skm_motion_override_speed_mm_s,
            )
        except ValueError as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        except Exception as e:
            self.report({"ERROR"}, f"Export failed: {e}")
            return {"CANCELLED"}

        n_components = len(manifest["components"])
        n_samples = manifest["samples"]
        cs = manifest.get("car_speed", {})
        detected = cs.get("detected_mm_s", 0.0)
        used = cs.get("used_mm_s", 0.0)
        axis = cs.get("detected_axis") or "?"
        if cs.get("override_mm_s", 0) > 0:
            speed_msg = f"detected {detected:.1f} mm/s on {axis}, using {used:.1f} mm/s"
        else:
            speed_msg = f"detected {detected:.1f} mm/s on {axis}"
        self.report(
            {"INFO"},
            f"Exported {n_components} component(s) x {n_samples} samples "
            f"({speed_msg}) to {os.path.basename(self.filepath)}",
        )
        return {"FINISHED"}
```

- [ ] **Step 2: Update `strokmatic_vision_tools/ui_panel.py`**

Add a new scene property to the `SCENE_PROPS` dict (alongside the existing `skm_motion_*` entries):

```python
    "skm_motion_override_speed_mm_s": FloatProperty(
        name="Override Car Speed",
        default=0.0,
        min=0.0,
        description="Target car speed in mm/s. 0 = auto-detect from animation. "
                    "When > 0 the time axis of the export is rescaled so the car "
                    "sweeps at this speed.",
    ),
```

Find the Motion Export block in the `draw` method. Add the override field immediately after the `skm_motion_sample_rate_hz` property (after `col.prop(scene, "skm_motion_sample_rate_hz", ...)`):

```python
        col.prop(scene, "skm_motion_override_speed_mm_s", text="Override Speed (mm/s)")
```

- [ ] **Step 3: Update `strokmatic_vision_tools/__init__.py`**

Change `"version": (1, 2, 0),` to `"version": (1, 3, 0),`.

- [ ] **Step 4: Update `strokmatic_vision_tools/blender_manifest.toml`**

Change `version = "1.2.0"` to `version = "1.3.0"`. Leave everything else unchanged.

- [ ] **Step 5: Verify syntax**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
for f in strokmatic_vision_tools/motion_export/operators.py \
         strokmatic_vision_tools/ui_panel.py \
         strokmatic_vision_tools/__init__.py; do
  python3 -c "import ast; ast.parse(open('$f').read()); print('OK: $f')"
done
```

Expected: `OK` for all three files.

- [ ] **Step 6: Verify add-on registers cleanly**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
blender --background --python-expr "
import bpy, sys
sys.path.insert(0, '.')
import strokmatic_vision_tools
strokmatic_vision_tools.register()
# Verify the new scene property was registered
assert hasattr(bpy.types.Scene, 'skm_motion_override_speed_mm_s'), 'override property missing'
strokmatic_vision_tools.unregister()
print('OK: v1.3.0 registration clean')
" 2>&1 | tail -3
```

Expected: `OK: v1.3.0 registration clean`.

- [ ] **Step 7: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/operators.py \
       strokmatic_vision_tools/ui_panel.py \
       strokmatic_vision_tools/__init__.py \
       strokmatic_vision_tools/blender_manifest.toml
git commit -m "feat(motion_export): UI override speed field + operator plumbing + version bump to 1.3.0"
```

---

## Task 5: End-to-end smoke test + local ZIP

**Files:**
- No new files — runs existing suite + builds testing artifact

- [ ] **Step 1: Run the full test suite**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && ./tests/run_all.sh
```

Expected: all 15 previous tests continue to pass, with new tests from Tasks 1–3 included (count will increase to ~24 total across suites).

- [ ] **Step 2: Smoke-test against the real GM v4 scene**

```bash
if [ -f /tmp/v4-topcam-colors.blend ]; then
  cd workspaces/strokmatic/sdk/sdk-blender-tools
  blender --background /tmp/v4-topcam-colors.blend --python-expr "
import bpy, sys, os
sys.path.insert(0, '.')
import strokmatic_vision_tools
strokmatic_vision_tools.register()

car_ref = bpy.data.objects['car-movement']
car_ref['skm_is_car_reference'] = True
bpy.context.view_layer.update()

from strokmatic_vision_tools.motion_export import export_motion

# Default run
out1 = '/tmp/v4_v130_default.zip'
m1 = export_motion(context=bpy.context, output_path=out1, sample_rate_hz=24)
cs = m1['car_speed']
print(f'DEFAULT detected={cs[\"detected_mm_s\"]} axis={cs[\"detected_axis\"]} used={cs[\"used_mm_s\"]} factor={cs[\"time_scale_factor\"]}')

# Override run at 2x speed
out2 = '/tmp/v4_v130_2x.zip'
m2 = export_motion(context=bpy.context, output_path=out2, sample_rate_hz=24,
                   override_speed_mm_s=cs['detected_mm_s'] * 2)
cs2 = m2['car_speed']
print(f'OVERRIDE detected={cs2[\"detected_mm_s\"]} used={cs2[\"used_mm_s\"]} factor={cs2[\"time_scale_factor\"]}')

# ZIP size comparison
print(f'Default ZIP: {os.path.getsize(out1)} bytes')
print(f'Override ZIP: {os.path.getsize(out2)} bytes')

strokmatic_vision_tools.unregister()
" 2>&1 | grep -E "^(DEFAULT|OVERRIDE|Default|Override)"
else
  echo "Skipping: /tmp/v4-topcam-colors.blend not found"
fi
```

Expected output includes:
- `DEFAULT detected≈350 axis=Y used≈350 factor=1.0`
- `OVERRIDE detected≈350 used≈700 factor≈0.5`
- ZIP sizes roughly doubled vs v1.2.0 (now includes kinematics CSVs)

- [ ] **Step 3: Build the local testing ZIP**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
rm -f /tmp/strokmatic_vision_tools_v1.3.0-testing.zip
zip -r /tmp/strokmatic_vision_tools_v1.3.0-testing.zip strokmatic_vision_tools/ \
    -x "strokmatic_vision_tools/__pycache__/*" \
       "strokmatic_vision_tools/deflectometry/__pycache__/*" \
       "strokmatic_vision_tools/motion_export/__pycache__/*"
mv /tmp/strokmatic_vision_tools_v1.3.0-testing.zip ~/Documentos/
ls -lh ~/Documentos/strokmatic_vision_tools_v1.3.0-testing.zip
```

Expected: ZIP around 40–45 KB, written into `~/Documentos/` alongside the v1.2.0 build.

**Note:** Do NOT push or create a GitHub release. This build is for local validation only.
