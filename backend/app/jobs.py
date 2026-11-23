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

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.alerts import SCHEDULE_EVERY, _aware, alert_due, automation_due, check_alert, last_occurrence, run_automation
from app.models import Alert, AuditLog, Automation, Dataset, JobRun, QueryExecution
from app.query import QueryError
from app.sync import SyncError, next_sync_at, sync_dataset, sync_slot
from app.telemetry import count, record, span

log = logging.getLogger("app.jobs")

ALERT, AUTOMATION, SYNC, QUALITY = "alert", "automation", "sync", "quality"
# Pipelines: a scheduled slot of a pipeline, or one queued run. Dynamic tables: a due table, or one queued refresh.
PIPELINE, PIPELINE_RUN, DYNAMIC, DYNAMIC_REFRESH = "pipeline", "pipeline_run", "dynamic", "dynamic_refresh"
FINISHED = ("done", "failed")
# Longer than a job can legitimately take with all its retries (4 x 6 minutes plus backoff).
STALE_AFTER = timedelta(minutes=45)
RETRY_FAILED_AFTER = timedelta(hours=1)


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
    synced = select(Dataset).where(Dataset.refresh.in_(("hourly", "daily")))
    for ds in db.scalars(synced).all():
        at = next_sync_at(ds)
        if at is not None and at <= now:
            due.append(Due(SYNC, ds.id, _second(sync_slot(at, now))))
    due.extend(_quality_due(db, now))
    due.extend(_pipelines_due(db, now))
    due.extend(_dynamic_due(db, now))
    return due


def _pipelines_due(db: Session, now: datetime) -> list[Due]:
    from app.models import Pipeline
    from app.pipelines import schedule_slot

    out = []
    for p in db.scalars(select(Pipeline).where(Pipeline.enabled.is_(True), Pipeline.schedule != "manual")).all():
        if p.generated_by_ai and p.approved_at is None:
            continue  # AI-generated pipelines run only after approval
        slot = schedule_slot(p, now)
        created = _aware(p.created_at)
        if slot is not None and (created is None or slot > created):
            out.append(Due(PIPELINE, p.id, _second(slot)))
    return out


def _dynamic_due(db: Session, now: datetime) -> list[Due]:
    from app.dynamic_tables import find_due as dynamic_due

    out = []
    for t, trigger in dynamic_due(db, now):
        # A slot that stays the same until the table has refreshed, so a busy queue doesn't double it up.
        anchor = _aware(t.next_refresh_at) if trigger in ("schedule", "retry") else _aware(t.last_refresh_at)
        out.append(Due(DYNAMIC, t.id, _second(anchor or now)))
    return out


def dispatch(db: Session, d: Due, background=None) -> JobRun | None:
    """Claim a job and hand it to the worker (Celery), or run it after the response when there's no Redis."""
    from app.config import get_settings

    run = claim(db, d)
    if run is None:
        return None
    if get_settings().redis_url:
        from app.worker import run_job as task

        task.delay(run.id)
    elif background is not None:
        from app.routers.datasets import _run_job_inline

        background.add_task(_run_job_inline, db.get_bind(), run.id)
    return run


def _quality_due(db: Session, now: datetime) -> list[Due]:
    """Datasets with checks get them run once a day even when nothing refreshes them (freshness rules)."""
    from sqlalchemy import func

    from app.models import QualityRule, QualityRun

    checked = select(QualityRule.dataset_id, func.min(QualityRule.created_at)).where(QualityRule.enabled.is_(True)).group_by(QualityRule.dataset_id)
    last = dict(db.execute(select(QualityRun.dataset_id, func.max(QualityRun.created_at)).group_by(QualityRun.dataset_id)).all())
    out = []
    for ds_id, first in db.execute(checked).all():
        since = _aware(last.get(ds_id)) or _aware(first) or now
        at = since + timedelta(days=1)
        if at <= now:
            out.append(Due(QUALITY, ds_id, _second(at)))
    return out


def sync_now(db: Session, ds: Dataset, now: datetime | None = None) -> JobRun | None:
    """Claim an immediate sync ("Refresh now"); None when one is already claimed for this second."""
    return claim(db, Due(SYNC, ds.id, _second(now or datetime.now(timezone.utc))))


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


def reclaim(db: Session, d: Due, now: datetime) -> JobRun | None:
    """A claimed job that will never finish by itself, ready to queue again.

    Redis keeps nothing across a restart and a worker can die, while the claim stays in Postgres. An alert's
    slot doesn't move until the alert has run, so without this one lost message would silence it for good.
    """
    if d.kind == SYNC:  # sync slots already move on by themselves (sync_slot)
        return None
    run = db.scalar(select(JobRun).where(JobRun.kind == d.kind, JobRun.target_id == d.target_id, JobRun.scheduled_for == d.scheduled_for))
    if run is None or run.status == "done":
        return None
    if run.status == "failed":
        finished = _aware(run.finished_at)
        if finished is None or now - finished < RETRY_FAILED_AFTER:
            return None
    else:
        last_activity = _aware(run.started_at) or _aware(run.created_at)
        if last_activity is None or now - last_activity < STALE_AFTER:
            return None
    log.warning("requeueing job %s (%s), last status %s", run.id, run.kind, run.status)
    run.status, run.finished_at = "queued", None
    db.commit()
    return run


def run_job(db: Session, job_id: str, now: datetime | None = None) -> JobRun | None:
    """Run one claimed job (see `_run_job`). Traced as `vyuham.job` with its kind, status, attempts and lag."""
    with span("vyuham.job") as s:
        try:
            run = _run_job(db, job_id, now)
        except Exception:
            failed = db.get(JobRun, job_id)
            count("vyuham.jobs", kind=failed.kind if failed else "unknown", status="retry")
            raise
        if run is not None:
            s.set_attribute("vyuham.job.kind", run.kind)
            s.set_attribute("vyuham.job.status", run.status)
            s.set_attribute("vyuham.job.attempts", run.attempts)
            count("vyuham.jobs", kind=run.kind, status=run.status)
            started, scheduled = _aware(run.started_at), _aware(run.scheduled_for)
            if started and scheduled:
                lag = max(0.0, (started - scheduled).total_seconds())
                s.set_attribute("vyuham.job.lag_seconds", round(lag, 3))
                record("vyuham.job.lag", lag, kind=run.kind)
        return run


def _run_job(db: Session, job_id: str, now: datetime | None = None) -> JobRun | None:
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
        if run.kind in (PIPELINE, PIPELINE_RUN, DYNAMIC, DYNAMIC_REFRESH):
            run.status, run.error = _run_platform_job(db, run)
            run.finished_at = datetime.now(timezone.utc)
            db.commit()
            return run
        if run.kind == QUALITY:
            from app.quality import run_checks

            ds = db.get(Dataset, run.target_id)
            result = run_checks(db, ds, "schedule", now) if ds is not None else None
            run.status, run.error = "done", None if result is None or result.status != "error" else "Checks could not run."
            run.finished_at = datetime.now(timezone.utc)
            db.commit()
            return run
        if run.kind == SYNC:
            from app.materialize import MaterializeError, rebuild
            from app.quality import run_checks
            from app.sync import rebuilt

            ds = db.get(Dataset, run.target_id)
            if ds is None:
                run.status, run.error = "done", "Skipped: dataset deleted."
            elif rebuilt(ds):
                try:
                    rebuild(db, ds, "schedule")
                    run.status, run.error = "done", None
                except (MaterializeError, QueryError) as e:  # recorded on the dataset, not retried
                    run.status, run.error = "failed", str(e)[:500]
            else:
                try:
                    sync_dataset(db, ds, now)
                    run_checks(db, ds, "refresh", now)
                    run.status, run.error = "done", None
                except SyncError as e:  # the customer's to fix: recorded on the dataset, not retried
                    run.status, run.error = "failed", str(e)[:500]
            run.finished_at = datetime.now(timezone.utc)
            db.commit()
            return run
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


def _run_platform_job(db: Session, job: JobRun) -> tuple[str, str | None]:
    """Pipelines and dynamic tables. Their own failures are recorded on the run or refresh, so the job is done."""
    from app import dynamic_tables, pipelines
    from app.models import DynamicRefresh, DynamicTable, Pipeline, PipelineRun

    if job.kind == PIPELINE:
        p = db.get(Pipeline, job.target_id)
        if p is None or not p.enabled:
            return "done", "Skipped: deleted or paused."
        run = pipelines.execute(db, pipelines.start_run(db, p, "schedule", p.created_by))
        return ("done", None) if run.status == "success" else ("failed", run.error)
    if job.kind == PIPELINE_RUN:
        run = db.get(PipelineRun, job.target_id)
        if run is None:
            return "done", "Skipped: run deleted."
        run = pipelines.execute(db, run)
        return ("done", None) if run.status == "success" else ("failed", run.error)
    if job.kind == DYNAMIC:
        t = db.get(DynamicTable, job.target_id)
        if t is None or t.paused:
            return "done", "Skipped: deleted or paused."
        trigger = "retry" if t.failures else ("upstream" if t.on_upstream_change and not _is_time_due(t) else "schedule")
        r = dynamic_tables.refresh(db, t, dynamic_tables.queue_refresh(db, t, trigger))
        return ("done", None) if r.status == "success" else ("failed", r.error)
    r = db.get(DynamicRefresh, job.target_id)
    t = db.get(DynamicTable, r.table_id) if r is not None else None
    if r is None or t is None:
        return "done", "Skipped: deleted."
    if r.status not in ("queued",):
        return "done", None
    r = dynamic_tables.refresh(db, t, r)
    return ("done", None) if r.status == "success" else ("failed", r.error)


def _is_time_due(t) -> bool:
    nxt = _aware(t.next_refresh_at)
    return nxt is not None and nxt <= datetime.now(timezone.utc)


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


RETENTION_TARGETS = {
    "audit_days": "audit", "query_history_days": "queries", "run_history_days": "runs", "ai_history_days": "ai",
}
MIN_RETENTION_DAYS = 7


def apply_retention(db: Session, now: datetime) -> int:
    """Workspace retention policies (Governance Center): delete history older than each workspace allows."""
    from app.models import AiAction, DynamicRefresh, GovernancePolicy, PipelineRun

    deleted = 0
    for pol in db.scalars(select(GovernancePolicy).where(GovernancePolicy.kind == "retention", GovernancePolicy.enabled.is_(True))).all():
        rules = pol.rules or {}
        ws = pol.workspace_id
        for key in RETENTION_TARGETS:
            days = rules.get(key)
            if not isinstance(days, int) or days <= 0:
                continue
            cutoff = now - timedelta(days=max(MIN_RETENTION_DAYS, days))
            if key == "audit_days":
                stmts = [delete(AuditLog).where(AuditLog.workspace_id == ws, AuditLog.created_at < cutoff)]
            elif key == "query_history_days":
                stmts = [delete(QueryExecution).where(QueryExecution.workspace_id == ws, QueryExecution.created_at < cutoff)]
            elif key == "run_history_days":
                stmts = [delete(PipelineRun).where(PipelineRun.workspace_id == ws, PipelineRun.created_at < cutoff),
                         delete(DynamicRefresh).where(DynamicRefresh.workspace_id == ws, DynamicRefresh.created_at < cutoff)]
            else:
                stmts = [delete(AiAction).where(AiAction.workspace_id == ws, AiAction.created_at < cutoff)]
            for st in stmts:
                deleted += db.execute(st).rowcount or 0
    db.commit()
    return deleted


def prune(db: Session, now: datetime | None = None, keep_days: int = 30) -> int:
    """Delete finished job rows older than `keep_days`; returns how many."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=keep_days)
    old = db.scalars(select(JobRun).where(JobRun.created_at < cutoff, JobRun.status.in_(FINISHED))).all()
    for r in old:
        db.delete(r)
    db.execute(delete(QueryExecution).where(QueryExecution.created_at < cutoff))
    db.execute(delete(AuditLog).where(AuditLog.created_at < (now or datetime.now(timezone.utc)) - timedelta(days=365)))
    db.commit()
    apply_retention(db, now or datetime.now(timezone.utc))
    from app.config import get_settings
    from app.pipelines import prune_run_dirs

    prune_run_dirs(get_settings().data_dir)
    from app.routers.support import prune_attachments  # support uploads never sent with a message

    prune_attachments(db, now)
    return len(old)


def tick(db: Session, now: datetime | None = None, enqueue: Callable[[str], None] | None = None) -> dict:
    """One scheduler pass. With `enqueue`, claimed jobs are handed to it; otherwise they run here."""
    now = now or datetime.now(timezone.utc)
    counts = {"alerts_checked": 0, "automations_run": 0, "datasets_synced": 0, "skipped": 0}
    label = {ALERT: "alerts_checked", AUTOMATION: "automations_run", SYNC: "datasets_synced"}
    for d in find_due(db, now):
        run = claim(db, d) or reclaim(db, d, now)
        if run is None:
            counts["skipped"] += 1
            continue
        key = label.get(d.kind, "platform_jobs")
        counts[key] = counts.get(key, 0) + 1
        if enqueue is not None:
            enqueue(run.id)
            continue
        try:
            run_job(db, run.id, now)
        except Exception as e:  # one bad job must not stop the rest of the pass
            log.exception("job %s (%s %s) failed", run.id, d.kind, d.target_id)
            mark_failed(db, run.id, e)
    return counts
