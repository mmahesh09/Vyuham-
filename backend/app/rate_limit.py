"""Per-user rate limits on the expensive endpoints (queries, uploads, exports, emails).

Each limit is a fixed window: at most `count` requests per `seconds`, counted per signed-in user
(or per share link for public dashboards, which have no user). Over the limit, the request gets a
429 with a Retry-After header and a plain message.

Counts live in Redis when REDIS_URL is set, so every API process shares them; otherwise in this
process's memory (local dev, tests). If Redis is unreachable the request is allowed: a broken
limiter must not take the product down. RATE_LIMITS_ENABLED=false turns limits off.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status

from app.config import get_settings
from app.security import AuthUser, current_user

log = logging.getLogger("app.rate_limit")


@dataclass(frozen=True)
class Limit:
    count: int
    seconds: int
    what: str  # for the message: "Too many {what} in a short time."


LIMITS: dict[str, Limit] = {
    "ask": Limit(30, 60, "questions"),
    "sql": Limit(60, 60, "SQL queries"),
    "preview": Limit(120, 60, "chart previews"),
    "view": Limit(120, 60, "dashboard refreshes"),
    "upload": Limit(20, 3600, "uploads"),
    "export": Limit(20, 600, "exports"),
    "build": Limit(30, 3600, "new dashboards"),
    "invite": Limit(20, 3600, "invites"),
    "public": Limit(120, 60, "requests to this shared dashboard"),
}


class _Memory:
    def __init__(self) -> None:
        self._counts: dict[str, int] = {}
        self._lock = threading.Lock()

    def incr(self, key: str, ttl: int) -> int:
        with self._lock:
            if len(self._counts) > 50_000:  # windows are in the key, so old ones are just dropped
                self._counts.clear()
            self._counts[key] = self._counts.get(key, 0) + 1
            return self._counts[key]

    def clear(self) -> None:
        with self._lock:
            self._counts.clear()


class _Redis:
    def __init__(self, url: str) -> None:
        import redis

        self._client = redis.Redis.from_url(url, socket_timeout=0.5, socket_connect_timeout=0.5)

    def incr(self, key: str, ttl: int) -> int:
        pipe = self._client.pipeline()
        pipe.incr(key)
        pipe.expire(key, ttl, nx=True)
        count, _ = pipe.execute()
        return int(count)


_memory = _Memory()
_redis: _Redis | None = None
_redis_url = ""


def _store():
    global _redis, _redis_url
    url = get_settings().redis_url
    if not url:
        return _memory
    if _redis is None or url != _redis_url:
        _redis, _redis_url = _Redis(url), url
    return _redis


def reset() -> None:
    """Forget all in-memory counts (tests)."""
    _memory.clear()


def check(name: str, subject: str, now: float | None = None) -> None:
    """Count one request for `subject` against limit `name`; raise 429 when over it."""
    if not get_settings().rate_limits_enabled:
        return
    limit = LIMITS[name]
    now = time.time() if now is None else now
    window = int(now // limit.seconds)
    try:
        count = _store().incr(f"rl:{name}:{subject}:{window}", limit.seconds)
    except Exception:
        log.warning("rate limiter unavailable; allowing the request", exc_info=True)
        return
    if count > limit.count:
        retry = max(1, int((window + 1) * limit.seconds - now))
        wait = f"{retry} seconds" if retry < 120 else f"{(retry + 59) // 60} minutes"
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many {limit.what} in a short time. Try again in {wait}.",
            headers={"Retry-After": str(retry)},
        )


def per_user(name: str):
    """Dependency: limit `name` for the signed-in user."""
    LIMITS[name]  # fail at import time on a typo

    def dependency(user: AuthUser = Depends(current_user)) -> None:
        check(name, f"user:{user.id}")

    return dependency


def per_share_link(name: str = "public"):
    """Dependency for public dashboard routes: limit per share token (no user to count)."""

    def dependency(request: Request) -> None:
        check(name, f"share:{request.path_params.get('token', '')}")

    return dependency
