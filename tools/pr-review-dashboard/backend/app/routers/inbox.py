"""GET /api/inbox — PR inbox enriched with review status."""

from __future__ import annotations

import json
import os

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..parsers import parse_verdict
from ..schemas import InboxPR, InboxResponse

router = APIRouter(tags=["inbox"])


@router.get("/inbox", response_model=InboxResponse)
async def get_inbox():
    """Return the PR inbox enriched with review information.

    Reads data/pr-inbox.json and enriches each PR with:
    - has_review: whether a review .md file exists
    - verdict: parsed from the review's ## Verdict section
    - review_version: from .meta.json
    - review_date: from .meta.json
    """
    inbox_file = os.path.join(settings.data_dir, "pr-inbox.json")

    if not os.path.isfile(inbox_file):
        raise HTTPException(status_code=404, detail="PR inbox file not found")

    with open(inbox_file, "r", encoding="utf-8") as f:
        inbox_data = json.load(f)

    fetched_at = inbox_data.get("fetched_at", "")
    raw_prs = inbox_data.get("pull_requests", [])

    enriched: list[InboxPR] = []
    for pr in raw_prs:
        repo = pr.get("repo", "")
        number = pr.get("number", 0)

        review_file = os.path.join(settings.reviews_dir, f"{repo}-{number}.md")
        meta_file = os.path.join(settings.reviews_dir, f"{repo}-{number}.meta.json")

        has_review = os.path.isfile(review_file)
        verdict = None
        review_version = None
        review_date = None

        if has_review:
            # Parse verdict from markdown
            try:
                with open(review_file, "r", encoding="utf-8") as rf:
                    verdict = parse_verdict(rf.read())
            except (OSError, UnicodeDecodeError):
                pass

            # Read metadata sidecar
            if os.path.isfile(meta_file):
                try:
                    with open(meta_file, "r", encoding="utf-8") as mf:
                        meta = json.load(mf)
                    review_version = meta.get("current_version")
                    review_date = meta.get("current_reviewed_at")
                except (OSError, json.JSONDecodeError):
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
            )
        )

    return InboxResponse(
        fetched_at=fetched_at,
        pull_requests=enriched,
        total=len(enriched),
    )
