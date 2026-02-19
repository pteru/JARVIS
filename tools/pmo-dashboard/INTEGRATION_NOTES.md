# PMO Dashboard - Integration & Deployment Notes

## 1. Serving the Frontend from FastAPI (main.py)

In production, the compiled Vue.js frontend is served directly by FastAPI using
StaticFiles. The Dockerfile copies the Vite build output (frontend/dist/)
into backend/frontend-dist/ during the multi-stage build.

In main.py, the static mount must come after all API router registrations
so that /api/* routes take priority over the catch-all static file server:

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

app = FastAPI(title="PMO Dashboard")

# --- Register API routers first ---
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
app.include_router(suppliers_router, prefix="/api/suppliers", tags=["suppliers"])
app.include_router(schedule_router, prefix="/api", tags=["schedule"])
app.include_router(search_router, prefix="/api/search", tags=["search"])
app.include_router(alerts_router, prefix="/api/alerts", tags=["alerts"])
app.include_router(emails_router, prefix="/api", tags=["emails"])

# --- Serve frontend (production only) ---
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend-dist"
if FRONTEND_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = FRONTEND_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIR / "index.html")
```

Key points:
- FRONTEND_DIR resolves to /app/backend/frontend-dist/ inside the container.
- The /assets mount handles hashed JS/CSS bundles from Vite.
- The catch-all /{full_path:path} route serves index.html for Vue Router
  history-mode URLs (e.g., /projects/ST01, /suppliers/5).
- This mount is only active if frontend-dist/ exists, so it does not
  interfere during local development when the Vite dev server runs separately.

## 2. How the Dockerfile Copies Frontend Assets

The multi-stage build works in two stages:

```
Stage 1 (frontend-build):
  node:20-alpine
  WORKDIR /build
  npm ci -> npm run build -> output in /build/dist/

Stage 2 (runtime):
  python:3.12-slim
  WORKDIR /app/backend
  COPY backend/ ./
  COPY --from=frontend-build /build/dist ./frontend-dist/
```

The runtime container has this structure:
```
/app/backend/
  app/
    main.py
    config.py
    ...
  frontend-dist/       <-- compiled Vue.js SPA
    index.html
    assets/
      index-abc123.js
      index-def456.css
    favicon.ico
  requirements.txt
```

## 3. Configuring the Frontend Build for Relative API Paths

The Vite dev server proxies API calls to the backend during development. In
production, the frontend and backend share the same origin, so API calls should
use relative paths.

frontend/vite.config.js should include:

```js
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
  plugins: [vue()],
  base: "/",
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8090",
        changeOrigin: true,
      },
    },
  },
})
```

frontend/src/api.js should use a relative base URL:

```js
import axios from "axios"

const api = axios.create({
  baseURL: "/api",
})

export default api
```

This way:
- In development: Vite proxies /api/* requests to localhost:8090.
- In production: The browser hits the same FastAPI server at /api/* directly.

## 4. Application Startup Sequence

When uvicorn app.main:app starts, the application should execute this sequence:

```
1. Load configuration
   - Read env vars: PMO_ROOT, CONFIG_ROOT, DB_PATH, AUTH_TOKEN, etc.
   - Validate that required directories exist

2. Initialize database
   - Create SQLAlchemy engine pointing to DB_PATH
   - Run Base.metadata.create_all(engine) to create tables if they do not exist
   - This is idempotent -- existing tables and data are preserved

3. Run initial filesystem sync (on startup)
   - Scan PMO_ROOT for project directories
   - Parse project-codes.json from CONFIG_ROOT
   - Index email metadata and document listings
   - Generate alerts for overdue items / unanswered emails
   - This populates the in-memory cache and/or search index

4. Start serving
   - API routers handle /api/* requests
   - Static files serve the frontend SPA (production only)
   - Background tasks can periodically re-sync filesystem changes
```

Recommended implementation using FastAPI lifespan:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_tables()
    await run_initial_sync()
    yield
    # Shutdown (cleanup if needed)

app = FastAPI(lifespan=lifespan)
```

## 5. Authentication Middleware

Authentication is optional and controlled by the AUTH_TOKEN environment variable.
When set, all /api/* requests must include a valid Bearer token.

Implementation in app/auth.py:

```python
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from .config import get_settings

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        settings = get_settings()

        # Skip auth if no token is configured
        if not settings.AUTH_TOKEN:
            return await call_next(request)

        # Only protect API routes
        if not request.url.path.startswith("/api"):
            return await call_next(request)

        # Validate Bearer token
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing authorization header")

        token = auth_header.removeprefix("Bearer ").strip()
        if token != settings.AUTH_TOKEN:
            raise HTTPException(status_code=403, detail="Invalid token")

        return await call_next(request)
```

Register it in main.py:

```python
from app.auth import AuthMiddleware

app.add_middleware(AuthMiddleware)
```

Behavior:
- If AUTH_TOKEN is empty or unset, all requests pass through (open LAN access).
- If AUTH_TOKEN is set, every /api/* request must include
  Authorization: Bearer <token> in the headers.
- Non-API routes (frontend static files) are never protected, so the SPA loads
  regardless. The frontend stores the token and attaches it to API requests.
- The frontend should prompt for the token on first load and store it in
  localStorage.

## 6. Volume Mounts Summary

| Container Path | Host Path / Volume              | Mode | Purpose                        |
|----------------|---------------------------------|------|--------------------------------|
| /data/pmo      | .../workspaces/strokmatic/pmo   | ro   | Project folders, emails, docs  |
| /data/config   | .../JARVIS/config               | ro   | project-codes.json, etc.       |
| /data/db       | pmo-db named volume             | rw   | SQLite database persistence    |

## 7. Building and Running

```bash
# Build and start
docker compose up --build -d

# View logs
docker compose logs -f pmo-dashboard

# Rebuild after code changes
docker compose up --build -d

# Stop
docker compose down

# Stop and remove database volume (full reset)
docker compose down -v
```
