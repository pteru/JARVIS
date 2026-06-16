import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLatestRecap } from '../../../scripts/claude-monitor/lib/sessions.mjs';

const away = (content, timestamp) => JSON.stringify({
  type: 'system', subtype: 'away_summary', content, timestamp, sessionId: 'x',
});

test('findLatestRecap returns null for empty input', () => {
  assert.equal(findLatestRecap(''), null);
});

test('findLatestRecap returns null when no away_summary entries exist', () => {
  const text = [
    JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 1000 }),
    JSON.stringify({ type: 'assistant', message: {} }),
  ].join('\n') + '\n';
  assert.equal(findLatestRecap(text), null);
});

test('findLatestRecap returns the content of a single away_summary', () => {
  const text = away('Goal: ship the parser. Next: wire it up.', '2026-05-15T10:00:00.000Z') + '\n';
  assert.equal(findLatestRecap(text), 'Goal: ship the parser. Next: wire it up.');
});

test('findLatestRecap returns the LAST away_summary among several', () => {
  const text = [
    away('old recap', '2026-05-15T09:00:00.000Z'),
    JSON.stringify({ type: 'assistant', message: {} }),
    away('newer recap', '2026-05-15T10:00:00.000Z'),
    away('newest recap', '2026-05-15T11:00:00.000Z'),
  ].join('\n') + '\n';
  assert.equal(findLatestRecap(text), 'newest recap');
});

test('findLatestRecap ignores other system subtypes', () => {
  const text = [
    JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', content: 'not a recap' }),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }),
  ].join('\n') + '\n';
  assert.equal(findLatestRecap(text), null);
});

test('findLatestRecap tolerates malformed lines', () => {
  const text = [
    'not-json',
    away('recap one', '2026-05-15T10:00:00.000Z'),
    '{broken',
    away('recap two', '2026-05-15T11:00:00.000Z'),
  ].join('\n') + '\n';
  assert.equal(findLatestRecap(text), 'recap two');
});

test('findLatestRecap returns null when away_summary has no content', () => {
  const text = JSON.stringify({ type: 'system', subtype: 'away_summary', timestamp: 't' }) + '\n';
  assert.equal(findLatestRecap(text), null);
});
