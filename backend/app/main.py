from contextlib import asynccontextmanager

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.config import get_settings
from app.db import get_db
from app.errors import capture
from app.ratelimit import RateLimitMiddleware
from app.errors import setup_error_tracking
from app.routers import account, ai, alerts, invitations, onboarding, organizations, pilots, ask, connections, dashboards, data_platform, datasets, dynamic_tables, governance, health, hooks, kb, me, metrics, pipelines, presence, profile, reports, sql_lab, status_page, support, team, templates, usage
from app.scheduler import Scheduler
from app.telemetry import configure_logging, count, current_trace_id, record_error, scrub, setup_telemetry


log = logging.getLogger("app.main")
# uvicorn only configures its own loggers; give the app's a handler (with the trace id on every line).
configure_logging()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    from app.db import check_rls_role, engine

    check_rls_role(engine)
    # With Redis, the Celery worker and beat run jobs; the thread is only for local dev without it.
    scheduler = Scheduler() if settings.scheduler_enabled and not settings.redis_url else None
    if scheduler:
        scheduler.start()
    yield
    if scheduler:
        scheduler.stop()


# The Next.js frontend proxies /api/* to this app, so the browser sees one
# origin and no CORS setup is needed.
# In production the interactive docs are off: the API's address is public, and the docs map every route.
_docs = get_settings().environment != "production"
app = FastAPI(
    title="AI Dashboards API", version="0.1.0", lifespan=lifespan,
    docs_url="/docs" if _docs else None, redoc_url="/redoc" if _docs else None, openapi_url="/openapi.json" if _docs else None,
)
app.add_middleware(RateLimitMiddleware)
# Tracing (OpenTelemetry), only when OTEL_EXPORTER_OTLP_ENDPOINT is set. celery=True traces the jobs the API queues.
setup_telemetry("vyuham-api", app=app, celery=True)
# Error tracking (Sentry SDK -> self-hosted GlitchTip), only when SENTRY_DSN is set.
setup_error_tracking("vyuham-api")

app.include_router(me.router)
app.include_router(onboarding.router)
app.include_router(organizations.router)
app.include_router(invitations.router)
app.include_router(data_platform.router)  # before datasets: /datasets/derived and /datasets/url aren't dataset ids
app.include_router(datasets.router)
app.include_router(connections.router)
app.include_router(hooks.router)
app.include_router(hooks.public)
app.include_router(profile.router)
app.include_router(presence.router)
app.include_router(dashboards.router)
app.include_router(dashboards.public)
app.include_router(ask.router)
app.include_router(metrics.router)
app.include_router(templates.router)
app.include_router(team.router)
app.include_router(sql_lab.router)
app.include_router(ai.router)
app.include_router(pipelines.router)
app.include_router(dynamic_tables.router)
app.include_router(usage.router)
app.include_router(governance.router)
app.include_router(pilots.public)
app.include_router(pilots.admin)
app.include_router(alerts.router)
app.include_router(account.router)
app.include_router(health.router)
app.include_router(reports.router)
app.include_router(reports.printer)
app.include_router(support.router)
app.include_router(support.admin)
app.include_router(kb.router)
app.include_router(kb.admin)
app.include_router(status_page.router)
app.include_router(status_page.admin)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    """A 500 the person can act on: a reference to quote to support, and the fix when staff have written one up."""
    endpoint = request.scope.get("endpoint")
    module = getattr(endpoint, "__module__", None) or "app"
    # Mark the request's span as failed with a scrubbed exception, and count it by category and module.
    from opentelemetry import trace

    category = record_error(trace.get_current_span(), exc)
    count("vyuham.errors", category=category, module=module)
    ref = capture(exc, module=module)
    # Starlette re-raises this same exception after the response; the OpenTelemetry middleware then records
    # it on the request span. Scrub its message first so emails and credentials never reach telemetry.
    try:
        exc.args = (scrub(str(exc)),)
    except Exception:  # some exception types don't allow it; the Collector scrubs again
        pass
    help_link = None
    try:
        gen = app.dependency_overrides.get(get_db, get_db)()
        db = next(gen)
        try:
            article = support.help_for_title(db, f"{type(exc).__name__}: {exc}")
            if article:
                help_link = {"slug": article.slug, "title": article.title}
        finally:
            gen.close()
    except Exception:  # the help lookup must never turn one error into two
        log.exception("help lookup for an unhandled error failed")
    return JSONResponse(
        {"detail": "Something went wrong on our side. We have been notified.", "error_ref": ref, "help": help_link, "trace_id": current_trace_id()},
        status_code=500,
    )


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """This app is an API only; send people who open the bare URL to the interactive docs (dev) or the health check."""
    return RedirectResponse("/docs" if _docs else "/health")
