import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a hermetic ORCHESTRATOR_HOME for trends.sh tests.
 * Returns { home, dataDir, snapshotDir, todayUtc, reportDir, configPath }
 */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-trends-'));

  // VK config — copy fixture and patch secrets to safe paths
  fs.mkdirSync(path.join(home, 'config/health/vk'), { recursive: true });
  const fixture = JSON.parse(
    fs.readFileSync('tests/health/fixtures/config-vk.json', 'utf8'),
  );
  const secretFile = path.join(home, 'ssh-secret');
  fs.writeFileSync(secretFile, 'test-password\n', { mode: 0o600 });
  fixture.secrets = { ...fixture.secrets, ssh: secretFile, rabbit: secretFile };
  const configPath = path.join(home, 'config/health/vk/03002.json');
  fs.writeFileSync(configPath, JSON.stringify(fixture, null, 2));

  // Compute today UTC
  const todayUtc = new Date().toISOString().slice(0, 10);
  const dataDir = path.join(home, 'data/vk-health/03002');
  const snapshotDir = path.join(dataDir, todayUtc);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const reportDir = path.join(home, 'reports/vk-health/03002');
  fs.mkdirSync(reportDir, { recursive: true });

  return { home, dataDir, snapshotDir, todayUtc, reportDir, configPath };
}

/**
 * Load the fixture snapshot and patch the value of a single metric key.
 */
function buildSnapshot(metricKey, value) {
  const base = JSON.parse(
    fs.readFileSync('tests/health/fixtures/snapshot-vk.json', 'utf8'),
  );
  base.metrics[metricKey] = value;
  // Vary the collected_at so the files differ
  base.collected_at = new Date().toISOString();
  return JSON.stringify(base, null, 2);
}

/**
 * Run trends.sh with an overridden ORCHESTRATOR_HOME.
 * Returns { status, stdout, stderr }.
 */
function runTrends(home) {
  const result = spawnSync(
    'bash',
    ['scripts/health/core/trends.sh', 'vk', '03002'],
    {
      encoding: 'utf8',
      env: { ...process.env, ORCHESTRATOR_HOME: home },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ---------------------------------------------------------------------------
// Test 1 — trends.json is created with correct min/max/avg
// ---------------------------------------------------------------------------
test('trends.sh creates trends.json with correct min/max/avg', () => {
  const { home, snapshotDir, todayUtc, dataDir } = makeHome();

  const METRIC = 'node.vk01.disk.root.pct';
  // Three snapshots with values 50, 70, 90 → min=50 max=90 avg=70
  fs.writeFileSync(
    path.join(snapshotDir, 'snapshot-06-00-00.json'),
    buildSnapshot(METRIC, 50),
  );
  fs.writeFileSync(
    path.join(snapshotDir, 'snapshot-12-00-00.json'),
    buildSnapshot(METRIC, 70),
  );
  fs.writeFileSync(
    path.join(snapshotDir, 'snapshot-18-00-00.json'),
    buildSnapshot(METRIC, 90),
  );

  const { status, stderr } = runTrends(home);
  if (status !== 0) {
    throw new Error(`trends.sh exited ${status}\nstderr: ${stderr}`);
  }

  const trendsPath = path.join(dataDir, todayUtc, 'trends.json');
  assert.ok(fs.existsSync(trendsPath), `trends.json not found at ${trendsPath}`);

  const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8'));

  // Validate meta block
  assert.equal(trends.meta.deployment_id, '03002', 'meta.deployment_id');
  assert.equal(trends.meta.date, todayUtc, 'meta.date');
  assert.equal(trends.meta.snapshot_count, 3, 'meta.snapshot_count');

  // Validate the metric we seeded
  const m = trends.metrics?.[METRIC];
  assert.ok(m, `trends.metrics["${METRIC}"] not present`);
  assert.equal(m.min, 50, `min expected 50, got ${m.min}`);
  assert.equal(m.max, 90, `max expected 90, got ${m.max}`);
  assert.equal(m.avg, 70, `avg expected 70, got ${m.avg}`);
  assert.equal(m.samples, 3, `samples expected 3, got ${m.samples}`);

  fs.rmSync(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 2 — snapshot retention: old date-dir pruned, today's kept
// ---------------------------------------------------------------------------
test('trends.sh prunes snapshot dirs older than retention window', () => {
  const { home, snapshotDir, dataDir, todayUtc } = makeHome();

  const METRIC = 'node.vk01.disk.root.pct';
  // Seed today's snapshots (retention window must NOT prune today)
  fs.writeFileSync(
    path.join(snapshotDir, 'snapshot-08-00-00.json'),
    buildSnapshot(METRIC, 60),
  );

  // Seed an old snapshot dir (200 days before today — well past 90-day default)
  const oldDate = new Date();
  oldDate.setUTCDate(oldDate.getUTCDate() - 200);
  const oldDateStr = oldDate.toISOString().slice(0, 10);
  const oldDir = path.join(dataDir, oldDateStr);
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(
    path.join(oldDir, 'snapshot-00-00-00.json'),
    buildSnapshot(METRIC, 42),
  );

  const { status, stderr } = runTrends(home);
  if (status !== 0) {
    throw new Error(`trends.sh exited ${status}\nstderr: ${stderr}`);
  }

  // Old dir must be deleted
  assert.ok(
    !fs.existsSync(oldDir),
    `Expected old snapshot dir to be pruned: ${oldDir}`,
  );

  // Today's dir must still exist
  assert.ok(
    fs.existsSync(snapshotDir),
    `Expected today's snapshot dir to survive: ${snapshotDir}`,
  );

  fs.rmSync(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 3 — trends.sh is idempotent (re-run overwrites trends.json cleanly)
// ---------------------------------------------------------------------------
test('trends.sh is idempotent — second run overwrites trends.json', () => {
  const { home, snapshotDir, todayUtc, dataDir } = makeHome();

  const METRIC = 'node.vk01.disk.root.pct';
  fs.writeFileSync(
    path.join(snapshotDir, 'snapshot-09-00-00.json'),
    buildSnapshot(METRIC, 80),
  );

  runTrends(home); // first run
  const { status } = runTrends(home); // second run
  assert.equal(status, 0, 'Second run should exit 0');

  const trendsPath = path.join(dataDir, todayUtc, 'trends.json');
  const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8'));
  assert.equal(trends.metrics?.[METRIC]?.avg, 80, 'avg should be 80 after idempotent run');

  fs.rmSync(home, { recursive: true, force: true });
});
