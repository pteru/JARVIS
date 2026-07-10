---
type: Implementation Plan
title: Knowledge Hub — Plan 3: Ops, Lint & Consumer Integration
description: All work happens in the knowledge-hub service directory within the infra worktree. Consumer changes happen in their respective worktrees.
timestamp: 2026-04-17
---

# Knowledge Hub — Plan 3: Ops, Lint & Consumer Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production-harden the knowledge-hub with lint checks, file-back, deploy automation, and wire up jarvis-chat and sprint-agents as consumers.

**Architecture:** Lint module with 6 deterministic checks + Google Chat alerts. File-back via PMO git integration. systemd for server process, cron for ingestion + lint. Consumer integration via HTTP calls to knowledge-hub REST API.

**Tech Stack:** Node.js 20+, node:test, systemd, cron, Google Chat API (alerts)

---

## Worktree & Branch

All work happens in the knowledge-hub service directory within the infra worktree. Consumer changes happen in their respective worktrees.

```
Service:     services/knowledge-hub/
Worktree:    (same as Plans 1-2, infra workspace)
Consumers:   infra-jarvis-chat worktree, infra-sprint-agents worktree
```

## Task 1: Lint Module — Stale Reports + KB Drift Checks (TDD)

**Files:**
- `services/knowledge-hub/lib/lint.mjs`
- `services/knowledge-hub/test/lint.test.mjs`

### Steps

- [ ] **1.1** Create `test/lint.test.mjs` with tests for stale reports and KB drift checks

```javascript
// test/lint.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkStaleReports, checkKbDrift } from '../lib/lint.mjs';

describe('lint — stale reports', () => {
  it('flags reports not updated in >14 days with recent activity', () => {
    const db = mockDb({
      chunks: [
        { source_type: 'pmo_report', source_path: 'projects/03002/overview.md', project_code: '03002', updated_at: '2026-03-30T00:00:00Z' },
      ],
      recentActivity: [
        { source_type: 'email', project_code: '03002', count: 5, latest: '2026-04-16T00:00:00Z' },
      ],
    });
    const now = new Date('2026-04-17T10:00:00Z');
    const issues = checkStaleReports(db, { now, staleDays: 14 });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].check, 'stale_report');
    assert.equal(issues[0].project_code, '03002');
    assert.equal(issues[0].severity, 'warning');
    assert.ok(issues[0].message.includes('18'));
    assert.ok(issues[0].message.includes('5 emails'));
  });

  it('does not flag recently updated reports', () => {
    const db = mockDb({
      chunks: [
        { source_type: 'pmo_report', source_path: 'projects/03002/overview.md', project_code: '03002', updated_at: '2026-04-15T00:00:00Z' },
      ],
      recentActivity: [],
    });
    const now = new Date('2026-04-17T10:00:00Z');
    const issues = checkStaleReports(db, { now, staleDays: 14 });
    assert.equal(issues.length, 0);
  });

  it('does not flag stale reports with zero activity', () => {
    const db = mockDb({
      chunks: [
        { source_type: 'pmo_report', source_path: 'projects/03002/overview.md', project_code: '03002', updated_at: '2026-03-30T00:00:00Z' },
      ],
      recentActivity: [],
    });
    const now = new Date('2026-04-17T10:00:00Z');
    const issues = checkStaleReports(db, { now, staleDays: 14 });
    assert.equal(issues.length, 0);
  });
});

describe('lint — KB drift', () => {
  it('flags KB pages older than recent source commits', () => {
    const db = mockDb({
      kbPages: [
        { source_path: 'spotfusion/backend.md', updated_at: '2026-03-01T00:00:00Z' },
      ],
    });
    // Simulate git log returning recent commits
    const commitLog = [
      { repo: 'spotfusion', date: '2026-04-10', count: 12 },
    ];
    const issues = checkKbDrift(db, { commitLog, driftDays: 30 });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].check, 'kb_drift');
    assert.ok(issues[0].message.includes('12 commits'));
  });

  it('does not flag recently updated KB pages', () => {
    const db = mockDb({
      kbPages: [
        { source_path: 'spotfusion/backend.md', updated_at: '2026-04-15T00:00:00Z' },
      ],
    });
    const commitLog = [
      { repo: 'spotfusion', date: '2026-04-10', count: 5 },
    ];
    const issues = checkKbDrift(db, { commitLog, driftDays: 30 });
    assert.equal(issues.length, 0);
  });
});

function mockDb(data) {
  return {
    getReportStaleness() {
      return (data.chunks || []).map(c => ({
        project_code: c.project_code,
        source_path: c.source_path,
        last_updated: c.updated_at,
      }));
    },
    getRecentActivityByProject(projectCode, sinceDays) {
      return (data.recentActivity || []).filter(a => a.project_code === projectCode);
    },
    getKbPages() {
      return (data.kbPages || []).map(p => ({
        source_path: p.source_path,
        last_updated: p.updated_at,
      }));
    },
  };
}
```

- [ ] **1.2** Implement the stale reports and KB drift checks in `lib/lint.mjs`

```javascript
// lib/lint.mjs
/**
 * Lint module — 6 deterministic health checks for the knowledge hub.
 * No LLM calls. All checks are date/hash/status comparisons.
 */

/**
 * Check 1: Stale reports — PMO reports not updated in >staleDays despite activity.
 */
export function checkStaleReports(db, { now = new Date(), staleDays = 14 } = {}) {
  const issues = [];
  const reports = db.getReportStaleness();
  const cutoff = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);

  for (const r of reports) {
    const lastUpdated = new Date(r.last_updated);
    if (lastUpdated >= cutoff) continue;

    // Check if there's recent activity for this project
    const activity = db.getRecentActivityByProject(r.project_code, staleDays);
    if (activity.length === 0) continue;

    const ageDays = Math.floor((now.getTime() - lastUpdated.getTime()) / (24 * 60 * 60 * 1000));
    const activitySummary = activity
      .map(a => `${a.count} ${a.source_type}s`)
      .join(', ');

    issues.push({
      check: 'stale_report',
      severity: ageDays > 30 ? 'critical' : 'warning',
      project_code: r.project_code,
      source_path: r.source_path,
      message: `${r.project_code}: ${r.source_path} not updated in ${ageDays} days, but ${activitySummary} received`,
      age_days: ageDays,
    });
  }
  return issues;
}

/**
 * Check 2: KB page drift — KB pages with old updates vs recent repo commits.
 */
export function checkKbDrift(db, { commitLog = [], driftDays = 30 } = {}) {
  const issues = [];
  const pages = db.getKbPages();

  for (const page of pages) {
    const lastUpdated = new Date(page.last_updated);
    // Extract product/repo from source_path (e.g. 'spotfusion/backend.md' → 'spotfusion')
    const repo = page.source_path.split('/')[0];
    const commits = commitLog.find(c => c.repo === repo);
    if (!commits) continue;

    const commitDate = new Date(commits.date);
    if (lastUpdated >= commitDate) continue;

    const driftMs = commitDate.getTime() - lastUpdated.getTime();
    if (driftMs < driftDays * 24 * 60 * 60 * 1000) continue;

    issues.push({
      check: 'kb_drift',
      severity: 'warning',
      source_path: page.source_path,
      message: `${page.source_path} outdated (${lastUpdated.toISOString().slice(0, 10)}) — ${commits.count} commits since`,
      drift_days: Math.floor(driftMs / (24 * 60 * 60 * 1000)),
    });
  }
  return issues;
}
```

- [ ] **1.3** Run tests: `node --test test/lint.test.mjs` — verify both pass

---

## Task 2: Lint Module — Graph Orphans + Contradictions + Missing Entities + Source Freshness (TDD)

**Files:**
- `services/knowledge-hub/lib/lint.mjs` (extend)
- `services/knowledge-hub/test/lint.test.mjs` (extend)

### Steps

- [ ] **2.1** Add tests for the remaining 4 checks to `test/lint.test.mjs`

```javascript
// Append to test/lint.test.mjs
import { checkGraphOrphans, checkContradictions, checkMissingEntities, checkSourceFreshness } from '../lib/lint.mjs';

describe('lint — graph orphans', () => {
  it('flags entities with zero relations', () => {
    const db = mockDbGraph({
      entities: [
        { id: 'person:rafael', name: 'Rafael', type: 'person' },
        { id: 'person:guilherme', name: 'Guilherme', type: 'person' },
      ],
      triples: [
        { subject: 'person:guilherme', predicate: 'works_on', object: 'project:03002' },
      ],
    });
    const issues = checkGraphOrphans(db);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].check, 'graph_orphan');
    assert.ok(issues[0].message.includes('rafael'));
  });

  it('does not flag entities with relations', () => {
    const db = mockDbGraph({
      entities: [
        { id: 'person:guilherme', name: 'Guilherme', type: 'person' },
      ],
      triples: [
        { subject: 'person:guilherme', predicate: 'works_on', object: 'project:03002' },
      ],
    });
    const issues = checkGraphOrphans(db);
    assert.equal(issues.length, 0);
  });
});

describe('lint — contradictions', () => {
  it('flags sprint.md "done" vs ClickUp "in progress"', () => {
    const db = mockDbContradictions({
      sprintStatuses: [
        { project_code: '03002', task_name: 'Calibração câmeras', sprint_status: 'done' },
      ],
      clickupStatuses: [
        { project_code: '03002', task_name: 'Calibração câmeras', clickup_status: 'in_progress' },
      ],
    });
    const issues = checkContradictions(db);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].check, 'contradiction');
    assert.equal(issues[0].severity, 'critical');
  });

  it('does not flag matching statuses', () => {
    const db = mockDbContradictions({
      sprintStatuses: [
        { project_code: '03002', task_name: 'Deploy v2', sprint_status: 'done' },
      ],
      clickupStatuses: [
        { project_code: '03002', task_name: 'Deploy v2', clickup_status: 'done' },
      ],
    });
    const issues = checkContradictions(db);
    assert.equal(issues.length, 0);
  });
});

describe('lint — missing entities', () => {
  it('flags names in reports not in knowledge graph', () => {
    const db = mockDbMissing({
      mentionedNames: [
        { name: 'João', source: '03008/status.md' },
        { name: 'Guilherme', source: '03002/overview.md' },
      ],
      knownEntities: ['person:guilherme'],
    });
    const issues = checkMissingEntities(db);
    assert.equal(issues.length, 1);
    assert.ok(issues[0].message.includes('João'));
    assert.ok(issues[0].message.includes('03008'));
  });
});

describe('lint — source freshness', () => {
  it('flags sources that stopped updating', () => {
    const db = mockDbFreshness({
      ingestState: [
        { source_key: 'email:03010', last_ingested: '2026-04-08T00:00:00Z' },
        { source_key: 'email:03002', last_ingested: '2026-04-16T00:00:00Z' },
      ],
    });
    const now = new Date('2026-04-17T10:00:00Z');
    const issues = checkSourceFreshness(db, { now, freshnessDays: 7 });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].check, 'source_stale');
    assert.ok(issues[0].message.includes('03010'));
  });

  it('does not flag recently ingested sources', () => {
    const db = mockDbFreshness({
      ingestState: [
        { source_key: 'email:03002', last_ingested: '2026-04-16T00:00:00Z' },
      ],
    });
    const now = new Date('2026-04-17T10:00:00Z');
    const issues = checkSourceFreshness(db, { now, freshnessDays: 7 });
    assert.equal(issues.length, 0);
  });
});

function mockDbGraph(data) {
  return {
    getOrphanEntities() {
      const connectedIds = new Set();
      for (const t of data.triples || []) {
        connectedIds.add(t.subject);
        connectedIds.add(t.object);
      }
      return (data.entities || []).filter(e => !connectedIds.has(e.id));
    },
  };
}

function mockDbContradictions(data) {
  return {
    getSprintVsClickupMismatches() {
      const mismatches = [];
      for (const s of data.sprintStatuses || []) {
        const cu = (data.clickupStatuses || []).find(
          c => c.project_code === s.project_code && c.task_name === s.task_name
        );
        if (cu && normalizeStatus(s.sprint_status) !== normalizeStatus(cu.clickup_status)) {
          mismatches.push({
            project_code: s.project_code,
            task_name: s.task_name,
            sprint_status: s.sprint_status,
            clickup_status: cu.clickup_status,
          });
        }
      }
      return mismatches;
    },
  };
}

function normalizeStatus(s) {
  const lower = (s || '').toLowerCase().replace(/[_\s-]/g, '');
  if (['done', 'complete', 'completed', 'closed'].includes(lower)) return 'done';
  if (['inprogress', 'active', 'started'].includes(lower)) return 'in_progress';
  return lower;
}

function mockDbMissing(data) {
  return {
    getMentionedNames() { return data.mentionedNames || []; },
    getKnownEntityNames() {
      return new Set((data.knownEntities || []).map(id => id.split(':')[1]));
    },
  };
}

function mockDbFreshness(data) {
  return {
    getIngestState() { return data.ingestState || []; },
  };
}
```

- [ ] **2.2** Implement the 4 remaining checks in `lib/lint.mjs`

```javascript
// Append to lib/lint.mjs

/**
 * Check 3: Graph orphans — entities with zero relations.
 */
export function checkGraphOrphans(db) {
  const orphans = db.getOrphanEntities();
  return orphans.map(e => ({
    check: 'graph_orphan',
    severity: 'info',
    entity_id: e.id,
    message: `entity ${e.id} (${e.name}) has 0 relations — verify if still active`,
  }));
}

/**
 * Check 4: Contradictions — sprint.md says "done" but ClickUp says "in progress".
 */
export function checkContradictions(db) {
  const mismatches = db.getSprintVsClickupMismatches();
  return mismatches.map(m => ({
    check: 'contradiction',
    severity: 'critical',
    project_code: m.project_code,
    message: `${m.project_code}: sprint.md lists "${m.task_name}" as ${m.sprint_status}, ClickUp status = ${m.clickup_status}`,
  }));
}

/**
 * Check 5: Missing entities — names mentioned in reports without graph entities.
 */
export function checkMissingEntities(db) {
  const mentioned = db.getMentionedNames();
  const known = db.getKnownEntityNames();
  const issues = [];
  for (const m of mentioned) {
    if (!known.has(m.name.toLowerCase())) {
      issues.push({
        check: 'missing_entity',
        severity: 'info',
        message: `${m.name} mentioned in ${m.source} but doesn't exist in knowledge graph`,
        name: m.name,
        source: m.source,
      });
    }
  }
  return issues;
}

/**
 * Check 6: Source freshness — ingest sources that stopped updating.
 */
export function checkSourceFreshness(db, { now = new Date(), freshnessDays = 7 } = {}) {
  const states = db.getIngestState();
  const cutoff = new Date(now.getTime() - freshnessDays * 24 * 60 * 60 * 1000);
  const issues = [];
  for (const s of states) {
    const lastIngested = new Date(s.last_ingested);
    if (lastIngested >= cutoff) continue;
    const ageDays = Math.floor((now.getTime() - lastIngested.getTime()) / (24 * 60 * 60 * 1000));
    issues.push({
      check: 'source_stale',
      severity: ageDays > 14 ? 'warning' : 'info',
      source_key: s.source_key,
      message: `${s.source_key} hasn't updated in ${ageDays} days — check service`,
      age_days: ageDays,
    });
  }
  return issues;
}
```

- [ ] **2.3** Add the `runAllChecks` orchestrator function to `lib/lint.mjs`

```javascript
// Append to lib/lint.mjs

/**
 * Run all 6 lint checks and return a combined report.
 * @param {object} db - Database adapter with query methods
 * @param {object} opts - { now, commitLog, staleDays, driftDays, freshnessDays }
 * @returns {{ timestamp, issues, summary }}
 */
export function runAllChecks(db, opts = {}) {
  const now = opts.now || new Date();
  const issues = [
    ...checkStaleReports(db, { now, staleDays: opts.staleDays }),
    ...checkKbDrift(db, { commitLog: opts.commitLog, driftDays: opts.driftDays }),
    ...checkGraphOrphans(db),
    ...checkContradictions(db),
    ...checkMissingEntities(db),
    ...checkSourceFreshness(db, { now, freshnessDays: opts.freshnessDays }),
  ];

  const summary = {
    total: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
  };

  return {
    timestamp: now.toISOString(),
    issues,
    summary,
  };
}
```

- [ ] **2.4** Run tests: `node --test test/lint.test.mjs` — verify all 10+ assertions pass

---

## Task 3: Lint CLI Entry Point + Google Chat Alerts

**Files:**
- `services/knowledge-hub/lint.mjs` (CLI entry point)
- `services/knowledge-hub/lib/alert-sender.mjs` (reuse health-monitor pattern)

### Steps

- [ ] **3.1** Create `lib/alert-sender.mjs` — Google Chat alert sender (reuse health-monitor pattern)

```javascript
// lib/alert-sender.mjs
/**
 * Send lint alerts to Google Chat (Infra Alerts space).
 * Reuses the same pattern as health-monitor/lib/alert-sender.mjs.
 */
import { readFileSync } from 'node:fs';

const SPACE = 'spaces/AAQADpGfnS4';  // Infra Alerts space
const SUBJECT = 'pedro@lumesolutions.com';
const KEY_PATH = process.env.GCP_SERVICE_ACCOUNT_KEY ||
  '/home/strokmatic/.secrets/gcp-service-account.json';

const SEVERITY_ICONS = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

let _chatClient = null;

async function getChatClient() {
  if (_chatClient) return _chatClient;
  // Dynamic import — googleapis is only needed when actually sending alerts
  const { google } = await import('googleapis');
  const credentials = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/chat.messages'],
    clientOptions: { subject: SUBJECT },
  });
  _chatClient = google.chat({ version: 'v1', auth });
  return _chatClient;
}

/**
 * Format and send critical/warning lint issues to Google Chat.
 * Only sends alerts for critical and warning severity — info is logged only.
 */
export async function sendLintAlerts(report) {
  const alertable = report.issues.filter(i => i.severity === 'critical' || i.severity === 'warning');
  if (alertable.length === 0) return { sent: 0 };

  const lines = alertable.map(issue => {
    const icon = SEVERITY_ICONS[issue.severity] || '🔵';
    return `${icon} *[${issue.check}]* ${issue.message}`;
  });

  const header = `*[knowledge-hub lint]* ${report.summary.critical} critical, ${report.summary.warning} warnings`;
  const text = `${header}\n\n${lines.join('\n')}`;

  const chat = await getChatClient();
  await chat.spaces.messages.create({
    parent: SPACE,
    requestBody: { text },
  });

  return { sent: alertable.length };
}
```

- [ ] **3.2** Create `lint.mjs` CLI entry point

```javascript
#!/usr/bin/env node
// lint.mjs — CLI entry point for periodic lint checks.
// Called by cron (Sundays 08:00).
// Usage: node lint.mjs [--alert] [--json]

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAllChecks } from './lib/lint.mjs';
import { sendLintAlerts } from './lib/alert-sender.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const LINT_DIR = join(DATA_DIR, 'lint-reports');
const DB_PATH = join(DATA_DIR, 'knowledge-hub.db');

async function main() {
  const args = process.argv.slice(2);
  const shouldAlert = args.includes('--alert');
  const jsonOutput = args.includes('--json');

  // Load config
  const configPath = join(__dirname, 'config', 'service.json');
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf-8'))
    : {};

  // Initialize database connection
  const { createDb } = await import('./lib/db.mjs');
  const db = createDb(DB_PATH);

  // Collect git commit log for KB drift check (optional, best-effort)
  let commitLog = [];
  try {
    const { getRepoCommitLog } = await import('./lib/git-stats.mjs');
    commitLog = await getRepoCommitLog(config);
  } catch (err) {
    console.warn(`[lint] Could not load commit log: ${err.message}`);
  }

  // Run all checks
  const report = runAllChecks(db, {
    commitLog,
    staleDays: config.lint?.stale_days ?? 14,
    driftDays: config.lint?.drift_days ?? 30,
    freshnessDays: config.lint?.freshness_days ?? 7,
  });

  // Save report
  mkdirSync(LINT_DIR, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const reportPath = join(LINT_DIR, `${dateStr}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');

  // Store as latest for /health/lint endpoint
  writeFileSync(join(LINT_DIR, 'latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf-8');

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(`[lint] ${report.summary.total} issues: ${report.summary.critical} critical, ${report.summary.warning} warning, ${report.summary.info} info`);
    for (const issue of report.issues) {
      const icon = issue.severity === 'critical' ? '!!' : issue.severity === 'warning' ? '!' : '-';
      console.log(`  ${icon} [${issue.check}] ${issue.message}`);
    }
  }

  // Send alerts if requested and there are critical/warning issues
  if (shouldAlert && (report.summary.critical > 0 || report.summary.warning > 0)) {
    try {
      const result = await sendLintAlerts(report);
      console.log(`[lint] Sent ${result.sent} alerts to Google Chat`);
    } catch (err) {
      console.error(`[lint] Alert sending failed: ${err.message}`);
    }
  }

  db.close();
  process.exit(report.summary.critical > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`[lint] Fatal: ${err.message}`);
  process.exit(2);
});
```

- [ ] **3.3** Create `lib/git-stats.mjs` — helper to collect commit counts per repo for KB drift check

```javascript
// lib/git-stats.mjs
/**
 * Collect recent commit counts per repo for KB drift detection.
 * Reads from kb-generator repo list in config, runs git log on each.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);

/**
 * Get commit counts for repos documented in KB pages.
 * @param {object} config - service.json config
 * @returns {Array<{repo, date, count}>}
 */
export async function getRepoCommitLog(config) {
  const repos = config.kb_repos || [];
  const results = [];
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const repo of repos) {
    if (!existsSync(repo.path)) continue;
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repo.path, 'log', '--oneline', `--since=${since}`,
      ], { maxBuffer: 5 * 1024 * 1024 });
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        // Get date of most recent commit
        const { stdout: dateOut } = await execFileAsync('git', [
          '-C', repo.path, 'log', '-1', '--format=%ci',
        ]);
        results.push({
          repo: repo.name,
          date: dateOut.trim().slice(0, 10),
          count: lines.length,
        });
      }
    } catch {
      // Skip repos that fail (not cloned, network issues)
    }
  }
  return results;
}
```

- [ ] **3.4** Wire `GET /health/lint` endpoint into `lib/server.mjs` — reads `data/lint-reports/latest.json`

Add this route handler to the existing server.mjs routes (Plan 1 already has the server):

```javascript
// In lib/server.mjs — add to the route handler switch/if block:

// GET /health/lint — last lint report
if (method === 'GET' && pathname === '/health/lint') {
  const lintPath = join(DATA_DIR, 'lint-reports', 'latest.json');
  if (!existsSync(lintPath)) {
    return jsonResponse(res, 404, { error: 'No lint report available yet' });
  }
  const report = JSON.parse(readFileSync(lintPath, 'utf-8'));
  return jsonResponse(res, 200, report);
}
```

---

## Task 4: File-Back — POST /ingest/analysis Endpoint + PMO Git Write

**Files:**
- `services/knowledge-hub/lib/file-back.mjs`
- `services/knowledge-hub/test/file-back.test.mjs`

### Steps

- [ ] **4.1** Create `test/file-back.test.mjs` with tests for the file-back pipeline

```javascript
// test/file-back.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis, buildFilePath, slugify } from '../lib/file-back.mjs';

describe('file-back — validation', () => {
  it('rejects missing required fields', () => {
    const result = validateAnalysis({ title: 'test' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('accepts valid analysis', () => {
    const result = validateAnalysis({
      title: 'Análise de calibração',
      content: 'A'.repeat(600),
      project_code: '03002',
      product: 'visionking',
      author: 'jarvis-chat',
    });
    assert.equal(result.valid, true);
  });

  it('rejects short content (<500 chars)', () => {
    const result = validateAnalysis({
      title: 'Short',
      content: 'Too short',
      project_code: '03002',
      product: 'visionking',
      author: 'jarvis-chat',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('500')));
  });
});

describe('file-back — file path', () => {
  it('builds correct path with date slug', () => {
    const path = buildFilePath('03002', 'Análise de calibração', new Date('2026-04-17'));
    assert.equal(path, 'projects/03002/analyses/2026-04-17-analise-de-calibracao.md');
  });
});

describe('file-back — slugify', () => {
  it('removes accents and special characters', () => {
    assert.equal(slugify('Análise de Calibração Térmica!'), 'analise-de-calibracao-termica');
  });

  it('collapses multiple dashes', () => {
    assert.equal(slugify('hello -- world'), 'hello-world');
  });
});
```

- [ ] **4.2** Implement `lib/file-back.mjs`

```javascript
// lib/file-back.mjs
/**
 * File-back: save consumer-generated analyses to PMO git repo and index them.
 * Flow: validate → build path → write markdown → git commit+push → index chunks.
 */

const REQUIRED_FIELDS = ['title', 'content', 'project_code', 'product', 'author'];
const MIN_CONTENT_LENGTH = 500;

/**
 * Validate incoming analysis payload.
 */
export function validateAnalysis(data) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!data[field]) errors.push(`Missing required field: ${field}`);
  }
  if (data.content && data.content.length < MIN_CONTENT_LENGTH) {
    errors.push(`Content too short (${data.content.length} chars, minimum ${MIN_CONTENT_LENGTH})`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Slugify a title for use as filename.
 */
export function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')      // remove special chars
    .trim()
    .replace(/[\s]+/g, '-')            // spaces → dashes
    .replace(/-+/g, '-');              // collapse multiple dashes
}

/**
 * Build the relative file path in the PMO repo.
 */
export function buildFilePath(projectCode, title, date = new Date()) {
  const dateStr = date.toISOString().slice(0, 10);
  const slug = slugify(title);
  return `projects/${projectCode}/analyses/${dateStr}-${slug}.md`;
}

/**
 * Format the analysis as markdown for storage.
 */
export function formatMarkdown(data) {
  const date = new Date().toISOString().slice(0, 10);
  return [
    `# ${data.title}`,
    '',
    `**Projeto:** ${data.project_code}`,
    `**Produto:** ${data.product}`,
    `**Autor:** ${data.author}`,
    `**Data:** ${date}`,
    '',
    '---',
    '',
    data.content,
    '',
  ].join('\n');
}

/**
 * Execute the full file-back pipeline: validate → write → commit → index.
 * @param {object} data - Analysis payload
 * @param {object} pmoGit - pmo-git.mjs instance
 * @param {object} indexer - Function to index the written file
 * @returns {{ ok, path, error }}
 */
export async function fileBack(data, pmoGit, indexer) {
  const validation = validateAnalysis(data);
  if (!validation.valid) {
    return { ok: false, error: validation.errors.join('; ') };
  }

  const relPath = buildFilePath(data.project_code, data.title);
  const markdown = formatMarkdown(data);

  try {
    // Ensure PMO repo is up to date
    await pmoGit.cloneOrPull();

    // Write the analysis file
    await pmoGit.writeAtRelPath(relPath, markdown);

    // Commit and push
    const committed = await pmoGit.commitAll(
      `analysis: ${data.title} [${data.project_code}] (file-back from ${data.author})`
    );
    if (committed) {
      await pmoGit.push();
    }

    // Index the new analysis
    if (indexer) {
      await indexer(relPath, data);
    }

    return { ok: true, path: relPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
```

- [ ] **4.3** Wire `POST /ingest/analysis` endpoint into `lib/server.mjs`

Add this route handler to the existing server.mjs (inside the auth-protected block):

```javascript
// In lib/server.mjs — add to the auth-protected POST routes:

// POST /ingest/analysis — file-back: save analysis to PMO repo + index
if (method === 'POST' && pathname === '/ingest/analysis') {
  const body = await readBody(req);
  const data = JSON.parse(body);

  const { fileBack } = await import('./file-back.mjs');
  const result = await fileBack(data, pmoGit, async (relPath, analysis) => {
    // Re-index just this file via the chat-facts ingestor
    await ingestors.chatFacts.ingestSingle(relPath, analysis);
  });

  if (result.ok) {
    return jsonResponse(res, 201, { path: result.path });
  } else {
    return jsonResponse(res, 400, { error: result.error });
  }
}
```

- [ ] **4.4** Add PMO git configuration to `config/service.json`

```json
{
  "port": 8091,
  "pmo_git": {
    "url": "git@github.com:teruelskm/strokmatic-pmo.git",
    "branch": "main",
    "clone_path": "/opt/pmo-knowledge-hub",
    "author": {
      "name": "JARVIS Knowledge Hub",
      "email": "jarvis@lumesolutions.com"
    }
  },
  "lint": {
    "stale_days": 14,
    "drift_days": 30,
    "freshness_days": 7
  },
  "kb_repos": [
    { "name": "spotfusion", "path": "/opt/pmo-readonly/repos/spotfusion" },
    { "name": "diemaster", "path": "/opt/pmo-readonly/repos/diemaster" },
    { "name": "visionking", "path": "/opt/pmo-readonly/repos/visionking" }
  ]
}
```

Note: `writeAtRelPath` in pmo-git.mjs currently calls `atomicWriteJson` which does `JSON.stringify`. For markdown content, the file-back needs a plain-text write variant. Add a `writeAtRelPathRaw` method:

```javascript
// In _shared/pmo-git.mjs — add alongside writeAtRelPath:
async function writeAtRelPathRaw(relPath, content) {
  const target = join(clonePath, relPath);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, target);
}

// Add to the returned object:
return { cloneOrPull, writeProject, writeAtRelPath, writeAtRelPathRaw, commitAll, push, headSha };
```

Update `file-back.mjs` to call `pmoGit.writeAtRelPathRaw(relPath, markdown)` instead of `pmoGit.writeAtRelPath(relPath, markdown)`.

- [ ] **4.5** Run tests: `node --test test/file-back.test.mjs`

---

## Task 5: deploy.sh + systemd Unit File

**Files:**
- `services/knowledge-hub/deploy.sh`
- `services/knowledge-hub/jarvis-knowledge-hub.service` (systemd unit)

### Steps

- [ ] **5.1** Create `deploy.sh` — follows sprint-agents pattern with systemd addition

```bash
#!/bin/bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-strokmatic@192.168.15.2}"
REMOTE_DIR="${REMOTE_DIR:-/opt/jarvis-knowledge-hub}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${SSHPASS:?SSHPASS env required}"

SSH="sshpass -e ssh -o StrictHostKeyChecking=no"
RSYNC="sshpass -e rsync -e 'ssh -o StrictHostKeyChecking=no'"

echo "==> ensuring remote dirs"
$SSH "$REMOTE_HOST" "echo '$SSHPASS' | sudo -S mkdir -p $REMOTE_DIR/{data,logs,data/lint-reports} && echo '$SSHPASS' | sudo -S chown -R strokmatic:strokmatic $REMOTE_DIR"

echo "==> syncing knowledge-hub to $REMOTE_DIR"
bash -c "$RSYNC -a --delete \
  --exclude 'data' \
  --exclude 'logs' \
  --exclude 'node_modules' \
  --exclude 'test' \
  --exclude '.git' \
  \"$SCRIPT_DIR/\" \"$REMOTE_HOST:$REMOTE_DIR/\""

echo "==> installing npm dependencies"
$SSH "$REMOTE_HOST" ". /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && npm install --production 2>&1 | tail -3"

echo "==> installing systemd unit"
$SSH "$REMOTE_HOST" "echo '$SSHPASS' | sudo -S cp $REMOTE_DIR/jarvis-knowledge-hub.service /etc/systemd/system/ && echo '$SSHPASS' | sudo -S systemctl daemon-reload && echo '$SSHPASS' | sudo -S systemctl enable jarvis-knowledge-hub"

echo "==> restarting knowledge-hub service"
$SSH "$REMOTE_HOST" "echo '$SSHPASS' | sudo -S systemctl restart jarvis-knowledge-hub"
sleep 2
$SSH "$REMOTE_HOST" "systemctl is-active jarvis-knowledge-hub && echo '  service is running'"

echo "==> installing crons"
$SSH "$REMOTE_HOST" "(crontab -l 2>/dev/null | grep -v knowledge-hub; \
  echo '5 * * * * . /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && bash run.sh ingest >> $REMOTE_DIR/logs/cron.log 2>&1 # knowledge-hub-ingest'; \
  echo '0 8 * * 0 . /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && bash run.sh lint >> $REMOTE_DIR/logs/cron.log 2>&1 # knowledge-hub-lint') | crontab -"

echo "==> adding to rotate-logs"
$SSH "$REMOTE_HOST" "echo '$SSHPASS' | sudo -S grep -q 'jarvis-knowledge-hub' /opt/_shared/rotate-logs.sh 2>/dev/null || echo '  /opt/jarvis-knowledge-hub' | sudo -S tee -a /opt/_shared/rotate-logs-services.txt >/dev/null"

echo "==> verifying health endpoint"
sleep 3
$SSH "$REMOTE_HOST" "curl -s http://localhost:8091/health | head -c 200 && echo"

echo ""
echo "==> deploy complete"
$SSH "$REMOTE_HOST" "crontab -l | grep knowledge-hub"
echo ""
echo "Dashboard: http://192.168.15.2:8091/"
echo "Health:    http://192.168.15.2:8091/health"
echo "Lint:      http://192.168.15.2:8091/health/lint"
```

- [ ] **5.2** Create `jarvis-knowledge-hub.service` systemd unit

```ini
[Unit]
Description=JARVIS Knowledge Hub — knowledge graph + search API
After=network.target
Wants=network.target

[Service]
Type=simple
User=strokmatic
Group=strokmatic
WorkingDirectory=/opt/jarvis-knowledge-hub
ExecStart=/home/strokmatic/.nvm/versions/node/v20.18.3/bin/node index.mjs
Restart=on-failure
RestartSec=10
StandardOutput=append:/opt/jarvis-knowledge-hub/logs/server.log
StandardError=append:/opt/jarvis-knowledge-hub/logs/server.log

# Environment
Environment=NODE_ENV=production
Environment=GCP_SERVICE_ACCOUNT_KEY=/home/strokmatic/.secrets/gcp-service-account.json

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/opt/jarvis-knowledge-hub/data /opt/jarvis-knowledge-hub/logs /opt/pmo-knowledge-hub
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

- [ ] **5.3** Verify deploy script is executable and systemd unit has correct paths

---

## Task 6: run.sh + rotate-logs + state-writer Integration

**Files:**
- `services/knowledge-hub/run.sh`

### Steps

- [ ] **6.1** Create `run.sh` — wrapper for cron-invoked operations (ingest + lint)

```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-ingest}"
LOG_FILE="$SCRIPT_DIR/logs/run-$(date -u +%Y-%m-%d).log"
mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/data" "$SCRIPT_DIR/data/lint-reports"

# Source state writer for health-monitor integration
SHARED_DIR="${SHARED_DIR:-/opt/_shared}"
if [[ -f "$SHARED_DIR/state-writer.sh" ]]; then
  source "$SHARED_DIR/state-writer.sh"
  export SERVICE_NAME="knowledge-hub"
  export STATE_FILE="$SCRIPT_DIR/data/state.json"
fi

LOCK_FILE="$SCRIPT_DIR/data/run-${MODE}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date -u +%FT%TZ)] knowledge-hub ${MODE}: previous run in flight" >> "$LOG_FILE"
  exit 0
fi

START_MS=$(date +%s%3N)

# ERR trap: write failed state if any command fails
trap 'EXIT_CODE=$?; DURATION_MS=$(($(date +%s%3N) - START_MS)); type -t write_state &>/dev/null && write_state "$SERVICE_NAME" "failed" "$DURATION_MS" "{\"mode\":\"$MODE\",\"exit_code\":$EXIT_CODE}"; exit $EXIT_CODE' ERR

{
  echo "[$(date -u +%FT%TZ)] knowledge-hub ${MODE}: starting"

  case "$MODE" in
    ingest)
      node ingest.mjs
      ;;
    lint)
      node lint.mjs --alert
      ;;
    *)
      echo "Unknown mode: $MODE"
      exit 1
      ;;
  esac

  DURATION_MS=$(($(date +%s%3N) - START_MS))
  echo "[$(date -u +%FT%TZ)] knowledge-hub ${MODE}: done (${DURATION_MS}ms)"

  # Write success state for health-monitor
  if type -t write_state &>/dev/null; then
    write_state "$SERVICE_NAME" "success" "$DURATION_MS" "{\"mode\":\"$MODE\"}"
  fi
} >> "$LOG_FILE" 2>&1
```

- [ ] **6.2** Update `_shared/rotate-logs.sh` to include knowledge-hub in the SERVICES array

```bash
# In _shared/rotate-logs.sh — add to the SERVICES array:
  /opt/jarvis-knowledge-hub
```

---

## Task 7: Health-Monitor Integration

**Files:**
- `services/health-monitor/config/services.json`
- `services/knowledge-hub/lib/server.mjs` (ensure /health endpoint is present)

### Steps

- [ ] **7.1** Add knowledge-hub entry to health-monitor `config/services.json`

```json
"knowledge-hub": {
  "state_file": "/opt/jarvis-knowledge-hub/data/state.json",
  "cadence_minutes": 60,
  "staleness_factor": 2.0,
  "alert_on_partial": false,
  "health_endpoint": "http://localhost:8091/health",
  "added_at": "2026-04-17T00:00:00Z"
}
```

- [ ] **7.2** Verify the `/health` endpoint in `lib/server.mjs` returns the expected format

The `/health` endpoint (already defined in Plan 1) should return:

```json
{
  "status": "ok",
  "uptime_s": 12345,
  "last_ingest": "2026-04-17T10:05:00Z",
  "counts": {
    "chunks": 1500,
    "entities": 200,
    "triples": 350
  },
  "version": "1.0.0"
}
```

- [ ] **7.3** Verify `data/state.json` is written by `run.sh` on each ingest cycle, matching the schema expected by health-monitor:

```json
{
  "service": "knowledge-hub",
  "last_run": "2026-04-17T10:05:00Z",
  "last_status": "success",
  "duration_ms": 4500,
  "exit_code": 0,
  "details": { "mode": "ingest" }
}
```

---

## Task 8: jarvis-chat Integration — Replace Raw PMO Reading with /search

**Files:**
- `services/jarvis-chat/lib/project-context.mjs` (modify)
- `services/jarvis-chat/lib/knowledge-hub-client.mjs` (new)
- `services/jarvis-chat/test/knowledge-hub-client.test.mjs` (new)

**Worktree:** `infra-jarvis-chat`

### Steps

- [ ] **8.1** Create `test/knowledge-hub-client.test.mjs`

```javascript
// test/knowledge-hub-client.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSearchContext, buildSearchUrl, shouldFileBack } from '../lib/knowledge-hub-client.mjs';

describe('knowledge-hub-client — formatSearchContext', () => {
  it('formats search results into context string', () => {
    const results = [
      { content: 'Calibração realizada em abril', source_type: 'pmo_report', project_code: '03002', score: 0.9 },
      { content: 'Deploy no servidor 192.168.15.3', source_type: 'kb_page', project_code: '03002', score: 0.7 },
    ];
    const ctx = formatSearchContext(results);
    assert.ok(ctx.includes('Calibração'));
    assert.ok(ctx.includes('[pmo_report]'));
    assert.ok(ctx.includes('Deploy'));
  });

  it('returns empty string for no results', () => {
    assert.equal(formatSearchContext([]), '');
  });

  it('respects maxChars limit', () => {
    const results = [
      { content: 'A'.repeat(5000), source_type: 'pmo_report', project_code: '03002', score: 0.9 },
    ];
    const ctx = formatSearchContext(results, 1000);
    assert.ok(ctx.length <= 1100);  // allow for labels
  });
});

describe('knowledge-hub-client — buildSearchUrl', () => {
  it('builds correct URL with project filter', () => {
    const url = buildSearchUrl('calibração', { project: '03002', limit: 5 });
    assert.ok(url.includes('q=calibra'));
    assert.ok(url.includes('project=03002'));
    assert.ok(url.includes('limit=5'));
  });
});

describe('knowledge-hub-client — shouldFileBack', () => {
  it('returns true for substantive responses', () => {
    assert.equal(shouldFileBack('A'.repeat(600)), true);
  });

  it('returns false for short responses', () => {
    assert.equal(shouldFileBack('Sim, está ativo.'), false);
  });

  it('returns false for greetings', () => {
    assert.equal(shouldFileBack('Olá! Como posso ajudar?'), false);
  });
});
```

- [ ] **8.2** Create `lib/knowledge-hub-client.mjs`

```javascript
// lib/knowledge-hub-client.mjs
/**
 * HTTP client for the knowledge-hub REST API.
 * Used by jarvis-chat to fetch context and file back analyses.
 */

const BASE_URL = process.env.KNOWLEDGE_HUB_URL || 'http://192.168.15.2:8091';
const API_KEY = process.env.KNOWLEDGE_HUB_API_KEY || '';
const TIMEOUT_MS = 5000;

/**
 * Build a search URL with query parameters.
 */
export function buildSearchUrl(query, { project, sourceType, limit = 10 } = {}) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (project) params.set('project', project);
  if (sourceType) params.set('source_type', sourceType);
  return `${BASE_URL}/search?${params.toString()}`;
}

/**
 * Search the knowledge hub for relevant context.
 * @returns {Array<{content, source_type, project_code, score}>}
 */
export async function search(query, opts = {}) {
  const url = buildSearchUrl(query, opts);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    // Graceful fallback — knowledge-hub might be down
    return [];
  }
}

/**
 * Format search results into a context string for the LLM prompt.
 */
export function formatSearchContext(results, maxChars = 8000) {
  if (results.length === 0) return '';

  const lines = [];
  let totalChars = 0;

  for (const r of results) {
    const line = `[${r.source_type}|${r.project_code || '?'}|score:${r.score?.toFixed(2)}] ${r.content}`;
    if (totalChars + line.length > maxChars) {
      // Add truncated version if there's room
      const remaining = maxChars - totalChars;
      if (remaining > 100) {
        lines.push(line.slice(0, remaining) + '…');
      }
      break;
    }
    lines.push(line);
    totalChars += line.length;
  }

  return lines.join('\n\n');
}

/**
 * Determine whether a response is substantive enough to file back.
 */
export function shouldFileBack(responseText) {
  if (!responseText || responseText.length < 500) return false;

  // Reject greetings and confirmations
  const trivialPatterns = [
    /^(olá|oi|bom dia|boa tarde|boa noite)/i,
    /^(sim|não|ok|certo|entendido)/i,
    /como posso ajudar/i,
  ];
  for (const p of trivialPatterns) {
    if (p.test(responseText.trim())) return false;
  }

  return true;
}

/**
 * File back an analysis to the knowledge hub.
 * @param {object} analysis - { title, content, project_code, product, author }
 * @returns {{ ok, path, error }}
 */
export async function fileBackAnalysis(analysis) {
  const url = `${BASE_URL}/ingest/analysis`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(analysis),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
```

- [ ] **8.3** Modify `lib/project-context.mjs` to use knowledge-hub search with graceful fallback

The existing `loadStaticProjectContext` reads raw PMO files. Replace the core logic with a knowledge-hub search call, falling back to the original file reading if knowledge-hub is unavailable.

```javascript
// In lib/project-context.mjs — add at the top:
import { search, formatSearchContext } from './knowledge-hub-client.mjs';

// Add new function:
/**
 * Load project context from knowledge-hub search API.
 * Falls back to static file reading if knowledge-hub is unavailable.
 */
export async function loadProjectContext(projectCode, product, userQuery = '') {
  // Try knowledge-hub first
  const searchQuery = userQuery || `projeto ${projectCode} status recente`;
  const results = await search(searchQuery, {
    project: projectCode,
    limit: 15,
  });

  if (results.length > 0) {
    const contextStr = formatSearchContext(results, 12000);
    return {
      sources: [{ label: `knowledge-hub search (${results.length} results)`, content: contextStr }],
      totalChars: contextStr.length,
      remainingChars: 16000 - contextStr.length,
      fromKnowledgeHub: true,
    };
  }

  // Fallback to static reading
  return { ...loadStaticProjectContext(projectCode, product), fromKnowledgeHub: false };
}
```

- [ ] **8.4** Update `answer-generator.mjs` (or whichever module calls `loadStaticProjectContext`) to use the new `loadProjectContext` and to call `fileBackAnalysis` on substantive responses

The caller should:
1. Call `loadProjectContext(projectCode, product, userMessage)` instead of `loadStaticProjectContext`
2. After generating a response, check `shouldFileBack(response)` and call `fileBackAnalysis` if true

```javascript
// In the answer generation flow — pseudo-code for integration:
import { loadProjectContext } from './project-context.mjs';
import { shouldFileBack, fileBackAnalysis } from './knowledge-hub-client.mjs';

// Before calling Claude:
const context = await loadProjectContext(projectCode, product, userMessage);

// After receiving response from Claude:
if (shouldFileBack(response)) {
  // Fire-and-forget: don't block the user response
  fileBackAnalysis({
    title: `Análise: ${userMessage.slice(0, 80)}`,
    content: response,
    project_code: projectCode,
    product,
    author: 'jarvis-chat',
  }).catch(err => console.warn(`[file-back] ${err.message}`));
}
```

- [ ] **8.5** Run tests: `node --test test/knowledge-hub-client.test.mjs`

---

## Task 9: sprint-agents Integration — Add /search + /graph to Planning Context

**Files:**
- `services/sprint-agents/lib/knowledge-hub-client.mjs` (new — similar to jarvis-chat's)
- `services/sprint-agents/lib/sprint-planning.mjs` (modify)
- `services/sprint-agents/test/knowledge-hub-client.test.mjs` (new)

**Worktree:** `infra-sprint-agents`

### Steps

- [ ] **9.1** Create `lib/knowledge-hub-client.mjs` for sprint-agents

```javascript
// lib/knowledge-hub-client.mjs
/**
 * Knowledge-hub client for sprint-agents.
 * Uses /search for sprint context and /graph for team/deploy topology.
 */

const BASE_URL = process.env.KNOWLEDGE_HUB_URL || 'http://192.168.15.2:8091';
const TIMEOUT_MS = 5000;

/**
 * Search knowledge hub for sprint-relevant context.
 */
export async function searchContext(query, { project, sourceType, limit = 10 } = {}) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (project) params.set('project', project);
  if (sourceType) params.set('source_type', sourceType);
  const url = `${BASE_URL}/search?${params.toString()}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

/**
 * Get graph neighbors for a project — reveals team, deploys, equipment.
 */
export async function getProjectGraph(projectId, depth = 1) {
  const url = `${BASE_URL}/graph/neighbors/${encodeURIComponent(projectId)}?depth=${depth}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Format graph data into context for the planning prompt.
 */
export function formatGraphContext(graph) {
  if (!graph || !graph.nodes) return '';

  const people = graph.nodes.filter(n => n.type === 'person');
  const deploys = graph.nodes.filter(n => n.type === 'deploy');
  const equipment = graph.nodes.filter(n => n.type === 'equipment');

  const lines = [];
  if (people.length > 0) {
    lines.push(`**Equipe:** ${people.map(p => p.name).join(', ')}`);
  }
  if (deploys.length > 0) {
    lines.push(`**Deploys:** ${deploys.map(d => d.name).join(', ')}`);
  }
  if (equipment.length > 0) {
    lines.push(`**Equipamentos:** ${equipment.map(e => e.name).join(', ')}`);
  }

  const activeRelations = graph.edges?.filter(e => !e.valid_to) || [];
  if (activeRelations.length > 0) {
    lines.push(`**Relações ativas:** ${activeRelations.length}`);
  }

  return lines.join('\n');
}

/**
 * Format search results into context string.
 */
export function formatSearchResults(results, maxChars = 4000) {
  if (results.length === 0) return '';
  let total = 0;
  const lines = [];
  for (const r of results) {
    const line = `[${r.source_type}] ${r.content}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join('\n\n');
}
```

- [ ] **9.2** Create `test/knowledge-hub-client.test.mjs`

```javascript
// test/knowledge-hub-client.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatGraphContext, formatSearchResults } from '../lib/knowledge-hub-client.mjs';

describe('sprint-agents knowledge-hub-client', () => {
  it('formats graph context with people and deploys', () => {
    const graph = {
      nodes: [
        { id: 'person:guilherme', name: 'Guilherme', type: 'person' },
        { id: 'deploy:arcelor-lam', name: 'ArcelorMittal Laminação', type: 'deploy' },
      ],
      edges: [
        { source: 'person:guilherme', target: 'project:03002', predicate: 'works_on' },
      ],
    };
    const ctx = formatGraphContext(graph);
    assert.ok(ctx.includes('Guilherme'));
    assert.ok(ctx.includes('ArcelorMittal'));
  });

  it('returns empty string for null graph', () => {
    assert.equal(formatGraphContext(null), '');
  });

  it('formats search results with char limit', () => {
    const results = [
      { content: 'Sprint 10 concluída com sucesso', source_type: 'meeting' },
      { content: 'Bloqueio no deploy da câmera 3', source_type: 'email' },
    ];
    const ctx = formatSearchResults(results, 5000);
    assert.ok(ctx.includes('[meeting]'));
    assert.ok(ctx.includes('[email]'));
  });
});
```

- [ ] **9.3** Modify `lib/sprint-planning.mjs` to enrich context with knowledge-hub data

Replace the raw PMO reading (lines 86-102 in the current file) with knowledge-hub queries, keeping the existing logic as fallback:

```javascript
// In lib/sprint-planning.mjs — add import at top:
import { searchContext, getProjectGraph, formatGraphContext, formatSearchResults } from './knowledge-hub-client.mjs';

// Replace the "Load project context from kb-generator outputs" block (lines 86-102) with:

  // Load project context from knowledge-hub (with fallback to raw PMO)
  let contextParts = '';
  let graphContext = '';

  // Try knowledge-hub first
  const searchResults = await searchContext(
    `sprint bloqueios status ${product}`,
    { sourceType: 'meeting,email,pmo_report', limit: 15 }
  );

  if (searchResults.length > 0) {
    contextParts = formatSearchResults(searchResults, 4000);
  } else {
    // Fallback: read raw PMO context files
    const pmoRoot = config.pmo_readonly || '/opt/pmo-readonly';
    let projectCodes = [];
    try {
      const allCodes = JSON.parse(readFileSync(join(pmoRoot, 'config/project-codes.json'), 'utf-8'));
      projectCodes = Object.entries(allCodes)
        .filter(([k, v]) => v.product === product && !k.startsWith('_'))
        .map(([k]) => k);
    } catch {
      // project-codes.json may not exist yet
    }
    contextParts = projectCodes.slice(0, 5).map(code => {
      const ctx = safeRead(join(pmoRoot, 'projects', code, 'reports/md/context.md'));
      return ctx ? `[${code}] ${ctx.slice(0, 500)}` : '';
    }).filter(Boolean).join('\n\n');
  }

  // Get project team/topology from knowledge graph
  for (const code of projectCodes.slice(0, 3)) {
    const graph = await getProjectGraph(`project:${code}`, 1);
    if (graph) {
      const gctx = formatGraphContext(graph);
      if (gctx) graphContext += `\n### ${code}\n${gctx}\n`;
    }
  }
```

Update the `fillTemplate` call to include graph context:

```javascript
  // In the fillTemplate call, add a new variable:
  const prompt = fillTemplate(loadPrompt('planning-briefing'), {
    // ... existing variables ...
    PROJECT_CONTEXT: contextParts || 'Nenhum context.md disponível ainda.',
    PROJECT_GRAPH: graphContext || 'Grafo não disponível.',
    MEETING_NOTES: meetingNotes || 'Nenhuma ata disponível.',
  });
```

Note: The prompt template `prompts/planning-briefing.md` needs a `{{PROJECT_GRAPH}}` placeholder added. If the template doesn't have it, the variable is simply ignored by `fillTemplate`.

- [ ] **9.4** Run tests: `node --test test/knowledge-hub-client.test.mjs`

---

## Task 10: Migration — Disable context-refresh, E2E Validation Checklist

**Files:**
- `services/knowledge-hub/scripts/validate-e2e.sh` (new)

### Steps

- [ ] **10.1** Create E2E validation script `scripts/validate-e2e.sh`

```bash
#!/bin/bash
# E2E validation for knowledge-hub before disabling context-refresh.
# Run on the production server (192.168.15.2).
set -euo pipefail

BASE_URL="${1:-http://localhost:8091}"
PASS=0
FAIL=0

check() {
  local label="$1"
  local url="$2"
  local expect="$3"
  local response
  response=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000")
  if [[ "$response" == "$expect" ]]; then
    echo "  [PASS] $label (HTTP $response)"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label (HTTP $response, expected $expect)"
    FAIL=$((FAIL + 1))
  fi
}

check_json() {
  local label="$1"
  local url="$2"
  local jq_filter="$3"
  local response
  response=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "{}")
  local value
  value=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print($jq_filter)" 2>/dev/null || echo "ERROR")
  if [[ "$value" != "ERROR" && "$value" != "None" && "$value" != "0" ]]; then
    echo "  [PASS] $label ($value)"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label (got: $value)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Knowledge Hub E2E Validation ==="
echo ""

echo "--- 1. Service Health ---"
check "Health endpoint" "$BASE_URL/health" "200"
check_json "Chunks indexed" "$BASE_URL/health" "d.get('counts',{}).get('chunks',0)"
check_json "Entities indexed" "$BASE_URL/health" "d.get('counts',{}).get('entities',0)"

echo ""
echo "--- 2. Search API ---"
check "Search endpoint" "$BASE_URL/search?q=visionking&limit=3" "200"
check_json "Search returns results" "$BASE_URL/search?q=visionking&limit=3" "len(d.get('results',[]))"

echo ""
echo "--- 3. Graph API ---"
check "Graph stats" "$BASE_URL/graph/stats" "200"
check "Graph view" "$BASE_URL/graph/view?product=visionking" "200"

echo ""
echo "--- 4. Dashboard ---"
check "Dashboard loads" "$BASE_URL/" "200"

echo ""
echo "--- 5. Lint ---"
check "Lint endpoint" "$BASE_URL/health/lint" "200"

echo ""
echo "--- 6. State file ---"
if [[ -f /opt/jarvis-knowledge-hub/data/state.json ]]; then
  echo "  [PASS] state.json exists"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] state.json missing"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "--- 7. systemd ---"
if systemctl is-active --quiet jarvis-knowledge-hub 2>/dev/null; then
  echo "  [PASS] systemd service active"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] systemd service not active"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "--- 8. Cron entries ---"
if crontab -l 2>/dev/null | grep -q knowledge-hub-ingest; then
  echo "  [PASS] ingest cron installed"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] ingest cron missing"
  FAIL=$((FAIL + 1))
fi
if crontab -l 2>/dev/null | grep -q knowledge-hub-lint; then
  echo "  [PASS] lint cron installed"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] lint cron missing"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "========================================="

if (( FAIL > 0 )); then
  echo ""
  echo "DO NOT disable context-refresh until all checks pass."
  exit 1
else
  echo ""
  echo "All checks passed. Safe to disable context-refresh cron."
  echo "To disable: crontab -l | grep -v context-refresh | crontab -"
fi
```

- [ ] **10.2** After E2E passes on server, disable context-refresh cron

```bash
# On 192.168.15.2:
crontab -l | grep -v context-refresh | crontab -
```

- [ ] **10.3** Update health-monitor `config/services.json` — mark context-refresh as retired

```json
"context-refresh": {
  "state_file": "/opt/jarvis-context-refresh/data/state.json",
  "cadence_minutes": 20160,
  "staleness_factor": 1.2,
  "alert_on_partial": false,
  "added_at": "2026-04-15T11:54:22Z",
  "retired_at": "2026-04-XX",
  "enabled": false
}
```

Note: verify that health-monitor respects `"enabled": false` (or simply remove the entry). Check the health-monitor config loader for how it handles disabled services.

- [ ] **10.4** Verify consumers work with knowledge-hub — manual smoke tests

1. **jarvis-chat**: Send a message to the chat sandbox, verify response includes knowledge-hub context (check logs for `knowledge-hub search` label)
2. **sprint-agents**: Run `bash run.sh plan visionking` and verify the briefing includes graph context
3. **Dashboard**: Open `http://192.168.15.2:8091/` in browser, verify graph renders

---

## Dependency Graph

```
Task 1 ──┐
Task 2 ──┤
         ├── Task 3 (lint CLI needs all 6 checks + alert-sender)
         │
Task 4 ──┘── (independent, needs pmo-git.mjs change)
         
Task 5 ──┐
Task 6 ──┤── Task 7 (health-monitor needs state.json from run.sh)
         │
Task 8 ──┘── (independent, jarvis-chat worktree)
Task 9 ──┘── (independent, sprint-agents worktree)

Task 10: depends on Tasks 5-9 all deployed and working
```

**Parallelizable:** Tasks 1+2 together, then 3+4 together, then 5+6 together, 8+9 together. Task 7 after 5+6. Task 10 last.
