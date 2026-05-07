# [4.13] SEALER-09 E2E Pipeline → DB Tests — Design Spec

> **Profile**: `vk-sealer`
> **Project**: 03008
> **Backlog**: SEALER-09 in `backlogs/strokmatic/visionking.md`
> **Date**: 2026-05-06 (revised 2026-05-07)
> **Status**: Draft

---

## 1. Overview

End-to-end integration tests covering the **full sealer capture-to-DB pipeline**:

```
Frame injection → image-saver → point-cloud-processor → sealer-bead-measurement
                                                       └─→ inference (sealer-2d)
                                                       └─→ frame-writer (DB)
                                                       └─→ result-writer (DB)
```

**Scope**:
- ✅ Pipeline services from frame ingestion through DB persistence
- ✅ DB schema validation (rows in the **B-light common schema** — `pecas`, `frames`, `frames_pecas`, `subcomponente`, `types`, `defeitos_agg`, `defeitos` — per [4.8]). The legacy sealer-specific `tbl_parts`, `tbl_frames_sealer`, `tbl_sealer_inspections` tables no longer exist.
- ❌ **Out of scope**: backend-sealer + frontend-sealer (have their own E2E tests)
- ❌ **Out of scope**: Hikrobot camera hardware (synthetic frame injection)
- ❌ **Out of scope**: `sealer-result` service (PLC handshake) — covered by [4.12] with `fakeredis`-based unit/integration tests; not part of this E2E suite

The test harness lives in `tests/e2e/sealer/`, mirroring the existing `tests/e2e/steel/` structure.

---

## 2. Architecture

```
docker-compose.test.yml
├── postgres (sealer DB with sql-vk-common schema applied + sealer wrappers)
├── redis (KeyDB)
├── rabbitmq
├── image-saver (with IMG_SAVER_SUPPORTED_DATA_TYPES=pointcloud)
├── point-cloud-processor   ── mounts ./fixtures:/cad/sealer:ro (STL for ICP)
├── sealer-bead-measurement ── mounts ./fixtures:/cad/sealer:ro (same path; SEALER-03 reads
│                              cad_registration.stl_path from upstream message)
├── inference (INF_PROFILE=sealer-2d, USE_MOCK=true)
├── frame-writer (db-writer default mode → insert_sealer_frame)
├── result-writer-3d (db-writer default mode → insert_sealer_measurements)
└── result-writer-2d (db-writer default mode → insert_sealer_2d_detection)

run-test.sh
  ├── 1. docker-compose up -d
  ├── 2. wait for services healthy
  ├── 3. apply DB schema + seed (if needed)
  ├── 4. inject_frames.py SCENARIO
  ├── 5. wait for processing complete (poll DB or RabbitMQ for completion signal)
  ├── 6. verify_db.py SCENARIO
  └── 7. docker-compose down
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
  - **N rows** in `defeitos` from 2D detections (class_id=1020 bead_present) — N depends on segment arc length × number of beads. With `sealer_2d_segment_arc_length_mm=100` (default — see [4.11] §5.1) and ~400 mm beads, expect ~8 detections (4 segments × 2 beads); the assertion uses a tolerant range `>= 2` to avoid flakiness on synthetic fixture geometry.

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
- **Expected**: SEALER-03 NACKs to DLX (per SEALER-03 §8 — missing centerline is a config-error path); no rollup row in `pecas`; `sealer-measurement-dlq` ≥1 message

### 3.6 reinspection (UPSERT)
- Run happy-path twice with same `part_uuid`
- **Expected**: pecas row updated (most recent `inspected_at`); old `defeitos_agg` and `defeitos` rows DELETED; new ones inserted (cascade via `insert_sealer_measurements`)

### 3.7 partial-frames (degraded mode)
- Only 12 of 20 frames published
- After timeout, point-cloud-processor publishes `partial=true`, `degraded=true`
- **Expected**: Inspection still processed with whatever frames available; `pecas` updated; `regras_de_negocio` jsonb captures `degraded=true`

### 3.8 2d-detection-only (no 3D measurement)
- Frames published with valid stitched.png but corrupt PLY
- 3D path fails (sealer-bead-measurement NACKs to DLX); 2D path succeeds
- **Expected**: 0 rows in `defeitos_agg`, ≥2 rows in `defeitos` with `class_id` in (1020, 1021); `sealer-measurement-dlq` ≥1 message; `sealer-2d-result-dlq` empty

### 3.9 best-fit-failure (cad-non-convergence)
- Synthetic merged cloud massively perturbed: 60° rotation + 200 mm translation
  vs the CAD STL — impossible to register within `cad_registration_rmse_threshold_mm`.
- **Expected**:
  - SEALER-01 publishes message with `degraded=true`,
    `cad_registration.converged=false`, `T_part_to_CAD = identity`.
    `merged.ply` saved in part frame.
  - sealer-bead-measurement NACKs to DLX (per SEALER-03 §8 — degraded input).
  - inference (sealer-2d) NACKs to DLX (per [4.11] §9 — same reason).
  - DB state: **1 row in `pecas`** (created by frame-writer's `insert_sealer_frame`
    UPSERT — see [4.8] §4.1 step 2 — runs independently of bead-measurement);
    `nao_conforme` left at its column default (no measurement rollup ever ran);
    20 rows in `frames` linked via `frames_pecas`; **0 rows in `defeitos_agg`
    AND `defeitos`** — this is the load-bearing assertion that bead-measurement
    never produced a result.
  - DLQ state: ≥1 message in `sealer-measurement-dlq` and ≥1 in
    `sealer-2d-result-dlq`. The `sealer-frame-writer-dlq` remains empty.

> **Known semantic gap (out of scope for [4.13]):** the `pecas` row in this
> scenario is indistinguishable from a still-processing or successful-pass row
> by inspecting `pecas` alone (`nao_conforme` default, `qtd_defeitos=0`). The
> load-bearing signal that the inspection failed is the absence of rows in
> `defeitos_agg`/`defeitos`. Tightening this would require [4.8] schema to add
> an explicit `inspection_status` (e.g., `pending|passed|failed_registration|
> failed_measurement`) — tracked separately as a Phase 2 schema enhancement,
> not a [4.13] concern.

This complements `no-centerline` (which exercises a config-error path); `best-fit-failure` exercises an algorithm-failure path — both are necessary to cover the SEALER-01 degraded contract end-to-end (per SEALER-01 §4 Stage 5 / §7 Error Handling).

---

## 4. Fixtures

### 4.1 Synthetic part data

`tests/e2e/sealer/fixtures/CRETA_2026/`:
- `part.stl` — generated programmatically via `trimesh` (cube + 2 cylinder bumps representing beads). The STL is consumed by **SEALER-01** unconditionally (Stage 5 best-fit ICP — see SEALER-01 spec §4 Stage 5) and **optionally by SEALER-03** when `sealer_bead_isolation_method = cad-relative` (off-default in CI). The volume mount `/cad/sealer/` MUST be present in both containers in `docker-compose.test.yml`. SEALER-03 reads its STL path from the upstream `cad_registration.stl_path` (per SEALER-03 §3.3) — no separate bind mount.
- `sealer_centerline.json` — 2 beads, ~10 points each, defined in CAD coords
- `stitched_reference.png` — synthetic image (numpy → PIL.save)

> **No `sealer_2d_rois.json`.** ROIs are derived at runtime by the inference service from `sealer_centerline.json` + depth_map metadata (`depth_map_origin_mm`, `depth_map_resolution_mm`) — see [4.11] §5.1. The previously-proposed authored `sealer_2d_rois.json` was removed to keep a single source of truth for bead geometry between SEALER-03 and inference.

### 4.2 Synthetic frames per scenario

`tests/e2e/sealer/fixtures/scenarios/{scenario_name}/`:
- `frame_NN.ply` — 20 binary PLY files (Open3D-generated point clouds)
- `frame_NN.bin` — paired 2D binary images
- `metadata.json` — frame_uuid, part_uuid, encoder positions, timestamps

Each scenario differs by injecting controlled defects in the bead geometry.

### 4.3 Generator scripts

`tests/e2e/sealer/scripts/generate_fixtures.py` — builds all fixtures from scratch (idempotent; check-in committed copies for CI speed). The generator MUST NOT produce a `sealer_2d_rois.json`; ROIs are derived at runtime by the inference service. For the `best-fit-failure` scenario, the generator emits PLY frames whose merged cloud is perturbed by 60° rotation + 200 mm translation relative to `part.stl` so that SEALER-01's ICP cannot converge within `cad_registration_rmse_threshold_mm`.

---

## 5. Helper Scripts

### 5.1 `inject_frames.py`

Publishes frames into the pipeline by writing Redis HASHes (image-saver consumes from there):

```python
def inject_part(redis_client, part_uuid, scenario, fixtures_dir):
    """Inject all frames for a part by writing Redis HASHes."""
    metadata = json.loads((fixtures_dir/scenario/"metadata.json").read_text())
    for frame in metadata["frames"]:
        ply_bytes = (fixtures_dir/scenario/frame["ply_file"]).read_bytes()
        bin_bytes = (fixtures_dir/scenario/frame["bin_file"]).read_bytes()
        # Write HASH that image-saver expects
        redis_client.hset(f"frame:{frame['frame_uuid']}", mapping={
            "frame_uuid": frame["frame_uuid"],
            "part_uuid": part_uuid,
            "vin_number": frame["vin_number"],
            "model_type": frame["model_type"],
            "camera_serial_number": "HK3D001",
            "frame_index": frame["index"],
            "captured_at": frame["captured_at"],
            "point_cloud_data": ply_bytes,
            "image_streaming": bin_bytes,
        })
        # Trigger by publishing to image-saver's signal channel (or relying on key-space notifications)
```

### 5.2 `verify_db.py`

Per-scenario assertions, all written against the **B-light common schema** ([4.8]).

#### Happy-path (full body)

```python
class HappyPathAssertions(BaseAssertions):
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

            # 2D detections (class 1020 bead_present) — count is N segments * 2 beads
            cur.execute(
                "SELECT COUNT(*) FROM defeitos "
                "WHERE peca_id = %s AND class_id IN (1020, 1021)", (peca_id,))
            n_2d = cur.fetchone()[0]
            assert n_2d >= 2  # at least one detection per bead

            # all defeitos rows have populated metrics jsonb
            cur.execute(
                "SELECT COUNT(*) FROM defeitos "
                "WHERE peca_id = %s AND metrics IS NULL", (peca_id,))
            assert cur.fetchone()[0] == 0
```

#### Other scenarios — assertion sketches

Each scenario gets its own `*Assertions` class in `assertions/`. Bodies kept terse here — the implementation lives in the plan tasks.

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
    # 1 row in pecas (created by frame-writer's UPSERT — see [4.8] §4.1 step 2;
    #   no measurement rollup ever runs, so nao_conforme stays at column default);
    # 20 rows in frames (frame-writer is independent of inspection outcome);
    # 0 rows in defeitos_agg AND defeitos (load-bearing signal of failure);
    # ≥1 message in sealer-measurement-dlq AND in sealer-2d-result-dlq;
    # 0 messages in sealer-frame-writer-dlq.
    ...
```

### 5.3 `run-test.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
SCENARIO="${1:-happy-path}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Up infrastructure + services
docker-compose -f docker-compose.test.yml up -d

# 2. Wait for healthy
./wait_for_healthy.sh postgres redis rabbitmq image-saver point-cloud-processor sealer-bead-measurement

# 3. Apply schema + sealer wrappers (B-light: sql-vk-common + procedures/sealer/*)
docker exec sealer-postgres psql -U strokmatic -d sealer -f /sql-vk-common/schema.sql
docker exec sealer-postgres psql -U strokmatic -d sealer -f /sql-vk-common/procedures/sealer/all.sql
docker exec sealer-postgres psql -U strokmatic -d sealer -f /sql-vk-common/seed/classe_defeitos_sealer.sql

# 4. Inject frames
python inject_frames.py --scenario "$SCENARIO"

# 5. Wait for processing to complete (poll DB)
python wait_for_processing.py --scenario "$SCENARIO" --timeout 60

# 6. Verify
python verify_db.py --scenario "$SCENARIO"

# 7. Tear down (always — even on failure, after capturing logs)
docker-compose logs > "$HERE/logs/${SCENARIO}.log"
docker-compose down -v
```

---

## 6. CI Integration

### 6.1 Local invocation

```bash
cd workspaces/strokmatic/visionking
./tests/e2e/sealer/run-test.sh happy-path
./tests/e2e/sealer/run-all.sh    # runs all 9 scenarios sequentially
```

### 6.2 GitHub Actions

`.github/workflows/sealer-e2e.yml` — gated on changes under sealer-related paths:

```yaml
on:
  push:
    paths:
      - "services/image-saver/**"
      - "services/point-cloud-processor/**"
      - "services/sealer-bead-measurement/**"
      - "services/inference/**"
      - "services/database-writer/**"
      - "services/setup/**"
      - "tests/e2e/sealer/**"
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { submodules: true }
      - run: docker-compose -f tests/e2e/sealer/docker-compose.test.yml build
      - run: tests/e2e/sealer/run-all.sh
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: sealer-e2e-logs, path: tests/e2e/sealer/logs/ }
```

Runtime budget: ~11 min for all 9 scenarios.

---

## 7. Out of Scope

- **Performance benchmarks** (latency, throughput) — separate task; this is correctness-only
- **Real Hikrobot camera** — synthetic frames suffice
- **Real PLC** — sealer-result service has its own mocked tests
- **Backend/frontend E2E** — `tests/e2e/sealer-ui/` (future, parallel to [4.15]/[4.16])
- **Real Hyundai CAD/centerline** — synthetic fixtures only; real fixture test is gated (Task 18 of SEALER-03 plan)

---

## 8. Resource Cost

Local run on dev laptop (Docker Desktop, 8GB allocation): ~1 min per scenario × 9 = ~11 min wall clock.

CI runner (GitHub Actions standard): ~15-20 min including image build cache warm-up.

---

## 9. References

- `tests/e2e/steel/` — pattern reference (existing E2E suite for laminação)
- `topologies/sealer-single-node.yaml` — production deployment (test compose mirrors structure with mocks)
- All sister specs: SEALER-01, SEALER-03, [4.8], [4.9], [4.10], [4.11], [4.12]

---

## 10. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-05-06 | Pedro Teruel | Initial design (8 scenarios; assertions against `tbl_parts`/`tbl_frames_sealer`/`tbl_sealer_inspections`; fixtures included `sealer_2d_rois.json`). |
| 2026-05-07 | Pedro Teruel | DB assertions migrated to B-light common schema (`pecas`/`defeitos`/`defeitos_agg`/`frames` + class IDs 1000/1001/1010/1011/1020/1021); fixtures lose `sealer_2d_rois.json` (ROIs derived at runtime per [4.11] §5.1); new scenario `best-fit-failure` (3.9) covers CAD-registration non-convergence path; STL purpose documented for both SEALER-01 (mandatory — Stage 5 ICP) and SEALER-03 (optional — `cad-relative` isolation method); scenario count 8 → 9; runtime budget ~10 → ~11 min. |
