import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCliStub } from './helpers/cli-stub.mjs';

/**
 * Build a hermetic ORCHESTRATOR_HOME for alert.sh tests:
 *   config/health/vk/03002.json  — from fixture
 *   config/orchestrator/notifications.json — minimal fake Telegram config
 *   data/vk-health/03002/<today-utc>/snapshot-12-00-00.json — seeded from fixture
 *
 * Returns { home, dataDir, snapshotPath }
 */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-alert-'));

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

  // Fake Telegram notifications config (shape telegram.sh reads in legacy fallback)
  fs.mkdirSync(path.join(home, 'config/orchestrator'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'config/orchestrator/notifications.json'),
    JSON.stringify({
      backends: {
        telegram: {
          bot_token: 'FAKE_TOKEN',
          chat_id: 'FAKE_CHAT',
        },
      },
    }),
  );

  // Seed snapshot — today UTC date dir
  const todayUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dataDir = path.join(home, 'data/vk-health/03002');
  const snapshotDir = path.join(dataDir, todayUtc);
  fs.mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, 'snapshot-12-00-00.json');
  fs.copyFileSync('tests/health/fixtures/snapshot-vk.json', snapshotPath);

  return { home, dataDir, snapshotPath };
}

test('alert.sh fires crit+warn alerts and writes last-alert-count=2', () => {
  const curlStub = installCliStub('curl');
  const { home, dataDir } = makeHome();

  try {
    // Stub curl to return "200" (HTTP code) — telegram.sh expects this
    curlStub.env['CURL_STUB_OUT'] = '200';

    execFileSync('bash', ['scripts/health/core/alert.sh', 'vk', '03002'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...curlStub.env,
        ORCHESTRATOR_HOME: home,
      },
    });

    // --- Assert: curl was called (telegram message sent) ---
    const calls = curlStub.readArgs();
    assert.ok(calls.length > 0, 'curl must have been called to send Telegram message');

    // Join ALL captured args into one string to search message content.
    // jq pretty-prints JSON so the -d body spans multiple argv entries.
    const allArgsStr = calls.flat().join('\n');

    // vk02 disk.root.pct=95 → crit → 🔴 + "Root disk"
    assert.ok(allArgsStr.includes('Root disk'), `Expected "Root disk" in curl args: ${allArgsStr}`);
    assert.ok(allArgsStr.includes('🔴'), `Expected 🔴 in curl args: ${allArgsStr}`);

    // vk01 gpu.0.mem.pct=91 → warn → 🟡 + "GPU memory"
    assert.ok(allArgsStr.includes('GPU memory'), `Expected "GPU memory" in curl args: ${allArgsStr}`);
    assert.ok(allArgsStr.includes('🟡'), `Expected 🟡 in curl args: ${allArgsStr}`);

    // service.does_not_exist.up → unknown → must NOT fire
    assert.ok(!allArgsStr.includes('Nonexistent'), `"Nonexistent" check must not appear in alerts: ${allArgsStr}`);

    // --- Assert: last-alert-count = 2 ---
    const countFile = path.join(dataDir, 'last-alert-count');
    assert.ok(fs.existsSync(countFile), 'last-alert-count file must exist');
    const count = fs.readFileSync(countFile, 'utf8').trim();
    assert.equal(count, '2', `last-alert-count must be 2, got: ${count}`);

    // --- Assert: alert-state.json was written ---
    const stateFile = path.join(dataDir, 'alert-state.json');
    assert.ok(fs.existsSync(stateFile), 'alert-state.json must exist');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const keys = Object.keys(state);
    assert.equal(keys.length, 2, `alert-state must have 2 entries, got: ${JSON.stringify(keys)}`);

  } finally {
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('alert.sh second run within cooldown sends no new message and writes last-alert-count=0', () => {
  const curlStub = installCliStub('curl');
  const { home, dataDir } = makeHome();

  try {
    curlStub.env['CURL_STUB_OUT'] = '200';

    const env = {
      ...process.env,
      ...curlStub.env,
      ORCHESTRATOR_HOME: home,
    };

    // First run — populates alert-state.json
    execFileSync('bash', ['scripts/health/core/alert.sh', 'vk', '03002'], {
      encoding: 'utf8',
      env,
    });

    const callsAfterFirst = curlStub.readArgs();
    assert.ok(callsAfterFirst.length > 0, 'first run must have called curl');

    // Clear the stub log so we can count only second-run calls
    fs.writeFileSync(curlStub.logFile, '');

    // Second run — everything still in cooldown
    execFileSync('bash', ['scripts/health/core/alert.sh', 'vk', '03002'], {
      encoding: 'utf8',
      env,
    });

    const callsAfterSecond = curlStub.readArgs();
    assert.equal(
      callsAfterSecond.length,
      0,
      `second run must NOT call curl (cooldown dedup), got ${callsAfterSecond.length} call(s)`,
    );

    // last-alert-count for second run must be 0
    const countFile = path.join(dataDir, 'last-alert-count');
    const count = fs.readFileSync(countFile, 'utf8').trim();
    assert.equal(count, '0', `last-alert-count after second run must be 0, got: ${count}`);

  } finally {
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('alert.sh exits 0 cleanly when no snapshot directory exists', () => {
  const curlStub = installCliStub('curl');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-alert-nosnapshot-'));

  try {
    // Minimal config — no snapshot directory seeded
    fs.mkdirSync(path.join(home, 'config/health/vk'), { recursive: true });
    const fixture = JSON.parse(
      fs.readFileSync('tests/health/fixtures/config-vk.json', 'utf8'),
    );
    const secretFile = path.join(home, 'ssh-secret');
    fs.writeFileSync(secretFile, 'test-ssh-password\n', { mode: 0o600 });
    fixture.secrets = { ...fixture.secrets, ssh: secretFile, rabbit: secretFile };
    fs.writeFileSync(
      path.join(home, 'config/health/vk/03002.json'),
      JSON.stringify(fixture, null, 2),
    );
    fs.mkdirSync(path.join(home, 'config/orchestrator'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'config/orchestrator/notifications.json'),
      JSON.stringify({ backends: { telegram: { bot_token: 'X', chat_id: 'Y' } } }),
    );

    curlStub.env['CURL_STUB_OUT'] = '200';

    // Must exit 0 — no snapshot is a no-op, not an error
    execFileSync('bash', ['scripts/health/core/alert.sh', 'vk', '03002'], {
      encoding: 'utf8',
      env: { ...process.env, ...curlStub.env, ORCHESTRATOR_HOME: home },
    });

    // No curl call either
    const calls = curlStub.readArgs();
    assert.equal(calls.length, 0, 'no curl call when no snapshot exists');

  } finally {
    curlStub.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
