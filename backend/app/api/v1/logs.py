"""Endpoints for telemetry and diagnostic logs (Google Drive two-phase workflow)."""

from __future__ import annotations

import collections
import logging
import urllib.parse
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Body,
    Depends,
    HTTPException,
    Path,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import RedirectResponse
from sqlalchemy import ColumnElement, String, cast, func, or_, select
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
    MonthlyUploadStats,
    TagCoOccurrence,
    TagCount,
    TagDetailOut,
    TagsStatsResponse,
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
    request: Request,
    auth: AuthContext = Depends(require_permission("user")),
    db: AsyncSession = Depends(get_db),
    gdrive: GoogleDriveService = Depends(get_gdrive_service),
) -> LogInitiateResponse:
    """Initiate two-phase upload to Google Drive."""
    client_origin = request.headers.get("origin")
    if not client_origin:
        referer = request.headers.get("referer")
        if referer:
            parsed = urllib.parse.urlparse(referer)
            if parsed.scheme and parsed.netloc:
                client_origin = f"{parsed.scheme}://{parsed.netloc}"

    target_folder = get_year_month_folder(payload.file_date)
    log_id = uuid4()

    upload_url, drive_file_id = await gdrive.create_resumable_upload_session(
        file_name=payload.file_name,
        file_size=payload.file_size,
        folder_name=target_folder,
        log_id=log_id,
        client_origin=client_origin,
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
            drive_url=log.drive_url
            or f"https://drive.google.com/file/d/{log.drive_file_id or log.id}/view",
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
    log.drive_file_id = (
        verification.get("drive_file_id") or log.drive_file_id or f"gdrive_{log.id}"
    )
    log.drive_url = (
        verification.get("drive_url")
        or f"https://drive.google.com/file/d/{log.drive_file_id}/view"
    )
    if verification.get("file_size") is not None:
        log.file_size = verification["file_size"]
    if payload.file_hash:
        log.file_hash = payload.file_hash
    log.completed_at = datetime.now(UTC)

    await db.commit()

    logger.info(
        "Completed log ID %s successfully; drive URL: %s", log.id, log.drive_url
    )

    return LogCompleteResponse(
        id=log.id,
        status=log.status,
        drive_url=log.drive_url or "",
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
    page_size: int = Query(
        default=50, ge=1, le=100, alias="pageSize", description="Items per page"
    ),
    text_query: str | None = Query(
        default=None, alias="textQuery", description="Text search in name or notes"
    ),
    tags: str | None = Query(
        default=None, description="Comma-separated tags (e.g. 'pod,motor')"
    ),
    drive_folder: str | None = Query(
        default=None, alias="driveFolder", description="Filter by YYYY_MM folder"
    ),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Filter by status ('ready', 'pending_upload', etc.)",
    ),
    start_date: datetime | None = Query(
        default=None, alias="startDate", description="Filter logs starting after date"
    ),
    end_date: datetime | None = Query(
        default=None, alias="endDate", description="Filter logs ending before date"
    ),
    creator: str | None = Query(
        default=None, description="Filter by username of creator"
    ),
    sort_by: str = Query(
        default="createdAt",
        alias="sortBy",
        description="Sort by: 'createdAt', 'startDate', 'endDate', 'fileName', 'fileSize'",
    ),
    sort_order: str = Query(
        default="desc", alias="sortOrder", description="Sort direction: 'asc' or 'desc'"
    ),
    metadata_query: str | None = Query(
        default=None,
        alias="metadataQuery",
        description="Internal search within clientMetadata",
    ),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> LogSearchResponse:
    """Search and paginate logs with dynamic sorting."""
    conditions: list[ColumnElement[bool]] = [Log.deleted_at.is_(None)]

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
        conditions.append(
            func.coalesce(Log.end_date, Log.start_date, Log.file_date) >= start_date
        )

    if end_date:
        conditions.append(
            func.coalesce(Log.start_date, Log.end_date, Log.file_date) <= end_date
        )

    if creator:
        conditions.append(User.username.ilike(f"%{creator}%"))

    if metadata_query:
        conditions.append(
            cast(Log.client_metadata, String).ilike(f"%{metadata_query}%")
        )

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


MONTH_NAMES = {
    1: "Jan",
    2: "Feb",
    3: "Mar",
    4: "Apr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Aug",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dec",
}


def compute_tag_details(logs: Sequence[Log]) -> tuple[int, int, list[TagDetailOut]]:
    """Compute detailed statistics for each tag from a sequence of logs."""
    tag_logs_map: dict[str, list[Log]] = collections.defaultdict(list)

    for log in logs:
        if not log.tags:
            continue
        raw_tags = log.tags if isinstance(log.tags, list) else []
        seen_in_log: set[str] = set()
        for t in raw_tags:
            if isinstance(t, str):
                t_clean = t.strip()
                if t_clean and t_clean not in seen_in_log:
                    seen_in_log.add(t_clean)
                    tag_logs_map[t_clean].append(log)

    tag_details: list[TagDetailOut] = []

    for tag, tag_logs in tag_logs_map.items():
        logs_count = len(tag_logs)
        total_size = sum(log.file_size or 0 for log in tag_logs)
        avg_size = round(total_size / logs_count, 2) if logs_count > 0 else 0.0

        status_counts = collections.Counter(
            log.status for log in tag_logs if log.status
        )
        status_mix = dict(status_counts)

        dates = [
            (dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC))
            for log in tag_logs
            if (dt := log.created_at) is not None
        ]
        first_used = min(dates) if dates else None
        last_used = max(dates) if dates else None

        # Co-occurrence
        co_counts: collections.Counter[str] = collections.Counter()
        for log in tag_logs:
            raw_tags = log.tags if isinstance(log.tags, list) else []
            other_tags = {
                t.strip()
                for t in raw_tags
                if isinstance(t, str) and t.strip() and t.strip() != tag
            }
            for ot in other_tags:
                co_counts[ot] += 1

        sorted_co = sorted(co_counts.items(), key=lambda item: (-item[1], item[0]))
        used_with = [TagCoOccurrence(tag=ot, count=cnt) for ot, cnt in sorted_co[:10]]

        tag_details.append(
            TagDetailOut(
                tag=tag,
                logs=logs_count,
                total_size=total_size,
                average_size=avg_size,
                status_mix=status_mix,
                first_used=first_used,
                last_used=last_used,
                used_with=used_with,
            )
        )

    tag_details.sort(key=lambda t: (-t.logs, -t.total_size, t.tag))
    total_tags = len(tag_details)
    total_size = sum(t.total_size for t in tag_details)

    return total_tags, total_size, tag_details


def compute_monthly_upload_stats(logs: Sequence[Log]) -> list[MonthlyUploadStats]:
    """Compute monthly upload counts and sizes sorted chronologically."""
    month_data: dict[tuple[int, int], dict[str, Any]] = {}

    for log in logs:
        year: int | None = None
        month: int | None = None
        folder = log.drive_folder

        if folder:
            parts = folder.split("_")
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                year = int(parts[0])
                month = int(parts[1])

        if year is None or month is None:
            ref_dt = log.file_date or log.created_at
            if ref_dt:
                year = ref_dt.year
                month = ref_dt.month
                folder = f"{year}_{month:02d}"
            else:
                continue

        key = (year, month)
        if key not in month_data:
            label = f"{MONTH_NAMES.get(month, f'{month:02d}')} {year}"
            month_data[key] = {
                "folder": folder or f"{year}_{month:02d}",
                "year": year,
                "month": month,
                "label": label,
                "count": 0,
                "bytes": 0,
            }

        month_data[key]["count"] += 1
        month_data[key]["bytes"] += int(log.file_size or 0)

    sorted_entries = sorted(month_data.values(), key=lambda x: (x["year"], x["month"]))
    return [MonthlyUploadStats(**entry) for entry in sorted_entries]


@router.get(
    "/tags/stats",
    response_model=TagsStatsResponse,
    summary="Get detailed tag metrics and statistics",
    description="Retrieve aggregated metrics for all tags including usage counts, size, status breakdown, and co-occurrences.",
)
async def get_tags_stats(
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> TagsStatsResponse:
    """Retrieve detailed tag breakdown and catalog metrics."""
    stmt = select(Log).where(Log.deleted_at.is_(None))
    result = await db.execute(stmt)
    all_logs = result.scalars().all()

    total_tags, total_size, tag_details = compute_tag_details(all_logs)

    return TagsStatsResponse(
        total_tags=total_tags,
        total_size=total_size,
        tags=tag_details,
    )


@router.get(
    "/tags",
    response_model=list[str] | TagsStatsResponse,
    summary="List all unique tags",
    description="Retrieve list of all distinct tags currently used across logs for frontend autocomplete, or rich stats when detailed=True.",
)
async def list_tags(
    detailed: bool = Query(
        default=False, description="If true, return detailed tag metrics"
    ),
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> list[str] | TagsStatsResponse:
    """Retrieve distinct tag list or detailed tag metrics."""
    if detailed:
        stmt = select(Log).where(Log.deleted_at.is_(None))
        result = await db.execute(stmt)
        all_logs = result.scalars().all()
        total_tags, total_size, tag_details = compute_tag_details(all_logs)
        return TagsStatsResponse(
            total_tags=total_tags,
            total_size=total_size,
            tags=tag_details,
        )

    stmt = select(Log.tags).where(Log.deleted_at.is_(None))
    result = await db.execute(stmt)
    tag_rows = result.scalars().all()
    unique_tags = sorted({tag for row in tag_rows if row for tag in row if tag})
    return unique_tags


@router.get(
    "/stats",
    response_model=LogStatsResponse,
    summary="Get log catalog statistics",
    description="Retrieve aggregated metrics including total logs, size, status distribution, monthly counts, needs attention, recent uploads, and tag details.",
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
    bytes_stmt = select(func.coalesce(func.sum(Log.file_size), 0)).where(
        Log.deleted_at.is_(None), Log.status == "ready"
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
        TagCount(tag=tag, count=cnt) for tag, cnt in tag_counter.most_common(10)
    ]

    # 6. Needs attention (pending_upload, failed, aborted)
    needs_attention = (
        by_status.get("pending_upload", 0)
        + by_status.get("failed", 0)
        + by_status.get("aborted", 0)
    )

    # 7. Recent uploads (latest 5 active logs)
    recent_stmt = (
        select(Log)
        .where(Log.deleted_at.is_(None))
        .options(selectinload(Log.creator_user))
        .order_by(Log.created_at.desc())
        .limit(5)
    )
    recent_res = await db.execute(recent_stmt)
    recent_logs = recent_res.scalars().all()
    recent_uploads = [LogOut.model_validate(log) for log in recent_logs]

    # 8. All logs for detailed monthly and tag stats
    all_logs_stmt = select(Log).where(Log.deleted_at.is_(None))
    all_logs_res = await db.execute(all_logs_stmt)
    all_logs = all_logs_res.scalars().all()

    uploads_per_month = compute_monthly_upload_stats(all_logs)
    _, _, tag_details = compute_tag_details(all_logs)

    return LogStatsResponse(
        total_logs=total_logs,
        total_bytes=total_bytes,
        by_status=by_status,
        by_folder=by_folder,
        total_tags=total_tags,
        top_tags=top_tags,
        needs_attention=needs_attention,
        uploads_per_month=uploads_per_month,
        recent_uploads=recent_uploads,
        tag_details=tag_details,
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


@router.put(
    "/simulated-upload/{id}",
    summary="Simulated Google Drive upload endpoint for development",
    description="Accept simulated direct file uploads during development/testing without real Google Drive credentials.",
    include_in_schema=False,
)
async def simulated_upload(
    id: UUID = Path(..., description="Log ID"),
) -> Response:
    """Mock upload endpoint that absorbs file uploads in development mode."""
    return Response(
        content=b'{"status": "success"}',
        media_type="application/json",
        status_code=status.HTTP_200_OK,
    )


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
    token: str | None = Query(
        default=None,
        description="Optional access token or master key for browser link downloads",
    ),
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
