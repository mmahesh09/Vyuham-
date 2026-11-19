"""Run one ReportRun: build the file, store it, record the outcome.

Called by the Celery task `vyuham.run_report` (app/worker.py), or in-process after the response
when there's no Redis (local dev). Like app/jobs.py, a problem the user can fix (deleted source,
bad query, too many rows) fails the run without retrying; anything else is left as "retry" and
re-raised so the worker can try again, and `mark_failed` ends it.
"""

from __future__ import annotations

import logging
import os
import tempfile
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import signing
from app.models import Dashboard, ReportRun
from app.query import QueryError
from app.reports import pdf, tabular
from app.reports.storage import get_storage
from app.telemetry import count, span, timed

log = logging.getLogger("app.reports")

FINISHED = ("done", "failed")
EXT = {"pdf": "pdf", "csv": "csv", "xlsx": "xlsx"}
PRINT_TOKEN_SECONDS = 10 * 60
STALE_AFTER = timedelta(hours=1)  # longer than a report can take with its retries


def period(options: dict, today: date | None = None) -> tuple[date | None, date | None]:
    """The date range a dashboard report covers: a fixed range, the last `period_days` days, or all time."""
    if options.get("date_from") and options.get("date_to"):
        return date.fromisoformat(options["date_from"]), date.fromisoformat(options["date_to"])
    days = options.get("period_days")
    if not days:
        return None, None
    today = today or datetime.now(timezone.utc).date()
    return today - timedelta(days=int(days) - 1), today


def period_label(date_from: date | None, date_to: date | None) -> str:
    return f"{date_from:%b %d, %Y} – {date_to:%b %d, %Y}" if date_from and date_to else "All time"


def print_token(d: Dashboard, options: dict) -> str:
    date_from, date_to = period(options)
    data = {
        "d": d.id,
        "w": d.workspace_id,
        "from": date_from.isoformat() if date_from else None,
        "to": date_to.isoformat() if date_to else None,
        "f": options.get("filters") or {},
    }
    return signing.sign("print", data, PRINT_TOKEN_SECONDS)


def _dashboard(db: Session, run: ReportRun) -> Dashboard:
    d = db.get(Dashboard, run.source_id)
    if d is None or d.workspace_id != run.workspace_id:
        raise QueryError("The dashboard behind this report was deleted.")
    return d


def _build(db: Session, run: ReportRun, out_dir: str) -> tabular.Built:
    opts = run.options or {}
    if run.source == "dashboard":
        d = _dashboard(db, run)
        if run.format == "pdf":
            path = f"{out_dir}/report.pdf"
            pdf.render_dashboard_pdf(
                print_token(d, opts), path,
                landscape=opts.get("orientation") == "landscape",
                page_size=opts.get("page_size") or "A4",
            )
            name = tabular.safe_name(run.name, "dashboard")
            return tabular.Built(path, f"{name}.pdf", 0)
        date_from, date_to = period(opts)
        tables, headlines = tabular.dashboard_tables(db, d, date_from, date_to, opts.get("filters") or {})
        if run.format == "csv":
            return tabular.dashboard_csv(tables, run.name, out_dir)
        return tabular.dashboard_xlsx(tables, headlines, run.name, period_label(date_from, date_to), out_dir)
    if run.format == "pdf":
        raise QueryError("PDF reports are for dashboards. Use CSV or Excel for queries and datasets.")
    return tabular.query_export(db, run.source, run.source_id, run.workspace_id, run.format, out_dir, run.name)


def generate(db: Session, run_id: str) -> ReportRun | None:
    """Build one report file. Traced as `vyuham.report.render`: format, rows, size and outcome only."""
    with span("vyuham.report.render") as s, timed("vyuham.report.duration") as m:
        try:
            run = _generate(db, run_id)
        except Exception:
            m["outcome"] = "retry"
            count("vyuham.report.renders", outcome="retry")
            raise
        if run is not None:
            s.set_attribute("vyuham.workspace_id", run.workspace_id)
            s.set_attribute("vyuham.report.format", run.format)
            s.set_attribute("vyuham.report.source", run.source)
            s.set_attribute("vyuham.report.status", run.status)
            if run.rows is not None:
                s.set_attribute("vyuham.report.rows", run.rows)
            if run.size_bytes is not None:
                s.set_attribute("vyuham.report.bytes", run.size_bytes)
            m["format"], m["outcome"] = run.format, run.status
            count("vyuham.report.renders", format=run.format, outcome=run.status)
        return run


def _generate(db: Session, run_id: str) -> ReportRun | None:
    run = db.get(ReportRun, run_id)
    if run is None or run.status in FINISHED:
        return run
    run.status, run.started_at, run.error = "running", datetime.now(timezone.utc), None
    db.commit()
    try:
        with tempfile.TemporaryDirectory(prefix="vyuham-report-") as tmp:
            built = _build(db, run, tmp)
            ext = built.file_name.rsplit(".", 1)[-1]
            key = f"{run.workspace_id}/{run.id}.{ext}"
            get_storage().put(key, built.path)
            run.size_bytes = os.path.getsize(built.path)
        run.file_key, run.file_name, run.rows = key, built.file_name, built.rows
        run.status = "done"
    except QueryError as e:
        db.rollback()
        run = db.get(ReportRun, run_id)
        run.status, run.error = "failed", str(e)[:500]
    except Exception as e:
        db.rollback()
        run = db.get(ReportRun, run_id)
        if run is not None:
            log.warning("report run %s will retry after %s", run_id, type(e).__name__)
            run.status, run.error = "retry", "A temporary problem interrupted this report. Trying again."
            db.commit()
        raise
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    return run


def mark_failed(db: Session, run_id: str, error: BaseException | str) -> None:
    db.rollback()
    run = db.get(ReportRun, run_id)
    if run is None or run.status in FINISHED:
        return
    run.status = "failed"
    run.error = (error if isinstance(error, str) else "Couldn't generate the report. Try again in a few minutes.")[:500]
    run.finished_at = datetime.now(timezone.utc)
    db.commit()


def fail_stale(db: Session, now: datetime | None = None) -> int:
    """End runs whose queue message was lost, so nobody watches a spinner forever."""
    cutoff = (now or datetime.now(timezone.utc)) - STALE_AFTER
    stale = db.scalars(select(ReportRun).where(ReportRun.status.not_in(FINISHED), ReportRun.created_at < cutoff)).all()
    for run in stale:
        run.status, run.finished_at = "failed", now or datetime.now(timezone.utc)
        run.error = "This report didn't finish. Please run it again."
    db.commit()
    return len(stale)


def prune(db: Session, keep_days: int, now: datetime | None = None) -> int:
    """Delete runs (and their files) older than `keep_days`."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=keep_days)
    old = db.scalars(select(ReportRun).where(ReportRun.created_at < cutoff)).all()
    storage = get_storage()
    for r in old:
        if r.file_key:
            try:
                storage.delete(r.file_key)
            except Exception:
                log.exception("couldn't delete report file %s", r.file_key)
        db.delete(r)
    db.commit()
    return len(old)
