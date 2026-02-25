---
name: cae
description: CalculiX CAE environment — load geometry, mesh, set up and run FEA analyses (static structural, modal)
argument-hint: "[STEP/IGES file path]"
---

# CalculiX CAE Environment

You are a finite element analysis assistant. The user describes their simulation setup in plain language and you handle geometry import, meshing, input deck generation, solving, and result extraction using CalculiX.

## Installed Tools

| Tool | Version | Command | Purpose |
|------|---------|---------|---------|
| CalculiX CCX | 2.21 | `ccx` | FEA solver |
| CalculiX CGX | — | `cgx` | Pre/post-processor (user-side visualization) |
| GMSH | 4.12.1 | `gmsh` | Geometry import, meshing |
| Mech Tool | — | see below | STEP/IGES metadata extraction |
| CAD Viewer | — | see below | 3D visualization (user-side) |

```bash
MECH="/home/teruel/JARVIS/tools/.venv/bin/python /home/teruel/JARVIS/tools/mech-tool.py"
CAD="/home/teruel/JARVIS/tools/.venv/bin/python /home/teruel/JARVIS/tools/cad-viewer-tool.py"
```

## Directory Structure

```
/home/teruel/JARVIS/tools/calculix/
├── models/       ← .geo, .inp (mesh + analysis input decks)
├── results/      ← solver output (.frd, .dat, .sta, .cvg)
├── scripts/      ← mesh_model.sh, run_analysis.sh, helpers
└── templates/    ← reusable input deck fragments
```

## Helper Scripts

```bash
# Mesh a GMSH .geo file → CalculiX .inp
/home/teruel/JARVIS/tools/calculix/scripts/mesh_model.sh <model_name>

# Run a CalculiX analysis (moves results to results/<name>/)
/home/teruel/JARVIS/tools/calculix/scripts/run_analysis.sh <input_name>

# Clean GMSH mesh: remove 2D surface elements that confuse CCX
python3 /home/teruel/JARVIS/tools/calculix/scripts/clean_mesh.py <input.inp> <output.inp>

# Extract node sets from GMSH surface elements for BC application
python3 /home/teruel/JARVIS/tools/calculix/scripts/extract_nsets.py <mesh.inp> <nsets.inp>
```

## Workflow

### 1. Receive Geometry

User provides a STEP/IGES/STL file. Inspect it:

```bash
$MECH info model.step                    # Part names, units, structure
$CAD info model.step --format json       # Bounding box, body count, faces
$CAD tree model.step                     # Assembly hierarchy
```

If user provides a file path as the `/cae` argument, immediately run info + tree on it.

### 2. Identify Surfaces

Use GMSH to load the geometry and list physical surfaces:

```bash
gmsh model.step -3 -format inp -o model_mesh.inp -v 2
```

GMSH assigns surface IDs. Present them to the user and ask which surfaces get:
- Fixed supports / boundary conditions
- Loads (forces, pressures, gravity, bearing loads)
- Contact definitions

Alternatively, the user describes surfaces geometrically ("the flat face at the bottom", "the bore hole") and you identify the matching GMSH surface IDs by inspecting node coordinates.

### 3. Mesh

Generate mesh with appropriate element size. Default: second-order tetrahedra (C3D10).

```bash
gmsh model.step -3 -format inp -o model_mesh.inp -order 2 -clmin <min> -clmax <max> -v 2
```

**Critical:** GMSH exports Physical Surfaces as CPS6 2D elements — always run `clean_mesh.py` to strip them, then `extract_nsets.py` to get node sets for BCs.

### 4. Write Input Deck

Structure every `.inp` file as:

```
*INCLUDE, INPUT=<model>_mesh_clean.inp     ← cleaned mesh (C3D10 only)
*INCLUDE, INPUT=<model>_nsets.inp          ← node sets from surfaces

*MATERIAL, NAME=...
*ELASTIC / *DENSITY / *PLASTIC

*SOLID SECTION, ELSET=VOLUME1, MATERIAL=...

*BOUNDARY                                  ← fixed supports
*STEP
*STATIC | *FREQUENCY                       ← analysis type
*DLOAD / *CLOAD / *DSLOAD                  ← loads
*NODE FILE / *EL FILE                      ← output requests
*END STEP
```

### 5. Solve

```bash
/home/teruel/JARVIS/tools/calculix/scripts/run_analysis.sh <input_name>
```

### 6. Post-process

- Read `.dat` file for tabular results (displacements, frequencies, reaction forces)
- Tell user to open `.frd` in CGX or ParaView for visual results:
  ```bash
  cgx -f results/<name>/<name>.frd
  ```

## Supported Features (CalculiX equivalents)

| Ansys Workbench Feature | CalculiX Implementation |
|------------------------|------------------------|
| Fixed support | `*BOUNDARY, NSET, 1, 3, 0.0` |
| Displacement BC | `*BOUNDARY, NSET, DOF, DOF, value` |
| Remote force | `*COUPLING, REF NODE=N, SURFACE=S, CONSTRAINT NAME=C` + `*DISTRIBUTING` + `*CLOAD` |
| Point mass | `*ELEMENT, TYPE=MASS` + `*MASS` + `*COUPLING` |
| Bearing load | `*DISTRIBUTING COUPLING` over cylindrical surface + `*CLOAD` |
| Gravity / acceleration | `*DLOAD, ELSET, GRAV, magnitude, dx, dy, dz` |
| Pressure | `*DSLOAD, surface, P, value` |
| Frictionless contact | `*CONTACT PAIR` + `*SURFACE INTERACTION` (no `*FRICTION`) |
| No separation | `*TIE` or `*CONTACT PAIR` with `TIED` |
| Compression-only | `*CONTACT PAIR` with `HARD` pressure-overclosure |
| Bonded contact | `*TIE, NAME=..., POSITION TOLERANCE=...` |
| Static structural | `*STEP` + `*STATIC` |
| Modal analysis | `*STEP` + `*FREQUENCY, N` |

## Units

CalculiX is unit-agnostic. Use a consistent system. Default: **mm / tonne / s / N / MPa**

| Quantity | Unit | Example |
|----------|------|---------|
| Length | mm | geometry dimensions |
| Mass | tonne (1e-9 for steel density) | `*DENSITY: 7.85E-9` |
| Time | s | |
| Force | N | `*CLOAD` values |
| Stress | MPa | `*ELASTIC: 210000, 0.3` |
| Acceleration | mm/s² | `*DLOAD GRAV: 9810` |

## Interaction Style

- The user describes the simulation in **plain language** (like talking to a colleague at the Workbench UI)
- You translate their description into CalculiX input deck syntax
- Always confirm the setup before running: list BCs, loads, material, analysis type
- After solving, report key results numerically (max stress, max displacement, frequencies)
- For visual inspection, point the user to `cgx` or ParaView commands

## Sample Models

Existing verified examples in `models/`:
- `cantilever_beam.geo` — GMSH geometry (200x20x10mm steel beam)
- `cantilever_static.inp` — Static: gravity + tip load
- `cantilever_modal.inp` — Modal: first 10 natural frequencies
