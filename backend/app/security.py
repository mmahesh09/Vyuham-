"""Resolve the signed-in user from Better Auth's session cookie.

Better Auth sets `better-auth.session_token` (or `__Secure-better-auth.session_token`
over HTTPS) to `<token>.<hmac>`, URL-encoded. The token is a random secret stored in the
"session" table, so looking it up is enough to authenticate; we don't need Better Auth's
signing secret here.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import unquote

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Workspace, WorkspaceMember

SESSION_COOKIES = ("__Secure-better-auth.session_token", "better-auth.session_token")

_SESSION_QUERY = text(
    'SELECT u.id, u.email, u.name, u.company, u."emailVerified", s."expiresAt" '
    'FROM "session" s JOIN "user" u ON u.id = s."userId" '
    'WHERE s.token = :token'
)


@dataclass
class AuthUser:
    id: str
    email: str
    name: str
    company: str | None
    email_verified: bool = False


def _as_utc(value: object) -> datetime | None:
    """Postgres returns datetimes; SQLite stores Better Auth dates as ISO text or epoch ms."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(value / 1000, timezone.utc)
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def session_token(request: Request) -> str | None:
    for name in SESSION_COOKIES:
        raw = request.cookies.get(name)
        if raw:
            return unquote(raw).rsplit(".", 1)[0] or None
    return None


def current_user(request: Request, db: Session = Depends(get_db)) -> AuthUser:
    token = session_token(request)
    row = db.execute(_SESSION_QUERY, {"token": token}).first() if token else None
    expires = _as_utc(row.expiresAt) if row else None
    if row is None or expires is None or expires <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return AuthUser(id=row.id, email=row.email, name=row.name, company=row.company, email_verified=bool(row.emailVerified))


def require_verified_email(user: AuthUser) -> None:
    """In production, actions that email other people need a confirmed address (stops spam from throwaway sign-ups)."""
    from app.config import get_settings

    if get_settings().environment == "production" and not user.email_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Confirm your email address first. We sent you a link when you signed up.")


def current_membership(user: AuthUser = Depends(current_user), db: Session = Depends(get_db)) -> WorkspaceMember:
    """The user's workspace membership, creating their workspace on first use."""
    stmt = select(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
    member = db.scalar(stmt)
    if member:
        return member
    name = (user.company or "").strip() or f"{user.name.split(' ')[0] or 'My'}'s workspace"
    member = WorkspaceMember(user_id=user.id, role="owner", workspace=Workspace(name=name[:120]))
    db.add(member)
    try:
        db.commit()
    except IntegrityError:  # a parallel first request created it
        db.rollback()
        member = db.scalar(stmt)
        if member is None:
            raise
    return member
