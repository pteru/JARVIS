"""GET /api/inbox — PR inbox enriched with review status."""

from __future__ import annotations

import json
import logging
import os

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..drive_client import (
    find_google_doc_for_review,
    read_inbox_json,
    read_review_markdown,
)
from ..parsers import parse_verdict
from ..schemas import InboxPR, InboxResponse

router = APIRouter(tags=["inbox"])
logger = logging.getLogger(__name__)


def _load_inbox_data() -> dict:
    """Load inbox from Drive first, fall back to local file."""
    # Try Google Drive
    try:
        drive_data = read_inbox_json()
        if drive_data:
            logger.debug("Loaded inbox from Google Drive")
            return drive_data
    except Exception:
        logger.warning("Failed to read inbox from Drive, falling back to local")

    # Fall back to local file
    inbox_file = os.path.join(settings.data_dir, "pr-inbox.json")
    if not os.path.isfile(inbox_file):
        raise HTTPException(status_code=404, detail="PR inbox file not found")

    with open(inbox_file, "r", encoding="utf-8") as f:
        return json.load(f)


def _check_review_exists(repo: str, number: int) -> tuple[bool, str | None]:
    """Check if a review exists and return (has_review, verdict).

    Tries Drive first, falls back to local filesystem.
    """
    # Try Drive
    try:
        content = read_review_markdown(repo, number)
        if content:
            verdict = parse_verdict(content)
            return True, verdict
    except Exception:
        pass

    # Fall back to local
    review_file = os.path.join(settings.reviews_dir, f"{repo}-{number}.md")
    if os.path.isfile(review_file):
        try:
            with open(review_file, "r", encoding="utf-8") as rf:
                content = rf.read()
            verdict = parse_verdict(content)
            return True, verdict
        except (OSError, UnicodeDecodeError):
            return True, None

    return False, None


def _load_local_metadata(repo: str, number: int) -> dict | None:
    """Load review metadata from local .meta.json sidecar."""
    meta_file = os.path.join(settings.reviews_dir, f"{repo}-{number}.meta.json")
    if not os.path.isfile(meta_file):
        return None
    try:
        with open(meta_file, "r", encoding="utf-8") as mf:
            return json.load(mf)
    except (OSError, json.JSONDecodeError):
        return None


@router.get("/inbox", response_model=InboxResponse)
async def get_inbox():
    """Return the PR inbox enriched with review information.

    Reads pr-inbox.json from Google Drive (with local fallback) and
    enriches each PR with review status, verdict, and Google Docs links.
    """
    inbox_data = _load_inbox_data()

    fetched_at = inbox_data.get("fetched_at", "")
    raw_prs = inbox_data.get("pull_requests", [])

    enriched: list[InboxPR] = []
    for pr in raw_prs:
        repo = pr.get("repo", "")
        number = pr.get("number", 0)

        has_review, verdict = _check_review_exists(repo, number)
        review_version = None
        review_date = None
        google_doc_url = None

        # Read metadata sidecar (always local — not uploaded to Drive)
        if has_review:
            meta = _load_local_metadata(repo, number)
            if meta:
                review_version = meta.get("current_version")
                review_date = meta.get("current_reviewed_at")

        # Find Google Doc link
        try:
            google_doc_url = find_google_doc_for_review(repo, number)
        except Exception:
            pass

        enriched.append(
            InboxPR(
                repo=repo,
                number=number,
                title=pr.get("title", ""),
                author=pr.get("author", ""),
                created_at=pr.get("created_at", ""),
                updated_at=pr.get("updated_at", ""),
                head=pr.get("head", ""),
                base=pr.get("base", ""),
                head_sha=pr.get("head_sha", ""),
                additions=pr.get("additions", 0),
                deletions=pr.get("deletions", 0),
                changed_files=pr.get("changed_files", 0),
                url=pr.get("url", ""),
                is_draft=pr.get("is_draft", False),
                review_decision=pr.get("review_decision", ""),
                labels=pr.get("labels", []),
                comments_count=pr.get("comments_count", 0),
                has_review=has_review,
                verdict=verdict,
                review_version=review_version,
                review_date=review_date,
                google_doc_url=google_doc_url,
            )
        )

    return InboxResponse(
        fetched_at=fetched_at,
        pull_requests=enriched,
        total=len(enriched),
    )
