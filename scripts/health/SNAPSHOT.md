# Health Monitor — Snapshot Contract

Every product collector must emit a JSON object conforming to this schema.
The core pipeline validates each snapshot before storing or alerting on it.

## Schema Version

`"schema": 1`

## Top-Level Fields

| Field          | Type            | Required | Description                                               |
|----------------|-----------------|----------|-----------------------------------------------------------|
| `schema`       | number (=1)     | yes      | Schema version — must be exactly `1`                      |
| `product`      | string          | yes      | Product identifier (e.g. `"vk"`, `"sf"`)                 |
| `deployment`   | string          | yes      | Deployment code (e.g. `"03002"`, `"02008"`)               |
| `collected_at` | string (ISO8601)| yes      | UTC timestamp when the snapshot was collected             |
| `nodes`        | array           | yes      | List of node reachability records (see below)             |
| `metrics`      | object          | yes      | Flat map of metric keys → numeric values (see below)      |

### `nodes[]` entries

Each element in `nodes` must have:

| Field       | Type    | Description                                   |
|-------------|---------|-----------------------------------------------|
| `name`      | string  | Node identifier — lowercase alphanumeric, `_`, `.` (e.g. `"vk01"`) |
| `reachable` | boolean | Whether the node responded during collection  |

### `metrics` object

A flat key→value map where:

- Every **key** must match `^[a-z0-9_.]+$` (lowercase, digits, underscore, dot only).
- Every **value** must be a finite JavaScript number (`typeof v === 'number' && Number.isFinite(v)`).
- Keys follow the convention `node.<name>.<subsystem>.<detail>` for per-node metrics.
  Examples:
  - `node.vk01.disk.root.pct` — root-disk usage percent on vk01
  - `node.vk01.gpu.0.mem.pct` — GPU 0 memory usage percent on vk01
  - `node.vk03.gui.80.up` — port-80 GUI up/down flag on vk03 (1=up, 0=down)
  - `node.server.disk.root.pct` — root-disk usage percent on server

## Fail-Open Rule

If a node entry in `nodes[]` has `reachable: false`, the snapshot **must not** include
any `node.<name>.*` metric keys for that node other than `node.<name>.reachable` (which
must be `0`).

Rationale: an unreachable node cannot supply metrics. Including stale or zero-filled
metrics for an unreachable node would silently suppress alerts.

This rule is enforced by `validateSnapshot` in `tests/health/helpers/schema.mjs`.
