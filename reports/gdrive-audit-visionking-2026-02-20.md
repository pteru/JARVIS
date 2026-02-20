# VisionKing [03] Google Shared Drive - Comprehensive Audit Report

**Date:** 2026-02-20
**Drive ID:** `0ALRu7RfQZ9ukUk9PVA`
**Audit scope:** Read-only, all folders and files

---

## 1. Drive Overview

### Root Structure (14 items)

| Folder | ID | Last Modified | Purpose |
|--------|-----|---------------|---------|
| `00 - Anotacoes Reunioes` | `1PL5zJo39OKq...` | 2025-07-25 | Meeting notes (Gemini auto-transcriptions) |
| `000 - Cronograma Master` | `1nGLk4Bv0aYQ...` | 2024-03-24 | Master schedule spreadsheets |
| `[03000] Desenvolvimento` | `1eaQWv-vtYU8...` | 2024-02-15 | Internal R&D, datasets, ML models |
| `[03001] Usiminas-Inovai-Corpo Estranho` | `1z-prbw_QBnN...` | 2024-02-15 | Foreign body detection for Usiminas |
| `[03002] ArcelorMittal Barra Mansa` | `1FNUCw30Q9cX...` | 2025-08-18 | Steel surface inspection - TL1 |
| `[03003] GM-Underbody` | `1reEFA9vtuE4...` | 2024-02-15 | Underbody inspection for GM |
| `[03005] IRIS GM-Paint Shop SCDS (POC)` | `1aD8wn5qJLH8...` | 2025-09-09 | IRIS paint shop POC |
| `[03006] IRIS GM-Body/Paint GVT (POC)` | `1fM9AtIpPAGS...` | 2025-08-29 | IRIS body/paint GVT POC |
| `[03007] IRIS GM-Paint Shop SCDS` | `1sMj7FUnkCfl...` | 2025-08-29 | IRIS paint shop production |
| `[03008] Hyundai Sealer` | `1Fd7UL8TBGZP...` | 2025-09-01 | Sealer inspection for Hyundai |
| `[03009] ArcelorMittal Barra Mansa TL2` | `1pYgdszzYrC0...` | 2025-09-16 | Steel surface inspection - TL2 |
| `[03010] VK Body Stellantis` | `1zBBs-ot57nZ...` | 2025-09-17 | Body inspection for Stellantis |
| `[03099] Documentation` | `1ZFO2R6-hzyr...` | 2024-08-28 | Reference PDFs (machine vision, cameras) |
| `Arquivos da simulacao CFD` | `1eMPp-ZlaRPA...` | 2026-01-28 | CFD simulation files |

**Note:** No 03004 exists in this drive (it is in `[PROJETOS FECHADOS]`).

### Aggregate Statistics

| Metric | Value |
|--------|-------|
| **Total project folders** | 10 (03000-03010, skipping 03004) |
| **Non-project folders** | 4 |
| **Total files (all projects)** | ~120,000+ |
| **Total size (all projects)** | ~260 GB+ |
| **Date range** | 2012-08-13 to 2026-02-20 |
| **Google native files** | ~200+ (Docs, Sheets, Slides) |

---

## 2. Per-Project Breakdown

### [03000] Desenvolvimento (Internal R&D)

| Metric | Value |
|--------|-------|
| Files | 7,565 |
| Folders | 96 |
| Total Size | ~7.1 GB |
| Date Range | 2024-03-21 to 2026-02-03 |

**Top-level structure:**
- `01 - P&D Interno/` -- Scope and schedule for internal R&D
- `02 - Analise termica das resistencias/` -- CFD thermal analysis reports
- `dataset/` -- ML training datasets (Stellantis, VisionMaster)
- `Modelos/` -- Pre-trained model archives
- `Testes de Simulacao/` -- Simulation test data (Redis dumps, CSVs)
- `ultralytics_custom/` -- Full custom Ultralytics/YOLO codebase (Python)

**File type distribution:**
- `.bmp`: 3,614 (47.8%) -- training images
- `.txt`: 2,005 (26.5%) -- YOLO labels
- `.bin`: 1,675 (22.1%) -- model weights
- `.py`: 141 -- Python source code
- `.yaml`: 50 -- YOLO config files

**Google native files (4):**
- `Benchmarking DM unificado` (Spreadsheet)
- `Mapeamento de Status` (Spreadsheet)
- `Vision King - Tasks` (Spreadsheet)
- `Profiling Completo` (Spreadsheet)

**Issues found:**
- Full Python codebase + `__pycache__` directories uploaded to Drive (not appropriate for Drive storage)
- Dataset images are uncompressed BMP (~960KB each) -- ~3.5 GB of training images
- The `ultralytics_custom/` folder is a complete fork of the Ultralytics library -- should be in a Git repo, not Drive
- CFD simulation files also duplicated in the root-level `Arquivos da simulacao CFD` folder

---

### [03001] Usiminas-Inovai-Corpo Estranho

| Metric | Value |
|--------|-------|
| Files | 52,226 |
| Folders | 237 |
| Total Size | ~59.1 GB |
| Date Range | 2012-08-13 to 2024-08-05 |

**Top-level structure:**
- `00 - Contratacao/` -- Contract documents
- `01 - Follow ups/` -- Meeting follow-ups
- `02 - Hardware/` -- Extensive hardware design (panels, camera mounts, fabrication drawings)
  - `USIMINAS - CORPO ESTRANHO - PAINEL/` -- Electrical panel CAD
  - `USIMINAS - CORPO ESTRANHO - SUPORTE CAMERAS/` -- Camera mount fabrication
- `03 - Coleta de Dados/` -- Data collection
- `WP1/` -- Work package: Component lists

**File type distribution:**
- `.bin`: 47,734 (91.4%) -- model weights / binary data
- `.jpg`: 2,539 (4.9%) -- photos
- `.prt`: 1,285 (2.5%) -- NX/Siemens CAD parts
- `.pdf`: 171 -- technical drawings and documents
- `.stp`: 141 -- STEP CAD files

**Google native files (2):**
- `Aquisicao_usiminas` (Spreadsheet) -- data acquisition tracking
- `Lista de Componentes - Piloto` (Spreadsheet) -- component list

**Issues found:**
- Oldest file dates to 2012 (Basler camera CAD files) -- likely imported from external sources
- Nearly 48K binary files suggest this contains raw model training data that should not be on Drive
- Multiple levels of nested hardware folders duplicating "FABRICACAO" structures

---

### [03002] ArcelorMittal Barra Mansa (TL1) -- MOST ACTIVE PROJECT

| Metric | Value |
|--------|-------|
| Files | 12,720 |
| Folders | 245 |
| Total Size | ~78.8 GB |
| Date Range | 2018-10-01 to 2026-01-29 |

**Top-level structure (well-organized, numbered):**
- `[00] BENCHMARKING/`
- `[01] APRESENTACOES PROPOSTA TECNICA/`
- `[02] ARTIGOS REVIEWS/`
- `[03] MARCAS E PATENTES/`
- `[04] MANUAIS OPERACAO, ENTREGA TECNICA/`
- `[05] STATUS REPORT/`
- `[06] BOLETINS MEDICAO ARCELOR/`
- `[07] CRONOGRAMA/`
- `[08] CONTRATO ARCELOR / PROTECAO DE DADOS/`
- `[09] INTEGRACAO ARCELOR/`
- `[40] ROTULAGEM/` -- defect labeling
- `[50] DATA SCIENCE/` -- ML models by campaign (6th through 10th campaign)
- `[95] IBA/` -- PLC integration data
- `[97] DOCUMENTOS/`
- `[98] Filter/`, `[98.1] Nova Imagens/`
- `[99] ATAS DE REUNIOES/`
- `[WP1] DETALHAMENTO DOS REQUISITOS (TAP)/`
- `[WP2] PREPARACAO DO SISTEMA/`
- `[WP3] INSTALACAO DO SISTEMA ARCELORMITTAL/`

**File type distribution:**
- `application/octet-stream`: 6,305 -- binary data
- `.jpg`: 2,173 -- inspection/reference photos
- `.prt`: 1,566 -- CAD files (NX)
- `.json`: 1,558 -- config/data files
- `.bmp`: 240 -- training images
- `.xml`: 202 -- configuration files
- `.pdf`: 80 -- documents

**Google native files (35) -- richest set of any project:**
- **Documents (15):** Operation manuals, technical delivery docs, status reports, meeting notes, server specs
- **Spreadsheets (14):** Cronograma, dimensionamento, simulacao cenarios, confusion matrix, component lists
- **Presentations (6):** Calibration manual, user dashboard manual, proposal, rotulagem descriptions

**Assessment:** Best-organized project. Uses numbered folder prefixes and Work Package (WP) structure. Contains the full project lifecycle from proposal through installation and ongoing campaigns. Multiple revision folders (R0-R5) for mechanical designs show good version control. The data science section is organized by campaign date.

---

### [03003] GM-Underbody

| Metric | Value |
|--------|-------|
| Files | 46 |
| Folders | 21 |
| Total Size | ~9.8 GB |
| Date Range | 2012-11-22 to 2025-06-20 |

**Top-level structure:**
- `00 - RELATORIOS/` -- Milestone reports (ME01, ME02, ME03)
- `01 - Comunicacao/` -- Meeting minutes
- `Estudo preliminar/` -- Camera studies, inspection items, early presentations
- `OneDrive_2023-11-23/` -- Technology transfer archive from EP (external partner)
- `Projeto ISI SIM/` -- CAD components

**File type distribution:**
- `.zip`: 15 (bulk of the size -- dataset archives, repository snapshots)
- `.pdf`: 10
- `.xlsx`: 6
- `.pptx`: 3
- `.prt`: 3 (CAD parts: Basler camera, lens mount, Underbody NB.jt at 273MB)

**Google native files:** None

**Issues found:**
- The `08_PASTA_COMPARTILHADA_COM_A_EP.zip` is 4.7 GB -- a single massive archive
- `OneDrive_2023-11-23.zip` is 2.4 GB -- a full OneDrive dump
- Contains a `.exe` file (documentation installer) -- should not be on Drive
- Much of the content appears to be a one-time technology transfer dump, not ongoing project files
- Duplicated folder structure: both `__Pasta compartilhada com a EP` and `Pasta compartilhada com a EP` exist

---

### [03005] IRIS GM-Paint Shop SCDS (POC)

| Metric | Value |
|--------|-------|
| Files | 49,755 |
| Folders | 62 |
| Total Size | ~55.7 GB |
| Date Range | 2024-07-18 to 2025-10-21 |

**Top-level structure:**
- `000 - Cronograma Master/`
- `01 - Kick-Off/` -- kickoff documents (final/editable)
- `02 - CADs Sao Caetano/` -- CAD models for the plant
- `03 - REQUISITOS/`
- `04 - STATUS REPORT/`
- `05 - COMPRAS/`
- `06 - MANUAIS/`
- `07 - ATAS REUNIOES/`
- `10 - MODELOS/`
- `98 - VISION MASTER/` -- Legacy VisionMaster backup
- `99 - MIDIA/` -- Training images and models
- `INSTALACAO SCDS/` -- Installation reports

**File type distribution:**
- `.bmp`: 44,433 (89.3%) -- massive training dataset
- `.xml`: 5,038 -- annotation/config files
- `.prt`: 140 -- CAD files
- `.png`, `.jpg`, `.pdf`, `.mp4` -- assorted

**Google native files (9):**
- `Iris - Tasks` (Spreadsheet) -- task tracker
- `Guia rapido montagem - IRIS_SCS_Rev1` (Doc)
- `Guia rapido montagem - IRIS_SJC_Rev1` (Doc)
- `IRIS GM` (Presentation) -- media presentation
- `IRIS - Relatorio GM SCDS` (Doc)
- `Matriz de Confusao GM IRIS` (Spreadsheet)

**Issues found:**
- 44K+ BMP files dominate the drive usage (~43 GB of raw images)
- `98 - VISION MASTER/` contains a Windows PC backup including PassMark benchmarks, Lightshot screenshots, etc. -- not project content
- Folder numbering is inconsistent (jumps from 07 to 10, then 98, 99)

---

### [03006] IRIS GM-Body/Paint GVT (POC)

| Metric | Value |
|--------|-------|
| Files | 2,332 |
| Folders | 27 |
| Total Size | ~46.0 GB |
| Date Range | 2025-03-26 to 2026-02-20 (ACTIVE TODAY) |

**Top-level structure:**
- `00 - Escopo/`
- `01 - CAD/` -- Body Shop semi-portico and Paint Shop designs
  - `01 - Body Shop - Semi-portico/` -- 126 files, animations
  - `02 - Paint Shop - Travessa Teto/`
  - `PKG - GRAV - BIW ONIX PLUS/`
- `02 - Kick Off/` -- Photos, Blender simulations
- `03 - Dados/` -- Training images, evaluation data
  - `01 - IMAGENS TREINAMENTO/`
  - `02 - AVALIACAO VISUAL/`
  - `03 - MODELOS/`
  - `Registro GVT fev/2026/` -- Active February 2026 data
  - `Retrinamento_GVT_fev-2026/` -- Retraining in progress

**File type distribution:**
- `.jpg`: 1,971 (84.6%) -- inspection images
- `.prt`: 270 -- CAD parts
- `.blend`: 7 -- Blender 3D simulation files
- `.mp4`: 11 -- videos

**Google native files (6):**
- `IRIS GVT - Dimensionamento` (Spreadsheet)
- `VisionKing_POC_GVT_defeitos` (Spreadsheet) -- defect tracking
- `2026.02.10_IRIS_GM_GVT_PoC` (Presentation)
- `2026.02.20_IRIS_GM_GVT_PoC` (Presentation) -- updated TODAY
- `Dimensionamento Componentes IRIS` (Spreadsheet)

**Assessment:** Very active project (latest file modified today 2026-02-20). Has a typo: "Retrinamento" should be "Retreinamento". The `Registro GVT fev/2026` folder shows ongoing data collection.

---

### [03007] IRIS GM-Paint Shop SCDS (Production)

| Metric | Value |
|--------|-------|
| Files | 2,250 |
| Folders | 39 |
| Total Size | ~11.6 GB |
| Date Range | 2015-07-02 to 2026-02-17 (ACTIVE) |

**Top-level structure:**
- `00 - Documentos de Contratacao/` -- Contract/proposal documents
- `01 - CAD/` -- Cameras, mechanical design, STL exports, Blender simulations
  - `Cameras Utilizadas/` -- N15 (superior) and N6 (lateral)
  - `Projeto Mecanico/` -- Detailed design with backup
  - `Projeto Mecanico - BACKUP/` -- Backup of CAD designs
  - `Simulacao Blender/` -- machine-view renders
- `02 - Compras/` -- Purchase orders organized by component type
  - `Orcamentos/` -- Quotes from multiple suppliers (PLC, sensors, servos)
- `03 - Projeto Eletrico/` -- Electrical layout, BOM, manuals, 3D models
  - `Projeto elerico/` -- TYPO: should be "Projeto eletrico"

**File type distribution:**
- `.prt`: 1,103 (49.0%) -- NX CAD parts
- `.jpg`: 965 (42.9%) -- photos/renderings
- `.pdf`: 63
- `.stp`: 18, `.igs`: 16, `.stl`: 11 -- various CAD formats

**Google native files (4):**
- `PROPOSTA TECNICA` (Document) -- technical proposal
- `Automacao_IRIS` (Presentation) -- automation presentation
- `IRIS SCDS - Dimensionamento` (Spreadsheet) -- component sizing
- Equipment purchase list (Shortcut to another file)

**Issues found:**
- `Projeto Mecanico - BACKUP/` duplicates much of `Projeto Mecanico/`
- Typo in folder name: `Projeto elerico` should be `Projeto eletrico`
- Old file from 2015 suggests legacy content was included

---

### [03008] Hyundai Sealer

| Metric | Value |
|--------|-------|
| Files | 1,085 |
| Folders | 40 |
| Total Size | ~2.4 GB |
| Date Range | 2019-12-06 to 2026-02-19 (ACTIVE) |

**Top-level structure:**
- `00 - Contratacao/`
- `01 - Atas/` -- Meeting minutes
- `02 - CAD/` -- Multiple design iterations
  - `Previa_1_Camera/`, `Previa_2_Camera/` -- Preliminary designs
  - `Projeto_1_Camera/`, `Projeto_2_Camera/` -- Final designs with panels
  - `Painel Hyudai/` -- TYPO: should be "Hyundai"
  - `Componentes/` -- Component models
- `03 - Dimensionamento/` -- Detailed quotes from suppliers
  - `Orcamentos/` -- ATI Brasil, FW, Hikrobot, IGUS, KALATEC, OBR, UNION, VLV Group
  - `Documentacao Tecnica/` -- Linear axes, motors, RGB-D cameras
  - `Cronoanalise/` -- Time studies
- `04 - Planta/Layout da Celula/`

**File type distribution:**
- `.prt`: 714 (65.8%) -- NX CAD
- `.sldprt`/`.sldasm`: 190 (17.5%) -- SolidWorks parts/assemblies
- `.pdf`: 70
- `.dwg`: 15

**Google native files (6):**
- `2025.11.05_Hyundai_Sealer_Kickoff` (Presentation)
- `2025.12.11_Hyundai_Sealer_FollowUp` (Presentation)
- `Huyndai - Sealer` (Spreadsheet) -- another TYPO: "Huyndai"
- `Sealer - Dimensionamento` (Spreadsheet)
- `[03008] Requisitos Tecnicos` (Document)

**Issues found:**
- Multiple typos: "Hyudai", "Huyndai" (should be "Hyundai")
- Mixed CAD formats (NX `.prt` and SolidWorks `.sldprt`) suggest different engineers using different tools
- FEM analysis files (`.fem`, `.sim`, `.dat`, `.diag`) scattered in CAD folders

---

### [03009] ArcelorMittal Barra Mansa TL2

| Metric | Value |
|--------|-------|
| Files | 7 |
| Folders | 1 |
| Total Size | ~1.0 GB |
| Date Range | 2025-10-13 (single day) |

**Contents:** Only CAD plant layout files
- `PLANTA ARCELOR/`
  - `PLANTA ARCELOR 1 DWG.dwg` (199 MB)
  - `PLANTA ARCELOR 1 NWC.nwc` (18 MB)
  - `PLANTA ARCELOR 1.prt` (79 MB)
  - `PLANTA ARCELOR 2 DWG.dwg` (180 MB)
  - `PLANTA ARCELOR 2 NWC.nwc` (16 MB)
  - `PLANTA ARCELOR 2.prt` (81 MB)
  - `PLANTA ARCELOR COMPLETA.nwd` (445 MB)

**File type distribution:** DWG (2), NWC (2), PRT (2), NWD (1) -- all large CAD/BIM files

**Google native files:** None

**Assessment:** Barely populated. Only contains plant layout/BIM files from a single day. The project is in early stages. Likely needs 03002's folder structure replicated.

---

### [03010] VK Body Stellantis

| Metric | Value |
|--------|-------|
| Files | 5+ (shallow listing) |
| Folders | 7 |
| Total Size | ~53+ MB (root files only; subfolders still loading) |
| Date Range | 2025-10-07 to 2026-02-10 (ACTIVE) |

**Top-level structure:**
- `01 - CAD/`
- `[EXTERNO] Desenhos Portico/` -- External portico drawings
- `Ambiente Testes/` -- Test environment
- `CAD - POC - Renegade/` -- POC for Jeep Renegade
- `CAD - Portico - Commander/` -- Portico design for Jeep Commander
- `Data Science/` -- ML models
- `Proposta Tecnica/` -- Technical proposal
- Root files: project plan PDF/PPTX, test report PDF, database dump

**Google native files:** Not yet fully enumerated (background task still running on deep folders)

**Assessment:** Active project with automotive-specific CAD structures. Multiple vehicle models being targeted (Renegade, Commander). Uses a mix of naming conventions.

---

## 3. Non-Project Content

### 00 - Anotacoes Reunioes (Meeting Notes)

| Metric | Value |
|--------|-------|
| Files | 131 |
| Folders | 0 (flat structure) |
| Total Size | ~6.6 MB |
| Date Range | 2025-07-11 to 2026-02-11 |

**Content:** 100% Google Docs -- all auto-generated by Google Gemini from Google Meet recordings.

**Meeting types (by frequency):**
- **Daily Standup Meeting**: 95 notes (Jul 2025 - Feb 2026)
- **Inicio de Sprint**: 14 notes (Sprint start meetings, biweekly)
- **Encerramento de Sprint e Refinamento**: 11 notes (Sprint end + refinement)
- **Ad hoc meetings**: 5 (build reviews, feature specs, VK-body SCDS, layout definitions)

**Assessment:** Well-maintained agile ceremony documentation. Covers 8 months of daily standups. The flat file structure with date-based naming from Gemini is functional but would benefit from year/month subfolders for archive purposes.

### 000 - Cronograma Master

| Metric | Value |
|--------|-------|
| Files | 2 |
| Total Size | ~0.1 MB |

**Content:**
- `Infraestrutura - Cronograma` (Google Sheet) -- Infrastructure schedule
- `SIS - Cronograma` (Google Sheet) -- SIS system schedule

**Assessment:** Sparse. Last updated Oct 2024. May be stale.

### [03099] Documentation

| Metric | Value |
|--------|-------|
| Files | 11 |
| Total Size | ~185 MB |

**Content:** All PDFs -- reference materials for machine vision:
- Basler image processing fundamentals
- Computer vision algorithms textbooks
- Edmund Optics catalog (original + OCR version)
- Machine vision handbook
- Hikrobot camera catalogs (3 catalogs: photo-electric sensors, smart cameras, standard cameras)
- Academic review papers on deep learning for machine vision and steel production

**Assessment:** Good reference library. The Edmund Optics catalog exists in two versions (original + OCR) -- deduplicate. All files are from July 2024.

### Arquivos da simulacao CFD

| Metric | Value |
|--------|-------|
| Files | 3 |
| Total Size | ~64.4 MB |

**Content:** CFD thermal simulation for heating resistors:
- OpenFOAM CFD archive (ZIP)
- Two reports (DOCX) -- CFD OpenFOAM report and CFD experimental report

**Issues:** This content duplicates files in `[03000] Desenvolvimento/02 - Analise termica das resistencias/`. Should be consolidated.

---

## 4. IRIS-Specific Analysis (03005, 03006, 03007)

### Project Relationship

| Code | Name | Type | Status | Size |
|------|------|------|--------|------|
| 03005 | IRIS GM-Paint Shop SCDS (POC) | POC | Legacy/Transitioning | 55.7 GB |
| 03006 | IRIS GM-Body/Paint GVT (POC) | POC | **Active** (today) | 46.0 GB |
| 03007 | IRIS GM-Paint Shop SCDS | Production | **Active** | 11.6 GB |

### Overlap Analysis

1. **03005 -> 03007 evolution:** 03005 was the POC for paint shop SCDS, and 03007 is the production deployment of the same concept. They share:
   - Similar folder numbering (`000 - Cronograma Master`, `01 - Kick-Off`, `02 - CADs`, etc.)
   - Both reference "SCDS" (Surface Coating Defect System)
   - 03005 contains the legacy `98 - VISION MASTER` backup and massive training datasets
   - 03007 has active purchasing, electrical design, and automation content

2. **03006 is a separate GVT scope:** Body/Paint GVT (Gravataí plant) is a different inspection point than SCDS. It focuses on semi-portico installations in both body shop and paint shop areas.

3. **Shared resources:**
   - `Dimensionamento Componentes IRIS` spreadsheet appears in 03006 root -- likely shared across IRIS projects
   - Camera models (N15, N6) referenced in 03007 may be the same used in 03006
   - Blender simulation workflows appear in both 03006 and 03007

4. **Data migration concern:** 03005 holds 44K+ BMP training images (43 GB) that likely need to be referenced by 03007 but should not be duplicated.

---

## 5. ArcelorMittal Analysis (03002, 03009)

### Relationship

| Code | Name | Focus | Size | Files |
|------|------|-------|------|-------|
| 03002 | ArcelorMittal Barra Mansa | TL1 (original line) | 78.8 GB | 12,720 |
| 03009 | ArcelorMittal Barra Mansa TL2 | TL2 (second line) | 1.0 GB | 7 |

### Analysis

- **03002** is the mature, fully-developed project with 245 folders, 35 Google native files, and content spanning from proposal through multiple installation campaigns. It follows a WP (Work Package) structure.
- **03009** is barely started -- only plant layout CAD files from a single day (2025-10-13). It will likely replicate 03002's structure once the project ramps up.
- The "TL2" designation suggests a second production line getting the same VisionKing system.
- 03009 will likely reuse much of 03002's mechanical designs, software configurations, and ML models, adapted for the second line's geometry.

---

## 6. Issues Found

### Critical Issues

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **Python codebase on Drive** | 03000/ultralytics_custom/ | Full Ultralytics fork with __pycache__ -- should be in Git |
| 2 | **Massive uncompressed BMPs** | 03000, 03005 | ~90 GB of raw BMP images that should use compressed formats or cloud storage |
| 3 | **Windows PC backup on Drive** | 03005/98-VISION MASTER/ | Contains PassMark benchmarks, Lightshot screenshots, desktop files |
| 4 | **Executable file** | 03003/OneDrive/.../Documentacao do Projeto...exe | Security concern |
| 5 | **Duplicated CFD files** | Root + 03000 | Same CFD reports and archives in two locations |

### Naming Issues

| # | Issue | Location |
|---|-------|----------|
| 1 | "Hyudai" / "Huyndai" (should be "Hyundai") | 03008 folder names |
| 2 | "Projeto elerico" (should be "eletrico") | 03007/03 - Projeto Eletrico/ |
| 3 | "Retrinamento" (should be "Retreinamento") | 03006/03 - Dados/ |
| 4 | "Stelantis" (should be "Stellantis") | 03000/dataset/ |
| 5 | Inconsistent accents: "Anotacoes" vs "Anotacoes" | Various |

### Structural Issues

| # | Issue | Details |
|---|-------|---------|
| 1 | **Inconsistent folder numbering** | 03002 uses `[00]`-`[99]` + WP structure; 03005 uses `000`-`99`; 03007 uses `00`-`03`; 03008 uses `00`-`04` |
| 2 | **Duplicate backup folders** | 03007 has both `Projeto Mecanico/` and `Projeto Mecanico - BACKUP/` |
| 3 | **Duplicated OneDrive structure** | 03003 has both `__Pasta compartilhada com a EP` and `Pasta compartilhada com a EP` |
| 4 | **Empty/near-empty projects** | 03009 has only 7 files |
| 5 | **Mixed CAD formats** | 03008 mixes NX (.prt) and SolidWorks (.sldprt) -- tooling inconsistency |

---

## 7. Subfolder Pattern Analysis

### Common patterns across projects

| Pattern | Projects Using It | Notes |
|---------|-------------------|-------|
| Numbered top-level folders (`00 -`, `01 -`, ...) | 03001, 03003, 03005, 03006, 03007, 03008 | Most common |
| Bracketed numbered folders (`[00]`, `[01]`, ...) | 03002 | Most organized |
| Work Package structure (`[WP1]`, `[WP2]`, ...) | 03002 | Only one project |
| `CAD/` subfolder | 03005, 03006, 03007, 03008, 03010 | Universal for hardware projects |
| `Escopo/` or `Contratacao/` | 03006, 03007, 03008 | Contract/scope documents |
| `Dados/` or `Data Science/` | 03002, 03006, 03010 | ML/data folders |
| `Atas/` or `Atas de Reunioes/` | 03002, 03005, 03008 | Meeting minutes |
| `Cronograma/` | 03002, 03005 | Schedule tracking |

### Recommended standard structure (based on 03002 as best practice):

```
[03xxx] Project Name/
  [00] Escopo e Contratacao/
  [01] Apresentacoes/
  [02] Cronograma/
  [03] CAD/
    Projeto Mecanico/
    Projeto Eletrico/
  [04] Manuais e Entrega Tecnica/
  [05] Status Report/
  [10] Data Science/
    Modelos/
    Datasets/
  [20] Compras e Orcamentos/
  [90] Atas de Reunioes/
  [99] Documentos Gerais/
```

---

## 8. Google Native Files Inventory

### Summary

| Type | Count | Projects |
|------|-------|----------|
| Google Docs | ~30+ | 03002, 03005, 03007, 03008, meeting notes |
| Google Sheets | ~30+ | All projects with sizing/tracking needs |
| Google Presentations | ~15+ | 03002, 03005, 03006, 03007, 03008 |
| Google Shortcuts | 2 | 03006, 03007 |

### Key Google Sheets (by purpose)

| Document | Project | Purpose |
|----------|---------|---------|
| Vision King - Tasks | 03000 | Task tracker |
| Infraestrutura - Cronograma | Root/Cronograma | Infrastructure schedule |
| SIS - Cronograma | Root/Cronograma | System schedule |
| [03002] Cronograma | 03002 | Project schedule |
| Dimensionamento Componentes | 03002, 03006 | Component sizing |
| Simulacao software cenarios | 03002 | Software simulation scenarios |
| RELATORIO - CAMPANHAS | 03002 | Campaign reports |
| Iris - Tasks | 03005 | IRIS task tracker |
| Matriz de Confusao GM IRIS | 03005 | ML confusion matrix |
| IRIS SCDS - Dimensionamento | 03007 | Component sizing |
| Sealer - Dimensionamento | 03008 | Component sizing |
| VisionKing_POC_GVT_defeitos | 03006 | Defect tracking |

### Key Google Docs

| Document | Project | Purpose |
|----------|---------|---------|
| Manual VisionKing - Arcelor Mittal | 03002 | Operation manual (Rev.1 & Rev.2) |
| Manual Spot Fusion - Geral | 03002 | General SpotFusion manual (misplaced?) |
| PROPOSTA TECNICA | 03007 | Technical proposal |
| [03008] Requisitos Tecnicos | 03008 | Technical requirements |
| Guia rapido montagem - IRIS | 03005 | Quick assembly guides |
| IRIS - Relatorio GM SCDS | 03005 | Installation report |

---

## 9. PORTICO IRIS GM Drive

**Drive ID:** `0AHJ0NFg-OqZJUk9PVA`

### Structure

Single folder at root: `Portico - GM SCS/` containing 153 files with NO subfolders.

| Metric | Value |
|--------|-------|
| Files | 153 |
| Folders | 0 |
| Total Size | ~2.8 GB |
| Date Range | 2024-08-21 to 2024-10-15 |

### Content Analysis

This is a **flat dump of CAD files** for the IRIS portico structure at GM's plant:

- **132 `.prt` files** (86.3%) -- NX CAD parts for the portico structure
  - Assembly files: `assembly1.prt` (13.6 MB), mounting files
  - Structural profiles: `Perfil 35x35.prt`, `01-2001_Perfil45x60.prt`
  - Hardware: bolts (`PARAFUSO ALLEN M6X16...`), nuts (`PORCA M6/M8`), washers
  - Camera supports: `suporte camera.prt`, `foco - n15.prt`
  - Heating elements: `01-1200-Montagem resistencia.prt`, thermostat parts
  - Vehicle body-in-white models: 3 massive files (700MB-1.1GB each)
    - `TKV106_AUK80000_New Montana` (1.09 GB)
    - `TKV206_AMZ88000_Tracker` (1.0 GB)
    - `TKVBJ2502_1JP75_Premier_Synch` (689 MB)
- **Computer peripherals**: keyboard, mouse, monitor, chair CAD files (for workstation design)
- **Misc**: `desktop.ini`, `.FCStd` (FreeCAD), `.STL`, `.SLDPRT` files

### Relationship to VK Drive

This is clearly the CAD workspace for the IRIS portico mechanical design that feeds into projects 03005/03006/03007. The 3 large vehicle body files (Montana, Tracker, Premier) are the mathematical models of GM vehicles that the portico is designed around.

### Issues

- **No folder structure at all** -- 153 files in a single flat directory
- **Vehicle body models take up 2.8 GB** of the 2.86 GB total -- these should be in a dedicated `PKG` or `Modelos Matematicos` subfolder
- Contains `desktop.ini` (Windows artifact)
- File naming is inconsistent (some with numbered prefixes `01-xxxx-`, some descriptive, some from external suppliers)
- This content overlaps with `01 - CAD/` folders in 03006 and 03007

---

## 10. Recommendations Summary

1. **Standardize folder structure** across all projects using 03002's pattern as a template
2. **Move training datasets** (BMP files, 90+ GB) to a dedicated storage solution (GCS bucket, DVC)
3. **Remove Python codebase** from Drive (03000/ultralytics_custom/) -- use Git
4. **Clean up Windows artifacts** (desktop.ini, PassMark, exe files)
5. **Fix typos** in folder names (Hyudai, Huyndai, elerico, Retrinamento, Stelantis)
6. **Consolidate duplicate content** (CFD files, backup folders)
7. **Organize PORTICO drive** into proper subfolders
8. **Set up 03009** with proper folder structure before it accumulates files chaotically
9. **Archive 03003** -- it appears complete (technology transfer done), contents mostly ZIP archives
10. **Create a "Manual Spot Fusion" should be in the SpotFusion drive**, not VisionKing 03002
