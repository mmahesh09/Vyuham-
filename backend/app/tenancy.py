"""Organizations, workspaces and which one a request is acting in.

The request's workspace is never taken on trust: an `X-Workspace-Id` header or the saved selection is
only a hint, and is used only after checking the person is an active member of a live workspace in a
live organization. Organization owners and admins can open every workspace of their organization;
everyone else needs a workspace membership.

Postgres row-level security (migration c5e9a1f3b7d2) is a second wall behind these checks: `bind()`
records the workspace on the database session and `app.db` sets `app.workspace_id` at the start of
every transaction, so a query that forgot its `workspace_id` filter still can't see another tenant.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Organization, OrganizationMember, UserWorkspaceState, Workspace, WorkspaceMember
from app.permissions import FULL_ACCESS, rank

WORKSPACE_HEADER = "x-workspace-id"
_ID = re.compile(r"^[0-9a-f]{32}$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- row-level security binding ----------


def bind(db: Session, workspace_id: str | None) -> None:
    """Every later transaction on this session only sees `workspace_id`'s rows (Postgres RLS)."""
    db.info["rls_workspace_id"] = workspace_id
    db.info.pop("rls_bypass", None)
    _apply_now(db)


def bypass(db: Session) -> None:
    """For trusted server code that works across workspaces: workers, schedulers, staff tools and
    public token lookups (which then bind to the token's workspace before reading data)."""
    db.info["rls_bypass"] = True
    _apply_now(db)


def _apply_now(db: Session) -> None:
    """If a transaction is already open, set the values in it too (the listener covers later ones)."""
    if db.in_transaction():
        from app.db import apply_rls

        apply_rls(db, db.connection())


# ---------- membership ----------


def org_membership(db: Session, user_id: str, organization_id: str | None) -> OrganizationMember | None:
    if not organization_id:
        return None
    om = db.get(OrganizationMember, (organization_id, user_id))
    return om if om is not None and om.status == "active" else None


def live_workspace(db: Session, workspace_id: str | None) -> Workspace | None:
    if not workspace_id or not _ID.match(workspace_id):
        return None
    ws = db.get(Workspace, workspace_id)
    if ws is None or ws.deleted_at is not None:
        return None
    org = ws.organization
    if org is None or org.deleted_at is not None:
        return None
    return ws


def effective_role(db: Session, user_id: str, workspace_id: str) -> str | None:
    """The person's role in this workspace, or None when they have no access."""
    ws = live_workspace(db, workspace_id)
    if ws is None:
        return None
    om = org_membership(db, user_id, ws.organization_id)
    if om is None:
        return None
    return _combine(om.role, db.get(WorkspaceMember, (workspace_id, user_id)))


def _combine(org_role: str, wm: WorkspaceMember | None) -> str | None:
    """Owners and admins get their organization role everywhere. Others need a workspace row, and that
    row's role is capped at their organization role, so a stale row can never raise anyone's access."""
    if org_role in FULL_ACCESS:
        return org_role
    if wm is None:
        return None
    return wm.role if rank(wm.role) <= rank(org_role) else org_role


def _membership_row(db: Session, user_id: str, ws: Workspace) -> WorkspaceMember | None:
    """The workspace_members row with the effective role, creating or correcting it for owners and admins."""
    role = effective_role(db, user_id, ws.id)
    if role is None:
        return None
    wm = db.get(WorkspaceMember, (ws.id, user_id))
    if wm is None:
        wm = WorkspaceMember(workspace_id=ws.id, user_id=user_id, role=role)
        db.add(wm)
        try:
            db.commit()
        except IntegrityError:  # a parallel request added it
            db.rollback()
            wm = db.get(WorkspaceMember, (ws.id, user_id))
    elif wm.role != role:
        wm.role = role
        db.commit()
    return wm


def accessible_workspaces(db: Session, user_id: str) -> list[tuple[Workspace, str]]:
    """Every live workspace the person can open, with their role there, default workspaces first."""
    oms = db.scalars(
        select(OrganizationMember).where(OrganizationMember.user_id == user_id, OrganizationMember.status == "active")
    ).all()
    out: list[tuple[Workspace, str]] = []
    for om in oms:
        org = db.get(Organization, om.organization_id)
        if org is None or org.deleted_at is not None:
            continue
        rows = db.scalars(
            select(Workspace)
            .where(Workspace.organization_id == org.id, Workspace.deleted_at.is_(None))
            .order_by(Workspace.is_default.desc(), Workspace.created_at)
        ).all()
        ws_roles = {wm.workspace_id: wm for wm in db.scalars(select(WorkspaceMember).where(WorkspaceMember.user_id == user_id))}
        for ws in rows:
            role = _combine(om.role, ws_roles.get(ws.id))
            if role:
                out.append((ws, role))
    return out


class OnboardingRequired(HTTPException):
    def __init__(self) -> None:
        super().__init__(
            status.HTTP_409_CONFLICT,
            detail={"code": "onboarding_required", "message": "Set up your organization to continue."},
        )


def resolve(db: Session, user_id: str, requested: str | None = None) -> WorkspaceMember:
    """The membership this request acts as. Raises 403 for a workspace the person can't open."""
    if requested:
        ws = live_workspace(db, requested.strip())
        wm = _membership_row(db, user_id, ws) if ws else None
        if wm is None:
            # Same answer whether the workspace exists or not, so ids can't be probed.
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have access to that workspace.")
        return wm
    state = db.get(UserWorkspaceState, user_id)
    if state and state.current_workspace_id:
        ws = live_workspace(db, state.current_workspace_id)
        wm = _membership_row(db, user_id, ws) if ws else None
        if wm is not None:
            return wm
    options = accessible_workspaces(db, user_id)
    if not options:
        raise OnboardingRequired()
    ws, _ = options[0]
    wm = _membership_row(db, user_id, ws)
    if wm is None:  # pragma: no cover - accessible_workspaces just said yes
        raise OnboardingRequired()
    remember(db, user_id, ws.id)
    return wm


def remember(db: Session, user_id: str, workspace_id: str) -> None:
    state = db.get(UserWorkspaceState, user_id)
    if state is None:
        db.add(UserWorkspaceState(user_id=user_id, current_workspace_id=workspace_id))
    elif state.current_workspace_id != workspace_id:
        state.current_workspace_id = workspace_id
    else:
        return
    try:
        db.commit()
    except IntegrityError:  # two first requests at once; either row is fine
        db.rollback()


def sync_full_access(db: Session, organization_id: str, user_id: str, role: str) -> None:
    """Give an owner or admin a row in every workspace of the organization (call before commit)."""
    if role not in FULL_ACCESS:
        return
    for ws in db.scalars(select(Workspace).where(Workspace.organization_id == organization_id, Workspace.deleted_at.is_(None))):
        wm = db.get(WorkspaceMember, (ws.id, user_id))
        if wm is None:
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=user_id, role=role))
        else:
            wm.role = role


def set_org_role(db: Session, om: OrganizationMember, role: str) -> None:
    """Change someone's organization role and bring their workspace rows along (call before commit)."""
    om.role = role
    if role in FULL_ACCESS:
        sync_full_access(db, om.organization_id, om.user_id, role)
        return
    # Analyst or viewer: they keep the workspaces they're in (an admin stepping down keeps all of
    # them), at the new role. Admins can then remove them from individual workspaces.
    for wm in db.scalars(
        select(WorkspaceMember).join(Workspace, Workspace.id == WorkspaceMember.workspace_id).where(
            WorkspaceMember.user_id == om.user_id, Workspace.organization_id == om.organization_id
        )
    ):
        wm.role = role


def create_organization(
    db: Session,
    user_id: str,
    name: str,
    workspace_name: str | None = None,
    *,
    creation_key: str | None = None,
    company_size: str | None = None,
    industry: str | None = None,
    intended_use: list[str] | None = None,
    completed: bool = False,
) -> tuple[Organization, Workspace]:
    """An organization, its default workspace and its owner, in one transaction (caller commits)."""
    org = Organization(
        name=name[:120], created_by=user_id, creation_key=creation_key, company_size=company_size,
        industry=industry, intended_use=intended_use or [], onboarding_completed_at=_now() if completed else None,
    )
    ws = Workspace(name=(workspace_name or f"{name} workspace")[:120], organization=org, is_default=True, created_by=user_id, preferences={})
    db.add_all([org, ws])
    db.flush()
    db.add(OrganizationMember(organization_id=org.id, user_id=user_id, role="owner"))
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user_id, role="owner"))
    state = db.get(UserWorkspaceState, user_id)
    if state is None:
        db.add(UserWorkspaceState(user_id=user_id, current_workspace_id=ws.id))
    else:
        state.current_workspace_id = ws.id
    return org, ws
