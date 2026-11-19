"""Formulas, approved metrics and calculated columns, from the compiler up to charts and Ask."""

from datetime import date, timedelta

import duckdb
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analytics.formula import FormulaError, Scope, compile_formula
from app.models import AuditLog, QueryExecution
from tests.test_security_audit import Tenant, join

ORDERS = (
    b"order_id,region,amount,cost,status,placed\n"
    b"1,North,100,60,paid,2026-01-05\n"
    b"2,North,50,20,paid,2026-01-20\n"
    b"3,South,200,150,refunded,2026-02-01\n"
    b"4,South,0,0,paid,2026-02-10\n"
    b"4,South,0,0,paid,2026-02-10\n"
)
COLUMNS = [
    {"name": "amount", "type": "number"}, {"name": "cost", "type": "number"}, {"name": "region", "type": "category"},
    {"name": "placed", "type": "date"}, {"name": "unit price", "type": "number"},
]
TODAY = date.today().isoformat()


def measure(text, metric=lambda _n: None):
    return compile_formula(text, Scope(COLUMNS, "measure", metric))


def column(text):
    return compile_formula(text, Scope(COLUMNS, "column"))


def value(sql):
    return duckdb.sql(f"SELECT {sql} FROM (VALUES (10.0, 0.0, 'N', TIMESTAMP '2026-03-15', 2.0)) t(amount, cost, region, placed, \"unit price\")").fetchone()[0]


# ---------- the formula language ----------


@pytest.mark.parametrize("formula,expected", [
    ("SUM(amount)", 10), ("sum([amount])", 10), ("AVERAGE(amount)", 10), ("COUNT()", 1), ("COUNT(*)", 1), ("COUNT(region)", 1),
    ("COUNT_DISTINCT(region)", 1), ("MIN(amount)", 10), ("MAX(amount)", 10), ("SUM([unit price]) * 2", 4),
    ("DIVIDE(SUM(amount), SUM(cost))", None), ("DIVIDE(SUM(amount), SUM(cost), 0)", 0), ("SUM(amount) / SUM(cost)", None),
    ("SUM(IF(region = 'N', amount, 0))", 10), ("SUM(CASE WHEN amount > 5 THEN 1 ELSE 0 END)", 1),
    ("ROUND(SUM(amount) / 3, 2)", 3.33), ("ABS(-SUM(amount))", 10), ("COALESCE(SUM(cost), 1)", 0),
    ("SUM(YEAR(placed))", 2026), ("MAX(MONTH(placed))", 3), ("MAX(DAY(placed))", 15),
    ("MAX(DATE_DIFF('day', placed, DATE_TRUNC('month', placed)))", -14), ("COUNT(IF(placed >= '2026-01-01', 1))", 1),
])
def test_measures_compile_to_the_right_answer(formula, expected):
    result = value(measure(formula).sql)
    assert (result == pytest.approx(expected)) if expected is not None else result is None


@pytest.mark.parametrize("formula,expected", [
    ("amount * 2", 20), ("amount / cost", None), ("IF(amount > 5, 'big', 'small')", "big"), ("COALESCE(NULL, region)", "N"),
    ("YEAR(placed)", 2026), ("amount > 5", "true"), ("region IN ('N', 'S')", "true"), ("region NOT IN ('N')", "false"),
    ("cost IS NULL", "false"), ("RUNNING_TOTAL(amount, placed)", 10), ("RUNNING_TOTAL(amount, placed, region)", 10),
    ("LAG(amount, placed)", None), ("LEAD(amount, placed, 2)", None),
])
def test_calculated_columns_compile_to_the_right_answer(formula, expected):
    assert value(column(formula).sql) == expected


@pytest.mark.parametrize("formula,fragment", [
    ("", "Write a formula"), ("amount", "total many rows"), ("SUM(amount", "“)”"), ("SUM(region)", "number"), ("SUM(SUM(amount))", "another total"),
    ("amount + SUM(cost)", "mixes"), ("SUM(nope)", "no column"), ("NOPE(amount)", "no function"), ("SUM(amount) SUM(cost)", "wasn't expected"),
    ("SUM(amount) + 'x'", "number"), ("MIN(placed)", "produce a number"), ("LAG(amount, placed)", "calculated column"),
    ("SUM(DATE_DIFF('hour', placed, placed))", "starts with"), ("COUNT(IF(placed > 'soon', 1))", "YYYY-MM-DD"), ("ROUND(SUM(amount), cost)", "mixes"),
    ("SUM(amount); DROP TABLE x", "can't be used"), ("SUM(amount) -- x", "no column"), ("'unterminated", "isn't closed"), ("[open", "isn't closed"),
    ("SUM(" * 40 + "amount" + ")" * 40, "too"), ("1 + " * 1000 + "1", "too long"),
])
def test_bad_measures_are_refused_with_a_reason(formula, fragment):
    with pytest.raises(FormulaError) as e:
        measure(formula)
    assert fragment in e.value.message


def test_errors_point_at_the_problem():
    with pytest.raises(FormulaError) as e:
        measure("SUM(nope)")
    assert "SUM(nope)"[e.value.start:e.value.end] == "nope"


@pytest.mark.parametrize("formula", ["SUM(amount)", "COUNT()", "amount; SELECT 1", "read_csv('x')", "getenv('HOME')", "(SELECT 1)"])
def test_columns_cannot_aggregate_or_escape(formula):
    with pytest.raises(FormulaError):
        column(formula)


def test_strings_cannot_break_out_of_the_query():
    sql = column("IF(region = 'x''; DROP TABLE t; --', 1, 0)").sql
    assert value(sql) == 0
    assert "'x''; DROP TABLE t; --'" in sql


def test_column_names_are_quoted_not_trusted():
    cols = [{"name": 'bad"; DROP TABLE t; --', "type": "number"}]
    assert '"bad""; DROP TABLE t; --"' in compile_formula('SUM([bad"; DROP TABLE t; --])', Scope(cols)).sql


def test_metrics_can_build_on_metrics_but_not_on_themselves():
    metrics = {"revenue": ("Revenue", "SUM(amount)"), "orders": ("Orders", "COUNT()"), "aov": ("AOV", "[Revenue] / [Orders]"), "a": ("A", "[B] + 1"), "b": ("B", "[A] + 1")}
    lookup = lambda name: metrics.get(name.lower())  # noqa: E731
    assert value(measure("[AOV] * 2", lookup).sql) == 20
    assert measure("[AOV]", lookup).metrics == {"AOV", "Revenue", "Orders"}
    with pytest.raises(FormulaError, match="depending on itself"):
        measure("[A]", lookup)


def test_inside_an_aggregate_a_name_is_the_column():
    assert value(measure("SUM([amount])", lambda n: ("amount", "COUNT()")).sql) == 10


# ---------- metrics through the API ----------


@pytest.fixture
def shop(client, engine):
    owner, other = Tenant(client, engine, "shop"), Tenant(client, engine, "rival")
    return owner, other, owner.upload(ORDERS, "orders.csv")


def make(owner, ds, name="Revenue", formula="SUM(amount)", approve=True, **extra):
    r = owner.post("/metrics", json={"name": name, "dataset_id": ds["id"], "formula": formula, **extra})
    assert r.status_code == 201, r.text
    m = r.json()
    if approve:
        r = owner.post(f"/metrics/{m['id']}/approve")
        assert r.status_code == 200, r.text
        m = r.json()
    return m


def chart_spec(ds, metric, **extra):
    return {"dataset": ds["id"], "title": "T", "chartType": "bar", "metrics": [{"field": metric["id"], "agg": "metric"}], **extra}


def total(owner, ds, metric):
    r = owner.post("/charts/preview", json={"spec": {**chart_spec(ds, metric), "chartType": "kpi"}})
    assert r.status_code == 200, r.text
    return r.json()["rows"][0][f"metric_{metric['id']}"]


def test_every_example_metric_from_the_brief(shop):
    owner, _, ds = shop
    revenue = make(owner, ds)
    orders = make(owner, ds, "Total Orders", "COUNT_DISTINCT(order_id)")
    aov = make(owner, ds, "Average Order Value", "[Revenue] / [Total Orders]")
    expenses = make(owner, ds, "Total Expenses", "SUM(cost)")
    profit = make(owner, ds, "Profit", "[Revenue] - [Total Expenses]")
    margin = make(owner, ds, "Profit Margin", "DIVIDE([Profit], [Revenue]) * 100")
    assert total(owner, ds, revenue) == 350
    assert total(owner, ds, orders) == 4
    assert total(owner, ds, aov) == 87.5
    assert total(owner, ds, profit) == 120
    assert total(owner, ds, margin) == pytest.approx(120 / 350 * 100)
    assert total(owner, ds, expenses) == 230


def test_a_chart_groups_by_a_metric(shop):
    owner, _, ds = shop
    m = make(owner, ds)
    dash = owner.post("/dashboards", json={"name": "D"}).json()
    chart = owner.post(f"/dashboards/{dash['id']}/charts", json={"spec": chart_spec(ds, m, groupBy="region")})
    assert chart.status_code == 201, chart.text
    assert chart.json()["spec"]["metrics"][0]["label"] == "Revenue"
    rows = owner.get(f"/dashboards/{dash['id']}/view").json()["charts"][0]["rows"]
    assert {r["region"]: r[f"metric_{m['id']}"] for r in rows} == {"South": 200, "North": 150}


def test_a_draft_never_reaches_charts(shop):
    owner, _, ds = shop
    draft = make(owner, ds, approve=False)
    assert owner.post("/charts/preview", json={"spec": chart_spec(ds, draft)}).status_code == 422
    assert owner.post("/metrics", json={"name": "Double", "dataset_id": ds["id"], "formula": "[Revenue] * 2"}).status_code == 201
    double = owner.get("/metrics").json()[0]
    assert owner.post(f"/metrics/{double['id']}/approve").status_code == 409  # its building block isn't approved


def test_a_new_version_changes_nothing_until_approved(shop):
    owner, _, ds = shop
    m = make(owner, ds)
    updated = owner.post(f"/metrics/{m['id']}/versions", json={"formula": "SUM(amount) * 2", "note": "doubled"}).json()
    assert updated["version"] == 2 and updated["approved_version"] == 1 and updated["approved_formula"] == "SUM(amount)"
    assert total(owner, ds, m) == 350
    assert owner.post(f"/metrics/{m['id']}/approve").json()["approved_version"] == 2
    assert total(owner, ds, m) == 700
    assert [v["version"] for v in owner.get(f"/metrics/{m['id']}/versions").json()] == [2, 1]


def test_effective_dates_are_respected(shop):
    owner, _, ds = shop
    m = make(owner, ds)
    future = (date.today() + timedelta(days=30)).isoformat()
    owner.post(f"/metrics/{m['id']}/versions", json={"formula": "SUM(amount) * 2", "effective_from": future})
    assert owner.post(f"/metrics/{m['id']}/approve").json()["approved_formula"] == "SUM(amount)"
    assert total(owner, ds, m) == 350


def test_metric_tests_gate_approval(shop):
    owner, _, ds = shop
    m = make(owner, ds, approve=False)
    wrong = owner.post(f"/metrics/{m['id']}/tests", json={"name": "North is 999", "expected": 999, "filters": [{"field": "region", "op": "eq", "value": "North"}]}).json()
    owner.post(f"/metrics/{m['id']}/tests", json={"name": "North is 150", "expected": 150, "filters": [{"field": "region", "op": "eq", "value": "North"}]})
    results = owner.post(f"/metrics/{m['id']}/tests/run").json()
    assert [r["status"] for r in results] == ["failed", "passed"] and results[0]["actual"] == 150
    assert owner.post(f"/metrics/{m['id']}/approve").status_code == 409
    assert owner.request("DELETE", f"/metrics/{m['id']}/tests/{wrong['id']}").status_code == 204
    assert owner.post(f"/metrics/{m['id']}/approve").status_code == 200


def test_a_metric_in_use_cannot_be_deleted(shop):
    owner, _, ds = shop
    m = make(owner, ds)
    make(owner, ds, "Double", "[Revenue] * 2")
    assert owner.request("DELETE", f"/metrics/{m['id']}").status_code == 409
    assert owner.request("PUT", f"/metrics/{m['id']}", json={"name": "Sales"}).status_code == 409
    other = make(owner, ds, "Unused", "COUNT()")
    assert owner.request("DELETE", f"/metrics/{other['id']}").status_code == 204


def test_alerts_and_sql_lab_use_the_approved_definition(shop):
    owner, _, ds = shop
    m = make(owner, ds)
    alert = owner.post("/alerts", json={"name": "A", "dataset_id": ds["id"], "metric": {"field": m["id"], "agg": "metric"}, "condition": "above", "threshold": 1})
    assert alert.status_code == 201, alert.text
    checked = owner.post(f"/alerts/{alert.json()['id']}/check").json()
    assert checked["last_value"] == 350 and checked["metric"]["label"] == "Revenue"
    sql = owner.get(f"/metrics/{m['id']}/sql").json()["sql"]
    assert owner.post("/sql/run", json={"sql": sql}).json()["rows"] == [{"Revenue": 350}]


def test_ask_prefers_approved_metrics_and_business_names(shop):
    owner, _, ds = shop
    m = make(owner, ds, "Net Sales", "SUM(amount) - SUM(cost)", synonyms=["takings"], default_date_column="placed")
    assert owner.post("/dimensions", json={"name": "Territory", "dataset_id": ds["id"], "column": "region"}).status_code == 201
    answer = owner.post("/ask", json={"question": "takings by territory"}).json()
    assert answer["answered"] and answer["spec"]["metrics"][0]["field"] == m["id"] and answer["spec"]["groupBy"] == "region"
    assert {r["region"]: r[f"metric_{m['id']}"] for r in answer["rows"]} == {"South": 50, "North": 70}
    assert owner.post("/ask", json={"question": "net sales"}).json()["rows"][0][f"metric_{m['id']}"] == 120


def test_ask_ignores_drafts(shop):
    owner, _, ds = shop
    make(owner, ds, "Takings", "SUM(cost)", approve=False)
    answer = owner.post("/ask", json={"question": "total amount takings"}).json()
    assert answer["spec"]["metrics"][0]["agg"] != "metric"


# ---------- calculated columns ----------


def test_calculated_columns_work_everywhere(shop):
    owner, _, ds = shop
    margin = owner.post("/calculated-columns", json={"dataset_id": ds["id"], "name": "Margin", "formula": "amount - cost"})
    assert margin.status_code == 201, margin.text
    band = owner.post("/calculated-columns", json={"dataset_id": ds["id"], "name": "Band", "formula": "IF([Margin] > 30, 'high', 'low')"})
    assert band.status_code == 201, band.text
    columns = {c["name"]: c for c in owner.get(f"/datasets/{ds['id']}").json()["columns"]}
    assert columns["Margin"]["calculated"] and columns["Margin"]["type"] == "number" and "sql" not in columns["Margin"]
    spec = {"dataset": ds["id"], "title": "T", "chartType": "bar", "groupBy": "Band", "metrics": [{"field": "Margin", "agg": "sum"}]}
    rows = owner.post("/charts/preview", json={"spec": spec}).json()["rows"]
    assert {r["Band"]: r["sum_Margin"] for r in rows} == {"high": 90, "low": 30}
    assert owner.post("/sql/run", json={"sql": 'SELECT SUM("Margin") AS m FROM orders'}).json()["rows"] == [{"m": 120}]
    assert owner.get(f"/datasets/{ds['id']}/rows", params={"sort": "Margin", "direction": "desc"}).json()["rows"][0]["Margin"] == 50
    assert make(owner, ds, "Total margin", "SUM(Margin)")["approved_version"] == 1


def test_running_totals_and_previews(shop):
    owner, _, ds = shop
    r = owner.post("/formulas/preview", json={"dataset_id": ds["id"], "formula": "RUNNING_TOTAL(amount, order_id)", "kind": "column"})
    assert r.status_code == 200, r.text
    assert max(row["value"] for row in r.json()["rows"]) == 350
    by = owner.post("/formulas/preview", json={"dataset_id": ds["id"], "formula": "SUM(amount)", "group_by": "placed"}).json()["rows"]
    assert by == [{"label": "2026-01", "value": 150}, {"label": "2026-02", "value": 200}]


def test_a_broken_calculated_column_does_not_take_the_dataset_down(shop):
    owner, _, ds = shop
    owner.post("/calculated-columns", json={"dataset_id": ds["id"], "name": "Margin", "formula": "amount - cost"})
    r = owner.request("PUT", f"/datasets/{ds['id']}/file", files={"file": ("orders.csv", b"region,total\nNorth,5\n", "text/csv")})
    assert r.status_code == 200, r.text
    assert [c["name"] for c in r.json()["columns"]] == ["region", "total"]
    assert owner.get(f"/datasets/{ds['id']}/rows").json()["total"] == 1
    assert "no column" in owner.get("/calculated-columns").json()[0]["error"]
    back = owner.request("PUT", f"/datasets/{ds['id']}/file", files={"file": ("orders.csv", ORDERS, "text/csv")})
    assert "Margin" in [c["name"] for c in back.json()["columns"]]


def test_calculated_names_cannot_collide_and_types_are_fixed(shop):
    owner, _, ds = shop
    assert owner.post("/calculated-columns", json={"dataset_id": ds["id"], "name": "AMOUNT", "formula": "1"}).status_code == 409
    owner.post("/calculated-columns", json={"dataset_id": ds["id"], "name": "One", "formula": "1"})
    assert owner.request("PATCH", f"/datasets/{ds['id']}", json={"column_types": {"One": "category"}}).status_code == 422


def test_empty_dataset_values_stay_empty(shop):
    owner, _, ds = shop
    m = make(owner, ds, "Margin %", "DIVIDE(SUM(amount) - SUM(cost), SUM(amount)) * 100")
    spec = {**chart_spec(ds, m), "chartType": "kpi", "filters": [{"field": "region", "op": "eq", "value": "Nowhere"}]}
    assert owner.post("/charts/preview", json={"spec": spec}).json()["rows"][0][f"metric_{m['id']}"] is None


# ---------- who may do what ----------


def test_viewers_read_but_cannot_change(shop, engine):
    owner, _, ds = shop
    m = make(owner, ds)
    viewer = join(owner, engine, "vera", "viewer")
    assert viewer.get("/metrics").json()[0]["id"] == m["id"]
    assert total(viewer, ds, m) == 350
    attempts = [
        ("POST", "/metrics", {"name": "X", "dataset_id": ds["id"], "formula": "COUNT()"}), ("POST", f"/metrics/{m['id']}/versions", {"formula": "COUNT()"}),
        ("POST", f"/metrics/{m['id']}/approve", None), ("DELETE", f"/metrics/{m['id']}", None), ("GET", f"/metrics/{m['id']}/sql", None),
        ("POST", "/calculated-columns", {"dataset_id": ds["id"], "name": "X", "formula": "1"}), ("POST", "/dimensions", {"name": "X", "dataset_id": ds["id"], "column": "region"}),
        ("POST", "/formulas/preview", {"dataset_id": ds["id"], "formula": "COUNT()"}), ("GET", "/audit-logs", None), ("GET", "/query-executions", None),
    ]
    assert [(meth, url) for meth, url, body in attempts if viewer.request(meth, url, json=body).status_code != 403] == []


def test_another_company_cannot_touch_or_use_any_of_it(shop):
    owner, rival, ds = shop
    m = make(owner, ds)
    column = owner.post("/calculated-columns", json={"dataset_id": ds["id"], "name": "Margin", "formula": "amount - cost"}).json()
    dim = owner.post("/dimensions", json={"name": "Territory", "dataset_id": ds["id"], "column": "region"}).json()
    test = owner.post(f"/metrics/{m['id']}/tests", json={"name": "t", "expected": 1}).json()
    mine = rival.upload(b"amount\n1\n", "mine.csv")
    for path in ("/metrics", "/dimensions", "/calculated-columns"):
        assert rival.get(path).json() == []
    denied = [
        ("GET", f"/metrics/{m['id']}", None), ("PUT", f"/metrics/{m['id']}", {"name": "X"}), ("GET", f"/metrics/{m['id']}/versions", None),
        ("POST", f"/metrics/{m['id']}/versions", {"formula": "COUNT()"}), ("POST", f"/metrics/{m['id']}/approve", None), ("DELETE", f"/metrics/{m['id']}", None),
        ("GET", f"/metrics/{m['id']}/tests", None), ("POST", f"/metrics/{m['id']}/tests/run", None), ("DELETE", f"/metrics/{m['id']}/tests/{test['id']}", None),
        ("GET", f"/metrics/{m['id']}/sql", None), ("DELETE", f"/dimensions/{dim['id']}", None), ("DELETE", f"/calculated-columns/{column['id']}", None),
        ("PUT", f"/calculated-columns/{column['id']}", {"dataset_id": mine["id"], "name": "X", "formula": "1"}),
        ("POST", "/formulas/validate", {"dataset_id": ds["id"], "formula": "COUNT()"}), ("POST", "/formulas/preview", {"dataset_id": ds["id"], "formula": "COUNT()"}),
        ("POST", "/metrics", {"name": "X", "dataset_id": ds["id"], "formula": "COUNT()"}), ("POST", "/calculated-columns", {"dataset_id": ds["id"], "name": "X", "formula": "1"}),
        ("POST", "/dimensions", {"name": "X", "dataset_id": ds["id"], "column": "region"}),
    ]
    assert [(meth, url) for meth, url, body in denied if rival.request(meth, url, json=body).status_code != 404] == []
    # A foreign metric id inside the rival's own chart, alert and formula
    assert rival.post("/charts/preview", json={"spec": chart_spec(mine, m)}).status_code == 422
    assert rival.post("/alerts", json={"name": "A", "dataset_id": mine["id"], "metric": {"field": m["id"], "agg": "metric"}, "condition": "above", "threshold": 1}).status_code == 422
    assert rival.post("/formulas/validate", json={"dataset_id": mine["id"], "formula": "[Revenue]"}).json()["ok"] is False


def test_share_links_hide_formulas(shop):
    owner, _, ds = shop
    owner.post("/calculated-columns", json={"dataset_id": ds["id"], "name": "Margin", "formula": "amount - cost"})
    m = make(owner, ds)
    dash = owner.post("/dashboards", json={"name": "D"}).json()
    owner.post(f"/dashboards/{dash['id']}/charts", json={"spec": chart_spec(ds, m, groupBy="region")})
    owner.request("PUT", "/me/profile", json={"job_role": "Owner", "dashboard_visibility": "anyone"})
    token = owner.post(f"/dashboards/{dash['id']}/share").json()["share_token"]
    owner.client.cookies.clear()
    shared = owner.client.get(f"/public/dashboards/{token}").text
    assert "amount - cost" not in shared and "SUM(amount)" not in shared
    assert owner.client.get(f"/public/dashboards/{token}/view").json()["charts"][0]["rows"]


# ---------- audit trail ----------


def test_changes_and_queries_are_recorded_without_their_content(shop, engine):
    owner, _, ds = shop
    make(owner, ds, "Secret name", "SUM(IF(status = 'hidden-value', amount, 0))")
    owner.post("/sql/run", json={"sql": "SELECT 'hidden-value' AS x"})
    actions = [a["action"] for a in owner.get("/audit-logs").json()]
    assert {"metric.create", "metric.approve"} <= set(actions)
    assert owner.get("/query-executions").json()[0]["kind"] == "sql"
    with Session(engine) as s:
        stored = [repr(a.detail) for a in s.scalars(select(AuditLog))] + [q.kind + q.status for q in s.scalars(select(QueryExecution))]
    assert not any("hidden-value" in text for text in stored)
