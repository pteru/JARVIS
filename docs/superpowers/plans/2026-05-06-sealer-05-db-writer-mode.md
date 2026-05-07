# [4.10] Sealer DB Writer Topology — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkbox tracking.

**Goal:** Configure 3 instances of `visionking-database-writer` (default mode, no code change) for the sealer profile — `frame-writer`, `result-writer-3d`, `result-writer-2d` — each pointing at a distinct queue + INSERT_FUNCTION wrapper from [4.8].

**Tech Stack:** YAML topology + bash smoke tests + docs. No Python code change.

**Spec:** `docs/superpowers/specs/2026-05-06-sealer-05-db-writer-mode-design.md`

**Repo path:** `services/database-writer/` (no code change), `topologies/sealer-single-node.yaml`, `architecture/vk-sealer-pipeline.md`

**Estimate:** 1d implementation + 0,5d ajustes (was 4d in original sealer-mode approach). ~5 smoke tests.

---

## Task 1 — Topology + RabbitMQ queues

- [ ] **Step 1: update `topologies/sealer-single-node.yaml`**

Replace the existing `result-writer` block with two:

```yaml
services:
  frame-writer:
    enabled: true
    node: main
    network_mode: host
    resources: { memory: "1024M", cpus: "0.25" }
    env_overrides:
      DB_WRITER_RABBIT_QUEUE: "sealer-frame-writer-queue"
      INSERT_FUNCTION: "insert_sealer_frame"
      PSQL_DB: "sealer"

  # 3D bead measurements
  result-writer-3d:
    enabled: true
    node: main
    network_mode: host
    resources: { memory: "1024M", cpus: "0.25" }
    env_overrides:
      DB_WRITER_RABBIT_QUEUE: "sealer-result-queue"
      INSERT_FUNCTION: "insert_sealer_measurements"
      PSQL_DB: "sealer"

  # 2D ROI detections
  result-writer-2d:
    enabled: true
    node: main
    network_mode: host
    resources: { memory: "1024M", cpus: "0.25" }
    env_overrides:
      DB_WRITER_RABBIT_QUEUE: "sealer-2d-result-queue"
      INSERT_FUNCTION: "insert_sealer_2d_detection"
      PSQL_DB: "sealer"

  inference:
    enabled: true
    env_overrides:
      INF_PROFILE: "sealer-2d"
      INF_RABBIT_INPUT_QUEUE: "sealer-inference-queue"
      INF_RABBIT_OUTPUT_QUEUE: "sealer-2d-result-queue"   # was: sealer-result-queue
```

- [ ] **Step 2: queue declaration**

Either via RabbitMQ Management UI or via init script (existing pattern in `services/setup/`). Add:
- `sealer-2d-result-queue` (durable, with x-dead-letter-exchange → sealer-dlx)
- `sealer-2d-result-dlq` (DLX target)

If queues are auto-declared by image-saver / inference / db-writer on startup, no explicit step needed — verify after smoke test.

- [ ] **Step 3: validate topology**

```bash
cd workspaces/strokmatic/visionking
python -m topology_configurator validate topologies/sealer-single-node.yaml
```

- [ ] **Step 4: commit** `feat(sealer-topology): split result-writer into -3d and -2d instances + add sealer-2d-result-queue`

---

## Task 2 — Smoke tests + architecture doc

- [ ] **Step 1: update `architecture/vk-sealer-pipeline.md`**

Update queue table:

```markdown
| Queue | Routing Key | Producer | Consumer |
|-------|-------------|----------|----------|
| `sealer-frame-writer-queue`  | `sealer.frame`        | image-saver               | frame-writer (default mode) |
| `sealer-processed-queue`     | `sealer.processed`    | image-saver               | point-cloud-processor       |
| `sealer-measurement-queue`   | `sealer.measurement`  | point-cloud-processor     | sealer-bead-measurement     |
| `sealer-inference-queue`     | `sealer.inference`    | point-cloud-processor     | inference (sealer-2d)       |
| `sealer-result-queue`        | `sealer.result`       | sealer-bead-measurement   | result-writer-3d            |
| `sealer-2d-result-queue`     | `sealer.detection_2d` | inference (sealer-2d)     | result-writer-2d            |
| `sealer-frame-writer-dlq`    | DLX                   | (NACK)                    | manual triage               |
| `sealer-result-dlq`          | DLX                   | (NACK)                    | manual triage               |
| `sealer-2d-result-dlq`       | DLX                   | (NACK)                    | manual triage               |
```

Update "Database Writer Instances" section:

```markdown
## Database Writer Instances

Three instances of `visionking-database-writer` (all in default mode, distinguished only by env vars):

| Instance         | Queue                           | INSERT_FUNCTION                    | Wraps tables                 |
|------------------|---------------------------------|------------------------------------|------------------------------|
| frame-writer     | sealer-frame-writer-queue       | insert_sealer_frame                | tbl_parts → pecas, frames    |
| result-writer-3d | sealer-result-queue             | insert_sealer_measurements         | defeitos_agg + defeitos      |
| result-writer-2d | sealer-2d-result-queue          | insert_sealer_2d_detection         | defeitos                     |

All wrappers live in sql-vk-common/procedures/sealer/ ([4.8]).
```

- [ ] **Step 2: smoke script** `services/database-writer/scripts/smoke_sealer.sh`

```bash
#!/usr/bin/env bash
set -e
PG="docker exec -i sealer-postgres psql -U strokmatic -d sealer"

# Inject a frame
docker exec sealer-rabbit rabbitmqadmin publish exchange='' \
    routing_key='sealer-frame-writer-queue' \
    payload='{"frame_uuid":"00000000-0000-0000-0000-000000000001","part_uuid":"00000000-0000-0000-0000-000000000100","vin_number":"VIN001","model_type":"CRETA_2026","frame_index":0,"frame_path":"/img_saved/x.ply","data_type":"pointcloud","camera_serial_number":"HK3D001","captured_at":"2026-05-15T10:30:00Z","station_id":"STN-01"}'
sleep 2
$PG -tAc "SELECT COUNT(*) FROM frames" | grep -q "1"
$PG -tAc "SELECT COUNT(*) FROM pecas" | grep -q "1"

# Inject a 3D measurement
docker exec sealer-rabbit rabbitmqadmin publish exchange='' \
    routing_key='sealer-result-queue' \
    payload='{"part_uuid":"00000000-0000-0000-0000-000000000100","overall_pass_fail":true,"processed_at":"2026-05-15T10:31:00Z","processing_duration_ms":15000,"beads":[{"bead_name":"left_sill","bead_pass_fail":true,"expected_width_mm":22.0,"continuity_pct":95.0,"segments":[{"segment_id":0,"arc_length_mm":0.0,"width_mm":4.2,"height_mm":2.1,"continuity_pct":95.3,"volume_mm3":12.4,"position_offset_mm":0.3,"fit_r2":0.94,"pass_fail":true,"isolation_method":"ransac-plane","fit_model":"gaussian"}]}]}'
sleep 2
$PG -tAc "SELECT COUNT(*) FROM defeitos_agg WHERE peca_id IN (SELECT id FROM pecas WHERE peca='00000000-0000-0000-0000-000000000100')" | grep -q "1"
$PG -tAc "SELECT COUNT(*) FROM defeitos WHERE peca_id IN (SELECT id FROM pecas WHERE peca='00000000-0000-0000-0000-000000000100')" | grep -q "1"

# Inject a 2D detection
docker exec sealer-rabbit rabbitmqadmin publish exchange='' \
    routing_key='sealer-2d-result-queue' \
    payload='{"part_uuid":"00000000-0000-0000-0000-000000000100","inferred_at":"2026-05-15T10:30:50Z","detections":[{"roi_index":0,"roi_name":"left_sill_front","presence":true,"position_x_px":1340,"width_px":87,"confidence":0.92}]}'
sleep 2
$PG -tAc "SELECT COUNT(*) FROM defeitos WHERE class_id=1020 AND peca_id IN (SELECT id FROM pecas WHERE peca='00000000-0000-0000-0000-000000000100')" | grep -q "1"

echo "All 3 db-writer instances smoke test passed"
```

- [ ] **Step 3: run smoke**

```bash
cd workspaces/strokmatic/visionking
docker-compose -f topologies/generated/sealer-single-node/docker-compose.yml up -d
sleep 15  # wait for healthy
bash services/database-writer/scripts/smoke_sealer.sh
docker-compose down
```

- [ ] **Step 4: commit** `feat(sealer-topology): smoke script + architecture doc update for 3 db-writer instances`

---

## Task 3 — Documentation + handoff

- [ ] **Step 1: update `services/database-writer/README.md`**

Add section "Sealer Profile Usage" (no new code, just config):

```markdown
## Sealer Profile

The sealer profile uses **3 instances** of this service in default mode, each pointing at a different queue and INSERT_FUNCTION:

| Instance | DB_WRITER_RABBIT_QUEUE | INSERT_FUNCTION |
|---|---|---|
| frame-writer | sealer-frame-writer-queue | insert_sealer_frame |
| result-writer-3d | sealer-result-queue | insert_sealer_measurements |
| result-writer-2d | sealer-2d-result-queue | insert_sealer_2d_detection |

All 3 stored procedures live in `sql-vk-common/procedures/sealer/` (B-light schema adoption — see SEALER-DB-ADOPTION).

No code change in this service; sealer support is entirely topology + procedures. See `topologies/sealer-single-node.yaml`.
```

- [ ] **Step 2: backlog SEALER-05 marked complete after merge**

- [ ] **Step 3: changelog entry** via mcp tool:
```
- Added: Sealer profile uses 3 instances of database-writer (default mode):
  frame-writer, result-writer-3d, result-writer-2d. Each points at a separate
  queue + INSERT_FUNCTION wrapper. No code change in db-writer service —
  configuration only. See sealer-single-node.yaml.
```

- [ ] **Step 4: commit** `docs(database-writer): sealer profile multi-instance configuration`

---

## Cross-cutting checks

- Topology validates clean
- Smoke test passes (all 3 instances writing to expected tables)
- Existing default-mode tests still pass (no regression in laminacao/carrocerias deployments)
- Rabbit DLX configured for all 3 queues

## Definition of done

- All 3 tasks committed
- 3 db-writer instances running in sealer topology
- Smoke test passes
- Architecture doc updated
- Backlog SEALER-05 marked complete
- Changelog entry recorded
