import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFieldsFromText } from '../../../scripts/sg3-monitor/lib/contract-pdf-parser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEXT = readFileSync(resolve(__dirname, '../fixtures/pdfs/sample-contrato.txt'), 'utf-8');

describe('extractFieldsFromText', () => {
  it('extracts contrato_id', () => {
    const r = extractFieldsFromText(TEXT);
    assert.equal(r.contratoId, '5000078790');
  });

  it('extracts vigência start and end', () => {
    const r = extractFieldsFromText(TEXT);
    assert.equal(r.dataInicio, '2025-06-01');
    assert.equal(r.dataFim, '2027-05-31');
  });

  it('extracts responsável GM nome and email', () => {
    const r = extractFieldsFromText(TEXT);
    assert.equal(r.responsavelGmNome, 'Carlos Souza');
    assert.equal(r.responsavelGmEmail, 'carlos.souza@gm.com');
  });

  it('extracts objeto (first sentence after "Objeto:")', () => {
    const r = extractFieldsFromText(TEXT);
    assert.match(r.objeto, /Implantação de sistema de inspeção visual/);
  });

  it('returns warnings for missing fields', () => {
    const r = extractFieldsFromText('just a contract number 5000078790 and nothing else');
    assert.ok(r.warnings.length > 0);
  });
});
