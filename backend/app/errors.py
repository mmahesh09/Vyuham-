"""Error tracking with the Sentry SDK (MIT), sent to a self-hosted GlitchTip (MIT). Off unless SENTRY_DSN is set.

Like app/telemetry.py: with no DSN nothing is imported and the app behaves exactly as before. With
one, unhandled errors in the API and Celery jobs go to GlitchTip, which groups them into issues;
GlitchTip's webhook then tells us about new issues (routers/support.py), so staff can attach a
help article and the next person who hits the error sees the fix.

What leaves the server is kept small: no cookies, auth headers, request bodies or emails; the
user is identified by their opaque id only.
"""

from __future__ import annotations

import logging
import re
import uuid

from app.config import get_settings

log = logging.getLogger("app.errors")
_started = False

DROP_HEADERS = {"cookie", "authorization", "x-api-key", "proxy-authorization", "set-cookie"}
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def enabled() -> bool:
    return bool(get_settings().sentry_dsn)


def _scrub(event: dict, _hint: dict) -> dict:
    req = event.get("request") or {}
    req.pop("cookies", None)
    req.pop("data", None)
    if isinstance(req.get("headers"), dict):
        req["headers"] = {k: v for k, v in req["headers"].items() if k.lower() not in DROP_HEADERS}
    user = event.get("user") or {}
    event["user"] = {"id": user["id"]} if user.get("id") else {}
    for exc in (event.get("exception") or {}).get("values") or []:
        if isinstance(exc.get("value"), str):
            exc["value"] = EMAIL.sub("[email]", exc["value"])
    return event


def setup_error_tracking(service: str) -> bool:
    """Start the Sentry SDK for this process. Returns False (and does nothing) without a DSN."""
    global _started
    s = get_settings()
    if not s.sentry_dsn:
        return False
    if not _started:
        import sentry_sdk

        sentry_sdk.init(
            dsn=s.sentry_dsn,
            environment=s.environment,
            release=s.release or None,
            server_name=service,
            send_default_pii=False,
            traces_sample_rate=s.sentry_traces_sample_rate,
            before_send=_scrub,
        )
        _started = True
        log.info("error tracking on for %s", service)
    return True


def identify(user_id: str, workspace_id: str | None = None) -> None:
    """Tag errors from this request with the user's opaque id (never their email)."""
    if not _started:
        return
    import sentry_sdk

    sentry_sdk.set_user({"id": user_id})
    if workspace_id:
        sentry_sdk.set_tag("workspace_id", workspace_id)


def capture(exc: BaseException, module: str | None = None) -> str:
    """Report an exception; returns a reference the user can quote to support (the GlitchTip event id when on).

    The event is tagged with the OpenTelemetry trace id (when tracing is on) and the code module, so staff
    can jump from an error in GlitchTip to the whole request in Grafana.
    """
    from app.telemetry import classify, current_trace_id

    if _started:
        import sentry_sdk

        with sentry_sdk.new_scope() as scope:
            if trace_id := current_trace_id():
                scope.set_tag("trace_id", trace_id)
            if module:
                scope.set_tag("module", module)
            scope.set_tag("error_category", classify(exc))
            event_id = sentry_sdk.capture_exception(exc)
        if event_id:
            return event_id
    ref = uuid.uuid4().hex
    log.error("unhandled error ref=%s", ref, exc_info=exc)
    return ref


# --- Matching an error to a help article ------------------------------------------------------

_NOISE = [
    re.compile(r"[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}", re.I),  # uuids
    re.compile(r"\b[0-9a-f]{16,}\b", re.I),  # long hex ids
    re.compile(r"(['\"`]).*?\1"),  # quoted values
    re.compile(r"\d+"),
]


def normalize_title(title: str) -> str:
    """'KeyError: 'col_17' in row 4' and 'KeyError: 'col_2' in row 9' normalize to the same text."""
    t = title.strip().lower()
    for pat in _NOISE:
        t = pat.sub("#", t)
    return re.sub(r"\s+", " ", t)[:300]
