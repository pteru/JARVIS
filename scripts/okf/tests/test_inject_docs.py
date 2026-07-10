"""Tests for inject_docs_frontmatter.py — engineering-docs migration."""
from pathlib import Path

import inject_docs_frontmatter as idf


def _tree(tmp_path):
    for d in ("specs", "plans", "audits"):
        (tmp_path / d).mkdir()
    return tmp_path


def test_injects_type_title_description_by_dir(tmp_path):
    root = _tree(tmp_path)
    f = root / "specs" / "2026-03-01-widget-design.md"
    f.write_text("# Widget Design\n\nA spec about widgets.\n\nMore.\n",
                 encoding="utf-8")
    idf.main([str(root), "--apply"])
    text = f.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    assert "type: Design Spec" in text
    assert "title: Widget Design" in text
    assert "description: A spec about widgets." in text
    assert "timestamp: 2026-03-01" in text
    assert "# Widget Design" in text          # body preserved


def test_plan_type_project_code_and_fence_skipping(tmp_path):
    root = _tree(tmp_path)
    f = root / "plans" / "2026-04-05-03008-rollout.md"
    f.write_text("# Rollout\n\n```bash\nls\n```\n\nReal paragraph here.\n",
                 encoding="utf-8")
    idf.main([str(root), "--apply"])
    text = f.read_text(encoding="utf-8")
    assert "type: Implementation Plan" in text
    assert 'project: "03008"' in text
    assert "description: Real paragraph here." in text


def test_dry_run_writes_nothing_and_reserved_skipped(tmp_path):
    root = _tree(tmp_path)
    f = root / "specs" / "a.md"
    f.write_text("# A\n\nBody.\n", encoding="utf-8")
    idx = root / "specs" / "index.md"
    idx.write_text("# Index\n", encoding="utf-8")
    idf.main([str(root)])                      # no --apply
    assert f.read_text(encoding="utf-8") == "# A\n\nBody.\n"
    idf.main([str(root), "--apply"])
    assert idx.read_text(encoding="utf-8") == "# Index\n"


def test_conformant_file_untouched(tmp_path):
    root = _tree(tmp_path)
    f = root / "specs" / "done.md"
    original = "---\ntype: Design Spec\ntitle: Done\n---\n\n# Done\n"
    f.write_text(original, encoding="utf-8")
    idf.main([str(root), "--apply"])
    assert f.read_text(encoding="utf-8") == original


def test_frontmatter_missing_type_gets_type_inserted(tmp_path):
    root = _tree(tmp_path)
    f = root / "audits" / "x-audit.md"
    f.write_text("---\ntitle: X\n---\n\n# X\n", encoding="utf-8")
    idf.main([str(root), "--apply"])
    text = f.read_text(encoding="utf-8")
    assert text.startswith("---\ntype: Audit\ntitle: X\n---\n")
