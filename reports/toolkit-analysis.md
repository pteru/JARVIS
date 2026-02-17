# Toolkit & SDK Cross-Product Analysis

**Date:** 2026-02-16 (revised)

---

## 1. Inventory

### SpotFusion Toolkit

#### spotfusion-toolkit (12 tools inside)

| Tool | Type | Stack | Purpose |
|------|------|-------|---------|
| **file-explorer** | Streamlit | pandas | Browse/preview/download files from shared data dir |
| **image-analyzer** | Streamlit | psycopg2, OpenCV, Plotly | Extract weld spot images from PostgreSQL, light level histograms |
| **plc-recorder** | Streamlit | paramiko | Record PLC logs from remote Docker containers via SSH |
| **plc-record-plotter** | Streamlit | Plotly, pandas | Interactive visualization of PLC CSV records |
| **plc-reader-class3** | Streamlit | pylogix | Real-time PLC tag reader via EtherNet/IP protocol |
| **plc-record-cleaner** | Streamlit | pandas, numpy | Deduplicate PLC records by detecting value changes |
| **plc-log-parser** | Streamlit | pandas | Parse structured container logs with regex patterns |
| **redis-recorder** | Streamlit | redis | Monitor Redis hash fields, log to CSV over time |
| **redis-saver** | Scripts | redis, csv | Export/restore full Redis DB to/from CSV |
| **view-r-extractor** | API client | requests, pydantic | Extract timer/RAFT data from ViewR API (60+ endpoints) |
| **raft_studies** | Analysis | pandas, numpy | RAFT resistance data exploration, hex→decimal conversion |
| **main_app** | Flask | flask | Dashboard/routing stub (minimal) |

#### Other SpotFusion toolkit repos

| Tool | Status | Stack | Purpose |
|------|--------|-------|---------|
| **spotfusion-deploy-toolkit** | Complete | Python/FastAPI + Vue 3 | Deployment config wizard + viewer (Nissan plant) |
| **spotfusion-smartcam-toolkit** | Complete | Python/matplotlib | FOV graph generator for camera docs |
| **server-installer** | Complete | Bash/Debian pkg | Server infrastructure installer |
| **vision-installer** | Complete | Bash/Debian pkg | Vision module installer |
| **data-scraping** | Complete | Python/Selenium | Welding schedule web form automation |
| **plant-data-parser** | Complete (ad-hoc) | Python/pandas | ML dataset generator from plant data |

#### dataset-toolkit (ds/ — ML inference pipeline)

| Module | Purpose |
|--------|---------|
| **main.py** (1,045 lines) | Full pipeline: parse sensor data → run inference → compute metrics → plot results |
| **utils/default_module.py** | RDIN-only (resistance signal) ensemble inference (5 TF networks) |
| **utils/module_a.py** | Multi-modal inference (resistance + image), base64 image handling |
| **utils/neural_network.py** | Model loading (.h5 Keras), signal preprocessing (MinMaxScaler) |
| **data/** (8 test campaigns) | GVT + Detroit plant test datasets with ground truth |
| **models/** | Trained TensorFlow ensemble models (RDIN-only and IMRDIN) |

### DieMaster Toolkit

| Tool | Status | Stack | Purpose |
|------|--------|-------|---------|
| **parse_mock_data** | Prototype | Python/Redis | Seed Redis/PostgreSQL with die layout data |
| **infra-setup** | Production | Docker Compose/PostgreSQL/KeyDB/RabbitMQ | Infrastructure-as-Code for DieMaster |
| **pamstamp-io** (ds/) | Functional | Python | PAM-STAMP simulation file generator |

### VisionKing Toolkit (13 dirs)

| Tool | Status | Stack | Purpose |
|------|--------|-------|---------|
| **deployment-runner** | Production | Python/Click | Generate docker-compose + .env from topology |
| **topology-configurator** | Production | Python/Click/InquirerPy | Interactive wizard for topology YAML creation |
| **defect-report-toolkit** | Production | Python/FastAPI + Vue 3 | Defect labeling & heatmap generation |
| **data-manager** | Complete (one-off) | Python | Data consolidation scripts (local + GCP) |
| **image-toolkit** | Partial | Python/OpenCV/GCS | Image dataset utilities (upload, filter, classify) |
| **toolkit/message-poster** | Complete | Python/pika | Replay DB frames to RabbitMQ |
| **logs** | Partial | Python | Log extraction & pickle inspection |
| **logs-parsing-analysis** | Complete (one-off) | Python/pandas | Log profiling scripts |
| **profiling** | Complete (one-off) | Python/seaborn | Camera capture performance analysis |
| **slicing-comparison** | Complete | Python/numpy/SAHI | Image slicing algorithm benchmark |
| **label-studio** | Abandoned | Python | Empty — placeholder only |
| **model-comparison** | Abandoned | — | Empty scaffold |
| **scripts/map-production-topology.sh** | Complete | Bash + Python | SSH into production nodes, collect system info |

### SDK (13 repos)

| Tool | Status | Stack | Purpose |
|------|--------|-------|---------|
| **sdk-agent-standards** | Complete | Markdown | AI agent coding standards reference |
| **sdk-lib-rabbit-client** | Production | Python/aio-pika | Async RabbitMQ client library (published to Artifact Registry) |
| **sdk-observability-stack** | Production | Docker Compose/Prometheus/Grafana | Full monitoring stack |
| **sdk-label-studio-toolkit** | Production | Python/Poetry | Programmatic Label Studio SDK |
| **sdk-bos6000-toolkit** | Complete | Python/Flask | Bosch BOS6000 welding controller config converter |
| **sdk-defect-visualizer** | Complete | Python/FastAPI | Defect visualization on frame images |
| **sdk-image-extractor** | Complete | Python/FastAPI | Database-driven image export tool |
| **sdk-redis-trendline-monitor** | Complete | Python/Streamlit | Real-time Redis value monitoring & plotting |
| **sdk-message-poster** | Complete | Python/pika | RabbitMQ message generator for testing |
| **sdk-repository-reader** | Complete | Python | Consolidate repo contents for AI analysis |
| **sdk-video-cronoanalysis** | Complete | Python/matplotlib | ELAN video annotation time-series analysis |
| **project-organizer** | Production | Python/Claude API | Email → structured knowledge base processor |
| **3d-model-convert-to-gltf** | Abandoned | Python/Node.js | 3D model format converter (3rd party, last updated 2021) |

---

## 2. Cross-Product Overlap Analysis

### A. Deployment & Infrastructure

| Capability | SpotFusion | DieMaster | VisionKing | SDK |
|-----------|-----------|-----------|-----------|-----|
| Deploy config wizard | **spotfusion-deploy-toolkit** (Vue+FastAPI, full wizard) | — | **topology-configurator** + **deployment-runner** (CLI-based) | — |
| Infrastructure setup | **server-installer** + **vision-installer** (Debian pkgs) | **infra-setup** (Docker Compose + SQL) | — | **sdk-observability-stack** (Prometheus/Grafana) |
| Production mapping | — | — | **scripts/map-production-topology.sh** | — |

**Overlap:** SpotFusion's deploy-toolkit and VisionKing's topology-configurator+deployment-runner solve the same problem (deployment configuration) with different approaches. SpotFusion uses a web wizard; VisionKing uses CLI tools. Both generate docker-compose.yml + .env from configuration.

### B. PLC & Industrial Data

| Capability | SpotFusion | DieMaster | VisionKing | SDK |
|-----------|-----------|-----------|-----------|-----|
| PLC log collection | **plc-recorder** (SSH + paramiko) | — | — | — |
| PLC real-time reading | **plc-reader-class3** (EtherNet/IP, pylogix) | — | — | — |
| PLC log parsing | **plc-log-parser** (regex) | — | — | — |
| PLC record dedup | **plc-record-cleaner** | — | — | — |
| PLC visualization | **plc-record-plotter** (Plotly) | — | — | — |
| PLC monitoring service | — | services/plc-monitor | services/plc-monitor, plc-monitor-eip | — |

**Overlap:** SpotFusion has 5 PLC tools as Streamlit apps. DieMaster and VisionKing both have PLC monitor *services* but no equivalent toolkit for recording/parsing/plotting PLC data. These tools are generic enough for any product with PLC integration.

### C. Redis Monitoring

| Capability | SpotFusion | DieMaster | VisionKing | SDK |
|-----------|-----------|-----------|-----------|-----|
| Real-time monitoring | **redis-recorder** (Streamlit, threaded CSV) | — | — | **sdk-redis-trendline-monitor** (Streamlit, rolling plots) |
| DB export/restore | **redis-saver** (full key scan → CSV) | — | — | — |

**Overlap:** `sdk-redis-trendline-monitor` and SF's `redis-recorder` both monitor Redis in real-time with CSV export. SDK version has better UI (rolling plots, interactive exploration). SF version adds threaded background recording and full DB backup/restore.

### D. Data Monitoring & Visualization

| Capability | SpotFusion | DieMaster | VisionKing | SDK |
|-----------|-----------|-----------|-----------|-----|
| Defect visualization | — | — | **defect-report-toolkit** (labeling + heatmap) | **sdk-defect-visualizer** (DB viewer + overlay) |
| Log analysis | — | — | **logs** + **logs-parsing-analysis** + **profiling** | — |
| File browsing | **file-explorer** (Streamlit) | — | — | — |

**Overlap:** `sdk-defect-visualizer` and VisionKing's `defect-report-toolkit` both visualize defects on images. SDK version reads from PostgreSQL and draws overlays. VK version has interactive labeling + heatmap generation + batch reports.

### E. Message & Data Replay

| Capability | SpotFusion | DieMaster | VisionKing | SDK |
|-----------|-----------|-----------|-----------|-----|
| RabbitMQ testing | — | — | **toolkit/message-poster** (DB replay) | **sdk-message-poster** (template-based) |
| RabbitMQ client lib | — | — | — | **sdk-lib-rabbit-client** (aio-pika) |

**Overlap:** Both replay messages to RabbitMQ from different sources (JSON templates vs DB reconstruction). Should be one tool with two modes.

### F. Image & Data Processing

| Capability | SpotFusion | DieMaster | VisionKing | SDK |
|-----------|-----------|-----------|-----------|-----|
| Image dataset management | — | — | **image-toolkit** (GCP, OpenCV, parquet) | **sdk-image-extractor** (DB query → images) |
| Image analysis | **image-analyzer** (PostgreSQL, light histograms) | — | — | — |
| Label Studio integration | — | — | label-studio (abandoned) | **sdk-label-studio-toolkit** (production) |
| Data seeding | — | **parse_mock_data** | — | — |
| Simulation I/O | — | **pamstamp-io** | — | — |
| ML dataset generation | **plant-data-parser** | — | — | — |
| ML inference pipeline | **dataset-toolkit** (TF ensemble, RDIN+image) | — | — | — |
| Data consolidation | — | — | **data-manager** | — |

**Overlap:** VK `image-toolkit`, SDK `sdk-image-extractor`, and SF `image-analyzer` all handle images from databases. Different features but same domain.

### G. Welding Equipment

| Capability | SpotFusion | DieMaster | VisionKing | SDK |
|-----------|-----------|-----------|-----------|-----|
| Welding controller config | — | — | — | **sdk-bos6000-toolkit** (Bosch BOS6000) |
| Welding form automation | **data-scraping** (Selenium) | — | — | — |
| ViewR timer extraction | **view-r-extractor** (60+ API endpoints) | — | — | — |
| RAFT data analysis | **raft_studies** (hex→decimal, plots) | — | — | — |
| Camera FOV docs | **spotfusion-smartcam-toolkit** | — | — | — |
| Video time-study | — | — | — | **sdk-video-cronoanalysis** |

**Potential consolidation:** `sdk-bos6000-toolkit`, `view-r-extractor`, and `raft_studies` all deal with Bosch welding equipment data. Could become a unified **sdk-welding-toolkit**.

---

## 3. Consolidation Strategy

Each consolidated SDK repo becomes a shared tool that products reference as a git submodule inside their `toolkit/` directory.

### 1. sdk-deployment-toolkit
**Priority:** High
**Merges:** VK `topology-configurator` + VK `deployment-runner` + SF `spotfusion-deploy-toolkit`

**Architecture:**
- Core library: topology model, compose generation, env generation, validation, diff, deploy/stop/status
- Product-specific service catalogs as YAML config (not code)
- VK keeps its CLI as a thin wrapper calling the core
- SF keeps its Vue web wizard calling the core via FastAPI
- DM's `infra-setup` could adopt the same topology model later
- Shared infrastructure service definitions (postgres, redis/keydb, rabbitmq)

**Product-specific concerns:**
- VK uses `network_mode: host` vs bridge networking — core must support both
- SF deploy-toolkit has Nissan plant-specific config — stays as product config
- DM uses KeyDB instead of Redis — service catalog must be flexible

### 2. sdk-defect-toolkit
**Priority:** High
**Merges:** `sdk-defect-visualizer` + VK `defect-report-toolkit`

**Architecture:**
- `viewer` module: DB query + overlay drawing (from sdk-defect-visualizer)
- `reporter` module: interactive labeling + heatmap generation + batch reports (from VK)
- Shared PostgreSQL data layer with configurable schema
- Shared image processing utils (merge `utils.py` overlay + `heatmap.py`)
- Single Docker Compose with both services
- Add tests (neither has any currently)

**Product-specific concerns:**
- VK has reference standards integration — keep as optional module
- DB schema differs per product — data layer must be configurable

### 3. sdk-plc-toolkit
**Priority:** High (biggest untapped consolidation)
**Merges:** SF `plc-recorder` + `plc-reader-class3` + `plc-log-parser` + `plc-record-cleaner` + `plc-record-plotter`

**Architecture:**
- Multi-page Streamlit app or Click CLI with optional Streamlit UI
- `recorder`: PLC log collection via SSH/paramiko
- `reader`: Real-time EtherNet/IP tag reading via pylogix
- `parser`: Structured log parsing with configurable regex patterns
- `cleaner`: Smart deduplication by value-change detection
- `plotter`: Interactive Plotly visualization of time-series CSV data
- Product-specific IO table JSONs and tag mappings stay in each monorepo as config files

**Product-specific concerns:**
- SF uses specific PLC tag naming conventions — configurable
- DM and VK have PLC monitor services but no toolkit — this SDK tool would complement those services for debugging/analysis
- `plc-reader-class3` uses pylogix (Allen-Bradley specific) — may need adapters for other PLC brands

### 4. sdk-redis-toolkit
**Priority:** Medium
**Merges:** `sdk-redis-trendline-monitor` + SF `redis-recorder` + SF `redis-saver`

**Architecture:**
- `monitor`: Streamlit real-time plots + CSV export (SDK version as base)
- `recorder`: Background threaded CSV logging (from SF redis-recorder)
- `backup`: Full Redis export/restore scan → CSV (from SF redis-saver)
- Configurable key patterns for batch monitoring
- Threshold-based alerting
- Optional Prometheus export (integrate with sdk-observability-stack)

**Product-specific concerns:**
- SF uses `SparkEyes@@2022` hardcoded password — must be env-based
- DM uses KeyDB (Redis-compatible) — should work transparently
- Different products monitor different hash structures — configurable key/field patterns

### 5. sdk-image-toolkit
**Priority:** Medium
**Merges:** `sdk-image-extractor` + VK `image-toolkit` + SF `image-analyzer`

**Architecture:**
- `extract`: DB query → image export (from SDK)
- `upload`: GCP bucket upload with resume tracking (from VK)
- `filter`: Interactive image review/selection (from VK)
- `catalog`: Parquet-based metadata management (from VK)
- `analyze`: Light level histograms, image grids by hour (from SF image-analyzer)
- Click CLI + optional Streamlit UI
- Product-agnostic DB interface (configurable schema)

**Product-specific concerns:**
- SF image-analyzer connects to SparkEyes DB schema (`spot_in_biw` table with BYTEA images)
- VK image-toolkit uses GCP-specific upload — keep as optional dependency
- DB schemas differ — need adapter pattern or configurable queries

### 6. sdk-message-poster
**Priority:** Medium
**Merges:** `sdk-message-poster` + VK `toolkit/message-poster`

**Architecture:**
- `template` mode: JSON template generation + FPS/CPU/GPU monitoring (current SDK)
- `replay` mode: DB frame reconstruction + rotating queues + FPS throttling (current VK)
- Use `sdk-lib-rabbit-client` (async aio-pika) instead of raw pika
- Click CLI with `--mode template|replay`
- Environment-based configuration
- Docker Compose for self-contained testing

**Product-specific concerns:**
- VK replay mode queries VK-specific DB schema — configurable query
- SDK template mode uses product-specific JSON message formats — template files stay in product repos

### 7. sdk-welding-toolkit
**Priority:** Low (SpotFusion-specific for now, but consolidates 3 related tools)
**Merges:** `sdk-bos6000-toolkit` + SF `view-r-extractor` + SF `raft_studies`

**Architecture:**
- `bos6000`: Bosch BOS6000 config converter (existing SDK tool)
- `viewr`: ViewR API client with 60+ endpoints for timer/quality/fault data extraction
- `raft`: Resistance data analysis — hex→decimal, signal processing, plots
- Shared data models for welding timer configurations
- Click CLI: `welding bos6000|viewr|raft`

**Product-specific concerns:**
- Currently only SpotFusion uses Bosch welding equipment
- If DM or VK ever integrate welding controllers, this is ready
- `view-r-extractor` has hardcoded IPs — must be env-based

### Items that stay product-specific

| Product | Tool | Reason |
|---------|------|--------|
| SpotFusion | spotfusion-deploy-toolkit | Web UI wrapper — calls sdk-deployment-toolkit core |
| SpotFusion | spotfusion-smartcam-toolkit | Camera FOV documentation, no overlap |
| SpotFusion | server-installer / vision-installer | Debian packages, product-specific |
| SpotFusion | data-scraping | Selenium welding form automation |
| SpotFusion | dataset-toolkit (ds/) | ML inference pipeline with trained models, TF-specific |
| SpotFusion | file-explorer | Generic but trivial — could stay or move to sdk-image-toolkit |
| DieMaster | infra-setup | Product-specific Docker Compose + SQL schema |
| DieMaster | pamstamp-io | PAM-STAMP simulation, product-specific |
| VisionKing | scripts/map-production-topology.sh | Site-specific SSH mapping |
| VisionKing | slicing-comparison | SAHI algorithm benchmark, one-off research |
| SDK | sdk-agent-standards | Markdown reference, no code to merge |
| SDK | sdk-lib-rabbit-client | Already shared, no change |
| SDK | sdk-observability-stack | Already shared, no change |
| SDK | sdk-label-studio-toolkit | Already shared, no change |
| SDK | sdk-repository-reader | Already shared, no change |
| SDK | sdk-video-cronoanalysis | ELAN-specific, no overlap |
| SDK | project-organizer | Email processing, no overlap |

### Cleanup

| Item | Action | Reason |
|------|--------|--------|
| VK `label-studio` | **Delete** | Empty, replaced by sdk-label-studio-toolkit |
| VK `model-comparison` | **Delete** | Empty scaffold |
| VK `logs` + `logs-parsing-analysis` + `profiling` | **Merge** → `vk/toolkit/analysis` | Three dirs doing log/perf analysis |
| SF `plant-data-parser` | **Archive** → `sf/legacy/` | One-off script with hardcoded paths |
| SF `spotfusion-toolkit/main_app` | **Delete** | Minimal Flask stub, unused |
| DM `parse_mock_data` | **Refactor** | Add env config, complete SQL loader, remove hardcoded creds |
| `3d-model-convert-to-gltf` | **Archive** | 3rd party, abandoned since 2021 |

---

## 4. Security Issues

| Tool | Issue | Severity |
|------|-------|----------|
| DM `parse_mock_data` | Hardcoded Redis password `SmartDie@@2022` | Critical |
| DM `infra-setup` | Hardcoded DB/KeyDB/RabbitMQ passwords in Docker Compose | High |
| SF `spotfusion-toolkit/plc-recorder` | Hardcoded IPs and SSH passwords | High |
| SF `spotfusion-toolkit/image-analyzer` | Hardcoded DB credentials | High |
| SF `spotfusion-toolkit/redis-recorder` | Hardcoded Redis password `SparkEyes@@2022` | High |
| SF `spotfusion-toolkit/redis-saver` | Hardcoded target IP `120.13.183.223:3015` | High |
| SF `view-r-extractor` | Hardcoded device IPs | Medium |
| VK `toolkit/message-poster` | Hardcoded DB/RabbitMQ config | Medium |

All hardcoded credentials must be extracted to `.env` files with `.env.example` templates during SDK migration.

---

## 5. Quality Scorecard

| Tool | Tests | Docs | CI/CD | Credentials | Overall |
|------|-------|------|-------|-------------|---------|
| sdk-lib-rabbit-client | ✅ | ✅ | ✅ | ✅ | A |
| sdk-label-studio-toolkit | ✅ | ✅ | — | ✅ | A |
| sdk-observability-stack | — | ✅ | — | ✅ | A- |
| sf/spotfusion-deploy-toolkit | ✅ | ✅ | — | ✅ | A- |
| project-organizer | ✅ | ✅ | — | ✅ | A- |
| vk/deployment-runner | — | ✅ | — | ✅ | B+ |
| vk/topology-configurator | — | ✅ | — | ✅ | B+ |
| sdk-bos6000-toolkit | ✅ | ✅ | — | ✅ | B+ |
| vk/defect-report-toolkit | — | ✅ | — | ✅ | B |
| sdk-redis-trendline-monitor | — | ✅ | — | ✅ | B |
| sdk-defect-visualizer | — | — | — | ✅ | C+ |
| sf/spotfusion-toolkit (12 tools) | — | — | — | ❌ | C |
| sf/dataset-toolkit | — | — | — | ✅ | C |
| sf/view-r-extractor | — | — | — | ⚠️ | C+ |
| dm/infra-setup | — | ✅ | — | ❌ | B- |
| dm/parse_mock_data | — | — | — | ❌ | D |

---

## 6. Suggested Execution Order

1. **Cleanup first** — delete empty dirs, archive abandoned tools, merge VK analysis dirs
2. **sdk-plc-toolkit** — highest value, 5 tools → 1, benefits all 3 products
3. **sdk-deployment-toolkit** — prevents further divergence between SF and VK
4. **sdk-defect-toolkit** — clear 1:1 merge, both tools are actively used
5. **sdk-redis-toolkit** — straightforward merge, SDK version is already the best
6. **sdk-message-poster** — small merge, quick win
7. **sdk-image-toolkit** — 3 tools from different products, needs careful schema abstraction
8. **sdk-welding-toolkit** — lowest priority, currently SF-only

**End of Report**
