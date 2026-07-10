---
type: Implementation Plan
title: [4.10] Sealer DB Writer Topology — Implementation Plan
description: Replace the existing `result-writer` block with two:
timestamp: 2026-05-06
---

# [4.10] Sealer DB Writer Topology — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkbox tracking.

**Goal:** Configure 2 instances of `visionking-database-writer` (default mode, no code change) for the sealer profile — `frame-writer` and `result-writer-3d` — each pointing at a distinct queue + INSERT_FUNCTION wrapper from [4.8]. Per-segment 2D detection persistence is **out of scope** (deferred to a companion spec, post-pivot 2026-06-01).

**Tech Stack:** YAML topology + bash smoke tests + docs. No Python code change.

**Spec:** `docs/superpowers/specs/2026-05-06-sealer-05-db-writer-mode-design.md` (rev 2026-06-01).

**Repo path:** `services/database-writer/` (no code change), `topologies/sealer-single-node.yaml`, `architecture/vk-sealer-pipeline.md`

**Estimate:** 0.5d implementation + 0.5d ajustes (was 1d + 0.5d in v1 with 3 instances).

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

  inference:
    enabled: true
    env_overrides:
      INF_PROFILE: "sealer-per-frame"
      INF_RABBIT_INPUT_QUEUE: "sealer-inference-queue"
      INF_RABBIT_OUTPUT_QUEUE: "sealer-detection-queue"

  pixel-to-object:                                # NOT a db-writer; topology completeness only
    enabled: true
    env_overrides:
      VK_PROFILE: "sealer"
      RABBITMQ_INPUT_QUEUE: "sealer-detection-queue"
      RABBITMQ_OUTPUT_QUEUE: "sealer-result-queue"   # TBD; coordinate with sealer-result spec
```

- [ ] **Step 2: queue declaration verification**

No new queues to declare in this task. Pre-pivot `sealer-2d-result-queue` and `sealer-2d-result-dlq` are **deleted** from any prior topology (not used). The other queues (`sealer-detection-queue` etc.) are owned by the inference + pixel-to-object specs.

Verify via RabbitMQ Management UI that the legacy `sealer-2d-result-queue` is absent after redeploy.

- [ ] **Step 3: validate topology**

```bash
cd workspaces/strokmatic/visionking
python -m topology_configurator validate topologies/sealer-single-node.yaml
```

- [ ] **Step 4: commit** `feat(sealer-topology): 2 db-writer instances (frame-writer + result-writer-3d) + inference sealer-per-frame profile`

---

## Task 2 — Smoke tests + architecture doc

- [ ] **Step 1: update `architecture/vk-sealer-pipeline.md`**

Update queue table:

```markdown
| Queue | Routing Key | Producer | Consumer |
|-------|-------------|----------|----------|
| `sealer-frame-writer-queue`  | `sealer.frame`        | image-saver                 | frame-writer (default mode)         |
| `sealer-processed-queue`     | `sealer.processed`    | image-saver                 | point-cloud-processor               |
| `sealer-measurement-queue`   | `sealer.measurement`  | point-cloud-processor       | sealer-bead-measurement (SEALER-03) |
| `sealer-inference-queue`     | `sealer.inference`    | point-cloud-processor       | inference (sealer-per-frame, N/part)|
| `sealer-detection-queue`     | `sealer.detection`    | inference (sealer-per-frame)| pixel-to-object (VK_PROFILE=sealer) |
| `sealer-result-queue`        | `sealer.result`       | sealer-bead-measurement     | result-writer-3d                    |
| `sealer-frame-writer-dlq`    | DLX                   | (NACK)                      | manual triage                       |
| `sealer-result-dlq`          | DLX                   | (NACK)                      | manual triage                       |
```

Update "Database Writer Instances" section:

```markdown
## Database Writer Instances

Two instances of `visionking-database-writer` (all in default mode, distinguished only by env vars):

| Instance         | Queue                           | INSERT_FUNCTION                    | Wraps tables                 |
|------------------|---------------------------------|------------------------------------|------------------------------|
| frame-writer     | sealer-frame-writer-queue       | insert_sealer_frame                | pecas, frames, frames_pecas  |
| result-writer-3d | sealer-result-queue             | insert_sealer_measurements         | defeitos_agg + defeitos      |

Wrappers live in `sql-vk-common/procedures/sealer/` ([4.8]).

**Per-segment 2D detection persistence (class IDs 1020/1021) is out of scope of this topology** post the 2026-06-01 pivot — see the spec §2 for context. A companion spec will define a future persistence path.
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

echo "All 2 db-writer instances smoke test passed"
```

- [ ] **Step 3: run smoke**

```bash
cd workspaces/strokmatic/visionking
docker-compose -f topologies/generated/sealer-single-node/docker-compose.yml up -d
sleep 15  # wait for healthy
bash services/database-writer/scripts/smoke_sealer.sh
docker-compose down
```

- [ ] **Step 4: commit** `feat(sealer-topology): smoke script + architecture doc update for 2 db-writer instances`

---

## Task 3 — Documentation + handoff

- [ ] **Step 1: update `services/database-writer/README.md`**

Add section "Sealer Profile Usage" (no new code, just config):

```markdown
## Sealer Profile

The sealer profile uses **2 instances** of this service in default mode, each pointing at a different queue and INSERT_FUNCTION:

| Instance | DB_WRITER_RABBIT_QUEUE | INSERT_FUNCTION |
|---|---|---|
| frame-writer | sealer-frame-writer-queue | insert_sealer_frame |
| result-writer-3d | sealer-result-queue | insert_sealer_measurements |

Both stored procedures live in `sql-vk-common/procedures/sealer/` (B-light schema adoption — see SEALER-DB-ADOPTION).

No code change in this service; sealer support is entirely topology + procedures. See `topologies/sealer-single-node.yaml`.

**Per-segment 2D detection persistence (class IDs 1020/1021) is NOT handled here** post the 2026-06-01 architectural pivot — that path will be defined in a separate companion spec.
```

- [ ] **Step 2: backlog SEALER-05 marked complete after merge**

- [ ] **Step 3: changelog entry** via mcp tool:
```
- Added: Sealer profile uses 2 instances of database-writer (default mode):
  frame-writer and result-writer-3d. Each points at a separate queue +
  INSERT_FUNCTION wrapper. No code change in db-writer service — configuration
  only. See sealer-single-node.yaml.
- Note: per-segment 2D detection persistence (class IDs 1020/1021) is NOT
  handled here post the 2026-06-01 architectural pivot — companion spec pending.
```

- [ ] **Step 4: commit** `docs(database-writer): sealer profile multi-instance configuration`

---

## Cross-cutting checks

- Topology validates clean
- Smoke test passes (both instances writing to expected tables)
- Existing default-mode tests still pass (no regression in laminacao/carrocerias deployments)
- Rabbit DLX configured for both queues
- Legacy `sealer-2d-result-queue` / `sealer-2d-result-dlq` absent from broker after redeploy

## Definition of done

- All 3 tasks committed
- 2 db-writer instances running in sealer topology
- Smoke test passes
- Architecture doc updated
- Backlog SEALER-05 marked complete
- Changelog entry recorded

---

## Revision history

| Date | Author | Change |
|---|---|---|
| 2026-05-07 | Pedro Teruel | Initial plan (3 instances incl. `result-writer-2d`). |
| 2026-06-01 | Pedro Teruel (with Claude) | Aligned with rewritten spec — dropped `result-writer-2d` and `sealer-2d-result-queue` everywhere; inference env updated for `sealer-per-frame` profile + new queue names; added `pixel-to-object` placeholder in topology for completeness (not a db-writer); per-segment 2D detection persistence noted as out of scope, pending companion spec. Estimate halved (0.5d + 0.5d). |
