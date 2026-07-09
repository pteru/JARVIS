"""Tests for new_specialist.py — specialist wrapper generator."""
from pathlib import Path

import pytest

import new_specialist as ns

BOOT_STUB = """---
type: Procedure
---

# Boot

## Roster

| Slug | Classe | Termos de busca | Tags |
|------|--------|-----------------|------|
"""


@pytest.fixture
def root(tmp_path):
    (tmp_path / "journal").mkdir()
    (tmp_path / "journal" / "BOOT.md").write_text(BOOT_STUB, encoding="utf-8")
    return tmp_path


def run(root, *extra):
    return ns.main([
        "sealer", "--class", "project", "--terms", "sealer centerline 03008",
        "--tags", "sealer,03008,visionking", "--project", "03008",
        "--root", str(root), *extra,
    ])


def test_generates_skill_agent_and_roster_row(root):
    assert run(root) == 0
    skill = root / ".claude" / "skills" / "sealer" / "SKILL.md"
    agent = root / ".claude" / "agents" / "sealer-specialist.md"
    assert skill.exists() and agent.exists()
    stext = skill.read_text(encoding="utf-8")
    atext = agent.read_text(encoding="utf-8")
    assert "name: sealer" in stext
    assert "okf.py search sealer centerline 03008 --tag sealer" in stext
    assert '--project "03008"' in stext
    assert "name: sealer-specialist" in atext
    assert "tools: Read, Bash, Grep, Glob" in atext
    assert "segredos" in stext.lower()          # no-secrets reminder present
    boot = (root / "journal" / "BOOT.md").read_text(encoding="utf-8")
    assert "| sealer | project | sealer centerline 03008 | sealer,03008,visionking |" in boot


def test_refuses_overwrite_without_force(root):
    assert run(root) == 0
    assert run(root) == 1                        # second run refuses


def test_force_overwrites_without_duplicating_roster(root):
    assert run(root) == 0
    assert run(root, "--force") == 0
    boot = (root / "journal" / "BOOT.md").read_text(encoding="utf-8")
    assert boot.count("| sealer |") == 1


def test_agent_only_skips_skill(root):
    assert ns.main([
        "pmo", "--class", "field", "--terms", "pmo processos",
        "--tags", "pmo", "--root", str(root), "--agent-only",
    ]) == 0
    assert not (root / ".claude" / "skills" / "pmo").exists()
    assert (root / ".claude" / "agents" / "pmo-specialist.md").exists()


def test_pages_hint_rendered(root):
    ns.main([
        "automacao", "--class", "field", "--terms", "servo plc",
        "--tags", "automacao", "--root", str(root),
        "--pages", "workspaces/strokmatic/knowledge-base/concepts/integracao-plc.md",
    ])
    atext = (root / ".claude" / "agents" / "automacao-specialist.md").read_text(encoding="utf-8")
    assert "integracao-plc.md" in atext
