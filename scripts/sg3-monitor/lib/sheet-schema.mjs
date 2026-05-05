// Column types: 'string' | 'date' | 'datetime' | 'enum' | 'csv' | 'bool' | 'integer' | 'url'

const COMMON_META = [
  { name: '_origem', type: 'enum', enumValues: ['sg3', 'email', 'drive', 'manual'] },
  { name: '_atualizado_em', type: 'datetime' },
];

const REVISADO = { name: '_revisado_humano', type: 'bool' };

export const TABS = [
  {
    name: 'empresas',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'razao_social', type: 'string' },
      { name: 'cnpj', type: 'string' },
      { name: 'tipo', type: 'enum', enumValues: ['principal', 'subcontratada', 'mei'] },
      { name: 'responsavel_email', type: 'string' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'colaboradores',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'nome_completo', type: 'string' },
      { name: 'cpf', type: 'string' },
      { name: 'empresa_id', type: 'string', fk: 'empresas' },
      { name: 'email', type: 'string' },
      { name: 'telefone', type: 'string' },
      { name: 'ativo', type: 'bool' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'pessoas_gm',
    syncStrategy: 'insert_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'nome', type: 'string' },
      { name: 'email', type: 'string', dedupeKey: true },
      { name: 'telefone', type: 'string' },
      { name: 'tem_user_sg3', type: 'bool' },
      { name: 'papeis', type: 'csv', enumValues: ['responsavel_contrato', 'responsavel_planta', 'comprador', 'juridico'] },
      { name: 'plantas', type: 'csv' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'plantas',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'cliente', type: 'string' },
      { name: 'nome', type: 'string' },
      { name: 'endereco', type: 'string' },
      { name: 'patrimonial_nome', type: 'string' },
      { name: 'patrimonial_email', type: 'string' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'contratos',
    syncStrategy: 'upsert_contratos',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'cliente', type: 'string' },
      { name: 'objeto', type: 'string' },
      { name: 'data_inicio', type: 'date' },
      { name: 'data_fim', type: 'date' },
      { name: 'responsavel_contrato_id', type: 'string', fk: 'pessoas_gm' },
      { name: 'extracao_status', type: 'enum', enumValues: ['auto', 'manual', 'falhou'] },
      { name: 'extracao_warnings', type: 'string' },
      { name: 'notas', type: 'string', manual: true },
      ...COMMON_META,
    ],
  },
  {
    name: 'cadastros_sg3',
    syncStrategy: 'upsert_dynamic',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'contrato_id', type: 'string', fk: 'contratos' },
      { name: 'planta_id', type: 'string', fk: 'plantas' },
      { name: 'responsavel_planta_id', type: 'string', fk: 'pessoas_gm' },
      { name: 'status_aprovacao', type: 'enum', enumValues: ['pendente', 'aprovado', 'vencido'] },
      { name: 'data_aprovacao', type: 'date' },
      { name: 'data_vencimento', type: 'date' },
      { name: 'sg3_url', type: 'url' },
      { name: 'notas', type: 'string', manual: true },
      ...COMMON_META,
    ],
  },
  {
    name: 'cartas_subcontratacao',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'subcontratada_id', type: 'string', fk: 'empresas' },
      { name: 'contrato_id', type: 'string', fk: 'contratos' },
      { name: 'plantas_cobertas', type: 'csv' },
      { name: 'data_emissao', type: 'date' },
      { name: 'data_vencimento_propria', type: 'date' },
      { name: 'assinaturas', type: 'enum', enumValues: ['pendente', 'strokmatic', 'strokmatic+sub', 'completa'] },
      { name: 'aprovacao_comprador_id', type: 'string', fk: 'aprovacoes_email' },
      { name: 'aprovacao_juridico_id', type: 'string', fk: 'aprovacoes_email' },
      { name: 'arquivo_url', type: 'url' },
      { name: 'prazo_efetivo', type: 'date', calculated: true },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'aprovacoes_email',
    syncStrategy: 'insert_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'tipo', type: 'enum', enumValues: ['comprador_gm', 'juridico_gm', 'patrimonial', 'outro_sg3'] },
      { name: 'carta_id', type: 'string', fk: 'cartas_subcontratacao' },
      { name: 'aprovador_id', type: 'string', fk: 'pessoas_gm' },
      { name: 'data_email', type: 'date' },
      { name: 'remetente', type: 'string' },
      { name: 'assunto', type: 'string' },
      { name: 'corpo_resumido', type: 'string' },
      { name: 'prazo_definido', type: 'date' },
      { name: 'gmail_message_id', type: 'string', dedupeKey: true },
      { name: 'gmail_link', type: 'url' },
      { name: 'status', type: 'enum', enumValues: ['aprovado', 'pendente', 'rejeitado'] },
      REVISADO,
      ...COMMON_META,
    ],
  },
  {
    name: 'docs_empresa',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'empresa_id', type: 'string', fk: 'empresas' },
      { name: 'tipo', type: 'enum', enumValues: ['pgr', 'pcmso', 'cnd_federal', 'cnd_trabalhista', 'cnd_fgts', 'outro'] },
      { name: 'data_emissao', type: 'date' },
      { name: 'data_vencimento', type: 'date' },
      { name: 'arquivo_url', type: 'url' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'docs_colaborador',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'colaborador_id', type: 'string', fk: 'colaboradores' },
      { name: 'tipo', type: 'enum', enumValues: ['aso', 'nr10', 'nr35', 'nr12', 'outro'] },
      { name: 'data_emissao', type: 'date' },
      { name: 'data_vencimento', type: 'date' },
      { name: 'arquivo_url', type: 'url' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'declaracoes_responsabilidade',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'colaborador_id', type: 'string', fk: 'colaboradores' },
      { name: 'planta_id', type: 'string', fk: 'plantas' },
      { name: 'data_emissao', type: 'date' },
      { name: 'assinaturas', type: 'enum', enumValues: ['pendente', 'strokmatic', 'strokmatic+sub', 'completa'] },
      { name: 'arquivo_url', type: 'url' },
      { name: 'versao', type: 'integer' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'alocacoes',
    syncStrategy: 'upsert_dynamic',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'colaborador_id', type: 'string', fk: 'colaboradores' },
      { name: 'cadastro_sg3_id', type: 'string', fk: 'cadastros_sg3' },
      { name: 'data_inicio', type: 'date' },
      { name: 'data_vencimento_propria', type: 'date' },
      { name: 'status_sg3', type: 'enum', enumValues: ['pendente_aprovacao', 'aprovada', 'docs_pendentes', 'liberada', 'vencida', 'bloqueada'] },
      { name: 'pendencias_sg3', type: 'csv' },
      { name: 'data_email_patrimonial', type: 'date', manual: true },
      { name: 'decl_resp_id', type: 'string', fk: 'declaracoes_responsabilidade' },
      { name: 'decl_resp_uploaded_sg3', type: 'bool', manual: true },
      { name: 'decl_resp_data_upload_sg3', type: 'date', manual: true },
      { name: 'prazo_liberacao_efetivo', type: 'date', calculated: true },
      { name: 'bottleneck_doc', type: 'string', calculated: true },
      { name: 'notas', type: 'string', manual: true },
      ...COMMON_META,
    ],
  },
  {
    name: 'contratos_drive',
    syncStrategy: 'upsert_drive',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'file_name', type: 'string' },
      { name: 'file_url', type: 'url' },
      { name: 'file_mime_type', type: 'string' },
      { name: 'data_criacao', type: 'datetime' },
      { name: 'data_modificacao', type: 'datetime' },
      { name: 'contrato_id', type: 'string', fk: 'contratos', manual: true },
      { name: 'status_drive', type: 'enum', enumValues: ['aguardando_faturamento', 'faturado'] },
      { name: 'em_sg3', type: 'bool', calculated: true },
      { name: 'notas', type: 'string', manual: true },
      ...COMMON_META,
    ],
  },
];

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateRow(tab, row) {
  const errors = [];
  for (const col of tab.columns) {
    const v = row[col.name];
    if (v === undefined || v === null || v === '') continue;
    switch (col.type) {
      case 'date':
        if (!RE_DATE.test(v)) errors.push(`${tab.name}.${col.name}: invalid date "${v}" (expected YYYY-MM-DD)`);
        break;
      case 'enum':
        if (!col.enumValues.includes(v)) errors.push(`${tab.name}.${col.name}: invalid enum "${v}" (expected one of ${col.enumValues.join('|')})`);
        break;
      case 'bool':
        if (typeof v !== 'boolean' && v !== 'true' && v !== 'false') errors.push(`${tab.name}.${col.name}: invalid bool "${v}"`);
        break;
      case 'integer':
        if (!Number.isInteger(Number(v))) errors.push(`${tab.name}.${col.name}: invalid integer "${v}"`);
        break;
      case 'csv':
        if (col.enumValues) {
          const items = String(v).split(',').map(s => s.trim()).filter(Boolean);
          for (const item of items) {
            if (!col.enumValues.includes(item)) errors.push(`${tab.name}.${col.name}: invalid csv item "${item}"`);
          }
        }
        break;
    }
  }
  return errors;
}

export function validateForeignKeys(tabs, data) {
  const errors = [];
  const idIndex = Object.fromEntries(
    Object.entries(data).map(([tab, rows]) => [tab, new Set(rows.map(r => r.id))])
  );
  for (const tab of tabs) {
    const rows = data[tab.name] ?? [];
    for (const col of tab.columns) {
      if (!col.fk) continue;
      const targetIds = idIndex[col.fk] ?? new Set();
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i][col.name];
        if (!v) continue;
        if (!targetIds.has(v)) {
          errors.push(`${tab.name}[${i}].${col.name}: FK "${v}" not found in ${col.fk}`);
        }
      }
    }
  }
  return errors;
}
