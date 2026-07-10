---
type: Design Spec
title: VisionKing — Docker Healthchecks for All Services
description: Add Docker healthchecks to all VisionKing services in the root `docker-compose.yml`. No code changes inside service repositories. The deployment runner already copies healthcheck blocks from root c...
timestamp: 2026-03-23
---

# VisionKing — Docker Healthchecks for All Services

**Date:** 2026-03-23
**Backlog item:** HEALTH-01
**Status:** Design approved

## Goal

Add Docker healthchecks to all VisionKing services in the root `docker-compose.yml`. No code changes inside service repositories. The deployment runner already copies healthcheck blocks from root compose to generated topologies — so this single change propagates to all deployments.

## Scope

### In Scope (16 services in root `docker-compose.yml`)

- 3 infrastructure (postgres, redis, rabbitmq)
- 2 NestJS backends (backend-laminacao, backend-carrocerias)
- 2 Python services with existing health endpoints (image-saver, visualizer) — **to be verified during implementation**
- 7 Python services without health endpoints (inference, pixel-to-object, database-writer, defect-aggregator, result, length-measure, storage-monitor)
- 2 Angular frontends (frontend-laminacao, frontend-carrocerias)

Services from other deployment profiles (SparkTest, Sealer) that only appear in topology-generated composes are not covered by this spec. They can be added once the root compose pattern is established.

### Out of Scope (deferred)

- 3 C++ services (camera-acquisition, controller, plc-monitor) — require compiled binary changes for health endpoints; separate backlog item.
- `depends_on: { condition: service_healthy }` wiring — separate concern; can be layered on once healthchecks are stable.
- Adding `/health` HTTP endpoints to Python services — future enhancement for deeper observability.

## Approach

Native Docker healthchecks using tools already available in each container image. No sidecar scripts, no code changes in service repos. Prefer `wget` over `curl` as the E2E test compose consistently uses `wget`, indicating it is reliably available in the project's base images.

## Healthcheck Specifications

### Infrastructure Services

Borrowed from the proven E2E test compose patterns.

| Service | Image Base | Command | Interval | Timeout | Retries | Start Period |
|---------|-----------|---------|----------|---------|---------|--------------|
| postgres | postgres:15-alpine | `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}` | 5s | 3s | 5 | 10s |
| redis (KeyDB) | eqalpha/keydb | `keydb-cli -a ${REDIS_PASSWORD} ping` | 5s | 3s | 5 | 5s |
| rabbitmq | rabbitmq:3-management-alpine | `rabbitmq-diagnostics -q ping` | 10s | 10s | 5 | 30s |

**Notes:**
- Postgres: `POSTGRES_USER` and `POSTGRES_DB` are the container-internal env vars set by the official postgres image (not the VisionKing `PSQL_*` host-side vars).
- KeyDB: Use `keydb-cli` (the native CLI in the eqalpha/keydb image). Verify `redis-cli` symlink exists as fallback. `${REDIS_PASSWORD}` is interpolated by Docker Compose before container start, so it resolves correctly.
- RabbitMQ gets a longer start period due to Erlang VM boot time.

### NestJS Backend Services

Both backends expose `/api/health`. Existing healthcheck on backend-carrocerias is standardized.

| Service | Command | Interval | Timeout | Retries | Start Period |
|---------|---------|----------|---------|---------|--------------|
| backend-laminacao | `wget -qO- http://localhost:5777/api/health \|\| exit 1` | 30s | 10s | 5 | 60s |
| backend-carrocerias | `wget -qO- http://localhost:5777/api/health \|\| exit 1` | 30s | 10s | 5 | 60s |

**Notes:**
- Both backends listen on container-internal port **5777** (host-side ports differ via Docker port mapping).
- 60s start period accounts for NestJS boot + database connection pooling.
- **Verify during implementation**: Confirm `backend-laminacao` exposes `/api/health`. The E2E compose uses `/api/v1/pecas/teste` instead — if `/api/health` is not available, use that endpoint or a simple TCP check.

### Python Services With Health Endpoints

Already expose HTTP health routes — Docker just needs to probe them.

| Service | Command | Interval | Timeout | Retries | Start Period |
|---------|---------|----------|---------|---------|--------------|
| image-saver | `wget -qO- http://localhost:5000/health \|\| exit 1` | 30s | 10s | 5 | 30s |
| visualizer | `wget -qO- http://localhost:8501/health_check \|\| exit 1` | 30s | 10s | 5 | 30s |

**Verify during implementation:**
- **image-saver**: Confirm it actually has an HTTP health endpoint. It uses `network_mode: host` and is primarily a RabbitMQ consumer. If no HTTP server exists, reclassify to process-probe category.
- **visualizer**: Confirm endpoint path. E2E mock uses `/health`; production may use `/health_check`. Check actual source code.
- **wget availability**: Verify `wget` is in the Python base images. Fallback: `python -c "import urllib.request; urllib.request.urlopen('http://localhost:<port>/health')"`.

### Python Services Without Health Endpoints

Process-level liveness check via `pgrep`. Catches crashes, OOM kills, and import errors.

| Service | Network Mode | Command | Interval | Timeout | Retries | Start Period |
|---------|-------------|---------|----------|---------|---------|--------------|
| inference | bridge | `pgrep -f "python.*main" \|\| exit 1` | 30s | 5s | 3 | 120s |
| pixel-to-object | bridge | `pgrep -f "python.*main" \|\| exit 1` | 30s | 5s | 3 | 30s |
| database-writer | host | `pgrep -f "python.*main" \|\| exit 1` | 30s | 5s | 3 | 30s |
| defect-aggregator | host | `pgrep -f "python.*main" \|\| exit 1` | 30s | 5s | 3 | 30s |
| result | host | `pgrep -f "python.*main" \|\| exit 1` | 30s | 5s | 3 | 30s |
| length-measure | bridge | `pgrep -f "python.*main" \|\| exit 1` | 30s | 5s | 3 | 30s |
| storage-monitor | default | `pgrep -f "python.*main" \|\| exit 1` | 30s | 5s | 3 | 15s |

**Notes:**
- Inference gets 120s start period for ONNX/TensorRT model loading onto GPU.
- The `pgrep -f` pattern must be verified against each service's actual entrypoint command during implementation (e.g., `python -m main`, `python main.py`, `python src/main.py`).
- Network mode is documented per service but does not affect process-level probes (they run inside the container regardless).
- This is a shallow check. "Process is running" ≠ "processing correctly." Deeper checks require adding `/health` endpoints (deferred).

### Angular Frontend Services (Nginx)

Static SPAs — verify Nginx is responding. Both frontends use bridge networking with explicit port mappings.

| Service | Command | Interval | Timeout | Retries | Start Period |
|---------|---------|----------|---------|---------|--------------|
| frontend-laminacao | `wget -qO- http://localhost:80/ \|\| exit 1` | 30s | 5s | 3 | 15s |
| frontend-carrocerias | `wget -qO- http://localhost:80/ \|\| exit 1` | 30s | 5s | 3 | 15s |

**Note:** The healthcheck runs inside the container, so port 80 (Nginx default) is correct regardless of host-side port mapping.

## Implementation Steps

1. **Verify tooling availability** — Confirm `wget`, `pgrep`, `keydb-cli` exist in each Docker image. Build a quick checklist.
2. **Verify health endpoints** — Confirm image-saver has `/health`, visualizer has `/health_check`, backend-laminacao has `/api/health`. Reclassify services as needed.
3. **Verify entrypoint commands** — Check actual `CMD`/`ENTRYPOINT` in each Dockerfile for accurate `pgrep` patterns.
4. **Add healthcheck blocks** — Edit root `docker-compose.yml` with all 16 healthcheck definitions.
5. **Test propagation** — Run `deployment-runner generate` on a sample topology, verify healthchecks appear in generated compose.
6. **Test locally** — `docker-compose up` + `docker inspect --format='{{.State.Health.Status}}'` to verify health status transitions.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `wget` not in some images | Fallback to `curl -f` or `python -c "import urllib.request; ..."` |
| `keydb-cli` not available / different name | Check image, fallback to `redis-cli` if symlinked |
| `pgrep` not in slim images | Fallback to `test -f /proc/1/status` (PID 1 liveness) |
| Wrong `pgrep` pattern misses process | Verify against actual Dockerfile CMD during implementation |
| Health endpoint doesn't exist on a service | Reclassify to process-probe category during verification step |
| Healthcheck failures causing restart loops | Tune retries and start_period conservatively; rely on `restart: unless-stopped` policy already in place |
