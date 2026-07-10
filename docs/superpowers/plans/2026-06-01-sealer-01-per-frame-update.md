---
type: Implementation Plan
title: Plan — SEALER-01 per-frame projection update
description: Total: ~5 dias de William.
timestamp: 2026-06-01
---

# Plan — SEALER-01 per-frame projection update

**Spec:** `docs/superpowers/specs/2026-04-13-sealer-01-point-cloud-processor-design.md` (revision 2026-06-01).
**Original plan:** `docs/superpowers/plans/2026-04-13-sealer-01-point-cloud-processor.md` — covers Stages 1–5; this is a **delta plan** for the post-pivot changes.
**Dev:** William (único).
**Branch base:** current `develop` of `visionking/services/point-cloud-processor`.
**Branch de trabalho:** `feat/sealer01-per-frame-projection`.
**Deadline:** alinhado ao Q3 (comissionamento Hyundai). Não compete com IRIS-03 (09/06).

---

## Estratégia

- TDD onde a matemática é nova (Track D — projeção pinhole + tangent + px/mm).
- Track C primeiro (delete) porque é trivial e libera espaço no repo.
- Track A (state refactor — manter N clouds em memória) precede B e D porque ambos consomem essas clouds.
- 6 tracks. Cada task = commit por TDD step.

---

## Track A — Per-frame translated cloud retention (refactor)

> Pre-req para B e D. Estima-se 0.5 dia.

### A.1 Manter `frames_translated: list[PointCloud]` no resultado do Stage 3
- **Test first:** `tests/test_registration.py` — adicionar `test_returns_per_frame_translated_clouds_in_order()` validando que o output preserva a ordem por encoder e o conteúdo de cada cloud.
- **Implementar:** alterar `pipeline/registration.py` para retornar `(merged_input_for_stage4, frames_translated)` em vez de só a lista para merge.
- **Compat:** Stage 4 (merge) continua recebendo a lista; assinatura interna ajustada.
- **Critério:** regression dos testes existentes + novo teste verde.

### A.2 Propagar até Stage 6/7
- **Test first:** integração — `tests/test_pipeline_smoke.py` valida que `frames_translated` está disponível na entrada do Stage 6.
- **Implementar:** thread o list através do pipeline runner.
- **Liberação seletiva:** quando `PCP_DEPTH_MAP_ENABLED=false`, soltar a lista após Stage 5 (memory note do spec §10).
- **Critério:** smoke passa nos 2 modos (enabled/disabled) sem leaks.

---

## Track C — Stitching removal

> Independente. Estima-se 0.5 dia. Pode rodar em paralelo a A.

### C.1 Delete módulos + testes
- **Files:**
  - `src/pipeline/stitching.py` → delete
  - `tests/test_stitching.py` → delete
- **Refs no código:** procurar imports `from pipeline.stitching import` e remover.
- **Critério:** `git grep -i stitch services/point-cloud-processor/src` retorna 0 hits (ignorando comentários históricos no spec).

### C.2 Remover Stage 6 do pipeline runner
- **Test first:** `tests/test_pipeline_orchestration.py` — adicionar `test_pipeline_skips_stitching_stage()` validando que o orchestrator não tenta importar/rodar stitching.
- **Implementar:** remover a chamada ao stage no orchestrator + a remap pre-computation no startup.
- **Critério:** smoke da pipeline rodando do começo ao fim, sem stitching.

### C.3 Remover env vars + Redis settings de stitching
- **Files:**
  - `src/utils/read_env_var.py` — remover `PCP_CAMERA_CALIBRATION_FILE` **apenas se K/D não forem usados na nova Stage 7**. Eles SÃO usados (centerline projection). **Manter o env, ajustar descrição.**
  - Settings reader — remover `sealer_image_pixels_per_mm`.
- **Critério:** unused-vars warning zero.

---

## Track B — Per-frame depth map + opt-in flag

> Depende de A. Estima-se 1.5 dias.

### B.1 Refactor `depth_map.py` para per-frame
- **Test first:** `tests/test_depth_map.py`:
  - `test_per_frame_zprojection_in_cad_frame()` — input `frames_translated` + T_part_to_CAD; output: lista de (origin_mm, resolution_mm, array) por frame; cada frame projetado em sua própria bbox.
  - `test_resolution_from_redis()` — valor de `sealer_depth_map_resolution_mm` respeitado.
- **Implementar:** loop por frame; aplicar T_part_to_CAD; projeção 2D; per-frame bbox.
- **Critério:** 2 testes verdes.

### B.2 Stage 6 gate por env `PCP_DEPTH_MAP_ENABLED`
- **Test first:** `tests/test_pipeline_orchestration.py`:
  - `test_stage6_skipped_when_disabled()` — flag false → função não chamada, output `depth_maps=[]`.
  - `test_stage6_runs_when_enabled()` — flag true → N arquivos escritos + `depth_maps[]` populado.
- **Implementar:** branch no orchestrator antes de chamar Stage 6.
- **Critério:** 2 testes verdes.

### B.3 Persistência em disco (`depth_map_{frame_uuid}.npy`)
- **Test first:** `test_per_frame_file_named_by_uuid()` valida path correto + arquivos numpy válidos.
- **Implementar:** loop de save.
- **Critério:** verde.

---

## Track D — Stage 7 (Per-frame centerline projection + fan-out)

> O biggest piece. Depende de A. Estima-se 3 dias. Pode rodar em paralelo a B depois que A.2 estiver verde.

### D.1 Carregar `sealer_centerline.json` per model_type (mtime cache)
- **Test first:** `tests/test_centerline_loader.py`:
  - `test_loads_centerline_by_model_type()`
  - `test_caches_until_mtime_changes()`
  - `test_missing_centerline_raises()` (será NACK→DLX no orchestrator)
  - `test_schema_validation_bead_id_and_points()` — falha se `bead_id` ausente ou `points` < 2.
- **Implementar:** `src/calibration/centerline_loader.py` (reutilizar pattern do `cad_loader.py`).
- **Critério:** 4 testes verdes.

### D.2 Resampling do polyline por arc length
- **Test first:** `tests/test_centerline_projection.py`:
  - `test_resample_evenly_spaced_arc_length()` — input polyline com pontos irregulares, output equidistantes ao longo do arc length, distância média = `sealer_centerline_resample_arc_length_mm`.
- **Implementar:** util em `centerline_projection.py`.
- **Critério:** verde.

### D.3 Composição de pose per-frame
- **Test first:**
  - `test_pose_composition_cad_to_camera()` — input: `T_part_to_CAD`, encoder_f, encoder_0, `shift_unit`, `p_cad`. Output: `p_cam_f`. Validar com cenário sintético.
  - `test_z_negative_rejected()` — ponto atrás da câmera filtrado.
- **Implementar:** `compose_pose(p_cad, T_part_to_cad, encoder_f, encoder_0, shift_unit) → p_cam`.
- **Critério:** 2 testes verdes.

### D.4 Projeção pinhole + distortion
- **Test first:**
  - `test_projection_matches_cv2_projectpoints()` — bater com `cv2.projectPoints(p_cam_f, rvec=0, tvec=0, K, D)` em sub-pixel para uma malha de pontos sintéticos.
- **Implementar:** wrapper sobre `cv2.projectPoints` para uniformidade de assinatura.
- **Critério:** verde com tolerância < 0.5 px.

### D.5 px/mm + tangent_uv
- **Test first:**
  - `test_px_per_mm_equals_fx_over_z()` — sintético: plano fronto-paralelo, px_per_mm = fx/Z.
  - `test_tangent_uv_for_straight_bead()` — bead reto em CAD ao longo de X; após projeção, tangent_uv ≈ (±1, 0).
  - `test_tangent_uv_unit_norm()` — sempre unitário.
- **Implementar:** `px_per_mm = fx / p_cam.z`; tangent por vizinhos projetados.
- **Critério:** 3 testes verdes.

### D.6 In-FOV filter
- **Test first:**
  - `test_in_fov_filter_keeps_points_within_margin()`.
  - `test_in_fov_filter_drops_points_outside_margin()`.
- **Implementar:** verificação `margin < u < W - margin AND margin < v < H - margin`.
- **Critério:** 2 testes verdes.

### D.7 Build envelope + publisher fan-out
- **Test first:**
  - `test_envelope_carries_per_point_fields_per_spec()` — Pydantic do envelope alinhado com `2026-06-01-sealer-inference-per-frame-design.md` §4.
  - `test_fanout_publishes_one_msg_per_frame()` — 20 frames, 20 msgs publicadas.
  - `test_empty_centerline_projected_publishes_anyway()` — frame sem pontos in-FOV ainda gera msg com array vazio.
- **Implementar:** loop por frame com publish.
- **Critério:** 3 testes verdes.

### D.8 Skip on degraded
- **Test first:** `test_stage7_skipped_when_cad_not_converged()` — `cad_registration.converged=false` → 0 msgs publicadas.
- **Implementar:** branch no orchestrator antes de chamar Stage 7.
- **Critério:** verde.

---

## Track E — Output message bifurcation (sealer-measurement-queue)

> Pequeno mas crítico. Estima-se 0.5 dia.

### E.1 Atualizar publisher do consolidated msg
- **Test first:** `tests/test_publisher_measurement.py`:
  - `test_omits_stitched_image_path()`.
  - `test_emits_empty_depth_maps_when_disabled()`.
  - `test_emits_populated_depth_maps_when_enabled()`.
  - `test_keeps_cad_registration_block()`.
- **Implementar:** ajustar build do envelope; remover campos antigos.
- **Critério:** 4 testes verdes.

### E.2 Validar SEALER-03 ainda consome OK
- **Integration:** subir compose com SEALER-03 dummy + SEALER-01 atualizado, varrer 1 part sintética, verificar SEALER-03 não NACKs por schema mismatch.
- **Critério:** smoke verde.

---

## Track F — Cross-cutting

### F.1 Compose env vars
- Adicionar `PCP_DEPTH_MAP_ENABLED=false` no `infra/compose/sealer/point-cloud-processor.yml`.
- Confirmar `PCP_RABBIT_INFERENCE_QUEUE=sealer-inference-queue` (mesmo nome do antigo).
- **Critério:** review.

### F.2 README + observability
- Atualizar `services/point-cloud-processor/README.md` com nova arquitetura (stitching gone; per-frame stage; opt-in depth map).
- Atualizar campos do log estruturado (`depth_map_ms` semântica + `centerline_projection_ms` + `inference_messages_published`).
- **Critério:** review.

### F.3 Cross-refs em outras specs
- Já aplicados no commit de docs (SEALER-03 §3.1, Provisioning CLI [4.9], DB Schema, banners SEALER-05/-09). Apenas confirmar visualmente.

---

## Ordem sugerida (single dev)

```
Dia 1:    C.1 → C.2 → C.3            (stitching delete — limpa o terreno)
Dia 1–2:  A.1 → A.2                   (state refactor)
Dia 2–3:  D.1 → D.2 → D.3 → D.4 → D.5 (centerline projection — core math, TDD)
Dia 4:    D.6 → D.7 → D.8             (filter + publisher + skip degraded)
Dia 4:    B.1 → B.2 → B.3             (per-frame depth map em paralelo)
Dia 5:    E.1 → E.2                   (output bifurcation + integ smoke)
Dia 5:    F.1 → F.2                   (cleanup)
```

Total: ~5 dias de William.

## Riscos & mitigações

- **R1: cv2.projectPoints assina diferente do esperado** — D.4 escrito como wrapper para isolar; mitigação testada via fixture sintética.
- **R2: shift_unit_vector convention errada** — D.3 inclui teste explícito; cenário sintético com ICP truth.
- **R3: SEALER-03 quebra por schema mismatch** — E.2 antecipa via smoke compose; se quebrar, ajustar Pydantic do SEALER-03 (já tem cross-ref no §3.1 da spec dele).
- **R4: hardware Hyundai entrega depois do cronograma** — irrelevante; smoke roda com PLY/BIN sintéticos.

## Critérios de sucesso

- Todos os testes do Track verde em CI.
- Smoke E2E: 1 part sintética → 1 msg `sealer-measurement-queue` + N msgs `sealer-inference-queue` com envelope FROZEN.
- Smoke com `PCP_DEPTH_MAP_ENABLED=true` e `false` — ambos verdes.
- Cycle time medido ≤ 9 s (com depth map on); ≤ 8 s (off).
