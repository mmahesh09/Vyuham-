"""Background jobs: claims stop double sends, failures are recorded, the Celery tasks wire up."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app import jobs
from app.models import Alert, AlertEvent, Automation, JobRun
from tests.test_labs_alerts import alert_body
from tests.test_query import sign_in, upload


def _digest(client, engine, **kw):
    sign_in(client, engine)
    ds = upload(client)
    d = client.post(f"/datasets/{ds['id']}/starter-dashboard").json()
    body = {"name": "Daily digest", "dashboard_id": d["id"], "schedule": "daily", "hour": 9, "timezone": "UTC", "period_days": 366, **kw}
    a = client.post("/automations", json=body).json()
    with Session(engine) as s:  # pretend it was created a while ago so today's 09:00 is due
        s.get(Automation, a["id"]).created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        s.commit()
    return a


def _events(engine, **where) -> int:
    with Session(engine) as s:
        q = select(func.count()).select_from(AlertEvent)
        for k, v in where.items():
            q = q.where(getattr(AlertEvent, k) == v)
        return s.scalar(q)


NOON = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)


def test_tick_runs_a_due_automation_once(client, engine):
    a = _digest(client, engine)
    with Session(engine) as s:
        assert jobs.tick(s, NOON)["automations_run"] == 1
        # same pass again: not due any more (last_run_at moved on)
        assert jobs.tick(s, NOON + timedelta(minutes=1))["automations_run"] == 0
        run = s.scalars(select(JobRun)).one()
        assert (run.kind, run.target_id, run.status, run.attempts) == ("automation", a["id"], "done", 1)
        assert run.scheduled_for.replace(tzinfo=timezone.utc) == datetime(2026, 11, 10, 9, tzinfo=timezone.utc)
    assert _events(engine, automation_id=a["id"]) == 1


def test_queued_job_is_not_claimed_twice(client, engine):
    """A pass while the job is still waiting in the queue must not queue (and send) it again."""
    a = _digest(client, engine)
    queued: list[str] = []
    with Session(engine) as s:
        assert jobs.tick(s, NOON, enqueue=queued.append)["automations_run"] == 1
        second = jobs.tick(s, NOON + timedelta(minutes=1), enqueue=queued.append)
        assert second == {"alerts_checked": 0, "automations_run": 0, "skipped": 1}
        assert len(queued) == 1
        jobs.run_job(s, queued[0])
        jobs.run_job(s, queued[0])  # redelivered message: already done, nothing sent
    assert _events(engine, automation_id=a["id"]) == 1


def test_alert_slot_follows_last_check(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    a = client.post("/alerts", json=alert_body(ds["id"], schedule="hourly")).json()
    with Session(engine) as s:
        # The first slot is the alert's creation time; pin it before NOON so the test doesn't depend on today's date.
        s.get(Alert, a["id"]).created_at = NOON - timedelta(hours=1)
        s.commit()
        assert jobs.tick(s, NOON)["alerts_checked"] == 1
        assert jobs.tick(s, NOON + timedelta(minutes=30))["alerts_checked"] == 0
        assert jobs.tick(s, NOON + timedelta(minutes=61))["alerts_checked"] == 1
        slots = [r.scheduled_for.replace(tzinfo=timezone.utc) for r in s.scalars(select(JobRun).order_by(JobRun.scheduled_for))]
        assert slots[1] == NOON + timedelta(hours=1)  # one interval after the first check
        assert s.get(Alert, a["id"]).state == "triggered"


def test_broken_definition_is_failed_not_retried(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    client.post("/alerts", json=alert_body(ds["id"]))
    client.delete(f"/datasets/{ds['id']}")
    with Session(engine) as s:
        jobs.tick(s, NOON)
        run = s.scalars(select(JobRun)).one()
        assert run.status == "failed" and "deleted" in run.error and run.finished_at is not None


def test_paused_target_is_skipped(client, engine):
    a = _digest(client, engine)
    queued: list[str] = []
    with Session(engine) as s:
        jobs.tick(s, NOON, enqueue=queued.append)
        s.get(Automation, a["id"]).enabled = False
        s.commit()
        run = jobs.run_job(s, queued[0])
        assert run.status == "done" and run.error.startswith("Skipped")
    assert _events(engine, automation_id=a["id"]) == 0


def test_transient_error_stays_retryable_then_fails(client, engine, monkeypatch):
    _digest(client, engine)
    queued: list[str] = []

    def boom(*_a, **_k):
        raise OperationalError("SELECT 1", {}, Exception("connection reset"))

    monkeypatch.setattr(jobs, "run_automation", boom)
    with Session(engine) as s:
        jobs.tick(s, NOON, enqueue=queued.append)
        with pytest.raises(OperationalError):
            jobs.run_job(s, queued[0])
        assert s.get(JobRun, queued[0]).status == "retry"
        with pytest.raises(OperationalError):  # the retry runs it again
            jobs.run_job(s, queued[0])
        assert s.get(JobRun, queued[0]).attempts == 2
        jobs.mark_failed(s, queued[0], "gave up")
        run = s.get(JobRun, queued[0])
        assert (run.status, run.error) == ("failed", "gave up")


def test_inline_tick_survives_a_crashing_job(client, engine, monkeypatch):
    _digest(client, engine)
    monkeypatch.setattr(jobs, "run_automation", lambda *_a, **_k: 1 / 0)
    with Session(engine) as s:
        assert jobs.tick(s, NOON)["automations_run"] == 1
        assert s.scalars(select(JobRun)).one().status == "failed"


def test_prune_keeps_recent_and_unfinished(engine):
    old = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with Session(engine) as s:
        s.add_all([
            JobRun(kind="alert", target_id="a", scheduled_for=old, status="done", created_at=old),
            JobRun(kind="alert", target_id="b", scheduled_for=old, status="queued", created_at=old),
            JobRun(kind="alert", target_id="c", scheduled_for=NOON, status="done", created_at=NOON),
        ])
        s.commit()
        assert jobs.prune(s, NOON) == 1
        assert sorted(r.target_id for r in s.scalars(select(JobRun))) == ["b", "c"]


def test_celery_tasks_queue_and_run(client, engine, monkeypatch):
    """The real Celery tasks, run eagerly: beat's tick queues run_job, which sends the digest."""
    from app import worker

    a = _digest(client, engine)
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False))
    monkeypatch.setattr(jobs, "datetime", _FrozenDatetime)
    worker.celery_app.conf.task_always_eager = True
    try:
        assert worker.tick.delay().get()["automations_run"] == 1
    finally:
        worker.celery_app.conf.task_always_eager = False
    assert _events(engine, automation_id=a["id"]) == 1
    with Session(engine) as s:
        assert s.scalars(select(JobRun)).one().status == "done"


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOON if tz else NOON.replace(tzinfo=None)


def test_health_live_and_ready(client, monkeypatch):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/health/live").status_code == 200
    r = client.get("/health/ready")
    assert r.status_code == 200 and r.json()["checks"] == {"database": "ok", "data_dir": "ok"}

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "redis_url", "redis://127.0.0.1:1/0")  # nothing listens there
    r = client.get("/health/ready")
    assert r.status_code == 503 and r.json()["checks"]["redis"] == "fail"
