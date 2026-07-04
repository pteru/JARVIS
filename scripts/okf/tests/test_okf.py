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
    (tmp_path / "alpha").mkdir()
    (tmp_path / "beta").mkdir()
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
