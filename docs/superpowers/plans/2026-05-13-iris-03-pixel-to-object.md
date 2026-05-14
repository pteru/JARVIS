# IRIS-03 pixel-to-object — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) ou `superpowers:executing-plans` para tocar este plano. Steps usam checkbox (`- [ ]`) para tracking.

**Goal:** Habilitar o serviço `visionking/services/pixel-to-object` para o IRIS GM SCDS Paint aproveitando a branch `feat/kalman-filter` (tracking 3D Kalman+Hungarian, sequence manager por `(part_uuid, camera_id)`, hot-reload de calibração). O grosso do trabalho **não é código** — é integração com o payload do IRIS-02, calibração das 4 câmeras IR, deploy single-instance e smoke test 4-stream. O único patch real é o pass-through de `scan_started_at`.

**Spec:** `docs/superpowers/specs/2026-05-13-iris-03-pixel-to-object-design.md`

**Tech stack:** Python 3.11+, pika (RabbitMQ), redis-py, opencv, numpy, scipy (Kalman + Hungarian), pydantic (validação de contrato). Testes: pytest. Deploy: Docker Compose.

**Worktree:**
- pixel-to-object: `/home/teruel/worktrees/pixel-to-object-iris03/` (NEW — branch `feat/iris-03` off `origin/feat/kalman-filter`, **não master**)

**Audiência:** software dev (Pedro/Claude) pareando com Vinicius para validação de eixos e calibração extrínseca.

**Track ordering:** Track A (worktree + baseline) precede tudo. Track B (pass-through) e Track C (validação de contrato) podem ser feitas em paralelo após A. Track D (calibração) é independente — procedimento, não código. Track E (deploy + smoke) depende de B+C. Track F (performance) depende de E. Track G é só documentação de pendências.

**Estimativa total:** ~5 dias efetivos. Maior parte é integração e bench, não desenvolvimento.

---

## Track A — Worktree + baseline

### Task A1: Criar worktree e validar baseline em `feat/kalman-filter`

**Files:**
- Worktree: `/home/teruel/worktrees/pixel-to-object-iris03/` (branch `feat/iris-03`)

- [ ] **Step 1: Criar worktree off `feat/kalman-filter`** (NÃO master)

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/visionking/services/pixel-to-object
git fetch origin
git worktree add /home/teruel/worktrees/pixel-to-object-iris03 -b feat/iris-03 origin/feat/kalman-filter
cd /home/teruel/worktrees/pixel-to-object-iris03
```

Expected: branch `feat/iris-03` criada a partir do tip de `feat/kalman-filter` (commit `b1c020d` ou superior).

- [ ] **Step 2: Setup venv + dependências**

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

- [ ] **Step 3: Rodar testes existentes — baseline verde**

```bash
pytest -q 2>&1 | tail -20
```

Expected: todos os testes da branch `feat/kalman-filter` passando. Se houver falha pré-existente, registrar como dívida (não bloqueia, mas anotar nos critérios de merge).

---

## Track B — Pass-through `scan_started_at` (TDD)

### Task B1: Teste falhando para propagação do campo

**Files:**
- Create: `tests/unit/test_scan_started_at_passthrough.py`

- [ ] **Step 1 (RED): Escrever teste antes do patch**

```python
# tests/unit/test_scan_started_at_passthrough.py
import pytest
from filtering.sequence_manager import SequenceManager
from filtering.defect_aggregator import DefectAggregator

def test_scan_started_at_stored_in_sequence_context():
    sm = SequenceManager()
    frame = {
        "part_uuid": "PVI_TEST_001",
        "camera_id": "1",
        "scan_started_at": "2026-05-13T10:00:00.000Z",
        # ... outros campos mínimos para add_frame
    }
    sm.add_frame(frame)
    ctx = sm.sequences[("PVI_TEST_001", "1")]
    assert ctx.scan_started_at == "2026-05-13T10:00:00.000Z"

def test_scan_started_at_identical_across_sequence_frames():
    sm = SequenceManager()
    ts = "2026-05-13T10:00:00.000Z"
    for i in range(5):
        sm.add_frame({"part_uuid": "PVI_X", "camera_id": "1",
                      "scan_started_at": ts, "frame_idx": i})
    ctx = sm.sequences[("PVI_X", "1")]
    assert ctx.scan_started_at == ts  # não muda no meio da varredura

def test_scan_started_at_present_in_aggregated_output():
    # End-to-end: roda agregação e checa que o campo aparece em _build_defect_message
    agg = DefectAggregator()
    msg = agg._build_defect_message(track=..., sequence_context=...)
    assert "scan_started_at" in msg
    assert msg["scan_started_at"] == "2026-05-13T10:00:00.000Z"
```

Expected: 3 testes falhando (`AttributeError` no `SequenceContext.scan_started_at`, campo ausente na saída).

### Task B2: Implementar pass-through mínimo

**Files:**
- Modify: `src/server.py` (parsing do envelope da mensagem)
- Modify: `src/filtering/sequence_manager.py` (armazenar em `SequenceContext`)
- Modify: `src/filtering/defect_aggregator.py` (`_build_defect_message`)

- [ ] **Step 1 (GREEN): `server.py` — parsing**

Adicionar `scan_started_at` à lista de campos extraídos do envelope JSON. Tratamento default: `frame.get("scan_started_at", "")` (string vazia se ausente — backward compat com Stellantis).

- [ ] **Step 2 (GREEN): `sequence_manager.py` — `SequenceContext`**

```python
# em SequenceContext.__init__ ou dataclass
self.scan_started_at: str = ""

# em SequenceManager.add_frame, na criação do contexto:
if not ctx.scan_started_at and frame.get("scan_started_at"):
    ctx.scan_started_at = frame["scan_started_at"]
```

Justificativa do `not ctx.scan_started_at`: primeira gravação vence; frames subsequentes da mesma sequência preservam o valor original (importante porque a borda de subida no `camera-acquisition` define `T_0` uma vez por varredura — IRIS-02 Track A).

- [ ] **Step 3 (GREEN): `defect_aggregator.py` — `_build_defect_message`**

```python
message["scan_started_at"] = sequence_context.scan_started_at
```

- [ ] **Step 4: Rodar testes — todos passam**

```bash
pytest tests/unit/test_scan_started_at_passthrough.py -v
```

- [ ] **Step 5: Regressão Stellantis** — rodar suite completa, garantir que payloads sem `scan_started_at` continuam funcionando (campo vira string vazia, não quebra).

---

## Track C — Validação de contrato de mensagem com IRIS-02

### Task C1: Schema pydantic para o payload de entrada

**Files:**
- Create: `src/utils/message_schema.py`
- Create: `tests/unit/test_message_schema.py`
- Create: `tests/fixtures/payload_iris.json`
- Create: `tests/fixtures/payload_stellantis_legacy.json`

**Rationale:** sem validação explícita, mudanças no contrato do `camera-acquisition` (IRIS-02) viram silent bugs (campo ausente vira `None`, projeção 3D dá NaN). Pydantic falha rápido com mensagem clara.

- [ ] **Step 1 (RED): Fixtures dos dois shapes**

`tests/fixtures/payload_iris.json` — shape IRIS conforme spec §5.2 (`camera_current_position` como dict com `axis_1`, `axis_2`, `axis_3a`, `axis_3b`; `scan_started_at` presente).

`tests/fixtures/payload_stellantis_legacy.json` — shape Stellantis atual (sem `scan_started_at`, `camera_current_position` no formato existente).

- [ ] **Step 2 (RED): Testes falhando**

```python
# tests/unit/test_message_schema.py
import json
from utils.message_schema import FramePayload

def test_iris_payload_parses():
    with open("tests/fixtures/payload_iris.json") as f:
        data = json.load(f)
    payload = FramePayload(**data)
    assert payload.scan_started_at != ""
    assert payload.camera_current_position["axis_1"] is not None

def test_stellantis_legacy_parses_with_optional_scan_started_at():
    with open("tests/fixtures/payload_stellantis_legacy.json") as f:
        data = json.load(f)
    payload = FramePayload(**data)
    assert payload.scan_started_at == ""  # default vazio, não falha
    assert len(payload.boxes) > 0

def test_missing_required_field_raises():
    with pytest.raises(ValidationError):
        FramePayload(camera_id="1")  # falta part_uuid, frame_uuid etc
```

Expected: ImportError no módulo `message_schema` (ainda não existe).

- [ ] **Step 3 (GREEN): Implementar `FramePayload`**

```python
# src/utils/message_schema.py
from pydantic import BaseModel, Field
from typing import Any

class Box(BaseModel):
    box: list[float]  # [x1, y1, x2, y2]
    confidence: float
    class_: str = Field(alias="class")

class FrameInfo(BaseModel):
    object_movement_axis: list[float]
    camera_movement_axes: dict[str, list[float]]

class FramePayload(BaseModel):
    camera_id: str
    frame_uuid: str
    part_uuid: str
    frame_captured_at: str
    scan_started_at: str = ""  # NEW — opcional para back-compat
    frame_current_position: str
    camera_current_position: dict[str, Any]
    frame_info: FrameInfo
    boxes: list[Box]

    class Config:
        extra = "allow"  # tolera campos extras sem quebrar
```

- [ ] **Step 4 (GREEN): Wire-up em `server.py`**

No callback de consumo do RabbitMQ, substituir parse manual por:

```python
payload = FramePayload(**json.loads(body))
# converter para dict downstream-compatible
frame = payload.model_dump(by_alias=True)
```

Tolerar `ValidationError` com log + ack (ou nack para DLQ — decisão operacional).

- [ ] **Step 5: Rodar testes — 3 passam, regressão suite verde.**

### Task C2: Cross-reference com IRIS-02 `ponto_iris.json`

**Owner:** Pedro (não há código a alterar — confirmação documental)

- [ ] **Step 1:** Ler `ponto_iris.json` produzido pela Task E1 do plan IRIS-02 (quando estiver pronto). Confirmar **exatos** nomes/estrutura:
  - `scan_started_at` (ISO 8601 UTC ms)
  - `camera_current_position` com chaves `axis_1`, `axis_2`, `axis_3a`, `axis_3b`
  - `frame_info.camera_movement_axes` com 4 entradas (uma por câmera/eixo móvel)

- [ ] **Step 2:** Se houver divergência de nome, **NÃO patch unilateral no `pixel-to-object`**. Levantar a divergência no canal IRIS e ajustar de um lado só (preferência: IRIS-02 ajusta, pois é upstream). Registrar decisão no spec.

- [ ] **Step 3:** Atualizar `tests/fixtures/payload_iris.json` para refletir o catálogo final. Re-rodar suite.

---

## Track D — Calibração das 4 câmeras IR (procedimento)

### Task D1: Documentar procedimento de calibração

**Files:**
- Create: `docs/iris-03-calibration-procedure.md`

**Rationale:** o `calibration_app.py` (Streamlit + ArUco) já está pronto na branch. Não precisa código. Precisa **procedimento documentado** para o time poder repetir em campo.

- [ ] **Step 1:** Documentar passos:
  1. Posicionar marker ArUco no body frame (referência absoluta da carroceria).
  2. Abrir `streamlit run src/calibration_app.py` na Workstation IRIS, apontando para Redis DB de config.
  3. Para cada uma das 4 câmeras IR:
     - Selecionar `camera_id` no UI.
     - Capturar 1 frame com marker visível.
     - Confirmar pose estimada (rvec/tvec) e salvar via botão "Save to Redis".
  4. Verificar persistência: `redis-cli -h <host> HGETALL camera:<id>:calibration` retorna `rvec` + `tvec`.
  5. Hot-reload: `ConfigManager` no `pixel-to-object` reidrata calibração no próximo frame sem restart — validável tocando timestamp do hash no Redis e observando log.

- [ ] **Step 2:** Documentar gotchas conhecidos:
  - Marker precisa estar **estático** durante captura (vibração estraga estimativa).
  - Iluminação IR adequada (N6/N15 são LWIR — marker tem que estar termicamente visível, não só ótico). Confirmar com Vinicius o tipo de marker (target térmico vs. ArUco impresso).
  - 1 sessão por câmera = 4 sessões totais.

### Task D2: Dry-run com 1 câmera fake

**Files:**
- Create: `tests/integration/test_calibration_hot_reload.py` (opcional — só se tempo permitir)

- [ ] **Step 1:** Mock Redis + injetar rvec/tvec sintéticos para câmera id="1". Iniciar `pixel-to-object`. Mudar valores no Redis. Validar que próxima projeção 3D usa os valores novos (sem restart).

- [ ] **Step 2:** Documentar resultado no `iris-03-calibration-procedure.md` como evidência do hot-reload funcionando.

> **Nota:** validação com hardware real fica para o bench (G3). Esta task valida o caminho de software.

---

## Track E — Deploy single-instance + smoke test 4-stream

### Task E1: Compose dev com 1 instância de `pixel-to-object`

**Files:**
- Create: `visionking-pixel-to-object-iris-dev.yml`

- [ ] **Step 1:** Baseado no compose stellantis existente, criar variante IRIS com 1 serviço apontando para:
  - RabbitMQ comum (mesmo broker do `camera-acquisition` IRIS)
  - Redis comum (DB config + DB de imagem se aplicável)
  - `INPUT_QUEUE`/`OUTPUT_QUEUE` = nomes IRIS-specific

```yaml
services:
  pixel-to-object:
    environment:
      REDIS_HOST: <host>
      REDIS_PORT: 6379
      REDIS_CONFIG_DB: 1
      RABBITMQ_HOST: <host>
      INPUT_QUEUE: iris_03_frames
      OUTPUT_QUEUE: iris_03_aggregated
      MIN_DETECTION_RATE: 0.5    # tuning inicial — bench ajusta
      MIN_QUALITY_SCORE: 0.6
      SEQUENCE_REORDER_WINDOW_S: 2.0
      SEQUENCE_TIMEOUT_S: 60      # GM cycle 54s + margem
```

- [ ] **Step 2:** `docker compose up pixel-to-object` sobe sem erro; log mostra "Connected to Rabbit + Redis, awaiting frames".

### Task E2: Smoke test 4-stream sintético

**Files:**
- Create: `tests/integration/smoke_test_4stream.py`
- Create: `tests/integration/fixtures/synthetic_frame_stream.json` (template de frame)

- [ ] **Step 1 (RED): Escrever smoke test antes de tudo**

```python
# tests/integration/smoke_test_4stream.py
# 1. Conecta em RabbitMQ (compose up)
# 2. Para PVI='PVI_SMOKE_001', publica em paralelo:
#    - 50 frames de camera_id="1"
#    - 50 frames de camera_id="2"
#    - 50 frames de camera_id="3"
#    - 50 frames de camera_id="4"
#    Todos com scan_started_at = "2026-05-13T10:00:00.000Z" (mesmo valor),
#    axis_positions variando em rampa simulando movimento,
#    bbox 2D em posições que projetadas geram cluster no mesh.
# 3. Aguarda SEQUENCE_TIMEOUT_S + 5s para forçar agregação.
# 4. Consome OUTPUT_QUEUE.
# 5. Asserts:
#    - Recebeu ≥ 4 mensagens agregadas
#    - Todas com part_uuid = "PVI_SMOKE_001"
#    - 4 camera_ids distintos representados
#    - scan_started_at idêntico em todas
#    - Nenhuma exception no log do container
```

Rodar antes do compose up → **FAIL esperado** (timeout, output queue vazia).

- [ ] **Step 2 (GREEN):** Subir compose + rodar smoke test → **PASS esperado**.

- [ ] **Step 3:** Validar 4 sequências concorrentes ativas durante a injeção (intermediário):

```python
# durante o teste, antes do timeout:
from filtering.sequence_manager import SequenceManager
# expor via endpoint debug ou ler estado interno
assert sm.get_active_sequence_count() >= 4
```

- [ ] **Step 4:** Cleanup — `docker compose down -v` limpa estado para próxima execução.

---

## Track F — Performance smoke test

### Task F1: Run de 1 hora a 200 fps agregado

**Files:**
- Create: `tests/integration/perf_test_4cam_1h.py`

- [ ] **Step 1:** Script que:
  - Publica 4 streams a 50 fps cada (200 fps total) por 60 min.
  - Cada PVI dura ~54s (ciclo GM), sequence inicia a cada 60s.
  - Total de PVIs no run: ~60.
  - Conta frames publicados vs. frames processados (via contador no log/Prometheus se houver, ou consumo da output queue).

- [ ] **Step 2:** **Critério de aceite #7:** drop rate < 1%.

```
frames_publicados = 4 * 50 * 3600 = 720.000
frames_aceitaveis_perdidos < 7.200
```

- [ ] **Step 3:** Latência p99 (frame publicado → aggregated emitido) registrada como baseline. Sem threshold rígido nesta fase — apenas estabelecer o número para futuras regressões.

- [ ] **Step 4:** Se falhar, **não consertar dentro deste plan**. Registrar como follow-up (G3 — tuning de bench). Recomendação operacional já está na spec §7: escalar horizontalmente, não separar por câmera.

---

## Track G — Pendências deferidas (não há tasks executáveis)

Apenas documentar. **Não bloqueiam o merge do IRIS-03.**

- [ ] **G1 — Merge `feat/kalman-filter` → master.** Decisão operacional (antes ou depois do IRIS-03 começar). Spec já assume a branch como base; merge é independente.
- [ ] **G2 — Interface com `sdk-blender-tools`** (cobertura de reflexão + cena virtual). Atividade paralela, especificação separada quando arrancar. Formato esperado de ground truth: 3D points + classes + poses calibradas.
- [ ] **G3 — Tuning Kalman/Aggregator** (`MIN_DETECTION_RATE`, `MIN_QUALITY_SCORE`, gains 3D). Fase de bench, não deste plan.
- [ ] **G4 — Fusão cross-câmera.** Se a TV mostrar defeitos duplicados em câmeras vizinhas além do que o `defeitos_agg` (trigger centroidal IRIS-05) resolve, escalar para spec separada. Spec atual §2 rejeita explicitamente esta versão.
- [ ] **G5 — Uso ativo de `scan_started_at`** (interpolação cinemática Δt-based, sincronização cross-câmera). Pass-through agora; hook futuro.

---

## Critérios de merge para a branch `feat/iris-03`

1. Track A completo: worktree criado off `feat/kalman-filter`, baseline de testes verde.
2. Track B completo: 3 testes novos passam, regressão Stellantis OK, `scan_started_at` end-to-end visível no payload agregado.
3. Track C completo: `FramePayload` pydantic valida ambos shapes (IRIS + Stellantis legacy); cross-reference com `ponto_iris.json` do IRIS-02 documentado e alinhado.
4. Track D completo: procedimento de calibração documentado; dry-run com 1 câmera fake demonstra hot-reload.
5. Track E completo: compose IRIS-dev sobe sem erro; `smoke_test_4stream.py` PASS (4 sequências concorrentes, `scan_started_at` propagado, 4 saídas agregadas distintas).
6. Track F completo: run de 1h, drop rate < 1%, p99 registrado como baseline.
7. Track G documentado — pendências registradas no ClickUp `[3.3]` como subtasks ou follow-ups, **sem bloquear merge**.

---

## Estimativa de esforço

| Track | Esforço efetivo | Bloqueador externo |
|---|---|---|
| A — Worktree + baseline | 0,5 dia | — |
| B — Pass-through `scan_started_at` | 0,5 dia (TDD, código mínimo) | — |
| C — Contrato pydantic + cross-ref IRIS-02 | 1 dia | IRIS-02 Track E (`ponto_iris.json`) |
| D — Calibração (procedimento + dry-run) | 1 dia | confirmação tipo de marker (Vinicius) |
| E — Deploy + smoke 4-stream | 1,5 dia | depende de B+C |
| F — Performance 1h | 0,5 dia | depende de E |
| G — Pendências documentadas | 0 (apenas registro) | — |

**Total efetivo:** ~5 dias de trabalho. O patch real (~Track B) é meia tarde; o resto é integração, calibração, deploy e bench.
