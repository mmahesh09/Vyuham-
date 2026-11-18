"""Sync a database-backed dataset: read its table or query, type it, write the dataset's Parquet file.

The Parquet file is replaced atomically and only after a successful read, so a failed sync leaves the
last good data in place (dashboards keep working) and records why it failed in `sync_error`.

`last_synced_at` only moves on success. `sync_started_at` and `sync_finished_at` record every attempt:
the schedule uses them to wait before retrying, and the UI uses them to see that a refresh has ended.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.connectors.base import ConnectorError, QueryProblem, spec_for
from app.connectors.extract import extract
from app.crypto import SecretError
from app.ingest import IngestError, profile_frame, write_parquet
from app.models import Connection, Dataset
from app.telemetry import count, span

log = logging.getLogger("app.sync")

REFRESH_EVERY = {"hourly": timedelta(hours=1), "daily": timedelta(days=1)}
REFRESH_CHOICES = ("manual", "hourly", "daily")
RETRY_AFTER = timedelta(hours=1)  # after a failed or interrupted attempt; also how long a claimed slot lasts
MAX_SYNC_DURATION = timedelta(minutes=6)  # the worker's hard limit for a job
INTERNAL_FAILURE = "The refresh failed on our side. We'll try again automatically."


class SyncError(ValueError):
    """A sync failed for a reason the customer can fix (shown as-is, not retried)."""


def is_synced(ds: Dataset) -> bool:
    return ds.source_kind in ("postgres", "mysql")


def _aware(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def sync_in_progress(ds: Dataset, now: datetime | None = None) -> bool:
    """True while an attempt has started and not finished. A crashed attempt stops counting after the job limit."""
    started, finished = _aware(ds.sync_started_at), _aware(ds.sync_finished_at)
    if started is None or (finished is not None and finished >= started):
        return False
    return (now or datetime.now(timezone.utc)) - started < MAX_SYNC_DURATION


def next_sync_at(ds: Dataset) -> datetime | None:
    """When a scheduled sync is next due, or None for manual refresh / no connection."""
    every = REFRESH_EVERY.get(ds.refresh or "")
    if every is None or ds.connection_id is None:
        return None
    last = _aware(ds.last_synced_at) or _aware(ds.created_at) or datetime.now(timezone.utc)
    started = _aware(ds.sync_started_at)
    if started is not None and started > last:  # the latest attempt failed or never finished
        return started + min(every, RETRY_AFTER)
    return last + every


def sync_slot(due_at: datetime, now: datetime) -> datetime:
    """The job slot for an overdue sync. It moves on every RETRY_AFTER, so a lost job can't block the dataset forever."""
    return due_at + RETRY_AFTER * max(0, (now - due_at) // RETRY_AFTER)


def _record_failure(
    db: Session, dataset_id: str, connection_id: str | None, message: str, at: datetime, connection_failed: bool
) -> None:
    db.rollback()
    ds = db.get(Dataset, dataset_id, populate_existing=True)
    if ds is not None:
        ds.sync_error, ds.sync_finished_at = message[:500], at
    conn = db.get(Connection, connection_id, populate_existing=True) if connection_id else None
    if conn is not None and connection_failed:
        conn.status, conn.last_error, conn.last_checked_at = "error", message[:500], at
    db.commit()


def sync_dataset(db: Session, ds: Dataset, now: datetime | None = None) -> Dataset:
    """Refresh one dataset from its database. Raises SyncError (recorded on the dataset) on a fixable problem."""
    from app.routers.datasets import parquet_path  # the router owns the path; imported late to avoid a cycle

    started = now or datetime.now(timezone.utc)
    dataset_id, workspace_id, connection_id = ds.id, ds.workspace_id, ds.connection_id
    kind, table, query = ds.source_kind, ds.source_table, ds.source_query
    max_rows = get_settings().max_upload_rows
    ds.sync_started_at = started
    db.commit()  # recorded first, so an attempt that dies here still counts for the schedule

    with span("vyuham.sync") as s:
        s.set_attribute("vyuham.sync.kind", kind)
        s.set_attribute("vyuham.sync.source", "table" if table else "query")
        try:
            conn = db.get(Connection, connection_id) if connection_id else None
            if conn is None:
                raise SyncError("Its database connection was deleted. Reconnect the database to refresh this data.")
            if not table and not query:
                raise SyncError("Nothing to sync: this dataset has no table or query.")
            spec = spec_for(conn)
            db.commit()  # no transaction stays open on our database during a long read
            frame = extract(spec, table=table, query=query, max_rows=max_rows)
            result = profile_frame(frame, max_rows=max_rows)
            if db.scalar(select(Dataset.id).where(Dataset.id == dataset_id)) is None:
                raise SyncError("This dataset was deleted during the refresh.")
            size = write_parquet(result.frame, parquet_path(workspace_id, dataset_id))
        except (ConnectorError, IngestError, SecretError, SyncError) as e:
            connection_failed = isinstance(e, (ConnectorError, SecretError)) and not isinstance(e, QueryProblem)
            _record_failure(db, dataset_id, connection_id, str(e), now or datetime.now(timezone.utc), connection_failed)
            s.set_attribute("vyuham.sync.status", "failed")
            count("vyuham.syncs", kind=kind, status="failed")
            log.warning("sync failed dataset=%s connection=%s kind=%s reason=%s", dataset_id, connection_id, kind, type(e).__name__)
            raise SyncError(str(e)) from e
        except Exception:  # ours, not the customer's: recorded for them, re-raised so the worker retries
            _record_failure(db, dataset_id, connection_id, INTERNAL_FAILURE, now or datetime.now(timezone.utc), False)
            count("vyuham.syncs", kind=kind, status="error")
            log.exception("sync crashed dataset=%s connection=%s kind=%s", dataset_id, connection_id, kind)
            raise

        finished = now or datetime.now(timezone.utc)
        ds.file_size, ds.row_count = size, len(result.frame)
        ds.columns = [c.as_dict() for c in result.columns]
        ds.last_synced_at, ds.sync_finished_at, ds.sync_error = started, finished, None
        conn.status, conn.last_error, conn.last_checked_at = "ok", None, finished
        db.commit()
        db.refresh(ds)
        s.set_attribute("vyuham.sync.status", "ok")
        s.set_attribute("vyuham.sync.rows", ds.row_count)
        count("vyuham.syncs", kind=kind, status="ok")
        log.info("synced dataset=%s kind=%s rows=%d", dataset_id, kind, ds.row_count)
        return ds
