---
name: cad
description: Load and visualize 3D CAD files — STEP, STL, OBJ, PLY, GLTF with PyVista viewer and mesh analysis
argument-hint: "[subcommand] [file]"
---

# CAD Viewer Tool

A CLI tool for loading, visualizing, and analyzing 3D CAD files. Always invoke via the tools venv:

```
CAD="/home/teruel/JARVIS/tools/.venv/bin/python /home/teruel/JARVIS/tools/cad-viewer-tool.py"
```

## Supported Formats

| Format | Extensions | Library | Notes |
|--------|-----------|---------|-------|
| STEP | `.stp`, `.step` | cadquery (OCCT) | Per-body coloring, assembly tree |
| STL | `.stl` | trimesh | Single body |
| OBJ | `.obj` | trimesh | Single or multi-body |
| PLY | `.ply` | trimesh | Single body |
| GLTF/GLB | `.gltf`, `.glb` | trimesh | Scene → mesh |
| OFF | `.off` | trimesh | Single body |

## Subcommands

### view — Interactive 3D PyVista viewer

```bash
$CAD view model.stp                              # Dark theme, default tessellation
$CAD view model.stp --edges                       # Show wireframe edges
$CAD view model.stp --opacity 0.5                 # Semi-transparent
$CAD view model.stp --background light            # Light theme
$CAD view part.stl --edges                        # STL with edges
$CAD view model.stp --tess-tolerance 0.001        # Finer tessellation
```

Features:
- Per-body coloring (muted palette, up to 16 distinct colors)
- Checkbox toggles for all bodies and per-body visibility
- Edge overlay toggle
- Dark/light theme
- Depth peeling for transparency
- Axes indicator

### info — Mesh analysis

```bash
$CAD info part.stl                                # Human-readable summary
$CAD info assembly.stp --format json              # JSON output
$CAD info model.obj --format text                 # Text output
```

Output includes:
- File format and size
- Body count, total vertices, total faces
- Bounding box (min/max xyz)
- Extents (dimensions in mm)
- Watertight status
- Volume (if watertight) and surface area
- Per-body breakdown for multi-body files

### tree — STEP assembly hierarchy

```bash
$CAD tree assembly.stp                            # Indented text tree
$CAD tree assembly.stp --format json              # JSON tree
```

Uses OCCT XDE (Extended Data Framework) to extract the full product/shape hierarchy from STEP files. Falls back to a flat body list if XDE parsing fails.

Output format:
- `[A]` = Assembly node
- `[P]` = Part node
- `[S]` = Shape node

**Note:** Only works with STEP files (`.stp`, `.step`).

## STEP Tessellation Options

When loading STEP files, the B-rep is tessellated to triangle meshes. Control quality with:

| Option | Default | Description |
|--------|---------|-------------|
| `--tess-tolerance` | 0.01 | Linear deflection in mm (lower = finer mesh) |
| `--tess-angular-tolerance` | 0.1 | Angular deflection in radians (lower = more triangles on curves) |

These options apply to `view` and `info` subcommands. The `tree` command reads STEP metadata directly without tessellation.

## Examples

```bash
# Quick analysis of a STEP assembly
$CAD info assembly.stp
$CAD tree assembly.stp

# View with fine tessellation and edges
$CAD view assembly.stp --tess-tolerance 0.001 --edges

# JSON output for scripting
$CAD info part.stl --format json | jq '.total_faces'
$CAD tree assembly.stp --format json | jq '.children[].name'

# Compare STL and STEP of the same part
$CAD info part.stl
$CAD info part.stp
```
