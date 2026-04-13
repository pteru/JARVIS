# Deflectometry Coverage Analyzer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Blender add-on module that simulates car sweep through an emitter portal and paints a deflectometry coverage heatmap showing which surface points receive adequate reflected-light coverage from each camera.

**Architecture:** New `deflectometry/` sub-package inside the existing `strokmatic_vision_tools` add-on. Core reflection math (pure Python + numpy) feeds a sweep simulator that accumulates coverage across car positions. Results stored in a serializable CoverageMatrix, visualized as vertex colors, exportable as JSON.

**Tech Stack:** Blender Python API (`bpy`, `mathutils`), numpy (bundled with Blender), existing `camera_utils.py` and `mesh_utils.py` from Vision Tools v1.0.

**Spec:** `docs/superpowers/specs/2026-04-13-deflectometry-coverage-analyzer-design.md`

**Base path:** `workspaces/strokmatic/sdk/sdk-blender-tools/`

---

## Important: Testing Approach

Same as Vision Tools v1.0:
- **Pure Python tests** (reflection math, data structures): run with `python3 tests/test_file.py`
- **Blender tests** (sweep, coverage, visualization): run with `blender --background --python tests/test_file.py`
- All tests use plain `assert` + print. No test framework.
- Pure Python test files must import from the module file directly (not through the package) to avoid triggering `__init__.py` which imports `bpy`.

---

## File Structure

```
strokmatic_vision_tools/
├── __init__.py                      # Modified: add deflectometry import + registration
├── ui_panel.py                      # Modified: add Deflectometry Coverage section + scene properties
├── deflectometry/
│   ├── __init__.py                  # Sub-package init, public compute_coverage API
│   ├── reflection.py                # Reflection vectors, ray-cylinder intersection
│   ├── sweep.py                     # Parametric + animation sweep generation
│   ├── coverage_data.py             # Data structures (no bpy dependency)
│   ├── coverage.py                  # Coverage matrix builder (orchestrator)
│   ├── visualizer.py                # Vertex color painting from coverage matrix
│   ├── report.py                    # JSON/text report export
│   └── operators.py                 # Blender operators

tests/
├── test_reflection.py               # Pure Python
├── test_coverage_data.py            # Pure Python
├── test_sweep.py                    # Blender
├── test_coverage_integration.py     # Blender
├── test_deflectometry_visualizer.py # Blender
```

---

## Task 1: Coverage Data Structures (Pure Python)

**Files:**
- Create: `strokmatic_vision_tools/deflectometry/__init__.py`
- Create: `strokmatic_vision_tools/deflectometry/coverage_data.py`
- Create: `tests/test_coverage_data.py`

- [ ] **Step 1: Create deflectometry package __init__.py**

```python
"""Deflectometry coverage analysis sub-package."""
```

- [ ] **Step 2: Write test_coverage_data.py**

```python
"""Tests for coverage_data.py — pure Python, no Blender needed."""
import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "strokmatic_vision_tools", "deflectometry"))
from coverage_data import (
    CoverageParams,
    CameraHit,
    NearMiss,
    VertexResult,
    CoverageMatrix,
)


def test_coverage_params_defaults():
    p = CoverageParams(sweep_axis="Y", sweep_start=-3000, sweep_end=3000, sweep_step=50)
    assert p.sweep_count == 121  # (-3000 to 3000 in steps of 50) = 6000/50 + 1
    assert p.check_resolution is True
    assert p.min_resolution == 5.0
    assert p.check_angle is True
    assert p.max_angle == 60.0
    assert p.check_occlusion is False
    assert p.check_sweep_duration is True
    assert p.min_sweep_steps == 3
    assert p.use_analytic is True


def test_camera_hit_creation():
    hit = CameraHit(
        camera="Camera_N15",
        first_step=10,
        last_step=20,
        duration=11,
        best_resolution=8.5,
        best_angle=15.0,
        avg_resolution=6.2,
        avg_angle=25.0,
    )
    assert hit.camera == "Camera_N15"
    assert hit.duration == 11


def test_near_miss_creation():
    nm = NearMiss(
        camera="Camera_N6",
        best_sweep_step=45,
        failure_reason="STEEP_ANGLE",
        gap_magnitude=12.5,
    )
    assert nm.failure_reason == "STEEP_ANGLE"
    assert nm.gap_magnitude == 12.5


def test_vertex_result_is_covered():
    hit = CameraHit("Cam1", 5, 10, 6, 7.0, 20.0, 6.0, 25.0)
    vr = VertexResult(hits=[hit], nearest_misses=[])
    assert vr.is_covered is True


def test_vertex_result_not_covered():
    vr = VertexResult(hits=[], nearest_misses=[])
    assert vr.is_covered is False


def test_coverage_matrix_json_roundtrip():
    params = CoverageParams("Y", -1000, 1000, 100)
    hit = CameraHit("Cam1", 5, 10, 6, 7.0, 20.0, 6.0, 25.0)
    miss = NearMiss("Cam2", 8, "NO_REFLECTION", 0.0)
    vr = VertexResult(hits=[hit], nearest_misses=[miss])
    matrix = CoverageMatrix(
        params=params,
        cameras=["Cam1", "Cam2"],
        vertices=100,
        results={0: vr, 50: VertexResult(hits=[], nearest_misses=[])},
    )

    json_str = matrix.to_json()
    parsed = json.loads(json_str)
    assert parsed["cameras"] == ["Cam1", "Cam2"]
    assert parsed["vertices"] == 100

    restored = CoverageMatrix.from_json(json_str)
    assert restored.vertices == 100
    assert restored.cameras == ["Cam1", "Cam2"]
    assert restored.results[0].is_covered is True
    assert restored.results[50].is_covered is False
    assert restored.results[0].hits[0].camera == "Cam1"
    assert restored.results[0].nearest_misses[0].failure_reason == "NO_REFLECTION"


def test_coverage_matrix_summary():
    params = CoverageParams("Y", -1000, 1000, 100)
    covered_vr = VertexResult(
        hits=[CameraHit("Cam1", 5, 10, 6, 7.0, 20.0, 6.0, 25.0)],
        nearest_misses=[],
    )
    uncovered_vr = VertexResult(hits=[], nearest_misses=[])
    matrix = CoverageMatrix(
        params=params,
        cameras=["Cam1"],
        vertices=4,
        results={0: covered_vr, 1: covered_vr, 2: uncovered_vr, 3: uncovered_vr},
    )
    summary = matrix.summary()
    assert summary["total_vertices"] == 4
    assert summary["covered"] == 2
    assert summary["uncovered"] == 2
    assert summary["coverage_pct"] == 50.0


if __name__ == "__main__":
    test_coverage_params_defaults()
    test_camera_hit_creation()
    test_near_miss_creation()
    test_vertex_result_is_covered()
    test_vertex_result_not_covered()
    test_coverage_matrix_json_roundtrip()
    test_coverage_matrix_summary()
    print("OK: all coverage_data tests passed")
```

- [ ] **Step 3: Run test — verify it fails**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_coverage_data.py
```

Expected: `ModuleNotFoundError`

- [ ] **Step 4: Implement coverage_data.py**

```python
"""Data structures for deflectometry coverage analysis.

Pure Python — no bpy dependency. JSON-serializable for headless mode
and Phase 3 configuration comparison.
"""
import json
import math


class CoverageParams:
    """Parameters for a coverage analysis run."""

    def __init__(self, sweep_axis, sweep_start, sweep_end, sweep_step,
                 check_resolution=True, min_resolution=5.0,
                 check_angle=True, max_angle=60.0,
                 check_occlusion=False,
                 check_sweep_duration=True, min_sweep_steps=3,
                 use_analytic=True):
        self.sweep_axis = sweep_axis
        self.sweep_start = sweep_start
        self.sweep_end = sweep_end
        self.sweep_step = sweep_step
        self.sweep_count = int(abs(sweep_end - sweep_start) / sweep_step) + 1
        self.check_resolution = check_resolution
        self.min_resolution = min_resolution
        self.check_angle = check_angle
        self.max_angle = max_angle
        self.check_occlusion = check_occlusion
        self.check_sweep_duration = check_sweep_duration
        self.min_sweep_steps = min_sweep_steps
        self.use_analytic = use_analytic

    def to_dict(self):
        return {
            "sweep_axis": self.sweep_axis,
            "sweep_start": self.sweep_start,
            "sweep_end": self.sweep_end,
            "sweep_step": self.sweep_step,
            "sweep_count": self.sweep_count,
            "check_resolution": self.check_resolution,
            "min_resolution": self.min_resolution,
            "check_angle": self.check_angle,
            "max_angle": self.max_angle,
            "check_occlusion": self.check_occlusion,
            "check_sweep_duration": self.check_sweep_duration,
            "min_sweep_steps": self.min_sweep_steps,
            "use_analytic": self.use_analytic,
        }

    @classmethod
    def from_dict(cls, d):
        return cls(
            sweep_axis=d["sweep_axis"],
            sweep_start=d["sweep_start"],
            sweep_end=d["sweep_end"],
            sweep_step=d["sweep_step"],
            check_resolution=d.get("check_resolution", True),
            min_resolution=d.get("min_resolution", 5.0),
            check_angle=d.get("check_angle", True),
            max_angle=d.get("max_angle", 60.0),
            check_occlusion=d.get("check_occlusion", False),
            check_sweep_duration=d.get("check_sweep_duration", True),
            min_sweep_steps=d.get("min_sweep_steps", 3),
            use_analytic=d.get("use_analytic", True),
        )


class CameraHit:
    """Record of successful coverage by a camera."""

    def __init__(self, camera, first_step, last_step, duration,
                 best_resolution, best_angle, avg_resolution, avg_angle):
        self.camera = camera
        self.first_step = first_step
        self.last_step = last_step
        self.duration = duration
        self.best_resolution = best_resolution
        self.best_angle = best_angle
        self.avg_resolution = avg_resolution
        self.avg_angle = avg_angle

    def to_dict(self):
        return {
            "camera": self.camera,
            "first_step": self.first_step,
            "last_step": self.last_step,
            "duration": self.duration,
            "best_resolution": self.best_resolution,
            "best_angle": self.best_angle,
            "avg_resolution": self.avg_resolution,
            "avg_angle": self.avg_angle,
        }

    @classmethod
    def from_dict(cls, d):
        return cls(**d)


class NearMiss:
    """Record of why coverage almost worked for Phase 2 optimization."""

    FAILURE_REASONS = (
        "NO_REFLECTION", "OUT_OF_FOV", "LOW_RESOLUTION",
        "STEEP_ANGLE", "OCCLUDED", "SHORT_DURATION",
    )

    def __init__(self, camera, best_sweep_step, failure_reason, gap_magnitude):
        self.camera = camera
        self.best_sweep_step = best_sweep_step
        self.failure_reason = failure_reason
        self.gap_magnitude = gap_magnitude

    def to_dict(self):
        return {
            "camera": self.camera,
            "best_sweep_step": self.best_sweep_step,
            "failure_reason": self.failure_reason,
            "gap_magnitude": self.gap_magnitude,
        }

    @classmethod
    def from_dict(cls, d):
        return cls(**d)


class VertexResult:
    """Coverage result for a single vertex."""

    def __init__(self, hits=None, nearest_misses=None):
        self.hits = hits or []
        self.nearest_misses = nearest_misses or []

    @property
    def is_covered(self):
        return len(self.hits) > 0

    def to_dict(self):
        return {
            "hits": [h.to_dict() for h in self.hits],
            "nearest_misses": [m.to_dict() for m in self.nearest_misses],
        }

    @classmethod
    def from_dict(cls, d):
        return cls(
            hits=[CameraHit.from_dict(h) for h in d.get("hits", [])],
            nearest_misses=[NearMiss.from_dict(m) for m in d.get("nearest_misses", [])],
        )


class CoverageMatrix:
    """Full coverage analysis result."""

    def __init__(self, params, cameras, vertices, results=None):
        self.params = params
        self.cameras = cameras
        self.vertices = vertices
        self.results = results or {}

    def summary(self):
        covered = sum(1 for vr in self.results.values() if vr.is_covered)
        uncovered = len(self.results) - covered
        total = len(self.results)
        return {
            "total_vertices": total,
            "covered": covered,
            "uncovered": uncovered,
            "coverage_pct": round(100.0 * covered / total, 1) if total > 0 else 0.0,
        }

    def to_json(self):
        return json.dumps({
            "params": self.params.to_dict(),
            "cameras": self.cameras,
            "vertices": self.vertices,
            "results": {str(k): v.to_dict() for k, v in self.results.items()},
        }, indent=2)

    @classmethod
    def from_json(cls, json_str):
        d = json.loads(json_str)
        params = CoverageParams.from_dict(d["params"])
        results = {int(k): VertexResult.from_dict(v) for k, v in d["results"].items()}
        return cls(
            params=params,
            cameras=d["cameras"],
            vertices=d["vertices"],
            results=results,
        )
```

- [ ] **Step 5: Run test — verify it passes**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_coverage_data.py
```

Expected: `OK: all coverage_data tests passed`

- [ ] **Step 6: Commit**

```bash
git add strokmatic_vision_tools/deflectometry/__init__.py \
       strokmatic_vision_tools/deflectometry/coverage_data.py \
       tests/test_coverage_data.py
git commit -m "feat(deflectometry): coverage data structures with JSON serialization"
```

---

## Task 2: Reflection Math (Pure Python)

**Files:**
- Create: `strokmatic_vision_tools/deflectometry/reflection.py`
- Create: `tests/test_reflection.py`

- [ ] **Step 1: Write test_reflection.py**

```python
"""Tests for reflection.py — pure Python, no Blender needed."""
import sys
import os
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "strokmatic_vision_tools", "deflectometry"))
from reflection import (
    reflect_direction,
    ray_cylinder_intersection,
)


def _vec_close(a, b, tol=0.01):
    """Check two 3-tuples are approximately equal."""
    return all(abs(ai - bi) < tol for ai, bi in zip(a, b))


def test_reflect_flat_horizontal():
    """View from above reflected off horizontal surface → should go straight up."""
    view_dir = (0.0, 0.0, 1.0)   # camera above, looking down at surface
    normal = (0.0, 0.0, 1.0)     # surface normal points up
    r = reflect_direction(view_dir, normal)
    # Reflection of (0,0,1) across (0,0,1) = (0,0,1)
    assert _vec_close(r, (0.0, 0.0, 1.0)), f"Expected (0,0,1), got {r}"


def test_reflect_45_degree():
    """View at 45° reflected off horizontal surface → should exit at 45° other side."""
    s2 = math.sqrt(2) / 2
    view_dir = (s2, 0.0, s2)     # 45° from horizontal, in XZ plane
    normal = (0.0, 0.0, 1.0)     # surface normal points up
    r = reflect_direction(view_dir, normal)
    # Reflection should be (-s2, 0, s2) — X component flips
    assert _vec_close(r, (-s2, 0.0, s2)), f"Expected ({-s2},0,{s2}), got {r}"


def test_reflect_preserves_unit_length():
    view_dir = (0.577, 0.577, 0.577)  # ~normalized (1,1,1)
    normal = (0.0, 0.0, 1.0)
    r = reflect_direction(view_dir, normal)
    length = math.sqrt(r[0]**2 + r[1]**2 + r[2]**2)
    assert abs(length - 1.0) < 0.02, f"Reflected direction should be unit length, got {length}"


def test_cylinder_hit_center():
    """Ray aimed directly at cylinder center should hit."""
    # Cylinder along Z axis, center at (2, 0, 0), radius 0.1, length 2 (from z=-1 to z=1)
    origin = (0.0, 0.0, 0.0)
    direction = (1.0, 0.0, 0.0)  # straight toward cylinder
    hit, t = ray_cylinder_intersection(
        origin, direction,
        cyl_center=(2.0, 0.0, 0.0), cyl_axis=(0.0, 0.0, 1.0),
        cyl_radius=0.1, cyl_half_length=1.0
    )
    assert hit is True, "Should hit cylinder"
    assert 1.8 < t < 2.1, f"Hit distance should be ~1.9, got {t}"


def test_cylinder_miss_above():
    """Ray aimed above cylinder should miss."""
    origin = (0.0, 0.0, 0.0)
    direction = (1.0, 0.0, 0.5)  # angled upward
    # Normalize direction
    d_len = math.sqrt(1 + 0.25)
    direction = (1.0/d_len, 0.0, 0.5/d_len)
    hit, t = ray_cylinder_intersection(
        origin, direction,
        cyl_center=(2.0, 0.0, 0.0), cyl_axis=(0.0, 0.0, 1.0),
        cyl_radius=0.1, cyl_half_length=0.5
    )
    # At distance ~2, z ≈ 1.0 which is past half_length 0.5
    assert hit is False, "Should miss — ray exits above cylinder"


def test_cylinder_miss_wide():
    """Ray aimed to the side should miss."""
    origin = (0.0, 0.0, 0.0)
    direction = (0.0, 1.0, 0.0)  # perpendicular to cylinder
    hit, t = ray_cylinder_intersection(
        origin, direction,
        cyl_center=(2.0, 0.0, 0.0), cyl_axis=(0.0, 0.0, 1.0),
        cyl_radius=0.1, cyl_half_length=1.0
    )
    assert hit is False, "Should miss — ray goes past cylinder"


def test_cylinder_ray_parallel():
    """Ray parallel to cylinder axis should miss (unless inside radius)."""
    origin = (0.0, 0.0, -5.0)
    direction = (0.0, 0.0, 1.0)  # along Z, parallel to cylinder axis
    hit, t = ray_cylinder_intersection(
        origin, direction,
        cyl_center=(2.0, 0.0, 0.0), cyl_axis=(0.0, 0.0, 1.0),
        cyl_radius=0.1, cyl_half_length=1.0
    )
    assert hit is False, "Should miss — ray parallel and outside radius"


def test_cylinder_behind_origin():
    """Cylinder behind ray origin should not be hit (t must be positive)."""
    origin = (3.0, 0.0, 0.0)
    direction = (1.0, 0.0, 0.0)  # moving away from cylinder
    hit, t = ray_cylinder_intersection(
        origin, direction,
        cyl_center=(2.0, 0.0, 0.0), cyl_axis=(0.0, 0.0, 1.0),
        cyl_radius=0.1, cyl_half_length=1.0
    )
    assert hit is False, "Should miss — cylinder is behind origin"


if __name__ == "__main__":
    test_reflect_flat_horizontal()
    test_reflect_45_degree()
    test_reflect_preserves_unit_length()
    test_cylinder_hit_center()
    test_cylinder_miss_above()
    test_cylinder_miss_wide()
    test_cylinder_ray_parallel()
    test_cylinder_behind_origin()
    print("OK: all reflection tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_reflection.py
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement reflection.py**

```python
"""Reflection math for deflectometry coverage analysis.

Pure Python + math — no bpy dependency. Provides specular reflection
computation and analytic ray-cylinder intersection for emitter hit testing.
"""
import math


def reflect_direction(view_dir, normal):
    """Compute specular reflection direction.

    Given a view direction V and surface normal N, computes the direction R
    from which light must arrive to reflect into V:
        R = 2 * dot(V, N) * N - V

    Args:
        view_dir: Tuple (x, y, z), normalized view direction (camera - point).
        normal: Tuple (x, y, z), normalized surface normal.

    Returns:
        Tuple (x, y, z), normalized reflection direction.
    """
    vx, vy, vz = view_dir
    nx, ny, nz = normal
    dot = vx * nx + vy * ny + vz * nz
    rx = 2.0 * dot * nx - vx
    ry = 2.0 * dot * ny - vy
    rz = 2.0 * dot * nz - vz
    length = math.sqrt(rx * rx + ry * ry + rz * rz)
    if length < 1e-10:
        return (0.0, 0.0, 0.0)
    return (rx / length, ry / length, rz / length)


def ray_cylinder_intersection(origin, direction, cyl_center, cyl_axis,
                               cyl_radius, cyl_half_length):
    """Test intersection of a ray with a finite cylinder.

    The cylinder is defined by its center point, axis direction, radius,
    and half-length (extends half_length in each direction along axis from center).

    Uses the analytic solution: project the ray onto the plane perpendicular
    to the cylinder axis, solve the 2D circle intersection, then check
    that the hit point falls within the cylinder's length bounds.

    Args:
        origin: Ray origin (x, y, z).
        direction: Ray direction (x, y, z), should be normalized.
        cyl_center: Cylinder center point (x, y, z).
        cyl_axis: Cylinder axis direction (x, y, z), should be normalized.
        cyl_radius: Cylinder radius.
        cyl_half_length: Half the cylinder length.

    Returns:
        Tuple (hit: bool, t: float). If hit is True, t is the distance
        along the ray to the nearest intersection point. If hit is False,
        t is 0.0.
    """
    ox, oy, oz = origin
    dx, dy, dz = direction
    cx, cy, cz = cyl_center
    ax, ay, az = cyl_axis

    # Vector from cylinder center to ray origin
    oc_x = ox - cx
    oc_y = oy - cy
    oc_z = oz - cz

    # Project direction and oc onto plane perpendicular to cylinder axis
    # d_perp = d - (d . axis) * axis
    d_dot_a = dx * ax + dy * ay + dz * az
    dp_x = dx - d_dot_a * ax
    dp_y = dy - d_dot_a * ay
    dp_z = dz - d_dot_a * az

    # oc_perp = oc - (oc . axis) * axis
    oc_dot_a = oc_x * ax + oc_y * ay + oc_z * az
    ocp_x = oc_x - oc_dot_a * ax
    ocp_y = oc_y - oc_dot_a * ay
    ocp_z = oc_z - oc_dot_a * az

    # Quadratic equation: |origin_perp + t * dir_perp|^2 = radius^2
    a = dp_x * dp_x + dp_y * dp_y + dp_z * dp_z
    b = 2.0 * (dp_x * ocp_x + dp_y * ocp_y + dp_z * ocp_z)
    c = ocp_x * ocp_x + ocp_y * ocp_y + ocp_z * ocp_z - cyl_radius * cyl_radius

    if abs(a) < 1e-12:
        # Ray is parallel to cylinder axis
        return (False, 0.0)

    discriminant = b * b - 4.0 * a * c
    if discriminant < 0:
        return (False, 0.0)

    sqrt_disc = math.sqrt(discriminant)
    t1 = (-b - sqrt_disc) / (2.0 * a)
    t2 = (-b + sqrt_disc) / (2.0 * a)

    # Check both intersection points (nearest first)
    for t in (t1, t2):
        if t < 1e-6:
            continue  # Behind ray origin

        # Compute hit point and check length along axis
        hx = ox + t * dx
        hy = oy + t * dy
        hz = oz + t * dz
        # Project hit point onto cylinder axis
        h_dot_a = (hx - cx) * ax + (hy - cy) * ay + (hz - cz) * az
        if abs(h_dot_a) <= cyl_half_length:
            return (True, t)

    return (False, 0.0)
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_reflection.py
```

Expected: `OK: all reflection tests passed`

- [ ] **Step 5: Commit**

```bash
git add strokmatic_vision_tools/deflectometry/reflection.py tests/test_reflection.py
git commit -m "feat(deflectometry): reflection math — specular direction and ray-cylinder intersection"
```

---

## Task 3: Sweep Simulation

**Files:**
- Create: `strokmatic_vision_tools/deflectometry/sweep.py`
- Create: `tests/test_sweep.py`

- [ ] **Step 1: Write test_sweep.py**

```python
"""Tests for sweep.py — must run inside Blender."""
import bpy
import sys
import os
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.deflectometry.sweep import (
    parametric_sweep,
    get_sweep_offset,
)


def test_parametric_sweep_count():
    """Sweep from -1000 to 1000 in steps of 100 should give 21 steps."""
    steps = parametric_sweep("Y", -1000, 1000, 100)
    assert len(steps) == 21, f"Expected 21 steps, got {len(steps)}"


def test_parametric_sweep_first_last():
    """First offset should be start, last should be end."""
    steps = parametric_sweep("Y", -500, 500, 250)
    assert abs(steps[0] - (-500)) < 0.01, f"First step should be -500, got {steps[0]}"
    assert abs(steps[-1] - 500) < 0.01, f"Last step should be 500, got {steps[-1]}"


def test_parametric_sweep_single_step():
    """When start == end, should give 1 step."""
    steps = parametric_sweep("X", 0, 0, 100)
    assert len(steps) == 1, f"Expected 1 step, got {len(steps)}"


def test_get_sweep_offset_y():
    """Offset along Y axis should only affect Y component."""
    offset = get_sweep_offset("Y", 500.0)
    assert abs(offset.x) < 0.001
    assert abs(offset.y - 0.5) < 0.001  # 500mm = 0.5m in Blender
    assert abs(offset.z) < 0.001


def test_get_sweep_offset_x():
    offset = get_sweep_offset("X", -1000.0)
    assert abs(offset.x - (-1.0)) < 0.001  # -1000mm = -1.0m
    assert abs(offset.y) < 0.001
    assert abs(offset.z) < 0.001


def test_get_sweep_offset_z():
    offset = get_sweep_offset("Z", 2000.0)
    assert abs(offset.x) < 0.001
    assert abs(offset.y) < 0.001
    assert abs(offset.z - 2.0) < 0.001


if __name__ == "__main__":
    test_parametric_sweep_count()
    test_parametric_sweep_first_last()
    test_parametric_sweep_single_step()
    test_get_sweep_offset_y()
    test_get_sweep_offset_x()
    test_get_sweep_offset_z()
    print("OK: all sweep tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_sweep.py 2>&1 | tail -5
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement sweep.py**

```python
"""Car sweep simulation for deflectometry coverage analysis.

Generates a sequence of position offsets representing the car moving
through the emitter portal. Supports parametric (axis + range) and
animation-based (keyframe) sweep modes.
"""
from mathutils import Vector


def parametric_sweep(axis, start_mm, end_mm, step_mm):
    """Generate a list of position offsets along a sweep axis.

    Args:
        axis: "X", "Y", or "Z".
        start_mm: Start position in millimeters.
        end_mm: End position in millimeters.
        step_mm: Step size in millimeters.

    Returns:
        List of float values (position in mm) from start to end inclusive.
    """
    if step_mm <= 0:
        return [start_mm]

    steps = []
    count = int(abs(end_mm - start_mm) / step_mm) + 1
    for i in range(count):
        pos = start_mm + i * step_mm * (1 if end_mm >= start_mm else -1)
        steps.append(pos)
    return steps


def get_sweep_offset(axis, position_mm):
    """Convert a sweep position (mm) to a Blender Vector offset (meters).

    Args:
        axis: "X", "Y", or "Z".
        position_mm: Position in millimeters.

    Returns:
        mathutils.Vector offset in Blender units (meters).
    """
    offset = Vector((0.0, 0.0, 0.0))
    meters = position_mm / 1000.0
    if axis == "X":
        offset.x = meters
    elif axis == "Y":
        offset.y = meters
    elif axis == "Z":
        offset.z = meters
    return offset


def animation_sweep(scene):
    """Read sweep positions from scene animation.

    Samples the active object's position at each frame in the scene's
    frame range.

    Args:
        scene: Blender scene with frame_start/frame_end set.

    Returns:
        List of mathutils.Vector positions, one per frame.
    """
    positions = []
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        positions.append(Vector((0.0, 0.0, 0.0)))  # placeholder — actual objects read at each frame
    return positions
```

- [ ] **Step 4: Run test — verify it passes**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_sweep.py 2>&1 | tail -5
```

Expected: `OK: all sweep tests passed`

- [ ] **Step 5: Commit**

```bash
git add strokmatic_vision_tools/deflectometry/sweep.py tests/test_sweep.py
git commit -m "feat(deflectometry): sweep simulation — parametric and animation modes"
```

---

## Task 4: Coverage Orchestrator

**Files:**
- Create: `strokmatic_vision_tools/deflectometry/coverage.py`
- Create: `tests/test_coverage_integration.py`

This is the largest module — it ties together reflection, sweep, camera_utils, and mesh_utils.

- [ ] **Step 1: Write test_coverage_integration.py**

```python
"""Integration tests for coverage.py — must run inside Blender."""
import bpy
import sys
import os
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.deflectometry.coverage import compute_coverage
from strokmatic_vision_tools.deflectometry.coverage_data import CoverageParams


def setup_scene():
    """Create a minimal deflectometry scene.

    Scene layout (top view, Y is sweep direction):
    - Plane at origin (2m x 2m), lying flat on XY plane (normal = +Z)
    - Camera at (0, 0, 2) looking down (-Z)
    - Cylinder emitter at (1, 0, 1), axis along Y, radius 0.05, length 2m
    - Car sweeps along Y from -1000 to 1000mm

    Reflection geometry: camera at (0,0,2) looking at point (0,0,0) on plane.
    View direction V = (0,0,1). Normal N = (0,0,1). Reflection R = (0,0,1).
    The reflected ray goes straight up — it won't hit the side emitter.

    But for points offset in X (e.g., (0.5, 0, 0)), the view direction tilts,
    and the reflection direction tilts toward the emitter.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Camera at (0, 0, 2) looking down
    cam_data = bpy.data.cameras.new("TestCam")
    cam_data.lens = 12  # wide FOV to cover the plane
    cam_data.sensor_width = 36.0
    cam_obj = bpy.data.objects.new("TestCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = (0, 0, 2)
    bpy.context.scene.camera = cam_obj

    bpy.context.scene.render.resolution_x = 640
    bpy.context.scene.render.resolution_y = 512

    # Plane (inspection target) — 2m x 2m, subdivided
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "CarBody"
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=4)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Cylinder emitter — at (1, 0, 1), along Y axis
    bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=2.0, location=(1, 0, 1))
    emitter = bpy.context.active_object
    emitter.name = "Emitter1"
    emitter.rotation_euler = (math.radians(90), 0, 0)  # rotate to align with Y axis
    emitter["skm_is_emitter"] = True

    bpy.context.view_layer.update()
    return cam_obj, plane, emitter


def test_compute_coverage_returns_matrix():
    cam, plane, emitter = setup_scene()
    params = CoverageParams(
        sweep_axis="Y", sweep_start=-500, sweep_end=500, sweep_step=250,
        check_resolution=False, check_angle=False,
        check_sweep_duration=False, check_occlusion=False,
    )
    matrix = compute_coverage(bpy.context, params)
    assert matrix is not None
    assert matrix.vertices > 0
    assert len(matrix.cameras) == 1
    assert matrix.cameras[0] == "TestCam"


def test_some_vertices_covered():
    """With emitter to the side, vertices offset toward the emitter should get coverage."""
    cam, plane, emitter = setup_scene()
    params = CoverageParams(
        sweep_axis="Y", sweep_start=-500, sweep_end=500, sweep_step=100,
        check_resolution=False, check_angle=False,
        check_sweep_duration=False, check_occlusion=False,
    )
    matrix = compute_coverage(bpy.context, params)
    summary = matrix.summary()
    # Not all vertices will be covered (center vertices reflect straight up,
    # missing the side emitter), but some should be
    assert summary["covered"] > 0, f"Expected some vertices covered, got {summary}"


def test_uncovered_vertices_have_near_miss():
    """Uncovered vertices should record why they failed."""
    cam, plane, emitter = setup_scene()
    params = CoverageParams(
        sweep_axis="Y", sweep_start=-500, sweep_end=500, sweep_step=250,
        check_resolution=False, check_angle=False,
        check_sweep_duration=False, check_occlusion=False,
    )
    matrix = compute_coverage(bpy.context, params)
    for vi, vr in matrix.results.items():
        if not vr.is_covered:
            # Should have at least one near miss explaining why
            assert len(vr.nearest_misses) > 0, \
                f"Vertex {vi} uncovered but no near_miss recorded"
            break  # just check one


def test_coverage_json_export():
    cam, plane, emitter = setup_scene()
    params = CoverageParams(
        sweep_axis="Y", sweep_start=-200, sweep_end=200, sweep_step=200,
        check_resolution=False, check_angle=False,
        check_sweep_duration=False, check_occlusion=False,
    )
    matrix = compute_coverage(bpy.context, params)
    json_str = matrix.to_json()
    assert len(json_str) > 100, "JSON should have substantial content"
    # Verify it round-trips
    from strokmatic_vision_tools.deflectometry.coverage_data import CoverageMatrix
    restored = CoverageMatrix.from_json(json_str)
    assert restored.vertices == matrix.vertices


if __name__ == "__main__":
    test_compute_coverage_returns_matrix()
    test_some_vertices_covered()
    test_uncovered_vertices_have_near_miss()
    test_coverage_json_export()
    print("OK: all coverage integration tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_coverage_integration.py 2>&1 | tail -5
```

Expected: `ImportError`

- [ ] **Step 3: Implement coverage.py**

```python
"""Coverage matrix builder — orchestrates sweep simulation.

For each car position (sweep step), for each camera, for each vertex:
computes reflection direction, tests emitter hit, accumulates coverage.
"""
import math
import bpy
import numpy as np
from mathutils import Vector

from .. import camera_utils
from .. import mesh_utils
from . import reflection
from . import sweep as sweep_mod
from .coverage_data import (
    CoverageParams, CoverageMatrix, VertexResult, CameraHit, NearMiss,
)


def _get_emitters(context):
    """Find all objects tagged as emitters."""
    return [obj for obj in context.view_layer.objects
            if obj.type == 'MESH' and obj.get("skm_is_emitter", False)]


def _get_cameras(context):
    """Find all camera objects in the scene."""
    return [obj for obj in context.view_layer.objects if obj.type == 'CAMERA']


def _extract_cylinder_params(obj):
    """Extract cylinder parameters from a Blender mesh object.

    Assumes the object is a cylinder primitive. Reads position, rotation,
    and dimensions to compute center, axis, radius, and half-length.
    """
    loc = obj.matrix_world.translation
    # Axis is the local Z axis transformed to world space
    axis = (obj.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    # Dimensions: x=diameter, y=diameter, z=height (for default cylinder)
    dims = obj.dimensions
    radius = max(dims.x, dims.y) / 2.0
    half_length = dims.z / 2.0
    return {
        "center": (loc.x, loc.y, loc.z),
        "axis": (axis.x, axis.y, axis.z),
        "radius": radius,
        "half_length": half_length,
    }


def compute_coverage(context, params):
    """Compute deflectometry coverage for the current scene.

    Args:
        context: Blender context.
        params: CoverageParams with sweep and threshold configuration.

    Returns:
        CoverageMatrix with per-vertex coverage results.
    """
    scene = context.scene
    targets = mesh_utils.get_target_objects(context, scene.skm_vision_scope)
    cameras = _get_cameras(context)
    emitters = _get_emitters(context)

    if not targets or not cameras or not emitters:
        return CoverageMatrix(params=params, cameras=[], vertices=0, results={})

    # Extract emitter cylinder params for analytic mode
    emitter_cyls = [_extract_cylinder_params(e) for e in emitters] if params.use_analytic else []

    # Generate sweep positions
    sweep_positions = sweep_mod.parametric_sweep(
        params.sweep_axis, params.sweep_start, params.sweep_end, params.sweep_step
    )

    camera_names = [c.name for c in cameras]

    # Collect all vertices across target objects with their world-space data
    all_verts = []  # list of (global_idx, world_pos, world_normal, obj, local_vi)
    global_idx = 0
    for obj in targets:
        mesh_obj = obj.data
        world_matrix = obj.matrix_world
        normal_matrix = world_matrix.to_3x3().inverted_safe().transposed()

        for vi, vert in enumerate(mesh_obj.vertices):
            world_pos = world_matrix @ vert.co
            world_normal = (normal_matrix @ vert.normal).normalized()
            all_verts.append((global_idx, world_pos, world_normal, obj, vi))
            global_idx += 1

    total_verts = len(all_verts)

    # Initialize per-vertex tracking: camera → list of step indices where covered
    # and best near-miss per camera
    vert_cam_steps = {}  # (vert_idx, cam_name) → [step_indices]
    vert_cam_quality = {}  # (vert_idx, cam_name, step) → (resolution, angle)
    vert_near_miss = {}  # vert_idx → {cam_name: NearMiss}

    for gi in range(total_verts):
        for cn in camera_names:
            vert_cam_steps[(gi, cn)] = []
            vert_near_miss[gi] = {}

    depsgraph = context.evaluated_depsgraph_get() if params.check_occlusion else None

    # Sweep loop
    for step_idx, pos_mm in enumerate(sweep_positions):
        offset = sweep_mod.get_sweep_offset(params.sweep_axis, pos_mm)

        for gi, base_world_pos, world_normal, obj, local_vi in all_verts:
            # Apply sweep offset to vertex position (car moves)
            vert_world = base_world_pos + offset

            for cam_idx, cam in enumerate(cameras):
                cam_name = cam.name
                cam_pos = cam.matrix_world.translation

                # FOV check
                if not camera_utils.is_point_in_fov(scene, cam, vert_world):
                    # Track as near miss if this is the closest we've gotten
                    if cam_name not in vert_near_miss[gi]:
                        vert_near_miss[gi][cam_name] = NearMiss(
                            cam_name, step_idx, "OUT_OF_FOV", 0.0
                        )
                    continue

                # View direction and reflection
                view_dir = (cam_pos - vert_world).normalized()
                view_tuple = (view_dir.x, view_dir.y, view_dir.z)
                normal_tuple = (world_normal.x, world_normal.y, world_normal.z)
                refl_dir = reflection.reflect_direction(view_tuple, normal_tuple)

                # Emitter hit test
                hit_emitter = False
                if params.use_analytic:
                    for ecyl in emitter_cyls:
                        origin = (vert_world.x, vert_world.y, vert_world.z)
                        hit, t = reflection.ray_cylinder_intersection(
                            origin, refl_dir,
                            ecyl["center"], ecyl["axis"],
                            ecyl["radius"], ecyl["half_length"]
                        )
                        if hit:
                            hit_emitter = True
                            break
                else:
                    # Blender ray_cast for arbitrary geometry
                    refl_vec = Vector(refl_dir)
                    result, loc, norm, face_idx, hit_obj, matrix = scene.ray_cast(
                        depsgraph, vert_world, refl_vec, distance=100.0
                    )
                    if result and hit_obj.get("skm_is_emitter", False):
                        hit_emitter = True

                if not hit_emitter:
                    if cam_name not in vert_near_miss[gi] or \
                       vert_near_miss[gi][cam_name].failure_reason != "OUT_OF_FOV":
                        vert_near_miss[gi][cam_name] = NearMiss(
                            cam_name, step_idx, "NO_REFLECTION", 0.0
                        )
                    continue

                # Optional quality checks
                if params.check_occlusion and depsgraph is not None:
                    if not mesh_utils.check_visibility(depsgraph, scene, cam_pos, vert_world, obj):
                        vert_near_miss[gi][cam_name] = NearMiss(
                            cam_name, step_idx, "OCCLUDED", 0.0
                        )
                        continue

                angle = camera_utils.view_angle_at_point(cam, vert_world, world_normal)
                if params.check_angle and angle > params.max_angle:
                    vert_near_miss[gi][cam_name] = NearMiss(
                        cam_name, step_idx, "STEEP_ANGLE", angle - params.max_angle
                    )
                    continue

                resolution = 0.0
                if params.check_resolution:
                    tangent_u, tangent_v = mesh_utils.get_vertex_tangents(
                        obj.data, local_vi
                    )
                    rot_matrix = obj.matrix_world.to_3x3().normalized()
                    tu_w = (rot_matrix @ tangent_u).normalized()
                    tv_w = (rot_matrix @ tangent_v).normalized()
                    resolution = camera_utils.pixel_per_mm_at_point(
                        scene, cam, vert_world, tu_w, tv_w
                    )
                    if resolution < params.min_resolution:
                        vert_near_miss[gi][cam_name] = NearMiss(
                            cam_name, step_idx, "LOW_RESOLUTION",
                            params.min_resolution - resolution
                        )
                        continue

                # All checks passed — record coverage at this step
                vert_cam_steps[(gi, cam_name)].append(step_idx)
                vert_cam_quality[(gi, cam_name, step_idx)] = (resolution, angle)
                # Clear near miss since we have a hit now
                if cam_name in vert_near_miss[gi]:
                    del vert_near_miss[gi][cam_name]

    # Build VertexResults from accumulated data
    results = {}
    for gi in range(total_verts):
        hits = []
        for cam_name in camera_names:
            steps = vert_cam_steps[(gi, cam_name)]
            if not steps:
                continue

            # Check sweep duration
            if params.check_sweep_duration and len(steps) < params.min_sweep_steps:
                vert_near_miss[gi][cam_name] = NearMiss(
                    cam_name, steps[0], "SHORT_DURATION",
                    params.min_sweep_steps - len(steps)
                )
                continue

            # Build CameraHit
            resolutions = []
            angles = []
            for s in steps:
                qual = vert_cam_quality.get((gi, cam_name, s))
                if qual:
                    resolutions.append(qual[0])
                    angles.append(qual[1])

            hits.append(CameraHit(
                camera=cam_name,
                first_step=steps[0],
                last_step=steps[-1],
                duration=len(steps),
                best_resolution=max(resolutions) if resolutions else 0.0,
                best_angle=min(angles) if angles else 90.0,
                avg_resolution=sum(resolutions) / len(resolutions) if resolutions else 0.0,
                avg_angle=sum(angles) / len(angles) if angles else 90.0,
            ))

        near_misses = list(vert_near_miss[gi].values())
        results[gi] = VertexResult(hits=hits, nearest_misses=near_misses)

    return CoverageMatrix(
        params=params,
        cameras=camera_names,
        vertices=total_verts,
        results=results,
    )
```

- [ ] **Step 4: Run test — verify it passes**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_coverage_integration.py 2>&1 | tail -10
```

Expected: `OK: all coverage integration tests passed`

- [ ] **Step 5: Commit**

```bash
git add strokmatic_vision_tools/deflectometry/coverage.py \
       tests/test_coverage_integration.py
git commit -m "feat(deflectometry): coverage orchestrator — sweep simulation with reflection + quality checks"
```

---

## Task 5: Coverage Visualizer

**Files:**
- Create: `strokmatic_vision_tools/deflectometry/visualizer.py`
- Create: `tests/test_deflectometry_visualizer.py`

- [ ] **Step 1: Write test_deflectometry_visualizer.py**

```python
"""Tests for deflectometry visualizer — must run inside Blender."""
import bpy
import sys
import os
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.deflectometry.coverage import compute_coverage
from strokmatic_vision_tools.deflectometry.coverage_data import CoverageParams
from strokmatic_vision_tools.deflectometry.visualizer import (
    paint_coverage_heatmap,
    clear_coverage_heatmap,
)


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    cam_data = bpy.data.cameras.new("TestCam")
    cam_data.lens = 12
    cam_data.sensor_width = 36.0
    cam_obj = bpy.data.objects.new("TestCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = (0, 0, 2)
    bpy.context.scene.camera = cam_obj

    bpy.context.scene.render.resolution_x = 640
    bpy.context.scene.render.resolution_y = 512

    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "CarBody"
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=4)
    bpy.ops.object.mode_set(mode='OBJECT')

    bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=2.0, location=(1, 0, 1))
    emitter = bpy.context.active_object
    emitter.name = "Emitter1"
    emitter.rotation_euler = (math.radians(90), 0, 0)
    emitter["skm_is_emitter"] = True

    bpy.context.view_layer.update()
    return cam_obj, plane, emitter


def test_paint_creates_color_layer():
    cam, plane, emitter = setup_scene()
    params = CoverageParams(
        "Y", -500, 500, 250,
        check_resolution=False, check_angle=False,
        check_sweep_duration=False, check_occlusion=False,
    )
    matrix = compute_coverage(bpy.context, params)
    paint_coverage_heatmap([plane], matrix, camera_filter=None)
    assert "SKM_Coverage" in [a.name for a in plane.data.color_attributes]


def test_paint_per_camera_filter():
    cam, plane, emitter = setup_scene()
    params = CoverageParams(
        "Y", -500, 500, 250,
        check_resolution=False, check_angle=False,
        check_sweep_duration=False, check_occlusion=False,
    )
    matrix = compute_coverage(bpy.context, params)
    paint_coverage_heatmap([plane], matrix, camera_filter="TestCam")
    assert "SKM_Coverage" in [a.name for a in plane.data.color_attributes]


def test_clear_removes_layer():
    cam, plane, emitter = setup_scene()
    params = CoverageParams(
        "Y", -500, 500, 250,
        check_resolution=False, check_angle=False,
        check_sweep_duration=False, check_occlusion=False,
    )
    matrix = compute_coverage(bpy.context, params)
    paint_coverage_heatmap([plane], matrix, camera_filter=None)
    clear_coverage_heatmap([plane])
    assert "SKM_Coverage" not in [a.name for a in plane.data.color_attributes]


if __name__ == "__main__":
    test_paint_creates_color_layer()
    test_paint_per_camera_filter()
    test_clear_removes_layer()
    print("OK: all deflectometry visualizer tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_deflectometry_visualizer.py 2>&1 | tail -5
```

Expected: `ImportError`

- [ ] **Step 3: Implement visualizer.py**

```python
"""Coverage heatmap visualizer — paints vertex colors from CoverageMatrix.

Color scheme:
- Green: fully covered (all criteria met)
- Yellow: partially covered (reflection exists but quality marginal)
- Red: not covered (no reflection hits any emitter)
- Blue: redundant (covered by 2+ cameras)
- Gray: not in any camera's FOV
"""
import numpy as np

from .. import mesh_utils

# Coverage colors (RGBA)
COLOR_COVERED = (0.1, 0.85, 0.1, 1.0)      # green
COLOR_PARTIAL = (0.95, 0.85, 0.1, 1.0)      # yellow
COLOR_UNCOVERED = (0.9, 0.1, 0.1, 1.0)      # red
COLOR_REDUNDANT = (0.2, 0.4, 0.9, 1.0)      # blue
COLOR_NO_FOV = (0.3, 0.3, 0.3, 1.0)         # gray


def _classify_vertex(vertex_result, camera_filter=None):
    """Determine the coverage color for a vertex.

    Args:
        vertex_result: VertexResult from coverage matrix.
        camera_filter: If set, only consider hits from this camera name.

    Returns:
        RGBA tuple.
    """
    hits = vertex_result.hits
    if camera_filter:
        hits = [h for h in hits if h.camera == camera_filter]

    if not hits:
        # Check if it was at least in some camera's FOV
        misses = vertex_result.nearest_misses
        if camera_filter:
            misses = [m for m in misses if m.camera == camera_filter]
        if not misses:
            return COLOR_NO_FOV
        # Has near misses — was in FOV but reflection/quality failed
        return COLOR_UNCOVERED

    if not camera_filter and len(vertex_result.hits) >= 2:
        return COLOR_REDUNDANT

    return COLOR_COVERED


def paint_coverage_heatmap(objects, matrix, camera_filter=None):
    """Paint coverage results as vertex colors.

    Args:
        objects: List of mesh objects (inspection targets).
        matrix: CoverageMatrix with results.
        camera_filter: Camera name to show, or None for all cameras.
    """
    global_idx = 0
    for obj in objects:
        mesh_data = obj.data
        layer = mesh_utils.get_or_create_color_layer(mesh_data, "SKM_Coverage")

        num_loops = len(mesh_data.loops)
        colors_flat = np.zeros(num_loops * 4, dtype=np.float32)

        for li, loop in enumerate(mesh_data.loops):
            vi = loop.vertex_index
            gi = global_idx + vi
            vr = matrix.results.get(gi)
            if vr is None:
                color = COLOR_NO_FOV
            else:
                color = _classify_vertex(vr, camera_filter)
            colors_flat[li * 4: li * 4 + 4] = color

        mesh_utils.set_vertex_colors_bulk(mesh_data, "SKM_Coverage", colors_flat)
        global_idx += len(mesh_data.vertices)

    # Set active color attribute
    for obj in objects:
        layer = obj.data.color_attributes.get("SKM_Coverage")
        if layer:
            obj.data.color_attributes.active_color = layer


def clear_coverage_heatmap(objects):
    """Remove coverage heatmap from objects."""
    for obj in objects:
        mesh_data = obj.data
        layer = mesh_data.color_attributes.get("SKM_Coverage")
        if layer is not None:
            mesh_data.color_attributes.remove(layer)
        mesh_data.update()
```

- [ ] **Step 4: Run test — verify it passes**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_deflectometry_visualizer.py 2>&1 | tail -5
```

Expected: `OK: all deflectometry visualizer tests passed`

- [ ] **Step 5: Commit**

```bash
git add strokmatic_vision_tools/deflectometry/visualizer.py \
       tests/test_deflectometry_visualizer.py
git commit -m "feat(deflectometry): coverage visualizer — vertex color heatmap with per-camera filtering"
```

---

## Task 6: Report Export

**Files:**
- Create: `strokmatic_vision_tools/deflectometry/report.py`

- [ ] **Step 1: Implement report.py**

```python
"""Coverage report generation — JSON and text summary export."""
import json
import os


def generate_report(matrix):
    """Generate a structured coverage report from a CoverageMatrix.

    Args:
        matrix: CoverageMatrix with computed results.

    Returns:
        Dict with summary and per-camera breakdown.
    """
    summary = matrix.summary()

    # Per-camera breakdown
    camera_stats = {}
    for cam_name in matrix.cameras:
        cam_covered = 0
        for vr in matrix.results.values():
            if any(h.camera == cam_name for h in vr.hits):
                cam_covered += 1
        camera_stats[cam_name] = {
            "vertices_covered": cam_covered,
            "coverage_pct": round(
                100.0 * cam_covered / summary["total_vertices"], 1
            ) if summary["total_vertices"] > 0 else 0.0,
        }

    # Failure reason breakdown
    failure_reasons = {}
    for vr in matrix.results.values():
        if not vr.is_covered:
            for nm in vr.nearest_misses:
                reason = nm.failure_reason
                failure_reasons[reason] = failure_reasons.get(reason, 0) + 1

    return {
        "summary": summary,
        "cameras": camera_stats,
        "failure_reasons": failure_reasons,
        "params": matrix.params.to_dict(),
    }


def export_json(matrix, filepath):
    """Export coverage matrix and report to JSON file.

    Args:
        matrix: CoverageMatrix.
        filepath: Output file path.
    """
    report = generate_report(matrix)
    report["coverage_matrix"] = json.loads(matrix.to_json())
    with open(filepath, 'w') as f:
        json.dump(report, f, indent=2)


def format_text_summary(matrix):
    """Format a human-readable coverage summary.

    Args:
        matrix: CoverageMatrix.

    Returns:
        Multi-line string with coverage summary.
    """
    report = generate_report(matrix)
    s = report["summary"]
    lines = [
        "=== Deflectometry Coverage Report ===",
        f"Total vertices: {s['total_vertices']}",
        f"Covered: {s['covered']} ({s['coverage_pct']}%)",
        f"Uncovered: {s['uncovered']}",
        "",
        "--- Per Camera ---",
    ]
    for cam_name, stats in report["cameras"].items():
        lines.append(f"  {cam_name}: {stats['vertices_covered']} vertices ({stats['coverage_pct']}%)")

    if report["failure_reasons"]:
        lines.append("")
        lines.append("--- Failure Reasons (uncovered vertices) ---")
        for reason, count in sorted(report["failure_reasons"].items(), key=lambda x: -x[1]):
            lines.append(f"  {reason}: {count}")

    return "\n".join(lines)
```

- [ ] **Step 2: Verify syntax**

```bash
python3 -c "import ast; ast.parse(open('strokmatic_vision_tools/deflectometry/report.py').read()); print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add strokmatic_vision_tools/deflectometry/report.py
git commit -m "feat(deflectometry): report export — JSON and text coverage summary"
```

---

## Task 7: Blender Operators

**Files:**
- Create: `strokmatic_vision_tools/deflectometry/operators.py`

- [ ] **Step 1: Implement operators.py**

```python
"""Blender operators for deflectometry coverage analysis."""
import bpy
from bpy.props import StringProperty

from .. import mesh_utils
from .coverage import compute_coverage
from .coverage_data import CoverageParams
from .visualizer import paint_coverage_heatmap, clear_coverage_heatmap
from .report import export_json, format_text_summary


class SKM_OT_TagEmitter(bpy.types.Operator):
    """Tag selected objects as IR emitters."""
    bl_idname = "skm_vision.tag_emitter"
    bl_label = "Tag as Emitter"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        count = 0
        for obj in context.selected_objects:
            if obj.type == 'MESH':
                obj["skm_is_emitter"] = True
                count += 1
        self.report({'INFO'}, f"Tagged {count} object(s) as emitters")
        return {'FINISHED'}


class SKM_OT_UntagEmitter(bpy.types.Operator):
    """Remove emitter tag from selected objects."""
    bl_idname = "skm_vision.untag_emitter"
    bl_label = "Untag Emitter"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        count = 0
        for obj in context.selected_objects:
            if "skm_is_emitter" in obj:
                del obj["skm_is_emitter"]
                count += 1
        self.report({'INFO'}, f"Untagged {count} object(s)")
        return {'FINISHED'}


class SKM_OT_ComputeCoverage(bpy.types.Operator):
    """Compute deflectometry coverage analysis."""
    bl_idname = "skm_vision.compute_coverage"
    bl_label = "Compute Coverage"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        scene = context.scene

        params = CoverageParams(
            sweep_axis=scene.skm_deflect_sweep_axis,
            sweep_start=scene.skm_deflect_sweep_start,
            sweep_end=scene.skm_deflect_sweep_end,
            sweep_step=scene.skm_deflect_sweep_step,
            check_resolution=scene.skm_deflect_check_resolution,
            min_resolution=scene.skm_deflect_min_resolution,
            check_angle=scene.skm_deflect_check_angle,
            max_angle=scene.skm_deflect_max_angle,
            check_occlusion=scene.skm_deflect_check_occlusion,
            check_sweep_duration=scene.skm_deflect_check_sweep_duration,
            min_sweep_steps=scene.skm_deflect_min_sweep_steps,
            use_analytic=(scene.skm_deflect_solver == 'ANALYTIC'),
        )

        matrix = compute_coverage(context, params)

        if matrix.vertices == 0:
            self.report({'WARNING'}, "No vertices to analyze — check targets, cameras, and emitters")
            return {'CANCELLED'}

        # Store matrix on scene for other operators to use
        scene["_skm_coverage_json"] = matrix.to_json()

        targets = mesh_utils.get_target_objects(context, scene.skm_vision_scope)
        camera_filter = None
        if scene.skm_deflect_show_camera != 'ALL':
            camera_filter = scene.skm_deflect_show_camera

        paint_coverage_heatmap(targets, matrix, camera_filter)

        summary = matrix.summary()
        self.report({'INFO'},
            f"Coverage: {summary['coverage_pct']}% "
            f"({summary['covered']}/{summary['total_vertices']} vertices)")
        return {'FINISHED'}


class SKM_OT_ClearCoverage(bpy.types.Operator):
    """Clear deflectometry coverage heatmap."""
    bl_idname = "skm_vision.clear_coverage"
    bl_label = "Clear Coverage"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        targets = mesh_utils.get_target_objects(context, context.scene.skm_vision_scope)
        clear_coverage_heatmap(targets)
        if "_skm_coverage_json" in context.scene:
            del context.scene["_skm_coverage_json"]
        self.report({'INFO'}, "Coverage heatmap cleared")
        return {'FINISHED'}


class SKM_OT_ExportCoverageReport(bpy.types.Operator):
    """Export coverage report to JSON file."""
    bl_idname = "skm_vision.export_coverage_report"
    bl_label = "Export Coverage Report"

    filepath: StringProperty(subtype='FILE_PATH', default="coverage_report.json")

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}

    def execute(self, context):
        json_str = context.scene.get("_skm_coverage_json")
        if not json_str:
            self.report({'ERROR'}, "No coverage data — run Compute first")
            return {'CANCELLED'}

        from .coverage_data import CoverageMatrix
        matrix = CoverageMatrix.from_json(json_str)
        export_json(matrix, self.filepath)

        summary = format_text_summary(matrix)
        print(summary)

        self.report({'INFO'}, f"Report exported to {self.filepath}")
        return {'FINISHED'}


CLASSES = [
    SKM_OT_TagEmitter,
    SKM_OT_UntagEmitter,
    SKM_OT_ComputeCoverage,
    SKM_OT_ClearCoverage,
    SKM_OT_ExportCoverageReport,
]


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
```

- [ ] **Step 2: Verify syntax**

```bash
python3 -c "import ast; ast.parse(open('strokmatic_vision_tools/deflectometry/operators.py').read()); print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add strokmatic_vision_tools/deflectometry/operators.py
git commit -m "feat(deflectometry): Blender operators — compute, clear, tag, export"
```

---

## Task 8: UI Panel Update + Scene Properties

**Files:**
- Modify: `strokmatic_vision_tools/ui_panel.py`
- Modify: `strokmatic_vision_tools/__init__.py`
- Update: `strokmatic_vision_tools/deflectometry/__init__.py`

- [ ] **Step 1: Update deflectometry/__init__.py with public API**

```python
"""Deflectometry coverage analysis sub-package."""
from .coverage import compute_coverage
from .coverage_data import CoverageMatrix, CoverageParams
from .report import export_json, format_text_summary
```

- [ ] **Step 2: Add deflectometry section to ui_panel.py**

Append the following to the `draw` method of `SKM_PT_VisionTools` (after the Viewing Angle Heatmap section), and add the new scene properties to `SCENE_PROPS`:

In the `draw` method, after the angle heatmap section, add:

```python
        # --- Deflectometry Coverage ---
        box = layout.box()
        box.label(text="Deflectometry Coverage", icon='OUTLINER_OB_LIGHT')

        # Emitter tagging
        row = box.row(align=True)
        row.operator("skm_vision.tag_emitter", text="Tag Emitter", icon='ADD')
        row.operator("skm_vision.untag_emitter", text="Untag", icon='REMOVE')

        # Show tagged emitter count
        emitter_count = sum(1 for o in context.view_layer.objects
                           if o.type == 'MESH' and o.get("skm_is_emitter", False))
        box.label(text=f"Emitters tagged: {emitter_count}")

        # Sweep parameters
        col = box.column(align=True)
        col.prop(scene, "skm_deflect_sweep_axis", text="Sweep Axis")
        col.prop(scene, "skm_deflect_sweep_start", text="Start (mm)")
        col.prop(scene, "skm_deflect_sweep_end", text="End (mm)")
        col.prop(scene, "skm_deflect_sweep_step", text="Step (mm)")

        box.prop(scene, "skm_deflect_solver", text="Solver")

        # Toggleable checks
        col = box.column(align=True)
        col.prop(scene, "skm_deflect_check_resolution", text="Check Resolution")
        if scene.skm_deflect_check_resolution:
            col.prop(scene, "skm_deflect_min_resolution", text="Min px/mm")

        col.prop(scene, "skm_deflect_check_angle", text="Check Angle")
        if scene.skm_deflect_check_angle:
            col.prop(scene, "skm_deflect_max_angle", text="Max Angle (\u00b0)")

        col.prop(scene, "skm_deflect_check_sweep_duration", text="Check Sweep Duration")
        if scene.skm_deflect_check_sweep_duration:
            col.prop(scene, "skm_deflect_min_sweep_steps", text="Min Steps")

        col.prop(scene, "skm_deflect_check_occlusion", text="Check Occlusion")

        # Camera filter
        box.prop(scene, "skm_deflect_show_camera", text="Show Camera")

        # Action buttons
        row = box.row(align=True)
        row.operator("skm_vision.compute_coverage", text="Compute", icon='PLAY')
        row.operator("skm_vision.clear_coverage", text="Clear", icon='X')
        box.operator("skm_vision.export_coverage_report", text="Export Report", icon='EXPORT')
```

Add these to `SCENE_PROPS` dict:

```python
    "skm_deflect_sweep_axis": EnumProperty(
        items=[("X", "X", ""), ("Y", "Y", ""), ("Z", "Z", "")],
        name="Sweep Axis",
        default="Y",
    ),
    "skm_deflect_sweep_start": FloatProperty(
        name="Sweep Start", default=-3000.0, description="Start position (mm)",
    ),
    "skm_deflect_sweep_end": FloatProperty(
        name="Sweep End", default=3000.0, description="End position (mm)",
    ),
    "skm_deflect_sweep_step": FloatProperty(
        name="Sweep Step", default=50.0, min=1.0, description="Step size (mm)",
    ),
    "skm_deflect_solver": EnumProperty(
        items=[
            ("ANALYTIC", "Analytic", "Fast closed-form ray-cylinder intersection"),
            ("RAYCAST", "Ray Cast", "Blender ray_cast for arbitrary emitter geometry"),
        ],
        name="Solver", default="ANALYTIC",
    ),
    "skm_deflect_check_resolution": BoolProperty(
        name="Check Resolution", default=True,
    ),
    "skm_deflect_min_resolution": FloatProperty(
        name="Min Resolution", default=5.0, min=0.001, description="Minimum px/mm",
    ),
    "skm_deflect_check_angle": BoolProperty(
        name="Check Angle", default=True,
    ),
    "skm_deflect_max_angle": FloatProperty(
        name="Max Angle", default=60.0, min=1.0, max=89.0, description="Max viewing angle (°)",
    ),
    "skm_deflect_check_occlusion": BoolProperty(
        name="Check Occlusion", default=False,
    ),
    "skm_deflect_check_sweep_duration": BoolProperty(
        name="Check Sweep Duration", default=True,
    ),
    "skm_deflect_min_sweep_steps": IntProperty(
        name="Min Sweep Steps", default=3, min=1, description="Minimum consecutive covered steps",
    ),
    "skm_deflect_show_camera": EnumProperty(
        items=[("ALL", "All Cameras", "Show combined coverage")],
        name="Show Camera", default="ALL",
        description="Filter heatmap to a single camera (populated after Compute)",
    ),
```

Add `IntProperty` to the imports at the top of `ui_panel.py`:

```python
from bpy.props import (
    PointerProperty,
    EnumProperty,
    FloatProperty,
    BoolProperty,
    IntProperty,
)
```

- [ ] **Step 3: Update __init__.py to register deflectometry**

```python
bl_info = {
    "name": "Strokmatic Vision Tools",
    "author": "Strokmatic",
    "version": (1, 1, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > SKM Vision",
    "description": "Machine vision camera validation tools — resolution, angle, and deflectometry coverage",
    "category": "3D View",
}

from . import calibration_importer
from . import resolution_heatmap
from . import angle_heatmap
from .deflectometry import operators as deflectometry_ops
from . import ui_panel


def register():
    calibration_importer.register()
    resolution_heatmap.register()
    angle_heatmap.register()
    deflectometry_ops.register()
    ui_panel.register()


def unregister():
    ui_panel.unregister()
    deflectometry_ops.unregister()
    angle_heatmap.unregister()
    resolution_heatmap.unregister()
    calibration_importer.unregister()


if __name__ == "__main__":
    register()
```

- [ ] **Step 4: Verify all syntax**

```bash
for f in strokmatic_vision_tools/deflectometry/*.py strokmatic_vision_tools/__init__.py strokmatic_vision_tools/ui_panel.py; do
  python3 -c "import ast; ast.parse(open('$f').read()); print('OK: $f')"
done
```

- [ ] **Step 5: Commit**

```bash
git add strokmatic_vision_tools/deflectometry/__init__.py \
       strokmatic_vision_tools/ui_panel.py \
       strokmatic_vision_tools/__init__.py
git commit -m "feat(deflectometry): UI panel with scene properties and full add-on registration"
```

---

## Task 9: Update blender_manifest.toml + Test Runner + Integration Test

**Files:**
- Modify: `strokmatic_vision_tools/blender_manifest.toml`
- Modify: `tests/run_all.sh`

- [ ] **Step 1: Update blender_manifest.toml version**

```toml
schema_version = "1.0.0"

id = "strokmatic_vision_tools"
version = "1.1.0"
name = "Strokmatic Vision Tools"
tagline = "Machine vision validation — resolution, angle, and deflectometry coverage heatmaps"
maintainer = "Strokmatic <contato@strokmatic.com>"
type = "add-on"

blender_version_min = "4.2.0"

license = ["SPDX:GPL-3.0-or-later"]

[build]
paths_exclude_pattern = [
    "__pycache__/",
    "*.pyc",
]
```

- [ ] **Step 2: Add deflectometry tests to run_all.sh**

Append these lines to the `--- Blender tests ---` section in `tests/run_all.sh`, before the results summary:

```bash
run_test "sweep"                "$SCRIPT_DIR/test_sweep.py"
run_test "coverage_integration" "$SCRIPT_DIR/test_coverage_integration.py"
run_test "deflect_visualizer"   "$SCRIPT_DIR/test_deflectometry_visualizer.py"
```

And add the new pure Python test to the `--- Pure Python tests ---` section:

```bash
run_test "coverage_data" "$SCRIPT_DIR/test_coverage_data.py" "false"
```

- [ ] **Step 3: Run the full test suite**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && ./tests/run_all.sh
```

Expected: all tests pass (both original 6 + new 5 = 11 total).

- [ ] **Step 4: Run end-to-end operator test**

```bash
blender --background --python -c "
import bpy, sys, math
sys.path.insert(0, '.')
import strokmatic_vision_tools
strokmatic_vision_tools.register()

# Setup scene
bpy.ops.wm.read_factory_settings(use_empty=True)
cam_data = bpy.data.cameras.new('Cam')
cam_data.lens = 12
cam_obj = bpy.data.objects.new('Cam', cam_data)
bpy.context.collection.objects.link(cam_obj)
cam_obj.location = (0, 0, 2)
bpy.context.scene.camera = cam_obj
bpy.context.scene.render.resolution_x = 640
bpy.context.scene.render.resolution_y = 512

bpy.ops.mesh.primitive_plane_add(size=2.0)
plane = bpy.context.active_object
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.subdivide(number_cuts=4)
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=2.0, location=(1, 0, 1))
emitter = bpy.context.active_object
emitter.rotation_euler = (math.radians(90), 0, 0)
emitter['skm_is_emitter'] = True

scene = bpy.context.scene
scene.skm_vision_scope = 'VISIBLE'
scene.skm_deflect_sweep_axis = 'Y'
scene.skm_deflect_sweep_start = -500
scene.skm_deflect_sweep_end = 500
scene.skm_deflect_sweep_step = 250
scene.skm_deflect_check_resolution = False
scene.skm_deflect_check_angle = False
scene.skm_deflect_check_sweep_duration = False

bpy.context.view_layer.update()
bpy.ops.skm_vision.compute_coverage()

assert 'SKM_Coverage' in [a.name for a in plane.data.color_attributes]
assert '_skm_coverage_json' in scene

bpy.ops.skm_vision.clear_coverage()
assert 'SKM_Coverage' not in [a.name for a in plane.data.color_attributes]

print('OK: end-to-end deflectometry pipeline passed')
strokmatic_vision_tools.unregister()
" 2>&1 | tail -5
```

Expected: `OK: end-to-end deflectometry pipeline passed`

- [ ] **Step 5: Commit**

```bash
git add strokmatic_vision_tools/blender_manifest.toml tests/run_all.sh
git commit -m "feat(deflectometry): v1.1.0 — update manifest, test runner, integration verified"
```
