---
type: Design Spec
title: strokmatic-eip — Generic Certified EtherNet/IP Communication Layer
description: Replace today's three entangled PLC-comm stacks (pylogix Class 1 fork, pylogix Class 3, OpENer C with embedded camera-acquisition logic) with a clean two-layer architecture:
timestamp: 2026-05-07
---

# strokmatic-eip — Generic Certified EtherNet/IP Communication Layer

**Date:** 2026-05-07
**Author:** Pedro Teruel + Claude Opus 4.7
**Status:** Design — pending user review before implementation planning
**Repo:** https://github.com/strokmatic/strokmatic-eip
**Product code:** `STROKMATIC-COMM-V1`

---

## Summary

Replace today's three entangled PLC-comm stacks (pylogix Class 1 fork, pylogix Class 3, OpENer C with embedded camera-acquisition logic) with a clean two-layer architecture:

1. **A single ODVA-certified C process** (`strokmatic-eip`) running OpENer with a thin Redis bridge — purely an EtherNet/IP Class 1 adapter that mirrors a fixed-shape I/O assembly to/from Redis. **Zero application logic.**
2. **N independent Python plugin containers** subscribed to the same Redis, each implementing one application-specific handshake state machine. Plugins read live-tunable parameters from Redis on every cycle and can be swapped or restarted without dropping the EIP connection.

The certification is locked to the C layer's EDS shape. Adding, editing, or replacing plugins (today: `plc-monitor-camera`, `plc-result`; future: anything) never triggers ODVA recertification. This is **cross-product infrastructure** — first consumer is SpotFusion, with VisionKing and DieMaster as candidate adopters.

---

## Problem

Today's SpotFusion uses three different PLC communication stacks:

| Stack | Used by | Cert? |
|---|---|---|
| pylogix Class 1 (custom Adapter fork) | `plc-monitor-camera`, `plc-result` | No |
| pylogix Class 3 (stock) | `tag-monitor` (poll loop), `PLC3` helper inside above | Not required |
| OpENer C binary, with camera-acq logic in C | `plc-monitor-camera-opener` | Yes (legacy `strokmatic-opener` fork) |

The certified path duplicates the pylogix path's logic in C. Any change to the camera-acquisition handshake means re-cutting C, re-running the ODVA conformance test, and a 6-week schedule slip. `plc-result` has no certified twin yet — adding one would be another full cert. Multiplying logics under this regime multiplies cert events, which is unsustainable.

---

## Goals

- One ODVA conformance test pass that covers all current SpotFusion logic and all future logics (and other Strokmatic products) without recertification.
- Plugin authors write only Python state machines, never touch the C layer.
- On-site commissioning can adjust handshake parameters (timeouts, byte mappings, feature flags) **at runtime** without process restart.
- Existing customer lines keep running on the legacy stack until cut over deliberately, with a full bit-for-bit comparison gate.
- Architecture remains compatible with later live-Python plugin hot-swap (Level 5) without rebuilding.

## Non-Goals (v1)

- Migrating `tag-monitor` (Class 3 polling stays as-is — out of scope).
- Building a declarative state-machine engine (Level 4) — Python is the plugin language, period.
- Live Python hot-reload (Level 5) — kept compatible, not built.
- Redis HA failover.
- A polished ops UI — minimal FastAPI form is enough for v1.
- VisionKing or DieMaster adoption — only after SpotFusion runs stably on at least one customer line for ≥30 days.

---

## Decisions Locked

These are the load-bearing branches resolved during brainstorming. Each is a hard commitment for v1.

| Decision | Choice | Why |
|---|---|---|
| Process topology | One OpENer per PLC, N plugins | Single EIP connection, single cert covers all logic on that PLC |
| Class 3 scope | Out of scope | tag-monitor uses stock pylogix Class 3 directly; OpENer is Class 1 only |
| Plugin model | Docker containers, Redis IPC | Same pattern as today's services; cheap to add/swap; container-level isolation |
| Runtime edit level | Level 1 (container swap, EIP preserved) + Level 3 (live params in Redis) | Sweet spot for industrial commissioning; Level 5 deferred but compatible |
| C codebase strategy | Fresh fork of upstream OpENer with thin Strokmatic adapter | Cleanest cert story long-term; legacy GCS fork preserved as archaeology source |
| I/O assembly size | 128 bytes input + 128 bytes output | ≥9× headroom over current usage; clean 32×DINT layout for Logix integrators |
| Repo location | `github.com/strokmatic/strokmatic-eip` (NEW), `master` is generic v1; legacy preserved on `legacy/*` branches | Cross-product positioning; clean slate; full history retained |

---

## Architecture

### High-level

```
                                                 Redis (per-PLC namespace)
                                                 ├── io:in:<PLC_KEY>   ← PLC→device, raw 128 bytes
                                                 ├── io:out:<PLC_KEY>  ← device→PLC, raw 128 bytes
┌──────────┐   EtherNet/IP Class 1   ┌─────────┐ ├── cfg:<plugin>:<inst>      ← live-tunable params (JSON)
│   PLC    │ ─── (one connection) ─→ │ OpENer  │ ├── status:<plugin>:<inst>   ← health/heartbeat
│ Scanner  │ ←── (cyclic I/O) ──────│  + redis│ ├── status:comm:<PLC_KEY>    ← OpENer health
└──────────┘                         │ bridge  │ ├── audit:<plugin>:<inst>    ← Redis stream of cfg edits
                                     │ (C)     │ └── schema:version           ← e.g. "1.0.0"
                                     └────┬────┘
                                          │ HSET/GET/SETRANGE polling (no pub/sub in v1)
                                          ▼
                                ┌─────────────────────────────────┐
                                │ Plugin containers (N per PLC)   │
                                │  • plc-monitor-camera-v2        │
                                │  • plc-result-v2                │
                                │  • <future logic>               │
                                └─────────────────────────────────┘
```

### Key invariants

- The OpENer process **contains zero business logic**. Pure I/O-assembly ↔ Redis mirror.
- The **EDS file (assembly shape, identity, services) is fixed at cert time**. Every byte allocation for any current or future plugin lives **inside** that fixed envelope.
- Plugins **never** talk to the PLC directly. They only read/write Redis. The OpENer process is the sole owner of the EIP connection.
- A plugin restart never drops the EIP connection. A plugin crash never crashes OpENer.
- Plugins read `cfg:*` on every cycle (no caching) — change a value via `redis-cli HSET` or an ops UI and the next tick uses it. This is the Level 3 runtime-tunability mechanism.

### Components

#### `strokmatic/strokmatic-eip` (C, certified)

- Fresh fork of upstream OpENer at a pinned tag (added as git submodule for explicit upgrades).
- One new C module `strokmatic/redis_bridge.c` (~hundreds of LoC) mirroring the I/O assemblies to/from Redis.
- Cert-required deltas from the legacy GCS fork are categorized in Phase 0 and re-applied here as discrete commits with rationale.
- Build-time identity injection: `EDS_REVISION_MAJOR`, `EDS_REVISION_MINOR`, `EDS_IDENTITY_HASH` from a single `cert/EDS_REVISION` source-of-truth file consumed by CI and the C build.
- No app-specific tag names, no handshake state, no conditional logic.

External contract:
- I/O assemblies: instance 100/101 = input/output, 128 bytes each
- EDS Identity: vendor=Strokmatic, product code = `STROKMATIC-COMM-V1`
- Network: bound to interface from env `EIP_IFACE`, `network_mode: host`
- Redis: env `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`; key namespace = env `PLC_KEY`
- RPI range: 5 ms min, 1000 ms max

#### `strokmatic/strokmatic-comm-sdk` (Python library)

The contract surface every plugin uses to talk to the comm layer. Cross-product, separate repo from `strokmatic-eip` (different language, different release cadence, different consumers).

Public API sketch:
```python
class PLCBus:
    def __init__(self, plc_key: str, redis: redis.Redis): ...
    def read_lane(self, offset: int, length: int) -> bytes: ...
    def write_lane(self, offset: int, data: bytes): ...
    def comm_alive(self) -> bool: ...

class PluginConfig(BaseModel):
    """Subclass per plugin. Pydantic validates each cfg:* read."""
    @classmethod
    def load(cls, redis, plugin_name, instance) -> "PluginConfig": ...

class Heartbeat:
    def beat(self): ...

class AuditLog:
    def log_change(self, field_path, old, new, actor): ...
```

The SDK is the **only** sanctioned way for plugins to reach the comm layer. Direct `redis.hset(...)` from a plugin is a code-review violation.

#### Plugin containers (Python, N per PLC)

Skeleton per plugin:
- `<plugin>.py` — the state machine (the differentiated logic)
- `config.py` — Pydantic schema for tunable params (including `io_map` byte offsets)
- `<plugin>.Dockerfile`, `<plugin>.yml`, `<plugin>.req`
- `tests/` — unit tests against `FakePLCBus` from the SDK; integration tests against real Redis

v1 plugins:
- `plc-monitor-camera-v2` — replaces both the existing `plc-monitor-camera` (pylogix Class 1) AND the camera-acquisition logic baked into the legacy strokmatic-opener C
- `plc-result-v2` — replaces existing `plc-result`

#### Byte-allocation registry

`topologies/<name>/byte-map.yaml` declares which 16-byte lanes belong to which plugin. The deployment-runner refuses to schedule on overlap, and injects each plugin's lane range as the env var `LANE_RANGE` (e.g. `16-31`). Plugins fail-fast at startup if any byte offset in their `io_map` config falls outside `LANE_RANGE`. Two layers of defense: declarative conflict detection at deploy time, and runtime validation per process.

Default 128-byte layout:

| Range | Lane | Owner |
|---|---|---|
| 0–15 | header | comm-layer (reserved, certified) |
| 16–31 | camera_acq | plc-monitor-camera-v2 |
| 32–47 | result | plc-result-v2 |
| 48–63 | spare | future |
| 64–79 | spare | future |
| 80–95 | spare | future |
| 96–111 | spare | future |
| 112–127 | spare | future |

Header lane (always certified, always present):

| Bytes | Field | Source |
|---|---|---|
| 0–3 | `comm_heartbeat` (uint32) | OpENer increments every cycle |
| 4–5 | `comm_status_flags` (bitfield) | bit 0 = redis_connected, bit 1 = healthy, ... |
| 6–13 | `eds_identity_hash` (8 bytes) | static at build time |
| 14–15 | reserved | — |

#### Ops touchpoint (minimal)

A tiny FastAPI service `plc-comm-ops` (~200 LoC):
- Lists plugins discovered from `cfg:*` keys
- Renders each plugin's Pydantic schema as an HTML form
- Validates and POSTs edits to Redis, writes `audit:*` entry

No auth (operator network). v1 only.

---

## IPC Contract (v1.0.0)

### Key schema

```
io:in:<PLC_KEY>        string, 128 bytes raw (PLC → device, written by comm layer)
io:out:<PLC_KEY>       string, 128 bytes raw (device → PLC, written by plugins)

cfg:<plugin>:<inst>    string, JSON blob (Pydantic-validated; atomic doc edits)

status:<plugin>:<inst> hash (last_beat_ms, last_cycle_us, error_count, last_error, ...)
status:comm:<PLC_KEY>  hash (same shape, written by OpENer)

audit:<plugin>:<inst>  stream (XADD on every cfg change; ts, actor, field, old, new; MAXLEN 10000)

schema:version         string, e.g. "1.0.0"
```

The comm layer **only** touches `io:in:*`, `io:out:*`, `status:comm:*`. It is blind to `cfg`, `audit`, `status:plugin:*`. That blindness is what makes it generic.

### I/O wire format

`io:in:<PLC_KEY>` and `io:out:<PLC_KEY>` are **single 128-byte Redis strings**, not hashes of named tags. The C side stays trivial: one `SET` (or `SETRANGE`) per cycle. Plugins use `GETRANGE` to read their lane and `SETRANGE` to write. Byte offsets come from each plugin's `cfg:*.io_map`, so they're Level 3 tunable. **Adding a new tag = pick an unused byte in the lane registry, add it to the plugin's `io_map`. No comm-layer change, no rebuild, no recert.**

This is a deliberate departure from today's `hash[IP_PLC] → {tag_name: value}` pattern. Today's pattern entangles tag naming with the comm layer — exactly the entanglement we're removing.

### Update mechanics

Polling everywhere, no pub/sub in v1:
- **OpENer cycle** (every EIP RPI, e.g. 10 ms): read 128 bytes from `io:out:<PLC>` via `GET` → copy to EIP output assembly → send to PLC. On EIP input change → `SET io:in:<PLC>`.
- **Plugin cycle**: read input lane via `GETRANGE`, read `cfg:*` JSON, run state machine, write output lane via `SETRANGE`, beat `status:*`.

Industrial cycles (10–50 ms) are well within Redis polling latency; the math says ~hundreds of GETs/sec per PLC, which Redis handles trivially. Pub/sub is an optimization we layer on later only if telemetry shows we need it.

### Schema versioning

`schema:version` Redis key + `eds_identity_hash` in the I/O header pin both ends. SDK refuses to start if `schema:version` is missing or doesn't match the SDK's expected major version. Comm layer refuses to start if EDS revision compiled in doesn't match a value injected at deploy time. Mismatch = loud failure, not silent drift.

---

## Certification Envelope

### What gets certified

| EDS field | Locked at cert | Recert if changed? |
|---|---|---|
| Vendor ID | Strokmatic | yes |
| Product Code | `STROKMATIC-COMM-V1` | yes (new product) |
| Major / Minor Revision | tracked, e.g. `1.0` | minor: no, major: yes |
| Input Assembly | instance 100, 128 bytes | yes if size or instance changes |
| Output Assembly | instance 101, 128 bytes | yes if size or instance changes |
| Configuration Assembly | instance 102, 0 bytes (none) | yes if added |
| Connection RPI range | min 5 ms, max 1000 ms | recheck if widened |
| Identity Object services | per OpENer baseline + Strokmatic deltas (Phase 0) | yes if changed |
| Conformance test version | per ODVA at cert time | n/a |

Everything else is data inside those 128 bytes.

### Recertification triggers

| Change | Recert? |
|---|---|
| New plugin (Python) | No |
| Plugin parameter change in `cfg:*` | No |
| New byte assignment within an existing lane | No |
| Bug fix in `redis_bridge.c` (no protocol change) | No |
| Upstream OpENer security fix touching CIP behavior | Yes (minor revision) |
| Increase assembly size (e.g. 128 → 256) | Yes |
| New CIP service or Identity field | Yes |

Hard rule: **anything that touches the EDS file requires a new conformance test.** C source can be patched freely as long as the EDS shape is unchanged AND patches don't alter wire-protocol behavior. This is documented in `CERTIFICATION.md` on the v1 repo so future engineers don't accidentally trigger recert.

### Build-time identity injection

`EDS_REVISION_MAJOR`, `EDS_REVISION_MINOR`, `EDS_IDENTITY_HASH` come from `cert/EDS_REVISION` (single source of truth) and are:
- Compiled into the Identity Object response
- Written into header bytes 6–13 of the output assembly
- Pushed to `status:comm:<PLC>` (so plugins/ops UI can verify match)

---

## Phased Migration

### Phase 0 — Diff archaeology (1–2 weeks)

Output: `docs/superpowers/audits/2026-05-07-phase0-eip-fork-audit.md` (new `audits/` folder, distinct from `specs/`)

The legacy GCS `strokmatic-opener` fork has cert-required modifications vs. upstream OpENer. Nobody remembers what they are. Phase 0 reads the code:

1. Clone strokmatic-opener (already done at `~/JARVIS/workspaces/strokmatic/sdk/strokmatic-opener/`; preserved on `github.com/strokmatic/strokmatic-eip` as `legacy/master` and tag `legacy-cert-submitted-2024-06-19`).
2. Identify the upstream OpENer base it was forked from (likely from `legacy/master` first commits).
3. Diff `legacy-cert-submitted-2024-06-19` against that upstream base.
4. Categorize each delta:
   - **A.** Cert-required stack fix → re-apply to `master`
   - **B.** Build/CI/packaging → revisit per-item
   - **C.** App-specific logic (camera-acquisition handshake) → must NOT transfer
   - **D.** Unknown → resolve with original author or default to "do not transfer"
5. Locate the original ODVA conformance report and EDS file from cert submission.

Phase 1 (Python) can run in parallel with Phase 0. **Phase 2 (C work) blocks on Phase 0 completion.**

### Phase 1 — Python side (2–3 weeks)

- `strokmatic/strokmatic-comm-sdk` v0.1: `PLCBus`, `PluginConfig`, `Heartbeat`, `AuditLog`, `FakePLCBus` for tests
- `plc-monitor-camera-v2` branch in existing repo, using the SDK
- A `FakeCommLayer` Python script (no real EIP — reads/writes `io:in`/`io:out` from a scenario file) for plugin testing without hardware
- Tests: bit-for-bit golden replay against captured production logs from the legacy `plc-monitor-camera`

Output: SDK published to internal PyPI, plugin runs against fakes.

### Phase 2 — C side (3–6 weeks, blocked by Phase 0)

- Fresh upstream OpENer fork on `master` of `strokmatic-eip`
- Re-apply Phase-0 categorized "A" deltas as discrete, well-explained commits
- Add `redis_bridge.c`
- Write EDS file for `STROKMATIC-COMM-V1` (128/128, instance 100/101)
- Build and run conformance test against ODVA test tool (in-house first, then ODVA lab for the formal cert)

Output: certified C binary + EDS + cert report.

### Phase 3 — End-to-end on lab cell (1–2 weeks)

Run strokmatic-eip + plc-monitor-camera-v2 + plc-result-v2 against a real PLC in the lab. Compare bit-for-bit against the legacy stack on the same handshake scenarios.

**Acceptance gate:** identical PLC-side bytes for every captured production scenario; no missed cycles under sustained load.

### Phase 4 — Customer cutover (per customer)

For each customer line, when window allows:
1. Deploy new stack alongside old (different IP)
2. Mirror reads (both stacks see PLC; only old writes)
3. Compare for one shift → flip writes to new stack
4. Decommission old stack

### Coexistence rules

- `plc-monitor-camera` and `plc-result` `main` branches are **frozen** (only critical fixes) once their v2 branches start.
- The deployment-runner refuses to schedule both legacy and v2 against the same PLC simultaneously (same `IP_PLC`). Hard guardrail against split-brain.
- Both stacks emit to the same log infrastructure; v2 adds `status:*` heartbeats. Side-by-side dashboards required for Phase 4 comparison shifts.
- Keep the legacy image in registry and on each customer node ≥6 months post-cutover for fast rollback.

### Total wall time

~10–13 weeks to first customer cutover, assuming Phase 0 doesn't surprise us.

---

## Error Handling & Operations

| Failure | Symptom | Response |
|---|---|---|
| PLC offline / EIP drop | OpENer's connection drops | OpENer retries per CIP. `status:comm:*.last_beat_ms` stalls. PLC sees no scanner output → its own watchdog. Plugins read `comm_layer_alive` flag and stop writing meaningfully. |
| OpENer process crash | `comm_heartbeat` byte freezes | Plugins detect via stale heartbeat (>3 ticks) and enter "comm-down" mode. Container orchestrator restarts. EIP reconnects on recovery. |
| Redis offline | OpENer can't read/write Redis | OpENer logs error per cycle, **continues sending its last-known output to PLC** (never feed PLC stale data without warning). After threshold (default 1s = ~100 cycles), asserts `redis_disconnected` bit in `comm_status_flags` so PLC sees it. Plugins block until Redis returns. |
| Plugin crash | `status:plugin:*.last_beat_ms` stalls; that plugin's output lane stays at last values | Other plugins unaffected. OpENer keeps running. Container orchestrator restarts. PLC ladder logic, if it depends on a plugin, can detect via that plugin's optional in-lane heartbeat byte. |
| Two plugins claim overlapping bytes | One overwrites the other | Caught at deploy time by deployment-runner reading `byte-map.yaml`. Plugins fail-fast at startup if their config addresses bytes outside their declared range. |
| Param schema drift | Plugin reads `cfg:*` JSON, fails Pydantic validation | Plugin logs error, writes `status:*.last_error`, refuses to run. Does NOT silently fall back to defaults. |
| EDS revision mismatch | A plugin built against EDS v1.1 attaches to a comm process running EDS v1.0 | SDK refuses to start when `status:comm:<PLC>.eds_revision` doesn't match its expected. Loud failure at startup. |

### Logging conventions

- All processes emit JSON-structured logs to stdout
- Per-cycle logs disabled by default (would flood at 10 ms cadence) — gated by `LOG_LEVEL=DEBUG`
- State-transition logs always-on (handshake state changes, error counter increments, config reloads)

### Process supervision

docker-compose `restart: unless-stopped` for v1. Real supervision (systemd + alerting) is a deployment concern, not a design concern.

---

## Testing Strategy

### Plugin unit tests (Python, fast, no Redis, no PLC)

Each plugin's logic is `(input_lane_bytes, current_config) → (new_output_lane_bytes, new_internal_state)`. Tests use `FakePLCBus` from the SDK.

- Coverage target: every state transition in the handshake
- Fixture format: YAML scenario files describing `(tick, input_change, expected_output, expected_state)` rows
- **Golden replay** against legacy production logs is the migration acceptance gate

### SDK integration tests (Python + real Redis, no PLC)

Spin up Redis in CI. Verify:
- `cfg:*` round-trip with Pydantic validation
- Audit stream entries written correctly
- Heartbeat semantics
- Schema version mismatch behavior
- `GETRANGE`/`SETRANGE` byte-lane operations

### End-to-end conformance (Phase 3)

Full stack on lab cell. Drive PLC ladder logic through the full handshake repertoire. Capture both stacks (legacy + v2) on the same scenarios; compare byte-by-byte. ODVA conformance test against `strokmatic-eip` separately.

### What we do NOT test in v1

- Redis HA failover (no HA)
- Plugin live hot-reload (deferred Level 2)
- Multi-PLC scaling beyond what topology configurator already validates
- Adversarial inputs from PLC (assumed trusted; industrial-network device, not internet-facing)

---

## Open Questions

None at design time. The following are deliberate v1-deferrals:

- **Live Python hot-swap (Level 5):** architecturally compatible (each plugin is a self-contained process with a Redis IPC contract), not built. A future "live-edit" plugin can expose an HTTP endpoint to receive new code and `exec` it; this is purely a per-plugin concern and doesn't constrain the comm layer.
- **Declarative state-machine engine (Level 4):** explicitly rejected — most state machines outgrow declarative DSLs.
- **Multi-PLC plugin** (a single plugin instance serving multiple PLCs): no current need; the topology stays "one plugin instance per PLC".

## Risks

| Risk | Mitigation |
|---|---|
| Phase 0 reveals a cert-required delta we can't reproduce on upstream OpENer | Bracket as TBD in Phase 0 audit doc; consult original author; worst case, file a fork-specific patch with rationale and re-test conformance |
| ODVA conformance test fails on `STROKMATIC-COMM-V1` despite passing on legacy | Run conformance test in-house early in Phase 2; iterate before scheduling ODVA lab time |
| Bit-for-bit parity (Phase 3) reveals undocumented behavior differences between legacy pylogix and OpENer paths | Capture rich production logs in Phase 1 for the largest possible scenario set; resolve discrepancies per case (sometimes the legacy was buggy and v2 should NOT replicate it) |
| Customer reluctance to cut over to a new certified product | Phase 4 mirror-read shift gives operators direct evidence; rollback time <5 min if both stacks are pre-deployed |
| Param schema evolution breaks live deployments | SDK enforces schema_version pin; param edits validate against the deployed plugin's schema, not a newer one |

---

## References

- Legacy fork preserved at `github.com/strokmatic/strokmatic-eip` branches `legacy/*` and tags `legacy-cert-submitted-2024-06-19`, `legacy-cert-validated-2024-06-19`
- Existing SpotFusion services: `services/plc-monitor-camera/`, `services/plc-monitor-camera-opener/`, `services/plc-result/`, `services/tag-monitor/`
- Architecture context: `workspaces/strokmatic/spotfusion/architecture/viewr-plc-integration.md`
- Upstream OpENer: https://github.com/EIPStackGroup/OpENer
- ODVA conformance: https://www.odva.org/technology-standards/key-technologies/ethernet-ip/

---

## Change log

| Date | Change |
|---|---|
| 2026-05-07 | Initial design committed. Pending user review before writing-plans. |
