/**
 * Tests for scripts/health/collectors/sf.sh
 *
 * Hermetic: temp ORCHESTRATOR_HOME with config + secret. sshpass and curl are
 * stubbed via PATH so no real SSH/HTTP is attempted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCliStub } from './helpers/cli-stub.mjs';
import { validateSnapshot } from './helpers/schema.mjs';

function mergeEnvs(base, ...stubs) {
  const result = { ...base };
  for (const stub of stubs) {
    for (const [k, v] of Object.entries(stub)) {
      if (k === 'PATH') {
        result.PATH = `${v.split(':')[0]}:${result.PATH ?? process.env.PATH}`;
      } else {
        result[k] = v;
      }
    }
  }
  return result;
}

function makeHome(configPatch = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-col-sf-'));

  fs.mkdirSync(path.join(home, 'config/health/sf'), { recursive: true });
  const fixture = JSON.parse(
    fs.readFileSync('tests/health/fixtures/config-sf.json', 'utf8'),
  );
  const secretFile = path.join(home, 'ssh-secret');
  fs.writeFileSync(secretFile, 'test-ssh-password\n', { mode: 0o600 });
  fixture.secrets = { ssh: secretFile, rabbit: secretFile };
  const merged = { ...fixture, ...configPatch };
  fs.writeFileSync(
    path.join(home, 'config/health/sf/02006.json'),
    JSON.stringify(merged, null, 2),
  );

  return { home };
}

function runCollector(env) {
  return spawnSync('bash', ['scripts/health/collectors/sf.sh', '02006'], {
    encoding: 'utf8',
    env,
    timeout: 15000,
  });
}

function latestSnapshot(home) {
  const dataDir = path.join(home, 'data/sf-health/02006');
  const today = new Date().toISOString().slice(0, 10);
  const dayDir = path.join(dataDir, today);
  if (!fs.existsSync(dayDir)) return null;
  const files = fs
    .readdirSync(dayDir)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(dayDir, files[files.length - 1]), 'utf8'));
}

// ---------------------------------------------------------------------------
// (a) Happy path: sshpass + curl succeed → schema:1 snapshot, node reachable,
//     queue totals summed from the RabbitMQ API payload. Disk/RAM values from
//     the stub's canned string don't parse → skipped, not faked.
// ---------------------------------------------------------------------------
test('(a) ssh + rabbit API succeed → schema:1 snapshot with queue total', () => {
  const sshpassStub = installCliStub('sshpass');
  const curlStub = installCliStub('curl');
  const { home } = makeHome();

  try {
    const env = mergeEnvs(
      process.env,
      sshpassStub.env,
      curlStub.env,
      {
        SSHPASS_STUB_OUT: 'ok',
        SSHPASS_STUB_EXIT: '0',
        CURL_STUB_OUT: JSON.stringify([
          { name: 'q1', messages: 3 },
          { name: 'q2', messages: 4 },
        ]),
        CURL_STUB_EXIT: '0',
        ORCHESTRATOR_HOME: home,
      },
    );

    const result = runCollector(env);
    assert.equal(
      result.status,
      0,
      `sf.sh must exit 0 on happy path\nstderr: ${result.stderr}`,
    );

    const snap = latestSnapshot(home);
    assert.ok(snap, 'snapshot file must be written');

    const problems = validateSnapshot(snap);
    assert.deepEqual(problems, [], `snapshot violates schema: ${JSON.stringify(problems)}`);

    assert.equal(snap.schema, 1);
    assert.equal(snap.product, 'sf');
    assert.equal(snap.deployment, '02006');
    assert.equal(snap.nodes.length, 1, 'expected 1 node from fixture');
    assert.equal(snap.nodes[0].reachable, true);
    assert.equal(snap.metrics['node.sf01.reachable'], 1);
    assert.equal(
      snap.metrics['node.sf01.queue.messages.total'],
      7,
      'queue total must be summed from the RabbitMQ API payload',
    );
  } finally {
    sshpassStub.cleanup();
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) SSH fails → node unreachable, ONLY reachable=0 emitted; the RabbitMQ
//     API must not contribute metrics for an unreachable node (fail-open).
// ---------------------------------------------------------------------------
test('(b) ssh fails → only reachable:0, no queue/disk/ram metrics', () => {
  const sshpassStub = installCliStub('sshpass');
  const curlStub = installCliStub('curl');
  const { home } = makeHome();

  try {
    const env = mergeEnvs(
      process.env,
      sshpassStub.env,
      curlStub.env,
      {
        SSHPASS_STUB_OUT: '',
        SSHPASS_STUB_EXIT: '255',
        CURL_STUB_OUT: JSON.stringify([{ name: 'q1', messages: 9 }]),
        CURL_STUB_EXIT: '0',
        ORCHESTRATOR_HOME: home,
      },
    );

    const result = runCollector(env);
    assert.equal(
      result.status,
      0,
      `sf.sh must exit 0 even when the node is unreachable\nstderr: ${result.stderr}`,
    );

    const snap = latestSnapshot(home);
    assert.ok(snap, 'snapshot file must be written');

    const problems = validateSnapshot(snap);
    assert.deepEqual(problems, [], `snapshot violates schema: ${JSON.stringify(problems)}`);

    assert.equal(snap.nodes[0].reachable, false);
    assert.equal(snap.metrics['node.sf01.reachable'], 0);

    const stray = Object.keys(snap.metrics).filter(k =>
      /^node\.[^.]+\./.test(k) && !k.endsWith('.reachable'),
    );
    assert.deepEqual(stray, [], `unreachable node must not emit other metrics, got: ${stray}`);
  } finally {
    sshpassStub.cleanup();
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (c) RabbitMQ API down (node itself reachable) → queue metric skipped
//     silently, run still exits 0 (fail-open per SNAPSHOT.md).
// ---------------------------------------------------------------------------
test('(c) rabbit API fails → queue metric skipped, exit 0', () => {
  const sshpassStub = installCliStub('sshpass');
  const curlStub = installCliStub('curl');
  const { home } = makeHome();

  try {
    const env = mergeEnvs(
      process.env,
      sshpassStub.env,
      curlStub.env,
      {
        SSHPASS_STUB_OUT: 'ok',
        SSHPASS_STUB_EXIT: '0',
        CURL_STUB_OUT: '',
        CURL_STUB_EXIT: '7', // curl "failed to connect"
        ORCHESTRATOR_HOME: home,
      },
    );

    const result = runCollector(env);
    assert.equal(
      result.status,
      0,
      `sf.sh must exit 0 when only the rabbit API is down\nstderr: ${result.stderr}`,
    );

    const snap = latestSnapshot(home);
    assert.ok(snap, 'snapshot file must be written');
    assert.equal(snap.metrics['node.sf01.reachable'], 1);
    assert.equal(
      'node.sf01.queue.messages.total' in snap.metrics,
      false,
      'queue metric must be absent when the API is unreachable — never zero-filled',
    );
  } finally {
    sshpassStub.cleanup();
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (d) Config with empty nodes object → collector refuses to write
// ---------------------------------------------------------------------------
test('(d) empty nodes object → collector refuses with non-zero exit', () => {
  const sshpassStub = installCliStub('sshpass');
  const curlStub = installCliStub('curl');
  const { home } = makeHome({ nodes: {} });

  try {
    const env = mergeEnvs(
      process.env,
      sshpassStub.env,
      curlStub.env,
      {
        SSHPASS_STUB_OUT: 'ok',
        SSHPASS_STUB_EXIT: '0',
        ORCHESTRATOR_HOME: home,
      },
    );

    const result = runCollector(env);
    assert.notEqual(
      result.status,
      0,
      `sf.sh must exit non-zero when nodes is empty\nstderr: ${result.stderr}`,
    );
    assert.match(result.stderr, /No nodes defined/);
  } finally {
    sshpassStub.cleanup();
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
