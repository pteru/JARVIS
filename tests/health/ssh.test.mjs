import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCliStub } from './helpers/cli-stub.mjs';

/**
 * Set up a temporary ORCHESTRATOR_HOME with a self-contained VK config in
 * the expected path: config/health/vk/03002.json
 *
 * Rather than copying the shared fixture verbatim (whose secrets.ssh points at
 * the real ~/.secrets/vk-ssh-password), we read the fixture, override
 * secrets.ssh to an absolute path inside the temp home, and write the patched
 * config there.  This makes the test fully hermetic — no real ~/.secrets file
 * is needed.
 */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-ssh-'));
  fs.mkdirSync(path.join(home, 'config/health/vk'), { recursive: true });

  // Write a dummy SSH secret that load_health_config will resolve
  const secretFile = path.join(home, 'ssh-secret');
  fs.writeFileSync(secretFile, 'test-ssh-password\n', { mode: 0o600 });

  // Patch the fixture: override secrets.ssh so config.sh never reads ~/.secrets
  const fixture = JSON.parse(
    fs.readFileSync('tests/health/fixtures/config-vk.json', 'utf8'),
  );
  fixture.secrets = { ...fixture.secrets, ssh: secretFile };
  fs.writeFileSync(
    path.join(home, 'config/health/vk/03002.json'),
    JSON.stringify(fixture, null, 2),
  );

  return { home, secretFile };
}

test('ssh_cmd vk01 calls sshpass with correct host and port', () => {
  const stub = installCliStub('sshpass');
  const { home, secretFile } = makeHome();

  try {
    const script = `
      source scripts/health/lib/config.sh
      load_health_config vk 03002
      source scripts/health/lib/ssh.sh
      ssh_cmd vk01 'echo hi'
    `;
    execFileSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...stub.env,
        ORCHESTRATOR_HOME: home,
        HEALTH_SSH_SECRET: secretFile,
      },
    });

    const calls = stub.readArgs();
    assert.ok(calls.length > 0, 'sshpass stub must have been called at least once');

    // Flatten all args across all invocations into one array for searching
    const allArgs = calls.flat();
    assert.ok(
      allArgs.some(a => a.includes('vk01@10.244.70.26')),
      `Expected vk01@10.244.70.26 in sshpass args, got: ${JSON.stringify(allArgs)}`,
    );
    assert.ok(
      allArgs.includes('8050'),
      `Expected port 8050 in sshpass args, got: ${JSON.stringify(allArgs)}`,
    );
  } finally {
    stub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('is_node_reachable vk01 returns non-zero when sshpass fails', () => {
  const stub = installCliStub('sshpass');
  const { home, secretFile } = makeHome();

  try {
    const script = `
      source scripts/health/lib/config.sh
      load_health_config vk 03002
      source scripts/health/lib/ssh.sh
      is_node_reachable vk01
    `;
    let exitCode = 0;
    try {
      execFileSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...stub.env,
          SSHPASS_STUB_EXIT: '1',
          ORCHESTRATOR_HOME: home,
          HEALTH_SSH_SECRET: secretFile,
        },
      });
    } catch (err) {
      exitCode = err.status ?? 1;
    }

    assert.ok(exitCode !== 0, 'is_node_reachable must return non-zero when sshpass exits 1');
  } finally {
    stub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
