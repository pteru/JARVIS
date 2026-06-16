import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAge } from '../../../scripts/claude-monitor/lib/sessions.mjs';

test('formatAge returns dash for null/undefined', () => {
  assert.equal(formatAge(null), '—');
  assert.equal(formatAge(undefined), '—');
});

test('formatAge returns seconds under one minute', () => {
  assert.equal(formatAge(0), '0s');
  assert.equal(formatAge(45_000), '45s');
});

test('formatAge returns minutes under one hour', () => {
  assert.equal(formatAge(60_000), '1m');
  assert.equal(formatAge(120_000), '2m');
  assert.equal(formatAge(59 * 60_000), '59m');
});

test('formatAge returns hours+minutes from one hour up', () => {
  assert.equal(formatAge(60 * 60_000), '1h 0m');
  assert.equal(formatAge(65 * 60_000), '1h 5m');
  assert.equal(formatAge(25 * 60 * 60_000), '25h 0m');
});
