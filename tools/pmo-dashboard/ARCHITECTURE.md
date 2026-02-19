# PMO Dashboard — Architecture & Shared Interfaces

## Directory Layout
```
tools/pmo-dashboard/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app, mounts routers, serves frontend
│   │   ├── config.py            # Settings from env vars
│   │   ├── database.py          # SQLAlchemy engine + session
│   │   ├── models.py            # All SQLAlchemy ORM models
│   │   ├── schemas.py           # All Pydantic request/response schemas
│   │   ├── auth.py              # Token-based auth middleware
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── projects.py      # /api/projects
│   │   │   ├── emails.py        # /api/projects/{code}/emails
│   │   │   ├── documents.py     # /api/projects/{code}/documents
│   │   │   ├── suppliers.py     # /api/suppliers
│   │   │   ├── schedule.py      # /api/projects/{code}/schedule
│   │   │   ├── search.py        # /api/search
│   │   │   └── alerts.py        # /api/alerts
│   │   └── services/
│   │       ├── __init__.py
│   │       ├── sync.py          # PMO folder → DB sync
│   │       ├── search.py        # FTS5 full-text search
│   │       └── sheet_mirror.py  # Google Sheet bidirectional sync
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.vue
│   │   ├── main.js
│   │   ├── router.js
│   │   ├── api.js               # Axios API client
│   │   ├── views/
│   │   │   ├── DashboardView.vue
│   │   │   ├── ProjectDetailView.vue
│   │   │   ├── EmailBrowserView.vue
│   │   │   ├── SupplierListView.vue
│   │   │   ├── SupplierDetailView.vue
│   │   │   └── ScheduleView.vue
│   │   ├── components/
│   │   │   ├── ProjectCard.vue
│   │   │   ├── EmailTable.vue
│   │   │   ├── DocumentList.vue
│   │   │   ├── SupplierForm.vue
│   │   │   ├── QuoteTable.vue
│   │   │   ├── GanttChart.vue
│   │   │   ├── SearchBar.vue
│   │   │   └── AlertBell.vue
│   │   └── assets/
│   │       └── theme.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── Dockerfile
├── docker-compose.yml
└── ARCHITECTURE.md
```

## Tech Stack
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0, Pydantic v2
- **Frontend:** Vue 3 (Composition API), PrimeVue 4, Vite 5
- **Database:** SQLite via SQLAlchemy (auto-created on startup)
- **Auth:** Bearer token from env var `AUTH_TOKEN` (LAN only)
- **Port:** 8090

## Data Sources

### Filesystem (read-only, mounted at /data/pmo)
- `config/project-codes.json` — project registry
- `pmo/{code}/emails/index.json` — email master index
- `pmo/{code}/emails/parsed/*.json` — individual parsed emails
- `pmo/{code}/emails/attachments/` — email attachments
- `pmo/{code}/technical_report.md` — project summary
- `pmo/{code}/timeline.json` — event timeline
- `pmo/{code}/reference/` — reference documents
- `pmo/{code}/meetings/` — meeting notes
- `pmo/{code}/reports/` — generated reports

### SQLite (read-write, at /data/db/pmo.db)
- suppliers, supplier_contacts, supplier_projects
- supplier_catalogs, supplier_quotes
- schedule_tasks, schedule_milestones
- alerts

## Database Schema (SQLAlchemy models in models.py)

```sql
-- Centralized supplier repository
CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL UNIQUE,
    domain TEXT,                -- email domain for auto-matching
    category TEXT,              -- integrator, component_vendor, subcontractor, service_provider
    country TEXT,
    website TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE supplier_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT,                  -- sales, engineering, management, logistics
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE supplier_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    project_code TEXT NOT NULL,
    role TEXT,                  -- what they do on this project
    status TEXT DEFAULT 'active',  -- quoting, awarded, rejected, active, completed
    UNIQUE(supplier_id, project_code)
);

-- Catalogs and technical docs per supplier
CREATE TABLE supplier_catalogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    file_path TEXT,            -- relative to /data/pmo or absolute
    file_url TEXT,             -- external URL if applicable
    doc_type TEXT,             -- catalog, datasheet, manual, certificate, drawing
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quote/price history
CREATE TABLE supplier_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    project_code TEXT,
    reference TEXT,            -- quote number / RFQ reference
    description TEXT NOT NULL,
    amount REAL,
    currency TEXT DEFAULT 'USD',
    lead_time_days INTEGER,
    valid_until DATE,
    status TEXT DEFAULT 'received', -- draft, sent, received, accepted, rejected, expired
    attachment_path TEXT,
    notes TEXT,
    received_at DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Schedule
CREATE TABLE schedule_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_code TEXT NOT NULL,
    task_id TEXT NOT NULL,      -- short id like 'acq1'
    name TEXT NOT NULL,
    category TEXT,              -- design, procurement, manufacturing, installation, commissioning
    start_date DATE,
    end_date DATE,
    status TEXT DEFAULT 'pending', -- pending, in_progress, completed, delayed, cancelled
    depends_on TEXT,            -- JSON array of task_ids
    assignee TEXT,
    supplier TEXT,
    notes TEXT,
    is_critical BOOLEAN DEFAULT FALSE,
    UNIQUE(project_code, task_id)
);

CREATE TABLE schedule_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_code TEXT NOT NULL,
    milestone_id TEXT NOT NULL,
    name TEXT NOT NULL,
    target_date DATE,
    status TEXT DEFAULT 'on_track', -- on_track, at_risk, delayed, completed
    UNIQUE(project_code, milestone_id)
);

-- Alerts
CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_code TEXT,
    alert_type TEXT NOT NULL,   -- deadline, reply_timeout, schedule_deviation, general
    severity TEXT DEFAULT 'warning', -- info, warning, critical
    title TEXT NOT NULL,
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    dismissed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### Projects (reads from filesystem)
```
GET  /api/projects                        → List[ProjectSummary]
GET  /api/projects/{code}                 → ProjectDetail
GET  /api/projects/{code}/emails          → PaginatedEmailList  (query: page, per_page, category, search)
GET  /api/projects/{code}/emails/{hash}   → EmailDetail
GET  /api/projects/{code}/documents       → List[Document]
GET  /api/projects/{code}/timeline        → List[TimelineEvent]
```

### Suppliers (CRUD on SQLite)
```
GET    /api/suppliers                     → List[SupplierSummary]  (query: search, category, project_code)
POST   /api/suppliers                     → Supplier  (body: SupplierCreate)
GET    /api/suppliers/{id}                → SupplierDetail (with contacts, projects, quotes, catalogs)
PUT    /api/suppliers/{id}                → Supplier  (body: SupplierUpdate)
DELETE /api/suppliers/{id}                → 204

POST   /api/suppliers/{id}/contacts       → Contact
PUT    /api/suppliers/{id}/contacts/{cid} → Contact
DELETE /api/suppliers/{id}/contacts/{cid} → 204

POST   /api/suppliers/{id}/catalogs       → Catalog
DELETE /api/suppliers/{id}/catalogs/{cid} → 204

GET    /api/suppliers/{id}/quotes         → List[Quote]
POST   /api/suppliers/{id}/quotes         → Quote
PUT    /api/suppliers/{id}/quotes/{qid}   → Quote
DELETE /api/suppliers/{id}/quotes/{qid}   → 204

POST   /api/suppliers/{id}/projects       → SupplierProject
```

### Schedule (SQLite, pre-populated from schedule.json)
```
GET  /api/projects/{code}/schedule        → ScheduleData (tasks + milestones)
PUT  /api/projects/{code}/schedule/tasks/{task_id} → ScheduleTask
POST /api/projects/{code}/schedule/tasks  → ScheduleTask
```

### Search
```
GET  /api/search?q=...&project=...&type=... → SearchResults
```

### Alerts
```
GET  /api/alerts                          → List[Alert]  (query: project_code, severity, unread_only)
PUT  /api/alerts/{id}/dismiss             → Alert
POST /api/alerts                          → Alert
```

### Sheet Mirror
```
POST /api/suppliers/sync-to-sheet         → {status, sheet_url, rows_synced}
POST /api/suppliers/sync-from-sheet       → {status, rows_imported, rows_updated}
```

## Pydantic Schemas (schemas.py)

Key response shapes:

```python
class ProjectSummary(BaseModel):
    code: str
    name: str
    language: str
    email_count: int
    unread_count: int           # emails without category
    latest_email_date: str | None
    document_count: int
    phase: str | None           # from project-codes.json if present
    product_line: str           # derived from code prefix: 01=SpotFusion, 02=SpotFusion, 03=VisionKing

class SupplierSummary(BaseModel):
    id: int
    company: str
    category: str | None
    country: str | None
    contact_count: int
    project_codes: list[str]
    quote_count: int
    catalog_count: int

class SupplierDetail(SupplierSummary):
    domain: str | None
    website: str | None
    notes: str | None
    contacts: list[Contact]
    projects: list[SupplierProjectInfo]
    quotes: list[Quote]
    catalogs: list[Catalog]

class Quote(BaseModel):
    id: int
    supplier_id: int
    project_code: str | None
    reference: str | None
    description: str
    amount: float | None
    currency: str
    lead_time_days: int | None
    valid_until: str | None
    status: str
    attachment_path: str | None
    notes: str | None
    received_at: str | None
```

## Frontend Routes
```
/                           → DashboardView (project cards grid)
/projects/:code             → ProjectDetailView (tabs: emails, documents, schedule, timeline)
/projects/:code/emails      → EmailBrowserView (filterable email table)
/suppliers                  → SupplierListView (searchable/filterable table)
/suppliers/:id              → SupplierDetailView (contacts, quotes, catalogs, project links)
/projects/:code/schedule    → ScheduleView (Gantt chart)
```

## Theme (Dark)
```css
:root {
  --color-bg-primary: #1a1a2e;
  --color-bg-secondary: #16213e;
  --color-bg-card: #1e2a3a;
  --color-text-primary: #e0e0e0;
  --color-text-secondary: #a0a0a0;
  --color-accent: #0f9b8e;
  --color-accent-hover: #12b8a8;
  --color-border: #2a3a4a;
  --color-danger: #e74c3c;
  --color-warning: #f39c12;
  --color-success: #27ae60;
}
```

## Config (config.py)
```python
class Settings:
    PMO_ROOT: str = "/data/pmo"              # mounted PMO folders
    CONFIG_ROOT: str = "/data/config"         # mounted config dir
    DB_PATH: str = "/data/db/pmo.db"          # SQLite database
    AUTH_TOKEN: str = ""                       # shared auth token
    GOOGLE_SHEET_ID: str = ""                 # supplier mirror sheet ID
    GOOGLE_CREDENTIALS_PATH: str = ""         # service account JSON
    HOST: str = "0.0.0.0"
    PORT: int = 8090
```

## Running Locally (dev mode)
```bash
# Backend
cd tools/pmo-dashboard/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PMO_ROOT=/home/teruel/JARVIS/workspaces/strokmatic/pmo \
CONFIG_ROOT=/home/teruel/JARVIS/config \
DB_PATH=./pmo.db \
uvicorn app.main:app --reload --port 8090

# Frontend
cd tools/pmo-dashboard/frontend
npm install && npm run dev
```
