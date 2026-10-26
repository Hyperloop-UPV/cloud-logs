from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.auth import RefreshToken
    from app.models.log import Log


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )
    username: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
    )
    github_username: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )
    github_id: Mapped[int | None] = mapped_column(
        BigInteger,
        unique=True,
        nullable=True,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        String(20),
        default="user",
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        if "permissions" in kwargs:
            perms = kwargs.pop("permissions")
            if "role" not in kwargs:
                kwargs["role"] = "admin" if (perms and "admin" in perms) else "user"
        super().__init__(*args, **kwargs)

    @property
    def permissions(self) -> list[str]:
        """Compatibility property returning [role]."""
        return [self.role]

    # Relationships
    refresh_tokens: Mapped[list[RefreshToken]] = relationship(
        "RefreshToken",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    logs: Mapped[list[Log]] = relationship(
        "Log",
        back_populates="creator_user",
    )
