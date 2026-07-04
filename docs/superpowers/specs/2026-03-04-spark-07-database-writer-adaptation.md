# SPARK-07: Database Writer SparkTest Adaptation

## Goal

Create a SparkTest-specific database-writer configuration at `workspaces/strokmatic/visionking/services/spark-database-writer/`. This is a lightweight Python service that consumes spark test inference results from RabbitMQ and writes them to PostgreSQL. It follows the same patterns as VisionKing's existing database-writer but is simpler (no frame/defect byte-string parsing).

## Context: Existing Database-Writer Pattern

The existing VisionKing database-writer:
- Consumes RabbitMQ messages (byte-string-encoded dicts from image-saver)
- Parses complex byte-string format: `b"{'key': b'value', ...}"`
- Calls PostgreSQL stored procedures: `insert_frames_pecas()`, `insert_defects_inpects()`
- Uses `aio-pika` for async RabbitMQ consumption (recently migrated)
- Has a `parsing.py` utility for decoding the byte-string format

The SparkTest database-writer is SIMPLER because:
- Messages from inference come as proper JSON (not byte-strings)
- Inserts into simple tables (spark_tests, spark_test_frames)
- No stored procedures needed — direct INSERT statements

## Project Structure

```
spark-database-writer/
├── src/
│   ├── __init__.py
│   ├── main.py                    # Entry point: connect to RabbitMQ, start consumer
│   ├── consumer.py                # aio-pika consumer for spark-result-queue
│   ├── db_writer.py               # PostgreSQL insert logic
│   ├── models.py                  # Pydantic models for inference result messages
│   └── config.py                  # Environment variable reader
├── tests/
│   ├── __init__.py
│   ├── test_consumer.py           # Message parsing tests
│   ├── test_db_writer.py          # Insert logic tests (mock DB)
│   └── conftest.py
├── sql/
│   └── 001_sparktest_schema.sql   # Schema (same as SPARK-06)
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── pyproject.toml
├── .env.example
├── README.md
└── .gitignore
```

## Functional Requirements

### 1. RabbitMQ Consumer (`consumer.py`)

Use `aio-pika` (async) to consume from `spark-result-queue`. Message format from inference:

```json
{
  "test_id": "550e8400-e29b-41d4-a716-446655440000",
  "identified_material": "AISI 1045",
  "confidence": 0.92,
  "strategy": "per_frame_aggregate",
  "frame_results": [
    {
      "frame_index": 0,
      "frame_uuid": "a1b2c3d4-...",
      "image_path": "img_saved/550e8400/.../frame.bin",
      "predictions": {"AISI 1045": 0.85, "AISI 1020": 0.10, "AISI 4140": 0.05}
    }
  ],
  "inference_duration_ms": 2340
}
```

### 2. Database Writer (`db_writer.py`)

On receiving a message:

1. Parse JSON message into Pydantic model
2. Look up or create `identified_material` in `materials` table
3. UPDATE `spark_tests` row:
   - Set `identified_material_id`, `confidence`, `inference_duration_ms`
   - Set `status = 'COMPLETE'`
   - Set `completed_at = NOW()`
   - Evaluate result: compare expected vs identified → APROVADO/REPROVADO/INCONCLUSIVO
4. INSERT rows into `spark_test_frames` for each frame result
5. ACK the RabbitMQ message

```python
async def write_spark_result(conn, message: SparkResultMessage):
    """Write inference result to PostgreSQL."""

    # 1. Get or create identified material
    material_id = await get_or_create_material(conn, message.identified_material)

    # 2. Get expected material from spark_tests row
    test_row = await conn.fetchrow(
        "SELECT expected_material_id FROM spark_tests WHERE id = $1",
        message.test_id
    )

    # 3. Evaluate result
    expected_code = await conn.fetchval(
        "SELECT code FROM materials WHERE id = $1",
        test_row["expected_material_id"]
    )
    result = evaluate_result(expected_code, message.identified_material, message.confidence)

    # 4. Update spark_tests
    await conn.execute("""
        UPDATE spark_tests SET
            identified_material_id = $1,
            confidence = $2,
            result = $3,
            inference_duration_ms = $4,
            status = 'COMPLETE',
            completed_at = NOW()
        WHERE id = $5
    """, material_id, message.confidence, result, message.inference_duration_ms, message.test_id)

    # 5. Insert frame results
    for frame in message.frame_results:
        await conn.execute("""
            INSERT INTO spark_test_frames (test_id, frame_index, frame_uuid, image_path, predictions)
            VALUES ($1, $2, $3, $4, $5)
        """, message.test_id, frame.frame_index, frame.frame_uuid,
            frame.image_path, json.dumps(frame.predictions))
```

### 3. Result Evaluation Logic

```python
def evaluate_result(expected_code: str, identified_code: str, confidence: float) -> str:
    if confidence < 0.5:
        return "INCONCLUSIVO"
    if expected_code.upper() == identified_code.upper():
        return "APROVADO"
    return "REPROVADO"
```

### 4. Environment Variables

Prefix: `SPARK_DW_`

```ini
SPARK_DW_DB_HOST=localhost
SPARK_DW_DB_PORT=5432
SPARK_DW_DB_NAME=sparktest
SPARK_DW_DB_USER=strokmatic
SPARK_DW_DB_PASSWORD=
SPARK_DW_RABBIT_HOST=localhost
SPARK_DW_RABBIT_PORT=5672
SPARK_DW_RABBIT_USER=strokmatic
SPARK_DW_RABBIT_PASSWORD=
SPARK_DW_RABBIT_QUEUE=spark-result-queue
SPARK_DW_LOG_LEVEL=INFO
SPARK_DW_PREFETCH_COUNT=10
```

### 5. Main Entry Point (`main.py`)

```python
import asyncio
from src.config import load_config
from src.consumer import start_consumer

async def main():
    config = load_config()
    await start_consumer(config)

if __name__ == "__main__":
    asyncio.run(main())
```

## Technical Stack

- `aio-pika` for async RabbitMQ consumption
- `asyncpg` for async PostgreSQL
- `pydantic` v2 for message models
- `python-dotenv` for env loading (optional)
- Python 3.11+

## Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY sql/ ./sql/

ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "src.main"]
```

## Tests

Write pytest tests for:
- `test_consumer.py`: Message parsing, invalid message handling
- `test_db_writer.py`: Result evaluation logic, SQL generation (mock asyncpg)

Use `pytest` + `pytest-asyncio`. Mock all external dependencies.

## Constraints

- All code in English
- Follow aio-pika async patterns (not pika sync)
- Commit all changes with descriptive messages
- Do NOT require live infrastructure for tests
