#!/usr/bin/env python3
"""JARVIS Mechanical File Tool — Extract metadata and structure from engineering files."""

import argparse
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _ext(path):
    return Path(path).suffix.lower()


def _filesize(path):
    return os.path.getsize(path)


def _detect_format(path):
    ext = _ext(path)
    FORMAT_MAP = {
        ".dxf": "DXF", ".dwg": "DWG",
        ".step": "STEP", ".stp": "STEP",
        ".iges": "IGES", ".igs": "IGES",
        ".stl": "STL",
        ".gltf": "GLTF", ".glb": "GLB",
        ".svg": "SVG",
        ".pdf": "PDF",
    }
    return FORMAT_MAP.get(ext, "UNKNOWN")


def _json_out(obj):
    print(json.dumps(obj, indent=2, default=str))


# ---------------------------------------------------------------------------
# DXF handlers (ezdxf)
# ---------------------------------------------------------------------------

def _dxf_info(path):
    import ezdxf
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    entities = {}
    for e in msp:
        entities[e.dxftype()] = entities.get(e.dxftype(), 0) + 1
    layers = [l.dxf.name for l in doc.layers]
    header = doc.header
    result = {
        "format": "DXF",
        "version": doc.dxfversion,
        "encoding": doc.encoding,
        "layers": layers,
        "layer_count": len(layers),
        "entity_count": sum(entities.values()),
        "entity_types": entities,
        "file_size": _filesize(path),
    }
    # Units
    try:
        result["units"] = header.get("$INSUNITS", "unknown")
    except Exception:
        pass
    # Extents
    try:
        result["extmin"] = list(header["$EXTMIN"])
        result["extmax"] = list(header["$EXTMAX"])
    except Exception:
        pass
    return result


def _dxf_read(path, fmt):
    import ezdxf
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    result = {"format": "DXF", "layers": {}, "blocks": [], "texts": [], "dimensions": []}

    for layer in doc.layers:
        l = layer.dxf
        result["layers"][l.name] = {
            "color": l.color,
            "linetype": l.linetype if hasattr(l, "linetype") else None,
        }

    for block in doc.blocks:
        if block.name.startswith("*"):
            continue
        ents = {}
        for e in block:
            ents[e.dxftype()] = ents.get(e.dxftype(), 0) + 1
        result["blocks"].append({"name": block.name, "entities": ents})

    for e in msp:
        t = e.dxftype()
        if t in ("TEXT", "MTEXT"):
            text_val = e.dxf.text if t == "TEXT" else e.text
            result["texts"].append({
                "type": t,
                "text": text_val,
                "layer": e.dxf.layer,
                "insert": list(e.dxf.insert) if hasattr(e.dxf, "insert") else None,
            })
        elif t == "DIMENSION":
            result["dimensions"].append({
                "layer": e.dxf.layer,
                "type": e.dxf.dimtype if hasattr(e.dxf, "dimtype") else None,
            })

    entity_summary = {}
    for e in msp:
        entity_summary[e.dxftype()] = entity_summary.get(e.dxftype(), 0) + 1
    result["entity_summary"] = entity_summary

    if fmt == "json":
        _json_out(result)
    else:
        print(f"Layers ({len(result['layers'])}):")
        for name, props in result["layers"].items():
            print(f"  {name}: color={props['color']}")
        print(f"\nBlocks ({len(result['blocks'])}):")
        for b in result["blocks"]:
            print(f"  {b['name']}: {b['entities']}")
        print(f"\nTexts ({len(result['texts'])}):")
        for t in result["texts"][:20]:
            print(f"  [{t['layer']}] {t['text']}")
        if len(result["texts"]) > 20:
            print(f"  ... and {len(result['texts']) - 20} more")
        print(f"\nEntity summary: {entity_summary}")


def _dxf_validate(path):
    import ezdxf
    try:
        doc = ezdxf.readfile(path)
        auditor = doc.audit()
        issues = []
        for error in auditor.errors:
            issues.append({"severity": "error", "message": str(error)})
        for fix in auditor.fixes:
            issues.append({"severity": "fixed", "message": str(fix)})
        return {
            "valid": len(auditor.errors) == 0,
            "error_count": len(auditor.errors),
            "fix_count": len(auditor.fixes),
            "issues": issues,
        }
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# STEP handlers (text parsing)
# ---------------------------------------------------------------------------

def _step_parse_header(path):
    header = {}
    in_header = False
    with open(path, "r", errors="replace") as f:
        for line in f:
            line = line.strip()
            if line == "HEADER;":
                in_header = True
                continue
            if line == "ENDSEC;":
                if in_header:
                    break
            if in_header:
                # Parse FILE_DESCRIPTION, FILE_NAME, FILE_SCHEMA
                for tag in ("FILE_DESCRIPTION", "FILE_NAME", "FILE_SCHEMA"):
                    if line.startswith(tag):
                        # Grab everything in parens
                        m = re.search(r"\((.*)\)", line, re.DOTALL)
                        if m:
                            header[tag] = m.group(1).strip()
    return header


def _step_count_entities(path):
    counts = {}
    with open(path, "r", errors="replace") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#"):
                m = re.match(r"#\d+\s*=\s*(\w+)", line)
                if m:
                    etype = m.group(1)
                    counts[etype] = counts.get(etype, 0) + 1
    return counts


def _step_info(path):
    header = _step_parse_header(path)
    counts = _step_count_entities(path)
    total = sum(counts.values())
    # Top entity types
    top = sorted(counts.items(), key=lambda x: -x[1])[:15]
    result = {
        "format": "STEP",
        "file_size": _filesize(path),
        "header": header,
        "total_entities": total,
        "top_entity_types": dict(top),
    }
    # Extract part/product names
    parts = []
    for etype in ("PRODUCT", "PRODUCT_DEFINITION", "SHAPE_REPRESENTATION"):
        if etype in counts:
            result[f"{etype.lower()}_count"] = counts[etype]
    return result


def _step_read(path, fmt):
    header = _step_parse_header(path)
    counts = _step_count_entities(path)

    # Extract product names
    products = []
    with open(path, "r", errors="replace") as f:
        for line in f:
            if "PRODUCT(" in line:
                m = re.search(r"PRODUCT\(\s*'([^']*)'", line)
                if m:
                    products.append(m.group(1))

    result = {
        "format": "STEP",
        "header": header,
        "products": products,
        "entity_counts": dict(sorted(counts.items(), key=lambda x: -x[1])),
        "total_entities": sum(counts.values()),
    }
    if fmt == "json":
        _json_out(result)
    else:
        print("STEP Header:")
        for k, v in header.items():
            print(f"  {k}: {v}")
        print(f"\nProducts: {products}")
        print(f"\nTotal entities: {sum(counts.values())}")
        print("Top types:")
        for k, v in sorted(counts.items(), key=lambda x: -x[1])[:20]:
            print(f"  {k}: {v}")


def _step_validate(path):
    try:
        header = _step_parse_header(path)
        with open(path, "r", errors="replace") as f:
            content = f.read()
        has_header = "HEADER;" in content
        has_data = "DATA;" in content
        has_end = "END-ISO-10303-21;" in content
        issues = []
        if not has_header:
            issues.append("Missing HEADER section")
        if not has_data:
            issues.append("Missing DATA section")
        if not has_end:
            issues.append("Missing END-ISO-10303-21 terminator")
        if "FILE_SCHEMA" not in content:
            issues.append("Missing FILE_SCHEMA in header")
        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "has_header": has_header,
            "has_data": has_data,
        }
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# IGES handlers (text parsing)
# ---------------------------------------------------------------------------

def _iges_info(path):
    start_lines = []
    global_lines = []
    de_count = 0
    pd_count = 0
    with open(path, "r", errors="replace") as f:
        for line in f:
            if len(line) >= 73:
                section = line[72] if len(line) > 72 else ""
                if section == "S":
                    start_lines.append(line[:72].strip())
                elif section == "G":
                    global_lines.append(line[:72].strip())
                elif section == "D":
                    de_count += 1
                elif section == "P":
                    pd_count += 1
    global_text = "".join(global_lines)
    # Parse global params (comma-separated)
    params = [p.strip() for p in global_text.split(",")]
    result = {
        "format": "IGES",
        "file_size": _filesize(path),
        "start_section": " ".join(start_lines),
        "directory_entries": de_count // 2,  # DE lines come in pairs
        "parameter_entries": pd_count,
    }
    if len(params) > 5:
        result["units_flag"] = params[14] if len(params) > 14 else None
        result["units_name"] = params[15].strip("H").strip() if len(params) > 15 else None
        result["author"] = params[6].replace("H", "").strip() if len(params) > 6 else None
        result["organization"] = params[7].replace("H", "").strip() if len(params) > 7 else None
    return result


def _iges_read(path, fmt):
    info = _iges_info(path)
    # Parse directory entries for entity types
    entity_types = {}
    with open(path, "r", errors="replace") as f:
        for line in f:
            if len(line) > 72 and line[72] == "D":
                # Entity type is in columns 1-8 of odd DE lines
                try:
                    etype = int(line[0:8].strip())
                    entity_types[etype] = entity_types.get(etype, 0) + 1
                except ValueError:
                    pass
    # Map common entity type numbers to names
    IGES_TYPES = {
        100: "Circular Arc", 102: "Composite Curve", 104: "Conic Arc",
        106: "Copious Data", 108: "Plane", 110: "Line", 112: "Parametric Spline",
        114: "Parametric Spline Surface", 116: "Point", 118: "Ruled Surface",
        120: "Surface of Revolution", 122: "Tabulated Cylinder",
        124: "Transformation Matrix", 126: "Rational B-Spline Curve",
        128: "Rational B-Spline Surface", 130: "Offset Curve",
        142: "Curve on Parametric Surface", 144: "Trimmed Surface",
        186: "Manifold Solid B-Rep", 308: "Subfigure Definition",
        314: "Color Definition", 402: "Associativity Instance",
        406: "Property", 408: "Singular Subfigure Instance",
        502: "Vertex", 504: "Edge", 508: "Loop", 510: "Face", 514: "Shell",
    }
    named = {}
    for k, v in entity_types.items():
        name = IGES_TYPES.get(k, f"Type_{k}")
        named[name] = v

    result = {**info, "entity_types": named}
    if fmt == "json":
        _json_out(result)
    else:
        print(f"IGES: {info.get('start_section', '')}")
        print(f"Directory entries: {info['directory_entries']}")
        print(f"Entity types:")
        for name, count in sorted(named.items(), key=lambda x: -x[1]):
            print(f"  {name}: {count}")


def _iges_validate(path):
    try:
        sections = {"S": 0, "G": 0, "D": 0, "P": 0, "T": 0}
        with open(path, "r", errors="replace") as f:
            for line in f:
                if len(line) > 72:
                    s = line[72]
                    if s in sections:
                        sections[s] += 1
        issues = []
        if sections["S"] == 0:
            issues.append("Missing Start section")
        if sections["G"] == 0:
            issues.append("Missing Global section")
        if sections["D"] == 0:
            issues.append("Missing Directory Entry section")
        if sections["T"] == 0:
            issues.append("Missing Terminate section")
        return {"valid": len(issues) == 0, "sections": sections, "issues": issues}
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# STL handlers (numpy-stl)
# ---------------------------------------------------------------------------

def _stl_info(path):
    from stl import mesh as stl_mesh
    m = stl_mesh.Mesh.from_file(path)
    # Bounding box
    minx, maxx = float(m.x.min()), float(m.x.max())
    miny, maxy = float(m.y.min()), float(m.y.max())
    minz, maxz = float(m.z.min()), float(m.z.max())
    # Volume and surface area (only valid for watertight meshes)
    volume, _, _ = m.get_mass_properties()
    # Surface area: sum of triangle areas
    v0 = m.v0
    v1 = m.v1
    v2 = m.v2
    import numpy as np
    cross = np.cross(v1 - v0, v2 - v0)
    areas = np.sqrt((cross ** 2).sum(axis=1)) / 2.0
    surface_area = float(areas.sum())

    # Detect binary vs ASCII
    with open(path, "rb") as f:
        header = f.read(80)
    is_binary = not header.startswith(b"solid") or b"\x00" in header[:80]

    result = {
        "format": "STL",
        "encoding": "binary" if is_binary else "ASCII",
        "file_size": _filesize(path),
        "triangle_count": len(m),
        "bounding_box": {
            "min": [minx, miny, minz],
            "max": [maxx, maxy, maxz],
            "size": [maxx - minx, maxy - miny, maxz - minz],
        },
        "volume": float(abs(volume)),
        "surface_area": surface_area,
    }
    if is_binary:
        result["header"] = header.decode("ascii", errors="replace").strip().rstrip("\x00")
    return result


def _stl_read(path, fmt):
    info = _stl_info(path)
    if fmt == "json":
        _json_out(info)
    else:
        print(f"STL ({info['encoding']}): {info['triangle_count']} triangles")
        bb = info["bounding_box"]
        print(f"Bounding box: {bb['min']} → {bb['max']}")
        print(f"Size: {bb['size']}")
        print(f"Volume: {info['volume']:.4f}")
        print(f"Surface area: {info['surface_area']:.4f}")


def _stl_validate(path):
    try:
        from stl import mesh as stl_mesh
        m = stl_mesh.Mesh.from_file(path)
        issues = []
        if len(m) == 0:
            issues.append("Mesh has no triangles")
        # Check for degenerate triangles (zero area)
        import numpy as np
        v0, v1, v2 = m.v0, m.v1, m.v2
        cross = np.cross(v1 - v0, v2 - v0)
        areas = np.sqrt((cross ** 2).sum(axis=1)) / 2.0
        degenerate = int((areas < 1e-10).sum())
        if degenerate > 0:
            issues.append(f"{degenerate} degenerate triangles (zero area)")
        # Check normals
        zero_normals = int((np.abs(m.normals).sum(axis=1) < 1e-10).sum())
        if zero_normals > 0:
            issues.append(f"{zero_normals} triangles with zero normals")
        return {
            "valid": len(issues) == 0,
            "triangle_count": len(m),
            "issues": issues,
        }
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# GLTF/GLB handlers (pygltflib)
# ---------------------------------------------------------------------------

def _gltf_info(path):
    from pygltflib import GLTF2
    gltf = GLTF2.load(path)
    result = {
        "format": "GLTF" if _ext(path) == ".gltf" else "GLB",
        "file_size": _filesize(path),
        "scene_count": len(gltf.scenes) if gltf.scenes else 0,
        "node_count": len(gltf.nodes) if gltf.nodes else 0,
        "mesh_count": len(gltf.meshes) if gltf.meshes else 0,
        "material_count": len(gltf.materials) if gltf.materials else 0,
        "animation_count": len(gltf.animations) if gltf.animations else 0,
        "texture_count": len(gltf.textures) if gltf.textures else 0,
        "buffer_count": len(gltf.buffers) if gltf.buffers else 0,
    }
    if gltf.asset:
        result["generator"] = gltf.asset.generator
        result["version"] = gltf.asset.version
    return result


def _gltf_read(path, fmt):
    from pygltflib import GLTF2
    gltf = GLTF2.load(path)

    def node_tree(idx, depth=0):
        node = gltf.nodes[idx]
        entry = {"name": node.name, "mesh": node.mesh}
        if node.children:
            entry["children"] = [node_tree(c, depth + 1) for c in node.children]
        return entry

    scenes = []
    if gltf.scenes:
        for scene in gltf.scenes:
            s = {"name": scene.name, "nodes": []}
            if scene.nodes:
                s["nodes"] = [node_tree(n) for n in scene.nodes]
            scenes.append(s)

    meshes = []
    if gltf.meshes:
        for mesh in gltf.meshes:
            meshes.append({
                "name": mesh.name,
                "primitives": len(mesh.primitives) if mesh.primitives else 0,
            })

    materials = []
    if gltf.materials:
        for mat in gltf.materials:
            materials.append({"name": mat.name})

    result = {"format": _detect_format(path), "scenes": scenes, "meshes": meshes, "materials": materials}
    if fmt == "json":
        _json_out(result)
    else:
        print(f"Scenes: {len(scenes)}")
        for s in scenes:
            print(f"  {s['name']}: {len(s['nodes'])} root nodes")
        print(f"Meshes: {len(meshes)}")
        for m in meshes:
            print(f"  {m['name']}: {m['primitives']} primitives")
        print(f"Materials: {len(materials)}")
        for m in materials:
            print(f"  {m['name']}")


def _gltf_validate(path):
    try:
        from pygltflib import GLTF2
        gltf = GLTF2.load(path)
        issues = []
        if not gltf.scenes:
            issues.append("No scenes defined")
        if not gltf.nodes:
            issues.append("No nodes defined")
        if gltf.asset and gltf.asset.version != "2.0":
            issues.append(f"Unexpected glTF version: {gltf.asset.version}")
        return {"valid": len(issues) == 0, "issues": issues}
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# SVG handlers (xml.etree)
# ---------------------------------------------------------------------------

SVG_NS = "http://www.w3.org/2000/svg"


def _svg_info(path):
    tree = ET.parse(path)
    root = tree.getroot()
    # Strip namespace for attribute access
    ns = f"{{{SVG_NS}}}"
    result = {
        "format": "SVG",
        "file_size": _filesize(path),
        "width": root.get("width"),
        "height": root.get("height"),
        "viewBox": root.get("viewBox"),
    }
    # Count elements
    counts = {}
    for elem in root.iter():
        tag = elem.tag.replace(ns, "")
        counts[tag] = counts.get(tag, 0) + 1
    result["element_counts"] = counts
    result["total_elements"] = sum(counts.values())
    # Groups/layers (g elements with inkscape:label or id)
    groups = []
    for g in root.iter(f"{ns}g"):
        label = g.get("{http://www.inkscape.org/namespaces/inkscape}label") or g.get("id")
        if label:
            groups.append(label)
    if groups:
        result["groups"] = groups
    return result


def _svg_read(path, fmt):
    info = _svg_info(path)
    if fmt == "json":
        _json_out(info)
    else:
        print(f"SVG: {info.get('width')}x{info.get('height')} viewBox={info.get('viewBox')}")
        print(f"Total elements: {info['total_elements']}")
        for tag, count in sorted(info["element_counts"].items(), key=lambda x: -x[1])[:15]:
            print(f"  {tag}: {count}")
        if info.get("groups"):
            print(f"Groups/layers: {info['groups']}")


def _svg_validate(path):
    try:
        tree = ET.parse(path)
        root = tree.getroot()
        issues = []
        if SVG_NS not in root.tag and "svg" not in root.tag.lower():
            issues.append("Root element is not <svg>")
        if not root.get("viewBox") and not (root.get("width") and root.get("height")):
            issues.append("No viewBox or width/height defined")
        return {"valid": len(issues) == 0, "issues": issues}
    except ET.ParseError as exc:
        return {"valid": False, "error": f"XML parse error: {exc}"}


# ---------------------------------------------------------------------------
# PDF handlers (pdfplumber + pymupdf)
# ---------------------------------------------------------------------------

def _pdf_info(path):
    import pdfplumber
    with pdfplumber.open(path) as pdf:
        result = {
            "format": "PDF",
            "file_size": _filesize(path),
            "page_count": len(pdf.pages),
            "metadata": pdf.metadata,
            "pages": [],
        }
        for i, page in enumerate(pdf.pages[:10]):  # Limit to first 10 for info
            result["pages"].append({
                "number": i + 1,
                "width": float(page.width),
                "height": float(page.height),
                "has_text": len(page.extract_text() or "") > 0,
                "table_count": len(page.find_tables()),
            })
    return result


def _pdf_read(path, fmt, pages=None):
    import pdfplumber
    result = {"format": "PDF", "pages": []}
    with pdfplumber.open(path) as pdf:
        page_range = range(len(pdf.pages))
        if pages:
            # Parse page spec like "1-3,5"
            indices = set()
            for part in pages.split(","):
                if "-" in part:
                    a, b = part.split("-", 1)
                    indices.update(range(int(a) - 1, int(b)))
                else:
                    indices.add(int(part) - 1)
            page_range = sorted(indices)

        for i in page_range:
            if i >= len(pdf.pages):
                continue
            page = pdf.pages[i]
            page_data = {"number": i + 1, "text": page.extract_text() or ""}
            tables = page.extract_tables()
            if tables:
                page_data["tables"] = tables
            result["pages"].append(page_data)

    if fmt == "json":
        _json_out(result)
    else:
        for page in result["pages"]:
            print(f"=== Page {page['number']} ===")
            if page["text"]:
                print(page["text"])
            if page.get("tables"):
                for ti, table in enumerate(page["tables"]):
                    print(f"\n--- Table {ti + 1} ---")
                    for row in table:
                        print("\t".join(str(c) if c else "" for c in row))
            print()


def _pdf_validate(path):
    try:
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            issues = []
            if len(pdf.pages) == 0:
                issues.append("PDF has no pages")
            return {"valid": len(issues) == 0, "page_count": len(pdf.pages), "issues": issues}
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# DWG handler (ODA File Converter gateway)
# ---------------------------------------------------------------------------

def _find_oda():
    """Find ODA File Converter in PATH or common locations."""
    for name in ("ODAFileConverter", "odafileconverter"):
        if shutil.which(name):
            return shutil.which(name)
    common = [
        "/usr/bin/ODAFileConverter",
        "/opt/ODAFileConverter/ODAFileConverter",
        "/usr/local/bin/ODAFileConverter",
    ]
    for p in common:
        if os.path.isfile(p):
            return p
    return None


def _dwg_to_dxf(dwg_path, output_path=None):
    """Convert DWG to DXF using ODA File Converter."""
    oda = _find_oda()
    if not oda:
        print("ERROR: ODA File Converter not found.", file=sys.stderr)
        print("Install from: https://www.opendesign.com/guestfiles/oda_file_converter", file=sys.stderr)
        print("Then ensure 'ODAFileConverter' is in your PATH.", file=sys.stderr)
        sys.exit(1)

    import tempfile
    src_dir = str(Path(dwg_path).parent)
    src_name = Path(dwg_path).name
    with tempfile.TemporaryDirectory() as tmp:
        # ODAFileConverter <input_dir> <output_dir> <output_version> <output_type> ...
        # output_type: 0=DWG, 1=DXF, 2=DXB
        subprocess.run(
            [oda, src_dir, tmp, "ACAD2018", "DXF", "0", "1", src_name],
            check=True, capture_output=True,
        )
        dxf_name = Path(dwg_path).stem + ".dxf"
        tmp_dxf = os.path.join(tmp, dxf_name)
        if not os.path.exists(tmp_dxf):
            print(f"ERROR: Conversion failed — {dxf_name} not found in output.", file=sys.stderr)
            sys.exit(1)
        if output_path:
            shutil.copy2(tmp_dxf, output_path)
            return output_path
        else:
            # Return temp copy for reading
            final = os.path.join(src_dir, dxf_name)
            shutil.copy2(tmp_dxf, final)
            return final


def _dwg_info(path):
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        dxf_path = os.path.join(tmp, Path(path).stem + ".dxf")
        _dwg_to_dxf(path, dxf_path)
        result = _dxf_info(dxf_path)
        result["original_format"] = "DWG"
        result["file_size"] = _filesize(path)
        return result


def _dwg_read(path, fmt):
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        dxf_path = os.path.join(tmp, Path(path).stem + ".dxf")
        _dwg_to_dxf(path, dxf_path)
        _dxf_read(dxf_path, fmt)


def _dwg_validate(path):
    import tempfile
    try:
        with tempfile.TemporaryDirectory() as tmp:
            dxf_path = os.path.join(tmp, Path(path).stem + ".dxf")
            _dwg_to_dxf(path, dxf_path)
            result = _dxf_validate(dxf_path)
            result["note"] = "Validated via DWG→DXF conversion (ODA File Converter)"
            return result
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Convert subcommand
# ---------------------------------------------------------------------------

CONVERT_MAP = {
    ("DWG", "DXF"): lambda src, dst: _dwg_to_dxf(src, dst),
}


def _convert_step_to_stl(src, dst):
    """Convert STEP to STL using cadquery if available."""
    try:
        import cadquery as cq
        result = cq.importers.importStep(src)
        cq.exporters.export(result, dst, exportType="STL")
        return dst
    except ImportError:
        print("ERROR: cadquery not installed. Install with: pip install cadquery", file=sys.stderr)
        print("STEP→STL conversion requires cadquery (includes OpenCASCADE).", file=sys.stderr)
        sys.exit(1)


CONVERT_MAP[("STEP", "STL")] = _convert_step_to_stl


def cmd_convert(args):
    src_fmt = _detect_format(args.file)
    dst_fmt = _detect_format(args.output)

    if src_fmt == "UNKNOWN":
        print(f"ERROR: Cannot detect format of {args.file}", file=sys.stderr)
        sys.exit(1)
    if dst_fmt == "UNKNOWN":
        print(f"ERROR: Cannot detect format of {args.output}", file=sys.stderr)
        sys.exit(1)

    key = (src_fmt, dst_fmt)
    if key not in CONVERT_MAP:
        print(f"ERROR: Conversion {src_fmt}→{dst_fmt} not supported.", file=sys.stderr)
        supported = [f"{a}→{b}" for a, b in CONVERT_MAP]
        print(f"Supported: {', '.join(supported)}", file=sys.stderr)
        sys.exit(1)

    result = CONVERT_MAP[key](args.file, args.output)
    print(f"Converted {args.file} → {result}")


# ---------------------------------------------------------------------------
# Dispatch tables
# ---------------------------------------------------------------------------

INFO_HANDLERS = {
    "DXF": _dxf_info, "STEP": _step_info, "IGES": _iges_info,
    "STL": _stl_info, "GLTF": _gltf_info, "GLB": _gltf_info,
    "SVG": _svg_info, "PDF": _pdf_info, "DWG": _dwg_info,
}

READ_HANDLERS = {
    "DXF": _dxf_read, "STEP": _step_read, "IGES": _iges_read,
    "STL": _stl_read, "GLTF": _gltf_read, "GLB": _gltf_read,
    "SVG": _svg_read, "PDF": _pdf_read, "DWG": _dwg_read,
}

VALIDATE_HANDLERS = {
    "DXF": _dxf_validate, "STEP": _step_validate, "IGES": _iges_validate,
    "STL": _stl_validate, "GLTF": _gltf_validate, "GLB": _gltf_validate,
    "SVG": _svg_validate, "PDF": _pdf_validate, "DWG": _dwg_validate,
}


# ---------------------------------------------------------------------------
# Subcommand entry points
# ---------------------------------------------------------------------------

def cmd_info(args):
    fmt = _detect_format(args.file)
    if fmt == "UNKNOWN":
        print(f"ERROR: Unsupported format: {_ext(args.file)}", file=sys.stderr)
        sys.exit(1)
    handler = INFO_HANDLERS[fmt]
    result = handler(args.file)
    _json_out(result)


def cmd_read(args):
    fmt = _detect_format(args.file)
    if fmt == "UNKNOWN":
        print(f"ERROR: Unsupported format: {_ext(args.file)}", file=sys.stderr)
        sys.exit(1)
    handler = READ_HANDLERS[fmt]
    if fmt == "PDF":
        handler(args.file, args.format, getattr(args, "pages", None))
    else:
        handler(args.file, args.format)


def cmd_validate(args):
    fmt = _detect_format(args.file)
    if fmt == "UNKNOWN":
        print(f"ERROR: Unsupported format: {_ext(args.file)}", file=sys.stderr)
        sys.exit(1)
    handler = VALIDATE_HANDLERS[fmt]
    result = handler(args.file)
    _json_out(result)
    if not result.get("valid", False):
        sys.exit(1)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="JARVIS Mechanical File Tool — extract metadata from engineering files"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # info
    p = sub.add_parser("info", help="Quick file summary (format, entities, bounding box, metadata)")
    p.add_argument("file")

    # read
    p = sub.add_parser("read", help="Full structured extraction")
    p.add_argument("file")
    p.add_argument("--format", choices=["json", "table"], default="table")
    p.add_argument("--pages", help="Page range for PDFs (e.g. 1-3,5)")

    # convert
    p = sub.add_parser("convert", help="Format conversion")
    p.add_argument("file")
    p.add_argument("-o", "--output", required=True, help="Output file path")

    # validate
    p = sub.add_parser("validate", help="Check file integrity")
    p.add_argument("file")

    args = parser.parse_args()
    {
        "info": cmd_info,
        "read": cmd_read,
        "convert": cmd_convert,
        "validate": cmd_validate,
    }[args.command](args)


if __name__ == "__main__":
    main()
