import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { tokenize, scoreFact, searchFacts, appendFact, loadRecentFacts } from '../lib/fact-store.mjs';

// ─── Task 2.1: tokenize ───────────────────────────────────────────────────────

test('tokenize: lowercases, strips stopwords, returns unique tokens', () => {
  const tokens = tokenize('Qual o status do vk03 e do RabbitMQ?');
  assert.deepEqual(tokens.sort(), ['rabbitmq', 'status', 'vk03'].sort());
});

test('tokenize: empty input returns empty array', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
});

// ─── Task 2.2: scoreFact ─────────────────────────────────────────────────────

const refDate = '2026-04-10T15:00:00Z';

function fact(overrides = {}) {
  return {
    id: 'f1',
    extracted_at: '2026-04-10T10:00:00Z',
    source: { project_code: '03002' },
    type: 'observation',
    summary: 'Pico de fila no RabbitMQ do vk03',
    entities: ['vk03', 'RabbitMQ'],
    people: ['Pedro'],
    ...overrides,
  };
}

test('scoreFact: token overlap on summary, entities, and people', () => {
  const tokens = tokenize('qual o status do vk03 e do rabbitmq');
  const score = scoreFact(fact(), tokens, { projectCode: '03002', nowIso: refDate });
  assert.ok(score > 0);
});

test('scoreFact: zero overlap → score 0', () => {
  const tokens = tokenize('quando sai o relatório do honda');
  const score = scoreFact(fact(), tokens, { projectCode: '01001', nowIso: refDate });
  assert.equal(score, 0);
});

test('scoreFact: facts older than 30 days get no recency boost', () => {
  const stale = fact({ extracted_at: '2025-01-01T00:00:00Z' });
  const fresh = fact({ extracted_at: '2026-04-10T08:00:00Z' });
  const tokens = tokenize('vk03 rabbitmq');
  const staleScore = scoreFact(stale, tokens, { projectCode: '03002', nowIso: refDate });
  const freshScore = scoreFact(fresh, tokens, { projectCode: '03002', nowIso: refDate });
  assert.ok(freshScore > staleScore);
});

test('scoreFact: same project_code adds preference boost', () => {
  const tokens = tokenize('vk03 rabbitmq');
  const sameProject = scoreFact(fact(), tokens, { projectCode: '03002', nowIso: refDate });
  const otherProject = scoreFact(fact(), tokens, { projectCode: '01001', nowIso: refDate });
  assert.ok(sameProject > otherProject);
});

test('scoreFact: fact with missing optional fields does not throw', () => {
  const sparse = { id: 'sparse', extracted_at: '2026-04-10T10:00:00Z', source: { project_code: '03002' } };
  const tokens = tokenize('vk03');
  assert.doesNotThrow(() => scoreFact(sparse, tokens, { projectCode: '03002', nowIso: refDate }));
});

// ─── Task 2.3: searchFacts ───────────────────────────────────────────────────

test('searchFacts: returns top-k ranked, ties broken by recency', () => {
  const facts = [
    fact({ id: 'a', summary: 'vk03 rabbitmq queue spike', extracted_at: '2026-04-10T09:00:00Z' }),
    fact({ id: 'b', summary: 'honda press status normal', extracted_at: '2026-04-10T10:00:00Z', source: { project_code: '01001' }, entities: [], people: [] }),
    fact({ id: 'c', summary: 'rabbitmq prefetch tuning notes', extracted_at: '2026-04-10T11:00:00Z', entities: [], people: [] }),
    fact({ id: 'd', summary: 'unrelated meeting note', extracted_at: '2026-04-10T12:00:00Z', entities: [], people: [] }),
  ];
  const results = searchFacts(facts, 'qual o status do rabbitmq no vk03', { projectCode: '03002', k: 2, nowIso: refDate });
  assert.equal(results.length, 2);
  assert.ok(results[0].score >= results[1].score);
  assert.equal(results[0].fact.id, 'a');
});

test('searchFacts: empty query → empty result', () => {
  const facts = [fact()];
  const results = searchFacts(facts, '', { projectCode: '03002', k: 5, nowIso: refDate });
  assert.deepEqual(results, []);
});

test('searchFacts: k respected', () => {
  const facts = Array.from({ length: 10 }, (_, i) =>
    fact({ id: `f${i}`, summary: `vk03 rabbitmq item ${i}` })
  );
  const results = searchFacts(facts, 'vk03 rabbitmq', { projectCode: '03002', k: 3, nowIso: refDate });
  assert.equal(results.length, 3);
});

// ─── Task 2.4: appendFact + loadRecentFacts ──────────────────────────────────

test('appendFact + loadRecentFacts roundtrip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-fact-'));
  try {
    appendFact(dir, fact({ id: 'rt1' }));
    appendFact(dir, fact({ id: 'rt2', extracted_at: '2026-04-10T11:00:00Z' }));
    const loaded = loadRecentFacts(dir, 1, new Date('2026-04-10T12:00:00Z'));
    assert.equal(loaded.length, 2);
    assert.ok(loaded.find(f => f.id === 'rt1'));
    assert.ok(loaded.find(f => f.id === 'rt2'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
