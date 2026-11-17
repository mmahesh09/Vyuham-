"""SQL Lab: read-only SQL over the workspace's datasets, plus saved queries (owners and editors)."""

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Automation, Dataset, SavedQuery, WorkspaceMember
from app.query import MAX_ROWS, QueryError, connect, explain_sql, run_sql, table_names
from app.routers.datasets import CAN_UPLOAD
from app.schemas import ColumnOut, SqlParam, UtcDatetime
from app.security import AuthUser, current_membership, current_user
from app.sql_params import bind

router = APIRouter(prefix="/sql", tags=["sql"])


def _editor(member: WorkspaceMember) -> None:
    if member.role not in CAN_UPLOAD:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "SQL Lab is for owners and editors.")


def _datasets(db: Session, member: WorkspaceMember) -> list[Dataset]:
    return list(db.scalars(select(Dataset).where(Dataset.workspace_id == member.workspace_id).order_by(Dataset.created_at)))


class TableOut(BaseModel):
    table: str
    dataset_id: str
    dataset_name: str
    row_count: int
    columns: list[ColumnOut]


class RunIn(BaseModel):
    sql: str = Field(min_length=1, max_length=10_000)
    params: list[SqlParam] = Field(default_factory=list, max_length=20)


class RunOut(BaseModel):
    columns: list[str]
    rows: list[dict]
    row_count: int
    truncated: bool
    elapsed_ms: int


class ExplainOut(BaseModel):
    plan: str


class JoinHintOut(BaseModel):
    left_table: str
    left_column: str
    right_table: str
    right_column: str
    overlap: float
    normalized: bool
    cardinality: str
    sql: str


class SavedIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sql: str = Field(min_length=1, max_length=10_000)
    params: list[SqlParam] = Field(default_factory=list, max_length=20)
    # Builder mode's state (see features/sql-lab/builder); the SQL is what runs.
    builder_state: dict[str, Any] | None = None

    @field_validator("builder_state")
    @classmethod
    def _small(cls, v: dict | None) -> dict | None:
        import json

        if v is not None and len(json.dumps(v)) > 20_000:
            raise ValueError("The builder state is too large.")
        return v


class SavedOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    sql: str
    params: list[SqlParam]
    builder_state: dict[str, Any] | None = None
    # "Daily at 09:00 (UTC)" when the query is scheduled; None otherwise.
    schedule: str | None = None
    created_at: UtcDatetime
    updated_at: UtcDatetime


WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class ScheduleIn(BaseModel):
    schedule: Literal["daily", "weekly", "monthly"] = "daily"
    hour: int = Field(default=9, ge=0, le=23)
    weekday: int = Field(default=0, ge=0, le=6)
    timezone: str = Field(default="UTC", max_length=64)
    format: Literal["csv", "xlsx"] = "csv"
    only_if_rows: bool = False
    inapp: bool = True
    emails: list[str] = Field(default_factory=list, max_length=20)
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


class ScheduleOut(BaseModel):
    id: str
    schedule: str
    hour: int
    weekday: int
    timezone: str
    format: str
    only_if_rows: bool
    inapp: bool
    emails: list[str]
    enabled: bool
    label: str
    next_run_at: UtcDatetime | None
    last_run_at: UtcDatetime | None
    last_status: str | None


def schedule_label(a: Automation) -> str:
    at = f"{a.hour:02d}:00"
    when = {"daily": f"Daily at {at}", "weekly": f"{WEEKDAYS[a.weekday]}s at {at}", "monthly": f"Monthly, 1st at {at}"}[a.schedule]
    return f"{when} ({a.timezone})" + ("" if a.enabled else " · paused")


def next_run(a: Automation, now: datetime) -> datetime | None:
    """The first scheduled time after `now` (the scheduler picks it up within a minute)."""
    from app.alerts import last_occurrence

    if not a.enabled:
        return None
    current = last_occurrence(a, now)
    probe = now
    for _ in range(24 * 32):  # step an hour at a time, up to a month ahead
        probe += timedelta(hours=1)
        occ = last_occurrence(a, probe)
        if occ > current:
            return occ
    return None


def _schedule_out(a: Automation) -> ScheduleOut:
    opts, ch = a.options or {}, a.channels or {}
    return ScheduleOut(
        id=a.id, schedule=a.schedule, hour=a.hour, weekday=a.weekday, timezone=a.timezone,
        format=opts.get("format", "csv"), only_if_rows=bool(opts.get("only_if_rows")),
        inapp=bool(ch.get("inapp", True)), emails=list(ch.get("emails") or []), enabled=a.enabled,
        label=schedule_label(a), next_run_at=next_run(a, datetime.now(timezone.utc)),
        last_run_at=a.last_run_at, last_status=a.last_status,
    )


@router.get("/schema", response_model=list[TableOut])
def schema(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    datasets = _datasets(db, member)
    names = table_names(datasets)
    return [TableOut(table=names[d.id], dataset_id=d.id, dataset_name=d.name, row_count=d.row_count, columns=d.columns) for d in datasets]


@router.get("/schema/joins", response_model=list[JoinHintOut])
def schema_joins(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Columns in different datasets that look like the same thing, with how many values overlap."""
    from app.joins import find_joins

    _editor(member)
    return [h.as_dict() for h in find_joins(member.workspace_id, _datasets(db, member))]


@router.post("/run", response_model=RunOut)
def run(body: RunIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    con = connect(member.workspace_id, _datasets(db, member))
    started = time.perf_counter()
    try:
        rows = run_sql(con, *bind(body.sql, body.params))
    except QueryError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    finally:
        con.close()
    columns = list(rows[0].keys()) if rows else []
    return RunOut(columns=columns, rows=rows, row_count=len(rows), truncated=len(rows) >= MAX_ROWS,
                  elapsed_ms=int((time.perf_counter() - started) * 1000))


@router.post("/explain", response_model=ExplainOut)
def explain(body: RunIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """DuckDB's query plan, without running the query."""
    _editor(member)
    con = connect(member.workspace_id, _datasets(db, member))
    try:
        return ExplainOut(plan=explain_sql(con, *bind(body.sql, body.params)))
    except QueryError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    finally:
        con.close()


def _schedules(db: Session, workspace_id: str) -> dict[str, Automation]:
    rows = db.scalars(select(Automation).where(Automation.workspace_id == workspace_id, Automation.kind == "saved_query")).all()
    return {a.saved_query_id: a for a in rows if a.saved_query_id}


def _saved_out(q: SavedQuery, schedule: Automation | None) -> SavedOut:
    return SavedOut.model_validate(q).model_copy(update={"schedule": schedule_label(schedule) if schedule else None})


@router.get("/saved", response_model=list[SavedOut])
def list_saved(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    schedules = _schedules(db, member.workspace_id)
    queries = db.scalars(select(SavedQuery).where(SavedQuery.workspace_id == member.workspace_id).order_by(SavedQuery.updated_at.desc())).all()
    return [_saved_out(q, schedules.get(q.id)) for q in queries]


@router.post("/saved", response_model=SavedOut, status_code=status.HTTP_201_CREATED)
def save(body: SavedIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    q = SavedQuery(
        workspace_id=member.workspace_id, name=body.name.strip(), sql=body.sql, params=_params(body),
        builder_state=body.builder_state, created_by=member.user_id,
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


def _params(body: SavedIn) -> list[dict]:
    """Keep values only for placeholders the SQL still uses."""
    from app.sql_params import param_names

    used = set(param_names(body.sql))
    return [p.model_dump() for p in body.params if p.name in used]


def _saved(db: Session, member: WorkspaceMember, qid: str) -> SavedQuery:
    q = db.get(SavedQuery, qid)
    if q is None or q.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Query not found")
    return q


@router.put("/saved/{qid}", response_model=SavedOut)
def update_saved(qid: str, body: SavedIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    q = _saved(db, member, qid)
    q.name, q.sql, q.params, q.builder_state = body.name.strip(), body.sql, _params(body), body.builder_state
    db.commit()
    db.refresh(q)
    return _saved_out(q, _schedules(db, member.workspace_id).get(q.id))


@router.delete("/saved/{qid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved(qid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    q = _saved(db, member, qid)
    # Its schedule goes with it (the FK cascades on Postgres; SQLite only cascades with foreign_keys on).
    schedule = _schedules(db, member.workspace_id).get(q.id)
    if schedule is not None:
        db.delete(schedule)
    db.delete(q)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- schedules ----------


@router.get("/saved/{qid}/schedule", response_model=ScheduleOut | None)
def get_schedule(qid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    q = _saved(db, member, qid)
    a = _schedules(db, member.workspace_id).get(q.id)
    return _schedule_out(a) if a else None


@router.put("/saved/{qid}/schedule", response_model=ScheduleOut)
def put_schedule(
    qid: str, body: ScheduleIn, member: WorkspaceMember = Depends(current_membership),
    user: AuthUser = Depends(current_user), db: Session = Depends(get_db),
):
    """Run this saved query on a schedule and send the result. One schedule per query."""
    from app.routers.alerts import Channels, _check_channels

    _editor(member)
    q = _saved(db, member, qid)
    try:
        channels = Channels(inapp=body.inapp, emails=body.emails)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e).splitlines()[-1].strip()) from e
    stored = _check_channels(channels, user)
    a = _schedules(db, member.workspace_id).get(q.id)
    if a is None:
        a = Automation(workspace_id=member.workspace_id, kind="saved_query", saved_query_id=q.id, created_by=member.user_id)
        db.add(a)
    a.name = q.name[:200]
    a.schedule, a.hour, a.weekday, a.timezone, a.enabled = body.schedule, body.hour, body.weekday, body.timezone, body.enabled
    a.options = {"format": body.format, "only_if_rows": body.only_if_rows}
    a.channels = stored
    db.commit()
    db.refresh(a)
    return _schedule_out(a)


@router.delete("/saved/{qid}/schedule", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(qid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    q = _saved(db, member, qid)
    a = _schedules(db, member.workspace_id).get(q.id)
    if a is not None:
        db.delete(a)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
