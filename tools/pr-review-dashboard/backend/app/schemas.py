"""Pydantic response models for the PR Review Dashboard API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ── Inbox ────────────────────────────────────────────────────────────────────


class InboxPR(BaseModel):
    """A pull request from the inbox, enriched with review status."""

    repo: str
    number: int
    title: str
    author: str
    created_at: str
    updated_at: str
    head: str
    base: str
    head_sha: str
    additions: int = 0
    deletions: int = 0
    changed_files: int = 0
    url: str
    is_draft: bool = False
    review_decision: str = ""
    labels: list[str] = []
    comments_count: int = 0
    # Enriched fields
    has_review: bool = False
    verdict: str | None = None
    review_version: int | None = None
    review_date: str | None = None


class InboxResponse(BaseModel):
    """Response for GET /api/inbox."""

    fetched_at: str
    pull_requests: list[InboxPR]
    total: int


# ── Reviews ──────────────────────────────────────────────────────────────────


class ReviewFindings(BaseModel):
    """Counts of findings parsed from review markdown."""

    critical: int = 0
    warnings: int = 0
    suggestions: int = 0


class PostedToGitHub(BaseModel):
    """Metadata about the GitHub comment post."""

    comment_id: int | None = None
    posted_at: str | None = None
    review_hash: str | None = None


class ReviewVersion(BaseModel):
    """A version entry from review metadata."""

    version: int
    reviewed_at: str
    head_sha: str


class ReviewMetadata(BaseModel):
    """Review sidecar metadata (.meta.json)."""

    current_version: int = 1
    current_head_sha: str = ""
    current_reviewed_at: str = ""
    versions: list[ReviewVersion] = []
    posted_to_github: PostedToGitHub | None = None
    labels_applied: list[str] = []


class ReviewResponse(BaseModel):
    """Response for GET /api/reviews/{repo}/{number}."""

    repo: str
    number: int
    content: str
    metadata: ReviewMetadata | None = None
    verdict: str | None = None
    summary: str | None = None
    complexity: str | None = None
    findings: ReviewFindings


class ReviewHistoryEntry(BaseModel):
    """A single historical review version."""

    version: int
    reviewed_at: str
    head_sha: str
    content: str | None = None


class ReviewHistoryResponse(BaseModel):
    """Response for GET /api/reviews/{repo}/{number}/history."""

    repo: str
    number: int
    current_version: int
    versions: list[ReviewHistoryEntry]


# ── Pipeline ─────────────────────────────────────────────────────────────────


class PipelineStatus(BaseModel):
    """Response for GET /api/pipeline/status."""

    last_run: str | None = None
    last_status: str | None = None
    last_new_reviews: int = 0
    total_runs: int = 0
    total_reviews: int = 0
    extra: dict[str, Any] = {}


class PipelineLogsResponse(BaseModel):
    """Response for GET /api/pipeline/logs."""

    date: str
    lines: list[str]
    total_lines: int


# ── Analytics ────────────────────────────────────────────────────────────────


class VerdictDistribution(BaseModel):
    approve: int = 0
    changes_requested: int = 0
    approve_with_comments: int = 0


class DateCount(BaseModel):
    date: str
    count: int


class NameCount(BaseModel):
    name: str
    count: int


class SizeDistribution(BaseModel):
    simple: int = 0
    medium: int = 0
    complex: int = 0


class AnalyticsResponse(BaseModel):
    """Response for GET /api/analytics."""

    total_reviews: int = 0
    verdict_distribution: VerdictDistribution
    reviews_per_day: list[DateCount]
    size_distribution: SizeDistribution
    per_product: list[NameCount]
    per_author: list[NameCount]


# ── Actions ──────────────────────────────────────────────────────────────────


class ActionResponse(BaseModel):
    """Generic response for action endpoints."""

    success: bool
    message: str


class MergeRequest(BaseModel):
    """Request body for merge action."""

    confirm: bool = False


class LabelRequest(BaseModel):
    """Request body for label action."""

    labels: list[str]
