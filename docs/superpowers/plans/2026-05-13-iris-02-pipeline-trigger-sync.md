# IRIS-02 pipeline-trigger-sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar os patches mínimos sobre `visionking/services/camera-acquisition` para suportar a topologia IRIS (4 câmeras Hikrobot CI infrared + tags Logix + timestamp único por varredura + health-monitor de câmera). Baseline = deploy-stellantis `.232`.

**Spec:** `docs/superpowers/specs/2026-05-13-iris-02-pipeline-trigger-sync-design.md`

**Tech stack:** C++20, meson, aravis 0.8 (GenICam), redis++, opencv4, jsoncpp. Testes: meson + binários em `tests/unit_tests/` + `tests/integration_tests/`. Docker dev compose em `visionking-camera-acquisition-dev.yml`.

**Worktree:**
- Camera-acquisition: `/home/teruel/worktrees/camera-acquisition-iris02/` (NEW — branch `feat/iris-02` off `origin/master`)

**Track ordering:** Tracks A, B e C podem ser desenvolvidas em paralelo — cada uma é independente da outra. Track D depende de B+C concluídos. Track E (catálogo de tags) é deferido para depois do alinhamento com Willer (NXG) — o scaffolding em A/B/C usa tags sintéticas em testes.

---

## Track A — `scan_started_at` (timestamp único por varredura)

### Task A1: Adicionar campo `scan_started_at` em `PartData` (TDD)

**Files:**
- Modify: `include/utils/part_data.hpp`
- Modify: `src/utils/part_data.cpp`
- Create: `tests/unit_tests/test_scan_started_at.cpp`
- Modify: `meson.build` (registrar novo test target)

- [ ] **Step 1: Criar worktree e baseline**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/visionking/services/camera-acquisition
git fetch origin
git worktree add /home/teruel/worktrees/camera-acquisition-iris02 -b feat/iris-02 origin/master
cd /home/teruel/worktrees/camera-acquisition-iris02
meson setup build && cd build && ninja && meson test 2>&1 | tail -10
```

Expected: build limpo + testes atuais passando como baseline.

- [ ] **Step 2: Escrever teste falhando para `scan_started_at`**

Create `tests/unit_tests/test_scan_started_at.cpp`:

```cpp
#include <gtest/gtest.h>
#include "utils/part_data.hpp"

TEST(ScanStartedAt, EmptyWhenNoPart) {
    PartData pd;
    EXPECT_TRUE(pd.scan_started_at.empty());
}

TEST(ScanStartedAt, SetOnRisingEdge) {
    PartData pd;
    pd.mark_scan_start();  // helper to be implemented
    EXPECT_FALSE(pd.scan_started_at.empty());
    // Format check: ISO 8601 UTC with millisecond precision
    EXPECT_EQ(pd.scan_started_at.size(), 24);  // "YYYY-MM-DDTHH:MM:SS.sssZ"
}

TEST(ScanStartedAt, PreservedAcrossFramesUntilNewEdge) {
    PartData pd;
    pd.mark_scan_start();
    std::string ts_first = pd.scan_started_at;
    // simulate multiple frames in PART_ACTIVE — value must not change
    EXPECT_EQ(pd.scan_started_at, ts_first);
    // new rising edge resets
    pd.mark_scan_start();
    EXPECT_NE(pd.scan_started_at, ts_first);
}
```

Expected: compile fail (`mark_scan_start` undefined, field missing).

- [ ] **Step 3: Implementar mínimo para passar**

In `include/utils/part_data.hpp`:
```cpp
class PartData {
public:
    // ... existing fields ...
    std::string scan_started_at;
    void mark_scan_start();
};
```

In `src/utils/part_data.cpp`:
```cpp
#include <chrono>
#include <iomanip>
#include <sstream>

void PartData::mark_scan_start() {
    auto now = std::chrono::system_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()) % 1000;
    auto t = std::chrono::system_clock::to_time_t(now);
    std::ostringstream oss;
    oss << std::put_time(std::gmtime(&t), "%FT%T") << "."
        << std::setfill('0') << std::setw(3) << ms.count() << "Z";
    scan_started_at = oss.str();
}
```

- [ ] **Step 4: Rodar testes — todos passando**

```bash
cd build && ninja && meson test test_scan_started_at -v
```

### Task A2: Conectar `mark_scan_start()` em `calculate_partuuid()` (TDD)

**Files:**
- Modify: `src/utils/acquisition_data.cpp`
- Create: `tests/unit_tests/test_acquisition_scan_start.cpp` (fake Redis fixture)

- [ ] **Step 1: Teste falhando — verificar que borda de subida chama `mark_scan_start`**

Usando o `RedisClient` real apontando para Redis embarcado dentro do container de teste (já existe em `visionking-camera-acquisition-dev.yml`), simular sequência:
1. `Part_Presence=false` → `calculate_partuuid()` retorna "empty", `scan_started_at` vazio
2. `Part_Presence=true` (borda de subida) → `scan_started_at` populado
3. `Part_Presence=true` (still active) → `scan_started_at` igual ao anterior
4. `Part_Presence=false` → `scan_started_at` preservado (PART_COMPLETE)
5. `Part_Presence=true` → novo `scan_started_at` diferente do anterior

- [ ] **Step 2: Patch em `calculate_partuuid()`** — adicionar `part_data.mark_scan_start()` no bloco "Detecta borda de subida" (linha 169 atual).

- [ ] **Step 3: Adicionar campo `scan_started_at` em `get_information()`**

```cpp
information.set_Value("scan_started_at", part_data.scan_started_at);
```

- [ ] **Step 4: Estender `check_fields()`** — incluir `scan_started_at` na lista de `required_fields`.

- [ ] **Step 5: Rodar testes**

---

## Track B — GenICam `DeviceTemperature` reading

### Task B1: Abstração para leitura de feature GenICam (TDD)

**Files:**
- Modify: `include/utils/camera_data.hpp` ou abstração equivalente em `include/camera/`
- Create: `tests/unit_tests/test_device_temperature.cpp` com `FakeCamera`

**Rationale:** o código atual chama métodos no `genicam::Camera` diretamente. Para testar `DeviceTemperature` sem hardware, isolar a leitura atrás de uma interface fina.

- [ ] **Step 1: Definir interface mínima**

```cpp
// include/camera/temperature_reader.hpp
class TemperatureReader {
public:
    virtual ~TemperatureReader() = default;
    virtual std::optional<float> read(const std::string& selector) = 0;
};

class GenicamTemperatureReader : public TemperatureReader {
    genicam::Camera* cam_;
public:
    explicit GenicamTemperatureReader(genicam::Camera* cam) : cam_(cam) {}
    std::optional<float> read(const std::string& selector) override;
};
```

- [ ] **Step 2: Teste falhando com `FakeCamera`**

```cpp
class FakeTemperatureReader : public TemperatureReader {
public:
    std::map<std::string, float> values;
    std::optional<float> read(const std::string& selector) override {
        auto it = values.find(selector);
        return it == values.end() ? std::nullopt : std::optional{it->second};
    }
};

TEST(DeviceTemperature, ReadsAllThreeSelectors) {
    FakeTemperatureReader r;
    r.values = {{"Sensor", 42.5f}, {"Mainboard", 38.0f}, {"FPGA", 51.2f}};
    auto result = collect_device_temperatures(r);
    EXPECT_FLOAT_EQ(result["Sensor"], 42.5f);
    EXPECT_FLOAT_EQ(result["Mainboard"], 38.0f);
    EXPECT_FLOAT_EQ(result["FPGA"], 51.2f);
}

TEST(DeviceTemperature, MissingSelectorReturnsNullopt) {
    FakeTemperatureReader r;
    r.values = {{"Sensor", 42.5f}};  // Mainboard/FPGA absent
    auto result = collect_device_temperatures(r);
    EXPECT_TRUE(result.contains("Sensor"));
    EXPECT_FALSE(result.contains("Mainboard"));
    EXPECT_FALSE(result.contains("FPGA"));
}
```

- [ ] **Step 3: Implementar `collect_device_temperatures()`** — função pura iterando os 3 selectors padrão.

- [ ] **Step 4: Implementar `GenicamTemperatureReader::read()`** — try/catch em volta de `set_string("DeviceTemperatureSelector", ...) + get_float("DeviceTemperature")`. Retorna `nullopt` se a câmera não expõe o selector.

### Task B2: Integrar leitura em `get_information()`

**Files:**
- Modify: `src/utils/acquisition_data.cpp`
- Modify: `include/utils/acquisition_data.hpp`

- [ ] **Step 1: Adicionar membro `TemperatureReader` em `AcquisitionData`** (default = GenicamTemperatureReader sobre `camera_data.camera`).

- [ ] **Step 2: Em `get_information()`**, substituir o bloco passthrough do PLC `temperature` por:

```cpp
auto temps = collect_device_temperatures(*temperature_reader_);
for (const auto& [selector, value] : temps) {
    std::string field = "device_temp_" + selector;
    std::transform(field.begin(), field.end(), field.begin(), ::tolower);
    information.set_Value(field, std::to_string(value));
}
```

- [ ] **Step 3: Atualizar `check_fields()`** — `device_temp_sensor` obrigatório; `device_temp_mainboard` e `device_temp_fpga` opcionais (não falham se ausentes).

- [ ] **Step 4: Manter campo `temperature` legado** (apontando para `device_temp_sensor`) por compatibilidade com downstream que ainda lê esse nome. **Marcar deprecation no comentário** — remover depois do IRIS-05 atualizar consumidores.

- [ ] **Step 5: Rodar testes — todos passam**

### Task B3: Validação de campo no primeiro lote Hikrobot (procedimento, sem código)

**Files:** `tests/integration_tests/README-device-temperature-validation.md` (novo)

- [ ] **Step 1:** Documentar procedimento de validação do datasheet (5 min de log a 50 fps, critérios pass/fail conforme spec §4.4). **Não bloqueia merge** — quando o lote chegar (subtask de [2.16]), rodar e anexar log em `data/hikrobot/03007-device-temperature-validation.log`.

---

## Track C — Refactor de `get_information()` para tags extensíveis

### Task C1: Generalizar tratamento de tags PLC (TDD com tags sintéticas)

**Files:**
- Modify: `src/utils/acquisition_data.cpp`
- Create: `tests/unit_tests/test_tag_dispatch.cpp`
- Create: `tests/fixtures/synthetic_tags.json` (catálogo de teste, **não** `ponto_iris.json` real)

**Rationale:** o `get_information()` atual tem casos especiais hardcoded para `Camera_*_Temperature`, `System_Water_Press`, `System_Water_Temp`, `Capture_Status`. Para suportar as tags IRIS sem multiplicar `if`s, generalizar via dispatch table que o JSON declara.

- [ ] **Step 1: Definir formato extensível em `synthetic_tags.json`**

```json
{
  "PLC": {
    "DataBlocks": {
      "TestDB": {
        "tag_simple": {
          "key": "Test_Simple",
          "hash": "TestDB",
          "plc_camera": "true",
          "field": "simple_value"
        },
        "tag_per_camera": {
          "key_pattern": "Camera_{id}_Test",
          "hash": "TestDB",
          "plc_camera": "true",
          "field": "per_camera_value"
        },
        "tag_json_wrapped": {
          "key": "Test_Wrapped",
          "hash": "TestDB",
          "plc_camera": "true",
          "field": "unwrapped",
          "json_key": "Test_Wrapped"
        }
      }
    }
  }
}
```

3 padrões cobrem todos os casos atuais (e os de IRIS):
1. **Simple** — `field` recebe valor direto.
2. **Per-camera** — `key_pattern` com `{id}` substituído pelo `camera_data.ID`.
3. **JSON-wrapped** — `parse_json(value, json_key, default)` antes de armazenar.

- [ ] **Step 2: Testes falhando** — 3 testes, 1 por padrão, com Redis fake populado e verificação do `Information` resultante.

- [ ] **Step 3: Refatorar `get_information()`** — substituir os 4 `if`s hardcoded por iteração sobre o dispatch table do JSON. Manter os campos legados (`temperature`, `water_press`, `water_temp`, `status`) através do mapeamento `field` no próprio JSON.

- [ ] **Step 4: Compatibilidade regressão** — adicionar teste que carrega `ponto1.json` legado (laminação) e verifica que todos os campos antigos continuam preenchidos com mesmos nomes.

- [ ] **Step 5: Rodar testes**

---

## Track D — Deploy multi-instância + integração

### Task D1: Compose dev com 4 instâncias

**Files:**
- Create: `visionking-camera-acquisition-iris-dev.yml`
- Modify: `Dockerfile` se necessário (env defaults)

- [ ] **Step 1: Compose 4-câmeras**

Base no `visionking-camera-acquisition-dev.yml` atual, replicar serviço × 4 com env vars distintas:

```yaml
services:
  cam1: { environment: { CAMERA_NAME: cam-1, CAM_ID: "1", TAGS_PATH: /etc/iris/ponto_iris.json, CROP: "false", TRIGGER_SOURCE: Line0 } }
  cam2: { environment: { CAMERA_NAME: cam-2, CAM_ID: "2", ... } }
  cam3: { environment: { CAMERA_NAME: cam-3, CAM_ID: "3", ... } }
  cam4: { environment: { CAMERA_NAME: cam-4, CAM_ID: "4", ... } }
```

Bind-mount `tests/fixtures/synthetic_tags.json` durante CI; bind-mount `ponto_iris.json` real em prod.

- [ ] **Step 2: Smoke test** — `docker compose up` deve subir 4 instâncias e cada uma logar "Camera discovered" + iniciar streaming (sem câmera real, modo `-t false` cai em retry — log expected).

### Task D2: Validação end-to-end com câmera mock

**Files:**
- Create: `tests/integration_tests/test_iris_e2e.sh`

- [ ] **Step 1:** Script bash que:
  1. Sobe compose + Redis embedded
  2. Pré-popula Redis DB1 com tags sintéticas (PVI, Style, axis posições)
  3. Envia frame fake via camera mock (aravis tem suporte a `aravis-fake-gv-camera-0.8`)
  4. Espera 5s
  5. Lê Redis DB2 chave `Camera_1` e valida campos obrigatórios
  6. Mata containers

- [ ] **Step 2:** Adicionar ao `run_test.sh` como `meson test --suite integration`

---

## Track E — Catálogo de tags real (DEFERIDO)

> **Bloqueado por:** alinhamento com Willer sobre nomenclatura final no NXG (PVI vs Body_ID, Axis3A vs CurtainLeft, etc.). Pode ser feito depois das tracks A-D estarem prontas; o scaffolding usa `synthetic_tags.json` até lá.

### Task E1: Definir `ponto_iris.json`

**Files:**
- Create: `ponto_iris.json` (na raiz do repo, análogo ao `ponto1.json` atual)
- Modify: `tests/fixtures/synthetic_tags.json` → migrar para usar nomes reais como referência

- [ ] **Step 1:** Reunião 30 min com Willer — confirmar nomes finais de cada tag, hash de DB, formato (JSON-wrapped ou simple).
- [ ] **Step 2:** Editar `ponto_iris.json` conforme alinhamento.
- [ ] **Step 3:** Pedir Willer para validar os mesmos nomes no projeto Logix antes do bench.

### Task E2: Pendência heartbeat `WS_Ready` (fora de IRIS-02)

> Não tocar nesse plano. Tratamento na próxima reunião de design 03007 — opções (a) explicit-write periódico, (b) upgrade classe 1, (c) sem feedback. Default = (c) até decisão.

---

## Critérios de merge para a branch `feat/iris-02`

1. ✅ Todos os testes em `tests/unit_tests/` passam (incluindo os 3 novos: `test_scan_started_at`, `test_device_temperature`, `test_tag_dispatch`).
2. ✅ Teste de regressão `ponto1.json` (laminação) passa — não quebrou consumidores existentes.
3. ✅ `test_iris_e2e.sh` (integration) passa com camera mock.
4. ✅ Build limpo em Docker (`run_test.sh`).
5. ✅ Diff de runtime: chave `Camera_<id>` em Redis DB2 ganhou os campos `scan_started_at`, `device_temp_*`, e os campos de tag conforme dispatch table.
6. ⚠️ Validação `DeviceTemperature` em hardware real fica como **post-merge follow-up** quando o lote Hikrobot chegar.

---

## Estimativa de esforço

| Track | Esforço |
|---|---|
| A — `scan_started_at` | 1 dia (TDD) |
| B — `DeviceTemperature` | 1,5 dia (inclui abstração) |
| C — tag dispatch refactor | 2 dias (mais arriscado — código central) |
| D — deploy + e2e | 1 dia |
| E (deferido) | 0,5 dia depois do alinhamento Willer |

**Total scaffolding:** ~5-6 dias de implementação, plus 1 dia de validação de hardware (post-merge).
