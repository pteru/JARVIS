"""Schedule endpoints for project tasks and milestones."""

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import ScheduleMilestone, ScheduleTask
from ..schemas import (
    ScheduleData,
    ScheduleMilestoneOut,
    ScheduleTaskCreate,
    ScheduleTaskOut,
    ScheduleTaskUpdate,
)

router = APIRouter(tags=["schedule"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_filesystem_schedule(project_code: str) -> Optional[dict]:
    """Try to load schedule.json from the project's PMO folder."""
    schedule_path = Path(settings.PMO_ROOT) / "pmo" / project_code / "schedule.json"
    if not schedule_path.is_file():
        # Also check without 'pmo' subdirectory
        schedule_path = Path(settings.PMO_ROOT) / project_code / "schedule.json"
    if not schedule_path.is_file():
        return None
    try:
        with open(schedule_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/api/projects/{project_code}/schedule",
    response_model=ScheduleData,
)
async def get_schedule(
    project_code: str,
    db: AsyncSession = Depends(get_db),
):
    """Return tasks and milestones for a project.

    If no DB data exists, attempt to load from filesystem schedule.json.
    """
    # Fetch tasks from DB
    task_result = await db.execute(
        select(ScheduleTask)
        .where(ScheduleTask.project_code == project_code)
        .order_by(ScheduleTask.start_date.asc().nulls_last(), ScheduleTask.id)
    )
    tasks = task_result.scalars().all()

    # Fetch milestones from DB
    ms_result = await db.execute(
        select(ScheduleMilestone)
        .where(ScheduleMilestone.project_code == project_code)
        .order_by(
            ScheduleMilestone.target_date.asc().nulls_last(),
            ScheduleMilestone.id,
        )
    )
    milestones = ms_result.scalars().all()

    # If DB has data, return it
    if tasks or milestones:
        return ScheduleData(
            tasks=[ScheduleTaskOut.model_validate(t) for t in tasks],
            milestones=[ScheduleMilestoneOut.model_validate(m) for m in milestones],
        )

    # Fall back to filesystem
    fs_data = _load_filesystem_schedule(project_code)
    if fs_data is None:
        return ScheduleData(tasks=[], milestones=[])

    # Parse filesystem data into response (best-effort)
    fs_tasks = []
    for t in fs_data.get("tasks", []):
        depends = t.get("depends_on")
        if isinstance(depends, list):
            depends = json.dumps(depends)
        fs_tasks.append(
            ScheduleTaskOut(
                id=0,
                project_code=project_code,
                task_id=t.get("task_id", t.get("id", "")),
                name=t.get("name", ""),
                category=t.get("category"),
                start_date=t.get("start_date"),
                end_date=t.get("end_date"),
                status=t.get("status", "pending"),
                depends_on=depends,
                assignee=t.get("assignee"),
                supplier=t.get("supplier"),
                notes=t.get("notes"),
                is_critical=t.get("is_critical", False),
            )
        )

    fs_milestones = []
    for m in fs_data.get("milestones", []):
        fs_milestones.append(
            ScheduleMilestoneOut(
                id=0,
                project_code=project_code,
                milestone_id=m.get("milestone_id", m.get("id", "")),
                name=m.get("name", ""),
                target_date=m.get("target_date"),
                status=m.get("status", "on_track"),
            )
        )

    return ScheduleData(tasks=fs_tasks, milestones=fs_milestones)


@router.post(
    "/api/projects/{project_code}/schedule/tasks",
    response_model=ScheduleTaskOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_task(
    project_code: str,
    body: ScheduleTaskCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new schedule task for a project."""
    # Check for duplicate task_id within the project
    existing = await db.execute(
        select(ScheduleTask).where(
            ScheduleTask.project_code == project_code,
            ScheduleTask.task_id == body.task_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Task '{body.task_id}' already exists for project {project_code}",
        )

    task = ScheduleTask(project_code=project_code, **body.model_dump())
    db.add(task)
    await db.flush()
    await db.refresh(task)
    return ScheduleTaskOut.model_validate(task)


@router.put(
    "/api/projects/{project_code}/schedule/tasks/{task_id}",
    response_model=ScheduleTaskOut,
)
async def update_task(
    project_code: str,
    task_id: str,
    body: ScheduleTaskUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a schedule task.

    The task_id parameter is the short task identifier (e.g. 'acq1'),
    not the database primary key.
    """
    result = await db.execute(
        select(ScheduleTask).where(
            ScheduleTask.project_code == project_code,
            ScheduleTask.task_id == task_id,
        )
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task '{task_id}' not found for project {project_code}",
        )

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(task, key, value)
    await db.flush()
    await db.refresh(task)
    return ScheduleTaskOut.model_validate(task)
