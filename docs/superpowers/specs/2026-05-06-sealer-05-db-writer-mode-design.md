---
type: Design Spec
title: [4.10] Sealer DB Writer Topology — Design Spec
description: This is **zero new Python code** — only topology configuration and stored procedures.
timestamp: 2026-05-06
---

# [4.10] Sealer DB Writer Topology — Design Spec

> **Profile**: `vk-sealer`
> **Project**: 03008
> **Backlog**: SEALER-05 in `backlogs/strokmatic/visionking.md`
> **Date**: 2026-05-07 (revised — multi-instance approach); **rewritten 2026-06-01 post-pivot**
> **Status**: Draft

---

## 1. Overview

**Decision (2026-05-07, preserved post-pivot)**: instead of adding a `DB_WRITER_MODE=sealer` branch with custom dispatch logic, sealer uses **multiple instances of the existing `visionking-database-writer` in default mode**, each one configured (via env vars) to consume a specific queue and call a specific stored procedure ([4.8] wrappers).

This is **zero new Python code** — only topology configuration and stored procedures.

### Two db-writer instances in sealer deployment

| Instance | Queue | INSERT_FUNCTION | Purpose |
|---|---|---|---|
| `frame-writer` | `sealer-frame-writer-queue` | `insert_sealer_frame` | Persists frame metadata at acquisition time |
| `result-writer-3d` | `sealer-result-queue` | `insert_sealer_measurements` | Persists 3D bead measurements (per-segment) |

**No db-writer for per-segment 2D detections (`presence=true|false`, class IDs `1020`/`1021`).** Pre-pivot the topology had a `result-writer-2d` consuming `sealer-2d-result-queue`. That queue and writer are **gone** — see §2 for the new persistence path and why it lives in a separate spec.

Both instances run **default mode** of the existing `visionking-database-writer`. The default mode loop is:

```python
query = f"SELECT {INSERT_FUNCTION}(%s);"
await psql.execute(query, (message_str,))
```

— it passes the raw JSON message string to the stored procedure. All validation and schema mapping happens in plpgsql ([4.8]).

---

## 2. Per-segment detection persistence — out of scope, deferred to separate spec

Post 2026-06-01, the inference (`sealer-per-frame`) publishes per-frame envelopes (`detections[]` with `presence=true|false`) to `sealer-detection-queue`. **Pixel-to-object** is the only consumer of that queue in the current topology — it filters `presence=true` and produces tracked 3D defects that flow downstream to `sealer-result`.

`presence=false` (absences) and per-anchor-segment detection-level rows (`defeitos` class IDs `1020`/`1021`) **don't have a persistence path in this spec** by design. Reasons:

- The aggregation strategy (per-frame raw rows vs voting across frames per `(peca, bead_id, segment_idx)` vs end-of-scan rollup) is non-trivial and depends on the downstream `sealer-result` flow + the coverage auditor concept (mentioned in `2026-06-01-pixel-to-object-multi-profile-design.md` §9).
- Splitting it out keeps this spec focused on the two clearly-defined writers, both of which can be deployed immediately.

The detection persistence path will be defined in a **future companion spec** (working title: "sealer detection persistence"). Pre-pivot reference: §4.3 of `2026-05-06-sealer-db-schema-design.md` carries the legacy `insert_sealer_2d_detection` procedure signature as a starting point — its caller will change, the procedure may need to change too.

---

## 3. Why multiple instances vs single dispatch

| Aspect | Single instance (sealer mode) | Multi-instance (this spec) |
|---|---|---|
| Code complexity | New module `src/sealer/`, dispatch logic, Pydantic models | None |
| Failure isolation | Frame-write bug stalls 3D measurement writes | Independent — frame crash doesn't affect 3D |
| DLX granularity | 1 DLX for both message types | 2 separate DLX for triage |
| Scaling | Cannot scale frame writes vs 3D measurements independently | Each instance scalable independently |
| Resource overhead | 1 container (~1GB RAM) | 2 containers (~2GB RAM total — Boxer-6641 has 16GB) |
| Test surface | New tests for `src/sealer/` consumer | Existing default-mode tests cover all instances |
| Operational footprint | 1 service to monitor | 2 services to monitor |

**Net**: 2-instance approach trades 1GB extra RAM for zero new Python code, better failure isolation, and cleaner ops.

---

## 4. Producers

| Service | Queue published to | Routing key (default-exchange) |
|---|---|---|
| `image-saver` | `sealer-frame-writer-queue` | n/a (default exchange uses queue name) |
| `sealer-bead-measurement` (SEALER-03) | `sealer-result-queue` | n/a |

The `inference` (`sealer-per-frame` profile) publishes to **`sealer-detection-queue`** — **not** to any of the queues consumed in this spec. That queue feeds `pixel-to-object` (`VK_PROFILE=sealer`), which is a separate service with its own deployment, not a db-writer instance.

---

## 5. RabbitMQ Topology

### 5.1 Queues (sealer-single-node) — db-writer-relevant only

```
sealer-frame-writer-queue       (acquisition frames metadata → frame-writer)
sealer-result-queue             (3D bead measurements → result-writer-3d)
sealer-frame-writer-dlq         (DLX for frames)
sealer-result-dlq               (DLX for 3D measurements)
```

For reference (not consumed by db-writers):
- `sealer-processed-queue` — image-saver → point-cloud-processor
- `sealer-measurement-queue` — point-cloud-processor → SEALER-03
- `sealer-inference-queue` — point-cloud-processor → inference (per-frame fan-out)
- `sealer-detection-queue` — inference → pixel-to-object

### 5.2 Removed in the 2026-06-01 rewrite

- `sealer-2d-result-queue` — never declared; was the input of the deleted `result-writer-2d`.
- `sealer-2d-result-dlq` — never declared.

### 5.3 Architecture diagram update

`architecture/vk-sealer-pipeline.md` is updated to reflect the new fan-out shape: SEALER-01 publishes both to `sealer-measurement-queue` (1 msg/part) and to `sealer-inference-queue` (N msgs/part).

---

## 6. Topology configuration

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

  result-writer-3d:
    enabled: true
    network_mode: host
    resources: { memory: "1024M", cpus: "0.25" }
    env_overrides:
      DB_WRITER_RABBIT_QUEUE: "sealer-result-queue"
      INSERT_FUNCTION: "insert_sealer_measurements"
      PSQL_DB: "sealer"

  inference:
    enabled: true
    env_overrides:
      INF_PROFILE: "sealer-per-frame"
      INF_RABBIT_INPUT_QUEUE: "sealer-inference-queue"
      INF_RABBIT_OUTPUT_QUEUE: "sealer-detection-queue"
      # Other INF_SEALER_* vars per 2026-06-01-sealer-inference-per-frame-design.md §9.1

  pixel-to-object:                              # consumer of inference output
    enabled: true                               # NOT a db-writer; declared here for topology completeness
    env_overrides:
      VK_PROFILE: "sealer"
      RABBITMQ_INPUT_QUEUE: "sealer-detection-queue"
      RABBITMQ_OUTPUT_QUEUE: "sealer-result-queue"   # path TBD — coordinate with sealer-result spec
```

### 6.1 Resource budget

Net change vs the pre-pivot v1 of this spec: **−1 container, −1 GB RAM** (dropped `result-writer-2d`). `pixel-to-object` is not a db-writer so it is sized separately in its own topology block (memory profile per pixel-to-object multi-profile spec — body deploys are ~1–2 GB; sealer expected to be similar).

---

## 7. Backwards compatibility

The default mode of `visionking-database-writer` already accepts `INSERT_FUNCTION` env var (used by laminação and carrocerias). Sealer just keeps the function names it already uses (`insert_sealer_frame`, `insert_sealer_measurements`).

The `DB_WRITER_MODE=sparktest` branch in main entry point is **untouched**.

---

## 8. Error Handling

Each instance handles errors independently:
- **Pydantic validation** → done in stored procedure plpgsql (raises EXCEPTION)
- **NACK with `requeue=False`** → message goes to per-queue DLX (`sealer-frame-writer-dlq`, `sealer-result-dlq`)
- **Postgres unavailable** → NACK with `requeue=True` (existing default-mode logic)

Failures in one instance do not affect the other.

---

## 9. Testing

Smoke test approach:
- Start 2 db-writer containers via the E2E compose (SEALER-09)
- Publish a frame message → verify it lands in `pecas` (UPSERT) + `frames` via `frames_pecas` (frame-writer)
- Publish a 3D measurement → verify it lands in `defeitos_agg` + `defeitos` (result-writer-3d)

The procedures themselves are tested in isolation in [4.8] via testcontainers — no new test code needed in `services/database-writer/`.

---

## 10. Plan Reduction

Plan reduces to **3 small tasks (~0.5d)**:

1. Update `topologies/sealer-single-node.yaml` (only `result-writer-3d` + `frame-writer`; ensure `inference` env aligns with `sealer-per-frame` profile + new queue names).
2. Update `architecture/vk-sealer-pipeline.md` (queue table + new fan-out arrows).
3. Smoke test 2 db-writer instances against the new SEALER-01 + inference fan-out, end-to-end.

No `src/sealer/` module. No Pydantic models in the writer. No new branches in the main entry point.

---

## 11. Future considerations

- **Detection persistence spec** (companion, deferred). Defines how per-segment `presence=true|false` rows reach the DB. Likely options: (a) thin writer tap on `sealer-detection-queue` + new procedure; (b) auditor service that aggregates per peca and writes consolidated rows; (c) extension of `sealer-result` to emit per-segment rows alongside tracked-defect rows. Decision pending downstream architecture.
- If Phase 2 needs cross-stream coordination (e.g., consolidate 2D detection presence with 3D measurement pass/fail into a single decision), introduce a downstream consolidator service — not by merging the writers.

---

## 12. References

- `services/database-writer/visionking-database-writer.py` — existing default mode (unchanged)
- [4.8] DB schema spec — defines the procedures (`insert_sealer_frame`, `insert_sealer_measurements`); the legacy `insert_sealer_2d_detection` signature stays as reference for the future detection persistence spec
- `2026-06-01-sealer-inference-per-frame-design.md` — produces `sealer-detection-queue` (consumed by pixel-to-object, NOT by db-writer)
- `2026-06-01-pixel-to-object-multi-profile-design.md` — defines the pixel-to-object consumer
- `2026-04-13-sealer-01-point-cloud-processor-design.md` (rev 2026-06-01) — producer of `sealer-measurement-queue` (1/part) and `sealer-inference-queue` (N/part)
- SEALER-03 spec — produces `sealer-result-queue`
- `architecture/vk-sealer-pipeline.md` — to be updated with new fan-out

---

## 13. Revision history

| Date | Author | Change |
|---|---|---|
| 2026-05-07 | Pedro Teruel | Multi-instance approach (3 db-writers including `result-writer-2d`). |
| 2026-06-01 | Pedro Teruel (with Claude) | **Rewritten post-architectural-pivot.** Dropped `result-writer-2d` and `sealer-2d-result-queue` entirely — the inference output goes to `pixel-to-object`, not a db-writer. Per-segment detection persistence (1020/1021) deferred to a separate companion spec. Instance count 3 → 2; cycle complexity down; ~1 GB RAM saved. `inference` env updated for `sealer-per-frame` profile + new queue names. Banner removed. |
