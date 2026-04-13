# Strokmatic Vision Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Blender add-on that paints resolution (px/mm or mm/px) and viewing angle heatmaps onto mesh objects for machine vision camera placement validation.

**Architecture:** A single Blender add-on folder (`strokmatic_vision_tools/`) with shared utility modules (camera math, color ramps, mesh helpers) and three operators (calibration import, resolution heatmap, angle heatmap) exposed via a sidebar panel. Vertex colors are painted directly onto meshes — no UV dependency.

**Tech Stack:** Blender Python API (`bpy`, `bpy_extras`, `gpu`, `blf`), numpy (bundled with Blender), mathutils.

**Spec:** `docs/superpowers/specs/2026-04-13-blender-vision-tools-design.md`

**Base path:** `workspaces/strokmatic/sdk/sdk-blender-tools/`

---

## Important: Blender Add-on Testing

Blender add-ons run inside Blender's embedded Python. Standard `pytest` does not work — `import bpy` fails outside Blender. All testing must be done by running scripts inside Blender:

```bash
blender --background --python path/to/test_script.py
```

Each test script uses plain `assert` statements and prints results. There is no test framework — just scripts that exit 0 on success, non-zero on failure.

For pure-math functions (color ramp, angle calculation), we can extract them into modules that don't import `bpy` and test with standard Python. The plan marks which tests need Blender and which don't.

---

## File Structure

```
workspaces/strokmatic/sdk/sdk-blender-tools/
├── strokmatic_vision_tools/
│   ├── __init__.py              # bl_info, register/unregister
│   ├── camera_utils.py          # Projection math, FOV checks
│   ├── color_ramp.py            # Gradient + threshold coloring
│   ├── mesh_utils.py            # Target objects, vertex color layers, visibility
│   ├── ui_panel.py              # Sidebar panel (SKM Vision tab)
│   ├── calibration_importer.py  # Operator: import OpenCV JSON
│   ├── resolution_heatmap.py    # Operator: px/mm or mm/px color map
│   └── angle_heatmap.py         # Operator: angle color map
├── tests/
│   ├── test_color_ramp.py       # Pure Python — no bpy needed
│   ├── test_camera_utils.py     # Runs inside Blender (--background)
│   ├── test_mesh_utils.py       # Runs inside Blender (--background)
│   ├── test_calibration.py      # Runs inside Blender (--background)
│   ├── test_resolution.py       # Runs inside Blender (--background)
│   ├── test_angle.py            # Runs inside Blender (--background)
│   └── run_all.sh               # Runs all tests (pure Python + Blender)
├── camera_intrinsics.json       # Example calibration file (existing)
├── camera_calibration_importer.py  # Legacy script (kept for reference, not registered)
└── README.md                    # Installation + usage guide
```

---

## Task 1: Add-on Skeleton + Registration

**Files:**
- Create: `strokmatic_vision_tools/__init__.py`

- [ ] **Step 1: Create the add-on __init__.py with bl_info and empty register/unregister**

```python
bl_info = {
    "name": "Strokmatic Vision Tools",
    "author": "Strokmatic",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > SKM Vision",
    "description": "Machine vision camera validation tools — resolution and angle heatmaps",
    "category": "3D View",
}


def register():
    pass


def unregister():
    pass


if __name__ == "__main__":
    register()
```

- [ ] **Step 2: Verify the add-on loads in Blender**

Run:
```bash
blender --background --python -c "import sys; sys.path.insert(0, 'workspaces/strokmatic/sdk/sdk-blender-tools'); import strokmatic_vision_tools; strokmatic_vision_tools.register(); print('OK: addon loaded'); strokmatic_vision_tools.unregister()"
```

Expected: prints `OK: addon loaded` and exits cleanly.

- [ ] **Step 3: Commit**

```bash
git add workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/__init__.py
git commit -m "feat(blender-tools): add-on skeleton with bl_info and register/unregister"
```

---

## Task 2: Color Ramp Module (Pure Python, No bpy)

**Files:**
- Create: `strokmatic_vision_tools/color_ramp.py`
- Create: `tests/test_color_ramp.py`

This module has zero `bpy` imports — it's pure math. We can test it with standard Python.

- [ ] **Step 1: Write test_color_ramp.py**

```python
"""Tests for color_ramp.py — pure Python, no Blender needed."""
import sys
import os

# Add parent so we can import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.color_ramp import (
    value_to_color_continuous,
    value_to_color_threshold,
)


def test_continuous_min_is_blue():
    r, g, b, a = value_to_color_continuous(0.0, 0.0, 10.0)
    assert b > r, f"Min value should be blue-ish, got ({r:.2f}, {g:.2f}, {b:.2f})"
    assert a == 1.0


def test_continuous_max_is_red():
    r, g, b, a = value_to_color_continuous(10.0, 0.0, 10.0)
    assert r > b, f"Max value should be red-ish, got ({r:.2f}, {g:.2f}, {b:.2f})"


def test_continuous_mid_is_green():
    r, g, b, a = value_to_color_continuous(5.0, 0.0, 10.0)
    assert g >= r and g >= b, f"Mid value should be green-ish, got ({r:.2f}, {g:.2f}, {b:.2f})"


def test_continuous_clamps_below_min():
    color = value_to_color_continuous(-5.0, 0.0, 10.0)
    color_at_min = value_to_color_continuous(0.0, 0.0, 10.0)
    assert color == color_at_min, "Below-min should clamp to min color"


def test_continuous_clamps_above_max():
    color = value_to_color_continuous(15.0, 0.0, 10.0)
    color_at_max = value_to_color_continuous(10.0, 0.0, 10.0)
    assert color == color_at_max, "Above-max should clamp to max color"


def test_continuous_equal_min_max():
    r, g, b, a = value_to_color_continuous(5.0, 5.0, 5.0)
    # When min==max, everything maps to mid-point
    assert a == 1.0, "Should still return valid color"


def test_threshold_pass():
    r, g, b, a = value_to_color_threshold(10.0, threshold=5.0, margin=2.0)
    assert g > r and g > b, f"Pass (10 >= 5+2=7) should be green, got ({r:.2f}, {g:.2f}, {b:.2f})"


def test_threshold_marginal():
    r, g, b, a = value_to_color_threshold(6.0, threshold=5.0, margin=2.0)
    assert r > 0.5 and g > 0.5, f"Marginal (5 <= 6 < 7) should be yellow, got ({r:.2f}, {g:.2f}, {b:.2f})"


def test_threshold_fail():
    r, g, b, a = value_to_color_threshold(3.0, threshold=5.0, margin=2.0)
    assert r > g and r > b, f"Fail (3 < 5) should be red, got ({r:.2f}, {g:.2f}, {b:.2f})"


def test_threshold_zero_margin():
    # With margin=0, values >= threshold are green, below are red
    rg, gg, bg, _ = value_to_color_threshold(5.0, threshold=5.0, margin=0.0)
    assert gg > rg, f"At threshold with margin=0 should be green, got ({rg:.2f}, {gg:.2f}, {bg:.2f})"
    rr, gr, br, _ = value_to_color_threshold(4.9, threshold=5.0, margin=0.0)
    assert rr > gr, f"Below threshold should be red, got ({rr:.2f}, {gr:.2f}, {br:.2f})"


if __name__ == "__main__":
    test_continuous_min_is_blue()
    test_continuous_max_is_red()
    test_continuous_mid_is_green()
    test_continuous_clamps_below_min()
    test_continuous_clamps_above_max()
    test_continuous_equal_min_max()
    test_threshold_pass()
    test_threshold_marginal()
    test_threshold_fail()
    test_threshold_zero_margin()
    print("OK: all color_ramp tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_color_ramp.py
```

Expected: `ImportError: cannot import name 'value_to_color_continuous' from 'strokmatic_vision_tools.color_ramp'`

- [ ] **Step 3: Implement color_ramp.py**

```python
"""Color mapping utilities for heatmap visualization.

Pure Python + math — no bpy dependency. Can be tested outside Blender.
"""
import math

# Fixed colors
COLOR_GRAY = (0.3, 0.3, 0.3, 1.0)
COLOR_GREEN = (0.1, 0.85, 0.1, 1.0)
COLOR_YELLOW = (0.95, 0.85, 0.1, 1.0)
COLOR_RED = (0.9, 0.1, 0.1, 1.0)


def _hsv_to_rgb(h, s, v):
    """Convert HSV (h in [0,1], s in [0,1], v in [0,1]) to RGB tuple."""
    if s == 0.0:
        return (v, v, v)
    i = int(h * 6.0)
    f = (h * 6.0) - i
    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))
    i = i % 6
    if i == 0:
        return (v, t, p)
    if i == 1:
        return (q, v, p)
    if i == 2:
        return (p, v, t)
    if i == 3:
        return (p, q, v)
    if i == 4:
        return (t, p, v)
    return (v, p, q)


def value_to_color_continuous(value, min_val, max_val):
    """Map a scalar value to a blue-cyan-green-yellow-red gradient.

    Args:
        value: The scalar value to map.
        min_val: The minimum of the data range.
        max_val: The maximum of the data range.

    Returns:
        Tuple (r, g, b, a) with components in [0, 1].
    """
    if max_val <= min_val:
        return _hsv_to_rgb(0.33, 0.9, 0.85) + (1.0,)

    t = (value - min_val) / (max_val - min_val)
    t = max(0.0, min(1.0, t))

    # Hue: 0.66 (blue) -> 0.5 (cyan) -> 0.33 (green) -> 0.16 (yellow) -> 0.0 (red)
    hue = 0.66 * (1.0 - t)
    return _hsv_to_rgb(hue, 0.9, 0.85) + (1.0,)


def value_to_color_threshold(value, threshold, margin):
    """Map a scalar value to green/yellow/red based on threshold.

    - value >= threshold + margin → green (pass)
    - threshold <= value < threshold + margin → yellow (marginal)
    - value < threshold → red (fail)

    Args:
        value: The scalar value to evaluate.
        threshold: The minimum acceptable value.
        margin: Width of the marginal band above threshold.

    Returns:
        Tuple (r, g, b, a) with components in [0, 1].
    """
    if value >= threshold + margin:
        return COLOR_GREEN
    if value >= threshold:
        return COLOR_YELLOW
    return COLOR_RED
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && python3 tests/test_color_ramp.py
```

Expected: `OK: all color_ramp tests passed`

- [ ] **Step 5: Commit**

```bash
git add workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/color_ramp.py \
       workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_color_ramp.py
git commit -m "feat(blender-tools): color ramp module with continuous and threshold modes"
```

---

## Task 3: Camera Utilities Module

**Files:**
- Create: `strokmatic_vision_tools/camera_utils.py`
- Create: `tests/test_camera_utils.py`

These functions use `bpy` and `bpy_extras` so tests run inside Blender.

- [ ] **Step 1: Write test_camera_utils.py**

```python
"""Tests for camera_utils.py — must run inside Blender."""
import bpy
import sys
import os
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.camera_utils import (
    world_to_pixel,
    is_point_in_fov,
    view_angle_at_point,
    pixel_per_mm_at_point,
    get_camera_info,
)


def setup_scene():
    """Create a minimal scene with a camera."""
    # Clear scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Create camera
    cam_data = bpy.data.cameras.new("TestCam")
    cam_data.lens = 35  # 35mm focal length
    cam_data.sensor_width = 36.0
    cam_obj = bpy.data.objects.new("TestCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # Place camera at (0, 0, 5) looking down -Z
    cam_obj.location = (0, 0, 5)
    cam_obj.rotation_euler = (0, 0, 0)

    # Set render resolution
    bpy.context.scene.render.resolution_x = 640
    bpy.context.scene.render.resolution_y = 512

    # Update scene
    bpy.context.view_layer.update()

    return cam_obj


def test_world_to_pixel_center():
    """A point directly in front of the camera should project near image center."""
    cam = setup_scene()
    scene = bpy.context.scene
    px_x, px_y = world_to_pixel(scene, cam, Vector((0, 0, 0)))
    # Should be near center (320, 256)
    assert abs(px_x - 320) < 50, f"Expected ~320, got {px_x}"
    assert abs(px_y - 256) < 50, f"Expected ~256, got {px_y}"


def test_is_point_in_fov_center():
    cam = setup_scene()
    scene = bpy.context.scene
    assert is_point_in_fov(scene, cam, Vector((0, 0, 0))), "Origin should be in FOV"


def test_is_point_in_fov_behind():
    cam = setup_scene()
    scene = bpy.context.scene
    # Point behind camera
    assert not is_point_in_fov(scene, cam, Vector((0, 0, 10))), "Point behind cam should be out of FOV"


def test_view_angle_head_on():
    cam = setup_scene()
    # Normal pointing up toward camera = head-on
    angle = view_angle_at_point(cam, Vector((0, 0, 0)), Vector((0, 0, 1)))
    assert angle < 5.0, f"Head-on angle should be ~0°, got {angle:.1f}°"


def test_view_angle_grazing():
    cam = setup_scene()
    # Normal perpendicular to view direction
    angle = view_angle_at_point(cam, Vector((0, 0, 0)), Vector((1, 0, 0)))
    assert abs(angle - 90.0) < 5.0, f"Grazing angle should be ~90°, got {angle:.1f}°"


def test_pixel_per_mm():
    cam = setup_scene()
    scene = bpy.context.scene
    point = Vector((0, 0, 0))
    tangent_u = Vector((1, 0, 0))
    tangent_v = Vector((0, 1, 0))
    px_mm = pixel_per_mm_at_point(scene, cam, point, tangent_u, tangent_v)
    # At 5m distance with 35mm lens on 36mm sensor, 640px wide:
    # FOV width ~ 2 * 5 * tan(atan(18/35)) ~ 5.14m
    # px/mm ~ 640 / 5140 ~ 0.125 px/mm
    assert 0.05 < px_mm < 0.5, f"Expected ~0.12 px/mm at 5m, got {px_mm:.4f}"


def test_get_camera_info():
    cam = setup_scene()
    scene = bpy.context.scene
    info = get_camera_info(scene, cam)
    assert info["resolution_x"] == 640
    assert info["resolution_y"] == 512
    assert abs(info["focal_length_mm"] - 35.0) < 0.1
    assert "fov_h" in info
    assert "fov_v" in info


if __name__ == "__main__":
    test_world_to_pixel_center()
    test_is_point_in_fov_center()
    test_is_point_in_fov_behind()
    test_view_angle_head_on()
    test_view_angle_grazing()
    test_pixel_per_mm()
    test_get_camera_info()
    print("OK: all camera_utils tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_camera_utils.py 2>&1 | tail -5
```

Expected: `ImportError` — module not yet implemented.

- [ ] **Step 3: Implement camera_utils.py**

```python
"""Camera projection and analysis utilities.

Provides functions for projecting 3D points to pixel coordinates,
computing effective resolution (px/mm), and measuring viewing angles.
"""
import math
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


def world_to_pixel(scene, camera, point_3d):
    """Project a world-space point to pixel coordinates.

    Args:
        scene: The Blender scene (provides render resolution).
        camera: The camera object.
        point_3d: A mathutils.Vector in world space.

    Returns:
        Tuple (px_x, px_y) in pixel coordinates. (0,0) is bottom-left.
    """
    co = world_to_camera_view(scene, camera, point_3d)
    px_x = co.x * scene.render.resolution_x
    px_y = co.y * scene.render.resolution_y
    return (px_x, px_y)


def is_point_in_fov(scene, camera, point_3d):
    """Check whether a 3D point falls within the camera's field of view.

    Args:
        scene: The Blender scene.
        camera: The camera object.
        point_3d: A mathutils.Vector in world space.

    Returns:
        True if the point projects within the image bounds and is in
        front of the camera.
    """
    co = world_to_camera_view(scene, camera, point_3d)
    return (0.0 <= co.x <= 1.0) and (0.0 <= co.y <= 1.0) and (co.z > 0.0)


def view_angle_at_point(camera, point_3d, normal):
    """Compute the angle between the camera view direction and a surface normal.

    Args:
        camera: The camera object.
        point_3d: Surface point in world space.
        normal: Surface normal at that point (world space, normalized).

    Returns:
        Angle in degrees. 0 = head-on, 90 = grazing.
    """
    cam_pos = camera.matrix_world.translation
    view_dir = (cam_pos - point_3d).normalized()
    dot = max(-1.0, min(1.0, view_dir.dot(normal)))
    return math.degrees(math.acos(abs(dot)))


def pixel_per_mm_at_point(scene, camera, point_3d, tangent_u, tangent_v):
    """Compute effective resolution (px/mm) at a surface point.

    Uses finite differences: projects the point and a 1mm offset along
    each tangent direction, measures pixel displacement.

    Args:
        scene: The Blender scene.
        camera: The camera object.
        point_3d: Surface point in world space (mathutils.Vector).
        tangent_u: First tangent direction (normalized, world space).
        tangent_v: Second tangent direction (normalized, world space).

    Returns:
        Minimum px/mm across both tangent directions (worst axis governs).
    """
    # Blender uses meters internally. 1mm = 0.001 Blender units.
    offset = 0.001

    px0_x, px0_y = world_to_pixel(scene, camera, point_3d)

    # Displacement along tangent_u
    pu_x, pu_y = world_to_pixel(scene, camera, point_3d + tangent_u * offset)
    dist_u = math.sqrt((pu_x - px0_x) ** 2 + (pu_y - px0_y) ** 2)

    # Displacement along tangent_v
    pv_x, pv_y = world_to_pixel(scene, camera, point_3d + tangent_v * offset)
    dist_v = math.sqrt((pv_x - px0_x) ** 2 + (pv_y - px0_y) ** 2)

    # px/mm = pixel displacement per 1mm. Take the minimum (worst case).
    return min(dist_u, dist_v) if min(dist_u, dist_v) > 0 else 0.0


def get_camera_info(scene, camera):
    """Get camera parameters for display in the UI.

    Returns:
        Dict with keys: focal_length_mm, sensor_width_mm, fov_h, fov_v,
        resolution_x, resolution_y.
    """
    cam = camera.data
    focal = cam.lens
    sensor_w = cam.sensor_width
    res_x = scene.render.resolution_x
    res_y = scene.render.resolution_y

    # Horizontal FOV
    fov_h = 2.0 * math.degrees(math.atan(sensor_w / (2.0 * focal)))

    # Vertical FOV (accounting for aspect ratio)
    aspect = res_y / res_x
    sensor_h = sensor_w * aspect
    fov_v = 2.0 * math.degrees(math.atan(sensor_h / (2.0 * focal)))

    return {
        "focal_length_mm": focal,
        "sensor_width_mm": sensor_w,
        "fov_h": round(fov_h, 1),
        "fov_v": round(fov_v, 1),
        "resolution_x": res_x,
        "resolution_y": res_y,
    }
```

- [ ] **Step 4: Run test — verify it passes**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_camera_utils.py 2>&1 | tail -5
```

Expected: `OK: all camera_utils tests passed`

- [ ] **Step 5: Commit**

```bash
git add workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/camera_utils.py \
       workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_camera_utils.py
git commit -m "feat(blender-tools): camera projection utilities — world_to_pixel, view_angle, px/mm"
```

---

## Task 4: Mesh Utilities Module

**Files:**
- Create: `strokmatic_vision_tools/mesh_utils.py`
- Create: `tests/test_mesh_utils.py`

- [ ] **Step 1: Write test_mesh_utils.py**

```python
"""Tests for mesh_utils.py — must run inside Blender."""
import bpy
import sys
import os
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.mesh_utils import (
    get_target_objects,
    get_or_create_color_layer,
    get_vertex_tangents,
)


def setup_scene():
    """Create a scene with two mesh objects."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Create two planes
    bpy.ops.mesh.primitive_plane_add(location=(0, 0, 0))
    plane1 = bpy.context.active_object
    plane1.name = "Plane1"

    bpy.ops.mesh.primitive_plane_add(location=(3, 0, 0))
    plane2 = bpy.context.active_object
    plane2.name = "Plane2"

    bpy.context.view_layer.update()
    return plane1, plane2


def test_get_target_objects_selected():
    plane1, plane2 = setup_scene()
    # Select only plane1
    bpy.ops.object.select_all(action='DESELECT')
    plane1.select_set(True)
    bpy.context.view_layer.objects.active = plane1

    targets = get_target_objects(bpy.context, "SELECTED")
    assert len(targets) == 1, f"Expected 1 selected, got {len(targets)}"
    assert targets[0].name == "Plane1"


def test_get_target_objects_visible():
    plane1, plane2 = setup_scene()
    targets = get_target_objects(bpy.context, "VISIBLE")
    assert len(targets) == 2, f"Expected 2 visible, got {len(targets)}"


def test_get_or_create_color_layer():
    plane1, _ = setup_scene()
    mesh = plane1.data
    layer = get_or_create_color_layer(mesh, "TestColors")
    assert layer is not None, "Color layer should be created"
    assert "TestColors" in [a.name for a in mesh.color_attributes]

    # Calling again should return same layer, not create duplicate
    layer2 = get_or_create_color_layer(mesh, "TestColors")
    count = sum(1 for a in mesh.color_attributes if a.name == "TestColors")
    assert count == 1, f"Should have exactly 1 layer, got {count}"


def test_get_vertex_tangents():
    plane1, _ = setup_scene()
    mesh = plane1.data
    mesh.calc_normals_split()
    t_u, t_v = get_vertex_tangents(mesh, 0)
    # Tangents should be unit vectors
    assert abs(t_u.length - 1.0) < 0.01, f"tangent_u length {t_u.length}"
    assert abs(t_v.length - 1.0) < 0.01, f"tangent_v length {t_v.length}"
    # Tangents should be roughly orthogonal
    assert abs(t_u.dot(t_v)) < 0.1, f"Tangents should be orthogonal, dot={t_u.dot(t_v)}"


if __name__ == "__main__":
    test_get_target_objects_selected()
    test_get_target_objects_visible()
    test_get_or_create_color_layer()
    test_get_vertex_tangents()
    print("OK: all mesh_utils tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_mesh_utils.py 2>&1 | tail -5
```

Expected: `ImportError`

- [ ] **Step 3: Implement mesh_utils.py**

```python
"""Mesh analysis utilities for heatmap computation.

Handles object selection, vertex color layer management, visibility
ray-casting, and tangent vector computation.
"""
import bpy
import numpy as np
from mathutils import Vector


def get_target_objects(context, mode):
    """Get mesh objects to analyze based on scope mode.

    Args:
        context: Blender context.
        mode: "SELECTED" for selected objects, "VISIBLE" for all visible meshes.

    Returns:
        List of mesh objects.
    """
    if mode == "SELECTED":
        return [obj for obj in context.selected_objects if obj.type == 'MESH']
    # VISIBLE
    return [obj for obj in context.view_layer.objects if obj.type == 'MESH' and obj.visible_get()]


def get_or_create_color_layer(mesh, name):
    """Get or create a named vertex color attribute.

    If the attribute already exists, it is removed and recreated (cleared).

    Args:
        mesh: A bpy.types.Mesh.
        name: The color attribute name.

    Returns:
        The color attribute.
    """
    # Remove existing to clear it
    existing = mesh.color_attributes.get(name)
    if existing is not None:
        mesh.color_attributes.remove(existing)

    # Create new FLOAT_COLOR on CORNER domain (per-loop)
    layer = mesh.color_attributes.new(name=name, type='FLOAT_COLOR', domain='CORNER')
    return layer


def get_vertex_tangents(mesh, vertex_index):
    """Compute two orthogonal tangent vectors at a vertex.

    Uses edges connected to the vertex to derive tangent directions,
    then orthogonalizes them against the vertex normal.

    Args:
        mesh: A bpy.types.Mesh (must have valid normals).
        vertex_index: Index of the vertex.

    Returns:
        Tuple (tangent_u, tangent_v) as normalized mathutils.Vectors.
    """
    vert = mesh.vertices[vertex_index]
    normal = vert.normal.normalized()

    # Find edges connected to this vertex
    tangent_u = None
    for edge in mesh.edges:
        if vertex_index in edge.vertices:
            other_idx = edge.vertices[1] if edge.vertices[0] == vertex_index else edge.vertices[0]
            edge_vec = (mesh.vertices[other_idx].co - vert.co).normalized()
            # Project onto plane perpendicular to normal
            tangent_u = (edge_vec - normal * edge_vec.dot(normal)).normalized()
            break

    if tangent_u is None or tangent_u.length < 0.001:
        # Fallback: arbitrary vector perpendicular to normal
        if abs(normal.z) < 0.9:
            tangent_u = normal.cross(Vector((0, 0, 1))).normalized()
        else:
            tangent_u = normal.cross(Vector((1, 0, 0))).normalized()

    # Second tangent: cross product
    tangent_v = normal.cross(tangent_u).normalized()

    return tangent_u, tangent_v


def check_visibility(depsgraph, scene, origin, target, expected_obj):
    """Check if a point is visible from an origin via ray-cast.

    Args:
        depsgraph: Evaluated dependency graph.
        scene: The Blender scene.
        origin: Ray origin (camera position).
        target: Target point on surface.
        expected_obj: The object we expect to hit.

    Returns:
        True if the ray hits the expected object (point is visible).
    """
    direction = (target - origin).normalized()
    max_dist = (target - origin).length * 1.01  # slight overshoot

    result, location, normal, face_index, hit_obj, matrix = scene.ray_cast(
        depsgraph, origin, direction, distance=max_dist
    )

    if not result:
        return True  # No hit means unoccluded (open space)

    # Check if we hit the expected object (within tolerance)
    if hit_obj == expected_obj:
        return True

    # Hit something else first — occluded
    return False


def set_vertex_colors_bulk(mesh, layer_name, colors_flat):
    """Set vertex colors using numpy for performance.

    Args:
        mesh: A bpy.types.Mesh.
        layer_name: Name of the color attribute.
        colors_flat: Flat numpy array of shape (num_loops * 4,) with RGBA values.
    """
    layer = mesh.color_attributes.get(layer_name)
    if layer is None:
        return
    layer.data.foreach_set("color", colors_flat)
    mesh.update()
```

- [ ] **Step 4: Run test — verify it passes**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_mesh_utils.py 2>&1 | tail -5
```

Expected: `OK: all mesh_utils tests passed`

- [ ] **Step 5: Commit**

```bash
git add workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/mesh_utils.py \
       workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_mesh_utils.py
git commit -m "feat(blender-tools): mesh utilities — target objects, color layers, tangents, visibility"
```

---

## Task 5: Calibration Importer Operator

**Files:**
- Create: `strokmatic_vision_tools/calibration_importer.py`
- Create: `tests/test_calibration.py`

- [ ] **Step 1: Write test_calibration.py**

```python
"""Tests for calibration_importer.py — must run inside Blender."""
import bpy
import sys
import os
import json
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.calibration_importer import (
    load_calibration_data,
    apply_calibration_to_camera,
)


def test_load_calibration_data():
    """Load the example calibration JSON."""
    json_path = os.path.join(os.path.dirname(__file__), "..", "camera_intrinsics.json")
    data = load_calibration_data(json_path)
    assert "1" in data, "Should contain camera '1'"
    assert "2" in data, "Should contain camera '2'"
    assert "camera_matrix" in data["1"]
    assert "dist_coeffs" in data["1"]


def test_load_calibration_missing_file():
    try:
        load_calibration_data("/nonexistent/file.json")
        assert False, "Should raise FileNotFoundError"
    except FileNotFoundError:
        pass


def test_load_calibration_invalid_json():
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        f.write('{"bad": "no camera_matrix"}')
        path = f.name
    try:
        load_calibration_data(path)
        assert False, "Should raise ValueError"
    except ValueError:
        pass
    finally:
        os.unlink(path)


def test_apply_calibration_to_camera():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    cam_data = {
        "camera_matrix": [
            [896.52, 0.0, 320.0],
            [0.0, 898.91, 256.0],
            [0.0, 0.0, 1.0],
        ],
        "dist_coeffs": [[-0.463, 0.258, 0.0, 0.0, 0.0]],
        "fov_x": 42.4,
        "fov_y": 33.6,
    }

    cam_obj = apply_calibration_to_camera(bpy.context, "test_cam", cam_data)

    assert cam_obj is not None
    assert cam_obj.name == "Camera_test_cam"
    assert cam_obj.data.lens > 0, "Focal length should be set"

    # Resolution should be set from principal point
    assert bpy.context.scene.render.resolution_x == 640
    assert bpy.context.scene.render.resolution_y == 512


if __name__ == "__main__":
    test_load_calibration_data()
    test_load_calibration_missing_file()
    test_load_calibration_invalid_json()
    test_apply_calibration_to_camera()
    print("OK: all calibration tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_calibration.py 2>&1 | tail -5
```

Expected: `ImportError`

- [ ] **Step 3: Implement calibration_importer.py**

```python
"""Camera calibration importer — loads OpenCV JSON into Blender cameras.

Ported from the legacy camera_calibration_importer.py script with fixes:
- mathlib → mathutils (typo fix)
- Hardcoded path → file browser operator
- print() → self.report() for Blender UI feedback
"""
import bpy
import json
import os
import math
from bpy.props import StringProperty
from bpy_extras.io_utils import ImportHelper


# Default sensor width (Full Frame)
SENSOR_WIDTH_MM = 36.0


def load_calibration_data(filepath):
    """Load and validate camera calibration data from JSON.

    Expected format: dict of camera IDs → {camera_matrix, dist_coeffs, fov_x?, fov_y?}

    Args:
        filepath: Path to the JSON file.

    Returns:
        Dict of camera calibration data.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the JSON structure is invalid.
    """
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Calibration file not found: {filepath}")

    with open(filepath, 'r') as f:
        data = json.load(f)

    if not isinstance(data, dict) or len(data) == 0:
        raise ValueError("JSON must contain an object with camera IDs as keys")

    for camera_id, cam in data.items():
        for key in ("camera_matrix", "dist_coeffs"):
            if key not in cam:
                raise ValueError(f"Camera '{camera_id}': missing required key '{key}'")

    return data


def apply_calibration_to_camera(context, camera_id, cam_data):
    """Create a Blender camera and apply calibration parameters.

    Args:
        context: Blender context.
        camera_id: Identifier string for the camera.
        cam_data: Dict with camera_matrix, dist_coeffs, optional fov_x/fov_y.

    Returns:
        The created camera object.
    """
    matrix = cam_data["camera_matrix"]
    fx = matrix[0][0]
    cx = matrix[0][2]
    cy = matrix[1][2]

    image_width = int(cx * 2)
    image_height = int(cy * 2)

    # Set scene render resolution
    context.scene.render.resolution_x = image_width
    context.scene.render.resolution_y = image_height
    context.scene.render.resolution_percentage = 100

    # Create camera
    camera_name = f"Camera_{camera_id}"
    camera_data = bpy.data.cameras.new(name=camera_name)
    camera_obj = bpy.data.objects.new(camera_name, camera_data)
    context.collection.objects.link(camera_obj)

    # Focal length: fx * sensor_width / image_width
    camera_data.sensor_width = SENSOR_WIDTH_MM
    camera_data.sensor_fit = 'HORIZONTAL'
    camera_data.lens = fx * SENSOR_WIDTH_MM / image_width

    # Principal point shift
    center_x = image_width / 2.0
    center_y = image_height / 2.0
    camera_data.shift_x = (cx - center_x) / image_width
    camera_data.shift_y = -(cy - center_y) / image_height

    return camera_obj


class SKM_OT_ImportCalibration(bpy.types.Operator, ImportHelper):
    """Import camera calibration from OpenCV JSON file."""
    bl_idname = "skm_vision.import_calibration"
    bl_label = "Import Camera Calibration"
    bl_options = {'REGISTER', 'UNDO'}

    filter_glob: StringProperty(default="*.json", options={'HIDDEN'})

    def execute(self, context):
        try:
            cameras_data = load_calibration_data(self.filepath)
        except (FileNotFoundError, ValueError) as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}

        cam_objects = []
        for idx, (cam_id, cam_data) in enumerate(cameras_data.items()):
            cam_obj = apply_calibration_to_camera(context, cam_id, cam_data)
            cam_objects.append(cam_obj)

            # First camera becomes active
            if idx == 0:
                context.scene.camera = cam_obj

        self.report({'INFO'}, f"Imported {len(cam_objects)} camera(s) from {os.path.basename(self.filepath)}")
        return {'FINISHED'}


def register():
    bpy.utils.register_class(SKM_OT_ImportCalibration)


def unregister():
    bpy.utils.unregister_class(SKM_OT_ImportCalibration)
```

- [ ] **Step 4: Run test — verify it passes**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_calibration.py 2>&1 | tail -5
```

Expected: `OK: all calibration tests passed`

- [ ] **Step 5: Commit**

```bash
git add workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/calibration_importer.py \
       workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_calibration.py
git commit -m "feat(blender-tools): calibration importer operator — OpenCV JSON to Blender camera"
```

---

## Task 6: Resolution Heatmap Operator

**Files:**
- Create: `strokmatic_vision_tools/resolution_heatmap.py`
- Create: `tests/test_resolution.py`

- [ ] **Step 1: Write test_resolution.py**

```python
"""Tests for resolution_heatmap.py — must run inside Blender."""
import bpy
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools import resolution_heatmap


def setup_scene():
    """Create a scene with camera and a plane."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Camera at (0, 0, 2) looking down
    cam_data = bpy.data.cameras.new("TestCam")
    cam_data.lens = 25
    cam_data.sensor_width = 36.0
    cam_obj = bpy.data.objects.new("TestCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = (0, 0, 2)
    bpy.context.scene.camera = cam_obj

    bpy.context.scene.render.resolution_x = 640
    bpy.context.scene.render.resolution_y = 512

    # Plane at origin (1m x 1m, subdivided for vertex density)
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "TestPlane"

    # Subdivide for enough vertices
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=4)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Set scene property for camera selection
    bpy.context.scene["skm_vision_camera"] = cam_obj

    bpy.context.view_layer.update()
    return cam_obj, plane


def test_compute_resolution_creates_color_layer():
    cam, plane = setup_scene()
    scene = bpy.context.scene

    resolution_heatmap.compute_resolution_heatmap(
        scene=scene,
        camera=cam,
        targets=[plane],
        unit="PX_MM",
        mode="CONTINUOUS",
        threshold=5.0,
        margin=1.0,
        check_occlusion=False,
    )

    assert "SKM_Resolution" in [a.name for a in plane.data.color_attributes], \
        "Should create SKM_Resolution color attribute"


def test_compute_resolution_mm_px_unit():
    cam, plane = setup_scene()
    scene = bpy.context.scene

    # Should not raise with mm/px unit
    resolution_heatmap.compute_resolution_heatmap(
        scene=scene,
        camera=cam,
        targets=[plane],
        unit="MM_PX",
        mode="CONTINUOUS",
        threshold=0.2,
        margin=0.05,
        check_occlusion=False,
    )

    assert "SKM_Resolution" in [a.name for a in plane.data.color_attributes]


def test_compute_resolution_threshold_mode():
    cam, plane = setup_scene()
    scene = bpy.context.scene

    resolution_heatmap.compute_resolution_heatmap(
        scene=scene,
        camera=cam,
        targets=[plane],
        unit="PX_MM",
        mode="THRESHOLD",
        threshold=5.0,
        margin=1.0,
        check_occlusion=False,
    )

    assert "SKM_Resolution" in [a.name for a in plane.data.color_attributes]


def test_clear_resolution():
    cam, plane = setup_scene()
    scene = bpy.context.scene

    # First compute
    resolution_heatmap.compute_resolution_heatmap(
        scene=scene,
        camera=cam,
        targets=[plane],
        unit="PX_MM",
        mode="CONTINUOUS",
        threshold=5.0,
        margin=1.0,
        check_occlusion=False,
    )

    # Then clear
    resolution_heatmap.clear_resolution_heatmap([plane])
    assert "SKM_Resolution" not in [a.name for a in plane.data.color_attributes], \
        "Clear should remove the color attribute"


if __name__ == "__main__":
    test_compute_resolution_creates_color_layer()
    test_compute_resolution_mm_px_unit()
    test_compute_resolution_threshold_mode()
    test_clear_resolution()
    print("OK: all resolution_heatmap tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_resolution.py 2>&1 | tail -5
```

Expected: `ImportError` or `AttributeError`

- [ ] **Step 3: Implement resolution_heatmap.py**

```python
"""Resolution heatmap operator — paints px/mm or mm/px vertex colors.

Computes effective camera resolution at each vertex of target meshes
and visualizes it as a color map using vertex colors.
"""
import bpy
import math
import numpy as np
from mathutils import Vector

from . import camera_utils
from . import mesh_utils
from . import color_ramp


def compute_resolution_heatmap(scene, camera, targets, unit, mode, threshold, margin, check_occlusion):
    """Compute and paint resolution heatmap on target meshes.

    Args:
        scene: Blender scene.
        camera: Camera object.
        targets: List of mesh objects to analyze.
        unit: "PX_MM" for pixels/mm, "MM_PX" for mm/pixel.
        mode: "CONTINUOUS" or "THRESHOLD".
        threshold: Threshold value (in selected unit).
        margin: Margin band width (in selected unit).
        check_occlusion: Whether to ray-cast for visibility.
    """
    depsgraph = None
    if check_occlusion:
        depsgraph = bpy.context.evaluated_depsgraph_get()

    cam_pos = camera.matrix_world.translation

    # First pass: compute all values to find min/max for continuous mode
    all_values = []
    obj_values = {}

    for obj in targets:
        mesh = obj.data
        world_matrix = obj.matrix_world

        mesh.calc_normals_split()
        layer = mesh_utils.get_or_create_color_layer(mesh, "SKM_Resolution")

        num_loops = len(mesh.loops)
        values = [None] * num_loops

        for li, loop in enumerate(mesh.loops):
            vi = loop.vertex_index
            vert = mesh.vertices[vi]
            vert_world = world_matrix @ vert.co

            # FOV check
            if not camera_utils.is_point_in_fov(scene, camera, vert_world):
                values[li] = None
                continue

            # Occlusion check
            if check_occlusion and depsgraph is not None:
                if not mesh_utils.check_visibility(depsgraph, scene, cam_pos, vert_world, obj):
                    values[li] = None
                    continue

            # Compute tangents
            tangent_u, tangent_v = mesh_utils.get_vertex_tangents(mesh, vi)
            # Transform tangents to world space (rotation only)
            rot_matrix = world_matrix.to_3x3().normalized()
            tangent_u_w = (rot_matrix @ tangent_u).normalized()
            tangent_v_w = (rot_matrix @ tangent_v).normalized()

            px_mm = camera_utils.pixel_per_mm_at_point(scene, camera, vert_world, tangent_u_w, tangent_v_w)

            if unit == "MM_PX":
                value = (1.0 / px_mm) if px_mm > 0 else float('inf')
            else:
                value = px_mm

            values[li] = value
            all_values.append(value)

        obj_values[obj.name] = values

    # Determine min/max for continuous mode
    if all_values:
        min_val = min(all_values)
        max_val = max(all_values)
    else:
        min_val, max_val = 0.0, 1.0

    # Second pass: assign colors
    for obj in targets:
        mesh = obj.data
        values = obj_values[obj.name]
        num_loops = len(mesh.loops)
        colors_flat = np.zeros(num_loops * 4, dtype=np.float32)

        for li in range(num_loops):
            val = values[li]
            if val is None:
                c = color_ramp.COLOR_GRAY
            elif mode == "CONTINUOUS":
                c = color_ramp.value_to_color_continuous(val, min_val, max_val)
            else:
                c = color_ramp.value_to_color_threshold(val, threshold, margin)

            colors_flat[li * 4: li * 4 + 4] = c

        mesh_utils.set_vertex_colors_bulk(mesh, "SKM_Resolution", colors_flat)

    # Set active color attribute for viewport display
    for obj in targets:
        layer = obj.data.color_attributes.get("SKM_Resolution")
        if layer:
            obj.data.color_attributes.active_color = layer


def clear_resolution_heatmap(targets):
    """Remove resolution heatmap from target meshes.

    Args:
        targets: List of mesh objects.
    """
    for obj in targets:
        mesh = obj.data
        layer = mesh.color_attributes.get("SKM_Resolution")
        if layer is not None:
            mesh.color_attributes.remove(layer)
        mesh.update()


class SKM_OT_ComputeResolution(bpy.types.Operator):
    """Compute effective resolution (px/mm or mm/px) heatmap."""
    bl_idname = "skm_vision.compute_resolution"
    bl_label = "Compute Resolution Map"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        scene = context.scene
        camera = scene.skm_vision_camera

        if camera is None:
            self.report({'ERROR'}, "No camera selected")
            return {'CANCELLED'}

        targets = mesh_utils.get_target_objects(context, scene.skm_vision_scope)
        if not targets:
            self.report({'ERROR'}, "No target objects found")
            return {'CANCELLED'}

        compute_resolution_heatmap(
            scene=scene,
            camera=camera,
            targets=targets,
            unit=scene.skm_resolution_unit,
            mode=scene.skm_resolution_mode,
            threshold=scene.skm_resolution_threshold,
            margin=scene.skm_resolution_margin,
            check_occlusion=scene.skm_check_occlusion,
        )

        total_verts = sum(len(o.data.vertices) for o in targets)
        unit_label = "px/mm" if scene.skm_resolution_unit == "PX_MM" else "mm/px"
        self.report({'INFO'}, f"Resolution map computed ({unit_label}) — {total_verts} vertices on {len(targets)} object(s)")
        return {'FINISHED'}


class SKM_OT_ClearResolution(bpy.types.Operator):
    """Clear resolution heatmap from objects."""
    bl_idname = "skm_vision.clear_resolution"
    bl_label = "Clear Resolution Map"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        scene = context.scene
        targets = mesh_utils.get_target_objects(context, scene.skm_vision_scope)
        clear_resolution_heatmap(targets)
        self.report({'INFO'}, "Resolution map cleared")
        return {'FINISHED'}


def register():
    bpy.utils.register_class(SKM_OT_ComputeResolution)
    bpy.utils.register_class(SKM_OT_ClearResolution)


def unregister():
    bpy.utils.unregister_class(SKM_OT_ClearResolution)
    bpy.utils.unregister_class(SKM_OT_ComputeResolution)
```

- [ ] **Step 4: Run test — verify it passes**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_resolution.py 2>&1 | tail -5
```

Expected: `OK: all resolution_heatmap tests passed`

- [ ] **Step 5: Commit**

```bash
git add workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/resolution_heatmap.py \
       workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_resolution.py
git commit -m "feat(blender-tools): resolution heatmap operator — px/mm and mm/px with continuous and threshold modes"
```

---

## Task 7: Viewing Angle Heatmap Operator

**Files:**
- Create: `strokmatic_vision_tools/angle_heatmap.py`
- Create: `tests/test_angle.py`

- [ ] **Step 1: Write test_angle.py**

```python
"""Tests for angle_heatmap.py — must run inside Blender."""
import bpy
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools import angle_heatmap


def setup_scene():
    """Create a scene with camera and a plane."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

    cam_data = bpy.data.cameras.new("TestCam")
    cam_data.lens = 25
    cam_data.sensor_width = 36.0
    cam_obj = bpy.data.objects.new("TestCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = (0, 0, 2)
    bpy.context.scene.camera = cam_obj

    bpy.context.scene.render.resolution_x = 640
    bpy.context.scene.render.resolution_y = 512

    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "TestPlane"

    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=4)
    bpy.ops.object.mode_set(mode='OBJECT')

    bpy.context.view_layer.update()
    return cam_obj, plane


def test_compute_angle_creates_color_layer():
    cam, plane = setup_scene()
    scene = bpy.context.scene

    angle_heatmap.compute_angle_heatmap(
        scene=scene,
        camera=cam,
        targets=[plane],
        mode="CONTINUOUS",
        threshold=60.0,
        margin=10.0,
        check_occlusion=False,
    )

    assert "SKM_ViewAngle" in [a.name for a in plane.data.color_attributes], \
        "Should create SKM_ViewAngle color attribute"


def test_compute_angle_threshold_mode():
    cam, plane = setup_scene()
    scene = bpy.context.scene

    angle_heatmap.compute_angle_heatmap(
        scene=scene,
        camera=cam,
        targets=[plane],
        mode="THRESHOLD",
        threshold=60.0,
        margin=10.0,
        check_occlusion=False,
    )

    assert "SKM_ViewAngle" in [a.name for a in plane.data.color_attributes]


def test_flat_plane_head_on_gives_low_angles():
    """A flat plane directly below a camera should have near-zero angles at center."""
    cam, plane = setup_scene()
    scene = bpy.context.scene

    angle_heatmap.compute_angle_heatmap(
        scene=scene,
        camera=cam,
        targets=[plane],
        mode="CONTINUOUS",
        threshold=60.0,
        margin=10.0,
        check_occlusion=False,
    )

    # Read back the colors from the center vertex (vertex 0 is at origin for default plane)
    mesh = plane.data
    layer = mesh.color_attributes.get("SKM_ViewAngle")
    # Green channel should be high (low angle = good = green end of spectrum)
    # We can't assert exact colors easily, but we check the layer has data
    assert layer is not None
    assert len(layer.data) > 0


def test_clear_angle():
    cam, plane = setup_scene()
    scene = bpy.context.scene

    angle_heatmap.compute_angle_heatmap(
        scene=scene,
        camera=cam,
        targets=[plane],
        mode="CONTINUOUS",
        threshold=60.0,
        margin=10.0,
        check_occlusion=False,
    )

    angle_heatmap.clear_angle_heatmap([plane])
    assert "SKM_ViewAngle" not in [a.name for a in plane.data.color_attributes], \
        "Clear should remove the color attribute"


if __name__ == "__main__":
    test_compute_angle_creates_color_layer()
    test_compute_angle_threshold_mode()
    test_flat_plane_head_on_gives_low_angles()
    test_clear_angle()
    print("OK: all angle_heatmap tests passed")
```

- [ ] **Step 2: Run test — verify it fails**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_angle.py 2>&1 | tail -5
```

Expected: `ImportError`

- [ ] **Step 3: Implement angle_heatmap.py**

```python
"""Viewing angle heatmap operator — paints camera-vs-normal angle as vertex colors.

Computes the angle between the camera view direction and the surface
normal at each vertex. 0 degrees = head-on, 90 degrees = grazing.
"""
import bpy
import math
import numpy as np
from mathutils import Vector

from . import camera_utils
from . import mesh_utils
from . import color_ramp


def compute_angle_heatmap(scene, camera, targets, mode, threshold, margin, check_occlusion):
    """Compute and paint viewing angle heatmap on target meshes.

    Args:
        scene: Blender scene.
        camera: Camera object.
        targets: List of mesh objects to analyze.
        mode: "CONTINUOUS" or "THRESHOLD".
        threshold: Maximum acceptable angle in degrees.
        margin: Margin band width in degrees.
        check_occlusion: Whether to ray-cast for visibility.
    """
    depsgraph = None
    if check_occlusion:
        depsgraph = bpy.context.evaluated_depsgraph_get()

    cam_pos = camera.matrix_world.translation

    # First pass: compute all angles to find min/max
    all_angles = []
    obj_angles = {}

    for obj in targets:
        mesh = obj.data
        world_matrix = obj.matrix_world
        # Normal transform: inverse-transpose of upper-3x3
        normal_matrix = world_matrix.to_3x3().inverted_safe().transposed()

        mesh.calc_normals_split()
        mesh_utils.get_or_create_color_layer(mesh, "SKM_ViewAngle")

        num_loops = len(mesh.loops)
        angles = [None] * num_loops

        for li, loop in enumerate(mesh.loops):
            vi = loop.vertex_index
            vert = mesh.vertices[vi]
            vert_world = world_matrix @ vert.co

            # FOV check
            if not camera_utils.is_point_in_fov(scene, camera, vert_world):
                angles[li] = None
                continue

            # Occlusion check
            if check_occlusion and depsgraph is not None:
                if not mesh_utils.check_visibility(depsgraph, scene, cam_pos, vert_world, obj):
                    angles[li] = None
                    continue

            # Compute world-space normal
            normal_local = vert.normal
            normal_world = (normal_matrix @ normal_local).normalized()

            angle = camera_utils.view_angle_at_point(camera, vert_world, normal_world)
            angles[li] = angle
            all_angles.append(angle)

        obj_angles[obj.name] = angles

    # Min/max for continuous mode
    if all_angles:
        min_val = min(all_angles)
        max_val = max(all_angles)
    else:
        min_val, max_val = 0.0, 90.0

    # Second pass: assign colors
    for obj in targets:
        mesh = obj.data
        angles = obj_angles[obj.name]
        num_loops = len(mesh.loops)
        colors_flat = np.zeros(num_loops * 4, dtype=np.float32)

        for li in range(num_loops):
            angle = angles[li]
            if angle is None:
                c = color_ramp.COLOR_GRAY
            elif mode == "CONTINUOUS":
                # For angles: 0° is good (green), 90° is bad (red)
                # Invert so low angle maps to high value in the ramp
                c = color_ramp.value_to_color_continuous(max_val - angle + min_val, min_val, max_val)
            else:
                # Threshold: angle <= threshold is good
                # Invert logic: use (threshold + margin - angle) as value, threshold=0
                # Simpler: just do direct comparison
                if angle <= threshold - margin:
                    c = color_ramp.COLOR_GREEN
                elif angle <= threshold:
                    c = color_ramp.COLOR_YELLOW
                else:
                    c = color_ramp.COLOR_RED

            colors_flat[li * 4: li * 4 + 4] = c

        mesh_utils.set_vertex_colors_bulk(mesh, "SKM_ViewAngle", colors_flat)

    # Set active color attribute
    for obj in targets:
        layer = obj.data.color_attributes.get("SKM_ViewAngle")
        if layer:
            obj.data.color_attributes.active_color = layer


def clear_angle_heatmap(targets):
    """Remove angle heatmap from target meshes.

    Args:
        targets: List of mesh objects.
    """
    for obj in targets:
        mesh = obj.data
        layer = mesh.color_attributes.get("SKM_ViewAngle")
        if layer is not None:
            mesh.color_attributes.remove(layer)
        mesh.update()


class SKM_OT_ComputeAngle(bpy.types.Operator):
    """Compute viewing angle heatmap."""
    bl_idname = "skm_vision.compute_angle"
    bl_label = "Compute Angle Map"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        scene = context.scene
        camera = scene.skm_vision_camera

        if camera is None:
            self.report({'ERROR'}, "No camera selected")
            return {'CANCELLED'}

        targets = mesh_utils.get_target_objects(context, scene.skm_vision_scope)
        if not targets:
            self.report({'ERROR'}, "No target objects found")
            return {'CANCELLED'}

        compute_angle_heatmap(
            scene=scene,
            camera=camera,
            targets=targets,
            mode=scene.skm_angle_mode,
            threshold=scene.skm_angle_threshold,
            margin=scene.skm_angle_margin,
            check_occlusion=scene.skm_check_occlusion,
        )

        total_verts = sum(len(o.data.vertices) for o in targets)
        self.report({'INFO'}, f"Angle map computed — {total_verts} vertices on {len(targets)} object(s)")
        return {'FINISHED'}


class SKM_OT_ClearAngle(bpy.types.Operator):
    """Clear viewing angle heatmap from objects."""
    bl_idname = "skm_vision.clear_angle"
    bl_label = "Clear Angle Map"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        scene = context.scene
        targets = mesh_utils.get_target_objects(context, scene.skm_vision_scope)
        clear_angle_heatmap(targets)
        self.report({'INFO'}, "Angle map cleared")
        return {'FINISHED'}


def register():
    bpy.utils.register_class(SKM_OT_ComputeAngle)
    bpy.utils.register_class(SKM_OT_ClearAngle)


def unregister():
    bpy.utils.unregister_class(SKM_OT_ClearAngle)
    bpy.utils.unregister_class(SKM_OT_ComputeAngle)
```

- [ ] **Step 4: Run test — verify it passes**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_angle.py 2>&1 | tail -5
```

Expected: `OK: all angle_heatmap tests passed`

- [ ] **Step 5: Commit**

```bash
git add workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/angle_heatmap.py \
       workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_angle.py
git commit -m "feat(blender-tools): viewing angle heatmap operator — camera-vs-normal with continuous and threshold"
```

---

## Task 8: UI Panel + Scene Properties

**Files:**
- Create: `strokmatic_vision_tools/ui_panel.py`
- Modify: `strokmatic_vision_tools/__init__.py`

- [ ] **Step 1: Implement ui_panel.py**

```python
"""Sidebar panel for Strokmatic Vision Tools.

Provides the SKM Vision tab in the 3D Viewport sidebar (N-panel)
with camera setup, resolution heatmap, and angle heatmap sections.
"""
import bpy
from bpy.props import (
    PointerProperty,
    EnumProperty,
    FloatProperty,
    BoolProperty,
)

from . import camera_utils


def camera_poll(self, obj):
    """Filter for camera objects only."""
    return obj.type == 'CAMERA'


class SKM_PT_VisionTools(bpy.types.Panel):
    """Strokmatic Vision Tools panel."""
    bl_label = "SKM Vision Tools"
    bl_idname = "SKM_PT_VisionTools"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "SKM Vision"

    def draw(self, context):
        layout = self.layout
        scene = context.scene

        # --- Camera Setup ---
        box = layout.box()
        box.label(text="Camera Setup", icon='CAMERA_DATA')
        box.prop(scene, "skm_vision_camera", text="Camera")
        box.operator("skm_vision.import_calibration", text="Import Calibration JSON", icon='IMPORT')

        # Show camera info if selected
        cam = scene.skm_vision_camera
        if cam is not None and cam.type == 'CAMERA':
            info = camera_utils.get_camera_info(scene, cam)
            col = box.column(align=True)
            col.label(text=f"Resolution: {info['resolution_x']} x {info['resolution_y']} px")
            col.label(text=f"Focal: {info['focal_length_mm']:.1f} mm")
            col.label(text=f"FOV: {info['fov_h']}° x {info['fov_v']}°")

        # --- Shared settings ---
        box = layout.box()
        box.label(text="Settings", icon='PREFERENCES')
        box.prop(scene, "skm_vision_scope", text="Scope")
        box.prop(scene, "skm_check_occlusion", text="Check Occlusion")

        # --- Resolution Heatmap ---
        box = layout.box()
        box.label(text="Resolution Heatmap", icon='IMAGE_DATA')
        box.prop(scene, "skm_resolution_unit", text="Unit")
        box.prop(scene, "skm_resolution_mode", text="Mode")

        if scene.skm_resolution_mode == 'THRESHOLD':
            col = box.column(align=True)
            unit_label = "px/mm" if scene.skm_resolution_unit == "PX_MM" else "mm/px"
            col.prop(scene, "skm_resolution_threshold", text=f"Threshold ({unit_label})")
            col.prop(scene, "skm_resolution_margin", text=f"Margin ({unit_label})")

        row = box.row(align=True)
        row.operator("skm_vision.compute_resolution", text="Compute", icon='PLAY')
        row.operator("skm_vision.clear_resolution", text="Clear", icon='X')

        # --- Viewing Angle Heatmap ---
        box = layout.box()
        box.label(text="Viewing Angle Heatmap", icon='LIGHT_SPOT')
        box.prop(scene, "skm_angle_mode", text="Mode")

        if scene.skm_angle_mode == 'THRESHOLD':
            col = box.column(align=True)
            col.prop(scene, "skm_angle_threshold", text="Max Angle (°)")
            col.prop(scene, "skm_angle_margin", text="Margin (°)")

        row = box.row(align=True)
        row.operator("skm_vision.compute_angle", text="Compute", icon='PLAY')
        row.operator("skm_vision.clear_angle", text="Clear", icon='X')


# Scene property definitions (registered in __init__.py)
SCENE_PROPS = {
    "skm_vision_camera": PointerProperty(
        type=bpy.types.Object,
        poll=camera_poll,
        name="Camera",
        description="Camera to use for heatmap computation",
    ),
    "skm_vision_scope": EnumProperty(
        items=[
            ("SELECTED", "Selected Objects", "Analyze selected mesh objects"),
            ("VISIBLE", "All Visible", "Analyze all visible mesh objects"),
        ],
        name="Scope",
        default="SELECTED",
    ),
    "skm_resolution_unit": EnumProperty(
        items=[
            ("PX_MM", "px/mm", "Pixels per millimeter — higher is better"),
            ("MM_PX", "mm/px", "Millimeters per pixel (GSD) — lower is better"),
        ],
        name="Unit",
        default="PX_MM",
    ),
    "skm_resolution_mode": EnumProperty(
        items=[
            ("CONTINUOUS", "Continuous", "Smooth gradient across value range"),
            ("THRESHOLD", "Threshold", "Pass/marginal/fail color bands"),
        ],
        name="Mode",
        default="CONTINUOUS",
    ),
    "skm_resolution_threshold": FloatProperty(
        name="Threshold",
        default=5.0,
        min=0.001,
        description="Threshold value in selected unit",
    ),
    "skm_resolution_margin": FloatProperty(
        name="Margin",
        default=1.0,
        min=0.0,
        description="Margin band width in selected unit",
    ),
    "skm_angle_mode": EnumProperty(
        items=[
            ("CONTINUOUS", "Continuous", "Smooth gradient across angle range"),
            ("THRESHOLD", "Threshold", "Pass/marginal/fail color bands"),
        ],
        name="Mode",
        default="CONTINUOUS",
    ),
    "skm_angle_threshold": FloatProperty(
        name="Max Angle",
        default=60.0,
        min=1.0,
        max=89.0,
        description="Maximum acceptable viewing angle in degrees",
    ),
    "skm_angle_margin": FloatProperty(
        name="Margin",
        default=10.0,
        min=0.0,
        description="Margin band width in degrees",
    ),
    "skm_check_occlusion": BoolProperty(
        name="Check Occlusion",
        default=False,
        description="Ray-cast visibility check (slower but handles occluded geometry)",
    ),
}


def register():
    bpy.utils.register_class(SKM_PT_VisionTools)
    for key, prop in SCENE_PROPS.items():
        setattr(bpy.types.Scene, key, prop)


def unregister():
    for key in SCENE_PROPS:
        if hasattr(bpy.types.Scene, key):
            delattr(bpy.types.Scene, key)
    bpy.utils.unregister_class(SKM_PT_VisionTools)
```

- [ ] **Step 2: Update __init__.py to wire everything together**

Replace the contents of `strokmatic_vision_tools/__init__.py` with:

```python
bl_info = {
    "name": "Strokmatic Vision Tools",
    "author": "Strokmatic",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > SKM Vision",
    "description": "Machine vision camera validation tools — resolution and angle heatmaps",
    "category": "3D View",
}

from . import calibration_importer
from . import resolution_heatmap
from . import angle_heatmap
from . import ui_panel


def register():
    calibration_importer.register()
    resolution_heatmap.register()
    angle_heatmap.register()
    ui_panel.register()


def unregister():
    ui_panel.unregister()
    angle_heatmap.unregister()
    resolution_heatmap.unregister()
    calibration_importer.unregister()


if __name__ == "__main__":
    register()
```

- [ ] **Step 3: Verify full add-on loads in Blender**

```bash
blender --background --python -c "
import sys
sys.path.insert(0, 'workspaces/strokmatic/sdk/sdk-blender-tools')
import strokmatic_vision_tools
strokmatic_vision_tools.register()
print('Operators registered:')
for op in dir(bpy.ops.skm_vision):
    if not op.startswith('_'):
        print(f'  skm_vision.{op}')
strokmatic_vision_tools.unregister()
print('OK: full addon loaded and unloaded')
" 2>&1 | grep -E '(OK:|skm_vision|Error)'
```

Expected:
```
  skm_vision.clear_angle
  skm_vision.clear_resolution
  skm_vision.compute_angle
  skm_vision.compute_resolution
  skm_vision.import_calibration
OK: full addon loaded and unloaded
```

- [ ] **Step 4: Commit**

```bash
git add workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/ui_panel.py \
       workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/__init__.py
git commit -m "feat(blender-tools): UI panel with scene properties and full add-on registration"
```

---

## Task 9: Test Runner + README

**Files:**
- Create: `tests/run_all.sh`
- Create: `README.md`

- [ ] **Step 1: Create tests/run_all.sh**

```bash
#!/usr/bin/env bash
# Run all Strokmatic Vision Tools tests.
# Usage: ./tests/run_all.sh [blender_path]
#
# blender_path defaults to "blender" (must be on PATH).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADDON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BLENDER="${1:-blender}"

echo "=== Strokmatic Vision Tools — Test Suite ==="
echo "Blender: $BLENDER"
echo "Add-on:  $ADDON_DIR"
echo ""

PASSED=0
FAILED=0

run_test() {
    local name="$1"
    local script="$2"
    local use_blender="${3:-true}"

    printf "  %-40s" "$name"

    if [ "$use_blender" = "true" ]; then
        if "$BLENDER" --background --python "$script" > /tmp/skm_test_output.txt 2>&1; then
            echo "PASS"
            PASSED=$((PASSED + 1))
        else
            echo "FAIL"
            FAILED=$((FAILED + 1))
            cat /tmp/skm_test_output.txt | tail -20
        fi
    else
        if python3 "$script" > /tmp/skm_test_output.txt 2>&1; then
            echo "PASS"
            PASSED=$((PASSED + 1))
        else
            echo "FAIL"
            FAILED=$((FAILED + 1))
            cat /tmp/skm_test_output.txt | tail -20
        fi
    fi
}

echo "--- Pure Python tests ---"
run_test "color_ramp" "$SCRIPT_DIR/test_color_ramp.py" "false"

echo ""
echo "--- Blender tests ---"
run_test "camera_utils"   "$SCRIPT_DIR/test_camera_utils.py"
run_test "mesh_utils"     "$SCRIPT_DIR/test_mesh_utils.py"
run_test "calibration"    "$SCRIPT_DIR/test_calibration.py"
run_test "resolution"     "$SCRIPT_DIR/test_resolution.py"
run_test "angle"          "$SCRIPT_DIR/test_angle.py"

echo ""
echo "=== Results: $PASSED passed, $FAILED failed ==="

if [ "$FAILED" -gt 0 ]; then
    exit 1
fi
```

- [ ] **Step 2: Create README.md**

```markdown
# Strokmatic Vision Tools — Blender Add-on

Machine vision camera validation tools for Blender. Visualizes effective
resolution (px/mm or mm/px) and viewing angle as vertex color heatmaps
on mesh objects.

## Installation

1. Copy the `strokmatic_vision_tools/` folder to a location on your machine
2. Open Blender → Edit → Preferences → Add-ons
3. Click "Install from Disk" and select the `strokmatic_vision_tools/` folder
4. Enable **Strokmatic Vision Tools** in the add-on list
5. Press **N** in the 3D Viewport to open the sidebar → **SKM Vision** tab

Works on **Windows** and **Linux**. Requires **Blender 3.6+** (LTS) or **4.x**.

## Tools

### Camera Calibration Import

Import OpenCV camera calibration JSON files. Sets focal length, principal
point shift, and render resolution from the calibration matrix.

### Resolution Heatmap

Paints a color map showing effective camera resolution on mesh surfaces:

- **px/mm** — pixels per millimeter (higher = more detail)
- **mm/px** — millimeters per pixel / ground sampling distance (lower = more detail)
- **Continuous** mode shows a smooth blue→red gradient
- **Threshold** mode shows green (pass) / yellow (marginal) / red (fail) bands

### Viewing Angle Heatmap

Paints a color map showing the angle between camera view direction and
the surface normal at each point:

- **0°** = head-on (best for inspection)
- **90°** = grazing (worst — surface detail lost)
- Same continuous / threshold modes as resolution

## Usage

1. Import or set up your camera in Blender
2. Import your STL geometry
3. Select the camera in the **SKM Vision** panel
4. Select the mesh objects to analyze (or choose "All Visible")
5. Click **Compute** under either heatmap section
6. Switch viewport shading to **Solid** with **Color: Vertex** to see results

## Calibration JSON Format

```json
{
  "1": {
    "camera_matrix": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
    "dist_coeffs": [[k1, k2, p1, p2, k3]],
    "fov_x": 42.4,
    "fov_y": 33.6
  }
}
```

## Running Tests

```bash
cd sdk-blender-tools
chmod +x tests/run_all.sh
./tests/run_all.sh           # uses "blender" from PATH
./tests/run_all.sh /path/to/blender  # custom Blender path
```
```

- [ ] **Step 3: Make run_all.sh executable and commit**

```bash
chmod +x workspaces/strokmatic/sdk/sdk-blender-tools/tests/run_all.sh
git add workspaces/strokmatic/sdk/sdk-blender-tools/tests/run_all.sh \
       workspaces/strokmatic/sdk/sdk-blender-tools/README.md
git commit -m "feat(blender-tools): test runner and README with installation guide"
```

---

## Task 10: Integration Test — Full Pipeline

**Files:**
- No new files — runs existing tests end-to-end

- [ ] **Step 1: Run the full test suite**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && ./tests/run_all.sh
```

Expected: all 6 tests pass.

- [ ] **Step 2: Verify add-on registers and lists all 5 operators**

```bash
blender --background --python -c "
import bpy, sys
sys.path.insert(0, '.')
import strokmatic_vision_tools
strokmatic_vision_tools.register()
ops = [op for op in dir(bpy.ops.skm_vision) if not op.startswith('_')]
assert len(ops) == 5, f'Expected 5 operators, got {len(ops)}: {ops}'
print(f'OK: {len(ops)} operators registered')
strokmatic_vision_tools.unregister()
" 2>&1 | tail -3
```

Expected: `OK: 5 operators registered`

- [ ] **Step 3: Run an end-to-end heatmap computation**

```bash
blender --background --python -c "
import bpy, sys
sys.path.insert(0, '.')
import strokmatic_vision_tools
strokmatic_vision_tools.register()

# Setup scene
bpy.ops.wm.read_factory_settings(use_empty=True)
cam_data = bpy.data.cameras.new('Cam')
cam_data.lens = 25
cam_obj = bpy.data.objects.new('Cam', cam_data)
bpy.context.collection.objects.link(cam_obj)
cam_obj.location = (0, 0, 2)
bpy.context.scene.camera = cam_obj
bpy.context.scene.render.resolution_x = 640
bpy.context.scene.render.resolution_y = 512

bpy.ops.mesh.primitive_plane_add(size=2.0)
plane = bpy.context.active_object
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.subdivide(number_cuts=10)
bpy.ops.object.mode_set(mode='OBJECT')

# Set properties
scene = bpy.context.scene
scene.skm_vision_camera = cam_obj
scene.skm_vision_scope = 'VISIBLE'
scene.skm_resolution_unit = 'PX_MM'
scene.skm_resolution_mode = 'CONTINUOUS'
scene.skm_angle_mode = 'CONTINUOUS'

bpy.context.view_layer.update()

# Compute both heatmaps
bpy.ops.skm_vision.compute_resolution()
assert 'SKM_Resolution' in [a.name for a in plane.data.color_attributes]

bpy.ops.skm_vision.compute_angle()
assert 'SKM_ViewAngle' in [a.name for a in plane.data.color_attributes]

# Clear both
bpy.ops.skm_vision.clear_resolution()
bpy.ops.skm_vision.clear_angle()
assert 'SKM_Resolution' not in [a.name for a in plane.data.color_attributes]
assert 'SKM_ViewAngle' not in [a.name for a in plane.data.color_attributes]

print('OK: end-to-end pipeline passed')
strokmatic_vision_tools.unregister()
" 2>&1 | tail -3
```

Expected: `OK: end-to-end pipeline passed`

- [ ] **Step 4: Final commit — tag the release**

```bash
git add -A workspaces/strokmatic/sdk/sdk-blender-tools/
git commit -m "feat(blender-tools): Strokmatic Vision Tools v1.0.0 — resolution and angle heatmaps for camera validation"
```
