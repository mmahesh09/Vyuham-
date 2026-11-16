"""Error ingestion service: redact, normalize, fingerprint, group.

Input comes from the signed-in Vyuham app. The workspace and user come from the session, never from
the payload, so one customer can't file errors into another's workspace.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.support_ai.models import SupportErrorEvent, SupportErrorGroup
from app.support_ai.normalize import normalize
from app.support_ai.redact import redact_text, redact_value

log = logging.getLogger("app.support_ai.ingestion")


def ingest_error(
    db: Session,
    *,
    workspace_id: str,
    user_id: str,
    module: str,
    message: str,
    error_type: str | None = None,
    http_status: int | None = None,
    details: dict | None = None,
    app_version: str | None = None,
) -> SupportErrorGroup:
    """Record one occurrence and return its group. Commits."""
    safe_message = redact_text(message, mask_quoted=True)
    norm = normalize(module, safe_message, error_type, http_status)
    safe_details = redact_value(details or {})
    now = datetime.now(timezone.utc)

    group = db.scalar(select(SupportErrorGroup).where(SupportErrorGroup.workspace_id == workspace_id, SupportErrorGroup.fingerprint == norm.fingerprint))
    if group is None:
        group = SupportErrorGroup(
            workspace_id=workspace_id, fingerprint=norm.fingerprint, module=norm.module, category=norm.category,
            error_type=norm.error_type, normalized_message=norm.template, sample_message=safe_message, count=0, first_seen=now,
        )
        db.add(group)
        try:
            db.flush()
        except IntegrityError:  # another request created the same group concurrently
            db.rollback()
            group = db.scalar(select(SupportErrorGroup).where(SupportErrorGroup.workspace_id == workspace_id, SupportErrorGroup.fingerprint == norm.fingerprint))
            if group is None:
                raise
    group.count += 1
    group.last_seen = now
    if group.status == "resolved":  # it happened again after being marked resolved: a regression
        group.status, group.regressed_at = "open", now
        log.info("error regressed workspace=%s group=%s", workspace_id, group.id)
    version = re.sub(r"[^A-Za-z0-9._@+-]", "", app_version or "")[:80] or None
    db.add(SupportErrorEvent(workspace_id=workspace_id, group_id=group.id, user_id=user_id, message=safe_message, details=safe_details, app_version=version, created_at=now))
    db.commit()
    log.info("error ingested workspace=%s group=%s category=%s", workspace_id, group.id, group.category)
    return group
