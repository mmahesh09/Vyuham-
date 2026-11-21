"""Real exports are messy (audit P0-3): placeholders, lakh grouping, summary rows, inconsistent capitals.

Each fix is visible: the column's `notes` say what was cleaned.
"""

import pandas as pd

from app.ingest import ingest


def _read(csv: str):
    r = ingest(csv.encode(), "file.csv")
    return r, {c.name: c for c in r.columns}


def _values(frame: pd.DataFrame, name: str) -> list:
    return [None if pd.isna(v) else v for v in frame[name].tolist()]


def test_a_messy_export_types_correctly_and_says_what_was_cleaned():
    r, cols = _read(
        "Invoice Date,Client,Amount\n"
        "05/01/2026,Acme,\"₹1,200\"\n"
        "20/01/2026,Brew Lab,₹950.50\n"
        "03/02/2026,Acme,\"1,050\"\n"
        "14/02/2026,Corner,n/a\n"
        "01/03/2026,Brew Lab,(200)\n"
        "15/03/2026,Acme,1100\n"
        "Total,,\"4,100.50\"\n"
    )
    assert len(r.frame) == 6  # the summary row isn't data
    assert (cols["Invoice Date"].type, cols["Amount"].type) == ("date", "number")
    assert _values(r.frame, "Amount") == [1200, 950.5, 1050, None, -200, 1100]
    assert cols["Invoice Date"].notes == [
        "Left out the summary row at the end of the file (“Total”), so totals aren't counted twice."
    ]
    assert cols["Amount"].notes == ["1 cell with “n/a” read as empty."]
    assert cols["Amount"].empty_ratio == round(1 / 6, 4)


def test_indian_lakh_and_crore_grouping_are_numbers():
    r, cols = _read("Amount\n\"₹1,20,000\"\n\"₹2,50,500.75\"\n\"12,34,56,789\"\n\"1,200,000\"\n")
    assert cols["Amount"].type == "number"
    assert _values(r.frame, "Amount") == [120000, 250500.75, 123456789, 1200000]


def test_badly_grouped_numbers_are_still_not_numbers():
    _, cols = _read("Code\n\"1,2,3\"\n\"12,3456\"\n")
    assert cols["Code"].type == "text"


def test_placeholders_in_number_and_date_columns():
    r, cols = _read("Date,Amount\n2026-01-13,\"₹1,200\"\n-,-\n2026-03-30,1000\n2026-03-31,#N/A\n")
    assert (cols["Date"].type, cols["Amount"].type) == ("date", "number")  # 2 real values, 2 placeholders
    assert _values(r.frame, "Amount") == [1200, None, 1000, None]
    assert cols["Amount"].notes == ["2 cells with “-”, “#N/A” read as empty."]


def test_a_column_of_mostly_placeholders_is_not_turned_into_numbers():
    _, cols = _read("Amount\n-\n-\n5\n")
    assert cols["Amount"].type == "text" and cols["Amount"].notes == []


def test_text_columns_keep_placeholders_as_written():
    r, cols = _read("Region,Amount\nNorth,1\n-,2\nn/a,3\n")
    assert cols["Region"].type == "text"
    assert _values(r.frame, "Region") == ["North", "-", "n/a"]


def test_category_values_that_differ_only_in_capitals_are_merged():
    statuses = ["Paid"] * 5 + ["PAID"] * 2 + ["paid"] + ["Unpaid"] * 3 + ["UNPAID"]
    r, cols = _read("Status\n" + "\n".join(statuses) + "\n")
    assert cols["Status"].type == "category"
    assert sorted(set(_values(r.frame, "Status"))) == ["Paid", "Unpaid"]
    assert _values(r.frame, "Status").count("Paid") == 8
    assert cols["Status"].notes == ["Merged values that differ only in capitals: “PAID” is counted as “Paid”, and 1 more like it."]


def test_free_text_columns_are_not_merged():
    names = [f"Customer {i}" for i in range(30)] + ["customer 1"]
    r, cols = _read("Name\n" + "\n".join(names) + "\n")
    assert cols["Name"].type == "text"
    assert "customer 1" in _values(r.frame, "Name")


def test_only_trailing_summary_rows_are_dropped():
    r, cols = _read(
        "Item,Amount\n"
        "Total Gym,100\n"  # a real product whose name starts with "Total"
        "Total,1\n"  # a "Total" row in the middle is data, not a summary
        "Rowing machine,50\n"
        "Subtotal,151\n"
        "GRAND TOTAL:,151\n"
    )
    assert _values(r.frame, "Item") == ["Total Gym", "Total", "Rowing machine"]
    assert cols["Item"].notes == [
        "Left out 2 summary rows at the end of the file (“GRAND TOTAL:”, “Subtotal”), so totals aren't counted twice."
    ]


def test_upload_reports_the_notes_and_sums_correctly(client, engine):
    from tests.test_query import sign_in, upload

    sign_in(client, engine)
    body = upload(client, "Date,Amount\n2026-01-05,\"₹1,20,000\"\n2026-01-20,n/a\n2026-02-03,\"50,000\"\nTotal,\"1,70,000\"\n".encode(), "inr.csv")
    amount = next(c for c in body["columns"] if c["name"] == "Amount")
    date = next(c for c in body["columns"] if c["name"] == "Date")
    assert (amount["type"], amount["notes"]) == ("number", ["1 cell with “n/a” read as empty."])
    assert date["notes"][0].startswith("Left out the summary row")
    assert body["row_count"] == 3
    r = client.post("/ask", json={"question": "total amount"}).json()
    assert r["answered"] and r["rows"][0]["sum_Amount"] == 170000  # not 340,000 with the Total row counted
