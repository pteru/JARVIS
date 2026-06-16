import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTable, shortenCwd } from '../../../scripts/claude-monitor/lib/sessions.mjs';

test('shortenCwd replaces home dir prefix with ~', () => {
  assert.equal(shortenCwd('/home/teruel/JARVIS', '/home/teruel'), '~/JARVIS');
  assert.equal(shortenCwd('/home/teruel', '/home/teruel'), '~');
  assert.equal(shortenCwd('/other/path', '/home/teruel'), '/other/path');
});

test('renderTable returns a no-sessions line when empty', () => {
  const out = renderTable([], { now: 1_000_000, home: '/home/teruel', useColor: false });
  assert.match(out, /No active Claude Code sessions/);
});

test('renderTable contains column headers when sessions present', () => {
  const sessions = [
    { name: 'one', displayStatus: 'running', waitingFor: null, cwd: '/x', ageMs: 60_000, pid: 1 },
  ];
  const out = renderTable(sessions, { now: 1_000_000, home: '/home/teruel', useColor: false });
  assert.match(out, /NAME/);
  assert.match(out, /STATUS/);
  assert.match(out, /CWD/);
  assert.match(out, /AGE/);
});

test('renderTable shows each session name and status', () => {
  const sessions = [
    { name: 'alpha', displayStatus: 'running', waitingFor: null, cwd: '/x', ageMs: 60_000, pid: 1 },
    { name: 'beta', displayStatus: 'waiting', waitingFor: 'dialog open', cwd: '/y', ageMs: 30_000, pid: 2 },
  ];
  const out = renderTable(sessions, { now: 1_000_000, home: '/home/teruel', useColor: false });
  assert.match(out, /alpha/);
  assert.match(out, /running/);
  assert.match(out, /beta/);
  assert.match(out, /waiting/);
  assert.match(out, /dialog open/);
});

test('renderTable sorts active sessions ahead of idle/ended', () => {
  const sessions = [
    { name: 'old-ended', displayStatus: 'ended', waitingFor: null, cwd: '/x', ageMs: 99_000, pid: 1 },
    { name: 'now-idle', displayStatus: 'idle', waitingFor: null, cwd: '/y', ageMs: 99_000, pid: 2 },
    { name: 'now-busy', displayStatus: 'running', waitingFor: null, cwd: '/z', ageMs: 99_000, pid: 3 },
    { name: 'asks', displayStatus: 'waiting', waitingFor: 'approve', cwd: '/w', ageMs: 99_000, pid: 4 },
  ];
  const out = renderTable(sessions, { now: 1_000_000, home: '/home/teruel', useColor: false });
  const idxBusy = out.indexOf('now-busy');
  const idxAsks = out.indexOf('asks');
  const idxIdle = out.indexOf('now-idle');
  const idxEnded = out.indexOf('old-ended');
  assert.ok(idxBusy > 0 && idxAsks > 0);
  assert.ok(Math.min(idxBusy, idxAsks) < idxIdle, 'active before idle');
  assert.ok(idxIdle < idxEnded, 'idle before ended');
});

test('renderTable produces ANSI escapes only when useColor is true', () => {
  const sessions = [
    { name: 'x', displayStatus: 'running', waitingFor: null, cwd: '/x', ageMs: 60_000, pid: 1 },
  ];
  const plain = renderTable(sessions, { now: 1_000_000, home: '/home/teruel', useColor: false });
  const colored = renderTable(sessions, { now: 1_000_000, home: '/home/teruel', useColor: true });
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(plain, /\x1b\[/);
  // eslint-disable-next-line no-control-regex
  assert.match(colored, /\x1b\[/);
});
