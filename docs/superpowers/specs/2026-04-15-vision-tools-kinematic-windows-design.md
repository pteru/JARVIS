# Strokmatic Vision Tools — Kinematic Windows (v1.4.0)

**Date:** 2026-04-15
**Product:** VisionKing (Strokmatic Vision Tools Blender add-on)
**Location:** `workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/motion_export/windows/`
**Prerequisite:** Vision Tools v1.3.0 (motion export + kinematics), Deflectometry Coverage Analyzer (v1.1.0)

## Problem Statement

The Motion Exporter (v1.2.0) and its kinematics extension (v1.3.0) reveal the spatial and dynamic demands of every actuator in an inspection layout. But they do not answer the key engineering question: **which parts of each actuator's motion are load-bearing for inspection coverage, and which are free to reshape?**

Today, the engineer sees the actuator's trapezoidal position profile, its step-like velocity, and its impulsive acceleration, and cannot tell whether any given transition is mandatory (must hit the prescribed position at the prescribed car frame or the reflection geometry fails) or free (the actuator just needs to arrive somewhere by a later deadline). With no way to distinguish, engineering must conservatively assume *every* transition is critical, which drives actuator specifications to unnecessary extremes — higher acceleration, stiffer mechanics, bigger motors.

Separately, Tiago (the layout author) cannot safely hand-tune motion profiles inside Blender, because he has no visibility into which keyframe edits would break the deflectometry inspection.

The critical-window analysis closes this gap. It cross-references the Motion Export with the Deflectometry Coverage Matrix to partition each actuator's timeline into **critical windows** (where the actuator's exact position at that frame is required for at least one covered vertex) and **free windows** (where changing the actuator's position would not affect any covered vertex). Engineering gets tabular data for profile reshaping; Tiago gets colored timeline markers in Blender so he can see at a glance where he may and may not adjust keyframes.

## Scope Decision

This feature is what the brainstorm called **Path A** — diagnostic, read-only, produces data for humans to act on. Path B (automated suggestion of smoother profiles respecting the window boundaries) and the F-curve editor color overlay (Path C) are deferred to v1.5+ and tracked in `BACKLOG.md`.

## Domain Context

### Existing data sources we consume

- **Coverage Matrix** (from `deflectometry/coverage.py`): for each covered surface vertex, records `CameraHit(camera, first_step, last_step, duration, ...)` entries — which camera covered the vertex at which sweep steps.
- **Motion Export component list** (from `motion_export/`): the set of objects whose positions are either animated or measurably-moving across the scene's frame range. Used as the authoritative list of "actuators" in the scene.
- **Blender scene graph**: each Blender object has a `.parent` chain. Cameras and emitter meshes are typically parented to an actuator empty that drives their Z (or X) axis.

### Key concept: driving actuator

Cameras and emitters do not animate themselves in the clean scene pattern — they are parented to empties whose transforms are animated. The empty that drives a camera's effective position is its **driving actuator**. For camera `N15` parented to `referencia.altura.N15`, the driving actuator is `referencia.altura.N15`. We walk the parent chain from the camera upward until we find the first ancestor present in the motion-export component list (with any free channel). If no such ancestor exists, the camera is considered statically positioned and does not constrain any actuator.

The same rule applies to emitters tagged with `skm_is_emitter`.

## Solution

A new sub-package `motion_export/windows/` with a single public operator `SKM_OT_ComputeWindows`. On invocation:

1. Reads the cached deflectometry coverage result (`scene["_skm_coverage_json"]`). If absent, reports an error.
2. Discovers the motion-export component list (same logic as `motion_export.sampler.find_tracked_components` with `auto_detect=True`).
3. Maps each camera in the coverage result to its driving actuator via parent-chain walk.
4. Aggregates per-actuator critical frames from all `CameraHit` records whose camera maps to that actuator.
5. Compresses each actuator's critical-frame set into contiguous windows, alternating with free windows to cover the full scene frame range.
6. Paints `SKM_WIN_*` namespaced markers in the Blender timeline.
7. Caches the window data on the scene for subsequent export.

A separate `SKM_OT_ExportWindows` operator writes a ZIP containing per-actuator CSVs plus a summary JSON.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Criticality criterion | Any vertex's CameraHit touching frame F marks F as critical for that camera's actuator | Conservative — prefers false positives (overmarked critical) over false negatives (missed criticality). Refinement to "unique coverage" deferred to v1.5. |
| Camera → actuator mapping | Auto-walk parent chain up to first ancestor in motion-export component list | Zero additional tagging work; respects existing scene structure; degrades gracefully (static cameras map to nothing). |
| Coverage data source | Scene-cached `_skm_coverage_json` (from last `Compute Coverage` run) | Natural workflow: coverage → windows. Freshness warning shown in UI. Inline re-run too slow for interactive use; file-based import deferred. |
| Emitter-actuator coupling | Conservative: if any emitter is hit, *all* emitter actuators are marked critical at that step | CoverageMatrix does not track which specific emitter was hit per vertex. Tightening this requires extending Phase 1 data structures — out of scope for v1.4. |
| Output | Per-actuator CSVs + summary JSON (in ZIP) + Blender timeline markers | CSV for engineering analysis, markers for in-Blender authoring. Markers-only would hide the feature from non-Blender users; CSV-only would hide it from Tiago's workflow. |
| Marker approach | Named `SKM_WIN_<actuator>_<type>_START/END` | Namespace prefix lets `Clear Windows` remove only our markers without touching user markers. Blender API doesn't expose marker colors, so name carries type. |

## Tool Specification

### Inputs

- **Cached coverage** on `scene["_skm_coverage_json"]` (from the Deflectometry Coverage tool)
- **Motion-export component list** — re-discovered fresh on each Compute Windows run so late-added objects are picked up
- **Active frame range** — `scene.frame_start` to `scene.frame_end`

### Core computation

```
1. Parse cached coverage JSON → CoverageMatrix
2. Discover components via find_tracked_components(auto_detect=True) minus car_ref
3. Build set: actuator_names = {comp.name for comp in components}
4. For each CoverageMatrix.results[vertex_idx] that is_covered:
     For each CameraHit in hits:
       camera_obj = bpy.data.objects[hit.camera]
       driving_actuator = walk_parents_until_in_set(camera_obj, actuator_names)
       if driving_actuator is None: continue  # static camera, no constraint
       For each frame F in [hit.first_step .. hit.last_step]:
         critical_frames[driving_actuator].add(F)
5. Apply emitter-side conservatism:
     emitter_actuators = {walk_parents_until_in_set(e, actuator_names)
                          for e in scene.objects if e.get("skm_is_emitter")
                          if parent walk yields non-None}
     covered_steps = {F for vertex in covered_vertices for hit in hits
                      for F in [hit.first_step..hit.last_step]}
     For each emitter_actuator: critical_frames[a] |= covered_steps
6. For each actuator with critical_frames non-empty:
     windows = compress_to_runs(critical_frames, full_range=[frame_start..frame_end])
     # Produces alternating list of (start, end, type) entries
7. Paint markers; cache result on scene
```

### `walk_parents_until_in_set` algorithm

```python
def walk_parents_until_in_set(obj, name_set):
    cur = obj.parent
    while cur is not None:
        if cur.name in name_set:
            return cur.name
        cur = cur.parent
    return None
```

### `compress_to_runs` algorithm

Converts a set of frame numbers into a sorted alternating list of FREE/CRITICAL runs spanning the entire `[frame_start, frame_end]` range. Two adjacent CRITICAL runs separated by a gap of ≤1 frame merge into one (tolerance for sampling stride). Returns list of tuples `(start_frame, end_frame, type, n_covering_vertices)`.

### Cached data structure

```json
{
  "_skm_windows_json": {
    "exported_at": "2026-04-15T21:00:00Z",
    "frame_range": [0, 479],
    "coverage_source": {"exported_at": "2026-04-15T20:55:00Z", "samples": 474},
    "actuators": [
      {
        "name": "referencia.altura.N15",
        "type": "EMPTY",
        "driving_cameras": ["N15"],
        "total_critical_frames": 312,
        "total_free_frames": 168,
        "windows": [
          {"start_frame": 0, "end_frame": 47, "n_frames": 48, "type": "FREE", "n_covering_vertices": 0},
          {"start_frame": 48, "end_frame": 156, "n_frames": 109, "type": "CRITICAL", "n_covering_vertices": 1247},
          ...
        ]
      }
    ]
  }
}
```

### Blender timeline markers

For each window boundary of each actuator:
- Insert marker at `start_frame` named `SKM_WIN_<actuator>_<type>_START`
- Insert marker at `end_frame` named `SKM_WIN_<actuator>_<type>_END`

Where `<type>` is `CRITICAL` or `FREE`. Example:
- `SKM_WIN_referencia.altura.N15_FREE_START` at frame 0
- `SKM_WIN_referencia.altura.N15_FREE_END` at frame 47
- `SKM_WIN_referencia.altura.N15_CRITICAL_START` at frame 48
- `SKM_WIN_referencia.altura.N15_CRITICAL_END` at frame 156

The `Show Actuator` dropdown filters marker visibility: only markers matching `SKM_WIN_<selected>_*` remain on the timeline; all others get temporarily hidden by setting their `frame` to scene.frame_start - 1 (cached originals for restore on dropdown change). Simpler alternative: delete and recreate — cheap given typically <50 markers per actuator.

### Output ZIP structure

```
windows_export_<timestamp>.zip
├── summary.json          # scene meta + per-actuator totals
└── actuators/
    ├── referencia.altura.N15_windows.csv
    ├── suporte.Resistencia.001_windows.csv
    ├── height-ctrl_windows.csv
    └── contina_windows.csv
```

`summary.json`:

```json
{
  "exported_at": "2026-04-15T21:00:00Z",
  "blend_file": "v4-BASE-clean.blend",
  "scene": "Scene",
  "frame_range": [0, 479],
  "coverage_source": {"exported_at": "2026-04-15T20:55:00Z"},
  "actuators": [
    {"name": "referencia.altura.N15", "critical_pct": 65.0, "free_pct": 35.0, "n_windows": 4},
    ...
  ]
}
```

Per-actuator CSV:

```
start_frame,end_frame,n_frames,type,n_covering_vertices
0,47,48,FREE,0
48,156,109,CRITICAL,1247
157,210,54,FREE,0
211,338,128,CRITICAL,892
339,479,141,FREE,0
```

### UI

New collapsible section **"Kinematic Windows"** in the SKM Vision panel, placed below Motion Export:

| Field | Type | Description |
|-------|------|-------------|
| Coverage status | Read-only label | "Coverage cached (N vertices)" or "No coverage cached — run Compute Coverage first" |
| **Compute Windows** | Button | Runs the analysis, paints markers, caches result |
| **Clear Windows** | Button | Removes all `SKM_WIN_*` markers and the `_skm_windows_json` cache |
| Show Actuator | Enum dropdown (populated post-compute) | "All" or pick one actuator name; filters which markers are visible |
| **Export Windows** | Button | Writes the ZIP to a user-picked path |

### Public API

```python
from strokmatic_vision_tools.motion_export.windows import compute_windows, export_windows

# Inline API (e.g. for scripted batch analysis)
result = compute_windows(context)  # reads scene cache, returns the windows dict
export_windows(result, output_path)
```

### Module architecture

```
motion_export/windows/
├── __init__.py          # Public: compute_windows(), export_windows()
├── mapper.py            # camera → driving actuator resolution
├── classifier.py        # CoverageMatrix + actuator set → per-actuator windows
├── writer.py            # CSV + JSON export + ZIP packaging
└── operators.py         # SKM_OT_ComputeWindows, ClearWindows, ExportWindows
```

### Version bump

- `strokmatic_vision_tools/__init__.py`: `(1, 4, 0)`
- `strokmatic_vision_tools/blender_manifest.toml`: `"1.4.0"`
- `bl_info["description"]`: append "and kinematic window analysis"

### Testing

**Pure Python** (`tests/test_windows_classifier.py`):
- `compress_to_runs` with empty set → single FREE window spanning whole range
- `compress_to_runs` with entire range critical → single CRITICAL window
- `compress_to_runs` with alternating frames → interleaved runs
- `compress_to_runs` with gap of 1 frame → merged into single run (tolerance)
- `walk_parents_until_in_set` with chain A → B → C, set {"B"} → returns "B"
- `walk_parents_until_in_set` no ancestor in set → returns None

**Blender integration** (`tests/test_windows_integration.py`):
- Build synthetic scene: car ref (animated Y), one actuator empty (animated Z), one camera parented to that actuator, one plane, one emitter cylinder
- Run coverage → some vertices covered at specific steps
- Run `compute_windows` → verify the actuator has a critical window covering those steps and free windows covering the rest
- Verify timeline markers created with `SKM_WIN_*` prefix
- Run `Clear Windows` → verify markers gone, cache cleared
- Verify `export_windows` produces a ZIP with manifest.json + one CSV per actuator

### Manual Update

The PT-BR manual (`docs/manual-pt-br.md`) gets a new section "11. Análise de Janelas Cinemáticas" with:
- Workflow: run coverage → run windows → scrub timeline
- Interpretation of the red/green naming on markers
- Exporting for engineering
- A note that emitter-side actuators may be over-marked critical (design decision, will tighten in future)

### Performance

Negligible. The analysis is O(covered_vertices × hits_per_vertex) — on real scenes, ~100k vertices × 2-3 hits = ~300k operations. Runs in under 1 second. Timeline marker painting is the slower part (~50-200 markers inserted), but still sub-second.

### Out of Scope (tracked in BACKLOG.md)

- F-curve editor color overlay (brainstorm Path C)
- Emitter-identity tracking in CoverageMatrix (requires Phase 1 data structure extension)
- Automated profile smoothing suggestions (brainstorm Path B)
- Unique-coverage criticality mode (a stricter criterion where a frame is critical only if removing the actuator's position would demote a vertex from fully-covered to partially- or un-covered)
