# IRIS-03 — pixel-to-object (ajustes 3D)

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-05-13
**Project:** 03007 IRIS GM SCDS Paint
**ClickUp:** [3.3] IRIS-03 spec (`868jk1hru`)
**Deadline interno:** 09/06 (spec → implementação → integração)

## 1. Goal

Habilitar o serviço `visionking/services/pixel-to-object` para operar no IRIS GM SCDS aproveitando o trabalho já feito na branch **`feat/kalman-filter`** (pendente de merge em master). Essa branch foi pensada como base unificada para IRIS e Stellantis (ambos são deploys do produto VK Body) e cobre a maioria do que IRIS precisa: tracking 3D Kalman+Hungarian, sequence manager por `(part_uuid, camera_id)`, hot-reload de calibração via Redis, agregação por sequência.

IRIS-03 é, na prática, **deploy + ajustes mínimos** sobre essa branch, mais a integração com o payload novo vindo do `camera-acquisition` (IRIS-02). Não há fusão cross-câmera nesta versão — cada câmera produz seu stream independente, e a junção das 4 vistas acontece no banco via `PVI` (igual ao padrão IRIS-05).

## 2. Scope

**In:**
- Instalar e configurar **uma única instância** de `pixel-to-object` (escalável por replicação se a carga exigir, não por separação física de câmeras). A instância processa mensagens das 4 câmeras IR Hikrobot via RabbitMQ.
- Adicionar suporte ao campo `scan_started_at` no payload (pass-through; não usado ativamente nessa versão).
- Verificar que o campo `camera_current_position` (já no contrato atual) recebe as posições de **todos os eixos da carroceria** vindas do `camera-acquisition` (axis positions individuais por eixo/câmera), compostas com a calibração inicial para obter pose final.
- Configurar deploy do `pixel-to-object` para o ambiente Strokmatic-side (host TBD, mesmo PC ou adjacente ao `.189` do IRIS-05).
- Calibração inicial das 4 câmeras IR (extrinsic) via app de calibração existente (`calibration_app.py`).
- Smoke test end-to-end com 4 streams sintéticos (1 câmera mock por canal).

**Out (rejeitado ou deferido):**
- **Fusão cross-câmera / voting** — cada câmera publica independente; junção downstream pelo `PVI`. Se a TV mostrar duplicação de defeitos próximos, primeiro tentamos resolver no `defeitos_agg` do banco (trigger centroidal existente) antes de implementar fusão no `pixel-to-object`.
- **Validação contra Blender** — atividade paralela, fora do IRIS-03. Envolve (i) validação de cobertura da reflexão e (ii) validação do `pixel-to-object` em cena virtual. Interfaces com Blender serão especificadas em artefato separado quando essa atividade arrancar.
- **Uso ativo do `scan_started_at` na interpolação** — apenas pass-through; uso ativo (modelo cinemático Δt-based) fica como hook futuro.
- **Refactor/reescrita de qualquer módulo da `feat/kalman-filter`** — usamos como está, só ajustes pontuais.
- **1 instância por câmera** (padrão `camera-acquisition`) — IRIS-03 usa 1 instância única para todas câmeras.

## 3. Architecture

```
                ┌──────────────────────────────────────┐
                │  4× camera-acquisition (IRIS-02)     │
                │  cam-1   cam-2   cam-3   cam-4       │
                └─────┬─────┬─────┬─────┬──────────────┘
                      │     │     │     │
                      ▼     ▼     ▼     ▼
                ┌──────────────────────────────────────┐
                │  RabbitMQ — input queue              │
                │  (frame messages with peca=PVI,      │
                │   axis positions, scan_started_at)   │
                └────────────────┬─────────────────────┘
                                 │
                                 ▼
            ┌────────────────────────────────────────────┐
            │  pixel-to-object (single instance)          │
            │                                             │
            │  server.py                                  │
            │    ↓                                        │
            │  SequenceManager                            │
            │    keyed by (part_uuid, camera_id)          │
            │    → 4 concurrent sequences for same PVI    │
            │    ↓                                        │
            │  transformer.py (2D→3D ray cast)            │
            │    uses camera_current_position (composed   │
            │    from axis positions + calibration)       │
            │    ↓                                        │
            │  VelocityKalmanFilter (1D drift correct)    │
            │    ↓                                        │
            │  DefectTrackManager (3D Kalman + Hungarian) │
            │    ↓                                        │
            │  DefectAggregator (per-sequence aggregation)│
            └────────────────────┬───────────────────────┘
                                 │
                                 ▼
                ┌──────────────────────────────────────┐
                │  RabbitMQ — output queue             │
                │  (4 aggregated defect streams, one   │
                │   per camera, all sharing PVI)       │
                └────────────────┬─────────────────────┘
                                 │
                                 ▼
                ┌──────────────────────────────────────┐
                │  database-writer (IRIS-05)           │
                │  → vk_iris_03007 on .189             │
                │  → insert_frames_pecas_v2 disambiguates│
                │    by peca=PVI                       │
                └──────────────────────────────────────┘
```

**Pontos-chave:**
- 4 sequências concorrentes por PVI no `SequenceManager` — `self.sequences[PVI][cam_id]`.
- Posição 3D final está em coordenadas absolutas (body frame, dependendo da calibração).
- Sem comunicação cross-sequência. Banco recebe 4× e desambigua por `peca=PVI`.
- `pixel-to-object` **não toca na imagem PNG** — rota da imagem é separada (`camera-acquisition → Redis → image-saver → disco`).

## 4. Logic walkthrough — sequência de processamento

Esta seção destrincha o fluxo desde o trigger HW do PLC até a TV de retrabalho, com foco nos pontos de decisão que não são óbvios para quem vê o serviço pela primeira vez. Audiência primária: Vinicius (engenharia automação) e qualquer dev que pegue o serviço sem contexto histórico.

### 4.1 Os 10 passos do ciclo de uma carroceria

```
TRIGGER HW (PLC)
      ↓
[1] camera-acquisition detecta borda de subida do Part_Presence
    → gera scan_started_at único; carrega-o em TODOS os frames da varredura
      ↓
[2] 4 câmeras capturam frames a 50 fps (HW trigger síncrono por câmera)
    → cada frame sai com {imagem, part_uuid=PVI, axis_positions, scan_started_at}
      ↓
[3] Mensagem chega ao pixel-to-object via RabbitMQ
    → 1 única instância recebe os 4 streams em paralelo
      ↓
[4] SequenceManager localiza ou cria contexto (part_uuid, camera_id)
    → 4 contextos concorrentes para o mesmo PVI
    → cada contexto tem SEU PRÓPRIO VelocityKalmanFilter + DefectTrackManager + buffer de frames
      ↓
[5] Frame entra no buffer com timestamp; espera "reorder window" (~2s)
    → garante processamento em ordem cronológica mesmo com jitter de rede
      ↓
[6] Para cada frame "maduro" (passou o reorder window):
      6.a  VelocityKalmanFilter ajusta drift 1D no eixo de movimento
      6.b  Transformer projeta cada bbox 2D → 3D no mesh da carroceria,
           usando pose calibrada COMPOSTA com axis_positions do frame
      6.c  DefectTrackManager:
             - predict step (Kalman 3D avança tracks existentes)
             - data association via Mahalanobis + Hungarian (detecção→track)
             - tracks tentativas → confirmadas (após N hits)
             - tracks lost → descartadas (após M misses)
      ↓
[7] Fim da sequência detectado:
    - timeout (sem frames novos por T segundos)  OU
    - sinal explícito de fim (Part_Presence cai)
      ↓
[8] DefectAggregator agrega APENAS tracks CONFIRMED:
    - filtra por detection_rate e quality_score
    - para cada track sobrevivente: posição 3D final Kalman-filtered
                                  + métricas (detection rate, gaps, confidence)
    - emite N mensagens (1 por defeito persistente) na fila de saída
      ↓
[9] database-writer consome → insert_frames_pecas_v2 desambigua por peca=PVI
    → 4 streams agregados se consolidam no banco vk_iris_03007 (.189)
      ↓
[10] TV de retrabalho:
     - PLC sinaliza PVI no Redis quando carroceria chega
     - frontend-iris faz query no backend-iris com (PVI, group_name)
     - mostra overlay dos defeitos da estação
```

### 4.2 Decisões não-óbvias (e o porquê)

| Decisão | Por que |
|---|---|
| **4 contextos paralelos no SequenceManager** (não 1 contexto cuidando das 4 câmeras juntas) | Cada câmera tem cinemática independente (móvel/estática), calibração extrínseca diferente, e modelo de drift próprio. Isolar evita interferência cruzada. A junção é feita downstream pelo PVI no banco — não dentro do pixel-to-object. |
| **Reorder window adiciona latência de propósito** | RabbitMQ/rede podem entregar frames fora de ordem. Processar fora de ordem confunde Kalman (que assume causalidade) e prejudica data association. O buffer paga ~2s de latência fixa em troca de consistência temporal. |
| **Tracking persistente em vez de cada detecção isolada** | O mesmo defeito aparece em múltiplos frames consecutivos. Tracking permite: (a) filtrar falsos positivos transientes do inferência; (b) refinar a posição 3D fundindo N observações; (c) reportar **1 defeito por defeito real**, não 30 detecções da mesma marca. |
| **Agregação só no fim da sequência** | Para decidir se uma track é real ou ruído precisa esperar a varredura inteira terminar. Streaming contínuo daria spam de defeitos tentativos que depois sumiriam. |
| **Kalman 3D + Hungarian para data association** | As câmeras se movem durante a varredura. Mesmo um defeito estático tem posição 3D "observada" diferente entre frames (porque a câmera mudou de pose). Kalman modela: posição real + dinâmica esperada + incerteza. Hungarian decide qual detecção do frame atual corresponde a qual track existente, com base em distância probabilística (não euclidiana pura). |
| **`scan_started_at` na mensagem mesmo sem uso ativo agora** | Persistir desde já abre 3 portas: (a) ferramentas externas correlacionam frames ao tempo absoluto da varredura; (b) interpolação cinemática futura usa como `T_0`; (c) fusão cross-câmera (se for necessária) tem base comum de sincronização. Zero esforço — só pass-through. |
| **Composição de pose (calibração + axis positions) em vez de pose absoluta no payload** | A calibração extrínseca é feita 1× (fora da carroceria, alinhada ao mesh). Durante a operação, a câmera se move pelos eixos. Compor a calibração com as `axis_positions` no instante do frame dá a pose efetiva sem ter que recalibrar a cada deslocamento. |
| **1 instância de pixel-to-object para 4 câmeras (não 1 por câmera)** | A carga não justifica separação (50 fps × 4 = 200 fps, ainda dentro do orçamento computacional). O `SequenceManager` já isola estado por câmera via chave `(part_uuid, camera_id)`. Se aparecer gargalo, escala-se replicando a instância (horizontal scaling), não separando por câmera. |
| **Imagem PNG NÃO passa pelo pixel-to-object** | A rota da imagem é `camera-acquisition → Redis → image-saver → disco`. O `pixel-to-object` recebe **apenas as bounding boxes** já produzidas pela inferência (IRIS-04), não a imagem inteira. Reduz bandwidth e desacopla concerns: detecção fica na inferência, projeção 3D + tracking fica aqui. |

### 4.3 O que pode dar errado (e onde olhar)

- **Frames sumindo no meio da varredura** → checar buffer do SequenceContext e logs do RabbitMQ; geralmente é network glitch resolvido pelo reorder window.
- **Defeitos duplicados em câmeras vizinhas** → esperado. Tratamento no banco via `defeitos_agg` (trigger centroidal já existente). Se virar problema operacional, considerar fusão cross-câmera (item descartado em §2).
- **Track persiste depois da carroceria sair** → ajustar `SEQUENCE_TIMEOUT_S` para coincidir com o ciclo GM (54 s) + margem.
- **Posição 3D fora do mesh** → calibração extrínseca desviada; recalibrar via `calibration_app.py` (hot-reload, sem restart).
- **`aggregated_position_3d` muito incerto** (uncertainty alto) → poucas observações por track. Reduzir `MIN_DETECTION_RATE` ou investigar se a varredura está curta demais.

---

## 5. Mudanças necessárias

Esta seção é curta de propósito: a `feat/kalman-filter` já entrega praticamente tudo.

### 5.1 Pass-through `scan_started_at`

Em `server.py` (área de parsing do message envelope), adicionar `scan_started_at` à lista de campos preservados. Propagar até a saída agregada (campo novo no dict de `_build_defect_message` em `defect_aggregator.py`):

```python
# em defect_aggregator._build_defect_message
message['scan_started_at'] = scan_started_at  # passed in from sequence_manager
```

Persistir também no `SequenceContext` (no `add_frame`) para garantir consistência entre frames da mesma sequência. Justificativa: facilita uso futuro (interpolação cinemática) e correlação cross-câmera no banco se for necessário depois.

### 5.2 Validar contrato de mensagem com IRIS-02

A `feat/kalman-filter` assume `camera_current_position` como dict de posições (campo já existente no contrato). IRIS-02 precisa publicar:

```json
{
  "camera_id": "1",
  "frame_uuid": "...",
  "part_uuid": "<PVI>",
  "frame_captured_at": "2026-...",
  "scan_started_at": "2026-...",            // NEW
  "frame_current_position": "<long_pos_mm>",
  "camera_current_position": {              // existing — IRIS preenche com axis positions
    "axis_1": <vertical_mm>,
    "axis_2": <transversal_mm>,
    "axis_3a": <curtain_left_mm>,
    "axis_3b": <curtain_right_mm>
  },
  "frame_info": {
    "object_movement_axis": [-1.0, 0.0, 0.0],
    "camera_movement_axes": {              // existing — pixel-to-object usa para compor pose
      "1": [...],
      "2": [...]
    }
  },
  "boxes": [
    {"box": [x1, y1, x2, y2], "confidence": 0.4, "class": "risco"}
  ]
}
```

Confirmar com IRIS-02 que o catálogo `ponto_iris.json` (Track E do plan IRIS-02) está produzindo exatamente esses nomes/estrutura. **Acoplamento explícito IRIS-02 ↔ IRIS-03.**

### 5.3 Calibração extrínseca para 4 câmeras

O `calibration_app.py` (Streamlit, ArUco) está pronto. Para IRIS:
- 1 sessão de calibração por câmera (4 sessões).
- Salvar cada calibração no Redis via `ConfigManager`.
- A `hot-reload` da branch permite recalibrar em campo sem restart.

### 5.4 Configuração do deploy

Compose: 1 serviço `pixel-to-object` apontando para o mesmo Redis usado pelo `camera-acquisition` (DB de config) e para o RabbitMQ comum. Env vars relevantes (já existentes na branch):
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_CONFIG_DB`
- `RABBITMQ_HOST`, `INPUT_QUEUE`, `OUTPUT_QUEUE`
- `MIN_DETECTION_RATE`, `MIN_QUALITY_SCORE` (tuning Kalman/Aggregator — ajustar no campo)
- `SEQUENCE_REORDER_WINDOW_S`, `SEQUENCE_TIMEOUT_S`

Valores iniciais ficam como deploy-stellantis defaults; tuning final na fase de bench.

## 6. Critérios de aceite

| # | Critério | Como verificar |
|---|---|---|
| 1 | `pixel-to-object` instalado e rodando em modo single-instance, processando mensagens das 4 câmeras IR concorrentemente | log + `get_active_sequence_count()` ≥ 1 quando há varredura |
| 2 | 4 sequências independentes por PVI ativas em paralelo no `SequenceManager` (chave `(PVI, cam_id)`) | inspeção do estado durante uma carroceria de teste |
| 3 | Campo `scan_started_at` propagado da entrada até a saída agregada (não modificado, idêntico em todos os frames de uma varredura) | smoke test E2E |
| 4 | Calibração das 4 câmeras IR via `calibration_app.py`, salva no Redis e carregada via `ConfigManager` | hot-reload verificável (mudar calibração no Redis sem restart) |
| 5 | `position_3d` de saída está em coordenadas absolutas (body frame) — validável visualmente | overlay no viewer ou comparação manual |
| 6 | 4 streams agregados (1 por câmera) chegam ao `database-writer` e são consolidados no banco `vk_iris_03007` por `peca=PVI` | `SELECT * FROM defeitos WHERE peca='<PVI_test>'` retorna ≥ 1 row por câmera |
| 7 | Performance: 4 câmeras × 50 fps ≈ 200 frames/s de input sem perda de frame > 1% num run de 1 h | log de drops + comparação de frame counters |

## 7. Pendências (não bloqueiam a spec)

1. **Merge da `feat/kalman-filter` em master.** Hoje a branch está em `develop`. Decisão sobre quando promover (antes ou depois do IRIS-03 começar) é operacional — não impacta o conteúdo da spec.
2. **Interface com `sdk-blender-tools`** — quando a atividade Blender (cobertura + cena virtual) arrancar, definir formato esperado de ground truth (3D points + classes + poses) e harness de comparação. Atividade paralela, separada.
3. **Tuning dos parâmetros Kalman/Aggregator** — `MIN_DETECTION_RATE`, `MIN_QUALITY_SCORE`, gains do Kalman 3D. Fica para a fase de bench (Track de comissionamento).
4. **Cobertura de reflexão IR** — a topologia das 4 câmeras (FOV das N6/N15 nos pórticos 2/3/4) cobre toda a carroceria? Atividade paralela Blender — não impacta a spec de software, mas pode forçar ajuste de calibração se zonas mortas forem descobertas.
5. **Latência fim a fim** — se algum gargalo aparecer, a recomendação operacional é replicar a instância de `pixel-to-object` (scaling horizontal), não separar por câmera. Manter chave `(part_uuid, camera_id)` no `SequenceManager` é o que garante consistência mesmo com múltiplos workers.

## 8. Próximos passos

1. **User review** desta spec.
2. Plan de implementação (`docs/superpowers/plans/2026-05-13-iris-03-pixel-to-object.md`) com tarefas TDD focadas no patch pequeno (pass-through `scan_started_at`) + scaffolding de deploy + smoke test 4-câmera + calibração.
3. Alinhamento explícito do contrato de mensagem com IRIS-02 (catálogo `ponto_iris.json` → schema do payload `pixel-to-object`).
4. Agendar merge `feat/kalman-filter` → master (decisão operacional).
