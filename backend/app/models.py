"""App-owned tables.

Users, sessions and sign-in accounts live in Better Auth's tables ("user", "session",
"account", "verification"). Better Auth (in the Next.js app) writes them; this app only
reads them, so they have no ORM models here — see app/security.py.
"""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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


class Connection(Base):
    """A customer's external database (PostgreSQL or MySQL) that datasets sync from.

    The password is stored encrypted (app/crypto.py) and never returned by the API.
    """

    __tablename__ = "connections"
    __table_args__ = (UniqueConstraint("workspace_id", "name"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16))  # postgres | mysql
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer)
    database: Mapped[str] = mapped_column(String(255))
    username: Mapped[str] = mapped_column(String(255))
    secret_enc: Mapped[str] = mapped_column(Text)
    ssl_mode: Mapped[str] = mapped_column(String(16), default="require")  # require | verify-full | disable
    status: Mapped[str] = mapped_column(String(8), default="ok")  # ok | error
    last_error: Mapped[str | None] = mapped_column(String(500))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Dataset(Base):
    """A table in a workspace. Data lives in Parquet at <data_dir>/<workspace_id>/<id>.parquet.

    Uploaded datasets (csv | xlsx) get their file from the upload. Database-backed datasets
    (postgres | mysql) get it from a sync of `source_table` or `source_query` (app/sync.py).
    """

    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(200))
    source_filename: Mapped[str] = mapped_column(String(255))
    source_kind: Mapped[str] = mapped_column(String(8))  # csv | xlsx | postgres | mysql
    sheet: Mapped[str | None] = mapped_column(String(255))
    row_count: Mapped[int] = mapped_column(Integer)
    # [{name, type, empty_ratio, examples}] in file order
    columns: Mapped[list[dict]] = mapped_column(JSON)
    file_size: Mapped[int] = mapped_column(Integer)  # Parquet bytes
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    # Database-backed datasets only. A deleted connection leaves the dataset as a frozen snapshot.
    connection_id: Mapped[str | None] = mapped_column(ForeignKey("connections.id", ondelete="SET NULL"), index=True)
    source_table: Mapped[str | None] = mapped_column(String(255))  # "schema"."table" as picked
    source_query: Mapped[str | None] = mapped_column(Text)  # a single SELECT, instead of a table
    refresh: Mapped[str | None] = mapped_column(String(8))  # manual | hourly | daily
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # last successful sync
    sync_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # last attempt, successful or not
    sync_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_error: Mapped[str | None] = mapped_column(String(500))


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
    # Values for the query's {{name}} placeholders: [{"name", "type", "value"}] (app/sql_params.py).
    params: Mapped[list[dict]] = mapped_column(JSON, default=list, server_default="[]")
    # The visual builder's state when the query was made in Builder mode (frontend/src/features/sql-lab/builder),
    # so it reopens there. The SQL above is always what runs.
    builder_state: Mapped[dict | None] = mapped_column(JSON)
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
    """A scheduled job: a dashboard's headlines every Monday at 9:00 (kind "dashboard_digest"), or a saved
    SQL Lab query exported and emailed on a schedule (kind "saved_query")."""

    __tablename__ = "automations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(24), default="dashboard_digest")
    dashboard_id: Mapped[str | None] = mapped_column(ForeignKey("dashboards.id", ondelete="CASCADE"))
    saved_query_id: Mapped[str | None] = mapped_column(ForeignKey("saved_queries.id", ondelete="CASCADE"), index=True)
    # saved_query: {"format": "csv" | "xlsx", "only_if_rows": bool}
    options: Mapped[dict | None] = mapped_column(JSON, default=dict)
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


class JobRun(Base):
    """One scheduled run of a background job, claimed before it is queued.

    The unique (kind, target_id, scheduled_for) row is the lock: two scheduler passes, or a pass
    that runs while the previous run is still queued, can't send the same alert or digest twice.
    `scheduled_for` vs `started_at` is the schedule lag shown in monitoring.
    """

    __tablename__ = "job_runs"
    __table_args__ = (UniqueConstraint("kind", "target_id", "scheduled_for", name="uq_job_runs_slot"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(16))  # alert | automation
    target_id: Mapped[str] = mapped_column(String(32), index=True)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(10), default="queued")  # queued | running | retry | done | failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Report(Base):
    """A report definition: what to export (a dashboard, saved query or dataset) and in which format."""

    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(16))  # dashboard | saved_query | dataset
    source_id: Mapped[str] = mapped_column(String(32))
    format: Mapped[str] = mapped_column(String(8))  # pdf | csv | xlsx
    # {period_days, filters: {col: value}, orientation: portrait|landscape, page_size: A4|Letter}
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ReportRun(Base):
    """One generated file (or an attempt at one).

    It keeps its own copy of what to export, so a quick "Export" from a dashboard needs no saved
    Report, and editing or deleting a report doesn't change the history of files already made.
    """

    __tablename__ = "report_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    report_id: Mapped[str | None] = mapped_column(ForeignKey("reports.id", ondelete="SET NULL"), index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[str] = mapped_column(String(32))
    format: Mapped[str] = mapped_column(String(8))
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(10), default="queued")  # queued | running | retry | done | failed
    trigger: Mapped[str] = mapped_column(String(10), default="manual")  # manual | schedule
    automation_id: Mapped[str | None] = mapped_column(ForeignKey("automations.id", ondelete="SET NULL"))
    file_key: Mapped[str | None] = mapped_column(String(300))
    file_name: Mapped[str | None] = mapped_column(String(255))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    rows: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(String(500))
    requested_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --- Support: tickets, knowledge base, error groups, status page ---------------------------------


class KbArticle(Base):
    """A help-center article. Drafts are staff-only; published ones are public at /help/<slug>."""

    __tablename__ = "kb_articles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(String(300), default="")
    body: Mapped[str] = mapped_column(Text, default="")  # markdown
    tags: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(10), default="draft", index=True)  # draft | published
    source_ticket_id: Mapped[str | None] = mapped_column(String(32))
    views: Mapped[int] = mapped_column(Integer, default=0)
    helpful_yes: Mapped[int] = mapped_column(Integer, default=0)
    helpful_no: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ErrorGroup(Base):
    """One distinct error, as grouped by GlitchTip (one GlitchTip issue). Staff link it to a KB article."""

    __tablename__ = "error_groups"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    glitchtip_issue_id: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(String(300))
    culprit: Mapped[str | None] = mapped_column(String(300))
    level: Mapped[str] = mapped_column(String(16), default="error")
    url: Mapped[str | None] = mapped_column(String(500))  # the issue in GlitchTip
    status: Mapped[str] = mapped_column(String(10), default="new", index=True)  # new | known | fixed
    count: Mapped[int] = mapped_column(Integer, default=1)  # webhook deliveries (alerts) seen
    kb_article_id: Mapped[str | None] = mapped_column(ForeignKey("kb_articles.id", ondelete="SET NULL"))
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # Groundwork for error intelligence: which release and code module it comes from, and the latest trace.
    # `release` and `module` come from the GlitchTip webhook; `last_trace_id` is filled by a future job that
    # reads event details (where the trace_id tag lives) from GlitchTip's API.
    release: Mapped[str | None] = mapped_column(String(100))
    module: Mapped[str | None] = mapped_column(String(200))
    last_trace_id: Mapped[str | None] = mapped_column(String(32))


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"), index=True)
    subject: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(16), default="question")  # bug | question | billing | feature
    priority: Mapped[str] = mapped_column(String(8), default="normal")  # low | normal | high | urgent
    status: Mapped[str] = mapped_column(String(10), default="open", index=True)  # open | pending | resolved | closed
    error_event_id: Mapped[str | None] = mapped_column(String(64))  # Sentry/GlitchTip event id from the error screen
    error_group_id: Mapped[str | None] = mapped_column(ForeignKey("error_groups.id", ondelete="SET NULL"))
    kb_article_id: Mapped[str | None] = mapped_column(ForeignKey("kb_articles.id", ondelete="SET NULL"))
    page_url: Mapped[str | None] = mapped_column(String(500))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    messages: Mapped[list["TicketMessage"]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", order_by="TicketMessage.created_at"
    )


class TicketMessage(Base):
    __tablename__ = "ticket_messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    author_name: Mapped[str] = mapped_column(String(200), default="")
    is_staff: Mapped[bool] = mapped_column(Boolean, default=False)
    internal: Mapped[bool] = mapped_column(Boolean, default=False)  # staff-only note, never shown to the customer
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    ticket: Mapped[SupportTicket] = relationship(back_populates="messages")


class KbDeflection(Base):
    """Someone on the new-ticket form opened a suggested article instead of (or before) filing."""

    __tablename__ = "kb_deflections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    article_id: Mapped[str] = mapped_column(ForeignKey("kb_articles.id", ondelete="CASCADE"))
    user_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class StatusCheck(Base):
    """One health check of one component, written every minute; the status page's uptime history."""

    __tablename__ = "status_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    component: Mapped[str] = mapped_column(String(32))
    ok: Mapped[bool] = mapped_column(Boolean)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200))
    impact: Mapped[str] = mapped_column(String(12), default="minor")  # minor | major | maintenance
    status: Mapped[str] = mapped_column(String(12), default="investigating")  # investigating | identified | monitoring | resolved
    components: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    updates: Mapped[list["IncidentUpdate"]] = relationship(
        back_populates="incident", cascade="all, delete-orphan", order_by="IncidentUpdate.created_at.desc()"
    )


class IncidentUpdate(Base):
    __tablename__ = "incident_updates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    incident_id: Mapped[str] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(12))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    incident: Mapped[Incident] = relationship(back_populates="updates")
