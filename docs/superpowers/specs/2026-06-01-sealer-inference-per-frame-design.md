# vk-inference profile `sealer-per-frame` — design spec

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-06-01
**Project:** 03008 Hyundai Piracicaba — SEALER
**Backlog:** SEALER-2D-INFERENCE (substitui o spec antigo)
**Supersede:** `2026-05-06-sealer-2d-inference-design.md` (stitched.png + YOLO-only + runtime ROI derivation).
**Repo:** `visionking/services/inference`
**Profile env:** `INF_PROFILE=sealer-per-frame`
**Dev:** William (mesmo único dev do bloco pixel-to-object).
**Specs irmãs:**
- `2026-06-01-pixel-to-object-multi-profile-design.md` — consumer da saída deste serviço.
- `2026-04-13-sealer-01-point-cloud-processor-design.md` — producer da entrada (precisa ser estendido com a etapa de per-frame centerline projection — passo 3 do roadmap (a)).
- `2026-05-06-sealer-03-sealer-bead-measurement-design.md` — SSOT do `sealer_centerline.json`.

---

## 1. Goal

Adaptar o serviço `vk-inference` para rodar inferência **por frame** sobre cordões de selante, usando **sampling centerline-driven**: o point-cloud-processor entrega a sequência de pontos da linha de centro **já projetada** em pixel coords (com px/mm por ponto e tag `(bead_name, segment_idx)`), e este serviço corta uma janela quadrada em torno de cada ponto e analisa o conteúdo.

**Decisão arquitetural chave:** o **método de análise** dentro de cada janela está em estudo (YOLO, HSV color thresholding, ou híbrido). O spec **não congela** o método. Congela apenas:
- O **contrato de entrada** (envelope do point-cloud-processor com `centerline_projected[]`).
- O **algoritmo de sampling** (janela quadrada centrada em cada ponto, lateralmente orientada pela tangente do cordão, com side derivado de `expected_width_mm × px_per_mm`).
- O **contrato de saída** (`detections[]` consumido pelo pixel-to-object).

Trocar de YOLO para HSV (ou vice-versa) altera apenas a implementação do `WindowAnalyzer` (§6); o resto do pipeline e os contratos não mudam.

## 2. Scope

**In:**
- Profile `sealer-per-frame` no `vk-inference`.
- Parser do envelope de entrada (frame image + `centerline_projected[]`).
- Loop de sampling de janela por ponto da centerline.
- Interface `WindowAnalyzer` + duas implementações iniciais:
  - `MockAnalyzer` — determinístico para testes.
  - **Uma** implementação de produção (YOLO **ou** HSV — decidir antes do comissionamento; spec deixa o slot aberto).
- Publisher do envelope de saída para o pixel-to-object.
- Tratamento de absence — janela analisada, `presence=false` emitido (com `confidence` do "negativo"), pixel-to-object filtra; auditor downstream usa.

**Out (rejeitado ou deferido):**
- **Carregar `sealer_centerline.json`** — não é feito aqui; a projeção 3D→(u,v) acontece no point-cloud-processor upstream.
- **Stitching** — eliminado por design (decisão da virada arquitetural 2026-06).
- **Medição de altura** (`height_mm`) — a partir da imagem RGB é difícil sem depth co-registrado; deferido. `expected_height_mm` é usado apenas para sizing de janela (§5), não medido.
- **Cálculo de desvio lateral em mm** — o envelope reporta `lateral_offset_px` (raw); a conversão para mm e a comparação com tolerância é responsabilidade do consumer downstream do pixel-to-object (sealer-result), que tem a centerline carregada.
- **Treinamento de modelo** — out of scope para qualquer rota (YOLO ou HSV); tracked em backlog separado (`SEALER-2D-MODEL-TRAINING` se rota YOLO; calibração de thresholds HSV é trivial e fica como tuning operacional).
- **DB write direto** — substitui o consumer do output: era result-writer-2d (deletado/realocado), agora é pixel-to-object.

## 3. Data flow

```
       camera-acquisition (Hikrobot)
              │
              ▼ raw frames (RGB) → image-saver → disco
              │
              ▼ frame meta msg
       point-cloud-processor (SEALER-01, profile sealer)
        │  - acumula frames por VIN
        │  - carrega sealer_centerline.json para o model_type
        │  - **por frame**: projeta centerline 3D → (u,v),
        │     filtra pontos in-FOV, calcula px/mm + tangente
        │
        ▼ frame message com centerline_projected[]
       RabbitMQ — sealer-inference-queue (NOVA)
              │
              ▼
       vk-inference (INF_PROFILE=sealer-per-frame)
        │  1. Parse envelope
        │  2. Load frame image (PIL/OpenCV)
        │  3. Para cada ponto em centerline_projected:
        │     - Crop janela quadrada centrada em (u,v),
        │       rotacionada para tangente horizontal
        │     - WindowAnalyzer.analyze(patch, ...) → WindowResult
        │  4. Construir detections[] (todas: presence true e false)
        │  5. Publish
        │
        ▼ frame message com detections[]
       RabbitMQ — sealer-detection-queue (NOVA)
              │
              ▼
       pixel-to-object (VK_PROFILE=sealer)
       — consome presence=true para tracking 3D
       — presence=false pass-through para auditor (futuro)
```

**Pontos-chave:**
- Mesma mensagem de frame trafega: o pixel-to-object precisa do mesmo `camera_current_position` + `frame_info` para fazer o raycast com a pose composta. Esses campos passam intactos da entrada para a saída.
- **Fila de entrada renomeada** (`sealer-inference-queue` em vez de `sealer-inference-queue`) para sinalizar a quebra de contrato com a versão antiga.

## 4. Input contract (FROZEN)

Produzido pelo point-cloud-processor. Uma mensagem por frame.

```json
{
  "frame_uuid": "uuid",
  "part_uuid": "uuid",
  "vin_number": "KMHXX00XXXX000001",
  "model_type": "CRETA_2026",
  "camera_serial_number": "HK3D001",
  "camera_id": "1",
  "frame_index": 12,
  "total_frames_hint": 20,

  "frame_image_path": "/img_saved/{part_uuid}/{cam}/frame_0012.png",

  "frame_captured_at": "2026-06-01T14:30:05.100Z",
  "scan_started_at": "2026-06-01T14:30:04.000Z",
  "frame_current_position": 520.0,
  "camera_current_position": {"axis_1": 520.0, ...},
  "frame_info": {
    "object_movement_axis": [-1.0, 0.0, 0.0],
    "camera_movement_axes": {"1": [0.0, 1.0, 0.0]}
  },

  "centerline_projected": [
    {
      "bead_id": 1,
      "bead_name": "longarina_esq",
      "segment_idx": 12,
      "u": 1234.5,
      "v": 456.7,
      "px_per_mm": 8.2,
      "tangent_uv": [0.97, -0.24],
      "expected_width_mm": 22.0,
      "expected_height_mm": 4.0
    }
  ]
}
```

Field semantics:

| Campo | Origem | Uso |
|---|---|---|
| `frame_image_path` | image-saver | imagem que o analyzer recebe |
| `frame_captured_at` / `scan_started_at` | camera-acquisition | pass-through para o pixel-to-object (mantém compatibilidade com o pipeline body) |
| `camera_current_position` / `frame_info` | camera-acquisition | pass-through; pixel-to-object usa para a pose composta no raycast |
| `centerline_projected[]` | point-cloud-processor (computa a partir do `sealer_centerline.json` + pose + intrínsicos+extrínsicos) | uma entrada por ponto sampleado da centerline 3D, **já filtrado para in-FOV** desta câmera neste frame |
| `centerline_projected[].u, .v` | ponto da centerline em pixel coords deste frame | centro da janela de sampling |
| `centerline_projected[].px_per_mm` | escala local pixel/mm naquele ponto | derivar tamanho da janela em modo `dynamic` (§5) e converter `width_px → width_mm` |
| `centerline_projected[].tangent_uv` | vetor unitário tangente à centerline projetada naquele ponto | **hint** opcional para o analyzer (mede largura perpendicular à tangente sem precisar de PCA). A janela **não** é rotacionada para alinhar à tangente — patches saem axis-aligned (§5). |
| `centerline_projected[].expected_width_mm` / `expected_height_mm` | echo dos campos do `sealer_centerline.json` por bead | sizing da janela em modo `dynamic`; método de análise pode usar como prior |
| `centerline_projected[].bead_id` / `bead_name` / `segment_idx` | echo do `sealer_centerline.json` + arclength acumulado | tag pass-through para o output. `bead_id` é o key load-bearing; `bead_name` é debug/log |

**Invariantes** que o point-cloud-processor garante:
- `px_per_mm > 0` (pontos com escala degenerada são filtrados upstream).
- `tangent_uv` é unitário (quando presente; pode ser omitido se irrelevante para o analyzer escolhido).
- `bead_id` é estável dentro de `model_type` (consistente entre runs).
- Pontos fora dos bounds da imagem (depois do crop bbox calculada com `side_px`) **não aparecem** no array — o point-cloud-processor os descarta.

## 5. Sampling algorithm (FROZEN, method-independent)

Patches são **axis-aligned** (sem rotação tangente-horizontal). Justificativa em §5.3.

Para cada ponto `p` em `centerline_projected`:

1. **Compute window side (pixels)** — controlado por env var `INF_SEALER_WINDOW_MODE`:
   - **`fixed`** (recomendado para HSV): `side_px = INF_SEALER_WINDOW_SIDE_PX` (env, default `128`). Mesmo tamanho independente do `px_per_mm` local. Bom quando o método de análise não precisa de escala física consistente (color thresholding).
   - **`dynamic`**: `side_mm = K × max(p.expected_width_mm, p.expected_height_mm)`; `side_px = round(side_mm × p.px_per_mm)`. `K` em `INF_SEALER_WINDOW_MARGIN_FACTOR` (default `2.5`). Bom quando o método precisa que a escala física seja constante dentro do patch (alguns YOLOs sem augmentation forte de escala).

2. **Crop axis-aligned** centrado em `(p.u, p.v)` com lado `side_px`:
   ```
   u_min = round(p.u - side_px/2);  u_max = u_min + side_px
   v_min = round(p.v - side_px/2);  v_max = v_min + side_px
   patch = image[v_min:v_max, u_min:u_max]
   ```

3. **Reject** patches que (a) caem total ou parcialmente fora da imagem (point-cloud-processor já filtra, mas defensive check); (b) `side_px < INF_SEALER_MIN_WINDOW_SIDE_PX` (env, default `32`) — escala muito ruim em modo dynamic, descarta.

4. **`WindowAnalyzer.analyze(patch, anchor_uv=(p.u, p.v), px_per_mm=p.px_per_mm, tangent_uv=p.tangent_uv, expected_width_mm=p.expected_width_mm, expected_height_mm=p.expected_height_mm)`** → `WindowResult`.

5. **Construir a detection** (§7) usando o `WindowResult` + a tag `(bead_id, bead_name, segment_idx)` do ponto-âncora.

### 5.1 Coordenadas do patch e conversão para o frame

O analyzer trabalha em **coords do patch** (origem em `(0,0)` no canto superior-esquerdo, eixos paralelos aos do frame). Retorna `centerline_offset_patch_px = (dx, dy)` com origem **no centro do patch**.

Conversão para coords globais do frame (sem rotação):
```
u' = p.u + dx
v' = p.v + dy
```

### 5.2 Largura sem rotação

Como o patch é axis-aligned, a largura medida em pixels pelo analyzer **não é diretamente a largura perpendicular ao cordão**. O analyzer tem 3 opções (escolha do método, não do spec):

- **Usar `tangent_uv` como hint** — projetar a forma detectada perpendicularmente à tangente e medir aí. Mais preciso.
- **PCA do blob** (HSV) — eixo maior do blob ≈ direção do cordão; eixo menor = largura. Independe de `tangent_uv`.
- **Ignorar e reportar diâmetro equivalente** — `width_px = √(area_blob / π)` ou similar. Aproximação grosseira.

O `width_mm` no output (§7) é `width_px × px_per_mm` regardless. A semântica exata (perpendicular a quê) é responsabilidade do analyzer escolhido e fica documentada na sua implementação.

### 5.3 Por que axis-aligned (vs tangente-horizontal)

Trade-offs avaliados; decisão = axis-aligned:

| Aspecto | Tangente-horizontal (rejeitado) | Axis-aligned (adotado) |
|---|---|---|
| Patch quality | warpAffine introduz blur leve por interpolação | pixels brutos, sem warp |
| Custo computacional | +1 warp por janela (~0.1 ms) | zero |
| Largura HSV | trivial (eixo vertical do blob = largura) | PCA do blob ou usa tangent_uv hint |
| Largura YOLO bbox | bbox alinha com cordão | bbox cresce se cordão a ≈45°; mitigado por OBB YOLO ou rotation augmentation no treino |
| Contrato upstream | `tangent_uv` obrigatório | `tangent_uv` opcional (hint) |
| Treinamento YOLO | menos rotation invariance a aprender | precisa de rotation augmentation (padrão, baixo custo) |

A simplicidade do contrato upstream e a ausência de warp ganham. HSV resolve naturalmente; YOLO treinado com augmentation cobre o caso. Se algum dia um analyzer específico precisar do patch rotacionado, ele faz internamente sem mexer no contrato.

## 6. Method abstraction — `WindowAnalyzer`

Interface que isola a escolha YOLO/HSV/futuro.

```python
@dataclass
class WindowResult:
    presence: bool
    # When presence=True:
    centerline_offset_patch_px: tuple[float, float] | None  # (dx, dy) in patch coords
    width_px: float | None                                  # observed width in pixels
    # Method-dependent semantics; for HSV: positive-class coverage ratio;
    # for YOLO: detection score; for absence: confidence in the NEGATIVE call.
    confidence: float

class WindowAnalyzer(Protocol):
    def analyze(
        self,
        patch: np.ndarray,                # (side_px, side_px, 3), axis-aligned
        anchor_uv: tuple[float, float],   # echo, for logging
        px_per_mm: float,
        tangent_uv: tuple[float, float] | None,  # hint; analyzer may ignore
        expected_width_mm: float,
        expected_height_mm: float,
    ) -> WindowResult: ...
```

### 6.1 Implementations

| Implementation | Loader | Notes |
|---|---|---|
| `MockAnalyzer` | none | Deterministic by `hash(anchor_uv) → presence`. Tests only. |
| `YoloAnalyzer` | ONNX/OpenVINO via `onnxruntime` | Model trained on labeled patches (bead present/absent + center localization). Bbox center → `centerline_offset_patch_px`; bbox width → `width_px`. **Out-of-scope:** training. |
| `HsvAnalyzer` | none (algorithmic) | HSV thresholding for sealer color (3 calibrated ranges per cliente, Redis-configurable). Largest blob → presence; blob centroid → `centerline_offset_patch_px`; major-axis length perpendicular to tangent → `width_px`; coverage ratio → `confidence`. |

Selecionado via env `INF_SEALER_ANALYZER=yolo|hsv|mock`. **A escolha não bloqueia o spec.** Pode mudar entre staging e produção sem mudar contrato de saída.

### 6.2 Latência

Per-window latency varia drasticamente com o método:

| Method | Latência típica (CPU) | N janelas/frame "típico" | Latência por frame |
|---|---|---|---|
| `HsvAnalyzer` | < 1 ms | ~20–60 (filtrado in-FOV) | < 100 ms |
| `YoloAnalyzer` (sm INT8, OpenVINO) | 30–80 ms | ~20–60 | 0.6–5 s |
| `MockAnalyzer` | < 0.1 ms | — | trivial |

YOLO pode ficar marginal para 50 fps × N câmeras. Se a escolha cair em YOLO, será necessário pelo menos um destes mitigators (fora do escopo deste spec): (a) reduzir N via amostragem esparsa da centerline; (b) batched inference; (c) GPU; (d) replicação horizontal do serviço.

## 7. Output contract (FROZEN)

Uma mensagem por frame, consumida pelo pixel-to-object (`sealer-detection-queue`). **Este é o congelamento que protege o pixel-to-object de mudanças no método.**

```json
{
  "frame_uuid": "uuid",
  "part_uuid": "uuid",
  "vin_number": "KMHXX00XXXX000001",
  "model_type": "CRETA_2026",
  "camera_serial_number": "HK3D001",
  "camera_id": "1",
  "frame_index": 12,

  "frame_captured_at": "2026-06-01T14:30:05.100Z",
  "scan_started_at": "2026-06-01T14:30:04.000Z",
  "frame_current_position": 520.0,
  "camera_current_position": {"axis_1": 520.0, ...},
  "frame_info": {
    "object_movement_axis": [-1.0, 0.0, 0.0],
    "camera_movement_axes": {"1": [0.0, 1.0, 0.0]}
  },

  "analyzer": "hsv",
  "inferred_at": "2026-06-01T14:30:05.250Z",

  "detections": [
    {
      "bead_id": 1,
      "bead_name": "longarina_esq",
      "segment_idx": 12,
      "presence": true,

      "anchor_uv": [1234.5, 456.7],
      "centerline_uv_observed": [1235.1, 459.2],
      "width_mm": 21.3,
      "lateral_offset_px": 2.8,

      "confidence": 0.94
    },
    {
      "bead_id": 1,
      "bead_name": "longarina_esq",
      "segment_idx": 13,
      "presence": false,

      "anchor_uv": [1295.0, 460.1],
      "centerline_uv_observed": null,
      "width_mm": null,
      "lateral_offset_px": null,

      "confidence": 0.91
    }
  ]
}
```

### 7.1 Field-by-field

**Frame envelope (pass-through):**

| Campo | Required | Notes |
|---|---|---|
| `frame_uuid`, `part_uuid`, `vin_number`, `model_type`, `camera_serial_number`, `camera_id`, `frame_index` | yes | identificação do frame; pass-through |
| `frame_captured_at`, `scan_started_at` | yes | pass-through; pixel-to-object usa para SequenceManager |
| `frame_current_position`, `camera_current_position`, `frame_info` | yes | pass-through; pixel-to-object usa para compor a pose no raycast |
| `analyzer` | yes | `"yolo" | "hsv" | "mock"` — observabilidade; pixel-to-object não age sobre isso |
| `inferred_at` | yes | timestamp da inferência (debug) |

**Per detection (FROZEN):**

| Campo | Required | Type | Semântica |
|---|---|---|---|
| `bead_id` | yes | int | Pass-through do input. Identificador estável do cordão (load-bearing key — pixel-to-object usa para cutoff no Hungarian). |
| `bead_name` | yes | str | Pass-through do input. Nome legível do cordão; debug/log only. |
| `segment_idx` | yes | int | Pass-through do input. Indexa o ponto-âncora ao longo da centerline daquele bead. |
| `presence` | yes | bool | `true` se o analyzer detectou cordão na janela; `false` caso contrário. |
| `anchor_uv` | yes | `[float, float]` | Echo do `(u, v)` do ponto-âncora. Debug/audit. |
| `centerline_uv_observed` | when `presence=true` (required); `null` quando `false` | `[float, float] | null` | Posição da linha de centro **localizada dentro da janela**, em coords globais do frame. Para pixel-to-object: é isto que vira o input do raycast 2D→3D. |
| `width_mm` | when `presence=true` (required); `null` quando `false` | `float | null` | Largura medida do cordão em mm. Pass-through para o pixel-to-object, agregado lá. |
| `lateral_offset_px` | optional; útil quando `presence=true` | `float | null` | Deslocamento perpendicular à tangente em pixel coords (deslocamento lateral do bead detectado em relação ao ponto-âncora). Computado pelo analyzer usando `tangent_uv` como hint, ou null se o analyzer não suportar. Debug; pixel-to-object não usa diretamente. |
| `confidence` | yes | float `[0,1]` | Confiança do analyzer na decisão. Semântica depende do método (§6.1) mas é monotônica: maior = mais confiança no veredito (positivo ou negativo). |

### 7.2 Por que esses campos e não outros

- **`bead_id` + `bead_name` + `segment_idx` são pass-through** — garantem que a tag sobreviva intacta até o pixel-to-object, eliminando ambiguidade entre cordões paralelos. `bead_id` é o key principal (int comparison no cutoff Hungarian); `bead_name` é só humano.
- **`centerline_uv_observed` é a peça nova** — é o que permite ao pixel-to-object back-projetar a posição **real** (não a esperada) e calcular desvio em 3D downstream.
- **`width_mm` já em mm** (não pixels) — o analyzer tem `px_per_mm` local; entregar pixel obrigaria o consumer a refazer a conta sem conhecimento de qual ponto-âncora.
- **`lateral_offset_px` em pixel** (cru) — debug only; conversão para mm requer reasoning sobre tangente 3D e fica downstream.
- **`anchor_uv` echoed** — permite ao auditor de cobertura (consumer separado) reconciliar com o `centerline_projected[]` do input sem refazer a projeção.

### 7.3 Versionamento

Adicionar campos NOVOS ao envelope ou às detections é OK e backwards-compatible (pixel-to-object ignora extras). **Mudar a semântica** de qualquer campo nesta tabela é breaking — precisa de bump explícito (campo `schema_version`) e coordenação com pixel-to-object.

Por enquanto não há `schema_version` — adiciona quando a primeira evolução chegar.

## 8. Profile module layout

```
services/inference/src/profiles/sealer_per_frame/
├── __init__.py
├── consumer.py            # sealer-inference-queue handler
├── envelope_parser.py     # Pydantic models para input/output
├── sampler.py             # crop axis-aligned de janela quadrada per centerline point
├── analyzers/
│   ├── __init__.py
│   ├── base.py            # WindowAnalyzer Protocol + WindowResult dataclass
│   ├── mock.py            # MockAnalyzer
│   ├── yolo.py            # YoloAnalyzer (slot opcional; carrega ONNX)
│   └── hsv.py             # HsvAnalyzer (slot opcional; thresholds em Redis)
├── publisher.py           # sealer-detection-queue publisher
└── models.py              # Pydantic do envelope output
```

`vk-inference.py` (entry) registra o novo profile via `INF_PROFILE=sealer-per-frame`.

## 9. Configuration

### 9.1 Env vars

| Var | Default | Descrição |
|---|---|---|
| `INF_PROFILE` | (deploy) | `sealer-per-frame` ativa este profile |
| `INF_RABBIT_INPUT_QUEUE` | `sealer-inference-queue` | fila de entrada (mesmo nome do desenho antigo; contrato é novo) |
| `INF_RABBIT_OUTPUT_QUEUE` | `sealer-detection-queue` | nova fila, consumida pelo pixel-to-object |
| `INF_SEALER_ANALYZER` | `mock` | `yolo` ou `hsv` para produção |
| `INF_SEALER_WINDOW_MODE` | `fixed` | `fixed` (usa `INF_SEALER_WINDOW_SIDE_PX`) ou `dynamic` (deriva do `expected_*_mm × px_per_mm`) |
| `INF_SEALER_WINDOW_SIDE_PX` | `128` | tamanho fixo do patch quando `WINDOW_MODE=fixed` |
| `INF_SEALER_WINDOW_MARGIN_FACTOR` | `2.5` | `K` em `side_mm = K × max(expected_width, expected_height)` quando `WINDOW_MODE=dynamic` |
| `INF_SEALER_MIN_WINDOW_SIDE_PX` | `32` | rejeita patches degenerados |
| `INF_SEALER_YOLO_MODEL_PATH` | `/models/sealer_window_yolov11s.onnx` | só se analyzer=yolo |
| `INF_SEALER_YOLO_EXECUTION_PROVIDER` | `openvino` | OpenVINO EP |
| `INF_SEALER_HSV_RANGES_REDIS_KEY` | `sealer:hsv_ranges` | Redis key com array de ranges HSV |

### 9.2 Redis DB3 tunables

| Field | Default | Descrição |
|---|---|---|
| `sealer_yolo_confidence_threshold` | `0.5` | só se analyzer=yolo |
| `sealer_hsv_coverage_threshold` | `0.15` | min coverage ratio em pixels para presence=true (HSV) |
| `sealer_hsv_ranges` | (Redis key separada) | lista de `[h_lo, s_lo, v_lo, h_hi, s_hi, v_hi]` calibradas por cliente |

## 10. Error handling

| Cenário | Ação |
|---|---|
| `frame_image_path` ausente no disco | NACK → DLX (image-saver falhou) |
| `centerline_projected[]` vazio | Publica detections=[] e ACK. Pode acontecer legitimamente em frames de início/fim de varredura. Log info. |
| `centerline_projected` com `px_per_mm <= 0` | Filtra ponto, log warning. Não deveria acontecer (point-cloud-processor filtra). |
| Patch fora de bounds da imagem | Filtra ponto, log warning. Defensive. |
| `INF_SEALER_ANALYZER=yolo` mas modelo missing | Boot fails fast |
| Analyzer levanta exceção | NACK com requeue=True; após N retries → DLX |
| Output publish fails | Retry 3× exponential backoff → DLX |

Sem upstream registration guard: este serviço **não depende** de `cad_registration.converged` porque não vai mais consumir o stitched cloud — a projeção da centerline acontece upstream e já chega validada (point-cloud-processor faz seu próprio guard antes de publicar).

## 11. Resource budget

Depende fortemente do analyzer:

| Analyzer | Memória | CPU | Latência por frame |
|---|---|---|---|
| `MockAnalyzer` | 256 MB | 0.5 cores | <50 ms |
| `HsvAnalyzer` | 512 MB | 1.0 cores | <200 ms |
| `YoloAnalyzer` | 2 GB | 2.0 cores (OpenVINO) | 0.6–5 s (ver §6.2) |

Throughput target: depende da taxa de captura. Para 4 câmeras × 50 fps = 200 frames/s, HSV passa folgado, YOLO precisa escalar horizontalmente ou downsamplear centerline.

## 12. Out of scope

- Treinamento de modelo YOLO (se rota for YOLO) — backlog separado.
- Calibração de thresholds HSV em campo — operacional, não código.
- Medição de altura do cordão a partir da imagem — RGB only é difícil; deferido. Se necessário no futuro, alimentação com depth co-registrado.
- Cálculo de desvio lateral em mm — downstream (sealer-result).
- Auditor de cobertura (segmentos sem `presence=true` em N frames) — consumer separado downstream.
- Performance benchmarks formais — Phase de comissionamento.

## 13. Acceptance criteria

| # | Critério | Como verificar |
|---|---|---|
| 1 | Profile `sealer-per-frame` carrega ao boot com `INF_PROFILE` setado | smoke |
| 2 | Parser do envelope de entrada rejeita mensagens sem `centerline_projected` ou `frame_image_path` | unit test |
| 3 | Sampler em `WINDOW_MODE=fixed` produz patch de `INF_SEALER_WINDOW_SIDE_PX` independente de `px_per_mm` | unit test |
| 4 | Sampler em `WINDOW_MODE=dynamic` produz patch de `round(K × max(expected_w, expected_h) × px_per_mm)` | unit test |
| 5 | Patches são axis-aligned (sem warp/rotação) | unit test geométrico |
| 5 | `MockAnalyzer` produz detections determinísticas para o mesmo input | unit test |
| 6 | Output envelope contém **todos** os campos da §7.1 com os tipos corretos | unit test contra Pydantic schema |
| 7 | `presence=true` ⇒ `centerline_uv_observed`, `width_mm` non-null; `presence=false` ⇒ ambos null | unit test |
| 8 | Pass-through dos campos do envelope de frame (camera_current_position, scan_started_at, etc.) intacto | unit test do consumer + publisher |
| 9 | Smoke E2E: 1 frame sintético + `centerline_projected[]` de 10 pontos → 10 detections no output queue | scripted smoke |
| 10 | Latência E2E < 1s para 60 pontos com analyzer=hsv | bench smoke |

## 14. Pendências

1. **Escolha do analyzer de produção** — YOLO vs HSV vs híbrido. Decisão antes do comissionamento Hyundai. Critério: precisão observada em dados reais + latência ajustada à cadência do PLC.
2. **Spec da etapa de per-frame projection no SEALER-01** — input deste serviço depende dela. Próximo passo do roadmap (a).
3. **`schema_version` no envelope output** — adicionar quando a primeira evolução breaking chegar.
4. **HSV ranges por cliente** — calibração operacional, não código.
5. **Treinamento YOLO** — se for o caminho escolhido; backlog separado.
6. **Aproveitamento do `expected_height_mm`** — hoje só dimensiona a janela; um analyzer futuro pode usar como prior de medição se acoplado com depth.

## 15. References

- `2026-06-01-pixel-to-object-multi-profile-design.md` §7.2 — consumer contract (idêntico ao output desta spec).
- `2026-05-06-sealer-03-sealer-bead-measurement-design.md` §3.3 — schema `sealer_centerline.json` (com `expected_height_mm` adicionado em 2026-06-01).
- `2026-04-13-sealer-01-point-cloud-processor-design.md` — producer; precisa ser estendido para per-frame centerline projection (próximo passo).
- `2026-05-06-sealer-provisioning-cli-design.md` — CLI que produz o `sealer_centerline.json`.
- Existing `services/inference/` — pattern para adicionar profile novo.

## 16. Revision history

| Date | Author | Change |
|---|---|---|
| 2026-06-01 | Pedro Teruel (with Claude) | Substitui o spec 2026-05-06 (stitched.png + YOLO-only). Profile renomeado `sealer-2d` → `sealer-per-frame`. Input vira frame individual + `centerline_projected[]` já em pixel coords. Output **FROZEN** (§7) para isolar pixel-to-object da escolha de método (YOLO ou HSV). Fila de entrada mantém o nome `sealer-inference-queue` (contrato é novo); output `sealer-2d-result-queue` → `sealer-detection-queue`. Patches **axis-aligned** (sem rotação tangente-horizontal); `tangent_uv` vira hint opcional. Window size selecionável por env var (`fixed` em pixels vs `dynamic` derivado de `expected_*_mm × px_per_mm`). `bead_id` (int) adicionado como key load-bearing junto a `bead_name` (debug). |
