# SPARK-01: WiFi Camera Acquisition Service

## Goal

Create a Python service at `workspaces/strokmatic/visionking/services/wifi-camera-acquisition/` that connects to RTSP streams from WiFi cameras (DJI Osmo Action 4 or similar) and writes frames to Redis in the exact same format as the existing GigE camera-acquisition service.

## Project Structure

```
wifi-camera-acquisition/
├── src/
│   ├── __init__.py
│   ├── main.py                    # Entry point: parse config, start capture loop
│   ├── rtsp_capture.py            # RTSP stream connection + frame extraction
│   ├── redis_writer.py            # Write frames to Redis DB0 as HASHes
│   ├── config.py                  # Environment variable reader (WIFI_CAM_* prefix)
│   └── models.py                  # Pydantic models for frame data, camera config
├── tests/
│   ├── __init__.py
│   ├── test_rtsp_capture.py
│   ├── test_redis_writer.py
│   └── test_config.py
├── configs/
│   └── cameras.example.json       # Example camera config (N cameras)
├── Dockerfile
├── docker-compose.yml             # Standalone compose for dev
├── requirements.txt
├── pyproject.toml
├── .env.example
├── README.md
└── .gitignore
```

## Functional Requirements

### 1. RTSP Stream Capture (`rtsp_capture.py`)

- Connect to N RTSP camera streams using OpenCV `VideoCapture(rtsp_url)`
- Each camera runs in its own thread/asyncio task
- On **start command** (via Redis pub/sub channel `sparktest:camera:commands`): begin extracting frames at configurable target FPS (default: 10)
- On **stop command**: cease frame extraction, close stream
- Handle reconnection: if RTSP stream drops, retry with exponential backoff (max 30s)
- Frame extraction: grab frame, encode as JPEG (quality 95), generate UUID

### 2. Redis Frame Writer (`redis_writer.py`)

Write each captured frame as a Redis HASH in DB 0 with TTL 300s. The hash key is the `frame_uuid`. The downstream `image-saver` service expects EXACTLY these fields (all as string values):

**Required fields (must be populated):**

| Field | Value for WiFi cameras |
|---|---|
| `image_streaming` | JPEG-encoded image bytes |
| `camera_id` | Camera index from config (e.g., "1", "2") |
| `camera_name` | Camera name from config (e.g., "DJI-Action4-Operator1") |
| `camera_serial_number` | Unique identifier from config |
| `frame_uuid` | UUID4 generated per frame |
| `frame_cell` | From `WIFI_CAM_FRAME_CELL` env var (default: "SPARK_TEST") |
| `frame_width` | Actual frame width from capture (e.g., "1920") |
| `frame_height` | Actual frame height from capture (e.g., "1080") |
| `frame_number` | Incrementing counter per camera session (as string) |
| `frame_per_second` | Calculated actual FPS (as string, e.g., "9.850000") |
| `frame_captured_at` | ISO timestamp: "2026-03-04 15:30:22.456" |
| `frame_path` | Empty string (image-saver builds this) |
| `link_camera` | "OK" if RTSP connected, "DISCONNECTED" otherwise |
| `part_uuid` | The **sample_uuid** from the spark test (received via Redis pub/sub with start command) |
| `hash` | Same as frame_uuid |
| `status` | "false" |
| `temperature` | "0" (not available from WiFi cam) |
| `water` | "false" |

**Fields set to "empty" or default (image-saver tolerates these):**

| Field | Value |
|---|---|
| `frame_deleted` | "empty" |
| `frame_created_at` | "empty" |
| `frame_updated_at` | "empty" |
| `frame_data_inspection` | "empty" |
| `frame_current_speed` | "0.000000" |
| `frame_current_position` | "0.000000" |
| `speed_correction_factor` | "0.000000" |
| `frame_info` | "{}" |
| `bar_uuid` | "empty" |
| `numero_peca_tracking` | "N/A" |
| All `*_tracking` fields | "N/A" |
| All `*_setup` fields | "N/A" |

### 3. Command Interface (Redis Pub/Sub)

Listen on Redis channel `sparktest:camera:commands` for JSON messages:

```json
{"action": "start", "sample_uuid": "550e8400-...", "cameras": ["cam-operator-1"]}
{"action": "stop", "sample_uuid": "550e8400-..."}
{"action": "status"}
```

Publish responses on `sparktest:camera:status`:

```json
{"camera_id": "cam-operator-1", "status": "capturing", "frames_captured": 42, "fps": 9.8}
{"camera_id": "cam-operator-1", "status": "idle"}
```

### 4. Camera Configuration

Read camera definitions from `WIFI_CAM_CONFIG_PATH` (default: `/app/configs/cameras.json`):

```json
[
  {
    "name": "cam-operator-1",
    "serial": "DJI-ACTION4-001",
    "camera_id": "1",
    "rtsp_url": "rtsp://192.168.1.100:8554/live",
    "target_fps": 10,
    "resolution": {"width": 1920, "height": 1080},
    "auth": {"username": "", "password": ""}
  }
]
```

### 5. Environment Variables

Prefix: `WIFI_CAM_`

```ini
WIFI_CAM_CONFIG_PATH=/app/configs/cameras.json
WIFI_CAM_FRAME_CELL=SPARK_TEST
WIFI_CAM_TTL_CACHE=300
WIFI_CAM_REDIS_HOST=localhost
WIFI_CAM_REDIS_PORT=6379
WIFI_CAM_REDIS_DB_CACHE=0
WIFI_CAM_REDIS_PASSWORD=
WIFI_CAM_IMAGE_FORMAT=jpeg
WIFI_CAM_JPEG_QUALITY=95
WIFI_CAM_LOG_LEVEL=INFO
```

## Technical Patterns

- Use `redis-py` for Redis operations (same as existing VisionKing services)
- Use `opencv-python-headless` for RTSP capture and JPEG encoding
- Use `pydantic` v2 for configuration models
- Use Python `logging` module (loguru optional)
- Use `threading` for per-camera capture loops (one thread per camera)
- Use async Redis pub/sub listener in main thread (or separate thread)

## Dockerfile

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY configs/ ./configs/

ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "src.main"]
```

## Tests

Write pytest tests for:
- `test_config.py`: Config loading, env var parsing, default values
- `test_redis_writer.py`: Hash field generation, frame metadata building (mock Redis)
- `test_rtsp_capture.py`: Command parsing, state machine transitions (mock OpenCV)

Use `pytest` + `pytest-mock`. Do NOT require a live Redis or RTSP stream for tests.

## Constraints

- Do NOT install any packages globally (use venv or just pip in container)
- All code in English (comments, docstrings, variable names)
- Follow existing VisionKing Python patterns: `src/` package, `__init__.py`, Dockerfile at root
- Commit all changes with descriptive messages
