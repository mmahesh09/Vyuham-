"""Alerts, automations, their history, and in-app notifications (the bell)."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.alerts import check_alert, run_automation
from app.db import get_db
from app.models import Alert, AlertEvent, Automation, Dashboard, Dataset, Notification, WorkspaceMember
from app.notify import WebhookError, check_webhook_url
from app.query import QueryError
from app.routers.datasets import CAN_UPLOAD
from app.schemas import SpecFilter, SpecMetric, UtcDatetime
from app.security import AuthUser, current_membership, current_user, require_verified_email

router = APIRouter(tags=["alerts"])
EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def _editor(member: WorkspaceMember) -> None:
    if member.role not in CAN_UPLOAD:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Viewers can't change alerts or automations.")


class Channels(BaseModel):
    inapp: bool = True
    emails: list[str] = Field(default_factory=list, max_length=20)
    webhook: str | None = Field(default=None, max_length=1000)

    @field_validator("emails")
    @classmethod
    def _emails(cls, v: list[str]) -> list[str]:
        import re

        out = [e.strip() for e in v if e.strip()]
        bad = [e for e in out if not re.match(EMAIL, e)]
        if bad:
            raise ValueError(f"Not an email address: {bad[0]}")
        return out


def _check_channels(c: Channels, user: AuthUser | None = None) -> dict:
    if (c.emails or c.webhook) and user is not None:
        require_verified_email(user)
    if c.webhook:
        try:
            check_webhook_url(c.webhook)
        except WebhookError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    if not (c.inapp or c.emails or c.webhook):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick at least one way to be notified.")
    return c.model_dump()


# ---------- alerts ----------


class AlertIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    dataset_id: str
    metric: SpecMetric
    filters: list[SpecFilter] = Field(default_factory=list, max_length=10)
    date_field: str | None = None
    window_days: int = Field(default=7, ge=0, le=366)
    condition: Literal["above", "below", "change_up", "change_down"]
    threshold: float
    schedule: Literal["hourly", "daily", "weekly"] = "daily"
    channels: Channels = Field(default_factory=Channels)
    enabled: bool = True


class AlertOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    dataset_id: str | None
    metric: dict
    filters: list
    date_field: str | None
    window_days: int
    condition: str
    threshold: float
    schedule: str
    channels: dict
    enabled: bool
    state: str
    last_value: float | None
    last_checked_at: UtcDatetime | None
    last_triggered_at: UtcDatetime | None
    last_error: str | None
    created_at: UtcDatetime


def _validate_alert(db: Session, member: WorkspaceMember, body: AlertIn, user: AuthUser | None = None) -> dict:
    ds = db.get(Dataset, body.dataset_id)
    if ds is None or ds.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dataset not found")
    cols = {c["name"]: c["type"] for c in ds.columns}
    m = body.metric
    if m.field != "*" and m.field not in cols:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f'"{m.field}" isn\'t a column in {ds.name}')
    if m.agg in ("sum", "avg") and cols.get(m.field) != "number":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f'"{m.field}" isn\'t a number column')
    if body.date_field and cols.get(body.date_field) != "date":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f'"{body.date_field}" isn\'t a date column')
    if body.condition.startswith("change") and not (body.date_field and body.window_days):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A change alert needs a date column and a time window to compare.")
    data = body.model_dump()
    data["channels"] = _check_channels(body.channels, user)
    data["metric"] = m.model_dump()
    data["filters"] = [f.model_dump() for f in body.filters]
    return data


def _alert(db: Session, member: WorkspaceMember, aid: str) -> Alert:
    a = db.get(Alert, aid)
    if a is None or a.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    return a


@router.get("/alerts", response_model=list[AlertOut])
def list_alerts(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return db.scalars(select(Alert).where(Alert.workspace_id == member.workspace_id).order_by(Alert.created_at.desc())).all()


@router.post("/alerts", response_model=AlertOut, status_code=status.HTTP_201_CREATED)
def create_alert(body: AlertIn, member: WorkspaceMember = Depends(current_membership), user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    _editor(member)
    a = Alert(workspace_id=member.workspace_id, created_by=member.user_id, **_validate_alert(db, member, body, user))
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@router.put("/alerts/{aid}", response_model=AlertOut)
def update_alert(aid: str, body: AlertIn, member: WorkspaceMember = Depends(current_membership), user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    _editor(member)
    a = _alert(db, member, aid)
    for k, v in _validate_alert(db, member, body, user).items():
        setattr(a, k, v)
    a.state, a.last_error = "ok", None  # a changed rule starts fresh
    db.commit()
    db.refresh(a)
    return a


@router.delete("/alerts/{aid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alert(aid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    db.delete(_alert(db, member, aid))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/alerts/{aid}/check", response_model=AlertOut)
def check_now(aid: str, test: bool = False, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Check the rule now. With ?test=true, send the message even if the rule isn't met."""
    _editor(member)
    a = _alert(db, member, aid)
    check_alert(db, a, force_notify=test)
    db.refresh(a)
    return a


# ---------- automations ----------


class AutomationIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["dashboard_digest"] = "dashboard_digest"
    dashboard_id: str
    schedule: Literal["daily", "weekly", "monthly"] = "weekly"
    hour: int = Field(default=9, ge=0, le=23)
    weekday: int = Field(default=0, ge=0, le=6)
    timezone: str = Field(default="UTC", max_length=64)
    period_days: int = Field(default=7, ge=1, le=366)
    channels: Channels = Field(default_factory=Channels)
    enabled: bool = True

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown time zone") from None
        return v


class AutomationOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    kind: str
    dashboard_id: str | None
    schedule: str
    hour: int
    weekday: int
    timezone: str
    period_days: int
    channels: dict
    enabled: bool
    last_run_at: UtcDatetime | None
    last_status: str | None
    created_at: UtcDatetime


def _automation(db: Session, member: WorkspaceMember, aid: str) -> Automation:
    a = db.get(Automation, aid)
    if a is None or a.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Automation not found")
    return a


def _validate_automation(db: Session, member: WorkspaceMember, body: AutomationIn, user: AuthUser | None = None) -> dict:
    d = db.get(Dashboard, body.dashboard_id)
    if d is None or d.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dashboard not found")
    data = body.model_dump()
    data["channels"] = _check_channels(body.channels, user)
    return data


@router.get("/automations", response_model=list[AutomationOut])
def list_automations(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return db.scalars(select(Automation).where(Automation.workspace_id == member.workspace_id).order_by(Automation.created_at.desc())).all()


@router.post("/automations", response_model=AutomationOut, status_code=status.HTTP_201_CREATED)
def create_automation(body: AutomationIn, member: WorkspaceMember = Depends(current_membership), user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    _editor(member)
    a = Automation(workspace_id=member.workspace_id, created_by=member.user_id, **_validate_automation(db, member, body, user))
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@router.put("/automations/{aid}", response_model=AutomationOut)
def update_automation(aid: str, body: AutomationIn, member: WorkspaceMember = Depends(current_membership), user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    _editor(member)
    a = _automation(db, member, aid)
    for k, v in _validate_automation(db, member, body, user).items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return a


@router.delete("/automations/{aid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_automation(aid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    db.delete(_automation(db, member, aid))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/automations/{aid}/run", response_model=AutomationOut)
def run_now(aid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    a = _automation(db, member, aid)
    try:
        run_automation(db, a)
    except QueryError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    db.refresh(a)
    return a


# ---------- history & notifications ----------


class EventOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    alert_id: str | None
    automation_id: str | None
    title: str
    body: str
    value: float | None
    delivery: dict
    created_at: UtcDatetime


class NotificationOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    title: str
    body: str
    link: str | None
    kind: str
    created_at: UtcDatetime
    read_at: UtcDatetime | None


@router.get("/alerts-history", response_model=list[EventOut])
def history(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return db.scalars(
        select(AlertEvent).where(AlertEvent.workspace_id == member.workspace_id).order_by(AlertEvent.created_at.desc()).limit(100)
    ).all()


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return db.scalars(
        select(Notification).where(Notification.user_id == member.user_id, Notification.workspace_id == member.workspace_id)
        .order_by(Notification.created_at.desc()).limit(50)
    ).all()


@router.get("/notifications/unread-count")
def unread_count(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    n = db.scalar(select(func.count()).where(Notification.user_id == member.user_id, Notification.read_at.is_(None)))
    return {"count": n}


@router.post("/notifications/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    db.execute(
        update(Notification).where(Notification.user_id == member.user_id, Notification.read_at.is_(None)).values(read_at=datetime.now(timezone.utc))
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
