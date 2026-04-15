# Motion Curve Exporter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Motion Export tool to the Strokmatic Vision Tools Blender add-on that samples body-relative motion of every moving component across the scene's frame range and writes a ZIP containing a manifest plus per-component CSVs for engineering hand-off.

**Architecture:** New `motion_export/` sub-package inside `strokmatic_vision_tools`. Pure-Python sampler walks scene frames once, extracts body-local transforms via `car_ref.matrix_world.inverted() @ comp.matrix_world`, analyzer flags free vs. constrained channels per component, writer packages everything as a ZIP with manifest.json + per-component CSVs in mm/degrees. UI integrates a new collapsible section in the existing SKM Vision panel.

**Tech Stack:** Blender Python API (`bpy`, `mathutils`), numpy (bundled with Blender), Python stdlib (`csv`, `json`, `zipfile`, `tempfile`, `pathlib`, `datetime`).

**Spec:** `docs/superpowers/specs/2026-04-14-vision-tools-motion-exporter-design.md`

**Base path:** `workspaces/strokmatic/sdk/sdk-blender-tools/`

---

## Testing Approach

Same pattern as v1.0–v1.1.x:
- **Pure Python tests** (unit conversions, channel analysis): `python3 tests/test_file.py`
- **Blender tests** (sampler, integration, ZIP writer): `blender --background --python tests/test_file.py`
- All tests use plain `assert` + print.
- After each task, run `./tests/run_all.sh` to catch regressions.

Pure-Python test files must import from the module file directly to avoid triggering the package `__init__.py` that loads `bpy`.

---

## File Structure

```
strokmatic_vision_tools/
├── __init__.py                          # Modify: register motion_export, version 1.2.0
├── blender_manifest.toml                # Modify: version 1.2.0
├── ui_panel.py                          # Modify: add Motion Export section + scene props
└── motion_export/
    ├── __init__.py                      # Public API: export_motion(); re-exports
    ├── sampler.py                       # Frame-sweep sampler — body-local transforms
    ├── analyzer.py                      # Free vs constrained channel detection + manifest builder
    ├── writer.py                        # CSV + JSON serialization, ZIP packaging
    └── operators.py                     # Blender operators (tag, untag, export)

tests/
├── test_motion_export_units.py          # Pure Python: unit conversions, channel analysis
├── test_motion_export_writer.py         # Pure Python: CSV/JSON/ZIP correctness
└── test_motion_export_integration.py    # Blender: end-to-end with synthetic scene
```

---

## Task 1: Pure-Python core — units, analyzer, writer

**Files:**
- Create: `strokmatic_vision_tools/motion_export/__init__.py`
- Create: `strokmatic_vision_tools/motion_export/analyzer.py`
- Create: `strokmatic_vision_tools/motion_export/writer.py`
- Create: `tests/test_motion_export_units.py`
- Create: `tests/test_motion_export_writer.py`

The analyzer module operates on numpy arrays — no `bpy` dependency. The writer takes Python dicts/lists — also no `bpy`. Both are testable with plain Python.

- [ ] **Step 1: Create `strokmatic_vision_tools/motion_export/__init__.py` with sub-package marker**

```python
"""Motion curve exporter sub-package.

Exports body-relative motion of all moving components across the scene's
frame range as a ZIP with manifest.json + per-component CSVs.
"""
```

- [ ] **Step 2: Write `tests/test_motion_export_units.py`**

```python
"""Pure-Python tests for analyzer.py — no Blender required."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "strokmatic_vision_tools", "motion_export"))
from analyzer import (
    analyze_channels,
    compute_sample_stride,
    convert_translation_to_mm,
    convert_rotation_to_degrees,
)

import numpy as np


def test_compute_sample_stride_default():
    # When sample_rate_hz equals fps, stride should be 1
    assert compute_sample_stride(fps=24, sample_rate_hz=24) == 1


def test_compute_sample_stride_half_rate():
    # 12 Hz on a 24 fps scene → stride 2
    assert compute_sample_stride(fps=24, sample_rate_hz=12) == 2


def test_compute_sample_stride_higher_than_fps_clamps_to_one():
    # Asking for more samples than frames provides → clamp to 1
    assert compute_sample_stride(fps=24, sample_rate_hz=60) == 1


def test_compute_sample_stride_zero_rate_raises():
    try:
        compute_sample_stride(fps=24, sample_rate_hz=0)
        assert False, "Should raise ValueError"
    except ValueError:
        pass


def test_convert_translation_to_mm():
    # Blender uses meters; engineering wants mm
    assert convert_translation_to_mm(1.0) == 1000.0
    assert convert_translation_to_mm(0.001) == 1.0
    assert convert_translation_to_mm(-0.5) == -500.0


def test_convert_rotation_to_degrees():
    # Blender uses radians
    assert abs(convert_rotation_to_degrees(math.pi) - 180.0) < 1e-6
    assert abs(convert_rotation_to_degrees(math.pi / 2) - 90.0) < 1e-6
    assert convert_rotation_to_degrees(0.0) == 0.0


def test_analyze_channels_all_constrained():
    """6 channels, all constant across samples → all flagged constrained."""
    # samples shape: (N_samples, 6) — columns are (x, y, z, rx, ry, rz)
    # values in Blender units (m / rad)
    samples = np.zeros((10, 6), dtype=np.float64)
    samples[:, 0] = 0.5  # constant 0.5 m → 500 mm
    samples[:, 4] = math.pi / 4  # constant rotation
    flags = analyze_channels(samples)
    for ch in ("x_mm", "y_mm", "z_mm", "rx_deg", "ry_deg", "rz_deg"):
        assert flags[ch]["free"] is False, f"{ch} should be constrained"
    # Constant value reported in output units
    assert abs(flags["x_mm"]["value"] - 500.0) < 1e-6
    assert abs(flags["rx_deg"]["value"]) < 1e-6
    assert abs(flags["ry_deg"]["value"] - 45.0) < 1e-3


def test_analyze_channels_translation_free():
    """Z varies by 100mm across samples → flagged free."""
    samples = np.zeros((20, 6), dtype=np.float64)
    samples[:, 2] = np.linspace(0.0, 0.1, 20)  # 0 → 100 mm
    flags = analyze_channels(samples)
    assert flags["z_mm"]["free"] is True
    assert abs(flags["z_mm"]["min"]) < 1e-6
    assert abs(flags["z_mm"]["max"] - 100.0) < 1e-3
    assert abs(flags["z_mm"]["range"] - 100.0) < 1e-3
    # Other channels stay constrained
    assert flags["x_mm"]["free"] is False


def test_analyze_channels_translation_below_tolerance():
    """0.5 mm of variation is below the 1mm tolerance → constrained."""
    samples = np.zeros((10, 6), dtype=np.float64)
    samples[:, 0] = np.linspace(0.0, 0.0005, 10)  # 0 → 0.5 mm
    flags = analyze_channels(samples)
    assert flags["x_mm"]["free"] is False, "0.5mm variation should be constrained"


def test_analyze_channels_rotation_free():
    """RY varies by 45° → flagged free."""
    samples = np.zeros((10, 6), dtype=np.float64)
    samples[:, 4] = np.linspace(0.0, math.pi / 4, 10)  # 0 → 45°
    flags = analyze_channels(samples)
    assert flags["ry_deg"]["free"] is True
    assert abs(flags["ry_deg"]["max"] - 45.0) < 1e-3


def test_analyze_channels_rotation_below_tolerance():
    """0.005° of variation below 0.01° tolerance → constrained."""
    samples = np.zeros((10, 6), dtype=np.float64)
    samples[:, 3] = np.linspace(0.0, math.radians(0.005), 10)
    flags = analyze_channels(samples)
    assert flags["rx_deg"]["free"] is False


def test_analyze_channels_empty_samples_raises():
    samples = np.zeros((0, 6), dtype=np.float64)
    try:
        analyze_channels(samples)
        assert False, "Should raise ValueError on empty samples"
    except ValueError:
        pass


if __name__ == "__main__":
    test_compute_sample_stride_default()
    test_compute_sample_stride_half_rate()
    test_compute_sample_stride_higher_than_fps_clamps_to_one()
    test_compute_sample_stride_zero_rate_raises()
    test_convert_translation_to_mm()
    test_convert_rotation_to_degrees()
    test_analyze_channels_all_constrained()
    test_analyze_channels_translation_free()
    test_analyze_channels_translation_below_tolerance()
    test_analyze_channels_rotation_free()
    test_analyze_channels_rotation_below_tolerance()
    test_analyze_channels_empty_samples_raises()
    print("OK: all motion_export units tests passed")
```

- [ ] **Step 3: Run units tests — verify failure**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_motion_export_units.py
```

Expected: `ModuleNotFoundError: No module named 'analyzer'`

- [ ] **Step 4: Implement `strokmatic_vision_tools/motion_export/analyzer.py`**

```python
"""Channel analysis and unit conversion for motion export.

Pure Python + numpy — no bpy dependency. Determines which channels are
animated (free) vs. constant (constrained), and converts Blender's
internal units (m, rad) to engineering units (mm, degrees).
"""
import math
import numpy as np


# Tolerances for declaring a channel "constrained"
_TRANSLATION_TOLERANCE_M = 0.001       # 1 mm
_ROTATION_TOLERANCE_RAD = math.radians(0.01)  # 0.01 degree

# Ordered channel names used in CSVs and manifests
CHANNEL_NAMES = ("x_mm", "y_mm", "z_mm", "rx_deg", "ry_deg", "rz_deg")


def compute_sample_stride(fps, sample_rate_hz):
    """Return the integer frame stride for the requested sample rate.

    Blender frames are integer-indexed; this clamps the stride to >= 1.

    Args:
        fps: The scene render fps (int).
        sample_rate_hz: Desired samples per second (int).

    Returns:
        Integer stride (frames per sample). Always >= 1.

    Raises:
        ValueError: If sample_rate_hz <= 0.
    """
    if sample_rate_hz <= 0:
        raise ValueError(f"sample_rate_hz must be > 0, got {sample_rate_hz}")
    stride = round(fps / sample_rate_hz)
    return max(1, stride)


def convert_translation_to_mm(value_m):
    """Convert a translation value from meters (Blender) to mm."""
    return value_m * 1000.0


def convert_rotation_to_degrees(value_rad):
    """Convert a rotation value from radians (Blender) to degrees."""
    return math.degrees(value_rad)


def analyze_channels(samples):
    """Determine free/constrained status and stats for each of 6 channels.

    Args:
        samples: numpy array of shape (N_samples, 6) with columns
            (x, y, z, rx, ry, rz) in Blender internal units (m, rad).

    Returns:
        Dict mapping channel name (e.g. "x_mm") to a dict:
        - For free channels: {"free": True, "min": <mm or deg>,
            "max": <mm or deg>, "range": <mm or deg>}
        - For constrained channels: {"free": False, "value": <mm or deg>}

    Raises:
        ValueError: If samples is empty.
    """
    if samples.shape[0] == 0:
        raise ValueError("samples array is empty")
    if samples.shape[1] != 6:
        raise ValueError(f"samples must have 6 columns, got {samples.shape[1]}")

    flags = {}
    for col, name in enumerate(CHANNEL_NAMES):
        col_min = float(samples[:, col].min())
        col_max = float(samples[:, col].max())
        col_range = col_max - col_min

        is_translation = name.endswith("_mm")
        tol = _TRANSLATION_TOLERANCE_M if is_translation else _ROTATION_TOLERANCE_RAD
        converter = convert_translation_to_mm if is_translation else convert_rotation_to_degrees

        if col_range > tol:
            flags[name] = {
                "free": True,
                "min": round(converter(col_min), 6),
                "max": round(converter(col_max), 6),
                "range": round(converter(col_range), 6),
            }
        else:
            mid = (col_min + col_max) / 2.0
            flags[name] = {
                "free": False,
                "value": round(converter(mid), 6),
            }
    return flags
```

- [ ] **Step 5: Run units tests — verify they pass**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_motion_export_units.py
```

Expected: `OK: all motion_export units tests passed`

- [ ] **Step 6: Write `tests/test_motion_export_writer.py`**

```python
"""Pure-Python tests for writer.py — no Blender required."""
import csv
import io
import json
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "strokmatic_vision_tools", "motion_export"))
from writer import (
    component_csv_rows,
    write_motion_zip,
)


def _sample(frame, time_s, x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0):
    """Build a sample row in Blender internal units (m, rad)."""
    return {
        "frame": frame,
        "time_s": time_s,
        "transforms": {  # comp_name -> (x_m, y_m, z_m, rx_rad, ry_rad, rz_rad)
            "compA": (x, y, z, rx, ry, rz),
        },
    }


def test_component_csv_rows_header_and_units():
    samples = [
        _sample(0, 0.0, x=1.0, y=2.0, z=0.5),
        _sample(1, 0.0417, x=1.001, y=2.0, z=0.5),
    ]
    rows = component_csv_rows(samples, "compA")
    assert rows[0] == ["frame", "time_s", "x_mm", "y_mm", "z_mm", "rx_deg", "ry_deg", "rz_deg"]
    assert rows[1] == [0, 0.0, 1000.0, 2000.0, 500.0, 0.0, 0.0, 0.0]
    assert rows[2] == [1, 0.0417, 1001.0, 2000.0, 500.0, 0.0, 0.0, 0.0]


def test_component_csv_rows_missing_component_raises():
    samples = [_sample(0, 0.0)]
    try:
        component_csv_rows(samples, "missing")
        assert False, "Should raise KeyError"
    except KeyError:
        pass


def test_write_motion_zip_structure():
    samples = [
        _sample(0, 0.0, x=1.0, y=2.0, z=0.5),
        _sample(1, 0.0417, x=1.001, y=2.0, z=0.5),
    ]
    car_motion_samples = [
        _sample(0, 0.0, y=-3.5),
        _sample(1, 0.0417, y=-3.499),
    ]
    # Override transforms key for car_motion samples to use "_car" key
    for s, src in zip(car_motion_samples, [(-3.5,), (-3.499,)]):
        s["transforms"] = {"_car": (0.0, src[0], 0.0, 0.0, 0.0, 0.0)}

    manifest = {
        "exported_at": "2026-04-14T15:00:00Z",
        "blend_file": "test.blend",
        "scene": "Scene",
        "frame_range": [0, 1],
        "sample_rate_hz": 24,
        "stride": 1,
        "samples": 2,
        "fps": 24,
        "car_reference": "car-movement",
        "units": {"translation": "mm", "rotation": "degrees", "time": "seconds"},
        "components": [
            {
                "name": "compA",
                "type": "MESH",
                "csv": "components/compA.csv",
                "channels": {
                    "x_mm": {"free": True, "min": 1000.0, "max": 1001.0, "range": 1.0},
                    "y_mm": {"free": False, "value": 2000.0},
                    "z_mm": {"free": False, "value": 500.0},
                    "rx_deg": {"free": False, "value": 0.0},
                    "ry_deg": {"free": False, "value": 0.0},
                    "rz_deg": {"free": False, "value": 0.0},
                },
            },
        ],
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = os.path.join(tmpdir, "motion.zip")
        write_motion_zip(
            output_path=out_path,
            manifest=manifest,
            car_motion_samples=car_motion_samples,
            component_samples=samples,
        )

        assert os.path.exists(out_path)
        with zipfile.ZipFile(out_path, "r") as zf:
            names = sorted(zf.namelist())
            assert "manifest.json" in names
            assert "car_motion.csv" in names
            assert "components/compA.csv" in names

            manifest_data = json.loads(zf.read("manifest.json").decode("utf-8"))
            assert manifest_data["car_reference"] == "car-movement"
            assert manifest_data["samples"] == 2

            csv_text = zf.read("components/compA.csv").decode("utf-8")
            reader = csv.reader(io.StringIO(csv_text))
            rows = list(reader)
            assert rows[0] == ["frame", "time_s", "x_mm", "y_mm", "z_mm", "rx_deg", "ry_deg", "rz_deg"]
            assert rows[1] == ["0", "0.0", "1000.0", "2000.0", "500.0", "0.0", "0.0", "0.0"]


if __name__ == "__main__":
    test_component_csv_rows_header_and_units()
    test_component_csv_rows_missing_component_raises()
    test_write_motion_zip_structure()
    print("OK: all motion_export writer tests passed")
```

- [ ] **Step 7: Run writer tests — verify failure**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_motion_export_writer.py
```

Expected: `ModuleNotFoundError: No module named 'writer'`

- [ ] **Step 8: Implement `strokmatic_vision_tools/motion_export/writer.py`**

```python
"""ZIP packaging — manifest.json, car_motion.csv, per-component CSVs.

Pure Python — no bpy dependency. Consumes already-computed samples
(in Blender units) and converts to engineering units at the CSV
boundary.
"""
import csv
import io
import json
import zipfile

from analyzer import convert_translation_to_mm, convert_rotation_to_degrees, CHANNEL_NAMES


CSV_HEADER = ["frame", "time_s"] + list(CHANNEL_NAMES)


def component_csv_rows(samples, component_name):
    """Build CSV rows (header + data) for one component.

    Args:
        samples: List of sample dicts. Each has keys "frame", "time_s",
            and "transforms" (a dict mapping component name to a 6-tuple
            (x_m, y_m, z_m, rx_rad, ry_rad, rz_rad)).
        component_name: Which component to extract.

    Returns:
        List of rows (lists). First row is the header.

    Raises:
        KeyError: If component_name is missing from any sample.
    """
    rows = [list(CSV_HEADER)]
    for s in samples:
        if component_name not in s["transforms"]:
            raise KeyError(f"Component '{component_name}' missing from sample frame={s['frame']}")
        x_m, y_m, z_m, rx_r, ry_r, rz_r = s["transforms"][component_name]
        rows.append([
            s["frame"],
            s["time_s"],
            round(convert_translation_to_mm(x_m), 6),
            round(convert_translation_to_mm(y_m), 6),
            round(convert_translation_to_mm(z_m), 6),
            round(convert_rotation_to_degrees(rx_r), 6),
            round(convert_rotation_to_degrees(ry_r), 6),
            round(convert_rotation_to_degrees(rz_r), 6),
        ])
    return rows


def _rows_to_csv_bytes(rows):
    """Serialize a list of rows to CSV bytes (utf-8)."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def write_motion_zip(output_path, manifest, car_motion_samples, component_samples):
    """Write the full motion export ZIP.

    Args:
        output_path: Absolute path of the .zip to write.
        manifest: Dict; will be serialized to manifest.json. The
            ``components`` list inside it must include a ``csv`` field
            for each component naming the in-zip path.
        car_motion_samples: Same shape as component_samples; the car
            reference's own world position. The component name inside
            the transforms dict for these samples is "_car".
        component_samples: List of sample dicts (see component_csv_rows).
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
```

- [ ] **Step 9: Run writer tests — verify they pass**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_motion_export_writer.py
```

Expected: `OK: all motion_export writer tests passed`

- [ ] **Step 10: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/__init__.py \
       strokmatic_vision_tools/motion_export/analyzer.py \
       strokmatic_vision_tools/motion_export/writer.py \
       tests/test_motion_export_units.py \
       tests/test_motion_export_writer.py
git commit -m "feat(motion_export): pure-python core — analyzer (channel detection + units) + writer (CSV/JSON/ZIP)"
```

---

## Task 2: Sampler — frame sweep + body-local extraction

**Files:**
- Create: `strokmatic_vision_tools/motion_export/sampler.py`
- Create: `tests/test_motion_export_integration.py` (Blender)

The sampler is the bridge between Blender's animated scene and the pure-Python analyzer/writer. It runs inside Blender.

- [ ] **Step 1: Write `tests/test_motion_export_integration.py`**

```python
"""Integration tests for motion exporter — must run inside Blender."""
import bpy
import json
import math
import os
import sys
import tempfile
import zipfile

from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.motion_export.sampler import (
    find_car_reference,
    find_tracked_components,
    sample_motion,
)
from strokmatic_vision_tools.motion_export import export_motion


def _build_scene():
    """Minimal scene for motion export tests.

    - car-ref empty animated along Y from 0 to 1.0 m (frames 0 -> 100)
    - comp_z empty animated along Z from 0 to 0.5 m
    - comp_xyz mesh animated along XYZ
    - stationary_mesh — no animation, should be ignored by auto-detect
    - tagged_only mesh — no animation, but tagged with skm_track_motion
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = 100
    scene.render.fps = 24

    # car-ref empty
    car = bpy.data.objects.new("car-ref", None)
    bpy.context.collection.objects.link(car)
    car["skm_is_car_reference"] = True
    car.location = (0.0, 0.0, 0.0)
    car.keyframe_insert(data_path="location", frame=0)
    car.location = (0.0, 1.0, 0.0)
    car.keyframe_insert(data_path="location", frame=100)

    # comp_z — animated only in Z
    cz = bpy.data.objects.new("comp_z", None)
    bpy.context.collection.objects.link(cz)
    cz.location = (2.0, 0.0, 0.0)
    cz.keyframe_insert(data_path="location", frame=0)
    cz.location = (2.0, 0.0, 0.5)
    cz.keyframe_insert(data_path="location", frame=100)

    # comp_xyz — animated in all 3 translation axes
    bpy.ops.mesh.primitive_cube_add(location=(3.0, 0.0, 0.0))
    cxyz = bpy.context.active_object
    cxyz.name = "comp_xyz"
    cxyz.keyframe_insert(data_path="location", frame=0)
    cxyz.location = (3.5, 0.5, 0.25)
    cxyz.keyframe_insert(data_path="location", frame=100)

    # stationary_mesh — no animation
    bpy.ops.mesh.primitive_cube_add(location=(5.0, 0.0, 0.0))
    stationary = bpy.context.active_object
    stationary.name = "stationary_mesh"

    # tagged_only — no animation, but tagged
    bpy.ops.mesh.primitive_cube_add(location=(6.0, 0.0, 0.0))
    tagged = bpy.context.active_object
    tagged.name = "tagged_only"
    tagged["skm_track_motion"] = True

    bpy.context.view_layer.update()
    return scene, car, cz, cxyz, stationary, tagged


def test_find_car_reference():
    scene, car, _, _, _, _ = _build_scene()
    found = find_car_reference(bpy.context)
    assert found is car, f"Expected to find car-ref, got {found.name if found else None}"


def test_find_car_reference_none_tagged_returns_none():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    found = find_car_reference(bpy.context)
    assert found is None


def test_find_tracked_components_auto_detect():
    """Auto-detect should pick up animated objects, skip stationary, and exclude car ref."""
    scene, car, cz, cxyz, stationary, tagged = _build_scene()
    found = find_tracked_components(bpy.context, car_ref=car, auto_detect=True)
    names = sorted(o.name for o in found)
    # tagged_only is not animated, but auto_detect mode picks up by animation,
    # not by tag. comp_z and comp_xyz should be present; stationary excluded.
    assert "comp_z" in names, f"comp_z missing from {names}"
    assert "comp_xyz" in names, f"comp_xyz missing from {names}"
    assert "stationary_mesh" not in names, f"stationary_mesh should be skipped, got {names}"
    assert "car-ref" not in names, f"car-ref should be excluded, got {names}"


def test_find_tracked_components_tag_mode():
    """Tag mode should only pick up explicitly tagged objects."""
    scene, car, cz, cxyz, stationary, tagged = _build_scene()
    found = find_tracked_components(bpy.context, car_ref=car, auto_detect=False)
    names = sorted(o.name for o in found)
    assert names == ["tagged_only"], f"Expected ['tagged_only'], got {names}"


def test_sample_motion_body_local():
    """Component motion should be expressed relative to the moving car."""
    scene, car, cz, cxyz, stationary, tagged = _build_scene()
    components = [cz]
    samples = sample_motion(
        scene=scene,
        car_ref=car,
        components=components,
        frame_start=0,
        frame_end=100,
        stride=10,  # 11 samples
    )
    assert len(samples) == 11

    # Body-local Y of comp_z should DECREASE over time as the car moves +Y.
    # At frame 0: car at y=0, comp_z at y=0 → relative y = 0
    # At frame 100: car at y=1, comp_z at y=0 → relative y = -1
    s0 = samples[0]["transforms"]["comp_z"]
    s_last = samples[-1]["transforms"]["comp_z"]
    assert abs(s0[1] - 0.0) < 0.001, f"At start, comp_z relative Y should be 0, got {s0[1]}"
    assert abs(s_last[1] - (-1.0)) < 0.001, f"At end, comp_z relative Y should be -1, got {s_last[1]}"
    # comp_z's own Z animation: 0 → 0.5 m
    assert abs(s0[2] - 0.0) < 0.001
    assert abs(s_last[2] - 0.5) < 0.001


def test_sample_motion_includes_car_motion():
    """The car's own world position should be sampled separately."""
    scene, car, cz, cxyz, stationary, tagged = _build_scene()
    samples = sample_motion(
        scene=scene, car_ref=car, components=[cz],
        frame_start=0, frame_end=100, stride=50,  # 3 samples
    )
    assert len(samples) == 3
    # car-motion key in each sample
    assert "_car" in samples[0]["car_world"]
    car_y_start = samples[0]["car_world"]["_car"][1]
    car_y_end = samples[-1]["car_world"]["_car"][1]
    assert abs(car_y_start - 0.0) < 0.001
    assert abs(car_y_end - 1.0) < 0.001


def test_export_motion_writes_zip():
    """End-to-end: export to a temp file, verify ZIP contents."""
    scene, car, cz, cxyz, stationary, tagged = _build_scene()

    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = os.path.join(tmpdir, "motion.zip")
        manifest = export_motion(
            context=bpy.context,
            output_path=out_path,
            sample_rate_hz=24,
            frame_start=0,
            frame_end=100,
            auto_detect=True,
        )
        assert os.path.exists(out_path), "ZIP file not written"
        assert manifest["car_reference"] == "car-ref"
        assert manifest["samples"] == 101  # frames 0..100 inclusive at stride 1

        with zipfile.ZipFile(out_path, "r") as zf:
            names = sorted(zf.namelist())
            assert "manifest.json" in names
            assert "car_motion.csv" in names
            comp_csvs = [n for n in names if n.startswith("components/")]
            assert len(comp_csvs) >= 2  # comp_z and comp_xyz at minimum

            # Check comp_z CSV: it should have 102 lines (header + 101 samples)
            csv_data = zf.read("components/comp_z.csv").decode("utf-8")
            line_count = len(csv_data.strip().split("\n"))
            assert line_count == 102, f"Expected 102 lines, got {line_count}"


if __name__ == "__main__":
    test_find_car_reference()
    test_find_car_reference_none_tagged_returns_none()
    test_find_tracked_components_auto_detect()
    test_find_tracked_components_tag_mode()
    test_sample_motion_body_local()
    test_sample_motion_includes_car_motion()
    test_export_motion_writes_zip()
    print("OK: all motion_export integration tests passed")
```

- [ ] **Step 2: Run integration test — verify failure**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_motion_export_integration.py 2>&1 | tail -10
```

Expected: `ImportError: cannot import name 'sample_motion' from 'strokmatic_vision_tools.motion_export.sampler'`

- [ ] **Step 3: Implement `strokmatic_vision_tools/motion_export/sampler.py`**

```python
"""Frame-sweep sampler — body-local transform extraction.

Uses Blender's depsgraph / scene.frame_set to sample the relative
motion of every tracked component at integer frame intervals.
"""
import bpy
from mathutils import Vector


# Tolerance for "this object's world position changes between frames"
_AUTO_DETECT_TOLERANCE_M = 0.001  # 1mm
_AUTO_DETECT_TOLERANCE_RAD = 0.0001745  # ~0.01°
# Skip Blender object types that never represent a moving rig component
_SKIP_OBJECT_TYPES = frozenset({"CAMERA", "LIGHT", "SPEAKER"})


def find_car_reference(context):
    """Return the object tagged with ``skm_is_car_reference``, or None.

    If multiple objects are tagged, returns the first found and prints
    a warning. Tagging is meant to be exclusive.
    """
    tagged = [o for o in context.scene.objects if o.get("skm_is_car_reference", False)]
    if not tagged:
        return None
    if len(tagged) > 1:
        names = ", ".join(o.name for o in tagged)
        print(f"WARNING: multiple car-reference tags found ({names}); using {tagged[0].name}")
    return tagged[0]


def _has_animation_data(obj):
    """True if the object has any keyframes, NLA strips, or drivers."""
    ad = obj.animation_data
    if ad is None:
        return False
    if ad.action is not None:
        return True
    if ad.drivers:
        return True
    for track in ad.nla_tracks:
        if track.strips:
            return True
    return False


def _world_position_changes(obj, scene, frame_start, frame_end):
    """Return True if obj.matrix_world.translation moves between frames.

    Sampled at start, midpoint, end. Conservative — only detects motion
    that would be visible in a 3-sample probe.
    """
    midframe = (frame_start + frame_end) // 2
    positions = []
    for f in (frame_start, midframe, frame_end):
        scene.frame_set(f)
        positions.append(Vector(obj.matrix_world.translation))
    return any(
        (positions[i] - positions[0]).length > _AUTO_DETECT_TOLERANCE_M
        for i in range(1, len(positions))
    )


def find_tracked_components(context, car_ref, auto_detect):
    """Discover the components whose motion should be exported.

    Args:
        context: Blender context.
        car_ref: The car reference object (excluded from results).
        auto_detect: If True, return objects with animation data OR
            measurable world-position change. If False, return only
            objects tagged with ``skm_track_motion``.

    Returns:
        List of objects.
    """
    scene = context.scene
    candidates = [
        o for o in scene.objects
        if o is not car_ref and o.type not in _SKIP_OBJECT_TYPES
    ]
    if not auto_detect:
        return [o for o in candidates if o.get("skm_track_motion", False)]

    # Auto-detect: animation data first (cheap), then position-change probe
    found = []
    for obj in candidates:
        if _has_animation_data(obj):
            found.append(obj)
            continue
        try:
            if _world_position_changes(obj, scene, scene.frame_start, scene.frame_end):
                found.append(obj)
        except Exception:
            # Defensive: skip objects whose evaluation fails
            continue
    return found


def sample_motion(scene, car_ref, components, frame_start, frame_end, stride):
    """Sample body-local motion across a frame range.

    Args:
        scene: The Blender scene.
        car_ref: The car reference object (its world matrix is the
            local frame for relative computation).
        components: List of objects to track.
        frame_start: First frame (inclusive).
        frame_end: Last frame (inclusive).
        stride: Frame stride between samples.

    Returns:
        List of sample dicts, each with keys:
        - "frame": int
        - "time_s": float (seconds since frame_start at scene fps)
        - "transforms": dict mapping component name to a 6-tuple
            (x_m, y_m, z_m, rx_rad, ry_rad, rz_rad) in body-local frame
        - "car_world": dict {"_car": (x_m, y_m, z_m, rx_rad, ry_rad, rz_rad)}
            with the car's WORLD transform (no inversion).
    """
    fps = scene.render.fps if scene.render.fps > 0 else 24
    samples = []
    frame = frame_start
    while frame <= frame_end:
        scene.frame_set(frame)

        car_mat = car_ref.matrix_world.copy()
        car_inv = car_mat.inverted()

        car_loc = car_mat.translation
        car_rot = car_mat.to_euler("XYZ")
        car_world_tuple = (car_loc.x, car_loc.y, car_loc.z, car_rot.x, car_rot.y, car_rot.z)

        transforms = {}
        for comp in components:
            local = car_inv @ comp.matrix_world
            t = local.translation
            r = local.to_euler("XYZ")
            transforms[comp.name] = (t.x, t.y, t.z, r.x, r.y, r.z)

        samples.append({
            "frame": frame,
            "time_s": round((frame - frame_start) / fps, 6),
            "transforms": transforms,
            "car_world": {"_car": car_world_tuple},
        })

        if stride <= 0:
            break
        frame += stride

    return samples
```

- [ ] **Step 4: Add the public ``export_motion`` function to `motion_export/__init__.py`**

Replace the contents of `strokmatic_vision_tools/motion_export/__init__.py` with:

```python
"""Motion curve exporter sub-package.

Exports body-relative motion of all moving components across the scene's
frame range as a ZIP with manifest.json + per-component CSVs.

Public API: ``export_motion(context, output_path, ...)``
"""
import datetime
import os

import bpy

from .analyzer import (
    CHANNEL_NAMES,
    analyze_channels,
    compute_sample_stride,
    convert_translation_to_mm,
    convert_rotation_to_degrees,
)
from .sampler import (
    find_car_reference,
    find_tracked_components,
    sample_motion,
)
from .writer import write_motion_zip


def _build_manifest(scene, car_ref, components, samples, sample_rate_hz, stride,
                    frame_start, frame_end, blend_path):
    """Construct the manifest dict from sampled data."""
    import numpy as np

    component_entries = []
    for comp in components:
        # Stack all frames for this component into an (N, 6) array
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
        "units": {
            "translation": "mm",
            "rotation": "degrees",
            "time": "seconds",
        },
        "components": component_entries,
    }


def export_motion(context, output_path, sample_rate_hz=None, frame_start=None,
                  frame_end=None, auto_detect=True):
    """Export body-local motion of all tracked components to a ZIP.

    Args:
        context: Blender context.
        output_path: Absolute filesystem path where the ZIP will be written.
        sample_rate_hz: Samples per second. Defaults to scene render fps.
        frame_start: First frame (inclusive). Defaults to scene.frame_start.
        frame_end: Last frame (inclusive). Defaults to scene.frame_end.
        auto_detect: If True, auto-detect animated components. If False,
            only export objects tagged ``skm_track_motion``.

    Returns:
        The manifest dict written into the ZIP.

    Raises:
        ValueError: If no car reference is tagged or no components found.
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

    blend_path = bpy.data.filepath if bpy.data.filepath else ""
    manifest = _build_manifest(
        scene=scene, car_ref=car_ref, components=components, samples=samples,
        sample_rate_hz=sample_rate_hz, stride=stride,
        frame_start=frame_start, frame_end=frame_end, blend_path=blend_path,
    )

    # car_motion CSV samples come from each sample's "car_world" key
    car_motion_samples = [
        {"frame": s["frame"], "time_s": s["time_s"], "transforms": s["car_world"]}
        for s in samples
    ]

    write_motion_zip(
        output_path=output_path,
        manifest=manifest,
        car_motion_samples=car_motion_samples,
        component_samples=samples,
    )
    return manifest
```

- [ ] **Step 5: Run integration test — verify it passes**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_motion_export_integration.py 2>&1 | tail -10
```

Expected: `OK: all motion_export integration tests passed`

- [ ] **Step 6: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/sampler.py \
       strokmatic_vision_tools/motion_export/__init__.py \
       tests/test_motion_export_integration.py
git commit -m "feat(motion_export): sampler (body-local frame sweep) + public export_motion API"
```

---

## Task 3: Blender operators (tag, untag, export)

**Files:**
- Create: `strokmatic_vision_tools/motion_export/operators.py`

- [ ] **Step 1: Implement `strokmatic_vision_tools/motion_export/operators.py`**

```python
"""Blender operators for motion export.

- SKM_OT_TagCarReference / SKM_OT_UntagCarReference
- SKM_OT_TagTrackMotion / SKM_OT_UntagTrackMotion
- SKM_OT_ExportMotion
"""
import os

import bpy
from bpy.props import BoolProperty, IntProperty, StringProperty
from bpy_extras.io_utils import ExportHelper

from . import export_motion


class SKM_OT_TagCarReference(bpy.types.Operator):
    """Tag the active object as the car reference (clears any other tag first)."""
    bl_idname = "skm_vision.tag_car_reference"
    bl_label = "Tag as Car Reference"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        active = context.active_object
        if active is None:
            self.report({"ERROR"}, "No active object selected")
            return {"CANCELLED"}
        # Exclusive tag — clear any others first
        cleared = 0
        for o in context.scene.objects:
            if o is not active and o.get("skm_is_car_reference", False):
                del o["skm_is_car_reference"]
                cleared += 1
        active["skm_is_car_reference"] = True
        msg = f"Tagged '{active.name}' as car reference"
        if cleared:
            msg += f" (cleared {cleared} previous tag(s))"
        self.report({"INFO"}, msg)
        return {"FINISHED"}


class SKM_OT_UntagCarReference(bpy.types.Operator):
    """Remove the car-reference tag from selected objects."""
    bl_idname = "skm_vision.untag_car_reference"
    bl_label = "Untag Car Reference"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        cleared = 0
        for o in context.selected_objects:
            if o.get("skm_is_car_reference", False):
                del o["skm_is_car_reference"]
                cleared += 1
        self.report({"INFO"}, f"Cleared car-reference tag on {cleared} object(s)")
        return {"FINISHED"}


class SKM_OT_TagTrackMotion(bpy.types.Operator):
    """Tag selected objects as motion-tracked components."""
    bl_idname = "skm_vision.tag_track_motion"
    bl_label = "Tag Component"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        count = 0
        for o in context.selected_objects:
            o["skm_track_motion"] = True
            count += 1
        self.report({"INFO"}, f"Tagged {count} object(s) as tracked motion components")
        return {"FINISHED"}


class SKM_OT_UntagTrackMotion(bpy.types.Operator):
    """Remove the motion-tracked tag from selected objects."""
    bl_idname = "skm_vision.untag_track_motion"
    bl_label = "Untag Component"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        cleared = 0
        for o in context.selected_objects:
            if "skm_track_motion" in o:
                del o["skm_track_motion"]
                cleared += 1
        self.report({"INFO"}, f"Cleared motion tag on {cleared} object(s)")
        return {"FINISHED"}


class SKM_OT_ExportMotion(bpy.types.Operator, ExportHelper):
    """Export motion curves for all moving components to a ZIP file."""
    bl_idname = "skm_vision.export_motion"
    bl_label = "Export Motion"
    bl_options = {"REGISTER"}

    filename_ext = ".zip"
    filter_glob: StringProperty(default="*.zip", options={"HIDDEN"})

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
            )
        except ValueError as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        except Exception as e:
            self.report({"ERROR"}, f"Export failed: {e}")
            return {"CANCELLED"}

        n_components = len(manifest["components"])
        n_samples = manifest["samples"]
        self.report(
            {"INFO"},
            f"Exported {n_components} component(s) × {n_samples} samples to "
            f"{os.path.basename(self.filepath)}",
        )
        return {"FINISHED"}


CLASSES = (
    SKM_OT_TagCarReference,
    SKM_OT_UntagCarReference,
    SKM_OT_TagTrackMotion,
    SKM_OT_UntagTrackMotion,
    SKM_OT_ExportMotion,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
```

- [ ] **Step 2: Verify syntax**

```bash
python3 -c "import ast; ast.parse(open('workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/motion_export/operators.py').read()); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/operators.py
git commit -m "feat(motion_export): Blender operators for tag/untag and export"
```

---

## Task 4: UI panel + scene properties + add-on registration + version bump

**Files:**
- Modify: `strokmatic_vision_tools/ui_panel.py`
- Modify: `strokmatic_vision_tools/__init__.py`
- Modify: `strokmatic_vision_tools/blender_manifest.toml`

- [ ] **Step 1: Add scene properties for motion export to `ui_panel.py`**

In `strokmatic_vision_tools/ui_panel.py`, locate the `SCENE_PROPS` dict and add the following entries at the end of it (preserving all existing entries and the surrounding `register`/`unregister` logic):

```python
    "skm_motion_auto_detect": BoolProperty(
        name="Auto-detect Components",
        default=True,
        description="If on, export every animated object. If off, only export "
                    "objects tagged with skm_track_motion",
    ),
    "skm_motion_sample_rate_hz": IntProperty(
        name="Sample Rate (Hz)",
        default=24,
        min=1,
        max=240,
        description="Samples per second (defaults to scene fps)",
    ),
    "skm_motion_frame_start": IntProperty(
        name="Frame Start",
        default=0,
        description="First frame to sample (defaults to scene.frame_start)",
    ),
    "skm_motion_frame_end": IntProperty(
        name="Frame End",
        default=959,
        description="Last frame to sample (defaults to scene.frame_end)",
    ),
```

- [ ] **Step 2: Add the Motion Export draw section to `SKM_PT_VisionTools.draw`**

In the same `ui_panel.py` file, append the following block to the `draw` method (after the existing Deflectometry Coverage section):

```python
        # --- Motion Export ---
        box = layout.box()
        box.label(text="Motion Export", icon='ANIM_DATA')

        # Car reference status + tag/untag buttons
        car_ref_name = "(none tagged)"
        for o in context.scene.objects:
            if o.get("skm_is_car_reference", False):
                car_ref_name = o.name
                break
        box.label(text=f"Car Reference: {car_ref_name}")
        row = box.row(align=True)
        row.operator("skm_vision.tag_car_reference", text="Tag as Car Reference", icon='ADD')
        row.operator("skm_vision.untag_car_reference", text="Untag", icon='REMOVE')

        box.prop(scene, "skm_motion_auto_detect", text="Auto-detect Components")
        if not scene.skm_motion_auto_detect:
            row = box.row(align=True)
            row.operator("skm_vision.tag_track_motion", text="Tag Component", icon='ADD')
            row.operator("skm_vision.untag_track_motion", text="Untag", icon='REMOVE')
            tagged_count = sum(
                1 for o in context.scene.objects if o.get("skm_track_motion", False)
            )
            box.label(text=f"Tagged components: {tagged_count}")

        col = box.column(align=True)
        col.prop(scene, "skm_motion_frame_start", text="Frame Start")
        col.prop(scene, "skm_motion_frame_end", text="Frame End")
        col.prop(scene, "skm_motion_sample_rate_hz", text="Sample Rate (Hz)")

        box.operator("skm_vision.export_motion", text="Export Motion", icon='EXPORT')
```

- [ ] **Step 3: Register the motion_export sub-package in `strokmatic_vision_tools/__init__.py`**

Replace the file's contents with:

```python
bl_info = {
    "name": "Strokmatic Vision Tools",
    "author": "Strokmatic",
    "version": (1, 2, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > SKM Vision",
    "description": "Machine vision validation — resolution, angle, deflectometry coverage, and motion export",
    "category": "3D View",
}

from . import calibration_importer
from . import resolution_heatmap
from . import angle_heatmap
from .deflectometry import operators as deflectometry_ops
from .motion_export import operators as motion_export_ops
from . import ui_panel


def register():
    calibration_importer.register()
    resolution_heatmap.register()
    angle_heatmap.register()
    deflectometry_ops.register()
    motion_export_ops.register()
    ui_panel.register()


def unregister():
    ui_panel.unregister()
    motion_export_ops.unregister()
    deflectometry_ops.unregister()
    angle_heatmap.unregister()
    resolution_heatmap.unregister()
    calibration_importer.unregister()


if __name__ == "__main__":
    register()
```

- [ ] **Step 4: Bump version in `strokmatic_vision_tools/blender_manifest.toml`**

Change:

```toml
version = "1.1.1"
```

to:

```toml
version = "1.2.0"
```

And update the tagline:

```toml
tagline = "Machine vision validation — resolution, angle, deflectometry coverage, and motion export"
```

- [ ] **Step 5: Verify syntax of all modified files**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
for f in strokmatic_vision_tools/__init__.py strokmatic_vision_tools/ui_panel.py; do
  python3 -c "import ast; ast.parse(open('$f').read()); print('OK: $f')"
done
```

Expected: `OK` for both files.

- [ ] **Step 6: Verify add-on registers cleanly**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
blender --background --python -c "
import bpy, sys
sys.path.insert(0, '.')
import strokmatic_vision_tools
strokmatic_vision_tools.register()
ops = sorted(op for op in dir(bpy.ops.skm_vision) if not op.startswith('_'))
assert 'export_motion' in ops, f'export_motion missing from {ops}'
assert 'tag_car_reference' in ops, f'tag_car_reference missing'
assert 'tag_track_motion' in ops, f'tag_track_motion missing'
strokmatic_vision_tools.unregister()
print('OK: all motion export operators registered')
" 2>&1 | tail -3
```

Expected: `OK: all motion export operators registered`

- [ ] **Step 7: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/__init__.py \
       strokmatic_vision_tools/ui_panel.py \
       strokmatic_vision_tools/blender_manifest.toml
git commit -m "feat(motion_export): UI panel section + scene properties + register at v1.2.0"
```

---

## Task 5: End-to-end test on the real GM v5 scene + run_all + local ZIP

**Files:**
- Modify: `tests/run_all.sh`

- [ ] **Step 1: Add motion export tests to `tests/run_all.sh`**

In `workspaces/strokmatic/sdk/sdk-blender-tools/tests/run_all.sh`:

In the `--- Pure Python tests ---` section, append:

```bash
run_test "motion_units"   "$SCRIPT_DIR/test_motion_export_units.py" "false"
run_test "motion_writer"  "$SCRIPT_DIR/test_motion_export_writer.py" "false"
```

In the `--- Blender tests ---` section, append:

```bash
run_test "motion_export"         "$SCRIPT_DIR/test_motion_export_integration.py"
```

- [ ] **Step 2: Run the full test suite**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && ./tests/run_all.sh
```

Expected: every test passes (the previous suite of 12 plus the 3 new motion-export tests = 15 total).

- [ ] **Step 3: Smoke-test against Tiago's real scene**

The real scene is at `/tmp/v5-gm-automacao.blend` (downloaded earlier in this conversation). If absent, the smoke test should be skipped — the real validation gate is the synthetic integration tests above.

```bash
if [ -f /tmp/v5-gm-automacao.blend ]; then
  cd workspaces/strokmatic/sdk/sdk-blender-tools
  blender --background /tmp/v5-gm-automacao.blend --python -c "
import bpy, sys, os, tempfile
sys.path.insert(0, '.')
import strokmatic_vision_tools
strokmatic_vision_tools.register()

# Tag the car reference
car_ref = bpy.data.objects['car-movement']
car_ref['skm_is_car_reference'] = True
bpy.context.view_layer.update()

# Export
from strokmatic_vision_tools.motion_export import export_motion
out = '/tmp/v5_motion_export.zip'
manifest = export_motion(
    context=bpy.context,
    output_path=out,
    sample_rate_hz=24,
)
print(f'Exported {len(manifest[\"components\"])} components, {manifest[\"samples\"]} samples')
print(f'Components: {[c[\"name\"] for c in manifest[\"components\"]]}')
print(f'ZIP: {os.path.getsize(out)} bytes')
strokmatic_vision_tools.unregister()
" 2>&1 | tail -10
else
  echo "Skipping smoke test: /tmp/v5-gm-automacao.blend not found"
fi
```

Expected output (when the scene is present): includes lines like:
- `Exported 6 components, 960 samples`
- A list of components matching what we found earlier (contina, height-ctrl, sobe-desce, N15-high, lat.full.003/004/005)
- ZIP size in the tens of KB

- [ ] **Step 4: Build the local testing ZIP for Tiago**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
rm -f /tmp/strokmatic_vision_tools_v1.2.0-testing.zip
zip -r /tmp/strokmatic_vision_tools_v1.2.0-testing.zip strokmatic_vision_tools/ \
    -x "strokmatic_vision_tools/__pycache__/*" \
       "strokmatic_vision_tools/deflectometry/__pycache__/*" \
       "strokmatic_vision_tools/motion_export/__pycache__/*"
ls -lh /tmp/strokmatic_vision_tools_v1.2.0-testing.zip
mv /tmp/strokmatic_vision_tools_v1.2.0-testing.zip ~/Documentos/
```

Expected: ZIP around 35–40 KB, written to `~/Documentos/` alongside the previous testing build.

- [ ] **Step 5: Commit the run_all.sh change**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add tests/run_all.sh
git commit -m "test(motion_export): wire 3 new test files into run_all.sh"
```

**Note:** Do NOT push or create a GitHub release. The build is for local validation only.
