# VisionKing Backlog

> Detailed implementation specs for each task: [`doc/backlog-specs.md`](../doc/backlog-specs.md)

## High Priority
- [ ] [MEDIUM] SPARK-07: Adapt database-writer for spark test results — New RabbitMQ queue (spark-result-queue) and PostgreSQL insert function for spark test results. Reuse existing database-writer with new config or deploy separate container instance
- [ ] [MEDIUM] SPARK-06: Add SparkTest topology profile — New topology template sparktest-single-node.yaml. Extend topology-configurator for wifi-rtsp camera type and SparkTest profile. Extend deployment-runner for SparkTest docker-compose generation
- [ ] [COMPLEX] SPARK-05: Create frontend-sparktest Angular tablet PWA — Tablet-optimized dark-theme touch UI. Screens: material input (keyboard + OCR), capture control (Start/Analyze), result display (alloy + APROVADO/REPROVADO), test history. Offline-capable
- [ ] [COMPLEX] SPARK-04: Create backend-sparktest NestJS API — Gateway for tablet frontend. Proxy to spark-test-controller. CRUD for materials catalog, test history, operators. WebSocket for real-time updates. New PostgreSQL schema (materials, spark_tests, spark_test_frames)
- [ ] [COMPLEX] SPARK-03: Adapt inference service for spark classification — Configure existing ONNX/TensorRT inference for spark classification model. Support pluggable strategies: per-frame+aggregation, video clip, key-frame selection. Placeholder model initially
- [ ] [COMPLEX] SPARK-02: Create spark-test-controller service — Python/FastAPI orchestrator for test lifecycle. REST API for start/analyze/result. State machine IDLE→CAPTURING→ANALYZING→COMPLETE/FAILED. Generates sample UUIDs, coordinates camera, publishes to RabbitMQ, compares identified vs expected material (APROVADO/REPROVADO)
- [ ] [COMPLEX] SPARK-01: Create wifi-camera-acquisition service — Python service connecting to N RTSP streams from WiFi cameras (DJI Action 4). Extracts frames at configurable FPS, writes to Redis DB0 as HASHes (same format as existing camera-acquisition). Start/stop via Redis pub/sub. Design: docs/plans/2026-03-04-sparktest-deployment-profile-design.md
- [ ] [complex] SEC-01: Rotate and remove hardcoded credentials — `.env.example` has `skm@@2022`, `SisSurface@@2022`. GCP JSON keys in repo root + inference/secrets.
- [x] - [ ] [complex] TEST-01: Add automated test suites for all Python services — Only database-writer has pytest. 6+ services at 0% coverage. Target 80% on business logic. (Completed: 2026-02-26)
- [ ] [complex] TEST-02: Add test infrastructure for C++ services — camera-acquisition, controller, plc-monitor have no gtest, no CI test step.
- [ ] [medium] GIT-01: Resolve uncommitted submodule changes — 5 submodules with uncommitted/unpushed work: controller, frontend, length-measure, plc-monitor, result.
- [ ] [complex] CICD-01: Add Cloud Build configs to missing services — Missing: pixel-to-object, length-measure, backend, frontend, inference (5 of 17).
- [ ] [medium] CICD-02: Implement Docker build caching and multi-stage optimization — No --cache-from, no BuildKit. Target 50%+ build time reduction.
- [ ] [medium] DOC-01: Add README.md to all services missing documentation — ~8 services undocumented: image-saver, defect-aggregator, controller, length-measure, etc.
- [ ] [medium] DOC-02: Create deployment runbook — No operational docs. Cover topology workflow, troubleshooting, backup/recovery.
- [ ] [complex] HEALTH-01: Add Docker healthchecks to all services — Only backend-ds has a healthcheck. 16 services unmonitored.

## Medium Priority
- [ ] [medium] CLEAN-01: Remove large artifacts and organize untracked files — 300MB+ zip in root, 2GB+ legacy/, 5,889 __pycache__ dirs.
- [ ] [medium] CLEAN-02: Implement model artifact management (DVC/GCS) — inference repo is 7.5GB, models stored directly in git.
- [ ] [medium] INFRA-01: Implement centralized logging — JSON file logging only, no aggregation. Options: gcplogs or Loki+Grafana.
- [ ] [medium] INFRA-02: Standardize network configuration — Mixed host/bridge networking. Audit which services truly need host mode.
- [ ] [medium] OPT-01: Add RabbitMQ dead-letter queues and message batching — No DLX configured. Failed messages may be silently dropped.
- [ ] [medium] OPT-02: Add resource monitoring and auto-scaling thresholds — No container metrics, no GPU monitoring on inference.
- [ ] [medium] QUAL-01: Standardize error handling and logging — Inconsistent patterns. Need shared decorator + loguru standardization.
- [ ] [simple] QUAL-02: Add API documentation (OpenAPI/Swagger) — NestJS backends have no Swagger setup.

## Low Priority
- [ ] [medium] TOOL-01: Integrate data science pipeline into CI/CD — ds/ folder isolated. Need cloudbuild + model export automation.
- [ ] [medium] TOOL-02: Complete and document cloud pipeline toolkit — cloud-pipeline-draft/ incomplete. Evaluate or archive.
- [ ] [simple] DOC-03: Create developer onboarding guide — No local dev setup docs, no submodule init guide.
