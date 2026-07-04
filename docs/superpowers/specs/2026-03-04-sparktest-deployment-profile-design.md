# SparkTest — VisionKing Deployment Profile Design

**Date:** 2026-03-04<br>
**Status:** Approved<br>
**Product:** VisionKing<br>
**Approach:** Hybrid — SparkTest as a third VisionKing deployment profile (alongside Laminacao and Carrocerias)

---

## Purpose

Portable steel alloy identification via spark testing. An operator grinds a steel sample while wearing a helmet-mounted WiFi action camera (DJI Osmo Action 4 or similar). The camera streams RTSP video over the local WiFi network to a Linux server running VisionKing's SparkTest profile. An ML model classifies the spark pattern to identify the steel alloy, and the result is sent to the operator's tablet.

## Operator Workflow

1. Operator inputs **expected material** on tablet (manual entry or camera OCR of label)
2. Presses **Start** → camera begins streaming, server captures frames
3. Grinds the steel sample (fagulhamento)
4. Presses **Analyze** → ends capture (or auto-timeout at ~15s)
5. Server analyzes captured frames with ML model (~3s)
6. Tablet displays result: **identified alloy + APROVADO / REPROVADO**

## Hardware

- **Camera:** DJI Osmo Action 4 (or similar WiFi camera with RTSP support and WiFi client mode)
- **Server:** Linux PC on same WiFi/LAN network, with GPU for inference
- **Tablet:** Android/iOS tablet running the PWA frontend
- **Mounting:** Helmet mount for the action camera

## Service Map

| VisionKing Service | SparkTest | Notes |
|---|---|---|
| camera-acquisition (C++/GigE) | **Replaced** → `wifi-camera-acquisition` (Python) | RTSP ingestion via ffmpeg/OpenCV |
| controller (C++) | **Replaced** → `spark-test-controller` (Python/FastAPI) | Test lifecycle via REST API |
| plc-monitor (C++) | **Not needed** | No PLC |
| image-saver | **Reused as-is** | Same Redis HSET polling interface |
| inference | **Reused, new model** | Same ONNX/TensorRT runtime, spark classification model |
| database-writer | **Reused, adapted** | New queue + insert function for spark test results |
| pixel-to-object | **Not needed** | No 3D projection |
| length-measure | **Not needed** | No bar length tracking |
| result | **Not needed** | Replaced by spark-test-controller |
| backend (NestJS) | **New** → `backend-sparktest` | Simplified API for tablet |
| frontend (Angular) | **New** → `frontend-sparktest` | Tablet-optimized PWA |
| PostgreSQL | **Reused** | New schema (materials, spark_tests, spark_test_frames) |
| Redis/KeyDB | **Reused** | DB0 frames, DB1 test state |
| RabbitMQ | **Reused** | New queue names |

**Net result:** 4 new/replaced services, 4 reused, 5 dropped.

## New Services

### 1. wifi-camera-acquisition (Python)

Connects to N configured RTSP streams from WiFi cameras. On command from spark-test-controller, extracts frames at configurable FPS (e.g., 5-10 fps) and writes them to Redis DB0 as HASHes — same format as existing camera-acquisition (image binary + metadata fields). Stops extraction on command.

- **Env prefix:** `WIFI_CAM_`
- **Config:** JSON per camera (name, RTSP URL, credentials, resolution, target FPS)
- **Dependencies:** ffmpeg (subprocess) or OpenCV VideoCapture, Redis

### 2. spark-test-controller (Python/FastAPI)

Orchestrates each test cycle. REST API with endpoints for test lifecycle management. Manages state machine: `IDLE → CAPTURING → ANALYZING → COMPLETE/FAILED`. Generates sample UUIDs, coordinates camera start/stop via Redis pub/sub, publishes frame batches to RabbitMQ, waits for inference results, and compares identified vs expected material.

- **Env prefix:** `SPARK_`
- **Endpoints:** `POST /tests/start`, `POST /tests/{id}/analyze`, `GET /tests/{id}/result`, `GET /tests`, `GET /cameras/status`
- **Dependencies:** FastAPI, Redis, RabbitMQ (aio-pika), PostgreSQL

### 3. backend-sparktest (NestJS)

API gateway for the tablet frontend. Proxies test operations to spark-test-controller. CRUD for materials catalog, test history, operator management. WebSocket for real-time test status updates.

- **Dependencies:** NestJS, PostgreSQL, WebSocket

### 4. frontend-sparktest (Angular PWA)

Tablet-optimized touch interface. Screens: material input (keyboard + camera OCR), capture control (Start/Analyze buttons), result display (alloy + pass/fail with color coding), test history list. Dark theme. Offline-capable PWA.

## Database Schema

```sql
CREATE TABLE materials (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE spark_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expected_material_id INT REFERENCES materials(id),
  identified_material_id INT REFERENCES materials(id),
  confidence FLOAT,
  result VARCHAR(20) CHECK (result IN ('APROVADO', 'REPROVADO', 'INCONCLUSIVO')),
  operator VARCHAR(100),
  camera_id VARCHAR(50),
  frame_count INT,
  capture_duration_ms INT,
  inference_duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE spark_test_frames (
  id SERIAL PRIMARY KEY,
  test_id UUID REFERENCES spark_tests(id),
  frame_index INT,
  image_path TEXT,
  predictions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Redis Keyspace (SparkTest)

- **DB0 (CACHE):** Frame HASHes with TTL 300s (same as VisionKing)
- **DB1 (STATE):** Test lifecycle state, active camera sessions
- **DB3 (SETTINGS):** Application configuration

## RabbitMQ Queues

| Queue | Producer | Consumer |
|-------|----------|----------|
| spark-is-queue | wifi-camera-acquisition (via image-saver) | inference |
| spark-result-queue | inference | database-writer |

## Topology Template

New topology at `topologies/sparktest-single-node.yaml`:

```yaml
profile: sparktest
nodes:
  - name: sparktest-server
    services:
      - wifi-camera-acquisition
      - spark-test-controller
      - image-saver
      - inference
      - database-writer
      - backend-sparktest
      - frontend-sparktest
    infrastructure:
      - postgres
      - redis
      - rabbitmq
cameras:
  - name: cam-operator-1
    type: wifi-rtsp
    rtsp_url: rtsp://192.168.1.100:8554/live
    target_fps: 10
```

## ML Inference Strategy

Left open for experimentation. The architecture supports three strategies:

1. **Per-frame + aggregation:** Each frame classified independently, final result is aggregation (majority vote, weighted average). Reuses VisionKing's per-frame pattern.
2. **Video clip as single input:** Feed entire capture into a video classification model (3D CNN, Video Transformer).
3. **Key-frame selection:** Extract best N frames (by spark brightness/sharpness), classify only those.

The inference service's model and pre/post-processing can be swapped without changing the pipeline.

## Implementation Phases

1. **Phase 1 — RTSP Ingestion:** `wifi-camera-acquisition` service + Redis frame writer
2. **Phase 2 — Test Controller:** `spark-test-controller` with lifecycle management + RabbitMQ integration
3. **Phase 3 — Inference Adaptation:** Configure inference service for spark classification model (placeholder model initially)
4. **Phase 4 — Database & Backend:** Schema, database-writer adaptation, `backend-sparktest` NestJS API
5. **Phase 5 — Tablet Frontend:** `frontend-sparktest` Angular PWA with operator workflow
6. **Phase 6 — Topology Integration:** Topology configurator support for SparkTest profile + deployment-runner

## Scale

Designed for N cameras, configurable per site. Each camera is a named source in config. Single-server deployment (all services on one node).
