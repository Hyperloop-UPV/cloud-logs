"""FastAPI dependencies for database access, authentication, and permission enforcement."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token, verify_master_key
from app.db.session import get_db
from app.models.user import User

logger = logging.getLogger("cloud_logs.auth")


class AuthContext:
    """Authentication and authorization context for the current request."""

    def __init__(
        self,
        user: User | None = None,
        is_master: bool = False,
    ):
        self.user = user
        self.is_master = is_master

    @property
    def role(self) -> str:
        if self.is_master:
            return "admin"
        if self.user:
            return self.user.role
        return "user"

    @property
    def permissions(self) -> list[str]:
        if self.is_master:
            return ["*"]
        return [self.role]

    def has_permission(self, permission: str) -> bool:
        """Check if context holds the requested permission or role."""
        if self.is_master:
            return True
        current_role = self.role
        if current_role == "admin":
            return True
        return permission in ("user", current_role)

    def has_role(self, role: str) -> bool:
        return self.has_permission(role)


async def get_current_auth(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    """Authenticate request via Master API Key or Bearer JWT token."""
    # 1. Check Master API Key in X-API-Key header
    api_key = request.headers.get("X-API-Key")
    if api_key:
        if verify_master_key(api_key):
            logger.warning(
                "Master API Key authenticated for %s %s from %s",
                request.method,
                request.url.path,
                request.client.host if request.client else "unknown",
                extra={
                    "event": "master_api_key_authenticated",
                    "http_method": request.method,
                    "request_path": request.url.path,
                    "client_ip": request.client.host if request.client else "unknown",
                },
            )
            return AuthContext(is_master=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    # 2. Check Authorization Header (Bearer JWT or Master Key)
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization scheme, expected 'Bearer <token>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth_header[7:].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Check if Bearer token matches Master API Key
    if verify_master_key(token):
        logger.warning(
            "Master API Key authenticated via Bearer token for %s %s from %s",
            request.method,
            request.url.path,
            request.client.host if request.client else "unknown",
            extra={
                "event": "master_api_key_authenticated",
                "http_method": request.method,
                "request_path": request.url.path,
                "client_ip": request.client.host if request.client else "unknown",
            },
        )
        return AuthContext(is_master=True)

    # 4. Decode Bearer JWT access token
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Access token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_uuid = uuid.UUID(sub)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user identifier in token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    stmt = select(User).where(User.id == user_uuid)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return AuthContext(user=user, is_master=False)


def get_current_user(auth: AuthContext = Depends(get_current_auth)) -> User:
    """Return the current user from auth context or an admin user for master keys."""
    if auth.user is not None:
        return auth.user

    if auth.is_master:
        return User(
            id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
            username="master_api_key",
            github_username="system",
            role="admin",
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_permission(permission: str) -> Callable[..., AuthContext]:
    """Dependency factory checking that the authenticated caller holds the required permission."""

    async def _permission_dependency(
        auth: AuthContext = Depends(get_current_auth),
    ) -> AuthContext:
        if not auth.has_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation requires '{permission}' permission",
            )
        return auth

    return _permission_dependency


require_role = require_permission

__all__ = [
    "AuthContext",
    "get_current_auth",
    "get_current_user",
    "get_db",
    "require_permission",
    "require_role",
]
