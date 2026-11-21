"""Retyping a column never shrinks a total silently (audit P0-2).

A column inferred as text is stored as text. When the user marks it as a number or a date, its values must be
read with the upload's rules ("₹1,200", "(200)", "05/01/2026"); values that still can't be read are reported.
"""

from sqlalchemy.orm import Session

from app.models import Dataset
from app.query import connect, run_spec
from tests.test_query import sign_in, upload

MESSY_AMOUNTS = (
    "Date,Client,Amount\n"
    "2026-01-05,Acme,\"₹1,200\"\n"
    "2026-01-20,Brew Lab,₹950.50\n"
    "2026-02-03,Acme,\"1,050\"\n"
    "2026-02-14,Corner,TBC\n"
    "2026-03-01,Brew Lab,(200)\n"
    "2026-03-15,Acme,1100\n"
).encode()

DMY_WITH_PENDING = b"Date,Amount\n05/01/2026,100\npending,50\n20/01/2026,200\n03/02/2026,300\n"


def _column(body: dict, name: str) -> dict:
    return next(c for c in body["columns"] if c["name"] == name)


def _dataset(engine, dataset_id: str) -> Dataset:
    with Session(engine) as s:
        ds = s.get(Dataset, dataset_id)
        s.expunge(ds)
    return ds


def _rows(engine, ws: str, dataset_id: str, spec: dict) -> list[dict]:
    ds = _dataset(engine, dataset_id)
    return run_spec(connect(ws, [ds]), {"dataset": ds.id, "filters": [], **spec}, ds)


def test_retyped_number_column_sums_formatted_values(client, engine):
    ws = sign_in(client, engine)
    body = upload(client, MESSY_AMOUNTS, "messy.csv")
    assert _column(body, "Amount")["type"] == "text"  # "TBC" keeps it from being inferred as a number

    r = client.patch(f"/datasets/{body['id']}", json={"column_types": {"Amount": "number"}})
    assert r.status_code == 200, r.text
    amount = _column(r.json(), "Amount")
    assert amount["type"] == "number"
    assert (amount["unreadable"], amount["unreadable_examples"]) == (1, ["TBC"])

    total = _rows(engine, ws, body["id"], {"metrics": [{"field": "Amount", "agg": "sum"}], "chartType": "kpi"})
    # 1200 + 950.50 + 1050 - 200 + 1100. A bare TRY_CAST read only "1100" and returned 1100.
    assert total[0]["sum_Amount"] == 4100.5

    by_client = _rows(engine, ws, body["id"], {"metrics": [{"field": "Amount", "agg": "sum"}], "groupBy": "Client", "chartType": "bar"})
    assert {r["Client"]: r["sum_Amount"] for r in by_client} == {"Acme": 3350.0, "Brew Lab": 750.5, "Corner": None}


def test_retyped_date_column_uses_the_detected_format(client, engine):
    ws = sign_in(client, engine)
    body = upload(client, DMY_WITH_PENDING, "dmy.csv")
    assert _column(body, "Date")["type"] == "text"  # "pending" keeps it from being inferred as a date

    r = client.patch(f"/datasets/{body['id']}", json={"column_types": {"Date": "date"}})
    date = _column(r.json(), "Date")
    assert (date["type"], date["unreadable"], date["unreadable_examples"]) == ("date", 1, ["pending"])

    monthly = _rows(
        engine, ws, body["id"],
        {"metrics": [{"field": "Amount", "agg": "sum"}], "groupBy": "Date", "dateBucket": "month", "chartType": "line"},
    )
    # Day first: 05/01 is 5 January. The "pending" row has no date, so it's in no month.
    assert {r["Date"]: r["sum_Amount"] for r in monthly} == {"2026-01": 300, "2026-02": 300}


def test_retyping_back_to_text_clears_the_notes(client, engine):
    sign_in(client, engine)
    body = upload(client, MESSY_AMOUNTS, "messy.csv")
    client.patch(f"/datasets/{body['id']}", json={"column_types": {"Amount": "number"}})
    r = client.patch(f"/datasets/{body['id']}", json={"column_types": {"Amount": "text"}})
    amount = _column(r.json(), "Amount")
    assert (amount["type"], amount["unreadable"], amount["unreadable_examples"]) == ("text", 0, [])
    assert "format" not in _dataset(engine, body["id"]).columns[2]


def test_columns_stored_as_numbers_are_unchanged(client, engine):
    """A column that was a number at upload is stored as a number; reading it doesn't go through the text rules."""
    ws = sign_in(client, engine)
    body = upload(client)  # tests.test_query.SALES
    r = client.patch(f"/datasets/{body['id']}", json={"column_types": {"Region": "category"}})
    assert all(c["unreadable"] == 0 for c in r.json()["columns"])
    total = _rows(engine, ws, body["id"], {"metrics": [{"field": "Amount", "agg": "sum"}], "chartType": "kpi"})
    assert total[0]["sum_Amount"] == 675
