---
type: Implementation Plan
title: Plan — pixel-to-object multi-profile (body + sealer)
timestamp: 2026-06-01
---

# Plan — pixel-to-object multi-profile (body + sealer)

**Spec:** `docs/superpowers/specs/2026-06-01-pixel-to-object-multi-profile-design.md`
**Dev:** William (único).
**Branch base:** `feat/kalman-filter`.
**Branch de trabalho:** `feat/multi-profile` (criar a partir de `feat/kalman-filter`).
**Deadline crítico:** **09/06** para Fase 1 (profile `body` em produção IRIS-03). Slip esperado 2–3 dias por overhead do profile scaffolding.

---

## Estratégia geral

- TDD onde a lógica é nova/sutil (Tracks A.2, C.1, C.3).
- Os hooks no core são tão pequenos (~5 linhas cada) que ficam atrás de feature flag por profile — regression tests dos profiles `body` garantem zero impacto sem ativação.
- 4 tracks, executados nesta ordem por dependência:
  - **A — Profile scaffolding** (bloqueia tudo)
  - **B — Body/IRIS-03 deploy** (deadline 09/06; pode rodar em paralelo com C depois de A)
  - **C — Sealer hooks** (per-frame + bead/segment prior)
  - **D — Cross-cutting** (calibração, deploy, smoke, CI)
- Cada track tem tarefas TDD numeradas. Commit por tarefa.

---

## Track A — Profile scaffolding

> **Bloqueia B e C.** Estima-se 1.5–2 dias.

### A.1 Introduzir `config.py` com `PROFILES` dict + `ProfileConfig` dataclass
- **Test first:** `tests/test_config.py`:
  - `test_profile_body_defaults()` — flags esperadas para body.
  - `test_profile_sealer_defaults()` — flags esperadas para sealer.
  - `test_invalid_profile_raises()` — `load_profile('xpto')` levanta.
- **Implementar:** `src/config.py` com `@dataclass` e dict `PROFILES`. Função `load_profile(name) -> ProfileConfig`.
- **Critério:** 3 testes verdes.

### A.2 Leitura de `VK_PROFILE` em `server.py` + propagação
- **Test first:** `tests/test_server_profile.py`:
  - `test_server_loads_body_profile_from_env()` — `VK_PROFILE=body` → server usa config esperada.
  - `test_server_fails_on_missing_profile()` — sem env var → erro claro.
  - `test_server_passes_profile_to_sequence_manager()` — `SequenceManager` recebe `ProfileConfig`.
- **Implementar:** ler env, passar `cfg` para `SequenceManager`, que repassa para `DefectTrackManager`, `DefectAggregator`, `transformer`.
- **Atenção:** `transformer.py` hoje é módulo com funções de top-level — vai precisar virar classe `Transformer(cfg)` ou aceitar `cfg` por argumento. Preferir argumento por simplicidade.
- **Critério:** 3 testes verdes + smoke manual com `VK_PROFILE=body` rodando o serviço com mock RabbitMQ.

### A.3 Regression: profile `body` puro produz output **byte-idêntico** ao da `feat/kalman-filter` para input fixo
- **Test first:** `tests/test_regression_body.py`:
  - Gravar um seed de mensagens (fixture) que rodava na `feat/kalman-filter`.
  - Rodar pelo novo pipeline com `VK_PROFILE=body`, comparar output agregado.
- **Implementar:** ajustar hooks até bater. Esta é a **safety net** do Track B.
- **Critério:** Diff byte-zero (ou semanticamente zero — comparação de campos relevantes).

### A.4 Commit + push branch `feat/multi-profile`
- Mensagem: `feat(pixel-to-object): introduce VK_PROFILE mechanism (body|sealer)`

---

## Track B — Profile `body` (deploy IRIS-03)

> Equivalente ao IRIS-03 original. Após A.3 passar, este track pode acontecer em paralelo com C.

### B.1 Pass-through `scan_started_at`
- **Test first:** `tests/test_scan_started_at.py`:
  - `test_scan_started_at_preserved_through_pipeline()` — entrada com timestamp, saída agregada com o mesmo valor.
  - `test_scan_started_at_consistent_across_frames_of_sequence()` — todos os frames da mesma sequência mantêm valor único.
- **Implementar:** adicionar campo no parsing do envelope (`server.py`), persistir no `SequenceContext`, propagar em `_build_defect_message` (`defect_aggregator.py`).
- **Critério:** 2 testes verdes.

### B.2 Validação do contrato IRIS-02
- **Não-código:** documento de alinhamento curto (1 página) circulado com IRIS-02 (Vinicius/Joshua), confirmando schema do `camera_current_position` (axis_1/axis_2/axis_3a/axis_3b) e `scan_started_at`. Marcar como aceito por escrito antes de B.4.
- **Critério:** confirmação por escrito recebida.

### B.3 Calibração extrínseca das 4 câmeras IR
- **Atividade operacional**, não código novo. Rodar `calibration_app.py` 4× (1 por câmera), salvar via `ConfigManager` no Redis do ambiente IRIS, validar hot-reload.
- **Critério:** 4 calibrações no Redis + smoke de hot-reload (mudar 1 calibração, observar log do pixel-to-object).

### B.4 Compose IRIS + smoke 4-câmera
- **Implementar:** `infra/compose/iris/pixel-to-object.yml` com `VK_PROFILE=body` e env vars referenciando Redis/RabbitMQ do ambiente IRIS.
- **Smoke:** 4 producers mock (1 por câmera), 60 s de varredura sintética, validar que 4 streams agregados chegam ao output queue e que `defeitos_agg` no Postgres recebe linhas com `peca=PVI` esperado.
- **Critério:** smoke verde + screencap do estado do banco anexado ao ClickUp [3.3].

### B.5 Deploy em produção IRIS
- **Critério:** serviço rodando no host TBD, consumindo do `camera-acquisition` real, 1 carroceria real processada end-to-end. ClickUp [3.3] fechado.

---

## Track C — Profile `sealer`

> Pode iniciar após A.3 verde, em paralelo com B. Estima-se **2–3 dias** (down de 4–5 da versão anterior — sem `CenterlineProjector` interno).

### C.1 Extração da primitiva `project_to_3d` no `transformer.py`
- **Test first:** `tests/test_transformer_primitive.py`:
  - `test_project_to_3d_raycasts_uv_to_mesh_point()`
  - `test_project_box_to_3d_wraps_project_to_3d_at_center()` — regression: comportamento body inalterado.
- **Implementar:** extrair raycast primitivo `project_to_3d(uv, pose, mesh) → (p3d, normal, face_id)`. `project_box_to_3d` vira wrapper que chama `project_to_3d(center(box), pose, mesh)`.
- **Critério:** 2 testes verdes + A.3 (regression body) continua passando byte-idêntico.

### C.2 Parsing do envelope sealer + skip absence
- **Test first:** `tests/test_server_sealer_envelope.py`:
  - `test_parses_detections_array_with_bead_id_name_segment_uv()`
  - `test_skips_presence_false_detections()`
  - `test_routes_presence_true_to_raycast_with_uv_observed()` — passa `centerline_uv_observed` para `project_to_3d`, não centro de box.
  - `test_carries_width_mm_through()` — pass-through de métrico per-detecção.
- **Implementar:** novo path de parsing no `server.py` quando `cfg.profile == 'sealer'`. Construir `Detection3D` carregando `bead_id`, `bead_name`, `segment_idx`, `width_mm` direto do envelope.
- **Critério:** 4 testes verdes.

### C.3 Hook em `DefectTrackManager._compute_cost`
- **Test first:** `tests/test_defect_track_manager_sealer.py`:
  - `test_cost_infinity_when_bead_id_differs()`
  - `test_cost_infinity_when_segment_differs()`
  - `test_cost_mahalanobis_when_tags_match()` — sanity de que o cutoff não afeta o caminho normal.
  - `test_track_inherits_bead_id_name_segment_from_first_detection()` — fundamental para o cutoff funcionar.
- **Implementar:** branch no `_compute_cost` (compara `bead_id` int, não `bead_name`) + atribuição `track.bead_id, track.bead_name, track.segment_idx = first_detection.bead_id, first_detection.bead_name, first_detection.segment_idx` na criação da track tentativa.
- **Critério:** 4 testes verdes.

### C.4 Hook em `DefectAggregator._build_defect_message`
- **Test first:** `tests/test_aggregator_sealer.py`:
  - `test_output_message_carries_bead_id_name_segment_width_when_sealer()`
  - `test_output_message_omits_sealer_fields_when_body()` — backward compat.
- **Implementar:** adicionar `bead_id`, `bead_name`, `segment_idx`, `width_mm` (median ou last da sequência) como campos opcionais. Validar que `database-writer` (consumer body) ignora graciosamente.
- **Critério:** 2 testes verdes.

### C.5 Scenario test — cordões paralelos
- **Test first:** `tests/test_scenario_parallel_beads.py`:
  - Cenário sintético: 2 cordões paralelos em Y=+25 e Y=-25, detections fabricadas com tags corretas mas pose ruidosa em Y (Mahalanobis 3D puro associaria errado).
  - Rodar pipeline completo com `VK_PROFILE=sealer`.
  - Asserção: nenhuma track confirmada cruza beads (cutoff ∞ bloqueia).
- **Critério:** verde sem flake (10× consecutivos).

### C.6 Compose sealer + smoke E2E
- **Implementar:** `infra/compose/sealer/pixel-to-object.yml` com `VK_PROFILE=sealer` apontando para Redis/RabbitMQ Hyundai.
- **Smoke:** mock producer reproduzindo envelope `detections[]` sintético da carroceria HB20-5D. Validar que `sealer-result` recebe mensagens com `bead_name` + `segment_idx` + `width_mm`.
- **Critério:** smoke verde.

---

## Track D — Cross-cutting

### D.1 Backward compat do output body
- **Test:** consumer `database-writer` recebe mensagem com campos `bead_name=None, segment_idx=None` sem erro (smoke contra fixture do database-writer).
- **Critério:** verde.

### D.2 README + docstrings de profile
- Atualizar `services/pixel-to-object/README.md` com:
  - Seção "Profiles" explicando `VK_PROFILE`.
  - Como rodar com cada profile localmente.
  - Apontamentos para esta spec.
- **Critério:** review do William.

### D.3 CI matrix
- `pytest` rodado com `VK_PROFILE=body` E `VK_PROFILE=sealer` em jobs separados (mesmos testes; cada job pula testes incompatíveis via pytest mark).
- **Critério:** ambos jobs verdes na PR.

### D.4 Apagar spec antiga IRIS-03
- `rm docs/superpowers/specs/2026-05-13-iris-03-pixel-to-object-design.md`
- Já feita ao publicar este plan (parte do mesmo commit).
- **Critério:** arquivo ausente em `develop`.

---

## Ordem sugerida de execução (single dev)

```
Dia 1–2:  A.1 → A.2 → A.3 → A.4   (profile scaffolding)
Dia 3:    B.1 + B.2                (paralelo: assíncrono ao Vinicius)
Dia 4:    B.3 + B.4                (calibração + smoke)
Dia 5:    B.5  ← deadline 09/06 alvo aqui (slip 2–3 dias previsto)
Dia 6:    C.1 + C.2                 (transformer primitive + envelope parsing)
Dia 7:    C.3 + C.4                 (cutoff + aggregator)
Dia 8:    C.5 + D.1                 (scenario test + backward compat)
Dia 9:    C.6                        (smoke E2E sealer)
Dia 10:   D.2 + D.3 + D.4           (cleanup)
```

## Riscos & mitigações

- **R1: 09/06 slip > 5 dias** — fallback é mergear `feat/kalman-filter` sem profile scaffolding, deploy IRIS-03 puro, profile scaffolding em PR seguinte. Custo: precisa refazer trabalho do Track A na hora de iniciar sealer.
- **R2: contrato IRIS-02 ainda não confirmado em 09/06** — B.5 fica pendente. Solução: documentar bloqueio no ClickUp [3.3], promover B.4 para "smoke pronto, awaiting integration".
- **R3: contrato `detections[]` upstream não fechado** — Track C.2 e C.5/C.6 dependem do envelope publicado pela inference sealer per-frame (spec a escrever). Solução: travar o contrato no documento de design da nova inference spec antes da implementação de C.2; até lá, usar fixture sintética compatível com a proposta da §7.2.
- **R4: hooks contaminam o caminho `body`** — A.3 (regression byte-idêntica) é a salvaguarda. Se quebrar em B.x, voltar e ajustar gating.

## Critérios de sucesso do plan

- Profile `body` em produção IRIS no host alvo, com smoke validado.
- Profile `sealer` validado em smoke E2E sintético; pronto para receber centerline real Hyundai na demo Q3.
- Todos os testes verdes em CI matrix (`body` + `sealer`).
- Spec antiga IRIS-03 removida; nova spec é o documento canônico.
