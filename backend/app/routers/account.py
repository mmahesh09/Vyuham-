"""Account and workspace controls behind the DPDP rights in the privacy policy:
export my data, delete my account, leave an organization, delete a workspace.

Deletes are explicit, table by table, rather than relying on database cascades: SQLite doesn't
enforce foreign keys by default, and an erasure has to be complete on every database.
"""

import hashlib
import io
import json
import logging
import os
import shutil
import zipfile
from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.auth_tables import account_table, session_table, user_table, verification_table
from app.config import get_settings
from app.db import Base, get_db
from app.models import (
    Alert,
    AuditLog,
    Automation,
    CalculatedColumn,
    Chart,
    Dashboard,
    Dataset,
    Feedback,
    Invitation,
    Organization,
    OrganizationMember,
    Report,
    LeaveRecord,
    MetricVersion,
    Notification,
    QueryExecution,
    ReportRun,
    SavedQuery,
    SemanticDimension,
    SemanticMetric,
    SupportTicket,
    Task,
    TicketAttachment,
    TicketMessage,
    UserPresence,
    UserProfile,
    UserWorkspaceState,
    Workspace,
    WorkspaceMember,
)
from app.query import workspace_dir
from app.reports.storage import get_attachment_storage, get_storage
from app.routers.datasets import parquet_path
from app import tenancy
from app.permissions import Perm, require
from app.security import AuthUser, current_membership, current_user

router = APIRouter(tags=["account"])
log = logging.getLogger("app.account")


def _row(obj, *, skip: tuple[str, ...] = ()) -> dict:
    out = {}
    for col in obj.__table__.columns:
        if col.name in skip:
            continue
        v = getattr(obj, col.key)
        out[col.name] = v.isoformat() if isinstance(v, datetime) else v
    return out


def _json(data) -> bytes:
    return json.dumps(data, indent=2, default=str, ensure_ascii=False).encode()


# ---------- export (right of access) ----------


@router.get("/account/export")
def export_my_data(user: AuthUser = Depends(current_user), member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """A ZIP of everything we hold about you, plus the datasets you uploaded (as CSV)."""
    # Personal records (notifications, leave, feedback) can sit in any workspace the person is in;
    # every query below is limited to this person or to their current workspace.
    tenancy.bypass(db)
    me = db.execute(select(user_table).where(user_table.c.id == user.id)).mappings().first()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README.txt", (
            "Your data from Vyuham, exported "
            f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC.\n\n"
            "account.json: your account and profile. tasks.json, leave.json, notifications.json, feedback.json: your records.\n"
            "dashboards.json: dashboards you created. datasets/: files you uploaded, as CSV.\n"
            "Passwords are never exported (we only store a one-way hash).\n"
        ))
        profile = db.get(UserProfile, user.id)
        presence = db.get(UserPresence, user.id)
        z.writestr("account.json", _json({
            "user": {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in dict(me or {}).items()},
            "workspace": {"id": member.workspace_id, "name": member.workspace.name, "role": member.role},
            "profile": _row(profile) if profile else None,
            "status": _row(presence) if presence else None,
        }))
        # Workspace records are limited to the workspace the person is in now: after being removed from
        # a workspace (or leaving it), their old uploads and dashboards there are no longer theirs to take.
        ws_id = member.workspace_id
        z.writestr("tasks.json", _json([_row(t) for t in db.scalars(
            select(Task).where(Task.workspace_id == ws_id, (Task.assignee_id == user.id) | (Task.created_by == user.id)))]))
        z.writestr("leave.json", _json([_row(lv) for lv in db.scalars(select(LeaveRecord).where(LeaveRecord.user_id == user.id))]))
        z.writestr("notifications.json", _json([_row(n) for n in db.scalars(select(Notification).where(Notification.user_id == user.id))]))
        z.writestr("feedback.json", _json([_row(f) for f in db.scalars(select(Feedback).where(Feedback.user_id == user.id))]))
        dashboards = db.scalars(select(Dashboard).where(Dashboard.created_by == user.id, Dashboard.workspace_id == ws_id)).all()
        z.writestr("dashboards.json", _json([{**_row(d, skip=("share_token",)), "charts": [_row(c) for c in d.charts]} for d in dashboards]))
        for ds in db.scalars(select(Dataset).where(Dataset.created_by == user.id, Dataset.workspace_id == ws_id)):
            path = parquet_path(ds.workspace_id, ds.id)
            if path.exists():
                safe = "".join(ch if ch.isalnum() or ch in " -_." else "_" for ch in ds.name)[:80] or ds.id
                z.writestr(f"datasets/{safe}.csv", pd.read_parquet(path).to_csv(index=False))
    buf.seek(0)
    name = f"vyuham-export-{datetime.now(timezone.utc):%Y%m%d}.zip"
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------- workspace deletion ----------


def _erase_workspace(db: Session, workspace_id: str) -> None:
    """Everything in a workspace: exported files, rows (children before parents), then its data folder.

    Every table with a workspace_id is covered automatically, so a new table can't be forgotten here.
    """
    storage = get_storage()
    for key in db.scalars(select(ReportRun.file_key).where(ReportRun.workspace_id == workspace_id, ReportRun.file_key.is_not(None))):
        try:
            storage.delete(key)
        except Exception:  # keep erasing; this is logged for staff to finish by hand
            log.exception("[erasure] couldn't delete a report file")
    shutil.rmtree(os.path.join(get_settings().data_dir, "reports", workspace_id), ignore_errors=True)
    files = get_attachment_storage()
    for key in db.scalars(select(TicketAttachment.storage_key).where(TicketAttachment.workspace_id == workspace_id)):
        try:
            files.delete(key)
        except Exception:
            log.exception("[erasure] couldn't delete a support attachment")
    db.execute(delete(Chart).where(Chart.dashboard_id.in_(select(Dashboard.id).where(Dashboard.workspace_id == workspace_id))))
    db.execute(delete(TicketMessage).where(TicketMessage.ticket_id.in_(select(SupportTicket.id).where(SupportTicket.workspace_id == workspace_id))))
    for table in reversed(Base.metadata.sorted_tables):
        if "workspace_id" in table.c:
            db.execute(table.delete().where(table.c.workspace_id == workspace_id))
    db.execute(update(UserWorkspaceState).where(UserWorkspaceState.current_workspace_id == workspace_id).values(current_workspace_id=None))
    db.execute(delete(Workspace).where(Workspace.id == workspace_id))
    shutil.rmtree(workspace_dir(workspace_id), ignore_errors=True)


def _erase_organization(db: Session, organization_id: str) -> None:
    """Every workspace in the organization, then its members, invitations and the organization."""
    for ws_id in list(db.scalars(select(Workspace.id).where(Workspace.organization_id == organization_id))):
        _erase_workspace(db, ws_id)
    db.execute(delete(AuditLog).where(AuditLog.organization_id == organization_id))
    db.execute(delete(Invitation).where(Invitation.organization_id == organization_id))
    db.execute(delete(OrganizationMember).where(OrganizationMember.organization_id == organization_id))
    db.execute(delete(Organization).where(Organization.id == organization_id))


class ConfirmIn(BaseModel):
    confirm: str


@router.delete("/workspace", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(body: ConfirmIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Erase the current workspace and everything in it (not a soft delete: the right to erasure).

    The organization's last workspace takes the organization with it.
    """
    require(member, Perm.WORKSPACE_DELETE)
    if body.confirm.strip() != member.workspace.name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type the workspace name exactly to confirm.")
    ws_id, org_id = member.workspace_id, member.organization_id
    others = db.scalar(select(func.count()).where(Workspace.organization_id == org_id, Workspace.id != ws_id)) if org_id else 0
    tenancy.bypass(db)  # erasure spans tables and, for the last workspace, the whole organization
    if others:
        _erase_workspace(db, ws_id)
    else:
        _erase_organization(db, org_id) if org_id else _erase_workspace(db, ws_id)
    db.commit()
    log.warning("[erasure] workspace %s deleted by user %s", hashlib.sha256(ws_id.encode()).hexdigest()[:16], hashlib.sha256(member.user_id.encode()).hexdigest()[:16])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workspace/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_workspace(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Leave the organization the current workspace belongs to (kept for older clients)."""
    from app.routers.organizations import leave_organization

    return leave_organization(member, db)


# ---------- account deletion (right to erasure) ----------


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(body: ConfirmIn, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    if body.confirm.strip().lower() != user.email.lower():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type your email address exactly to confirm.")
    tenancy.bypass(db)  # the person's records sit in every workspace they belong to
    oms = db.scalars(select(OrganizationMember).where(OrganizationMember.user_id == user.id, OrganizationMember.status == "active")).all()
    for om in oms:
        others = db.scalar(select(func.count()).where(
            OrganizationMember.organization_id == om.organization_id, OrganizationMember.user_id != user.id,
            OrganizationMember.status == "active",
        ))
        if om.role == "owner" and others:
            org = db.get(Organization, om.organization_id)
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"You're the owner of {org.name if org else 'an organization'}, which has other people in it. "
                "Transfer ownership to an admin, or delete the organization, first.",
            )
    for om in oms:
        others = db.scalar(select(func.count()).where(
            OrganizationMember.organization_id == om.organization_id, OrganizationMember.user_id != user.id,
            OrganizationMember.status == "active",
        ))
        if not others:
            _erase_organization(db, om.organization_id)  # nobody else uses it
    db.execute(update(Task).where(Task.assignee_id == user.id).values(assignee_id=None))
    db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == user.id))
    db.execute(delete(OrganizationMember).where(OrganizationMember.user_id == user.id))
    db.execute(delete(UserWorkspaceState).where(UserWorkspaceState.user_id == user.id))

    uid = user.id
    # Personal records go; shared work stays but no longer points at them.
    for model, col in ((Notification, Notification.user_id), (Feedback, Feedback.user_id), (LeaveRecord, LeaveRecord.user_id)):
        db.execute(delete(model).where(col == uid))
    db.execute(delete(UserPresence).where(UserPresence.user_id == uid))
    db.execute(delete(UserProfile).where(UserProfile.user_id == uid))
    db.execute(update(LeaveRecord).where(LeaveRecord.backup_user_id == uid).values(backup_user_id=None))
    db.execute(update(Task).where(Task.assignee_id == uid).values(assignee_id=None))
    for model in (Task, Dashboard, Dataset, Alert, Automation, SavedQuery, Report, SemanticMetric, MetricVersion, SemanticDimension, CalculatedColumn, Workspace, Organization):
        db.execute(update(model).where(model.created_by == uid).values(created_by=None))
    for model in (Dashboard, SavedQuery, Report):
        db.execute(update(model).where(model.updated_by == uid).values(updated_by=None))
    db.execute(update(SemanticMetric).where(SemanticMetric.owner_id == uid).values(owner_id=None))
    for model in (AuditLog, QueryExecution):
        db.execute(update(model).where(model.user_id == uid).values(user_id=None))
    for col in ("invited_by", "accepted_by", "revoked_by"):
        db.execute(update(Invitation).where(getattr(Invitation, col) == uid).values({col: None}))
    db.execute(delete(session_table).where(session_table.c.userId == uid))
    db.execute(delete(account_table).where(account_table.c.userId == uid))
    db.execute(delete(verification_table).where(verification_table.c.identifier == user.email))
    db.execute(delete(user_table).where(user_table.c.id == uid))
    db.commit()
    log.warning("[erasure] account %s deleted", hashlib.sha256(uid.encode()).hexdigest()[:16])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
