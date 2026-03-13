"""GET /api/pipeline/* — Pipeline status and logs."""

from __future__ import annotations

import json
import os
from datetime import date

from fastapi import APIRouter, HTTPException, Query

from ..config import settings
from ..schemas import PipelineLogsResponse, PipelineStatus

router = APIRouter(tags=["pipeline"])


@router.get("/pipeline/status", response_model=PipelineStatus)
async def get_pipeline_status():
    """Return the current pipeline state from data/state.json."""
    state_file = os.path.join(settings.data_dir, "state.json")

    if not os.path.isfile(state_file):
        # Return empty status if state file doesn't exist yet
        return PipelineStatus()

    try:
        with open(state_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to read state file: {exc}"
        )

    # Extract known fields, put the rest in extra
    known_keys = {
        "last_run",
        "last_status",
        "last_new_reviews",
        "total_runs",
        "total_reviews",
    }
    extra = {k: v for k, v in data.items() if k not in known_keys}

    return PipelineStatus(
        last_run=data.get("last_run"),
        last_status=data.get("last_status"),
        last_new_reviews=data.get("last_new_reviews", 0),
        total_runs=data.get("total_runs", 0),
        total_reviews=data.get("total_reviews", 0),
        extra=extra,
    )


@router.get("/pipeline/logs", response_model=PipelineLogsResponse)
async def get_pipeline_logs(
    lines: int = Query(default=100, ge=1, le=5000),
    log_date: str | None = Query(
        default=None,
        description="Date in YYYY-MM-DD format. Defaults to today.",
    ),
):
    """Tail the pipeline log file for a given date.

    Reads logs/run-YYYY-MM-DD.log and returns the last N lines.
    """
    if log_date is None:
        log_date = date.today().isoformat()

    log_file = os.path.join(settings.logs_dir, f"run-{log_date}.log")

    if not os.path.isfile(log_file):
        raise HTTPException(
            status_code=404, detail=f"Log file not found for date {log_date}"
        )

    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to read log file: {exc}"
        )

    total = len(all_lines)
    # Tail: return last N lines
    tail = all_lines[-lines:] if len(all_lines) > lines else all_lines
    # Strip trailing newlines for cleaner JSON
    tail = [line.rstrip("\n") for line in tail]

    return PipelineLogsResponse(
        date=log_date,
        lines=tail,
        total_lines=total,
    )
