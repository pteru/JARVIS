#!/usr/bin/env python3
"""One-shot migration: inject OKF frontmatter into knowledge-base pages.

Dry-run by default; pass --apply to write. Idempotent (skips files that
already start with a frontmatter fence). Stdlib only.
"""
import argparse
import re
import sys
from pathlib import Path

RESERVED = {"index.md", "log.md", "INDEX.md", "README.md", "CHANGELOG.md"}
TYPE_BY_DIR = {
    "produtos": "Deep-Dive",
    "plataforma": "Reference",
    "pmo": "Procedure",
    "operacoes": "Procedure",
    "decisoes": "Decision",
    "referencias": "Reference",
    "registro-qa": "Q&A",
}
PRODUCTS = {"diemaster", "spotfusion", "visionking"}
DATE_RE = re.compile(
    r"^>\s*\*{0,2}[UÚ]ltima atualiza[cç][aã]o:?\*{0,2}\s*(\d{4}-\d{2}-\d{2})",
    re.MULTILINE)


def _first_paragraph(text):
    in_fence = False
    for line in text.split("\n"):
        s = line.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if not s or s.startswith(("#", ">", "|", "-", "*", "!")):
            continue
        if len(s) > 160:
            s = s[:157].rsplit(" ", 1)[0] + "..."
        return s
    return ""


def build_frontmatter(rel_parts, text):
    if text.startswith("---"):
        return None
    top = rel_parts[0]
    m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    title = m.group(1).strip() if m else Path(rel_parts[-1]).stem
    dm = DATE_RE.search(text)
    timestamp = dm.group(1) if dm else "2026-04-03"
    if top == "produtos" and len(rel_parts) > 2 and rel_parts[1] in PRODUCTS:
        product = rel_parts[1]
    elif "sdk" in rel_parts:
        product = "sdk"
    else:
        product = "general"
    tags = [top] + ([product] if product != "general" else [])
    desc = _first_paragraph(text).replace('"', "'")
    lines = [
        "---",
        f"type: {TYPE_BY_DIR.get(top, 'Reference')}",
        f"title: {title}",
        f'description: "{desc}"',
        f"tags: [{', '.join(tags)}]",
        f"timestamp: {timestamp}",
        f"product: {product}",
        "language: pt-BR",
        "---",
        "",
    ]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(
        Path.home() / "JARVIS/workspaces/strokmatic/knowledge-base"))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    root = Path(args.root)
    changed = skipped = reserved = 0
    for path in sorted(root.rglob("*.md")):
        if ".git" in path.parts:
            continue
        if path.name in RESERVED:
            reserved += 1
            continue
        rel = path.relative_to(root)
        text = path.read_text(encoding="utf-8")
        fm = build_frontmatter(rel.parts, text)
        if fm is None:
            skipped += 1
            continue
        changed += 1
        print(f"{'WRITE' if args.apply else 'would write'}: {rel}")
        if args.apply:
            path.write_text(fm + text, encoding="utf-8")
    print(f"{'applied' if args.apply else 'dry-run'}: {changed} changed, "
          f"{skipped} already conformant, {reserved} reserved skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
