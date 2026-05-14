# IRIS-02 — pipeline-trigger-sync

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-05-13
**Project:** 03007 IRIS GM SCDS Paint
**ClickUp:** [3.1] IRIS-02 spec (`868jk1hh3`)
**Deadline interno:** 09/06 (spec → implementação → integração)

## 1. Goal

Adaptar o serviço C++ `visionking/services/camera-acquisition` para o uso na linha IRIS (GM SCDS Paint). O serviço atual já entrega o ciclo {HW trigger → frame → join com metadados PLC do Redis → publish em Redis cache+streaming}. IRIS-02 é o **conjunto de patches e configurações mínimos** sobre esse serviço para suportar a topologia IRIS — não é um serviço novo.

**Baseline conhecido:** topologia do deploy-stellantis instalada no PC `.232` (2 câmeras). IRIS escala para 4 câmeras + tags PLC Logix novas.

## 2. Scope

**In:**
- Novo catálogo de tags PLC (`ponto_iris.json`) para o `plc-monitor` ler do Logix e publicar no Redis DB1.
- Extensão de `get_information()` em `acquisition_data.cpp` para tratar as tags IRIS (positions de 4 eixos, PVI, Style, LongPos).
- Novo campo `scan_started_at` propagado em todos os frames de uma varredura PART_ACTIVE.
- Leitura nativa via GenICam de `DeviceTemperature` (sensor / mainboard / FPGA selectors) das 4 câmeras Hikrobot CI infrared.
- 4 instâncias independentes do `camera-acquisition` (1 por câmera).
- Flags de deploy: `CROP=false`, `TRIGGER_SOURCE=Line0`, `TAGS_PATH=ponto_iris.json`.

**Out (rejeitado ou deferido):**
- Reescrita do serviço — só patches localizados.
- Sincronização cross-câmera com `trigger_id` atômico — junção feita downstream pelo `PVI` (IRIS-05).
- Modos de falha 7 e 10 do GRAFCET — são PLC-side (timeout de eixo, velocidade da linha), não Workstation.
- Heartbeat `WS_Ready` para o PLC — depende de comunicação classe 1 e/ou explicit-write cíclico do plc-monitor; tratado como pendência arquitetural separada (seção 7).
- Crop dinâmico — desligado por env (`CROP=false`), código permanece.

## 3. Architecture

```
┌──────────────────┐    Logix tags    ┌────────────────┐
│  CompactLogix    │ ◀──────────────  │  plc-monitor   │
│  5069-L310ER     │   (read class 3) │     (C++)      │
└──────┬───────────┘                  └───────┬────────┘
       │ HW trigger DO0..DO3                  │ publish
       │ (Line0 das câmeras)                  ▼
       ▼                                ┌────────────┐
┌──────────────────┐                    │  Redis DB1 │
│ Câmera N6/N15 #N │                    │   (PLC)    │
│ (Hikrobot CI IR) │                    └─────┬──────┘
└──────┬───────────┘                          │ read
       │ frame @ 50 fps                       │
       ▼                                      │
┌─────────────────────────────────────────────▼─────┐
│  camera-acquisition  (4 instâncias, 1 por câmera) │
│                                                    │
│  • get_information(): merge frame + PLC tags       │
│  • get_information(): + DeviceTemperature GenICam  │
│  • calculate_partuuid: scan_started_at na borda    │
│  • publish: Redis DB0 (cache) + DB2 (streaming)    │
└────────────────────┬──────────────────────────────┘
                     │ {frame, PVI, Style, axis[4],
                     │  scan_started_at, frame_captured_at,
                     │  device_temp_sensor, ...}
                     ▼
              ┌──────────────┐
              │  Redis DB2   │ → IRIS-03 (pixel-to-object 3D)
              │  (streaming) │ → health-monitor WS
              └──────────────┘
```

Cada câmera publica de forma independente. A junção das 4 detecções de uma mesma carroceria acontece no banco (IRIS-05), pela chave `PVI`.

## 4. Patches no camera-acquisition

### 4.1 `ponto_iris.json` (novo catálogo de tags)

Substitui `ponto1.json`. Tags com `plc_camera: true` consumidas pelo serviço:

| key | hash | tipo | uso |
|---|---|---|---|
| `WS_PVI` | `WS_Body` | string | ID único da carroceria (chave de junção downstream) |
| `WS_Style` | `WS_Body` | string | receita / variante de modelo (mapa de defeitos) |
| `WS_Axis1_Pos` | `WS_Motion` | float | posição Eixo 1 vertical (mm) |
| `WS_Axis2_Pos` | `WS_Motion` | float | posição Eixo 2 (mm) |
| `WS_Axis3A_Pos` | `WS_Motion` | float | posição Eixo 3A cortina (mm) |
| `WS_Axis3B_Pos` | `WS_Motion` | float | posição Eixo 3B cortina (mm) |
| `WS_LongPos_Corrected` | `WS_Motion` | float | posição longitudinal fundida (mm) |
| `WS_Part_Presence` | `WS_Body` | bool | borda de subida = início da varredura |

### 4.2 Tratamento das tags em `get_information()`

Bloco análogo ao `Camera_*_Temperature` existente (linhas 63-77 de `acquisition_data.cpp`), mas para axis positions — apenas pass-through de valor para o `Information`. Sem casos especiais (não há per-camera mapping como na temperatura legada).

Os campos `device_temp_*` (seção 4.4) **substituem** o campo `temperature` herdado do PLC (que era stub para uso laminação).

### 4.3 `scan_started_at` — timestamp da borda de subida

Em `calculate_partuuid()` (linhas 164-198), capturar `now()` no exato instante da borda de subida (`current_part_passing && !part_data.previous_part_passing`) e armazenar em `part_data.scan_started_at`. Em `get_information()`, propagar como campo `scan_started_at`.

**Uso downstream:** IRIS-03 calcula `Δt = frame_captured_at - scan_started_at` para reconstruir a posição interpolada do eixo móvel no instante do frame (necessário para fusão das 4 vistas em coordenada de carroceria).

### 4.4 GenICam `DeviceTemperature` (novo path)

Adicionar leitura nativa em `get_information()` (paralela à passthrough PLC, que era stub):

```cpp
// pseudo
for (auto selector : {"Sensor", "Mainboard", "FPGA"}) {
    camera->set_string("DeviceTemperatureSelector", selector);
    float t = camera->get_float("DeviceTemperature");
    information.set_Value("device_temp_" + tolower(selector), std::to_string(t));
}
```

Publicar em Redis DB2 (streaming) sob chave `Camera_<id>` — health-monitor da WS consome para alertas de overheat.

**Investigação pendente — validação no primeiro lote Hikrobot que chegar (PO em negociação, ETA = PO + 21d):**
1. Conectar 1× MV-CI003-GL-N6 (ou N15) ao MVS SDK.
2. Iterar todos os valores válidos de `DeviceTemperatureSelector`.
3. Logar `DeviceTemperature` por **≥ 5 min com grab ativo a 50 fps**.
4. **Pass:** variação > ±0,5 °C **e** queda mensurável quando para o grab.
5. **Fail (stub):** valor estático → tratar como câmera CS/CE/CU (passar via PT100 externo, replanar BOM térmico).

**Estado atual do conhecimento** (memória interna [Hikrobot DeviceTemperature stub](memory/feedback_hikrobot_devicetemperature_stub.md) + matriz `data/hikrobot/areascan-camera-temp-matrix.csv`):
- N6 e N15 são série **CI infrared** — classificadas como **high likelihood** de `DeviceTemperature` funcional.
- Racional: LWIR radiométrica precisa intrinsecamente da temperatura do FPA para calibração — sem isso a câmera não consegue produzir leitura térmica calibrada.
- Confronto: SKUs CS/CE/CU validados como stub em campo (03002 CS020-10UM precisou PT100 externo). CI tem o sensor como parte funcional do produto, não vestigial.
- **Mesmo assim:** a regra "always verify on the actual unit before deploying" se aplica.

Thresholds de alerta (a confirmar com datasheet quando o lote chegar):
- Warn: `device_temp_sensor > 60 °C`
- Critical / shutdown coordenado: `> 75 °C`

## 5. Deploy

- 4 containers/forks do `camera-acquisition`, 1 por câmera, mesma config exceto `name`/`cam_id`.
- `CROP=false` (IR 640×512 fixo, sem necessidade de crop dinâmico).
- `TRIGGER_SOURCE=Line0`, `TriggerMode=On` (validado em deploy-stellantis).
- `TAGS_PATH=ponto_iris.json`.
- Redis na rede Strokmatic-side (mesmo padrão `.232`, IP a definir conforme topologia do gabinete IPC).

## 6. Critérios de aceite

| # | Critério | Como verificar |
|---|---|---|
| 1 | 4 instâncias rodam estavelmente em paralelo a 50 fps por ≥ 1 h sem perda de frame > 0,1% | log + counter `frame_count` |
| 2 | Cada frame publicado no Redis DB2 traz todos os 13 campos novos (PVI, Style, 4 axis, LongPos, scan_started_at, 3 device_temps + part_uuid) | `check_fields()` extendido + sample inspect |
| 3 | `scan_started_at` é idêntico em todos os frames de uma mesma varredura e muda só na próxima borda de subida | sample 2 varreduras consecutivas |
| 4 | Δt = `frame_captured_at - scan_started_at` é monotônico crescente dentro de uma varredura | sanity check downstream |
| 5 | `DeviceTemperature` retorna valor não-estático (validação seção 4.4) | log 5 min com grab |
| 6 | health-monitor WS consegue ler `Camera_<id>/device_temp_sensor` do Redis DB2 e dispara alerta simulado em > 60 °C | injeção sintética |

## 7. Pendência arquitetural — heartbeat WS↔PLC (fora deste spec)

Hoje a comunicação plc-monitor↔Logix é **classe 3** (explicit messaging, read-only do lado Workstation). Para o PLC saber se a Workstation está viva, três caminhos possíveis:

- **(a)** plc-monitor escreve tag `WS_Heartbeat` no Logix periodicamente via explicit-write (latência típica 100-500 ms).
- **(b)** Upgrade plc-monitor para **classe 1** (cyclic I/O, latência < 20 ms).
- **(c)** PLC opera sem feedback de saúde da Workstation (status quo).

Decisão a tomar com Willer/Vinicius. **Não bloqueia IRIS-02** — opção (c) é default até decisão tomada. Levar para discussão na próxima reunião de design 03007.

## 8. Próximos passos

1. **User review** deste design — alinhamento sobre o catálogo de tags, em especial nomes definitivos (`WS_Axis3A_Pos` vs `WS_AxisCurtainL_Pos`, etc.). Alinhar com Willer (esquemático NXG).
2. Spec do `plc-monitor` para IRIS — análoga, fora deste documento (seria IRIS-02 lado server-PLC). Confirmar com Pedro se já existe ou se entra como adendo.
3. Plan de implementação (`docs/superpowers/plans/2026-05-13-iris-02-pipeline-trigger-sync.md`) com tarefas TDD após design aprovado.
4. Validação `DeviceTemperature` agendada como subtask de **[2.16] Entrega câmeras + framegrabber Hikrobot** (868jk1h5y).
