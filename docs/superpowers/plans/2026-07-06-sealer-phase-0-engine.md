---
type: Implementation Plan
title: Sealer Phase 0 — Engine (mirror two-pass + extract_beads + manual_points)
description: TDD plan to complete the sealer-provisioning centerline engine — three-pass extract_beads core, mirror two-pass wiring (227/227), the manual_points override, and dependency-closed per-subset re-runs for the Phase C correction GUI.
tags: [visionking, sealer, "03008", centerline, extract-beads, mirror, plan]
timestamp: 2026-07-06
project: "03008"
product: VisionKing
status: active
language: en
---

# Sealer Phase 0 — Engine (mirror two-pass + extract_beads + manual_points) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the `sealer-provisioning` centerline engine so `extract` honors every manual override type end-to-end — wiring the mirror two-pass (fidelity 226/227 → 227/227), adding a per-subset `extract_beads` entry point for the GUI's per-bead re-runs, and adding the `manual_points` override type for freehand node-drag.

**Architecture:** Refactor `extract_model`'s single per-bead extract+refine loop into a three-pass core (`extract-all → apply-mirrors → refine-all → build_chains`) exposed as `extract_beads(model_dir, end_faces, overrides, bead_ids=None)`. The mirror pass feeds a sibling bead's raw centerline back into `extract_solid` as `mirror_points`. `extract_model` becomes `extract_beads(bead_ids=None)`, so the full-model run stays byte-exact and the GUI reuses the same code scoped to a dependency-closed subset.

**Tech Stack:** Python 3.12, trimesh 4.12.2, numpy 2.4.6, scipy 1.17.1, click, Pydantic; pytest.

## Global Constraints

- Work in the VK monorepo worktree: `/home/teruel/JARVIS/workspaces/strokmatic/visionking-sealer-provisioning/toolkit/sealer-provisioning`.
- Branch: `feat/sealer-provisioning-cli` (already checked out; verify with `git branch --show-current`).
- Python interpreter for ALL commands: `.venv/bin/python` (trimesh **4.12.2** — never `tools/.venv`).
- All code, comments, commit messages in **English**.
- **Fidelity is the acceptance bar:** `extract_beads(bead_ids=None)` must reproduce the current `extract_model` output byte-exact on non-mirror beads (the existing suite is the guard); the full CUV run must reach 227/227 (Task 5, local/non-committed).
- No customer CAD in the repo — tests use synthetic fixtures in `tests/fixtures/_gen.py`.
- Run the full suite with `.venv/bin/python -m pytest -q` and lint with `.venv/bin/ruff check src tests` before each commit.

---

## File structure

- **Modify** `src/sealer_provisioning/centerline_extractor.py` — split `extract_model` (lines 43-116) into `extract_beads` (three-pass core) + a thin `extract_model` wrapper; add `_dependency_closure`; add `--beads` to `cmd_extract`.
- **Modify** `src/sealer_provisioning/extractors/cap_seeded.py` — add the `manual_points` branch in `extract_solid`'s override block (after the `loop_plane` branch, ~line 1084).
- **Modify** `src/sealer_provisioning/extractors/refine.py` — extend the pass-through guard so `selected == "manual"` returns points untouched (line 360).
- **Modify** `tests/fixtures/_gen.py` — add `build_manual_points_model` and `build_mirror_pair`.
- **Create** `tests/test_phase0_extract_beads.py`, `tests/test_phase0_manual_points.py`, `tests/test_phase0_mirror.py`.

---

### Task 1: Refactor `extract_model` into the three-pass `extract_beads` core

Pure structural refactor: separate extract from refine into distinct passes and add per-subset scoping. No new override behavior yet, so the existing suite is the regression guard.

**Files:**
- Modify: `src/sealer_provisioning/centerline_extractor.py:43-116`
- Test: `tests/test_phase0_extract_beads.py`

**Interfaces:**
- Produces: `extract_beads(model_dir: Path, end_faces_path: Path, overrides_path: Path | None = None, bead_ids: list[int] | None = None) -> dict` — payload `{"model_type": str, "beads": [{bead_id, name, points, expected_width_mm, expected_height_mm}]}`, scoped to `bead_ids` (None = all beads).
- Produces: `extract_model(model_dir, end_faces_path, overrides_path=None) -> dict` — unchanged public signature, now delegates to `extract_beads(..., bead_ids=None)`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_phase0_extract_beads.py
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, ".")  # import tests.fixtures._gen from the package root
from sealer_provisioning.centerline_extractor import extract_beads, extract_model
from tests.fixtures._gen import build_synth_model


def test_extract_beads_all_equals_extract_model(tmp_path):
    build_synth_model(tmp_path, which=("straight", "split"))
    ef = tmp_path / "end_faces.json"
    full = extract_model(tmp_path, ef)
    beads = extract_beads(tmp_path, ef, bead_ids=None)
    assert beads == full  # bead_ids=None is exactly extract_model


def test_extract_beads_subset_returns_only_scope(tmp_path):
    build_synth_model(tmp_path, which=("straight", "split"))
    ef = tmp_path / "end_faces.json"
    full = extract_model(tmp_path, ef)
    only1 = extract_beads(tmp_path, ef, bead_ids=[1])
    got_ids = [b["bead_id"] for b in only1["beads"]]
    assert got_ids == [1]
    # the single-solid bead 1 is identical to its entry in the full run
    b1_full = next(b for b in full["beads"] if b["bead_id"] == 1)
    assert only1["beads"][0] == b1_full
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_phase0_extract_beads.py -q`
Expected: FAIL with `ImportError: cannot import name 'extract_beads'`.

- [ ] **Step 3: Replace `extract_model` (lines 43-116) with the three-pass core + wrapper**

```python
def extract_beads(
    model_dir: Path,
    end_faces_path: Path,
    overrides_path: Path | None = None,
    bead_ids: list[int] | None = None,
) -> dict:
    """Cap-seeded pipeline scoped to ``bead_ids`` (None = all beads).

    Three passes so multi-solid/mirror context is available when each bead is
    finalized: (1) ``extract_solid`` raw march for every scoped bead,
    (2) apply mirror overrides using the sibling's raw points, (3) refine all,
    then ``build_chains``. ``extract_model`` is ``extract_beads(bead_ids=None)``.
    """
    model_dir = Path(model_dir)
    manifest = json.loads((model_dir / "manifest.json").read_text())
    end_faces = json.loads(Path(end_faces_path).read_text())
    overrides = json.loads(Path(overrides_path).read_text()) if overrides_path else {}

    by_id = {b["bead_id"]: b for b in manifest["beads"]}
    caps_by_bead = {
        rec["bead_id"]: [f for f in rec.get("facets", []) if f.get("kind") == "end_cap"]
        for rec in end_faces
    }

    all_ids = [b["bead_id"] for b in manifest["beads"]]
    scope = set(all_ids) if bead_ids is None else set(bead_ids)
    scoped_beads = [b for b in manifest["beads"] if b["bead_id"] in scope]

    # --- pass 1: raw cap-seeded march for every scoped bead ---
    raw: dict[int, dict] = {}
    meshes: dict[int, trimesh.Trimesh] = {}
    for bead in scoped_beads:
        bid = bead["bead_id"]
        mesh = trimesh.load(model_dir / bead["file"], force="mesh")
        meshes[bid] = mesh
        facets = caps_by_bead.get(bid, [])
        if len(facets) < 2:
            raise click.ClickException(
                f"bead {bid}: need >=2 end_cap facets in end_faces.json, got {len(facets)}."
            )
        cap_a, cap_b = cap_seeded.select_end_caps(facets)
        ov = overrides.get(str(bid)) or overrides.get(bid)
        solid = cap_seeded.extract_solid(mesh, cap_a, cap_b, overrides=ov)
        solid["bead_id"] = bid
        raw[bid] = {
            "solid": solid, "mesh": mesh, "cap_a": cap_a, "cap_b": cap_b,
            "facets": facets, "ov": ov,
        }

    # --- pass 2: mirror overrides (filled in Task 3) ---
    _apply_mirror_overrides(raw)

    # --- pass 3: refine every scoped bead ---
    solids: list[dict] = []
    for bid, ctx in raw.items():
        s = ctx["solid"]
        ref_ov = {
            "selected": s.get("diag", {}).get("selected"),
            "caps": ctx["facets"],
            "gate_radius_mm": s.get("gate_radius_mm"),
        }
        if ctx["ov"]:
            ref_ov.update(ctx["ov"])
        s["points"] = refine.refine_solid(
            ctx["mesh"], s["points"], ctx["cap_a"], ctx["cap_b"], overrides=ref_ov
        )
        solids.append(s)

    # --- grouping + chains (scoped) ---
    grouping = _grouping_from_manifest(scoped_beads)
    end_fix_specs: dict[int, dict] = {}
    for spec in overrides.values() if isinstance(overrides, dict) else []:
        if isinstance(spec, dict) and len(spec.get("chain", [])) > 1:
            members = spec["chain"]
            if not set(members) <= scope:  # only chain when all members are in scope
                continue
            survivor = members[0]
            for m in members:
                grouping.pop(m, None)
            grouping[survivor] = members
            end_fix_specs[survivor] = {"end_cut_back_mm": spec.get("end_cut_back_mm", 20.0)}
    chains = cap_seeded.build_chains(solids, grouping, meshes=meshes, end_fix_specs=end_fix_specs)

    beads_out = []
    for ch in chains:
        m = by_id[ch["bead_id"]]
        beads_out.append(
            {
                "bead_id": ch["bead_id"],
                "name": m["name"],
                "points": [[float(c) for c in p] for p in ch["points"]],
                "expected_width_mm": float(m["expected_width_mm"]),
                "expected_height_mm": float(m["expected_height_mm"]),
            }
        )
    beads_out.sort(key=lambda b: b["bead_id"])
    payload = {"model_type": manifest["model_type"], "beads": beads_out}
    Centerline.model_validate(payload)  # fail loudly on any schema violation
    return payload


def _apply_mirror_overrides(raw: dict[int, dict]) -> None:
    """Pass 2 placeholder — mirror wiring lands in Task 3."""
    return None


def extract_model(
    model_dir: Path, end_faces_path: Path, overrides_path: Path | None = None
) -> dict:
    """Run the cap-seeded pipeline for a whole model folder; return the payload."""
    return extract_beads(model_dir, end_faces_path, overrides_path, bead_ids=None)
```

- [ ] **Step 4: Run the new test + full suite**

Run: `.venv/bin/python -m pytest tests/test_phase0_extract_beads.py -q && .venv/bin/python -m pytest -q`
Expected: new tests PASS; full suite still **40 passed, 6 skipped** (the refactor is behavior-preserving because each bead's extract and refine are independent).

- [ ] **Step 5: Lint + commit**

```bash
.venv/bin/ruff check src tests
git add src/sealer_provisioning/centerline_extractor.py tests/test_phase0_extract_beads.py
git commit -m "refactor(sealer): three-pass extract_beads core; extract_model delegates"
```

---

### Task 2: `manual_points` override (freehand node-drag support)

**Files:**
- Modify: `src/sealer_provisioning/extractors/cap_seeded.py` (override block, after the `loop_plane` branch ~line 1084)
- Modify: `src/sealer_provisioning/extractors/refine.py:360`
- Modify: `tests/fixtures/_gen.py`
- Test: `tests/test_phase0_manual_points.py`

**Interfaces:**
- Consumes: `extract_beads` (Task 1).
- Produces: override entry `{bead_id: {"method": "manual_points", "points": [[x,y,z], …], "reason": str}}` honored by `extract_solid` (sets `diag["selected"] == "manual"`) and passed through `refine_solid` untouched.
- Produces: `build_manual_points_model(root, model_type="MANUAL_PTS") -> dict` in `_gen.py`.

- [ ] **Step 1: Add the fixture builder**

```python
# append to tests/fixtures/_gen.py
def build_manual_points_model(root: Path, model_type: str = "MANUAL_PTS") -> dict:
    """One straight bead whose auto-march is the X axis, plus a manual_points
    override that places the centerline OFF-axis (y = +5). Used to prove the
    override wins and is passed through refine untouched."""
    root = Path(root)
    (root / "beads").mkdir(parents=True, exist_ok=True)
    L = 300.0
    _straight_box(0.0, L).export(root / "beads/bead_001.stl")
    beads = [{
        "bead_id": 1, "name": "manual", "file": "beads/bead_001.stl",
        "expected_width_mm": W_MM, "expected_height_mm": H_MM, "physical_bead_id": 1,
    }]
    facets = [{"bead_id": 1, "facets": [_facet([0, 0, 0], [-1, 0, 0]), _facet([L, 0, 0], [1, 0, 0])]}]
    (root / "manifest.json").write_text(json.dumps({"model_type": model_type, "beads": beads}, indent=2))
    (root / "end_faces.json").write_text(json.dumps(facets, indent=2))
    manual = [[0.0, 5.0, 0.0], [100.0, 5.0, 0.0], [200.0, 5.0, 0.0], [300.0, 5.0, 0.0]]
    ov = {"1": {"method": "manual_points", "points": manual, "reason": "test"}}
    (root / "overrides.json").write_text(json.dumps(ov, indent=2))
    return {"root": root, "overrides_path": root / "overrides.json", "manual": manual}
```

- [ ] **Step 2: Write the failing test**

```python
# tests/test_phase0_manual_points.py
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, ".")
from sealer_provisioning.centerline_extractor import extract_beads
from tests.fixtures._gen import build_manual_points_model


def test_manual_points_override_wins_and_passes_through(tmp_path):
    meta = build_manual_points_model(tmp_path)
    payload = extract_beads(tmp_path, tmp_path / "end_faces.json", meta["overrides_path"])
    pts = np.asarray(payload["beads"][0]["points"], float)
    # the override placed the curve at y = +5; the auto-march would be y = 0.
    assert np.allclose(pts[:, 1], 5.0, atol=0.1), "manual_points did not override the march"
    # pass-through: endpoints are exactly the authored end nodes
    assert np.linalg.norm(pts[0] - [0, 5, 0]) < 0.1
    assert np.linalg.norm(pts[-1] - [300, 5, 0]) < 0.1
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_phase0_manual_points.py -q`
Expected: FAIL — `assert np.allclose(pts[:,1], 5.0)` is False (the curve is on the X axis; the override is ignored).

- [ ] **Step 4: Add the `manual_points` branch in `extract_solid`**

In `src/sealer_provisioning/extractors/cap_seeded.py`, inside the `if overrides:` block, after the `elif "loop_plane" in spec:` branch (the branch ending ~line 1084), add:

```python
        elif spec.get("method") == "manual_points" and spec.get("points"):
            # Freehand node-drag from the GUI: the operator's polyline is
            # authoritative. Use it verbatim (refine passes selected=="manual"
            # through untouched, like a closed loop).
            mesh_d = subdivide_if_coarse(mesh0)
            pts = np.asarray(spec["points"], dtype=float)
            diag = {
                "mode": "manual",
                "selected": "manual",
                "reached_target": True,
                "end_gap_mm": 0.0,
            }
            mesh_used = mesh_d
```

- [ ] **Step 5: Add `manual` to the refine pass-through guard**

In `src/sealer_provisioning/extractors/refine.py`, change line 360 from:

```python
    if selected == "loop":
        return pts
```

to:

```python
    if selected in ("loop", "manual"):
        return pts
```

- [ ] **Step 6: Run the test + full suite + lint**

Run: `.venv/bin/python -m pytest tests/test_phase0_manual_points.py -q && .venv/bin/python -m pytest -q && .venv/bin/ruff check src tests`
Expected: new test PASS; suite **41 passed, 6 skipped**; lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/sealer_provisioning/extractors/cap_seeded.py src/sealer_provisioning/extractors/refine.py tests/fixtures/_gen.py tests/test_phase0_manual_points.py
git commit -m "feat(sealer): manual_points override for freehand node-drag"
```

---

### Task 3: Mirror two-pass wiring

Fill in `_apply_mirror_overrides` (the pass-2 placeholder): for every scoped bead with a `mirror_of` override, take the sibling's **raw** pass-1 points, inject as `mirror_points`, and re-run `extract_solid` for the mirror bead.

**Files:**
- Modify: `src/sealer_provisioning/centerline_extractor.py` (`_apply_mirror_overrides`)
- Modify: `tests/fixtures/_gen.py`
- Test: `tests/test_phase0_mirror.py`

**Interfaces:**
- Consumes: the `raw` dict from `extract_beads` pass 1 (`{bid: {"solid","mesh","cap_a","cap_b","facets","ov"}}`); `extract_solid`'s existing mirror branch (`cap_seeded.py:1054`, triggered when `spec["mirror_points"]` is not None).
- Produces: `build_mirror_pair(root, model_type="MIRROR_PAIR") -> dict` in `_gen.py`.

- [ ] **Step 1: Add the fixture builder**

```python
# append to tests/fixtures/_gen.py
def build_mirror_pair(root: Path, model_type: str = "MIRROR_PAIR") -> dict:
    """Bead 1 = a full straight tube at y=+30 (auto-marches cleanly).
    Bead 2 = its y=-30 reflection but with a MID GAP (two stubs), so bead 2's
    own march stalls at the gap and only the mirror (sibling) path reaches the
    far cap. Caps sit at the true outer ends. Override mirrors 2 <- 1 across y."""
    root = Path(root)
    (root / "beads").mkdir(parents=True, exist_ok=True)
    L, Y = 300.0, 30.0

    m1 = trimesh.creation.box(extents=[L, W_MM, H_MM])
    m1.apply_translation([L / 2.0, Y, 0.0])
    m1.export(root / "beads/bead_001.stl")

    stub_a = trimesh.creation.box(extents=[80.0, W_MM, H_MM])
    stub_a.apply_translation([40.0, -Y, 0.0])
    stub_b = trimesh.creation.box(extents=[80.0, W_MM, H_MM])
    stub_b.apply_translation([260.0, -Y, 0.0])
    trimesh.util.concatenate([stub_a, stub_b]).export(root / "beads/bead_002.stl")

    beads = [
        {"bead_id": 1, "name": "m_src", "file": "beads/bead_001.stl",
         "expected_width_mm": W_MM, "expected_height_mm": H_MM, "physical_bead_id": 1},
        {"bead_id": 2, "name": "m_dst", "file": "beads/bead_002.stl",
         "expected_width_mm": W_MM, "expected_height_mm": H_MM, "physical_bead_id": 2},
    ]
    facets = [
        {"bead_id": 1, "facets": [_facet([0, Y, 0], [-1, 0, 0]), _facet([L, Y, 0], [1, 0, 0])]},
        {"bead_id": 2, "facets": [_facet([0, -Y, 0], [-1, 0, 0]), _facet([L, -Y, 0], [1, 0, 0])]},
    ]
    (root / "manifest.json").write_text(json.dumps({"model_type": model_type, "beads": beads}, indent=2))
    (root / "end_faces.json").write_text(json.dumps(facets, indent=2))
    ov = {"2": {"mirror_of": 1, "mirror_plane": "y", "reason": "test mirror pair"}}
    (root / "overrides.json").write_text(json.dumps(ov, indent=2))
    return {"root": root, "overrides_path": root / "overrides.json", "L": L, "Y": Y}
```

- [ ] **Step 2: Write the failing test**

```python
# tests/test_phase0_mirror.py
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, ".")
from sealer_provisioning.centerline_extractor import extract_beads
from tests.fixtures._gen import build_mirror_pair


def _maxdev(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    return float(max(np.linalg.norm(a[:, None] - b[None], axis=2).min(axis=1).max(),
                     np.linalg.norm(b[:, None] - a[None], axis=2).min(axis=1).max()))


def test_mirror_bead_uses_sibling_and_reaches_far_cap(tmp_path):
    meta = build_mirror_pair(tmp_path)
    L, Y = meta["L"], meta["Y"]
    payload = extract_beads(tmp_path, tmp_path / "end_faces.json", meta["overrides_path"])
    b = {x["bead_id"]: np.asarray(x["points"], float) for x in payload["beads"]}
    # bead 2 spans the full length to the far cap [300,-30,0] — only the mirror
    # path (from bead 1's full march) reaches it; bead 2's own march stalls at the gap.
    ends = np.array([b[2][0], b[2][-1]])
    assert np.min(np.linalg.norm(ends - [L, -Y, 0], axis=1)) < 8.0
    assert np.min(np.linalg.norm(ends - [0, -Y, 0], axis=1)) < 8.0
    # bead 2 is the y-reflection of bead 1
    refl = b[1].copy(); refl[:, 1] *= -1.0
    assert _maxdev(b[2], refl) < 3.0


def test_without_override_bead2_stalls(tmp_path):
    """Negative control: no override -> bead 2 auto-marches and does NOT reach
    the far cap (proving the mirror path is what closes the gap)."""
    meta = build_mirror_pair(tmp_path)
    L, Y = meta["L"], meta["Y"]
    payload = extract_beads(tmp_path, tmp_path / "end_faces.json", overrides_path=None)
    b2 = np.asarray(next(x for x in payload["beads"] if x["bead_id"] == 2)["points"], float)
    ends = np.array([b2[0], b2[-1]])
    assert np.min(np.linalg.norm(ends - [L, -Y, 0], axis=1)) > 20.0
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_phase0_mirror.py -q`
Expected: `test_mirror_bead_uses_sibling_and_reaches_far_cap` FAILS (pass 2 is a no-op, so bead 2 auto-marches and stalls); `test_without_override_bead2_stalls` PASSES already.

- [ ] **Step 4: Implement `_apply_mirror_overrides`**

Replace the placeholder in `src/sealer_provisioning/centerline_extractor.py`:

```python
def _apply_mirror_overrides(raw: dict[int, dict]) -> None:
    """Pass 2: for each scoped bead with a ``mirror_of`` override, re-extract it
    from the sibling's RAW pass-1 centerline (``extract_solid`` reflects the
    points across ``mirror_plane`` and orients cap_a->cap_b). The sibling is
    guaranteed in scope by the dependency closure (Task 4); for a whole-model
    run every bead is present."""
    for bid, ctx in raw.items():
        spec = ctx["ov"]
        if not (isinstance(spec, dict) and "mirror_of" in spec):
            continue
        sib = spec["mirror_of"]
        if sib not in raw:
            raise click.ClickException(
                f"bead {bid}: mirror_of {sib} is not in scope — include the sibling."
            )
        mspec = dict(spec)
        mspec["mirror_points"] = raw[sib]["solid"]["points"]
        solid = cap_seeded.extract_solid(
            ctx["mesh"], ctx["cap_a"], ctx["cap_b"], overrides=mspec
        )
        solid["bead_id"] = bid
        ctx["solid"] = solid
```

- [ ] **Step 5: Run the tests + full suite + lint**

Run: `.venv/bin/python -m pytest tests/test_phase0_mirror.py -q && .venv/bin/python -m pytest -q && .venv/bin/ruff check src tests`
Expected: both mirror tests PASS; suite **43 passed, 6 skipped**; lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/sealer_provisioning/centerline_extractor.py tests/fixtures/_gen.py tests/test_phase0_mirror.py
git commit -m "feat(sealer): wire mirror two-pass in extract_beads (b75 -> 227/227)"
```

---

### Task 4: Dependency closure + `--beads` CLI flag (GUI per-subset re-runs)

Per-bead re-runs from the GUI must auto-include a mirror bead's sibling and all chain members, so the two-pass and chaining have their inputs.

**Files:**
- Modify: `src/sealer_provisioning/centerline_extractor.py` (`_dependency_closure`; `extract_beads` scoping; `cmd_extract` `--beads`)
- Test: `tests/test_phase0_extract_beads.py`

**Interfaces:**
- Produces: `_dependency_closure(bead_ids: list[int], overrides: dict, manifest_beads: list[dict]) -> set[int]`.
- Modifies: `extract_beads` — when `bead_ids` is not None, `scope = _dependency_closure(bead_ids, overrides, manifest["beads"])`.
- Produces: `extract --beads 75,76` CLI option (comma-separated ids; omitted = whole model).

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_phase0_extract_beads.py
from tests.fixtures._gen import build_mirror_pair


def test_subset_autoincludes_mirror_sibling(tmp_path):
    meta = build_mirror_pair(tmp_path)
    ef = tmp_path / "end_faces.json"
    # request ONLY the mirror bead; closure must pull in sibling 1 so the
    # two-pass has the source, and the mirror result must reach the far cap.
    only2 = extract_beads(tmp_path, ef, meta["overrides_path"], bead_ids=[2])
    got = {b["bead_id"] for b in only2["beads"]}
    assert 2 in got  # bead 1 may or may not be returned, but no crash and 2 is mirrored
    b2 = np.asarray(next(b for b in only2["beads"] if b["bead_id"] == 2)["points"], float)
    ends = np.array([b2[0], b2[-1]])
    assert np.min(np.linalg.norm(ends - [meta["L"], -meta["Y"], 0], axis=1)) < 8.0


def test_subset_autoincludes_chain_members(tmp_path):
    build_synth_model(tmp_path, which=("split",))  # beads 10 + 11, physical_bead_id 10
    ef = tmp_path / "end_faces.json"
    only10 = extract_beads(tmp_path, ef, bead_ids=[10])  # request the survivor only
    ids = [b["bead_id"] for b in only10["beads"]]
    assert ids == [10]  # 11 is chained into 10, not emitted separately
    # the chained bead spans the full 0..300 length (both members were extracted)
    pts = np.asarray(only10["beads"][0]["points"], float)
    assert pts[:, 0].max() > 290.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_phase0_extract_beads.py -q`
Expected: `test_subset_autoincludes_mirror_sibling` FAILS with the `mirror_of 1 is not in scope` ClickException; `test_subset_autoincludes_chain_members` FAILS (bead 11 missing → chain incomplete / span < 290).

- [ ] **Step 3: Add `_dependency_closure` and use it in `extract_beads`**

Add near `_grouping_from_manifest`:

```python
def _dependency_closure(
    bead_ids: list[int], overrides: dict, manifest_beads: list[dict]
) -> set[int]:
    """Expand a requested bead set to everything a correct re-run needs:
    all solids sharing a ``physical_bead_id`` (multi-solid chains) plus any
    ``mirror_of`` sibling and ``chain`` members named in the overrides."""
    want = set(bead_ids)
    pid_of = {b["bead_id"]: b.get("physical_bead_id", b["bead_id"]) for b in manifest_beads}
    members_of_pid: dict[int, list[int]] = {}
    for b in manifest_beads:
        members_of_pid.setdefault(pid_of[b["bead_id"]], []).append(b["bead_id"])
    for bid in list(want):
        want.update(members_of_pid.get(pid_of.get(bid, bid), []))
    for key, spec in (overrides or {}).items():
        if not isinstance(spec, dict):
            continue
        chain = spec.get("chain", [])
        if len(chain) > 1 and want & set(chain):
            want.update(chain)
        if "mirror_of" in spec:
            try:
                mb = int(key)
            except (TypeError, ValueError):
                continue
            if mb in want:
                want.add(spec["mirror_of"])
    return want
```

Then in `extract_beads`, change the scope line from:

```python
    scope = set(all_ids) if bead_ids is None else set(bead_ids)
```

to:

```python
    scope = (
        set(all_ids)
        if bead_ids is None
        else _dependency_closure(bead_ids, overrides, manifest["beads"])
    )
```

- [ ] **Step 4: Add the `--beads` CLI option**

In `cmd_extract` (the `@cli.command("extract")` handler), add an option and pass it through. Change the decorator/signature/body:

```python
@click.option(
    "--beads",
    "beads_csv",
    default=None,
    help="Comma-separated bead ids to (re-)extract; omitted = whole model.",
)
def cmd_extract(
    model_dir: Path,
    end_faces_path: Path,
    output_path: Path,
    overrides_path: Path | None,
    beads_csv: str | None,
) -> None:
    """Cap-seeded centerline extraction: march -> refine -> chain."""
    bead_ids = [int(x) for x in beads_csv.split(",")] if beads_csv else None
    payload = extract_beads(model_dir, end_faces_path, overrides_path, bead_ids=bead_ids)
    Path(output_path).write_text(json.dumps(payload, indent=2))
    click.echo(f"wrote {output_path}: {len(payload['beads'])} beads")
```

(Delete the old `payload = extract_model(...)` line inside `cmd_extract`; `extract_model` remains for API callers.)

- [ ] **Step 5: Run tests + full suite + lint**

Run: `.venv/bin/python -m pytest tests/test_phase0_extract_beads.py -q && .venv/bin/python -m pytest -q && .venv/bin/ruff check src tests`
Expected: all PASS; suite **45 passed, 6 skipped**; lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/sealer_provisioning/centerline_extractor.py tests/test_phase0_extract_beads.py
git commit -m "feat(sealer): dependency closure + extract --beads for per-subset re-runs"
```

---

### Task 5: CUV 227/227 acceptance gate (local, non-committed)

The synthetic tests prove the mechanism; this proves fidelity on the real data. It reads customer geometry under `pmo/projects/03008` (git-ignored), so it is a **manual gate**, not a committed test.

**Files:**
- Create (scratch, not committed): a throwaway script under the session scratchpad.

- [ ] **Step 1: Run the full-model extract with the real overrides and compare to frozen v3**

```bash
PMO=/home/teruel/JARVIS/workspaces/strokmatic/pmo/projects/03008
INP=$PMO/sealer_provisioning_input/BC4B_CUV
TMP=$(mktemp -d)/CUV; mkdir -p "$TMP"
cp "$INP/manifest.json" "$TMP/manifest.json"   # RAW manifest (physical_bead_id absent -> singletons)
ln -s "$INP/beads" "$TMP/beads"
.venv/bin/python - "$TMP" "$PMO" <<'PY'
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, "src")
from sealer_provisioning.centerline_extractor import extract_beads
tmp, pmo = Path(sys.argv[1]), Path(sys.argv[2])
payload = extract_beads(tmp, pmo/"analysis_cuv/end_faces.json", pmo/"analysis_cuv/manual_centerline_overrides.json")
v3 = {b["bead_id"]: np.asarray(b["points"], float)
      for b in json.loads((pmo/"sealer_provisioning_input/BC4B_CUV/sealer_centerline_v3.json").read_text())["beads"]}
gb = {b["bead_id"]: np.asarray(b["points"], float) for b in payload["beads"]}
def md(a, b):
    return float(max(np.linalg.norm(a[:,None]-b[None],axis=2).min(axis=1).max(),
                     np.linalg.norm(b[:,None]-a[None],axis=2).min(axis=1).max()))
exact = sum(1 for i in v3 if i in gb and len(v3[i]) == len(gb[i]) and md(v3[i], gb[i]) < 1e-6)
diff = sorted((i, round(md(v3[i], gb[i]), 2)) for i in v3 if not (i in gb and len(v3[i]) == len(gb[i]) and md(v3[i], gb[i]) < 1e-6))
print(f"byte-exact vs v3: {exact}/{len(v3)}; differing: {diff[:6]}")
PY
```

Expected output: `byte-exact vs v3: 227/227; differing: []` (the ~19-min full run). If any bead differs, STOP — the mirror/refine wiring regressed; do not proceed.

- [ ] **Step 2: Record the result (no commit — customer data)**

Note the `227/227` result in the PR/handoff description. Do not add the scratch script or any `pmo/` data to git.

---

## Self-Review

**1. Spec coverage.** Spec §8 (mirror two-pass) → Tasks 1+3. §7 (`extract_beads` + dependency closure + `--beads`) → Tasks 1+4. §5 (`manual_points` new type) → Task 2. §9 testing (mirror-pair fixture, `manual_points` fixture, subset≡full consistency, CUV 227/227 gate) → Tasks 1-5. Not in this plan (correctly — separate GUI plans): §4/§6 the Electron app, the `python/` dispatch scripts, the merge-back into `sealer_centerline.json` (that lives in the GUI repo and consumes `extract_beads`).

**2. Placeholder scan.** `_apply_mirror_overrides` is a deliberate, named placeholder in Task 1 filled in Task 3 (the plan states this and shows the final body) — not a hidden TODO. No "handle edge cases"/"add validation"/"TBD" strings; every code step shows complete code.

**3. Type consistency.** `extract_beads(model_dir, end_faces_path, overrides_path=None, bead_ids=None)` is used identically in Tasks 1-5. `_dependency_closure(bead_ids, overrides, manifest_beads) -> set[int]` (Task 4) is called with exactly those args in `extract_beads`. `_apply_mirror_overrides(raw)` consumes the `raw` dict shape defined in Task 1 (`{"solid","mesh","cap_a","cap_b","facets","ov"}`) and reads `raw[sib]["solid"]["points"]`, matching pass 1. `diag["selected"] == "manual"` (Task 2, cap_seeded) is exactly what `refine.py`'s guard checks (Task 2, refine). Fixture builders `build_manual_points_model` / `build_mirror_pair` return dicts whose keys (`overrides_path`, `L`, `Y`, `manual`) match their test consumers.

---

## Execution Handoff

Plan complete. After execution, the GUI phases (C1 skeleton → C2 caps → C3 grouping/mirror/loop/directed → C4 node-drag → C5 packaging) each get their own plan, written against the forked skeleton's actual code.
