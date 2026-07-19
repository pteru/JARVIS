---
type: Journal
title: "IRIS 03007 — bancada EtherCAT direto: validação da lei R021 v3.2 no Servo3 (E4R) + plano engate 3 eixos"
description: Resultados da bancada com master EtherCAT direto (pysoem) no Servo3 rodando a lei de controle R021 v3.2 sobre receitas reais (track T8 do ecat-sync-lab). Sweep de Kp validou o sign-fix (descendente 10→5.5mm vs v3.1 explodindo 10→151mm no PLC), sem vibração até Kp=2; fidelidade na taxa real do gateway (RPI 10ms) dá ~7.4mm RMS com Kp=1; re-engate multi-ciclo limpo. Plano e comandos para o engate dos 3 eixos (E1/E2/E4R) e estado resumível.
tags: [iris-ecat-bench, iris-plc-rewire, iris-scds, "03007", plc, automacao, servo, ethercat]
timestamp: 2026-07-18
project: "03007"
product: visionking
language: pt-BR
status: current
---

# IRIS 03007 — bancada EtherCAT direto: lei R021 v3.2 no Servo3

## Setup
- Servo3 (E4R) isolado P2P na NIC **enp0s31f6** (Intel I219-V) + master direto **pysoem** (`ecat-sync-lab`, track **T8**). USB el8ec também conectado (tuning/caps).
- T0 scan OK: L8EC vivo, `0x6502=0x03AD` (CSP/PP), `0x1C32:4=0x0005` (DC SYNC0 suportado — o direto destrava DC, o gateway não). PDO default 22B/21B.
- ⚠️ **Caps re-aplicados** (power-cycle zera RAM): Pr7.11=1800/Pr3.24=1800/Pr5.13=2250 = 600 mm/s. Originais 7000/0/0 em `scratchpad/drive_caps_servo3.orig`.
- Guard soft-limits bancada [3,1057], janela útil [11,1049]. Parada = Halt (bit8).

## Metodologia
`T8_recipe_r021.py`: lei R021 v3.2 (`err→IIR→deadband MAGNITUDE→velCmd=|FF|+Kp·errMag→clamp→slew`) em PP+bit5 streaming, Profile Velocity computado por ciclo. Mede pos/vel (0x6064/0x606C) por ciclo; `benchmark.py recipe` → métricas (RMS, asc/desc, drag, pico acel) + PNG + equivalentes por-scan 208µs. Params em unidades invariantes no tempo (Kp 1/s, deadband mm, tau ms, slew mm/s²).

## Resultados E4R (tracker, v_linha 116.7 mm/s)
**Sweep de Kp @ 2 ms (ciclo bancada):**

| métrica | Kp=0 | 0.5 | 1 | 2 |
|---|---|---|---|---|
| RMS erro (mm) | 6.87 | 5.37 | 4.97 | 4.74 |
| RMS **desc** (mm) | 10.16 | 5.46 | 4.80 | 4.63 |
| RMS asc (mm) | 24.25 | 21.52 | 20.24 | 19.33 |
| max_err (mm) | 39.17 | 34.35 | 34.16 | 34.31 |
| pico\|acc\| (mm/s²) | 4812 | 4305 | 2785 | 2659 |
| pico SyncVel (mm/s) | 525 | 540 | 555 | 584 |

- **Sign-fix v3.2 VALIDADO no ferro**: descendente 10.16→5.46 mm no Kp=0.5 (o v3.1 bugado explodia 10→151 mm no PLC). Catch-up `Kp·|erro|` puxa nos dois sentidos.
- **Sem vibração**: pico\|acc\| CAI com o Kp (4812→2659) — Kp=2 liso onde o PLC vibrava. Deadband+IIR+slew mataram o buzz.
- Descendente convergido (~4.6mm, piso do deadband=2). Ascendente teimoso (transiente de subida ~530 mm/s, limitado por laço do drive, não por Kp/slew).

## Fidelidade à taxa real do PLC (a pergunta-chave do Pedro)
- **Gargalo NÃO é o scan** (PLC roda AOI a 208µs, mais fino que os 2ms). É a **entrega ao drive**: comando passa pelo gateway **ABC3107** cujo RPI (módulo `AnyBusComm` no L5X) = **10 ms**. Drive vê alvo novo a cada 10ms, não 2ms. (PRV10IRIS5 da WS = 20ms.)
- `--cycle-ms 10` (emula taxa real): Kp=1 → RMS **7.42** (vs 4.97 @2ms; ~2.5mm de staleness a 530mm/s). Kp=2 → RMS 7.28 (igual), **encosta no cap 600** sem ganho. **0 overruns nos dois** — sem oscilação: a margem de vibração aguenta no loop lento.
- **Número honesto pro PLC: ~7-8 mm RMS com Kp=1, estável, sem vibração, sign-fix valendo** (desc 8.7 << asc 29). Ponto de operação = **Kp=1** (Kp=2 satura o cap sem ganho).

## Multi-ciclo / re-engate (E4R --cycles 2, Kp=1, 2ms)
58524 ciclos, 14 overruns, completou. **Sem runaway/congelamento na costura**: |vel| máx 534 (nunca o cap), |following-error| máx **4.6 mm**. Reset errF/SyncVel no re-engate funciona. (Engate do E4R é trivial: começa=termina em 114.)

## Params transferíveis pro PLC (equivalentes por-scan 208µs, ponto de operação)
`AutoKp_ps=1.0` · `AutoDeadband_mm=2.0` · `AutoErrFiltA_scan≈0.0253` (tau=8ms) · `AutoVelSlewMax≈0.832 mm/s por scan` (slew=4000 mm/s²) · vmin=5 vmax=600.

## Plano — engate dos 3 eixos (opção (a): por-eixo no hardware)
Escala e início (RecipeTraj, tracker, servo3 em [11,1049]):

| eixo | escala | início | range | fim | jog p/ início (de 114) |
|---|---|---|---|---|---|
| E1 | a=0.862 b=+5.8 | **1049** | [11,1049] | 11 | +934 mm (+391890600 p) |
| E2 | a=1.000 b=−51 | **1049** | [426,1049] | 426 | +934 mm |
| E4R | a=1.000 b=−0.4 | 114 | [114,1048] | 114 | −0.6 mm (já lá) |

- E1/E2 têm **retorno inter-cycle REAL** (E1 11→1049=1038mm; E2 426→1049) — o engate que vale (E4R é trivial).
- **Pré-posicionar** o servo3 no início (1049) antes de rodar E1/E2, via `el8ec-ecat jog` (relativo, `--delta` em pulsos, `--profile-vel`). Depois `T8 --axis e1 --cycles 2 --kp 1`.
- ⚠️ `el8ec-ecat` e `ecat-sync-lab` compartilham a NIC — rodar UM master por vez (jog, depois T8).

## Pendências / estado resumível
1. **Pré-posicionar servo3 em 1049** (jog +934mm, vel segura ~100mm/s) → **E1 --cycles 2 Kp=1** (engate real) → depois **E2**.
2. **--deliver-every** (subagent em curso): emulação FIEL (calcula 2ms, entrega a cada 5 = 10ms) — rodar depois no melhor setup (Kp=1) pra cravar o número final.
3. Ao encerrar bancada: `drive_caps.sh restore servo3`; Halt→Shutdown→INIT→close; power-cycle; religar gateway.
4. Mapa dos 55 alarmes (DRAFT) pronto em `reports/md/2026-07-18-alarmes-55-mapa-viabilidade-contratos.md` — para alinhar William/Arthur.

## Links
- Track/plano: `sdk-servo-toolkit/ecat-sync-lab/` · `plc/2026.07.16_sync-ecat-tests/PLANO-recipe-r021-bancada.md`
- Fix PLC correspondente: `plc/2026.07.18_patch-r021-v32-signfix/` (R021 v3.2 sign-fix)
- Journal irmão: [[2026-07-18-iris-plc-rewire]]
