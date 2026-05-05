const RE_CONTRATO_GM   = /^(?:Contrato\s+)?(5000\d{6,7})\b/i;
const RE_DANFE         = /^GENERAL MOTORS LTDA\s*-\s*DANFE/i;
const RE_VENC_PREFIX   = /^VENC\s*-\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(.+?)(_assinada)?\.(pdf|docx|xlsx|xlsm)$/i;

export function classifyDriveFile({ name, parentName }) {
  if (parentName === 'GM - SG3') return { kind: 'template' };
  if (RE_DANFE.test(name))       return { kind: 'danfe' };

  const m = name.match(RE_CONTRATO_GM);
  if (m) {
    return {
      kind: 'contrato_gm',
      contratoId: m[1],
      statusDrive: parentNameToStatus(parentName),
    };
  }

  const v = name.match(RE_VENC_PREFIX);
  if (v) {
    const [, dd, mm, yyyy, descricao] = v;
    return {
      kind: 'doc_with_venc',
      dataVencimento: `${yyyy}-${mm}-${dd}`,
      descricao: descricao.trim(),
    };
  }

  return { kind: 'unknown' };
}

function parentNameToStatus(parentName) {
  if (parentName === 'GM - CONTRATO FATURADO') return 'faturado';
  if (parentName === 'Aguardando FATURAMENTO') return 'aguardando_faturamento';
  return null;
}
