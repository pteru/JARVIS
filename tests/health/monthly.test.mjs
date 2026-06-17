import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCliStub } from './helpers/cli-stub.mjs';

// ---------------------------------------------------------------------------
// Canned monthly report from the Claude stub
// ---------------------------------------------------------------------------
const CANNED_MONTHLY_REPORT = `# SpotFusion 02006 — Monthly Report: 2026-05

## Overview
Overall system health was stable during May 2026 with minor warnings.

## Severity Distribution
| Severity | Count | Percentage |
|----------|-------|------------|
| HEALTHY  | 4     | 66.7%      |
| WARNING  | 2     | 33.3%      |
| CRITICAL | 0     | 0.0%       |
| UNKNOWN  | 0     | 0.0%       |

## Risk Assessment
STABLE — system operated within normal parameters throughout the month.
`;

// ---------------------------------------------------------------------------
// Minimal valid SF config (no assembler field — config.sh handles missing gracefully)
// ---------------------------------------------------------------------------
const SF_CONFIG = {
  product: 'sf',
  deployment: '02006',
  name: 'SpotFusion 02006',
  data_root: 'data/sf-health',
  reports_root: 'reports/sf-health',
  assembler: 'scripts/health/assemblers/sf.py',
  claude_model: 'claude-opus-4-6',
  connectivity: {
    label: 'Network',
    nodes: ['server'],
  },
  secrets: {
    ssh: '~/.secrets/sf-ssh-password',
    rabbit: '~/.secrets/sf-ssh-password',
  },
  checks: [],
};

// ---------------------------------------------------------------------------
// makeHome — builds a hermetic ORCHESTRATOR_HOME for monthly tests
// ---------------------------------------------------------------------------
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-monthly-'));

  // SF config
  fs.mkdirSync(path.join(home, 'config/health/sf'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'config/health/sf/02006.json'),
    JSON.stringify(SF_CONFIG, null, 2),
  );

  // Report dir
  const reportDir = path.join(home, 'reports/sf-health/02006');
  fs.mkdirSync(reportDir, { recursive: true });

  // Seed two consolidated reports for 2026-05 — each with a SEVERITY line
  fs.writeFileSync(
    path.join(reportDir, 'consolidated-2026-05-01.md'),
    `# SpotFusion 02006 — Daily Report: 2026-05-01\n\n### SEVERITY: HEALTHY\n\n### Executive Summary\nAll checks passed.\n`,
  );
  fs.writeFileSync(
    path.join(reportDir, 'consolidated-2026-05-15.md'),
    `# SpotFusion 02006 — Daily Report: 2026-05-15\n\n### SEVERITY: WARNING\n\nDisk usage elevated.\n`,
  );

  return { home, reportDir };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function runMonthly(home, claudeEnv, month) {
  return spawnSync(
    'bash',
    ['scripts/health/core/monthly-consolidate.sh', 'sf', '02006', month],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...claudeEnv,
        ORCHESTRATOR_HOME: home,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Test 1 — monthly report file is created with stub output
// ---------------------------------------------------------------------------
test('monthly-consolidate.sh writes monthly-2026-05.md with Claude output', () => {
  const claudeStub = installCliStub('claude');
  const { home, reportDir } = makeHome();

  try {
    claudeStub.env['CLAUDE_STUB_OUT'] = CANNED_MONTHLY_REPORT;

    const result = runMonthly(home, claudeStub.env, '2026-05');
    if (result.status !== 0) {
      throw new Error(
        `monthly-consolidate.sh exited ${result.status}\nstderr: ${result.stderr}`,
      );
    }

    const monthlyFile = path.join(reportDir, 'monthly-2026-05.md');
    assert.ok(fs.existsSync(monthlyFile), `monthly-2026-05.md must exist at ${monthlyFile}`);

    const content = fs.readFileSync(monthlyFile, 'utf8');
    assert.ok(
      content.includes('SpotFusion 02006'),
      `monthly report must contain deployment name, got: ${content.slice(0, 300)}`,
    );
    assert.ok(
      content.includes('STABLE'),
      `monthly report must contain stub content (STABLE), got: ${content.slice(0, 300)}`,
    );
  } finally {
    claudeStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — claude stub was invoked with --model from config
// ---------------------------------------------------------------------------
test('monthly-consolidate.sh calls claude with --model from config', () => {
  const claudeStub = installCliStub('claude');
  const { home } = makeHome();

  try {
    claudeStub.env['CLAUDE_STUB_OUT'] = CANNED_MONTHLY_REPORT;

    const result = runMonthly(home, claudeStub.env, '2026-05');
    if (result.status !== 0) {
      throw new Error(
        `monthly-consolidate.sh exited ${result.status}\nstderr: ${result.stderr}`,
      );
    }

    const calls = claudeStub.readArgs();
    assert.ok(calls.length > 0, 'claude stub must have been invoked');

    const allArgs = calls.flat();
    const modelIdx = allArgs.indexOf('--model');
    assert.ok(modelIdx !== -1, `--model flag must be present in claude args: ${allArgs.join(' ')}`);
    assert.equal(
      allArgs[modelIdx + 1],
      'claude-opus-4-6',
      `--model must be claude-opus-4-6 (from config), got: ${allArgs[modelIdx + 1]}`,
    );
  } finally {
    claudeStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 — invalid month format exits non-zero
// ---------------------------------------------------------------------------
test('monthly-consolidate.sh rejects invalid month format', () => {
  const claudeStub = installCliStub('claude');
  const { home } = makeHome();

  try {
    claudeStub.env['CLAUDE_STUB_OUT'] = CANNED_MONTHLY_REPORT;

    const result = runMonthly(home, claudeStub.env, 'not-a-month');
    assert.notEqual(result.status, 0, 'should exit non-zero for invalid month format');
  } finally {
    claudeStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
