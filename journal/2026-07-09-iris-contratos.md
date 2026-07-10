---
type: Session Log
title: 2026-07-09 — iris-contratos — contrato v0.97→v0.99.2: fail-safe, jog, revisão de lacunas
description: Sessão de consolidação dos contratos de integração do IRIS 03007 — revisão transversal fail-safe (IRIS_ConveyorOK permissivo), desenho completo de jog (3 níveis + step 1 mm), regra normativa do canal de comando, e revisão de lacunas que fechou bypass, coreografia por receita, rede física, inicialização e carro presente.
tags: [iris, plc, contratos, fail-safe, jog, rockwell, gm, gccs]
timestamp: 2026-07-09
session: iris-contratos
project: "03007"
language: pt-BR
---

# 2026-07-09 — iris-contratos (v0.97 → v0.99.2)

## Feito

- **v0.97 — revisão transversal fail-safe (§0.1)**: todo sinal que gateia ação
  é permissivo ativo-alto; `IRIS_StopRequest` → **`IRIS_ConveyorOK`** (FLL⇒0 no
  lado GM = IRIS morto para o conveyor com carro na zona); tabela de auditoria
  de perda por elo (8 elos); Live List habilitada (offsets entrada +4 B); V10
  (clear-on-loss do ABC3107).
- **v0.98 — jog**: `WSCfg_JogSpeed[3]` {50,150,300} mm/s editável + clamp por
  eixo; contínuo em **PV** com deadman × `WSCmd_JogStep` one-shot 1 mm em PP
  relativo (exato e imune à latência); discriminação clique×segurar no frontend.
- **v0.99 — canal de comando normativo (Fase A)**: Redis Stream + thread/conexão
  CIP dedicada + descarte por idade 300 ms + stop prioritário + mediana ≤150 ms
  / p95 ≤300 ms + eco `IF_Axis.LastCmdSeq`; §2.4 transporte Fase A→B.
- **v0.99.1/.2 — revisão de lacunas** (pedido "veja o que está faltando"):
  spares nos UDTs C1 (produced/consumed congela tamanho); **modo bypass**
  (regra 8: comandado ou por Style sem receita — GM não percebe, alerta ativo);
  coreografia por receita **`Moves[8]` {Axis, TriggerCarPos, Target, Speed}**
  (N=10 styles); §0.2 rede física (dual-IP: A1=GM, A2=interna); self-test do
  INIC definido; regra 2-b (read-back das `WSCfg_` no cold path — CRC explicado
  ao Pedro, read-back escolhido); **inicialização** (DO fault/program=OFF,
  first-scan, `Mode=DESLIG`, `T_clear`=5 s, boot nunca movimenta —
  `ConveyorOK` só com eixos fora do vão); **carro presente** (regra 1-d:
  `CarPresent`, `InhibitCode=7`, jog invasivo lento+alerta+confirmação, homing
  liberado, automáticas invasivas bloqueadas); `IF_Sys.AppVersion`; config do
  ABC3107 versionada em `plc/`.
- **Formatação HTML**: pseudo-listas `1-b.`/`5-a.` fundiam em parágrafo único →
  regras reescritas como bullets rotulados; listas coladas em parágrafo sem
  linha em branco (3 ocorrências) corrigidas; validado por contagem de `<li>`.
- **PDFs** exportados para `reports/pdf/` (contratos + arquitetura).

## Decisões (Pedro)

- Sem `CycleCounter`: com ciclo ~1 min/carro, o reuso de slot entre polls não é
  cenário real (corrida que propus estava supercalibrada — ponto retirado).
- Bypass em vez de "bloquear carro sem receita"; capacidade fixada em 10 styles.
- Boot **nunca** movimenta eixos (sem exceção de auto-abertura): queda com
  cortinas fechadas ⇒ linha parada até operador abrir via MANUAL/homing.

## Pendências

- V1–V10 do contrato (GM: estação/RPI/bits de segurança/escopo do ConveyorOK;
  bancada 24 V: P2 ampliada 0x6060/0x60FF/0x6081/0x6077 + V10; anexos A–D).
- Sequence doc rev05 (LineRunning, sem LongPosition, PDB fora da fusão) +
  refresh do pacote Willer.
- **Commit em lote aguardando revisão do Pedro**: 2 specs + 2 HTMLs + 2 PDFs +
  mmd/png da lógica L5X + tags.json draft + journals (eip-stack, este).

## Links

- Specs: `03007/specs/IRIS-03007-Contratos-Integracao.md` (v0.99.2-draft) ·
  `IRIS-03007-PLC-Arquitetura-Programa-Final.md`
- Render: `03007/reports/html/` e `reports/pdf/` (contratos + arquitetura)
- Journal irmão: [[2026-07-09-eip-stack]] (latência + stack EIP) ·
  [[2026-07-09-automacao]] (bancada USB)
- Memória: `project_03007_servo_gateway_integration.md`
