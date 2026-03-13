"""GET /api/reviews/{repo}/{number} — Review content and metadata."""

from __future__ import annotations

import json
import os

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..parsers import parse_complexity, parse_findings, parse_summary, parse_verdict
from ..schemas import (
    PostedToGitHub,
    ReviewFindings,
    ReviewHistoryEntry,
    ReviewHistoryResponse,
    ReviewMetadata,
    ReviewResponse,
    ReviewVersion,
)

router = APIRouter(tags=["reviews"])


def _load_review_content(repo: str, number: int) -> str:
    """Load the review markdown file content."""
    review_file = os.path.join(settings.reviews_dir, f"{repo}-{number}.md")
    if not os.path.isfile(review_file):
        raise HTTPException(
            status_code=404, detail=f"Review not found: {repo}#{number}"
        )
    with open(review_file, "r", encoding="utf-8") as f:
        return f.read()


def _load_review_metadata(repo: str, number: int) -> ReviewMetadata | None:
    """Load the review .meta.json sidecar file."""
    meta_file = os.path.join(settings.reviews_dir, f"{repo}-{number}.meta.json")
    if not os.path.isfile(meta_file):
        return None
    try:
        with open(meta_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None

    posted = data.get("posted_to_github")
    posted_model = None
    if posted and isinstance(posted, dict):
        posted_model = PostedToGitHub(
            comment_id=posted.get("comment_id"),
            posted_at=posted.get("posted_at"),
            review_hash=posted.get("review_hash"),
        )

    versions = []
    for v in data.get("versions", []):
        versions.append(
            ReviewVersion(
                version=v.get("version", 0),
                reviewed_at=v.get("reviewed_at", ""),
                head_sha=v.get("head_sha", ""),
            )
        )

    return ReviewMetadata(
        current_version=data.get("current_version", 1),
        current_head_sha=data.get("current_head_sha", ""),
        current_reviewed_at=data.get("current_reviewed_at", ""),
        versions=versions,
        posted_to_github=posted_model,
        labels_applied=data.get("labels_applied", []),
    )


@router.get("/reviews/{repo}/{number}", response_model=ReviewResponse)
async def get_review(repo: str, number: int):
    """Return the review content, parsed verdict/summary/findings, and metadata.

    Reads the .md review file and .meta.json sidecar.
    """
    content = _load_review_content(repo, number)
    metadata = _load_review_metadata(repo, number)

    verdict = parse_verdict(content)
    summary = parse_summary(content)
    complexity = parse_complexity(content)
    findings_dict = parse_findings(content)

    return ReviewResponse(
        repo=repo,
        number=number,
        content=content,
        metadata=metadata,
        verdict=verdict,
        summary=summary,
        complexity=complexity,
        findings=ReviewFindings(**findings_dict),
    )


@router.get(
    "/reviews/{repo}/{number}/history", response_model=ReviewHistoryResponse
)
async def get_review_history(repo: str, number: int):
    """Return all historical versions of a review.

    Reads version entries from .meta.json and loads archived review content
    from reviews/archive/{repo}-{number}/v{N}.md.
    """
    metadata = _load_review_metadata(repo, number)
    if metadata is None:
        raise HTTPException(
            status_code=404,
            detail=f"Review metadata not found: {repo}#{number}",
        )

    entries: list[ReviewHistoryEntry] = []

    for version_info in metadata.versions:
        v = version_info.version
        archive_file = os.path.join(
            settings.archive_dir, f"{repo}-{number}", f"v{v}.md"
        )
        content = None
        if os.path.isfile(archive_file):
            try:
                with open(archive_file, "r", encoding="utf-8") as f:
                    content = f.read()
            except (OSError, UnicodeDecodeError):
                pass

        entries.append(
            ReviewHistoryEntry(
                version=v,
                reviewed_at=version_info.reviewed_at,
                head_sha=version_info.head_sha,
                content=content,
            )
        )

    # Add the current version (from the main review file)
    current_content = None
    review_file = os.path.join(settings.reviews_dir, f"{repo}-{number}.md")
    if os.path.isfile(review_file):
        try:
            with open(review_file, "r", encoding="utf-8") as f:
                current_content = f.read()
        except (OSError, UnicodeDecodeError):
            pass

    entries.append(
        ReviewHistoryEntry(
            version=metadata.current_version,
            reviewed_at=metadata.current_reviewed_at,
            head_sha=metadata.current_head_sha,
            content=current_content,
        )
    )

    return ReviewHistoryResponse(
        repo=repo,
        number=number,
        current_version=metadata.current_version,
        versions=entries,
    )
