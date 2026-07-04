import subprocess
import sys
from pathlib import Path

from inject_kb_frontmatter import build_frontmatter

KB_PAGE = (
    "# Banco de Dados — Deep-Dive\n\n"
    "> Ultima atualizacao: 2026-04-03 | Fonte: workspaces/strokmatic/visionking\n\n"
    "## Contexto\n\n"
    "VisionKing usa PostgreSQL como banco relacional para persistencia.\n"
)


def test_build_frontmatter_extracts_fields():
    fm = build_frontmatter(("produtos", "visionking", "banco-de-dados.md"), KB_PAGE)
    assert fm.startswith("---\n") and fm.rstrip().endswith("---")
    assert "type: Deep-Dive" in fm
    assert "title: Banco de Dados — Deep-Dive" in fm
    assert "timestamp: 2026-04-03" in fm
    assert "product: visionking" in fm
    assert "language: pt-BR" in fm
    assert "tags: [produtos, visionking]" in fm
    assert 'description: "VisionKing usa PostgreSQL como banco relacional' in fm


def test_type_mapping_by_top_dir():
    for top, expected in [("decisoes", "Decision"), ("operacoes", "Procedure"),
                          ("pmo", "Procedure"), ("referencias", "Reference"),
                          ("registro-qa", "Q&A"), ("plataforma", "Reference")]:
        fm = build_frontmatter((top, "x.md"), "# X\n\ncorpo\n")
        assert f"type: {expected}" in fm, top


def test_skips_files_with_existing_frontmatter():
    assert build_frontmatter(("produtos", "x.md"), "---\ntype: A\n---\nbody\n") is None


def test_apply_is_idempotent(tmp_path):
    root = tmp_path / "kb"
    (root / "produtos" / "visionking").mkdir(parents=True)
    page = root / "produtos" / "visionking" / "banco-de-dados.md"
    page.write_text(KB_PAGE, encoding="utf-8")
    script = Path(__file__).parents[1] / "inject_kb_frontmatter.py"
    subprocess.run([sys.executable, str(script), "--root", str(root), "--apply"],
                   check=True, capture_output=True)
    first = page.read_text(encoding="utf-8")
    assert first.startswith("---\ntype: Deep-Dive\n")
    assert "# Banco de Dados — Deep-Dive" in first   # body intact
    subprocess.run([sys.executable, str(script), "--root", str(root), "--apply"],
                   check=True, capture_output=True)
    assert page.read_text(encoding="utf-8") == first  # unchanged on 2nd run


def test_dry_run_writes_nothing(tmp_path):
    root = tmp_path / "kb"
    (root / "decisoes").mkdir(parents=True)
    page = root / "decisoes" / "d.md"
    page.write_text("# D\n\ncorpo\n", encoding="utf-8")
    script = Path(__file__).parents[1] / "inject_kb_frontmatter.py"
    out = subprocess.run([sys.executable, str(script), "--root", str(root)],
                         check=True, capture_output=True, text=True).stdout
    assert "d.md" in out
    assert page.read_text(encoding="utf-8") == "# D\n\ncorpo\n"
