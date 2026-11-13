"""Dashboards (an ordered feed of charts), charts, live previews, starter dashboards and share links."""

import json
import secrets
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.rate_limit import per_share_link, per_user
from app.db import get_db
from app.insights import chart_insight, previous_period, starter_specs
from app.models import Chart, Dashboard, Dataset, UserProfile, WorkspaceMember
from app.query import Filters, QueryError, connect, distinct_values, validate_select
from app.routers.datasets import CAN_UPLOAD, owned_dataset
from app.sql_params import Param, bind
from app.schemas import (
    ChartIn,
    ChartOut,
    ChartPatch,
    ChartViewOut,
    DashboardIn,
    DashboardOut,
    DashboardPatch,
    DashboardSummary,
    DashboardViewOut,
    DatasetRef,
    InsightOut,
    OrderIn,
    PeriodOut,
    PreviewIn,
    PreviewOut,
    ShareOut,
)
from app.security import current_membership

router = APIRouter(tags=["dashboards"])
public = APIRouter(prefix="/public", tags=["public"], dependencies=[Depends(per_share_link())])

MAX_CHARTS = 40


# ---------- helpers ----------


def _editor(member: WorkspaceMember) -> None:
    if member.role not in CAN_UPLOAD:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Viewers can't change dashboards. Ask an owner for editor access.")


def _dashboard(db: Session, member: WorkspaceMember, dashboard_id: str) -> Dashboard:
    d = db.get(Dashboard, dashboard_id)
    if d is None or d.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dashboard not found")
    return d


def _chart(db: Session, member: WorkspaceMember, chart_id: str) -> Chart:
    c = db.get(Chart, chart_id)
    if c is None or c.dashboard.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chart not found")
    return c


def _datasets(db: Session, d: Dashboard) -> dict[str, Dataset]:
    ids = {c.dataset_id for c in d.charts if c.dataset_id}
    if not ids:
        return {}
    rows = db.scalars(select(Dataset).where(Dataset.id.in_(ids), Dataset.workspace_id == d.workspace_id))
    return {ds.id: ds for ds in rows}


def _out(db: Session, d: Dashboard, member: WorkspaceMember | None) -> DashboardOut:
    datasets = _datasets(db, d)
    return DashboardOut(
        id=d.id, name=d.name, description=d.description, date_fields=d.date_fields or {},
        filter_columns=d.filter_columns or [], kpi_layout=d.kpi_layout or [], canvas_layout=d.canvas_layout or [],
        share_token=d.share_token if member else None, created_at=d.created_at, updated_at=d.updated_at,
        charts=[ChartOut.model_validate(c) for c in d.charts],
        datasets=[DatasetRef(id=ds.id, name=ds.name, columns=ds.columns) for ds in datasets.values()],
        can_edit=bool(member and member.role in CAN_UPLOAD),
    )


def _parse_filters(f: str | None) -> dict[str, str]:
    if not f:
        return {}
    try:
        data = json.loads(f)
        if not isinstance(data, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Filters must be a JSON object") from None
    return {str(k): str(v) for k, v in data.items() if v not in (None, "")}


def _all_datasets(db: Session, workspace_id: str) -> dict[str, Dataset]:
    return {ds.id: ds for ds in db.scalars(select(Dataset).where(Dataset.workspace_id == workspace_id))}


def _view(db: Session, d: Dashboard, date_from: date | None, date_to: date | None, equals: dict[str, str]) -> DashboardViewOut:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The start date is after the end date")
    datasets = _all_datasets(db, d.workspace_id) if any(c.spec.get("sql") for c in d.charts) else _datasets(db, d)
    con = connect(d.workspace_id, list(datasets.values()))
    allowed = set(d.filter_columns or [])
    out: list[ChartViewOut] = []
    try:
        for c in d.charts:
            ds = datasets.get(c.dataset_id or "")
            if ds is None:
                out.append(ChartViewOut(id=c.id, error="The dataset behind this chart was deleted."))
                continue
            cols = {col["name"] for col in ds.columns}
            filters = Filters(
                date_field=(d.date_fields or {}).get(ds.id),
                date_from=date_from,
                date_to=date_to,
                equals={k: v for k, v in equals.items() if k in allowed and k in cols},
            )
            try:
                rows, insight = chart_insight(con, c.spec, ds, filters)
                out.append(ChartViewOut(id=c.id, rows=rows, insight=InsightOut(**insight.__dict__)))
            except QueryError as e:
                out.append(ChartViewOut(id=c.id, error=str(e)))
    finally:
        con.close()
    period = None
    prev = previous_period(Filters("x", date_from, date_to))
    if prev:
        period = PeriodOut(date_from=date_from, date_to=date_to, prev_from=prev.date_from, prev_to=prev.date_to)
    return DashboardViewOut(charts=out, period=period)


def _check_spec_dataset(db: Session, member: WorkspaceMember, spec: dict) -> Dataset:
    ds = owned_dataset(db, member, spec["dataset"])
    if spec.get("sql"):
        # Columns are the query's own; check it's a single read-only SELECT now, not on first view.
        try:
            sql, _ = bind(spec["sql"], [Param(**p) for p in spec.get("params") or []])
            validate_select(sql)
        except QueryError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
        return ds
    cols = {c["name"] for c in ds.columns}
    missing = [m["field"] for m in spec["metrics"] if m["field"] != "*" and m["field"] not in cols]
    if spec.get("groupBy") and spec["groupBy"] not in cols:
        missing.append(spec["groupBy"])
    if missing:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f'"{missing[0]}" isn\'t a column in {ds.name}')
    return ds


# ---------- dashboards ----------


@router.get("/dashboards", response_model=list[DashboardSummary])
def list_dashboards(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    dashboards = db.scalars(
        select(Dashboard).where(Dashboard.workspace_id == member.workspace_id).order_by(Dashboard.updated_at.desc())
    ).all()
    names = dict(db.execute(select(Dataset.id, Dataset.name).where(Dataset.workspace_id == member.workspace_id)).all())
    return [
        DashboardSummary(
            id=d.id, name=d.name, description=d.description,
            chart_count=sum(1 for c in d.charts if c.kind == "card"), kpi_count=sum(1 for c in d.charts if c.kind == "kpi"),
            dataset_names=sorted({names[c.dataset_id] for c in d.charts if c.dataset_id in names}),
            shared=d.share_token is not None, updated_at=d.updated_at,
        )
        for d in dashboards
    ]


@router.post("/dashboards", response_model=DashboardOut, status_code=status.HTTP_201_CREATED)
def create_dashboard(body: DashboardIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    d = Dashboard(workspace_id=member.workspace_id, name=body.name.strip(), description=body.description, created_by=member.user_id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return _out(db, d, member)


@router.get("/dashboards/{dashboard_id}", response_model=DashboardOut)
def get_dashboard(dashboard_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _out(db, _dashboard(db, member, dashboard_id), member)


@router.patch("/dashboards/{dashboard_id}", response_model=DashboardOut)
def update_dashboard(
    dashboard_id: str, body: DashboardPatch, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)
):
    _editor(member)
    d = _dashboard(db, member, dashboard_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        d.name = data["name"].strip()
    if "description" in data:
        d.description = data["description"]
    if "date_fields" in data:
        for ds_id, col in data["date_fields"].items():
            ds = owned_dataset(db, member, ds_id)
            if not any(c["name"] == col and c["type"] == "date" for c in ds.columns):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f'"{col}" isn\'t a date column in {ds.name}')
        d.date_fields = dict(data["date_fields"])
    if "filter_columns" in data:
        d.filter_columns = list(dict.fromkeys(data["filter_columns"]))
    if "kpi_layout" in data:
        d.kpi_layout = data["kpi_layout"]
    if "canvas_layout" in data:
        d.canvas_layout = data["canvas_layout"]
    db.commit()
    db.refresh(d)
    return _out(db, d, member)


@router.delete("/dashboards/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dashboard(dashboard_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    db.delete(_dashboard(db, member, dashboard_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/dashboards/{dashboard_id}/duplicate", response_model=DashboardOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(per_user("build"))])
def duplicate_dashboard(dashboard_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    src = _dashboard(db, member, dashboard_id)
    copy = Dashboard(
        workspace_id=src.workspace_id, name=f"{src.name} (copy)"[:200], description=src.description,
        date_fields=dict(src.date_fields or {}), filter_columns=list(src.filter_columns or []), created_by=member.user_id,
    )
    db.add(copy)
    db.flush()
    id_map = {}
    for c in src.charts:
        new = Chart(dashboard_id=copy.id, dataset_id=c.dataset_id, spec=dict(c.spec), kind=c.kind, note=c.note, position=c.position)
        db.add(new)
        db.flush()
        id_map[c.id] = new.id
    copy.kpi_layout = [{**item, "i": id_map[item["i"]]} for item in (src.kpi_layout or []) if item.get("i") in id_map]
    copy.canvas_layout = [{**item, "i": id_map[item["i"]]} for item in (src.canvas_layout or []) if item.get("i") in id_map]
    db.commit()
    db.refresh(copy)
    return _out(db, copy, member)


@router.get("/dashboards/{dashboard_id}/view", response_model=DashboardViewOut, dependencies=[Depends(per_user("view"))])
def dashboard_view(
    dashboard_id: str,
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    f: str | None = Query(None, description="JSON object {column: value}"),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    return _view(db, _dashboard(db, member, dashboard_id), date_from, date_to, _parse_filters(f))


@router.get("/dashboards/{dashboard_id}/filter-values/{column}", response_model=list[str])
def filter_values(dashboard_id: str, column: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    d = _dashboard(db, member, dashboard_id)
    return _filter_values(db, d, column)


def _filter_values(db: Session, d: Dashboard, column: str) -> list[str]:
    datasets = [ds for ds in _datasets(db, d).values() if any(c["name"] == column for c in ds.columns)]
    if not datasets:
        return []
    con = connect(d.workspace_id, datasets)
    try:
        values: dict[str, None] = {}
        for ds in datasets:
            values.update(dict.fromkeys(distinct_values(con, ds, column)))
        return sorted(values)[:300]
    finally:
        con.close()


# ---------- charts ----------


@router.post("/dashboards/{dashboard_id}/charts", response_model=ChartOut, status_code=status.HTTP_201_CREATED)
def add_chart(dashboard_id: str, body: ChartIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    d = _dashboard(db, member, dashboard_id)
    if len(d.charts) >= MAX_CHARTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"A dashboard can hold up to {MAX_CHARTS} charts.")
    spec = body.spec.model_dump(exclude_none=True)
    ds = _check_spec_dataset(db, member, spec)
    position = max((c.position for c in d.charts), default=-1) + 1
    chart = Chart(dashboard_id=d.id, dataset_id=ds.id, spec=spec, kind=body.kind, note=body.note, position=position)
    db.add(chart)
    # First chart from a dataset with a date column: use it for the date filter.
    if ds.id not in (d.date_fields or {}):
        date_col = next((c["name"] for c in ds.columns if c["type"] == "date"), None)
        if date_col:
            d.date_fields = {**(d.date_fields or {}), ds.id: date_col}
    d.updated_at = func.now()
    db.commit()
    db.refresh(chart)
    return chart


@router.patch("/charts/{chart_id}", response_model=ChartOut)
def update_chart(chart_id: str, body: ChartPatch, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    chart = _chart(db, member, chart_id)
    data = body.model_dump(exclude_unset=True)
    if body.spec is not None:
        spec = body.spec.model_dump(exclude_none=True)
        chart.dataset_id = _check_spec_dataset(db, member, spec).id
        chart.spec = spec
    if "kind" in data and data["kind"]:
        chart.kind = data["kind"]
    if "note" in data:
        chart.note = data["note"]
    chart.dashboard.updated_at = func.now()
    db.commit()
    db.refresh(chart)
    return chart


@router.delete("/charts/{chart_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chart(chart_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    chart = _chart(db, member, chart_id)
    d = chart.dashboard
    d.kpi_layout = [i for i in (d.kpi_layout or []) if i.get("i") != chart.id]
    d.canvas_layout = [i for i in (d.canvas_layout or []) if i.get("i") != chart.id]
    db.delete(chart)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/dashboards/{dashboard_id}/order", response_model=list[ChartOut])
def reorder(dashboard_id: str, body: OrderIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    d = _dashboard(db, member, dashboard_id)
    by_id = {c.id: c for c in d.charts}
    if set(body.chart_ids) - set(by_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown chart in the new order")
    ordered = [by_id[i] for i in body.chart_ids] + [c for c in d.charts if c.id not in body.chart_ids]
    for n, c in enumerate(ordered):
        c.position = n
    db.commit()
    return [ChartOut.model_validate(c) for c in ordered]


@router.post("/charts/preview", response_model=PreviewOut, dependencies=[Depends(per_user("preview"))])
def preview(body: PreviewIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Live result for the chart builder, before anything is saved."""
    spec = body.spec.model_dump(exclude_none=True)
    ds = _check_spec_dataset(db, member, spec)
    date_field = body.date_field or next((c["name"] for c in ds.columns if c["type"] == "date"), None)
    filters = Filters(date_field, body.date_from, body.date_to) if date_field and (body.date_from or body.date_to) else None
    con = connect(member.workspace_id, list(_all_datasets(db, member.workspace_id).values()) if spec.get("sql") else [ds])
    try:
        rows, insight = chart_insight(con, spec, ds, filters)
    except QueryError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    finally:
        con.close()
    return PreviewOut(rows=rows, insight=InsightOut(**insight.__dict__))


@router.post("/datasets/{dataset_id}/starter-dashboard", response_model=DashboardOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(per_user("build"))])
def starter_dashboard(dataset_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Build a first dashboard from the dataset's column types (rules only; AI comes later)."""
    _editor(member)
    ds = owned_dataset(db, member, dataset_id)
    con = connect(member.workspace_id, [ds])
    try:
        charts, date_fields, filter_columns = starter_specs(con, ds)
    finally:
        con.close()
    d = Dashboard(
        workspace_id=member.workspace_id, name=f"{ds.name} overview"[:200],
        description=f"Built from {ds.source_filename}", date_fields=date_fields, filter_columns=filter_columns,
        created_by=member.user_id,
    )
    db.add(d)
    db.flush()
    for n, ch in enumerate(charts):
        db.add(Chart(dashboard_id=d.id, dataset_id=ds.id, spec=ch["spec"], kind=ch["kind"], position=n))
    db.commit()
    db.refresh(d)
    return _out(db, d, member)


# ---------- sharing ----------


def _visibility(db: Session, user_id: str | None) -> str:
    profile = db.get(UserProfile, user_id) if user_id else None
    return profile.dashboard_visibility if profile else "team"


@router.post("/dashboards/{dashboard_id}/share", response_model=ShareOut)
def share(dashboard_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    d = _dashboard(db, member, dashboard_id)
    if _visibility(db, member.user_id) != "anyone":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            'Your dashboard sharing is set to "Team members only". Change it to "Anyone with the link" on your profile first.',
        )
    d.share_token = d.share_token or secrets.token_urlsafe(24)
    if not d.created_by:
        d.created_by = member.user_id
    db.commit()
    return ShareOut(share_token=d.share_token)


@router.delete("/dashboards/{dashboard_id}/share", response_model=ShareOut)
def unshare(dashboard_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    d = _dashboard(db, member, dashboard_id)
    d.share_token = None
    db.commit()
    return ShareOut(share_token=None)


def _shared(db: Session, token: str) -> Dashboard:
    d = db.scalar(select(Dashboard).where(Dashboard.share_token == token)) if token else None
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link doesn't work any more. Ask for a new one.")
    # The creator can turn link sharing off on their profile; that disables existing links too.
    if _visibility(db, d.created_by) != "anyone":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The owner has turned off link sharing for this dashboard.")
    return d


@public.get("/dashboards/{token}", response_model=DashboardOut)
def public_dashboard(token: str, db: Session = Depends(get_db)):
    return _out(db, _shared(db, token), None)


@public.get("/dashboards/{token}/view", response_model=DashboardViewOut)
def public_view(
    token: str,
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    f: str | None = None,
    db: Session = Depends(get_db),
):
    return _view(db, _shared(db, token), date_from, date_to, _parse_filters(f))


@public.get("/dashboards/{token}/filter-values/{column}", response_model=list[str])
def public_filter_values(token: str, column: str, db: Session = Depends(get_db)):
    return _filter_values(db, _shared(db, token), column)


