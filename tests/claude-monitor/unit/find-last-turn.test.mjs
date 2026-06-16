import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLastTurn } from '../../../scripts/claude-monitor/lib/sessions.mjs';

const ts = (iso) => Date.parse(iso);
function userPrompt(content, timestamp, extra = {}) {
  return JSON.stringify({
    type: 'user', isMeta: false, isSidechain: false,
    message: { role: 'user', content }, timestamp, ...extra,
  });
}
function assistant(timestamp, extra = {}) {
  return JSON.stringify({ type: 'assistant', message: {}, timestamp, ...extra });
}
function toolResult(timestamp) {
  return JSON.stringify({
    type: 'user', isSidechain: false,
    message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
    timestamp,
  });
}

test('findLastTurn returns null for empty input', () => {
  assert.equal(findLastTurn(''), null);
});

test('findLastTurn returns null when there are no assistant entries', () => {
  const text = userPrompt('do it', '2026-05-15T10:00:00.000Z') + '\n';
  assert.equal(findLastTurn(text), null);
});

test('findLastTurn returns null when there are no user prompts', () => {
  const text = assistant('2026-05-15T10:00:00.000Z') + '\n';
  assert.equal(findLastTurn(text), null);
});

test('findLastTurn measures a single turn prompt-to-last-assistant', () => {
  const text = [
    userPrompt('run the build', '2026-05-15T10:00:00.000Z'),
    assistant('2026-05-15T10:05:00.000Z'),
  ].join('\n') + '\n';
  const turn = findLastTurn(text);
  assert.equal(turn.durationMs, 5 * 60_000);
  assert.equal(turn.endTs, ts('2026-05-15T10:05:00.000Z'));
});

test('findLastTurn uses the LAST assistant entry as the turn end', () => {
  const text = [
    userPrompt('long task', '2026-05-15T10:00:00.000Z'),
    assistant('2026-05-15T10:02:00.000Z'),
    assistant('2026-05-15T10:08:00.000Z'),
  ].join('\n') + '\n';
  const turn = findLastTurn(text);
  assert.equal(turn.durationMs, 8 * 60_000);
  assert.equal(turn.endTs, ts('2026-05-15T10:08:00.000Z'));
});

test('findLastTurn returns the most recent turn when several exist', () => {
  const text = [
    userPrompt('first', '2026-05-15T09:00:00.000Z'),
    assistant('2026-05-15T09:01:00.000Z'),
    userPrompt('second', '2026-05-15T10:00:00.000Z'),
    assistant('2026-05-15T10:12:00.000Z'),
  ].join('\n') + '\n';
  const turn = findLastTurn(text);
  assert.equal(turn.durationMs, 12 * 60_000);
});

test('findLastTurn ignores tool_result user entries between prompt and assistant', () => {
  const text = [
    userPrompt('do the work', '2026-05-15T10:00:00.000Z'),
    toolResult('2026-05-15T10:01:00.000Z'),
    assistant('2026-05-15T10:02:00.000Z'),
    toolResult('2026-05-15T10:03:00.000Z'),
    assistant('2026-05-15T10:09:00.000Z'),
  ].join('\n') + '\n';
  const turn = findLastTurn(text);
  assert.equal(turn.durationMs, 9 * 60_000);
});

test('findLastTurn skips meta user entries', () => {
  const text = [
    userPrompt('real prompt', '2026-05-15T10:00:00.000Z'),
    userPrompt('injected reminder', '2026-05-15T10:04:00.000Z', { isMeta: true }),
    assistant('2026-05-15T10:06:00.000Z'),
  ].join('\n') + '\n';
  const turn = findLastTurn(text);
  assert.equal(turn.durationMs, 6 * 60_000);
});

test('findLastTurn skips sidechain (subagent) entries', () => {
  const text = [
    userPrompt('main prompt', '2026-05-15T10:00:00.000Z'),
    userPrompt('subagent task', '2026-05-15T10:03:00.000Z', { isSidechain: true }),
    assistant('2026-05-15T10:07:00.000Z'),
  ].join('\n') + '\n';
  const turn = findLastTurn(text);
  assert.equal(turn.durationMs, 7 * 60_000);
});

test('findLastTurn skips slash-command user entries', () => {
  const text = [
    userPrompt('the real task', '2026-05-15T10:00:00.000Z'),
    assistant('2026-05-15T10:10:00.000Z'),
    userPrompt('<command-name>/rename</command-name>', '2026-05-15T10:11:00.000Z'),
    userPrompt('<local-command-stdout>done</local-command-stdout>', '2026-05-15T10:11:01.000Z'),
  ].join('\n') + '\n';
  const turn = findLastTurn(text);
  assert.equal(turn.durationMs, 10 * 60_000);
});

test('findLastTurn tolerates malformed lines', () => {
  const text = [
    'not-json',
    userPrompt('task', '2026-05-15T10:00:00.000Z'),
    '{broken',
    assistant('2026-05-15T10:04:00.000Z'),
    '',
  ].join('\n') + '\n';
  const turn = findLastTurn(text);
  assert.equal(turn.durationMs, 4 * 60_000);
});
