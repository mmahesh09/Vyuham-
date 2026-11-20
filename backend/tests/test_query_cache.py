"""The query cache: repeat views skip DuckDB, and any change to the data is a different key."""

import pytest

from app import cache, query
from tests.test_dashboards import spec
from tests.test_query import SALES, sign_in, upload


@pytest.fixture
def scans(monkeypatch):
    """Counts DuckDB queries actually executed."""
    cache.clear()
    n = [0]
    original = query._execute

    def counted(con, sql, params, op):
        n[0] += 1
        return original(con, sql, params, op)

    monkeypatch.setattr(query, "_execute", counted)
    yield n
    cache.clear()


def view(client, d):
    return client.get(f"/dashboards/{d['id']}/view").json()


def test_repeat_dashboard_views_come_from_the_cache(client, engine, scans):
    sign_in(client, engine)
    ds = upload(client)
    d = client.post("/dashboards", json={"name": "Sales"}).json()
    client.post(f"/dashboards/{d['id']}/charts", json={"spec": spec(ds["id"], groupBy="Region")})
    client.post(f"/dashboards/{d['id']}/charts", json={"spec": spec(ds["id"], chartType="kpi")})

    first = view(client, d)
    used = scans[0]
    assert used >= 2
    second = view(client, d)
    assert scans[0] == used  # no new DuckDB queries
    assert second["charts"] == first["charts"]


def test_new_data_is_never_served_from_the_cache(client, engine, scans):
    sign_in(client, engine)
    ds = upload(client)
    s = spec(ds["id"], chartType="kpi")
    before = client.post("/charts/preview", json={"spec": s}).json()["rows"][0]["sum_Amount"]
    client.put(f"/datasets/{ds['id']}/file", files={"file": ("sales.csv", SALES + b"2026-04-01,North,Pro,1000\n", "text/csv")})
    after = client.post("/charts/preview", json={"spec": s}).json()["rows"][0]["sum_Amount"]
    assert after == before + 1000


def test_changing_a_column_type_is_a_new_key(client, engine, scans):
    sign_in(client, engine)
    ds = upload(client)
    before = {c["name"]: c["type"] for c in ds["columns"]}["Region"]
    new_type = "category" if before != "category" else "text"
    s = spec(ds["id"], metrics=[{"field": "Region", "agg": "count_distinct"}], chartType="kpi")
    client.post("/charts/preview", json={"spec": s})
    used = scans[0]
    r = client.patch(f"/datasets/{ds['id']}", json={"column_types": {"Region": new_type}})
    assert {c["name"]: c["type"] for c in r.json()["columns"]}["Region"] == new_type
    assert client.post("/charts/preview", json={"spec": s}).status_code == 200
    assert scans[0] > used  # the definitions changed, so the result was recomputed


def test_a_caller_changing_rows_cannot_corrupt_the_cache(client, engine, scans):
    sign_in(client, engine)
    ds = upload(client)
    from sqlalchemy.orm import Session

    from app.models import Dataset

    with Session(engine) as db:
        dataset = db.get(Dataset, ds["id"])
        con = query.connect(dataset.workspace_id, [dataset])
        s = spec(ds["id"], groupBy="Region")
        rows = query.run_spec(con, s, dataset)
        rows[0]["sum_Amount"] = -1
        assert query.run_spec(con, s, dataset)[0]["sum_Amount"] != -1
        con.close()


def test_ask_looks_up_values_in_two_datasets_at_most(client, engine, scans):
    sign_in(client, engine)
    upload(client)
    for i in range(5):  # unrelated datasets, each with category columns
        upload(client, b"Team,Stage,Value\n" + b"".join(f"T{j},S{j % 3},{j}\n".encode() for j in range(20)), name=f"other{i}.csv")
    r = client.post("/ask", json={"question": "total amount by region in North"}).json()
    assert r["answered"] is True
    # Two datasets x their category columns at most, plus the chart itself: not every column of every dataset.
    assert scans[0] <= 2 * 3 + 3
