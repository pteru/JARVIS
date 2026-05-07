# SEALER-03: Sealer Bead Measurement — Design Spec

> **Profile**: `vk-sealer` — 3D point cloud sealer bead inspection
> **Project**: 03008 — Hyundai Piracicaba UBS Paint Line
> **Backlog**: SEALER-03 in `backlogs/strokmatic/visionking.md`
> **Date**: 2026-05-06 (revised 2026-05-07)
> **Status**: Draft (v4 — best-fit registration moved upstream to SEALER-01; cloud arrives in CAD frame)
> **Context**: `~/Downloads/2026-04-15-sealer-03-sealer-bead-measurement-context.md`

---

## 1. Overview

The `sealer-bead-measurement` service consumes the **CAD-aligned merged point cloud** produced by `point-cloud-processor` (SEALER-01) and extracts geometric measurements from sealer beads (width, height, continuity, offset) for **per-segment pass/fail evaluation**.

The service does **not discover beads from scratch** — it requires the **theoretical bead centerlines** (3D programmed curves of the beads, defined in CAD coordinates) as mandatory input. A part may have **multiple beads**, all processed in a single execution.

### Key Design Decisions

- **Pose alignment is upstream (v4 — 2026-05-07)**: SEALER-01 publishes `merged.ply` already in CAD frame and provides `T_part_to_CAD` in the input message. SEALER-03 does **no** best-fit / ICP of its own — centerlines (in CAD coords) match the cloud (in CAD coords) directly. This is the load-bearing simplification of v4: the previous `world_to_camera @ part_origin_in_world` composition + opt-in ICP refinement are gone.
- **Centerline-driven, not data-driven**: bead localization comes from `sealer_centerline.json` per `model_type`. No PCA fallback in v1; missing centerline → NACK → DLX
- **Multi-bead per part**: single JSON file groups all beads of a part
- **Project data on bind-mounted volume**: centerlines live in `/config/sealer/{model_type}/`, not Redis
- **Naming**: `robot_path` → `sealer_centerline`, `robot_path_name` → `bead_name` (vendor-neutral terminology)
- **CAD format for `cad-relative` isolation method**: STL at runtime (Open3D native); STEP→STL conversion is offline (avoids `pythonocc-core`). The STL is only required when `sealer_bead_isolation_method = cad-relative`; in the default `ransac-plane` method no CAD asset is loaded by SEALER-03. Path is consumed from `cad_registration.stl_path` in the input message — no separate bind mount in this service.

---

## 2. Data Flow

```
                        ┌────────────────────────────────────┐
sealer-measurement-queue│   Sealer Bead Measurement          │
───────────────────────►│                                    │
  (1 msg per part,      │   /img_saved/{part_uuid}/{cam}/    │
   cloud already in     │     └─ merged.ply (CAD frame) ──┐  │
   CAD frame)           │                                 ▼  │
                        │   /config/sealer/{model_type}/     │
                        │     └─ sealer_centerline.json      │
                        │        (defined in CAD coords)     │
                        │                                    │
                        │   ┌────────────────────────────┐   │
                        │   │ 4-stage algorithm          │   │
                        │   │ 1. Centerline load (CAD)   │   │
                        │   │ 2. Transversal slicing     │   │
                        │   │ 3. Bead isolation          │   │
                        │   │ 4. Profile fit + metrics  │   │
                        │   └────────────────────────────┘   │
                        │              │                     │
                        │              ▼                     │
                        │     SealerInspectionResult         │
                        └──────────────┬─────────────────────┘
                                       │
                                       ▼  routing key: sealer.result
                              sealer-result-queue
                                       │
                                       ▼
                                 database-writer
                                 (DB_WRITER_MODE=sealer)
```

---

## 3. Inputs

### 3.1 Trigger message (`sealer-measurement-queue`)

Published by SEALER-01. The cloud and depth map referenced by this message are **already in CAD frame** (SEALER-01 has applied `T_part_to_CAD` before saving).

```json
{
  "part_uuid": "def-456",
  "vin_number": "KMHXX00XXXX000001",
  "model_type": "CRETA_2026",
  "camera_serial_number": "HK3D001",
  "total_frames": 20,
  "partial": false,
  "degraded": false,
  "merged_ply_path": "/img_saved/{part_uuid}/{cam}/merged.ply",
  "depth_map_path": "/img_saved/{part_uuid}/{cam}/depth_map.npy",
  "stitched_image_path": "/img_saved/{part_uuid}/{cam}/stitched.png",
  "depth_map_origin_mm": [x_min, y_min],
  "depth_map_resolution_mm": 0.5,
  "total_points": 1850000,
  "scan_duration_ms": 8500,
  "processed_at": "...",
  "cad_registration": {
    "T_part_to_CAD": [[1.0, 0.0, 0.0, 0.5],
                     [0.0, 1.0, 0.0, -1.2],
                     [0.0, 0.0, 1.0, 0.3],
                     [0.0, 0.0, 0.0, 1.0]],
    "rmse_mm": 0.42,
    "fitness": 0.93,
    "iterations": 18,
    "converged": true,
    "stl_path": "/cad/sealer/CRETA_2026/part.stl",
    "stl_mtime": "2026-05-01T18:30:00Z"
  }
}
```

Notes:

- `merged_ply_path` and `depth_map_path` reference files already expressed in CAD coordinates. SEALER-03 reads them as-is — no per-part transform.
- `cad_registration.T_part_to_CAD` is provided for diagnostics and traceability; SEALER-03 does not need to apply it (already applied upstream).
- If `cad_registration.converged == false` **or** `degraded == true`, see §8 Error Handling — SEALER-03 NACKs the message to the DLX without producing measurements.

See SEALER-01 spec §2 (Output Message) and §4 Stage 5 for the upstream contract.

### 3.2 Aggregated point cloud (disk)

The service reads `merged.ply` from the shared volume (same volume SEALER-01 writes to). The cloud is in **CAD coordinates** (mm). No further rigid transform is applied by SEALER-03.

### 3.3 Project data (bind-mounted volume)

Path resolved by convention from `model_type`:

```
/config/sealer/{model_type}/
└── sealer_centerline.json  # Bead centerlines (CAD coordinates) — required
```

Base directory configurable via `SBM_SEALER_CONFIG_DIR` (default `/config/sealer/`).

#### `part.stl` — single source of truth via upstream

The STL is **only** required for `sealer_bead_isolation_method = cad-relative`. To avoid drift between two bind-mounted copies, SEALER-03 reads the STL **from the path published by SEALER-01** in the input message: `cad_registration.stl_path` (e.g. `/cad/sealer/CRETA_2026/part.stl`). This same volume must therefore be mounted into the SEALER-03 container (read-only). No separate `SBM_*` env var or per-model bind mount is introduced.

- Loaded at runtime via `o3d.io.read_triangle_mesh(cad_registration.stl_path)` **only when `sealer_bead_isolation_method = cad-relative`**.
- The STL is in CAD coordinates (mm) — same frame as the merged cloud — so raycasting requires no transform.
- STEP is the source format, **converted offline** to STL via the SEALER provisioning CLI (separate tooling, not runtime).
- Reason: avoid `pythonocc-core` dependency (heavy, unstable).
- For the default `ransac-plane` method, the STL is **not** loaded by SEALER-03 (CAD geometry is exercised upstream by SEALER-01 for best-fit registration).

#### `sealer_centerline.json` schema

```json
{
  "model_type": "CRETA_2026",
  "beads": [
    {
      "name": "left_sill",
      "points": [[x0, y0, z0], [x1, y1, z1], ...],
      "expected_width_mm": 22.0
    },
    {
      "name": "right_sill",
      "points": [[...]],
      "expected_width_mm": 22.0
    }
  ]
}
```

- `points`: 3D polyline in **CAD coordinates** (mm); variable granularity (service resamples internally). Because the merged cloud also arrives in CAD frame, centerline points need no per-part transform — they overlay directly.
- `expected_width_mm`: reference width; effective search width is controlled by `sealer_search_margin_mm` in Redis.
- For tangent computation, the service may fit an internal cubic B-spline. External interface remains polyline.

### 3.4 Camera calibration

SEALER-03 does **not** require a camera calibration file. Pose alignment is handled upstream by SEALER-01 (best-fit ICP against the part STL), and the cloud arrives in CAD frame. The previous `world_to_camera` / `part_origin_in_world` extension is therefore removed from this service's contract.

---

## 4. Algorithm (4 Stages)

### Stage 1: Centerline load (CAD frame)

The merged cloud is already in CAD frame (SEALER-01 applied `T_part_to_CAD` upstream), and the centerline polyline is also defined in CAD coordinates — no per-part transform is required.

1. Validate the input message: if `cad_registration.converged == false` **or** `degraded == true`, NACK → DLX (see §8).
2. Load `sealer_centerline.json` for `model_type`. Missing/invalid → NACK → DLX.
3. For each bead: take the polyline points as-is (CAD coordinates, mm).
4. Resample at uniform arc length `sealer_slice_interval_mm` (default 5.0 mm).
5. Compute local tangents (central differences; smoothed via cubic spline if needed).

**Output**: list of `(bead_name, anchored_points[N×3], tangents[N×3], expected_width_mm)`, all in CAD frame.

> **Removed in v4 (2026-05-07)**: previous versions composed `T_part_to_camera = world_to_camera @ part_origin_in_world` to transform the centerline into camera frame, and provided an opt-in ICP refinement (`sealer_enable_icp_refinement`). Both are gone — registration is centralised in SEALER-01.

### Stage 2: Transversal slicing

For each anchored centerline sample (CAD frame):

1. Build local frame: tangent (T), normal-up (N, project +Z_CAD onto plane perpendicular to T), binormal (B = T × N).
2. From the merged point cloud (also CAD frame), select points within `sealer_search_margin_mm` (default **15.0 mm**, total 30 mm window) lateral distance to the centerline sample, and `sealer_slice_thickness_mm` (default 5.0 mm) along the tangent.
3. Express selected points in local (B, N, T) frame for downstream profile fit.

**Output**: per-sample slice as N×3 array in local frame.

### Stage 3: Bead isolation (per slice)

Method selectable via `sealer_bead_isolation_method`:

- **`z-threshold`** — threshold in N (height) relative to local surface; simplest
- **`ransac-plane`** (default) — fit RANSAC plane to slice; bead = points above plane by ≥ `sealer_min_height_above_surface_mm` (default 0.5 mm)
- **`cad-relative`** — Open3D raycasting against `part.stl`; bead = points with positive distance to mesh

**Output**: per-slice boolean mask + bead-only sub-cloud.

### Stage 4: Profile fit and metrics

For each slice's isolated bead points (projected onto B-N plane, ignoring T):

1. Fit profile via `sealer_profile_fit_model`:
   - `gaussian` (default): `h(b) = h0 * exp(-(b-b0)² / (2σ²))`
   - `parabolic`: `h(b) = a*(b-b0)² + h0`
2. Extract metrics:
   - **width** (mm): FWHM (gaussian) or zero crossings (parabolic)
   - **height** (mm): peak `h0`
   - **continuity** (%): fraction of slice samples with valid fit (R² above threshold)
   - **volume** (mm³): integral of profile × slice thickness
   - **lateral offset** (mm): `b0` — perpendicular displacement of fitted peak vs centerline (0 = on centerline)

**Output**: per-segment metrics list, per bead.

---

## 5. Pass/Fail Criteria (per segment)

| Criterion | Redis parameter | Default | Notes |
|---|---|---|---|
| Width ≥ | `sealer_tolerance_width_mm` | 3.0 | |
| Height ≥ | `sealer_tolerance_height_mm` | 1.5 | |
| Continuity ≥ | `sealer_tolerance_continuity_pct` | 80.0 | Per-bead aggregate |
| Lateral offset ≤ | `sealer_tolerance_offset_mm` | 2.0 | **Provisional — calibrate with field data** |

**Whole-part fails if any segment of any bead fails.**

---

## 6. Output (`sealer-result-queue`, routing key `sealer.result`)

```json
{
  "part_uuid": "def-456",
  "vin_number": "KMHXX00XXXX000001",
  "model_type": "CRETA_2026",
  "overall_pass_fail": true,
  "beads": [
    {
      "bead_name": "left_sill",
      "bead_pass_fail": true,
      "segments": [
        {
          "segment_id": 0,
          "arc_length_mm": 0.0,
          "width_mm": 4.2,
          "height_mm": 2.1,
          "continuity_pct": 95.3,
          "volume_mm3": 12.4,
          "position_offset_mm": 0.3,
          "pass_fail": true
        }
      ]
    },
    {
      "bead_name": "right_sill",
      "bead_pass_fail": false,
      "segments": [ ... ]
    }
  ]
}
```

- Nested: part → beads → segments
- `arc_length_mm`: position of segment along centerline (for dashboard defect localization)

---

## 7. Configuration

### 7.1 Env vars (deploy-fixed)

| Variable | Default | Description |
|---|---|---|
| `SBM_RABBIT_BROKER_HOST/PORT/USER/PASS` | — | RabbitMQ connection |
| `SBM_RABBIT_INPUT_QUEUE` | `sealer-measurement-queue` | Input queue |
| `SBM_RABBIT_OUTPUT_QUEUE` | `sealer-result-queue` | Output queue |
| `SBM_RABBIT_DURABLE` | `True` | Durable queues |
| `SBM_RABBIT_PREFETCH_COUNT` | `1` | One part at a time |
| `SBM_REDIS_HOST/PORT/PASS` | — | Redis connection |
| `SBM_REDIS_DB_SETTINGS` | `3` | Settings DB |
| `SBM_REDIS_HASH_SETTINGS` | `settings` | Settings hash key |
| `SBM_SEALER_CONFIG_DIR` | `/config/sealer/` | Project data base directory |
| `SBM_LOGGING_LEVEL` | `INFO` | Log level |

### 7.2 Runtime (Redis DB3 `settings` hash)

| Field | Default | Description |
|---|---|---|
| `sealer_slice_interval_mm` | 5.0 | Spacing between transversal slices |
| `sealer_slice_thickness_mm` | 5.0 | Slice thickness along tangent |
| `sealer_search_margin_mm` | **15.0** | Lateral search radius (full window = 2×margin) |
| `sealer_tolerance_width_mm` | 3.0 | Min width pass/fail |
| `sealer_tolerance_height_mm` | 1.5 | Min height pass/fail |
| `sealer_tolerance_continuity_pct` | 80.0 | Min continuity pass/fail |
| `sealer_tolerance_offset_mm` | 2.0 | Max lateral offset — **calibrate with real data** |
| `sealer_min_height_above_surface_mm` | 0.5 | RANSAC method: minimum bead height above plane |
| `sealer_bead_isolation_method` | `ransac-plane` | `z-threshold` \| `ransac-plane` \| `cad-relative` |
| `sealer_profile_fit_model` | `gaussian` | `gaussian` \| `parabolic` |
| `sealer_profile_fit_r2_min` | 0.7 | Min R² for valid segment (continuity counter) |

---

## 8. Error Handling

| Scenario | Action |
|---|---|
| Input message has `cad_registration.converged == false` OR `degraded == true` | **NACK → DLX**, no measurements emitted, part flagged for re-inspection (the upstream best-fit failed, so cloud is in part frame with `T = identity` and tolerances cannot be evaluated) |
| Input message missing `cad_registration` block or `T_part_to_CAD` | NACK → DLX (contract violation; SEALER-01 must produce these fields) |
| `sealer_centerline.json` missing for `model_type` | NACK → DLX + log error |
| `part.stl` missing AND `sealer_bead_isolation_method = cad-relative` | NACK → DLX + log error |
| `merged.ply` missing on disk | NACK → DLX + log error |
| Malformed message (missing required fields) | NACK → DLX |
| Profile fit fails (insufficient data) | Segment marked `pass_fail=false`, metrics `NaN`, processing continues |

---

## 9. Inherited from SEALER-01

- **Env var prefix**: `SBM_*` (Sealer Bead Measurement)
- **Settings runtime**: hash `settings` in Redis **DB3**, fields prefixed `sealer_`
- **Stack**: Python 3.10 + Open3D + numpy + scipy + aio-pika + loguru + pydantic
- **Async entry point** following `database-writer` pattern
- **Dockerfile**: `python:3.10-slim` (Open3D requires glibc — no alpine)
- **TDD**: tests-first, `fakeredis` for unit tests
- **Communication clients**: copy `rabbit_client.py`, `config.py`, `exceptions.py` from `database-writer`

---

## 10. Resource Budget (topology)

**2 GB RAM, 1 CPU** — sufficient to process one part (N beads) at a time. Aligned with `topologies/sealer-single-node.yaml`.

Since v4 (2026-05-07), SEALER-03 no longer runs ICP / best-fit registration (moved to SEALER-01). This removes ~300–500 ms of per-part work and ~5 MB of cached CAD-target data from this service's footprint; the saved cycle time has been absorbed by the upstream stage.

---

## 11. Upstream / Downstream Dependencies

### Upstream (required)

- **SEALER-01 (point-cloud-processor)** — must produce:
  - `merged.ply` already in CAD frame (post-ICP), saved to `/img_saved/{part_uuid}/{camera_serial}/merged.ply`.
  - Output message on `sealer-measurement-queue` containing `merged_ply_path`, `depth_map_path`, `depth_map_origin_mm`, `depth_map_resolution_mm`, and a `cad_registration` block with `T_part_to_CAD` (4×4), `rmse_mm`, `fitness`, `converged`, `stl_path`.
  - When `cad_registration.converged == false` or the scan is otherwise `degraded == true`, SEALER-01 still publishes the message (with `T_part_to_CAD = identity`); SEALER-03 then NACKs to DLX (see §8).
  - See `2026-04-13-sealer-01-point-cloud-processor-design.md` §2 (Output Message) and §4 Stage 5.

### Downstream

- `database-writer` (with `DB_WRITER_MODE=sealer`) consumes `sealer-result-queue`.

---

## 12. Out of Scope (v2 ideas)

- **2D image fallback**: when `sealer_centerline.json` is missing, infer bead from stitched RGB (segmentation + skeletonization + 2D→3D projection)
- **Per-segment dynamic tolerances**: different thresholds along the same bead (curves vs straights)
- **Multi-camera fusion**: assumed single camera in v1; multi-camera composition deferred

---

## 13. References

- **Pipeline architecture**: `architecture/vk-sealer-pipeline.md` (stage 5)
- **SEALER-01 spec**: `docs/superpowers/specs/2026-04-13-sealer-01-point-cloud-processor-design.md`
- **SEALER-01 plan**: `docs/superpowers/plans/2026-04-13-sealer-01-point-cloud-processor.md`
- **Centerline anchoring pattern reference** (not direct reuse):
  - Schema: `services/pixel-to-object/data/rois.json`
  - Projection: `services/pixel-to-object/src/transformer.py:231-241`
  - ROI filter: `services/pixel-to-object/src/server.py:124-145`
- **Downstream**: `database-writer` with `DB_WRITER_MODE=sealer` (SEALER-05) writes to `sealer_measurements` + `sealer_inspection_summary`
- **Backlog**: `backlogs/strokmatic/visionking.md` — SEALER-03

---

## 14. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-05-06 | Pedro Teruel | Initial design (v3): centerline-driven, multi-bead per part, bind-mounted project data, fixed pose per `camera_serial_number` from calibration file with optional ICP refinement. |
| 2026-05-07 | Pedro Teruel | Removed best-fit ICP responsibility (moved to SEALER-01). Cloud now arrives in CAD frame; centerline anchoring is direct. Failure mode: NACK→DLX on degraded input. Removed `SBM_CAMERA_CALIBRATION_FILE`, `sealer_enable_icp_refinement`, and the `world_to_camera @ part_origin_in_world` composition step. Input message schema extended with `cad_registration`, `depth_map_origin_mm`, `depth_map_resolution_mm`. |
