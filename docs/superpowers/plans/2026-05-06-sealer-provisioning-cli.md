# [4.9] Sealer Provisioning CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkbox tracking.

**Goal:** Phase 1 CLI suite to provision `/config/sealer/{model_type}/` folders with `part.stl` and `sealer_centerline.json` for new car models. Strokmatic-only operation; no GUI. (`sealer_2d_rois.json` is no longer authored — [4.11] inference derives ROIs at runtime from the centerline + depth_map metadata.)

**Tech Stack:** Python 3.10, click, trimesh, open3d, pyyaml, numpy. Isolated `pythonocc-core` venv for STEP→STL.

**Spec:** `docs/superpowers/specs/2026-05-06-sealer-provisioning-cli-design.md`

**Repo path:** `tools/sealer-provisioning/` (NEW directory in `visionking` monorepo)

**Estimate:** ~1.5d implementation + 1.5d ajustes. ~22 unit tests across 3 authoring CLIs + orchestrator + integration.

---

## File Structure

```
tools/sealer-provisioning/
├── pyproject.toml
├── requirements.txt
├── requirements-occ.txt
├── README.md
├── Makefile                                # setup-venv, test, provision-creta, etc.
├── src/sealer_provisioning/
│   ├── __init__.py
│   ├── cli.py                              # click root group registering subcommands
│   ├── step2stl.py
│   ├── centerline_extractor.py
│   ├── validator.py
│   ├── provision.py
│   └── parsers/
│       ├── __init__.py
│       ├── base.py
│       └── csv_parser.py
├── tests/
│   ├── conftest.py
│   ├── fixtures/                           # Synthetic STEPs, CSVs
│   ├── test_step2stl.py
│   ├── test_centerline_extractor.py
│   ├── test_validator.py
│   └── test_provision.py
└── scripts/
    └── install-occ-venv.sh
```

---

## Task 1 — Scaffold + packaging

- [ ] **Step 1: directory structure + pyproject.toml**
```toml
[project]
name = "sealer-provisioning"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "click>=8.1",
    "trimesh>=4.0",
    "open3d>=0.18",
    "pyyaml>=6.0",
    "numpy>=1.24,<2.0",
    "pydantic>=2.0",
]

[project.scripts]
step2stl = "sealer_provisioning.step2stl:cli"
centerline-extractor = "sealer_provisioning.centerline_extractor:cli"
sealer-validator = "sealer_provisioning.validator:cli"
sealer-provision = "sealer_provisioning.provision:cli"
```

- [ ] **Step 2: `requirements-occ.txt`** isolated for STEP→STL
```
pythonocc-core>=7.7
numpy<2.0
```

- [ ] **Step 3: `scripts/install-occ-venv.sh`**
```bash
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -m venv "$DIR/.venv-occ"
"$DIR/.venv-occ/bin/pip" install -r "$DIR/requirements-occ.txt"
echo "OCC venv ready: $DIR/.venv-occ"
```

- [ ] **Step 4: Makefile**
```makefile
.PHONY: setup test provision-test
setup:
	python3 -m venv .venv && .venv/bin/pip install -e .
	bash scripts/install-occ-venv.sh
test:
	.venv/bin/pytest tests/ -v
```

- [ ] **Step 5: empty `__init__.py` + commit** `feat(sealer-provisioning): scaffold tooling package`

---

## Task 2 — `step2stl` CLI (TDD)

- [ ] **Step 1: failing tests** (`tests/test_step2stl.py`)
```python
def test_converts_simple_step_to_stl(tmp_path, fixture_step_cube):
    out = tmp_path / "cube.stl"
    result = subprocess.run(["step2stl", str(fixture_step_cube), str(out)], capture_output=True)
    assert result.returncode == 0
    mesh = trimesh.load(out)
    assert len(mesh.vertices) > 0
    assert mesh.is_watertight

def test_rejects_invalid_step(tmp_path):
    bad = tmp_path / "bad.step"
    bad.write_text("garbage")
    result = subprocess.run(["step2stl", str(bad), str(tmp_path/"out.stl")], capture_output=True)
    assert result.returncode != 0
    assert b"failed to read STEP" in result.stderr.lower() or b"error" in result.stderr.lower()

def test_tolerance_affects_triangle_count(tmp_path, fixture_step_curved_surface):
    # Lower tolerance → more triangles
    coarse = tmp_path / "coarse.stl"
    fine = tmp_path / "fine.stl"
    subprocess.run(["step2stl", str(fixture_step_curved_surface), str(coarse), "--tolerance", "1.0"])
    subprocess.run(["step2stl", str(fixture_step_curved_surface), str(fine), "--tolerance", "0.05"])
    assert len(trimesh.load(fine).vertices) > len(trimesh.load(coarse).vertices)
```

Fixture STEPs generated programmatically via `cadquery` (in test-only deps) or hand-crafted minimal STEP text.

- [ ] **Step 2: implement `step2stl.py`** — calls subprocess to OCC venv:
```python
import click, subprocess, sys
from pathlib import Path

OCC_VENV_PYTHON = Path(__file__).parents[2] / ".venv-occ/bin/python"

@click.command()
@click.argument("input_step", type=click.Path(exists=True))
@click.argument("output_stl", type=click.Path())
@click.option("--tolerance", default=0.1)
@click.option("--angular-deflection", default=0.5)
def cli(input_step, output_stl, tolerance, angular_deflection):
    """Convert STEP CAD to STL via OpenCascade (isolated venv)."""
    if not OCC_VENV_PYTHON.exists():
        click.echo("Error: OCC venv missing. Run 'bash scripts/install-occ-venv.sh'", err=True)
        sys.exit(2)
    helper = Path(__file__).parent / "_occ_step2stl.py"
    subprocess.run([str(OCC_VENV_PYTHON), str(helper),
                    input_step, output_stl,
                    "--tolerance", str(tolerance),
                    "--angular-deflection", str(angular_deflection)],
                   check=True)
```

`_occ_step2stl.py` (executed in OCC venv):
```python
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.StlAPI import StlAPI_Writer
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
import sys

def convert(step_path, stl_path, tol, ang):
    reader = STEPControl_Reader()
    if reader.ReadFile(step_path) != 1:
        print(f"failed to read STEP: {step_path}", file=sys.stderr); sys.exit(1)
    reader.TransferRoots()
    shape = reader.OneShape()
    BRepMesh_IncrementalMesh(shape, tol, False, ang)
    writer = StlAPI_Writer()
    writer.SetASCIIMode(False)  # binary STL
    if not writer.Write(shape, stl_path):
        print("failed to write STL", file=sys.stderr); sys.exit(1)
```

- [ ] **Step 3: validation** — `is_watertight`, triangle count > 100, bbox < 50m

- [ ] **Step 4: commit** `feat(sealer-provisioning): step2stl CLI with OCC isolation`

---

## Task 3 — `centerline-extractor` CLI (TDD)

- [ ] **Step 1: failing tests**
```python
def test_extracts_two_beads_from_csv(tmp_path):
    csv = tmp_path / "robot_path.csv"
    csv.write_text("bead_name,x,y,z\n"
                    "LFT_SILL,0,0,0\nLFT_SILL,100,0,0\n"
                    "RGT_SILL,0,500,0\nRGT_SILL,100,500,0\n")
    out = tmp_path / "centerline.json"
    subprocess.run(["centerline-extractor", str(csv), str(out),
                    "--model-type", "CRETA_2026",
                    "--bead-mapping", "left_sill:LFT_SILL,right_sill:RGT_SILL"],
                   check=True)
    data = json.loads(out.read_text())
    assert data["model_type"] == "CRETA_2026"
    assert len(data["beads"]) == 2
    assert data["beads"][0]["name"] in ("left_sill", "right_sill")
    assert len(data["beads"][0]["points"]) == 2

def test_rejects_too_few_points(tmp_path):
    csv = tmp_path / "robot_path.csv"
    csv.write_text("bead_name,x,y,z\nLFT_SILL,0,0,0\n")  # 1 point
    result = subprocess.run([...], capture_output=True)
    assert result.returncode != 0

def test_applies_frame_transform(tmp_path):
    # Identity vs translate-only matrix; verify points shifted
    ...
```

- [ ] **Step 2: implement** with pluggable parser pattern:
```python
# parsers/base.py
class RobotPathParser(ABC):
    @abstractmethod
    def parse(self, path: Path) -> dict[str, np.ndarray]: ...

# parsers/csv_parser.py
class CsvParser(RobotPathParser):
    def parse(self, path):
        rows = csv.DictReader(path.open())
        beads = defaultdict(list)
        for r in rows:
            beads[r["bead_name"]].append([float(r["x"]), float(r["y"]), float(r["z"])])
        return {k: np.array(v) for k, v in beads.items()}

# centerline_extractor.py CLI
@click.command()
@click.argument("input_path"); @click.argument("output_json")
@click.option("--model-type", required=True)
@click.option("--bead-mapping", default="")  # "out:in,out2:in2"
@click.option("--default-width-mm", default=22.0)
@click.option("--frame-transform", default=None)  # path to 4x4 matrix file
@click.option("--parser", default="csv")
def cli(input_path, output_json, model_type, bead_mapping, default_width_mm, frame_transform, parser):
    parser_cls = PARSERS[parser]()
    raw = parser_cls.parse(Path(input_path))
    mapping = parse_mapping(bead_mapping) if bead_mapping else {k: k for k in raw}
    T = load_transform(frame_transform) if frame_transform else np.eye(4)
    output = {"model_type": model_type, "beads": []}
    for out_name, in_name in mapping.items():
        if in_name not in raw: continue
        pts = raw[in_name]
        if len(pts) < 2:
            click.echo(f"Bead {out_name} has < 2 points", err=True); sys.exit(1)
        pts_h = np.hstack([pts, np.ones((len(pts),1))])
        pts_xform = (T @ pts_h.T).T[:,:3]
        output["beads"].append({"name": out_name, "points": pts_xform.tolist(),
                                "expected_width_mm": default_width_mm})
    Path(output_json).write_text(json.dumps(output, indent=2))
```

- [ ] **Step 3: commit** `feat(sealer-provisioning): centerline-extractor CLI with pluggable parsers`

---

## Task 4 — `validator` CLI (TDD)

- [ ] **Step 1: failing tests**
```python
def test_passes_when_centerline_near_surface(tmp_path):
    # synthetic STL: flat plane at z=0 (10x10m)
    # synthetic centerline: 10 points within z=[0, 5] mm
    # exit code 0
    ...

def test_fails_when_centerline_far_from_surface(tmp_path):
    # centerline points at z=100mm, max-distance=10
    # exit code 1, error message lists offending points

def test_warns_when_centerline_inside_mesh(tmp_path):
    # centerline points with negative signed distance (inside cube)
    # exit code 1

def test_fails_when_part_stl_missing(tmp_path):
    # only sealer_centerline.json present → exit code 1
    ...

def test_fails_when_centerline_schema_invalid(tmp_path):
    # sealer_centerline.json missing required "beads" key → exit code 1
    ...
```

- [ ] **Step 2: implement** with Open3D raycasting + presence/schema checks for `part.stl` and `sealer_centerline.json`:
```python
import open3d as o3d, numpy as np, json, click, sys

@click.command()
@click.argument("config_dir", type=click.Path(exists=True, file_okay=False))
@click.option("--max-distance-mm", default=10.0)
def cli(config_dir, max_distance_mm):
    base = Path(config_dir)
    mesh = o3d.io.read_triangle_mesh(str(base / "part.stl"))
    if not mesh.has_triangles():
        click.echo("part.stl empty", err=True); sys.exit(1)
    scene = o3d.t.geometry.RaycastingScene()
    scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(mesh))
    centerline = json.loads((base / "sealer_centerline.json").read_text())
    failures = []
    for bead in centerline["beads"]:
        pts = np.asarray(bead["points"], dtype=np.float32)
        sd = scene.compute_signed_distance(o3d.core.Tensor(pts)).numpy()
        bad = np.abs(sd) > max_distance_mm
        if bad.any():
            failures.append(f"{bead['name']}: {bad.sum()} points > {max_distance_mm}mm")
    if failures:
        for f in failures: click.echo(f, err=True)
        sys.exit(1)
    click.echo("validation passed")
```

- [ ] **Step 3: commit** `feat(sealer-provisioning): validator CLI`

---

## Task 5 — `provision` orchestrator + integration test

- [ ] **Step 1: failing test (integration)**
```python
def test_provision_full_creta_2026(tmp_path, fixture_step_creta, fixture_csv_creta):
    output_base = tmp_path / "config"
    result = subprocess.run([
        "sealer-provision",
        "--step", str(fixture_step_creta),
        "--robot-path", str(fixture_csv_creta),
        "--model-type", "CRETA_2026",
        "--output", str(output_base),
    ], capture_output=True)
    assert result.returncode == 0
    target = output_base / "CRETA_2026"
    assert (target / "part.stl").exists()
    assert (target / "sealer_centerline.json").exists()
    # sealer_2d_rois.json is NOT produced — [4.11] inference derives ROIs at runtime
    assert not (target / "sealer_2d_rois.json").exists()
```

- [ ] **Step 2: implement** orchestrator that calls each step in sequence:
```python
@click.command()
@click.option("--step"); @click.option("--robot-path")
@click.option("--model-type", required=True)
@click.option("--output", required=True)
def cli(step, robot_path, model_type, output):
    target = Path(output) / model_type
    target.mkdir(parents=True, exist_ok=True)

    # Step 1: STL
    subprocess.run(["step2stl", step, str(target / "part.stl")], check=True)

    # Step 2: centerline
    subprocess.run(["centerline-extractor", robot_path, str(target / "sealer_centerline.json"),
                    "--model-type", model_type], check=True)

    # Step 3: validate
    subprocess.run(["sealer-validator", str(target)], check=True)

    click.echo(f"Provisioned: {target}")
```

- [ ] **Step 3: commit** `feat(sealer-provisioning): provision orchestrator + integration test`

---

## Task 6 — Operator runbook + README

- [ ] **Step 1: README.md** with sections:
  - Quick start (install + sample command)
  - Provisioning runbook (the 5-step procedure from spec §10)
  - Per-tool CLI reference
  - Troubleshooting (OCC venv missing, STEP unreadable, mesh not watertight, centerline too far from surface)
  - Phase 2 GUI deferred — link to backlog item
  - Note: `sealer_2d_rois.json` is NOT produced; [4.11] inference derives ROIs at runtime from `sealer_centerline.json`

- [ ] **Step 2: smoke-test the runbook** by following it end-to-end with a synthetic CRETA fixture; capture screenshots for the README

- [ ] **Step 3: commit** `docs(sealer-provisioning): operator runbook + README`

---

## Task 7 — CI integration + handover

- [ ] **Step 1: GitHub Actions workflow** `.github/workflows/sealer-provisioning-test.yml`
```yaml
name: sealer-provisioning tests
on: [push, pull_request]
paths: ["tools/sealer-provisioning/**"]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.10" }
      - run: cd tools/sealer-provisioning && make setup && make test
```

- [ ] **Step 2: handover document** `docs/sealer-provisioning-handover.md` for Strokmatic engineering team:
  - Where the CLI lives
  - Who owns updates (engineering team)
  - When to invoke (per new car model)
  - Where to file issues (GitHub repo)

- [ ] **Step 3: commit** `ci(sealer-provisioning): GH Actions test workflow + handover doc`

---

## Cross-cutting checks

- All tests pass on Linux + macOS
- OCC venv installs in < 5 min on clean system
- End-to-end provision of synthetic CRETA fixture < 30s wall clock

## Definition of done

- All 7 tasks committed
- 22+ unit/integration tests passing
- Synthetic CRETA fixture provisioned end-to-end
- README + handover docs complete
- CI workflow green
- Backlog SEALER-PROV-CLI marked complete; SEALER-PROV-GUI added to backlog as Phase 2 epic
- Changelog entry via `changelog-writer`

---

## Revision History

- **2026-05-07** — Removed `roi-builder` CLI tool and `sealer_2d_rois.json` artifact. The 2D inference service ([4.11]) now derives ROIs at runtime from `sealer_centerline.json` + depth_map metadata — single source of truth between SEALER-03 and inference. Saves the authoring step entirely (no operator decision required for ROI placement). Tasks reduced from 8 to 7 (former Task 4 deleted; subsequent tasks renumbered). Estimate reduced from 2d+2d / ~30 tests to ~1.5d+1.5d / ~22 tests. Validator's ROI checks dropped; orchestrator now runs `step2stl` → `centerline-extractor` → `validator`.
- **2026-05-06** — Initial draft.
