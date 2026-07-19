---
type: Journal
title: "IRIS 03007 — fix de segurança do seguimento: AOI 1.9 + R021 v3.1 (raiz única dos 4 sintomas)"
description: Geração e revisão do pacote AOI19-R021-SYNC — a raiz única dos 4 sintomas de movimento (runaway, congelamento, rastejo, lag) resolvida por bumpless+slew+re-engate por nível na AOI 1.9 e lei de controle P+deadband+suavização no R021 v3.1. Medição ao vivo do scan real da MainTask (208 µs) validando SyncSlewMax=0.15. ORDEM-IMPORT consolidado atualizado e handoff zip.
tags: [iris-plc-rewire, iris-scds, "03007", plc, automacao]
timestamp: 2026-07-18
project: "03007"
product: visionking
language: pt-BR
status: current
---

# IRIS 03007 — fix de segurança do seguimento (AOI 1.9 + R021 v3.1)

## Feito
- **Subagent gerou o pacote `2026.07.18_patch-aoi19-r021-sync`** (2 L5X + 2 src +
  CSV + 2 docs-diff + MANIFEST + LEIA + zip). Verificações: src≡L5X (AOI 1221 / R021
  847 linhas, 0 diffs), XML válido, 0 mnemônicos proibidos, CSV CRLF, envelope
  `Use="Target"` preservado, RevisionNote sem `<`/`>`.
- **Revisei o código real linha a linha** (não só o relatório): AOI 1.9 — re-engate
  por nível (linha 451, dentro do `CASE 30`), bumpless no 90 (`SyncSlewTgt:=CurPos`),
  slew nos 90/91 com clamp de soft-limit a partir do valor rampado, `ControlWord
  16#003F`/`TargetVelocity`/`Accel` intactos, parâmetro `SyncSlewMax_mm` Input
  Required=false **DefaultData 0.15** (herança nas 4 instâncias). R021 v3.1 — lei nos
  8 blocos (4 eixos × rastreio+inter-cycle), reset do filtro E do `SyncVel:=FF` no
  engate, deadband suave (ELSE→0), teto `AutoVelRun` (rastreio) vs 600 (inter-cycle),
  `S:FS` zera os 4 filtros, FREEZE do v3 e latches `AutoEng/ICEng` intactos.
- **Medi o scan real da MainTask ao vivo (só-leitura)**: 5 contadores por-scan
  (`Servo1..4.Heartbeat`, `InitHeartbeat`) concordam em **4810 scans/s ≈ 208 µs**.
  Cross-check: `Trk_DtUs=458` mid-acumulação ≈ 2 scans. Valida o `SyncSlewMax_mm=0.15`
  do subagent (0.15÷208µs = 721 mm/s, 20% de folga sobre 600 → transparente, sem lag).
- **`ORDEM-IMPORT-CONSOLIDADA.md` atualizado** (rev 18/07 v2): tabela final com AOI 1.9
  + R021 v3.1, dependência R021 v3.1 ⇐ R020 v3, 7 tags novas + defaults, scan=208 µs,
  aceite em 2 fases. **Handoff zip** montado (ORDEM + pacote).

## Decisões
- **Lei "P + deadband + suavização" (não só ligar o Kp).** Pedro relatou que Kp=2-3
  gerava movimento entrecortado/vibração. Raiz: o loop de correção fecha pelo gateway
  **ABC3107 (PP-only, sem DC = setpoint lento)** → P alto em latência alta oscila;
  + amplificação de ruído do encoder no `Kp·erro`; + churn do perfil PP a cada scan.
  Fix por camadas: FF manda, IIR do erro, deadband suave, trim P baixo, slew do `SyncVel`.
- **AOI 1.9 = bumpless + slew + re-engate por nível.** O slew do `TargetPosition` mata
  o runaway na origem e **torna o Kp seguro**; re-engate por nível recupera sync perdido.
- **bit4 (New-Set-point) mantido** na cadência 2-scan: o EL8-EC **ignora bit5**
  (change-immediately), então continuous-update quebraria o PP. O slew já tama o churn.
- **AutoKp: Fase 1 = 0 · Fase 2 = 0.5.** Resíduo ≤ `AutoDeadband_mm` aceito; integral só
  em v3.2 se a bancada mostrar que os poucos mm importam.

## Pendências
- **Import pelo Thiago** (AOI 1.9 + R021 v3.1 + R020 v3 + ARME-DESLIG + CSVs) + selagem.
- **Bancada 2 fases** (Kp=0 valida slew/re-engate; Kp=0.5 valida deadband/suavização).
- **RcpSlot=0 / S1-skip** (R022 não roda → câmeras leem `RcpAuto[0]` vazio).
- **Restaurar caps dos drives** (`drive_caps.sh restore` nos 4) + **FIR servo3** (Pr2.23=0)
  antes de operação normal.
- Redesenho do inter-cycle como woven-into-next-cycle (sem gap temporal). Reproduzir
  runaway pelo caminho stop/re-arm (não apareceu na sequência contínua).

## Links
- Pacote: `plc/2026.07.18_patch-aoi19-r021-sync/IRIS-03007-AOI19-SYNC/`
- Ordem: `plc/2026.07.17_ORDEM-IMPORT-CONSOLIDADA.md` (rev 18/07 v2)
- docs-diff: `docs-diff-AOI19-slew-reengate.md`, `docs-diff-R021-kp-intercycle.md`
- Spec base do ciclo: `specs/2026-07-17-r020v3-ciclo-redesign.md`
- Journal anterior: [[2026-07-17-iris-plc-rewire]]
