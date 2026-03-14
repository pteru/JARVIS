"""POST /api/actions/* — Action endpoints for posting, merging, labeling, closing PRs."""

from __future__ import annotations

import asyncio
import logging
import os

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..schemas import ActionResponse, CloseRequest, LabelRequest, MergeRequest

router = APIRouter(tags=["actions"])
logger = logging.getLogger(__name__)

ORG = settings.gh_org


async def _run_command(cmd: list[str], timeout: float = 60) -> tuple[int, str, str]:
    """Run a shell command asynchronously and return (returncode, stdout, stderr)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
        return (
            proc.returncode or 0,
            stdout.decode("utf-8", errors="replace"),
            stderr.decode("utf-8", errors="replace"),
        )
    except asyncio.TimeoutError:
        proc.kill()  # type: ignore[union-attr]
        return 1, "", "Command timed out"
    except FileNotFoundError:
        return 1, "", f"Command not found: {cmd[0]}"


# ── Post review to GitHub ────────────────────────────────────────────────────


@router.post(
    "/actions/reviews/{repo}/{number}/post",
    response_model=ActionResponse,
)
async def post_review(repo: str, number: int):
    """Post a review as a GitHub PR comment.

    Runs the clean-review.sh script to clean the markdown, then posts
    via gh API (mirrors what post-review.sh does).
    """
    review_file = os.path.join(settings.reviews_dir, f"{repo}-{number}.md")
    if not os.path.isfile(review_file):
        raise HTTPException(
            status_code=404, detail=f"Review not found: {repo}#{number}"
        )

    # Clean the review content
    clean_script = os.path.join(settings.scripts_dir, "clean-review.sh")
    if os.path.isfile(clean_script):
        returncode, stdout, stderr = await _run_command(
            ["bash", clean_script, review_file]
        )
        if returncode != 0:
            logger.warning(
                "clean-review.sh failed (rc=%d): %s", returncode, stderr
            )
            # Fall back to raw content
            with open(review_file, "r", encoding="utf-8") as f:
                body = f.read()
        else:
            body = stdout
    else:
        with open(review_file, "r", encoding="utf-8") as f:
            body = f.read()

    # Add banner
    banner = "> :robot: **JARVIS AI Review** (dashboard) -- auto-generated"
    body = f"{banner}\n\n{body}"

    # Post via gh API
    returncode, stdout, stderr = await _run_command(
        [
            "gh",
            "api",
            f"repos/{ORG}/{repo}/issues/{number}/comments",
            "--method",
            "POST",
            "--field",
            f"body={body}",
            "--jq",
            ".id",
        ],
        timeout=30,
    )

    if returncode != 0:
        return ActionResponse(
            success=False,
            message=f"Failed to post comment: {stderr.strip()}",
        )

    comment_id = stdout.strip()
    return ActionResponse(
        success=True,
        message=f"Review posted as comment #{comment_id} on {repo}#{number}",
    )


# ── Merge PR ─────────────────────────────────────────────────────────────────


@router.post(
    "/actions/prs/{repo}/{number}/merge",
    response_model=ActionResponse,
)
async def merge_pr(repo: str, number: int, request: MergeRequest):
    """Merge a PR using squash merge.

    Requires {"confirm": true} in the request body as a safety guard.
    """
    if not request.confirm:
        raise HTTPException(
            status_code=400,
            detail='Merge requires {"confirm": true} in request body',
        )

    returncode, stdout, stderr = await _run_command(
        [
            "gh",
            "pr",
            "merge",
            str(number),
            "--repo",
            f"{ORG}/{repo}",
            "--squash",
            "--delete-branch",
        ],
        timeout=60,
    )

    if returncode != 0:
        return ActionResponse(
            success=False,
            message=f"Merge failed: {stderr.strip()}",
        )

    return ActionResponse(
        success=True,
        message=f"Successfully merged {repo}#{number} (squash)",
    )


# ── Add labels to PR ────────────────────────────────────────────────────────


@router.post(
    "/actions/prs/{repo}/{number}/labels",
    response_model=ActionResponse,
)
async def add_labels(repo: str, number: int, request: LabelRequest):
    """Add labels to a PR via gh CLI."""
    if not request.labels:
        raise HTTPException(
            status_code=400, detail="At least one label is required"
        )

    label_csv = ",".join(request.labels)
    returncode, stdout, stderr = await _run_command(
        [
            "gh",
            "pr",
            "edit",
            str(number),
            "--repo",
            f"{ORG}/{repo}",
            "--add-label",
            label_csv,
        ],
        timeout=30,
    )

    if returncode != 0:
        return ActionResponse(
            success=False,
            message=f"Failed to add labels: {stderr.strip()}",
        )

    return ActionResponse(
        success=True,
        message=f"Labels [{label_csv}] added to {repo}#{number}",
    )


# ── Force pipeline run ──────────────────────────────────────────────────────


@router.post(
    "/actions/pipeline/force-run",
    response_model=ActionResponse,
)
async def force_pipeline_run():
    """Trigger the pipeline run.sh --force in the background.

    Returns immediately; the pipeline runs asynchronously.
    """
    run_script = os.path.join(settings.scripts_dir, "run.sh")
    if not os.path.isfile(run_script):
        return ActionResponse(
            success=False,
            message=f"Pipeline script not found: {run_script}",
        )

    try:
        # Fire-and-forget: start the process but don't wait for it
        proc = await asyncio.create_subprocess_exec(
            "bash",
            run_script,
            "--force",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        return ActionResponse(
            success=True,
            message=f"Pipeline started (PID {proc.pid}). Check logs for progress.",
        )
    except (OSError, FileNotFoundError) as exc:
        return ActionResponse(
            success=False,
            message=f"Failed to start pipeline: {exc}",
        )


# ── Re-review PR ──────────────────────────────────────────────────────────


@router.post(
    "/actions/reviews/{repo}/{number}/re-review",
    response_model=ActionResponse,
)
async def re_review(repo: str, number: int):
    """Trigger a re-review of a PR.

    Runs review-pr.sh then upload-to-drive.mjs asynchronously.
    Returns immediately; the review runs in the background.
    """
    review_script = os.path.join(settings.scripts_dir, "review-pr.sh")
    upload_script = os.path.join(settings.scripts_dir, "upload-to-drive.mjs")

    if not os.path.isfile(review_script):
        return ActionResponse(
            success=False,
            message=f"Review script not found: {review_script}",
        )

    async def _run_re_review():
        """Run review script then upload script sequentially."""
        env = {**os.environ, "SERVICE_DIR": settings.service_data_dir}
        proc = await asyncio.create_subprocess_exec(
            "bash", review_script, "--repo", repo, "--pr", str(number),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            env=env,
        )
        await proc.wait()
        if os.path.isfile(upload_script):
            await asyncio.create_subprocess_exec(
                "node", upload_script,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                env=env,
            )

    try:
        # Fire-and-forget: start the async task
        asyncio.create_task(_run_re_review())
        return ActionResponse(
            success=True,
            message=f"Re-review started for {repo}#{number}. Check logs for progress.",
        )
    except (OSError, FileNotFoundError) as exc:
        return ActionResponse(
            success=False,
            message=f"Failed to start re-review: {exc}",
        )


# ── Close PR ──────────────────────────────────────────────────────────────


@router.post(
    "/actions/prs/{repo}/{number}/close",
    response_model=ActionResponse,
)
async def close_pr(repo: str, number: int, request: CloseRequest):
    """Close a PR without merging.

    Requires {"confirm": true} in the request body as a safety guard.
    """
    if not request.confirm:
        raise HTTPException(
            status_code=400,
            detail='Close requires {"confirm": true} in request body',
        )

    returncode, stdout, stderr = await _run_command(
        [
            "gh",
            "pr",
            "close",
            str(number),
            "--repo",
            f"{ORG}/{repo}",
        ],
        timeout=30,
    )

    if returncode != 0:
        return ActionResponse(
            success=False,
            message=f"Close failed: {stderr.strip()}",
        )

    return ActionResponse(
        success=True,
        message=f"Successfully closed {repo}#{number}",
    )
