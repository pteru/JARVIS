"""Email listing, detail, and attachment endpoints (reads from filesystem)."""

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.auth import verify_token
from app.config import settings
from app.schemas import EmailDetail, EmailSummary, PaginatedResponse

router = APIRouter(
    prefix="/api/projects/{code}/emails",
    tags=["emails"],
    dependencies=[Depends(verify_token)],
)


def _project_dir(code: str) -> Path:
    return Path(settings.PMO_ROOT) / code


def _load_email_index(code: str) -> list[dict]:
    """Load the email index.json for a project."""
    index_path = _project_dir(code) / "emails" / "index.json"
    if not index_path.exists():
        return []
    with open(index_path, encoding="utf-8") as f:
        return json.load(f)


@router.get("", response_model=PaginatedResponse)
async def list_emails(
    code: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    category: str | None = Query(None),
    search: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
) -> PaginatedResponse:
    """List emails for a project with pagination and filters."""
    emails = _load_email_index(code)

    # Apply filters
    if category:
        emails = [e for e in emails if e.get("category") == category]
    if search:
        q = search.lower()
        emails = [
            e for e in emails
            if q in e.get("subject", "").lower()
            or q in e.get("sender_name", "").lower()
            or q in e.get("sender_email", "").lower()
        ]
    if date_from:
        emails = [e for e in emails if e.get("date", "") >= date_from]
    if date_to:
        emails = [e for e in emails if e.get("date", "") <= date_to]

    # Sort by date descending
    emails.sort(key=lambda e: e.get("date", ""), reverse=True)

    total = len(emails)
    pages = max(1, (total + per_page - 1) // per_page)
    start = (page - 1) * per_page
    page_items = emails[start:start + per_page]

    items = [EmailSummary(**e) for e in page_items]
    return PaginatedResponse(
        items=items, total=total, page=page, per_page=per_page, pages=pages,
    )


@router.get("/attachments/{path:path}")
async def get_attachment(code: str, path: str) -> FileResponse:
    """Serve an email attachment file."""
    file_path = _project_dir(code) / "emails" / "attachments" / path

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Attachment not found")

    # Security: ensure path does not escape the attachments directory
    try:
        file_path.resolve().relative_to(
            (_project_dir(code) / "emails" / "attachments").resolve()
        )
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    return FileResponse(file_path, filename=file_path.name)


@router.get("/{email_hash}", response_model=EmailDetail)
async def get_email(code: str, email_hash: str) -> EmailDetail:
    """Get a single parsed email by its hash."""
    # The parsed file uses the first 16 chars of the hash
    prefix = email_hash[:16]
    parsed_path = _project_dir(code) / "emails" / "parsed" / f"{prefix}.json"

    if not parsed_path.exists():
        raise HTTPException(status_code=404, detail=f"Email {email_hash} not found")

    with open(parsed_path, encoding="utf-8") as f:
        data = json.load(f)

    # Merge index data with parsed data for complete response
    index = _load_email_index(code)
    index_entry = next((e for e in index if e.get("hash") == email_hash), {})

    # Parsed JSON may have different field structure; merge carefully
    merged = {**index_entry, **data}
    return EmailDetail(**merged)
