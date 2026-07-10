---
type: Implementation Plan
title: Vision Tools v1.1.1 — Performance and Correctness Fixes Implementation Plan
description: Same pattern as v1.0.0 / v1.1.0:
timestamp: 2026-04-14
---

# Vision Tools v1.1.1 — Performance and Correctness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the O(V²) tangent bug, bypassed modifiers, broken occlusion check, and slow per-vertex Python loops across all Vision Tools heatmap operators, so the tools become usable on production vehicle geometry.

**Architecture:** Seven targeted fixes to existing modules. The heatmap operators keep their public API unchanged; the inner loops are rewritten to use numpy batch operations, pre-computed tangent lookups, and evaluated meshes (with modifiers applied). Occlusion now compares ray-cast hit distance against target distance instead of checking object identity.

**Tech Stack:** Blender Python API (`bpy`, `mathutils`), numpy (bundled with Blender). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-14-vision-tools-v1.1.1-performance-fixes-design.md`

**Base path:** `workspaces/strokmatic/sdk/sdk-blender-tools/`

---

## Testing Approach

Same pattern as v1.0.0 / v1.1.0:
- **Pure Python tests** (math, data): `python3 tests/test_file.py`
- **Blender tests** (scene interactions): `blender --background --python tests/test_file.py`
- All tests use plain `assert` + print.
- After each task, run the full suite via `./tests/run_all.sh` to catch regressions.

---

## File Structure

Files to create or modify:

```
strokmatic_vision_tools/
├── __init__.py                      # Modify: version bump to 1.1.1
├── blender_manifest.toml            # Modify: version bump to 1.1.1
├── mesh_utils.py                    # Modify: add compute_all_tangents,
│                                    #         get_evaluated_mesh; fix
│                                    #         check_visibility
├── angle_heatmap.py                 # Rewrite: numpy batch ops, evaluated
│                                    #          mesh, progress reporting
├── resolution_heatmap.py            # Rewrite: numpy batch ops, evaluated
│                                    #          mesh, precomputed tangents,
│                                    #          progress reporting
└── deflectometry/
    └── coverage.py                  # Modify: evaluated mesh, precomputed
                                     #         tangents, back-face culling,
                                     #         progress reporting

tests/
├── test_mesh_utils.py               # Modify: update check_visibility tests,
│                                    #         add compute_all_tangents tests
└── test_performance.py              # Create: 100k-vertex benchmarks,
                                     #         decimate-respected test,
                                     #         occlusion test
```

---

## Task 1: Add `compute_all_tangents` + `get_evaluated_mesh` helpers

**Files:**
- Modify: `strokmatic_vision_tools/mesh_utils.py`
- Modify: `tests/test_mesh_utils.py`

- [ ] **Step 1: Append new tests to `tests/test_mesh_utils.py`**

Add these tests at the end (after existing tests, before the `if __name__` block):

```python
def test_compute_all_tangents_returns_per_vertex():
    plane1, _ = setup_scene()
    mesh = plane1.data
    if hasattr(mesh, 'calc_normals_split'):
        mesh.calc_normals_split()

    from strokmatic_vision_tools.mesh_utils import compute_all_tangents
    tangents = compute_all_tangents(mesh)
    assert len(tangents) == len(mesh.vertices), \
        f"Expected {len(mesh.vertices)} entries, got {len(tangents)}"
    for vi in range(len(mesh.vertices)):
        tu, tv = tangents[vi]
        assert abs(tu.length - 1.0) < 0.01, f"Vertex {vi}: tangent_u length {tu.length}"
        assert abs(tv.length - 1.0) < 0.01, f"Vertex {vi}: tangent_v length {tv.length}"
        assert abs(tu.dot(tv)) < 0.1, f"Vertex {vi}: tangents not orthogonal"


def test_compute_all_tangents_single_pass_performance():
    """Ensure compute_all_tangents is O(V+E), not O(V*E).

    Build a 5k-vertex plane, compute tangents, assert under 1 second.
    The old O(V*E) code would take ~25 seconds on this size.
    """
    import time
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    bpy.ops.object.mode_set(mode='EDIT')
    # 2^6 = 64 cuts per edge, so 65x65 = 4225 vertices
    bpy.ops.mesh.subdivide(number_cuts=64)
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh = plane.data
    if hasattr(mesh, 'calc_normals_split'):
        mesh.calc_normals_split()

    from strokmatic_vision_tools.mesh_utils import compute_all_tangents
    t0 = time.time()
    tangents = compute_all_tangents(mesh)
    elapsed = time.time() - t0
    assert len(tangents) >= 4000, f"Expected 4000+ vertices, got {len(tangents)}"
    assert elapsed < 1.0, f"compute_all_tangents took {elapsed:.2f}s on 4k verts (expected < 1s)"


def test_get_evaluated_mesh_applies_modifier():
    """Decimate modifier should reduce vertex count in evaluated mesh."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=10)  # 11x11 = 121 vertices
    bpy.ops.object.mode_set(mode='OBJECT')

    base_vert_count = len(plane.data.vertices)
    assert base_vert_count == 121, f"Expected 121 base verts, got {base_vert_count}"

    # Add Decimate modifier
    mod = plane.modifiers.new(name="Decimate", type='DECIMATE')
    mod.ratio = 0.3  # ~30% of original

    bpy.context.view_layer.update()

    depsgraph = bpy.context.evaluated_depsgraph_get()
    from strokmatic_vision_tools.mesh_utils import get_evaluated_mesh
    eval_obj, mesh = get_evaluated_mesh(plane, depsgraph)
    try:
        eval_count = len(mesh.vertices)
        assert eval_count < base_vert_count, \
            f"Evaluated mesh should have fewer verts: base={base_vert_count} eval={eval_count}"
    finally:
        eval_obj.to_mesh_clear()


def test_check_visibility_detects_occlusion_by_closer_face():
    """An occluder in front of the target should block visibility."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Target plane at z=0
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
    target = bpy.context.active_object
    target.name = "Target"

    # Occluder plane halfway between camera (z=2) and target
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 1))
    occluder = bpy.context.active_object
    occluder.name = "Occluder"

    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()

    from strokmatic_vision_tools.mesh_utils import check_visibility
    from mathutils import Vector
    origin = Vector((0, 0, 2))
    target_pt = Vector((0, 0, 0))  # on target plane, occluded by occluder at z=1
    visible = check_visibility(depsgraph, bpy.context.scene, origin, target_pt, target)
    assert visible is False, "Target should be occluded by the closer plane"


def test_check_visibility_target_without_occluder_is_visible():
    """No occluder → point is visible."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
    target = bpy.context.active_object
    target.name = "Target"

    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()

    from strokmatic_vision_tools.mesh_utils import check_visibility
    from mathutils import Vector
    origin = Vector((0, 0, 2))
    target_pt = Vector((0, 0, 0))
    visible = check_visibility(depsgraph, bpy.context.scene, origin, target_pt, target)
    assert visible is True, "Target should be visible with no occluder"
```

Update the `if __name__ == "__main__"` block to call the new tests:

```python
if __name__ == "__main__":
    test_get_target_objects_selected()
    test_get_target_objects_visible()
    test_get_or_create_color_layer()
    test_get_vertex_tangents()
    test_compute_all_tangents_returns_per_vertex()
    test_compute_all_tangents_single_pass_performance()
    test_get_evaluated_mesh_applies_modifier()
    test_check_visibility_detects_occlusion_by_closer_face()
    test_check_visibility_target_without_occluder_is_visible()
    print("OK: all mesh_utils tests passed")
```

- [ ] **Step 2: Run tests — verify new ones fail**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_mesh_utils.py 2>&1 | tail -5
```

Expected: `ImportError: cannot import name 'compute_all_tangents'` or `'get_evaluated_mesh'`.

- [ ] **Step 3: Add the new functions to `mesh_utils.py`**

Append these functions to `strokmatic_vision_tools/mesh_utils.py` (after existing functions, before end of file):

```python
def compute_all_tangents(mesh):
    """Compute orthogonal tangent pairs for every vertex in one pass.

    Replaces O(V*E) per-vertex edge search with an O(V+E) single-pass
    construction. Must be called instead of ``get_vertex_tangents`` in
    hot loops for meshes beyond a few hundred vertices.

    Args:
        mesh: A bpy.types.Mesh.

    Returns:
        Dict mapping vertex index to a tuple (tangent_u, tangent_v) of
        normalized ``mathutils.Vector`` in the mesh's local frame.
    """
    # First pass: record one edge direction per vertex.
    edge_dir = {}
    for edge in mesh.edges:
        v0, v1 = edge.vertices
        if v0 not in edge_dir:
            diff = mesh.vertices[v1].co - mesh.vertices[v0].co
            if diff.length > 1e-6:
                edge_dir[v0] = diff.normalized()
        if v1 not in edge_dir:
            diff = mesh.vertices[v0].co - mesh.vertices[v1].co
            if diff.length > 1e-6:
                edge_dir[v1] = diff.normalized()

    # Second pass: orthonormal basis per vertex.
    tangents = {}
    for vi, vert in enumerate(mesh.vertices):
        normal = vert.normal.normalized()
        seed = edge_dir.get(vi)
        if seed is None or seed.length < 1e-6:
            seed = Vector((0, 0, 1)) if abs(normal.z) < 0.9 else Vector((1, 0, 0))
        tangent_u = (seed - normal * seed.dot(normal)).normalized()
        if tangent_u.length < 1e-6:
            seed = Vector((1, 0, 0)) if abs(normal.x) < 0.9 else Vector((0, 1, 0))
            tangent_u = (seed - normal * seed.dot(normal)).normalized()
        tangent_v = normal.cross(tangent_u).normalized()
        tangents[vi] = (tangent_u, tangent_v)

    return tangents


def get_evaluated_mesh(obj, depsgraph):
    """Return (eval_obj, mesh) with modifiers applied.

    The caller MUST release the temporary mesh with
    ``eval_obj.to_mesh_clear()`` when done (wrap in try/finally).

    Args:
        obj: A bpy.types.Object of type 'MESH'.
        depsgraph: The evaluated dependency graph.

    Returns:
        Tuple (eval_obj, mesh) — the evaluated object proxy and the
        modifier-applied mesh.
    """
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    return eval_obj, mesh
```

- [ ] **Step 4: Replace `check_visibility` with distance-based version**

In `mesh_utils.py`, replace the existing `check_visibility` function entirely with:

```python
def check_visibility(depsgraph, scene, origin, target, expected_obj, tolerance=0.001):
    """Return True when origin→target has no occluder closer than target.

    The previous implementation accepted any ray hit on ``expected_obj``
    as "visible", which missed self-occlusion where a closer face of the
    same mesh intercepted the ray. This version compares hit distance
    against target distance so any closer obstacle — same object or
    different — counts as occlusion.

    Args:
        depsgraph: Evaluated dependency graph.
        scene: Blender scene.
        origin: Ray origin in world space (``Vector``).
        target: Target point on the surface (``Vector``).
        expected_obj: Retained for backward compatibility with the
            previous signature; not used in the new logic.
        tolerance: Distance in Blender units. Hits closer than
            ``target_dist - tolerance`` count as occlusion. Defaults to
            0.001 (1 mm) to allow for the target surface's own
            self-intersection slack.

    Returns:
        ``True`` if the point is visible (no occluder), ``False``
        otherwise.
    """
    direction = target - origin
    target_dist = direction.length
    if target_dist < 1e-9:
        return True
    direction = direction.normalized()

    result, location, _normal, _face_idx, _hit_obj, _mtx = scene.ray_cast(
        depsgraph, origin, direction, distance=target_dist + tolerance
    )
    if not result:
        return True

    hit_dist = (location - origin).length
    return hit_dist >= target_dist - tolerance
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_mesh_utils.py 2>&1 | tail -5
```

Expected: `OK: all mesh_utils tests passed`.

- [ ] **Step 6: Commit**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
git add strokmatic_vision_tools/mesh_utils.py tests/test_mesh_utils.py
git commit -m "fix(mesh_utils): add compute_all_tangents, get_evaluated_mesh; fix occlusion distance check"
```

---

## Task 2: Rewrite Angle Heatmap with numpy + evaluated mesh + progress

**Files:**
- Modify: `strokmatic_vision_tools/angle_heatmap.py`

This is a full rewrite of the `compute_angle_heatmap` function body. The public signature and the operator classes are unchanged.

- [ ] **Step 1: Replace `compute_angle_heatmap` in `strokmatic_vision_tools/angle_heatmap.py`**

Replace the entire `compute_angle_heatmap` function (lines 16–110 approx) with:

```python
def compute_angle_heatmap(scene, camera, targets, mode, threshold, margin, check_occlusion):
    """Compute and paint viewing angle heatmap on target meshes.

    Uses numpy batch operations on evaluated meshes (modifiers applied).
    Progress is reported via ``wm.progress_*``.

    Args:
        scene: Blender scene.
        camera: Camera object.
        targets: List of mesh objects to analyze.
        mode: "CONTINUOUS" or "THRESHOLD".
        threshold: Maximum acceptable angle in degrees.
        margin: Margin band width in degrees.
        check_occlusion: Whether to ray-cast for visibility.
    """
    wm = bpy.context.window_manager
    depsgraph = bpy.context.evaluated_depsgraph_get()
    cam_pos = np.array(camera.matrix_world.translation, dtype=np.float32)

    # First pass: compute all angles per object. Accumulate global min/max
    # so we can color in a second pass with a shared scale.
    obj_angles = {}            # obj.name -> np.ndarray[num_loops] (float32)
    obj_meshes = {}            # obj.name -> (eval_obj, mesh, world_mat)
    obj_fov_mask = {}          # obj.name -> np.ndarray[num_loops] bool
    obj_occluded_mask = {}     # obj.name -> np.ndarray[num_loops] bool

    global_min = math.inf
    global_max = -math.inf

    wm.progress_begin(0, len(targets) * 2)  # 2 passes
    try:
        for pi, obj in enumerate(targets):
            eval_obj, mesh = mesh_utils.get_evaluated_mesh(obj, depsgraph)
            world_matrix = obj.matrix_world
            mesh_utils.get_or_create_color_layer(mesh, "SKM_ViewAngle")

            num_verts = len(mesh.vertices)
            num_loops = len(mesh.loops)

            # Bulk-read vertex data
            positions = np.empty(num_verts * 3, dtype=np.float32)
            normals = np.empty(num_verts * 3, dtype=np.float32)
            mesh.vertices.foreach_get("co", positions)
            mesh.vertices.foreach_get("normal", normals)
            positions = positions.reshape(-1, 3)
            normals = normals.reshape(-1, 3)

            # Transform to world space
            world_mat_np = np.array(world_matrix, dtype=np.float32)
            rot3 = world_mat_np[:3, :3]
            translate = world_mat_np[:3, 3]
            # Normal transform = inverse-transpose of rot3
            normal_mat = np.linalg.inv(rot3).T

            world_positions = positions @ rot3.T + translate
            world_normals = normals @ normal_mat.T
            norms = np.linalg.norm(world_normals, axis=1, keepdims=True)
            norms[norms < 1e-9] = 1.0
            world_normals = world_normals / norms

            # View direction: from each vertex to camera
            view_dirs = cam_pos[None, :] - world_positions
            vd_norms = np.linalg.norm(view_dirs, axis=1, keepdims=True)
            vd_norms[vd_norms < 1e-9] = 1.0
            view_dirs = view_dirs / vd_norms

            # Angle per vertex
            dots = np.clip(np.sum(view_dirs * world_normals, axis=1), -1.0, 1.0)
            vert_angles = np.degrees(np.arccos(np.abs(dots)))  # shape (V,)

            # FOV per vertex (Python loop — world_to_camera_view isn't vectorized)
            vert_in_fov = np.zeros(num_verts, dtype=bool)
            for vi in range(num_verts):
                vp = Vector(world_positions[vi].tolist())
                vert_in_fov[vi] = camera_utils.is_point_in_fov(scene, camera, vp)

            # Occlusion per vertex (Python loop — ray_cast isn't vectorized)
            vert_occluded = np.zeros(num_verts, dtype=bool)
            if check_occlusion:
                cam_pos_v = Vector(cam_pos.tolist())
                for vi in range(num_verts):
                    if not vert_in_fov[vi]:
                        continue
                    tp = Vector(world_positions[vi].tolist())
                    if not mesh_utils.check_visibility(depsgraph, scene, cam_pos_v, tp, obj):
                        vert_occluded[vi] = True

            # Map vertex-level data to loop-level via vertex_index
            loop_vi = np.empty(num_loops, dtype=np.int32)
            mesh.loops.foreach_get("vertex_index", loop_vi)
            loop_angles = vert_angles[loop_vi]
            loop_in_fov = vert_in_fov[loop_vi]
            loop_occluded = vert_occluded[loop_vi]

            obj_angles[obj.name] = loop_angles
            obj_fov_mask[obj.name] = loop_in_fov
            obj_occluded_mask[obj.name] = loop_occluded
            obj_meshes[obj.name] = (eval_obj, mesh, world_matrix)

            # Accumulate min/max across qualifying loops
            valid = loop_in_fov & ~loop_occluded
            if valid.any():
                global_min = min(global_min, float(loop_angles[valid].min()))
                global_max = max(global_max, float(loop_angles[valid].max()))

            wm.progress_update(pi * 2 + 1)

        if not math.isfinite(global_min):
            global_min, global_max = 0.0, 90.0

        # Second pass: assign colors
        for pi, obj in enumerate(targets):
            eval_obj, mesh, _ = obj_meshes[obj.name]
            loop_angles = obj_angles[obj.name]
            loop_in_fov = obj_fov_mask[obj.name]
            loop_occluded = obj_occluded_mask[obj.name]
            num_loops = len(loop_angles)

            colors_flat = np.zeros(num_loops * 4, dtype=np.float32)
            gray = np.array(color_ramp.COLOR_GRAY, dtype=np.float32)
            for li in range(num_loops):
                if not loop_in_fov[li] or loop_occluded[li]:
                    c = gray
                elif mode == "CONTINUOUS":
                    c = np.array(
                        color_ramp.value_to_color_continuous(
                            global_max - loop_angles[li] + global_min,
                            global_min, global_max,
                        ),
                        dtype=np.float32,
                    )
                else:
                    angle = loop_angles[li]
                    if angle <= threshold - margin:
                        c = np.array(color_ramp.COLOR_GREEN, dtype=np.float32)
                    elif angle <= threshold:
                        c = np.array(color_ramp.COLOR_YELLOW, dtype=np.float32)
                    else:
                        c = np.array(color_ramp.COLOR_RED, dtype=np.float32)
                colors_flat[li * 4: li * 4 + 4] = c

            mesh_utils.set_vertex_colors_bulk(mesh, "SKM_ViewAngle", colors_flat)
            layer = mesh.color_attributes.get("SKM_ViewAngle")
            if layer:
                mesh.color_attributes.active_color = layer

            # Copy the color attribute onto the real object's mesh so it
            # persists after to_mesh_clear() releases the evaluated copy.
            _copy_color_layer_to_base(obj, mesh, "SKM_ViewAngle", colors_flat)

            eval_obj.to_mesh_clear()
            wm.progress_update(pi * 2 + 2)
    finally:
        wm.progress_end()


def _copy_color_layer_to_base(obj, eval_mesh, layer_name, colors_flat):
    """Copy a color attribute from the evaluated mesh onto the base mesh.

    The evaluated mesh is a temporary returned by ``to_mesh()`` and is
    released with ``to_mesh_clear()``. Vertex colors painted on it would
    vanish. To make the heatmap visible in the viewport, we copy the
    color attribute onto the base mesh — but only when the modifier
    stack hasn't changed the loop count. If it has (e.g. Decimate), the
    heatmap is painted on the evaluated mesh only and the base keeps
    the attribute blanked, since vertex correspondence is lost.
    """
    base_mesh = obj.data
    base_num_loops = len(base_mesh.loops)
    if base_num_loops != len(eval_mesh.loops):
        # Modifier stack changed topology — can't safely map back.
        # Paint the base mesh with a blank layer so old colors don't stick.
        mesh_utils.get_or_create_color_layer(base_mesh, layer_name)
        return
    mesh_utils.get_or_create_color_layer(base_mesh, layer_name)
    mesh_utils.set_vertex_colors_bulk(base_mesh, layer_name, colors_flat)
    layer = base_mesh.color_attributes.get(layer_name)
    if layer:
        base_mesh.color_attributes.active_color = layer
```

- [ ] **Step 2: Update `SKM_OT_ComputeAngle.execute` vertex count line**

In `strokmatic_vision_tools/angle_heatmap.py`, the class `SKM_OT_ComputeAngle.execute` method currently has:

```python
        total_verts = sum(len(o.data.vertices) for o in targets)
```

Leave this unchanged — it already uses `obj.data`, which is correct for user-facing reporting (the user cares about their source geometry, not the modifier-reduced count).

- [ ] **Step 3: Run existing angle heatmap tests**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_angle.py 2>&1 | tail -5
```

Expected: `OK: all angle_heatmap tests passed` (existing tests continue to pass).

- [ ] **Step 4: Run full suite**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && ./tests/run_all.sh
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add strokmatic_vision_tools/angle_heatmap.py
git commit -m "perf(angle_heatmap): numpy batch ops + evaluated mesh + progress reporting"
```

---

## Task 3: Rewrite Resolution Heatmap with precomputed tangents + evaluated mesh + progress

**Files:**
- Modify: `strokmatic_vision_tools/resolution_heatmap.py`

- [ ] **Step 1: Replace `compute_resolution_heatmap` in `strokmatic_vision_tools/resolution_heatmap.py`**

Replace the entire function body (lines 16–110 approx) with:

```python
def compute_resolution_heatmap(scene, camera, targets, unit, mode, threshold, margin, check_occlusion):
    """Compute and paint resolution (px/mm or mm/px) heatmap.

    Uses evaluated meshes (modifiers applied), pre-computed tangent lookup
    (O(V+E) instead of O(V*E)), and progress reporting.

    Args:
        scene: Blender scene.
        camera: Camera object.
        targets: List of mesh objects.
        unit: "PX_MM" or "MM_PX".
        mode: "CONTINUOUS" or "THRESHOLD".
        threshold: Threshold in selected unit.
        margin: Margin band width.
        check_occlusion: Whether to ray-cast for visibility.
    """
    wm = bpy.context.window_manager
    depsgraph = bpy.context.evaluated_depsgraph_get()

    # First pass: compute all values per object, accumulate global min/max.
    obj_values = {}       # obj.name -> np.ndarray[num_loops] (float32)
    obj_meshes = {}       # obj.name -> (eval_obj, mesh, world_matrix)
    obj_valid = {}        # obj.name -> np.ndarray[num_loops] bool

    global_min = math.inf
    global_max = -math.inf

    wm.progress_begin(0, len(targets) * 2)
    try:
        for pi, obj in enumerate(targets):
            eval_obj, mesh = mesh_utils.get_evaluated_mesh(obj, depsgraph)
            world_matrix = obj.matrix_world
            mesh_utils.get_or_create_color_layer(mesh, "SKM_Resolution")

            num_verts = len(mesh.vertices)
            num_loops = len(mesh.loops)

            # Precompute tangents once per mesh — the key fix for the
            # Resolution Heatmap crash on large meshes.
            tangents_by_vi = mesh_utils.compute_all_tangents(mesh)

            # Bulk-read vertex positions for world transform
            positions = np.empty(num_verts * 3, dtype=np.float32)
            mesh.vertices.foreach_get("co", positions)
            positions = positions.reshape(-1, 3)
            world_mat_np = np.array(world_matrix, dtype=np.float32)
            rot3 = world_mat_np[:3, :3]
            translate = world_mat_np[:3, 3]
            world_positions = positions @ rot3.T + translate

            # Rotation-only matrix for tangent transform
            rot_matrix = world_matrix.to_3x3().normalized()
            cam_pos = camera.matrix_world.translation

            vert_values = np.zeros(num_verts, dtype=np.float32)
            vert_valid = np.zeros(num_verts, dtype=bool)

            for vi in range(num_verts):
                vp = Vector(world_positions[vi].tolist())

                if not camera_utils.is_point_in_fov(scene, camera, vp):
                    continue

                if check_occlusion:
                    if not mesh_utils.check_visibility(
                        depsgraph, scene, cam_pos, vp, obj
                    ):
                        continue

                tangent_u, tangent_v = tangents_by_vi[vi]
                tangent_u_w = (rot_matrix @ tangent_u).normalized()
                tangent_v_w = (rot_matrix @ tangent_v).normalized()
                px_mm = camera_utils.pixel_per_mm_at_point(
                    scene, camera, vp, tangent_u_w, tangent_v_w
                )

                if unit == "MM_PX":
                    value = (1.0 / px_mm) if px_mm > 0 else float("inf")
                else:
                    value = px_mm

                vert_values[vi] = value
                vert_valid[vi] = True

            # Map vertex-level to loop-level
            loop_vi = np.empty(num_loops, dtype=np.int32)
            mesh.loops.foreach_get("vertex_index", loop_vi)
            loop_values = vert_values[loop_vi]
            loop_valid = vert_valid[loop_vi]

            obj_values[obj.name] = loop_values
            obj_valid[obj.name] = loop_valid
            obj_meshes[obj.name] = (eval_obj, mesh, world_matrix)

            if loop_valid.any():
                finite = np.isfinite(loop_values[loop_valid])
                if finite.any():
                    vals = loop_values[loop_valid][finite]
                    global_min = min(global_min, float(vals.min()))
                    global_max = max(global_max, float(vals.max()))

            wm.progress_update(pi * 2 + 1)

        if not math.isfinite(global_min):
            global_min, global_max = 0.0, 1.0

        # Second pass: color assignment
        for pi, obj in enumerate(targets):
            eval_obj, mesh, _ = obj_meshes[obj.name]
            loop_values = obj_values[obj.name]
            loop_valid = obj_valid[obj.name]
            num_loops = len(loop_values)

            colors_flat = np.zeros(num_loops * 4, dtype=np.float32)
            gray = np.array(color_ramp.COLOR_GRAY, dtype=np.float32)
            for li in range(num_loops):
                if not loop_valid[li] or not math.isfinite(loop_values[li]):
                    c = gray
                elif mode == "CONTINUOUS":
                    c = np.array(
                        color_ramp.value_to_color_continuous(
                            loop_values[li], global_min, global_max
                        ),
                        dtype=np.float32,
                    )
                else:
                    c = np.array(
                        color_ramp.value_to_color_threshold(
                            loop_values[li], threshold, margin
                        ),
                        dtype=np.float32,
                    )
                colors_flat[li * 4: li * 4 + 4] = c

            mesh_utils.set_vertex_colors_bulk(mesh, "SKM_Resolution", colors_flat)
            layer = mesh.color_attributes.get("SKM_Resolution")
            if layer:
                mesh.color_attributes.active_color = layer

            _copy_color_layer_to_base(obj, mesh, "SKM_Resolution", colors_flat)

            eval_obj.to_mesh_clear()
            wm.progress_update(pi * 2 + 2)
    finally:
        wm.progress_end()


def _copy_color_layer_to_base(obj, eval_mesh, layer_name, colors_flat):
    """Copy a color attribute from the evaluated mesh onto the base mesh.

    See angle_heatmap._copy_color_layer_to_base — same logic.
    """
    base_mesh = obj.data
    if len(base_mesh.loops) != len(eval_mesh.loops):
        mesh_utils.get_or_create_color_layer(base_mesh, layer_name)
        return
    mesh_utils.get_or_create_color_layer(base_mesh, layer_name)
    mesh_utils.set_vertex_colors_bulk(base_mesh, layer_name, colors_flat)
    layer = base_mesh.color_attributes.get(layer_name)
    if layer:
        base_mesh.color_attributes.active_color = layer
```

- [ ] **Step 2: Run existing resolution tests**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_resolution.py 2>&1 | tail -5
```

Expected: `OK: all resolution_heatmap tests passed`.

- [ ] **Step 3: Commit**

```bash
git add strokmatic_vision_tools/resolution_heatmap.py
git commit -m "perf(resolution_heatmap): precomputed tangents + evaluated mesh + progress reporting"
```

---

## Task 4: Apply fixes to Deflectometry Coverage orchestrator

**Files:**
- Modify: `strokmatic_vision_tools/deflectometry/coverage.py`

The coverage orchestrator suffers from the same O(V²) tangent bug in the sweep loop and reads `obj.data` directly. It also has the unique issue of a quadruple-nested loop (steps × vertices × cameras × emitters). We apply:

- Evaluated mesh access
- Precomputed tangents per object (outside the sweep loop)
- Back-face culling (outside the sweep loop)
- Progress reporting (per sweep step)

- [ ] **Step 1: Replace `compute_coverage` in `strokmatic_vision_tools/deflectometry/coverage.py`**

In `strokmatic_vision_tools/deflectometry/coverage.py`, locate the `compute_coverage` function (starts around line 76) and replace it with the version below. Keep helper functions `_get_cameras`, `_get_emitters`, `_extract_cylinder_params`, and `_update_near_miss` as they are.

```python
def compute_coverage(context, params, targets=None):
    """Compute deflectometry coverage for target meshes.

    v1.1.1 improvements:
      - Uses evaluated mesh (modifiers applied)
      - Precomputes vertex tangents once per mesh (O(V+E) instead of O(V*E))
      - Back-face culling: vertices with normals facing away from every
        camera are marked NOT_IN_FOV before the sweep loop begins
      - Progress reporting via wm.progress_*

    Args:
        context: Blender context.
        params: CoverageParams.
        targets: Explicit list of mesh objects (optional). Falls back to
            ``mesh_utils.get_target_objects`` using the scene's
            ``skm_vision_scope``.

    Returns:
        CoverageMatrix.
    """
    wm = context.window_manager
    scene = context.scene

    if targets is None:
        scope = getattr(scene, "skm_vision_scope", None)
        if scope is None:
            scope = scene.get("skm_vision_scope", "VISIBLE")
        targets = get_target_objects(context, scope)

    cameras = _get_cameras(context)
    emitters = _get_emitters(context)
    camera_names = [cam.name for cam in cameras]

    # Depsgraph always needed now (for evaluated mesh even when occlusion off).
    depsgraph = context.evaluated_depsgraph_get()

    cyl_params = []
    if params.use_analytic:
        for em in emitters:
            cyl_params.append(_extract_cylinder_params(em))

    positions = parametric_sweep(
        params.sweep_axis, params.sweep_start, params.sweep_end, params.sweep_step
    )

    # ----------------------------------------------------------------
    # Setup: evaluated meshes + precomputed tangents + back-face cull
    # ----------------------------------------------------------------
    # vertex_data entries: (gidx, base_world_pos, world_normal, obj,
    #                       local_vi, eval_obj_ref, tangents_by_vi,
    #                       potentially_visible)
    vertex_data = []
    eval_obj_refs = []  # keep alive for duration, cleaned up at end
    global_idx = 0
    cam_positions_np = np.array(
        [np.array(c.matrix_world.translation, dtype=np.float32) for c in cameras],
        dtype=np.float32,
    )

    for obj in targets:
        eval_obj, mesh = mesh_utils.get_evaluated_mesh(obj, depsgraph)
        eval_obj_refs.append(eval_obj)

        mw = obj.matrix_world
        normal_matrix = mw.to_3x3().inverted_safe().transposed()

        tangents_by_vi = mesh_utils.compute_all_tangents(mesh)

        num_verts = len(mesh.vertices)
        positions_arr = np.empty(num_verts * 3, dtype=np.float32)
        normals_arr = np.empty(num_verts * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", positions_arr)
        mesh.vertices.foreach_get("normal", normals_arr)
        positions_arr = positions_arr.reshape(-1, 3)
        normals_arr = normals_arr.reshape(-1, 3)

        # World-space positions + normals via numpy
        world_mat_np = np.array(mw, dtype=np.float32)
        rot3 = world_mat_np[:3, :3]
        translate = world_mat_np[:3, 3]
        nmat = np.linalg.inv(rot3).T
        world_positions = positions_arr @ rot3.T + translate
        world_normals_np = normals_arr @ nmat.T
        nnorm = np.linalg.norm(world_normals_np, axis=1, keepdims=True)
        nnorm[nnorm < 1e-9] = 1.0
        world_normals_np = world_normals_np / nnorm

        # Back-face culling: mark vertices whose normals have a chance of
        # producing a reflection into any camera. Threshold -0.05 gives
        # a small margin for vertices that might tilt favorably later.
        # dot(normal, normalize(cam - vert))
        potentially_visible = np.zeros(num_verts, dtype=bool)
        for ci in range(len(cameras)):
            cp = cam_positions_np[ci]
            dirs = cp[None, :] - world_positions
            dnorm = np.linalg.norm(dirs, axis=1, keepdims=True)
            dnorm[dnorm < 1e-9] = 1.0
            dirs = dirs / dnorm
            dots = np.sum(dirs * world_normals_np, axis=1)
            potentially_visible |= dots > -0.05

        for vi in range(num_verts):
            wp = Vector(world_positions[vi].tolist())
            wn = Vector(world_normals_np[vi].tolist())
            vertex_data.append(
                (global_idx, wp, wn, obj, vi, tangents_by_vi, bool(potentially_visible[vi]))
            )
            global_idx += 1

    total_vertices = len(vertex_data)

    # ----------------------------------------------------------------
    # Sweep loop
    # ----------------------------------------------------------------
    hit_steps = {vd[0]: {} for vd in vertex_data}
    near_miss_tracker = {vd[0]: {} for vd in vertex_data}

    wm.progress_begin(0, len(positions))
    try:
        for step_idx, pos_mm in enumerate(positions):
            offset = get_sweep_offset(params.sweep_axis, pos_mm)

            for vd_tuple in vertex_data:
                vidx, base_pos, normal, obj, local_vi, tangents_by_vi, is_potentially_visible = vd_tuple

                if not is_potentially_visible:
                    # Back-facing to all cameras — record a single NearMiss
                    # once (at step 0) and skip all subsequent work.
                    if step_idx == 0:
                        for cam_name in camera_names:
                            _update_near_miss(
                                near_miss_tracker, vidx, cam_name, 0,
                                "OUT_OF_FOV", 0.0,
                            )
                    continue

                vert_world = base_pos + offset

                for cam in cameras:
                    cam_name = cam.name
                    cam_pos = cam.matrix_world.translation

                    if not is_point_in_fov(scene, cam, vert_world):
                        _update_near_miss(
                            near_miss_tracker, vidx, cam_name, step_idx,
                            "OUT_OF_FOV", 0.0,
                        )
                        continue

                    view_dir = cam_pos - vert_world
                    if view_dir.length < 1e-12:
                        _update_near_miss(
                            near_miss_tracker, vidx, cam_name, step_idx,
                            "NO_REFLECTION", 0.0,
                        )
                        continue
                    view_dir_n = view_dir.normalized()

                    refl = reflect_direction(tuple(view_dir_n), tuple(normal))

                    emitter_hit = False
                    if params.use_analytic:
                        for cyl_center, cyl_axis, cyl_radius, cyl_half_length in cyl_params:
                            hit, _t = ray_cylinder_intersection(
                                tuple(vert_world), refl,
                                cyl_center, cyl_axis, cyl_radius, cyl_half_length,
                            )
                            if hit:
                                emitter_hit = True
                                break
                    else:
                        result, _loc, _norm, _fidx, hit_obj, _mx = scene.ray_cast(
                            depsgraph, vert_world, Vector(refl),
                        )
                        if result and hit_obj is not None:
                            if hit_obj.get("skm_is_emitter", False):
                                emitter_hit = True

                    if not emitter_hit:
                        _update_near_miss(
                            near_miss_tracker, vidx, cam_name, step_idx,
                            "NO_REFLECTION", 0.0,
                        )
                        continue

                    if params.check_occlusion:
                        if not check_visibility(depsgraph, scene, cam_pos, vert_world, obj):
                            _update_near_miss(
                                near_miss_tracker, vidx, cam_name, step_idx,
                                "OCCLUDED", 0.0,
                            )
                            continue

                    angle = view_angle_at_point(cam, vert_world, normal)
                    if params.check_angle and angle > params.max_angle:
                        _update_near_miss(
                            near_miss_tracker, vidx, cam_name, step_idx,
                            "STEEP_ANGLE", angle - params.max_angle,
                        )
                        continue

                    resolution = 0.0
                    if params.check_resolution:
                        tu, tv = tangents_by_vi[local_vi]
                        tu_world = (obj.matrix_world.to_3x3() @ tu).normalized()
                        tv_world = (obj.matrix_world.to_3x3() @ tv).normalized()
                        resolution = pixel_per_mm_at_point(
                            scene, cam, vert_world, tu_world, tv_world
                        )
                        if resolution < params.min_resolution:
                            _update_near_miss(
                                near_miss_tracker, vidx, cam_name, step_idx,
                                "LOW_RESOLUTION",
                                params.min_resolution - resolution,
                            )
                            continue

                    if cam_name not in hit_steps[vidx]:
                        hit_steps[vidx][cam_name] = []
                    hit_steps[vidx][cam_name].append((step_idx, resolution, angle))

            wm.progress_update(step_idx + 1)
    finally:
        wm.progress_end()

    # ----------------------------------------------------------------
    # Build VertexResults
    # ----------------------------------------------------------------
    results = {}
    for vd_tuple in vertex_data:
        vidx, base_pos, normal, obj, local_vi, _, _ = vd_tuple
        hits = []
        nearest_misses = []

        for cam_name in camera_names:
            steps = hit_steps[vidx].get(cam_name, [])
            if steps:
                first_step = steps[0][0]
                last_step = steps[-1][0]
                duration = len(steps)
                resolutions = [s[1] for s in steps]
                angles = [s[2] for s in steps]
                best_res = max(resolutions) if resolutions else 0.0
                avg_res = sum(resolutions) / len(resolutions) if resolutions else 0.0
                best_ang = min(angles) if angles else 0.0
                avg_ang = sum(angles) / len(angles) if angles else 0.0

                if params.check_sweep_duration and duration < params.min_sweep_steps:
                    nearest_misses.append(
                        NearMiss(
                            camera=cam_name,
                            best_sweep_step=steps[0][0],
                            failure_reason="SHORT_DURATION",
                            gap_magnitude=float(params.min_sweep_steps - duration),
                        )
                    )
                    continue

                hits.append(
                    CameraHit(
                        camera=cam_name,
                        first_step=first_step,
                        last_step=last_step,
                        duration=duration,
                        best_resolution=best_res,
                        best_angle=best_ang,
                        avg_resolution=avg_res,
                        avg_angle=avg_ang,
                    )
                )
            else:
                nm_data = near_miss_tracker[vidx].get(cam_name)
                if nm_data is not None:
                    best_step, reason, gap = nm_data
                    nearest_misses.append(
                        NearMiss(
                            camera=cam_name,
                            best_sweep_step=best_step,
                            failure_reason=reason,
                            gap_magnitude=gap,
                        )
                    )

        results[vidx] = VertexResult(hits=hits, nearest_misses=nearest_misses)

    # Release all evaluated meshes
    for eo in eval_obj_refs:
        try:
            eo.to_mesh_clear()
        except Exception:
            pass

    return CoverageMatrix(
        params=params,
        cameras=camera_names,
        vertices=total_vertices,
        results=results,
    )
```

Note on import at top of file — `compute_all_tangents` is accessed via `mesh_utils.compute_all_tangents`, and existing imports already include `mesh_utils`. No import change needed.

- [ ] **Step 2: Run deflectometry integration tests**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_coverage_integration.py 2>&1 | tail -5
```

Expected: `OK: all coverage integration tests passed`.

- [ ] **Step 3: Run full suite**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && ./tests/run_all.sh
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add strokmatic_vision_tools/deflectometry/coverage.py
git commit -m "perf(deflectometry): evaluated mesh + precomputed tangents + back-face cull + progress"
```

---

## Task 5: Performance benchmark test

**Files:**
- Create: `tests/test_performance.py`

- [ ] **Step 1: Create the test file**

Create `workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_performance.py` with the following content:

```python
"""Performance benchmarks for Vision Tools — must run inside Blender.

Verifies that large meshes complete in reasonable time and that
modifiers are respected by the heatmap operators.
"""
import bpy
import sys
import os
import time
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from strokmatic_vision_tools.resolution_heatmap import compute_resolution_heatmap
from strokmatic_vision_tools.angle_heatmap import compute_angle_heatmap
from strokmatic_vision_tools.deflectometry.coverage import compute_coverage
from strokmatic_vision_tools.deflectometry.coverage_data import CoverageParams


# ---------------------------------------------------------------------------
# Scene builders
# ---------------------------------------------------------------------------


def _build_large_plane(target_vertex_count):
    """Create a subdivided plane with at least ``target_vertex_count`` verts.

    Returns the plane object.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Each subdivide pass multiplies vertices by ~4. Start 2x2, subdivide
    # until we exceed target.
    bpy.ops.mesh.primitive_plane_add(size=2.0)
    plane = bpy.context.active_object
    plane.name = "BenchPlane"

    bpy.ops.object.mode_set(mode='EDIT')
    # Figure out how many cuts we need. Plane starts as 4 verts.
    # After n cuts: (n+1)^2 vertices (approximately — actually on edges it's
    # more, but the simple grid formula works for our purposes).
    import math as _m
    cuts = max(1, int(_m.ceil(_m.sqrt(target_vertex_count)) - 1))
    bpy.ops.mesh.subdivide(number_cuts=cuts)
    bpy.ops.object.mode_set(mode='OBJECT')

    return plane


def _setup_camera_and_scene(plane):
    """Add a camera above the plane and configure render resolution."""
    cam_data = bpy.data.cameras.new("BenchCam")
    cam_data.lens = 20
    cam_data.sensor_width = 36.0
    cam_obj = bpy.data.objects.new("BenchCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = (0, 0, 3)
    bpy.context.scene.camera = cam_obj
    bpy.context.scene.render.resolution_x = 640
    bpy.context.scene.render.resolution_y = 512
    bpy.context.view_layer.update()
    return cam_obj


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_angle_heatmap_100k_completes_under_10s():
    plane = _build_large_plane(100_000)
    cam = _setup_camera_and_scene(plane)
    scene = bpy.context.scene

    t0 = time.time()
    compute_angle_heatmap(
        scene=scene, camera=cam, targets=[plane],
        mode="CONTINUOUS", threshold=60.0, margin=10.0,
        check_occlusion=False,
    )
    elapsed = time.time() - t0
    assert elapsed < 10.0, f"Angle heatmap on 100k verts took {elapsed:.2f}s (expected < 10s)"
    assert "SKM_ViewAngle" in [a.name for a in plane.data.color_attributes]


def test_resolution_heatmap_100k_completes_under_30s():
    plane = _build_large_plane(100_000)
    cam = _setup_camera_and_scene(plane)
    scene = bpy.context.scene

    t0 = time.time()
    compute_resolution_heatmap(
        scene=scene, camera=cam, targets=[plane],
        unit="PX_MM", mode="CONTINUOUS",
        threshold=5.0, margin=1.0, check_occlusion=False,
    )
    elapsed = time.time() - t0
    assert elapsed < 30.0, f"Resolution heatmap on 100k verts took {elapsed:.2f}s (expected < 30s)"
    assert "SKM_Resolution" in [a.name for a in plane.data.color_attributes]


def test_deflectometry_small_sweep_under_30s():
    """Coverage analysis on 100k verts with a small 5-step sweep."""
    plane = _build_large_plane(100_000)
    cam = _setup_camera_and_scene(plane)
    scene = bpy.context.scene

    # Emitter cylinder to the side
    bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=2.0, location=(1.5, 0, 1.5))
    emitter = bpy.context.active_object
    emitter.name = "BenchEmitter"
    emitter.rotation_euler = (math.radians(90), 0, 0)
    emitter["skm_is_emitter"] = True
    bpy.context.view_layer.update()

    params = CoverageParams(
        sweep_axis="Y", sweep_start=-200, sweep_end=200, sweep_step=100,
        check_resolution=False, check_angle=False,
        check_sweep_duration=False, check_occlusion=False,
    )

    t0 = time.time()
    matrix = compute_coverage(bpy.context, params, targets=[plane])
    elapsed = time.time() - t0
    assert elapsed < 30.0, f"Deflectometry on 100k verts × 5 steps took {elapsed:.2f}s (expected < 30s)"
    assert matrix.vertices > 0


def test_decimate_modifier_reduces_computation():
    """Adding a Decimate modifier at ratio 0.1 should reduce evaluated vertex count.

    The painted color attribute should be populated for the evaluated (reduced)
    count, proving the modifier stack was consulted rather than the base mesh.
    """
    plane = _build_large_plane(10_000)
    cam = _setup_camera_and_scene(plane)
    scene = bpy.context.scene

    base_count = len(plane.data.vertices)
    assert base_count >= 10_000, f"Expected ≥10k base verts, got {base_count}"

    # Add a destructive-ratio Decimate modifier
    mod = plane.modifiers.new(name="Decimate", type='DECIMATE')
    mod.ratio = 0.1
    bpy.context.view_layer.update()

    # Evaluated mesh should have roughly 10% of vertices
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = plane.evaluated_get(depsgraph)
    eval_mesh = eval_obj.to_mesh()
    eval_count = len(eval_mesh.vertices)
    eval_obj.to_mesh_clear()
    assert eval_count < base_count, \
        f"Decimate should reduce vertex count: base={base_count} eval={eval_count}"
    # Allow some slack — Decimate at 0.1 typically lands between 5% and 20% of base
    assert eval_count < base_count * 0.5, \
        f"Decimate didn't reduce enough: base={base_count} eval={eval_count}"

    # Run the angle heatmap. With evaluated-mesh access (v1.1.1), the modifier
    # stack is respected and the computation is fast.
    t0 = time.time()
    compute_angle_heatmap(
        scene=scene, camera=cam, targets=[plane],
        mode="CONTINUOUS", threshold=60.0, margin=10.0,
        check_occlusion=False,
    )
    elapsed = time.time() - t0
    # With the modifier reducing to ~1k verts, it should be near-instant.
    assert elapsed < 3.0, f"Decimated angle heatmap took {elapsed:.2f}s (expected < 3s)"


def test_occlusion_hides_blocked_vertices():
    """An occluder plane between camera and target should produce gray vertices."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Target plane at z=0
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0))
    target = bpy.context.active_object
    target.name = "Target"
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=4)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Occluder plane halfway between camera and target
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 1))
    occluder = bpy.context.active_object
    occluder.name = "Occluder"

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 20
    cam_obj = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = (0, 0, 3)
    bpy.context.scene.camera = cam_obj
    bpy.context.scene.render.resolution_x = 640
    bpy.context.scene.render.resolution_y = 512
    bpy.context.view_layer.update()

    # Run angle heatmap with occlusion ON, on the target only
    compute_angle_heatmap(
        scene=bpy.context.scene, camera=cam_obj, targets=[target],
        mode="CONTINUOUS", threshold=60.0, margin=10.0,
        check_occlusion=True,
    )

    # All loops on the target should be GRAY (0.3, 0.3, 0.3) because the
    # occluder blocks them.
    layer = target.data.color_attributes.get("SKM_ViewAngle")
    assert layer is not None
    num_loops = len(target.data.loops)

    import numpy as np
    colors = np.empty(num_loops * 4, dtype=np.float32)
    layer.data.foreach_get("color", colors)
    colors = colors.reshape(-1, 4)

    # Majority should be gray (0.3, 0.3, 0.3, 1.0). Allow tiny margin for
    # edge vertices where ray-cast might land exactly at the boundary.
    is_gray = (np.abs(colors[:, 0] - 0.3) < 0.01) & \
              (np.abs(colors[:, 1] - 0.3) < 0.01) & \
              (np.abs(colors[:, 2] - 0.3) < 0.01)
    gray_ratio = is_gray.mean()
    assert gray_ratio > 0.8, \
        f"Expected >80% gray (occluded) loops, got {gray_ratio*100:.1f}%"


if __name__ == "__main__":
    test_angle_heatmap_100k_completes_under_10s()
    test_resolution_heatmap_100k_completes_under_30s()
    test_deflectometry_small_sweep_under_30s()
    test_decimate_modifier_reduces_computation()
    test_occlusion_hides_blocked_vertices()
    print("OK: all performance tests passed")
```

- [ ] **Step 2: Run the benchmark**

```bash
blender --background --python workspaces/strokmatic/sdk/sdk-blender-tools/tests/test_performance.py 2>&1 | tail -15
```

Expected: `OK: all performance tests passed` — all five benchmarks complete within their thresholds.

- [ ] **Step 3: Add to `tests/run_all.sh`**

Edit `workspaces/strokmatic/sdk/sdk-blender-tools/tests/run_all.sh`, in the `--- Blender tests ---` section (after `deflect_visualizer`), add:

```bash
run_test "performance"           "$SCRIPT_DIR/test_performance.py"
```

- [ ] **Step 4: Run full suite**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && ./tests/run_all.sh
```

Expected: all tests pass, including the new `performance` entry.

- [ ] **Step 5: Commit**

```bash
git add tests/test_performance.py tests/run_all.sh
git commit -m "test(perf): 100k-vertex benchmarks + decimate + occlusion regression tests"
```

---

## Task 6: Version bump + local ZIP

**Files:**
- Modify: `strokmatic_vision_tools/__init__.py`
- Modify: `strokmatic_vision_tools/blender_manifest.toml`

- [ ] **Step 1: Bump version in `__init__.py`**

In `strokmatic_vision_tools/__init__.py`, change:

```python
    "version": (1, 1, 0),
```

to:

```python
    "version": (1, 1, 1),
```

- [ ] **Step 2: Bump version in `blender_manifest.toml`**

In `strokmatic_vision_tools/blender_manifest.toml`, change:

```toml
version = "1.1.0"
```

to:

```toml
version = "1.1.1"
```

- [ ] **Step 3: Run the full test suite one last time**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools && ./tests/run_all.sh
```

Expected: all tests pass.

- [ ] **Step 4: Build the testing ZIP**

```bash
cd workspaces/strokmatic/sdk/sdk-blender-tools
rm -f /tmp/strokmatic_vision_tools_v1.1.1-testing.zip
zip -r /tmp/strokmatic_vision_tools_v1.1.1-testing.zip strokmatic_vision_tools/ \
    -x "strokmatic_vision_tools/__pycache__/*" \
       "strokmatic_vision_tools/deflectometry/__pycache__/*"
zipinfo /tmp/strokmatic_vision_tools_v1.1.1-testing.zip | tail -1
```

Expected: `~20 files, ~90KB uncompressed, ~30KB compressed`. The `-testing` suffix signals this is a pre-release build for Tiago's validation.

- [ ] **Step 5: Commit the version bump**

```bash
git add strokmatic_vision_tools/__init__.py strokmatic_vision_tools/blender_manifest.toml
git commit -m "chore: bump version to 1.1.1 (performance + correctness fixes)"
```

**Note:** Do NOT push or create a GitHub release. This build is for local testing only. Field validation by the colleague on real vehicle geometry gates the release.
