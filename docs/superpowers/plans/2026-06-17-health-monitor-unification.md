---
type: Implementation Plan
title: Health Monitor Unification Implementation Plan
description: Flat `metrics` keys are fully qualified. Per-node metrics carry a `node.<name>.` prefix; booleans are encoded `0|1`. A config check's `field` is the **suffix after the node prefix**; the engine mat...
timestamp: 2026-06-17
---

# Health Monitor Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 85–95% byte-identical `scripts/vk-health/` and `scripts/sf-health/` monitors into one config-driven `scripts/health/` core with per-product collector profiles, so adding a product is "config + a small collector," not "copy a directory."

**Architecture:** A single entry point `health.sh <product> <deployment> [mode]` loads `config/health/<product>/<deployment>.json` and dispatches to generic `core/<mode>.sh`. Collectors (`collectors/<product>.sh`) are black-box subprocesses that emit a **normalized snapshot JSON** (flat numeric `metrics` map + opaque `raw` for the assembler). The core reads only the snapshot schema + config — never collector internals. Migration is a strangler: land lib+core inert, port each collector and run it side-by-side against the live monitor until snapshots match, flip that product's cron, then retire the old dirs.

**Tech Stack:** Bash 5.x, `jq` (core host only — never on remote nodes), Python 3 assemblers (SCP'd to remotes), `sshpass`/`ssh`, Telegram via `lib/telegram.sh`, Claude CLI (`claude -p`) for narrative reports. Tests run under Node's built-in runner (`node --test tests/`) driving bash scripts as subprocesses with PATH-prepended stubs (mirrors `tests/orchestrator/helpers/gh-stub.mjs`).

## Global Constraints

- **Behavior-preserving.** No change to which metrics are collected, the alert thresholds, the cron cadence (`*/15` pipeline, `23:30` trends, `0 6 1 * *` monthly), or report formats/paths. This is structural only.
- **`jq` runs on the JARVIS host only.** Remote nodes have no `jq` — all remote JSON assembly stays in Python assemblers SCP'd to the node (existing pattern).
- **UTC everywhere** for snapshot dates/times: `<data_root>/<deployment>/<YYYY-MM-DD>/snapshot-<HH-MM-SS>.json`.
- **Secrets come from files named in config** (`~/.secrets/vk-ssh-password`, `~/.secrets/vk-rabbit-password`, `~/.secrets/sf-ssh-password`), read into `*_SSH_PASSWORD` / `*_RABBIT_PASSWORD` env vars. Never hardcode a password.
- **Paths default to today's** so report/dashboard consumers (`vk-health`/`vk-deploy-review` skills, Prometheus host port **8110**) are undisturbed: `data_root` → `data/vk-health`|`data/sf-health`, `reports_root` → `reports/vk-health`|`reports/sf-health`.
- **Config single source of truth:** shell uses `scripts/lib/config.sh` conventions; never hardcode `ORCHESTRATOR_HOME` (default `${ORCHESTRATOR_HOME:-$HOME/JARVIS}`).
- **Claude model is config-driven** (`claude_model`, default `claude-opus-4-6` to preserve current output); no silent upgrade.
- **Gates fail-closed** (connectivity/campaign/throttle abort; alerts respect cooldown). **Collectors fail-open per node** (unreachable node → `reachable:0` partial, never a crash). **Analyze/alert tolerate missing metrics** (absent field → `unknown`, never throws).
- **Commit after every green step.** Branch off `develop`. Never `git add -A` (the working tree has ~30 unrelated WIP files + 64 GB gitignored `workspaces/`); stage only the task's files by exact path.
- The two inventory files `config/network/local-machines.md` and `references/github-migration.md` are `skip-worktree` — do not touch them.

---

## File Structure

**Created:**
```
scripts/health/
  health.sh                      # entry: health.sh <product> <deployment> [mode]
  SNAPSHOT.md                    # versioned snapshot schema doc
  core/{run,analyze,alert,trends,cleanup-reports,monthly-consolidate}.sh
  lib/{config,ssh,telegram,checks}.sh
  collectors/{vk,sf}.sh
  assemblers/vk/{assemble_dashboard,assemble_processing}.py
  assemblers/sf/assemble_server.py
  node-agents/gpu-watchdog.sh    # relocated, product-specific (not core)
  tools/sf-explore-server.sh     # relocated SF one-off
  references/                    # relocated SF reference docs
config/health/vk/03002.json
config/health/sf/02006.json
tests/health/
  fixtures/{snapshot-vk.json,snapshot-sf.json,config-vk.json,config-sf.json}
  helpers/cli-stub.mjs           # generic PATH-prepend stub (ssh/sshpass/ping/curl/claude)
  helpers/schema.mjs             # snapshot schema validator
  {config,checks,run,analyze,alert,collector-vk,collector-sf}.test.mjs
```

**Modified (Phase 5 only):** old entry scripts under `scripts/vk-health/` & `scripts/sf-health/` become one-line shims, then are deleted; crontab lines repointed.

**Interface naming locked for all tasks** (a task implementer sees only their task — these are the cross-task contracts):

- `lib/config.sh` → `load_health_config <product> <deployment>` exports: `HEALTH_PRODUCT HEALTH_DEPLOYMENT HEALTH_NAME CONFIG_FILE DATA_DIR REPORT_DIR ASSEMBLER CLAUDE_MODEL CONNECTIVITY_LABEL THROTTLE_MINUTES ALERT_COOLDOWN_MINUTES HEARTBEAT_INTERVAL_MINUTES PIPELINE_ENABLED` and arrays `CONNECTIVITY_NODES` / `CHECK_*`. Reads secret-file paths into `HEALTH_SSH_SECRET` / `HEALTH_RABBIT_SECRET`.
- `lib/ssh.sh` → `ssh_cmd <node> <cmd>`, `ssh_script <node> <<<script>`, `scp_to <node> <local> <remote>`, `is_node_reachable <node>`, `node_host/node_user/node_ssh_port <node>` (default port 8050).
- `lib/telegram.sh` → `send_telegram <text> [domain]`, `send_telegram_alert <severity> <title> <details>`.
- `lib/checks.sh` → `evaluate_checks <snapshot_json_path> <config_json_path>` prints one verdict per line: `SEVERITY<TAB>LABEL<TAB>METRIC_KEY<TAB>VALUE<TAB>THRESHOLD` where `SEVERITY ∈ {ok,warn,crit,unknown}`.
- Snapshot schema `{schema:1, product, deployment, collected_at, nodes:[{name,reachable}], metrics:{<flat numeric>}, raw:{...}}` (SNAPSHOT.md, Task 1).
- `collectors/<p>.sh <deployment>` writes the snapshot to `$DATA_DIR/<utc-date>/snapshot-<utc-time>.json`, exit 0 (1 only on fatal).

### Metric-key convention (locked)

Flat `metrics` keys are fully qualified. Per-node metrics carry a `node.<name>.` prefix; booleans are encoded `0|1`. A config check's `field` is the **suffix after the node prefix**; the engine matches a key `K` to check field `F` iff `K == F` (global) **or** `K` matches `^node\.[^.]+\.F$` (per-node fan-out). Canonical keys the collectors emit:

| Key | Meaning | Products |
|---|---|---|
| `node.<n>.reachable` | 1 reachable / 0 not | both |
| `node.<n>.cpu.pct` `…ram.pct` `…disk.root.pct` | host metrics | both |
| `node.<n>.disk.img_saved.pct` | img_saved NVMe | VK processing |
| `node.<n>.gpu.0.util.pct` `…gpu.0.mem.pct` `…gpu.0.temp_c` | GPU (temp collected, not alerted) | VK gpu nodes |
| `node.<n>.uptime_seconds` | uptime | both |
| `node.<n>.container.<c>.up` `…container.<c>.restarts` | docker state | both |
| `node.<n>.rabbitmq.queue_max.depth` | deepest queue | both |
| `node.<n>.service.image_saver.up` | health endpoint 1/0 | VK processing |
| `node.<n>.gui.<port>.up` | endpoint 200/302→1 else 0 | both |

---

## Phase 1 — Lib + contract (inert; nothing wired to cron)

### Task 1: Snapshot contract — schema doc, fixtures, validator

**Files:**
- Create: `scripts/health/SNAPSHOT.md`
- Create: `tests/health/fixtures/snapshot-vk.json`, `tests/health/fixtures/snapshot-sf.json`
- Create: `tests/health/helpers/schema.mjs`
- Test: `tests/health/schema.test.mjs`

**Interfaces:**
- Produces: `validateSnapshot(obj) → string[]` (array of problems; empty = valid), imported by collector tests in Tasks 11/14.

- [ ] **Step 1: Write `SNAPSHOT.md`** documenting `schema:1`, the field table above, the metric-key convention, and the fail-open rule (unreachable node → only `node.<n>.reachable=0`, no other keys for it).

- [ ] **Step 2: Write the two fixtures.** `snapshot-vk.json` with 3 nodes (vk01/vk02 gpu+processing, vk03 dashboard), realistic boundary values: `node.vk01.disk.root.pct=89`, `node.vk02.disk.root.pct=95`, `node.vk03.disk.img_saved.pct` absent, `node.vk01.gpu.0.mem.pct=91`, `node.vk03.reachable=0` (and no other vk03 keys). `snapshot-sf.json` single node `server`, no gpu/img_saved keys.

- [ ] **Step 3: Write `schema.mjs` validator** — checks `schema===1`, required top-level keys present, every `metrics` value is a finite number, every key matches `^([a-z0-9_]+\.)*[a-z0-9_]+$` or the `node.<n>.` form, and each `nodes[].name` with `reachable:false` has no other `node.<name>.*` keys.

```javascript
export function validateSnapshot(o) {
  const p = [];
  if (o?.schema !== 1) p.push('schema must be 1');
  for (const k of ['product','deployment','collected_at','nodes','metrics']) if (!(k in (o||{}))) p.push(`missing ${k}`);
  for (const [k,v] of Object.entries(o?.metrics ?? {})) {
    if (typeof v !== 'number' || !Number.isFinite(v)) p.push(`metric ${k} not a finite number`);
    if (!/^[a-z0-9_.]+$/.test(k)) p.push(`metric key ${k} malformed`);
  }
  for (const n of o?.nodes ?? []) if (n.reachable === false)
    for (const k of Object.keys(o.metrics ?? {})) if (k.startsWith(`node.${n.name}.`) && !k.endsWith('.reachable')) p.push(`unreachable ${n.name} has ${k}`);
  return p;
}
```

- [ ] **Step 4: Write `schema.test.mjs`** asserting both fixtures validate clean and a deliberately-broken object (`metrics: {x: "hi"}`) returns a non-empty problem list.

- [ ] **Step 5: Run** `node --test tests/health/schema.test.mjs` — Expected: PASS.

- [ ] **Step 6: Commit** `git add scripts/health/SNAPSHOT.md tests/health/fixtures tests/health/helpers/schema.mjs tests/health/schema.test.mjs && git commit -m "feat(health): snapshot contract doc + fixtures + validator"`

### Task 2: `lib/config.sh` — config loader

**Files:**
- Create: `scripts/health/lib/config.sh`
- Create: `tests/health/fixtures/config-vk.json`, `tests/health/fixtures/config-sf.json`
- Test: `tests/health/config.test.mjs`

**Interfaces:**
- Produces: `load_health_config <product> <deployment>` exporting the variables named in the File Structure section. `CONNECTIVITY_NODES` is a bash array of node names from `.connectivity.nodes`.
- Consumes: a config JSON with `{product,deployment,name,data_root,reports_root,assembler,claude_model,connectivity:{label,nodes[]},secrets:{ssh,rabbit},checks:[...],throttle_minutes,alert_cooldown_minutes,heartbeat_interval_minutes,enabled}`.

- [ ] **Step 1: Write the failing test** `config.test.mjs`: a tiny bash probe sources `lib/config.sh`, calls `load_health_config vk 03002` against `ORCHESTRATOR_HOME` pointed at a temp home containing `config/health/vk/03002.json` (= `config-vk.json` fixture), and `echo`s `$HEALTH_NAME|$DATA_DIR|$ALERT_COOLDOWN_MINUTES|${CONNECTIVITY_NODES[*]}`. Assert the line equals the fixture's values.

```javascript
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
test('load_health_config exports resolved fields', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'hm-'));
  fs.mkdirSync(path.join(home,'config/health/vk'),{recursive:true});
  fs.copyFileSync('tests/health/fixtures/config-vk.json', path.join(home,'config/health/vk/03002.json'));
  const probe = `source scripts/health/lib/config.sh; load_health_config vk 03002; echo "$HEALTH_NAME|$DATA_DIR|$ALERT_COOLDOWN_MINUTES|${'${CONNECTIVITY_NODES[*]}'}"`;
  const out = execFileSync('bash',['-c',probe],{encoding:'utf8',env:{...process.env,ORCHESTRATOR_HOME:home}}).trim();
  assert.equal(out, `ArcelorMittal TL1 (03002)|${home}/data/vk-health/03002|60|vk01 vk02 vk03`);
});
```

- [ ] **Step 2: Run** `node --test tests/health/config.test.mjs` — Expected: FAIL (`load_health_config: command not found`).

- [ ] **Step 3: Write `lib/config.sh`** — `load_health_config()` resolves `ORCHESTRATOR_HOME`, sets `CONFIG_FILE="$ORCHESTRATOR_HOME/config/health/$1/$2.json"`, then `jq -r` each field into an exported var; `DATA_DIR="$ORCHESTRATOR_HOME/$(jq -r .data_root)/$2"`, `REPORT_DIR` likewise; `mapfile -t CONNECTIVITY_NODES < <(jq -r '.connectivity.nodes[]' "$CONFIG_FILE")`; expand `~` in secret paths via `${path/#\~/$HOME}`. Default missing optionals (`claude_model`→`claude-opus-4-6`, `throttle_minutes`→240, `heartbeat_interval_minutes`→60, `enabled`→true).

- [ ] **Step 4: Run** the test — Expected: PASS.

- [ ] **Step 5: Commit** `git add scripts/health/lib/config.sh tests/health/fixtures/config-*.json tests/health/config.test.mjs && git commit -m "feat(health): config loader for config/health/<product>/<deployment>.json"`

### Task 3: `lib/checks.sh` — the check-evaluation engine

**Files:**
- Create: `scripts/health/lib/checks.sh`
- Test: `tests/health/checks.test.mjs`

**Interfaces:**
- Produces: `evaluate_checks <snapshot> <config>` → stdout, one TSV verdict per matched metric: `severity\tlabel\tmetric_key\tvalue\tthreshold`. A check whose `field` matches no metric key emits exactly one `unknown\t<label>\t<field>\t\t` line.
- Consumes: snapshot `metrics` (Task 1), config `checks[]` with `{field,direction,warn,crit,label}`.

- [ ] **Step 1: Write the failing test** over `snapshot-vk.json` + `config-vk.json`: assert that `disk.root.pct` (high 90/95) yields `ok` for vk01 (89), `crit` for vk02 (95); `gpu.0.mem.pct` (high 90/95) yields `warn` for vk01 (91); a check with `field:"service.does_not_exist.up"` yields a single `unknown` line. Drive via `execFileSync('bash',['-c','source scripts/health/lib/checks.sh; evaluate_checks A B',...])` and parse the TSV.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `evaluate_checks`.** For each check, build regex `^(node\.[^.]+\.)?<field with . escaped>$`; select matching metric entries with jq; for each, compute verdict in awk/bash:
  - `high`: `value>=crit→crit`; `>=warn→warn`; else `ok`.
  - `low`: `value<=crit→crit`; `<=warn→warn`; else `ok`.
  - no matches → one `unknown` line.

```bash
evaluate_checks() { local snap="$1" cfg="$2"
  local n; n=$(jq '.checks|length' "$cfg")
  for ((i=0;i<n;i++)); do
    local field dir warn crit label; field=$(jq -r ".checks[$i].field" "$cfg")
    dir=$(jq -r ".checks[$i].direction" "$cfg"); warn=$(jq -r ".checks[$i].warn" "$cfg")
    crit=$(jq -r ".checks[$i].crit" "$cfg"); label=$(jq -r ".checks[$i].label" "$cfg")
    local esc="${field//./\\.}" rx="^(node\\.[^.]+\\.)?${esc}$" matches
    matches=$(jq -r --arg rx "$rx" '.metrics|to_entries[]|select(.key|test($rx))|"\(.key)\t\(.value)"' "$snap")
    if [[ -z "$matches" ]]; then printf 'unknown\t%s\t%s\t\t\n' "$label" "$field"; continue; fi
    while IFS=$'\t' read -r key val; do
      local sev; sev=$(awk -v v="$val" -v w="$warn" -v c="$crit" -v d="$dir" 'BEGIN{
        if(d=="high"){ print (v>=c)?"crit":((v>=w)?"warn":"ok") }
        else { print (v<=c)?"crit":((v<=w)?"warn":"ok") } }')
      printf '%s\t%s\t%s\t%s\t%s/%s\n' "$sev" "$label" "$key" "$val" "$warn" "$crit"
    done <<< "$matches"
  done; }
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** `git add scripts/health/lib/checks.sh tests/health/checks.test.mjs && git commit -m "feat(health): config-driven check engine (direction high/low, per-node fan-out, unknown-safe)"`

### Task 4: `lib/ssh.sh` + `lib/telegram.sh` — reconciled helpers + generic CLI stub

**Files:**
- Create: `scripts/health/lib/ssh.sh`, `scripts/health/lib/telegram.sh`
- Create: `tests/health/helpers/cli-stub.mjs`
- Test: `tests/health/ssh.test.mjs`

**Interfaces:**
- Produces: `installCliStub(name)` → `{dir, logFile, env, readArgs(), cleanup()}` mirroring `gh-stub.mjs` but for an arbitrary binary name (`ssh`,`sshpass`,`ping`,`curl`,`claude`), honoring `<NAME>_STUB_OUT` / `<NAME>_STUB_EXIT`. SSH/telegram signatures per File Structure.

- [ ] **Step 1: Write `cli-stub.mjs`** generalizing `tests/orchestrator/helpers/gh-stub.mjs`: write `${dir}/${name}` (0o755) that appends `"$@"`+`\n===\n` to `$<NAME>_STUB_LOG`, prints `$<NAME>_STUB_OUT`, exits `$<NAME>_STUB_EXIT` (default 0); `env.PATH = "${dir}:"+process.env.PATH`.

- [ ] **Step 2: Write the failing test** `ssh.test.mjs`: stub `sshpass`, source `lib/config.sh`+`lib/ssh.sh` against `config-vk.json`, call `ssh_cmd vk01 'echo hi'`, assert the stub logged a call whose args include `vk01@10.244.70.26` and port `8050`; set `SSHPASS_STUB_EXIT=1` and assert `is_node_reachable vk01` returns non-zero.

- [ ] **Step 3: Implement `lib/ssh.sh`** by reconciling the two existing copies (identical logic): `node_host/user/ssh_port` from `$CONFIG_FILE` (`.nodes[$n].ssh_port // 8050`), `ssh_cmd` = `sshpass -e ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR -p "$port" "$user@$host" "$cmd"` with `SSHPASS` read from `HEALTH_SSH_SECRET` file; `ssh_script` pipes `bash -s`; `scp_to`; `is_node_reachable` = `ssh_cmd <n> 'echo ok'`.

- [ ] **Step 4: Implement `lib/telegram.sh`** from the existing copy (already product-neutral): `send_telegram <text> [domain]` routes through `scripts/lib/telegram-router.sh` if present, else POSTs to the configured bot; `send_telegram_alert` adds severity emoji (🔴/🟡/🟢/⚪) + `$HEALTH_NAME`. 4000-char truncation preserved.

- [ ] **Step 5: Run** `node --test tests/health/ssh.test.mjs` — Expected: PASS.

- [ ] **Step 6: Commit** `git add scripts/health/lib/ssh.sh scripts/health/lib/telegram.sh tests/health/helpers/cli-stub.mjs tests/health/ssh.test.mjs && git commit -m "feat(health): reconciled ssh + telegram libs and generic CLI stub"`

---

## Phase 2 — Generic core (config-parameterized; crons still untouched)

### Task 5: `health.sh` entry dispatcher

**Files:** Create `scripts/health/health.sh`; Test `tests/health/dispatch.test.mjs`.

**Interfaces:** Produces the CLI contract `health.sh <product> <deployment> [mode=run]`; loads config then `exec` `core/<mode>.sh "$product" "$deployment"`. Consumes `load_health_config`.

- [ ] **Step 1: Failing test** — replace `core/run.sh` on PATH-independent path with a temp stub via `HEALTH_CORE_DIR` override env; assert `health.sh vk 03002 analyze` invokes `core/analyze.sh vk 03002`. (Add `HEALTH_CORE_DIR="${HEALTH_CORE_DIR:-$SCRIPT_DIR/core}"` indirection so the test can point at a stub dir.)

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `health.sh`** — resolve `SCRIPT_DIR`, validate args (usage on missing product/deployment), `source lib/config.sh; load_health_config "$1" "$2"`, `mode="${3:-run}"`, guard that `$HEALTH_CORE_DIR/$mode.sh` exists, `exec bash "$HEALTH_CORE_DIR/$mode.sh" "$1" "$2"`.

- [ ] **Step 4: Run** — Expected: PASS. **Step 5: Commit** `git add scripts/health/health.sh tests/health/dispatch.test.mjs && git commit -m "feat(health): health.sh entry dispatcher"`

### Task 6: `core/alert.sh` — generic config-driven alerting

**Files:** Create `scripts/health/core/alert.sh`; Test `tests/health/alert.test.mjs`.

**Interfaces:** Consumes `lib/checks.sh`, `lib/telegram.sh`, latest snapshot, config (`alert_cooldown_minutes`, check labels). Produces: telegram messages for `warn`/`crit` verdicts deduped by cooldown; writes `$DATA_DIR/alert-state.json` and `$DATA_DIR/last-alert-count` (read by `run.sh`). Mirrors existing `alert.sh` dedup (state file, `should_send_alert`, `record_alert_sent`) and emoji blocks.

- [ ] **Step 1: Failing test** — stub `curl`/router; point `DATA_DIR` at temp; feed `snapshot-vk.json`+`config-vk.json`. Assert: a `crit` verdict (vk02 root disk 95) produces a telegram call containing the label "Root disk" and 🔴; a second immediate run within cooldown produces **no** new send (dedup); `last-alert-count` equals the number of distinct alerts fired.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `core/alert.sh`** — load config + latest snapshot, `evaluate_checks` → filter `warn|crit`, build a stable `alert_key` per `metric_key`, apply `should_send_alert`/`record_alert_sent` (cooldown = `ALERT_COOLDOWN_MINUTES*60`, state in `$DATA_DIR/alert-state.json`), group CRITICAL/WARNING into emoji blocks, `send_telegram_alert`, write `last-alert-count`. No product branches — labels/emoji/name from config + checks.

- [ ] **Step 4: Run** — Expected: PASS. **Step 5: Commit** `git add scripts/health/core/alert.sh tests/health/alert.test.mjs && git commit -m "feat(health): generic config-driven alert.sh with cooldown dedup"`

### Task 7: `core/analyze.sh` — generic Claude reporter

**Files:** Create `scripts/health/core/analyze.sh`; Test `tests/health/analyze.test.mjs`.

**Interfaces:** Consumes latest+previous snapshot, trends, config (`claude_model`, `HEALTH_NAME`, `REPORT_DIR`). Produces `latest.md`, `analysis-<ts>.md`, `consolidated-<date>.md`, appends `improvements.md`. Calls `claude -p --model "$CLAUDE_MODEL" ...` via stdin. Port of existing `analyze.sh` with product strings replaced by config.

- [ ] **Step 1: Failing test** — stub `claude` (`CLAUDE_STUB_OUT` returns a canned report containing `### SEVERITY: WARNING` and a `### NEW IMPROVEMENTS` block). Run `core/analyze.sh vk 03002` against a temp `DATA_DIR` seeded with two snapshots. Assert `latest.md` written, `improvements.md` appended with the `## <date> -- WARNING` header, and the `claude` stub was called with `--model claude-opus-4-6`.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `core/analyze.sh`** — port existing snapshot-load + 24h-trend computation (jq over today's snapshots) + the Claude prompt (parameterize deployment name/model), report saving, daily consolidation, and improvements extraction. Replace every hardcoded "VK"/"VisionKing"/model with config values.

- [ ] **Step 4: Run** — Expected: PASS. **Step 5: Commit** `git add scripts/health/core/analyze.sh tests/health/analyze.test.mjs && git commit -m "feat(health): generic analyze.sh (config-driven Claude reporter)"`

### Task 8: `core/run.sh` — generic orchestrator + gates

**Files:** Create `scripts/health/core/run.sh`; Test `tests/health/run.test.mjs`.

**Interfaces:** Consumes config + `lib/ssh.sh`+`lib/telegram.sh`; invokes `collectors/<product>.sh`, `core/analyze.sh`, `core/alert.sh`. Gates: campaign (`PIPELINE_ENABLED`), connectivity (ping `CONNECTIVITY_NODES`, alert on 0 reachable using `CONNECTIVITY_LABEL` for "VPN"/"Network"), analyze throttle (`THROTTLE_MINUTES`), heartbeat. Lock `/tmp/health-<product>-<deployment>.lock`.

- [ ] **Step 1: Failing tests** (stub `ping`, `collectors`, `analyze.sh`, `alert.sh` via a temp bin dir + `HEALTH_CORE_DIR`/`HEALTH_COLLECTOR_DIR` overrides): (a) `PIPELINE_ENABLED=false` → exits early, collector NOT called; (b) all pings fail → connectivity alert sent with `CONNECTIVITY_LABEL`, collector NOT called; (c) pings ok → collector→analyze→alert called in order; (d) second run holds the flock and the concurrent run exits 0 without collecting.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `core/run.sh`** — port the existing gate ladder with all VK/VPN strings sourced from config; lock name `health-${HEALTH_PRODUCT}-${HEALTH_DEPLOYMENT}`; connectivity uses `CONNECTIVITY_NODES` + `CONNECTIVITY_LABEL`; throttle uses `THROTTLE_MINUTES` (state `$DATA_DIR/analysis-state.json`); heartbeat reads `last-alert-count`; log-dispatch domain `health-${HEALTH_PRODUCT}` and service tag from config.

- [ ] **Step 4: Run** — Expected: PASS. **Step 5: Commit** `git add scripts/health/core/run.sh tests/health/run.test.mjs && git commit -m "feat(health): generic run.sh orchestrator with config-driven gates"`

### Task 9: `core/trends.sh` + `core/cleanup-reports.sh`

**Files:** Create both; Test `tests/health/trends.test.mjs`.

**Interfaces:** trends → `$SNAPSHOT_DIR/trends.json` (min/max/avg per metric key across the day) + snapshot retention (config `snapshot_retention_days`, default 90). cleanup → analysis 7d / consolidated 30d / monthly permanent (config-overridable).

- [ ] **Step 1: Failing test** — seed a temp `DATA_DIR/<date>/` with 3 snapshots; run `core/trends.sh vk 03002`; assert `trends.json` has min/max/avg for `node.vk01.disk.root.pct`. Seed an old date dir and assert it is pruned by the retention window.

- [ ] **Step 2: Run** FAIL → **Step 3: Implement** generically over the flat `metrics` keys (no GPU-specific branches; iterate whatever keys exist). Retention windows from config with the existing defaults. → **Step 4: Run** PASS.

- [ ] **Step 5: Commit** `git add scripts/health/core/trends.sh scripts/health/core/cleanup-reports.sh tests/health/trends.test.mjs && git commit -m "feat(health): generic trends + cleanup-reports"`

### Task 10: `core/monthly-consolidate.sh`

**Files:** Create `scripts/health/core/monthly-consolidate.sh`; Test `tests/health/monthly.test.mjs`.

**Interfaces:** Aggregates `consolidated-<month>-*.md` + `trends.json` → `monthly-<month>.md` via Claude; generic over `REPORT_DIR`+config. Folds in the VK-only script (SF gains it for free).

- [ ] **Step 1: Failing test** — stub `claude`; seed temp `REPORT_DIR` with two `consolidated-2026-05-*.md`; run `core/monthly-consolidate.sh sf 02006 2026-05`; assert `monthly-2026-05.md` written and `claude` got `--model` from config.

- [ ] **Step 2: Run** FAIL → **Step 3: Implement** port of existing `monthly-consolidate.sh`, product strings from config, log-dispatch tag `health-monthly`. → **Step 4: Run** PASS → **Step 5: Commit** `git add scripts/health/core/monthly-consolidate.sh tests/health/monthly.test.mjs && git commit -m "feat(health): generic monthly-consolidate (now available to all products)"`

---

## Phase 3 — VK collector + cutover

### Task 11: `collectors/vk.sh` + VK assemblers

**Files:**
- Create: `scripts/health/collectors/vk.sh`
- Create: `scripts/health/assemblers/vk/assemble_dashboard.py`, `assemble_processing.py` (moved copies of the existing `scripts/vk-health/lib/*.py`, unchanged)
- Test: `tests/health/collector-vk.test.mjs`

**Interfaces:** `collectors/vk.sh <deployment>` writes a schema-1 snapshot. Consumes `lib/config.sh`+`lib/ssh.sh`. **Produces both** `raw` (the existing nested `{nodes:{...}, gui_status:{...}}` from the assemblers — unchanged) **and** the flat `metrics` map per the key convention, by flattening `raw`.

Port source (cite, don't reinvent): probe logic = `scripts/vk-health/collect.sh:84-409` (prom_query :84-99, GPU :173-185, img_saved :215-220, service SSH+assembler :250-295, rabbitmq :298-320, gui :344-392, parallel :398-409). Prometheus `localhost:8110` + `NO_PROXY` (:92) move to config `ports`/already-implicit.

- [ ] **Step 1: Write the failing test** — install `cli-stub` for `ssh`,`sshpass`,`curl` returning canned Prometheus scalars + a canned assembler JSON (via `CURL_STUB_OUT`/`SSH_STUB_OUT`). Run `collectors/vk.sh 03002` with `DATA_DIR` in a temp home. Assert: a snapshot file is written under `<date>/snapshot-*.json`; `validateSnapshot()` returns `[]`; `metrics` contains `node.vk01.disk.root.pct`, `node.vk01.gpu.0.mem.pct`, `node.vk03.gui.80.up`; an unreachable-stubbed node yields `node.<n>.reachable=0` and no other keys for it.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Move the assemblers** unchanged into `assemblers/vk/` and point the collector's `scp_to` at the new path.

- [ ] **Step 4: Implement `collectors/vk.sh`** — reuse the ported probe code to build `raw` exactly as today, then add a **flatten step**: a Python or jq pass that walks `raw.nodes[*]` and emits the flat numeric `metrics` (disk/ram/cpu/gpu/uptime/containers/rabbitmq/img_saver/gui per the key table, booleans as 0/1), writes the final `{schema:1,product:"vk",deployment,collected_at,nodes,metrics,raw}`. Fail-open per node (unreachable → only `reachable:0`).

- [ ] **Step 5: Run** — Expected: PASS. **Step 6: Commit** `git add scripts/health/collectors/vk.sh scripts/health/assemblers/vk tests/health/collector-vk.test.mjs && git commit -m "feat(health): VK collector emitting normalized snapshot (raw + flat metrics)"`

### Task 12: `config/health/vk/03002.json`

**Files:** Create `config/health/vk/03002.json`; Test `tests/health/config-vk-real.test.mjs`.

**Interfaces:** Migrated from `config/vk-deployments/03002.json` + the thresholds currently in `alert.sh`. `checks[]` (behavior-preserving): root disk high 90/95, img_saved high 75/90, ram high 85/95, gpu.0.mem high 90/95, container.*.up low 1/1, container.*.restarts high 3/10, rabbitmq.queue_max.depth high 5000/10000, service.image_saver.up low 1/1, uptime_seconds low 1800/0 (recent-reboot warn), gui.*.up low 1/1. Keep `nodes`, `ports`, `redis_dbs`, `rabbitmq_user`, `gui_checks` for the collector. `data_root:"data/vk-health"`, `reports_root:"reports/vk-health"`, `enabled:false` (matches current).

- [ ] **Step 1: Failing test** — `load_health_config vk 03002` against the **real** config + `evaluate_checks` over `snapshot-vk.json` reproduces the expected verdicts (vk02 root disk → crit; vk01 gpu mem → warn). Assert no check `field` references a metric key the collector never emits (cross-check against the Task-11 key table).

- [ ] **Step 2: Run** FAIL → **Step 3: Write the config** → **Step 4: Run** PASS → **Step 5: Commit** `git add config/health/vk/03002.json tests/health/config-vk-real.test.mjs && git commit -m "feat(health): VK 03002 unified config (thresholds → checks)"`

### Task 13: VK side-by-side validation + cron cutover (procedural)

**Files:** Modify the crontab (backup first to `logs/`); no code.

- [ ] **Step 1: Run new collector beside the live one** (manually, several cycles): `ORCHESTRATOR_HOME=$HOME/JARVIS scripts/health/collectors/vk.sh 03002` and diff its `metrics` against the live `scripts/vk-health/collect.sh` snapshot's derived values. Document the diff in `reports/vk-health/03002/migration-diff.md`.
- [ ] **Step 2: Iterate** `collectors/vk.sh` until the flat metrics match the live monitor's thresholds decisions (same nodes warn/crit). **No green-light until the diff is clean.**
- [ ] **Step 3: Dry-run the pipeline** `scripts/health/health.sh vk 03002 run` with `PIPELINE_ENABLED` temporarily true on a scratch deployment id; confirm `latest.md` + alerts match the old output.
- [ ] **Step 4: Flip the cron** — back up `crontab -l > logs/crontab-backup-$(date -u +%Y%m%d-%H%M%S).txt`, then repoint the `*/15` and `23:30` and `0 6 1 * *` VK lines from `scripts/vk-health/run.sh|trends.sh|monthly-consolidate.sh` to `scripts/health/health.sh vk 03002 {run|trends|monthly-consolidate}`.
- [ ] **Step 5: Watch one full cycle** in prod; confirm snapshot/report/alert parity. **Commit** the crontab backup + migration-diff note.

---

## Phase 4 — SF collector + cutover

### Task 14: `collectors/sf.sh` + SF assembler

**Files:** Create `scripts/health/collectors/sf.sh`; move `scripts/sf-health/lib/assemble_server.py` → `assemblers/sf/assemble_server.py`; Test `tests/health/collector-sf.test.mjs`.

**Interfaces:** Same snapshot contract; single node `server`. Port source: `scripts/sf-health/collect.sh` (3 Redis containers `sparkeyes-*` :231-238, postgres `sparkeyes` :241-242, rabbitmq `:15672` :257-277, gui LAN checks :306-353). No GPU/img_saved keys.

- [ ] **Step 1: Failing test** — stub ssh/curl; run `collectors/sf.sh 02006`; assert snapshot validates, `metrics` has `node.server.disk.root.pct`, `node.server.rabbitmq.queue_max.depth`, `node.server.gui.8100.up`, and **no** `gpu.*`/`img_saved` keys.
- [ ] **Step 2: Run** FAIL → **Step 3: Implement** (port SF probes; flatten to metrics) → **Step 4: Run** PASS → **Step 5: Commit** `git add scripts/health/collectors/sf.sh scripts/health/assemblers/sf tests/health/collector-sf.test.mjs && git commit -m "feat(health): SF collector emitting normalized snapshot"`

### Task 15: `config/health/sf/02006.json`

**Files:** Create `config/health/sf/02006.json` (new — SF had no JSON; thresholds came from `sf-health/lib/config.sh`); Test `tests/health/config-sf-real.test.mjs`.

**Interfaces:** `checks[]`: root disk high (SF `DISK_WARNING/CRITICAL_PCT`), ram high, rabbitmq.queue_max.depth high (`QUEUE_WARNING/CRITICAL`), container.*.restarts high (`RESTART_*`), container.*.up low, gui.*.up low. `connectivity.label:"Network"`, single node `server`. `data_root:"data/sf-health"`, `reports_root:"reports/sf-health"`, secret `~/.secrets/sf-ssh-password` (+ rabbit guest fallback documented).

- [ ] **Step 1: Failing test** → **Step 2: FAIL** → **Step 3: Write config** → **Step 4: PASS** → **Step 5: Commit** `git add config/health/sf/02006.json tests/health/config-sf-real.test.mjs && git commit -m "feat(health): SF 02006 unified config"`

### Task 16: SF side-by-side + cron cutover (procedural)

- [ ] Mirror Task 13 for SF: side-by-side diff → iterate → dry-run → back up crontab → flip the SF `*/15`+`23:30` lines (and **add** the new `0 6 1 * *` monthly line SF didn't have) to `scripts/health/health.sh sf 02006 …` → watch a cycle → commit crontab backup.

---

## Phase 5 — Relocate + retire

### Task 17: Relocate one-offs

**Files:** `git mv scripts/vk-health/gpu-watchdog.sh scripts/health/node-agents/gpu-watchdog.sh`; `git mv scripts/sf-health/explore-server.sh scripts/health/tools/sf-explore-server.sh` (already secret-free — verify no literal); `git mv scripts/sf-health/references scripts/health/references` (if non-empty; else create `.gitkeep`).

- [ ] **Step 1:** Move the files; grep the moved `sf-explore-server.sh` to confirm it reads `~/.secrets/sf-ssh-password` (no hardcoded password — already scrubbed this session).
- [ ] **Step 2:** Grep the repo for any references to the old paths (skills, docs, cron) and update them.
- [ ] **Step 3: Commit** `git add -A scripts/health/node-agents scripts/health/tools scripts/health/references && git rm … && git commit -m "chore(health): relocate gpu-watchdog, sf-explore-server, references under scripts/health"` (stage only these paths).

### Task 18: Shim, verify, retire old dirs

**Files:** Replace `scripts/vk-health/{run,trends,monthly-consolidate}.sh` and `scripts/sf-health/{run,trends}.sh` with one-line redirect shims for one release, then delete the old trees.

- [ ] **Step 1:** Write each old entry script as `exec "$(dirname "$0")/../health/health.sh" vk 03002 <mode> "$@"` (sf analogously). Commit. Let one prod cycle run through the shim to confirm cron still works if not yet repointed.
- [ ] **Step 2:** After Tasks 13/16 confirm crons point straight at `health.sh`, `git rm -r scripts/vk-health scripts/sf-health`; grep for any lingering references; update `config/vk-deployments`/`config/sf-deployments` (leave as-is or migrate note).
- [ ] **Step 3: Commit** `git rm -r scripts/vk-health scripts/sf-health && git commit -m "chore(health): retire legacy vk-health/sf-health trees (unified into scripts/health)"`.

### Task 19: File the `sdk-observability-stack` follow-up

- [ ] Using the backlog-manager / `gh issue create` flow on `strokmatic/sdk-observability-stack`: file "Absorb VK `deploy/` (gpu/no-gpu compose split + scrape targets) into the canonical observability stack; remove VK's `deploy/` from JARVIS." Reference spec §1/§9. This is **not** code in this plan — just the tracking issue so the deferred work isn't lost.

---

## Self-Review

- **Spec coverage:** §3 layout → Tasks 1–18; §4 snapshot contract → Task 1; §5 generic core (analyze/alert/trends/cleanup/monthly + check `direction`) → Tasks 3,6,7,9,10; config schema → Tasks 2,12,15; §6 strangler steps 1–5 → Phases 1–5; §7 error handling (fail-closed gates, fail-open nodes, unknown-safe) → Tasks 3,8,11; §8 offline testing → every task's stub-based test; §9 non-goals (deploy/ separate, one-offs relocated-not-folded) → Tasks 17,19. **Gap closed:** spec's "analyze renders via assembler + emits verdicts" reconciled to measured reality (check engine in `lib/checks.sh`→`alert.sh`; assemblers stay collector-side; analyze stays Claude reporter) — documented at plan top.
- **Placeholder scan:** none — every code step carries real code or a cited source range + exact command.
- **Type consistency:** `load_health_config`, `evaluate_checks`, `ssh_cmd`, `send_telegram_alert`, the metric-key convention, and the snapshot schema are defined once (File Structure / Task 1–4) and referenced unchanged downstream.
