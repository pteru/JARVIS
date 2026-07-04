# SPARK-06: SparkTest Topology Profile

## Goal

Create the SparkTest deployment profile for VisionKing's topology tools. This includes a new topology YAML template, service catalog entries for new SparkTest services, and a docker-compose reference for the SparkTest profile.

Create all files at `workspaces/strokmatic/visionking/spark-test-topology/` (a standalone directory that will later be integrated into the topology-configurator and deployment-runner).

## Project Structure

```
spark-test-topology/
├── topologies/
│   └── sparktest-single-node.yaml       # Full topology template
├── service-catalog-additions.py          # New service entries for the catalog
├── docker-compose.sparktest.yml          # Reference docker-compose for SparkTest
├── .env.sparktest.example                # Environment variables template
├── README.md                             # SparkTest deployment guide
└── sql/
    └── 001_sparktest_schema.sql          # PostgreSQL schema for SparkTest
```

## Topology Template (`sparktest-single-node.yaml`)

Must follow the existing TopologyFile Pydantic schema (schema_version 1.0):

```yaml
schema_version: "1.0"

metadata:
  name: sparktest-single-node
  description: "SparkTest — WiFi camera steel alloy identification via spark testing"
  profile: sparktest
  created_at: "2026-03-04T00:00:00"
  author: Strokmatic

nodes:
  main:
    hostname: sparktest-server
    ip: 192.168.1.10
    description: "SparkTest server with GPU for inference"
    capabilities:
      - gpu

infrastructure:
  postgres:
    enabled: true
    node: main
    image: postgres:15-alpine
    port: 5432
    env_overrides:
      POSTGRES_DB: sparktest
      POSTGRES_USER: strokmatic
      POSTGRES_PASSWORD: "${PSQL_PASSWORD}"
  redis:
    enabled: true
    node: main
    image: eqalpha/keydb:latest
    port: 6379
  rabbitmq:
    enabled: true
    node: main
    image: rabbitmq:3-management-alpine
    port: 5672

services:
  # WiFi Camera Acquisition (replaces GigE camera-acquisition)
  wifi-camera-acquisition:
    enabled: true
    node: main
    resources:
      memory: "2048M"
      cpus: "1"
    env_overrides:
      WIFI_CAM_FRAME_CELL: "SPARK_TEST"
      WIFI_CAM_TTL_CACHE: "300"
      WIFI_CAM_JPEG_QUALITY: "95"

  # Spark Test Controller (replaces controller + plc-monitor)
  spark-test-controller:
    enabled: true
    node: main
    port: 8100
    resources:
      memory: "1024M"
      cpus: "0.5"
    env_overrides:
      SPARK_PORT: "8100"
      SPARK_MAX_CAPTURE_DURATION: "15"
      SPARK_INFERENCE_TIMEOUT: "30"

  # Reused VisionKing services
  image-saver:
    enabled: true
    node: main
    network_mode: host
    env_overrides:
      IMG_SAVER_RABBIT_QUEUE: "spark-is-queue"

  inference:
    enabled: true
    node: main
    replicas: 1
    gpu:
      enabled: true
      count: 1
      capabilities:
        - gpu
    env_overrides:
      INF_RABBIT_INPUT_QUEUE: "spark-inference-queue"
      INF_RABBIT_OUTPUT_QUEUE: "spark-result-queue"

  database-writer:
    enabled: true
    node: main
    network_mode: host
    resources:
      memory: "2048M"
      cpus: "0.5"
    env_overrides:
      DB_WRITER_RABBIT_QUEUE: "spark-result-queue"
      DB_WRITER_MODE: "sparktest"

  # SparkTest web apps
  backend-sparktest:
    enabled: true
    node: main
    port: 8001
    resources:
      memory: "512M"
      cpus: "0.5"

  frontend-sparktest:
    enabled: true
    node: main
    port: 8080
    resources:
      memory: "256M"
      cpus: "0.25"

  # Disabled VisionKing services (not needed for SparkTest)
  camera-acquisition:
    enabled: false
    node: main
  controller:
    enabled: false
    node: main
  plc-monitor:
    enabled: false
    node: main
  pixel-to-object:
    enabled: false
    node: main
  length-measure:
    enabled: false
    node: main
  defect-aggregator:
    enabled: false
    node: main
  result:
    enabled: false
    node: main
  backend-laminacao:
    enabled: false
    node: main
  frontend-laminacao:
    enabled: false
    node: main
  backend-carrocerias:
    enabled: false
    node: main
  frontend-carrocerias:
    enabled: false
    node: main
  visualizer:
    enabled: false
    node: main
  storage-monitor:
    enabled: false
    node: main

globals:
  timezone: America/Sao_Paulo
  image_tag: latest
  gcp_registry: us-central1-docker.pkg.dev/sis-surface/sis-surface
  logging:
    max_size: "10m"
    max_file: "5"

secrets:
  psql_password: "${PSQL_PASSWORD}"
  redis_password: "${REDIS_PASSWORD}"
  rabbit_password: "${RABBIT_PASSWORD}"

network:
  name: sparktest-network
  driver: bridge

volumes:
  postgres-data:
    driver: local
  redis-data:
    driver: local
  rabbitmq-data:
    driver: local
  img-saved-data:
    driver: local
  models-data:
    driver: local
```

## Service Catalog Additions (`service-catalog-additions.py`)

Document the new service catalog entries that need to be added to `topology_configurator/models/service_catalog.py`. Use the existing `ServiceCatalogEntry` pattern:

```python
# New services for SparkTest profile
# These entries should be added to APPLICATION_SERVICES in service_catalog.py

SPARKTEST_SERVICES = {
    "wifi-camera-acquisition": ServiceCatalogEntry(
        name="wifi-camera-acquisition",
        display_name="WiFi Camera Acquisition",
        category="acquisition",
        description="RTSP stream capture from WiFi cameras (DJI Action 4 etc.)",
        image="${GCP_REGISTRY}/visionking-wifi-camera-acquisition:${IMAGE_TAG}",
        build_context="./services/wifi-camera-acquisition",
        dockerfile="Dockerfile",
        container_name="visionking-wifi-camera-acquisition",
        entrypoint="",
        privileged=False,
        network_mode=None,  # Uses bridge network (no hardware access needed)
        default_port=0,
        gpu_capable=False,
        supports_replicas=False,
        depends_on=["redis"],
        profiles=["sparktest"],
        env_prefix="WIFI_CAM_",
        default_memory="2048M",
        default_cpus="1",
    ),
    "spark-test-controller": ServiceCatalogEntry(
        name="spark-test-controller",
        display_name="Spark Test Controller",
        category="business_logic",
        description="FastAPI service orchestrating spark test lifecycle",
        image="${GCP_REGISTRY}/visionking-spark-test-controller:${IMAGE_TAG}",
        build_context="./services/spark-test-controller",
        dockerfile="Dockerfile",
        container_name="visionking-spark-test-controller",
        entrypoint="",
        privileged=False,
        network_mode=None,
        default_port=8100,
        gpu_capable=False,
        supports_replicas=False,
        depends_on=["redis", "postgres", "rabbitmq"],
        profiles=["sparktest"],
        env_prefix="SPARK_",
        default_memory="1024M",
        default_cpus="0.5",
    ),
    "backend-sparktest": ServiceCatalogEntry(
        name="backend-sparktest",
        display_name="SparkTest Backend",
        category="web_sparktest",
        description="NestJS API gateway for SparkTest tablet frontend",
        image="${GCP_REGISTRY}/visionking-backend-sparktest:${IMAGE_TAG}",
        build_context="./services/backend-sparktest",
        dockerfile="Dockerfile",
        container_name="visionking-backend-sparktest",
        entrypoint="",
        privileged=False,
        network_mode=None,
        default_port=8001,
        gpu_capable=False,
        supports_replicas=False,
        depends_on=["postgres"],
        profiles=["sparktest"],
        env_prefix="",
        default_memory="512M",
        default_cpus="0.5",
    ),
    "frontend-sparktest": ServiceCatalogEntry(
        name="frontend-sparktest",
        display_name="SparkTest Tablet Frontend",
        category="web_sparktest",
        description="Angular PWA for SparkTest operator workflow",
        image="${GCP_REGISTRY}/visionking-frontend-sparktest:${IMAGE_TAG}",
        build_context="./services/frontend-sparktest",
        dockerfile="Dockerfile",
        container_name="visionking-frontend-sparktest",
        entrypoint="",
        privileged=False,
        network_mode=None,
        default_port=8080,
        gpu_capable=False,
        supports_replicas=False,
        depends_on=[],
        profiles=["sparktest"],
        env_prefix="",
        default_memory="256M",
        default_cpus="0.25",
    ),
}
```

## Docker Compose Reference (`docker-compose.sparktest.yml`)

Write a complete docker-compose.yml for the SparkTest profile. This is a reference file (like VisionKing's root docker-compose.yml). Include all 7 services (3 infrastructure + 4 application) with proper networking, volumes, depends_on, and environment variable interpolation.

## Environment Variables (`.env.sparktest.example`)

Document all env vars needed for SparkTest deployment with sensible defaults and `${VAR}` interpolation where appropriate.

## PostgreSQL Schema (`sql/001_sparktest_schema.sql`)

```sql
-- SparkTest Database Schema
-- Run against the sparktest database

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

CREATE INDEX idx_spark_tests_created_at ON spark_tests(created_at DESC);
CREATE INDEX idx_spark_tests_operator ON spark_tests(operator);
CREATE INDEX idx_spark_test_frames_test_id ON spark_test_frames(test_id);
```

## Constraints

- All code and docs in English
- Follow the exact Pydantic model schema from VisionKing's topology_configurator
- Use `${VAR}` interpolation in .env files (same pattern as VisionKing)
- Commit all changes with descriptive messages
