"""The public status page: a check of each component every minute, uptime history, incidents.

`run_checks` is called from the scheduler pass (the Celery beat `vyuham.tick`, or the in-process
thread without Redis). `summary` is what GET /status returns: the live state of each component,
90 days of daily uptime, and open plus recent incidents.

If the checks stop arriving, the scheduler itself is down, so "Background jobs" shows an outage.
"""

from __future__ import annotations

import logging
import threading
import time
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Incident, StatusCheck

log = logging.getLogger("app.status")

COMPONENTS: list[tuple[str, str]] = [
    ("api", "API"),
    ("database", "Database"),
    ("jobs", "Background jobs"),
    ("storage", "File storage"),
]
COMPONENT_IDS = {c for c, _ in COMPONENTS}
MIN_INTERVAL = timedelta(seconds=50)  # don't double-write when two passes overlap
STALE_AFTER = timedelta(minutes=5)  # no checks for this long = the scheduler is down
HISTORY_DAYS = 90
CACHE_SECONDS = 30
IMPACT_STATE = {"major": "major_outage", "minor": "degraded", "maintenance": "maintenance"}
STATE_RANK = {"operational": 0, "maintenance": 1, "degraded": 2, "major_outage": 3}


@dataclass
class Result:
    ok: bool
    latency_ms: int | None


def _timed(fn) -> Result:
    start = time.perf_counter()
    try:
        ok = bool(fn())
    except Exception:
        log.exception("status check failed")
        ok = False
    return Result(ok, int((time.perf_counter() - start) * 1000))


def _check_api() -> bool:
    url = get_settings().status_api_url
    if not url:
        return True  # this check runs inside the API process, so the API is up
    with urllib.request.urlopen(url.rstrip("/") + "/health/live", timeout=3) as resp:  # our own URL from config  # nosec B310
        return resp.status == 200


def _check_jobs() -> bool:
    from app.routers.health import _check_redis

    s = get_settings()
    # With Redis, the beat task that runs this check came through the queue, and Redis must answer.
    # Without it, jobs run on the API's own thread, which is the one running this check.
    return _check_redis(s.redis_url) if s.redis_url else True


def _check_storage() -> bool:
    from app.routers.health import _check_data_dir

    return _check_data_dir(get_settings().data_dir)


def run_checks(db: Session, now: datetime | None = None) -> int:
    """Check every component and store the results. Returns how many rows were written."""
    from app.routers.health import _check_db

    now = now or datetime.now(timezone.utc)
    last = db.scalar(select(func.max(StatusCheck.checked_at)))
    if last is not None and (last if last.tzinfo else last.replace(tzinfo=timezone.utc)) > now - MIN_INTERVAL:
        return 0
    results = {
        "api": _timed(_check_api),
        "database": _timed(lambda: _check_db(db)),
        "jobs": _timed(_check_jobs),
        "storage": _timed(_check_storage),
    }
    for component, r in results.items():
        db.add(StatusCheck(component=component, ok=r.ok, latency_ms=r.latency_ms, checked_at=now))
    if now.minute == 0:  # once an hour, drop history older than the retention window
        cutoff = now - timedelta(days=get_settings().status_retention_days)
        db.execute(delete(StatusCheck).where(StatusCheck.checked_at < cutoff))
    db.commit()
    _cache.clear()
    return len(results)


# --- The public summary ------------------------------------------------------------------------

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


def _as_utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def daily_uptime(db: Session, today: date) -> dict[str, dict[str, float]]:
    """{component: {"YYYY-MM-DD": percent ok}} for the last HISTORY_DAYS days (days with no data are absent)."""
    start = datetime.combine(today - timedelta(days=HISTORY_DAYS - 1), datetime.min.time(), tzinfo=timezone.utc)
    day = func.date(StatusCheck.checked_at)
    rows = db.execute(
        select(StatusCheck.component, day, func.count(), func.sum(case((StatusCheck.ok.is_(True), 1), else_=0)))
        .where(StatusCheck.checked_at >= start)
        .group_by(StatusCheck.component, day)
    ).all()
    out: dict[str, dict[str, float]] = {c: {} for c in COMPONENT_IDS}
    for component, d, total, ok in rows:
        if component in out and total:
            out[component][str(d)[:10]] = round(100.0 * (ok or 0) / total, 2)
    return out


def summary(db: Session, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    with _lock:
        hit = _cache.get("summary")
        if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
            return hit[1]
    data = _build_summary(db, now)
    with _lock:
        _cache["summary"] = (time.monotonic(), data)
    return data


def _build_summary(db: Session, now: datetime) -> dict:
    from app.routers.health import _check_db

    latest = {
        c: db.scalars(select(StatusCheck).where(StatusCheck.component == c).order_by(StatusCheck.checked_at.desc()).limit(1)).first()
        for c in COMPONENT_IDS
    }
    newest = max((_as_utc(r.checked_at) for r in latest.values() if r), default=None)
    stale = newest is None or newest < now - STALE_AFTER

    # Live where we can check right now; the stored result otherwise.
    live = {"api": True, "database": _check_db(db), "storage": _check_storage()}
    state: dict[str, str] = {}
    for c in COMPONENT_IDS:
        if c in live:
            ok = live[c]
        else:  # jobs: only the scheduler can vouch for itself
            row = latest.get(c)
            ok = (not stale) and row is not None and row.ok
        state[c] = "operational" if ok else "major_outage"

    active = db.scalars(
        select(Incident).where(Incident.status != "resolved").order_by(Incident.created_at.desc()).options(selectinload(Incident.updates))
    ).all()
    for inc in active:
        for c in inc.components or []:
            if c in state:
                worse = IMPACT_STATE.get(inc.impact, "degraded")
                if STATE_RANK[worse] > STATE_RANK[state[c]]:
                    state[c] = worse

    recent = db.scalars(
        select(Incident)
        .where(Incident.status == "resolved", Incident.created_at >= now - timedelta(days=14))
        .order_by(Incident.created_at.desc())
        .limit(10)
        .options(selectinload(Incident.updates))
    ).all()

    uptime = daily_uptime(db, now.date())
    overall = max(state.values(), key=lambda s: STATE_RANK[s]) if state else "operational"

    def pct(c: str) -> float | None:
        days = uptime.get(c) or {}
        return round(sum(days.values()) / len(days), 2) if days else None

    from app.support_schemas import IncidentOut

    return {
        "overall": overall,
        "updated_at": now.isoformat(),
        "checks_stale": stale,
        "components": [
            {"id": c, "name": name, "state": state[c], "uptime_90d": pct(c), "days": uptime.get(c, {})} for c, name in COMPONENTS
        ],
        "active_incidents": [IncidentOut.model_validate(i).model_dump(mode="json") for i in active],
        "recent_incidents": [IncidentOut.model_validate(i).model_dump(mode="json") for i in recent],
    }


def invalidate() -> None:
    with _lock:
        _cache.clear()
