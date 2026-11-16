"""Request limits counted from the database, so they hold across backend processes and restarts."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.support_ai.models import SupportAiSession, SupportErrorEvent


def _count_since(db: Session, column, user_column, user_id: str, since: datetime) -> int:
    return db.scalar(select(func.count()).where(user_column == user_id, column >= since)) or 0


def check_ask_limit(db: Session, user_id: str) -> None:
    limit = get_settings().support_ai_asks_per_hour
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    if _count_since(db, SupportAiSession.created_at, SupportAiSession.user_id, user_id, since) >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"You've asked the assistant {limit} questions in the last hour. Please try again later or contact support.")


def check_error_limit(db: Session, user_id: str) -> None:
    limit = get_settings().support_ai_errors_per_minute
    since = datetime.now(timezone.utc) - timedelta(minutes=1)
    if _count_since(db, SupportErrorEvent.created_at, SupportErrorEvent.user_id, user_id, since) >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many error reports. Please slow down.")
