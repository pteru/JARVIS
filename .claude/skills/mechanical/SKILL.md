---
name: mechanical
description: Work with mechanical engineering files — DXF, STEP, IGES, STL, GLTF, SVG, PDF, DWG
argument-hint: "[subcommand] [file]"
---

# Mechanical File Tool

A CLI tool for extracting metadata and structure from engineering files. Always invoke via the dedicated venv:

```
MECH="/home/teruel/JARVIS/tools/.venv/bin/python /home/teruel/JARVIS/tools/mech-tool.py"
```

## Supported Formats

| Format | Extensions | What it extracts |
|--------|-----------|-----------------|
| DXF | `.dxf` | Layers, blocks, dimensions, text, entity summary |
| STEP | `.step`, `.stp` | Assembly tree, part names, units, header metadata |
| IGES | `.iges`, `.igs` | Entity directory, units, author, organization |
| STL | `.stl` | Triangle count, volume, surface area, bounding box |
| GLTF/GLB | `.gltf`, `.glb` | Scene tree, meshes, materials, animations |
| SVG | `.svg` | Viewbox, dimensions, layers, element counts |
| PDF | `.pdf` | Pages, tables, text, metadata |
| DWG | `.dwg` | Same as DXF (via ODA File Converter) |

## Subcommands

### Info — quick summary
```bash
$MECH info drawing.dxf          # Layers, entity counts, extents, units
$MECH info assembly.step        # Header, product names, entity types
$MECH info part.stl             # Triangle count, volume, bounding box
$MECH info scene.glb            # Meshes, materials, animations
$MECH info catalog.pdf          # Page count, metadata, table detection
```

### Read — full structured extraction
```bash
$MECH read drawing.dxf                          # Human-readable table output
$MECH read drawing.dxf --format json            # JSON output
$MECH read assembly.step --format json          # Products, entity counts
$MECH read catalog.pdf --pages 1-3 --format json  # Extract specific pages
$MECH read catalog.pdf --pages 2                # Single page text + tables
```

### Convert — format conversion
```bash
$MECH convert drawing.dwg -o drawing.dxf       # DWG→DXF (requires ODA File Converter)
$MECH convert part.step -o part.stl             # STEP→STL (requires cadquery)
```

### Validate — integrity checks
```bash
$MECH validate drawing.dxf     # Audit DXF structure
$MECH validate assembly.step   # Check STEP header/data sections
$MECH validate part.stl        # Check for degenerate triangles
```

## Common Workflows

**Extract BOM from a STEP assembly:**
```bash
$MECH read assembly.step --format json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for p in data['products']:
    print(p)
"
```

**Read catalog PDF tables:**
```bash
$MECH read catalog.pdf --pages 3-5 --format json
# Returns structured tables ready for processing
```

**Inspect a DXF drawing before editing:**
```bash
$MECH info drawing.dxf          # Quick overview
$MECH read drawing.dxf          # Full layer/block/text detail
$MECH validate drawing.dxf      # Check for issues
```

**Get STL mesh statistics:**
```bash
$MECH info part.stl
# Returns triangle count, volume, surface area, bounding box
```

## Notes

- **DWG files** require [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter) installed and in PATH
- **STEP→STL conversion** requires `cadquery` (optional heavy dependency with OpenCASCADE)
- **STEP/IGES** are parsed as text (no heavy geometry kernel needed for metadata)
- For full 3D geometry analysis, export to STEP and use cadquery separately
