---
type: journal
title: "IRIS 03007 — bancada Servo3: PP+FDCs+homing validados ao vivo e AOI CiA402 com 4 modos entregue"
description: "Sessão de bancada no EL8-EC (Servo3, EtherCAT direto): calibração mm confirmada, envelope PP até 630 mm/s, os dois FDCs mapeados (fix DI-COM/lógica), homing nativo método 17 padronizado; construídos 5 comandos no tool e a AOI CiA402_PP_Axis (PP+Jog+Homing+Sync) com pacote de handoff p/ o Thiago."
tags: ["servo-bench", "iris-scds", "automacao", "03007", "el8-ec", "ethercat", "cia402", "homing", "aoi", "l5x", "pp"]
timestamp: 2026-07-14
project: "03007"
product: IRIS
language: pt-BR
status: active
---

# IRIS 03007 — bancada Servo3 + AOI CiA402

## Feito
- **Bring-up EtherCAT corrigido**: pré-OP com WKC válido antes de pedir OP (passa a atuar como o Anybus) + **Fault Reset bit7** que limpa o Er 818 latcheado (era o "freio" fantasma). Padrão de escrita pysoem `slave.output = bytes(outbuf)` a cada ciclo.
- **PP validado ao vivo** no Servo3 (EtherCAT direto, `enp0s31f6` onboard): jogs de 10k counts → 400 mm, envelope de velocidade **lento → 630 mm/s (produção)**, parada sempre **micrométrica** (overshoot ~µm), nos dois sentidos.
- **Calibração mm confirmada no físico**: `419.430,4 counts/mm` (encoder 8.388.608/volta ÷ lead 20 mm SHELE GTH15-P20, direto, gear 1:1). Convenção: **delta+ afasta o carro do motor**.
- **Os dois FDCs mapeados**: NOT/DI3 (0x60FD bit0, lado negativo), POT/DI2 (bit1, positivo ~+962 mm), curso útil ~1000 mm. Gotcha resolvido: sensores **NPN → DI-COM +24 V** e **lógica invertida na fiação** (a leitura via SDO em PREOP vinha stale → criado `di-monitor` ao vivo em OP).
- **Homing nativo CiA402 (modo 6) validado**: método 1 dava offset de ~20 mm (fase index = 1 passo do fuso) → **padronizado o método 17** (zera na borda do NOT = no sensor). Home confirmado no físico.
- **Ferramentas** no `sdk-servo-toolkit/el8ec-ecat`: `jog`, `home`, `di-monitor`, `sync-test` + os já existentes (scan/od-dump/pdo-dump/sdo). 157 testes.
- **AOI `CiA402_PP_Axis` (L5X v38)** com **4 modos**: PP (MoveAbs/JogRel), Jog (tap→passo/hold→contínuo + deadman), Homing (método 17), Sync (seguimento por PP re-target imediato). Pacote de handoff p/ o Thiago consolidado (README único, 2 UDTs standalone, example 4 eixos, desk-test).

## Decisões
- **Método 17 é o padrão de homing** deste eixo (zero no switch, sem os 20 mm do index).
- **Ciclo automático = split**: mecanismo (modo Sync) no AOI; **política (trajetória/cam + correção de velocidade por timing das barreiras) no ladder**. Restrição dura: **sem CSP pelo Anybus (sem DC)** → seguimento por PP; tolerância folgada torna isso adequado.
- **Código sempre via subagent**; execução ao vivo comigo.

## Pendências
- **Teste `sync-test` no bench** (senoide) — área ocupada, ficou pendente.
- **Import no Studio 5000 v38** do pacote AOI (não há compile headless; itens de schema listados no README).
- **Ladder do ciclo automático**: integrar LongPos da velocidade GM + correção por barreiras (até 3×/ciclo, entrada/saída, subida/descida) + cam por receita → alimenta o modo Sync. Confirmar datum/re-sync (CarEntering) e a 3ª correção.
- **Commit** das ferramentas (el8ec-ecat) e do pacote AOI (tudo uncommitted).
- Verificar datatype real da receita (interpretado contínuo-linear Scale/Offset).

## Links
- Memória: [[reference-03007-servo-axis-calibration]] (calibração + mapa dos limites + homing 17) · [[feedback-code-via-subagent]]
- Pacote AOI: `pmo/projects/03007/plc/2026.07.14_cia402-pp-aoi/` · Tool: `sdk/sdk-servo-toolkit/el8ec-ecat/`
- Snapshot Thiago: `pmo/projects/03007/plc/2026.07.14_programa-plc-thiago/` · relacionado: [[2026-07-13-iris-plc]]
