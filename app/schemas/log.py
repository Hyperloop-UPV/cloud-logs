"""Schemas for telemetry and diagnostic logs supporting Google Drive two-phase uploads."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.base import CamelModel


class LogInitiateRequest(CamelModel):
    """Initial request from client proposing a log upload to Google Drive."""

    file_name: str = Field(..., min_length=1, max_length=255, description="File name (e.g. telemetry_run.zip)")
    file_size: int = Field(..., ge=0, description="Size in bytes of the file to upload")
    file_date: datetime | None = Field(default=None, description="Date of capture/creation of the log")
    start_date: datetime | None = Field(default=None, description="Start timestamp of telemetry data")
    end_date: datetime | None = Field(default=None, description="End timestamp of telemetry data")
    file_hash: str | None = Field(default=None, description="Expected SHA-256 hash if pre-calculated")
    tags: list[str] = Field(default_factory=list, description="Categorization tags")
    note: str | None = Field(default=None, description="Descriptive notes or comments")
    client_metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Client system metadata (e.g. hostname, clientUser, runUuid, os, execution environment)",
    )


class LogInitiateResponse(CamelModel):
    """Server response providing upload URL and UUID for client upload to Drive."""

    id: UUID = Field(..., description="Unique UUID assigned to this log")
    upload_url: str = Field(..., description="Google Drive upload / resumable session URL")
    drive_folder: str = Field(..., description="Target year_month folder in Drive (e.g. 2026_10)")
    status: str = Field(default="pending_upload", description="Current status of the log")
    expires_in_seconds: int | None = Field(default=None, description="TTL in seconds of upload URL if applicable")


class LogCompleteRequest(CamelModel):
    """Client notification indicating upload to Google Drive has finished."""

    file_hash: str | None = Field(default=None, description="Optional SHA-256 hash calculated during upload")
    drive_file_id: str | None = Field(
        default=None,
        alias="driveFileId",
        description="Optional Google Drive file ID returned in the PUT response from Drive",
    )


class LogCompleteResponse(CamelModel):
    """Server response verifying and finalizing the upload in Google Drive."""

    id: UUID
    status: str = Field(..., description="Final status (ready or failed)")
    drive_url: str = Field(..., description="Google Drive web view/direct link to the uploaded file")
    drive_folder: str | None = None
    file_name: str
    file_size: int | None = None
    message: str = "Upload verified and completed successfully"


class LogAbortRequest(CamelModel):
    """Payload to cancel an ongoing or pending upload."""

    reason: str | None = Field(default=None, max_length=500, description="Optional cancellation reason")


class LogAbortResponse(CamelModel):
    """Confirmation that a pending log upload has been aborted."""

    id: UUID
    status: str = Field(default="aborted", description="Updated status ('aborted')")
    message: str = "Upload aborted successfully"
    aborted_at: datetime


class LogUpdateRequest(CamelModel):
    """Payload to update an existing log's tags, note, or client metadata."""

    tags: list[str] | None = Field(default=None, description="Updated list of tags")
    note: str | None = Field(default=None, description="Updated descriptive note")
    client_metadata: dict[str, Any] | None = Field(default=None, description="Updated client metadata dictionary")


class LogOut(CamelModel):
    """Public representation of a registered log entry."""

    id: UUID
    file_name: str
    status: str
    drive_folder: str | None = None
    drive_file_id: str | None = None
    drive_url: str | None = None
    file_size: int | None = None
    file_hash: str | None = None
    tags: list[str] = Field(default_factory=list)
    note: str | None = None
    client_metadata: dict[str, Any] = Field(default_factory=dict)
    file_date: datetime | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    created_by: UUID | None = None
    creator: str = "unknown"
    created_at: datetime
    completed_at: datetime | None = None

    @field_validator("tags", mode="before")
    @classmethod
    def ensure_tags(cls, v: Any) -> list[str]:
        return v if isinstance(v, list) else []

    @field_validator("client_metadata", mode="before")
    @classmethod
    def ensure_metadata(cls, v: Any) -> dict[str, Any]:
        return v if isinstance(v, dict) else {}


class LogSearchResponse(CamelModel):
    """Paginated list of logs."""

    total: int
    page: int = 1
    page_size: int = 50
    items: list[LogOut] = Field(default_factory=list)


class TagCount(CamelModel):
    """Count of logs associated with a tag."""

    tag: str
    count: int


class LogStatsResponse(CamelModel):
    """Aggregated catalog metrics and statistics."""

    total_logs: int = Field(..., description="Total active non-deleted logs")
    total_bytes: int = Field(..., description="Total size in bytes of ready logs")
    by_status: dict[str, int] = Field(default_factory=dict, description="Count of logs grouped by status")
    by_folder: dict[str, int] = Field(default_factory=dict, description="Count of logs grouped by monthly folder")
    total_tags: int = Field(..., description="Count of distinct tags")
    top_tags: list[TagCount] = Field(default_factory=list, description="Top most frequent tags")


class LogCleanupResponse(CamelModel):
    """Result of catalog cleanup operation."""

    affected_logs: int = Field(..., description="Total logs processed or modified")
    orphaned_cleaned: int = Field(..., description="Stale uncompleted logs soft-deleted")
    soft_deleted_purged: int = Field(..., description="Stale soft-deleted logs permanently purged")
    tokens_cleaned: int = Field(default=0, description="Expired and revoked refresh tokens permanently purged")
    cutoff_date: datetime = Field(..., description="Calculated cutoff threshold date")
    dry_run: bool = Field(default=False, description="Whether operation was a dry run")
    message: str = Field(..., description="Status message of the cleanup operation")


__all__ = [
    "LogAbortRequest",
    "LogAbortResponse",
    "LogCleanupResponse",
    "LogCompleteRequest",
    "LogCompleteResponse",
    "LogInitiateRequest",
    "LogInitiateResponse",
    "LogOut",
    "LogSearchResponse",
    "LogStatsResponse",
    "LogUpdateRequest",
    "TagCount",
]
