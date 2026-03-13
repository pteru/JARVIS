"""GET /api/analytics — Aggregate review analytics."""

from __future__ import annotations

import json
import os
from collections import Counter

from fastapi import APIRouter

from ..config import settings
from ..parsers import parse_complexity, parse_verdict
from ..schemas import (
    AnalyticsResponse,
    DateCount,
    NameCount,
    SizeDistribution,
    VerdictDistribution,
)

router = APIRouter(tags=["analytics"])

# Product mapping: repo name prefix -> product name
_PRODUCT_MAP = {
    "diemaster": "DieMaster",
    "visionking": "VisionKing",
    "spotfusion": "SpotFusion",
}


def _repo_to_product(repo: str) -> str:
    """Map a repo name to its product. Falls back to repo name."""
    repo_lower = repo.lower()
    for prefix, product in _PRODUCT_MAP.items():
        if repo_lower.startswith(prefix):
            return product
    return repo


def _load_inbox_authors() -> dict[str, str]:
    """Load author mapping from inbox: {repo-number: author}."""
    inbox_file = os.path.join(settings.data_dir, "pr-inbox.json")
    if not os.path.isfile(inbox_file):
        return {}
    try:
        with open(inbox_file, "r", encoding="utf-8") as f:
            inbox = json.load(f)
        return {
            f"{pr['repo']}-{pr['number']}": pr.get("author", "unknown")
            for pr in inbox.get("pull_requests", [])
        }
    except (OSError, json.JSONDecodeError):
        return {}


def _scan_reviews() -> list[dict]:
    """Scan reviews directory and collect structured data from each review.

    Returns a list of dicts with keys:
      repo, number, verdict, complexity, reviewed_at, author
    """
    reviews_dir = settings.reviews_dir
    if not os.path.isdir(reviews_dir):
        return []

    # Pre-load author mapping to avoid re-reading inbox per review
    author_map = _load_inbox_authors()

    results = []

    for filename in os.listdir(reviews_dir):
        if not filename.endswith(".md"):
            continue
        # Skip archive directory entries
        filepath = os.path.join(reviews_dir, filename)
        if not os.path.isfile(filepath):
            continue

        # Parse repo and number from filename: "repo-name-123.md"
        stem = filename[:-3]  # remove .md
        # The number is the last segment after the last hyphen
        parts = stem.rsplit("-", 1)
        if len(parts) != 2:
            continue
        repo_name = parts[0]
        try:
            pr_number = int(parts[1])
        except ValueError:
            continue

        # Read review content
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
        except (OSError, UnicodeDecodeError):
            continue

        verdict = parse_verdict(content)
        complexity = parse_complexity(content)

        # Read metadata for date
        meta_file = os.path.join(reviews_dir, f"{stem}.meta.json")
        reviewed_at = None
        if os.path.isfile(meta_file):
            try:
                with open(meta_file, "r", encoding="utf-8") as mf:
                    meta = json.load(mf)
                reviewed_at = meta.get("current_reviewed_at", "")
            except (OSError, json.JSONDecodeError):
                pass

        # Look up author from pre-loaded inbox data
        author = author_map.get(f"{repo_name}-{pr_number}", "unknown")

        results.append(
            {
                "repo": repo_name,
                "number": pr_number,
                "verdict": verdict,
                "complexity": complexity,
                "reviewed_at": reviewed_at,
                "author": author,
            }
        )

    return results


@router.get("/analytics", response_model=AnalyticsResponse)
async def get_analytics():
    """Compute aggregate analytics across all reviews.

    Scans the reviews directory and metadata to compute:
    - Verdict distribution
    - Reviews per day
    - Size/complexity distribution
    - Reviews per product
    - Reviews per author
    """
    reviews = _scan_reviews()

    if not reviews:
        return AnalyticsResponse(
            total_reviews=0,
            verdict_distribution=VerdictDistribution(),
            reviews_per_day=[],
            size_distribution=SizeDistribution(),
            per_product=[],
            per_author=[],
        )

    # Verdict distribution
    verdict_counts: Counter[str] = Counter()
    for r in reviews:
        v = r["verdict"]
        if v is None:
            continue
        normalized = v.upper()
        if "CHANGES REQUESTED" in normalized:
            verdict_counts["changes_requested"] += 1
        elif "APPROVE WITH COMMENTS" in normalized:
            verdict_counts["approve_with_comments"] += 1
        elif "APPROVE" in normalized:
            verdict_counts["approve"] += 1

    verdict_dist = VerdictDistribution(
        approve=verdict_counts.get("approve", 0),
        changes_requested=verdict_counts.get("changes_requested", 0),
        approve_with_comments=verdict_counts.get("approve_with_comments", 0),
    )

    # Reviews per day
    day_counts: Counter[str] = Counter()
    for r in reviews:
        reviewed_at = r.get("reviewed_at", "")
        if reviewed_at:
            # Extract date portion (YYYY-MM-DD) from ISO string
            day = reviewed_at[:10]
            if len(day) == 10:
                day_counts[day] += 1

    reviews_per_day = sorted(
        [DateCount(date=d, count=c) for d, c in day_counts.items()],
        key=lambda x: x.date,
    )

    # Size distribution
    size_counts: Counter[str] = Counter()
    for r in reviews:
        c = r.get("complexity")
        if c in ("simple", "medium", "complex"):
            size_counts[c] += 1
        else:
            size_counts["medium"] += 1  # default

    size_dist = SizeDistribution(
        simple=size_counts.get("simple", 0),
        medium=size_counts.get("medium", 0),
        complex=size_counts.get("complex", 0),
    )

    # Per product
    product_counts: Counter[str] = Counter()
    for r in reviews:
        product_counts[_repo_to_product(r["repo"])] += 1

    per_product = sorted(
        [NameCount(name=p, count=c) for p, c in product_counts.items()],
        key=lambda x: -x.count,
    )

    # Per author
    author_counts: Counter[str] = Counter()
    for r in reviews:
        author_counts[r.get("author", "unknown")] += 1

    per_author = sorted(
        [NameCount(name=a, count=c) for a, c in author_counts.items()],
        key=lambda x: -x.count,
    )

    return AnalyticsResponse(
        total_reviews=len(reviews),
        verdict_distribution=verdict_dist,
        reviews_per_day=reviews_per_day,
        size_distribution=size_dist,
        per_product=per_product,
        per_author=per_author,
    )
