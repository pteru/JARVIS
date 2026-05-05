import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TABS, validateRow, validateForeignKeys } from '../../../scripts/sg3-monitor/lib/sheet-schema.mjs';

describe('TABS', () => {
  it('declares all 13 tabs', () => {
    const names = TABS.map(t => t.name);
    assert.deepEqual(names, [
      'empresas', 'colaboradores', 'pessoas_gm', 'plantas', 'contratos',
      'cadastros_sg3', 'cartas_subcontratacao', 'aprovacoes_email',
      'docs_empresa', 'docs_colaborador', 'declaracoes_responsabilidade',
      'alocacoes', 'contratos_drive',
    ]);
  });

  it('every tab has an "id" column', () => {
    for (const tab of TABS) {
      assert.ok(tab.columns.some(c => c.name === 'id'), `tab ${tab.name} missing id column`);
    }
  });

  it('every tab declares a syncStrategy', () => {
    for (const tab of TABS) {
      assert.ok(tab.syncStrategy, `tab ${tab.name} missing syncStrategy`);
    }
  });
});

describe('validateRow', () => {
  it('rejects bad date', () => {
    const tab = TABS.find(t => t.name === 'docs_colaborador');
    const errors = validateRow(tab, { id: 'x', tipo: 'aso', data_vencimento: '12/05/2026' });
    assert.ok(errors.some(e => /data_vencimento/.test(e)));
  });

  it('rejects unknown enum value', () => {
    const tab = TABS.find(t => t.name === 'docs_empresa');
    const errors = validateRow(tab, { id: 'x', tipo: 'cnd_municipal', data_vencimento: '2026-12-31' });
    assert.ok(errors.some(e => /tipo/.test(e)));
  });

  it('accepts valid row', () => {
    const tab = TABS.find(t => t.name === 'docs_empresa');
    const errors = validateRow(tab, { id: 'lume-pgr-2026', tipo: 'pgr', empresa_id: 'lume', data_vencimento: '2026-12-31' });
    assert.deepEqual(errors, []);
  });
});

describe('validateForeignKeys', () => {
  it('reports broken FK', () => {
    const tabs = TABS;
    const data = {
      empresas: [{ id: 'lume' }],
      colaboradores: [{ id: 'pedro', empresa_id: 'unknown-empresa' }],
    };
    const errors = validateForeignKeys(tabs, data);
    assert.ok(errors.some(e => /empresa_id/.test(e) && /unknown-empresa/.test(e)));
  });
});
