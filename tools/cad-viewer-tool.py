#!/usr/bin/env python3
"""JARVIS CAD Viewer Tool — Load, visualize, and analyze 3D CAD files."""

import argparse
import json
import sys
from pathlib import Path

import numpy as np


# ---------------------------------------------------------------------------
# Color palettes (from weld_grouper/viz/viewer.py)
# ---------------------------------------------------------------------------

_BODY_COLORS = [
    (0.70, 0.85, 0.90),  # light steel blue
    (0.90, 0.80, 0.65),  # warm sand
    (0.75, 0.90, 0.75),  # sage green
    (0.90, 0.75, 0.80),  # dusty rose
    (0.80, 0.80, 0.95),  # lavender
    (0.95, 0.90, 0.70),  # pale gold
    (0.70, 0.90, 0.85),  # seafoam
    (0.90, 0.80, 0.90),  # mauve
    (0.85, 0.85, 0.75),  # khaki
    (0.80, 0.90, 0.95),  # ice blue
    (0.95, 0.85, 0.75),  # peach
    (0.75, 0.88, 0.82),  # mint
    (0.88, 0.78, 0.88),  # plum
    (0.85, 0.92, 0.80),  # pistachio
    (0.92, 0.82, 0.72),  # tan
    (0.78, 0.85, 0.92),  # powder blue
]


# ---------------------------------------------------------------------------
# Format detection
# ---------------------------------------------------------------------------

_FORMAT_MAP = {
    ".stl": "STL",
    ".stp": "STEP",
    ".step": "STEP",
    ".obj": "OBJ",
    ".ply": "PLY",
    ".gltf": "GLTF",
    ".glb": "GLB",
    ".off": "OFF",
}

_TRIMESH_FORMATS = {"STL", "OBJ", "PLY", "GLTF", "GLB", "OFF"}


def _detect_format(path: Path) -> str:
    ext = path.suffix.lower()
    fmt = _FORMAT_MAP.get(ext)
    if fmt is None:
        raise ValueError(
            f"Unsupported format '{ext}'. "
            f"Supported: {', '.join(sorted(_FORMAT_MAP.keys()))}"
        )
    return fmt


# ---------------------------------------------------------------------------
# STEP loader (via cadquery / OCCT)
# ---------------------------------------------------------------------------

def _tessellate_ocp_shape(shape, tolerance: float, angular_tolerance: float):
    """Tessellate an OCP TopoDS_Shape and return (vertices, faces) numpy arrays."""
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
    from OCP.TopoDS import TopoDS
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location

    BRepMesh_IncrementalMesh(shape, tolerance, False, angular_tolerance, True)

    vertices = []
    faces = []
    vert_offset = 0

    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = TopoDS.Face_s(explorer.Current())
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)

        if triangulation is not None:
            trsf = location.Transformation()
            is_identity = location.IsIdentity()

            for i in range(1, triangulation.NbNodes() + 1):
                pnt = triangulation.Node(i)
                if not is_identity:
                    pnt = pnt.Transformed(trsf)
                vertices.append([pnt.X(), pnt.Y(), pnt.Z()])

            for i in range(1, triangulation.NbTriangles() + 1):
                tri = triangulation.Triangle(i)
                n1, n2, n3 = tri.Get()
                idx = [
                    n1 - 1 + vert_offset,
                    n2 - 1 + vert_offset,
                    n3 - 1 + vert_offset,
                ]
                if face.Orientation() == TopAbs_REVERSED:
                    idx[0], idx[1] = idx[1], idx[0]
                faces.append(idx)

            vert_offset += triangulation.NbNodes()

        explorer.Next()

    if not vertices or not faces:
        return np.empty((0, 3), dtype=np.float64), np.empty((0, 3), dtype=np.int64)

    return np.array(vertices, dtype=np.float64), np.array(faces, dtype=np.int64)


def _load_step_bodies_xde(
    path: Path,
    tolerance: float,
    angular_tolerance: float,
) -> "list | None":
    """Load STEP via OCP XDE, preserving part names from the STEP file.

    Returns a list of named trimesh bodies, or None if XDE loading fails.
    """
    try:
        from OCP.STEPCAFControl import STEPCAFControl_Reader
        from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool
        from OCP.TDocStd import TDocStd_Document
        from OCP.TCollection import TCollection_ExtendedString
        from OCP.TDF import TDF_LabelSequence, TDF_Label
        from OCP.TDataStd import TDataStd_Name
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopAbs import TopAbs_SOLID
    except ImportError:
        return None

    import trimesh

    try:
        doc = TDocStd_Document(TCollection_ExtendedString("XDE"))
        reader = STEPCAFControl_Reader()
        reader.SetNameMode(True)
        reader.SetColorMode(True)

        status = reader.ReadFile(str(path))
        if not str(status).endswith("RetDone"):
            return None

        if not reader.Transfer(doc):
            return None

        shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())

        def get_name(label) -> str:
            name_attr = TDataStd_Name()
            if label.FindAttribute(TDataStd_Name.GetID_s(), name_attr):
                return name_attr.Get().ToExtString()
            return ""

        # Collect (name, TopoDS_Shape) pairs for all leaf parts
        named_shapes: list[tuple[str, object]] = []

        def collect_component(label, parent_loc=None):
            """Process a component label (an instance in an assembly).

            parent_loc: accumulated TopLoc_Location from ancestor
                        components (for nested sub-assemblies).
            """
            comp_name = get_name(label)
            ref_label = TDF_Label()
            if XCAFDoc_ShapeTool.GetReferredShape_s(label, ref_label):
                ref_name = get_name(ref_label)
                effective_name = comp_name or ref_name

                if XCAFDoc_ShapeTool.IsAssembly_s(ref_label):
                    # Get this component's placed shape to extract its location
                    comp_shape = XCAFDoc_ShapeTool.GetShape_s(label)
                    comp_loc = comp_shape.Location()

                    # Compose with accumulated parent location
                    if parent_loc is not None and not parent_loc.IsIdentity():
                        accumulated = parent_loc.Multiplied(comp_loc)
                    else:
                        accumulated = comp_loc

                    # Recurse into sub-assembly's components
                    sub_comps = TDF_LabelSequence()
                    XCAFDoc_ShapeTool.GetComponents_s(ref_label, sub_comps)
                    for i in range(sub_comps.Length()):
                        collect_component(sub_comps.Value(i + 1), accumulated)
                else:
                    # Leaf part — get the COMPONENT's placed shape
                    shape = XCAFDoc_ShapeTool.GetShape_s(label)
                    if shape and not shape.IsNull():
                        # Apply accumulated parent location for nested assemblies
                        if parent_loc is not None and not parent_loc.IsIdentity():
                            shape = shape.Moved(parent_loc)
                        named_shapes.append((effective_name, shape))

        def collect_free_shape(label):
            """Process a top-level free shape."""
            name = get_name(label) or path.stem

            if XCAFDoc_ShapeTool.IsAssembly_s(label):
                comp_labels = TDF_LabelSequence()
                XCAFDoc_ShapeTool.GetComponents_s(label, comp_labels)
                for i in range(comp_labels.Length()):
                    collect_component(comp_labels.Value(i + 1))
            else:
                shape = XCAFDoc_ShapeTool.GetShape_s(label)
                if shape and not shape.IsNull():
                    named_shapes.append((name, shape))

        free_labels = TDF_LabelSequence()
        shape_tool.GetFreeShapes(free_labels)

        for i in range(free_labels.Length()):
            collect_free_shape(free_labels.Value(i + 1))

        if not named_shapes:
            return None

        # Tessellate each named shape into trimesh bodies
        bodies = []
        for part_name, shape in named_shapes:
            # A single part shape may contain multiple solids
            solids = []
            explorer = TopExp_Explorer(shape, TopAbs_SOLID)
            while explorer.More():
                solids.append(explorer.Current())
                explorer.Next()

            if not solids:
                # No solids — try tessellating the shape directly
                verts, faces = _tessellate_ocp_shape(
                    shape, tolerance, angular_tolerance
                )
                if len(verts) > 0 and len(faces) > 0:
                    mesh = trimesh.Trimesh(vertices=verts, faces=faces)
                    mesh.metadata["body_name"] = part_name
                    bodies.append(mesh)
            elif len(solids) == 1:
                verts, faces = _tessellate_ocp_shape(
                    solids[0], tolerance, angular_tolerance
                )
                if len(verts) > 0 and len(faces) > 0:
                    mesh = trimesh.Trimesh(vertices=verts, faces=faces)
                    mesh.metadata["body_name"] = part_name
                    bodies.append(mesh)
            else:
                for j, solid in enumerate(solids):
                    verts, faces = _tessellate_ocp_shape(
                        solid, tolerance, angular_tolerance
                    )
                    if len(verts) > 0 and len(faces) > 0:
                        mesh = trimesh.Trimesh(vertices=verts, faces=faces)
                        mesh.metadata["body_name"] = f"{part_name} [{j + 1}]"
                        bodies.append(mesh)

        return bodies if bodies else None

    except Exception:
        return None


def _load_step_bodies(
    path: Path,
    tolerance: float = 0.01,
    angular_tolerance: float = 0.1,
) -> list:
    """Load a STEP file and return one trimesh.Trimesh per solid body.

    Tries OCP XDE first to preserve part names from the STEP file.
    Falls back to cadquery if XDE is not available.
    """
    xde_bodies = _load_step_bodies_xde(path, tolerance, angular_tolerance)
    if xde_bodies:
        return xde_bodies

    # Fallback: cadquery (no part names preserved)
    try:
        import cadquery as cq
    except ImportError:
        raise ImportError(
            "cadquery is required for STEP file support. "
            "Install: pip install cadquery"
        ) from None

    import trimesh

    shape = cq.importers.importStep(str(path))
    bodies = []

    for solid in shape.solids().vals():
        tess = solid.tessellate(
            tolerance=tolerance,
            angularTolerance=angular_tolerance,
        )
        verts, tris = tess
        verts_arr = np.array([[v.x, v.y, v.z] for v in verts], dtype=np.float64)
        faces_arr = np.array(tris, dtype=np.int64)
        if len(verts_arr) > 0 and len(faces_arr) > 0:
            bodies.append(trimesh.Trimesh(vertices=verts_arr, faces=faces_arr))

    return bodies


# ---------------------------------------------------------------------------
# Trimesh loader (STL, OBJ, PLY, GLTF, OFF)
# ---------------------------------------------------------------------------

def _load_trimesh_file(path: Path) -> list:
    """Load a mesh file via trimesh and return a list of bodies."""
    import trimesh

    mesh = trimesh.load(str(path))

    if isinstance(mesh, trimesh.Scene):
        bodies = []
        for name, geom in mesh.geometry.items():
            if isinstance(geom, trimesh.Trimesh):
                geom.metadata["body_name"] = name
                bodies.append(geom)
        if not bodies:
            bodies = [mesh.dump(concatenate=True)]
        return bodies

    if isinstance(mesh, trimesh.Trimesh):
        return [mesh]

    # Fallback: try concatenating
    return [mesh]


# ---------------------------------------------------------------------------
# Unified loader
# ---------------------------------------------------------------------------

def _load_file(
    path: Path,
    tolerance: float = 0.01,
    angular_tolerance: float = 0.1,
) -> list:
    """Load a 3D file and return a list of trimesh bodies."""
    fmt = _detect_format(path)

    if fmt == "STEP":
        bodies = _load_step_bodies(path, tolerance, angular_tolerance)
        if not bodies:
            raise ValueError(f"No solids found in STEP file: {path}")
        return bodies

    if fmt in _TRIMESH_FORMATS:
        bodies = _load_trimesh_file(path)
        if not bodies:
            raise ValueError(f"No geometry found in file: {path}")
        return bodies

    raise ValueError(f"No loader for format: {fmt}")


# ---------------------------------------------------------------------------
# STEP assembly tree (via OCP XDE)
# ---------------------------------------------------------------------------

def _extract_step_tree(path: Path) -> dict:
    """Extract assembly/part hierarchy from a STEP file using OCCT XDE.

    Returns a nested dict tree:
      {"name": "...", "type": "assembly"|"part"|"shape", "children": [...]}

    Falls back to a flat body list if OCP is not available.
    """
    try:
        from OCP.STEPCAFControl import STEPCAFControl_Reader
        from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool
        from OCP.TDocStd import TDocStd_Document
        from OCP.TCollection import TCollection_ExtendedString
        from OCP.TDF import TDF_LabelSequence, TDF_Label
        from OCP.TDataStd import TDataStd_Name
    except ImportError:
        return _extract_step_tree_fallback(path)

    try:
        doc = TDocStd_Document(TCollection_ExtendedString("XDE"))
        reader = STEPCAFControl_Reader()
        reader.SetNameMode(True)
        reader.SetColorMode(True)

        status = reader.ReadFile(str(path))
        # OCP returns an enum, not int — check by name
        if not str(status).endswith("RetDone"):
            return _extract_step_tree_fallback(path)

        if not reader.Transfer(doc):
            return _extract_step_tree_fallback(path)

        shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
        visited: set[int] = set()

        def _get_label_name(label: TDF_Label) -> str:
            name_attr = TDataStd_Name()
            if label.FindAttribute(TDataStd_Name.GetID_s(), name_attr):
                return name_attr.Get().ToExtString()
            return ""

        def _walk_label(label: TDF_Label, depth: int = 0) -> dict:
            tag = label.Tag()
            if tag in visited:
                return {"name": f"(ref: tag={tag})", "type": "ref"}
            visited.add(tag)

            name = _get_label_name(label) or f"Shape_{tag}"
            is_assembly = XCAFDoc_ShapeTool.IsAssembly_s(label)
            is_simple = XCAFDoc_ShapeTool.IsSimpleShape_s(label)
            children = []

            if is_assembly:
                comp_labels = TDF_LabelSequence()
                XCAFDoc_ShapeTool.GetComponents_s(label, comp_labels)
                for i in range(comp_labels.Length()):
                    child = comp_labels.Value(i + 1)
                    child_name = _get_label_name(child)
                    ref_label = TDF_Label()
                    if XCAFDoc_ShapeTool.GetReferredShape_s(child, ref_label):
                        node = _walk_label(ref_label, depth + 1)
                        if child_name:
                            node["instance_name"] = child_name
                        children.append(node)
                    else:
                        children.append(_walk_label(child, depth + 1))

            node_type = "assembly" if is_assembly else "part"
            if not is_assembly and not is_simple:
                node_type = "shape"

            node = {"name": name, "type": node_type}
            if children:
                node["children"] = children
            return node

        free_labels = TDF_LabelSequence()
        shape_tool.GetFreeShapes(free_labels)

        if free_labels.Length() == 1:
            return _walk_label(free_labels.Value(1))
        elif free_labels.Length() > 1:
            children = []
            for i in range(free_labels.Length()):
                children.append(_walk_label(free_labels.Value(i + 1)))
            return {"name": path.stem, "type": "assembly", "children": children}
        else:
            return _extract_step_tree_fallback(path)

    except Exception:
        return _extract_step_tree_fallback(path)


def _extract_step_tree_fallback(path: Path) -> dict:
    """Fallback: list solid bodies without XDE hierarchy."""
    try:
        import cadquery as cq
    except ImportError:
        return {"name": path.stem, "type": "unknown", "error": "cadquery not installed"}

    shape = cq.importers.importStep(str(path))
    solids = shape.solids().vals()
    children = []
    for i, solid in enumerate(solids):
        bb = solid.BoundingBox()
        children.append({
            "name": f"Solid_{i + 1}",
            "type": "part",
            "bounds": {
                "min": [round(bb.xmin, 2), round(bb.ymin, 2), round(bb.zmin, 2)],
                "max": [round(bb.xmax, 2), round(bb.ymax, 2), round(bb.zmax, 2)],
            },
        })
    return {
        "name": path.stem,
        "type": "assembly" if len(children) > 1 else "part",
        "children": children,
        "note": "Flat body list (XDE not available for full hierarchy)",
    }


# ---------------------------------------------------------------------------
# Mesh analysis
# ---------------------------------------------------------------------------

def _analyze_body(body) -> dict:
    """Return analysis dict for a single trimesh body."""
    bounds = body.bounds  # (2, 3) array
    result = {
        "num_vertices": int(len(body.vertices)),
        "bounds": {
            "min": [round(float(bounds[0][i]), 6) for i in range(3)],
            "max": [round(float(bounds[1][i]), 6) for i in range(3)],
        },
        "extents": [round(float(e), 6) for e in body.extents],
        "centroid": [round(float(c), 6) for c in body.centroid],
        "is_watertight": bool(body.is_watertight),
    }
    if body.is_watertight:
        result["volume_mm3"] = round(float(body.volume), 6)
    result["surface_area_mm2"] = round(float(body.area), 6)

    name = body.metadata.get("body_name")
    if name:
        result["name"] = name

    return result


def _analyze_file(
    path: Path,
    tolerance: float = 0.01,
    angular_tolerance: float = 0.1,
) -> dict:
    """Analyze a 3D file and return a summary dict."""
    import trimesh

    fmt = _detect_format(path)
    bodies = _load_file(path, tolerance, angular_tolerance)

    total_verts = sum(len(b.vertices) for b in bodies)

    # Combined bounding box
    all_verts = np.vstack([b.vertices for b in bodies])
    overall_min = all_verts.min(axis=0)
    overall_max = all_verts.max(axis=0)
    extents = overall_max - overall_min

    # Combined watertight check
    if len(bodies) == 1:
        combined = bodies[0]
    else:
        combined = trimesh.util.concatenate(bodies)

    result = {
        "file": str(path),
        "format": fmt,
        "file_size_bytes": path.stat().st_size,
        "num_bodies": len(bodies),
        "total_vertices": int(total_verts),
        "bounds": {
            "min": [round(float(overall_min[i]), 6) for i in range(3)],
            "max": [round(float(overall_max[i]), 6) for i in range(3)],
        },
        "extents_mm": [round(float(e), 6) for e in extents],
        "is_watertight": bool(combined.is_watertight),
    }

    if combined.is_watertight:
        result["volume_mm3"] = round(float(combined.volume), 6)
    result["surface_area_mm2"] = round(float(combined.area), 6)

    if len(bodies) > 1:
        result["bodies"] = [_analyze_body(b) for b in bodies]

    return result


# ---------------------------------------------------------------------------
# PyVista interactive viewer
# ---------------------------------------------------------------------------

def _view_interactive(
    path: Path,
    tolerance: float = 0.01,
    angular_tolerance: float = 0.1,
    dark: bool = True,
    opacity: float = 1.0,
    show_edges: bool = False,
) -> None:
    """Open an interactive PyVista 3D viewer for a CAD file."""
    import pyvista as pv

    print(f"Loading {path.name}...", flush=True)
    bodies = _load_file(path, tolerance, angular_tolerance)
    total_verts = sum(len(b.vertices) for b in bodies)
    print(f"Loaded {len(bodies)} body(ies), {total_verts:,} vertices", flush=True)

    # Theme
    if dark:
        pv.set_plot_theme("dark")
    else:
        pv.set_plot_theme("default")

    plotter = pv.Plotter(title=f"CAD Viewer — {path.name}")
    plotter.enable_depth_peeling(number_of_peels=10, occlusion_ratio=0.0)

    # Add bodies with per-body coloring
    body_actors = []
    for i, body in enumerate(bodies):
        color = _BODY_COLORS[i % len(_BODY_COLORS)]
        pv_mesh = pv.wrap(body)
        actor = plotter.add_mesh(
            pv_mesh,
            color=color,
            opacity=opacity,
            show_edges=show_edges,
            edge_color=(0.3, 0.3, 0.3) if dark else (0.7, 0.7, 0.7),
        )
        body_actors.append(actor)

    # Status text
    text_color = "white" if dark else "black"
    status_msg = f"{len(bodies)} bodies  |  {total_verts:,} vertices"
    plotter.add_text(
        status_msg,
        position="upper_left",
        font_size=9,
        color=text_color,
        name="status_text",
    )

    # Checkbox widgets
    widget_x = 5
    text_color = "white" if dark else "black"

    def _make_toggle(actors):
        def callback(flag):
            for a in actors:
                a.SetVisibility(flag)
        return callback

    # --- Fixed controls at the bottom ---
    fixed_y = 10
    fixed_size = 22
    fixed_gap = 28

    # Edge toggle
    _edges_on = [show_edges]

    def _toggle_edges(flag):
        _edges_on[0] = flag
        for actor in body_actors:
            prop = actor.GetProperty()
            prop.SetEdgeVisibility(flag)

    plotter.add_checkbox_button_widget(
        _toggle_edges,
        value=show_edges,
        position=(widget_x, fixed_y),
        size=fixed_size,
        color_on=(0.5, 0.9, 0.5),
        color_off=(0.3, 0.3, 0.3),
    )
    plotter.add_text(
        "Edges",
        position=(widget_x + fixed_size + 5, fixed_y + 3),
        font_size=8,
        color=text_color,
        name="lbl_edges",
    )
    fixed_y += fixed_gap

    # Body toggle (all bodies)
    plotter.add_checkbox_button_widget(
        _make_toggle(body_actors),
        value=True,
        position=(widget_x, fixed_y),
        size=fixed_size,
        color_on=(0.7, 0.7, 0.7),
        color_off=(0.3, 0.3, 0.3),
    )
    plotter.add_text(
        "All Bodies",
        position=(widget_x + fixed_size + 5, fixed_y + 3),
        font_size=8,
        color=text_color,
        name="lbl_bodies",
    )
    fixed_y += fixed_gap

    # --- Scrollable per-body panel ---
    if len(bodies) > 1:
        max_name_len = 45
        slot_size = 16
        slot_gap = 20
        font_sz = 6

        panel_start_y = fixed_y + 10
        panel_max_y = 850
        max_slots = min(len(bodies), (panel_max_y - panel_start_y) // slot_gap)
        needs_scroll = len(bodies) > max_slots

        scroll_offset = [0]
        slot_data = []  # list of (checkbox_widget, text_actor)

        def _make_slot_callback(slot_idx):
            """Callback that toggles the body at scroll_offset + slot_idx."""
            def callback(flag):
                body_idx = scroll_offset[0] + slot_idx
                if 0 <= body_idx < len(bodies):
                    body_actors[body_idx].SetVisibility(flag)
            return callback

        widget_y = panel_start_y
        for s in range(max_slots):
            body_idx = s
            name = bodies[body_idx].metadata.get("body_name", f"Body {body_idx + 1}")
            display = (name[:max_name_len] + "\u2026") if len(name) > max_name_len else name

            if needs_scroll:
                color_on = (0.7, 0.85, 0.9)
            else:
                color_on = _BODY_COLORS[s % len(_BODY_COLORS)]

            cw = plotter.add_checkbox_button_widget(
                _make_slot_callback(s),
                value=True,
                position=(widget_x, widget_y),
                size=slot_size,
                color_on=color_on,
                color_off=(0.3, 0.3, 0.3),
            )
            ta = plotter.add_text(
                display,
                position=(widget_x + slot_size + 4, widget_y + 1),
                font_size=font_sz,
                color=text_color,
                name=f"lbl_body_{s}",
            )
            slot_data.append((cw, ta))
            widget_y += slot_gap

        if needs_scroll:
            # Scroll position indicator
            first_vis = 1
            last_vis = min(max_slots, len(bodies))
            scroll_info = plotter.add_text(
                f"{first_vis}\u2013{last_vis} / {len(bodies)}",
                position=(widget_x, widget_y + 4),
                font_size=6,
                color=text_color,
                name="scroll_info",
            )

            def _on_scroll(value):
                new_off = int(round(value))
                if new_off == scroll_offset[0]:
                    return
                scroll_offset[0] = new_off
                for s, (cw, ta) in enumerate(slot_data):
                    bi = new_off + s
                    if bi < len(bodies):
                        nm = bodies[bi].metadata.get("body_name", f"Body {bi + 1}")
                        disp = (nm[:max_name_len] + "\u2026") if len(nm) > max_name_len else nm
                        ta.SetInput(disp)
                        ta.VisibilityOn()
                        vis = body_actors[bi].GetVisibility()
                        cw.GetRepresentation().SetState(1 if vis else 0)
                    else:
                        ta.SetInput("")
                        ta.VisibilityOff()
                f = new_off + 1
                l = min(new_off + max_slots, len(bodies))
                scroll_info.SetInput(f"{f}\u2013{l} / {len(bodies)}")
                plotter.render()

            plotter.add_slider_widget(
                _on_scroll,
                rng=[0, len(bodies) - max_slots],
                value=0,
                pointa=(0.22, 0.08),
                pointb=(0.22, 0.85),
                style="modern",
                title="",
            )

    plotter.add_axes()
    plotter.show()


# ---------------------------------------------------------------------------
# Text formatters
# ---------------------------------------------------------------------------

def _print_info_text(info: dict) -> None:
    """Print mesh analysis in human-readable format."""
    print(f"File:          {info['file']}")
    print(f"Format:        {info['format']}")
    print(f"File size:     {info['file_size_bytes']:,} bytes")
    print(f"Bodies:        {info['num_bodies']}")
    print(f"Vertices:      {info['total_vertices']:,}")
    bmin = info["bounds"]["min"]
    bmax = info["bounds"]["max"]
    print(f"Bounds min:    [{bmin[0]:.4f}, {bmin[1]:.4f}, {bmin[2]:.4f}] mm")
    print(f"Bounds max:    [{bmax[0]:.4f}, {bmax[1]:.4f}, {bmax[2]:.4f}] mm")
    ext = info["extents_mm"]
    print(f"Extents:       {ext[0]:.4f} x {ext[1]:.4f} x {ext[2]:.4f} mm")
    print(f"Watertight:    {'Yes' if info['is_watertight'] else 'No'}")
    if "volume_mm3" in info:
        print(f"Volume:        {info['volume_mm3']:,.4f} mm³")
    print(f"Surface area:  {info['surface_area_mm2']:,.4f} mm²")

    if "bodies" in info:
        print(f"\n--- Per-body breakdown ({len(info['bodies'])} bodies) ---")
        for i, body in enumerate(info["bodies"]):
            name = body.get("name", f"Body {i + 1}")
            print(f"\n  [{i + 1}] {name}")
            print(f"      Vertices:   {body['num_vertices']:,}")
            ext = body["extents"]
            print(f"      Extents:    {ext[0]:.4f} x {ext[1]:.4f} x {ext[2]:.4f} mm")
            print(f"      Watertight: {'Yes' if body['is_watertight'] else 'No'}")
            if "volume_mm3" in body:
                print(f"      Volume:     {body['volume_mm3']:,.4f} mm³")
            print(f"      Area:       {body['surface_area_mm2']:,.4f} mm²")


def _print_tree_text(node: dict, indent: int = 0) -> None:
    """Print assembly tree in human-readable indented format."""
    prefix = "  " * indent
    icon = {"assembly": "[A]", "part": "[P]", "shape": "[S]"}.get(node.get("type", ""), "[?]")
    name = node.get("instance_name", node.get("name", "?"))
    print(f"{prefix}{icon} {name}")

    if "bounds" in node:
        bmin = node["bounds"]["min"]
        bmax = node["bounds"]["max"]
        print(f"{prefix}    bounds: [{bmin[0]}, {bmin[1]}, {bmin[2]}] → [{bmax[0]}, {bmax[1]}, {bmax[2]}]")

    if "error" in node:
        print(f"{prefix}    error: {node['error']}")

    if "note" in node:
        print(f"{prefix}    note: {node['note']}")

    for child in node.get("children", []):
        _print_tree_text(child, indent + 1)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        prog="cad-viewer-tool",
        description="Load, visualize, and analyze 3D CAD files (STEP, STL, OBJ, PLY, GLTF, OFF).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # --- view ---
    p_view = sub.add_parser("view", help="Open interactive 3D PyVista viewer")
    p_view.add_argument("file", help="Path to a 3D file")
    p_view.add_argument("--tess-tolerance", type=float, default=0.01,
                        help="STEP tessellation linear tolerance in mm (default: 0.01)")
    p_view.add_argument("--tess-angular-tolerance", type=float, default=0.1,
                        help="STEP tessellation angular tolerance in rad (default: 0.1)")
    p_view.add_argument("--background", choices=["dark", "light"], default="dark",
                        help="Background theme (default: dark)")
    p_view.add_argument("--opacity", type=float, default=1.0,
                        help="Mesh opacity 0.0-1.0 (default: 1.0)")
    p_view.add_argument("--edges", action="store_true", default=False,
                        help="Show triangle mesh edges")

    # --- info ---
    p_info = sub.add_parser("info", help="Mesh analysis (vertices, faces, volume, bbox)")
    p_info.add_argument("file", help="Path to a 3D file")
    p_info.add_argument("--tess-tolerance", type=float, default=0.01,
                        help="STEP tessellation linear tolerance in mm (default: 0.01)")
    p_info.add_argument("--tess-angular-tolerance", type=float, default=0.1,
                        help="STEP tessellation angular tolerance in rad (default: 0.1)")
    p_info.add_argument("--format", choices=["text", "json"], default="text",
                        help="Output format (default: text)")

    # --- tree ---
    p_tree = sub.add_parser("tree", help="STEP assembly/part hierarchy")
    p_tree.add_argument("file", help="Path to a STEP file")
    p_tree.add_argument("--format", choices=["text", "json"], default="text",
                        help="Output format (default: text)")

    args = parser.parse_args()
    path = Path(args.file).resolve()

    if not path.exists():
        print(f"Error: file not found: {path}", file=sys.stderr)
        sys.exit(1)

    if args.command == "view":
        _view_interactive(
            path,
            tolerance=args.tess_tolerance,
            angular_tolerance=args.tess_angular_tolerance,
            dark=(args.background == "dark"),
            opacity=args.opacity,
            show_edges=args.edges,
        )

    elif args.command == "info":
        info = _analyze_file(
            path,
            tolerance=args.tess_tolerance,
            angular_tolerance=args.tess_angular_tolerance,
        )
        if args.format == "json":
            print(json.dumps(info, indent=2))
        else:
            _print_info_text(info)

    elif args.command == "tree":
        fmt = _detect_format(path)
        if fmt != "STEP":
            print(f"Error: 'tree' command only supports STEP files (got {fmt})", file=sys.stderr)
            sys.exit(1)
        tree = _extract_step_tree(path)
        if args.format == "json":
            print(json.dumps(tree, indent=2))
        else:
            _print_tree_text(tree)


if __name__ == "__main__":
    main()
