"""SQLAlchemy 2.0 async engine and session configuration."""

from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

from app.config import settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""
    pass


def _get_engine_url() -> str:
    db_path = Path(settings.DB_PATH)
    return f"sqlite+aiosqlite:///{db_path}"


engine = create_async_engine(
    _get_engine_url(),
    echo=False,
)


async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_db() -> None:
    """Create all tables and enable WAL mode + foreign keys."""
    from app import models  # noqa: F401

    db_path = Path(settings.DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA foreign_keys=ON"))
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """FastAPI dependency that yields a database session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
