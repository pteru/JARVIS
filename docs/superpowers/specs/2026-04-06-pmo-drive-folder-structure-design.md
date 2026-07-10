---
type: Design Spec
title: Design: PMO Local ↔ Drive Folder Structure
description: Standardize the local PMO project folder structure and its relationship with remote Google Drive project folders. Adopt a cloud-first, hybrid approach: Drive and Gmail are the source of truth for a...
timestamp: 2026-04-06
---

# Design: PMO Local ↔ Drive Folder Structure

**Date:** 2026-04-06
**Status:** Approved
**Author:** JARVIS + Pedro

## Summary

Standardize the local PMO project folder structure and its relationship with remote Google Drive project folders. Adopt a cloud-first, hybrid approach: Drive and Gmail are the source of truth for artifacts and communications; local folders hold metadata indexes, authored content (reports, plans), and an on-demand cache for downloaded files. Restructure the PMO repo to be self-contained by moving `project-codes.json` inside it and nesting project folders under `projects/`.

## Motivation

Currently, local PMO folders have inconsistent structures (01001 is rich, 02001 is nearly empty, 03008 has its own conventions). Drive folders vary even more — 03008 follows a clean numbered convention while 01001 is organic and messy. There's no defined correspondence between local and remote, and no standard for what lives where. This makes it hard to onboard new projects, automate workflows, or know where to find things.

## PMO Repo Restructuring

### Before

```
pmo/
├── 01001/
├── 01002/
├── ...
├── 03010/
├── reports/
└── tools/
```

`project-codes.json` lives at `JARVIS/config/orchestrator/project-codes.json`.

### After

```
pmo/
├── config/
│   └── project-codes.json      # ← moved from JARVIS config/orchestrator/
├── projects/
│   ├── 01001/
│   ├── 01002/
│   ├── ...
│   └── 03010/
├── reports/                    # Cross-project reports
└── tools/                      # PMO utilities
```

A symlink at `JARVIS/config/orchestrator/project-codes.json` → `../../workspaces/strokmatic/pmo/config/project-codes.json` preserves backward compatibility for all existing consumers (email-analyzer, /pmo skill, /gdrive skill, scripts). Consumers are updated to the new path over time; symlink removed when no references remain.

## Standardized Local Project Skeleton

Every project at `pmo/projects/<code>/` follows this structure:

```
pmo/projects/<code>/
├── .claude/
│   └── context.md              # Project context for /pmo skill
├── drive-index.json            # Cached Drive folder metadata (auto-generated)
├── emails/
│   ├── index.json              # Email metadata index (sender, subject, date, thread ID)
│   └── cache/                  # On-demand full emails + attachments (gitignored)
├── meetings/                   # Meeting notes, transcripts (.md, .txt)
├── reports/
│   ├── md/                     # Markdown source (authored locally)
│   └── pdf/                    # Exported PDFs (generated via md-to-pdf)
├── reference/                  # Locally-authored reference docs, analysis notes
├── cache/                      # On-demand Drive downloads (gitignored)
│   └── <mirrors Drive path>/   # e.g. cache/01-Desenhos/CAD/file.stp
├── plans/                      # (optional) Local planning/analysis docs
├── drawings/                   # (optional) Locally-authored CAD/engineering files
└── data/                       # (optional) Datasets, CSVs, notebooks (gitignored)
```

### Rules

- `drive-index.json` and `emails/index.json` are metadata-only indexes — no file content stored
- `cache/`, `data/`, and `emails/cache/` are gitignored entirely
- Everything else is committed to the PMO git repo (`teruelskm/pmo`)
- New projects get this skeleton created automatically by `/gdrive-setup`
- Existing projects are migrated to this structure (separate effort per project)

## Standardized Remote Drive Structure

03008 (Hyundai Sealer) is the gold standard. New projects follow this numbered convention:

```
[<code>] Project Name/
├── 01-Desenhos/                # CAD, layouts, simulations
│   ├── CAD/                    # 3D models, assemblies
│   ├── Layout-Celula/          # Cell layout drawings
│   └── Simulação/              # FEA, motion studies
├── 02-Especificacoes/          # Requirements, specs, technical docs
│   ├── Cronoanálise/           # Cycle time analysis
│   └── Documentacao-Tecnica/   # Technical docs by category
├── 03-Orcamentos/              # Quotes, organized by vendor subfolder
├── 04-Comunicacao/             # Presentations (kickoffs, follow-ups)
├── 05-Relatorios/              # Reports, simulation results
├── 06-Administrativo/          # POs, contracts, PGRs
├── 07-Referencia/              # Vendor catalogs, defect books, standards
└── DATASHEET/                  # Camera/sensor datasheets (product-specific)
```

Existing projects will be migrated to this convention in a separate effort.

## Local ↔ Remote Correspondence

| Local folder | Remote Drive equivalent | Data flow |
|---|---|---|
| `reports/md/` + `reports/pdf/` | `05-Relatorios/` | **Upload:** author locally, export PDF, push both to Drive |
| `reference/` | `07-Referencia/` + `DATASHEET/` | **Download:** fetch from Drive to `cache/` on demand |
| `drawings/` | `01-Desenhos/` | **Download:** fetch from Drive to `cache/` on demand |
| `meetings/` | `04-Comunicacao/` | **Upload:** optionally push meeting notes/presentations to Drive |
| `emails/` | — | **Gmail API only** — not stored in Drive |
| `plans/` | — | **Local only** — not uploaded to Drive |
| `cache/` | mirrors Drive paths | **Disposable** — on-demand downloads, gitignored |
| `drive-index.json` | — | **Metadata** — generated by `/gdrive index` |

## File Workflows

### Authoring (Local → Remote)

1. Author report in `reports/md/report-name.md`
2. Export: `/md-to-pdf` generates `reports/pdf/report-name.pdf`
3. Upload: `/gdrive upload reports/pdf/report-name.pdf` pushes to `05-Relatorios/`
4. For `.md` uploads: `/gdrive upload` auto-detects `.md`, runs `md-to-pdf`, uploads both `.md` + `.pdf` to Drive

### Research (Remote → Local)

1. Browse: `/gdrive browse` or consult `drive-index.json`
2. Google Docs/Sheets/Slides: `/gdrive read` live via MCP (no download)
3. Binary files (CAD, PDF, XLSX): `/gdrive download` saves to `cache/<Drive-path>/filename`
4. Analyze locally, discard cache when done

### Email Research

1. Metadata always available in `emails/index.json`
2. Full email body/attachments fetched on demand via Gmail API
3. Fetched content cached in `emails/cache/` (gitignored, disposable)
4. Current email-organizer continues working as-is; refactor to index-only is a future task

## Markdown Rendering in Drive

**Convention:** Every `.md` file uploaded to Drive gets a `.pdf` companion in the same folder.

- PDF is the reliable rendered version (for clients, PMs, anyone)
- `.md` is the editable source (for engineers, Claude)
- `/gdrive upload` handles the dual upload automatically for `.md` files

**Add-on:** Install [Markdown Viewer and Editor](https://workspace.google.com/marketplace/app/markdown_viewer_and_editor/446183214552) org-wide in Google Workspace. Provides quick `.md` preview directly in Drive without needing the PDF. Nice-to-have convenience, not a requirement.

## Metadata Indexes

### `drive-index.json`

- Generated by `/gdrive index`
- Contains: folder tree, file names, mimeTypes, sizes, modifiedTime, IDs
- Persistent — never deleted or invalidated automatically
- 24h TTL as soft suggestion: when `/pmo` loads and index is older than 24h, it suggests refreshing ("drive-index.json is 3 days old — consider running `/gdrive index`") but always uses the existing data
- Committed to git (lightweight, serves as searchable inventory)

### `emails/index.json`

- Generated by email-organizer
- Contains: thread metadata (sender, subject, date, labels, thread IDs)
- No file content — full emails fetched on demand via Gmail API
- Committed to git

## .gitignore Updates (PMO repo)

```gitignore
# On-demand caches (disposable)
**/cache/
**/data/

# Email body/attachment cache
**/emails/cache/
```

## Tool Changes Required

### `/gdrive` skill

- `upload`: detect `.md` files, auto-run `md-to-pdf`, upload both `.md` + `.pdf`
- `download`: save to `cache/<Drive-path>/filename` (not project root)
- `index`: keep 24h TTL as suggestion-only (no deletion, no blocking)
- Update all path references from `pmo/<code>/` to `pmo/projects/<code>/`

### `/gdrive-setup` skill

- After linking Drive folders, scaffold the local skeleton: create `emails/`, `meetings/`, `reports/md/`, `reports/pdf/`, `reference/`, `cache/`
- Update path references for new `projects/` nesting

### `/pmo` skill

- Update to load from `pmo/projects/<code>/` instead of `pmo/<code>/`
- Load `drive-index.json` and `emails/index.json` as inventory sources
- 24h TTL check on `drive-index.json`: suggest refresh, never block

### `/email-analyze` and email-organizer

- Update `pmo_path` references for new `projects/` nesting
- No functional changes to email pipeline (index-only refactor is future work)

### JARVIS config consumers

- Symlink: `config/orchestrator/project-codes.json` → `../../workspaces/strokmatic/pmo/config/project-codes.json`
- Gradually update all consumers to reference new path directly
- Remove symlink when migration complete

## Migration Plan (Existing Projects)

Separate effort, per project:

1. **Local:** Move `pmo/<code>/` to `pmo/projects/<code>/`, scaffold missing folders
2. **Remote:** Reorganize Drive folders to match 03008 convention (numbered prefixes)
3. **Index:** Run `/gdrive index` to regenerate `drive-index.json`

Priority: active projects first (01001, 03002, 03007, 03008, 03009), then historical.

## What Does NOT Change

- Drive folder IDs in `project-codes.json` (folders don't move, only internal reorganization)
- GCP service account and auth flow
- Google Workspace MCP server behavior
- The PMO git repo remote (`teruelskm/pmo`)
- Cross-project reports at `pmo/reports/`
