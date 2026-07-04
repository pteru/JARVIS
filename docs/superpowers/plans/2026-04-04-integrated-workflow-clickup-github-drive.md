# Strokmatic Integrated Workflow: ClickUp + GitHub + Google Drive + Claude

**Date:** 2026-03-24
**Status:** Draft v1 — iterating

---

## 1. Overview

This document describes a unified workflow that integrates four systems for Strokmatic's software engineering, data science, and industrial automation/engineering work.

| System | Role | Users |
|---|---|---|
| **ClickUp** | Planning SSOT — sprints, roadmap, client milestones, timelines | PMs, engineers, clients |
| **GitHub** | Engineering execution — code, PRs, issues, CI/CD | Developers, JARVIS |
| **Google Drive** | Knowledge & artifact store — CAD, reports, datasheets, deliverables | Everyone |
| **Claude** (Code on Linux, Cowork on Windows/macOS) | AI copilot — analysis, automation, report generation, sync | Engineers with Claude access |

### Design Principles

1. **Each system does what it does best** — don't force engineering deliverables through GitHub or code reviews through ClickUp
2. **ClickUp is always the planning source of truth** — if it's not in ClickUp, it's not planned
3. **Artifacts live where they're consumed** — code in GitHub, documents in Drive, tasks in ClickUp
4. **Claude is the integration glue** — for users with access; the workflow must also work without it
5. **Two lanes, one tracker** — software tasks and engineering tasks have different lifecycles but share ClickUp as the common tracker

---

## 2. Two-Lane Architecture

### Lane 1: Software (Code-Centric)

**Lifecycle:** ClickUp task → GitHub Issue → branch → PR → merge → deploy

```
ClickUp Sprint Task [02] SF-1234
    │
    ├── ClickUp-GitHub integration auto-links when branch
    │   name includes issue-number or task URL
    │
    ▼
GitHub Issue #45 (created by sync or manually)
    │
    ├── Developer creates branch: feat/issue-number-description
    ├── Opens PR referencing Issue #45
    ├── PR review (human + JARVIS automated review)
    │
    ▼
PR merged → Issue #45 closed
    │
    ├── ClickUp automation: linked task → "Complete"
    └── CI/CD deploys
```

**Who does what:**

| Actor | Action | Tool |
|---|---|---|
| PM | Creates sprint tasks, assigns priorities | ClickUp |
| Developer | Picks task, creates branch with ClickUp ID | GitHub |
| Developer | Opens PR referencing issue | GitHub |
| JARVIS | Automated PR review, posts to GitHub | Claude Code |
| ClickUp | Auto-updates task status on PR merge | ClickUp-GitHub integration |

### Lane 2: Engineering/Automation (Document-Centric)

**Lifecycle:** ClickUp task → research → design → produce artifact → upload to Drive → close task

```
ClickUp Task [03] VK-5678: "Design pneumatic circuit Station 3"
    │
    ├── Custom field: Drive Folder link
    ├── Custom field: Project Code (03002)
    │
    ▼
Engineer works (with or without Claude):
    │
    ├── Reads datasheets, manuals from Drive
    ├── Designs circuit, selects components
    ├── Generates report (markdown → PDF) or CAD deliverable
    │
    ▼
Deliverable uploaded to Drive project folder
    │
    ├── ClickUp-Drive integration: attach file to task
    ├── Drive folder linked in task custom field
    │
    ▼
Task status → "In Review" → "Complete"
```

**Who does what:**

| Actor | Action | Tool |
|---|---|---|
| PM | Creates engineering task with project code | ClickUp |
| Engineer | Researches, designs, produces deliverable | CAD tools, Claude, Drive |
| Engineer/Claude | Generates report, uploads to Drive | Claude Cowork or manual |
| PM | Reviews deliverable in Drive | Google Drive |
| PM | Closes task, links final deliverable | ClickUp |

---

## 3. Native Integrations (No Custom Code Required)

### 3.1 ClickUp ↔ GitHub (Sync Service)

**Implementation:** Custom sync service deployed to `192.168.15.2` (see `strokmatic/infra` repo, `services/` directory).

**How it works:**
- **Mapping by title:** GitHub issue title = ClickUp task name (exact match)
- **GH → CU (active):** When a GitHub issue is created, the sync service creates a corresponding ClickUp task with `sprint` tag, assigns to the correct list, and sets due date
- **CU → GH (planned):** When a ClickUp task is created, the sync service creates a corresponding GitHub issue in the target repo (determined by task prefix/list)
- **Status sync:** Issue closed → task Complete; task Complete → issue closed

**Naming convention for branches:**
```
feat/<issue-number>-<short-description>
fix/<issue-number>-<short-description>
```

### 3.2 ClickUp ↔ Google Drive (Built-In)

**Setup:** ClickUp Settings → Integrations → Cloud Storage → Google Drive → Authenticate

**What it does:**
- Attach Drive files directly to ClickUp tasks (search Drive from ClickUp UI)
- Inline preview of Google Docs/Sheets/Slides within ClickUp
- URL-type custom fields can store Drive folder links

**Recommended custom fields per task:**
- `Drive Folder` (URL) — link to the project's Drive folder
- `Project Code` (Short Text) — 5-digit PMO code (e.g., `03002`)
- `Deliverable` (URL) — link to the final document/file in Drive

### 3.3 Google Drive Folder Structure (Per Product)

Existing shared drives, maintained as-is:

```
[01] SMART DIE (Shared Drive)
├── [01001] Project Name/
├── [01002] Project Name/
└── ...

[02] SPOT FUSION (Shared Drive)
├── [02001] Project Name/
├── [02002] Project Name/
└── ...

[03] VISION KING (Shared Drive)
├── [03001] Project Name/
├── [03002] Project Name/
└── ...
```

Each project folder contains:
- `reports/` — PDFs, technical reports
- `specs/` — Datasheets, technical specifications
- `drawings/` — CAD files, P&ID diagrams
- `quotes/` — Commercial proposals
- `meetings/` — Meeting notes, minutes
- `reference/` — Manuals, standards, catalogs

---

## 4. Claude-Enhanced Workflow (For Users with Claude Access)

Users with Claude Code (Linux), Claude Cowork (macOS/Windows), or Claude Desktop can leverage additional automation through skills and plugins.

### 4.1 Available Tools

**From JARVIS (Claude Code on Linux):**
- `/pmo <code>` — Load project context, emails, timeline
- `/gdrive <code>` — Browse and manage Drive files for a project
- `/clickup <task-id>` — View/update ClickUp tasks
- `/docx`, `/xlsx`, `/pptx` — Create/edit Office documents
- `/md-to-pdf` — Export reports to PDF
- `/engineering <code>` — End-to-end engineering report workflow (planned)

**From Strokmatic Marketplace (Claude Code on Linux + Cowork on Windows/macOS):**
- `office-suite` plugin — docx, xlsx, pptx, md-to-pdf
- `development` plugin — tdd, grill-me, write-a-prd, prd-to-issues, improve-architecture
- `google-workspace` plugin — gdoc, gsheet, gslides, gdrive (via `gws` CLI)

**Install for any Claude Code or Cowork user:**
```
/plugin marketplace add strokmatic/sdk-agent-standards
/plugin install office-suite
/plugin install development
/plugin install google-workspace
```

### 4.2 Claude-Powered Engineering Workflow

When an engineer with Claude access works on an engineering task:

```
1. /pmo 03002                    # Load project context
2. /gdrive 03002 browse          # Find relevant datasheets in Drive
3. Claude analyzes manuals, generates sizing calculations
4. Claude produces report in markdown
5. /md-to-pdf report.md          # Export to PDF
6. /gdrive 03002 upload report.pdf  # Upload to Drive
7. /clickup issue-number status complete # Close task with deliverable link
```

### 4.3 Drive Index for Project Artifacts

Every project folder in Drive should maintain a `drive-index.md` (generated by `/gdrive <code> index`). This provides a human-readable and Claude-readable map of what's in the folder:

```markdown
# Drive Index — [03002] ArcelorMittal Barra Mansa

**Last updated:** 2026-03-24
**Total files:** 847
**Shared Drive:** [03] VISION KING

## Folder Tree

├── reports/ (12 files)
│   ├── technical-proposal-v3.pdf (2026-03-15)
│   ├── commissioning-report.pdf (2026-02-28)
│   └── ...
├── specs/ (34 files)
│   ├── camera-datasheet-GC2591.pdf
│   ├── illumination-spec.xlsx
│   └── ...
├── drawings/ (8 files)
│   ├── station-layout-v2.pdf
│   └── P&ID-pneumatic.pdf
└── ...
```

This index is:
- Stored in the PMO folder locally (`workspaces/strokmatic/pmo/<code>/drive-index.md`)
- Optionally uploaded to the Drive folder itself for team visibility
- Refreshed by running `/gdrive <code> index`

---

## 5. Workflow Without Claude (For Team Members Without Access)

The workflow must function for team members who don't have Claude Code or Cowork. Their workflow uses only ClickUp, GitHub, and Drive directly.

### Software Tasks (Lane 1)

1. Pick task from ClickUp sprint board
2. Create branch in GitHub with ClickUp task ID in name
3. Write code, open PR
4. PR is reviewed (by humans; JARVIS review is a bonus, not a requirement)
5. Merge PR → ClickUp auto-updates task status

**No Claude dependency.** The ClickUp-GitHub integration handles the link.

### Engineering Tasks (Lane 2)

1. Pick task from ClickUp
2. Open linked Drive folder (from task custom field)
3. Work on deliverable using standard tools (CAD, Excel, Word, etc.)
4. Upload deliverable to Drive folder
5. Attach file to ClickUp task via Drive integration
6. Move task to "In Review" or "Complete"

**No Claude dependency.** Drive integration is native in ClickUp.

### What Claude Adds (When Available)

| Without Claude | With Claude |
|---|---|
| Manual datasheet research | AI-powered analysis and compilation |
| Manual report writing in Word/Sheets | Markdown generation → PDF export |
| Manual Drive folder navigation | `/gdrive` skill with smart search |
| Manual ClickUp updates | `/clickup` skill with status sync |
| No automated PR reviews | JARVIS PR review pipeline |
| No email analysis | Email ingestion + timeline extraction |

---

## 6. Markdown Source Files in Drive

### The Problem

Engineering reports and specifications are best authored in markdown (version-controlled, AI-friendly, exportable to PDF). But Google Drive doesn't natively render `.md` files.

### The Solution: Dual-Format Storage

For every markdown report, store **both** the source and the rendered version:

```
Drive: [03002] ArcelorMittal/reports/
├── technical-proposal-v3.pdf          # Rendered (what clients/PMs see)
├── technical-proposal-v3.md           # Source (for engineers/Claude)
├── commissioning-report.pdf
├── commissioning-report.md
└── ...
```

**Rendering pipeline:**
1. Author in markdown (locally or via Claude)
2. Export to PDF: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npx --yes md-to-pdf report.md`
3. Upload both `.md` and `.pdf` to Drive
4. The PDF is the official deliverable; the `.md` is the editable source

### Viewing Markdown in Drive

For team members who want to view/edit `.md` files directly in Drive:

- **[Markdown Viewer and Editor](https://workspace.google.com/marketplace/app/markdown_viewer_and_editor/446183214552)** — Google Workspace Marketplace add-on that renders `.md` files with live preview, syntax highlighting, and diagram support. Install org-wide for all users.
- **StackEdit** — Browser-based markdown editor with Google Drive integration. Can open and save `.md` files directly from Drive.

### Alternative: Convert to Google Docs

For reports that need collaborative editing by non-technical team members, convert markdown to Google Docs format using the `markdown-to-docs.mjs` script (bundled in the google-workspace plugin). This creates a native Google Doc with proper formatting (headings, lists, bold, italic, links, code blocks).

---

## 7. ClickUp Task Structure

### Custom Fields (Add to All Spaces)

| Field | Type | Purpose | Example |
|---|---|---|---|
| `Project Code` | Short Text | 5-digit PMO code | `03002` |
| `Drive Folder` | URL | Link to project's Drive folder | `https://drive.google.com/drive/folders/...` |
| `GitHub Issue` | URL | Link to GitHub Issue (software tasks) | `https://github.com/strokmatic/visionking/issues/45` |
| `Deliverable` | URL | Link to final deliverable in Drive | `https://drive.google.com/file/d/...` |
| `Task Lane` | Dropdown | `Software` or `Engineering` | Software |

### Status Mapping

| ClickUp Status | GitHub State | Meaning |
|---|---|---|
| To Do | Issue open (no assignee) | Not started |
| In Progress | Issue open (assigned) | Active work |
| In Review | PR open | Under review |
| Complete | Issue closed (PR merged) | Done |
| Blocked | Issue open (label: blocked) | Waiting on dependency |

### Automation Rules

| Trigger | Action |
|---|---|
| GitHub PR merged for linked task | Move task → Complete |
| GitHub branch created for linked task | Move task → In Progress |
| Task moved to Complete | Notify PM via ClickUp notification |
| Task has `Engineering` lane + moved to Complete | Check that Deliverable field is populated |

---

## 8. Strokmatic Marketplace Additions (Planned)

To support team members on Cowork (Windows/macOS) who don't have JARVIS, the following plugins should be added to the `strokmatic/sdk-agent-standards` marketplace. Cowork has been available on Windows since February 2026 with full feature parity (plugins, connectors, file access, MCP).

### Current Plugins (Available Now)

| Plugin | Skills | Platform |
|---|---|---|
| `office-suite` | docx, xlsx, pptx, md-to-pdf | Code (Linux) + Cowork (Windows/macOS) |
| `development` | tdd, grill-me, write-a-prd, prd-to-issues, improve-architecture | Code (Linux) + Cowork (Windows/macOS) |
| `google-workspace` | gdoc, gsheet, gslides, gdrive | Code (Linux) + Cowork (Windows/macOS) |

### Planned Plugins (Backlog)

| Plugin | Skills | Purpose | Priority |
|---|---|---|---|
| `project-management` | pmo, clickup, sprint-board | ClickUp task management + PMO context loading | High |
| `engineering` | cad, mechanical, cae, engineering-report | CAD analysis + report generation workflow | Medium |
| `pr-review` | review-pr, pr-inbox | Automated PR review pipeline | Medium |
| `notifications` | notify | Telegram/Discord notifications | Low |
| `meeting-assistant` | meeting | Live meeting transcription | Low |

The `project-management` plugin is the highest priority addition — it would bring the ClickUp integration and PMO context to Cowork users on Windows (engineering team) and macOS who don't have JARVIS.

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Week 1)

- [ ] Configure ClickUp-GitHub native integration (OAuth, per-org)
- [ ] Configure ClickUp-Google Drive native integration
- [ ] Add custom fields to ClickUp spaces (`Project Code`, `Drive Folder`, `GitHub Issue`, `Deliverable`, `Task Lane`)
- [ ] Create ClickUp Automations (PR merge → Complete, branch create → In Progress)
- [ ] Install Markdown Viewer add-on org-wide in Google Workspace
- [ ] Document branch naming convention (`feat/<issue-number>-<desc>`)

### Phase 2: Drive Indexing (Week 2)

- [ ] Run `/gdrive <code> index` for all 23 PMO projects
- [ ] Upload `drive-index.md` to each project's Drive folder
- [ ] Set up recurring Drive index refresh (weekly or on-demand)
- [ ] Populate `Drive Folder` custom field in existing ClickUp tasks

### Phase 3: Claude Integration (Week 3)

- [ ] Deploy ClickUp connector MCP server to live JARVIS (from FORGE)
- [ ] Create `config/orchestrator/clickup.json` with discovered IDs
- [ ] Test `/clickup` skill end-to-end (create task, update status, link Drive)
- [ ] Build `project-management` plugin for marketplace (Cowork users)

### Phase 4: Team Rollout (Week 4)

- [ ] Document workflow for non-Claude users (ClickUp + GitHub + Drive only)
- [ ] Train team on branch naming convention and ClickUp custom fields
- [ ] Publish `project-management` plugin to marketplace
- [ ] Test Cowork plugin install on Windows (engineering team) and macOS

---

## 10. FAQ

**Q: Do I need Claude to use this workflow?**
No. The core workflow (ClickUp → GitHub → Drive) uses only native integrations. Claude adds automation and intelligence but is not required.

**Q: Where do CAD files go?**
Google Drive, in the project folder under `drawings/` or `3d-files/`. ClickUp task links to the Drive folder. CAD files should never be committed to git (too large, binary).

**Q: Where do engineering reports go?**
The PDF goes to Google Drive (the deliverable). The markdown source optionally goes alongside it in Drive (for editability) and/or committed to a git repo (for version history).

**Q: Can I use Cowork on Windows?**
Yes. Claude Cowork launched on Windows on 2026-02-10 with full feature parity — plugins, connectors, file access, and MCP all work. Available on Claude Pro ($20/mo), Max, Team, and Enterprise plans. Note: Windows arm64 is not supported.

**Q: How do I link a ClickUp task to a GitHub Issue?**
Include the ClickUp task ID in your branch name (e.g., `feat/42-fix-camera`). The native integration auto-links them. Alternatively, paste the GitHub Issue URL into the `GitHub Issue` custom field on the ClickUp task.

**Q: What happens if I don't have the Markdown Viewer add-on?**
You'll see raw markdown text when opening `.md` files in Drive. The PDF version is always available alongside it for reading. The add-on is recommended but not required.
