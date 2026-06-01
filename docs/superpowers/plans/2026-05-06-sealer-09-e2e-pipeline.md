# [4.13] SEALER-09 E2E Pipeline → DB Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkbox tracking.

> ⚠️ **2026-05-09 — alignment pending.** Spec was revised on 2026-05-09 to align with the existing VK monorepo E2E pattern (see spec §2 + `tests/e2e/README.md`). The task descriptions below (Task 1 docker-compose.test.yml, Task 4 `inject_frames.py`/`wait_for_processing.py`, Task 6 `verify_db.py`/`run-test.sh`, Task 7 `run-all.sh` + new workflow) **still reflect the pre-alignment design** and must be re-mapped before execution starts (11/05). Concretely:
> - Task 1 → extend the existing `tests/e2e/docker-compose.yml` with a `sealer` profile (no new `.test.yml`)
> - Task 4 → factories at `tests/factories/sealer_messages.py` + helper at `tests/helpers/sealer_wait.py` (no standalone scripts)
> - Task 6 → pytest tests at `tests/e2e/pipelines/test_sealer_pipeline.py` with `@pytest.mark.pipeline` (no `verify_db.py`, no `run-test.sh`)
> - Task 7 → extend the existing GitHub Actions workflow with `matrix.profile=[steel, sealer]` (no new `sealer-e2e.yml`)
>
> Task 2 (fixtures), Task 3 (per-scenario frames), Task 5 (assertion classes), and Task 8 (docs) remain valid as written — the **fixture generation logic and assertion class designs are unaffected** by the alignment. Only the orchestration layer changes.

**Goal:** End-to-end integration test suite covering capture-to-DB pipeline (image-saver → point-cloud-processor → sealer-bead-measurement → inference → frame-writer + result-writer). 9 scenarios via docker-compose, asserting against the **B-light common schema** ([4.8] — `pecas`, `defeitos_agg`, `defeitos`, `frames`, `subcomponente`, `types`); CI integrated with existing E2E workflow.

**Tech Stack:** Python 3.10, docker-compose, pytest, psycopg2, redis, trimesh, open3d, pillow.

**Spec:** `docs/superpowers/specs/2026-05-06-sealer-09-e2e-pipeline-design.md` (v3, rev 2026-05-09)

**Repo paths (aligned to existing pattern):**
- `tests/e2e/docker-compose.yml` — **extend** with `sealer` profile
- `tests/e2e/sealer/fixtures/` — profile-specific data (mirrors `tests/e2e/steel/`)
- `tests/e2e/sealer/assertions/` — per-scenario assertion classes
- `tests/e2e/sealer/scripts/generate_fixtures.py` — idempotent fixture builder
- `tests/e2e/shared/sql/sealer-classe-defeitos.sql` — sealer-specific defect class seeds
- `tests/e2e/pipelines/test_sealer_pipeline.py` — pytest tests with `@pytest.mark.pipeline`
- `tests/factories/sealer_messages.py` — frame message factory
- `tests/helpers/sealer_wait.py` — DB-polling wait helper
- `tests/fixtures/sealer_pipeline.py` — pytest fixtures (redis_client, pg_conn, sealer_fixtures)

**Estimate:** 2d implementation + 2.5d ajustes. ~30 fixtures + 9 scenario assertions (best-fit-failure adds ~0.5d for the perturbed-cloud generator + DLQ assertion plumbing).

---

## File Structure (aligned, 2026-05-09)

```
visionking/                                # monorepo root
├── tests/
│   ├── factories/
│   │   └── sealer_messages.py             # NEW — make_sealer_frame_message + inject_scenario
│   ├── helpers/
│   │   └── sealer_wait.py                 # NEW — wait_for_completion(pg_conn, part_uuid, ...)
│   ├── fixtures/
│   │   └── sealer_pipeline.py             # NEW — pytest fixtures for sealer pipeline tests
│   └── e2e/
│       ├── docker-compose.yml             # EXTEND — add `sealer` application profile
│       ├── Makefile                       # (existing — no changes; PROFILE=sealer just works)
│       ├── pipelines/
│       │   └── test_sealer_pipeline.py    # NEW — 9 scenarios as parametrized pytest tests
│       │                                  #        with @pytest.mark.pipeline
│       ├── shared/sql/
│       │   └── sealer-classe-defeitos.sql # NEW — sealer class IDs 1000/1001/1010/1011/1020/1021
│       └── sealer/                        # NEW profile data folder (mirrors tests/e2e/steel/)
│           ├── fixtures/
│           │   ├── CRETA_2026/
│           │   │   ├── part.stl           # consumed by SEALER-01 (Stage 5 ICP) +
│           │   │   │                      #   optionally SEALER-03 (cad-relative)
│           │   │   ├── sealer_centerline.json   # 2 beads in CAD coords; SSOT
│           │   │   # stitched_reference.png REMOVED 2026-06-01 (no stitching)
│           │   └── scenarios/
│           │       ├── happy-path/
│           │       │   ├── metadata.json
│           │       │   ├── frame_00.ply ... frame_19.ply
│           │       │   └── frame_00.bin ... frame_19.bin
│           │       ├── narrow-bead/
│           │       ├── gap/
│           │       ├── offset/
│           │       ├── no-centerline/
│           │       ├── reinspection/
│           │       ├── partial-frames/
│           │       └── best-fit-failure/   # cloud perturbed 60° + 200 mm vs CAD
│           │                                # (2d-detection-only REMOVED 2026-06-01)
│           ├── scripts/
│           │   └── generate_fixtures.py    # idempotent; output committed
│           └── assertions/
│               ├── __init__.py
│               ├── base.py                 # BaseAssertions (terminal_state, helpers)
│               ├── happy_path.py
│               ├── narrow_bead.py
│               ├── gap.py
│               ├── offset.py
│               ├── no_centerline.py
│               ├── reinspection.py
│               ├── partial_frames.py
│               └── best_fit_failure.py
│               # two_d_only.py REMOVED 2026-06-01
└── .github/workflows/
    └── e2e.yml                            # EXTEND — add `matrix.profile=[steel, sealer]`
```

> **What's NOT created:** `tests/e2e/sealer/docker-compose.test.yml`, `tests/e2e/sealer/run-test.sh`, `tests/e2e/sealer/run-all.sh`, `tests/e2e/sealer/inject_frames.py`, `tests/e2e/sealer/verify_db.py`, `tests/e2e/sealer/wait_for_processing.py`, `tests/e2e/sealer/wait_for_healthy.sh`, `.github/workflows/sealer-e2e.yml` — these were in the v1 plan but **superseded** by the existing-pattern equivalents listed above.

---

## Task 1 — Scaffold + docker-compose.test.yml

- [ ] **Step 1: directory structure**
```bash
mkdir -p tests/e2e/sealer/{fixtures/CRETA_2026,fixtures/scenarios,scripts,assertions,logs}
echo "logs/" > tests/e2e/sealer/.gitignore
```

- [ ] **Step 2: `docker-compose.test.yml`** (subset of sealer-single-node.yaml, all containers)
```yaml
version: "3.9"
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: sealer
      POSTGRES_USER: strokmatic
      POSTGRES_PASSWORD: testpass
    ports: ["5432:5432"]
    volumes:
      - ../../../services/setup/infra-structure/postgres/sql-vk-common:/sql-vk-common:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U strokmatic -d sealer"]
      interval: 2s
      retries: 30

  redis:
    image: eqalpha/keydb:latest
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s

  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports: ["5672:5672", "15672:15672"]
    healthcheck:
      test: ["CMD", "rabbitmqctl", "status"]
      interval: 5s

  image-saver:
    build: ../../../services/image-saver
    depends_on: [redis, rabbitmq]
    environment:
      IMG_SAVER_SUPPORTED_DATA_TYPES: "image,pointcloud"
      IMG_SAVER_RABBIT_QUEUE: "sealer-frame-writer-queue"
      IMG_SAVER_RABBIT_PROCESSING_QUEUE: "sealer-processed-queue"
      REDIS_HOST: redis
      RABBIT_HOST: rabbitmq
    volumes:
      - img-saved:/img_saved

  point-cloud-processor:
    build: ../../../services/point-cloud-processor
    depends_on: [redis, rabbitmq]
    environment:
      PCP_REDIS_HOST: redis
      PCP_RABBIT_BROKER_HOST: rabbitmq
      PCP_RABBIT_INPUT_QUEUE: "sealer-processed-queue"
      PCP_RABBIT_MEASUREMENT_QUEUE: "sealer-measurement-queue"
      PCP_RABBIT_INFERENCE_QUEUE: "sealer-inference-queue"
      PCP_CAD_DIR: "/cad/sealer"
    volumes:
      - img-saved:/img_saved
      - ./fixtures:/cad/sealer:ro          # part.stl per model_type (Stage 5 ICP)

  sealer-bead-measurement:
    build: ../../../services/visionking-sealer-bead-measurement
    depends_on: [redis, rabbitmq]
    environment:
      SBM_REDIS_HOST: redis
      SBM_RABBIT_BROKER_HOST: rabbitmq
      SBM_SEALER_CONFIG_DIR: /config/sealer
      # No SBM_CAMERA_CALIBRATION_FILE — best-fit ICP moved to SEALER-01 (v4 spec).
      # SBM reads cad_registration.stl_path from the upstream message; the
      # /cad/sealer mount must match SEALER-01's so that path resolves inside
      # this container too.
    volumes:
      - img-saved:/img_saved
      - ./fixtures:/config/sealer:ro       # sealer_centerline.json per model_type
      - ./fixtures:/cad/sealer:ro          # part.stl (only used if cad-relative isolation)

  inference:
    build: ../../../services/inference
    depends_on: [redis, rabbitmq]
    environment:
      INF_PROFILE: "sealer-per-frame"
      INF_RABBIT_INPUT_QUEUE: "sealer-inference-queue"
      INF_RABBIT_OUTPUT_QUEUE: "sealer-detection-queue"
      INF_SEALER_ANALYZER: "mock"
      INF_SEALER_WINDOW_MODE: "fixed"
      INF_SEALER_WINDOW_SIDE_PX: "128"
      RABBIT_HOST: rabbitmq
    volumes:
      - img-saved:/img_saved

  pixel-to-object:
    build: ../../../services/pixel-to-object
    depends_on: [redis, rabbitmq]
    environment:
      VK_PROFILE: "sealer"
      RABBITMQ_INPUT_QUEUE: "sealer-detection-queue"
      RABBITMQ_OUTPUT_QUEUE: "sealer-result-queue"   # placeholder; coordinate w/ sealer-result spec
      RABBIT_HOST: rabbitmq
      REDIS_HOST: redis

  frame-writer:
    build: ../../../services/database-writer
    depends_on: [postgres, rabbitmq]
    environment:
      DB_WRITER_RABBIT_QUEUE: "sealer-frame-writer-queue"
      INSERT_FUNCTION: "insert_sealer_frame"
      PSQL_HOST: postgres
      PSQL_USER: strokmatic
      PSQL_PASS: testpass
      PSQL_DB: sealer
      RABBIT_HOST: rabbitmq

  result-writer-3d:
    build: ../../../services/database-writer
    depends_on: [postgres, rabbitmq]
    environment:
      DB_WRITER_RABBIT_QUEUE: "sealer-result-queue"
      INSERT_FUNCTION: "insert_sealer_measurements"
      PSQL_HOST: postgres
      PSQL_USER: strokmatic
      PSQL_PASS: testpass
      PSQL_DB: sealer
      RABBIT_HOST: rabbitmq

  # NOTE post-2026-06-01:
  # `result-writer-2d` removed (used to consume sealer-2d-result-queue → DELETED).
  # Per-anchor-segment 2D detection persistence (class 1020/1021) is out of scope
  # of this E2E suite until the companion detection-persistence spec lands.

volumes:
  img-saved:
```

- [ ] **Step 3: commit** `test(sealer-e2e): scaffold + docker-compose for E2E pipeline tests`

---

## Task 2 — Common fixtures (CAD, centerline, ROIs, calibration)

- [ ] **Step 1: `scripts/generate_fixtures.py` — common part for CRETA_2026**
```python
import trimesh, numpy as np, json, yaml
from pathlib import Path
from PIL import Image

def make_part_stl(out_path):
    """Cube 2.5m x 1.8m x 1m representing car body shell."""
    mesh = trimesh.creation.box(extents=[2500, 1800, 1000])
    mesh.export(out_path)

def make_centerline(out_path):
    """Two beads (left_sill + right_sill), straight lines along Y axis (CAD frame).
    SSOT for both SEALER-03 (3D measurement) and inference (2D ROI derivation per [4.11] §5.1).
    """
    data = {
        "model_type": "CRETA_2026",
        "beads": [
            {"bead_id": 1, "name": "left_sill",
             "expected_width_mm": 22.0, "expected_height_mm": 4.0,
             "points": [[(-900, y, 100)] for y in range(-2000, 2001, 200)]},
            {"bead_id": 2, "name": "right_sill",
             "expected_width_mm": 22.0, "expected_height_mm": 4.0,
             "points": [[(900,  y, 100)] for y in range(-2000, 2001, 200)]},
        ]
    }
    Path(out_path).write_text(json.dumps(data))

# NOTE post-2026-06-01:
# - NO sealer_2d_rois.json (removed 2026-05-07).
# - NO stitched_reference.png (removed 2026-06-01 — no stitching in SEALER-01).
# - The centerline is consumed by SEALER-03 (3D measurement) AND by SEALER-01
#   Stage 7 (per-frame centerline projection); the inference service no longer
#   reads sealer_centerline.json directly (gets pre-projected (u,v) points from
#   SEALER-01 instead).

def make_calibration(out_path):
    """Identity world_to_camera, identity part_origin_in_world for simplicity."""
    data = {
        "camera_serial": "HK3D001",
        "world_to_camera": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
        "part_origin_in_world": {"rotation_xyz_rad": [0,0,0], "translation_mm": [0,0,0]},
        # plus existing intrinsics fields for SEALER-01
    }
    Path(out_path).write_text(yaml.safe_dump(data))
```

- [ ] **Step 2: run generator and check in artifacts**
```bash
python tests/e2e/sealer/scripts/generate_fixtures.py
git add tests/e2e/sealer/fixtures/CRETA_2026/
```

- [ ] **Step 3: commit** `test(sealer-e2e): common fixtures for CRETA_2026`

---

## Task 3 — Per-scenario frame fixtures

- [ ] **Step 1: extend `generate_fixtures.py`** to build scenario frames
```python
def make_happy_path_frames(base_dir, n=20):
    """20 PLY frames covering 2.5m linear scan; pristine bead geometry."""
    for i in range(n):
        # Build synthetic point cloud: surface plane + 2 cylinder bumps at known positions
        cloud = build_synthetic_cloud(
            surface_z=0,
            beads=[(left_sill_centerline, 22.0), (right_sill_centerline, 22.0)],
            encoder_y=i * 125,  # 2500 / 20
            noise_mm=0.5,
        )
        out = base_dir / f"frame_{i:02d}.ply"
        cloud.export(str(out))

def make_narrow_bead_frames(base_dir, n=20):
    """Same as happy-path but bead width=2.5mm."""
    ...

def make_gap_frames(base_dir, n=20):
    """Gap of 30mm in left_sill at midpoint."""
    ...

def make_best_fit_failure_frames(base_dir, n=20):
    """Cloud massively perturbed (60° rotation Z + 200 mm translation Y)
    relative to part.stl. SEALER-01's ICP cannot converge within
    cad_registration_rmse_threshold_mm; SEALER-03 + inference NACK to DLX.
    """
    R = trimesh.transformations.rotation_matrix(np.radians(60), [0, 0, 1])
    T = np.eye(4); T[1, 3] = 200.0
    perturb = T @ R
    for i in range(n):
        cloud = build_synthetic_cloud(
            surface_z=0,
            beads=[(left_sill_centerline, 22.0), (right_sill_centerline, 22.0)],
            encoder_y=i * 125,
            noise_mm=0.5,
        )
        cloud.transform(perturb)         # apply unrecoverable perturbation
        out = base_dir / f"frame_{i:02d}.ply"
        cloud.export(str(out))
# ... and so on for each scenario
```

- [ ] **Step 2: also generate `metadata.json` per scenario**
```python
def make_metadata(scenario, n_frames):
    return {
        "part_uuid": f"00000000-0000-0000-0000-{scenario_id:012d}",
        "vin_number": f"KMHX{scenario_id:013d}",
        "model_type": "CRETA_2026",
        "frames": [
            {"frame_uuid": f"...{i:08d}", "index": i,
             "captured_at": f"2026-05-15T10:30:{i:02d}.000Z",
             "ply_file": f"frame_{i:02d}.ply", "bin_file": f"frame_{i:02d}.bin",
             "encoder_y_mm": i * 125}
            for i in range(n_frames)
        ]
    }
```

- [ ] **Step 3: commit** `test(sealer-e2e): per-scenario frame fixtures (9 scenarios incl. best-fit-failure)`

---

## Task 4 — `inject_frames.py` + `wait_for_processing.py`

- [ ] **Step 1: `inject_frames.py`**
```python
import click, json, redis
from pathlib import Path

@click.command()
@click.option("--scenario", required=True)
@click.option("--fixtures-dir", default="fixtures/scenarios")
@click.option("--redis-host", default="localhost")
def inject(scenario, fixtures_dir, redis_host):
    base = Path(fixtures_dir) / scenario
    metadata = json.loads((base / "metadata.json").read_text())
    r = redis.Redis(host=redis_host, port=6379, db=0)
    for frame in metadata["frames"]:
        ply = (base / frame["ply_file"]).read_bytes()
        bin_data = (base / frame["bin_file"]).read_bytes()
        key = f"frame:{frame['frame_uuid']}"
        r.hset(key, mapping={
            "frame_uuid": frame["frame_uuid"],
            "part_uuid": metadata["part_uuid"],
            "vin_number": metadata["vin_number"],
            "model_type": metadata["model_type"],
            "camera_serial_number": "HK3D001",
            "frame_index": frame["index"],
            "captured_at": frame["captured_at"],
            "encoder_y_mm": frame["encoder_y_mm"],
            "point_cloud_data": ply,
            "image_streaming": bin_data,
        })
        click.echo(f"injected {frame['frame_uuid']}")
```

- [ ] **Step 2: `wait_for_processing.py`**
```python
import psycopg2, time, click

@click.command()
@click.option("--part-uuid", required=True)
@click.option("--scenario", required=True)
@click.option("--timeout", default=60)
def wait(part_uuid, scenario, timeout):
    """Poll the common-schema for the rollup signal, with a per-scenario predicate.

    For success scenarios: pecas.inspected_at IS NOT NULL.
    For DLQ-only scenarios (no-centerline, best-fit-failure):
    poll RabbitMQ DLQ depth via the management API instead — see helpers/dlq_wait.py.
    """
    conn = psycopg2.connect("host=localhost dbname=sealer user=strokmatic password=testpass")
    deadline = time.time() + timeout
    while time.time() < deadline:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT inspected_at FROM pecas WHERE peca = %s::uuid", (part_uuid,))
            row = cur.fetchone()
            if row and row[0] is not None:
                click.echo(f"inspection ready for {part_uuid}"); return
        time.sleep(1)
    raise SystemExit(f"timeout waiting for inspection of {part_uuid}")
```

- [ ] **Step 3: commit** `test(sealer-e2e): inject_frames + wait_for_processing helpers`

---

## Task 5 — Per-scenario assertions

- [ ] **Step 1: `assertions/base.py`**
```python
import abc, psycopg2

class BaseAssertions(abc.ABC):
    def __init__(self, part_uuid):
        self.part_uuid = part_uuid

    def run(self, conn):
        self.assert_state(conn)

    @abc.abstractmethod
    def assert_state(self, conn): ...
```

- [ ] **Step 2: implement each scenario** (per spec §3.1–3.9)
```python
# assertions/happy_path.py
class HappyPathAssertions(BaseAssertions):
    def assert_state(self, conn):
        with conn.cursor() as cur:
            # 1 row in pecas, pass
            cur.execute("SELECT nao_conforme, qtd_defeitos, process_tags FROM pecas WHERE peca=%s::uuid", (self.part_uuid,))
            row = cur.fetchone()
            assert row is not None, "no peca row"
            assert row[0] is False, "expected pass (nao_conforme=False)"
            assert row[1] == 0, "no failed segments"
            assert row[2]["model_type"] == "CRETA_2026"

            # 20 frames linked via frames_pecas
            cur.execute("""SELECT COUNT(*) FROM frames f
                            JOIN frames_pecas fp ON fp.frame_id=f.id
                            JOIN pecas p ON fp.peca_id=p.id
                            WHERE p.peca=%s::uuid""", (self.part_uuid,))
            assert cur.fetchone()[0] == 20, "20 frames expected"

            # 2 defeitos_agg (1 per bead), both class_id=1010 (sealer_bead_pass)
            cur.execute("""SELECT da.class_id FROM defeitos_agg da
                            JOIN pecas p ON da.peca_id=p.id WHERE p.peca=%s::uuid""", (self.part_uuid,))
            agg = cur.fetchall()
            assert len(agg) == 2
            assert all(a[0] == 1010 for a in agg)

            # ~80 defeitos rows from 3D, class_id IN (1000, 1001) — segment pass/fail
            cur.execute("""SELECT COUNT(*) FROM defeitos d
                            JOIN pecas p ON d.peca_id=p.id
                            WHERE p.peca=%s::uuid AND d.class_id IN (1000, 1001)""", (self.part_uuid,))
            n3d = cur.fetchone()[0]
            assert 70 <= n3d <= 90, f"expected 70..90 segment rows, got {n3d}"

            # NOTE 2026-06-01: 2D detection persistence (class 1020/1021) is OUT OF SCOPE
            # post-pivot — no DB-side assertion here. Coverage relies on:
            #   - 20 messages successfully processed on sealer-inference-queue (see dlq_wait helpers)
            #   - 20 messages successfully processed on sealer-detection-queue (pixel-to-object input)
            # When the companion detection-persistence spec lands, add the 1020/1021 assertion here.

            # all defeitos rows have populated metrics jsonb
            cur.execute("""SELECT COUNT(*) FROM defeitos d
                            JOIN pecas p ON d.peca_id=p.id
                            WHERE p.peca=%s::uuid AND d.metrics IS NULL""", (self.part_uuid,))
            assert cur.fetchone()[0] == 0
```

```python
# assertions/best_fit_failure.py
class BestFitFailureAssertions(BaseAssertions):
    """SEALER-01's ICP fails to converge → degraded=true is published.
    SEALER-03 and inference NACK to DLX. frame-writer is independent of
    inspection outcome and still writes the 20 per-frame rows.
    """
    def assert_state(self, conn):
        with conn.cursor() as cur:
            # 1 pecas row exists — created by frame-writer's insert_sealer_frame UPSERT
            # (see [4.8] §4.1 step 2). nao_conforme is left at column default because
            # bead-measurement never ran. Asserting on nao_conforme would be misleading
            # (default may look like "pass"); the load-bearing signal is 0 defeitos*.
            cur.execute("SELECT COUNT(*) FROM pecas WHERE peca=%s::uuid", (self.part_uuid,))
            assert cur.fetchone()[0] == 1, "expected exactly 1 pecas row from frame UPSERT"

            # 20 frames written by frame-writer (independent of inspection outcome).
            cur.execute("""SELECT COUNT(*) FROM frames f
                            JOIN frames_pecas fp ON fp.frame_id=f.id
                            JOIN pecas p ON fp.peca_id=p.id
                            WHERE p.peca=%s::uuid""", (self.part_uuid,))
            assert cur.fetchone()[0] == 20, "expected 20 frame rows from frame-writer"

            # No inspection-side rows — load-bearing signal that bead-measurement never ran.
            cur.execute("""SELECT COUNT(*) FROM defeitos_agg da
                            JOIN pecas p ON da.peca_id=p.id
                            WHERE p.peca=%s::uuid""", (self.part_uuid,))
            assert cur.fetchone()[0] == 0, "expected 0 defeitos_agg on degraded"

            cur.execute("""SELECT COUNT(*) FROM defeitos d
                            JOIN pecas p ON d.peca_id=p.id
                            WHERE p.peca=%s::uuid""", (self.part_uuid,))
            assert cur.fetchone()[0] == 0, "expected 0 defeitos on degraded"

    def assert_dlq_state(self, dlq_client):
        """Called separately after assert_state — uses the RabbitMQ management API
        (helpers/dlq_wait.py) to check DLQ depth. Post-pivot 2026-06-01:
          - sealer-measurement-dlq: ≥1 (SEALER-03 NACKs the degraded input).
          - sealer-frame-writer-dlq: 0 (frame-writer is independent).
          - Load-bearing post-pivot signal: sealer-inference-queue / sealer-detection-queue
            see ZERO messages for this part (SEALER-01 Stage 7 skipped on convergence failure).
        """
        assert dlq_client.message_count("sealer-measurement-dlq") >= 1
        assert dlq_client.message_count("sealer-frame-writer-dlq") == 0
        # Stage 7 skip signal: no inference fan-out for this part.
        assert dlq_client.processed_count_for_part(
            "sealer-inference-queue", self.part_uuid) == 0
        assert dlq_client.processed_count_for_part(
            "sealer-detection-queue", self.part_uuid) == 0
```

(similar for narrow_bead, gap, offset, no_centerline, reinspection, partial_frames.)

> **Note on the `pecas` row in `best-fit-failure`.** Per [4.8] §4.1 step 2, `insert_sealer_frame` UPSERTs `pecas` on every frame, so after 20 frames there is exactly 1 `pecas` row regardless of bead-measurement outcome. `nao_conforme` stays at its column default (no measurement rollup ran). This means a registration-failed part is **indistinguishable** from a still-processing or successful-pass part by inspecting `pecas` alone — the load-bearing signal of failure is the absence of rows in `defeitos_agg` and `defeitos`. Tightening this would require [4.8] schema to add an explicit `inspection_status` column (Phase 2 schema enhancement, not [4.13] concern).

- [ ] **Step 3: commit** `test(sealer-e2e): per-scenario assertion classes`

---

## Task 6 — `verify_db.py` + `run-test.sh`

- [ ] **Step 1: `verify_db.py`**
```python
import click, psycopg2, importlib

@click.command()
@click.option("--scenario", required=True)
@click.option("--part-uuid", required=True)
def verify(scenario, part_uuid):
    module = importlib.import_module(f"assertions.{scenario.replace('-', '_')}")
    cls = getattr(module, f"{scenario.title().replace('-', '')}Assertions")
    assertion = cls(part_uuid)
    conn = psycopg2.connect("host=localhost dbname=sealer user=strokmatic password=testpass")
    try:
        assertion.run(conn)
        click.echo(f"✅ {scenario} assertions passed")
    except AssertionError as e:
        click.echo(f"❌ {scenario}: {e}", err=True); raise SystemExit(1)
```

- [ ] **Step 2: `run-test.sh`** + `wait_for_healthy.sh` (per spec §5.3)

- [ ] **Step 3: smoke** locally on one scenario:
```bash
./run-test.sh happy-path
```

- [ ] **Step 4: commit** `test(sealer-e2e): verify_db + run-test orchestrator`

---

## Task 7 — All-scenario runner + CI

- [ ] **Step 1: `run-all.sh`**
```bash
#!/usr/bin/env bash
set -e
SCENARIOS=(
    happy-path
    narrow-bead
    gap
    offset
    no-centerline           # post-pivot: NACK now in SEALER-01 Stage 7
    reinspection
    partial-frames
    best-fit-failure        # SEALER-01 ICP non-convergence path
)
# 2d-detection-only REMOVED 2026-06-01 (no longer architecturally meaningful).
for s in "${SCENARIOS[@]}"; do
    echo "=== Running $s ==="
    ./run-test.sh "$s"
done
echo "All scenarios passed"
```

- [ ] **Step 2: GitHub Actions workflow** (per spec §6.2)

- [ ] **Step 3: smoke locally** all 8 scenarios

- [ ] **Step 4: commit** `ci(sealer-e2e): all-scenario runner + GH Actions workflow`

---

## Task 8 — Documentation + handover

- [ ] **Step 1: `tests/e2e/sealer/README.md`**
  - Quick start (clone + ./run-test.sh happy-path)
  - Scenario catalog (table with each scenario's purpose + expected outcome)
  - How to add a new scenario (3-step recipe)
  - Troubleshooting (Docker resource limits, port conflicts, log inspection)

- [ ] **Step 2: link from main `README.md`** of visionking monorepo under "Testing" section

- [ ] **Step 3: backlog update** `backlogs/strokmatic/visionking.md` SEALER-09 marked complete

- [ ] **Step 4: commit** `docs(sealer-e2e): README + scenario catalog + handover`

---

## Cross-cutting checks

- All 8 scenarios pass locally + in CI
- Wall clock per scenario < 90s (best-fit-failure can be ≤60s — short-circuits at SEALER-01 Stage 5 / Stage 7 skip)
- Total CI runtime ~10 min wall (≤20 min with image build cache)
- Failure logs captured as workflow artifacts
- DLQ-depth assertions use the RabbitMQ management API (`/api/queues/%2F/{queue}` → `messages`); no direct AMQP consumer drift.
- Post-pivot signals (`sealer-inference-queue` / `sealer-detection-queue` zero-message check for degraded parts) verified via consumer counters, not via DLQ depth.

## Definition of done

- All 8 tasks committed
- All 9 scenarios pass (incl. best-fit-failure)
- CI workflow green
- README documents how to extend
- Backlog SEALER-09 marked complete
- Changelog entry recorded
- Smoke tested by Pedro before integration milestone [4.14]

---

## Revision History

| Date | Author | Change |
|---|---|---|
| 2026-05-06 | Pedro Teruel | Initial plan (8 scenarios; legacy `tbl_*` schema; `sealer_2d_rois.json` in fixtures). |
| 2026-05-07 | Pedro Teruel | DB assertions migrated to B-light common schema (`pecas`/`defeitos`/`defeitos_agg`/`frames` + class IDs 1000/1001/1010/1011/1020/1021); fixtures lose `sealer_2d_rois.json` (ROIs derived at runtime per [4.11] §5.1); new scenario `best-fit-failure` covers CAD-registration non-convergence path with DLQ depth assertions; STL purpose documented for both SEALER-01 (mandatory) and SEALER-03 (optional); compose adds `/cad/sealer/` mount on both PCP and SBM containers; estimate +0.5d. |
| 2026-05-09 | Pedro Teruel + Claude | **File Structure section re-aligned** to existing VK monorepo E2E pattern (`tests/e2e/docker-compose.yml` profile + Makefile + pytest + factories/helpers/fixtures + matrix CI). Banner at top flags Tasks 1, 4, 6, 7 as needing re-mapping during execution; Tasks 2, 3, 5, 8 remain valid as-is. No change to scenarios, fixtures, schema assertions or runtime budget. |
| 2026-06-01 | Pedro Teruel (with Claude) | **Rewritten post-architectural-pivot.** Compose: `inference` env → `INF_PROFILE=sealer-per-frame` + new queue names; `result-writer-2d` block deleted; **`pixel-to-object`** service added (VK_PROFILE=sealer). Fixtures: `sealer_centerline.json` now carries `bead_id` + `expected_height_mm`; `stitched_reference.png` removed. Scenario `2d-detection-only` **removed** (no longer architecturally meaningful — stitching gone, inference depends on point cloud). `no-centerline` updated to expect NACK in SEALER-01 Stage 7. `best-fit-failure` updated to assert silence on `sealer-inference-queue` / `sealer-detection-queue` (Stage 7 skip signal) instead of `sealer-2d-result-dlq` depth. Happy-path 1020/1021 assertion replaced with a note pointing to the deferred companion spec. Scenario count 9 → 8; runtime budget ~11 → ~10 min. |
