from datetime import date, datetime, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

# SQLite hands back naive datetimes; they are stored in UTC, so say so in the JSON ("...Z").
UtcDatetime = Annotated[datetime, AfterValidator(lambda d: d if d.tzinfo else d.replace(tzinfo=timezone.utc))]


class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    job_role: str | None = None
    email_verified: bool = False
    workspace: WorkspaceOut


class ColumnOut(BaseModel):
    name: str
    type: str
    empty_ratio: float
    examples: list[str]


class DatasetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    source_filename: str
    source_kind: str
    sheet: str | None
    row_count: int
    columns: list[ColumnOut]
    file_size: int = 0
    created_at: UtcDatetime
    updated_at: UtcDatetime | None = None


HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class ProfileIn(BaseModel):
    job_role: str = Field(min_length=2, max_length=280)
    phone: str | None = Field(default=None, max_length=32, pattern=r"^\+?[0-9 ()-]{6,32}$")
    timezone: str | None = Field(default=None, max_length=64)
    work_start: str | None = Field(default=None, pattern=HHMM)
    work_end: str | None = Field(default=None, pattern=HHMM)
    signature: str | None = Field(default=None, max_length=400_000, pattern=r"^data:image/(png|svg\+xml);base64,")
    dashboard_visibility: Literal["team", "anyone"] = "team"
    notify_email: bool = True
    notify_weekly: bool = True

    @field_validator("job_role")
    @classmethod
    def _strip_role(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Describe your role in a few words")
        return v

    @field_validator("phone", "timezone", "signature", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    job_role: str = ""  # empty until the first save
    phone: str | None = None
    timezone: str | None = None
    work_start: str | None = None
    work_end: str | None = None
    signature: str | None = None
    dashboard_visibility: str = "team"
    notify_email: bool = True
    notify_weekly: bool = True
    updated_at: UtcDatetime | None = None


class MemberOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    job_role: str | None
    joined_at: UtcDatetime
    status: str = "available"
    status_message: str | None = None
    leave_type: str | None = None
    leave_until: date | None = None
    backup_name: str | None = None


class FeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


class ActivityOut(BaseModel):
    id: str
    kind: Literal["dataset", "member", "profile", "leave", "task"]
    title: str
    detail: str
    actor: str
    at: UtcDatetime


PresenceStatus = Literal["available", "away", "busy", "dnd", "appear_offline", "out_of_office", "on_leave"]
LeaveType = Literal["sick", "casual", "paid"]


class LeaveIn(BaseModel):
    leave_type: LeaveType
    start_date: date
    end_date: date
    backup_user_id: str | None = None
    backup_name: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _check(self):
        if self.end_date < self.start_date:
            raise ValueError("The leave can't end before it starts")
        if self.backup_name is not None:
            self.backup_name = self.backup_name.strip() or None
        if not self.backup_user_id and not self.backup_name:
            raise ValueError("Pick who covers for you while you're away")
        return self


class PresenceIn(BaseModel):
    status: PresenceStatus
    message: str | None = Field(default=None, max_length=280)
    leave: LeaveIn | None = None

    @model_validator(mode="after")
    def _check(self):
        # on_leave without `leave` keeps the current leave (checked in the router).
        if self.status != "on_leave":
            self.leave = None
        return self


class LeaveOut(BaseModel):
    id: str
    leave_type: str
    start_date: date
    end_date: date
    backup_user_id: str | None
    backup_name: str | None  # resolved display name of the backup
    note: str | None
    status: str
    created_at: UtcDatetime


class PresenceOut(BaseModel):
    status: str = "available"
    message: str | None = None
    leave: LeaveOut | None = None
    updated_at: UtcDatetime | None = None


ColumnType = Literal["number", "date", "category", "text"]


class DatasetPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    # column name -> new type; only the columns being changed
    column_types: dict[str, ColumnType] | None = None


class RowFilter(BaseModel):
    field: str
    op: str
    value: object | None = None


class RowsOut(BaseModel):
    rows: list[dict]
    total: int
    page: int
    size: int


# ---------- charts & dashboards ----------

Agg = Literal["sum", "count", "avg", "min", "max", "count_distinct"]
ChartType = Literal["line", "bar", "pie", "kpi", "table", "area", "hbar", "combo", "scatter", "funnel", "treemap", "gauge"]
HEX = r"^#[0-9a-fA-F]{6}$"


class SpecMetric(BaseModel):
    field: str = Field(min_length=1, max_length=255)
    agg: Agg


class SqlParam(BaseModel):
    """A value for one {{name}} placeholder in SQL Lab SQL (app/sql_params.py)."""

    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,39}$")
    type: Literal["text", "number", "date"] = "text"
    value: str = Field(default="", max_length=1_000)


class SpecFilter(BaseModel):
    field: str = Field(min_length=1, max_length=255)
    op: Literal["eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "contains", "empty", "not_empty"]
    value: object | None = None


class ChartSpecIn(BaseModel):
    """Mirrors frontend/src/features/charts/chart-spec.ts."""

    model_config = ConfigDict(extra="forbid")
    dataset: str = Field(min_length=1, max_length=32)
    metrics: list[SpecMetric] = Field(min_length=1, max_length=5)
    groupBy: str | None = Field(default=None, max_length=255)
    dateBucket: Literal["day", "week", "month", "quarter", "year"] | None = None
    filters: list[SpecFilter] = Field(default_factory=list, max_length=20)
    chartType: ChartType
    title: str = Field(min_length=1, max_length=200)
    sort: Literal["label", "value_desc", "value_asc"] | None = None
    limit: int | None = Field(default=None, ge=1, le=1000)
    color: str | None = Field(default=None, pattern=HEX)
    insight: str | None = Field(default=None, max_length=300)
    # Gauge charts: the goal the value is measured against.
    target: float | None = None
    # Charts saved from SQL Lab: the query is the definition; metrics/groupBy name its result columns.
    sql: str | None = Field(default=None, max_length=10_000)
    # Values for the query's {{name}} placeholders, fixed when the chart was saved.
    params: list[SqlParam] | None = Field(default=None, max_length=20)


class ChartIn(BaseModel):
    spec: ChartSpecIn
    kind: Literal["card", "kpi"] = "card"
    note: str | None = Field(default=None, max_length=500)


class ChartPatch(BaseModel):
    spec: ChartSpecIn | None = None
    kind: Literal["card", "kpi"] | None = None
    note: str | None = Field(default=None, max_length=500)


class ChartOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    dataset_id: str | None
    spec: dict
    kind: str
    note: str | None
    position: int


class KpiLayoutItem(BaseModel):
    i: str
    x: int = Field(ge=0, le=100)
    y: int = Field(ge=0, le=1000)
    w: int = Field(ge=1, le=12)
    h: int = Field(ge=1, le=12)


class DashboardIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)


class DashboardPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    date_fields: dict[str, str] | None = None
    filter_columns: list[str] | None = Field(default=None, max_length=6)
    kpi_layout: list[KpiLayoutItem] | None = Field(default=None, max_length=24)
    canvas_layout: list[KpiLayoutItem] | None = Field(default=None, max_length=60)


class DatasetRef(BaseModel):
    id: str
    name: str
    columns: list[ColumnOut]


class DashboardOut(BaseModel):
    id: str
    name: str
    description: str | None
    date_fields: dict
    filter_columns: list
    kpi_layout: list
    canvas_layout: list = Field(default_factory=list)
    share_token: str | None
    created_at: UtcDatetime
    updated_at: UtcDatetime
    charts: list[ChartOut]
    datasets: list[DatasetRef]
    can_edit: bool


class DashboardSummary(BaseModel):
    id: str
    name: str
    description: str | None
    chart_count: int
    kpi_count: int
    dataset_names: list[str]
    shared: bool
    updated_at: UtcDatetime


class InsightOut(BaseModel):
    headline: str
    trend: Literal["up", "down", "flat"]
    note: str
    value: float | None = None
    previous: float | None = None
    change: float | None = None


class ChartViewOut(BaseModel):
    id: str
    rows: list[dict] = Field(default_factory=list)
    insight: InsightOut | None = None
    error: str | None = None


class PeriodOut(BaseModel):
    date_from: date
    date_to: date
    prev_from: date
    prev_to: date


class DashboardViewOut(BaseModel):
    charts: list[ChartViewOut]
    period: PeriodOut | None


class PreviewIn(BaseModel):
    spec: ChartSpecIn
    date_from: date | None = None
    date_to: date | None = None
    date_field: str | None = None


class PreviewOut(BaseModel):
    rows: list[dict]
    insight: InsightOut


class OrderIn(BaseModel):
    chart_ids: list[str] = Field(max_length=200)


class ShareOut(BaseModel):
    share_token: str | None
