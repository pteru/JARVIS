---
type: Reference
title: Journal — diário de trabalho por sessão/tópico
description: Uma entrada por bloco de trabalho de sessão nomeada — substrato de memória dos especialistas OKF. Boot canônico em BOOT.md.
tags: [okf, journal]
timestamp: 2026-07-08
language: pt-BR
---

# Journal

Diário de trabalho destilado, uma entrada por bloco de sessão
(`YYYY-MM-DD-<topic>.md`). Especialistas leem as 2–3 entradas mais recentes do
seu tópico no boot ([BOOT.md](BOOT.md)). Entradas com tag `backfill` são
snapshots retroativos de sessões pré-journal.

- [BOOT.md](BOOT.md) — Convenção canônica de boot dos especialistas + roster.
- [2026-07-08-okf.md](2026-07-08-okf.md) — Adoção OKF, governança Drive 03008 e spec dos especialistas.
- [2026-06-11 — magna — solver de inspeção com oclusão stackup-transparente para Caixa de Roda (WH LH)](2026-06-11-magna.md) — Sessão no sdk-inspection-grouping-optimizer que corrigiu o modelo de oclusão (stackup de chapas soldadas transparente) e o bug de FOV-por-profundidade, fechando 100% de cobertura com a câmera MV-SC6016M.
- [2026-06-15 — smartdie-sjc — signal-viewer para DieMaster 01001 + diagnóstico DP10](2026-06-15-smartdie-sjc.md) — Construção do signal-viewer (Vite+Express+Plotly) para os 18 painéis foco do teste GM SJC S10 e diagnóstico do artefato de médias v1→v2 no sensor DP10.
- [2026-06-15 — sprint-helper — descrições e campos preenchidos em 3 sprints ClickUp (SF/VK/DM)](2026-06-15-sprint-helper.md) — Detalhamento de descrições, roteamento de primary lists e preenchimento de assignee/datas/pontos em 34 tarefas das sprints de SpotFusion, VisionKing e DieMaster, a partir das atas de início de sprint.
- [2026-06-22 — aeroporto — busca confirma que não há sessão dedicada ao tema](2026-06-22-aeroporto.md) — Varredura dos transcripts de sessão em busca de trabalho sobre o Aeroporto Teruel concluiu que as ocorrências do termo são ruído (MEMORY.md, exemplo de e-mail, outro aeroporto), não trabalho real.
- [2026-06-22 — arrendamento — minutas de notificação de não-renovação](2026-06-22-arrendamento.md) — Recuperação de conversa anterior sobre cobrança de arrendamento de soja, inventário da pasta Drive "Arrendamento Schmidt" e elaboração de duas minutas de notificação extrajudicial de não-renovação automática.
- [2026-06-22 — emails — triagem iterativa da inbox (615 → 38 não-lidos) + filtros Gmail + pesquisa de leads de fornecedores](2026-06-22-emails.md) — Sessão de limpeza de caixa de entrada em múltiplos ciclos leitura-limpeza-releitura, com desenho de 6 filtros Gmail persistentes e pesquisa verificada (não especulativa) de 6 leads de fornecedores contra o stack Strokmatic.
- [2026-06-25 — supplypower — download estruturado do portal GM SupplyPower (03007)](2026-06-25-supplypower.md) — Sessão de scraping via Playwright/CDP do portal ME Vehicle Systems (mevssupply.gm.com) da GM, com crawler de sitemap, download estruturado por seção e infraestrutura de manifesto para sync incremental futuro.
- [2026-06-29 — amendoim — mapa A-1 da Fazenda Amendoim com módulos Capiaçu redesenhados](2026-06-29-amendoim.md) — Sessão que mapeou os 31 campos da fazenda via EOS Crop Monitoring, rodou um pipeline Sentinel-2 de extração de divisórias, redesenhou os módulos do Capiaçu via playground interativo e gerou/ajustou o mapa A-1 final para impressão.
- [2026-06-29 — mercedes-vk — proposta técnica + mapa de conformidade RSCF para RFQ 3000588448 (03904)](2026-06-29-mercedes-vk.md) — Análise integral do RFQ Mercedes-Benz/Daimler (tetos de cabine, JdF), montagem da proposta técnica e do mapa de conformidade de cibersegurança RSCF, e organização do projeto 03904 em PMO/Drive.
- [2026-07-06 — arcelor-data — mapeamento vk01/vk02→DAS e início da cópia real](2026-07-06-arcelor-data.md) — Reconstrução da sessão arcelor-data perdida, remapeamento da topologia local (DAS em vk01) e execução validada do rsync detached vk01→DAS.
- [2026-07-06 — jarvis — auditoria estrutural, limpeza e migração do backlog para GitHub Issues](2026-07-06-jarvis.md) — Sessão de auditoria completa do repositório JARVIS (fora de workspaces/), limpeza de dead code e repos soltos, e migração revisada do backlog local para issues no GitHub em 10 repositórios.
- [2026-07-06 — pmo-build — jarvis-chat implementado; scaffolding de KB por projeto especificado](2026-07-06-pmo-build.md) — Sessão que especificou, planejou e implementou o serviço jarvis-chat (presença do JARVIS em espaços de projeto no Google Chat) e iniciou o design do acesso do bot às knowledge bases por projeto ancoradas no repositório PMO.
- [2026-07-07 — sparktest — inventário de arquitetura, handoff zip e push do submodule pendente](2026-07-07-sparktest.md) — Sessão que reconstruiu o inventário de implementação do SPARK-01..07 no monorepo VisionKing, empacotou um handoff para o time e resolveu o submodule spark-test-controller que estava só local.
- [2026-07-08 — arcelor-vpn — correção do inference OBB e detecção do vk02 caído](2026-07-08-arcelor-vpn.md) — VPN Checkpoint restabelecida, migração do inference vk01 para modelo detection com remapeamento de classes, e descoberta de que o vk02 está fora do ar.
- [2026-07-08 — blender — Strokmatic Vision Tools v1.0.0 (heatmaps de resolução e ângulo)](2026-07-08-blender.md) — Sessão que desenhou, implementou e publicou um add-on Blender com heatmaps de resolução (px/mm) e ângulo de visada para validação de posicionamento de câmeras VisionKing.
- [2026-07-08 — iris-scds — RFQ de controle térmico e revisão de sensores/atuadores IRIS](2026-07-08-iris-scds.md) — Sessão de engenharia de compras do 03007 (IRIS GM Paint Shop) — sensores LANBAO, atuadores SHELE+Delta, decisão standalone-vs-Modbus TCP para controle térmico e RFQ enviável a fornecedores chineses.
- [2026-07-08 — rh — fundação do workspace RH e conciliação de bolsas SENAI](2026-07-08-rh.md) — Workspace adm/rh/ criado do zero, conciliando planilha de folha local com a fonte "Bolsas (efetivo)" e mensagens do responsável técnico, mais uma análise pessoal separada de CLT vs PJ.
- [2026-07-08 — sealer — pipeline v3 productizado + GUI de correção C1/C2 + reconciliação de status](2026-07-08-sealer.md) — Sessão longa do tópico sealer cobrindo a spec/plano da SEALER-01, a migração byte-exata do pipeline v3 de centerlines para o toolkit sealer-provisioning, o design e build (Phase 0/C1/C2) da GUI de correção, e a reconciliação de status de dev (áudio do William) no ClickUp.
- [2026-07-08 — stellantis — kickoff 03010 preparado, cronograma de 5 meses e 56 tasks no ClickUp](2026-07-08-stellantis.md) — Sessão que preparou a replicação de dev do 03010 pós-fechamento da PO, montou o pacote de solicitações para o Kick-off Stellantis, refinou o cronograma contratual e migrou 56 tasks com dependências para o ClickUp ROADMAP.
