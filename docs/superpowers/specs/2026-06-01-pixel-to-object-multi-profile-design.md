# pixel-to-object — serviço multi-profile (body + sealer)

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-06-01
**Projetos atendidos:** 03007 IRIS GM SCDS Paint (body) · 03002 ArcelorMittal TL1 (body, em produção) · 03008 Hyundai Piracicaba (sealer)
**Supersede:** `2026-05-13-iris-03-pixel-to-object-design.md` (IRIS-03 vira o profile `body` deste serviço)
**Branch base:** `feat/kalman-filter` (não merged em master).
**Dev:** William (único).
**ClickUp:**
- [3.3] IRIS-03 (`868jk1hru`) — deploy do profile `body`.
- [4.11] SEALER 2D inference (`868jk0n99`) — produz boxes que alimentam este serviço no profile `sealer`.
- [4.9] SEALER provisioning CLI (`868jk0n1e`) — gera calibração/config consumida por este serviço.

**Deadline interno crítico:** **09/06** para o profile `body` em produção (IRIS GM). Profile `sealer` segue cronograma do 03008 (demo Q3).

---

## 1. Goal

Um único serviço `visionking/services/pixel-to-object` que atende dois produtos via **profile**:

- **`body`** — VK Body (IRIS GM SCDS, deploys Stellantis e Arcelor já em produção). Consome boxes 2D da inferência (`risco`, `mancha`, etc.) sobre carrocerias inteiras; projeta cada box em 3D no mesh do corpo; usa tracking 3D + Kalman + Hungarian para deduplicar entre frames; agrega no fim da sequência.
- **`sealer`** — VK SEALER 03008 Hyundai. Consome detecções 2D **per-frame** vindas de uma inference centerline-driven (sampling de janelas quadradas ao longo da centerline 3D projetada no frame). Cada detecção já chega **taggeada upstream** com `(bead_id, segment_idx)` derivado do ponto-âncora da janela (e `bead_name` para log), e carrega a posição corrigida da linha de centro `(u', v')` em pixel coords do frame. O pixel-to-object raycasta `(u', v')` no mesh da carroceria → `(x', y', z')`, mantém a tag, e usa o **prior por segmento** como **cutoff ∞** no Hungarian (`bead_id` é o key principal). Não há stitching, e o serviço **não carrega centerline 3D** (a projeção 3D→pixel acontece upstream no point-cloud-processor).

A consolidação rompe com a abordagem inicial de "serviço SEALER separado" e elimina a tentativa de stitching para cordões: cada frame entra com sua pose, o tracking 3D + bead/segment prior responde pelo desambigua entre observações. A projeção do centerline para coords de frame é responsabilidade upstream (ver §7.5).

O serviço **não toca em imagens** (PNG vai por rota dedicada `camera-acquisition → Redis → image-saver → disco`). Recebe apenas boxes + metadados.

## 2. Scope

**In:**
- Profile mechanism `VK_PROFILE=body|sealer` (env var build-time/deploy — Alternativa A das specs SEALER, por consistência com `VR_PROFILE=steel|sealer` no `sealer-result`).
- Núcleo comum reaproveitado integral da `feat/kalman-filter`: `SequenceManager`, `VelocityKalmanFilter`, `DefectTrackManager` (Kalman 3D + Hungarian), `DefectAggregator`, `transformer.py` (2D→3D raycast com pose composta).
- Profile `body`: pass-through `scan_started_at`, integração contrato IRIS-02 (`scan_started_at`, `camera_current_position` com axis positions), 1 instância para 4 câmeras, calibração via `calibration_app.py`, deploy IRIS na infra Strokmatic-side.
- Profile `sealer`: parsing dos campos novos do envelope (`bead_name`, `segment_idx`, `centerline_uv_observed`, `width_mm`) + **prior cutoff** no `DefectTrackManager`. Raycast usa `(u', v')` em vez do centro da box.
- Smoke E2E para os dois profiles com câmeras mock (boxes sintéticas + payload sealer sintético).

**Out (rejeitado ou deferido):**
- **Carregamento de `sealer_centerline.json` no pixel-to-object** — a centerline é processada upstream (point-cloud-processor projeta 3D→(u,v) per-frame; inference usa para sampling). Tag e `(u',v')` chegam prontos.
- **Fusão cross-câmera** em qualquer profile — desambigua no banco (body: `peca=PVI`; sealer: análogo).
- **Stitching de RGB** no profile sealer — substituído por per-frame inference + agregação no `pixel-to-object`. Esta decisão é o gatilho da consolidação.
- **Detecção de ausência por segmento** — pixel-to-object só processa `presence=true`. Auditoria de cobertura (segmentos sem detecção em N frames consecutivos) é consumer separado downstream.
- **Refactor da `feat/kalman-filter`** — usamos como está; profile hooks são adições isoladas.
- **`scan_started_at` ativo** (modelo cinemático Δt) — pass-through em ambos os profiles.
- **Validação Blender** — atividade paralela; quando arrancar, especifica artefato separado.
- **Mudança de schema do DB** — leitura/escrita continuam pelos serviços downstream (`database-writer` no body, `sealer-result` no sealer).

## 3. Arquitetura geral

```
                ┌─────────────────────────────────────────────┐
                │   Producers (profile-specific upstream)      │
                │                                              │
                │   body:    4× camera-acquisition (IRIS-02)   │
                │            → 2D inference (boxes)            │
                │   sealer:  N× camera-acquisition             │
                │            → point-cloud-processor           │
                │              (per-frame centerline projection│
                │               → (u,v) + px/mm + tags)        │
                │            → 2D inference centerline-driven  │
                │              (sliding-window sampling)       │
                └────────────────────┬─────────────────────────┘
                                     │
                                     ▼
                ┌─────────────────────────────────────────────┐
                │   RabbitMQ — input queue                     │
                │   body:    {boxes, peca/PVI, camera_id,      │
                │             axis positions, scan_started_at} │
                │   sealer:  {detections[], peca/PVI,          │
                │             camera_id, axis positions,       │
                │             scan_started_at}                 │
                │   sealer detection = {bead_id, bead_name,    │
                │             segment_idx, presence,           │
                │             centerline_uv_observed,          │
                │             width_mm, lateral_offset_px}     │
                └────────────────────┬─────────────────────────┘
                                     │
                                     ▼
            ┌────────────────────────────────────────────────────┐
            │  pixel-to-object  (VK_PROFILE=body|sealer)          │
            │                                                     │
            │  server.py                                          │
            │    ↓                                                │
            │  SequenceManager (chave (part_uuid, camera_id))     │
            │    ↓                                                │
            │  transformer.py (raycast 2D→3D em pose composta)    │
            │    body:   project_box_to_3d(box, pose)             │
            │    sealer: project_to_3d(centerline_uv_observed,    │
            │                          pose) — só se presence=T   │
            │    ↓                                                │
            │  VelocityKalmanFilter (1D drift, ambos profiles)    │
            │    ↓                                                │
            │  DefectTrackManager                                 │
            │    └─ cost matrix: Mahalanobis 3D                   │
            │       └─[sealer]→ cutoff ∞ se bead/segment difere   │
            │    ↓                                                │
            │  DefectAggregator (no fim da sequência)             │
            └────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────────────┐
                │   RabbitMQ — output queue                    │
                │   tracks confirmados c/ pose 3D, métricas    │
                │   e (sealer) bead_id + bead_name +           │
                │   segment_idx + width_mm pass-through        │
                └────────────────────┬─────────────────────────┘
                                     │
                                     ▼
                ┌─────────────────────────────────────────────┐
                │   Downstream (profile-specific)              │
                │                                              │
                │   body:    database-writer → vk_iris_03007   │
                │   sealer:  sealer-result → Postgres B-light  │
                └─────────────────────────────────────────────┘
```

**Pontos-chave da arquitetura:**
- O **núcleo** (SequenceManager, Velocity, TrackManager, Aggregator) é literalmente o mesmo código entre profiles. As diferenças vivem em (a) `transformer.py` — profile sealer usa `(u', v')` em vez do centro da box; (b) `DefectTrackManager.cost_matrix` — `if cfg.use_bead_segment_prior: aplicar cutoff`. Tag bead/segment **chega na mensagem** (não é computada aqui).
- Profile mechanism por **env var** (Alternativa A das specs SEALER): código carregado é o mesmo, mas branches gated por `VK_PROFILE`. Sem builds separados — é Python, não Angular.
- **Imagem (PNG) nunca passa por aqui.** Vale para os dois profiles.
- Sem comunicação cross-câmera. Cada câmera é uma sequência independente; desambigua no banco.
- **Sealer não carrega centerline 3D.** A projeção `(x,y,z) → (u,v)` per-frame e o cálculo de px/mm acontecem no upstream (point-cloud-processor). O pixel-to-object só reverte: `(u', v') → (x', y', z')` via raycast no mesh.

## 4. Profile mechanism

Env var **`VK_PROFILE`** em `{body, sealer}`, validada no `server.py` na inicialização. Resolve um dict de feature flags + parâmetros no `config.py`:

```python
# config.py (novo)
PROFILES = {
    'body': ProfileConfig(
        use_bead_segment_prior=False,
        scan_started_at_passthrough=True,
        sequence_key=('part_uuid', 'camera_id'),
        # ... defaults Kalman/Aggregator iguais ao deploy-stellantis
    ),
    'sealer': ProfileConfig(
        use_bead_segment_prior=True,
        scan_started_at_passthrough=True,
        sequence_key=('part_uuid', 'camera_id'),
        skip_absence_detections=True,  # presence=false não vira track
        # ... defaults Kalman/Aggregator tunados p/ cordões (menor SEQUENCE_TIMEOUT_S, etc.)
    ),
}
```

Branches no código:

```python
# transformer.py
def project_to_3d(uv: tuple[float, float], pose, mesh):
    """Primitive: raycast a single (u,v) point → 3D."""
    return raycast(uv, pose, mesh)  # → (p3d, normal, face_id)

def project_box_to_3d(box, pose, mesh):
    """Body profile: raycast box center."""
    return project_to_3d(center(box), pose, mesh)

# server.py — per detection
if cfg.profile == 'sealer':
    if not detection.presence and cfg.skip_absence_detections:
        continue  # absence handled by separate downstream auditor
    p3d, normal, face_id = project_to_3d(detection.centerline_uv_observed, pose, mesh)
    det3d = Detection3D(
        position=p3d,
        bead_id=detection.bead_id,
        bead_name=detection.bead_name,
        segment_idx=detection.segment_idx,
        width_mm=detection.width_mm,
    )
else:  # body
    p3d, normal, face_id = project_box_to_3d(detection.box, pose, mesh)
    det3d = Detection3D(position=p3d, class_name=detection.class_name, ...)

# defect_track_manager.py
def _compute_cost(self, track, detection):
    if self.cfg.use_bead_segment_prior:
        if track.bead_id != detection.bead_id:            return math.inf
        if track.segment_idx != detection.segment_idx:    return math.inf
    return mahalanobis(track.predicted_pos, detection.position, track.cov)
```

**Por que cutoff duro (∞), não penalty soft:** o tag bead/segment vem de **projeção geométrica determinística upstream** (centerline 3D CAD → (u,v) via intrínsicos+extrínsicos do frame → sampling-window âncora → tag herdado por construção). Não é saída de modelo ML; não tem incerteza calibrada. Penalty soft introduziria um knob arbitrário sem ganho.

**Track herda tag do primeiro hit:** `track.bead_id, track.bead_name, track.segment_idx = first_detection.bead_id, first_detection.bead_name, first_detection.segment_idx` no momento da criação da track tentativa. É a invariante load-bearing pro cutoff funcionar.

## 5. Logic walkthrough — sequência de processamento

Estrutura paralela à IRIS-03 §4, parametrizada por profile.

### 5.1 Os passos do ciclo (profile-agnostic)

```
TRIGGER (carroceria entra)
      ↓
[1] camera-acquisition gera scan_started_at na borda de subida
      ↓
[2] Câmeras capturam frames a F fps; cada um sai com
    {boxes, part_uuid, camera_id, axis_positions, scan_started_at}
      ↓
[3] RabbitMQ entrega ao pixel-to-object (1 instância para N câmeras)
      ↓
[4] SequenceManager.localize_or_create(part_uuid, camera_id)
      ↓
[5] Frame entra no buffer; espera SEQUENCE_REORDER_WINDOW_S (~2s)
      ↓
[6] Para cada frame "maduro":
    6.a  VelocityKalmanFilter ajusta drift 1D
    6.b  body:   transformer.project_box_to_3d(box, pose) → Detection3D
         sealer: skip if presence=false;
                 transformer.project_to_3d(centerline_uv_observed, pose)
                 → Detection3D já carrega bead/segment do envelope
    6.c  DefectTrackManager:
         - predict (Kalman 3D)
         - data association (Mahalanobis + Hungarian)
           └─[sealer] cutoff ∞ se bead/segment difere
         - tentative → confirmed (N hits)
         - lost → descarted (M misses)
      ↓
[7] Fim de sequência: timeout T  OU  sinal explícito (Part_Presence cai)
      ↓
[8] DefectAggregator: para cada track CONFIRMED, emite mensagem
    com pose 3D + métricas + [sealer] bead_name + segment_idx
      ↓
[9] Downstream consome (database-writer / sealer-result)
```

### 5.2 Decisões não-óbvias

(Idênticas à IRIS-03 §4.2 — válidas para os dois profiles. Adições marcadas `[sealer]`.)

| Decisão | Por que |
|---|---|
| **Sequências paralelas por câmera no SequenceManager** | Cinemática, calibração e drift por câmera. Junção downstream pelo banco. |
| **Reorder window adiciona latência de propósito** | Kalman assume causalidade; ordem dos frames é mais valiosa que latência apertada. |
| **Tracking persistente vs detecção isolada** | Mesmo defeito em N frames; o tracking filtra transientes, refina posição e reporta 1-por-1. |
| **Agregação só no fim da sequência** | Decisão tentativo/confirmado precisa do final da varredura. |
| **Kalman 3D + Hungarian** | Câmeras se movem; posição observada de um defeito estático varia. Mahalanobis ≠ euclidiana. |
| **`scan_started_at` pass-through** | Persistir abre 3 portas (correlação externa, cinemática futura, sincronização). Zero esforço. |
| **Composição de pose (calibração × axis positions)** | Calibração 1× fora da peça; pose efetiva no frame é composta a cada mensagem. |
| **1 instância para N câmeras** | Estado já isolado por chave; escala horizontal sem reorganizar tópico. |
| **PNG não passa pelo serviço** | Boxes chegam, decisões saem. Imagem segue rota dedicada. |
| **[sealer] Prior bead/segment como cutoff ∞, não penalty** | Tag vem de geometria determinística upstream; soft introduz knob arbitrário sem ganho. |
| **[sealer] Per-frame inference em vez de stitch** | Stitch RGB de cordões com sobreposição variável e geometria complexa estava dando erro acumulado; tracking 3D + prior por segmento absorve a redundância sem precisar costurar imagem. |
| **[sealer] Tag bead/segment computada upstream, não aqui** | O sampling da inference é **centerline-driven** (janelas quadradas em torno de pontos da centerline projetada). Cada janela está vinculada por construção a um (bead, segment_idx). Recomputar aqui (loading centerline + KDTree) seria duplicação cara — usar a tag que já chega é zero esforço. |

### 5.3 O que pode dar errado (e onde olhar)

- **Frames sumindo no meio da varredura** → buffer do SequenceContext + logs RabbitMQ.
- **Defeitos duplicados em câmeras vizinhas** → esperado; trata downstream.
- **Track persiste depois da peça sair** → `SEQUENCE_TIMEOUT_S` mal calibrado.
- **Posição 3D fora do mesh** → calibração extrínseca desviada; hot-reload via Redis.
- **[sealer] Tag bead/segment ausente quando deveria estar presente** → bug upstream na inference (sampling não estava centerline-driven, ou o tag não está sendo populado no envelope). Investigar do lado de fora.
- **[sealer] Cordões paralelos sendo associados** → cutoff ∞ deveria bloquear; se vazando, ou (i) tag errado vindo upstream, ou (ii) `track.bead_name`/`track.segment_idx` não sendo herdados do primeiro hit (regressão de código).
- **[sealer] `(u', v')` projetando fora do mesh** → raycast retorna miss; descartar detecção e logar. Pode ser pose desalinhada (`factory_calibration.json` desatualizado) ou inference reportando ponto em região não coberta pelo mesh.

## 6. Profile `body` — IRIS-03 e correlatos

Conteúdo herdado integral da spec IRIS-03 (2026-05-13). Resumo do diff vs `feat/kalman-filter`:

- **Pass-through `scan_started_at`** em `server.py` + `defect_aggregator._build_defect_message`. Persistido no `SequenceContext`.
- **Contrato de mensagem IRIS-02** validado: `camera_current_position` como dict de axis positions (`axis_1`, `axis_2`, `axis_3a`, `axis_3b`). Catálogo `ponto_iris.json` precisa publicar exatamente esses nomes.
- **Calibração extrínseca das 4 câmeras IR** via `calibration_app.py` (Streamlit ArUco). Hot-reload via Redis (`ConfigManager`).
- **Deploy**: 1 instância para as 4 câmeras na infra Strokmatic-side (host TBD, adjacente ao `.189`).
- **Compose**: `REDIS_*`, `RABBITMQ_*`, `MIN_DETECTION_RATE`, `MIN_QUALITY_SCORE`, `SEQUENCE_REORDER_WINDOW_S`, `SEQUENCE_TIMEOUT_S`. Valores iniciais = defaults deploy-stellantis.
- **`VK_PROFILE=body`** no compose.

(Para detalhes finos do contrato, ver §5.1–5.4 da spec antiga — esta seção é o equivalente colapsado.)

## 7. Profile `sealer` — 03008 Hyundai

### 7.1 Diferenças funcionais

- **Detecções per-frame centerline-driven** chegam taggeadas com `(bead_name, segment_idx)` e a posição corrigida `(u', v')` da linha de centro localizada dentro da janela. Não há stitching de RGB.
- **Raycast usa `(u', v')`**, não o centro de uma bbox. O `transformer.project_to_3d` é uma primitiva nova (extração do que já é feito hoje); `project_box_to_3d` (body) passa a ser wrapper que chama `project_to_3d(center(box))`.
- **`presence=false` é skip.** Detecções "ausência" são contabilizadas por um auditor downstream (fora desta spec); o pixel-to-object processa só presença.
- **Hungarian com cutoff ∞** — implementado em `DefectTrackManager._compute_cost` (§4). Tag herdada do primeiro hit da track.
- **Pass-through de `width_mm`** (e qualquer outro métrico per-detecção vindo upstream) no envelope de saída — o pixel-to-object não recalcula, só agrega/medianiza ao longo da sequência se relevante.
- **`SEQUENCE_TIMEOUT_S` menor** — varredura sealer é mais curta que body GM. Default proposto: 30 s (ajuste no comissionamento).
- **Downstream** = `sealer-result` (não `database-writer`). Mensagens carregam `bead_name` + `segment_idx` + `position_3d_mm` (a `(x', y', z')` real) + `width_mm` + métricas Kalman. O cálculo do **desvio lateral em mm** (= distância da `(x', y', z')` medida ao ponto-âncora esperado do centerline em CAD) fica para o consumer downstream que tem o `sealer_centerline.json` carregado.

### 7.2 Contrato de mensagem de entrada (sealer)

Produzida upstream pela inference centerline-driven (ver `2026-XX-XX-sealer-2d-inference-per-frame-design.md`, a ser escrita — substituirá [4.11]).

```json
{
  "frame_uuid": "...",
  "part_uuid": "<peca/PVI>",
  "camera_id": "1",
  "frame_captured_at": "2026-...",
  "scan_started_at": "2026-...",
  "frame_current_position": "...",
  "camera_current_position": {"axis_1": ..., "axis_2": ...},
  "frame_info": {"camera_movement_axes": {...}, "object_movement_axis": [...]},
  "detections": [
    {
      "bead_id": 1,
      "bead_name": "longarina_esq",
      "segment_idx": 12,
      "presence": true,
      "anchor_uv": [u_anchor, v_anchor],
      "centerline_uv_observed": [u_prime, v_prime],
      "width_mm": 8.2,
      "lateral_offset_px": 3.0,
      "confidence": 0.92
    },
    {
      "bead_id": 1,
      "bead_name": "longarina_esq",
      "segment_idx": 13,
      "presence": false,
      "anchor_uv": [u_anchor, v_anchor],
      "confidence": 0.88
    }
  ]
}
```

O pixel-to-object **só processa** `presence=true`. Os `presence=false` ficam no envelope para um auditor downstream que verifica cobertura.

### 7.3 Centerline 3D — onde vive

`sealer_centerline.json` (schema definido em `2026-05-06-sealer-03-sealer-bead-measurement-design.md` §3.3, com `expected_height_mm` adicionado em 2026-06-01) é a SSOT de geometria de cordão. **Não é carregada por este serviço.** Os consumers que precisam dela são:

- **point-cloud-processor** — projeta os pontos 3D em `(u, v)` per-frame + calcula px/mm por ponto, alimenta a fila da inference. Ver SEALER-01 spec (a atualizar — etapa nova).
- **inference sealer** — usa a sequência `(u, v, px/mm, bead, segment_idx)` para sampling de janelas quadradas. Ver `2026-XX-XX-sealer-2d-inference-per-frame-design.md` (a escrever — substitui [4.11]).
- **sealer-result** (downstream do pixel-to-object) — usa para calcular desvio lateral em mm e comparar com `expected_width_mm`/`expected_height_mm`.

### 7.4 Mudanças necessárias no profile `sealer`

- **`transformer.py`**: extrair `project_to_3d(uv, pose, mesh)` como primitiva; `project_box_to_3d` vira wrapper. ~10 LoC.
- **`server.py`** (parsing): aceitar envelope sealer com array `detections`; iterar; pular `presence=false`; para cada `presence=true`, construir `Detection3D` carregando `bead_id`, `bead_name`, `segment_idx`, `width_mm` do envelope. ~25 LoC.
- **`defect_track_manager.py`**:
  - Cutoff no `_compute_cost`: `if track.bead_id != det.bead_id or track.segment_idx != det.segment_idx: return math.inf` (compara `bead_id` int, não `bead_name`). ~5 LoC.
  - Herança no construtor da track tentativa: `track.bead_id, track.bead_name, track.segment_idx = first_detection.bead_id, first_detection.bead_name, first_detection.segment_idx`. ~3 LoC.
- **`defect_aggregator.py`**: propagar `bead_id`, `bead_name`, `segment_idx`, `width_mm` (median or last) no `_build_defect_message`. ~5 LoC.
- **`config.py`** (novo): definição dos `PROFILES` (§4). ~30 LoC.
- **`server.py`** (boot): leitura de `VK_PROFILE`. ~5 LoC.

**Total: ~80 LoC** — drasticamente menor que a versão anterior do spec (~250 LoC com `CenterlineProjector` interno). Trade-off: o trabalho saiu daqui, mas precisa existir upstream (no point-cloud-processor + inference).

### 7.5 Acoplamentos

- **camera-acquisition sealer (Hyundai)** publica frames com axis positions + scan_started_at, mesmo contrato do body.
- **point-cloud-processor sealer (SEALER-01)** ganha responsabilidade nova: por frame, projetar `sealer_centerline.json` (3D CAD-mm) → `(u, v)` em pixel coords desse frame, computar px/mm por ponto, alimentar a fila de inference. Ver atualização da SEALER-01 spec (próximo passo do roadmap).
- **inference sealer** (substitui [4.11]) consome o envelope com sequência `(u, v, px/mm, bead, segment_idx)` por frame, faz sampling de janelas quadradas, detecta presença e calcula `centerline_uv_observed`. Ver nova spec (próximo passo do roadmap).
- **sealer-result** consome a saída do pixel-to-object. Contrato downstream alinhado pela `sealer-db-schema-design`.

## 8. Critérios de aceite

### 8.1 Comuns aos dois profiles

| # | Critério | Como verificar |
|---|---|---|
| 1 | `VK_PROFILE=body|sealer` valida na inicialização; valor inválido → boot falha com mensagem clara | unit test + smoke |
| 2 | Núcleo (SequenceManager, Velocity, TrackManager, Aggregator) executa idêntico nos dois profiles para a mesma entrada sem hooks ativos | regression test com `use_bead_segment_prior=False` em entradas sealer |
| 3 | `scan_started_at` propagado da entrada à saída em ambos os profiles | smoke E2E |
| 4 | Hot-reload de `factory_calibration.json` via Redis sem restart (ambos profiles) | mudar no Redis, observar logs |

### 8.2 Profile `body` (= critérios IRIS-03 originais)

| # | Critério | Como verificar |
|---|---|---|
| 5 | 1 instância para 4 câmeras IR em paralelo no IRIS | log + `get_active_sequence_count() ≥ 1` |
| 6 | 4 sequências independentes por PVI (`(PVI, cam_id)`) | inspeção de estado |
| 7 | `position_3d` em coordenadas body frame, validável visualmente | overlay/viewer |
| 8 | 4 streams agregados chegam ao `database-writer`, consolidados por `peca=PVI` | SQL no `vk_iris_03007` |
| 9 | Performance: 4×50 fps ≈ 200 fps de input sem perda > 1% em 1 h | drop counter |

### 8.3 Profile `sealer`

| # | Critério | Como verificar |
|---|---|---|
| 10 | Envelope sealer com `detections[]` parseado; `presence=false` ignorado; `presence=true` raycastado em `(u', v')` | unit test do parser + transformer |
| 11 | Hungarian rejeita association entre track e detecção de `bead_id` diferentes (cutoff ∞) | unit test do `_compute_cost` |
| 12 | Hungarian rejeita association entre segmentos diferentes do mesmo `bead_id` | unit test |
| 13 | Track tentativa herda `bead_id`/`bead_name`/`segment_idx` da primeira detecção | unit test do construtor |
| 14 | Cenário cordões paralelos sintéticos: 2 cordões (Y=+25, Y=-25), defeitos isolados em cada um, tracks **não cruzam** mesmo quando Mahalanobis 3D pura associaria errado | scenario test com pose + detections fabricadas |
| 15 | Saída carrega `bead_id` + `bead_name` + `segment_idx` + `width_mm` por defeito agregado | smoke E2E |

## 9. Pendências (não bloqueiam a spec)

1. **Merge `feat/kalman-filter` → master** — operacional. Decisão de timing fica com Vinicius (ideal: antes do deploy IRIS-03).
2. **Spec da inference sealer per-frame** — substitui [4.11]. Define o envelope `detections[]` que esta spec consome.
3. **Spec da etapa per-frame projection no point-cloud-processor (SEALER-01)** — define como `(u, v)` + px/mm + tags são produzidos por frame.
4. **Auditor de cobertura segmento-a-segmento** — consumer separado que lê os `presence=false` (no envelope upstream, antes do pixel-to-object) e flagra segmentos sem detecção em N frames consecutivos. Spec separada quando o desenho do sealer-result amadurecer.
5. **Cálculo de desvio lateral em mm** — fica no `sealer-result` ou no banco (procedure), com acesso ao `sealer_centerline.json`. Não é responsabilidade do pixel-to-object.
6. **Interface com `sdk-blender-tools`** — quando arrancar (validação Blender de cobertura/pipeline 3D), spec separada.
7. **Tuning Kalman/Aggregator por profile** — `MIN_DETECTION_RATE`, `MIN_QUALITY_SCORE`, gains 3D. Bench separado.
8. **Latência fim a fim** — replicar horizontalmente se gargalo, não separar por câmera.
9. **Compatibilidade com IRIS-05** — o profile `body` continua publicando o mesmo payload que o `database-writer` espera; `bead_name`/`segment_idx` ausentes não devem quebrar o consumer.

## 10. Cronograma (escopo + risco)

Spec consolidada implica trabalho extra em cima do escopo IRIS-03 original. **William é o único dev**, então as fases são serializadas:

- **Fase 1 (até 09/06)** — Profile scaffolding + profile `body` em produção (IRIS-03).
  - Risco: 09/06 era o deadline IRIS-03 isolado. Adicionar profile scaffolding consome ~1.5 dias. **Slip esperado: 2–3 dias** (mid-junho). Aceitável se Vinicius/Joshua estiverem na malha.
- **Fase 2 (jun)** — Profile `sealer`: parsing do envelope, hooks no transformer/track manager/aggregator, scenario tests, smoke E2E. Fase mais leve do que a versão anterior (sem `CenterlineProjector` interno).
- **Fase 3 (Q3, comissionamento Hyundai)** — Tuning + integração sealer-result + bench final. Depende da inference sealer per-frame estar pronta.

## 11. Próximos passos

1. **User review** desta spec.
2. Atualizar o plan (`docs/superpowers/plans/2026-06-01-pixel-to-object-multi-profile.md`) — remover Track C.1 (`CenterlineProjector`), enxugar C.2.
3. Escrever **nova spec da inference sealer per-frame** (substitui [4.11]).
4. Atualizar **SEALER-01 (point-cloud-processor)** com a etapa per-frame projection.
5. Confirmar o contrato de mensagem `detections[]` com William antes da implementação.
6. Agendar merge `feat/kalman-filter` → master.
