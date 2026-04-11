import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _buildExtractionPrompt, _parseJsonArray } from '../lib/fact-extractor.mjs';

test('_buildExtractionPrompt: includes space label and message lines', () => {
  const prompt = _buildExtractionPrompt(
    [
      { ts: '2026-04-10T14:00:00Z', sender: { name: 'Pedro' }, text: 'vamos aumentar prefetch para 50' },
      { ts: '2026-04-10T14:01:00Z', sender: { name: 'Joshua' }, text: 'fechado, faço hoje' },
    ],
    { space_label: 'VK 03002 — Nissan', project_code: '03002' },
  );
  assert.match(prompt, /VK 03002 — Nissan/);
  assert.match(prompt, /Pedro: vamos aumentar prefetch/);
  assert.match(prompt, /Joshua: fechado/);
});

test('_parseJsonArray: extracts JSON array surrounded by stray text', () => {
  const raw = 'Aqui está a saída:\n[{"type":"decision","summary":"teste","entities":[],"people":[]}]\nfim.';
  const out = _parseJsonArray(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'decision');
});

test('_parseJsonArray: malformed JSON returns empty array', () => {
  assert.deepEqual(_parseJsonArray('not json at all'), []);
  assert.deepEqual(_parseJsonArray('[invalid'), []);
});

test('_parseJsonArray: empty array input returns empty array', () => {
  assert.deepEqual(_parseJsonArray('[]'), []);
});

test('_buildExtractionPrompt: sender without name field uses fallback', () => {
  const prompt = _buildExtractionPrompt(
    [{ ts: '2026-04-10T14:00:00Z', sender: {}, text: 'mensagem anônima' }],
    { space_label: 'Test', project_code: '99999' },
  );
  assert.match(prompt, /desconhecido: mensagem anônima/);
});
