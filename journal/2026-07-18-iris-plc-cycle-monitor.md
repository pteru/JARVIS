---
type: Journal
title: "IRIS 03007 — monitoramento do ciclo automático no PLC real: v3.2 sign-fix + params do §4 GRAVADOS no snapshot (9) (3 sintomas, 1 causa — resolvido)"
description: Monitoramento do ciclo automático no PLC real (pylogix → 192.168.0.20, cycle_monitor.py ~275 Hz). A rotina R021 v3.2 (sign-fix) foi aplicada nos 4 eixos × 2 caminhos (rastreio + inter-ciclo) e os 4 parâmetros ótimos do §4 foram GRAVADOS no snapshot Iris_Strokmatic_120726_3 (9) (18/07 15:44): AutoKp_ps 0.5→1.0, AutoDeadband_mm 2.5→1.0, AutoErrFiltA 0.10→0.0253, AutoVelSlewMax 8.0→0.832. Isso resolveu os três sintomas de uma mesma causa raiz (following-error sustentado ~85 mm, parada por anticolisão na transição de ciclo, e "caída" das cargas verticais E1/E2). Validado ao vivo hoje: a movimentação rodou limpa, incluindo as transições entre ciclos.
tags: [iris-plc-cycle-monitor, iris-plc-rewire, iris-scds, "03007", plc, automacao, servo]
timestamp: 2026-07-18
project: "03007"
product: visionking
language: pt-BR
status: current
---

# IRIS 03007 — ciclo automático no PLC real: v3.2 ok, params do §4 faltando

## Feito
- **Atualização 18/07 (tarde):** os 4 params do §4 foram **gravados no snapshot `Iris_Strokmatic_120726_3 (9)`**
  (18/07 15:44) + **R021 v3.2 sign-fix** aplicado nos 4 eixos × 2 caminhos → **movimentação validada ao vivo**
  (rodou limpo, transições entre ciclos OK). Detalhe nas Pendências (item resolvido).
- **Sampler novo `cycle_monitor.py`** (SO-LEITURA, pylogix → `192.168.0.20`, ~275 Hz, PYTHONPATH do
  pylogix vendorizado). Amostra por eixo pos/SyncVel/following-error + linha + Alarm/Fault + Sys_Mode
  + AxisOK + `IF_Sensors.AntiCollision1..4`. CSV + PNG (3 painéis × 4 eixos). Reutilizável.
- **Confirmado: a rotina R021 v3.2 (sign-fix) está importada, MAS os params do §4 NÃO foram gravados** —
  o PLC roda os embutidos do v8: `AutoKp_ps=0.5`, `AutoDeadband_mm=2.5`, `AutoErrFiltA=0.10`,
  `AutoVelSlewMax=8.0`. (Corrigi minha hipótese anterior: NÃO é o bug de sinal.)
- **10 min / 9 passagens limpas** (anticolisão forçada a 0). A movimentação **acompanhou** o alvo.
- **Registradores dos drives (Motion Studio):** `Pr0.14=10` (trip 20 mm) e `Pr5.13=2250` persistiram;
  **`Pr7.11=7000`** (cap de 600 mm/s) **NÃO persistiu** — ignorado por ora (por decisão do Pedro).
  Lição: writes por USB eram RAM; power-cycle zerou. Nota de "como achar os Pr no Motion Studio" (visão
  All/Expert, busca por nome, ou Object Dictionary/CoE `0x2000+classe·0x100+índice`).

## Decisões / achados (3 sintomas, 1 causa = params não-afinados)
1. **Arrasto ~85 mm (p99) sustentado** — e é **Kp baixo, NÃO saturação**: quando `|err|>50`, o SyncVel tem
   **folga** (méd 440 < cap 600; 0% no cap no E1). Kp=0.5 não catcha. Conta: catch-up=`Kp·(|err|−db)` →
   v8=54 mm/s vs ótimo=109 mm/s a 110 mm de erro.
2. **Anticolisão parou o ciclo** na transição pro 2º ciclo (E1 travou em 32 mm). É **drive-direct** —
   `Alarm_ActiveWord`/`IRIS_FaultCode` ficaram **0**; `IF_Sensors.AntiCollision` limpou. (⇒ o PLC não a
   vê; relevante pro mapa dos 55 alarmes: é dos que "não vêm do PLC".) Provável causa: eixos 100 mm fora
   de posição → rota de colisão.
3. **"Caída" das cargas verticais E1/E2 na descida** (E1 53 eventos, E2 101 em 10 min): o eixo penda
   (atrasado acima do alvo), **despenca a ~0,6-0,9 g** (vel real −893 mm/s vs comando 507), passa do alvo
   e o servo recupera. **Não é o freio mecânico** — é a regulação frouxa (Kp fraco) + `AutoVelSlewMax=8.0`
   abrupto (não-suave). Zoom em `scratchpad/queda_E1_zoom.png`.
- **Fix único (APLICADO no snapshot (9), validado ao vivo):** gravar `AutoKp_ps=1.0`, `AutoDeadband_mm=1.0`,
  `AutoErrFiltA=0.0253`, `AutoVelSlewMax=0.832` → segura a descida (mata a caída), corta o arrasto (era ~85 mm),
  suaviza, e a anticolisão nem precisa ficar forçada. **Uma correção, três sintomas.**

## Pendências
- ✅ **RESOLVIDO — Gravar os 4 params do §4:** gravados no snapshot `Iris_Strokmatic_120726_3 (9)` (18/07 15:44)
  — `AutoKp_ps=1.0`, `AutoDeadband_mm=1.0`, `AutoErrFiltA=0.0253`, `AutoVelSlewMax=0.832` — junto do **R021 v3.2
  sign-fix** (ramo negativo do deadband devolve a magnitude, `-AutoErrF - deadband`) nos 4 eixos × 2 caminhos
  (rastreio + inter-ciclo). **Validado ao vivo hoje:** movimentação rodou limpa, **incluindo as transições entre
  ciclos** (min-jerk `InterCycleGo` + re-arme ARME-DESLIG já estavam no (8); faltava só o ganho/sinal certos).
  Validação qualitativa (rodou limpo, transições OK); sem re-captura numérica de arrasto pós-fix por ora.
- **Persistir `Pr7.11=1800`** (cap) em EEPROM no Motion Studio (item que faltou do set de segurança).
- Anticolisão drive-direct → alinhar no mapa dos 55 alarmes que não é PLC.
- Melhoria: suavização de movimento (o Pedro citou) — coberta pelo `AutoVelSlewMax=0.832`.

## Links
- Sampler/CSV/PNG: `scratchpad/cycle_monitor.py` · `cyc_*.csv/png` · `queda_E1_zoom.png`
- Deploy (2 trilhas): `plc/2026.07.18_handoff-thiago-v8-update/` (README §4 params, "Deploy no PLC")
- Registradores: `plc/2026.07.18_ajustes-registradores-drive-el8ec.md`
- Journals irmãos: [[2026-07-18-iris-ecat-bench]] · [[2026-07-18-iris-plc-rewire]]
