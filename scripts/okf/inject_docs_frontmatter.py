#!/usr/bin/env python3
"""One-shot migration: inject OKF frontmatter into engineering-docs pages.

Covers docs/superpowers/{specs,plans,audits}. Dry-run by default; pass
--apply to write. Idempotent: conformant files (frontmatter with type) are
skipped; files with frontmatter but no type get only a type line inserted.
Stdlib only.
"""
import argparse
import re
import sys
from pathlib import Path

RESERVED = {"index.md", "log.md", "INDEX.md", "README.md", "CHANGELOG.md"}
TYPE_BY_DIR = {
    "specs": "Design Spec",
    "plans": "Implementation Plan",
    "audits": "Audit",
}
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-")
PROJECT_RE = re.compile(r"(?:^|-)(\d{5})(?:-|$|\.)")


def _first_heading(text):
    for line in text.split("\n"):
        if line.startswith("# "):
            return line[2:].strip()
    return None


def _first_paragraph(text):
    in_fence = False
    para = []
    seen_heading = False
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if stripped.startswith("#"):
            seen_heading = True
            continue
        if not seen_heading:
            continue
        if stripped.startswith((">", "|", "-", "*", "**Data", "**Status")):
            continue
        if stripped:
            para.append(stripped)
        elif para:
            break
    desc = " ".join(para)
    desc = desc.replace('"', "'")
    if len(desc) > 200:
        desc = desc[:197].rstrip() + "..."
    return desc or None


def build_frontmatter(path, text):
    dtype = TYPE_BY_DIR.get(path.parent.name, "Reference")
    lines = ["---", "type: {0}".format(dtype)]
    title = _first_heading(text)
    if title:
        lines.append("title: {0}".format(title.replace('"', "'")))
    desc = _first_paragraph(text)
    if desc:
        lines.append("description: {0}".format(desc))
    m = DATE_RE.match(path.name)
    if m:
        lines.append("timestamp: {0}".format(m.group(1)))
        rest = path.name[len(m.group(0)):]
    else:
        rest = path.name
    pm = PROJECT_RE.search(rest)
    if pm:
        lines.append('project: "{0}"'.format(pm.group(1)))
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("root", help="docs/superpowers root")
    ap.add_argument("--apply", action="store_true", help="write changes")
    args = ap.parse_args(argv)
    root = Path(args.root)

    changed = skipped = 0
    for sub in sorted(TYPE_BY_DIR):
        for path in sorted((root / sub).glob("*.md")):
            if path.name in RESERVED:
                continue
            text = path.read_text(encoding="utf-8")
            if text.startswith("---\n"):
                fm_end = text.find("\n---", 4)
                if fm_end != -1 and re.search(
                        r"^type:\s*\S", text[4:fm_end], re.MULTILINE):
                    skipped += 1
                    continue
                dtype = TYPE_BY_DIR.get(path.parent.name, "Reference")
                new = "---\ntype: {0}\n{1}".format(dtype, text[4:])
                action = "type-only"
            else:
                new = build_frontmatter(path, text) + text
                action = "full"
            changed += 1
            print("{0} {1}: {2}".format(
                "WRITE" if args.apply else "DRY", action,
                path.relative_to(root)))
            if args.apply:
                path.write_text(new, encoding="utf-8")
    print("{0}: {1} changed, {2} already conformant".format(
        "applied" if args.apply else "dry-run", changed, skipped),
        file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
