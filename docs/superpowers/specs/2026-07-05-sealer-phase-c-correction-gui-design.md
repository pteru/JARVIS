---
type: Design Spec
title: Sealer Provisioning Phase C — Correction GUI + Mirror Two-Pass
description: A per-bead desktop correction app (Electron + Three.js, forked from the SDK inspection-grouping-optimizer skeleton) for reviewing and correcting auto-detected end-caps, multi-solid grouping, and centerline overrides, plus the extract_model mirror two-pass engine change that takes fidelity to 227/227.
tags: [visionking, sealer, "03008", gui, electron, three-js, centerline, provisioning]
timestamp: 2026-07-05
project: "03008"
product: VisionKing
status: active
language: en
---

# Sealer Provisioning Phase C — Correction GUI + Mirror Two-Pass

**Project:** 03008 (Hyundai sealer, VisionKing) → new SDK repo `sdk-sealer-provisioning-gui`<br>
**Date:** 2026-07-05<br>
**Author:** Pedro Teruel<br>
**Status:** Design approved 2026-07-05 — ready for implementation planning<br>
**Follows:** `docs/superpowers/specs/2026-07-04-sealer-provisioning-centerline-v3-migration-design.md` (Phase C)

## 1. Motivation

The v3 cap-seeded centerline engine is productized in `toolkit/sealer-provisioning` and
proven byte-exact (committed `74357f75`; see the migration spec). Two things remain:

1. **The last fidelity gap** — bead 75 (`mirror_of: 76`) is the only bead the composed
   `extract` does not reproduce (226/227), because the CLI never wires the mirror
   *two-pass* the original `main()` ran (the engine supports mirroring; the orchestration
   doesn't compute the sibling first).
2. **Manual correction is still file-editing.** Auto cap-detection and auto grouping get
   most beads right, but commissioning a car model still needs a human to fix the rest —
   in the CUV run, **39/229 beads needed cap fixes** and ~6 needed grouping/mirror/loop/
   directed overrides. In research this was done with throwaway matplotlib viewers
   (`viewer_pick_caps_grid.py`) and hand-edited JSON. Phase C productizes that into a GUI.

Pedro's steer: model the GUI on two existing standalone analysis apps —
`sdk/sdk-blender-tools/viewer` and `sdk/sdk-inspection-grouping-optimizer` — **not** on the
runtime Angular `frontend-sealer`. Cap/grouping correction is a commissioning-time,
once-per-model activity, exactly like the inspection-grouping-optimizer (which produces
camera stages at commissioning). It is a desktop tool, not a runtime web page.

## 2. Scope decisions (confirmed 2026-07-05)

- **MVP = full correction suite.** v1 covers cap correction, multi-solid grouping/chains,
  centerline overrides (mirror/loop/directed), **and** freehand geometric node-drag of the
  output centerline. Nothing deferred to a later correction pass.
- **New SDK sibling repo** `sdk-sealer-provisioning-gui`, next to the other SDK apps; it
  depends on the `sealer-provisioning` Python package (the backend it drives). Consistent
  with the SDK-app family; backend and GUI live in separate repos/release cycles.
- **Navigation = per-bead focus + problem queue.** A bead list (flagged beads first) on the
  left; selecting one shows just that bead's mesh + caps + centerline in the center, and all
  correction controls on the right. Closest to the research workflow; least scene clutter.
- **Build strategy = fork-and-adapt.** Clone the inspection-grouping-optimizer
  `electron-app/` + `viewer/` skeleton, strip the camera/weld domain, keep the shell.

## 3. Reference-app findings (what we lift)

Both SDK apps share one architecture, and the persistence seam was *explicitly designed*
for this kind of reuse (`sdk-blender-tools/viewer/src/api.ts` notes its surface "matches
`sdk-inspection-grouping-optimizer/viewer/api.ts` so an Electron preload can be slotted in"):

- **Hardened Electron shell + framework-free renderer** — `contextIsolation:true`,
  `contextBridge` narrow IPC (`electron-app/src/preload.ts`), vanilla-TS panels
  (`document.createElement`), **Three.js 0.165** (no React/Vue).
- **Backend = subprocess with file handoff, not HTTP** — `electron-app/src/python.ts`
  spawns Python, line-buffers stdout to a progress modal, resolves on exit; inputs are
  `inputs/*.json`, output is `result.json`, then the window reloads
  (`electron-app/src/main.ts` `runOptimizer` handler). A frozen-bundle dispatcher
  (`electron-app/python/_dispatch.py`) ships Python without a user install.
- **`ProjectAPI` seam** — the same renderer runs as a browser prototype (localStorage/HTTP)
  or the Electron app (IPC), swapped by one interface impl (`viewer/src/api.ts`).
- **Versioned `project.json`** — auto-migrating `readProjectFile` v1→v3, **atomic tmp+rename
  writes**, a `session` blob restored on reopen (`electron-app/src/project.ts`).
- **3D primitives to reuse** — `STLLoader` body mesh (`viewer/src/scene/body-mesh.ts`);
  color-by-group + status layers with bigger/brighter "problem" items
  (`viewer/src/scene/weld-points.ts`); `PickingHandler` with a 5 px drag-vs-click filter and
  `userData.id` dispatch (`viewer/src/scene/raycaster.ts`); 4-way selection↔highlight↔panel↔
  table sync (`viewer/src/main.ts`); **draggable 3D edit-handles** — add/drag/delete points
  that raycast onto the mesh with a reference-plane fallback
  (`sdk-blender-tools/viewer/src/editors/handles-3d.ts`); isolate-a-cluster tree
  (`viewer/src/panels/sidebar.ts`); input-aware keyboard shortcuts
  (`sdk-blender-tools/viewer/src/panels/keyboard.ts`); two-step destructive-delete confirm.

**The one gap neither app has — our new surface:** click-to-reassign + an overrides file
persisted through a new IPC method (model it on `writeManualPoints`) and fed back to the
extractor as a seed. This maps directly onto the two override files we already have.

## 4. Architecture & repo structure

New repo `sdk-sealer-provisioning-gui`:

- `viewer/` — Vite + TypeScript + Three.js renderer (the per-bead focus UI).
- `electron-app/` — Electron shell: `main.ts` (window + IPC handlers + menu), `preload.ts`
  (narrow `contextBridge` API), `python.ts` (subprocess spawn + streamed stdout),
  `project.ts` (versioned `project.json`, atomic writes).
- `python/` — thin dispatch scripts (`run_extract.py`, `run_detect_caps.py`,
  `run_group_solids.py`) that import and call the `sealer-provisioning` package's public
  API (`extract_beads`, `detect_caps_model`, `group_solids_model`). **No logic duplication.**
- **Backend dependency:** `sealer-provisioning` installed into the app's `.venv` — editable
  from the VK monorepo in dev; a built wheel + **PyInstaller-frozen bundle** for
  distribution (exactly like the optimizer's `_dispatch.py`). Frozen interpreter resolution
  mirrors `electron-app/src/python.ts` (bundle → repo `.venv` → system `python3`).

Browser dev-mode (`VIEWER_DEV=1`, Vite hot-reload) stays available for fast UX iteration in
the same skeleton.

**The mirror two-pass and `manual_points` support land in the `sealer-provisioning`
package** (piece 0), not the GUI. The GUI only ever produces/edits override JSON and calls
the CLI; the engine honors every override type.

## 5. Domain model & data contracts

A **project is a model folder the GUI opens** (produced upstream by the car-CAD→beads
pipeline + `step2stl`):

| File | Role | Written by |
|---|---|---|
| `manifest.json` | beads + baked `physical_bead_id` | pipeline / `group-solids` |
| `beads/*.stl` | one mesh per solid | pipeline |
| `end_faces.json` | detected end-caps (GUI-editable) | `detect-caps`, GUI edits |
| `manual_cap_overrides.json` | cap re-picks | **GUI** |
| `manual_centerline_overrides.json` | mirror/loop/directed/chain/**manual_points** | **GUI** |
| `sealer_centerline.json` | the deliverable | `extract` |
| `project.json` | GUI session (camera, active bead, per-bead review state), versioned | **GUI** |

**Cap-override schema** (verified against `analysis_cuv/manual_cap_overrides.json`):

```jsonc
{ "_tolerance_mm": 1.0,
  "beads": { "7": { "centroids": [[x,y,z],[x,y,z]], "_note": "F0(20x2.2) F2(20x2.2)" } } }
```

Centroid-based; `detect-caps` tolerance-matches each centroid to a facet (and synthesizes
half/open-tip caps). The GUI writes centroids from the operator's facet clicks.

**Centerline-override schema** (verified against
`analysis_cuv/manual_centerline_overrides.json`), keyed by `bead_id`, each carrying a human
`reason`:

```jsonc
{ "75":  { "mirror_of": 76, "mirror_plane": "y", "reason": "…" },
  "118": { "loop_plane": "y", "loop_value": -38.7, "reason": "…" },
  "106": { "method": "directed", "reason": "…" },
  "chain_227_229_228": { "chain": [227,229,228], "end_cut_back_mm": 50.0, "reason": "…" } }
```

**New override type — `manual_points`** (the only schema/engine addition beyond the mirror
fix): `{ "84": { "method": "manual_points", "points": [[x,y,z], …], "reason": "…" } }`. A
small `extract_solid` branch uses those points directly with `selected="manual"`; refine
passes them through untouched (like `loop`) — the operator's nodes are authoritative.

**Bead status is derived, not stored.** The problem queue ranks beads by the `extract`
validation already present in `sealer_centerline.json` (max surface-dist, coverage,
cap-reach) plus "has an unreviewed override" — recomputed on load, so nothing goes stale.

## 6. Per-correction UX (per-bead focus layout)

Center = selected bead's STL with **caps (A/B markers)** + **extracted centerline**; right =
a correction panel that switches by task. Each correction writes an override file and
triggers a minimal re-run (§7); the centerline updates in place.

- **① Caps** (dominant task — replaces `viewer_pick_caps_grid.py`). Candidate end-facets are
  highlighted; the two chosen caps are marked A/B. Operator: **accept** (default),
  **re-pick** (click a facet → its centroid becomes the cap), or **place a synthetic cap**
  (click a point on an open tip). Writes `manual_cap_overrides.json`; re-runs `detect-caps`
  for that bead → `extract`.
- **② Grouping / chains & ③ mirror** — the two *cross-bead* relations, so the focus view
  **temporarily reveals neighbors**: nearby solids within a radius fade in for sibling
  clicks. "Chain with…" → pick members in order + `end_cut_back_mm` → `chain_*` entry.
  "Mirror of…" → pick sibling + symmetry plane → `{mirror_of, mirror_plane}`. Both write
  `manual_centerline_overrides.json`.
- **④ Loop / directed** (single-bead). Loop: a draggable bisecting-plane widget (or numeric
  `loop_plane`+`loop_value`) previews the two crossings. Directed: a "force directed march"
  toggle. Each writes its override with a `reason`.
- **⑤ Node-drag** (finest correction). The centerline renders as `handles-3d` spheres +
  polyline: **left-click = add, drag = move, right-click = delete**; nodes raycast onto the
  bead STL (reference-plane fallback). On change → `manual_points` override.

Every panel carries the editable `reason`/`_note`; destructive actions (reject cap, delete
chain) use a two-step confirm. The problem queue re-sorts after each re-run.

## 7. Re-run granularity & pipeline invocation

**Interactive re-runs are per-bead, not model-wide.** Full `extract_model` over 229 solids
is the ~19-min commissioning path; correction feedback re-runs only the edited bead's
**dependency group** — itself plus its mirror sibling and/or chain members (computed
client-side from `physical_bead_id` + the mirror/chain overrides):

| Edit | Re-run |
|---|---|
| Cap re-pick (bead X) | `detect-caps(X)` → `extract(depgroup(X))` |
| Mirror (X mirrors Y) | `extract(Y)` then `extract(X)` |
| Chain edit | `extract(all members)` |
| Loop / directed / node-drag (X) | `extract(X)` |

**Package addition:** a per-subset entry point `extract_beads(model_dir, bead_ids, …)`
alongside `extract_model` (reuses `extract_solid`/`refine`/`build_chains` unchanged — just
scopes the loop and the dependency closure). The dispatch scripts **merge** re-computed
beads back into the existing `sealer_centerline.json` / `end_faces.json` rather than
rewriting the whole file — so a one-bead fix is seconds and the deliverable stays intact.

**Bridge mechanics** (inherited): GUI writes override file(s) → spawns
`python/run_*.py <project> --beads 75,76` → streams stdout to a progress modal → merges
results → renderer reloads the affected beads. A model-wide **"Re-run all"** stays available
(menu) for the first extraction of a fresh project and the final full pass.

**`group-solids` is a one-time / explicit action**, not part of interactive loops: manual
grouping lives in the override file (consumed at `extract` time), so re-deriving geometric
auto-grouping is only a deliberate "reset auto-grouping" button that warns it re-bakes
`physical_bead_id`.

## 8. Mirror two-pass engine change (piece 0)

Today `extract_model` runs `extract_solid → refine` in one per-bead loop, and `extract_solid`
only mirrors when handed `mirror_points`. Since the override stores just
`{mirror_of, mirror_plane}`, restructure the core into three passes (matching original
`main()`):

1. **Extract-all** — `extract_solid` for every bead in scope (a mirror bead's own march
   runs but will be overwritten).
2. **Apply mirrors** — for each `mirror_of` bead, take the sibling's **raw** pass-1 points,
   inject as `mirror_points`, re-run `extract_solid` for the mirror bead (reflect + orient
   cap_a→cap_b). Guard missing/circular siblings.
3. **Refine-all** → `build_chains`.

This core is factored into **`extract_beads(model_dir, bead_ids, …)`**; `extract_model`
becomes `extract_beads(all)`. The GUI's per-subset re-runs use the same function, so the
two-pass works identically whether scoped to `{75,76}` or the whole model. The tiny
`manual_points` branch (§5) lands in the same restructure. Expected result: full-model
`extract` reaches **227/227 byte-exact** vs frozen v3.

## 9. Testing

- **Package (pytest):** a synthetic **mirror-pair fixture** (two y-symmetric beads) → the
  mirror bead's centerline equals the reflected sibling; a `manual_points` fixture → the
  curve is used as-authored; `extract_beads(subset)` ≡ `extract_model` restricted to that
  subset (scoping consistency); existing 40-test suite stays green. The local CUV
  **227/227 byte-exact** run remains the acceptance gate (customer data, non-committed).
- **GUI (Vitest + jsdom):** unit tests for each override-writer (cap centroids / chain /
  mirror / loop / `manual_points` → exact JSON), the dependency-closure computation, the
  merge-back into `sealer_centerline.json`, and the `ProjectAPI` localStorage impl. A
  browser-mode **smoke test** on a tiny synthetic project: pick a cap → assert override
  written + re-run invoked (mocked Python bridge).
- **Manual E2E:** package the Electron app, open a real project, correct a bead, confirm
  `sealer_centerline.json` updates and the problem queue re-sorts.

## 10. Phasing

- **Phase 0 (engine, in `sealer-provisioning`):** mirror two-pass + `extract_beads` +
  `manual_points`. Fidelity 227/227; unblocks per-bead re-run. Small, self-contained,
  fully testable without the GUI.
- **Phase C1 (skeleton):** fork inspection-grouping-optimizer, strip camera/weld domain,
  wire the Python bridge to `extract_beads`, open a project, render bead + centerline + caps,
  per-bead focus + problem queue — read-only.
- **Phase C2 (caps):** cap re-pick / synthetic → `manual_cap_overrides.json` → re-run
  `detect-caps` + `extract`.
- **Phase C3 (grouping/mirror/loop/directed):** neighbor-peek picking + the override panels.
- **Phase C4 (node-drag):** `handles-3d` editor → `manual_points`.
- **Phase C5 (packaging):** PyInstaller bundle + electron-builder installers, polish
  (keyboard shortcuts, report export, session restore).

## 11. Non-goals

Runtime integration into `frontend-sealer`/`backend-sealer`; multi-user/networked editing;
editing the upstream car-CAD→beads extraction; auto-correction (the GUI is human-in-the-loop
review of deterministic auto-detection); model-versioning of `sealer_centerline.json`.

## 12. Open items to resolve during implementation

1. **Backend vendoring** — exact mechanism for the SDK repo to consume `sealer-provisioning`
   (editable path in dev vs built wheel vs git submodule) and how the PyInstaller freeze
   picks it up. Lean: dev = editable install from the VK monorepo checkout; dist = wheel
   built in CI, frozen into the bundle.
2. **Neighbor-peek radius** for grouping/mirror picking — fixed mm vs adaptive to bead size.
3. **Node-drag ↔ refine** — confirm `manual_points` passes through refine untouched (like
   `loop`) vs an optional light smooth toggle.
4. **`detect-caps` per-bead merge** — confirm `detect_caps_model` can be scoped to one bead
   cleanly, or whether the GUI edits that bead's `end_faces.json` entry directly and skips
   re-detection for pure re-picks.

## Histórico de Mudanças

| Data | Autor | Mudança |
|---|---|---|
| 2026-07-05 | Pedro Teruel | Design inicial da Fase C. Decisões confirmadas: MVP = suite completa (caps + grouping/chains + overrides de centerline + node-drag); repo SDK novo `sdk-sealer-provisioning-gui` dependendo do pacote `sealer-provisioning`; navegação per-bead focus + fila de problemas; estratégia fork-and-adapt do skeleton do `sdk-inspection-grouping-optimizer` (Electron + Three.js + ponte Python por subprocess/handoff de arquivo). Piece 0 = mirror two-pass + `extract_beads` + tipo de override `manual_points` no pacote (fidelidade 227/227). Contratos de dados verificados contra os JSONs reais de override. |
