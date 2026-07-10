---
type: Design Spec
title: Deflectometry Coverage Analyzer — Design Spec
description: VisionKing Body uses deflectometry to detect surface defects on car bodies. Infrared emitters form a portal around the car. As the car moves longitudinally through the portal, emitter reflections s...
timestamp: 2026-04-13
---

# Deflectometry Coverage Analyzer — Design Spec

**Date:** 2026-04-13
**Product:** VisionKing Body
**Location:** `workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/deflectometry/`
**Prerequisite:** Strokmatic Vision Tools v1.0.0 (built 2026-04-13)

## Problem Statement

VisionKing Body uses deflectometry to detect surface defects on car bodies. Infrared emitters form a portal around the car. As the car moves longitudinally through the portal, emitter reflections sweep across the car's surfaces. Cameras capture these sweeping reflections — distortions in the reflected pattern reveal dents, waves, and orange peel.

Designing the layout (camera positions, emitter positions, portal geometry) is currently a manual process that takes hours per vehicle. The layout engineer (Tiago) positions cameras and emitters in Blender, mentally estimates coverage, and iterates by trial and error. There is no way to quantitatively validate that every inspectable surface point receives adequate coverage.

## Phased Strategy

This system is built in three phases. **Phase 1 is fully specified here.** Phases 2 and 3 get architectural outlines to ensure Phase 1's data structures support them.

| Phase | Name | Purpose | Status |
|-------|------|---------|--------|
| 1 | **Coverage Analyzer** | Validate a positioned layout — simulate sweep, paint coverage heatmap, report gaps | Detailed spec below |
| 2 | **Layout Optimizer** | Suggest position adjustments to improve coverage | Architectural outline |
| 3 | **Trade-off Reporter** | Compare configurations, generate client-facing reports | Architectural outline |

## Domain Context

### Deflectometry Basics

- **Emitters:** Cylindrical IR heating elements forming portal(s) around the car
- **Cameras:** Hikvision industrial cameras (N6 = wide FOV for sides, N15 = narrow FOV for top)
- **Specular reflection:** Camera sees defects by observing the reflected emitter pattern on the car's surface. For a surface point P with normal N, the camera at position C sees the reflection of whatever lies along the direction `R = 2 * dot(V, N) * N - V` where `V = normalize(C - P)`
- **Sweep:** The car moves forward (longitudinally). As it moves, the reflection point sweeps across the surface. The sweep must cover every inspectable point with sufficient duration.

### Physical Constraints

- **Car motion:** Longitudinal, constant speed. This is the primary sweep mechanism.
- **Cameras:** Ideally fixed. Can translate vertically or along car-movement axis. Angular motion avoided (adds automation complexity).
- **Emitters:** Fixed cylindrical bodies forming portal(s). Can translate if needed.
- **Camera types:** N6 (wide FOV, sides — handles aggressive geometry, door ridges), N15 (narrow FOV, top — further from surface, clears roof when inspecting hood)
- **Typical layout:** 8 cameras (2x N15 top + 2x N15-inverse top + 2x N6-high side + 2x N6-low side), multiple emitter bars forming a portal

### Existing Workflow

- Geometry: STEP → STL (FreeCAD) → Blender import
- Cameras: Positioned manually or imported via OpenCV calibration JSON
- Emitters: Modeled as cylinder meshes in Blender
- Animation: NLA with time markers for camera switching; car animated along a path
- Validation: Currently manual/intuitive. The Vision Tools v1.0 heatmaps help with resolution and angle but do not address reflection coverage.

## Phase 1: Coverage Analyzer — Detailed Spec

### Inputs

All data comes from the Blender scene:

- **Inspection targets:** Mesh objects selected by the user (or all visible), same scope mechanism as existing heatmap tools
- **Cameras:** Blender camera objects with correct intrinsics
- **Emitters:** Mesh objects tagged with `skm_is_emitter` custom property (set via UI)
- **Sweep parameters:** Axis, start, end, step size — or read from animation keyframes

### Coverage Criteria

A surface vertex is "fully covered" when **all enabled criteria** are met at some car position during the sweep:

| Criterion | Check | Toggleable | Default |
|-----------|-------|------------|---------|
| **Reflection exists** | Reflected view direction from camera hits an emitter | Always on (core) | — |
| **Point in camera FOV** | Projected pixel coordinates within image bounds | Always on (core) | — |
| **Adequate resolution** | px/mm ≥ threshold at the surface point | Yes | On, 5.0 px/mm |
| **Acceptable viewing angle** | Camera-surface angle ≤ threshold | Yes | On, 60° |
| **Not occluded** | No geometry between camera and point | Yes | Off |
| **Minimum sweep duration** | Coverage persists for ≥ N consecutive sweep steps | Yes | On, 3 steps |

### Reflection Computation

**Primary path: Analytic (fast)**

For each vertex P with normal N, for each camera C:

1. Compute view direction: `V = normalize(C.position - P)`
2. Compute reflection direction: `R = 2 * dot(V, N) * N - V`
3. Cast ray from P in direction `R` — test intersection against emitter geometry
4. For cylindrical emitters: closed-form ray-cylinder intersection (center, axis, radius, length)
5. If hit: record as covered by camera C at this sweep step

**Validation path: Blender ray_cast (accurate)**

For non-cylindrical emitters or verification, use `scene.ray_cast()` from P in direction R. Checks against all scene geometry. Slower but handles arbitrary emitter shapes.

The UI offers a toggle: "Analytic (fast)" / "Ray Cast (accurate)". Analytic is default.

### Car Sweep Simulation

**Parametric mode (default):** User specifies axis (X/Y/Z), start position, end position, step size. The tool generates a sequence of translation offsets. At each step, it temporarily offsets all inspection target objects by the inverse translation (equivalently: moves the camera/emitter portal forward). This avoids actually animating the car.

**Animation mode:** Reads the car object's position keyframes. Samples at each frame in the animation range. Useful when the scene already has animation or when cameras/emitters also move (e.g., vertical translation during sweep).

### Coverage Matrix (Core Data Structure)

```
CoverageParams:
    sweep_axis: str                      # "X", "Y", or "Z"
    sweep_start: float                   # mm
    sweep_end: float                     # mm
    sweep_step: float                    # mm
    sweep_count: int                     # number of steps
    check_resolution: bool
    min_resolution: float                # px/mm
    check_angle: bool
    max_angle: float                     # degrees
    check_occlusion: bool
    check_sweep_duration: bool
    min_sweep_steps: int
    use_analytic: bool                   # analytic vs ray_cast

CoverageMatrix:
    params: CoverageParams
    cameras: list[str]                   # camera names
    vertices: int                        # total vertex count
    results: dict[int → VertexResult]    # vertex_index → result

VertexResult:
    hits: list[CameraHit]               # successful coverage records
    nearest_misses: list[NearMiss]       # why coverage almost worked (Phase 2 data)
    is_covered: bool                     # convenience: has at least one qualifying hit

CameraHit:
    camera: str
    first_step: int                      # first sweep step with coverage
    last_step: int                       # last sweep step with coverage
    duration: int                        # total steps with coverage
    best_resolution: float               # best px/mm across covered steps
    best_angle: float                    # best (smallest) viewing angle
    avg_resolution: float
    avg_angle: float

NearMiss:
    camera: str
    best_sweep_step: int                 # closest step to achieving coverage
    failure_reason: str                  # NO_REFLECTION | OUT_OF_FOV |
                                         # LOW_RESOLUTION | STEEP_ANGLE |
                                         # OCCLUDED | SHORT_DURATION
    gap_magnitude: float                 # how far off (units depend on reason)
```

JSON-serializable for headless mode and Phase 3 comparison.

### Visualization

**Coverage heatmap** — vertex colors on inspection target meshes:

| Color | Meaning |
|-------|---------|
| Green | Fully covered (all enabled criteria met) |
| Yellow | Partially covered (reflection exists but quality criteria marginal) |
| Red | Not covered (no camera captures reflection during sweep) |
| Blue | Redundant (covered by 2+ cameras — useful for Phase 3 trade-offs) |
| Gray | Not in any camera's FOV at any sweep step |

**Per-camera mode:** Dropdown filter shows coverage contribution of a single camera. Vertices not covered by that camera are gray.

**Sweep animation (optional):** Stepping through the sweep and showing instantaneous reflection coverage at each car position. Uses Blender's frame scrubbing — each sweep step maps to a frame.

### UI Panel

New collapsible section **"Deflectometry Coverage"** in the SKM Vision sidebar panel:

| Field | Type | Description |
|-------|------|-------------|
| Emitters | Multi-select object picker | Objects tagged as IR emitters |
| Sweep Axis | Enum: X / Y / Z | Car movement direction |
| Sweep Start | Float (mm) | Start position |
| Sweep End | Float (mm) | End position |
| Sweep Step | Float (mm), default 50 | Step size |
| Use Animation | Checkbox | Read from keyframes |
| Solver | Enum: Analytic / Ray Cast | Reflection computation method |
| Check Resolution | Checkbox, default on | Enable resolution filter |
| Min Resolution | Float (px/mm), default 5.0 | *(shown when enabled)* |
| Check Angle | Checkbox, default on | Enable angle filter |
| Max Angle | Float (°), default 60.0 | *(shown when enabled)* |
| Check Sweep Duration | Checkbox, default on | Enable duration filter |
| Min Sweep Steps | Int, default 3 | *(shown when enabled)* |
| Check Occlusion | Checkbox, default off | Ray-cast visibility |
| Compute Coverage | Button | Run simulation |
| Clear Coverage | Button | Remove heatmap |
| Show Camera | Dropdown: All / per camera | Filter heatmap |
| Export Report | Button | Save JSON + text summary |

### Object Tagging

Emitters are tagged via a boolean custom property `skm_is_emitter` on the Blender object. The UI provides a button "Tag as Emitter" / "Untag" that sets/removes this property on selected objects.

### Headless Mode

```bash
blender --background scene.blend --python -c "
import strokmatic_vision_tools.deflectometry as d
result = d.compute_coverage(
    sweep_axis='Y', sweep_start=-3000, sweep_end=3000, sweep_step=50,
    min_resolution=5.0, max_angle=60.0, min_sweep_steps=3
)
d.export_report(result, 'coverage_report.json')
"
```

### Performance

Target: 200k vertices × 100 sweep steps × 8 cameras = 160M checks.

Strategy:
- **numpy vectorization:** Batch-compute reflection directions for all vertices per sweep step
- **Analytic ray-cylinder:** Closed-form intersection, batch-computed
- **Back-face culling:** Skip vertices with normals pointing away from all cameras
- **Progressive display:** Update heatmap after each sweep step
- **Expected time:** 30–90 seconds for a full layout

### Module Architecture

```
strokmatic_vision_tools/
├── __init__.py                  # Updated: registers deflectometry modules
├── camera_utils.py              # Existing: reused
├── color_ramp.py                # Existing: reused
├── mesh_utils.py                # Existing: reused
├── ui_panel.py                  # Updated: add Deflectometry Coverage section
├── calibration_importer.py      # Existing: unchanged
├── resolution_heatmap.py        # Existing: unchanged
├── angle_heatmap.py             # Existing: unchanged
├── deflectometry/
│   ├── __init__.py              # Sub-package init, public API
│   ├── reflection.py            # Reflection vectors, ray-cylinder intersection
│   ├── sweep.py                 # Parametric + animation sweep generation
│   ├── coverage.py              # Coverage matrix builder (orchestrator)
│   ├── coverage_data.py         # Data structures (no bpy dependency)
│   ├── visualizer.py            # Vertex color painting from coverage matrix
│   ├── report.py                # JSON/text report export
│   └── operators.py             # Blender operators
```

### Testing

**Pure Python (no Blender):**
- `tests/test_reflection.py` — reflection vector math, ray-cylinder intersection (hits, misses, edge cases, endpoints)
- `tests/test_coverage_data.py` — serialization roundtrip, NearMiss failure reasons

**Blender tests:**
- `tests/test_sweep.py` — parametric sweep step count and offsets, animation mode
- `tests/test_coverage_integration.py` — full pipeline with minimal scene (plane + camera + cylinder emitter)
- `tests/test_deflectometry_visualizer.py` — heatmap painting, per-camera filter, clear

**Manual validation:**
- Run on Tiago's existing GM pickup layout and verify flagged areas match known problematic regions

## Phase 2: Layout Optimizer — Architectural Outline

**Purpose:** Read coverage gaps from Phase 1, suggest camera/emitter position adjustments.

**Approach:** For each uncovered vertex cluster, analyze `NearMiss` data to determine which constraint failed and by how much. Suggest the smallest position change to the nearest camera/emitter that would resolve the gap.

**Phase 1 dependency:** The `NearMiss` data in the coverage matrix — specifically `failure_reason` and `gap_magnitude`. These tell the optimizer what to fix and how far off the current configuration is.

**User interaction:** Suggestions presented one at a time. User accepts/rejects. Accepted changes applied to Blender scene. Coverage recomputed incrementally.

**Detailed spec deferred** until Phase 1 is validated on real layouts.

## Phase 3: Trade-off Reporter — Architectural Outline

**Purpose:** Compare multiple layout configurations and generate client-facing reports.

**Approach:** User defines configurations (e.g., "Full 8-cam", "Reduced 6-cam"). For each, the tool hides/shows cameras and runs Phase 1 coverage analysis. Outputs a comparison: coverage percentage per configuration, per-region breakdown, heatmap screenshots.

**Phase 1 dependency:** Headless API for batch execution, JSON-serializable coverage matrix for comparison, viewport screenshot capability for PDF report generation.

**Output:** Markdown report → PDF via md-to-pdf. Includes side-by-side heatmap images, coverage percentages, and per-camera contribution tables.

**Detailed spec deferred** until Phase 1 is validated.

## Blender Compatibility

Same as Vision Tools v1.0: Blender 3.6+ (LTS) through 5.x. Uses `mesh.color_attributes` API, `scene.ray_cast`, numpy (bundled). No external dependencies.
