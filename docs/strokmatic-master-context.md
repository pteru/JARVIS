# Strokmatic — Master Context Document

**Generated:** 2026-03-24
**Purpose:** Single-source reference for full Strokmatic development history, architecture, and roadmap context. Load this file in any future session for complete company context.

---

## 1. Company Overview

**Strokmatic** develops industrial IoT inspection and monitoring systems for automotive manufacturing. Three product lines:

| Product | Code | Focus | Key Clients |
|---|---|---|---|
| **DieMaster (Smart Die)** | 01xxx | Stamping die sensor monitoring (draw-in, vibration, temperature) | GM (SJC, Flint, Pontiac), Schulz |
| **SpotFusion** | 02xxx | Spot weld quality inspection (current/resistance + vision) | GM (SJC, GVT, FZ, SCDS), Hyundai, Nissan/COMAU |
| **VisionKing** | 03xxx | Visual surface defect inspection (steel, body, sealer, spark) | ArcelorMittal, GM, Hyundai, Stellantis, Usiminas |

**Team:** ~15 engineers across firmware, software, data science, mechanical, and project management.

**Infrastructure:** GCP (Cloud Build, Artifact Registry), GitHub (strokmatic org), ClickUp (task management), Google Workspace (Drive, Docs, Chat).

---

## 2. ClickUp Task Inventory (TÉCNICO Space)

**Total tasks: 3,218** across all regular folders (collected 2026-03-24 via REST API).

### 2.1 Smart Die (547 tasks)

| Status | Count |
|---|---|
| Done | 453 |
| Open (backlog/to-do/pending/references) | 94 |
| In Progress | 12 |
| Blocked | 24 |

**Top lists:** Software (168), Front/Back (59), [01001] SJC (55), Proj. Eletrônico (52), Proj. Mecânico (47), Modelos (37), Documentação (34), [01002] Flint (32), [01003] Schulz (29)

**Key contributors:** Marcus V. da Silva (63), Pedro Teruel (59), William C. Abe (58), Fabiano Dencker (53), Rodrigo Carvalho (46)

**Current focus:** Flint deployment (CNC machining, sensors), production screen refactor, draw-in prediction algorithm (P7), ML inference worker, firmware stabilization.

### 2.2 Spot Fusion (1,379 tasks)

| Status | Count |
|---|---|
| Done | 1,273 |
| Open | 106 |
| In Progress | 3 |
| Blocked | 16 |

**Top lists:** Software (500), Laboratório (165), [02003] GM-FZ (128), Modelos (124), [02002] GM-GVT (103), [02001] GM-SJC (97), Hardware (94), [02006] Hyundai (59), Industrial Edge (42)

**Key contributors:** Arthur Mallman (281), Weslley Poleto (155), Vanessa V. de Sousa (80), Matheus V.M. Santos (78), William C. Abe (71)

**Current focus:** SpINN simulation (SimuFact), BOS6000 data extraction, inference FPS optimization, Smart Cam MV-SC6050 validation, PSI7000 startup with Centerline.

### 2.3 Vision King (826 tasks)

| Status | Count |
|---|---|
| Done | 759 |
| Open | 67 |
| In Progress | 10 |
| Blocked | 6 |

**Top lists:** Software (321), [03002] Arcelor BM (273), [03005] IRIS SCDS POC (63), Hardware (39), [03010] Stellantis (28), [03007] IRIS SCDS Paint (28), Modelos (25), [03006] IRIS GVT Body (16), [03008] Sealer (13)

**Key contributors:** Pedro Teruel (152), William C. Abe (114), Vinicius G. Sotero (108), Matheus Gomes (72), Fabiano Dencker (59)

**Current focus:** ArcelorMittal campaigns (c014+), IRIS SCDS temperature monitoring, sealer structural design, VK-Body mechanical optimization, frontend i18n + user management.

### 2.4 Other Folders

- **Melhorias:** 149 tasks (146 done) — continuous improvement
- **Projetos Finalizados:** 294 tasks — archived projects (Santista, Usiminas CE, Respot, Labrasys)
- **Novos Projetos:** 21 tasks — exploration (wood inspection, Tupy, Thermoval)

---

## 3. Product Architecture Summaries

### 3.1 DieMaster

**Architecture:** Microservice pipeline with custom firmware

```
Sensors (DRAWIN + GAP) → PIC32 Hub (MQTT) → RabbitMQ
  → get-data (enrich from Redis) → data-processing (15-step pipeline)
  → database-writer (PostgreSQL) → inference (ML: autoencoder + LSTM)
  → NestJS backend → Angular 17 frontend
```

**Key specs:**
- 13 microservices + 2 firmware repos (PIC32 hub, ESP32 switch)
- Processing: 2-pass (per-sensor then cross-sensor), 15 computed metrics per stroke
- 8 feature flags for A/B testing processing steps
- Database: PostgreSQL with `process_acquisition_json()` stored proc, soft-delete pattern
- Infrastructure: KeyDB (port 4000, 8 DBs), RabbitMQ, PostgreSQL (port 2345)
- E2E tests: ~40 (contracts, benchmarks, services, pipelines, UI via Playwright)
- ML: 4 model adapters (autoencoder DRAWIN/GAP, LSTM DRAWIN/GAP), ONNX/PyTorch/TensorRT backends
- Draw-in prediction (P7): Sigmoid S-curve fitting, current best 2.07mm RMSE

**Deployments:**
- [01001] GM São José dos Campos — S10 CC die
- [01002] GM Flint — Fender die (in progress: CNC machining)
- [01003] Schulz — Matriz (blocked: sensor installation)
- [01004] GM Pontiac (planned)
- [01005] DEMESTA — Sensor positioning study

### 3.2 SpotFusion

**Architecture:** Dual-pipeline (weld + vision) convergence

```
PLC (Siemens) → tag-monitor → get-data → data-processing → modules (4 parallel) → DB
Camera (ViewR/SmartCam) → get-image → image-processing (YOLO) → data-enrichment → modules → DB
  → NestJS backend (+ backend-vision) → Angular frontend (+ frontend-vision)
```

**Key specs:**
- 26+ microservices as git submodules
- 7 pipeline stages: acquisition → extraction → processing → enrichment → inference → results → persistence
- 4 parallel inference modules (default + a/b/c) with soft voting ensemble
- Database: PostgreSQL with EAV pattern (`spot_in_biw` table)
- Architecture variants: WTC+ViewR (active), Bosch 6000 (placeholder), Custom Vision (active), SmartCam MV-SC6050 (emerging)
- E2E tests: 65 (contracts 30, benchmarks 8, services 14, pipelines 13)
- ML: SpotFusionPlus hybrid CNN+DNN, Optuna hyperparameter search, ClearML tracking
- Simulation: SpINN (SimuFact) for nugget growth simulation

**Deployments:**
- [02001] GM SJC Tampa — Lid welding
- [02002] GM Gravataí BSO — Body Side Outer
- [02003] GM Fazenda Rio Grande — LA/RA
- [02004] GM Gravataí B-Side
- [02005] GM São Caetano — Doors
- [02006] Hyundai Floor — Welding
- [02008] Nissan/COMAU — Technical visits, cybersecurity

### 3.3 VisionKing

**Architecture:** Multi-profile inspection system with GPU inference

```
PLC (Siemens S7) → plc-monitor (C++) → Redis DB 1
Camera (GigE/WiFi/3D) → camera-acquisition (C++) → Redis DB 0
  → image-saver → RabbitMQ → inference (YOLO, ONNX) → pixel-to-object (3D transform)
  → defect-aggregator → database-writer → PostgreSQL
  → result (business rules) → Redis alarms → PLC feedback
  → NestJS backend → Angular frontend
```

**Key specs:**
- 22 git submodules, 4 deployment profiles (steel, body, sparktest, sealer)
- C++ acquisition layer (GigE, WiFi, 3D laser), Python processing, TypeScript web
- GPU inference: YOLO v8/v10, ONNX Runtime primary, 280-450 fps batch, 50-200ms latency
- 3D coordinate transformation with Kalman filtering and defect tracking
- Multi-point inspection (up to 3 independent pipelines with aggregate DB)
- Topology-driven deployment: YAML configs → docker-compose generator
- Database: PostgreSQL (pecas, frames, defeitos, rules)
- E2E tests: 20 (Playwright UI + contract + pipeline)
- Shared SDK: strokmatic-rabbit-client (async RabbitMQ), strokmatic-logging (loguru)

**Deployments:**
- [03001] Usiminas Inovaí — Foreign body detection
- [03002] ArcelorMittal Barra Mansa — Steel surface inspection (14+ campaigns)
- [03003] GM Underbody (completed)
- [03005] IRIS GM SCDS Paint POC
- [03006] IRIS GM GVT Body POC
- [03007] IRIS GM SCDS Paint (production)
- [03008] Hyundai Sealer — 3D bead inspection
- [03009] ArcelorMittal TL2 — Second line
- [03010] Stellantis Goiana — Demo

---

## 4. Cross-Product Patterns

### 4.1 Shared Technology Stack

| Layer | SD | SF | VK |
|---|---|---|---|
| **Pipeline** | Python 3.11+ | Python 3.11+ | Python 3.12+ / C++ 17 |
| **Backend** | NestJS 11 | NestJS 10 | NestJS 10 |
| **Frontend** | Angular 17 | Angular 16 | Angular 19 |
| **Database** | PostgreSQL 15 | PostgreSQL 15 | PostgreSQL 15 |
| **Cache** | KeyDB (4000) | Redis (6379) | KeyDB (4000/6379) |
| **Message Queue** | RabbitMQ 3 | RabbitMQ 3.13 | RabbitMQ 3 |
| **ML Inference** | PyTorch/ONNX | ONNX/TensorRT | ONNX Runtime (primary) |
| **CI/CD** | GCP Cloud Build | GCP Cloud Build | GCP Cloud Build |
| **Containers** | Docker (Alpine) | Docker (Alpine) | Docker (Alpine/Debian) |
| **PLC** | Custom (MQTT) | Siemens (EtherNet/IP) | Siemens (S7) |

### 4.2 Shared Infrastructure Patterns

- **Submodule architecture:** Each product is a monorepo with 14-28 service submodules
- **E2E test framework:** Unified layered pattern (contracts → benchmarks → services → pipelines → UI)
- **Docker Compose profiles:** broker (lightweight) vs full (complete stack)
- **Cloud Build templates:** python-validate, nestjs-validate, angular-validate
- **Port allocation scheme:** Avoids collisions across products (see E2E test infrastructure)
- **Strokmatic SDK:** Shared rabbit-client and logging libraries (VK, being adopted by others)

### 4.3 Common Security Issues

| Issue | SD | SF | VK |
|---|---|---|---|
| Hardcoded credentials | 35+ files | 31+ files | Multiple |
| `eval()` usage | ~40 calls | ~60 calls | Minimal |
| Bare `except:` | Multiple | 88 | Few |
| GCP key in repo | Yes | No | No |

### 4.4 Team Distribution

| Person | SD | SF | VK | Role |
|---|---|---|---|---|
| Pedro Teruel | ✓ | ✓ | ✓ | Tech Lead, Architecture, JARVIS |
| William Chiou Abe | ✓ | ✓ | ✓ | Senior Dev (pipeline, backend) |
| Vinicius G. Sotero | ✓ | ✓ | ✓ | Full-Stack, Firmware |
| Rodrigo Carvalho | ✓ | ✓ | ✓ | Hardware, Lab, Sensors |
| Guilherme T. Santos | ✓ | — | ✓ | Frontend, Backend |
| Arthur Mallman | — | ✓ | — | SF Lead Developer |
| Weslley Poleto | ✓ | ✓ | ✓ | Lab, Hardware, Field |
| Vanessa V. de Sousa | — | ✓ | ✓ | Data Science |
| Matheus V.M. Santos | — | ✓ | ✓ | Data Science, ML |
| Jonas de Melo | ✓ | ✓ | ✓ | Mechanical, Lab |
| Eduardo G. do Valle | ✓ | ✓ | ✓ | Mechanical, Electronics |
| Vinicius Figueredo | ✓ | ✓ | — | Simulation, Data Science |
| Marcus V. da Silva | ✓ | — | — | SD Firmware Developer |

---

## 5. PMO Project Registry

23 active projects mapped in `config/orchestrator/project-codes.json`:

| Code | Name | Product | Drive Shared Drive |
|---|---|---|---|
| 01001 | GM SJC S10 CC | DieMaster | [01] SMART DIE |
| 01002 | GM Flint Fender | DieMaster | [01] SMART DIE |
| 01003 | Schulz Matriz | DieMaster | [01] SMART DIE |
| 01004 | GM Pontiac | DieMaster | [01] SMART DIE |
| 01005 | DEMESTA | DieMaster | [01] SMART DIE |
| 02001 | GM SJC Tampa | SpotFusion | [02] SPOT FUSION |
| 02002 | GM GVT BSO | SpotFusion | [02] SPOT FUSION |
| 02003 | GM FZ LA/RA | SpotFusion | [02] SPOT FUSION |
| 02004 | GM GVT B-Side | SpotFusion | [02] SPOT FUSION |
| 02005 | GM SCDS Portas | SpotFusion | [02] SPOT FUSION |
| 02006 | Hyundai Floor | SpotFusion | [02] SPOT FUSION |
| 02008 | Nissan/COMAU | SpotFusion | [02] SPOT FUSION |
| 03001 | Usiminas Inovaí CE | VisionKing | [03] VISION KING |
| 03002 | ArcelorMittal BM | VisionKing | [03] VISION KING |
| 03003 | GM Underbody | VisionKing | [03] VISION KING |
| 03005 | IRIS GM SCDS Paint POC | VisionKing | [03] VISION KING |
| 03006 | IRIS GM GVT Body POC | VisionKing | [03] VISION KING |
| 03007 | IRIS GM SCDS Paint | VisionKing | [03] VISION KING |
| 03008 | Hyundai Sealer | VisionKing | [03] VISION KING |
| 03009 | ArcelorMittal TL2 | VisionKing | [03] VISION KING |
| 03010 | Stellantis Goiana | VisionKing | [03] VISION KING |

Each project has: PMO folder (`workspaces/strokmatic/pmo/<code>/`), email index, technical report, timeline, Drive folder links.

---

## 6. Development History Timeline

### 2024 (Legacy)
- SpotFusion operational at GM plants (SparkEyes monolith)
- VisionKing deployed at ArcelorMittal (campaigns c001-c006)
- Smart Die early prototype (monolithic Python/Dash app)

### 2025
- **Q1:** Smart Die architecture decomposition into 13 microservices
- **Q1:** SpotFusion E2E test infrastructure (65 tests)
- **Q2-Q3:** VisionKing multi-point body inspection developed
- **Q3:** ArcelorMittal campaigns c007-c010
- **Q4:** Hyundai SpotFusion deployment (factory installation)
- **Q4:** IRIS platform inception (GM SCDS + GVT)

### 2026
- **Jan:** GitHub migration from GCP CSR. JARVIS orchestrator operational.
- **Jan:** VisionKing E2E tests (20 tests, PR #7)
- **Jan-Feb:** ArcelorMittal campaigns c011-c013
- **Feb:** DieMaster E2E tests (~40 tests, PR #6). Inference spec (SENAI CT067/26).
- **Feb:** SpotFusion Cloud Build CI/CD templates
- **Feb-Mar:** DieMaster production screen overhaul (frontend 137+ files)
- **Mar:** ArcelorMittal campaign c014 (YOLO OBB model deployment)
- **Mar:** DieMaster draw-in prediction algorithm (11 iterations, 2.07mm RMSE)
- **Mar:** VisionKing sealer structural design (Hyundai)
- **Mar:** IRIS SCDS temperature monitoring system design
- **Mar:** SpotFusion SpINN simulation (SimuFact operationalization)
- **Mar:** Strokmatic plugin marketplace created (sdk-agent-standards)
- **Mar:** ClickUp sprint task migration (331 tasks reorganized)

---

## 7. Current Sprint Focus (as of 2026-03-24)

### Smart Die (SD Sprint 32-33)
- SJC plant test and data evaluation
- Flint die CNC machining and sensor installation
- Draw-in prediction refinement
- Frontend production screen finalization
- DEMESTA sensor positioning study

### Spot Fusion (SF Sprint 28-29)
- SpINN simulation validation vs DoE
- BOS6000 alternative data extraction
- Inference FPS optimization
- Smart Cam MV-SC6050 focus/sensitivity testing
- PSI7000 startup with Centerline

### Vision King (VK Sprint 28-29)
- ArcelorMittal post-campaign system updates
- Sealer structural analysis and material selection
- IRIS SCDS temperature monitoring
- VK-Body mechanical optimization
- Frontend deploy and testing (arcelor)
- Dataset organization (vk-body)

---

## 8. Data Sources for This Document

| Source | Location | What It Contains |
|---|---|---|
| ClickUp REST API export | `data/clickup-export/*.jsonl` | 3,218 tasks with metadata |
| DieMaster codebase agent | Agent output (session 2026-03-24) | Full technical architecture |
| SpotFusion codebase agent | Agent output (session 2026-03-24) | Full technical architecture |
| VisionKing codebase agent | Agent output (session 2026-03-24) | Full technical architecture |
| SD development history agent | Agent output (session 2026-03-24) | Chronological history from local files |
| PMO folder structure | `workspaces/strokmatic/pmo/` | 23 project folders with emails, reports |
| Project codes config | `config/orchestrator/project-codes.json` | Drive folder mappings, project metadata |
| ClickUp navigator skill | `.claude/skills/clickup-navigator/SKILL.md` | Full workspace hierarchy and IDs |
| Migration plan | `reports/clickup-sprint-migration-plan.md` | Task reorganization details |
| Workflow plan | `docs/superpowers/plans/2026-04-04-integrated-workflow-clickup-github-drive.md` | ClickUp/GitHub/Drive integration |

---

## 9. Gaps Identified (for Roadmap Planning)

### Cross-Product
1. **No centralized logging** — Each product logs locally; no ELK/Datadog/GCP Logging
2. **No model versioning** — ML models stored as files, no MLflow or registry
3. **No feature flags system** — Manual env vars, no LaunchDarkly/custom
4. **Security debt** — Hardcoded credentials across all products (~100+ files)
5. **No distributed tracing** — No OpenTelemetry/Jaeger
6. **Cloud Build gaps** — No test gates, no security scanning in CI

### DieMaster-Specific
7. Draw-in prediction needs near-zero RMSE for production (currently 2.07mm)
8. Backend-DB schema mismatch (NestJS entities use demo schema, not production)
9. Firmware untested (hub state machine error, switch safety regressions)
10. No database migration versioning

### SpotFusion-Specific
11. 60+ `eval()` calls (highest security risk across all products)
12. 2,000+ LOC duplication across utility modules
13. SmartCam variant (FTP watcher) not yet implemented
14. No dead-letter queues (messages lost silently)

### VisionKing-Specific
15. Camera acquisition driver crashes occasionally (GenICam)
16. PLC communication hangs on network timeouts (no backoff)
17. Data enrichment is a critical path bottleneck (PostgreSQL latency)
18. Module consensus opaque (soft voting at query time only)
