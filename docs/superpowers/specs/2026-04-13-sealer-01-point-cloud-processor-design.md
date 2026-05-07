# SEALER-01: Point Cloud Processor — Design Spec

> **Profile**: `vk-sealer` — 3D point cloud sealer bead inspection
> **Project**: 03008 — Hyundai Piracicaba UBS Paint Line
> **Backlog**: SEALER-01 in `backlogs/strokmatic/visionking.md`
> **Date**: 2026-04-13 (revised 2026-05-07)
> **Status**: Draft

---

## 1. Overview

The `point-cloud-processor` is a **multi-frame aggregator with 3D processing** for the VisionKing sealer pipeline. A Hikrobot MV-DLS1400M-15 galvanometric laser camera mounted on a 2.5 m linear axis captures multiple point cloud frames as it scans a car body panel. This service:

1. Accumulates individual frame messages (PLY + BIN) from the same part (identified by VIN number)
2. Registers and merges the point clouds into a single cloud using known encoder positions
3. **Best-fit registers the merged cloud against the CAD STL of the part**, producing `T_part→CAD` and yielding a cloud expressed in CAD coordinates
4. Stitches the 2D images into a composite view
5. Generates a depth map (2D projection in CAD frame) for ROI projection and ML inference
6. Publishes results downstream (measurement + inference queues), including `T_part→CAD` so consumers can reason about CAD-frame geometry

### Key Design Decisions

- **Accumulation pattern**: Redis hash per scan (same as DieMaster `StrokeAccumulator`)
- **Frame count**: Configurable per Model Type via Redis DB3 `settings` hash; falls back to timeout-only if not configured
- **Inter-frame registration**: Translation-only using known encoder positions (no ICP)
- **CAD registration**: ICP point-to-plane against the part STL after merge — yields `T_part→CAD` and publishes the consolidated cloud + depth map already in CAD frame. Centralising it here means **downstream services (sealer-bead-measurement, sealer-2d inference) consume CAD-aligned outputs without re-running ICP**, and ROIs can be defined in CAD space and projected per part.
- **Overlap handling**: Voxel grid downsampling (simple, effective)
- **Image stitching**: Undistort + translation + linear feathering, with optional ECC refinement
- **Four outputs in Phase 1**: merged PLY (in CAD frame), stitched PNG, depth map NPY (in CAD frame), `T_part→CAD`

---

## 2. Data Flow

```
                         ┌─────────────────────────────────┐
  sealer-processed-queue │   Point Cloud Processor         │
  ──────────────────────►│                                 │
   (1 msg per frame)     │  ┌───────────────────────┐      │
                         │  │ ScanAccumulator       │      │
                         │  │ Redis DB (hash)       │      │
                         │  │                       │      │
                         │  │ scan:{vin}:{ts}       │      │
                         │  │  ├ frame:0 → metadata │      │
                         │  │  ├ frame:1 → metadata │      │
                         │  │  ├ _received: "0,1"   │      │
                         │  │  ├ _expected: 20      │      │
                         │  │  └ _last_seen: epoch  │      │
                         │  └───────────────────────┘      │
                         │           │ complete?           │
                         │           ▼                     │
                         │  ┌───────────────────────────┐      │     /img_saved/{part_uuid}/{cam}/
                         │  │ Processing Pipeline       │      │     /cad/sealer/{model_type}/
                         │  │ 1. Load PLY+BIN           │◄─────┼──── *.ply + *.bin (raw frames)
                         │  │ 2. SOR per frame          │      │
                         │  │ 3. Translate (encoder)    │      │
                         │  │ 4. Merge + voxel down     │      │
                         │  │ 5. CAD best-fit (ICP)     │◄─────┼──── part.stl
                         │  │     → T_part→CAD          │      │
                         │  │     → apply T to cloud    │──────┼───► merged.ply (CAD frame)
                         │  │ 6. Undistort + stitch     │──────┼───► stitched.png
                         │  │ 7. Generate depth map     │──────┼───► depth_map.npy (CAD frame)
                         │  └───────────────────────────┘      │
                         │           │                     │
                         └───────────┼─────────────────────┘
                                     │
                      ┌──────────────┴──────────────┐
                      ▼                             ▼
          sealer-measurement-queue       sealer-inference-queue
          (bead-measurement)             (inference, Phase 2)
```

### Input Message (from `sealer-processed-queue`)

```json
{
  "frame_uuid": "abc-123",
  "part_uuid": "def-456",
  "vin_number": "KMHXX00XXXX000001",
  "model_type": "CRETA_2026",
  "camera_serial_number": "HK3D001",
  "frame_number": "5",
  "frame_path": "/img_saved/def-456/HK3D001/",
  "frame_file": "a1b2c3.ply",
  "image_file": "a1b2c3.bin",
  "encoder_position_mm": 520.0,
  "frame_created_at": "2026-05-27T14:30:05.123Z",
  "frame_captured_at": "2026-05-27T14:30:05.100Z"
}
```

### Output Message (to both downstream queues)

```json
{
  "part_uuid": "def-456",
  "vin_number": "KMHXX00XXXX000001",
  "model_type": "CRETA_2026",
  "camera_serial_number": "HK3D001",
  "total_frames": 20,
  "partial": false,
  "degraded": false,
  "merged_ply_path": "/img_saved/def-456/HK3D001/merged.ply",
  "depth_map_path": "/img_saved/def-456/HK3D001/depth_map.npy",
  "stitched_image_path": "/img_saved/def-456/HK3D001/stitched.png",
  "total_points": 1850000,
  "scan_duration_ms": 8500,
  "processed_at": "2026-05-27T14:30:14.000Z",
  "depth_map_origin_mm": [-450.0, -1200.0],
  "depth_map_resolution_mm": 0.5,
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

`T_part_to_CAD` is the 4×4 rigid transform that has **already been applied** to `merged.ply` and to the cloud underlying `depth_map.npy`. Consumers should treat both files as expressed in CAD coordinates. `depth_map_origin_mm = [x_min, y_min]` and `depth_map_resolution_mm` describe the grid origin and pixel size in CAD coordinates so consumers can map pixel ↔ CAD position without ambiguity. The matrix is published for diagnostics, drift monitoring, and to allow consumers (e.g. 2D inference) to project CAD-frame ROIs into pixel space without re-running ICP.

If `cad_registration.converged=false` (RMSE above the threshold or ICP fails to find enough inliers), the message is published with `degraded=true`, `T_part_to_CAD = identity`, and the cloud and depth map are kept in part frame. Downstream services should fail safe — no measurements emitted; the part is flagged for re-inspection.

---

## 3. ScanAccumulator (Redis)

### Redis Structure

Uses a dedicated Redis DB (configurable via `PCP_REDIS_DB_ACCUMULATOR`). Each in-progress scan is a hash:

```
Key: scan:{vin_number}:{first_frame_timestamp}

Fields:
  frame:0         → JSON { "frame_uuid": "...", "frame_path": "...", "frame_file": "a1b2.ply",
                            "image_file": "a1b2.bin", "encoder_position_mm": 50.0, ... }
  frame:1         → JSON { ... }
  frame:N         → JSON { ... }
  _received       → "0,1,2,3"          (CSV of received frame_numbers)
  _expected       → 20                  (from model_type → expected_frames map)
  _model_type     → "CRETA_2026"
  _part_uuid      → "def-456"
  _camera_serial  → "HK3D001"
  _last_seen      → 1748357405.123     (epoch of last frame received)
```

Automatic TTL: `PCP_SCAN_TTL` (default: 300s, 10× timeout). Safety net for orphaned scans.

### Frame Count Configuration (Redis DB3)

```
Redis DB3 — Hash: settings

Field: sealer_model_frames_map
Value: '{"CRETA_2026": 20, "HB20_2025": 18, "TUCSON_2026": 22}'
```

Read via `HGET settings sealer_model_frames_map` before each scan's pipeline runs.

### Completion Modes

| Scenario | Processing Trigger |
|----------|-------------------|
| `sealer_model_frames_map` exists and contains `model_type` | `received >= expected` **or** timeout |
| `sealer_model_frames_map` exists but `model_type` absent | Timeout-only + log warning |
| `sealer_model_frames_map` does not exist in Redis | Timeout-only + log warning at startup |

Timeout always acts as a safety net. With the map, processing triggers immediately when the last frame arrives (no waiting for timeout).

### Accumulation Logic

```
on_message(msg):
  1. Extract vin_number, model_type, frame_number from msg
  2. Read sealer_model_frames_map from Redis DB3 settings hash
  3. expected = map[model_type] if available, else None (timeout-only)
  4. Find or create hash scan:{vin}:* in Redis
     - _find_existing_scan(vin) via SCAN pattern match
     - If not found, create new hash with _expected, _model_type, _part_uuid
  5. Update hash (atomic pipeline):
     - HSET frame:{frame_number} → JSON metadata
     - HSET _received → append frame_number to CSV
     - HSET _last_seen → now()
     - EXPIRE key → PCP_SCAN_TTL
  6. Check completeness:
     - expected is set AND len(received) >= expected → trigger processing
  7. After every message, call flush_stale_scans():
     - SCAN for keys scan:*
     - If now() - _last_seen > PCP_SCAN_TIMEOUT → flush partial
```

### Timeout and Partial Scan Flush

| Parameter | Default | Description |
|-----------|---------|-------------|
| `PCP_SCAN_TIMEOUT` | `30` | Seconds without new frames before processing partial |
| `PCP_SCAN_TTL` | `300` | Redis key TTL (cleanup of orphaned scans) |
| `PCP_FRAME_TIMESTAMP_TOLERANCE_MS` | `60000` | Window to group frames into the same scan (60s) |

On partial flush:
- Log warning: `"Flushing partial scan: vin={vin} ({received}/{expected} frames, stale for {duration}s)"`
- Process available frames (merge of N < expected)
- Output message includes `"partial": true, "total_frames": N`

### Duplicates

If a `frame_number` already exists in `_received`, the frame is ignored (idempotent). Log info and ACK without reprocessing.

### Recovery After Restart

On startup, scan Redis for existing `scan:*` keys and call `flush_stale_scans()` to process scans left pending before the restart.

---

## 4. Processing Pipeline

When a scan is complete (or times out), the pipeline executes 7 sequential stages.

### Stage 1 — Load

Read all frames from disk, ordered by `encoder_position_mm` ascending:

- **PLY**: read via Open3D (`o3d.io.read_point_cloud`)
- **BIN**: read as bytes, format detected by magic bytes:
  - `FF D8 FF` → JPEG
  - `89 50 4E 47` → PNG
  - Decoded via OpenCV (`cv2.imdecode`)

Result: ordered list of tuples `(encoder_position, point_cloud, image)`.

### Stage 2 — Statistical Outlier Removal (per frame)

SOR on each individual cloud **before** merge. Smaller clouds = faster KD-tree, and removes noise that would degrade the merge.

- Open3D `statistical_outlier_removal(nb_neighbors, std_ratio)`
- Parameters read from Redis DB3 `settings` hash (see Configuration section)

### Stage 3 — Registration

Translation of each cloud using the absolute encoder position. Shift between frames is the difference of positions:

```python
shift = frame.encoder_position_mm - frames[0].encoder_position_mm
translation_vector = shift * shift_unit_vector
# Default shift_unit_vector = [0, 1, 0] (Y axis)
```

Each cloud receives a pure translation transform (4×4 identity + translation). No rotation — the camera is rigidly mounted on the linear axis carriage.

The shift unit vector is configurable via env var `PCP_SHIFT_UNIT_VECTOR` (JSON array, e.g., `[0,1,0]`).

### Stage 4 — Merge + Voxel Downsampling

After translation, clouds are concatenated and overlap is handled:

1. **Concatenation**: extend a single `o3d.geometry.PointCloud` with all translated clouds
2. **Voxel downsampling**: `merged.voxel_down_sample(voxel_size)` — normalizes density in overlap regions (points within the same voxel are replaced by their mean)

The cloud at this point is in **part frame** (encoder-translated camera coordinates). It is **not yet saved**; saving happens after Stage 5 transforms it to CAD frame.

### Stage 5 — CAD Registration (Best-Fit ICP)

After merge, the consolidated cloud is in part frame. To make downstream services able to reason about CAD-known geometry (centerlines, ROIs, tolerance zones), this stage computes the rigid transform `T_part→CAD` that aligns the cloud with the part STL, and applies it to the cloud (in place).

#### CAD asset loading

For each `model_type`, the part STL is loaded from `${PCP_CAD_DIR}/${model_type}/part.stl` and cached in memory across messages. Cache invalidates if the file's `mtime` changes (allows hot-swap of CAD without restart).

The STL is sampled into a target point cloud once per `model_type` (cached) using `sample_points_uniformly(number_of_points=cad_target_sample_size)`, default 50_000 points. Sampling is deterministic (fixed seed) so that the same STL produces the same target across runs.

#### Algorithm

1. **Initial alignment** — bounding-box centroid of merged cloud aligned to centroid of CAD target. Cheap (~10 ms) and sufficient for fixture-positioned parts where mechanical drift is bounded (≤10 mm translation, ≤2° rotation typical for the Hyundai paint-line fixture).
2. **ICP point-to-plane** (Open3D `registration_icp` with `TransformationEstimationPointToPlane`):
   - `max_correspondence_distance` from settings (default 5.0 mm)
   - Convergence criteria: `relative_fitness=1e-6`, `relative_rmse=1e-6`, `max_iteration` from settings (default 50)
   - Source: voxel-downsampled merged cloud (voxel = `cad_icp_voxel_size`, default 1.0 mm) — keeps ICP fast and robust to density mismatch
   - Target: CAD-sampled point cloud with normals (computed once at first sampling)
3. **Acceptance check**:
   - `rmse_mm < cad_registration_rmse_threshold_mm` (default 3.0 mm)
   - `fitness > cad_registration_min_fitness` (default 0.7) — fitness = ratio of source points with a CAD correspondent within `max_correspondence_distance`
4. **Apply T to merged cloud** (in place): `merged.transform(T)` — cloud is now in CAD frame.
5. **Save** `merged.ply` to `/img_saved/{part_uuid}/{camera_serial}/merged.ply`. The file is **always in CAD frame on success**, or in part frame with `T = identity` on failure.

#### Failure modes

| Condition | Action |
|---|---|
| STL missing for `model_type` at `${PCP_CAD_DIR}/${model_type}/part.stl` | NACK→DLX (config error). Operator must provision the CAD before retry. |
| ICP rmse > threshold OR fitness < min | Publish with `degraded=true`, `cad_registration.converged=false`, `T_part_to_CAD = identity`, cloud saved in part frame. Downstream services skip measurements (fail-safe). |
| ICP raises (e.g. empty point cloud) | Same as above (treated as non-convergence). |
| STL unreadable (corrupt, wrong format) | NACK→DLX (config error). |

#### Output

- `merged.ply` saved (in CAD frame on success, part frame on failure with identity T)
- `T_part_to_CAD` (4×4 list-of-lists, in mm) and diagnostics in the output message:

```json
"cad_registration": {
  "T_part_to_CAD": [[...4x4...]],
  "rmse_mm": 0.42,
  "fitness": 0.93,
  "iterations": 18,
  "converged": true,
  "stl_path": "/cad/sealer/CRETA_2026/part.stl",
  "stl_mtime": "2026-05-01T18:30:00Z"
}
```

`fitness` is the Open3D-reported ratio of source points with a target correspondent within `max_correspondence_distance` (single canonical inlier metric — no separate `inliers_pct` field).

`iterations` is `null` (or omitted) by default because the Open3D version pinned in this service does not expose the actual ICP iteration count — only the converged transformation, RMSE and fitness. The field is reserved for future provider implementations that do expose it; consumers must not interpret `null` as "ran to max_iterations".

#### Performance

For Hyundai Creta CAD (~50k vertices, ~50k sampled target) and merged cloud ~1.8M points → 50k after voxel downsampling:

- STL load + sample (cold cache): ~80 ms
- Initial alignment: <10 ms
- ICP point-to-plane (50 iterations max): ~150–300 ms
- Apply T + save: ~50 ms
- **Total stage budget**: ~500 ms (warm cache: ~400 ms)

### Stage 6 — Image Stitching

Composition of 2D images by translation (same principle as point clouds):

1. **Undistort**: correct lens distortion on each frame using camera intrinsic matrix (K) and distortion coefficients (D)
   - `cv2.undistort(frame, K, D)` or `cv2.remap` with pre-computed maps (faster for N frames)
   - K and D loaded from calibration file: `PCP_CAMERA_CALIBRATION_FILE` (YAML or JSON, standard OpenCV format)
   - Remap maps computed once at startup and reused for all frames
2. **Position** each corrected frame on the canvas using encoder shift converted to pixels:
   - `shift_px = shift_mm * sealer_image_pixels_per_mm`
3. **Linear feathering** (alpha ramp) in the overlap band between consecutive images

Output: `stitched.png` saved to `/img_saved/{part_uuid}/{camera_serial}/stitched.png`

### Stage 7 — Depth Map Generation

2D projection of the merged cloud (already in CAD frame after Stage 5) for ROI projection and ML inference:

1. Project the cloud onto the CAD-XY plane (top-down view of the body panel in CAD coordinates)
2. Each pixel = minimum Z value of points falling in the cell
3. Pixel grid origin and resolution determined by the cloud's bounding box and `sealer_depth_map_resolution_mm`. The grid origin (`x_min`, `y_min` in CAD mm) is published in the output message so consumers can map pixel ↔ 3D CAD coordinates without ambiguity.
4. Format: numpy array float32 + sidecar metadata

Output:
- `depth_map.npy` saved to `/img_saved/{part_uuid}/{camera_serial}/depth_map.npy`
- `depth_map_origin_mm = [x_min, y_min]` and `depth_map_resolution_mm` in output message

### Output Summary

| File | Format | Stage | Frame | Consumer |
|------|--------|-------|-------|----------|
| `merged.ply` | PLY (binary) | 5 (saved after CAD transform) | CAD | sealer-bead-measurement |
| `stitched.png` | PNG | 6 | image (per-frame undistorted, encoder-aligned) | sealer-2d inference, dashboard |
| `depth_map.npy` | numpy float32 | 7 | CAD (XY) | sealer-2d inference (pixel↔CAD mapping) |

---

## 5. Configuration

### Runtime Settings (Redis DB3 — Hash `settings`)

Adjustable without restart. Read before each scan's pipeline runs.

| Field | Default | Stage | Description |
|-------|---------|-------|-------------|
| `sealer_model_frames_map` | `{}` | Accumulator | JSON map of model_type → expected frame count |
| `sealer_outlier_nb_neighbors` | `20` | 2 | SOR: number of neighbors for mean distance |
| `sealer_outlier_std_ratio` | `2.0` | 2 | SOR: standard deviation multiplier threshold |
| `sealer_voxel_size` | `0.5` | 4 | Voxel grid size in mm for downsampling |
| `sealer_image_pixels_per_mm` | (required) | 6 | Pixel-to-mm ratio from camera calibration |
| `sealer_depth_map_resolution_mm` | `0.5` | 7 | Depth map pixel size in mm (CAD frame) |
| `sealer_cad_target_sample_size` | `50000` | 5 | Number of points sampled from STL into ICP target |
| `sealer_cad_icp_voxel_size_mm` | `1.0` | 5 | Voxel size for source cloud downsampling before ICP |
| `sealer_cad_icp_max_correspondence_distance_mm` | `5.0` | 5 | ICP correspondence cutoff |
| `sealer_cad_icp_max_iterations` | `50` | 5 | ICP iteration cap |
| `sealer_cad_registration_rmse_threshold_mm` | `3.0` | 5 | RMSE above which result is flagged degraded |
| `sealer_cad_registration_min_fitness` | `0.7` | 5 | Min ICP fitness ratio for success |

### Deploy Configuration (Env Vars `PCP_*`)

Fixed at deploy time. Require restart to change.

| Parameter | Description |
|-----------|-------------|
| `PCP_RABBIT_BROKER_HOST/PORT/USER/PASS` | RabbitMQ connection |
| `PCP_RABBIT_INPUT_QUEUE` | Input queue (`sealer-processed-queue`) |
| `PCP_RABBIT_MEASUREMENT_QUEUE` | Output queue for bead measurement |
| `PCP_RABBIT_INFERENCE_QUEUE` | Output queue for inference |
| `PCP_REDIS_HOST/PORT/PASS` | Redis connection |
| `PCP_REDIS_DB_ACCUMULATOR` | Redis DB for scan accumulation |
| `PCP_SCAN_TIMEOUT` | Seconds without new frames before processing partial (default: 30) |
| `PCP_SCAN_TTL` | Redis key TTL for orphaned scan cleanup (default: 300) |
| `PCP_FRAME_TIMESTAMP_TOLERANCE_MS` | Window to group frames into same scan (default: 60000) |
| `PCP_SHIFT_UNIT_VECTOR` | Camera shift direction as JSON array (default: `[0,1,0]`) |
| `PCP_CAMERA_CALIBRATION_FILE` | Path to OpenCV calibration YAML/JSON with `camera_matrix` and `dist_coeffs` |
| `PCP_CAD_DIR` | Base directory for CAD STL files (default: `/cad/sealer/`). Per-model_type subdir contains `part.stl`. |
| `PCP_LOGGING_LEVEL` | Log level (default: `INFO`) |

---

## 6. Service Structure

### Directory Layout

```
services/point-cloud-processor/
├── visionking-point-cloud-processor.py          # Entry point
├── visionking-point-cloud-processor.req         # Requirements
├── visionking-point-cloud-processor.Dockerfile  # Two-stage alpine build
├── src/
│   ├── utils/
│   │   ├── read_env_var.py                      # PCP_* env vars
│   │   ├── connections.py                       # Redis + RabbitMQ setup
│   │   └── parsing.py                           # Message decode, magic bytes
│   ├── communication_clients/
│   │   ├── rabbit_client.py                     # Async aio-pika (database-writer pattern)
│   │   └── config.py                            # Configuration dataclasses
│   ├── accumulator/
│   │   └── scan_accumulator.py                  # Redis hash accumulation per VIN
│   ├── pipeline/
│   │   ├── loader.py                            # Stage 1: load PLY + BIN from disk
│   │   ├── outlier_removal.py                   # Stage 2: SOR per frame
│   │   ├── registration.py                      # Stage 3: translation by encoder
│   │   ├── merge.py                             # Stage 4: concatenation + voxel downsample
│   │   ├── cad_registration.py                  # Stage 5: best-fit ICP → T_part_to_CAD
│   │   ├── stitching.py                         # Stage 6: undistort + stitch 2D
│   │   └── depth_map.py                         # Stage 7: Z projection (CAD frame) → numpy
│   ├── calibration/
│   │   ├── factory_calibration.py               # camera intrinsics from .hibag
│   │   └── cad_loader.py                        # STL load + sample + cache by model_type
│   └── settings/
│       └── redis_settings.py                    # Read settings from Redis DB3
└── tests/
    ├── test_scan_accumulator.py
    ├── test_loader.py
    ├── test_registration.py
    ├── test_merge.py
    ├── test_cad_registration.py
    ├── test_cad_loader.py
    ├── test_stitching.py
    └── test_depth_map.py
```

### Lifecycle

```
Startup:
  1. Read PCP_* env vars
  2. Connect to Redis (accumulator DB + settings DB3)
  3. Load camera calibration file
  4. Pre-compute undistort remap maps
  5. Validate PCP_CAD_DIR exists (warn if no STLs found — service still starts; per-message DLX on missing STL)
  6. Connect to RabbitMQ (connect_robust)
  7. Check if settings hash exists → log warning if not
  8. Flush stale scans from Redis (post-restart recovery)
  9. Start consumer on sealer-processed-queue

Runtime (per message):
  1. Decode message
  2. ScanAccumulator.add_frame()
  3. flush_stale_scans()
  4. If scan complete → run_pipeline()
  5. ACK message

Shutdown (SIGTERM/SIGINT):
  1. Stop consuming new messages
  2. Wait for running pipeline to finish (graceful, with timeout)
  3. Do NOT clean pending scans from Redis (recovered on restart)
  4. Close connections
```

---

## 7. Error Handling

| Scenario | Action |
|----------|--------|
| **Malformed message** (invalid JSON, missing required fields) | NACK without requeue → DLX. Log error with message body. |
| **model_type absent from `sealer_model_frames_map`** | Accumulate in timeout-only mode. Log warning once per unknown model_type. |
| **PLY/BIN not found on disk** | Log error, mark frame as `missing` in accumulator. On processing, skip missing frames. If >30% missing → log error, `"degraded": true` in downstream message. |
| **Corrupted PLY** (Open3D fails to read) | Same as missing — skip + log. |
| **BIN with unknown magic bytes** | Skip frame in stitching (cloud still used). Log warning. |
| **CAD STL missing for model_type** | NACK without requeue → DLX. Log error. Operator must provision the STL before retry. |
| **CAD STL unreadable / corrupt** | NACK without requeue → DLX. Same handling as missing. |
| **ICP fails to converge** (RMSE > threshold or fitness < min) | Continue pipeline. Save merged.ply in part frame. Output message has `degraded=true`, `cad_registration.converged=false`, `T_part_to_CAD = identity`. Downstream services skip measurement. |
| **Pipeline processing fails** (OOM, Open3D crash) | NACK without requeue → DLX. Log error with stack trace. Memory cleanup. |
| **Redis unavailable** | redis-py auto-reconnects. Messages remain unacked in RabbitMQ until reconnection. |
| **RabbitMQ unavailable** | aio-pika `connect_robust` auto-reconnects. |
| **Downstream publish fails** | Retry 3× with exponential backoff. If still fails → NACK without requeue → DLX. Disk outputs already saved. |
| **Disk full** | Log critical. Message NACK → DLX. Service continues running. |

---

## 8. Observability

Structured log (loguru, JSON format) emitted after each scan is processed:

```json
{
  "event": "scan_processed",
  "vin": "KMHXX00XXXX000001",
  "model_type": "CRETA_2026",
  "frames_expected": 20,
  "frames_received": 20,
  "frames_missing": 0,
  "partial": false,
  "degraded": false,
  "total_points_raw": 2100000,
  "total_points_merged": 1850000,
  "voxel_reduction_pct": 11.9,
  "pipeline_duration_ms": 9000,
  "load_ms": 1200,
  "sor_ms": 2100,
  "registration_ms": 50,
  "merge_ms": 1800,
  "cad_registration_ms": 320,
  "cad_registration_rmse_mm": 0.42,
  "cad_registration_fitness": 0.93,
  "cad_registration_converged": true,
  "stitch_ms": 1500,
  "depth_map_ms": 850
}
```

---

## 9. Testing

### Unit Tests

Each pipeline module tested in isolation with synthetic data:

| Test | Validates |
|------|-----------|
| `test_loader.py` | Magic byte detection (JPEG/PNG); PLY reading; ordering by encoder_position; corrupted/missing file handling |
| `test_outlier_removal.py` | SOR removes noisy points; preserves valid points; respects nb_neighbors and std_ratio parameters |
| `test_registration.py` | Correct translation by unit vector; relative shift from absolute positions; custom vector works |
| `test_merge.py` | Concatenation preserves all points; voxel downsample reduces overlap density; non-overlap points unaffected |
| `test_cad_loader.py` | Loads STL by model_type; samples target with deterministic seed; cache hit on second call; mtime invalidation; missing file raises |
| `test_cad_registration.py` | Identity-aligned input → T ≈ identity, RMSE near 0; small (<10mm/2°) perturbation → recovers within tolerance; large (50mm/30°) perturbation → flagged as not converged; respects rmse and fitness thresholds; cloud transformed in-place after success; cloud unchanged on failure |
| `test_stitching.py` | Undistort applies calibration correctly; shift positioning in pixels; feathering in overlap; canvas sized correctly |
| `test_depth_map.py` | Correct Z projection; configurable resolution; empty pixels = NaN; float32 format |
| `test_redis_settings.py` | Reads `sealer_model_frames_map` from `settings` hash; timeout-only fallback when hash missing; fallback when model_type absent |

### Accumulator Tests

| Test | Validates |
|------|-----------|
| `test_scan_accumulator.py` | Accumulates frames per VIN; completes when `received >= expected`; timeout flush with partial data; ignores duplicates; startup recovery of pending scans; TTL applied; timestamp tolerance groups frames correctly |

Fixture: `fakeredis` for unit tests (no infra dependency).

### Integration Tests (E2E)

Full flow test:

1. Publish N messages to `sealer-processed-queue` (synthetic frames from the same VIN)
2. Verify:
   - All frames accumulated in Redis
   - Pipeline runs after last frame
   - `merged.ply`, `stitched.png`, `depth_map.npy` saved to disk
   - Message published to `sealer-measurement-queue` with correct paths
   - Message published to `sealer-inference-queue` with correct paths
   - Scan cleaned from Redis after processing

Additional scenarios:
- **Partial scan**: publish N-3 frames, wait for timeout, verify processing with `"partial": true`
- **Out-of-order frames**: publish frames in random order, verify ordering by encoder_position works
- **Missing frame on disk**: publish message referencing non-existent PLY, verify degraded handling

### Synthetic Test Data

Fixture generating realistic test data:

```python
def make_test_scan(num_frames=5, points_per_frame=1000, shift_mm=100.0):
    """
    Generate num_frames point clouds with partial overlap,
    synthetic images (colored gradients), and RabbitMQ messages.
    Save PLY and BIN to tmpdir.
    """
```

Clouds generated as planes with Gaussian noise (simulating body panel surface) + elevated cylinder (simulating sealer bead). Validates that merge preserves bead geometry.

### Quality Assertions

- **Continuity**: merged cloud has no gaps between consecutive frames
- **Uniform density**: std deviation of per-voxel density in overlap < 2× density outside overlap
- **Geometry preserved**: mean distance between synthetic bead points and expected position < 0.5 mm
- **CAD alignment**: after Stage 5, mean point-to-mesh distance from merged cloud to CAD STL < 1.0 mm for synthetic test cases without injected drift

---

## 10. Resource Budget

From `topologies/sealer-single-node.yaml`:

| Resource | Value |
|----------|-------|
| Memory | 4096 MB |
| CPUs | 2.0 |

### Memory Estimate

- 20 PLY frames × ~100K points × 24 bytes (XYZ float64) = ~48 MB raw
- KD-tree + voxel grid intermediates: ~3–5× = ~200 MB peak
- Images (20 frames × ~2 MB): ~40 MB
- Stitched canvas: ~20 MB
- CAD STL + sampled target (cached per model_type, ~50k points): ~5 MB per model
- **Peak estimate**: ~500 MB–1 GB — well within 4 GB allocation

### Cycle Time Estimate

Target: < 45 seconds (900 cars/day = 1 car every 96 seconds, but pipeline shares time with acquisition)

- Load 20 PLYs: ~2 s
- SOR (20 frames): ~3 s
- Inter-frame registration: < 0.1 s
- Merge + voxel downsample: ~2 s
- CAD registration (ICP): ~0.5 s
- Image stitching: ~2 s
- Depth map generation: ~1 s
- **Total estimate**: ~10.5 s — comfortable margin

---

## 11. Dependencies

### Python Packages

```
open3d
numpy
opencv-python-headless
aio-pika==9.5.5
redis
loguru
pydantic
python-dotenv
```

### Infrastructure

- Redis (KeyDB) — accumulator DB + settings DB3
- RabbitMQ — input/output queues
- Disk — read raw frames, write processed outputs

### Upstream Services

- `image-saver` — saves raw PLY + BIN to disk, publishes frame messages to `sealer-processed-queue`

### CAD Assets

- Per-`model_type` STL files at `${PCP_CAD_DIR}/${model_type}/part.stl`. These are produced by the SEALER provisioning CLI (see `2026-05-06-sealer-provisioning-cli-design.md`) by converting customer STEP/IGES to STL with consistent units (mm) and origin.

### Downstream Services

- `sealer-bead-measurement` — consumes from `sealer-measurement-queue`, reads `merged.ply` (in CAD frame, no further registration required)
- `inference` (sealer-2d profile) — consumes from `sealer-inference-queue`, reads `stitched.png` and `depth_map.npy`. Uses `T_part_to_CAD` and `depth_map_origin_mm`/`depth_map_resolution_mm` to project CAD-defined ROIs into pixel coordinates.

---

## 12. Docker

Two-stage build following the database-writer pattern:

```dockerfile
# Stage 1: Build
FROM python:3.10-slim as builder
# Note: open3d requires glibc, cannot use alpine
ENV TZ=America/Sao_Paulo
RUN python3 -m venv /venv
COPY *.req .
RUN pip3 install --no-cache-dir -r *.req

# Stage 2: Runtime
FROM python:3.10-slim
COPY --from=builder /venv /venv
ENV TZ=America/Sao_Paulo
ENV PATH="/venv/bin:$PATH"
RUN groupadd -g 1000 strokmatic && useradd -u 1000 -g strokmatic -m strokmatic
WORKDIR /home/strokmatic
COPY . .
CMD ["python3", "./visionking-point-cloud-processor.py"]
```

**Note**: Open3D requires glibc — cannot use `python:3.10-alpine` like the other services. Uses `python:3.10-slim` instead.

---

## 13. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-04-13 | Pedro Teruel | Initial design (6 stages: load, SOR, registration, merge, stitching, depth_map). |
| 2026-05-07 | Pedro Teruel | Added Stage 5 — CAD Registration (best-fit ICP merged ↔ CAD STL). Output messages now include `T_part_to_CAD`, `depth_map_origin_mm`, `depth_map_resolution_mm`. `merged.ply` and `depth_map.npy` published in CAD frame. Centralising best-fit here removes the need for downstream services (sealer-bead-measurement, sealer-2d inference) to run their own registration, and unblocks CAD-defined ROI projection for 2D inference. |
