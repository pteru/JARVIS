const DAY_MS = 86_400_000;

function diasEntre(hojeIso, vencIso) {
  const hoje = new Date(hojeIso + 'T00:00:00Z');
  const venc = new Date(vencIso + 'T00:00:00Z');
  return Math.round((venc - hoje) / DAY_MS);
}

export function evaluateTemporal({ tipo, dataVencimento, hoje, leadTimes }) {
  const dias = diasEntre(hoje, dataVencimento);
  if (dias < 0) return { severity: 'VENCIDO', diasRestantes: dias };
  const thresholds = leadTimes[tipo] ?? leadTimes.default ?? [30, 15, 7];
  if (thresholds.includes(dias)) return { severity: 'PRAZO', diasRestantes: dias };
  return null;
}

function pickMin(candidates) {
  // candidates: [{ data, motivo }]
  const valid = candidates.filter(c => c.data);
  if (valid.length === 0) return null;
  valid.sort((a, b) => a.data.localeCompare(b.data));
  return valid[0];
}

export function prazoEfetivoCarta({ cartaVencimento, contratoFim, cndsLume = [] }) {
  const candidates = [
    { data: cartaVencimento, motivo: 'carta' },
    { data: contratoFim, motivo: 'contrato' },
    ...cndsLume.map(c => ({ data: c.dataVencimento, motivo: 'CND' })),
  ];
  return pickMin(candidates);
}

export function prazoLiberacaoEfetivo({
  alocacao,
  cadastroSg3,
  contrato,
  docsColaborador = [],
  docsEmpresaSubcontratada = [],
  cartaSubcontratacao,
  aprovacaoJuridico,
  declaracaoResponsabilidade,
}) {
  if (declaracaoResponsabilidade && declaracaoResponsabilidade.assinaturas !== 'completa') {
    return { bloqueada: true, motivo: 'declaracao_responsabilidade incompleta' };
  }

  const candidates = [];
  if (alocacao?.data_vencimento_propria) candidates.push({ data: alocacao.data_vencimento_propria, motivo: 'alocação' });
  if (cadastroSg3?.data_vencimento)      candidates.push({ data: cadastroSg3.data_vencimento, motivo: 'cadastro SG3' });
  if (contrato?.data_fim)                candidates.push({ data: contrato.data_fim, motivo: `contrato ${contrato.id ?? ''}`.trim() });
  if (cartaSubcontratacao?.prazo_efetivo) candidates.push({ data: cartaSubcontratacao.prazo_efetivo, motivo: `carta ${cartaSubcontratacao.id ?? ''}`.trim() });
  if (aprovacaoJuridico?.prazo_definido) candidates.push({ data: aprovacaoJuridico.prazo_definido, motivo: 'aprovação jurídico GM' });

  for (const d of docsColaborador) {
    if (d.data_vencimento) {
      const nome = d.colaboradorNome ? ` ${d.colaboradorNome}` : '';
      candidates.push({ data: d.data_vencimento, motivo: `${d.tipo.toUpperCase()}${nome}` });
    }
  }
  for (const d of docsEmpresaSubcontratada) {
    if (d.data_vencimento) {
      const empresa = d.empresaNome ? ` ${d.empresaNome}` : '';
      const tipoFmt = d.tipo.startsWith('cnd_')
        ? 'CND ' + d.tipo.slice(4).replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
        : d.tipo.toUpperCase();
      candidates.push({ data: d.data_vencimento, motivo: `${tipoFmt}${empresa}` });
    }
  }

  const min = pickMin(candidates);
  if (!min) return { bloqueada: false, data: null, bottleneck: 'sem dependências com data' };
  return { bloqueada: false, data: min.data, bottleneck: `${min.motivo} vence ${min.data}` };
}
