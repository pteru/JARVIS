# [4.10] Sealer DB Writer Topology — Design Spec

> **Profile**: `vk-sealer`
> **Project**: 03008
> **Backlog**: SEALER-05 in `backlogs/strokmatic/visionking.md`
> **Date**: 2026-05-07 (revised — multi-instance approach)
> **Status**: Draft

---

## 1. Overview

**Decision (2026-05-07)**: instead of adding a `DB_WRITER_MODE=sealer` branch with custom dispatch logic, sealer uses **multiple instances of the existing `visionking-database-writer` in default mode**, each one configured (via env vars) to consume a specific queue and call a specific stored procedure ([4.8] wrappers).

This is **zero new Python code** — only topology configuration and stored procedures (already specified in [4.8]).

### Three db-writer instances in sealer deployment

| Instance | Queue | INSERT_FUNCTION | Purpose |
|---|---|---|---|
| `frame-writer` | `sealer-frame-writer-queue` | `insert_sealer_frame` | Persists frame metadata at acquisition time |
| `result-writer-3d` | `sealer-result-queue` | `insert_sealer_measurements` | Persists 3D bead measurements (per-segment) |
| `result-writer-2d` | `sealer-2d-result-queue` | `insert_sealer_2d_detection` | Persists 2D ROI detections (presence/position/width) |

All three run **default mode** of the existing `visionking-database-writer`. The default mode loop is:

```python
query = f"SELECT {INSERT_FUNCTION}(%s);"
await psql.execute(query, (message_str,))
```

— it passes the raw JSON message string to the stored procedure. All validation and schema mapping happens in plpgsql ([4.8]).

---

## 2. Why multiple instances vs single dispatch

| Aspect | Single instance (sealer mode) | Multi-instance (this spec) |
|---|---|---|
| Code complexity | New module `src/sealer/`, dispatch logic, Pydantic models | None |
| Failure isolation | 2D detection bug stalls 3D writes | Independent — 2D crash doesn't affect 3D |
| DLX granularity | 1 DLX for both message types | 2 separate DLX for triage |
| Scaling | Cannot scale 2D vs 3D independently | Each instance scalable independently |
| Resource overhead | 1 container (~1GB RAM) | 3 containers (~3GB RAM total — Boxer-6641 has 16GB) |
| Test surface | New tests for `src/sealer/` consumer | Existing default-mode tests cover all instances |
| Operational footprint | 1 service to monitor | 3 services to monitor |

**Net**: 3-instance approach trades 2GB extra RAM for zero new Python code, better failure isolation, and cleaner ops. Boxer-6641 has plenty of headroom.

---

## 3. Producers

| Service | Queue published to | Routing key (default-exchange) |
|---|---|---|
| `image-saver` | `sealer-frame-writer-queue` | n/a (default exchange uses queue name) |
| `sealer-bead-measurement` | `sealer-result-queue` | n/a |
| `inference` (sealer-2d profile) | `sealer-2d-result-queue` | n/a |

The `inference` service env var `INF_RABBIT_OUTPUT_QUEUE` points to `sealer-2d-result-queue` (NEW queue for sealer profile). This is a topology change; no code change in `inference` (it already supports configurable output queue).

---

## 4. RabbitMQ Topology

### 4.1 Queues (sealer-single-node)

```
sealer-frame-writer-queue       (3D frames metadata)
sealer-processed-queue          (trigger for point-cloud-processor)
sealer-measurement-queue        (trigger for sealer-bead-measurement)
sealer-inference-queue          (trigger for inference 2D)
sealer-result-queue             (3D bead measurements → result-writer-3d)
sealer-2d-result-queue          (2D detections → result-writer-2d)         ← NEW
sealer-frame-writer-dlq         (DLX for frames)
sealer-result-dlq               (DLX for 3D measurements)
sealer-2d-result-dlq            (DLX for 2D detections)                    ← NEW
```

### 4.2 Architecture diagram update

`architecture/vk-sealer-pipeline.md` will be updated to reflect the split queue topology.

---

## 5. Topology configuration

`topologies/sealer-single-node.yaml`:

```yaml
services:
  frame-writer:
    enabled: true
    network_mode: host
    resources: { memory: "1024M", cpus: "0.25" }
    env_overrides:
      DB_WRITER_RABBIT_QUEUE: "sealer-frame-writer-queue"
      INSERT_FUNCTION: "insert_sealer_frame"
      PSQL_DB: "sealer"

  result-writer-3d:                            # NEW (replaces previous result-writer)
    enabled: true
    network_mode: host
    resources: { memory: "1024M", cpus: "0.25" }
    env_overrides:
      DB_WRITER_RABBIT_QUEUE: "sealer-result-queue"
      INSERT_FUNCTION: "insert_sealer_measurements"
      PSQL_DB: "sealer"

  result-writer-2d:                            # NEW
    enabled: true
    network_mode: host
    resources: { memory: "1024M", cpus: "0.25" }
    env_overrides:
      DB_WRITER_RABBIT_QUEUE: "sealer-2d-result-queue"
      INSERT_FUNCTION: "insert_sealer_2d_detection"
      PSQL_DB: "sealer"

  inference:                                   # MODIFIED — output queue
    env_overrides:
      INF_PROFILE: "sealer-2d"
      INF_RABBIT_INPUT_QUEUE: "sealer-inference-queue"
      INF_RABBIT_OUTPUT_QUEUE: "sealer-2d-result-queue"     # was sealer-result-queue
```

### 5.1 Resource budget

Total cost vs single-instance approach: +2 GB RAM, +0.5 CPU (within Boxer-6641 budget; updated topology resource table accordingly).

---

## 6. Backwards compatibility

The default mode of `visionking-database-writer` already accepts `INSERT_FUNCTION` env var (used by laminação and carrocerias). Sealer just adds new function names.

The `DB_WRITER_MODE=sparktest` branch in main entry point is **untouched**. Sealer doesn't add a new branch.

---

## 7. Error Handling

Each instance handles errors independently:
- **Pydantic validation** → done in stored procedure plpgsql (raises EXCEPTION)
- **NACK with `requeue=False`** → message goes to per-queue DLX (`sealer-result-dlq`, `sealer-2d-result-dlq`)
- **Postgres unavailable** → NACK with `requeue=True` (existing default-mode logic)

Failures in one instance do not affect the others.

---

## 8. Testing

Smoke test approach:
- Start 3 db-writer containers via `docker-compose.test.yml` ([4.13])
- Publish a frame message → verify it lands in `tbl_parts` + `frames` (frame-writer)
- Publish a 3D measurement → verify it lands in `defeitos_agg` + `defeitos` (result-writer-3d)
- Publish a 2D detection → verify it lands in `defeitos` with class_id 1020/1021 (result-writer-2d)

The procedures themselves are tested in isolation in [4.8] via testcontainers — no new test code needed in `services/database-writer/`.

---

## 9. Plan Reduction

This spec replaces my previous "DB_WRITER_MODE=sealer with dispatch" approach. Plan reduces from **8 tasks (4d)** to **3 tasks (~1d)**:

1. Update `topologies/sealer-single-node.yaml` (split result-writer into -3d and -2d, add NEW queue)
2. Update `architecture/vk-sealer-pipeline.md` (queue table)
3. Smoke test all 3 instances + README update

No `src/sealer/` module needed. No Pydantic models in the writer. No new branches in the main entry point.

---

## 10. Future considerations

If Phase 2 needs cross-stream coordination (e.g., consolidate 2D and 3D results into a single decision), introduce a downstream consolidator service — not by merging the writers.

---

## 11. References

- `services/database-writer/visionking-database-writer.py` — existing default mode (unchanged)
- [4.8] DB schema spec — defines the 3 stored procedures
- [4.11] 2D inference spec — produces input for `result-writer-2d`
- SEALER-03 spec — produces input for `result-writer-3d`
- `architecture/vk-sealer-pipeline.md` — to be updated with new queue
