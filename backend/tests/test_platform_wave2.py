"""Wave 2 of the data platform: governance enforcement, SQL Workbench additions, pipelines, dynamic tables,
workload analysis and the AI endpoints' behaviour without a key."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app import jobs
from app.models import DynamicTable, Pipeline, WorkspaceMember
from tests.conftest import add_user
from tests.test_query import sign_in, upload

PEOPLE = (
    b"customer_id,full_name,email,phone,region,amount,signed_up\n"
    b"1,Asha Rao,asha@example.com,+91 98450 12345,North,100,2026-01-05\n"
    b"2,Ravi Kumar,ravi@example.com,+91 98450 22222,South,50,2026-01-20\n"
    b"3,Meera Shah,meera@example.org,+91 98450 33333,North,200,2026-02-03\n"
    b"4,John Doe,john@example.net,+1 415 555 0101,West,25,2026-02-14\n"
)
ORDERS = (
    b"order_id,customer_id,amount,ordered\n"
    b"10,1,100,2026-11-01\n11,2,50,2026-11-02\n11,2,50,2026-11-02\n12,3,70,2026-11-03\n13,9,30,2026-11-04\n"
)


def join_as(client, engine, ws: str, uid: str, role: str):
    """Sign in a second person who is a member of `ws` with `role`."""
    cookie = add_user(engine, uid, token=f"tok-{uid}", company="Acme")
    with Session(engine) as db:
        db.add(WorkspaceMember(user_id=uid, workspace_id=ws, role=role))
        db.commit()
    client.cookies.set("better-auth.session_token", cookie)


def owner_again(client, engine):
    client.cookies.set("better-auth.session_token", "tok-1.c2lnbmF0dXJl")


# ---------- governance ----------


def test_scanner_finds_pii_without_storing_values(client, engine):
    sign_in(client, engine)
    upload(client, PEOPLE, "people.csv")
    r = client.post("/governance/scan", json={})
    assert r.status_code == 200, r.text
    assert r.json()["default_policies_created"] is True
    found = {c["column"]: c for c in client.get("/governance/classifications").json()}
    assert found["email"]["pii_type"] == "email" and found["email"]["label"] == "confidential"
    assert found["phone"]["pii_type"] == "phone"
    assert found["full_name"]["pii_type"] == "person_name"
    assert "region" not in found and "amount" not in found
    assert "asha@example.com" not in str(found)


def test_masking_is_enforced_in_the_query_engine_for_viewers(client, engine):
    ws = sign_in(client, engine)
    ds = upload(client, PEOPLE, "people.csv")
    client.post("/governance/scan", json={})
    # Owner sees everything.
    rows = client.get(f"/datasets/{ds['id']}/rows").json()["rows"]
    assert rows[0]["email"] == "asha@example.com"

    join_as(client, engine, ws, "v1", "viewer")
    rows = client.get(f"/datasets/{ds['id']}/rows").json()["rows"]
    emails = {r["email"] for r in rows}
    assert "asha@example.com" not in emails and any(e.startswith("a***@") for e in emails)  # partial mask
    # Examples in the dataset metadata don't leak either.
    meta = client.get(f"/datasets/{ds['id']}").json()
    email_col = next(c for c in meta["columns"] if c["name"] == "email")
    assert email_col["examples"] == []
    # Distinct values come from the masked view too.
    vals = client.get(f"/datasets/{ds['id']}/values/email").json()
    assert "asha@example.com" not in vals


def test_restricted_columns_and_hidden_datasets(client, engine):
    ws = sign_in(client, engine)
    ds = upload(client, PEOPLE, "people.csv")
    other = upload(client, ORDERS, "orders.csv")
    assert client.put("/governance/access", json={"dataset_id": ds["id"], "column": "phone", "role": "editor", "access": "none"}).status_code == 200
    assert client.put("/governance/access", json={"dataset_id": other["id"], "role": "editor", "access": "none"}).status_code == 200

    join_as(client, engine, ws, "e1", "editor")
    r = client.post("/sql/run", json={"sql": "SELECT * FROM people"})
    assert r.status_code == 200, r.text
    assert "phone" not in r.json()["columns"]
    assert client.post("/sql/run", json={"sql": "SELECT * FROM orders"}).status_code == 422  # no such table for them
    assert client.get(f"/datasets/{other['id']}").status_code == 404
    assert other["id"] not in {d["id"] for d in client.get("/datasets").json()}
    tables = {t["table"] for t in client.get("/sql/schema").json()}
    assert "orders" not in tables
    # Only owners change governance.
    assert client.put("/governance/access", json={"dataset_id": ds["id"], "role": "editor", "access": "read"}).status_code == 403

    owner_again(client, engine)
    events = client.get("/governance/audit?group=permissions").json()["events"]
    assert sum(1 for e in events if e["action"] == "permission.update") == 2


def test_sql_cannot_read_files_directly(client, engine):
    sign_in(client, engine)
    ds = upload(client, PEOPLE, "people.csv")
    for sql in [f"SELECT * FROM read_parquet('{ds['id']}.parquet')", f"SELECT * FROM '{ds['id']}.parquet'", "SELECT * FROM glob('*')"]:
        r = client.post("/sql/run", json={"sql": sql})
        assert r.status_code == 422 and "table names" in r.json()["detail"]


def test_shared_link_viewers_get_masked_values(client, engine):
    from app import governance as gov

    ws = sign_in(client, engine)
    ds = upload(client, PEOPLE, "people.csv")
    client.post("/governance/scan", json={})
    with Session(engine) as db:
        a = gov.access_for(db, ws, "public")
        assert gov.column_method(a, ds["id"], "email") == "partial"
        assert gov.access_for(db, ws, "owner") == {}


def test_export_is_audited(client, engine):
    sign_in(client, engine)
    upload(client, PEOPLE, "people.csv")
    r = client.post("/sql/export", json={"sql": "SELECT region, SUM(amount) AS total FROM people GROUP BY 1"})
    assert r.status_code == 200 and "region" in r.text
    events = client.get("/governance/audit?group=exports").json()["events"]
    assert events and events[0]["action"] == "data.export"


def test_retention_policy_validation(client, engine):
    sign_in(client, engine)
    bad = client.post("/governance/policies", json={"kind": "retention", "name": "Short", "rules": {"audit_days": 2}})
    assert bad.status_code == 422
    ok = client.post("/governance/policies", json={"kind": "retention", "name": "Keep 90 days", "rules": {"query_history_days": 90}})
    assert ok.status_code == 201


# ---------- SQL Workbench ----------


def test_projects_folders_and_cancel(client, engine):
    sign_in(client, engine)
    upload(client, PEOPLE, "people.csv")
    p = client.post("/sql/projects", json={"name": "Finance"}).json()
    q = client.post("/sql/saved", json={"name": "Totals", "sql": "SELECT 1", "project_id": p["id"], "folder": " Monthly / Revenue/ "})
    assert q.status_code == 201, q.text
    assert q.json()["folder"] == "Monthly/Revenue" and q.json()["project_id"] == p["id"]
    assert client.post("/sql/saved", json={"name": "X", "sql": "SELECT 1", "project_id": "nope"}).status_code == 422
    assert client.post("/sql/cancel/not-running").status_code == 404


def test_runs_are_fingerprinted_for_workload_analysis(client, engine):
    sign_in(client, engine)
    upload(client, PEOPLE, "people.csv")
    for n in (1, 2, 3):
        assert client.post("/sql/run", json={"sql": f"SELECT * FROM people WHERE amount > {n}"}).status_code == 200
    s = client.get("/usage/summary?days=7").json()
    assert s["billed"]["available"] is False
    assert s["measured"]["queries"] == 3
    top = s["by_query"][0]
    assert top["runs"] == 3  # same shape, different literal
    assert s["measured"]["scanned_bytes_upper_bound"] > 0
    assert s["estimated"]["rates_set"] is False and s["estimated"]["total"] == 0
    assert s["measured"]["notebooks"]["tracked"] is False


def test_cost_rates_turn_usage_into_estimates(client, engine):
    sign_in(client, engine)
    upload(client, PEOPLE, "people.csv")
    client.post("/sql/run", json={"sql": "SELECT * FROM people"})
    r = client.put("/usage/settings", json={"currency": "usd", "compute_per_hour": 3600, "storage_per_gb_month": 10, "monthly_budget": 100})
    assert r.status_code == 200 and r.json()["currency"] == "USD"
    s = client.get("/usage/summary").json()
    assert s["estimated"]["rates_set"] is True and s["estimated"]["storage"] > 0
    assert s["budget"]["status"] in ("ok", "warn", "over")


# ---------- AI without a key ----------


def test_ai_endpoints_say_when_ai_is_not_set_up(client, engine):
    sign_in(client, engine)
    upload(client, PEOPLE, "people.csv")
    assert client.get("/ai/status").json() == {"enabled": False}
    r = client.post("/ai/sql", json={"action": "write", "question": "revenue by region"})
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["detail"]
    assert client.post("/pipelines/ai/plan", json={"request": "daily revenue by region"}).status_code == 503


def test_ai_context_has_real_tables_and_no_sensitive_examples(client, engine):
    from app.ai import schema_context
    from app.models import Dataset

    sign_in(client, engine)
    upload(client, PEOPLE, "people.csv")
    client.post("/governance/scan", json={})
    with Session(engine) as db:
        member = db.query(WorkspaceMember).first()
        text, tables = schema_context(db, member, list(db.query(Dataset).all()))
    assert "people" in text and '"email" text' in text
    assert "asha@example.com" not in text and "Asha Rao" not in text


# ---------- pipelines ----------


def _graph(orders_id: str, people_id: str, mode="replace") -> dict:
    def node(i, label, cfg, kind="agent"):
        return {"id": i, "type": "blueprint", "position": {"x": 0, "y": 0}, "data": {"label": label, "detail": "", "kind": kind, "config": cfg}}

    return {
        "nodes": [
            node("t", "Daily", {"type": "schedule"}, "trigger"),
            node("o", "Read orders", {"type": "source", "name": "raw_orders", "dataset_id": orders_id}, "integration"),
            node("c", "Read customers", {"type": "source", "name": "raw_customers", "dataset_id": people_id}, "integration"),
            node("d", "Remove duplicates", {"type": "dedupe", "name": "orders_unique", "keys": ["order_id"]}),
            node("v", "Valid customers", {"type": "validate", "name": "orders_valid", "on_fail": "drop", "checks": [
                {"type": "references", "column": "customer_id", "ref_table": "raw_customers", "ref_column": "customer_id"},
                {"type": "not_null", "column": "amount"}]}, "review"),
            node("j", "Revenue by region", {"type": "sql", "name": "revenue_by_region", "sql":
                "SELECT c.region, SUM(o.amount) AS revenue FROM orders_valid o JOIN raw_customers c USING (customer_id) GROUP BY 1"}),
            node("w", "Gold table", {"type": "destination", "target_name": "Revenue by region", "layer": "gold", "mode": mode}, "delivery"),
        ],
        "edges": [{"id": f"{a}-{b}", "source": a, "target": b} for a, b in
                  [("t", "o"), ("t", "c"), ("o", "d"), ("d", "v"), ("c", "j"), ("v", "j"), ("j", "w")]],
    }


def test_pipeline_runs_end_to_end_and_writes_a_gold_table(client, engine):
    sign_in(client, engine)
    people = upload(client, PEOPLE, "people.csv")
    orders = upload(client, ORDERS, "orders.csv")
    g = _graph(orders["id"], people["id"])
    assert client.post("/pipelines/check", json={"graph": g}).json() == {"problems": [], "steps": {}}
    prev = client.post("/pipelines/preview", json={"graph": g, "node_id": "j"}).json()
    assert {r["region"]: r["revenue"] for r in prev["rows"]} == {"North": 170, "South": 50}
    p = client.post("/pipelines", json={"name": "Revenue", "graph": g, "schedule": "daily"}).json()
    assert p["problems"] == [] and p["needs_approval"] is False
    r = client.post(f"/pipelines/{p['id']}/runs", json={})
    assert r.status_code == 202, r.text
    run = client.get(f"/pipelines/{p['id']}/runs/{r.json()['id']}").json()
    assert run["status"] == "success", run
    assert run["steps"]["d"]["rows"] == 4 and run["steps"]["v"]["rows"] == 3  # 1 duplicate, 1 unknown customer dropped
    assert run["steps"]["v"]["checks"][0]["failed_rows"] == 1
    gold = next(d for d in client.get("/datasets").json() if d["name"] == "Revenue by region")
    assert gold["layer"] == "gold" and gold["row_count"] == 2
    lineage = client.get(f"/datasets/{gold['id']}/lineage").json()
    assert {u["id"] for u in lineage["upstream"]} == {people["id"], orders["id"]}


def test_pipeline_failure_logs_and_retry_selected_steps(client, engine):
    sign_in(client, engine)
    people = upload(client, PEOPLE, "people.csv")
    orders = upload(client, ORDERS, "orders.csv")
    g = _graph(orders["id"], people["id"])
    g["nodes"][5]["data"]["config"]["sql"] = "SELECT c.region, SUM(o.no_such_column) AS revenue FROM orders_valid o JOIN raw_customers c USING (customer_id) GROUP BY 1"
    p = client.post("/pipelines", json={"name": "Revenue", "graph": g}).json()
    rid = client.post(f"/pipelines/{p['id']}/runs", json={}).json()["id"]
    run = client.get(f"/pipelines/{p['id']}/runs/{rid}").json()
    assert run["status"] == "failed" and run["steps"]["j"]["status"] == "failed" and run["steps"]["w"]["status"] == "skipped"
    assert "no_such_column" in run["steps"]["j"]["error"]
    g["nodes"][5]["data"]["config"]["sql"] = "SELECT c.region, SUM(o.amount) AS revenue FROM orders_valid o JOIN raw_customers c USING (customer_id) GROUP BY 1"
    client.put(f"/pipelines/{p['id']}", json={"name": "Revenue", "graph": g})
    rid2 = client.post(f"/pipelines/{p['id']}/runs", json={"only_steps": ["j"], "retry_of": rid}).json()["id"]
    run2 = client.get(f"/pipelines/{p['id']}/runs/{rid2}").json()
    assert run2["status"] == "success", run2
    assert run2["steps"]["d"].get("reused") is True and run2["steps"]["j"].get("reused") is not True


def test_pipeline_validation_and_cycles(client, engine):
    sign_in(client, engine)
    orders = upload(client, ORDERS, "orders.csv")
    g = {"nodes": [
        {"id": "a", "data": {"label": "A", "config": {"type": "source", "name": "orders", "dataset_id": orders["id"]}}},
        {"id": "b", "data": {"label": "B", "config": {"type": "sql", "name": "b", "sql": "DELETE FROM a"}}},
    ], "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}]}
    problems = client.post("/pipelines/check", json={"graph": g}).json()["problems"]
    text = " ".join(problems)
    assert "cycle" in text and "already a dataset table" in text and "SELECT" in text


def test_ai_pipelines_need_approval_and_overwrites_need_confirmation(client, engine):
    from app.models import AiAction

    ws = sign_in(client, engine)
    people = upload(client, PEOPLE, "people.csv")
    orders = upload(client, ORDERS, "orders.csv")
    with Session(engine) as db:
        uid = db.query(WorkspaceMember).first().user_id
        a = AiAction(workspace_id=ws, user_id=uid, kind="pipeline_plan", status="ok", outcome="proposed")
        db.add(a)
        db.commit()
        aid = a.id
    g = _graph(orders["id"], people["id"])
    g["nodes"][6]["data"]["config"]["target_name"] = "people"  # an existing dataset the pipeline didn't create
    p = client.post("/pipelines", json={"name": "AI", "graph": g, "ai_action_id": aid}).json()
    assert p["needs_approval"] is True
    assert client.post(f"/pipelines/{p['id']}/runs", json={}).status_code == 409
    assert client.post(f"/pipelines/{p['id']}/approve").status_code == 200
    rid = client.post(f"/pipelines/{p['id']}/runs", json={}).json()["id"]
    run = client.get(f"/pipelines/{p['id']}/runs/{rid}").json()
    assert run["status"] == "failed" and "Confirm overwrite" in run["error"]
    rid = client.post(f"/pipelines/{p['id']}/runs", json={"confirm_overwrite": True}).json()["id"]
    assert client.get(f"/pipelines/{p['id']}/runs/{rid}").json()["status"] == "success"
    outcomes = {x["outcome"] for x in client.get(f"/ai/actions?ref_id={p['id']}").json()}
    assert outcomes == {"approved"}


def test_pipeline_optimizer_finds_repeated_scans_and_dead_ends(client, engine):
    sign_in(client, engine)
    orders = upload(client, ORDERS, "orders.csv")
    g = {"nodes": [
        {"id": "a", "data": {"label": "A", "config": {"type": "source", "name": "a", "dataset_id": orders["id"]}}},
        {"id": "b", "data": {"label": "B", "config": {"type": "sql", "name": "b", "sql": "SELECT * FROM a"}}},
        {"id": "c", "data": {"label": "C", "config": {"type": "sql", "name": "c", "sql": "SELECT * FROM orders"}}},
    ], "edges": [{"source": "a", "target": "b"}]}
    p = client.post("/pipelines", json={"name": "Messy", "graph": g}).json()
    kinds = {s["kind"] for s in client.get(f"/pipelines/{p['id']}/optimize").json()["suggestions"]}
    assert {"unnecessary_step", "repeated_scan"} <= kinds


def test_scheduled_pipeline_runs_from_the_job_tick(client, engine):
    sign_in(client, engine)
    people = upload(client, PEOPLE, "people.csv")
    orders = upload(client, ORDERS, "orders.csv")
    p = client.post("/pipelines", json={"name": "Hourly", "graph": _graph(orders["id"], people["id"]), "schedule": "hourly"}).json()
    with Session(engine) as db:
        row = db.get(Pipeline, p["id"])
        row.created_at = datetime.now(timezone.utc) - timedelta(hours=3)
        db.commit()
        counts = jobs.tick(db)
        assert counts.get("platform_jobs", 0) >= 1
        db.refresh(row)
        assert row.last_status == "success"


# ---------- dynamic tables ----------


def test_dynamic_table_create_refresh_history_and_schema_change(client, engine):
    sign_in(client, engine)
    upload(client, ORDERS, "orders.csv")
    v = client.post("/dynamic-tables/validate", json={"sql": "SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY 1"}).json()
    assert v["ok"] and v["dependencies"][0]["name"] == "orders"
    r = client.post("/dynamic-tables", json={"name": "Customer totals", "sql": "SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY 1",
                                             "interval_minutes": 60, "layer": "gold"})
    assert r.status_code == 201, r.text
    t = client.get(f"/dynamic-tables/{r.json()['id']}").json()
    assert t["status"] == "ok" and t["row_count"] == 4 and t["refresh_mode"] == "full" and "Full refresh" in t["refresh_mode_note"]
    assert t["next_refresh_at"] is not None
    prev = client.get(f"/dynamic-tables/{t['id']}/preview").json()
    assert prev["row_count"] == 4 and "total" in prev["columns"]
    # Change the definition: a new column is detected as a schema change.
    upd = client.put(f"/dynamic-tables/{t['id']}", json={"name": "Customer totals", "sql": "SELECT customer_id, SUM(amount) AS total, COUNT(*) AS n FROM orders GROUP BY 1"})
    assert upd.status_code == 200
    hist = client.get(f"/dynamic-tables/{t['id']}/refreshes").json()
    assert len(hist) == 2 and hist[0]["schema_change"]["added"] == ["n"] and all(h["status"] == "success" for h in hist)
    # Pause and resume.
    assert client.patch(f"/dynamic-tables/{t['id']}", json={"paused": True}).json()["status"] == "paused"
    assert client.patch(f"/dynamic-tables/{t['id']}", json={"paused": False}).json()["status"] == "ok"


def test_dynamic_table_cycles_are_refused(client, engine):
    sign_in(client, engine)
    upload(client, ORDERS, "orders.csv")
    a = client.post("/dynamic-tables", json={"name": "A", "sql": "SELECT * FROM orders"}).json()
    b = client.post("/dynamic-tables", json={"name": "B", "sql": "SELECT * FROM a"}).json()
    r = client.put(f"/dynamic-tables/{a['id']}", json={"name": "A", "sql": "SELECT * FROM b"})
    assert r.status_code == 422 and "cycle" in r.json()["detail"]
    graph = client.get("/dynamic-tables/graph").json()
    assert {"from": a["dataset_id"], "to": b["dataset_id"]} in graph["edges"]


def test_incremental_refresh_appends_only_newer_rows(client, engine):
    sign_in(client, engine)
    upload(client, ORDERS, "orders.csv")
    assert client.post("/dynamic-tables", json={"name": "Inc", "sql": "SELECT * FROM orders", "refresh_mode": "incremental"}).status_code == 422
    t = client.post("/dynamic-tables", json={"name": "Inc", "sql": "SELECT * FROM orders WHERE order_id < 12",
                                             "refresh_mode": "incremental", "watermark_column": "order_id"}).json()
    assert client.get(f"/dynamic-tables/{t['id']}").json()["row_count"] == 3  # first refresh is full
    client.put(f"/dynamic-tables/{t['id']}", json={"name": "Inc", "sql": "SELECT * FROM orders", "refresh_mode": "incremental", "watermark_column": "order_id"})
    # The PUT forces a full rebuild; now an incremental refresh with nothing new adds 0 rows.
    r = client.post(f"/dynamic-tables/{t['id']}/refresh", json={}).json()
    hist = client.get(f"/dynamic-tables/{t['id']}/refreshes").json()
    assert hist[0]["mode"] == "incremental" and hist[0]["rows_added"] == 0 and r["id"] == hist[0]["id"]


def test_dependency_aware_scheduler_refreshes_upstream_first(client, engine):
    from app import dynamic_tables as dt

    sign_in(client, engine)
    upload(client, ORDERS, "orders.csv")
    a = client.post("/dynamic-tables", json={"name": "Up", "sql": "SELECT * FROM orders", "interval_minutes": 60}).json()
    b = client.post("/dynamic-tables", json={"name": "Down", "sql": "SELECT COUNT(*) AS n FROM up", "interval_minutes": 60}).json()
    with Session(engine) as db:
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        for tid in (a["id"], b["id"]):
            db.get(DynamicTable, tid).next_refresh_at = past
        db.commit()
        due = [t.id for t, _ in dt.find_due(db, datetime.now(timezone.utc))]
        assert due == [a["id"]]  # the downstream table waits for its upstream
