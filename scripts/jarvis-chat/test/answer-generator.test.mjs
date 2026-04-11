import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPrompt } from '../lib/answer-generator.mjs';

test('buildUserPrompt: includes question, sources, and facts with attribution', () => {
  const prompt = buildUserPrompt({
    question: 'qual o status do vk03?',
    projectContext: { sources: [{ label: 'vk-health/latest.md', content: 'CPU OK\nDisk 60%' }] },
    facts: [
      { fact: { type: 'observation', summary: 'fila do rabbitmq estourou', source: { space_label: 'VK 03001 — Stellantis' }, extracted_at: '2026-04-09T10:00:00Z' } },
    ],
    projectCode: '03002',
    spaceLabel: 'VK 03002 — Nissan',
  });
  assert.match(prompt, /VK 03002 — Nissan/);
  assert.match(prompt, /vk-health\/latest\.md/);
  assert.match(prompt, /VK 03001 — Stellantis/);
  assert.match(prompt, /\[observation\]/);
});

test('buildUserPrompt: handles empty sources and empty facts', () => {
  const prompt = buildUserPrompt({
    question: 'oi',
    projectContext: { sources: [] },
    facts: [],
    projectCode: '03002',
    spaceLabel: 'VK 03002',
  });
  assert.match(prompt, /sem fontes estáticas/);
  assert.match(prompt, /nenhum fato relevante/);
});

test('buildUserPrompt: multiple facts numbered and attributed', () => {
  const prompt = buildUserPrompt({
    question: 'teste',
    projectContext: { sources: [] },
    facts: [
      { fact: { type: 'decision', summary: 'A', source: { space_label: 'X' }, extracted_at: '2026-04-01T10:00:00Z' } },
      { fact: { type: 'blocker', summary: 'B', source: { space_label: 'Y' }, extracted_at: '2026-04-02T10:00:00Z' } },
    ],
    projectCode: '03002',
    spaceLabel: 'VK 03002',
  });
  assert.match(prompt, /1\. \[decision\] A/);
  assert.match(prompt, /2\. \[blocker\] B/);
  assert.match(prompt, /origem: X/);
  assert.match(prompt, /origem: Y/);
});
