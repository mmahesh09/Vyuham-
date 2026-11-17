"""SQL Lab: builder state on saved queries, and scheduled saved queries (export, preview, delivery)."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import jobs
from app.auth_tables import user_table
from app.models import AlertEvent, Automation, Notification, ReportRun
from tests.test_query import sign_in, upload

BY_REGION = 'SELECT "Region", SUM("Amount") AS total FROM sales GROUP BY 1 ORDER BY 2 DESC'
BUILDER = {"version": 1, "from": "sales", "mode": "summary", "groupBy": [{"column": "Region"}], "measures": [{"agg": "sum", "column": "Amount"}]}


def save(client, sql=BY_REGION, name="Revenue by region", **extra):
    r = client.post("/sql/saved", json={"name": name, "sql": sql, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def verify_email(engine, uid="u1"):
    with engine.begin() as c:
        c.execute(update(user_table).where(user_table.c.id == uid).values(emailVerified=True))


# ---------- builder state ----------


def test_builder_state_is_saved_with_the_query(client, engine):
    sign_in(client, engine)
    upload(client)
    q = save(client, builder_state=BUILDER)
    assert q["builder_state"] == BUILDER and q["schedule"] is None
    listed = client.get("/sql/saved").json()
    assert listed[0]["builder_state"] == BUILDER
    # Editing the SQL by hand drops the builder state (the client sends null).
    upd = client.put(f"/sql/saved/{q['id']}", json={"name": q["name"], "sql": BY_REGION + " LIMIT 5", "builder_state": None}).json()
    assert upd["builder_state"] is None


def test_builder_state_size_is_capped(client, engine):
    sign_in(client, engine)
    r = client.post("/sql/saved", json={"name": "Big", "sql": "SELECT 1", "builder_state": {"x": "y" * 30_000}})
    assert r.status_code == 422


# ---------- schedule CRUD ----------


def test_schedule_create_read_update_delete(client, engine):
    sign_in(client, engine)
    upload(client)
    q = save(client)
    assert client.get(f"/sql/saved/{q['id']}/schedule").json() is None

    body = {"schedule": "weekly", "hour": 8, "weekday": 0, "timezone": "Asia/Kolkata", "format": "xlsx", "inapp": True}
    r = client.put(f"/sql/saved/{q['id']}/schedule", json=body)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["label"] == "Mondays at 08:00 (Asia/Kolkata)" and s["format"] == "xlsx"
    assert s["next_run_at"] is not None and s["last_run_at"] is None
    assert client.get("/sql/saved").json()[0]["schedule"] == "Mondays at 08:00 (Asia/Kolkata)"

    # One schedule per query: a second PUT updates it.
    s2 = client.put(f"/sql/saved/{q['id']}/schedule", json={**body, "schedule": "daily", "enabled": False}).json()
    assert s2["id"] == s["id"] and s2["label"].startswith("Daily at 08:00") and s2["label"].endswith("paused")
    assert s2["next_run_at"] is None

    # Scheduled queries live in SQL Lab, not in the Alerts page's automation list.
    assert client.get("/automations").json() == []

    assert client.delete(f"/sql/saved/{q['id']}/schedule").status_code == 204
    assert client.get(f"/sql/saved/{q['id']}/schedule").json() is None


def test_schedule_validation(client, engine):
    sign_in(client, engine)
    upload(client)
    q = save(client)
    url = f"/sql/saved/{q['id']}/schedule"
    assert client.put(url, json={"timezone": "Mars/Olympus"}).status_code == 422
    assert client.put(url, json={"hour": 25}).status_code == 422
    assert client.put(url, json={"inapp": False, "emails": []}).status_code == 422  # nowhere to send it
    assert client.put(url, json={"emails": ["not-an-email"]}).status_code == 422
    # Email delivery uses the same checks as alerts (a confirmed address is required in production).
    verify_email(engine)
    assert client.put(url, json={"emails": ["boss@acme.co"]}).status_code == 200


def test_deleting_the_query_deletes_its_schedule(client, engine):
    sign_in(client, engine)
    upload(client)
    q = save(client)
    client.put(f"/sql/saved/{q['id']}/schedule", json={"inapp": True})
    assert client.delete(f"/sql/saved/{q['id']}").status_code == 204
    with Session(engine) as s:
        assert s.scalars(select(Automation)).all() == []


def test_other_workspaces_cannot_schedule_my_query(client, engine):
    sign_in(client, engine)
    upload(client)
    q = save(client)
    sign_in(client, engine, uid="u2", token="tok-2", company="Other")
    assert client.put(f"/sql/saved/{q['id']}/schedule", json={"inapp": True}).status_code == 404


# ---------- running ----------


def _make_due(engine):
    """Pretend the schedule was created two days ago, so its last occurrence is due now."""
    with engine.begin() as c:
        c.execute(update(Automation).values(created_at=datetime.now(timezone.utc) - timedelta(days=2)))


def test_a_due_schedule_exports_and_sends_a_preview(client, engine, monkeypatch):
    sign_in(client, engine)
    upload(client)
    verify_email(engine)
    q = save(client)
    expected = client.post("/sql/run", json={"sql": BY_REGION}).json()["row_count"]
    client.put(f"/sql/saved/{q['id']}/schedule", json={"schedule": "daily", "hour": 0, "format": "csv", "inapp": True, "emails": ["boss@acme.co"]})
    _make_due(engine)
    sent = []
    monkeypatch.setattr("app.notify.send_email", lambda to, subject, body, link=None: sent.append((to, subject, body)) or len(to))

    with Session(engine) as s:
        counts = jobs.tick(s, datetime.now(timezone.utc))
        assert counts["automations_run"] == 1
        run = s.scalars(select(ReportRun)).one()
        assert run.trigger == "schedule" and run.status == "done" and run.format == "csv" and run.rows == expected
        event = s.scalars(select(AlertEvent)).one()
        assert f"{expected} rows." in event.body and "Region | total" in event.body and "West" in event.body
        assert "/api/report-files/" in event.body  # signed download link
        assert s.scalars(select(Notification)).all(), "in-app notification"
        a = s.scalars(select(Automation)).one()
        assert a.last_status == f"Sent ({expected} rows)"
        # Not sent again until the next occurrence.
        assert jobs.tick(s, datetime.now(timezone.utc) + timedelta(minutes=5))["automations_run"] == 0
    assert sent and sent[0][0] == ["boss@acme.co"] and sent[0][1].startswith("Revenue by region")
    assert client.get(f"/sql/saved/{q['id']}/schedule").json()["last_status"] == f"Sent ({expected} rows)"


def test_only_if_rows_sends_nothing_for_an_empty_result(client, engine):
    sign_in(client, engine)
    upload(client)
    q = save(client, sql='SELECT * FROM sales WHERE "Amount" > 1000000', name="Huge orders")
    client.put(f"/sql/saved/{q['id']}/schedule", json={"hour": 0, "inapp": True, "only_if_rows": True})
    _make_due(engine)
    with Session(engine) as s:
        jobs.tick(s, datetime.now(timezone.utc))
        assert s.scalars(select(Notification)).all() == []
        assert s.scalars(select(Automation)).one().last_status == "No rows; nothing sent"


def test_a_broken_query_is_recorded_not_retried(client, engine):
    sign_in(client, engine)
    upload(client)
    q = save(client, sql="SELECT * FROM sales")
    client.put(f"/sql/saved/{q['id']}/schedule", json={"hour": 0, "inapp": True})
    # The dataset behind it disappears.
    ds = client.get("/datasets").json()[0]
    client.delete(f"/datasets/{ds['id']}")
    _make_due(engine)
    with Session(engine) as s:
        jobs.tick(s, datetime.now(timezone.utc))
        a = s.scalars(select(Automation)).one()
        assert a.last_status.startswith("Failed:")
        from app.models import JobRun

        assert s.scalars(select(JobRun)).one().status == "failed"


# ---------- builder-shaped SQL ----------
# The same shapes features/sql-lab/builder/compile.ts produces (see its compile.test.ts): quoted aliases,
# date buckets, typed {{p}} parameters for every filter value, ILIKE, IN lists, BETWEEN, a case-insensitive join.

BUILDER_SQL = """SELECT date_trunc('month', a."Date") AS "Date_month",
       b."Manager",
       SUM(a."Amount") AS "sum_Amount",
       COUNT(*) AS "rows"
FROM "sales" AS a
LEFT JOIN "managers" AS b ON lower(trim(CAST(a."Region" AS VARCHAR))) = lower(trim(CAST(b."Region" AS VARCHAR)))
WHERE a."Amount" BETWEEN {{p1}} AND {{p2}}
  AND a."Date" >= {{p3}}
  AND a."Region" IN ({{p4}}, {{p5}})
  AND CAST(a."Product" AS VARCHAR) ILIKE '%' || {{p6}} || '%'
GROUP BY 1, 2
ORDER BY "Date_month" ASC NULLS LAST
LIMIT 500"""
BUILDER_PARAMS = [
    {"name": "p1", "type": "number", "value": "10"},
    {"name": "p2", "type": "number", "value": "250"},
    {"name": "p3", "type": "date", "value": "2026-01-01"},
    {"name": "p4", "type": "text", "value": "North"},
    {"name": "p5", "type": "text", "value": "South"},
    {"name": "p6", "type": "text", "value": "pro"},
]


def test_builder_shaped_sql_runs(client, engine):
    sign_in(client, engine)
    upload(client)
    upload(client, b"Region,Manager\n  north ,Asha\nSOUTH,Ravi\n", "managers.csv")
    r = client.post("/sql/run", json={"sql": BUILDER_SQL, "params": BUILDER_PARAMS})
    assert r.status_code == 200, r.text
    rows = sorted(r.json()["rows"], key=lambda x: (x["Date_month"], x["Manager"]))
    assert rows == [
        {"Date_month": "2026-01-01", "Manager": "Asha", "sum_Amount": 100.0, "rows": 1},
        {"Date_month": "2026-01-01", "Manager": "Ravi", "sum_Amount": 50.0, "rows": 1},
        {"Date_month": "2026-02-01", "Manager": "Asha", "sum_Amount": 25.0, "rows": 1},
    ]
