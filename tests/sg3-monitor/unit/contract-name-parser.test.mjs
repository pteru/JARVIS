import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDriveFile } from '../../../scripts/sg3-monitor/lib/contract-name-parser.mjs';

describe('classifyDriveFile', () => {
  it('detects contrato GM by 5000XXXXXXX pattern', () => {
    const r = classifyDriveFile({ name: '5000078790.pdf', parentName: 'GM - CONTRATO FATURADO' });
    assert.equal(r.kind, 'contrato_gm');
    assert.equal(r.contratoId, '5000078790');
    assert.equal(r.statusDrive, 'faturado');
  });

  it('handles "Contrato 5000XXXXXXX" prefix', () => {
    const r = classifyDriveFile({ name: 'Contrato 5000078790.pdf', parentName: 'Aguardando FATURAMENTO' });
    assert.equal(r.kind, 'contrato_gm');
    assert.equal(r.contratoId, '5000078790');
    assert.equal(r.statusDrive, 'aguardando_faturamento');
  });

  it('handles trailing whitespace and capitalization in extension', () => {
    const r = classifyDriveFile({ name: '5000076749 .PDF', parentName: 'GM - CONTRATO FATURADO' });
    assert.equal(r.kind, 'contrato_gm');
    assert.equal(r.contratoId, '5000076749');
  });

  it('handles "(1)" suffix', () => {
    const r = classifyDriveFile({ name: '5000078138 (1).pdf', parentName: 'GM - CONTRATO FATURADO' });
    assert.equal(r.kind, 'contrato_gm');
    assert.equal(r.contratoId, '5000078138');
  });

  it('classifies DANFE as ignored', () => {
    const r = classifyDriveFile({ name: 'GENERAL MOTORS LTDA - DANFE 52.pdf', parentName: 'Aguardando FATURAMENTO' });
    assert.equal(r.kind, 'danfe');
  });

  it('classifies templates folder children as ignored', () => {
    const r = classifyDriveFile({ name: 'Carta de Subcontratação Prest Serviços.docx', parentName: 'GM - SG3' });
    assert.equal(r.kind, 'template');
  });

  it('parses VENC - DD/MM/AAAA - prefix', () => {
    const r = classifyDriveFile({ name: 'VENC - 03/12/2026 - DECLARAÇÃO DE RESPONSABILIDADE (3)_assinada.pdf', parentName: 'ROOT' });
    assert.equal(r.kind, 'doc_with_venc');
    assert.equal(r.dataVencimento, '2026-12-03');
    assert.match(r.descricao, /DECLARAÇÃO DE RESPONSABILIDADE/);
  });

  it('returns "unknown" for unrecognised files', () => {
    const r = classifyDriveFile({ name: 'random.xlsx', parentName: 'ROOT' });
    assert.equal(r.kind, 'unknown');
  });
});
