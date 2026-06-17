import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCliStub } from './helpers/cli-stub.mjs';

// Canned Claude report — contains SEVERITY and NEW IMPROVEMENTS block
const CANNED_REPORT = `
### SEVERITY: WARNING

### Executive Summary
System is degraded. vk02 disk at 95%.

### NEW IMPROVEMENTS
1. Do the thing
2. Another improvement
`;

/**
 * Build a hermetic ORCHESTRATOR_HOME for analyze.sh tests:
 *   config/health/vk/03002.json       — from fixture
 *   data/vk-health/03002/<today-utc>/  — two snapshots seeded
 */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-analyze-'));

  // VK config
  fs.mkdirSync(path.join(home, 'config/health/vk'), { recursive: true });
  const fixture = JSON.parse(
    fs.readFileSync('tests/health/fixtures/config-vk.json', 'utf8'),
  );
  // Patch secrets so config.sh never reads ~/.secrets/*
  const secretFile = path.join(home, 'ssh-secret');
  fs.writeFileSync(secretFile, 'test-ssh-password\n', { mode: 0o600 });
  fixture.secrets = { ...fixture.secrets, ssh: secretFile, rabbit: secretFile };
  fs.writeFileSync(
    path.join(home, 'config/health/vk/03002.json'),
    JSON.stringify(fixture, null, 2),
  );

  // Seed two snapshots into today's UTC date dir
  const todayUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dataDir = path.join(home, 'data/vk-health/03002');
  const snapshotDir = path.join(dataDir, todayUtc);
  fs.mkdirSync(snapshotDir, { recursive: true });

  // Two snapshots at different times
  fs.copyFileSync(
    'tests/health/fixtures/snapshot-vk.json',
    path.join(snapshotDir, 'snapshot-11-00-00.json'),
  );
  fs.copyFileSync(
    'tests/health/fixtures/snapshot-vk.json',
    path.join(snapshotDir, 'snapshot-12-00-00.json'),
  );

  const reportDir = path.join(home, 'reports/vk-health/03002');
  fs.mkdirSync(reportDir, { recursive: true });

  return { home, dataDir, reportDir };
}

test('analyze.sh writes latest.md with report content', () => {
  const claudeStub = installCliStub('claude');
  const { home, reportDir } = makeHome();

  try {
    claudeStub.env['CLAUDE_STUB_OUT'] = CANNED_REPORT;

    execFileSync('bash', ['scripts/health/core/analyze.sh', 'vk', '03002'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...claudeStub.env,
        ORCHESTRATOR_HOME: home,
      },
    });

    // latest.md must exist and contain the stub's report
    const latestFile = path.join(reportDir, 'latest.md');
    assert.ok(fs.existsSync(latestFile), 'latest.md must exist');
    const latestContent = fs.readFileSync(latestFile, 'utf8');
    assert.ok(
      latestContent.includes('### SEVERITY: WARNING'),
      `latest.md must contain the SEVERITY line, got: ${latestContent.slice(0, 200)}`,
    );

  } finally {
    claudeStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('analyze.sh appends WARNING header to improvements.md', () => {
  const claudeStub = installCliStub('claude');
  const { home, reportDir } = makeHome();

  try {
    claudeStub.env['CLAUDE_STUB_OUT'] = CANNED_REPORT;

    execFileSync('bash', ['scripts/health/core/analyze.sh', 'vk', '03002'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...claudeStub.env,
        ORCHESTRATOR_HOME: home,
      },
    });

    // improvements.md must be appended with a ## <date> -- WARNING header
    const improvementsFile = path.join(reportDir, 'improvements.md');
    assert.ok(fs.existsSync(improvementsFile), 'improvements.md must exist');
    const improvementsContent = fs.readFileSync(improvementsFile, 'utf8');
    assert.ok(
      improvementsContent.includes('WARNING'),
      `improvements.md must contain WARNING, got: ${improvementsContent.slice(0, 400)}`,
    );
    // Should have a ## <date> header line
    const todayUtc = new Date().toISOString().slice(0, 10);
    assert.ok(
      improvementsContent.includes(`## ${todayUtc}`),
      `improvements.md must include today's date header, got: ${improvementsContent.slice(0, 400)}`,
    );
    // Should have the actual improvement text
    assert.ok(
      improvementsContent.includes('Do the thing'),
      `improvements.md must contain improvement text, got: ${improvementsContent.slice(0, 400)}`,
    );

  } finally {
    claudeStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('analyze.sh calls claude with --model claude-opus-4-6', () => {
  const claudeStub = installCliStub('claude');
  const { home } = makeHome();

  try {
    claudeStub.env['CLAUDE_STUB_OUT'] = CANNED_REPORT;

    execFileSync('bash', ['scripts/health/core/analyze.sh', 'vk', '03002'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...claudeStub.env,
        ORCHESTRATOR_HOME: home,
      },
    });

    // claude stub must have been invoked with --model claude-opus-4-6
    const calls = claudeStub.readArgs();
    assert.ok(calls.length > 0, 'claude must have been called');

    const allArgs = calls.flat();
    // Find index of --model and check next element
    const modelIdx = allArgs.indexOf('--model');
    assert.ok(modelIdx !== -1, `--model flag must be present in claude args: ${allArgs.join(' ')}`);
    assert.equal(
      allArgs[modelIdx + 1],
      'claude-opus-4-6',
      `--model value must be claude-opus-4-6, got: ${allArgs[modelIdx + 1]}`,
    );

  } finally {
    claudeStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
