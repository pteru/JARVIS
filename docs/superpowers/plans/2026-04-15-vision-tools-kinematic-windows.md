---
type: Implementation Plan
title: Vision Tools v1.4.0 — Kinematic Windows Implementation Plan
description: Same pattern as v1.2.0-v1.3.0:
timestamp: 2026-04-15
---

# Vision Tools v1.4.0 — Kinematic Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a kinematic-window analysis tool that classifies every actuator's timeline into critical windows (coverage depends on this actuator's position here) and free windows (no coverage constraint), outputting per-actuator CSVs plus colored Blender timeline markers.

**Architecture:** New `motion_export/windows/` sub-package. Pure-Python classifier + mapper consume the cached deflectometry `CoverageMatrix` and the motion-export component list, produce window runs per actuator. Writer packages them as a ZIP of CSVs + summary JSON. Blender operators run the analysis, paint `SKM_WIN_*` timeline markers, and handle filtering / export. UI gains a new collapsible section below Motion Export.

**Tech Stack:** Blender Python API (`bpy`), numpy (bundled), Python stdlib (`csv`, `json`, `zipfile`, `datetime`). No new external dependencies.

**Spec:** `docs/superpowers/specs/2026-04-15-vision-tools-kinematic-windows-design.md`

**Base path:** `workspaces/strokmatic/sdk/sdk-blender-tools/`

---

## Testing Approach

Same pattern as v1.2.0-v1.3.0:
- **Pure Python tests** (classifier, mapper, writer): `python3 tests/test_file.py`
- **Blender tests** (operators, marker painting, end-to-end): `blender --background --python tests/test_file.py`
- All tests use plain `assert` + print; pure-Python files import directly from module paths to avoid the bpy-dependent `__init__.py`.

---

## File Structure

```
strokmatic_vision_tools/
├── __init__.py                                  # Modify: register, bump to 1.4.0
├── blender_manifest.toml                        # Modify: 1.4.0
├── ui_panel.py                                  # Modify: new Kinematic Windows section + show-actuator property
└── motion_export/
    └── windows/
        ├── __init__.py                          # Public: compute_windows, export_windows
        ├── mapper.py                            # walk_parents_until_in_set
        ├── classifier.py                        # compress_to_runs, build_critical_frame_sets
        ├── writer.py                            # CSV/JSON/ZIP packaging
        └── operators.py                         # Blender operators

tests/
├── test_windows_classifier.py                   # Pure Python
├── test_windows_mapper.py                       # Blender (needs object hierarchy)
├── test_windows_writer.py                       # Pure Python
└── test_windows_integration.py                  # Blender end-to-end
```

---

## Task 1: Classifier — compress_to_runs + build_critical_frame_sets (pure Python)

**Files:**
- Create: `strokmatic_vision_tools/motion_export/windows/__init__.py`
- Create: `strokmatic_vision_tools/motion_export/windows/classifier.py`
- Create: `tests/test_windows_classifier.py`

Pure-Python building blocks that transform a set of covered frames (per actuator) into ordered FREE/CRITICAL runs.

- [ ] **Step 1: Create `strokmatic_vision_tools/motion_export/windows/__init__.py` (sub-package marker)**

```python
"""Kinematic window analysis — critical vs. free actuator timeline segments.

Cross-references the deflectometry coverage matrix with the motion export's
actuator list to classify each actuator's frames as CRITICAL (coverage
depends on exact position here) or FREE (safe to reshape for smoother motion).
"""
```

- [ ] **Step 2: Write `tests/test_windows_classifier.py`**

```python
"""Pure-Python tests for classifier.py — no Blender required."""
import os
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(__file__), "..",
    "strokmatic_vision_tools", "motion_export", "windows"))
from classifier import compress_to_runs, build_critical_frame_sets


def test_compress_to_runs_empty_set_returns_single_free_window():
    runs = compress_to_runs(critical_frames=set(), frame_start=0, frame_end=9)
    assert runs == [(0, 9, 10, "FREE")]


def test_compress_to_runs_all_critical_returns_single_critical_window():
    crit = set(range(0, 10))
    runs = compress_to_runs(critical_frames=crit, frame_start=0, frame_end=9)
    assert runs == [(0, 9, 10, "CRITICAL")]


def test_compress_to_runs_middle_critical_gives_free_critical_free():
    crit = {3, 4, 5, 6}
    runs = compress_to_runs(critical_frames=crit, frame_start=0, frame_end=9)
    assert runs == [
        (0, 2, 3, "FREE"),
        (3, 6, 4, "CRITICAL"),
        (7, 9, 3, "FREE"),
    ]


def test_compress_to_runs_single_frame_gap_between_critical_is_merged():
    """A single-frame gap between two critical runs merges them (stride tolerance 1)."""
    # frames 2,3 critical, 4 not, 5,6 critical → with tolerance 1, all of 2-6 should merge
    crit = {2, 3, 5, 6}
    runs = compress_to_runs(critical_frames=crit, frame_start=0, frame_end=9, gap_tolerance=1)
    assert runs == [
        (0, 1, 2, "FREE"),
        (2, 6, 5, "CRITICAL"),
        (7, 9, 3, "FREE"),
    ]


def test_compress_to_runs_two_frame_gap_kept_separate():
    """A two-frame gap is NOT merged (exceeds tolerance of 1)."""
    crit = {2, 3, 6, 7}  # gap is frames 4,5
    runs = compress_to_runs(critical_frames=crit, frame_start=0, frame_end=9, gap_tolerance=1)
    assert runs == [
        (0, 1, 2, "FREE"),
        (2, 3, 2, "CRITICAL"),
        (4, 5, 2, "FREE"),
        (6, 7, 2, "CRITICAL"),
        (8, 9, 2, "FREE"),
    ]


def test_compress_to_runs_starts_critical_ends_critical():
    crit = {0, 1, 2, 8, 9}
    runs = compress_to_runs(critical_frames=crit, frame_start=0, frame_end=9)
    assert runs == [
        (0, 2, 3, "CRITICAL"),
        (3, 7, 5, "FREE"),
        (8, 9, 2, "CRITICAL"),
    ]


def test_compress_to_runs_frames_outside_range_ignored():
    """Frames outside [frame_start, frame_end] are clipped."""
    crit = {-5, 3, 4, 50}
    runs = compress_to_runs(critical_frames=crit, frame_start=0, frame_end=9)
    assert runs == [
        (0, 2, 3, "FREE"),
        (3, 4, 2, "CRITICAL"),
        (5, 9, 5, "FREE"),
    ]


def test_build_critical_frame_sets_single_vertex_single_hit():
    """One vertex covered by one camera hit → that camera's actuator gets frames."""
    coverage_results = {
        10: {
            "hits": [{"camera": "CamA", "first_step": 5, "last_step": 8}],
            "nearest_misses": [],
        }
    }
    camera_to_actuator = {"CamA": "actA"}
    result = build_critical_frame_sets(
        coverage_results=coverage_results,
        camera_to_actuator=camera_to_actuator,
    )
    assert result == {"actA": {5, 6, 7, 8}}


def test_build_critical_frame_sets_multiple_vertices_same_actuator_union():
    """Two vertices, both covered by same camera → union of their frames."""
    coverage_results = {
        10: {"hits": [{"camera": "CamA", "first_step": 2, "last_step": 4}], "nearest_misses": []},
        11: {"hits": [{"camera": "CamA", "first_step": 6, "last_step": 8}], "nearest_misses": []},
    }
    camera_to_actuator = {"CamA": "actA"}
    result = build_critical_frame_sets(
        coverage_results=coverage_results,
        camera_to_actuator=camera_to_actuator,
    )
    assert result == {"actA": {2, 3, 4, 6, 7, 8}}


def test_build_critical_frame_sets_vertex_covered_by_two_cameras_both_actuators_critical():
    """A vertex covered by two cameras marks BOTH their actuators critical."""
    coverage_results = {
        10: {
            "hits": [
                {"camera": "CamA", "first_step": 1, "last_step": 3},
                {"camera": "CamB", "first_step": 5, "last_step": 7},
            ],
            "nearest_misses": [],
        }
    }
    camera_to_actuator = {"CamA": "actA", "CamB": "actB"}
    result = build_critical_frame_sets(
        coverage_results=coverage_results,
        camera_to_actuator=camera_to_actuator,
    )
    assert result == {"actA": {1, 2, 3}, "actB": {5, 6, 7}}


def test_build_critical_frame_sets_skips_static_cameras():
    """A camera whose actuator mapping is None contributes no critical frames."""
    coverage_results = {
        10: {"hits": [{"camera": "StaticCam", "first_step": 1, "last_step": 3}], "nearest_misses": []},
    }
    camera_to_actuator = {"StaticCam": None}
    result = build_critical_frame_sets(
        coverage_results=coverage_results,
        camera_to_actuator=camera_to_actuator,
    )
    assert result == {}


def test_build_critical_frame_sets_uncovered_vertex_contributes_nothing():
    """A vertex with no hits (only nearest_misses) contributes no critical frames."""
    coverage_results = {
        10: {"hits": [], "nearest_misses": [{"camera": "CamA", "best_sweep_step": 5}]}
    }
    camera_to_actuator = {"CamA": "actA"}
    result = build_critical_frame_sets(
        coverage_results=coverage_results,
        camera_to_actuator=camera_to_actuator,
    )
    assert result == {}


if __name__ == "__main__":
    test_compress_to_runs_empty_set_returns_single_free_window()
    test_compress_to_runs_all_critical_returns_single_critical_window()
    test_compress_to_runs_middle_critical_gives_free_critical_free()
    test_compress_to_runs_single_frame_gap_between_critical_is_merged()
    test_compress_to_runs_two_frame_gap_kept_separate()
    test_compress_to_runs_starts_critical_ends_critical()
    test_compress_to_runs_frames_outside_range_ignored()
    test_build_critical_frame_sets_single_vertex_single_hit()
    test_build_critical_frame_sets_multiple_vertices_same_actuator_union()
    test_build_critical_frame_sets_vertex_covered_by_two_cameras_both_actuators_critical()
    test_build_critical_frame_sets_skips_static_cameras()
    test_build_critical_frame_sets_uncovered_vertex_contributes_nothing()
    print("OK: all windows_classifier tests passed")
```

- [ ] **Step 3: Run tests — verify failure**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_windows_classifier.py
```

Expected: `ModuleNotFoundError: No module named 'classifier'`

- [ ] **Step 4: Implement `strokmatic_vision_tools/motion_export/windows/classifier.py`**

```python
"""Classifier — transforms per-vertex coverage hits into per-actuator frame runs.

Pure Python. No bpy / numpy dependency.
"""


def compress_to_runs(critical_frames, frame_start, frame_end, gap_tolerance=1):
    """Convert a set of critical frame numbers into an ordered run list.

    The output covers the full [frame_start, frame_end] range with
    alternating FREE and CRITICAL runs. Adjacent CRITICAL runs separated
    by at most ``gap_tolerance`` non-critical frames are merged into one
    — this smooths over sampling-stride artifacts in the coverage data.

    Args:
        critical_frames: Iterable of integer frame numbers flagged critical.
        frame_start: First frame (inclusive) in the output.
        frame_end: Last frame (inclusive) in the output.
        gap_tolerance: Max gap between critical runs that will be merged.
            Default 1 (a single non-critical frame between two critical
            runs is merged). Set to 0 to disable merging.

    Returns:
        List of tuples ``(start, end, n_frames, type)`` where type is
        "FREE" or "CRITICAL". Runs are sorted by start frame and together
        span the full range with no gaps.
    """
    if frame_end < frame_start:
        return []

    # Clip to the requested range first
    in_range = {f for f in critical_frames if frame_start <= f <= frame_end}
    if not in_range:
        total = frame_end - frame_start + 1
        return [(frame_start, frame_end, total, "FREE")]

    # Build contiguous critical runs (frame i is "adjacent" to frame i+1)
    sorted_frames = sorted(in_range)
    critical_runs = []  # list of [start, end]
    run_start = sorted_frames[0]
    run_end = sorted_frames[0]
    for f in sorted_frames[1:]:
        if f <= run_end + 1 + gap_tolerance:
            # Merge: extend the current run to include this frame
            run_end = f
        else:
            critical_runs.append([run_start, run_end])
            run_start = f
            run_end = f
    critical_runs.append([run_start, run_end])

    # Interleave with FREE runs to fill the [frame_start, frame_end] range
    result = []
    cursor = frame_start
    for cs, ce in critical_runs:
        if cursor < cs:
            result.append((cursor, cs - 1, cs - cursor, "FREE"))
        result.append((cs, ce, ce - cs + 1, "CRITICAL"))
        cursor = ce + 1
    if cursor <= frame_end:
        result.append((cursor, frame_end, frame_end - cursor + 1, "FREE"))

    return result


def build_critical_frame_sets(coverage_results, camera_to_actuator):
    """Aggregate per-vertex coverage hits into per-actuator critical frame sets.

    For each covered vertex, for each CameraHit, add all frames in
    [first_step, last_step] to the critical frame set of the camera's
    driving actuator. Cameras whose actuator mapping is None (statically
    positioned cameras) are skipped.

    Args:
        coverage_results: Dict mapping vertex index to a dict with keys
            "hits" (list of dicts with "camera", "first_step", "last_step")
            and "nearest_misses" (unused by this function).
        camera_to_actuator: Dict mapping camera name to driving actuator
            name, or None if the camera is statically positioned.

    Returns:
        Dict mapping actuator name to a set of critical frame integers.
        Actuators with no critical frames are omitted.
    """
    result = {}
    for vertex_data in coverage_results.values():
        hits = vertex_data.get("hits") or []
        for hit in hits:
            cam_name = hit["camera"]
            actuator = camera_to_actuator.get(cam_name)
            if actuator is None:
                continue
            first = hit["first_step"]
            last = hit["last_step"]
            frames = result.setdefault(actuator, set())
            for f in range(first, last + 1):
                frames.add(f)
    return result
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_windows_classifier.py
```

Expected: `OK: all windows_classifier tests passed`

- [ ] **Step 6: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/windows/__init__.py \
       strokmatic_vision_tools/motion_export/windows/classifier.py \
       tests/test_windows_classifier.py
git commit -m "feat(windows): classifier — compress_to_runs + build_critical_frame_sets (pure Python)"
```

---

## Task 2: Mapper — walk_parents_until_in_set + build_camera_actuator_map (Blender)

**Files:**
- Create: `strokmatic_vision_tools/motion_export/windows/mapper.py`
- Create: `tests/test_windows_mapper.py`

Resolves cameras to their driving actuators via parent-chain walk. Needs Blender to build test scenes.

- [ ] **Step 1: Write `tests/test_windows_mapper.py`**

```python
"""Blender tests for mapper.py — parent-chain walk."""
import bpy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.motion_export.windows.mapper import (
    walk_parents_until_in_set,
    build_camera_actuator_map,
)


def _setup_chain():
    """Build a three-level chain: grandparent ← parent ← child (all empties)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    gp = bpy.data.objects.new("grandparent", None)
    pa = bpy.data.objects.new("parent", None)
    ch = bpy.data.objects.new("child", None)
    for obj in (gp, pa, ch):
        bpy.context.collection.objects.link(obj)
    pa.parent = gp
    ch.parent = pa
    bpy.context.view_layer.update()
    return gp, pa, ch


def test_walk_parents_returns_first_matching_ancestor():
    gp, pa, ch = _setup_chain()
    result = walk_parents_until_in_set(ch, {"parent"})
    assert result == "parent"


def test_walk_parents_skips_to_higher_ancestor_if_first_not_in_set():
    gp, pa, ch = _setup_chain()
    result = walk_parents_until_in_set(ch, {"grandparent"})
    assert result == "grandparent"


def test_walk_parents_returns_none_when_no_ancestor_in_set():
    gp, pa, ch = _setup_chain()
    result = walk_parents_until_in_set(ch, {"unrelated"})
    assert result is None


def test_walk_parents_returns_none_for_object_with_no_parent():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lone = bpy.data.objects.new("lone", None)
    bpy.context.collection.objects.link(lone)
    result = walk_parents_until_in_set(lone, {"anything"})
    assert result is None


def test_walk_parents_does_not_return_the_object_itself():
    """Even if obj.name is in the set, the walk starts at obj.parent."""
    gp, pa, ch = _setup_chain()
    # ch is not in set; pa is (matches) — so walking from ch returns "parent"
    # But if we pass pa itself and ask for "parent", should return None (we look at pa.parent = gp)
    result = walk_parents_until_in_set(pa, {"parent"})
    assert result is None


def test_build_camera_actuator_map_resolves_each_camera():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Actuator empty
    act = bpy.data.objects.new("rig.Z.1", None)
    bpy.context.collection.objects.link(act)
    # Camera parented to actuator
    cam_data = bpy.data.cameras.new("CamA")
    cam = bpy.data.objects.new("CamA", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.parent = act
    # Standalone camera (no actuator)
    cam2_data = bpy.data.cameras.new("CamB")
    cam2 = bpy.data.objects.new("CamB", cam2_data)
    bpy.context.collection.objects.link(cam2)
    bpy.context.view_layer.update()

    result = build_camera_actuator_map(
        camera_names=["CamA", "CamB"],
        actuator_names={"rig.Z.1"},
    )
    assert result == {"CamA": "rig.Z.1", "CamB": None}


def test_build_camera_actuator_map_missing_camera_raises():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        build_camera_actuator_map(camera_names=["GhostCam"], actuator_names=set())
        assert False, "Should raise KeyError for missing camera"
    except KeyError:
        pass


if __name__ == "__main__":
    test_walk_parents_returns_first_matching_ancestor()
    test_walk_parents_skips_to_higher_ancestor_if_first_not_in_set()
    test_walk_parents_returns_none_when_no_ancestor_in_set()
    test_walk_parents_returns_none_for_object_with_no_parent()
    test_walk_parents_does_not_return_the_object_itself()
    test_build_camera_actuator_map_resolves_each_camera()
    test_build_camera_actuator_map_missing_camera_raises()
    print("OK: all windows_mapper tests passed")
```

- [ ] **Step 2: Run tests — verify failure**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_windows_mapper.py 2>&1 | tail -5
```

Expected: `ImportError: cannot import name 'walk_parents_until_in_set'` or similar.

- [ ] **Step 3: Implement `strokmatic_vision_tools/motion_export/windows/mapper.py`**

```python
"""Parent-chain walker that resolves cameras to their driving actuators."""
import bpy


def walk_parents_until_in_set(obj, name_set):
    """Walk obj's parent chain and return the first ancestor name in name_set.

    The walk starts at ``obj.parent`` (not obj itself), so an object
    cannot be its own driving actuator.

    Args:
        obj: A bpy.types.Object.
        name_set: Set of object names to match against.

    Returns:
        The first matching ancestor's name, or None if no ancestor matches.
    """
    cur = obj.parent
    while cur is not None:
        if cur.name in name_set:
            return cur.name
        cur = cur.parent
    return None


def build_camera_actuator_map(camera_names, actuator_names):
    """Resolve each camera name to its driving actuator name (or None).

    Args:
        camera_names: Iterable of camera object names to resolve.
        actuator_names: Set of actuator object names to match against.

    Returns:
        Dict mapping camera name to its driving actuator name, or None
        if the camera is statically positioned (no matching ancestor).

    Raises:
        KeyError: If any camera name is not present in bpy.data.objects.
    """
    result = {}
    actuator_set = set(actuator_names)
    for cam_name in camera_names:
        cam_obj = bpy.data.objects.get(cam_name)
        if cam_obj is None:
            raise KeyError(f"Camera '{cam_name}' not found in bpy.data.objects")
        result[cam_name] = walk_parents_until_in_set(cam_obj, actuator_set)
    return result
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_windows_mapper.py 2>&1 | tail -5
```

Expected: `OK: all windows_mapper tests passed`

- [ ] **Step 5: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/windows/mapper.py \
       tests/test_windows_mapper.py
git commit -m "feat(windows): mapper — walk_parents_until_in_set + build_camera_actuator_map"
```

---

## Task 3: Writer — summary JSON + per-actuator CSVs + ZIP packaging (pure Python)

**Files:**
- Create: `strokmatic_vision_tools/motion_export/windows/writer.py`
- Create: `tests/test_windows_writer.py`

- [ ] **Step 1: Write `tests/test_windows_writer.py`**

```python
"""Pure-Python tests for windows writer."""
import csv
import io
import json
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.join(
    os.path.dirname(__file__), "..",
    "strokmatic_vision_tools", "motion_export", "windows"))
from writer import actuator_windows_csv_rows, write_windows_zip


def _sample_windows_data():
    return {
        "exported_at": "2026-04-15T21:00:00Z",
        "blend_file": "test.blend",
        "scene": "Scene",
        "frame_range": [0, 9],
        "coverage_source": {"exported_at": "2026-04-15T20:55:00Z", "samples": 10},
        "actuators": [
            {
                "name": "actA",
                "type": "EMPTY",
                "driving_cameras": ["CamA"],
                "total_critical_frames": 4,
                "total_free_frames": 6,
                "windows": [
                    {"start_frame": 0, "end_frame": 2, "n_frames": 3, "type": "FREE", "n_covering_vertices": 0},
                    {"start_frame": 3, "end_frame": 6, "n_frames": 4, "type": "CRITICAL", "n_covering_vertices": 12},
                    {"start_frame": 7, "end_frame": 9, "n_frames": 3, "type": "FREE", "n_covering_vertices": 0},
                ],
            }
        ],
    }


def test_actuator_windows_csv_rows_has_correct_header():
    data = _sample_windows_data()
    rows = actuator_windows_csv_rows(data["actuators"][0])
    assert rows[0] == ["start_frame", "end_frame", "n_frames", "type", "n_covering_vertices"]


def test_actuator_windows_csv_rows_serializes_windows():
    data = _sample_windows_data()
    rows = actuator_windows_csv_rows(data["actuators"][0])
    assert rows[1] == [0, 2, 3, "FREE", 0]
    assert rows[2] == [3, 6, 4, "CRITICAL", 12]
    assert rows[3] == [7, 9, 3, "FREE", 0]


def test_write_windows_zip_produces_expected_files():
    data = _sample_windows_data()
    with tempfile.TemporaryDirectory() as tmpdir:
        out = os.path.join(tmpdir, "windows.zip")
        write_windows_zip(data, out)
        assert os.path.exists(out)
        with zipfile.ZipFile(out, "r") as zf:
            names = sorted(zf.namelist())
            assert names == ["actuators/actA_windows.csv", "summary.json"]

            summary = json.loads(zf.read("summary.json").decode())
            assert summary["blend_file"] == "test.blend"
            assert summary["scene"] == "Scene"
            assert summary["frame_range"] == [0, 9]
            assert len(summary["actuators"]) == 1
            assert summary["actuators"][0]["name"] == "actA"
            assert summary["actuators"][0]["critical_pct"] == 40.0  # 4/10
            assert summary["actuators"][0]["free_pct"] == 60.0       # 6/10
            assert summary["actuators"][0]["n_windows"] == 3

            csv_text = zf.read("actuators/actA_windows.csv").decode()
            reader = csv.reader(io.StringIO(csv_text))
            rows = list(reader)
            assert rows[0] == ["start_frame", "end_frame", "n_frames", "type", "n_covering_vertices"]
            assert rows[1] == ["0", "2", "3", "FREE", "0"]
            assert rows[2] == ["3", "6", "4", "CRITICAL", "12"]
            assert rows[3] == ["7", "9", "3", "FREE", "0"]


def test_write_windows_zip_slashes_in_actuator_names_become_underscores():
    """Slashes and other path-unsafe chars in names are sanitized for the CSV filename."""
    data = _sample_windows_data()
    data["actuators"][0]["name"] = "rig/with/slashes"
    with tempfile.TemporaryDirectory() as tmpdir:
        out = os.path.join(tmpdir, "windows.zip")
        write_windows_zip(data, out)
        with zipfile.ZipFile(out, "r") as zf:
            names = sorted(zf.namelist())
            assert "actuators/rig_with_slashes_windows.csv" in names


if __name__ == "__main__":
    test_actuator_windows_csv_rows_has_correct_header()
    test_actuator_windows_csv_rows_serializes_windows()
    test_write_windows_zip_produces_expected_files()
    test_write_windows_zip_slashes_in_actuator_names_become_underscores()
    print("OK: all windows_writer tests passed")
```

- [ ] **Step 2: Run tests — verify failure**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_windows_writer.py
```

Expected: `ModuleNotFoundError: No module named 'writer'`

- [ ] **Step 3: Implement `strokmatic_vision_tools/motion_export/windows/writer.py`**

```python
"""Writer — JSON summary + per-actuator CSVs packaged as a ZIP."""
import csv
import io
import json
import zipfile


CSV_HEADER = ["start_frame", "end_frame", "n_frames", "type", "n_covering_vertices"]


def _sanitize_filename(name):
    """Replace path-unsafe characters so the name is safe as a filename.

    Slashes, backslashes and colons become underscores. All other
    characters are preserved.
    """
    sanitized = name
    for ch in ("/", "\\", ":"):
        sanitized = sanitized.replace(ch, "_")
    return sanitized


def actuator_windows_csv_rows(actuator):
    """Build CSV rows (header + data) for one actuator.

    Args:
        actuator: Dict with key "windows" — a list of window dicts each
            having "start_frame", "end_frame", "n_frames", "type",
            "n_covering_vertices".

    Returns:
        List of rows (lists). First row is the header.
    """
    rows = [list(CSV_HEADER)]
    for w in actuator["windows"]:
        rows.append([
            w["start_frame"],
            w["end_frame"],
            w["n_frames"],
            w["type"],
            w["n_covering_vertices"],
        ])
    return rows


def _rows_to_csv_bytes(rows):
    """Serialize a list of rows to CSV bytes (utf-8)."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def _build_summary(data):
    """Build the summary JSON structure from a full windows data dict."""
    total_frames = data["frame_range"][1] - data["frame_range"][0] + 1
    actuators_summary = []
    for a in data["actuators"]:
        crit = a.get("total_critical_frames", 0)
        free = a.get("total_free_frames", 0)
        denom = crit + free if (crit + free) > 0 else total_frames
        actuators_summary.append({
            "name": a["name"],
            "critical_pct": round(100.0 * crit / denom, 3) if denom > 0 else 0.0,
            "free_pct": round(100.0 * free / denom, 3) if denom > 0 else 0.0,
            "n_windows": len(a.get("windows", [])),
            "driving_cameras": a.get("driving_cameras", []),
        })
    return {
        "exported_at": data["exported_at"],
        "blend_file": data.get("blend_file", ""),
        "scene": data.get("scene", ""),
        "frame_range": data["frame_range"],
        "coverage_source": data.get("coverage_source", {}),
        "actuators": actuators_summary,
    }


def write_windows_zip(data, output_path):
    """Write a windows analysis ZIP to ``output_path``.

    Args:
        data: Full windows data dict (see spec "Cached data structure").
        output_path: Absolute filesystem path to write.
    """
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("summary.json", json.dumps(_build_summary(data), indent=2))
        for actuator in data["actuators"]:
            safe_name = _sanitize_filename(actuator["name"])
            csv_path = f"actuators/{safe_name}_windows.csv"
            rows = actuator_windows_csv_rows(actuator)
            zf.writestr(csv_path, _rows_to_csv_bytes(rows))
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_windows_writer.py
```

Expected: `OK: all windows_writer tests passed`

- [ ] **Step 5: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/windows/writer.py \
       tests/test_windows_writer.py
git commit -m "feat(windows): writer — summary JSON + per-actuator CSVs + ZIP packaging"
```

---

## Task 4: Orchestration — compute_windows public API + public __init__.py (Blender)

**Files:**
- Modify: `strokmatic_vision_tools/motion_export/windows/__init__.py`
- Create: `tests/test_windows_integration.py`

- [ ] **Step 1: Write `tests/test_windows_integration.py` (partial — orchestration coverage)**

```python
"""Blender integration tests for the windows sub-package."""
import bpy
import datetime
import math
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.motion_export.windows import (
    compute_windows,
    export_windows,
)


def _build_scene_with_coverage():
    """Build a minimal scene with one actuator, one camera, a plane, an emitter.

    Also tags the car, runs coverage, caches result on the scene.
    Returns the scene object for convenience.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = 20
    scene.render.fps = 24
    scene.render.resolution_x = 640
    scene.render.resolution_y = 512

    # Car reference: an animated empty along Y
    car = bpy.data.objects.new("car-ref", None)
    bpy.context.collection.objects.link(car)
    car["skm_is_car_reference"] = True
    car.location = (0.0, 0.0, 0.0)
    car.keyframe_insert(data_path="location", frame=0)
    car.location = (0.0, 0.2, 0.0)
    car.keyframe_insert(data_path="location", frame=20)

    # Actuator empty — animated in Z
    act = bpy.data.objects.new("actuator-Z", None)
    bpy.context.collection.objects.link(act)
    act.location = (0.0, 0.0, 1.5)
    act.keyframe_insert(data_path="location", frame=0)
    act.location = (0.0, 0.0, 1.6)
    act.keyframe_insert(data_path="location", frame=20)

    # Camera parented to actuator
    cam_data = bpy.data.cameras.new("TestCam")
    cam_data.lens = 12
    cam_data.sensor_width = 36.0
    cam_obj = bpy.data.objects.new("TestCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.parent = act
    cam_obj.location = (0.0, 0.0, 0.0)  # offset from parent
    scene.camera = cam_obj

    # Car body plane parented to car ref
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "body"
    plane.parent = car
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.subdivide(number_cuts=4)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Emitter cylinder off to the side
    bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=2.0, location=(1.0, 0.0, 1.0))
    emitter = bpy.context.active_object
    emitter.name = "Emitter1"
    emitter.rotation_euler = (math.radians(90), 0, 0)
    emitter["skm_is_emitter"] = True

    bpy.context.view_layer.update()

    # Run coverage — this populates scene["_skm_coverage_json"]
    from strokmatic_vision_tools.deflectometry.coverage import compute_coverage
    from strokmatic_vision_tools.deflectometry.coverage_data import CoverageParams
    params = CoverageParams(
        sweep_axis="Y", sweep_start=-200, sweep_end=200, sweep_step=50,
        check_resolution=False, check_angle=False,
        check_sweep_duration=False, check_occlusion=False,
    )
    matrix = compute_coverage(bpy.context, params, targets=[plane])
    scene["_skm_coverage_json"] = matrix.to_json()

    return scene, car, act, cam_obj, plane, emitter


def test_compute_windows_raises_when_no_coverage_cached():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        compute_windows(bpy.context)
        assert False, "Expected ValueError for missing coverage"
    except ValueError as e:
        assert "coverage" in str(e).lower()


def test_compute_windows_produces_actuator_entries():
    scene, car, act, cam, plane, emitter = _build_scene_with_coverage()
    data = compute_windows(bpy.context)
    assert "actuators" in data
    assert "exported_at" in data
    assert data["frame_range"] == [0, 20]
    # We expect our "actuator-Z" to appear
    act_names = [a["name"] for a in data["actuators"]]
    assert "actuator-Z" in act_names, f"expected actuator-Z in {act_names}"


def test_compute_windows_paints_timeline_markers():
    scene, car, act, cam, plane, emitter = _build_scene_with_coverage()
    compute_windows(bpy.context)
    # Timeline markers should start with SKM_WIN_
    skm_markers = [m for m in scene.timeline_markers if m.name.startswith("SKM_WIN_")]
    assert len(skm_markers) > 0, "Expected SKM_WIN_ markers to be painted"


def test_compute_windows_caches_result_on_scene():
    scene, car, act, cam, plane, emitter = _build_scene_with_coverage()
    compute_windows(bpy.context)
    assert "_skm_windows_json" in scene


def test_export_windows_writes_zip():
    scene, car, act, cam, plane, emitter = _build_scene_with_coverage()
    data = compute_windows(bpy.context)
    with tempfile.TemporaryDirectory() as tmpdir:
        out = os.path.join(tmpdir, "windows.zip")
        export_windows(data, out)
        assert os.path.exists(out)
        with zipfile.ZipFile(out) as zf:
            names = zf.namelist()
            assert "summary.json" in names
            assert any(n.startswith("actuators/") and n.endswith("_windows.csv") for n in names)


if __name__ == "__main__":
    test_compute_windows_raises_when_no_coverage_cached()
    test_compute_windows_produces_actuator_entries()
    test_compute_windows_paints_timeline_markers()
    test_compute_windows_caches_result_on_scene()
    test_export_windows_writes_zip()
    print("OK: all windows integration tests passed")
```

- [ ] **Step 2: Run tests — verify failure**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_windows_integration.py 2>&1 | tail -5
```

Expected: `ImportError: cannot import name 'compute_windows'` (not yet implemented).

- [ ] **Step 3: Replace `strokmatic_vision_tools/motion_export/windows/__init__.py` with the full public API**

```python
"""Kinematic window analysis — critical vs. free actuator timeline segments.

Cross-references the deflectometry coverage matrix with the motion export's
actuator list to classify each actuator's frames as CRITICAL (coverage
depends on exact position here) or FREE (safe to reshape for smoother motion).

Public API: compute_windows(context) and export_windows(data, output_path).
"""
import datetime
import json
import os

import bpy

from ..sampler import find_car_reference, find_tracked_components
from .classifier import build_critical_frame_sets, compress_to_runs
from .mapper import build_camera_actuator_map
from .writer import write_windows_zip


# Markers we paint — used as the namespace prefix for clean removal
MARKER_PREFIX = "SKM_WIN_"


def _clear_skm_markers(scene):
    """Remove every timeline marker whose name starts with SKM_WIN_."""
    doomed = [m for m in scene.timeline_markers if m.name.startswith(MARKER_PREFIX)]
    for m in doomed:
        scene.timeline_markers.remove(m)


def _paint_markers(scene, actuators):
    """Insert SKM_WIN_<actuator>_<type>_START|END markers for each window."""
    for actuator in actuators:
        name = actuator["name"]
        for w in actuator["windows"]:
            start_marker = f"{MARKER_PREFIX}{name}_{w['type']}_START"
            end_marker = f"{MARKER_PREFIX}{name}_{w['type']}_END"
            scene.timeline_markers.new(start_marker, frame=w["start_frame"])
            scene.timeline_markers.new(end_marker, frame=w["end_frame"])


def _emitter_actuator_names(context, actuator_names):
    """Return set of actuator names that drive at least one emitter."""
    result = set()
    for obj in context.scene.objects:
        if obj.get("skm_is_emitter", False):
            from .mapper import walk_parents_until_in_set
            a = walk_parents_until_in_set(obj, actuator_names)
            if a is not None:
                result.add(a)
    return result


def _covered_steps_union(coverage_results):
    """Return the set of all sweep steps touched by any CameraHit."""
    steps = set()
    for vertex_data in coverage_results.values():
        for hit in vertex_data.get("hits") or []:
            for f in range(hit["first_step"], hit["last_step"] + 1):
                steps.add(f)
    return steps


def compute_windows(context):
    """Analyze the cached coverage matrix and classify each actuator's frames.

    Reads ``scene["_skm_coverage_json"]`` (produced by the deflectometry
    Compute Coverage operator), walks parent chains to map cameras to
    their driving actuators, and aggregates critical frames per actuator.

    Side effects: caches the result as ``scene["_skm_windows_json"]`` and
    paints ``SKM_WIN_*``-prefixed timeline markers in the scene (clearing
    any previous markers of the same prefix first).

    Args:
        context: Blender context.

    Returns:
        The full windows data dict (see spec).

    Raises:
        ValueError: If no cached coverage is present on the scene.
    """
    scene = context.scene
    if "_skm_coverage_json" not in scene:
        raise ValueError(
            "No cached coverage found. Run 'Compute Coverage' in the "
            "Deflectometry Coverage panel before computing windows."
        )

    coverage = json.loads(scene["_skm_coverage_json"])
    coverage_results = {int(k): v for k, v in coverage["results"].items()}
    coverage_cameras = coverage.get("cameras", [])
    coverage_meta = {
        "exported_at": coverage.get("exported_at"),
        "samples": coverage.get("samples"),
    }

    # Discover actuators: fresh motion-export-style auto-detect
    car_ref = find_car_reference(context)
    if car_ref is None:
        raise ValueError(
            "No car reference tagged. Tag an object with skm_is_car_reference first."
        )
    components = find_tracked_components(context, car_ref, auto_detect=True)
    actuator_names_list = [c.name for c in components]
    actuator_set = set(actuator_names_list)

    # Camera → actuator map
    camera_to_actuator = build_camera_actuator_map(
        camera_names=coverage_cameras,
        actuator_names=actuator_set,
    )

    # Per-actuator critical frames from camera hits
    per_actuator_frames = build_critical_frame_sets(
        coverage_results=coverage_results,
        camera_to_actuator=camera_to_actuator,
    )

    # Emitter-side conservatism: every actuator that drives an emitter is
    # marked critical at every step where ANY vertex was covered
    emitter_actuators = _emitter_actuator_names(context, actuator_set)
    if emitter_actuators:
        covered_steps = _covered_steps_union(coverage_results)
        for a in emitter_actuators:
            per_actuator_frames.setdefault(a, set()).update(covered_steps)

    # Compute n_covering_vertices per actuator per step (for the CSV detail column)
    # This is a reverse index: for each (actuator, step), how many covered
    # vertices relied on some camera driven by that actuator?
    vertex_count_by_actuator_step = {}  # (actuator, step) → int
    for vertex_data in coverage_results.values():
        hits = vertex_data.get("hits") or []
        if not hits:
            continue
        actuators_hit = set()
        for hit in hits:
            a = camera_to_actuator.get(hit["camera"])
            if a is None:
                continue
            for step in range(hit["first_step"], hit["last_step"] + 1):
                actuators_hit.add((a, step))
        for key in actuators_hit:
            vertex_count_by_actuator_step[key] = vertex_count_by_actuator_step.get(key, 0) + 1

    # Build actuator entries
    frame_start = scene.frame_start
    frame_end = scene.frame_end
    actuator_entries = []
    for name in actuator_names_list:
        critical_frames = per_actuator_frames.get(name, set())
        runs = compress_to_runs(
            critical_frames=critical_frames,
            frame_start=frame_start,
            frame_end=frame_end,
        )
        # For each CRITICAL run, take the peak n_covering_vertices across its frames
        windows_detail = []
        total_crit = 0
        total_free = 0
        for (s, e, n, typ) in runs:
            if typ == "CRITICAL":
                peak = max(
                    (vertex_count_by_actuator_step.get((name, f), 0) for f in range(s, e + 1)),
                    default=0,
                )
                total_crit += n
            else:
                peak = 0
                total_free += n
            windows_detail.append({
                "start_frame": s,
                "end_frame": e,
                "n_frames": n,
                "type": typ,
                "n_covering_vertices": peak,
            })

        # Driving cameras: any camera mapped to this actuator
        driving_cameras = [c for c, a in camera_to_actuator.items() if a == name]

        # Blender type for display
        obj = bpy.data.objects.get(name)
        obj_type = obj.type if obj else "UNKNOWN"

        actuator_entries.append({
            "name": name,
            "type": obj_type,
            "driving_cameras": sorted(driving_cameras),
            "total_critical_frames": total_crit,
            "total_free_frames": total_free,
            "windows": windows_detail,
        })

    blend_path = bpy.data.filepath if bpy.data.filepath else ""
    data = {
        "exported_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "blend_file": os.path.basename(blend_path) if blend_path else "",
        "scene": scene.name,
        "frame_range": [frame_start, frame_end],
        "coverage_source": coverage_meta,
        "actuators": actuator_entries,
    }

    # Cache and paint markers
    scene["_skm_windows_json"] = json.dumps(data)
    _clear_skm_markers(scene)
    _paint_markers(scene, actuator_entries)

    return data


def export_windows(data, output_path):
    """Write the windows data dict to a ZIP file.

    Args:
        data: The dict returned by compute_windows.
        output_path: Absolute filesystem path of the ZIP to write.
    """
    write_windows_zip(data, output_path)
```

- [ ] **Step 4: Run integration tests — verify they pass**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_windows_integration.py 2>&1 | tail -10
```

Expected: `OK: all windows integration tests passed`

- [ ] **Step 5: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/windows/__init__.py \
       tests/test_windows_integration.py
git commit -m "feat(windows): compute_windows orchestration + export + timeline marker painting"
```

---

## Task 5: Blender operators (SKM_OT_ComputeWindows, ClearWindows, ExportWindows)

**Files:**
- Create: `strokmatic_vision_tools/motion_export/windows/operators.py`

- [ ] **Step 1: Implement `strokmatic_vision_tools/motion_export/windows/operators.py`**

```python
"""Blender operators for kinematic window analysis.

- SKM_OT_ComputeWindows   — runs compute_windows(), populates cache + markers
- SKM_OT_ClearWindows     — removes SKM_WIN_* markers and the cache
- SKM_OT_ExportWindows    — writes the cached windows data to a ZIP
"""
import json
import os

import bpy
from bpy.props import StringProperty
from bpy_extras.io_utils import ExportHelper

from . import compute_windows, export_windows


def _clear_skm_markers(scene):
    from . import MARKER_PREFIX
    doomed = [m for m in scene.timeline_markers if m.name.startswith(MARKER_PREFIX)]
    for m in doomed:
        scene.timeline_markers.remove(m)


class SKM_OT_ComputeWindows(bpy.types.Operator):
    """Analyze cached coverage and classify each actuator's timeline."""
    bl_idname = "skm_vision.compute_windows"
    bl_label = "Compute Windows"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        try:
            data = compute_windows(context)
        except ValueError as e:
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        except Exception as e:
            self.report({"ERROR"}, f"Windows analysis failed: {e}")
            return {"CANCELLED"}

        n_actuators = len(data["actuators"])
        n_windows = sum(len(a["windows"]) for a in data["actuators"])
        self.report(
            {"INFO"},
            f"Computed {n_actuators} actuator(s), {n_windows} window(s) total. "
            f"Markers painted (prefix SKM_WIN_).",
        )
        return {"FINISHED"}


class SKM_OT_ClearWindows(bpy.types.Operator):
    """Remove SKM_WIN_* timeline markers and the cached windows data."""
    bl_idname = "skm_vision.clear_windows"
    bl_label = "Clear Windows"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        scene = context.scene
        _clear_skm_markers(scene)
        if "_skm_windows_json" in scene:
            del scene["_skm_windows_json"]
        self.report({"INFO"}, "Kinematic window markers and cache cleared")
        return {"FINISHED"}


class SKM_OT_ExportWindows(bpy.types.Operator, ExportHelper):
    """Export the cached windows data as a ZIP (summary.json + per-actuator CSVs)."""
    bl_idname = "skm_vision.export_windows"
    bl_label = "Export Windows"
    bl_options = {"REGISTER"}

    filename_ext = ".zip"
    filter_glob: StringProperty(default="*.zip", options={"HIDDEN"})

    def execute(self, context):
        scene = context.scene
        cached = scene.get("_skm_windows_json")
        if not cached:
            self.report(
                {"ERROR"},
                "No cached windows data. Run Compute Windows before exporting.",
            )
            return {"CANCELLED"}
        try:
            data = json.loads(cached)
            export_windows(data, self.filepath)
        except Exception as e:
            self.report({"ERROR"}, f"Export failed: {e}")
            return {"CANCELLED"}

        n_actuators = len(data["actuators"])
        self.report(
            {"INFO"},
            f"Exported windows for {n_actuators} actuator(s) to "
            f"{os.path.basename(self.filepath)}",
        )
        return {"FINISHED"}


CLASSES = (
    SKM_OT_ComputeWindows,
    SKM_OT_ClearWindows,
    SKM_OT_ExportWindows,
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
python3 -c "import ast; ast.parse(open('workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/motion_export/windows/operators.py').read()); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/motion_export/windows/operators.py
git commit -m "feat(windows): Blender operators — Compute, Clear, Export"
```

---

## Task 6: UI + registration + version bump

**Files:**
- Modify: `strokmatic_vision_tools/ui_panel.py`
- Modify: `strokmatic_vision_tools/__init__.py`
- Modify: `strokmatic_vision_tools/blender_manifest.toml`

- [ ] **Step 1: Modify `strokmatic_vision_tools/ui_panel.py` — add a Kinematic Windows section**

Locate the Motion Export block in the `draw` method. Append the following block **after** the Motion Export "Export Motion" button (so Kinematic Windows appears below Motion Export in the panel):

```python
        # --- Kinematic Windows ---
        box = layout.box()
        box.label(text="Kinematic Windows", icon='PREVIEW_RANGE')

        # Coverage-cache status line
        has_coverage = "_skm_coverage_json" in scene
        if has_coverage:
            box.label(text="Coverage cached ✓", icon='CHECKMARK')
        else:
            box.label(text="No coverage cached — run Compute Coverage first",
                      icon='ERROR')

        row = box.row(align=True)
        row.enabled = has_coverage
        row.operator("skm_vision.compute_windows", text="Compute", icon='PLAY')
        row.operator("skm_vision.clear_windows", text="Clear", icon='X')

        # Export button (greyed out until windows cached)
        has_windows = "_skm_windows_json" in scene
        row = box.row()
        row.enabled = has_windows
        row.operator("skm_vision.export_windows", text="Export Windows", icon='EXPORT')
```

- [ ] **Step 2: Modify `strokmatic_vision_tools/__init__.py` — register windows operators + bump version**

Replace the file contents with:

```python
bl_info = {
    "name": "Strokmatic Vision Tools",
    "author": "Strokmatic",
    "version": (1, 4, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > SKM Vision",
    "description": "Machine vision validation — resolution, angle, deflectometry coverage, motion export, and kinematic window analysis",
    "category": "3D View",
}

from . import calibration_importer
from . import resolution_heatmap
from . import angle_heatmap
from .deflectometry import operators as deflectometry_ops
from .motion_export import operators as motion_export_ops
from .motion_export.windows import operators as windows_ops
from . import ui_panel


def register():
    calibration_importer.register()
    resolution_heatmap.register()
    angle_heatmap.register()
    deflectometry_ops.register()
    motion_export_ops.register()
    windows_ops.register()
    ui_panel.register()


def unregister():
    ui_panel.unregister()
    windows_ops.unregister()
    motion_export_ops.unregister()
    deflectometry_ops.unregister()
    angle_heatmap.unregister()
    resolution_heatmap.unregister()
    calibration_importer.unregister()


if __name__ == "__main__":
    register()
```

- [ ] **Step 3: Modify `strokmatic_vision_tools/blender_manifest.toml` — bump version**

Change:
```toml
version = "1.3.0"
```
to:
```toml
version = "1.4.0"
```

Change the `tagline` to:
```toml
tagline = "Machine vision validation — resolution, angle, deflectometry coverage, motion export, and kinematic window analysis"
```

- [ ] **Step 4: Verify syntax + registration**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
for f in strokmatic_vision_tools/ui_panel.py strokmatic_vision_tools/__init__.py; do
  python3 -c "import ast; ast.parse(open('$f').read()); print('OK: $f')"
done

blender --background --python-expr "
import bpy, sys
sys.path.insert(0, '.')
import strokmatic_vision_tools
strokmatic_vision_tools.register()
ops = sorted(op for op in dir(bpy.ops.skm_vision) if not op.startswith('_'))
required = ['compute_windows', 'clear_windows', 'export_windows']
for r in required:
    assert r in ops, f'{r} missing from {ops}'
strokmatic_vision_tools.unregister()
print('OK: v1.4.0 registration clean')
" 2>&1 | tail -3
```

Expected:
- `OK: strokmatic_vision_tools/ui_panel.py`
- `OK: strokmatic_vision_tools/__init__.py`
- `OK: v1.4.0 registration clean`

- [ ] **Step 5: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/ui_panel.py \
       strokmatic_vision_tools/__init__.py \
       strokmatic_vision_tools/blender_manifest.toml
git commit -m "feat(windows): UI section + operator registration + version bump to 1.4.0"
```

---

## Task 7: Test-runner wiring + smoke test + local ZIP

**Files:**
- Modify: `tests/run_all.sh`

- [ ] **Step 1: Add windows tests to `tests/run_all.sh`**

In the `--- Pure Python tests ---` section, append:

```bash
run_test "windows_classifier"  "$SCRIPT_DIR/test_windows_classifier.py" "false"
run_test "windows_writer"      "$SCRIPT_DIR/test_windows_writer.py" "false"
```

In the `--- Blender tests ---` section, append:

```bash
run_test "windows_mapper"      "$SCRIPT_DIR/test_windows_mapper.py"
run_test "windows_integration" "$SCRIPT_DIR/test_windows_integration.py"
```

- [ ] **Step 2: Run the full test suite**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && ./tests/run_all.sh
```

Expected: all tests pass — previous suite plus the 4 new window test files.

- [ ] **Step 3: Smoke-test against the real GM v4-BASE-clean scene**

```bash
if [ -f /tmp/v4-BASE-clean.blend ]; then
  cd workspaces/strokmatic/sdk/sdk-blender-tools
  blender --background /tmp/v4-BASE-clean.blend --python-expr "
import bpy, sys, os
sys.path.insert(0, '.')
import strokmatic_vision_tools
strokmatic_vision_tools.register()

# Tag the car reference
bpy.data.objects['car-movement']['skm_is_car_reference'] = True

# Tag all cylindrical emitter-candidates — for this smoke test we just mark
# objects whose name starts with 'resistencia' as emitters
for o in bpy.data.objects:
    if o.name.startswith('resistencia'):
        o['skm_is_emitter'] = True
bpy.context.view_layer.update()

# Run coverage over a short range to keep it fast
from strokmatic_vision_tools.deflectometry.coverage import compute_coverage
from strokmatic_vision_tools.deflectometry.coverage_data import CoverageParams
params = CoverageParams(
    sweep_axis='Y', sweep_start=-3500, sweep_end=3500, sweep_step=200,
    check_resolution=False, check_angle=False,
    check_sweep_duration=False, check_occlusion=False,
)
# Single body for speed: montana.001
target = bpy.data.objects.get('montana.001')
targets = [target] if target else None
matrix = compute_coverage(bpy.context, params, targets=targets)
bpy.context.scene['_skm_coverage_json'] = matrix.to_json()
print(f'Coverage: {matrix.summary()}')

# Run windows
from strokmatic_vision_tools.motion_export.windows import compute_windows, export_windows
data = compute_windows(bpy.context)
print(f'Actuators found: {len(data[\"actuators\"])}')
for a in data['actuators']:
    crit = a['total_critical_frames']
    free = a['total_free_frames']
    print(f'  {a[\"name\"]:35s} critical={crit:4d} free={free:4d} windows={len(a[\"windows\"])}')

export_windows(data, '/tmp/v4clean_windows.zip')
print(f'ZIP size: {os.path.getsize(\"/tmp/v4clean_windows.zip\")} bytes')
strokmatic_vision_tools.unregister()
" 2>&1 | grep -E "^(Coverage|Actuators|  |ZIP size)"
else
  echo "Skipping: /tmp/v4-BASE-clean.blend not found"
fi
```

Expected: prints a coverage summary, a list of actuators with their critical/free frame counts, and a ZIP size. The `suporte.Resistencia.001` actuator should show a large critical share (because of the emitter-side conservatism). The `referencia.altura.N15` actuator should show some critical share based on what `N15` camera covered.

- [ ] **Step 4: Build the local testing ZIP**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
rm -f /tmp/strokmatic_vision_tools_v1.4.0-testing.zip
zip -r /tmp/strokmatic_vision_tools_v1.4.0-testing.zip strokmatic_vision_tools/ \
    -x "strokmatic_vision_tools/__pycache__/*" \
       "strokmatic_vision_tools/deflectometry/__pycache__/*" \
       "strokmatic_vision_tools/motion_export/__pycache__/*" \
       "strokmatic_vision_tools/motion_export/windows/__pycache__/*"
mv /tmp/strokmatic_vision_tools_v1.4.0-testing.zip ~/Documentos/
ls -lh ~/Documentos/strokmatic_vision_tools_v1.4.0-testing.zip
```

Expected: ZIP around 50 KB.

- [ ] **Step 5: Commit run_all.sh update**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add tests/run_all.sh
git commit -m "test(windows): wire classifier/mapper/writer/integration tests into run_all.sh"
```

**Note:** Do not push a GitHub release yet. v1.4.0 joins v1.3.0 in the "waiting for Tiago's field validation" queue.
