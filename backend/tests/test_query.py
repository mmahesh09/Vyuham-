import json
from datetime import date

import pytest
from sqlalchemy import update

from app.models import WorkspaceMember
from app.query import Filters, QueryError, compile_spec, connect, run_spec, run_sql
from tests.conftest import add_user

SALES = (
    b"Date,Region,Product,Amount\n"
    b"2026-01-05,North,Pro,100\n"
    b"2026-01-20,South,Pro,50\n"
    b"2026-02-03,North,Setup,200\n"
    b"2026-02-14,North,Pro,25\n"
    b"2026-03-01,West,Setup,300\n"
    b"2026-03-15,,Pro,\n"
)


def sign_in(client, engine, uid="u1", token="tok-1", company="Acme"):
    client.cookies.set("better-auth.session_token", add_user(engine, uid, token=token, company=company))
    return client.get("/me").json()["workspace"]["id"]


def upload(client, data=SALES, name="sales.csv"):
    r = client.post("/datasets", files={"file": (name, data, "text/csv")})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def sales(client, engine):
    """(workspace_id, dataset ORM row) for the SALES file."""
    from app.models import Dataset
    from sqlalchemy.orm import Session

    ws = sign_in(client, engine)
    body = upload(client)
    with Session(engine) as s:
        ds = s.get(Dataset, body["id"])
        s.expunge(ds)
    return ws, ds


def spec(**kw):
    return {"dataset": "x", "metrics": [{"field": "Amount", "agg": "sum"}], "chartType": "bar", "title": "t", **kw}


# ---------- numbers ----------


def test_sum_by_category_sorted_desc(sales):
    ws, ds = sales
    con = connect(ws, [ds])
    rows = run_spec(con, spec(groupBy="Region"), ds)
    # biggest first; the row with a blank region is dropped
    assert rows == [
        {"Region": "North", "sum_Amount": 325},
        {"Region": "West", "sum_Amount": 300},
        {"Region": "South", "sum_Amount": 50},
    ]


def test_month_buckets_in_order(sales):
    ws, ds = sales
    rows = run_spec(connect(ws, [ds]), spec(groupBy="Date", dateBucket="month", chartType="line"), ds)
    assert [(r["Date"], r["sum_Amount"]) for r in rows] == [("2026-01", 150), ("2026-02", 225), ("2026-03", 300)]


def test_quarter_bucket(sales):
    ws, ds = sales
    rows = run_spec(connect(ws, [ds]), spec(groupBy="Date", dateBucket="quarter"), ds)
    assert rows == [{"Date": "2026-Q1", "sum_Amount": 675}]


def test_kpi_count_rows_and_avg(sales):
    ws, ds = sales
    rows = run_spec(connect(ws, [ds]), spec(metrics=[{"field": "*", "agg": "count"}, {"field": "Amount", "agg": "avg"}]), ds)
    assert rows == [{"count_*": 6, "avg_Amount": 135.0}]


def test_chart_and_dashboard_filters(sales):
    ws, ds = sales
    con = connect(ws, [ds])
    f = [{"field": "Product", "op": "eq", "value": "Pro"}]
    dash = Filters(date_field="Date", date_from=date(2026, 1, 1), date_to=date(2026, 1, 31), equals={"Region": "North"})
    assert run_spec(con, spec(filters=f), ds, dash) == [{"sum_Amount": 100}]
    # date_to is inclusive of the whole day
    dash2 = Filters(date_field="Date", date_from=date(2026, 3, 1), date_to=date(2026, 3, 1))
    assert run_spec(con, spec(), ds, dash2) == [{"sum_Amount": 300}]


def test_values_are_parameters_not_sql(sales):
    ws, ds = sales
    evil = "x' OR 1=1 --"
    sql, params = compile_spec(spec(filters=[{"field": "Region", "op": "eq", "value": evil}]), ds)
    assert evil not in sql and evil in params
    assert run_spec(connect(ws, [ds]), spec(filters=[{"field": "Region", "op": "eq", "value": evil}]), ds) == [{"sum_Amount": None}]


def test_bad_specs_are_explained(sales):
    ws, ds = sales
    con = connect(ws, [ds])
    with pytest.raises(QueryError, match="isn't in this dataset"):
        run_spec(con, spec(groupBy="Nope"), ds)
    with pytest.raises(QueryError, match="isn't a number"):
        run_spec(con, spec(metrics=[{"field": "Region", "agg": "sum"}]), ds)
    with pytest.raises(QueryError):
        run_spec(con, spec(metrics=[{"field": "Amount", "agg": "drop table"}]), ds)


# ---------- sandbox ----------


def test_sandbox_blocks_other_workspaces_and_files(client, engine, sales, data_dir):
    ws, ds = sales
    con = connect(ws, [ds])
    other = data_dir / "other-ws"
    other.mkdir(parents=True)
    (other / "secret.parquet").write_bytes(b"x")
    for sql in (
        f"SELECT * FROM read_parquet('{(other / 'secret.parquet').as_posix()}')",
        f"SELECT * FROM read_parquet('{(data_dir / ws).as_posix()}/../other-ws/secret.parquet')",
        "SELECT * FROM read_csv('/etc/passwd')",
        "SELECT * FROM glob('*')",
    ):
        with pytest.raises(QueryError):
            run_sql(con, sql)
    for stmt in ("SET enable_external_access=true", "COPY (SELECT 1) TO 'x.csv'", "INSTALL httpfs", "ATTACH 'x.db'"):
        with pytest.raises(Exception):
            con.execute(stmt)


def test_run_sql_only_select(sales):
    ws, ds = sales
    con = connect(ws, [ds])
    assert run_sql(con, f'SELECT COUNT(*) AS n FROM ds_{ds.id}') == [{"n": 6}]
    for bad in (f"DROP VIEW ds_{ds.id}", "SELECT 1; SELECT 2", f"DELETE FROM ds_{ds.id}", "CREATE TABLE t AS SELECT 1", "nonsense ((("):
        with pytest.raises(QueryError):
            run_sql(con, bad)


# ---------- endpoints ----------


def test_rows_paging_sorting_filtering(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    r = client.get(f"/datasets/{ds['id']}/rows", params={"size": 2, "page": 1, "sort": "Amount", "direction": "desc"}).json()
    assert r["total"] == 6 and [row["Amount"] for row in r["rows"]] == [100, 50]
    assert r["rows"][0]["Date"] == "2026-01-05"
    f = json.dumps([{"field": "Region", "op": "eq", "value": "North"}])
    assert client.get(f"/datasets/{ds['id']}/rows", params={"filters": f}).json()["total"] == 3
    assert client.get(f"/datasets/{ds['id']}/rows", params={"sort": "Nope"}).status_code == 422
    assert client.get(f"/datasets/{ds['id']}/values/Region").json() == ["North", "South", "West"]
    # free-text search across columns, combined with filters
    assert client.get(f"/datasets/{ds['id']}/rows", params={"q": "setup"}).json()["total"] == 2
    assert client.get(f"/datasets/{ds['id']}/rows", params={"q": "setup", "filters": f}).json()["total"] == 1


def test_rename_and_type_override(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    r = client.patch(f"/datasets/{ds['id']}", json={"name": "Q1 sales", "column_types": {"Amount": "text"}})
    assert r.status_code == 200 and r.json()["name"] == "Q1 sales"
    assert {c["name"]: c["type"] for c in r.json()["columns"]}["Amount"] == "text"
    assert client.patch(f"/datasets/{ds['id']}", json={"column_types": {"Ghost": "number"}}).status_code == 422
    assert client.patch(f"/datasets/{ds['id']}", json={"column_types": {"Amount": "money"}}).status_code == 422


def test_replace_and_delete(client, engine, data_dir):
    ws = sign_in(client, engine)
    ds = upload(client)
    r = client.put(f"/datasets/{ds['id']}/file", files={"file": ("new.csv", b"Date,Amount\n2026-05-01,9\n", "text/csv")})
    assert r.status_code == 200 and r.json()["id"] == ds["id"] and r.json()["row_count"] == 1
    assert client.delete(f"/datasets/{ds['id']}").status_code == 204
    assert not (data_dir / ws / f"{ds['id']}.parquet").exists()
    assert client.get(f"/datasets/{ds['id']}").status_code == 404


def test_other_workspace_and_viewer_rules(client, engine):
    ws = sign_in(client, engine)
    ds = upload(client)
    # someone else can't see it
    sign_in(client, engine, uid="u2", token="tok-2", company="Other")
    assert client.get(f"/datasets/{ds['id']}/rows").status_code == 404
    assert client.delete(f"/datasets/{ds['id']}").status_code == 404
    # a viewer in the same workspace can read but not change
    with engine.begin() as conn:
        conn.execute(update(WorkspaceMember).where(WorkspaceMember.user_id == "u2").values(workspace_id=ws, role="viewer"))
    assert client.get(f"/datasets/{ds['id']}/rows").status_code == 200
    assert client.patch(f"/datasets/{ds['id']}", json={"name": "x"}).status_code == 403
    assert client.delete(f"/datasets/{ds['id']}").status_code == 403
