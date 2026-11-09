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
