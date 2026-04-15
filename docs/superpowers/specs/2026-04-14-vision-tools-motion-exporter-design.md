# Strokmatic Vision Tools — Motion Curve Exporter (v1.2.0)

**Date:** 2026-04-14
**Product:** VisionKing (Strokmatic Vision Tools Blender add-on)
**Location:** `workspaces/strokmatic/sdk/sdk-blender-tools/strokmatic_vision_tools/motion_export/`
**Prerequisite:** Vision Tools v1.1.1 (built 2026-04-14)

## Problem Statement

When a vehicle moves longitudinally through a VisionKing inspection portal, several supporting components must move on programmed paths to keep cameras and emitters aligned with the surfaces being inspected:

- Vertical actuators raise/lower N15 cameras and overhead light bars to clear the roof when transitioning from hood to roof inspection
- A "curtain" portal opens and closes to expose the rear (tampa traseira) at the right moment
- Pivoting resistance bars rotate to redirect light beams as the body passes
- Side rigs translate inward at specific phases

Today this motion is designed iteratively in Blender — Tiago animates each rig with keyframes, scrubs through frames, watches the rendered preview, and adjusts. The result is a `.blend` file that contains the correct motion law, but engineering needs that motion in tabular form (position vs. time per actuator) to specify mechanical actuators, motor profiles, and PLC programs. There is no automated way to extract this data — engineering currently reads positions visually from the Blender viewport, frame by frame.

This tool exports the relative motion of every moving component, sampled at engineer-facing units (mm, degrees) at a configurable rate, packaged as a self-documenting ZIP for hand-off.

## Domain Context

### Reference Scene (v5-gm-automacao.blend)

Inspected on 2026-04-14. Key facts that informed the design:

- **Frame range:** 0–959 (40 seconds at 24 fps), two sweep passes
- **Car reference:** an empty named `car-movement` parents body candidates (`montana.001`, `spin`, `tracker`). Only its `location[1]` (Y axis) is animated. Other body meshes are children — they inherit the motion.
- **Moving components found:** `contina` (curtain — XYZ translation), `height-ctrl` (Z only), `sobe-desce` (Z only), `N15-high` (Z only), `lat.full.003/004/005` (rotation only)
- **Cameras:** 4 cameras (N15.capo, N15.teto, N15.traseira, N6.lateral) are themselves stationary, but their parent rigs (`N15-high`, `height-ctrl`) move. The visible camera position changes via parent transforms.
- **Existing tagging:** scene already uses `oas_props` custom property (third-party rig naming). The `skm_*` namespace is free for our use.
- **Camera switching:** timeline markers at frames 0, 240, 480, 820 bind cameras to frames (NLA-style). This is the existing pattern but does not affect motion export.

### Engineering Hand-off Convention

- Positions in **millimeters** (Blender uses meters internally — convert at export boundary)
- Rotations in **degrees** (Blender uses radians internally — convert at export boundary)
- Time in **seconds** alongside frame number
- All motion expressed **relative to the car body** (the actuator setpoint, not world position)

## Solution

A new sub-package **`motion_export/`** inside the existing `strokmatic_vision_tools` add-on. Adds a "Motion Export" section to the SKM Vision sidebar panel and a Blender operator that, when invoked, samples every moving component's body-relative transform across the scene's frame range and writes a ZIP file containing a manifest plus per-component CSVs.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Car reference | Custom property `skm_is_car_reference` | Same pattern as `skm_is_emitter`; one-time tag per `.blend` |
| Component selection | Auto-detect animated objects, with `skm_track_motion` tag override | Captures everything by default; user can restrict if scene has parasitic animations |
| Channels | All 6 (X, Y, Z, RX, RY, RZ) with constrained/animated flags in manifest | Predictable column count; engineering immediately sees which axes need actuators |
| Reference frame | Body-local (`car_ref.matrix_world.inverted() @ component.matrix_world`) | Accounts for car rotation; matches actuator setpoint semantics |
| Output format | ZIP with manifest.json + per-component CSVs + car_motion.csv | Self-documenting; CSVs plot directly in Excel; ZIP is a single deliverable |
| Sample rate | User-configurable Hz, default = scene fps | Full fidelity at default; coarser/finer on demand |
| Units | mm + degrees in CSVs; manifest records the convention | Engineering convention; conversion happens once at export |

## Tool Specification

### Inputs

All sourced from the Blender scene:

- **Car reference**: object tagged with `skm_is_car_reference = True`. Exactly one. Tagging is via UI buttons.
- **Components**:
  - **Auto-detect mode (default)**: every non-camera, non-light, non-reference object whose `matrix_world.translation` or `matrix_world.to_euler()` changes between any two sampled frames in the configured range
  - **Tag mode**: only objects with `skm_track_motion = True`
- **Sample rate**: integer Hz, default = `scene.render.fps`. Effective sample frame stride is `round(scene.render.fps / sample_rate_hz)` (clamped to ≥ 1). Sampling is on integer frames only — no sub-frame interpolation.
- **Frame range**: `[start, end]`, defaults to `[scene.frame_start, scene.frame_end]`, user-overridable.

### Computation

**Pre-pass (single sweep through frames):**

```
samples = []
stride = max(1, round(fps / sample_rate_hz))
for frame in range(start, end + 1, stride):
    scene.frame_set(frame)
    car_inv = car_ref.matrix_world.inverted()
    snapshot = {"frame": frame, "time_s": (frame - start) / fps, "components": {}}
    for comp in components:
        local = car_inv @ comp.matrix_world
        translation = local.translation
        rotation = local.to_euler('XYZ')
        snapshot["components"][comp.name] = (
            translation.x, translation.y, translation.z,
            rotation.x, rotation.y, rotation.z,
        )
    samples.append(snapshot)
```

**Channel analysis (post-pass):**

For each component, for each of its 6 channels, compute `min`, `max`, `range = max - min`. A channel is:
- **Free** (animated): `range > tolerance` where `tolerance = 0.001` for translation channels (1mm), `tolerance = 0.0001745` rad ≈ 0.01° for rotation channels
- **Constrained** (constant): otherwise. Manifest records the constant value.

### Output Format

ZIP file `motion_export_<YYYY-MM-DD_HHMMSS>.zip` containing:

```
motion_export_2026-04-14_153000.zip
├── manifest.json
├── car_motion.csv
└── components/
    ├── contina.csv
    ├── height-ctrl.csv
    ├── N15-high.csv
    ├── sobe-desce.csv
    ├── lat.full.003.csv
    └── ...
```

#### `manifest.json`

```json
{
  "exported_at": "2026-04-14T15:30:00Z",
  "blend_file": "v5-gm-automacao.blend",
  "scene": "Scene",
  "frame_range": [0, 959],
  "sample_rate_hz": 24,
  "stride": 1,
  "samples": 960,
  "fps": 24,
  "car_reference": "car-movement",
  "units": {
    "translation": "mm",
    "rotation": "degrees",
    "time": "seconds"
  },
  "components": [
    {
      "name": "contina",
      "type": "MESH",
      "csv": "components/contina.csv",
      "channels": {
        "x_mm": {"free": true,  "min": -1190.0, "max": -1000.0, "range": 190.0},
        "y_mm": {"free": true,  "min":   470.9, "max":  1250.0, "range": 779.1},
        "z_mm": {"free": true,  "min":  1016.7, "max":  1500.0, "range": 483.3},
        "rx_deg": {"free": false, "value": 0.0},
        "ry_deg": {"free": false, "value": 0.0},
        "rz_deg": {"free": false, "value": 0.0}
      }
    }
  ]
}
```

#### Per-component CSV

```
frame,time_s,x_mm,y_mm,z_mm,rx_deg,ry_deg,rz_deg
0,0.0000,-1190.000,470.900,1016.700,0.000,0.000,0.000
1,0.0417,-1190.000,471.200,1016.900,0.000,0.000,0.000
...
```

Header row identifies units explicitly. Values are body-local (relative to `car_reference.matrix_world` at the same frame).

#### `car_motion.csv`

Same format and units, but the values are the car reference's **world** position (since the car is the reference, its body-local position is always zero). This file gives engineering the absolute car position at each sample, which is the "input" the actuator profiles must synchronize with.

### UI

New collapsible section **"Motion Export"** in `SKM_PT_VisionTools`:

| Field | Type | Description |
|-------|------|-------------|
| Car Reference (status line) | Read-only | Shows tagged car reference name, or "(none tagged)" |
| Tag as Car Reference | Button | Sets `skm_is_car_reference = True` on selected (and clears any other tag) |
| Untag Car Reference | Button | Removes the tag from selected |
| Auto-detect Components | Checkbox, default on | When off, only `skm_track_motion`-tagged objects are exported |
| Tag Component | Button | Sets `skm_track_motion = True` on selected |
| Untag Component | Button | Clears `skm_track_motion` on selected |
| Tracked count (status line) | Read-only | "X components will be exported" |
| Frame Start | Int | Defaults to `scene.frame_start` |
| Frame End | Int | Defaults to `scene.frame_end` |
| Sample Rate (Hz) | Int, default = scene fps | Sampling rate |
| Export Motion | Button | Opens file browser, writes ZIP to chosen path |

### Module Architecture

```
strokmatic_vision_tools/
└── motion_export/
    ├── __init__.py        # Public API: export_motion(...), tagging helpers
    ├── sampler.py         # Frame sweep + body-local transform extraction
    ├── analyzer.py        # Free/constrained channel detection, manifest builder
    ├── writer.py          # CSV writing, JSON serialization, ZIP packaging
    └── operators.py       # SKM_OT_TagCarReference, SKM_OT_UntagCarReference,
                           #   SKM_OT_TagTrackMotion, SKM_OT_UntagTrackMotion,
                           #   SKM_OT_ExportMotion
```

Updates to existing files:
- `strokmatic_vision_tools/__init__.py`: import + register `motion_export.operators`, version bump to 1.2.0
- `strokmatic_vision_tools/blender_manifest.toml`: version 1.2.0
- `strokmatic_vision_tools/ui_panel.py`: add Motion Export section + scene properties for sample rate / frame range / auto-detect

### Headless API

```python
from strokmatic_vision_tools.motion_export import export_motion

result = export_motion(
    context=bpy.context,
    output_path="/path/to/motion_export.zip",
    sample_rate_hz=24,         # optional, defaults to scene fps
    frame_start=None,          # optional, defaults to scene.frame_start
    frame_end=None,            # optional, defaults to scene.frame_end
    auto_detect=True,          # optional, defaults to True
)
# result is the manifest dict written into the ZIP
```

### Performance

Dominant cost: `scene.frame_set(f)` × `component.matrix_world` reads. Per-frame cost ~10-50 ms on real scenes (depsgraph re-evaluation). For a typical 960-frame, 10-component scene: 30-60 seconds.

Mitigations:
- Single frame_set per sampled frame (read all components in one pass)
- numpy storage of sampled values (analysis pass is vectorized)
- `wm.progress_*` reporting during the sweep

### Testing

**Pure Python tests** (`tests/test_motion_export_units.py`):
- mm conversion: input meters, expect mm with 3-decimal precision
- degree conversion: input radians, expect degrees with 3-decimal precision
- channel free/constrained detection on synthetic numpy arrays (1mm tolerance for translation, 0.01° for rotation)
- sample stride calculation: `round(fps / rate)` clamped to ≥ 1

**Blender tests** (`tests/test_motion_export_integration.py`):
- Scene: car-ref empty animated along Y (frames 0→100), one component animated only in Z, one component animated in XYZ, one stationary mesh that gets tagged
- Verify auto-detect picks up the two animated, ignores the stationary
- Verify body-local export: translate the car-ref at the start, verify component CSVs are unchanged (motion is relative)
- Verify channel flags: free for animated channels, constrained for static
- Verify ZIP structure (manifest.json + car_motion.csv + components/*.csv)
- Verify CSV row count matches sample count
- Verify with `skm_track_motion` tag mode: only tagged components exported

### Version Bump

- `strokmatic_vision_tools/__init__.py`: `"version": (1, 2, 0)`
- `blender_manifest.toml`: `version = "1.2.0"`
- `bl_info["description"]`: append "and motion export"

### Manual Update

Update `docs/manual-pt-br.md`:
- Header version → 1.2.0
- New section: "10. Exportação de Curvas de Movimento" with usage walkthrough
- New troubleshooting entries

### Out of Scope

- Bone-level export from armatures (no armatures in current scenes)
- Constraint-driven analysis (track-to, drivers — these are inputs to motion, not output)
- Velocity / acceleration computation (engineering's controller derives these from position)
- Direct PLC format conversion (CSV is universal; engineering transforms it)
- Sub-frame interpolation (sampling at higher than scene fps does not add information)
- Multi-scene aggregation (one scene per export run)
