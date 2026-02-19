"""
Google Sheets Sync Router

Provides endpoints for bidirectional sync between the supplier database
and a Google Sheet. Integrated into the suppliers API namespace.

Endpoints:
    POST /api/suppliers/sync-to-sheet   -> Export DB to Sheet
    POST /api/suppliers/sync-from-sheet -> Import Sheet to DB
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..database import get_db
from ..services.sheet_mirror import SheetMirror

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/suppliers", tags=["suppliers", "sheet-sync"])


def _get_sheet_mirror() -> SheetMirror:
    """
    Build a SheetMirror instance from application settings.

    Raises HTTPException 503 if Google Sheets is not configured.
    """
    settings = Settings()

    if not settings.GOOGLE_CREDENTIALS_PATH:
        raise HTTPException(
            status_code=503,
            detail="Google Sheets sync is not configured: "
                   "GOOGLE_CREDENTIALS_PATH is not set.",
        )
    if not settings.GOOGLE_SHEET_ID:
        raise HTTPException(
            status_code=503,
            detail="Google Sheets sync is not configured: "
                   "GOOGLE_SHEET_ID is not set.",
        )

    return SheetMirror(
        credentials_path=settings.GOOGLE_CREDENTIALS_PATH,
        sheet_id=settings.GOOGLE_SHEET_ID,
    )


@router.post("/sync-to-sheet")
async def sync_to_sheet(db: AsyncSession = Depends(get_db)):
    """
    Export all supplier data from the database to a Google Sheet.

    Clears existing sheet content and rewrites all data.

    Returns:
        JSON with status, sheet_url, and rows_synced counts.
    """
    mirror = _get_sheet_mirror()

    try:
        result = await mirror.sync_to_sheet(db)
        return result
    except Exception as e:
        logger.exception("Failed to sync to Google Sheet")
        raise HTTPException(
            status_code=500,
            detail=f"Google Sheets sync failed: {str(e)}",
        )


@router.post("/sync-from-sheet")
async def sync_from_sheet(db: AsyncSession = Depends(get_db)):
    """
    Read supplier data from the Google Sheet and upsert into the database.

    - Rows with an ID: matched and updated in DB.
    - Rows without an ID: created as new records.
    - Rows removed from the sheet are NOT deleted from DB (safety).

    Returns:
        JSON with status and per-entity imported/updated counts.
    """
    mirror = _get_sheet_mirror()

    try:
        result = await mirror.sync_from_sheet(db)
        return result
    except Exception as e:
        logger.exception("Failed to sync from Google Sheet")
        raise HTTPException(
            status_code=500,
            detail=f"Google Sheets import failed: {str(e)}",
        )
