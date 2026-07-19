---
type: journal
title: "IRIS 03007 — adapter no db1 + spec do Anexo D/Front DataMap + handoff Arthur"
description: "Fechou a consolidação da eip-stack no db1 (patch REDIS_DB no adapter C, build local, deploy); escreveu inline os specs do Anexo D (assembly hot Classe 1) e do Front DataMap (DB_* <- hot/cold/WS); enviou os dois ao Arthur pelo Chat do 03007 para atuar no decode."
tags: ["iris-anexod-handoff", "iris-scds", "03007", "eip-stack", "io-decoder", "eds", "anexo-d", "redis", "jobdata"]
timestamp: 2026-07-14
project: "03007"
product: IRIS
language: pt-BR
status: done
---

# 2026-07-14 — IRIS 03007: adapter no db1, Anexo D/Front DataMap, handoff Arthur

## Feito
- **Adapter → db1 (PR #13 + deploy):** patch `REDIS_DB` no adapter C (`SELECT <db>` após AUTH, ~15 linhas em `redis_bridge.c`/`.h`/`main.c` + fix do `redis_bridge_test`; glue POSIX, não toca OpENer/CIP). Branch `feat/eip-db1-consolidation` → **PR #13** para `develop` (adapter + tag-client `REDIS_DB` + io-decoder + README + fix). EDS `d65b743` empurrado direto na develop. Build local (`docker build`, ~30M gzip), scp p/ WS, `docker load`, imagem antiga guardada como `:pre-redisdb`. Compose WS: `REDIS_DB=1` no adapter; `decoder.json` `source.db` 0→1; recreate adapter+io-decoder. **Validado:** io:in/status:comm/eds:info/schema:version agora no db1; db0 sem writer da stack (io:in idle crescendo); mirror-test PASS; tags-diff 0; painel 0/115 null. Órfãs do adapter no db0 limpas (DEL=4). Stack 100% no db1 usando o keydb :4000 compartilhado (sem redis próprio).
- **Spec Anexo D (inline):** `pmo/projects/03007/specs/IRIS-03007-AnexoD-Hot-Assembly.md` — layout byte-a-byte dos 2 assemblies Classe 1 (STATUS `io:in` 0–127; COMANDO `io:out` 16–127, 0–15 header do adapter). Core (0–71) já implementado formalizado; adições 72+ propostas (PVI/Style DINT, HB_IRIS/GM, Alarm count/severity, Safety/Comm/Sensores bits, DriveState). Orçamento de spare: STATUS ~24 B, COMANDO ~100 B.
- **Spec Front DataMap (inline):** `IRIS-03007-Front-DataMap.md` — mapa dos 10 hashes `DB_*` ← lane (HOT/COLD/CMD/CFG/WS) ← tag do contrato. Cobre os cold (térmica, alarmes A01-55, sensores).
- **Handoff Arthur:** enviei os 2 docs em markdown pelo Chat do 03007 (`space AAQA2MgKg30`, thread único) para ele atuar no decode.

## Decisões / achados
- **PVI/Style = Jobdata GM** (`UDT_StationJob` do L5X): `PVI` ← `Station[0].VID` DINT, `Style` ← `Station[0].Style` DINT. "PVI" = VID nativo; termo GM_PVI/GM_Style STRING deprecado.
- **⚠ `part_uuid` NÃO é o PVI** — é gerado pela camera-acquisition no trigger. O io-decoder atual mapeia `part_uuid <- GM_PVI` (errado): vai clobberar a cam-acq quando as câmeras subirem. Correto: io-decoder escreve `PVI`/`Style` (do PLC), não `part_uuid`. Registrado no spec; **não corrigido no código** (fora do escopo desta rodada).
- **Nome textual do Style ("Rhino") fica fora do Anexo D** — wire carrega DINT; mapa DINT↔texto é da WS.
- **Produtor dos `DB_*`:** io-decoder (config-driven) para campos PLC (hot + cold via `cold_source`); WS-backend só `DB_Workstation` + Cam FrameRate/Quality.
- Escopo desta rodada = **só spec** (sem mexer no código do io-decoder), a pedido do Pedro.

## Pendências
- Automação: implementar o lado PLC dos offsets propostos; decidir `Sync_VKLine`/`Jog_AccelSel`; conflitos de tipo.
- io-decoder (impl. futura): remover `part_uuid`, adicionar PVI/Style; ganhar saídas `DB_*`; tag-client cold groups (Thermal/Alarms/Vision).
- Merge do PR #13; desligar plc-monitor (db4) após dias de tags-diff limpo.
- Escala REAL×DINT de posição; front quer `AntiCollision`/`IRIS_Fault` agregado ou por bit.

## Links
- Specs: `IRIS-03007-AnexoD-Hot-Assembly.md` · `IRIS-03007-Front-DataMap.md` · Contrato §2 (C2) · `IRIS-03007-Jobdata-ODD-GM.md`
- PR: strokmatic/strokmatic-eip#13 · Chat: `spaces/AAQA2MgKg30`
- Relacionado: [[2026-07-14-iris-ws-contract]] · [[2026-07-13-iris-ws]]
