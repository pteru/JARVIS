# plc-comm-ops v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plc-comm-ops v1's list+detail UI with a single-page expandable-table dashboard that shows all plugins simultaneously with live tag values, browser-side trendlines, manual inject panel, and audit logging.

**Architecture:** Plugins publish per-cycle decoded lane state to `tags:<plugin>:<inst>` via a new SDK helper. plc-comm-ops exposes a JSON dashboard endpoint polled at 1 Hz by browser JS that maintains a 120-sample ring buffer per row and renders trendlines with uPlot. A new inject route writes validated values to `cfg:*`, `io:in:*`, or `get_result_*` Redis keys with audit-stream emission.

**Tech Stack:** Python 3.11 + FastAPI + jinja2 + Pico.css (existing v1 stack) + uPlot 1.6.31 CDN + vanilla ES modules. No npm/build step. Tests are pytest only (no JS tests).

**Spec:** `docs/superpowers/specs/2026-05-13-plc-comm-ops-v1.1-design.md`

**Worktrees:**
- SDK: `/home/teruel/worktrees/sdk-v0.2.1/` (NEW — branch off origin/master)
- plc-result-v2: `/home/teruel/worktrees/plc-result-v2/` (existing, branch `v2/sdk-based`)
- plc-monitor-camera-v2: `/home/teruel/worktrees/plc-monitor-camera-v2/` (existing, branch `v2/sdk-based`)
- plc-comm-ops: `/home/teruel/worktrees/plc-comm-ops-v1.1/` (NEW — branch `feat/v1.1` off origin/master)

**Task track ordering:** Track A (SDK + plugin tags) must complete and be tagged before Track C (plc-comm-ops) starts — the dashboard depends on `tags:` keys existing. Track B (plc-comm-ops backend) can develop in parallel against synthetic test data.

---

## Track A — SDK + plugin tags

### Task 1: SDK — `publish_tags` helper (TDD)

**Files:**
- New worktree: `/home/teruel/worktrees/sdk-v0.2.1/`
- Create: `src/strokmatic_comm_sdk/tags.py`
- Create: `tests/test_tags.py`
- Modify: `src/strokmatic_comm_sdk/__init__.py`

- [ ] **Step 1: Create worktree**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk
git fetch origin
git worktree add /home/teruel/worktrees/sdk-v0.2.1 -b v0.2.1-work origin/master
cd /home/teruel/worktrees/sdk-v0.2.1
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/ 2>&1 | tail -3
```

Expected: existing tests still pass (43/43 from v0.2.0 baseline).

- [ ] **Step 2: Write failing test for `publish_tags`**

Create `tests/test_tags.py`:

```python
from strokmatic_comm_sdk.tags import publish_tags


def test_publish_tags_writes_hash(redis_client):
    publish_tags(redis_client, "plc-result-v2", "BSL01", {
        "state": "IDLE",
        "request_result": 0,
        "result_count": 1234,
    })
    raw = redis_client.hgetall("tags:plc-result-v2:BSL01")
    assert raw[b"state"] == b"IDLE"
    assert raw[b"request_result"] == b"0"
    assert raw[b"result_count"] == b"1234"


def test_publish_tags_overwrites_in_place(redis_client):
    publish_tags(redis_client, "plc-result-v2", "BSL01", {"state": "IDLE"})
    publish_tags(redis_client, "plc-result-v2", "BSL01", {"state": "WAITING_RESULT"})
    raw = redis_client.hgetall("tags:plc-result-v2:BSL01")
    assert raw[b"state"] == b"WAITING_RESULT"


def test_publish_tags_accepts_bool_int_float_str(redis_client):
    publish_tags(redis_client, "plc-result-v2", "BSL01", {
        "flag": True,
        "count": 42,
        "ratio": 1.5,
        "name": "alpha",
    })
    raw = redis_client.hgetall("tags:plc-result-v2:BSL01")
    # Bools → "True"/"False" via str(); spec'd to ints in plugin code.
    # publish_tags itself just stores str() of whatever it's given.
    assert raw[b"flag"] in (b"True", b"true", b"1")
    assert raw[b"count"] == b"42"
    assert raw[b"ratio"] == b"1.5"
    assert raw[b"name"] == b"alpha"


def test_publish_tags_with_empty_dict_clears_hash(redis_client):
    """Empty dict still results in an empty hash (key removed by Redis automatically)."""
    publish_tags(redis_client, "plc-result-v2", "BSL01", {"old": "value"})
    publish_tags(redis_client, "plc-result-v2", "BSL01", {})
    # hset with empty mapping is a no-op; the existing field stays.
    # Spec: empty dict = don't change anything. Confirm behavior:
    raw = redis_client.hgetall("tags:plc-result-v2:BSL01")
    assert raw == {b"old": b"value"}
```

Verify the existing conftest provides `redis_client`. If not, the test will fail with fixture error — adapt to use the existing fixture name (likely `redis_client` per v0.2.0 tests).

Run: `pytest tests/test_tags.py -v` — expected: 4 FAIL (ImportError on `strokmatic_comm_sdk.tags`).

- [ ] **Step 3: Implement `tags.py`**

Create `src/strokmatic_comm_sdk/tags.py`:

```python
"""Per-cycle tag snapshot publishing for live dashboards.

Plugins call publish_tags() at the bottom of each runner cycle with
their decoded lane fields, state name, and any other scalar values
they want exposed to the operator dashboard.

Convention:
  - Booleans should be passed as int(0/1) at the call site for grepability.
  - State machine states should be passed as their string class name.
  - Ints/floats/strings stored as-is (str() conversion done by Redis client).

The hash at `tags:<plugin>:<instance>` is overwritten in place each cycle.
No history is kept on the server; client-side ring buffer handles trends.
"""
from typing import Mapping

import redis


def publish_tags(
    redis_client: redis.Redis,
    plugin_name: str,
    instance: str,
    tags: Mapping[str, object],
) -> None:
    """Snapshot `tags` to `tags:<plugin>:<instance>` Redis hash.

    Empty mappings are a no-op (Redis hset with empty mapping does nothing).
    """
    if not tags:
        return
    key = f"tags:{plugin_name}:{instance}"
    redis_client.hset(key, mapping={k: str(v) for k, v in tags.items()})
```

- [ ] **Step 4: Re-export from `__init__.py`**

In `src/strokmatic_comm_sdk/__init__.py`, find the `__all__` list and the imports block, add:

```python
from strokmatic_comm_sdk.tags import publish_tags
```

And append `"publish_tags"` to `__all__`.

- [ ] **Step 5: Run tests**

```bash
cd /home/teruel/worktrees/sdk-v0.2.1
pytest tests/test_tags.py -v
```

Expected: 4/4 PASS.

```bash
pytest tests/ 2>&1 | tail -3
```

Expected: 47/47 PASS (43 prior + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/strokmatic_comm_sdk/tags.py src/strokmatic_comm_sdk/__init__.py tests/test_tags.py
git commit -m "feat(v0.2.1): publish_tags helper for per-cycle dashboard snapshots"
```

---

### Task 2: SDK — bump version to v0.2.1, merge master + tag + push

**Files:**
- Modify (in main clone): nothing — pyproject.toml uses setuptools_scm, version comes from tag

- [ ] **Step 1: Verify setuptools_scm picks up version dynamically**

```bash
cd /home/teruel/worktrees/sdk-v0.2.1
source .venv/bin/activate
python -c "from importlib.metadata import version; print(version('strokmatic-comm-sdk'))"
```

Expected: prints `0.2.1.dev<N>+g<sha>` or similar — setuptools_scm resolves from git state. No file edit needed; the tag IS the version bump (same pattern as v0.2.0 in Task 2 of the v1 plan).

- [ ] **Step 2: Run final test pass**

```bash
pytest tests/ 2>&1 | tail -3
```

Expected: 47/47 PASS.

- [ ] **Step 3: Merge into master locally + tag**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk
git fetch origin
git checkout master
git pull --ff-only origin master
git merge --no-ff v0.2.1-work -m "merge v0.2.1-work: publish_tags helper"
git tag -a v0.2.1 -m "v0.2.1 — publish_tags helper for dashboard snapshots"
```

- [ ] **Step 4: Push master + tag**

```bash
git push origin master
git push origin v0.2.1
```

If `git push origin master` is denied by the auto-mode classifier, dispatch the push request to the user and stop. Don't try to work around.

- [ ] **Step 5: Verify the tag is fetchable**

```bash
pip download "strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.2.1" --no-deps -d /tmp/sdk-021-check
ls /tmp/sdk-021-check/
rm -rf /tmp/sdk-021-check
```

Expected: a tarball/zip appears.

---

### Task 3: plc-result-v2 — publish tags per cycle (TDD)

**Files:**
- Modify: `/home/teruel/worktrees/plc-result-v2/plc-result-v2.req`
- Modify: `/home/teruel/worktrees/plc-result-v2/pyproject.toml`
- Modify: `/home/teruel/worktrees/plc-result-v2/plc_result_v2/runner.py`
- Modify: `/home/teruel/worktrees/plc-result-v2/tests/v2/test_runner_integration.py`

- [ ] **Step 1: Bump SDK pin to v0.2.1**

In `plc-result-v2.req` change `@v0.2.0` → `@v0.2.1`. Same in `pyproject.toml`'s `dependencies = [...]` block.

```bash
cd /home/teruel/worktrees/plc-result-v2
source .venv/bin/activate
pip install -e .
python -c "from strokmatic_comm_sdk import publish_tags; print('ok')"
```

Expected: `ok`.

- [ ] **Step 2: Write failing test**

Append to `tests/v2/test_runner_integration.py`:

```python
def test_runner_publishes_tags_per_cycle(fake_bus, redis_client, cfg):
    """Runner writes decoded input-lane fields to tags:<plugin>:<inst> each cycle."""
    cfg.save(redis_client, "plc-result-v2", cfg.cell, actor="test-setup")
    runner = Runner(cfg, fake_bus, redis_client)
    # PLC has not raised request yet (all zero input)
    fake_bus.set_input(cfg.io_map.request_result_off, b"\x00")
    runner.run_one_cycle()

    raw = redis_client.hgetall(f"tags:plc-result-v2:{cfg.cell}")
    assert raw[b"request_result"] == b"0"
    assert raw[b"result_write_comp_plc"] == b"0"
    assert raw[b"fault_reset_extend"] == b"0"
    assert b"state" in raw  # some state name was published


def test_runner_publishes_tags_with_input_raised(fake_bus, redis_client, cfg):
    cfg.save(redis_client, "plc-result-v2", cfg.cell, actor="test-setup")
    runner = Runner(cfg, fake_bus, redis_client)
    fake_bus.set_input(cfg.io_map.request_result_off, b"\x01")
    runner.run_one_cycle()

    raw = redis_client.hgetall(f"tags:plc-result-v2:{cfg.cell}")
    assert raw[b"request_result"] == b"1"
```

Run: `pytest tests/v2/test_runner_integration.py -v -k tags` — expected: 2 FAIL (no `tags:` key written).

- [ ] **Step 3: Update `runner.py` to publish tags per cycle**

At top of `plc_result_v2/runner.py`, add to imports:

```python
from strokmatic_comm_sdk import publish_tags
```

In `run_one_cycle()`, AFTER `in_lane = decode_in(raw_in, self.cfg.io_map)` and BEFORE the existing logic that handles state transitions:

```python
            # Publish decoded lane snapshot for the dashboard.
            publish_tags(self.app_redis, _PLUGIN_NAME, self.cfg.cell, {
                "state": self._state.__class__.__name__,
                "request_result": int(in_lane.request_result),
                "result_write_comp_plc": int(in_lane.result_write_comp_plc),
                "fault_reset_extend": int(in_lane.fault_reset_extend),
            })
```

Note: if `self._state` is a plain string (not a class instance), use `str(self._state)` instead of `self._state.__class__.__name__`. Read the state machine module first to confirm.

- [ ] **Step 4: Run tests**

```bash
pytest tests/v2/ -v 2>&1 | tail -10
```

Expected: 57 prior + 2 new = 59 passing (or whatever the new total is; key gate is "0 failed, +2 from baseline").

- [ ] **Step 5: Commit**

```bash
git add plc-result-v2.req pyproject.toml plc_result_v2/runner.py tests/v2/test_runner_integration.py
git commit -m "feat(v2): pick up SDK v0.2.1, publish decoded tags per cycle"
```

Do NOT push.

---

### Task 4: camera v2 — publish tags per cycle (TDD)

**Files:**
- Modify: `/home/teruel/worktrees/plc-monitor-camera-v2/plc-monitor-camera-v2.req`
- Modify: `/home/teruel/worktrees/plc-monitor-camera-v2/pyproject.toml`
- Modify: `/home/teruel/worktrees/plc-monitor-camera-v2/plc_monitor_camera_v2/runner.py`
- Modify: `/home/teruel/worktrees/plc-monitor-camera-v2/tests/v2/test_runner_integration.py`

Same pattern as Task 3 but in the camera worktree. Adapt:
- Use the camera's `_PLUGIN_NAME` (likely `"plc-monitor-camera-v2"`)
- Use whatever the camera's instance key attribute is (probably `cfg.cell` — verify by reading runner.py)
- Decoded lane fields differ from plc-result-v2's; open `plc_monitor_camera_v2/lane.py` (or wherever `decode_in` lives) and publish the fields it actually returns

- [ ] **Step 1: Bump SDK pin** — same as Task 3 Step 1, paths adjusted.

- [ ] **Step 2: Write 2 failing tests** — same shape as Task 3 Step 2 (one with zero input, one with the camera's "trigger" or equivalent field raised). Adapt `plugin_name` and `tags:plc-monitor-camera-v2:<inst>` key.

- [ ] **Step 3: Update `runner.py`** — import `publish_tags`, call it once per `tick_once()` (camera v2's per-cycle method) with the decoded lane fields + state name.

- [ ] **Step 4: Run tests**

```bash
pytest tests/v2/ -v 2>&1 | tail -10
```

Expected: 25 prior + 2 new = 27 passing.

- [ ] **Step 5: Commit**

```bash
git add plc-monitor-camera-v2.req pyproject.toml \
        plc_monitor_camera_v2/runner.py tests/v2/test_runner_integration.py
git commit -m "feat(v2): pick up SDK v0.2.1, publish decoded tags per cycle"
```

Do NOT push.

---

## Track B — plc-comm-ops backend

### Task 5: Create v1.1 worktree + bump SDK pin

**Files:**
- New worktree: `/home/teruel/worktrees/plc-comm-ops-v1.1/`
- Modify: `pyproject.toml`, `plc-comm-ops.req`

- [ ] **Step 1: Create worktree on feat/v1.1**

```bash
cd /home/teruel/worktrees/plc-comm-ops
git fetch origin
cd /home/teruel/JARVIS  # avoid worktree-from-worktree weirdness
git -C /home/teruel/worktrees/plc-comm-ops worktree add /home/teruel/worktrees/plc-comm-ops-v1.1 -b feat/v1.1 origin/master
cd /home/teruel/worktrees/plc-comm-ops-v1.1
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/ 2>&1 | tail -3
```

Expected: 38/38 PASS (v1 baseline).

- [ ] **Step 2: Bump SDK pin v0.2.0 → v0.2.1**

In `pyproject.toml` and `plc-comm-ops.req`, change `@v0.2.0` → `@v0.2.1`.

```bash
pip install -e ".[dev]"
python -c "from strokmatic_comm_sdk import publish_tags; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Smoke-run existing tests**

```bash
pytest tests/ 2>&1 | tail -3
```

Expected: 38/38 PASS (v1 tests unaffected by the SDK bump).

- [ ] **Step 4: Commit the bump**

```bash
git add pyproject.toml plc-comm-ops.req
git commit -m "chore: bump SDK pin to v0.2.1 (publish_tags helper)"
```

---

### Task 6: `dashboard.py` — assemble `/api/dashboard.json` payload (TDD)

**Files:**
- Create: `plc_comm_ops/dashboard.py`
- Create: `tests/test_dashboard.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_dashboard.py`:

```python
import json
import time

import pytest

from plc_comm_ops.dashboard import build_dashboard
from plc_comm_ops.status import StatusTracker


@pytest.fixture
def tracker(redis_client):
    return StatusTracker(redis_client, fresh_s=5, stale_s=60, error_window_s=300)


def _seed(redis_client, plugin, inst, *, cfg=None, status=None, tags=None):
    if cfg is not None:
        redis_client.set(f"cfg:{plugin}:{inst}", json.dumps(cfg))
    if status is not None:
        redis_client.hset(f"status:{plugin}:{inst}", mapping=status)
    if tags is not None:
        redis_client.hset(f"tags:{plugin}:{inst}", mapping=tags)


def test_build_dashboard_empty(redis_client, tracker):
    assert build_dashboard(redis_client, tracker) == []


def test_build_dashboard_single_plugin(redis_client, tracker):
    _seed(redis_client, "plc-result-v2", "BSL01",
          cfg={"cell": "BSL01"},
          status={
              "last_beat_ms": int(time.time() * 1000) - 500,
              "state": "IDLE", "error_count": 0, "result_count": 42,
              "cycle_period_ms": 50, "last_cycle_us": 800,
          },
          tags={"request_result": "0", "result_write_comp_plc": "0", "state": "IDLE"})
    result = build_dashboard(redis_client, tracker)
    assert len(result) == 1
    row = result[0]
    assert row["plugin"] == "plc-result-v2"
    assert row["instance"] == "BSL01"
    assert row["health"] == "green"
    assert row["status"]["state"] == "IDLE"
    assert row["status"]["result_count"] == 42
    assert row["tags"]["request_result"] == "0"


def test_build_dashboard_sorted_by_plugin_then_instance(redis_client, tracker):
    _seed(redis_client, "plc-result-v2", "BSL02", cfg={"cell": "BSL02"})
    _seed(redis_client, "plc-result-v2", "BSL01", cfg={"cell": "BSL01"})
    _seed(redis_client, "plc-monitor-camera-v2", "WELD42", cfg={"cell": "WELD42"})
    result = build_dashboard(redis_client, tracker)
    ids = [(r["plugin"], r["instance"]) for r in result]
    assert ids == [
        ("plc-monitor-camera-v2", "WELD42"),
        ("plc-result-v2", "BSL01"),
        ("plc-result-v2", "BSL02"),
    ]


def test_build_dashboard_missing_tags_yields_empty_dict(redis_client, tracker):
    """Tags hash may not exist yet (plugin hasn't started); row still renders."""
    _seed(redis_client, "plc-result-v2", "BSL01",
          cfg={"cell": "BSL01"},
          status={"last_beat_ms": int(time.time() * 1000) - 500, "error_count": 0})
    result = build_dashboard(redis_client, tracker)
    assert result[0]["tags"] == {}


def test_build_dashboard_missing_status_yields_empty_dict_and_red_health(redis_client, tracker):
    _seed(redis_client, "plc-result-v2", "BSL01", cfg={"cell": "BSL01"})
    result = build_dashboard(redis_client, tracker)
    assert result[0]["status"] == {}
    assert result[0]["health"] == "red"
```

Run: `pytest tests/test_dashboard.py -v` — expected: 5 FAIL (ImportError).

- [ ] **Step 2: Implement `dashboard.py`**

Create `plc_comm_ops/dashboard.py`:

```python
"""Build the /api/dashboard.json payload.

For each discovered plugin (one row per cfg:plc-*:* key), assemble:
  - plugin name + instance
  - health color (from StatusTracker)
  - status hash contents (counters + state)
  - tags hash contents (decoded lane fields, set by plugin runners)

All values returned as JSON-serializable primitives. Bytes from Redis
are decoded to str. Numbers are kept as int where the field name implies it.
"""
import redis

from plc_comm_ops.discovery import discover_plugins
from plc_comm_ops.status import StatusTracker


_NUMERIC_FIELDS = {
    "last_beat_ms", "last_cycle_us", "result_count", "tryout_count",
    "error_count", "cycle_period_ms", "tick_ms", "handshake_timeout_ms",
}


def _decode_hash(raw: dict) -> dict:
    if not raw:
        return {}
    out: dict = {}
    for k, v in raw.items():
        key = k.decode() if isinstance(k, bytes) else k
        val = v.decode() if isinstance(v, bytes) else v
        if key in _NUMERIC_FIELDS:
            try:
                out[key] = int(val)
            except ValueError:
                out[key] = val
        else:
            out[key] = val
    return out


def build_dashboard(redis_client: redis.Redis, tracker: StatusTracker) -> list[dict]:
    """Return one row per discovered plugin instance, sorted (plugin, instance)."""
    rows: list[dict] = []
    for plugin, instance in discover_plugins(redis_client):
        status = _decode_hash(redis_client.hgetall(f"status:{plugin}:{instance}"))
        tags = _decode_hash(redis_client.hgetall(f"tags:{plugin}:{instance}"))
        health = tracker.health_color(plugin, instance).value
        rows.append({
            "plugin": plugin,
            "instance": instance,
            "health": health,
            "status": status,
            "tags": tags,
        })
    return rows
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_dashboard.py -v
```

Expected: 5/5 PASS.

- [ ] **Step 4: Commit**

```bash
git add plc_comm_ops/dashboard.py tests/test_dashboard.py
git commit -m "feat: dashboard.py builds /api/dashboard.json payload"
```

---

### Task 7: `inject.py` — validate, write, audit + routes + tests (TDD)

**Files:**
- Create: `plc_comm_ops/inject.py`
- Create: `tests/test_inject.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_inject.py`:

```python
import json
import time

import pytest

from plc_comm_ops.inject import (
    InjectError, inject_value, list_inject_targets,
)


def _seed_schema(redis_client, plugin, inst, properties, io_map=None):
    schema = {
        "type": "object",
        "properties": properties,
    }
    redis_client.set(f"schema:{plugin}:{inst}", json.dumps(schema))


def _seed_cfg(redis_client, plugin, inst, doc):
    redis_client.set(f"cfg:{plugin}:{inst}", json.dumps(doc))


# --- list_inject_targets ---

def test_list_targets_returns_cfg_io_get_result(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {
        "plc_key": {"type": "string"},
        "cycle_period_ms": {"type": "integer"},
        "io_map": {"type": "object", "properties": {
            "request_result_off": {"type": "integer"},
        }},
    })
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {
        "plc_key": "192.168.15.10",
        "cycle_period_ms": 50,
        "io_map": {"request_result_off": 32},
        "get_result_key": "192.168.15.10_GET_RESULT",
        "get_result_confirm_key": "192.168.15.10_GET_RESULT_CONFIRM",
    })
    targets = list_inject_targets(redis_client, "plc-result-v2", "BSL01")
    assert "plc_key" in targets["cfg_fields"]
    assert "cycle_period_ms" in targets["cfg_fields"]
    assert "request_result" in targets["io_in_fields"]
    assert "192.168.15.10_GET_RESULT" in targets["get_result_keys"]
    assert "192.168.15.10_GET_RESULT_CONFIRM" in targets["get_result_keys"]


def test_list_targets_empty_when_nothing_seeded(redis_client):
    targets = list_inject_targets(redis_client, "plc-result-v2", "MISSING")
    assert targets == {"cfg_fields": [], "io_in_fields": [], "get_result_keys": []}


# --- inject_value ---

def test_inject_cfg_field_patches_doc_via_save(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01",
                 {"cycle_period_ms": {"type": "integer"}})
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"cycle_period_ms": 50})

    inject_value(redis_client, "plc-result-v2", "BSL01",
                 target_key="cfg:plc-result-v2:BSL01",
                 target_field="cycle_period_ms",
                 value="100", actor="10.0.0.5")

    new = json.loads(redis_client.get("cfg:plc-result-v2:BSL01"))
    assert new["cycle_period_ms"] == 100


def test_inject_cfg_field_emits_audit_via_save(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01",
                 {"cycle_period_ms": {"type": "integer"}})
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"cycle_period_ms": 50})

    inject_value(redis_client, "plc-result-v2", "BSL01",
                 target_key="cfg:plc-result-v2:BSL01", target_field="cycle_period_ms",
                 value="100", actor="10.0.0.5")
    entries = redis_client.xrange("audit:plc-result-v2:BSL01")
    assert len(entries) == 1  # save_cfg's audit only — no double-log


def test_inject_io_in_field_writes_byte(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {
        "plc_key": {"type": "string"},
        "io_map": {"type": "object", "properties": {
            "request_result_off": {"type": "integer"},
        }},
    })
    _seed_cfg(redis_client, "plc-result-v2", "BSL01",
              {"plc_key": "192.168.15.10",
               "io_map": {"request_result_off": 32}})
    # Pre-initialize io:in to 48 zero bytes
    redis_client.set("io:in:192.168.15.10", bytes(48))

    inject_value(redis_client, "plc-result-v2", "BSL01",
                 target_key="io:in:192.168.15.10", target_field="request_result",
                 value="1", actor="10.0.0.5")

    buf = redis_client.get("io:in:192.168.15.10")
    assert buf[32] == 1


def test_inject_io_in_initializes_missing_buffer(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {
        "plc_key": {"type": "string"},
        "io_map": {"type": "object", "properties": {
            "request_result_off": {"type": "integer"},
        }},
    })
    _seed_cfg(redis_client, "plc-result-v2", "BSL01",
              {"plc_key": "192.168.15.10",
               "io_map": {"request_result_off": 32}})
    # io:in does NOT exist
    inject_value(redis_client, "plc-result-v2", "BSL01",
                 target_key="io:in:192.168.15.10", target_field="request_result",
                 value="1", actor="10.0.0.5")
    buf = redis_client.get("io:in:192.168.15.10")
    assert len(buf) == 48
    assert buf[32] == 1


def test_inject_io_in_emits_audit(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {
        "plc_key": {"type": "string"},
        "io_map": {"type": "object", "properties": {
            "request_result_off": {"type": "integer"},
        }},
    })
    _seed_cfg(redis_client, "plc-result-v2", "BSL01",
              {"plc_key": "192.168.15.10",
               "io_map": {"request_result_off": 32}})
    inject_value(redis_client, "plc-result-v2", "BSL01",
                 target_key="io:in:192.168.15.10", target_field="request_result",
                 value="1", actor="10.0.0.5")
    entries = redis_client.xrange("audit:plc-result-v2:BSL01")
    assert len(entries) == 1
    _, fields = entries[0]
    decoded = {k.decode(): v.decode() for k, v in fields.items()}
    assert decoded["actor"] == "10.0.0.5"
    assert "inject:" in decoded["field_path"]


def test_inject_get_result_key_sets_value(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {})
    _seed_cfg(redis_client, "plc-result-v2", "BSL01",
              {"get_result_confirm_key": "192.168.15.10_GET_RESULT_CONFIRM"})
    inject_value(redis_client, "plc-result-v2", "BSL01",
                 target_key="192.168.15.10_GET_RESULT_CONFIRM", target_field=None,
                 value="1", actor="10.0.0.5")
    assert redis_client.get("192.168.15.10_GET_RESULT_CONFIRM") == b"1"


def test_inject_rejects_forbidden_namespace(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {})
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {})
    with pytest.raises(InjectError):
        inject_value(redis_client, "plc-result-v2", "BSL01",
                     target_key="io:out:192.168.15.10", target_field=None,
                     value="1", actor="t")
    with pytest.raises(InjectError):
        inject_value(redis_client, "plc-result-v2", "BSL01",
                     target_key="audit:plc-result-v2:BSL01", target_field=None,
                     value="1", actor="t")


def test_inject_rejects_unknown_cfg_field(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01",
                 {"cycle_period_ms": {"type": "integer"}})
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"cycle_period_ms": 50})
    with pytest.raises(InjectError):
        inject_value(redis_client, "plc-result-v2", "BSL01",
                     target_key="cfg:plc-result-v2:BSL01", target_field="not_a_field",
                     value="x", actor="t")


def test_inject_rejects_unknown_io_in_field(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {
        "io_map": {"type": "object", "properties": {
            "request_result_off": {"type": "integer"},
        }},
    })
    _seed_cfg(redis_client, "plc-result-v2", "BSL01",
              {"plc_key": "192.168.15.10",
               "io_map": {"request_result_off": 32}})
    with pytest.raises(InjectError):
        inject_value(redis_client, "plc-result-v2", "BSL01",
                     target_key="io:in:192.168.15.10", target_field="unknown_field",
                     value="1", actor="t")
```

Run: `pytest tests/test_inject.py -v` — expected: 10 FAIL (ImportError).

- [ ] **Step 2: Implement `inject.py`**

Create `plc_comm_ops/inject.py`:

```python
"""Validate + execute manual inject writes for debugging.

Allowed targets (per spec §4):
  - cfg:<plugin>:<instance> + target_field → patch doc, save via save_cfg (audit via save)
  - io:in:<plc_key> + target_field → write 1 byte at io_map.<field>_off (audit emitted here)
  - <get_result_*-named-cfg-value> → direct set (audit emitted here)
"""
import json
import time

import redis

from plc_comm_ops.editor import EditorError, save_cfg


class InjectError(Exception):
    """Raised when the inject request is invalid (forbidden namespace, unknown field, etc.)."""


def list_inject_targets(redis_client: redis.Redis, plugin: str, instance: str) -> dict:
    """Return dict of writeable targets for a plugin instance."""
    out = {"cfg_fields": [], "io_in_fields": [], "get_result_keys": []}

    schema_raw = redis_client.get(f"schema:{plugin}:{instance}")
    cfg_raw = redis_client.get(f"cfg:{plugin}:{instance}")
    if schema_raw is None or cfg_raw is None:
        return out

    schema = json.loads(schema_raw)
    cfg = json.loads(cfg_raw)

    # cfg scalar fields
    for name, prop in schema.get("properties", {}).items():
        t = prop.get("type")
        if t in {"string", "integer", "number", "boolean"} or "enum" in prop:
            out["cfg_fields"].append(name)

    # io:in fields from io_map.<field>_off
    io_map = cfg.get("io_map", {})
    if isinstance(io_map, dict):
        for key in io_map:
            if key.endswith("_off"):
                out["io_in_fields"].append(key[:-4])  # drop "_off"

    # get_result keys: cfg fields whose name ends with "_key" and is non-empty string
    for name, value in cfg.items():
        if name.endswith("_key") and isinstance(value, str) and value:
            out["get_result_keys"].append(value)

    return out


def inject_value(
    redis_client: redis.Redis,
    plugin: str,
    instance: str,
    *,
    target_key: str,
    target_field: str | None,
    value: str,
    actor: str,
) -> None:
    """Perform a single validated write. Raises InjectError on rejection."""
    # Route by namespace
    if target_key.startswith("cfg:"):
        _inject_cfg(redis_client, plugin, instance, target_field, value, actor)
        return
    if target_key.startswith("io:in:"):
        _inject_io_in(redis_client, plugin, instance, target_key, target_field, value, actor)
        return
    # get_result_* — match against the inject-targets list (which scans cfg *_key values)
    targets = list_inject_targets(redis_client, plugin, instance)
    if target_key in targets["get_result_keys"]:
        _inject_get_result(redis_client, plugin, instance, target_key, value, actor)
        return

    raise InjectError(f"Forbidden target namespace: {target_key}")


def _inject_cfg(redis_client, plugin, instance, field, value, actor):
    cfg_key = f"cfg:{plugin}:{instance}"
    cached_raw = redis_client.get(cfg_key)
    if cached_raw is None:
        raise InjectError(f"No cfg at {cfg_key}")
    cached_str = cached_raw.decode()
    doc = json.loads(cached_str)
    if field not in doc and field not in _schema_fields(redis_client, plugin, instance):
        raise InjectError(f"Unknown cfg field: {field}")

    # save_cfg expects form_data; we synthesize a one-field patch by merging into the current doc
    # then sending all fields. That preserves untouched fields and pushes through the editor's
    # schema-coercion + audit path.
    form_data = {k: _to_form_str(v) for k, v in doc.items()}
    form_data[field] = value
    try:
        save_cfg(redis_client, plugin, instance,
                 form_data=form_data, cached_raw=cached_str, actor=actor)
    except EditorError as exc:
        raise InjectError(str(exc)) from exc


def _inject_io_in(redis_client, plugin, instance, target_key, field, value, actor):
    cfg_raw = redis_client.get(f"cfg:{plugin}:{instance}")
    if cfg_raw is None:
        raise InjectError(f"No cfg for {plugin}:{instance}")
    cfg = json.loads(cfg_raw)
    io_map = cfg.get("io_map", {})
    off_key = f"{field}_off"
    if off_key not in io_map:
        raise InjectError(f"Unknown io:in field: {field}")
    offset = int(io_map[off_key])

    # Initialize buffer if missing
    buf_raw = redis_client.get(target_key)
    if buf_raw is None:
        buf = bytearray(48)
    else:
        buf = bytearray(buf_raw)
        if len(buf) < 48:
            buf.extend(b"\x00" * (48 - len(buf)))
    old_byte = buf[offset]
    buf[offset] = int(value) & 0xFF
    redis_client.set(target_key, bytes(buf))

    _emit_audit(redis_client, plugin, instance,
                field_path=f"inject:{target_key}:{field}",
                actor=actor, old=str(old_byte), new=value)


def _inject_get_result(redis_client, plugin, instance, target_key, value, actor):
    old = redis_client.get(target_key)
    old_str = old.decode() if isinstance(old, bytes) else (old or "")
    redis_client.set(target_key, value)
    _emit_audit(redis_client, plugin, instance,
                field_path=f"inject:{target_key}",
                actor=actor, old=old_str, new=value)


def _schema_fields(redis_client, plugin, instance) -> set[str]:
    raw = redis_client.get(f"schema:{plugin}:{instance}")
    if raw is None:
        return set()
    return set(json.loads(raw).get("properties", {}).keys())


def _to_form_str(v) -> str:
    if isinstance(v, bool):
        return "on" if v else ""  # mirror how the HTML form sends checkboxes
    return str(v)


def _emit_audit(redis_client, plugin, instance, *, field_path, actor, old, new):
    redis_client.xadd(
        f"audit:{plugin}:{instance}",
        {
            "ts": str(int(time.time() * 1000)),
            "actor": actor,
            "field_path": field_path,
            "old": old,
            "new": new,
        },
        maxlen=10000,
        approximate=True,
    )
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_inject.py -v
```

Expected: 10/10 PASS.

- [ ] **Step 4: Commit**

```bash
git add plc_comm_ops/inject.py tests/test_inject.py
git commit -m "feat: inject.py — validated writes to cfg/io:in/get_result + audit"
```

---

### Task 8: Replace `app.py` routes — dashboard, inject, remove detail page

**Files:**
- Modify: `plc_comm_ops/app.py`
- Modify: `tests/test_routes.py`
- Delete: `plc_comm_ops/templates/list.html`
- Delete: `plc_comm_ops/templates/plugin.html`

- [ ] **Step 1: Replace `/` and remove old detail route in `app.py`**

Open `plc_comm_ops/app.py`. Remove these v1 routes:
- `@app.get("/", response_class=HTMLResponse)` — entire function `index(...)`
- `@app.get("/plugin/{plugin}/{instance}", response_class=HTMLResponse)` — entire function `plugin_detail(...)`

Keep these v1 routes:
- `@app.get("/healthz", response_class=PlainTextResponse)`
- `@app.post("/plugin/{plugin}/{instance}/save")`
- `@app.get("/plugin/{plugin}/{instance}/status", response_class=HTMLResponse)`

Add new routes (insert before `/healthz` for organization):

```python
import json
from fastapi import HTTPException
from fastapi.staticfiles import StaticFiles

from plc_comm_ops.dashboard import build_dashboard
from plc_comm_ops.inject import InjectError, inject_value, list_inject_targets
from plc_comm_ops.schema import render_form


# Static assets (CSS, JS) — mounted at /static
_static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")


@app.get("/", response_class=HTMLResponse)
def dashboard_page(request: Request) -> Response:
    rows = build_dashboard(_redis, _status_tracker)
    return _templates.TemplateResponse(
        request, "dashboard.html", {"rows": rows},
    )


@app.get("/api/dashboard.json")
def dashboard_json() -> Response:
    return JSONResponse(build_dashboard(_redis, _status_tracker))


@app.get("/plugin/{plugin}/{instance}/cfg-form", response_class=HTMLResponse)
def cfg_form_fragment(plugin: str, instance: str) -> Response:
    """Return the cfg edit form as an HTML fragment for inline rendering."""
    cfg_raw = _redis.get(f"cfg:{plugin}:{instance}")
    schema_raw = _redis.get(f"schema:{plugin}:{instance}")
    if cfg_raw is None:
        raise HTTPException(404, f"No cfg for {plugin}:{instance}")
    cfg_doc = json.loads(cfg_raw)
    cached_raw = cfg_raw.decode() if isinstance(cfg_raw, bytes) else cfg_raw
    if schema_raw is None:
        form_html = "<mark>Schema not published. Restart the plugin.</mark>"
    else:
        result = render_form(json.loads(schema_raw), cfg_doc)
        form_html = result.html
    html = (
        f'<input type="hidden" name="_cached_raw" value="{cached_raw}">'
        f'{form_html}'
        '<button type="submit">Save</button>'
    )
    return HTMLResponse(html)


@app.get("/plugin/{plugin}/{instance}/inject-targets")
def inject_targets_route(plugin: str, instance: str) -> Response:
    return JSONResponse(list_inject_targets(_redis, plugin, instance))


@app.post("/plugin/{plugin}/{instance}/inject")
async def inject_route(plugin: str, instance: str, request: Request) -> Response:
    body = await request.json()
    target_key = body.get("target_key", "")
    target_field = body.get("target_field")
    value = body.get("value", "")
    actor = request.client.host if request.client else "unknown"
    try:
        inject_value(_redis, plugin, instance,
                     target_key=target_key, target_field=target_field,
                     value=value, actor=actor)
    except InjectError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return JSONResponse({"ok": True})
```

- [ ] **Step 2: Update `test_routes.py`**

Remove these v1 tests (they assert deleted behavior):
- `test_list_page_empty`
- `test_list_page_shows_discovered_plugin`
- `test_detail_page_renders_form_prefilled`
- `test_detail_page_404_when_plugin_unknown`

Keep these v1 tests (they test still-present routes):
- `test_healthz_returns_200`
- `test_save_updates_cfg_and_redirects`
- `test_save_returns_409_on_conflict`
- `test_status_partial_returns_html_fragment`

Add these new tests:

```python
def test_dashboard_page_returns_html_skeleton(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "<html" in r.text.lower()
    assert "dashboard" in r.text.lower()


def test_dashboard_json_returns_empty_list_when_no_plugins(client):
    r = client.get("/api/dashboard.json")
    assert r.status_code == 200
    assert r.json() == []


def test_dashboard_json_returns_seeded_plugins(client, redis_client):
    import json, time
    redis_client.set("cfg:plc-result-v2:BSL01", json.dumps({"cell": "BSL01"}))
    redis_client.hset("status:plc-result-v2:BSL01", mapping={
        "last_beat_ms": int(time.time() * 1000) - 500,
        "state": "IDLE", "error_count": 0,
    })
    redis_client.hset("tags:plc-result-v2:BSL01", mapping={"request_result": "0"})
    r = client.get("/api/dashboard.json")
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["plugin"] == "plc-result-v2"
    assert rows[0]["tags"]["request_result"] == "0"


def test_inject_route_writes_value(client, redis_client):
    import json
    redis_client.set("schema:plc-result-v2:BSL01", json.dumps({
        "type": "object",
        "properties": {"cycle_period_ms": {"type": "integer"}},
    }))
    redis_client.set("cfg:plc-result-v2:BSL01", json.dumps({"cycle_period_ms": 50}))
    r = client.post("/plugin/plc-result-v2/BSL01/inject", json={
        "target_key": "cfg:plc-result-v2:BSL01",
        "target_field": "cycle_period_ms",
        "value": "100",
    })
    assert r.status_code == 200
    new = json.loads(redis_client.get("cfg:plc-result-v2:BSL01"))
    assert new["cycle_period_ms"] == 100


def test_inject_route_400_on_forbidden_namespace(client, redis_client):
    import json
    redis_client.set("schema:plc-result-v2:BSL01", json.dumps({
        "type": "object", "properties": {},
    }))
    redis_client.set("cfg:plc-result-v2:BSL01", json.dumps({}))
    r = client.post("/plugin/plc-result-v2/BSL01/inject", json={
        "target_key": "audit:plc-result-v2:BSL01",
        "value": "x",
    })
    assert r.status_code == 400


def test_cfg_form_returns_html_fragment(client, redis_client):
    import json
    redis_client.set("schema:plc-result-v2:BSL01", json.dumps({
        "type": "object",
        "properties": {"cycle_period_ms": {"type": "integer"}},
    }))
    redis_client.set("cfg:plc-result-v2:BSL01", json.dumps({"cycle_period_ms": 50}))
    r = client.get("/plugin/plc-result-v2/BSL01/cfg-form")
    assert r.status_code == 200
    assert '<input' in r.text
    assert 'name="cycle_period_ms"' in r.text
    assert 'value="50"' in r.text
    assert 'name="_cached_raw"' in r.text  # so save preserves optimistic concurrency
    assert "<html" not in r.text.lower()  # fragment, not full page


def test_cfg_form_404_when_missing(client):
    r = client.get("/plugin/nothing/X/cfg-form")
    assert r.status_code == 404


def test_inject_targets_route(client, redis_client):
    import json
    redis_client.set("schema:plc-result-v2:BSL01", json.dumps({
        "type": "object",
        "properties": {"plc_key": {"type": "string"}},
    }))
    redis_client.set("cfg:plc-result-v2:BSL01", json.dumps({
        "plc_key": "192.168.15.10",
        "get_result_key": "192.168.15.10_GET_RESULT",
    }))
    r = client.get("/plugin/plc-result-v2/BSL01/inject-targets")
    assert r.status_code == 200
    body = r.json()
    assert "plc_key" in body["cfg_fields"]
    assert "192.168.15.10_GET_RESULT" in body["get_result_keys"]
```

- [ ] **Step 3: Delete old templates**

```bash
cd /home/teruel/worktrees/plc-comm-ops-v1.1
rm plc_comm_ops/templates/list.html plc_comm_ops/templates/plugin.html
```

- [ ] **Step 4: Create placeholder `templates/dashboard.html`** (so the route test passes)

Create a minimal placeholder; full template is in Task 9:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Dashboard — PLC Comm Ops</title>
</head>
<body>
  <h1>Dashboard</h1>
  <p>Placeholder — full template in Task 9.</p>
</body>
</html>
```

- [ ] **Step 5: Create `plc_comm_ops/static/` placeholder**

```bash
mkdir -p plc_comm_ops/static
touch plc_comm_ops/static/.keep
```

- [ ] **Step 6: Run tests**

```bash
pytest tests/ -v 2>&1 | tail -10
```

Expected: route tests pass + new dashboard + inject tests pass. Total ≈ 38 (was) – 4 (removed) + 6 (added) = 40 passing.

- [ ] **Step 7: Commit**

```bash
git add plc_comm_ops/app.py plc_comm_ops/templates/dashboard.html \
        plc_comm_ops/static/.keep tests/test_routes.py
git rm plc_comm_ops/templates/list.html plc_comm_ops/templates/plugin.html
git commit -m "feat: replace v1 routes with dashboard + inject; remove list/detail pages"
```

---

## Track C — plc-comm-ops frontend

### Task 9: `dashboard.html` template + `dashboard.css` skeleton

**Files:**
- Modify: `plc_comm_ops/templates/dashboard.html` (replace placeholder)
- Create: `plc_comm_ops/static/dashboard.css`
- Create: `plc_comm_ops/templates/partials/_row_expanded.html` (the in-place expansion content)

- [ ] **Step 1: Write `dashboard.html`** (replace the placeholder):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dashboard — PLC Comm Ops</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.min.css" />
  <link rel="stylesheet" href="/static/dashboard.css" />
  <script src="https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.iife.min.js"></script>
</head>
<body>
  <header class="container">
    <nav>
      <ul><li><strong>PLC Comm Ops</strong> <small>v1.1 dashboard</small></li></ul>
    </nav>
  </header>
  <main class="container">
    <h2>Plugins</h2>
    <p><small>Polling every 1 s · click a row to expand · trendline window 2 min</small></p>
    <table id="plugin-table">
      <thead>
        <tr>
          <th></th>
          <th>Plugin / Instance</th>
          <th>State</th>
          <th class="num">Period</th>
          <th class="num">Cycle µs</th>
          <th class="num">Result</th>
          <th class="num">Errors</th>
          <th>Health</th>
        </tr>
      </thead>
      <tbody>
        {% for row in rows %}
        <tr class="summary" data-plugin="{{ row.plugin }}" data-instance="{{ row.instance }}">
          <td class="expander">▶</td>
          <td>{{ row.plugin }} / {{ row.instance }}</td>
          <td class="cell-state">{{ row.status.state or '—' }}</td>
          <td class="num cell-period">{{ row.status.cycle_period_ms or row.status.tick_ms or '—' }}</td>
          <td class="num cell-cycle">{{ row.status.last_cycle_us or '—' }}</td>
          <td class="num cell-result">{{ row.status.result_count or 0 }}</td>
          <td class="num cell-error">{{ row.status.error_count or 0 }}</td>
          <td class="cell-health"><span class="health-dot health-{{ row.health }}"></span> {{ row.health }}</td>
        </tr>
        <tr class="expanded hidden" data-plugin="{{ row.plugin }}" data-instance="{{ row.instance }}">
          <td colspan="8">
            <div class="expansion">
              <section class="trendlines">
                <h4>Trendline · last 2 min</h4>
                <div class="chart-cycle" data-metric="last_cycle_us"></div>
                <div class="chart-error" data-metric="error_count"></div>
              </section>
              <section class="live-tags">
                <h4>Live tags</h4>
                <div class="tag-grid">
                  {% for k, v in row.tags.items() %}
                  <div><strong>{{ k }}</strong>: <span class="tag-value" data-tag="{{ k }}">{{ v }}</span></div>
                  {% endfor %}
                </div>
              </section>
              <section class="config-edit">
                <h4>Config (edit)</h4>
                <form class="cfg-form" data-plugin="{{ row.plugin }}" data-instance="{{ row.instance }}"
                      action="/plugin/{{ row.plugin }}/{{ row.instance }}/save" method="post">
                  <!-- Populated by JS from /plugin/{p}/{i}/status's underlying schema fetch -->
                  <em>Form rendered on expand.</em>
                </form>
              </section>
              <section class="inject">
                <h4>Inject <small><mark>debug only — writes raw Redis values</mark></small></h4>
                <form class="inject-form" data-plugin="{{ row.plugin }}" data-instance="{{ row.instance }}">
                  <label>Target
                    <select class="inject-target"></select>
                  </label>
                  <label>Value
                    <input type="text" class="inject-value" />
                  </label>
                  <button type="submit">Inject</button>
                  <span class="inject-feedback"></span>
                </form>
              </section>
            </div>
          </td>
        </tr>
        {% endfor %}
        {% if not rows %}
        <tr><td colspan="8"><em>No plugins discovered yet.</em></td></tr>
        {% endif %}
      </tbody>
    </table>
  </main>
  <script type="module" src="/static/dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `dashboard.css`**

Create `plc_comm_ops/static/dashboard.css`:

```css
/* Compact table look */
#plugin-table { font-size: 0.92rem; }
#plugin-table th.num, #plugin-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
#plugin-table tr.summary { cursor: pointer; }
#plugin-table tr.summary:hover { background: var(--pico-secondary-background); }
#plugin-table tr.expanded.hidden { display: none; }
#plugin-table tr.expanded > td { padding: 0; background: var(--pico-card-background-color); }

.expansion { padding: 1rem 1.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; }
.expansion h4 { margin-top: 0; }
.expansion .trendlines { grid-column: 1 / -1; }
.expansion .chart-cycle, .expansion .chart-error { width: 100%; min-height: 120px; margin-bottom: 0.5rem; }
.expansion .tag-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.3rem 1rem; font-family: monospace; font-size: 0.85rem; }

.health-dot { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 50%; vertical-align: middle; }
.health-green { background: #0a0; }
.health-yellow { background: #dd0; }
.health-red { background: #d00; }

.inject-feedback.ok { color: #0a0; }
.inject-feedback.err { color: #d00; }
```

- [ ] **Step 3: Smoke-test the page renders**

```bash
cd /home/teruel/worktrees/plc-comm-ops-v1.1
source .venv/bin/activate
PORT=8124 REDIS_HOST=localhost python -m plc_comm_ops &
SERVER_PID=$!
sleep 2
curl -sS http://127.0.0.1:8124/ | head -40
curl -sS http://127.0.0.1:8124/static/dashboard.css | head -5
kill $SERVER_PID
```

Expected: HTML output contains `<table id="plugin-table">`; CSS GET returns valid CSS.

- [ ] **Step 4: Run the full test suite**

```bash
pytest tests/ -v 2>&1 | tail -5
```

Expected: still passing (no test changes in this task, but template change shouldn't break anything).

- [ ] **Step 5: Commit**

```bash
git add plc_comm_ops/templates/dashboard.html plc_comm_ops/static/dashboard.css
git commit -m "feat: dashboard.html template + dashboard.css (static UI shell)"
```

---

### Task 10: `dashboard.js` — polling, ring buffer, uPlot, inject form

**Files:**
- Create: `plc_comm_ops/static/dashboard.js`

This task has NO unit tests (JS, no test infra). Manual smoke after build.

- [ ] **Step 1: Write `dashboard.js`**

Create `plc_comm_ops/static/dashboard.js`:

```javascript
// dashboard.js — 1 Hz poll, ring buffer, uPlot trendlines, inject form.
// No build step; served as-is from FastAPI's StaticFiles mount.

const POLL_MS = 1000;
const BUFFER_LEN = 120;  // 2 min at 1 Hz

// state.rows is keyed by "plugin/instance"; each entry has the buffers + uPlot instances.
const state = {
  rows: new Map(),  // key → {ts:[], cycle:[], error:[], chartCycle:null, chartError:null, expanded:false}
};

function rowKey(plugin, instance) {
  return `${plugin}/${instance}`;
}

function ensureRow(plugin, instance) {
  const key = rowKey(plugin, instance);
  if (!state.rows.has(key)) {
    state.rows.set(key, {
      ts: [], cycle: [], error: [],
      chartCycle: null, chartError: null,
      expanded: false,
    });
  }
  return state.rows.get(key);
}

function pushSample(rowState, statusHash) {
  const now = Date.now() / 1000;
  rowState.ts.push(now);
  rowState.cycle.push(parseInt(statusHash.last_cycle_us, 10) || 0);
  rowState.error.push(parseInt(statusHash.error_count, 10) || 0);
  while (rowState.ts.length > BUFFER_LEN) {
    rowState.ts.shift();
    rowState.cycle.shift();
    rowState.error.shift();
  }
}

function updateCells(plugin, instance, row) {
  const tr = document.querySelector(
    `tr.summary[data-plugin="${plugin}"][data-instance="${instance}"]`
  );
  if (!tr) return;
  const s = row.status || {};
  tr.querySelector(".cell-state").textContent = s.state || "—";
  tr.querySelector(".cell-period").textContent =
    s.cycle_period_ms || s.tick_ms || "—";
  tr.querySelector(".cell-cycle").textContent = s.last_cycle_us ?? "—";
  tr.querySelector(".cell-result").textContent = s.result_count ?? 0;
  tr.querySelector(".cell-error").textContent = s.error_count ?? 0;
  const dot = tr.querySelector(".cell-health .health-dot");
  if (dot) {
    dot.className = `health-dot health-${row.health}`;
  }
  tr.querySelector(".cell-health").lastChild.textContent = ` ${row.health}`;
}

function updateTags(plugin, instance, tags) {
  const tr = document.querySelector(
    `tr.expanded[data-plugin="${plugin}"][data-instance="${instance}"]`
  );
  if (!tr) return;
  for (const [name, value] of Object.entries(tags || {})) {
    const el = tr.querySelector(`.tag-value[data-tag="${name}"]`);
    if (el) el.textContent = value;
  }
}

function makeChart(container, label, color) {
  const opts = {
    width: container.clientWidth || 400,
    height: 100,
    series: [
      {},
      { label, stroke: color, width: 1.5 },
    ],
    axes: [
      { space: 50 },
      { space: 30 },
    ],
    scales: { x: { time: true } },
    cursor: { drag: { x: false, y: false } },
  };
  return new uPlot(opts, [[], []], container);
}

function redrawCharts(plugin, instance) {
  const rs = ensureRow(plugin, instance);
  if (!rs.expanded) return;
  if (rs.chartCycle) {
    rs.chartCycle.setData([rs.ts, rs.cycle]);
  }
  if (rs.chartError) {
    rs.chartError.setData([rs.ts, rs.error]);
  }
}

async function poll() {
  try {
    const resp = await fetch("/api/dashboard.json");
    if (!resp.ok) return;
    const rows = await resp.json();
    for (const row of rows) {
      const rs = ensureRow(row.plugin, row.instance);
      pushSample(rs, row.status);
      updateCells(row.plugin, row.instance, row);
      updateTags(row.plugin, row.instance, row.tags);
      redrawCharts(row.plugin, row.instance);
    }
  } catch (err) {
    console.warn("poll failed:", err);
  }
}

function attachExpander(tr) {
  tr.addEventListener("click", () => {
    const plugin = tr.dataset.plugin;
    const instance = tr.dataset.instance;
    const expansionTr = document.querySelector(
      `tr.expanded[data-plugin="${plugin}"][data-instance="${instance}"]`
    );
    if (!expansionTr) return;
    expansionTr.classList.toggle("hidden");
    const isExpanded = !expansionTr.classList.contains("hidden");
    tr.querySelector(".expander").textContent = isExpanded ? "▼" : "▶";
    const rs = ensureRow(plugin, instance);
    rs.expanded = isExpanded;
    if (isExpanded && !rs.chartCycle) {
      const cycleDiv = expansionTr.querySelector(".chart-cycle");
      const errorDiv = expansionTr.querySelector(".chart-error");
      rs.chartCycle = makeChart(cycleDiv, "cycle µs", "#06c");
      rs.chartError = makeChart(errorDiv, "error_count", "#c30");
      hydrateCfgForm(expansionTr, plugin, instance);
      hydrateInjectForm(expansionTr, plugin, instance);
    }
  });
}

async function hydrateCfgForm(expansionTr, plugin, instance) {
  const form = expansionTr.querySelector(".cfg-form");
  try {
    const resp = await fetch(`/plugin/${plugin}/${instance}/cfg-form`);
    if (!resp.ok) {
      form.innerHTML = `<mark>Cfg load failed: HTTP ${resp.status}</mark>`;
      return;
    }
    form.innerHTML = await resp.text();
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const formData = new FormData(form);
      const r = await fetch(form.action, { method: "POST", body: formData, redirect: "manual" });
      const fb = document.createElement("span");
      fb.style.marginLeft = "0.5rem";
      if (r.status === 303 || r.ok) {
        fb.textContent = "Saved"; fb.style.color = "#0a0";
      } else if (r.status === 409) {
        fb.textContent = "Conflict — reloading"; fb.style.color = "#d00";
      } else {
        fb.textContent = `Error: HTTP ${r.status}`; fb.style.color = "#d00";
      }
      form.appendChild(fb);
      // Reload the form to pick up new _cached_raw on success or stale state on conflict
      if (r.status === 303 || r.ok || r.status === 409) {
        const fresh = await fetch(`/plugin/${plugin}/${instance}/cfg-form`);
        form.innerHTML = await fresh.text();
      }
      setTimeout(() => fb.remove?.(), 3000);
    });
  } catch (err) {
    form.innerHTML = `<mark>Cfg load failed: ${err.message}</mark>`;
  }
}

async function hydrateInjectForm(expansionTr, plugin, instance) {
  const form = expansionTr.querySelector(".inject-form");
  const select = form.querySelector(".inject-target");
  const valueInput = form.querySelector(".inject-value");
  const feedback = form.querySelector(".inject-feedback");

  try {
    const resp = await fetch(`/plugin/${plugin}/${instance}/inject-targets`);
    const targets = await resp.json();
    select.innerHTML = "";
    for (const f of targets.cfg_fields) {
      const opt = document.createElement("option");
      opt.value = JSON.stringify({ target_key: `cfg:${plugin}:${instance}`, target_field: f });
      opt.textContent = `cfg · ${f}`;
      select.appendChild(opt);
    }
    for (const f of targets.io_in_fields) {
      // io:in needs the plc_key — we read it from the cfg via dashboard data later.
      // For now, get cfg via dashboard.json synchronously is too clunky; we fetch separately:
      const cfgResp = await fetch("/api/dashboard.json");
      const allRows = await cfgResp.json();
      const ourRow = allRows.find((r) => r.plugin === plugin && r.instance === instance);
      const plcKey = ourRow?.status?.plc_key || ourRow?.tags?.plc_key;
      if (!plcKey) continue;
      const opt = document.createElement("option");
      opt.value = JSON.stringify({ target_key: `io:in:${plcKey}`, target_field: f });
      opt.textContent = `io:in · ${f}`;
      select.appendChild(opt);
    }
    for (const k of targets.get_result_keys) {
      const opt = document.createElement("option");
      opt.value = JSON.stringify({ target_key: k, target_field: null });
      opt.textContent = `get_result · ${k}`;
      select.appendChild(opt);
    }
  } catch (err) {
    feedback.textContent = `Target load failed: ${err.message}`;
    feedback.className = "inject-feedback err";
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const chosen = JSON.parse(select.value);
    const value = valueInput.value;
    if (!confirm(`Inject "${value}" to ${chosen.target_key}${chosen.target_field ? "." + chosen.target_field : ""}?`)) {
      return;
    }
    try {
      const resp = await fetch(`/plugin/${plugin}/${instance}/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...chosen, value }),
      });
      const body = await resp.json();
      if (resp.ok) {
        feedback.textContent = "OK";
        feedback.className = "inject-feedback ok";
        valueInput.value = "";
      } else {
        feedback.textContent = body.error || "Inject failed";
        feedback.className = "inject-feedback err";
      }
    } catch (err) {
      feedback.textContent = err.message;
      feedback.className = "inject-feedback err";
    }
  });
}

function init() {
  document.querySelectorAll("tr.summary").forEach(attachExpander);
  // Deep link
  if (location.hash.startsWith("#")) {
    const [plugin, instance] = location.hash.slice(1).split("/");
    const tr = document.querySelector(
      `tr.summary[data-plugin="${plugin}"][data-instance="${instance}"]`
    );
    if (tr) tr.click();
  }
  setInterval(poll, POLL_MS);
  poll();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
```

Note: the inline cfg-edit fetches the form HTML fragment from the `GET /plugin/{p}/{i}/cfg-form` route added in Task 8. The form's action is `/plugin/{p}/{i}/save` (the v1 route, unchanged). JS intercepts submit, sends FormData, and reloads the fragment on success or 409.

- [ ] **Step 2: Manual smoke**

```bash
cd /home/teruel/worktrees/plc-comm-ops-v1.1
source .venv/bin/activate

# Seed demo data in Redis
python <<'EOF'
import json, time, redis
r = redis.Redis(host="localhost", port=6379, decode_responses=False)
for p in ["cfg:plc-*", "schema:plc-*", "status:plc-*", "tags:plc-*", "audit:plc-*"]:
    keys = r.keys(p)
    if keys:
        r.delete(*keys)
r.set("schema:plc-result-v2:BSL01", json.dumps({
    "type": "object",
    "properties": {
        "plc_key": {"type": "string"},
        "cycle_period_ms": {"type": "integer"},
        "io_map": {"type": "object", "properties": {"request_result_off": {"type": "integer"}}},
    },
}))
r.set("cfg:plc-result-v2:BSL01", json.dumps({
    "plc_key": "192.168.15.10",
    "cycle_period_ms": 50,
    "io_map": {"request_result_off": 32},
    "get_result_confirm_key": "192.168.15.10_GET_RESULT_CONFIRM",
}))
r.hset("status:plc-result-v2:BSL01", mapping={
    "last_beat_ms": int(time.time() * 1000) - 200,
    "state": "IDLE", "error_count": 0, "result_count": 100,
    "cycle_period_ms": 50, "last_cycle_us": 4200,
})
r.hset("tags:plc-result-v2:BSL01", mapping={
    "state": "IDLE", "request_result": "0", "result_write_comp_plc": "0",
})
print("seeded BSL01")
EOF

# Run the server
PORT=8124 REDIS_HOST=localhost python -m plc_comm_ops &
SERVER_PID=$!
sleep 2

# Verify routes
curl -sS http://127.0.0.1:8124/healthz
echo
curl -sS http://127.0.0.1:8124/api/dashboard.json | python -m json.tool | head -25
echo
curl -sS http://127.0.0.1:8124/plugin/plc-result-v2/BSL01/inject-targets | python -m json.tool

# Manual: open http://127.0.0.1:8124/ in a browser, verify:
#   - BSL01 row visible with green dot
#   - Click row → expansion appears, charts initialize, tags grid shows fields
#   - After a few seconds, charts have data points
#   - Inject panel: pick a target, enter a value, click Inject → audit entry written
#   - Multiple rapid edits don't break the page

kill $SERVER_PID
```

Expected: all curls return 200, JSON has the seeded BSL01 row, manual browser inspection looks right.

- [ ] **Step 3: Commit**

```bash
git add plc_comm_ops/static/dashboard.js
git commit -m "feat: dashboard.js — 1 Hz poll + ring buffer + uPlot + inject form"
```

---

### Task 11: Manual smoke + push branch + open PR

**Files:** none — git/GitHub-side task.

- [ ] **Step 1: Run the full test suite one last time**

```bash
cd /home/teruel/worktrees/plc-comm-ops-v1.1
source .venv/bin/activate
pytest tests/ -v 2>&1 | tail -5
```

Expected: all green. ~40 tests total (38 baseline − 4 removed + 6 new dashboard + 6 new inject ≈ 46).

- [ ] **Step 2: Full container smoke**

```bash
cd /home/teruel/worktrees/plc-comm-ops-v1.1
docker build --ssh default -f plc-comm-ops.Dockerfile -t plc-comm-ops:v1.1-smoke . 2>&1 | tail -5
docker run --rm --network=host -e REDIS_HOST=127.0.0.1 -e PORT=8125 -d \
    --name plc-comm-ops-v1.1-smoke plc-comm-ops:v1.1-smoke
sleep 3
curl -sS http://127.0.0.1:8125/healthz
echo
curl -sS http://127.0.0.1:8125/ | grep -E '(plugin-table|dashboard)' | head -3
docker stop plc-comm-ops-v1.1-smoke
docker rmi plc-comm-ops:v1.1-smoke
```

Expected: container builds, healthz returns ok, root page contains plugin-table.

- [ ] **Step 3: Push branch**

```bash
git push -u origin feat/v1.1
```

If the classifier blocks: stop and escalate to user.

- [ ] **Step 4: Open draft PR**

```bash
gh pr create --draft --title "v1.1: dashboard + tags + trendlines + inject" --body "$(cat <<'EOF'
## Summary

Single-page expandable dashboard replacing v1's list+detail flow. All
plugins visible together with live decoded tag values, 2-min browser
trendlines (uPlot), and a manual inject panel gated to `cfg:*`,
`io:in:*`, and `get_result_*` Redis namespaces.

Spec: `docs/superpowers/specs/2026-05-13-plc-comm-ops-v1.1-design.md`
(JARVIS repo).

## Dependencies

- `strokmatic-comm-sdk` v0.2.1 (publish_tags helper). Tagged separately.
- `plc-result-v2` + `plc-monitor-camera-v2` must be running v0.2.1 SDK
  and calling `publish_tags()` per cycle for the dashboard to show tag
  values. Their respective branches must merge first.

## Routes added

- `GET /` — server-rendered dashboard skeleton
- `GET /api/dashboard.json` — polled at 1 Hz by JS
- `GET /plugin/{p}/{i}/inject-targets` — JSON list of writeable targets
- `POST /plugin/{p}/{i}/inject` — validated write + audit emit

## Routes removed

- `GET /plugin/{p}/{i}` — replaced by inline expansion in dashboard

## Acceptance gates

- [x] Unit + integration tests green
- [ ] Manual: dashboard shows all seeded plugins, row expands inline,
      trendlines populate within 1-2 polls, inject writes a value and
      audit emits
- [ ] Manual: form input focus is preserved across polls (no flicker)

## Out of scope (v1.2+)

- Inline cfg edit form (currently inject panel is the write path)
- Audit history viewer
- Auth
- Server-side trend storage

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
gh pr list --repo strokmatic/plc-comm-ops --state open
```

Expected: PR visible.

---

## Summary

11 tasks across three tracks:

| Track | Tasks | What |
|---|---|---|
| A — SDK + plugin tags | 1–4 | publish_tags + v0.2.1 + plc-result-v2 + camera v2 |
| B — plc-comm-ops backend | 5–8 | worktree + dashboard.py + inject.py + route swap |
| C — plc-comm-ops frontend | 9–10 | dashboard.html + .css + .js |
| D — Smoke + ship | 11 | container build + push + PR |

Order: Track A before Track C (the dashboard needs `tags:` keys); Track B can develop in parallel against synthetic data; Track C requires Track B's static-files mount.

## Test plan

- **Per-task TDD** as documented (47 SDK + 59/27 plugin runner + 40+ plc-comm-ops backend + 0 JS).
- **Manual smoke** in Task 10 and Task 11 verifies the browser experience.
- **Audit verification** (manual): after an inject, `redis-cli XRANGE audit:plc-result-v2:BSL01 - +` shows the entry.
