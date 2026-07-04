#!/usr/bin/env python3
"""OKF CLI — catalog, lint, search, index for JARVIS knowledge bundles.

Python stdlib only. Bundles are discovered from the root catalog at
$ORCHESTRATOR_HOME/knowledge/index.md (default home: ~/JARVIS).
Spec: docs/superpowers/specs/2026-07-04-okf-adoption-design.md
"""
import argparse
import os
import re
import sys
from collections import namedtuple
from datetime import date
from fnmatch import fnmatch
from pathlib import Path

RESERVED = {"index.md", "log.md", "INDEX.md", "README.md", "CHANGELOG.md", "MEMORY.md"}
SKIP_DIRS = {".git", ".claude", "node_modules", "__pycache__", ".venv", "cache"}


def _unquote(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        return value[1:-1]
    return value


def _coerce(value):
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [_unquote(v.strip()) for v in inner.split(",")]
    return _unquote(value)


def parse_frontmatter(text):
    """Parse a minimal YAML-subset frontmatter block.

    Returns (meta_dict, body) or (None, text) when absent/malformed.
    Supports flat scalars, inline lists, block lists, and ONE level of
    nested mapping (e.g. the memory files' `metadata:` block).
    """
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, text
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return None, text

    meta = {}
    last_key = None  # most recent top-level key (block-list / nesting target)
    for raw in lines[1:end]:
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indented = raw.startswith((" ", "\t"))
        if stripped.startswith("- "):
            if last_key is None:
                return None, text
            if not isinstance(meta.get(last_key), list):
                meta[last_key] = []
            meta[last_key].append(_coerce(stripped[2:]))
        elif ":" in stripped:
            key, _, val = stripped.partition(":")
            key, val = key.strip(), val.strip()
            if indented:
                if last_key is None:
                    return None, text
                if not isinstance(meta.get(last_key), dict):
                    meta[last_key] = {}
                meta[last_key][key] = _coerce(val)
            else:
                meta[key] = _coerce(val) if val else {}
                last_key = key
        else:
            return None, text
    body = "\n".join(lines[end + 1:])
    return meta, body


Bundle = namedtuple("Bundle", "name path remote entry scope description")


def orchestrator_home():
    return Path(os.environ.get("ORCHESTRATOR_HOME", str(Path.home() / "JARVIS")))


def default_catalog_path():
    return orchestrator_home() / "knowledge" / "index.md"


def load_catalog(catalog_path=None):
    catalog_path = Path(catalog_path or default_catalog_path())
    text = catalog_path.read_text(encoding="utf-8")
    bundles = []
    for line in text.split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) != 6 or cells[0] in ("Bundle", "") or set(cells[0]) <= {"-"}:
            continue
        name, path, remote, entry, scope, description = cells
        bundles.append(Bundle(
            name=name,
            path=Path(os.path.expanduser(path)).resolve(),
            remote=remote,
            entry=entry,
            scope=[g.strip() for g in scope.split(",") if g.strip()],
            description=description,
        ))
    return bundles


def iter_pages(bundle):
    """Yield (abs_path, rel_posix) for non-reserved .md files in lint scope.

    SKIP_DIRS is checked against BUNDLE-RELATIVE path parts (the memory
    bundle lives under ~/.claude/, which must not self-exclude).
    """
    for p in sorted(bundle.path.rglob("*.md")):
        rel_parts = p.relative_to(bundle.path).parts
        if any(part in SKIP_DIRS for part in rel_parts):
            continue
        if p.name in RESERVED:
            continue
        rel = "/".join(rel_parts)
        if any(fnmatch(rel, pat) for pat in bundle.scope):
            yield p, rel


def cmd_catalog(args):
    for b in load_catalog(args.catalog):
        print(f"{b.name:18s} {str(b.path):60s} {b.entry:14s} {b.description}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="okf", description=__doc__)
    parser.add_argument("--catalog", default=None, help="path to root catalog index.md")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog", help="list bundles from the root catalog")
    args = parser.parse_args(argv)
    if args.command == "catalog":
        return cmd_catalog(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
