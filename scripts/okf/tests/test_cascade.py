"""Tests for cascade.py — journal → bundles consolidation state tool."""
from pathlib import Path

import pytest

import cascade

CASCADE_STUB = """---
type: Reference
---

# Cascade

| Tópico | Alvos (páginas) | Última absorvida | Último run | Notas |
|--------|-----------------|------------------|------------|-------|
| sealer | pmo/03008/knowledge/index.md | 2026-07-01-sealer.md | 2026-07-02 | — |
| automacao | kb/concepts/integracao-plc.md | — | — | — |
| pessoal | — | — | — | nunca cascateia |
"""

ENTRY = """---
type: Session Log
title: {title}
tags: [{tags}]
timestamp: 2026-07-08
session: x
---

# corpo {title}
"""


@pytest.fixture
def root(tmp_path):
    j = tmp_path / "journal"
    j.mkdir()
    (j / "CASCADE.md").write_text(CASCADE_STUB, encoding="utf-8")
    (j / "BOOT.md").write_text("---\ntype: Procedure\n---\n# boot\n",
                               encoding="utf-8")
    (j / "index.md").write_text("---\ntype: Reference\n---\n# idx\n",
                                encoding="utf-8")
    for name, tags in [
        ("2026-06-30-sealer.md", 'sealer, "03008"'),          # pre-watermark
        ("2026-07-08-sealer.md", 'sealer, "03008", automacao'),
        ("2026-07-08-sealer-2.md", 'sealer, "03008"'),        # same-day suffix
        ("2026-07-09-iris.md", 'iris-scds, automacao'),
        ("2026-06-22-aeroporto.md", "pessoal, aeroporto"),
    ]:
        (j / name).write_text(ENTRY.format(title=name, tags=tags),
                              encoding="utf-8")
    return tmp_path


def test_unabsorbed_by_tag_and_watermark(root):
    rows = cascade.load_rows(root / "journal" / "CASCADE.md")
    entries = cascade.journal_entries(root / "journal")
    sealer = next(r for r in rows if r["topic"] == "sealer")
    got = cascade.unabsorbed(sealer, entries)
    assert got == ["2026-07-08-sealer.md", "2026-07-08-sealer-2.md"]


def test_never_run_row_matches_everything_tagged(root):
    rows = cascade.load_rows(root / "journal" / "CASCADE.md")
    entries = cascade.journal_entries(root / "journal")
    auto = next(r for r in rows if r["topic"] == "automacao")
    got = cascade.unabsorbed(auto, entries)
    assert got == ["2026-07-08-sealer.md", "2026-07-09-iris.md"]


def test_status_skips_targetless_and_quiet(root, capsys):
    assert cascade.main(["--root", str(root), "status"]) == 0
    out = capsys.readouterr().out
    assert "sealer: 2" in out
    assert "pessoal" in out and "pulado" in out
    cascade.main(["--root", str(root), "status", "--quiet"])
    quiet = capsys.readouterr().out
    assert "pessoal" not in quiet          # quiet: only topics with backlog+targets


def test_briefing_targets_then_entries_newest_last(root, capsys):
    assert cascade.main(["--root", str(root), "briefing", "sealer"]) == 0
    out = capsys.readouterr().out
    assert "pmo/03008/knowledge/index.md" in out
    a = out.index("corpo 2026-07-08-sealer.md")
    b = out.index("corpo 2026-07-08-sealer-2.md")
    assert a < b                            # oldest first, newest last
    assert "corpo 2026-06-30-sealer.md" not in out   # absorbed: excluded


def test_mark_advances_and_refuses_backwards(root):
    p = root / "journal" / "CASCADE.md"
    assert cascade.main(["--root", str(root), "mark", "sealer",
                         "2026-07-08-sealer-2.md", "--date", "2026-07-10"]) == 0
    text = p.read_text(encoding="utf-8")
    assert "| 2026-07-08-sealer-2.md | 2026-07-10 |" in text
    assert cascade.main(["--root", str(root), "mark", "sealer",
                         "2026-07-01-sealer.md", "--date", "2026-07-11"]) == 1
    assert "2026-07-08-sealer-2.md" in p.read_text(encoding="utf-8")


def test_unknown_topic_exits_1(root, capsys):
    assert cascade.main(["--root", str(root), "briefing", "nope"]) == 1
