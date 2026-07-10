---
type: Implementation Plan
title: plc-comm-ops Implementation Plan
description: Three repos affected. Each track produces standalone working software.
timestamp: 2026-05-12
---

# plc-comm-ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the operator UI for the comm-layer plugin fleet: a FastAPI service that discovers plugins via Redis, renders Pydantic JSON Schemas as HTML forms with HTMX live status, and writes edits back through the SDK so live tuning takes effect within one plugin cycle.

**Architecture:** Three coordinated tracks landing in order: (A) SDK v0.2.0 adds `publish_schema()` + `reload()` + optimistic-concurrency `save()`. (B) Both shipped plugins (`plc-result-v2`, `plc-monitor-camera-v2`) pick up the new helpers — schema-publish at startup, cfg re-read every cycle. (C) The new `plc-comm-ops` repo is the FastAPI UI; it owns no business logic, only the operator HTTP surface. Each track depends on the previous one's commits being merged/tagged.

**Tech Stack:** Python 3.11, FastAPI, jinja2, HTMX (CDN), Pico.css (CDN), Pydantic v2, redis-py, pytest. No SPA, no npm.

**Spec:** `docs/superpowers/specs/2026-05-12-plc-comm-ops-design.md`

---

## Scope

Three repos affected. Each track produces standalone working software.

**Track A — SDK v0.2.0 additions** (`strokmatic-comm-sdk` repo, master branch)

**Track B — Plugin hot-reload pickups** (existing `v2/sdk-based` branches on `spotfusion-plc-result` and `spotfusion-plc-monitor-camera`)

**Track C — `plc-comm-ops` service** (new `strokmatic/plc-comm-ops` repo)

Out of scope (already documented in spec §16): auth, audit history viewer, client-side validation, bulk edits, HTTPS, role-based access, Prometheus exporter, multi-Redis.

---

## File Structure

### `strokmatic-comm-sdk` (Track A)

```
src/strokmatic_comm_sdk/
├── config.py            # MODIFY — add publish_schema, reload, save check_against_cached_raw
├── exceptions.py        # MODIFY — add ConfigConflictError
└── version.py           # MODIFY — bump if any compatibility-relevant change (none for v0.2.0; cfg JSON shape unchanged)

pyproject.toml           # MODIFY — version 0.1.0 → 0.2.0

tests/
├── test_config.py       # MODIFY — add tests for publish_schema, reload, optimistic-concurrency save
└── test_exceptions.py   # MODIFY — add ConfigConflictError test
```

### `spotfusion-plc-result` v2/sdk-based (Track B-1)

```
plc-result-v2.req                                          # MODIFY — bump SDK pin to v0.2.0
plc_result_v2/__main__.py                                  # MODIFY — call publish_schema() at startup
plc_result_v2/runner.py                                    # MODIFY — track _cfg_raw, reload() per cycle
tests/v2/test_runner_integration.py                        # MODIFY — assert schema gets published + reload picks up cfg change
```

### `spotfusion-plc-monitor-camera` v2/sdk-based (Track B-2)

Same files as Track B-1 but for the camera plugin (`plc_monitor_camera_v2/`, `tests/v2/`).

### `strokmatic/plc-comm-ops` (Track C)

```
plc-comm-ops/                                              # new repo, master branch
├── README.md
├── pyproject.toml
├── plc-comm-ops.Dockerfile
├── plc-comm-ops.yml
├── plc-comm-ops.req
├── cloudbuild.yaml
├── .github/workflows/ci.yml
├── plc_comm_ops/
│   ├── __init__.py
│   ├── __main__.py                                        # uvicorn entry
│   ├── app.py                                             # FastAPI app + 5 routes
│   ├── discovery.py                                       # scan cfg:plc-*:* keys
│   ├── schema.py                                          # JSON Schema → HTML form renderer
│   ├── status.py                                          # status:* reader + health logic + error-count window
│   ├── editor.py                                          # validate + save via SDK
│   ├── settings.py                                        # Pydantic-Settings env vars
│   └── templates/
│       ├── base.html
│       ├── list.html
│       ├── plugin.html
│       └── partials/
│           ├── status_badge.html
│           ├── status_panel.html
│           └── form_field.html
└── tests/
    ├── conftest.py
    ├── test_discovery.py
    ├── test_status.py
    ├── test_schema.py
    ├── test_editor.py
    └── test_routes.py
```

Module responsibilities are documented in spec §11.

---

## Tasks

### Task 1: SDK v0.2.0 — `publish_schema`, `reload`, optimistic-concurrency `save` (TDD)

**Files:**
- Modify: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk/src/strokmatic_comm_sdk/exceptions.py`
- Modify: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk/src/strokmatic_comm_sdk/config.py`
- Modify: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk/src/strokmatic_comm_sdk/__init__.py`
- Modify: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk/tests/test_config.py`
- Modify: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk/tests/test_exceptions.py`

- [ ] **Step 1: Set up worktree for SDK v0.2.0 work**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk
git fetch origin
git checkout -b v0.2.0-work origin/master
git worktree add /home/teruel/worktrees/sdk-v0.2.0 v0.2.0-work
cd /home/teruel/worktrees/sdk-v0.2.0
git branch --show-current
```

Expected: branch `v0.2.0-work`, worktree at `/home/teruel/worktrees/sdk-v0.2.0`.

- [ ] **Step 2: Install in editable mode**

```bash
cd /home/teruel/worktrees/sdk-v0.2.0
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/ -v 2>&1 | tail -3
```

Expected: all existing SDK tests pass (~25 tests).

- [ ] **Step 3: Write failing test for `ConfigConflictError`**

Append to `tests/test_exceptions.py`:

```python
def test_config_conflict_error_is_strokmatic_comm_error():
    from strokmatic_comm_sdk.exceptions import ConfigConflictError, StrokmaticCommError
    assert issubclass(ConfigConflictError, StrokmaticCommError)
    exc = ConfigConflictError("cfg changed since you loaded it")
    assert "changed" in str(exc)
```

Run: `pytest tests/test_exceptions.py -v` — expected: FAIL with `ImportError: cannot import name 'ConfigConflictError'`.

- [ ] **Step 4: Add `ConfigConflictError`**

In `src/strokmatic_comm_sdk/exceptions.py`, append after `SchemaVersionError`:

```python
class ConfigConflictError(StrokmaticCommError):
    """Raised when an optimistic-concurrency save fails because the
    config in Redis changed since the caller loaded it."""
```

Run: `pytest tests/test_exceptions.py -v` — expected: PASS.

- [ ] **Step 5: Write failing tests for `publish_schema` + `reload` + optimistic `save`**

Append to `tests/test_config.py`:

```python
import json

import pytest


# Use the existing _ExamplePluginConfig from tests/test_config.py — if it
# doesn't exist, define a minimal one here.
class _PCO(PluginConfig):
    """Test config for publish_schema / reload / optimistic-save tests."""
    name: str = "default"
    count: int = 0


def test_publish_schema_writes_json_schema_to_redis(redis_client):
    _PCO.publish_schema(redis_client, plugin_name="t-plugin", instance="i1")
    raw = redis_client.get("schema:t-plugin:i1")
    assert raw is not None
    schema = json.loads(raw)
    # Pydantic v2 emits an object with "properties" and "type"
    assert schema["type"] == "object"
    assert "name" in schema["properties"]
    assert "count" in schema["properties"]


def test_reload_returns_none_when_cfg_unchanged(redis_client):
    cfg = _PCO(name="alpha", count=5)
    cfg.save(redis_client, "t-plugin", "i1", actor="t")
    raw_first = redis_client.get("cfg:t-plugin:i1").decode()
    model, raw_returned = _PCO.reload(redis_client, "t-plugin", "i1", cached_raw=raw_first)
    assert model is None  # signals "no change"
    assert raw_returned == raw_first


def test_reload_returns_new_model_when_cfg_changed(redis_client):
    cfg1 = _PCO(name="alpha", count=1)
    cfg1.save(redis_client, "t-plugin", "i1", actor="t")
    raw_first = redis_client.get("cfg:t-plugin:i1").decode()
    # Operator-style edit via another save
    cfg2 = _PCO(name="beta", count=99)
    cfg2.save(redis_client, "t-plugin", "i1", actor="t")
    model, raw_new = _PCO.reload(redis_client, "t-plugin", "i1", cached_raw=raw_first)
    assert model is not None
    assert model.name == "beta"
    assert model.count == 99
    assert raw_new != raw_first


def test_reload_first_call_parses_and_returns_model(redis_client):
    cfg = _PCO(name="gamma", count=7)
    cfg.save(redis_client, "t-plugin", "i1", actor="t")
    model, raw = _PCO.reload(redis_client, "t-plugin", "i1", cached_raw=None)
    assert model is not None
    assert model.name == "gamma"


def test_reload_raises_when_no_cfg_in_redis(redis_client):
    from strokmatic_comm_sdk.exceptions import ConfigNotFoundError
    with pytest.raises(ConfigNotFoundError):
        _PCO.reload(redis_client, "t-plugin", "nonexistent", cached_raw=None)


def test_save_with_check_against_cached_raw_succeeds_when_unchanged(redis_client):
    cfg = _PCO(name="a", count=1)
    cfg.save(redis_client, "t-plugin", "i1", actor="t")
    raw_at_load = redis_client.get("cfg:t-plugin:i1").decode()
    new = _PCO(name="b", count=2)
    new.save(
        redis_client, "t-plugin", "i1", actor="t",
        check_against_cached_raw=raw_at_load,
    )
    assert _PCO.load(redis_client, "t-plugin", "i1").name == "b"


def test_save_with_check_against_cached_raw_raises_on_conflict(redis_client):
    from strokmatic_comm_sdk.exceptions import ConfigConflictError
    cfg = _PCO(name="a", count=1)
    cfg.save(redis_client, "t-plugin", "i1", actor="t")
    raw_at_load = redis_client.get("cfg:t-plugin:i1").decode()
    # Simulate another operator changing the cfg first
    interloper = _PCO(name="X", count=999)
    interloper.save(redis_client, "t-plugin", "i1", actor="other")
    # Now my save with the stale raw_at_load should fail
    mine = _PCO(name="b", count=2)
    with pytest.raises(ConfigConflictError):
        mine.save(
            redis_client, "t-plugin", "i1", actor="t",
            check_against_cached_raw=raw_at_load,
        )
    # Redis still has the interloper's value
    assert _PCO.load(redis_client, "t-plugin", "i1").name == "X"


def test_save_without_check_skips_optimistic_check(redis_client):
    """save() without check_against_cached_raw works like before — no conflict raised."""
    cfg = _PCO(name="a", count=1)
    cfg.save(redis_client, "t-plugin", "i1", actor="t")
    interloper = _PCO(name="X", count=999)
    interloper.save(redis_client, "t-plugin", "i1", actor="other")
    mine = _PCO(name="b", count=2)
    mine.save(redis_client, "t-plugin", "i1", actor="t")  # no check, succeeds
    assert _PCO.load(redis_client, "t-plugin", "i1").name == "b"
```

Run: `pytest tests/test_config.py -v` — expected: 8 FAIL (`publish_schema`, `reload`, `check_against_cached_raw` not implemented).

- [ ] **Step 6: Implement `publish_schema` + `reload` + optimistic `save`**

Replace the body of `src/strokmatic_comm_sdk/config.py` with:

```python
import json

import redis
from pydantic import BaseModel

from strokmatic_comm_sdk.audit import AuditLog
from strokmatic_comm_sdk.exceptions import ConfigConflictError, ConfigNotFoundError


class PluginConfig(BaseModel):
    """Base for plugin Pydantic configs. Subclasses define their own fields.

    Stored in Redis as a single JSON blob at cfg:<plugin>:<instance>.
    """

    schema_version: str = "1.0.0"

    @classmethod
    def load(cls, redis_client: redis.Redis, plugin_name: str, instance: str) -> "PluginConfig":
        key = f"cfg:{plugin_name}:{instance}"
        raw = redis_client.get(key)
        if raw is None:
            raise ConfigNotFoundError(f"No config at {key}")
        return cls.model_validate_json(raw)

    @classmethod
    def publish_schema(cls, redis_client: redis.Redis, plugin_name: str, instance: str) -> None:
        """Publish this config class's JSON Schema to schema:<plugin>:<instance>.

        Plugins call this once at startup so plc-comm-ops can render an
        editable HTML form for this plugin's config.
        """
        key = f"schema:{plugin_name}:{instance}"
        redis_client.set(key, json.dumps(cls.model_json_schema()))

    @classmethod
    def reload(
        cls,
        redis_client: redis.Redis,
        plugin_name: str,
        instance: str,
        *,
        cached_raw: str | None = None,
    ) -> tuple["PluginConfig | None", str]:
        """Cheap per-cycle cfg re-read for the runner's hot-reload path.

        Returns (model_or_None, raw_json):
          - If the cfg in Redis matches cached_raw: returns (None, cached_raw).
            Caller keeps using the previous model — no Pydantic re-parse.
          - Else: parses and returns (new_model, new_raw_json).

        The caller stores raw_json and passes it back next cycle.
        """
        key = f"cfg:{plugin_name}:{instance}"
        raw_bytes = redis_client.get(key)
        if raw_bytes is None:
            raise ConfigNotFoundError(f"No config at {key}")
        raw = raw_bytes.decode() if isinstance(raw_bytes, bytes) else raw_bytes
        if cached_raw is not None and raw == cached_raw:
            return None, cached_raw
        return cls.model_validate_json(raw), raw

    def save(
        self,
        redis_client: redis.Redis,
        plugin_name: str,
        instance: str,
        actor: str,
        *,
        check_against_cached_raw: str | None = None,
    ) -> None:
        """Persist this config and emit an audit-stream entry.

        If `check_against_cached_raw` is provided, performs optimistic
        concurrency: rejects the save with ConfigConflictError if the cfg
        in Redis differs from that snapshot (i.e., someone else edited it
        since the caller loaded it).
        """
        key = f"cfg:{plugin_name}:{instance}"
        new_raw = self.model_dump_json()

        if check_against_cached_raw is not None:
            # WATCH/MULTI/EXEC for atomic check-and-set.
            with redis_client.pipeline() as pipe:
                while True:
                    try:
                        pipe.watch(key)
                        current = pipe.get(key)
                        current_str = (
                            current.decode() if isinstance(current, bytes)
                            else (current or "")
                        )
                        if current_str != check_against_cached_raw:
                            pipe.unwatch()
                            raise ConfigConflictError(
                                f"cfg:{plugin_name}:{instance} changed since you loaded it"
                            )
                        pipe.multi()
                        pipe.set(key, new_raw)
                        pipe.execute()
                        break
                    except redis.WatchError:
                        # Someone else wrote between WATCH and EXEC — retry the
                        # whole compare.
                        continue
            old_repr = check_against_cached_raw
        else:
            old_raw = redis_client.get(key)
            old_repr = old_raw.decode() if old_raw is not None else None
            redis_client.set(key, new_raw)

        AuditLog(redis_client, plugin_name, instance).log_change(
            field_path="<full_doc>",
            old=old_repr,
            new=new_raw,
            actor=actor,
        )
```

- [ ] **Step 7: Add new exception + classes to `__init__.py`**

In `src/strokmatic_comm_sdk/__init__.py`, add `ConfigConflictError` to imports and `__all__`:

```python
from strokmatic_comm_sdk.audit import AuditLog
from strokmatic_comm_sdk.bus import FakePLCBus, PLCBus
from strokmatic_comm_sdk.config import PluginConfig
from strokmatic_comm_sdk.exceptions import (
    ConfigConflictError,
    ConfigNotFoundError,
    LaneRangeError,
    SchemaVersionError,
    StrokmaticCommError,
)
from strokmatic_comm_sdk.heartbeat import Heartbeat
from strokmatic_comm_sdk.version import SDK_SCHEMA_VERSION, enforce_schema_version

__all__ = [
    "AuditLog",
    "ConfigConflictError",
    "ConfigNotFoundError",
    "FakePLCBus",
    "Heartbeat",
    "LaneRangeError",
    "PLCBus",
    "PluginConfig",
    "SDK_SCHEMA_VERSION",
    "SchemaVersionError",
    "StrokmaticCommError",
    "enforce_schema_version",
]
```

- [ ] **Step 8: Run all SDK tests**

```bash
cd /home/teruel/worktrees/sdk-v0.2.0
source .venv/bin/activate
pytest tests/ -v 2>&1 | tail -10
```

Expected: existing tests still pass + 8 new tests added in step 5 now pass. Total ~33 tests.

- [ ] **Step 9: Commit**

```bash
git add src/strokmatic_comm_sdk/config.py src/strokmatic_comm_sdk/exceptions.py \
        src/strokmatic_comm_sdk/__init__.py tests/test_config.py tests/test_exceptions.py
git commit -m "feat(v0.2.0): add publish_schema + reload + optimistic-concurrency save"
```

---

### Task 2: SDK — bump version to v0.2.0, tag, push

**Files:**
- Modify: `/home/teruel/worktrees/sdk-v0.2.0/pyproject.toml`

- [ ] **Step 1: Bump version**

Edit `pyproject.toml`. Find the line `version = "0.1.0"` in `[project]` and change to:

```toml
version = "0.2.0"
```

- [ ] **Step 2: Verify everything still imports + tests pass**

```bash
cd /home/teruel/worktrees/sdk-v0.2.0
source .venv/bin/activate
pip install -e ".[dev]"  # picks up new version
python -c "import strokmatic_comm_sdk; print(strokmatic_comm_sdk.__name__)"
pytest tests/ 2>&1 | tail -3
```

Expected: import works, all tests pass.

- [ ] **Step 3: Commit version bump**

```bash
git add pyproject.toml
git commit -m "chore: bump version 0.1.0 → 0.2.0"
```

- [ ] **Step 4: Merge into master locally + tag**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-comm-sdk
git fetch origin
git checkout master
git pull --ff-only origin master
git merge --no-ff v0.2.0-work -m "merge v0.2.0-work: publish_schema + reload + optimistic save"
git tag -a v0.2.0 -m "v0.2.0 — publish_schema, reload, optimistic-concurrency save"
```

- [ ] **Step 5: Push master + tag**

```bash
git push origin master
git push origin v0.2.0
```

Expected: push succeeds. `gh release view v0.2.0 --repo strokmatic/strokmatic-comm-sdk` (optional, for sanity) shows the tag.

- [ ] **Step 6: Verify the tag is fetchable**

```bash
pip download "strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.2.0" --no-deps -d /tmp/sdk-download-check
ls /tmp/sdk-download-check/
```

Expected: a tarball appears. Cleanup: `rm -rf /tmp/sdk-download-check`.

---

### Task 3: plc-result-v2 — adopt SDK v0.2.0 (publish_schema + hot-reload)

**Files:**
- Modify: `/home/teruel/worktrees/plc-result-v2/plc-result-v2.req`
- Modify: `/home/teruel/worktrees/plc-result-v2/pyproject.toml`
- Modify: `/home/teruel/worktrees/plc-result-v2/plc_result_v2/__main__.py`
- Modify: `/home/teruel/worktrees/plc-result-v2/plc_result_v2/runner.py`
- Modify: `/home/teruel/worktrees/plc-result-v2/tests/v2/test_runner_integration.py`

- [ ] **Step 1: Bump SDK pin to v0.2.0**

In `plc-result-v2.req`, change:
```
strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.1.0
```
to:
```
strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.2.0
```

Same change in `pyproject.toml`'s `dependencies = [...]` block.

```bash
cd /home/teruel/worktrees/plc-result-v2
source .venv/bin/activate
pip install -e .  # re-resolves SDK at v0.2.0
python -c "from strokmatic_comm_sdk import ConfigConflictError; print('ok')"
```

Expected: `ok` (confirms v0.2.0 SDK is loaded).

- [ ] **Step 2: Write failing tests for schema-publish + hot-reload**

Append to `tests/v2/test_runner_integration.py`:

```python
import json


def test_runner_publishes_schema_at_startup(fake_bus, redis_client, cfg):
    """Runner publishes its config JSON Schema to schema:<plugin>:<inst> on init."""
    Runner(cfg, fake_bus, redis_client)
    raw = redis_client.get(f"schema:plc-result-v2:{cfg.cell}")
    assert raw is not None
    schema = json.loads(raw)
    assert schema["type"] == "object"
    # The cycle_period_ms field must be in the published schema
    assert "cycle_period_ms" in schema["properties"]


def test_runner_picks_up_cfg_change_on_next_cycle(fake_bus, redis_client, cfg):
    """When cfg is edited in Redis, the runner picks it up within one cycle."""
    runner = Runner(cfg, fake_bus, redis_client)
    runner.run_one_cycle()
    # Operator edits cfg.cycle_period_ms via plc-comm-ops (we simulate the write directly)
    new_cfg = cfg.model_copy(update={"cycle_period_ms": 250})
    new_cfg.save(redis_client, "plc-result-v2", cfg.cell, actor="test-op")
    # Run another cycle — runner should adopt the new cfg
    runner.run_one_cycle()
    h = redis_client.hgetall(f"status:plc-result-v2:{cfg.cell}")
    assert h[b"cycle_period_ms"] == b"250"


def test_runner_keeps_cached_cfg_when_unchanged(fake_bus, redis_client, cfg):
    """If cfg hasn't changed, runner reuses the cached parsed model (perf)."""
    runner = Runner(cfg, fake_bus, redis_client)
    runner.run_one_cycle()
    raw_before = runner._cfg_raw
    runner.run_one_cycle()
    raw_after = runner._cfg_raw
    assert raw_before == raw_after  # same string, no re-parse triggered
```

Run: `pytest tests/v2/test_runner_integration.py -v` — expected: 3 new tests FAIL (`Runner` doesn't publish schema, `_cfg_raw` attribute missing, reload not called).

- [ ] **Step 3: Update `__main__.py` to publish schema at startup**

In `plc_result_v2/__main__.py`, after the `cfg = PlcResultV2Config.load(...)` line, add:

```python
    # Publish JSON Schema for plc-comm-ops to discover and render an HTML form.
    PlcResultV2Config.publish_schema(io_redis, plugin_name="plc-result-v2", instance=cell)
    logger.info("published JSON Schema for cell=%s", cell)
```

- [ ] **Step 4: Update runner to publish schema + reload per cycle**

In `plc_result_v2/runner.py`, modify `Runner.__init__` to publish the schema (so unit tests using `Runner` directly also publish) and initialize `_cfg_raw`:

```python
    def __init__(
        self,
        cfg: PlcResultV2Config,
        bus: _BusLike,
        app_redis: redis.Redis,
    ):
        self.cfg = cfg
        self.bus = bus
        self.app_redis = app_redis
        self._validate_lane_range()
        self._gr = GetResultClient(app_redis, cfg)
        self._state: State = initial_state()
        self._status_key = f"status:{_PLUGIN_NAME}:{cfg.cell}"
        self._result_count = 0
        self._tryout_count = 0
        self._error_count = 0
        # NEW: cache the raw JSON of the most-recently-applied cfg, for hot-reload.
        self._cfg_raw: str | None = None
        # NEW: publish the schema so plc-comm-ops can render an HTML form.
        type(cfg).publish_schema(app_redis, _PLUGIN_NAME, cfg.cell)
        # On startup, mirror cycle_period_ms into the status hash so dashboards see it.
        app_redis.hset(self._status_key, "cycle_period_ms", cfg.cycle_period_ms)
```

Then at the top of `run_one_cycle()`, before reading the bus:

```python
    def run_one_cycle(self) -> None:
        """One iteration of the main loop. Called from run_forever() or tests."""
        t0 = time.perf_counter()
        try:
            # 1. Hot-reload cfg if Redis has a newer version.
            new_cfg, self._cfg_raw = type(self.cfg).reload(
                self.app_redis, _PLUGIN_NAME, self.cfg.cell,
                cached_raw=self._cfg_raw,
            )
            if new_cfg is not None:
                self.cfg = new_cfg

            # 2. (existing) Read entire prefix of io:in so absolute offsets work in decode.
            raw_in = self.bus.read_lane(0, 48)
            in_lane = decode_in(raw_in, self.cfg.io_map)

            # ... rest of run_one_cycle unchanged ...
```

The "rest of run_one_cycle unchanged" means: keep the existing `confirmed`, `step`, action-application, counter, write-lane, heartbeat-and-status logic intact. Only the very top gets the new reload prelude.

Note: on the first cycle, the test `test_runner_keeps_cached_cfg_when_unchanged` is racy IF the operator edits cfg between two `run_one_cycle()` calls — but it doesn't (the test makes no edit), so `_cfg_raw` stays the same. The test is sound.

However the test `test_runner_picks_up_cfg_change_on_next_cycle` requires the runner to have a valid `_cfg_raw` before the cfg edit. The first `run_one_cycle()` populates `_cfg_raw` with the original cfg's JSON (since `cached_raw=None` → returns `(model, raw)`; we set `self._cfg_raw = raw`). Good.

But there's a subtler issue: for the test to seed the cfg in Redis before constructing the Runner, it needs a pre-existing cfg key. The test fixture currently doesn't `cfg.save()` before instantiating Runner. Add a save in the test setup, or modify the runner to handle missing cfg gracefully. Cleaner: update the test:

In the new tests, prepend `cfg.save(redis_client, "plc-result-v2", cfg.cell, actor="t")` before `Runner(cfg, ...)`:

```python
def test_runner_publishes_schema_at_startup(fake_bus, redis_client, cfg):
    cfg.save(redis_client, "plc-result-v2", cfg.cell, actor="test-setup")
    Runner(cfg, fake_bus, redis_client)
    # ... (rest as written above) ...
```

Apply the same `cfg.save(...)` prefix to the other two new tests.

- [ ] **Step 5: Run tests to verify pass**

```bash
cd /home/teruel/worktrees/plc-result-v2
source .venv/bin/activate
pytest tests/v2/ -v 2>&1 | tail -10
```

Expected: all 54 existing tests still pass + 3 new tests pass = 57 total. No regressions.

- [ ] **Step 6: Commit**

```bash
git add plc-result-v2.req pyproject.toml plc_result_v2/__main__.py \
        plc_result_v2/runner.py tests/v2/test_runner_integration.py
git commit -m "feat(v2): pick up SDK v0.2.0 — publish schema + hot-reload cfg per cycle"
```

---

### Task 4: camera v2 — adopt SDK v0.2.0 (publish_schema + hot-reload)

**Files:** Same pattern as Task 3 but in `/home/teruel/worktrees/plc-monitor-camera-v2/`:
- Modify: `plc-monitor-camera-v2.req`
- Modify: `pyproject.toml`
- Modify: `plc_monitor_camera_v2/__main__.py`
- Modify: `plc_monitor_camera_v2/runner.py`
- Modify: `tests/v2/test_runner_integration.py` (or whichever test file owns the runner integration tests)

- [ ] **Step 1: Bump SDK pin to v0.2.0** in `.req` and `pyproject.toml` (same edits as Task 3 Step 1, paths adjusted).

```bash
cd /home/teruel/worktrees/plc-monitor-camera-v2
source .venv/bin/activate 2>/dev/null || python -m venv .venv && source .venv/bin/activate
pip install -e .
python -c "from strokmatic_comm_sdk import ConfigConflictError; print('ok')"
```

- [ ] **Step 2: Add the same three tests** (`test_runner_publishes_schema_at_startup`, `test_runner_picks_up_cfg_change_on_next_cycle`, `test_runner_keeps_cached_cfg_when_unchanged`) to camera v2's runner integration test file, adjusted for:
  - `plugin_name="plc-monitor-camera-v2"` instead of `"plc-result-v2"`
  - `CameraPluginConfig` instead of `PlcResultV2Config`
  - The schema-properties assertion checks `io_map` or whatever well-known fields camera v2's config has — open `plc_monitor_camera_v2/config.py` first to see the field names; pick one that's a public field (e.g., `handshake_timeout_ms` or `io_map`).

Run: `pytest tests/v2/test_runner_integration.py -v` — expected: 3 new tests FAIL.

- [ ] **Step 3: Same `Runner.__init__` update** as Task 3 Step 4:
  - Add `self._cfg_raw: str | None = None`
  - Add `type(cfg).publish_schema(app_redis, _PLUGIN_NAME, ...)` (the camera plugin's runner uses similar attribute names; mirror them — e.g., if the plugin's instance key is `cfg.cell`, use the same; if it's something else, adapt).

- [ ] **Step 4: Same `run_one_cycle()` top-of-loop prelude** as Task 3:

```python
new_cfg, self._cfg_raw = type(self.cfg).reload(
    self.app_redis, _PLUGIN_NAME, <instance_key>,
    cached_raw=self._cfg_raw,
)
if new_cfg is not None:
    self.cfg = new_cfg
```

- [ ] **Step 5: Same `__main__.py` schema-publish call** as Task 3 Step 3.

- [ ] **Step 6: Run all tests**

```bash
pytest tests/v2/ -v 2>&1 | tail -10
```

Expected: all camera v2 tests pass, including 3 new ones.

- [ ] **Step 7: Commit**

```bash
git add plc-monitor-camera-v2.req pyproject.toml \
        plc_monitor_camera_v2/__main__.py plc_monitor_camera_v2/runner.py \
        tests/v2/test_runner_integration.py
git commit -m "feat(v2): pick up SDK v0.2.0 — publish schema + hot-reload cfg per cycle"
```

---

### Task 5: Create plc-comm-ops repo + scaffold

**Files:**
- New repo on GitHub: `strokmatic/plc-comm-ops` (private)
- Worktree at: `/home/teruel/worktrees/plc-comm-ops/`
- Create: `pyproject.toml`, `plc-comm-ops.req`, `plc_comm_ops/__init__.py`, `plc_comm_ops/settings.py`, `tests/conftest.py`

- [ ] **Step 1: Create the GitHub repo + initial commit**

```bash
gh repo create strokmatic/plc-comm-ops --private --description "Operator UI for the comm-layer plugin fleet (cfg edit + minimal status)" --confirm
mkdir -p /home/teruel/worktrees/plc-comm-ops
cd /home/teruel/worktrees/plc-comm-ops
git init -b master
git remote add origin git@github.com:strokmatic/plc-comm-ops.git
```

- [ ] **Step 2: Create `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=64"]
build-backend = "setuptools.build_meta"

[project]
name = "plc-comm-ops"
version = "0.1.0"
description = "Operator UI for the strokmatic comm-layer plugin fleet (cfg edit + minimal status)"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110,<1",
    "uvicorn[standard]>=0.27,<1",
    "jinja2>=3.1",
    "pydantic>=2.5,<3",
    "pydantic-settings>=2.1",
    "redis>=5,<6",
    "strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.2.0",
]

[project.optional-dependencies]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.setuptools.packages.find]
include = ["plc_comm_ops*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 3: Create `plc-comm-ops.req`** (deployment mirror of pyproject deps for the Dockerfile):

```
fastapi>=0.110,<1
uvicorn[standard]>=0.27,<1
jinja2>=3.1
pydantic>=2.5,<3
pydantic-settings>=2.1
redis>=5,<6
strokmatic-comm-sdk @ git+ssh://git@github.com/strokmatic/strokmatic-comm-sdk.git@v0.2.0
```

- [ ] **Step 4: Create the package skeleton**

```bash
mkdir -p plc_comm_ops/templates/partials tests
touch plc_comm_ops/__init__.py tests/__init__.py
```

Create `plc_comm_ops/settings.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env-var driven config for plc-comm-ops itself."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    redis_host: str = "localhost"
    redis_port: int = 6379

    heartbeat_fresh_s: int = 5
    heartbeat_stale_s: int = 60
    error_window_s: int = 300

    port: int = 8000
    log_level: str = "INFO"


def get_settings() -> Settings:
    return Settings()
```

Create `tests/conftest.py`:

```python
import os

import pytest
import redis as redis_lib


@pytest.fixture(scope="session")
def redis_client():
    host = os.environ.get("REDIS_HOST", "localhost")
    port = int(os.environ.get("REDIS_PORT", "6379"))
    client = redis_lib.Redis(host=host, port=port, decode_responses=False)
    client.ping()
    yield client
    client.close()


@pytest.fixture(autouse=True)
def clean_redis(redis_client):
    """Wipe plc-* keys before every test for isolation."""
    keys = (
        redis_client.keys("io:*")
        + redis_client.keys("cfg:*")
        + redis_client.keys("status:*")
        + redis_client.keys("audit:*")
        + redis_client.keys("schema:*")
    )
    if keys:
        redis_client.delete(*keys)
    yield
```

- [ ] **Step 5: Install + smoke-import**

```bash
cd /home/teruel/worktrees/plc-comm-ops
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -c "from plc_comm_ops.settings import get_settings; s = get_settings(); print(s.redis_host, s.port)"
```

Expected: `localhost 8000`.

- [ ] **Step 6: First commit**

```bash
git add pyproject.toml plc-comm-ops.req plc_comm_ops/ tests/
git commit -m "chore: scaffold plc-comm-ops repo (pyproject, settings, conftest)"
```

---

### Task 6: `discovery.py` — scan cfg:plc-*:* keys (TDD)

**Files:**
- Create: `plc_comm_ops/discovery.py`
- Create: `tests/test_discovery.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_discovery.py`:

```python
import pytest

from plc_comm_ops.discovery import discover_plugins


def test_discover_returns_empty_when_no_cfg_keys(redis_client):
    assert discover_plugins(redis_client) == []


def test_discover_finds_single_plugin_instance(redis_client):
    redis_client.set("cfg:plc-result-v2:BSL01", b"{}")
    result = discover_plugins(redis_client)
    assert result == [("plc-result-v2", "BSL01")]


def test_discover_returns_sorted_unique_tuples(redis_client):
    redis_client.set("cfg:plc-result-v2:BSL02", b"{}")
    redis_client.set("cfg:plc-result-v2:BSL01", b"{}")
    redis_client.set("cfg:plc-monitor-camera-v2:BSL01", b"{}")
    result = discover_plugins(redis_client)
    assert result == [
        ("plc-monitor-camera-v2", "BSL01"),
        ("plc-result-v2", "BSL01"),
        ("plc-result-v2", "BSL02"),
    ]


def test_discover_ignores_non_plc_prefixed_keys(redis_client):
    redis_client.set("cfg:plc-result-v2:BSL01", b"{}")
    redis_client.set("cfg:something-else:X", b"{}")  # not plc-* — must be ignored
    result = discover_plugins(redis_client)
    assert result == [("plc-result-v2", "BSL01")]


def test_discover_skips_keys_with_malformed_structure(redis_client):
    redis_client.set("cfg:plc-bad", b"{}")  # missing :<inst>
    redis_client.set("cfg:plc-result-v2:BSL01", b"{}")  # good
    result = discover_plugins(redis_client)
    assert result == [("plc-result-v2", "BSL01")]
```

Run: `pytest tests/test_discovery.py -v` — expected: ImportError.

- [ ] **Step 2: Implement `discovery.py`**

```python
import redis


def discover_plugins(redis_client: redis.Redis) -> list[tuple[str, str]]:
    """Scan cfg:plc-*:* keys and return [(plugin_name, instance), ...] sorted.

    We restrict to keys matching `cfg:plc-*:*` so other Redis namespaces
    (test scratch, other apps) don't pollute the list.
    """
    raw_keys = redis_client.keys("cfg:plc-*:*")
    results: list[tuple[str, str]] = []
    for raw in raw_keys:
        key = raw.decode() if isinstance(raw, bytes) else raw
        # key shape: cfg:<plugin>:<instance>
        parts = key.split(":", 2)
        if len(parts) != 3:
            continue
        _, plugin, instance = parts
        if not plugin.startswith("plc-"):
            continue
        results.append((plugin, instance))
    # Sort + dedup
    return sorted(set(results))
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_discovery.py -v
```

Expected: 5/5 PASS.

- [ ] **Step 4: Commit**

```bash
git add plc_comm_ops/discovery.py tests/test_discovery.py
git commit -m "feat: discovery — scan cfg:plc-*:* keys"
```

---

### Task 7: `status.py` — read status:*, compute health (TDD)

**Files:**
- Create: `plc_comm_ops/status.py`
- Create: `tests/test_status.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_status.py`:

```python
import time

import pytest

from plc_comm_ops.status import StatusTracker, Health


@pytest.fixture
def tracker(redis_client):
    return StatusTracker(redis_client, fresh_s=5, stale_s=60, error_window_s=300)


def _seed(redis_client, plugin, inst, *, last_beat_ms=None, error_count=0, **extra):
    if last_beat_ms is None:
        last_beat_ms = int(time.time() * 1000)
    redis_client.hset(
        f"status:{plugin}:{inst}",
        mapping={"last_beat_ms": last_beat_ms, "error_count": error_count, **extra},
    )


def test_missing_status_key_is_red(tracker):
    assert tracker.health_color("plc-result-v2", "MISSING") == Health.RED


def test_fresh_heartbeat_zero_errors_is_green(tracker, redis_client):
    _seed(redis_client, "plc-result-v2", "BSL01", error_count=0)
    assert tracker.health_color("plc-result-v2", "BSL01") == Health.GREEN


def test_stale_heartbeat_30s_is_yellow(tracker, redis_client):
    stale = int(time.time() * 1000) - 30_000
    _seed(redis_client, "plc-result-v2", "BSL01", last_beat_ms=stale)
    assert tracker.health_color("plc-result-v2", "BSL01") == Health.YELLOW


def test_stale_heartbeat_90s_is_red(tracker, redis_client):
    very_stale = int(time.time() * 1000) - 90_000
    _seed(redis_client, "plc-result-v2", "BSL01", last_beat_ms=very_stale)
    assert tracker.health_color("plc-result-v2", "BSL01") == Health.RED


def test_recent_error_increment_makes_health_yellow(tracker, redis_client):
    _seed(redis_client, "plc-result-v2", "BSL01", error_count=0)
    assert tracker.health_color("plc-result-v2", "BSL01") == Health.GREEN
    _seed(redis_client, "plc-result-v2", "BSL01", error_count=1)
    assert tracker.health_color("plc-result-v2", "BSL01") == Health.YELLOW


def test_no_increment_in_window_returns_to_green(tracker, redis_client):
    """If error_count was 5 a long time ago but stable now, status is green."""
    _seed(redis_client, "plc-result-v2", "BSL01", error_count=5)
    # First observation seeds the window — no prior history, so green (no increment).
    assert tracker.health_color("plc-result-v2", "BSL01") == Health.GREEN


def test_panel_data_returns_all_status_fields(tracker, redis_client):
    _seed(
        redis_client, "plc-result-v2", "BSL01",
        error_count=2, state=b"IDLE", result_count=42, last_cycle_us=750,
        cycle_period_ms=50,
    )
    data = tracker.panel_data("plc-result-v2", "BSL01")
    assert data["state"] == "IDLE"
    assert data["error_count"] == 2
    assert data["result_count"] == 42
    assert data["last_cycle_us"] == 750
    assert data["cycle_period_ms"] == 50
    assert "last_beat_ms" in data
    assert "age_s" in data  # derived: how old is the heartbeat


def test_panel_data_returns_none_when_status_missing(tracker):
    assert tracker.panel_data("plc-result-v2", "MISSING") is None
```

Run: `pytest tests/test_status.py -v` — expected: 8 FAIL (`StatusTracker`, `Health` not defined).

- [ ] **Step 2: Implement `status.py`**

```python
import time
from collections import defaultdict
from enum import Enum

import redis


class Health(str, Enum):
    GREEN = "green"
    YELLOW = "yellow"
    RED = "red"


class StatusTracker:
    """Reads status:* hashes from Redis and computes a health color.

    Maintains an in-memory sliding window of (timestamp, error_count) per
    plugin instance so we can detect "error_count incremented within the
    last error_window_s seconds."
    """

    def __init__(
        self,
        redis_client: redis.Redis,
        *,
        fresh_s: int = 5,
        stale_s: int = 60,
        error_window_s: int = 300,
    ):
        self.r = redis_client
        self.fresh_s = fresh_s
        self.stale_s = stale_s
        self.error_window_s = error_window_s
        # _err_history[(plugin, inst)] = [(observed_at_epoch_s, error_count), ...]
        self._err_history: dict[tuple[str, str], list[tuple[float, int]]] = defaultdict(list)

    def _read_status(self, plugin: str, inst: str) -> dict | None:
        raw = self.r.hgetall(f"status:{plugin}:{inst}")
        if not raw:
            return None
        result: dict = {}
        for k, v in raw.items():
            key = k.decode() if isinstance(k, bytes) else k
            val = v.decode() if isinstance(v, bytes) else v
            # Numerics where it makes sense
            if key in {"last_beat_ms", "last_cycle_us", "result_count",
                       "tryout_count", "error_count", "cycle_period_ms"}:
                try:
                    result[key] = int(val)
                except ValueError:
                    result[key] = val
            else:
                result[key] = val
        return result

    def _error_increment_recent(self, plugin: str, inst: str, current_error_count: int) -> bool:
        """Track error_count history; return True if it increased within error_window_s."""
        now = time.time()
        key = (plugin, inst)
        history = self._err_history[key]
        # Prune entries older than the window
        cutoff = now - self.error_window_s
        history[:] = [(t, c) for (t, c) in history if t >= cutoff]
        # If we have any history, compare against the oldest still-in-window count
        recent_increment = False
        if history:
            oldest_in_window_count = history[0][1]
            if current_error_count > oldest_in_window_count:
                recent_increment = True
        # Record the current observation
        history.append((now, current_error_count))
        return recent_increment

    def health_color(self, plugin: str, inst: str) -> Health:
        s = self._read_status(plugin, inst)
        if s is None:
            return Health.RED
        last_beat_ms = s.get("last_beat_ms")
        if last_beat_ms is None or not isinstance(last_beat_ms, int):
            return Health.RED
        age_s = (int(time.time() * 1000) - last_beat_ms) / 1000.0
        if age_s > self.stale_s:
            return Health.RED
        error_count = s.get("error_count", 0)
        if not isinstance(error_count, int):
            error_count = 0
        error_recent = self._error_increment_recent(plugin, inst, error_count)
        if age_s > self.fresh_s or error_recent:
            return Health.YELLOW
        return Health.GREEN

    def panel_data(self, plugin: str, inst: str) -> dict | None:
        """Full status data for the detail-page panel."""
        s = self._read_status(plugin, inst)
        if s is None:
            return None
        last_beat_ms = s.get("last_beat_ms")
        if isinstance(last_beat_ms, int):
            s["age_s"] = (int(time.time() * 1000) - last_beat_ms) / 1000.0
        return s
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_status.py -v
```

Expected: 8/8 PASS.

- [ ] **Step 4: Commit**

```bash
git add plc_comm_ops/status.py tests/test_status.py
git commit -m "feat: status reader + health logic (green/yellow/red with error-count window)"
```

---

### Task 8: `schema.py` — JSON Schema → HTML form renderer (TDD)

**Files:**
- Create: `plc_comm_ops/schema.py`
- Create: `tests/test_schema.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_schema.py`:

```python
import pytest

from plc_comm_ops.schema import RenderResult, render_form, supported


def test_supported_returns_true_for_simple_pydantic_schema():
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "default": "alpha"},
            "count": {"type": "integer", "minimum": 1, "maximum": 100, "default": 10},
            "enabled": {"type": "boolean", "default": True},
        },
    }
    assert supported(schema) is True


def test_supported_returns_false_for_oneof():
    schema = {
        "type": "object",
        "properties": {
            "thing": {"oneOf": [{"type": "string"}, {"type": "integer"}]},
        },
    }
    assert supported(schema) is False


def test_supported_returns_false_for_array_property():
    schema = {
        "type": "object",
        "properties": {
            "items": {"type": "array", "items": {"type": "string"}},
        },
    }
    assert supported(schema) is False


def test_render_form_emits_text_input_for_string():
    schema = {"type": "object", "properties": {"name": {"type": "string"}}}
    result = render_form(schema, current_values={"name": "alpha"})
    assert result.fallback is False
    assert '<input' in result.html
    assert 'name="name"' in result.html
    assert 'type="text"' in result.html
    assert 'value="alpha"' in result.html


def test_render_form_emits_number_input_with_min_max():
    schema = {
        "type": "object",
        "properties": {
            "count": {"type": "integer", "minimum": 1, "maximum": 100},
        },
    }
    result = render_form(schema, current_values={"count": 25})
    assert 'type="number"' in result.html
    assert 'min="1"' in result.html
    assert 'max="100"' in result.html
    assert 'value="25"' in result.html


def test_render_form_emits_checkbox_for_boolean():
    schema = {"type": "object", "properties": {"on": {"type": "boolean"}}}
    result = render_form(schema, current_values={"on": True})
    assert 'type="checkbox"' in result.html
    assert 'checked' in result.html


def test_render_form_emits_select_for_enum():
    schema = {
        "type": "object",
        "properties": {
            "color": {"type": "string", "enum": ["red", "green", "blue"]},
        },
    }
    result = render_form(schema, current_values={"color": "green"})
    assert '<select' in result.html
    assert '<option value="red"' in result.html
    assert '<option value="green" selected' in result.html


def test_render_form_falls_back_for_unsupported_schema():
    schema = {
        "type": "object",
        "properties": {"items": {"type": "array", "items": {"type": "string"}}},
    }
    result = render_form(schema, current_values={"items": ["a", "b"]})
    assert result.fallback is True
    # Fallback is a textarea with raw JSON
    assert '<textarea' in result.html
    assert 'name="_raw_json"' in result.html


def test_render_form_handles_nested_object_via_ref():
    """Pydantic emits $defs for nested models; resolve refs inline."""
    schema = {
        "type": "object",
        "properties": {
            "inner": {"$ref": "#/$defs/Inner"},
        },
        "$defs": {
            "Inner": {
                "type": "object",
                "properties": {
                    "value": {"type": "integer"},
                },
            },
        },
    }
    result = render_form(schema, current_values={"inner": {"value": 42}})
    assert result.fallback is False
    # Inner field rendered as a fieldset
    assert '<fieldset>' in result.html
    assert 'name="inner.value"' in result.html
    assert 'value="42"' in result.html


def test_render_form_escapes_html_in_values():
    schema = {"type": "object", "properties": {"name": {"type": "string"}}}
    result = render_form(schema, current_values={"name": '<script>alert(1)</script>'})
    assert '<script>' not in result.html
    assert '&lt;script&gt;' in result.html
```

Run: `pytest tests/test_schema.py -v` — expected: 10 FAIL.

- [ ] **Step 2: Implement `schema.py`**

```python
import html
import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RenderResult:
    html: str
    fallback: bool  # True if we rendered the raw-JSON fallback


_SUPPORTED_SIMPLE_TYPES = {"string", "integer", "number", "boolean"}


def supported(schema: dict) -> bool:
    """Return True if every property in `schema` is renderable by v1.

    Walks the schema tree, resolving `$ref` against `$defs`. Rejects
    `oneOf`/`anyOf`/`allOf`, arrays, additionalProperties=True.
    """
    defs = schema.get("$defs", {})

    def _resolve(node: dict) -> dict:
        if "$ref" in node:
            ref = node["$ref"]
            # Pydantic emits e.g. "#/$defs/Inner"
            if ref.startswith("#/$defs/"):
                name = ref[len("#/$defs/"):]
                return defs.get(name, {})
        return node

    def _check(node: dict) -> bool:
        node = _resolve(node)
        if "oneOf" in node or "anyOf" in node or "allOf" in node:
            return False
        node_type = node.get("type")
        if node_type == "array":
            return False
        if node.get("additionalProperties") is True:
            return False
        if node_type == "object":
            props = node.get("properties", {})
            return all(_check(child) for child in props.values())
        if node_type in _SUPPORTED_SIMPLE_TYPES:
            return True
        if "enum" in node:
            return True
        # Unknown type — be conservative
        return False

    if schema.get("type") != "object":
        return False
    return all(_check(p) for p in schema.get("properties", {}).values())


def render_form(schema: dict, current_values: dict) -> RenderResult:
    """Render the schema's properties as a sequence of HTML form fields.

    Returns a RenderResult with `html` and `fallback` flag. If the schema
    has any feature v1 can't render, falls back to a raw-JSON textarea.
    """
    if not supported(schema):
        return _fallback(current_values)

    defs = schema.get("$defs", {})

    def _resolve(node: dict) -> dict:
        if "$ref" in node:
            ref = node["$ref"]
            if ref.startswith("#/$defs/"):
                name = ref[len("#/$defs/"):]
                return defs.get(name, {})
        return node

    out: list[str] = []
    for prop_name, prop_schema in schema.get("properties", {}).items():
        prop_schema = _resolve(prop_schema)
        value = current_values.get(prop_name)
        out.append(_render_property(prop_name, prop_schema, value, _resolve))
    return RenderResult(html="\n".join(out), fallback=False)


def _render_property(name: str, schema: dict, value: Any, resolve) -> str:
    schema = resolve(schema)
    description = schema.get("description", "")
    hint = f'<small>{html.escape(description)}</small>' if description else ""
    label = f'<label for="{html.escape(name)}">{html.escape(name)}</label>'

    if "enum" in schema:
        return _render_enum(name, schema, value, label, hint)
    node_type = schema.get("type")
    if node_type == "object":
        return _render_object(name, schema, value or {}, resolve, label)
    if node_type == "boolean":
        return _render_boolean(name, value, label, hint)
    if node_type in {"integer", "number"}:
        return _render_number(name, schema, value, label, hint)
    if node_type == "string":
        return _render_string(name, schema, value, label, hint)
    # Unsupported field type — render an inert disabled input (we shouldn't get here
    # because supported() would have returned False).
    return f'{label}<input type="text" disabled />{hint}'


def _render_string(name, schema, value, label, hint):
    v = "" if value is None else str(value)
    return (
        f'{label}'
        f'<input type="text" name="{html.escape(name)}" '
        f'value="{html.escape(v)}" />'
        f'{hint}'
    )


def _render_number(name, schema, value, label, hint):
    v = "" if value is None else str(value)
    extra = ""
    if "minimum" in schema:
        extra += f' min="{schema["minimum"]}"'
    if "maximum" in schema:
        extra += f' max="{schema["maximum"]}"'
    return (
        f'{label}'
        f'<input type="number" name="{html.escape(name)}" '
        f'value="{html.escape(v)}"{extra} />'
        f'{hint}'
    )


def _render_boolean(name, value, label, hint):
    checked = " checked" if value else ""
    return (
        f'{label}'
        f'<input type="checkbox" name="{html.escape(name)}"{checked} />'
        f'{hint}'
    )


def _render_enum(name, schema, value, label, hint):
    opts = []
    for option in schema["enum"]:
        sel = " selected" if option == value else ""
        opts.append(
            f'<option value="{html.escape(str(option))}"{sel}>'
            f'{html.escape(str(option))}'
            f'</option>'
        )
    return f'{label}<select name="{html.escape(name)}">{"".join(opts)}</select>{hint}'


def _render_object(name, schema, value, resolve, label):
    """Nested object → fieldset with dotted names."""
    out: list[str] = [f'<fieldset><legend>{html.escape(name)}</legend>']
    for prop_name, prop_schema in schema.get("properties", {}).items():
        prop_schema = resolve(prop_schema)
        nested_name = f"{name}.{prop_name}"
        nested_value = value.get(prop_name) if isinstance(value, dict) else None
        out.append(_render_property(nested_name, prop_schema, nested_value, resolve))
    out.append('</fieldset>')
    return "\n".join(out)


def _fallback(current_values: dict) -> RenderResult:
    raw = json.dumps(current_values, indent=2, sort_keys=True)
    html_str = (
        '<p><strong>Warning:</strong> this plugin\'s schema uses features '
        'the v1 UI doesn\'t render natively. Edit as raw JSON below.</p>'
        f'<textarea name="_raw_json" rows="20" cols="80">{html.escape(raw)}</textarea>'
    )
    return RenderResult(html=html_str, fallback=True)
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_schema.py -v
```

Expected: 10/10 PASS.

- [ ] **Step 4: Commit**

```bash
git add plc_comm_ops/schema.py tests/test_schema.py
git commit -m "feat: JSON Schema → HTML form renderer with raw-JSON fallback"
```

---

### Task 9: `editor.py` — validate + save via SDK (TDD)

**Files:**
- Create: `plc_comm_ops/editor.py`
- Create: `tests/test_editor.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_editor.py`:

```python
import json

import pytest

from plc_comm_ops.editor import save_cfg, EditorError


def _seed_schema(redis_client, plugin, inst, properties):
    schema = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    redis_client.set(f"schema:{plugin}:{inst}", json.dumps(schema))


def _seed_cfg(redis_client, plugin, inst, doc):
    redis_client.set(f"cfg:{plugin}:{inst}", json.dumps(doc))


def test_save_writes_new_cfg_when_valid(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {
        "name": {"type": "string"},
        "count": {"type": "integer"},
    })
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"name": "alpha", "count": 1})
    raw_at_load = redis_client.get("cfg:plc-result-v2:BSL01").decode()

    save_cfg(
        redis_client, "plc-result-v2", "BSL01",
        form_data={"name": "beta", "count": "42"},
        cached_raw=raw_at_load,
        actor="192.168.10.42",
    )
    new = json.loads(redis_client.get("cfg:plc-result-v2:BSL01"))
    assert new["name"] == "beta"
    assert new["count"] == 42


def test_save_coerces_form_strings_to_numbers(redis_client):
    """HTML forms send everything as strings; editor must coerce to schema types."""
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {
        "count": {"type": "integer"},
        "ratio": {"type": "number"},
    })
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"count": 0, "ratio": 0.0})
    raw = redis_client.get("cfg:plc-result-v2:BSL01").decode()

    save_cfg(
        redis_client, "plc-result-v2", "BSL01",
        form_data={"count": "5", "ratio": "1.5"},
        cached_raw=raw, actor="t",
    )
    new = json.loads(redis_client.get("cfg:plc-result-v2:BSL01"))
    assert new["count"] == 5  # int, not "5"
    assert new["ratio"] == 1.5  # float, not "1.5"


def test_save_coerces_checkbox_to_boolean(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {
        "flag": {"type": "boolean"},
    })
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"flag": False})
    raw = redis_client.get("cfg:plc-result-v2:BSL01").decode()

    # HTML checkbox: present in form → True; absent → False
    save_cfg(
        redis_client, "plc-result-v2", "BSL01",
        form_data={"flag": "on"},  # browser sends "on" for checked checkboxes
        cached_raw=raw, actor="t",
    )
    assert json.loads(redis_client.get("cfg:plc-result-v2:BSL01"))["flag"] is True

    raw2 = redis_client.get("cfg:plc-result-v2:BSL01").decode()
    save_cfg(
        redis_client, "plc-result-v2", "BSL01",
        form_data={},  # checkbox unchecked → field absent
        cached_raw=raw2, actor="t",
    )
    assert json.loads(redis_client.get("cfg:plc-result-v2:BSL01"))["flag"] is False


def test_save_raises_editor_error_when_schema_missing(redis_client):
    """Plugin never published schema → editor refuses to save (we can't validate)."""
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"name": "alpha"})
    raw = redis_client.get("cfg:plc-result-v2:BSL01").decode()
    with pytest.raises(EditorError):
        save_cfg(
            redis_client, "plc-result-v2", "BSL01",
            form_data={"name": "beta"},
            cached_raw=raw, actor="t",
        )


def test_save_raises_on_conflict(redis_client):
    """Optimistic concurrency: if cfg changed since load, save rejects."""
    from strokmatic_comm_sdk import ConfigConflictError

    _seed_schema(redis_client, "plc-result-v2", "BSL01", {"name": {"type": "string"}})
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"name": "alpha"})
    raw_at_load = redis_client.get("cfg:plc-result-v2:BSL01").decode()
    # Another operator edits the cfg in the meantime
    redis_client.set("cfg:plc-result-v2:BSL01", json.dumps({"name": "INTERLOPER"}))
    # Our save should now conflict
    with pytest.raises(ConfigConflictError):
        save_cfg(
            redis_client, "plc-result-v2", "BSL01",
            form_data={"name": "beta"},
            cached_raw=raw_at_load, actor="t",
        )


def test_save_handles_raw_json_fallback_path(redis_client):
    """If the form sends `_raw_json`, treat it as the entire new doc."""
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {"name": {"type": "string"}})
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"name": "alpha"})
    raw = redis_client.get("cfg:plc-result-v2:BSL01").decode()

    save_cfg(
        redis_client, "plc-result-v2", "BSL01",
        form_data={"_raw_json": '{"name": "gamma"}'},
        cached_raw=raw, actor="t",
    )
    assert json.loads(redis_client.get("cfg:plc-result-v2:BSL01"))["name"] == "gamma"


def test_save_emits_audit_entry(redis_client):
    _seed_schema(redis_client, "plc-result-v2", "BSL01", {"name": {"type": "string"}})
    _seed_cfg(redis_client, "plc-result-v2", "BSL01", {"name": "alpha"})
    raw = redis_client.get("cfg:plc-result-v2:BSL01").decode()

    save_cfg(
        redis_client, "plc-result-v2", "BSL01",
        form_data={"name": "beta"},
        cached_raw=raw, actor="192.168.10.42",
    )
    entries = redis_client.xrange("audit:plc-result-v2:BSL01")
    assert len(entries) == 1
    _, fields = entries[0]
    decoded = {k.decode(): v.decode() for k, v in fields.items()}
    assert decoded["actor"] == "192.168.10.42"
```

Run: `pytest tests/test_editor.py -v` — expected: 7 FAIL.

- [ ] **Step 2: Implement `editor.py`**

```python
import json

import redis
from strokmatic_comm_sdk.exceptions import ConfigConflictError


class EditorError(Exception):
    """Raised when the editor can't proceed for reasons other than a write conflict."""


def save_cfg(
    redis_client: redis.Redis,
    plugin: str,
    instance: str,
    *,
    form_data: dict,
    cached_raw: str,
    actor: str,
) -> None:
    """Validate `form_data` against the plugin's schema, then save via SDK.

    `form_data` is the parsed HTTP form (dict of str → str values, plus
    optional `_raw_json` for fallback). We use the schema (from
    `schema:<plugin>:<instance>`) to coerce string form values to the
    declared types before writing.

    Raises:
        EditorError — schema missing, JSON invalid, type coercion failed
        ConfigConflictError — cfg in Redis changed since cached_raw
    """
    schema_raw = redis_client.get(f"schema:{plugin}:{instance}")
    if schema_raw is None:
        raise EditorError(
            f"No schema published at schema:{plugin}:{instance}. "
            f"Restart the plugin to publish its schema."
        )
    schema = json.loads(schema_raw)

    # Raw-JSON fallback path
    if "_raw_json" in form_data:
        try:
            new_doc = json.loads(form_data["_raw_json"])
        except json.JSONDecodeError as exc:
            raise EditorError(f"Invalid JSON in fallback editor: {exc}") from exc
    else:
        new_doc = _coerce_form_to_schema(form_data, schema)

    # Use the SDK's optimistic-concurrency save via a generic PluginConfig wrapper.
    # We don't have a Pydantic class for arbitrary plugins, so we use redis directly
    # for the WATCH/MULTI/EXEC, mirroring what PluginConfig.save does.
    new_raw = json.dumps(new_doc)
    cfg_key = f"cfg:{plugin}:{instance}"

    with redis_client.pipeline() as pipe:
        while True:
            try:
                pipe.watch(cfg_key)
                current = pipe.get(cfg_key)
                current_str = (
                    current.decode() if isinstance(current, bytes)
                    else (current or "")
                )
                if current_str != cached_raw:
                    pipe.unwatch()
                    raise ConfigConflictError(
                        f"{cfg_key} changed since you loaded it"
                    )
                pipe.multi()
                pipe.set(cfg_key, new_raw)
                pipe.execute()
                break
            except redis.WatchError:
                continue

    # Audit entry (mirrors what AuditLog does — we can't use AuditLog directly
    # because it lives behind PluginConfig.save and we're doing a raw write here)
    import time
    redis_client.xadd(
        f"audit:{plugin}:{instance}",
        {
            "ts": str(int(time.time() * 1000)),
            "actor": actor,
            "field_path": "<full_doc>",
            "old": cached_raw,
            "new": new_raw,
        },
        maxlen=10000,
        approximate=True,
    )


def _coerce_form_to_schema(form_data: dict, schema: dict) -> dict:
    """Convert form-string values to the types declared in schema.properties.

    Supports:
      - integer / number → int / float (via int()/float())
      - boolean → True if "on"/"true"/"1", False if absent
      - string → unchanged
      - enum → unchanged (validation against allowed values left to plugin re-read)
      - nested object via dotted names ("inner.value") → nested dict
    """
    defs = schema.get("$defs", {})
    properties = schema.get("properties", {})

    def _resolve(node: dict) -> dict:
        if "$ref" in node:
            ref = node["$ref"]
            if ref.startswith("#/$defs/"):
                name = ref[len("#/$defs/"):]
                return defs.get(name, {})
        return node

    def _coerce_one(node: dict, val):
        node = _resolve(node)
        t = node.get("type")
        if t == "integer":
            return int(val)
        if t == "number":
            return float(val)
        if t == "boolean":
            return _coerce_bool(val)
        return val  # string / enum / object handled at upper layer

    def _coerce_bool(val) -> bool:
        if val is True or val is False:
            return val
        if val is None:
            return False
        v = str(val).strip().lower()
        return v in {"on", "true", "1", "yes"}

    result: dict = {}
    # First pass: simple fields + collect nested
    nested: dict[str, dict] = {}
    for key, val in form_data.items():
        if "." in key:
            parent, _, child = key.partition(".")
            nested.setdefault(parent, {})[child] = val
        else:
            if key in properties:
                result[key] = _coerce_one(properties[key], val)
            # If a field isn't in the schema, drop it (Pydantic extra="forbid"
            # would reject anyway).

    # Add missing boolean fields as False (HTML checkboxes don't submit when unchecked)
    for prop_name, prop_schema in properties.items():
        prop_schema = _resolve(prop_schema)
        if prop_schema.get("type") == "boolean" and prop_name not in result and prop_name not in nested:
            result[prop_name] = False

    # Second pass: nested objects
    for parent, child_form in nested.items():
        parent_schema = _resolve(properties.get(parent, {}))
        if parent_schema.get("type") == "object":
            # Recurse, building a synthetic schema document
            synthetic = {
                "type": "object",
                "properties": parent_schema.get("properties", {}),
                "$defs": defs,
            }
            result[parent] = _coerce_form_to_schema(child_form, synthetic)

    return result
```

- [ ] **Step 3: Run tests**

```bash
pytest tests/test_editor.py -v
```

Expected: 7/7 PASS.

- [ ] **Step 4: Commit**

```bash
git add plc_comm_ops/editor.py tests/test_editor.py
git commit -m "feat: editor — coerce form data + optimistic save + audit emit"
```

---

### Task 10: FastAPI app + routes + templates (TDD with TestClient)

**Files:**
- Create: `plc_comm_ops/app.py`
- Create: `plc_comm_ops/templates/base.html`
- Create: `plc_comm_ops/templates/list.html`
- Create: `plc_comm_ops/templates/plugin.html`
- Create: `plc_comm_ops/templates/partials/status_badge.html`
- Create: `plc_comm_ops/templates/partials/status_panel.html`
- Create: `plc_comm_ops/templates/partials/form_field.html`
- Create: `tests/test_routes.py`

- [ ] **Step 1: Write failing route tests**

Create `tests/test_routes.py`:

```python
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from plc_comm_ops.app import app
    return TestClient(app)


def _seed_plugin(redis_client, plugin, inst, schema, cfg, status_age_ms=None):
    redis_client.set(f"schema:{plugin}:{inst}", json.dumps(schema))
    redis_client.set(f"cfg:{plugin}:{inst}", json.dumps(cfg))
    if status_age_ms is not None:
        import time
        redis_client.hset(
            f"status:{plugin}:{inst}",
            mapping={
                "last_beat_ms": int(time.time() * 1000) - status_age_ms,
                "state": "IDLE",
                "error_count": 0,
                "result_count": 0,
                "cycle_period_ms": 50,
                "last_cycle_us": 800,
            },
        )


def test_healthz_returns_200(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.text in ("ok", '"ok"')


def test_list_page_empty(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "no plugins" in r.text.lower() or "empty" in r.text.lower()


def test_list_page_shows_discovered_plugin(client, redis_client):
    _seed_plugin(redis_client, "plc-result-v2", "BSL01",
                 schema={"type": "object", "properties": {"name": {"type": "string"}}},
                 cfg={"name": "alpha"},
                 status_age_ms=1000)
    r = client.get("/")
    assert r.status_code == 200
    assert "plc-result-v2" in r.text
    assert "BSL01" in r.text


def test_detail_page_renders_form_prefilled(client, redis_client):
    _seed_plugin(redis_client, "plc-result-v2", "BSL01",
                 schema={"type": "object", "properties": {
                     "name": {"type": "string"},
                     "count": {"type": "integer", "minimum": 0},
                 }},
                 cfg={"name": "alpha", "count": 5})
    r = client.get("/plugin/plc-result-v2/BSL01")
    assert r.status_code == 200
    assert 'value="alpha"' in r.text
    assert 'value="5"' in r.text


def test_detail_page_404_when_plugin_unknown(client):
    r = client.get("/plugin/nonexistent/X")
    assert r.status_code == 404


def test_save_updates_cfg_and_redirects(client, redis_client):
    _seed_plugin(redis_client, "plc-result-v2", "BSL01",
                 schema={"type": "object", "properties": {"name": {"type": "string"}}},
                 cfg={"name": "alpha"})
    raw_at_load = redis_client.get("cfg:plc-result-v2:BSL01").decode()
    r = client.post(
        "/plugin/plc-result-v2/BSL01/save",
        data={"name": "beta", "_cached_raw": raw_at_load},
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert json.loads(redis_client.get("cfg:plc-result-v2:BSL01"))["name"] == "beta"


def test_save_returns_409_on_conflict(client, redis_client):
    _seed_plugin(redis_client, "plc-result-v2", "BSL01",
                 schema={"type": "object", "properties": {"name": {"type": "string"}}},
                 cfg={"name": "alpha"})
    stale = redis_client.get("cfg:plc-result-v2:BSL01").decode()
    redis_client.set("cfg:plc-result-v2:BSL01", json.dumps({"name": "INTERLOPER"}))
    r = client.post(
        "/plugin/plc-result-v2/BSL01/save",
        data={"name": "beta", "_cached_raw": stale},
        follow_redirects=False,
    )
    assert r.status_code == 409
    assert "reload" in r.text.lower()


def test_status_partial_returns_html_fragment(client, redis_client):
    _seed_plugin(redis_client, "plc-result-v2", "BSL01",
                 schema={"type": "object", "properties": {"name": {"type": "string"}}},
                 cfg={"name": "alpha"},
                 status_age_ms=500)
    r = client.get("/plugin/plc-result-v2/BSL01/status")
    assert r.status_code == 200
    assert "IDLE" in r.text
    # No full HTML wrapper; this is a partial.
    assert "<html" not in r.text.lower()
```

Run: `pytest tests/test_routes.py -v` — expected: 8 FAIL (`app` module missing).

- [ ] **Step 2: Create templates**

Create `plc_comm_ops/templates/base.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>plc-comm-ops</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <script src="https://unpkg.com/htmx.org@1.9.10"></script>
</head>
<body>
    <main class="container">
        <header>
            <nav>
                <ul><li><strong><a href="/">plc-comm-ops</a></strong></li></ul>
            </nav>
        </header>
        {% block content %}{% endblock %}
    </main>
</body>
</html>
```

Create `plc_comm_ops/templates/list.html`:

```html
{% extends "base.html" %}
{% block content %}
<h2>Plugins</h2>
{% if plugins %}
<table>
    <thead>
        <tr><th>Plugin</th><th>Instance</th><th>Status</th><th></th></tr>
    </thead>
    <tbody>
    {% for plugin, instance, color in plugins %}
        <tr>
            <td>{{ plugin }}</td>
            <td>{{ instance }}</td>
            <td>
                <span style="display:inline-block;width:0.9rem;height:0.9rem;border-radius:50%;background:{% if color=='green' %}#0a0{% elif color=='yellow' %}#dd0{% else %}#d00{% endif %};vertical-align:middle"></span>
                {{ color }}
            </td>
            <td><a href="/plugin/{{ plugin }}/{{ instance }}" role="button">Open</a></td>
        </tr>
    {% endfor %}
    </tbody>
</table>
{% else %}
<p><em>No plugins discovered yet. Start a plugin instance and refresh.</em></p>
{% endif %}
{% endblock %}
```

Create `plc_comm_ops/templates/plugin.html`:

```html
{% extends "base.html" %}
{% block content %}
<hgroup>
    <h2>{{ plugin }} / {{ instance }}</h2>
    <h3>Live status &amp; configuration</h3>
</hgroup>

<article>
    <header><strong>Status</strong></header>
    <div hx-get="/plugin/{{ plugin }}/{{ instance }}/status" hx-trigger="every 5s" hx-swap="innerHTML">
        {% include "partials/status_panel.html" %}
    </div>
</article>

<article>
    <header><strong>Configuration</strong></header>
    {% if error %}
        <p><mark>{{ error }}</mark></p>
    {% endif %}
    <form action="/plugin/{{ plugin }}/{{ instance }}/save" method="post">
        <input type="hidden" name="_cached_raw" value="{{ cached_raw }}">
        {{ form_html|safe }}
        <button type="submit">Save</button>
    </form>
</article>
{% endblock %}
```

Create `plc_comm_ops/templates/partials/status_panel.html`:

```html
{% if status %}
<dl>
    <dt>State</dt><dd>{{ status.state }}</dd>
    <dt>Heartbeat age</dt><dd>{{ '%.1f'|format(status.age_s) }} s</dd>
    <dt>Last cycle (µs)</dt><dd>{{ status.last_cycle_us }}</dd>
    <dt>Cycle period (ms)</dt><dd>{{ status.cycle_period_ms }}</dd>
    <dt>Result count</dt><dd>{{ status.result_count }}</dd>
    <dt>Error count</dt><dd>{{ status.error_count }}</dd>
    {% if status.last_error %}<dt>Last error</dt><dd><code>{{ status.last_error }}</code></dd>{% endif %}
</dl>
{% else %}
<p><em>No status published yet.</em></p>
{% endif %}
```

The status_badge.html + form_field.html partials aren't strictly needed if list.html and plugin.html include their content inline; skip them for v1 to keep the surface small.

- [ ] **Step 3: Implement `plc_comm_ops/app.py`**

```python
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
import redis as redis_lib
from strokmatic_comm_sdk.exceptions import ConfigConflictError

from plc_comm_ops.discovery import discover_plugins
from plc_comm_ops.editor import EditorError, save_cfg
from plc_comm_ops.schema import render_form
from plc_comm_ops.settings import get_settings
from plc_comm_ops.status import StatusTracker


_settings = get_settings()
_redis = redis_lib.Redis(host=_settings.redis_host, port=_settings.redis_port, decode_responses=False)
_status_tracker = StatusTracker(
    _redis,
    fresh_s=_settings.heartbeat_fresh_s,
    stale_s=_settings.heartbeat_stale_s,
    error_window_s=_settings.error_window_s,
)

_templates_dir = Path(__file__).parent / "templates"
_templates = Jinja2Templates(directory=str(_templates_dir))

app = FastAPI(title="plc-comm-ops")


@app.get("/healthz", response_class=PlainTextResponse)
def healthz() -> str:
    return "ok"


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> Response:
    plugins = discover_plugins(_redis)
    items = [(p, i, _status_tracker.health_color(p, i).value) for (p, i) in plugins]
    if request.headers.get("accept", "").startswith("application/json"):
        return JSONResponse({"plugins": [
            {"plugin": p, "instance": i, "health": h} for (p, i, h) in items
        ]})
    return _templates.TemplateResponse(
        request, "list.html", {"plugins": items},
    )


@app.get("/plugin/{plugin}/{instance}", response_class=HTMLResponse)
def plugin_detail(request: Request, plugin: str, instance: str) -> Response:
    cfg_raw = _redis.get(f"cfg:{plugin}:{instance}")
    schema_raw = _redis.get(f"schema:{plugin}:{instance}")
    if cfg_raw is None:
        raise HTTPException(404, f"No cfg for {plugin}:{instance}")

    cfg_doc = json.loads(cfg_raw)
    cached_raw = cfg_raw.decode() if isinstance(cfg_raw, bytes) else cfg_raw

    if schema_raw is None:
        form_html = (
            '<p><mark>Schema not yet published for this plugin. '
            'Restart the plugin container so it publishes its schema.</mark></p>'
        )
    else:
        schema = json.loads(schema_raw)
        result = render_form(schema, cfg_doc)
        form_html = result.html

    status = _status_tracker.panel_data(plugin, instance)

    if request.headers.get("accept", "").startswith("application/json"):
        return JSONResponse({
            "plugin": plugin,
            "instance": instance,
            "cfg": cfg_doc,
            "status": status,
        })
    return _templates.TemplateResponse(
        request, "plugin.html",
        {
            "plugin": plugin, "instance": instance,
            "form_html": form_html, "cached_raw": cached_raw,
            "status": status, "error": None,
        },
    )


@app.post("/plugin/{plugin}/{instance}/save")
async def plugin_save(plugin: str, instance: str, request: Request) -> Response:
    form = await request.form()
    form_data = {k: v for k, v in form.items() if k != "_cached_raw"}
    cached_raw = form.get("_cached_raw", "")
    actor = request.client.host if request.client else "unknown"

    try:
        save_cfg(
            _redis, plugin, instance,
            form_data=dict(form_data),
            cached_raw=cached_raw,
            actor=actor,
        )
    except ConfigConflictError as exc:
        return _templates.TemplateResponse(
            request, "plugin.html",
            {
                "plugin": plugin, "instance": instance,
                "form_html": "", "cached_raw": "",
                "status": _status_tracker.panel_data(plugin, instance),
                "error": f"{exc}. Reload the page and retry.",
            },
            status_code=409,
        )
    except EditorError as exc:
        return _templates.TemplateResponse(
            request, "plugin.html",
            {
                "plugin": plugin, "instance": instance,
                "form_html": "", "cached_raw": "",
                "status": _status_tracker.panel_data(plugin, instance),
                "error": str(exc),
            },
            status_code=400,
        )
    return RedirectResponse(f"/plugin/{plugin}/{instance}", status_code=303)


@app.get("/plugin/{plugin}/{instance}/status", response_class=HTMLResponse)
def plugin_status_partial(request: Request, plugin: str, instance: str) -> Response:
    status = _status_tracker.panel_data(plugin, instance)
    return _templates.TemplateResponse(
        request, "partials/status_panel.html",
        {"status": status},
    )
```

- [ ] **Step 4: Create `__main__.py`**

```python
"""Entry point for `python -m plc_comm_ops`. Runs uvicorn."""
import uvicorn

from plc_comm_ops.settings import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "plc_comm_ops.app:app",
        host="0.0.0.0",
        port=settings.port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run all tests**

```bash
cd /home/teruel/worktrees/plc-comm-ops
source .venv/bin/activate
pytest tests/ -v 2>&1 | tail -15
```

Expected: 8 new route tests pass + 5 discovery + 8 status + 10 schema + 7 editor = ~38 tests total green.

- [ ] **Step 6: Commit**

```bash
git add plc_comm_ops/app.py plc_comm_ops/__main__.py plc_comm_ops/templates/ tests/test_routes.py
git commit -m "feat: FastAPI app + 5 routes + jinja2 templates + HTMX live status"
```

---

### Task 11: Container packaging — Dockerfile + compose + cloudbuild + README

**Files:**
- Create: `plc-comm-ops.Dockerfile`, `plc-comm-ops.yml`, `cloudbuild.yaml`, `README.md`

- [ ] **Step 1: Dockerfile**

Create `plc-comm-ops.Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml plc-comm-ops.req ./
COPY plc_comm_ops/ plc_comm_ops/

RUN pip install --no-cache-dir -e .

EXPOSE 8000
ENTRYPOINT ["python", "-m", "plc_comm_ops"]
```

- [ ] **Step 2: docker-compose**

Create `plc-comm-ops.yml`:

```yaml
version: "3.8"

services:
  plc-comm-ops:
    image: ${REGISTRY:-strokmatic}/plc-comm-ops:${TAG:-latest}
    build:
      context: .
      dockerfile: plc-comm-ops.Dockerfile
    ports: ["8000:8000"]
    environment:
      REDIS_HOST: ${REDIS_HOST}
      REDIS_PORT: ${REDIS_PORT:-6379}
      HEARTBEAT_FRESH_S: ${HEARTBEAT_FRESH_S:-5}
      HEARTBEAT_STALE_S: ${HEARTBEAT_STALE_S:-60}
      ERROR_WINDOW_S: ${ERROR_WINDOW_S:-300}
      PORT: ${PORT:-8000}
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
    restart: unless-stopped
```

- [ ] **Step 3: Cloud Build**

Create `cloudbuild.yaml`:

```yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --tag=gcr.io/$PROJECT_ID/plc-comm-ops:$SHORT_SHA
      - --tag=gcr.io/$PROJECT_ID/plc-comm-ops:latest
      - --file=plc-comm-ops.Dockerfile
      - .
  - name: gcr.io/cloud-builders/docker
    args: [push, gcr.io/$PROJECT_ID/plc-comm-ops:$SHORT_SHA]
  - name: gcr.io/cloud-builders/docker
    args: [push, gcr.io/$PROJECT_ID/plc-comm-ops:latest]

options:
  logging: CLOUD_LOGGING_ONLY
```

- [ ] **Step 4: README**

Create `README.md`:

````markdown
# plc-comm-ops

Operator UI for the strokmatic comm-layer plugin fleet. Lists running plugins
discovered from Redis, renders each plugin's JSON Schema as an HTML form,
shows live status, and writes edits back via the comm SDK so they take
effect within one plugin cycle.

## Architecture

See `docs/superpowers/specs/2026-05-12-plc-comm-ops-design.md` in the
JARVIS orchestrator repo for the full design.

```
operator browser ─HTTP─▶ plc-comm-ops (FastAPI + jinja2 + HTMX) ─▶ Redis
                                                                    ▲
                                                                    │
                                                            plc-result-v2, camera v2,
                                                            future plugins (each publishes
                                                            its schema:* on startup)
```

## Running

```bash
REDIS_HOST=10.0.0.5 docker compose -f plc-comm-ops.yml up -d
# Then visit http://<host>:8000/
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `REDIS_HOST` | localhost | Application Redis (where cfg:* / schema:* / status:* live) |
| `REDIS_PORT` | 6379 | |
| `HEARTBEAT_FRESH_S` | 5 | Heartbeat ≤ this → green |
| `HEARTBEAT_STALE_S` | 60 | Heartbeat ≥ this → red |
| `ERROR_WINDOW_S` | 300 | Watch this window for error_count increments |
| `PORT` | 8000 | HTTP port |

## CI deploy key

CI fetches `strokmatic-comm-sdk` over SSH. The workflow requires repo
secret `STROKMATIC_COMM_SDK_DEPLOY_KEY` set to a read-only deploy key
on the SDK repo.

## v1 scope

- List plugins (discovered from `cfg:plc-*:*` keys)
- Show health badge (green/yellow/red based on heartbeat + error_count)
- Render Pydantic JSON Schema as HTML form
- Optimistic-concurrency save via SDK
- Audit entries written automatically to `audit:*` stream

Out of scope (deferred to v1.1+): auth, audit history viewer, bulk edits,
HTTPS, Prometheus exporter. See spec §16.
````

- [ ] **Step 5: Smoke-test the container**

```bash
cd /home/teruel/worktrees/plc-comm-ops
docker build -f plc-comm-ops.Dockerfile -t plc-comm-ops:smoke . 2>&1 | tail -10
# Run briefly
docker run --rm --network=host -e REDIS_HOST=127.0.0.1 --name plc-comm-ops-smoke \
    -d plc-comm-ops:smoke
sleep 2
curl -sS http://127.0.0.1:8000/healthz
docker stop plc-comm-ops-smoke
docker rmi plc-comm-ops:smoke
```

Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add plc-comm-ops.Dockerfile plc-comm-ops.yml cloudbuild.yaml README.md
git commit -m "feat: container packaging (Dockerfile, compose, cloudbuild, README)"
```

---

### Task 12: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```bash
mkdir -p .github/workflows
```

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master, develop]
  pull_request:
    branches: [master, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7
        ports: ["6379:6379"]
        options: --health-cmd "redis-cli ping" --health-interval 5s --health-timeout 3s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install (with SDK access)
        env:
          SDK_SSH_KEY: ${{ secrets.STROKMATIC_COMM_SDK_DEPLOY_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$SDK_SSH_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan github.com >> ~/.ssh/known_hosts
          pip install -e ".[dev]"
      - name: Run tests
        env:
          REDIS_HOST: localhost
          REDIS_PORT: "6379"
        run: pytest tests/ -v --tb=short
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pytest workflow with Redis service + SDK deploy key"
```

---

### Task 13: Push branch + open draft PR

**Files:** none — git/GitHub-side task.

- [ ] **Step 1: Final test verification**

```bash
cd /home/teruel/worktrees/plc-comm-ops
source .venv/bin/activate
pytest tests/ -v 2>&1 | tail -5
```

Expected: ~38 passing, 0 failing.

- [ ] **Step 2: Push master**

```bash
git push -u origin master
```

Note: this is the FIRST push of a brand-new repo. No PR needed for the initial commit — this becomes the new repo's `master` directly. If you prefer the draft-PR pattern from plc-result-v2 (which was on a feature branch), instead create a `feat/v1` branch, push that, and PR to `master`:

```bash
git checkout -b feat/v1
git push -u origin feat/v1
gh pr create --draft --title "plc-comm-ops v1: cfg editor + minimal status" --body "$(cat <<'EOF'
## Summary

Initial implementation of plc-comm-ops, the operator UI for the
strokmatic comm-layer plugin fleet. Lists plugins discovered via
`cfg:plc-*:*` Redis keys, renders Pydantic JSON Schemas (published to
`schema:*`) as HTML forms, shows minimal read-only status alongside
each form, writes edits back via SDK with optimistic concurrency.

Spec: `docs/superpowers/specs/2026-05-12-plc-comm-ops-design.md` (JARVIS repo).

## Dependencies

- Requires `strokmatic-comm-sdk` v0.2.0 (publishes `publish_schema`,
  `reload`, optimistic-concurrency `save`). Tagged separately.
- Requires `plc-result-v2` + `plc-monitor-camera-v2` to be running and
  calling `publish_schema()` at startup for the UI to render their forms.

## Acceptance gates

- [x] Unit + integration tests green (~38 tests)
- [ ] Manual smoke: operator can edit `cycle_period_ms` from 50 → 100 ms
      via the UI and see the change take effect in plc-result-v2's
      `status:` hash within one cycle period
- [ ] Audit stream shows operator IP as actor

## Out of scope (v1)

- Auth, audit history viewer, client-side validation, bulk edits, HTTPS,
  Prometheus exporter. See spec §16.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify**

```bash
gh pr list --repo strokmatic/plc-comm-ops
```

Expected: PR visible.

CI will fail until `STROKMATIC_COMM_SDK_DEPLOY_KEY` is set as a repo secret (same as plc-result-v2's situation). Not a blocker.

---

## Summary

13 tasks across three coordinated tracks:

| Track | Tasks | What |
|---|---|---|
| A — SDK v0.2.0 | 1–2 | `publish_schema` + `reload` + optimistic `save` + tag |
| B — Plugin pickups | 3–4 | plc-result-v2 + camera v2 adopt v0.2.0 helpers |
| C — plc-comm-ops | 5–13 | New repo, full implementation behind 5 routes |

Order matters: Track A must merge/tag before Track B can pin v0.2.0; Track B must publish schemas before Track C can render real forms (but Track C can develop against synthetic schemas in tests independently).

## Test plan

- **Default CI**: `pytest tests/` runs on every push to plc-comm-ops master/develop and PR.
- **Cross-repo integration smoke** (manual): bring up plc-result-v2 + camera v2 + plc-comm-ops + Redis all on one docker-compose, browse to plc-comm-ops on port 8000, edit a plugin's cfg, verify the runner's `status:` hash reflects the new value within `cycle_period_ms`.
- **Audit verification** (manual): after a save, `redis-cli XRANGE audit:plc-result-v2:BSL01 - +` shows an entry with the operator's IP as actor.

## Out of scope

Per spec §16 — no auth, no audit history view, no client-side validation, no bulk edits, no HTTPS, no Prometheus exporter, no multi-Redis support. All explicit and parked for v1.1.
