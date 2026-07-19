---
type: Journal
title: line-twin — suporte a AOI (Fases 1–6) publicado em master
description: Interpretador de Add-On Instructions no soft-PLC do sdk-line-twin; a AOI real CiA402_PP_Axis fecha a malha com o drive fim-a-fim (enable handshake + MoveAbs). Fases 1–6 revisadas por subagents independentes e mergeadas/pushadas em master.
tags: [line-twin-aoi, iris-scds, "03007", visionking, aoi, cia402, soft-plc, sdd]
timestamp: 2026-07-14
project: "03007"
product: visionking
language: pt-BR
status: current
---

# line-twin — suporte a AOI (Fases 1–6) publicado

## Feito
- **Fase 4 (AOI) consolidada**: review Opus rigorosa aprovou o `_aoi_call` (alias InOut
  via AST-rewrite, arg0=instância, overlay por-Controller). Endureci o MINOR mais
  valioso — InOut obrigatório omitido agora **falha ruidosa** (antes caía no backing em
  silêncio) — e documentei os outros 3 MINORs. Commit `62fe558`.
- **Fase 6 (reconciliação da planta, Opção X)**: despachei implementador SDD. `drive.py`
  ganhou `apply_rx_from_tags`/`publish_tx_to_tags` que lêem/escrevem os membros RxPDO/TxPDO
  v5.6 **direto do TagDb**, bypassando a janela de 8 B/21 B; honra `ModesOfOperation` + a
  velocidade de perfil (`TargetVelocity/cpm` com clamp em `v_max`, fallback ao máximo se 0).
  O byte-path v5/v5.5 (`write_out`/`read_in`) ficou **byte-idêntico**. Teste de malha
  fechada novo (`tests/regression/test_aoi_closed_loop.py`).
- **Review Fase 6 (Opus, adversarial): APPROVE** — RED reproduzido (trava em State 20 sem a
  ponte) + GREEN traçado (0→5→20→21→22→30, CW 0x06→0x07→0x0F, DriveState 0x21→0x23→0x27),
  MoveAbs a 1 count do alvo, clamp inviolável. Corrigi os 2 MINORs (falha ruidosa em membro
  obrigatório do PDO; docstring do decel). Commit `1a0f625`.
- **Merge `--no-ff` + push**: `feat/aoi-support` (12 commits, Fases 1–6) mergeada em master
  (`5307a89`) e pushada; branch feature também publicada. Suíte 496 passed / 36 deselected /
  1 xfailed (junit autoritativo, 0 failures/0 errors).
- Changelog sdk-line-twin + ledger SDD atualizados.

## Decisões
- **Opção X venceu a Y** (§5.5 da spec): fechar a malha por tag nomeado é mais leve que
  ampliar o `WireLayout` para o RxPDO completo de 22 B; o objetivo é validar comportamento,
  não o wire físico.
- **Falha ruidosa em membro obrigatório**: `ControlWord`/`TargetPosition` (Rx) e
  `StatusWord`/`ActualPosition` (Tx) propagam `KeyError`; o swallow fica só para os membros
  v5.6 genuinamente opcionais que algumas UDTs omitem.
- **Homing (modo 6) fica bloqueado, não faked**: a planta só publica `ModeOfOperationDisplay=1`
  (PP); o homing nativo continua coberto pelo byte/probe-level em `test_jog_homing.py`.

## Pendências
- **Fase 7** (integração v5.6): BLOQUEADA — depende do ladder v5.6 do Thiago.
- **Adendo Willer** (8 achados v5/v5.5) segue DRAFT aguardando revisão do Pedro.
- **Player de trajetória CSV das receitas** (datum −33,1; estações v9 por canal; âncora na
  barreira) discutido mas ainda não despachado — ver [[twin-coordenadas-receitas]].
- Especialista OKF `line-twin-aoi` fora do roster — usar dupla filiação (iris-scds) até
  aprovação de novo especialista.

## Links
- Spec: `docs/superpowers/specs/2026-07-14-line-twin-aoi-support-design.md`
- Repo: `strokmatic/sdk-line-twin` @ master `5307a89`
- Conhecimento 03007: [[twin-coordenadas-receitas]]
