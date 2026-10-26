"""Routine for cleaning up orphaned and stale telemetry logs."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import RefreshToken
from app.models.log import Log

logger = logging.getLogger("cloud_logs.cleanup")


async def execute_cleanup(
    db: AsyncSession,
    retention_days: int = 30,
    dry_run: bool = False,
    purge_soft_deleted: bool = False,
) -> dict[str, Any]:
    """Execute cleanup of stale uncompleted uploads (> retention_days) and optionally purge soft-deleted logs.

    Args:
        db: Active async database session.
        retention_days: Minimum age in days (default 30 days = 1 month).
        dry_run: If True, calculations are performed without modifying database rows.
        purge_soft_deleted: If True, permanently deletes records soft-deleted > retention_days ago.

    Returns:
        Summary dict containing counts, cutoff date, and status message.
    """
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=retention_days)

    # 1. Stale uncompleted uploads (pending_upload, aborted, failed) older than 1 month
    orphaned_stmt = select(Log).where(
        Log.deleted_at.is_(None),
        Log.status.in_(["pending_upload", "aborted", "failed"]),
        Log.created_at < cutoff,
    )
    orphaned_res = await db.execute(orphaned_stmt)
    orphaned_logs = orphaned_res.scalars().all()
    orphaned_count = len(orphaned_logs)

    if not dry_run:
        for log in orphaned_logs:
            log.deleted_at = now
            reason_tag = f"[Cleaned by weekly GC: uncompleted > {retention_days}d]"
            log.note = f"{log.note} {reason_tag}".strip() if log.note else reason_tag

    # 2. Stale soft-deleted logs older than 1 month
    purged_count = 0
    if purge_soft_deleted:
        deleted_stmt = select(Log).where(
            Log.deleted_at.isnot(None),
            Log.deleted_at < cutoff,
        )
        deleted_res = await db.execute(deleted_stmt)
        stale_deleted = deleted_res.scalars().all()
        purged_count = len(stale_deleted)
        if not dry_run:
            for log in stale_deleted:
                await db.delete(log)

    # 3. Clean up expired and revoked refresh tokens
    tokens_stmt = select(RefreshToken).where(
        (RefreshToken.expires_at < now) | (RefreshToken.is_revoked.is_(True))
    )
    tokens_res = await db.execute(tokens_stmt)
    stale_tokens = tokens_res.scalars().all()
    tokens_cleaned = len(stale_tokens)
    if not dry_run:
        for t in stale_tokens:
            await db.delete(t)

    if not dry_run:
        await db.commit()

    affected_total = orphaned_count + purged_count
    msg = (
        f"Dry run complete: {orphaned_count} uncompleted logs older than {retention_days} days identified."
        if dry_run
        else f"Cleanup complete: {orphaned_count} uncompleted logs soft-deleted"
        + (f", {purged_count} permanently purged." if purge_soft_deleted else ".")
    )

    logger.info(
        "Catalog cleanup executed: orphaned_cleaned=%d, soft_deleted_purged=%d, tokens_cleaned=%d, retention_days=%d, dry_run=%s",
        orphaned_count,
        purged_count,
        tokens_cleaned,
        retention_days,
        dry_run,
    )

    return {
        "affected_logs": affected_total,
        "orphaned_cleaned": orphaned_count,
        "soft_deleted_purged": purged_count,
        "tokens_cleaned": tokens_cleaned,
        "cutoff_date": cutoff,
        "dry_run": dry_run,
        "message": msg,
    }

__all__ = ["execute_cleanup"]
