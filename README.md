# J.A.R.V.I.S.

**Just A Rather Very Intelligent System** — A personal AI orchestration platform built on [Claude Code](https://claude.ai/claude-code).

JARVIS is a meta-layer that manages multiple software product workspaces, automates coding tasks, tracks backlogs and changelogs, sends notifications via Telegram, generates reports, and continuously improves its own operation. It is designed for a single developer managing three industrial software product lines at [Strokmatic](https://strokmatic.com).

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Products Managed](#products-managed)
- [Directory Structure](#directory-structure)
- [MCP Servers](#mcp-servers)
- [Skills (Slash Commands)](#skills-slash-commands)
- [Hooks](#hooks)
- [CLI Tools](#cli-tools)
- [Dashboard](#dashboard)
- [Scripts & Automation](#scripts--automation)
- [Configuration](#configuration)
- [Backlogs & Changelogs](#backlogs--changelogs)
- [Email Organizer](#email-organizer)
- [Self-Improvement Loop](#self-improvement-loop)
- [Setup](#setup)
- [Key Architecture Patterns](#key-architecture-patterns)

---

## Architecture Overview

```
                           ┌─────────────────────────────────┐
                           │          JARVIS (Claude Code)    │
                           │     Master session + CLAUDE.md   │
                           └────────────┬────────────────────┘
                                        │
               ┌────────────────────────┼────────────────────────┐
               │                        │                        │
     ┌─────────▼─────────┐   ┌─────────▼─────────┐   ┌─────────▼─────────┐
     │   11 MCP Servers   │   │   17 Skills        │   │   5 Hooks          │
     │   (stdio, Node.js) │   │   (slash commands)  │   │   (lifecycle)      │
     └─────────┬─────────┘   └───────────────────┘   └───────────────────┘
               │
    ┌──────────┼──────────┬──────────────┬──────────────┐
    │          │          │              │              │
    ▼          ▼          ▼              ▼              ▼
 Backlog   Changelog   Task         Notifier      Workspace
 Manager   Writer      Dispatcher   (Telegram)    Analyzer
    │          │          │              │              │
    ▼          ▼          ▼              ▼              ▼
 backlogs/ changelogs/ logs/         Telegram      workspaces/
                       dispatches    Bot API       strokmatic/
                       .json                       ├── visionking/
                                                   ├── spotfusion/
                                                   ├── diemaster/
                                                   └── sdk/
```

The system operates as a Claude Code session with MCP servers providing tools for task management, workspace analysis, notification delivery, and self-improvement. Tasks are dispatched to product workspaces as independent Claude Code subprocesses with injected context and acceptance criteria.

### Core Workflow

1. **Backlog Processing** (daily, 09:00) — The orchestrator reads pending tasks from product backlogs, selects models based on complexity, and dispatches them to the appropriate workspace.
2. **Task Execution** — Each dispatch launches a Claude Code subprocess in the workspace directory with product context, coding guidelines, and acceptance criteria injected.
3. **Verification** — On completion, the dispatcher runs acceptance criteria checks (file existence, test pass, content match, command success).
4. **Notification** — Task outcomes are pushed to Telegram with status, duration, and error details.
5. **Changelog & Reporting** — Changes are logged to per-workspace changelogs. Daily and weekly reports are generated automatically.
6. **Self-Improvement** — The system analyzes dispatch patterns, model performance, and workspace health to propose and apply configuration improvements.

---

## Products Managed

JARVIS manages three industrial software product lines, plus shared SDK components:

### VisionKing
Industrial visual inspection system for steel mills and vehicle body plants. Linear pipeline architecture:

```
Cameras → Redis → Image Saver → Inference (YOLO) → Database Writers → Dashboard
```

- **Deployment profiles**: Laminacao (steel surface defects) and Carrocerias (vehicle body panels)
- **Key tech**: Python, Redis/KeyDB, RabbitMQ (aio-pika), PostgreSQL, Docker
- **~20 microservices** across two deployment nodes per plant
- **Clients**: GM, ArcelorMittal, Usiminas, Hyundai, Stellantis

### SpotFusion
Weld spot detection and classification system. Fan-out pipeline architecture:

```
Smart Cameras → Detection → N Spots × M Classifiers → Aggregation → Database
```

- **26+ microservices** with Comau robot integration
- **Key tech**: Python, Redis, RabbitMQ, PostgreSQL, Docker, Vue.js
- **Clients**: GM, Nissan, Hyundai, VWCO

### DieMaster
IoT stamping equipment monitoring system:

```
ESP32 Sensors → Firmware → Cloud Services → Backend → Dashboard
```

- **Key tech**: C/C++ (ESP-IDF firmware), Python, GCP, no RabbitMQ
- **Focus**: Vibration/temperature monitoring, predictive maintenance
- **Clients**: GM, Stellantis, FUNDEP (R&D)

### SDK
Shared libraries and toolkit consolidation across all products: PLC tools, Redis tools, deployment framework, defect visualization, message posting, image processing, welding tools.

---

## Directory Structure

```
JARVIS/
├── .claude/
│   ├── CLAUDE.md                    # Master system prompt (coding principles, checklist, lessons learned)
│   ├── settings.local.json          # Hook registrations + tool permissions
│   ├── hooks/                       # 5 lifecycle hooks (bash scripts)
│   │   ├── DashboardSummary.hook.sh
│   │   ├── PreDispatchValidator.hook.sh
│   │   ├── BacklogPreloader.hook.sh
│   │   ├── CompletionNotifier.hook.sh
│   │   ├── ChangelogVerifier.hook.sh
│   │   └── lib/utils.sh            # Shared hook utilities
│   └── skills/                      # 17 slash command definitions
│       ├── jarvis/SKILL.md
│       ├── strokmatic/SKILL.md
│       ├── visionking/SKILL.md
│       ├── spotfusion/SKILL.md
│       ├── diemaster/SKILL.md
│       ├── vk-pipeline/SKILL.md
│       ├── vk-deploy-review/SKILL.md
│       ├── vk-service-info/SKILL.md
│       ├── sf-pipeline/SKILL.md
│       ├── map-topology/SKILL.md
│       ├── help-strokmatic/SKILL.md
│       ├── mechanical/SKILL.md
│       ├── xlsx/SKILL.md
│       ├── email-organizer/SKILL.md
│       └── email-analyze/SKILL.md
│
├── mcp-servers/                     # 11 MCP servers (Node.js, stdio transport)
│   ├── backlog-manager/
│   ├── changelog-writer/
│   ├── changelog-reviewer/
│   ├── task-dispatcher/
│   ├── report-generator/
│   ├── notifier/
│   ├── workspace-analyzer/
│   ├── email-analyzer/
│   ├── self-improvement-miner/
│   ├── model-learning-analyzer/
│   └── clickup-connector/
│
├── tools/                           # Python CLI tools
│   ├── email-organizer/             # IMAP email ingestion (own .venv)
│   │   ├── main.py
│   │   └── requirements.txt
│   ├── mech-tool.py                 # Mechanical file tool (DXF, STEP, STL, etc.)
│   ├── xlsx-tool.py                 # Excel file tool
│   └── .venv/                       # Shared venv for mech-tool + xlsx-tool
│
├── tools/orchestrator-dashboard/     # Express.js observability dashboard (port 3000)
│   ├── server.js
│   ├── public/
│   │   ├── index.html               # Full dashboard
│   │   ├── mini.html                # Compact floating view
│   │   ├── style.css
│   │   └── app.js
│   └── parsers/                     # Data parsers for API endpoints
│
├── scripts/                         # Automation scripts
│   ├── orchestrator.sh              # Main entry point (7 modes)
│   ├── morning-report.sh            # Daily JARVIS briefing → Telegram
│   ├── execute-batch.mjs            # Parallel batch task executor
│   ├── task-dispatcher.sh           # Individual task dispatch wrapper
│   ├── fetch-all-remotes.sh         # Git remote fetch across workspaces
│   ├── update-access-matrix.sh      # GitHub access matrix update
│   ├── bootstrap-context-files.mjs  # One-time context.md generator
│   ├── init-workspace.sh            # New workspace initializer
│   └── verify-setup.sh              # Installation verifier
│
├── config/
│   ├── project-codes.json           # 20 email project codes (5-digit industrial IDs)
│   ├── self-improvement.json        # Self-improvement thresholds
│   ├── orchestrator/
│   │   ├── workspaces.json          # 70+ workspace registry (git-ignored)
│   │   ├── models.json              # Model routing (complexity → model)
│   │   ├── notifications.json       # Telegram/Discord config (git-ignored)
│   │   ├── schedules.json           # Cron schedule definitions
│   │   ├── dispatcher.json          # Parallelism and timeout settings
│   │   ├── pricing.json             # API cost reference
│   │   └── clickup.json             # ClickUp integration config
│   ├── claude/                      # Claude Code local config
│   └── cron/                        # Crontab templates
│
├── backlogs/
│   ├── products/                    # Per-product task backlogs (markdown)
│   │   ├── strokmatic.visionking.md
│   │   ├── strokmatic.spotfusion.md
│   │   ├── strokmatic.diemaster.md
│   │   ├── strokmatic.sdk.md
│   │   └── strokmatic.general.md
│   ├── plans/                       # Implementation plan documents
│   └── orchestrator/                # Self-improvement backlog
│       ├── README.md                # Index of done/planned features
│       └── completed/               # Archived feature specs
│
├── changelogs/                      # Per-workspace changelogs (Keep a Changelog format)
├── reports/                         # Generated daily/weekly/morning reports
├── logs/                            # Runtime data (dispatches, notifications, learning)
├── docs/                            # Setup, skills, and troubleshooting guides
├── workspaces/                      # Product monorepos (git-ignored)
│   └── strokmatic/
│       ├── visionking/              # VisionKing monorepo + services
│       ├── spotfusion/              # SpotFusion monorepo + services
│       ├── diemaster/               # DieMaster monorepo + services
│       ├── sdk/                     # Shared SDK repos
│       └── pmo/                     # Per-project email/report storage
└── setup/                           # Install/update/uninstall scripts
```

---

## MCP Servers

All MCP servers use the `@modelcontextprotocol/sdk` with stdio transport. They read `ORCHESTRATOR_HOME` from the environment.

### backlog-manager (v1.1.0)

Manages markdown-formatted task backlogs with three-way merge synchronization between central and workspace-local copies.

| Tool | Description |
|------|-------------|
| `list_backlog_tasks` | List pending tasks for a workspace, filterable by priority |
| `add_backlog_task` | Add a task with priority and complexity tag |
| `complete_backlog_task` | Mark a task complete via substring match, stamp completion date |
| `sync_backlog` | Three-way merge (baseline vs central vs workspace-local) |

Backlogs are stored at `backlogs/products/<workspace>.md` and mirrored to `<workspace-path>/.claude/backlog.md`. A baseline snapshot enables conflict detection and merge.

### changelog-writer (v1.0.0)

Manages per-workspace changelogs in [Keep a Changelog](https://keepachangelog.com/) format.

| Tool | Description |
|------|-------------|
| `add_changelog_entry` | Add entry under correct date/section, creating headers if needed |
| `get_changelog` | Return full changelog content |
| `get_recent_changes` | Return entries from the past N days |

Mirrors entries to the workspace-local `CHANGELOG.md`.

### changelog-reviewer (v1.0.0)

Reviews unreleased changelog entries and proposes git deployment plans.

| Tool | Description |
|------|-------------|
| `review_changelog` | Parse unreleased entries grouped by section |
| `propose_deployment_plan` | Group entries into feature/fix/chore branches with commit messages |
| `execute_deployment_plan` | Generate shell git commands for approved plans |
| `list_unreleased_changes` | Quick count of unreleased entries per workspace |

Plans are persisted to `logs/deployment-plans.json`.

### task-dispatcher (v1.2.0)

The core orchestration engine. Dispatches tasks, tracks lifecycle, verifies completion, and runs batch operations.

| Tool | Description |
|------|-------------|
| `dispatch_task` | Create dispatch, select model, inject context, extract acceptance criteria |
| `get_task_status` | Get full dispatch record by ID |
| `list_dispatched_tasks` | List dispatches with workspace/status/limit filters |
| `update_task_status` | State machine: `pending → running → verifying → complete\|failed` |
| `verify_task_completion` | Run acceptance criteria checks (file_exists, test_pass, content_match, command_success) |
| `update_task_outcome` | Record outcome, execution time, and token usage |
| `mark_task_complete_override` | Manual completion bypass |
| `dispatch_batch` | Dispatch tasks to multiple workspaces in parallel |
| `get_batch_status` | Query batch progress |
| `cancel_batch` | Cancel all pending tasks in a batch |

**Model selection** reads from `config/orchestrator/models.json`:
- `simple` → Haiku (docs, README, small fixes)
- `medium` → Sonnet (features, refactoring)
- `complex` → Opus (architecture, design, multi-file changes)

**Context injection**: Each dispatch prepends workspace-local `context.md` and product-level context as XML-tagged blocks to the task prompt.

**Acceptance criteria extraction**: Automatically detects criteria from the task description and workspace config (package.json, pyproject.toml) to verify completion.

### notifier (v1.2.0)

Bidirectional Telegram integration with Discord support.

| Tool | Description |
|------|-------------|
| `send_notification` | Send task events (completed/failed/started/timeout) to enabled backends |
| `test_notification` | Verify backend configuration |
| `check_telegram_inbox` | Poll inbound messages; parse `/status`, `/dispatch`, `/cancel` commands; transcribe voice via Groq Whisper |
| `get_inbox` | Retrieve stored messages, filterable by status |
| `reply_telegram` | Send freeform reply to Telegram chat |

**Telegram features**: MarkdownV2 formatting, emoji status prefixes, duration classification (quick/standard/long/extended), role mentions on failures.

**Voice support**: Voice messages are downloaded, transcribed via Groq Whisper API, and stored as text in the inbox.

### report-generator (v1.0.0)

Generates activity reports from changelogs.

| Tool | Description |
|------|-------------|
| `generate_daily_report` | Scan all changelogs for today's entries |
| `generate_weekly_report` | Weekly summary |
| `generate_workspace_report` | Per-workspace report for day/week/month |

Reports are saved to `reports/`.

### workspace-analyzer (v1.1.0)

Analyzes workspace health and generates context files.

| Tool | Description |
|------|-------------|
| `analyze_workspace_health` | Check for package.json, README, tests, git status |
| `suggest_tasks` | Return prioritized task suggestions |
| `get_workspace_stats` | Count files, LOC, git commits |
| `generate_workspace_context` | Detect tech stack and generate `context.md` |

**Stack detection**: Node, React, Angular, Vue, Next, NestJS, Python, Rust, Go, Java, C++, Docker.

### email-analyzer (v1.0.0)

AI intelligence layer for email analysis. Works alongside the `email-organizer` CLI tool.

| Tool | Description |
|------|-------------|
| `classify_email` | Return project context for Claude to determine classification |
| `extract_entities` | Write extracted entities (dates, actions, decisions) to parsed JSON |
| `update_project_report` | Write/update `technical_report.md` with history backup |
| `extract_timeline` | Merge timeline events to `timeline.json` with deduplication |
| `get_project_emails` | Retrieve parsed emails (filterable to unanalyzed only) |
| `get_project_context` | Return report preview, timeline count, email stats |

See [Email Organizer](#email-organizer) for full details.

### self-improvement-miner (v1.0.0)

Analyzes orchestrator operation patterns and proposes improvements.

| Tool | Description |
|------|-------------|
| `analyze_patterns` | Run dispatch, workspace health, and model routing analyzers |
| `generate_meta_report` | Generate comprehensive self-improvement report |
| `apply_proposal` | Apply config change proposal (dry-run by default) |

### model-learning-analyzer (v1.0.0)

Learns from dispatch outcomes to suggest model routing improvements.

| Tool | Description |
|------|-------------|
| `analyze_model_performance` | Group dispatches by model+complexity, compute success rates |
| `suggest_model_rules` | Identify underperforming models, over-provisioned Opus, missing rules |
| `apply_model_suggestion` | Apply suggestion to models.json (requires >=70% confidence) |
| `reject_model_suggestion` | Mark suggestion rejected with reason |

### clickup-connector (v1.0.0)

Bridges the orchestrator backlog with ClickUp project management.

| Tool | Description |
|------|-------------|
| `discover_clickup_structure` | Discover ClickUp team/spaces/folders/lists |
| `fetch_clickup_task` | Fetch task with PT-BR/English translation |
| `push_task_to_clickup` | Create task in ClickUp with product routing |
| `sync_task_status` | Bidirectional status sync |
| `post_progress_update` | Post `[Orchestrator]` progress comments |
| `update_task_description` | Update description with translation |
| `link_backlog_to_clickup` | Cross-reference local backlog with ClickUp task IDs |

**Status mapping**: pending ↔ "to do", running ↔ "in progress", verifying ↔ "in review", complete ↔ "complete".

---

## Skills (Slash Commands)

Skills are custom Claude Code slash commands defined in `.claude/skills/*/SKILL.md`.

### Context Loaders

| Skill | Description |
|-------|-------------|
| `/jarvis` | Adopt the J.A.R.V.I.S. persona (addresses user as "sir", dry British humor) and load orchestrator context |
| `/strokmatic` | Load all three product contexts simultaneously (VisionKing + SpotFusion + DieMaster) |
| `/visionking` | Load VisionKing context: pipeline, queues, Redis, deployment profiles, backlog |
| `/spotfusion` | Load SpotFusion context: fan-out architecture, 26+ services |
| `/diemaster` | Load DieMaster context: IoT/ESP32 architecture, security concerns, backlog |

### Product Tools

| Skill | Description |
|-------|-------------|
| `/vk-pipeline` | Explain VisionKing pipeline from cameras to database (two routing paths) |
| `/vk-deploy-review <folder>` | Analyze production deployment: topology, Mermaid diagram, issues report |
| `/vk-service-info <service>` | Look up a VisionKing service (Dockerfile, compose, architecture) |
| `/sf-pipeline` | Explain SpotFusion fan-out architecture |
| `/map-topology [output-dir]` | Map running production topology from remote machines via SSH |
| `/help-strokmatic` | List all available Strokmatic slash commands |

### Engineering Tools

| Skill | Description |
|-------|-------------|
| `/mechanical [subcommand] [file]` | Work with DXF, STEP, IGES, STL, GLTF, SVG, PDF, DWG files |
| `/xlsx [subcommand] [file]` | Work with Excel files (read, create, edit, inspect) |

### Email Tools

| Skill | Description |
|-------|-------------|
| `/email-organizer [subcommand]` | IMAP email fetch, classify, parse CLI tool |
| `/email-analyze [action] [project-code]` | AI-powered email analysis: classify, extract entities, generate reports |

---

## Hooks

All hooks source `lib/utils.sh` for shared path constants and helper functions. Hooks are fail-open by design — they warn but never block the agent.

| Hook | Trigger | Function |
|------|---------|----------|
| `DashboardSummary` | `SessionStart` | Print dispatch summary and pending backlog counts at session start |
| `PreDispatchValidator` | `PreToolUse: dispatch_task` | Block dispatch if workspace not found or path not accessible |
| `BacklogPreloader` | `PreToolUse: dispatch_task, list_backlog_tasks` | Sync workspace-local backlog to central if local is newer |
| `CompletionNotifier` | `PostToolUse: update_task_status` | Log task completion/failure with ID and error details |
| `ChangelogVerifier` | `PostToolUse: complete_backlog_task` | Warn if no changelog entry exists for workspace dated today |

---

## CLI Tools

### Email Organizer (`tools/email-organizer/`)

IMAP email ingestion into PMO project folders. Uses shared `tools/.venv/`.

```bash
EMAIL="tools/.venv/bin/python tools/email-organizer/main.py"

$EMAIL fetch                        # Download emails from IMAP + auto-classify
$EMAIL classify                     # Classify staged emails to PMO folders
$EMAIL parse 02008                  # Parse raw emails, extract metadata
$EMAIL ingest                       # Full pipeline: fetch → classify → parse
$EMAIL list --project 02008         # Show ingested emails
$EMAIL reprocess 02008              # Re-parse all emails for a project
```

Requires `IMAP_USERNAME` and `IMAP_PASSWORD` environment variables.

### Mechanical File Tool (`tools/mech-tool.py`)

Engineering file format processing. Supports DXF, STEP, IGES, STL, GLTF/GLB, SVG, PDF, DWG.

```bash
MECH="tools/.venv/bin/python tools/mech-tool.py"

$MECH info part.step               # Quick summary: format, units, metadata
$MECH read drawing.dxf             # Full structured extraction (JSON/table)
$MECH convert model.step -o out.stl   # Format conversion
$MECH validate part.stl            # Integrity checks
```

### Excel Tool (`tools/xlsx-tool.py`)

Excel file operations using `openpyxl`.

```bash
XLSX="tools/.venv/bin/python tools/xlsx-tool.py"

$XLSX read file.xlsx                       # Print data as table
$XLSX read file.xlsx --with-styles --format json   # Include colors, fonts, borders
$XLSX create output.xlsx -i data.json      # Create from JSON
$XLSX edit file.xlsx --set A1=Hello        # Edit cells
$XLSX info file.xlsx                       # List sheets, dimensions, headers
```

---

## Dashboard

Express.js observability dashboard at port 3000.

**Views:**
- **Full Dashboard** (`/`) — Dispatch history, model usage charts, workspace activity, cost tracking
- **Mini Dashboard** (`/mini.html`) — Compact floating view with live stats, auto-refresh every 15s

**API Endpoints:**

| Endpoint | Data |
|----------|------|
| `GET /api/dispatches` | Dispatch stats: total, last 24h/7d, status counts, model usage |
| `GET /api/workspaces` | Workspace registry |
| `GET /api/backlogs` | Backlog task counts per workspace |
| `GET /api/changelogs` | Recent changelog entries |
| `GET /api/notifications` | Last 30 notification events |

Runs as a systemd user service (`orchestrator-dashboard.service`).

---

## Scripts & Automation

### orchestrator.sh

Main entry point with 7 operation modes:

```bash
./scripts/orchestrator.sh process-backlogs   # Process pending tasks (1 per workspace, priority-ordered)
./scripts/orchestrator.sh daily-report       # Generate daily activity report
./scripts/orchestrator.sh weekly-report      # Generate weekly summary
./scripts/orchestrator.sh suggest-goals      # Suggest weekly goals
./scripts/orchestrator.sh fetch-remotes      # Fetch all git remotes
./scripts/orchestrator.sh update-access      # Update GitHub access matrix
./scripts/orchestrator.sh manual             # Interactive manual dispatch
```

### morning-report.sh

Automated JARVIS morning briefing. Runs `claude` CLI with Haiku model to generate a status report, then sends it to Telegram:

```
Good morning, sir. JARVIS daily briefing for 2026-02-17.

SYSTEMS STATUS:
- Orchestrator: master, clean
- Workspaces: 70 registered (20 VisionKing, 26 SpotFusion, 15 DieMaster, 9 SDK)

HIGH-PRIORITY ITEMS:
- VisionKing: VK-01 aio-pika migration, VK-05 deployment automation
- DieMaster: DM-03 security audit, DM-07 firmware OTA

RECENT ACTIVITY:
- eb29e64 feat: add email organizer tool, MCP server, and skills
...

Ready when you are, sir.
```

### Cron Schedule

| Time | Job |
|------|-----|
| 06:00 daily | Update GitHub access matrix |
| 07:30 daily | Fetch all git remotes across workspaces |
| 07:45 daily | JARVIS morning briefing → Telegram |
| 09:00 daily | Process backlogs (1 task/workspace, priority-ordered) |
| 17:00 daily | Generate daily report |
| 16:00 Friday | Generate weekly report |
| 08:00 Monday | Suggest weekly goals |

### Other Scripts

| Script | Purpose |
|--------|---------|
| `execute-batch.mjs` | Parallel batch executor with semaphore concurrency and workspace locking |
| `fetch-all-remotes.sh` | Git fetch across all registered workspaces |
| `update-access-matrix.sh` | Generate `reports/github-access-matrix.md` |
| `bootstrap-context-files.mjs` | One-time generator for workspace `context.md` files |
| `init-workspace.sh` | Initialize a new workspace (CLAUDE.md, backlog, changelog) |
| `verify-setup.sh` | Verify all MCP servers are installed and configured |

---

## Configuration

### Workspace Registry (`config/orchestrator/workspaces.json`)

70+ workspace entries. Each workspace has:

```json
{
  "strokmatic.visionking.services.inference": {
    "path": "/home/teruel/JARVIS/workspaces/strokmatic/visionking/services/inference",
    "type": "unknown",
    "category": "service",
    "product": "visionking",
    "priority": "high",
    "auto_review": true,
    "remotes": { "origin": "git@github.com:strokmatic/visionking-inference.git" }
  }
}
```

**Categories**: `monorepo`, `service`, `toolkit`, `data-science`, `library`, `legacy`, `firmware`, `sdk`
**Priority**: `high` (auto_review: true), `medium`, `low`

### Model Routing (`config/orchestrator/models.json`)

```json
{
  "simple": "claude-haiku-4-5-20251001",
  "medium": "claude-sonnet-4-5-20250929",
  "complex": "claude-opus-4-5-20251101",
  "rules": {
    "architecture": "complex",
    "design": "complex",
    "documentation": "simple",
    "readme": "simple"
  }
}
```

### Notifications (`config/orchestrator/notifications.json`)

Telegram bot with inbound polling and Groq Whisper voice transcription. Discord support available but disabled.

### Schedules (`config/orchestrator/schedules.json`)

Defines cron job timing and parameters (e.g., `max_tasks_per_workspace: 1`).

### Dispatcher (`config/orchestrator/dispatcher.json`)

```json
{
  "max_parallel_workers": 4,
  "workspace_lock_timeout_minutes": 30,
  "batch_timeout_minutes": 120
}
```

### Project Codes (`config/project-codes.json`)

20 industrial project codes for email classification:

| Range | Product | Example |
|-------|---------|---------|
| `01xxx` | DieMaster | 01001: GM Sao Jose dos Campos - S10 CC PUBX LH |
| `02xxx` | SpotFusion | 02008: Nissan Smyrna Spot Fusion |
| `03xxx` | VisionKing | 03002: ArcelorMittal Barra Mansa - TL1 |

Each entry maps a 5-digit code to project name, keyword list, sender list, and PMO folder path.

---

## Backlogs & Changelogs

### Backlogs

Task backlogs are markdown files with prioritized, tagged task lists:

```markdown
## Product Features
- [ ] [complex] FEAT-01: Create opener-based EIP connector
- [ ] [medium] FEAT-02: Implement advanced logging in observability-stack
- [x] [simple] FEAT-03: Add health check endpoint <!--completed:2026-02-16-->
```

**Three-way merge**: When both the orchestrator and a workspace agent modify the same backlog, the `sync_backlog` tool performs a three-way merge using a baseline snapshot to detect and resolve conflicts at the task-line level.

### Changelogs

Per-workspace changelogs follow [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## 2026-02-17

### Added
- Email organizer tool with IMAP ingestion
- email-analyzer MCP server with 6 tools

### Fixed
- Project code classification for 5-digit labels
```

The `changelog-reviewer` MCP can parse unreleased entries and propose git deployment plans with conventional branch names.

---

## Email Organizer

A two-layer system for managing project emails: a Python CLI tool for data plumbing and an MCP server for AI-powered analysis.

### Data Flow

```
Gmail (IMAP)
  │
  ├── 5-digit labels (01001, 02008, 03002, ...)
  │
  ▼
email-organizer CLI (fetch)
  │
  ├── Inject X-Email-KB-Project-Code header
  ├── SHA-256 dedup
  │
  ▼
Staging → Classify (keyword + sender match) → PMO folders
  │
  ▼
Parse → Extract headers, body, attachments, heuristics
  │
  ▼
pmo/{code}/
  ├── emails/raw/          ← Original .eml files
  ├── emails/parsed/       ← Structured JSON per email
  ├── emails/index.json    ← Master index
  └── attachments/         ← Deduplicated by email hash
```

### AI Analysis Layer

The `email-analyzer` MCP server provides tools that Claude Code uses conversationally:

1. **Read** emails via `get_project_emails`
2. **Classify** each email's category (technical/administrative/discussion/status)
3. **Extract** structured entities (dates, action items, decisions, technical notes)
4. **Write** results back via `extract_entities`, `update_project_report`, `extract_timeline`

This replaces the original SDK project-organizer's Claude API calls with local Claude Code reasoning — no API key needed, analysis happens in the conversation.

### Project Codes

20 projects across three product lines, mapped in `config/project-codes.json`:

- **DieMaster (01xxx)**: 01001–01005 (GM, Stellantis, FUNDEP)
- **SpotFusion (02xxx)**: 02001–02008 (GM, Nissan, Hyundai, VWCO)
- **VisionKing (03xxx)**: 03001–03010 (Usiminas, ArcelorMittal, GM, Hyundai, Stellantis)

---

## Self-Improvement Loop

JARVIS closes the feedback loop on its own operation through two dedicated MCP servers:

### Pattern Analysis (`self-improvement-miner`)

Analyzes dispatch history, workspace health trends, and model routing patterns. Generates meta-reports with actionable proposals (e.g., "Workspace X has no tests — suggest adding test framework").

### Model Learning (`model-learning-analyzer`)

Tracks dispatch outcomes by model and complexity. When a model underperforms (<70% success rate for a task type), it suggests routing changes. Suggestions require >=70% statistical confidence before they can be applied. All changes are logged to an audit trail.

### Improvement Cycle

```
Dispatches → Outcomes → Analysis → Proposals → (Human Approval) → Config Changes
     ▲                                                                    │
     └────────────────────────────────────────────────────────────────────┘
```

`auto_apply` is disabled by default — all proposals require human approval.

---

## Setup

### Prerequisites

- Node.js v18+
- Python 3.12+
- [Claude Code CLI](https://claude.ai/claude-code) (`claude`)
- `jq` (for hooks)

### Installation

```bash
git clone https://github.com/pteru/JARVIS.git ~/JARVIS
cd ~/JARVIS

# Install MCP server dependencies
for dir in mcp-servers/*/; do (cd "$dir" && npm install); done

# Install dashboard
cd dashboard && npm install && cd ..

# Install Python tool venv (shared for all tools)
python3 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements.txt

# Register MCP servers with Claude Code
claude mcp add backlog-manager node ~/JARVIS/mcp-servers/backlog-manager/index.js
claude mcp add changelog-writer node ~/JARVIS/mcp-servers/changelog-writer/index.js
claude mcp add task-dispatcher node ~/JARVIS/mcp-servers/task-dispatcher/index.js
claude mcp add report-generator node ~/JARVIS/mcp-servers/report-generator/index.js
claude mcp add notifier node ~/JARVIS/mcp-servers/notifier/index.js
claude mcp add workspace-analyzer node ~/JARVIS/mcp-servers/workspace-analyzer/index.js
claude mcp add email-analyzer node ~/JARVIS/mcp-servers/email-analyzer/index.js
claude mcp add self-improvement-miner node ~/JARVIS/mcp-servers/self-improvement-miner/index.js
claude mcp add model-learning-analyzer node ~/JARVIS/mcp-servers/model-learning-analyzer/index.js
claude mcp add clickup-connector node ~/JARVIS/mcp-servers/clickup-connector/index.js
claude mcp add changelog-reviewer node ~/JARVIS/mcp-servers/changelog-reviewer/index.js
```

### Configuration

1. Copy and edit workspace registry:
   ```bash
   cp config/orchestrator/workspaces.json.example config/orchestrator/workspaces.json
   ```

2. Configure Telegram notifications:
   ```bash
   cp config/orchestrator/notifications.json.example config/orchestrator/notifications.json
   # Edit with your Telegram bot token and chat ID
   ```

3. Set environment variables for email:
   ```bash
   export IMAP_USERNAME="your-email@gmail.com"
   export IMAP_PASSWORD="your-app-password"
   ```

4. Install cron jobs:
   ```bash
   crontab -e
   # Add entries from config/cron/orchestrator.cron (replace {{ORCHESTRATOR_HOME}} with ~/JARVIS)
   ```

### Verification

```bash
bash scripts/verify-setup.sh
```

---

## Key Architecture Patterns

1. **MCP-first design** — All intelligence is exposed through MCP tools callable by Claude Code. The orchestrator itself IS a Claude Code session with MCP servers providing capabilities.

2. **Fail-open hooks** — Hooks warn but never silently block. If `jq` is missing or a path is wrong, the hook allows through and logs a warning.

3. **Context injection** — Every dispatched task receives workspace-local context (`context.md`) and product-level context as XML-tagged blocks prepended to the prompt.

4. **Three-way backlog merge** — Central and workspace-local backlogs are reconciled using baseline snapshots, enabling concurrent edits by both the orchestrator and agents.

5. **Model routing with learning** — Dispatch outcomes feed back into model selection rules. Underperforming models are flagged, over-provisioned expensive models are downgraded.

6. **Telegram as control plane** — Bidirectional: outbound task notifications + inbound command parsing (`/status`, `/dispatch`, `/cancel`) + voice transcription.

7. **Self-improvement loop** — Pattern analysis and model learning close the feedback loop, proposing configuration improvements that require human approval.

8. **Separation of data plumbing and intelligence** — CLI tools (email-organizer, mech-tool, xlsx-tool) handle I/O and format conversion. Intelligence (classification, entity extraction, report generation) stays in Claude Code via MCP tools and skills.

---

## License

Private repository. All rights reserved.
