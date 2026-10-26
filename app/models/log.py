"""Database model for telemetry and diagnostic logs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class Log(Base):
    """Registered telemetry log pointing to external storage in Google Drive."""

    __tablename__ = "logs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )
    file_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(50),
        default="pending_upload",
        nullable=False,
    )
    drive_folder: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )
    drive_file_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    drive_url: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    file_size: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )
    file_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    tags: Mapped[list[str]] = mapped_column(
        JSON,
        default=list,
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    file_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    start_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    end_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    client_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    creator_user: Mapped[User | None] = relationship(
        "User",
        back_populates="logs",
    )

    @property
    def creator(self) -> str:
        return self.creator_user.username if self.creator_user else "unknown"

    __table_args__ = (
        Index("idx_logs_status", "status"),
        Index("idx_logs_drive_folder", "drive_folder"),
        Index("idx_logs_file_hash", "file_hash"),
        Index("idx_logs_created_at", "created_at"),
        Index("idx_logs_start_date", "start_date"),
    )
