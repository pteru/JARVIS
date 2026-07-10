---
type: Design Spec
title: [4.13] SEALER-09 E2E Pipeline → DB Tests — Design Spec
description: End-to-end integration tests covering the **full sealer capture-to-DB pipeline** post the 2026-06-01 architectural pivot:
timestamp: 2026-05-06
---

# [4.13] SEALER-09 E2E Pipeline → DB Tests — Design Spec

> **Profile**: `vk-sealer`
> **Project**: 03008
> **Backlog**: SEALER-09 in `backlogs/strokmatic/visionking.md`
> **Date**: 2026-05-06 (revised 2026-05-07; **rewritten 2026-06-01 post-pivot**)
> **Status**: Draft

---

## 1. Overview

End-to-end integration tests covering the **full sealer capture-to-DB pipeline** post the 2026-06-01 architectural pivot:

```
Frame injection
  → image-saver
  → point-cloud-processor (SEALER-01) ────► sealer-measurement-queue (1/part)
  │                                          → sealer-bead-measurement (SEALER-03)
  │                                            → sealer-result-queue
  │                                              → result-writer-3d → DB
  │
  └────► sealer-inference-queue (N/part, per frame, centerline_projected[])
         → inference (sealer-per-frame)
           → sealer-detection-queue
             → pixel-to-object (VK_PROFILE=sealer)
               → (track output queue TBD — coordinate with sealer-result spec)

In parallel:
  image-saver → sealer-frame-writer-queue → frame-writer → DB (pecas, frames, frames_pecas)
```

**Scope**:
- ✅ Pipeline services from frame ingestion through DB persistence
- ✅ DB schema validation (rows in the **B-light common schema** — `pecas`, `frames`, `frames_pecas`, `subcomponente`, `types`, `defeitos_agg`, `defeitos` — per [4.8]).
- ✅ Smoke for the per-frame inference fan-out (N inference messages emitted; pixel-to-object consumes presence=true; absence rows pass through to TBD writer).
- ❌ **Out of scope**: backend-sealer + frontend-sealer (have their own E2E tests).
- ❌ **Out of scope**: Hikrobot camera hardware (synthetic frame injection).
- ❌ **Out of scope**: `sealer-result` service (PLC handshake) — covered by [4.12] with `fakeredis`-based unit/integration tests.
- ❌ **Out of scope (post-pivot)**: per-anchor-segment 2D detection persistence (class IDs 1020/1021). Pending the companion spec for detection persistence (see SEALER-05 §11). When that spec lands, an additional scenario will be added here.

The test harness lives in `tests/e2e/sealer/`, mirroring the existing `tests/e2e/steel/` structure.

---

## 2. Architecture

This suite **extends the existing VK monorepo E2E pattern** (see `tests/e2e/README.md`): single `docker-compose.yml` with profiles, `Makefile`-driven runner, pytest with markers, profile-specific fixtures under `tests/e2e/{profile}/`. It does **not** introduce a parallel `docker-compose.test.yml` or `run-test.sh` — sealer is added as another **application profile** alongside `steel` and `body`.

### 2.1 docker-compose changes (extension)

Add a new **application profile `sealer`** to the existing `tests/e2e/docker-compose.yml`. The profile composes the shared broker infra (`postgres`/`redis`/`rabbitmq`, already declared) with sealer-specific services:

```
tests/e2e/docker-compose.yml  (existing file — extended)
├── broker profile (existing — reused as-is)
│   ├── postgres   ── sealer DB seeded from tests/e2e/shared/sql/
│   │                  (sql-vk-common schema + procedures/sealer/* + sealer classe_defeitos)
│   ├── redis (KeyDB)
│   └── rabbitmq
└── sealer profile (post-pivot 2026-06-01)
    ├── image-saver              (IMG_SAVER_SUPPORTED_DATA_TYPES=pointcloud)
    ├── point-cloud-processor    (mounts ./sealer/fixtures:/cad/sealer:ro;
    │                              PCP_DEPTH_MAP_ENABLED=false)
    ├── sealer-bead-measurement  (same mount; SEALER-03 reads cad_registration.stl_path
    │                              from the upstream message)
    ├── inference                (INF_PROFILE=sealer-per-frame,
    │                              INF_SEALER_ANALYZER=mock)
    ├── pixel-to-object          (VK_PROFILE=sealer; consumes sealer-detection-queue)
    ├── frame-writer             (db-writer default mode → insert_sealer_frame)
    └── result-writer-3d         (db-writer default mode → insert_sealer_measurements)
```

**Removed vs pre-pivot:** `result-writer-2d` (deleted along with `sealer-2d-result-queue`). **Added:** `pixel-to-object`.

Profile switching follows the existing convention (`PROFILE=steel` is the default; passing `PROFILE=sealer` enables the sealer compose profile + loads the matching SQL seed + mounts the matching fixture dir).

### 2.2 Runner (existing Makefile pattern)

```bash
# Boot infra + sealer services
PROFILE=sealer make e2e-up LAYER=full

# Run sealer pipeline tests (uses pytest @pytest.mark.pipeline marker)
PROFILE=sealer make e2e-test LAYER=pipelines

# Tear down
make e2e-down
```

No new shell scripts. All orchestration lives in the existing `Makefile`. The `LAYER=pipelines` target runs `pytest tests/e2e/pipelines/` — sealer's pipeline tests land there as `test_sealer_pipeline.py` next to the existing `test_steel_pipeline.py`.

### 2.3 Pytest test layout

```
tests/
├── factories/
│   └── sealer_messages.py        # NEW — build sealer frame messages (Redis HASH payloads)
├── helpers/
│   └── sealer_wait.py            # NEW — poll DB for processing completion
├── fixtures/
│   └── sealer_pipeline.py        # NEW — pytest fixtures: redis/rabbitmq clients, fixtures path
└── e2e/
    ├── pipelines/
    │   ├── test_steel_pipeline.py        (existing)
    │   └── test_sealer_pipeline.py       # 8 scenarios as parametrized pytest tests
    ├── shared/sql/
    │   └── sealer-classe-defeitos.sql    # sealer-specific defect class seeds
    └── sealer/                           # profile fixture data (mirrors tests/e2e/steel/)
        ├── fixtures/
        │   ├── CRETA_2026/
        │   │   ├── part.stl
        │   │   └── sealer_centerline.json   # includes bead_id + expected_height_mm
        │   └── scenarios/
        │       ├── happy-path/
        │       ├── narrow-bead/
        │       └── ... (8 scenarios)
        └── scripts/
            └── generate_fixtures.py      # one-off fixture generator (idempotent; output is committed)
```

---

## 3. Test Scenarios

### 3.1 happy-path (acceptance)
- 20 frames per part, 1 part, 2 beads (left_sill + right_sill)
- All segments pass tolerances; `cad_registration.converged=true`
- **Expected DB state** (all in common schema):
  - 1 row in `pecas` (peca = part_uuid; process_tags has VIN + model_type; nao_conforme=false; qtd_defeitos=0)
  - 1 row in `types` (CRETA_2026)
  - 2 rows in `subcomponente` (left_sill, right_sill)
  - 20 rows in `frames` (linked via `frames_pecas`)
  - 2 rows in `defeitos_agg` (1 per bead, class_id=1010 sealer_bead_pass)
  - ~80 rows in `defeitos` from 3D measurements (class_id=1000 sealer_segment_pass), all with `metrics jsonb` populated
- **Expected RabbitMQ state**:
  - 1 message processed on `sealer-measurement-queue` (from SEALER-01 to SEALER-03).
  - **20 messages processed on `sealer-inference-queue`** (one per frame, with `centerline_projected[]`).
  - 20 messages processed on `sealer-detection-queue` (one per frame; `MockAnalyzer` emits deterministic detections; `pixel-to-object` aggregates).
  - Track output queue (TBD per pixel-to-object → sealer-result spec): coverage TBD.
- **Per-anchor-segment 2D detection rows (class 1020/1021) NOT asserted** — persistence path deferred (companion spec).

### 3.2 narrow-bead (width fail)
- Synthetic point cloud with bead width 2.5mm (below 3mm threshold)
- **Expected**: `pecas.nao_conforme=TRUE`; affected bead's `defeitos_agg.class_id=1011` (sealer_bead_fail); affected segments have `class_id=1001` (sealer_segment_fail)

### 3.3 gap (continuity fail)
- Synthetic point cloud with 30mm gap in left_sill
- **Expected**: left_sill `defeitos_agg.metrics->>'continuity_pct'` < 80; class_id=1011

### 3.4 offset (lateral position fail)
- Bead displaced 3mm laterally (above 2mm threshold)
- **Expected**: affected segments have `metrics->>'position_offset_mm' > 2`, class_id=1001

### 3.5 no-centerline (config error)
- Trigger inspection for `model_type=UNKNOWN_MODEL` (no centerline file under `/config/sealer/`)
- **Expected**:
  - **SEALER-01 NACKs to DLX** (centerline is loaded by Stage 7 — missing file is a config error; per SEALER-01 spec §7 row "sealer_centerline.json missing").
  - SEALER-03 never receives a measurement message (SEALER-01 also doesn't publish the consolidated `sealer-measurement-queue` msg when it NACKs).
  - No row in `pecas` (frame-writer never receives anything either, since the NACK happens after accumulation completes but before publishing).
  - `sealer-processed-dlq` (or the equivalent input DLQ for SEALER-01) has ≥1 message.

> **Pre-pivot note:** before 2026-06-01 this scenario asserted on `sealer-measurement-dlq` (NACK by SEALER-03). Post-pivot the centerline-load step moves upstream to SEALER-01 Stage 7, so the NACK happens one step earlier.

### 3.6 reinspection (UPSERT)
- Run happy-path twice with same `part_uuid`
- **Expected**: pecas row updated (most recent `inspected_at`); old `defeitos_agg` and `defeitos` rows DELETED; new ones inserted (cascade via `insert_sealer_measurements`)

### 3.7 partial-frames (degraded mode)
- Only 12 of 20 frames published
- After timeout, point-cloud-processor publishes `partial=true`, `degraded=true`
- **Expected**: Inspection still processed with whatever frames available; `pecas` updated; `regras_de_negocio` jsonb captures `degraded=true`

### 3.8 best-fit-failure (cad-non-convergence)
- Synthetic merged cloud massively perturbed: 60° rotation + 200 mm translation
  vs the CAD STL — impossible to register within `cad_registration_rmse_threshold_mm`.
- **Expected**:
  - SEALER-01 publishes consolidated `sealer-measurement-queue` message with
    `degraded=true`, `cad_registration.converged=false`, `T_part_to_CAD = identity`.
    `merged.ply` saved in part frame.
  - **SEALER-01 Stage 7 is skipped** — no per-frame messages emitted to
    `sealer-inference-queue` (per SEALER-01 spec §7 row "ICP fails to converge").
  - SEALER-03 NACKs `sealer-measurement-queue` to DLX (degraded input).
  - Inference (sealer-per-frame) never sees any input; no detections produced;
    `sealer-detection-queue` stays empty for this part.
  - Pixel-to-object idle for this part.
  - DB state: **1 row in `pecas`** (created by frame-writer's `insert_sealer_frame`
    UPSERT — see [4.8] §4.1 step 2 — runs independently of bead-measurement);
    `nao_conforme` left at its column default (no measurement rollup ever ran);
    20 rows in `frames` linked via `frames_pecas`; **0 rows in `defeitos_agg`
    AND `defeitos`** — load-bearing assertion that bead-measurement never produced
    a result.
  - DLQ state: ≥1 message in `sealer-measurement-dlq`. The `sealer-frame-writer-dlq`
    remains empty. The `sealer-inference-queue` and `sealer-detection-queue` see
    no messages at all (Stage 7 skip is the load-bearing signal).

> **Pre-pivot note:** the v1 spec asserted on `sealer-2d-result-dlq` (now deleted)
> and on inference NACKing degraded input. Post-pivot the assertion is **silence**
> on `sealer-inference-queue` (no fan-out emitted) — verify via queue depth or
> consumer counters, not via DLQ.

> **Known semantic gap (out of scope for this spec):** the `pecas` row in this
> scenario is indistinguishable from a still-processing or successful-pass row
> by inspecting `pecas` alone (`nao_conforme` default, `qtd_defeitos=0`). The
> load-bearing signal that the inspection failed is the absence of rows in
> `defeitos_agg`/`defeitos`. Tightening this would require [4.8] schema to add
> an explicit `inspection_status` — tracked as Phase 2 schema enhancement.

This complements `no-centerline` (which exercises a config-error path); `best-fit-failure` exercises an algorithm-failure path — both are necessary to cover the SEALER-01 degraded contract end-to-end (per SEALER-01 §4 Stage 5 / §7 Error Handling).

### 3.9 Removed scenario: `2d-detection-only`

The v1 spec carried a `2d-detection-only` scenario that exercised the path "valid `stitched.png` + corrupt PLY → 3D fails, 2D succeeds". **This scenario is removed post-pivot** because:

- Stitching is gone — there is no `stitched.png`.
- Inference no longer runs independently of the point cloud. The per-frame projection (SEALER-01 Stage 7) depends on a valid CAD-aligned cloud. A corrupt PLY breaks Stage 5 (ICP) → Stage 7 is skipped → no inference input → no detections.

The "2D-only path" is no longer architecturally meaningful. If the persistence path for per-anchor-segment 1020/1021 detections requires E2E coverage in the future, a new scenario will be added once the companion detection-persistence spec lands.

---

## 4. Fixtures

### 4.1 Synthetic part data

`tests/e2e/sealer/fixtures/CRETA_2026/`:
- `part.stl` — generated programmatically via `trimesh` (cube + 2 cylinder bumps representing beads). The STL is consumed by **SEALER-01** unconditionally (Stage 5 best-fit ICP) and **optionally by SEALER-03** when `sealer_bead_isolation_method = cad-relative` (off-default in CI). The volume mount `/cad/sealer/` MUST be present in both containers. SEALER-03 reads its STL path from the upstream `cad_registration.stl_path` — no separate bind mount.
- `sealer_centerline.json` — 2 beads, ~10 points each, defined in CAD coords. **Includes `bead_id` (int) + `expected_width_mm` + `expected_height_mm`** per the 2026-06-01 schema update (SEALER-03 §3.3). Also consumed by SEALER-01 Stage 7 (per-frame centerline projection) and bound-mounted at `/config/sealer/` accordingly.

> **No authored ROI or stitched files.** Pre-pivot fixtures included `sealer_2d_rois.json` (removed 2026-05-07) and `stitched_reference.png` (removed 2026-06-01 — no stitching in SEALER-01).

### 4.2 Synthetic frames per scenario

`tests/e2e/sealer/fixtures/scenarios/{scenario_name}/`:
- `frame_NN.ply` — 20 binary PLY files (Open3D-generated point clouds)
- `frame_NN.bin` — paired 2D binary images
- `metadata.json` — frame_uuid, part_uuid, encoder positions, timestamps

Each scenario differs by injecting controlled defects in the bead geometry.

### 4.3 Generator scripts

`tests/e2e/sealer/scripts/generate_fixtures.py` — builds all fixtures from scratch (idempotent; check-in committed copies for CI speed). The generator MUST NOT produce `sealer_2d_rois.json` (removed 2026-05-07) or `stitched_reference.png` (removed 2026-06-01). For the `best-fit-failure` scenario, the generator emits PLY frames whose merged cloud is perturbed by 60° rotation + 200 mm translation relative to `part.stl` so that SEALER-01's ICP cannot converge within `cad_registration_rmse_threshold_mm`.

---

## 5. Test Code Layout

> **Note:** The previous draft (v1) listed standalone `inject_frames.py`, `wait_for_processing.py`, `verify_db.py` and a `run-test.sh` driver. These were replaced (v2 — 2026-05-09) with **pytest tests using the existing factories/helpers/fixtures structure** at `tests/` root, so sealer integrates with the existing `make e2e-test LAYER=pipelines` runner and pytest discovery.

### 5.1 Frame injection — `tests/factories/sealer_messages.py`

Frame injection lives in **factories** (where `make_pipeline_message` already lives for steel) — not a standalone script.

```python
# tests/factories/sealer_messages.py
def make_sealer_frame_message(frame_meta, ply_bytes, bin_bytes):
    """Build a single sealer frame payload as a Redis HASH dict."""
    return {
        "frame_uuid": frame_meta["frame_uuid"],
        "part_uuid": frame_meta["part_uuid"],
        "vin_number": frame_meta["vin_number"],
        "model_type": frame_meta["model_type"],
        "camera_serial_number": "HK3D001",
        "frame_index": frame_meta["index"],
        "captured_at": frame_meta["captured_at"],
        "point_cloud_data": ply_bytes,
        "image_streaming": bin_bytes,
    }


def inject_scenario(redis_client, scenario_dir):
    """Inject every frame of a scenario into Redis (image-saver consumes from there)."""
    metadata = json.loads((scenario_dir / "metadata.json").read_text())
    for frame in metadata["frames"]:
        ply = (scenario_dir / frame["ply_file"]).read_bytes()
        bin_ = (scenario_dir / frame["bin_file"]).read_bytes()
        msg = make_sealer_frame_message(frame, ply, bin_)
        redis_client.hset(f"frame:{frame['frame_uuid']}", mapping=msg)
```

### 5.2 Wait helper — `tests/helpers/sealer_wait.py`

```python
# tests/helpers/sealer_wait.py
def wait_for_completion(pg_conn, part_uuid, expected_state, timeout=60):
    """Poll the DB until the inspection reaches an expected state (or DLX) or timeout."""
    ...
```

### 5.3 Pytest tests — `tests/e2e/pipelines/test_sealer_pipeline.py`

The 8 scenarios become parametrized pytest tests with `@pytest.mark.pipeline`. Each scenario gets its own assertion routine (the `*Assertions` classes drafted below) invoked from a pytest test method.

```python
# tests/e2e/pipelines/test_sealer_pipeline.py
import pytest
from tests.factories.sealer_messages import inject_scenario
from tests.helpers.sealer_wait import wait_for_completion
from tests.e2e.sealer.assertions import (
    HappyPathAssertions, NarrowBeadAssertions, GapAssertions,
    OffsetAssertions, NoCenterlineAssertions, ReinspectionAssertions,
    PartialFramesAssertions, BestFitFailureAssertions,
)

SCENARIOS = [
    ("happy-path",       HappyPathAssertions),
    ("narrow-bead",      NarrowBeadAssertions),
    ("gap",              GapAssertions),
    ("offset",           OffsetAssertions),
    ("no-centerline",    NoCenterlineAssertions),
    ("reinspection",     ReinspectionAssertions),
    ("partial-frames",   PartialFramesAssertions),
    ("best-fit-failure", BestFitFailureAssertions),
]
# Removed 2026-06-01: ("2d-detection-only", TwoDOnlyAssertions) — no longer architecturally meaningful (§3.9).


@pytest.mark.pipeline
@pytest.mark.parametrize("scenario,Assertions", SCENARIOS, ids=lambda v: v if isinstance(v, str) else v.__name__)
def test_sealer_pipeline(redis_client, pg_conn, sealer_fixtures, scenario, Assertions):
    fixtures_dir = sealer_fixtures / "scenarios" / scenario
    part_uuid = inject_scenario(redis_client, fixtures_dir)
    wait_for_completion(pg_conn, part_uuid, Assertions.terminal_state, timeout=60)
    Assertions().assert_state(pg_conn, part_uuid)
```

### 5.4 Per-scenario assertion classes — `tests/e2e/sealer/assertions/`

Same content as drafted below, just relocated. Keep one file per scenario for clarity:

```
tests/e2e/sealer/assertions/
├── __init__.py
├── base.py                       # BaseAssertions (terminal_state, common helpers)
├── happy_path.py                 # HappyPathAssertions
├── narrow_bead.py                # NarrowBeadAssertions
├── gap.py
├── offset.py
├── no_centerline.py
├── reinspection.py
├── partial_frames.py
└── best_fit_failure.py           # BestFitFailureAssertions
```

### 5.5 Sample assertion code

Per-scenario assertions, all written against the **B-light common schema** ([4.8]). The `*Assertions` classes live in `tests/e2e/sealer/assertions/` (§5.4); the snippets below illustrate the structure.

#### `BaseAssertions` (parent)

```python
class BaseAssertions:
    """Each scenario defines `terminal_state` (used by wait helper) + `assert_state`."""
    terminal_state: str = "complete"     # or "dlx_only" for failure scenarios

    def assert_state(self, conn, part_uuid):
        raise NotImplementedError
```

#### Happy-path (full body)

```python
class HappyPathAssertions(BaseAssertions):
    terminal_state = "complete"

    def assert_state(self, conn, part_uuid):
        with conn.cursor() as cur:
            # 1 row in pecas (sealer = nao_conforme=false, qtd_defeitos=0)
            cur.execute(
                "SELECT id, nao_conforme, qtd_defeitos, process_tags "
                "FROM pecas WHERE peca = %s::uuid", (part_uuid,))
            row = cur.fetchone()
            assert row is not None, "pecas row not created"
            peca_id, nao_conforme, qtd, process_tags = row
            assert not nao_conforme, "expected pass"
            assert qtd == 0, "expected zero defects"
            assert process_tags.get("VIN")
            assert process_tags.get("model_type") == "CRETA_2026"

            # 20 rows in frames
            cur.execute("SELECT COUNT(*) FROM frames WHERE peca_id = %s", (peca_id,))
            assert cur.fetchone()[0] == 20

            # 2 subcomponents (left_sill + right_sill)
            cur.execute(
                "SELECT COUNT(*) FROM subcomponente s "
                "JOIN defeitos_agg d ON d.subcomponente_id = s.id "
                "WHERE d.peca_id = %s", (peca_id,))
            assert cur.fetchone()[0] == 2

            # 2 rows in defeitos_agg (bead pass — class_id 1010)
            cur.execute(
                "SELECT COUNT(*) FROM defeitos_agg "
                "WHERE peca_id = %s AND class_id = 1010", (peca_id,))
            assert cur.fetchone()[0] == 2

            # ~80 rows in defeitos from 3D measurements (class 1000 segment_pass)
            cur.execute(
                "SELECT COUNT(*) FROM defeitos "
                "WHERE peca_id = %s AND class_id IN (1000, 1001)", (peca_id,))
            assert 70 <= cur.fetchone()[0] <= 90  # tolerant range

            # all defeitos rows have populated metrics jsonb
            cur.execute(
                "SELECT COUNT(*) FROM defeitos "
                "WHERE peca_id = %s AND metrics IS NULL", (peca_id,))
            assert cur.fetchone()[0] == 0

        # RabbitMQ assertions: 20 messages processed on sealer-inference-queue
        # (load-bearing signal that SEALER-01 Stage 7 fan-out worked end-to-end).
        # Use helpers in tests/helpers/sealer_wait.py to read queue counters.
        # NOTE: per-anchor-segment 2D detection rows (class 1020/1021) are NOT asserted
        # — that persistence path is out of scope until the companion spec lands.
```

#### Other scenarios — assertion sketches

```python
class NarrowBeadAssertions(BaseAssertions):
    # pecas.nao_conforme=true; affected defeitos_agg row has class_id=1011 (sealer_bead_fail);
    # ≥1 defeitos row with class_id=1001 (segment_fail) AND metrics->>'width_mm' < '3.0'
    ...

class GapAssertions(BaseAssertions):
    # Affected bead's defeitos_agg.metrics->>'continuity_pct' < '80';
    # class_id = 1011 on that bead's defeitos_agg.
    ...

class BestFitFailureAssertions(BaseAssertions):
    terminal_state = "dlx_only"
    # 1 row in pecas (created by frame-writer's UPSERT — see [4.8] §4.1 step 2;
    #   no measurement rollup ever runs, so nao_conforme stays at column default);
    # 20 rows in frames (frame-writer is independent of inspection outcome);
    # 0 rows in defeitos_agg AND defeitos (load-bearing signal of failure);
    # ≥1 message in sealer-measurement-dlq;
    # 0 messages in sealer-frame-writer-dlq;
    # 0 messages routed to sealer-inference-queue OR sealer-detection-queue
    #   (Stage 7 skip — load-bearing post-pivot signal).
    ...
```

### 5.6 Pytest fixtures — `tests/fixtures/sealer_pipeline.py`

```python
# tests/fixtures/sealer_pipeline.py
import pytest

@pytest.fixture
def sealer_fixtures(monorepo_root):
    """Path to the sealer profile fixture directory."""
    return monorepo_root / "tests" / "e2e" / "sealer" / "fixtures"


@pytest.fixture
def redis_client(infrastructure):
    """Redis connection on the e2e broker (port 6380 / 6399 depending on layer)."""
    ...


@pytest.fixture
def pg_conn(infrastructure):
    """PostgreSQL connection with sealer DB seeded."""
    ...
```

---

## 6. CI Integration

### 6.1 Local invocation (existing Makefile workflow)

```bash
cd workspaces/strokmatic/visionking
PROFILE=sealer make e2e-up LAYER=full
PROFILE=sealer make e2e-test LAYER=pipelines        # runs sealer + steel pipeline tests
PROFILE=sealer make e2e-test LAYER=pipelines \
                   PYTEST_ARGS="-k test_sealer_pipeline"   # sealer only
make e2e-down
```

To run a single scenario:

```bash
PROFILE=sealer make e2e-test LAYER=pipelines \
  PYTEST_ARGS="-k 'test_sealer_pipeline and happy-path'"
```

### 6.2 GitHub Actions (extend existing workflow)

The repo already has an E2E workflow that runs `make e2e-test`. We extend it via a `matrix.profile` axis rather than creating a new file:

```yaml
# .github/workflows/e2e.yml  (extension — sealer added to existing matrix)
on:
  push:
    paths:
      - "services/image-saver/**"
      - "services/point-cloud-processor/**"
      - "services/sealer-bead-measurement/**"
      - "services/inference/**"
      - "services/pixel-to-object/**"
      - "services/database-writer/**"
      - "tests/**"
jobs:
  e2e:
    strategy:
      fail-fast: false
      matrix:
        profile: [steel, sealer]   # body added later
    runs-on: ubuntu-latest
    env:
      PROFILE: ${{ matrix.profile }}
    steps:
      - uses: actions/checkout@v4
        with: { submodules: true }
      - run: make e2e-up LAYER=full
      - run: make e2e-test LAYER=pipelines
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: e2e-logs-${{ matrix.profile }}, path: tests/e2e/logs/ }
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: sealer-e2e-logs, path: tests/e2e/sealer/logs/ }
```

Runtime budget: ~10 min for all 8 scenarios.

---

## 7. Out of Scope

- **Performance benchmarks** (latency, throughput) — separate task; this is correctness-only.
- **Real Hikrobot camera** — synthetic frames suffice.
- **Real PLC** — sealer-result service has its own mocked tests.
- **Backend/frontend E2E** — `tests/e2e/sealer-ui/` (future, parallel to [4.15]/[4.16]).
- **Real Hyundai CAD/centerline** — synthetic fixtures only; real fixture test is gated.
- **Per-anchor-segment 2D detection persistence (class 1020/1021)** — pending companion spec to detection persistence. When that lands, a new scenario asserting on those rows will be added.
- **Pixel-to-object tracked-defect persistence** — the path pixel-to-object → sealer-result → DB is not in scope here; the assertions on the `defeitos` rows produced by SEALER-03 (3D measurement path) remain the load-bearing coverage for now.

---

## 8. Resource Cost

Local run on dev laptop (Docker Desktop, 8GB allocation): ~1 min per scenario × 8 = ~10 min wall clock.

CI runner (GitHub Actions standard): ~15-20 min including image build cache warm-up (pixel-to-object adds a small build step but the inference profile is MockAnalyzer-only in CI, so no extra dep).

---

## 9. References

- `tests/e2e/README.md` — VK monorepo E2E conventions (layers, markers, profiles, `make e2e-up/test/down`)
- `tests/e2e/docker-compose.yml` — extends this file with the `sealer` profile (do NOT create a parallel `docker-compose.test.yml`)
- `tests/e2e/steel/` — pattern reference for profile-specific fixture data (sealer follows the same shape under `tests/e2e/sealer/`)
- `tests/e2e/pipelines/test_steel_pipeline.py` — pattern reference for the pytest-driven pipeline test (sealer adds `test_sealer_pipeline.py` next to it)
- `tests/factories/` + `tests/helpers/` — sealer factories/helpers go alongside the existing steel ones
- `topologies/sealer-single-node.yaml` — production deployment (the test compose profile mirrors this structure with mocks)
- Sister specs (post-pivot canonical set):
  - SEALER-01: `2026-04-13-sealer-01-point-cloud-processor-design.md` (rev 2026-06-01)
  - SEALER-03: `2026-05-06-sealer-03-sealer-bead-measurement-design.md` (rev 2026-06-01)
  - [4.8] DB Schema: `2026-05-06-sealer-db-schema-design.md` (rev 2026-06-01)
  - [4.9] Provisioning CLI: `2026-05-06-sealer-provisioning-cli-design.md` (rev 2026-06-01)
  - [4.10] DB Writer Topology: `2026-05-06-sealer-05-db-writer-mode-design.md` (rev 2026-06-01)
  - [4.11] Inference (new): `2026-06-01-sealer-inference-per-frame-design.md`
  - [4.12] sealer-result: `2026-05-06-sealer-result-service-design.md`
  - Pixel-to-object multi-profile: `2026-06-01-pixel-to-object-multi-profile-design.md`

---

## 10. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-05-06 | Pedro Teruel | Initial design (8 scenarios; assertions against `tbl_parts`/`tbl_frames_sealer`/`tbl_sealer_inspections`; fixtures included `sealer_2d_rois.json`). |
| 2026-05-07 | Pedro Teruel | DB assertions migrated to B-light common schema (`pecas`/`defeitos`/`defeitos_agg`/`frames` + class IDs 1000/1001/1010/1011/1020/1021); fixtures lose `sealer_2d_rois.json` (ROIs derived at runtime per [4.11] §5.1); new scenario `best-fit-failure` (3.9) covers CAD-registration non-convergence path; STL purpose documented for both SEALER-01 (mandatory — Stage 5 ICP) and SEALER-03 (optional — `cad-relative` isolation method); scenario count 8 → 9; runtime budget ~10 → ~11 min. |
| 2026-05-09 | Pedro Teruel + Claude | **Aligned to VK monorepo E2E pattern** (see `tests/e2e/README.md`): replaced the parallel `docker-compose.test.yml` with an extension of the existing `tests/e2e/docker-compose.yml` adding a `sealer` profile; replaced `run-test.sh` / `run-all.sh` shell scripts with pytest tests under `tests/e2e/pipelines/test_sealer_pipeline.py` using `@pytest.mark.pipeline`; replaced standalone `inject_frames.py` / `wait_for_processing.py` / `verify_db.py` with factories/helpers/fixtures and assertion classes. Local invocation now `PROFILE=sealer make e2e-up LAYER=full && make e2e-test LAYER=pipelines`; CI extends existing workflow via `matrix.profile=[steel,sealer]`. Test scenarios, fixtures, DB schema assertions, and runtime budget **unchanged**. |
| 2026-06-01 | Pedro Teruel (with Claude) | **Rewritten post-architectural-pivot.** Pipeline diagram updated for SEALER-01 fan-out + `sealer-per-frame` inference + pixel-to-object. Compose profile drops `result-writer-2d`, adds `pixel-to-object` (VK_PROFILE=sealer), updates `inference` env to `INF_PROFILE=sealer-per-frame`. Scenario `2d-detection-only` **removed** (no longer architecturally meaningful — stitching gone, inference depends on point cloud). `no-centerline` updated (NACK now in SEALER-01 Stage 7, not SEALER-03). `best-fit-failure` updated (Stage 7 skipped → no inference fan-out; signal is silence on `sealer-inference-queue`/`sealer-detection-queue`, not `sealer-2d-result-dlq`). Happy-path `defeitos` 1020/1021 assertion removed (persistence path deferred to companion spec). Fixtures drop `stitched_reference.png`; `sealer_centerline.json` includes `bead_id` + `expected_height_mm`. Scenario count 9 → 8; runtime budget ~11 → ~10 min. Banner removed. |
