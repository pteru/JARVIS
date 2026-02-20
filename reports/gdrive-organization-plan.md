# Strokmatic Google Drive — Comprehensive Audit & Organization Plan

**Date:** 2026-02-20
**Scope:** All 4 product Shared Drives + GESTAO + 8 supplementary drives
**Status:** Read-only deep scan; [02] SPOT FUSION scan still in progress

---

## Executive Summary

Strokmatic's Google Shared Drives contain **~170,000+ files** across **~2,100+ folders** totaling **~470+ GB** (excluding [02] SPOT FUSION, still scanning). The content spans 5+ years of engineering projects across 3 product lines (DieMaster, SpotFusion, VisionKing) plus R&D consortium management.

### Critical Findings

| Finding | Impact | Estimated Waste |
|---------|--------|----------------|
| **Massive BMP training datasets on Drive** | ~135 GB of uncompressed images that should be in cloud storage (GCS/S3) or DVC | ~135 GB |
| **File duplication** (CAD multi-format exports, V1/V2 copies) | 30-40% of SMART DIE, significant in VK | ~60-80 GB |
| **Python codebase + __pycache__ on Drive** | Git repositories stored as flat files | ~2 GB |
| **Windows PC backups** | PassMark, desktop files, .exe on Drive | ~5 GB |
| **No unified folder structure** | Each project uses a different template | High onboarding friction |
| **Naming inconsistencies & typos** | "Hyudai", "elerico", "Retrinamento", "Stelantis" | Professional risk |

### Drive Inventory

| Drive | Files | Folders | Size | Date Range |
|-------|------:|--------:|-----:|-----------|
| [01] SMART DIE | ~39,361 | ~1,510 | ~153 GB | 2021–2026 |
| [02] SPOT FUSION | ~4,608+ *(partial)* | ~461+ | ~22.5+ GB *(partial)* | 2020–2026 |
| [03] VISION KING | ~120,000+ | ~800+ | ~260+ GB | 2012–2026 |
| [00] GESTAO DE PROJETOS | 1,170 | 263 | ~4.3 GB | 2020–2026 |
| [PROJETOS FECHADOS] | 1,864 | 136 | ~39.3 GB | 2020–2024 |
| [EXTERNO] SMART DIE - ENTREGAVEIS | 1,508 | — | ~11.4 GB | — |
| [EXTERNO] SPARK EYES - ENTREGAVEIS | 25 | — | ~2.2 GB | — |
| [EXTERNO] SMART DIE - ME 7,8,9 | 1 | — | ~28.9 MB | — |
| SMART CAM - ESTUDOS E TESTES | 11 | — | ~3.4 GB | — |
| [2000] PROSPECCOES - TESTES PRELIM. | 1,817 | — | ~64.5 GB | — |
| [2000] PROSPECCOES | 1,327 | — | ~8.9 GB | — |
| [2000] TEMPLATES | 27 | — | ~42.4 MB | — |
| PORTICO IRIS GM | 153 | 0 | ~2.8 GB | 2024 |
| **TOTAL** | **~167,000+** | **~2,700+** | **~550+ GB** | **2012–2026** |

---

## 1. Current State — Per-Drive Assessment

### 1.1 [01] SMART DIE (`0ALpYWXApVGjKUk9PVA`)

**Contents:** 5 project folders + 16 non-project folders

| Project | Files | Size | Status |
|---------|------:|-----:|--------|
| [01001] GM-SJC-S10_CC_LE | 4,217 | 23.2 GB | Active |
| [01002] GM-FLINT_Bravada_Fender | 347 | 5.7 GB | Active |
| [01003] DEV-JVL-Novo_Corsa | 960 | 38.5 GB | Active |
| [01004] STELLANTIS-DEMO | 265 | 2.6 GB | Demo |
| [01005] DEMESTAA/DECOLAB 2 | 1,260 | 4.3 GB | Active |

**Non-project content (83 GB, 54% of drive):**
- `90 - Novos Estudos`: 26,524 files, 14.2 GB — R&D experimental data, needs sub-organization
- `80 - Teste de Calibracao Gap`: 1,804 files, 45 GB — single largest folder by size
- `99 - PROTOTYPE SPECS`: 1,840 files, 9.8 GB
- `99 - Referencias`: 1,540 files, 1.6 GB — deeply nested reference library (460 folders)
- `40 - Hardware`: 1,964 files, 549 MB — PCB/electronics design
- `00 - Anotacoes Reunioes`: 116 Gemini meeting notes
- `Arquivos projeto Ferramentaria 4.0`: Legacy predecessor project (5.6 GB)
- `01 - Implementacoes`: Pre-code-system legacy (928 MB, overlaps with 01005)

**Key issues:**
- 300+ duplicate file groups (multi-format CAD exports, V1/V2 copies)
- Stale planning docs (`Cronograma` 7 months old, `Tasks` 13 months old)
- Legacy content mixed with active projects
- Non-project content is 54% of drive by size

### 1.2 [02] SPOT FUSION (`0AAUuVGQz7cyDUk9PVA`) — PRELIMINARY

**Contents:** 33 root items (non-project-structured drive — product-centric, not per-project)

| Folder | Files | Folders | Size |
|--------|------:|--------:|-----:|
| 00 - Anotacoes Reunioes | 105 | 0 | 2.9 MB |
| 000 - Cronograma Master | 6 | 0 | 7.6 MB |
| 001 - Instaladores | 4 | 1 | 244.9 MB |
| 01 - Software | 2,699 | 283 | 10.6 GB |
| 02 - INDUSTRIAL EDGE | 2 | 0 | 8.4 KB |
| 04 - Novas Instalacoes | 1,105 | 96 | 4.0 GB |
| 07 - Laboratorio | 226 | 44 | 5.8 GB |
| 10 - Comunicacao | 15 | 2 | 4.7 MB |
| 11 - Controle de Qualidade | 243 | 7 | 579.3 MB |
| 20 - Compras | 3 | 2 | 539.5 KB |
| 90 - Documentos | 200 | 26 | 1.3 GB |
| 98 - Repositorio antigos | *(scanning — massive archive)* | — | *(unknown)* |
| + 21 more project/topic folders | *(pending)* | — | — |
| **Known subtotal** | **~4,608+** | **~461+** | **~22.5+ GB** |

**Key observations (from partial scan):**
- **Not project-structured** — unlike SMART DIE and VK, SPOT FUSION uses a product-centric layout (Software, Hardware, Lab, QA) rather than per-project folders
- `01 - Software` is the largest scanned folder (2,699 files, 10.6 GB) — likely contains full source code
- `07 - Laboratorio` has 5.8 GB in 226 files — lab equipment docs, test data
- `04 - Novas Instalacoes` has 1,105 files — installation documentation per customer site
- `98 - Repositorio antigos` is still being scanned and likely contains thousands of legacy files
- 105 Gemini meeting notes (same pattern as other drives)
- Has an "INDUSTRIAL EDGE" folder (2 files) — Siemens Industrial Edge integration
- Project codes (02001-02008) likely appear as subfolders within topic folders, not as top-level items

**Key issues:**
- Fundamentally different structure from SMART DIE and VK — will need a different migration strategy
- Source code on Drive (`01 - Software` with 10.6 GB) — same issue as VK's ultralytics_custom
- Full scan pending — will update when agent completes

### 1.3 [03] VISION KING (`0ALRu7RfQZ9ukUk9PVA`) — LARGEST DRIVE

**Contents:** 10 project folders + 4 non-project items

| Project | Files | Size | Status |
|---------|------:|-----:|--------|
| [03000] Desenvolvimento (R&D) | 7,565 | 7.1 GB | Internal |
| [03001] Usiminas-Corpo Estranho | 52,226 | 59.1 GB | Legacy |
| [03002] ArcelorMittal TL1 | 12,720 | 78.8 GB | **Best organized** |
| [03003] GM-Underbody | 46 | 9.8 GB | Archived |
| [03005] IRIS GM-Paint SCDS (POC) | 49,755 | 55.7 GB | Transitioning |
| [03006] IRIS GM-Body/Paint GVT | 2,332 | 46.0 GB | **Active today** |
| [03007] IRIS GM-Paint SCDS (Prod) | 2,250 | 11.6 GB | **Active** |
| [03008] Hyundai Sealer | 1,085 | 2.4 GB | **Active** |
| [03009] ArcelorMittal TL2 | 7 | 1.0 GB | Early stage |
| [03010] VK Body Stellantis | 5+ | ~53 MB | **Active** |

**Non-project content:**
- `00 - Anotacoes Reunioes`: 131 Gemini meeting notes (7 months)
- `000 - Cronograma Master`: 2 stale sheets
- `[03099] Documentation`: 11 reference PDFs (185 MB)
- `Arquivos da simulacao CFD`: duplicates content in 03000

**Key issues:**
- Python codebase (`ultralytics_custom` fork) with `__pycache__` on Drive
- 90+ GB of uncompressed BMP training images across 03000, 03001, 03005
- Windows PC backup in 03005 (PassMark benchmarks, desktop files)
- `.exe` file in 03003 (security concern)
- Typos: "Hyudai", "Huyndai", "elerico", "Retrinamento", "Stelantis"
- 03002 is the gold standard for organization — all other projects should follow its template

### 1.4 [00] GESTAO DE PROJETOS (`0AIEiHJz5Bm7TUk9PVA`)

**Contents:** R&D consortium management (SENAI, EMBRAPII, FINEP, FAPESP, SPINN, DEDICAR)

**Top-level structure:**
```
[00] GESTAO DE PROJETOS/
  00 - GERAL/              (USA trip, team equipment, org charts)
  99 - TEMPLATES/           (Company templates)
  [01] SMART DIE/           (R&D funding for DieMaster)
    [SMART DIE] Aliança Rota 2030 SENAI/
    [SMART DIE] DEMIBAV/
    [SMART DIE] DESCAAL/
    [SMART DIE] EMBRAPII SENAI/
  [02] SPARK EYES/          (R&D funding for SpotFusion — legacy name)
    [SPARK EYES ALUMINIO] FINEP Startups IA/
    [SPARK EYES] Aliança Rota 2030 SENAI/
    SODW/
    SPINN/
  [03] SIS - SUPERFÍCIE/    (R&D funding for VisionKing)
    [03002] ARCELORMITTAL/
    [03] UNDERBODY/
    [05] SANTISTA - TRIBUNAL/
  [04] LABRASYS/            (Lume's other product)
    [04002] IRIS GM/
    [LABRASYS] EMBRAPII 100% Defletometria IR/
  [97] ARQUIVOS CSV_ARTIA/  (Project management tool exports)
  [98] PREMIAÇÃO PRODUTIVIDADE/ (Team awards)
  [99] PROJETOS E CONSÓRCIOS/   (DEDICAR consortium)
```

**Key observations:**
- Uses old product names: "SPARK EYES" (now SpotFusion), "SIS - SUPERFÍCIE" (now VisionKing)
- Contains `[04] LABRASYS` — a 4th product line not tracked in PMO project-codes.json
- Heavy R&D consortium management: contracts, milestone reports, travel receipts, accounting
- Well-organized with numbered prefixes but inconsistent naming depth

### 1.4 Supplementary Drives

| Drive | Purpose | Files | Size | Notes |
|-------|---------|------:|-----:|-------|
| **[PROJETOS FECHADOS]** | Closed/archived projects | 1,864 | 39.3 GB | Contains 03004 + 5 legacy projects (2001-2109) |
| **[EXTERNO] SMART DIE - ENTREGAVEIS** | SENAI consortium deliverables | 1,508 | 11.4 GB | Milestone reports for external auditors |
| **[EXTERNO] SPARK EYES - ENTREGAVEIS** | SENAI consortium deliverables | 25 | 2.2 GB | Same for SpotFusion |
| **[EXTERNO] SMART DIE - ME 7,8,9** | SENAI milestones 7-9 | 1 | 28.9 MB | Single deliverable |
| **SMART CAM - ESTUDOS E TESTES** | Early R&D | 11 | 3.4 GB | Pre-product studies |
| **[2000] PROSPECCOES - TESTES PRELIM.** | Pre-sales test data | 1,817 | 64.5 GB | Raw test data from prospects |
| **[2000] PROSPECCOES** | Sales proposals | 1,327 | 8.9 GB | Organized by customer |
| **[2000] TEMPLATES** | Company templates | 27 | 42.4 MB | Standardized docs |
| **PORTICO IRIS GM** | CAD workspace | 153 | 2.8 GB | 153 files in flat directory |

### 1.5 [PROJETOS FECHADOS] — Closed Projects Archive

| Project | Status | Content |
|---------|--------|---------|
| [03004] Santista-Tribunal | Completed 2023 | Fabric defect detection — images, ML models, workstation backup |
| [2001] SENAI - Tryout | FINALIZADO | Instrumentation + OmniCAD WP reports |
| [2002] Fras-le Desalinhamento | FINALIZADO | Misalignment detection project |
| [2102] PIPE FAPESP Lume ToF | FINALIZADO | Time-of-Flight research (FAPESP grant) |
| [2103] HYUNDAI POC Sealer | FINALIZADO | Predecessor to 03008 — Intel RealSense experiments |
| [2109] USIMINAS - TA Guardas | ENCERRADO | Lateral guard inspection (12 visits documented) |

**Key observation:** [2103] HYUNDAI POC Sealer is the precursor to active project [03008]. Reference data may still be relevant.

---

## 2. Cross-Drive Issues

### 2.1 Content Duplication Across Drives

| Duplicate Content | Locations | Est. Overlap |
|-------------------|-----------|-------------|
| ArcelorMittal 03002 project management | VK Drive [03002] + GESTAO [03]/[03002] | Administrative docs |
| CFD simulation files | VK Drive root `Arquivos da simulacao CFD` + VK [03000]/02-Analise termica | 64 MB |
| Santista/03004 content | VK Drive (missing) + PROJETOS FECHADOS + GESTAO [03]/[05] | ML data |
| IRIS portico CAD | PORTICO IRIS GM drive + VK 03006/01-CAD + VK 03007/01-CAD | ~2.8 GB |
| SENAI deliverables | GESTAO [01]+[02] + [EXTERNO] drives | Reports/accounting |
| Hyundai Sealer history | PROJETOS FECHADOS [2103] + VK 03008 | POC data |

### 2.2 Naming Inconsistencies

| Problem | Examples |
|---------|---------|
| **Product name evolution** | "SPARK EYES" → "SpotFusion", "SIS-SUPERFÍCIE" → "VisionKing" |
| **Customer name typos** | "Hyudai", "Huyndai" (Hyundai), "Stelantis" (Stellantis) |
| **Portuguese spelling errors** | "elerico" (elétrico), "Retrinamento" (Retreinamento) |
| **Folder number prefixes** | `00 -`, `[00]`, `000 -` — three different conventions |
| **Date formats** | `2023.03.21`, `2024-09-04`, `20230630`, `12_09_2023` |
| **Language mixing** | Portuguese folders with English file names, inconsistently |
| **Case inconsistency** | `CAD matriz` vs `CAD Front` vs `cad` |

### 2.3 Structural Patterns Observed

Each drive and project uses a slightly different folder template:

| Pattern | Smart Die | VisionKing 03002 | VK Others | GESTAO |
|---------|-----------|-------------------|-----------|--------|
| **Prefix style** | `00 -` numeric | `[00]` bracketed | `00 -` numeric | `[01]` + names |
| **Meeting notes** | `00 - Anotacoes` at root | `[99] ATAS` in project | `00 - Anotacoes` at root | — |
| **Schedule** | `000 - Cronograma` | `[07] CRONOGRAMA` | `000 - Cronograma` | — |
| **CAD** | `01 - CAD` | `[WP2]` or mixed | `01 - CAD` or `02 - CAD` | — |
| **Procurement** | `30 - Compras` | `[20] or ad-hoc` | `05 - COMPRAS` | — |
| **WP structure** | No | Yes (`[WP1]`–`[WP3]`) | No | Has WP in SENAI subfolders |

---

## 3. Proposed Unified Folder Structure

Based on analysis of **03002** (best-organized project) and common patterns across all drives, I propose a **two-tier template**: one for **product drives** and one for **project folders**.

### 3.1 Product Drive Template (root level)

```
[NN] PRODUCT NAME/
  [00] Anotações Reuniões/       # Gemini auto-transcriptions (by year/month)
  [01] Cronograma Master/        # Product-wide schedules and task trackers
  [02] Desenvolvimento/          # Cross-project R&D (code NNNNN with N=0)
  [NN001] Project Name 1/        # Individual project folders (see 3.2)
  [NN002] Project Name 2/
  ...
  [90] Referências/              # Reference materials, academic papers, catalogs
  [98] Mídia/                    # Product-wide media (marketing, demos)
  [99] Documentação/             # Product manuals, specs (not project-specific)
```

**Numbering logic:**
- `[00]`–`[09]`: Product-level administrative/management
- `[NN0xx]`: Project folders (where NN = product prefix: 01, 02, 03)
- `[90]`–`[99]`: Product-level reference/archive

### 3.2 Project Folder Template (inside product drive)

```
[NNNNN] Client-Site-Product/
  [00] Escopo e Contratação/     # Contracts, proposals, scope documents
  [01] Apresentações/            # Presentations (kickoff, status, demos)
  [02] Cronograma/               # Project schedule
  [03] CAD/                      # All mechanical/electrical design
    Projeto Mecânico/
    Projeto Elétrico/
    Componentes/
    Planta-Layout/
  [04] Manuais e Entrega Técnica/ # Operation manuals, handover docs
  [05] Status Report/            # Periodic status reports
  [10] Data Science/             # ML models, datasets, training results
    Modelos/
    Datasets/                    # Only metadata/pointers — bulk data in GCS
    Avaliação/
  [20] Compras e Orçamentos/     # Procurement, quotes, BOMs
  [30] Integração/               # PLC, network, system integration docs
  [40] Rotulagem/                # Defect labeling (if applicable)
  [50] Instalação/               # Installation reports, photos, topology
  [90] Atas de Reuniões/         # Meeting minutes (project-specific)
  [97] Documentos Gerais/        # Miscellaneous
  [98] Mídia/                    # Photos, videos from field visits
  [99] Planejamento/             # Internal planning, WP packages
    WP1/
    WP2/
    ...
```

**Rules:**
1. **Bracketed numbers**: `[NN]` — consistent across all projects
2. **Portuguese folder names** for internal projects, English for international (e.g., GM-Flint)
3. **No accent marks in folder names** (Drive handles them inconsistently)
4. **Date format**: `YYYY-MM-DD` everywhere (ISO 8601)
5. **Sub-numbering** allowed: `[03.1] Projeto Mecânico`, `[03.2] Projeto Elétrico`

### 3.3 GESTAO Drive Template

```
[00] GESTÃO DE PROJETOS/
  [00] Geral/                     # Company-wide admin (org charts, travel, equipment)
  [01] SMART DIE (DieMaster)/     # R&D funding per product
    [SENAI] Aliança Rota 2030/
    [EMBRAPII] ...
    [DEMIBAV] ...
  [02] SPOT FUSION (SpotFusion)/  # Updated name from "SPARK EYES"
    [SENAI] Aliança Rota 2030/
    [FINEP] Startups IA/
    [SPINN] ...
  [03] VISION KING (VisionKing)/  # Updated name from "SIS - SUPERFÍCIE"
    [03002] ArcelorMittal/
    [Underbody]/
  [04] LABRASYS/                  # Keep as-is
  [90] Templates/                 # Company-wide templates
  [97] Artia Exports/             # PM tool data
  [98] Premiação/                 # Team awards
  [99] Consórcios/                # Cross-product consortia (DEDICAR etc.)
```

### 3.4 Supplementary Drive Consolidation

| Current Drive | Recommendation |
|---------------|----------------|
| **[PROJETOS FECHADOS]** | Keep as-is. Add missing closed projects. Standardize folder names. |
| **[EXTERNO] SMART DIE - ENTREGAVEIS** | Keep. Used for external stakeholder access. |
| **[EXTERNO] SPARK EYES - ENTREGAVEIS** | Keep. Rename to "[EXTERNO] SPOT FUSION - ENTREGÁVEIS". |
| **[EXTERNO] SMART DIE - ME 7,8,9** | Merge into [EXTERNO] SMART DIE - ENTREGAVEIS. |
| **SMART CAM - ESTUDOS E TESTES** | Archive into [PROJETOS FECHADOS] as legacy R&D. |
| **[2000] PROSPECCOES - TESTES PRELIM.** | Keep. Add `_ARCHIVE` suffix to completed prospects. |
| **[2000] PROSPECCOES** | Keep. Ensure customer folders are properly named. |
| **[2000] TEMPLATES** | Merge into GESTAO/[90] Templates. One source of truth. |
| **PORTICO IRIS GM** | Organize into subfolders, then consider merging into VK 03006/[03] CAD. |

---

## 4. Data Management Strategy

### 4.1 Large Dataset Policy

**Problem:** ~200 GB of training images (BMP, JPG) stored directly on Google Drive.

**Recommendation:**

| Data Type | Current Location | Proposed Location | Action |
|-----------|-----------------|-------------------|--------|
| Training BMPs (raw) | 03000, 03001, 03005 | Google Cloud Storage bucket | Move, keep Drive pointer |
| Labeled datasets | 03005 (BMP+XML), 03006 | GCS + DVC tracking | Migrate |
| ML model weights (.bin) | 03000, 03001 | GCS or model registry | Move |
| Production snapshots | Various | Keep in project [10] | Keep small |
| Video recordings | 98-MIDIA folders | Keep on Drive | OK |

**Target state:** Each project's `[10] Data Science/Datasets/` folder contains:
- `README.md` with dataset description, size, GCS path
- `metadata.json` with label counts, class distribution
- **No bulk image files** — only pointers

**Estimated Drive savings:** ~135 GB

### 4.2 CAD File Management

**Problem:** Multi-format exports (`.prt` + `.stp` + `.jt` + `.pdf` + `.log`) stored flat together, creating 300+ duplicate groups in SMART DIE alone.

**Recommendation:**
```
[03] CAD/
  Projeto Mecânico/
    Source/           # Native format ONLY (.prt, .sldprt, .catpart)
    Exports/          # Generated formats (.stp, .jt, .stl, .dwg, .pdf)
    Archive/          # Previous revisions (compressed)
```

**Rules:**
1. Only **one native format** per part in Source/ (NX `.prt` OR SolidWorks `.sldprt`, not both)
2. Exports/ is **regeneratable** — mark it as such
3. Remove `.log` files (regeneratable from CAD software)
4. Version control via folder naming: `R0/`, `R1/`, etc. (as 03002 does)

**Estimated Drive savings:** ~50-70 GB across SMART DIE + VisionKing

### 4.3 Code Repository Policy

**Problem:** Full Python codebases on Drive (ultralytics_custom with `__pycache__`).

**Rule:** No source code on Drive. Period.
- Python/Node/C++ code belongs in Git (GitHub or internal)
- Notebooks (`.ipynb`) are acceptable if they're documentation/analysis, not production code
- `__pycache__`, `.git`, `node_modules` — delete immediately

### 4.4 Clean-Up Targets

| Target | Location | Size | Action |
|--------|----------|------|--------|
| `ultralytics_custom/` + `__pycache__` | VK 03000 | ~2 GB | Delete (move to Git first) |
| Windows PC backup | VK 03005/98-VISION MASTER | ~1 GB | Delete |
| `desktop.ini` files | PORTICO drive + various | bytes | Delete |
| `.exe` file | VK 03003 | ~50 MB | Delete (security) |
| Duplicate `Santista.zip` + `Santista (1).zip` | PROJETOS FECHADOS/03004 | ~2.3 GB each | Keep one |
| Duplicate CFD files | VK root + VK 03000 | 64 MB | Keep one location |
| "Copia de" files | SMART DIE various | varies | Review and delete |
| `Projeto Mecanico - BACKUP/` | VK 03007 | varies | Merge into main or delete |

---

## 5. Meeting Notes Organization

### Current State

Both SMART DIE and VISION KING have flat `00 - Anotacoes Reunioes/` folders at the drive root containing 100+ Gemini auto-transcription Google Docs.

### Proposed Structure

```
[00] Anotações Reuniões/
  2025/
    07/
    08/
    ...
    12/
  2026/
    01/
    02/
```

**Rules:**
- Year/month subfolders for archive
- Gemini auto-names the files with date prefix — good, keep that
- Sprint Start/End meetings → tagged with sprint number in filename
- Product-specific meetings go in the project's `[90] Atas/` folder, not the root

---

## 6. Naming Convention Standards

### 6.1 Folder Names

```
Pattern: [NN] Folder Name
Examples:
  [00] Escopo e Contratação
  [03] CAD
  [10] Data Science
  [90] Atas de Reuniões
```

**Rules:**
- Bracketed two-digit prefix: `[NN]`
- Title case in Portuguese (capitalize first letter of each significant word)
- No accent marks in folder names (use `Atas` not `Atas`, `Orcamentos` not `Orçamentos`)
- Hyphens for multi-word names where needed: `Barra-Mansa`

### 6.2 File Names

```
Pattern: YYYY-MM-DD_Description_Revision.ext
Examples:
  2026-02-20_Proposta_Tecnica_R2.pdf
  2025-11-05_Hyundai_Sealer_Kickoff.pptx
  03002_Cronograma_Master.xlsx
```

### 6.3 Project Folder Names

```
Pattern: [NNNNN] Client-Site-Part
Examples:
  [01001] GM-SJC-S10_CC_LE
  [03002] ArcelorMittal-BarraMansa-TL1
  [03008] Hyundai-Sealer
```

**Fix these typos:**
- `Hyudai` → `Hyundai`
- `Huyndai` → `Hyundai`
- `Projeto elerico` → `Projeto Eletrico`
- `Retrinamento` → `Retreinamento`
- `Stelantis` → `Stellantis`

---

## 7. Migration Strategy — Priority Actions

### Phase 1: Quick Wins (1 day, no risk)

| # | Action | Drive | Impact |
|---|--------|-------|--------|
| 1 | Fix typos in folder names (5 renames) | VK | Professional |
| 2 | Delete `desktop.ini` files | PORTICO, various | Cleanup |
| 3 | Delete `.exe` file from 03003 | VK | Security |
| 4 | Delete duplicate `Santista (1).zip` | PROJETOS FECHADOS | 2.3 GB |
| 5 | Merge [EXTERNO] ME 7,8,9 into ENTREGAVEIS | EXTERNO drives | Simplify |
| 6 | Rename "SPARK EYES" references where visible | GESTAO | Consistency |

### Phase 2: Structural Improvements (1 week)

| # | Action | Drive | Impact |
|---|--------|-------|--------|
| 7 | Create standardized template folders in 03009, 03010 | VK | Prevent chaos |
| 8 | Organize PORTICO drive into subfolders | PORTICO | 153 files → structured |
| 9 | Organize VK meeting notes into year/month folders | VK | 131 docs → navigable |
| 10 | Organize SD meeting notes into year/month folders | SD | 116 docs → navigable |
| 11 | Move duplicate CFD files to single location | VK | Dedup |
| 12 | Merge `Projeto Mecanico - BACKUP/` in 03007 | VK | Dedup |
| 13 | Move VK 03000 `ultralytics_custom/` to Git | VK | 2 GB saved |

### Phase 3: Data Migration (2-4 weeks)

| # | Action | Drive | Impact |
|---|--------|-------|--------|
| 14 | Move BMP training datasets to GCS bucket | VK | ~90 GB freed |
| 15 | Move binary model weights to GCS/MLflow | VK | ~45 GB freed |
| 16 | Separate CAD Source/ vs Exports/ in SMART DIE projects | SD | ~50 GB dedup potential |
| 17 | Archive legacy content (Ferramentaria 4.0, 01-Implementacoes) | SD | Cleanup |
| 18 | Sub-organize `90 - Novos Estudos` (26K files) | SD | Navigability |
| 19 | Clean up Windows PC backup from 03005 | VK | ~1 GB freed |
| 20 | Archive SMART CAM drive into PROJETOS FECHADOS | Supplementary | Simplify |
| 21 | Merge [2000] TEMPLATES into GESTAO [90] Templates | Supplementary | Single source |

### Phase 4: Standardization (ongoing)

| # | Action | Scope | Impact |
|---|--------|-------|--------|
| 22 | Apply standard folder template to all new projects | All drives | Consistency |
| 23 | Create JARVIS automation: `/gdrive organize` applies rules | JARVIS | Sustainable |
| 24 | Quarterly Drive health report (automated) | All | Governance |
| 25 | Enforce "no code on Drive" policy | All | Hygiene |

---

## 8. JARVIS Integration Recommendations

### 8.1 Automated Drive Indexing

Build a quarterly index job that:
1. Scans all product drives recursively
2. Builds `drive-index.json` for each project
3. Detects: new unorganized files, large files, naming violations, stale content
4. Generates a health report per drive

### 8.2 Template Enforcement

When `/gdrive-setup` creates a new project folder, auto-create the standard subfolder template:
```
[NNNNN] ProjectName/
  [00] Escopo e Contratação/
  [01] Apresentações/
  [02] Cronograma/
  [03] CAD/
  [04] Manuais e Entrega Técnica/
  [05] Status Report/
  [10] Data Science/
  [20] Compras e Orçamentos/
  [90] Atas de Reuniões/
  [98] Mídia/
```

### 8.3 Drive Organization Rules Update

Update `config/orchestrator/drive-organize-rules.json` with the classification rules from this analysis:
- `.prt`, `.sldprt`, `.sldasm` → `[03] CAD/Source/`
- `.stp`, `.jt`, `.stl`, `.dwg` → `[03] CAD/Exports/`
- `.pdf` with "proposta" or "contrato" → `[00] Escopo/`
- `.pptx` with "kickoff" or "status" → `[01] Apresentações/`
- `.bmp`, `.bin` (large batches) → Flag for GCS migration
- `.exe`, `desktop.ini`, `__pycache__` → Flag for deletion

---

## 9. Cross-Reference Map

### Product Name Evolution

| Current Product | GESTAO Name | Old Name | Drive Prefix |
|----------------|-------------|----------|-------------|
| DieMaster | [01] SMART DIE | Smart Die, Ferramentaria 4.0 | 01 |
| SpotFusion | [02] SPARK EYES | Spark Eyes | 02 |
| VisionKing | [03] SIS - SUPERFÍCIE | SIS-Superfície, Vision Master | 03 |
| LABRASYS | [04] LABRASYS | — | 04 |

### Consortium Funding Map

| Consortium | Product | Agency | Status | Drive Location |
|-----------|---------|--------|--------|----------------|
| Aliança Rota 2030 | Smart Die | SENAI | Active | GESTAO/[01]/[SMART DIE] Aliança |
| Aliança Rota 2030 | Spark Eyes | SENAI | Active | GESTAO/[02]/[SPARK EYES] Aliança |
| EMBRAPII | Smart Die | SENAI | Reporting | GESTAO/[01]/[SMART DIE] EMBRAPII |
| EMBRAPII 100% | LABRASYS | EMBRAPII | Active | GESTAO/[04]/[LABRASYS] EMBRAPII |
| FINEP Startups IA | Spark Eyes | FINEP | Accounting | GESTAO/[02]/[SPARK EYES ALUMINIO] FINEP |
| SPINN | Spark Eyes | — | Active | GESTAO/[02]/SPINN |
| PIPE HIGH TECH | Lume ToF | FAPESP | CLOSED | PROJETOS FECHADOS/[2102] |
| DEMIBAV | Smart Die | — | Active | GESTAO/[01]/[SMART DIE] DEMIBAV |
| DESCAAL | Smart Die | — | Active | GESTAO/[01]/[SMART DIE] DESCAAL |
| DEDICAR | Cross-product | — | Active | GESTAO/[99]/[DEDICAR] |

### Project Lineage

```
[2103] HYUNDAI POC Sealer (CLOSED) ──→ [03008] Hyundai Sealer (ACTIVE)
[03005] IRIS GM-Paint SCDS (POC) ──→ [03007] IRIS GM-Paint SCDS (PROD)
[03004] Santista-Tribunal (CLOSED) ──→ (no successor)
[01001] GM-SJC (ACTIVE) ──→ ongoing
[03002] ArcelorMittal TL1 (ACTIVE) ──→ [03009] ArcelorMittal TL2 (STARTING)
```

---

## 10. Summary

### Estimated Impact

| Metric | Current | After Phase 3 |
|--------|---------|---------------|
| Total Drive usage | ~550+ GB | ~300-350 GB |
| Duplicate files | ~300+ groups | <50 groups |
| Naming violations | ~15+ typos/inconsistencies | 0 |
| Projects with standard template | 1 (03002) | All active |
| Orphaned/legacy content at root | 16+ folders | 0 (archived) |
| Training data on Drive | ~135 GB | ~0 (in GCS) |

### Key Principles

1. **03002 is the gold standard** — replicate its `[NN]` + WP structure across all projects
2. **Drive is for documents, not data** — bulk datasets belong in cloud storage
3. **Drive is for documents, not code** — source code belongs in Git
4. **One naming convention** — `[NN]` bracketed prefixes, Portuguese, no accents
5. **One template** — enforce via JARVIS `/gdrive-setup` automation
6. **Quarterly health checks** — automated scan + report to catch drift

---

*Report generated by JARVIS Orchestrator — Google Drive Deep Audit*
*Data sources: Google Drive API v3 recursive scans of 12+ Shared Drives*
*[02] SPOT FUSION data pending — update this report when scan completes*
