"""JARVIS PR Review Dashboard — FastAPI application."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .routers import actions, analytics, inbox, pipeline, reviews

app = FastAPI(
    title="JARVIS PR Review Dashboard",
    description="GUI dashboard for the automated PR review service.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register API routers ─────────────────────────────────────────────────────

app.include_router(inbox.router, prefix="/api")
app.include_router(reviews.router, prefix="/api")
app.include_router(pipeline.router, prefix="/api")
app.include_router(actions.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")

# ── SPA fallback — serve frontend static files ──────────────────────────────

_static_dir = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "static")
)

if os.path.isdir(_static_dir):
    _assets_dir = os.path.join(_static_dir, "assets")
    if os.path.isdir(_assets_dir):
        app.mount(
            "/assets",
            StaticFiles(directory=_assets_dir),
            name="assets",
        )

    _index_html = os.path.join(_static_dir, "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        """Serve index.html for all non-API routes (Vue Router history mode)."""
        # Serve specific static files if they exist at the root level
        file_path = os.path.join(_static_dir, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(_index_html)
