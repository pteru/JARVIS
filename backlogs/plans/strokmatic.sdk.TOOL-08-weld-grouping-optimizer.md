# TOOL-08: Weld Grouping Optimizer — Development Plan

## Overview

A CLI/library tool that takes weld point positions (from Excel) and a 3D body model (STEP/STL), along with camera optical constraints, and computes the minimum number of camera inspection groups needed to cover all welds. Each group represents one robot pose where a camera can inspect multiple welds simultaneously.

This directly supports the SpotFusion integration workflow — replacing weeks of manual touch-up programming with an automated CAD-based analysis that outputs optimal camera positions and weld assignments.

## Context

Raised during the Nissan 02008 project (Feb 2026). Daniel Wagner (AE simulation consultant) and Pedro Teruel independently proposed extracting weld normals/nominais from CAD to auto-generate robot paths. This tool formalizes that concept as a reusable SDK utility applicable to any SpotFusion deployment.

## Inputs

### 1. Weld Points — Excel Spreadsheet
- Columns: `weld_id`, `x`, `y`, `z`, `station` (required)
- Optional columns: `nx`, `ny`, `nz` (surface normal at weld), `weld_type`, `sheet_thickness`
- If normals are not provided, the tool must estimate them from the 3D model (nearest surface normal projection)
- Support multiple sheets (one per station or one consolidated)

### 2. 3D Body Model — STEP (.stp/.step) or STL (.stl)
- Used for: normal estimation (when not in spreadsheet), collision/occlusion checking, visualization
- STEP preferred (preserves surface geometry for accurate normals); STL acceptable (mesh normals)
- May contain full body or individual station sub-assemblies

### 3. Camera Definitions — YAML/JSON config
```yaml
cameras:
  - id: "SF-200"
    name: "SpotFusion 200mm"
    focal_length_mm: 200
    sensor_width_mm: 12.8
    sensor_height_mm: 10.24
    resolution_x: 2048
    resolution_y: 1536
    min_working_distance_mm: 180
    max_working_distance_mm: 350
    depth_of_focus_mm: 40
    min_spot_diameter_px: 30  # minimum weld diameter in pixels for reliable detection

  - id: "SF-100"
    name: "SpotFusion 100mm"
    # ... same fields
```

### 4. Boundary Conditions — YAML/JSON config or CLI flags
```yaml
constraints:
  max_angle_from_normal_deg: 30    # max deviation between camera optical axis and weld surface normal
  min_distance_from_fov_border_mm: 15  # weld center must be at least this far from FOV edge
  min_working_distance_mm: 180     # override per-camera if needed
  max_working_distance_mm: 350     # override per-camera if needed
  min_gsd_mm_per_px: 0.1          # ground sampling distance constraint
  max_welds_per_group: 50         # optional hard cap
```

## Outputs

### 1. Grouping Report — JSON + Excel
```json
{
  "summary": {
    "total_welds": 312,
    "total_groups": 47,
    "camera_used": "SF-200",
    "ungrouped_welds": 3,
    "coverage_pct": 99.04
  },
  "groups": [
    {
      "group_id": 1,
      "camera_id": "SF-200",
      "station": "Floor Main",
      "camera_position": {"x": 1200, "y": 450, "z": 800},
      "camera_orientation": {"rx": -15.2, "ry": 3.1, "rz": 0},
      "working_distance_mm": 250,
      "fov_width_mm": 160,
      "fov_height_mm": 128,
      "welds": ["W001", "W002", "W005", "W008"],
      "weld_details": [
        {
          "weld_id": "W001",
          "angle_from_normal_deg": 12.3,
          "distance_from_fov_border_mm": 22.1,
          "pixel_diameter": 45
        }
      ]
    }
  ],
  "ungrouped": [
    {"weld_id": "W099", "reason": "No feasible camera angle within constraints"}
  ]
}
```

### 2. Excel Summary
- Sheet 1: Group summary (group_id, station, camera, num_welds, position)
- Sheet 2: Weld-to-group assignment (weld_id → group_id, quality metrics)
- Sheet 3: Ungrouped welds with reasons

### 3. 3D Visualization (optional, stretch goal)
- PyVista or trimesh-based viewer showing body model + weld points colored by group + camera positions/FOV cones

## Algorithm Design

### Phase 1: Preprocessing
1. Parse weld spreadsheet, validate coordinates
2. Load 3D model (Open3D for STL, CadQuery or OCP for STEP)
3. If normals missing: for each weld point, find nearest surface and compute outward normal
4. Cluster welds by station (if station column present)

### Phase 2: Candidate View Generation
For each weld point:
1. Compute candidate camera positions along the weld normal at distances between `min_working_distance` and `max_working_distance` (sample at N intervals)
2. For each candidate position, compute the FOV footprint on the local surface
3. Find all other welds visible within that FOV that satisfy all constraints (angle, border distance, working distance, resolution)
4. Store as candidate views with their weld coverage sets

### Phase 3: Set Cover Optimization
This is a **weighted set cover problem** (NP-hard, greedy approximation):
1. Universe = all weld points
2. Sets = candidate views, each covering a subset of welds
3. Weight = 1 per view (minimize total views)
4. Greedy: repeatedly pick the view covering the most uncovered welds
5. Optional: ILP solver (PuLP/OR-Tools) for exact solution on small instances

### Phase 4: Multi-Camera Selection
When multiple cameras are available:
1. Run Phase 2 for each camera independently
2. In Phase 3, candidate views from all cameras enter the same set cover
3. The optimizer naturally picks the best camera per group
4. Alternative: run per-camera, compare total groups, recommend best

### Phase 5: Refinement (optional)
- Local optimization: adjust camera positions to maximize margin on all constraints
- Collision checking: verify camera position doesn't intersect body model (ray casting)
- Merge nearby groups if combined FOV still satisfies constraints

## Technology Stack

- **Language:** Python 3.11+
- **3D geometry:** `trimesh` (STL), `cadquery` or `OCP` (STEP), `numpy` for transforms
- **Optimization:** `scipy.optimize` for local refinement, `ortools` or `PuLP` for ILP set cover
- **Excel I/O:** `openpyxl` (read/write)
- **CLI:** `click`
- **Visualization:** `pyvista` (optional dependency)
- **Config:** `pydantic` for validation of camera/constraint configs

## CLI Interface

```bash
# Basic usage
weld-grouper run welds.xlsx body.stp --cameras cameras.yaml --constraints constraints.yaml

# With options
weld-grouper run welds.xlsx body.stp \
  --cameras cameras.yaml \
  --constraints constraints.yaml \
  --station "Floor Main" \
  --solver greedy \
  --output results/ \
  --format json,xlsx

# Estimate normals only (debug)
weld-grouper normals welds.xlsx body.stp --output welds-with-normals.xlsx

# Visualize results
weld-grouper view results/grouping.json --model body.stp

# Info about model
weld-grouper info body.stp
```

## Project Structure

```
sdk/weld-grouping-optimizer/
├── pyproject.toml
├── README.md
├── src/
│   └── weld_grouper/
│       ├── __init__.py
│       ├── cli.py              # Click CLI
│       ├── models.py           # Pydantic: WeldPoint, Camera, Constraints, Group
│       ├── io/
│       │   ├── excel.py        # Read/write weld spreadsheets
│       │   ├── cad.py          # Load STEP/STL, extract normals
│       │   └── config.py       # Load camera/constraint YAML
│       ├── geometry/
│       │   ├── normals.py      # Normal estimation from mesh
│       │   ├── fov.py          # FOV projection, weld visibility
│       │   └── transforms.py   # Coordinate transforms, rotations
│       ├── optimizer/
│       │   ├── candidates.py   # Candidate view generation
│       │   ├── setcover.py     # Greedy + ILP set cover
│       │   └── refine.py       # Post-optimization refinement
│       ├── report/
│       │   ├── json_report.py
│       │   └── excel_report.py
│       └── viz/
│           └── viewer.py       # Optional 3D visualization
├── tests/
│   ├── test_normals.py
│   ├── test_fov.py
│   ├── test_setcover.py
│   └── fixtures/
│       ├── sample_welds.xlsx
│       ├── sample_body.stl
│       └── sample_cameras.yaml
└── examples/
    ├── cameras.yaml
    └── constraints.yaml
```

## Development Phases

### Phase A — Core geometry + greedy optimizer (MVP)
**Estimate: 3-4 days**
1. Pydantic models for all data types
2. Excel reader (weld points with optional normals)
3. STL loader + normal estimation via trimesh
4. FOV projection math (pinhole model)
5. Candidate view generation
6. Greedy set cover
7. JSON + Excel output
8. Click CLI (run, normals, info)
9. Unit tests for geometry and optimizer

### Phase B — STEP support + multi-camera + ILP
**Estimate: 2-3 days**
1. STEP loader via CadQuery/OCP
2. Multi-camera candidate generation
3. ILP solver (OR-Tools) as alternative to greedy
4. Solver comparison mode (greedy vs ILP)
5. Additional constraint: collision checking via ray cast

### Phase C — Visualization + polish
**Estimate: 1-2 days**
1. PyVista 3D viewer (body + welds + camera cones)
2. Interactive group highlighting
3. README with usage examples
4. Example data files

## Dependencies

### Required
- `trimesh>=4.0` — STL loading, mesh operations, ray casting
- `numpy>=1.24` — Linear algebra, coordinate transforms
- `openpyxl>=3.1` — Excel read/write
- `click>=8.0` — CLI framework
- `pydantic>=2.0` — Data validation
- `pyyaml>=6.0` — Config parsing

### Optional
- `cadquery>=2.3` — STEP file loading (Phase B)
- `ortools>=9.0` — ILP set cover solver (Phase B)
- `pyvista>=0.43` — 3D visualization (Phase C)

## References

- 02008 meeting 2026-02-17: Daniel Wagner's CAD-based path generation concept
- 02008 meeting 2026-02-14: Layout v2 with cell robot counts
- 03008 overview: Camera FOV/working distance specs for Hikrobot and SpotFusion cameras
- SpotFusion general architecture: camera positioning relative to weld normals
