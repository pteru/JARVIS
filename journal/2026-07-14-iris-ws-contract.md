---
type: journal
title: "IRIS 03007 — reconciliação Screen-Binding × contrato C2 (base p/ EDS + io-decoder da eip-stack)"
description: "Cruzou a planilha de binding das telas com o contrato PLC↔WS (C2) e o mock Redis db4; extraiu o subconjunto hot-path que entra no EDS/io-decoder da eip-stack que substitui o plc-monitor. O hash Tags do db4 já é protótipo do io-decoder (modelo do contrato)."
tags: ["iris-ws-contract", "iris-scds", "03007", "eip-stack", "io-decoder", "eds", "plc-ws", "redis"]
timestamp: 2026-07-14
project: "03007"
product: IRIS
language: pt-BR
status: active
---

# IRIS 03007 — reconciliação Screen-Binding × contrato C2

## Feito

- Comparei `IRIS_03007_Screen_Data_Binding.xlsx` (SSOT das telas, time Front; 247 linhas, guiou a conexão Redis WS↔back/front) com o contrato **C2** (`specs/IRIS-03007-Contratos-Integracao.md` §2, interface tags congeladas) e com o **mock Redis `192.168.0.189:4000` db4**.
- **Descoberta central (db4):** há **duas camadas** já prototipadas — `DB_*` (10 hashes, nomes flat por tela = a planilha, consumo do Front) e **`Tags` (86 campos) = protótipo do io-decoder**, com o modelo do CONTRATO: `Axis_E1/E2/E4R/E4L_*` (Pos_B0..B3, InhibitCode, LastCmdSeq, EncBattOK, Brake, RefValid), `Track_0/1_*` (Active/Bypassed/LongPos), `Sys_Mode_B0/B1`, `Sys_BypassActive/SelfTestOK`, `part_uuid/part_style`. Cobre só o **core hot** (Sys + 4 eixos + Track[2] + part id ≈ 70 B, dentro dos 128 B/sentido) → **é o ponto de partida do EDS**.
- **Extração para o contrato:** 62 HOT (Classe 1 → EDS/io-decoder) · 91 COLD (pylogix Fase A permanece) · 20 reclassificar → WS backend · 41 Other Source. 14 tags novas a decidir · 7 conflitos de tipo.
- Deliverables: doc `pmo/projects/03007/handoffs/2026.07.14_reconciliacao-binding-c2.md`; Google Sheet no Drive do 03007 (abas originais + nova aba "Revisão C2" com Lane/Status/IF-map/Mock/Ação, cores por lane): https://docs.google.com/spreadsheets/d/1HauBP08VnQL3-lEkPumGwywHo7HyS-rcIeOCMXWATyI/edit

## Decisões / achados

- `Tags` **inclui campos que faltam na planilha** (InhibitCode/LastCmdSeq/EncBattOK/Track[2]/BypassActive) → mantê-los no io-decoder mesmo o Front não os consumir.
- `DB_Workstation` (CPU/GPU/serviços/storage) e `Cam*_FrameRate/Quality` estão no mock `DB_*` mas **não** no `Tags` → confirmam que **não vêm do PLC**; a planilha as marcou PLC por engano (contrato já dizia "fora do PLC"). ~20 tags → Fonte=Other Source.
- **Bloqueador do EDS:** `WS_PVI`/`WS_Style` são STRING na planilha (mock `WS_Style`="Rhino") mas o contrato/`Tags` usam id numérico (`part_uuid/part_style`). Precisa virar id numérico no wire; texto é responsabilidade da WS.
- Cold path (alarmes A01-55, térmica 6 zonas, painel elétrico, sensores) segue no pylogix (Fase A) — não entra no EDS.

## Pendências (retomar em sessão dedicada — estruturar EDS + io-decoder)

1. Congelar o **Anexo D** do contrato = layout do assembly hot = `Tags` (§0 do doc) + comandos WS→PLC (jog/step/home/homeall + heartbeat, §1b) → gerar **EDS** e **io-decoder** da eip-stack nova (substitui o plc-monitor).
2. Automação decide as 14 novas (painel elétrico → nova `IF_Electrical` cold; `PVI_Handshake/LineSpeed_State/Sync_VKLine` → hot; `Jog_Accel` → estender `WSCmd_Jog[]` com `AccelSel`) + os 7 conflitos de tipo (PVI/Style numérico primeiro).
3. Front/Software reclassifica as 20 de WS-health/vision → Other Source.
4. Subsistemas do contrato ausentes na planilha a reconciliar: receitas (`WSRcp_*`/`RecipeStatus`), escritas de config (`WSCfg_ZoneSP` etc.), `IF_Station[11]` (quem correlaciona estação↔resultado), `IF_Track[2].Phase`.

## Links

- Doc: `pmo/projects/03007/handoffs/2026.07.14_reconciliacao-binding-c2.md` · Sheet revisado (Drive 03007) · mock: KeyDB `192.168.0.189:4000` db4 (`Tags` + `DB_*`)
- Contrato: `specs/IRIS-03007-Contratos-Integracao.md` §2 (C2) · io-decoder alvo: eip-stack (substitui plc-monitor) · relacionado: [[2026-07-13-iris-plc]] (snapshot PDO remapeado)
