# plc-comm-ops — Design Spec

**Date:** 2026-05-12
**Status:** Draft for user review
**Master architecture:** `docs/superpowers/specs/2026-05-07-strokmatic-eip-generic-communicator-design.md` §10 ("Ops touchpoint (minimal)")
**Sister specs:** `docs/superpowers/specs/2026-05-08-plc-result-v2-design.md`, the comm-sdk + camera plugin spec

---

## 1. Summary

Build a tiny FastAPI service that lets operators view and edit each plugin's live-tunable configuration. Lists plugins discovered by scanning `cfg:plc-*:*` Redis keys, renders the JSON Schema each plugin publishes on startup as an HTML form, validates and writes back via `strokmatic-comm-sdk`'s `PluginConfig.save()` (which emits an audit-stream entry automatically), and shows a minimal read-only status panel beside each form so operators can see if their changes took effect.

No auth (operator-network deployment), no audit history viewer (v1), no client-side validation (server-side via Pydantic). One Python container, one Redis, ~280 LoC.

Acceptance gate: operator can edit `plc-result-v2.cycle_period_ms` from 50 ms to 100 ms via the UI; the plugin runner picks up the new value within one cycle period; the audit stream records `who/when/old/new`.

---

## 2. Why

The master comm-layer architecture rests on three things:
1. A certified C adapter (`strokmatic-eip`).
2. Python plugins implementing differentiated handshakes (`plc-result-v2`, `plc-monitor-camera-v2`, future).
3. **Live-tunable config in Redis** (`cfg:<plugin>:<inst>`) so operators can tune plugin parameters without code changes, container rebuilds, or recerts.

(3) is the missing operator-facing piece. Without it, "edit config via `redis-cli`" is the only mechanism — no audit trail, no schema validation, no discoverability, no visibility of which plugins exist or whether they're healthy. This is the gap plc-comm-ops fills.

It's also the *enabler* for hot reload across the plugin fleet: today, both shipped plugins (`plc-result-v2`, `plc-monitor-camera-v2`) load their cfg once at startup. Tuning means container restarts, which interrupts handshakes. The master spec described plugins as reading "live-tunable parameters from Redis on every cycle" — that intent isn't yet realized in either plugin. This project closes the loop end-to-end: the UI lets ops save changes, the SDK gives plugins a fast re-read path, and the plugins poll their own cfg every cycle.

---

## 3. Architecture

```
operator browser ─HTTP─▶ plc-comm-ops (FastAPI + jinja2 + HTMX, single container)
                              │
                              ├──▶ KEYS  cfg:plc-*:*           (discover plugins)
                              ├──▶ GET   schema:<p>:<i>        (render HTML form from JSON Schema)
                              ├──▶ HGETALL status:<p>:<i>      (health badge + status panel)
                              ├──▶ GET   cfg:<p>:<i>           (current values to pre-fill form)
                              └──▶ via SDK: PluginConfig.save(...)
                                      └──▶ writes cfg:<p>:<i>
                                      └──▶ XADD audit:<p>:<i> with actor + diff
```

```
plugin runner (e.g. plc-result-v2)
   │
   ├─ at startup, calls SDK: PluginConfig.publish_schema(redis, plugin, inst)
   │   └─▶ SET schema:<plugin>:<inst> = <JSON Schema string>
   │
   └─ each cycle, calls SDK: PluginConfig.reload(redis, plugin, inst, cached=...)
       └─▶ returns (new_cfg, raw_json) if changed, else (None, cached)
```

The UI never imports any plugin's source — it operates entirely off Redis keys. New plugins appear automatically when they call `publish_schema()` on startup.

---

## 4. SDK changes (v0.1.0 → v0.2.0, additive)

Two new classmethods on `PluginConfig`. Both are backward-compatible — existing `load()` and `save()` unchanged.

```python
# strokmatic_comm_sdk/config.py

@classmethod
def publish_schema(cls, redis_client, plugin_name: str, instance: str) -> None:
    """Publish this config class's JSON Schema to schema:<plugin>:<instance>.

    Plugins call this once at startup, before entering their main loop. The
    plc-comm-ops UI reads these keys to discover what fields each plugin
    accepts and renders an HTML form accordingly.
    """
    key = f"schema:{plugin_name}:{instance}"
    redis_client.set(key, json.dumps(cls.model_json_schema()))


@classmethod
def reload(
    cls,
    redis_client,
    plugin_name: str,
    instance: str,
    *,
    cached_raw: str | None = None,
) -> tuple["PluginConfig | None", str]:
    """Cheap cfg re-read for the runner's per-cycle hot-reload path.

    Returns (model, raw_json):
      - If the cfg in Redis matches cached_raw, returns (None, cached_raw).
        The caller keeps using the previous model — no Pydantic re-parse.
      - If the cfg differs (or cached_raw is None), parses + validates the
        new bytes and returns (new_model, new_raw_json).

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
```

`PluginConfig.save()` is also extended with an optional `check_against_cached_raw: str | None = None` parameter that, if provided, does a Redis WATCH/MULTI/EXEC check-and-set. If the cfg in Redis differs from `check_against_cached_raw`, the save aborts with a new `ConfigConflictError` ("config changed since you loaded it, reload and retry"). plc-comm-ops uses this to prevent two operators stomping on each other's edits. **Optimistic concurrency**, no locks.

Bump to v0.2.0 and re-tag.

---

## 5. Plugin updates

Both `plc-result-v2` and `plc-monitor-camera-v2` need a small follow-up commit per plugin:

1. **At startup** (in `__main__.py`), right after loading cfg:
   ```python
   PlcResultV2Config.publish_schema(io_redis, "plc-result-v2", cell)
   ```
   One line.

2. **Inside the runner cycle** — re-read cfg per cycle and adopt new values cheaply:
   ```python
   # runner.py — at the top of run_one_cycle()
   maybe_new_cfg, self._cfg_raw = PlcResultV2Config.reload(
       self.app_redis, "plc-result-v2", self.cfg.cell,
       cached_raw=self._cfg_raw,
   )
   if maybe_new_cfg is not None:
       self.cfg = maybe_new_cfg
   ```
   ~10 LoC including the `self._cfg_raw` field initialization in `__init__`.

These plugin updates ship as small follow-up PRs in their respective repos. Cycle budget impact: one extra Redis `GET` per cycle. plc-result-v2's cycle-period sweep already showed comfortable headroom (loop body ~7-8ms on Python+Redis; this adds a few hundred microseconds).

---

## 6. Routes (5 total)

| Method | Path | Purpose | Returns |
|---|---|---|---|
| GET | `/` | List page — all discovered plugins with status badge | HTML (or JSON if `Accept: application/json`) |
| GET | `/plugin/<plugin>/<instance>` | Detail page — status panel + cfg form | HTML |
| POST | `/plugin/<plugin>/<instance>/save` | Validate (JSON Schema + Pydantic) → `PluginConfig.save()` with optimistic check → audit:* via SDK → 303 to detail | HTML (303 redirect on success; 200 form re-render with errors on validation fail; 409 on optimistic-concurrency conflict) |
| GET | `/plugin/<plugin>/<instance>/status` | HTMX partial — status panel refresh without full page reload | HTML fragment |
| GET | `/healthz` | Liveness probe for the UI container itself | `200 OK` text |

JSON-first design: every HTML-returning route also returns the same data shape as JSON when the client sends `Accept: application/json`. This keeps the v2-SPA migration path open without adding work now. Out of scope: dedicated JSON-only `/api/` namespace.

---

## 7. Health logic

The list-page status badge and the detail-page status panel use the same rule:

| Color | Condition |
|---|---|
| 🟢 green | `status.last_beat_ms` ≤ 5 s ago AND `status.error_count` unchanged in last 5 minutes |
| 🟡 yellow | `status.last_beat_ms` between 5 s and 60 s ago, OR `error_count` incremented in last 5 minutes |
| 🔴 red | `status.last_beat_ms` > 60 s ago, OR `status` key missing entirely |

The "error_count unchanged in last 5 min" check requires a small in-memory history per plugin instance. Stored as `(instance_id, error_count, observed_at)` tuples in a sliding window. Plc-comm-ops keeps this in-process; on restart, all plugins seen for the first time get a green/yellow based purely on heartbeat freshness until the 5-minute window fills.

Thresholds are read from env vars (`HEARTBEAT_FRESH_S=5`, `HEARTBEAT_STALE_S=60`, `ERROR_WINDOW_S=300`) so different deployments can tune.

---

## 8. Audit actor

When the operator submits a form, the resulting `PluginConfig.save()` call passes `actor=<request.client.host>` — i.e., the operator's source IP. This is recorded in the `audit:<plugin>:<inst>` stream entry:

```
ts=<epoch_ms> actor="192.168.10.42" field_path="<full_doc>" old=<...> new=<...>
```

No login required. Operator-network deployment assumes IP attribution is sufficient. If multiple operators share a workstation, the audit shows the workstation IP, not the human — accepted trade-off for v1.

Future enhancement (out of scope): optional `X-Operator-Name` header from a browser bookmark or extension. Plc-comm-ops would prefix the actor as `f"{ip} ({header})"` if the header is present.

---

## 9. JSON Schema → HTML form rendering

The renderer in `schema.py` converts a Pydantic-generated JSON Schema into HTML form fields. It supports the dialect Pydantic v2 actually emits — a constrained subset of JSON Schema. Concretely:

| JSON Schema feature | HTML mapping |
|---|---|
| `"type": "string"` | `<input type="text">` (or `type="password"` if `format=password`) |
| `"type": "integer"` (or "number") | `<input type="number">` with `min`/`max` from `minimum`/`maximum` |
| `"type": "boolean"` | `<input type="checkbox">` |
| `"enum": [...]` | `<select>` with `<option>` per value |
| Nested object via `$ref` | Expanded inline as a `<fieldset>` |
| `"description"` | `<small>` label hint below the field |
| `"default"` | Pre-fills if no current value, otherwise current value wins |

What's deliberately NOT supported in v1:
- `oneOf` / `anyOf` (union types) — render as plain string textarea + server-side validate
- `items` / arrays — render as JSON textarea
- `additionalProperties: true` — show a warning, accept JSON blob in textarea

Both `PlcResultV2Config` and `CameraPluginConfig` are flat structs with primitives + one nested `IoMap` — the v1 renderer handles them exactly.

If a plugin publishes a schema the v1 renderer can't fully express, the form falls back to a single JSON textarea + a "this schema uses features the v1 UI doesn't render natively, edit as raw JSON" banner. Better to be honest than to render a broken form.

---

## 10. File structure

New repo `strokmatic/plc-comm-ops`, branch `master` (no v2 branch needed — this is a greenfield repo).

```
strokmatic/plc-comm-ops
├── README.md
├── pyproject.toml
├── plc-comm-ops.Dockerfile
├── plc-comm-ops.yml                          # docker-compose
├── plc-comm-ops.req
├── cloudbuild.yaml
├── .github/workflows/ci.yml
├── plc_comm_ops/
│   ├── __init__.py
│   ├── __main__.py                           # uvicorn entry, reads env vars
│   ├── app.py                                # FastAPI app + all 5 routes (~80 LoC)
│   ├── discovery.py                          # scan cfg:plc-*:* keys (~25 LoC)
│   ├── schema.py                             # read schema:* + JSON Schema → form renderer (~80 LoC)
│   ├── status.py                             # read status:* + compute health w/ in-memory error history (~50 LoC)
│   ├── editor.py                             # validate + save via SDK (~30 LoC)
│   ├── settings.py                           # env var config (Redis host, thresholds) (~15 LoC)
│   └── templates/
│       ├── base.html                         # Pico.css from CDN + HTMX from CDN
│       ├── list.html
│       ├── plugin.html
│       └── partials/
│           ├── status_badge.html             # green/yellow/red span
│           ├── status_panel.html             # detail panel (HTMX-refreshable)
│           └── form_field.html               # one field, JSON Schema-driven
└── tests/
    ├── conftest.py                           # real Redis + FastAPI TestClient + dummy plugin fixture
    ├── test_discovery.py
    ├── test_schema.py                        # JSON Schema → HTML round-trip
    ├── test_status.py                        # health thresholds, error-window sliding logic
    ├── test_editor.py                        # save path, optimistic-concurrency rejection
    └── test_routes.py                        # HTTP-level happy paths via TestClient
```

Total ~280 LoC implementation + ~350 LoC tests.

---

## 11. Module responsibilities

Each file has one clear job; nothing crosses module boundaries except through documented function signatures.

| Module | Job | I/O? |
|---|---|---|
| `app.py` | FastAPI routes; pure HTTP layer. Calls into `discovery`, `schema`, `status`, `editor`. | HTTP only |
| `discovery.py` | Scan `cfg:plc-*:*` keys, parse `<plugin>:<inst>` from each. Return sorted list of `(plugin, instance)` tuples. | Redis read |
| `schema.py` | Read `schema:<p>:<i>` from Redis, parse JSON Schema, render HTML form fields. Function: `render_form(schema_dict, current_values: dict) -> str` (HTML). | Redis read; otherwise pure |
| `status.py` | Read `status:<p>:<i>`, compute health color, maintain in-memory error-count window. Class: `StatusTracker(redis, thresholds)` with `health_color(plugin, inst) -> "green"\|"yellow"\|"red"` and `panel_data(plugin, inst) -> dict`. | Redis read + in-memory state |
| `editor.py` | Server-side: validate form submission against JSON Schema, instantiate `PluginConfig`-subclass-like model from raw dict (use Pydantic's `model_validate` on a generic helper), call `save()` with optimistic concurrency. | Redis write via SDK |
| `settings.py` | Pydantic-Settings model for env vars (REDIS_HOST, REDIS_PORT, HEARTBEAT_FRESH_S, HEARTBEAT_STALE_S, ERROR_WINDOW_S, PORT). | Env read only |

The renderer in `schema.py` is the only piece that does real work; everything else is glue. That's the right architecture for a "tiny FastAPI service" — keep the cleverness in one place.

---

## 12. Testing strategy

### Unit (no HTTP, no FastAPI)
- `test_discovery.py` — given seeded `cfg:plc-result-v2:BSL01`, `cfg:plc-result-v2:BSL02`, `cfg:plc-monitor-camera-v2:BSL01`, returns the right `[(plugin, inst), ...]` list, sorted, no duplicates.
- `test_schema.py` — for each supported JSON Schema feature (string, int, bool, enum, nested object, etc.), the renderer produces valid HTML that parses back into the expected form fields. Includes a "schema with unsupported feature" → falls back to raw JSON textarea + banner.
- `test_status.py` — health thresholds: heartbeat 1s ago + 0 errors → green; 30s ago → yellow; 90s ago → red; recent error count increment → yellow even with fresh heartbeat. Sliding-window state across multiple `health_color()` calls.
- `test_editor.py` — happy-path save validates and writes via SDK; bad input rejected with field-level errors; optimistic concurrency rejection raises 409 when cfg changed since form loaded.

### Integration (FastAPI TestClient + real Redis)
- `test_routes.py` — GET / lists seeded plugins with badges; GET /plugin/.../<inst> returns form pre-filled from current cfg; POST .../save with new value updates cfg and emits audit; GET .../status partial returns current health.

### Manual smoke (lab acceptance)
Run plc-comm-ops alongside a live plc-result-v2 instance on the same Redis. Verify:
1. The plugin's `cfg:` and `schema:` keys appear in the UI's list page within seconds.
2. Editing `cycle_period_ms` from 50→100 ms takes effect (plugin's `status.cycle_period_ms` reflects new value within 1 cycle).
3. Audit stream shows the operator's IP.
4. Plugin restart re-publishes schema; no stale data.

---

## 13. Tech stack (locked)

| Layer | Choice | Pinned dep |
|---|---|---|
| Web framework | FastAPI | `fastapi>=0.110,<1` |
| Server | uvicorn | `uvicorn[standard]>=0.27,<1` |
| Templates | jinja2 | `jinja2>=3.1` |
| Interactivity | HTMX 1.9 CDN — no npm | (no Python dep) |
| Styling | Pico.css CDN — no npm | (no Python dep) |
| Settings | pydantic-settings | `pydantic-settings>=2.1` |
| Redis | redis-py | `redis>=5,<6` |
| Plugin SDK | strokmatic-comm-sdk | `>=0.2.0,<0.3` (after SDK bump) |
| JSON Schema parsing | stdlib `json` + custom renderer | none |
| Test client | starlette's `TestClient` (bundled in FastAPI) | (via FastAPI dep) |
| Test framework | pytest | `pytest>=8` |

No SPA, no build step, no `npm`. Static CDN assets keep the deploy story to a single Dockerfile.

---

## 14. Deployment

```yaml
# plc-comm-ops.yml
services:
  plc-comm-ops:
    image: ${REGISTRY:-strokmatic}/plc-comm-ops:${TAG:-latest}
    build:
      context: .
      dockerfile: plc-comm-ops.Dockerfile
    ports: ["8000:8000"]
    environment:
      REDIS_HOST: ${REDIS_HOST}            # same Redis that hosts cfg:*, status:*, audit:*
      REDIS_PORT: ${REDIS_PORT:-6379}
      HEARTBEAT_FRESH_S: ${HEARTBEAT_FRESH_S:-5}
      HEARTBEAT_STALE_S: ${HEARTBEAT_STALE_S:-60}
      ERROR_WINDOW_S: ${ERROR_WINDOW_S:-300}
      PORT: ${PORT:-8000}
    restart: unless-stopped
```

One container per network (multiple operators can hit it concurrently — FastAPI is async, the workload is read-heavy and short-lived). Operators reach it at `http://plc-comm-ops:8000/`. No TLS, no auth — reverse proxy handles those if needed (out of scope for the app itself).

`cloudbuild.yaml` mirrors plc-result-v2's pattern.

---

## 15. Risks

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | The JSON Schema renderer doesn't cover everything Pydantic v2 might emit. | Constrain to the dialect our known plugins use. Fall back to raw JSON textarea + "v1 renderer can't fully express this schema" banner for unsupported features. Test against both plc-result-v2 and camera v2 schemas as part of the test suite. |
| **R2** | Two operators editing the same plugin's cfg simultaneously → lost update. | Optimistic concurrency in `PluginConfig.save(check_against_cached_raw=...)`. UI passes the raw JSON it loaded into the save POST; SDK refuses if Redis state changed. Operator gets a clear "config changed, reload and retry" error. |
| **R3** | Plugin restarts re-publish schema with new shape (e.g., a new field added). Operators with a stale form open submit data missing the new field. | Form submit validates against current schema (re-read at POST time). Missing required field → 400 with the field name. Operator reloads the page to get the new form. |
| **R4** | Hot reload per cycle adds Redis traffic. With N plugins polling every cycle_period_ms, Redis ops/s scales with N. | At 50 ms cycles and 10 plugins, that's 200 GETs/s — trivial for any Redis. plc-comm-ops itself reads on every page load, also trivial. If the fleet grows to 100+ plugins on tight cycles, revisit (e.g., Pub/Sub broadcast on save instead of per-cycle GET). |
| **R5** | A plugin never publishes its schema (bug or older version). UI lists it but can't render the form. | Detail page shows "schema not yet published for this plugin" + a hint to restart the plugin container. List page still shows the status badge — degraded but useful. |

---

## 16. Non-goals (v1)

- **Auth / login.** No.
- **Audit history view.** Spec'd as a v1.1 follow-up (~80 LoC, mostly templates + Redis stream reader).
- **Client-side validation.** Server validates and re-renders form with errors. v1.1 if useful.
- **Bulk edits across multiple plugin instances.** One-at-a-time.
- **HTTPS / TLS.** Reverse proxy concern.
- **Role-based access.** No.
- **Prometheus exporter for plugin status.** Separate deliverable on the Track 1 roadmap.
- **Multi-Redis support.** v1 assumes one Redis hosts everything (matches the SpotFusion deployment topology).

---

## 17. Decisions resolved during brainstorming

1. **Schema discovery**: plugin publishes JSON Schema to `schema:<plugin>:<inst>` on startup. SDK helper `PluginConfig.publish_schema()` does it in one line.
2. **Hot reload**: plugin re-reads cfg every cycle via SDK helper `PluginConfig.reload()`. ~10 LoC update per plugin runner. Saves take effect within one cycle period (default 50 ms for plc-result-v2).
3. **Scope**: cfg editing + minimal read-only status (badge + detail panel). Audit history view deferred to v1.1.
4. **Stack**: FastAPI + jinja2 + HTMX + Pico.css + Pydantic. No SPA, no npm. JSON-first API surface keeps a clean migration path to a Vite/TS frontend in v2 if scope ever grows beyond a "tiny FastAPI service."
5. **Repo placement**: separate repo `strokmatic/plc-comm-ops` (not co-located with SDK). Cross-product, independent release cadence.
6. **Audit actor**: operator IP from `request.client.host`. No login.
7. **Health thresholds**: 5 s / 60 s heartbeat freshness; 5 min error-count window. Tunable via env vars.
8. **Concurrency**: optimistic, Redis WATCH/MULTI/EXEC inside SDK's enhanced `save()`. 409 conflict reported to UI with clear retry instruction.

---

## 18. Next step

After your review:
1. Address any open questions and edit this spec in place.
2. Hand off to `writing-plans` skill to produce the implementation plan at `docs/superpowers/plans/2026-05-12-plc-comm-ops.md` — task breakdown:
   - **SDK v0.2.0**: 2 tasks (publish_schema + reload + ConfigConflictError, tag release)
   - **Plugin updates**: 2 tasks (plc-result-v2 + camera v2 each gain hot-reload + schema publish)
   - **plc-comm-ops**: ~10 tasks following the same TDD-per-module pattern that worked for plc-result-v2 (scaffold, settings, discovery, status, schema renderer, editor, routes, templates, packaging, CI)
   - **Push + draft PR**: 1 task
