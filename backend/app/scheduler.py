"""The no-Redis fallback: every minute, run due jobs in a thread inside the API process.

Used for local dev only. In Docker and production, REDIS_URL is set and the Celery worker and
beat (app/worker.py) run jobs instead, so this never starts. Job claims (app/jobs.py) still stop
double sends if two processes run it by mistake.
"""

import logging
import threading

from app.jobs import tick
from app.db import SessionLocal

log = logging.getLogger("app.scheduler")
INTERVAL_SECONDS = 60


class Scheduler:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="alerts-scheduler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        while not self._stop.wait(INTERVAL_SECONDS):
            db = SessionLocal()
            try:
                tick(db)
            except Exception:  # keep the loop alive; one bad pass shouldn't stop alerts
                log.exception("scheduler pass failed")
                db.rollback()
            finally:
                db.close()
