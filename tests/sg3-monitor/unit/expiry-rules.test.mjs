import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTemporal, prazoEfetivoCarta, prazoLiberacaoEfetivo } from '../../../scripts/sg3-monitor/lib/expiry-rules.mjs';

const LEAD_TIMES = {
  aso: [15, 7, 1],
  carta_subcontratacao: [60, 30, 15],
  default: [30, 15, 7],
};

describe('evaluateTemporal', () => {
  it('returns null when no threshold matches', () => {
    const r = evaluateTemporal({ tipo: 'aso', dataVencimento: '2026-06-30', hoje: '2026-05-05', leadTimes: LEAD_TIMES });
    assert.equal(r, null);
  });

  it('returns PRAZO when dias_restantes hits a lead time', () => {
    const r = evaluateTemporal({ tipo: 'aso', dataVencimento: '2026-05-12', hoje: '2026-05-05', leadTimes: LEAD_TIMES });
    assert.deepEqual(r, { severity: 'PRAZO', diasRestantes: 7 });
  });

  it('returns VENCIDO when past', () => {
    const r = evaluateTemporal({ tipo: 'aso', dataVencimento: '2026-05-01', hoje: '2026-05-05', leadTimes: LEAD_TIMES });
    assert.deepEqual(r, { severity: 'VENCIDO', diasRestantes: -4 });
  });

  it('falls back to default lead times when tipo not in config', () => {
    const r = evaluateTemporal({ tipo: 'desconhecido', dataVencimento: '2026-06-04', hoje: '2026-05-05', leadTimes: LEAD_TIMES });
    assert.deepEqual(r, { severity: 'PRAZO', diasRestantes: 30 });
  });
});

describe('prazoEfetivoCarta', () => {
  it('returns the smallest of all candidate dates', () => {
    const r = prazoEfetivoCarta({
      cartaVencimento: '2026-12-31',
      contratoFim: '2026-09-30',
      cndsLume: [{ dataVencimento: '2026-06-04' }, { dataVencimento: '2027-01-01' }],
    });
    assert.deepEqual(r, { data: '2026-06-04', motivo: 'CND' });
  });

  it('ignores undefined or null dates', () => {
    const r = prazoEfetivoCarta({
      cartaVencimento: '2026-08-15',
      contratoFim: null,
      cndsLume: [{ dataVencimento: undefined }],
    });
    assert.deepEqual(r, { data: '2026-08-15', motivo: 'carta' });
  });
});

describe('prazoLiberacaoEfetivo', () => {
  it('blocks when declaracao incompleta', () => {
    const r = prazoLiberacaoEfetivo({
      alocacao: { data_vencimento_propria: '2026-12-31' },
      cadastroSg3: { data_vencimento: '2026-12-31' },
      contrato: { data_fim: '2026-12-31' },
      docsColaborador: [{ tipo: 'aso', data_vencimento: '2026-08-01' }],
      docsEmpresaSubcontratada: [],
      cartaSubcontratacao: null,
      aprovacaoJuridico: null,
      declaracaoResponsabilidade: { assinaturas: 'pendente' },
    });
    assert.deepEqual(r, { bloqueada: true, motivo: 'declaracao_responsabilidade incompleta' });
  });

  it('returns the smallest dependency date with description', () => {
    const r = prazoLiberacaoEfetivo({
      alocacao: { data_vencimento_propria: '2026-12-31' },
      cadastroSg3: { data_vencimento: '2026-12-31' },
      contrato: { data_fim: '2026-12-31', id: '5000078790' },
      docsColaborador: [{ tipo: 'aso', data_vencimento: '2026-08-01', colaboradorNome: 'João' }],
      docsEmpresaSubcontratada: [{ tipo: 'cnd_federal', data_vencimento: '2026-06-04', empresaNome: 'Lume' }],
      cartaSubcontratacao: null,
      aprovacaoJuridico: null,
      declaracaoResponsabilidade: { assinaturas: 'completa' },
    });
    assert.equal(r.bloqueada, false);
    assert.equal(r.data, '2026-06-04');
    assert.match(r.bottleneck, /CND Federal Lume/i);
  });
});
