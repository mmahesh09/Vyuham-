"""App-owned tables.

Users, sessions and sign-in accounts live in Better Auth's tables ("user", "session",
"account", "verification"). Better Auth (in the Next.js app) writes them; this app only
reads them, so they have no ORM models here — see app/security.py.
"""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app import auth_tables  # noqa: F401  (Better Auth tables referenced below)
from app.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    members: Mapped[list["WorkspaceMember"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class WorkspaceMember(Base):
    """Links a Better Auth user to a workspace. v1: one workspace per user (unique user_id)."""

    __tablename__ = "workspace_members"

    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("user.id", ondelete="CASCADE"), primary_key=True, unique=True
    )
    role: Mapped[str] = mapped_column(String(16), default="owner")  # owner | editor | viewer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    workspace: Mapped[Workspace] = relationship(back_populates="members")


class Dataset(Base):
    """An uploaded table. Data lives in Parquet at <data_dir>/<workspace_id>/<id>.parquet."""

    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(200))
    source_filename: Mapped[str] = mapped_column(String(255))
    source_kind: Mapped[str] = mapped_column(String(8))  # csv | xlsx
    sheet: Mapped[str | None] = mapped_column(String(255))
    row_count: Mapped[int] = mapped_column(Integer)
    # [{name, type, empty_ratio, examples}] in file order
    columns: Mapped[list[dict]] = mapped_column(JSON)
    file_size: Mapped[int] = mapped_column(Integer)  # Parquet bytes
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class UserProfile(Base):
    """Profile details shown on /profile. One row per Better Auth user, created on first save."""

    __tablename__ = "user_profiles"

    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    job_role: Mapped[str] = mapped_column(String(280))  # what the person does; required on save
    phone: Mapped[str | None] = mapped_column(String(32))
    timezone: Mapped[str | None] = mapped_column(String(64))
    work_start: Mapped[str | None] = mapped_column(String(5))  # "HH:MM"
    work_end: Mapped[str | None] = mapped_column(String(5))
    signature: Mapped[str | None] = mapped_column(Text)  # PNG data URL
    # Who can open this person's dashboards: "team" (workspace members) or "anyone" (with the link)
    dashboard_visibility: Mapped[str] = mapped_column(String(16), default="team")
    notify_email: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_weekly: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("user.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    rating: Mapped[int] = mapped_column(Integer)  # 1..5
    comment: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class UserPresence(Base):
    """Teams-style status. One row per user; absent row means "available"."""

    __tablename__ = "user_presence"

    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    # available | away | busy | dnd | appear_offline | out_of_office | on_leave
    status: Mapped[str] = mapped_column(String(16), default="available")
    message: Mapped[str | None] = mapped_column(String(280))
    leave_id: Mapped[str | None] = mapped_column(ForeignKey("leave_records.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    leave: Mapped["LeaveRecord | None"] = relationship()


class LeaveRecord(Base):
    """Every leave a person takes, kept as history. The backup covers their work meanwhile."""

    __tablename__ = "leave_records"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("user.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    leave_type: Mapped[str] = mapped_column(String(16))  # sick | casual | paid
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    backup_user_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    backup_name: Mapped[str | None] = mapped_column(String(200))  # someone outside the workspace
    note: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | ended | cancelled
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Dashboard(Base):
    """An ordered feed of charts. Filters apply to every chart whose dataset has the column."""

    __tablename__ = "dashboards"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(500))
    # {dataset_id: date column} used by the date-range filter
    date_fields: Mapped[dict] = mapped_column(JSON, default=dict)
    # column names offered as dropdown filters
    filter_columns: Mapped[list] = mapped_column(JSON, default=list)
    # react-grid-layout positions of the KPI tiles: [{i, x, y, w, h}]
    kpi_layout: Mapped[list] = mapped_column(JSON, default=list)
    # Dashboard Lab: free-form grid positions of every chart [{i, x, y, w, h}]
    canvas_layout: Mapped[list | None] = mapped_column(JSON, default=list)
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    charts: Mapped[list["Chart"]] = relationship(
        back_populates="dashboard", cascade="all, delete-orphan", order_by="Chart.position"
    )


class Chart(Base):
    """One chart on a dashboard: a chart spec (see app/query.py) plus how it's shown."""

    __tablename__ = "charts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    dashboard_id: Mapped[str] = mapped_column(ForeignKey("dashboards.id", ondelete="CASCADE"), index=True)
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("datasets.id", ondelete="SET NULL"))
    spec: Mapped[dict] = mapped_column(JSON)
    kind: Mapped[str] = mapped_column(String(8), default="card")  # card | kpi
    note: Mapped[str | None] = mapped_column(String(500))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    dashboard: Mapped[Dashboard] = relationship(back_populates="charts")


class Invite(Base):
    """A link that adds someone to a workspace with a role. Single use, expires after 7 days."""

    __tablename__ = "invites"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # editor | viewer | owner
    email: Mapped[str | None] = mapped_column(String(320))
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))


class Task(Base):
    """A data task: "Update the March sales file", assigned to someone, linked to a dataset or dashboard."""

    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(2000))
    status: Mapped[str] = mapped_column(String(16), default="todo")  # todo | in_progress | review | done
    priority: Mapped[str] = mapped_column(String(8), default="medium")  # low | medium | high | urgent
    assignee_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"), index=True)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("datasets.id", ondelete="SET NULL"))
    dashboard_id: Mapped[str | None] = mapped_column(ForeignKey("dashboards.id", ondelete="SET NULL"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SavedQuery(Base):
    """A SQL Lab query someone saved to reuse."""

    __tablename__ = "saved_queries"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    sql: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Alert(Base):
    """Watch one number (e.g. total Amount over the last 7 days) and notify when a condition is met."""

    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"))
    # {"field": "Amount", "agg": "sum"} and optional chart-style filters
    metric: Mapped[dict] = mapped_column(JSON)
    filters: Mapped[list] = mapped_column(JSON, default=list)
    date_field: Mapped[str | None] = mapped_column(String(255))
    window_days: Mapped[int] = mapped_column(Integer, default=7)  # 0 = all time
    # above | below | change_up | change_down (change = % vs the previous window)
    condition: Mapped[str] = mapped_column(String(16))
    threshold: Mapped[float] = mapped_column(Float)
    schedule: Mapped[str] = mapped_column(String(8), default="daily")  # hourly | daily | weekly
    channels: Mapped[dict] = mapped_column(JSON, default=dict)  # {inapp: bool, emails: [..], webhook: url|None}
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    state: Mapped[str] = mapped_column(String(10), default="ok")  # ok | triggered | error
    last_value: Mapped[float | None] = mapped_column(Float)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Automation(Base):
    """A scheduled job, e.g. send a dashboard's headlines every Monday at 9:00."""

    __tablename__ = "automations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(24), default="dashboard_digest")
    dashboard_id: Mapped[str | None] = mapped_column(ForeignKey("dashboards.id", ondelete="CASCADE"))
    schedule: Mapped[str] = mapped_column(String(8), default="weekly")  # daily | weekly | monthly
    hour: Mapped[int] = mapped_column(Integer, default=9)  # 0-23, in `timezone`
    weekday: Mapped[int] = mapped_column(Integer, default=0)  # 0 = Monday, for weekly
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    period_days: Mapped[int] = mapped_column(Integer, default=7)  # data window the digest covers
    channels: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AlertEvent(Base):
    """History: each time an alert fired or an automation ran."""

    __tablename__ = "alert_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    alert_id: Mapped[str | None] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"))
    automation_id: Mapped[str | None] = mapped_column(ForeignKey("automations.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    value: Mapped[float | None] = mapped_column(Float)
    delivery: Mapped[dict] = mapped_column(JSON, default=dict)  # {inapp: n, email: n, webhook: "ok"|error}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Notification(Base):
    """An in-app notification for one person (the bell)."""

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("user.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(16), default="alert")  # alert | digest
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
