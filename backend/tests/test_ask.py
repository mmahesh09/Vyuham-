from datetime import date

import pytest
from sqlalchemy.orm import Session

from app.ask import parse_question, suggestions
from app.models import Dataset
from app.query import connect
from tests.test_query import sign_in, upload

TODAY = date(2026, 3, 20)


@pytest.fixture
def ctx(client, engine):
    ws = sign_in(client, engine)
    body = upload(client)
    with Session(engine) as s:
        ds = s.get(Dataset, body["id"])
        s.expunge(ds)
    return ws, ds


def parse(ctx, q):
    ws, ds = ctx
    return parse_question(q, [ds], connect(ws, [ds]), today=TODAY)


def test_amount_by_category(ctx):
    p = parse(ctx, "What's our revenue by region?")
    assert p.spec["metrics"] == [{"field": "Amount", "agg": "sum"}]
    assert (p.spec["groupBy"], p.spec["chartType"]) == ("Region", "bar")


def test_monthly_trend(ctx):
    p = parse(ctx, "monthly amount")
    assert (p.spec["groupBy"], p.spec["dateBucket"], p.spec["chartType"]) == ("Date", "month", "line")
    p = parse(ctx, "amount by week")
    assert p.spec["dateBucket"] == "week"
    p = parse(ctx, "how is amount trending over time")
    assert p.spec["groupBy"] == "Date"


def test_top_n_and_average(ctx):
    p = parse(ctx, "top 2 products by amount")
    assert (p.spec["groupBy"], p.spec["limit"], p.spec["sort"]) == ("Product", 2, "value_desc")
    p = parse(ctx, "average amount")
    assert p.spec["metrics"][0]["agg"] == "avg" and p.spec["chartType"] == "kpi"


def test_counts_and_values_and_ranges(ctx):
    p = parse(ctx, "how many orders in North")
    assert p.spec["metrics"] == [{"field": "*", "agg": "count"}]
    assert p.spec["filters"] == [{"field": "Region", "op": "eq", "value": "North"}]
    p = parse(ctx, "amount last month")
    assert (p.filters.date_from, p.filters.date_to) == (date(2026, 2, 1), date(2026, 2, 28))
    p = parse(ctx, "amount last 7 days")
    assert (p.filters.date_from, p.filters.date_to) == (date(2026, 3, 14), date(2026, 3, 20))
    p = parse(ctx, "how many unique region")
    assert p.spec["metrics"] == [{"field": "Region", "agg": "count_distinct"}]


def test_nonsense_is_not_guessed(ctx):
    assert parse(ctx, "weather tomorrow please") is None


def test_ask_endpoint(client, ctx):
    r = client.post("/ask", json={"question": "amount by region"}).json()
    assert r["answered"] and r["dataset_name"] == "sales"
    assert {x["Region"]: x["sum_Amount"] for x in r["rows"]} == {"North": 325, "West": 300, "South": 50}
    assert r["insight"]["headline"] == "North leads with 48% of total amount"
    r = client.post("/ask", json={"question": "zzz qqq"}).json()
    assert not r["answered"] and r["suggestions"]
    assert client.post("/ask", json={"question": "x"}).status_code == 422
    assert client.get("/ask/suggestions").json()


def test_suggestions_are_parseable(ctx):
    ws, ds = ctx
    for q in suggestions([ds]):
        assert parse(ctx, q) is not None, q


# ---------- show the work ----------


def work(ctx, q):
    from app.work import answer_work
    from app.query import run_spec

    ws, ds = ctx
    con = connect(ws, [ds])
    p = parse_question(q, [ds], con, today=TODAY)
    rows = run_spec(con, p.spec, ds, p.filters)
    return answer_work(con, p.spec, ds, p.filters, rows)


def test_work_explains_a_grouped_answer_and_what_was_left_out(ctx):
    w = work(ctx, "amount by region")
    assert w["steps"] == ["Read the data in sales", "Added up Amount", "Grouped by Region"]
    assert (w["rows_used"], w["rows_total"]) == (6, 6)
    # The sample has one row with no Region and no Amount: both are called out, not silently dropped.
    assert w["left_out"] == ["1 row has no Region, so it isn’t in the chart.", "1 row has no Amount, so it wasn’t counted."]
    # The bars add up to the total over the rows used.
    assert w["check"] == {"metric": "Amount", "shown": 675.0, "total": 675.0, "groups_shown": 3, "limited": False}


def test_work_top_n_shows_part_of_the_total(ctx):
    w = work(ctx, "top 1 region by amount")
    assert w["steps"][-1] == "Kept the top 1"
    assert (w["check"]["shown"], w["check"]["total"], w["check"]["limited"]) == (325.0, 675.0, True)


def test_work_filters_and_counts(ctx):
    w = work(ctx, "how many orders in North")
    assert "Only rows where Region is North" in w["steps"] and "Counted the rows" in w["steps"]
    assert (w["rows_used"], w["rows_total"]) == (3, 6)
    assert w["check"] is None  # a single number: nothing to add up
    assert w["row_filters"] == [{"field": "Region", "op": "eq", "value": "North"}]


def test_work_date_range_rows_match_the_rows_endpoint(client, ctx):
    import json

    ws, ds = ctx
    w = work(ctx, "amount last month")  # February 2026
    assert "Only rows where Date is from 2026-02-01 to 2026-02-28" in w["steps"]
    assert w["row_filters"] == [
        {"field": "Date", "op": "gte", "value": "2026-02-01"},
        {"field": "Date", "op": "lt", "value": "2026-03-01"},
    ]
    # 'See the rows' uses these filters on the rows endpoint and gets exactly the rows the answer used.
    r = client.get(f"/datasets/{ds.id}/rows", params={"filters": json.dumps(w["row_filters"])}).json()
    assert r["total"] == w["rows_used"] == 2
    assert sorted(x["Amount"] for x in r["rows"]) == [25, 200]


def test_ask_endpoint_returns_the_work(client, ctx):
    r = client.post("/ask", json={"question": "amount by region"}).json()
    assert r["work"]["rows_used"] == 6 and r["work"]["check"]["total"] == 675
    assert client.post("/ask", json={"question": "zzz qqq"}).json()["work"] is None
