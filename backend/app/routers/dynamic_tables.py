"""Dynamic tables: create, configure freshness, refresh, pause/resume, history, graph and preview."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import dynamic_tables as dt
from app.audit import record_action
from app.db import get_db
from app.jobs import DYNAMIC_REFRESH, Due, _second, dispatch
from app.models import Dataset, DynamicRefresh, DynamicTable, WorkspaceMember
from app.query import QueryError
from app.routers.datasets import _unique_name, check_quota, owned_dataset, parquet_path, require_editor
from app.routers.sql_lab import check_project
from app.schemas import SqlParam, UtcDatetime
from app.security import current_membership

router = APIRouter(prefix="/dynamic-tables", tags=["dynamic-tables"])

Layer = Literal["bronze", "silver", "gold"]


class TableIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sql: str = Field(min_length=1, max_length=10_000)
    params: list[SqlParam] = Field(default_factory=list, max_length=20)
    layer: Layer | None = None
    description: str | None = Field(default=None, max_length=500)
    interval_minutes: int | None = Field(default=None, ge=dt.MIN_INTERVAL, le=60 * 24 * 31)
    on_upstream_change: bool = False
    refresh_mode: Literal["full", "incremental"] = "full"
    watermark_column: str | None = Field(default=None, max_length=200)
    project_id: str | None = None

    @model_validator(mode="after")
    def _incremental_needs_watermark(self):
        if self.refresh_mode == "incremental" and not (self.watermark_column or "").strip():
            raise ValueError("Incremental refresh needs a watermark column (a date or an always-increasing id).")
        return self


class TablePatch(BaseModel):
    interval_minutes: int | None = Field(default=None, ge=dt.MIN_INTERVAL, le=60 * 24 * 31)
    clear_interval: bool = False
    on_upstream_change: bool | None = None
    paused: bool | None = None


class RefreshOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    trigger: str
    mode: str
    status: str
    attempt: int
    rows: int | None
    rows_added: int | None
    duration_ms: int | None
    error: str | None
    schema_change: dict | None
    created_at: UtcDatetime
    started_at: UtcDatetime | None
    finished_at: UtcDatetime | None


class TableOut(BaseModel):
    id: str
    dataset_id: str
    name: str
    sql: str
    params: list[SqlParam]
    upstream: list[dict]
    interval_minutes: int | None
    on_upstream_change: bool
    refresh_mode: str
    refresh_mode_note: str
    watermark_column: str | None
    paused: bool
    status: str
    last_refresh_at: UtcDatetime | None
    next_refresh_at: UtcDatetime | None
    last_error: str | None
    failures: int
    row_count: int
    layer: str | None
    project_id: str | None
    last_refresh: RefreshOut | None
    created_at: UtcDatetime


def _mode_note(t: DynamicTable) -> str:
    if t.refresh_mode == "incremental":
        return (f"Incremental: appends rows whose “{t.watermark_column}” is newer than the last refresh. Rows changed or deleted "
                "upstream are only reflected by a full refresh. The first refresh, and any refresh after the columns change, is full.")
    return "Full refresh: the query is re-run and the table replaced every time."


def _out(db: Session, t: DynamicTable) -> TableOut:
    ds = db.get(Dataset, t.dataset_id)
    ups = {d.id: d for d in db.scalars(select(Dataset).where(Dataset.id.in_(t.upstream_ids or [])))} if t.upstream_ids else {}
    last = db.scalar(select(DynamicRefresh).where(DynamicRefresh.table_id == t.id).order_by(DynamicRefresh.created_at.desc()).limit(1))
    return TableOut(
        id=t.id, dataset_id=t.dataset_id, name=t.name, sql=t.sql, params=t.params or [],
        upstream=[{"id": i, "name": ups[i].name if i in ups else "(deleted)", "layer": ups[i].layer if i in ups else None} for i in (t.upstream_ids or [])],
        interval_minutes=t.interval_minutes, on_upstream_change=t.on_upstream_change, refresh_mode=t.refresh_mode,
        refresh_mode_note=_mode_note(t), watermark_column=t.watermark_column, paused=t.paused,
        status="paused" if t.paused else t.status, last_refresh_at=t.last_refresh_at, next_refresh_at=t.next_refresh_at,
        last_error=t.last_error, failures=t.failures, row_count=ds.row_count if ds else 0, layer=ds.layer if ds else None,
        project_id=t.project_id, last_refresh=RefreshOut.model_validate(last) if last else None, created_at=t.created_at,
    )


def _table(db: Session, member: WorkspaceMember, tid: str) -> DynamicTable:
    t = db.get(DynamicTable, tid)
    if t is None or t.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dynamic table not found")
    return t


def _unprocessable(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, msg)


def _validate(db: Session, member: WorkspaceMember, body: TableIn, dataset_id: str | None) -> list[Dataset]:
    params = [p.model_dump() for p in body.params]
    try:
        deps = dt.dependencies(db, member.workspace_id, body.sql, params, exclude=dataset_id)
        dt.check_query(db, member.workspace_id, body.sql, params, exclude=dataset_id)
    except (dt.DynamicTableError, QueryError) as e:
        raise _unprocessable(str(e)) from e
    if not deps:
        raise _unprocessable("The query doesn't read any dataset. Select from at least one table.")
    cycle = dt.would_cycle(db, member.workspace_id, dataset_id, [d.id for d in deps])
    if cycle:
        names = {d.id: d.name for d in db.scalars(select(Dataset).where(Dataset.id.in_(cycle)))}
        raise _unprocessable("That would create a dependency cycle: " + " → ".join(names.get(i, "this table") for i in cycle) + ".")
    if body.refresh_mode == "incremental":
        from app.query import connect
        from app.sql_params import Param, bind

        bound, values = bind(body.sql, [Param(**p) for p in params])
        con = connect(member.workspace_id, deps)
        try:
            cols = [d[0] for d in con.execute(f"SELECT * FROM ({bound}) LIMIT 0", values).description]  # nosec B608 - validated SELECT
        finally:
            con.close()
        if body.watermark_column not in cols:
            raise _unprocessable(f'The query doesn\'t return a column called "{body.watermark_column}" to use as the watermark.')
    return deps


def _queue(db: Session, t: DynamicTable, trigger: str, background: BackgroundTasks) -> DynamicRefresh:
    if t.status == "refreshing":
        raise HTTPException(status.HTTP_409_CONFLICT, "A refresh is already running.")
    pending = db.scalar(select(DynamicRefresh).where(DynamicRefresh.table_id == t.id, DynamicRefresh.status == "queued").limit(1))
    if pending is not None:
        return pending
    r = dt.queue_refresh(db, t, trigger)
    dispatch(db, Due(DYNAMIC_REFRESH, r.id, _second(datetime.now(timezone.utc))), background)
    return r


@router.get("", response_model=list[TableOut])
def list_tables(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    rows = db.scalars(select(DynamicTable).where(DynamicTable.workspace_id == member.workspace_id).order_by(DynamicTable.name)).all()
    return [_out(db, t) for t in rows]


@router.get("/graph")
def graph(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return dt.graph_for(db, member.workspace_id)


class ValidateIn(BaseModel):
    sql: str = Field(min_length=1, max_length=10_000)
    params: list[SqlParam] = Field(default_factory=list, max_length=20)
    table_id: str | None = None


@router.post("/validate")
def validate(body: ValidateIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Check a query and list the datasets it depends on, before saving."""
    require_editor(member)
    exclude = _table(db, member, body.table_id).dataset_id if body.table_id else None
    params = [p.model_dump() for p in body.params]
    try:
        deps = dt.dependencies(db, member.workspace_id, body.sql, params, exclude=exclude)
        dt.check_query(db, member.workspace_id, body.sql, params, exclude=exclude)
    except (dt.DynamicTableError, QueryError) as e:
        return {"ok": False, "error": str(e), "dependencies": []}
    cycle = dt.would_cycle(db, member.workspace_id, exclude, [d.id for d in deps])
    return {"ok": not cycle and bool(deps), "error": "That would create a dependency cycle." if cycle else (None if deps else "The query doesn't read any dataset."),
            "dependencies": [{"id": d.id, "name": d.name, "layer": d.layer} for d in deps]}


@router.post("", response_model=TableOut, status_code=status.HTTP_201_CREATED)
def create(body: TableIn, background: BackgroundTasks, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    require_editor(member)
    deps = _validate(db, member, body, None)
    check_quota(db, member.workspace_id, new_datasets=1)
    ds = Dataset(workspace_id=member.workspace_id, created_by=member.user_id, name=_unique_name(db, member.workspace_id, body.name.strip()),
                 source_filename="Dynamic table", source_kind="dynamic", row_count=0, columns=[], file_size=0, layer=body.layer,
                 description=body.description, refresh="manual",
                 origin={"kind": "dynamic"})
    db.add(ds)
    db.flush()
    t = DynamicTable(workspace_id=member.workspace_id, project_id=check_project(db, member, body.project_id), dataset_id=ds.id,
                     name=ds.name, sql=body.sql, params=[p.model_dump() for p in body.params], upstream_ids=[d.id for d in deps],
                     interval_minutes=body.interval_minutes, on_upstream_change=body.on_upstream_change, refresh_mode=body.refresh_mode,
                     watermark_column=(body.watermark_column or "").strip() or None, created_by=member.user_id, status="pending")
    db.add(t)
    record_action(db, member, "dynamic_table.create", "dynamic_table", t.id, {"mode": body.refresh_mode})
    db.commit()
    db.refresh(t)
    _queue(db, t, "create", background)
    return _out(db, t)


@router.get("/{tid}", response_model=TableOut)
def get_table(tid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _out(db, _table(db, member, tid))


@router.put("/{tid}", response_model=TableOut)
def update(tid: str, body: TableIn, background: BackgroundTasks, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Change the definition. The table is rebuilt with a full refresh."""
    require_editor(member)
    t = _table(db, member, tid)
    deps = _validate(db, member, body, t.dataset_id)
    t.sql, t.params, t.upstream_ids = body.sql, [p.model_dump() for p in body.params], [d.id for d in deps]
    t.interval_minutes, t.on_upstream_change, t.refresh_mode = body.interval_minutes, body.on_upstream_change, body.refresh_mode
    t.watermark_column = (body.watermark_column or "").strip() or None
    t.watermark_value = None  # the next refresh is full
    t.project_id = check_project(db, member, body.project_id)
    ds = db.get(Dataset, t.dataset_id)
    if ds is not None:
        ds.layer, ds.description = body.layer, body.description
    record_action(db, member, "dynamic_table.update", "dynamic_table", t.id, None)
    db.commit()
    _queue(db, t, "manual", background)
    return _out(db, t)


@router.patch("/{tid}", response_model=TableOut)
def patch(tid: str, body: TablePatch, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Freshness, upstream-change refresh, pause and resume."""
    require_editor(member)
    t = _table(db, member, tid)
    if body.clear_interval:
        t.interval_minutes = None
    elif body.interval_minutes is not None:
        t.interval_minutes = body.interval_minutes
    if body.on_upstream_change is not None:
        t.on_upstream_change = body.on_upstream_change
    if body.paused is not None and body.paused != t.paused:
        t.paused = body.paused
        record_action(db, member, "dynamic_table.pause" if body.paused else "dynamic_table.resume", "dynamic_table", t.id, None)
    now = datetime.now(timezone.utc)
    t.next_refresh_at = dt.next_due(t, dt._aware(t.last_refresh_at) or now) if not t.paused else None
    if t.next_refresh_at is not None and t.next_refresh_at < now:
        t.next_refresh_at = now
    db.commit()
    return _out(db, t)


class RefreshIn(BaseModel):
    full: bool = False


@router.post("/{tid}/refresh", response_model=RefreshOut, status_code=status.HTTP_202_ACCEPTED)
def refresh_now(tid: str, body: RefreshIn, background: BackgroundTasks, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Queue a refresh on the worker. `full` forces a full refresh of an incremental table."""
    require_editor(member)
    t = _table(db, member, tid)
    if body.full:
        t.watermark_value = None
        db.commit()
    return _queue(db, t, "manual", background)


@router.get("/{tid}/refreshes", response_model=list[RefreshOut])
def history(tid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    t = _table(db, member, tid)
    return db.scalars(select(DynamicRefresh).where(DynamicRefresh.table_id == t.id).order_by(DynamicRefresh.created_at.desc()).limit(100)).all()


@router.get("/{tid}/preview")
def preview(tid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """The first rows of the materialized output (as this person may see them)."""
    from app.governance import connect_as
    from app.query import records, view_name

    t = _table(db, member, tid)
    ds = owned_dataset(db, member, t.dataset_id)
    if not parquet_path(member.workspace_id, ds.id).exists():
        return {"columns": [], "rows": [], "row_count": 0}
    con = connect_as(db, member, [ds])
    try:
        cur = con.execute(f"SELECT * FROM {view_name(ds.id)} LIMIT 100")  # nosec B608 - server-built view name
        cols = [d[0] for d in cur.description]
        return {"columns": cols, "rows": records(cols, cur.fetchall()), "row_count": ds.row_count}
    except Exception as e:
        raise _unprocessable(f"The preview couldn't be read: {e}") from e
    finally:
        con.close()


@router.delete("/{tid}", status_code=status.HTTP_204_NO_CONTENT)
def delete(tid: str, keep_data: bool = False, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Stop maintaining the table. With keep_data, its last result stays as an ordinary dataset."""
    require_editor(member)
    t = _table(db, member, tid)
    ds = db.get(Dataset, t.dataset_id)
    record_action(db, member, "dynamic_table.delete", "dynamic_table", t.id, {"keep_data": keep_data})
    for r in db.scalars(select(DynamicRefresh).where(DynamicRefresh.table_id == t.id)).all():
        db.delete(r)
    db.delete(t)
    if ds is not None and not keep_data:
        db.delete(ds)
        parquet_path(member.workspace_id, ds.id).unlink(missing_ok=True)
    elif ds is not None:
        ds.source_kind, ds.origin = "derived", {"kind": "sql", "sql": t.sql, "params": t.params or []}
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
