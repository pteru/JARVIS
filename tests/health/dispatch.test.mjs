import { test } from 'node:test'; import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

function makeEnv(home, coreDir) {
  return { ...process.env, ORCHESTRATOR_HOME: home, HEALTH_CORE_DIR: coreDir };
}

function makeTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-dispatch-'));
  fs.mkdirSync(path.join(home, 'config/health/vk'), { recursive: true });
  fs.copyFileSync('tests/health/fixtures/config-vk.json', path.join(home, 'config/health/vk/03002.json'));
  return home;
}

test('dispatches to core/analyze.sh with product and deployment args', () => {
  const home = makeTempHome();
  const coreDir = path.join(home, 'core');
  fs.mkdirSync(coreDir, { recursive: true });

  const argsFile = path.join(home, 'captured-args.txt');
  const stubScript = `#!/bin/bash\necho "$@" > "${argsFile}"\n`;
  fs.writeFileSync(path.join(coreDir, 'analyze.sh'), stubScript, { mode: 0o755 });

  execFileSync('bash', ['scripts/health/health.sh', 'vk', '03002', 'analyze'], {
    encoding: 'utf8',
    env: makeEnv(home, coreDir),
  });

  const captured = fs.readFileSync(argsFile, 'utf8').trim();
  assert.equal(captured, 'vk 03002');
});

test('exits non-zero when mode script does not exist', () => {
  const home = makeTempHome();
  const coreDir = path.join(home, 'core');
  fs.mkdirSync(coreDir, { recursive: true });

  const result = spawnSync('bash', ['scripts/health/health.sh', 'vk', '03002', 'nonexistent'], {
    encoding: 'utf8',
    env: makeEnv(home, coreDir),
  });

  assert.notEqual(result.status, 0, 'should exit non-zero for missing mode script');
});

test('exits non-zero when product argument is missing', () => {
  const result = spawnSync('bash', ['scripts/health/health.sh'], {
    encoding: 'utf8',
    env: process.env,
  });

  assert.notEqual(result.status, 0, 'should exit non-zero when product is missing');
});

test('exits non-zero when deployment argument is missing', () => {
  const result = spawnSync('bash', ['scripts/health/health.sh', 'vk'], {
    encoding: 'utf8',
    env: process.env,
  });

  assert.notEqual(result.status, 0, 'should exit non-zero when deployment is missing');
});
