"""Who may do what. Every route checks here; the web app only mirrors it to hide buttons.

Roles, highest first: owner > admin > analyst > viewer.
- owner:   everything, including billing, deleting the organization and transferring ownership.
- admin:   members, invitations, workspaces, settings, data sources and all content.
- analyst: uploads data, builds queries, charts and dashboards; connects databases if the workspace allows it.
- viewer:  reads dashboards, reports and data shared with the workspace.
"""

from __future__ import annotations

from enum import Enum
from typing import Protocol

from fastapi import HTTPException, status

from app.models import ROLES


class Perm(str, Enum):
    ORG_DELETE = "org.delete"
    ORG_TRANSFER = "org.transfer"
    BILLING_MANAGE = "billing.manage"
    BILLING_VIEW = "billing.view"
    ORG_SETTINGS = "org.settings"
    MEMBERS_MANAGE = "members.manage"
    MEMBERS_INVITE = "members.invite"
    WORKSPACE_CREATE = "workspace.create"
    WORKSPACE_SETTINGS = "workspace.settings"
    WORKSPACE_DELETE = "workspace.delete"
    SOURCES_MANAGE = "sources.manage"  # connect / remove databases and refresh hooks
    DATA_WRITE = "data.write"  # upload, edit and delete datasets; pipelines; SQL that writes tables
    CONTENT_WRITE = "content.write"  # queries, charts, dashboards, reports, alerts, tasks
    CONTENT_VIEW = "content.view"
    GOVERNANCE_MANAGE = "governance.manage"  # access grants, masking policies, classifications
    GOVERNANCE_VIEW = "governance.view"
    ACTIVITY_VIEW = "activity.view"
    USAGE_VIEW = "usage.view"


_ANALYST = {Perm.DATA_WRITE, Perm.CONTENT_WRITE, Perm.CONTENT_VIEW, Perm.GOVERNANCE_VIEW, Perm.USAGE_VIEW}
_ADMIN = _ANALYST | {
    Perm.ORG_SETTINGS, Perm.MEMBERS_MANAGE, Perm.MEMBERS_INVITE, Perm.WORKSPACE_CREATE, Perm.WORKSPACE_SETTINGS,
    Perm.SOURCES_MANAGE, Perm.GOVERNANCE_MANAGE, Perm.ACTIVITY_VIEW, Perm.BILLING_VIEW,
}
ROLE_PERMISSIONS: dict[str, frozenset[Perm]] = {
    "owner": frozenset(_ADMIN | {Perm.ORG_DELETE, Perm.ORG_TRANSFER, Perm.BILLING_MANAGE, Perm.WORKSPACE_DELETE}),
    "admin": frozenset(_ADMIN),
    "analyst": frozenset(_ANALYST),
    "viewer": frozenset({Perm.CONTENT_VIEW}),
}

# Roles that can change data and content (the old CAN_UPLOAD).
WRITERS = frozenset({"owner", "admin", "analyst"})
# Roles that see every column and row regardless of governance rules, and every private asset.
FULL_ACCESS = frozenset({"owner", "admin"})

_MESSAGES = {
    Perm.DATA_WRITE: "Viewers can't change data. Ask an admin for analyst access.",
    Perm.CONTENT_WRITE: "Viewers can't change this. Ask an admin for analyst access.",
    Perm.SOURCES_MANAGE: "Only admins can connect data sources in this workspace.",
    Perm.MEMBERS_INVITE: "Only owners and admins can invite people.",
    Perm.MEMBERS_MANAGE: "Only owners and admins can manage the team.",
    Perm.ORG_DELETE: "Only the owner can delete the organization.",
    Perm.ORG_TRANSFER: "Only the owner can transfer ownership.",
    Perm.BILLING_MANAGE: "Only the owner can manage billing.",
    Perm.WORKSPACE_DELETE: "Only the owner can delete a workspace.",
}


class _HasRole(Protocol):
    role: str


def rank(role: str | None) -> int:
    """Higher is more powerful; unknown roles rank below viewer."""
    return len(ROLES) - ROLES.index(role) if role in ROLES else 0


def highest(*roles: str | None) -> str | None:
    present = [r for r in roles if r in ROLES]
    return max(present, key=rank) if present else None


def permissions_for(role: str, workspace_prefs: dict | None = None) -> set[Perm]:
    perms = set(ROLE_PERMISSIONS.get(role, frozenset()))
    if role == "analyst" and (workspace_prefs or {}).get("analysts_can_connect_sources"):
        perms.add(Perm.SOURCES_MANAGE)
    return perms


def has(member: _HasRole, perm: Perm) -> bool:
    prefs = None
    ws = getattr(member, "workspace", None)
    if ws is not None:
        prefs = getattr(ws, "preferences", None)
    return perm in permissions_for(member.role, prefs)


def require(member: _HasRole, perm: Perm, message: str | None = None) -> None:
    if not has(member, perm):
        raise HTTPException(status.HTTP_403_FORBIDDEN, message or _MESSAGES.get(perm, "You don't have permission to do that."))


def check_role_change(actor_role: str, target_current: str | None, new_role: str) -> None:
    """Role assignments never go above the actor, and admins can't touch the owner.

    Ownership only moves through a transfer, so nobody assigns "owner" here.
    """
    if new_role not in ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown role")
    if new_role == "owner":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Use Transfer ownership to make someone the owner.")
    if target_current == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The owner's role can't be changed. The owner can transfer ownership instead.")
    if rank(new_role) > rank(actor_role) or (target_current and rank(target_current) > rank(actor_role)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't give or change a role above your own.")
