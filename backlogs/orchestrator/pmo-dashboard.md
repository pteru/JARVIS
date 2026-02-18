# PMO Dashboard — Project Management Web UI

## Overview

A web-based project management dashboard that provides a unified UI on top of the existing PMO folder structure. It centralizes project tracking for the design/procurement/quoting phases, managing supplier communications, technical documentation, schedules, and automated RFQ workflows. Runs on the local network, accessible by up to 10 concurrent users.

## Problem Statement

Today, the PMO data lives in well-structured folders (`pmo/{code}/`) with emails, parsed JSONs, reports, attachments, meeting notes, and context files — but there is no UI to browse, search, or act on this data. The `/pmo` skill and email-organizer CLI work well for a single Claude Code user, but the broader team (engineers, commercial, procurement) needs a visual interface to track project status, review supplier quotes, and monitor deadlines without touching the terminal.

## Core Capabilities

### 1. Project Overview Dashboard
- Multi-project summary view (all active codes from `project-codes.json`)
- Per-project cards showing: phase, next deadline, open action items, unread emails, schedule health
- Filterable by product line (01xxx SpotFusion, 02xxx SpotFusion, 03xxx VisionKing)
- Click into any project for full detail view

### 2. Supplier Management
- Supplier registry per project: company, contacts (name, email, phone), role (integrator, component vendor, subcontractor), status (active, quoting, awarded, rejected)
- Supplier extracted automatically from email corpus (sender domains, signatures) + manual additions
- Per-supplier view: all communications, received quotes, attached documents, response times
- Cross-project supplier view: "show me all projects involving COMAU"

### 3. Communications Tracker
- Email timeline per project (from `emails/index.json` + `emails/parsed/`)
- Thread reconstruction: group related emails by subject/references
- Unread/pending indicators: emails awaiting reply, with age-based escalation (yellow >3 days, red >7 days)
- Quick reply drafting: compose email text in UI, copy to clipboard or send via IMAP (future)
- Attachment browser: view/download from `emails/attachments/`

### 4. Document Library
- Centralized view of all project documents: reference/, reports/, meetings/, attachments/
- Categorized: technical specs, quotes, meeting minutes, contracts, drawings
- Full-text search across parsed email bodies and document names
- Version tracking: multiple revisions of the same document

### 5. Live Gantt Chart
- Interactive Mermaid-based or JS-native Gantt per project
- Data source: `schedule.json` in each PMO folder (structured task list with dates, dependencies, status)
- Auto-update: when new information arrives (email with delivery date, quote with lead time), the schedule updates
- Critical path highlighting and deadline alarms (visual + optional Telegram notification)
- Supports the existing Mermaid dark theme from `/mermaid` skill for consistency

### 6. RFQ Automation
- Specify a component/service needed (description, quantity, specs, deadline)
- Draft RFQ email to selected suppliers using a template
- Bulk send to multiple suppliers simultaneously
- Track which suppliers received the RFQ, who responded, response time
- Side-by-side quote comparison table (auto-extracted from email attachments or manual entry)

### 7. Supplier Research
- Given a component description, search for potential suppliers (web search integration)
- Suggest suppliers from the existing cross-project supplier database
- Add new suppliers to registry with one click

### 8. Alerts & Reminders
- Configurable deadline alerts: X days before a milestone, daily digest of overdue items
- Reply timeout alerts: if a supplier hasn't responded to an RFQ in Y days
- Schedule deviation alerts: if a task slips past its planned date
- Delivery channels: dashboard notification bell, optional Telegram (existing infrastructure)

## Architecture

### Tech Stack
- **Backend:** FastAPI (Python 3.12) — consistent with existing toolkit pattern (defect-report-toolkit)
- **Frontend:** Vue 3 SPA served by the backend (or Nginx), using PrimeVue or Vuetify for component library
- **Database:** SQLite for structured data (suppliers, schedule, alerts) + filesystem for documents (existing PMO folders)
- **Real-time:** Server-Sent Events (SSE) for live updates (new emails, schedule changes, alerts)
- **Auth:** Simple token-based auth (shared team token or per-user passwords in `.env`) — LAN only, not exposed to internet

### Data Flow
```
PMO Folders (filesystem)          SQLite (structured)
├── emails/index.json       →     suppliers, contacts
├── emails/parsed/*.json    →     schedule_tasks, milestones
├── emails/attachments/     →     rfq_tracking, quote_comparisons
├── technical_report.md     →     alerts, reminders
├── timeline.json           →     user_preferences
├── meetings/
├── reference/
└── reports/
```

The filesystem remains the source of truth for emails and documents. SQLite stores derived/interactive data (supplier registry, schedule, RFQ tracking, alerts). A sync daemon watches the PMO folders for changes and updates the DB.

### Deployment
```yaml
services:
  pmo-dashboard:
    build: ./tools/pmo-dashboard
    ports:
      - "8090:8090"
    volumes:
      - ../workspaces/strokmatic/pmo:/data/pmo:ro
      - ../config:/data/config:ro
      - ./pmo-dashboard-data:/data/db
    environment:
      - AUTH_TOKEN=${PMO_AUTH_TOKEN}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}  # optional, for alerts
    restart: unless-stopped
```

### API Design (key endpoints)

```
# Projects
GET    /api/projects                     # list all projects with summary stats
GET    /api/projects/{code}              # full project detail
GET    /api/projects/{code}/emails       # paginated email list with filters
GET    /api/projects/{code}/documents    # document library
GET    /api/projects/{code}/schedule     # Gantt data
PUT    /api/projects/{code}/schedule     # update schedule task

# Suppliers
GET    /api/suppliers                    # cross-project supplier list
POST   /api/suppliers                    # add new supplier
GET    /api/suppliers/{id}               # supplier detail with all communications
GET    /api/suppliers/{id}/quotes        # quotes from this supplier

# RFQ
POST   /api/rfq                          # create new RFQ
POST   /api/rfq/{id}/send               # send to selected suppliers
GET    /api/rfq/{id}/responses           # track responses

# Alerts
GET    /api/alerts                       # active alerts across all projects
PUT    /api/alerts/{id}/dismiss          # dismiss an alert

# Search
GET    /api/search?q=...&project=...     # full-text search across emails and docs
```

## Integration with Existing JARVIS Infrastructure

### Direct Reuse
| Component | How it's used | Changes needed |
|-----------|---------------|----------------|
| `config/project-codes.json` | Project registry — list of all projects, names, languages | Add `phase` and `status` fields |
| `emails/index.json` + `parsed/*.json` | Email timeline, communication tracking, sender extraction | None — read-only |
| `emails/attachments/` | Document library, quote attachments | None — read-only |
| `/email-organizer` | Background email fetch + classify + parse pipeline | Add cron job for periodic fetching |
| `/email-analyze` | AI classification, entity extraction for new emails | None — invoke as needed |
| `/mermaid` skill | Gantt chart dark theme tokens | Export theme as CSS variables for frontend |
| `technical_report.md` | Project summary, action items source | None — read-only |
| `timeline.json` | Event timeline source | None — read-only |
| Telegram bot infra | Alert delivery | Minor — add alert message templates |

### Improvements Needed
| Component | Current state | Improvement for PMO Dashboard |
|-----------|---------------|-------------------------------|
| Email organizer | CLI-only, manual fetch | Add periodic cron fetch (every 30 min), webhook trigger from dashboard |
| Email parser | Extracts basic fields | Add supplier extraction (company from domain/signature), quote detection (attachment analysis) |
| Project codes config | Name + language + keywords | Add `phase`, `status`, `start_date`, `target_date` fields |
| PMO folder structure | No `schedule.json` | Define and create schedule schema per project |
| Mermaid Gantt | Static markdown only | JS Gantt renderer (Frappe Gantt or similar) using same color tokens |

### New Components to Build
| Component | Purpose |
|-----------|---------|
| `tools/pmo-dashboard/` | FastAPI backend + Vue 3 frontend |
| `tools/pmo-dashboard/db/` | SQLite database (auto-created) |
| `tools/pmo-dashboard/sync.py` | Filesystem watcher syncing PMO folders → SQLite |
| `tools/pmo-dashboard/rfq.py` | RFQ template engine + IMAP send integration |
| `tools/pmo-dashboard/search.py` | Full-text search index (SQLite FTS5) |
| `/pmo-dashboard` skill | Claude Code skill to interact with the dashboard API |

## Data Schema

### `schedule.json` (new, per project)
```json
{
  "project_code": "03008",
  "last_updated": "2026-02-18T15:00:00",
  "tasks": [
    {
      "id": "acq1",
      "name": "Order Hikrobot camera",
      "category": "procurement",
      "start": "2026-03-01",
      "end": "2026-05-15",
      "status": "pending",
      "depends_on": [],
      "assignee": "Pedro",
      "supplier": "Hikrobot",
      "notes": "Lead time 10-12 weeks",
      "critical": true
    }
  ],
  "milestones": [
    {
      "id": "m1",
      "name": "POC delivery",
      "date": "2026-08-01",
      "status": "on_track"
    }
  ]
}
```

### Supplier Registry (SQLite)
```sql
CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY,
    company TEXT NOT NULL,
    domain TEXT,           -- email domain for auto-matching
    category TEXT,         -- integrator, component, subcontractor
    country TEXT,
    notes TEXT
);

CREATE TABLE supplier_contacts (
    id INTEGER PRIMARY KEY,
    supplier_id INTEGER REFERENCES suppliers(id),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT
);

CREATE TABLE supplier_projects (
    supplier_id INTEGER REFERENCES suppliers(id),
    project_code TEXT,
    role TEXT,              -- what they do on this project
    status TEXT,            -- quoting, awarded, rejected, active
    PRIMARY KEY (supplier_id, project_code)
);
```

### RFQ Tracking (SQLite)
```sql
CREATE TABLE rfqs (
    id INTEGER PRIMARY KEY,
    project_code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    specs TEXT,             -- JSON with technical requirements
    created_at TIMESTAMP,
    deadline TIMESTAMP,
    status TEXT             -- draft, sent, responses_received, awarded, cancelled
);

CREATE TABLE rfq_recipients (
    rfq_id INTEGER REFERENCES rfqs(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    sent_at TIMESTAMP,
    responded_at TIMESTAMP,
    quote_amount REAL,
    quote_currency TEXT,
    quote_lead_time_days INTEGER,
    quote_attachment_path TEXT,
    status TEXT             -- pending, sent, responded, awarded, rejected
);
```

## Development Phases

### Phase 1 — Read-only Dashboard (MVP)
**Estimate: 5-7 days**
- FastAPI backend reading PMO folders
- Vue 3 frontend with PrimeVue
- Project list → project detail (emails, documents, timeline)
- Email browser with search
- Document library
- Basic auth (shared token)
- Docker Compose deployment

### Phase 2 — Supplier Management + Gantt
**Estimate: 4-5 days**
- SQLite database for suppliers
- Auto-extract suppliers from email corpus
- Supplier CRUD UI
- Interactive Gantt chart (Frappe Gantt or similar)
- `schedule.json` editor
- Deadline alerts (dashboard notifications)

### Phase 3 — RFQ Automation
**Estimate: 3-4 days**
- RFQ creation and template engine
- Bulk email send via IMAP
- Response tracking
- Quote comparison table
- Reply timeout alerts

### Phase 4 — Intelligence Layer
**Estimate: 3-4 days**
- Supplier research (web search integration)
- AI-assisted RFQ drafting (Claude API)
- Auto-schedule updates from email content
- Telegram alert integration
- SSE for real-time updates

## References

- Existing defect-report-toolkit (FastAPI + Vue 3 pattern): `visionking/toolkit/defect-report-toolkit/`
- Email organizer: `tools/email-organizer/`
- Mermaid dark theme: `.claude/skills/mermaid/SKILL.md`
- Project codes: `config/project-codes.json`
- PMO folder structure: `workspaces/strokmatic/pmo/{code}/`
- Telegram bot infrastructure: `mcp-servers/telegram-bot/`
