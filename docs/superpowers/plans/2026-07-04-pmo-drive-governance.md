---
type: Implementation Plan
title: PMO Local↔Drive Governance — audit tool, KB registration, 03008 pilot
description: Task-by-task plan for the drive_audit.py script, the KB processos page, and the full 03008 pilot cycle (audit → owner approval → execution).
tags: [pmo, gdrive, okf]
timestamp: 2026-07-04
status: draft
language: en
---

# PMO Local↔Drive Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the audit tooling and governance documentation, then run the full pilot cycle on project 03008 (audit → owner approval → execution).

**Architecture:** A read-only stdlib audit script classifies a project's local files against its `drive-index.json`; an agent turns that into a per-project `drive-plan.md` (draft); the owner approves; an execution agent uploads via the google-workspace MCP, untracks binaries, writes Drive-doc summaries with `resource:` links, and refreshes the index. Spec: `docs/superpowers/specs/2026-07-04-pmo-drive-governance-design.md`.

**Tech Stack:** Python 3.12 stdlib, pytest, google-workspace MCP (`upload_file`, `get_file_metadata`, `list_folder`, `create_folder`), existing `okf` CLI, `/gdrive` skill procedure.

## Global Constraints

- **Safety rules from spec §1 — non-negotiable:** (1) never delete live/tooling-dependent local data — doubtful cases default to keep-local+gitignore; (2) never update/overwrite an existing Drive file — uploads only ADD; (3) no local deletion before the upload is size-verified via `get_file_metadata`; (4) NO git history rewrite — `.gitignore` + `git rm --cached` only.
- Python stdlib only in `scripts/pmo/`. Tests run `python3 -m pytest scripts/pmo/tests/ -v` from `/home/teruel/JARVIS`.
- Three repos: JARVIS (`develop` branch — after committing, push `git push origin develop develop:master` and realign local master), knowledge-base (`master`), pmo (`master`; worktree carries ~71 unrelated dirty files + cron churn — stage by explicit pathspec ONLY, never `git add -A`/`.`/`-a`; commit with `-- <pathspec>`).
- The pmo repo remote receives cron pushes hourly — `git pull --rebase --autostash` before pushing pmo (check dirty-file overlap first: incoming cron commits touch emails/meetings/drive-index paths only).
- PT-BR for KB and PMO content; `project:` frontmatter values quoted.
- `drive-index.json` shape: `{project, name, generated, stats, sources:[{name, driveName, role, folderId, entries:[{path, type: "folder"|"file", id, mimeType, size}]}]}` — folder entries carry trailing `/` in `path` and their Drive `id`.
- Drive-index refresh = the `/gdrive <code> index` procedure in `.claude/skills/gdrive/SKILL.md` (MCP `list_folder` walk → rewrite `drive-index.json` + `drive-index.md`). There is no shell indexer script (old index headers referencing `scripts/gdrive-index.sh` are stale).

## File Structure

```
JARVIS repo:
  scripts/pmo/drive_audit.py            NEW  read-only audit CLI
  scripts/pmo/tests/conftest.py         NEW  sys.path shim (okf pattern)
  scripts/pmo/tests/test_drive_audit.py NEW
  docs/superpowers/specs/2026-02-20-gdrive-pmo-sync.md   MOD  one "Extended by" line
  docs/superpowers/specs/index.md       REGEN (okf index — governance spec missing)

knowledge-base repo:
  pmo/processos/organizacao-local-drive.md  NEW  canonical policy page
  pmo/processos/index.md                REGEN (okf index)
  index.md                              MOD  one link line (hand-edit)

pmo repo (pilot):
  projects/03008/knowledge/drive-plan.md    NEW (Task 3, draft → approved → executed)
  projects/03008/knowledge/contexto.md      MOD ("Organização de arquivos" section, Task 5)
  projects/03008/knowledge/*                MOD (Drive→bundle summaries per plan, Task 5)
  .gitignore                            MOD (untrack patterns per plan, Task 5)
```

---

### Task 1: `drive_audit.py` — classification, drive-index parsing, report

**Files:**
- Create: `scripts/pmo/drive_audit.py`
- Create: `scripts/pmo/tests/conftest.py`
- Test: `scripts/pmo/tests/test_drive_audit.py`

**Interfaces:**
- Produces: `classify(name: str) -> str` (one of document/cad/archive/media/data/text/other); `load_drive_entries(drive_index_path) -> tuple[set[str], list[str]]` (lowercase Drive file basenames, folder paths without trailing slash); `suggest_destination(cls: str, folders: list[str]) -> str` (folder path or `"?"`); `scan_project(root: Path, min_bytes: int, drive_filenames: set[str]) -> list[dict]` (keys: path, size, class, on_drive; sorted size desc); `render_markdown(rows, folders, code, min_mb) -> str`; `main(argv) -> int`. CLI: `python3 scripts/pmo/drive_audit.py <code> [--min-size MB] [--root PATH]`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/pmo/tests/conftest.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
```

Create `scripts/pmo/tests/test_drive_audit.py`:

```python
import json

from drive_audit import (classify, load_drive_entries, main, render_markdown,
                         scan_project, suggest_destination)

DRIVE_INDEX = {
    "project": "99999", "name": "Fixture", "generated": "2026-07-04T00:00:00Z",
    "stats": {"folders": 3, "files": 2, "skipped": 0},
    "sources": [{
        "name": "[99999] FIXTURE", "driveName": "[03] VISION KING",
        "role": "internal", "folderId": "rootid",
        "entries": [
            {"path": "01-Desenhos/", "type": "folder", "id": "f1",
             "mimeType": "application/vnd.google-apps.folder", "size": 0},
            {"path": "01-Desenhos/CAD/", "type": "folder", "id": "f2",
             "mimeType": "application/vnd.google-apps.folder", "size": 0},
            {"path": "02-Documentos/", "type": "folder", "id": "f3",
             "mimeType": "application/vnd.google-apps.folder", "size": 0},
            {"path": "02-Documentos/SOR-R03.docx", "type": "file", "id": "d1",
             "mimeType": "application/vnd.x", "size": 12345},
            {"path": "01-Desenhos/CAD/peca.stl", "type": "file", "id": "d2",
             "mimeType": "model/stl", "size": 999},
        ],
    }],
}


def test_classify():
    assert classify("a.pdf") == "document"
    assert classify("B.STL") == "cad"
    assert classify("x.zip") == "archive"
    assert classify("dump.sql") == "data"
    assert classify("notes.md") == "text"
    assert classify("weird.xyz") == "other"


def test_load_drive_entries(tmp_path):
    p = tmp_path / "drive-index.json"
    p.write_text(json.dumps(DRIVE_INDEX), encoding="utf-8")
    filenames, folders = load_drive_entries(p)
    assert "sor-r03.docx" in filenames and "peca.stl" in filenames
    assert "01-Desenhos/CAD" in folders and "02-Documentos" in folders


def test_suggest_destination():
    folders = ["01-Desenhos/CAD", "02-Documentos"]
    assert suggest_destination("cad", folders) == "01-Desenhos/CAD"
    assert suggest_destination("document", folders) == "02-Documentos"
    assert suggest_destination("other", folders) == "?"


def test_scan_project_flags_and_skips(tmp_path):
    root = tmp_path / "99999"
    (root / "drawings").mkdir(parents=True)
    (root / "emails").mkdir()
    (root / "knowledge").mkdir()
    big = root / "drawings" / "modelo.stl"
    big.write_bytes(b"x" * (6 * 1024 * 1024))          # 6 MB -> flagged (size)
    (root / "drawings" / "peca.stl").write_bytes(b"x")  # tiny but on Drive -> flagged
    (root / "notas.md").write_text("pequeno\n", encoding="utf-8")   # not flagged
    (root / "emails" / "big.sql").write_bytes(b"x" * (9 * 1024 * 1024))  # skipped dir
    (root / "knowledge" / "contexto.md").write_text("x", encoding="utf-8")  # skipped dir
    rows = scan_project(root, 5 * 1024 * 1024, {"peca.stl"})
    paths = [r["path"] for r in rows]
    assert paths == ["drawings/modelo.stl", "drawings/peca.stl"]  # size-desc order
    assert rows[0]["on_drive"] is False and rows[1]["on_drive"] is True
    assert rows[0]["class"] == "cad"


def test_main_end_to_end(tmp_path, capsys):
    root = tmp_path
    proj = root / "99999"
    proj.mkdir()
    (proj / "grande.zip").write_bytes(b"x" * (6 * 1024 * 1024))
    (proj / "drive-index.json").write_text(json.dumps(DRIVE_INDEX), encoding="utf-8")
    rc = main(["99999", "--root", str(root), "--min-size", "5"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "grande.zip" in out and "6.0 MB" in out
    assert "| archive |" in out


def test_main_missing_drive_index(tmp_path, capsys):
    (tmp_path / "88888").mkdir()
    rc = main(["88888", "--root", str(tmp_path)])
    assert rc == 0
    assert "sem drive-index" in capsys.readouterr().out.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest scripts/pmo/tests/ -v`
Expected: FAIL/ERROR with `ModuleNotFoundError: No module named 'drive_audit'`

- [ ] **Step 3: Implement**

Create `scripts/pmo/drive_audit.py`:

```python
#!/usr/bin/env python3
"""PMO local↔Drive audit — classify project files and flag Drive candidates.

Read-only: it recommends, never acts. Python stdlib only.
Spec: docs/superpowers/specs/2026-07-04-pmo-drive-governance-design.md
"""
import argparse
import json
import sys
from pathlib import Path

SKIP_DIRS = {"emails", "cache", "knowledge", ".git", "__pycache__", "node_modules"}
CLASS_BY_EXT = {
    "document": {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".ppt",
                 ".pptx", ".odt", ".ods"},
    "cad": {".stl", ".step", ".stp", ".iges", ".igs", ".jt", ".dxf", ".dwg",
            ".gltf", ".glb", ".obj", ".ply", ".spv", ".sldprt", ".sldasm"},
    "archive": {".zip", ".tar", ".gz", ".tgz", ".7z", ".rar"},
    "media": {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff",
              ".mp4", ".avi", ".mov", ".webm"},
    "data": {".sql", ".db", ".sqlite", ".csv", ".parquet", ".npy", ".npz",
             ".pcd", ".bag", ".pkl", ".h5"},
    "text": {".md", ".txt", ".py", ".sh", ".mjs", ".js", ".json", ".yaml",
             ".yml", ".toml", ".ini", ".log"},
}
DEST_KEYWORDS = {
    "cad": ("cad", "desenho", "drawing", "3d"),
    "document": ("document", "doc", "contrat", "oferta", "proposta", "sor",
                 "relat", "report"),
    "media": ("foto", "imag", "video", "media"),
    "archive": ("backup", "arquivo", "historic"),
    "data": ("dado", "data", "dump", "backup"),
}
DEFAULT_ROOT = Path.home() / "JARVIS/workspaces/strokmatic/pmo/projects"


def classify(name):
    ext = Path(name).suffix.lower()
    for cls, exts in CLASS_BY_EXT.items():
        if ext in exts:
            return cls
    return "other"


def load_drive_entries(drive_index_path):
    """Return (filenames, folders): lowercase basenames of Drive files and
    folder paths (no trailing slash), across all sources."""
    data = json.loads(Path(drive_index_path).read_text(encoding="utf-8"))
    filenames, folders = set(), []
    for source in data.get("sources", []):
        for entry in source.get("entries", []):
            path = entry.get("path", "")
            if entry.get("type") == "folder":
                folders.append(path.rstrip("/"))
            else:
                filenames.add(Path(path).name.lower())
    return filenames, folders


def suggest_destination(cls, folders):
    for keyword in DEST_KEYWORDS.get(cls, ()):
        for folder in folders:
            if keyword in folder.lower():
                return folder
    return "?"


def scan_project(root, min_bytes, drive_filenames):
    rows = []
    root = Path(root)
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel_parts = p.relative_to(root).parts
        if any(part in SKIP_DIRS for part in rel_parts):
            continue
        size = p.stat().st_size
        on_drive = p.name.lower() in drive_filenames
        if size >= min_bytes or on_drive:
            rows.append({"path": "/".join(rel_parts), "size": size,
                         "class": classify(p.name), "on_drive": on_drive})
    rows.sort(key=lambda r: -r["size"])
    return rows


def _mb(size):
    return f"{size / (1024 * 1024):.1f} MB"


def render_markdown(rows, folders, code, min_mb):
    lines = [f"# Auditoria local↔Drive — {code}", "",
             f"Critério: ≥ {min_mb:g} MB ou nome já presente no Drive. "
             f"Somente recomendação — nada foi movido.", "",
             "| Caminho local | Tamanho | Classe | Já no Drive? | Destino sugerido |",
             "|---|---|---|---|---|"]
    total = 0
    for r in rows:
        total += r["size"]
        dest = suggest_destination(r["class"], folders)
        lines.append(f"| {r['path']} | {_mb(r['size'])} | {r['class']} | "
                     f"{'SIM' if r['on_drive'] else 'não'} | {dest} |")
    lines += ["", f"**{len(rows)} arquivos sinalizados, {_mb(total)} no total.**"]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("code", help="5-digit project code")
    parser.add_argument("--min-size", type=float, default=5.0,
                        help="flag threshold in MB (default 5)")
    parser.add_argument("--root", default=str(DEFAULT_ROOT),
                        help="projects root directory")
    args = parser.parse_args(argv)
    project_dir = Path(args.root) / args.code
    if not project_dir.is_dir():
        print(f"projeto não encontrado: {project_dir}", file=sys.stderr)
        return 2
    drive_index = project_dir / "drive-index.json"
    if drive_index.exists():
        filenames, folders = load_drive_entries(drive_index)
    else:
        filenames, folders = set(), []
        print(f"aviso: sem drive-index em {drive_index} — sem detecção de "
              f"duplicados nem sugestão de destino\n")
    rows = scan_project(project_dir, int(args.min_size * 1024 * 1024), filenames)
    print(render_markdown(rows, folders, args.code, args.min_size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest scripts/pmo/tests/ -v`
Expected: 6 passed

- [ ] **Step 5: Smoke on the real pilot project (read-only)**

Run: `python3 scripts/pmo/drive_audit.py 03008 | head -25` and `python3 scripts/pmo/drive_audit.py 03008 | tail -2`
Expected: a populated table (03008 holds ~4 GB) and a totals line. Record the totals line in your report.

- [ ] **Step 6: Commit (JARVIS repo, develop) and push**

```bash
cd /home/teruel/JARVIS && git branch --show-current   # develop
git add scripts/pmo/
git commit -m "feat(pmo): drive_audit.py — local↔Drive audit tool (read-only, stdlib)"
git push origin develop develop:master && git fetch origin -q && git branch -f master origin/master
```

---

### Task 2: KB processos page + registrations

**Files:**
- Create (KB repo): `pmo/processos/organizacao-local-drive.md`
- Regen (KB repo): `pmo/processos/index.md`; Modify: KB root `index.md` (one line)
- Modify (JARVIS repo): `docs/superpowers/specs/2026-02-20-gdrive-pmo-sync.md` (one line); Regen: `docs/superpowers/specs/index.md`

**Interfaces:**
- Consumes: `okf index` CLI; policy table from spec §1.
- Produces: the canonical KB URL later linked from project pages: `https://github.com/teruelskm/knowledge-base/blob/master/pmo/processos/organizacao-local-drive.md`.

- [ ] **Step 1: Author the KB page**

Create `pmo/processos/organizacao-local-drive.md` in the KB repo (adapt the policy table from the spec §1 verbatim, translated to PT-BR):

```markdown
---
type: Procedure
title: Organização de Arquivos — Local ↔ Google Drive
description: Regra de audiência que define onde cada arquivo de projeto PMO vive — Drive (registro do time/cliente) ou repositório local (conhecimento e engenharia).
tags: [pmo, gdrive, processos]
timestamp: 2026-07-04
product: general
language: pt-BR
---

# Organização de Arquivos — Local ↔ Google Drive

**Princípio:** a audiência decide. O Drive é o registro documental do time e do
cliente; o repositório local (git) é o conjunto de trabalho de engenharia e IA.

## Tabela de colocação

| Classe de conteúdo | Audiência | Casa canônica | Artefato local |
|---|---|---|---|
| Documentos oficiais — SOR, contratos, ofertas, layouts, atas oficiais | Time / cliente | **Drive** (scaffold do projeto) | Resumo em `knowledge/` + link `resource:` |
| Material pesado de engenharia — CAD, dumps, nuvens de pontos, imagens, zips | Engenharia | **Drive** (pasta existente do scaffold, ex.: `01-Desenhos/CAD`) | Entrada no `drive-plan.md`; cópia de trabalho apenas se ferramentas precisarem (gitignored) |
| Conhecimento curado (`knowledge/*.md`), análises, scripts, configs, índices | Engenharia / IA | **Repositório local** | — |
| Corpora gerados — `emails/`, `meetings/`, `timeline.json`, `drive-index.*` | Engenharia / IA | **Repositório local** | — |

## Novo arquivo: onde vai?

1. O time ou o cliente precisa dele sem acesso ao repositório? → **Drive**, na
   pasta existente do scaffold do projeto.
2. É pesado (≥ 5 MB) e de engenharia? → **Drive**; mantenha cópia local somente
   se alguma ferramenta consumir o arquivo (e adicione ao `.gitignore`).
3. É texto de conhecimento, análise ou script? → **local**, e se for
   conhecimento curado, com frontmatter OKF.

## Regras de segurança (invioláveis)

- Nunca apagar dado local vivo ou consumido por ferramentas — na dúvida,
  manter local + gitignore.
- Nunca atualizar/sobrescrever arquivo existente no Drive — uploads apenas
  ADICIONAM (edições online seriam perdidas).
- Nenhum arquivo local é apagado antes do upload ser verificado por tamanho.
- Sem reescrita de histórico git — apenas `git rm --cached` + `.gitignore`.

## O plano por projeto (`drive-plan.md`)

Cada projeto auditado ganha `projects/<código>/knowledge/drive-plan.md`
(`type: Drive Plan`, `status: draft → approved → executed`) com as seções:
Mover para Drive · Untrack/gitignore · Drive → bundle · Duplicados · Pendências.
Nada é movido sem o plano aprovado pelo responsável.

## Referências

- Spec de engenharia: [pmo-drive-governance](https://github.com/pteru/JARVIS/blob/master/docs/superpowers/specs/2026-07-04-pmo-drive-governance-design.md)
- Integração Drive↔PMO: [gdrive-pmo-sync](https://github.com/pteru/JARVIS/blob/master/docs/superpowers/specs/2026-02-20-gdrive-pmo-sync.md)
- Skill de navegação/índice: `/gdrive <código>` e `/gdrive <código> index`
```

- [ ] **Step 2: Index + root link + lint (KB repo)**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/knowledge-base
python3 /home/teruel/JARVIS/scripts/okf/okf.py index pmo/processos
```
Hand-edit the KB root `index.md`: find the PMO/processos section and add
`- [Organização Local↔Drive](pmo/processos/organizacao-local-drive.md) — onde cada arquivo de projeto vive` (match the file's existing list style).
Then: `python3 /home/teruel/JARVIS/scripts/okf/okf.py lint knowledge-base` — 100%, warnings unchanged (20 pre-existing).

- [ ] **Step 3: Commit + push (KB repo)**

```bash
git add pmo/processos/ index.md && git commit -m "feat(processos): página organização local↔Drive (governança PMO)"
git push origin master
```

- [ ] **Step 4: Back-reference + spec index (JARVIS repo)**

In `docs/superpowers/specs/2026-02-20-gdrive-pmo-sync.md`, directly under the title/header block, add:

```markdown
> **Extended by:** [2026-07-04-pmo-drive-governance-design.md](2026-07-04-pmo-drive-governance-design.md) — audience-based placement policy and per-project audit workflow.
```

```bash
cd /home/teruel/JARVIS
python3 scripts/okf/okf.py index docs/superpowers/specs   # picks up the governance spec entry
python3 scripts/okf/okf.py lint engineering-docs | head -3
git add docs/superpowers/specs/2026-02-20-gdrive-pmo-sync.md docs/superpowers/specs/index.md
git commit -m "docs(gdrive): back-reference governance spec; refresh specs index"
git push origin develop develop:master && git fetch origin -q && git branch -f master origin/master
```

---

### Task 3: 03008 pilot — audit → `drive-plan.md` (draft)

**Files (pmo repo):**
- Create: `projects/03008/knowledge/drive-plan.md`
- Regen: `projects/03008/knowledge/index.md` (via `okf index`, preserves hand lines)

**Interfaces:**
- Consumes: `drive_audit.py` (Task 1); `projects/03008/drive-index.{json,md}`; the 03008 knowledge layer.
- Produces: the draft plan the owner will approve; Task 5 executes exactly what this plan says.

- [ ] **Step 1: Run the audit and study the scaffold**

```bash
python3 /home/teruel/JARVIS/scripts/pmo/drive_audit.py 03008 > /tmp/audit-03008.md
```
Read `/tmp/audit-03008.md`, the Drive scaffold tree (`projects/03008/drive-index.md` — sections `01-Desenhos/CAD` etc.), and the 03008 knowledge pages.

- [ ] **Step 2: Author `drive-plan.md`**

Frontmatter exactly:

```yaml
---
type: Drive Plan
title: 03008 — Plano Local↔Drive
description: Proposta de movimentação de arquivos locais para o Drive e absorção de documentos do Drive no bundle.
tags: [visionking, gdrive, "03008"]
timestamp: <today>
project: "03008"
product: visionking
language: pt-BR
status: draft
---
```

Body sections (PT-BR), each a table or list with EVERY row grounded in the audit output or the drive-index:
1. **Mover para Drive** — columns: caminho local · tamanho · pasta Drive destino (an EXISTING scaffold path from drive-index; propose a new subfolder only if nothing fits, marked `(nova)`) · manter cópia local? (sim = tooling needs it; justify) · justificativa.
2. **Untrack/gitignore** — exact `.gitignore` patterns (project-scoped, e.g. `projects/03008/sealer_provisioning_input/**`) and the `git rm --cached` path list.
3. **Drive → bundle** — Drive docs worth absorbing (SOR, official PDFs found in the drive-index): doc name/path · target knowledge page (existing page or a specific new one) · one line of what to summarize · the Drive URL (`https://drive.google.com/file/d/<id>` from drive-index entry ids) for the `resource:`/body link.
4. **Duplicados** — local files whose names already exist on Drive (audit `SIM` column): propose delete-local or keep, per the safety rules (default keep if any doubt).
5. **Pendências** — anything requiring owner input (e.g. live `analysis_cuv/` data: recommend keep-local+gitignore per safety rule 1 — the trimesh/centerline work consumes it).

- [ ] **Step 3: Index + lint + commit (pmo repo, scoped)**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
python3 /home/teruel/JARVIS/scripts/okf/okf.py index projects/03008/knowledge
python3 /home/teruel/JARVIS/scripts/okf/okf.py lint pmo --strict; echo $?   # exit 0
git add projects/03008/knowledge/ && git commit -m "feat(okf): 03008 drive-plan (draft) — auditoria local↔Drive" -- projects/03008/knowledge/
```

- [ ] **Step 4: Report the plan's headline numbers** (files/GB proposed to move, docs to absorb) back to the controller for the owner's review.

---

### Task 4: OWNER APPROVAL GATE — do not automate past this line

- [ ] **Step 1: STOP.** The controller presents the 03008 `drive-plan.md` to the owner (Pedro). The owner edits/annotates as needed and approves. Approval = the owner says so in session; the executor of Task 5 then flips `status: draft` → `status: approved` in the same commit that begins execution, or the owner edits it himself.
- [ ] **Step 2:** Only after explicit owner approval, dispatch Task 5. If the owner requests changes, loop Task 3's Step 2–3 with a fix dispatch.

---

### Task 5: 03008 pilot — execution

**Files (pmo repo):**
- Modify: `projects/03008/knowledge/drive-plan.md` (status), `contexto.md` (+section), pages named in the plan's Drive→bundle table, `.gitignore` (repo root), tracked-binary removals per plan.

**Interfaces:**
- Consumes: the APPROVED drive-plan; google-workspace MCP tools (load via ToolSearch: `select:mcp__google-workspace__upload_file,mcp__google-workspace__get_file_metadata,mcp__google-workspace__list_folder,mcp__google-workspace__create_folder`); folder Drive ids from `drive-index.json` entries; `/gdrive` skill index procedure (`.claude/skills/gdrive/SKILL.md`).
- Produces: executed pilot; the template all follow-on projects repeat.

- [ ] **Step 1: Preconditions**

Verify `drive-plan.md` is approved (owner said so / `status: approved`). Record `du -sh projects/03008` and `git -C . status --porcelain | wc -l` baselines.

- [ ] **Step 2: Uploads (plan section 1, "Mover para Drive")**

For each row: resolve the destination folder's Drive `id` from `drive-index.json` (`entries[].path == destino + "/"`); `upload_file` the local file into it (`create_folder` first ONLY where the plan marked `(nova)`); then `get_file_metadata` on the returned file id and compare `size` to the local byte size. Mismatch or upload error → mark the row FAILED in your report, leave the local file fully intact, continue with the rest. Never re-upload over an existing Drive file: if a same-name file already exists in the destination (plan section 4 should have caught it), skip and log.

- [ ] **Step 3: Untrack + local deletions (plan section 2; only verified rows)**

Append the plan's patterns to the pmo repo root `.gitignore`; `git rm --cached -- <paths>` for tracked items; `rm` local copies ONLY for rows where the approved plan says manter cópia local? = não AND Step 2 verified the upload. Commit scoped:
```bash
git add .gitignore && git commit -m "chore(03008): untrack binários movidos ao Drive (plano aprovado)" -- .gitignore <the git-rm'd paths>
```

- [ ] **Step 4: Drive → bundle summaries (plan section 3)**

For each row: read the doc's substance if locally available, else summarize from the plan's description + drive-index metadata (do NOT download unless the plan says to); update the target knowledge page — add the summary content and `resource: <drive url>` frontmatter (single canonical asset) or a body link (multiple). Keep pages within OKF conventions.

- [ ] **Step 5: Refresh drive-index**

Follow `.claude/skills/gdrive/SKILL.md` index mode for 03008: walk the Drive folder via `list_folder` recursion, rewrite `projects/03008/drive-index.json` + `drive-index.md`. The new uploads must appear; record the new `stats` line.

- [ ] **Step 6: Contexto section + plan status**

Add to `projects/03008/knowledge/contexto.md`:

```markdown
## Organização de arquivos

Material pesado e documentos oficiais vivem no Drive
([scaffold do projeto](https://drive.google.com/drive/folders/1Fd7UL8TBGZPbF0-x4Ub-DSUu3WhqU2UA));
o repositório mantém conhecimento curado, análises e índices. Plano executado:
[drive-plan](drive-plan.md). Regra geral:
[Organização Local↔Drive](https://github.com/teruelskm/knowledge-base/blob/master/pmo/processos/organizacao-local-drive.md).
```

Flip `drive-plan.md` to `status: executed` and fill an `## Execução` footer: date, files moved, GB freed, failures if any.

- [ ] **Step 7: Verify + commit + push (pmo repo)**

```bash
python3 /home/teruel/JARVIS/scripts/okf/okf.py lint pmo --strict; echo $?   # exit 0
du -sh projects/03008    # record delta vs Step 1
git add projects/03008/knowledge/ projects/03008/drive-index.json projects/03008/drive-index.md
git commit -m "feat(okf): 03008 drive-plan executado — uploads verificados, resumos com resource:" -- projects/03008/knowledge/ projects/03008/drive-index.json projects/03008/drive-index.md
git pull --rebase --autostash && git push origin master
```
Report: rows executed/failed, du before/after, lint result, new drive-index stats.

---

## Follow-on (NOT tasks of this plan)

01001 → 02008 → 03010 → 03002 repeat Tasks 3–5 per project (one audit dispatch, owner gate, one execution dispatch). 01001 is conservative-mode: its dumps/models feed live reprocessing — default keep-local+gitignore. Remaining 22 projects ratchet on touch.
