# SDK Monorepo Reorganization — Comprehensive Plan

## Summary

Restructure the flat Strokmatic SDK monorepo (`workspaces/strokmatic/sdk/`) into a categorized, submodule-based architecture. Consolidate duplicate tools from product toolkits (VisionKing, SpotFusion, DieMaster), centralize customized third-party forks, and establish each SDK repo as a git submodule consumable by both the SDK monorepo and product monorepos.

**Supersedes:**
- `modified-third-party-libs.md` — third-party forks are now a category _within_ SDK, not a separate repo
- SDK backlog TOOL-01 through TOOL-07 — individual merge tasks are phases within this plan

---

## Problem Statement

### Current State

The SDK folder contains **21 repositories** in a flat directory — shared libraries sit next to single-file prototypes, VisionKing-specific tools next to infrastructure stacks. Product toolkits evolved independently with significant duplication:

| Metric | Value |
|--------|-------|
| SDK repos (flat, uncategorized) | 21 |
| VisionKing toolkit repos | 13 |
| SpotFusion toolkit repos | 8 + 2 libs |
| DieMaster toolkit repos | 2 (severely underdeveloped) |
| **Total distinct repos** | **44** |

### Identified Problems

1. **No categorization** — sdk-lib-logging (pip library) lives next to portainer (Docker tarballs) and email-kb (prototype)
2. **6-8 vendored pylogix copies** across SpotFusion services — bug fixes must be applied N times
3. **3 ultralytics-custom copies** at different versions (v8.3.34, v8.0.112, unknown) — main fork 1,803 commits behind upstream
4. **6-7 duplicate tool clusters** — message-poster (3 versions), defect-visualizer (2), model-comparison (2), Redis monitoring (3), image tools (3), deployment tooling (2 architectures)
5. **DieMaster has no shared tooling** — empty `libs/`, 2 abandoned scripts, no CLI standardization — despite sharing RabbitMQ, Redis, PostgreSQL, and Docker patterns with siblings
6. **Product toolkits don't consume SDK** — SpotFusion toolkit imports nothing from SDK; VisionKing toolkit imports nothing from SDK. Each evolved in isolation
7. **No submodule structure** — products can't selectively pull SDK tools into their `toolkit/` directories

---

## Target Architecture

### SDK Monorepo Structure

```
sdk/
├── libs/                              # Pip-installable shared libraries
│   ├── lib-logging/                   #   loguru wrapper — all products
│   └── lib-rabbit-client/             #   aio-pika wrapper — all products
│
├── tools/                             # Standalone operational tools
│   ├── message-poster/                #   RabbitMQ test messages (merged from 3 versions)
│   ├── repository-reader/             #   Repo → single text file
│   ├── defect-visualizer/             #   Heatmap engine (merged SDK + VK defect-report-toolkit)
│   ├── image-manager/                 #   Image extraction + labeling (merged 3 tools)
│   ├── model-comparison/              #   ML model eval (merged ONNX + TF versions)
│   ├── redis-toolkit/                 #   Redis monitoring + backup (merged SDK + SF plotter)
│   ├── label-studio-toolkit/          #   Annotation platform integration
│   ├── plc-toolkit/                   #   PLC monitoring + recording (merged from SF tools)
│   ├── deploy-toolkit/                #   Unified topology + deployment (merged VK CLI + SF wizard)
│   ├── welding-toolkit/               #   BOS6000 + ViewR + RAFT (SF welding tools)
│   ├── smartcam-toolkit/              #   Camera FOV documentation
│   ├── video-cronoanalysis/           #   ELAN annotation analysis
│   └── data-scraping/                 #   Excel weld parameter extraction
│
├── infra/                             # Infrastructure components
│   ├── observability-stack/           #   Prometheus + Grafana + exporters
│   ├── pi-kiosk-manager/             #   Raspberry Pi fleet management
│   ├── server-installer/              #   .deb package builders
│   └── portainer/                     #   Container management
│
├── third-party/                       # Customized forks of external libraries
│   ├── ultralytics-custom/            #   YOLOv11 fork — grayscale support (AGPL-3.0)
│   ├── pylogix/                       #   Allen-Bradley PLC comms, custom Adapter class (Apache-2.0)
│   ├── genicam-skm/                   #   Aravis camera SDK — C++20/Pybind11 (internal)
│   ├── lldpd/                         #   LLDP protocol daemon — C (ISC license)
│   ├── opener/                        #   EtherNet/IP stack — C + Pybind11 bindings (BSD)
│   ├── 3d-model-convert-to-gltf/      #   CAD → glTF converter (MIT)
│   └── label-studio-ml-backend/       #   ML backend for Label Studio (Apache-2.0)
│
├── ds/                                # Data science & research tools
│   ├── inspection-grouping-optimizer/ #   Weld group optimization algorithm
│   ├── plant-data-parser/             #   ML training dataset generation
│   └── pamstamp-io/                   #   PAM-STAMP simulation parameterizer
│
├── standards/                         # Reference documentation & conventions
│   ├── agent-standards/               #   Coding conventions (CLAUDE.md authority)
│   └── weld-parameters/               #   Weld parameter specifications
│
└── experimental/                      # Prototypes, not production-ready
    ├── blender-tools/                 #   Blender camera calibration import
    ├── email-kb/                      #   Email knowledge base (Claude AI)
    └── project-organizer/             #   File organization utility
```

### Product Monorepo Consumption

Each product monorepo pulls the relevant SDK repos as git submodules into its `toolkit/` directory:

**VisionKing `toolkit/`:**
```
toolkit/
├── defect-visualizer/          → sdk/tools/defect-visualizer (submodule)
├── image-manager/              → sdk/tools/image-manager (submodule)
├── model-comparison/           → sdk/tools/model-comparison (submodule)
├── label-studio-toolkit/       → sdk/tools/label-studio-toolkit (submodule)
├── deploy-toolkit/             → sdk/infra/deploy-toolkit (submodule)  [was topology-configurator + deployment-runner]
├── data-manager/               VK-specific, stays local
├── image-toolkit/              VK-specific research, stays local
├── profiling/                  VK-specific benchmarks, stays local
├── slicing-comparison/         VK-specific research, stays local
└── logs-parsing-analysis/      VK-specific utility, stays local
```

**SpotFusion `toolkit/`:**
```
toolkit/
├── deploy-toolkit/             → sdk/tools/deploy-toolkit (submodule)  [was spotfusion-deploy-toolkit]
├── plc-toolkit/                → sdk/tools/plc-toolkit (submodule)
├── redis-toolkit/              → sdk/tools/redis-toolkit (submodule)
├── welding-toolkit/            → sdk/tools/welding-toolkit (submodule)
├── smartcam-toolkit/           → sdk/tools/smartcam-toolkit (submodule)
├── data-scraping/              → sdk/tools/data-scraping (submodule)
└── plant-data-parser/          → sdk/ds/plant-data-parser (submodule)
```

**SpotFusion `libs/`:**
```
libs/
├── pylogix/                    → sdk/third-party/pylogix (submodule)  [replaces 6-8 vendored copies]
├── genicam-skm/                → sdk/third-party/genicam-skm (submodule)
├── lldpd/                      → sdk/third-party/lldpd (submodule)
└── opener/                     → sdk/third-party/opener (submodule)
```

**DieMaster `toolkit/`:**
```
toolkit/
├── deploy-toolkit/             → sdk/tools/deploy-toolkit (submodule)  [new capability]
├── plc-toolkit/                → sdk/tools/plc-toolkit (submodule)    [new capability]
├── redis-toolkit/              → sdk/tools/redis-toolkit (submodule)  [new capability]
└── pamstamp-io/                → sdk/ds/pamstamp-io (submodule)
```

---

## Duplicate Tool Merge Plan

### Merge 1: Message Poster → `tools/message-poster`

| Source | Location | Key Feature |
|--------|----------|-------------|
| sdk-message-poster | `sdk/sdk-message-poster/` | Template-based JSON, FPS/CPU/GPU monitoring |
| VK message-poster | `visionking/toolkit/toolkit/message-poster/` | DB frame reconstruction, rotating queues, FPS throttling |
| VK logs utility | `visionking/toolkit/logs/` | RabbitMQ message extract/publish |

**Merged design:** Click CLI with modes: `--mode template` (SDK), `--mode replay` (VK DB-based), `--mode extract` (VK logs). Use `sdk-lib-rabbit-client` (aio-pika). Env-based DB/RabbitMQ config (no hardcoded credentials).

### Merge 2: Defect Visualizer → `tools/defect-visualizer`

| Source | Location | Key Feature |
|--------|----------|-------------|
| sdk-defect-visualizer | `sdk/sdk-defect-visualizer/` | Minimal FastAPI DB viewer |
| VK defect-report-toolkit | `visionking/toolkit/defect-report-toolkit/` | FastAPI+Vue3, Gaussian heatmaps, clustering, labeler, timeline, batch reports |

**Merged design:** VK version is the authoritative implementation (far more mature). Absorb SDK version's DB connectivity patterns. Modules: `viewer`, `reporter`, `labeler`. Configurable DB schema for cross-product use.

### Merge 3: Model Comparison → `tools/model-comparison`

| Source | Location | Key Feature |
|--------|----------|-------------|
| sdk-model-comparison | `sdk/sdk-model-comparison/` | ONNX Runtime, FastAPI web UI, .bin→JPEG |
| VK model-comparison | `visionking/toolkit/model-comparison/` | TensorFlow, script-based |

**Merged design:** Single tool supporting multiple runtimes (ONNX, TF, TensorRT). FastAPI web UI from SDK version. Backend abstraction layer for runtime selection.

### Merge 4: Redis Tools → `tools/redis-toolkit`

| Source | Location | Key Feature |
|--------|----------|-------------|
| sdk-redis-trendline-monitor | `sdk/sdk-redis-trendline-monitor/` | Streamlit real-time monitor, CSV persistence, event triggers |
| SF redis-saver/restorer | `spotfusion/toolkit/spotfusion-toolkit/redis-saver/` | Full DB export/restore (strings, hashes, lists, sets, zsets) |
| SF plotter | `spotfusion/toolkit/plotter/` | Dash-based PLC tag plotter via Redis |

**Merged design:** Multi-page Streamlit app. Pages: `Monitor` (real-time trendlines), `Recorder` (background CSV logging), `Backup` (full DB export/restore), `PLC Tags` (step-graph plotter). Configurable key patterns, threshold alerting.

### Merge 5: Image Tools → `tools/image-manager`

| Source | Location | Key Feature |
|--------|----------|-------------|
| sdk-image-extractor | `sdk/sdk-image-extractor/` | Web UI for DB image export, runtime credential override |
| sdk-label-studio-toolkit | `sdk/sdk-label-studio-toolkit/` (partial) | DB filtering, .bin→.jpg conversion |
| VK image-toolkit | `visionking/toolkit/image-toolkit/` | OpenCV classification, Parquet, GCS upload |

**Merged design:** Click CLI with subcommands: `extract` (DB→disk), `upload` (disk→GCS), `filter` (by camera/peca/defect), `catalog` (Parquet metadata), `classify` (interactive OpenCV viewer). Optional Streamlit UI.

### Merge 6: PLC Tools → `tools/plc-toolkit`

| Source | Location | Key Feature |
|--------|----------|-------------|
| SF plc-recorder | `spotfusion/toolkit/spotfusion-toolkit/plc-recorder/` | Streamlit, SSH log capture |
| SF plc-log-parser | `spotfusion/toolkit/spotfusion-toolkit/plc-log-parser/` | Log line parsing |
| SF plc-record-cleaner | `spotfusion/toolkit/spotfusion-toolkit/plc-record-cleaner/` | Data cleanup |
| SF plc-record-plotter | `spotfusion/toolkit/spotfusion-toolkit/plc-record-plotter/` | Plotly visualization |
| SF plc-reader-class3 | (if exists) | Class 3 reading |

**Merged design:** Multi-page Streamlit app OR Click CLI. Pages: `Capture` (SSH-based log streaming), `Parse` (log→structured CSV), `Clean` (data validation), `Plot` (Plotly time series). Product-specific IO table configs stay in product monorepos as JSON config files.

### Merge 7: Deployment Toolkit → `tools/deploy-toolkit`

| Source | Location | Key Feature |
|--------|----------|-------------|
| VK topology-configurator | `visionking/toolkit/topology-configurator/` | Click CLI wizard, Pydantic models, YAML SSOT, 2114 LOC |
| VK deployment-runner | `visionking/toolkit/deployment-runner/` | Click CLI, docker-compose generation, multi-node, 1241 LOC |
| SF spotfusion-deploy-toolkit | `spotfusion/toolkit/spotfusion-deploy-toolkit/` | FastAPI+Vue3 web wizard, SQLAlchemy, YAML export |

**Merged design:** Core library with shared Pydantic models (topology, services, nodes, infrastructure). Two interfaces: CLI (`deploy-cli` — from VK) and Web (`deploy-wizard` — from SF). Per-product service catalogs (VK services, SF services, DM services) loaded from config. Shared compose generation, env interpolation, validation, diff, deploy/stop/status.

---

## Third-Party Fork Consolidation

Each fork follows this structure within `sdk/third-party/<name>/`:

```
<name>/
├── README.md                  # Upstream version, modification log, license
├── CHANGELOG.md               # Keep a Changelog format
├── upstream.txt               # Pinned upstream commit SHA + URL
├── patches/                   # Git-format patches (for rebasing onto upstream updates)
├── <source>/                  # Modified source code
├── tests/                     # Tests for custom modifications
├── pyproject.toml             # strokmatic-<name> package (Python libs)
│   OR CMakeLists.txt          # (C/C++ libs)
└── Dockerfile.build           # Build environment (if needed)
```

### ultralytics-custom

- **Upstream:** `ultralytics/ultralytics` (AGPL-3.0)
- **Key customization:** Native grayscale/single-channel image support for industrial inspection
- **Current copies:** 3 (training v8.3.34 at 4.6MB, inference v8.0.112 at 2.3MB, label-studio at 9.3MB)
- **Action:** Consolidate into single fork. Pin to specific upstream tag. Document all grayscale patches. Publish as `strokmatic-ultralytics` package. All consumers import from one source.
- **Module hijack pattern (`sys.modules['ultralytics'] = ultralytics_custom`)** to be preserved for compatibility.

### pylogix

- **Upstream:** `dmroeder/pylogix` (Apache-2.0)
- **Key customization:** Custom `Adapter` class for EtherNet/IP Class 1 & 2 implicit messaging
- **Current copies:** 6-8 vendored across SpotFusion PLC services + DieMaster + VisionKing
- **Action:** Extract canonical version with Adapter class. Publish as `strokmatic-pylogix`. Replace all vendored copies with pip install or submodule reference.

### genicam-skm

- **Upstream:** Internal (Gustavo Camargo, Strokmatic)
- **Key tech:** C++20/Pybind11 wrapper for Aravis/GenICam camera control
- **Current location:** `spotfusion/services/camera-acquisition/utils/genicam-skm/`
- **Action:** Move to `sdk/third-party/genicam-skm/`. CMake build system. Publish as wheel via CI.

### opener

- **Upstream:** EtherNet/IP open-source stack (BSD license)
- **Key customization:** Custom Pybind11 Python bindings for CIP protocol
- **Current copies:** 2 (libs/opener + plc-monitor-camera-opener)
- **Action:** Consolidate into `sdk/third-party/opener/`. Single C source + Python bindings.

### lldpd

- **Upstream:** Open source LLDP daemon (ISC license)
- **Current location:** `spotfusion/libs/lldpd/`
- **Action:** Move to `sdk/third-party/lldpd/`. Docker build for containerized deployment.

### 3d-model-convert-to-gltf

- **Upstream:** `wangerzi/3d-model-convert-to-gltf` (MIT)
- **Action:** Move from `sdk/` root to `sdk/third-party/3d-model-convert-to-gltf/`.

### label-studio-ml-backend

- **Upstream:** `HumanSignal/label-studio-ml-backend` (Apache-2.0)
- **Key customization:** Custom VisionKing ML backend modules with embedded ultralytics
- **Current location:** `visionking/ds/label-predictor/label-studio-ml-backend/`
- **Action:** Move custom backend modules to `sdk/third-party/label-studio-ml-backend/`. Upstream base can be pip-installed; only custom modules need tracking.

### Distribution Strategy

**GitHub Packages** (zero infra) for Python packages:
- `strokmatic-pylogix` — pip installable
- `strokmatic-ultralytics` — pip installable
- `strokmatic-genicam-skm` — wheel with C++ extensions

**Git submodules** for C libraries consumed as source:
- `opener` — built from source in Dockerfiles
- `lldpd` — built from source in Dockerfiles

**CI Automation** (GitHub Actions per fork):
- Lint + test + build wheel on push
- Weekly upstream sync check (diff report)
- License compliance tracking

---

## Development Phases

### Phase 0 — Preparation & SDK Structure
**Estimate: 2-3 hours**

1. Create category directories in SDK monorepo (`libs/`, `tools/`, `infra/`, `third-party/`, `ds/`, `standards/`, `experimental/`)
2. Move existing repos into categories (git mv or submodule path updates)
3. Update `config/orchestrator/workspaces.json` with new paths
4. Update all consumers of workspace paths (`scripts/lib/config.sh`, MCP servers, dashboard parsers)
5. Verify JARVIS orchestrator still resolves all workspaces
6. Update SDK `.gitmodules` if repos are already submodules

**Acceptance criteria:** All 21 existing SDK repos accessible at new categorized paths. Orchestrator dashboard shows correct workspace status. No broken references.

### Phase 1 — Third-Party Fork Consolidation
**Estimate: 8-12 hours**

1. **pylogix** (highest impact — eliminates 6-8 copies)
   - Extract canonical version with Adapter class from `spotfusion/services/plc-monitor-camera/utils/pylogix/`
   - Create `pyproject.toml` as `strokmatic-pylogix`
   - Generate patch file against upstream 0.8.3
   - Write tests for Adapter class
   - Set up GitHub Actions CI
   - Publish first wheel to GitHub Packages
   - Migrate ONE SpotFusion service as proof of concept
   - Then migrate remaining 5-7 services, removing vendored copies

2. **ultralytics-custom** (highest complexity)
   - Audit diff between training copy (v8.3.34) and inference copy (v8.0.112)
   - Identify all grayscale-specific patches
   - Create unified fork pinned to specific upstream tag
   - Publish as `strokmatic-ultralytics`
   - Migrate training, inference, and label-studio consumers
   - Remove 3 embedded copies

3. **genicam-skm, opener, lldpd, 3d-model-convert-to-gltf, label-studio-ml-backend**
   - Move to `sdk/third-party/`
   - Set up per-fork README with upstream tracking
   - Add `upstream.txt` and `patches/` directory
   - Deduplicate opener (2 copies → 1)

**Acceptance criteria:** All 7 third-party forks in `sdk/third-party/`. pylogix vendored copies eliminated. ultralytics unified to single version. Each fork has README, CHANGELOG, upstream.txt.

### Phase 2 — Tool Merges (High-Impact)
**Estimate: 15-20 hours**

Priority order based on duplication severity and cross-product benefit:

1. **Deploy Toolkit** (Merge 7) — 3-5h
   - Extract core Pydantic models from VK topology-configurator
   - Abstract service catalog to support VK + SF + DM service definitions
   - Core library: topology validation, compose generation, env interpolation, diff, deploy/stop/status
   - Preserve VK CLI wrapper and SF web wizard as interface layers
   - Tests for core library

2. **Defect Visualizer** (Merge 2) — 2-3h
   - VK version is authoritative; absorb SDK version's patterns
   - Make DB schema configurable (not VK-specific table names)
   - Add product selection in UI

3. **Message Poster** (Merge 1) — 2-3h
   - Click CLI with `--mode template|replay|extract`
   - Migrate to `sdk-lib-rabbit-client` (aio-pika)
   - Remove hardcoded credentials

4. **Redis Toolkit** (Merge 4) — 2-3h
   - Multi-page Streamlit app
   - Configurable Redis connection (host, port, db, password from env)

5. **PLC Toolkit** (Merge 6) — 3-4h
   - Multi-page Streamlit app
   - Product-specific IO tables loaded from config

6. **Image Manager** (Merge 5) — 2-3h
   - Click CLI with subcommands
   - Configurable DB schema

7. **Model Comparison** (Merge 3) — 1-2h
   - Add runtime abstraction (ONNX, TF, TensorRT)
   - Web UI from SDK version

**Acceptance criteria:** 7 merged tools in `sdk/tools/`. Each has README, CLI/UI entry point, configurable for cross-product use. Old duplicate repos archived or redirected.

### Phase 3 — Product Monorepo Integration
**Estimate: 6-8 hours**

1. Add `.gitmodules` entries in VisionKing monorepo for consumed SDK tools
2. Add `.gitmodules` entries in SpotFusion monorepo
3. Add `.gitmodules` entries in DieMaster monorepo (first-time shared tooling access)
4. Update product `docker-compose.yml` files for new toolkit paths
5. Update product Dockerfiles for `strokmatic-pylogix` / `strokmatic-ultralytics` pip installs
6. Remove old duplicate directories from product monorepos
7. Update VK/SF/DM context.md and CLAUDE.md with new toolkit references

**Acceptance criteria:** Each product monorepo has `toolkit/` with SDK submodules. `git submodule update --init` resolves all tools. Docker builds pass. No remaining vendored copies of pylogix or ultralytics.

### Phase 4 — Cleanup & Documentation
**Estimate: 3-4 hours**

1. Archive old SDK repos that were merged (mark as deprecated in README, add redirect)
2. Update orchestrator workspace config with final paths
3. Update orchestrator backlogs (mark TOOL-01 through TOOL-07 as complete)
4. Write SDK README.md with category descriptions and usage guide
5. Write developer guide: how to add a new tool, how to consume SDK in a product
6. Set up upstream sync CI for all third-party forks
7. Update JARVIS MEMORY.md with new SDK structure

**Acceptance criteria:** No orphaned repos. SDK README covers all categories. Developer guide exists. CI for third-party upstream sync is running.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Broken submodule references during migration | High | Medium | Phase 0 handles path updates; test with `git submodule update --init --recursive` |
| Docker builds fail with new paths | Medium | High | Run full Docker build for each product after phase 3; fix paths before merging |
| Merged tools lose product-specific behavior | Medium | High | Each merge design preserves all existing functionality; config-driven product specifics |
| ultralytics version mismatch causes inference regression | Medium | High | Pin to specific tag; run inference benchmarks before/after |
| DieMaster service catalog doesn't exist for deploy-toolkit | Low | Low | Create minimal DM service catalog; DM has fewer services |
| Team members unfamiliar with new structure | Medium | Low | Developer guide + README; gradual migration (old paths work during transition) |

---

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 0 — SDK structure + path migration | 2-3h | None |
| Phase 1 — Third-party consolidation | 8-12h | Phase 0 |
| Phase 2 — Tool merges (7 merges) | 15-20h | Phase 0 |
| Phase 3 — Product monorepo integration | 6-8h | Phases 1 + 2 |
| Phase 4 — Cleanup + documentation | 3-4h | Phase 3 |
| **Total** | **34-47h** | |

Phases 1 and 2 can run in parallel (they don't depend on each other).

---

## What Stays Product-Local

Not everything should move to SDK. These remain in their product monorepos:

**VisionKing (stays local):**
- `data-manager/` — VK-specific DAS/GCS consolidation with hardcoded campaign paths
- `image-toolkit/` — Research tool with VK-specific Parquet schemas and GCS bucket
- `profiling/` — VK inference benchmarks
- `slicing-comparison/` — VK image tiling research
- `logs-parsing-analysis/` — VK log format analysis
- `label-studio/` — Empty placeholder

**SpotFusion (stays local):**
- `spotfusion-toolkit/main_app/` — Legacy app (evaluate for archival)
- `spotfusion-toolkit/file-explorer/` — Simple file browser
- `spotfusion-toolkit/raft_studies/` — Research code (or merge into welding-toolkit)
- `spotfusion-toolkit/image-analyzer/` — SF-specific image analysis

**DieMaster (stays local):**
- `toolkit/parse_mock_data/` — Abandoned test data loader (evaluate for removal)

---

## References

- SDK backlog: `backlogs/products/strokmatic.sdk.md` (TOOL-01 through TOOL-07)
- Third-party libs spec (superseded): `backlogs/orchestrator/modified-third-party-libs.md`
- VisionKing context: `workspaces/strokmatic/visionking/.claude/context.md`
- SpotFusion context: `workspaces/strokmatic/spotfusion/.claude/context.md`
- DieMaster context: `workspaces/strokmatic/diemaster/.claude/context.md`
- Workspace config: `config/orchestrator/workspaces.json`
