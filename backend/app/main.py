from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import get_settings
from app.routers import account, alerts, ask, dashboards, datasets, health, me, presence, profile, reports, sql_lab, team, templates
from app.scheduler import Scheduler


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
app = FastAPI(title="AI Dashboards API", version="0.1.0", lifespan=lifespan)

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
