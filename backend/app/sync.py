"""Sync a database-backed dataset: read its table or query, type it, write the dataset's Parquet file.

The Parquet file is replaced atomically and only after a successful read, so a failed sync leaves the
last good data in place (dashboards keep working) and records why it failed in `sync_error`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.connectors.base import ConnectorError, spec_for
from app.connectors.extract import extract
from app.crypto import SecretError
from app.ingest import IngestError, profile_frame, write_parquet
from app.models import Connection, Dataset

log = logging.getLogger("app.sync")

REFRESH_EVERY = {"hourly": timedelta(hours=1), "daily": timedelta(days=1)}
REFRESH_CHOICES = ("manual", "hourly", "daily")


class SyncError(ValueError):
    """A sync failed for a reason the customer can fix (shown as-is, not retried)."""


def is_synced(ds: Dataset) -> bool:
    return ds.source_kind in ("postgres", "mysql")


def next_sync_at(ds: Dataset) -> datetime | None:
    """When a scheduled sync is next due, or None for manual refresh / no connection."""
    every = REFRESH_EVERY.get(ds.refresh or "")
    if every is None or ds.connection_id is None:
        return None
    last = ds.last_synced_at or ds.created_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (last or datetime.now(timezone.utc)) + every


def sync_dataset(db: Session, ds: Dataset, now: datetime | None = None) -> Dataset:
    """Refresh one dataset from its database. Raises SyncError (recorded on the dataset) on a fixable problem."""
    from app.routers.datasets import parquet_path  # the router owns the path; imported late to avoid a cycle

    now = now or datetime.now(timezone.utc)
    conn = db.get(Connection, ds.connection_id) if ds.connection_id else None
    try:
        if conn is None:
            raise SyncError("Its database connection was deleted. Reconnect the database to refresh this data.")
        spec = spec_for(conn)
        frame = extract(spec, table=ds.source_table, query=ds.source_query, max_rows=get_settings().max_upload_rows) \
            if ds.source_table or ds.source_query else None
        if frame is None:
            raise SyncError("Nothing to sync: this dataset has no table or query.")
        result = profile_frame(frame, max_rows=get_settings().max_upload_rows)
    except (ConnectorError, IngestError, SecretError, SyncError) as e:
        ds.sync_error = str(e)[:500]
        if conn is not None:
            conn.status, conn.last_error, conn.last_checked_at = "error", str(e)[:500], now
        # Count a failed attempt as a sync for scheduling, so a broken source isn't retried every minute.
        ds.last_synced_at = now
        db.commit()
        raise SyncError(str(e)) from e

    ds.file_size = write_parquet(result.frame, parquet_path(ds.workspace_id, ds.id))
    ds.row_count = len(result.frame)
    ds.columns = [c.as_dict() for c in result.columns]
    ds.last_synced_at, ds.sync_error = now, None
    conn.status, conn.last_error, conn.last_checked_at = "ok", None, now
    db.commit()
    db.refresh(ds)
    log.info("synced dataset %s: %d rows", ds.id, ds.row_count)
    return ds
