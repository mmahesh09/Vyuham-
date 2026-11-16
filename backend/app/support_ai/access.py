"""Who may use the internal support tools. Enforced on the server for every request.

Roles come from configuration and require a verified email address:
  * admin  (SUPPORT_ADMIN_EMAILS): everything, including approving, rejecting, editing and archiving
                                   *global* knowledge, which every customer can see.
  * staff  (SUPPORT_STAFF_EMAILS): the dashboard, error triage, ticket links, and workspace-private knowledge.
Anyone else gets 404 from every support-admin route, so the routes' existence isn't revealed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, HTTPException, status

from app.config import get_settings
from app.security import AuthUser, current_user

Role = Literal["admin", "staff"]


@dataclass(frozen=True)
class Actor:
    id: str
    email: str
    role: Role

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def support_role(user: AuthUser) -> Role | None:
    if not user.email_verified:
        return None
    email = user.email.lower()
    s = get_settings()
    if email in s.admin_emails:
        return "admin"
    if email in s.staff_emails:
        return "staff"
    return None


def require_support_staff(user: AuthUser = Depends(current_user)) -> Actor:
    role = support_role(user)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Actor(id=user.id, email=user.email, role=role)


def require_support_admin(actor: Actor = Depends(require_support_staff)) -> Actor:
    if not actor.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only Vyuham administrators can do this.")
    return actor
