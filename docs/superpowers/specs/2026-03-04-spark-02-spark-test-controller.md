# SPARK-02: Spark Test Controller Service

## Goal

Create a Python/FastAPI service at `workspaces/strokmatic/visionking/services/spark-test-controller/` that orchestrates each spark test cycle. It manages the test lifecycle, coordinates camera start/stop, and aggregates inference results.

## Project Structure

```
spark-test-controller/
├── src/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app startup
│   ├── api/
│   │   ├── __init__.py
│   │   ├── router.py              # Main API router
│   │   ├── tests_router.py        # POST /tests/start, POST /tests/{id}/analyze, GET /tests/{id}/result, GET /tests
│   │   ├── cameras_router.py      # GET /cameras/status
│   │   └── materials_router.py    # GET /materials, POST /materials
│   ├── models/
│   │   ├── __init__.py
│   │   ├── test_session.py        # SparkTest, SparkTestFrame, TestState enum
│   │   ├── material.py            # Material model
│   │   └── api_schemas.py         # Pydantic request/response schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── test_manager.py        # Test lifecycle state machine
│   │   ├── camera_coordinator.py  # Redis pub/sub to wifi-camera-acquisition
│   │   ├── inference_client.py    # Publish frames to RabbitMQ, wait for results
│   │   └── result_evaluator.py    # Compare identified vs expected material
│   ├── db/
│   │   ├── __init__.py
│   │   ├── database.py            # SQLAlchemy/asyncpg connection
│   │   ├── models.py              # ORM models: materials, spark_tests, spark_test_frames
│   │   └── migrations/
│   │       └── 001_initial.sql    # Schema creation SQL
│   └── config.py                  # Environment variable reader (SPARK_* prefix)
├── tests/
│   ├── __init__.py
│   ├── test_test_manager.py       # State machine transitions
│   ├── test_result_evaluator.py   # APROVADO/REPROVADO logic
│   ├── test_api.py                # FastAPI TestClient tests
│   └── conftest.py                # Fixtures (mock DB, mock Redis)
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── pyproject.toml
├── .env.example
├── README.md
└── .gitignore
```

## Functional Requirements

### 1. Test Lifecycle State Machine (`test_manager.py`)

```
IDLE → CAPTURING → ANALYZING → COMPLETE
                             → FAILED
```

- `IDLE`: No active test. Waiting for `POST /tests/start`.
- `CAPTURING`: Camera is streaming, frames being written to Redis/disk. Waiting for `POST /tests/{id}/analyze` or auto-timeout.
- `ANALYZING`: Capture stopped, frames sent to inference pipeline. Waiting for results.
- `COMPLETE`: Inference done, result available. Material identified + APROVADO/REPROVADO.
- `FAILED`: Error during capture or inference.

Support multiple concurrent tests (one per camera). Use a dict of active test sessions keyed by test ID.

### 2. API Endpoints

#### `POST /tests/start`

Request:
```json
{
  "expected_material_code": "AISI 1045",
  "operator": "João Silva",
  "camera_id": "cam-operator-1",
  "max_duration_seconds": 15
}
```

Response (201):
```json
{
  "test_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "CAPTURING",
  "camera_id": "cam-operator-1",
  "started_at": "2026-03-04T15:30:00Z"
}
```

Actions:
1. Generate test UUID
2. Look up `expected_material_code` in DB (or create if not exists)
3. Send start command to wifi-camera-acquisition via Redis pub/sub
4. Start auto-timeout timer (max_duration_seconds, default 15s)
5. Return test ID to caller

#### `POST /tests/{id}/analyze`

Request: (empty body)

Response (200):
```json
{
  "test_id": "550e8400-...",
  "status": "ANALYZING",
  "frame_count": 87,
  "capture_duration_ms": 8700
}
```

Actions:
1. Send stop command to wifi-camera-acquisition
2. Collect frame UUIDs from this test session
3. Publish frame batch to RabbitMQ `spark-inference-queue`
4. Transition to ANALYZING state

#### `GET /tests/{id}/result`

Response (200 when COMPLETE):
```json
{
  "test_id": "550e8400-...",
  "status": "COMPLETE",
  "expected_material": {"code": "AISI 1045", "id": 1},
  "identified_material": {"code": "AISI 1045", "confidence": 0.92},
  "result": "APROVADO",
  "frame_count": 87,
  "capture_duration_ms": 8700,
  "inference_duration_ms": 2340,
  "created_at": "2026-03-04T15:30:00Z"
}
```

Response (200 when ANALYZING):
```json
{
  "test_id": "550e8400-...",
  "status": "ANALYZING",
  "message": "Inference in progress..."
}
```

#### `GET /tests`

List recent tests with pagination. Query params: `?limit=20&offset=0&operator=João`

#### `GET /cameras/status`

Response:
```json
{
  "cameras": [
    {"camera_id": "cam-operator-1", "status": "idle", "rtsp_connected": true},
    {"camera_id": "cam-operator-2", "status": "capturing", "frames_captured": 42}
  ]
}
```

#### `GET /materials` and `POST /materials`

CRUD for materials catalog.

### 3. Camera Coordination (`camera_coordinator.py`)

Communicate with wifi-camera-acquisition via Redis pub/sub:
- Publish to `sparktest:camera:commands`: `{"action": "start", "sample_uuid": "...", "cameras": ["cam-operator-1"]}`
- Subscribe to `sparktest:camera:status` for status updates
- Track frame count per active test

### 4. Inference Integration (`inference_client.py`)

After capture ends:
1. Collect all frame paths for this test from image-saver's output directory
2. Publish a batch message to RabbitMQ queue `spark-inference-queue`:
   ```json
   {
     "test_id": "550e8400-...",
     "frame_paths": ["img_saved/550e8400/.../frame1.bin", ...],
     "frame_count": 87,
     "strategy": "per_frame_aggregate"
   }
   ```
3. Wait for result on `spark-result-queue` (with timeout 30s)

### 5. Result Evaluation (`result_evaluator.py`)

```python
def evaluate_result(expected_code: str, identified_code: str, confidence: float) -> str:
    """Compare identified vs expected material.

    Returns: "APROVADO", "REPROVADO", or "INCONCLUSIVO"
    """
    if confidence < 0.5:
        return "INCONCLUSIVO"
    if expected_code == identified_code:
        return "APROVADO"
    return "REPROVADO"
```

### 6. Database Schema (PostgreSQL)

```sql
CREATE TABLE IF NOT EXISTS materials (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spark_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expected_material_id INT REFERENCES materials(id),
    identified_material_id INT REFERENCES materials(id),
    confidence FLOAT,
    result VARCHAR(20) CHECK (result IN ('APROVADO', 'REPROVADO', 'INCONCLUSIVO')),
    operator VARCHAR(100),
    camera_id VARCHAR(50),
    frame_count INT DEFAULT 0,
    capture_duration_ms INT DEFAULT 0,
    inference_duration_ms INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'IDLE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS spark_test_frames (
    id SERIAL PRIMARY KEY,
    test_id UUID REFERENCES spark_tests(id) ON DELETE CASCADE,
    frame_index INT,
    frame_uuid UUID,
    image_path TEXT,
    predictions JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed common steel alloys
INSERT INTO materials (code, description) VALUES
    ('AISI 1020', 'Low carbon steel'),
    ('AISI 1045', 'Medium carbon steel'),
    ('AISI 4140', 'Chromium-molybdenum steel'),
    ('AISI 304', 'Austenitic stainless steel'),
    ('AISI 316', 'Molybdenum-bearing stainless steel'),
    ('AISI D2', 'High-carbon high-chromium tool steel'),
    ('AISI H13', 'Hot work tool steel'),
    ('AISI M2', 'Molybdenum high-speed steel')
ON CONFLICT (code) DO NOTHING;
```

### 7. Environment Variables

Prefix: `SPARK_`

```ini
SPARK_HOST=0.0.0.0
SPARK_PORT=8100
SPARK_DB_HOST=localhost
SPARK_DB_PORT=5432
SPARK_DB_NAME=sparktest
SPARK_DB_USER=strokmatic
SPARK_DB_PASSWORD=
SPARK_REDIS_HOST=localhost
SPARK_REDIS_PORT=6379
SPARK_REDIS_PASSWORD=
SPARK_RABBIT_HOST=localhost
SPARK_RABBIT_PORT=5672
SPARK_RABBIT_USER=strokmatic
SPARK_RABBIT_PASSWORD=
SPARK_INFERENCE_QUEUE=spark-inference-queue
SPARK_RESULT_QUEUE=spark-result-queue
SPARK_MAX_CAPTURE_DURATION=15
SPARK_INFERENCE_TIMEOUT=30
SPARK_LOG_LEVEL=INFO
SPARK_IMG_SAVED_PATH=/img_saved
```

## Technical Stack

- **FastAPI** with **uvicorn** for the HTTP server
- **asyncpg** or **psycopg[binary]** + SQLAlchemy async for PostgreSQL
- **redis[hiredis]** for Redis pub/sub
- **aio-pika** for RabbitMQ (async, matches VisionKing's migration direction)
- **pydantic** v2 for models/schemas

## Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8100"]
```

## Tests

Write pytest tests for:
- `test_test_manager.py`: State machine transitions (IDLE→CAPTURING→ANALYZING→COMPLETE, error paths)
- `test_result_evaluator.py`: APROVADO/REPROVADO/INCONCLUSIVO logic with various confidence levels
- `test_api.py`: FastAPI TestClient for all endpoints (mock DB and Redis)

Use `pytest` + `pytest-asyncio` + `httpx` (for TestClient).

## Constraints

- All code in English
- Follow FastAPI best practices (dependency injection, Pydantic schemas, proper HTTP status codes)
- Commit all changes with descriptive messages
- Do NOT require live infrastructure for tests (use mocks/fixtures)
