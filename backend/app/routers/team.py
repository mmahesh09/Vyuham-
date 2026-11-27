"""Team: data tasks and the team calendar (invitations: routers/invitations.py; members: routers/organizations.py)."""

import logging
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.auth_tables import user_table
from app.db import get_db
from app.models import Dashboard, Dataset, LeaveRecord, Task, WorkspaceMember
from app.schemas import UtcDatetime
from app.permissions import WRITERS
from app.security import current_membership

router = APIRouter(tags=["team"])
log = logging.getLogger("app.team")

Status = Literal["todo", "in_progress", "review", "done"]
Priority = Literal["low", "medium", "high", "urgent"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- members (kept for older clients; the organization routes are the source of truth) ----------


class RoleIn(BaseModel):
    role: Literal["admin", "analyst", "viewer"]


@router.patch("/workspace/members/{user_id}")
def change_role(user_id: str, body: RoleIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    from app.routers.organizations import change_member_role

    target = change_member_role(db, member, user_id, body.role)
    return {"user_id": user_id, "role": target.role}


@router.delete("/workspace/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(user_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    from app.routers.organizations import remove_member as remove_org_member

    remove_org_member(db, member, user_id)
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
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "You can only assign tasks to people in this workspace.")
    for key, model in (("dataset_id", Dataset), ("dashboard_id", Dashboard)):
        if data.get(key):
            obj = db.get(model, data[key])
            if obj is None or obj.workspace_id != member.workspace_id:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown {key.split('_')[0]}")


def _can_edit(member: WorkspaceMember, task: Task | None, data: dict) -> None:
    if member.role in WRITERS:
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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The due date can't be before the start date")
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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown task in the new order")
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
