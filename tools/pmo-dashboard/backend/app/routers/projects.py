"""Project listing and detail endpoints (reads from filesystem)."""

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.auth import verify_token
from app.config import settings
from app.schemas import ProjectDetail, ProjectSummary, TimelineEvent

router = APIRouter(prefix="/api/projects", tags=["projects"], dependencies=[Depends(verify_token)])


PRODUCT_LABELS = {
    "diemaster": "DieMaster",
    "spotfusion": "SpotFusion",
    "visionking": "VisionKing",
}

PREFIX_FALLBACK = {"01": "DieMaster", "02": "SpotFusion", "03": "VisionKing"}


def _product_line(code: str, info: dict | None = None) -> str:
    """Get product line from project config or derive from code prefix."""
    if info and info.get("product"):
        return PRODUCT_LABELS.get(info["product"], info["product"].title())
    return PREFIX_FALLBACK.get(code[:2], "Unknown")


def _load_project_codes() -> dict:
    """Load the project registry from config/project-codes.json."""
    config_path = Path(settings.CONFIG_ROOT) / "project-codes.json"
    if not config_path.exists():
        return {}
    with open(config_path, encoding="utf-8") as f:
        return json.load(f)


def _project_dir(code: str) -> Path:
    """Return the PMO directory for a given project code."""
    return Path(settings.PMO_ROOT) / code


def _count_emails(project_path: Path) -> tuple[int, int, str | None]:
    """Count total emails, uncategorized, and find latest date from index.json."""
    index_path = project_path / "emails" / "index.json"
    if not index_path.exists():
        return 0, 0, None
    with open(index_path, encoding="utf-8") as f:
        emails = json.load(f)
    total = len(emails)
    unread = sum(1 for e in emails if not e.get("category"))
    dates = [e.get("date", "") for e in emails if e.get("date")]
    latest = max(dates) if dates else None
    return total, unread, latest


def _count_documents(project_path: Path) -> int:
    """Count documents across reference/, meetings/, reports/ directories."""
    count = 0
    for subdir in ("reference", "meetings", "reports"):
        d = project_path / subdir
        if d.is_dir():
            count += sum(1 for f in d.rglob("*") if f.is_file())
    return count


@router.get("", response_model=list[ProjectSummary])
async def list_projects() -> list[ProjectSummary]:
    """List all projects with summary stats from the filesystem."""
    codes = _load_project_codes()
    results: list[ProjectSummary] = []
    for code, info in codes.items():
        project_path = _project_dir(code)
        email_count, unread_count, latest_date = _count_emails(project_path)
        doc_count = _count_documents(project_path)
        results.append(ProjectSummary(
            code=code,
            name=info.get("name", code),
            language=info.get("language", "en"),
            email_count=email_count,
            unread_count=unread_count,
            latest_email_date=latest_date,
            document_count=doc_count,
            phase=info.get("phase"),
            product_line=_product_line(code, info),
        ))
    return results


@router.get("/{code}", response_model=ProjectDetail)
async def get_project(code: str) -> ProjectDetail:
    """Get full project detail including technical report and timeline."""
    codes = _load_project_codes()
    if code not in codes:
        raise HTTPException(status_code=404, detail=f"Project {code} not found")

    info = codes[code]
    project_path = _project_dir(code)
    email_count, unread_count, latest_date = _count_emails(project_path)
    doc_count = _count_documents(project_path)

    # Read technical report
    report_path = project_path / "technical_report.md"
    technical_report = None
    if report_path.exists():
        technical_report = report_path.read_text(encoding="utf-8")

    # Read timeline
    timeline: list[TimelineEvent] = []
    timeline_path = project_path / "timeline.json"
    if timeline_path.exists():
        with open(timeline_path, encoding="utf-8") as f:
            raw_events = json.load(f)
        timeline = [TimelineEvent(**evt) for evt in raw_events]

    return ProjectDetail(
        code=code,
        name=info.get("name", code),
        language=info.get("language", "en"),
        email_count=email_count,
        unread_count=unread_count,
        latest_email_date=latest_date,
        document_count=doc_count,
        phase=info.get("phase"),
        product_line=_product_line(code, info),
        technical_report=technical_report,
        timeline=timeline,
    )
