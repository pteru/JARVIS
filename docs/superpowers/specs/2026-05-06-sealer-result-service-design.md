---
type: Design Spec
title: [4.12] sealer-result Service (PLC Return Path) — Design Spec
description: After the sealer pipeline writes inspection results to PostgreSQL ([4.10] db-writer), the **PLC of the next station** needs to know the pass/fail outcome to actuate downstream blocking (NG conveyor...
timestamp: 2026-05-06
---

# [4.12] sealer-result Service (PLC Return Path) — Design Spec

> **Profile**: `vk-sealer`
> **Project**: 03008
> **Backlog**: SEALER-RESULT (NEW, identified 2026-05-06)
> **Date**: 2026-05-06
> **Status**: Draft

---

## 1. Overview

After the sealer pipeline writes inspection results to PostgreSQL ([4.10] db-writer), the **PLC of the next station** needs to know the pass/fail outcome to actuate downstream blocking (NG conveyor, marking, etc.). The Hyundai integration model is **request/response from another station** — not a continuous push.

This spec defines a **new lightweight Python service** modeled on the existing `visionking-result` (laminação): it queries `tbl_sealer_inspections` per request and writes the answer to a Redis hash, where the existing `visionking-plc-monitor` (C++) bridges Redis ↔ Profinet to the Hyundai PLC.

**Why a new service** instead of extending `visionking-result`:
- `visionking-result` is steel-domain (corrida, tracking, NC fields) — overloading it with sealer logic adds coupling
- New service is small (~300 lines) and easier to deploy/operate independently
- Keeps the laminação pipeline untouched (zero regression risk)

> **Phased generalization plan**: this service is intentionally modeled on `visionking-result`'s structure (`src/main.py`, `src/config.py`, `src/db_operations.py`, `src/write_results.py`) so that a future Phase 2 task (`RESULT-SERVICE-GENERALIZE`, tracked in `backlogs/strokmatic/visionking.md`) can mechanically extract the shared infrastructure into a single image driven by `VR_PROFILE=steel|sealer`. Phase 1 keeps the services separate to **avoid any regression risk to the laminação production deployment** (projects 03002, 03009) during the Hyundai 03008 commissioning window.

---

## 2. Architecture

```
                  Hyundai PLC (next station)
                           │
                           │ (Profinet read DB_SealerRequest)
                           ▼
              visionking-plc-monitor (C++, existing)
                           │
                           ▼
              Redis DB_AUX hash sealer_requests
              ┌─────────────────────────────────┐
              │ part_uuid (or key trigger)       │
              └─────────────┬───────────────────┘
                            │ (subscribe / poll)
                            ▼
              ┌─────────────────────────────────┐
              │ sealer-result service (NEW)     │
              │  - listens on Redis pubsub      │
              │    or polls request hash        │
              │  - SELECT overall_pass_fail     │
              │    FROM tbl_sealer_inspections  │
              │  - HSET sealer_results:{uuid}   │
              │    BOOL_PASS_FAIL true/false    │
              └─────────────┬───────────────────┘
                            │
                            ▼
              Redis DB_AUX hash sealer_results
                            │
                            │ (Profinet write DB_SealerResponse)
                            ▼
              visionking-plc-monitor → Hyundai PLC
```

---

## 3. Trigger Mechanism

Two compatible options; pick one based on plc-monitor capabilities (TBD with Hyundai team):

### Option A — Redis Pub/Sub (preferred)

`plc-monitor` publishes to channel `plc:request:sealer` when the PLC writes a part_uuid into `DB_SealerRequest`:

```
PUBLISH plc:request:sealer "{part_uuid}"
```

The `sealer-result` service subscribes:

```python
pubsub = redis.pubsub()
pubsub.subscribe("plc:request:sealer")
for msg in pubsub.listen():
    if msg["type"] == "message":
        part_uuid = msg["data"].decode()
        await handle_request(part_uuid)
```

**Pro**: low latency (sub-millisecond from PLC trigger to query).
**Con**: requires plc-monitor change (add publish on read).

### Option B — Redis hash poll (fallback)

`plc-monitor` writes to `sealer_requests` hash; service polls every N seconds:

```
HSET sealer_requests {part_uuid} pending
```

Service polls:

```python
while True:
    pending = await redis.hgetall("sealer_requests")
    for part_uuid, status in pending.items():
        if status == b"pending":
            await handle_request(part_uuid.decode())
    await asyncio.sleep(0.2)
```

**Pro**: zero changes to plc-monitor.
**Con**: 200ms polling latency; more Redis traffic.

**Decision**: implement **both modes**, switchable via env var. **Default = `poll` (Option B)** for the deployed Phase 1 service. Pubsub becomes the production mode in Phase 2 once `visionking-plc-monitor` ships the publish-on-read change.

### Migration to pubsub (Phase 2)

Pubsub (Option A) is the eventual production mode (lower latency, no polling overhead), but the cutover is gated on:

1. `visionking-plc-monitor` (C++) publishing on the request channel — tracked separately as `SEALER-PLC-MONITOR-ADAPT` in `backlogs/strokmatic/visionking.md`.
2. Hyundai pendência [1.6]/[1.7] resolving the Profinet DB definitions so the C++ team has a stable target.
3. A maintenance window for the C++ team to ship and validate the change.

Until those land, the deployed default in `topologies/sealer-single-node.yaml` is `SR_TRIGGER_MODE=poll`. Switching modes is a single env-var flip + service restart — no code change.

---

## 4. Query Logic

After [4.8] B-light, **`tbl_sealer_inspections` no longer exists**. Sealer pass/fail rolls up into the common-schema tables (`pecas`, `defeitos`, `defeitos_agg`, `frames`) — see `docs/superpowers/specs/2026-05-06-sealer-db-schema-design.md`.

### 4.1 Main query (peças + segments aggregate)

Given a `part_uuid`, look up the inspection result via the common schema. Class IDs `1000` (sealer_segment_pass) and `1001` (sealer_segment_fail) are reserved by [4.8] for sealer segments. The flag `nao_conforme` is the inverse of `overall_pass_fail` per common-schema convention (`overall_pass_fail = NOT nao_conforme`).

```sql
SELECT
  NOT p.nao_conforme                                       AS overall_pass_fail,
  p.qtd_defeitos,
  p.created_at                                             AS processed_at,
  COUNT(d.id) FILTER (WHERE d.class_id IN (1000, 1001))    AS total_segments,
  COUNT(d.id) FILTER (WHERE d.class_id = 1000)             AS passed_segments,
  EXISTS (SELECT 1 FROM frames f WHERE f.peca_id = p.id)   AS has_frames
FROM pecas p
LEFT JOIN defeitos d ON d.peca_id = p.id
WHERE p.peca = $1::uuid
GROUP BY p.id;
```

### 4.2 Fallback query (frames-only check, for grace-period logic)

When the main query returns no row (no `pecas` entry yet), a second query distinguishes "still processing" from "tracking error":

```sql
SELECT EXISTS (
  SELECT 1 FROM frames f
  JOIN pecas p ON p.id = f.peca_id
  WHERE p.peca = $1::uuid
) AS has_frames;
```

In practice this second query is rarely needed because absence of `pecas` typically means absence of `frames` too — but it remains as a defensive check for race windows where frames are written before the rollup.

### 4.3 Outcome decision (state machine with grace period — Strategy B)

The service is **logically stateless** — the only state it owns is a per-request first-seen timestamp (Redis hash with TTL), used to anchor a grace window before flagging `BOOL_NOT_FOUND`. The PLC drives the polling cadence.

```
On request for part_uuid:
  1. Run main query (§4.1) → result
  2. If row exists → write final result (PASS_FAIL):
       BOOL_PASS_FAIL    = NOT nao_conforme
       BOOL_PROCESSING   = false
       BOOL_NOT_FOUND    = false
       INT_QTD_DEFEITOS, INT_TOTAL_SEGMENTS, INT_PASSED_SEGMENTS, TIMESTAMP_PROCESSED
     DEL request_first_seen:{part_uuid}    # cleanup
     return
  3. Row does not exist → run "has_frames" query (§4.2)
     a. If has_frames = TRUE:
          BOOL_PROCESSING = true       # SEALER-03 still working on rollup
          # PLC retries
     b. If has_frames = FALSE:
          first_seen = HGET request_first_seen:{part_uuid} ts
          if first_seen is None:
            HSET request_first_seen:{part_uuid} ts <epoch_ms>
            EXPIRE request_first_seen:{part_uuid} <SR_NOT_FOUND_GRACE_SEC>
            BOOL_PROCESSING = true     # first sighting; give SEALER-03 time
          elif (now - first_seen) < SR_NOT_FOUND_GRACE_SEC:
            BOOL_PROCESSING = true     # still inside grace window
          else:
            BOOL_NOT_FOUND  = true     # past window, real tracking error
            BOOL_PROCESSING = false
            DEL request_first_seen:{part_uuid}    # cleanup
```

Outcomes summary:

| Postgres state | Grace window | Output |
|---|---|---|
| `pecas` row exists, `nao_conforme=FALSE` | n/a | `BOOL_PASS_FAIL=true`, `BOOL_PROCESSING=false`, `BOOL_NOT_FOUND=false` |
| `pecas` row exists, `nao_conforme=TRUE`  | n/a | `BOOL_PASS_FAIL=false`, `BOOL_PROCESSING=false`, `BOOL_NOT_FOUND=false` |
| no `pecas`, `frames` exist               | n/a | `BOOL_PASS_FAIL=null`, `BOOL_PROCESSING=true` |
| no `pecas`, no `frames`, inside grace    | first sighting or `now - first_seen < SR_NOT_FOUND_GRACE_SEC` | `BOOL_PASS_FAIL=null`, `BOOL_PROCESSING=true` |
| no `pecas`, no `frames`, past grace      | `now - first_seen >= SR_NOT_FOUND_GRACE_SEC` | `BOOL_PASS_FAIL=null`, `BOOL_PROCESSING=false`, `BOOL_NOT_FOUND=true` |
| Query timeout (psql unavailable)         | n/a | log error; do not write; PLC retries |

The grace window protects against PLC requests that arrive milliseconds before SEALER-03 inserts the first frame. Default `SR_NOT_FOUND_GRACE_SEC=60` covers the worst-case capture-to-DB latency comfortably.

---

## 5. Output Format (Redis DB_AUX)

`sealer_results` hash, one entry per part_uuid:

```
HSET sealer_results:{part_uuid} BOOL_PASS_FAIL "true"
HSET sealer_results:{part_uuid} BOOL_PROCESSING "false"
HSET sealer_results:{part_uuid} BOOL_NOT_FOUND "false"
HSET sealer_results:{part_uuid} INT_QTD_DEFEITOS "0"
HSET sealer_results:{part_uuid} INT_TOTAL_SEGMENTS "82"
HSET sealer_results:{part_uuid} INT_PASSED_SEGMENTS "82"
HSET sealer_results:{part_uuid} TIMESTAMP_PROCESSED "1747304645"
EXPIRE sealer_results:{part_uuid} 600
```

TTL of 10 min — PLC consumes within seconds; expired entries trimmed automatically.

The exact field names (`BOOL_PASS_FAIL`, `BOOL_PROCESSING`, `BOOL_NOT_FOUND`, `INT_QTD_DEFEITOS`, etc.) follow the laminação convention used by `plc-monitor` to map Redis → PLC DB tags. `BOOL_NOT_FOUND` is sealer-specific: it indicates the PLC sent a `part_uuid` that the vision pipeline never observed (real tracking error, past the grace window — see §4.3). `INT_QTD_DEFEITOS` mirrors `pecas.qtd_defeitos` directly — a richer signal than the boolean alone, useful for PLC-side defect-rate dashboards (operator sees "how many" not just "pass/fail").

### 5.1 Internal Redis state — first-seen timestamps

The grace-period logic in §4.3 stores per-request first-seen timestamps in a separate hash, keyed by part_uuid:

```
HSET request_first_seen:{part_uuid} ts "1747304645123"
EXPIRE request_first_seen:{part_uuid} 60
```

Key prefix is configurable via `SR_FIRST_SEEN_HASH_PREFIX` (default `request_first_seen:`). TTL equals `SR_NOT_FOUND_GRACE_SEC` so abandoned entries clean themselves automatically. Entries are also explicitly `DEL`'d on terminal outcomes (PASS_FAIL written, or NOT_FOUND raised).

---

## 6. Service Layout

Modeled on `services/result/` (visionking-result laminação) so Phase 2 can mechanically extract the shared structure into a single image driven by `VR_PROFILE`. Files at the same logical position carry the same name (`main.py`, `config.py`, `db_operations.py`, `write_results.py`); sealer-specific extensions (handlers/) live alongside.

```
services/sealer-result/                # NEW Python service (mirrors visionking-result structure)
├── visionking-sealer-result.Dockerfile
├── visionking-sealer-result.yml
├── requirements.txt
├── README.md
├── src/
│   ├── __init__.py
│   ├── main.py                         # Async entrypoint (mirrors result/src/main.py)
│   ├── config.py                       # SR_* env vars (mirrors result/src/config.py)
│   ├── db_operations.py                # SELECT queries (mirrors result/src/db_operations.py)
│   ├── write_results.py                # HSET result hash (mirrors result/src/write_results.py)
│   └── handlers/                       # Sealer-specific (no analog in steel result)
│       ├── __init__.py
│       ├── base.py                     # Abstract handler
│       ├── pubsub_handler.py           # Option A (Phase 2 default)
│       └── poll_handler.py             # Option B (Phase 1 default)
└── tests/
    ├── __init__.py
    ├── conftest.py                     # fakeredis + testcontainers postgres
    ├── test_db_operations.py
    ├── test_write_results.py
    ├── test_pubsub_handler.py
    ├── test_poll_handler.py
    └── test_e2e_smoke.py
```

### 6.1 Topology integration

Add the following block to `topologies/sealer-single-node.yaml` under `services:`:

```yaml
services:
  sealer-result:
    enabled: true
    node: main
    network_mode: host
    resources: { memory: "256M", cpus: "0.25" }
    env_overrides:
      SR_TRIGGER_MODE: "poll"
      SR_POLL_HASH: "sealer_requests"
      SR_PSQL_DB: "sealer"
      SR_NOT_FOUND_GRACE_SEC: "60"
```

`network_mode: host` matches `plc-monitor` and the existing `result` service so they all share the same Redis socket without bridge overhead. Resource budget aligns with §8.

---

## 7. Env Vars (SR_ prefix)

| Var | Default | Description |
|---|---|---|
| `SR_REDIS_HOST/PORT/PASS` | — | Redis connection |
| `SR_REDIS_DB_AUX` | 1 | DB for plc-monitor exchange |
| `SR_TRIGGER_MODE` | `poll` | `pubsub` or `poll`. Phase 1 default = `poll`; switch to `pubsub` once `SEALER-PLC-MONITOR-ADAPT` ships. |
| `SR_PUBSUB_CHANNEL` | `plc:request:sealer` | for mode `pubsub` |
| `SR_POLL_HASH` | `sealer_requests` | for mode `poll` |
| `SR_POLL_INTERVAL_MS` | 200 | poll cadence |
| `SR_RESULT_HASH_PREFIX` | `sealer_results:` | prefix for result keys |
| `SR_RESULT_TTL_SECONDS` | 600 | TTL on result entries |
| `SR_FIRST_SEEN_HASH_PREFIX` | `request_first_seen:` | prefix for grace-period anchor hash (§4.3, §5.1) |
| `SR_NOT_FOUND_GRACE_SEC` | 60 | grace window before flagging `BOOL_NOT_FOUND` (§4.3) |
| `SR_PSQL_HOST/PORT/USER/PASS/DB` | — | Postgres connection (sealer DB) |

---

## 8. Resource Budget

| Resource | Allocation |
|---|---|
| Memory | 256 MB |
| CPU | 0.25 core |

Service is I/O bound (Redis pubsub + Postgres SELECT); CPU usage minimal.

---

## 9. Phase 1 Limitations

- **No real PLC integration test** until pendência Hyundai [1.6]/[1.7] is resolved (DBs Profinet defined). All Phase 1 tests use mocked plc-monitor (fakeredis publishes / hash writes).
- **plc-monitor adaptation** is **out of scope** for this spec (separate task on the C++ side once Hyundai DBs are confirmed). For Phase 1 testing, manually publish to `plc:request:sealer` or write `sealer_requests` hash.
- The 7 fields written (`BOOL_PASS_FAIL`, `BOOL_PROCESSING`, `BOOL_NOT_FOUND`, `INT_QTD_DEFEITOS`, `INT_TOTAL_SEGMENTS`, `INT_PASSED_SEGMENTS`, `TIMESTAMP_PROCESSED`) are a **placeholder** based on laminação patterns; final list is decided after [1.7] DBs Profinet I-Device confirmation.

---

## 10. Operational Notes

- Service idempotent — repeat requests for the same `part_uuid` produce identical results
- No persistence; Redis is source of truth for in-flight requests
- Logs include `part_uuid`, `pass_fail`, latency from request → response

---

## 11. References

- `services/result/` (laminação) — structural mirror reference (`src/main.py`, `src/config.py`, `src/db_operations.py`, `src/write_results.py`)
- `services/plc-monitor/` (C++) — bridge between Redis and Profinet
- [4.8] Sealer DB Adoption via sql-vk-common — `docs/superpowers/specs/2026-05-06-sealer-db-schema-design.md` (defines common-schema tables `pecas`, `defeitos`, `defeitos_agg`, `frames` and class IDs `1000`/`1001` for sealer segments)
- Pendência Hyundai [1.6] (reunião PLC) e [1.7] (confirmação DBs Profinet)
- Backlog: `RESULT-SERVICE-GENERALIZE` (Phase 2 task — merge `visionking-result` and `sealer-result` into one image with `VR_PROFILE`)
- Backlog: `SEALER-PLC-MONITOR-ADAPT` (Phase 2 task — C++ side adaptation)

---

## 12. Revision History

| Date | Change |
|---|---|
| 2026-05-06 | Initial draft. |
| 2026-05-07 | Query rewritten for B-light common schema; NOT_FOUND grace-period logic added (Strategy B); default trigger mode is `poll`; topology block documented; phased generalization noted with cross-link to `RESULT-SERVICE-GENERALIZE` backlog task. |
