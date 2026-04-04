# VisionKing Backlog

> Detailed implementation specs in `plans/visionking-*.md`

## Critical (P0)
- [ ] [simple] FIX-01: Resolve unresolved git merge conflicts in controller.cpp — `services/controller/src/controller_functions.cpp` has `<<<<<<< HEAD` markers on 20+ lines. Code does not compile. **Fix immediately.**

## High Priority

### Sealer Pipeline (SEALER-01 through SEALER-12)
- [ ] [COMPLEX] SEALER-01: Create point-cloud-processor service — Python microservice. Redis DB0 → outlier removal → RANSAC → ROI → depth map → pc-processed-queue. Open3D, numpy, scipy.
- [ ] [MEDIUM] SEALER-02: Adapt image-saver for 3D point cloud storage — Auto-detect 2D vs 3D from Redis HASH. Save .ply for point clouds. Backward-compatible.
- [ ] [COMPLEX] SEALER-03: Create sealer-bead-measurement service — Cross-section analysis: centerline PCA, perpendicular slicing 5mm, Gaussian fit. Per-segment pass/fail (width<3mm, height<1.5mm, continuity<80%).
- [ ] [COMPLEX] SEALER-04: Create 3D inference training pipeline — Geometric rules + YOLOv11 on depth map tiles. ONNX + OpenVINO for CPU (AAEON Boxer-6641, no GPU). 6 defect classes.
- [ ] [MEDIUM] SEALER-05: Adapt database-writer for sealer measurements — DB_WRITER_MODE=sealer. New tables + stored procedure insert_sealer_measurements(jsonb).
- [ ] [MEDIUM] SEALER-06: Create sealer-inspection NestJS module — 4 REST endpoints: inspections list, detail, measurements, trends. Sequelize entities.
- [ ] [COMPLEX] SEALER-07: Create sealer-visualization Angular module — Three.js point cloud viewer. Bead cross-section charts. Pass/fail dashboard. Dark theme.
- [ ] [COMPLEX] SEALER-08: Create hikrobot-acquisition service — C++ for Hikrobot MV-DLS1400M-15 (MV3D SDK, NOT GenICam). Redis DB0 HASH with point_cloud_data.
- [ ] [MEDIUM] SEALER-09: Create 3D sealer pipeline integration tests — E2E with dedicated ports (5676/6383/5436). Contract + pipeline + benchmark tests.
- [ ] [MEDIUM] SEALER-10: Create 3D camera calibration tool — Python CLI. Reference block calibration. ICP/SVD transform. Validation tolerances.
- [ ] [SIMPLE] SEALER-11: Define sealer RabbitMQ queue topology — Topic exchange, 5 queues, DLX. Message schemas documented.
- [ ] [COMPLEX] SEALER-12: Create sealer deployment topology — topologies/sealer-single-node.yaml. Commissioning script. Network config docs.

### SparkTest Pipeline (SPARK-01 through SPARK-07)
- [ ] [COMPLEX] SPARK-01: Create wifi-camera-acquisition service — Python RTSP from DJI WiFi cameras. Redis DB0. Start/stop via pub/sub.
- [ ] [COMPLEX] SPARK-02: Create spark-test-controller service — Python/FastAPI orchestrator. State machine IDLE→CAPTURING→ANALYZING→COMPLETE/FAILED.
- [ ] [COMPLEX] SPARK-03: Adapt inference for spark classification — ONNX/TensorRT for spark model. Pluggable strategies.
- [ ] [COMPLEX] SPARK-04: Create backend-sparktest NestJS API — Tablet frontend gateway. WebSocket updates. New PostgreSQL schema.
- [ ] [COMPLEX] SPARK-05: Create frontend-sparktest Angular PWA — Tablet-optimized dark-theme touch UI. Material input + OCR.
- [ ] [MEDIUM] SPARK-07: Adapt database-writer for spark test results — New queue + PostgreSQL insert function.

### Security & Quality
- [ ] [complex] SEC-01: Rotate and remove hardcoded credentials — `.env.example` has `<skm-password>`, `<sissurface-password>`. GCP JSON keys.
- [ ] [complex] TEST-02: Add test infrastructure for C++ services — camera-acquisition, controller, plc-monitor have no gtest, no CI test step.
- [ ] [medium] GIT-01: Resolve uncommitted submodule changes — 5 submodules with uncommitted/unpushed work.
- [ ] [complex] CICD-01: Add Cloud Build configs to missing services — Missing: pixel-to-object, length-measure, backend, frontend, inference (5 of 17).
- [ ] [complex] HEALTH-01: Add Docker healthchecks to all services — Only 1 of 22 services has a healthcheck.
- [ ] [medium] MONITOR-01: Add Prometheus metrics to services — Zero services expose metrics. Priority: inference (GPU), database-writer (latency), image-saver (throughput).

## Medium Priority
- [ ] [COMPLEX] DISPLAY-01: Create VisionKing Display App (Android TV kiosk) — Android TV + NestJS display-manager module. Spec: `plans/visionking-display-01.md`
- [ ] [medium] CLEAN-01: Remove large artifacts and organize untracked files — 300MB+ zip in root, 2GB+ legacy/, 5,889 __pycache__ dirs.
- [ ] [medium] CLEAN-02: Implement model artifact management (DVC/GCS) — inference repo is 7.5GB, models stored directly in git.
- [ ] [medium] INFRA-01: Implement centralized logging — JSON file logging only, no aggregation. Options: gcplogs or Loki+Grafana.
- [ ] [medium] INFRA-02: Standardize network configuration — Mixed host/bridge networking. Audit which services truly need host mode.
- [ ] [medium] OPT-01: Add RabbitMQ dead-letter queues and message batching — No DLX configured. Failed messages silently dropped.
- [ ] [medium] OPT-02: Add resource monitoring and auto-scaling thresholds — No container metrics, no GPU monitoring.
- [ ] [medium] QUAL-01: Standardize error handling and logging — Inconsistent patterns (7 services use logging module, 2 use loguru). Standardize on SDK loguru.

## Low Priority
- [ ] [medium] TOOL-01: Integrate data science pipeline into CI/CD — ds/ folder isolated. Need cloudbuild + model export automation.
- [ ] [medium] TOOL-02: Complete and document cloud pipeline toolkit — cloud-pipeline-draft/ incomplete. Evaluate or archive.
- [ ] [simple] DOC-03: Create developer onboarding guide — No local dev setup docs, no submodule init guide.

## Completed
- [x] TEST-01: Add automated test suites for all Python services — E2E infrastructure merged (2026-02-26)
- [x] SPARK-06: Add SparkTest topology profile — `topologies/sparktest-single-node.yaml` exists and verified
- [x] QUAL-02: Add API documentation (Swagger) — Backend already has @nestjs/swagger configured
- [x] DOC-01: Add README.md to services — 18 of 22 services have READMEs
- [x] DOC-02: Create deployment runbook — Knowledge base `operacoes/` + `deploys/arcelormittal-laminacao-03002.md` (2026-04-03)
- [x] CICD-02: Cloud Build validation steps — Moved to `general.md` as cross-product task
