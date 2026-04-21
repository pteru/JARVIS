# ClickUp Task Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the clickup-task-validator as a new mode in sprint-agents service, with knowledge-hub dashboard integration for review and apply workflow.

**Architecture:** Backend is 17 tasks in sprint-agents implementing 18 validation checks across 4 categories. Frontend is 8 tasks in knowledge-hub adding a validation tab with apply button. Pure TDD for checks and fix-planner; integration tests for fix-applier and HTTP routes.

**Tech Stack:** Node.js 20+ ESM, node:test, better-sqlite3, native node:http, vanilla JS + fetch API, ClickUp REST API v2/v3, Google Chat API

---

## Prerequisites

- `services/sprint-agents/` exists on `master` with `lib/clickup-client.mjs`, `config/service.json`, `run.sh`
- `services/knowledge-hub/` exists on `master` with `lib/server.mjs`, `dashboard/index.html`, `lib/alert-sender.mjs`
- ClickUp API token at `/opt/github-clickup-sync/.env` (`CLICKUP_TOKEN`)
- Google Chat credentials at `~/.secrets/gcp-service-account.json` (reused by health-monitor, lint)
- `pmo-readonly` mirror at `/opt/pmo-readonly/` with `config/project-codes.json`
- `claude` CLI present (only used indirectly — validator is zero-LLM)

---

## Phase A — sprint-agents backend (17 tasks)

All Phase A tasks live in worktree `/home/teruel/worktrees/infra-clickup-validator` off branch `feature/clickup-task-validator` (created from `origin/master`).

### Task A1: Scaffold `lib/validate/` dirs + config files

**Files created:**
- `services/sprint-agents/lib/validate/` (directory)
- `services/sprint-agents/lib/validate/checks/` (directory)
- `services/sprint-agents/config/validation-rules.json`
- `services/sprint-agents/config/prefix-mapping.json`
- `services/sprint-agents/data/validation/` (directory, gitignored content)
- `services/sprint-agents/data/validation/plans-archive/` (directory)
- `services/sprint-agents/test/validate/` (directory)
- `services/sprint-agents/test/validate/checks/` (directory)

**Why:** Establishes the directory tree and config surface used by every other Phase A task. Config files are read by `rules.mjs` and `inference.mjs`; doing this first prevents each subsequent task from re-guessing the JSON shape.

**Steps:**

- [ ] **Create worktree + branch**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git fetch origin
git worktree add -b feature/clickup-task-validator \
  /home/teruel/worktrees/infra-clickup-validator origin/master
cd /home/teruel/worktrees/infra-clickup-validator
mkdir -p services/sprint-agents/lib/validate/checks
mkdir -p services/sprint-agents/data/validation/plans-archive
mkdir -p services/sprint-agents/test/validate/checks
```

- [ ] **Write `services/sprint-agents/config/validation-rules.json`:**

```json
{
  "checks": {
    "primary-not-sprint":        { "severity": "critical", "enabled": true },
    "secondary-in-sprint":       { "severity": "warning",  "enabled": true },
    "project-folder-match":      { "severity": "critical", "enabled": true },
    "orphan-task":               { "severity": "critical", "enabled": true },
    "closed-sprint-open-tasks":  { "severity": "warning",  "enabled": true },
    "missing-project-code":      { "severity": "warning",  "enabled": true },
    "missing-product":           { "severity": "warning",  "enabled": true },
    "missing-task-lane":         { "severity": "warning",  "enabled": true },
    "missing-assignee-inprogress": { "severity": "warning", "enabled": true },
    "missing-dates-in-sprint":   { "severity": "warning",  "enabled": true },
    "missing-priority":          { "severity": "info",     "enabled": true },
    "overdue":                   { "severity": "warning",  "enabled": true },
    "blocked-too-long":          { "severity": "warning",  "enabled": true, "threshold_days": 7 },
    "in-progress-too-long":      { "severity": "warning",  "enabled": true, "threshold_days": 7 },
    "github-issue-missing":      { "severity": "critical", "enabled": true, "lane": "Software" },
    "github-status-divergent":   { "severity": "warning",  "enabled": true, "lane": "Software" },
    "done-without-closing-pr":   { "severity": "warning",  "enabled": true, "lane": "Software" },
    "storm-duplicate-not-closed": { "severity": "warning", "enabled": true, "lane": "Software" }
  },
  "alert": {
    "chat_space_id": "spaces/AAQADpGfnS4",
    "critical_only": true
  }
}
```

- [ ] **Write `services/sprint-agents/config/prefix-mapping.json`:**

```json
{
  "by_product": {
    "diemaster": {
      "sjc":      "900701761455",
      "flint":    "900701761583",
      "DEMESTAA": "901113447652",
      "sw":       "205149538",
      "ds":       "901107101218",
      "ml":       "901107101218",
      "hardware": "901107101206"
    },
    "spotfusion": {
      "sjc":      "217010888",
      "scds":     "901109508049",
      "gvt":      null,
      "sw":       "901109560051",
      "ds":       "901109635130",
      "db":       "901109635130",
      "vision":   "217010835",
      "hardware": "217010835"
    },
    "visionking": {
      "arcelor":     "901109407841",
      "vk-arcelor":  "901109407841",
      "arcelor-bm":  "901109407841",
      "iris-gvt":    "901111455897",
      "sealer":      "901112079252",
      "hyundai":     "901112079252",
      "sw":          "901109471398",
      "ds":          "901109474226",
      "vision":      "901109715764",
      "hardware":    "901109715764"
    }
  },
  "ambiguous": ["iris-scds", "gvt", "vk-body"]
}
```

- [ ] **Append validation settings to `services/sprint-agents/config/service.json`:**

Add a new top-level `validation` block (preserve existing keys):

```json
  "validation": {
    "lookback_days": 90,
    "archive_plans_after_days": 30,
    "dashboard_url": "http://192.168.15.2:8091/dashboard/validation"
  }
```

- [ ] **Add ignore entries to `services/sprint-agents/.gitignore`:**

```
data/validation/latest.json
data/validation/report-*.md
data/validation/fix-plan-*.md
data/validation/fix-applied-history.json
data/validation/fix-applied-*.md
data/validation/plans-archive/
```

**Verification:**
- [ ] `ls services/sprint-agents/config/validation-rules.json services/sprint-agents/config/prefix-mapping.json` both exist
- [ ] `node -e "JSON.parse(require('fs').readFileSync('services/sprint-agents/config/validation-rules.json'))"` parses
- [ ] `node -e "JSON.parse(require('fs').readFileSync('services/sprint-agents/config/prefix-mapping.json'))"` parses

---

### Task A2: `rules.mjs` — load config, check enabled/severity/threshold (TDD)

**Files created:**
- `services/sprint-agents/test/validate/rules.test.mjs`
- `services/sprint-agents/lib/validate/rules.mjs`

**Why:** Every check function needs a way to ask "am I enabled?", "what severity should I stamp on issues?", and "what's my threshold?". Centralizing this so checks don't duplicate logic.

**Steps:**

- [ ] **Step 1: Write failing tests** — `services/sprint-agents/test/validate/rules.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRules, isEnabled, severityOf, thresholdOf, alertConfig } from '../../lib/validate/rules.mjs';

const FIXTURE = {
  checks: {
    'primary-not-sprint':   { severity: 'critical', enabled: true },
    'blocked-too-long':     { severity: 'warning',  enabled: true, threshold_days: 7 },
    'missing-priority':     { severity: 'info',     enabled: false },
    'github-issue-missing': { severity: 'critical', enabled: true, lane: 'Software' },
  },
  alert: { chat_space_id: 'spaces/XYZ', critical_only: true },
};

test('loadRules returns parsed config from JSON file', () => {
  const rules = loadRules({ config: FIXTURE });
  assert.equal(typeof rules.checks, 'object');
  assert.ok(rules.checks['primary-not-sprint']);
});

test('isEnabled returns true/false based on flag', () => {
  const rules = loadRules({ config: FIXTURE });
  assert.equal(isEnabled(rules, 'primary-not-sprint'), true);
  assert.equal(isEnabled(rules, 'missing-priority'), false);
});

test('isEnabled returns false for unknown check id', () => {
  const rules = loadRules({ config: FIXTURE });
  assert.equal(isEnabled(rules, 'nonexistent'), false);
});

test('severityOf returns configured severity', () => {
  const rules = loadRules({ config: FIXTURE });
  assert.equal(severityOf(rules, 'primary-not-sprint'), 'critical');
  assert.equal(severityOf(rules, 'blocked-too-long'), 'warning');
});

test('severityOf returns "info" fallback for unknown check', () => {
  const rules = loadRules({ config: FIXTURE });
  assert.equal(severityOf(rules, 'unknown'), 'info');
});

test('thresholdOf returns threshold_days when present', () => {
  const rules = loadRules({ config: FIXTURE });
  assert.equal(thresholdOf(rules, 'blocked-too-long', 'threshold_days'), 7);
});

test('thresholdOf returns fallback when missing', () => {
  const rules = loadRules({ config: FIXTURE });
  assert.equal(thresholdOf(rules, 'primary-not-sprint', 'threshold_days', 3), 3);
});

test('alertConfig returns alert section', () => {
  const rules = loadRules({ config: FIXTURE });
  const alert = alertConfig(rules);
  assert.equal(alert.chat_space_id, 'spaces/XYZ');
  assert.equal(alert.critical_only, true);
});

test('loadRules reads from file path when no config provided', () => {
  const rules = loadRules({ path: new URL('../../config/validation-rules.json', import.meta.url).pathname });
  assert.ok(rules.checks['primary-not-sprint']);
  assert.ok(rules.alert);
});
```

- [ ] **Step 2: Run tests — confirm RED**

```bash
cd services/sprint-agents
node --test test/validate/rules.test.mjs
# Expect: cannot find module lib/validate/rules.mjs
```

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/rules.mjs`:

```javascript
/**
 * PURE: Rules loader and accessors.
 * Reads validation-rules.json (or accepts in-memory config for tests).
 */
import { readFileSync } from 'node:fs';

export function loadRules({ config = null, path = null } = {}) {
  if (config) return config;
  if (!path) throw new Error('loadRules requires either config or path');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function isEnabled(rules, checkId) {
  const cfg = rules.checks?.[checkId];
  if (!cfg) return false;
  return cfg.enabled === true;
}

export function severityOf(rules, checkId) {
  const cfg = rules.checks?.[checkId];
  return cfg?.severity || 'info';
}

export function thresholdOf(rules, checkId, key, fallback = null) {
  const cfg = rules.checks?.[checkId];
  if (!cfg || cfg[key] === undefined) return fallback;
  return cfg[key];
}

export function alertConfig(rules) {
  return rules.alert || { chat_space_id: null, critical_only: true };
}

export function laneFilterOf(rules, checkId) {
  const cfg = rules.checks?.[checkId];
  return cfg?.lane || null;
}
```

- [ ] **Step 4: Run tests — confirm GREEN**

```bash
node --test test/validate/rules.test.mjs
```

**Verification:** All 9 tests pass.

---

### Task A3: `inference.mjs` — prefix to list_id mapping (TDD with ambiguity handling)

**Files created:**
- `services/sprint-agents/test/validate/inference.test.mjs`
- `services/sprint-agents/lib/validate/inference.mjs`

**Why:** Several fix proposals (primary-not-sprint, missing-project-code) need to infer the correct target list from the task name prefix. Ambiguous prefixes must be reported but not auto-fixed.

**Steps:**

- [ ] **Step 1: Write failing tests** — `services/sprint-agents/test/validate/inference.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrefix, inferListFromName, isAmbiguous, loadPrefixMapping } from '../../lib/validate/inference.mjs';

const MAP = {
  by_product: {
    diemaster:  { sjc: '900701761455', sw: '205149538' },
    spotfusion: { sjc: '217010888',    sw: '901109560051' },
    visionking: {
      'iris-gvt':   '901111455897',
      'arcelor':    '901109407841',
      'vk-arcelor': '901109407841',
      sw:           '901109471398',
    },
  },
  ambiguous: ['iris-scds', 'gvt', 'vk-body'],
};

test('extractPrefix returns token before first colon', () => {
  assert.equal(extractPrefix('iris-gvt: testar modelo tipo 3'), 'iris-gvt');
  assert.equal(extractPrefix('sjc: revisar desenho'), 'sjc');
});

test('extractPrefix lowercases prefix', () => {
  assert.equal(extractPrefix('IRIS-GVT: testar'), 'iris-gvt');
});

test('extractPrefix returns null when no colon present', () => {
  assert.equal(extractPrefix('task without prefix'), null);
});

test('extractPrefix returns null for empty string', () => {
  assert.equal(extractPrefix(''), null);
  assert.equal(extractPrefix(null), null);
});

test('inferListFromName returns list id for matching product+prefix', () => {
  const r = inferListFromName('iris-gvt: test', 'visionking', MAP);
  assert.equal(r.list_id, '901111455897');
  assert.equal(r.prefix, 'iris-gvt');
  assert.equal(r.ambiguous, false);
});

test('inferListFromName returns null list_id when prefix is ambiguous', () => {
  const r = inferListFromName('iris-scds: test', 'visionking', MAP);
  assert.equal(r.list_id, null);
  assert.equal(r.ambiguous, true);
  assert.equal(r.prefix, 'iris-scds');
});

test('inferListFromName returns null when prefix unknown', () => {
  const r = inferListFromName('foobar: test', 'visionking', MAP);
  assert.equal(r.list_id, null);
  assert.equal(r.ambiguous, false);
  assert.equal(r.prefix, 'foobar');
});

test('inferListFromName returns null when product unknown', () => {
  const r = inferListFromName('sjc: test', 'mystery-product', MAP);
  assert.equal(r.list_id, null);
});

test('inferListFromName handles no-prefix names', () => {
  const r = inferListFromName('just a name', 'diemaster', MAP);
  assert.equal(r.list_id, null);
  assert.equal(r.prefix, null);
});

test('isAmbiguous recognises configured ambiguous prefixes', () => {
  assert.equal(isAmbiguous('iris-scds', MAP), true);
  assert.equal(isAmbiguous('sjc', MAP), false);
});

test('loadPrefixMapping reads the JSON file', () => {
  const map = loadPrefixMapping(new URL('../../config/prefix-mapping.json', import.meta.url).pathname);
  assert.ok(map.by_product);
  assert.ok(map.ambiguous);
});

test('inferListFromName maps aliases (vk-arcelor + arcelor)', () => {
  const a = inferListFromName('arcelor: x',    'visionking', MAP);
  const b = inferListFromName('vk-arcelor: x', 'visionking', MAP);
  assert.equal(a.list_id, b.list_id);
});
```

- [ ] **Step 2: Run tests — confirm RED**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/inference.mjs`:

```javascript
/**
 * PURE: Prefix → list id inference for location fix proposals.
 */
import { readFileSync } from 'node:fs';

export function loadPrefixMapping(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function extractPrefix(name) {
  if (!name || typeof name !== 'string') return null;
  const idx = name.indexOf(':');
  if (idx < 0) return null;
  return name.slice(0, idx).trim().toLowerCase();
}

export function isAmbiguous(prefix, mapping) {
  if (!prefix) return false;
  return (mapping.ambiguous || []).includes(prefix);
}

export function inferListFromName(name, product, mapping) {
  const prefix = extractPrefix(name);
  if (!prefix) return { prefix: null, list_id: null, ambiguous: false };
  if (isAmbiguous(prefix, mapping)) {
    return { prefix, list_id: null, ambiguous: true };
  }
  const productMap = mapping.by_product?.[product];
  if (!productMap) return { prefix, list_id: null, ambiguous: false };
  const listId = productMap[prefix] || null;
  return { prefix, list_id: listId, ambiguous: false };
}
```

- [ ] **Step 4: Run tests — confirm GREEN.**

**Verification:** All 12 tests pass.

---

### Task A4: `checks/location.mjs` — 5 location checks (TDD, one test per check)

**Files created:**
- `services/sprint-agents/test/validate/checks/location.test.mjs`
- `services/sprint-agents/lib/validate/checks/location.mjs`

**Why:** Location checks are the largest class of issues (especially `primary-not-sprint`, which makes sprint followup silently drop tasks). Pure functions that take `(task, context)` and return `issue[]`.

**Context shape passed to every check:**

```javascript
const context = {
  rules,                     // from rules.mjs
  prefixMapping,             // from inference.mjs loadPrefixMapping
  projectCodes,              // project-codes.json content
  allTasks,                  // Map<taskId, task> – all scanned tasks
  listMap,                   // Map<listId, { id, name, folder_id, product }>
  sprintMap,                 // Map<sprintListId, { id, name, start_date, due_date, status, product }>
  productFolders,            // Map<folderId, productName>
  customFieldIds,            // from service.json custom_fields
  githubState,               // { issuesByUrl: Map, prByNumber: Map }  — populated or empty
};
```

**Steps:**

- [ ] **Step 1: Write failing tests** — `services/sprint-agents/test/validate/checks/location.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkPrimaryNotSprint,
  checkSecondaryInSprint,
  checkProjectFolderMatch,
  checkOrphanTask,
  checkClosedSprintOpenTasks,
} from '../../../lib/validate/checks/location.mjs';

const RULES = {
  checks: {
    'primary-not-sprint':        { severity: 'critical', enabled: true },
    'secondary-in-sprint':       { severity: 'warning',  enabled: true },
    'project-folder-match':      { severity: 'critical', enabled: true },
    'orphan-task':               { severity: 'critical', enabled: true },
    'closed-sprint-open-tasks':  { severity: 'warning',  enabled: true },
  },
};

const MAP = {
  by_product: {
    visionking: { 'iris-gvt': '901111455897' },
    diemaster:  { 'sjc': '900701761455' },
  },
  ambiguous: ['vk-body'],
};

function ctx(overrides = {}) {
  return {
    rules: RULES,
    prefixMapping: MAP,
    projectCodes: { '03006': { product: 'visionking' } },
    listMap: new Map([
      ['901111455897', { id: '901111455897', name: '[03006] IRIS GM-GVT-Body', folder_id: '90071039181', product: 'visionking' }],
      ['900701761455', { id: '900701761455', name: '[01002] SJC',              folder_id: '7213380',   product: 'diemaster' }],
      ['901113495009', { id: '901113495009', name: 'VK Sprint 30',             folder_id: '90115784442', product: 'visionking' }],
    ]),
    sprintMap: new Map([
      ['901113495009', { id: '901113495009', name: 'VK Sprint 30', start_date: '1710000000000', due_date: '1713000000000', status: 'closed', product: 'visionking' }],
    ]),
    productFolders: new Map([
      ['90071039181', 'visionking'],
      ['7213380',     'diemaster'],
      ['90115784442', 'visionking'],
    ]),
    ...overrides,
  };
}

test('primary-not-sprint: task primary IN sprint → critical issue, fixable when prefix known', () => {
  const task = {
    id: 'T1',
    name: 'iris-gvt: testar modelo',
    url: 'https://clickup/T1',
    list: { id: '901113495009', name: 'VK Sprint 30' },
    locations: [{ id: '901113495009' }],
    status: { status: 'in progress' },
  };
  const issues = checkPrimaryNotSprint(task, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].check_id, 'primary-not-sprint');
  assert.equal(issues[0].severity, 'critical');
  assert.equal(issues[0].fixable, true);
  assert.equal(issues[0].fix_proposal.action, 'move_primary');
  assert.equal(issues[0].fix_proposal.params.target_list_id, '901111455897');
});

test('primary-not-sprint: fixable=false when prefix is ambiguous', () => {
  const task = {
    id: 'T2', name: 'vk-body: x', url: 'u',
    list: { id: '901113495009' }, locations: [],
    status: { status: 'open' },
  };
  const issues = checkPrimaryNotSprint(task, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fixable, false);
});

test('primary-not-sprint: fixable=false when prefix unknown', () => {
  const task = {
    id: 'T3', name: 'nothinghere: x', url: 'u',
    list: { id: '901113495009' }, locations: [],
    status: { status: 'open' },
  };
  const issues = checkPrimaryNotSprint(task, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fixable, false);
});

test('primary-not-sprint: task primary NOT in sprint → no issue', () => {
  const task = {
    id: 'T4', name: 'iris-gvt: x', url: 'u',
    list: { id: '901111455897' }, locations: [],
    status: { status: 'open' },
  };
  assert.deepEqual(checkPrimaryNotSprint(task, ctx()), []);
});

test('secondary-in-sprint: active task in product list with NO sprint secondary → no issue (not required)', () => {
  const task = {
    id: 'T5', name: 'sjc: x', url: 'u',
    list: { id: '900701761455' },
    locations: [{ id: '900701761455' }],
    status: { status: 'open' },
  };
  // Without special sprint-assignment expectation, no issue.
  assert.deepEqual(checkSecondaryInSprint(task, ctx()), []);
});

test('secondary-in-sprint: sprint list present in locations but primary is a non-sprint, done task → no issue (done is correct)', () => {
  const task = {
    id: 'T6', name: 'x', url: 'u',
    list: { id: '900701761455' },
    locations: [{ id: '900701761455' }, { id: '901113495009' }],
    status: { status: 'done' },
  };
  assert.deepEqual(checkSecondaryInSprint(task, ctx()), []);
});

test('project-folder-match: task in list whose folder != product → critical issue', () => {
  const task = {
    id: 'T7', name: 'sjc: foo', url: 'u',
    list: { id: '901111455897', name: '[03006] IRIS GM-GVT-Body' },
    locations: [],
    status: { status: 'open' },
    custom_fields: [{ id: 'product-field-id', value: 'diemaster' }],
  };
  const c = ctx({ customFieldIds: { product: 'product-field-id' } });
  c.productOptionMap = { 'opt-id-dm': 'diemaster', 'opt-id-sf': 'spotfusion', 'opt-id-vk': 'visionking' };
  const issues = checkProjectFolderMatch(task, c);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].check_id, 'project-folder-match');
  assert.equal(issues[0].severity, 'critical');
  assert.equal(issues[0].fixable, false);
});

test('project-folder-match: product matches folder → no issue', () => {
  const task = {
    id: 'T8', name: 'x', url: 'u',
    list: { id: '900701761455' },
    locations: [],
    status: { status: 'open' },
    custom_fields: [{ id: 'product-field-id', value: 'diemaster' }],
  };
  const c = ctx({ customFieldIds: { product: 'product-field-id' } });
  assert.deepEqual(checkProjectFolderMatch(task, c), []);
});

test('orphan-task: task.list missing → critical issue', () => {
  const task = { id: 'T9', name: 'x', url: 'u', list: null, locations: [], status: { status: 'open' } };
  const issues = checkOrphanTask(task, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].check_id, 'orphan-task');
  assert.equal(issues[0].fixable, false);
});

test('orphan-task: primary list unknown in listMap → orphan', () => {
  const task = { id: 'T10', name: 'x', url: 'u', list: { id: 'unknown-list' }, locations: [], status: { status: 'open' } };
  const issues = checkOrphanTask(task, ctx());
  assert.equal(issues.length, 1);
});

test('orphan-task: valid list → no issue', () => {
  const task = { id: 'T11', name: 'x', url: 'u', list: { id: '900701761455' }, locations: [], status: { status: 'open' } };
  assert.deepEqual(checkOrphanTask(task, ctx()), []);
});

test('closed-sprint-open-tasks: sprint closed + task non-done + primary == sprint → warning with fix', () => {
  const task = {
    id: 'T12', name: 'iris-gvt: carry over', url: 'u',
    list: { id: '901113495009' }, locations: [{ id: '901113495009' }],
    status: { status: 'in progress' },
  };
  const issues = checkClosedSprintOpenTasks(task, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].check_id, 'closed-sprint-open-tasks');
  assert.equal(issues[0].severity, 'warning');
  assert.equal(issues[0].fixable, true);
  assert.equal(issues[0].fix_proposal.action, 'move_to_next_sprint');
});

test('closed-sprint-open-tasks: sprint open OR task done → no issue', () => {
  const c = ctx();
  c.sprintMap.set('901113495009', { ...c.sprintMap.get('901113495009'), status: 'open' });
  const task = {
    id: 'T13', name: 'x', url: 'u',
    list: { id: '901113495009' }, locations: [], status: { status: 'in progress' },
  };
  assert.deepEqual(checkClosedSprintOpenTasks(task, c), []);
});
```

- [ ] **Step 2: Run tests — confirm RED.**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/checks/location.mjs`:

```javascript
/**
 * PURE: Category 1 — Location checks.
 *   primary-not-sprint        : primary list is a sprint (should be product list)
 *   secondary-in-sprint       : active task expected to be in sprint secondary but isn't
 *   project-folder-match      : task's primary list folder != task's product custom field
 *   orphan-task               : primary list missing or unknown
 *   closed-sprint-open-tasks  : task non-done whose primary is a closed sprint
 */
import { severityOf } from '../rules.mjs';
import { inferListFromName } from '../inference.mjs';

function baseIssue(task, checkId, category, severity, description) {
  return {
    id: `${task.id}::${checkId}`,
    check_id: checkId,
    category,
    severity,
    task: {
      id: task.id,
      name: task.name,
      url: task.url || `https://app.clickup.com/t/${task.id}`,
      primary_list: task.list ? { id: task.list.id, name: task.list.name } : null,
    },
    description,
    fixable: false,
    fix_proposal: null,
    detected_at: new Date().toISOString(),
  };
}

function inferredProduct(task, ctx) {
  const list = task.list && ctx.listMap.get(task.list.id);
  if (list) return list.product || null;
  return null;
}

export function checkPrimaryNotSprint(task, ctx) {
  if (!task.list) return [];
  if (!ctx.sprintMap.has(task.list.id)) return [];

  const product = ctx.sprintMap.get(task.list.id)?.product || inferredProduct(task, ctx);
  const issue = baseIssue(
    task,
    'primary-not-sprint',
    'location',
    severityOf(ctx.rules, 'primary-not-sprint'),
    `Primary location is a Sprint (${task.list.name}). Expected: product list.`,
  );

  const inf = inferListFromName(task.name, product, ctx.prefixMapping);
  if (inf.list_id) {
    const target = ctx.listMap.get(inf.list_id);
    issue.fixable = true;
    issue.fix_proposal = {
      action: 'move_primary',
      params: {
        target_list_id: inf.list_id,
        target_list_name: target ? target.name : inf.list_id,
      },
      inferred_from: `task name prefix '${inf.prefix}'`,
    };
  }
  return [issue];
}

export function checkSecondaryInSprint(task, ctx) {
  // v1 heuristic: only flag when task metadata explicitly indicates sprint membership
  // intent (e.g. an existing sprintExpectation in context). Until that's wired in,
  // this check is a no-op but still exported for parity.
  void task; void ctx;
  return [];
}

export function checkProjectFolderMatch(task, ctx) {
  if (!task.list) return [];
  const list = ctx.listMap.get(task.list.id);
  if (!list) return [];
  const folderProduct = ctx.productFolders.get(list.folder_id);
  if (!folderProduct) return [];

  const productFieldId = ctx.customFieldIds?.product;
  if (!productFieldId) return [];
  const field = (task.custom_fields || []).find(f => f.id === productFieldId);
  if (!field || !field.value) return [];

  // value may be an option uuid (in real ClickUp) or lowercase product string (in tests).
  const taskProduct = (ctx.productOptionMap && ctx.productOptionMap[field.value])
    || (typeof field.value === 'string' ? field.value.toLowerCase() : null);
  if (!taskProduct) return [];
  if (taskProduct === folderProduct) return [];

  const issue = baseIssue(
    task,
    'project-folder-match',
    'location',
    severityOf(ctx.rules, 'project-folder-match'),
    `Task product='${taskProduct}' but list folder belongs to product='${folderProduct}'.`,
  );
  issue.fixable = false;
  return [issue];
}

export function checkOrphanTask(task, ctx) {
  if (task.list && ctx.listMap.has(task.list.id)) return [];
  const issue = baseIssue(
    task,
    'orphan-task',
    'location',
    severityOf(ctx.rules, 'orphan-task'),
    task.list
      ? `Primary list ${task.list.id} not found in listMap (deleted or archived).`
      : 'Task has no primary list.',
  );
  issue.fixable = false;
  return [issue];
}

function statusIsDone(task) {
  return (task.status?.status || '').toLowerCase() === 'done';
}

export function checkClosedSprintOpenTasks(task, ctx) {
  if (!task.list) return [];
  const sprint = ctx.sprintMap.get(task.list.id);
  if (!sprint) return [];
  if (sprint.status !== 'closed') return [];
  if (statusIsDone(task)) return [];

  const issue = baseIssue(
    task,
    'closed-sprint-open-tasks',
    'location',
    severityOf(ctx.rules, 'closed-sprint-open-tasks'),
    `Task is non-done in closed sprint '${sprint.name}'. Needs to be moved to the next sprint or back to product list.`,
  );
  issue.fixable = true;
  issue.fix_proposal = {
    action: 'move_to_next_sprint',
    params: { from_sprint_id: sprint.id, product: sprint.product },
    inferred_from: 'closed sprint with non-done task',
  };
  return [issue];
}

export const CHECKS = [
  { id: 'primary-not-sprint',       fn: checkPrimaryNotSprint },
  { id: 'secondary-in-sprint',      fn: checkSecondaryInSprint },
  { id: 'project-folder-match',     fn: checkProjectFolderMatch },
  { id: 'orphan-task',              fn: checkOrphanTask },
  { id: 'closed-sprint-open-tasks', fn: checkClosedSprintOpenTasks },
];
```

- [ ] **Step 4: Run tests — confirm GREEN.**

**Verification:** All 13 tests pass.

---

### Task A5: `checks/metadata.mjs` — 6 metadata checks (TDD)

**Files created:**
- `services/sprint-agents/test/validate/checks/metadata.test.mjs`
- `services/sprint-agents/lib/validate/checks/metadata.mjs`

**Why:** Custom fields must be populated for downstream agents (field-populator, github-clickup-sync) to trust their inputs. This check catches the cases where the fields silently drift.

**Steps:**

- [ ] **Step 1: Write tests** — `services/sprint-agents/test/validate/checks/metadata.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkMissingProjectCode,
  checkMissingProduct,
  checkMissingTaskLane,
  checkMissingAssigneeInProgress,
  checkMissingDatesInSprint,
  checkMissingPriority,
} from '../../../lib/validate/checks/metadata.mjs';

const RULES = {
  checks: {
    'missing-project-code':        { severity: 'warning', enabled: true },
    'missing-product':             { severity: 'warning', enabled: true },
    'missing-task-lane':           { severity: 'warning', enabled: true },
    'missing-assignee-inprogress': { severity: 'warning', enabled: true },
    'missing-dates-in-sprint':     { severity: 'warning', enabled: true },
    'missing-priority':            { severity: 'info',    enabled: true },
  },
};

const FIELDS = {
  project_code: 'pc-id',
  product:      'prod-id',
  task_lane:    'lane-id',
};

function ctx(overrides = {}) {
  return {
    rules: RULES,
    customFieldIds: FIELDS,
    listMap: new Map([
      ['L1', { id: 'L1', name: '[03006] IRIS', folder_id: 'F1', product: 'visionking' }],
      ['L2', { id: 'L2', name: 'No code here', folder_id: 'F1', product: 'visionking' }],
    ]),
    sprintMap: new Map([
      ['SP1', { id: 'SP1', name: 'VK Sprint 30', start_date: '1710000000000', due_date: '1713000000000', status: 'open' }],
    ]),
    productFolders: new Map([['F1', 'visionking']]),
    ...overrides,
  };
}

function task({ id = 'T', name = 'x', listId = 'L1', locations = [], status = 'open', fields = [], assignees = [], start = null, due = null, priority = null } = {}) {
  return {
    id, name, url: `u/${id}`,
    list: listId ? { id: listId, name: 'lname' } : null,
    locations, status: { status },
    custom_fields: fields, assignees,
    start_date: start, due_date: due,
    priority: priority ? { priority } : null,
  };
}

// missing-project-code
test('missing-project-code: no custom value → issue with fix from [XXXXX] list prefix', () => {
  const issues = checkMissingProjectCode(task({ listId: 'L1' }), ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].check_id, 'missing-project-code');
  assert.equal(issues[0].fixable, true);
  assert.equal(issues[0].fix_proposal.params.value, '03006');
});

test('missing-project-code: populated → no issue', () => {
  const t = task({ fields: [{ id: 'pc-id', value: '03006' }] });
  assert.deepEqual(checkMissingProjectCode(t, ctx()), []);
});

test('missing-project-code: no [XXXXX] in list name → issue fixable=false', () => {
  const issues = checkMissingProjectCode(task({ listId: 'L2' }), ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fixable, false);
});

// missing-product
test('missing-product: no value → issue with fix from folder', () => {
  const issues = checkMissingProduct(task({ listId: 'L1' }), ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fixable, true);
  assert.equal(issues[0].fix_proposal.params.value, 'visionking');
});

test('missing-product: populated → no issue', () => {
  const t = task({ fields: [{ id: 'prod-id', value: 'visionking' }] });
  assert.deepEqual(checkMissingProduct(t, ctx()), []);
});

// missing-task-lane
test('missing-task-lane: no value → issue, fixable=false', () => {
  const issues = checkMissingTaskLane(task(), ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fixable, false);
});

test('missing-task-lane: populated → no issue', () => {
  const t = task({ fields: [{ id: 'lane-id', value: 'opt-software' }] });
  assert.deepEqual(checkMissingTaskLane(t, ctx()), []);
});

// missing-assignee-inprogress
test('missing-assignee-inprogress: in progress + empty assignees → issue', () => {
  const issues = checkMissingAssigneeInProgress(task({ status: 'in progress', assignees: [] }), ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fixable, false);
});

test('missing-assignee-inprogress: not in progress → no issue', () => {
  assert.deepEqual(checkMissingAssigneeInProgress(task({ status: 'open', assignees: [] }), ctx()), []);
});

test('missing-assignee-inprogress: in progress with assignees → no issue', () => {
  assert.deepEqual(checkMissingAssigneeInProgress(task({ status: 'in progress', assignees: [{ id: 1 }] }), ctx()), []);
});

// missing-dates-in-sprint
test('missing-dates-in-sprint: task in sprint + no dates → issue with fix from sprint', () => {
  const t = task({ locations: [{ id: 'SP1' }], listId: 'L1', start: null, due: null });
  const issues = checkMissingDatesInSprint(t, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fixable, true);
  assert.equal(issues[0].fix_proposal.params.start_date, '1710000000000');
  assert.equal(issues[0].fix_proposal.params.due_date, '1713000000000');
});

test('missing-dates-in-sprint: task in sprint WITH dates → no issue', () => {
  const t = task({ locations: [{ id: 'SP1' }], start: '1711000000000', due: '1712000000000' });
  assert.deepEqual(checkMissingDatesInSprint(t, ctx()), []);
});

test('missing-dates-in-sprint: task NOT in sprint → no issue', () => {
  assert.deepEqual(checkMissingDatesInSprint(task({ locations: [] }), ctx()), []);
});

// missing-priority
test('missing-priority: active task without priority → info issue', () => {
  const issues = checkMissingPriority(task({ status: 'open', priority: null }), ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'info');
  assert.equal(issues[0].fixable, false);
});

test('missing-priority: done task without priority → no issue', () => {
  assert.deepEqual(checkMissingPriority(task({ status: 'done', priority: null }), ctx()), []);
});
```

- [ ] **Step 2: Run tests — confirm RED.**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/checks/metadata.mjs`:

```javascript
/**
 * PURE: Category 2 — Metadata checks.
 */
import { severityOf } from '../rules.mjs';

function baseIssue(task, checkId, category, severity, description) {
  return {
    id: `${task.id}::${checkId}`,
    check_id: checkId,
    category,
    severity,
    task: {
      id: task.id,
      name: task.name,
      url: task.url || `https://app.clickup.com/t/${task.id}`,
      primary_list: task.list ? { id: task.list.id, name: task.list.name } : null,
    },
    description,
    fixable: false,
    fix_proposal: null,
    detected_at: new Date().toISOString(),
  };
}

function cfValue(task, fieldId) {
  if (!fieldId) return undefined;
  const f = (task.custom_fields || []).find(x => x.id === fieldId);
  return f ? f.value : undefined;
}

function isEmpty(v) {
  return v === undefined || v === null || v === '';
}

function extractCode(listName) {
  const m = /\[(\d{5})\]/.exec(listName || '');
  return m ? m[1] : null;
}

export function checkMissingProjectCode(task, ctx) {
  const fieldId = ctx.customFieldIds?.project_code;
  if (!fieldId) return [];
  if (!isEmpty(cfValue(task, fieldId))) return [];

  const issue = baseIssue(
    task,
    'missing-project-code',
    'metadata',
    severityOf(ctx.rules, 'missing-project-code'),
    'Custom field project_code is empty.',
  );

  const list = task.list && ctx.listMap.get(task.list.id);
  const code = list ? extractCode(list.name) : null;
  if (code) {
    issue.fixable = true;
    issue.fix_proposal = {
      action: 'set_custom_field',
      params: { field_id: fieldId, value: code },
      inferred_from: `list name '[${code}]'`,
    };
  }
  return [issue];
}

export function checkMissingProduct(task, ctx) {
  const fieldId = ctx.customFieldIds?.product;
  if (!fieldId) return [];
  if (!isEmpty(cfValue(task, fieldId))) return [];

  const issue = baseIssue(
    task,
    'missing-product',
    'metadata',
    severityOf(ctx.rules, 'missing-product'),
    'Custom field product is empty.',
  );

  const list = task.list && ctx.listMap.get(task.list.id);
  const product = list && ctx.productFolders.get(list.folder_id);
  if (product) {
    issue.fixable = true;
    issue.fix_proposal = {
      action: 'set_custom_field',
      params: { field_id: fieldId, value: product },
      inferred_from: `folder_id ${list.folder_id} → ${product}`,
    };
  }
  return [issue];
}

export function checkMissingTaskLane(task, ctx) {
  const fieldId = ctx.customFieldIds?.task_lane;
  if (!fieldId) return [];
  if (!isEmpty(cfValue(task, fieldId))) return [];

  const issue = baseIssue(
    task,
    'missing-task-lane',
    'metadata',
    severityOf(ctx.rules, 'missing-task-lane'),
    'Custom field task_lane is empty (no heuristic available — set manually).',
  );
  return [issue];
}

export function checkMissingAssigneeInProgress(task, ctx) {
  const s = (task.status?.status || '').toLowerCase();
  if (s !== 'in progress') return [];
  if ((task.assignees || []).length > 0) return [];

  return [baseIssue(
    task,
    'missing-assignee-inprogress',
    'metadata',
    severityOf(ctx.rules, 'missing-assignee-inprogress'),
    'Task is "in progress" but has no assignee.',
  )];
}

export function checkMissingDatesInSprint(task, ctx) {
  const inSprint = (task.locations || []).find(l => ctx.sprintMap.has(l.id));
  if (!inSprint) return [];
  if (task.start_date && task.due_date) return [];

  const issue = baseIssue(
    task,
    'missing-dates-in-sprint',
    'metadata',
    severityOf(ctx.rules, 'missing-dates-in-sprint'),
    'Task is in a sprint without start/due date.',
  );
  const sprint = ctx.sprintMap.get(inSprint.id);
  if (sprint && sprint.start_date && sprint.due_date) {
    issue.fixable = true;
    issue.fix_proposal = {
      action: 'set_dates',
      params: { start_date: sprint.start_date, due_date: sprint.due_date },
      inferred_from: `sprint ${sprint.name}`,
    };
  }
  return [issue];
}

export function checkMissingPriority(task, ctx) {
  const s = (task.status?.status || '').toLowerCase();
  if (['done', 'closed', 'cancelled'].includes(s)) return [];
  if (task.priority && task.priority.priority) return [];

  return [baseIssue(
    task,
    'missing-priority',
    'metadata',
    severityOf(ctx.rules, 'missing-priority'),
    'Active task without priority.',
  )];
}

export const CHECKS = [
  { id: 'missing-project-code',        fn: checkMissingProjectCode },
  { id: 'missing-product',             fn: checkMissingProduct },
  { id: 'missing-task-lane',           fn: checkMissingTaskLane },
  { id: 'missing-assignee-inprogress', fn: checkMissingAssigneeInProgress },
  { id: 'missing-dates-in-sprint',     fn: checkMissingDatesInSprint },
  { id: 'missing-priority',            fn: checkMissingPriority },
];
```

- [ ] **Step 4: Run tests — confirm GREEN.**

**Verification:** All 15 tests pass.

---

### Task A6: `checks/status.mjs` — 3 status checks (TDD)

**Files created:**
- `services/sprint-agents/test/validate/checks/status.test.mjs`
- `services/sprint-agents/lib/validate/checks/status.mjs`

**Why:** Stale-in-flight tasks (blocked/in-progress too long, overdue) are routine sprint-health signals that sprint-followup already alerts on. Centralising the detection here lets validator surface them with precise dates.

**Steps:**

- [ ] **Step 1: Write tests** — `services/sprint-agents/test/validate/checks/status.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOverdue, checkBlockedTooLong, checkInProgressTooLong } from '../../../lib/validate/checks/status.mjs';

const RULES = {
  checks: {
    'overdue':              { severity: 'warning', enabled: true },
    'blocked-too-long':     { severity: 'warning', enabled: true, threshold_days: 7 },
    'in-progress-too-long': { severity: 'warning', enabled: true, threshold_days: 7 },
  },
};

const NOW = 1713500000000;
const DAY = 86400000;

function ctx() {
  return { rules: RULES, now: NOW };
}

function task({ id = 'T', status = 'open', due = null, updated = null, historyMs = null } = {}) {
  return {
    id, name: 'x', url: 'u',
    list: { id: 'L' },
    locations: [],
    status: { status },
    due_date: due,
    date_updated: updated,
    // validator uses date_updated as a status-change proxy;
    // historyMs lets tests simulate "blocked since".
    _blocked_since_ms: historyMs,
  };
}

// overdue
test('overdue: due < now + status not done → issue', () => {
  const t = task({ status: 'in progress', due: String(NOW - DAY) });
  const issues = checkOverdue(t, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].check_id, 'overdue');
});

test('overdue: due >= now → no issue', () => {
  const t = task({ status: 'in progress', due: String(NOW + DAY) });
  assert.deepEqual(checkOverdue(t, ctx()), []);
});

test('overdue: task done → no issue even if past due', () => {
  const t = task({ status: 'done', due: String(NOW - DAY * 10) });
  assert.deepEqual(checkOverdue(t, ctx()), []);
});

test('overdue: no due_date → no issue', () => {
  const t = task({ status: 'in progress', due: null });
  assert.deepEqual(checkOverdue(t, ctx()), []);
});

// blocked-too-long
test('blocked-too-long: blocked > threshold → issue', () => {
  const t = task({ status: 'blocked', updated: String(NOW - DAY * 10) });
  const issues = checkBlockedTooLong(t, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].check_id, 'blocked-too-long');
});

test('blocked-too-long: blocked < threshold → no issue', () => {
  const t = task({ status: 'blocked', updated: String(NOW - DAY * 3) });
  assert.deepEqual(checkBlockedTooLong(t, ctx()), []);
});

test('blocked-too-long: not blocked → no issue', () => {
  const t = task({ status: 'in progress', updated: String(NOW - DAY * 100) });
  assert.deepEqual(checkBlockedTooLong(t, ctx()), []);
});

// in-progress-too-long
test('in-progress-too-long: in progress > threshold → issue', () => {
  const t = task({ status: 'in progress', updated: String(NOW - DAY * 10) });
  const issues = checkInProgressTooLong(t, ctx());
  assert.equal(issues.length, 1);
});

test('in-progress-too-long: in progress < threshold → no issue', () => {
  const t = task({ status: 'in progress', updated: String(NOW - DAY * 3) });
  assert.deepEqual(checkInProgressTooLong(t, ctx()), []);
});

test('in-progress-too-long: not in progress → no issue', () => {
  const t = task({ status: 'done', updated: String(NOW - DAY * 100) });
  assert.deepEqual(checkInProgressTooLong(t, ctx()), []);
});
```

- [ ] **Step 2: Run tests — confirm RED.**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/checks/status.mjs`:

```javascript
/**
 * PURE: Category 3 — Status consistency checks.
 */
import { severityOf, thresholdOf } from '../rules.mjs';

function baseIssue(task, checkId, category, severity, description) {
  return {
    id: `${task.id}::${checkId}`,
    check_id: checkId,
    category,
    severity,
    task: {
      id: task.id,
      name: task.name,
      url: task.url || `https://app.clickup.com/t/${task.id}`,
      primary_list: task.list ? { id: task.list.id, name: task.list.name } : null,
    },
    description,
    fixable: false,
    fix_proposal: null,
    detected_at: new Date().toISOString(),
  };
}

function statusLower(task) {
  return (task.status?.status || '').toLowerCase();
}

export function checkOverdue(task, ctx) {
  const s = statusLower(task);
  if (['done', 'closed', 'cancelled'].includes(s)) return [];
  const due = task.due_date ? parseInt(task.due_date, 10) : null;
  if (!due) return [];
  const now = ctx.now ?? Date.now();
  if (due >= now) return [];

  const daysOverdue = Math.floor((now - due) / 86400000);
  return [baseIssue(
    task,
    'overdue',
    'status',
    severityOf(ctx.rules, 'overdue'),
    `Task is ${daysOverdue} day(s) past due (status: ${task.status?.status}).`,
  )];
}

export function checkBlockedTooLong(task, ctx) {
  const s = statusLower(task);
  if (s !== 'blocked') return [];
  const threshold = thresholdOf(ctx.rules, 'blocked-too-long', 'threshold_days', 7);
  const now = ctx.now ?? Date.now();
  const updated = task.date_updated ? parseInt(task.date_updated, 10) : null;
  if (!updated) return [];
  const daysBlocked = Math.floor((now - updated) / 86400000);
  if (daysBlocked < threshold) return [];

  return [baseIssue(
    task,
    'blocked-too-long',
    'status',
    severityOf(ctx.rules, 'blocked-too-long'),
    `Task blocked for ${daysBlocked} day(s) (threshold: ${threshold}).`,
  )];
}

export function checkInProgressTooLong(task, ctx) {
  const s = statusLower(task);
  if (s !== 'in progress') return [];
  const threshold = thresholdOf(ctx.rules, 'in-progress-too-long', 'threshold_days', 7);
  const now = ctx.now ?? Date.now();
  const updated = task.date_updated ? parseInt(task.date_updated, 10) : null;
  if (!updated) return [];
  const days = Math.floor((now - updated) / 86400000);
  if (days < threshold) return [];

  return [baseIssue(
    task,
    'in-progress-too-long',
    'status',
    severityOf(ctx.rules, 'in-progress-too-long'),
    `Task in progress for ${days} day(s) without activity (threshold: ${threshold}).`,
  )];
}

export const CHECKS = [
  { id: 'overdue',              fn: checkOverdue },
  { id: 'blocked-too-long',     fn: checkBlockedTooLong },
  { id: 'in-progress-too-long', fn: checkInProgressTooLong },
];
```

- [ ] **Step 4: Run tests — confirm GREEN.**

**Verification:** All 10 tests pass.

---

### Task A7: `checks/github-sync.mjs` — 4 GitHub sync checks (TDD, Software lane only)

**Files created:**
- `services/sprint-agents/test/validate/checks/github-sync.test.mjs`
- `services/sprint-agents/lib/validate/checks/github-sync.mjs`

**Why:** GitHub ↔ ClickUp sync failures are the most common source of “task says done but PR never closed” confusion. Runs only when `task_lane == Software`.

**Steps:**

- [ ] **Step 1: Write tests** — `services/sprint-agents/test/validate/checks/github-sync.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkGithubIssueMissing,
  checkGithubStatusDivergent,
  checkDoneWithoutClosingPr,
  checkStormDuplicateNotClosed,
} from '../../../lib/validate/checks/github-sync.mjs';

const RULES = {
  checks: {
    'github-issue-missing':       { severity: 'critical', enabled: true, lane: 'Software' },
    'github-status-divergent':    { severity: 'warning',  enabled: true, lane: 'Software' },
    'done-without-closing-pr':    { severity: 'warning',  enabled: true, lane: 'Software' },
    'storm-duplicate-not-closed': { severity: 'warning',  enabled: true, lane: 'Software' },
  },
};

const FIELDS = {
  github_issue_url: 'gh-url',
  closing_pr:       'cpr',
  task_lane:        'lane',
};

function ctx(overrides = {}) {
  return {
    rules: RULES,
    customFieldIds: FIELDS,
    taskLaneLabels: new Map([['lane-software-opt', 'Software'], ['lane-modelos-opt', 'Modelos']]),
    githubState: {
      issuesByUrl: new Map([
        ['https://github.com/strokmatic/repo/issues/42', { state: 'open', labels: [] }],
        ['https://github.com/strokmatic/repo/issues/50', { state: 'closed', labels: ['storm-duplicate'] }],
      ]),
    },
    ...overrides,
  };
}

function task({ id = 'T', status = 'open', fields = [] } = {}) {
  return {
    id, name: 'x', url: 'u',
    list: { id: 'L' }, locations: [],
    status: { status },
    custom_fields: fields,
  };
}

function laneField(label) {
  return { id: 'lane', value: label === 'Software' ? 'lane-software-opt' : 'lane-modelos-opt' };
}

// github-issue-missing
test('github-issue-missing: url set but issue absent from state → critical', () => {
  const t = task({ fields: [laneField('Software'), { id: 'gh-url', value: 'https://github.com/strokmatic/repo/issues/999' }] });
  const issues = checkGithubIssueMissing(t, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'critical');
});

test('github-issue-missing: url set + issue exists → no issue', () => {
  const t = task({ fields: [laneField('Software'), { id: 'gh-url', value: 'https://github.com/strokmatic/repo/issues/42' }] });
  assert.deepEqual(checkGithubIssueMissing(t, ctx()), []);
});

test('github-issue-missing: lane != Software → skipped', () => {
  const t = task({ fields: [laneField('Modelos'), { id: 'gh-url', value: 'https://github.com/strokmatic/repo/issues/999' }] });
  assert.deepEqual(checkGithubIssueMissing(t, ctx()), []);
});

test('github-issue-missing: no url → no issue', () => {
  const t = task({ fields: [laneField('Software')] });
  assert.deepEqual(checkGithubIssueMissing(t, ctx()), []);
});

// github-status-divergent
test('github-status-divergent: issue open + task done → warning', () => {
  const t = task({ status: 'done', fields: [laneField('Software'), { id: 'gh-url', value: 'https://github.com/strokmatic/repo/issues/42' }] });
  const issues = checkGithubStatusDivergent(t, ctx());
  assert.equal(issues.length, 1);
});

test('github-status-divergent: issue closed + task done → no issue', () => {
  const c = ctx();
  c.githubState.issuesByUrl.set('https://github.com/strokmatic/repo/issues/42', { state: 'closed', labels: [] });
  const t = task({ status: 'done', fields: [laneField('Software'), { id: 'gh-url', value: 'https://github.com/strokmatic/repo/issues/42' }] });
  assert.deepEqual(checkGithubStatusDivergent(t, c), []);
});

test('github-status-divergent: issue missing from state → skip (covered by other check)', () => {
  const t = task({ status: 'done', fields: [laneField('Software'), { id: 'gh-url', value: 'https://github.com/strokmatic/repo/issues/9999' }] });
  assert.deepEqual(checkGithubStatusDivergent(t, ctx()), []);
});

// done-without-closing-pr
test('done-without-closing-pr: done + closing_pr empty → warning', () => {
  const t = task({ status: 'done', fields: [laneField('Software')] });
  const issues = checkDoneWithoutClosingPr(t, ctx());
  assert.equal(issues.length, 1);
});

test('done-without-closing-pr: done + closing_pr set → no issue', () => {
  const t = task({ status: 'done', fields: [laneField('Software'), { id: 'cpr', value: 'https://github.com/strokmatic/repo/pull/10' }] });
  assert.deepEqual(checkDoneWithoutClosingPr(t, ctx()), []);
});

test('done-without-closing-pr: not done → no issue', () => {
  const t = task({ status: 'open', fields: [laneField('Software')] });
  assert.deepEqual(checkDoneWithoutClosingPr(t, ctx()), []);
});

// storm-duplicate-not-closed
test('storm-duplicate-not-closed: labeled storm-duplicate + task open → warning with close proposal', () => {
  const t = task({ status: 'open', fields: [laneField('Software'), { id: 'gh-url', value: 'https://github.com/strokmatic/repo/issues/50' }] });
  const issues = checkStormDuplicateNotClosed(t, ctx());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fixable, true);
  assert.equal(issues[0].fix_proposal.action, 'close_task_as_not_planned');
});

test('storm-duplicate-not-closed: task already done → no issue', () => {
  const t = task({ status: 'done', fields: [laneField('Software'), { id: 'gh-url', value: 'https://github.com/strokmatic/repo/issues/50' }] });
  assert.deepEqual(checkStormDuplicateNotClosed(t, ctx()), []);
});

test('storm-duplicate-not-closed: issue not labeled storm-duplicate → no issue', () => {
  const t = task({ status: 'open', fields: [laneField('Software'), { id: 'gh-url', value: 'https://github.com/strokmatic/repo/issues/42' }] });
  assert.deepEqual(checkStormDuplicateNotClosed(t, ctx()), []);
});
```

- [ ] **Step 2: Run tests — confirm RED.**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/checks/github-sync.mjs`:

```javascript
/**
 * PURE: Category 4 — GitHub ↔ ClickUp sync checks.
 * Conditional: skip if task_lane != Software.
 */
import { severityOf } from '../rules.mjs';

function baseIssue(task, checkId, category, severity, description) {
  return {
    id: `${task.id}::${checkId}`,
    check_id: checkId,
    category,
    severity,
    task: {
      id: task.id,
      name: task.name,
      url: task.url || `https://app.clickup.com/t/${task.id}`,
      primary_list: task.list ? { id: task.list.id, name: task.list.name } : null,
    },
    description,
    fixable: false,
    fix_proposal: null,
    detected_at: new Date().toISOString(),
  };
}

function cfValue(task, fieldId) {
  if (!fieldId) return undefined;
  const f = (task.custom_fields || []).find(x => x.id === fieldId);
  return f ? f.value : undefined;
}

function laneLabel(task, ctx) {
  const v = cfValue(task, ctx.customFieldIds?.task_lane);
  if (!v) return null;
  const map = ctx.taskLaneLabels;
  if (map && map.get(v)) return map.get(v);
  return typeof v === 'string' ? v : null;
}

function isSoftware(task, ctx) {
  return laneLabel(task, ctx) === 'Software';
}

export function checkGithubIssueMissing(task, ctx) {
  if (!isSoftware(task, ctx)) return [];
  const url = cfValue(task, ctx.customFieldIds?.github_issue_url);
  if (!url) return [];
  if (ctx.githubState?.issuesByUrl?.has(url)) return [];

  const issue = baseIssue(
    task,
    'github-issue-missing',
    'github-sync',
    severityOf(ctx.rules, 'github-issue-missing'),
    `github_issue_url is set (${url}) but the issue was not found in GitHub state.`,
  );
  return [issue];
}

export function checkGithubStatusDivergent(task, ctx) {
  if (!isSoftware(task, ctx)) return [];
  const url = cfValue(task, ctx.customFieldIds?.github_issue_url);
  if (!url) return [];
  const gh = ctx.githubState?.issuesByUrl?.get(url);
  if (!gh) return [];
  const taskDone = (task.status?.status || '').toLowerCase() === 'done';
  const issueOpen = gh.state === 'open';
  if (taskDone === issueOpen) {
    // done vs open (divergent) OR !done vs !open (divergent)
    return [baseIssue(
      task,
      'github-status-divergent',
      'github-sync',
      severityOf(ctx.rules, 'github-status-divergent'),
      `ClickUp status='${task.status?.status}' but GitHub issue state='${gh.state}'.`,
    )];
  }
  return [];
}

export function checkDoneWithoutClosingPr(task, ctx) {
  if (!isSoftware(task, ctx)) return [];
  const done = (task.status?.status || '').toLowerCase() === 'done';
  if (!done) return [];
  const pr = cfValue(task, ctx.customFieldIds?.closing_pr);
  if (pr) return [];

  return [baseIssue(
    task,
    'done-without-closing-pr',
    'github-sync',
    severityOf(ctx.rules, 'done-without-closing-pr'),
    'Task is done but closing_pr custom field is empty.',
  )];
}

export function checkStormDuplicateNotClosed(task, ctx) {
  if (!isSoftware(task, ctx)) return [];
  const url = cfValue(task, ctx.customFieldIds?.github_issue_url);
  if (!url) return [];
  const gh = ctx.githubState?.issuesByUrl?.get(url);
  if (!gh || !(gh.labels || []).includes('storm-duplicate')) return [];
  const done = (task.status?.status || '').toLowerCase() === 'done';
  if (done) return [];

  const issue = baseIssue(
    task,
    'storm-duplicate-not-closed',
    'github-sync',
    severityOf(ctx.rules, 'storm-duplicate-not-closed'),
    `GitHub issue labeled 'storm-duplicate' but ClickUp task still open.`,
  );
  issue.fixable = true;
  issue.fix_proposal = {
    action: 'close_task_as_not_planned',
    params: { reason: 'storm-duplicate' },
    inferred_from: 'GitHub label storm-duplicate + task open',
  };
  return [issue];
}

export const CHECKS = [
  { id: 'github-issue-missing',       fn: checkGithubIssueMissing },
  { id: 'github-status-divergent',    fn: checkGithubStatusDivergent },
  { id: 'done-without-closing-pr',    fn: checkDoneWithoutClosingPr },
  { id: 'storm-duplicate-not-closed', fn: checkStormDuplicateNotClosed },
];
```

- [ ] **Step 4: Run tests — confirm GREEN.**

**Verification:** All 13 tests pass.

---

### Task A8: `fix-planner.mjs` — generate fix-plan MD from issues (TDD)

**Files created:**
- `services/sprint-agents/test/validate/fix-planner.test.mjs`
- `services/sprint-agents/lib/validate/fix-planner.mjs`

**Why:** Dashboard needs a deterministic fix plan file with checkboxes so humans can uncheck fixes before apply. Must exclude already-applied fixes (read from history).

**Steps:**

- [ ] **Step 1: Write tests** — `services/sprint-agents/test/validate/fix-planner.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixPlan, appliedIdsFromHistory, renderFixPlanMarkdown } from '../../lib/validate/fix-planner.mjs';

const ISSUES = [
  {
    id: 'T1::primary-not-sprint', check_id: 'primary-not-sprint', severity: 'critical',
    category: 'location',
    task: { id: 'T1', name: 'iris-gvt: test', url: 'https://clickup/T1', primary_list: { id: 'SP1', name: 'VK Sprint 30' } },
    description: 'Primary is sprint',
    fixable: true,
    fix_proposal: { action: 'move_primary', params: { target_list_id: 'L1', target_list_name: '[03006] IRIS' }, inferred_from: 'prefix iris-gvt' },
    detected_at: '2026-04-21T08:00:00Z',
  },
  {
    id: 'T2::missing-product', check_id: 'missing-product', severity: 'warning',
    category: 'metadata',
    task: { id: 'T2', name: 'x', url: 'u', primary_list: { id: 'L2', name: 'L2' } },
    description: 'product empty', fixable: true,
    fix_proposal: { action: 'set_custom_field', params: { field_id: 'prod-id', value: 'visionking' }, inferred_from: 'folder' },
    detected_at: '2026-04-21T08:00:00Z',
  },
  {
    id: 'T3::missing-task-lane', check_id: 'missing-task-lane', severity: 'warning',
    category: 'metadata',
    task: { id: 'T3', name: 'y', url: 'u', primary_list: { id: 'L3', name: 'L3' } },
    description: 'lane empty', fixable: false, fix_proposal: null,
    detected_at: '2026-04-21T08:00:00Z',
  },
];

test('buildFixPlan keeps only fixable issues', () => {
  const plan = buildFixPlan({ issues: ISSUES, applied: new Set(), date: '2026-04-21' });
  assert.equal(plan.fix_date, '2026-04-21');
  assert.equal(plan.items.length, 2);
  assert.ok(plan.items.every(i => i.fixable));
});

test('buildFixPlan excludes already-applied fixes', () => {
  const applied = new Set(['T1::primary-not-sprint']);
  const plan = buildFixPlan({ issues: ISSUES, applied, date: '2026-04-21' });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].id, 'T2::missing-product');
});

test('buildFixPlan groups stats by severity + category', () => {
  const plan = buildFixPlan({ issues: ISSUES, applied: new Set(), date: '2026-04-21' });
  assert.equal(plan.totals.critical, 1);
  assert.equal(plan.totals.warning, 1);
  assert.deepEqual(plan.by_category.location, 1);
  assert.deepEqual(plan.by_category.metadata, 1);
});

test('appliedIdsFromHistory returns Set of issue_ids', () => {
  const history = { applied: [{ issue_id: 'a' }, { issue_id: 'b' }] };
  const set = appliedIdsFromHistory(history);
  assert.ok(set.has('a') && set.has('b'));
});

test('appliedIdsFromHistory handles missing applied key', () => {
  const set = appliedIdsFromHistory({});
  assert.equal(set.size, 0);
});

test('renderFixPlanMarkdown includes header, checkboxes, action, params', () => {
  const plan = buildFixPlan({ issues: ISSUES, applied: new Set(), date: '2026-04-21' });
  const md = renderFixPlanMarkdown(plan);
  assert.ok(md.startsWith('# Fix Plan — 2026-04-21'));
  assert.ok(md.includes('- [x]'));
  assert.ok(md.includes('move_primary'));
  assert.ok(md.includes('iris-gvt: test'));
  assert.ok(md.includes('## Summary'));
  assert.ok(md.includes('## Location fixes'));
  assert.ok(md.includes('## Metadata fixes'));
});

test('renderFixPlanMarkdown: empty plan → "No fixable issues"', () => {
  const plan = buildFixPlan({ issues: [], applied: new Set(), date: '2026-04-21' });
  const md = renderFixPlanMarkdown(plan);
  assert.ok(md.includes('No fixable issues'));
});
```

- [ ] **Step 2: Run tests — confirm RED.**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/fix-planner.mjs`:

```javascript
/**
 * PURE: Build fix plan from validator issues.
 */

const CATEGORY_ORDER = ['location', 'metadata', 'status', 'github-sync'];
const CATEGORY_TITLE = {
  location: 'Location fixes',
  metadata: 'Metadata fixes',
  status: 'Status fixes',
  'github-sync': 'GitHub sync fixes',
};

export function appliedIdsFromHistory(history) {
  const set = new Set();
  for (const entry of history.applied || []) {
    if (entry.issue_id) set.add(entry.issue_id);
  }
  return set;
}

export function buildFixPlan({ issues, applied, date }) {
  const fixable = issues
    .filter(i => i.fixable && !applied.has(i.id));

  const totals = { critical: 0, warning: 0, info: 0 };
  const by_category = {};
  for (const i of fixable) {
    totals[i.severity] = (totals[i.severity] || 0) + 1;
    by_category[i.category] = (by_category[i.category] || 0) + 1;
  }

  return { fix_date: date, items: fixable, totals, by_category };
}

function renderItem(issue) {
  const action = issue.fix_proposal?.action || '?';
  const params = JSON.stringify(issue.fix_proposal?.params || {});
  const severityBadge = issue.severity.toUpperCase();
  return [
    `- [x] **[${severityBadge}]** ${issue.task.name}  ([${issue.task.id}](${issue.task.url}))`,
    `  - Issue: ${issue.description}`,
    `  - Action: \`${action}\` — params: \`${params}\``,
    `  - Inferred from: ${issue.fix_proposal?.inferred_from || 'n/a'}`,
    `  - id: \`${issue.id}\``,
  ].join('\n');
}

export function renderFixPlanMarkdown(plan) {
  if (plan.items.length === 0) {
    return `# Fix Plan — ${plan.fix_date}\n\nNo fixable issues.\n`;
  }
  const grouped = {};
  for (const i of plan.items) {
    (grouped[i.category] ||= []).push(i);
  }

  const lines = [];
  lines.push(`# Fix Plan — ${plan.fix_date}`, '');
  lines.push('> Uncheck an item to skip it during apply. Only checked items are applied.', '');
  lines.push('## Summary', '');
  lines.push(`- Total fixable items: ${plan.items.length}`);
  lines.push(`- Critical: ${plan.totals.critical} | Warning: ${plan.totals.warning} | Info: ${plan.totals.info}`);
  lines.push('- By category: ' + Object.entries(plan.by_category).map(([k, v]) => `${k}=${v}`).join(', '), '');

  for (const cat of CATEGORY_ORDER) {
    const items = grouped[cat];
    if (!items || items.length === 0) continue;
    lines.push(`## ${CATEGORY_TITLE[cat]}`, '');
    for (const i of items) {
      lines.push(renderItem(i), '');
    }
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests — confirm GREEN.**

**Verification:** All 7 tests pass.

---

### Task A9: `reporter.mjs` — write latest.json + report MD (TDD, with sample output verification)

**Files created:**
- `services/sprint-agents/test/validate/reporter.test.mjs`
- `services/sprint-agents/lib/validate/reporter.mjs`

**Why:** Dashboard and Chat alert both consume `latest.json`; the MD report is the human-oriented artefact that gets committed to PMO archive.

**Steps:**

- [ ] **Step 1: Write tests** — `services/sprint-agents/test/validate/reporter.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLatestJson, renderReportMarkdown, writeReports } from '../../lib/validate/reporter.mjs';

const ISSUES = [
  { id: 'a', check_id: 'primary-not-sprint', severity: 'critical', category: 'location',
    task: { id: 'T1', name: 'a', url: 'u1', primary_list: { id: 'L', name: 'L' } },
    description: 'desc', fixable: true,
    fix_proposal: { action: 'move_primary', params: {}, inferred_from: 'x' },
    detected_at: '2026-04-21T08:00:00Z',
    product: 'diemaster' },
  { id: 'b', check_id: 'missing-product', severity: 'warning', category: 'metadata',
    task: { id: 'T2', name: 'b', url: 'u2', primary_list: { id: 'L', name: 'L' } },
    description: 'desc', fixable: false, fix_proposal: null,
    detected_at: '2026-04-21T08:00:00Z',
    product: 'visionking' },
];

test('buildLatestJson aggregates by severity, product, category', () => {
  const data = buildLatestJson({ issues: ISSUES, runId: '2026-04-21T08:00:00Z', totalScanned: 2 });
  assert.equal(data.run_id, '2026-04-21T08:00:00Z');
  assert.equal(data.total_tasks_scanned, 2);
  assert.equal(data.by_severity.critical, 1);
  assert.equal(data.by_severity.warning, 1);
  assert.equal(data.by_product.diemaster, 1);
  assert.equal(data.by_product.visionking, 1);
  assert.equal(data.by_category.location, 1);
  assert.equal(data.by_category.metadata, 1);
  assert.equal(data.issues.length, 2);
});

test('renderReportMarkdown contains summary + per-issue detail', () => {
  const data = buildLatestJson({ issues: ISSUES, runId: '2026-04-21T08:00:00Z', totalScanned: 2 });
  const md = renderReportMarkdown(data, '2026-04-21');
  assert.ok(md.includes('# Validation Report — 2026-04-21'));
  assert.ok(md.includes('critical: 1'));
  assert.ok(md.includes('warning: 1'));
  assert.ok(md.includes('primary-not-sprint'));
  assert.ok(md.includes('missing-product'));
  assert.ok(md.includes('## Critical'));
});

test('writeReports writes all three files to the dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rep-'));
  const data = buildLatestJson({ issues: ISSUES, runId: '2026-04-21T08:00:00Z', totalScanned: 2 });
  writeReports({ data, dir, date: '2026-04-21', fixPlanMarkdown: '# Plan\n' });

  const latest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf-8'));
  assert.equal(latest.total_tasks_scanned, 2);
  const md = readFileSync(join(dir, 'report-2026-04-21.md'), 'utf-8');
  assert.ok(md.startsWith('# Validation Report'));
  const fix = readFileSync(join(dir, 'fix-plan-2026-04-21.md'), 'utf-8');
  assert.equal(fix, '# Plan\n');
});
```

- [ ] **Step 2: Run tests — confirm RED.**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/reporter.mjs`:

```javascript
/**
 * PURE: Build latest.json + render the markdown report. I/O via writeReports.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function buildLatestJson({ issues, runId, totalScanned }) {
  const by_severity = { critical: 0, warning: 0, info: 0 };
  const by_product = {};
  const by_category = {};
  for (const i of issues) {
    by_severity[i.severity] = (by_severity[i.severity] || 0) + 1;
    if (i.product) by_product[i.product] = (by_product[i.product] || 0) + 1;
    by_category[i.category] = (by_category[i.category] || 0) + 1;
  }
  return {
    run_id: runId,
    total_tasks_scanned: totalScanned,
    by_severity,
    by_product,
    by_category,
    issues,
  };
}

const SEV_ORDER = ['critical', 'warning', 'info'];

export function renderReportMarkdown(data, date) {
  const lines = [];
  lines.push(`# Validation Report — ${date}`, '');
  lines.push(`Run id: \`${data.run_id}\``);
  lines.push(`Total tasks scanned: ${data.total_tasks_scanned}`, '');
  lines.push('## Summary', '');
  lines.push(`- Severity: ` + Object.entries(data.by_severity).map(([k,v]) => `${k}: ${v}`).join(', '));
  lines.push(`- Product: ` + Object.entries(data.by_product).map(([k,v]) => `${k}: ${v}`).join(', '));
  lines.push(`- Category: ` + Object.entries(data.by_category).map(([k,v]) => `${k}: ${v}`).join(', '), '');

  for (const sev of SEV_ORDER) {
    const bucket = data.issues.filter(i => i.severity === sev);
    if (bucket.length === 0) continue;
    lines.push(`## ${sev[0].toUpperCase()}${sev.slice(1)}`, '');
    for (const i of bucket) {
      lines.push(`### [${i.check_id}] ${i.task.name}`);
      lines.push(`- Task: [${i.task.id}](${i.task.url})`);
      lines.push(`- Primary list: ${i.task.primary_list?.name || 'n/a'}`);
      lines.push(`- ${i.description}`);
      if (i.fixable) {
        lines.push(`- Fixable: \`${i.fix_proposal.action}\` — ${JSON.stringify(i.fix_proposal.params)}`);
      } else {
        lines.push(`- Fixable: no (manual diagnosis required)`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function writeReports({ data, dir, date, fixPlanMarkdown }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(data, null, 2));
  writeFileSync(join(dir, `report-${date}.md`), renderReportMarkdown(data, date));
  writeFileSync(join(dir, `fix-plan-${date}.md`), fixPlanMarkdown);
}
```

- [ ] **Step 4: Run tests — confirm GREEN.**

**Verification:** All 3 tests pass.

---

### Task A10: `alert-diff.mjs` — compare previous vs current, return new critical (TDD)

**Files created:**
- `services/sprint-agents/test/validate/alert-diff.test.mjs`
- `services/sprint-agents/lib/validate/alert-diff.mjs`

**Why:** Google Chat alert must fire only when the critical set changes — identical critical sets run-over-run should not spam.

**Steps:**

- [ ] **Step 1: Write tests** — `services/sprint-agents/test/validate/alert-diff.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffCritical, shouldAlert, renderAlertMessage } from '../../lib/validate/alert-diff.mjs';

function issue(id, severity = 'critical', overrides = {}) {
  return {
    id, severity, check_id: overrides.check_id || 'primary-not-sprint',
    product: overrides.product || 'visionking',
    task: { id, name: 'n', url: 'u', primary_list: null },
  };
}

test('diffCritical: identical sets → no added, no resolved', () => {
  const prev = [issue('a'), issue('b')];
  const curr = [issue('a'), issue('b')];
  const d = diffCritical(prev, curr);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.resolved, []);
});

test('diffCritical: new critical → added', () => {
  const prev = [issue('a')];
  const curr = [issue('a'), issue('b')];
  const d = diffCritical(prev, curr);
  assert.equal(d.added.length, 1);
  assert.equal(d.added[0].id, 'b');
});

test('diffCritical: resolved critical → resolved list', () => {
  const prev = [issue('a'), issue('b')];
  const curr = [issue('a')];
  const d = diffCritical(prev, curr);
  assert.equal(d.resolved.length, 1);
  assert.equal(d.resolved[0].id, 'b');
});

test('diffCritical: only considers critical severity', () => {
  const prev = [issue('a', 'critical'), issue('x', 'warning')];
  const curr = [issue('a', 'critical'), issue('y', 'warning')];
  const d = diffCritical(prev, curr);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.resolved, []);
});

test('shouldAlert: any added or resolved → true', () => {
  assert.equal(shouldAlert({ added: [issue('a')], resolved: [] }), true);
  assert.equal(shouldAlert({ added: [], resolved: [issue('a')] }), true);
});

test('shouldAlert: nothing added and nothing resolved → false', () => {
  assert.equal(shouldAlert({ added: [], resolved: [] }), false);
});

test('shouldAlert: force flag always true', () => {
  assert.equal(shouldAlert({ added: [], resolved: [] }, { force: true }), true);
});

test('renderAlertMessage has title + per-product breakdown + totals + dashboard link', () => {
  const latest = {
    by_severity: { critical: 3, warning: 45, info: 12 },
    issues: [
      issue('a', 'critical', { product: 'visionking', check_id: 'orphan-task' }),
      issue('b', 'critical', { product: 'spotfusion', check_id: 'github-issue-missing' }),
      issue('c', 'critical', { product: 'diemaster', check_id: 'primary-not-sprint' }),
    ],
  };
  const msg = renderAlertMessage({
    diff: { added: [issue('c')], resolved: [] },
    latest,
    dashboardUrl: 'http://host/dashboard/validation',
    fixPlanRelPath: 'data/validation/fix-plan-2026-04-21.md',
  });
  assert.ok(msg.includes('ClickUp Validator'));
  assert.ok(msg.includes('3 critical'));
  assert.ok(msg.includes('VisionKing'));
  assert.ok(msg.includes('SpotFusion'));
  assert.ok(msg.includes('DieMaster'));
  assert.ok(msg.includes('http://host/dashboard/validation'));
  assert.ok(msg.includes('fix-plan-2026-04-21.md'));
});
```

- [ ] **Step 2: Run tests — confirm RED.**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/alert-diff.mjs`:

```javascript
/**
 * PURE: compute add/resolve delta for critical issues between runs.
 */
const PRODUCT_LABEL = { diemaster: 'DieMaster', spotfusion: 'SpotFusion', visionking: 'VisionKing' };

function onlyCritical(list) {
  return (list || []).filter(i => i.severity === 'critical');
}

export function diffCritical(prevIssues, currIssues) {
  const prevIds = new Set(onlyCritical(prevIssues).map(i => i.id));
  const currIds = new Set(onlyCritical(currIssues).map(i => i.id));
  const added = onlyCritical(currIssues).filter(i => !prevIds.has(i.id));
  const resolved = onlyCritical(prevIssues).filter(i => !currIds.has(i.id));
  return { added, resolved };
}

export function shouldAlert(diff, { force = false } = {}) {
  if (force) return true;
  return (diff.added.length + diff.resolved.length) > 0;
}

export function renderAlertMessage({ diff, latest, dashboardUrl, fixPlanRelPath }) {
  const sev = latest.by_severity || { critical: 0, warning: 0, info: 0 };
  const perProduct = {};
  for (const i of onlyCritical(latest.issues || [])) {
    (perProduct[i.product] ||= []).push(i.check_id);
  }

  const lines = [];
  lines.push(`🚨 ClickUp Validator — ${sev.critical} critical issues`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const [prod, checks] of Object.entries(perProduct)) {
    const label = PRODUCT_LABEL[prod] || prod;
    const counts = {};
    for (const c of checks) counts[c] = (counts[c] || 0) + 1;
    const detail = Object.entries(counts).map(([k,v]) => v > 1 ? `${k} x${v}` : k).join(', ');
    lines.push(`• ${label}: ${checks.length} critical (${detail})`);
  }
  lines.push('');
  lines.push(`Total: ${sev.critical} critical | ${sev.warning} warnings | ${sev.info} info`);
  if (diff.added.length > 0) lines.push(`New this run: ${diff.added.length}`);
  if (diff.resolved.length > 0) lines.push(`Resolved this run: ${diff.resolved.length}`);
  lines.push('');
  lines.push(`Review: ${dashboardUrl}`);
  lines.push(`Fix plan: ${fixPlanRelPath}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests — confirm GREEN.**

**Verification:** All 8 tests pass.

---

### Task A11: `fix-applier.mjs` — read fix-plan, apply via ClickUp API (integration)

**Files created:**
- `services/sprint-agents/lib/validate/fix-applier.mjs`
- `services/sprint-agents/test/validate/fix-applier.test.mjs` (integration — mocked client)

**Why:** The only module that calls ClickUp write APIs. Keeps all mutation logic in one place. Respects a `selected` filter (from dashboard) and logs each operation to `fix-applied-history.json`.

**Steps:**

- [ ] **Step 1: Write integration tests** — `services/sprint-agents/test/validate/fix-applier.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFixes } from '../../lib/validate/fix-applier.mjs';

function mockClient() {
  const calls = [];
  return {
    calls,
    async updateTask(id, payload) { calls.push({ m: 'updateTask', id, payload }); return {}; },
    async setCustomField(id, fieldId, value) { calls.push({ m: 'setCustomField', id, fieldId, value }); return {}; },
    async addTaskToList(listId, taskId) { calls.push({ m: 'addTaskToList', listId, taskId }); return {}; },
    async moveTaskPrimary(taskId, listId) { calls.push({ m: 'moveTaskPrimary', taskId, listId }); return {}; },
  };
}

const PLAN = {
  fix_date: '2026-04-21',
  items: [
    { id: 'T1::primary-not-sprint', check_id: 'primary-not-sprint',
      task: { id: 'T1', name: 'a', url: 'u' }, severity: 'critical', category: 'location',
      fix_proposal: { action: 'move_primary', params: { target_list_id: 'L1' }, inferred_from: 'x' },
      fixable: true },
    { id: 'T2::missing-product', check_id: 'missing-product',
      task: { id: 'T2', name: 'b', url: 'u' }, severity: 'warning', category: 'metadata',
      fix_proposal: { action: 'set_custom_field', params: { field_id: 'prod', value: 'visionking' } },
      fixable: true },
    { id: 'T3::missing-dates-in-sprint', check_id: 'missing-dates-in-sprint',
      task: { id: 'T3', name: 'c', url: 'u' }, severity: 'warning', category: 'metadata',
      fix_proposal: { action: 'set_dates', params: { start_date: '100', due_date: '200' } },
      fixable: true },
    { id: 'T4::closed-sprint-open-tasks', check_id: 'closed-sprint-open-tasks',
      task: { id: 'T4', name: 'd', url: 'u' }, severity: 'warning', category: 'location',
      fix_proposal: { action: 'move_to_next_sprint', params: { from_sprint_id: 'SP1', product: 'visionking' } },
      fixable: true },
    { id: 'T5::storm-duplicate-not-closed', check_id: 'storm-duplicate-not-closed',
      task: { id: 'T5', name: 'e', url: 'u' }, severity: 'warning', category: 'github-sync',
      fix_proposal: { action: 'close_task_as_not_planned', params: {} },
      fixable: true },
  ],
};

test('applyFixes dispatches per action + returns per-item result', async () => {
  const client = mockClient();
  const ctx = { nextSprintResolver: async () => 'L-NEXT' };
  const { results } = await applyFixes({ plan: PLAN, client, ctx, selected: null, history: { applied: [] } });
  assert.equal(results.length, 5);
  assert.ok(results.every(r => r.result === 'success'));
  const ops = client.calls.map(c => c.m);
  assert.ok(ops.includes('moveTaskPrimary'));
  assert.ok(ops.includes('setCustomField'));
  assert.ok(ops.includes('updateTask'));
  assert.ok(ops.includes('addTaskToList'));
});

test('applyFixes respects selected filter', async () => {
  const client = mockClient();
  const selected = new Set(['T1::primary-not-sprint']);
  const { results } = await applyFixes({ plan: PLAN, client, ctx: {}, selected, history: { applied: [] } });
  assert.equal(results.length, 1);
  assert.equal(results[0].issue_id, 'T1::primary-not-sprint');
});

test('applyFixes skips items already in history', async () => {
  const client = mockClient();
  const history = { applied: [{ issue_id: 'T1::primary-not-sprint', task_id: 'T1', action: 'move_primary', params: {}, applied_at: 'x', result: 'success' }] };
  const { results } = await applyFixes({ plan: PLAN, client, ctx: {}, selected: null, history });
  assert.ok(results.every(r => r.issue_id !== 'T1::primary-not-sprint'));
});

test('applyFixes records failures without stopping', async () => {
  const client = mockClient();
  client.moveTaskPrimary = async () => { throw new Error('API exploded'); };
  const { results } = await applyFixes({ plan: PLAN, client, ctx: { nextSprintResolver: async () => 'L-NEXT' }, selected: null, history: { applied: [] } });
  const byId = Object.fromEntries(results.map(r => [r.issue_id, r]));
  assert.equal(byId['T1::primary-not-sprint'].result, 'error');
  assert.ok(byId['T1::primary-not-sprint'].error_message.includes('API exploded'));
  assert.equal(byId['T2::missing-product'].result, 'success');
});
```

- [ ] **Step 2: Run tests — confirm RED.**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/fix-applier.mjs`:

```javascript
/**
 * INTEGRATION: Apply fix proposals via ClickUp API.
 * Takes an injected `client` (the default real client adapts clickup-client.mjs).
 */
import {
  updateTask as cuUpdate,
  setCustomField as cuSetField,
  addTaskToList as cuAddToList,
} from '../clickup-client.mjs';

// v3 "home_list" move for primary-location change (no helper in v2 client)
async function moveTaskPrimaryV3(taskId, listId) {
  const https = await import('node:https');
  const token = process.env.CLICKUP_TOKEN;
  const workspaceId = process.env.CLICKUP_WORKSPACE_ID || '3081126';
  return await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.clickup.com',
      path: `/api/v3/workspaces/${workspaceId}/tasks/${taskId}/home_list/${listId}`,
      method: 'PUT',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`home_list ${res.statusCode}: ${data.slice(0, 200)}`));
        else resolve(data ? JSON.parse(data) : {});
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export function defaultClient() {
  return {
    updateTask: cuUpdate,
    setCustomField: cuSetField,
    addTaskToList: cuAddToList,
    moveTaskPrimary: moveTaskPrimaryV3,
  };
}

async function applyItem(item, client, ctx) {
  const action = item.fix_proposal?.action;
  const p = item.fix_proposal?.params || {};
  switch (action) {
    case 'move_primary':
      return client.moveTaskPrimary(item.task.id, p.target_list_id);
    case 'set_custom_field':
      return client.setCustomField(item.task.id, p.field_id, p.value);
    case 'set_dates':
      return client.updateTask(item.task.id, { start_date: p.start_date, due_date: p.due_date });
    case 'move_to_next_sprint': {
      const nextId = ctx.nextSprintResolver
        ? await ctx.nextSprintResolver({ from_sprint_id: p.from_sprint_id, product: p.product })
        : null;
      if (!nextId) throw new Error('No next sprint resolvable');
      return client.addTaskToList(nextId, item.task.id);
    }
    case 'close_task_as_not_planned':
      return client.updateTask(item.task.id, { status: 'closed' });
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export async function applyFixes({ plan, client = defaultClient(), ctx = {}, selected = null, history = { applied: [] } }) {
  const alreadyApplied = new Set((history.applied || []).map(h => h.issue_id));
  const selectedSet = selected instanceof Set ? selected : (selected ? new Set(selected) : null);

  const targets = plan.items.filter(i => {
    if (alreadyApplied.has(i.id)) return false;
    if (selectedSet && !selectedSet.has(i.id)) return false;
    return i.fixable;
  });

  const results = [];
  for (const item of targets) {
    const record = {
      issue_id: item.id,
      task_id: item.task.id,
      action: item.fix_proposal?.action,
      params: item.fix_proposal?.params,
      applied_at: new Date().toISOString(),
      result: 'success',
    };
    try {
      await applyItem(item, client, ctx);
    } catch (err) {
      record.result = 'error';
      record.error_message = err.message;
    }
    results.push(record);
  }

  return { results };
}
```

- [ ] **Step 4: Run tests — confirm GREEN.**

**Verification:** All 4 integration tests pass.

---

### Task A12: `run-validate.mjs` — CLI orchestrator (tie everything together)

**Files created:**
- `services/sprint-agents/run-validate.mjs`
- `services/sprint-agents/lib/validate/pipeline.mjs` (shared orchestration used by both CLIs)

**Why:** Tie config, client, scanner, checks, reporter, alert together. Pipeline is extracted so `run-validate-apply.mjs` can reuse the context build.

**Steps:**

- [ ] **Step 1: Write `services/sprint-agents/lib/validate/pipeline.mjs`:**

```javascript
/**
 * Orchestration: scan tasks, build context, run checks, write artefacts.
 * No LLM. No external calls other than ClickUp GETs.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFolder, getAllListTasks, getTask } from '../clickup-client.mjs';
import { loadRules } from './rules.mjs';
import { loadPrefixMapping } from './inference.mjs';
import { CHECKS as LOCATION_CHECKS } from './checks/location.mjs';
import { CHECKS as METADATA_CHECKS } from './checks/metadata.mjs';
import { CHECKS as STATUS_CHECKS } from './checks/status.mjs';
import { CHECKS as GITHUB_CHECKS } from './checks/github-sync.mjs';
import { buildFixPlan, appliedIdsFromHistory, renderFixPlanMarkdown } from './fix-planner.mjs';
import { buildLatestJson, writeReports } from './reporter.mjs';
import { diffCritical, shouldAlert, renderAlertMessage } from './alert-diff.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = join(__dirname, '..', '..');

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return fallback; }
}

function loadProjectCodes(pmoRoot) {
  try {
    return readJson(join(pmoRoot, 'config/project-codes.json'), {});
  } catch { return {}; }
}

export async function scanClickUp({ config }) {
  const productFolders = new Map();
  const listMap = new Map();
  const sprintMap = new Map();
  const allTasksById = new Map();

  for (const [product, pcfg] of Object.entries(config.products)) {
    productFolders.set(pcfg.task_folder_id, product);
    productFolders.set(pcfg.sprint_folder_id, product);

    const taskFolder = await getFolder(pcfg.task_folder_id);
    for (const l of taskFolder.lists || []) {
      listMap.set(l.id, { id: l.id, name: l.name, folder_id: pcfg.task_folder_id, product });
    }

    const sprintFolder = await getFolder(pcfg.sprint_folder_id);
    for (const l of sprintFolder.lists || []) {
      listMap.set(l.id, { id: l.id, name: l.name, folder_id: pcfg.sprint_folder_id, product });
      sprintMap.set(l.id, {
        id: l.id,
        name: l.name,
        start_date: l.start_date,
        due_date: l.due_date,
        status: (l.archived || l.status?.status === 'closed') ? 'closed' : 'open',
        product,
      });
    }
  }

  // Fetch all tasks from every task-folder list + every sprint list (union, dedupe).
  for (const [listId, list] of listMap.entries()) {
    const tasks = await getAllListTasks(listId);
    for (const t of tasks) {
      // We need task.locations for primary-not-sprint; ClickUp shallow list query
      // returns tasks where the list is primary. Secondary locations require a
      // follow-up GET /task/{id}. To bound cost, only hydrate tasks whose primary
      // is a sprint or whose folder doesn't match (candidate violations).
      allTasksById.set(t.id, { ...t, _seen_from_list: listId });
    }
  }

  // Hydrate tasks whose primary is a sprint (for location checks)
  const toHydrate = [...allTasksById.values()].filter(t => sprintMap.has(t.list?.id));
  for (let i = 0; i < toHydrate.length; i += 5) {
    const batch = toHydrate.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(t => getTask(t.id)));
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') allTasksById.set(batch[j].id, r.value);
    }
  }

  return { productFolders, listMap, sprintMap, allTasksById };
}

export function runChecks({ tasks, context }) {
  const all = [...LOCATION_CHECKS, ...METADATA_CHECKS, ...STATUS_CHECKS, ...GITHUB_CHECKS];
  const issues = [];
  for (const task of tasks) {
    const product = context.listMap.get(task.list?.id)?.product || null;
    for (const { fn } of all) {
      let produced = [];
      try { produced = fn(task, context); } catch (err) {
        produced = [];
        console.error(`[validate] check ${fn.name} threw for task ${task.id}: ${err.message}`);
      }
      for (const p of produced) {
        p.product = product;
        issues.push(p);
      }
    }
  }
  return issues;
}

export async function runValidate({ config, dataDir, date, force = false }) {
  const rulesPath = join(SERVICE_ROOT, 'config/validation-rules.json');
  const prefixPath = join(SERVICE_ROOT, 'config/prefix-mapping.json');
  const rules = loadRules({ path: rulesPath });
  const prefixMapping = loadPrefixMapping(prefixPath);
  const pmoRoot = existsSync(config.pmo_readonly) ? config.pmo_readonly
    : join(process.env.HOME || '/home/teruel', 'JARVIS/workspaces/strokmatic/pmo');
  const projectCodes = loadProjectCodes(pmoRoot);

  const runId = new Date().toISOString();
  const { productFolders, listMap, sprintMap, allTasksById } = await scanClickUp({ config });
  const tasks = [...allTasksById.values()];

  // GitHub state — placeholder: v1 relies on custom-field consistency, not live API.
  const githubState = { issuesByUrl: new Map() };

  const context = {
    rules, prefixMapping, projectCodes,
    listMap, sprintMap, productFolders,
    allTasks: allTasksById,
    customFieldIds: config.custom_fields,
    taskLaneLabels: new Map(Object.entries(config.task_lane_labels || {})),
    productOptionMap: {},
    githubState,
    now: Date.now(),
  };

  const issues = runChecks({ tasks, context });
  const data = buildLatestJson({ issues, runId, totalScanned: tasks.length });

  const history = readJson(join(dataDir, 'fix-applied-history.json'), { applied: [] });
  const applied = appliedIdsFromHistory(history);
  const plan = buildFixPlan({ issues, applied, date });
  const fixPlanMd = renderFixPlanMarkdown(plan);

  // Archive previous plan (if any) before overwrite.
  const prevPlan = readdirSync(dataDir, { withFileTypes: false })
    .filter(f => /^fix-plan-\d{4}-\d{2}-\d{2}\.md$/.test(f) && f !== `fix-plan-${date}.md`);
  if (prevPlan.length > 0) {
    const archive = join(dataDir, 'plans-archive');
    mkdirSync(archive, { recursive: true });
    for (const f of prevPlan) {
      const src = join(dataDir, f);
      const dst = join(archive, f);
      writeFileSync(dst, readFileSync(src, 'utf-8'));
    }
  }

  writeReports({ data, dir: dataDir, date, fixPlanMarkdown: fixPlanMd });

  // Alert
  const previousLatest = readJson(join(dataDir, 'latest.prev.json'), { issues: [] });
  const diff = diffCritical(previousLatest.issues || [], issues);
  const alertMsg = renderAlertMessage({
    diff,
    latest: data,
    dashboardUrl: config.validation?.dashboard_url || 'http://localhost:8091/dashboard/validation',
    fixPlanRelPath: `data/validation/fix-plan-${date}.md`,
  });
  const willAlert = shouldAlert(diff, { force });

  // Copy latest.json → latest.prev.json so next run can diff.
  writeFileSync(join(dataDir, 'latest.prev.json'), JSON.stringify(data));

  return { data, diff, alertMsg, willAlert, plan };
}
```

- [ ] **Step 2: Write `services/sprint-agents/run-validate.mjs`:**

```javascript
#!/usr/bin/env node
/**
 * CLI: run validation pipeline, write artefacts, optionally send Chat alert.
 *
 * Usage: node run-validate.mjs [--force-alert]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { runValidate } from './lib/validate/pipeline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CONFIG_PATH || join(__dirname, 'config/service.json');
const DATA_DIR = join(__dirname, 'data', 'validation');
const KEY_PATH = process.env.GCP_SERVICE_ACCOUNT_KEY
  || (process.env.HOME ? join(process.env.HOME, '.secrets/gcp-service-account.json') : null)
  || '/home/strokmatic/.secrets/gcp-service-account.json';

const args = process.argv.slice(2);
const force = args.includes('--force-alert');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const date = new Date().toISOString().slice(0, 10);

async function sendChatAlert(spaceId, text) {
  const credentials = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/chat.bot'],
  });
  const chat = google.chat({ version: 'v1', auth });
  await chat.spaces.messages.create({ parent: spaceId, requestBody: { text } });
}

try {
  const { data, alertMsg, willAlert } = await runValidate({ config, dataDir: DATA_DIR, date, force });
  console.log(`[validate] ${data.total_tasks_scanned} tasks scanned`);
  console.log(`[validate] ${data.by_severity.critical} critical, ${data.by_severity.warning} warnings, ${data.by_severity.info} info`);

  if (willAlert && config.chat_alert_space) {
    try {
      await sendChatAlert(config.chat_alert_space, alertMsg);
      console.log('[validate] chat alert sent');
    } catch (err) {
      console.error(`[validate] chat alert failed: ${err.message}`);
    }
  } else {
    console.log('[validate] alert skipped (no change)');
  }
} catch (err) {
  console.error(`[validate] fatal: ${err.message}`);
  process.exit(1);
}
```

**Verification:**
- [ ] `node -c services/sprint-agents/run-validate.mjs` (syntax OK — there is no `-c` for ESM, so: `node --check services/sprint-agents/run-validate.mjs`)
- [ ] Dry read: `CLICKUP_TOKEN=fake node -e "import('./services/sprint-agents/lib/validate/pipeline.mjs').then(m => console.log(Object.keys(m)))"` — exports are visible.

---

### Task A13: `run-validate-apply.mjs` — CLI apply orchestrator

**Files created:**
- `services/sprint-agents/run-validate-apply.mjs`
- `services/sprint-agents/lib/validate/plan-parser.mjs` (parse the current fix-plan.md to respect human-edited checkboxes)
- `services/sprint-agents/test/validate/plan-parser.test.mjs`

**Why:** Reads the *current* fix-plan.md, cross-references the selected issue ids from the CLI, applies only those, then writes a `fix-applied-{date}.md` summary and appends to `fix-applied-history.json`.

**Steps:**

- [ ] **Step 1: Tests for `plan-parser.mjs`** — `services/sprint-agents/test/validate/plan-parser.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFixPlanMarkdown } from '../../lib/validate/plan-parser.mjs';

const MD = `# Fix Plan — 2026-04-21

## Summary
Total: 3

## Location fixes

- [x] **[CRITICAL]** iris-gvt: test ([T1](https://clickup/T1))
  - Issue: Primary is sprint
  - Action: \`move_primary\` — params: \`{}\`
  - id: \`T1::primary-not-sprint\`

- [ ] **[WARNING]** x ([T2](https://clickup/T2))
  - Issue: x
  - Action: \`set_custom_field\` — params: \`{}\`
  - id: \`T2::missing-product\`

## Metadata fixes

- [x] **[WARNING]** y ([T3](https://clickup/T3))
  - Action: \`set_dates\` — params: \`{}\`
  - id: \`T3::missing-dates-in-sprint\`
`;

test('parseFixPlanMarkdown returns set of checked issue ids', () => {
  const out = parseFixPlanMarkdown(MD);
  assert.ok(out.checked.has('T1::primary-not-sprint'));
  assert.ok(out.checked.has('T3::missing-dates-in-sprint'));
  assert.equal(out.checked.has('T2::missing-product'), false);
});

test('parseFixPlanMarkdown returns all ids regardless of checked state', () => {
  const out = parseFixPlanMarkdown(MD);
  assert.equal(out.all.size, 3);
});

test('parseFixPlanMarkdown returns empty sets for empty plan', () => {
  const out = parseFixPlanMarkdown('# Fix Plan\n\nNo fixable issues.\n');
  assert.equal(out.checked.size, 0);
  assert.equal(out.all.size, 0);
});
```

- [ ] **Step 2: Run — confirm RED.**

- [ ] **Step 3: Implement** — `services/sprint-agents/lib/validate/plan-parser.mjs`:

```javascript
/**
 * PURE: parse checkbox states from a fix-plan markdown file.
 */
export function parseFixPlanMarkdown(md) {
  const checked = new Set();
  const all = new Set();
  const lines = md.split('\n');
  let lastChecked = null;
  for (const line of lines) {
    const box = /^- \[(x| )\]/.exec(line);
    if (box) {
      lastChecked = box[1] === 'x';
      continue;
    }
    const idMatch = /^  - id: `([^`]+)`$/.exec(line);
    if (idMatch) {
      const id = idMatch[1];
      all.add(id);
      if (lastChecked) checked.add(id);
      lastChecked = null;
    }
  }
  return { checked, all };
}
```

- [ ] **Step 4: Run — confirm GREEN.**

- [ ] **Step 5: Write `services/sprint-agents/run-validate-apply.mjs`:**

```javascript
#!/usr/bin/env node
/**
 * CLI: apply fixes from a fix-plan.md file.
 *
 * Usage:
 *   node run-validate-apply.mjs <fix_date> [--selected=id1,id2,...]
 *
 * Rules:
 *   - The fix_date must be the LATEST plan — rejects stale plans.
 *   - `--selected` narrows apply to a subset (from dashboard POST).
 *   - Writes fix-applied-{date}.md + appends to fix-applied-history.json.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runValidate } from './lib/validate/pipeline.mjs';
import { applyFixes, defaultClient } from './lib/validate/fix-applier.mjs';
import { parseFixPlanMarkdown } from './lib/validate/plan-parser.mjs';
import { getFolder } from './lib/clickup-client.mjs';
import { findCurrentSprint } from './lib/sprint-detector.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CONFIG_PATH || join(__dirname, 'config/service.json');
const DATA_DIR = join(__dirname, 'data', 'validation');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

const args = process.argv.slice(2);
const fixDate = args[0];
const selectedArg = args.find(a => a.startsWith('--selected='));
if (!fixDate) {
  console.error('Usage: node run-validate-apply.mjs <YYYY-MM-DD> [--selected=id1,id2]');
  process.exit(1);
}
const selected = selectedArg
  ? new Set(selectedArg.replace('--selected=', '').split(',').filter(Boolean))
  : null;

function latestPlanDate(dir) {
  if (!existsSync(dir)) return null;
  const dates = readdirSync(dir)
    .map(f => /^fix-plan-(\d{4}-\d{2}-\d{2})\.md$/.exec(f)?.[1])
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

const latest = latestPlanDate(DATA_DIR);
if (!latest) { console.error('[apply] no fix-plan found'); process.exit(1); }
if (latest !== fixDate) {
  console.error(`[apply] fix-plan-${fixDate}.md is stale. Latest: fix-plan-${latest}.md. Review and apply the latest.`);
  process.exit(2);
}

const planPath = join(DATA_DIR, `fix-plan-${fixDate}.md`);
const planMd = readFileSync(planPath, 'utf-8');
const { checked, all } = parseFixPlanMarkdown(planMd);

// Merge dashboard-selection with checkbox state. Intersection wins.
let effective = checked;
if (selected) {
  effective = new Set([...checked].filter(id => selected.has(id)));
}

// Rebuild the in-memory plan by running validate fresh.
const { plan } = await runValidate({ config, dataDir: DATA_DIR, date: fixDate, force: false });

// Next-sprint resolver (for move_to_next_sprint action).
async function nextSprintResolver({ from_sprint_id, product }) {
  const pcfg = config.products[product];
  if (!pcfg) return null;
  const folder = await getFolder(pcfg.sprint_folder_id);
  const lists = (folder.lists || [])
    .filter(l => l.start_date && l.due_date)
    .sort((a, b) => parseInt(a.start_date) - parseInt(b.start_date));
  const idx = lists.findIndex(l => l.id === from_sprint_id);
  if (idx < 0 || idx === lists.length - 1) return null;
  return lists[idx + 1].id;
}

const history = existsSync(join(DATA_DIR, 'fix-applied-history.json'))
  ? JSON.parse(readFileSync(join(DATA_DIR, 'fix-applied-history.json'), 'utf-8'))
  : { applied: [] };

const client = defaultClient();
const { results } = await applyFixes({ plan, client, ctx: { nextSprintResolver }, selected: effective, history });

// Persist history
history.applied = [...(history.applied || []), ...results];
writeFileSync(join(DATA_DIR, 'fix-applied-history.json'), JSON.stringify(history, null, 2));

// Write applied.md summary
const applied = results.filter(r => r.result === 'success').length;
const failed = results.filter(r => r.result === 'error');
const mdLines = [
  `# Fix Applied — ${fixDate}`,
  '',
  `- Applied: ${applied}`,
  `- Failed: ${failed.length}`,
  `- Run: ${new Date().toISOString()}`,
  '',
];
for (const r of results) {
  mdLines.push(`- [${r.result}] \`${r.action}\` task=${r.task_id} issue=${r.issue_id}${r.error_message ? ` — ${r.error_message}` : ''}`);
}
writeFileSync(join(DATA_DIR, `fix-applied-${fixDate}.md`), mdLines.join('\n') + '\n');

console.log(`[apply] ${applied} applied, ${failed.length} failed. Summary: fix-applied-${fixDate}.md`);
process.exit(failed.length > 0 ? 3 : 0);
```

**Verification:**
- [ ] `node --check services/sprint-agents/run-validate-apply.mjs`
- [ ] `node --check services/sprint-agents/lib/validate/plan-parser.mjs`
- [ ] Tests: `node --test services/sprint-agents/test/validate/plan-parser.test.mjs`

---

### Task A14: `run.sh` — add `validate` and `validate-apply` modes

**Files modified:**
- `services/sprint-agents/run.sh`

**Why:** Cron and operators invoke the service via `run.sh`. Each mode must be independently lockable so they do not clobber one another.

**Steps:**

- [ ] **Step 1: Update `run.sh`** — replace the `case` block:

```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-fields}"
LOG_FILE="$SCRIPT_DIR/logs/run-$(date -u +%Y-%m-%d).log"
mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/data" "$SCRIPT_DIR/data/validation"

# Load ClickUp token
if [[ -f /opt/github-clickup-sync/.env ]]; then
  set -a
  source <(grep -v '^\s*#' /opt/github-clickup-sync/.env | grep -v '^\s*$')
  set +a
fi

LOCK_FILE="$SCRIPT_DIR/data/run-${MODE}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date -u +%FT%TZ)] sprint-agents ${MODE}: previous run in flight" >> "$LOG_FILE"
  exit 0
fi

{
  echo "[$(date -u +%FT%TZ)] sprint-agents ${MODE}: starting"
  case "$MODE" in
    fields)         node run-fields.mjs ;;
    followup)       node run-followup.mjs ;;
    plan)           node run-plan.mjs "${2:-}" "${3:-current}" ;;
    validate)       node run-validate.mjs "${@:2}" ;;
    validate-apply) node run-validate-apply.mjs "${@:2}" ;;
    *)              echo "Unknown mode: $MODE"; exit 1 ;;
  esac
  echo "[$(date -u +%FT%TZ)] sprint-agents ${MODE}: done (exit $?)"
} >> "$LOG_FILE" 2>&1
```

- [ ] **Step 2: Update `package.json` scripts:**

```json
{
  "scripts": {
    "test":           "node --test test/",
    "fields":         "node run-fields.mjs",
    "followup":       "node run-followup.mjs",
    "plan":           "node run-plan.mjs",
    "validate":       "node run-validate.mjs",
    "validate-apply": "node run-validate-apply.mjs"
  }
}
```

**Verification:**
- [ ] `bash -n services/sprint-agents/run.sh`
- [ ] `./services/sprint-agents/run.sh validate --force-alert` returns non-zero only if ClickUp creds are missing (expected in dev).

---

### Task A15: cron entry — add to `setup-cron.sh`

**Files modified:**
- `services/sprint-agents/deploy.sh` (or `services/sprint-agents/setup-cron.sh` if that's the current convention — whichever exists)

**Steps:**

- [ ] **Find the cron-setup file** — `services/sprint-agents/deploy.sh` is the canonical deploy script.
- [ ] **Add** a new cron entry block to the installed crontab section:

```bash
# Daily validator at 07:30 UTC (before 08:00 followup)
( crontab -l 2>/dev/null | grep -v 'sprint-agents.*validate'; \
  echo '30 7 * * * bash /opt/jarvis-sprint-agents/run.sh validate >> /opt/jarvis-sprint-agents/logs/cron.log 2>&1' \
) | crontab -
```

Ensure the existing cron-setup logic preserves `fields` and `followup` entries — only add the validator entry.

**Verification:**
- [ ] On deploy target: `crontab -l | grep validate` shows the new line.

---

### Task A16: smoke test against current ClickUp state (manual)

**Goal:** Run `node run-validate.mjs` once in a worktree-local environment, eyeball the generated `latest.json` + `fix-plan-{date}.md`, tweak obvious false positives before Phase B.

**Steps:**

- [ ] **Step 1: Export tokens:**

```bash
export CLICKUP_TOKEN="$(grep CLICKUP_TOKEN /opt/github-clickup-sync/.env | cut -d= -f2)"
export CLICKUP_WORKSPACE_ID=3081126
```

- [ ] **Step 2: Run:**

```bash
cd /home/teruel/worktrees/infra-clickup-validator/services/sprint-agents
node run-validate.mjs
```

- [ ] **Step 3: Inspect artefacts:**

```bash
ls -la data/validation/
jq '.by_severity, .by_product, .by_category' data/validation/latest.json
head -60 data/validation/fix-plan-$(date -u +%Y-%m-%d).md
```

- [ ] **Step 4: Triage false positives.** Common v1 culprits:
  - Checks firing on archived-but-still-present tasks → add `include_closed=false` filter
  - `project-folder-match` confused by product option uuids → wire `productOptionMap` resolver
  - `github-issue-missing` firing for every Software task → v1 runs without live GitHub state; ensure the check shortcuts when `githubState.issuesByUrl.size === 0` (add guard in `checks/github-sync.mjs`).

- [ ] **Step 5: Record smoke findings** in the PR description for Task A17.

---

### Task A17: commit + push Phase A branch

**Goal:** Clean commit of the backend with passing tests.

**Steps:**

- [ ] **Step 1: Run full test suite:**

```bash
cd /home/teruel/worktrees/infra-clickup-validator/services/sprint-agents
node --test test/
```

- [ ] **Step 2: Scan for accidental secrets:**

```bash
git -C /home/teruel/worktrees/infra-clickup-validator diff --cached | grep -i -E '(api.?key|secret|token|password)' || echo ok
```

- [ ] **Step 3: Verify branch and status:**

```bash
git -C /home/teruel/worktrees/infra-clickup-validator branch --show-current  # feature/clickup-task-validator
git -C /home/teruel/worktrees/infra-clickup-validator status
```

- [ ] **Step 4: Stage files explicitly (no `git add -A`):**

```bash
cd /home/teruel/worktrees/infra-clickup-validator
git add services/sprint-agents/config/validation-rules.json
git add services/sprint-agents/config/prefix-mapping.json
git add services/sprint-agents/config/service.json
git add services/sprint-agents/.gitignore
git add services/sprint-agents/lib/validate/
git add services/sprint-agents/test/validate/
git add services/sprint-agents/run-validate.mjs
git add services/sprint-agents/run-validate-apply.mjs
git add services/sprint-agents/run.sh
git add services/sprint-agents/package.json
git add services/sprint-agents/deploy.sh
```

- [ ] **Step 5: Commit with conventional message:**

```bash
git commit -m "$(cat <<'EOF'
feat(sprint-agents): add clickup-task-validator mode (18 checks + fix-planner)

- New `validate` and `validate-apply` modes in run.sh.
- 18 pure checks across location/metadata/status/github-sync categories.
- Config-driven rules (validation-rules.json) + prefix inference mapping.
- JSON + Markdown reports, fix-plan with editable checkboxes.
- Google Chat alert with delta-aware deduplication.
- Latest-only-apply rule + fix-applied history for idempotency.
- 60+ tests under test/validate/.

Refs: docs/superpowers/specs/2026-04-21-clickup-task-validator-design.md
EOF
)"
```

- [ ] **Step 6: Push branch:**

```bash
git push -u origin feature/clickup-task-validator
```

- [ ] **Step 7: Open a PR stub (wait to merge until Phase B lands on same branch):**

```bash
gh pr create --draft --title "feat: clickup-task-validator (backend + dashboard)" \
  --body "Phase A: sprint-agents backend. Phase B (knowledge-hub dashboard) pending."
```

**Verification:** PR opened in draft; all 60+ tests passing in CI.

---

## Phase B — knowledge-hub dashboard integration (8 tasks)

All Phase B tasks live on the **same** `feature/clickup-task-validator` branch in the same worktree (the infra repo houses both `sprint-agents` and `knowledge-hub`).

### Task B1: `validation-proxy.mjs` — file reader + CLI spawner (TDD)

**Files created:**
- `services/knowledge-hub/lib/validation-proxy.mjs`
- `services/knowledge-hub/test/validation-proxy.test.mjs`

**Why:** The knowledge-hub server must not re-implement ClickUp scanning; it only reads the files written by sprint-agents and spawns `run-validate-apply.mjs`. Single module keeps the bridge explicit.

**Steps:**

- [ ] **Step 1: Tests** — `services/knowledge-hub/test/validation-proxy.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLatest, listHistory, readPlan, spawnApply, getApplyStatus } from '../lib/validation-proxy.mjs';

function setupFiles() {
  const dir = mkdtempSync(join(tmpdir(), 'vp-'));
  writeFileSync(join(dir, 'latest.json'), JSON.stringify({ run_id: 'x', by_severity: { critical: 1 }, issues: [] }));
  writeFileSync(join(dir, 'report-2026-04-21.md'), '# report');
  writeFileSync(join(dir, 'fix-plan-2026-04-21.md'), '# fix plan 21');
  writeFileSync(join(dir, 'fix-plan-2026-04-20.md'), '# fix plan 20');
  mkdirSync(join(dir, 'plans-archive'), { recursive: true });
  return dir;
}

test('readLatest returns parsed JSON', () => {
  const dir = setupFiles();
  const l = readLatest({ dataDir: dir });
  assert.equal(l.run_id, 'x');
});

test('readLatest returns null when missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-'));
  assert.equal(readLatest({ dataDir: dir }), null);
});

test('listHistory returns sorted dates descending', () => {
  const dir = setupFiles();
  const h = listHistory({ dataDir: dir });
  assert.deepEqual(h.map(e => e.date), ['2026-04-21', '2026-04-20']);
  assert.equal(h[0].hasReport, true);
});

test('readPlan returns the markdown + parsed checkboxes', () => {
  const dir = setupFiles();
  writeFileSync(join(dir, 'fix-plan-2026-04-21.md'),
    '# Fix Plan\n- [x] item\n  - id: `a::b`\n');
  const p = readPlan({ dataDir: dir, date: '2026-04-21' });
  assert.equal(p.date, '2026-04-21');
  assert.ok(p.markdown.includes('Fix Plan'));
  assert.ok(p.checked.has('a::b'));
});

test('spawnApply records a new job and returns {job_id, started_at}', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-'));
  const jobsDir = join(dir, 'jobs'); mkdirSync(jobsDir, { recursive: true });
  const res = spawnApply({
    fixDate: '2026-04-21',
    selected: ['a::b'],
    jobsDir,
    spawner: (args) => ({ pid: 9999, args }),
  });
  assert.match(res.job_id, /^[a-f0-9-]+$/);
  assert.ok(res.started_at);
  const status = getApplyStatus({ jobsDir, jobId: res.job_id });
  assert.equal(status.state, 'running');
});
```

- [ ] **Step 2: Run — RED.**

- [ ] **Step 3: Implement** — `services/knowledge-hub/lib/validation-proxy.mjs`:

```javascript
/**
 * Proxy module: reads artefacts written by sprint-agents validator and
 * spawns the apply CLI. No ClickUp access here.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseFixPlanMarkdown } from '../../sprint-agents/lib/validate/plan-parser.mjs';

export function readLatest({ dataDir }) {
  const p = join(dataDir, 'latest.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

export function listHistory({ dataDir }) {
  if (!existsSync(dataDir)) return [];
  const files = readdirSync(dataDir);
  const map = new Map();
  for (const f of files) {
    const m = /^(report|fix-plan|fix-applied)-(\d{4}-\d{2}-\d{2})\.md$/.exec(f);
    if (!m) continue;
    const [, kind, date] = m;
    const entry = map.get(date) || { date, hasReport: false, hasPlan: false, hasApplied: false };
    if (kind === 'report') entry.hasReport = true;
    if (kind === 'fix-plan') entry.hasPlan = true;
    if (kind === 'fix-applied') entry.hasApplied = true;
    map.set(date, entry);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function readPlan({ dataDir, date }) {
  const p = join(dataDir, `fix-plan-${date}.md`);
  if (!existsSync(p)) return null;
  const markdown = readFileSync(p, 'utf-8');
  const { checked, all } = parseFixPlanMarkdown(markdown);
  return { date, markdown, checked, all };
}

export function spawnApply({ fixDate, selected, jobsDir, cliPath = null, spawner = null }) {
  mkdirSync(jobsDir, { recursive: true });
  const jobId = randomUUID();
  const startedAt = new Date().toISOString();

  const args = [cliPath || 'run-validate-apply.mjs', fixDate];
  if (selected && selected.length) args.push(`--selected=${selected.join(',')}`);

  const doSpawn = spawner || ((a) => spawn('node', a, {
    cwd: '/opt/jarvis-sprint-agents',
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  }));

  const child = doSpawn(args);

  const stateFile = join(jobsDir, `${jobId}.json`);
  const logFile = join(jobsDir, `${jobId}.log`);
  writeFileSync(stateFile, JSON.stringify({
    job_id: jobId, pid: child.pid, args, state: 'running',
    started_at: startedAt, finished_at: null, exit_code: null,
    fix_date: fixDate, selected: selected || null, log_file: logFile,
  }, null, 2));

  if (child.stdout) child.stdout.on('data', d => { try { require('fs').appendFileSync(logFile, d); } catch {} });
  if (child.stderr) child.stderr.on('data', d => { try { require('fs').appendFileSync(logFile, d); } catch {} });
  if (child.on) {
    child.on('close', code => {
      try {
        const st = JSON.parse(readFileSync(stateFile, 'utf-8'));
        st.state = code === 0 ? 'done' : 'error';
        st.finished_at = new Date().toISOString();
        st.exit_code = code;
        writeFileSync(stateFile, JSON.stringify(st, null, 2));
      } catch {}
    });
    if (child.unref) child.unref();
  }

  return { job_id: jobId, started_at: startedAt };
}

export function getApplyStatus({ jobsDir, jobId }) {
  const p = join(jobsDir, `${jobId}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}
```

- [ ] **Step 4: Run — GREEN.**

**Verification:** All 5 tests pass.

---

### Task B2: server.mjs routes — `GET /validation/latest`, `/validation/plan/current`, `/validation/history`

**Files modified:**
- `services/knowledge-hub/lib/server.mjs`

**Why:** Read-only endpoints the dashboard polls on load.

**Steps:**

- [ ] **Step 1: Add imports + helpers near the top of `lib/server.mjs`:**

```javascript
import {
  readLatest, listHistory, readPlan,
  spawnApply, getApplyStatus,
} from './validation-proxy.mjs';

const VALIDATION_DATA_DIR = process.env.VALIDATION_DATA_DIR
  || '/opt/jarvis-sprint-agents/data/validation';
const VALIDATION_JOBS_DIR = process.env.VALIDATION_JOBS_DIR
  || '/opt/jarvis-knowledge-hub/data/validation-jobs';
const VALIDATION_CLI_PATH = process.env.VALIDATION_CLI_PATH
  || '/opt/jarvis-sprint-agents/run-validate-apply.mjs';
```

- [ ] **Step 2: Inside the request handler, before the catch-all 404, insert:**

```javascript
if (req.method === 'GET' && url.pathname === '/validation/latest') {
  const latest = readLatest({ dataDir: VALIDATION_DATA_DIR });
  if (!latest) { res.writeHead(404, corsJson); res.end('{"error":"no latest.json"}'); return; }
  res.writeHead(200, corsJson);
  res.end(JSON.stringify(latest));
  return;
}

if (req.method === 'GET' && url.pathname === '/validation/history') {
  const items = listHistory({ dataDir: VALIDATION_DATA_DIR });
  res.writeHead(200, corsJson);
  res.end(JSON.stringify({ items }));
  return;
}

if (req.method === 'GET' && url.pathname === '/validation/plan/current') {
  const hist = listHistory({ dataDir: VALIDATION_DATA_DIR });
  if (hist.length === 0) { res.writeHead(404, corsJson); res.end('{"error":"no plans"}'); return; }
  const latestDate = hist[0].date;
  const plan = readPlan({ dataDir: VALIDATION_DATA_DIR, date: latestDate });
  if (!plan) { res.writeHead(404, corsJson); res.end('{"error":"no plan"}'); return; }
  res.writeHead(200, corsJson);
  res.end(JSON.stringify({
    date: plan.date,
    markdown: plan.markdown,
    checked: [...plan.checked],
    all: [...plan.all],
  }));
  return;
}
```

- [ ] **Step 3: Ensure `corsJson` const exists in the file (if not, add):**

```javascript
const corsJson = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
```

- [ ] **Step 4: Smoke test:**

```bash
# In a shell with validation data seeded:
cd /home/teruel/worktrees/infra-clickup-validator/services/knowledge-hub
VALIDATION_DATA_DIR=../sprint-agents/data/validation node index.mjs &
sleep 1
curl -s http://localhost:8091/validation/latest | jq '.by_severity'
curl -s http://localhost:8091/validation/history | jq '.items | length'
curl -s http://localhost:8091/validation/plan/current | jq '.date'
kill %1
```

**Verification:** All three endpoints return JSON. Missing files return 404 with `error` payload.

---

### Task B3: server.mjs routes — `POST /validation/apply` (spawn CLI)

**Files modified:**
- `services/knowledge-hub/lib/server.mjs`

**Steps:**

- [ ] **Step 1: Add body-reading helper if not present:**

```javascript
async function readJsonBody(req, limit = 1 << 20) {
  return await new Promise((resolve, reject) => {
    let data = ''; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) reject(new Error('body too large')); data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
```

- [ ] **Step 2: Add the route above the 404:**

```javascript
if (req.method === 'POST' && url.pathname === '/validation/apply') {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { res.writeHead(400, corsJson); res.end(JSON.stringify({ error: e.message })); return; }

  const { fix_date, selected_issue_ids } = body || {};
  if (!fix_date || !/^\d{4}-\d{2}-\d{2}$/.test(fix_date)) {
    res.writeHead(400, corsJson); res.end('{"error":"invalid fix_date"}'); return;
  }

  const { job_id, started_at } = spawnApply({
    fixDate: fix_date,
    selected: Array.isArray(selected_issue_ids) ? selected_issue_ids : null,
    jobsDir: VALIDATION_JOBS_DIR,
    cliPath: VALIDATION_CLI_PATH,
  });
  res.writeHead(202, corsJson);
  res.end(JSON.stringify({ job_id, started_at }));
  return;
}
```

- [ ] **Step 3: Smoke test:**

```bash
curl -X POST http://localhost:8091/validation/apply \
  -H 'Content-Type: application/json' \
  -d '{"fix_date":"2026-04-21","selected_issue_ids":["T1::primary-not-sprint"]}'
# → {"job_id":"...","started_at":"..."}
```

**Verification:** 202 response with job_id + started_at. File appears under `VALIDATION_JOBS_DIR/<job_id>.json`.

---

### Task B4: server.mjs routes — `GET /validation/apply/:job_id` (poll status)

**Files modified:**
- `services/knowledge-hub/lib/server.mjs`

**Steps:**

- [ ] **Step 1: Add the route above the 404:**

```javascript
{
  const m = /^\/validation\/apply\/([a-f0-9-]{8,})$/.exec(url.pathname);
  if (req.method === 'GET' && m) {
    const jobId = m[1];
    const status = getApplyStatus({ jobsDir: VALIDATION_JOBS_DIR, jobId });
    if (!status) { res.writeHead(404, corsJson); res.end('{"error":"no such job"}'); return; }
    // Redact pid from public response
    const { pid, ...safe } = status;
    res.writeHead(200, corsJson);
    res.end(JSON.stringify(safe));
    return;
  }
}
```

- [ ] **Step 2: Smoke test:**

```bash
JOB_ID=$(curl -s -X POST http://localhost:8091/validation/apply \
  -H 'Content-Type: application/json' \
  -d '{"fix_date":"2026-04-21"}' | jq -r .job_id)
sleep 3
curl -s http://localhost:8091/validation/apply/$JOB_ID | jq
# → { "job_id": "...", "state": "done", "exit_code": 0, ... }
```

**Verification:** Status payload returned; state transitions from `running` → `done` or `error`.

---

### Task B5: `dashboard/validation.html` — SPA shell

**Files created:**
- `services/knowledge-hub/dashboard/validation.html`

**Why:** Static SPA page; the server already serves `dashboard/*` as static files (existing behaviour from graph dashboard).

**Steps:**

- [ ] **Step 1: Write `services/knowledge-hub/dashboard/validation.html`:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Validation — Knowledge Hub</title>
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="validation.css">
</head>
<body class="dark">
  <header class="topbar">
    <div class="brand">Knowledge Hub</div>
    <nav>
      <a href="index.html">Graph</a>
      <a href="validation.html" class="active">Validation</a>
    </nav>
    <div class="status" id="conn-status" title="API connection">connecting…</div>
  </header>

  <main id="validation-main" class="validation-main">
    <section class="val-header">
      <div class="totals">
        <div class="t-card t-critical"><span class="label">Critical</span><span id="t-crit" class="num">—</span></div>
        <div class="t-card t-warning"><span class="label">Warning</span><span id="t-warn" class="num">—</span></div>
        <div class="t-card t-info"><span class="label">Info</span><span id="t-info" class="num">—</span></div>
        <div class="t-card t-total"><span class="label">Scanned</span><span id="t-scan" class="num">—</span></div>
      </div>
      <div class="by-product">
        <span class="chip" data-product="all">All</span>
        <span class="chip" data-product="diemaster">DM <span id="pp-dm">0</span></span>
        <span class="chip" data-product="spotfusion">SF <span id="pp-sf">0</span></span>
        <span class="chip" data-product="visionking">VK <span id="pp-vk">0</span></span>
      </div>
      <div class="actions">
        <button id="btn-refresh" class="btn">Refresh</button>
        <button id="btn-run-now" class="btn btn-primary" disabled title="Run now (not wired in v1)">Run now</button>
      </div>
    </section>

    <section class="val-filters">
      <span class="chip chip-severity active" data-sev="all">All</span>
      <span class="chip chip-severity chip-critical" data-sev="critical">Critical</span>
      <span class="chip chip-severity chip-warning" data-sev="warning">Warning</span>
      <span class="chip chip-severity chip-info" data-sev="info">Info</span>
      <input id="val-search" placeholder="Search task name…" />
    </section>

    <section class="val-body">
      <div id="issue-list" class="issue-list"></div>
    </section>

    <footer class="fix-plan-footer">
      <span id="sel-count">0 auto-fixes selected</span>
      <button id="btn-preview" class="btn">Preview plan</button>
      <button id="btn-apply" class="btn btn-primary" disabled>Apply selected</button>
      <span id="apply-status" class="apply-status"></span>
    </footer>
  </main>

  <dialog id="preview-dialog">
    <h3>Fix plan — <span id="preview-date"></span></h3>
    <pre id="preview-md"></pre>
    <form method="dialog"><button class="btn">Close</button></form>
  </dialog>

  <script src="validation.js"></script>
</body>
</html>
```

- [ ] **Step 2: Open `validation.html` directly in a browser** — confirms layout is correct without needing the server.

**Verification:** Dark theme renders; topbar has Graph/Validation links; footer has two buttons.

---

### Task B6: `dashboard/validation.js` — state management + fetch + render

**Files created:**
- `services/knowledge-hub/dashboard/validation.js`

**Steps:**

- [ ] **Write `services/knowledge-hub/dashboard/validation.js`:**

```javascript
(() => {
  'use strict';

  const state = {
    latest: null,
    plan: null,
    selected: new Set(),
    filters: { severity: 'all', product: 'all', query: '' },
    applyJobId: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  async function fetchJson(url, opts = {}) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r.json();
  }

  async function loadAll() {
    setStatus('loading…');
    try {
      const [latest, planResp] = await Promise.all([
        fetchJson('/validation/latest'),
        fetchJson('/validation/plan/current').catch(() => null),
      ]);
      state.latest = latest;
      state.plan = planResp;
      state.selected = new Set(planResp ? planResp.checked : []);
      renderTotals();
      renderIssues();
      renderSelection();
      setStatus('ready');
    } catch (e) {
      console.error(e);
      setStatus('error: ' + e.message);
    }
  }

  function setStatus(msg) { $('#conn-status').textContent = msg; }

  function renderTotals() {
    const s = state.latest?.by_severity || { critical: 0, warning: 0, info: 0 };
    $('#t-crit').textContent = s.critical;
    $('#t-warn').textContent = s.warning;
    $('#t-info').textContent = s.info;
    $('#t-scan').textContent = state.latest?.total_tasks_scanned ?? '—';
    const p = state.latest?.by_product || {};
    $('#pp-dm').textContent = p.diemaster || 0;
    $('#pp-sf').textContent = p.spotfusion || 0;
    $('#pp-vk').textContent = p.visionking || 0;
  }

  function issueMatchesFilter(issue) {
    const f = state.filters;
    if (f.severity !== 'all' && issue.severity !== f.severity) return false;
    if (f.product !== 'all' && issue.product !== f.product) return false;
    if (f.query && !issue.task.name.toLowerCase().includes(f.query)) return false;
    return true;
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function renderIssues() {
    const container = $('#issue-list');
    container.innerHTML = '';
    const issues = (state.latest?.issues || []).filter(issueMatchesFilter);
    const byCategory = {};
    for (const i of issues) (byCategory[i.category] ||= []).push(i);

    for (const [cat, list] of Object.entries(byCategory)) {
      const block = document.createElement('section');
      block.className = 'cat-block';
      block.innerHTML = `<h3 class="cat-title">${escHtml(cat)} <span class="cat-count">${list.length}</span></h3>`;
      const ul = document.createElement('div');
      ul.className = 'issue-rows';
      for (const issue of list) {
        const row = document.createElement('article');
        row.className = `issue-row sev-${issue.severity}`;
        const canFix = state.plan?.all?.includes(issue.id) && issue.fixable;
        const checked = state.selected.has(issue.id);
        row.innerHTML = `
          <div class="issue-check">
            ${canFix ? `<input type="checkbox" ${checked ? 'checked' : ''} data-id="${escHtml(issue.id)}">`
              : `<span class="badge-manual" title="Manual resolution">manual</span>`}
          </div>
          <div class="issue-meta">
            <div class="issue-title">
              <span class="check-badge">${escHtml(issue.check_id)}</span>
              <a class="task-link" href="${escHtml(issue.task.url)}" target="_blank" rel="noopener">
                ${escHtml(issue.task.name)}
              </a>
            </div>
            <div class="issue-desc">${escHtml(issue.description)}</div>
            ${canFix && issue.fix_proposal ? `
              <div class="issue-fix">
                <span class="action">${escHtml(issue.fix_proposal.action)}</span>
                <code>${escHtml(JSON.stringify(issue.fix_proposal.params))}</code>
                <span class="inferred">inferred from ${escHtml(issue.fix_proposal.inferred_from || '—')}</span>
              </div>` : ''}
          </div>
          <div class="issue-sev">${escHtml(issue.severity)}</div>`;
        ul.appendChild(row);
      }
      block.appendChild(ul);
      container.appendChild(block);
    }

    container.addEventListener('change', onIssueCheckboxChange, { once: true });
  }

  function onIssueCheckboxChange(ev) {
    const el = ev.target;
    if (el.tagName !== 'INPUT') { renderIssues(); return; }
    const id = el.dataset.id;
    if (el.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderSelection();
    renderIssues();
  }

  function renderSelection() {
    const n = state.selected.size;
    $('#sel-count').textContent = `${n} auto-fix${n === 1 ? '' : 'es'} selected`;
    $('#btn-apply').disabled = n === 0;
  }

  function setupFilters() {
    $$('.chip-severity').forEach(el => el.addEventListener('click', () => {
      $$('.chip-severity').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      state.filters.severity = el.dataset.sev;
      renderIssues();
    }));
    $$('.by-product .chip').forEach(el => el.addEventListener('click', () => {
      $$('.by-product .chip').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      state.filters.product = el.dataset.product;
      renderIssues();
    }));
    $('#val-search').addEventListener('input', ev => {
      state.filters.query = ev.target.value.toLowerCase();
      renderIssues();
    });
  }

  function setupActions() {
    $('#btn-refresh').addEventListener('click', loadAll);
    $('#btn-preview').addEventListener('click', () => {
      if (!state.plan) return;
      $('#preview-date').textContent = state.plan.date;
      $('#preview-md').textContent = state.plan.markdown;
      $('#preview-dialog').showModal();
    });
    $('#btn-apply').addEventListener('click', applySelected);
  }

  async function applySelected() {
    if (!state.plan || state.selected.size === 0) return;
    $('#btn-apply').disabled = true;
    setApplyStatus('starting…');
    try {
      const payload = {
        fix_date: state.plan.date,
        selected_issue_ids: [...state.selected],
      };
      const resp = await fetchJson('/validation/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      state.applyJobId = resp.job_id;
      setApplyStatus(`job ${resp.job_id.slice(0, 8)}… running`);
      pollJob();
    } catch (e) {
      setApplyStatus('error: ' + e.message);
      $('#btn-apply').disabled = false;
    }
  }

  async function pollJob() {
    if (!state.applyJobId) return;
    try {
      const j = await fetchJson(`/validation/apply/${state.applyJobId}`);
      if (j.state === 'running') {
        setApplyStatus(`job ${j.job_id.slice(0, 8)} running…`);
        setTimeout(pollJob, 1500);
      } else if (j.state === 'done') {
        setApplyStatus(`job ${j.job_id.slice(0, 8)} done (exit ${j.exit_code})`);
        state.applyJobId = null;
        setTimeout(loadAll, 500);
      } else {
        setApplyStatus(`job ${j.job_id.slice(0, 8)} failed (exit ${j.exit_code})`);
        state.applyJobId = null;
      }
    } catch (e) {
      setApplyStatus('poll error: ' + e.message);
    }
  }

  function setApplyStatus(msg) { $('#apply-status').textContent = msg; }

  setupFilters();
  setupActions();
  loadAll();
})();
```

**Verification:**
- [ ] Load `http://localhost:8091/dashboard/validation.html`
- [ ] Totals render
- [ ] Clicking severity chip filters list
- [ ] Clicking product chip filters list
- [ ] Checkbox toggles update selection count
- [ ] Preview plan dialog shows markdown

---

### Task B7: `dashboard/validation.css` additions (reuse style.css)

**Files created:**
- `services/knowledge-hub/dashboard/validation.css`

**Why:** `style.css` holds the shared dark theme; this stylesheet adds only validator-specific layout.

**Steps:**

- [ ] **Write `services/knowledge-hub/dashboard/validation.css`:**

```css
:root {
  --sev-critical: #ff1744;
  --sev-warning:  #ff9800;
  --sev-info:     #00d2ff;
  --panel-bg:     #1a1a1a;
  --panel-bd:     #333333;
  --muted:        #999999;
}

.validation-main {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 12px;
  padding: 16px;
  max-width: 1400px;
  margin: 0 auto;
  color: #fff;
}

.val-header {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 16px;
}

.totals { display: flex; gap: 12px; }
.t-card {
  background: var(--panel-bg);
  border: 1px solid var(--panel-bd);
  border-radius: 8px;
  padding: 8px 14px;
  min-width: 90px;
  text-align: center;
}
.t-card .label { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; }
.t-card .num   { display: block; font-size: 22px; font-weight: 600; margin-top: 2px; }
.t-card.t-critical .num { color: var(--sev-critical); }
.t-card.t-warning .num  { color: var(--sev-warning);  }
.t-card.t-info .num     { color: var(--sev-info);     }

.by-product { display: flex; gap: 8px; }

.val-filters {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 0;
  border-top: 1px solid var(--panel-bd);
  border-bottom: 1px solid var(--panel-bd);
}
.val-filters input {
  margin-left: auto;
  background: var(--panel-bg);
  color: #fff;
  border: 1px solid var(--panel-bd);
  border-radius: 6px;
  padding: 6px 10px;
  width: 280px;
}

.chip {
  background: var(--panel-bg);
  border: 1px solid var(--panel-bd);
  border-radius: 16px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.chip.active { border-color: #fff; }
.chip-critical.active { border-color: var(--sev-critical); color: var(--sev-critical); }
.chip-warning.active  { border-color: var(--sev-warning);  color: var(--sev-warning);  }
.chip-info.active     { border-color: var(--sev-info);     color: var(--sev-info);     }

.val-body {
  overflow: auto;
}
.cat-block { margin-bottom: 18px; }
.cat-title { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.cat-count { color: #fff; background: var(--panel-bg); border-radius: 10px; padding: 0 6px; font-size: 11px; margin-left: 4px; }

.issue-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--panel-bd);
  background: var(--panel-bg);
  border-radius: 8px;
  margin-bottom: 8px;
}
.issue-row.sev-critical { border-left: 3px solid var(--sev-critical); }
.issue-row.sev-warning  { border-left: 3px solid var(--sev-warning);  }
.issue-row.sev-info     { border-left: 3px solid var(--sev-info);     }
.issue-title { display: flex; gap: 8px; align-items: center; }
.check-badge { font-size: 11px; color: var(--muted); background: #2a2a2a; padding: 2px 6px; border-radius: 4px; }
.issue-desc  { margin-top: 4px; color: #ccc; font-size: 13px; }
.issue-fix   { margin-top: 6px; font-size: 12px; color: #999; }
.issue-fix code { background: #0f0f0f; padding: 1px 6px; border-radius: 4px; color: #ddd; }
.issue-sev   { color: var(--muted); font-size: 11px; align-self: start; text-transform: uppercase; }
.badge-manual { background: #2a2a2a; color: var(--muted); font-size: 11px; padding: 2px 6px; border-radius: 4px; }

.fix-plan-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--panel-bg);
  border-top: 1px solid var(--panel-bd);
  border-radius: 8px;
}
.btn {
  background: #2a2a2a;
  color: #fff;
  border: 1px solid var(--panel-bd);
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #0d2b4e; border-color: var(--sev-info); }
.apply-status { color: var(--muted); font-size: 12px; margin-left: auto; }

#preview-dialog { background: var(--panel-bg); color: #fff; border: 1px solid var(--panel-bd); border-radius: 8px; padding: 16px; max-width: 900px; }
#preview-dialog pre { background: #0f0f0f; padding: 12px; max-height: 60vh; overflow: auto; font-size: 12px; }
```

**Verification:** Dashboard layout visually matches the knowledge-hub graph page palette; severity colors distinguish rows.

---

### Task B8: End-to-end smoke test

**Goal:** Validate the full flow against the server running locally.

**Steps:**

- [ ] **Step 1: Start services:**

```bash
cd /home/teruel/worktrees/infra-clickup-validator/services/sprint-agents
CLICKUP_TOKEN="$(grep CLICKUP_TOKEN /opt/github-clickup-sync/.env | cut -d= -f2)" \
  node run-validate.mjs

cd /home/teruel/worktrees/infra-clickup-validator/services/knowledge-hub
VALIDATION_DATA_DIR=../sprint-agents/data/validation \
VALIDATION_JOBS_DIR=/tmp/val-jobs \
VALIDATION_CLI_PATH=../sprint-agents/run-validate-apply.mjs \
  node index.mjs &
```

- [ ] **Step 2: Open the dashboard:** `http://localhost:8091/dashboard/validation.html`

- [ ] **Step 3: Flow-check:**
  - Totals populated (non-zero).
  - Check one warning-severity fixable issue.
  - Click **Apply selected** → status transitions `starting…` → `running` → `done`.
  - After ~3s dashboard auto-refreshes; that issue is gone from the list.

- [ ] **Step 4: Server logs** show:
  - `POST /validation/apply 202`
  - `GET /validation/apply/<id> 200`
  - CLI logs in `/tmp/val-jobs/<id>.log`.

- [ ] **Step 5: Final artefacts present:**
  - `data/validation/fix-applied-history.json` has a new entry.
  - `data/validation/fix-applied-YYYY-MM-DD.md` exists.

- [ ] **Step 6: Run full test suite in both services:**

```bash
cd services/sprint-agents && node --test test/
cd ../knowledge-hub && node --test test/
```

- [ ] **Step 7: Update the draft PR created in Task A17:**

```bash
gh pr ready <pr-number>
gh pr edit <pr-number> --body "$(cat <<'EOF'
## Summary
- Phase A: sprint-agents `validate` + `validate-apply` modes (17 tasks, 60+ tests).
- Phase B: knowledge-hub `/validation/*` routes + dashboard SPA (8 tasks).
- Zero-LLM pipeline, latest-only-apply rule, delta-aware Chat alerts.

## Test plan
- [x] Unit tests green in both services
- [x] Smoke: dashboard loads, critical+warning issues render, apply button works end-to-end
- [x] Smoke: stale fix-plan is rejected by run-validate-apply
- [x] No secrets in diff
EOF
)"
```

**Verification:** PR transitions from draft to ready; smoke steps documented; reviewers can follow the same flow locally.

---

## Completion Criteria

- 25 tasks complete (17 in Phase A, 8 in Phase B).
- `node --test services/sprint-agents/test/` and `node --test services/knowledge-hub/test/` both green.
- Manual smoke run against live ClickUp succeeds.
- PR ready with linked spec + lessons-learned additions.
- `MEMORY.md` updated with: validator service path, cron schedule, secret env vars.
- `docs/lessons-learned.md` appended with any v1 surprises (e.g., how `productOptionMap` resolves, how stale-plan detection behaved).
