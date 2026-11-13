"""SQL Lab: {{name}} parameters, EXPLAIN, error line numbers, and parameters in saved queries,
SQL charts and exports."""

import csv
import io

from tests.test_query import sign_in, upload

BY_REGION = 'SELECT "Region", SUM("Amount") AS total FROM sales WHERE "Amount" >= {{min}} AND "Date" >= {{since}} GROUP BY 1 ORDER BY 2 DESC'
PARAMS = [{"name": "min", "type": "number", "value": "100"}, {"name": "since", "type": "date", "value": "2026-02-01"}]


def test_params_are_bound_not_pasted(client, engine):
    sign_in(client, engine)
    upload(client)
    r = client.post("/sql/run", json={"sql": BY_REGION, "params": PARAMS})
    assert r.status_code == 200, r.text
    assert r.json()["rows"] == [{"Region": "West", "total": 300.0}, {"Region": "North", "total": 200.0}]

    # A text value is data, not SQL: an injection attempt just matches nothing.
    q = 'SELECT COUNT(*) AS n FROM sales WHERE "Region" = {{ region }}'
    evil = [{"name": "region", "type": "text", "value": "x' OR '1'='1"}]
    assert client.post("/sql/run", json={"sql": q, "params": evil}).json()["rows"] == [{"n": 0}]
    same = [{"name": "region", "type": "text", "value": "North"}]
    assert client.post("/sql/run", json={"sql": q, "params": same}).json()["rows"] == [{"n": 3}]


def test_param_errors_are_friendly(client, engine):
    sign_in(client, engine)
    upload(client)
    missing = client.post("/sql/run", json={"sql": BY_REGION, "params": PARAMS[:1]})
    assert missing.status_code == 422 and "{{since}}" in missing.json()["detail"]
    bad = [{"name": "min", "type": "number", "value": "lots"}, PARAMS[1]]
    assert "should be a number" in client.post("/sql/run", json={"sql": BY_REGION, "params": bad}).json()["detail"]


def test_error_messages_carry_line_numbers(client, engine):
    sign_in(client, engine)
    upload(client)
    r = client.post("/sql/run", json={"sql": "SELECT\n  nope\nFROM sales"})
    assert r.status_code == 422 and "(line 2)" in r.json()["detail"], r.json()


def test_explain_returns_a_plan_without_running(client, engine):
    sign_in(client, engine)
    upload(client)
    r = client.post("/sql/explain", json={"sql": BY_REGION, "params": PARAMS})
    assert r.status_code == 200, r.text
    assert "ORDER_BY" in r.json()["plan"]
    assert client.post("/sql/explain", json={"sql": "DELETE FROM sales"}).status_code == 422


def test_saved_query_keeps_params_and_exports_with_them(client, engine):
    sign_in(client, engine)
    upload(client)
    extra = [*PARAMS, {"name": "unused", "type": "text", "value": "dropped"}]
    q = client.post("/sql/saved", json={"name": "Big regions", "sql": BY_REGION, "params": extra}).json()
    assert [p["name"] for p in q["params"]] == ["min", "since"]
    assert client.get("/sql/saved").json()[0]["params"] == PARAMS

    r = client.post("/exports", json={"source": "saved_query", "source_id": q["id"], "format": "csv"})
    assert r.status_code == 202, r.text
    run = client.get(f"/report-runs/{r.json()['id']}").json()
    assert run["status"] == "done", run
    rows = list(csv.reader(io.StringIO(client.get(f"/report-runs/{run['id']}/download").content.decode("utf-8-sig"))))
    assert rows[1:] == [["West", "300.0"], ["North", "200.0"]]


def test_sql_chart_with_params(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = client.post("/dashboards", json={"name": "Sales"}).json()
    spec = {"dataset": ds["id"], "sql": BY_REGION, "groupBy": "Region", "metrics": [{"field": "total", "agg": "sum"}], "chartType": "bar", "title": "Big"}
    # Saving without values for the placeholders is refused up front.
    assert client.post(f"/dashboards/{d['id']}/charts", json={"spec": spec}).status_code == 422
    r = client.post(f"/dashboards/{d['id']}/charts", json={"spec": {**spec, "params": PARAMS}})
    assert r.status_code == 201, r.text
    chart = client.get(f"/dashboards/{d['id']}/view").json()["charts"][0]
    assert chart["rows"] == [{"Region": "West", "sum_total": 300.0}, {"Region": "North", "sum_total": 200.0}], chart
