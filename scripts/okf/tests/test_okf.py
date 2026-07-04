from okf import parse_frontmatter, RESERVED


def test_parse_basic_frontmatter():
    text = (
        "---\n"
        "type: Lesson Learned\n"
        'title: Câmeras 03002\n'
        'description: "Uma frase: com dois pontos."\n'
        'tags: [visionking, cameras, "03002"]\n'
        'project: "03002"\n'
        "---\n"
        "\n# Corpo\n"
    )
    meta, body = parse_frontmatter(text)
    assert meta["type"] == "Lesson Learned"
    assert meta["title"] == "Câmeras 03002"
    assert meta["description"] == "Uma frase: com dois pontos."
    assert meta["tags"] == ["visionking", "cameras", "03002"]
    assert meta["project"] == "03002"
    assert body.strip() == "# Corpo"


def test_parse_block_list_and_nested_mapping():
    text = (
        "---\n"
        "name: some-memory\n"
        "tags:\n"
        "  - alpha\n"
        "  - beta\n"
        "metadata:\n"
        "  type: user\n"
        "---\n"
        "body\n"
    )
    meta, _ = parse_frontmatter(text)
    assert meta["tags"] == ["alpha", "beta"]
    assert meta["metadata"] == {"type": "user"}
    assert meta.get("type") is None  # nested type is NOT top-level type


def test_no_frontmatter_returns_none():
    meta, body = parse_frontmatter("# Just a heading\n\ntext\n")
    assert meta is None
    assert body.startswith("# Just a heading")


def test_unterminated_frontmatter_returns_none():
    meta, _ = parse_frontmatter("---\ntype: X\nno closing fence\n")
    assert meta is None


def test_reserved_names():
    assert {"index.md", "log.md", "README.md", "CHANGELOG.md",
            "MEMORY.md", "INDEX.md"} <= RESERVED


CATALOG_MD = """---
type: Reference
title: Test Catalog
description: Catalog fixture.
okf_version: "0.1"
---

# Catalog

| Bundle | Local path | Remote | Entry point | Lint scope | Description |
|--------|-----------|--------|-------------|------------|-------------|
| alpha | {root}/alpha | https://github.com/x/alpha | index.md | ** | Alpha bundle |
| beta | {root}/beta | (local only) | MEMORY.md | index.md,projects/*/knowledge/** | Beta bundle |
"""


def make_catalog(tmp_path):
    (tmp_path / "alpha").mkdir(exist_ok=True)
    (tmp_path / "beta").mkdir(exist_ok=True)
    catalog = tmp_path / "knowledge" / "index.md"
    catalog.parent.mkdir()
    catalog.write_text(CATALOG_MD.format(root=tmp_path), encoding="utf-8")
    return catalog


def test_load_catalog(tmp_path):
    from okf import load_catalog
    bundles = load_catalog(make_catalog(tmp_path))
    assert [b.name for b in bundles] == ["alpha", "beta"]
    assert bundles[0].path == tmp_path / "alpha"
    assert bundles[0].scope == ["**"]
    assert bundles[1].scope == ["index.md", "projects/*/knowledge/**"]
    assert bundles[1].remote == "(local only)"
    assert bundles[1].entry == "MEMORY.md"


def test_cmd_catalog_prints_table(tmp_path, capsys):
    from okf import main
    main(["--catalog", str(make_catalog(tmp_path)), "catalog"])
    out = capsys.readouterr().out
    assert "alpha" in out and "beta" in out and "Alpha bundle" in out


def test_iter_pages_skip_dirs_relative_only(tmp_path):
    """A bundle whose ABSOLUTE path contains a skip-dir name (e.g. memory
    under ~/.claude/) must not self-exclude; skip-dirs apply only INSIDE."""
    from okf import Bundle, iter_pages
    root = tmp_path / ".claude" / "memory-bundle"
    (root / "cache").mkdir(parents=True)
    (root / "fact.md").write_text("---\ntype: Reference\n---\nx\n", encoding="utf-8")
    (root / "cache" / "skipped.md").write_text("---\ntype: R\n---\nx\n", encoding="utf-8")
    (root / "MEMORY.md").write_text("index\n", encoding="utf-8")
    b = Bundle(name="m", path=root, remote="(local only)", entry="MEMORY.md",
               scope=["**"], description="")
    rels = [rel for _, rel in iter_pages(b)]
    assert rels == ["fact.md"]  # cache/ skipped, MEMORY.md reserved, root not self-excluded


def test_iter_pages_reserved_and_scope(tmp_path):
    from okf import Bundle, iter_pages
    root = tmp_path / "pmo"
    (root / "projects" / "03002" / "knowledge").mkdir(parents=True)
    (root / "index.md").write_text("root index\n", encoding="utf-8")
    (root / "projects" / "03002" / "knowledge" / "index.md").write_text("i\n", encoding="utf-8")
    (root / "projects" / "03002" / "knowledge" / "contexto.md").write_text(
        "---\ntype: Project Context\n---\nx\n", encoding="utf-8")
    (root / "projects" / "03002" / "notas.md").write_text("raw\n", encoding="utf-8")
    b = Bundle(name="pmo", path=root, remote="r", entry="index.md",
               scope=["projects/*/knowledge/**"], description="")
    rels = [rel for _, rel in iter_pages(b)]
    assert rels == ["projects/03002/knowledge/contexto.md"]


def make_bundle(tmp_path):
    """alpha bundle: 1 conformant page, 1 missing type, 1 no frontmatter,
    an index.md that lists a dead link and omits good.md."""
    a = tmp_path / "alpha"
    a.mkdir()
    (a / "good.md").write_text(
        "---\ntype: Reference\ntitle: Good\n---\n\nSee [dead](/missing.md).\n",
        encoding="utf-8")
    (a / "no-type.md").write_text("---\ntitle: X\n---\nbody\n", encoding="utf-8")
    (a / "bare.md").write_text("# bare\n", encoding="utf-8")
    (a / "index.md").write_text(
        "---\ntype: Reference\ntitle: Alpha\n---\n\n# Alpha\n\n"
        "- [NoType](no-type.md) — page\n- [Gone](gone.md) — dead\n",
        encoding="utf-8")
    return make_catalog(tmp_path)


def test_lint_counts_and_warnings(tmp_path):
    from okf import load_catalog, lint_bundle
    catalog = make_bundle(tmp_path)
    alpha = load_catalog(catalog)[0]
    r = lint_bundle(alpha)
    assert r["total"] == 3
    assert r["conformant"] == 1
    assert len(r["problems"]) == 2                      # no-type.md, bare.md
    assert any("gone.md" in w for w in r["warnings"])    # dead index link
    assert any("good.md" in w for w in r["warnings"])    # missing index entry
    assert any("/missing.md" in w for w in r["warnings"])  # dead body link


def test_lint_pct_only_and_strict(tmp_path, capsys):
    from okf import main
    catalog = make_bundle(tmp_path)
    rc = main(["--catalog", str(catalog), "lint", "--pct-only"])
    out = capsys.readouterr().out.strip()
    assert rc == 0
    assert out == "33"  # 1 of 3 pages conformant (beta bundle is empty)
    rc = main(["--catalog", str(catalog), "lint", "--strict"])
    assert rc == 1


def test_lint_scope_respected(tmp_path):
    from okf import load_catalog, lint_bundle
    catalog = make_catalog(tmp_path)
    b = tmp_path / "beta"
    (b / "projects" / "03002" / "knowledge").mkdir(parents=True)
    (b / "projects" / "03002" / "knowledge" / "contexto.md").write_text(
        "---\ntype: Project Context\n---\nok\n", encoding="utf-8")
    (b / "projects" / "03002" / "raw-notes.md").write_text("no fm\n", encoding="utf-8")
    beta = load_catalog(catalog)[1]
    r = lint_bundle(beta)
    assert r["total"] == 1          # raw-notes.md is outside lint scope
    assert r["conformant"] == 1


def test_regenerate_index_preserves_descriptions(tmp_path):
    from okf import regenerate_index
    d = tmp_path / "kb"
    d.mkdir()
    (d / "a.md").write_text("---\ntype: Reference\ntitle: Page A\n"
                            "description: Auto desc A.\n---\nbody\n", encoding="utf-8")
    (d / "b.md").write_text("---\ntype: Reference\ntitle: Page B\n---\nbody\n",
                            encoding="utf-8")
    (d / "sub").mkdir()
    (d / "sub" / "c.md").write_text("---\ntype: Reference\n---\nbody\n",
                                    encoding="utf-8")
    (d / "index.md").write_text(
        "---\ntype: Reference\ntitle: KB\n---\n\n# KB\n\nIntro prose kept.\n\n"
        "- [Page A](a.md) — HAND-WRITTEN description, must survive\n"
        "- [Old](old.md) — target gone, must be removed\n",
        encoding="utf-8")
    result = regenerate_index(d)
    text = (d / "index.md").read_text(encoding="utf-8")
    assert "HAND-WRITTEN description, must survive" in text
    assert "old.md" not in text
    assert "- [Page B](b.md)" in text
    assert "(sub/index.md)" in text          # subdir entry
    assert "Intro prose kept." in text
    assert result["removed"] == ["old.md"]
    assert "b.md" in result["added"] and "sub/index.md" in result["added"]


def test_regenerate_index_creates_missing(tmp_path):
    from okf import regenerate_index
    d = tmp_path / "fresh"
    d.mkdir()
    (d / "x.md").write_text("---\ntype: Decision\ntitle: X\n"
                            "description: Uma decisão.\n---\nbody\n", encoding="utf-8")
    regenerate_index(d)
    text = (d / "index.md").read_text(encoding="utf-8")
    meta, _ = __import__("okf").parse_frontmatter(text)
    assert meta["type"] == "Reference"
    assert "- [X](x.md) — Uma decisão." in text


def test_regenerate_index_preserves_sections_between_entries(tmp_path):
    """Headings/prose between and after entries must survive regeneration."""
    from okf import regenerate_index
    d = tmp_path / "sec"
    d.mkdir()
    (d / "g1.md").write_text("---\ntype: Reference\ntitle: G1\n---\nx\n", encoding="utf-8")
    (d / "r1.md").write_text("---\ntype: Reference\ntitle: R1\n---\nx\n", encoding="utf-8")
    (d / "new.md").write_text("---\ntype: Reference\ntitle: New\n"
                              "description: Nova.\n---\nx\n", encoding="utf-8")
    (d / "index.md").write_text(
        "---\ntype: Reference\ntitle: S\n---\n\n# S\n\n## Guides\n\n- [G1](g1.md)\n\n"
        "## References\n\n- [R1](r1.md)\n\nSee also: trailing note.\n",
        encoding="utf-8")
    result = regenerate_index(d)
    text = (d / "index.md").read_text(encoding="utf-8")
    assert "## Guides" in text and "## References" in text
    assert "See also: trailing note." in text
    assert "- [New](new.md) — Nova." in text
    assert result["added"] == ["new.md"]
    assert text.index("(r1.md)") < text.index("(new.md)")  # appended after last entry


def test_search_scores_and_filters(tmp_path):
    from okf import load_catalog, search_pages
    catalog = make_catalog(tmp_path)
    a = tmp_path / "alpha"
    (a / "cam.md").write_text(
        "---\ntype: Lesson Learned\ntitle: Câmeras GigE\n"
        "description: Uplink de câmeras.\ntags: [visionking, cameras]\n"
        'project: "03002"\n---\n\ncameras cameras cameras\n', encoding="utf-8")
    (a / "plc.md").write_text(
        "---\ntype: Reference\ntitle: PLC Siemens\ntags: [plc]\n---\n\nprofinet\n",
        encoding="utf-8")
    bundles = load_catalog(catalog)
    hits = search_pages(bundles, ["cameras"])
    assert hits and hits[0][2] == "cam.md"
    assert search_pages(bundles, ["cameras"], project="03002")
    assert not search_pages(bundles, ["cameras"], project="03008")
    assert not search_pages(bundles, ["profinet"], tag="cameras")
    assert search_pages(bundles, ["profinet"], type_="Reference")


def test_lint_empty_catalog_exits_2(tmp_path, capsys):
    """A catalog with no parseable bundle rows must not report 100% (exit 2)."""
    from okf import main
    catalog = tmp_path / "knowledge" / "index.md"
    catalog.parent.mkdir()
    catalog.write_text("---\ntype: Reference\n---\n\n# Empty\n\nno table here\n",
                       encoding="utf-8")
    rc = main(["--catalog", str(catalog), "lint", "--pct-only"])
    assert rc == 2
    assert capsys.readouterr().out.strip() != "100"
