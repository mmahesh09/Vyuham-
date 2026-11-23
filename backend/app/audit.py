"""Who changed what, and what ran. Metadata only: never SQL text, values, passwords or tokens."""

from __future__ import annotations

import logging
import time

from sqlalchemy.orm import Session

from app.models import AuditLog, QueryExecution, WorkspaceMember

log = logging.getLogger("app.audit")


def record_action(db: Session, member: WorkspaceMember, action: str, target_type: str, target_id: str | None = None, detail: dict | None = None) -> None:
    """Add an audit row to the current transaction, so the change and its record commit together."""
    db.add(AuditLog(
        workspace_id=member.workspace_id, user_id=member.user_id, action=action,
        target_type=target_type, target_id=target_id, detail=detail or {},
    ))


def fingerprint(sql: str) -> str:
    """A short hash of the query's shape (literals and spacing normalised), to spot repeats without keeping the text."""
    import hashlib
    import re

    shape = re.sub(r"'(?:[^']|'')*'", "?", sql.lower())
    shape = re.sub(r"\b\d+(\.\d+)?\b", "?", shape)
    shape = re.sub(r"\s+", " ", shape).strip().rstrip(";")
    return hashlib.sha256(shape.encode()).hexdigest()[:16]


def log_query(
    db: Session, workspace_id: str, user_id: str | None, kind: str, started: float, status: str = "ok", rows: int | None = None,
    *, sql: str | None = None, datasets: list | None = None, ref_kind: str | None = None, ref_id: str | None = None,
    duration_ms: int | None = None,
) -> None:
    """Record one analytics run. Monitoring must never break the request it describes.

    With `sql` and `datasets`, the run also records a fingerprint of the SQL, which datasets it read (the
    data-access log) and their Parquet size (an upper bound on the data scanned).
    """
    try:
        read = datasets or []
        if sql is not None and read:
            from app.materialize import referenced

            read = referenced(sql, read) or []
        db.add(QueryExecution(
            workspace_id=workspace_id, user_id=user_id, kind=kind, status=status, rows=rows,
            duration_ms=duration_ms if duration_ms is not None else int((time.perf_counter() - started) * 1000),
            fingerprint=fingerprint(sql) if sql else None,
            dataset_ids=[d.id for d in read] or None,
            scanned_bytes=sum(d.file_size or 0 for d in read) if read else None,
            ref_kind=ref_kind, ref_id=ref_id,
        ))
        db.commit()
    except Exception:
        db.rollback()
        log.exception("couldn't record a query execution")
