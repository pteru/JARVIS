# JARVIS Restructuring & Strokmatic Marketplace Plan

**Date:** 2026-03-23
**Status:** Approved — ready for execution
**Grilled:** 20 questions resolved, all branches converged

---

## Executive Summary

JARVIS has grown organically to ~28K LOC across 41 skills, 11 MCP servers (144 tools), 3 dashboards, and extensive shell/Python tooling. Analysis reveals:

- **~4,500 LOC of duplication** (VK/SF health monitors: ~3,990; PR review service vs scripts: ~500)
- **12 generic-reusable skills** extractable to an internal marketplace
- **Config fragmentation** across 5 directories with a monolithic 1,081-line workspaces.json
- **No data retention policy** — VK health snapshots growing ~100/day unbounded

The plan has three pillars:

1. **Internal cleanup** — deduplicate, consolidate config, enforce retention
2. **Marketplace extraction** — package 12 skills as 3 Claude Code plugins in `sdk-agent-standards`
3. **Google Workspace via `gws` CLI** — leverage the official Google Workspace CLI (OAuth) instead of building a custom MCP server

### Key Decisions (from /grill-me session)

| # | Decision | Choice |
|---|---|---|
| Q1 | Target audience | Internal Strokmatic only |
| Q2 | Marketplace repo | `strokmatic/sdk-agent-standards#plugins/claude-code` (subdirectory) |
| Q3 | License | N/A — private repo |
| Q4 | Distribution mechanism | Claude Code plugin marketplace only (no `npx skills`) |
| Q5 | Repo structure | `sdk-agent-standards` becomes SSOT for agent configurations |
| Q6 | Plugin scope | office-suite + development + google-workspace. Deferred: engineering, meeting-assistant, notifications |
| Q8 | Python tools | Bundled inside plugins with auto-venv on first use |
| Q9 | Google Workspace auth | Use `gws` CLI (OAuth), NOT custom MCP server fork |
| Q10 | Dependency management | Auto-create venv on first skill invocation |
| Q11a | Attribution | Add `metadata.source: github.com/mattpocock/skills` to Pocock skills |
| Q11b | Customization | Keep vanilla — no Strokmatic-specific modifications |
| Q12 | Google APIs via gws | Full Discovery Service coverage — no need to scope manually |
| Q13 | MCP server location | Not needed — `gws` is a CLI tool, skills wrap it via Bash |
| Q14 | gws prerequisite | Required — documented in setup.md, skill checks on first use |
| Q15 | JARVIS migration to gws | No — keep internal MCP server, only marketplace uses `gws` |
| Q17 | Plugin granularity | Individual install (no meta-plugin) |
| Q18 | Team onboarding | Documentation in README only |
| Q19 | TDD skill name | `tdd` (no suffix in marketplace) |

---

## Part 1: Internal Cleanup

### 1.1 Health Monitor Framework (saves ~2,000 LOC)

VK and SF health monitors are ~80% identical. Extract a generic framework:

```
scripts/health-monitor/
├── framework/
│   ├── run.sh              # Generic orchestrator (gates, flock, pipeline)
│   ├── collect.sh           # Generic SSH collection with product hooks
│   ├── analyze.sh           # Snapshot diffing + Claude analysis
│   ├── alert.sh             # Telegram/Slack alerting with cooldown
│   ├── trends.sh            # Rolling aggregation
│   └── lib/
│       ├── config.sh        # Unified deployment config loader
│       ├── assemble_base.py # Base metric assembler (product hooks)
│       └── telegram.sh      # Domain-parameterized notifications
├── products/
│   ├── visionking/
│   │   ├── config.sh        # VK overrides (GPU, img_saved disk, port 8110)
│   │   ├── assemble.py      # VK-specific metrics (extends base)
│   │   └── gpu-watchdog.sh  # VK-only
│   └── spotfusion/
│       ├── config.sh        # SF overrides (3x Redis, standard SSH)
│       └── assemble.py      # SF-specific metrics (extends base)
└── README.md
```

### 1.2 PR Review Service Deduplication (saves ~500 LOC)

Three exact duplicates between `scripts/` and `services/pr-review/`:

| Canonical (scripts/) | Duplicate (services/pr-review/) |
|---|---|
| `scripts/fetch-open-prs.sh` | `services/pr-review/fetch-open-prs.sh` |
| `scripts/review-pr.sh` | `services/pr-review/review-pr.sh` |
| `scripts/helpers/build-pr-inbox.mjs` | `services/pr-review/build-inbox.mjs` |

Service scripts source the canonical versions via `$ORCHESTRATOR_HOME/scripts/`.

### 1.3 Config Consolidation

Move misplaced files to `config/orchestrator/`:
- `config/project-codes.json`
- `config/self-improvement.json`
- `config/meeting-assistant.json`

Partition `workspaces.json` (1,081 lines → 4 files):
```
config/orchestrator/workspaces/
├── diemaster.json
├── spotfusion.json
├── visionking.json
└── sdk.json
```

### 1.4 Data Retention & Log Rotation

- VK snapshots: retain 30 days, compress 90 days, purge 180 days
- Meeting transcripts: retain 365 days
- Cron logs: daily rotation, 30-day retention
- Move messaging state from `logs/` to `data/messaging/`

### 1.5 Shared Libraries

- Shell: `scripts/lib/prompt-builder.sh` (extracted from orchestrator/dispatcher)
- Python: `tools/lib/document_base.py` (shared CLI scaffolding for docx/xlsx/pptx)
- Node.js: `mcp-servers/lib/json-utils.js` + `mcp-servers/lib/google-auth.mjs`

---

## Part 2: Strokmatic Plugin Marketplace

### 2.1 Repository & Structure

Hosted in `strokmatic/sdk-agent-standards` (existing private repo). Marketplace lives in `plugins/claude-code/` subdirectory.

```
strokmatic/sdk-agent-standards/
├── .claude/
│   ├── CLAUDE.md              # Company-wide coding standards (existing)
│   ├── SLASH_COMMANDS.md      # Command reference (existing)
│   └── context.md             # Generalized (existing, fix VK-specific content)
├── plugins/
│   └── claude-code/
│       ├── .claude-plugin/
│       │   └── marketplace.json
│       ├── office-suite/
│       │   ├── .claude-plugin/plugin.json
│       │   ├── skills/
│       │   │   ├── docx/SKILL.md
│       │   │   ├── xlsx/SKILL.md
│       │   │   ├── pptx/SKILL.md
│       │   │   └── md-to-pdf/SKILL.md
│       │   └── scripts/
│       │       ├── docx-tool.py
│       │       ├── xlsx-tool.py
│       │       ├── pptx-tool.py
│       │       └── requirements.txt
│       ├── development/
│       │   ├── .claude-plugin/plugin.json
│       │   └── skills/
│       │       ├── tdd/
│       │       │   ├── SKILL.md
│       │       │   ├── tests.md
│       │       │   ├── mocking.md
│       │       │   ├── deep-modules.md
│       │       │   ├── interface-design.md
│       │       │   └── refactoring.md
│       │       ├── grill-me/SKILL.md
│       │       ├── write-a-prd/SKILL.md
│       │       ├── prd-to-issues/SKILL.md
│       │       └── improve-architecture/SKILL.md
│       └── google-workspace/
│           ├── .claude-plugin/plugin.json
│           ├── skills/
│           │   ├── gdoc/SKILL.md
│           │   ├── gsheet/SKILL.md
│           │   ├── gslides/SKILL.md
│           │   └── gdrive/SKILL.md
│           ├── scripts/
│           │   └── markdown-to-docs.mjs
│           └── setup.md
├── BACKLOG.md                 # Deferred plugins
└── README.md
```

### 2.2 marketplace.json

```json
{
  "name": "strokmatic-plugins",
  "owner": {
    "name": "Strokmatic"
  },
  "metadata": {
    "description": "Strokmatic's Claude Code plugin collection — office tools, dev methodology, and Google Workspace.",
    "pluginRoot": "."
  },
  "plugins": [
    {
      "name": "office-suite",
      "source": "./office-suite",
      "description": "Create, read, edit Word/Excel/PowerPoint/PDF files",
      "version": "1.0.0"
    },
    {
      "name": "development",
      "source": "./development",
      "description": "TDD, PRD writing, architecture improvement, design grilling",
      "version": "1.0.0"
    },
    {
      "name": "google-workspace",
      "source": "./google-workspace",
      "description": "Google Docs, Sheets, Slides, Drive via gws CLI (OAuth)",
      "version": "1.0.0"
    }
  ]
}
```

### 2.3 Team Install Flow

```bash
# One-time marketplace registration
/plugin marketplace add strokmatic/sdk-agent-standards#plugins/claude-code

# Install desired plugins
/plugin install office-suite
/plugin install development
/plugin install google-workspace
```

### 2.4 Skill Adaptation Checklist

For each skill extracted to marketplace:

- [ ] Remove all `$ORCHESTRATOR_HOME` and JARVIS-specific path references
- [ ] Remove Strokmatic product names from examples
- [ ] Replace MCP tool calls with `gws` CLI commands (google-workspace skills)
- [ ] Python tools: reference via `${CLAUDE_SKILL_DIR}/../scripts/<tool>.py`
- [ ] Python tools: add auto-venv preamble (create `.venv/` on first use)
- [ ] Add `metadata.source` to Pocock-originated skills
- [ ] Ensure SKILL.md < 500 lines (move details to reference files)
- [ ] Test on a fresh project with no JARVIS context

### 2.5 JARVIS After Extraction

Skills **removed** from JARVIS (now in marketplace):
- docx, xlsx, pptx, md-to-pdf
- tdd-pocock (renamed to `tdd` in marketplace)
- grill-me, write-a-prd, prd-to-issues, improve-architecture

Skills **kept** in JARVIS (override marketplace where applicable):
- gdoc, gsheet, gslides, gdrive — JARVIS versions use domain-wide delegation MCP server
- All 25 JARVIS-internal and Strokmatic-specific skills

### 2.6 Deferred Plugins (Backlog)

| Plugin | Skills | Reason Deferred |
|---|---|---|
| **engineering** | cad, mechanical, cae | Not fully developed/tested |
| **meeting-assistant** | meeting | Complex (STT, Google Docs) — needs standalone packaging |
| **notifications** | notify | Low team demand currently |

---

## Part 3: Google Workspace via `gws` CLI

### 3.1 Background

Google launched the official Workspace CLI (`gws`, npm: `@googleworkspace/cli`) on ~2026-03-05. It's a Rust binary that dynamically generates its command surface from Google's Discovery Service, covering every Workspace API. Current version: v0.18.1 (pre-v1.0, very active development).

### 3.2 Why `gws` Instead of Custom MCP Server

| Aspect | Custom MCP Server (planned) | `gws` CLI (chosen) |
|---|---|---|
| **Auth** | Had to implement OAuth PKCE from scratch | Built-in: `gws auth login` |
| **API coverage** | 19 hand-coded tools | Every Workspace API (auto-generated) |
| **Maintenance** | Manual — add tools one by one | Automatic — Discovery Service |
| **Effort** | 5-6 days | ~1.5 days |
| **Integration** | MCP server over stdio | CLI via `Bash(gws:*)` |

### 3.3 Marketplace Plugin Design

```
google-workspace/
├── .claude-plugin/plugin.json
├── skills/
│   ├── gdoc/SKILL.md        # Wraps: gws docs documents.*
│   ├── gsheet/SKILL.md      # Wraps: gws sheets spreadsheets.*
│   ├── gslides/SKILL.md     # Wraps: gws slides presentations.*
│   └── gdrive/SKILL.md      # Wraps: gws drive files.*
├── scripts/
│   └── markdown-to-docs.mjs # Custom converter (preserved from JARVIS)
└── setup.md                 # Prerequisites: npm i -g @googleworkspace/cli && gws auth login
```

Skills check for `gws` on first invocation and guide the user through setup if missing.

### 3.4 JARVIS Stays on MCP Server

JARVIS continues using its battle-tested `google-workspace` MCP server with domain-wide delegation. No migration planned — the MCP server is stable, and 9 skills depend on it. A future migration to `gws` is backlogged for when `gws` reaches v1.0.

### 3.5 The Only Gap: Markdown → Google Docs

`gws` doesn't have a markdown-to-native-Docs-formatting converter. Our custom `MarkdownToDocsConverter` (renders headings, lists, bold, italic, links, code blocks as native Google Docs API requests) is bundled in `scripts/markdown-to-docs.mjs`. Skills invoke it when creating or updating documents from markdown content.

---

## Part 4: Phased Execution

### Phase 1: Internal Cleanup (Week 1-2)

| Task | Effort | Impact |
|---|---|---|
| Move misplaced config files to `config/orchestrator/` | 1 day | Consistency |
| Partition workspaces.json into 4 files | 2 days | Maintainability |
| Clean root directory (travel-planner.html, session files) | 30 min | Hygiene |
| Move messaging state from logs/ to data/messaging/ | 1 day | Clarity |
| Set up logrotate for cron logs | 1 hour | Prevent unbounded growth |
| Implement VK health data retention (30/90/180 day policy) | 1 day | Storage |

### Phase 2: Deduplication (Week 2-3)

| Task | Effort | Impact |
|---|---|---|
| Extract health-monitor framework from VK/SF | 3 days | -2,000 LOC |
| Deduplicate PR review service scripts | 1 day | -500 LOC |
| Create shared Node.js utilities (json-utils, google-auth) | 1 day | DRY |
| Create shared Python document_base.py | 4 hours | DRY |
| Extract prompt-builder.sh from orchestrator/dispatcher | 4 hours | DRY |

### Phase 3: Marketplace — development + office-suite Plugins (Week 3)

| Task | Effort | Impact |
|---|---|---|
| Create `plugins/claude-code/` structure in sdk-agent-standards | 2 hours | Foundation |
| Write marketplace.json and plugin.json files | 1 hour | Metadata |
| Extract development plugin (tdd + 5 refs, grill-me, write-a-prd, prd-to-issues, improve-architecture) | 4 hours | 5 skills |
| Extract office-suite plugin (docx, xlsx, pptx, md-to-pdf + Python tools) | 1 day | 4 skills + bundled scripts |
| Add auto-venv preamble to office-suite skills | 2 hours | UX |
| Test `/plugin marketplace add` and `/plugin install` flows | 4 hours | Validation |
| Remove extracted skills from JARVIS | 1 hour | Cleanup |

### Phase 4: Marketplace — google-workspace Plugin (Week 4)

| Task | Effort | Impact |
|---|---|---|
| Install and test `gws` CLI locally | 2 hours | Prerequisite validation |
| Rewrite gdoc/gsheet/gslides/gdrive skills to wrap `gws` commands | 1 day | 4 skills |
| Bundle markdown-to-docs.mjs helper | 2 hours | Gap coverage |
| Write setup.md with gws install + auth instructions | 1 hour | Onboarding |
| End-to-end test on fresh machine (no JARVIS, no MCP server) | 4 hours | Validation |
| Update README in sdk-agent-standards | 1 hour | Documentation |

---

## Appendix A: Effort Summary

| Phase | Effort | Outcome |
|---|---|---|
| Phase 1: Internal Cleanup | ~5.5 days | Consolidated config, retention policy, clean structure |
| Phase 2: Deduplication | ~5.5 days | -2,500 LOC, shared libraries |
| Phase 3: Marketplace (dev + office) | ~3 days | 9 skills in 2 plugins |
| Phase 4: Marketplace (google-workspace) | ~2 days | 3 skills + gws integration |
| **Total** | **~16 days** | Clean JARVIS + 3-plugin marketplace with 12 skills |

## Appendix B: Final State Metrics

| Metric | Current | After |
|---|---|---|
| Skills in JARVIS | 41 | 25 (-16 extracted + removed) |
| Skills in marketplace | 0 | 12 across 3 plugins |
| Duplicated LOC | ~4,500 | ~0 |
| Config files at root `config/` | 3 misplaced | 0 (all in `config/orchestrator/`) |
| workspaces.json | 1,081 lines (1 file) | ~270 lines avg (4 files) |
| Health monitor scripts | 14 (VK: 8, SF: 6) | 7 framework + 4 overrides |
| MCP shared utilities | 1 | 3 |
| Data retention policy | None | 30/90/180 day tiers |
| Google Workspace auth (marketplace) | N/A | `gws` CLI OAuth (zero custom code) |
