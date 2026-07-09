---
type: Session Log
title: 2026-06-29 — mercedes-vk — proposta técnica + mapa de conformidade RSCF para RFQ 3000588448 (03904)
description: Análise integral do RFQ Mercedes-Benz/Daimler (tetos de cabine, JdF), montagem da proposta técnica e do mapa de conformidade de cibersegurança RSCF, e organização do projeto 03904 em PMO/Drive.
tags: [mercedes-vk, "03904", visionking, backfill]
timestamp: 2026-06-29
session: mercedes-vk
language: pt-BR
project: "03904"
product: VisionKing
---

# 2026-06-29 — mercedes-vk

## Feito

- Lido e analisado integralmente o e-mail encaminhado do RFQ 3000588448 /
  0016102467 (Mercedes-Benz do Brasil / Daimler Truck, planta Juiz de Fora,
  área Montagem Bruta P15) — sistema de visão/IA para inspeção de superfície
  dos tetos de cabine (ACCELO/NTC/SFTP). Todos os 13 anexos lidos por
  completo (5 agentes em paralelo + leitura direta), cobrindo RFX, condições
  gerais/específicas de compra, escopo técnico, normas, DEA, SST, RSCF,
  P.SSO.013/031, LGPD e planilha de preços.
- Montada a primeira versão da **proposta técnica** e da **solicitação de
  subcontratação** (automação + segurança do trabalho), espelhando o
  precedente do projeto 03010 (Stellantis), que também cobre escopo de
  automação completo.
- Criado o projeto **03904** em `pmo/projects/03904/` e no Drive
  (`[03] VISION KING/[03904] VK Body Mercedes-Benz JdF`), com as 7
  subpastas padrão VK; anexos do RFQ e PDFs enviados.
- Registrado o conhecimento do projeto em `context.md` (stakeholders,
  timeline, perguntas abertas) e o e-mail de resposta ao Fábio.
- Investigada e resolvida a dúvida sobre "Blue PC": confirmado no RSCF v4
  (§6, §7.5.9.2) que Blue PC = imagem Windows Daimler é o *padrão*, não uma
  proibição — existe caminho para sistema não-Windows via §7.5.7 + §7.5.3 +
  §7.5.2 (aceite do ISA-A, hardening, exceção de EDR a acordar por escrito).
- Proposta revisada (Rev01→Rev03): appliance Ubuntu headless dedicado
  (não "compatível com Blue PC"); seção de cibersegurança reescrita
  enquadrando o VK como "sistema não Windows".
- Enviado por extenso ao Fábio via Google Chat (DM) o resumo de
  cibersegurança com citações verbatim do RSCF e 12 pontos a confirmar (A–L).
- Preparado guia ponto a ponto para reunião com a Mercedes (10/06, 15:30);
  após a reunião, incorporadas as definições (2 estações de inspeção
  P15.030/035, 10 monitores touch com stylus, NP via RFID no PLC, PLC
  Siemens S7-319F/STEP7/PROFINET) na proposta (Rev02) e no `context.md`.
- Criado o **mapa de conformidade RSCF** (`mapa-conformidade-rscf-vk-mb.md`)
  demonstrando ponto a ponto (§7.1–§7.6) como o appliance Ubuntu atende à
  norma, enquadrado como sistema não-Windows.
- Avaliada a proposta da Mercedes (via contato local) de provisionamento de
  SO com round-trip físico do PC via equipe da Índia (imagem Ubuntu própria
  da Daimler) e o PC padrão Advantech ACP-4000 (i9, 8GB RAM, 1TB RAID1,
  fonte redundante, sem GPU). Decisão de propor cenário alternativo: adesão
  apenas à norma, sem esse requisito extra — refletida no mapa de
  conformidade (novo §4) e na proposta.
- Rev03 da proposta + mapa de conformidade exportados em PDF e publicados
  no Drive; versão Rev00 antiga movida/renomeada como SUPERSEDED em
  `06-Administrativo` (MCP do Drive não tem delete).
- Registradas as respostas de Pedro Conde (Mercedes) de 12/06: lista de 11
  modos de defeito, leitura técnica (deflectometria/furação CAD-driven/cor
  para oxidação), pasta B2B, CAD em JT, visita técnica agendada para 24/06.
- Rascunhado e-mail (não enviado — sem permissão de envio via MCP Gmail)
  para Fábio/Tiago/Jonas centralizarem os CADs (JT + STEP) na pasta
  `01-Desenhos` do 03904.

## Decisões

- 03010 (Stellantis) é o precedente-base para a proposta técnica e para a
  solicitação de subcontratação, por cobrir automação completa.
- Código final do projeto: **03904** (não 03011, provisório inicial).
- Posicionamento de plataforma: appliance Ubuntu headless enquadrado como
  "sistema não Windows" (RSCF §7.5.7), não como compatível com Blue PC.
- Recusar o modelo de provisionamento de SO via round-trip físico com a
  Índia; propor ativamente cenário de adesão só à norma (hardening próprio
  Strokmatic + aceite ISA-A), sem requisitos extras desnecessários.
- Cibersegurança passa a ser seção dedicada dentro da proposta técnica
  principal (não mais documento separado); ponto de contato para essas
  perguntas é Pedro Conde (contato direto na Mercedes).
- Não é possível criar grupo novo no Google Chat via MCP (escopo
  `chat.memberships` somente leitura) — Pedro precisa criar manualmente e
  passar o espaço/ID.

## Pendências

- Perguntas de processo Q2, Q3, Q4, Q6, Q8 seguem em aberto para a visita
  técnica de 24/06.
- Aguardar confirmação/exceção por escrito da Mercedes sobre EDR e aceite
  do ISA-A para o cenário sem round-trip via Índia.
- Aguardar CADs (STEP exportado do JT por Jonas), lista de defeitos, fotos
  do ponto de saída e desenho dimensionado da área P15.030/035.
- E-mail de centralização de CADs preparado mas não disparado (Pedro
  precisa enviar manualmente).
- Grupo de Google Chat com Fábio/Tiago/Jonas não criado — depende de ação
  manual do Pedro.

## Links

- Projeto local: `workspaces/strokmatic/pmo/projects/03904/`
  (`reports/md/`, `reports/pdf/`, `subcontratacao/`, `anexos-rfq/`).
- Drive: `[03] VISION KING/[03904] VK Body Mercedes-Benz JdF`
  — https://drive.google.com/drive/folders/17_-RwA8GFgZ2kTWQdrsaWaji3un0uiEY
- Pasta de CADs (01-Desenhos): https://drive.google.com/drive/folders/14uvzCzhN06r9gsmxk6lRWmy1MHAyKb5r
- Proposta técnica Rev03 (PDF): https://drive.google.com/file/d/14Em0edTM3AEKksWJln7fo1hK_-edsOSH/view
- Mapa de conformidade RSCF (PDF): https://drive.google.com/file/d/1WfAKmbv_clHD7imHf36KSZNiVk9AArO4/view
- Memória: `project_03904_mercedes_jdf_tetos.md` (RSCF permite SO não-Windows; due 03/07/2026).
