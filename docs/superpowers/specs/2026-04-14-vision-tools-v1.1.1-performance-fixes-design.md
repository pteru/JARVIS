---
type: Design Spec
title: Strokmatic Vision Tools v1.1.1 — Performance and Correctness Fixes
description: v1.1.0 field testing on real vehicle geometry (2.2M-vertex STL) revealed three critical correctness bugs and severe performance problems that make the tools unusable at production scale:
timestamp: 2026-04-14
---

# Strokmatic Vision Tools v1.1.1 — Performance and Correctness Fixes

**Date:** 2026-04-14
**Product:** VisionKing (Strokmatic Vision Tools Blender add-on)
**Location:** `workspaces/strokmatic/sdk/sdk-blender-tools/`
**Prerequisite:** Vision Tools v1.1.0 (built 2026-04-13)

## Problem Statement

v1.1.0 field testing on real vehicle geometry (2.2M-vertex STL) revealed three critical correctness bugs and severe performance problems that make the tools unusable at production scale:

- **Resolution Heatmap crashes** on any mesh with more than ~10k vertices. Blender hangs or out-of-memory terminates.
- **Angle Heatmap runs for 2-3 minutes** on real geometry. Completes but painfully slow.
- **Decimate modifier has no effect** — non-destructive decimation does not reduce computation time, forcing users to apply destructive decimation which degrades geometry fidelity and introduces artifacts.
- **Occlusion check does not hide visibly blocked regions** on real scenes.

The deflectometry coverage analyzer shipped in v1.1.0 has never been exercised on real geometry, but it shares the same code paths and multiplies their cost by `sweep_steps × cameras × emitters`. The analyzer is likely entirely unusable on production meshes.

## Root Cause Analysis

### Crash on Resolution Heatmap (O(V²) tangent computation)

`mesh_utils.get_vertex_tangents(mesh, vertex_index)` iterates `mesh.edges` on every call, searching for an edge containing the target vertex. For a mesh with V vertices and E ≈ V edges, this is O(E) per vertex × V vertices × ~3 loops per vertex = **O(V²)** in the hot path. On 2.2M vertices this is `~10¹³` operations — effectively infinite, hence "crash."

The angle heatmap does not call `get_vertex_tangents`, which is why it completes (slowly) instead of crashing.

### Modifier-aware mesh access missing

All three operators read `obj.data` directly. This returns the base mesh, bypassing any modifier stack (Decimate, Mirror, Subdivision Surface, etc.). The correct idiom is:

```python
depsgraph = context.evaluated_depsgraph_get()
eval_obj = obj.evaluated_get(depsgraph)
mesh = eval_obj.to_mesh()
# ... work ...
eval_obj.to_mesh_clear()
```

### Occlusion ray-distance check

`mesh_utils.check_visibility()` returns `True` whenever `scene.ray_cast` hits the expected object, ignoring the hit distance. A closer face of the same mesh can intercept the ray, producing a hit on the correct object at the wrong depth — the function accepts this as "visible," so no occlusion is ever reported for self-occluding geometry.

### Per-vertex Python loop in hot paths

Both heatmaps iterate `for loop in mesh.loops` in Python, calling `world_to_camera_view`, vector math, and attribute setters per iteration. Blender's `foreach_get` / `foreach_set` and numpy offer 10-50x speedup through batched C-level operations.

## Scope

**In scope for v1.1.1:**

1. Pre-compute vertex tangents once per mesh
2. Use evaluated mesh so modifiers apply
3. Fix occlusion ray distance check
4. Numpy batch operations for angle heatmap
5. Numpy batch operations for resolution heatmap
6. Back-face culling in deflectometry orchestrator
7. Progress reporting via `wm.progress_*`

**Deferred (possible v1.1.2 or v1.2.0):**

- Spatial pre-filter (bounding-box reject) for deflectometry
- Mesh-size warning before long computations
- Fully numpy-native camera projection (for resolution heatmap 50x+ speedup)
- Camera-matrix-based projection without per-vertex `world_to_camera_view`

## Design

### Fix 1 — Pre-compute vertex tangents

**File:** `strokmatic_vision_tools/mesh_utils.py`

Add a new function that builds tangents for every vertex in a single edge-iteration pass:

```python
def compute_all_tangents(mesh):
    """Compute orthogonal tangent pairs for every vertex in one pass.

    Args:
        mesh: A bpy.types.Mesh.

    Returns:
        Dict[int, Tuple[Vector, Vector]] mapping vertex index to
        (tangent_u, tangent_v) world-aligned to the object's local frame.
    """
    from mathutils import Vector

    # First pass: one edge-direction per vertex
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

    # Second pass: build orthonormal basis per vertex
    tangents = {}
    for vi, vert in enumerate(mesh.vertices):
        normal = vert.normal.normalized()
        seed = edge_dir.get(vi)
        if seed is None or seed.length < 1e-6:
            # Fallback: arbitrary perpendicular to normal
            seed = Vector((0, 0, 1)) if abs(normal.z) < 0.9 else Vector((1, 0, 0))
        tangent_u = (seed - normal * seed.dot(normal)).normalized()
        if tangent_u.length < 1e-6:
            # Degenerate (seed parallel to normal)
            seed = Vector((1, 0, 0)) if abs(normal.x) < 0.9 else Vector((0, 1, 0))
            tangent_u = (seed - normal * seed.dot(normal)).normalized()
        tangent_v = normal.cross(tangent_u).normalized()
        tangents[vi] = (tangent_u, tangent_v)

    return tangents
```

Complexity: **O(V + E)** single pass, replacing O(V²) in the caller's loop.

The legacy `get_vertex_tangents(mesh, vertex_index)` remains for backward compatibility but is removed from hot paths.

### Fix 2 — Evaluated mesh access

**Files:** `resolution_heatmap.py`, `angle_heatmap.py`, `deflectometry/coverage.py`

Introduce a helper in `mesh_utils.py`:

```python
def get_evaluated_mesh(obj, depsgraph):
    """Get the mesh with modifiers applied.

    Caller MUST call obj.evaluated_get(depsgraph).to_mesh_clear()
    after use, or wrap in a try/finally.

    Returns:
        Tuple (eval_obj, mesh) for cleanup.
    """
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    return eval_obj, mesh
```

All three operators acquire the depsgraph once, call `get_evaluated_mesh` per target object, and release via `to_mesh_clear()` in a `finally` block. The world matrix still comes from the original object (`obj.matrix_world`).

Test: a synthetic test adds a Decimate modifier to a 100k-vertex plane and verifies vertex counts in the result reflect the decimation ratio.

### Fix 3 — Occlusion ray distance

**File:** `strokmatic_vision_tools/mesh_utils.py`

Current `check_visibility` is replaced with:

```python
def check_visibility(depsgraph, scene, origin, target, expected_obj,
                    tolerance=0.001):
    """Return True when origin→target has no occluder closer than target.

    Args:
        depsgraph: Evaluated dependency graph.
        scene: Blender scene.
        origin: Ray origin in world space (Vector).
        target: Target point on the surface (Vector).
        expected_obj: Object whose vertex is the target (used for logging).
        tolerance: Distance in Blender units; hits closer than
            target_dist - tolerance count as occlusion.

    Returns:
        True if the point is visible (no occluder), False otherwise.
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
        return True  # clear path

    hit_dist = (location - origin).length
    # Occluded only if hit is meaningfully closer than the target
    return hit_dist >= target_dist - tolerance
```

Semantics change: the function no longer checks object identity. Any closer obstacle — same object or different — counts as occlusion. This matches the physical intuition and handles self-occluding geometry (door panel blocking rear pillar from a side camera, for example).

### Fix 4 — Numpy batch ops for angle heatmap

**File:** `strokmatic_vision_tools/angle_heatmap.py`

Rewrite the per-object block to:

```python
num_verts = len(mesh.vertices)
positions = np.empty(num_verts * 3, dtype=np.float32)
normals = np.empty(num_verts * 3, dtype=np.float32)
mesh.vertices.foreach_get("co", positions)
mesh.vertices.foreach_get("normal", normals)
positions = positions.reshape(-1, 3)
normals = normals.reshape(-1, 3)

# Transform to world
world_mat = np.array(obj.matrix_world, dtype=np.float32)
rot3 = world_mat[:3, :3]
translate = world_mat[:3, 3]
normal_mat = np.linalg.inv(rot3).T
world_positions = positions @ rot3.T + translate
world_normals = normals @ normal_mat.T
# Normalize
world_normals /= np.linalg.norm(world_normals, axis=1, keepdims=True)

# View direction from each vertex to camera
cam_pos = np.array(camera.matrix_world.translation, dtype=np.float32)
view_dirs = cam_pos - world_positions
view_dirs /= np.linalg.norm(view_dirs, axis=1, keepdims=True)

# Angle: abs(dot) then acos
dots = np.clip(np.sum(view_dirs * world_normals, axis=1), -1.0, 1.0)
angles_deg = np.degrees(np.arccos(np.abs(dots)))
```

FOV filtering remains per-vertex (calls `world_to_camera_view` which is not trivially numpy-vectorizable without replicating Blender's projection math). We accept this cost — it's still O(V) Python, not O(V²).

Loop-to-vertex mapping: use `foreach_get("vertex_index", loop_vi_array)` to vectorize the loop→vertex remapping for color assignment.

### Fix 5 — Numpy batch ops for resolution heatmap

**File:** `strokmatic_vision_tools/resolution_heatmap.py`

Same pattern as Fix 4 for bulk data access and loop mapping. Resolution computation keeps per-vertex `world_to_camera_view` + the `pixel_per_mm_at_point` finite-difference, but:

- Tangents come from the `compute_all_tangents` dict (Fix 1), not from per-loop recomputation
- The per-vertex projection still runs in Python, but only V times, not V² or V × loops

Expected performance on 200k vertices: **under 30 seconds** (from "crashes" previously). Not yet competitive with angle heatmap (which should be under 10s) — the per-vertex projection is the bottleneck. Deferred full-numpy projection to v1.2.0.

### Fix 6 — Back-face culling (deflectometry)

**File:** `strokmatic_vision_tools/deflectometry/coverage.py`

Before the sweep loop, compute a `potentially_visible` mask:

```python
# Shape: (num_verts, num_cameras). True if normal has any chance of
# producing a reflection into the camera at sweep step 0.
cam_positions_arr = np.array([c.matrix_world.translation for c in cameras])
# For each vertex-camera pair: dot(normal, normalize(cam - vertex)) > threshold
```

Threshold: `-0.05` (allows a small margin for vertices that might tilt favorably later in the sweep — we use a slight negative so truly back-facing vertices are skipped but edge cases aren't). Vertices with no `True` entries across cameras are marked `NOT_IN_FOV` near-miss and skipped in the main loop.

On a car body (half of the mesh faces downward toward the floor, out of any camera's line of sight), this typically eliminates 40-60% of vertices.

### Fix 7 — Progress reporting

**Files:** `resolution_heatmap.py`, `angle_heatmap.py`, `deflectometry/coverage.py`

Wrap long-running sections:

```python
wm = context.window_manager
wm.progress_begin(0, total_units)
try:
    for i, _ in enumerate(work_units):
        # work
        if i % 100 == 0:
            wm.progress_update(i)
finally:
    wm.progress_end()
```

Applied to:
- Resolution heatmap: updates per vertex batch (every 1000 verts)
- Angle heatmap: updates per object
- Deflectometry: updates per sweep step (most meaningful unit)

### Testing

**New file:** `tests/test_performance.py` (Blender test)

```
setup_large_plane(vertex_target):
    Create a plane, subdivide until vertex count ≥ target.
    Return the plane.

test_resolution_heatmap_100k_completes_under_30s:
    plane = setup_large_plane(100_000)
    Add camera, set scene properties.
    Start timer.
    Call compute_resolution_heatmap(...)
    Assert elapsed < 30.0 seconds.
    Assert color attribute "SKM_Resolution" exists.

test_angle_heatmap_100k_completes_under_10s:
    Similar, calls compute_angle_heatmap, threshold 10s.

test_deflectometry_coverage_small_sweep_under_30s:
    plane = setup_large_plane(100_000)
    Add camera + cylinder emitter.
    Sweep: 5 steps.
    Assert compute_coverage completes under 30s.

test_decimate_modifier_is_respected:
    Create 10k-vertex plane.
    Add Decimate modifier at ratio 0.1 (90% reduction).
    Run angle heatmap.
    Inspect painted color attribute: vertex count on evaluated mesh
    should be ~1k, and the attribute should be populated for exactly
    that many loops (not 10k).

test_occlusion_hides_blocked_vertices:
    Two parallel planes, camera above the upper plane.
    With Check Occlusion off: both planes get non-gray colors.
    With Check Occlusion on: lower plane is gray (occluded).
```

The 100k threshold is conservative — representative of a STEP-to-STL conversion of a single body panel, or a half-decimated vehicle. If production usage shows real meshes settle around 300k-500k vertices after non-destructive decimation, we can raise the threshold in a follow-up.

**Existing tests:** all must continue passing unmodified. The occlusion semantic change in Fix 3 may require updating `test_mesh_utils.py` if any test there asserted the old object-identity-only behavior — to be verified during implementation.

### Version bump

- `strokmatic_vision_tools/__init__.py`: `"version": (1, 1, 1)`
- `strokmatic_vision_tools/blender_manifest.toml`: `version = "1.1.1"`
- Description unchanged.

### Deliverable

Local-only build artifact at `/tmp/strokmatic_vision_tools_v1.1.1-testing.zip` for the colleague to test on real vehicle geometry. **No GitHub release** until field validation confirms the fixes hold on production meshes. The release script in `scripts/release.sh` is not used for this build; we create the ZIP manually with the same exclusion pattern (`__pycache__`).

## Out of Scope (Future Work)

- Sparse vertex sampling (compute every Nth vertex, interpolate)
- BVH-based spatial queries for emitter hit tests
- Streaming / progressive results (paint as computation proceeds)
- Cython / compiled kernel for the sweep loop
- Multi-frame sweep caching (don't recompute view_to_camera for static cameras)
