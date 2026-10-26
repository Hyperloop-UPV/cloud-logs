"""Authentication schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.base import CamelModel


class UserOut(CamelModel):
    """Public representation of a user."""

    id: UUID
    username: str
    github_username: str | None = None
    role: str = "user"
    created_at: datetime | None = None


class UserRoleUpdateRequest(CamelModel):
    """Payload to assign a role ('admin' or 'user') to a member."""

    role: str = Field(..., description="Role to assign: 'admin' or 'user'")

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ("admin", "user"):
            raise ValueError("Role must be either 'admin' or 'user'")
        return clean


class TokenResponse(CamelModel):
    """OAuth/JWT token response."""

    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    refresh_token: str | None = None
    user: UserOut | None = None


class RefreshTokenRequest(CamelModel):
    """Refresh token request payload."""

    refresh_token: str | None = None


class GitHubAuthURL(CamelModel):
    """GitHub OAuth redirect URL."""

    authorization_url: str


__all__ = [
    "GitHubAuthURL",
    "RefreshTokenRequest",
    "TokenResponse",
    "UserOut",
    "UserRoleUpdateRequest",
]
