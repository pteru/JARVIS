# Strokmatic Vision Tools — Blender Add-on Design Spec

**Date:** 2026-04-13
**Product:** VisionKing (primary), cross-product applicable
**Location:** `workspaces/strokmatic/sdk/sdk-blender-tools/`

## Problem Statement

Camera placement validation for machine vision setups (VisionKing Body) currently relies on manual inspection and intuition. There is no automated way to visualize:

1. **Effective resolution** (px/mm) — whether the camera resolves enough detail at every point on the inspected surface
2. **Viewing angle** — whether the camera views each surface point at an acceptable angle (grazing angles degrade image quality)

These checks are done mentally or via spreadsheet estimates. A visual tool directly in Blender — where the layout is already modeled — would make validation immediate and shareable.

## Current Workflow Context

- **Cameras:** Hikvision (HIK) industrial cameras, perspective/pinhole model
- **Geometry:** STEP files converted to STL in FreeCAD, then imported into Blender
- **Resolution:** All cameras in a given layout share the same pixel resolution (e.g., 640x512 from calibration). Blender enforces one render resolution per scene, which aligns with this.
- **Multi-camera switching:** NLA (Non-Linear Animation) with time markers. Each marker triggers a camera switch. Scrubbing to a frame activates the corresponding camera.
- **Layout visualization:** For external renders, cameras are replaced with 3D models + translucent FOV cones. This uses a separate file with a standard 35mm 1920x1080 camera.
- **Existing tooling:** `sdk-blender-tools/camera_calibration_importer.py` — standalone script that imports OpenCV calibration JSON (camera matrix, distortion coefficients) into Blender cameras. Written 2025-11-28.

## Solution

A Blender add-on package — **Strokmatic Vision Tools** — installed as a folder, providing three tools under a unified sidebar panel:

1. **Camera Calibration Importer** — existing script upgraded to a proper operator with UI
2. **Resolution Heatmap** — px/mm color map painted as vertex colors
3. **Viewing Angle Heatmap** — camera-to-surface-normal angle map painted as vertex colors

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Camera input | Read from Blender camera object (supports both manual setup and JSON import) | Decouples heatmap tools from calibration format |
| Target objects | "Selected Objects" / "All Visible" radio toggle | Simple, no collection management overhead |
| Visualization | Vertex colors | STL meshes have good density; no UV dependency; instant viewport feedback |
| Color mode | Continuous gradient + threshold bands (toggle) | Continuous for exploration, threshold for pass/fail validation |
| Resolution unit | User choice: px/mm or mm/px | px/mm is intuitive for "how many pixels cover 1mm"; mm/px is intuitive for "what's the smallest feature I can see" — both conventions are used in machine vision |
| Multi-camera | Single active camera per run | Fits NLA workflow; switch frame → switch camera → re-run |
| Occlusion check | Optional checkbox | ray_cast is expensive; skip for simple scenes |
| Platform | Windows + Linux (Blender 3.6 LTS / 4.x) | Colleague runs Windows; no external dependencies beyond bundled numpy |

## Architecture

```
sdk-blender-tools/
├── strokmatic_vision_tools/
│   ├── __init__.py              # bl_info, register/unregister, sub-module loading
│   ├── camera_utils.py          # Projection math, FOV checks
│   ├── color_ramp.py            # Gradient + threshold coloring, legend overlay
│   ├── mesh_utils.py            # Target object collection, vertex color layers, visibility
│   ├── ui_panel.py              # Sidebar panel layout (SKM Vision tab)
│   ├── calibration_importer.py  # Operator: import OpenCV JSON → Blender camera
│   ├── resolution_heatmap.py    # Operator: compute + paint px/mm map
│   └── angle_heatmap.py         # Operator: compute + paint angle map
├── camera_intrinsics.json       # Example calibration file (reference)
└── README.md                    # Installation + usage guide
```

The existing `camera_calibration_importer.py` is retired. Its logic moves into `calibration_importer.py` as a registered Blender operator.

## Module Specifications

### `__init__.py` — Add-on Entry Point

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
```

Registers all operators, properties (stored on `bpy.types.Scene`), and the UI panel. Sub-modules are imported and their `register()`/`unregister()` functions are called.

### `camera_utils.py` — Shared Projection Math

**Functions:**

- `world_to_pixel(scene, camera, point_3d) → (px_x, px_y)` — uses `bpy_extras.object_utils.world_to_camera_view()` scaled by `scene.render.resolution_x/y`.
- `pixel_per_mm_at_point(scene, camera, point_3d, tangent_u, tangent_v) → float` — finite-difference method. Projects `point_3d` and `point_3d + tangent * 1mm` for both tangent directions. Returns the minimum px/mm (worst axis governs inspection quality).
- `view_angle_at_point(camera, point_3d, normal) → float` — angle in degrees between `normalize(camera.location - point_3d)` and `normal`. Range: 0° (head-on) to 90° (grazing).
- `is_point_in_fov(scene, camera, point_3d) → bool` — checks normalized projection falls within [0, 1].
- `get_camera_info(scene, camera) → dict` — returns focal_length_mm, fov_h, fov_v, resolution_x, resolution_y for display in UI.

### `mesh_utils.py` — Geometry Helpers

**Functions:**

- `get_target_objects(context, mode) → list[Object]` — `mode="SELECTED"`: selected mesh objects. `mode="VISIBLE"`: all visible mesh objects in the scene.
- `get_or_create_color_layer(mesh, name) → MeshLoopColorLayer` — creates or clears a named vertex color attribute. Uses `mesh.color_attributes` API (Blender 3.2+).
- `check_visibility(depsgraph, origin, direction, max_dist) → (hit, location, normal, face_index, object)` — wraps `bpy.context.scene.ray_cast()`. Casts from camera toward the point; returns whether the first hit matches the expected object.
- `get_vertex_tangents(mesh, vertex_index) → (tangent_u, tangent_v)` — computes two orthogonal tangent vectors from adjacent face normals for the finite-difference resolution calculation.
- `set_vertex_colors_bulk(mesh, layer_name, colors_array)` — numpy-accelerated `foreach_set` for vertex color assignment.

### `color_ramp.py` — Visualization

**Color Scales:**

- **Continuous mode:** Blue (low) → Cyan → Green → Yellow → Red (high). Computed via HSV interpolation.
- **Threshold mode:** Three bands:
  - Green: value ≥ threshold + margin (pass)
  - Yellow: threshold ≤ value < threshold + margin (marginal)
  - Red: value < threshold (fail)
- **Not visible / out of FOV:** Gray (0.3, 0.3, 0.3)

**Functions:**

- `value_to_color_continuous(value, min_val, max_val) → (r, g, b, a)`
- `value_to_color_threshold(value, threshold, margin) → (r, g, b, a)`
- `draw_legend_callback(self, context)` — GPU overlay via `gpu` module + `blf` for text. Draws a vertical color bar with min/max/unit labels in the viewport corner. Registered via `SpaceView3D.draw_handler_add`.
- `remove_legend()` — removes the draw handler.

### `ui_panel.py` — Sidebar Panel

Panel class: `SKM_PT_VisionTools`, located in `VIEW_3D` space, `UI` region, `SKM Vision` tab.

**Scene Properties** (registered on `bpy.types.Scene`):

```
skm_vision_camera        : PointerProperty(type=bpy.types.Object, poll=camera_poll)
skm_vision_scope         : EnumProperty(items=[("SELECTED", ...), ("VISIBLE", ...)])
skm_resolution_unit      : EnumProperty(items=[("PX_MM", "px/mm", ...), ("MM_PX", "mm/px", ...)])
skm_resolution_mode      : EnumProperty(items=[("CONTINUOUS", ...), ("THRESHOLD", ...)])
skm_resolution_threshold : FloatProperty(default=5.0, min=0.1, description="Threshold in selected unit")
skm_resolution_margin    : FloatProperty(default=1.0, min=0.0, description="Margin band width in selected unit")
skm_angle_mode           : EnumProperty(items=[("CONTINUOUS", ...), ("THRESHOLD", ...)])
skm_angle_threshold      : FloatProperty(default=60.0, min=1.0, max=89.0, description="Max angle °")
skm_angle_margin         : FloatProperty(default=10.0, min=0.0, description="Margin band °")
skm_check_occlusion      : BoolProperty(default=False, description="Ray-cast occlusion check")
```

**Layout** (three collapsible boxes):

1. **Camera Setup** — camera selector dropdown, "Import Calibration" button (file browser), read-only info (resolution, FOV, focal length)
2. **Resolution Heatmap** — unit toggle (px/mm or mm/px), scope toggle, mode toggle, threshold/margin inputs (shown when mode=THRESHOLD), "Compute" and "Clear" buttons
3. **Viewing Angle Heatmap** — same layout pattern as resolution, with angle-specific inputs
4. **Footer** — "Export Screenshot" button

### `calibration_importer.py` — Camera Calibration Import

Operator: `SKM_OT_ImportCalibration` (`skm_vision.import_calibration`)

- Invokes Blender's file browser filtered to `.json`
- Parses OpenCV format: `camera_matrix` (3x3), `dist_coeffs`, optional `fov_x`/`fov_y`
- For each camera entry in the JSON:
  - Creates a Blender camera object (`Camera_{id}`)
  - Sets focal length: `focal_mm = fx * sensor_width / image_width`
  - Sets lens shift from principal point offset
  - Configures render resolution from matrix
  - Sets up compositor distortion node (first camera only — Blender limitation)
- Reports results via `self.report({'INFO'}, ...)`

Logic ported from existing `camera_calibration_importer.py` with these fixes:
- `from mathlib import Vector` → `from mathutils import Vector` (typo in original)
- Hardcoded JSON path → file browser operator
- Print statements → `self.report()` + operator log

### `resolution_heatmap.py` — Effective Resolution Map

Operator: `SKM_OT_ComputeResolution` (`skm_vision.compute_resolution`)

**Algorithm:**

```
1. camera = scene.skm_vision_camera
2. res_x, res_y = scene.render.resolution_x, resolution_y
3. depsgraph = context.evaluated_depsgraph_get()
4. targets = get_target_objects(context, scene.skm_vision_scope)
5. wm.progress_begin(0, total_vertex_count)
6. For each object in targets:
   a. mesh = object.evaluated_get(depsgraph).to_mesh()
   b. world_matrix = object.matrix_world
   c. layer = get_or_create_color_layer(mesh, "SKM_Resolution")
   d. Bulk-read vertex positions via numpy foreach_get
   e. Transform all positions to world space (matrix multiply)
   f. For each loop (face-vertex pair):
      - vertex_world = world_positions[loop.vertex_index]
      - If not is_point_in_fov(): color = GRAY; continue
      - If skm_check_occlusion and not visible: color = GRAY; continue
      - tangent_u, tangent_v = get_vertex_tangents(mesh, loop.vertex_index)
      - px_mm = pixel_per_mm_at_point(scene, camera, vertex_world, tangent_u, tangent_v)
      - value = px_mm if unit=="PX_MM" else 1.0/px_mm  (mm/px is the reciprocal)
      - color = value_to_color_{mode}(value, ...)
   g. Bulk-write colors via numpy foreach_set
   h. object.data.update()
7. Set viewport shading to show vertex colors (SOLID mode, color=VERTEX)
8. Register legend overlay
9. wm.progress_end()
```

**Clear operator:** `SKM_OT_ClearResolution` — removes the `SKM_Resolution` color attribute from all target objects and removes the legend overlay.

### `angle_heatmap.py` — Viewing Angle Map

Operator: `SKM_OT_ComputeAngle` (`skm_vision.compute_angle`)

**Algorithm:**

```
1. camera = scene.skm_vision_camera
2. cam_pos = camera.matrix_world.translation
3. For each object in targets:
   a. layer = get_or_create_color_layer(mesh, "SKM_ViewAngle")
   b. For each loop:
      - vertex_world = world_positions[loop.vertex_index]
      - normal_world = world_normals[loop.vertex_index]  (transformed by inverse-transpose)
      - view_dir = normalize(cam_pos - vertex_world)
      - angle = acos(clamp(dot(view_dir, normal_world), -1, 1)) * 180/pi
      - color = value_to_color_{mode}(angle, ...)
   c. Bulk-write colors
4. Legend overlay (0° = head-on/best, 90° = grazing/worst)
```

**Color direction notes:**
- **Resolution (px/mm):** Higher is better — more pixels per mm means finer detail. Continuous gradient: blue (low/bad) → red (high/good). Threshold: green ≥ threshold.
- **Resolution (mm/px):** Lower is better — smaller ground sampling distance. Continuous gradient is inverted: blue (high/bad) → red (low/good). Threshold: green ≤ threshold.
- **Angle:** Low angle (0°) is good (head-on), high angle (90°) is bad (grazing). Continuous gradient: green (0°) → yellow → red (90°). Threshold: green ≤ threshold.

## Performance

| Mesh size | Approach | Expected time |
|-----------|----------|---------------|
| < 50k vertices | Pure Python loop | < 2 seconds |
| 50k–500k vertices | numpy bulk read/write, Python per-vertex math | 2–15 seconds |
| > 500k vertices | numpy bulk + optional occlusion skip | 15–60 seconds |

Occlusion ray_cast is the dominant cost. With occlusion disabled, computation is projection math only (~10x faster).

Progress bar (`wm.progress_update`) prevents Blender from appearing frozen.

## Blender Compatibility

- **Minimum:** Blender 3.6 LTS (last LTS with broad adoption)
- **Tested:** Blender 4.0, 4.1, 4.2
- **API differences:** `mesh.color_attributes` (3.2+) vs legacy `mesh.vertex_colors`. We target `color_attributes` only — Blender 3.6+ is safe.
- **numpy:** Bundled with Blender since 2.8. No external install needed.
- **Platform:** Pure Python + numpy. No compiled extensions. Works on Windows and Linux identically.

## Installation

1. Download or clone the `strokmatic_vision_tools/` folder
2. Blender → Edit → Preferences → Add-ons → Install from Disk → select the folder (or the `__init__.py` inside it)
3. Enable "Strokmatic Vision Tools" in the add-on list
4. The "SKM Vision" tab appears in the 3D Viewport sidebar (press N)

## Out of Scope (Future Work)

- Multi-camera comparison / composite best-of views
- Lens distortion compensation in heatmap projections
- Automatic camera placement optimization
- FOV cone visualization (translucent 3D cones for layout renders)
- Export to CSV/JSON data reports
- Depth-of-field / blur analysis
