"""Full-text search across emails and documents."""

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..config import settings
from ..database import get_db
from ..schemas import SearchResponse, SearchResult

router = APIRouter(prefix="/api/search", tags=["search"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_email_index(project_code: str) -> list[dict]:
    """Load the email index.json for a given project."""
    index_path = (
        Path(settings.PMO_ROOT) / "pmo" / project_code / "emails" / "index.json"
    )
    if not index_path.is_file():
        index_path = (
            Path(settings.PMO_ROOT) / project_code / "emails" / "index.json"
        )
    if not index_path.is_file():
        return []
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("emails", data.get("messages", []))
        return []
    except (json.JSONDecodeError, OSError):
        return []


def _get_project_codes() -> list[str]:
    """Discover available project codes from filesystem."""
    codes: list[str] = []

    # Try loading from config
    config_path = Path(settings.CONFIG_ROOT) / "project-codes.json"
    if config_path.is_file():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                codes = [
                    (item["code"] if isinstance(item, dict) else str(item))
                    for item in data
                ]
            elif isinstance(data, dict):
                codes = list(data.keys())
        except (json.JSONDecodeError, OSError):
            pass

    # Also scan PMO directory for project folders
    for search_root in [
        Path(settings.PMO_ROOT) / "pmo",
        Path(settings.PMO_ROOT),
    ]:
        if search_root.is_dir():
            for entry in search_root.iterdir():
                if entry.is_dir() and entry.name not in (".", "..", "config"):
                    if entry.name not in codes:
                        codes.append(entry.name)
            break

    return codes


def _search_emails(
    query: str,
    project_filter: Optional[str] = None,
) -> list[SearchResult]:
    """Search email subjects and bodies with simple LIKE matching."""
    results: list[SearchResult] = []
    query_lower = query.lower()

    project_codes = (
        [project_filter] if project_filter else _get_project_codes()
    )

    for code in project_codes:
        emails = _load_email_index(code)
        for email in emails:
            subject = email.get("subject", "")
            body = email.get(
                "body", email.get("snippet", email.get("preview", ""))
            )
            from_addr = email.get("from", email.get("sender", ""))

            searchable = f"{subject} {body} {from_addr}".lower()

            if query_lower in searchable:
                # Build snippet: find the match context
                snippet = ""
                idx = searchable.find(query_lower)
                if idx >= 0:
                    # Use the original combined text for snippet
                    original = f"{subject} {body} {from_addr}"
                    start = max(0, idx - 60)
                    end = min(len(original), idx + len(query) + 60)
                    snippet = original[start:end].strip()
                    if start > 0:
                        snippet = "..." + snippet
                    if end < len(original):
                        snippet = snippet + "..."

                results.append(
                    SearchResult(
                        type="email",
                        project_code=code,
                        title=subject or "(no subject)",
                        snippet=snippet,
                        path=email.get("hash", email.get("id")),
                        score=1.0,
                    )
                )

    return results


def _search_documents(
    query: str,
    project_filter: Optional[str] = None,
) -> list[SearchResult]:
    """Search document filenames in project reference/reports folders."""
    results: list[SearchResult] = []
    query_lower = query.lower()

    project_codes = (
        [project_filter] if project_filter else _get_project_codes()
    )

    doc_dirs = ["reference", "reports", "meetings"]

    for code in project_codes:
        for dirname in doc_dirs:
            for base in [
                Path(settings.PMO_ROOT) / "pmo" / code / dirname,
                Path(settings.PMO_ROOT) / code / dirname,
            ]:
                if not base.is_dir():
                    continue
                for filepath in base.rglob("*"):
                    if not filepath.is_file():
                        continue
                    if query_lower in filepath.name.lower():
                        results.append(
                            SearchResult(
                                type="document",
                                project_code=code,
                                title=filepath.name,
                                snippet=f"Found in {dirname}/",
                                path=str(
                                    filepath.relative_to(Path(settings.PMO_ROOT))
                                ),
                                score=0.8,
                            )
                        )
                break  # Only use the first base that exists

    return results


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get("", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1, description="Search query"),
    project: Optional[str] = Query(None, description="Filter by project code"),
    type: Optional[str] = Query(
        None,
        description="Search type: 'emails', 'documents', or 'all'",
    ),
):
    """Search across email subjects/bodies and document names.

    Uses simple case-insensitive substring matching (LIKE-based).
    """
    search_type = type or "all"
    results: list[SearchResult] = []

    if search_type in ("all", "emails"):
        results.extend(_search_emails(q, project))

    if search_type in ("all", "documents"):
        results.extend(_search_documents(q, project))

    # Sort by score descending, then title
    results.sort(key=lambda r: (-r.score, r.title))

    return SearchResponse(
        query=q,
        total=len(results),
        results=results,
    )
