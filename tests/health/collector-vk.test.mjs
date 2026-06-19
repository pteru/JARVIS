/**
 * Tests for scripts/health/collectors/vk.sh
 *
 * Hermetic: temp ORCHESTRATOR_HOME with config + secret. sshpass is stubbed via
 * PATH so no real SSH is attempted.
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-col-vk-'));

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

  return { home };
}

function runCollector(env) {
  return spawnSync('bash', ['scripts/health/collectors/vk.sh', '03002'], {
    encoding: 'utf8',
    env,
    timeout: 15000,
  });
}

function latestSnapshot(home) {
  const dataDir = path.join(home, 'data/vk-health/03002');
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
// (a) Happy path: every sshpass call succeeds → all nodes reachable, snapshot
//     conforms to schema:1 (collector probes successfully but downstream cmd
//     output is the stub's single canned string — disk/gpu values that don't
//     parse are skipped, not faked).
// ---------------------------------------------------------------------------
test('(a) all sshpass calls succeed → schema:1 snapshot with all nodes reachable', () => {
  const sshpassStub = installCliStub('sshpass');
  const { home } = makeHome();

  try {
    const env = mergeEnvs(
      process.env,
      sshpassStub.env,
      {
        SSHPASS_STUB_OUT: 'ok',
        SSHPASS_STUB_EXIT: '0',
        ORCHESTRATOR_HOME: home,
      },
    );

    const result = runCollector(env);
    assert.equal(
      result.status,
      0,
      `vk.sh must exit 0 on happy path\nstderr: ${result.stderr}`,
    );

    const snap = latestSnapshot(home);
    assert.ok(snap, 'snapshot file must be written');

    const problems = validateSnapshot(snap);
    assert.deepEqual(problems, [], `snapshot violates schema: ${JSON.stringify(problems)}`);

    assert.equal(snap.schema, 1);
    assert.equal(snap.product, 'vk');
    assert.equal(snap.deployment, '03002');
    assert.equal(snap.nodes.length, 3, 'expected 3 nodes from fixture');
    assert.ok(snap.nodes.every(n => n.reachable === true), 'all nodes reachable in happy path');

    for (const n of ['vk01', 'vk02', 'vk03']) {
      assert.equal(snap.metrics[`node.${n}.reachable`], 1, `${n} reachable metric`);
    }
  } finally {
    sshpassStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) All sshpass calls fail → every node unreachable, ONLY reachable=0
//     metrics emitted (fail-open per SNAPSHOT.md).
// ---------------------------------------------------------------------------
test('(b) all sshpass calls fail → snapshot has only reachable:0 metrics per node', () => {
  const sshpassStub = installCliStub('sshpass');
  const { home } = makeHome();

  try {
    const env = mergeEnvs(
      process.env,
      sshpassStub.env,
      {
        SSHPASS_STUB_OUT: '',
        SSHPASS_STUB_EXIT: '255',  // ssh-style "could not connect"
        ORCHESTRATOR_HOME: home,
      },
    );

    const result = runCollector(env);
    assert.equal(
      result.status,
      0,
      `vk.sh must exit 0 even when all nodes unreachable\nstderr: ${result.stderr}`,
    );

    const snap = latestSnapshot(home);
    assert.ok(snap, 'snapshot file must be written');

    const problems = validateSnapshot(snap);
    assert.deepEqual(problems, [], `snapshot violates schema: ${JSON.stringify(problems)}`);

    assert.ok(snap.nodes.every(n => n.reachable === false), 'all nodes unreachable');

    // Fail-open: no node.<name>.<anything-other-than-reachable> for unreachable nodes
    const stray = Object.keys(snap.metrics).filter(k =>
      /^node\.[^.]+\./.test(k) && !k.endsWith('.reachable'),
    );
    assert.deepEqual(stray, [], `unreachable node must not emit non-reachable metrics, got: ${stray}`);

    for (const n of ['vk01', 'vk02', 'vk03']) {
      assert.equal(snap.metrics[`node.${n}.reachable`], 0, `${n} reachable=0`);
    }
  } finally {
    sshpassStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (c) Config with empty nodes object → collector refuses to write
// ---------------------------------------------------------------------------
test('(c) empty nodes object → collector refuses with non-zero exit', () => {
  const sshpassStub = installCliStub('sshpass');
  const { home } = makeHome({ nodes: {} });

  try {
    const env = mergeEnvs(
      process.env,
      sshpassStub.env,
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
      `vk.sh must exit non-zero when nodes is empty\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /No nodes defined/,
      'must log a clear error message',
    );
  } finally {
    sshpassStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
