"""Evaluate alerts and run automations. Called by background jobs (app/jobs.py) and by
"Check now" / "Run now" in the app.

Alerts are edge-triggered: they notify when the condition becomes true and stay quiet until it
clears, so a metric sitting below its threshold doesn't send a message every hour.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.insights import compact, metric_label, pct_change
from app.models import Alert, AlertEvent, Automation, Dashboard, Dataset
from app.notify import deliver
from app.query import Filters, QueryError, connect, metric_key, run_spec

CONDITION_TEXT = {"above": "is above", "below": "is below", "change_up": "rose by at least", "change_down": "fell by at least"}
SCHEDULE_EVERY = {"hourly": timedelta(hours=1), "daily": timedelta(days=1), "weekly": timedelta(days=7)}


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def alert_due(a: Alert, now: datetime) -> bool:
    last = _aware(a.last_checked_at)
    return last is None or now - last >= SCHEDULE_EVERY.get(a.schedule, timedelta(days=1))


def _windows(a: Alert, today: date) -> tuple[Filters | None, Filters | None]:
    if not a.date_field or a.window_days <= 0:
        return None, None
    lo = today - timedelta(days=a.window_days - 1)
    cur = Filters(a.date_field, lo, today)
    prev = Filters(a.date_field, lo - timedelta(days=a.window_days), lo - timedelta(days=1))
    return cur, prev


def measure(db: Session, a: Alert, today: date) -> tuple[float | None, float | None]:
    """(value now, value in the previous window). Raises QueryError on a broken definition."""
    ds = db.get(Dataset, a.dataset_id) if a.dataset_id else None
    if ds is None:
        raise QueryError("The dataset behind this alert was deleted.")
    spec = {"dataset": ds.id, "metrics": [a.metric], "filters": a.filters or [], "chartType": "kpi", "title": a.name}
    cur, prev = _windows(a, today)
    con = connect(ds.workspace_id, [ds])
    try:
        key = metric_key(a.metric)
        value = run_spec(con, spec, ds, cur)[0].get(key)
        before = run_spec(con, spec, ds, prev)[0].get(key) if prev else None
    finally:
        con.close()
    return value, before


def is_met(a: Alert, value: float | None, before: float | None) -> bool:
    if value is None:
        return False
    if a.condition == "above":
        return value > a.threshold
    if a.condition == "below":
        return value < a.threshold
    change = pct_change(value, before)
    if change is None:
        return False
    return change >= a.threshold if a.condition == "change_up" else change <= -a.threshold


def describe_alert(a: Alert, value: float | None, before: float | None) -> str:
    label = metric_label(a.metric)
    window = f" over the last {a.window_days} days" if a.date_field and a.window_days > 0 else ""
    if a.condition in ("change_up", "change_down"):
        change = pct_change(value, before)
        moved = f"{'up' if (change or 0) >= 0 else 'down'} {abs(change or 0):.0f}%"
        return f"{label}{window} is {compact(value)}, {moved} on the period before ({compact(before)}). Rule: {CONDITION_TEXT[a.condition]} {a.threshold:g}%."
    return f"{label}{window} is {compact(value)}. Rule: {CONDITION_TEXT[a.condition]} {compact(a.threshold)}."


def check_alert(db: Session, a: Alert, now: datetime | None = None, force_notify: bool = False) -> AlertEvent | None:
    """Measure, update state, and notify on a new breach (or always, for a test send)."""
    now = now or datetime.now(timezone.utc)
    a.last_checked_at = now
    try:
        value, before = measure(db, a, now.date())
    except QueryError as e:
        a.state, a.last_error = "error", str(e)[:500]
        db.commit()
        return None
    a.last_value, a.last_error = value, None
    met = is_met(a, value, before)
    event = None
    if (met and a.state != "triggered") or force_notify:
        title = f"{'Test: ' if force_notify and not met else ''}Alert · {a.name}"
        body = describe_alert(a, value, before)
        delivery = deliver(db, a.workspace_id, a.channels or {}, title, body, "/alerts", "alert")
        event = AlertEvent(workspace_id=a.workspace_id, alert_id=a.id, title=title, body=body, value=value, delivery=delivery)
        db.add(event)
        if met:
            a.last_triggered_at = now
    a.state = "triggered" if met else "ok"
    db.commit()
    return event


# ---------- automations ----------


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def last_occurrence(a: Automation, now: datetime) -> datetime:
    """The most recent scheduled time at or before `now` (in the automation's time zone)."""
    local = now.astimezone(_zone(a.timezone))
    at = local.replace(hour=a.hour, minute=0, second=0, microsecond=0)
    if a.schedule == "monthly":
        at = at.replace(day=1)
        if at > local:
            at = (at - timedelta(days=1)).replace(day=1)
    elif a.schedule == "weekly":
        at -= timedelta(days=(at.weekday() - a.weekday) % 7)
        if at > local:
            at -= timedelta(days=7)
    elif at > local:
        at -= timedelta(days=1)
    return at.astimezone(timezone.utc)


def automation_due(a: Automation, now: datetime) -> bool:
    occ = last_occurrence(a, now)
    created = _aware(a.created_at) or now
    last = _aware(a.last_run_at)
    return occ >= created and (last is None or last < occ)


PREVIEW_ROWS = 10
PREVIEW_CELL = 40


def _cell(v) -> str:
    text = "" if v is None else str(v)
    return text if len(text) <= PREVIEW_CELL else text[: PREVIEW_CELL - 1] + "…"


def run_saved_query(db: Session, a: Automation, now: datetime) -> AlertEvent:
    """A scheduled SQL Lab query: export it (CSV or Excel), then send a short preview and a download link.

    Uses the report runner, so the file is stored, listed under Reports and pruned like any other report.
    With `only_if_rows`, an empty result sends nothing (it's still logged in the automation's history).
    """
    from app.models import ReportRun, SavedQuery
    from app.reports import runner, tabular
    from app.routers.reports import DOWNLOAD_LINK_SECONDS, download_link

    q = db.get(SavedQuery, a.saved_query_id) if a.saved_query_id else None
    if q is None or q.workspace_id != a.workspace_id:
        a.last_run_at, a.last_status = now, "The saved query was deleted."
        db.commit()
        raise QueryError("The saved query was deleted.")
    opts = a.options or {}
    fmt = opts.get("format") if opts.get("format") in ("csv", "xlsx") else "csv"

    run = ReportRun(
        workspace_id=a.workspace_id, name=q.name, source="saved_query", source_id=q.id, format=fmt, options={},
        trigger="schedule", automation_id=a.id, requested_by=a.created_by,
    )
    db.add(run)
    db.commit()
    run = runner.generate(db, run.id)  # unexpected errors propagate, so the job is retried
    if run is None or run.status != "done":
        reason = (run.error if run else None) or "The export failed."
        a.last_run_at, a.last_status = now, f"Failed: {reason}"[:500]
        db.commit()
        raise QueryError(reason)

    rows = run.rows or 0
    title = f"{q.name} · {now.astimezone(_zone(a.timezone)):%b %d, %H:%M}"
    if rows == 0 and opts.get("only_if_rows"):
        event = AlertEvent(workspace_id=a.workspace_id, automation_id=a.id, title=title, body="No rows; nothing was sent.", delivery={})
        db.add(event)
        a.last_run_at, a.last_status = now, "No rows; nothing sent"
        db.commit()
        return event

    # The first rows, as plain text lines, so the email is useful without opening the file.
    sql, params, datasets, _ = tabular._query_source(db, "saved_query", q.id, a.workspace_id)
    con = connect(a.workspace_id, datasets)
    try:
        from app.query import _run

        names, sample = _run(con, f"SELECT * FROM ({sql}) AS q LIMIT {PREVIEW_ROWS}", params, op="schedule")  # validated SELECT, bound params  # nosec B608
    finally:
        con.close()
    lines = [" | ".join(names)] + [" | ".join(_cell(v) for v in r) for r in sample]
    more = f"\n…and {rows - len(sample):,} more rows in the file." if rows > len(sample) else ""
    days = DOWNLOAD_LINK_SECONDS // 86400
    body = (
        f"{rows:,} rows.\n\n" + "\n".join(lines) + more
        + f"\n\nDownload the full {fmt.upper()} (link works for {days} days): {download_link(run)}"
    )
    delivery = deliver(db, a.workspace_id, a.channels or {}, title, body, "/reports", "digest")
    event = AlertEvent(workspace_id=a.workspace_id, automation_id=a.id, title=title, body=body, delivery=delivery)
    db.add(event)
    a.last_run_at, a.last_status = now, f"Sent ({rows:,} rows)"
    db.commit()
    return event


def run_automation(db: Session, a: Automation, now: datetime | None = None) -> AlertEvent:
    from app.routers.dashboards import _view  # local import: routers import this module's siblings

    now = now or datetime.now(timezone.utc)
    if a.kind == "saved_query":
        return run_saved_query(db, a, now)
    d = db.get(Dashboard, a.dashboard_id) if a.dashboard_id else None
    if d is None:
        a.last_run_at, a.last_status = now, "The dashboard was deleted."
        db.commit()
        raise QueryError("The dashboard was deleted.")
    today = now.astimezone(_zone(a.timezone)).date()
    start = today - timedelta(days=a.period_days - 1)
    view = _view(db, d, start, today, {})
    by_id = {c.id: c for c in view.charts}
    lines = []
    for c in d.charts:
        v = by_id.get(c.id)
        if v and v.insight:
            lines.append(f"• {v.insight.headline}" + (f" — {v.insight.note}" if c.kind == "card" and v.insight.note else ""))
        elif v and v.error:
            lines.append(f"• {c.spec.get('title')}: {v.error}")
    title = f"{d.name} · {start:%b %d} – {today:%b %d}"
    body = "\n".join(lines[:12]) or "No charts on this dashboard yet."
    delivery = deliver(db, a.workspace_id, a.channels or {}, title, body, f"/dashboards/{d.id}", "digest")
    event = AlertEvent(workspace_id=a.workspace_id, automation_id=a.id, title=title, body=body, delivery=delivery)
    db.add(event)
    a.last_run_at, a.last_status = now, "Sent"
    db.commit()
    return event


def tick(db: Session, now: datetime | None = None) -> dict:
    """One scheduler pass, running due jobs here. The worker uses app.jobs.tick to queue them."""
    from app.jobs import tick as jobs_tick  # local import: app.jobs imports this module

    return jobs_tick(db, now)
