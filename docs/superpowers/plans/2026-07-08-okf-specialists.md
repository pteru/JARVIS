---
type: Implementation Plan
title: OKF Specialists — Journal Bundle + 21 Topic Specialists
description: Task-by-task plan to build the journal bundle, the specialist generator, the 42 wrapper files, the full session back-fill, and the verification drill.
tags: [jarvis, okf, journal, specialists, agents]
timestamp: 2026-07-08
product: general
status: draft
language: en
---

# OKF Specialists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Journal bundle (`journal/`) as the specialists' memory substrate + 21 topic specialists (skill + dispatchable agent each) + full back-fill of the 19 named sessions + a live verification drill.

**Architecture:** A specialist is a retrieval convention, not resident memory: two thin generated wrappers (session skill, read-only subagent) over one boot procedure (`journal/BOOT.md`) that rehydrates from `okf search` + the 2–3 most recent journal entries for the topic. Back-fill distills each existing named session into one journal entry via mechanical transcript extraction.

**Tech Stack:** Python 3 stdlib only (matches `scripts/okf/okf.py`), pytest (existing `scripts/okf/tests/` home), markdown/YAML frontmatter per OKF v0.1.

**Spec:** `docs/superpowers/specs/2026-07-08-okf-specialists-design.md` (committed `c0052a6`).

## Global Constraints

- Python scripts: **stdlib only**, flat modules in `scripts/okf/` (no `__init__.py`; `scripts/okf/tests/conftest.py` already inserts the module dir on `sys.path`).
- Test command: `python3 -m pytest scripts/okf/tests/ -q` from the repo root (`~/JARVIS`). The 30 pre-existing tests must stay green.
- Journal entries and specialist wrapper bodies are **PT-BR**; specs/plans/code comments are English.
- **Never a secret/credential in a journal entry** — repeat this rule in every generated wrapper and in every back-fill agent prompt.
- Journal frontmatter: `type: Session Log` (required), `title`, `description`, `tags` (topic slug first; project codes quoted 5-digit strings), `timestamp`, `session`, `language: pt-BR`; `project`/`product` only when applicable.
- Commits: scoped pathspecs only, **never `git add -A`** (repo carries unrelated dirty files + cron churn). Branch `develop`; verify with `git branch --show-current` before each commit.
- Push convention (end of plan only): `git push origin develop develop:master`, then `git fetch origin -q && git branch -f master origin/master`.
- Existing skills `.claude/skills/pmo/` and `.claude/skills/jarvis/` must NOT be overwritten — those two specialists are agent-only generation + a boot section appended to the existing SKILL.md.
- Commit trailer on every commit:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## File Structure

```
journal/                                    # NEW top-level dir, 5th OKF bundle
  index.md                                  # bundle entry point (okf index journal)
  BOOT.md                                   # canonical boot procedure + roster table
  2026-07-08-okf.md                         # exemplar entry (first-hand, Task 1)
  <date>-<session>.md × 19                  # back-fill entries (Task 5)
scripts/okf/new_specialist.py               # generator: skill + agent + roster row
scripts/okf/session_extract.py              # mechanical transcript digest
scripts/okf/tests/test_new_specialist.py
scripts/okf/tests/test_session_extract.py
.claude/skills/<slug>/SKILL.md × 19         # generated (pmo/jarvis excluded)
.claude/agents/<slug>-specialist.md × 21    # generated (.claude/agents/ is new)
knowledge/index.md                          # +1 catalog row
.claude/CLAUDE.md                           # session-end journal directive
scripts/build-forge.sh                      # +--exclude='journal/'
```

---

### Task 1: Journal bundle bootstrap (BOOT.md, catalog row, directive, FORGE exclusion, exemplar entry)

**Files:**
- Create: `journal/index.md`, `journal/BOOT.md`, `journal/2026-07-08-okf.md`
- Modify: `knowledge/index.md` (one table row), `.claude/CLAUDE.md` (Session Directives block), `scripts/build-forge.sh:87` (one exclusion line)

**Interfaces:**
- Produces: `journal/BOOT.md` ending in a `## Roster` markdown table with header `| Slug | Classe | Termos de busca | Tags |` — Task 2's generator appends rows to it (matches rows by leading `| <slug> |`).
- Produces: the catalog row that makes `python3 scripts/okf/okf.py lint journal` and `okf search --bundle journal` work for all later tasks.

- [ ] **Step 1: Create `journal/BOOT.md`**

```markdown
---
type: Procedure
title: Boot de Especialista OKF
description: Convenção canônica de boot dos especialistas de tópico — como rehidratar contexto a partir do journal e dos bundles OKF.
tags: [okf, journal, specialists]
timestamp: 2026-07-08
product: general
language: pt-BR
---

# Boot de Especialista OKF

Todo especialista (skill `/<slug>` ou agente `<slug>-specialist`) boota assim:

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles).
2. `python3 ~/JARVIS/scripts/okf/okf.py search <termos do tópico> --tag <slug>`
   — colete hits em journal + knowledge-base + pmo + engineering-docs.
   Especialistas de projeto repetem com `--project "NNNNN"`.
3. Leia as 2–3 entradas de `~/JARVIS/journal/` mais recentes do tópico (data no
   nome do arquivo). O boot é guiado pela TAREFA: em tópicos amplos, filtre pela
   sub-tag relevante (ex.: `pessoal` → `aeroporto`), nunca carregue tudo.
4. Leia as páginas de conhecimento que essas entradas linkam (camadas
   `knowledge/` de projeto, concepts da KB, specs) — progressive disclosure,
   nunca leitura exaustiva.
5. Só então aja. Cite as fontes OKF (caminhos) nas respostas.

## Encerramento de bloco de trabalho

Escreva `journal/YYYY-MM-DD-<topic>.md` (sufixo `-2`, `-3` para mesmo
dia/tópico): frontmatter `type: Session Log` + `session:` + tags (slug do
tópico primeiro, depois códigos de projeto "NNNNN" e tags de campo); corpo
PT-BR de 20–40 linhas com **Feito** · **Decisões** · **Pendências** ·
**Links**. É uma destilação, nunca dump de transcript. **NUNCA inclua
segredos ou credenciais.** Depois rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.

## Roster

| Slug | Classe | Termos de busca | Tags |
|------|--------|-----------------|------|
```

(The roster table body is intentionally empty — `new_specialist.py` appends one row per specialist.)

- [ ] **Step 2: Create the exemplar entry `journal/2026-07-08-okf.md`**

```markdown
---
type: Session Log
title: 2026-07-08 — okf — adoção OKF, governança Drive 03008 e spec dos especialistas
description: Sistema OKF completo em produção (4 bundles + CLI), piloto de governança Local↔Drive executado no 03008, e spec dos especialistas de tópico aprovada.
tags: [okf, journal, specialists, gdrive, "03008", pmo]
timestamp: 2026-07-08
session: okf
language: pt-BR
---

# 2026-07-08 — okf

## Feito

- **Adoção OKF v0.1 (2026-07-04):** catálogo raiz `knowledge/index.md` com 4
  bundles federados (pmo, knowledge-base, engineering-docs, memory); CLI
  `scripts/okf/okf.py` (catalog/lint/search/index, stdlib, 24 testes);
  camadas `knowledge/` para 02008, 03002, 03007, 03008, 03010; concepts na KB;
  CHECK_14 no health-check (65%, alvo 80%). Bundle de memória migrado com
  backup (`memory-backup-2026-07-04-pre-okf.tar.gz`). Repos JARVIS, KB e PMO
  publicados (develop=master).
- **Governança Local↔Drive (spec+plano 7d1e059):** política por audiência;
  piloto 03008 executado — 4 uploads verificados, 5 absorções Drive→bundle com
  `resource:`, plano em `projects/03008/knowledge/drive-plan.md`
  (status: executed, cadeia f36b323…9bec9ff). Página canônica na KB:
  `pmo/processos/organizacao-local-drive.md`.
- **Especialistas OKF (spec c0052a6):** journal bundle + 21 especialistas
  (10 projeto + 11 campo), wrappers skill+agente gerados por
  `scripts/okf/new_specialist.py`, back-fill total das sessões nomeadas.

## Decisões

- Journal versionado no repo JARVIS (privado) **incluindo tópicos pessoais**;
  `journal/` excluído do build FORGE.
- Especialista = convenção de retrieval (boot por busca), não memória residente;
  boot guiado pela tarefa com disciplina de tags (projeto E campo).
- Back-fill completo: uma entrada por sessão nomeada, extração mecânica do
  transcript (nunca leitura integral), timestamp = data da sessão, tag `backfill`.

## Pendências

- Rollout governança Drive: 01001 → 02008 → 03010 → 03002 (ciclo do piloto).
- Pendências do drive-plan 03008 (1–10; ver página) — destaque: dedupe de
  duplicados com cedilha no Drive (~433 MB) e reorganização analysis/ (opção A/B).
- Camadas OKF propostas e não confirmadas: 03904, 03009.

## Links

- Specs: `docs/superpowers/specs/2026-07-04-okf-adoption-design.md`,
  `docs/superpowers/specs/2026-07-04-pmo-drive-governance-design.md`,
  `docs/superpowers/specs/2026-07-08-okf-specialists-design.md`
- Plano Drive 03008: `workspaces/strokmatic/pmo/projects/03008/knowledge/drive-plan.md`
- Política KB: `workspaces/strokmatic/knowledge-base/pmo/processos/organizacao-local-drive.md`
```

- [ ] **Step 3: Create `journal/index.md`**

```markdown
---
type: Reference
title: Journal — diário de trabalho por sessão/tópico
description: Uma entrada por bloco de trabalho de sessão nomeada — substrato de memória dos especialistas OKF. Boot canônico em BOOT.md.
tags: [okf, journal]
timestamp: 2026-07-08
language: pt-BR
---

# Journal

Diário de trabalho destilado, uma entrada por bloco de sessão
(`YYYY-MM-DD-<topic>.md`). Especialistas leem as 2–3 entradas mais recentes do
seu tópico no boot ([BOOT.md](BOOT.md)). Entradas com tag `backfill` são
snapshots retroativos de sessões pré-journal.

- [BOOT.md](BOOT.md) — Convenção canônica de boot dos especialistas + roster.
- [2026-07-08-okf.md](2026-07-08-okf.md) — Adoção OKF, governança Drive 03008 e spec dos especialistas.
```

- [ ] **Step 4: Add the catalog row in `knowledge/index.md`**

Append this row to the bundle table (after the `memory` row, line 22):

```markdown
| journal | ~/JARVIS/journal | https://github.com/pteru/JARVIS | index.md | ** | Diário de trabalho por sessão/tópico — substrato de memória dos especialistas OKF. Repo privado; inclui tópicos pessoais. |
```

- [ ] **Step 5: Add the session-end directive in `.claude/CLAUDE.md`**

In the `## Session Directives` block, insert as the SECOND bullet (after the MEMORY.md/lessons-learned bullet):

```markdown
- After each substantive work block, write a journal entry `journal/YYYY-MM-DD-<topic>.md` following `journal/BOOT.md` (Feito · Decisões · Pendências · Links; PT-BR; 20–40 lines; **never secrets/credentials**), then run `python3 scripts/okf/okf.py index journal`
```

- [ ] **Step 6: Add the FORGE exclusion in `scripts/build-forge.sh`**

In the rsync exclusion list (lines 78–109), insert after `--exclude='workspaces/' \` (line 87):

```bash
    --exclude='journal/' \
```

- [ ] **Step 7: Verify lint and catalog**

Run: `python3 scripts/okf/okf.py catalog`
Expected: 5 bundles listed, `journal` among them.

Run: `python3 scripts/okf/okf.py lint journal`
Expected: 2/2 pages conformant (100%) — `index.md` is RESERVED and not counted. No problems; warnings empty (both pages are listed in `journal/index.md`).

Run: `grep -n "exclude='journal/'" scripts/build-forge.sh && bash -n scripts/build-forge.sh && echo SH-OK`
Expected: the new line, then `SH-OK`.

Run: `python3 -m pytest scripts/okf/tests/ -q`
Expected: all existing tests pass (no regression from the catalog change).

- [ ] **Step 8: Commit**

```bash
git add journal/ knowledge/index.md .claude/CLAUDE.md scripts/build-forge.sh
git commit -m "feat(okf): journal bundle — BOOT convention, catalog row, session-end directive, FORGE exclusion"
```

---

### Task 2: `new_specialist.py` generator (TDD)

**Files:**
- Create: `scripts/okf/new_specialist.py`
- Test: `scripts/okf/tests/test_new_specialist.py`

**Interfaces:**
- Consumes: `journal/BOOT.md` roster table from Task 1 (appends rows under the `| Slug | Classe | ...` header).
- Produces: CLI `python3 scripts/okf/new_specialist.py <slug> --class {project|field} --terms "<terms>" --tags "<t1,t2>" [--project "NNNNN"] [--pages <p1,p2>] [--agent-only] [--force] [--root PATH]`; function `generate(args) -> list[Path]` returning created paths. Exit 1 (no writes) if any target exists and `--force` absent. `--root` defaults to the repo root (parent of the `scripts/` dir) — tests pass a tmp dir.

- [ ] **Step 1: Write the failing tests**

Create `scripts/okf/tests/test_new_specialist.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest scripts/okf/tests/test_new_specialist.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'new_specialist'`.

- [ ] **Step 3: Implement `scripts/okf/new_specialist.py`**

```python
#!/usr/bin/env python3
"""Generate an OKF topic specialist: session skill + dispatchable agent.

Renders .claude/skills/<slug>/SKILL.md and .claude/agents/<slug>-specialist.md
from embedded templates and appends the slug to the roster table in
journal/BOOT.md. Refuses to overwrite an existing specialist without --force.
Stdlib only.
"""
import argparse
import sys
from pathlib import Path

SKILL_TEMPLATE = """---
name: {slug}
description: Especialista em {terms} — carrega contexto OKF recente do tópico
---

# Especialista: {slug}

Assuma a persona de especialista no tópico **{slug}** (classe: {cls}).

## Boot (convenção canônica: `journal/BOOT.md`)

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles OKF).
2. Busque contexto recente:
   `python3 ~/JARVIS/scripts/okf/okf.py search {terms} --tag {slug}`{project_step}
3. Leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico (data no
   nome do arquivo), filtrando pela sub-tag da tarefa quando o tópico for amplo.
4. Leia as páginas OKF que essas entradas linkam{pages_hint} —
   progressive disclosure, nunca leitura exaustiva.
5. Só então aja. Cite as fontes OKF (caminhos) nas respostas.

## Encerramento

Ao final do bloco de trabalho, escreva `~/JARVIS/journal/YYYY-MM-DD-{slug}.md`
(Feito · Decisões · Pendências · Links; PT-BR; 20–40 linhas; tags
`[{tags}]`; **NUNCA segredos/credenciais**) e rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.
"""

AGENT_TEMPLATE = """---
name: {slug}-specialist
description: Especialista em {terms}. Use para perguntas e tarefas do tópico {slug}; rehidrata contexto do journal e dos bundles OKF antes de responder.
tools: Read, Bash, Grep, Glob
model: sonnet
---

Você é o especialista no tópico **{slug}** (classe: {cls}).

Antes de qualquer tarefa, boot (convenção: `~/JARVIS/journal/BOOT.md`):

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles OKF).
2. Rode `python3 ~/JARVIS/scripts/okf/okf.py search {terms} --tag {slug}`{project_step}
3. Leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico (data no
   nome do arquivo), filtrando pela sub-tag da tarefa quando o tópico for amplo.
4. Leia as páginas OKF que essas entradas linkam{pages_hint} —
   progressive disclosure, nunca leitura exaustiva.

Sua mensagem final é o entregável devolvido ao chamador: responda de forma
completa e cite as fontes OKF (caminhos de arquivo) usadas. Você é read-only:
não edite arquivos, não faça commits e **nunca exponha segredos/credenciais**.
"""

ROSTER_HEADER = "| Slug | Classe | Termos de busca | Tags |"


def _render(template, args):
    project_step = (
        "\n   e repita com `--project \"{0}\"` para a camada do projeto."
        .format(args.project) if args.project else ""
    )
    pages_hint = (
        " (comece por: {0})".format(args.pages) if args.pages else ""
    )
    return template.format(slug=args.slug, terms=args.terms, tags=args.tags,
                           cls=args.cls, project_step=project_step,
                           pages_hint=pages_hint)


def _update_roster(boot_path, args):
    lines = boot_path.read_text(encoding="utf-8").splitlines()
    row = "| {0} | {1} | {2} | {3} |".format(
        args.slug, args.cls, args.terms, args.tags)
    lines = [l for l in lines if not l.startswith("| {0} |".format(args.slug))]
    lines.append(row)
    boot_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def default_root():
    return Path(__file__).resolve().parent.parent.parent


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slug")
    ap.add_argument("--class", dest="cls", required=True,
                    choices=["project", "field"])
    ap.add_argument("--terms", required=True, help="okf search terms")
    ap.add_argument("--tags", required=True, help="comma-separated journal tags")
    ap.add_argument("--project", default=None, help='quoted 5-digit code')
    ap.add_argument("--pages", default=None,
                    help="comma-separated starter knowledge pages")
    ap.add_argument("--agent-only", action="store_true",
                    help="skip the skill (slug collides with an existing skill)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--root", default=None, help="repo root (tests)")
    args = ap.parse_args(argv)

    root = Path(args.root) if args.root else default_root()
    skill_path = root / ".claude" / "skills" / args.slug / "SKILL.md"
    agent_path = root / ".claude" / "agents" / (args.slug + "-specialist.md")
    boot_path = root / "journal" / "BOOT.md"

    targets = [agent_path] if args.agent_only else [skill_path, agent_path]
    if not args.force:
        clashes = [p for p in targets if p.exists()]
        if clashes:
            print("refusing to overwrite (use --force): "
                  + ", ".join(str(p) for p in clashes), file=sys.stderr)
            return 1
    if not boot_path.exists():
        print("journal/BOOT.md not found under root: {0}".format(root),
              file=sys.stderr)
        return 1

    if not args.agent_only:
        skill_path.parent.mkdir(parents=True, exist_ok=True)
        skill_path.write_text(_render(SKILL_TEMPLATE, args), encoding="utf-8")
    agent_path.parent.mkdir(parents=True, exist_ok=True)
    agent_path.write_text(_render(AGENT_TEMPLATE, args), encoding="utf-8")
    _update_roster(boot_path, args)
    for p in targets:
        print(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest scripts/okf/tests/test_new_specialist.py -q`
Expected: 5 passed.

Run: `python3 -m pytest scripts/okf/tests/ -q`
Expected: all pass (existing suite + 5 new).

- [ ] **Step 5: Commit**

```bash
git add scripts/okf/new_specialist.py scripts/okf/tests/test_new_specialist.py
git commit -m "feat(okf): new_specialist.py — generates specialist skill+agent wrappers and roster row"
```

---

### Task 3: Generate the 21 specialists

**Files:**
- Create (generated): `.claude/skills/<slug>/SKILL.md` × 19, `.claude/agents/<slug>-specialist.md` × 21
- Modify: `journal/BOOT.md` (21 roster rows), `.claude/skills/pmo/SKILL.md`, `.claude/skills/jarvis/SKILL.md` (boot section appended)

**Interfaces:**
- Consumes: `new_specialist.py` CLI from Task 2.
- Produces: dispatchable agent names `<slug>-specialist` (used by Task 6's drill) and skills `/<slug>`.

- [ ] **Step 1: Collision pre-check**

Run from `~/JARVIS`:

```bash
for s in sealer iris-scds stellantis arcelor sparktest mercedes-vk smartdie magna nissan-smyrna eip automacao vk-producao dados-producao blender gm pmo okf jarvis administrativo propriedade-intelectual pessoal; do
  test -d .claude/skills/$s && echo "COLLISION: $s"; done
```

Expected: exactly `COLLISION: pmo` and `COLLISION: jarvis`. If anything else appears, STOP and add `--agent-only` for it too (and note it in the commit message).

- [ ] **Step 2: Verify starter-page paths exist**

```bash
ls workspaces/strokmatic/knowledge-base/concepts/integracao-plc.md \
   workspaces/strokmatic/knowledge-base/concepts/saude-de-producao.md \
   workspaces/strokmatic/knowledge-base/pmo/processos/organizacao-local-drive.md \
   workspaces/strokmatic/pmo/projects/03008/knowledge/index.md \
   workspaces/strokmatic/pmo/projects/03007/knowledge/index.md \
   workspaces/strokmatic/pmo/projects/03010/knowledge/index.md \
   workspaces/strokmatic/pmo/projects/03002/knowledge/index.md \
   workspaces/strokmatic/pmo/projects/02008/knowledge/index.md \
   docs/superpowers/specs/2026-07-04-okf-adoption-design.md
```

Expected: all listed (no "No such file"). Drop any missing path from the corresponding `--pages` below.

- [ ] **Step 3: Run the generator — 10 project specialists**

```bash
P=workspaces/strokmatic/pmo/projects
python3 scripts/okf/new_specialist.py sealer --class project --terms "sealer centerline provisioning 03008" --tags "sealer,03008,visionking,automacao" --project "03008" --pages "$P/03008/knowledge/index.md"
python3 scripts/okf/new_specialist.py iris-scds --class project --terms "iris scds camera 03007" --tags "iris-scds,03007,visionking,automacao" --project "03007" --pages "$P/03007/knowledge/index.md"
python3 scripts/okf/new_specialist.py stellantis --class project --terms "stellantis goiana paint 03010" --tags "stellantis,03010,visionking" --project "03010" --pages "$P/03010/knowledge/index.md"
python3 scripts/okf/new_specialist.py arcelor --class project --terms "arcelormittal producao 03002 03009" --tags "arcelor,03002,03009,visionking" --project "03002" --pages "$P/03002/knowledge/index.md"
python3 scripts/okf/new_specialist.py sparktest --class project --terms "sparktest fagulhamento 03011" --tags "sparktest,03011,visionking" --project "03011"
python3 scripts/okf/new_specialist.py mercedes-vk --class project --terms "mercedes jdf tetos 03904" --tags "mercedes-vk,03904,visionking" --project "03904"
python3 scripts/okf/new_specialist.py smartdie --class project --terms "diemaster smartdie sjc 01001" --tags "smartdie,01001,diemaster" --project "01001"
python3 scripts/okf/new_specialist.py magna --class project --terms "magna prospeccao spot" --tags "magna,prospeccao"
python3 scripts/okf/new_specialist.py nissan-smyrna --class project --terms "nissan smyrna smartcam 02008" --tags "nissan-smyrna,02008,spotfusion" --project "02008" --pages "$P/02008/knowledge/index.md"
python3 scripts/okf/new_specialist.py eip --class project --terms "ethernet-ip opener cip strokmatic-eip" --tags "eip,strokmatic-eip"
```

Expected: each command prints the created path(s), exit 0.

- [ ] **Step 4: Run the generator — 11 field specialists**

```bash
KB=workspaces/strokmatic/knowledge-base
python3 scripts/okf/new_specialist.py automacao --class field --terms "servo drive plc profinet ethercat gsdml" --tags "automacao" --pages "$KB/concepts/integracao-plc.md"
python3 scripts/okf/new_specialist.py vk-producao --class field --terms "producao monitoramento troubleshoot vk-health burnin" --tags "vk-producao,arcelor" --pages "$KB/concepts/saude-de-producao.md"
python3 scripts/okf/new_specialist.py dados-producao --class field --terms "backup migracao dumps imagens das gcs" --tags "dados-producao,arcelor"
python3 scripts/okf/new_specialist.py blender --class field --terms "blender sdk-blender-tools 3d render" --tags "blender"
python3 scripts/okf/new_specialist.py gm --class field --terms "gm supplypower normas general motors" --tags "gm"
python3 scripts/okf/new_specialist.py pmo --class field --terms "pmo processos sprints governanca drive" --tags "pmo" --pages "$KB/pmo/processos/organizacao-local-drive.md" --agent-only
python3 scripts/okf/new_specialist.py okf --class field --terms "okf knowledge bundle catalog journal" --tags "okf" --pages "docs/superpowers/specs/2026-07-04-okf-adoption-design.md"
python3 scripts/okf/new_specialist.py jarvis --class field --terms "orchestrator jarvis skills mcp dispatch" --tags "jarvis" --agent-only
python3 scripts/okf/new_specialist.py administrativo --class field --terms "administrativo rh contratos financeiro" --tags "administrativo"
python3 scripts/okf/new_specialist.py propriedade-intelectual --class field --terms "patente ip inpi claims 03000 02000" --tags "propriedade-intelectual"
python3 scripts/okf/new_specialist.py pessoal --class field --terms "pessoal aeroporto arrendamento amendoim" --tags "pessoal"
```

Expected: exit 0 each; `pmo` and `jarvis` create agents only.

- [ ] **Step 5: Append the boot section to the two existing skills**

Append to BOTH `.claude/skills/pmo/SKILL.md` and `.claude/skills/jarvis/SKILL.md` (end of file, verbatim except the slug/terms line):

For `pmo`:

```markdown

## Boot OKF (especialista pmo)

Antes de trabalhar, rehidrate contexto recente (convenção `~/JARVIS/journal/BOOT.md`):
`python3 ~/JARVIS/scripts/okf/okf.py search pmo processos sprints governanca drive --tag pmo`,
leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico e as páginas
que elas linkam. Ao final do bloco, escreva `journal/YYYY-MM-DD-pmo.md`
(Feito · Decisões · Pendências · Links; **nunca segredos**) e rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.
```

For `jarvis`: same block with `search orchestrator jarvis skills mcp dispatch --tag jarvis` and `journal/YYYY-MM-DD-jarvis.md`.

- [ ] **Step 6: Verify counts and roster**

```bash
ls .claude/agents/*-specialist.md | wc -l           # expect 21
ls -d .claude/skills/*/ | wc -l                      # expect 37 + 19 = 56
grep -c '^| ' journal/BOOT.md                        # expect 23 (header + separator + 21 rows)
python3 scripts/okf/okf.py lint journal              # BOOT.md edits stay conformant
```

Expected: 21 / 56 / 23 / lint 3/3 100%.

- [ ] **Step 7: Commit**

```bash
git add .claude/agents/ .claude/skills/ journal/BOOT.md
git commit -m "feat(okf): generate 21 topic specialists (10 project + 11 field; pmo/jarvis agent-only)"
```

---

### Task 4: `session_extract.py` — mechanical transcript digest (TDD)

**Files:**
- Create: `scripts/okf/session_extract.py`
- Test: `scripts/okf/tests/test_session_extract.py`

**Interfaces:**
- Consumes: Claude Code transcript jsonl (records with `type: "user"|"assistant"`, `message.content` as string or parts list, `isMeta` flag).
- Produces: CLI `python3 scripts/okf/session_extract.py <jsonl> [--max-msg N] [--max-total N]` printing a markdown digest of user prompts and turn-final assistant texts; function `extract(path) -> list[tuple[str, str]]`. Task 5's back-fill agents call the CLI — they never read the jsonl directly.

- [ ] **Step 1: Write the failing tests**

Create `scripts/okf/tests/test_session_extract.py`:

```python
"""Tests for session_extract.py — mechanical transcript digest."""
import json

import session_extract as se


def _write(tmp_path, records):
    p = tmp_path / "session.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in records), encoding="utf-8")
    return p


def _user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def _assistant(text):
    return {"type": "assistant",
            "message": {"role": "assistant",
                        "content": [{"type": "text", "text": text}]}}


def test_extracts_user_and_turn_final_assistant(tmp_path):
    p = _write(tmp_path, [
        _user("faz X"),
        _assistant("vou fazer"),
        _assistant("X feito, resultado Y"),
        _user("agora Z"),
        _assistant("Z feito"),
    ])
    turns = se.extract(p)
    assert turns == [
        ("user", "faz X"),
        ("assistant", "X feito, resultado Y"),   # only the turn-FINAL text
        ("user", "agora Z"),
        ("assistant", "Z feito"),
    ]


def test_skips_meta_noise_and_tool_results(tmp_path):
    p = _write(tmp_path, [
        {"type": "user", "isMeta": True,
         "message": {"role": "user", "content": "meta"}},
        _user("<command-name>/jarvis</command-name>"),
        _user("<system-reminder>ignore</system-reminder>"),
        {"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "content": "big tool dump"}]}},
        _user("pergunta real"),
        _assistant("resposta"),
    ])
    assert se.extract(p) == [("user", "pergunta real"), ("assistant", "resposta")]


def test_skips_malformed_lines(tmp_path):
    p = tmp_path / "s.jsonl"
    p.write_text('not json\n' + json.dumps(_user("oi")), encoding="utf-8")
    assert se.extract(p) == [("user", "oi")]


def test_cli_truncates_long_messages(tmp_path, capsys):
    p = _write(tmp_path, [_user("a" * 500), _assistant("fim")])
    assert se.main([str(p), "--max-msg", "100"]) == 0
    out = capsys.readouterr().out
    assert "a" * 100 + " […]" in out
    assert "a" * 101 not in out


def test_cli_total_cap(tmp_path, capsys):
    p = _write(tmp_path, [_user("x" * 300), _assistant("y" * 300),
                          _user("z" * 300)])
    assert se.main([str(p), "--max-total", "400"]) == 0
    out = capsys.readouterr().out
    assert "[truncado" in out
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest scripts/okf/tests/test_session_extract.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'session_extract'`.

- [ ] **Step 3: Implement `scripts/okf/session_extract.py`**

```python
#!/usr/bin/env python3
"""Mechanical digest of a Claude Code transcript jsonl.

Prints user prompts and turn-final assistant texts as a markdown digest — the
raw material for a journal back-fill entry. Extraction only, no interpretation;
tool calls/results, meta records and command noise are dropped. Stdlib only.
"""
import argparse
import json
import sys
from pathlib import Path

DEFAULT_MAX_MSG = 700       # chars kept per message
DEFAULT_MAX_TOTAL = 20000   # digest size cap

NOISE_PREFIXES = ("<command-name>", "<local-command", "<system-reminder>",
                  "Caveat:")


def _text_of(content):
    """Plain text of message content (string or parts list); '' otherwise."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [p.get("text", "") for p in content
                 if isinstance(p, dict) and p.get("type") == "text"]
        return "\n".join(t for t in parts if t).strip()
    return ""


def _is_noise(text):
    return not text or text.startswith(NOISE_PREFIXES)


def extract(path):
    """Return [(role, text)] turns; assistant = turn-final text only."""
    turns = []
    pending = None   # last assistant text seen since the previous user msg
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("isMeta"):
            continue
        kind = rec.get("type")
        text = _text_of((rec.get("message") or {}).get("content"))
        if kind == "user":
            if _is_noise(text):
                continue
            if pending:
                turns.append(("assistant", pending))
                pending = None
            turns.append(("user", text))
        elif kind == "assistant" and text:
            pending = text
    if pending:
        turns.append(("assistant", pending))
    return turns


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("jsonl")
    ap.add_argument("--max-msg", type=int, default=DEFAULT_MAX_MSG)
    ap.add_argument("--max-total", type=int, default=DEFAULT_MAX_TOTAL)
    args = ap.parse_args(argv)
    total = 0
    for role, text in extract(args.jsonl):
        if len(text) > args.max_msg:
            text = text[:args.max_msg] + " […]"
        block = "## {0}\n\n{1}\n\n".format(role, text)
        total += len(block)
        if total > args.max_total:
            print("… [truncado: limite de extração atingido]")
            return 0
        sys.stdout.write(block)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest scripts/okf/tests/ -q`
Expected: all pass (existing + 5 new_specialist + 5 session_extract).

- [ ] **Step 5: Smoke-test on a real transcript**

Run: `python3 scripts/okf/session_extract.py /home/teruel/.claude/projects/-home-teruel-JARVIS/82d8ed83-ae8b-4298-bc6f-57f1bdbbad35.jsonl | head -30`
Expected: readable `## user` / `## assistant` digest of the `magna` session, no tool dumps, no system-reminder blocks.

- [ ] **Step 6: Commit**

```bash
git add scripts/okf/session_extract.py scripts/okf/tests/test_session_extract.py
git commit -m "feat(okf): session_extract.py — mechanical transcript digest for journal back-fill"
```

---

### Task 5: Back-fill — one journal entry per named session (19 entries)

**Files:**
- Create: 19 files `journal/<session-date>-<session-name>.md`
- Modify: `journal/index.md` (regenerated via `okf index journal`)

**Interfaces:**
- Consumes: `session_extract.py` CLI (Task 4); census table below.
- Produces: the journal corpus the specialists boot from; every entry carries a `backfill` tag.

**Census (session → file/date/tags).** Transcript root: `/home/teruel/.claude/projects/-home-teruel-JARVIS/`. `timestamp` and filename date = the session's last-activity date (column 1), NOT today. Filename = `<date>-<session-name>.md`.

| Session | Date | Transcript jsonl (in root above) | Entry tags |
|---|---|---|---|
| magna | 2026-06-11 | `82d8ed83-ae8b-4298-bc6f-57f1bdbbad35.jsonl` | `[magna, prospeccao, backfill]` |
| smartdie-sjc | 2026-06-15 | `b0fbc287-fe66-4729-8b61-f2f146358755.jsonl` | `[smartdie, "01001", diemaster, backfill]` |
| sprint-helper | 2026-06-15 | `f7e8df09-d7da-4085-bb3a-b61274f98759.jsonl` | `[pmo, sprints, backfill]` |
| aeroporto | 2026-06-22 | `e6161d0a-1d9e-47ef-85ca-38d4303a8d4c.jsonl` | `[pessoal, aeroporto, backfill]` |
| arrendamento | 2026-06-22 | `5e63e0ef-5b75-43d8-9250-9e1151155476.jsonl` | `[pessoal, arrendamento, backfill]` |
| emails | 2026-06-22 | `5ebdc604-8914-456d-af71-6f17506020e0.jsonl` | `[pmo, emails, backfill]` |
| supplypower | 2026-06-25 | `8f6eb5a2-201e-4d7e-82ad-d069ce1dba0b.jsonl` | `[gm, supplypower, backfill]` |
| amendoim | 2026-06-29 | `92e1ba28-8b49-48cc-baa0-fb67a569d54b.jsonl` | `[pessoal, amendoim, backfill]` |
| mercedes-vk | 2026-06-29 | `86b22ce2-efaf-43a1-819d-55855ea1d015.jsonl` | `[mercedes-vk, "03904", visionking, backfill]` |
| arcelor-data | 2026-07-06 | `88ff9fd8-93ad-474a-99fe-1cbb13a4d60d.jsonl` | `[dados-producao, arcelor, "03002", backfill]` |
| jarvis | 2026-07-06 | `ac427d28-5020-495a-8b18-3850fe8de118.jsonl` | `[jarvis, backfill]` |
| pmo-build | 2026-07-06 | `8ac292b1-3b1b-42b9-8a0d-e4b0ab0ba6d8.jsonl` | `[pmo, backfill]` |
| sparktest | 2026-07-07 | `ea1691f9-77bd-4d57-a201-73f2f054bde1.jsonl` | `[sparktest, "03011", visionking, backfill]` |
| arcelor-vpn | 2026-07-08 | `9db425a5-4ac4-402f-9d77-f79ee6f9f59d.jsonl` | `[vk-producao, arcelor, "03002", backfill]` |
| blender | 2026-07-08 | `15a534e1-804e-495e-a2de-43953eb5874e.jsonl` | `[blender, backfill]` |
| iris-scds | 2026-07-08 | `b08ead92-1225-4586-a8e5-a9ae0db1ba10.jsonl` | `[iris-scds, "03007", visionking, automacao, backfill]` |
| rh | 2026-07-08 | `2ffaeab2-89fd-4579-b5d1-007583a92dda.jsonl` | `[administrativo, rh, backfill]` |
| sealer | 2026-07-08 | `52f7abd7-a450-48ee-ab52-2982fe2c3613.jsonl` | `[sealer, "03008", visionking, automacao, backfill]` |
| stellantis | 2026-07-08 | `3447dc83-9d6d-495f-9b9e-a36aa6f0b9dd.jsonl` | `[stellantis, "03010", visionking, backfill]` |

Excluded: `okf` (this session — exemplar written first-hand in Task 1) and the accidental rename `2. yes, do one more round (Branch)` (`8d65d0ef-…`, not a topic).

- [ ] **Step 1: Dispatch one distillation subagent per session (batch in groups of ~5)**

Per row, dispatch a `general-purpose` subagent with EXACTLY this prompt (fill `{session}`, `{date}`, `{jsonl}`, `{tags}`):

```
Distill one Claude Code session into an OKF journal entry. MECHANICAL SOURCE
ONLY — run:
  python3 /home/teruel/JARVIS/scripts/okf/session_extract.py /home/teruel/.claude/projects/-home-teruel-JARVIS/{jsonl}
and work exclusively from that digest. NEVER read the raw jsonl.

Write /home/teruel/JARVIS/journal/{date}-{session}.md:
- YAML frontmatter: type: Session Log; title: "{date} — {session} — <resultado principal>";
  description: one sentence; tags: {tags}; timestamp: {date};
  session: {session}; language: pt-BR; add project:/product: only if the
  digest makes them obvious.
- Body PT-BR, 20-40 lines, sections: ## Feito · ## Decisões · ## Pendências · ## Links.
  Distillation of what the SESSION accomplished/decided/left pending — never a
  transcript dump, never invented facts. If the digest is thin, write a short
  honest entry; do not pad.
- ABSOLUTE RULE: no secrets, credentials, tokens, passwords, IP+password pairs.
  If the digest contains one, describe it indirectly ("credencial em ~/.secrets").
Your final message: the file path + a 1-line summary of the entry.
```

- [ ] **Step 2: Verify the batch mechanically**

```bash
ls journal/*.md | wc -l                                   # expect 22 (index, BOOT, okf + 19)
grep -L "backfill" journal/2026-0[67]-*.md | grep -v okf  # expect empty
grep -l -riE "(password|token|api[_-]?key|BEGIN [A-Z]+ PRIVATE KEY)" journal/ ; echo "scan done"  # expect only "scan done"
python3 scripts/okf/okf.py lint journal                   # expect 21/21 (100%) — index.md is reserved
```

Also spot-check each file has `timestamp:` equal to its filename date: `for f in journal/2026-*.md; do d=$(basename $f | cut -c1-10); grep -q "timestamp: $d" $f || echo "DATE MISMATCH: $f"; done` — expect no output.

- [ ] **Step 3: Sample audit (3 entries)**

For `sealer`, `arcelor-data`, and `aeroporto`: re-run the `session_extract.py` digest, read it alongside the journal entry, and confirm every claim in Feito/Decisões traces to the digest (no invention). Fix or re-dispatch any entry that fails.

- [ ] **Step 4: Regenerate the journal index**

Run: `python3 scripts/okf/okf.py index journal`
Expected: `journal/index.md` lists all 21 pages (BOOT.md + okf + 19 back-fill); the hand-written prose and existing entry descriptions are preserved.

Run: `python3 scripts/okf/okf.py lint journal`
Expected: 21/21 conformant, no warnings.

- [ ] **Step 5: Commit**

```bash
git add journal/
git commit -m "feat(okf): back-fill journal — one distilled entry per named session (19 sessions)"
```

---

### Task 6: Verification drill + publish

**Files:**
- No new files (verification + push). Possible fix-ups only.

**Interfaces:**
- Consumes: `sealer-specialist` agent (Task 3), journal corpus (Task 5).

- [ ] **Step 1: Live drill — dispatch the sealer specialist**

Dispatch a subagent with `subagent_type: "sealer-specialist"` and prompt:

```
Quais são as pendências atuais do plano Local↔Drive do projeto 03008 e qual o
status do plano? Responda apenas com base nas fontes OKF que seu boot indicar,
citando os caminhos.
```

Expected: the answer cites `journal/` entries and/or `workspaces/strokmatic/pmo/projects/03008/knowledge/drive-plan.md`, states `status: executed`, and lists real pendências (e.g. dedupe de duplicados com cedilha, reorganização analysis/). If it answers from general knowledge without citations, the boot text failed — fix the agent template (Task 2), regenerate (`--force`), re-drill.

- [ ] **Step 2: Skill smoke check**

Verify one generated skill parses: `head -5 .claude/skills/sealer/SKILL.md` shows `name: sealer` + `description:` frontmatter (same shape as `.claude/skills/jarvis/SKILL.md`).

- [ ] **Step 3: FORGE exclusion check**

```bash
grep -n "exclude='journal/'" scripts/build-forge.sh
```

Expected: the grep hits. (Full FORGE build not required — the exclusion list is declarative rsync `--exclude` flags.)

- [ ] **Step 4: Full-system lint + tests**

```bash
python3 scripts/okf/okf.py lint journal          # 21/21 (100%)
python3 scripts/okf/okf.py lint --pct-only       # overall pct — report the number (CHECK_14 input)
python3 -m pytest scripts/okf/tests/ -q          # all green
```

- [ ] **Step 5: Push (per repo convention)**

```bash
git branch --show-current                        # must print: develop
git push origin develop develop:master
git fetch origin -q && git branch -f master origin/master
```

- [ ] **Step 6: Write this block's own journal entry**

Practice what we built: append `journal/2026-07-08-okf-2.md` (suffix `-2`; the exemplar took the base name) covering the implementation block (Feito: bundle+generator+21 specialists+back-fill+drill; Pendências: whatever the drill/audit surfaced), run `python3 scripts/okf/okf.py index journal`, commit `git add journal/ && git commit -m "docs(journal): entry for the specialists implementation block"` and push as in Step 5.

---

## Self-review notes

- Spec §1 (bundle, entry format, safety rails) → Task 1. §2 (BOOT) → Task 1. §3 (wrappers, two classes, seed tables, generator) → Tasks 2–3. §4 (CLAUDE.md directive) → Task 1 Step 5. §5 rollout 1→4 → Tasks 1, 2–3, 4–5, 6. Testing section → Task 6 (drill, skill check, FORGE) + TDD in Tasks 2/4.
- Slug collisions (`pmo`, `jarvis` skills already exist) were discovered during planning and are handled via `--agent-only` + appended boot sections — this is a deviation the spec didn't anticipate; noted for the owner.
- `okf lint` does NOT count `index.md` (RESERVED), hence 2/2 in Task 1 and 21/21 after back-fill. Note: this plan file itself embeds journal-file contents in code fences whose relative links lint flags as dead from `plans/` — cosmetic warnings only, never failures (OKF permissive consumption).
