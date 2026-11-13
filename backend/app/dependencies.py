"""FastAPI dependencies for database access, authentication, and permission enforcement."""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Callable, Coroutine
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.github import parse_github_username
from app.core.security import (
    decode_access_token,
    log_master_key_usage,
    log_medium_key_usage,
    verify_master_key,
    verify_medium_key,
)
from app.db.session import get_db
from app.models.user import User

logger = logging.getLogger("cloud_logs.auth")


class AuthContext:
    """Authentication and authorization context for the current request."""

    def __init__(
        self,
        user: User | None = None,
        is_master: bool = False,
        is_medium: bool = False,
    ):
        self.user = user
        self.is_master = is_master
        self.is_medium = is_medium

    @property
    def role(self) -> str:
        if self.is_master:
            return "admin"
        if self.is_medium:
            return "medium"
        if self.user:
            return self.user.role
        return "user"

    @property
    def permissions(self) -> list[str]:
        if self.is_master:
            return ["*"]
        if self.is_medium:
            return ["user", "upload", "download"]
        return [self.role]

    def has_permission(self, permission: str) -> bool:
        """Check if context holds the requested permission or role."""
        if self.is_master:
            return True
        if self.is_medium:
            if permission == "admin":
                return False
            return permission in ("user", "upload", "download", "medium")
        current_role = self.role
        if current_role == "admin":
            return True
        return permission in ("user", current_role)

    def has_role(self, role: str) -> bool:
        return self.has_permission(role)


async def _resolve_medium_auth(
    request: Request,
    db: AsyncSession,
) -> AuthContext:
    """Resolve authentication for medium_api_key, extracting and parsing optional user."""
    log_medium_key_usage(request)

    raw_user: str | None = request.headers.get("X-User") or request.query_params.get(
        "user"
    )
    if not raw_user and request.method == "POST":
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type.lower():
            try:
                body_bytes = await request.body()
                if body_bytes:
                    body_json = json.loads(body_bytes)
                    if isinstance(body_json, dict) and "user" in body_json:
                        raw_user = body_json.get("user")
            except (json.JSONDecodeError, UnicodeDecodeError) as err:
                logger.debug("Failed to decode JSON body when extracting user: %s", err)

    resolved_user: User | None = None
    if raw_user:
        username = parse_github_username(raw_user)
        if not username:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid 'user' parameter: unable to parse GitHub username",
            )
        stmt = select(User).where(
            or_(
                func.lower(User.github_username) == username.lower(),
                func.lower(User.username) == username.lower(),
            )
        )
        result = await db.execute(stmt)
        resolved_user = result.scalar_one_or_none()
        if resolved_user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User '{username}' not found. The user must sign in to the platform before logs can be uploaded on their behalf.",
            )

    return AuthContext(user=resolved_user, is_medium=True)


async def get_current_auth(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    """Authenticate request via Master API Key, Medium API Key, or Bearer JWT token."""
    # 1. Check API Key in X-API-Key header
    api_key = request.headers.get("X-API-Key")
    if api_key:
        if verify_master_key(api_key):
            log_master_key_usage(request)
            return AuthContext(is_master=True)
        if verify_medium_key(api_key):
            return await _resolve_medium_auth(request, db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    # 2. Check Authorization Header (Bearer JWT / API Key) or query param ?token=
    auth_header = request.headers.get("Authorization")
    token = None
    if auth_header:
        if not auth_header.lower().startswith("bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authorization scheme, expected 'Bearer <token>'",
                headers={"WWW-Authenticate": "Bearer"},
            )
        token = auth_header[7:].strip()
    elif "token" in request.query_params:
        token = request.query_params.get("token", "").strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Check if token matches Master API Key or Medium API Key
    if verify_master_key(token):
        log_master_key_usage(request)
        return AuthContext(is_master=True)

    if verify_medium_key(token):
        return await _resolve_medium_auth(request, db)

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


def require_permission(
    permission: str,
) -> Callable[..., Coroutine[Any, Any, AuthContext]]:
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
