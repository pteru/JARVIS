import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSessionMeta } from '../../../scripts/claude-monitor/lib/sessions.mjs';

test('extractSessionMeta returns all-null for empty input', () => {
  assert.deepEqual(extractSessionMeta(''), { name: null, cwd: null, recap: null, lastPrompt: null });
});

test('extractSessionMeta picks up custom-title as name', () => {
  const text = JSON.stringify({ type: 'custom-title', customTitle: 'sealer', sessionId: 'x' }) + '\n';
  assert.equal(extractSessionMeta(text).name, 'sealer');
});

test('extractSessionMeta returns the LAST custom-title when several appear', () => {
  const text = [
    JSON.stringify({ type: 'custom-title', customTitle: 'old-name' }),
    JSON.stringify({ type: 'custom-title', customTitle: 'mid-name' }),
    JSON.stringify({ type: 'custom-title', customTitle: 'new-name' }),
  ].join('\n') + '\n';
  assert.equal(extractSessionMeta(text).name, 'new-name');
});

test('extractSessionMeta picks up cwd from any entry that has one', () => {
  const text = [
    JSON.stringify({ type: 'user', message: { content: 'hi' }, cwd: '/home/x' }),
  ].join('\n') + '\n';
  assert.equal(extractSessionMeta(text).cwd, '/home/x');
});

test('extractSessionMeta returns the latest cwd if it changed', () => {
  const text = [
    JSON.stringify({ type: 'user', cwd: '/old/path' }),
    JSON.stringify({ type: 'assistant', cwd: '/new/path' }),
  ].join('\n') + '\n';
  assert.equal(extractSessionMeta(text).cwd, '/new/path');
});

test('extractSessionMeta picks up the latest away_summary as recap', () => {
  const text = [
    JSON.stringify({ type: 'system', subtype: 'away_summary', content: 'old recap' }),
    JSON.stringify({ type: 'system', subtype: 'away_summary', content: 'new recap' }),
  ].join('\n') + '\n';
  assert.equal(extractSessionMeta(text).recap, 'new recap');
});

test('extractSessionMeta picks up the latest last-prompt', () => {
  const text = [
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'first ask' }),
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'second ask' }),
  ].join('\n') + '\n';
  assert.equal(extractSessionMeta(text).lastPrompt, 'second ask');
});

test('extractSessionMeta tolerates malformed lines and unrelated entry types', () => {
  const text = [
    'not-json',
    JSON.stringify({ type: 'assistant', message: {} }),
    JSON.stringify({ type: 'custom-title', customTitle: 'good-name' }),
    '{broken',
    JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 1000 }),
  ].join('\n') + '\n';
  const meta = extractSessionMeta(text);
  assert.equal(meta.name, 'good-name');
});

test('extractSessionMeta combined: returns all four fields together', () => {
  const text = [
    JSON.stringify({ type: 'user', cwd: '/proj' }),
    JSON.stringify({ type: 'custom-title', customTitle: 'mysess' }),
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'finish the doc' }),
    JSON.stringify({ type: 'system', subtype: 'away_summary', content: 'Recap text' }),
  ].join('\n') + '\n';
  assert.deepEqual(extractSessionMeta(text), {
    name: 'mysess', cwd: '/proj', recap: 'Recap text', lastPrompt: 'finish the doc',
  });
});
