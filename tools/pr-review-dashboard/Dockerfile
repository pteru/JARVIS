# PR Review Dashboard — Multi-stage build
# Stage 1: Build frontend (Vue 3 + Vite)
# Stage 2: Python backend + serve static frontend

# ── Stage 1: Frontend build ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
# Copy package files first for layer caching
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend + gh CLI ────────────────────────────────────────
FROM python:3.12-slim

# Install gh CLI for GitHub API operations
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
        https://cli.github.com/packages stable main" \
        | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy frontend build output (may not exist during backend-only development)
COPY --from=frontend-builder /app/frontend/dist ./static/

EXPOSE 8091

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8091"]
