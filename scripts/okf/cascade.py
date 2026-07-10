#!/usr/bin/env python3
"""Cascade state tool — journal → thematic-bundles consolidation support.

status: per-topic unabsorbed-entry backlog. briefing: assemble the gardener
input for one topic. mark: advance the topic watermark. Entries are matched
by frontmatter TAG and compared by FILENAME against the watermark; journal
entries are never modified. Stdlib only.
"""
import argparse
import sys
from pathlib import Path

from okf import parse_frontmatter

RESERVED = {"index.md", "BOOT.md", "CASCADE.md", "log.md"}
NEVER = ("—", "-", "")


def repo_root():
    return Path(__file__).resolve().parents[2]


def load_rows(path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 5 or cells[0] == "Tópico":
            continue
        if all(set(c) <= set("-: ") for c in cells if c):
            continue                     # separator row
        rows.append({"topic": cells[0], "targets": cells[1],
                     "watermark": cells[2], "lastrun": cells[3],
                     "notes": cells[4]})
    return rows


def journal_entries(journal_dir):
    """[(filename, [tags])] for Session Log pages, filename-sorted."""
    import re

    def _sort_key(path):
        # Sort by base filename first, then by suffix.
        # Ensures unsuffixed versions (e.g., "foo.md") come before suffixed
        # versions (e.g., "foo-2.md").
        name = path.name
        match = re.match(r'^(.*?)(-\d+)?\.md$', name)
        if match:
            base = match.group(1)
            suffix = match.group(2) or ''
            return (base, suffix)
        return (name, '')

    out = []
    for p in sorted(journal_dir.glob("*.md"), key=_sort_key):
        if p.name in RESERVED:
            continue
        meta, _ = parse_frontmatter(p.read_text(encoding="utf-8"))
        if not meta or meta.get("type") != "Session Log":
            continue
        tags = meta.get("tags") or []
        if not isinstance(tags, list):
            tags = [tags]
        out.append((p.name, [str(t) for t in tags]))
    return out


def unabsorbed(row, entries):
    wm = row["watermark"]
    return [name for name, tags in entries
            if row["topic"] in tags and (wm in NEVER or name > wm)]


def _find_row(rows, topic):
    for r in rows:
        if r["topic"] == topic:
            return r
    return None


def cmd_status(args, journal_dir):
    rows = load_rows(journal_dir / "CASCADE.md")
    entries = journal_entries(journal_dir)
    for row in rows:
        pending = unabsorbed(row, entries)
        if row["targets"] in NEVER:
            if not args.quiet:
                print("{0} (sem alvos — pulado): {1} unabsorbed".format(
                    row["topic"], len(pending)))
            continue
        if args.quiet and not pending:
            continue
        print("{0}: {1} unabsorbed{2}".format(
            row["topic"], len(pending),
            " — " + ", ".join(pending) if pending else ""))
    return 0


def cmd_briefing(args, journal_dir):
    rows = load_rows(journal_dir / "CASCADE.md")
    row = _find_row(rows, args.topic)
    if row is None:
        print("unknown topic: {0}".format(args.topic), file=sys.stderr)
        return 1
    entries = journal_entries(journal_dir)
    pending = unabsorbed(row, entries)   # filename-sorted: oldest → newest
    print("# Briefing de cascade — {0}\n".format(args.topic))
    print("Alvos: {0}\n".format(row["targets"]))
    for name in pending:
        print("---\n<!-- entrada: {0} -->\n".format(name))
        print((journal_dir / name).read_text(encoding="utf-8"))
    return 0


def cmd_mark(args, journal_dir):
    path = journal_dir / "CASCADE.md"
    rows = load_rows(path)
    row = _find_row(rows, args.topic)
    if row is None:
        print("unknown topic: {0}".format(args.topic), file=sys.stderr)
        return 1
    if row["watermark"] not in NEVER and args.entry <= row["watermark"]:
        print("refusing to move watermark backwards ({0} <= {1})".format(
            args.entry, row["watermark"]), file=sys.stderr)
        return 1
    old = "| {0} | {1} | {2} | {3} | {4} |".format(
        row["topic"], row["targets"], row["watermark"], row["lastrun"],
        row["notes"])
    new = "| {0} | {1} | {2} | {3} | {4} |".format(
        row["topic"], row["targets"], args.entry, args.date, row["notes"])
    text = path.read_text(encoding="utf-8")
    if old not in text:
        print("row not found verbatim; fix CASCADE.md formatting",
              file=sys.stderr)
        return 1
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("marked {0}: {1} ({2})".format(args.topic, args.entry, args.date))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_status = sub.add_parser("status")
    p_status.add_argument("--quiet", action="store_true")
    p_brief = sub.add_parser("briefing")
    p_brief.add_argument("topic")
    p_mark = sub.add_parser("mark")
    p_mark.add_argument("topic")
    p_mark.add_argument("entry")
    p_mark.add_argument("--date", required=True)
    args = ap.parse_args(argv)
    journal_dir = (Path(args.root) if args.root else repo_root()) / "journal"
    return {"status": cmd_status, "briefing": cmd_briefing,
            "mark": cmd_mark}[args.cmd](args, journal_dir)


if __name__ == "__main__":
    raise SystemExit(main())
