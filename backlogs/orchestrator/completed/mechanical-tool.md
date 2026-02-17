# Mechanical File Tool

**Status:** Done
**Completed:** 2026-02-17

## Purpose

General-purpose CLI tool for extracting metadata and structured information from mechanical engineering file formats (2D drawings, 3D models, PDF catalogs). Follows the same pattern as `tools/xlsx-tool.py` + `skills/xlsx/SKILL.md`.

## Components

### 1. `tools/mech-tool.py` — CLI tool

Argparse CLI invoked via `tools/.venv/bin/python`.

**Subcommands:**

| Subcommand | Purpose |
|------------|---------|
| `info <file>` | Quick summary: format, units, entity count, bounding box, metadata |
| `read <file>` | Full structured extraction (JSON or table output) |
| `convert <file> -o <output>` | Format conversion (DWG→DXF, STEP→STL) |
| `validate <file>` | Integrity checks (well-formed structure, degenerate geometry) |

### 2. Supported Formats

| Format | Extensions | Library | Extracts |
|--------|-----------|---------|----------|
| DXF | `.dxf` | `ezdxf` | Layers, blocks, dimensions, text, title block, entity summary |
| STEP | `.step`, `.stp` | Text parsing (+ `cadquery` if available) | Assembly tree, part names, units, metadata header |
| IGES | `.iges`, `.igs` | Text parsing (ASCII format) | Entity directory, parameter data, units, author |
| STL | `.stl` | `numpy-stl` | Triangle count, volume, surface area, bounding box |
| GLTF/GLB | `.gltf`, `.glb` | `pygltflib` | Scene tree, mesh count, materials, node hierarchy |
| SVG | `.svg` | `xml.etree` (stdlib) | Viewbox, dimensions, layer/group structure, element counts |
| PDF | `.pdf` | `pdfplumber` + `pymupdf` | Pages, tables, text extraction, metadata |
| DWG | `.dwg` | ODA File Converter → DXF → ezdxf | Same as DXF (via conversion) |

### 3. `.claude/skills/mechanical/SKILL.md` — Skill definition

Invocable as `/mechanical`. Documents all subcommands, examples, and common workflows.

### 4. Dependencies

Installed into existing `tools/.venv/`:
- `ezdxf` — DXF reading/writing/auditing
- `numpy-stl` — STL mesh analysis (volume, surface area, bounding box)
- `pygltflib` — GLTF/GLB scene parsing
- `pdfplumber` — PDF table/text extraction
- `pymupdf` — PDF image extraction and rendering

Optional (not installed by default):
- `cadquery` — STEP geometry analysis and STEP→STL conversion (pulls OpenCASCADE)

### 5. External dependencies

- **ODA File Converter** — Required only for DWG→DXF conversion. Tool prints install instructions if missing.

## Design Decisions

- **STEP/IGES parsed as text.** Both formats are ASCII with well-defined structure. Text parsing extracts header metadata, product names, and entity counts without requiring the heavy `pythonocc-core` / OpenCASCADE dependency. If `cadquery` is installed, it's used for geometry operations (volume, mass properties).
- **DWG via ODA gateway.** DWG is a proprietary binary format. ODA File Converter is the standard free tool for conversion. The tool detects it in PATH and common install locations, with clear error messages if missing.
- **Graceful fallback everywhere.** Missing optional dependencies produce actionable error messages, not crashes. Core functionality (info, read, validate) works with just the pip-installed packages.
- **Follows xlsx-tool.py pattern exactly.** Same argparse structure, same venv invocation, same skill format. Users familiar with `/xlsx` will immediately understand `/mechanical`.

## File Inventory

| File | Action |
|------|--------|
| `tools/mech-tool.py` | Created (~480 lines) |
| `.claude/skills/mechanical/SKILL.md` | Created |
| `tools/.venv/` | Modified (5 new pip packages) |

## Verification

Tested successfully:
- `mech-tool.py info /tmp/test_cube.stl` — correct triangle count (12), volume (1.0), surface area (6.0), bounding box
- `mech-tool.py validate /tmp/test_cube.stl` — passes validation
- All 5 pip dependencies import successfully
- CLI help text renders correctly
- Skill detected by Claude Code (`/mechanical` appears in skill list)

## Out of Scope

- Proprietary CAD formats (CATPART, PRT, SLDPRT) — users export to STEP
- Full 3D geometry kernel — text parsing covers metadata needs; cadquery is optional for geometry
- DWG writing — read-only via ODA conversion
