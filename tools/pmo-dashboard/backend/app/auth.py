"""Bearer token authentication dependency."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

security = HTTPBearer(auto_error=False)


async def verify_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> None:
    """Validate bearer token if AUTH_TOKEN is configured.

    If AUTH_TOKEN is empty, authentication is skipped (open access).
    Otherwise, the request must include a valid Authorization: Bearer <token> header.
    """
    if not settings.AUTH_TOKEN:
        return

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if credentials.credentials != settings.AUTH_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
