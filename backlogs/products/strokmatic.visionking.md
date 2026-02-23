# VisionKing Backlog

## High Priority
- [ ] [complex] SEC-01: Rotate and remove hardcoded credentials — `.env.example` has `skm@@2022`, `SisSurface@@2022`. GCP JSON keys in repo root + inference/secrets.
- [ ] [complex] TEST-01: Add automated test suites for all Python services — Only database-writer has pytest. 6+ services at 0% coverage. Target 80% on business logic.
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

## Product Features
- [ ] [medium] FEAT-08: Migrate pixel-to-object debug viewer from trimesh+pyglet to PyVista — Replace `visualize_ray_intersection()` in `src/transformer.py` (trimesh Scene + pyglet OpenGL) with PyVista-based viewer. Benefits: interactive picking, widgets, text labels, camera frustums via `Camera.view_frustum()`, headless rendering (`PYVISTA_OFF_SCREEN`), dark theme. Keep trimesh for geometry processing (ray-casting, mesh loading). Add pyvista to dev requirements, remove pyglet dependency. Matches inspection-grouping-optimizer's PyVista stack for consistency across Strokmatic SDK visualization.
- [ ] [complex] FEAT-01: Implement sophisticated config and testing for pixel-to-object — Configurable parameters, edge case handling, comprehensive test coverage.
- [ ] [complex] FEAT-02: Implement and test all model combinations for vk-inference — YOLO/ONNX × classification/detection/segmentation/OBB. Ensure all paths work end-to-end.
- [ ] [complex] FEAT-03: Refine length-measure — Improve accuracy, calibration, edge detection. Add test cases for known measurements.
- [ ] [complex] FEAT-04: Specifications for sealer measure — Define requirements, measurement approach, sensor/camera integration, accuracy targets.
- [ ] [complex] FEAT-05: Add 3D camera capabilities to camera-acquisition — Support 3D sensors (structured light, ToF), depth data pipeline, point cloud handling.
- [ ] [complex] FEAT-06: Advance integrated testing suite — Cross-service integration tests covering the full pipeline: acquisition → inference → result → database.

- [ ] [medium] FEAT-07: Add watermark toggle to defect-visualizer Docker app — The `add_watermark()` function exists in 3 static scripts (generate_heatmaps.py, generate_table.py, generate_timeline.py) but the Docker backend API (`/api/heatmap/{view}`) has zero watermark support. Port `add_watermark()` to the backend, add `cairosvg` + `libcairo2-dev` to Dockerfile, expose as `?watermark=true/false` query param and env var `WATERMARK_ENABLED`. Also add toggle to defect-visualizer frontend UI.

## Toolkit Cleanup
- [ ] [simple] TOOL-03: Delete abandoned toolkit dirs — Remove vk/toolkit/label-studio (empty, replaced by sdk-label-studio-toolkit) and vk/toolkit/model-comparison (empty scaffold).
- [ ] [simple] TOOL-04: Merge analysis tools → vk/toolkit/analysis — Combine logs/, logs-parsing-analysis/, profiling/ into single vk/toolkit/analysis/ with submodules: log_parser, profiler, pickle_inspector. Shared pandas output format, Click CLI entry point.
- [ ] [medium] TOOL-05: Migrate defect-report-toolkit to sdk-defect-toolkit — After SDK TOOL-03 is done, replace vk/toolkit/defect-report-toolkit submodule with sdk-defect-toolkit.
- [ ] [medium] TOOL-06: Migrate deployment tools to sdk-deployment-toolkit — After SDK TOOL-02 is done, replace vk/toolkit/deployment-runner + topology-configurator with thin CLI wrappers over sdk-deployment-toolkit submodule.
- [ ] [medium] TOOL-07: Migrate image-toolkit to sdk-image-toolkit — After SDK TOOL-06 is done, replace vk/toolkit/image-toolkit with sdk-image-toolkit submodule.
- [ ] [simple] TOOL-08: Migrate message-poster to sdk-message-poster — After SDK TOOL-05 is done, replace vk/toolkit/message-poster with sdk-message-poster submodule.

## Low Priority
- [ ] [medium] TOOL-01: Integrate data science pipeline into CI/CD — ds/ folder isolated. Need cloudbuild + model export automation.
- [ ] [medium] TOOL-02: Complete and document cloud pipeline toolkit — cloud-pipeline-draft/ incomplete. Evaluate or archive.
- [ ] [simple] DOC-03: Create developer onboarding guide — No local dev setup docs, no submodule init guide.
