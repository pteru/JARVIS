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
// Fixtures use the REAL consolidated format: "## HH:MM — SEVERITY"
// (em-dash U+2014, matching analyze.sh output)
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

  // Seed two consolidated reports for 2026-05 using the REAL format:
  //   ## HH:MM — SEVERITY   (em-dash U+2014, as emitted by analyze.sh)
  // Day 01: one HEALTHY check
  fs.writeFileSync(
    path.join(reportDir, 'consolidated-2026-05-01.md'),
    `# SpotFusion 02006 — Daily Report: 2026-05-01\n\n## 10:00 — HEALTHY\n\nAll checks passed.\n`,
  );
  // Day 15: one WARNING check
  fs.writeFileSync(
    path.join(reportDir, 'consolidated-2026-05-15.md'),
    `# SpotFusion 02006 — Daily Report: 2026-05-15\n\n## 14:30 — WARNING\n\nDisk usage elevated.\n`,
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
// installStdinCapturingStub — installs a 'claude' binary that:
//   1. Reads all of stdin into $STDIN_FILE
//   2. Records argv (same format as cli-stub.mjs)
//   3. Emits $CLAUDE_STUB_OUT to stdout
//
// Returns { dir, stdinFile, argvLog, env, cleanup() }
// ---------------------------------------------------------------------------
function installStdinCapturingStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stdin-stub-'));
  const stdinFile = path.join(dir, 'stdin.txt');
  const argvLog = path.join(dir, 'argv.log');
  const binPath = path.join(dir, 'claude');

  fs.writeFileSync(
    binPath,
    `#!/usr/bin/env bash
# Capture stdin
cat > "${stdinFile}"
# Record argv
{ for a in "$@"; do printf '%s\\n' "$a"; done; echo '==='; } >> "${argvLog}"
# Emit canned output
[[ -n "\${CLAUDE_STUB_OUT:-}" ]] && printf '%s\\n' "\${CLAUDE_STUB_OUT}"
exit "\${CLAUDE_STUB_EXIT:-0}"
`,
    { mode: 0o755 },
  );

  const env = {
    PATH: `${dir}:${process.env.PATH}`,
  };

  return {
    dir,
    stdinFile,
    argvLog,
    env,
    readStdin() {
      if (!fs.existsSync(stdinFile)) return '';
      return fs.readFileSync(stdinFile, 'utf-8');
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
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

// ---------------------------------------------------------------------------
// Test 4 — severity counts in the prompt piped to claude are non-zero and correct
//
// Fixture: 2 files seeded:
//   consolidated-2026-05-01.md → 1 HEALTHY line ("## 10:00 — HEALTHY")
//   consolidated-2026-05-15.md → 1 WARNING line ("## 14:30 — WARNING")
// Expected prompt contains:
//   "HEALTHY checks: 1"
//   "WARNING checks: 1"
//   "CRITICAL checks: 0"
//   "UNKNOWN checks: 0"
// ---------------------------------------------------------------------------
test('monthly-consolidate.sh passes correct non-zero severity counts via stdin to claude', () => {
  const stub = installStdinCapturingStub();
  const { home } = makeHome();

  try {
    stub.env['CLAUDE_STUB_OUT'] = CANNED_MONTHLY_REPORT;

    const result = runMonthly(home, stub.env, '2026-05');
    if (result.status !== 0) {
      throw new Error(
        `monthly-consolidate.sh exited ${result.status}\nstderr: ${result.stderr}`,
      );
    }

    const stdin = stub.readStdin();
    assert.ok(stdin.length > 0, 'claude must receive non-empty stdin (prompt)');

    assert.ok(
      stdin.includes('HEALTHY checks: 1'),
      `prompt must contain "HEALTHY checks: 1" (fixture has 1 HEALTHY line).\nPrompt excerpt:\n${stdin.slice(0, 600)}`,
    );
    assert.ok(
      stdin.includes('WARNING checks: 1'),
      `prompt must contain "WARNING checks: 1" (fixture has 1 WARNING line).\nPrompt excerpt:\n${stdin.slice(0, 600)}`,
    );
    assert.ok(
      stdin.includes('CRITICAL checks: 0'),
      `prompt must contain "CRITICAL checks: 0" (no CRITICAL in fixtures).\nPrompt excerpt:\n${stdin.slice(0, 600)}`,
    );
    assert.ok(
      stdin.includes('UNKNOWN checks: 0'),
      `prompt must contain "UNKNOWN checks: 0" (no UNKNOWN in fixtures).\nPrompt excerpt:\n${stdin.slice(0, 600)}`,
    );
  } finally {
    stub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
