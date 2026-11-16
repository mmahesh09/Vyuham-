"""Audit log for staff actions. Written in the same transaction as the change it records."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.support_ai.access import Actor
from app.support_ai.models import SupportAuditLog
from app.support_ai.redact import redact_text

TRACKED_ARTICLE_FIELDS = ("title", "symptoms", "root_cause", "resolution", "modules", "categories", "fingerprints", "status", "tested", "test_notes", "scope", "workspace_id")


def _clean(value):
    """Strip secrets but keep wording (article text is already redacted when saved)."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    return value


def snapshot(obj, fields=TRACKED_ARTICLE_FIELDS) -> dict:
    return {f: getattr(obj, f) for f in fields if hasattr(obj, f)}


def diff(before: dict, after: dict) -> dict:
    return {k: [before.get(k), after.get(k)] for k in sorted(set(before) | set(after)) if before.get(k) != after.get(k)}


def record(db: Session, actor: Actor, action: str, target_type: str, target_id: str, *, workspace_id: str | None = None, changes: dict | None = None, note: str | None = None) -> None:
    """Add an audit row to the session. The caller commits, so the record and the change land together."""
    db.add(
        SupportAuditLog(
            actor_id=actor.id, actor_email=actor.email, actor_role=actor.role, action=action, target_type=target_type, target_id=target_id,
            workspace_id=workspace_id, changes=_clean(changes or {}), note=(note or None) and str(note)[:1000],
        )
    )
