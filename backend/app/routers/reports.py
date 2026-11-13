"""Reports: saved report definitions, quick exports, run history, downloads, and the print page API.

Anyone in the workspace can run and download reports of what they can already see. Saving,
editing and deleting report definitions is for owners and editors, and so is exporting a SQL Lab
saved query (SQL Lab itself is editors-only).
"""

from __future__ import annotations

import logging
import mimetypes
from datetime import date
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import signing
from app.config import get_settings
from app.db import get_db
from app.models import Dashboard, Dataset, Report, ReportRun, SavedQuery, WorkspaceMember
from app.reports import runner
from app.reports.storage import get_storage
from app.routers.datasets import CAN_UPLOAD
from app.schemas import UtcDatetime
from app.security import AuthUser, current_membership, current_user

log = logging.getLogger("app.reports")
router = APIRouter(tags=["reports"])
printer = APIRouter(prefix="/print", tags=["reports"])

Source = Literal["dashboard", "saved_query", "dataset"]
Format = Literal["pdf", "csv", "xlsx"]
DOWNLOAD_LINK_SECONDS = 7 * 24 * 3600
MEDIA = {"pdf": "application/pdf", "csv": "text/csv", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "zip": "application/zip"}


class ReportOptions(BaseModel):
    # Dashboards: a fixed range (an export of what's on screen), or the last N days counted from
    # each run (saved and scheduled reports); neither = all time.
    date_from: date | None = None
    date_to: date | None = None
    period_days: int | None = Field(default=None, ge=1, le=3660)
    filters: dict[str, str] = Field(default_factory=dict)  # dashboards: column = value
    orientation: Literal["portrait", "landscape"] = "portrait"  # PDF
    page_size: Literal["A4", "Letter"] = "A4"  # PDF

    @field_validator("filters")
    @classmethod
    def _few(cls, v: dict[str, str]) -> dict[str, str]:
        if len(v) > 20:
            raise ValueError("Up to 20 filters")
        return {k[:255]: str(val)[:500] for k, val in v.items() if val not in (None, "")}

    @model_validator(mode="after")
    def _range(self):
        if (self.date_from is None) != (self.date_to is None):
            raise ValueError("Give both a start and an end date, or neither")
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("The start date is after the end date")
        return self


class ExportIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    source: Source
    source_id: str = Field(min_length=1, max_length=32)
    format: Format
    options: ReportOptions = Field(default_factory=ReportOptions)


class ReportIn(ExportIn):
    name: str = Field(min_length=1, max_length=200)


class ReportRunOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    report_id: str | None
    name: str
    source: str
    source_id: str
    format: str
    status: str
    trigger: str
    file_name: str | None
    size_bytes: int | None
    rows: int | None
    error: str | None
    created_at: UtcDatetime
    started_at: UtcDatetime | None
    finished_at: UtcDatetime | None


class ReportOut(BaseModel):
    id: str
    name: str
    source: str
    source_id: str
    source_name: str | None
    format: str
    options: ReportOptions
    created_at: UtcDatetime
    updated_at: UtcDatetime
    last_run: ReportRunOut | None


# ---------- helpers ----------


def _editor(member: WorkspaceMember, what: str = "Saving reports") -> None:
    if member.role not in CAN_UPLOAD:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{what} is for owners and editors.")


def _source_name(db: Session, member: WorkspaceMember, source: str, source_id: str) -> str:
    """The source's name; 404 if it isn't in this workspace (same answer for missing and foreign)."""
    model = {"dashboard": Dashboard, "saved_query": SavedQuery, "dataset": Dataset}[source]
    obj = db.get(model, source_id)
    if obj is None or obj.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"That {source.replace('_', ' ')} doesn't exist")
    return obj.name


def _check(db: Session, member: WorkspaceMember, body: ExportIn) -> str:
    if body.format == "pdf" and body.source != "dashboard":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "PDF reports are for dashboards. Use CSV or Excel for queries and datasets.")
    if body.source == "saved_query":
        _editor(member, "Exporting SQL Lab queries")
    return _source_name(db, member, body.source, body.source_id)


def _run_inline(bind, run_id: str) -> None:
    """No Redis (local dev): generate after the response, in this process."""
    db = Session(bind=bind, expire_on_commit=False)
    try:
        runner.generate(db, run_id)
    except Exception as e:
        log.exception("report run %s failed", run_id)
        runner.mark_failed(db, run_id, e)
    finally:
        db.close()


def dispatch(db: Session, run_id: str, background: BackgroundTasks | None = None) -> None:
    if get_settings().redis_url:
        from app.worker import run_report  # Celery only where it's configured

        run_report.delay(run_id)
    elif background is not None:
        background.add_task(_run_inline, db.get_bind(), run_id)
    else:
        _run_inline(db.get_bind(), run_id)


def _start(db: Session, member: WorkspaceMember, user: AuthUser, body: ExportIn, name: str, report_id: str | None, background: BackgroundTasks) -> ReportRun:
    run = ReportRun(
        report_id=report_id, workspace_id=member.workspace_id, name=name, source=body.source, source_id=body.source_id,
        format=body.format, options=body.options.model_dump(mode="json"), requested_by=user.id,
    )
    db.add(run)
    db.commit()
    dispatch(db, run.id, background)
    return run


def _report(db: Session, member: WorkspaceMember, rid: str) -> Report:
    r = db.get(Report, rid)
    if r is None or r.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    return r


def _report_out(db: Session, r: Report, member: WorkspaceMember) -> ReportOut:
    last = db.scalar(select(ReportRun).where(ReportRun.report_id == r.id).order_by(ReportRun.created_at.desc()).limit(1))
    try:
        source_name = _source_name(db, member, r.source, r.source_id)
    except HTTPException:
        source_name = None
    return ReportOut(
        id=r.id, name=r.name, source=r.source, source_id=r.source_id, source_name=source_name, format=r.format,
        options=ReportOptions(**(r.options or {})), created_at=r.created_at, updated_at=r.updated_at,
        last_run=ReportRunOut.model_validate(last) if last else None,
    )


def _run(db: Session, member: WorkspaceMember, run_id: str) -> ReportRun:
    run = db.get(ReportRun, run_id)
    if run is None or run.workspace_id != member.workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report file not found")
    return run


def _file_response(run: ReportRun) -> Response:
    if run.status != "done" or not run.file_key:
        raise HTTPException(status.HTTP_409_CONFLICT, "This report isn't ready yet." if run.status != "failed" else "This report failed.")
    storage = get_storage()
    ext = run.file_key.rsplit(".", 1)[-1]
    media = MEDIA.get(ext) or mimetypes.guess_type(run.file_name or "")[0] or "application/octet-stream"
    filename = run.file_name or f"report.{ext}"
    path = storage.local_path(run.file_key)
    if path:
        return FileResponse(path, media_type=media, filename=filename)
    if get_settings().report_storage == "local":
        raise HTTPException(status.HTTP_410_GONE, "This file was deleted. Run the report again.")
    return StreamingResponse(storage.stream(run.file_key), media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def download_link(run: ReportRun) -> str:
    """A link that downloads this file without signing in, valid for 7 days (for emails)."""
    token = signing.sign("download", {"r": run.id}, DOWNLOAD_LINK_SECONDS)
    return f"{get_settings().app_url.rstrip('/')}/api/report-files/{token}"


# ---------- saved reports ----------


@router.get("/reports", response_model=list[ReportOut])
def list_reports(member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    rows = db.scalars(select(Report).where(Report.workspace_id == member.workspace_id).order_by(Report.updated_at.desc()))
    return [_report_out(db, r, member) for r in rows]


@router.post("/reports", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
def create_report(body: ReportIn, member: WorkspaceMember = Depends(current_membership), user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    _editor(member)
    _check(db, member, body)
    r = Report(workspace_id=member.workspace_id, name=body.name, source=body.source, source_id=body.source_id,
               format=body.format, options=body.options.model_dump(mode="json"), created_by=user.id)
    db.add(r)
    db.commit()
    return _report_out(db, r, member)


@router.get("/reports/{rid}", response_model=ReportOut)
def get_report(rid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _report_out(db, _report(db, member, rid), member)


@router.put("/reports/{rid}", response_model=ReportOut)
def update_report(rid: str, body: ReportIn, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    r = _report(db, member, rid)
    _check(db, member, body)
    r.name, r.source, r.source_id, r.format, r.options = body.name, body.source, body.source_id, body.format, body.options.model_dump(mode="json")
    db.commit()
    return _report_out(db, r, member)


@router.delete("/reports/{rid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(rid: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    _editor(member)
    r = _report(db, member, rid)
    # Its files stay in the history until they expire. Unlink them here rather than relying on
    # ON DELETE SET NULL, which SQLite (local dev) doesn't enforce.
    db.execute(update(ReportRun).where(ReportRun.report_id == r.id).values(report_id=None))
    db.delete(r)
    db.commit()


@router.post("/reports/{rid}/run", response_model=ReportRunOut, status_code=status.HTTP_202_ACCEPTED)
def run_report(rid: str, background: BackgroundTasks, member: WorkspaceMember = Depends(current_membership),
               user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    r = _report(db, member, rid)
    body = ExportIn(source=r.source, source_id=r.source_id, format=r.format, options=ReportOptions(**(r.options or {})))
    _check(db, member, body)
    return _start(db, member, user, body, r.name, r.id, background)


# ---------- quick exports and history ----------


@router.post("/exports", response_model=ReportRunOut, status_code=status.HTTP_202_ACCEPTED)
def quick_export(body: ExportIn, background: BackgroundTasks, member: WorkspaceMember = Depends(current_membership),
                 user: AuthUser = Depends(current_user), db: Session = Depends(get_db)):
    """Export now without saving a report (the dashboard and SQL Lab "Export" buttons)."""
    source_name = _check(db, member, body)
    return _start(db, member, user, body, body.name or source_name, None, background)


@router.get("/report-runs", response_model=list[ReportRunOut])
def list_runs(report_id: str | None = None, limit: int = Query(50, ge=1, le=200),
              member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    q = select(ReportRun).where(ReportRun.workspace_id == member.workspace_id)
    if report_id:
        q = q.where(ReportRun.report_id == report_id)
    return db.scalars(q.order_by(ReportRun.created_at.desc()).limit(limit)).all()


@router.get("/report-runs/{run_id}", response_model=ReportRunOut)
def get_run(run_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _run(db, member, run_id)


@router.get("/report-runs/{run_id}/download")
def download(run_id: str, member: WorkspaceMember = Depends(current_membership), db: Session = Depends(get_db)):
    return _file_response(_run(db, member, run_id))


@router.get("/report-files/{token}")
def signed_download(token: str, db: Session = Depends(get_db)):
    try:
        data = signing.verify("download", token)
    except signing.BadToken:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This download link has expired. Open the report in Vyuham to get the file.") from None
    run = db.get(ReportRun, data.get("r", ""))
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This file was deleted.")
    return _file_response(run)


# ---------- print page (rendered to PDF by the worker's browser) ----------


def _printed(db: Session, token: str) -> tuple[Dashboard, dict]:
    try:
        data = signing.verify("print", token)
    except signing.BadToken:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This print link has expired.") from None
    d = db.get(Dashboard, data.get("d", ""))
    if d is None or d.workspace_id != data.get("w"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dashboard not found")
    return d, data


@printer.get("/dashboards/{token}")
def print_dashboard(token: str, db: Session = Depends(get_db)):
    from app.routers.dashboards import _out

    d, _ = _printed(db, token)
    return _out(db, d, None)


@printer.get("/dashboards/{token}/view")
def print_view(token: str, db: Session = Depends(get_db)):
    """The view with the report's own period and filters; query parameters are ignored."""
    from app.routers.dashboards import _view

    d, data = _printed(db, token)
    date_from = date.fromisoformat(data["from"]) if data.get("from") else None
    date_to = date.fromisoformat(data["to"]) if data.get("to") else None
    out = _view(db, d, date_from, date_to, data.get("f") or {})
    return {**out.model_dump(mode="json"), "label": runner.period_label(date_from, date_to)}


@printer.get("/dashboards/{token}/filter-values/{column}")
def print_filter_values(token: str, column: str, db: Session = Depends(get_db)):
    _printed(db, token)
    return []  # the print page has no filter bar
