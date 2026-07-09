---
type: Session Log
title: "2026-07-08 — stellantis — kickoff 03010 preparado, cronograma de 5 meses e 56 tasks no ClickUp"
description: Sessão que preparou a replicação de dev do 03010 pós-fechamento da PO, montou o pacote de solicitações para o Kick-off Stellantis, refinou o cronograma contratual e migrou 56 tasks com dependências para o ClickUp ROADMAP.
tags: [stellantis, "03010", visionking, backfill]
timestamp: 2026-07-08
session: stellantis
language: pt-BR
project: "03010"
product: VisionKing
---

# 2026-07-08 — stellantis

## Feito

- Identificado o fechamento do 03010 no Gmail (PO CP 21991568, Stellantis
  Goiana Pintura); baixados e arquivados os 4 PDFs em
  `attachments/2026-06-03-closure-cp21991568/` e analisados em
  `reports/md/analise-fechamento-2026-06-03.md`.
- Aterrada a replicação de dev no código via exploração paralela do monorepo
  VisionKing, com recorte por atividade real (descartado o que é só
  reuso/config). Tracks renomeados de letras para `DEPLOY-1/2/3/4` (dev),
  além de patch nas specs IRIS-06/07 para parametrizar nº de PDTs e
  `PROC-1` (procedimento de coleta+treino de IA on-plant).
- Montado `kickoff-solicitacoes-stellantis.md` — 10 categorias (A–J) de
  solicitações à Stellantis (PLC, CADs, classes de defeito, referências),
  com prioridade e área responsável; evoluído em 4 revisões após:
  aplicar matriz de responsabilidades em 3 camadas (STK / interface
  S7-1500↔S7-300 / STL), varrer docs locais e Drive do projeto, e
  incorporar o escopo da proposta da Dudley.
- Escrito `analise-detalhada-03010-poc-requisitos.md`: achado chave — a POC
  validou o *princípio* (capô Renegade, 2 câmeras IR, 13 peças "Nok"), não
  a métrica; POC foi standalone, sem comunicação com PLC (diferença
  relevante frente ao deploy novo, que terá integração PLC).
- Montado `overview.md` geral do 03010 no molde do 03007/03008, e
  `cronograma-esboco-03010.md` com Gantt Mermaid (tema Strokmatic) +
  grafo de dependências, incluindo marcos contratuais e de desembolso do
  cliente.
- Criadas 56 tasks no ClickUp ROADMAP (lista `[03010] Stellantis Goiana -
  Pintura`) seguindo o padrão 03007/03008, com 37 dependências e um
  milestone dedicado à entrega dos equipamentos na planta (~14/09/2026).
- Analisado o atendimento aos prazos contratuais: a PO fixa teto em 31/12,
  mas o prazo vinculante é o acordado no Kick-off; a Dudley foi orçada em
  150 dias com base na hipótese inicial de 5 meses.

## Decisões

- Modelo de IA de pintura não é task de dev: início do sistema com modelo
  dummy pré-existente; coleta e treino reais só depois do comissionamento.
- Separação de metas: a meta de 5 meses cobre sistema instalado + comissionado
  + 30 dias sem intercorrência (disponibilidade ≥95%); a IA (eficiência de
  leitura ≥95%) pode avançar durante/após esses 30 dias sem obrigação de
  terminar no prazo — lastreado na planilha de requisitos, que já separa os
  dois critérios de aceite.
- Estratégia de negociação: buscar com o cliente o cronograma de 5 meses
  (11/11) em vez dos 4 meses (11/10) mais recentes citados pela Stellantis,
  por ser o que toda a cadeia (inclusive Dudley) foi dimensionada para
  cumprir; registradas as duas datas como alternativas no cronograma.
- CADs completos dos 6 modelos serão solicitados independentemente do que
  já está em mãos (só capô do Renegade + portas do Commander/598 hoje);
  necessidade de NDA sinalizada por conta do 6º modelo TBD (provável
  lançamento). Atraso na entrega dos CADs pelo cliente é condicional e
  explicitamente atrasa o cronograma todo — a ser destacado nos documentos
  e na apresentação do Kick-off.
- Data do Kick-off fixada em 11/06/2026 para efeito de recálculo em cascata
  do cronograma.

## Pendências

- Confirmar com a Stellantis, no Kick-off, o cronograma de 5 meses (11/11)
  como prazo vinculante em vez dos 4 meses.
- Fechar NDA para cobrir o 6º modelo (TBD/lançamento) antes do envio dos
  CADs completos.
- Receber CADs completos dos 6 modelos — bloqueio do caminho crítico
  (simulação de varredura, validação de layout de câmeras/pórtico, fechamento
  de BOM e disparo de compras).
- PO de Material (R$ 624.300) ainda em emissão pela Stellantis, separada da
  PO de Serviços (R$ 1.456.700) já fechada.
- Destacar nos documentos/apresentação do Kick-off que atraso do cliente na
  entrega dos CADs atrasa o cronograma inteiro (ação combinada, ainda não
  redigida em texto final segundo o digest disponível).

## Links

- `workspaces/strokmatic/pmo/projects/03010/attachments/2026-06-03-closure-cp21991568/`
- `workspaces/strokmatic/pmo/projects/03010/reports/md/analise-fechamento-2026-06-03.md`
- `workspaces/strokmatic/pmo/projects/03010/reports/md/kickoff-solicitacoes-stellantis.md`
- `workspaces/strokmatic/pmo/projects/03010/reports/md/analise-detalhada-03010-poc-requisitos.md`
- `workspaces/strokmatic/pmo/projects/03010/reports/md/cronograma-esboco-03010.md`
- ClickUp lista `[03010] Stellantis Goiana - Pintura`:
  https://app.clickup.com/3081126/v/l/li/901113759480
- Memória: `project_03010_stellantis_paint`, `reference_vk_deploy_replication_arch`
