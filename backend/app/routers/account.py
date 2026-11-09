"""Account and workspace controls behind the DPDP rights in the privacy policy:
export my data, delete my account, leave a workspace, delete a workspace.

Deletes are explicit, table by table, rather than relying on database cascades: SQLite doesn't
enforce foreign keys by default, and an erasure has to be complete on every database.
"""

import hashlib
import io
import json
import logging
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
from app.db import get_db
from app.models import (
    Alert,
    AlertEvent,
    Automation,
    Chart,
    Dashboard,
    Dataset,
    Feedback,
    Invite,
    LeaveRecord,
    Notification,
    SavedQuery,
    Task,
    UserPresence,
    UserProfile,
    Workspace,
    WorkspaceMember,
)
from app.query import workspace_dir
from app.routers.datasets import parquet_path
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
        z.writestr("tasks.json", _json([_row(t) for t in db.scalars(
            select(Task).where((Task.assignee_id == user.id) | (Task.created_by == user.id)))]))
        z.writestr("leave.json", _json([_row(lv) for lv in db.scalars(select(LeaveRecord).where(LeaveRecord.user_id == user.id))]))
        z.writestr("notifications.json", _json([_row(n) for n in db.scalars(select(Notification).where(Notification.user_id == user.id))]))
        z.writestr("feedback.json", _json([_row(f) for f in db.scalars(select(Feedback).where(Feedback.user_id == user.id))]))
        dashboards = db.scalars(select(Dashboard).where(Dashboard.created_by == user.id)).all()
        z.writestr("dashboards.json", _json([{**_row(d, skip=("share_token",)), "charts": [_row(c) for c in d.charts]} for d in dashboards]))
        for ds in db.scalars(select(Dataset).where(Dataset.created_by == user.id)):
            path = parquet_path(ds.workspace_id, ds.id)
            if path.exists():
                safe = "".join(ch if ch.isalnum() or ch in " -_." else "_" for ch in ds.name)[:80] or ds.id
                z.writestr(f"datasets/{safe}.csv", pd.read_parquet(path).to_csv(index=False))
    buf.seek(0)
    name = f"vyuham-export-{datetime.now(timezone.utc):%Y%m%d}.zip"
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------- workspace deletion ----------


def _erase_workspace(db: Session, workspace_id: str) -> None:
    """Everything in a workspace: rows first (children before parents), then its files."""
    dash_ids = select(Dashboard.id).where(Dashboard.workspace_id == workspace_id)
    db.execute(delete(Chart).where(Chart.dashboard_id.in_(dash_ids)))
    for model in (AlertEvent, Notification, Alert, Automation, Task, Invite, SavedQuery, LeaveRecord, Dashboard, Dataset, Feedback, WorkspaceMember):
        db.execute(delete(model).where(model.workspace_id == workspace_id))
    db.execute(delete(Workspace).where(Workspace.id == workspace_id))
    shutil.rmtree(workspace_dir(workspace_id), ignore_errors=True)


class ConfirmIn(BaseModel):
    confirm: str


@router.delete("/workspace", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(body: ConfirmIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    if member.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners can delete the workspace.")
    if body.confirm.strip() != member.workspace.name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Type the workspace name exactly to confirm.")
    ws_id = member.workspace_id
    _erase_workspace(db, ws_id)
    db.commit()
    log.warning("[erasure] workspace %s deleted by user %s", hashlib.sha256(ws_id.encode()).hexdigest()[:16], hashlib.sha256(member.user_id.encode()).hexdigest()[:16])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workspace/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_workspace(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    others = db.scalar(select(func.count()).where(WorkspaceMember.workspace_id == member.workspace_id, WorkspaceMember.user_id != member.user_id))
    if not others:
        raise HTTPException(status.HTTP_409_CONFLICT, "You're the only person here. Delete the workspace instead.")
    owners = db.scalar(select(func.count()).where(WorkspaceMember.workspace_id == member.workspace_id, WorkspaceMember.role == "owner"))
    if member.role == "owner" and owners <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Make someone else an owner before you leave.")
    db.execute(update(Task).where(Task.workspace_id == member.workspace_id, Task.assignee_id == member.user_id).values(assignee_id=None))
    db.execute(delete(Notification).where(Notification.user_id == member.user_id))
    db.delete(member)
    db.commit()
    # Their next visit creates a fresh, empty workspace of their own (security.current_membership).
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- account deletion (right to erasure) ----------


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(body: ConfirmIn, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    if body.confirm.strip().lower() != user.email.lower():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Type your email address exactly to confirm.")
    member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.user_id == user.id))
    if member:
        others = db.scalar(select(func.count()).where(WorkspaceMember.workspace_id == member.workspace_id, WorkspaceMember.user_id != user.id))
        owners = db.scalar(select(func.count()).where(WorkspaceMember.workspace_id == member.workspace_id, WorkspaceMember.role == "owner"))
        if others and member.role == "owner" and owners <= 1:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "You're the only owner of a workspace with other people in it. Make someone else an owner, or delete the workspace, first.",
            )
        if not others:
            _erase_workspace(db, member.workspace_id)  # nobody else uses it
        else:
            db.execute(update(Task).where(Task.workspace_id == member.workspace_id, Task.assignee_id == user.id).values(assignee_id=None))
            db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == user.id))

    uid = user.id
    # Personal records go; shared work stays but no longer points at them.
    for model, col in ((Notification, Notification.user_id), (Feedback, Feedback.user_id), (LeaveRecord, LeaveRecord.user_id)):
        db.execute(delete(model).where(col == uid))
    db.execute(delete(UserPresence).where(UserPresence.user_id == uid))
    db.execute(delete(UserProfile).where(UserProfile.user_id == uid))
    db.execute(update(LeaveRecord).where(LeaveRecord.backup_user_id == uid).values(backup_user_id=None))
    db.execute(update(Task).where(Task.assignee_id == uid).values(assignee_id=None))
    for model in (Task, Dashboard, Dataset, Alert, Automation, SavedQuery, Invite):
        db.execute(update(model).where(model.created_by == uid).values(created_by=None))
    db.execute(update(Invite).where(Invite.used_by == uid).values(used_by=None))
    db.execute(delete(session_table).where(session_table.c.userId == uid))
    db.execute(delete(account_table).where(account_table.c.userId == uid))
    db.execute(delete(verification_table).where(verification_table.c.identifier == user.email))
    db.execute(delete(user_table).where(user_table.c.id == uid))
    db.commit()
    log.warning("[erasure] account %s deleted", hashlib.sha256(uid.encode()).hexdigest()[:16])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
