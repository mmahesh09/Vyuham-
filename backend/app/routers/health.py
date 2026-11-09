"""Health checks for Docker, load balancers and uptime monitors.

/health/live  — the process is up and serving requests (restart it if not).
/health/ready — it can do real work: database, Redis (when configured) and the data folder all
                answer. Returns 503 otherwise, naming only which check failed; details go to logs.
"""

import logging
import os

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db

log = logging.getLogger("app.health")
router = APIRouter(tags=["health"])


@router.get("/health")
@router.get("/health/live")
def live():
    return {"status": "ok"}


def _check_db(db: Session) -> bool:
    try:
        db.execute(text("SELECT 1"))
        return True
    except Exception:
        log.exception("readiness: database check failed")
        return False


def _check_redis(url: str) -> bool:
    import redis

    try:
        client = redis.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
        try:
            return bool(client.ping())
        finally:
            client.close()
    except Exception:
        log.exception("readiness: redis check failed")
        return False


def _check_data_dir(path: str) -> bool:
    try:
        os.makedirs(path, exist_ok=True)
        return os.access(path, os.W_OK)
    except OSError:
        log.exception("readiness: data dir check failed")
        return False


@router.get("/health/ready")
def ready(db: Session = Depends(get_db)):
    settings = get_settings()
    checks = {"database": _check_db(db), "data_dir": _check_data_dir(settings.data_dir)}
    if settings.redis_url:
        checks["redis"] = _check_redis(settings.redis_url)
    ok = all(checks.values())
    body = {"status": "ok" if ok else "unavailable", "checks": {k: "ok" if v else "fail" for k, v in checks.items()}}
    return JSONResponse(body, status_code=200 if ok else 503)
