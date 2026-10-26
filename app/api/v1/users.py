"""User management endpoints: list users, view user, and manage roles."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import AuthContext, require_permission
from app.models.user import User
from app.schemas.auth import UserOut, UserRoleUpdateRequest

logger = logging.getLogger("cloud_logs.users")

router = APIRouter(prefix="/users", tags=["Users"])


@router.get(
    "",
    response_model=list[UserOut],
    summary="List all registered members",
    description="Retrieve all registered users and their current roles. Admins only.",
)
async def list_users(
    auth: AuthContext = Depends(require_permission("admin")),
    db: AsyncSession = Depends(get_db),
) -> list[UserOut]:
    """List all registered users."""
    stmt = select(User).order_by(User.created_at.asc())
    result = await db.execute(stmt)
    users = result.scalars().all()
    return [UserOut.model_validate(u) for u in users]


@router.get(
    "/me",
    response_model=UserOut,
    summary="Get current user profile",
    description="Retrieve the profile of the currently authenticated user.",
)
async def get_current_user_profile(
    auth: AuthContext = Depends(require_permission("user")),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    """Retrieve currently authenticated user profile."""
    if not auth.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User profile not available for system callers",
        )
    return UserOut.model_validate(auth.user)


@router.get(
    "/{id}",
    response_model=UserOut,
    summary="Get user detail",
    description="Retrieve specific user information and permissions.",
)
async def get_user_detail(
    id: UUID = Path(..., description="UUID of the user"),
    auth: AuthContext = Depends(require_permission("user")),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    """Get single user profile."""
    # Common users can only view their own user profile; admins can view any
    if not auth.has_permission("admin") and (not auth.user or auth.user.id != id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own profile",
        )

    user = await db.get(User, id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID '{id}' was not found",
        )

    return UserOut.model_validate(user)


@router.patch(
    "/{id}/role",
    response_model=UserOut,
    summary="Assign user role (Admin or User)",
    description=(
        "Promote or demote a user's role. All users default to 'user'; "
        "only an admin or Master Key can explicitly promote a member to 'admin' or back to 'user'."
    ),
)
@router.put(
    "/{id}/role",
    response_model=UserOut,
    include_in_schema=False,
)
async def update_user_role(
    id: UUID = Path(..., description="UUID of the user to update"),
    payload: UserRoleUpdateRequest = Body(...),
    auth: AuthContext = Depends(require_permission("admin")),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    """Update role/permissions of a member."""
    user = await db.get(User, id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID '{id}' was not found",
        )

    old_role = user.role
    new_role = payload.role
    user.role = new_role
    await db.commit()
    await db.refresh(user)

    actor_desc = "Master Key" if auth.is_master else f"Admin {auth.user.username if auth.user else 'unknown'}"
    logger.info(
        "User role updated: user_id=%s, username=%s, old_role=%s, new_role=%s, changed_by=%s",
        user.id,
        user.username,
        old_role,
        new_role,
        actor_desc,
    )

    return UserOut.model_validate(user)


__all__ = ["router"]
