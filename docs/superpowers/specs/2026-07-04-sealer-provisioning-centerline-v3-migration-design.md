---
type: Design Spec
title: Sealer Provisioning — Centerline v3 Migration (design)
description: The proven bead-centerline extraction lives as ad-hoc research scripts in the PMO project (`pmo/projects/03008/analysis/`), not in the product. The `toolkit/sealer-provisioning` package *has* a `ce...
timestamp: 2026-07-04
---

# Sealer Provisioning — Centerline v3 Migration (design)

**Project:** 03008 (Hyundai sealer, VisionKing) → VK monorepo `toolkit/sealer-provisioning`<br>
**Date:** 2026-07-04<br>
**Author:** Pedro Teruel<br>
**Status:** Phases A + B DONE, code committed (`feat/sealer-provisioning-cli` @ `74357f75`); PMO research scripts removed after byte-exact proof (2026-07-05)<br>
**Supersedes extraction engine of:** `docs/superpowers/specs/2026-05-06-sealer-provisioning-cli-design.md`

## 1. Motivation

The proven bead-centerline extraction lives as ad-hoc research scripts in the PMO
project (`pmo/projects/03008/analysis/`), not in the product. The
`toolkit/sealer-provisioning` package *has* a `centerline-extractor` CLI, but its
extraction engine (PCA `cad-bodies` + `robot-path`) is **stale scaffolding that was
never run for real** — the working method is the **cap-seeded march + refine (v3)**
pipeline. This migration makes v3 the canonical extractor inside the product and
retires the unused paths, so a new car model is onboarded with a supported tool
rather than a folder of research scripts.

## 2. Scope decisions (confirmed 2026-07-04)

| # | Decision |
|---|---|
| 1 | **Retire `robot-path`** (fallback) and **retire PCA `cad-bodies`** — both unused. |
| 2 | **v3 cap-seeded is the canonical** `centerline-extractor` engine. |
| 3 | **Automatic cap detection ports** (`detect-caps`); the **manual cap correction stays in the GUI (Phase 2)** — the CLI consumes a confirmed `end_faces.json`. |
| 4 | Commit a **trimmed `BC4B_CUV` fixture** (a few beads) for a golden regression test. |
| 5 | Keep the package's bones: Click wiring, `Centerline` schema (`validator.py`), `manifest.py`, `sealer-validator`, `step2stl`, packaging, two-venv build. |

## 3. Source → destination mapping

**Ports into `toolkit/sealer-provisioning/src/sealer_provisioning/`:**

| PMO source (`analysis/`) | Destination | Role |
|---|---|---|
| `interface_guided_centerlines.py` | `extractors/interfaces.py` (**prep**) | Pairwise interface detection → adjacency graph → **`member_bead_ids` grouping** + rough per-chain centerlines (`_v2`). Runs at input-prep, **bakes grouping into the manifest** (§5). |
| `refine_centerlines.py` | `extractors/interfaces.py` (**prep**) | Refines the rough `_v2` centerlines in place (feeds cap detection). |
| `detect_end_faces.py` | `extractors/end_caps.py` | Automatic end-cap **proposal** (facet → planarity/rectangularity → classify `end_cap`); uses the prep rough centerlines to locate tips. Output = `end_faces.json`. |
| `cap_seeded_centerlines.py` | `extractors/cap_seeded.py` | Predictor-corrector march cap→cap; multi-solid concat via the manifest grouping. |
| `refine_centerlines_v3.py` | `extractors/refine.py` | Savitzky-Golay smooth + re-cut ⟂ true tangent; arc-length resample. |
| `export_sealer_centerline.py` | fold into `centerline_extractor.py` (or `_assemble()` helper) | Attach manifest `name` + expected dims per surviving chain id → final schema. |
| `build_provisioning_input.py` | promote to `group-solids` prep (with `interfaces.py`) | Assembles `<model>/{manifest.json, beads/}` + runs the interface pass to bake grouping. |

> **Corrected understanding (2026-07-04):** the interface pass is **not** throwaway — v3
> replaced its *tracing quality* but still consumes its **grouping** (`member_bead_ids`,
> read by `cap_seeded` + `detect_end_faces`) and its **rough centerlines** (tip-seed for
> cap detection). Per Pedro: **keep the interface pass**, relocated to input-prep
> (bake-once). It ports; it is not left in PMO.

**Retire (delete or move to `legacy/`):**
`extractors/cad_bodies.py` (PCA), `parsers/` + `robot_path.py` (robot-path), and their
tests (`test_cad_bodies.py`, `test_robot_path.py`).

**Stays in PMO (research / Phase-2 GUI feed — NOT ported):**
the ~30 `viewer_*.py`, `picker.py`, `review_picks.py`, `propose_rejects.py`,
`triage_*`, and the ~1 GB `beads_only.*` / `teal_faces.*` intermediates.

## 4. New CLI shape

`centerline-extractor` stays a Click group; its subcommands become:

```
centerline-extractor group-solids \      # PREP: interface pass, bake-once
    --model-dir input/SYNTH/             # manifest.json + beads/*.stl
    --write-grouping                     # stamps member_bead_ids into manifest.json
    --rough-out work/rough_centerlines.json   # tip-seed for detect-caps

centerline-extractor detect-caps \
    --model-dir input/SYNTH/             # manifest.json (with grouping) + beads/*.stl
    --rough work/rough_centerlines.json  # tips from the prep pass
    [--overrides cap_overrides.json]     # optional manual overrides (pre-GUI)
    --output end_faces.json              # cap proposal (GUI corrects this)

centerline-extractor extract \
    --model-dir input/SYNTH/             # manifest.json carries the grouping
    --end-faces end_faces.json           # CONFIRMED caps (auto-detected + GUI-corrected)
    [--overrides centerline_overrides.json]
    --output sealer_centerline.json      # schema-valid Centerline (validator.py model)
```

`extract` runs march → refine → assemble internally (the three ex-scripts) and reads the
**grouping from the manifest** — it never touches interface geometry. The
`sealer-provision` orchestrator flow:
`step2stl` → `group-solids` → `detect-caps` → *[GUI corrects caps/grouping]* →
`extract` → `sealer-validator`.

## 5. Data contracts

- **Model input folder** (`build_provisioning_input.py` output): `<model>/manifest.json`
  + `<model>/beads/bead_NNN.stl`. Matches the existing manifest schema **except** the
  PMO manifest carries an extra per-bead `source_name` → **reconcile**: add
  `source_name` (optional) to `schemas/manifest.schema.json`, or strip it on ingest.
- **Manifest grouping (baked by `group-solids`)**: add an optional per-bead
  **`physical_bead_id`** (defaults to the solid's own `bead_id` for single-solid beads).
  Solids that form one physical bead share it (e.g. `227,228,229 → 227`). This is the
  ported `member_bead_ids`, frozen into the manifest so `extract` reads it as data.
  Reviewable/GUI-editable before `extract`.
- **`rough_centerlines.json`** (prep intermediate, working dir — not committed): rough
  per-chain centerlines from the interface pass; consumed by `detect-caps` to locate tips.
- **`end_faces.json`**: per-bead confirmed end caps (centroid + outward normal). Produced
  by `detect-caps`, corrected in the GUI. **New schema to add** (`schemas/end_faces.schema.json`)
  + a Pydantic model, so `extract` validates its input.
- **Output** `sealer_centerline.json`: unchanged — the existing `Centerline` model in
  `validator.py` (`extra="forbid"`, `bead_id≥1`, `points≥2`, `expected_*_mm>0`).

## 6. Tests

- `tests/fixtures/synth_model/` — **synthetic, non-customer** geometry (procedurally
  generated: e.g. a straight bead + a curved/U bead + a two-solid split bead as
  meshed sweeps), with a matching manifest, confirmed `end_faces.json`, and expected
  `sealer_centerline.json`. No Hyundai CAD in the repo. A generator script
  (`tests/fixtures/_gen.py`) builds them so they are reproducible and reviewable.
- `tests/test_centerline_cli.py` — replace robot-path/PCA cases with:
  `detect-caps` produces caps for the fixture; `extract` reproduces the golden centerline
  within tolerance; output passes `Centerline.model_validate` + `sealer-validator`.
- Heavy STEP/OCC-only bits stay behind the `requires_occ` marker / `.venv-occ`.

## 7. Docs

- Rewrite the extractor sections of `2026-05-06-sealer-provisioning-cli-design.md` (v3
  canonical; retired paths noted, not deleted from history).
- README: replace the `cad-bodies`/`robot-path` runbook with the
  `group-solids` → `detect-caps` → GUI → `extract` flow; note the manual-correction GUI
  is Phase 2.

## 8. Phasing

- **Phase A (this migration) — ✅ DONE (2026-07-04):** ported `extract` (cap_seeded +
  refine + assemble); reads grouping from the manifest + caps from `end_faces.json`.
  Synthetic golden fixture + test (straight/curved/split, no customer CAD); retired PCA +
  robot-path (+ `parsers/`); rewrote `provision` to the v3 flow; manifest schema/model gained
  `physical_bead_id` + `source_name`; docs updated. **Full suite green (36 passed, 6 OCC-
  skipped), lint clean.** Fidelity: the ported `extract_solid` reproduces the known-good
  `analysis_cuv/cap_seeded_solids.json` **byte-exact (0.0000 mm)** across an 18-bead
  stratified sample of real BC4B_CUV geometry (2-point stubs → 744-point wound beads).
  On the `feat/sealer-provisioning-cli` worktree; **not committed** (review-before-commit).
- **Phase B — ✅ DONE (2026-07-05):** ported the upstream producers — `interfaces.py`
  (`group_solids` → grouping + rough centerlines) and `end_caps.py` (`detect_caps` →
  `end_faces.json`) — wired as `group-solids` (bakes `physical_bead_id` into the manifest)
  and `detect-caps` subcommands; `provision` now runs the full auto chain. Added deps
  `networkx` + `scikit-image`. **Fidelity: `detect_caps` byte-exact vs `analysis_cuv/
  end_faces.json` (229/229 beads, 0.0000 mm, 478 caps).** `group_solids` re-derives the
  *geometrically correct* grouping from current meshes ({63,71},{67,70} — 15 shared verts,
  interface detected). **Correction (2026-07-05):** the v3 `{227,229,228}` grouping is **not
  stale numbering** — it is a genuine multi-solid physical bead whose segments meet across a
  wide 5–7 mm interface gap, so shared-vertex adjacency legitimately can't detect it (0/5
  shared verts). It lives in `manual_centerline_overrides.json` as `chain_227_229_228`
  (`{chain:[227,229,228], end_cut_back_mm:50}`) and is now plumbed through `extract` (see
  Phase A milestone). So `group-solids` auto-detects only genuine shared-vertex adjacencies;
  wide-gap chains and mirrors come from the manual-override file, by design.
- **Proven + PMO scripts removed — ✅ DONE (2026-07-05):** end-to-end fidelity gate before
  retiring the 5 PMO research scripts. Every stage now reproduces the frozen BC4B_CUV
  engineering results **byte-exact (0.0000 mm)**: `extract_solid` (march), `refine_solid`
  (**all 229 solids**), `detect_caps` (229/229), `build_chains` (chain 227 with the manual
  end-fix override); `group_solids` geometrically correct. The full-model composed `extract`
  reproduces `sealer_centerline_v3.json` for **226/227 beads** — the only diff is b75, the
  mirror (`mirror_of:76`) cross-solid **two-pass orchestration** gap (`extract_solid`
  supports mirroring via `mirror_points`; the CLI doesn't yet compute the sibling first —
  Phase C). The gate caught a real port bug: `refine_solid` preferred the stored
  `gate_radius_mm` over `main()`'s always-recompute-from-caps precedence, shifting the gate
  ~0.05 mm and flipping the second-smooth/OBB guards on beads where the two radii diverge
  (b84: 14.00 vs 14.05 → 0.12 mm). Fixed + chain-override plumbing added to `extract_model`;
  **committed `74357f75`** on `feat/sealer-provisioning-cli`. The 5 scripts
  (`cap_seeded_centerlines`, `refine_centerlines_v3`, `interface_guided_centerlines`,
  `detect_end_faces`, `export_sealer_centerline`) were then removed from
  `pmo/projects/03008/analysis/`. **Kept in PMO:** all CUV + 5DR engineering results
  (`analysis_cuv/*`, `analysis/*`, `sealer_provisioning_input/*/sealer_centerline*.json`),
  the override files, the upstream car-CAD→beads extraction pipeline, and the 19 diagnostic
  `viewer_*.py` (4 of which — `viewer_bead115_steps/steps/bead115_cap` + the superseded
  `refine_centerlines.py` — now carry dangling imports; they are read-as-reference, not run).
- **Phase C (backlog, Phase-2 GUI):** manual cap/grouping correction UI in
  `backend-sealer`; consumes/edits the manifest grouping + `end_faces.json`. **Known
  orchestration gaps to wire here (engine already supports them):** (a) the mirror override
  two-pass (compute sibling bead, reflect into the mirrored bead — the b75 case); the loop
  and chain overrides are already handled by `extract`.

## 9. Open items to close during Phase A

1. ~~**Input DAG finalization / grouping source**~~ — **DECIDED (2026-07-04):**
   **bake-once** — keep the interface pass, relocated to the `group-solids` prep step
   (§3/§4). It computes `member_bead_ids` and freezes it into the manifest as
   `physical_bead_id`, and emits the rough centerlines that `detect-caps` needs. Runtime
   `extract` reads grouping from the manifest — no interface geometry at extract time.
   Still to finalize *in code*: whether `cap_seeded_solids.json` is a true input or a
   derived intermediate of `group-solids`.
2. **Overrides naming** — PMO has both `manual_cap_overrides.json` (caps) and
   `manual_centerline_overrides.json` (centerlines). Keep them distinct: caps-override →
   `detect-caps`; centerline-override → `extract`.
3. **`source_name`** manifest field reconciliation (§5).
4. ~~**Fixture size/licensing**~~ — **DECIDED (2026-07-04):** synthesize a small
   non-customer fixture (§6); no Hyundai CAD committed.

## 10. Non-goals

Robot-path input, PCA extraction, the manual-curation GUI, ABB RAPID parsing,
`model_type` versioning (all Phase 2 / retired).

## Histórico de Mudanças

| Data | Autor | Mudança |
|---|---|---|
| 2026-07-04 | Pedro Teruel | Draft inicial — migrar a extração de centerline v3 (cap-seeded march + refine + export, hoje em `pmo/.../03008/analysis/`) para `toolkit/sealer-provisioning` como o motor canônico; aposentar PCA `cad-bodies` + `robot-path`; detecção automática de caps porta (`detect-caps`), correção manual fica na GUI (Fase 2). |
| 2026-07-04 | Pedro Teruel | Rastreado o DAG real (v3 ← v2 interface-guided). Correção: a passada de interface **não é descartável** — v3 herda dela o agrupamento `member_bead_ids` (multi-solid) e as centerlines rough (seed p/ detecção de caps). Decisão: **bake-once** — manter a passada de interface, realocada para o passo de prep `group-solids`, que grava `physical_bead_id` no manifest; o `extract` em runtime lê o agrupamento como dado. Fixture do teste = geometria sintética não-cliente. |
| 2026-07-05 | Pedro Teruel | **Fase B implementada.** Port fiel de `interface_guided`→`interfaces.py` (`group_solids`) e `detect_end_faces`→`end_caps.py` (`detect_caps`) (subagente); subcomandos `group-solids` (grava `physical_bead_id` no manifest + rough centerlines) e `detect-caps` (→ `end_faces.json`); `provision` roda a cadeia completa `step2stl→group-solids→detect-caps→extract→validate`. Deps `networkx`+`scikit-image` adicionadas. Fixture `build_adjacent_pair` (par subdividido que compartilha interface) + testes de wiring/grouping/pipeline. Suite 40/6-skip, lint limpo. **Fidelidade: `detect_caps` byte-exact vs `analysis_cuv/end_faces.json` (229/229, 0.0000 mm).** `group_solids` re-deriva agrupamento geometricamente correto ({63,71},{67,70}); o `{227,228,229}` do v3 é **stale** (numeração antiga). Nada commitado. |
| 2026-07-04 | Pedro Teruel | **Fase A implementada.** Port fiel de `cap_seeded`+`refine` (subagente) → `extractors/{cap_seeded,refine}.py`; subcomando `extract` (`centerline_extractor.py`); `provision` reescrito p/ v3; PCA `cad-bodies` + `robot-path` + `parsers/` aposentados; schema/modelo do manifest com `physical_bead_id`+`source_name`; fixture sintética + teste golden; README/commissioning. Suite verde (36/6-skip), lint limpo. **Fidelidade validada: `extract_solid` reproduz `cap_seeded_solids.json` real byte-exact (0.0000 mm) em 18 beads BC4B_CUV.** Validação end-to-end (refine+chain em dados reais) fica p/ Fase B, quando `group-solids` gera o `physical_bead_id` real. Nada commitado. |
| 2026-07-05 | Pedro Teruel | **Gate "provado" + remoção dos scripts PMO.** Prova end-to-end byte-exact (0.0000 mm) de todos os estágios (march, refine em **todos os 229 solids**, detect_caps 229/229, build_chains com override de chain); `extract` composto reproduz `sealer_centerline_v3.json` em **226/227 beads** (único diff = b75 mirror, gap de orquestração two-pass → Fase C). O gate pegou um bug de port real: `refine_solid` preferia o `gate_radius_mm` armazenado em vez de recomputar de caps como o `main()`, deslocando o gate ~0.05 mm e virando os guards second-smooth/OBB (b84 → 0.12 mm). Corrigido + plumbing do chain-override em `extract_model`; **commitado `74357f75`**. Corrigida a caracterização do `{227,229,228}`: não é numeração stale, é chain multi-solid com gap de interface largo (5–7 mm), via `manual_centerline_overrides.json`. Removidos os 5 scripts migrados de `pmo/.../03008/analysis/`; **preservados** todos os resultados de engenharia CUV+5DR, override files, pipeline upstream e os 19 viewers. Doc atualizado, **não commitado no JARVIS** (review flow). |
