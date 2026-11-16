"""Background processing: a small database-backed job queue and its worker thread.

Expensive work (embedding articles, retrieval + Claude answers) never runs in a web request. The
request enqueues a job and returns; the worker picks it up. Jobs are claimed with a conditional
UPDATE, so several backend processes can run workers without doing the same job twice. Failed jobs
are retried with backoff when the failure is temporary.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.support_ai.models import SupportJob

log = logging.getLogger("app.support_ai.jobs")
POLL_SECONDS = 2
MAX_ATTEMPTS = 4
STALE_AFTER = timedelta(minutes=10)  # a job "running" this long was abandoned by a crashed worker


class RetryableJobError(Exception):
    pass


def enqueue(db: Session, kind: str, ref_id: str) -> SupportJob:
    job = SupportJob(kind=kind, ref_id=ref_id)
    db.add(job)
    db.commit()
    return job


def _claim(db: Session, now: datetime) -> SupportJob | None:
    # Recover jobs abandoned mid-run.
    db.execute(update(SupportJob).where(SupportJob.status == "running", SupportJob.updated_at < now - STALE_AFTER).values(status="queued", updated_at=now))
    candidates = db.scalars(select(SupportJob.id).where(SupportJob.status == "queued", SupportJob.run_after <= now).order_by(SupportJob.run_after).limit(5)).all()
    for job_id in candidates:
        claimed = db.execute(
            update(SupportJob).where(SupportJob.id == job_id, SupportJob.status == "queued").values(status="running", attempts=SupportJob.attempts + 1, updated_at=now)
        ).rowcount
        db.commit()
        if claimed:
            return db.get(SupportJob, job_id)
    db.commit()
    return None


def run_job(db: Session, job: SupportJob) -> None:
    from app.support_ai import pipeline  # local import: pipeline imports this module

    handlers = {"embed_article": pipeline.handle_embed_article, "answer_session": pipeline.handle_answer_session}
    now = datetime.now(timezone.utc)
    try:
        handlers[job.kind](db, job.ref_id, final_attempt=job.attempts >= MAX_ATTEMPTS)
        job.status, job.last_error = "done", None
    except RetryableJobError as e:
        db.rollback()
        if job.attempts >= MAX_ATTEMPTS:
            job.status, job.last_error = "failed", str(e)[:500]
        else:
            job.status, job.last_error = "queued", str(e)[:500]
            job.run_after = now + timedelta(seconds=15 * 2 ** job.attempts)
        log.warning("job %s %s attempt %s: %s", job.kind, job.id, job.attempts, e)
    except Exception as e:  # noqa: BLE001 - one bad job must not stop the worker
        db.rollback()
        job.status, job.last_error = "failed", f"{type(e).__name__}: {e}"[:500]
        log.exception("job %s %s failed", job.kind, job.id)
    job.updated_at = now
    db.commit()


def process_pending(db: Session, max_jobs: int = 20) -> int:
    """Run due jobs now. Used by the worker loop and by tests."""
    done = 0
    while done < max_jobs:
        job = _claim(db, datetime.now(timezone.utc))
        if job is None:
            break
        run_job(db, job)
        done += 1
    return done


class Worker:
    def __init__(self, session_factory) -> None:
        self._session_factory = session_factory
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="support-ai-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        while not self._stop.wait(POLL_SECONDS):
            db = self._session_factory()
            try:
                process_pending(db)
            except Exception:  # noqa: BLE001
                log.exception("support worker pass failed")
                db.rollback()
            finally:
                db.close()
