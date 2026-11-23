"""Dashboards (an ordered feed of charts), charts, live previews, starter dashboards and share links."""

import json
import secrets
import time
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.insights import chart_insight, previous_period, starter_specs
from app.analytics.semantic import require_approved
from app.audit import log_query, record_action
from app.models import Chart, Dashboard, Dataset, UserProfile, WorkspaceMember
from app.governance import access_for, connect_as
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
from app.telemetry import count, span

router = APIRouter(tags=["dashboards"])
public = APIRouter(prefix="/public", tags=["public"])

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


DEFAULT_PAGE = {"id": "page-1", "name": "Page 1"}


def _pages(d: Dashboard) -> list[dict]:
    """The report's pages, always at least one (dashboards made before pages had none)."""
    return [p for p in (d.pages or []) if p.get("id")] or [dict(DEFAULT_PAGE)]


def _page_of(page_ids: list[str], c: Chart) -> str:
    """A chart's page; charts with no page (or a page that was deleted) sit on the first one."""
    return c.page_id if c.page_id in page_ids else page_ids[0]


def _chart_out(c: Chart, page_ids: list[str]) -> ChartOut:
    out = ChartOut.model_validate(c)
    out.page_id = _page_of(page_ids, c)
    return out


def _public_chart(c: Chart) -> ChartOut:
    """A chart for a share link or print page: no saved SQL (it names tables, columns and values)."""
    out = ChartOut.model_validate(c)
    out.spec = {k: v for k, v in (c.spec or {}).items() if k not in ("sql", "params")}
    return out


def _out(db: Session, d: Dashboard, member: WorkspaceMember | None) -> DashboardOut:
    """member=None means a share link or print page: the reader isn't in the workspace, so they get
    column names and types only (no sample values) and no chart SQL."""
    datasets = _datasets(db, d)
    pages = _pages(d)
    page_ids = [p["id"] for p in pages]
    if member is None:
        refs = [
            DatasetRef(id=ds.id, name=ds.name, columns=[{**col, "examples": []} for col in ds.columns]) for ds in datasets.values()
        ]
        charts = [_public_chart(c) for c in d.charts]
    else:
        refs = [DatasetRef(id=ds.id, name=ds.name, columns=ds.columns) for ds in datasets.values()]
        charts = [ChartOut.model_validate(c) for c in d.charts]
    for out, c in zip(charts, d.charts, strict=True):
        out.page_id = _page_of(page_ids, c)
    return DashboardOut(
        id=d.id, name=d.name, description=d.description, date_fields=d.date_fields or {},
        filter_columns=d.filter_columns or [], kpi_layout=d.kpi_layout or [], canvas_layout=d.canvas_layout or [],
        pages=pages, share_token=d.share_token if member else None, created_at=d.created_at, updated_at=d.updated_at,
        charts=charts, datasets=refs, can_edit=bool(member and member.role in CAN_UPLOAD),
    )


def _parse_filters(f: str | None) -> dict[str, str]:
    if not f:
        return {}
    try:
        data = json.loads(f)
        if not isinstance(data, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Filters must be a JSON object") from None
    return {str(k): str(v) for k, v in data.items() if v not in (None, "")}


def _cross_filter(d: Dashboard, x: str | None, xs: str | None) -> tuple[dict[str, str], str | None]:
    """A click on one visual filtering the others (Power BI's cross-filter). Only columns some chart on
    this dashboard already groups by are allowed, so it can't be used to probe any other column."""
    picked = _parse_filters(x)
    if not picked:
        return {}, None
    allowed = {c.spec.get("groupBy") for c in d.charts if not c.spec.get("sql") and c.spec.get("groupBy")}
    return {k: v for k, v in picked.items() if k in allowed}, xs


def _all_datasets(db: Session, workspace_id: str) -> dict[str, Dataset]:
    return {ds.id: ds for ds in db.scalars(select(Dataset).where(Dataset.workspace_id == workspace_id))}


def _view(
    db: Session,
    d: Dashboard,
    date_from: date | None,
    date_to: date | None,
    equals: dict[str, str],
    page: str | None = None,
    cross: dict[str, str] | None = None,
    cross_source: str | None = None,
    role: str = "owner",
) -> DashboardViewOut:
    """Every chart's rows and insight (or one page's). Traced as `vyuham.dashboard.view` (counts only, no data)."""
    with span("vyuham.dashboard.view", **{"vyuham.workspace_id": d.workspace_id, "vyuham.dashboard.charts": len(d.charts)}) as s:
        started = time.perf_counter()
        workspace_id = d.workspace_id
        view = _view_impl(db, d, date_from, date_to, equals, page, cross or {}, cross_source, role)
        failed = sum(1 for c in view.charts if c.error)
        log_query(db, workspace_id, None, "dashboard", started, "partial" if failed else "ok", len(view.charts))
        s.set_attribute("vyuham.dashboard.failed_charts", failed)
        count("vyuham.dashboard.views", outcome="partial" if failed else "ok")
        return view


def _view_impl(
    db: Session,
    d: Dashboard,
    date_from: date | None,
    date_to: date | None,
    equals: dict[str, str],
    page: str | None = None,
    cross: dict[str, str] | None = None,
    cross_source: str | None = None,
    role: str = "owner",
) -> DashboardViewOut:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The start date is after the end date")
    charts = list(d.charts)
    if page:
        page_ids = [p["id"] for p in _pages(d)]
        charts = [c for c in charts if _page_of(page_ids, c) == page]
    datasets = _all_datasets(db, d.workspace_id) if any(c.spec.get("sql") for c in charts) else _datasets(db, d)
    con = connect(d.workspace_id, list(datasets.values()), access=access_for(db, d.workspace_id, role))
    allowed = set(d.filter_columns or [])
    cross = cross or {}
    out: list[ChartViewOut] = []
    try:
        for c in charts:
            ds = datasets.get(c.dataset_id or "")
            if ds is None:
                out.append(ChartViewOut(id=c.id, error="The dataset behind this chart was deleted."))
                continue
            cols = {col["name"] for col in ds.columns}
            filters = Filters(
                date_field=(d.date_fields or {}).get(ds.id),
                date_from=date_from,
                date_to=date_to,
                equals={
                    **{k: v for k, v in equals.items() if k in allowed and k in cols},
                    # The clicked visual keeps showing everything; the others narrow to the pick.
                    **({k: v for k, v in cross.items() if k in cols} if c.id != cross_source else {}),
                },
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
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
        return ds
    cols = {c["name"] for c in ds.columns}
    for m in spec["metrics"]:
        if m["agg"] == "metric":
            try:
                m["label"] = require_approved(db, ds, m["field"]).name
            except QueryError as e:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    missing = [m["field"] for m in spec["metrics"] if m["agg"] != "metric" and m["field"] != "*" and m["field"] not in cols]
    missing += [spec[k] for k in ("groupBy", "seriesBy") if spec.get(k) and spec[k] not in cols]
    if missing:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f'"{missing[0]}" isn\'t a column in {ds.name}')
    return ds


# ---------- dashboards ----------


@router.get("/dashboards", response_model=list[DashboardSummary])
def list_dashboards(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    dashboards = db.scalars(
        select(Dashboard)
        .where(Dashboard.workspace_id == member.workspace_id)
        .order_by(Dashboard.updated_at.desc())
        .options(selectinload(Dashboard.charts))  # one query for every dashboard's charts, not one each
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
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f'"{col}" isn\'t a date column in {ds.name}')
        d.date_fields = dict(data["date_fields"])
    if "filter_columns" in data:
        d.filter_columns = list(dict.fromkeys(data["filter_columns"]))
    if "kpi_layout" in data:
        d.kpi_layout = data["kpi_layout"]
    if "canvas_layout" in data:
        d.canvas_layout = data["canvas_layout"]
    if "pages" in data:
        ids = [p["id"] for p in data["pages"]]
        if len(set(ids)) != len(ids):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Two pages share the same id")
        old_ids = [p["id"] for p in _pages(d)]
        for c in d.charts:
            # Pin every chart to its page now, so reordering pages doesn't move charts; charts on a
            # deleted page move to the new first page.
            current = _page_of(old_ids, c)
            c.page_id = current if current in ids else ids[0]
        d.pages = [{"id": p["id"], "name": p["name"].strip()} for p in data["pages"]]
    db.commit()
    db.refresh(d)
    return _out(db, d, member)


@router.delete("/dashboards/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dashboard(dashboard_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    db.delete(_dashboard(db, member, dashboard_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/dashboards/{dashboard_id}/duplicate", response_model=DashboardOut, status_code=status.HTTP_201_CREATED)
def duplicate_dashboard(dashboard_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    src = _dashboard(db, member, dashboard_id)
    copy = Dashboard(
        workspace_id=src.workspace_id, name=f"{src.name} (copy)"[:200], description=src.description,
        date_fields=dict(src.date_fields or {}), filter_columns=list(src.filter_columns or []), created_by=member.user_id,
        pages=[dict(p) for p in (src.pages or [])],
    )
    db.add(copy)
    db.flush()
    id_map = {}
    for c in src.charts:
        new = Chart(
            dashboard_id=copy.id, dataset_id=c.dataset_id, spec=dict(c.spec), kind=c.kind, note=c.note, position=c.position, page_id=c.page_id
        )
        db.add(new)
        db.flush()
        id_map[c.id] = new.id
    copy.kpi_layout = [{**item, "i": id_map[item["i"]]} for item in (src.kpi_layout or []) if item.get("i") in id_map]
    copy.canvas_layout = [{**item, "i": id_map[item["i"]]} for item in (src.canvas_layout or []) if item.get("i") in id_map]
    db.commit()
    db.refresh(copy)
    return _out(db, copy, member)


@router.get("/dashboards/{dashboard_id}/view", response_model=DashboardViewOut)
def dashboard_view(
    dashboard_id: str,
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    f: str | None = Query(None, description="JSON object {column: value}"),
    page: str | None = Query(None, max_length=32, description="Only this report page's charts"),
    x: str | None = Query(None, description="Cross-filter: JSON object {column: value} picked on one chart"),
    xs: str | None = Query(None, max_length=32, description="The chart the cross-filter was picked on"),
    member: WorkspaceMember = Depends(current_membership),
    db: Session = Depends(get_db),
):
    d = _dashboard(db, member, dashboard_id)
    cross, source = _cross_filter(d, x, xs)
    return _view(db, d, date_from, date_to, _parse_filters(f), page, cross, source, member.role)


@router.get("/dashboards/{dashboard_id}/filter-values/{column}", response_model=list[str])
def filter_values(dashboard_id: str, column: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    d = _dashboard(db, member, dashboard_id)
    return _filter_values(db, d, column, member.role)


def _filter_values(db: Session, d: Dashboard, column: str, role: str = "owner") -> list[str]:
    # Only the dashboard's own filter columns: otherwise a share link would list the raw values of any
    # column behind it (emails, phone numbers...).
    if column not in (d.filter_columns or []):
        return []
    datasets = [ds for ds in _datasets(db, d).values() if any(c["name"] == column for c in ds.columns)]
    if not datasets:
        return []
    con = connect(d.workspace_id, datasets, access=access_for(db, d.workspace_id, role))
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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"A dashboard can hold up to {MAX_CHARTS} charts.")
    spec = body.spec.model_dump(exclude_none=True)
    ds = _check_spec_dataset(db, member, spec)
    position = max((c.position for c in d.charts), default=-1) + 1
    page_ids = [p["id"] for p in _pages(d)]
    if body.page_id and body.page_id not in page_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That page isn't on this dashboard")
    chart = Chart(
        dashboard_id=d.id, dataset_id=ds.id, spec=spec, kind=body.kind, note=body.note, position=position,
        page_id=body.page_id or page_ids[0],
    )
    db.add(chart)
    # First chart from a dataset with a date column: use it for the date filter.
    if ds.id not in (d.date_fields or {}):
        date_col = next((c["name"] for c in ds.columns if c["type"] == "date"), None)
        if date_col:
            d.date_fields = {**(d.date_fields or {}), ds.id: date_col}
    d.updated_at = func.now()
    db.commit()
    db.refresh(chart)
    return _chart_out(chart, page_ids)


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
    page_ids = [p["id"] for p in _pages(chart.dashboard)]
    if data.get("page_id"):
        if data["page_id"] not in page_ids:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That page isn't on this dashboard")
        chart.page_id = data["page_id"]
    chart.dashboard.updated_at = func.now()
    db.commit()
    db.refresh(chart)
    return _chart_out(chart, page_ids)


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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown chart in the new order")
    ordered = [by_id[i] for i in body.chart_ids] + [c for c in d.charts if c.id not in body.chart_ids]
    for n, c in enumerate(ordered):
        c.position = n
    db.commit()
    page_ids = [p["id"] for p in _pages(d)]
    return [_chart_out(c, page_ids) for c in ordered]


@router.post("/charts/preview", response_model=PreviewOut)
def preview(body: PreviewIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Live result for the chart builder, before anything is saved."""
    spec = body.spec.model_dump(exclude_none=True)
    if spec.get("sql"):
        _editor(member)  # SQL charts come from SQL Lab, which is for owners and editors
    ds = _check_spec_dataset(db, member, spec)
    date_field = body.date_field or next((c["name"] for c in ds.columns if c["type"] == "date"), None)
    filters = Filters(date_field, body.date_from, body.date_to) if date_field and (body.date_from or body.date_to) else None
    con = connect_as(db, member, list(_all_datasets(db, member.workspace_id).values()) if spec.get("sql") else [ds])
    try:
        rows, insight = chart_insight(con, spec, ds, filters)
    except QueryError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    finally:
        con.close()
    return PreviewOut(rows=rows, insight=InsightOut(**insight.__dict__))


@router.post("/datasets/{dataset_id}/starter-dashboard", response_model=DashboardOut, status_code=status.HTTP_201_CREATED)
def starter_dashboard(dataset_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    """Build a first dashboard from the dataset's column types (rules only; AI comes later)."""
    _editor(member)
    ds = owned_dataset(db, member, dataset_id)
    con = connect_as(db, member, [ds])
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
    record_action(db, member, "dashboard.share", "dashboard", d.id)
    db.commit()
    return ShareOut(share_token=d.share_token)


@router.delete("/dashboards/{dashboard_id}/share", response_model=ShareOut)
def unshare(dashboard_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    d = _dashboard(db, member, dashboard_id)
    d.share_token = None
    record_action(db, member, "dashboard.unshare", "dashboard", d.id)
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
    page: str | None = Query(None, max_length=32),
    x: str | None = None,
    xs: str | None = Query(None, max_length=32),
    db: Session = Depends(get_db),
):
    d = _shared(db, token)
    cross, source = _cross_filter(d, x, xs)
    return _view(db, d, date_from, date_to, _parse_filters(f), page, cross, source, "public")


@public.get("/dashboards/{token}/filter-values/{column}", response_model=list[str])
def public_filter_values(token: str, column: str, db: Session = Depends(get_db)):
    return _filter_values(db, _shared(db, token), column, "public")


