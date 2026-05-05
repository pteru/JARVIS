import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmail } from '../../../scripts/sg3-monitor/lib/email-classifier.mjs';

const RULES = {
  master_label: 'sg3',
  classifiers: [
    { type: 'aprovacao_juridico_gm',
      match: { from_pattern: 'marilza', subject_pattern: '(subcontratação|carta)' },
      extracao: { confirmacao_humana: true } },
    { type: 'aprovacao_comprador_gm',
      match: { from_domain: 'gm.com', subject_pattern: '(aprovação|aprovado).*(subcontratação|carta)' } },
    { type: 'email_patrimonial',
      match: { to_pattern: 'patrimonial', from_pattern: 'me' } },
    { type: 'outro_sg3', fallback: true },
  ],
};

describe('classifyEmail', () => {
  it('matches juridico by from + subject', () => {
    const r = classifyEmail({ from: 'marilza@gm.com', to: 'pedro@strokmatic.com', subject: 'Aprovação carta de subcontratação' }, RULES, { selfFromAddresses: ['pedro@strokmatic.com'] });
    assert.equal(r.type, 'aprovacao_juridico_gm');
  });

  it('falls back to outro_sg3', () => {
    const r = classifyEmail({ from: 'random@example.com', to: 'pedro@strokmatic.com', subject: 'something' }, RULES, { selfFromAddresses: ['pedro@strokmatic.com'] });
    assert.equal(r.type, 'outro_sg3');
  });

  it('matches email_patrimonial by to + from=me', () => {
    const r = classifyEmail({ from: 'pedro@strokmatic.com', to: 'patrimonial.gravatai@gm.com', subject: 'Liberação de João Silva' }, RULES, { selfFromAddresses: ['pedro@strokmatic.com'] });
    assert.equal(r.type, 'email_patrimonial');
  });

  it('matches comprador by from_domain + subject', () => {
    const r = classifyEmail({ from: 'comprador@gm.com', to: 'pedro@strokmatic.com', subject: 'Aprovado: carta de subcontratação' }, RULES, { selfFromAddresses: ['pedro@strokmatic.com'] });
    assert.equal(r.type, 'aprovacao_comprador_gm');
  });
});
