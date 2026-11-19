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


def log_query(db: Session, workspace_id: str, user_id: str | None, kind: str, started: float, status: str = "ok", rows: int | None = None) -> None:
    """Record one analytics run. Monitoring must never break the request it describes."""
    try:
        db.add(QueryExecution(
            workspace_id=workspace_id, user_id=user_id, kind=kind, status=status, rows=rows,
            duration_ms=int((time.perf_counter() - started) * 1000),
        ))
        db.commit()
    except Exception:
        db.rollback()
        log.exception("couldn't record a query execution")
