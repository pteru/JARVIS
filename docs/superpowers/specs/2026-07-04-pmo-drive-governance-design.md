---
type: Design Spec
title: PMO Local↔Drive Governance
description: Audience-based placement policy for PMO project files, per-project audit/execution workflow, and registration of the convention in the OKF knowledge system.
tags: [pmo, gdrive, okf, governance]
timestamp: 2026-07-04
product: general
status: draft
language: en
---

# PMO Local↔Drive Governance

**Date:** 2026-07-04
**Status:** Draft — awaiting review
**Extends:** [2026-02-20-gdrive-pmo-sync.md](2026-02-20-gdrive-pmo-sync.md) (cloud-first Drive integration: MCP tools, drive-index, `/gdrive` skills — all live)
**Related:** [2026-07-04-okf-adoption-design.md](2026-07-04-okf-adoption-design.md) (knowledge layers, `resource:` convention)

## Problem

PMO project folders mix two things with no stated rule: the team/client documentary
record and the engineering/AI working set. Consequences observed:

- The PMO git repo carries **~17 GB of binaries** (01001: 5.7 GB, 03008: 4.0 GB,
  02008: 3.8 GB, 03010: 2.8 GB, 03002: 930 MB) — CAD, dumps, PDFs, zips in git
  history that serve no repo consumer, slowing clones and the hourly cron pushes.
- Load-bearing documents live on Drive (SORs, contracts, layouts) but the OKF
  knowledge layers were authored almost entirely from local material; the
  `resource:` frontmatter field designed for canonical Drive URIs is used by zero
  of the fifteen authored pages.
- Nothing tells a colleague (or an agent) where a new file belongs.

## Decision summary

- **Audience-based placement policy** (§1): Drive is the team/client-facing record;
  local git is the engineering/AI working set.
- **Heavy engineering material goes to Drive too**, mapped into each project's
  **existing Drive folder scaffold** (learned from its drive-index tree) — never a
  parallel taxonomy.
- **Drive → bundle inclusion is summarize + `resource:` link** — substance of
  load-bearing Drive docs summarized into `knowledge/` pages; no local mirroring
  (cloud-first, per the gdrive spec).
- **Per-project audit → report → owner approval → execution** (§2–3). Nothing
  moves unapproved.
- **Registration** (§4): canonical KB page in `pmo/processos/` + a short
  "Organização de arquivos" section per project contexto; this spec is the
  engineering SSOT.
- Approach chosen: **policy + agent-driven audits** (A). Rejected: sync-manifest
  tooling (B — deferred as a possible future maintenance tool, per owner) and
  policy-only (C — unenforced policy drifts; 17 GB stays).

## 1. Placement policy

| Content class | Audience | Canonical home | Local artifact |
|---|---|---|---|
| Official documents — SOR, contracts, offers, layouts, official minutes, client deliverables | Team / client | **Drive** (project scaffold) | Summary in `knowledge/` + `resource:` link |
| Heavy engineering material — CAD, DB dumps, point clouds, image/video sets, archives | Engineering | **Drive** (existing scaffold folder, e.g. `01-Desenhos/CAD`) | Entry in `drive-plan.md`; working copy only when tooling needs it, gitignored |
| Curated knowledge (`knowledge/*.md`), analyses (.md), scripts, small configs, indexes | Engineering / AI | **Local git** | — |
| Generated corpora — `emails/`, `meetings/`, `timeline.json`, `technical_report.md`, `drive-index.*` | Engineering / AI | **Local git** | — |

**Safety rules (non-negotiable):**

1. **Never delete local data that is live or tooling-dependent.** Default for
   doubtful cases: keep local + gitignore (e.g. 01001 reprocessing dumps). The
   audit classifies conservatively; deletion requires the plan to say so explicitly
   and the owner to approve it.
2. **Never update/overwrite an existing Drive file.** Uploads only ADD new files
   (lesson: Drive update wipes online edits). Reorganizing Drive-native content is
   out of scope.
3. **No local file is deleted before its upload is verified** (size match via
   `get_file_metadata`).
4. Git **history rewrite is out of scope** — untracking (`git rm --cached` +
   `.gitignore`) only. A future `git filter-repo` shrink is its own decision.

## 2. Audit method

### 2.1 Audit script

`scripts/pmo/drive_audit.py` — Python stdlib only, read-only, one project per run:

- Walks `projects/<code>/` (skipping `emails/`, `cache/`, `knowledge/`).
- Classifies each file: size (flag ≥ 5 MB), extension class (document / CAD /
  archive / media / data / text), and location.
- Parses the project's `drive-index.json` and flags **name matches** (candidate
  duplicates already on Drive).
- Suggests a destination folder per flagged file by matching against the Drive
  scaffold tree (best-effort string match; "?" when no clear match).
- Emits a markdown candidate table to stdout (path, size, class, on-Drive?,
  suggested destination). Exit 0 always; it recommends, never acts.

CLI: `python3 scripts/pmo/drive_audit.py <code> [--min-size MB] [--root PATH]`.

### 2.2 Audit agent → `drive-plan.md`

An agent takes the script output + the drive-index tree + the project's knowledge
layer and authors `projects/<code>/knowledge/drive-plan.md`:

```yaml
---
type: Drive Plan
title: 03008 — Plano Local↔Drive
description: Proposta de movimentação de arquivos e absorção de documentos do Drive.
project: "03008"
product: visionking
language: pt-BR
timestamp: 2026-07-XX
status: draft        # draft → approved → executed
---
```

Sections (PT-BR): **Mover para Drive** (table: local path → existing Drive folder →
manter cópia local? → justificativa) · **Untrack/gitignore** (exact patterns/paths)
· **Drive → bundle** (Drive doc → target knowledge page → one-line what to
summarize) · **Duplicados** (already on Drive; propose local deletion or keep) ·
**Pendências** (anything needing owner input).

The plan is committed with `status: draft`. It counts as a knowledge page
(conformant frontmatter) and appears in the project's `knowledge/index.md`.

## 3. Execution flow

Gate: the owner flips a plan to approved (edits `status:` or says so in session).
Then one execution agent per project:

1. **Uploads** each "Mover para Drive" item via the google-workspace MCP
   (`upload_file` into the mapped folder; `create_folder` only if the plan says a
   scaffold subfolder is missing and names it).
2. **Verifies** each upload (size via `get_file_metadata`) — only then acts locally.
3. **Untracks**: adds `.gitignore` patterns, `git rm --cached` the tracked
   binaries; deletes local copies ONLY where the approved plan's "manter cópia
   local?" says no.
4. **Drive → bundle**: writes/updates the listed knowledge pages — summary of each
   doc's substance + `resource:` frontmatter (single canonical asset) or body links
   (multiple).
5. **Refreshes** the drive-index (`scripts/gdrive-index.sh` / `/gdrive <code>
   index` equivalent) so the new uploads are indexed.
6. **Updates** `contexto.md` with the "Organização de arquivos" section (§4) and
   flips the plan to `status: executed`.
7. **Verifies**: `okf lint pmo --strict` exit 0; `du` before/after reported;
   `git status` shows only intended changes; scoped commit (pathspec, never
   `git add -A` — the repo carries unrelated dirty files and cron churn).

## 4. Registration in the knowledge system

- **KB canonical page:** `knowledge-base/pmo/processos/organizacao-local-drive.md`
  (PT-BR, `type: Procedure`): the §1 policy table, a short "novo arquivo: onde
  vai?" decision flow, how to read a `drive-plan.md`, the safety rules, links to
  this spec and the `/gdrive` skill. Indexed via `okf index pmo/processos`; linked
  from the KB root index (hand-edit, one line).
- **Per-project:** each audited project's `contexto.md` gains
  `## Organização de arquivos` (4–6 lines): what stays local, the Drive scaffold
  root (link), pointer to `drive-plan.md` and to the KB page. Added during that
  project's audit — not a separate campaign.
- **Spec SSOT:** this document; the 2026-02-20 gdrive spec gains one "Extended by"
  back-reference line.

## 5. Rollout order

1. Audit script + tests, KB processos page, gdrive-spec back-reference.
2. **Pilot: 03008** (freshest drive-index, 4 GB, layer authored today) — full
   cycle: audit → plan → approval → execution.
3. By weight: 01001 (5.7 GB; live reprocessing data — conservative), 02008
   (3.8 GB), 03010 (2.8 GB), 03002 (930 MB).
4. Remaining 22 projects: ratchet — audited when next touched.

Each project is one audit dispatch + one execution dispatch, each review-gated.

## Out of scope

- Git history rewrite (`git filter-repo`) — future decision.
- Maintenance/drift-detection tooling (deferred by owner; revisit after rollout).
- Reorganizing existing Drive scaffolds or updating Drive-native documents.
- Bulk rollout beyond the five heavy projects.
- The JARVIS-repo data dirs (e.g. `03010-cads` live data) — different repo,
  different rules.

## Testing

- `drive_audit.py`: pytest unit tests (fixture project tree + fixture
  drive-index.json): size/class flags, duplicate detection, destination
  suggestion, and the skip-list. Same test home pattern as `scripts/okf/tests/`.
- Pilot (03008): plan human-reviewed; execution invariants checked (upload
  verification before deletion, lint clean, du delta reported, cron push green on
  next cycle).
- KB page: `okf lint knowledge-base` stays 100%, no new warnings.
