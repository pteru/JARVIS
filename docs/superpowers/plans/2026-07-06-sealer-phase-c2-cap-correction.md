---
type: Implementation Plan
title: Sealer Phase C2 — Cap Correction + Python Re-run Bridge
description: Add the first interactive correction loop to sdk-sealer-provisioning-gui — a dev Python bridge (Express + child_process running the sealer-provisioning CLI) and cap re-pick UI (raycaster facet picking -> manual_cap_overrides.json -> re-run detect-caps+extract -> centerline updates), Playwright-validated.
tags: [visionking, sealer, "03008", gui, three-js, caps, bridge, plan]
timestamp: 2026-07-06
project: "03008"
product: VisionKing
status: active
language: en
---

# Sealer Phase C2 — Cap Correction + Python Re-run Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Turn the read-only C1 viewer into a working cap-correction loop: the operator re-picks a bead's end-caps by clicking facets, and a re-run regenerates that bead's centerline through the real `sealer-provisioning` CLI — the dominant commissioning task (39/229 CUV beads needed cap fixes).

**Architecture:** Keep the framework-free Vite+Three.js renderer. Add a **dev bridge** — a small Express server (`viewer/server/`) that runs the sealer CLI via `child_process` against a per-session working copy of the project — behind the `ProjectAPI` seam the reference apps established (so the Electron/IPC impl slots in later without touching renderer code). Cap picks write `manual_cap_overrides.json`; the bridge re-runs `group-solids → detect-caps → extract` (scoped per bead where possible) and returns the updated `end_faces.json` + `sealer_centerline.json`.

**Tech Stack:** Vite, TypeScript, Three.js 0.165, Express (dev bridge), Node `child_process`; the `sealer-provisioning` `.venv` CLI (`centerline-extractor`). Playwright (MCP) for validation.

## Global Constraints

- Renderer dir: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/sdk-sealer-provisioning-gui/viewer`. Repo is local-only (branch `master`, C1 at commit `d14a495`); do not push.
- CLI: `<sealer .venv>/bin/centerline-extractor {group-solids,detect-caps,extract}`. The `.venv` is at `/home/teruel/JARVIS/workspaces/strokmatic/visionking-sealer-provisioning/toolkit/sealer-provisioning/.venv` (trimesh 4.12.2).
- **Never run `rm`/`rmdir`/`git clean`** (operator-approval prompts). Manage working copies without deleting.
- English only; strict TypeScript; `npm run build` (tsc noEmit + vite build) must stay clean.
- The renderer must not fetch a hardcoded `/data` path once the bridge exists — it goes through `ProjectAPI` (browser: HTTP to the bridge; the C1 static `public/data` becomes the bridge's seed project).

## Key facts the implementer must know

- **Cap-override schema** (`manual_cap_overrides.json`): `{ "_tolerance_mm": 1.0, "beads": { "<bid>": { "centroids": [[x,y,z],[x,y,z]], "_note": "..." } } }`. `detect-caps` tolerance-matches each centroid to a facet (and synthesizes half/open-tip caps).
- **The re-run chain for a cap edit is three CLI steps**, because `detect-caps` needs *rough* centerlines as a tip-seed:
  1. `group-solids --model-dir <wc> --rough-out <wc>/rough.json` (bakes `physical_bead_id`, emits rough centerlines). Run **once per project load** (not per edit) unless grouping changes.
  2. `detect-caps --model-dir <wc> --rough <wc>/rough.json --overrides <wc>/manual_cap_overrides.json --output <wc>/end_faces.json` (honors the cap override).
  3. `extract --model-dir <wc> --end-faces <wc>/end_faces.json --overrides <wc>/manual_centerline_overrides.json --output <wc>/sealer_centerline.json --beads <bid,siblings>`.
- **Facet picking needs the full candidate list**, not just confirmed `end_cap` facets. `detect-caps`' `end_faces.json` records candidate facets each with `kind`, `centroid`, `normal`, and `facet_triangles` (mesh triangle indices). The viewer must render selectable candidates and map a picked triangle → its candidate facet via `facet_triangles`.
- A cap edit's re-run scope = the bead's dependency group (itself + mirror sibling + chain members) — pass those ids to `extract --beads` (Phase 0 `_dependency_closure` handles the closure; the bridge just passes the edited bead id and its known siblings).

## File structure

- **Create** `viewer/server/index.ts` — Express dev server: static project files + `POST /api/rerun`.
- **Create** `viewer/server/bridge.ts` — working-copy management + `runCli(cmd, args)` (`child_process.spawn` of the sealer venv CLI, streamed stdout, promise on exit) + the cap re-run chain.
- **Create** `viewer/src/api.ts` — `ProjectAPI` interface + a `BrowserProjectAPI` (HTTP to the bridge) and a `StaticProjectAPI` (read-only `public/data`, the C1 fallback). `main.ts` talks only to `api`.
- **Create** `viewer/src/scene/cap-candidates.ts` — render candidate facets (pickable), highlight the two chosen caps A/B, expose `pickFacet(raycasterHit)`.
- **Create** `viewer/src/panels/cap-panel.ts` — the right-hand cap-correction panel (accept / re-pick A / re-pick B / synthetic, `_note`, Re-run button, progress).
- **Modify** `viewer/src/main.ts` — wire the `ProjectAPI`, cap-pick interactions, and the re-run flow (write override → `api.rerun(bead)` → reload centerline+caps → re-render).
- **Modify** `viewer/src/data.ts` — add cap-override types + the candidate-facet fields.
- **Create** `viewer/tests/c2.playwright.md` — the manual/scripted Playwright validation steps.

## Tasks (each ends testable)

### Task 1 — Dev bridge: working copy + `runCli`
Build `bridge.ts`: on first request, copy the seed project (`public/data`) into a per-session working dir under the OS temp (via `fs.cp`, **not** shell `cp`); `runCli(subcmd, args)` spawns `<venv>/bin/centerline-extractor` with the given args, captures stdout/stderr, resolves on exit 0, rejects with stderr tail otherwise. **Acceptance:** a Node script (or a `/api/health` route) runs `extract` on the untouched working copy and returns a `sealer_centerline.json` identical to the seed's (proves the CLI wiring + paths work end-to-end). No UI yet.

### Task 2 — `POST /api/rerun` cap chain
`index.ts` exposes `POST /api/rerun` taking `{ beadId, capOverride: {centroids, note} }`. It merges the override into the working copy's `manual_cap_overrides.json`, runs `detect-caps` (bead-scoped if supported, else whole-model) then `extract --beads <bead+siblings>`, merges the results back into the working copy's `end_faces.json`/`sealer_centerline.json`, and returns the updated bead's caps + centerline. **Acceptance:** curl/Node test — POST a cap override that moves a cap centroid and assert the returned centerline changed for that bead and is schema-valid; POST an empty override and assert it is unchanged.

### Task 3 — `ProjectAPI` seam + candidate rendering
Add `api.ts` (`loadProject`, `rerunCaps(beadId, override)`) with the HTTP impl; switch `main.ts`/`data.ts` off the hardcoded `data/` fetch onto `api`. Add `cap-candidates.ts` rendering all candidate facets for the focused bead (subtle) with the two chosen caps highlighted A/B, `data-testid="cap-A"/"cap-B"`. **Acceptance:** `npm run build` clean; Playwright — the focused bead shows two highlighted caps and ≥2 candidate facets; `window.__viewer.api` is the HTTP impl.

### Task 4 — Cap re-pick interaction + re-run
`cap-panel.ts` + raycaster wiring: click a candidate facet → arm "set as A" / "set as B" → the pick updates an in-memory `capOverride` and re-colors; a **Re-run** button calls `api.rerunCaps` and, on return, updates the caps + centerline in place with a progress indicator. Two-step confirm on destructive re-pick. **Acceptance:** Playwright drives the full loop — pick a different facet as cap B on a demo bead, click Re-run, wait for `data-rerun-state="done"`, assert the bead's centerline point set changed and the info panel updated; zero app console errors; screenshot before/after.

### Task 5 — Regression + docs
Confirm C1 read-only still works (StaticProjectAPI fallback when the bridge is absent). Update the repo README + a short `docs/c2-report.md`. Commit. **Acceptance:** `npm run build` clean; both bridge tests + the Playwright loop pass; C1 screenshots still render.

## Carry-ins from the Phase 0 final review (address here — the GUI is the override producer)
- **Override-schema validation** in `extract_beads`/the bridge: reject unknown `method` types and empty `manual_points` rather than silently auto-marching (the bridge is now producing overrides from UI input — validate before running the CLI, return a clear error to the UI).
- Consider making `_dependency_closure` a fixed point if C2 introduces multi-level overrides (still none expected in C2).

## Testing
- **Bridge (Node):** health re-run (identity), cap-override re-run (changes the bead), malformed override (clean 4xx).
- **Playwright (MCP):** launch `npm run server` + `npm run dev`; load project; assert caps render; pick + re-run; assert centerline changed; before/after screenshots; console error-free.
- **No customer CAD** — the synthetic demo project is the fixture.

## Non-goals (later phases)
Electron packaging + IPC ProjectAPI (C5); grouping/mirror/loop/directed override UI (C3); node-drag (C4). C2 is caps only.
