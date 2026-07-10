---
type: Implementation Plan
title: OKF Cascade — Implementation
description: Task-by-task plan for cascade.py, the CASCADE.md watermark seed, the /okf-cascade skill, and the two gated pilots (sealer, automacao).
tags: [jarvis, okf, journal, cascade]
timestamp: 2026-07-10
product: general
status: draft
language: en
---

# OKF Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The consolidation loop journal → thematic bundles: state file (`journal/CASCADE.md`), CLI (`scripts/okf/cascade.py`), skill (`/okf-cascade`), and two owner-gated pilots.

**Architecture:** Watermark-per-topic in a markdown table (filename comparison, entries immutable); a stdlib CLI assembles gardener briefings from unabsorbed entries matched by TAG; consolidation itself is a gated agent/session act, never automated.

**Tech Stack:** Python 3 stdlib (imports `parse_frontmatter` from sibling `okf.py`), pytest in `scripts/okf/tests/`.

**Spec:** `docs/superpowers/specs/2026-07-10-okf-cascade-design.md` (committed 0bbe082).

## Global Constraints

- Python stdlib only; flat module in `scripts/okf/` (no `__init__.py`; `tests/conftest.py` already handles `sys.path`).
- Test command: `python3 -m pytest scripts/okf/tests/ -q` from `~/JARVIS`; the 40 pre-existing tests stay green.
- Journal entries are IMMUTABLE — no tool or task edits them; absorption state lives only in `journal/CASCADE.md`.
- Topic ↔ entry matching is by frontmatter TAG, never by filename.
- Watermark = exact entry FILENAME; "unabsorbed" ⇔ filename sorts lexicographically after the watermark; `—` = never run (everything with the tag is unabsorbed).
- Cascaded content carries plain-text provenance `(Fonte: sessão <name>, YYYY-MM-DD)`; NEVER a hyperlink to `journal/` from pmo/KB/engineering-docs pages.
- Pendências/status and `pessoal`-tagged content never cascade.
- Pilots are OWNER-GATED: the executing agent stops and waits for explicit approval before committing anything to a target repo.
- PMO repo convention: rebase before push (hourly cron commits); update the project `overview.md` "Histórico de Mudanças" table when its pages change; scoped pathspecs, never `git add -A`.
- Commit trailer everywhere: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; JARVIS pushes go `git push origin develop develop:master` + realign local master.

## File Structure

```
scripts/okf/cascade.py                    # status / briefing / mark
scripts/okf/tests/test_cascade.py
journal/CASCADE.md                        # watermark table (21 rows, seeded)
.claude/skills/okf-cascade/SKILL.md       # in-session loop wrapper
```

---

### Task 1: `cascade.py` (TDD)

**Files:**
- Create: `scripts/okf/cascade.py`
- Test: `scripts/okf/tests/test_cascade.py`

**Interfaces:**
- Consumes: `okf.parse_frontmatter` (sibling module); `journal/CASCADE.md` table rows `| Tópico | Alvos (páginas) | Última absorvida | Último run | Notas |`.
- Produces (Tasks 2–5 depend on these verbatim):
  - `python3 scripts/okf/cascade.py [--root PATH] status [--quiet]`
  - `python3 scripts/okf/cascade.py [--root PATH] briefing <topic>`
  - `python3 scripts/okf/cascade.py [--root PATH] mark <topic> <entry-filename> --date YYYY-MM-DD`
  - Functions: `load_rows(path) -> list[dict]` (keys topic/targets/watermark/lastrun/notes), `journal_entries(dir) -> list[(name, tags)]`, `unabsorbed(row, entries) -> list[str]`.
  - Exit codes: 0 on success; 1 on unknown topic or backward `mark`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/okf/tests/test_cascade.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest scripts/okf/tests/test_cascade.py -q`
Expected: collection error — `ModuleNotFoundError: No module named 'cascade'`.

- [ ] **Step 3: Implement `scripts/okf/cascade.py`**

```python
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
    out = []
    for p in sorted(journal_dir.glob("*.md")):
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest scripts/okf/tests/test_cascade.py -q` → 6 passed.
Run: `python3 -m pytest scripts/okf/tests/ -q` → 46 passed (40 + 6).

- [ ] **Step 5: Commit**

```bash
git add scripts/okf/cascade.py scripts/okf/tests/test_cascade.py
git commit -m "feat(okf): cascade.py — watermark status/briefing/mark for journal consolidation"
```

---

### Task 2: Seed `journal/CASCADE.md`

**Files:**
- Create: `journal/CASCADE.md`

**Interfaces:**
- Consumes: `cascade.py status` (Task 1) for validation.
- Produces: the 21-row watermark table Tasks 3–5 operate on.

- [ ] **Step 1: Create `journal/CASCADE.md` with exactly this content**

```markdown
---
type: Reference
title: Cascade — marcas d'água journal → bundles
description: Estado da consolidação por tópico — última entrada absorvida e alvos de cada especialista. Ferramenta scripts/okf/cascade.py; spec 2026-07-10-okf-cascade-design.md.
tags: [okf, journal, cascade]
timestamp: 2026-07-10
language: pt-BR
---

# Cascade — marcas d'água

Entrada "não-absorvida" = nome do arquivo ordena depois da marca d'água
(match por TAG). `—` em Alvos = tópico sem destino de cascade (pulado).
Nunca editar entradas do journal; o estado vive só aqui.

| Tópico | Alvos (páginas) | Última absorvida | Último run | Notas |
|--------|-----------------|------------------|------------|-------|
| sealer | workspaces/strokmatic/pmo/projects/03008/knowledge/index.md | — | — | — |
| iris-scds | workspaces/strokmatic/pmo/projects/03007/knowledge/index.md | — | — | — |
| stellantis | workspaces/strokmatic/pmo/projects/03010/knowledge/index.md | — | — | — |
| arcelor | workspaces/strokmatic/pmo/projects/03002/knowledge/index.md | — | — | — |
| nissan-smyrna | workspaces/strokmatic/pmo/projects/02008/knowledge/index.md | — | — | — |
| sparktest | — | — | — | camada 03011 ainda não existe |
| mercedes-vk | — | — | — | camada 03904 ainda não existe |
| smartdie | — | — | — | camada 01001 ainda não existe |
| magna | — | — | — | prospecção; journal-only por ora |
| eip | — | — | — | docs vivem no workspace strokmatic-eip |
| automacao | workspaces/strokmatic/knowledge-base/concepts/integracao-plc.md | — | — | — |
| vk-producao | workspaces/strokmatic/knowledge-base/concepts/saude-de-producao.md | — | — | — |
| dados-producao | — | — | — | candidato: concept novo de dados de produção |
| blender | — | — | — | candidato: página KB da ferramenta |
| gm | — | — | — | candidato: página KB normas GM |
| pmo | workspaces/strokmatic/knowledge-base/pmo/processos/organizacao-local-drive.md | — | — | — |
| okf | — | — | — | specs datados são históricos — não recebem cascade |
| jarvis | — | — | — | engineering-docs datados — não recebem cascade |
| administrativo | — | — | — | journal-only por ora |
| propriedade-intelectual | — | — | — | journal-only por ora |
| pessoal | — | — | — | NUNCA cascateia (design) |
```

- [ ] **Step 2: Validate**

Run: `python3 scripts/okf/cascade.py status`
Expected: 21 lines; topics with targets report their real unabsorbed counts (sealer ≥1 from the back-fill; automacao ≥2 via tag matches); targetless topics print "(sem alvos — pulado)". No crash, exit 0.

Run: `python3 scripts/okf/okf.py index journal && python3 scripts/okf/okf.py lint journal`
Expected: CASCADE.md indexed; lint 100%, no problems.

- [ ] **Step 3: Commit**

```bash
git add journal/CASCADE.md journal/index.md
git commit -m "feat(okf): seed journal/CASCADE.md — 21 topics, targets from specialist starter pages"
```

---

### Task 3: `/okf-cascade` skill

**Files:**
- Create: `.claude/skills/okf-cascade/SKILL.md`

**Interfaces:**
- Consumes: `cascade.py` CLI (Task 1), `journal/CASCADE.md` (Task 2).

- [ ] **Step 1: Create `.claude/skills/okf-cascade/SKILL.md` with exactly this content**

```markdown
---
name: okf-cascade
description: Consolida conhecimento do journal nos bundles temáticos (camadas de projeto, concepts da KB) — loop gated por tópico
---

# /okf-cascade [tópico]

Consolidação journal → bundles (spec `2026-07-10-okf-cascade-design.md`).
O dono é o gate: NUNCA commitar páginas-alvo sem aprovação explícita dele.

## Sem argumento

Rode `python3 ~/JARVIS/scripts/okf/cascade.py status` e apresente o backlog;
o dono escolhe o tópico.

## Com tópico

1. `python3 ~/JARVIS/scripts/okf/cascade.py briefing <tópico>` — alvos +
   entradas não-absorvidas (mais antiga primeiro).
2. Leia as páginas-alvo atuais. Proponha os edits consolidados:
   - Decisões/arquitetura/topologia/gotchas → páginas-alvo.
   - Pendências, status e conteúdo `pessoal`: NUNCA cascateiam.
   - Proveniência em texto simples: `(Fonte: sessão <nome>, YYYY-MM-DD)` —
     PROIBIDO hyperlink para `journal/` a partir de pmo/KB/engineering-docs.
3. Mostre o diff ao dono e AGUARDE aprovação.
4. Aprovado → aplique e committe NO REPO ALVO pelas convenções dele
   (PMO: rebase antes de push + atualizar "Histórico de Mudanças" do
   overview.md; KB: `okf.py index` no diretório tocado; pathspec escopado,
   nunca `git add -A`).
5. `python3 ~/JARVIS/scripts/okf/cascade.py mark <tópico> <entrada-mais-nova>
   --date <hoje>` e committe `journal/CASCADE.md` no JARVIS.
6. Verifique: `okf.py lint <bundle-alvo> --strict` limpo; nenhum link para
   `journal/` nas páginas alteradas.
```

- [ ] **Step 2: Smoke-check**

Run: `head -4 .claude/skills/okf-cascade/SKILL.md`
Expected: frontmatter with `name: okf-cascade` + `description:` (same shape as sibling skills).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/okf-cascade/
git commit -m "feat(okf): /okf-cascade skill — gated consolidation loop"
```

---

### Task 4: Pilot — `sealer` (OWNER-GATED)

**Files:**
- Modify (target repo): `workspaces/strokmatic/pmo/projects/03008/knowledge/*` (proposed by the gardener), `projects/03008/overview.md` (Histórico row)
- Modify (JARVIS): `journal/CASCADE.md` (mark)

**Interfaces:**
- Consumes: `cascade.py briefing sealer`; the 03008 knowledge layer.

- [ ] **Step 1: Generate the briefing**

Run: `python3 scripts/okf/cascade.py briefing sealer > /tmp/claude-1000/-home-teruel-JARVIS/*/scratchpad/cascade-sealer-briefing.md` (use the session scratchpad path). Note the newest entry filename printed by `cascade.py status` — needed for `mark` in Step 5.

- [ ] **Step 2: Dispatch the gardener (write-capable, uncommitted)**

Dispatch a `general-purpose` agent: read the briefing file + the current pages under `workspaces/strokmatic/pmo/projects/03008/knowledge/`; apply the triage rules (Global Constraints); EDIT the target pages in the working tree; do NOT run git; final message = list of pages touched + a 5-line summary of what was absorbed vs. skipped (pendências/status must be skipped).

- [ ] **Step 3: Present the diff and STOP for the owner**

Run: `git -C workspaces/strokmatic/pmo diff -- projects/03008/knowledge/` and summarize inline. WAIT for explicit owner approval. Rejected → revert (`git -C workspaces/strokmatic/pmo checkout -- projects/03008/knowledge/`) and record why in the ledger; done.

- [ ] **Step 4 (approved): Commit in the PMO repo per its conventions**

Add the "Histórico de Mudanças" row in `projects/03008/overview.md`; then:

```bash
git -C workspaces/strokmatic/pmo add projects/03008/knowledge/ projects/03008/overview.md
git -C workspaces/strokmatic/pmo commit -m "docs(03008): cascade journal → knowledge layer"
git -C workspaces/strokmatic/pmo pull --rebase origin master && git -C workspaces/strokmatic/pmo push origin master
```

- [ ] **Step 5: Mark and verify**

```bash
python3 scripts/okf/cascade.py mark sealer <newest-entry-filename> --date <today>
python3 scripts/okf/okf.py lint pmo --strict          # exit 0
grep -rn "journal/" workspaces/strokmatic/pmo/projects/03008/knowledge/ ; echo "(vazio = ok)"
git add journal/CASCADE.md && git commit -m "chore(okf): advance sealer cascade watermark"
```

---

### Task 5: Pilot — `automacao` (KB path, OWNER-GATED)

Same shape as Task 4 with these deltas:

- [ ] **Step 1:** `python3 scripts/okf/cascade.py briefing automacao > <scratchpad>/cascade-automacao-briefing.md`. This validates TAG-based multi-topic matching: sealer/iris-scds entries tagged `automacao` must appear.
- [ ] **Step 2:** gardener edits `workspaces/strokmatic/knowledge-base/concepts/integracao-plc.md` only (cross-project gotchas/facts; no project-status content).
- [ ] **Step 3:** diff via `git -C workspaces/strokmatic/knowledge-base diff`, STOP for owner.
- [ ] **Step 4 (approved):** `python3 scripts/okf/okf.py index workspaces/strokmatic/knowledge-base/concepts` if the page set changed; commit + push in the KB repo (scoped pathspec).
- [ ] **Step 5:** `cascade.py mark automacao <newest> --date <today>`; `okf.py lint knowledge-base --strict` exit 0; grep-for-`journal/` clean; commit CASCADE.md in JARVIS; push JARVIS (`develop` + `develop:master`, realign local master).

---

## Self-review notes

- Spec §1 (CASCADE.md semantics) → Tasks 1–2; §2 (CLI) → Task 1; §3 (gardener flow + triage + provenance) → Tasks 4–5 + skill text; §4 (skill; cron deferred by spec — intentionally NO cron task); §5 rollout 1→3 → Tasks 2, 4, 5. Out-of-scope items have no tasks (correct).
- `mark` rewrites the row via verbatim string replace — requires normalized `| a | b |` cell spacing, which `load_rows`' reconstruction guarantees only if CASCADE.md keeps single-space padding; the seed in Task 2 does, and `mark` exits 1 with a clear message if drift breaks the match (owner fixes formatting).
- Pilots write to OTHER repos (pmo, knowledge-base): both tasks embed the target repo's conventions inline so an implementer without session context cannot miss them.
