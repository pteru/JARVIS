---
type: Design Spec
title: plc-comm-ops v1.1 — Dashboard, Tags, Trendlines, Inject
description: Replace v1's two-page UI (`/` list + `/plugin/{p}/{i}` detail) with a single-page operator/debug console at `/` that shows every plugin instance simultaneously, surfaces live decoded lane values, d...
timestamp: 2026-05-13
---

# plc-comm-ops v1.1 — Dashboard, Tags, Trendlines, Inject

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-05-13
**Predecessor:** `2026-05-12-plc-comm-ops-design.md` (v1, just shipped)

## 1. Goal

Replace v1's two-page UI (`/` list + `/plugin/{p}/{i}` detail) with a single-page operator/debug console at `/` that shows every plugin instance simultaneously, surfaces live decoded lane values, draws short-window trendlines for monitoring/debugging, and lets engineers inject values into Redis to test plugin behavior without a real PLC.

v1 shipped cfg editing per plugin via separate detail pages. Users found that flow click-heavy and information-thin. v1.1 makes the dashboard the product.

## 2. Scope

**In:**
- New single-page dashboard at `/` (replaces v1's `/` and `/plugin/{p}/{i}` detail page; the old per-plugin detail route is removed).
- Plugins publish their decoded lane state to Redis every cycle so the dashboard can show live tag values.
- Browser-side trendline charts (1 Hz polling, ~2 min ring buffer in JS, uPlot rendering).
- Manual-inject panel that writes a single value into one of three allowed Redis namespaces.
- Audit-stream entries for every inject.
- Python-only tests (no JS testing infra).

**Out (deferred to v1.2+):**
- Auth.
- Audit history viewer (browse the audit stream from the UI).
- Server-side trend storage (Redis Streams sampler) — the browser ring buffer is the first cut; we re-evaluate if/when it proves insufficient.
- Embedded Grafana panels.
- Bulk inject (multiple keys atomically).
- Paginated dashboard (assume < 30 instances per deployment).
- Multi-Redis support.

## 3. Architecture changes

```
┌─────────────────┐                ┌─────────────────────────────────────┐
│ plugin runners  │  every cycle:  │ Redis                                │
│ (plc-result-v2, │ ──────────────▶│   cfg:<p>:<i>     status:<p>:<i>     │
│  camera v2, …)  │                │   schema:<p>:<i>  audit:<p>:<i>      │
└─────────────────┘                │   tags:<p>:<i>    io:in:<plc_key>    │
                                   │   io:out:<plc_key>  get_result_*     │
                                   └────────────┬────────────────────────┘
                                                │
                                                ▼
                                   ┌─────────────────────────────────────┐
                                   │ plc-comm-ops FastAPI backend         │
                                   │   GET /api/dashboard.json (poll src) │
                                   │   POST /plugin/{p}/{i}/inject        │
                                   │   GET  /plugin/{p}/{i}/inject-targets│
                                   │   POST /plugin/{p}/{i}/save (v1)     │
                                   └────────────┬────────────────────────┘
                                                │ JSON
                                                ▼
                                   ┌─────────────────────────────────────┐
                                   │ browser (dashboard.html + .js)       │
                                   │   ┌─────────────────────────────┐    │
                                   │   │ expandable table             │    │
                                   │   │  ▶ per-row collapsed summary │    │
                                   │   │  ▼ on click → trendline +    │    │
                                   │   │    cfg edit + inject panel   │    │
                                   │   └─────────────────────────────┘    │
                                   │   ring buffer 120 × 1s (per row)     │
                                   │   uPlot per chart                    │
                                   └─────────────────────────────────────┘
```

### 3.1 SDK additions (strokmatic-comm-sdk, v0.2.x — patch, no v0.3.0 needed)

New module `strokmatic_comm_sdk.tags`:

```python
def publish_tags(redis_client, plugin_name: str, instance: str, tags: dict) -> None:
    """Snapshot of live, per-cycle values for the dashboard.

    Plugin runners call this once per cycle after decoding the input lane.
    Values are scalars (int/float/bool/str). Booleans are stored as 0/1
    so the hash is human-grepable.
    """
```

The key is `tags:<plugin_name>:<instance>`. The hash is overwritten in place each cycle (no history; that's the dashboard ring buffer's job).

### 3.2 Plugin updates

**plc-result-v2** — in `Runner.run_one_cycle()`, after `decode_in(...)`, publish a snapshot containing at minimum the state name and the decoded input-lane fields:

```python
publish_tags(self.app_redis, _PLUGIN_NAME, self.cfg.cell, {
    "state": state_name(self._state),  # string name of the state machine state
    "request_result": int(in_lane.request_result),
    "result_write_comp_plc": int(in_lane.result_write_comp_plc),
    "fault_reset_extend": int(in_lane.fault_reset_extend),
})
```

If the runner also has the most-recent `OutLane` at hand (e.g., persisted as `self._last_out`), include `result`, `result_write_comp_dev`, `in_cycle`, `fault_reset` from it. If not, skip those — the dashboard handles missing fields gracefully.

**plc-monitor-camera-v2** — analogous: state name + decoded input-lane fields. The exact field set is decided when the change is made; reading the existing decoder is the source of truth.

These touches add ~5 lines per runner and one import. Naming convention: bool fields stored as `0`/`1` (int), state stored as string, ints/floats stored as themselves.

### 3.3 plc-comm-ops backend

Routes after v1.1:

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | unchanged |
| GET | `/` | server-renders dashboard skeleton (one initial snapshot) |
| GET | `/api/dashboard.json` | polled every 1 s by JS. Returns array of `{plugin, instance, health, status, tags}` |
| POST | `/plugin/{p}/{i}/save` | unchanged (cfg edit) |
| GET | `/plugin/{p}/{i}/status` | unchanged (HTMX partial — still useful as a fallback when JS is off; the dashboard JS uses /api/dashboard.json instead) |
| GET | `/plugin/{p}/{i}/inject-targets` | returns allowed inject targets for this plugin (see §4.2) |
| POST | `/plugin/{p}/{i}/inject` | writes one value to one Redis key (see §4.1) |

**Removed:** the per-plugin detail page route `GET /plugin/{p}/{i}` (the dashboard absorbs its function). Old template files (`list.html`, `plugin.html`) are deleted; `partials/status_panel.html` is retained for the HTMX partial route.

## 4. Inject — semantics and safety

### 4.1 POST `/plugin/{p}/{i}/inject`

**Body:**
```json
{
  "target_key": "cfg:plc-result-v2:BSL01",
  "target_field": "cycle_period_ms",
  "value": "100"
}
```

For namespaces where the key itself IS the target (no field):
```json
{
  "target_key": "192.168.15.10_GET_RESULT_CONFIRM",
  "value": "1"
}
```

**Allowed `target_key` prefixes:** `cfg:`, `io:in:`, and well-known `get_result_*` keys reported by `/inject-targets`.

**Denied:** `io:out:*` (those are runner-owned outputs; injecting them is meaningless), `audit:*`, `schema:*`, anything outside the allowed list.

**Semantics:**
- `cfg:<p>:<i>` + `target_field` → field-level patch over the current doc, then call `save_cfg(...)` so it goes through the optimistic-concurrency + audit path. (cached_raw is read fresh by the server in this case — we trust the engineer's intent over a race window.)
- `io:in:<plc_key>` + `target_field` → look up the byte offset for `target_field` from the plugin's IoMap (already in the cfg), write a single byte at that offset to the existing buffer via `hset` (or `setrange`). If the buffer doesn't exist, create it as 48 zero bytes first.
- `get_result_*` → direct `set(target_key, value)`. No field.

**Audit:**
- For `cfg:*` injects: audit comes from `save_cfg()`'s existing path. No extra audit entry — avoid double-logging.
- For `io:in:*` and `get_result_*` injects: the inject handler emits an audit entry directly to `audit:<plugin>:<instance>` stream with `field_path=inject:<target_key>:<target_field>` (or `field_path=inject:<target_key>` if no field), `actor=<request.client.host>`, `old=<read-back-before>`, `new=<value>`.

**Validation:**
- For cfg field injects, the field name must exist in the plugin's published JSON Schema (`schema:<p>:<i>`).
- For io:in injects, the field name must exist in the cfg's `io_map.<field>_off` (e.g., `request_result_off`).
- For get_result_*, the key must be in the list returned by `/inject-targets`.

### 4.2 GET `/plugin/{p}/{i}/inject-targets`

Returns:
```json
{
  "cfg_fields": ["plc_key", "cell", "cycle_period_ms", "fault_extend_enabled", ...],
  "io_in_fields": ["request_result", "result_write_comp_plc", "fault_reset_extend"],
  "get_result_keys": [
    "192.168.15.10_GET_RESULT",
    "192.168.15.10_GET_RESULT_CONFIRM",
    "192.168.15.10_RETURNED_RESULT"
  ]
}
```

Sources:
- `cfg_fields` ← scalar fields from `schema:<p>:<i>` (objects/nested handled like the form renderer does today).
- `io_in_fields` ← keys ending in `_off` in `cfg.io_map` (empty list if the plugin doesn't expose an `io_map`).
- `get_result_keys` ← any string fields in cfg whose name ends with `_key` and whose value is non-empty (empty list if none). For plc-result-v2 this surfaces `get_result_key`, `get_result_confirm_key`, `returned_result_key`. Generic across plugins.

## 5. UI behavior

### 5.1 Dashboard layout

Server-rendered skeleton (one HTTP round-trip to `/`):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ PLC Comm Ops                                                       v1.1      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Plugin / Instance        State    Period   Cycle µs   Result   Errors   ●   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ plc-result-v2 / BSL01   IDLE    50ms       4 200    1 247       0     🟢 │
│ ▼ plc-result-v2 / BSL07   ERROR  100ms      12 500      342      17     🔴 │
│     ┌────────────────────────────────────────────────────────────────┐       │
│     │ Trendline (last 2 min, 1 Hz)                                    │       │
│     │   cycle_us:  [uPlot chart, ~600 px wide]                        │       │
│     │   errors  :  [uPlot chart, same width]                          │       │
│     │                                                                 │       │
│     │ Live tags                                                       │       │
│     │   request_result: 0    result_write_comp_plc: 1                 │       │
│     │   fault_reset_extend: 0   in_cycle: 1                           │       │
│     │                                                                 │       │
│     │ Config (live edit)         │ Inject (debug only)                │       │
│     │ cycle_period_ms: [ 100 ]   │ Target:    [ io:in:plc_key  ▾ ]    │       │
│     │ plc_key:         [ ... ]   │ Field:     [ request_result ▾ ]    │       │
│     │ fault_extend:    [✓]       │ Value:     [ 1 ]                   │       │
│     │ [ Save ]                   │ [ Inject ] (with confirm dialog)   │       │
│     └────────────────────────────────────────────────────────────────┘       │
│ ▶ plc-monitor-camera-v2 / WELD42  AWAIT  100ms  8 700  891    3        🟡 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 JS polling loop

- `setInterval(fetchDashboard, 1000)` after page load.
- `fetchDashboard()` does `GET /api/dashboard.json`, then:
  - For each row, update cells in place (don't replace DOM nodes — preserve form input focus).
  - For each expanded row, append `{t: now, cycle_us, error_count}` to its ring buffer and call `uPlot.setData(...)`.
- Ring buffer capacity: 120 samples per row per metric. ~2 min at 1 Hz. Older samples drop off the front.
- When a row collapses, its ring buffer is kept in memory (cheap) but not redrawn.

### 5.3 Deep links

URL hash `#<plugin>/<instance>` (e.g., `#plc-result-v2/BSL01`) auto-expands that row on page load. Subsequent expand/collapse interactions don't rewrite the hash — the URL is for share-a-view, not for tracking session state. Multiple expanded rows are allowed via clicks; the hash only opens one initially.

### 5.4 Inject UI

- Two-step: pick target (dropdown grouped by namespace) → enter value → press "Inject" → confirm dialog ("Inject `value` to `target_key:target_field`?") → submit.
- Above the inject panel: a small `<mark>` banner: "Inject writes raw Redis values. Do not use in production unless you know what you're doing."
- On 200 response: green flash + refresh tags.
- On 4xx/5xx: red `<mark>` with the server's error message.

### 5.5 Cfg edit panel

Same form renderer as v1 (the `schema.py` module is reused unchanged). The form posts to the existing `/plugin/{p}/{i}/save` route. On success the server still returns 303 redirect — JS catches the redirect, refreshes the row's data, and keeps focus on the row instead of navigating away.

## 6. Health logic (unchanged from v1)

`StatusTracker.health_color()` keeps its semantics. Decoded tag fields are not part of the health calculation; they're informational.

## 7. Module / file structure

New files in `plc-comm-ops`:
- `plc_comm_ops/dashboard.py` — builds the `/api/dashboard.json` payload.
- `plc_comm_ops/inject.py` — validates + executes inject writes, emits audit.
- `plc_comm_ops/templates/dashboard.html` — new template, replaces `list.html` and `plugin.html`.
- `plc_comm_ops/static/dashboard.js` — polling loop, ring buffer, uPlot rendering, inject form handler.
- `plc_comm_ops/static/dashboard.css` — small overrides on Pico (sticky header, expanded-row styling).
- `tests/test_dashboard.py` — covers `/api/dashboard.json`.
- `tests/test_inject.py` — covers `/inject` + `/inject-targets`.

Modified files:
- `plc_comm_ops/app.py` — replace `/` and `/plugin/{p}/{i}` routes; add new routes.
- `pyproject.toml` — add `python-multipart` (already there) and a `static/` package data declaration so the `static/` directory ships in the wheel.
- `plc-comm-ops.Dockerfile` — `COPY plc_comm_ops/static/ ... ` (it's already covered by `COPY plc_comm_ops/`).

Deleted files:
- `plc_comm_ops/templates/list.html`
- `plc_comm_ops/templates/plugin.html`

Retained:
- `partials/status_panel.html` (HTMX partial route still exists)
- All v1 modules: `discovery.py`, `status.py`, `schema.py`, `editor.py`, `settings.py`.

New files in `strokmatic-comm-sdk`:
- `src/strokmatic_comm_sdk/tags.py` — `publish_tags()` helper.
- `tests/test_tags.py` — covers the helper.
- `__init__.py` — re-export `publish_tags`.

Modified files in plugins:
- `plc-result-v2/plc_result_v2/runner.py` — call `publish_tags(...)` per cycle.
- `plc-monitor-camera-v2/plc_monitor_camera_v2/runner.py` — same.
- Both `pyproject.toml`s — bump SDK pin from `@v0.2.0` to `@v0.2.1` after we tag.

## 8. Front-end dependencies

- **Pico.css** (already pinned in v1 from CDN).
- **uPlot** — load from CDN: `https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.iife.min.js`. ~50 KB minified, no deps, MIT license.
- No npm, no build step. The JS module is plain ES modules served by FastAPI's `StaticFiles` mount.

## 9. Tests

**SDK:** `test_tags.py` — `publish_tags` writes the right hash, overwrites prior values, handles bools/ints/strings/floats.

**plc-result-v2:** add 1 test to `test_runner_integration.py` — after `run_one_cycle()`, assert `tags:plc-result-v2:<cell>` has the decoded fields.

**camera v2:** same pattern.

**plc-comm-ops:**
- `test_dashboard.py` — `/api/dashboard.json` returns the expected shape; empty list when no plugins; correct health colors; tags hash echoed back.
- `test_inject.py` — covers each namespace (cfg field, io:in field, get_result_*), each rejection case (forbidden namespace, unknown field), and audit emission.
- `test_routes.py` (existing) — assertions for v1's removed routes are deleted; the `GET /` test is replaced with one that asserts the dashboard skeleton renders.

No JS tests. Manual smoke after build.

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Polling 1 Hz × N plugins × M browsers could pressure Redis. | At 30 plugins × 5 browsers × 1 Hz = 150 hgetall/s. Redis on local network handles 10k/s. Not a concern at v1.1 scale. Re-evaluate at 100+ plugins. |
| R2 | uPlot/Pico CSS conflict (data attributes, table styling). | uPlot draws to its own `<div>` with inline canvas; no class collision. Verified by reading uPlot's docs. |
| R3 | Inject misuse in production (engineer pokes a value that breaks the line). | Confirm dialog + banner + audit log. Not bullet-proof; we accept the risk. v1.2 may add a "production lock" toggle on the server-side gated by an env var. |
| R4 | Form input focus loss during 1 Hz refresh. | JS updates cells via `textContent` or `value` setters, never replaces input DOM nodes. Tested manually post-build. |
| R5 | tags hash drift — plugin writes `state` as enum int, dashboard expects string. | We standardize: bools as 0/1, ints as ints, states as strings. Spec'd in §3.2 SDK helper signature comment. |
| R6 | Ring buffer memory leak if user leaves dashboard open overnight with many plugins. | 120 samples × 4 floats × 30 plugins × 2 metrics = ~30 KB. Negligible. |
| R7 | `setrange` on a missing io:in key needs initialization (otherwise it's a 48-byte null). | Inject handler initializes the io:in:<plc_key> buffer to 48 zero bytes if it doesn't exist before writing. |

## 11. Migration / rollout

- v1.1 is a single deploy of plc-comm-ops + a coordinated bump of the two plugin pins to SDK v0.2.1.
- The SDK gets a patch tag (`v0.2.1`); no breaking changes for any existing consumers (publish_tags is purely additive).
- Operators get a different-looking dashboard on the next refresh. Bookmarks to `/plugin/{p}/{i}` will 404 — minor; we accept it since v1 was just-shipped and no operators have bookmarks yet.

## 12. Out-of-scope clarifications

- **Why not server-side timeseries now?** Browser ring buffer covers "look at the last 2 minutes". Anything longer is observability/Prometheus territory, and Grafana is already on `:8100`. We avoid duplicating infra. If demand emerges for longer windows or alerting, v1.2 adds a Redis Streams sampler.
- **Why not Chart.js / Plotly?** uPlot is the fastest browser plotter, smallest dep, and the chart needs are minimal (line series, no interactivity beyond hover). Chart.js would add ~60 KB for features we don't use.
- **Why not htmx for the dashboard polling?** htmx would re-render rows server-side every second, costing more bandwidth and losing client-side ring buffer state. JS poll + JSON is the right tool here.
- **Why are we keeping `GET /plugin/{p}/{i}/status` as an HTMX partial route?** It's tiny and the v1 templates that reference it are gone, but other tooling (curl, dashboards) might use it. Cheap to keep.

## 13. Acceptance criteria

- [ ] `/` renders the dashboard with all discovered plugins as rows.
- [ ] Clicking ▶ expands a row inline; clicking ▼ collapses it.
- [ ] Expanded row shows the cfg edit form (functional) + live tag values + two uPlot trendlines.
- [ ] Editing a cfg field and pressing "Save" updates Redis and the page reflects the new value within 1 second without a full reload.
- [ ] An optimistic-concurrency conflict (cfg changed between load and save) shows a 409 error message inline.
- [ ] Picking a target + field + value in the Inject panel and confirming writes the value to Redis and adds an entry to `audit:<p>:<i>`.
- [ ] Trendline charts show the last ~2 minutes of cycle_us and error_count at 1 Hz.
- [ ] Polling does not steal focus from an active form input.
- [ ] All Python tests green (existing v1 tests minus the deleted-route tests, plus new tests for dashboard + inject).
- [ ] Container builds and runs; `curl /healthz` returns `ok`; `curl /` returns HTML containing `dashboard`.

## 14. Open questions (resolved)

| Q | Decision |
|---|---|
| What is a "tag"? | Plugin-decoded lane fields + state name, published per cycle to `tags:<p>:<i>`. |
| Trend store? | Browser ring buffer, 120 × 1 Hz. |
| Trendline metrics? | `cycle_us` and `error_count`. Add more later if asked. |
| Layout? | Expandable single-page table. |
| All four features at once? | Yes — single coordinated v1.1 build. |
| SDK version? | Patch bump: `v0.2.1` (additive only). |
| JS library? | uPlot, served from CDN. |
| Inject scope? | `cfg:*`, `io:in:*`, `get_result_*`. Audit always emitted. |

---

## Appendix A — File-level diff summary

```
strokmatic-comm-sdk/
  src/strokmatic_comm_sdk/
    tags.py                                    [NEW]
    __init__.py                                [MOD: re-export publish_tags]
  tests/test_tags.py                           [NEW]
  pyproject.toml                               [MOD: version 0.2.0 → 0.2.1]

plc-result-v2/
  plc_result_v2/runner.py                      [MOD: publish_tags() call]
  pyproject.toml                               [MOD: pin → @v0.2.1]
  plc-result-v2.req                            [MOD: pin → @v0.2.1]
  tests/v2/test_runner_integration.py          [MOD: +1 tags test]

plc-monitor-camera-v2/
  plc_monitor_camera_v2/runner.py              [MOD: publish_tags() call]
  pyproject.toml                               [MOD: pin → @v0.2.1]
  plc-monitor-camera-v2.req                    [MOD: pin → @v0.2.1]
  tests/v2/test_runner_integration.py          [MOD: +1 tags test]

plc-comm-ops/
  plc_comm_ops/
    app.py                                     [MOD: replace routes]
    dashboard.py                               [NEW]
    inject.py                                  [NEW]
    static/dashboard.js                        [NEW]
    static/dashboard.css                       [NEW]
    templates/dashboard.html                   [NEW]
    templates/list.html                        [DELETE]
    templates/plugin.html                      [DELETE]
    templates/partials/status_panel.html       [KEEP]
  tests/
    test_dashboard.py                          [NEW]
    test_inject.py                             [NEW]
    test_routes.py                             [MOD: remove dead-route tests]
  pyproject.toml                               [MOD: pin → @v0.2.1, static package data]
  plc-comm-ops.req                             [MOD: pin → @v0.2.1]
```
