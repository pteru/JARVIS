---
type: Implementation Plan
title: sdk-line-twin — Fase 2 (MainProgram + jobdata, planta de linha, cenários YAML, invariantes do contrato)
description: Plano da Fase 2 — integrar o MainProgram real do Willer + pacote jobdata (R006/R020/R052/R090, UDTs v2) no controlador emulado com as 3 edições manuais aplicadas por config, planta de conveyor/carro/barreiras, DSL YAML de cenários com coletor pytest, e invariantes do contrato v0.99.8 como monitores nomeados.
tags: [line-twin, plc, l5x, simulacao, iris, jobdata, gccs]
timestamp: 2026-07-12
project: "03007"
product: visionking
language: pt-BR
status: draft
---

# sdk-line-twin Fase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O twin roda a **linha completa em pure-sim**: MainProgram real (ciclo automático R020, watchdog GM R006, publish R052, simulador GM R090) + Servo, com carros passando por barreiras, jobdata fluindo GMSim→GM_In→WS_Queue→WS, e cenários YAML validando o comportamento contra invariantes do contrato v0.99.8.

**Architecture:** Um único controlador IRIS emulado (fiel ao estado atual do programa: o lado GM é o `R090_GMSim` interno — mesma superfície da validação de bancada). Novo `plant/line.py` (conveyor/carro/barreiras). `scenarios/` = DSL YAML + runner + monitores de invariante + coletor pytest. Segundo controlador com produced/consumed = **Fase 2b futura** (bloqueada pelo V1 do contrato; `UDT_GM_Com_Out` v2 não existe).

**Tech Stack:** Python 3.12 stdlib + PyYAML (única dependência nova, no venv). Base: sim_core existente (130 tests + 1 xfail).

**Spec:** `docs/superpowers/specs/2026-07-11-sdk-line-twin-design.md` §4-§5 · Ground-truth: relatório Explore 2026-07-12 (pacote `2026.07.11_update-jobdata/` + contrato v0.99.8).

## Global Constraints

- Repo: `~/JARVIS/workspaces/strokmatic/sdk/sdk-line-twin`, branch `master` (repo novo já publicado; trabalhar em branch `feat/phase2`, merge ao final).
- Falha ruidosa em tudo; perfil ≠ engine (nada de nomes 03007/GMSim/AnyBusComm hardcoded em `sim_core/`); clock simulado only.
- Artefatos jobdata (SSOT pmo): `~/JARVIS/workspaces/strokmatic/pmo/projects/03007/handoffs/2026.07.11_update-jobdata/` → copiar TODOS (9 arquivos) para `profiles/iris-03007/l5x/jobdata/` + linha no PROVENANCE.md.
- **As 3 edições manuais do README do pacote** aplicadas por CONFIG do perfil (nunca editando os L5X copiados): (1) JSRs no MainRoutine — `R006_MapGM` após `R005_Inputs`; `R052_Publish` e `R090_GMSim` no fim; (2) `R011_Incialize` R4: `XIC(StTimeoutCommGM)` → `XIO(StTimeoutCommGM)`; (3) `GMHb_TimeoutScans=200`, `GMSim_HeartbeatScans=50` (task 10 ms).
- Precedência de UDT: pacote jobdata (v2 de `UDT_GM_Com_In`/`UDT_WS_Com`/`UDT_StationJob`) SOBRESCREVE as versões v1 embutidas no `MainProgram_Program.L5X` — conflito de UDT homônimo exige declaração explícita no perfil (senão LoadError).
- FBD do MainProgram: `R002_Scale`, `R100_PID_R1`..`R105_PID_R6` → `fbd_excluded` (térmico é stub na Fase 2, spec §4).
- Fatos do ground-truth que os testes usam: heartbeat GM_In.Heartbeat incrementa a cada `GMSim_HeartbeatScans`; `StTimeoutCommGM := GMHb_Cnt > GMHb_TimeoutScans`; R020 rung 6 gate = `GM_In.Station[0].Valid`, copia p/ `WS_Queue_Job[0]`, `WS.PVI←VID`, `WS.Style←Style`, `OTL(GM_Out.PVI_ACK)`; R052: `COP(GM_In.Station[0], WS.Station[0], 11)`; UDT_StationJob ~36 B (Valid/Present BITs, Options INT[8], Style/VID/SeqNum/Carrier DINT).
- IDs de invariante citam o contrato: `hb-timeout-2s` (§1.3), `valid-gate-jobdata` (§1.3/R020), `boot-never-moves` (§1.3), `line-stop-halts-axes` (§1.2) — implementar SÓ os que o programa carregado de fato exercita; invariante sem lastro no programa = não criar (registrar no plano da Fase 4/HIL).
- Commits convencionais + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure (novo/modificado)

```
sim_core/
├── logix/controller.py        # MOD: jsr_appends/rung_edits/udt_overrides via config
├── plant/line.py              # NEW: conveyor, carro, barreiras, CarPresent
├── scenarios/
│   ├── __init__.py            # NEW
│   ├── dsl.py                 # NEW: parse YAML → Scenario (timeline/expect/invariants)
│   ├── runner.py              # NEW: executa Scenario numa SimSession
│   └── invariants.py          # NEW: monitores nomeados (registro, avaliados por tick)
├── session.py                 # MOD: line plant + on_tick invariants hook
profiles/iris-03007/
├── l5x/jobdata/               # NEW: 9 arquivos copiados
├── profile.json               # MOD: mainprogram, jsr_appends, rung_edits, udt_overrides,
│                              #      fbd_excluded, config pokes (GMHb/GMSim scans)
├── line.json                  # NEW: geometria da linha (posições B01/B02, comprimento, v)
└── scenarios/                 # NEW: *.yaml (suite de linha)
tests/
├── test_line_plant.py         # NEW
├── test_scenario_dsl.py       # NEW
├── test_invariants.py         # NEW
├── test_controller_patches.py # NEW (jsr_appends/rung_edits/udt_overrides)
└── regression/test_line_scenarios.py  # NEW: coletor pytest dos YAML
```

---

### Task 0: branch, PyYAML, artefatos jobdata + proveniência

**Files:** `profiles/iris-03007/l5x/jobdata/*` (9 cópias), `PROVENANCE.md` (append), `pyproject.toml` (dep `pyyaml`)

- [ ] Step 1: `git checkout -b feat/phase2`; `.venv/bin/pip install pyyaml`; adicionar `dependencies = ["pyyaml>=6"]` ao `[project]` do pyproject.toml.
- [ ] Step 2: copiar os 9 arquivos de `$PMO/handoffs/2026.07.11_update-jobdata/` para `profiles/iris-03007/l5x/jobdata/`; append no PROVENANCE.md (tabela: 9 linhas, origem, 2026-07-12, v0.99.8) incluindo nota das 2 discrepâncias do ground-truth: (a) README do pacote diz que v2 remove os 4 `Retrabalho_*PVI` de UDT_WS_Com mas o export ainda os contém (adotar o export como autoridade); (b) `GM_Out` UDT vem do MainProgram (v1, pré-existente).
- [ ] Step 3: `.venv/bin/pytest -q` → 130 passed, 1 xfailed (nada quebrou); commit `chore(phase2): branch + pyyaml + artefatos jobdata com proveniência`.

---

### Task 1: patches de load no Controller (`jsr_appends`, `rung_edits`, `udt_overrides`)

**Files:** Modify `sim_core/logix/controller.py` · Test `tests/test_controller_patches.py`

**Interfaces (produz):** três chaves novas no `config` de `Controller.load`:
- `jsr_appends: dict[str, list[dict]]` — ex. `{"MainRoutine": [{"routine": "R006_MapGM", "after": "R005_Inputs"}, {"routine": "R052_Publish"}, {"routine": "R090_GMSim"}]}`. Sem `after` = append no fim. Implementação: insere rung sintético `JSR(<routine>,0);` na lista de rungs da rotina alvo, logo após o rung que contém `JSR(<after>,` (falha ruidosa: `after` não encontrado, rotina alvo inexistente, rotina JSR alvo inexistente — mensagens agregadas no LoadError).
- `rung_edits: list[dict]` — ex. `{"program": "MainProgram", "routine": "R011_Incialize", "find": "XIC(StTimeoutCommGM)", "replace": "XIO(StTimeoutCommGM)", "count": 1}`. Substituição textual no texto do rung ANTES do parse; `count` = nº exato de ocorrências esperado no conjunto de rungs da rotina (≠ ⇒ LoadError). 
- `udt_overrides: list[str]` — nomes de UDT cuja redefinição por doc POSTERIOR é permitida (last-wins). UDT homônimo com members diferentes SEM entrada aqui ⇒ LoadError (hoje o merge é silencioso ou colide — verificar comportamento atual e torná-lo ruidoso).

- [ ] Step 1: testes falhando — jsr_append (síntético: Main com R005; append R006 after R005 → scan executa R006), jsr_append after inexistente → LoadError; rung_edit aplicado (XIC→XIO muda comportamento observável num tag), count errado → LoadError; udt_override permite v2 sobrescrever v1 (member novo acessível), conflito sem override → LoadError com nome do UDT.
- [ ] Step 2: implementar nos pontos de load (antes da validação/parse); manter ordem: rung_edits → jsr_appends → parse/validação.
- [ ] Step 3: focado PASS → suite PASS; commit `feat(logix): patches de load — jsr_appends, rung_edits (count exato), udt_overrides explícitos`.

---

### Task 2: módulos de I/O local genéricos no perfil (Local:2 analógico)

**Files:** Modify `sim_core/logix/controller.py` (config `modules` estendido) · Test em `tests/test_controller_patches.py`

O MainProgram usa `MOVE(Local:2:I.Ch00.Data, AI_DistanceP1)` etc. O config `modules` atual só cria `Data SINT[n]`. Estender: cada módulo pode declarar `members` como lista de `{name, dtype, dim}` (UDT sintético arbitrário), mantendo o atalho `input_bytes/output_bytes` existente (retrocompatível).

- [ ] Step 1: teste falhando — módulo `{"Local:2": {"input_members": [{"name": "Ch00", "udt": {"Data": "INT", "Fault": "BOOL"}}, ...]}}`; simplificar para o formato mínimo que resolve o caso real: grep primeiro TODOS os usos `Local:\d:` no MainProgram (`grep -o 'Local:[0-9]:[IO]\.[A-Za-z0-9_.\[\]]*' MainProgram_Program.L5X | sort -u`) e definir o formato do config a partir do observado (documentar no teste). Path `Local:2:I.Ch00.Data` deve resolver no TagDb.
- [ ] Step 2: implementar (UDT sintético aninhado por módulo — reusar datatypes.UdtDef); LoadError se rotina referencia módulo não declarado (a validação de tags do load já pega — confirmar mensagem inclui o nome do módulo).
- [ ] Step 3: PASS; commit `feat(logix): módulos de I/O com members declarados no perfil (Local:2 analógico)`.

---

### Task 3: MainProgram + jobdata carregam (aceitação parcial da Fase 2)

**Files:** Modify `profiles/iris-03007/profile.json` · `profiles/iris-03007/l5x/missing-tags.json` (append) · Test append em `tests/test_controller.py`

- [ ] Step 1: teste `test_load_real_full_program`: carregar MainProgram_Program.L5X + jobdata/*.L5X (UDTs v2 com `udt_overrides=["UDT_GM_Com_In","UDT_WS_Com","UDT_StationJob"]` — StationJob só existe no v2, incluir por segurança) + Servo_Program + R030/R031/R003 + ambos CSVs + `jsr_appends`/`rung_edits`/`fbd_excluded=["R002_Scale","R100_PID_R1",...,"R105_PID_R6"]` + módulos (`AnyBusComm`, `Local:2`, e o que o grep da Task 2 revelar) → load OK + 50 scans sem fault com `GMSim_Enable=0`.
- [ ] Step 2: rodar e iterar como na F0: instruções RLL faltantes (MainProgram tem 33+ rungs do Willer — esperar ONS/TON/CTU?/OTL etc. já cobertos; implementar o que faltar com mini-teste), tags faltantes → append em missing-tags.json com evidência. PIDs/`R002_Scale` excluídos: as tags que ELES escreveriam (temperaturas, saídas PID) entram como poke-áveis — listar no profile (`fbd_owned_tags`) se referenciadas por rotinas ativas.
- [ ] Step 3: PASS; commit `feat(profile): MainProgram completo + jobdata v2 carregam e escaneiam (50 scans)`.

---

### Task 4: planta de linha (`plant/line.py`)

**Files:** Create `sim_core/plant/line.py` · `profiles/iris-03007/line.json` · Test `tests/test_line_plant.py`

**Interfaces (produz):**
```python
@dataclass
class Car:
    vid: int; style: int; pos_mm: float; options: list[int] = field(default_factory=lambda: [0]*8)

class LinePlant:
    def __init__(self, cfg: dict, clock: SimClock): ...
    # cfg (line.json): {"length_mm": 12000, "b01_mm": 2000, "b02_mm": 9000,
    #   "sensor_width_mm": 300, "tags": {"b01": "DI_Barreira_01", "b02": "DI_Barreira_02",
    #   "line_running": "GMSim_LineRunning", "long_speed": "GMSim_LongSpeed"}}
    def spawn_car(self, vid, style, options=None) -> Car   # entra em pos 0
    def step(self, db) -> None
    # lê line_running/long_speed (mm/s) do db; avança carros; escreve b01/b02
    # (TRUE enquanto um carro cobre a janela do sensor); remove carro em length_mm
    @property
    def cars(self) -> list[Car]
```
Regras: velocidade = `long_speed` mm/s se `line_running` else 0; barreira ativa se ∃ carro com `|pos - b_mm| < sensor_width/2`. Nomes de tag 100% do config (perfil ≠ engine).

- [ ] Step 1: testes falhando — spawn+avanço com line_running; parada com line_running=0; pulso B01 (sobe quando carro chega, cai quando passa); dois carros; remoção no fim; nomes de tag vindos do cfg (teste com nomes fake ≠ DI_Barreira).
- [ ] Step 2: implementar (~70 linhas); Step 3: PASS; commit `feat(plant): LinePlant — conveyor, carros, barreiras por config`.
- [ ] Step 4: integrar na `SimSession`: se `line.json` existe no perfil, instanciar; ordem do tick vira `line.step(db)` → `iomap.load_inputs` → `scan` → `flush_outputs` → `drives.step` → `clock.tick`. Teste de integração: spawn → B01 pulsa → (com GMSim_Enable=1 e Job0.Valid=1) R020 avança e `WS.PVI == VID`. Commit `feat(session): LinePlant no tick + integração B01→R020`.

---

### Task 5: invariantes (`scenarios/invariants.py`)

**Files:** Create `sim_core/scenarios/invariants.py`, `sim_core/scenarios/__init__.py` · Test `tests/test_invariants.py`

**Interfaces (produz):**
```python
@dataclass
class Violation:
    invariant: str; t_ms: int; detail: str

class Invariant:  # base
    id: str; contract_ref: str
    def check(self, sim) -> str | None   # None = ok; str = detalhe da violação

REGISTRY: dict[str, type[Invariant]]

class InvariantMonitor:
    def __init__(self, ids: list[str], sim): ...  # id desconhecido = ValueError listando válidos
    def on_tick(self, sim) -> None                 # acumula .violations
    violations: list[Violation]
```
Invariantes da Fase 2 (lastreados no programa carregado):
- `boot-never-moves` (§1.3): até o 1º comando de usuário (arm interno: nenhum WSCmd_* ≠ 0 poked ainda — o monitor recebe eventos de poke do runner), toda velocidade de drive == 0.
- `hb-timeout-2s` (§1.3/R006): se `GM_In.Heartbeat` ficou estático por > `GMHb_TimeoutScans` scans ⇒ `StTimeoutCommGM` deve ser 1 (e vice-versa com histerese de ±2 scans — tolerância documentada).
- `valid-gate-jobdata` (§1.3/R020): se `WS.PVI` mudou para valor ≠ 0 neste tick, então no tick da mudança `GM_In.Station[0].Valid == 1` (jamais latch sem Valid).
- `no-fault` (guard genérico): `controller.faulted == False`.

- [ ] Step 1: testes falhando por invariante (cenários mínimos sintéticos onde a violação ocorre e onde não ocorre — para `valid-gate-jobdata`, poke direto em WS.PVI simula o bug); id desconhecido → ValueError.
- [ ] Step 2: implementar; Step 3: PASS; commit `feat(scenarios): invariantes nomeados do contrato (boot/hb/valid-gate/no-fault)`.

---

### Task 6: DSL YAML + runner (`scenarios/dsl.py`, `scenarios/runner.py`)

**Files:** Create `sim_core/scenarios/dsl.py`, `sim_core/scenarios/runner.py` · Test `tests/test_scenario_dsl.py`

**Formato (spec §5, aterrado na Fase 2 — sem `cmd:` que é Fase 3/HIL):**
```yaml
name: jobdata-flui-com-valid
profile: iris-03007
duration: 20s
invariants: [no-fault, valid-gate-jobdata, hb-timeout-2s]
setup:
  pokes: {GMSim_Enable: 1, GMSim_LineRunning: 1, GMSim_LongSpeed: 100.0, R010_MIRROR: 1}
timeline:
  - at: 1s
    poke: {GMSim_Job0.Valid: 1, GMSim_Job0.VID: 12345, GMSim_Job0.Style: 7}
  - at: 2s
    spawn_car: {vid: 12345, style: 7}
expect:
  - after: 2s          # avaliado do instante em diante, com timeout no fim da duration
    tag: {path: WS.PVI, equals: 12345}
  - at_end:
    tag: {path: WS_Queue_Job[0].Style, equals: 7}
```
**Interfaces:** `load_scenario(path) -> Scenario` (dataclasses; erro agregado de schema com caminho YAML); `run_scenario(sc, profile_root) -> ScenarioResult(passed, violations, failures, trace_summary)`. Runner: monta SimSession, aplica setup, executa timeline por tempo simulado, `on_tick` = invariantes, avalia expects (`after` = polling até deadline; `at_end` = no fim). `equals`/`approx+tol`/`nonzero`.

- [ ] Step 1: testes falhando — parse válido/ inválido (campo desconhecido → erro com path), runner num cenário sintético mínimo (perfil de teste pequeno, não o iris), expect timeout → failure com valor observado, invariante violada → reportada.
- [ ] Step 2: implementar; Step 3: PASS; commit `feat(scenarios): DSL YAML + runner com expects e invariantes`.

---

### Task 7: suite de cenários da linha (aceitação da Fase 2)

**Files:** Create `profiles/iris-03007/scenarios/*.yaml` (5 cenários) · `tests/regression/test_line_scenarios.py` (coletor)

Cenários (reproduzem a validação de bancada do README jobdata + contrato):
1. `jobdata-flui-com-valid.yaml` — o exemplo acima; expects: WS.PVI=VID, WS.Style, WS_Queue_Job[0] completo, `GM_Out.PVI_ACK` latcheado.
2. `jobdata-nao-latcha-sem-valid.yaml` — Job0.Valid=0 → carro passa B01 → `WS.PVI` permanece 0 durante toda a duration.
3. `heartbeat-timeout.yaml` — GMSim_Enable=1 por 5 s, depois 0 → em ≤2,2 s `StTimeoutCommGM=1`; religa → após 4 beats volta a 0 (se o programa implementar recovery — senão expect só a ida e documentar).
4. `publish-estacoes.yaml` — Job1/Job2 populados → `WS.Station[1].VID`/`[2].VID` refletem via R052.
5. `boot-parado.yaml` — 3 s sem comandos, invariantes `boot-never-moves` + `no-fault`; barreiras limpas.
- Coletor: `@pytest.mark.parametrize` sobre `profiles/iris-03007/scenarios/*.yaml` → `run_scenario` → assert `result.passed` com relatório de violações/failures no assert message.

- [ ] Step 1: escrever os 5 YAML + coletor → rodar → iterar divergências (regra da F1: mínimo reproduzível decide se é bug nosso ou comportamento do programa; comportamento real inesperado = documentar no YAML e no report — candidato a achado).
- [ ] Step 2: suite completa verde; commit `feat(scenarios): suite de linha iris-03007 (5 cenários, aceitação Fase 2)`.

---

### Task 8: fechamento Fase 2

**Files:** `README.md` (repo), changelog JARVIS, merge

- [ ] Step 1: README — seção Fase 2 (o que roda, como rodar um cenário avulso: `python -m sim_core.scenarios.runner profiles/iris-03007 scenarios/x.yaml` — adicionar `__main__` trivial no runner), tabela de fases atualizada; qualquer achado novo da Task 7 na seção de achados.
- [ ] Step 2: suite inteira verde; merge `feat/phase2` → `master` (ff ou merge commit) + push; changelog entry (JARVIS, não commitar JARVIS — controller faz).

## Self-Review

1. **Cobertura spec §4-5 (Fase 2)**: conveyor/carro/CarPresent ✓ (T4); GM-side ✓ via R090 real (T3) — produced/consumed adiado c/ justificativa YAGNI documentada; DSL poke/expect/invariants ✓ (T5-6); `cmd:` do canal Redis = Fase 3 (fora, anotado); invariantes com ID de contrato ✓ (T5).
2. **Placeholders**: nenhum TBD; T2/T3 têm steps de descoberta com instrução de fixação (padrão validado na F0-1).
3. **Consistência**: `jsr_appends/rung_edits/udt_overrides` definidos em T1 e consumidos em T3; `LinePlant.step(db)` consome nomes de line.json (T4) e a SimSession orquestra; `InvariantMonitor.on_tick(sim)` (T5) é o hook que o runner (T6) usa.
