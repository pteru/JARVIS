---
type: Implementation Plan
title: [4.12] sealer-result Service — Implementation Plan
description: Mirrors `services/result/` (visionking-result) one-for-one. Same filenames at the same logical positions to enable Phase 2 generalization.
timestamp: 2026-05-06
---

# [4.12] sealer-result Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkbox tracking.

**Goal:** New `visionking-sealer-result` Python service. Listens for PLC requests (Redis pubsub or hash poll), queries the common schema (`pecas` + `defeitos` + `frames`) for sealer pass/fail rollup (per [4.8] B-light), and writes the answer to a Redis hash where `plc-monitor` (C++) bridges to Hyundai PLC via Profinet.

> **Phased generalization plan**: this service mirrors `services/result/` (visionking-result laminação) one-for-one at the file level (`src/main.py`, `src/config.py`, `src/db_operations.py`, `src/write_results.py`) so a future Phase 2 task — `RESULT-SERVICE-GENERALIZE` in `backlogs/strokmatic/visionking.md` — can mechanically extract the shared infrastructure into one image driven by `VR_PROFILE=steel|sealer`. Phase 1 keeps them separate to protect the laminação production deployment (03002, 03009).

**Tech Stack:** Python 3.10, redis (async + pubsub), psycopg2, loguru, pydantic 2, pytest, pytest-asyncio, fakeredis.

**Spec:** `docs/superpowers/specs/2026-05-06-sealer-result-service-design.md`

**Repo path:** `services/sealer-result/` (NEW)

**Estimate:** 2.5d implementation + 2d ajustes. ~24 unit/integration tests.

---

## File Structure

Mirrors `services/result/` (visionking-result) one-for-one. Same filenames at the same logical positions to enable Phase 2 generalization.

```
services/sealer-result/
├── visionking-sealer-result.Dockerfile
├── visionking-sealer-result.yml
├── requirements.txt
├── README.md
├── src/
│   ├── __init__.py
│   ├── main.py                  # Async entrypoint (mirrors result/src/main.py)
│   ├── config.py                # SR_* env vars (mirrors result/src/config.py)
│   ├── db_operations.py         # Common-schema queries (mirrors result/src/db_operations.py)
│   ├── write_results.py         # HSET result hash (mirrors result/src/write_results.py)
│   └── handlers/                # Sealer-specific (no analog in steel result)
│       ├── __init__.py
│       ├── base.py              # Abstract handler
│       ├── pubsub_handler.py
│       └── poll_handler.py
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── test_db_operations.py
    ├── test_write_results.py
    ├── test_pubsub_handler.py
    ├── test_poll_handler.py
    └── test_e2e_smoke.py
```

---

## Task 1 — Scaffold service + env vars

- [ ] **Step 1: directory + requirements**
```bash
mkdir -p services/sealer-result/{src,src/handlers,tests}
```

```
# requirements.txt (file name mirrors visionking-result)
redis>=5.0,<6.0
fakeredis>=2.20,<3.0
psycopg2-binary>=2.9,<3.0
loguru>=0.7,<1.0
pydantic>=2.0,<3.0
python-dotenv>=1.0,<2.0
pytest>=8.0,<9.0
pytest-asyncio>=0.23,<1.0
testcontainers>=3.7,<4.0
```

- [ ] **Step 2: Dockerfile** — two-stage slim build (mirror existing `visionking-result/`)

- [ ] **Step 3: env vars** (`src/config.py` — file name mirrors `result/src/config.py`)
```python
SR_REDIS_HOST = os.getenv("SR_REDIS_HOST", os.getenv("REDIS_HOST", "localhost"))
SR_REDIS_PORT = int(os.getenv("SR_REDIS_PORT", os.getenv("REDIS_PORT", "6379")))
SR_REDIS_PASS = os.getenv("SR_REDIS_PASS", os.getenv("REDIS_PASSWORD", ""))
SR_REDIS_DB_AUX = int(os.getenv("SR_REDIS_DB_AUX", "1"))

# Phase 1 default = poll. Pubsub becomes default once SEALER-PLC-MONITOR-ADAPT ships.
SR_TRIGGER_MODE = os.getenv("SR_TRIGGER_MODE", "poll")  # "pubsub" or "poll"
SR_PUBSUB_CHANNEL = os.getenv("SR_PUBSUB_CHANNEL", "plc:request:sealer")
SR_POLL_HASH = os.getenv("SR_POLL_HASH", "sealer_requests")
SR_POLL_INTERVAL_MS = int(os.getenv("SR_POLL_INTERVAL_MS", "200"))

SR_RESULT_HASH_PREFIX = os.getenv("SR_RESULT_HASH_PREFIX", "sealer_results:")
SR_RESULT_TTL_SECONDS = int(os.getenv("SR_RESULT_TTL_SECONDS", "600"))

# NOT_FOUND grace-period (Strategy B). See spec §4.3 / §5.1.
SR_FIRST_SEEN_HASH_PREFIX = os.getenv("SR_FIRST_SEEN_HASH_PREFIX", "request_first_seen:")
SR_NOT_FOUND_GRACE_SEC = int(os.getenv("SR_NOT_FOUND_GRACE_SEC", "60"))

SR_PSQL_HOST = os.getenv("SR_PSQL_HOST", os.getenv("PSQL_HOST", "localhost"))
SR_PSQL_PORT = int(os.getenv("SR_PSQL_PORT", os.getenv("PSQL_PORT", "5432")))
SR_PSQL_USER = os.getenv("SR_PSQL_USER", "strokmatic")
SR_PSQL_PASS = os.getenv("SR_PSQL_PASS", "")
SR_PSQL_DB = os.getenv("SR_PSQL_DB", "sealer")

SR_LOGGING_LEVEL = os.getenv("SR_LOGGING_LEVEL", "INFO").upper()
```

- [ ] **Step 4: connection factories** — inline in `src/config.py` (mirror `result/src/config.py`) or a small helper, exposing `create_redis_client()` and `create_postgres_client()`

- [ ] **Step 5: commit** `feat(sealer-result): scaffold service + env vars (mirrors visionking-result)`

---

## Task 2 — db_operations module (TDD) — common-schema query

After [4.8] B-light, sealer pass/fail rolls up into the common schema (`pecas`, `defeitos`, `frames`). Class IDs `1000` (sealer_segment_pass) and `1001` (sealer_segment_fail) are reserved by [4.8]. The flag `nao_conforme` is the inverse of `overall_pass_fail` (common-schema convention).

- [ ] **Step 1: failing tests** (`tests/test_db_operations.py`)
```python
def test_query_returns_pass_when_part_inspected_and_conforming(psql_conn, sample_part_pass):
    result = query_inspection(psql_conn, sample_part_pass.part_uuid)
    assert result.found
    assert result.overall_pass_fail is True   # nao_conforme=FALSE  → pass
    assert result.total_segments == 80
    assert result.passed_segments == 80

def test_query_returns_fail_when_nao_conforme(psql_conn, sample_part_fail):
    # pecas.nao_conforme=TRUE in fixture
    result = query_inspection(psql_conn, sample_part_fail.part_uuid)
    assert result.found
    assert result.overall_pass_fail is False  # nao_conforme=TRUE → fail

def test_query_returns_not_found_when_no_pecas_row(psql_conn):
    result = query_inspection(psql_conn, "00000000-0000-0000-0000-000000000099")
    assert not result.found
    assert not result.has_frames

def test_query_has_frames_when_pecas_missing_but_frames_exist(psql_conn, sample_frames_no_peca):
    # frames table has rows for this part_uuid but pecas does not yet (race window)
    result = query_inspection(psql_conn, sample_frames_no_peca.part_uuid)
    assert not result.found
    assert result.has_frames  # SEALER-03 still working on rollup
```

- [ ] **Step 2: implement `src/db_operations.py`** (common-schema queries — mirror `result/src/db_operations.py`)
```python
from dataclasses import dataclass
from datetime import datetime

@dataclass
class QueryResult:
    found: bool
    has_frames: bool
    overall_pass_fail: bool | None = None
    processed_at: datetime | None = None
    qtd_defeitos: int = 0
    total_segments: int = 0
    passed_segments: int = 0

# Class IDs reserved by [4.8] for sealer segments.
CLASS_ID_SEGMENT_PASS = 1000
CLASS_ID_SEGMENT_FAIL = 1001

MAIN_QUERY = """
SELECT
  NOT p.nao_conforme                                        AS overall_pass_fail,
  p.qtd_defeitos,
  p.created_at                                              AS processed_at,
  COUNT(d.id) FILTER (WHERE d.class_id IN (1000, 1001))     AS total_segments,
  COUNT(d.id) FILTER (WHERE d.class_id = 1000)              AS passed_segments,
  EXISTS (SELECT 1 FROM frames f WHERE f.peca_id = p.id)    AS has_frames
FROM pecas p
LEFT JOIN defeitos d ON d.peca_id = p.id
WHERE p.peca = %s::uuid
GROUP BY p.id;
"""

HAS_FRAMES_FALLBACK_QUERY = """
SELECT EXISTS (
  SELECT 1 FROM frames f
  JOIN pecas p ON p.id = f.peca_id
  WHERE p.peca = %s::uuid
) AS has_frames;
"""

def query_inspection(conn, part_uuid: str) -> QueryResult:
    with conn.cursor() as cur:
        cur.execute(MAIN_QUERY, (part_uuid,))
        row = cur.fetchone()
        if row is not None:
            overall_pass_fail, qtd, processed_at, total, passed, has_frames = row
            return QueryResult(
                found=True,
                has_frames=bool(has_frames),
                overall_pass_fail=bool(overall_pass_fail),
                processed_at=processed_at,
                qtd_defeitos=int(qtd or 0),
                total_segments=int(total or 0),
                passed_segments=int(passed or 0),
            )
        # No pecas row yet → fall back to frames-only check
        cur.execute(HAS_FRAMES_FALLBACK_QUERY, (part_uuid,))
        (has_frames,) = cur.fetchone()
    return QueryResult(found=False, has_frames=bool(has_frames))
```

- [ ] **Step 3: commit** `feat(sealer-result): db_operations module + tests (B-light common schema)`

---

## Task 3 — write_results module (TDD)

Three terminal outcomes (per spec §4.3): PASS_FAIL, PROCESSING, NOT_FOUND. Mapping rule (must be explicit in code AND tests): `nao_conforme=TRUE` ⇒ `BOOL_PASS_FAIL=false`; `nao_conforme=FALSE` ⇒ `BOOL_PASS_FAIL=true`. The `QueryResult.overall_pass_fail` field already encodes the inversion (see `db_operations.py`).

- [ ] **Step 1: failing tests** (`tests/test_write_results.py`)
```python
def test_writes_pass_result(redis_aux):
    write_pass_fail(redis_aux, "00...01", QueryResult(
        found=True, has_frames=True,
        overall_pass_fail=True, qtd_defeitos=0, total_segments=80, passed_segments=80,
        processed_at=datetime(2026,5,15,10,30)))
    fields = redis_aux.hgetall("sealer_results:00...01")
    assert fields[b"BOOL_PASS_FAIL"]  == b"true"
    assert fields[b"BOOL_PROCESSING"] == b"false"
    assert fields[b"BOOL_NOT_FOUND"]  == b"false"
    assert fields[b"INT_QTD_DEFEITOS"] == b"0"
    assert fields[b"INT_TOTAL_SEGMENTS"] == b"80"
    assert redis_aux.ttl("sealer_results:00...01") == 600

def test_writes_fail_when_nao_conforme(redis_aux):
    # explicit mapping check: nao_conforme=TRUE → BOOL_PASS_FAIL=false
    write_pass_fail(redis_aux, "00...02", QueryResult(
        found=True, has_frames=True,
        overall_pass_fail=False, qtd_defeitos=8, total_segments=80, passed_segments=72,
        processed_at=datetime(2026,5,15,10,30)))
    fields = redis_aux.hgetall("sealer_results:00...02")
    assert fields[b"BOOL_PASS_FAIL"] == b"false"

def test_writes_processing_state(redis_aux):
    write_processing(redis_aux, "00...01")
    fields = redis_aux.hgetall("sealer_results:00...01")
    assert fields[b"BOOL_PASS_FAIL"]  == b"null"
    assert fields[b"BOOL_PROCESSING"] == b"true"
    assert fields[b"BOOL_NOT_FOUND"]  == b"false"

def test_writes_not_found_state(redis_aux):
    write_not_found(redis_aux, "00...01")
    fields = redis_aux.hgetall("sealer_results:00...01")
    assert fields[b"BOOL_PASS_FAIL"]  == b"null"
    assert fields[b"BOOL_PROCESSING"] == b"false"
    assert fields[b"BOOL_NOT_FOUND"]  == b"true"

def test_idempotent_same_part_uuid(redis_aux, sample_pass_result):
    # Same input twice produces same hash content
    write_pass_fail(redis_aux, "00...01", sample_pass_result)
    snapshot = dict(redis_aux.hgetall("sealer_results:00...01"))
    write_pass_fail(redis_aux, "00...01", sample_pass_result)
    assert dict(redis_aux.hgetall("sealer_results:00...01")) == snapshot
```

- [ ] **Step 2: implement `src/write_results.py`** (mirrors `result/src/write_results.py`)
```python
def _key(prefix: str, part_uuid: str) -> str:
    return f"{prefix}{part_uuid}"

def write_pass_fail(redis_client, part_uuid: str, result: QueryResult,
                     prefix: str = "sealer_results:", ttl: int = 600) -> None:
    """Terminal outcome: peças row exists. Map nao_conforme inverse → BOOL_PASS_FAIL."""
    key = _key(prefix, part_uuid)
    fields = {
        "BOOL_PASS_FAIL":     "true" if result.overall_pass_fail else "false",
        "BOOL_PROCESSING":    "false",
        "BOOL_NOT_FOUND":     "false",
        "INT_QTD_DEFEITOS":   str(result.qtd_defeitos),
        "INT_TOTAL_SEGMENTS": str(result.total_segments),
        "INT_PASSED_SEGMENTS": str(result.passed_segments),
        "TIMESTAMP_PROCESSED": str(int(result.processed_at.timestamp())) if result.processed_at else "0",
    }
    redis_client.hset(key, mapping=fields)
    redis_client.expire(key, ttl)

def write_processing(redis_client, part_uuid: str,
                      prefix: str = "sealer_results:", ttl: int = 600) -> None:
    """Non-terminal: SEALER-03 still working (or inside grace window)."""
    key = _key(prefix, part_uuid)
    redis_client.hset(key, mapping={
        "BOOL_PASS_FAIL":  "null",
        "BOOL_PROCESSING": "true",
        "BOOL_NOT_FOUND":  "false",
    })
    redis_client.expire(key, ttl)

def write_not_found(redis_client, part_uuid: str,
                     prefix: str = "sealer_results:", ttl: int = 600) -> None:
    """Terminal: past grace window with no frames → real tracking error."""
    key = _key(prefix, part_uuid)
    redis_client.hset(key, mapping={
        "BOOL_PASS_FAIL":  "null",
        "BOOL_PROCESSING": "false",
        "BOOL_NOT_FOUND":  "true",
    })
    redis_client.expire(key, ttl)
```

- [ ] **Step 3: commit** `feat(sealer-result): write_results module + tests (PASS_FAIL/PROCESSING/NOT_FOUND)`

---

## Task 4 — Grace-period dispatcher (TDD)

The dispatcher decides which `write_*` to call based on the query outcome and the `request_first_seen:{part_uuid}` hash (Strategy B). It is the single place that owns the state machine in spec §4.3, and is shared by both pubsub and poll handlers.

- [ ] **Step 1: failing tests** (`tests/test_dispatcher.py`)
```python
@pytest.mark.asyncio
async def test_pass_fail_when_pecas_row_exists(redis_aux, psql_conn, sample_part_pass):
    await dispatch(redis_aux, psql_conn, sample_part_pass.part_uuid)
    fields = redis_aux.hgetall(f"sealer_results:{sample_part_pass.part_uuid}")
    assert fields[b"BOOL_PASS_FAIL"] == b"true"
    # first-seen anchor cleaned up
    assert not redis_aux.exists(f"request_first_seen:{sample_part_pass.part_uuid}")

@pytest.mark.asyncio
async def test_processing_when_frames_exist_no_peca(redis_aux, psql_conn, sample_frames_no_peca):
    await dispatch(redis_aux, psql_conn, sample_frames_no_peca.part_uuid)
    fields = redis_aux.hgetall(f"sealer_results:{sample_frames_no_peca.part_uuid}")
    assert fields[b"BOOL_PROCESSING"] == b"true"

@pytest.mark.asyncio
async def test_first_sighting_anchors_timestamp(redis_aux, psql_conn):
    # No pecas, no frames → first call anchors first_seen and writes PROCESSING
    part_uuid = "00000000-0000-0000-0000-000000000099"
    await dispatch(redis_aux, psql_conn, part_uuid)
    fields = redis_aux.hgetall(f"sealer_results:{part_uuid}")
    assert fields[b"BOOL_PROCESSING"] == b"true"
    assert fields[b"BOOL_NOT_FOUND"] == b"false"
    assert redis_aux.hexists(f"request_first_seen:{part_uuid}", "ts")
    assert 0 < redis_aux.ttl(f"request_first_seen:{part_uuid}") <= 60

@pytest.mark.asyncio
async def test_not_found_after_grace_window(redis_aux, psql_conn):
    part_uuid = "00000000-0000-0000-0000-0000000000aa"
    # Pre-seed first_seen as if it happened > grace seconds ago
    past = int(time.time() * 1000) - (61 * 1000)
    redis_aux.hset(f"request_first_seen:{part_uuid}", "ts", str(past))
    await dispatch(redis_aux, psql_conn, part_uuid, grace_sec=60)
    fields = redis_aux.hgetall(f"sealer_results:{part_uuid}")
    assert fields[b"BOOL_NOT_FOUND"] == b"true"
    assert fields[b"BOOL_PROCESSING"] == b"false"
    # cleanup
    assert not redis_aux.exists(f"request_first_seen:{part_uuid}")

@pytest.mark.asyncio
async def test_idempotent_repeat_request(redis_aux, psql_conn, sample_part_pass):
    await dispatch(redis_aux, psql_conn, sample_part_pass.part_uuid)
    snapshot = dict(redis_aux.hgetall(f"sealer_results:{sample_part_pass.part_uuid}"))
    await dispatch(redis_aux, psql_conn, sample_part_pass.part_uuid)
    assert dict(redis_aux.hgetall(f"sealer_results:{sample_part_pass.part_uuid}")) == snapshot
```

- [ ] **Step 2: implement dispatcher** (in `src/handlers/base.py` or a small `src/dispatch.py` — mirror visionking-result if it has an analogous module)

- [ ] **Step 3: commit** `feat(sealer-result): grace-period dispatcher (Strategy B) + tests`

---

## Task 5 — Poll handler (TDD — Phase 1 default mode, implemented first)

Phase 1 deployment runs in `poll` mode (no `plc-monitor` C++ change required). Implement this handler first, drive it from the dispatcher above.

- [ ] **Step 1: failing tests** (`tests/test_poll_handler.py`)
```python
@pytest.mark.asyncio
async def test_polls_pending_requests(redis_aux, psql_conn, sample_part_pass):
    redis_aux.hset("sealer_requests", sample_part_pass.part_uuid, "pending")
    handler = PollHandler(redis_aux, psql_conn, hash_key="sealer_requests", interval_ms=50)
    task = asyncio.create_task(handler.run())
    await asyncio.sleep(0.2)
    fields = redis_aux.hgetall(f"sealer_results:{sample_part_pass.part_uuid}")
    assert fields[b"BOOL_PASS_FAIL"] == b"true"
    # After processing, the request is marked done
    assert redis_aux.hget("sealer_requests", sample_part_pass.part_uuid) == b"done"
    task.cancel()

@pytest.mark.asyncio
async def test_poll_handler_grace_then_not_found(redis_aux, psql_conn, monkeypatch):
    # Unknown part_uuid; force grace=0 so it flips to NOT_FOUND on the second tick
    redis_aux.hset("sealer_requests", "00...ff", "pending")
    handler = PollHandler(redis_aux, psql_conn, hash_key="sealer_requests",
                           interval_ms=20, grace_sec=0)
    task = asyncio.create_task(handler.run())
    await asyncio.sleep(0.1)
    fields = redis_aux.hgetall("sealer_results:00...ff")
    assert fields[b"BOOL_NOT_FOUND"] == b"true"
    task.cancel()
```

- [ ] **Step 2: implement `src/handlers/poll_handler.py`** — async loop that scans the request hash, calls `dispatch(...)`, marks `done`

- [ ] **Step 3: commit** `feat(sealer-result): poll handler (Phase 1 default mode)`

---

## Task 6 — Pubsub handler (TDD — Phase 2 production mode)

Implemented second; switched on once `SEALER-PLC-MONITOR-ADAPT` ships the publish-on-read change in the C++ `plc-monitor`.

- [ ] **Step 1: failing tests** (`tests/test_pubsub_handler.py`)
```python
@pytest.mark.asyncio
async def test_handles_pubsub_message(redis_aux, psql_conn, sample_part_pass):
    handler = PubSubHandler(redis_aux, psql_conn, channel="plc:request:sealer")
    task = asyncio.create_task(handler.run())
    await asyncio.sleep(0.05)  # allow subscribe
    redis_aux.publish("plc:request:sealer", sample_part_pass.part_uuid)
    await asyncio.sleep(0.1)
    fields = redis_aux.hgetall(f"sealer_results:{sample_part_pass.part_uuid}")
    assert fields[b"BOOL_PASS_FAIL"] == b"true"
    task.cancel()

@pytest.mark.asyncio
async def test_ignores_invalid_uuid(redis_aux, psql_conn):
    # Publish "garbage" → no error, no hash written
    ...
```

- [ ] **Step 2: implement `src/handlers/pubsub_handler.py`** — async loop subscribed to channel, calls `dispatch(...)`

- [ ] **Step 3: commit** `feat(sealer-result): pubsub handler (Phase 2 production mode)`

---

## Task 7 — Main entry point + mode dispatch

- [ ] **Step 1: implement `src/main.py`** (mirror `result/src/main.py`)
```python
import asyncio, sys
from loguru import logger
from src.config import (
    SR_TRIGGER_MODE, SR_PUBSUB_CHANNEL, SR_POLL_HASH, SR_POLL_INTERVAL_MS,
    SR_RESULT_HASH_PREFIX, SR_RESULT_TTL_SECONDS,
    SR_FIRST_SEEN_HASH_PREFIX, SR_NOT_FOUND_GRACE_SEC,
    create_redis_client, create_postgres_client,
)
from src.handlers.poll_handler import PollHandler
from src.handlers.pubsub_handler import PubSubHandler

async def main():
    logger.info(f"sealer-result starting (mode={SR_TRIGGER_MODE})")
    redis_client = create_redis_client()
    psql_conn = create_postgres_client()
    common_kwargs = dict(
        result_prefix=SR_RESULT_HASH_PREFIX, ttl=SR_RESULT_TTL_SECONDS,
        first_seen_prefix=SR_FIRST_SEEN_HASH_PREFIX, grace_sec=SR_NOT_FOUND_GRACE_SEC,
    )
    if SR_TRIGGER_MODE == "poll":
        handler = PollHandler(redis_client, psql_conn, SR_POLL_HASH, SR_POLL_INTERVAL_MS, **common_kwargs)
    elif SR_TRIGGER_MODE == "pubsub":
        handler = PubSubHandler(redis_client, psql_conn, SR_PUBSUB_CHANNEL, **common_kwargs)
    else:
        logger.critical(f"Invalid SR_TRIGGER_MODE: {SR_TRIGGER_MODE}"); sys.exit(2)
    await handler.run()

if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: integration test** (`tests/test_e2e_smoke.py`) — run `main()` with both modes and assert end-to-end behavior

- [ ] **Step 3: commit** `feat(sealer-result): main entry point with mode dispatch`

---

## Task 8 — Wire into sealer-single-node.yaml + topology validation

- [ ] **Step 1: add the `sealer-result` block under `services:` in `topologies/sealer-single-node.yaml`**
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

- [ ] **Step 2: validate topology** — run the existing topology validator (see `topologies/README.md`) to confirm the new block parses, references resolve, and the resource budget reconciles with §8 of the spec (256M / 0.25 CPU)

- [ ] **Step 3: commit** `feat(sealer-result): wire into sealer-single-node topology`

---

## Task 9 — Docs (README + handover) + backlog

- [ ] **Step 1: README.md**
  - When this service runs (Phase 1 deployment with PLC integration)
  - Modes (pubsub vs poll) and when to switch (cross-link to spec §3 "Migration to pubsub")
  - Grace-period semantics (cross-link to spec §4.3) and the `SR_NOT_FOUND_GRACE_SEC` knob
  - Operational tips (logs, Redis inspection, Postgres latency)
  - **Phase 1 limitation**: PLC integration not real until [1.6]/[1.7]; mock plc-monitor side for testing

- [ ] **Step 2: handover doc** in `services/sealer-result/HANDOVER.md` for the C++ team:
  - List of Redis hash fields written (`BOOL_PASS_FAIL`, `BOOL_PROCESSING`, `BOOL_NOT_FOUND`, `INT_QTD_DEFEITOS`, `INT_TOTAL_SEGMENTS`, `INT_PASSED_SEGMENTS`, `TIMESTAMP_PROCESSED`)
  - Suggested DB tag mapping (when [1.7] arrives)
  - Test fixtures (how to manually trigger via redis-cli)

- [ ] **Step 3: backlog updates** in `backlogs/strokmatic/visionking.md`:
  - SEALER-RESULT (this task) → marked complete after merge
  - SEALER-PLC-MONITOR-ADAPT — C++ side adaptation of plc-monitor for sealer DBs (depends on Hyundai [1.7]) — out of scope here
  - RESULT-SERVICE-GENERALIZE — Phase 2 task to merge `visionking-result` and `sealer-result` into one image with `VR_PROFILE=steel|sealer`

- [ ] **Step 4: commit** `docs(sealer-result): README + handover + backlog entries`

---

## Cross-cutting checks

- `pytest tests/ -v` — 24+ tests passing
- Service starts in both modes against fakeredis + testcontainers postgres
- Idempotency: same `part_uuid` request twice produces identical hash content (covered in `test_dispatcher.py` and `test_write_results.py`)
- Latency from request → response < 50ms (pubsub) / < 250ms (poll)

## Definition of done

- All 9 tasks committed
- Service runs in both modes (poll = Phase 1 default; pubsub gated on SEALER-PLC-MONITOR-ADAPT)
- Topology block added to `sealer-single-node.yaml` and validated
- Backlog entries added (SEALER-RESULT complete + SEALER-PLC-MONITOR-ADAPT + RESULT-SERVICE-GENERALIZE)
- Handover doc for C++ team
- Changelog entry recorded

---

## Revision History

| Date | Change |
|---|---|
| 2026-05-06 | Initial draft. |
| 2026-05-07 | Query rewritten for B-light common schema; NOT_FOUND grace-period logic added (Strategy B); default trigger mode is `poll`; topology block documented; phased generalization noted with cross-link to `RESULT-SERVICE-GENERALIZE` backlog task. |
