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
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import WorkspaceMember

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


def current_membership(request: Request, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)) -> WorkspaceMember:
    """The workspace membership this request acts as, checked against the database every time.

    The workspace comes from the `X-Workspace-Id` header when sent, else the one the person last
    switched to, else their first. A workspace they can't open is a 403, never a silent fallback.
    Someone with no organization yet gets 409 `onboarding_required`. Nothing is created here:
    onboarding (routers/onboarding.py) and invitations create memberships.
    """
    from app import tenancy

    member = tenancy.resolve(db, user.id, request.headers.get(tenancy.WORKSPACE_HEADER))
    tenancy.bind(db, member.workspace_id)
    from app.errors import identify

    identify(user.id, member.workspace_id)
    return member


def is_staff(user: AuthUser) -> bool:
    """Vyuham support staff (SUPPORT_STAFF_EMAILS). In production the address must be confirmed."""
    from app.config import get_settings

    s = get_settings()
    if s.environment == "production" and not user.email_verified:
        return False
    return user.email.lower() in s.staff_emails


def require_staff(user: AuthUser = Depends(current_user), db: Session = Depends(get_db)) -> AuthUser:
    """Staff-only routes answer 404 to everyone else, so they don't advertise themselves.

    Staff tools read across workspaces (the support inbox), so their database session skips
    row-level security; everyone else's stays bound to their workspace.
    """
    if not is_staff(user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    from app import tenancy

    tenancy.bypass(db)
    return user
