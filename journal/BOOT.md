---
type: Procedure
title: Boot de Especialista OKF
description: Convenção canônica de boot dos especialistas de tópico — como rehidratar contexto a partir do journal e dos bundles OKF.
tags: [okf, journal, specialists]
timestamp: 2026-07-08
product: general
language: pt-BR
---

# Boot de Especialista OKF

Todo especialista (skill `/<slug>` ou agente `<slug>-specialist`) boota assim:

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles).
2. `python3 ~/JARVIS/scripts/okf/okf.py search <termos do tópico> --tag <slug>`
   — colete hits em journal + knowledge-base + pmo + engineering-docs.
   Especialistas de projeto repetem com `--project "NNNNN"`.
3. Leia as 2–3 entradas de `~/JARVIS/journal/` mais recentes do tópico (data no
   nome do arquivo). O boot é guiado pela TAREFA: em tópicos amplos, filtre pela
   sub-tag relevante (ex.: `pessoal` → `aeroporto`), nunca carregue tudo.
4. Leia as páginas de conhecimento que essas entradas linkam (camadas
   `knowledge/` de projeto, concepts da KB, specs) — progressive disclosure,
   nunca leitura exaustiva.
5. Só então aja. Cite as fontes OKF (caminhos) nas respostas.

## Encerramento de bloco de trabalho

Antes de criar o arquivo, rode
`python3 ~/JARVIS/scripts/okf/cascade.py entry <topic>` e obedeça a
resposta: `EXTEND` = anexe o incremento à entrada indicada (ela ainda não
foi absorvida pelo cascade); `NEW` = crie o arquivo indicado. **Nunca edite
uma entrada já absorvida** — o incremento ficaria invisível para o cascade.

Se o `entry` avisar **tópico fora do roster**: use dupla filiação — a tag
emergente vem PRIMEIRA (vira o marcador de recorrência) e a tag do tópico
existente mais próximo vem em seguida (dá retrieval hoje, ex.:
`[autoscaler, vk-producao, ...]`). Apresente ao dono a proposta de criação
do especialista com o comando pronto — **nunca crie sem aprovação dele**;
na dúvida, mantenha a dupla filiação e deixe o contador de recorrência do
okf-watch sugerir a promoção quando o tema acumular entradas.

Formato de `journal/YYYY-MM-DD-<topic>.md` (sufixo `-2`, `-3` para mesmo
dia/tópico): frontmatter `type: Session Log` + `session:` + tags (slug do
tópico primeiro, depois códigos de projeto "NNNNN" e tags de campo); corpo
PT-BR de 20–40 linhas com **Feito** · **Decisões** · **Pendências** ·
**Links**. É uma destilação, nunca dump de transcript. **NUNCA inclua
segredos ou credenciais.** Depois rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.

## Roster

| Slug | Classe | Termos de busca | Tags |
| --- | --- | --- | --- |
| sealer | project | sealer centerline provisioning 03008 | sealer,03008,visionking,automacao |
| iris-scds | project | iris scds camera 03007 | iris-scds,03007,visionking,automacao |
| stellantis | project | stellantis goiana paint 03010 | stellantis,03010,visionking |
| arcelor | project | arcelormittal producao 03002 03009 | arcelor,03002,03009,visionking |
| sparktest | project | sparktest fagulhamento 03011 | sparktest,03011,visionking |
| mercedes-vk | project | mercedes jdf tetos 03904 | mercedes-vk,03904,visionking |
| smartdie | project | diemaster smartdie sjc 01001 | smartdie,01001,diemaster |
| magna | project | magna prospeccao spot | magna,prospeccao |
| nissan-smyrna | project | nissan smyrna smartcam 02008 | nissan-smyrna,02008,spotfusion |
| eip | project | ethernet-ip opener cip strokmatic-eip | eip,strokmatic-eip |
| automacao | field | servo drive plc profinet ethercat gsdml | automacao |
| vk-producao | field | producao monitoramento troubleshoot vk-health burnin | vk-producao,arcelor |
| dados-producao | field | backup migracao dumps imagens das gcs | dados-producao,arcelor |
| blender | field | blender sdk-blender-tools 3d render | blender |
| gm | field | gm supplypower normas general motors | gm |
| pmo | field | pmo processos sprints governanca drive | pmo |
| okf | field | okf knowledge bundle catalog journal | okf |
| jarvis | field | orchestrator jarvis skills mcp dispatch | jarvis |
| administrativo | field | administrativo rh contratos financeiro | administrativo |
| propriedade-intelectual | field | patente ip inpi claims 03000 02000 | propriedade-intelectual |
| pessoal | field | pessoal aeroporto arrendamento amendoim | pessoal |
| iris-plc-rewire | project | iris plc rewire aoi cia402 servo leadshine el8-ec 03007 | iris-plc-rewire,03007,automacao,visionking |
