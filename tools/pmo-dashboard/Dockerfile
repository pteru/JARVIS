# ==============================================================================
# PMO Dashboard - Multi-stage Docker build
# ==============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Frontend build
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend-build

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

COPY --from=frontend-build /build/dist /app/frontend/dist/
RUN mkdir -p /data/db
EXPOSE 8090
CMD uvicorn app.main:app --host 0.0.0.0 --port 8090
