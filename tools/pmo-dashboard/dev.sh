#!/usr/bin/env bash
# PMO Dashboard - Local development startup script
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PMO_ROOT="${PMO_ROOT:-/home/teruel/JARVIS/workspaces/strokmatic/pmo}"
export CONFIG_ROOT="${CONFIG_ROOT:-/home/teruel/JARVIS/config}"
export DB_PATH="${DB_PATH:-$DIR/backend/pmo-dev.db}"

# Backend
cd "$DIR/backend"
if [[ ! -d .venv ]]; then
    echo "[dev] Creating Python virtual environment..."
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
fi
echo "[dev] Starting backend on :8090..."
.venv/bin/uvicorn app.main:app --reload --port 8090 &
BACKEND_PID=$!

# Frontend
cd "$DIR/frontend"
if [[ ! -d node_modules ]]; then
    echo "[dev] Installing frontend dependencies..."
    npm install
fi
echo "[dev] Starting frontend dev server on :5173..."
npm run dev -- --port 5173 &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

echo "Backend:  http://localhost:8090"
echo "Frontend: http://localhost:5173"
wait
