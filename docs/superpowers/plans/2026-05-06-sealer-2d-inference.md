# [4.11] Sealer 2D Inference Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkbox tracking.

> **Updated 2026-05-07:** The previous design loaded a hand-authored `sealer_2d_rois.json` from disk. This plan replaces that with **runtime ROI derivation** from the same `sealer_centerline.json` consumed by SEALER-03 (CAD frame) plus the `depth_map_origin_mm` / `depth_map_resolution_mm` mapping published by SEALER-01. Added an upstream registration guard (mirror of SEALER-03 plan Task 3). Output enriched with `roi_bbox_px` + `position_in_cad_mm`.

**Goal:** Add a `sealer-2d` profile to `visionking-inference` that consumes `sealer-inference-queue`, derives per-segment ROIs at runtime from the CAD-frame centerline + depth map mapping, runs YOLOv11 over per-ROI crops of `stitched.png`, and publishes detections to `sealer-2d-result-queue` with routing key `sealer.detection_2d`. Includes a mock model for tests; production model swappable via env var.

**Tech Stack:** Python 3.10, onnxruntime + OpenVINO EP, Pillow, numpy, aio-pika, pydantic 2, loguru, pytest, pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-05-06-sealer-2d-inference-design.md`

**Repo path:** `services/inference/` (existing service, additive change)

**Estimate:** 2.2d implementation + 2d ajustes (net +0.2d vs prior plan — see "Effort delta" at the end). ~30 unit/integration tests.

---

## File Structure

```
services/inference/
├── visionking-inference.py             # MODIFIED: register sealer-2d profile
├── src/
│   ├── utils/read_env_var.py            # MODIFIED: add INF_SEALER_2D_*
│   └── profiles/
│       ├── existing profiles/...
│       └── sealer_2d/                   # NEW
│           ├── __init__.py
│           ├── centerline_loader.py     # Read sealer_centerline.json (mtime cache)
│           ├── upstream_guard.py        # Trust check on cad_registration + degraded
│           ├── roi_projector.py         # CAD-frame segment → pixel bbox (pure fn)
│           ├── consumer.py
│           ├── inference.py
│           ├── publisher.py
│           ├── models.py                # Pydantic (incl. CadRegistration)
│           └── mock_model.py            # Deterministic mock
└── tests/
    └── sealer_2d/                       # NEW
        ├── __init__.py
        ├── conftest.py
        ├── fixtures/                    # Sample stitched.png + sealer_centerline.json
        ├── test_centerline_loader.py
        ├── test_upstream_guard.py
        ├── test_roi_projector.py
        ├── test_inference.py
        ├── test_consumer.py
        ├── test_publisher.py
        └── test_e2e_smoke.py
```

---

## Task 1 — Profile scaffold + Pydantic models (TDD)

- [ ] **Step 1: failing tests** (`tests/sealer_2d/test_models.py`)
```python
def test_input_message_parses_with_cad_registration(): ...
def test_input_message_rejects_missing_cad_registration(): ...
def test_input_message_rejects_missing_depth_map_origin_mm(): ...
def test_output_detection_serializes_with_roi_bbox_and_cad_position(): ...
def test_output_detection_position_in_cad_mm_nullable_when_absent(): ...
```

- [ ] **Step 2: implement `models.py`**
```python
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime

class CadRegistration(BaseModel):
    T_part_to_CAD: list[list[float]]  # 4x4
    rmse_mm: float
    fitness: float
    iterations: int | None = None
    converged: bool
    stl_path: str
    stl_mtime: str | None = None  # ISO-8601

class SealerInferenceMessage(BaseModel):
    part_uuid: UUID
    vin_number: str | None = None
    model_type: str
    camera_serial_number: str | None = None
    total_frames: int | None = None
    partial: bool = False
    degraded: bool = False
    merged_ply_path: str | None = None     # consumed by SEALER-03; ignored here
    depth_map_path: str | None = None      # not strictly needed for inference
    stitched_image_path: str
    depth_map_origin_mm: list[float]       # [x_min, y_min] in CAD mm — required
    depth_map_resolution_mm: float         # CAD-frame pixel size — required
    processed_at: datetime
    cad_registration: CadRegistration      # required; consumed by upstream guard

class RoiDetection(BaseModel):
    roi_index: int
    roi_name: str            # f"{bead_name}_seg_{N:02d}"
    presence: bool
    position_x_px: int | None
    width_px: int | None
    confidence: float
    roi_bbox_px: list[int]   # [u_min, v_min, u_max, v_max]
    position_in_cad_mm: list[float] | None = None   # [cad_x, cad_y] when presence=true

class Sealer2DDetectionResult(BaseModel):
    part_uuid: UUID
    inferred_at: datetime
    detections: list[RoiDetection]
```

- [ ] **Step 3: scaffold remaining files** (empty stubs + `__init__.py`)

- [ ] **Step 4: commit** `feat(inference): scaffold sealer-2d profile + pydantic models with cad_registration`

---

## Task 2 — Centerline loader (TDD)

> Mirror of SEALER-03's `centerline_loader.py`. Per-service duplication is intentional for v1 — a SHARED-LIB extraction is a future task and is out of scope here.

- [ ] **Step 1: failing tests** (`tests/sealer_2d/test_centerline_loader.py`)
```python
def test_loads_centerline_from_disk(tmp_path):
    base = tmp_path / "CRETA_2026"; base.mkdir()
    f = base / "sealer_centerline.json"
    f.write_text(json.dumps({
        "model_type": "CRETA_2026",
        "beads": [
            {"name": "left_sill",
             "points": [[0,0,0],[100,0,0],[200,0,0]],
             "expected_width_mm": 22.0}
        ]
    }))
    loader = CenterlineLoader(str(tmp_path))
    beads = loader.load("CRETA_2026")
    assert len(beads) == 1
    assert beads[0].name == "left_sill"
    assert beads[0].points.shape == (3, 3)

def test_caches_per_model_type(tmp_path): ...
def test_reload_on_mtime_change(tmp_path): ...
def test_missing_file_raises(tmp_path): ...
def test_empty_beads_list_raises(tmp_path): ...
def test_bead_with_lt_two_points_raises(tmp_path): ...
def test_model_type_mismatch_raises(tmp_path): ...
```

- [ ] **Step 2: implement `centerline_loader.py`** with mtime-based cache invalidation. Schema validation via pydantic; convert `points` to `np.ndarray[N×3] float64`.

- [ ] **Step 3: commit** `feat(inference): sealer-2d centerline loader with mtime cache`

---

## Task 3 — Upstream registration guard (TDD)

> Mirror of SEALER-03 plan Task 3, **without** the conditional STL check (this service never loads the STL).

A small validator that, given a parsed `SealerInferenceMessage`, decides whether the input is trustworthy:

- `cad_registration.converged == True`
- `degraded == False`

If either check fails, the message is rejected at the consumer boundary (NACK→DLX, see Task 7) and a structured log line is emitted. The guard does NOT recompute or refine `T_part_to_CAD` — it only gates downstream processing.

- [ ] **Step 1: failing tests** (`tests/sealer_2d/test_upstream_guard.py`)
```python
# Cases:
# - converged=true, degraded=false → ACCEPT
# - converged=false → REJECT reason="cad_registration_not_converged"
# - degraded=true → REJECT reason="upstream_degraded"
# - both flags bad → REJECT (degraded check first; reason="upstream_degraded")
# - reasons surface in structured log payload (assert via caplog/capfd)
```

- [ ] **Step 2: implement** `src/profiles/sealer_2d/upstream_guard.py`
```python
from dataclasses import dataclass
from .models import SealerInferenceMessage

@dataclass
class GuardDecision:
    accept: bool
    reason: str | None = None

def check_upstream_registration(msg: SealerInferenceMessage) -> GuardDecision:
    if msg.degraded:
        return GuardDecision(False, "upstream_degraded")
    if not msg.cad_registration.converged:
        return GuardDecision(False, "cad_registration_not_converged")
    return GuardDecision(True)
```

- [ ] **Step 3: commit** `feat(inference): sealer-2d upstream registration guard (NACK on degraded/non-converged)`

---

## Task 4 — ROI projector (TDD)

Pure function: given a CAD-frame segment polyline + depth map mapping + padding settings + image bounds, returns a pixel bbox or `None` (if too small after clamping). Heavy testing — this is the load-bearing module.

- [ ] **Step 1: failing tests** (`tests/sealer_2d/test_roi_projector.py`)
```python
def test_identity_mapping_axis_aligned_segment():
    # origin=[0,0], resolution=1.0, segment along X from (0,0,0) to (100,0,0)
    # padding lateral=15, z=5 → bbox3d = (-15..115, -15..15, -5..5)
    # projected → u: 0..115 (clamped to image), v: 0..15  (no, depends on origin)
    # Validate exact pixel coords
    ...

def test_segment_fully_off_frame_returns_none():
    # Segment at CAD x = 5000 mm, image only covers up to 2000 px * 0.5 mm/px = 1000 mm
    # All projected u > image_width → clamped → zero area → returns None
    ...

def test_clamping_at_image_edge():
    # Segment partially off-frame → clamped bbox, area still > min_roi_area → returns clamped
    ...

def test_padding_inflates_lateral():
    # zero-length segment (single point) at CAD origin
    # With padding 15 mm + resolution 1.0 mm/px → bbox should be 30x30 px around center
    ...

def test_min_roi_area_threshold():
    # Tiny segment after clamping → area < threshold → returns None
    ...

def test_resolution_scaling():
    # Same segment, resolution 0.5 → bbox 2× pixel size vs resolution 1.0
    ...

def test_negative_origin_offset():
    # depth_map_origin_mm = [-450, -1200]; segment at CAD (0,0) → pixel at (900, 2400)
    ...
```

- [ ] **Step 2: implement** `src/profiles/sealer_2d/roi_projector.py`
```python
import numpy as np
from dataclasses import dataclass

@dataclass
class ProjectedRoi:
    roi_index: int
    roi_name: str        # f"{bead_name}_seg_{N:02d}"
    bead_name: str
    segment_index: int
    bbox_px: tuple[int, int, int, int]  # (u_min, v_min, u_max, v_max)

def resample_polyline(points: np.ndarray, arc_length_mm: float) -> list[np.ndarray]:
    """Walk the polyline in arc-length steps; return list of sub-polylines (segments)."""
    ...

def project_roi_bbox(
    segment: np.ndarray,            # (M, 3) sub-polyline in CAD mm
    depth_map_origin_mm: tuple[float, float],
    depth_map_resolution_mm: float,
    image_size_px: tuple[int, int], # (W, H)
    padding_lateral_mm: float,
    min_roi_area_px: int,
) -> tuple[int, int, int, int] | None:
    # Z is irrelevant: depth_map / stitched grid is top-down CAD-XY (SEALER-01 §4 Stage 7).
    x_min_cad = segment[:, 0].min() - padding_lateral_mm
    x_max_cad = segment[:, 0].max() + padding_lateral_mm
    y_min_cad = segment[:, 1].min() - padding_lateral_mm
    y_max_cad = segment[:, 1].max() + padding_lateral_mm
    ox, oy = depth_map_origin_mm
    res = depth_map_resolution_mm
    u_min = int(np.floor((x_min_cad - ox) / res))
    u_max = int(np.ceil ((x_max_cad - ox) / res))
    v_min = int(np.floor((y_min_cad - oy) / res))
    v_max = int(np.ceil ((y_max_cad - oy) / res))
    W, H = image_size_px
    u_min = max(0, min(u_min, W - 1)); u_max = max(0, min(u_max, W - 1))
    v_min = max(0, min(v_min, H - 1)); v_max = max(0, min(v_max, H - 1))
    if (u_max - u_min) * (v_max - v_min) < min_roi_area_px:
        return None
    return (u_min, v_min, u_max, v_max)

def derive_rois(beads, settings, depth_map_origin_mm, depth_map_resolution_mm,
                image_size_px) -> list[ProjectedRoi]:
    """Iterate beads → resample → project → assign monotonic roi_index across all beads."""
    ...

def pixel_center_to_cad_mm(u_center: float, v_center: float,
                           depth_map_origin_mm, depth_map_resolution_mm) -> tuple[float, float]:
    return (u_center * depth_map_resolution_mm + depth_map_origin_mm[0],
            v_center * depth_map_resolution_mm + depth_map_origin_mm[1])
```

- [ ] **Step 3: commit** `feat(inference): sealer-2d ROI projector (CAD-frame segment → pixel bbox)`

---

## Task 5 — Mock model (TDD)

- [ ] **Step 1: failing tests** (`tests/sealer_2d/test_mock_model.py`)
```python
def test_mock_returns_deterministic_per_uuid(sample_image, projected_rois):
    model = MockYoloModel()
    d1 = model.infer(sample_image, projected_rois, part_uuid_seed="00...01")
    d2 = model.infer(sample_image, projected_rois, part_uuid_seed="00...01")
    assert d1 == d2

def test_mock_returns_one_detection_per_roi(sample_image, projected_rois):
    # presence ~70% true (deterministic by seed)
    # position_x_px within bbox bounds
    # width_px between 50-200
    # confidence in [0, 1]
    ...
```

- [ ] **Step 2: implement** `mock_model.py` — accepts `list[ProjectedRoi]`, returns `list[RoiDetection]`. Mirrors prior implementation but with `roi_name` taken from the projected ROI (not from a static JSON).

- [ ] **Step 3: commit** `feat(inference): sealer-2d mock model for testing`

---

## Task 6 — Real YOLO inference wrapper (TDD with mocked ONNX)

- [ ] **Step 1: failing tests** (`tests/sealer_2d/test_inference.py`)
```python
def test_yolo_loads_onnx(tmp_path, monkeypatch): ...
def test_inference_per_roi_crops_correctly(sample_image, projected_roi):
    # Mock model.run() to return a known output
    # Verify crop = image.crop(bbox_px) with the projected bbox dimensions
    ...
def test_postprocess_extracts_bbox(monkeypatch): ...
def test_below_confidence_threshold_marks_absence(monkeypatch): ...
def test_position_in_cad_mm_enrichment_when_present(monkeypatch):
    # Given a presence=true detection at known pixel center,
    # verify position_in_cad_mm = pixel_center_to_cad_mm(...) result
    ...
def test_position_in_cad_mm_null_when_absent(monkeypatch): ...
```

- [ ] **Step 2: implement** `inference.py` — accepts `list[ProjectedRoi]` and the depth map mapping (so it can enrich `position_in_cad_mm` for presence detections); returns `list[RoiDetection]` with `roi_bbox_px` populated from the projected bbox.

- [ ] **Step 3: factory** that selects mock vs real based on `INF_SEALER_2D_USE_MOCK`

- [ ] **Step 4: commit** `feat(inference): sealer-2d YOLO ONNX runner + factory + cad-coord enrichment`

---

## Task 7 — Consumer (TDD, integrates guard + centerline + projector + inference + publisher)

- [ ] **Step 1: failing tests** (`tests/sealer_2d/test_consumer.py`)
```python
@pytest.mark.asyncio
async def test_full_pipeline(tmp_path, sample_image_500x500, synthetic_centerline,
                              cad_registration_converged):
    # Setup sealer_centerline.json in tmp config dir
    # Mock RabbitClient + Pillow Image.open
    # Mock model factory to return MockYoloModel
    # Inject SealerInferenceMessage with depth_map_origin_mm=[0,0], resolution=1.0
    # Run consumer.process_message
    # Assert: ROIs derived from centerline (not loaded from rois.json),
    #         model called with derived bboxes, publisher called with enriched result

@pytest.mark.asyncio
async def test_guard_rejects_non_converged(tmp_path):
    # cad_registration.converged=false → NACK→DLX, no centerline load, no inference
    ...

@pytest.mark.asyncio
async def test_guard_rejects_degraded(tmp_path):
    # degraded=true → NACK→DLX
    ...

@pytest.mark.asyncio
async def test_missing_centerline_nacks_dlx(tmp_path): ...

@pytest.mark.asyncio
async def test_missing_image_nacks_dlx(tmp_path): ...

@pytest.mark.asyncio
async def test_centerline_fully_off_frame_publishes_empty_detections(tmp_path):
    # All segments project to off-frame → empty detections list, message published, ACK
    ...
```

- [ ] **Step 2: implement** `consumer.py`
```python
async def process_message(message: AbstractIncomingMessage, deps):
    async with message.process(requeue=False):
        msg = SealerInferenceMessage.model_validate_json(message.body)
        decision = check_upstream_registration(msg)
        if not decision.accept:
            logger.bind(part_uuid=str(msg.part_uuid),
                        reason=decision.reason).error("upstream_registration_rejected")
            raise NackToDLX
        image = await asyncio.to_thread(Image.open, msg.stitched_image_path)
        beads = deps.centerline_loader.load(msg.model_type)
        rois = derive_rois(
            beads, deps.settings,
            tuple(msg.depth_map_origin_mm), msg.depth_map_resolution_mm,
            image.size,
        )
        detections = await asyncio.to_thread(
            deps.model.infer, image, rois,
            tuple(msg.depth_map_origin_mm), msg.depth_map_resolution_mm,
            str(msg.part_uuid),
        )
        result = Sealer2DDetectionResult(
            part_uuid=msg.part_uuid, inferred_at=datetime.utcnow(),
            detections=detections,
        )
        await deps.publisher.publish(result)
```

- [ ] **Step 3: commit** `feat(inference): sealer-2d consumer integrating guard + centerline + projector + model`

---

## Task 8 — Publisher (TDD)

- [ ] **Step 1: failing tests** (`tests/sealer_2d/test_publisher.py`)
```python
@pytest.mark.asyncio
async def test_publishes_with_correct_routing_key():
    rabbit_mock = AsyncMock()
    publisher = ResultPublisher(rabbit_mock, exchange="sealer-exchange",
                                routing_key="sealer.detection_2d")
    result = build_sample_result(...)
    await publisher.publish(result)
    rabbit_mock.publish.assert_awaited_once()
    assert rabbit_mock.publish.call_args.kwargs["routing_key"] == "sealer.detection_2d"
```

- [ ] **Step 2: implement** `publisher.py`

- [ ] **Step 3: commit** `feat(inference): sealer-2d result publisher`

---

## Task 9 — Profile registration + main entry point

- [ ] **Step 1: register profile** in `visionking-inference.py`
```python
if INF_PROFILE == "sealer-2d":
    from src.profiles.sealer_2d.consumer import process_message
    from src.profiles.sealer_2d.centerline_loader import CenterlineLoader
    from src.profiles.sealer_2d.inference import build_model
    from src.profiles.sealer_2d.publisher import ResultPublisher

    deps = SimpleNamespace(
        centerline_loader=CenterlineLoader(INF_SEALER_CONFIG_DIR),
        model=build_model(INF_SEALER_2D_MODEL_PATH, use_mock=INF_SEALER_2D_USE_MOCK),
        publisher=ResultPublisher(rabbit, exchange="sealer-exchange",
                                  routing_key=INF_RABBIT_OUTPUT_ROUTING_KEY),
        settings=load_sealer_2d_settings(),  # Redis DB3 reader
    )
    callback = partial(process_message, deps=deps)
```

- [ ] **Step 2: env vars** in `read_env_var.py`
```python
INF_SEALER_2D_MODEL_PATH = os.getenv("INF_SEALER_2D_MODEL_PATH", "/models/sealer_2d_yolov11s.onnx")
INF_SEALER_2D_USE_MOCK = os.getenv("INF_SEALER_2D_USE_MOCK", "false").lower() == "true"
INF_SEALER_2D_CONFIDENCE_THRESHOLD = float(os.getenv("INF_SEALER_2D_CONFIDENCE_THRESHOLD", "0.5"))
INF_SEALER_CONFIG_DIR = os.getenv("INF_SEALER_CONFIG_DIR", "/config/sealer/")
INF_RABBIT_OUTPUT_ROUTING_KEY = os.getenv("INF_RABBIT_OUTPUT_ROUTING_KEY", "sealer.detection_2d")
```

- [ ] **Step 3: integration test** that exercises full main loop with mock rabbit + mock model + synthetic `sealer_centerline.json` + synthetic depth_map mapping

- [ ] **Step 4: commit** `feat(inference): register sealer-2d profile in main entry point`

---

## Task 10 — Topology + docs + CI

- [ ] **Step 1: update `topologies/sealer-single-node.yaml`**
```yaml
inference:
  enabled: true
  env_overrides:
    INF_PROFILE: "sealer-2d"
    INF_RABBIT_INPUT_QUEUE: "sealer-inference-queue"
    INF_RABBIT_OUTPUT_QUEUE: "sealer-2d-result-queue"
    INF_SEALER_2D_USE_MOCK: "true"      # Phase 1 default until model trained
    INF_SEALER_CONFIG_DIR: "/config/sealer/"
  volumes:
    - /var/visionking/sealer-config:/config/sealer:ro   # sealer_centerline.json (CAD frame), shared with SEALER-03
    - /var/visionking/img_saved:/img_saved
    - /var/visionking/models:/models:ro
```

- [ ] **Step 2: README.md** in `services/inference/` adds "Sealer 2D Profile" section with:
  - When to enable
  - How to swap mock → real model
  - Centerline provisioning workflow ([4.9]) — single source of truth shared with SEALER-03
  - Runtime tunables (segment arc length, padding, min ROI area)
  - Failure modes (NACK→DLX) and how to recover

- [ ] **Step 3: backlog entry** add `SEALER-2D-MODEL-TRAINING` to `backlogs/strokmatic/visionking.md` for Phase 2 model training

- [ ] **Step 4: commit** `feat(inference): topology + docs + backlog for sealer-2d`

---

## Cross-cutting checks

- `pytest tests/sealer_2d/ -v` — 30+ tests passing
- `pytest tests/` (full suite) — no regressions in other profiles
- Smoke: with `INF_SEALER_2D_USE_MOCK=true`, run service against fixture stitched.png + sealer_centerline.json + synthetic message with known depth_map mapping, verify result published with correctly-clamped ROIs

## Definition of done

- All 10 tasks committed on `feat/sealer-2d-inference`
- 30+ tests passing
- Mock model produces deterministic, schema-compliant results
- ROIs derived at runtime from `sealer_centerline.json` (no `sealer_2d_rois.json` on disk)
- Upstream guard rejects degraded / non-converged inputs at the consumer boundary
- Output enriched with `roi_bbox_px` + `position_in_cad_mm`
- Topology updated; mock enabled by default in Phase 1
- Backlog entry SEALER-2D-MODEL-TRAINING added for Phase 2
- Changelog entry recorded

---

## Effort delta vs prior plan (2026-05-06)

| Removed | Saving |
|---|---|
| Task: ROI config loader (`sealer_2d_rois.json` + mtime cache) | ~0.4 d |
| Fixture authoring for `sealer_2d_rois.json` | ~0.1 d |
| **Total** | **~0.5 d saved** |

| Added | Cost |
|---|---|
| Task 2 — Centerline loader (mtime cache, schema validation) | ~0.25 d |
| Task 3 — Upstream registration guard | ~0.1 d |
| Task 4 — ROI projector (pure fn + heavy unit tests) | ~0.25 d |
| `cad_registration` + depth_map mapping in Pydantic models + tests (Task 1) | ~0.1 d |
| Output enrichment (`roi_bbox_px`, `position_in_cad_mm`) + tests (Task 6) | ~0.05 d |
| Synthetic depth-map fixtures replacing rois.json fixtures (Task 7, Task 9) | ~0.05 d |
| **Total** | **~0.7 d added** |

**Net delta: +0.2 d** — overall estimate goes from 2 d → 2.2 d implementation, with a stronger architectural fit (single source of truth for ROIs across the 2D and 3D pipelines).

---

## Revision History

| Date | Author | Change |
|---|---|---|
| 2026-05-06 | Pedro Teruel | Initial plan (8 tasks, hand-authored `sealer_2d_rois.json` loader, no upstream guard, basic output schema). |
| 2026-05-07 | Pedro Teruel | Replaced authored `sealer_2d_rois.json` with runtime ROI derivation from `sealer_centerline.json` + depth_map (CAD-frame projection). Added upstream registration guard. Output enriched with `roi_bbox_px` + `position_in_cad_mm`. Net effort delta +0.2 d. Task count 8 → 10. |
