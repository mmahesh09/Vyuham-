"""Request rate limits for the API, so one account or one link can't flood it.

Built on `limits` (the engine behind slowapi) as one middleware with a table of path rules, so the
routers don't need a `request` argument for each limited endpoint. Counters are kept in Redis when
REDIS_URL is set (shared by every API process) and in memory otherwise (local dev, tests).

Who is counted:
- signed-in requests: the Better Auth session (hashed), so people behind one office IP don't share a budget;
- routes that work without signing in, and everyone else: the first X-Forwarded-For address, else the
  connecting address. A session cookie isn't checked here, so on these routes it can't earn a fresh budget. Browsers reach the API
  through the Next.js proxy, so the connecting address is the proxy's; X-Forwarded-For carries the
  visitor's. That header can be forged by a client that calls the API directly, which only lets them
  spread their own requests over more budgets, so anonymous limits are a speed bump, not a wall.

If Redis is down, requests are let through (and logged) rather than taking the whole API down with it.
"""

from __future__ import annotations

import hashlib
import logging
from functools import lru_cache

from limits import RateLimitItem, parse
from limits.storage import MemoryStorage, Storage, storage_from_string
from limits.strategies import MovingWindowRateLimiter
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import get_settings
from app.security import session_token

log = logging.getLogger("app.ratelimit")

# (method or "*", path prefix, limit). The first match wins; DEFAULT applies to everything else.
RULES: list[tuple[str, str, str]] = [
    ("*", "/health", ""),  # never limited: Docker and uptime checks
    ("POST", "/datasets", "10/minute"),  # uploads
    ("PUT", "/datasets/", "10/minute"),  # replace a dataset's file
    ("POST", "/exports", "10/minute"),
    ("GET", "/account/export", "5/minute"),
    ("*", "/public/", "60/minute"),  # share links, no sign-in
    ("*", "/report-files/", "60/minute"),  # signed download links, no sign-in
    ("*", "/print/", "120/minute"),  # print token pages (the PDF renderer loads a few per report)
    ("*", "/invites/", "30/minute"),
    ("POST", "/sql/", "60/minute"),
    # Expensive work (from the rate-limit review in PR #4): AI answers, chart previews, new dashboards.
    ("POST", "/formulas/", "120/minute"),  # validation runs as people type
    ("POST", "/metrics", "60/minute"),
    ("POST", "/ask", "30/minute"),  # each question parses the text and runs DuckDB queries
    ("POST", "/charts/preview", "120/minute"),
    ("POST", "/templates/", "30/hour"),  # applying a template builds a whole dashboard
    ("POST", "/reports/", "30/hour"),  # report runs render PDFs in the worker
    ("POST", "/workspace/invites", "20/hour"),  # each invite sends an email
    # Database connections: each request opens a connection to the customer's database.
    ("POST", "/connections/", "20/minute"),  # test, create, first sync
    ("GET", "/connections/", "60/minute"),  # table lists and previews
    ("POST", "/support/webhooks/", "120/minute"),  # GlitchTip; checked by shared secret
    ("POST", "/support/", "20/minute"),  # new tickets and replies
    ("GET", "/support/errors/", "60/minute"),  # error-screen help lookup, no sign-in
    ("POST", "/kb/", "30/minute"),  # helpful votes, deflections
    ("GET", "/kb/", "120/minute"),  # public help center and search-as-you-type
    ("GET", "/status", "60/minute"),  # public status page
]
DEFAULT = "300/minute"
ANONYMOUS_ROUTES = ("/public/", "/report-files/", "/print/", "/support/errors/", "/support/webhooks/", "/kb/", "/status")


def _rule(method: str, path: str) -> tuple[str, str] | None:
    """(bucket name, limit) for this request, or None when it isn't limited."""
    for m, prefix, limit in RULES:
        if (m == "*" or m == method) and (path == prefix.rstrip("/") or path.startswith(prefix)):
            return (f"{m}:{prefix}", limit) if limit else None
    return ("default", DEFAULT)


def client_key(request: Request) -> str:
    token = None if request.url.path.startswith(ANONYMOUS_ROUTES) else session_token(request)
    if token:
        return "s:" + hashlib.sha256(token.encode()).hexdigest()[:24]
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    return "ip:" + ip


@lru_cache
def _parsed(limit: str) -> RateLimitItem:
    return parse(limit)


_storage: Storage | None = None


def storage() -> Storage:
    global _storage
    if _storage is None:
        url = get_settings().redis_url
        _storage = storage_from_string(url) if url else MemoryStorage()
    return _storage


def reset() -> None:
    """Forget every counter (tests)."""
    global _storage
    _storage = None


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not get_settings().rate_limit_enabled:
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        rule = _rule(request.method, request.url.path)
        if rule is None:
            await self.app(scope, receive, send)
            return
        bucket, limit = rule
        item = _parsed(limit)
        key = client_key(request)
        try:
            limiter = MovingWindowRateLimiter(storage())
            allowed = limiter.hit(item, bucket, key)
        except Exception:  # Redis trouble: serve the request rather than fail it
            log.exception("rate limit check failed; letting the request through")
            allowed = True
        if not allowed:
            retry = item.get_expiry()
            response = JSONResponse(
                {"detail": "Too many requests. Wait a minute and try again."},
                status_code=429,
                headers={"Retry-After": str(retry)},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
