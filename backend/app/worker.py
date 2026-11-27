"""The Celery app: background jobs on a worker process, fed through Redis.

    celery -A app.worker worker   # runs jobs
    celery -A app.worker beat     # one process only: queues `tick` every minute
    celery -A app.worker flower   # queue dashboard

Schedules live in the database, not in Beat: Beat only sends `tick`, and `tick` claims each due
job (app/jobs.py) and queues it. Editing an alert or automation takes effect on the next tick.
"""

from __future__ import annotations

import logging

from celery import Celery, Task
from celery.signals import worker_process_init
from sqlalchemy.exc import DBAPIError, OperationalError

from app import jobs
from app.config import get_settings
from app.db import worker_session
from app.reports import runner
from app.reports.pdf import RenderError

log = logging.getLogger("app.worker")
settings = get_settings()

# Without Redis (tests, a quick local run) the broker is in-memory; nothing is sent anywhere.
celery_app = Celery("vyuham", broker=settings.redis_url or "memory://")
celery_app.conf.update(
    task_ignore_result=True,
    task_acks_late=True,  # a job is re-delivered if its worker dies mid-run; run_job is safe to repeat
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # long jobs (PDF reports) shouldn't sit behind each other on one worker
    worker_concurrency=settings.worker_concurrency,
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    beat_schedule={
        "tick": {"task": "vyuham.tick", "schedule": 60.0, "options": {"expires": 55}},
        "prune": {"task": "vyuham.prune", "schedule": 24 * 3600.0},
        "prune-reports": {"task": "vyuham.prune_reports", "schedule": 24 * 3600.0},
    },
)

@worker_process_init.connect(weak=False)
def _start_tracing(**_: object) -> None:
    """Each worker process starts its own exporter after forking (OpenTelemetry threads don't survive a fork)."""
    from app.telemetry import setup_telemetry

    setup_telemetry("vyuham-worker", celery=True)
    from app.errors import setup_error_tracking

    setup_error_tracking("vyuham-worker")


# Database and network trouble is worth retrying; a broken alert definition is not (run_job
# records that as a failed run instead of raising).
TRANSIENT = (OperationalError, DBAPIError, ConnectionError, TimeoutError, OSError, RenderError)


class JobTask(Task):
    def on_failure(self, exc, task_id, args, kwargs, einfo):  # retries used up, or not retryable
        db = worker_session()
        try:
            jobs.mark_failed(db, args[0], exc)
        finally:
            db.close()


def _status_checks(db) -> None:
    """The status page's once-a-minute checks ride on the same beat; a failure here never stops jobs."""
    from app.status import run_checks

    try:
        run_checks(db)
    except Exception:
        log.exception("status checks failed")
        db.rollback()


@celery_app.task(name="vyuham.tick", ignore_result=True)
def tick() -> dict:
    db = worker_session()
    try:
        counts = jobs.tick(db, enqueue=lambda job_id: run_job.delay(job_id))
        runner.fail_stale(db)
        _status_checks(db)
    finally:
        db.close()
    if any(counts.values()):
        log.info("tick %s", counts)
    return counts


@celery_app.task(
    name="vyuham.run_job",
    base=JobTask,
    autoretry_for=TRANSIENT,
    max_retries=3,
    retry_backoff=10,  # 10s, 20s, 40s (with jitter)
    retry_backoff_max=300,
    soft_time_limit=300,
    time_limit=360,
)
def run_job(job_id: str) -> None:
    db = worker_session()
    try:
        jobs.run_job(db, job_id)
    finally:
        db.close()


@celery_app.task(name="vyuham.prune", ignore_result=True)
def prune() -> int:
    db = worker_session()
    try:
        return jobs.prune(db)
    finally:
        db.close()


class ReportTask(Task):
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        log.error("report run %s failed: %s", args[0], exc)
        db = worker_session()
        try:
            runner.mark_failed(db, args[0], exc)
        finally:
            db.close()


@celery_app.task(
    name="vyuham.run_report",
    base=ReportTask,
    autoretry_for=TRANSIENT,
    max_retries=2,
    retry_backoff=15,
    soft_time_limit=600,  # big exports and PDFs of long dashboards
    time_limit=660,
)
def run_report(run_id: str) -> None:
    db = worker_session()
    try:
        runner.generate(db, run_id)
    finally:
        db.close()


@celery_app.task(name="vyuham.prune_reports", ignore_result=True)
def prune_reports() -> int:
    db = worker_session()
    try:
        return runner.prune(db, settings.report_retention_days)
    finally:
        db.close()
