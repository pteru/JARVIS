import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { validateSnapshot } from './helpers/schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

test('snapshot-vk.json validates clean', () => {
  const problems = validateSnapshot(loadFixture('snapshot-vk.json'));
  assert.deepEqual(problems, [], `Expected no problems, got: ${JSON.stringify(problems)}`);
});

test('snapshot-sf.json validates clean', () => {
  const problems = validateSnapshot(loadFixture('snapshot-sf.json'));
  assert.deepEqual(problems, [], `Expected no problems, got: ${JSON.stringify(problems)}`);
});

test('unreachable node with nested .reachable sub-key is flagged', () => {
  const snap = {
    schema: 1,
    product: 'vk',
    deployment: '03002',
    collected_at: '2026-06-17T00:00:00Z',
    nodes: [{ name: 'vk03', reachable: false }],
    metrics: {
      'node.vk03.reachable': 0,
      'node.vk03.subsystem.reachable': 1,
    },
  };
  const problems = validateSnapshot(snap);
  assert.ok(
    problems.includes('unreachable vk03 has node.vk03.subsystem.reachable'),
    `Expected nested .reachable sub-key to be flagged, got: ${JSON.stringify(problems)}`,
  );
});

test('broken object returns non-empty problem list', () => {
  const broken = {
    schema: 1,
    product: 'test',
    deployment: '00000',
    collected_at: '2026-06-17T00:00:00Z',
    nodes: [],
    metrics: { x: 'hi' },
  };
  const problems = validateSnapshot(broken);
  assert.ok(problems.length > 0, 'Expected at least one problem for broken object');
});
