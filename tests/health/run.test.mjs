/**
 * Tests for scripts/health/core/run.sh
 *
 * Hermetic: uses a temp ORCHESTRATOR_HOME so no real Telegram/SSH is touched.
 * Stubs: ping + curl via installCliStub; collector/analyze/alert via temp bash scripts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCliStub } from './helpers/cli-stub.mjs';

// ---------------------------------------------------------------------------
// mergeEnvs: merge multiple stub env objects, combining PATH entries
// ---------------------------------------------------------------------------
function mergeEnvs(base, ...stubs) {
  const result = { ...base };
  for (const stub of stubs) {
    for (const [k, v] of Object.entries(stub)) {
      if (k === 'PATH') {
        // Prepend all stub dirs, keeping existing PATH at end
        result.PATH = `${v.split(':')[0]}:${result.PATH ?? process.env.PATH}`;
      } else {
        result[k] = v;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// makeHome: hermetic ORCHESTRATOR_HOME with config + fake telegram
// ---------------------------------------------------------------------------
function makeHome(configPatch = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-run-'));

  fs.mkdirSync(path.join(home, 'config/health/vk'), { recursive: true });
  const fixture = JSON.parse(
    fs.readFileSync('tests/health/fixtures/config-vk.json', 'utf8'),
  );
  const secretFile = path.join(home, 'ssh-secret');
  fs.writeFileSync(secretFile, 'test-ssh-password\n', { mode: 0o600 });
  fixture.secrets = { ssh: secretFile, rabbit: secretFile };
  const merged = { ...fixture, ...configPatch };
  fs.writeFileSync(
    path.join(home, 'config/health/vk/03002.json'),
    JSON.stringify(merged, null, 2),
  );

  fs.mkdirSync(path.join(home, 'config/orchestrator'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'config/orchestrator/notifications.json'),
    JSON.stringify({
      backends: { telegram: { bot_token: 'FAKE_TOKEN', chat_id: 'FAKE_CHAT' } },
    }),
  );

  const dataDir = path.join(home, 'data/vk-health/03002');
  fs.mkdirSync(dataDir, { recursive: true });

  return { home, dataDir };
}

// ---------------------------------------------------------------------------
// makeCoreStubs: temp dir with analyze.sh + alert.sh stubs
// orderFile is shared with the collector stub (appended to build call order)
// ---------------------------------------------------------------------------
function makeCoreStubs(home, opts = {}) {
  const coreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-core-'));
  const orderFile = path.join(home, 'order.txt');
  const alertCount = opts.alertCount ?? 0;

  // DATA_DIR path mirrors what config.sh computes for vk/03002
  const dataDir = `${home}/data/vk-health/03002`;

  fs.writeFileSync(
    path.join(coreDir, 'analyze.sh'),
    `#!/bin/bash
echo "analyze" >> "${orderFile}"
exit ${opts.analyzeExit ?? 0}
`,
    { mode: 0o755 },
  );

  fs.writeFileSync(
    path.join(coreDir, 'alert.sh'),
    `#!/bin/bash
echo "alert" >> "${orderFile}"
mkdir -p "${dataDir}"
echo "${alertCount}" > "${dataDir}/last-alert-count"
exit ${opts.alertExit ?? 0}
`,
    { mode: 0o755 },
  );

  return { coreDir, orderFile };
}

// ---------------------------------------------------------------------------
// makeCollectorStub: temp dir with vk.sh collector stub
// ---------------------------------------------------------------------------
function makeCollectorStub(orderFile, opts = {}) {
  const collectorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-col-'));
  const collectorMarker = path.join(collectorDir, 'collector-called');

  fs.writeFileSync(
    path.join(collectorDir, 'vk.sh'),
    `#!/bin/bash
echo "collector" >> "${orderFile}"
touch "${collectorMarker}"
exit ${opts.collectorExit ?? 0}
`,
    { mode: 0o755 },
  );

  return { collectorDir, collectorMarker };
}

// ---------------------------------------------------------------------------
// runScript: calls run.sh vk 03002 (sync, never throws)
// ---------------------------------------------------------------------------
function runScript(env) {
  return spawnSync('bash', ['scripts/health/core/run.sh', 'vk', '03002'], {
    encoding: 'utf8',
    env,
    timeout: 15000,
  });
}

// ---------------------------------------------------------------------------
// (a) Campaign gate: enabled=false → exits 0, collector NOT invoked
// ---------------------------------------------------------------------------
test('(a) campaign gate: enabled=false exits 0 without invoking collector', () => {
  const pingStub = installCliStub('ping');
  const curlStub = installCliStub('curl');
  const { home } = makeHome({ enabled: false });
  const { coreDir, orderFile } = makeCoreStubs(home);
  const { collectorDir, collectorMarker } = makeCollectorStub(orderFile);

  try {
    const env = mergeEnvs(
      process.env,
      pingStub.env,
      curlStub.env,
      {
        ORCHESTRATOR_HOME: home,
        HEALTH_COLLECTOR_DIR: collectorDir,
        HEALTH_CORE_DIR: coreDir,
      },
    );

    const result = runScript(env);

    assert.equal(
      result.status,
      0,
      `run.sh must exit 0 when pipeline disabled\nstderr: ${result.stderr}`,
    );
    assert.ok(
      !fs.existsSync(collectorMarker),
      'Collector must NOT be invoked when pipeline is disabled',
    );
    assert.equal(
      pingStub.readArgs().length,
      0,
      'ping must not be called when pipeline is disabled',
    );
  } finally {
    pingStub.cleanup();
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(coreDir, { recursive: true, force: true });
    fs.rmSync(collectorDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) Connectivity gate: all pings fail → alert with CONNECTIVITY_LABEL,
//     collector NOT invoked, exits non-zero
// ---------------------------------------------------------------------------
test('(b) connectivity gate: all pings fail → alert sent, collector NOT invoked', () => {
  const pingStub = installCliStub('ping');
  const curlStub = installCliStub('curl');
  const { home } = makeHome();
  const { coreDir, orderFile } = makeCoreStubs(home);
  const { collectorDir, collectorMarker } = makeCollectorStub(orderFile);

  try {
    const env = mergeEnvs(
      process.env,
      pingStub.env,
      curlStub.env,
      {
        PING_STUB_EXIT: '1',   // all pings fail
        CURL_STUB_OUT: '200',
        ORCHESTRATOR_HOME: home,
        HEALTH_COLLECTOR_DIR: collectorDir,
        HEALTH_CORE_DIR: coreDir,
      },
    );

    const result = runScript(env);

    assert.notEqual(
      result.status,
      0,
      `run.sh must exit non-zero when connectivity fails\nstderr: ${result.stderr}`,
    );

    const curlCalls = curlStub.readArgs();
    assert.ok(
      curlCalls.length > 0,
      'curl must be called to send connectivity alert when all pings fail',
    );

    const allArgs = curlCalls.flat().join('\n');
    const label = 'VisionKing nodes'; // fixture connectivity.label
    assert.ok(
      allArgs.includes(label),
      `Connectivity alert must include CONNECTIVITY_LABEL="${label}"\nActual curl args:\n${allArgs}`,
    );

    assert.ok(
      !fs.existsSync(collectorMarker),
      'Collector must NOT be invoked when connectivity check fails',
    );
  } finally {
    pingStub.cleanup();
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(coreDir, { recursive: true, force: true });
    fs.rmSync(collectorDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (c) Happy path: pings ok → collector → analyze → alert in order
// ---------------------------------------------------------------------------
test('(c) happy path: pings succeed → collector, analyze, alert called in order', () => {
  const pingStub = installCliStub('ping');
  const curlStub = installCliStub('curl');
  const { home } = makeHome();
  const { coreDir, orderFile } = makeCoreStubs(home, { alertCount: 0 });
  const { collectorDir } = makeCollectorStub(orderFile);

  try {
    const env = mergeEnvs(
      process.env,
      pingStub.env,
      curlStub.env,
      {
        PING_STUB_EXIT: '0',   // pings succeed
        CURL_STUB_OUT: '200',
        ORCHESTRATOR_HOME: home,
        HEALTH_COLLECTOR_DIR: collectorDir,
        HEALTH_CORE_DIR: coreDir,
      },
    );

    const result = runScript(env);

    assert.equal(
      result.status,
      0,
      `run.sh must exit 0 on success\nstderr: ${result.stderr}`,
    );

    assert.ok(fs.existsSync(orderFile), `order file not found: ${orderFile}`);
    const order = fs.readFileSync(orderFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.deepEqual(
      order,
      ['collector', 'analyze', 'alert'],
      `Expected collector→analyze→alert, got: ${JSON.stringify(order)}\nstderr: ${result.stderr}`,
    );
  } finally {
    pingStub.cleanup();
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(coreDir, { recursive: true, force: true });
    fs.rmSync(collectorDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (e) Regression: collector failure must suppress heartbeat "ALL CLEAR"
//
// Bug: when collection failed (EXIT_STATUS=1) but alert.sh exited 0 with
// alertCount=0, the Gate 7 condition (ALERTS_SENT==0 && ALERT_EXIT==0) was
// satisfied and a false "ALL CLEAR" heartbeat was sent. Fix: also require
// EXIT_STATUS==0 before sending heartbeat — partial pipeline can't certify
// health.
// ---------------------------------------------------------------------------
test('(e) heartbeat suppressed when collection fails (EXIT_STATUS=1)', () => {
  const pingStub = installCliStub('ping');
  const curlStub = installCliStub('curl');
  const { home } = makeHome();
  // alert.sh succeeds with 0 alerts (collector failure means analyze is
  // skipped, so alert just sees an empty state and exits clean)
  const { coreDir, orderFile } = makeCoreStubs(home, { alertCount: 0, alertExit: 0 });
  // collector fails
  const { collectorDir } = makeCollectorStub(orderFile, { collectorExit: 1 });

  try {
    const env = mergeEnvs(
      process.env,
      pingStub.env,
      curlStub.env,
      {
        PING_STUB_EXIT: '0',
        CURL_STUB_OUT: '200',
        ORCHESTRATOR_HOME: home,
        HEALTH_COLLECTOR_DIR: collectorDir,
        HEALTH_CORE_DIR: coreDir,
      },
    );

    const result = runScript(env);

    assert.notEqual(
      result.status,
      0,
      `run.sh must exit non-zero when collector fails\nstderr: ${result.stderr}`,
    );

    const curlBodies = curlStub.readArgs().flat().join('\n');
    assert.ok(
      !curlBodies.includes('ALL CLEAR'),
      `Heartbeat "ALL CLEAR" must NOT be sent when EXIT_STATUS != 0\nActual curl args:\n${curlBodies}`,
    );
  } finally {
    pingStub.cleanup();
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(coreDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (d) Lock: while lock is held, concurrent run.sh exits 0 without collecting
// ---------------------------------------------------------------------------
test('(d) lock: second run exits 0 without invoking collector when lock is held', async () => {
  const pingStub = installCliStub('ping');
  const curlStub = installCliStub('curl');
  const { home } = makeHome();
  const { coreDir, orderFile } = makeCoreStubs(home, { alertCount: 0 });
  const { collectorDir, collectorMarker } = makeCollectorStub(orderFile);

  const lockFile = '/tmp/health-vk-03002.lock';

  try {
    const env = mergeEnvs(
      process.env,
      pingStub.env,
      curlStub.env,
      {
        PING_STUB_EXIT: '0',
        CURL_STUB_OUT: '200',
        ORCHESTRATOR_HOME: home,
        HEALTH_COLLECTOR_DIR: collectorDir,
        HEALTH_CORE_DIR: coreDir,
      },
    );

    // Use a named pipe (fifo) to know exactly when the holder has the lock
    const fifoPath = path.join(home, 'sync.fifo');
    spawnSync('bash', ['-c', `mkfifo "${fifoPath}"`]);

    // Background process: acquire lock, signal via fifo, then sleep
    const holder = spawn('bash', ['-c', `
      exec 200>"${lockFile}"
      flock -n 200 || exit 1
      printf 'y' > "${fifoPath}"
      sleep 10
    `], { stdio: 'ignore' });

    // Block until holder signals it has the lock
    spawnSync('bash', ['-c', `cat "${fifoPath}" > /dev/null`], { timeout: 3000 });

    // Run the second instance — should see lock busy and exit 0
    const result = runScript(env);

    holder.kill();

    assert.equal(
      result.status,
      0,
      `Second run.sh must exit 0 when lock is held\nstderr: ${result.stderr}`,
    );
    assert.ok(
      !fs.existsSync(collectorMarker),
      'Collector must NOT be invoked when run.sh cannot acquire the lock',
    );
  } finally {
    pingStub.cleanup();
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(coreDir, { recursive: true, force: true });
    fs.rmSync(collectorDir, { recursive: true, force: true });
    try { fs.unlinkSync(lockFile); } catch (_) {}
  }
});
