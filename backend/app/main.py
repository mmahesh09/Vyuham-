from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from app.config import get_settings
from app.ratelimit import RateLimitMiddleware
from app.routers import account, alerts, ask, dashboards, datasets, health, me, presence, profile, reports, sql_lab, team, templates
from app.scheduler import Scheduler
from app.telemetry import setup_telemetry


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
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

app.include_router(me.router)
app.include_router(datasets.router)
app.include_router(profile.router)
app.include_router(presence.router)
app.include_router(dashboards.router)
app.include_router(dashboards.public)
app.include_router(ask.router)
app.include_router(templates.router)
app.include_router(team.router)
app.include_router(sql_lab.router)
app.include_router(alerts.router)
app.include_router(account.router)
app.include_router(health.router)
app.include_router(reports.router)
app.include_router(reports.printer)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """This app is an API only; send people who open the bare URL to the interactive docs (dev) or the health check."""
    return RedirectResponse("/docs" if _docs else "/health")
