# Knowledge Hub — Ingestion & Entity-Extraction Audit

**Date:** 2026-04-22
**Investigator:** Claude Opus
**Current DB state:** 140 chunks (132 PMO + 8 email) · 23 entities (22 projects + 1 person) · 1 triple.

---

## TL;DR

Two **independent** root causes conspire to produce the empty graph you're seeing:

1. **Ingestor scan paths don't match the real PMO repo layout.** 6 of the 8 ingestors find little or no data because they look for files in places they don't exist. Fixing this is mostly one-line config + scan-function changes.
2. **Entity extraction is deliberately narrow** — it looks for a handful of markdown patterns (`- **Name**`, `## Cliente`) that don't match how the PMO actually writes things (markdown tables, `### Client Name` headings). Even if (1) is fixed, the graph will still be sparse until the extractor is widened.

Non-starter bug: `config/service.json` hardcodes `project_codes_path: /home/teruel/JARVIS/config/project-codes.json` — that's a **dev-workstation path that doesn't exist on the server**, which logs `could not load project codes` on every run and is why no `product` field populates on any entity.

---

## 1. Per-ingestor status

`/opt/pmo-readonly/projects/` has **25 project directories** (01000 through 03901). Each layout is roughly:

```
03002/
├── avaliacao-fornecedor-rascunho.xlsx
├── drive-index.json        ← exists on every project
├── drive-index.md
├── emails/index.json       ← exists on most
├── meetings/               ← often empty
├── plans/
├── reference/
└── reports/
    ├── html/
    ├── md/                 ← actual PMO report files live here
    └── pdf/
```

`03007` and `03008` are the **only two projects** with top-level `overview.md`.

| Ingestor | Scan path | What exists | Chunks | Status |
|---|---|---|---|---|
| **pmo_report** | `projects/{code}/{overview,status,sprint}.md` | Only 03007/03008 have these at top level; everything else is under `reports/md/*.md` | 132 | **Broken** — misses 23 of 25 projects |
| **email** | `projects/{code}/emails/index.json` | 10 projects have this file, parser only chunks 2 | 8 | **Partial** — parser may be dropping entries with empty bodies |
| **meeting** | `projects/{code}/meetings/index.json` | Found 5, 0 chunks | 0 | **Broken** — parser fails or index.json is empty |
| **drive_index** | `projects/{code}/drive-index.json` | 22 projects have this, 0 chunks | 0 | **Broken** — parser fails (likely expects different shape than file) |
| **kb_pages** | `{pmo_root}/knowledge-base/` | `/opt/pmo-readonly/knowledge-base/` **doesn't exist** | 0 | **Broken** — config.`kb_repos` array points to `/opt/pmo-readonly/repos/{sf,dm,vk}/` which **also don't exist** and isn't read by this ingestor |
| **clickup_tasks** | `data/clickup/*.json` | Dir doesn't exist | 0 | **Broken** — no upstream producer ever writes here |
| **chat_facts** | `data/chat-facts/*.jsonl` | Dir doesn't exist | 0 | **Broken** — no upstream producer ever writes here |

Why PMO produced 132 chunks from only 2 files: those are rich overview.mds with many `##` sections, and `chunkByHeading` emits one chunk per section. Expected behavior, just starved of inputs.

---

## 2. Config correctness issues

File: `/opt/jarvis-knowledge-hub/config/service.json`

| Field | Value | Reality |
|---|---|---|
| `project_codes_path` | `/home/teruel/JARVIS/config/project-codes.json` | Dev path; **doesn't exist on server** — logs `could not load project codes: ENOENT` on every ingest run. Silent-fails to empty dict → no `product` field ever set on entities |
| `pmo_root` | `/opt/pmo-readonly` | ✅ exists and has real data |
| `pmo_git.clone_path` | `/opt/pmo-knowledge-hub` | **Empty directory** — looks like the initial clone never completed. May be unused by ingest (ingest reads from `pmo_root`, not the clone) |
| `sources.kb_pages.path` | `knowledge-base` (resolved against `pmo_root`) | `/opt/pmo-readonly/knowledge-base/` **doesn't exist** |
| `kb_repos[].path` | `/opt/pmo-readonly/repos/{sf,dm,vk}/` | **Directories don't exist**; and the ingestor doesn't read this array anyway (uses `sources.kb_pages.path` instead) |
| `sources.clickup_tasks.state_dir` | `data/clickup` (relative → `/opt/jarvis-knowledge-hub/data/clickup`) | **Doesn't exist** |
| `sources.chat_facts.facts_dir` | `data/chat-facts` | **Doesn't exist** |

---

## 3. Extractor quality

Even with every ingestor fixed, the graph will stay thin until the entity extractor is widened. Sample of what the real data looks like vs. what the parser matches:

From `/opt/pmo-readonly/projects/03007/overview.md`:
```markdown
### General Motors — São Caetano do Sul

| Nome | Função | Responsabilidade |
|------|--------|------------------|
| Sebastian Cruz Altamirano | Líder de Projeto | Coordenação geral GM, Design Reviews |
| Renan Rebolho | Engenheiro de Manufatura | ... |
...

### Strokmatic

| Nome | Função | Responsabilidade |
|------|--------|------------------|
| Pedro Teruel | Gerente de Projeto | ... |
| Patrick Pacheco | Comercial / Liaison | ... |
...
```

What the parser looks for (from `pmo-reports.mjs`):

- **Known-people list** (`config.known_people[]`) — **empty** at runtime, so matches nothing
- **`- **Name**` pattern** — doesn't hit markdown-table rows
- **`## Cliente` / `Cliente:` pattern** — overview uses `### General Motors`, `### NXG Laser Technologies` instead — **no match**

Result: the single `FR` person found is almost certainly from some stray `- **FR**` bullet somewhere (abbreviation in a sprint note or similar). The dozens of real stakeholders go completely uningested.

### What's missing

| Entity type | Available in docs | Extracted today |
|---|---|---|
| People | Dozens per project (in tables) | 1 (FR) |
| Companies/clients | Present (`### GM`, `### NXG`, etc.) | 0 |
| Equipment | Present (IR N15 cameras, IR N6 cameras, Armor Block, etc.) | 0 |
| Services/contracts | Present (contracts, SORP dates, SOW) | 0 |
| Technical concepts | Primer inspection, OCR, IA pipelines | 0 |

### Predicate vocabulary

Only 2 predicates exist in code: `works_on` and `client_of`. Realistic PMO graph needs many more:
`reports_to`, `located_at`, `manufactures`, `supplies`, `used_in`, `blocks`, `mentions`, `attended`, `scheduled_for`, `commits_to`, `funded_by`, etc.

---

## 4. Remediation plan (estimated effort)

### Phase A — unblock the ingestors (half-day, mostly plumbing)

1. **Fix `project_codes_path`** — symlink or copy `/home/teruel/JARVIS/config/project-codes.json` to a server-resident path, or inline it into `service.json` as an embedded object. _Trivial, high impact._
2. **Rewrite `pmo-reports.scan()`** to walk `projects/{code}/reports/md/**.md` instead of only top-level three files.
3. **Set up `/opt/pmo-readonly/knowledge-base/`** — symlink to the real repo (`workspaces/strokmatic/knowledge-base/` rsync'd over, or git clone `teruelskm/knowledge-base` server-side read-only).
4. **Decide the fate of `data/clickup/` and `data/chat-facts/`** — either wire an upstream producer (nightly ClickUp dump, chat-fact batcher) or mark those ingestors disabled until there's data.
5. **Debug why `drive_index` and `meeting` produce 0 chunks** despite finding sources — likely a `parse()` shape mismatch; probably a 10-line fix per ingestor.

Estimated: 4 hours, most of it verification runs.

### Phase B — widen the extractor (1-2 days, real work)

1. **Markdown-table person extraction** — parse `| Name | Role | ...|` rows under `###` headings that name a company or team; emit person entities with role + company properties.
2. **Company/org extraction** — treat each `###` subheading in "Stakeholders" sections as a company entity; link project → company → people.
3. **Predicate expansion** — introduce `reports_to`, `located_at`, `manages`, `works_for`, `supplies_to`, `contracted_by`.
4. **Optional NER pass** — run a small Portuguese NER model (spaCy pt_core_news_md or equivalent) over chunk text to catch free-form mentions of people, orgs, places that aren't in tables. 384-dim embeddings are already loaded, so this stays offline.

Estimated: 1 full day of coding + eval passes, then another half-day tuning for precision/recall.

### Phase C — graph UX now that it has content (follow-up)

- Default to "show only nodes with ≥1 relation" so orphans don't pile up at origin.
- Seeded/spread layout so that even orphans fan out (`forceX`, `forceY` by cluster).
- Category-based coloring and legend.

Nothing to do here until A+B produce real data.

---

## 5. Suggested ordering

If you want visible impact fast:

1. Fix `project_codes_path` (5 min).
2. Rewrite `pmo_reports.scan()` to walk `reports/md/**.md` — suddenly ~25× more source files for the same parser.
3. Widen extractor to parse markdown tables (couple of hours).
4. Ingestors that depend on external producers (clickup_tasks, chat_facts) — defer; they don't block the graph utility you want today.

After steps 1-3, expect to go from `23 entities / 1 triple` to something like `150-300 entities / 400-800 triples`. After a NER pass (step B.4), probably another 2-3× more.

---

## 6. What this audit does NOT cover

- No code has been modified during this investigation. All findings are from reading config, DB state, and ingestor code. The service is running exactly as it was before I started looking.
- Did not exercise `ingest` manually — same data is still live.
- Did not look at `chat_facts` and `clickup_tasks` upstream producers (would need to check if those producers exist in other services like `context-refresh` or `meeting-assistant`).
