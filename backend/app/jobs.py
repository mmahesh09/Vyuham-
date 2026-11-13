"""Background jobs: find what's due, claim it, run it.

Nothing here depends on Celery. The Celery worker (app/worker.py) calls `tick` with an `enqueue`
that puts each claimed job on the queue; without Redis (local dev, tests) `tick` runs each job
straight away.

A job is claimed by inserting a JobRun row whose (kind, target_id, scheduled_for) is unique. The
slot is worked out from the alert's or automation's own state, so it stays the same until the
job has actually run: a second scheduler pass, or a pass while the job is still waiting in the
queue, finds the slot taken and does nothing.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.alerts import SCHEDULE_EVERY, _aware, alert_due, automation_due, check_alert, last_occurrence, run_automation
from app.models import Alert, Automation, JobRun
from app.query import QueryError

log = logging.getLogger("app.jobs")

ALERT, AUTOMATION = "alert", "automation"
FINISHED = ("done", "failed")


@dataclass(frozen=True)
class Due:
    kind: str
    target_id: str
    scheduled_for: datetime


def _second(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(microsecond=0)


def alert_slot(a: Alert, now: datetime) -> datetime:
    """When this alert's next check was due: one interval after the last check."""
    last = _aware(a.last_checked_at)
    if last is None:
        return _second(_aware(a.created_at) or now)
    return _second(last + SCHEDULE_EVERY.get(a.schedule, timedelta(days=1)))


def find_due(db: Session, now: datetime) -> list[Due]:
    due: list[Due] = []
    for a in db.scalars(select(Alert).where(Alert.enabled.is_(True))).all():
        if alert_due(a, now):
            due.append(Due(ALERT, a.id, alert_slot(a, now)))
    for a in db.scalars(select(Automation).where(Automation.enabled.is_(True))).all():
        if automation_due(a, now):
            due.append(Due(AUTOMATION, a.id, _second(last_occurrence(a, now))))
    return due


def claim(db: Session, d: Due) -> JobRun | None:
    """The new JobRun, or None when this slot was already claimed."""
    run = JobRun(kind=d.kind, target_id=d.target_id, scheduled_for=d.scheduled_for)
    db.add(run)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return run


def run_job(db: Session, job_id: str, now: datetime | None = None) -> JobRun | None:
    """Run one claimed job. Safe to call again for the same job (e.g. a redelivered message).

    A broken definition (deleted dataset, bad filter) is the user's to fix, so it is recorded and
    not retried. Anything else (database or network trouble) is recorded and re-raised so the
    worker can retry it.
    """
    run = db.get(JobRun, job_id)
    if run is None or run.status in FINISHED:
        return run
    run.status, run.attempts, run.started_at = "running", run.attempts + 1, datetime.now(timezone.utc)
    db.commit()
    try:
        target = db.get(Alert if run.kind == ALERT else Automation, run.target_id)
        if target is None or not target.enabled:
            run.status, run.error = "done", "Skipped: deleted or paused."
        elif run.kind == ALERT:
            check_alert(db, target, now)
            run.status, run.error = ("failed", target.last_error) if target.state == "error" else ("done", None)
        else:
            try:
                run_automation(db, target, now)
                run.status, run.error = "done", None
            except QueryError as e:
                run.status, run.error = "failed", str(e)[:500]
    except Exception as e:
        db.rollback()
        run = db.get(JobRun, job_id)
        if run is not None:  # left runnable: the worker retries it, mark_failed ends it
            run.status, run.error = "retry", _describe(e)
            db.commit()
        raise
    run.finished_at = datetime.now(timezone.utc)
    db.commit()
    return run


def _describe(e: BaseException) -> str:
    return f"{type(e).__name__}: {e}"[:500]


def mark_failed(db: Session, job_id: str, error: BaseException | str) -> None:
    """Give up on a job (retries used up, or no retries when running in-process)."""
    db.rollback()
    run = db.get(JobRun, job_id)
    if run is None or run.status in FINISHED:
        return
    run.status = "failed"
    run.error = error if isinstance(error, str) else _describe(error)
    run.finished_at = datetime.now(timezone.utc)
    db.commit()


def prune(db: Session, now: datetime | None = None, keep_days: int = 30) -> int:
    """Delete finished job rows older than `keep_days`; returns how many."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=keep_days)
    old = db.scalars(select(JobRun).where(JobRun.created_at < cutoff, JobRun.status.in_(FINISHED))).all()
    for r in old:
        db.delete(r)
    db.commit()
    return len(old)


def tick(db: Session, now: datetime | None = None, enqueue: Callable[[str], None] | None = None) -> dict:
    """One scheduler pass. With `enqueue`, claimed jobs are handed to it; otherwise they run here."""
    now = now or datetime.now(timezone.utc)
    counts = {"alerts_checked": 0, "automations_run": 0, "skipped": 0}
    for d in find_due(db, now):
        run = claim(db, d)
        if run is None:
            counts["skipped"] += 1
            continue
        counts["alerts_checked" if d.kind == ALERT else "automations_run"] += 1
        if enqueue is not None:
            enqueue(run.id)
            continue
        try:
            run_job(db, run.id, now)
        except Exception as e:  # one bad job must not stop the rest of the pass
            log.exception("job %s (%s %s) failed", run.id, d.kind, d.target_id)
            mark_failed(db, run.id, e)
    return counts
