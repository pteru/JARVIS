# Especificação Técnica: `diemaster-inference`

**Contrato:** CT067/26 — SENAI/DR/SC (R$ 166.000, 25 dias úteis)<br>
**Produto:** DieMaster (Smart Die System — ROTA 2030)<br>
**Repositório:** `strokmatic/diemaster-inference` (submodule em `diemaster/services/inference`)<br>
**Referência arquitetural:** `visionking-inference`<br>
**Idioma:** Spec e README em português; código e comentários em inglês<br>

---

## 1. Visão Geral

Worker assíncrono de inferência de Machine Learning para o sistema DieMaster. Processa dados de sensores de estampagem (GAP e DRAW-IN) em tempo real, integrando-se ao pipeline existente via RabbitMQ/Redis.

O serviço consome mensagens processadas pelo `data-processing`, executa inferência ML (anomaly detection, predição de séries temporais) e publica resultados para persistência e streaming frontend.

---

## 2. Arquitetura — Topologia no Pipeline

O serviço se insere como **consumidor paralelo** via nova fila `inference-queue`, alimentada pelo `data-processing` (alteração mínima de 3 linhas):

```
[data-processing] ─publish──▶ dw-smart-die-queue ──▶ [database-writer] ──▶ PostgreSQL
                  └─publish──▶ inference-queue ─────▶ [diemaster-inference] ──▶ ml-results-queue ──▶ [ml-writer/backend]
                                                           │
                                                      Redis DB3 (config hot-reload)
                                                      Redis DB4 (streaming frontend)
```

**Por quê fila dedicada e não consumidor paralelo na mesma fila?** O `database-writer` usa `auto_ack=True` com competing consumers (round-robin), não fanout. Cada mensagem iria para apenas um dos dois. Uma fila dedicada é a solução limpa que garante que ambos os serviços recebam todas as mensagens.

---

## 3. Estrutura do Repositório

```
diemaster-inference/
├── main.py                           # Entry point (asyncio.run)
├── src/
│   ├── inference_server.py           # Orquestrador (connect, consume, shutdown)
│   ├── config/
│   │   ├── env_config.py             # Variáveis de ambiente (startup)
│   │   ├── redis_config.py           # Motor de config dinâmica (hot-reload)
│   │   └── config_schema.py          # Pydantic models p/ validação
│   ├── communication/
│   │   ├── rabbit_client.py          # aio-pika async (adaptado de VK)
│   │   ├── redis_client.py           # aioredis async (NOVO — VK usa sync)
│   │   ├── config.py                 # BrokerConfig, DbConfig dataclasses
│   │   └── exceptions.py             # ConnectionLossError, etc.
│   ├── batch_processing/
│   │   ├── batch_processor.py        # Acumulador async (adaptado de VK)
│   │   ├── batch_config.py           # Parâmetros de batch
│   │   ├── batch_optimizer.py        # Ajuste dinâmico de batch size
│   │   └── performance_monitor.py    # Timing/throughput por estágio
│   ├── model_adapters/               # ABSTRAÇÃO CENTRAL
│   │   ├── base.py                   # ModelAdapter ABC + InferenceBackend Protocol + InferenceResult
│   │   ├── registry.py               # Registro/descoberta de adapters via decorator
│   │   ├── plugin_loader.py          # importlib loader para /plugins/adapters/*.py
│   │   ├── generic_adapter.py        # GenericAdapter config-driven (JSON, zero código)
│   │   ├── backends/
│   │   │   ├── pytorch_backend.py    # PyTorch (AMP, CUDA, torch.no_grad)
│   │   │   ├── tensorflow_backend.py # TF 2.x (tf.function, memory growth)
│   │   │   ├── onnx_backend.py       # ONNX Runtime (CUDA/TensorRT EP)
│   │   │   └── tensorrt_backend.py   # TensorRT nativo (engine compilado)
│   │   └── adapters/                 # Built-in (demo/referência)
│   │       ├── autoencoder_drawin.py # AE anomalia p/ DRAWIN
│   │       ├── autoencoder_gap.py    # AE anomalia p/ GAP
│   │       ├── lstm_drawin.py        # LSTM sequencial p/ DRAWIN
│   │       └── lstm_gap.py           # LSTM sequencial p/ GAP
│   ├── signal_processing/
│   │   ├── feature_extractor.py      # Extrai features da mensagem do data-processing
│   │   └── normalizer.py             # Z-score, min-max normalização
│   ├── result_handling/
│   │   ├── result_handler.py         # Formata e publica resultados
│   │   └── alert_engine.py           # Avaliação de thresholds + geração de alertas
│   ├── gpu/
│   │   ├── gpu_config.py             # Detecção GPU, setup CUDA, gerenciamento memória
│   │   └── device_manager.py         # Abstração CPU/GPU
│   └── utils/
│       ├── log_config.py             # Loguru (convenção DM)
│       └── memory.py                 # Limpeza de memória GPU/CPU
├── tests/                            # pytest-asyncio (66+ testes)
├── plugins/                          # DEFAULT plugin dir (pode ser sobrescrito por volume)
│   ├── adapters/                     # Plugin adapters (.py) — volume montado em produção
│   └── configs/                      # Config JSON p/ GenericAdapter — volume montado em produção
├── models/                           # Weights (volume montado)
├── Dockerfile                        # Base nvcr.io/nvidia/tensorrt + multi-framework
├── requirements.txt
├── docker-compose.yml
├── cloudbuild.yaml
└── README.md
```

---

## 4. Model Adapter Pattern — Design Central

A exigência do contrato é **troca de arquitetura de modelo sem alteração ao código base**. O pattern usa 3 camadas:

### 4.1 Camada 1 — `InferenceBackend` (Protocol)

Interface framework-specific. 4 métodos: `load_model()`, `predict()`, `warmup()`, `name`. Implementações: PyTorch, TensorFlow, ONNX, TensorRT.

Input/output sempre `np.ndarray` — conversão de tensores é interna ao backend.

```python
class InferenceBackend(Protocol):
    @property
    def name(self) -> str: ...
    async def load_model(self, model_path: str, device: str) -> None: ...
    async def predict(self, inputs: np.ndarray) -> np.ndarray: ...
    async def warmup(self, input_shape: tuple[int, ...]) -> None: ...
```

### 4.2 Camada 2 — `ModelAdapter` (ABC)

Encapsula pré e pós-processamento. Subclasses implementam APENAS `preprocess(message) -> np.ndarray` e `postprocess(raw_output, message) -> InferenceResult`. O método `run()` é final e orquestra: preprocess → backend.predict → postprocess.

```python
class ModelAdapter(ABC):
    def __init__(self, backend: InferenceBackend, config: dict): ...

    @abstractmethod
    def preprocess(self, message: dict) -> np.ndarray: ...

    @abstractmethod
    def postprocess(self, raw_output: np.ndarray, message: dict) -> InferenceResult: ...

    async def run(self, message: dict) -> InferenceResult:
        inputs = self.preprocess(message)
        raw = await self.backend.predict(inputs)
        return self.postprocess(raw, message)
```

### 4.3 Camada 3 — `AdapterRegistry`

Decorator `@register_adapter("nome")` para descoberta dinâmica. Config Redis aponta qual adapter ativar por tipo de sensor.

```python
@register_adapter("autoencoder_drawin_v1")
class AutoencoderDrawinAdapter(ModelAdapter):
    ...
```

### 4.4 Mecanismos de Troca de Modelo (sem rebuild)

**Mecanismo A — Config-Only (GenericAdapter + JSON, zero código):**

Um `GenericAdapter` built-in que lê configuração declarativa de um JSON (em volume montado `/plugins/configs/` ou direto do Redis). Cobre ~80% dos casos:

```json
{
  "adapter_name": "autoencoder_drawin_v2",
  "sensor_type": "DRAWIN",
  "features": ["X_cal_phi", "Y_cal_phi", "v_x_phi", "v_y_phi"],
  "arrangement": "concat",
  "window_size": null,
  "normalization": {
    "method": "zscore",
    "mean_key": "drawin:norm:mean",
    "std_key": "drawin:norm:std"
  },
  "output_type": "reconstruction_error",
  "thresholds": {
    "warning": 0.10,
    "critical": 0.30
  }
}
```

Para trocar: editar o JSON config + dropar novo model weight em `/models/` + bump `config_version` no Redis. Sem código, sem rebuild.

**Mecanismo B — Plugin Adapter (.py em volume montado, sem rebuild):**

Para pré/pós-processamento custom que o GenericAdapter não cobre. Arquivos `.py` dropados em `/plugins/adapters/` (volume Docker), carregados via `importlib` no startup e no hot-reload:

```
/plugins/
├── adapters/                    # Volume montado
│   ├── transformer_drawin.py   # @register_adapter("transformer_drawin_v1")
│   └── ensemble_gap.py         # @register_adapter("ensemble_gap_v1")
└── configs/                     # Volume montado
    └── autoencoder_drawin_v2.json  # Config p/ GenericAdapter
```

O `PluginLoader` escaneia `/plugins/adapters/*.py`, importa via `importlib.util.spec_from_file_location()`, e registra qualquer classe decorada com `@register_adapter()`.

**Mecanismo C — Built-in Adapters (na imagem, para demo/referência):**

Os 4 adapters iniciais (AE DRAWIN, AE GAP, LSTM DRAWIN, LSTM GAP) + o GenericAdapter. Servem como referência e validação do pipeline.

**Prioridade de resolução do registry:** Plugin > Config > Built-in (mesmo nome = plugin sobrescreve built-in).

### 4.5 Estratégias de Pré/Pós-processamento por Arquitetura

| Modelo | Input | Pré-processamento | Pós-processamento |
|--------|-------|-------------------|-------------------|
| Autoencoder | 1D vetor (4004 features) | Concat sinais phi + scalars, z-score | MSE(input, reconstruction) → anomaly score |
| LSTM | 2D (seq_len, features) | Sliding window sobre sinais phi | MAE(previsto, real) → anomaly score |
| 1D-CNN | 2D (channels, signal_len) | Stack sinais phi como canais | argmax → classe, P(anomalia) → score |
| Random Forest | 1D vetor (M scalars) | Apenas features escalares (di, spm, E_ss) | Classe + importância de features |

---

## 5. Pipeline Assíncrono — 4 Estágios

Adaptado do pipeline de 5 estágios do VK (load→slice→filter→infer→result) para séries temporais:

```
Estágio 1: EXTRACT    — Parse JSON, valida schema, roteia por sensor_type, extrai features
Estágio 2: PREPROCESS — ModelAdapter.preprocess() → numpy tensors, stack em batch
Estágio 3: INFER      — ModelAdapter.backend.predict() → forward pass GPU/CPU
Estágio 4: RESULT     — ModelAdapter.postprocess() → InferenceResult → publish RabbitMQ + Redis
```

Estágios conectados por `asyncio.Queue`. Batch trigger: size-based (16 msgs) OU time-based (30s).

### 5.1 Fluxo Detalhado

1. **EXTRACT**: Mensagem JSON recebida do RabbitMQ → valida campos obrigatórios → identifica `sensor_type` (DRAWIN/GAP) → `FeatureExtractor` extrai campos relevantes (sinais phi, features escalares) → coloca em queue do estágio 2.

2. **PREPROCESS**: Acumula mensagens até batch trigger → `ModelAdapter.preprocess()` converte para `np.ndarray` → `Normalizer` aplica z-score/min-max → stack em batch tensor → coloca em queue do estágio 3.

3. **INFER**: Recebe batch tensor → `InferenceBackend.predict()` executa forward pass (GPU se disponível, CPU fallback) → retorna raw output tensor → coloca em queue do estágio 4.

4. **RESULT**: `ModelAdapter.postprocess()` converte raw output em `InferenceResult` → `AlertEngine` avalia thresholds → `ResultHandler` publica em `ml-results-queue` (RabbitMQ) + atualiza hash Redis DB4 (streaming frontend).

---

## 6. Motor de Configuração Dinâmica (Redis Hot-Reload)

Redis DB3, hash `inference:config`. Polling a cada 5s com check de `config_version`.

Quando versão muda:

- **Troca de adapter:** Descarrega modelo atual, instancia novo adapter, carrega novos weights, warm-up. Swap ocorre entre batches (version-lock durante processamento).
- **Troca de thresholds:** Atualiza alert engine in-place (sem reload de modelo).
- **Troca de batch config:** Atualiza BatchConfig ao vivo.
- **Troca de normalização:** Atualiza feature_mean/std no adapter config.

### 6.1 Schema Redis DB3

```
inference:config (HASH)
├── config_version          # int, incrementado a cada mudança
├── active_adapter_drawin   # nome do adapter ativo p/ DRAWIN
├── active_adapter_gap      # nome do adapter ativo p/ GAP
├── model_path_drawin       # path do weight file DRAWIN
├── model_path_gap          # path do weight file GAP
├── backend                 # "pytorch" | "onnx" | "tensorflow" | "tensorrt"
├── batch_size              # int
├── batch_timeout_s         # float
├── threshold_warning       # float
├── threshold_critical      # float
├── feature_mean            # JSON array (p/ z-score)
├── feature_std             # JSON array (p/ z-score)
└── enabled                 # "true" | "false" (kill switch)
```

---

## 7. Formatos de Mensagem

### 7.1 Input (de `data-processing` via `inference-queue`)

Mesmo JSON publicado no `dw-smart-die-queue`, contendo campos processados. Campos relevantes por sensor:

**DRAWIN:**
- `X_cal_phi`, `Y_cal_phi` — sinais calibrados (1001 pontos cada)
- `v_x_phi`, `v_y_phi` — velocidades (1001 pontos cada)
- `di` — draw-in escalar
- `spm` — strokes per minute
- `E_ss` — energia steady-state
- `rmse_vs_golden` — RMSE vs referência

**GAP:**
- `vibration_phi` — sinal de vibração (1001 pontos)
- `temperature_phi` — sinal de temperatura (1001 pontos)
- `peak_vibration`, `mean_temperature` — features escalares

### 7.2 Output (para `ml-results-queue`)

```json
{
  "timestamp": "2026-03-05T10:30:00.000Z",
  "inference_timestamp": "2026-03-05T10:30:00.023Z",
  "die_id": "die-001",
  "sensor_id": "drawin-01",
  "sensor_type": "DRAWIN",
  "adapter_name": "autoencoder_drawin_v1",
  "backend": "pytorch",
  "anomaly_score": 0.15,
  "alert_level": "normal",
  "confidence": 0.85,
  "predictions": {
    "reconstruction_mse": 0.045
  },
  "inference_time_ms": 2.3,
  "model_version": "v1.0.0"
}
```

### 7.3 Redis Streaming (DB4)

Hash `inference:{die_id}:{sensor_id}`:
- `anomaly_score` — float
- `alert_level` — "normal" | "warning" | "critical"
- `confidence` — float
- `timestamp` — ISO 8601
- `adapter_name` — string
- `inference_time_ms` — float

Para dashboard frontend em tempo real.

---

## 8. Alteração no `data-processing`

Alteração mínima de 3 linhas para alimentar a nova fila:

```python
# config.py
INFERENCE_QUEUE = os.getenv("INFERENCE_QUEUE", "")

# pipeline.py (na função que publica para dw-smart-die-queue)
if config.INFERENCE_QUEUE:
    publish_message(channel, config.INFERENCE_QUEUE, result)
```

A variável `INFERENCE_QUEUE` é vazia por default — sem impacto em ambientes que não usam inferência. Quando ativada (`INFERENCE_QUEUE=inference-queue`), duplica a publicação para a fila de inferência.

---

## 9. Docker & Deploy

### 9.1 Imagem Base

- **Base:** `nvcr.io/nvidia/tensorrt:24.01-py3` (CUDA 12.x + cuDNN 8.x + TensorRT 8.x incluso)
- **Frameworks:** PyTorch 2.x + TensorFlow 2.x + ONNX Runtime GPU
- **Tamanho:** ~8-12 GB (multi-framework) ou ~3 GB (slim: só PyTorch + ONNX)

### 9.2 Docker Compose

```yaml
services:
  diemaster-inference:
    build: .
    image: diemaster-inference:latest
    container_name: diemaster-inference
    network_mode: host
    user: "diemaster"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    volumes:
      - ./models:/models:ro
      - ./plugins:/plugins:ro
    env_file:
      - .env
    depends_on:
      - rabbitmq
      - redis
    restart: unless-stopped
```

### 9.3 Volumes

| Volume | Mount | Propósito |
|--------|-------|-----------|
| `./models` | `/models:ro` | Weights dos modelos ML (não baked na imagem) |
| `./plugins/adapters` | `/plugins/adapters:ro` | Plugin adapters `.py` (troca sem rebuild) |
| `./plugins/configs` | `/plugins/configs:ro` | Config JSON p/ GenericAdapter (troca sem rebuild) |

### 9.4 Convenções Strokmatic

- **User:** `diemaster` (non-root)
- **Network:** `host` (convenção DM produção)
- **Restart:** `unless-stopped`
- **Logging:** JSON via loguru (convenção DM)

---

## 10. Variáveis de Ambiente

### RabbitMQ (6)
| Variável | Default | Descrição |
|----------|---------|-----------|
| `RABBIT_HOST` | `localhost` | Host RabbitMQ |
| `RABBIT_PORT` | `5672` | Porta RabbitMQ |
| `RABBIT_USER` | `guest` | Usuário RabbitMQ |
| `RABBIT_PASS` | `guest` | Senha RabbitMQ |
| `INFERENCE_INPUT_QUEUE` | `inference-queue` | Fila de input (consumo) |
| `INFERENCE_OUTPUT_QUEUE` | `ml-results-queue` | Fila de output (publicação) |

### Redis Config (5)
| Variável | Default | Descrição |
|----------|---------|-----------|
| `REDIS_CONFIG_HOST` | `localhost` | Host Redis config |
| `REDIS_CONFIG_PORT` | `6379` | Porta Redis config |
| `REDIS_CONFIG_DB` | `3` | DB para configuração dinâmica |
| `REDIS_CONFIG_POLL_INTERVAL` | `5` | Intervalo de polling (segundos) |
| `REDIS_CONFIG_KEY` | `inference:config` | Hash key da configuração |

### Redis Streaming (2)
| Variável | Default | Descrição |
|----------|---------|-----------|
| `REDIS_STREAM_HOST` | `localhost` | Host Redis streaming |
| `REDIS_STREAM_DB` | `4` | DB para streaming frontend |

### Models (4)
| Variável | Default | Descrição |
|----------|---------|-----------|
| `MODELS_DIR` | `/models` | Diretório base dos weights |
| `PLUGINS_DIR` | `/plugins` | Diretório base dos plugins |
| `DEFAULT_BACKEND` | `pytorch` | Backend padrão |
| `MODEL_WARMUP` | `true` | Executar warmup no startup |

### Batch (4)
| Variável | Default | Descrição |
|----------|---------|-----------|
| `BATCH_SIZE` | `16` | Tamanho do batch |
| `BATCH_TIMEOUT` | `30` | Timeout do batch (segundos) |
| `BATCH_OPTIMIZER_ENABLED` | `false` | Ajuste dinâmico de batch size |
| `BATCH_OPTIMIZER_TARGET_MS` | `50` | Latência alvo (ms) |

### GPU (3)
| Variável | Default | Descrição |
|----------|---------|-----------|
| `GPU_ENABLED` | `true` | Habilitar GPU |
| `GPU_DEVICE` | `0` | Índice do device CUDA |
| `GPU_MEMORY_FRACTION` | `0.5` | Fração de memória GPU reservada |

### Logging (1)
| Variável | Default | Descrição |
|----------|---------|-----------|
| `LOG_LEVEL` | `INFO` | Nível de log |

### Feature Flags (3)
| Variável | Default | Descrição |
|----------|---------|-----------|
| `INFERENCE_ENABLED` | `true` | Kill switch global |
| `ALERT_ENABLED` | `true` | Habilitar alertas |
| `STREAMING_ENABLED` | `true` | Habilitar Redis streaming |

### Thresholds (2)
| Variável | Default | Descrição |
|----------|---------|-----------|
| `THRESHOLD_WARNING` | `0.10` | Limiar de warning |
| `THRESHOLD_CRITICAL` | `0.30` | Limiar de critical |

---

## 11. Testes (pytest-asyncio, 66+ testes)

### 11.1 Unit Tests (60)

**Adapters Built-in (24):**
- 6 testes por adapter × 4 adapters (AE DRAWIN, AE GAP, LSTM DRAWIN, LSTM GAP)
- Cobertura: preprocess shape, postprocess format, missing fields, edge cases, anomaly score range, alert level mapping

**GenericAdapter (8):**
- Config loading, feature extraction por arrangement (concat, stack_channels, sliding_window), normalization application, output type mapping, threshold evaluation, invalid config handling

**Core (20):**
- FeatureExtractor: DRAWIN extraction, GAP extraction, missing fields, unknown sensor type
- Normalizer: z-score, min-max, passthrough, shape preservation
- AlertEngine: normal/warning/critical classification, threshold edge cases
- ResultHandler: message formatting, Redis hash update, RabbitMQ publish format
- Registry: register, discover, priority (plugin > config > built-in), duplicate handling
- PluginLoader: load valid plugin, skip invalid, decorator detection

**Batch (8):**
- Size-based trigger, time-based trigger, mixed trigger, empty batch, single item, optimizer adjustment, performance monitor timing, batch config hot-reload

### 11.2 Integration Tests (18)

- RabbitMQ client: connect, consume, publish, reconnect
- Redis client: config read, config watch, streaming publish
- Pipeline E2E: message → 4 stages → output message
- Backend loading: PyTorch load/predict, ONNX load/predict
- Hot-reload: config version change → adapter swap
- Plugin loader: importlib load from filesystem
- GenericAdapter: JSON config → functional adapter

### 11.3 Fixtures

- `drawin_processed.json` — mensagem completa de output do data-processing (DRAWIN)
- `gap_processed.json` — mensagem completa de output do data-processing (GAP)
- Dummy models: identity autoencoder (output = input, para validação de pipeline)
- Sample plugin adapter `.py` (com `@register_adapter()`)
- Sample GenericAdapter config `.json`

---

## 12. Fases de Desenvolvimento (25 dias úteis)

| Fase | Dias | Entregáveis |
|------|------|-------------|
| **1. Foundation** | 1-5 | Scaffolding, async RabbitMQ/Redis clients, env config, logging, GPU detection, Docker, pytest base |
| **2. Model Adapter Core** | 6-10 | ModelAdapter ABC, InferenceBackend protocol, PyTorch backend, ONNX backend, registry, feature extractor, normalizer, testes unitários |
| **3. Pipeline & Batch** | 11-15 | 4-stage async pipeline, batch processor, optimizer, performance monitor, result handler, Redis streaming, teste E2E |
| **4. Dynamic Config & Adapters** | 16-20 | Hot-reload engine, TF backend, TensorRT backend, adapters concretos (AE + LSTM p/ DRAWIN/GAP), alert engine, teste integração |
| **5. Polish & Docs** | 21-25 | README.md, cloudbuild.yaml, integração data-processing (3 linhas), full test suite (66+), benchmarks, deployment guide |

---

## 13. Mapeamento de Requisitos Contratuais

| # | Requisito (Termo de Referência) | Seção da Spec | Status |
|---|--------------------------------|---------------|--------|
| 1 | Worker assíncrono de inferência ML | §2, §5 | Coberto |
| 2 | Integração RabbitMQ (consumo e publicação) | §2, §7, §8 | Coberto |
| 3 | Suporte a múltiplos frameworks ML | §4.1 (backends) | Coberto |
| 4 | Troca de modelo sem alteração ao código base | §4.4 (3 mecanismos) | Coberto |
| 5 | Processamento em batch com otimização | §5, §11 (batch tests) | Coberto |
| 6 | Configuração dinâmica via Redis | §6 | Coberto |
| 7 | Suporte GPU (CUDA/TensorRT) | §9.1, §10 (GPU vars) | Coberto |
| 8 | Pipeline de pré/pós-processamento extensível | §4.2, §4.5 | Coberto |
| 9 | Monitoramento de performance | §3 (performance_monitor.py) | Coberto |
| 10 | Testes automatizados (66+) | §11 | Coberto |

---

## 14. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Imagem Docker grande (~12 GB multi-framework) | Deploy lento, storage | Multi-stage build + slim variant (PyTorch + ONNX only, ~3 GB) |
| Conflito TF + PyTorch na mesma GPU | OOM, crash | Apenas um framework ativo por vez (controlado por config) |
| Sem modelos ML treinados ainda | Não é possível testar inferência real | Ship com dummy models (identity AE — output = input) para validação de pipeline |
| Hot-reload durante processamento de batch | Inconsistência de resultados | Version-lock no início do batch, swap entre batches |
| Dados phi ausentes (feature flags desligados no data-processing) | Crash no preprocess | FeatureExtractor valida campos, skip graceful com log warning |
| Latência de rede RabbitMQ | Backpressure no pipeline | QoS prefetch_count configurável, batch timeout como safety valve |

---

## 15. Arquivos de Referência

| Arquivo | Razão |
|---------|-------|
| `visionking/services/inference/src/batch_processing/batch_processor.py` | Pattern de pipeline 5-stage async com Queue — adaptar para 4 stages |
| `visionking/services/inference/src/communication_clients/rabbit_client.py` | Client aio-pika async com connect_robust, QoS, graceful shutdown — reutilizar |
| `visionking/services/inference/src/inference_processing/gpu_config.py` | Setup CUDA, AMP, warmup — generalizar para InferenceBackend |
| `diemaster/services/data-processing/processing/processors/drawin_base.py` | Schema exato da mensagem de output que o inference vai consumir |
| `diemaster/services/data-processing/processing/processors/gap_base.py` | Idem para GAP |
| `diemaster/services/data-processing/processing/config.py` | Ponto de integração: adicionar INFERENCE_QUEUE |
| `diemaster/services/database-writer/src/communication_clients/rabbit_client.py` | Pattern DM de RabbitMQ client (sync pika) — referência de convenção, mas o inference usa aio-pika |

---

## 16. Critérios de Aceitação

1. Serviço consome mensagens da `inference-queue` e publica resultados na `ml-results-queue`
2. Pipeline assíncrono de 4 estágios processando DRAWIN e GAP
3. 4 adapters concretos funcionais com dummy models (AE DRAWIN, AE GAP, LSTM DRAWIN, LSTM GAP)
4. GenericAdapter funcional com config JSON declarativa
5. Plugin loader carregando adapters de volume montado via importlib
6. Hot-reload de configuração via Redis DB3 (troca de adapter entre batches)
7. Streaming de resultados para Redis DB4 (dashboard frontend)
8. Suporte GPU com fallback CPU
9. 66+ testes passando (pytest-asyncio)
10. Docker image buildando e rodando com GPU support
11. Alteração de 3 linhas no `data-processing` para alimentar a `inference-queue`
12. README.md em português com guia de deploy e desenvolvimento
