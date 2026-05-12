# plc-result-v2 — Design Spec

**Date:** 2026-05-08
**Status:** Draft for user review
**Supersedes (when shipped):** `strokmatic/spotfusion-plc-result` legacy `main` branch
**Master architecture:** `docs/superpowers/specs/2026-05-07-strokmatic-eip-generic-communicator-design.md`
**Sister plugin plan:** `docs/superpowers/plans/2026-05-07-strokmatic-comm-sdk-and-camera-plugin-v2.md`

---

## 1. Summary

Replace `spotfusion/services/plc-result/` (pylogix Class 1 + monolithic try/except over ~10 env-var-named PLC tags) with an SDK-based Python plugin that sits behind the certified `strokmatic-eip` adapter. Strict behavioral parity with v1 — same handshake state machine, same coordination with the separate `get-result` service over Redis, same TRYOUT mode. The only differences are: (1) PLC tag I/O routes through the 16-byte lane (offsets 32–47) of `io:in:<PLC_KEY>` / `io:out:<PLC_KEY>` instead of pylogix; (2) all live-tunable params via `cfg:plc-result-v2:<inst>` (Pydantic-validated); (3) the legacy `eval()`-of-Redis-strings goes away.

**Acceptance gate**: bit-for-bit identical PLC-visible behavior on the recorded handshake scenarios (lab run, v1 and v2 in parallel against the same PLC tag stream).

---

## 2. Why

The legacy `plc-result` is one of two SpotFusion services that drive a custom-forked pylogix Class 1 adapter (the other is `plc-monitor-camera`). The master plan retires that fork in favor of the ODVA-certified `strokmatic-eip` C adapter plus N Python plugins. The camera plugin v2 has its own plan in flight; this spec is the second of the two v1 plugins to follow the same pattern.

Behavioral parity is the chosen scope (decided 2026-05-08 with the user): the v1 handshake works in production at multiple SpotFusion cells, downstream consumers (the `get-result` service, the PLC-side ladder) expect its exact pattern, and inventing a new handshake during the migration adds risk for no near-term benefit. A future, separately-scoped cleanup can revisit the handshake once v2 is shipped and stable.

---

## 3. Architecture

```
PLC ─── EtherNet/IP Class 1 ──→ strokmatic-eip (certified C)
                                  │
                                  │ SETRANGE/GETRANGE on
                                  ▼ io:in:<PLC_KEY> / io:out:<PLC_KEY>
                              Redis (IPC bus)
                                  ▲
                                  │ PLCBus.read_lane() / write_lane()
                                  │
                              plc-result-v2 (this plugin)
                                  │
                                  │ HGET/HSET on legacy keys
                                  │   <IP>_GET_RESULT
                                  │   <IP>_GET_RESULT_CONFIRM
                                  │   <IP>_RETURNED_RESULT
                                  ▼
                              get-result service (UNCHANGED)
                                  │
                                  │ reads inspection DB, computes result
                                  ▼
                              (returns result via Redis hash, same path)
```

**One container per (CELL, ROBOT) pair.** The instance key in `cfg:plc-result-v2:<inst>` is `<CELL>_<ROBOT>` (matching how the camera plugin v2 will identify instances).

**The plugin only touches:**
- `io:in:<PLC_KEY>[32:48]` (read) — PLC's signals to us
- `io:out:<PLC_KEY>[32:48]` (write) — our signals to PLC
- Three legacy `get-result`-coordination hash keys on the application Redis (separate from the IO bus)
- `cfg:plc-result-v2:<inst>`, `status:plc-result-v2:<inst>`, `audit:plc-result-v2:<inst>` (managed by the SDK)

**The plugin does NOT touch:**
- Anything in `io:in/out` outside its lane (deployment-runner enforces via `LANE_RANGE` env var; SDK fail-fasts on config violations)
- Any `cfg:*` for other plugins
- The C adapter, the certified EDS, or anything in `strokmatic-eip`

---

## 4. Byte-lane map (lane 32–47, both directions)

### 4.1 `io:in:<PLC_KEY>` bytes 32–47 — PLC → device (plugin reads)

| Offset | Field | Type | Source semantic | Legacy v1 equivalent |
|---|---|---|---|---|
| 32 | `request_result` | u8 (0/1) | PLC asks for inspection result for current part | `TAG_REQUEST_RESULT_P` |
| 33 | `result_write_comp_plc` | u8 (0/1) | PLC ack — "I latched your RESULT, you may clear" | `TAG_RESULT_WRITE_COMP_P` |
| 34 | `fault_reset_extend` | u8 (0/1) | PLC fault-reset extension input | `TAG_FAULT_RESET_EXTEND_P` |
| 35–47 | reserved | — | spare for future PLC inputs to this plugin | — |

### 4.2 `io:out:<PLC_KEY>` bytes 32–47 — device → PLC (plugin writes)

| Offset | Field | Type | Source semantic | Legacy v1 equivalent |
|---|---|---|---|---|
| 32–33 | `result` | u16 LE | inspection result code from get-result (0 = none) | `TAG_RESULT_P` via `PLC.WRITE(3, …)` |
| 34 | `result_write_comp_dev` | u8 (0/1) | device ack — "RESULT is valid this cycle, latch it" | `PLC.WRITE(4, …)` |
| 35 | `in_cycle` | u8 (0/1) | plc-result is mid-handshake | `PLC.WRITE(6, …)` |
| 36 | `fault_reset` | u8 (0/1) | pass-through of `fault_reset_extend` (always-on every cycle) | `TAG_FAULT_RESET_P` |
| 37–47 | reserved | — | spare | — |

**Why these widths.** Every flag is a u8 (not packed bits) because (a) the lane has slack — 16 bytes for 6 fields — and (b) a u8 per flag survives plain `od -An -tu1` on a Redis blob, making lab debugging trivial. `result` is u16 LE: v1 reads the value via `eval()` of a Redis string (could be anything that Python parses to int), but in practice the production values fit in u16. Confirming this against a live deployment dump is **risk R1** below.

**Byte offsets are not hardcoded.** They live in `cfg.io_map` (Pydantic-validated), defaulted to the table above. If the lane registry shifts in a future deployment, the cfg moves and no code changes.

---

## 5. State machine

Two states + always-on fault pass-through. Driven on every cycle of the runner (configurable period, default 10 ms).

```
       ┌──────────────────── PLC clears request_result
       ▼
   ┌─► [IDLE] ─── request_result=1 ────► [REQUESTING]
   │      │                                  │
   │      │ (every cycle:                    │ HSET <IP>_GET_RESULT 1
   │      │  fault_reset := fault_reset_     │ in_cycle := 1
   │      │     extend; in_cycle := 0;       │ result := 0
   │      │  result := 0;                    │
   │      │  result_write_comp_dev := 0)     ▼
   │      │                              [WAITING_RESULT]
   │      │                                  │
   │      │                                  │ poll <IP>_GET_RESULT_CONFIRM
   │      │                                  │ when == 1:
   │      │                                  │   read <IP>_RETURNED_RESULT (int)
   │      │                                  │   write u16 to lane bytes 32-33
   │      │                                  │   result_write_comp_dev := 1
   │      │                                  ▼
   │      │                              [WROTE_RESULT]
   │      │                                  │
   │      └──── result_write_comp_plc=1 ─────┘
   │           ▲
   │           │ (PLC has latched our result;
   │           │  clear get-result coordination keys,
   │           │  return to IDLE)
   │
   └───── (any time) request_result=0 forces back to IDLE and clears outputs
```

### 5.1 Fault-reset pass-through

Independent of the state machine. **Every cycle**, in every state:

```python
out.fault_reset = in_lane.fault_reset_extend
```

This matches v1's `WRITER_TAG.redis_insert(self._TAG_FAULT_RESET, self.PLC3.READ(self._TAG_FAULT_RESET_EXTEND))` at the top of `RUN()`. It is not gated by request_result or any handshake state.

### 5.2 TRYOUT mode

When `cfg.tryout == True`:
- The state machine still runs and still acks `request_result` (so the PLC's logic doesn't hang waiting for a response)
- BUT the `HSET <IP>_GET_RESULT 1` step is skipped — we never ask the get-result service to compute anything
- `result` stays 0; `result_write_comp_dev` is never raised

This matches v1's `if eval(self.READER_PLC.read_hkey(self._TRYOUT)): pass`.

### 5.3 Cleanup on `request_result = 0`

When the PLC clears `request_result`, the plugin (in any state) returns to IDLE and clears:
- `result` → 0
- `result_write_comp_dev` → 0
- `in_cycle` → 0
- `HSET <IP>_GET_RESULT 0`
- `HSET <IP>_GET_RESULT_CONFIRM 0`
- `HSET <IP>_RETURNED_RESULT 0`

Matches v1's `else` branch at lines 189–215.

---

## 6. `cfg:plc-result-v2:<inst>` schema

```python
from pydantic import BaseModel, Field, model_validator
from strokmatic_comm_sdk import PluginConfig, IoMap

class PlcResultV2IoMap(IoMap):
    request_result_off:        int = 32
    result_write_comp_plc_off: int = 33
    fault_reset_extend_off:    int = 34
    result_off:                int = 32   # u16 LE, occupies 32-33
    result_write_comp_dev_off: int = 34
    in_cycle_off:              int = 35
    fault_reset_off:           int = 36

class PlcResultV2Config(PluginConfig):
    plc_key:           str        # e.g. "192.168.15.10" — used in io:in:<plc_key>
    cell:              str        # for instance identity / status fields
    robot:             str        # for instance identity / status fields
    io_map:            PlcResultV2IoMap = PlcResultV2IoMap()
    # get-result coordination on application Redis (NOT the IO bus Redis)
    redis_app_host:    str
    redis_app_port:    int        = 6379
    get_result_key:    str        # default: f"{plc_key}_GET_RESULT"
    get_result_confirm_key: str   # default: f"{plc_key}_GET_RESULT_CONFIRM"
    returned_result_key:    str   # default: f"{plc_key}_RETURNED_RESULT"
    tryout:            bool       = False
    cycle_period_ms:   int        = Field(10, ge=1, le=1000)

    @model_validator(mode="after")
    def _validate_lane(self):
        # IoMap base class checks each offset against LANE_RANGE env var.
        # We additionally check that 'result' fits in 2 bytes.
        return self
```

`PluginConfig.load()` and `PluginConfig.save()` come from the SDK; `model_validator` checks `LANE_RANGE` and rejects out-of-range offsets at startup.

---

## 7. Status & audit

- **`status:plc-result-v2:<inst>` hash**, written by SDK `Heartbeat` each cycle:
  - `last_beat_ms` (epoch ms)
  - `last_cycle_us` (last loop body duration)
  - `state` (`IDLE` / `REQUESTING` / `WAITING_RESULT` / `WROTE_RESULT`)
  - `result_count` (lifetime counter of successful RESULT writes)
  - `tryout_count` (lifetime counter of cycles where TRYOUT short-circuit fired)
  - `error_count`, `last_error`
- **`audit:plc-result-v2:<inst>` stream**, written by SDK `AuditLog` on every cfg change.

The same `plc-comm-ops` FastAPI from the master spec discovers this plugin via `cfg:plc-result-v2:*` and renders its Pydantic schema for operator edits.

---

## 8. File structure

New branch `v2/sdk-based` on the existing `strokmatic/spotfusion-plc-result` repo. Legacy `main` is frozen except for critical fixes once this branch is in flight (mirrors the camera plugin v2 plan's repo policy).

```
spotfusion-plc-result/                  # branch v2/sdk-based
├── README.md                           # describes v2; deprecation note + link to v1 README
├── pyproject.toml                      # standard Python project layout
├── plc-result-v2.Dockerfile
├── plc-result-v2.yml                   # docker-compose
├── plc-result-v2.req
├── cloudbuild.yaml                     # mirrors v1's GCP build (no new infra)
├── src/plc_result_v2/
│   ├── __init__.py
│   ├── runner.py                       # main loop: PLCBus + Heartbeat + state_machine.step()
│   ├── state_machine.py                # pure-function step(); deterministic; no I/O
│   ├── lane.py                         # encode_out(state) / decode_in(bytes) using io_map
│   ├── config.py                       # PlcResultV2Config + PlcResultV2IoMap
│   ├── get_result_client.py            # thin Redis wrapper for the 3 legacy hash keys
│   └── errors.py                       # plugin-specific exceptions
└── tests/
    ├── conftest.py                     # FakePLCBus + fake get-result + Redis fixture
    ├── test_lane.py                    # encode/decode round-trip on every field
    ├── test_state_machine.py           # exhaustive state-transition table
    ├── test_config.py                  # IoMap validation, LANE_RANGE rejection
    ├── test_get_result_client.py       # Redis hash interactions
    ├── test_runner_integration.py      # 1k-cycle synthetic run, asserts status hash
    └── test_parity.py                  # bit-for-bit parity scenario, FakePLCBus driven
                                        # from a recorded v1 tag-trace fixture
```

### 8.1 Module responsibilities (one purpose each)

- **`state_machine.py`** — pure function `step(in_lane: InLane, prev: State, cfg) -> (next: State, out_lane: OutLane, get_result_actions: list)`. No I/O. Trivially unit-testable.
- **`lane.py`** — `decode_in(bytes16, io_map) -> InLane` and `encode_out(state, io_map) -> bytes16`. No Redis, no PLC.
- **`get_result_client.py`** — wraps the 3 legacy hash keys behind `request(plc_ip)`, `is_confirmed(plc_ip)`, `read_returned(plc_ip)`, `clear(plc_ip)`. The runner calls these based on the actions list `state_machine.step()` emits.
- **`runner.py`** — orchestration only: read in-lane, call step, apply get-result actions, write out-lane, update heartbeat, sleep until next cycle. <100 LoC target.
- **`config.py`** — Pydantic model and load.

This split lets every unit be tested independently and keeps `runner.py` small enough that the loop logic is obvious at a glance.

---

## 9. Testing strategy

### 9.1 Unit (TDD, no I/O dependencies)
- `test_lane.py` — for every field, encode → decode round-trip; bounds checks (u8 range, u16 range); offsets that overlap or exceed 16-byte lane rejected by IoMap validator.
- `test_state_machine.py` — full transition table. Each row: (current state, input lane bits, cfg.tryout) → (expected next state, expected out lane bits, expected get-result actions). ~20 rows covers the entire machine including TRYOUT and fault-reset-only cycles.
- `test_config.py` — `LANE_RANGE` env var enforcement; missing required field; offset exceeds 47; offset below 32.

### 9.2 Integration (no real PLC, no real EIP)
- `test_runner_integration.py` uses SDK's `FakePLCBus` for io:in/io:out and an in-memory `FakeGetResultClient`. Drives 1,000 synthetic cycles of varied handshake scenarios (part arrives, get-result delays, multiple parts back-to-back, fault-reset-only, TRYOUT mode). Asserts:
  - state hash key contains expected counters
  - audit stream has expected entries for any cfg change driven during the run
  - get-result coordination keys never get stuck in a bad state
  - in_cycle is 1 if-and-only-if request_result is 1 AND not in WROTE_RESULT cleared state

### 9.3 Bit-for-bit parity (lab, acceptance gate)
Run v1 and v2 in parallel against the same input. Two viable sources:
- **Recorded PLC tag stream**: capture every tag read/write from a live SpotFusion cell over a representative window (≥1 hour, ≥50 parts), replay against both versions, diff every output. **Preferred** because deterministic and re-runnable.
- **Live PLC**: bring both plugins up against a real PLC on the bench, feed test parts, log outputs. Less reproducible but easier to set up.

A single divergent byte fails the gate.

---

## 10. Build & deploy

- `plc-result-v2.Dockerfile` — Python 3.11 base, installs `strokmatic-comm-sdk` from internal PyPI (or via pip from the SDK repo path until the index is up).
- `plc-result-v2.yml` (docker-compose) — declares `LANE_RANGE=32-47`, mounts the SDK as a dev volume in non-prod, env vars for `REDIS_*`, `CFG_KEY` (= `plc-result-v2:<cell>_<robot>`).
- `cloudbuild.yaml` — mirrors v1's GCP Cloud Build (no new infra, just a new image name `plc-result-v2`).

Topology integration: `spotfusion/topologies/<env>/byte-map.yaml` already lists `result | plc-result-v2 | 32-47` per the master spec — no change needed at topology level.

---

## 11. Risks

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | v1 stores `result` as an `eval()`-able string of unknown width. Production values might exceed u16. | Before lab parity testing, dump every value `RETURNED_RESULT` has taken in production over the last 30 days from one cell's Redis. Confirm max < 65535. If not, widen to u32 (lane has plenty of room). Adjust `result_off` semantics in `io_map`. |
| **R2** | The `get-result` service may have implicit timing assumptions that depend on v1's exact cycle period (~100 ms in production deployments). | The cycle period is in `cfg.cycle_period_ms` — start at 10 ms (matching SDK heartbeat default), but fall back to 100 ms if v1 parity testing reveals timing-sensitive coordination. |
| **R3** | Atomicity — writing `result` (2 bytes) + `result_write_comp_dev` (1 byte) + `in_cycle` (1 byte) must arrive at the PLC in the same Class 1 frame, not staggered. | SDK's `PLCBus.write_lane(state)` issues a single `SETRANGE` of the whole 16-byte lane per cycle. The C adapter reads `io:out:<key>` once per RPI and ships it. Two-step writes (e.g. result then ack on next cycle) are not possible in this architecture, which is what we want. |
| **R4** | An operator edits `io_map` to overlap with the camera plugin's lane (16–31). | Two-layer defense already in master spec: deployment-runner reads `byte-map.yaml` and rejects overlap; `LANE_RANGE` env var enforced at plugin startup. |
| **R5** | TRYOUT mode in v1 also short-circuits some redis-clear logic. We need to confirm v2's TRYOUT branch doesn't leave stale `GET_RESULT=1` in Redis. | The state machine never sets `GET_RESULT=1` when `cfg.tryout`. Cleanup-on-request-clear still runs. Unit-tested in `test_state_machine.py`. |

---

## 12. Non-goals (v2)

- **Replacing the `get-result` service.** It stays as-is. Plc-result-v2 is a drop-in replacement for v1's PLC-facing role only.
- **Changing the PLC-side ladder logic.** Same handshake the PLC already expects.
- **Multi-PLC support per container.** One container per (CELL, ROBOT) — same as v1.
- **Configurable lane size > 16 bytes.** If a future requirement needs more, that's a master-spec change (byte-map.yaml) and a new spec, not a plc-result-v2 patch.
- **Built-in test PLC.** Tests use FakePLCBus, not a virtual PLC. Lab parity uses real EIPScanner-based or recorded streams.
- **Telemetry beyond status hash + audit stream.** No Prometheus, no OpenTelemetry — out of scope for v2.

---

## 13. Open questions for user review

1. **R1 (result width)**: am I right that production `RETURNED_RESULT` values fit in u16? If you already know they overflow, say so and I'll widen to u32 before writing the plan.
2. **Cycle period**: is 10 ms the right default, or should it match v1's actual production cadence (which I'd guess is ~100 ms based on typical PLC scan rates)?
3. **Repo branch name**: `v2/sdk-based` consistent with the camera plugin v2 plan — confirm or override.
4. **Instance key format**: `<cell>_<robot>` or different — confirm or override.

---

## 14. Next step

After your review:
1. Address any open questions and edit this spec in place.
2. Hand off to `writing-plans` skill to produce the implementation plan at `docs/superpowers/plans/2026-05-08-plc-result-v2.md` — task breakdown follows the camera plugin v2 plan as a template (TDD per module, parity-test fixture committed alongside the test, integration test in CI before lab gate).
