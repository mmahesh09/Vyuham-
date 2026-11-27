"""Organization, members, workspaces, switching, billing summary and the activity log.

Every id in a path is checked against the caller's own access (app/tenancy.py); nothing is trusted
from the client. Permission rules live in app/permissions.py.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.orm import Session

from app import plans, tenancy
from app.audit import record_org_action
from app.auth_tables import user_table
from app.db import get_db
from app.models import (
    AuditLog,
    Invitation,
    Notification,
    Organization,
    OrganizationMember,
    Task,
    UserWorkspaceState,
    Workspace,
    WorkspaceMember,
)
from app.permissions import FULL_ACCESS, Perm, check_role_change, has, permissions_for, rank, require
from app.schemas import UtcDatetime
from app.security import AuthUser, current_membership, current_user

router = APIRouter(tags=["organizations"])

CompanySize = Literal["1", "2-10", "11-50", "51-200", "201-1000", "1000+"]
MemberRole = Literal["admin", "analyst", "viewer"]
WorkspaceRole = Literal["analyst", "viewer"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _org(db: Session, member: WorkspaceMember) -> Organization:
    org = db.get(Organization, member.organization_id) if member.organization_id else None
    if org is None or org.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


def _actor(db: Session, member: WorkspaceMember) -> OrganizationMember:
    om = tenancy.org_membership(db, member.user_id, member.organization_id)
    if om is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You're not a member of this organization.")
    return om


def _org_perm(om: OrganizationMember, perm: Perm) -> None:
    """Organization-level actions use the organization role, not a workspace role."""
    require(om, perm)


# ---------- organization ----------


class OwnerOut(BaseModel):
    id: str
    name: str
    email: str


class OrganizationOut(BaseModel):
    id: str
    name: str
    company_size: str | None
    industry: str | None
    intended_use: list[str]
    plan: str
    plan_status: str
    created_at: UtcDatetime
    onboarding_completed: bool
    my_role: str
    owner: OwnerOut | None


def _org_out(db: Session, org: Organization, my_role: str) -> OrganizationOut:
    owner_id = db.scalar(
        select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id == org.id, OrganizationMember.role == "owner", OrganizationMember.status == "active"
        )
    )
    owner = None
    if owner_id:
        row = db.execute(select(user_table.c.id, user_table.c.name, user_table.c.email).where(user_table.c.id == owner_id)).first()
        if row:
            owner = OwnerOut(id=row.id, name=row.name, email=row.email)
    return OrganizationOut(
        id=org.id, name=org.name, company_size=org.company_size, industry=org.industry, intended_use=org.intended_use or [],
        plan=org.plan, plan_status=org.plan_status, created_at=org.created_at,
        onboarding_completed=org.onboarding_completed_at is not None, my_role=my_role, owner=owner,
    )


@router.get("/organizations/current", response_model=OrganizationOut)
def get_organization(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    org = _org(db, member)
    return _org_out(db, org, _actor(db, member).role)


class OrganizationPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    company_size: CompanySize | None = None
    industry: str | None = Field(default=None, max_length=60)
    intended_use: list[str] | None = Field(default=None, max_length=12)


@router.patch("/organizations/current", response_model=OrganizationOut)
def update_organization(body: OrganizationPatch, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    org = _org(db, member)
    om = _actor(db, member)
    _org_perm(om, Perm.ORG_SETTINGS)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        data["name"] = data["name"].strip()
    if "intended_use" in data:
        data["intended_use"] = [u.strip()[:40] for u in data["intended_use"] or [] if u.strip()]
    for k, v in data.items():
        setattr(org, k, v)
    record_org_action(db, org.id, member.user_id, "org.update", "organization", org.id, {"fields": sorted(data)})
    db.commit()
    return _org_out(db, org, om.role)


class ConfirmIn(BaseModel):
    confirm: str


@router.delete("/organizations/current", status_code=status.HTTP_204_NO_CONTENT)
def delete_organization(body: ConfirmIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Soft delete: nobody can open it any more; the data stays until it's purged (support can restore it)."""
    org = _org(db, member)
    _org_perm(_actor(db, member), Perm.ORG_DELETE)
    if body.confirm.strip() != org.name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type the organization name exactly to confirm.")
    org.deleted_at = _now()
    db.execute(update(Workspace).where(Workspace.organization_id == org.id, Workspace.deleted_at.is_(None)).values(deleted_at=_now()))
    db.execute(update(Invitation).where(Invitation.organization_id == org.id, Invitation.status == "pending").values(status="revoked", revoked_at=_now(), revoked_by=member.user_id))
    record_org_action(db, org.id, member.user_id, "org.delete", "organization", org.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class TransferIn(BaseModel):
    user_id: str = Field(max_length=64)


@router.post("/organizations/current/transfer", response_model=OrganizationOut)
def transfer_ownership(body: TransferIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    org = _org(db, member)
    me = _actor(db, member)
    _org_perm(me, Perm.ORG_TRANSFER)
    target = tenancy.org_membership(db, body.user_id, org.id)
    if target is None or target.user_id == me.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if target.role != "admin":
        raise HTTPException(status.HTTP_409_CONFLICT, "Make them an admin first, then transfer ownership.")
    tenancy.set_org_role(db, me, "admin")
    db.flush()  # one owner at a time (unique index): step down before the new owner steps up
    tenancy.set_org_role(db, target, "owner")
    record_org_action(db, org.id, me.user_id, "ownership.transfer", "user", target.user_id)
    db.commit()
    return _org_out(db, org, "admin")


@router.get("/organizations/current/billing")
def billing(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    org = _org(db, member)
    _org_perm(_actor(db, member), Perm.BILLING_VIEW)
    return plans.summary(db, org, member.workspace_id)


# ---------- members ----------


class WorkspaceRoleOut(BaseModel):
    workspace_id: str
    workspace_name: str
    role: str


class OrgMemberOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    status: str
    joined_at: UtcDatetime
    workspaces: list[WorkspaceRoleOut]


@router.get("/organizations/current/members", response_model=list[OrgMemberOut])
def org_members(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    org = _org(db, member)
    _org_perm(_actor(db, member), Perm.MEMBERS_MANAGE)
    rows = db.execute(
        select(user_table.c.id, user_table.c.name, user_table.c.email, OrganizationMember.role, OrganizationMember.status, OrganizationMember.joined_at)
        .join(OrganizationMember, OrganizationMember.user_id == user_table.c.id)
        .where(OrganizationMember.organization_id == org.id, OrganizationMember.status == "active")
        .order_by(OrganizationMember.joined_at)
    ).all()
    ws_rows = db.execute(
        select(WorkspaceMember.user_id, Workspace.id, Workspace.name, WorkspaceMember.role)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(Workspace.organization_id == org.id, Workspace.deleted_at.is_(None))
        .order_by(Workspace.created_at)
    ).all()
    by_user: dict[str, list[WorkspaceRoleOut]] = {}
    for uid, wid, wname, role in ws_rows:
        by_user.setdefault(uid, []).append(WorkspaceRoleOut(workspace_id=wid, workspace_name=wname, role=role))
    return [
        OrgMemberOut(id=r.id, name=r.name, email=r.email, role=r.role, status=r.status, joined_at=r.joined_at, workspaces=by_user.get(r.id, []))
        for r in rows
    ]


class RoleIn(BaseModel):
    role: MemberRole


def change_member_role(db: Session, member: WorkspaceMember, user_id: str, role: str) -> OrganizationMember:
    org = _org(db, member)
    me = _actor(db, member)
    _org_perm(me, Perm.MEMBERS_MANAGE)
    target = tenancy.org_membership(db, user_id, org.id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if target.user_id == me.user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can't change your own role. Ask another admin, or transfer ownership.")
    check_role_change(me.role, target.role, role)
    before = target.role
    tenancy.set_org_role(db, target, role)
    record_org_action(db, org.id, me.user_id, "member.role", "user", user_id, {"from": before, "to": role})
    db.commit()
    return target


@router.patch("/organizations/current/members/{user_id}")
def update_member(user_id: str, body: RoleIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    target = change_member_role(db, member, user_id, body.role)
    return {"user_id": user_id, "role": target.role}


def _detach(db: Session, organization_id: str, user_id: str) -> None:
    """Take someone out of every workspace of the organization; their shared work stays.

    Spans workspaces, so it runs outside row-level security; the caller has already checked permission
    and the statements below are all limited to this organization's workspace ids.
    """
    tenancy.bypass(db)
    ws_ids = list(db.scalars(select(Workspace.id).where(Workspace.organization_id == organization_id)))
    if ws_ids:
        db.execute(update(Task).where(Task.workspace_id.in_(ws_ids), Task.assignee_id == user_id).values(assignee_id=None))
        db.execute(delete(Notification).where(Notification.workspace_id.in_(ws_ids), Notification.user_id == user_id))
        db.execute(delete(WorkspaceMember).where(WorkspaceMember.workspace_id.in_(ws_ids), WorkspaceMember.user_id == user_id))
        db.execute(
            update(UserWorkspaceState).where(UserWorkspaceState.user_id == user_id, UserWorkspaceState.current_workspace_id.in_(ws_ids))
            .values(current_workspace_id=None)
        )


def remove_member(db: Session, member: WorkspaceMember, user_id: str) -> None:
    org = _org(db, member)
    me = _actor(db, member)
    _org_perm(me, Perm.MEMBERS_MANAGE)
    target = tenancy.org_membership(db, user_id, org.id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if target.user_id == me.user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Use Leave organization to remove yourself.")
    if target.role == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The owner can't be removed. The owner can transfer ownership first.")
    if rank(target.role) > rank(me.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't remove someone with a higher role.")
    target.status, target.removed_at = "removed", _now()
    _detach(db, org.id, user_id)
    record_org_action(db, org.id, me.user_id, "member.remove", "user", user_id, {"role": target.role})
    db.commit()


@router.delete("/organizations/current/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(user_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    remove_member(db, member, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/organizations/current/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_organization(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    org = _org(db, member)
    me = _actor(db, member)
    if me.role == "owner":
        raise HTTPException(status.HTTP_409_CONFLICT, "Transfer ownership to an admin before you leave, or delete the organization.")
    me.status, me.removed_at = "removed", _now()
    _detach(db, org.id, me.user_id)
    record_org_action(db, org.id, me.user_id, "member.leave", "user", me.user_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- workspaces ----------


class WorkspaceSummary(BaseModel):
    id: str
    name: str
    organization_id: str
    organization_name: str
    role: str
    is_default: bool
    logo_url: str | None
    current: bool


class WorkspacesOut(BaseModel):
    current_workspace_id: str
    workspaces: list[WorkspaceSummary]
    can_create: bool


def workspace_list(db: Session, user_id: str, current_id: str) -> list[WorkspaceSummary]:
    names: dict[str, str] = {}
    out = []
    for ws, role in tenancy.accessible_workspaces(db, user_id):
        if ws.organization_id not in names:
            org = db.get(Organization, ws.organization_id)
            names[ws.organization_id] = org.name if org else ""
        out.append(WorkspaceSummary(
            id=ws.id, name=ws.name, organization_id=ws.organization_id, organization_name=names[ws.organization_id],
            role=role, is_default=ws.is_default, logo_url=ws.logo_url, current=ws.id == current_id,
        ))
    return out


@router.get("/workspaces", response_model=WorkspacesOut)
def list_workspaces(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    om = _actor(db, member)
    return WorkspacesOut(
        current_workspace_id=member.workspace_id, workspaces=workspace_list(db, member.user_id, member.workspace_id),
        can_create=Perm.WORKSPACE_CREATE in permissions_for(om.role),
    )


class SwitchIn(BaseModel):
    workspace_id: str = Field(max_length=32)


@router.put("/me/workspace", response_model=WorkspacesOut)
def switch_workspace(body: SwitchIn, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    """Remember a workspace as the current one. Checked here and again on every later request."""
    wm = tenancy.resolve(db, user.id, body.workspace_id)  # 403 when they can't open it
    tenancy.remember(db, user.id, wm.workspace_id)
    om = tenancy.org_membership(db, user.id, wm.organization_id)
    return WorkspacesOut(
        current_workspace_id=wm.workspace_id, workspaces=workspace_list(db, user.id, wm.workspace_id),
        can_create=bool(om and Perm.WORKSPACE_CREATE in permissions_for(om.role)),
    )


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class WorkspaceDetail(BaseModel):
    id: str
    organization_id: str
    name: str
    description: str | None
    logo_url: str | None
    is_default: bool
    preferences: dict
    created_at: UtcDatetime
    my_role: str


def _detail(ws: Workspace, role: str) -> WorkspaceDetail:
    return WorkspaceDetail(
        id=ws.id, organization_id=ws.organization_id, name=ws.name, description=ws.description, logo_url=ws.logo_url,
        is_default=ws.is_default, preferences=ws.preferences or {}, created_at=ws.created_at, my_role=role,
    )


def _name_taken(db: Session, org_id: str, name: str, except_id: str | None = None) -> bool:
    q = select(Workspace.id).where(Workspace.organization_id == org_id, Workspace.deleted_at.is_(None), func.lower(Workspace.name) == name.lower())
    if except_id:
        q = q.where(Workspace.id != except_id)
    return db.scalar(q) is not None


@router.post("/workspaces", response_model=WorkspaceDetail, status_code=status.HTTP_201_CREATED)
def create_workspace(body: WorkspaceIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    org = _org(db, member)
    om = _actor(db, member)
    _org_perm(om, Perm.WORKSPACE_CREATE)
    name = body.name.strip()
    if _name_taken(db, org.id, name):
        raise HTTPException(status.HTTP_409_CONFLICT, "There's already a workspace with that name.")
    plans.check_workspaces(db, org)
    ws = Workspace(organization_id=org.id, name=name, description=body.description, created_by=member.user_id, preferences={})
    db.add(ws)
    db.flush()
    # Every owner and admin can open every workspace.
    for o in db.scalars(select(OrganizationMember).where(
        OrganizationMember.organization_id == org.id, OrganizationMember.status == "active", OrganizationMember.role.in_(FULL_ACCESS)
    )):
        db.add(WorkspaceMember(workspace_id=ws.id, user_id=o.user_id, role=o.role))
    record_org_action(db, org.id, member.user_id, "workspace.create", "workspace", ws.id, {"name": name}, workspace_id=ws.id)
    db.commit()
    return _detail(ws, om.role)


def _workspace_for(db: Session, user_id: str, workspace_id: str) -> tuple[Workspace, str]:
    role = tenancy.effective_role(db, user_id, workspace_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return db.get(Workspace, workspace_id), role


class _RoleView:
    """Lets permissions.has() check a role inside a given workspace (for its preferences)."""

    def __init__(self, role: str, workspace: Workspace):
        self.role, self.workspace = role, workspace


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceDetail)
def get_workspace(workspace_id: str, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    ws, role = _workspace_for(db, user.id, workspace_id)
    return _detail(ws, role)


class Preferences(BaseModel):
    departments: list[str] | None = Field(default=None, max_length=20)
    data_sources: list[str] | None = Field(default=None, max_length=20)
    use_cases: list[str] | None = Field(default=None, max_length=20)
    workflows: list[str] | None = Field(default=None, max_length=20)
    analysts_can_connect_sources: bool | None = None


class WorkspacePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    logo_url: str | None = Field(default=None, max_length=500, pattern=r"^(https://\S+)?$")
    is_default: bool | None = None
    preferences: Preferences | None = None


def apply_preferences(ws: Workspace, prefs: Preferences) -> None:
    merged = dict(ws.preferences or {})
    for k, v in prefs.model_dump(exclude_unset=True).items():
        merged[k] = [x.strip()[:60] for x in v if x and x.strip()] if isinstance(v, list) else v
    ws.preferences = merged


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceDetail)
def update_workspace(workspace_id: str, body: WorkspacePatch, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    ws, role = _workspace_for(db, user.id, workspace_id)
    tenancy.bind(db, ws.id)
    if not has(_RoleView(role, ws), Perm.WORKSPACE_SETTINGS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners and admins can change workspace settings.")
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        name = data["name"].strip()
        if _name_taken(db, ws.organization_id, name, ws.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "There's already a workspace with that name.")
        ws.name = name
    if "description" in data:
        ws.description = data["description"]
    if "logo_url" in data:
        ws.logo_url = data["logo_url"] or None
    if data.get("is_default"):
        db.execute(update(Workspace).where(Workspace.organization_id == ws.organization_id, Workspace.id != ws.id).values(is_default=False))
        ws.is_default = True
    if body.preferences is not None:
        apply_preferences(ws, body.preferences)
    record_org_action(db, ws.organization_id, user.id, "workspace.update", "workspace", ws.id, {"fields": sorted(data)}, workspace_id=ws.id)
    db.commit()
    return _detail(ws, role)


@router.delete("/workspaces/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(workspace_id: str, body: ConfirmIn, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    ws, role = _workspace_for(db, user.id, workspace_id)
    if Perm.WORKSPACE_DELETE not in permissions_for(role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can delete a workspace.")
    if body.confirm.strip() != ws.name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type the workspace name exactly to confirm.")
    others = db.scalars(
        select(Workspace).where(Workspace.organization_id == ws.organization_id, Workspace.id != ws.id, Workspace.deleted_at.is_(None))
        .order_by(Workspace.created_at)
    ).all()
    if not others:
        raise HTTPException(status.HTTP_409_CONFLICT, "This is the organization's only workspace. Delete the organization instead.")
    ws.deleted_at = _now()
    if ws.is_default:
        ws.is_default = False
        others[0].is_default = True
    db.execute(update(Invitation).where(Invitation.workspace_id == ws.id, Invitation.status == "pending").values(workspace_id=others[0].id))
    record_org_action(db, ws.organization_id, user.id, "workspace.delete", "workspace", ws.id, {"name": ws.name})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class WorkspaceMemberOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    org_role: str
    joined_at: UtcDatetime


@router.get("/workspaces/{workspace_id}/members", response_model=list[WorkspaceMemberOut])
def workspace_members(workspace_id: str, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    ws, _ = _workspace_for(db, user.id, workspace_id)
    rows = db.execute(
        select(user_table.c.id, user_table.c.name, user_table.c.email, WorkspaceMember.role, WorkspaceMember.created_at, OrganizationMember.role.label("org_role"))
        .join(WorkspaceMember, WorkspaceMember.user_id == user_table.c.id)
        .join(OrganizationMember, and_(OrganizationMember.user_id == user_table.c.id, OrganizationMember.organization_id == ws.organization_id))
        .where(WorkspaceMember.workspace_id == ws.id, OrganizationMember.status == "active")
        .order_by(WorkspaceMember.created_at)
    ).all()
    return [WorkspaceMemberOut(id=r.id, name=r.name, email=r.email, role=r.role, org_role=r.org_role, joined_at=r.created_at) for r in rows]


class WorkspaceRoleIn(BaseModel):
    role: WorkspaceRole


@router.put("/workspaces/{workspace_id}/members/{user_id}")
def set_workspace_member(workspace_id: str, user_id: str, body: WorkspaceRoleIn, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    """Add an organization member to a workspace, or change their role there (analyst or viewer)."""
    ws, role = _workspace_for(db, user.id, workspace_id)
    if Perm.MEMBERS_MANAGE not in permissions_for(role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners and admins can manage workspace members.")
    target = tenancy.org_membership(db, user_id, ws.organization_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite them to the organization first.")
    if target.role in FULL_ACCESS:
        raise HTTPException(status.HTTP_409_CONFLICT, "Owners and admins already have every workspace.")
    if rank(body.role) > rank(target.role):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Their organization role is {target.role}. Change that first.")
    wm = db.get(WorkspaceMember, (ws.id, user_id))
    if wm is None:
        db.add(WorkspaceMember(workspace_id=ws.id, user_id=user_id, role=body.role))
    else:
        wm.role = body.role
    record_org_action(db, ws.organization_id, user.id, "member.workspace_role", "user", user_id, {"role": body.role}, workspace_id=ws.id)
    db.commit()
    return {"user_id": user_id, "workspace_id": ws.id, "role": body.role}


@router.delete("/workspaces/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_workspace_member(workspace_id: str, user_id: str, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    ws, role = _workspace_for(db, user.id, workspace_id)
    if Perm.MEMBERS_MANAGE not in permissions_for(role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners and admins can manage workspace members.")
    target = tenancy.org_membership(db, user_id, ws.organization_id)
    if target is not None and target.role in FULL_ACCESS:
        raise HTTPException(status.HTTP_409_CONFLICT, "Owners and admins have every workspace. Change their organization role first.")
    tenancy.bind(db, ws.id)
    db.execute(update(Task).where(Task.workspace_id == ws.id, Task.assignee_id == user_id).values(assignee_id=None))
    db.execute(delete(WorkspaceMember).where(WorkspaceMember.workspace_id == ws.id, WorkspaceMember.user_id == user_id))
    record_org_action(db, ws.organization_id, user.id, "member.workspace_remove", "user", user_id, workspace_id=ws.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- activity ----------


class ActivityItem(BaseModel):
    id: str
    action: str
    target_type: str
    target_id: str | None
    detail: dict
    actor_id: str | None
    actor_name: str | None
    workspace_id: str | None
    workspace_name: str | None
    created_at: UtcDatetime


class ActivityPage(BaseModel):
    items: list[ActivityItem]
    next_before: UtcDatetime | None


@router.get("/activity", response_model=ActivityPage)
def activity_log(
    scope: Literal["workspace", "organization"] = "workspace",
    before: datetime | None = None,
    limit: int = Query(50, ge=1, le=200),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    """The audit trail, newest first. Owners and admins only."""
    org = _org(db, member)
    require(member, Perm.ACTIVITY_VIEW, "The activity log is for owners and admins.")
    ws_ids = list(db.scalars(select(Workspace.id).where(Workspace.organization_id == org.id)))
    if scope == "workspace":
        cond = AuditLog.workspace_id == member.workspace_id
    else:
        cond = or_(AuditLog.organization_id == org.id, AuditLog.workspace_id.in_(ws_ids))
    q = select(AuditLog).where(cond)
    if before:
        q = q.where(AuditLog.created_at < before)
    rows = db.scalars(q.order_by(AuditLog.created_at.desc()).limit(limit + 1)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    uids = {r.user_id for r in rows if r.user_id}
    names = dict(db.execute(select(user_table.c.id, user_table.c.name).where(user_table.c.id.in_(uids))).all()) if uids else {}
    ws_names = dict(db.execute(select(Workspace.id, Workspace.name).where(Workspace.id.in_(ws_ids))).all()) if ws_ids else {}
    items = [
        ActivityItem(
            id=r.id, action=r.action, target_type=r.target_type, target_id=r.target_id, detail=r.detail or {},
            actor_id=r.user_id, actor_name=names.get(r.user_id or ""), workspace_id=r.workspace_id,
            workspace_name=ws_names.get(r.workspace_id or ""), created_at=r.created_at,
        )
        for r in rows
    ]
    return ActivityPage(items=items, next_before=rows[-1].created_at if more and rows else None)
