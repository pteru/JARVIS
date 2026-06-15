---
name: clickup-navigator
description: Navigate the Strokmatic ClickUp workspace structure. Load this when working with ClickUp tasks, sprints, folders, or workspace hierarchy. Contains the full structural map, ID reference, and operational rules.
user-invocable: false
---

# Strokmatic ClickUp Workspace Navigator

## Workspace

- **Workspace ID:** `3081126`
- **Primary Space:** TÉCNICO (`3164545`) — all engineering task tracking

## TÉCNICO Space — Complete Hierarchy

### Regular Folders (where tasks SHOULD live as primary location)

#### [01] SMART DIE — Folder ID: `7213380`

| List | ID | Purpose |
|---|---|---|
| [01001] Implantação SJC-S10-CC | `900701761455` | Project: GM São José dos Campos |
| [01002] Implantação Flint-Fender | `900701761583` | Project: GM Flint |
| [01003] Implantação Matriz Schulz | `901107101261` | Project: Schulz die |
| [01004] Implantação GM-Pontiac | `901109507788` | Project: GM Pontiac |
| [01] Documentação | `901107838638` | Cross-project documentation |
| [01] Projeto Eletrônico | `210907230` | Electronics/PCB design |
| [01] Projeto Mecânico | `901107101206` | Mechanical design |
| [01] Software | `205149538` | All software tasks |
| [01] Front/Back | `901107321727` | Frontend + backend |
| [01] Testes Integrados Internos | `901107321788` | Internal integration testing |
| [01] Modelos (Production) | `901107101218` | ML models for production |
| [01] Calibração Gap (Tryout) | `900700642173` | Gap sensor calibration |
| [01] Reconstrução Superfície (Tryout) | `901107101221` | Surface reconstruction |
| [01900] Die Tracker | `901109507791` | Die tracking application |

#### [02] SPOT FUSION — Folder ID: `7213400`

| List | ID | Purpose |
|---|---|---|
| [02001] Implantação GM-SJC-Tampa | `217010888` | Project: GM SJC lid |
| [02002] Implantação GM-GVT-BSO | `900701787578` | Project: GM Gravataí BSO |
| [02003] Implantação GM-FZ-LA/RA | `900701787589` | Project: GM Fazenda Rio Grande |
| [02004] Implantação GM-GVT-BSIDE | `901109508048` | Project: GM Gravataí B-Side |
| [02005] Implantação GM-SCDS-Portas | `901109508049` | Project: GM São Caetano doors |
| [02006] Implantação HYUNDAI-FLOOR | `901110860515` | Project: Hyundai floor |
| [02] Laboratório | `217010844` | Lab experiments & welding |
| [02] Hardware | `217010835` | Hardware/electronics |
| [02] Software | `901109560051` | All software tasks |
| [02] Modelos | `901109635130` | ML models |
| [02] Documentação | `901109508050` | Documentation |
| [02] Industrial Edge | `901109659624` | Edge computing |

#### Todas as tarefas (VisionKing regular) — Folder ID: `90071039181`

| List | ID | Purpose |
|---|---|---|
| [03001] Usiminas-Inovaí-Corpo Estranho | `901109407839` | Project: Usiminas foreign body |
| [03002] Arcelor Barra Mansa | `901109407841` | Project: ArcelorMittal BM |
| [03003] GM-Underbody | `901109407844` | Project: GM underbody |
| [03004] Santista-Tribunal | `901109407848` | Project: Santista (completed) |
| [03005] IRIS GM-SCDS-Paint (POC) | `901109475497` | Project: GM SCDS paint POC |
| [03006] IRIS GM-GVT-Body (POC) | `901111455897` | Project: GM GVT body POC |
| [03007] IRIS GM-SCDS-Paint | `901112079243` | Project: GM SCDS paint |
| [03008] Hyundai Sealer | `901112079252` | Project: Hyundai sealer |
| [03009] ArcelorMittal Barra Mansa TL2 | `901112079255` | Project: ArcelorMittal TL2 |
| [03010] Stellantis Goiana Demo | `901112079262` | Project: Stellantis demo |
| [03] Hardware | `901109715764` | Hardware/electronics |
| [03] Software | `901109471398` | All software tasks |
| [03] Modelos | `901109474226` | ML models |
| [03] Documentação | `901109715757` | Documentation |

#### Other Regular Folders

| Folder | ID | Lists |
|---|---|---|
| [99] MELHORIAS | `90115656653` | Melhoria contínua (`901109508095`) |
| Novos Projetos | `7251740` | Inspeção Madeira, Tupy, Thermoval |
| Projetos Finalizados | `114954099` | 17 archived project lists |

#### Space-Level Lists (no folder)

| List | ID | Purpose |
|---|---|---|
| Compras e Importações | `217028564` | Purchases & imports |
| [00] MACRO | `901100360909` | High-level macro tasks |

### Sprint Folders (secondary location ONLY — tasks should NOT live here primarily)

| Folder | ID | Product | Current Sprint |
|---|---|---|---|
| [01] SMART DIE (sprints) | `90115085362` | DieMaster | SD Sprint 32-33 |
| [01] SMART DIE HARD (sprints) | `90115287009` | DieMaster (hardware) | SDH Sprint 5-6 |
| [02] SPOT FUSION (sprints) | `90115784429` | SpotFusion | SF Sprint 28-29 |
| [03] VISION KING (sprints) | `90115784442` | VisionKing | VK Sprint 28-29 |

## Task Placement Rules

### Correct Pattern
```
Task primary list:    [01] Software (regular folder)
Task secondary list:  SD Sprint 32 (sprint folder, via "locations")
```

### Incorrect Pattern (violation)
```
Task primary list:    SD Sprint 32 (sprint folder)
Task secondary list:  (none)
```

### How to Identify Violations via API
- `filter_tasks(folder_ids=[sprint_folder_id], include_closed=true)` returns ONLY tasks whose PRIMARY list is in the sprint folder
- Tasks correctly added to sprints as secondary locations do NOT appear in this filter
- Confirmed via API testing on 2026-03-24

### How to Fix a Violation
1. Determine the correct regular-folder list for the task based on its content
2. Use `clickup_add_task_to_list` to add the task to the correct regular list
3. Use `clickup_move_task` to change the primary list to the regular list
4. The sprint list remains as a secondary location automatically

## Task Routing Guide

| Task Name Pattern | Target Regular List |
|---|---|
| `front:`, `back:`, `frontend:`, `backend:`, `sw:` | `[XX] Software` or `[XX] Front/Back` |
| `firmware:`, `hardware:`, `sensor:`, `hub:`, `switch:` | `[XX] Projeto Eletrônico` or `[XX] Hardware` |
| `draw-in:`, `data-processing:`, `sim:`, `pam-stamp:`, `spinn:` | `[XX] Software` or `[XX] Modelos` |
| `ds:`, `vision:`, `model:`, `inferência`, `treinar` | `[XX] Modelos` |
| `lab:`, `soldar`, `macrografia`, `bancada` | `[XX] Laboratório` (SF) or project list |
| `infra:`, `deploy`, `docker` | `[XX] Software` |
| `doc:`, `documentar`, `manual` | `[XX] Documentação` |
| `sjc:`, `flint:`, `pontiac:`, project-specific | Project list (e.g., `[01001]`, `[02006]`) |
| `arcelor:`, `hyundai:`, `stellantis:`, `iris:` | Project list (e.g., `[03002]`, `[03008]`) |
| `sealer:` | `[03008] Hyundai Sealer` |
| `compra`, `importação` | Compras e Importações (`217028564`) |

## Other Spaces (Reference)

| Space | ID | Purpose |
|---|---|---|
| ROADMAP | `90113605013` | High-level Gantt charts |
| COMERCIAL | `3164542` | Commercial/sales |
| GESTÃO DE PROJETOS | `90113477754` | Project management |
| MARKETING | `90113551495` | Marketing |

### ROADMAP Product Lists

| Product | List ID |
|---|---|
| DieMaster | `901109563254` |
| SpotFusion | `901109563247` |
| VisionKing | `901109563266` |

## Status Mapping

| ClickUp Status | JARVIS Local Status | Color |
|---|---|---|
| to-do | pending | `#1090e0` |
| in progress | running | `#f29d41` |
| in review | verifying | `#e040fb` |
| blocked | blocked | `#d33d44` |
| pending | pending | `#ffcc00` |
| backlog | pending | `#95aac0` |
| done | complete | `#008844` |

## Language Convention

- **ClickUp content**: PT-BR (system of record, client-facing)
- **JARVIS/Claude**: English (local processing, developer-facing)
- Task names are typically in Portuguese with English technical terms mixed in
