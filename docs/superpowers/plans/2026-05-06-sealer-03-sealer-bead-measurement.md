---
type: Implementation Plan
title: SEALER-03: Sealer Bead Measurement — Implementation Plan
description: A small validator that, given a parsed `SealerMeasurementMessage`, decides whether the input is trustworthy:
timestamp: 2026-05-06
---

# SEALER-03: Sealer Bead Measurement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Updated 2026-05-07:** Best-fit ICP responsibility moved upstream to SEALER-01. SEALER-03 now consumes a cloud already expressed in **CAD coordinates** plus the `T_part_to_CAD` matrix in the input message — it does NOT run its own registration. Tasks for ICP refinement and pose composition were removed; centerline anchoring is now a direct match (centerline is in CAD frame, cloud is in CAD frame).

**Goal:** Build the `sealer-bead-measurement` Python microservice that consumes the CAD-frame aggregated point cloud produced by SEALER-01 and extracts geometric measurements (width, height, continuity, volume, lateral offset) of sealer beads using a centerline-driven 4-stage algorithm. Outputs per-segment pass/fail evaluation to downstream consumers.

**Architecture:** Async aio-pika RabbitMQ consumer. Per-part processing pipeline runs 4 sequential stages (anchoring → slicing → isolation → fit). Project data (CAD + centerlines, both in CAD frame) loaded from bind-mounted volume `/config/sealer/{model_type}/`. Runtime parameters in Redis DB3 `settings` hash. **No registration is performed locally** — the upstream `T_part_to_CAD` is consumed for diagnostics and CAD-frame ROI projection only.

**Tech Stack:** Python 3.10, Open3D 0.18, numpy, scipy, aio-pika 9.5, redis, loguru, pydantic 2, pytest, pytest-asyncio, fakeredis

**Spec:** `docs/superpowers/specs/2026-05-06-sealer-03-sealer-bead-measurement-design.md`

**Monorepo:** `workspaces/strokmatic/visionking/`

**Service path:** `services/visionking-sealer-bead-measurement/` (submodule, see `.gitmodules`)

**Branch:** continue from `feat/sealer-bead-measurement-init` (already exists on monorepo)

---

## File Structure

```
services/visionking-sealer-bead-measurement/
├── visionking-sealer-bead-measurement.py        # Entry point (async main)
├── visionking-sealer-bead-measurement.req       # Python dependencies
├── visionking-sealer-bead-measurement.Dockerfile # Two-stage slim build
├── README.md
├── src/
│   ├── __init__.py
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── read_env_var.py          # SBM_* env vars
│   │   └── connections.py           # Redis + RabbitMQ factory
│   ├── communication_clients/        # Copied from database-writer
│   │   ├── __init__.py
│   │   ├── rabbit_client.py
│   │   ├── config.py
│   │   └── exceptions.py
│   ├── settings/
│   │   ├── __init__.py
│   │   └── redis_settings.py        # Read runtime sealer_* params
│   ├── project_data/
│   │   ├── __init__.py
│   │   ├── centerline_loader.py     # Parse + validate sealer_centerline.json (CAD frame)
│   │   └── cad_loader.py            # Open3D STL loader + raycaster wrapper (CAD frame)
│   ├── pipeline/
│   │   ├── __init__.py
│   │   ├── runner.py                # Orchestrate stages 1-4
│   │   ├── anchoring.py             # Stage 1: resample centerline + tangents (no transform — CAD frame in)
│   │   ├── slicing.py               # Stage 2: per-sample transversal slices
│   │   ├── isolation.py             # Stage 3: 3 methods (z-thresh, RANSAC, CAD-relative)
│   │   └── profile_fit.py           # Stage 4: Gaussian/parabolic + metrics
│   ├── evaluation/
│   │   ├── __init__.py
│   │   └── pass_fail.py             # Apply tolerances → per-segment + per-bead + overall
│   └── schema/
│       ├── __init__.py
│       └── messages.py              # pydantic models for input/output messages
└── tests/
    ├── __init__.py
    ├── conftest.py                   # Shared fixtures (fakeredis, synthetic centerlines/clouds)
    ├── test_redis_settings.py
    ├── test_centerline_loader.py
    ├── test_cad_loader.py
    ├── test_anchoring.py
    ├── test_slicing.py
    ├── test_isolation_z_threshold.py
    ├── test_isolation_ransac.py
    ├── test_isolation_cad_relative.py
    ├── test_profile_fit.py
    ├── test_pass_fail.py
    ├── test_runner.py                # Integration of stages on synthetic part
    └── test_messages.py
```

---

## Task 1 — Scaffold service and shared infrastructure

**Files:**
- Create: `visionking-sealer-bead-measurement.req`
- Create: `visionking-sealer-bead-measurement.Dockerfile`
- Create: `README.md`
- Create: `src/__init__.py`, `src/utils/__init__.py`
- Create: `src/utils/read_env_var.py`
- Create: `src/utils/connections.py`
- Copy: `src/communication_clients/` from `database-writer`
- Create: empty `__init__.py` for all `src/*` and `tests/`

- [ ] **Step 1: requirements**

```
# visionking-sealer-bead-measurement.req
open3d==0.18.0
numpy>=1.24,<2.0
scipy>=1.11,<2.0
aio-pika==9.5.5
redis>=5.0,<6.0
fakeredis>=2.20,<3.0
loguru>=0.7,<1.0
pydantic>=2.0,<3.0
pyyaml>=6.0,<7.0
python-dotenv>=1.0,<2.0
pytest>=8.0,<9.0
pytest-asyncio>=0.23,<1.0
```

- [ ] **Step 2: Dockerfile** (mirror SEALER-01 two-stage slim build with libgl1 for Open3D)

- [ ] **Step 3: env vars (`SBM_*` prefix)**

```python
# src/utils/read_env_var.py
import os
SBM_RABBIT_BROKER_HOST = os.getenv("SBM_RABBIT_BROKER_HOST", os.getenv("BROKER_HOST", "localhost"))
SBM_RABBIT_PORT        = int(os.getenv("SBM_RABBIT_PORT", os.getenv("RABBIT_PORT", "5672")))
SBM_RABBIT_USER        = os.getenv("SBM_RABBIT_USER", os.getenv("RABBIT_USER", "guest"))
SBM_RABBIT_PASS        = os.getenv("SBM_RABBIT_PASS", os.getenv("RABBIT_PASS", "guest"))
SBM_RABBIT_INPUT_QUEUE  = os.getenv("SBM_RABBIT_INPUT_QUEUE",  "sealer-measurement-queue")
SBM_RABBIT_OUTPUT_QUEUE = os.getenv("SBM_RABBIT_OUTPUT_QUEUE", "sealer-result-queue")
SBM_RABBIT_DURABLE        = os.getenv("SBM_RABBIT_DURABLE", "True").strip().lower() == "true"
SBM_RABBIT_PREFETCH_COUNT = int(os.getenv("SBM_RABBIT_PREFETCH_COUNT", "1"))
SBM_RABBIT_MAX_RETRIES    = int(os.getenv("SBM_RABBIT_MAX_RETRIES", "10"))

SBM_REDIS_HOST = os.getenv("SBM_REDIS_HOST", os.getenv("REDIS_HOST", "localhost"))
SBM_REDIS_PORT = int(os.getenv("SBM_REDIS_PORT", os.getenv("REDIS_PORT", "4000")))
SBM_REDIS_PASS = os.getenv("SBM_REDIS_PASS", os.getenv("REDIS_PASSWORD", ""))
SBM_REDIS_DB_SETTINGS   = int(os.getenv("SBM_REDIS_DB_SETTINGS", "3"))
SBM_REDIS_HASH_SETTINGS = os.getenv("SBM_REDIS_HASH_SETTINGS", "settings")

SBM_SEALER_CONFIG_DIR        = os.getenv("SBM_SEALER_CONFIG_DIR", "/config/sealer/")
# Note: no SBM_CAMERA_CALIBRATION_FILE — SEALER-03 consumes the cloud already in CAD frame
# and trusts T_part_to_CAD published by SEALER-01. No local pose composition.
SBM_LOGGING_LEVEL            = os.getenv("SBM_LOGGING_LEVEL", os.getenv("LOG_LEVEL", "INFO")).upper()
```

- [ ] **Step 4: connections factory** — mirror `point-cloud-processor` pattern (`create_rabbit_client`, `create_redis_settings`)

- [ ] **Step 5: copy communication_clients from database-writer** — no edits required

- [ ] **Step 6: empty `__init__.py`** for all subdirs

- [ ] **Step 7: commit scaffold**

```
feat(sealer-bead-measurement): scaffold service

SEALER-03 task 1: directory structure, requirements, Dockerfile,
SBM_* env vars, connections, communication_clients copy.
```

---

## Task 2 — Redis settings reader (TDD)

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_redis_settings.py` (failing tests first)
- Create: `src/settings/redis_settings.py`

- [ ] **Step 1: conftest fixtures**

```python
# tests/conftest.py
import pytest, fakeredis
@pytest.fixture
def redis_settings():
    r = fakeredis.FakeRedis(decode_responses=True)
    yield r
    r.flushdb()
```

- [ ] **Step 2: failing tests** — cover defaults, override per-field, type coercion (float/int/bool/enum-string), unknown method strings raise `ValueError`

```python
# tests/test_redis_settings.py — sketch
class TestSealerSettings:
    def test_defaults_when_hash_missing(self, redis_settings):
        s = SealerSettings(redis_settings, "settings")
        assert s.slice_interval_mm == 5.0
        assert s.search_margin_mm == 15.0
        assert s.tolerance_width_mm == 3.0
        assert s.bead_isolation_method == "ransac-plane"
        assert s.profile_fit_model == "gaussian"
        # Note: no `enable_icp_refinement` — registration is upstream (SEALER-01)

    def test_override_slice_interval(self, redis_settings):
        redis_settings.hset("settings", "sealer_slice_interval_mm", "2.5")
        s = SealerSettings(redis_settings, "settings")
        assert s.slice_interval_mm == 2.5

    def test_invalid_isolation_method_raises(self, redis_settings):
        redis_settings.hset("settings", "sealer_bead_isolation_method", "magic")
        s = SealerSettings(redis_settings, "settings")
        with pytest.raises(ValueError):
            s.bead_isolation_method
```

- [ ] **Step 3: implement `SealerSettings`** as dataclass-like reader with property accessors hitting Redis on each access (so live tuning works); validate enum strings

- [ ] **Step 4: commit** `feat(sealer-bead-measurement): redis settings reader (DB3 sealer_*)`

---

## Task 3 — Upstream registration guard (TDD)

> Replaces the previous "pose calibration loader" task (removed 2026-05-07 — best-fit ICP + part/camera pose composition moved to SEALER-01). SEALER-03 now consumes the CAD-frame cloud directly; the only registration-related logic it owns is **trusting** the upstream `T_part_to_CAD` and **rejecting degraded inputs** before they reach the pipeline.

**Files:**
- Create: `tests/test_upstream_guard.py`
- Create: `src/pipeline/upstream_guard.py`

A small validator that, given a parsed `SealerMeasurementMessage`, decides whether the input is trustworthy:

- `cad_registration.converged == True`
- `degraded == False`
- **(conditional)** if `sealer_bead_isolation_method == "cad-relative"`, `cad_registration.stl_path` must point to a readable STL file. For the default `ransac-plane` and `z-threshold` methods, no STL is needed — the guard does NOT inspect `stl_path`.

If any check fails, the message is rejected at the consumer boundary (NACK→DLX, see Task 16) and a structured log line is emitted. The guard does NOT recompute or refine `T_part_to_CAD` — it only gates downstream processing.

> Why conditional? SEALER-01 publishes `cad_registration.stl_path` for traceability, but SEALER-03 only loads the STL when running `cad-relative` isolation. Rejecting messages with empty `stl_path` unconditionally would drop perfectly valid `ransac-plane` runs if SEALER-01 ever published an empty/null path on a degraded path. (Note: SEALER-01's NACK→DLX on missing STL means in practice `stl_path` is always populated for converged messages — but we don't want to couple SEALER-03's guard to that internal upstream detail.)

- [ ] **Step 1: failing tests**

```python
# Cases:
# - converged=true, degraded=false, method=ransac-plane → ACCEPT (stl_path ignored)
# - converged=false → REJECT reason="cad_registration_not_converged"
# - degraded=true → REJECT reason="upstream_degraded"
# - method=cad-relative, stl_path empty → REJECT reason="missing_stl_for_cad_relative"
# - method=cad-relative, stl_path points at non-existent file → REJECT reason="stl_not_readable"
# - method=ransac-plane, stl_path empty → ACCEPT (path is irrelevant for this method)
# - reasons surface in structured log payload (assert via caplog/capfd)
```

- [ ] **Step 2: implement**

```python
# src/pipeline/upstream_guard.py
import os
from dataclasses import dataclass
from src.schema.messages import SealerMeasurementMessage
from src.settings.redis_settings import SealerSettings

@dataclass
class GuardDecision:
    accept: bool
    reason: str | None = None

def check_upstream_registration(
    msg: SealerMeasurementMessage,
    settings: SealerSettings,
) -> GuardDecision:
    if msg.degraded:
        return GuardDecision(False, "upstream_degraded")
    if not msg.cad_registration.converged:
        return GuardDecision(False, "cad_registration_not_converged")
    if settings.bead_isolation_method == "cad-relative":
        stl = msg.cad_registration.stl_path
        if not stl:
            return GuardDecision(False, "missing_stl_for_cad_relative")
        if not os.path.isfile(stl):
            return GuardDecision(False, "stl_not_readable")
    return GuardDecision(True)
```

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): upstream registration guard (NACK on degraded/non-converged)`

---

## Task 4 — Centerline loader (TDD)

**Files:**
- Create: `tests/test_centerline_loader.py`
- Create: `src/project_data/centerline_loader.py`

Parse `sealer_centerline.json`, validate schema, return list of `Bead(name, points: ndarray[N×3], expected_width_mm)`.

- [ ] **Step 1: failing tests**

```python
# Cases:
# - happy path: 2 beads, 5 pts each → returns 2 Bead objects with right shapes
# - missing file → raises CenterlineNotFoundError
# - empty beads list → raises CenterlineSchemaError
# - bead with <2 points → raises (need at least 2 for a polyline)
# - non-numeric points → raises pydantic ValidationError
# - model_type mismatch (json says X, asked for Y) → raises CenterlineSchemaError
```

- [ ] **Step 2: implement** with pydantic schema + path resolution `{config_dir}/{model_type}/sealer_centerline.json`

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): centerline JSON loader with schema validation`

---

## Task 5 — CAD loader (TDD)

**Files:**
- Create: `tests/test_cad_loader.py`
- Create: `src/project_data/cad_loader.py`

Loads `part.stl` via `o3d.io.read_triangle_mesh()` and exposes:
- `mesh: o3d.geometry.TriangleMesh`
- `raycaster()`: Open3D `RaycastingScene` with the mesh added — used by `cad-relative` isolation method

- [ ] **Step 1: failing tests** — synthetic STL (cube via `o3d.geometry.TriangleMesh.create_box`), assert raycast distance from a point above center face matches expected

- [ ] **Step 2: implement** lazy raycaster (only built if `cad-relative` method selected); `CadNotRequiredError` if accessed but file missing AND method is `cad-relative`

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): STL CAD loader + raycaster`

---

## Task 6 — Stage 1: Centerline anchoring (TDD)

> **Updated 2026-05-07:** Anchoring is a **direct match** now — both the centerline (`sealer_centerline.json`) and the merged cloud arrive in CAD coordinates. The previous part→camera transform step has been removed. This task is now purely resampling + tangent computation.

**Files:**
- Create: `tests/test_anchoring.py`
- Create: `src/pipeline/anchoring.py`

Resamples each centerline polyline (already in CAD frame) at uniform arc length and computes local tangents. No transform is applied.

- [ ] **Step 1: failing tests**

```python
# Synthetic bead: straight line along X-axis [(0,0,0), (100,0,0)] in CAD frame
# resample at 10 mm → 11 samples; values exactly preserved (no transform)
# tangents → all [1, 0, 0]
#
# Curved bead (semicircle): sample density follows arc-length
# Tangents perpendicular to radius at each sample
#
# Verify: anchored points are bit-identical to input polyline at native vertices
#         (no rounding/transform error introduced)
```

- [ ] **Step 2: implement**

```python
# src/pipeline/anchoring.py
def anchor_bead(bead: Bead, slice_interval_mm: float) -> AnchoredBead:
    """Resample a CAD-frame centerline polyline at uniform arc length and
    compute tangents. Both bead.points and the consumed cloud are already in
    CAD coordinates (SEALER-01 applied T_part_to_CAD upstream)."""
    pts = np.asarray(bead.points, dtype=float)
    arc_len = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    target = np.arange(0.0, arc_len[-1] + 1e-9, slice_interval_mm)
    resampled = np.column_stack([np.interp(target, arc_len, pts[:,k]) for k in range(3)])
    tangents = _central_diff_tangents(resampled)
    return AnchoredBead(bead.name, resampled, tangents, bead.expected_width_mm)
```

Tangent helper: central differences with normalization; spline smoothing only if length > threshold.

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): stage 1 — centerline anchoring (CAD-frame direct match)`

---

## Task 7 — Stage 2: Transversal slicing (TDD)

**Files:**
- Create: `tests/test_slicing.py`
- Create: `src/pipeline/slicing.py`

For each centerline sample, builds local frame (T, N, B) and selects points within slice thickness × search margin window.

- [ ] **Step 1: failing tests**

```python
# Synthetic point cloud: regular grid along straight bead with known offsets
# Single sample at center → expect points within ±slice_thickness/2 along T
#   AND within ±search_margin in B (and any N)
#
# Verify points expressed in local (B, N, T) frame have ~0 in T direction
#   (slice plane)
#
# Empty result when no points in window
#
# Edge case: tangent near vertical — N selection robust (project +Z)
```

- [ ] **Step 2: implement**

```python
def slice_at_sample(
    cloud: np.ndarray, center: np.ndarray, tangent: np.ndarray,
    slice_thickness_mm: float, search_margin_mm: float
) -> np.ndarray:
    # Build orthonormal frame
    up = np.array([0., 0., 1.])
    if abs(np.dot(up, tangent)) > 0.95: up = np.array([0., 1., 0.])
    binormal = np.cross(tangent, up); binormal /= np.linalg.norm(binormal)
    normal = np.cross(binormal, tangent)
    R = np.column_stack([binormal, normal, tangent])  # (B, N, T)
    rel = (cloud - center) @ R  # to local
    in_slice = (np.abs(rel[:,2]) <= slice_thickness_mm/2) & (np.abs(rel[:,0]) <= search_margin_mm)
    return rel[in_slice]
```

KD-tree optimization deferred (premature for ~2M points / N samples).

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): stage 2 — transversal slicing`

---

## Task 8 — Stage 3a: Z-threshold isolation (TDD)

**Files:**
- Create: `tests/test_isolation_z_threshold.py`
- Create: `src/pipeline/isolation.py` (with method dispatch: starts with z-threshold, expanded in tasks 9 & 10)

- [ ] **Step 1: failing tests**

```python
# Slice in local frame with synthetic surface (N ≈ 0) and bead bump (N ≈ 1.5..2.5)
# z-threshold isolates bead points → mask correctly identifies the bump
# Threshold = min_height_above_surface_mm; surface estimated as median(N)
```

- [ ] **Step 2: implement**

```python
def isolate_z_threshold(slice_local: np.ndarray, min_height_above_surface_mm: float) -> np.ndarray:
    surface = np.median(slice_local[:,1])
    return slice_local[:,1] >= surface + min_height_above_surface_mm
```

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): stage 3a — z-threshold bead isolation`

---

## Task 9 — Stage 3b: RANSAC plane isolation (TDD, default method)

**Files:**
- Update: `tests/test_isolation_ransac.py`
- Update: `src/pipeline/isolation.py`

- [ ] **Step 1: failing tests**

```python
# Slice with tilted surface (slope of 3°) + bead → method must subtract plane
# Use Open3D's plane segmentation (or scipy least squares) on B-N projection
# Verify > 90% of bead points are above plane by ≥ min_height_above_surface_mm
# Verify slice with no bead returns empty mask
```

- [ ] **Step 2: implement**

```python
import open3d as o3d
def isolate_ransac_plane(slice_local: np.ndarray, min_height_above_surface_mm: float, ransac_n=3, num_iter=200) -> np.ndarray:
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(slice_local)
    plane_model, inliers = pcd.segment_plane(distance_threshold=0.5, ransac_n=ransac_n, num_iterations=num_iter)
    a, b, c, d = plane_model
    signed_dist = (slice_local @ np.array([a,b,c]) + d) / np.linalg.norm([a,b,c])
    return signed_dist >= min_height_above_surface_mm
```

(orient plane normal toward +N if needed)

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): stage 3b — RANSAC plane bead isolation`

---

## Task 10 — Stage 3c: CAD-relative isolation (TDD)

**Files:**
- Update: `tests/test_isolation_cad_relative.py`
- Update: `src/pipeline/isolation.py`

- [ ] **Step 1: failing tests**

```python
# Synthetic CAD: flat plane at N=0
# Slice with surface points at N≈0 (small noise) + bead bump
# raycaster.compute_signed_distance(points) should give >= min_height for bead, ~0 for surface
```

- [ ] **Step 2: implement**

```python
def isolate_cad_relative(slice_cad_frame: np.ndarray, raycaster: o3d.t.geometry.RaycastingScene,
                         min_height_above_surface_mm: float) -> np.ndarray:
    qs = o3d.core.Tensor(slice_cad_frame.astype(np.float32))
    sd = raycaster.compute_signed_distance(qs).numpy()
    return sd >= min_height_above_surface_mm
```

Note: CAD-relative requires slice points in **CAD frame**. Both the merged cloud and the raycaster mesh (loaded from `cad_registration.stl_path`) are in CAD coordinates after the upstream best-fit by SEALER-01, so no transform is applied here. The dispatcher passes the original CAD-frame slice (not the local B-N-T frame used by `z-threshold` / `ransac-plane`).

- [ ] **Step 3: dispatcher** in `isolation.py`:

```python
def isolate(slice_local, slice_cad, settings, raycaster=None) -> np.ndarray:
    method = settings.bead_isolation_method
    if method == "z-threshold":
        return isolate_z_threshold(slice_local, settings.min_height_above_surface_mm)
    if method == "ransac-plane":
        return isolate_ransac_plane(slice_local, settings.min_height_above_surface_mm)
    if method == "cad-relative":
        if raycaster is None:
            raise CadNotRequiredError("cad-relative method requires part.stl + raycaster")
        return isolate_cad_relative(slice_cad, raycaster, settings.min_height_above_surface_mm)
    raise ValueError(f"Unknown isolation method: {method}")
```

- [ ] **Step 4: commit** `feat(sealer-bead-measurement): stage 3c — CAD-relative bead isolation + dispatcher`

---

## Task 11 — Stage 4: Profile fit and metrics (TDD)

**Files:**
- Create: `tests/test_profile_fit.py`
- Create: `src/pipeline/profile_fit.py`

Fits Gaussian or parabolic profile to per-slice bead points (B-N plane, ignoring T) and extracts: width, height, continuity, volume, lateral offset.

- [ ] **Step 1: failing tests**

```python
# Synthetic bead profile: Gaussian h(b) = 2.0 * exp(-(b-0.5)²/(2*1.0²))
# generate ~30 points along this curve with small noise
# Gaussian fit → h0 ≈ 2.0, σ ≈ 1.0, b0 ≈ 0.5
# width (FWHM) ≈ 2.355*σ ≈ 2.355 mm
# offset = b0 = 0.5 mm
# volume = h0 * σ * sqrt(2π) * slice_thickness  (analytical for gaussian)
#
# Parabolic profile: h(b) = -0.8*(b-0)² + 2.0
# parabolic fit recovers a=-0.8, b0=0, h0=2.0
# zero crossings at b = ±sqrt(h0/|a|) → width = 2*sqrt(2.5) ≈ 3.16 mm
#
# Insufficient data (< 5 points) → returns NaN metrics with continuity_pct=0
# R² below threshold → segment marked invalid
```

- [ ] **Step 2: implement**

```python
from scipy.optimize import curve_fit
def _gaussian(b, h0, b0, sigma): return h0 * np.exp(-((b-b0)**2) / (2*sigma**2))
def _parabolic(b, a, b0, h0): return a*(b-b0)**2 + h0

def fit_segment(bead_points_local: np.ndarray, slice_thickness_mm: float,
                model: str, r2_min: float) -> SegmentMetrics:
    if len(bead_points_local) < 5:
        return SegmentMetrics.invalid()
    b = bead_points_local[:,0]; h = bead_points_local[:,1]
    try:
        if model == "gaussian":
            popt, _ = curve_fit(_gaussian, b, h, p0=[h.max(), b.mean(), 2.0], maxfev=200)
            h0, b0, sigma = popt
            width = 2.355 * abs(sigma)
            volume = h0 * abs(sigma) * np.sqrt(2*np.pi) * slice_thickness_mm
        else:  # parabolic
            popt, _ = curve_fit(_parabolic, b, h, p0=[-0.5, b.mean(), h.max()], maxfev=200)
            a, b0, h0 = popt
            if a >= 0:  return SegmentMetrics.invalid()
            width = 2 * np.sqrt(h0 / -a)
            volume = (2/3) * h0 * width * slice_thickness_mm
        # R² check
        residuals = h - (_gaussian(b, *popt) if model=="gaussian" else _parabolic(b, *popt))
        ss_res = np.sum(residuals**2); ss_tot = np.sum((h - h.mean())**2)
        r2 = 1 - ss_res/ss_tot if ss_tot > 0 else 0.0
        if r2 < r2_min:
            return SegmentMetrics.invalid(reason=f"r2={r2:.2f}<{r2_min}")
        return SegmentMetrics(width_mm=width, height_mm=h0, volume_mm3=volume,
                              position_offset_mm=b0, r2=r2, valid=True)
    except (RuntimeError, ValueError) as e:
        return SegmentMetrics.invalid(reason=str(e))
```

Continuity at the bead level: `valid_segments / total_segments * 100`.

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): stage 4 — profile fit + metrics`

---

## Task 12 — _(removed 2026-05-07 — best-fit ICP moved to SEALER-01)_

The previous "Optional ICP refinement" task is no longer applicable. SEALER-01 now publishes a CAD-frame cloud with a converged `T_part_to_CAD`; SEALER-03 trusts that registration (see Task 3 — Upstream registration guard). The `sealer_enable_icp_refinement` setting is also removed from the runtime settings (see Task 2).

If, in a later release, a per-part fine-tune step is reintroduced inside SEALER-03, it will be planned as a new task with its own spec — but for v1 there is **no local registration**.

---

## Task 13 — Pass/fail evaluation (TDD)

**Files:**
- Create: `tests/test_pass_fail.py`
- Create: `src/evaluation/pass_fail.py`

- [ ] **Step 1: failing tests**

```python
# Per-segment: width<3 → fail, height<1.5 → fail, offset>2 → fail, NaN metrics → fail
# Per-bead: continuity_pct = (valid_segments / total) * 100; fail if <80
#           OR if any segment failed
# Whole-part: fail if any bead failed
# Happy path with all clean metrics → all pass
```

- [ ] **Step 2: implement** simple comparators returning (`segment_pass_fail`, `bead_pass_fail`, `overall_pass_fail`) given settings + `SegmentMetrics` lists

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): pass/fail evaluation`

---

## Task 14 — Pydantic message schemas (TDD)

**Files:**
- Create: `tests/test_messages.py`
- Create: `src/schema/messages.py`

- [ ] **Step 1: failing tests**

```python
# Parse a sample input message JSON (per SEALER-01 spec §2 Output Message) → SealerMeasurementMessage
# Reject missing required fields (part_uuid, vin_number, model_type, camera_serial_number,
#   merged_ply_path, depth_map_path, cad_registration)
# Validate cad_registration block (canonical schema — see SEALER-01 spec §2):
#   - T_part_to_CAD parsed as 4x4 numpy-friendly nested list
#   - converged is bool, rmse_mm/fitness are float (no separate inliers_pct field)
#   - stl_path required (string), stl_mtime optional (ISO-8601 string)
#   - iterations optional int
# Optional fields parsed when present: depth_map_origin_mm (list[float] len 2),
#   depth_map_resolution_mm (float)
# Serialize SealerInspectionResult → JSON matches spec §6 schema
# Field types preserved (floats stay floats, no string coercion in output)
```

- [ ] **Step 2: implement** input + output models

```python
class CadRegistration(BaseModel):
    T_part_to_CAD: list[list[float]]   # 4x4
    rmse_mm: float
    fitness: float                      # Open3D-reported inlier ratio (canonical)
    iterations: int | None = None       # diagnostic
    converged: bool
    stl_path: str
    stl_mtime: str | None = None        # ISO-8601, for cache observability

class SealerMeasurementMessage(BaseModel):
    part_uuid: str; vin_number: str; model_type: str; camera_serial_number: str
    total_frames: int; partial: bool; degraded: bool
    merged_ply_path: str; depth_map_path: str; stitched_image_path: str
    total_points: int; scan_duration_ms: int; processed_at: str
    cad_registration: CadRegistration
    depth_map_origin_mm: list[float] | None = None      # [x_min, y_min] in CAD mm
    depth_map_resolution_mm: float | None = None        # CAD-frame pixel size

class SegmentResult(BaseModel):
    segment_id: int; arc_length_mm: float
    width_mm: float; height_mm: float; continuity_pct: float
    volume_mm3: float; position_offset_mm: float
    pass_fail: bool

class BeadResult(BaseModel):
    bead_name: str; bead_pass_fail: bool; segments: list[SegmentResult]

class SealerInspectionResult(BaseModel):
    part_uuid: str; vin_number: str; model_type: str
    overall_pass_fail: bool; beads: list[BeadResult]
```

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): pydantic input/output message schemas`

---

## Task 15 — Pipeline runner (TDD, integrates stages 1-4)

**Files:**
- Create: `tests/test_runner.py`
- Create: `src/pipeline/runner.py`

The runner orchestrates: load PLY (already in CAD frame) → load CAD/centerlines (lazy by method) → resample centerline → for each centerline sample: slice + isolate + fit → assemble metrics → pass/fail → return `SealerInspectionResult`.

> **No registration step inside the runner.** The cloud is consumed as-is — SEALER-01 already aligned it to CAD via the upstream best-fit ICP, and the upstream guard (Task 3) has already rejected non-converged inputs at the consumer boundary.

- [ ] **Step 1: failing test (integration on synthetic part)**

```python
# Build a synthetic merged.ply: flat plane + 2 straight beads (gaussian profile in cross-section),
# all in CAD coordinates.
# Build synthetic sealer_centerline.json with 2 beads matching the cloud (CAD frame).
# Method = ransac-plane.
# Expected: 2 beads, N segments each, all width ~ expected, all pass
#
# Negative case: bead with simulated gap (no points) → segments in the gap
#   marked invalid → continuity_pct < 80 → bead fails → overall fails
```

- [ ] **Step 2: implement**

```python
def run_inspection(
    msg: SealerMeasurementMessage, settings: SealerSettings,
    centerline: list[Bead], cad: CadLoader | None
) -> SealerInspectionResult:
    # Cloud is already in CAD frame (SEALER-01 applied T_part_to_CAD upstream).
    # The matrix msg.cad_registration.T_part_to_CAD is kept for diagnostics only.
    cloud = load_ply(msg.merged_ply_path)
    bead_results = []
    for bead in centerline:
        anchored = anchor_bead(bead, settings.slice_interval_mm)
        segments = []
        for i, (center, tangent) in enumerate(zip(anchored.points, anchored.tangents)):
            slice_local = slice_at_sample(cloud, center, tangent,
                                          settings.slice_thickness_mm, settings.search_margin_mm)
            slice_cad = (slice_local @ build_R(tangent).T) + center
            mask = isolate(slice_local, slice_cad, settings,
                           raycaster=cad.raycaster() if cad else None)
            metrics = fit_segment(slice_local[mask], settings.slice_thickness_mm,
                                  settings.profile_fit_model, settings.profile_fit_r2_min)
            segments.append(metrics_to_segment_result(i, anchored.arc_length[i], metrics, settings))
        bead_results.append(aggregate_bead(bead.name, segments, settings))
    overall = all(b.bead_pass_fail for b in bead_results)
    return SealerInspectionResult(part_uuid=msg.part_uuid, vin_number=msg.vin_number,
                                   model_type=msg.model_type, overall_pass_fail=overall,
                                   beads=bead_results)
```

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): pipeline runner — integrates stages 1-4`

---

## Task 16 — RabbitMQ consumer + entry point (TDD)

**Files:**
- Create: `visionking-sealer-bead-measurement.py` (entry point)
- Update: `tests/test_runner.py` (or add `test_consumer.py`) — message round-trip via in-memory RabbitMQ if available, else mock

- [ ] **Step 1: failing test for consumer wiring**

```python
# Mock RabbitClient: feed a SealerMeasurementMessage JSON (with cad_registration block)
# Service consumes → guard accepts → runs pipeline (mocked run_inspection) → publishes to output queue
# Validate output JSON matches SealerInspectionResult schema
# Failure cases:
#   - missing centerline → NACK with requeue=False (DLX)
#   - cad_registration.converged=false → guard rejects → NACK→DLX with structured log
#   - degraded=true → guard rejects → NACK→DLX with structured log
```

- [ ] **Step 2: implement**

```python
# visionking-sealer-bead-measurement.py
import asyncio
from src.utils.connections import create_rabbit_client, create_redis_settings
from src.utils.read_env_var import *
from src.project_data.cad_loader import CadLoader
from src.project_data.centerline_loader import load_centerline
from src.settings.redis_settings import SealerSettings
from src.pipeline.runner import run_inspection
from src.pipeline.upstream_guard import check_upstream_registration
from src.schema.messages import SealerMeasurementMessage, SealerInspectionResult
from loguru import logger

async def handle_message(message_body: bytes, settings: SealerSettings, output):
    try:
        msg = SealerMeasurementMessage.model_validate_json(message_body)
    except Exception as e:
        logger.error(f"Malformed message: {e}")
        raise NackToDLX
    # Trust upstream registration; reject degraded/non-converged inputs at the boundary.
    decision = check_upstream_registration(msg)
    if not decision.accept:
        logger.bind(part_uuid=msg.part_uuid, vin=msg.vin_number,
                    reason=decision.reason).error("upstream_registration_rejected")
        raise NackToDLX
    try:
        centerline = load_centerline(SBM_SEALER_CONFIG_DIR, msg.model_type)
        cad = CadLoader.try_load(SBM_SEALER_CONFIG_DIR, msg.model_type,
                                 required=settings.bead_isolation_method == "cad-relative")
        result = run_inspection(msg, settings, centerline, cad)
        await output.publish(result.model_dump_json().encode())
    except (CenterlineNotFoundError, CadNotRequiredError, FileNotFoundError) as e:
        logger.error(f"Project data error: {e}"); raise NackToDLX
    except Exception:
        logger.exception("Unexpected error"); raise NackToDLX  # fail closed → DLX

async def main():
    logger.info("sealer-bead-measurement starting")
    redis_settings_client = create_redis_settings()
    settings = SealerSettings(redis_settings_client, SBM_REDIS_HASH_SETTINGS)
    rabbit = create_rabbit_client()
    await rabbit.connect()
    await rabbit.consume(SBM_RABBIT_INPUT_QUEUE,
                          on_message=lambda body: handle_message(body, settings, rabbit.output))
    await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): RabbitMQ consumer + entry point`

---

## Task 17 — Topology + deploy artifacts

**Files:**
- Update: `topologies/sealer-single-node.yaml` (visionking monorepo) — add the service entry, queue bindings, DLX wiring
- Update: `architecture/vk-sealer-pipeline.md` (visionking monorepo) — confirm stage 5 wiring matches implementation
- Update: `services/visionking-sealer-bead-measurement/README.md` — usage, env vars, runtime settings, link to spec

- [ ] **Step 1: topology entry**

```yaml
sealer-bead-measurement:
  image: ghcr.io/strokmatic/visionking-sealer-bead-measurement:0.1.0
  resources:
    memory: 2GB
    cpu: 1.0
  consumes: [sealer-measurement-queue]
  produces: [sealer-result-queue]
  dead_letter_exchange: vk.sealer.dlx
  volumes:
    - /var/visionking/sealer-config:/config/sealer:ro   # part.stl + sealer_centerline.json (CAD frame)
    - /var/visionking/img_saved:/img_saved              # merged.ply (CAD frame, written by SEALER-01)
  # No camera calibration mount — SEALER-03 consumes the cloud already in CAD frame.
```

- [ ] **Step 2: README** documenting:
  - Runtime tunables (Redis DB3 fields with defaults from settings)
  - Sample `sealer_centerline.json`
  - How to swap isolation methods at runtime (`HSET settings sealer_bead_isolation_method cad-relative`)
  - Failure modes (NACK→DLX) and how to recover (fix file → reinject from DLQ)

- [ ] **Step 3: commit** `feat(sealer-bead-measurement): topology entry + README + architecture sync`

---

## Task 18 — End-to-end smoke test on real fixture

**Files:**
- Create: `tests/test_e2e_fixture.py` (skipped by default; opt-in via env var or marker)

- [ ] **Step 1: gather inputs (depends on Hyundai pendency [1.3])**
  - `part.stl` from CAD provided by Hyundai (Creta 2026)
  - `sealer_centerline.json` derived from robot path + CAD landmarks
  - `merged.ply` from a captured part (using the post-review SEALER-01 build)

- [ ] **Step 2: smoke test**

```python
@pytest.mark.skipif("not REAL_FIXTURE_AVAILABLE")
def test_e2e_real_creta_2026(tmp_path):
    # Loads real STL + centerline + merged.ply
    # Runs full pipeline → asserts:
    #   - 2 beads detected (left_sill, right_sill)
    #   - Width within ±50% of expected_width_mm (loose acceptance)
    #   - At least 80% segments have valid fit (continuity)
    # Saves diagnostic plot of profiles for manual inspection
```

- [ ] **Step 3: commit** `test(sealer-bead-measurement): real-fixture smoke test (gated)`

---

## Cross-cutting checks (run after every task)

- `pytest -x -q` — all tests passing, no skips except gated e2e
- `python -m mypy src/` — no errors (or matched baseline)
- `ruff check src/ tests/` — clean
- Coverage of new code ≥ 85%

---

## Definition of done

- All 17 active tasks committed on `feat/sealer-bead-measurement-init` (Task 12 retired 2026-05-07)
- ≥ 60 unit tests, all passing (was ~70 — dropped the ICP-refinement & pose-calibration suites)
- E2E smoke test gated and documented (will activate when Hyundai delivers CADs — pendência [1.3])
- Service runs in `sealer-single-node.yaml` topology
- Submodule pointer in monorepo updated; PR opened against `master`
- Backlog `visionking.md` SEALER-03 marked complete after merge
- Changelog entry via `changelog-writer` MCP tool
- Overview 03008 updated: `[4.6]` SEALER-03 spec ✅; `[4.7]` SEALER-03 implementation ✅

---

## Sequencing notes

- Tasks 1-2: scaffolding, no algorithm
- Task 3: upstream registration guard (replaces former pose-calibration loader)
- Tasks 4-5: data loaders (parallel-safe with task 3)
- Tasks 6-11: algorithm core, **must be sequential** (each builds on previous shapes/contracts)
- Task 12: retired (best-fit ICP responsibility moved to SEALER-01 on 2026-05-07)
- Tasks 13-14: orthogonal — can be done after 11 in any order
- Task 15: integration — gates everything before it
- Tasks 16-17: deployment wiring — after pipeline is green
- Task 18: gated by Hyundai input (does not block merge of v1)

**Parallelization strategy** (if more than one engineer): tasks 3, 4, 5 (guard + loaders) can be split. Tasks 8, 9, 10 (isolation methods) can be split. Everything else is on critical path.

---

## Effort delta vs prior version

| Removed | Saving |
|---|---|
| Task 3 — Pose calibration loader | ~0.25 d |
| Task 12 — Optional ICP refinement | ~0.5 d |
| `enable_icp_refinement` plumbing in runner/settings | ~0.1 d |
| **Total** | **~0.85 d saved** |

| Added | Cost |
|---|---|
| Task 3 (replacement) — Upstream registration guard | ~0.15 d |
| `cad_registration` schema + tests in Task 14 | ~0.15 d |
| Guard wiring + degraded-NACK tests in Task 16 | ~0.1 d |
| **Total** | **~0.4 d added** |

**Net saving: ~0.45 d** of SEALER-03 effort, offset by the matching investment in SEALER-01 Stage 5 (tracked in that plan).
