from datetime import datetime, timezone

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.alerts import automation_due, check_alert, last_occurrence, run_automation, tick
from app.models import Alert, Automation, WorkspaceMember
from app.notify import WebhookError, check_webhook_url
from tests.test_query import sign_in, upload


# ---------- SQL Lab ----------


def test_sql_lab_schema_run_and_saved(client, engine):
    sign_in(client, engine)
    upload(client)
    schema = client.get("/sql/schema").json()
    assert schema[0]["table"] == "sales" and [c["name"] for c in schema[0]["columns"]] == ["Date", "Region", "Product", "Amount"]

    r = client.post("/sql/run", json={"sql": 'SELECT "Region", SUM("Amount") AS total FROM sales GROUP BY 1 ORDER BY total DESC'}).json()
    assert r["columns"] == ["Region", "total"] and r["rows"][0] == {"Region": "North", "total": 325.0}
    for bad in ("DELETE FROM sales", "SELECT * FROM read_csv('/etc/passwd')", "SELECT 1; SELECT 2"):
        assert client.post("/sql/run", json={"sql": bad}).status_code == 422

    q = client.post("/sql/saved", json={"name": "By region", "sql": "SELECT 1 AS one"}).json()
    assert client.put(f"/sql/saved/{q['id']}", json={"name": "Renamed", "sql": "SELECT 2 AS two"}).json()["name"] == "Renamed"
    assert [s["name"] for s in client.get("/sql/saved").json()] == ["Renamed"]
    assert client.delete(f"/sql/saved/{q['id']}").status_code == 204


def test_sql_lab_viewers_blocked(client, engine):
    ws = sign_in(client, engine)
    upload(client)
    sign_in(client, engine, uid="u2", token="tok-2", company="Other")
    assert client.get("/sql/schema").json() == []  # own empty workspace
    with engine.begin() as c:
        c.execute(update(WorkspaceMember).where(WorkspaceMember.user_id == "u2").values(workspace_id=ws, role="viewer"))
    assert client.post("/sql/run", json={"sql": "SELECT 1"}).status_code == 403


def test_sql_chart_on_dashboard(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = client.post("/dashboards", json={"name": "SQL"}).json()
    spec = {"dataset": ds["id"], "sql": 'SELECT "Product" AS product, SUM("Amount") AS revenue FROM sales GROUP BY 1',
            "groupBy": "product", "metrics": [{"field": "revenue", "agg": "sum"}], "chartType": "hbar", "title": "Revenue by product"}
    assert client.post(f"/dashboards/{d['id']}/charts", json={"spec": spec}).status_code == 201
    bad = {**spec, "sql": "DROP VIEW sales"}
    assert client.post(f"/dashboards/{d['id']}/charts", json={"spec": bad}).status_code == 422
    rows = client.get(f"/dashboards/{d['id']}/view").json()["charts"][0]["rows"]
    assert {r["product"]: r["sum_revenue"] for r in rows} == {"Setup": 500, "Pro": 175}


def test_canvas_layout_saved(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = client.post("/dashboards", json={"name": "Canvas"}).json()
    c = client.post(f"/dashboards/{d['id']}/charts", json={"spec": {"dataset": ds["id"], "metrics": [{"field": "Amount", "agg": "sum"}], "chartType": "gauge", "title": "Goal", "target": 1000}}).json()
    layout = [{"i": c["id"], "x": 2, "y": 0, "w": 6, "h": 4}]
    assert client.patch(f"/dashboards/{d['id']}", json={"canvas_layout": layout}).json()["canvas_layout"] == layout
    client.delete(f"/charts/{c['id']}")
    assert client.get(f"/dashboards/{d['id']}").json()["canvas_layout"] == []


# ---------- alerts ----------


def alert_body(ds_id, **kw):
    return {"name": "Revenue watch", "dataset_id": ds_id, "metric": {"field": "Amount", "agg": "sum"}, "window_days": 0,
            "condition": "above", "threshold": 600, "channels": {"inapp": True}, **kw}


def test_alert_validation(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    assert client.post("/alerts", json=alert_body(ds["id"])).status_code == 201
    assert client.post("/alerts", json=alert_body(ds["id"], metric={"field": "Region", "agg": "sum"})).status_code == 422
    assert client.post("/alerts", json=alert_body(ds["id"], condition="change_up")).status_code == 422  # needs a window
    assert client.post("/alerts", json=alert_body(ds["id"], channels={"inapp": False})).status_code == 422
    assert client.post("/alerts", json=alert_body(ds["id"], channels={"emails": ["not-an-email"]})).status_code == 422
    assert client.post("/alerts", json=alert_body(ds["id"], channels={"webhook": "http://example.com/x"})).status_code == 422


def test_alert_edge_triggering_and_bell(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    a = client.post("/alerts", json=alert_body(ds["id"], channels={"inapp": True, "emails": ["boss@acme.co"]})).json()
    # 675 > 600: fires once
    r = client.post(f"/alerts/{a['id']}/check").json()
    assert (r["state"], r["last_value"]) == ("triggered", 675)
    assert client.get("/notifications/unread-count").json()["count"] == 1
    # still breached: no second message
    client.post(f"/alerts/{a['id']}/check")
    assert client.get("/notifications/unread-count").json()["count"] == 1
    hist = client.get("/alerts-history").json()
    assert len(hist) == 1 and hist[0]["delivery"] == {"inapp": 1, "email": 1}
    assert "is 675" in hist[0]["body"]
    # a test send always delivers
    client.post(f"/alerts/{a['id']}/check", params={"test": "true"})
    assert client.get("/notifications/unread-count").json()["count"] == 2
    client.post("/notifications/read")
    assert client.get("/notifications/unread-count").json()["count"] == 0
    assert len(client.get("/notifications").json()) == 2


def test_change_alert_against_previous_window(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    body = alert_body(ds["id"], condition="change_up", threshold=25, date_field="Date", window_days=28)
    a = client.post("/alerts", json=body).json()
    with Session(engine) as s:
        alert = s.get(Alert, a["id"])
        # Feb 1–28 (225) vs Jan 4–31 (150) = +50% >= 25%
        ev = check_alert(s, alert, now=datetime(2026, 2, 28, 12, tzinfo=timezone.utc))
        assert ev is not None and "up 50%" in ev.body and alert.state == "triggered"


def test_deleted_dataset_marks_alert_error(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    a = client.post("/alerts", json=alert_body(ds["id"])).json()
    client.delete(f"/datasets/{ds['id']}")
    # the rule is kept (not silently deleted) and says what's wrong
    r = client.post(f"/alerts/{a['id']}/check").json()
    assert r["state"] == "error" and "deleted" in r["last_error"]


# ---------- automations ----------


def test_automation_schedule_math():
    a = Automation(schedule="weekly", weekday=0, hour=9, timezone="Asia/Kolkata",
                   created_at=datetime(2026, 11, 1, tzinfo=timezone.utc))
    # Wed Nov 11 2026, 10:00 IST -> last occurrence Mon Nov 9 09:00 IST = 03:30 UTC
    now = datetime(2026, 11, 11, 4, 30, tzinfo=timezone.utc)
    assert last_occurrence(a, now) == datetime(2026, 11, 9, 3, 30, tzinfo=timezone.utc)
    assert automation_due(a, now)
    a.last_run_at = datetime(2026, 11, 9, 3, 31, tzinfo=timezone.utc)
    assert not automation_due(a, now)
    daily = Automation(schedule="daily", hour=9, timezone="UTC", created_at=datetime(2026, 11, 11, 10, tzinfo=timezone.utc))
    assert not automation_due(daily, datetime(2026, 11, 11, 12, tzinfo=timezone.utc))  # created after today's 09:00
    assert automation_due(daily, datetime(2026, 11, 12, 9, 1, tzinfo=timezone.utc))


def test_dashboard_digest_runs_and_tick(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = client.post(f"/datasets/{ds['id']}/starter-dashboard").json()
    body = {"name": "Monday digest", "dashboard_id": d["id"], "schedule": "daily", "hour": 9, "timezone": "UTC", "period_days": 366}
    a = client.post("/automations", json=body).json()
    assert client.post("/automations", json={**body, "timezone": "Mars/Base"}).status_code == 422
    r = client.post(f"/automations/{a['id']}/run").json()
    assert r["last_status"] == "Sent"
    hist = client.get("/alerts-history").json()[0]
    assert hist["automation_id"] == a["id"] and "•" in hist["body"]
    with Session(engine) as s:
        # nothing due right after a run
        assert tick(s, now=datetime.now(timezone.utc))["automations_run"] == 0
        assert run_automation(s, s.get(Automation, a["id"])).title.startswith(d["name"])


# ---------- webhook guard ----------


@pytest.mark.parametrize(
    "url",
    ["http://example.com/hook", "https://127.0.0.1/hook", "https://localhost/hook", "https://10.0.0.5/x",
     "https://169.254.169.254/latest/meta-data", "https://user:pw@example.com/x", "ftp://example.com"],
)
def test_webhook_guard_blocks(url):
    with pytest.raises(WebhookError):
        check_webhook_url(url)
