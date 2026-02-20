# [01] SMART DIE - Google Shared Drive Audit Report

**Drive ID:** `0ALpYWXApVGjKUk9PVA`
**Audit Date:** 2026-02-20
**Status:** READ-ONLY deep scan completed

---

## 1. Drive Overview

### Summary Statistics

| Metric | Value |
|--------|-------|
| **Total top-level items** | 21 (16 non-project folders + 5 project folders + 1 root spreadsheet) |
| **Total files (all folders)** | ~39,361 |
| **Total folders** | ~1,510 |
| **Estimated total size** | ~153 GB |
| **Date range** | 2021-02-08 to 2026-02-16 |
| **Google-native files** | ~132 (116 meeting notes + 2 cronogramas + 11 in [01000] + 3 in projects) |

### Size Distribution by Folder

| Folder | Files | Folders | Size (MB) | % of Total |
|--------|------:|--------:|----------:|-----------:|
| [01003] DEV-JVL-Novo_Corsa | 960 | 38 | 38,484 | 25.1% |
| [01001] GM-SJC-S10_CC_LE | 4,217 | 72 | 23,199 | 15.1% |
| 80 - Teste de Calibracao Gap | 1,804 | 201 | 44,974 | 29.3% |
| 90 - Novos Estudos | 26,524 | 46 | 14,167 | 9.2% |
| 99 - PROTOTYPE SPECS | 1,840 | 201 | 9,796 | 6.4% |
| [01002] GM-FLINT_Bravada_Fender | 347 | 20 | 5,710 | 3.7% |
| Arquivos projeto Ferramentaria 4.0 | 117 | 27 | 5,602 | 3.7% |
| [01005] DEMESTAA/DECOLAB 2 | 1,260 | 52 | 4,253 | 2.8% |
| [01004] STELLANTIS-DEMO | 265 | 5 | 2,633 | 1.7% |
| 99 - Referencias | 1,540 | 460 | 1,611 | 1.1% |
| 01 - Implementacoes | 169 | 2 | 928 | 0.6% |
| [01000] Desenvolvimento | 430 | 99 | 890 | 0.6% |
| 40 - Hardware | 1,964 | 163 | 549 | 0.4% |
| 10 - Comunicacao | 6 | 1 | 50 | <0.1% |
| 30 - Compras | 75 | 23 | 47 | <0.1% |
| 98 - MIDIA | 41 | 1 | 192 | 0.1% |
| Documentos de Instalacao | 6 | 0 | 7 | <0.1% |
| 00 - Anotacoes Reunioes | 116 | 0 | 5 | <0.1% |
| 81 - Teste de Precisao Draw-In | 1 | 0 | 4 | <0.1% |
| 20 - Software | 3 | 0 | 1 | <0.1% |
| 000 - Cronograma Master | 2 | 0 | 0.1 | <0.1% |

---

## 2. Per-Project Breakdown

### [01001] GM-SJC-S10_CC_LE
**Client:** General Motors | **Plant:** Sao Jose dos Campos | **Part:** S10 Cabin Corner Left External

| Metric | Value |
|--------|-------|
| Files | 4,217 |
| Folders | 72 |
| Size | 23.2 GB |
| Date range | 2022-05-09 to 2026-02-16 (oldest modified: 2021-02-08) |
| Max depth | 9 |

**Folder Structure (depth-1):**
- `00 - DADOS` -- Data processing (classification, curve_selection)
- `01 - CAD` -- CAD files: BD24-03701 die assembly, SolidWorks, NX, STEP/JT exports
- `02 - Formability` -- PAM-Stamp formability analysis
- `03 - Alteracao Case Draw-In` -- Casing redesign versions (v00, v01)
- `04 - Manufatura` -- Manufacturing files
- `05 - Lista de Itens` -- Bill of materials
- `06 - Preparacao Instalacao` -- Installation preparation (CAD, quotes, purchase orders)
- `98 - PTPs` -- Project technical plans
- `99 - MIDIA` -- Media (photos, videos)
- `Simulacao PAM-Stamp` -- Stamping simulation (ATT files)

**File Types:**
- `.sldprt` (1,550) -- SolidWorks parts (dominant)
- `.prt` (924) -- NX/Siemens parts
- `.pdf` (885) -- Documentation
- `.jt` (333) -- JT visualization
- `.stp` (135) -- STEP interchange
- Others: `.jpg`(87), `.sldasm`(81), `.csv`(31), `.log`(40), `.xlsx`(12), `.glb`(12), `.py`(10), `.stl`(10), `.att`(6), `.dwg`(5)

**Google-native files (35):**
- 3 Presentations: "Analise de montagem Draw-In", "Teste de Tracao", "Esboco Painel Intermediario"
- 1 Spreadsheet: "SmartDie - Topologia"
- 31 Shortcuts: All JPG image shortcuts in `99 - MIDIA/2023.10.20_Desmontagem_cromagem/`

**Issues Found:**
- **Massive duplicates**: 100+ duplicate filename groups. Worst offenders:
  - `01-3108-case-cover.002.*` (x13 each for .pdf, .log, .stp)
  - `01-3113-case-cover.001.*` (x13 each)
  - Many PCB component `.prt` files exist x3-x5 (SolidWorks+NX+STEP exports stored as separate files)
- **"Copia" files**: `Copia de 2023.03.21_smartdie_drawin_failure_mode.pptx` at root
- **Copy files**: `keep_df copy.csv` in curve_selection
- **Root-level loose files (8)**: Junction box PDF, failure mode analysis, measurements -- should be in subfolders

---

### [01002] GM-FLINT_Bravada_Fender
**Client:** General Motors | **Plant:** Flint, MI (USA) | **Part:** Bravada Fender

| Metric | Value |
|--------|-------|
| Files | 347 |
| Folders | 20 |
| Size | 5.7 GB |
| Date range | 2023-01-24 to 2024-12-11 (oldest modified: 2021-11-19) |
| Max depth | 5 |

**Folder Structure (depth-1):**
- `00 - Documentation` -- Project documentation
- `01 - CAD` -- CAD data (multiple `.iman` assembly versions, PKG emails from GM)
- `02 - Manufatura casings` -- Casing manufacturing
- `03 - Manufatura Sensores` -- Sensor manufacturing
- `99 - Planejamento` -- Planning (Cronograma, Comunicacao)

**File Types:**
- `.prt` (284) -- NX parts (dominant -- GM uses NX/Teamcenter)
- `.pdf` (16), `.zip` (9), `.stp` (7), `.tso` (6), `.log` (6), `.xlsx` (5), `.pptx` (4), `.clone` (4)

**Google-native files (1):**
- 1 Presentation: "2024.05.06_Bravada_Fender_Design_review"

**Issues Found:**
- **Heavy duplicates**: 50+ duplicate groups. Many `.prt` files exist x3 (likely across multiple `.iman` assembly versions)
- **Root-level loose files (5)**: Including `Casings_manufacture.zip` and `Manufatura casings.zip` (likely duplicates)
- **PKG folders from email**: Files received from `kevin.cavanaugh@gm.com` and `renato.cabrera@gm.com` stored directly with email subject as folder name

---

### [01003] DEV-JVL-Novo_Corsa
**Client:** Internal Development | **Plant:** Joinville | **Part:** Novo Corsa (Schulz training die)

| Metric | Value |
|--------|-------|
| Files | 960 |
| Folders | 38 |
| Size | 38.5 GB (LARGEST project by size) |
| Date range | 2023-06-01 to 2025-11-10 |
| Max depth | N/A |

**Folder Structure (depth-1):**
- `2024-09-04_TEST SCHULZ` -- Test session at Schulz press
- `CAD matriz` -- Die CAD
- `Contratacao Destak` -- Outsourced manufacturing (Destak supplier)
- `Digitalizacoes` -- 3D scanning data
- `Enviar Destak` -- Files to send to Destak
- `LPN SUPERFICIE_remodelado_com_offset` -- Reworked lower punch surface
- `Montagem matriz e sensores - V1` / `V2` -- Two assembly versions
- `Simulacao PAM-Stamp` -- Stamping simulation
- `Tratamento_montagem` -- Assembly treatment

**File Types:**
- `.prt` (718) -- NX parts (dominant)
- `.jpg` (62), `.pdf` (46), `.log` (36), `.stp` (34), `.csv` (18), `.mov` (13), `.stl` (10), `.att` (4)

**Google-native files (2):**
- 2 Spreadsheets: "Ensaios Smart Die - 04/09" (test results), "Orcamento Destak" (supplier quote)

**Issues Found:**
- **Extreme duplication**: 150+ duplicate groups. Every CAD part and cutout exists in both V1 and V2 assembly folders
- **2 empty subfolders**: `Montagem matriz e sensores - V1/SW`, `Montagem matriz e sensores - V1/arquivos desatualizados/SW`
- **"Copia" files**: `01-2100L-case-long.001 - Copia.prt` in both V1 and V2
- **Large `.mov` files (13)**: Test session videos -- consider moving to media folder
- **Massive STEP files**: Single STEP files up to 206 MB

---

### [01004] STELLANTIS-DEMO
**Client:** Stellantis | **Type:** Demo/Proof-of-concept

| Metric | Value |
|--------|-------|
| Files | 265 |
| Folders | 5 |
| Size | 2.6 GB |

**Folder Structure (depth-1):**
- (Data not fully expanded -- 5 subfolders)

---

### [01005] DEMESTAA/DECOLAB 2
**Client:** DEMESTA/DECOLAB | **Type:** Customer deployment (phase 2)

| Metric | Value |
|--------|-------|
| Files | 1,260 |
| Folders | 52 |
| Size | 4.3 GB |

---

## 3. Non-Project Content Analysis

### 00 - Anotacoes Reunioes (Meeting Notes)
**116 Google Docs** -- All Gemini-generated meeting notes (no subfolders)

**Meeting types identified:**
| Type | Count | Date Range |
|------|------:|-----------|
| Daily Standup Meeting | ~80 | 2025-07-15 to 2026-02-11 |
| Inicio de Sprint (Sprint Start) | ~16 | 2025-07-14 to 2026-02-09 |
| Encerramento de Sprint e Refinamento | ~8 | 2025-07-11 to 2026-02-06 |
| Ad-hoc meetings | ~5 | Various |
| PCB-specific reviews | ~3 | 2025-07-31, 2025-08-20, 2025-09-02 |
| Front/back meeting | 1 | 2025-10-28 |

**Observations:**
- All auto-generated by Google Gemini from Google Meet recordings
- Timezone inconsistency: Most use `GMT-03:00`, some use `CST` (Jan 2026), some use `EST` (Jan-Feb 2026)
- One duplicate session on 2026/01/07 (08:30 AND 09:13)
- Sprint cadence: 2-week sprints, well-maintained

### 000 - Cronograma Master
**2 Google Sheets:**
- `Smart Die - Cronograma` -- Master schedule (last modified 2024-07-23 -- **7 months stale**)
- `Smart Die - Tasks` -- Task tracker (last modified 2025-01-24 -- **13 months stale**)

### 01 - Implementacoes
**169 files, 928 MB** -- Contains a single subfolder `2023-05 - DEMESTA/DECOLAB` with 159 `.prt` files from a CATIA/NX stamping die. Also has a root-level `Specifications Smart Die.xlsx`.
- This is **legacy content** predating the project code system
- The DECOLAB files overlap with project [01005]

### 10 - Comunicacao
**6 files, 50 MB** -- Marketing/communication materials (likely presentations and videos)

### 20 - Software
**3 files, 1.4 MB** -- Software-related documents (minimal)

### 30 - Compras (Purchases)
**75 files, 23 folders, 47 MB** -- Purchase orders, supplier quotes, and procurement tracking

### 40 - Hardware
**1,964 files, 163 folders, 549 MB** -- Electronics and PCB design files
- Contains PCB schematics, component datasheets, BOM lists
- Multiple revision folders for PCB designs
- Likely KiCad and NX/SolidWorks PCB-related files

### 80 - Teste de Calibracao Gap
**1,804 files, 201 folders, 45 GB** -- **Second-largest folder by size**
- Gap sensor calibration test data
- Large dataset of measurement files
- Multiple test sessions with timestamped folders

### 81 - Teste de Precisao Draw-In
**1 file, 4.2 MB** -- Draw-in precision test (nearly empty -- just started or abandoned)

### 90 - Novos Estudos (New Studies)
**26,524 files, 46 folders, 14.2 GB** -- **Largest folder by file count**
- Research and experimental studies
- Contains massive datasets of experimental results
- CAD files, simulation results, measurement data

### 98 - MIDIA
**41 files, 1 folder, 192 MB** -- Media files (photos, videos) from various sessions

### 99 - PROTOTYPE SPECS
**1,840 files, 201 folders, 9.8 GB** -- Prototype specifications and engineering data

### 99 - Referencias
**1,540 files, 460 folders, 1.6 GB** -- Reference materials
- Contains `Smart Die - Documentos Fase Anterior` (legacy phase documents)
- Academic papers, datasheets, supplier catalogs
- **460 folders** suggests a deeply nested reference library

### [01000] Desenvolvimento (Development)
**430 files, 99 folders, 890 MB** -- Cross-project development resources

**Google-native files (11):**
- `SMART DIE - PLANO DE PROJETO E RELATORIO DE EXECUCAO [INTERNO]` (document)
- `Smart Die - SODW - Summary of Requirements` (document)
- `Smart Die - SODW - Part Specifications` (document)
- `Smart Die - SODW - Technical Specifications` (document)
- `Smart Die - IOT - Especificacoes Comunicacao` (document)
- `SMART DIE - Lista de Equipamentos 2.0` (spreadsheet)
- `Smart Die - System Overview - Draft` (document)
- Additional planning and specification documents

Contains: equipment specifications, PCB designs (KiCad), requirements documents, IoT communication specs

### Arquivos projeto Ferramentaria 4.0
**117 files, 27 folders, 5.6 GB** -- **Legacy/predecessor project** (Ferramentaria 4.0)
- Predates the Smart Die branding
- Contains old CAD files and project documentation

### Documentos de Instalacao
**6 files, 7 MB** -- Installation documentation (minimal)

### Root-level: Atividades Smart Die (Spreadsheet)
**1 Google Sheet** -- Activity tracking (sheet name: "Pagina1")

---

## 4. Issues Found

### 4.1 Critical Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | **Massive file duplication** | HIGH | All project folders |
| 2 | **No unified naming convention** | HIGH | Drive-wide |
| 3 | **Stale planning documents** | MEDIUM | 000 - Cronograma Master |
| 4 | **Legacy content mixed with active** | MEDIUM | 01 - Implementacoes, Ferramentaria 4.0 |
| 5 | **Root-level loose files in projects** | LOW | [01001], [01002] |

### 4.2 Duplication Analysis

**Total estimated duplicate file groups:** 300+

**Duplication patterns observed:**
1. **Multi-format exports**: Same part exported as `.prt` + `.stp` + `.log` + `.pdf` -- all stored flat in the same folder (e.g., `Cavidade GAP` exists as `.prt`, `.stp`, `.log`, `_stp.prt`, `_stp.pdf`)
2. **Version folder copies**: Entire assembly versions (V1, V2) contain identical files (01003 has V1 and V2 with 150+ shared files)
3. **PCB component clones**: SolidWorks electronic component footprint files (`.prt`) appear x3-x5 across multiple PCB design folders
4. **Case cover revisions**: `01-3108-case-cover.002.*` appears 13 times, `01-3113-case-cover.001.*` appears 13 times
5. **"Copia de" files**: Portuguese-language copy prefixes scattered across projects
6. **PKG email attachments**: Files from email stored as-is with no deduplication

### 4.3 Naming Inconsistencies

- **Mixed case**: `CAD matriz` vs `CAD Front` vs `cad`
- **Mixed separators**: Underscore (`curve_selection`), hyphen (`CAD Front`), space (`Lista de Itens`), date prefix (`2024-09-04_TEST SCHULZ`)
- **Mixed languages**: Portuguese (`Anotacoes Reunioes`, `Compras`) and English (`Documentation`, `Source`)
- **Inconsistent date formats**: `2023.03.21` vs `2024-09-04` vs `2023.10.20`
- **Numeric prefixes**: `00 -`, `01 -`, `99 -` used inconsistently (some with space-dash-space, some without)
- **Project code brackets**: `[01001]` vs `[01000]` vs no bracket (e.g., `Arquivos projeto Ferramentaria 4.0`)

### 4.4 Empty/Nearly Empty Folders

| Folder | Issue |
|--------|-------|
| `81 - Teste de Precisao Draw-In` | 1 file only |
| `[01003] .../V1/SW` | Empty |
| `[01003] .../V1/arquivos desatualizados/SW` | Empty |

---

## 5. Subfolder Patterns

### Project Folder Template (Observed)

Projects loosely follow this structure:
```
[NNNNN] CLIENT-PLANT_Part_Name/
  00 - DADOS (or Documentation)
  01 - CAD
  02 - Formability (or Manufatura casings)
  03 - Alteracao / Manufatura Sensores
  04 - Manufatura
  05 - Lista de Itens
  06 - Preparacao Instalacao
  98 - PTPs (or Planejamento)
  99 - MIDIA
  Simulacao PAM-Stamp
```

**Consistency issues:**
- [01001] uses `00 - DADOS`, [01002] uses `00 - Documentation`
- [01001] has `98 - PTPs`, [01002] has `99 - Planejamento`
- [01003] has no numbered folders -- uses descriptive names only
- Not all projects have all folders

### Non-Project Folder Numbering

The non-project folders use a prefix numbering scheme:
```
00  - Anotacoes Reunioes (meeting notes)
000 - Cronograma Master (master schedule)
01  - Implementacoes (implementations)
10  - Comunicacao (marketing)
20  - Software
30  - Compras (procurement)
40  - Hardware (electronics)
80  - Teste de Calibracao Gap (test data)
81  - Teste de Precisao Draw-In (test data)
90  - Novos Estudos (R&D)
98  - MIDIA (media)
99  - PROTOTYPE SPECS / Referencias (reference)
```

**Gaps in numbering**: 02-09, 11-19, 21-29, 31-39, 41-79, 82-89, 91-97 are unused.

---

## 6. Google-native Files Inventory

### Google Docs (~120)

| Location | Count | Content |
|----------|------:|---------|
| 00 - Anotacoes Reunioes | 116 | Gemini meeting notes (Daily Standup, Sprint Start, Sprint Close, Ad-hoc) |
| [01000] Desenvolvimento | ~6 | Project plan, requirements, specs, IoT specs, system overview |

**Key documents in [01000] Desenvolvimento:**
- `SMART DIE - PLANO DE PROJETO E RELATORIO DE EXECUCAO [INTERNO]`
- `Smart Die - SODW - Summary of Requirements`
- `Smart Die - SODW - Part Specifications`
- `Smart Die - SODW - Technical Specifications`
- `Smart Die - IOT - Especificacoes Comunicacao`
- `Smart Die - System Overview - Draft`

### Google Sheets (~7)

| Location | Name | Last Modified |
|----------|------|--------------|
| Drive root | Atividades Smart Die | Unknown |
| 000 - Cronograma Master | Smart Die - Cronograma | 2024-07-23 |
| 000 - Cronograma Master | Smart Die - Tasks | 2025-01-24 |
| [01000] Desenvolvimento | SMART DIE - Lista de Equipamentos 2.0 | Unknown |
| [01001] | SmartDie - Topologia | Unknown |
| [01003] | Ensaios Smart Die - 04/09 | Unknown |
| [01003] | Orcamento Destak | Unknown |

### Google Slides (~4)

| Location | Name |
|----------|------|
| [01001] | 2025.09.23_Matriz S10_Analise de montagem Draw-In |
| [01001] | Teste de Tracao |
| [01001] | Esboco Painel Intermediario |
| [01002] | 2024.05.06_Bravada_Fender_Design_review |

### Google Drive Shortcuts (31)

All in `[01001]/99 - MIDIA/2023.10.20_Desmontagem_cromagem/` -- JPG image shortcuts.

---

## 7. Recommendations for Reorganization

### 7.1 Standardize Project Folder Template

```
[NNNNN] CLIENT-PLANT_Part/
  00 - Dados/                   # Raw data, measurements, test results
  01 - CAD/                     # All CAD files (NX, SW, CATIA, STEP, JT)
    01.1 - Source/              # Native format masters
    01.2 - Exports/             # STEP, JT, PDF exports (generated, not stored alongside source)
  02 - Simulacao/               # PAM-Stamp, formability analysis
  03 - Manufatura/              # Manufacturing files, quotes
  04 - Instalacao/              # Installation prep, wiring, topology
  05 - BOM/                     # Bill of materials, component lists
  10 - Documentacao/            # PDFs, reports, PTPs
  90 - Midia/                   # Photos, videos
  99 - Planejamento/            # Cronograma, communication
```

### 7.2 Separate Test Data from Project Data

Move `80 - Teste de Calibracao Gap` (45 GB) and `81 - Teste de Precisao Draw-In` to a dedicated `[01000] Desenvolvimento/Testes/` subfolder or a separate "Test Data" section.

### 7.3 Archive Legacy Content

Move to an `_ARQUIVO/` folder:
- `01 - Implementacoes` (predates project code system)
- `Arquivos projeto Ferramentaria 4.0` (predecessor project)
- `99 - Referencias/Smart Die - Documentos Fase Anterior`

### 7.4 Deduplicate CAD Files

The #1 storage optimization opportunity. Estimated savings: **30-40%** of total drive space.
- Eliminate multi-version folder copies (V1/V2 with identical files)
- Keep only latest revision of PCB component exports
- Remove `.log` files from CAD exports (can be regenerated)
- Remove duplicate STEP exports when source `.prt` exists

### 7.5 Consolidate "90 - Novos Estudos"

At 26,524 files, this is the single largest folder. It needs internal organization:
- Create subfolders by study topic
- Archive completed studies
- Move any project-specific content into the appropriate `[01NNN]` folder

### 7.6 Update Stale Planning Documents

- `Smart Die - Cronograma` last modified July 2024 -- update or mark as superseded
- `Smart Die - Tasks` last modified January 2025 -- update or replace

---

## 8. File Type Summary (Drive-wide)

### CAD Files (~32,000+)
| Extension | Description | Estimated Count |
|-----------|-------------|---------------:|
| `.prt` | NX/Siemens | ~28,000 |
| `.sldprt` | SolidWorks Parts | ~1,550 |
| `.sldasm` | SolidWorks Assemblies | ~81 |
| `.stp/.step` | STEP interchange | ~500+ |
| `.jt` | JT visualization | ~333 |
| `.dwg` | AutoCAD | ~5 |
| `.dxf` | DXF interchange | ~10 |
| `.igs/.iges` | IGES interchange | ~5 |
| `.stl` | STL mesh | ~20+ |
| `.glb/.gltf` | 3D web format | ~14 |
| `.x_t` | Parasolid | ~5 |
| `.catpart/.catproduct` | CATIA (as .prt) | ~150+ |

### Documents (~1,000+)
| Extension | Estimated Count |
|-----------|---------------:|
| `.pdf` | ~950 |
| `.xlsx/.xls` | ~30 |
| `.pptx` | ~20 |
| `.txt` | ~10 |
| `.csv` | ~50 |

### Simulation/Test
| Extension | Description | Count |
|-----------|-------------|------:|
| `.att` | PAM-Stamp simulation | ~14 |
| `.tso` | TSO data | 6 |
| `.clone` | Clone files | 4 |

### Media
| Extension | Count |
|-----------|------:|
| `.jpg/.jpeg` | ~150 |
| `.png` | ~12 |
| `.mov` | ~13 |
| `.mp4` | ~2 |

---

*Report generated by JARVIS Orchestrator - Deep Drive Audit*
*Source data: Google Drive API v3 recursive scan via google-workspace MCP server*
