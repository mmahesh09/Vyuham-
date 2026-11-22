"""Wave 1 of the data platform: profiler, quality checks, query-built and linked datasets, lineage."""

import io
import json
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest
from sqlalchemy.orm import Session

from app import jobs, url_ingest
from app.models import Dataset, JobRun, QualityRun
from tests.test_query import SALES, sign_in, upload

ORDERS = b"order_id,customer,status,amount,ordered\n1,Asha,paid,100,2026-11-01\n2,Ravi,paid,50,2026-11-02\n3,Asha,refunded,-20,2026-11-03\n3,Meera,paid,70,\n"


# ---------- profile ----------


def test_profile_counts_blanks_ranges_and_top_values(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    p = client.get(f"/datasets/{ds['id']}/profile").json()
    assert p["rows"] == 6 and p["duplicate_rows"] == 0
    cols = {c["name"]: c for c in p["columns"]}
    assert cols["Amount"]["empty"] == 1 and cols["Amount"]["min"] == 25 and cols["Amount"]["max"] == 300
    assert cols["Amount"]["median"] is not None and sum(b["count"] for b in cols["Amount"]["histogram"]) == 5
    assert cols["Region"]["top"][0] == {"value": "North", "count": 3}
    assert cols["Date"]["timeline"]["points"]
    assert 0 < p["completeness"] < 1


def test_profile_is_private(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    sign_in(client, engine, uid="u2", token="tok-2", company="Other")
    assert client.get(f"/datasets/{ds['id']}/profile").status_code == 404


# ---------- quality ----------


def test_quality_rules_run_and_report_failures(client, engine):
    sign_in(client, engine)
    ds = upload(client, ORDERS, "orders.csv")
    url = f"/datasets/{ds['id']}/quality"
    assert client.post(f"{url}/run").status_code == 422  # no checks yet

    def add(**rule):
        r = client.post(f"{url}/rules", json=rule)
        assert r.status_code == 201, r.text
        return r.json()

    add(kind="unique", column="order_id")
    add(kind="range", column="amount", params={"min": 0})
    add(kind="accepted_values", column="status", params={"values": ["paid", "refunded"]})
    add(kind="not_null", column="ordered", severity="warn")
    add(kind="row_count", params={"min": 2})
    add(kind="sql", params={"sql": "SELECT * FROM orders WHERE amount > 1000"})
    run = client.post(f"{url}/run").json()
    by_kind = {r["kind"]: r for r in run["results"]}
    assert run["status"] == "fail" and run["row_count"] == 4
    assert by_kind["unique"]["failed"] == 2 and len(by_kind["unique"]["sample"]) == 2
    assert by_kind["range"]["failed"] == 1 and by_kind["range"]["sample"][0]["customer"] == "Asha"
    assert by_kind["accepted_values"]["status"] == "pass"
    assert by_kind["not_null"]["failed"] == 1 and by_kind["not_null"]["severity"] == "warn"
    assert by_kind["row_count"]["status"] == "pass" and by_kind["sql"]["status"] == "pass"

    overview = client.get(url).json()
    assert len(overview["rules"]) == 6 and overview["runs"][0]["id"] == run["id"]
    assert overview["rules"][0]["description"] == "order_id has no duplicates"


def test_quality_rule_validation(client, engine):
    sign_in(client, engine)
    ds = upload(client, ORDERS, "orders.csv")
    url = f"/datasets/{ds['id']}/quality/rules"
    assert client.post(url, json={"kind": "unique"}).status_code == 422  # needs a column
    assert client.post(url, json={"kind": "unique", "column": "ghost"}).status_code == 422
    assert client.post(url, json={"kind": "range", "column": "customer", "params": {"min": 0}}).status_code == 422  # not a number
    assert client.post(url, json={"kind": "range", "column": "amount", "params": {"min": 5, "max": 1}}).status_code == 422
    assert client.post(url, json={"kind": "regex", "column": "customer", "params": {"pattern": "("}}).status_code == 422
    assert client.post(url, json={"kind": "sql", "params": {"sql": "DROP TABLE orders"}}).status_code == 422
    assert client.post(url, json={"kind": "freshness", "column": "customer", "params": {"max_age_days": 1}}).status_code == 422


def test_freshness_and_suggestions(client, engine):
    sign_in(client, engine)
    ds = upload(client, ORDERS, "orders.csv")
    url = f"/datasets/{ds['id']}/quality"
    client.post(f"{url}/rules", json={"kind": "freshness", "column": "ordered", "params": {"max_age_days": 1}})
    run = client.post(f"{url}/run").json()
    assert run["results"][0]["status"] == "fail" and "2026-11-03" in run["results"][0]["message"]
    kinds = {(s["kind"], s["column"]) for s in client.get(url).json()["suggestions"]}
    assert ("not_null", "customer") in kinds and ("freshness", "ordered") not in kinds  # already a rule


def test_viewers_cannot_add_checks(client, engine):
    sign_in(client, engine)
    ds = upload(client, ORDERS, "orders.csv")
    from sqlalchemy import update

    from app.models import WorkspaceMember

    with Session(engine) as s:
        s.execute(update(WorkspaceMember).values(role="viewer"))
        s.commit()
    assert client.post(f"/datasets/{ds['id']}/quality/rules", json={"kind": "row_count", "params": {"min": 1}}).status_code == 403


# ---------- datasets from a query ----------


def test_save_query_as_dataset_with_lineage_and_rebuild(client, engine):
    sign_in(client, engine)
    sales = upload(client)
    r = client.post("/datasets/derived", json={
        "name": "Sales by region", "layer": "gold", "refresh": "daily",
        "sql": "SELECT Region, SUM(Amount) AS total FROM sales WHERE Amount >= {{min}} GROUP BY 1 ORDER BY 1",
        "params": [{"name": "min", "type": "number", "value": "50"}],
    })
    assert r.status_code == 201, r.text
    gold = r.json()
    assert gold["source_kind"] == "derived" and gold["layer"] == "gold" and gold["row_count"] == 3
    assert {c["name"] for c in gold["columns"]} == {"Region", "total"}
    assert client.get(f"/datasets/{gold['id']}/lineage").json()["upstream"][0]["id"] == sales["id"]
    assert client.get(f"/datasets/{sales['id']}/lineage").json()["downstream"][0]["name"] == "Sales by region"
    rows = client.get(f"/datasets/{gold['id']}/rows").json()["rows"]
    assert {r["Region"]: r["total"] for r in rows}["North"] == 300

    # The derived dataset is queryable like any other, and rebuilds from its saved query.
    from app.materialize import rebuild

    with Session(engine) as s:
        ds = s.get(Dataset, gold["id"])
        rebuild(s, ds)
        assert ds.sync_error is None and ds.last_synced_at is not None

    # Deleting the source leaves the derived data, drops the lineage, and a rebuild reports the problem.
    assert client.delete(f"/datasets/{sales['id']}").status_code == 204
    assert client.get(f"/datasets/{gold['id']}/lineage").json() == {"upstream": [], "downstream": []}


def test_bad_queries_are_refused(client, engine):
    sign_in(client, engine)
    upload(client)
    for sql in ("DELETE FROM sales", "SELECT * FROM read_csv('/etc/passwd')", "SELECT Region, Region FROM sales", "SELECT * FROM nope"):
        r = client.post("/datasets/derived", json={"name": "x", "sql": sql})
        assert r.status_code == 422, (sql, r.text)
    assert client.get("/datasets").json()[0]["name"] == "sales"  # nothing half-made left behind
    assert len(client.get("/datasets").json()) == 1


def test_derived_datasets_refresh_on_schedule(client, engine):
    sign_in(client, engine)
    upload(client)
    gold = client.post("/datasets/derived", json={"name": "g", "sql": "SELECT COUNT(*) AS n FROM sales", "refresh": "daily"}).json()
    with Session(engine) as s:
        ds = s.get(Dataset, gold["id"])
        ds.last_synced_at = ds.sync_started_at = ds.sync_finished_at = datetime.now(timezone.utc) - timedelta(days=2)
        s.commit()
        due = [d for d in jobs.find_due(s, datetime.now(timezone.utc)) if d.target_id == gold["id"]]
        assert due and due[0].kind == jobs.SYNC
        run = jobs.claim(s, due[0])
        jobs.run_job(s, run.id)
        assert s.get(JobRun, run.id).status == "done"


def test_daily_quality_job(client, engine):
    sign_in(client, engine)
    ds = upload(client, ORDERS, "orders.csv")
    client.post(f"/datasets/{ds['id']}/quality/rules", json={"kind": "unique", "column": "order_id"})
    later = datetime.now(timezone.utc) + timedelta(days=2)
    with Session(engine) as s:
        due = [d for d in jobs.find_due(s, later) if d.kind == jobs.QUALITY]
        assert [d.target_id for d in due] == [ds["id"]]
        run = jobs.claim(s, due[0])
        jobs.run_job(s, run.id, later)
        result = s.query(QualityRun).one()
        assert result.trigger == "schedule" and result.status == "fail"
        # A failed scheduled run tells the workspace.
        from app.models import Notification

        assert s.query(Notification).count() == 1


# ---------- more file types and links ----------


def test_json_and_parquet_uploads(client, engine):
    sign_in(client, engine)
    rows = [{"id": 1, "name": "Asha", "address": {"city": "Pune"}, "tags": ["a"]}, {"id": 2, "name": "Ravi", "address": {"city": "Delhi"}, "tags": []}]
    j = upload(client, json.dumps({"data": rows}).encode(), "people.json")
    assert j["source_kind"] == "json" and j["row_count"] == 2
    assert {c["name"] for c in j["columns"]} >= {"id", "name", "address.city", "tags"}
    lines = upload(client, b'{"a": 1}\n{"a": 2}\n', "events.jsonl")
    assert lines["row_count"] == 2

    buf = io.BytesIO()
    pd.DataFrame({"x": [1.5, 2.5], "when": pd.to_datetime(["2026-01-01", "2026-02-01"])}).to_parquet(buf, index=False)
    pq = upload(client, buf.getvalue(), "numbers.parquet")
    types = {c["name"]: c["type"] for c in pq["columns"]}
    assert types == {"x": "number", "when": "date"}
    r = client.post("/datasets", files={"file": ("bad.json", b"[1, 2]", "application/json")})
    assert r.status_code == 422


def test_link_import(client, engine, monkeypatch):
    sign_in(client, engine)
    monkeypatch.setattr(url_ingest, "_get", lambda url, limit: (SALES, "text/csv", url))
    r = client.post("/datasets/url", json={"url": "https://example.com/files/sales.csv", "layer": "bronze"})
    assert r.status_code == 201, r.text
    ds = r.json()
    assert ds["source_kind"] == "url" and ds["name"] == "sales" and ds["row_count"] == 6 and ds["layer"] == "bronze"
    assert ds["origin"] == {"kind": "url", "url": "https://example.com/files/sales.csv"}

    monkeypatch.setattr(url_ingest, "_get", lambda url, limit: (b"<!doctype html><html></html>", "text/html", url))
    assert client.post("/datasets/url", json={"url": "https://example.com/page"}).status_code == 422


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1/x.csv", "http://localhost/x.csv", "http://169.254.169.254/latest/meta-data", "ftp://example.com/x.csv", "https://example.com:22/x.csv", "https://user:pw@example.com/x.csv"],
)
def test_link_import_refuses_private_and_odd_links(url):
    with pytest.raises(url_ingest.UrlError):
        url_ingest._get(url, 1_000_000)


def test_google_sheets_links_become_csv_exports():
    assert url_ingest.normalise("https://docs.google.com/spreadsheets/d/abc_123/edit#gid=42") == (
        "https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=42"
    )
    assert url_ingest.filename_for("https://docs.google.com/spreadsheets/d/abc/export?format=csv", "text/csv") == "Google Sheet.csv"


def test_layer_and_description(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    got = client.patch(f"/datasets/{ds['id']}", json={"layer": "silver", "description": "Cleaned sales"}).json()
    assert (got["layer"], got["description"]) == ("silver", "Cleaned sales")
    assert client.patch(f"/datasets/{ds['id']}", json={"layer": ""}).json()["layer"] is None
    assert client.patch(f"/datasets/{ds['id']}", json={"refresh": "daily"}).status_code == 422  # an upload has nothing to re-run
