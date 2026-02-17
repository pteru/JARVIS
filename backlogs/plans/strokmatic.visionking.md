# VisionKing Product Backlog - Detailed Implementation Plans

**Generated**: 2026-02-16
**Workspace**: `/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/`

---

## Table of Contents

1. [High Priority Tasks](#high-priority)
2. [Medium Priority Tasks](#medium-priority)
3. [Product Features (FEAT-01 through FEAT-06)](#product-features)
4. [Low Priority Tasks](#low-priority)
5. [Estimates Summary Table](#estimates-summary)

---

## High Priority

### SEC-01: Rotate and Remove Hardcoded Credentials

**Current State**:
- `services/length-measure/src/config.py` line 13: `DB_PASSWORD = os.getenv("DB_PASSWORD", "skm@@2022")`
- `services/inference/src/utils/read_env_var.py` line 13: `RABBIT_PASSWORD: str = os.getenv('RABBIT_PASSWORD', 'SisSurface@@2022')`
- `services/inference/src/utils/read_env_var.py` line 69: `REDIS_PASSWORD: str = os.getenv('REDIS_PASSWORD', 'SisSurface@@2022')`
- Root-level GCP service account key: `sis-surface-30d060b05a4c.json`
- Inference service has a `secrets/` directory

**Scope of Work**:
1. Audit all services for hardcoded credentials (grep for `@@2022`, `password`, `secret` across all `read_env_var.py`, `config.py`, `.env` files)
2. Remove default password values from all `os.getenv()` calls -- replace with `None` and fail-fast on missing
3. Create `.env.example` files for each service with placeholder values
4. Move GCP JSON key out of repo, use GCP Workload Identity or Secret Manager
5. Add `secrets/` and `*.json` key patterns to `.gitignore`
6. Rotate all production credentials (RabbitMQ, Redis, PostgreSQL)
7. Run `git filter-branch` or `bfg` to scrub credentials from git history

**Repositories Involved**: All Python services (inference, pixel-to-object, length-measure, database-writer, image-saver, result, etc.), root repo

**Testing Effort**: Manual verification that services start with env vars set; no automated tests needed (2-3 manual smoke tests per service)

**Testing Infrastructure**: N/A -- operational task

**Dependencies**: Requires production access to rotate credentials; coordinate with deployment team

**Hours Estimate**: 12h

---

### TEST-01: Add Automated Test Suites for All Python Services

**Current State**:
- `database-writer/`: Has `pytest.ini`, `tests/` dir with existing tests
- `pixel-to-object/`: Has `tests/` with `test_config_validators.py`, `test_config_manager.py`, filtering tests (`test_defect_track_manager.py`, `test_velocity_kalman_filter.py`, `test_defect_aggregator.py`), fixture files (STL models, JSON messages). Has `.venv` with pytest installed. `visionking-pixel-to-object.req` includes `pytest`.
- `inference/`: Has `tests/` directory but contains ZERO Python test files (only `obb_results/`, `output/`, `__pycache__/`). Has `src/testing/factory.py` which is a manual test harness, not pytest.
- `length-measure/`: Has `test/` (note: singular) with `sample-images/`, `tables/`, `logs/` -- test data only, no test code. Has `vklm-test.py` at root which is a manual script.
- `result/`: Has `tests/` dir but appears empty except possibly `manual_validation/`
- `image-saver/`, `visionking-defect-aggregator/`, `storage-monitor/`, `bd-sis-surface/`, `visualizer/`: No test infrastructure

**Scope of Work** (per service):
- Create `pytest.ini` or `pyproject.toml` with pytest config
- Create `conftest.py` with shared fixtures (mock RabbitMQ, mock Redis)
- Write unit tests for business logic (not I/O):
  - **inference**: `inference_utils.py` (filter_boxes, is_box_inside), `result_handler.py` (has_defect, transform_crop_to_boxes), `batch_config.py`
  - **length-measure**: `edge_finder.py` (moving_median, apply_mask_expand_and_interpolate, _get_contiguous_regions), `slicer.py` (calcular_pecas_visiveis), `processing.py` (process_pecas_with_filling, calculate_lengths)
  - **result**: message processing logic
  - **image-saver**: file save logic
  - **database-writer**: already has tests, extend coverage

**Repositories Involved**: inference, length-measure, result, image-saver, database-writer, visionking-defect-aggregator, storage-monitor, bd-sis-surface

**Testing Effort**: ~15-20 test files, ~150-200 test cases total across all services

**Testing Infrastructure**:
- database-writer: pytest exists and works
- pixel-to-object: pytest exists and works
- All others: need `pytest` added to requirements, `pytest.ini` created

**Dependencies**: SEC-01 should go first (tests need mock credentials, not real ones)

**Hours Estimate**: 60h

---

### TEST-02: Add Test Infrastructure for C++ Services

**Current State**:
- `camera-acquisition/`: Uses Meson build system (`meson.build`). Has `tests/unit_tests/` with 3 existing C++ test files (`test_encoding.cpp`, `test_frame_rate.cpp`, `test_functions.cpp`) and `tests/integration_tests/integration_test.cpp`. However, no test target is defined in `meson.build` -- these files are NOT compiled or run.
- `controller/`: C++ service, has `cloudbuild.yaml` but no test files found
- `plc-monitor/`: C++ service, no test files found

**Scope of Work**:
1. Add Google Test (gtest) dependency to `meson.build` for camera-acquisition
2. Create `meson.build` test target linking existing test files against gtest
3. Write additional unit tests for utility functions (format_conversion, camera_data, frame_data)
4. Add gtest to controller and plc-monitor
5. Add test step to `cloudbuild.yaml` (run tests before Docker build)

**Repositories Involved**: camera-acquisition, controller, plc-monitor

**Testing Effort**: ~8-10 test files, ~40-60 test cases

**Testing Infrastructure**: Meson has native gtest support via `dependency('gtest')`. Need to add gtest to Docker build images or install in CI.

**Dependencies**: None

**Hours Estimate**: 30h

---

### GIT-01: Resolve Uncommitted Submodule Changes

**Current State**: 5 submodules with uncommitted/unpushed work (controller, frontend, length-measure, plc-monitor, result)

**Scope of Work**:
1. For each submodule: `cd` in, check branch, review changes, commit or stash
2. Update parent repo submodule references
3. Push all submodule commits to their remotes

**Repositories Involved**: Root repo + controller, frontend, length-measure, plc-monitor, result

**Testing Effort**: None -- git housekeeping

**Testing Infrastructure**: N/A

**Dependencies**: None

**Hours Estimate**: 3h

---

### CICD-01: Add Cloud Build Configs to Missing Services

**Current State**:
- **Have cloudbuild.yaml**: camera-acquisition, controller, visualizer, result, plc-monitor-eip, image-saver, plc-monitor, bd-sis-surface, database-writer, inference, storage-monitor, pixel-to-object (in `infra/gcp/`)
- **Missing**: length-measure (has Dockerfile in `infra/docker/`), backend (NestJS, has Dockerfiles in `infra/docker/`), frontend (has Dockerfiles in `infra/docker/`)

**Scope of Work**:
1. Create `cloudbuild.yaml` for length-measure, backend, frontend
2. Standardize format (some use `E2_MEDIUM`, camera-acquisition uses `E2_HIGHCPU_8`)
3. Ensure all reference correct Dockerfile paths and Artifact Registry URLs

**Repositories Involved**: length-measure, backend, frontend

**Testing Effort**: 1 test build per service on GCP

**Testing Infrastructure**: GCP Cloud Build already configured for other services

**Dependencies**: GIT-01 (submodules must be clean)

**Hours Estimate**: 6h

---

### CICD-02: Implement Docker Build Caching and Multi-Stage Optimization

**Current State**: camera-acquisition's `cloudbuild.yaml` already uses `--cache-from` and `DOCKER_BUILDKIT=1`. database-writer does NOT use `--cache-from`. Most services lack build caching.

**Scope of Work**:
1. Add `--cache-from` to all `cloudbuild.yaml` files
2. Enable `DOCKER_BUILDKIT=1` in all builds
3. Convert Dockerfiles to multi-stage where applicable (separate build stage from runtime)
4. Pin base images to specific digests for reproducibility

**Repositories Involved**: All services with Dockerfiles

**Testing Effort**: Build time benchmarks before/after

**Testing Infrastructure**: N/A

**Dependencies**: CICD-01 (all services need cloudbuild.yaml first)

**Hours Estimate**: 16h

---

### DOC-01: Add README.md to All Services Missing Documentation

**Current State**: Services with README: camera-acquisition, inference, length-measure, pixel-to-object, result, database-writer, backend. Missing: image-saver, visionking-defect-aggregator, controller, plc-monitor, plc-monitor-eip, bd-sis-surface, visualizer, storage-monitor, setup

**Scope of Work**: Create README.md for each missing service covering: purpose, architecture, env vars, build/run instructions, API/message format

**Repositories Involved**: ~8 services

**Testing Effort**: N/A

**Dependencies**: None

**Hours Estimate**: 12h

---

### DOC-02: Create Deployment Runbook

**Scope of Work**: Create comprehensive deployment documentation covering topology workflow, troubleshooting, backup/recovery, service dependency graph

**Hours Estimate**: 8h

---

### HEALTH-01: Add Docker Healthchecks to All Services

**Current State**: Only backend-ds has a healthcheck. 16 services unmonitored.

**Scope of Work**:
1. Python services: add `/health` endpoint or healthcheck script
2. C++ services: add simple TCP/process check
3. NestJS services: add `/health` endpoint using `@nestjs/terminus`
4. Add `HEALTHCHECK` instruction to all Dockerfiles

**Repositories Involved**: All 17 services

**Testing Effort**: 1 test per service verifying health endpoint

**Dependencies**: None

**Hours Estimate**: 16h

---

## Medium Priority

### CLEAN-01: Remove Large Artifacts and Organize Untracked Files

**Current State**: `images-lab-vk-20251108T002923Z-1-001.zip` (300MB+) in repo root, `legacy/` directory (2GB+), 5889 `__pycache__` directories

**Scope of Work**: Delete zip, archive legacy/, add `.gitignore` rules for `__pycache__`, `*.pyc`, run `bfg` to clean history

**Hours Estimate**: 4h

---

### CLEAN-02: Implement Model Artifact Management

**Current State**: Inference repo is 7.5GB with models stored in git. `MODEL_PATH` defaults to `models/weights_03_04_2025_17_31_3a_campanha.pt`

**Scope of Work**: Set up DVC or GCS bucket for model storage, replace model files with DVC pointers, update inference Dockerfile to pull models at build/runtime

**Hours Estimate**: 12h

---

### INFRA-01: Implement Centralized Logging

**Hours Estimate**: 16h

### INFRA-02: Standardize Network Configuration

**Hours Estimate**: 8h

### OPT-01: Add RabbitMQ Dead-Letter Queues

**Hours Estimate**: 8h

### OPT-02: Add Resource Monitoring

**Hours Estimate**: 12h

### QUAL-01: Standardize Error Handling and Logging

**Hours Estimate**: 20h

### QUAL-02: Add API Documentation (OpenAPI/Swagger)

**Current State**: Backend is NestJS (`services/backend/`). Has `nest-cli.json`, `eslint.config.mjs`, `package.json`. No Swagger setup.

**Hours Estimate**: 6h

---

## Product Features

### FEAT-01: Implement Sophisticated Config and Testing for pixel-to-object

**Current State** (verified from source code):

The `pixel-to-object` service is the most mature service in terms of testing and configuration:

- **Core module**: `src/transformer.py` -- `CoordinateTransformer` class handles 2D pixel to 3D point projection using ray-scene intersection with trimesh. Supports loading 3D models (STL/OBJ/PLY), camera intrinsics, initial poses.
- **Server**: `src/server.py` -- `TransformationServer` processes RabbitMQ messages, handles ROI filtering, bounding box/polygon projections, Kalman filtering for velocity correction and defect tracking.
- **Config management**: `src/utils/config_manager.py` -- Redis-first config loading with file fallback, automatic migration, hot-reload via polling, change callbacks. Already supports camera intrinsics, initial poses, ROIs.
- **Validation**: `src/utils/config_validators.py` -- Validates camera intrinsics (3x3 matrix, positive focal lengths, reasonable principal point, 5 distortion coefficients), pose matrices (4x4, orthogonal rotation, det=1), ROI definitions.
- **Filtering**: `src/filtering/` -- Sequence manager, velocity Kalman filter, defect track manager, defect aggregator, position interpolator, state persistence.
- **Existing tests**: `tests/test_config_validators.py`, `tests/test_config_manager.py`, `tests/filtering/test_defect_track_manager.py`, `tests/filtering/test_velocity_kalman_filter.py`, `tests/filtering/test_defect_aggregator.py`. Fixtures include STL models, JSON messages.
- **Requirements**: numpy, opencv, trimesh, pyembree, scipy, aio-pika, redis, pytest (in `visionking-pixel-to-object.req`)
- **CI**: Has `infra/gcp/cloudbuild.yaml` and `infra/gcp/cloudbuild-dev.yaml`
- **No test step in CI**: cloudbuild.yaml only builds Docker image

**Scope of Work**:

1. **Configuration parameter exposure** (new):
   - Create a config schema for all tunable parameters currently hardcoded as env vars (ROI_OVERLAP_THRESHOLD, PROJECT_VERTICES, Kalman filter params)
   - Add these to ConfigManager with Redis keys and validation
   - Create an admin API or CLI to update config parameters at runtime

2. **Edge case handling**:
   - `transform_pixel_to_3d`: Handle degenerate ray directions (near-parallel to surface)
   - `create_mask_from_3d_rois`: Handle camera behind object (negative projection)
   - `filter_defects_by_roi`: Handle zero-area bounding boxes (already partially handled but needs robust edge handling for negative coords)
   - `server.py` line 266: `obj_displacement` is referenced before assignment when Kalman is enabled but `_position_for_projection` missing

3. **Test coverage expansion**:
   - `transformer.py`: Test ray-mesh intersection with known geometries (plane at known distance), test get_absolute_poses with identity transforms, test with multiple cameras
   - `server.py`: Test message parsing (clean_message), test ROI filtering pipeline, test Kalman integration path
   - `calibration/`: Test intrinsics loading, test pose loading
   - Integration tests with fixture messages flowing through the full pipeline

4. **CI test integration**: Add pytest step before Docker build in `cloudbuild.yaml`

**Files to Create/Modify**:
- Modify: `src/server.py` (fix line 266 bug), `src/transformer.py` (edge case guards)
- Modify: `src/utils/config_manager.py` (add parameter config methods)
- Create: `tests/test_transformer.py` (~15 test cases)
- Create: `tests/test_server.py` (~10 test cases, needs mocked RabbitMQ)
- Create: `tests/conftest.py` (shared fixtures)
- Modify: `infra/gcp/cloudbuild.yaml` (add test step)

**Repositories Involved**: pixel-to-object

**Testing Effort**: ~35-40 new test cases across 3-4 new test files. Existing 5 test files provide a good foundation.

**Testing Infrastructure**: pytest is already installed and configured. Tests run locally. Need to add pytest step to CI.

**Dependencies**: None (service is self-contained)

**Hours Estimate**: 32h

---

### FEAT-02: Implement and Test All Model Combinations for vk-inference

**Current State** (verified from source code):

- **Engine**: `src/inference_processing/inference_engine.py` -- `InferenceEngine` class loads a YOLO model via `ultralytics` library. Currently hardcoded to **classification** workflow:
  - `warm_up_model()` accesses `result.probs.data` (classification-specific attribute)
  - `predict()` processes results assuming `probs` attribute exists
  - `ResultHandler.process_single_prediction()` also accesses `prediction.probs.top1` and `prediction.probs.top1conf`
- **Model path**: Single model path via `MODEL_PATH` env var, defaults to `models/weights_03_04_2025_17_31_3a_campanha.pt`
- **Image processing**: `src/image_processing/` has image_loader, image_converter, image_filter (background, brightness, no_information filters), image_processor -- handles slicing/cropping
- **Batch processing**: `src/batch_processing/` has batch_processor, batch_config, batch_optimizer, performance_monitor
- **Result handling**: `src/utils/result_handler.py` -- `transform_crop_to_boxes` creates bounding box output but only for classification results (defect/no-defect per slice)
- **YOLO task types NOT implemented**: detection (boxes output), segmentation (masks output), OBB (oriented bounding boxes)
- **Tests**: ZERO test files. `tests/` directory contains only output artifacts and `__pycache__`. `src/testing/factory.py` is a manual test harness, not automated tests.
- **Has cloudbuild.yaml**: Yes, but no test step

**Scope of Work**:

1. **Refactor InferenceEngine for multiple task types**:
   - Create abstract base + task-specific implementations:
     - `ClassificationEngine` (current behavior)
     - `DetectionEngine` (process `result.boxes` for bounding box detection)
     - `SegmentationEngine` (process `result.masks` for instance segmentation)
     - `OBBEngine` (process `result.obb` for oriented bounding boxes)
   - Factory pattern to instantiate correct engine based on `MODEL_TASK` env var
   - Update `warm_up_model()` per task type (detection warm-up should not access `.probs`)

2. **Refactor ResultHandler for multiple output types**:
   - Classification: current `probs.top1` / `top1conf` output
   - Detection: extract `boxes.xyxy`, `boxes.conf`, `boxes.cls`
   - Segmentation: extract masks + boxes
   - OBB: extract `obb.xywhr`, `obb.conf`, `obb.cls`
   - Unified output format for downstream services (pixel-to-object expects `defects` dict with `position` key as bbox)

3. **ONNX support** (if needed):
   - Ultralytics YOLO already supports ONNX export/inference natively
   - Add `MODEL_FORMAT` env var (pytorch/onnx/tensorrt)
   - TensorRT cache already exists (`tensorrt_cache/` directory)

4. **Testing**:
   - Create mock YOLO results for each task type
   - Test InferenceEngine prediction pipeline per task type
   - Test ResultHandler output formatting per task type
   - Test batch processing with mixed task types
   - Test filter_boxes and is_box_inside utilities

**Files to Create/Modify**:
- Refactor: `src/inference_processing/inference_engine.py` (split into base + task classes)
- Refactor: `src/utils/result_handler.py` (add task-specific result processing)
- Modify: `src/utils/read_env_var.py` (add `MODEL_TASK`, `MODEL_FORMAT`)
- Create: `src/inference_processing/engines/classification.py`
- Create: `src/inference_processing/engines/detection.py`
- Create: `src/inference_processing/engines/segmentation.py`
- Create: `src/inference_processing/engines/obb.py`
- Create: `tests/conftest.py`
- Create: `tests/test_inference_engine.py` (~20 test cases)
- Create: `tests/test_result_handler.py` (~15 test cases)
- Create: `tests/test_inference_utils.py` (~10 test cases)
- Create: `tests/test_batch_processing.py` (~10 test cases)
- Modify: `cloudbuild.yaml` (add test step)

**Repositories Involved**: inference

**Testing Effort**: ~55-65 test cases across 4-5 test files

**Testing Infrastructure**: No pytest exists. Need to:
- Add pytest to requirements
- Create `pytest.ini`
- Mock YOLO model responses (cannot run real GPU inference in CI)
- Use `unittest.mock` to patch model loading

**Dependencies**: CLEAN-02 (model management) should ideally go first to avoid storing test model weights in git. However, tests can use mocked models.

**Hours Estimate**: 48h

---

### FEAT-03: Refine length-measure

**Current State** (verified from source code):

- **Core algorithm**: `src/edge_finder.py` -- `detectar_extremidade_por_derivada()` detects steel bar edges using:
  1. Extract pixel intensity profile (horizontal or vertical strip averaging)
  2. Saturation masking and interpolation (`apply_mask_expand_and_interpolate`)
  3. Moving median smoothing
  4. First derivative + moving average smoothing
  5. Dynamic threshold (max of fixed threshold, STD_MULTIPLIER * std_dev of derivative)
  6. Bar side detection (which side has lower intensity = background)
  7. Edge type classification (start/end based on lamination direction)

- **Processing pipeline**: `src/processing.py` -- `process_pecas_and_frames()` does:
  1. Forward pass through frames to find bar START edges
  2. Backward pass to find bar END edges
  3. Length calculation: `comprimento = pos_end - pos_start + mm_end - mm_start`

- **Slicer**: `src/slicer.py` -- `calcular_pecas_visiveis()` determines which bars are visible in a frame based on cumulative widths and pixel-to-mm factor `k`

- **Configuration**: `src/config.py` -- All algorithm parameters configurable via env vars (WINDOW_WIDTH=10, THRESHOLD_FIXO=0.5, STD_MULTIPLIER=6.0, SATURATION_THR=250, etc.)

- **Known issues**:
  - Hardcoded credential in `config.py` line 13 (`DB_PASSWORD = "skm@@2022"`)
  - `edge_finder.py` `__main__` block calls old function signature (line 630-643) incompatible with current code
  - `processing.py` line 279: `return` instead of `continue` when image not found (stops ALL processing)
  - No calibration validation -- assumes `k` factor is always correct
  - No multi-camera fusion for edge detection

- **Test data**: `test/sample-images/` has bar images, `test/tables/` has CSV test data. But NO automated test code.
- **CI**: No `cloudbuild.yaml`. Has Dockerfiles in `infra/docker/production/` and `infra/docker/develop/`

**Scope of Work**:

1. **Bug fixes**:
   - Fix `processing.py` line 279: change `return` to `continue`
   - Fix `edge_finder.py` `__main__` to match current function signature
   - Fix `config.py` hardcoded password

2. **Accuracy improvements**:
   - Add sub-pixel edge detection (interpolate around max derivative point for sub-pixel accuracy)
   - Add multi-scale analysis (run detection at multiple moving_median_window sizes, vote)
   - Add confidence scoring for detected edges (ratio of max derivative to threshold)
   - Add calibration validation (check k factor against known reference measurements)

3. **Robustness improvements**:
   - Handle frames where bar occupies entire field of view (no edge visible)
   - Handle very thin bars where window_width exceeds bar width (already partially handled)
   - Add timeout/retry for database operations in `db_operations.py`

4. **Testing**:
   - Unit tests for `edge_finder.py` pure functions (already have good docstrings with examples)
   - Unit tests for `slicer.py` with known bar configurations
   - Unit tests for `processing.py` with mock DataFrames
   - Create synthetic test images (gradient + edge) for deterministic edge detection testing
   - Regression tests using the `samples[]` list in `edge_finder.py` (known expected values)

**Files to Create/Modify**:
- Fix: `src/processing.py` (line 279 bug)
- Fix: `src/config.py` (remove hardcoded password)
- Modify: `src/edge_finder.py` (sub-pixel refinement, confidence scoring)
- Create: `tests/test_edge_finder.py` (~20 test cases)
- Create: `tests/test_slicer.py` (~10 test cases)
- Create: `tests/test_processing.py` (~10 test cases)
- Create: `tests/conftest.py` (fixtures for synthetic images, mock DataFrames)
- Create: `pytest.ini`
- Create: `cloudbuild.yaml`

**Repositories Involved**: length-measure

**Testing Effort**: ~40 test cases across 3 test files. Many pure functions with good docstrings already.

**Testing Infrastructure**: No pytest exists. Need:
- Add pytest, pytest-cov to requirements
- Create `pytest.ini`
- Synthetic test images (numpy arrays saved as .bin) for deterministic testing

**Dependencies**: SEC-01 (hardcoded password)

**Hours Estimate**: 36h

---

### FEAT-04: Specifications for Sealer Measure

**Current State**:
- This is a NEW feature -- no existing code. The measurement pipeline exists for **length measurement** of steel bars (camera-acquisition -> inference -> pixel-to-object -> result -> database-writer).
- The sealer measure task requires defining specifications for a new measurement type, likely for sealant bead inspection on vehicle bodies (Carrocerias profile).
- Existing pipeline provides the architectural blueprint:
  - Camera acquisition captures frames
  - Inference detects features/defects
  - pixel-to-object transforms 2D detections to 3D coordinates
  - result service aggregates and stores

**Scope of Work**:

1. **Requirements definition** (specification document):
   - Measurement type: sealant bead width, continuity, position accuracy
   - Required accuracy: typically +/- 0.5mm for automotive sealer
   - Camera requirements: resolution, frame rate, lighting
   - Inspection speed: parts per minute
   - Defect types: gaps, thin spots, over-application, misalignment

2. **Architecture design**:
   - Determine if existing inference service can handle sealer detection (likely needs segmentation model, not just classification)
   - Design measurement extraction from segmentation masks (bead width = perpendicular distance across mask)
   - Define new message schema for sealer measurements
   - Define database schema for measurement storage

3. **Proof of concept**:
   - Train/test segmentation model on sealer bead images
   - Implement width measurement from segmentation mask
   - Validate accuracy against known-width sealant beads

**Repositories Involved**: New specification doc in `doc/`, potentially new service or extension of inference + result

**Testing Effort**: This is primarily a specification task. PoC testing would be ~10 test cases for measurement extraction algorithm.

**Testing Infrastructure**: Needs test images of sealant beads with ground truth measurements

**Dependencies**: FEAT-02 (segmentation support in inference) is a prerequisite for implementation

**Hours Estimate**: 24h (specification) + 32h (PoC implementation) = 56h total

---

### FEAT-05: Add 3D Camera Capabilities to camera-acquisition

**Current State** (verified from source code):

- **Language**: C++20 with Meson build system
- **Camera SDK**: Aravis 0.8+ (GigE Vision / GenICam library)
- **Dependencies**: aravis-0.8, opencv4, libcurl, gstreamer-1.0, redis++, jsoncpp, libuuid
- **Architecture**:
  - `src/main.cpp`: CLI entry point with getopt flags (-t test, -c config, -f fps, -s streaming, -v visualizer, -i trigger, -e cache, -n camera_name)
  - Uses `genicam::Utils::get_avaible_cameras()` for camera discovery (Aravis)
  - `Streaming` class handles camera lifecycle
  - `src/camera/configurations/general/`: Per-feature configuration (binning, exposure, gain, fps, trigger, pixel_format, dimensions, etc.)
  - `src/camera/configurations/gige.cpp`: GigE-specific config
  - `src/camera/acquisition.cpp`: Frame acquisition loop
  - `src/utils/streaming.cpp`: Frame streaming/publishing
  - `src/utils/cache_redis.cpp`: Redis caching
  - Outputs frames via Redis + RabbitMQ to downstream services

- **Current camera support**: 2D GigE Vision cameras only (standard Aravis GenICam)
- **No 3D support**: No depth data, no point cloud, no structured light, no ToF
- **Test files exist** but are not compiled: `tests/unit_tests/` (3 files), `tests/integration_tests/` (1 file)
- **CI**: `cloudbuild.yaml` exists, builds Docker image only

**Scope of Work**:

1. **3D camera SDK integration**:
   - Determine target 3D camera technology:
     - **Structured light** (e.g., Photoneo, Zivid): typically have their own SDK
     - **Time-of-Flight** (e.g., IFM O3D, Basler ToF): some support GenICam
     - **Stereo** (e.g., Intel RealSense): has librealsense SDK
   - If GenICam-compatible 3D camera: extend existing Aravis code to handle depth/3D data components
   - If proprietary SDK: create a new camera driver abstraction

2. **Depth data pipeline**:
   - New data structures for depth maps (2D array of float32 distances)
   - Point cloud generation (depth + intrinsics -> 3D XYZ)
   - Modify frame_data to carry both RGB + depth
   - Modify Redis cache to store depth data (compressed)
   - Modify RabbitMQ message schema to include depth metadata

3. **Configuration additions**:
   - `src/camera/configurations/general/camera_type.cpp`: Add 3D camera type enum
   - New config for depth parameters (range, resolution, filtering)
   - 3D-specific calibration data

4. **Integration with downstream**:
   - pixel-to-object already works with 3D models and ray casting -- could leverage real depth data instead of ray-intersection estimation
   - Need to define message format for depth frames

**Files to Create/Modify**:
- Create: `src/camera/configurations/depth/` (new directory for 3D config)
- Create: `include/types/depth_data.hpp`
- Modify: `src/utils/frame_data.cpp` (add depth field)
- Modify: `src/camera/acquisition.cpp` (handle depth data acquisition)
- Create: `src/camera/drivers/structured_light.cpp` (or appropriate 3D driver)
- Modify: `meson.build` (add new source files, new dependencies)
- Modify: `include/camera.hpp` (add 3D camera interface)

**Repositories Involved**: camera-acquisition, pixel-to-object (consumer)

**Testing Effort**: ~20 test cases for data structures and pipeline, requires hardware for integration testing

**Testing Infrastructure**: Unit tests can use synthetic depth data. Integration tests REQUIRE physical 3D camera hardware. Add gtest to meson.build (addresses TEST-02 partially).

**Dependencies**: TEST-02 (need test infrastructure first), hardware procurement (3D camera), SDK evaluation

**Hours Estimate**: 80h (software) + hardware procurement time

---

### FEAT-06: Advance Integrated Testing Suite

**Current State** (verified across all services):

| Service | Test Framework | Test Files | Test Cases (est.) | CI Test Step |
|---------|---------------|------------|-------------------|--------------|
| pixel-to-object | pytest | 5 files | ~30 | No |
| database-writer | pytest | exists | ~10 | No |
| inference | None | 0 | 0 | No |
| length-measure | None | 0 | 0 | No |
| camera-acquisition | None (gtest files exist, not compiled) | 3+1 unit/integration | 0 (not built) | No |
| result | None | 0 | 0 | No |
| All others | None | 0 | 0 | No |

**Cross-service testing**: ZERO integration tests exist. Each service is tested (if at all) in isolation.

**Message flow**: camera-acquisition -> (Redis+RabbitMQ) -> inference -> (RabbitMQ) -> pixel-to-object -> (RabbitMQ) -> result -> (RabbitMQ) -> database-writer -> (PostgreSQL)

**Scope of Work**:

1. **Test environment setup**:
   - Docker Compose test profile with all infrastructure (RabbitMQ, Redis, PostgreSQL) in containers
   - Pre-populated test database with known schemas
   - Test RabbitMQ with known queue topology

2. **End-to-end test harness**:
   - Python test runner that:
     a. Publishes a synthetic frame message to the first queue (simulating camera-acquisition output)
     b. Waits for message to flow through all services
     c. Verifies final database entry matches expected output
   - Use testcontainers-python for spinning up infrastructure

3. **Per-hop integration tests**:
   - camera-acq -> inference: verify frame message format compatibility
   - inference -> pixel-to-object: verify defect message format compatibility
   - pixel-to-object -> result: verify enriched message format compatibility
   - result -> database-writer: verify database write correctness

4. **Contract tests**:
   - Define JSON schemas for each inter-service message
   - Validate that producer output matches consumer expectations
   - Use `tests/fixtures/messages/` in pixel-to-object as reference (already has sample_input_message.json, sample_output_message.json)

5. **CI integration**:
   - Create root-level `cloudbuild-integration-tests.yaml`
   - Run integration tests nightly or on release branches

**Files to Create**:
- Create: root-level `tests/` directory
- Create: `tests/integration/docker-compose.test.yml`
- Create: `tests/integration/conftest.py`
- Create: `tests/integration/test_inference_pipeline.py`
- Create: `tests/integration/test_pixel_to_object_pipeline.py`
- Create: `tests/integration/test_full_pipeline.py`
- Create: `tests/contracts/` (JSON schema definitions per message type)
- Create: `tests/contracts/test_message_contracts.py`
- Create: `cloudbuild-integration-tests.yaml`

**Repositories Involved**: Root repo + all services (read message schemas)

**Testing Effort**: ~30-40 test cases across 5-6 test files

**Testing Infrastructure**: Need Docker Compose test profile, testcontainers-python, JSON schema validators. Significant setup effort.

**Dependencies**: TEST-01 (individual service tests first), FEAT-01 (pixel-to-object testing), FEAT-02 (inference testing), FEAT-03 (length-measure testing)

**Hours Estimate**: 48h

---

## Low Priority

### TOOL-01: Integrate Data Science Pipeline into CI/CD

**Current State**: `ds/` folder in repo root, isolated from CI

**Hours Estimate**: 12h

### TOOL-02: Complete and Document Cloud Pipeline Toolkit

**Current State**: `cloud-pipeline-draft/` incomplete

**Hours Estimate**: 8h

### DOC-03: Create Developer Onboarding Guide

**Hours Estimate**: 6h

---

## Estimates Summary

| Task ID | Category | Priority | Hours | Dependencies |
|---------|----------|----------|-------|-------------|
| SEC-01 | Security | High | 12 | Production access |
| TEST-01 | Testing | High | 60 | SEC-01 |
| TEST-02 | Testing | High | 30 | None |
| GIT-01 | Git | High | 3 | None |
| CICD-01 | CI/CD | High | 6 | GIT-01 |
| CICD-02 | CI/CD | High | 16 | CICD-01 |
| DOC-01 | Docs | High | 12 | None |
| DOC-02 | Docs | High | 8 | None |
| HEALTH-01 | Infra | High | 16 | None |
| CLEAN-01 | Cleanup | Medium | 4 | None |
| CLEAN-02 | Cleanup | Medium | 12 | None |
| INFRA-01 | Infra | Medium | 16 | None |
| INFRA-02 | Infra | Medium | 8 | None |
| OPT-01 | Optimization | Medium | 8 | None |
| OPT-02 | Monitoring | Medium | 12 | None |
| QUAL-01 | Quality | Medium | 20 | None |
| QUAL-02 | Quality | Medium | 6 | None |
| **FEAT-01** | **Feature** | **High** | **32** | **None** |
| **FEAT-02** | **Feature** | **High** | **48** | **CLEAN-02 (ideal)** |
| **FEAT-03** | **Feature** | **High** | **36** | **SEC-01** |
| **FEAT-04** | **Feature** | **Medium** | **56** | **FEAT-02** |
| **FEAT-05** | **Feature** | **Medium** | **80** | **TEST-02, hardware** |
| **FEAT-06** | **Feature** | **Medium** | **48** | **TEST-01, FEAT-01/02/03** |
| TOOL-01 | Tooling | Low | 12 | None |
| TOOL-02 | Tooling | Low | 8 | None |
| DOC-03 | Docs | Low | 6 | None |
| | | **TOTAL** | **564** | |

### Recommended Execution Order (Critical Path)

```
Phase 1 (Foundation):   GIT-01 -> SEC-01 -> CICD-01 (27h)
Phase 2 (Testing):      TEST-01 + TEST-02 in parallel (90h)
Phase 3 (Features):     FEAT-01 + FEAT-03 in parallel (68h)
Phase 4 (Inference):    FEAT-02 (48h)
Phase 5 (Integration):  FEAT-06 (48h)
Phase 6 (Advanced):     FEAT-04 + FEAT-05 (136h)
Phase 7 (Polish):       CICD-02, HEALTH-01, DOC-01/02, remaining Medium/Low (142h)
```

### Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| FEAT-05 hardware procurement delays | Blocks 3D camera work entirely | Start hardware eval in Phase 1 |
| Inference GPU dependency for tests | Cannot run real model tests in CI | Mock-based testing strategy |
| Credential rotation disrupts production | Downtime during SEC-01 | Blue-green credential rotation |
| 7.5GB inference repo slows all git operations | Developer productivity | Prioritize CLEAN-02 |
