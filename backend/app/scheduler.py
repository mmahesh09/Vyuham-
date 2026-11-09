"""A small in-process scheduler: every minute, check due alerts and run due automations.

Good for a single backend process. With several workers, run it in one only
(SCHEDULER_ENABLED=false on the others) or move it to a separate worker.
"""

import logging
import threading

from app.alerts import tick
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
