---
type: Session Log
title: "2026-06-25 — supplypower — download estruturado do portal GM SupplyPower (03007)"
description: Sessão de scraping via Playwright/CDP do portal ME Vehicle Systems (mevssupply.gm.com) da GM, com crawler de sitemap, download estruturado por seção e infraestrutura de manifesto para sync incremental futuro.
tags: [gm, supplypower, backfill]
timestamp: 2026-06-25
session: supplypower
language: pt-BR
project: "03007"
product: VisionKing
---

## Feito

- Sessão iniciada a partir do PMO 03007 (GM São Caetano do Sul · Paint · IRIS/VisionKing), com objetivo de baixar todos os documentos do portal GM SupplyPower / ME Vehicle Systems (`mevssupply.gm.com`).
- Autenticação federada validada: login inicial via Covisint SSO (`us.register.covisint.com`), depois GMID/Microsoft (Azure AD) na aba do ME Vehicle Systems — sessão federada expira a cada ~2,5h e exige re-login manual do usuário no Chrome (Claude não preenche credenciais).
- Crawler de mapeamento construído em múltiplas passadas (crawl / crawl2 / crawl3) até fechar o sitemap completo: **1.657 páginas, 3.922 documentos** (`sync/sitemap.json`).
- Download estruturado por seção, começando pela **Safety Center of Expertise** (G-DHS v6.01 + g-Card + Risk Profile Tool + g-Risk/SafetyFMEA + g-Comply + g-Plac + SCS-MPS-Placards + Other): 99 arquivos, 780 MB, zero falhas.
- Em seguida IRIS (Vision, Robotics, Conveyors, Industrial-Ethernet, Cyber-Security, Execution-Checklists, GPS/ODD) e depois o portal completo (NA-Press-Group, SA-Templates `.zw1`, e o bloco grande de **Global Hardware Templates**, 2.616 itens).
- Construída infraestrutura de sync incremental em `gm-supplypower/sync/`: `me_sync.py` (backfill/download/check/sync/report), `manifest.json` (SSOT por documento: `last_modified`, `downloaded_at`, etag, sha256, size), `INVENTORY.csv`, `README.md` de re-autenticação, `cdp_cookies.py`.
- Método de transporte migrado de `curl` (bloqueado pelo Akamai) para download via browser/CDP (`browser_download.py`).
- Estado final observado no digest: **3.889/3.922 arquivos (~21 GB)** no disco, com uma etapa de retry via streaming-direto-pro-disco rodando para os últimos casos (zips grandes que estouravam o método blob-em-memória).

## Decisões

- Estrutura de pastas espelha as seções do portal (`01_G-DHS`, `02_g-Card`, ... `Safety-Center-of-Expertise`, `Vision`, `Robotics` etc.), mantendo `_archive/` para versões antigas quando um doc mudar.
- Cada documento baixado é registrado no `manifest.json` com etag + `last_modified` (data de update da GM) + `downloaded_at` (nossa) + sha256 — para permitir que o crawler, no futuro, baixe só o delta de documentos alterados.
- Downloads grandes (zips de patch/DVD) exigem streaming direto para disco em vez de blob-em-memória no browser — método a ser aplicado nos remanescentes.
- Circuito de segurança contra expiração de SSO: o processo detecta sessão morta e pausa (em vez de gerar milhares de erros em cascata), aguardando re-login manual do usuário.
- `cookies.json` (credencial de sessão) mantido fora do versionamento via `.gitignore`.

## Pendências

- Verificação final do resultado completo do download (~33 erros no último estado observado) — usuário pediu para "verificar se está dando certo" mas a resposta ficou fora do digest extraído (truncamento por limite).
- Triagem final dos erros remanescentes: distinguir links quebrados no próprio portal (ex.: `CmoreModelTemplate.vsd`) de falhas recuperáveis por streaming (zips grandes, ex. `6.40.00-FTServices-A-DVD.zip` com 403, `Patches-Feb.2024.zip` com timeout).
- Confirmar que o bloco de correção do bug de duplicação da Safety (68 duplicatas removidas, manifesto restaurado, `plan_full.json` regenerado sem a Safety) não deixou resíduos.
- Rodar `me_sync check`/`report` formalmente para validar que o manifesto está consistente com o disco antes de considerar o backfill fechado.

## Links

- Portal: `https://mevssupply.gm.com/crw/production/main/globalStandards/safetyVerification.cfm`
- Projeto: `/home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/03007/gm-supplypower/`
- PMO 03007 (GM São Caetano do Sul · Paint · IRIS/VisionKing)
