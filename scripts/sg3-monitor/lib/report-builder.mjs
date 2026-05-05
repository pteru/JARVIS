const ICON = {
  PRAZO: '📅',
  VENCIDO: '🔴',
  ESTADO: '🟡',
  DRIFT: '🔎',
  LIBERADO: '✅',
};

export function buildReport({ date, ativas, prazos, vencidos, estado, drift, saude, sheetUrl }) {
  const lines = [];
  lines.push(`🚨 SG3 GM — Daily Compliance Report — ${date}`);
  lines.push('');

  if (ativas?.length > 0) {
    lines.push(`✅ LIBERAÇÕES ATIVAS (${ativas.length})`);
    for (const a of ativas) {
      lines.push(`   • ${a.colaboradorNome} → ${a.plantaNome}    até ${a.prazoEfetivo}  (gargalo: ${a.bottleneck})`);
    }
    lines.push('');
  }

  if (prazos?.length > 0) {
    lines.push('📅 PRAZOS PRÓXIMOS');
    for (const p of prazos) lines.push(`   ⚠️ EM ${p.diasRestantes} DIAS — ${p.titulo}\n      ${p.detalhe}`);
    lines.push('');
  }

  if (vencidos?.length > 0) {
    lines.push('🔴 VENCIDOS');
    for (const v of vencidos) lines.push(`   ❌ ${v.titulo} — vencido há ${Math.abs(v.diasRestantes)} dia(s)\n      ${v.detalhe}`);
    lines.push('');
  }

  if (estado?.length > 0) {
    lines.push('🟡 PENDÊNCIAS DE ESTADO');
    for (const e of estado) lines.push(`   • ${e.titulo}\n      ${e.detalhe}`);
    lines.push('');
  }

  if (drift?.length > 0) {
    lines.push('🔎 DRIFT DRIVE × SG3');
    for (const d of drift) lines.push(`   • ${d.titulo}: ${d.detalhe}`);
    lines.push('');
  }

  lines.push('📊 SAÚDE DO PIPELINE');
  for (const [stage, status] of Object.entries(saude)) {
    const icon = status.ok ? '✅' : '❌';
    lines.push(`   • ${stage}: ${icon} ${status.detalhe}`);
  }
  lines.push('');

  if (sheetUrl) lines.push(`🔗 Sheet: ${sheetUrl}`);

  return lines.join('\n');
}

export function emptyDayMessage(date) {
  return `✅ Tudo OK em ${date}.`;
}
