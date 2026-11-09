"""Team: invite links, member roles, data tasks and the team calendar."""

import logging
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.auth_tables import user_table
from app.db import get_db
from app.models import Dashboard, Dataset, Invite, LeaveRecord, Task, Workspace, WorkspaceMember
from app.schemas import UtcDatetime
from app.security import AuthUser, current_membership, current_user

router = APIRouter(tags=["team"])
log = logging.getLogger("app.team")

INVITE_DAYS = 7
Role = Literal["owner", "editor", "viewer"]
Status = Literal["todo", "in_progress", "review", "done"]
Priority = Literal["low", "medium", "high", "urgent"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _owner(member: WorkspaceMember) -> None:
    if member.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only workspace owners can manage the team.")


# ---------- invites ----------


class InviteIn(BaseModel):
    role: Role = "editor"
    email: str | None = Field(default=None, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InviteOut(BaseModel):
    token: str
    role: str
    email: str | None
    created_at: UtcDatetime
    expires_at: UtcDatetime


class InviteInfo(BaseModel):
    workspace_name: str
    role: str
    invited_by: str | None
    valid: bool
    reason: str | None = None


def _invite_problem(inv: Invite | None) -> str | None:
    if inv is None:
        return "This invite link doesn't exist. Ask for a new one."
    if inv.used_at:
        return "This invite has already been used."
    if _aware(inv.expires_at) < _now():
        return "This invite has expired. Ask for a new one."
    return None


@router.post("/workspace/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
def create_invite(body: InviteIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    inv = Invite(
        token=secrets.token_urlsafe(24), workspace_id=member.workspace_id, role=body.role, email=body.email,
        created_by=member.user_id, expires_at=_now() + timedelta(days=INVITE_DAYS),
    )
    db.add(inv)
    db.commit()
    if body.email:  # TODO: send through an email provider; printed until one is wired up (like password reset)
        log.warning("[invite] %s invited as %s: /invite/%s", body.email, body.role, inv.token)
    return inv


@router.get("/workspace/invites", response_model=list[InviteOut])
def list_invites(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    rows = db.scalars(
        select(Invite).where(Invite.workspace_id == member.workspace_id, Invite.used_at.is_(None)).order_by(Invite.created_at.desc())
    )
    return [i for i in rows if _aware(i.expires_at) > _now()]


@router.delete("/workspace/invites/{token}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(token: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    inv = db.get(Invite, token)
    if inv is None or inv.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    db.delete(inv)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/invites/{token}", response_model=InviteInfo)
def invite_info(token: str, db: Session = Depends(get_db)):
    """Public: what the link is for, shown before signing up or in."""
    inv = db.get(Invite, token)
    problem = _invite_problem(inv)
    if inv is None:
        return InviteInfo(workspace_name="", role="", invited_by=None, valid=False, reason=problem)
    ws = db.get(Workspace, inv.workspace_id)
    inviter = db.execute(select(user_table.c.name).where(user_table.c.id == inv.created_by)).scalar() if inv.created_by else None
    return InviteInfo(workspace_name=ws.name if ws else "", role=inv.role, invited_by=inviter, valid=problem is None, reason=problem)


@router.post("/invites/{token}/accept")
def accept_invite(token: str, user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    inv = db.get(Invite, token)
    problem = _invite_problem(inv)
    if problem:
        raise HTTPException(status.HTTP_410_GONE, problem)
    current = db.scalar(select(WorkspaceMember).where(WorkspaceMember.user_id == user.id))
    if current and current.workspace_id == inv.workspace_id:
        return {"workspace_id": inv.workspace_id}
    if current:
        # v1: one workspace per person. Only an untouched, solo workspace can be given up.
        ws_id = current.workspace_id
        others = db.scalar(select(func.count()).where(WorkspaceMember.workspace_id == ws_id, WorkspaceMember.user_id != user.id))
        has_data = db.scalar(select(exists().where(Dataset.workspace_id == ws_id))) or db.scalar(
            select(exists().where(Dashboard.workspace_id == ws_id))
        )
        if others or has_data:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "You already have a workspace with data or teammates. For now an account can belong to one workspace; "
                "sign up with another email to join this one.",
            )
        db.delete(current)
        db.flush()
        old = db.get(Workspace, ws_id)
        if old:
            db.delete(old)
    db.add(WorkspaceMember(user_id=user.id, workspace_id=inv.workspace_id, role=inv.role))
    inv.used_at, inv.used_by = _now(), user.id
    db.commit()
    return {"workspace_id": inv.workspace_id}


# ---------- members ----------


class RoleIn(BaseModel):
    role: Role


def _target(db: Session, member: WorkspaceMember, user_id: str) -> WorkspaceMember:
    m = db.scalar(select(WorkspaceMember).where(WorkspaceMember.user_id == user_id, WorkspaceMember.workspace_id == member.workspace_id))
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return m


def _owners(db: Session, workspace_id: str) -> int:
    return db.scalar(select(func.count()).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.role == "owner"))


@router.patch("/workspace/members/{user_id}")
def change_role(user_id: str, body: RoleIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    m = _target(db, member, user_id)
    if m.role == "owner" and body.role != "owner" and _owners(db, member.workspace_id) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "A workspace needs at least one owner. Make someone else an owner first.")
    m.role = body.role
    db.commit()
    return {"user_id": user_id, "role": m.role}


@router.delete("/workspace/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(user_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _owner(member)
    m = _target(db, member, user_id)
    if m.role == "owner" and _owners(db, member.workspace_id) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can't remove the last owner.")
    # Their tasks stay, unassigned, so nothing falls through the cracks silently.
    for t in db.scalars(select(Task).where(Task.workspace_id == member.workspace_id, Task.assignee_id == user_id)):
        t.assignee_id = None
    db.delete(m)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- tasks ----------


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    status: Status = "todo"
    priority: Priority = "medium"
    assignee_id: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    dataset_id: str | None = None
    dashboard_id: str | None = None

    @model_validator(mode="after")
    def _dates(self):
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("The due date can't be before the start date")
        return self


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    status: Status | None = None
    priority: Priority | None = None
    assignee_id: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    dataset_id: str | None = None
    dashboard_id: str | None = None


class TaskOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    title: str
    description: str | None
    status: str
    priority: str
    assignee_id: str | None
    created_by: str | None
    start_date: date | None
    due_date: date | None
    dataset_id: str | None
    dashboard_id: str | None
    position: int
    created_at: UtcDatetime
    updated_at: UtcDatetime
    completed_at: UtcDatetime | None


class OrderIn(BaseModel):
    status: Status
    task_ids: list[str] = Field(max_length=500)


def _task(db: Session, member: WorkspaceMember, task_id: str) -> Task:
    t = db.get(Task, task_id)
    if t is None or t.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return t


def _check_links(db: Session, member: WorkspaceMember, data: dict) -> None:
    if data.get("assignee_id"):
        ok = db.scalar(select(exists().where(WorkspaceMember.user_id == data["assignee_id"], WorkspaceMember.workspace_id == member.workspace_id)))
        if not ok:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "You can only assign tasks to people in this workspace.")
    for key, model in (("dataset_id", Dataset), ("dashboard_id", Dashboard)):
        if data.get(key):
            obj = db.get(model, data[key])
            if obj is None or obj.workspace_id != member.workspace_id:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown {key.split('_')[0]}")


def _can_edit(member: WorkspaceMember, task: Task | None, data: dict) -> None:
    if member.role in ("owner", "editor"):
        return
    # Viewers may only move their own tasks along the board.
    if task is not None and task.assignee_id == member.user_id and set(data) <= {"status"}:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Viewers can only update the status of tasks assigned to them.")


def _set_status(t: Task, new: str) -> None:
    if new == "done" and t.status != "done":
        t.completed_at = _now()
    elif new != "done":
        t.completed_at = None
    t.status = new


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    assignee: str | None = Query(None, description='"me", a user id, or "none"'),
    task_status: Status | None = Query(None, alias="status"),
    dataset_id: str | None = None,
    dashboard_id: str | None = None,
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    q = select(Task).where(Task.workspace_id == member.workspace_id)
    if assignee == "me":
        q = q.where(Task.assignee_id == member.user_id)
    elif assignee == "none":
        q = q.where(Task.assignee_id.is_(None))
    elif assignee:
        q = q.where(Task.assignee_id == assignee)
    if task_status:
        q = q.where(Task.status == task_status)
    if dataset_id:
        q = q.where(Task.dataset_id == dataset_id)
    if dashboard_id:
        q = q.where(Task.dashboard_id == dashboard_id)
    return db.scalars(q.order_by(Task.status, Task.position, Task.created_at)).all()


@router.post("/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _can_edit(member, None, {})
    data = body.model_dump()
    _check_links(db, member, data)
    top = db.scalar(select(func.min(Task.position)).where(Task.workspace_id == member.workspace_id, Task.status == body.status))
    t = Task(workspace_id=member.workspace_id, created_by=member.user_id, position=(top or 0) - 1, **{k: v for k, v in data.items() if k != "status"})
    _set_status(t, body.status)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: str, body: TaskPatch, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    t = _task(db, member, task_id)
    data = body.model_dump(exclude_unset=True)
    _can_edit(member, t, data)
    _check_links(db, member, data)
    start = data.get("start_date", t.start_date)
    due = data.get("due_date", t.due_date)
    if start and due and due < start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The due date can't be before the start date")
    for k, v in data.items():
        if k == "status":
            _set_status(t, v)
        elif k == "title":
            t.title = v.strip()
        else:
            setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    t = _task(db, member, task_id)
    _can_edit(member, None, {})
    db.delete(t)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/tasks/order", response_model=list[TaskOut])
def order_tasks(body: OrderIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """A kanban column after a drag: these tasks, in this order, with this status."""
    tasks = {t.id: t for t in db.scalars(select(Task).where(Task.workspace_id == member.workspace_id, Task.id.in_(body.task_ids)))}
    if set(body.task_ids) - set(tasks):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown task in the new order")
    for n, tid in enumerate(body.task_ids):
        t = tasks[tid]
        if t.status != body.status:
            _can_edit(member, t, {"status": body.status})
            _set_status(t, body.status)
        elif member.role == "viewer" and t.assignee_id != member.user_id:
            continue  # viewers can't reorder other people's tasks; leave them where they are
        t.position = n
    db.commit()
    return [tasks[i] for i in body.task_ids]


# ---------- team calendar ----------


class LeaveEvent(BaseModel):
    id: str
    user_id: str
    user_name: str
    leave_type: str
    start_date: date
    end_date: date
    backup_name: str | None
    status: str


@router.get("/workspace/leaves", response_model=list[LeaveEvent])
def workspace_leaves(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    names = dict(
        db.execute(
            select(user_table.c.id, user_table.c.name)
            .join(WorkspaceMember, WorkspaceMember.user_id == user_table.c.id)
            .where(WorkspaceMember.workspace_id == member.workspace_id)
        ).all()
    )
    rows = db.scalars(
        select(LeaveRecord).where(LeaveRecord.workspace_id == member.workspace_id, LeaveRecord.status != "cancelled").order_by(LeaveRecord.start_date)
    )
    return [
        LeaveEvent(
            id=lv.id, user_id=lv.user_id, user_name=names.get(lv.user_id, "Former member"), leave_type=lv.leave_type,
            start_date=lv.start_date, end_date=lv.end_date, backup_name=names.get(lv.backup_user_id or "") or lv.backup_name, status=lv.status,
        )
        for lv in rows
    ]
