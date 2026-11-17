"""The status page: checks, uptime history, staleness and incidents."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import sessionmaker

from app import status as status_mod
from app.config import get_settings
from app.models import StatusCheck
from tests.test_support import login


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(get_settings(), "support_staff_emails", "staff@acme.co")
    status_mod.invalidate()
    yield
    status_mod.invalidate()


def test_run_checks_writes_once_per_minute(engine):
    db = sessionmaker(bind=engine)()
    now = datetime.now(timezone.utc)
    assert status_mod.run_checks(db, now) == 4
    assert status_mod.run_checks(db, now + timedelta(seconds=10)) == 0  # too soon
    assert status_mod.run_checks(db, now + timedelta(seconds=61)) == 4
    db.close()


def test_status_is_public_and_operational(client, engine):
    db = sessionmaker(bind=engine)()
    status_mod.run_checks(db)
    db.close()
    body = client.get("/status").json()
    assert body["overall"] == "operational" and body["checks_stale"] is False
    assert [c["id"] for c in body["components"]] == ["api", "database", "jobs", "storage"]
    assert all(c["uptime_90d"] == 100.0 for c in body["components"])


def test_no_recent_checks_means_jobs_down(client):
    body = client.get("/status").json()
    jobs = next(c for c in body["components"] if c["id"] == "jobs")
    assert body["checks_stale"] is True and jobs["state"] == "major_outage"
    assert next(c for c in body["components"] if c["id"] == "api")["state"] == "operational"


def test_daily_uptime_math(engine):
    db = sessionmaker(bind=engine)()
    day = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
    for i, ok in enumerate([True, True, True, False]):
        db.add(StatusCheck(component="database", ok=ok, latency_ms=1, checked_at=day + timedelta(minutes=i)))
    db.commit()
    up = status_mod.daily_uptime(db, day.date())
    assert up["database"] == {"2026-11-10": 75.0}
    db.close()


def test_incident_lifecycle(client, engine):
    db = sessionmaker(bind=engine)()
    status_mod.run_checks(db)
    db.close()
    login(client, engine, "staff")
    r = client.post("/status/admin/incidents", json={"title": "Slow uploads", "impact": "minor", "components": ["storage"], "message": "Looking into it"})
    assert r.status_code == 201
    inc = r.json()
    body = client.get("/status").json()
    assert body["overall"] == "degraded" and body["active_incidents"][0]["title"] == "Slow uploads"

    client.post(f"/status/admin/incidents/{inc['id']}/updates", json={"status": "resolved", "message": "Fixed"})
    body = client.get("/status").json()
    assert body["overall"] == "operational" and body["active_incidents"] == []
    assert body["recent_incidents"][0]["updates"][0]["message"] == "Fixed"


def test_incident_rejects_unknown_component(client, engine):
    login(client, engine, "staff")
    r = client.post("/status/admin/incidents", json={"title": "Bad", "components": ["moon"], "message": "x x x"})
    assert r.status_code == 422
