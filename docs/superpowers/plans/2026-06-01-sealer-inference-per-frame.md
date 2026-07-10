---
type: Implementation Plan
title: Plan — vk-inference profile `sealer-per-frame`
description: Total: ~6 dias de William.
timestamp: 2026-06-01
---

# Plan — vk-inference profile `sealer-per-frame`

**Spec:** `docs/superpowers/specs/2026-06-01-sealer-inference-per-frame-design.md`.
**Repo:** `visionking/services/inference`.
**Dev:** William (único).
**Branch base:** current `develop`.
**Branch de trabalho:** `feat/inference-sealer-per-frame`.
**Deadline:** alinhado ao Q3 (comissionamento Hyundai). Depende do SEALER-01 update (Plan irmão) para o producer.

---

## Estratégia

- Output **FROZEN** (spec §7) é a invariante load-bearing — qualquer mudança quebra o pixel-to-object. Garantir via Pydantic + contract test desde o Track B.
- Método de análise (YOLO/HSV) atrás de `WindowAnalyzer` Protocol. Phase 1 entrega `MockAnalyzer` + **um** de produção (HSV recomendado por latência).
- 6 tracks. Cada task = commit por TDD step.

---

## Track A — Profile scaffolding

> Bloqueia tudo. Estima-se 0.5 dia.

### A.1 Registrar profile `sealer-per-frame` no `vk-inference`
- **Test first:** `tests/profiles/test_profile_loader.py`:
  - `test_loads_sealer_per_frame_profile()` — `INF_PROFILE=sealer-per-frame` carrega módulo `profiles.sealer_per_frame`.
  - `test_fails_on_unknown_profile()` — env inválido → boot falha com erro claro.
- **Implementar:** seguir pattern dos profiles existentes (laminação, carrocerias). Criar `services/inference/src/profiles/sealer_per_frame/__init__.py`.
- **Critério:** 2 testes verdes + smoke `INF_PROFILE=sealer-per-frame python vk-inference.py` boot sem erro.

### A.2 Esqueleto de módulo (vazios, com Protocol)
- **Files:**
  - `profiles/sealer_per_frame/consumer.py` — handler com TODO.
  - `profiles/sealer_per_frame/envelope_parser.py` — Pydantic stubs.
  - `profiles/sealer_per_frame/sampler.py` — função stub.
  - `profiles/sealer_per_frame/analyzers/base.py` — `WindowAnalyzer` Protocol + `WindowResult` dataclass.
  - `profiles/sealer_per_frame/analyzers/mock.py` — stub.
  - `profiles/sealer_per_frame/publisher.py` — stub.
- **Critério:** `mypy` limpo no diretório.

---

## Track B — Envelope parser (FROZEN contracts)

> Bloqueia C/D/E. Estima-se 1 dia.

### B.1 Pydantic do envelope de input
- **Test first:** `tests/test_envelope_parser_input.py`:
  - `test_parses_full_envelope()` com fixture da spec §4.
  - `test_rejects_missing_centerline_projected()`.
  - `test_rejects_missing_frame_image_path()`.
  - `test_rejects_px_per_mm_zero_or_negative()`.
  - `test_accepts_missing_tangent_uv_as_none()`.
  - `test_rejects_unknown_field()` — modelo strict para detectar contract drift.
- **Implementar:** modelos `InputEnvelope`, `CenterlinePoint` em `envelope_parser.py`.
- **Critério:** 6 testes verdes.

### B.2 Pydantic do envelope de output (FROZEN)
- **Test first:** `tests/test_envelope_parser_output.py`:
  - `test_emits_required_envelope_fields()` — todos os pass-through presentes.
  - `test_emits_detection_required_fields_per_frozen_spec()` — `bead_id`, `bead_name`, `segment_idx`, `presence`, `anchor_uv`, `confidence` sempre presentes.
  - `test_presence_true_requires_centerline_uv_observed_and_width_mm()`.
  - `test_presence_false_emits_null_for_observed_fields()`.
  - `test_round_trip_json_serializable()`.
- **Implementar:** `OutputEnvelope`, `Detection` em `envelope_parser.py`.
- **Critério:** 5 testes verdes.

### B.3 Contract test cruzado com pixel-to-object
- **Test first:** `tests/test_contract_with_pixel_to_object.py`:
  - Carregar fixture de input do pixel-to-object multi-profile (`Detection` schema), produzir output desta inference, validar que o pixel-to-object parser aceita sem erro.
- **Implementar:** fixture sincronizada + assertion cruzada.
- **Critério:** verde. **Esta é a salvaguarda do contrato FROZEN.**

---

## Track C — Sampler

> Pode iniciar após A.2. Estima-se 1 dia.

### C.1 `WINDOW_MODE=fixed`
- **Test first:** `tests/test_sampler.py`:
  - `test_fixed_side_px_independent_of_px_per_mm()` — env `INF_SEALER_WINDOW_SIDE_PX=128` → patch 128×128 para qualquer `px_per_mm`.
- **Implementar:** branch fixed em `sampler.py`.
- **Critério:** verde.

### C.2 `WINDOW_MODE=dynamic`
- **Test first:**
  - `test_dynamic_side_derived_from_expected_and_px_per_mm()` — `K=2.5, expected_w=20mm, expected_h=4mm, px/mm=8 → side = round(2.5 × 20 × 8) = 400`.
  - `test_dynamic_uses_max_of_w_and_h()`.
- **Implementar:** branch dynamic.
- **Critério:** 2 testes verdes.

### C.3 Crop axis-aligned + bounds checks
- **Test first:**
  - `test_crop_axis_aligned_no_warp()` — patch puro (sem rotação); pixel central = pixel original em `(u,v)`.
  - `test_crop_rejected_when_out_of_bounds()` — defensive.
  - `test_crop_rejected_when_side_below_min()` — `INF_SEALER_MIN_WINDOW_SIDE_PX`.
- **Implementar:** crop + bounds + reject logic.
- **Critério:** 3 testes verdes.

---

## Track D — Analyzers

> Depende de B.2 (WindowResult contract). Estima-se 1 dia para Mock + 1–2 dias para HSV.

### D.1 `MockAnalyzer`
- **Test first:** `tests/analyzers/test_mock.py`:
  - `test_deterministic_by_anchor_uv()` — mesmo input → mesmo output.
  - `test_presence_distribution_balanced()` — sob N anchors, ~50% presence true.
  - `test_returns_valid_window_result()` — sempre conforma com `WindowResult`.
- **Implementar:** `mock.py` com hash determinístico.
- **Critério:** 3 testes verdes.

### D.2 `HsvAnalyzer` (produção candidate, latência baixa)
- **Test first:** `tests/analyzers/test_hsv.py`:
  - `test_detects_blob_within_hsv_range()` — patch sintético com blob colorido, HSV range cobre a cor → presence=true.
  - `test_no_detection_outside_range()` — patch sem cor calibrada → presence=false.
  - `test_centerline_offset_at_blob_centroid()`.
  - `test_width_mm_from_blob_minor_axis_via_pca()` — PCA do blob; eixo menor convertido a mm via px/mm.
  - `test_uses_tangent_uv_hint_when_provided()` — se hint dado, mede largura perpendicular à tangente em vez de PCA.
  - `test_confidence_equals_coverage_ratio()` — fração de pixels positivos.
  - `test_reads_hsv_ranges_from_redis()` — `INF_SEALER_HSV_RANGES_REDIS_KEY` carrega array de ranges.
- **Implementar:** OpenCV inRange + connectedComponents + PCA. Sem ML.
- **Critério:** 7 testes verdes.

### D.3 (Slot) `YoloAnalyzer`
- **Status:** **Slot reservado, implementação deferida** até decisão (HSV em produção como Phase 1). O `WindowAnalyzer` Protocol permite plug-in sem refactor.
- **Test stub:** `test_yolo_analyzer_raises_not_implemented()` (sentinel — remove quando implementar).

---

## Track E — Consumer + publisher

> Depende de B + C + D.1 (Mock). Estima-se 1 dia.

### E.1 Consumer wiring
- **Test first:** `tests/test_consumer.py`:
  - `test_consumer_parses_input_runs_sampler_runs_analyzer_publishes_output()` — wire end-to-end com `MockAnalyzer`.
  - `test_skips_empty_centerline_projected_with_empty_detections()` — frame sem pontos in-FOV → envelope output com `detections=[]`.
  - `test_emits_one_message_per_input()` — 1 input msg → 1 output msg, sem batching.
- **Implementar:** loop no `consumer.py`.
- **Critério:** 3 testes verdes.

### E.2 Publisher (`sealer-detection-queue`)
- **Test first:** `tests/test_publisher.py`:
  - `test_publishes_to_configured_queue()`.
  - `test_serializes_per_output_pydantic()`.
- **Implementar:** publisher sobre aio-pika.
- **Critério:** 2 testes verdes.

### E.3 Error handling
- **Test first:** `tests/test_error_handling.py`:
  - `test_missing_frame_image_path_nacks_to_dlx()`.
  - `test_analyzer_exception_nacks_with_requeue_then_dlx_after_n_retries()`.
- **Implementar:** branches no consumer.
- **Critério:** 2 testes verdes.

---

## Track F — Cross-cutting

### F.1 Compose env vars + Redis HSV ranges
- Compose `infra/compose/sealer/inference.yml` com:
  - `INF_PROFILE=sealer-per-frame`
  - `INF_RABBIT_INPUT_QUEUE=sealer-inference-queue`
  - `INF_RABBIT_OUTPUT_QUEUE=sealer-detection-queue`
  - `INF_SEALER_ANALYZER=mock` (default em dev/CI) / `hsv` (staging)
  - `INF_SEALER_WINDOW_MODE=fixed` `INF_SEALER_WINDOW_SIDE_PX=128`
- Seed Redis com `sealer:hsv_ranges` (range placeholder; calibração operacional).
- **Critério:** review.

### F.2 README + docstrings
- `services/inference/src/profiles/sealer_per_frame/README.md`:
  - Explica o profile.
  - Lista env vars.
  - Documenta cada analyzer + qual usar em qual ambiente.
  - Aponta para o spec FROZEN.
- **Critério:** review.

### F.3 CI: rodar com `INF_PROFILE=sealer-per-frame`
- Jobs novos com matriz `analyzer=[mock]` (HSV depende de Redis seed; rodar em integ E2E separado).
- **Critério:** PR CI verde.

### F.4 Smoke E2E sintético
- Script `tests/smoke/sealer_per_frame_smoke.py`:
  - Gera 1 frame sintético + envelope com 10 pontos.
  - Publica no `sealer-inference-queue`.
  - Aguarda mensagem no `sealer-detection-queue`.
  - Valida shape do output contra Pydantic.
- **Critério:** roda em <10 s no CI.

---

## Ordem sugerida (single dev)

```
Dia 1:    A.1 → A.2 → B.1 → B.2          (scaffolding + envelope FROZEN)
Dia 2:    B.3 → C.1 → C.2 → C.3          (contract test + sampler)
Dia 3:    D.1 → E.1 → E.2                (mock + wiring)
Dia 4–5:  D.2                              (HSV implementation + Redis seed)
Dia 5:    E.3 → F.1 → F.2                (error handling + cross-cutting)
Dia 6:    F.3 → F.4                       (CI + smoke)
```

Total: ~6 dias de William.

## Riscos & mitigações

- **R1: Contrato FROZEN drift** — B.3 (contract test cross-repo) é a salvaguarda; falha imediatamente se pixel-to-object não aceita.
- **R2: HSV ranges não calibrados em campo** — D.2 lê de Redis; calibração operacional pré-comissionamento. Mock fallback no CI.
- **R3: Latência HSV maior do que estimado** — bench em F.4 valida; se > limite, considerar batched processing ou reduzir N pontos via decimation upstream.
- **R4: Producer SEALER-01 publica envelope levemente diferente** — Pydantic strict no B.1 detecta drift no primeiro smoke. Coordenar com plano SEALER-01 no Dia 1.
- **R5: YOLO decidido depois** — Track D.3 está reservado; sem refactor necessário, só implementar a classe quando a decisão chegar.

## Critérios de sucesso

- Todos os tracks verde em CI.
- Smoke E2E sealer (point-cloud-processor → sealer-inference-queue → inference → sealer-detection-queue → pixel-to-object) **end-to-end com MockAnalyzer** em <30s wall clock.
- HSV produzindo detections plausíveis em frame real Hyundai (post-comissionamento).
- Contract test cruzado com pixel-to-object verde.
