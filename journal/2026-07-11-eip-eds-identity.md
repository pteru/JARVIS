---
type: Session Log
title: 2026-07-11 — eip — identidade CIP 13771 + EDS Classe 1 entregue (PR #11)
description: O pedido "faça o EDS" revelou mismatch duplo — binário com defaults upstream (Vendor 1/"OpENer PC") e EDS com 9876 (placeholder que o CT20 rejeitou) — corrigido com injeção CMake no Dockerfile (13771/43/1/rev 1.0 do cert/EDS_REVISION) + EDS alinhado; PR #11 APPROVE limpo, merged; bancada .189 atualizada e EDS entregue ao William com valores de keying.
tags: [eip, strokmatic-eip, eds, cip, identity, classe1, 03007]
timestamp: 2026-07-11
session: eip-eds-identity
project: "03007"
language: pt-BR
---

# 2026-07-11 — eip (EDS Classe 1 + fix de identidade CIP)

## Feito

- **Diagnóstico**: o EDS já existia (Task 12 da cert, estrutura correta —
  conexões EO/IO/LO, assemblies 100/150 128 B, config 151), mas era inutilizável
  p/ electronic keying: **binário** com defaults upstream (Vendor 1 Rockwell,
  ProdCode 65001, rev 2.3, "OpENer PC" — vars CMake `OpENer_Device_Config_*`
  nunca sobrescritas) e **EDS** com Vendor 9876 (placeholder que o próprio CT20
  rejeitou em 2024: "expected Vendor ID 13771").
- **Fix (PR #11, APPROVE limpo, MERGED)**: Dockerfile injeta a identidade via
  guards `if NOT DEFINED` do upstream (árvore do fork intocada) — Vendor
  **13771**, Type 43, ProdCode 1 (placeholder ODVA), nome STROKMATIC-COMM-V1,
  revisão lida de `cert/EDS_REVISION` (mesmo SSOT do eds_identity.c). EDS
  9876→13771; cert/README + CERTIFICATION.md corrigidos (guidance; histórico
  preservado). Validado: devicedata.h gerado = EDS exato; scanner Classe 1 PASS.
- **Bancada .189 atualizada**: CI orgânica buildou `767b988`; save+scp+load,
  adapter recriado (redis/tag-client intocados, up 9 h); EDS copiado p/
  `~/eip-stack/`. Tag `2026.07` do registry re-apontada via `docker push`
  (sobrescreve sem precisar de tags delete, que o classifier bloqueia).
- **William avisado** (follow-up na mesma thread da DM): EDS no path, import
  via Studio 5000 EDS Hardware Installation Tool, valores de keying
  (13771/43/1/1.0), conexões e RPI (default 30 ms; testar 10–20 ms = alvo
  Fase B), espelho `io:in/out` no Redis.

## Decisões

- Identidade injetada no Dockerfile (não na árvore CMake do fork) — merges de
  upstream continuam limpos.
- Mudança de identity = recert trigger (CERTIFICATION.md): intencional; o
  roadmap já listava o 9876 como erro obrigatório de corrigir.

## Pendências

- Retorno do William: import do EDS no Studio 5000 + ForwardOpen contra o
  adapter da bancada (validação keying real).
- ProdCode definitivo quando a ODVA reativar o cadastro (hoje = 1 placeholder).
- Operacionais: reader p/ deploy-assistant@; senha Redis histórico; default
  branch master→develop.

## Links

- PR: strokmatic-eip#11 (merged) · Build CI: 02ff27a2 → `:767b988`
- EDS: `adapter/eds/STROKMATIC-COMM-V1.eds` · SSOT identidade: `adapter/cert/EDS_REVISION`
- Journals: [[2026-07-10-eip-cloudbuild]] (bloco anterior)
