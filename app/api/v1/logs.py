"""Endpoints for telemetry and diagnostic logs (Google Drive two-phase workflow)."""

from __future__ import annotations

import collections
import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Body,
    Depends,
    HTTPException,
    Path,
    Query,
    Response,
    status,
)
from fastapi.responses import RedirectResponse
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.cleanup import execute_cleanup
from app.core.gdrive import (
    GoogleDriveService,
    get_gdrive_service,
    get_year_month_folder,
)
from app.db.session import get_db
from app.dependencies import AuthContext, get_current_auth, require_permission
from app.models.log import Log
from app.models.user import User
from app.schemas.log import (
    LogAbortRequest,
    LogAbortResponse,
    LogCleanupResponse,
    LogCompleteRequest,
    LogCompleteResponse,
    LogInitiateRequest,
    LogInitiateResponse,
    LogOut,
    LogSearchResponse,
    LogStatsResponse,
    LogUpdateRequest,
    TagCount,
)

logger = logging.getLogger("cloud_logs.logs")

router = APIRouter(tags=["Logs"])


def check_log_modification_permission(log: Log, auth: AuthContext) -> None:
    """Ensure caller has permission to modify or delete the log:
    Must be Master API Key, an Admin user, or the owner/creator of the log.
    """
    if auth.is_master or auth.has_permission("admin"):
        return
    if auth.user and log.created_by == auth.user.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to modify or delete this log",
    )


@router.post(
    "/initiate",
    response_model=LogInitiateResponse,
    status_code=status.HTTP_200_OK,
    summary="Initiate log upload to Google Drive",
    description=(
        "First phase of log creation. Registers initial metadata, determines target "
        "YYYY_MM Google Drive folder, and returns a pre-signed or resumable Google Drive upload URL."
    ),
)
async def initiate_log_upload(
    payload: LogInitiateRequest,
    auth: AuthContext = Depends(require_permission("user")),
    db: AsyncSession = Depends(get_db),
    gdrive: GoogleDriveService = Depends(get_gdrive_service),
) -> LogInitiateResponse:
    """Initiate two-phase upload to Google Drive."""
    target_folder = get_year_month_folder(payload.file_date)
    log_id = uuid4()

    upload_url, drive_file_id = await gdrive.create_resumable_upload_session(
        file_name=payload.file_name,
        file_size=payload.file_size,
        folder_name=target_folder,
        log_id=log_id,
    )

    creator_id = auth.user.id if auth.user else None

    new_log = Log(
        id=log_id,
        file_name=payload.file_name,
        status="pending_upload",
        drive_folder=target_folder,
        drive_file_id=drive_file_id,
        file_size=payload.file_size,
        file_hash=payload.file_hash,
        tags=payload.tags,
        note=payload.note,
        file_date=payload.file_date,
        start_date=payload.start_date,
        end_date=payload.end_date,
        client_metadata=payload.client_metadata,
        created_by=creator_id,
        created_at=datetime.now(UTC),
    )

    db.add(new_log)
    await db.commit()

    logger.info("Initiated log upload ID %s in folder %s", log_id, target_folder)

    return LogInitiateResponse(
        id=new_log.id,
        upload_url=upload_url,
        drive_folder=target_folder,
        status=new_log.status,
        expires_in_seconds=86400,
    )


@router.post(
    "/{id}/complete",
    response_model=LogCompleteResponse,
    status_code=status.HTTP_200_OK,
    summary="Confirm and complete log upload to Google Drive",
    description=(
        "Second phase of log creation. Client notifies server that bytes have been uploaded to Drive. "
        "Server verifies file existence/size in Google Drive and updates status to ready."
    ),
)
async def complete_log_upload(
    id: UUID = Path(..., description="UUID of the log to finalize"),
    payload: LogCompleteRequest = Body(default_factory=LogCompleteRequest),
    auth: AuthContext = Depends(require_permission("user")),
    db: AsyncSession = Depends(get_db),
    gdrive: GoogleDriveService = Depends(get_gdrive_service),
) -> LogCompleteResponse:
    """Confirm and verify upload in Google Drive."""
    stmt = select(Log).where(Log.id == id, Log.deleted_at.is_(None))
    result = await db.execute(stmt)
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Log with ID '{id}' was not found",
        )

    check_log_modification_permission(log, auth)

    if log.status == "ready":
        return LogCompleteResponse(
            id=log.id,
            status=log.status,
            drive_url=log.drive_url or f"https://drive.google.com/file/d/{log.drive_file_id or log.id}/view",
            drive_folder=log.drive_folder,
            file_name=log.file_name,
            file_size=log.file_size,
            message="Log was already verified and marked as ready",
        )

    if log.status == "aborted":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot complete a log upload that has been aborted",
        )

    folder_name = log.drive_folder or get_year_month_folder()
    effective_drive_file_id = payload.drive_file_id or log.drive_file_id
    verification = await gdrive.verify_uploaded_file(
        log_id=log.id,
        file_name=log.file_name,
        folder_name=folder_name,
        drive_file_id=effective_drive_file_id,
    )

    if not verification.get("verified", False):
        log.status = "failed"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload verification failed: file not confirmed in Google Drive",
        )

    log.status = "ready"
    log.drive_file_id = verification.get("drive_file_id") or log.drive_file_id or f"gdrive_{log.id}"
    log.drive_url = verification.get("drive_url") or f"https://drive.google.com/file/d/{log.drive_file_id}/view"
    if verification.get("file_size") is not None:
        log.file_size = verification["file_size"]
    if payload.file_hash:
        log.file_hash = payload.file_hash
    log.completed_at = datetime.now(UTC)

    await db.commit()

    logger.info("Completed log ID %s successfully; drive URL: %s", log.id, log.drive_url)

    return LogCompleteResponse(
        id=log.id,
        status=log.status,
        drive_url=log.drive_url,
        drive_folder=log.drive_folder,
        file_name=log.file_name,
        file_size=log.file_size,
        message="Upload verified and completed successfully",
    )


@router.post(
    "/{id}/abort",
    response_model=LogAbortResponse,
    status_code=status.HTTP_200_OK,
    summary="Abort an in-progress log upload",
    description="Cancel an active or pending log upload and mark its status as 'aborted'.",
)
async def abort_log_upload(
    id: UUID = Path(..., description="UUID of the log upload to cancel"),
    payload: LogAbortRequest = Body(default_factory=LogAbortRequest),
    auth: AuthContext = Depends(require_permission("user")),
    db: AsyncSession = Depends(get_db),
) -> LogAbortResponse:
    """Abort an upload in progress."""
    stmt = select(Log).where(Log.id == id, Log.deleted_at.is_(None))
    result = await db.execute(stmt)
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Log with ID '{id}' was not found",
        )

    check_log_modification_permission(log, auth)

    if log.status == "ready":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot abort a log upload that has already completed and is marked as 'ready'",
        )

    now = datetime.now(UTC)
    if log.status == "aborted":
        return LogAbortResponse(
            id=log.id,
            status="aborted",
            message="Log upload was already aborted",
            aborted_at=log.completed_at or now,
        )

    log.status = "aborted"
    log.completed_at = now
    if payload.reason:
        reason_text = f"[Aborted: {payload.reason}]"
        log.note = f"{log.note} {reason_text}".strip() if log.note else reason_text

    await db.commit()

    logger.info("Aborted log upload ID %s (reason: %s)", id, payload.reason)

    return LogAbortResponse(
        id=log.id,
        status="aborted",
        message="Upload aborted successfully",
        aborted_at=now,
    )


@router.get(
    "",
    response_model=LogSearchResponse,
    summary="Search and list logs",
    description="Query paginated logs with optional filters for tags, date ranges, folder, status, text, or metadata.",
)
async def search_logs(
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=50, ge=1, le=100, alias="pageSize", description="Items per page"),
    text_query: str | None = Query(default=None, alias="textQuery", description="Text search in name or notes"),
    tags: str | None = Query(default=None, description="Comma-separated tags (e.g. 'pod,motor')"),
    drive_folder: str | None = Query(default=None, alias="driveFolder", description="Filter by YYYY_MM folder"),
    status_filter: str | None = Query(default=None, alias="status", description="Filter by status ('ready', 'pending_upload', etc.)"),
    start_date: datetime | None = Query(default=None, alias="startDate", description="Filter logs starting after date"),
    end_date: datetime | None = Query(default=None, alias="endDate", description="Filter logs ending before date"),
    creator: str | None = Query(default=None, description="Filter by username of creator"),
    sort_by: str = Query(default="createdAt", alias="sortBy", description="Sort by: 'createdAt', 'startDate', 'endDate', 'fileName', 'fileSize'"),
    sort_order: str = Query(default="desc", alias="sortOrder", description="Sort direction: 'asc' or 'desc'"),
    metadata_query: str | None = Query(default=None, alias="metadataQuery", description="Internal search within clientMetadata (Admins only)"),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> LogSearchResponse:
    """Search and paginate logs with dynamic sorting."""
    conditions = [Log.deleted_at.is_(None)]

    if status_filter:
        conditions.append(Log.status == status_filter)

    if drive_folder:
        conditions.append(Log.drive_folder == drive_folder)

    if text_query:
        pattern = f"%{text_query}%"
        conditions.append(
            or_(
                Log.file_name.ilike(pattern),
                Log.note.ilike(pattern),
            )
        )

    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        for t in tag_list:
            conditions.append(cast(Log.tags, String).like(f'%"{t}"%'))

    if start_date:
        conditions.append(Log.start_date >= start_date)

    if end_date:
        conditions.append(Log.end_date <= end_date)

    if creator:
        conditions.append(User.username.ilike(creator))

    # Internal search by client_metadata restricted to admins/master key
    if metadata_query:
        if not auth.has_permission("admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Searching by client metadata is restricted to administrators",
            )
        conditions.append(cast(Log.client_metadata, String).ilike(f"%{metadata_query}%"))

    # Sorting resolution
    sort_fields = {
        "createdat": Log.created_at,
        "created_at": Log.created_at,
        "filedate": Log.file_date,
        "file_date": Log.file_date,
        "startdate": Log.start_date,
        "start_date": Log.start_date,
        "enddate": Log.end_date,
        "end_date": Log.end_date,
        "filename": Log.file_name,
        "file_name": Log.file_name,
        "filesize": Log.file_size,
        "file_size": Log.file_size,
    }
    sort_key = sort_by.strip().lower()
    if sort_key not in sort_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid sortBy field '{sort_by}'. Allowed fields: createdAt, fileDate, startDate, endDate, fileName, fileSize",
        )
    sort_column = sort_fields[sort_key]

    order_key = sort_order.strip().lower()
    if order_key not in ("asc", "desc"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid sortOrder '{sort_order}'. Allowed values: 'asc', 'desc'",
        )

    # Total count query
    count_stmt = select(func.count(Log.id)).where(*conditions)
    if creator:
        count_stmt = count_stmt.join(User, Log.created_by == User.id, isouter=True)
    count_res = await db.execute(count_stmt)
    total = count_res.scalar() or 0

    # Paginated items query
    stmt = (
        select(Log)
        .where(*conditions)
        .options(selectinload(Log.creator_user))
        .order_by(sort_column.asc() if order_key == "asc" else sort_column.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if creator:
        stmt = stmt.join(User, Log.created_by == User.id, isouter=True)

    result = await db.execute(stmt)
    logs = result.scalars().all()
    items = [LogOut.model_validate(log) for log in logs]

    return LogSearchResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=items,
    )


@router.get(
    "/tags",
    response_model=list[str],
    summary="List all unique tags",
    description="Retrieve list of all distinct tags currently used across logs for frontend autocomplete.",
)
async def list_tags(
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    """Retrieve distinct tag list."""
    stmt = select(Log.tags).where(Log.deleted_at.is_(None))
    result = await db.execute(stmt)
    tag_rows = result.scalars().all()
    unique_tags = sorted({tag for row in tag_rows if row for tag in row if tag})
    return unique_tags


@router.get(
    "/stats",
    response_model=LogStatsResponse,
    summary="Get log catalog statistics",
    description="Retrieve aggregated metrics including total logs, size, status distribution, monthly counts, and top tags.",
)
async def get_log_stats(
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> LogStatsResponse:
    """Retrieve aggregate statistics about the catalog."""
    # 1. Total logs
    total_stmt = select(func.count(Log.id)).where(Log.deleted_at.is_(None))
    total_res = await db.execute(total_stmt)
    total_logs = total_res.scalar() or 0

    # 2. Total bytes (ready logs)
    bytes_stmt = (
        select(func.coalesce(func.sum(Log.file_size), 0))
        .where(Log.deleted_at.is_(None), Log.status == "ready")
    )
    bytes_res = await db.execute(bytes_stmt)
    total_bytes = int(bytes_res.scalar() or 0)

    # 3. Status distribution
    status_stmt = (
        select(Log.status, func.count(Log.id))
        .where(Log.deleted_at.is_(None))
        .group_by(Log.status)
    )
    status_res = await db.execute(status_stmt)
    by_status = {status_name: count for status_name, count in status_res.all()}

    # 4. Monthly folder distribution
    folder_stmt = (
        select(Log.drive_folder, func.count(Log.id))
        .where(Log.deleted_at.is_(None), Log.drive_folder.isnot(None))
        .group_by(Log.drive_folder)
        .order_by(Log.drive_folder.desc())
    )
    folder_res = await db.execute(folder_stmt)
    by_folder = {folder: count for folder, count in folder_res.all() if folder}

    # 5. Top tags
    tags_stmt = select(Log.tags).where(Log.deleted_at.is_(None))
    tags_res = await db.execute(tags_stmt)
    all_tags_lists = tags_res.scalars().all()
    tag_counter = collections.Counter(
        tag for row in all_tags_lists if row for tag in row if tag
    )
    total_tags = len(tag_counter)
    top_tags = [
        TagCount(tag=tag, count=cnt)
        for tag, cnt in tag_counter.most_common(10)
    ]

    return LogStatsResponse(
        total_logs=total_logs,
        total_bytes=total_bytes,
        by_status=by_status,
        by_folder=by_folder,
        total_tags=total_tags,
        top_tags=top_tags,
    )


@router.post(
    "/cleanup",
    response_model=LogCleanupResponse,
    status_code=status.HTTP_200_OK,
    summary="Trigger catalog cleanup",
    description=(
        "Clean up uncompleted/abandoned logs older than specified retention (default 30 days = 1 month). "
        "Completed logs (ready) are never deleted. Restricted to administrators."
    ),
)
async def cleanup_logs(
    retention_days: int = Query(
        default=30,
        ge=1,
        alias="retentionDays",
        description="Minimum age in days of logs to clean (default 30)",
    ),
    dry_run: bool = Query(
        default=False,
        alias="dryRun",
        description="If true, only report without modifying database",
    ),
    purge_soft_deleted: bool = Query(
        default=False,
        alias="purgeSoftDeleted",
        description="If true, permanently delete logs soft-deleted > retentionDays ago",
    ),
    auth: AuthContext = Depends(require_permission("admin")),
    db: AsyncSession = Depends(get_db),
) -> LogCleanupResponse:
    """Execute maintenance cleanup on old uncompleted/orphaned logs."""
    res = await execute_cleanup(
        db=db,
        retention_days=retention_days,
        dry_run=dry_run,
        purge_soft_deleted=purge_soft_deleted,
    )
    return LogCleanupResponse(**res)


@router.get(
    "/{id}",
    response_model=LogOut,
    summary="Get log detail",
    description="Retrieve complete metadata, status, and Google Drive URL of a specific log.",
)
async def get_log(
    id: UUID = Path(..., description="UUID of the log"),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> LogOut:
    """Retrieve single log detail."""
    stmt = (
        select(Log)
        .where(Log.id == id, Log.deleted_at.is_(None))
        .options(selectinload(Log.creator_user))
    )
    result = await db.execute(stmt)
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Log with ID '{id}' was not found",
        )

    return LogOut.model_validate(log)


@router.get(
    "/{id}/download",
    status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    summary="Download log file via redirect",
    description="Redirect authenticated clients to the Google Drive file download/view URL.",
    responses={
        307: {"description": "Redirects to external Google Drive URL"},
        400: {"description": "Log file is not ready or missing Drive URL"},
        404: {"description": "Log not found or deleted"},
    },
)
async def download_log(
    id: UUID = Path(..., description="UUID of the log to download"),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Redirect to Google Drive file download link."""
    stmt = select(Log).where(Log.id == id, Log.deleted_at.is_(None))
    result = await db.execute(stmt)
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Log with ID '{id}' was not found",
        )

    if log.status != "ready":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Log file is not ready for download. Current status is '{log.status}'",
        )

    if not log.drive_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Google Drive URL is not available for this log",
        )

    return RedirectResponse(
        url=log.drive_url,
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


@router.patch(
    "/{id}",
    response_model=LogOut,
    summary="Update log metadata",
    description="Edit tags, note, or client metadata for a log entry.",
)
async def update_log(
    id: UUID = Path(..., description="UUID of the log to update"),
    payload: LogUpdateRequest = Body(...),
    auth: AuthContext = Depends(require_permission("user")),
    db: AsyncSession = Depends(get_db),
) -> LogOut:
    """Update log metadata."""
    stmt = (
        select(Log)
        .where(Log.id == id, Log.deleted_at.is_(None))
        .options(selectinload(Log.creator_user))
    )
    result = await db.execute(stmt)
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Log with ID '{id}' was not found",
        )

    check_log_modification_permission(log, auth)

    if payload.tags is not None:
        log.tags = payload.tags
    if payload.note is not None:
        log.note = payload.note
    if payload.client_metadata is not None:
        log.client_metadata = payload.client_metadata

    await db.commit()

    return LogOut.model_validate(log)


@router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a log",
    description="Mark a log entry as deleted.",
)
async def delete_log(
    id: UUID = Path(..., description="UUID of the log to delete"),
    auth: AuthContext = Depends(require_permission("user")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete log entry."""
    stmt = select(Log).where(Log.id == id, Log.deleted_at.is_(None))
    result = await db.execute(stmt)
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Log with ID '{id}' was not found",
        )

    check_log_modification_permission(log, auth)

    log.deleted_at = datetime.now(UTC)
    await db.commit()

    logger.info("Soft-deleted log ID %s", id)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["check_log_modification_permission", "router"]
