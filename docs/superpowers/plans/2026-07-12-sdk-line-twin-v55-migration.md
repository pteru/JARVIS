---
type: Implementation Plan
title: sdk-line-twin — Migração do perfil IRIS para o programa v5.5 (UDT_ServoAxis, mm, R004/R011/R021/R052)
description: Plano de migração do twin para o pacote v5.5 do PLC IRIS — novo perfil profiles/iris-03007-v55 (perfil v5 congelado como base de regressão dos achados), remoção dos load patches obsoletos, rename da família de tags flat→ServoAxisN.*, tags novas + _Scans recalculados p/ dt=50ms, scan_routines estendido, re-execução dos cenários/achados e port dos cenários novos do v5.5.
tags: [line-twin, iris-scds, 03007, l5x, v55, migracao]
timestamp: 2026-07-12
project: "03007"
product: visionking
language: pt-BR
status: draft
---

# sdk-line-twin — Migração v5.5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O twin carrega e valida o programa **v5.5** (handoff `pmo/03007/handoffs/2026.07.12_update-jog-homing-v5.5/`) num perfil novo `profiles/iris-03007-v55/`, com o perfil v5 atual congelado como base de regressão dos achados do adendo Willer. Suite verde nos DOIS perfis.

**Ground truth:** análise de impacto em `scratchpad/v55-impact-analysis.md` (sessão 2026-07-12; conclusões-chave replicadas nas tasks abaixo). Interpretador NÃO muda (zero gaps RLL/ST; FBD já skippable). Contrato WSCmd_* intacto. Golden rig/relay/compose HIL intactos.

**Decisões já tomadas:**
- Perfil NOVO (copy-then-edit), não in-place; promoção a `iris-03007` só depois de validado.
- `dt_ms=50` permanece (escolha de simulação); TODO `_Scans` derivado de 50 ms, NUNCA copiado do README v5.5 (que assume task de 8 ms).
- `jsr_appends`/`routine_overrides`/`rung_edits` NÃO são portados — o MainProgram v5.5 é autocontido (17 JSRs nativos); manter os patches duplicaria execução ou hard-failaria o load (rung_edits com count exato contra rotina renomeada).

## Global Constraints

- Branch `feat/v55-profile`; commits convencionais + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; **nunca `rm`**; falha ruidosa; perfil ≠ engine.
- Perfil `iris-03007` (v5) é INTOCÁVEL nesta migração (só leitura); todos os testes existentes continuam passando contra ele.
- Testes novos do v55 ficam em `tests/v55/` (ou parametrizados por perfil onde natural), rodando no CI por default.
- SSOT dos L5X é o pmo; copiar para o perfil e registrar em PROVENANCE.md.

### Task 1: scaffold do perfil v55 + load mínimo
- [ ] Branch `feat/v55-profile`. Criar `profiles/iris-03007-v55/` copiando a estrutura do `iris-03007` (cp -r; nunca rm).
- [ ] Substituir `l5x/`: copiar do handoff v5.5 `MainProgram_Program.L5X`, `Servo_Program.L5X`, `new-controller-tags.CSV`, `udts/*.L5X` (12 UDTs do import order do README). Apagar do NOVO perfil (git rm apenas via `git mv` p/ attic/ ou deixar de copiar) os standalone obsoletos (R030/R031/R003 routines separadas — embedded agora).
- [ ] `profile.json` novo: remover `jsr_appends`, `routine_overrides`, `rung_edits`; manter `fbd_excluded` (mesmos 7 nomes — verificar por grep no export v5.5), `modules` inalterado; `udt_overrides` += `UDT_GM_Com_Out`; re-diffar `UDT_GM_Com_In`/`UDT_WS_Com`/`UDT_StationJob` contra os `udts/` do v5.5 e decidir manter/remover overrides (documentar).
- [ ] Tags novas do CSV v5.5 (`Alarm_ActiveWord`, `AlmNow`, `Bypass_Active`, `InitClear_Cnt/_Scans`, `InitHomingReq`, `IRIS_FaultCode`, `IRISHb_Cnt/_Scans`, `JogReq1..4`, …) via loader CSV do perfil.
- [ ] `_Scans` p/ dt=50: `InitClear_Scans=100`, `IRISHb_Scans=10`; `GMHb_TimeoutScans=40` e `GMSim_HeartbeatScans=10` inalterados. `_config_note` atualizado.
- [ ] Teste de aceite: perfil v55 CARREGA no Controller (LoadError vazio) e sobrevive 20 scans sem fault (paralelo ao aceite F0). PROVENANCE.md novo registrando origem v5.5 + patches removidos + item de bancada byte-7-vs-8.
- [ ] Commit.

### Task 2: plant/drive + scan_routines do v55
- [ ] `plant.json`/IoMap do v55: conferir offsets per-member COP do Servo v5.5 (entrada bytes 0,2,4,6,7,11,13,17; saída CW@0, Target@2, TPF@6) contra o DriveModel (janela padded antiga NÃO se aplica mais — o drive precisa expor o layout que os novos COPs leem; ajustar IoMap/plant.json do v55 SEM tocar no drive engine se possível; se o engine tiver hardcode da janela v5, parametrizar por perfil).
- [ ] `scan_routines` do v55: adicionar `R004_AlarmManager` e `R021_DynamicTracking` na ordem do JSR chain real; decidir e DOCUMENTAR (`_scan_routines_note`) se `R011_Initialize` fica fora (InitHomingReq como free poke, padrão R011_STEP.1) — default: fora.
- [ ] Aceite F1-equivalente no v55: jog real move eixo simulado (WSCmd_Jog1 + JogRefresh → ServoAxis1.AxisIn.ActualPos varia; solta → para); homing v55: com os COPs por membro, o TPF embarca → homing DEVE completar (o xfail-sentinela do v5 vira teste positivo no v55 — provar que o redesenho corrige o achado 1 na emulação).
- [ ] Commit.

### Task 3: rename da tag surface — bridge/cenários/invariantes/painel
- [ ] Grep repo inteiro por `Position[1-4]_mm`, `RefValid[1-4]`, `Ramp[1-4]\.`, `Cfg[1-4]\.`, `Cmd[1-4]\.`, `Servo[1-4]_(In|Out)` e mapear consumidores.
- [ ] `profiles/iris-03007-v55/bridge.json`: axes → `ServoAxisN.AxisIn.ActualPos` / `ServoAxisN.RefValid`; mode → `ServoAxis1.Ramp.JogState/HomeState`; decidir se o grupo axes espelha `WS.Axis1_pos/Axis2_pos/Axis4R_pos/Axis4L_pos` do R052 (design: preferir o que o R052 publica — é a interface oficial WS) — documentar a escolha no próprio bridge.json.
- [ ] `scenarios/*.yaml` do v55 (copiar os 5 do v5 e renomear tags; v5 fica intacto) + `invariants.py`: invariantes que nomeiam tags (boot-never-moves, valid-gate) parametrizados por perfil ou por prefixo — sem quebrar o v5.
- [ ] Painel: `binding.json` do v55 + qualquer referência a tag em `panel/src` (grep) — painel deve funcionar contra o perfil v55 via gateway (mesmos WSCmd_*).
- [ ] Testes: cenários v55 passam; suite inteira verde (v5 + v55).
- [ ] Commit.

### Task 4: achados sob v5.5 + cenários novos do README
- [ ] Regressão dos achados no v55: #1 homing completa (teste positivo, Task 2), #2/#3 não-reproduzíveis por construção (teste de load: tags flat órfãs ausentes; COPs por membro sem spillover — assert byte-fiel), #4 gate do R020 ativo (cenário: carro em MANUAL não latcha jobdata), #5 continua reproduzível (recovery em 1 beat — cenário herdado deve continuar PASSANDO em detectar; é achado do programa, não do twin).
- [ ] Port dos cenários v5.5 (README lista ~19 rodados no emulador do fornecedor): priorizar init E2E (T_clear → homing global → posição aberta → St_MaquinaOK), heartbeat IRIS→GM (IRISHb), ciclo automático E2E com jobdata, GM timeout → first-out code 6, anticolisão first-out code 5, reset com/sem causa, abort com retorno. DSL YAML + invariantes; o que a DSL não expressar → teste pytest direto (não estender a DSL nesta fase sem necessidade).
- [ ] Commit.

### Task 5: fechamento
- [ ] README do repo: seção v5.5 (dois perfis, status dos achados, item de bancada byte-7-vs-8), tabela de fases com nota v55.
- [ ] Merge `feat/v55-profile`→master, push, suite final verde nos dois perfis.
- [ ] JARVIS: changelog, journal (EXTEND do dia), memória do projeto, ledger.

## Self-Review
1. Análise §1: interpretador zero-gap — plano não toca engine exceto possível parametrização da janela do drive (Task 2, explícito). 2. Patches obsoletos removidos, não adaptados (§2 da análise). 3. v5 congelado → adendo Willer mantém base estável. 4. `_Scans` recalculados p/ 50 ms com valores explícitos no plano (não delegado ao README de 8 ms). 5. Cenários novos são a validação de que a migração não é só "carrega": comportamento init/falhas exercitado.
