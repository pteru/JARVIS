import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySession } from '../../../scripts/claude-monitor/lib/sessions.mjs';

const baseRaw = {
  pid: 12345,
  sessionId: 'abc-123',
  cwd: '/home/user/proj',
  name: 'my-session',
  startedAt: 1_000_000,
  updatedAt: 1_500_000,
  status: 'idle',
};

test('classifySession: PID dead overrides any status to ended', () => {
  const result = classifySession({ ...baseRaw, status: 'busy' }, { alive: false, now: 2_000_000 });
  assert.equal(result.displayStatus, 'ended');
});

test('classifySession: busy + alive = running', () => {
  const result = classifySession({ ...baseRaw, status: 'busy' }, { alive: true, now: 2_000_000 });
  assert.equal(result.displayStatus, 'running');
  assert.equal(result.waitingFor, null);
});

test('classifySession: waiting + alive = waiting with reason', () => {
  const result = classifySession(
    { ...baseRaw, status: 'waiting', waitingFor: 'dialog open' },
    { alive: true, now: 2_000_000 },
  );
  assert.equal(result.displayStatus, 'waiting');
  assert.equal(result.waitingFor, 'dialog open');
});

test('classifySession: idle + alive = idle', () => {
  const result = classifySession({ ...baseRaw, status: 'idle' }, { alive: true, now: 2_000_000 });
  assert.equal(result.displayStatus, 'idle');
});

test('classifySession: unknown status maps to unknown', () => {
  const result = classifySession({ ...baseRaw, status: 'something-new' }, { alive: true, now: 2_000_000 });
  assert.equal(result.displayStatus, 'unknown');
});

test('classifySession: copies through name/cwd/pid/sessionId', () => {
  const result = classifySession(baseRaw, { alive: true, now: 2_000_000 });
  assert.equal(result.name, 'my-session');
  assert.equal(result.cwd, '/home/user/proj');
  assert.equal(result.pid, 12345);
  assert.equal(result.sessionId, 'abc-123');
});

test('classifySession: ageMs computed from updatedAt and now', () => {
  const result = classifySession(baseRaw, { alive: true, now: 1_500_000 + 60_000 });
  assert.equal(result.ageMs, 60_000);
});

test('classifySession: name falls back to sessionId short form when missing', () => {
  const { name, ...rawWithoutName } = baseRaw;
  const result = classifySession(rawWithoutName, { alive: true, now: 2_000_000 });
  assert.equal(result.name, 'abc-123'.slice(0, 8));
});
