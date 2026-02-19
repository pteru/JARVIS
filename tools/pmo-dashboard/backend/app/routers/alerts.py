"""Alert endpoints for project notifications."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Alert
from ..schemas import AlertCreate, AlertOut

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertOut])
async def list_alerts(
    project_code: Optional[str] = Query(None, description="Filter by project code"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    unread_only: bool = Query(False, description="Show only unread/undismissed alerts"),
    db: AsyncSession = Depends(get_db),
):
    """List alerts with optional filters."""
    stmt = select(Alert).order_by(Alert.created_at.desc())

    if project_code:
        stmt = stmt.where(Alert.project_code == project_code)
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if unread_only:
        stmt = stmt.where(Alert.dismissed_at.is_(None))

    result = await db.execute(stmt)
    alerts = result.scalars().all()
    return [AlertOut.model_validate(a) for a in alerts]


@router.post("", response_model=AlertOut, status_code=status.HTTP_201_CREATED)
async def create_alert(
    body: AlertCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new alert."""
    alert = Alert(**body.model_dump())
    db.add(alert)
    await db.flush()
    await db.refresh(alert)
    return AlertOut.model_validate(alert)


@router.put("/{alert_id}/dismiss", response_model=AlertOut)
async def dismiss_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Dismiss an alert by setting its dismissed_at timestamp."""
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found",
        )

    alert.dismissed_at = datetime.now(timezone.utc)
    alert.is_read = True
    await db.flush()
    await db.refresh(alert)
    return AlertOut.model_validate(alert)
