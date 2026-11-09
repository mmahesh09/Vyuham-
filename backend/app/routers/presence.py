"""Teams-style presence: Available, Away, Busy, Do not disturb, Appear offline, Out of office, On leave."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth_tables import user_table
from app.db import get_db
from app.models import LeaveRecord, UserPresence, WorkspaceMember
from app.schemas import LeaveOut, PresenceIn, PresenceOut
from app.security import current_membership

router = APIRouter(tags=["presence"])


def _names(db: Session, ids: set[str]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.execute(select(user_table.c.id, user_table.c.name).where(user_table.c.id.in_(ids))).all())


def leave_out(leave: LeaveRecord, names: dict[str, str]) -> LeaveOut:
    return LeaveOut(
        id=leave.id, leave_type=leave.leave_type, start_date=leave.start_date, end_date=leave.end_date,
        backup_user_id=leave.backup_user_id,
        backup_name=names.get(leave.backup_user_id or "", leave.backup_name),
        note=leave.note, status=leave.status, created_at=leave.created_at,
    )


def refresh_presence(db: Session, presence: UserPresence | None) -> UserPresence | None:
    """A leave that has ended puts the person back to Available."""
    if presence and presence.status == "on_leave" and presence.leave and presence.leave.end_date < date.today():
        presence.leave.status = "ended"
        presence.status, presence.leave_id, presence.message = "available", None, None
        db.commit()
    return presence


def _presence_out(db: Session, presence: UserPresence | None) -> PresenceOut:
    if presence is None:
        return PresenceOut()
    leave = presence.leave if presence.status == "on_leave" else None
    names = _names(db, {leave.backup_user_id} if leave else set())
    return PresenceOut(
        status=presence.status, message=presence.message,
        leave=leave_out(leave, names) if leave else None, updated_at=presence.updated_at,
    )


@router.get("/me/presence", response_model=PresenceOut)
def get_presence(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _presence_out(db, refresh_presence(db, db.get(UserPresence, member.user_id)))


@router.put("/me/presence", response_model=PresenceOut)
def set_presence(body: PresenceIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    presence = db.get(UserPresence, member.user_id) or UserPresence(user_id=member.user_id)
    previous = presence.leave if presence.status == "on_leave" else None

    if body.status == "on_leave" and body.leave is None:
        if previous is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add the leave type, dates and your backup")
    elif body.leave:
        backup = body.leave.backup_user_id
        if backup:
            if backup == member.user_id:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "You can't be your own backup")
            same_ws = db.scalar(
                select(WorkspaceMember).where(
                    WorkspaceMember.user_id == backup, WorkspaceMember.workspace_id == member.workspace_id
                )
            )
            if same_ws is None:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Your backup must be in this workspace")
        if previous:  # replacing an active leave: keep the old one in history
            previous.status = "cancelled" if previous.start_date > date.today() else "ended"
        leave = LeaveRecord(user_id=member.user_id, workspace_id=member.workspace_id, **body.leave.model_dump())
        if backup:
            leave.backup_name = None
        db.add(leave)
        db.flush()
        presence.leave_id = leave.id
    elif previous:  # leaving "on leave": close it out, keep it in history
        previous.status = "cancelled" if previous.start_date > date.today() else "ended"
        presence.leave_id = None

    presence.status = body.status
    presence.message = (body.message or "").strip() or None
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return _presence_out(db, presence)


@router.get("/me/leaves", response_model=list[LeaveOut])
def my_leaves(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    refresh_presence(db, db.get(UserPresence, member.user_id))
    leaves = db.scalars(
        select(LeaveRecord).where(LeaveRecord.user_id == member.user_id).order_by(LeaveRecord.start_date.desc())
    ).all()
    names = _names(db, {l.backup_user_id for l in leaves})
    return [leave_out(l, names) for l in leaves]
