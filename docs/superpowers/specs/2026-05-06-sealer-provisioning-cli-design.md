# [4.9] Sealer Provisioning CLI (Fase 1) — Design Spec

> **Profile**: `vk-sealer`
> **Project**: 03008
> **Backlog**: SEALER-PROV-CLI (NEW, identified 2026-05-06)
> **Date**: 2026-05-06
> **Status**: Draft
> **Phase**: 1 (Strokmatic-only handover, no GUI)

---

## 1. Overview

The sealer pipeline reads project data from a bind-mounted folder `/config/sealer/{model_type}/`:

```
/config/sealer/CRETA_2026/
├── part.stl                  # Triangle mesh CAD
└── sealer_centerline.json    # 3D bead centerlines (consumed by SEALER-03, SEALER-01 per-frame projection, and downstream [4.11] inference)
```

`sealer_centerline.json` is the **single source of truth** for bead geometry. **Three consumers post-2026-06-01:**
- **SEALER-03** uses it to extract 3D measurements from `merged.ply`.
- **SEALER-01** (point-cloud-processor) reads it during Stage 7 and **projects each centerline point per frame** into pixel coords (using intrinsics + extrinsics + `T_part→CAD`), publishing the resulting `centerline_projected[]` to `sealer-inference-queue`.
- **[4.11] inference** (profile `sealer-per-frame`) consumes the projected `centerline_projected[]` from SEALER-01 and samples a window per point. It does **not** read `sealer_centerline.json` directly anymore (was used by the pre-pivot stitched-image flow).

This spec defines a **Phase 1 CLI tooling suite** to produce these files from upstream sources (STEP CADs and robot path exports). **No GUI** — Strokmatic engineering operates manually per new car model. GUI is deferred to **Phase 2 backlog** (separate epic, post-comissionamento).

---

## 2. CLI Tools

| Tool | Input | Output | Purpose |
|---|---|---|---|
| `step2stl` | `*.step` from Hyundai | `part.stl` | Convert STEP CAD to triangulated mesh |
| `centerline-extractor` | Robot path file (format TBD) | `sealer_centerline.json` | Extract 3D bead curves grouped by name |
| `validator` | `part.stl` + `sealer_centerline.json` | (exit code + report) | Sanity check: centerlines lie near surface |
| `provision` | Folder of inputs | Full `/config/sealer/{model}/` | Orchestrator that runs all the above |

Three authoring tools plus the `provision` orchestrator (4 CLIs total). All implemented as Python CLIs via `click`, packaged in `tools/sealer-provisioning/`.

---

## 3. Why CLI in Phase 1

- Phase 1 has 3 expected models (Creta 2026 + HB20 4D + HB20 5D); manual run by Strokmatic engineer is acceptable
- Avoids GUI dev cost (~3 weeks of frontend work) on critical path to comissionamento
- GUI Phase 2 (operator-friendly, integrated with backend-sealer) is in backlog
- CLI is the long-term backend even if a GUI is added later — GUI just calls these tools

---

## 4. `step2stl`

Converts STEP CAD (Hyundai-provided) into triangulated STL.

```bash
step2stl input.step output.stl --tolerance 0.1 --angular-deflection 0.5
```

| Option | Default | Notes |
|---|---|---|
| `--tolerance` | 0.1 mm | Linear deflection (max chord error) |
| `--angular-deflection` | 0.5 rad | Max angle between adjacent triangles |
| `--units` | `mm` | STEP frequently uses mm; can override to inch |
| `--y-up` | false | Force Y-up if STEP has Z-up convention |

**Implementation**: `pythonocc-core` (OpenCascade Python wrapper). Heavy dependency, isolated in **dedicated venv** under `tools/sealer-provisioning/.venv-occ/` (not in service runtimes).

**Validation**:
- Output STL has > 1000 triangles (sanity for car body)
- Mesh is watertight (`trimesh.is_watertight`)
- Bounding box reasonable (1m–10m on largest axis for car bodies)

---

## 5. `centerline-extractor`

**Input**: robot path file. Format **TBD by Hyundai** (pendency [1.4]). Likely candidates:
- ABB rapid `.mod` files (common for sealer robots)
- Generic CSV with columns `bead_name, x, y, z`
- Proprietary JSON

Phase 1 implementation supports **CSV** as the lowest common denominator + plug-in parser for whatever format Hyundai provides.

```bash
centerline-extractor robot_path.csv output.json \
    --model-type CRETA_2026 \
    --bead-mapping "left_sill:LFT_SILL,right_sill:RGT_SILL"
```

| Option | Notes |
|---|---|
| `--model-type` | written into output JSON `model_type` field |
| `--bead-mapping` | comma-separated `output_name:input_name` pairs |
| `--default-width-mm` | 22.0 — used for `expected_width_mm` if not in source |
| `--frame-transform` | optional 4×4 matrix to shift from robot base frame to part frame |

**Output**: `sealer_centerline.json` (schema per SEALER-03 spec).

**Validation**:
- ≥ 2 points per bead
- Sequential points within reasonable distance (no jumps > 100mm)
- All bead names unique

---

## 6. `validator`

Cross-checks consistency between `part.stl` and `sealer_centerline.json` to catch frame-mismatch bugs early.

```bash
validator /config/sealer/CRETA_2026/ --max-distance-mm 10.0
```

**Checks**:
- `part.stl` is present and valid (Open3D readable, mm units, sane bbox 1m–10m on largest axis)
- `sealer_centerline.json` is present, schema-valid, all bead points expressed in CAD frame
- All centerline points within `--max-distance-mm` of nearest STL surface point (via Open3D raycaster)
- No centerline points inside the mesh (signed distance > 0)

**Output**: text report + exit code 0/1.

---

## 7. `provision` (orchestrator)

Convenience wrapper:

```bash
provision \
    --step input/CRETA_2026.step \
    --robot-path input/robot_path_creta_2026.csv \
    --model-type CRETA_2026 \
    --output /config/sealer/
```

Runs `step2stl` → `centerline-extractor` → `validator` in sequence; exits at first failure.

---

## 8. Packaging

```
tools/sealer-provisioning/
├── pyproject.toml           # Defines package + entry points
├── README.md                 # Provisioning runbook
├── requirements.txt          # numpy, click, trimesh, pyyaml, open3d
├── requirements-occ.txt      # Isolated: pythonocc-core (heavyweight)
├── src/sealer_provisioning/
│   ├── __init__.py
│   ├── step2stl.py
│   ├── centerline_extractor.py
│   ├── validator.py
│   ├── provision.py
│   └── parsers/              # Pluggable robot path format parsers
│       ├── csv_parser.py
│       └── (future: abb_rapid_parser.py, hyundai_xxx.py)
└── tests/
```

`pyproject.toml` exposes entry points so installed CLIs are global within the venv.

**OCC isolation**: `step2stl` shells out to a separate venv where `pythonocc-core` is installed. The other tools live in a lighter venv to keep iteration fast.

---

## 9. Out of Scope (Phase 2 backlog)

- Web upload portal for STEP files
- Automatic centerline extraction from CAD geometry (without robot path input)
- Integration with backend-sealer for in-app provisioning workflow
- Versioning of model_type configurations (e.g., CRETA_2026_v2)
- ABB RAPID native parser (until Hyundai confirms format)

---

## 10. Phase 1 Operational Runbook

When Hyundai delivers a new car model:

1. Receive `*.step` (CAD) and robot path file from Hyundai
2. (Engineer) Run `provision` CLI → produces `/config/sealer/{model_type}/`
3. (Engineer) Run `validator` → confirm green
4. Deploy to production node (rsync `/config/sealer/{model_type}/`)
5. Verify by triggering one inspection on a sample part

Estimated time per model: **~20 min** (assuming inputs are clean).

---

## 11. References

- SEALER-03 spec (centerline JSON schema; `sealer_centerline.json` is the input contract)
- `2026-06-01-sealer-inference-per-frame-design.md` (substitui [4.11]) — consome `centerline_projected[]` já em pixel coords (não lê `sealer_centerline.json` direto)
- `2026-04-13-sealer-01-point-cloud-processor-design.md` §4 Stage 7 — consome `sealer_centerline.json` na projeção per-frame
- [4.13] E2E test spec (uses synthetic outputs of these tools as fixtures)

---

## Revision History

- **2026-06-01** — Centerline consumer list reorganised after the SEALER architectural pivot: SEALER-01 now consumes `sealer_centerline.json` during a new per-frame centerline projection stage, and publishes pixel-coord points to the inference. The inference itself no longer reads the JSON. SEALER-03 consumption unchanged. Schema unchanged on this side (the `bead_id` + `expected_height_mm` additions are tracked in SEALER-03 §3.3, which is the SSOT for the schema).
- **2026-05-07** — Removed `roi-builder` CLI tool and `sealer_2d_rois.json` artifact. The (then-current) 2D inference service derived ROIs at runtime from `sealer_centerline.json` + depth_map metadata — single source of truth between SEALER-03 and inference. Saved the authoring step entirely. Tool count reduced from 5 to 4; estimated provisioning time reduced from ~30 min to ~20 min per model. *(Note 2026-06-01: the runtime-ROI-derivation flow was itself superseded — see entry above.)*
- **2026-05-06** — Initial draft.
