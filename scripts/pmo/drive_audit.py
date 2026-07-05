#!/usr/bin/env python3
"""PMO local↔Drive audit — classify project files and flag Drive candidates.

Read-only: it recommends, never acts. Python stdlib only.
Spec: docs/superpowers/specs/2026-07-04-pmo-drive-governance-design.md
"""
import argparse
import json
import sys
from pathlib import Path

SKIP_DIRS = {"emails", "cache", "knowledge", ".git", "__pycache__", "node_modules"}
CLASS_BY_EXT = {
    "document": {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".ppt",
                 ".pptx", ".odt", ".ods"},
    "cad": {".stl", ".step", ".stp", ".iges", ".igs", ".jt", ".dxf", ".dwg",
            ".gltf", ".glb", ".obj", ".ply", ".spv", ".sldprt", ".sldasm"},
    "archive": {".zip", ".tar", ".gz", ".tgz", ".7z", ".rar"},
    "media": {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff",
              ".mp4", ".avi", ".mov", ".webm"},
    "data": {".sql", ".db", ".sqlite", ".csv", ".parquet", ".npy", ".npz",
             ".pcd", ".bag", ".pkl", ".h5"},
    "text": {".md", ".txt", ".py", ".sh", ".mjs", ".js", ".json", ".yaml",
             ".yml", ".toml", ".ini", ".log"},
}
DEST_KEYWORDS = {
    "cad": ("cad", "desenho", "drawing", "3d"),
    "document": ("document", "doc", "contrat", "oferta", "proposta", "sor",
                 "relat", "report"),
    "media": ("foto", "imag", "video", "media"),
    "archive": ("backup", "arquivo", "historic"),
    "data": ("dado", "data", "dump", "backup"),
}
DEFAULT_ROOT = Path.home() / "JARVIS/workspaces/strokmatic/pmo/projects"


def classify(name):
    ext = Path(name).suffix.lower()
    for cls, exts in CLASS_BY_EXT.items():
        if ext in exts:
            return cls
    return "other"


def load_drive_entries(drive_index_path):
    """Return (filenames, folders): lowercase basenames of Drive files and
    folder paths (no trailing slash), across all sources."""
    data = json.loads(Path(drive_index_path).read_text(encoding="utf-8"))
    filenames, folders = set(), []
    for source in data.get("sources", []):
        for entry in source.get("entries", []):
            path = entry.get("path", "")
            if entry.get("type") == "folder":
                folders.append(path.rstrip("/"))
            else:
                filenames.add(Path(path).name.lower())
    return filenames, folders


def suggest_destination(cls, folders):
    for keyword in DEST_KEYWORDS.get(cls, ()):
        for folder in folders:
            if keyword in folder.lower():
                return folder
    return "?"


def scan_project(root, min_bytes, drive_filenames):
    rows = []
    root = Path(root)
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel_parts = p.relative_to(root).parts
        if any(part in SKIP_DIRS for part in rel_parts):
            continue
        size = p.stat().st_size
        on_drive = p.name.lower() in drive_filenames
        if size >= min_bytes or on_drive:
            rows.append({"path": "/".join(rel_parts), "size": size,
                         "class": classify(p.name), "on_drive": on_drive})
    rows.sort(key=lambda r: -r["size"])
    return rows


def _mb(size):
    return f"{size / (1024 * 1024):.1f} MB"


def render_markdown(rows, folders, code, min_mb):
    lines = [f"# Auditoria local↔Drive — {code}", "",
             f"Critério: ≥ {min_mb:g} MB ou nome já presente no Drive. "
             f"Somente recomendação — nada foi movido.", "",
             "| Caminho local | Tamanho | Classe | Já no Drive? | Destino sugerido |",
             "|---|---|---|---|---|"]
    total = 0
    for r in rows:
        total += r["size"]
        dest = suggest_destination(r["class"], folders)
        lines.append(f"| {r['path']} | {_mb(r['size'])} | {r['class']} | "
                     f"{'SIM' if r['on_drive'] else 'não'} | {dest} |")
    lines += ["", f"**{len(rows)} arquivos sinalizados, {_mb(total)} no total.**"]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("code", help="5-digit project code")
    parser.add_argument("--min-size", type=float, default=5.0,
                        help="flag threshold in MB (default 5)")
    parser.add_argument("--root", default=str(DEFAULT_ROOT),
                        help="projects root directory")
    args = parser.parse_args(argv)
    project_dir = Path(args.root) / args.code
    if not project_dir.is_dir():
        print(f"projeto não encontrado: {project_dir}", file=sys.stderr)
        return 2
    drive_index = project_dir / "drive-index.json"
    if drive_index.exists():
        filenames, folders = load_drive_entries(drive_index)
    else:
        filenames, folders = set(), []
        print(f"aviso: sem drive-index em {drive_index} — sem detecção de "
              f"duplicados nem sugestão de destino\n")
    rows = scan_project(project_dir, int(args.min_size * 1024 * 1024), filenames)
    print(render_markdown(rows, folders, args.code, args.min_size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
