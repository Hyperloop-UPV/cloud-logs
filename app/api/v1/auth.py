"""Authentication endpoints: GitHub OAuth, token refresh, logout, and profile."""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.github import (
    check_github_org_membership,
    exchange_code_for_token,
    get_github_auth_url,
    get_github_user_profile,
)
from app.core.security import (
    create_access_token,
    generate_random_token,
    hash_token,
)
from app.dependencies import get_current_user, get_db
from app.models.auth import RefreshToken
from app.models.user import User
from app.schemas.auth import (
    GitHubAuthURL,
    RefreshTokenRequest,
    TokenResponse,
    UserOut,
)

logger = logging.getLogger("cloud_logs.auth")

router = APIRouter()


@router.get(
    "/login",
    response_model=GitHubAuthURL,
    summary="Get GitHub OAuth login URL",
    tags=["Authentication"],
)
@router.get(
    "/github/login",
    response_model=GitHubAuthURL,
    include_in_schema=False,
)
async def login(
    response: Response,
    redirect: bool = Query(
        default=False, description="Redirect browser directly to GitHub login"
    ),
) -> Any:
    """Generate GitHub OAuth URL with a secure random state and set CSRF cookie."""
    state = generate_random_token(32)
    response.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        secure=settings.environment != "development",
        samesite="lax",
        max_age=600,
        path="/api/v1/auth",
    )
    auth_url = get_github_auth_url(state)
    if redirect:
        return RedirectResponse(
            url=auth_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT
        )
    return GitHubAuthURL(authorization_url=auth_url)


@router.get(
    "/callback",
    response_model=TokenResponse,
    summary="GitHub OAuth callback",
    tags=["Authentication"],
)
@router.get(
    "/github/callback",
    response_model=TokenResponse,
    include_in_schema=False,
)
async def callback(
    request: Request,
    response: Response,
    code: str,
    state: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Process GitHub OAuth callback, verify membership, register/update user, and issue tokens."""
    # 0. Validate OAuth state parameter against CSRF cookie (mandatory)
    cookie_state = request.cookies.get("oauth_state")
    if not cookie_state or not state or not secrets.compare_digest(state, cookie_state):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OAuth state parameter: CSRF validation failed",
        )
    response.delete_cookie(key="oauth_state", path="/api/v1/auth")

    # 1. Exchange temporary authorization code for GitHub access token
    gh_token = await exchange_code_for_token(code)

    # 2. Retrieve user profile from GitHub
    profile = await get_github_user_profile(gh_token)
    gh_id = profile.get("id")
    gh_login = profile.get("login")

    if not gh_id or not gh_login:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid GitHub profile payload",
        )

    # 3. Check organization whitelist if configured
    if settings.github_org_name:
        is_member = await check_github_org_membership(
            gh_token, settings.github_org_name
        )
        if not is_member:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"User is not a member of required organization: {settings.github_org_name}",
            )

    # 4. Find or create user in database
    stmt = select(User).where(User.github_id == gh_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None:
        # Check if username collision exists
        uname_stmt = select(User).where(User.username == gh_login)
        collision = (await db.execute(uname_stmt)).scalar_one_or_none()
        app_username = gh_login if collision is None else f"{gh_login}_{gh_id}"

        user = User(
            username=app_username,
            github_username=gh_login,
            github_id=gh_id,
            role="user",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        # Keep GitHub username in sync
        if user.github_username != gh_login:
            user.github_username = gh_login
            await db.commit()
            await db.refresh(user)

    # 5. Generate 15-minute JWT Access Token
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})

    # 6. Generate 90-day Refresh Token and store hash in database
    raw_refresh = generate_random_token(48)
    token_hash = hash_token(raw_refresh)
    family_id = uuid.uuid4()
    expires_at = datetime.now(UTC) + timedelta(
        days=settings.refresh_token_expire_days
    )

    db_refresh = RefreshToken(
        user_id=user.id,
        token_hash=token_hash,
        family_id=family_id,
        is_revoked=False,
        expires_at=expires_at,
    )
    db.add(db_refresh)
    await db.commit()

    # 7. Set secure HttpOnly cookie
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh,
        httponly=True,
        secure=settings.environment != "development",
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/v1/auth",
    )

    return TokenResponse(
        access_token=access_token,
        token_type="Bearer",
        expires_in=settings.access_token_expire_minutes * 60,
        refresh_token=raw_refresh,
        user=UserOut.model_validate(user),
    )


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Refresh access token",
    tags=["Authentication"],
)
async def refresh_token(
    request: Request,
    response: Response,
    body: RefreshTokenRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Rotate refresh token and issue a new 15-minute access token."""
    raw_token = (
        (body.refresh_token if body and body.refresh_token else None)
        or request.cookies.get("refresh_token")
        or request.headers.get("X-Refresh-Token")
    )

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token required",
        )

    t_hash = hash_token(raw_token)
    stmt = select(RefreshToken).where(RefreshToken.token_hash == t_hash)
    result = await db.execute(stmt)
    token_record = result.scalar_one_or_none()

    if token_record is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    # Refresh Token Rotation: Detect reuse of an already-revoked token
    if token_record.is_revoked:
        logger.warning(
            "Revoked refresh token reuse detected for user %s in family %s! Revoking family.",
            token_record.user_id,
            token_record.family_id,
        )
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == token_record.family_id)
            .values(is_revoked=True)
        )
        await db.commit()
        response.delete_cookie(key="refresh_token", path="/api/v1/auth")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has been revoked",
        )

    # Check expiration
    now = datetime.now(UTC)
    expires_at = token_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)

    if expires_at < now:
        token_record.is_revoked = True
        await db.commit()
        response.delete_cookie(key="refresh_token", path="/api/v1/auth")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired",
        )

    user = await db.get(User, token_record.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Associated user not found",
        )

    # Rotate token: revoke current token and create new one with same family_id
    token_record.is_revoked = True

    new_raw_token = generate_random_token(48)
    new_token_hash = hash_token(new_raw_token)
    new_expires_at = now + timedelta(days=settings.refresh_token_expire_days)

    new_refresh = RefreshToken(
        user_id=user.id,
        token_hash=new_token_hash,
        family_id=token_record.family_id,
        is_revoked=False,
        expires_at=new_expires_at,
    )
    db.add(new_refresh)
    await db.commit()

    # Generate new access token
    new_access_token = create_access_token(
        data={"sub": str(user.id), "role": user.role}
    )

    response.set_cookie(
        key="refresh_token",
        value=new_raw_token,
        httponly=True,
        secure=settings.environment != "development",
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/v1/auth",
    )

    return TokenResponse(
        access_token=new_access_token,
        token_type="Bearer",
        expires_in=settings.access_token_expire_minutes * 60,
        refresh_token=new_raw_token,
        user=UserOut.model_validate(user),
    )


@router.post(
    "/logout",
    summary="Logout and revoke refresh token",
    tags=["Authentication"],
)
async def logout(
    request: Request,
    response: Response,
    body: RefreshTokenRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Revoke refresh token and clear client authentication cookie."""
    raw_token = (
        (body.refresh_token if body and body.refresh_token else None)
        or request.cookies.get("refresh_token")
        or request.headers.get("X-Refresh-Token")
    )

    if raw_token:
        t_hash = hash_token(raw_token)
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.token_hash == t_hash)
            .values(is_revoked=True)
        )
        await db.commit()

    response.delete_cookie(key="refresh_token", path="/api/v1/auth")
    return {"message": "Logged out successfully"}


@router.get(
    "/me",
    response_model=UserOut,
    summary="Get authenticated user profile",
    tags=["Authentication"],
)
async def get_me(user: User = Depends(get_current_user)) -> UserOut:
    """Retrieve public profile of the currently authenticated user."""
    return UserOut.model_validate(user)


__all__ = ["router"]
