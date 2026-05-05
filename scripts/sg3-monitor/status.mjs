#!/usr/bin/env node
import { loadConfig } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { SheetClient } from './lib/sheet-client.mjs';

async function main() {
  const cfg = loadConfig();
  const { sheets } = buildClients(cfg);
  const client = new SheetClient(sheets, cfg.sheet_id);
  const ativas = (await client.readTab('alocacoes'))
    .filter(a => a.status_sg3 === 'liberada')
    .sort((x, y) => (x.prazo_liberacao_efetivo ?? '').localeCompare(y.prazo_liberacao_efetivo ?? ''));

  if (ativas.length === 0) {
    console.log('(sem liberações ativas)');
    return;
  }

  const colaboradores = await client.readTab('colaboradores');
  const cadastros = await client.readTab('cadastros_sg3');
  const plantas = await client.readTab('plantas');
  const colMap = Object.fromEntries(colaboradores.map(c => [c.id, c]));
  const cadMap = Object.fromEntries(cadastros.map(c => [c.id, c]));
  const plaMap = Object.fromEntries(plantas.map(p => [p.id, p]));

  console.log(`Liberações ativas (${ativas.length})\n`);
  for (const a of ativas) {
    const colNome = colMap[a.colaborador_id]?.nome_completo ?? a.colaborador_id;
    const cad = cadMap[a.cadastro_sg3_id];
    const plaNome = plaMap[cad?.planta_id]?.nome ?? cad?.planta_id;
    const prazo = a.prazo_liberacao_efetivo || '?';
    const bottleneck = a.bottleneck_doc || '?';
    console.log(`  ${colNome.padEnd(28)} → ${plaNome.padEnd(20)} até ${prazo}  (${bottleneck})`);
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
