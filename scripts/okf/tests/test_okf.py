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
