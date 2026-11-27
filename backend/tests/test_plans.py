"""Plans: limits come from plans.json, are enforced on the server, and never delete anything."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import ai, pipelines, plans
from app.config import get_settings
from app.models import AiAction, Organization, Pipeline, PipelineRun, WorkspaceMember
from tests.conftest import add_user

CSV = b"region,amount\nNorth,10\nSouth,20\n"


@pytest.fixture
def owner(client, engine):
    client.cookies.set("better-auth.session_token", add_user(engine))
    with Session(engine) as db:
        org = db.scalar(select(Organization))
        m = db.scalar(select(WorkspaceMember))
        return SimpleNamespace(org_id=org.id, workspace_id=m.workspace_id, user_id=m.user_id)


@pytest.fixture
def enforced(monkeypatch):
    monkeypatch.setattr(get_settings(), "plan_limits_enforced", True)


def set_plan(engine, org_id, plan):
    with engine.begin() as conn:
        conn.execute(update(Organization).where(Organization.id == org_id).values(plan=plan))


def upload(client, name="a.csv"):
    return client.post("/datasets", files={"file": (name, CSV, "text/csv")})


# ---------- config ----------


def test_config_loads_and_annual_price_is_computed():
    assert list(plans.PLANS) == ["free", "starter", "pro", "business", "enterprise"]
    assert plans.PLANS["pro"].monthly_price == 2999
    assert plans.PLANS["pro"].annual_price(20) == round(2999 * 12 * 0.8)
    assert plans.PLANS["enterprise"].annual_price(20) is None
    assert plans.required_plan("governance.audit_logs") == "business"


def test_web_app_copy_matches_the_backend_config():
    """`npm run plans:sync` copies plans.json to the web app; a stale copy fails here."""
    root = Path(__file__).resolve().parents[2]
    web = json.loads((root / "frontend/src/config/plans.generated.json").read_text(encoding="utf-8"))
    assert web == json.loads(plans.CONFIG_PATH.read_text(encoding="utf-8"))


# ---------- quotas ----------


def test_limits_are_not_enforced_until_switched_on(client, owner):
    for i in range(plans.PLANS["free"].datasets + 1):
        assert upload(client, f"d{i}.csv").status_code == 201
    billing = client.get("/organizations/current/billing").json()
    usage = {u["metric"]: u for u in billing["usage"]}
    assert billing["enforced"] is False and usage["datasets"]["used"] == 4 and usage["datasets"]["limit"] == 3


def test_dataset_limit_blocks_creation_and_names_the_next_plan(client, owner, enforced):
    for i in range(plans.PLANS["free"].datasets):
        assert upload(client, f"d{i}.csv").status_code == 201
    r = upload(client, "one-too-many.csv")
    assert r.status_code == 402
    d = r.json()["detail"]
    assert d["code"] == "plan_limit" and d["metric"] == "datasets" and d["limit"] == 3 and d["required_plan"] == "starter"
    assert len(client.get("/datasets").json()) == 3  # nothing removed


def test_a_bigger_plan_lifts_the_limit(client, engine, owner, enforced):
    set_plan(engine, owner.org_id, "starter")
    for i in range(plans.PLANS["starter"].datasets):
        assert upload(client, f"d{i}.csv").status_code == 201
    assert upload(client, "x.csv").status_code == 402


def test_dashboard_limit(client, owner, enforced):
    for i in range(plans.PLANS["free"].dashboards):
        assert client.post("/dashboards", json={"name": f"D{i}"}).status_code == 201
    r = client.post("/dashboards", json={"name": "Over"})
    assert r.status_code == 402 and r.json()["detail"]["metric"] == "dashboards"


def test_seat_limit_blocks_invitations(client, engine, owner, enforced):
    with engine.begin() as conn:  # inviting needs a confirmed email
        from app.auth_tables import user_table

        conn.execute(update(user_table).values(emailVerified=True))
    r = client.post("/invitations", json={"emails": ["new@acme.co"], "role": "analyst"})
    assert r.status_code == 402 and r.json()["detail"]["metric"] == "seats"


def test_feature_gate_says_which_plan_has_it(client, owner, enforced):
    r = client.post("/pipelines/ai/plan", json={"request": "Daily revenue by region from sales"})
    assert r.status_code == 402
    d = r.json()["detail"]
    assert d["code"] == "plan_feature" and d["feature"] == "engineering.ai_pipeline_generation" and d["required_plan"] == "starter"


# ---------- pipeline runs ----------


def _pipeline(engine, ws):
    with Session(engine) as db:
        p = Pipeline(workspace_id=ws, name="P", graph={"nodes": [], "edges": []}, schedule="daily", hour=6, enabled=True)
        db.add(p)
        db.commit()
        return p.id


def test_daily_runs_manual_gets_402_scheduled_is_skipped_not_run(engine, owner, enforced):
    pid = _pipeline(engine, owner.workspace_id)
    with Session(engine) as db:
        p = db.get(Pipeline, pid)
        for _ in range(plans.PLANS["free"].pipeline_runs_per_day):
            pipelines.start_run(db, p, "manual", owner.user_id)
        with pytest.raises(HTTPException) as e:
            pipelines.start_run(db, p, "manual", owner.user_id)
        assert e.value.status_code == 402
        run = pipelines.start_run(db, p, "schedule", owner.user_id)
        assert run.status == "skipped" and "pipeline runs a day" in run.error
        assert pipelines.execute(db, run).status == "skipped"
        # Skipped runs don't eat into tomorrow's (or today's) allowance.
        assert plans.used(db, db.get(Organization, owner.org_id), "pipeline_runs") == 2
        assert db.scalar(select(PipelineRun).where(PipelineRun.id == run.id)) is not None


# ---------- AI credits ----------


def _member(db, owner):
    return db.get(WorkspaceMember, (owner.workspace_id, owner.user_id))


def _fake_client(monkeypatch, *, fail=False):
    def create(**_):
        if fail:
            raise RuntimeError("network down")
        return SimpleNamespace(
            usage=SimpleNamespace(input_tokens=10, output_tokens=5), model="m", stop_reason="end_turn",
            content=[SimpleNamespace(type="text", text='{"ok": true}')],
        )

    monkeypatch.setattr(ai, "_get_client", lambda: SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create))))


def test_ai_credits_charged_on_success_only(engine, owner, monkeypatch):
    _fake_client(monkeypatch)
    with Session(engine) as db:
        r = ai.ask_json(db, _member(db, owner), "pipeline_plan", "sys", "prompt", {})
        assert r.action.status == "ok" and r.action.credits == plans.AI_CREDIT_COSTS["pipeline_plan"]
    _fake_client(monkeypatch, fail=True)
    with Session(engine) as db:
        with pytest.raises(RuntimeError):
            ai.ask_json(db, _member(db, owner), "sql_explain", "sys", "prompt", {})
        failed = db.scalar(select(AiAction).where(AiAction.kind == "sql_explain"))
        assert failed.status == "error" and failed.credits == 0
        assert plans.used(db, db.get(Organization, owner.org_id), "ai_credits") == plans.AI_CREDIT_COSTS["pipeline_plan"]


def test_ai_allowance_counts_pending_reservations(engine, owner, enforced, monkeypatch):
    """A request still waiting on the provider holds its credits, so a parallel one can't overspend."""
    allowance = plans.PLANS["free"].ai_credits_per_month
    with Session(engine) as db:
        m = _member(db, owner)
        held = AiAction(workspace_id=m.workspace_id, user_id=m.user_id, kind="sql_explain", status="pending",
                        credits=allowance - 1)
        db.add(held)
        db.commit()
        _fake_client(monkeypatch)
        with pytest.raises(HTTPException) as e:
            ai.ask_json(db, m, "sql_write", "sys", "prompt", {})  # costs 2, only 1 left
        assert e.value.status_code == 402 and e.value.detail["metric"] == "ai_credits"
        assert db.scalar(select(AiAction).where(AiAction.kind == "sql_write")) is None  # nothing sent, nothing saved
        ai.ask_json(db, m, "sql_explain", "sys", "prompt", {})  # costs 1: fits exactly
