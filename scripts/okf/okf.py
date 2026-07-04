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


LINK_RE = re.compile(r"\[[^\]]*\]\(([^)#\s]+\.md)\)")


def _resolve_link(target, file_path, bundle):
    if target.startswith(("http://", "https://")):
        return None  # cross-bundle / external: not resolved in v1
    if target.startswith("/"):
        return bundle.path / target.lstrip("/")
    return (file_path.parent / target).resolve()


def _check_links(text, file_path, rel, bundle, warnings):
    for target in LINK_RE.findall(text):
        resolved = _resolve_link(target, file_path, bundle)
        if resolved is not None and not resolved.exists():
            warnings.append(f"{bundle.name}:{rel}: dead link -> {target}")


def lint_bundle(bundle):
    total = conformant = 0
    problems, warnings = [], []
    pages_by_dir = {}
    for path, rel in iter_pages(bundle):
        total += 1
        text = path.read_text(encoding="utf-8")
        meta, _ = parse_frontmatter(text)
        if meta is None:
            problems.append(f"{bundle.name}:{rel}: no parseable frontmatter")
        elif not str(meta.get("type", "")).strip():
            problems.append(f"{bundle.name}:{rel}: missing/empty 'type'")
        else:
            conformant += 1
            _check_links(text, path, rel, bundle, warnings)
        pages_by_dir.setdefault(path.parent, []).append(path.name)

    for directory, names in pages_by_dir.items():
        index = directory / "index.md"
        if not index.exists():
            continue
        itext = index.read_text(encoding="utf-8")
        rel_index = index.relative_to(bundle.path).as_posix()
        for name in names:
            if f"({name})" not in itext and f"(./{name})" not in itext \
                    and not re.search(r"\([^)]*/" + re.escape(name) + r"\)", itext):
                warnings.append(f"{bundle.name}:{rel_index}: missing entry for {name}")
        _check_links(itext, index, rel_index, bundle, warnings)
    return {"total": total, "conformant": conformant,
            "problems": problems, "warnings": warnings}


def cmd_lint(args):
    bundles = load_catalog(args.catalog)
    if args.bundle:
        bundles = [b for b in bundles if b.name == args.bundle]
        if not bundles:
            print(f"unknown bundle: {args.bundle}", file=sys.stderr)
            return 2
    results = [(b, lint_bundle(b)) for b in bundles]
    grand_total = sum(r["total"] for _, r in results)
    grand_conf = sum(r["conformant"] for _, r in results)
    pct = (grand_conf * 100 // grand_total) if grand_total else 100
    if args.pct_only:
        print(pct)
    else:
        print(f"{'Bundle':18s} {'Pages':>6s} {'Conformant':>11s} {'%':>5s}")
        for b, r in results:
            bp = (r["conformant"] * 100 // r["total"]) if r["total"] else 100
            print(f"{b.name:18s} {r['total']:6d} {r['conformant']:11d} {bp:4d}%")
        print(f"{'TOTAL':18s} {grand_total:6d} {grand_conf:11d} {pct:4d}%")
        for _, r in results:
            for line in r["problems"] + r["warnings"]:
                print(f"  ! {line}")
    has_issues = any(r["problems"] or r["warnings"] for _, r in results)
    return 1 if (args.strict and has_issues) else 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="okf", description=__doc__)
    parser.add_argument("--catalog", default=None, help="path to root catalog index.md")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog", help="list bundles from the root catalog")
    p_lint = sub.add_parser("lint", help="conformance report (ratchet metric)")
    p_lint.add_argument("bundle", nargs="?", default=None)
    p_lint.add_argument("--pct-only", action="store_true")
    p_lint.add_argument("--strict", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "catalog":
        return cmd_catalog(args)
    if args.command == "lint":
        return cmd_lint(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
