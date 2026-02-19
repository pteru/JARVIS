"""Document listing and download endpoints (reads from filesystem)."""

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.auth import verify_token
from app.config import settings
from app.schemas import Document

router = APIRouter(
    prefix="/api/projects/{code}/documents",
    tags=["documents"],
    dependencies=[Depends(verify_token)],
)

DOCUMENT_DIRS = ("reference", "meetings", "reports")


def _project_dir(code: str) -> Path:
    return Path(settings.PMO_ROOT) / code


def _scan_documents(project_path: Path) -> list[Document]:
    """Scan reference/, meetings/, reports/ directories for files."""
    docs: list[Document] = []
    for subdir in DOCUMENT_DIRS:
        d = project_path / subdir
        if not d.is_dir():
            continue
        for f in sorted(d.rglob("*")):
            if not f.is_file():
                continue
            stat = f.stat()
            modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            rel_path = str(f.relative_to(project_path))
            docs.append(Document(
                name=f.name,
                path=rel_path,
                directory=subdir,
                size_bytes=stat.st_size,
                modified_at=modified,
            ))
    return docs


@router.get("", response_model=list[Document])
async def list_documents(code: str) -> list[Document]:
    """List all documents in reference/, meetings/, and reports/ directories."""
    project_path = _project_dir(code)
    if not project_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Project {code} not found")
    return _scan_documents(project_path)


@router.get("/{path:path}")
async def download_document(code: str, path: str) -> FileResponse:
    """Download a document file."""
    project_path = _project_dir(code)
    file_path = project_path / path

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Document not found")

    # Security: ensure path does not escape the project directory
    try:
        file_path.resolve().relative_to(project_path.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    return FileResponse(file_path, filename=file_path.name)
