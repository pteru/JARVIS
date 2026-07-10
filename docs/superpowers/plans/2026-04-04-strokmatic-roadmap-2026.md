---
type: Implementation Plan
title: Strokmatic Roadmap & Workflow Integration Plan — 2026
description: Based on current sprint focus, backlog analysis, and deployment pipeline, the roadmap organizes into 4 streams across 3 time horizons.
timestamp: 2026-04-04
---

# Strokmatic Roadmap & Workflow Integration Plan — 2026

**Date:** 2026-03-26
**Status:** Grilled (25 decisions resolved) — ready for Gantt revision
**Input:** Master context (3,218 ClickUp tasks, 3 codebase explorations, PMO data)
**Grilling session:** 2026-03-24/25, all branches converged

---

## 1. Roadmap Overview

Based on current sprint focus, backlog analysis, and deployment pipeline, the roadmap organizes into 4 streams across 3 time horizons.

### Streams

| Stream | What | H1 Approach |
|---|---|---|
| **A. Product Delivery** | Client deployments, commissioning, field support | **Primary focus** |
| **B. Workflow & Tooling** | ClickUp/GitHub/Drive integration, JARVIS, marketplace | **In parallel** |
| **C. Infrastructure** | CI/CD, security, shared SDK, monitoring | **20% of each sprint** (not a separate stream) |

### Time Horizons

| Horizon | When | Focus |
|---|---|---|
| **H1: Now** | Q1-Q2 2026 (Apr-Jun) | Deliver current commitments (03008, 03007, SJC), workflow pilot |
| **H2: Next** | Q3 2026 (Jul-Sep) | Platform hardening, new deployments, infra debt |
| **H3: Later** | Q4 2026 (Oct-Dec) | Scale, new capabilities, automation maturity |

---

## 2. Gantt Roadmap

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#0d2b4e',
    'primaryTextColor': '#ffffff',
    'primaryBorderColor': '#00d2ff',
    'secondaryColor': '#333333',
    'secondaryTextColor': '#ffffff',
    'secondaryBorderColor': '#b0b0b0',
    'tertiaryColor': '#1f1f1f',
    'tertiaryTextColor': '#ffffff',
    'tertiaryBorderColor': '#666666',
    'lineColor': '#666666',
    'textColor': '#ffffff',
    'todayLineColor': '#ff9800',
    'gridColor': '#333333',
    'doneColor': '#1b3a1b',
    'doneBorderColor': '#00e676',
    'critColor': '#3a1b1b',
    'critBorderColor': '#ff1744',
    'activeColor': '#2a2a3d',
    'activeBorderColor': '#aa00ff',
    'sectionBkgColor': '#121212',
    'sectionBkgColor2': '#1a1a1a',
    'altSectionBkgColor': '#243b6a',
    'taskBkgColor': '#0d2b4e',
    'taskBorderColor': '#00d2ff',
    'taskTextColor': '#ffffff',
    'activeTaskBkgColor': '#2a2a3d',
    'activeTaskBorderColor': '#aa00ff',
    'doneTaskBkgColor': '#1b3a1b',
    'doneTaskBorderColor': '#00e676',
    'critBkgColor': '#3a1b1b',
    'critBorderColor': '#ff1744',
    'milestoneColor': '#ff9800',
    'milestoneBorderColor': '#ff9800'
  }
}}%%
gantt
    title Strokmatic Product Roadmap 2026 (Revised)
    dateFormat YYYY-MM-DD
    axisFormat %b %Y
    todayMarker stroke-width:3px,stroke:#ff9800

    section VisionKing — 03008 Sealer (PRIORITY 1)
    Camera arrival (Hikrobot)              :done, vk-cam, 2026-03-15, 2026-04-07
    Site visit data documentation          :crit, vk-site, 2026-03-26, 2026-04-02
    Mechanical structure design            :crit, vk-mech, after vk-site, 21d
    BOM procurement (IGUS, pneumatics)     :vk-bom, after vk-site, 30d
    Electrical panel + PLC programming     :vk-elec, after vk-mech, 21d
    Software pipeline integration          :vk-sw, 2026-04-07, 2026-05-31
    Fabrication + assembly                 :vk-fab, after vk-mech, 30d
    Commissioning at Hyundai               :crit, vk-comm, after vk-fab, 14d

    section VisionKing — 03007 IRIS SCDS (PRIORITY 2)
    Temperature monitoring system design   :active, vk-iris-temp, 2026-03-15, 2026-05-15
    IRIS SCDS component list finalization  :active, vk-iris-comp, 2026-03-15, 2026-04-30
    Servo + automation logic               :active, vk-iris-auto, 2026-04-01, 2026-05-31

    section VisionKing — Other
    03006 GVT paint shop planning          :vk-gvt-paint, 2026-04-01, 2026-05-15
    03006 GVT full installations (x2)      :vk-gvt-install, after vk-gvt-paint, 90d
    03002 ArcelorMittal monthly campaigns  :active, vk-arcelor, 2026-03-01, 2026-09-30
    03010 Stellantis quote adjustments     :vk-stellantis, 2026-03-26, 2026-04-30
    Frontend i18n + user management        :vk-i18n, 2026-04-15, 2026-05-31

    section DieMaster
    01001 SJC post-test software fixes     :active, sd-sjc-sw, 2026-03-26, 2026-04-30
    01001 SJC test data analysis           :active, sd-sjc-data, 2026-03-26, 2026-04-15
    IP67 sensor seal redesign (platform)   :crit, sd-ip67, 2026-04-01, 2026-05-15
    Production screen finalization         :active, sd-screen, 2026-03-01, 2026-04-30
    ML inference worker (trained models)   :sd-inf, after sd-sjc-data, 45d
    DEMESTA sensor positioning study       :sd-demesta, 2026-03-20, 2026-05-30
    P7 prediction finalization             :done, sd-p7, 2026-03-01, 2026-03-25

    section SpotFusion
    BOS6000 scalable integration (lab)     :active, sf-bos, 2026-03-20, 2026-05-31
    Vision modules + Smart Camera          :active, sf-vision, 2026-03-20, 2026-06-30
    SpINN simulation validation            :active, sf-spinn, 2026-03-01, 2026-05-31
    Design System migration (front+back)   :sf-ds, 2026-05-01, 2026-07-31
    02001/02002/02005 maintenance          :sf-maint, 2026-03-01, 2026-09-30

    section Infrastructure (20% per sprint)
    Security: pre-commit hook (new code)   :infra-hook, 2026-04-01, 2026-04-15
    Security: phased migration (existing)  :infra-sec, 2026-04-15, 2026-08-31
    Offline credential defaults            :infra-creds, 2026-04-15, 2026-05-15
    CI/CD test gates                       :infra-ci, 2026-06-01, 2026-07-31
    Shared SDK adoption                    :infra-sdk, 2026-07-01, 2026-08-31
    Centralized logging                    :infra-log, 2026-08-01, 2026-09-30

    section Workflow & Tooling (parallel)
    ClickUp-GitHub integration (DM pilot)  :active, wf-clickup-gh, 2026-03-26, 2026-04-15
    ClickUp custom fields (active tasks)   :wf-fields, after wf-clickup-gh, 14d
    Drive index for 23 PMO projects        :wf-drive, 2026-04-01, 2026-04-30
    Biweekly context auto-refresh          :wf-refresh, 2026-04-01, 2026-04-15
    Marketplace: project-management plugin :wf-pm-plugin, 2026-04-15, 2026-05-15
    Marketplace: engineering plugin        :wf-eng-plugin, 2026-05-15, 2026-06-15
    Cowork pilot (4 engineers)             :wf-cowork, after wf-pm-plugin, 21d
    GitHub→ClickUp auto-sync              :wf-sync, 2026-05-15, 2026-06-30
```

---

## 3. Dependency Flowchart

```mermaid
graph LR
    classDef default fill:#1f1f1f,stroke:#fff,stroke-width:1px,color:#fff;
    classDef acq fill:#333333,stroke:#b0b0b0,stroke-width:2px,color:#fff;
    classDef dev fill:#0d2b4e,stroke:#00d2ff,stroke-width:2px,color:#fff;
    classDef mec fill:#4a2c0f,stroke:#ff9800,stroke-width:2px,color:#fff;
    classDef integ fill:#1b3a1b,stroke:#00e676,stroke-width:2px,color:#fff;
    classDef crit fill:#3a1b1b,stroke:#ff1744,stroke-width:2px,color:#fff;
    classDef tbd fill:#2a2a3d,stroke:#aa00ff,stroke-width:2px,stroke-dasharray:5 3,color:#ccc;
    classDef mile fill:#1f1f1f,stroke:#ff9800,stroke-width:3px,color:#ff9800;
    classDef paused fill:#1a1a1a,stroke:#444,stroke-width:1px,stroke-dasharray:5 3,color:#666;
    linkStyle default stroke:#666,stroke-width:1px;

    subgraph VK1["VK — 03008 Sealer (PRIORITY 1)"]
        style VK1 fill:#121212,stroke:#ff1744,stroke-width:2px,color:#fff
        vk-cam[Camera Arrival]:::acq
        vk-site[Site Data Doc]:::crit
        vk-mech[Mech Structure]:::mec
        vk-bom[BOM Procurement]:::acq
        vk-elec[Electrical + PLC]:::dev
        vk-sw[Software Pipeline]:::dev
        vk-fab[Fabrication]:::mec
        vk-comm(("Commission")):::mile

        vk-cam --> vk-sw
        vk-site --> vk-mech
        vk-site --> vk-bom
        vk-mech --> vk-elec
        vk-mech --> vk-fab
        vk-fab --> vk-comm
        vk-elec --> vk-comm
        vk-sw --> vk-comm
    end

    subgraph VK2["VK — 03007 IRIS SCDS (PRIORITY 2)"]
        style VK2 fill:#243b6a,stroke:#00d2ff,stroke-width:2px,color:#fff
        vk-iris-temp[Temp Monitoring]:::dev
        vk-iris-comp[Component List]:::mec
        vk-iris-auto[Automation Logic]:::dev
    end

    subgraph VK3["VK — Other"]
        style VK3 fill:#121212,stroke:#666,stroke-width:2px,color:#fff
        vk-gvt-paint[GVT Paint Plan]:::dev
        vk-gvt-install[GVT Installations]:::tbd
        vk-arcelor[Arcelor Campaigns]:::integ
        vk-stellantis[Stellantis Quote]:::tbd
        vk-i18n[Frontend i18n]:::dev

        vk-gvt-paint --> vk-gvt-install
    end

    subgraph SD["DieMaster"]
        style SD fill:#243b6a,stroke:#666,stroke-width:2px,color:#fff
        sd-sjc-sw[SJC SW Fixes]:::dev
        sd-sjc-data[SJC Data Analysis]:::dev
        sd-ip67[IP67 Seal Redesign]:::crit
        sd-screen[Prod Screen]:::dev
        sd-inf[ML Inference]:::dev
        sd-demesta[DEMESTA Study]:::tbd

        sd-sjc-data --> sd-inf
    end

    subgraph SF["SpotFusion"]
        style SF fill:#121212,stroke:#666,stroke-width:2px,color:#fff
        sf-bos[BOS6000 Lab Integ.]:::dev
        sf-vision[Vision + SmartCam]:::dev
        sf-spinn[SpINN Simulation]:::dev
        sf-ds[DS Migration]:::dev
    end

    subgraph INFRA["Infrastructure (20%)"]
        style INFRA fill:#243b6a,stroke:#666,stroke-width:2px,color:#fff
        infra-hook[Pre-commit Hook]:::dev
        infra-sec[Phased Sec Migration]:::dev
        infra-creds[Offline Cred Defaults]:::dev
        infra-ci[CI Test Gates]:::dev
        infra-sdk[Shared SDK]:::dev

        infra-hook --> infra-sec
        infra-ci --> infra-sdk
    end

    subgraph WF["Workflow (parallel)"]
        style WF fill:#121212,stroke:#666,stroke-width:2px,color:#fff
        wf-clickup[ClickUp-GitHub DM]:::integ
        wf-fields[Custom Fields]:::dev
        wf-refresh[Biweekly Refresh]:::dev
        wf-pm[PM Plugin]:::dev
        wf-cowork[Cowork Pilot]:::integ
        wf-sync[GH→CU Auto-Sync]:::tbd

        wf-clickup --> wf-fields
        wf-pm --> wf-cowork
    end

    %% CROSS-SECTION DEPENDENCIES
    sd-ip67 -.->|blocks all future SD deploys| sd-demesta
    vk-arcelor -.->|platform validation| vk-sw
    wf-clickup --> wf-sync
    sf-vision -.->|Smart Camera needed| sf-bos
```

---

## 4. Workflow Integration Plan

### 4.1 Current State (How the Company Works Today)

| Activity | Current Tool | Pain Point |
|---|---|---|
| Sprint planning | ClickUp (TÉCNICO space) | Tasks lived in sprint folders — just fixed |
| Code development | GitHub repos (submodules) | No link to ClickUp tasks |
| PR reviews | GitHub + JARVIS automated | Reviews not linked to ClickUp |
| Client deliverables | Google Drive (shared drives) | No link to ClickUp tasks |
| Engineering reports | JARVIS → Drive | Manual process, no traceability |
| Team communication | Google Chat + email | Context scattered |
| Project management | ClickUp (ROADMAP space) | Disconnected from engineering |

### 4.2 Proposed Integration (Two-Lane Model)

#### Lane 1: Software Tasks

```
ClickUp Sprint Task                    GitHub
├── PM creates task                    │
├── Branch naming: feat/CU-xxxx       ├── Auto-linked via ClickUp-GitHub integration
├── Developer works in GitHub          ├── PR references issue
├── JARVIS reviews PR                  ├── Review posted to GitHub
├── PR merged                          ├── Issue closed
└── ClickUp automation: → Complete    └── Status synced
```

**Implementation steps:**
1. Enable ClickUp-GitHub integration (OAuth, per-org) — **Week 1**
2. Add custom fields to ClickUp (Project Code, Drive Folder, GitHub Issue, Task Lane) — **Week 1**
3. Configure ClickUp Automations (PR merge → Complete, branch create → In Progress) — **Week 1**
4. Document branch naming convention (`feat/CU-<id>-<desc>`) — **Week 1**
5. Create GitHub Projects board per product (kanban) — **Week 3**
6. Build sprint sync automation (ClickUp → GitHub Issues) — **Week 5**

#### Lane 2: Engineering Tasks

```
ClickUp Task                           Google Drive
├── PM creates task with project code  │
├── Custom field: Drive Folder link    ├── Engineer opens Drive folder
├── Engineer works (CAD, JARVIS, etc.) ├── Uploads deliverable
├── Deliverable attached to task       ├── ClickUp-Drive integration
└── PM reviews → Complete             └── Archived
```

**Implementation steps:**
1. Enable ClickUp-Drive integration — **Week 1**
2. Populate Drive Folder custom field on existing tasks — **Week 2**
3. Run `/gdrive <code> index` for all 23 PMO projects — **Week 2**
4. Install Markdown Viewer add-on org-wide — **Week 2**
5. Build `project-management` plugin for Cowork (Windows engineers) — **Week 3**
6. Train team on workflow — **Week 4**

### 4.3 What Changes for Each Role

| Role | Before | After |
|---|---|---|
| **PM** | Creates tasks in ClickUp, checks status manually | Creates tasks with custom fields; status auto-updates from GitHub |
| **Software Dev** | Picks tasks from ClickUp, works in GitHub, no link | Picks tasks, names branch with CU-ID, everything auto-links |
| **Engineering** | Picks tasks from ClickUp, uploads to Drive manually | Same flow + Drive folder pre-linked, deliverable tracked |
| **Data Science** | Works in notebooks, uploads models manually | Model versioning (H2), notebook→Drive pipeline |
| **Pedro (JARVIS)** | Orchestrates manually, reviews PRs, generates reports | JARVIS automates: PR review → ClickUp update → Drive upload |

### 4.4 Marketplace Expansion Plan

| Plugin | Target Users | Content | Timeline |
|---|---|---|---|
| `office-suite` | Everyone | docx, xlsx, pptx, md-to-pdf | **Done** |
| `development` | All devs | tdd, grill-me, write-a-prd, prd-to-issues, improve-architecture | **Done** |
| `google-workspace` | Everyone | gdoc, gsheet, gslides, gdrive via gws CLI | **Done** |
| `project-management` | PMs, engineers | /pmo, /clickup, /sprint-board | **H1 (Apr)** |
| `engineering` | Mech/automation engineers | /cad, /mechanical, /cae, /engineering-report | **H1 (May)** |
| `pr-review` | Software leads | /review-pr, /pr-inbox | **H2 (Jul)** |

### 4.5 GitHub Projects Structure

One project board per product:

```
strokmatic/diemaster — "DieMaster Development"
├── Backlog (from ClickUp sync)
├── Sprint (current sprint tasks)
├── In Progress (branch created)
├── In Review (PR open)
└── Done (PR merged, ClickUp auto-complete)

strokmatic/spotfusion — "SpotFusion Development"
└── (same columns)

strokmatic/visionking — "VisionKing Development"
└── (same columns)
```

**Labels per product:**
- `product:diemaster`, `product:spotfusion`, `product:visionking`
- `priority:critical`, `priority:high`, `priority:normal`, `priority:low`
- `type:feature`, `type:bugfix`, `type:refactor`, `type:test`, `type:docs`
- `sprint:XX` (current sprint number)
- `project:01001`, `project:03002`, etc. (PMO code)

---

## 5. Priority Stack (What to Do First)

### Immediate (This Week)

| # | Action | Effort | Impact |
|---|---|---|---|
| 1 | Enable ClickUp-GitHub native integration | 1h | Unlocks auto-linking |
| 2 | Add custom fields to ClickUp spaces | 2h | Enables tracking |
| 3 | Configure 2 ClickUp Automations (PR merge, branch create) | 1h | Auto-status |
| 4 | Document branch naming convention for team | 1h | Team alignment |
| 5 | Finish VK migration remaining 2 Compras tasks (manual) | 5min | Cleanup |

### Short Term (April)

| # | Action | Effort | Impact |
|---|---|---|---|
| 6 | Run Drive index for all 23 PMO projects | 1 day | Knowledge base |
| 7 | Populate Drive Folder field on ClickUp tasks | 2 days | Traceability |
| 8 | Build `project-management` marketplace plugin | 3 days | Cowork users |
| 9 | Create GitHub Projects boards (3 products) | 2 days | Dev visibility |
| 10 | Start security remediation (hardcoded creds) | 5 days | Critical debt |

### Medium Term (May-Jun)

| # | Action | Effort | Impact |
|---|---|---|---|
| 11 | Build `engineering` marketplace plugin | 3 days | Mech engineers on Cowork |
| 12 | Cloud Build test gates for all products | 5 days | Quality |
| 13 | Shared SDK adoption across products | 5 days | Consistency |
| 14 | Team Cowork onboarding + training | 2 days | Adoption |
| 15 | Automated sprint sync (ClickUp → GitHub Issues) | 5 days | Workflow |

---

## 6. Success Metrics

| Metric | Current | H1 Target | H2 Target |
|---|---|---|---|
| ClickUp tasks with GitHub link | 0% | 50% (software tasks) | 90% |
| ClickUp tasks with Drive folder | ~10% | 80% | 95% |
| PRs referencing ClickUp tasks | 0% | 60% | 90% |
| Engineers using Cowork plugins | 1 (Pedro) | 5 | 10+ |
| Security issues (hardcoded creds) | ~100 files | 50 files | 0 |
| CI/CD with test gates | 0 products | 1 product | All 3 |
| Automated PR reviews linked to tasks | 0% | 30% | 80% |

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Team resists branch naming convention | Medium | High | Start with software devs only; automate ClickUp link via bot |
| ClickUp-GitHub integration scope creep | Medium | Medium | Stick to native integration first; custom sync later |
| Engineering team doesn't adopt Cowork | Medium | Medium | Start with PM plugin only; demonstrate value with 1 engineer |
| Security remediation breaks services | Low | Critical | Feature-flag credential loading; migrate one service at a time |
| ClickUp rate limits block automation | Low | Medium | Use REST API v3 with rate limit headers; batch operations |

---

## 8. Open Questions (For Discussion)

1. **Sprint sync granularity** — Should ALL ClickUp sprint tasks become GitHub Issues, or only software tasks? The two-lane model says only software, but some engineering tasks have code components.

2. **Who owns the ClickUp-GitHub link?** — Should PMs paste GitHub Issue URLs, or should JARVIS auto-create issues from ClickUp tasks?

3. **Drive folder structure** — Should we standardize the subfolder structure across all projects (reports/, specs/, drawings/, etc.), or let each project evolve organically?

4. **Model versioning tool** — MLflow (heavy, full experiment tracking) vs custom registry (lightweight, integrated with existing Deploy toolkit) vs DVC (git-based, fits submodule pattern)?

5. **Centralized logging priority** — GCP Cloud Logging (native, easy) vs ELK (self-hosted, more control) vs Datadog (SaaS, expensive)? Budget consideration.

6. **GitHub Projects vs ClickUp for sprint visibility** — If developers use GitHub Projects daily, do PMs still need ClickUp sprint views? Or does ClickUp become roadmap-only?

7. **Engineering task definition** — Where exactly is the line between "software task" (Lane 1) and "engineering task" (Lane 2)? Tasks like "design pneumatic circuit and write control logic" span both.

8. **Cowork vs Claude Code** — Should we invest in standardizing on Cowork (cross-platform, GUI) or keep Claude Code as the primary (Linux, CLI, more powerful)? Can plugins work identically in both?
