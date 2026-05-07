# [4.11] Sealer 2D Inference Adapter — Design Spec

> **Profile**: `vk-sealer`
> **Project**: 03008
> **Backlog**: SEALER-2D-INFERENCE (NEW, replaces ex-SEALER-04)
> **Date**: 2026-05-06 (revised 2026-05-07)
> **Status**: Draft

---

## 1. Overview

Adapt the existing `visionking-inference` service to run YOLOv11 over the **stitched RGB image** produced by SEALER-01, detecting per-ROI **presence/absence**, **lateral position**, and **width** of sealer beads. Replaces the previously-planned SEALER-04 (3D ML inference on depth maps), which is deferred to a future phase pending 3D dataset collection.

This is the **Phase 1 ML path** — geometric measurements come from SEALER-03 (3D); 2D YOLO complements with simpler presence checks.

The actual model training is **out of scope** for this spec — it requires a labeled 2D dataset of sealer beads on car bodies. This spec covers:
- Service code adaptation (data path, ROI derivation, message schemas)
- Mock model for tests
- Production model swap mechanism (drop-in ONNX/OpenVINO IR file)

### Key Design Decisions (v2 — 2026-05-07)

- **No hand-authored 2D ROI file.** ROIs are **derived at runtime** by projecting the same CAD-frame `sealer_centerline.json` consumed by SEALER-03 into pixel coordinates using the depth map's CAD↔pixel mapping. The previously-proposed `sealer_2d_rois.json` is removed — single source of truth (centerline) avoids drift between the 3D measurement service and the 2D inference service.
- **Upstream registration guard.** If SEALER-01 publishes `cad_registration.converged == false` or `degraded == true`, the cloud is in part frame with `T = identity` and any CAD-frame ROI projection would land in the wrong place. The service NACKs to DLX without running detection (mirror of SEALER-03 Task 3 guard).
- **Pixel↔CAD mapping comes from the depth map only.** `depth_map_origin_mm` + `depth_map_resolution_mm` describe the grid that `stitched.png` and `depth_map.npy` share (both produced in CAD frame by SEALER-01 Stages 5/6/7). No PnP / intrinsics re-derivation in this service.

---

## 2. Data Flow

```
point-cloud-processor                      sealer-bead-measurement
        │                                          │
        ├── publishes ───────► sealer-inference-queue (NEW PURPOSE)
        │                              │
        │                              ▼
        │                      ┌─────────────────────────────┐
        │                      │ visionking-inference        │
        │                      │ INF_PROFILE=sealer-2d       │
        │                      │                             │
        │                      │ 1. Upstream guard           │
        │                      │ 2. Read stitched.png        │◄─── /img_saved/{part}/{cam}/stitched.png
        │                      │ 3. Read sealer_centerline   │◄─── /config/sealer/{model_type}/sealer_centerline.json
        │                      │ 4. Project ROIs (CAD→px)    │◄─── depth_map_origin_mm + resolution_mm
        │                      │ 5. Crop per ROI             │
        │                      │ 6. YOLOv11 inference        │
        │                      │ 7. Aggregate + enrich       │
        │                      └────────┬────────────────────┘
        │                               │
        │                               ▼
        │                      sealer-2d-result-queue
        │                      (routing key: sealer.detection_2d)
        │                               │
        ▼                               ▼
sealer-measurement-queue          result-writer-2d (DB)
```

---

## 3. Input

### 3.1 Trigger message (`sealer-inference-queue`)

Published by SEALER-01 (point-cloud-processor). The contract is the canonical message defined in `2026-04-13-sealer-01-point-cloud-processor-design.md` §2 (Output Message) and §4 Stage 5:

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
  "depth_map_origin_mm": [-450.0, -1200.0],
  "depth_map_resolution_mm": 0.5,
  "total_points": 1850000,
  "scan_duration_ms": 8500,
  "processed_at": "2026-05-27T14:30:14.000Z",
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

Field usage in this service:

- `stitched_image_path` — image to crop and infer on.
- `depth_map_origin_mm`, `depth_map_resolution_mm` — pixel↔CAD mapping for ROI projection. `stitched.png` and `depth_map.npy` share this same pixel grid (both produced in CAD frame by SEALER-01 Stage 5/6/7).
- `cad_registration` — consumed by the upstream guard (§9). The 2D service does NOT re-apply `T_part_to_CAD`: SEALER-01 already applied it before saving `merged.ply` and `depth_map.npy`.
- `merged_ply_path`, `depth_map_path` — not strictly required for inference; ignored unless future debug tooling needs them.

See `2026-04-13-sealer-01-point-cloud-processor-design.md` for the upstream contract.

### 3.2 Centerline (bind-mounted)

The same `sealer_centerline.json` consumed by SEALER-03 is also consumed here, from `/config/sealer/{model_type}/sealer_centerline.json`. Schema is defined in `2026-05-06-sealer-03-sealer-bead-measurement-design.md` §3.3 — beads with `name`, `points[N×3]` in **CAD coordinates (mm)**, and `expected_width_mm`.

The file is cached on first read per `model_type` and reloaded if file mtime changes. For v1 the loader is a small per-service duplication of SEALER-03's `centerline_loader.py`; SHARED-LIB extraction is a future task and is intentionally not done here.

---

## 4. Profile Module Layout

`visionking-inference` already supports multiple "profiles" via `INF_PROFILE` env var (existing inspection profiles for laminação, carrocerias, sparktest). Add a new profile:

```
services/inference/src/profiles/sealer_2d/
├── __init__.py
├── centerline_loader.py    # Read sealer_centerline.json (CAD frame), mtime cache
├── upstream_guard.py       # Trust check on cad_registration + degraded
├── roi_projector.py        # CAD-frame segment → pixel bbox (pure function)
├── consumer.py             # sealer-inference-queue handler (orchestrates the above)
├── inference.py            # YOLO ONNX/OpenVINO runner
├── publisher.py            # sealer-2d-result-queue publisher
├── mock_model.py           # Deterministic mock
└── models.py               # Pydantic for input/output messages (incl. CadRegistration)
```

Update `visionking-inference.py` (or its profile dispatcher) to register the new profile.

---

## 5. Inference Pipeline (per part)

1. Receive message from `sealer-inference-queue`. Parse into `SealerInferenceMessage` (Pydantic, includes the `cad_registration` block).
2. **Upstream guard** — if `degraded == true` OR `cad_registration.converged == false` OR `cad_registration` missing → NACK→DLX (see §9).
3. Load `stitched.png` (PIL or OpenCV).
4. Load `sealer_centerline.json` for `model_type` from `/config/sealer/{model_type}/` (mtime cache).
5. **Derive ROIs at runtime** from the centerline + depth map mapping (algorithm in §5.1). This produces a list of `(roi_index, roi_name, bead_name, segment_index, bbox_px)` tuples.
6. **For each derived ROI**:
   - Crop image: `crop = img[v_min:v_max, u_min:u_max]`.
   - Run YOLOv11 inference on the crop (single class: `bead`).
   - Take highest-confidence detection (or none if confidence < threshold).
7. Build aggregated result:
   - `presence`: detection found.
   - `position_x_px`: bbox center x in `stitched.png` absolute coords.
   - `width_px`: bbox width.
   - `confidence`: YOLO score.
   - `roi_bbox_px`: the derived ROI bbox the crop came from.
   - `position_in_cad_mm`: when `presence=true`, the bbox center re-projected to CAD coords using the inverse pixel↔CAD mapping (optional; null when `presence=false`).
8. Publish to **`sealer-2d-result-queue`** (NEW dedicated queue — separate from `sealer-result-queue` used by 3D measurements). The queue is consumed by a dedicated `result-writer-2d` instance ([4.10]).

### 5.1 Runtime ROI derivation

Inputs:

- `centerline.beads` — list of beads, each with `points: list[(x,y,z) in CAD mm]` and `name`.
- `depth_map_origin_mm = [x_min, y_min]` and `depth_map_resolution_mm` — from the input message (CAD-frame grid origin + pixel size, shared with `stitched.png`).
- Settings (Redis DB3): `sealer_2d_segment_arc_length_mm`, `sealer_2d_roi_padding_lateral_mm`, `sealer_2d_min_roi_area_px`.
- Image bounds: `(W_px, H_px)` from `stitched.png` shape.

Algorithm:

```
For each bead in centerline.beads:
  Resample bead.points at sealer_2d_segment_arc_length_mm (default 100 mm)
    → list of segments (sub-polylines along the bead).
  For segment_index, segment in enumerate(segments):
    1. Build 2D AABB in CAD-XY (the depth_map / stitched.png grid is top-down
       CAD-XY per SEALER-01 §4 Stage 7 — Z is irrelevant for the projection):
       - bbox2d = xy_bbox_of_polyline(segment)   # (x_min..x_max, y_min..y_max)
       - inflate laterally by sealer_2d_roi_padding_lateral_mm (default 15 mm)
    2. Project the 4 bbox corners (CAD-XY mm) to pixel coords:
         u = (corner.x - x_min) / depth_map_resolution_mm
         v = (corner.y - y_min) / depth_map_resolution_mm
    3. ROI bbox 2D:
         u_min, v_min = floor(min over corners)
         u_max, v_max = ceil(max over corners)
    4. Clamp to image bounds: [0, W_px-1] × [0, H_px-1].
    5. Reject ROI if (u_max - u_min) * (v_max - v_min) < sealer_2d_min_roi_area_px²
       (segment is fully off-frame or projected outside the captured region).
    6. Otherwise emit ROI:
         roi_name = f"{bead.name}_seg_{segment_index:02d}"
         roi_index = monotonic counter across all beads
         bbox_px  = (u_min, v_min, u_max, v_max)
```

Notes:

- The mapping `stitched.png ↔ depth_map.npy ↔ CAD-XY` is established by SEALER-01 Stages 5–7 (see SEALER-01 spec §4). Both files share the same pixel grid because the stitched image is rendered onto the same CAD-XY canvas as the depth map. This is the load-bearing assumption that lets the 2D service compute ROIs without loading the STL or the camera calibration.
- When the centerline is denser than `sealer_2d_segment_arc_length_mm`, the resampler walks the polyline in arc-length steps; when it is sparser (e.g. native vertices already > 100 mm apart) the segment is the input edge as-is.
- Inverse mapping (used for `position_in_cad_mm` enrichment in §6):
    `cad_x = u_center * depth_map_resolution_mm + x_min`
    `cad_y = v_center * depth_map_resolution_mm + y_min`

---

## 6. Output Message

```json
{
  "part_uuid": "def-456",
  "inferred_at": "2026-05-15T10:30:50.123Z",
  "detections": [
    {
      "roi_index": 0,
      "roi_name": "left_sill_seg_00",
      "presence": true,
      "position_x_px": 1340,
      "width_px": 87,
      "confidence": 0.92,
      "roi_bbox_px": [1180, 460, 1500, 560],
      "position_in_cad_mm": [219.5, -970.0]
    },
    {
      "roi_index": 1,
      "roi_name": "left_sill_seg_01",
      "presence": false,
      "position_x_px": null,
      "width_px": null,
      "confidence": 0.0,
      "roi_bbox_px": [1500, 460, 1820, 560],
      "position_in_cad_mm": null
    }
  ]
}
```

Field semantics:

- `roi_name`: derived as `{bead_name}_seg_{N:02d}` where `N` is the segment index along the centerline (0-indexed, two-digit zero-padded).
- `roi_bbox_px`: `[u_min, v_min, u_max, v_max]` — the runtime-derived ROI bbox in `stitched.png` coords. Useful for visualization, audit, and re-running detection on the same crop.
- `position_in_cad_mm`: when `presence=true`, the YOLO bbox center re-projected to CAD-XY using the inverse pixel↔CAD mapping (§5.1). `null` when `presence=false`. Useful for operator dashboards that want to overlay defects on the CAD layout.

Consumed by **`result-writer-2d`** (default-mode db-writer instance with `INSERT_FUNCTION=insert_sealer_2d_detection`) → calls the wrapper procedure ([4.8]). The wrapper stores each detection as a row in the **common `defeitos` table** with `class_id` 1020 (`bead_present`) or 1021 (`bead_absent`), with `metrics jsonb` containing the detection details. Per-(part_uuid, roi_index) UPSERT semantics enforced by the wrapper deleting prior detections before insert.

---

## 7. Model

### 7.1 File format

ONNX or OpenVINO IR. Loaded once at startup via `onnxruntime` (CPU, OpenVINO EP):

```python
session = ort.InferenceSession(model_path, providers=["OpenVINOExecutionProvider"])
```

Model path from env: `INF_SEALER_2D_MODEL_PATH=/models/sealer_2d_yolov11s.onnx`.

### 7.2 Phase 1 — Mock model

Until a trained model is available, ship a **mock implementation** that returns deterministic outputs based on simple heuristics (e.g., random with seed = part_uuid hash). Tests use this mock.

`INF_SEALER_2D_USE_MOCK=true` in dev/staging.

### 7.3 Production swap

When the trained model becomes available:
1. Place ONNX file at the path
2. Set `INF_SEALER_2D_USE_MOCK=false`
3. Restart inference service
4. (No code change required)

### 7.4 Training data — out of scope

Dataset collection happens **after first deployment**. Operators capture stitched.png samples during operation; engineering team annotates and trains offline. Tracked in backlog as **SEALER-2D-MODEL-TRAINING**.

---

## 8. Configuration

### 8.1 Env vars

| Var | Default | Description |
|---|---|---|
| `INF_PROFILE` | (depends on deploy) | `sealer-2d` enables this profile |
| `INF_RABBIT_INPUT_QUEUE` | `sealer-inference-queue` | |
| `INF_RABBIT_OUTPUT_QUEUE` | `sealer-2d-result-queue` | dedicated queue for 2D detections, consumed by `result-writer-2d` |
| `INF_SEALER_2D_MODEL_PATH` | `/models/sealer_2d_yolov11s.onnx` | |
| `INF_SEALER_2D_USE_MOCK` | `false` | true in dev |
| `INF_SEALER_2D_CONFIDENCE_THRESHOLD` | 0.5 | per-ROI presence threshold |
| `INF_SEALER_CONFIG_DIR` | `/config/sealer/` | base for `sealer_centerline.json` |
| `INF_EXECUTION_PROVIDER` | `openvino` | OpenVINO EP for CPU |

### 8.2 Runtime tunables (Redis DB3 `settings`)

| Field | Default | Description |
|---|---|---|
| `sealer_2d_confidence_threshold` | 0.5 | Live override of env var |
| `sealer_2d_iou_threshold` | 0.45 | NMS IoU |
| `sealer_2d_image_size` | 640 | Input size for YOLOv11 |
| `sealer_2d_segment_arc_length_mm` | 100.0 | Centerline segmentation step for ROI generation |
| `sealer_2d_roi_padding_lateral_mm` | 15.0 | 2D bbox lateral padding around centerline (in CAD X/Y) |
| `sealer_2d_min_roi_area_px` | 400 | Min ROI area (pixels²) to consider valid (prunes off-frame projections) |

---

## 9. Error Handling

| Scenario | Action |
|---|---|
| `cad_registration.converged == false` OR `degraded == true` | NACK → DLX (cloud is in part frame with identity T; CAD-frame ROIs would project to wrong pixels). Mirror of SEALER-03 §8 first row. |
| `cad_registration` block missing from message | NACK → DLX (contract violation; SEALER-01 must populate it) |
| `stitched.png` missing on disk | NACK → DLX (file should exist if SEALER-01 succeeded) |
| `depth_map_origin_mm` or `depth_map_resolution_mm` missing | NACK → DLX (contract violation; needed for ROI projection) |
| `sealer_centerline.json` missing for `model_type` | NACK → DLX (config error — operator must provision via SEALER provisioning CLI) |
| Centerline produces zero valid ROIs after projection (all off-frame) | Publish empty `detections=[]`; log warning. The part is captured but no beads were in the field of view. |
| Model load fails at startup | Service exits (fail-fast) |
| Inference throws (rare — OpenVINO EP fault) | NACK with `requeue=True` (transient); after N retries, DLX |
| Empty `beads` list in JSON | NACK → DLX (config error) |

The upstream guard module mirrors SEALER-03's `upstream_guard.py` but **does not include the conditional STL check** — this service does not load the STL (only `stitched.png` + `depth_map`-derived metadata + centerline).

---

## 10. Resource Budget

| Resource | Allocation | Notes |
|---|---|---|
| Memory | 2 GB | YOLOv11s + image buffer + Open3D not needed |
| CPU | 2.0 cores | OpenVINO INT8 quantized; ~50 ms per ROI on Xeon E-2124G |

Per-part latency estimate: 4–8 derived ROIs × 50ms = 200–400ms inference + ~50ms IO + <10ms ROI projection = **~300–500ms per part**. Fits the 60s ciclo budget easily.

---

## 11. Out of Scope

- Training pipeline (dataset annotation, model training, validation)
- Model performance benchmarking against ground truth
- Active learning loop (model improves with new labels)
- Multi-camera fusion (single camera in Phase 1)
- Shared-library extraction of the centerline reader (duplicated with SEALER-03 in v1; future SHARED-LIB task)

---

## 12. References

- [4.8] DB schema spec (`tbl_sealer_2d_detections`)
- [4.10] db-writer mode sealer (consumes the output)
- [4.9] provisioning CLI (`sealer_centerline.json` produced here, consumed by SEALER-03 and this service)
- SEALER-01 spec: `2026-04-13-sealer-01-point-cloud-processor-design.md` §2 (Output Message), §4 Stage 5 (CAD registration), §4 Stage 7 (depth map).
- SEALER-03 spec: `2026-05-06-sealer-03-sealer-bead-measurement-design.md` §3.1 (input message), §3.3 (centerline schema), §8 (error handling).
- SEALER-03 plan Task 3 — upstream registration guard (pattern mirrored here).
- Existing `services/inference/` — service to extend.
- `visionking-inference` profile system — pattern for adding new inspection types.

---

## 13. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-05-06 | Pedro Teruel | Initial design (hand-authored `sealer_2d_rois.json` per `model_type`, single trigger message field set, no upstream guard). |
| 2026-05-07 | Pedro Teruel | Replaced authored `sealer_2d_rois.json` with runtime ROI derivation from `sealer_centerline.json` + depth_map (CAD-frame projection). Added upstream registration guard. Output enriched with `roi_bbox_px` + `position_in_cad_mm`. |
