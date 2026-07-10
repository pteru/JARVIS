---
type: Design Spec
title: Knowledge Hub — Design Spec
description: Each source has a dedicated parser following a common interface:
timestamp: 2026-04-17
---

# Knowledge Hub — Design Spec

> Evolution of the `context-refresh` service into a centralized knowledge engine for Strokmatic.

**Goal:** Replace the shallow biweekly ClickUp snapshot (context-refresh) with a persistent, searchable knowledge system that indexes all project data sources, maintains a temporal knowledge graph, serves search and graph queries via REST API, and provides an interactive D3.js dashboard for knowledge graph visualization.

**Status:** Design approved 2026-04-17. Replaces `services/context-refresh/`.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  SOURCES (read-only, produced by other services)        │
│                                                         │
│  PMO reports    KB pages     ClickUp tasks              │
│  Emails         Meetings    Drive index                 │
│  Chat facts     File-back analyses                      │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  knowledge-hub (Node.js, port 8091)                     │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Ingestors   │  │  Search      │  │  Graph        │  │
│  │  (parsers    │  │  Engine      │  │  Engine       │  │
│  │  per source) │→ │  (FTS5 +     │  │  (entities,   │  │
│  │              │  │  sqlite-vec) │  │  triples,     │  │
│  │              │  │              │  │  attributes)  │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│                          │                  │           │
│                    ┌─────┴──────────────────┘           │
│                    ▼                                    │
│              knowledge-hub.db (SQLite)                  │
│                                                         │
│  ┌─────────────┐  ┌──────────────────────────────────┐  │
│  │  REST API    │  │  Dashboard (static files)        │  │
│  │  /search     │  │  D3.js force graph               │  │
│  │  /graph      │  │  Dark theme                      │  │
│  │  /ingest     │  │  Filters by product/type         │  │
│  │  /health     │  │                                  │  │
│  └─────────────┘  └──────────────────────────────────┘  │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  CONSUMERS                                              │
│                                                         │
│  jarvis-chat    sprint-agents    kb-generator            │
│  kb-chat        reports          dashboard (browser)     │
└─────────────────────────────────────────────────────────┘
```

**Modules:**
- **Ingestors** — one parser per source type. Each extracts text chunks, entities, and relations.
- **Search Engine** — FTS5 for keyword search, sqlite-vec for semantic similarity. Hybrid ranking.
- **Graph Engine** — entities/triples/attributes in SQLite. Temporal validity. Traversal queries.
- **REST API** — search, graph, ingest, health endpoints.
- **Dashboard** — static SPA served by same server. D3.js force-directed graph with dark theme.

**Storage:** Single `knowledge-hub.db` file containing all tables.

---

## 2. SQLite Schema

```sql
-- Text chunks indexed for search (FTS5 + vectors)
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,    -- 'pmo_report', 'kb_page', 'email', 'meeting', 'clickup', 'chat_fact', 'analysis'
  source_path TEXT NOT NULL,    -- file path or source ID
  project_code TEXT,            -- '03002', '01001', etc. (nullable for cross-project KB pages)
  product TEXT,                 -- 'visionking', 'diemaster', 'spotfusion'
  content TEXT NOT NULL,        -- chunk text (~800 chars)
  metadata TEXT DEFAULT '{}',   -- JSON: {author, date, title, section, ...}
  embedding BLOB,              -- sqlite-vec vector (384 dims, all-MiniLM-L6-v2)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- FTS5 virtual table for keyword search
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content, source_type, project_code,
  content='chunks', content_rowid='rowid'
);

-- Knowledge Graph: entities
CREATE TABLE entities (
  id TEXT PRIMARY KEY,          -- 'person:guilherme', 'project:03002', etc.
  name TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'person', 'project', 'client', 'equipment', 'deploy', 'service', 'product'
  properties TEXT DEFAULT '{}', -- JSON: {role, email, location, ...}
  project_code TEXT,
  product TEXT
);

-- Knowledge Graph: relations (temporal)
CREATE TABLE triples (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL REFERENCES entities(id),
  predicate TEXT NOT NULL,      -- 'works_on', 'deployed_at', 'depends_on', 'owns', 'uses_equipment', 'manages', 'client_of'
  object TEXT NOT NULL REFERENCES entities(id),
  valid_from TEXT,              -- when the relation started
  valid_to TEXT,                -- when it ended (NULL = active)
  confidence REAL DEFAULT 1.0,
  source TEXT,                  -- which ingestor created this
  created_at TEXT NOT NULL
);

-- Knowledge Graph: entity attributes (temporal)
CREATE TABLE attributes (
  entity_id TEXT NOT NULL REFERENCES entities(id),
  key TEXT NOT NULL,
  value TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (entity_id, key, valid_from)
);

-- Ingest state for delta detection
CREATE TABLE ingest_state (
  source_key TEXT PRIMARY KEY,  -- e.g. 'pmo:03002:overview', 'kb:spotfusion/backend'
  content_hash TEXT NOT NULL,
  last_ingested TEXT NOT NULL,
  chunks_count INTEGER DEFAULT 0
);

-- Indexes
CREATE INDEX idx_chunks_project ON chunks(project_code);
CREATE INDEX idx_chunks_source ON chunks(source_type, source_path);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_project ON entities(project_code);
CREATE INDEX idx_triples_subject ON triples(subject);
CREATE INDEX idx_triples_object ON triples(object);
CREATE INDEX idx_triples_predicate ON triples(predicate);
CREATE INDEX idx_triples_valid ON triples(valid_from, valid_to);
```

**Key decisions:**
- **Embedding model:** `all-MiniLM-L6-v2` (384 dims, runs locally via `onnxruntime-node`, ~30MB). Zero API calls for embeddings.
- **Delta detection:** `ingest_state` stores content hash — only re-indexes when source changes.
- **Temporal triples:** `valid_from/valid_to` enables queries like "who worked on 03002 in March?"
- **Controlled predicates:** fixed set (`works_on`, `deployed_at`, `depends_on`, `owns`, `uses_equipment`, `manages`, `client_of`) for predictable graph visualization.

---

## 3. Ingestors

Each source has a dedicated parser following a common interface:

```javascript
// Common ingestor interface
{
  sourceType: string,
  scan(): Promise<SourceFile[]>,
  parse(file): Promise<{
    chunks: Chunk[],
    entities: Entity[],
    triples: Triple[],
  }>
}
```

### 7 ingestors

| Ingestor | Source | Chunks | Entities | Relations |
|---|---|---|---|---|
| `pmo-reports` | overview.md, status.md, sprint.md | Report sections | People, equipment, clients | person→works_on→project |
| `kb-pages` | 128 knowledge-base pages | Sections by heading | Services, deploys, technologies | service→deployed_at→plant |
| `clickup-tasks` | ClickUp state files | Task name + description | Assignees, projects | person→assigned_to→task |
| `emails` | emails/index.json per project | Subject + body preview | Senders, recipients | person→communicated→project |
| `meetings` | meetings/index.json | Title + minutes (when available) | Participants, decisions | person→attended→meeting |
| `drive-index` | drive-index.json per project | File names + metadata | Documents, folders | document→belongs_to→project |
| `chat-facts` | FACTS_DIR/*.jsonl + file-back analyses | Fact or full analysis | Topics, referenced projects | fact→about→project |

**Entity extraction:** Regex + heuristics for v1 (known names from project-codes.json, team members from ClickUp, known clients). No LLM-based NER — keeps cost zero and speed high.

**Chunking:** Split by markdown `## heading`. If section > 800 chars, split by paragraph. Each chunk keeps reference to parent heading for context.

**Re-ingestion:** When `content_hash` changes, ingestor deletes all chunks/entities for that `source_key` and re-inserts. Clean rebuild per source, not accumulation.

---

## 4. REST API

### Search (GET, no auth)

- `GET /search?q=calibração+térmica&project=03007&limit=10` — hybrid search (FTS5 + vector similarity). Returns ranked chunks with score, source, project.
- `GET /search/semantic?q=problemas+com+câmera&limit=10` — vector-only search (for vague queries).
- `GET /search/suggest?q=calib` — autocomplete based on FTS5.

### Graph (GET, no auth)

- `GET /graph/entities?type=person&product=visionking` — list entities with filters.
- `GET /graph/entity/:id` — entity detail + all relations.
- `GET /graph/neighbors/:id?depth=2` — subgraph N hops around an entity.
- `GET /graph/view?product=visionking` — full graph filtered by product (for D3.js).
- `GET /graph/path?from=:id&to=:id` — shortest path between two entities.
- `GET /graph/stats` — counts by type, product, active relations.

### Admin (POST/PUT, requires x-api-key header)

- `POST /ingest` — trigger re-indexation (full or by source_type).
- `POST /ingest/:sourceType` — re-index only one source type.
- `POST /ingest/analysis` — file-back: receive and index an analysis from a consumer.
- `GET /health` — server status, last ingestion, counts.
- `GET /health/sources` — status of each source (last hash, last ingested, stale?).
- `GET /health/lint` — last lint report.

### Dashboard (GET, no auth)

- `GET /` — serves `dashboard/index.html` (SPA with D3.js).
- `GET /dashboard/*` — static files (JS, CSS, assets).

### Response formats

**Search response:**
```json
{
  "results": [
    {
      "score": 0.87,
      "content": "Calibração térmica das câmeras IR realizada em 2026-04-10...",
      "source_type": "pmo_report",
      "source_path": "projects/03007/overview.md",
      "project_code": "03007",
      "product": "visionking",
      "metadata": { "section": "Status Operacional" }
    }
  ],
  "total": 3,
  "query_ms": 45
}
```

**Graph view response:**
```json
{
  "nodes": [
    { "id": "person:guilherme", "name": "Guilherme", "type": "person", "properties": {} },
    { "id": "project:03002", "name": "ArcelorMittal Laminação", "type": "project", "product": "visionking" }
  ],
  "edges": [
    { "source": "person:guilherme", "target": "project:03002", "predicate": "works_on", "valid_from": "2025-01-01" }
  ]
}
```

### Auth

Write endpoints (POST, PUT, DELETE) require `x-api-key` header. Key stored in `~/.secrets/knowledge-hub-api-key`. Read endpoints (GET) are open — network is trusted (LAN 192.168.15.x). Server binds to `0.0.0.0:8091`.

---

## 5. Dashboard — Interactive Knowledge Graph

**Tech:** Static SPA served by the knowledge-hub server. D3.js force-directed simulation. No framework (vanilla JS).

**Features:**
- Force-directed layout — nodes cluster by relation proximity
- Product filter pills (VK / DM / SF / All) in header
- Click node → side panel with details + relations + recent activity
- Hover node → highlight connected edges
- Search bar → filter nodes by name, open side panel
- Zoom + pan (D3.js native zoom behavior)
- Node size proportional to relation count
- Colors by entity type (consistent with Mermaid skill palette):
  - Product: `#0d2b4e` / `#00d2ff`
  - Project: `#1b3a1b` / `#00e676`
  - Person: `#2a2a3d` / `#aa00ff`
  - Client: `#4a2c0f` / `#ff9800`
  - Equipment: `#333333` / `#b0b0b0`
  - Deploy: `#3a1b1b` / `#ff1744`
  - Service: `#1f1f1f` / `#666666`

**Data source:** `GET /graph/view?product=...` returns nodes + edges for D3.js rendering.

---

## 6. File-Back (Query → Wiki)

Mechanism for consumer-generated insights to return to the knowledge-hub as persistent knowledge.

**Flow:**
1. jarvis-chat generates a substantial response (>500 chars, non-trivial synthesis)
2. jarvis-chat calls `POST /ingest/analysis` with title, content, project_code, product, author
3. knowledge-hub saves as `projects/{project_code}/analyses/{date}-{slug}.md` in the PMO git repo (same repo as kb-generator outputs, via shared pmo-git.mjs)
4. Chunks, extracts entities, indexes — enters the graph like any other source
5. Next similar query finds this analysis in search results

**What does NOT trigger file-back:**
- Short/factual responses ("project 03002 is active")
- Greetings, confirmations
- Responses that are direct copies of a source (no synthesis)

**Decision authority:** The consumer (jarvis-chat) decides whether to file back, not the knowledge-hub. The consumer knows if the response was substantive.

---

## 7. Lint (Periodic Health Check)

Weekly consistency verification. Runs as separate cron job (Sundays 08:00).

### Checks

| Check | What it verifies | Example alert |
|---|---|---|
| **Stale reports** | PMO reports not updated >14 days despite ClickUp/email activity | "03007: overview.md not updated in 18 days, but 5 emails received" |
| **KB page drift** | KB pages with old `Last update` vs recent commits in documented repos | "spotfusion/backend.md outdated (2026-04-03) — 12 commits since" |
| **Graph orphans** | Entities with zero relations (isolated nodes) | "entity person:rafael has 0 relations — verify if still active" |
| **Contradictions** | sprint.md says "done" but ClickUp says "in progress" | "03002: sprint.md lists task X as done, ClickUp status = in_progress" |
| **Missing entities** | Names mentioned in reports that don't exist as graph entities | "João mentioned in 03008/status.md but doesn't exist in knowledge graph" |
| **Source freshness** | Ingest sources that stopped updating | "email-index for 03010 hasn't updated in 7 days — check service" |

**Output:**
- `GET /health/lint` returns last lint report as JSON
- Report saved to `data/lint-reports/{date}.json`
- Critical issues (contradictions, stale >30 days): alert via Google Chat to Infra Alerts space

**No LLM.** All checks are deterministic comparisons (hashes, dates, status strings). Fast, zero cost.

---

## 8. File Structure

```
services/knowledge-hub/
├── lib/
│   ├── server.mjs              # HTTP server (native http module)
│   ├── db.mjs                  # SQLite connection + schema init + migrations
│   ├── embedder.mjs            # all-MiniLM-L6-v2 via onnxruntime-node
│   ├── search.mjs              # FTS5 + vector search, hybrid ranking
│   ├── graph.mjs               # Entity/triple CRUD + traversal queries
│   ├── auth.mjs                # API key middleware
│   ├── lint.mjs                # Health checks (stale, orphans, contradictions)
│   └── ingestors/
│       ├── base.mjs            # Common interface (scan, parse, ingest)
│       ├── pmo-reports.mjs     # overview/status/sprint.md parser
│       ├── kb-pages.mjs        # Knowledge-base 128 pages parser
│       ├── clickup-tasks.mjs   # ClickUp state files parser
│       ├── emails.mjs          # emails/index.json parser
│       ├── meetings.mjs        # meetings/index.json parser
│       ├── drive-index.mjs     # drive-index.json parser
│       └── chat-facts.mjs      # JSONL facts + file-back analyses
├── dashboard/
│   ├── index.html              # SPA entry point
│   ├── graph.js                # D3.js force simulation
│   ├── panel.js                # Side panel (entity details)
│   ├── search.js               # Search bar + results
│   └── style.css               # Dark theme (Mermaid skill palette)
├── config/
│   └── service.json            # Paths, port, enabled sources
├── test/
│   ├── search.test.mjs         # FTS5 + vector search tests
│   ├── graph.test.mjs          # Entity/triple CRUD tests
│   ├── lint.test.mjs           # Lint checks tests
│   └── ingestors/
│       └── pmo-reports.test.mjs
├── data/
│   ├── knowledge-hub.db        # SQLite (chunks + graph + state)
│   └── lint-reports/
├── index.mjs                   # Main: start server
├── ingest.mjs                  # CLI: run ingestion (called by cron)
├── lint.mjs                    # CLI: run lint (called by cron)
├── run.sh                      # Cron wrapper (server process)
├── deploy.sh                   # Deploy to server
└── package.json
```

---

## 9. Deploy

- **Server:** 192.168.15.2 (user: strokmatic)
- **Path:** `/opt/jarvis-knowledge-hub/`
- **Server process:** `node index.mjs` (persistent, managed by systemd)
- **Ingestion:** `node ingest.mjs` via cron (hourly)
- **Lint:** `node lint.mjs` via cron (Sundays 08:00)
- **Port:** 8091
- **Health-monitor:** checks `/health` endpoint
- **API key:** `~/.secrets/knowledge-hub-api-key` (for write endpoints)

**npm dependencies:**
- `better-sqlite3` — SQLite binding
- `sqlite-vec` — vector search extension
- `onnxruntime-node` — embedding model runtime
- No other dependencies (native HTTP server, no Express)

---

## 10. Consumer Integration

### jarvis-chat (biggest benefit)
- Before responding, calls `GET /search?q={user_question}&project={space_project}`
- Uses returned chunks as context (instead of reading ~24KB raw PMO)
- If response >500 chars and substantive, calls `POST /ingest/analysis` (file-back)
- Reduces context from ~24KB to ~3-5KB relevant → better, cheaper responses

### sprint-agents (planning mode)
- `GET /search?q=sprint+bloqueios&project={code}&source_type=meeting,email` for relevant context from minutes and emails
- `GET /graph/neighbors/{project_id}?depth=1` to understand who's on the project and which deploys exist

### kb-generator (no immediate change)
- Continues generating standalone reports (overview/status/sprint)
- knowledge-hub indexes the outputs — doesn't interfere with flow
- Future: kb-generator can use `/search` to enrich context before generating

### kb-chat (future)
- Same pattern as jarvis-chat but focused on knowledge-base (128 technical pages)
- `GET /search?q={question}&source_type=kb_page`

### reports (weekly/daily)
- `GET /graph/stats` for knowledge metrics in reports
- `GET /health/lint` for consistency alerts

### dashboard (browser)
- `GET /graph/view?product=visionking` for graph rendering
- `GET /graph/entity/:id` for side panel
- `GET /search?q=...` for search bar

---

## 11. Migration from context-refresh

The current context-refresh service is retired after knowledge-hub is operational.

**Features that migrate:**
- ClickUp data collection → becomes the `clickup-tasks` ingestor
- Telegram notification → replaced by lint alerts via Google Chat (Infra Alerts space)

**Features that don't migrate:**
- Drive upload of context-summary.md → replaced by the dashboard
- Biweekly gating → replaced by hourly cron ingestion

**Timeline:** context-refresh cron disabled after knowledge-hub passes E2E validation on server.

---

## 12. Scope Boundaries

**In scope (v1):**
- REST API server with search + graph endpoints
- 7 ingestors (PMO, KB, ClickUp, emails, meetings, drive, chat/file-back)
- SQLite with FTS5 + sqlite-vec
- Knowledge graph (entities, triples, attributes with temporal validity)
- Interactive D3.js dashboard with dark theme
- Lint (6 deterministic checks)
- File-back endpoint for consumer analyses
- API key auth for write endpoints
- Deploy to server with systemd + cron
- Health-monitor integration

**Out of scope (future phases):**
- LLM-based NER for entity extraction (v1 uses regex + heuristics)
- MCP thin wrapper (can be added later as HTTP→MCP proxy)
- Ops view in dashboard (v1 is PMO/CTO view only)
- Code indexing (monorepo source code)
- Schema evolution (adaptive prompts per project)
- Entity pages (auto-generated markdown per entity)
