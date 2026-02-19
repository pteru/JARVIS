"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and run initial sync on startup."""
    await init_db()
    # Run initial supplier/schedule sync from PMO filesystem
    try:
        from app.database import async_session
        from app.services.sync import run_initial_sync
        async with async_session() as db:
            await run_initial_sync(
                db,
                Path(settings.PMO_ROOT),
                Path(settings.CONFIG_ROOT),
            )
            await db.commit()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Initial sync failed: {e}")
    yield


app = FastAPI(
    title="PMO Dashboard",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware for dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import and include routers
from app.routers import projects, emails, documents  # noqa: E402

app.include_router(projects.router)
app.include_router(emails.router)
app.include_router(documents.router)

# Include additional routers if they have content
try:
    from app.routers import suppliers
    app.include_router(suppliers.router)
except (ImportError, AttributeError):
    pass

try:
    from app.routers import schedule
    app.include_router(schedule.router)
except (ImportError, AttributeError):
    pass

try:
    from app.routers import search
    app.include_router(search.router)
except (ImportError, AttributeError):
    pass

try:
    from app.routers import alerts
    app.include_router(alerts.router)
except (ImportError, AttributeError):
    pass

try:
    from app.routers import sheet_sync
    app.include_router(sheet_sync.router)
except (ImportError, AttributeError):
    pass


# Mount frontend static files
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


    @app.get("/{path:path}", include_in_schema=False)
    async def serve_spa(request: Request, path: str):
        """Serve frontend SPA. Falls back to index.html for client-side routing."""
        # Avoid serving index.html for API routes
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})

        file_path = FRONTEND_DIST / path
        if file_path.is_file():
            return FileResponse(file_path)

        # SPA fallback
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(index)

        return JSONResponse(status_code=404, content={"detail": "Frontend not built"})
