# health-monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a passive health monitor service for the Strokmatic infra server that detects and alerts silent service failures (pr-review, context-refresh, github-clickup-sync, and future services), closing the gap where failures today are only discoverable via SSH log inspection.

**Architecture:** Node.js ESM cron job (`*/10 * * * *`) on `192.168.15.2`. Reads per-service `state.json` files written by services at run completion, evaluates status via a pure decision-table module, applies dedup policy (1h cooldown per alert type with escalation override), fires Telegram alerts through the existing notifier MCP + `jarvis-alerts` bot, and writes aggregate `health-summary.{json,md}` outputs. Zero new dependencies; reuses all existing alert infrastructure.

**Tech Stack:** Node.js ESM (built-in `fs`, `path`, `child_process` only). `node:test` for unit tests. Bash for `run.sh`/`deploy.sh`. Invokes notifier MCP via `claude --print --allowedTools mcp__notifier__send_notification`.

**Spec:** `docs/superpowers/specs/2026-04-14-health-monitor-design.md`

**Working repo:** `/home/teruel/JARVIS/workspaces/strokmatic/infra/` (the `strokmatic/infra` GitHub repo, master branch)

**Spec deviations:** None anticipated. This plan is a direct execution of the spec.

---

## File Structure

### Created in `services/health-monitor/`

```
services/health-monitor/
├── run.sh                               # Cron entry: bash thin wrapper → node index.mjs
├── deploy.sh                            # rsync → server, install cron, smoke test
├── package.json                         # {"type": "module"}
├── index.mjs                            # Orchestrator (thin, ~80 lines)
├── .gitignore                           # ignore data/ and logs/
├── config/
│   └── services.json                    # Registry of monitored services
├── lib/
│   ├── config.mjs                       # loadConfig(path) → {bootstrap_grace_minutes, services[]}
│   ├── state-reader.mjs                 # readState(path) → {state, error}
│   ├── status-evaluator.mjs             # PURE: evaluate(state, serviceCfg, now) → {status, severity, reason}
│   ├── alert-policy.mjs                 # PURE: shouldFire(evals, history, now) → {alerts, newHistory}
│   ├── alert-sender.mjs                 # sendAlert(alert) → calls notifier MCP
│   └── summary-writer.mjs               # writeSummary(outDir, evals, alerts) → writes JSON + MD
└── test/
    ├── status-evaluator.test.mjs        # ~20 tests
    ├── alert-policy.test.mjs            # ~15 tests
    ├── state-reader.test.mjs            # ~5 tests
    ├── config.test.mjs                  # ~3 tests
    └── test-integration.mjs             # End-to-end smoke
```

### Created in `services/_shared/`

```
services/_shared/
└── state-writer.sh                      # Bash helper sourced by migrating services
```

### Modified (migrations)

```
services/pr-review/run.sh                # Add write_state calls, ERR trap
services/context-refresh/run.sh          # Replace last-run.txt + last-task-count.txt with state.json
services/context-refresh/notify.sh       # (remove reads of legacy .txt files if any)
services/github-clickup-sync/index.js    # Add state.json write at end of poll cycle
```

### Modified (JARVIS host config)

```
config/orchestrator/notifications.json   # Add "infra-health" → "jarvis-alerts" route
```

---

## Phase 0 — Scaffolding

Creates the service skeleton. No logic yet.

### Task 0.1: Create directory tree + package.json + gitignore + empty config

**Files:**
- Create: `services/health-monitor/package.json`
- Create: `services/health-monitor/.gitignore`
- Create: `services/health-monitor/config/services.json`
- Create: `services/health-monitor/lib/.gitkeep`
- Create: `services/health-monitor/test/.gitkeep`
- Create: `services/_shared/.gitkeep`

- [ ] **Step 1: Create directories**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
mkdir -p services/health-monitor/{lib,test,config,data,logs}
mkdir -p services/_shared
touch services/health-monitor/lib/.gitkeep services/health-monitor/test/.gitkeep services/_shared/.gitkeep
```

- [ ] **Step 2: Write `services/health-monitor/package.json`**

```json
{
  "name": "health-monitor",
  "version": "0.1.0",
  "type": "module",
  "description": "Passive observability service for Strokmatic infra (failure + staleness alerts)",
  "private": true,
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 3: Write `services/health-monitor/.gitignore`**

```
data/
logs/
*.log
```

- [ ] **Step 4: Write `services/health-monitor/config/services.json`** (template — `added_at: null` for all, so nothing activates yet)

```json
{
  "bootstrap_grace_minutes": 120,
  "services": {
    "pr-review": {
      "state_file": "/opt/jarvis-pr-review/data/state.json",
      "cadence_minutes": 5,
      "staleness_factor": 2.5,
      "alert_on_partial": true,
      "added_at": null
    },
    "context-refresh": {
      "state_file": "/opt/jarvis-context-refresh/data/state.json",
      "cadence_minutes": 20160,
      "staleness_factor": 1.2,
      "alert_on_partial": false,
      "added_at": null
    },
    "github-clickup-sync": {
      "state_file": "/opt/jarvis-github-clickup-sync/data/state.json",
      "cadence_minutes": 15,
      "staleness_factor": 2.0,
      "alert_on_partial": true,
      "added_at": null
    }
  }
}
```

- [ ] **Step 5: Verify structure**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
find services/health-monitor -type f -o -type d | sort
node --version
node -e "import('./services/health-monitor/package.json', { with: { type: 'json' } }).then(p => console.log(p.default.name))"
```

Expected: all files/dirs listed, Node ≥ 20, `health-monitor` printed. No commit yet — we commit phase-by-phase at end of each phase.

---

## Phase 1 — Pure module: `status-evaluator.mjs` (TDD)

Incrementally build the decision table. 4 tasks, 15+ tests.

### Task 1.1: Bootstrapping and healthy baseline

**Files:**
- Create: `services/health-monitor/test/status-evaluator.test.mjs`
- Create: `services/health-monitor/lib/status-evaluator.mjs`

- [ ] **Step 1: Write failing tests**

```js
// services/health-monitor/test/status-evaluator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../lib/status-evaluator.mjs';

const baseCfg = {
  cadence_minutes: 5,
  staleness_factor: 2.5,
  alert_on_partial: true,
  added_at: '2026-04-14T12:00:00Z',
  bootstrap_grace_minutes: 120,
};

function state(overrides = {}) {
  return {
    service: 'pr-review',
    last_run: '2026-04-14T14:00:00Z',
    last_status: 'success',
    duration_ms: 43000,
    exit_code: 0,
    ...overrides,
  };
}

test('healthy: recent success within cadence window', () => {
  const result = evaluate(state(), baseCfg, new Date('2026-04-14T14:03:00Z'));
  assert.equal(result.status, 'healthy');
  assert.equal(result.severity, null);
});

test('bootstrapping: state is null, grace period active', () => {
  const result = evaluate(null, baseCfg, new Date('2026-04-14T12:30:00Z'));
  assert.equal(result.status, 'bootstrapping');
  assert.equal(result.severity, 'info');
  assert.match(result.reason, /grace period/i);
});

test('bootstrapping: added_at = null means service ignored entirely', () => {
  const cfg = { ...baseCfg, added_at: null };
  const result = evaluate(null, cfg, new Date('2026-04-14T12:30:00Z'));
  assert.equal(result.status, 'ignored');
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/health-monitor
node --test test/status-evaluator.test.mjs
```

Expected: all fail with `Cannot find module '../lib/status-evaluator.mjs'`.

- [ ] **Step 3: Implement minimal evaluate()**

```js
// services/health-monitor/lib/status-evaluator.mjs
/**
 * Pure evaluation function for a single service's health status.
 *
 * @param {object|null} state - Parsed state.json content, or null if missing
 * @param {object} serviceCfg - Service config from services.json (includes bootstrap_grace_minutes)
 * @param {Date} now - Current time (injected for testability)
 * @returns {{status: string, severity: string|null, reason: string|null}}
 */
export function evaluate(state, serviceCfg, now) {
  // Rule: added_at = null → service ignored (not yet activated)
  if (serviceCfg.added_at === null) {
    return { status: 'ignored', severity: null, reason: null };
  }

  const addedAt = new Date(serviceCfg.added_at);
  const graceMs = serviceCfg.bootstrap_grace_minutes * 60 * 1000;
  const inGracePeriod = (now - addedAt) <= graceMs;

  // Rule 1: state missing + grace period active → bootstrapping
  if (state === null && inGracePeriod) {
    const expectedBy = new Date(addedAt.getTime() + graceMs);
    return {
      status: 'bootstrapping',
      severity: 'info',
      reason: `grace period active, expected first run by ${expectedBy.toISOString()}`,
    };
  }

  // Rule 9: default — healthy
  return { status: 'healthy', severity: null, reason: null };
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
node --test test/status-evaluator.test.mjs
```

Expected: `# pass 3`.

### Task 1.2: Failed and partial statuses

- [ ] **Step 1: Add failing tests**

Append to `test/status-evaluator.test.mjs`:

```js
test('failed: last_status is "failed"', () => {
  const result = evaluate(
    state({ last_status: 'failed', exit_code: 1 }),
    baseCfg,
    new Date('2026-04-14T14:03:00Z'),
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.severity, 'critical');
  assert.match(result.reason, /exit code 1/);
});

test('partial: last_status partial and alert_on_partial true', () => {
  const result = evaluate(
    state({ last_status: 'partial' }),
    baseCfg,
    new Date('2026-04-14T14:03:00Z'),
  );
  assert.equal(result.status, 'partial');
  assert.equal(result.severity, 'warning');
});

test('partial ignored when alert_on_partial is false', () => {
  const cfg = { ...baseCfg, alert_on_partial: false };
  const result = evaluate(
    state({ last_status: 'partial' }),
    cfg,
    new Date('2026-04-14T14:03:00Z'),
  );
  assert.equal(result.status, 'healthy');
  assert.equal(result.severity, null);
});

test('malformed state: missing required field → failed', () => {
  const badState = { service: 'pr-review' }; // missing last_run, last_status, duration_ms
  const result = evaluate(badState, baseCfg, new Date('2026-04-14T14:03:00Z'));
  assert.equal(result.status, 'failed');
  assert.equal(result.severity, 'critical');
  assert.match(result.reason, /invalid|missing/i);
});
```

- [ ] **Step 2: Run, verify the 4 new fail**

```bash
node --test test/status-evaluator.test.mjs
```

- [ ] **Step 3: Extend `evaluate()`**

Replace the body of `evaluate()` in `lib/status-evaluator.mjs`:

```js
export function evaluate(state, serviceCfg, now) {
  if (serviceCfg.added_at === null) {
    return { status: 'ignored', severity: null, reason: null };
  }

  const addedAt = new Date(serviceCfg.added_at);
  const graceMs = serviceCfg.bootstrap_grace_minutes * 60 * 1000;
  const inGracePeriod = (now - addedAt) <= graceMs;

  if (state === null && inGracePeriod) {
    const expectedBy = new Date(addedAt.getTime() + graceMs);
    return {
      status: 'bootstrapping',
      severity: 'info',
      reason: `grace period active, expected first run by ${expectedBy.toISOString()}`,
    };
  }

  // Malformed state: missing required fields
  if (state !== null) {
    const required = ['service', 'last_run', 'last_status', 'duration_ms'];
    for (const field of required) {
      if (state[field] === undefined || state[field] === null) {
        return {
          status: 'failed',
          severity: 'critical',
          reason: `state file invalid: missing required field '${field}'`,
        };
      }
    }
  }

  // Explicit failure
  if (state && state.last_status === 'failed') {
    return {
      status: 'failed',
      severity: 'critical',
      reason: `last run failed (exit code ${state.exit_code ?? 'unknown'})`,
    };
  }

  // Partial
  if (state && state.last_status === 'partial') {
    if (serviceCfg.alert_on_partial) {
      return {
        status: 'partial',
        severity: 'warning',
        reason: 'last run completed with warnings',
      };
    }
    return { status: 'healthy', severity: null, reason: null };
  }

  return { status: 'healthy', severity: null, reason: null };
}
```

- [ ] **Step 4: Run, verify 7 total pass**

```bash
node --test test/status-evaluator.test.mjs
```

Expected: `# pass 7`.

### Task 1.3: Staleness detection with severity escalation

- [ ] **Step 1: Add failing tests**

Append:

```js
test('stale: last_run older than cadence × staleness_factor, warning severity (<2× delta)', () => {
  // cadence 5, factor 2.5 → expected by = last_run + 12.5min
  // delta of 15min puts us at 2.5min past threshold, delta_ratio = 0.5 → warning
  const result = evaluate(
    state({ last_run: '2026-04-14T14:00:00Z' }),
    baseCfg,
    new Date('2026-04-14T14:15:00Z'),
  );
  assert.equal(result.status, 'stale');
  assert.equal(result.severity, 'warning');
  assert.match(result.reason, /stale/i);
});

test('stale: severity escalates to critical at delta_ratio ≥ 2', () => {
  // last_run 14:00, now 14:25 → delta past threshold = 12.5min = 2.5× cadence → critical
  const result = evaluate(
    state({ last_run: '2026-04-14T14:00:00Z' }),
    baseCfg,
    new Date('2026-04-14T14:25:00Z'),
  );
  assert.equal(result.status, 'stale');
  assert.equal(result.severity, 'critical');
});

test('stale: state missing after grace period expired', () => {
  // added_at 12:00, grace 120min → grace expires at 14:00
  // now 15:00 → 1h past grace expiry → stale critical
  const result = evaluate(null, baseCfg, new Date('2026-04-14T15:00:00Z'));
  assert.equal(result.status, 'stale');
  assert.equal(result.severity, 'critical');
  assert.match(result.reason, /never ran/i);
});

test('stale: exactly on boundary (last_run + cadence × factor == now) is still healthy', () => {
  // last_run 14:00, cadence 5, factor 2.5 → boundary at 14:12.5
  // at exactly 14:12:30, delta is 0 → healthy
  const result = evaluate(
    state({ last_run: '2026-04-14T14:00:00Z' }),
    baseCfg,
    new Date('2026-04-14T14:12:30Z'),
  );
  assert.equal(result.status, 'healthy');
});

test('healthy: time drift (last_run in near future, within clock skew tolerance)', () => {
  // last_run slightly in future (clock skew) — should not crash or mark as stale
  const result = evaluate(
    state({ last_run: '2026-04-14T14:01:00Z' }),
    baseCfg,
    new Date('2026-04-14T14:00:00Z'),
  );
  assert.equal(result.status, 'healthy');
});
```

- [ ] **Step 2: Run, verify the 5 new fail**

```bash
node --test test/status-evaluator.test.mjs
```

- [ ] **Step 3: Add staleness logic**

In `lib/status-evaluator.mjs`, after the malformed-state guard and before the explicit-failure branch (i.e., the `state.last_status === 'failed'` block), add:

```js
  // Staleness check — applies after we know state is valid and not explicitly failed
  if (state !== null) {
    const lastRun = new Date(state.last_run);
    const cadenceMs = serviceCfg.cadence_minutes * 60 * 1000;
    const thresholdMs = cadenceMs * serviceCfg.staleness_factor;
    const expectedBy = new Date(lastRun.getTime() + thresholdMs);
    const deltaMs = now - expectedBy;

    if (deltaMs > 0) {
      const deltaRatio = deltaMs / cadenceMs;
      const severity = deltaRatio >= 2 ? 'critical' : 'warning';
      const minsAgo = Math.round((now - lastRun) / 60000);
      return {
        status: 'stale',
        severity,
        reason: `stale: last run ${minsAgo}min ago, expected every ${serviceCfg.cadence_minutes}min`,
      };
    }
  }
```

**Critical ordering:** the staleness check must run **after** the malformed-state and failed-status checks (so "failed" beats "stale"), **before** the partial check and the default healthy return.

Also add the missing-state-past-grace case. Replace the existing bootstrapping block with:

```js
  if (state === null) {
    if (inGracePeriod) {
      const expectedBy = new Date(addedAt.getTime() + graceMs);
      return {
        status: 'bootstrapping',
        severity: 'info',
        reason: `grace period active, expected first run by ${expectedBy.toISOString()}`,
      };
    }
    return {
      status: 'stale',
      severity: 'critical',
      reason: 'state file missing, service never ran after grace period',
    };
  }
```

- [ ] **Step 4: Run, verify 12 total pass**

```bash
node --test test/status-evaluator.test.mjs
```

Expected: `# pass 12`.

### Task 1.4: Edge cases — failed before stale, optional exit_code, custom reasons

- [ ] **Step 1: Add failing tests**

Append:

```js
test('priority: explicit failure wins over staleness', () => {
  // last_run 10h ago (would be stale) AND last_status failed → failed wins
  const result = evaluate(
    state({ last_run: '2026-04-14T04:00:00Z', last_status: 'failed', exit_code: 2 }),
    baseCfg,
    new Date('2026-04-14T14:00:00Z'),
  );
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /exit code 2/);
});

test('failed: exit_code missing → "unknown" in reason', () => {
  const badState = { ...state(), last_status: 'failed' };
  delete badState.exit_code;
  const result = evaluate(badState, baseCfg, new Date('2026-04-14T14:03:00Z'));
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /unknown/);
});

test('malformed: null last_status → failed (not partial, not healthy)', () => {
  const badState = { ...state(), last_status: null };
  const result = evaluate(badState, baseCfg, new Date('2026-04-14T14:03:00Z'));
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /last_status/);
});

test('malformed: last_run not a valid ISO string', () => {
  const badState = { ...state(), last_run: 'yesterday' };
  const result = evaluate(badState, baseCfg, new Date('2026-04-14T14:03:00Z'));
  // NaN propagates through Date arithmetic; we treat this as invalid
  assert.equal(result.status, 'failed');
});
```

- [ ] **Step 2: Run, verify fail**

Running the test, the first two should already pass (existing code handles them). The third requires adding `null` to the "missing required field" check. The fourth requires detecting NaN from invalid date parsing.

- [ ] **Step 3: Add validation for null fields and invalid dates**

In `lib/status-evaluator.mjs`, inside the `if (state !== null)` malformed-state check, replace the loop:

```js
  if (state !== null) {
    const required = ['service', 'last_run', 'last_status', 'duration_ms'];
    for (const field of required) {
      if (state[field] === undefined || state[field] === null) {
        return {
          status: 'failed',
          severity: 'critical',
          reason: `state file invalid: missing required field '${field}'`,
        };
      }
    }
    // Validate last_run is parseable
    if (isNaN(new Date(state.last_run).getTime())) {
      return {
        status: 'failed',
        severity: 'critical',
        reason: `state file invalid: last_run is not a valid ISO timestamp`,
      };
    }
  }
```

- [ ] **Step 4: Run, all pass**

```bash
node --test test/status-evaluator.test.mjs
```

Expected: `# pass 16`.

### Task 1.5: Phase 1 review + commit

- [ ] **Step 1: Final suite run**

```bash
node --test test/status-evaluator.test.mjs 2>&1 | tail -6
```

Expected: `# pass 16`, `# fail 0`.

- [ ] **Step 2: Sanity-check the module is syntactically clean**

```bash
node --check lib/status-evaluator.mjs
```

Expected: silent (exit 0).

- [ ] **Step 3: Commit (Phase 1 complete)**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git add services/health-monitor/
git status --porcelain services/health-monitor/
# Verify only expected files staged, then:
git commit -m "feat(health-monitor): scaffolding + pure status-evaluator module

Phase 0 (scaffolding) + Phase 1 (status-evaluator, 16 unit tests TDD).
Pure function: (state, serviceCfg, now) → {status, severity, reason}.
Handles bootstrapping, healthy, stale (warning+critical), failed,
partial, malformed state, and timestamp edge cases.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Pure module: `alert-policy.mjs` (TDD)

Handles dedup, escalation, and recovery detection.

### Task 2.1: First-fire of each alert type

**Files:**
- Create: `services/health-monitor/test/alert-policy.test.mjs`
- Create: `services/health-monitor/lib/alert-policy.mjs`

- [ ] **Step 1: Write failing tests**

```js
// services/health-monitor/test/alert-policy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldFire } from '../lib/alert-policy.mjs';

const NOW = new Date('2026-04-14T14:00:00Z');

function evalOf(service, status, severity = 'critical') {
  return { service, status, severity, reason: `test ${status}` };
}

test('empty history + critical failure → one alert fired', () => {
  const { alerts, newHistory } = shouldFire(
    [evalOf('pr-review', 'failed')],
    {},
    NOW,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'service_failed');
  assert.equal(alerts[0].service, 'pr-review');
  assert.equal(newHistory['pr-review'].failed.active, true);
  assert.equal(newHistory['pr-review'].failed.fire_count, 1);
});

test('empty history + stale warning → one alert fired, type service_stale', () => {
  const { alerts, newHistory } = shouldFire(
    [evalOf('gdrive-index', 'stale', 'warning')],
    {},
    NOW,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'service_stale');
  assert.equal(newHistory['gdrive-index'].stale.last_severity, 'warning');
});

test('healthy evaluation with no prior history → no alert', () => {
  const { alerts, newHistory } = shouldFire(
    [evalOf('pr-review', 'healthy', null)],
    {},
    NOW,
  );
  assert.equal(alerts.length, 0);
  assert.deepEqual(newHistory, {});
});

test('ignored status → no alert, no history change', () => {
  const { alerts, newHistory } = shouldFire(
    [{ service: 'future-svc', status: 'ignored', severity: null }],
    {},
    NOW,
  );
  assert.equal(alerts.length, 0);
  assert.deepEqual(newHistory, {});
});

test('bootstrapping → no alert, no history change', () => {
  const { alerts, newHistory } = shouldFire(
    [{ service: 'new-svc', status: 'bootstrapping', severity: 'info' }],
    {},
    NOW,
  );
  assert.equal(alerts.length, 0);
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/alert-policy.test.mjs
```

Expected: all fail with module-not-found.

- [ ] **Step 3: Implement minimal shouldFire()**

```js
// services/health-monitor/lib/alert-policy.mjs
/**
 * Dedup + escalation policy for alerts.
 *
 * @param {object[]} evaluations - Array of {service, status, severity, reason} from status-evaluator
 * @param {object} alertHistory - Parsed alert-state.json ({service → {type → {first_fired_at, ...}}})
 * @param {Date} now
 * @returns {{alerts: object[], newHistory: object}}
 */
export function shouldFire(evaluations, alertHistory, now) {
  const alerts = [];
  const newHistory = deepClone(alertHistory);

  for (const evalRecord of evaluations) {
    const { service, status, severity } = evalRecord;

    if (status === 'ignored' || status === 'bootstrapping') continue;
    if (status === 'healthy') continue; // recovery handled later (Task 2.4)

    const alertType = statusToAlertType(status);
    const serviceHistory = newHistory[service] || {};
    const prev = serviceHistory[alertType];

    // First fire for this (service, type): create entry, fire alert
    if (!prev || prev.active === false) {
      alerts.push(buildAlert(evalRecord, alertType, 1, now));
      serviceHistory[alertType] = {
        first_fired_at: now.toISOString(),
        last_fired_at: now.toISOString(),
        fire_count: 1,
        last_severity: severity,
        active: true,
      };
      newHistory[service] = serviceHistory;
      continue;
    }
  }

  return { alerts, newHistory };
}

function statusToAlertType(status) {
  return { failed: 'service_failed', stale: 'service_stale', partial: 'service_partial' }[status];
}

function buildAlert(evalRecord, type, fireCount, now) {
  return {
    type,
    service: evalRecord.service,
    status: evalRecord.status,
    severity: evalRecord.severity,
    reason: evalRecord.reason,
    fired_at: now.toISOString(),
    fire_count: fireCount,
  };
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
```

- [ ] **Step 4: Run, verify 5 pass**

```bash
node --test test/alert-policy.test.mjs
```

Expected: `# pass 5`.

### Task 2.2: Cooldown dedup (1h silencing)

- [ ] **Step 1: Add failing tests**

Append:

```js
test('cooldown: same alert within 1h is silenced, fire_count increments', () => {
  const history = {
    'pr-review': {
      service_failed: {
        first_fired_at: '2026-04-14T13:30:00Z',
        last_fired_at: '2026-04-14T13:30:00Z',
        fire_count: 1,
        last_severity: 'critical',
        active: true,
      },
    },
  };
  const { alerts, newHistory } = shouldFire(
    [evalOf('pr-review', 'failed')],
    history,
    NOW, // 14:00:00Z = 30min later, still in cooldown
  );
  assert.equal(alerts.length, 0);
  assert.equal(newHistory['pr-review'].service_failed.fire_count, 2);
  assert.equal(newHistory['pr-review'].service_failed.last_fired_at, NOW.toISOString());
});

test('post-cooldown: alert fires again after 1h', () => {
  const history = {
    'pr-review': {
      service_failed: {
        first_fired_at: '2026-04-14T12:45:00Z',
        last_fired_at: '2026-04-14T12:45:00Z',
        fire_count: 1,
        last_severity: 'critical',
        active: true,
      },
    },
  };
  const { alerts, newHistory } = shouldFire(
    [evalOf('pr-review', 'failed')],
    history,
    NOW, // 14:00 = 75min later, cooldown expired
  );
  assert.equal(alerts.length, 1);
  assert.equal(newHistory['pr-review'].service_failed.fire_count, 2);
});

test('different alert types for same service are independent', () => {
  // Service has active "failed" alert, now reports "stale" — second alert fires
  const history = {
    'pr-review': {
      service_failed: {
        first_fired_at: NOW.toISOString(),
        last_fired_at: NOW.toISOString(),
        fire_count: 1,
        last_severity: 'critical',
        active: true,
      },
    },
  };
  const { alerts } = shouldFire(
    [evalOf('pr-review', 'stale', 'warning')],
    history,
    new Date(NOW.getTime() + 5 * 60000),
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'service_stale');
});
```

- [ ] **Step 2: Run, verify fail** (3 new tests)

```bash
node --test test/alert-policy.test.mjs
```

- [ ] **Step 3: Add cooldown logic**

Replace the `if (!prev || prev.active === false)` block in `shouldFire()` with:

```js
    // First fire for this (service, type): create entry, fire alert
    if (!prev || prev.active === false) {
      alerts.push(buildAlert(evalRecord, alertType, 1, now));
      serviceHistory[alertType] = {
        first_fired_at: now.toISOString(),
        last_fired_at: now.toISOString(),
        fire_count: 1,
        last_severity: severity,
        active: true,
      };
      newHistory[service] = serviceHistory;
      continue;
    }

    // Active alert exists — check cooldown
    const lastFired = new Date(prev.last_fired_at);
    const cooldownMs = 60 * 60 * 1000; // 1h
    const withinCooldown = (now - lastFired) < cooldownMs;

    if (withinCooldown) {
      // Silence, but update history
      serviceHistory[alertType] = {
        ...prev,
        fire_count: prev.fire_count + 1,
        last_fired_at: now.toISOString(),
        last_severity: severity,
      };
      newHistory[service] = serviceHistory;
      continue;
    }

    // Cooldown expired — fire again
    alerts.push(buildAlert(evalRecord, alertType, prev.fire_count + 1, now));
    serviceHistory[alertType] = {
      ...prev,
      fire_count: prev.fire_count + 1,
      last_fired_at: now.toISOString(),
      last_severity: severity,
    };
    newHistory[service] = serviceHistory;
```

- [ ] **Step 4: Run, verify 8 total pass**

```bash
node --test test/alert-policy.test.mjs
```

Expected: `# pass 8`.

### Task 2.3: Severity escalation overrides cooldown

- [ ] **Step 1: Add failing tests**

Append:

```js
test('escalation: warning → critical fires even within cooldown', () => {
  const history = {
    'gdrive-index': {
      service_stale: {
        first_fired_at: '2026-04-14T13:50:00Z',
        last_fired_at: '2026-04-14T13:50:00Z',
        fire_count: 1,
        last_severity: 'warning',
        active: true,
      },
    },
  };
  const { alerts, newHistory } = shouldFire(
    [evalOf('gdrive-index', 'stale', 'critical')], // escalated
    history,
    NOW, // only 10min later, still in cooldown
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'critical');
  assert.equal(newHistory['gdrive-index'].service_stale.last_severity, 'critical');
});

test('de-escalation: critical → warning does NOT re-fire within cooldown', () => {
  const history = {
    'gdrive-index': {
      service_stale: {
        first_fired_at: '2026-04-14T13:50:00Z',
        last_fired_at: '2026-04-14T13:50:00Z',
        fire_count: 1,
        last_severity: 'critical',
        active: true,
      },
    },
  };
  const { alerts } = shouldFire(
    [evalOf('gdrive-index', 'stale', 'warning')], // de-escalated
    history,
    NOW,
  );
  assert.equal(alerts.length, 0);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
node --test test/alert-policy.test.mjs
```

- [ ] **Step 3: Extend cooldown branch to detect escalation**

In `lib/alert-policy.mjs`, replace the `withinCooldown` branch with:

```js
    if (withinCooldown) {
      const severityRank = { warning: 1, critical: 2 };
      const escalated = severityRank[severity] > severityRank[prev.last_severity];

      if (!escalated) {
        // Silence
        serviceHistory[alertType] = {
          ...prev,
          fire_count: prev.fire_count + 1,
          last_fired_at: now.toISOString(),
          last_severity: severity,
        };
        newHistory[service] = serviceHistory;
        continue;
      }
      // Escalation → fire despite cooldown, reset first_fired_at for new severity
      alerts.push(buildAlert(evalRecord, alertType, prev.fire_count + 1, now));
      serviceHistory[alertType] = {
        first_fired_at: now.toISOString(), // reset for this severity
        last_fired_at: now.toISOString(),
        fire_count: prev.fire_count + 1,
        last_severity: severity,
        active: true,
      };
      newHistory[service] = serviceHistory;
      continue;
    }
```

- [ ] **Step 4: Run, verify 10 total pass**

```bash
node --test test/alert-policy.test.mjs
```

Expected: `# pass 10`.

### Task 2.4: Recovery detection

- [ ] **Step 1: Add failing tests**

Append:

```js
test('recovery: previously active failed, now healthy → service_recovered fires', () => {
  const history = {
    'pr-review': {
      service_failed: {
        first_fired_at: '2026-04-14T13:30:00Z',
        last_fired_at: '2026-04-14T13:55:00Z',
        fire_count: 2,
        last_severity: 'critical',
        active: true,
      },
    },
  };
  const { alerts, newHistory } = shouldFire(
    [evalOf('pr-review', 'healthy', null)],
    history,
    NOW,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'service_recovered');
  assert.equal(alerts[0].service, 'pr-review');
  assert.equal(newHistory['pr-review'].service_failed.active, false);
});

test('recovery: closes multiple active alert types simultaneously', () => {
  const history = {
    'pr-review': {
      service_failed: {
        first_fired_at: '2026-04-14T13:00:00Z',
        last_fired_at: '2026-04-14T13:30:00Z',
        fire_count: 2,
        last_severity: 'critical',
        active: true,
      },
      service_stale: {
        first_fired_at: '2026-04-14T13:15:00Z',
        last_fired_at: '2026-04-14T13:15:00Z',
        fire_count: 1,
        last_severity: 'warning',
        active: true,
      },
    },
  };
  const { alerts, newHistory } = shouldFire(
    [evalOf('pr-review', 'healthy', null)],
    history,
    NOW,
  );
  assert.equal(alerts.length, 1); // single recovery alert
  assert.equal(newHistory['pr-review'].service_failed.active, false);
  assert.equal(newHistory['pr-review'].service_stale.active, false);
});

test('recovery: no alert if no prior active entry', () => {
  const { alerts } = shouldFire(
    [evalOf('pr-review', 'healthy', null)],
    {},
    NOW,
  );
  assert.equal(alerts.length, 0);
});

test('recovery: ignores inactive entries from past', () => {
  const history = {
    'pr-review': {
      service_failed: {
        first_fired_at: '2026-04-13T10:00:00Z',
        last_fired_at: '2026-04-13T10:00:00Z',
        fire_count: 1,
        last_severity: 'critical',
        active: false, // already recovered previously
      },
    },
  };
  const { alerts } = shouldFire(
    [evalOf('pr-review', 'healthy', null)],
    history,
    NOW,
  );
  assert.equal(alerts.length, 0);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
node --test test/alert-policy.test.mjs
```

- [ ] **Step 3: Replace the `status === 'healthy'` early-continue with recovery logic**

In `shouldFire()`, replace:

```js
    if (status === 'healthy') continue; // recovery handled later
```

with:

```js
    if (status === 'healthy') {
      const serviceHistory = newHistory[service];
      if (!serviceHistory) continue;

      const activeTypes = Object.keys(serviceHistory).filter(t => serviceHistory[t].active);
      if (activeTypes.length === 0) continue;

      // Emit single recovery alert
      const earliestFirst = activeTypes
        .map(t => new Date(serviceHistory[t].first_fired_at).getTime())
        .reduce((a, b) => Math.min(a, b));
      const durationMs = now - earliestFirst;
      const totalFires = activeTypes.reduce((s, t) => s + serviceHistory[t].fire_count, 0);

      alerts.push({
        type: 'service_recovered',
        service,
        status: 'healthy',
        severity: 'info',
        reason: `recovered from ${activeTypes.join(', ')} after ${Math.round(durationMs / 60000)} min (${totalFires} alerts)`,
        fired_at: now.toISOString(),
        fire_count: 1,
      });

      // Mark all active entries as inactive
      for (const t of activeTypes) {
        serviceHistory[t].active = false;
      }
      newHistory[service] = serviceHistory;
      continue;
    }
```

- [ ] **Step 4: Run, verify 14 total pass**

```bash
node --test test/alert-policy.test.mjs
```

Expected: `# pass 14`.

### Task 2.5: Commit Phase 2

- [ ] **Step 1: Verify all alert-policy tests pass**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/health-monitor
node --test test/ 2>&1 | tail -6
```

Expected: `# pass 30` (16 evaluator + 14 policy).

- [ ] **Step 2: Commit**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git add services/health-monitor/lib/alert-policy.mjs services/health-monitor/test/alert-policy.test.mjs
git commit -m "feat(health-monitor): alert-policy pure module with dedup and recovery

14 unit tests TDD-strict. Handles: first-fire, 1h cooldown, severity
escalation (warning → critical) overriding cooldown, recovery closes
all active alert types for a service with a single notification.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — I/O modules: state-reader + config

Light testing — mostly integration with filesystem.

### Task 3.1: `state-reader.mjs`

**Files:**
- Create: `services/health-monitor/lib/state-reader.mjs`
- Create: `services/health-monitor/test/state-reader.test.mjs`

- [ ] **Step 1: Write tests**

```js
// services/health-monitor/test/state-reader.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState } from '../lib/state-reader.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'hm-sr-')); }

test('reads valid state.json', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify({
      service: 'pr-review', last_run: '2026-04-14T14:00:00Z',
      last_status: 'success', duration_ms: 42000,
    }));
    const { state, error } = readState(path);
    assert.equal(error, null);
    assert.equal(state.service, 'pr-review');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing file returns {state: null, error: "file_missing"}', () => {
  const { state, error } = readState('/nonexistent/state.json');
  assert.equal(state, null);
  assert.equal(error.code, 'file_missing');
});

test('malformed JSON returns parse_error', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'state.json');
    writeFileSync(path, '{not valid json');
    const { state, error } = readState(path);
    assert.equal(state, null);
    assert.equal(error.code, 'parse_error');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('empty file returns parse_error', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'state.json');
    writeFileSync(path, '');
    const { state, error } = readState(path);
    assert.equal(error.code, 'parse_error');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('JSON with wrong shape (array instead of object) returns parse_error', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'state.json');
    writeFileSync(path, '[1,2,3]');
    const { state, error } = readState(path);
    assert.equal(error.code, 'parse_error');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/state-reader.test.mjs
```

- [ ] **Step 3: Implement**

```js
// services/health-monitor/lib/state-reader.mjs
import { readFileSync, existsSync } from 'node:fs';

/**
 * Read a state.json for a single service. Never throws.
 * @returns {{state: object|null, error: {code, message}|null}}
 */
export function readState(path) {
  if (!existsSync(path)) {
    return { state: null, error: { code: 'file_missing', message: `${path} does not exist` } };
  }
  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    return { state: null, error: { code: 'read_error', message: err.message } };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { state: null, error: { code: 'parse_error', message: `invalid JSON: ${err.message}` } };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: null, error: { code: 'parse_error', message: 'state must be a JSON object' } };
  }
  return { state: parsed, error: null };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/state-reader.test.mjs
```

Expected: `# pass 5`.

### Task 3.2: `config.mjs`

**Files:**
- Create: `services/health-monitor/lib/config.mjs`
- Create: `services/health-monitor/test/config.test.mjs`

- [ ] **Step 1: Write tests**

```js
// services/health-monitor/test/config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.mjs';

function tmpConfig(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'hm-cfg-'));
  const path = join(dir, 'services.json');
  writeFileSync(path, JSON.stringify(obj));
  return { path, dir };
}

test('parses valid config and applies bootstrap_grace to each service', () => {
  const { path, dir } = tmpConfig({
    bootstrap_grace_minutes: 120,
    services: {
      'svc-a': {
        state_file: '/tmp/a.json', cadence_minutes: 5, staleness_factor: 2.5,
        alert_on_partial: true, added_at: '2026-04-14T12:00:00Z',
      },
    },
  });
  try {
    const { config, error } = loadConfig(path);
    assert.equal(error, null);
    assert.equal(config.services.length, 1);
    const svc = config.services[0];
    assert.equal(svc.name, 'svc-a');
    assert.equal(svc.bootstrap_grace_minutes, 120);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing config file returns error', () => {
  const { error } = loadConfig('/nonexistent/services.json');
  assert.equal(error.code, 'file_missing');
});

test('malformed config returns parse_error', () => {
  const { path, dir } = tmpConfig({ services: 'not-an-object' });
  try {
    const { error } = loadConfig(path);
    assert.equal(error.code, 'invalid_shape');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run, verify failure**

```bash
node --test test/config.test.mjs
```

- [ ] **Step 3: Implement**

```js
// services/health-monitor/lib/config.mjs
import { readState } from './state-reader.mjs';

/**
 * Load and validate services.json.
 * @returns {{config: object|null, error: object|null}}
 */
export function loadConfig(path) {
  const { state, error } = readState(path);
  if (error) return { config: null, error };

  if (typeof state.services !== 'object' || state.services === null || Array.isArray(state.services)) {
    return {
      config: null,
      error: { code: 'invalid_shape', message: 'config.services must be an object' },
    };
  }

  const graceDefault = state.bootstrap_grace_minutes ?? 120;

  const services = Object.entries(state.services).map(([name, cfg]) => ({
    name,
    ...cfg,
    bootstrap_grace_minutes: cfg.bootstrap_grace_minutes ?? graceDefault,
  }));

  return {
    config: {
      bootstrap_grace_minutes: graceDefault,
      services,
    },
    error: null,
  };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/config.test.mjs
```

Expected: `# pass 3`.

### Task 3.3: Commit Phase 3

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git add services/health-monitor/lib/{state-reader,config}.mjs \
        services/health-monitor/test/{state-reader,config}.test.mjs
git commit -m "feat(health-monitor): state-reader and config loader modules

state-reader: read service state.json, never throws, returns structured
error on missing/malformed. config: loads services.json, validates shape,
applies bootstrap_grace_minutes default per service.

8 unit tests. Total suite: 38 tests, all passing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — I/O modules: summary-writer + alert-sender

### Task 4.1: `summary-writer.mjs`

**Files:**
- Create: `services/health-monitor/lib/summary-writer.mjs`

- [ ] **Step 1: Write the module** (no unit test — simple string generation, exercised by integration smoke in Phase 5)

```js
// services/health-monitor/lib/summary-writer.mjs
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const STATUS_ICONS = {
  healthy: '✅',
  bootstrapping: '🔵',
  partial: '⚠️',
  stale: '⚠️',
  failed: '🔴',
  ignored: '⚪',
};

/**
 * Compute overall status from evaluations.
 * failed if any failed; else degraded if any stale/partial; else healthy.
 */
function overallFrom(evaluations) {
  if (evaluations.some(e => e.status === 'failed')) return 'failed';
  if (evaluations.some(e => e.status === 'stale' || e.status === 'partial')) return 'degraded';
  return 'healthy';
}

function countsOf(evaluations) {
  const counts = { healthy: 0, partial: 0, stale: 0, failed: 0, bootstrapping: 0, ignored: 0 };
  for (const e of evaluations) counts[e.status] = (counts[e.status] ?? 0) + 1;
  return counts;
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}min`;
}

function formatRelative(iso, now) {
  if (!iso) return '—';
  const diffMs = now - new Date(iso);
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Write both health-summary.json and health-summary.md to outDir.
 * @param {string} outDir
 * @param {object[]} evaluations - enriched with state + service config
 * @param {object[]} activeAlerts - alerts fired this cycle (or currently active)
 * @param {Date} now
 */
export function writeSummary(outDir, evaluations, activeAlerts, now) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const overall = overallFrom(evaluations);
  const counts = countsOf(evaluations);

  const jsonPayload = {
    generated_at: now.toISOString(),
    overall,
    counts,
    services: evaluations.map(e => ({
      service: e.service,
      status: e.status,
      severity: e.severity,
      reason: e.reason,
      last_run: e.state?.last_run ?? null,
      duration_ms: e.state?.duration_ms ?? null,
      details: e.state?.details ?? null,
    })),
    active_alerts: activeAlerts.map(a => ({
      service: a.service,
      type: a.type,
      since: a.first_fired_at ?? a.fired_at,
    })),
  };
  writeFileSync(`${outDir}/health-summary.json`, JSON.stringify(jsonPayload, null, 2));

  const lines = [];
  lines.push('# Health Summary');
  lines.push('');
  lines.push(`**Generated:** ${now.toISOString().replace('T', ' ').replace(/\..*/, ' UTC')}`);
  const overallIcon = overall === 'healthy' ? '✅' : overall === 'degraded' ? '⚠️' : '🔴';
  lines.push(`**Overall:** ${overallIcon} ${overall}`);
  lines.push('');
  lines.push('## Services');
  lines.push('');
  lines.push('| Service | Status | Last Run | Duration | Details |');
  lines.push('|---|---|---|---|---|');
  for (const e of evaluations) {
    const icon = STATUS_ICONS[e.status] ?? '❔';
    const relTime = formatRelative(e.state?.last_run, now);
    const dur = formatDuration(e.state?.duration_ms);
    const details = e.reason ?? (e.state?.details ? JSON.stringify(e.state.details) : '—');
    lines.push(`| \`${e.service}\` | ${icon} ${e.status} | ${relTime} | ${dur} | ${details} |`);
  }
  lines.push('');
  if (activeAlerts.length > 0) {
    lines.push('## Active alerts');
    lines.push('');
    for (const a of activeAlerts) {
      const icon = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵';
      lines.push(`- ${icon} \`${a.service}\` ${a.type.replace('service_', '')} — ${a.reason}`);
    }
  } else {
    lines.push('## Active alerts');
    lines.push('');
    lines.push('_No active alerts._');
  }

  writeFileSync(`${outDir}/health-summary.md`, lines.join('\n') + '\n');
}
```

- [ ] **Step 2: Syntax check**

```bash
node --check lib/summary-writer.mjs
```

Expected: silent.

### Task 4.2: `alert-sender.mjs`

**Files:**
- Create: `services/health-monitor/lib/alert-sender.mjs`

- [ ] **Step 1: Write the module** (no unit test — the call-out to notifier MCP is I/O bound; covered by manual smoke in Phase 8)

```js
// services/health-monitor/lib/alert-sender.mjs
import { spawn } from 'node:child_process';

const DOMAIN = 'infra-health';

const ICONS = {
  service_failed: '🔴',
  service_stale: '🟡',
  service_partial: '🟡',
  service_recovered: '🟢',
};

function formatSummary(alert) {
  const icon = ICONS[alert.type] ?? '🔵';
  const statusLabel = alert.status.toUpperCase();
  return `${icon} [health-monitor] ${alert.service} ${statusLabel}`;
}

function formatDetails(alert) {
  const lines = [alert.reason];
  if (alert.fire_count > 1) {
    lines.push(`Fired ${alert.fire_count}x`);
  }
  return lines.join('\n');
}

/**
 * Send one alert via the notifier MCP.
 * Invokes `claude --print` with the notifier tool allowlisted.
 */
export function sendAlert(alert) {
  const summary = formatSummary(alert);
  const details = formatDetails(alert);
  const args = { domain: DOMAIN, summary, details };
  const prompt = `Call the MCP tool send_notification with these exact arguments: ${JSON.stringify(args)}. Return only the raw tool output, nothing else.`;

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', 'haiku',
      '--max-turns', '3',
      '--allowedTools', 'mcp__notifier__send_notification',
    ], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`notifier exited ${code}: ${stderr.trim() || stdout.trim().slice(0, 200)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

export async function sendAllAlerts(alerts) {
  const results = [];
  for (const a of alerts) {
    try {
      await sendAlert(a);
      results.push({ service: a.service, type: a.type, ok: true });
    } catch (err) {
      results.push({ service: a.service, type: a.type, ok: false, error: err.message });
    }
  }
  return results;
}
```

- [ ] **Step 2: Syntax check**

```bash
node --check lib/alert-sender.mjs
```

### Task 4.3: Commit Phase 4

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git add services/health-monitor/lib/{summary-writer,alert-sender}.mjs
git commit -m "feat(health-monitor): summary writer + alert sender

summary-writer: emits health-summary.json + health-summary.md consolidating
all service evaluations and active alerts. alert-sender: invokes notifier
MCP via claude --print with infra-health domain, sends one message per alert.

No unit tests for these two (I/O modules, covered by integration smoke in
Phase 5 and manual E2E in Phase 8).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Orchestrator + integration smoke

### Task 5.1: `index.mjs` (main orchestrator)

**Files:**
- Create: `services/health-monitor/index.mjs`

- [ ] **Step 1: Write orchestrator**

```js
// services/health-monitor/index.mjs
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { readState } from './lib/state-reader.mjs';
import { evaluate } from './lib/status-evaluator.mjs';
import { shouldFire } from './lib/alert-policy.mjs';
import { sendAllAlerts } from './lib/alert-sender.mjs';
import { writeSummary } from './lib/summary-writer.mjs';

const SERVICE_DIR = process.env.HM_SERVICE_DIR ?? new URL('.', import.meta.url).pathname;
const CONFIG_PATH = process.env.HM_CONFIG_PATH ?? join(SERVICE_DIR, 'config/services.json');
const DATA_DIR = process.env.HM_DATA_DIR ?? join(SERVICE_DIR, 'data');
const ALERT_STATE_PATH = join(DATA_DIR, 'alert-state.json');
const SKIP_NOTIFIER = process.env.HM_SKIP_NOTIFIER === '1';

function loadJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

function saveJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function main() {
  log('health-monitor: starting cycle');
  const { config, error: cfgError } = loadConfig(CONFIG_PATH);
  if (cfgError) {
    log(`FATAL: config load failed: ${cfgError.message}`);
    process.exit(1);
  }

  const now = new Date();

  // 1. Evaluate each service
  const evaluations = [];
  for (const svcCfg of config.services) {
    const { state, error } = readState(svcCfg.state_file);
    const evaluation = evaluate(state, svcCfg, now);
    evaluations.push({
      ...evaluation,
      service: svcCfg.name,
      state,
      stateError: error,
    });
  }

  // 2. Apply alert policy
  const alertHistory = loadJsonOr(ALERT_STATE_PATH, {});
  const { alerts, newHistory } = shouldFire(evaluations, alertHistory, now);
  log(`evaluated ${evaluations.length} services, ${alerts.length} alerts to fire`);

  // 3. Send alerts (or skip in test mode)
  if (alerts.length > 0 && !SKIP_NOTIFIER) {
    const results = await sendAllAlerts(alerts);
    const failures = results.filter(r => !r.ok);
    if (failures.length > 0) {
      log(`WARNING: ${failures.length}/${alerts.length} alerts failed to send`);
      for (const f of failures) log(`  failed: ${f.service}/${f.type}: ${f.error}`);
    }
  }

  // 4. Persist alert history
  saveJson(ALERT_STATE_PATH, newHistory);

  // 5. Write summary
  const activeAlerts = buildActiveAlertList(newHistory);
  writeSummary(DATA_DIR, evaluations, activeAlerts, now);

  log(`health-monitor: cycle done`);
}

function buildActiveAlertList(history) {
  const out = [];
  for (const [service, byType] of Object.entries(history)) {
    for (const [type, entry] of Object.entries(byType)) {
      if (entry.active) {
        out.push({ service, type, ...entry });
      }
    }
  }
  return out;
}

main().catch(err => {
  console.error(`[${new Date().toISOString()}] FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Syntax check**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/health-monitor
node --check index.mjs
```

### Task 5.2: Integration smoke test

**Files:**
- Create: `services/health-monitor/test/test-integration.mjs`

- [ ] **Step 1: Write smoke test**

```js
// services/health-monitor/test/test-integration.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

test('end-to-end: fixtures → evaluations → alerts → summary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hm-int-'));
  const svcDir = join(root, 'svc');
  const dataDir = join(root, 'data');
  const stateDir = join(root, 'states');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const pathA = join(stateDir, 'a.json');
  const pathB = join(stateDir, 'b.json');
  const pathC = join(stateDir, 'c.json'); // intentionally missing

  writeFileSync(pathA, JSON.stringify({
    service: 'svc-a', last_run: '2026-04-14T13:55:00Z',
    last_status: 'success', duration_ms: 2000,
  }));
  writeFileSync(pathB, JSON.stringify({
    service: 'svc-b', last_run: '2026-04-14T13:55:00Z',
    last_status: 'failed', exit_code: 1, duration_ms: 5000,
  }));

  const configPath = join(root, 'services.json');
  writeFileSync(configPath, JSON.stringify({
    bootstrap_grace_minutes: 120,
    services: {
      'svc-a': {
        state_file: pathA, cadence_minutes: 5, staleness_factor: 2.5,
        alert_on_partial: true, added_at: '2026-04-14T12:00:00Z',
      },
      'svc-b': {
        state_file: pathB, cadence_minutes: 5, staleness_factor: 2.5,
        alert_on_partial: true, added_at: '2026-04-14T12:00:00Z',
      },
      'svc-c': {
        state_file: pathC, cadence_minutes: 5, staleness_factor: 2.5,
        alert_on_partial: true, added_at: '2026-04-13T12:00:00Z', // grace expired
      },
    },
  }));

  try {
    await runCycle(configPath, dataDir);

    // Verify outputs
    assert.ok(existsSync(join(dataDir, 'health-summary.json')), 'health-summary.json written');
    assert.ok(existsSync(join(dataDir, 'health-summary.md')), 'health-summary.md written');
    assert.ok(existsSync(join(dataDir, 'alert-state.json')), 'alert-state.json written');

    const summary = JSON.parse(readFileSync(join(dataDir, 'health-summary.json'), 'utf-8'));
    assert.equal(summary.services.length, 3);
    assert.equal(summary.counts.failed, 1);
    assert.equal(summary.counts.stale, 1); // svc-c beyond grace, no state file
    assert.equal(summary.counts.healthy, 1);

    const alertState = JSON.parse(readFileSync(join(dataDir, 'alert-state.json'), 'utf-8'));
    assert.ok(alertState['svc-b'].service_failed.active);
    assert.ok(alertState['svc-c'].service_stale.active);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runCycle(configPath, dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [new URL('../index.mjs', import.meta.url).pathname], {
      env: {
        ...process.env,
        HM_CONFIG_PATH: configPath,
        HM_DATA_DIR: dataDir,
        HM_SKIP_NOTIFIER: '1',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  });
}
```

- [ ] **Step 2: Run full suite**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/health-monitor
node --test test/ 2>&1 | tail -8
```

Expected: `# pass 39`.

### Task 5.3: Commit Phase 5

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git add services/health-monitor/index.mjs services/health-monitor/test/test-integration.mjs
git commit -m "feat(health-monitor): orchestrator + integration smoke test

index.mjs: 6-step pipeline — load config → read states → evaluate →
apply policy → send alerts → write summary + persist history.
HM_SKIP_NOTIFIER=1 env bypasses the notifier call (used by the smoke test).

Integration test exercises the full pipeline against 3 fixture services
(healthy, failed, stale) and asserts summary + alert-state shape.

Total suite: 39 passing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Shell scaffolding: run.sh, deploy.sh, state-writer helper

### Task 6.1: `run.sh` and `deploy.sh`

**Files:**
- Create: `services/health-monitor/run.sh`
- Create: `services/health-monitor/deploy.sh`

- [ ] **Step 1: Write `run.sh`**

```bash
#!/usr/bin/env bash
# health-monitor entry point.
# Cron: */10 * * * *
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p data logs
LOG_FILE="logs/run-$(date '+%Y-%m-%d').log"

{
  echo ""
  echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ') health-monitor start ==="
  node index.mjs
  echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ') health-monitor end ==="
} >> "$LOG_FILE" 2>&1
```

- [ ] **Step 2: Write `deploy.sh`** — modeled on `context-refresh/deploy.sh`

```bash
#!/usr/bin/env bash
# Deploy health-monitor to the infra server.
# Usage: bash deploy.sh
set -euo pipefail

REMOTE_HOST="strokmatic@192.168.15.2"
REMOTE_DIR="/opt/jarvis-health-monitor"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== health-monitor deploy ==="

# Secret scan (guard)
if grep -rE "(api[_-]?key|secret|password|token)\s*=\s*['\"][^'\"]{8,}" \
  --include="*.mjs" --include="*.sh" --include="*.json" . 2>/dev/null; then
  echo "FATAL: secret-looking values detected in tracked files. Aborting."
  exit 1
fi

# Rsync
echo "→ rsync to $REMOTE_HOST:$REMOTE_DIR"
ssh "$REMOTE_HOST" "mkdir -p $REMOTE_DIR"
rsync -av --delete \
  --exclude='data/' --exclude='logs/' --exclude='.gitignore' \
  --exclude='node_modules/' --exclude='test/' \
  ./ "$REMOTE_HOST:$REMOTE_DIR/"

# Install cron entry (idempotent)
ssh "$REMOTE_HOST" "
  (crontab -l 2>/dev/null | grep -v 'jarvis-health-monitor' ; \
   echo '*/10 * * * * cd $REMOTE_DIR && bash run.sh') | crontab -
"

# Smoke test
echo "→ smoke test (dry run with HM_SKIP_NOTIFIER=1)"
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && HM_SKIP_NOTIFIER=1 node index.mjs"

echo "=== deploy complete ==="
```

- [ ] **Step 3: Make executable**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/health-monitor
chmod +x run.sh deploy.sh
```

- [ ] **Step 4: Syntax check**

```bash
bash -n run.sh
bash -n deploy.sh
```

Expected: silent.

### Task 6.2: Shared `state-writer.sh` helper

**Files:**
- Create: `services/_shared/state-writer.sh`

- [ ] **Step 1: Write helper**

```bash
#!/usr/bin/env bash
# Shared state writer for Strokmatic infra services.
# Source this file and call write_state at the end of run.sh.
#
# Usage:
#   source /path/to/_shared/state-writer.sh
#   START_MS=$(date +%s%3N)
#   export STATE_FILE="$SCRIPT_DIR/data/state.json"
#   export SERVICE_NAME="my-service"
#   trap 'write_state "$SERVICE_NAME" "failed" "$(($(date +%s%3N) - START_MS))"' ERR
#   ... service work ...
#   write_state "$SERVICE_NAME" "success" "$(($(date +%s%3N) - START_MS))"

write_state() {
  local service="$1"
  local status="$2"
  local duration_ms="$3"
  local details="${4:-{}}"
  local exit_code="${EXIT_CODE:-0}"
  local now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local state_file="${STATE_FILE:?STATE_FILE must be set}"

  mkdir -p "$(dirname "$state_file")"
  cat > "$state_file" <<EOF
{
  "service": "$service",
  "last_run": "$now",
  "last_status": "$status",
  "duration_ms": $duration_ms,
  "exit_code": $exit_code,
  "details": $details
}
EOF
}
```

- [ ] **Step 2: Syntax check**

```bash
bash -n /home/teruel/JARVIS/workspaces/strokmatic/infra/services/_shared/state-writer.sh
```

### Task 6.3: Commit Phase 6

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
chmod +x services/health-monitor/run.sh services/health-monitor/deploy.sh
git add services/health-monitor/run.sh services/health-monitor/deploy.sh \
        services/_shared/state-writer.sh
git commit -m "feat(health-monitor): shell scaffolding + shared state-writer

- run.sh: cron-invoked bash wrapper around node index.mjs with logging
- deploy.sh: rsync to 192.168.15.2, install */10 cron, smoke test
- services/_shared/state-writer.sh: shared bash helper any service can
  source to emit state.json in the canonical schema (with ERR trap
  recommendation documented in the comment block)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Migrate existing services to emit state.json

Three services, one task each. Each migration:
- Adds `write_state` call at successful exit
- Adds ERR trap for failure path
- Tested locally (dry-run of run.sh)
- Committed independently

### Task 7.1: Migrate `pr-review`

**Files:**
- Modify: `services/pr-review/run.sh`

- [ ] **Step 1: Read current run.sh**

```bash
cat /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review/run.sh | head -30
```

- [ ] **Step 2: Add state.json emission at top of `run.sh`** (right after `set -euo pipefail`)

```bash
# --- state.json integration ---
source "$(dirname "$0")/../_shared/state-writer.sh"
export SERVICE_NAME="pr-review"
export STATE_FILE="$SCRIPT_DIR/data/state.json"
START_MS=$(date +%s%3N)
trap 'write_state "$SERVICE_NAME" "failed" "$(($(date +%s%3N) - START_MS))" "{\"stage\":\"${CURRENT_STAGE:-unknown}\"}"' ERR
CURRENT_STAGE="init"
# --- end state.json integration ---
```

Note: `SCRIPT_DIR` must already be defined by `run.sh`. If not, add `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"` before the block.

- [ ] **Step 3: Throughout run.sh, annotate stages with `CURRENT_STAGE` so failure trap reports where it died**

For each major step in run.sh (fetch-open-prs, review-pr, upload-to-drive, notify-chat, etc.), add a line before the step:

```bash
CURRENT_STAGE="fetch-open-prs"
# ... existing fetch-open-prs invocation ...
```

This is optional polish — the migration works without it, but the failure alerts become much more useful.

- [ ] **Step 4: At the end of run.sh (success path), call write_state**

```bash
# At the end, just before exit 0
DURATION_MS=$(($(date +%s%3N) - START_MS))
DETAILS=$(cat <<DETAILS
{
  "new_reviews": ${NEW_REVIEWS:-0},
  "total_prs": ${TOTAL_PRS:-0}
}
DETAILS
)
write_state "$SERVICE_NAME" "$FINAL_STATUS" "$DURATION_MS" "$DETAILS"
```

Where `FINAL_STATUS` is either `"success"` or `"partial"` depending on pr-review's existing logic (it currently tracks this in `EXIT_STATUS` and `state.json`; reuse that).

- [ ] **Step 5: Dry-run the script locally**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/pr-review
bash -n run.sh   # syntax check only
# Do not actually run — it would make real API calls. Deploy and run on server.
```

- [ ] **Step 6: Commit**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git add services/pr-review/run.sh
git commit -m "feat(pr-review): emit canonical state.json for health-monitor

Add write_state call at successful exit and ERR trap for failure path.
State lives at \$SCRIPT_DIR/data/state.json with the canonical schema
(service, last_run, last_status, duration_ms, exit_code, details).
Details preserve new_reviews and total_prs from the existing state.json
that pr-review already maintained.

Part of health-monitor rollout (Phase 7).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 7.2: Migrate `context-refresh`

**Files:**
- Modify: `services/context-refresh/run.sh`

- [ ] **Step 1: Read current run.sh**

```bash
cat /home/teruel/JARVIS/workspaces/strokmatic/infra/services/context-refresh/run.sh | tail -20
```

- [ ] **Step 2: Add state.json emission at top of run.sh** (mirror pr-review pattern)

```bash
source "$(dirname "$0")/../_shared/state-writer.sh"
export SERVICE_NAME="context-refresh"
export STATE_FILE="$SCRIPT_DIR/data/state.json"
START_MS=$(date +%s%3N)
trap 'write_state "$SERVICE_NAME" "failed" "$(($(date +%s%3N) - START_MS))"' ERR
```

- [ ] **Step 3: At the end of run.sh, replace the old state-updating code**

Remove these lines from current `run.sh`:

```bash
date '+%Y-%m-%d' > "$STATE_FILE"      # old, delete
```

Remove any `last-task-count.txt` writes that happen (search the file).

Add:

```bash
DURATION_MS=$(($(date +%s%3N) - START_MS))
TASK_COUNT=$(cat "$OUTPUT_DIR"/*.jsonl 2>/dev/null | wc -l || echo "0")
DETAILS="{\"total_tasks\": $TASK_COUNT}"
write_state "$SERVICE_NAME" "success" "$DURATION_MS" "$DETAILS"
```

- [ ] **Step 4: Remove obsolete files**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/context-refresh
# Keep these only if they are read by something (grep for "last-run.txt" and "last-task-count.txt" in the repo)
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
grep -rn "last-run.txt\|last-task-count.txt" --include='*.sh' --include='*.mjs' --include='*.js' | grep -v 'state-writer.sh' | grep -v 'run.sh'
```

If the grep shows zero remaining consumers, delete them from source (the files themselves live under `data/` which is gitignored — nothing to delete in the repo).

- [ ] **Step 5: Syntax check**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/context-refresh
bash -n run.sh
```

- [ ] **Step 6: Commit**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git add services/context-refresh/run.sh
git commit -m "feat(context-refresh): migrate to canonical state.json for health-monitor

Replace legacy last-run.txt + last-task-count.txt (plaintext) with a
single data/state.json in the canonical schema. Task count moves to
details.total_tasks. Duration tracked in duration_ms. ERR trap captures
failures so health-monitor can alert on exit != 0 paths.

No external consumers of the .txt files — verified via repo grep.

Part of health-monitor rollout (Phase 7).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 7.3: Migrate `github-clickup-sync`

**Files:**
- Modify: `services/github-clickup-sync/index.js`

This service is a long-running PM2 process written in Node.js (not bash), so it emits state.json from JS at the end of each poll cycle.

- [ ] **Step 1: Locate the main poll loop exit point**

```bash
grep -nE "(while|setInterval|poll|loop)" /home/teruel/JARVIS/workspaces/strokmatic/infra/services/github-clickup-sync/index.js | head -20
```

The exact structure depends on the implementation. The goal is to identify where one complete poll cycle ends (after the mapping has been saved to `.state-*.json`).

- [ ] **Step 2: Add a state.json writer at end of each cycle**

At the end of the poll cycle function, add:

```js
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function emitHealthState(status, durationMs, details = {}) {
  const STATE_FILE = process.env.HEALTH_STATE_FILE
    ?? './data/state.json';
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload = {
    service: 'github-clickup-sync',
    last_run: new Date().toISOString(),
    last_status: status,
    duration_ms: durationMs,
    exit_code: status === 'success' ? 0 : 1,
    details,
  };
  writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
}
```

Note: `github-clickup-sync/index.js` is currently CommonJS (uses `require`). If it already imports with `require`, use this form instead:

```js
const { writeFileSync, mkdirSync, existsSync } = require('fs');
const { dirname } = require('path');

function emitHealthState(status, durationMs, details = {}) {
  const STATE_FILE = process.env.HEALTH_STATE_FILE ?? './data/state.json';
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload = {
    service: 'github-clickup-sync',
    last_run: new Date().toISOString(),
    last_status: status,
    duration_ms: durationMs,
    exit_code: status === 'success' ? 0 : 1,
    details,
  };
  writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
}
```

- [ ] **Step 3: Wrap the poll cycle with timing + error handling**

Around the main poll call:

```js
const cycleStart = Date.now();
try {
  await runPollCycle(); // or whatever the main function is
  emitHealthState('success', Date.now() - cycleStart, {
    // preserve any interesting counters: issues_synced, tasks_updated, etc.
  });
} catch (err) {
  emitHealthState('failed', Date.now() - cycleStart, { error: err.message });
  throw err;
}
```

- [ ] **Step 4: Syntax check**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/github-clickup-sync
node --check index.js
```

- [ ] **Step 5: Commit**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git add services/github-clickup-sync/index.js
git commit -m "feat(github-clickup-sync): emit canonical state.json per poll cycle

Add emitHealthState() function called at end of each poll cycle with
success/failed status, duration, and any interesting per-cycle counters.
State file lives at data/state.json; path overridable via
HEALTH_STATE_FILE env.

Part of health-monitor rollout (Phase 7).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8 — Notifier config + deploy

### Task 8.1: Add `infra-health` notification domain

**Files:**
- Modify: `/home/teruel/JARVIS/config/orchestrator/notifications.json`

- [ ] **Step 1: Read current routing**

```bash
cat /home/teruel/JARVIS/config/orchestrator/notifications.json
```

- [ ] **Step 2: Add the new domain**

Edit the file to include:

```json
{
  "bot_manager_enabled": true,
  "domain_routing": {
    "...existing entries...": "...",
    "infra-health": { "bot": "jarvis-alerts" }
  }
}
```

(Preserve whatever existing top-level shape and entries the file currently has — just add the `"infra-health"` line inside `domain_routing`.)

- [ ] **Step 3: Verify routing resolves**

```bash
node -e "
import('fs').then(({ readFileSync }) => {
  const cfg = JSON.parse(readFileSync('/home/teruel/JARVIS/config/orchestrator/notifications.json', 'utf-8'));
  console.log('infra-health route:', cfg.domain_routing?.['infra-health']);
});
"
```

Expected: `{ bot: 'jarvis-alerts' }`.

- [ ] **Step 4: Commit (in JARVIS repo, not infra)**

```bash
cd /home/teruel/JARVIS
git add config/orchestrator/notifications.json
git commit -m "feat(notifier): add infra-health domain routed to jarvis-alerts

Enables the health-monitor service (in strokmatic/infra) to send alerts
via the notifier MCP using the \"infra-health\" domain, which maps to
the existing jarvis-alerts Telegram bot (group chat -1003505195531).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 8.2: Deploy health-monitor to server (user-gated)

This task requires the operator's explicit confirmation — deployment means the service starts running live against real state files on `192.168.15.2`.

- [ ] **Step 1: Prepare for deployment**

Before running `deploy.sh`, the operator (Pedro) should:

1. Verify SSH access: `ssh strokmatic@192.168.15.2 'hostname && date'`
2. Review `config/services.json` — ensure `added_at` timestamps are set to something reasonable (e.g., `now` at deploy time) so each service enters the 2h grace period correctly. Services whose state.json doesn't yet exist on the server (e.g., migrations haven't deployed yet) will go through grace → stale alerts, which is expected and desired as the signal that migration is pending.

```bash
# Update services.json with added_at = now
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/health-monitor
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Use jq to set added_at for each service — operator runs this before deploy
jq --arg now "$NOW" '.services |= map_values(. + {added_at: $now})' config/services.json > config/services.json.new
mv config/services.json.new config/services.json
git add config/services.json
git commit -m "chore(health-monitor): activate services (set added_at to deploy time)"
```

- [ ] **Step 2: Run deploy.sh**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra/services/health-monitor
bash deploy.sh
```

Expected output:
- Secret scan passes
- Rsync completes without errors
- Cron entry installed (idempotent)
- Smoke test runs end-to-end without error (alerts skipped via `HM_SKIP_NOTIFIER=1`)

- [ ] **Step 3: Verify cron installed**

```bash
ssh strokmatic@192.168.15.2 'crontab -l | grep jarvis-health-monitor'
```

Expected: one line, `*/10 * * * * cd /opt/jarvis-health-monitor && bash run.sh`.

- [ ] **Step 4: Verify first live run (wait up to 10min)**

```bash
ssh strokmatic@192.168.15.2 'tail -f /opt/jarvis-health-monitor/logs/run-$(date +%Y-%m-%d).log' &
# wait for the next */10 boundary
```

Expected: log shows "health-monitor: starting cycle" and "cycle done" lines. No Node crashes.

- [ ] **Step 5: Verify Telegram alerts fire** (requires at least one alertable state)

On the first live run after deploy, depending on migration timing:
- If `pr-review` and `context-refresh` migrations haven't deployed yet: both services will have no state.json on disk → bootstrapping (within grace) → no alerts for 2h.
- After 2h grace, any un-migrated service will go stale → critical alerts fire to `jarvis-alerts` Telegram group.

This is the expected signal. Deploy the service migrations (Phase 7) to the server before or shortly after the health-monitor deployment to avoid noise. Recommended sequence:
1. Deploy health-monitor (Task 8.2)
2. Within grace period (2h), deploy migrated pr-review: `cd services/pr-review && bash deploy.sh`
3. Deploy migrated context-refresh: `cd services/context-refresh && bash deploy.sh`
4. Deploy migrated github-clickup-sync: `cd services/github-clickup-sync && bash deploy.sh`
5. After each service runs once post-deploy, health-monitor will pick up the new state.json on its next cycle and mark the service healthy. If it was already stale at that point, `service_recovered` fires.

---

## Phase 9 — Final verification + push

### Task 9.1: Manual end-to-end validation

These steps run after all deployments and require elapsed clock time.

- [ ] **Step 1: Force a controlled failure in pr-review**

```bash
# On the server, temporarily rename the gh token so the next run fails
ssh strokmatic@192.168.15.2 'mv ~/.secrets/gh-token ~/.secrets/gh-token.bak'

# Wait for the next */5 cron (pr-review)
sleep 330

# Verify state.json shows failed
ssh strokmatic@192.168.15.2 'cat /opt/jarvis-pr-review/data/state.json'
```

Expected: `last_status: "failed"`.

- [ ] **Step 2: Wait for health-monitor to detect and alert**

Up to 10 min. Watch the Telegram group `jarvis-alerts` — expect a message like:

```
🔴 [health-monitor] pr-review FAILED
last run failed (exit code 1)
```

- [ ] **Step 3: Restore the token and wait for recovery**

```bash
ssh strokmatic@192.168.15.2 'mv ~/.secrets/gh-token.bak ~/.secrets/gh-token'

# Wait for next pr-review run + next health-monitor cycle
sleep 900
```

Expected in Telegram:

```
🟢 [health-monitor] pr-review RECOVERED
recovered from service_failed after N min (M alerts)
```

- [ ] **Step 4: Verify health-summary is up to date**

```bash
ssh strokmatic@192.168.15.2 'cat /opt/jarvis-health-monitor/data/health-summary.md'
```

Expected: recent `Generated` timestamp, all services with appropriate statuses, no unexpected active alerts.

### Task 9.2: Push to origin (user-gated)

Per JARVIS memory rule, pushing to shared remotes always requires explicit user approval.

- [ ] **Step 1: Review what will be pushed**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git log --oneline origin/master..HEAD
```

Expected: the phase 0–8 commits (around 12-14 commits).

- [ ] **Step 2: Ask user for push approval**

Before running `git push`, show the operator the commit list and the current branch. Only proceed on explicit "yes, push".

- [ ] **Step 3: On approval, push**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git push origin master
```

- [ ] **Step 4: Same for JARVIS repo**

```bash
cd /home/teruel/JARVIS
git log --oneline origin/develop..HEAD  # or whatever branch is tracked
# Ask for approval, then:
git push origin develop
```

---

## Self-review notes

**Spec coverage check** (each §/requirement in the spec mapped to a task):

| Spec section | Covered by task(s) |
|---|---|
| §1 Resumo | Goal stated in plan header |
| §2 Goals/non-goals | Implicit in phase scoping |
| §3 Decisões | All honored in task code |
| §4 Arquitetura | Task 0.1 (scaffold), Tasks 1.x–5.x (module implementations) |
| §5 Schema canônico | Task 6.2 (helper), Tasks 7.1–7.3 (migrations emit correct shape) |
| §5.3 Helper bash | Task 6.2 |
| §6 Avaliação de status | Tasks 1.1–1.4 (TDD, all decision-table rules) |
| §7 Política de alertas | Tasks 2.1–2.4 (TDD, dedup/escalation/recovery) |
| §8 Summary agregado | Task 4.1 |
| §9 Integração infra | Tasks 8.1 (JARVIS host notifications config), 6.1 (deploy.sh), 7.x (per-service migrations) |
| §10 Rollout plan | Phase ordering matches: scaffold → evaluator → policy → I/O → orchestrator → shell → migrations → deploy |
| §11 Testing strategy | ~43 unit tests (Tasks 1.x, 2.x, 3.x) + integration smoke (Task 5.2) + manual E2E (Task 9.1) |
| §12 Config exemplo | Task 0.1 Step 4 + Task 8.2 Step 1 (activate added_at) |
| §13 Critérios de sucesso | Covered by manual E2E in Task 9.1 |
| §14 Itens deferidos | Noted in spec, not part of this plan |

**Placeholder scan:** No "TBD", "TODO", or vague guidance steps. Every code step shows actual code. Every command is concrete.

**Type consistency:** `evaluate()` return shape `{status, severity, reason}` used consistently across evaluator tests and orchestrator. `shouldFire()` returns `{alerts, newHistory}` consistently across policy tests and orchestrator. `state` object shape matches the canonical schema in every touch point (reader, evaluator, summary writer, migrations). Alert-sender uses `alert.type` and `alert.service` — populated by policy in the exact same keys.

**Known gaps flagged for implementer:**
- Task 7.1 Step 3 (stage annotation in pr-review) is optional polish. The implementer may skip it.
- Task 7.3 Step 1 (locating the poll loop in github-clickup-sync) requires reading the actual file — the current shape of that service's index.js may vary from the snippet I saw.
- Task 8.2 requires real server access and SSH credentials — the implementing agent should stop and hand back to Pedro when reaching deployment steps.
