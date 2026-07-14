---
type: spec
title: "line-twin — suporte a Add-On Instructions (AOI) no interpretador Logix"
description: "Estender o soft-PLC do sdk-line-twin para parsear e executar Add-On Instructions Rockwell, o suficiente para rodar a AOI CiA402_PP_Axis (IRIS 03007) em malha fechada com o modelo de drive, validando comportamento/integração em software antes da bancada física."
tags: ["line-twin", "logix", "l5x", "aoi", "add-on-instruction", "cia402", "servo", "03007", "iris-scds", "st", "fbd-timer", "emulador", "automacao"]
timestamp: 2026-07-14
project: "03007"
product: IRIS
language: pt-BR
status: draft
---

# line-twin — suporte a Add-On Instructions (AOI)

## 1. Contexto e objetivo

O `sdk-line-twin` tem um **soft-PLC** que parseia e executa L5X (subset RLL + ST)
em malha fechada com um **modelo de planta** (drive CiA402 em `sim_core/plant/drive.py`,
linha, I/O). Ele roda headless (modo `sim`, `fakeredis`) e já pegou 8 bugs reais no
ladder IRIS. **Hoje ele NÃO suporta Add-On Instructions** — `parse_l5x` ignora
`<AddOnInstructionDefinition>` por completo.

O objetivo é o **último degrau de validação em software antes da bancada física**:
rodar o programa ladder IRIS (v5.6) **+ a AOI `CiA402_PP_Axis`** dentro do line-twin,
com a AOI comandando o modelo de drive e reagindo ao StatusWord/posição de volta.
Isso valida **comportamento, sequência de estados, intertravamentos e a malha fechada
com a planta** — o nível certo pra pegar bug de lógica/integração sem queimar tempo de
bancada. (O Studio 5000 Logix Emulate está fora da nossa alçada; o CLP físico é o teste
definitivo. Ver [[SYNC-LADDER-NOTES]] e o pacote da AOI em
`pmo/projects/03007/plc/2026.07.14_cia402-pp-aoi/`.)

**Descoberta que reduz o risco:** a AOI `CiA402_PP_Axis` é **100% Structured Text numa
única rotina `Logic`** — **não há rotina FBD**. O `FBD_TIMER` aparece só como *tipo de
dado* de 4 tags locais, acionadas por `TONR()` dentro do ST. Ou seja, **não é preciso
decodificar FBDContent/blocos/wires** — o item mais temido não existe neste alvo.

## 2. Escopo

**In-scope:**
1. Parsear `<AddOnInstructionDefinition>` (parâmetros, LocalTags, rotina `Logic` ST).
2. Executar uma chamada de AOI a partir de RLL/ST, com semântica correta de binding de
   parâmetros (Input copy-in, Output copy-out, **InOut por referência**, EnableIn/EnableOut).
3. Registrar `FBD_TIMER` como tipo builtin e dar semântica de `TONR` **sobre FBD_TIMER**
   (enable por `.TimerEnable`, reset por `.Reset`, `DN` quando `ACC ≥ PRE`, tempo por scan).
4. Garantir **coerção REAL→inteiro (arredondamento)** na atribuição ST a alvo inteiro.
5. **Reconciliação com a planta**: o modelo de drive deve consumir/produzir os membros
   do RxPDO/TxPDO que a AOI usa (Modes, TargetVelocity, accel/decel, HomingMethod, …),
   hoje ausentes da janela de 8 B do `drive.py`.

**Non-goals (YAGNI):**
- Suporte a rotinas **FBD** (nenhuma AOI/ladder do alvo usa FBD executável; manter o
  `fbd_excluded` atual para qualquer rotina FBD que apareça).
- **Paridade semântica bit-a-bit** com o Logix real (timing de scan, arredondamento
  banker's exato). Isso é papel do Emulate/físico; aqui buscamos fidelidade
  **comportamental/integração**, não de instrução.
- Instruções RLL clássicas que esta AOI **não** usa (a AOI é ST puro).
- Suporte genérico a **todas** as AOIs concebíveis — o critério de pronto é *rodar a
  `CiA402_PP_Axis` e AOIs ST equivalentes*, não um compilador Logix completo.

## 3. Arquitetura atual (pontos de extensão)

Caminhos relativos a `sdk-line-twin/`. Levantado do código (2026-07-14).

> **Revisão de prontidão (2026-07-14):** §3 verificado 100% preciso contra o código; a ST da
> AOI (757 linhas) parseia limpa no `parse_st` atual (47 stmts top-level → zero trabalho de
> gramática). §4 confere (53 params, 45 locals, 4 FBD_TIMER, rotina ST `Logic`). §5.3/§5.4/§5.5
> corrigidos nesta revisão (modelo de operandos, alias por AST-rewrite, coerção, RxPDO 22 B).
> Detalhes: `scratchpad/aoi-spec-readiness.md`.

- **Parser** `sim_core/logix/l5x_parser.py`: `parse_l5x() -> L5xDoc` retorna dataclasses
  (`L5xDoc`, `TagDecl`, `RoutineDef{name,lang,rungs:[str],st_lines:[str]}`, `ProgramDef`).
  RLL/ST ficam como **texto cru**; o AST é construído depois pelo Controller. `parse_l5x`
  itera só `DataType`, `Program` e `<Tags>` de controller — **nunca** `AddOnInstructionDefinition`.
  UDTs: BOOL exportado como `BIT`+`BitNumber` sobre host SINT oculto, resolvido em membros
  BOOL ordenados. FBD: idioma registrado, corpo vazio (`fbd_excluded`).
- **Controller** `sim_core/logix/controller.py`: uma `TagDb` única, **namespaces de rotina
  planos** (`_rll`, `_st`, `_fbd`), **sem escopo local por rotina** — tudo achatado na `TagDb`.
  `load()` mescla UDTs (+ builtin `TIMER`, l.53), cria tags, `_register_routine` parseia
  corpos. `scan()` → `call_routine(main)`. `call_routine(name)` despacha por namespace;
  **JSR não passa parâmetros nem cria escopo** (`instructions.py` `_jsr` só chama
  `call_routine`); `RET` é no-op. Síntese de UDT de módulo por instância já existe
  (`_build_module_udts`) — **é o molde para o backing por-instância de AOI**.
- **Instruções** `instructions.py`: registro `INSTRUCTIONS: dict[str,InstrDef]` + `ALIASES`;
  `resolve(op)`/`is_supported(op)`. `exec_rung` (`rll.py`) threada a condição da rung;
  `st.py` reusa o mesmo registro para call-statements. Timers `_ton/_tonr/_tof` avançam por
  `ctx.clock.dt_ms` sobre tag **TIMER** (`.PRE/.ACC/.DN`), enable pela rung `cond` + `RES`.
- **ST** `st.py`: já suporta `IF/ELSIF/ELSE`, `CASE`, `AND/OR/XOR` (bitwise), `NOT`
  (lógico), comparações, `+ - * /`, `16#`, acesso a membro/bit/índice, promoção REAL.
  `Assign.target` é `str` (path).
- **Planta** `plant/drive.py`, `iomap.py`, `session.py`: `WireLayout` com offsets de byte;
  `OUT_BYTES=8` / `IN_BYTES=21`. A janela OUT atual carrega só `control_word@0` e
  `target_position@4` (`touch_probe@8` já é truncado) — **não** carrega Modes/ProfileVel/
  accel/decel/HomingMethod. `IoMap` faz ponte byte-a-byte `<módulo>:O/I.Data[stride]` ↔
  `drive.write_out/read_in`. `SimSession._tick`: line.step → load_inputs → **controller.scan**
  → flush_outputs → drive.step → clock.tick.
- **Testes** `tests/` (pytest, sem conftest): `test_l5x_parser.py`, `test_controller.py`
  (`make_doc()` in-memory), `test_instructions.py` (`ctx()`+`run()`), `test_st.py`,
  `test_drive.py`. E2E em `tests/v55/`, `tests/regression/`, golden em `tests/golden/`.

## 4. Requisitos do alvo (AOI `CiA402_PP_Axis`)

Levantado do L5X (`pmo/.../2026.07.14_cia402-pp-aoi/`).

- **53 parâmetros**, ordem posicional importa. Pos 1-2 = `EnableIn`/`EnableOut` (sistema).
  Pos 3-4 = **InOut `Rx:UDT_L8EC_RxPDO`, `Tx:UDT_L8EC_TxPDO`, `Required=true`** (obrigatórios,
  por referência). Restante = Input/Output escalares, `Required=false`, com `<DefaultData>`
  Decorated (ex.: `CountsPerMM=419430.4`, `HomingMethod_in=17`, `Stroke_mm=1250`).
- **~50 LocalTags** (`ExternalAccess=None`), a maioria BOOL/DINT/REAL; padrão `_OS`/`_Last`
  faz **edge-detection manual** (sem ONS). **4 tags `FBD_TIMER`**: `tmoTimer`, `tapTimer`,
  `dmTimer`, `hmTimer`, com membros `EnableIn,TimerEnable,PRE(DINT),Reset,EnableOut,ACC(DINT),
  EN,TT,DN,Status(DINT),InstructFault,PresetInv`.
- **1 rotina `Logic`, tipo ST**. Estrutura: `CASE State OF …` com blocos 0 IDLE, 5 check-fault,
  10-12 fault-reset, 20-22 enable (handshake 0x21→0x23→0x27), 30 operacional (dispatch por
  edges + math mm→counts), 40-43 PP handshake (máscaras de StatusWord bit12/bit10), 50 halt,
  60-72 jog (tap/hold + deadman + soft-limits), 80-84 homing (modo 6, timeout), 90-92 sync
  (re-target por cadência de 2 scans), 200 falha / 250 comm-loss.
- **Léxico ST usado**: `:=` (com **REAL→DINT arredondado**), `+ - * /`, `AND` bitwise sobre
  INT com `16#`, booleanos `AND/OR/NOT/XOR`, comparações `= <> < > >=`, `IF/ELSIF/ELSE`,
  `CASE/OF/ELSE`, acesso a membro em UDT InOut e em struct local, e **`TONR(<FBD_TIMER>)`**.
- **UDTs (acesso por nome, nunca por offset)** — `RxPDO`: ControlWord(INT), TargetPosition(DINT),
  TouchProbeFunction(INT), ModesOfOperation(SINT), TargetVelocity(DINT), TargetAcceleration(DINT),
  TargetDeceleration(DINT), HomingMethod(SINT). `TxPDO`: LastErrorCode(INT), StatusWord(INT),
  ModeOfOperationDisplay(SINT), ActualPosition(DINT), DigitalInputs(DINT), ActualVelocity(DINT),
  PositionLoopError(DINT).

## 5. Design

### 5.1 Parse — `AoiDef`
Novo dataclass em `l5x_parser.py`:
```
@dataclass
class AoiParam: name:str; usage:str; dtype:str; required:bool; default:Any=None  # usage∈{Input,Output,InOut}
@dataclass
class AoiDef: name:str; params:list[AoiParam]  # ordem posicional preservada
             local_tags:list[TagDecl]; logic:RoutineDef  # rotina 'Logic'
```
Hook: em `parse_l5x`, novo loop `root.iter("AddOnInstructionDefinition")`; reusar
`_parse_routine` na `<Routine Name="Logic">`, ler `<Parameters>`/`<LocalTags>` (incl.
`<DefaultData>` para os defaults). Adicionar `aois: dict[str,AoiDef]` a `L5xDoc`.
`EnableIn`/`EnableOut` são reconhecidos e separados (não viram membros normais).

> **⚠️ Defaults com coerção por dtype (evitar o bug do `DataValue` decorado).** O parser
> ATUAL não lê valor inicial nenhum — Base tags carregam no zero-do-tipo (achado do
> `ScanTime_s`, journal `2026-07-14-sdk-line-twin-body-mesh.md`); ler defaults de AOI é
> net-new. Cada param traz o valor em DUAS formas: um escalar L5K e um `<DataValue
> DataType="REAL" Radix="Float" Value="419430.4"/>` decorado. **Ler pela forma Decorated e
> coagir pelo dtype declarado** (REAL→float, não `int()`); para membros struct (ex.
> `FBD_TIMER`) usar a forma **Decorated Structure**, NÃO o array L5K (o L5K de `dmTimer`
> desalinha vs o Decorated). Se `CountsPerMM` carregar 0, `Target_mm*CountsPerMM=0` → eixo
> congelado (mesma falha do ScanTime_s). **Mitigação para ESTE alvo:** a chamada canônica
> (`ServoControl_example.st`) passa os 30 inputs explícitos (CountsPerMM = literal
> `419430.4`), então os defaults nunca são usados pela integração — o impacto é baixo aqui,
> mordendo só unit tests que omitam inputs. Ainda assim, exigir a leitura coagida por dtype.

### 5.2 Data model — backing por instância + `FBD_TIMER` builtin
- **`FBD_TIMER` builtin UDT** registrado incondicionalmente em `controller.py` ao lado do
  `_TIMER_UDT`, com os 12 membros acima (PRE/ACC/Status como DINT; resto BOOL/flags).
- **Backing por instância**: como não há escopo local, cada *chamada/instância* de AOI vira
  um **UDT sintético** (molde: `_build_module_udts`) cujos membros são **todos os params +
  todos os LocalTags** da AOI. O tag de instância (ex.: `Servo1_PP`) materializa esse UDT na
  `TagDb`. Defaults dos params/locals inicializam os membros. Assim `State`, `dmTimer.DN`,
  `Rx.ControlWord` etc. resolvem como `Servo1_PP.State`, `Servo1_PP.dmTimer.DN`, …

### 5.3 Execução — `_aoi_call`
Registrar, **por profile (escopo Controller, não mutação global)**, um `InstrDef("output",
_aoi_call)` para cada nome de AOI, de modo que `is_supported(<AOI>)` passe e o call-statement
ST / a instrução RLL despachem.

**⚠️ Modelo de operandos (CORRIGIDO após verificação da chamada real, 2026-07-14).**
A chamada Logix real (`ServoControl_example.st:101`) é
`CiA402_PP_Axis(ServoPP1, RxPdo1, TxPdo1, Cmd_Enable1, …, 419430.4, 0, …)`:
- **`args[0]` é o TAG DE INSTÂNCIA** (`ServoPP1`) — convenção Logix, NÃO é `EnableIn`
  nem um param. É o tag que materializa o backing UDT (§5.2).
- **`args[1..]`** são os params na ordem posicional **InOut + Input apenas**
  (`RxPdo1`,`TxPdo1`,`Cmd_Enable1`,…, literais como `419430.4`). Os params **Output NÃO
  aparecem** na lista de operandos — são lidos pelo chamador como `ServoPP1.State`,
  `ServoPP1.AtPosition`, etc. **Não há copy-out para operandos.**
- **`EnableIn`** é implícito = a condição da rung/call (nunca um operando); `EnableOut`
  é lido como `ServoPP1.EnableOut` se preciso.

Semântica de `_aoi_call(ctx, cond, args)`:
1. `inst_path = args[0]` (tag de instância). **EnableIn** = `cond`. Se falso: `<inst>.EnableOut
   := 0` e retorna sem executar o corpo (ExecuteEnableInFalse=false).
2. **Copy-in** dos params `Input` escalares: `args[k]` (valor do operando/literal) → membro do
   backing `<inst>.<param>`. (Params sem operando na chamada — se houver — usam o `<DefaultData>`
   com **coerção por dtype**, ver §5.1.)
3. **Bind InOut por referência**: `Rx`/`Tx` (`args[1..2]`) **não** são copiados — o corpo lê/escreve
   direto nos tags do chamador. Escrever `Rx.ControlWord` deve pousar em `RxPdo1.ControlWord`.
4. **Executar** a rotina `Logic` (AST ST) com nomes reescritos por instância (§5.3.1).
5. **EnableOut** := 1 em `<inst>.EnableOut`. (Sem copy-out: os Outputs já vivem em `<inst>.*`.)

### 5.3.1 Aliasing InOut — DECIDIDO: reescrita de AST por instância
`st.py` passa paths de string crus direto a `ctx.db.get/set` — não há hook de indireção.
Das duas rotas que a §5.3 cogitava, **adota-se a reescrita de AST por instância** (NÃO o
refactor de resolver com tabela de alias no `ExecCtx`, que tocaria ~6 sítios do `st.py` e
arrisca toda a ST existente): num módulo novo, ao instanciar a AOI, clona-se o AST da rotina
`Logic` reescrevendo os paths — nome nu `Foo` → `<inst>.Foo`; `Rx.*` → `<argRx_path>.*`;
`Tx.*` → `<argTx_path>.*`. Escritas são whole-word (a AOI não faz bit-write em ControlWord),
o que mantém a reescrita tratável. Cache do AST reescrito por instância.

> Nota: como o corpo re-roda todo scan e é ST, não há necessidade de pilha de retorno; o
> `RET` no-op atual não afeta ST. A idempotência por scan é responsabilidade da própria AOI
> (ela é escrita assim). O padrão `_OS`/`_Last` de edge-detection manual funciona no TagDb
> plano porque o estado anterior vive no próprio backing por-instância (`<inst>._Last`),
> persistente entre scans.

### 5.4 Lacunas de linguagem ST
- **`TONR` sobre `FBD_TIMER`**: novo caminho (ou branch por datatype do arg). Enable =
  `<t>.TimerEnable` (não a rung `cond`); reset = `<t>.Reset` (não `RES`); `ACC =
  min(ACC+dt_ms, PRE)` quando habilitado, `ACC=0` quando reset; `DN = ACC>=PRE`; atualizar
  `EN`/`TT` coerentes. Detectar o tipo do tag (`FBD_TIMER` vs `TIMER`) e ramificar; o `TONR`
  clássico (rung-enable) permanece p/ TIMER.
- **Coerção REAL→inteiro na atribuição**: hoje a atribuição ST a um tag inteiro **TRUNCA**
  (`tagdb._encode` faz `int(val)`, VERIFICADO) — não arredonda. Mudança genuína necessária:
  garantir que `Assign` a alvo inteiro (SINT/INT/DINT) **arredonde** (round-half-away-from-zero,
  documentado). **Ponto cirúrgico:** no `Assign` do `st.py`, coagir pelo tipo do tag (via
  `dtype_of`) ANTES do `db.set` — **NÃO** mexer no `_encode` global compartilhado (que outros
  caminhos usam e esperam truncar/o comportamento atual).

### 5.5 Reconciliação com a planta (interface AOI ↔ drive)
A AOI acessa `Rx`/`Tx` **por nome** e o mapeamento byte-a-byte real é feito por um `COP`
**externo** no ladder (a AOI não depende de offset). No line-twin, para fechar a malha:
- **Opção X (recomendada) — por nome/tag, sem bytes**: o `drive.py` passa a ler os membros
  do RxPDO (ao menos `ModesOfOperation`, `TargetVelocity`, `TargetAcceleration/Deceleration`,
  `HomingMethod`, além de `ControlWord`/`TargetPosition`) e a produzir os do TxPDO diretamente
  dos/para os **tags** que a AOI usa, sem passar pela janela de 8 B. Evita reimplementar o
  packing/alinhamento do Logix.
- **Opção Y — estender `WireLayout`**: ampliar a janela OUT para o RxPDO completo (**22 B**,
  confirmado — Modes/TargetVel/accel/decel/HomingMethod cresceram sobre os 8 B atuais) e IN
  para o TxPDO (21 B), mantendo o caminho `IoMap` byte-a-byte. Mais fiel ao wire real, mais
  trabalho (packing/alinhamento) — e agora que o PDO cresceu para 22 B, mais pesada que X.

Decisão default: **Opção X** para o v1 (o objetivo é validar comportamento, não wire) —
confirmada mais leve que Y. `drive.py:371-393` ignora `ModesOfOperation` e a velocidade de
perfil do wire hoje; a Opção X faz o `drive.py` ler esses membros direto dos tags Rx/Tx.
O `drive.py` já modela a máquina CiA402 e PP; falta ele **honrar ModesOfOperation e a
velocidade de perfil** para mover — hoje ignora ambos. Documentar em `run-modes.md`/README.

## 6. Estratégia de testes

- **Unit parse** (`tests/test_l5x_parser.py`): parsear uma AOI mínima → `AoiDef` com params
  ordenados, locals, e a rotina Logic; parsear `CiA402_PP_Axis.L5X` sem erro.
- **Unit binding/exec** (novo `tests/test_aoi.py`, padrão `make_doc` de `test_controller.py`):
  AOI mínima (ex.: `Out := A + B` com InOut) chamada de uma rotina; asserta copy-in/out e
  **aliasing InOut** (escrita na struct do chamador). Caso de `FBD_TIMER`/`TONR` com clock
  fake avançando `dt_ms`.
- **Unit ST** (`tests/test_st.py`): coerção REAL→DINT arredondada na atribuição.
- **Integração em malha fechada** (`tests/regression/` ou `tests/v55/`): instanciar
  `CiA402_PP_Axis` sobre o `drive.py`, dirigir `Enable`+`MoveAbs`/`Target_mm`, tickar a
  `SimSession` e asseverar a sequência: fault-reset → enable (CW 0x06→0x07→0x0F) → PP
  handshake → `AtPosition` na posição alvo (mm→counts com `CountsPerMM`). Casos: homing
  (método 17 → `Homed`), deadman (Heartbeat parado → `DeadmanTripped`), soft-limits.
- **Regressão**: garantir que o ladder IRIS existente (subset RLL/ST) continua passando —
  a introdução de AOI não pode quebrar `is_supported`/dispatch dos programas atuais.

## 7. Fronteiras de fidelidade (o que este teste NÃO valida)

- Timing de scan real e ordem fina de execução do Logix (o clock é `SimClock`, não o scan do
  CLP). Timers validam **lógica** (DN/reset), não latência absoluta.
- Arredondamento/overflow idênticos ao firmware; comportamento de instruções fora do subset.
- O **caminho de wire** físico (gateway Anybus, assembly EIP) — isso é bancada + `eip-probe`.
Para paridade fina, a referência continua sendo o CLP físico (e o Logix Emulate no golden
harness). Este emulador é **complementar**: regressão headless de comportamento/integração.

## 8. Fases de implementação (para a sessão executora)

1. **Parse AOI** → `AoiDef` + testes de parse (inclui `CiA402_PP_Axis.L5X`).
2. **`FBD_TIMER` builtin** + **`TONR` FBD-aware** + testes de timer.
3. **Backing por-instância** (UDT sintético) + registro do op da AOI no Controller.
4. **`_aoi_call`** (copy-in/out, alias InOut, EnableIn/Out, resolver escopado) + testes de binding.
5. **Coerção REAL→inteiro** na atribuição ST + teste.
6. **Reconciliação da planta** (Opção X: `drive.py` honra Modes/velocidade de perfil) + teste
   de malha fechada com a AOI.
7. **Integração v5.6**: carregar o ladder v5.6 do Thiago + a AOI e rodar cenários; regressão.

**Prontidão por fase (verificada contra o código, 2026-07-14 — ver
`scratchpad/aoi-spec-readiness.md`):**

| Fase | Esforço | Começar já? | Gate |
|---|---|---|---|
| 1. Parse `AoiDef` | S/M | ✅ | parse do corpo já provado (ST parseia limpo, 47 stmts) |
| 2. `FBD_TIMER` + `TONR` FBD-aware | S | ✅ | branch por `dtype_of` limpo |
| 3. Backing por-instância (UDT sintético) | M | após F1 | molde `_build_module_udts` serve |
| 4. `_aoi_call` + alias InOut | **L** | ⛔ | precisa §5.3 corrigido (feito) + rota de alias fixada (feito: AST-rewrite) |
| 5. Coerção REAL→inteiro | S | ✅ | independente (hoje TRUNCA — mudança real) |
| 6. Reconciliação da planta (Opção X) | M/L | após F4 | drive honra Modes/vel de perfil |
| 7. Integração v5.6 | L | ⛔ | ladder v5.6 externo (Thiago) |

Fases **1, 2, 5 podem começar JÁ** (independentes entre si e do resto). Fase 4 é o miolo (L)
e destravou após as correções desta revisão.

## 9. Decisões em aberto (ranqueadas por impacto após a revisão de prontidão)

1. ~~**Modelo de operandos da chamada AOI**~~ — **RESOLVIDO nesta revisão** (§5.3): arg0 =
   tag de instância; args = InOut+Input; sem copy-out de Output; EnableIn = cond da rung.
   (Era o blocker; verificado em `ServoControl_example.st:101`.)
2. ~~**Mecanismo de aliasing InOut**~~ — **RESOLVIDO** (§5.3.1): reescrita de AST por instância
   (não o refactor de resolver).
3. **Opção X vs Y** na reconciliação da planta — **default X** (confirmado mais leve; RxPDO é 22 B).
   Falta o `drive.py` honrar `ModesOfOperation` + velocidade de perfil.
4. **Defaults de param por dtype** (§5.1) — exigir leitura coagida pela forma Decorated (evita o
   zero-load do `ScanTime_s`); impacto baixo p/ este alvo (chamada passa tudo explícito) mas
   obrigatório p/ unit tests.
5. **Regra de arredondamento REAL→inteiro** — default round-half-away; aplicar no `Assign` do
   `st.py` (via `dtype_of`), NÃO no `_encode` global.
6. **Escopo de registro do op da AOI** (por profile/Controller, não global) — spec ok.
7. **Múltiplas instâncias** da mesma AOI (4 eixos) — sim; unicidade do tag de instância por
   chamada; o backing por-instância + edge-state em `<inst>._Last` cobre isso.

## 10. Arquivos tocados (previsto)

`sim_core/logix/l5x_parser.py` (parse AOI), `controller.py` (FBD_TIMER builtin, backing,
registro do op), `instructions.py` (`_aoi_call`, TONR FBD-aware), `st.py` (coerção de
atribuição), `plant/drive.py` (honrar Modes/velocidade), docs `run-modes.md`/README; novos
`tests/test_aoi.py` + casos em `test_l5x_parser.py`/`test_st.py`/regressão.
