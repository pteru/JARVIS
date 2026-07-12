---
type: Design Spec
title: sdk-line-twin — gêmeo virtual de linha + validador de lógica PLC (IRIS 03007)
description: Design do sdk-line-twin — painel de controle/gêmeo virtual que simula a operação da linha (GM ↔ IRIS), integra Redis + strokmatic-eip + PLC CompactLogix L19ER em modo HIL, e valida o programa do PLC IRIS por emulação de L5X/CSV em modo pure-sim.
tags: [line-twin, plc, l5x, simulacao, gemeo-virtual, iris, rockwell, strokmatic-eip]
timestamp: 2026-07-11
project: "03007"
product: visionking
language: pt-BR
status: draft
---

# sdk-line-twin — gêmeo virtual de linha + validador de lógica PLC

**Repo alvo:** `strokmatic/sdk-line-twin` (novo). Primeiro perfil: IRIS 03007 (GM SCDS Paint).
**Decisões de origem:** sessão de brainstorming 2026-07-11 com Pedro (prioridades, topologia, fidelidade).

## 1. Objetivo e prioridades

Ferramenta de simulação e observação da operação do sistema IRIS, com dois modos de execução e quatro usos, em ordem de prioridade:

1. **Validar o programa do PLC IRIS (regressão)** — testar a lógica real (jog/homing v5, jobdata, GCCS, fail-safe) contra cenários de linha, antes da bancada/buy-off.
2. **Simular a linha GM (gerador de cenários)** — conveyor, jobdata, styles e faltas de forma controlável e reproduzível.
3. **Painel de operação / gêmeo visual** — 3D do pórtico em tempo real (eixos, carro, estados), observação e comando.
4. **Treinamento/demo** — polish visual, modo demonstração.

### Modos de execução

- **pure-sim** — nenhum PLC físico. Os dois controladores (IRIS e GM) são emulados no app a partir dos arquivos L5X reais (+ CSVs de tags). Clock simulado de passo fixo, determinístico, mais rápido que tempo real.
- **HIL** (hardware-in-the-loop) — dois PLCs físicos: o **CompactLogix 5069-L319ER** da bancada roda o programa GM-sim (papel de PLC GM); o **PLC IRIS real** (5069-L310ER) roda o programa do Willer com **campo real** (Anybus + drives + sensores do pórtico no galpão). O app injeta cenário no L19ER e observa ambos.

## 2. Arquitetura

```
sdk-line-twin/
├── sim-core/                  # Python (pacote instalável, headless-first)
│   ├── logix/                 # parser L5X + interpretador (scan engine, tag DB, UDTs)
│   ├── plant/                 # física: drives/eixos, conveyor+carro, sensores
│   ├── scenarios/             # DSL YAML de cenários + runner + assertions
│   ├── bridge/                # publica/consome o contrato Redis da strokmatic-eip
│   └── gateway/               # websocket gateway Redis → painel (FastAPI)
├── panel/                     # Vite + TypeScript + Three.js (cena portada do viewer)
├── scripts/                   # tooling: conversão STEP→GLTF, geradores, golden tests
└── profiles/
    └── iris-03007/            # L5X (IRIS + GM-sim), CSVs de tags, plant.yaml,
                               # assets/ (GLTF do pórtico), binding.json,
                               # scenarios/ (suites YAML)
```

**Espinha dorsal: o contrato Redis da strokmatic-eip** (`tags:<plc_key>:*` hash cold, `cmd:<plc_key>` stream com classes `motion|stop|config`, `audit:<plc_key>`; ver `strokmatic-eip/docs/redis-contract.md`). Os dois modos produzem/consomem as mesmas chaves:

- **pure-sim**: o interpretador executa os dois programas; a troca produced/consumed `GM_Com_In`/`GM_Com_Out` vira par de buffers com cópia por RPI simulado; o `plant/` responde aos assemblies dos drives; o `bridge/` publica no Redis no mesmo formato que o tag-client publicaria. Para pytest, o bridge tem backend em memória (sem Redis, sem rede).
- **HIL**: duas instâncias do tag-client real da strokmatic-eip (uma por PLC). Injeção de cenário = escrita de tags no L19ER via `cmd:<l19er>`; observação = `tags:*` de ambos.

Painel, scenario engine e testes **não sabem em que modo estão** — só falam Redis (ou o backend em memória). O IRIS WS oficial fica fora do escopo, mas o painel emite os mesmos comandos pelo mesmo canal `cmd:` — servindo de WS de desenvolvimento.

## 3. Interpretador L5X (`sim-core/logix/`)

- **Parsing**: L5X (XML) → controller, programas, rotinas, tags, UDTs. As rotinas do programa real (aterramento 2026-07-11 nos L5X do 03007) vêm em **três linguagens**: RLL (rungs em texto neutro — MainRoutine, R003–R051), **ST** (Servo1–4, R030/R031/R020 e demais rotinas v5 — `IF/ELSIF/ELSE`, `CASE`, `:=`, `AND/OR/NOT`, chamadas `COP`/`TONR`) e **FBD** (R002_Scale + R100–105, os PIDs térmicos). CSV de tags do Studio 5000 como fonte complementar/verificação. Parsers recursivos próprios para rungs RLL e para o subset ST; lib `l5x` do PyPI apenas como referência.
- **FBD = exclusão explícita por perfil**: coerente com o térmico-stub do plant (§4), as rotinas FBD não são interpretadas no v1 — o perfil as declara excluídas junto com a lista de tags que elas escreveriam (que passam a ser poke-áveis por cenário). Rotina FBD não declarada no perfil ⇒ erro de load (a falha ruidosa continua valendo).
- **Tag DB tipado**: BOOL/SINT/INT/DINT/REAL, arrays, UDTs com layout de bytes real (necessário para `COP` entre tipos distintos — usado nos assemblies dos drives, ex.: `COP(AnyBusComm:I.Data[21], Servo2_In, 1)`), tags de módulo (`AnyBusComm:I.Data`), aliases, bit-of-word (`Tag.15`, `Buf[2].3`).
- **Scan Logix**: inputs → MainRoutine via JSRs, rung-condition-in/out, prescan e `S:FS` → outputs. Passo default 10 ms simulados. Timers avançam pelo clock simulado (determinismo; regressão mais rápida que tempo real).
- **Subset inicial (RLL)**: `XIC XIO OTE OTL OTU ONS TON TOF TONR TOFR RES MOV COP CPS FLL JSR RET EQU NEQ GRT LES GEQ LEQ LIM ADD SUB MUL DIV BTD CLR NOP AFI` + aliases observados nos exports reais (`MOVE`, `GT`, `GE`, `EQ`); `MSG` como stub explícito (loga, seta `.DN`).
- **Falha ruidosa em duas camadas**: no load, erro agregado listando toda instrução/datatype fora do subset (nunca pular rung em silêncio); em runtime, overflow/index-out-of-range → major fault do controlador emulado (visível no painel e falha o cenário).
- **Golden tests contra o L19ER real**: cada instrução do subset ganha mini-programa que roda no interpretador e no L19ER via pylogix; divergência = bug do interpretador. O L19ER é o oráculo de conformidade.

## 4. Modelo de planta (`sim-core/plant/`)

- **Drives/eixos**: um modelo por eixo espelhando os assemblies do gateway no layout real do scan (Out 8 B: controlword/`TouchProbeFunc` INT/target · In 21 B + 2 error words: statusword/`ActualPosition` counts/probe). Implementa o perfil CiA-402 no nível que o programa v5 exercita: máquina de estados 402 (+ fault/fault-reset, Halt bit 8), modos PP (jog step/coreografia) e PV (jog contínuo com deadman), rampa trapezoidal com v_max/accel por eixo, fins de curso por software, **fim de curso físico → touch probe** (mecânica do homing R031), conversão counts↔mm (`CountsPerMM`/`HomeOffsetRaw`). Injeção de falhas: drive fault, perda de link (validar clear-on-loss V10), probe mudo, eixo travado.
- **Conveyor + carroceria**: carros spawnam por cenário (style, VID), avançam na velocidade de linha (ciclo 54 s), geram `CarPresent`, posição longitudinal e eventos do lado GM. Posição do carro = `sweep_pos` (mesmo conceito do motion-engine do viewer).
- **Sensores/periferia**: barreiras de luz, presença; térmico como stub de estado (zonas OK/fault para interlocks; sem física térmica no v1).
- **Fronteira**: a planta fala com o controlador emulado exclusivamente pelas imagens de I/O (assemblies + I/O local mapeado no perfil) — nada de atalhos na tag DB. O programa é validado pelo mesmo caminho da máquina real.
- **GM-side**: programa GM-sim (evolução do `R090_GMSim`) roda no segundo controlador emulado; cenário injeta jobdata/`LineRunning`/faltas poking tags do controlador GM — o mesmo gesto que no HIL vira escrita no L19ER.
- Parâmetros físicos em `profiles/iris-03007/plant.yaml` (defaults do contrato v0.99.x).

## 5. Scenario engine + regressão (`sim-core/scenarios/`)

DSL YAML: timeline declarativa + asserções + invariantes.

```yaml
name: jog-step-com-carro-presente
mode: [pure-sim, hil]
setup: {profile: iris-03007, initial: {homed: true, mode: MANUAL}}
timeline:
  - {at: 0s,  spawn_car: {style: TRACKER, vid: 12345}}
  - {at: 10s, poke: {plc: gm, tag: GM_Com_In.LineRunning, value: 1}}
  - {at: 12s, cmd: {plc: iris, tag: WSCmd_JogStep, value: 1, class: motion, group: axis_z}}
expect:
  - {within: 2s, tag: {plc: iris, name: IF_Axis[2].ActualPosition_mm, approx: 1.0, tol: 0.05}}
invariants: [boot-never-moves-axes, conveyor-ok-drops-on-fault, car-present-blocks-invasive-auto]
```

- **Três verbos**, idênticos nos dois modos: `poke` (tag de cenário — tag DB no pure-sim, L19ER via tag-client no HIL), `cmd` (canal oficial `cmd:` stream — exercita o caminho normativo Fase A: age-discard 300 ms, stop prioritário), `expect`/`invariants` (leitura via `tags:*`).
- **Invariantes = contrato v0.99.x executável**: monitores nomeados avaliados a cada scan, com ID rastreável à regra do contrato (ex.: `regra-1d-car-present`). Ex.: boot nunca movimenta eixos; `IRIS_ConveyorOK` cai em ≤ N scans após falta; permissivos ativo-alto; heartbeat GM timeout.
- **Runner/pytest**: cada YAML vira teste parametrizado; pure-sim com clock simulado (5 min de linha em segundos, determinístico); HIL em wall-clock, pulando cenários `pure-sim only`. Falha reporta timeline, tags no momento da violação e trace de rungs opcional (rungs que mudaram nos scans ao redor).
- **Trace JSONL** por execução (snapshot de tags por scan/poll): replay visual no painel (scrub), comparação HIL × pure-sim do mesmo cenário, anexo para issues.

## 6. Ativos 3D e binding (setup preliminar)

Etapa de preparação que liga a montagem mecânica real à lógica — análoga ao workflow "Setup do rig" do viewer.

- **Ingestão do modelo** (`scripts/`): Pedro fornecerá a montagem completa detalhada do pórtico como **STEP ou GLB**. O formato canônico consumido pelo painel é GLB: se a entrada for STEP, conversão headless preservando **árvore de montagem e nomes de parts** (OpenCascade/FreeCAD headless; referência: `sdk/3d-model-convert-to-gltf`); se já for GLB, ingestão direta — requisito é apenas que a árvore de nós tenha os subconjuntos móveis separados e nomeados (não um mesh único fundido). Artefato: `profiles/iris-03007/assets/portico.glb` + manifest da árvore.
- **Editor de binding** (tela "Setup" no painel): o usuário classifica nós da árvore como **fixo / móvel** (grupo cinemático por eixo, com direção e curso), posiciona **sensores** (tipo + posição + tag L5X associada) e marca **pontos relevantes**: home switch/touch probe, fins de curso, zona de car-present, vão de segurança, origem/escala da cena.
- **Saída: `binding.json`** versionado — node paths ⇄ eixos do plant model ⇄ tags do L5X ⇄ tipo de visualização. O gêmeo 3D e overlays são 100% data-driven por esse arquivo (zero hardcode de geometria).
- **Linter de binding** no load: eixo do plant sem grupo móvel, tag referenciada inexistente no tag DB, sensor órfão ⇒ erro explícito.
- **Fallback**: enquanto o STEP não existe, geometria paramétrica do rig portada do viewer, sob o mesmo contrato de binding.

## 7. Painel 3D + gateway

- **Gateway** (FastAPI + websocket): assina Redis (`tags:*` dos dois PLCs + `audit:*`), agrega snapshots a 10–20 Hz, empurra deltas ao painel; comandos do painel → `cmd:` stream com `seq`/`ts_ms`/classe corretos; serve traces para replay. O painel nunca fala Redis direto.
- **Painel** (Vite + TS + Three.js; módulos de cena **copiados e adaptados** do viewer — `rig.ts`, OBJ/GLTF, materiais, câmera orbital — sem dependência; o viewer segue intocado). Pose dos eixos = função do estado ao vivo (`ActualPosition_mm` + `sweep_pos`), não de keyframes. Telas:
  1. **Gêmeo 3D** — pórtico + carroceria em tempo real; overlay por eixo (estado 402, alvo, velocidade, fault); trilha planejada (`Moves[8]`) vs. executada.
  2. **Painel de linha (GM)** — jobdata (VID/Style/Options), fila `Station[11]`, `LineRunning`, heartbeat, GCCS; controles de cenário (spawn, velocidade, faltas).
  3. **Painel IRIS** — sinais do contrato (`ConveyorOK`, `InhibitCode`, modo, alarmes latcheados) + comando manual (jog com deadman, homing) — mesma gramática das telas kiosk IRIS-07 (validação de UX de brinde).
  4. **Timeline/replay** — scrub de traces, comparação HIL × pure-sim lado a lado.
- **Segurança HIL**: comandos herdam o canal normativo (age-discard, stop prioritário); banner de modo (PURE-SIM / **HIL — MOVIMENTO REAL**); movimento em HIL exige armar toggle de sessão.

## 8. Tratamento de erros

- **Load L5X**: erro agregado (tudo que falta de uma vez).
- **Runtime pure-sim**: major fault emulado pára o controlador; cenário falha com trace.
- **HIL**: PLC inalcançável / hash stale (regra 5-a do contrato) → subsistema indisponível no painel, runner aborta com diagnóstico.
- **Gateway caiu**: painel reconecta com backoff e mostra desconexão — nunca congela silenciosamente em dado velho (filosofia IRIS-07).

## 9. Testes do próprio twin

1. **Unit**: parser L5X; cada instrução do subset (golden vs. L19ER real); plant model (rampas, homing, probe, limites).
2. **Integração**: cenários-sentinela do IRIS v5 como suíte de regressão do repo.
3. **Painel**: Playwright smoke (cena carrega, estado chega, HIL arma/desarma) — padrão do sealer-provisioning-gui.

## 10. Fases

| Fase | Entrega | Valor |
|---|---|---|
| 0 | Scaffold do repo + parser L5X + tag DB + carga do IRIS v5 real | "o programa carrega e é compreendido" |
| 1 | Interpretador subset + plant de eixos + pytest jog/homing pure-sim | prioridade 1: regressão do v5 |
| 2 | Controlador GM emulado + jobdata/GCCS + invariantes do contrato + cenários de linha | prioridade 2: linha simulada |
| 3a | Pipeline STEP→GLTF + editor de binding (`binding.json`) | setup da cena |
| 3b | Bridge Redis + gateway + painel 3D (gêmeo + telas) | prioridade 3: painel/twin |
| 4 | HIL: GM-sim no L19ER + 2× tag-client + golden tests do interpretador | bancada real |
| 5 | Replay/comparação, polish, modo demo | prioridade 4 |

Cada fase é independentemente útil; Fases 0–2 não precisam de browser, Redis nem hardware.

## 11. Convenções e riscos

- **Repo**: `strokmatic/sdk-line-twin`; Python em venv, Node local; CI leve (pytest + build do painel). Push inicial `feat/v1` + rename via API (classifier bloqueia master em repo novo).
- **Perfil ≠ engine**: nada específico do IRIS no `sim-core/` — tudo do 03007 vive em `profiles/iris-03007/` (L5X, CSVs, plant.yaml, binding.json, cenários). Futuros perfis (Stellantis, Nissan) reusam o engine.
- **Riscos assumidos**: (a) fidelidade do interpretador — mitigada pelos golden tests contra o L19ER; (b) divergência plant model × drives Leadshine reais — mitigada pela comparação de traces HIL × pure-sim (Fase 4+); (c) semântica produced/consumed simplificada (RPI simulado, sem timeout de conexão no v1 — perda de link é injetada como falha explícita, não emergente).
