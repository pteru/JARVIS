# Health Monitor Unification — Design

> **Date:** 2026-06-17
> **Status:** Approved (design) — pending implementation plan
> **Topic:** Collapse the duplicated `scripts/vk-health/` and `scripts/sf-health/`
> health monitors into a single config-driven core with per-product collector
> profiles, so adding a product's health monitor is "config + a small collector,"
> not "copy a directory."

## 1. Purpose & context

`scripts/vk-health/` and `scripts/sf-health/` are two parallel implementations of
the same health-monitoring pipeline (collect → analyze → alert → trends → cleanup),
diverging only by product. The orchestration/alert/trends/cleanup layer differs
almost entirely by **labels and config**; only **collection** (and its report
assembly) is genuinely product-specific. This duplication means every fix has to be
applied twice and a third product means copying ~1,800 lines.

### Current state (measured 2026-06-17)

| File | vk LOC | sf LOC | Δlines | Nature of difference |
|---|---:|---:|---:|---|
| `run.sh` | 269 | 269 | 44 | cosmetic — "VK"↔"SF", "VPN"↔"Network", default id, lock name, wording |
| `alert.sh` | 352 | 321 | 53 | labels + message wording |
| `analyze.sh` | 355 | 349 | 76 | product threshold/rule deltas |
| `trends.sh` | 169 | 150 | 39 | labels |
| `cleanup-reports.sh` | 86 | 84 | 8 | labels |
| `collect.sh` | 483 | 441 | 238 | **genuinely product-specific** (different probes/metrics) |
| `lib/config.sh`,`ssh.sh`,`telegram.sh` | — | — | small | near-identical helpers |

**Shared (differs only by labels/config):** `run`, `alert`, `trends`,
`cleanup-reports`, `lib/*`. **Product-specific:** `collect.sh` (VK gathers
GPU/cameras/RabbitMQ/img_saved-NVMe/Prometheus; SF gathers its own welding/spark
services) and the Python assemblers (`assemble_dashboard.py`+`assemble_processing.py`
vs `assemble_server.py`). A parallel config structure already exists
(`config/vk-deployments/03002.json`, `config/sf-deployments/`).

### One-offs — reviewed individually (2026-06-17)

- **`monthly-consolidate.sh` → folded into the core** as a `monthly-consolidate`
  mode (§5). It's generic over reports + config, so SF gains monthly summaries too.
- **VK `deploy/` → NOT this spec; consolidate into `strokmatic/sdk-observability-stack`.**
  It is a VK-specific fork of the canonical observability stack — that repo already
  ships the identical four Grafana dashboards (`node-exporter`, `nvidia-gpu`,
  `intel-gpu`, `cadvisor`) + Prometheus + compose, and positions itself as the
  observability solution for all SDK products. Only VK-specific deltas (gpu/no-gpu
  compose split, scrape targets) need reconciling there, then VK's `deploy/` is
  deleted. Tracked as a separate backlog issue on `sdk-observability-stack`.
- **`gpu-watchdog.sh`** (node-local root reboot agent), **`explore-server.sh`** (SF
  discovery one-off), **`references/`** → relocated under `scripts/health/`
  (`node-agents/`, `tools/`, `references/`) as **product-specific, outside the core
  pipeline** — they are remediation/debugging/docs, not the pull-based monitor.
  `explore-server.sh`'s hardcoded `<skm-password>` is scrubbed during the move.
- No change to the metrics each product collects, the alert thresholds, the cron
  cadence, or the report consumers (`vk-health` / `vk-deploy-review` skills,
  dashboards). This is a **structural** refactor: same behavior, one codebase.

## 2. Decisions locked (user, 2026-06-17)

1. **Architecture: shared core + collector profiles.** One generic pipeline driven
   by config; the only per-product code is `collectors/<product>.sh` (+ its
   assembler). New product = config + a small collector.
2. **Migration: incremental (strangler).** Extract the core, run new collectors
   side-by-side against the live ones until snapshots match, flip crons one product
   at a time, retire the old dirs last. Live monitoring must never break.
3. **Boundary: collector-as-subprocess over a normalized snapshot JSON** (§4).

## 3. Architecture & layout

```
scripts/health/
  health.sh                      # entry: health.sh <product> <deployment> [mode]
  core/
    run.sh                       # orchestrator: gates → collect → analyze → alert (generic)
    analyze.sh                   # snapshot + config checks → analysis report (generic)
    alert.sh                     # threshold breaches → telegram (generic, config-driven)
    trends.sh                    # daily trend rollup (generic)
    cleanup-reports.sh           # report retention (generic)
    monthly-consolidate.sh       # monthly summary rollup via Claude (generic)
  lib/
    config.sh                    # load + resolve config/health/<product>/<deployment>.json
    ssh.sh                       # remote exec helpers (password/key via secret files)
    telegram.sh                  # routed notifications
  collectors/
    vk.sh                        # VK probes → normalized snapshot.json
    sf.sh                        # SF probes → normalized snapshot.json
  assemblers/
    vk/  (assemble_dashboard.py, assemble_processing.py)
    sf/  (assemble_server.py)
  node-agents/
    gpu-watchdog.sh              # VK GPU-node root reboot agent (product-specific, not core)
  tools/
    sf-explore-server.sh         # SF discovery one-off (secret scrubbed; product-specific)
  references/                    # relocated SF reference docs
config/health/<product>/<deployment>.json
```

`health.sh <product> <deployment> [mode]` is the single entry point; it loads the
config, then dispatches to `core/<mode>.sh` (default `run`). `run.sh` is fully
generic: pre-flight gates (campaign flag, connectivity, analyze throttle, heartbeat)
→ lock → `collectors/<product>.sh` → `analyze` → `alert`. Everything that differs in
today's `run.sh` (product label, "VPN"↔"Network" wording, default deployment, lock
name, paths) is read from config.

### The core ↔ collector boundary (chosen contract)

The collector is a **black box** invoked as a subprocess:
`collectors/<product>.sh <deployment>` → writes a snapshot JSON to the configured
data path and exits 0 (1 only on a fatal, non-recoverable failure). The core depends
solely on the **snapshot schema**, never on collector internals. Rejected
alternatives: sourced-function hooks (tighter coupling, shared shell scope — only
needed if collectors must reuse core helpers heavily, which they don't beyond
`ssh.sh`/`telegram.sh` they can source directly); fully-declarative probes in config
(brittle where metrics differ structurally — GPU vs welding).

## 4. The snapshot contract

The single interface between collection and the rest of the pipeline.

- **Location:** `<data_root>/<deployment>/<utc-date>/snapshot-<utc-time>.json`
  (`data_root` from config; defaults preserve today's `data/vk-health`,
  `data/sf-health`). UTC dates/times (existing convention).
- **Shape:**
  ```json
  {
    "schema": 1,
    "product": "vk",
    "deployment": "03002",
    "collected_at": "2026-06-17T12:00:00Z",
    "nodes": [{ "name": "vk03", "reachable": true }, ...],
    "metrics": {
      "disk.root.pct": 71,
      "disk.img_saved.pct": 44,
      "gpu.0.temp_c": 63,
      "rabbitmq.queue.depth": 12,
      "service.inference.up": 1
    },
    "raw": { ... }            // product-specific detail for the report assembler
  }
  ```
  `metrics` is a **flat, namespaced map of numeric values** — the only part `analyze`
  and `alert` read. `raw` is opaque to the core and consumed only by the product's
  assembler when rendering `latest.md`. Adding a product metric = the collector adds
  a `metrics` key + a config check; **no core change**.
- A versioned **schema doc** (`scripts/health/SNAPSHOT.md`) and a **fixture**
  (`tests/health/fixtures/snapshot-vk.json`) pin the contract.

## 5. Genericized core

- **`analyze.sh`** reads the snapshot's `metrics` and the config-declared `checks`,
  emits per-check verdicts (`ok`/`warn`/`crit`) and renders the report via the
  product's assembler (path from config). No product branches. Each check carries a
  `direction`: `high` (breach when value ≥ threshold — disk %, temp) or `low` (breach
  when value ≤ threshold — FPS, `service.*.up`), so both metric polarities are
  expressed declaratively. A check whose `field` is absent from `metrics` →
  `unknown`.
- **`alert.sh`** fires on `warn`/`crit` deltas, deduped via the existing cooldown
  mechanism; message label/emoji/wording come from config. Routing stays through
  `lib/telegram.sh`.
- **`trends.sh`** / **`cleanup-reports.sh`** operate on the snapshot series + report
  dir generically (retention windows from config).
- **`monthly-consolidate.sh`** aggregates a month of daily reports into a permanent
  monthly summary via Claude — generic over the report dir + config; both products
  get it. (Cron `0 6 1 * *`, as VK has today.)

### Config schema — `config/health/<product>/<deployment>.json`

```json
{
  "product": "vk",
  "deployment": "03002",
  "name": "ArcelorMittal TL1 (03002)",
  "data_root": "data/vk-health",
  "reports_root": "reports/vk-health",
  "assembler": "assemblers/vk/assemble_dashboard.py",
  "connectivity": { "label": "VPN", "nodes": ["vk01", "vk02", "vk03"] },
  "secrets": { "ssh": "~/.secrets/vk-ssh-password", "rabbit": "~/.secrets/vk-rabbit-password" },
  "checks": [
    { "field": "disk.root.pct",       "direction": "high", "warn": 90, "crit": 95, "label": "Root disk" },
    { "field": "disk.img_saved.pct",  "direction": "high", "warn": 75, "crit": 90, "label": "img_saved disk" },
    { "field": "gpu.0.temp_c",        "direction": "high", "warn": 80, "crit": 90, "label": "GPU temp" },
    { "field": "service.inference.up","direction": "low",  "warn": 1,  "crit": 1,  "label": "Inference service" }
  ],
  "throttle_minutes": 30,
  "alert_cooldown_minutes": 60
}
```

Migrated from `config/vk-deployments/03002.json` + the hardcoded thresholds currently
living in `analyze.sh`/`alert.sh`. `data_root`/`reports_root` default to today's
paths so report consumers are undisturbed.

## 6. Incremental (strangler) migration

1. **Lib + contract.** Land `scripts/health/lib/` (unified `config/ssh/telegram`,
   reconciled from both copies), `SNAPSHOT.md`, and the fixture. No behavior change,
   nothing wired to cron.
2. **Generic core.** Land `core/{run,analyze,alert,trends,cleanup-reports}.sh` +
   `health.sh`, parameterized by config. Crons untouched.
3. **VK collector.** Port VK `collect.sh` → `collectors/vk.sh` emitting the normalized
   snapshot. Run **side-by-side** with the live monitor; diff the new snapshot's
   `metrics` against the live one across several cycles until they match. Migrate VK
   config → `config/health/vk/03002.json`. Flip VK's cron to
   `health.sh vk 03002`. Validate `latest.md` + alerts unchanged.
4. **SF collector.** Same for SF (`collectors/sf.sh`, `config/health/sf/02006.json`,
   flip cron).
5. **Relocate + retire.** Move `monthly-consolidate` into `core/`; move
   `gpu-watchdog` → `node-agents/`, `explore-server` → `tools/sf-explore-server.sh`
   (scrubbing the hardcoded secret), `references/` → `scripts/health/references/`.
   Replace `scripts/vk-health`/`sf-health` entry scripts with one-line redirect shims
   to `health.sh` for one release; then delete the old dirs. File a separate backlog
   issue to absorb VK's `deploy/` into `sdk-observability-stack` and remove it from
   JARVIS.

Each step is independently shippable and leaves a working monitor.

## 7. Error handling

Preserve today's posture: **gates fail-closed** (connectivity/campaign/throttle abort
the pipeline; alerts respect cooldown), **collectors fail-open per node** (an
unreachable node yields a partial snapshot with `reachable:false`, not a crash),
**analyze tolerates missing metrics** (a check whose `field` is absent reports
`unknown`, never throws). No `jq` on prod nodes — JSON assembly stays in the Python
assemblers SCP'd to the remote, as today.

## 8. Testing strategy (offline)

- **analyze/alert** over committed fixture snapshots: assert `ok`/`warn`/`crit`
  verdicts for boundary values (e.g. root 89→ok, 90→warn, 95→crit) and that a missing
  field is `unknown`, not an error.
- **core/run gate logic** with stubbed `ssh`/`ping` on PATH (mirrors the gh-stub
  pattern): campaign-flag gate, connectivity-fail gate, throttle, lock.
- **collector snapshot shape**: run `collectors/vk.sh` against a stubbed `ssh`
  returning canned probe output; assert the emitted snapshot validates against the
  schema and populates the expected `metrics` keys.
- No live SSH/Telegram in tests. Runs under the existing `node --test` harness via
  bash-subprocess tests (as with `task-dispatcher`/`orchestrator` tests).

## 9. Non-goals

- Not changing which metrics are collected, thresholds, cron cadence, or report
  formats/paths (behavior-preserving).
- Not consolidating VK's `deploy/` into `sdk-observability-stack` — that's a real but
  **separate** cross-repo task (filed as its own backlog issue), because `deploy/`
  duplicates the canonical observability stack, not the health pipeline.
- `gpu-watchdog`, SF `explore-server`, and `references/` are relocated under
  `scripts/health/` but stay product-specific — they are not folded into the core
  pipeline (different deployment model / one-offs).
- Not building a third product now; the design just makes it cheap.

## 10. Rollout

Ship steps 1–2 (lib + core, inert), then 3 (VK) and 4 (SF) as separate validated
cutovers, then 5 (retire). The live `*/15` and `23:30` crons flip only after the
side-by-side snapshot diff is clean for that product. A follow-up may fold the
VK-only extras into the core as optional, config-gated features.
