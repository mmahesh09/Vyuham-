import io

import pandas as pd
import pytest

from app.ingest import IngestError, ingest


def csv(text: str) -> bytes:
    return text.encode()


def types(result):
    return {c.name: c.type for c in result.columns}


def test_csv_types_and_values():
    rows = "\n".join(f"Acme {i % 3},2026-10-{i + 1:02d},\"$1,{200 + i}.50\",{'Paid' if i % 2 else 'Due'}" for i in range(12))
    r = ingest(csv("Client,Date,Amount,Status\n" + rows), "sales.csv")
    assert types(r) == {"Client": "category", "Date": "date", "Amount": "number", "Status": "category"}
    assert r.frame["Amount"].iloc[0] == pytest.approx(1200.5)
    assert str(r.frame["Date"].dtype).startswith("datetime64")


def test_semicolon_delimiter_and_messy_headers():
    r = ingest(csv("name;;name\nA;1;x\nB;2;y\n"), "x.csv")
    assert [c.name for c in r.columns] == ["name", "Column 2", "name (2)"]
    assert types(r)["Column 2"] == "number"
    assert str(r.frame["Column 2"].dtype) == "Int64"


def test_us_dates_fall_back_to_month_first():
    r = ingest(csv("d\n10/25/2026\n11/30/2026\n"), "d.csv")
    assert types(r)["d"] == "date"
    assert r.frame["d"].iloc[0] == pd.Timestamp(2026, 10, 25)


def test_percent_and_negative_parentheses():
    r = ingest(csv("p,q\n12%,(300)\n7%,40\n"), "p.csv")
    assert r.frame["p"].tolist() == [12, 7]
    assert r.frame["q"].tolist() == [-300, 40]


def test_blank_rows_dropped_and_empty_cells_null():
    r = ingest(csv("a,b\n1,\n,\n2,x\n"), "a.csv")
    assert len(r.frame) == 2
    assert r.columns[1].empty_ratio == 0.5
    assert pd.isna(r.frame["b"].iloc[0])


def test_cp1252_csv_decodes():
    r = ingest("city\nMünchen\nSão Paulo\n".encode("cp1252"), "c.csv")
    assert r.frame["city"].tolist() == ["München", "São Paulo"]


def test_ragged_row_is_a_clear_error():
    with pytest.raises(IngestError, match="more cells than the header"):
        ingest(csv("a,b\n1,2\n3,4,5\n"), "r.csv")


@pytest.mark.parametrize("raw,msg", [(b"", "empty"), (b"a,b\n", "no data")])
def test_empty_files(raw, msg):
    with pytest.raises(IngestError, match=msg):
        ingest(raw, "e.csv")


def test_wrong_extension():
    with pytest.raises(IngestError, match=r"\.csv or \.xlsx"):
        ingest(b"x", "notes.txt")


def test_row_limit():
    with pytest.raises(IngestError, match="beta limit"):
        ingest(csv("a\n" + "1\n" * 11), "big.csv", max_rows=10)


def xlsx(sheets: dict[str, pd.DataFrame]) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        for name, df in sheets.items():
            df.to_excel(w, sheet_name=name, index=False)
    return buf.getvalue()


def test_xlsx_native_cells_and_sheet_choice():
    raw = xlsx(
        {
            "Summary": pd.DataFrame({"note": ["hi"]}),
            "Orders": pd.DataFrame({"When": pd.to_datetime(["2026-01-05", "2026-02-07"]), "Qty": [3, 4.5]}),
        }
    )
    first = ingest(raw, "book.xlsx")
    assert first.sheets == ["Summary", "Orders"] and first.sheet == "Summary"

    r = ingest(raw, "book.xlsx", sheet="Orders")
    assert types(r) == {"When": "date", "Qty": "number"}
    assert r.frame["Qty"].tolist() == [3.0, 4.5]
    with pytest.raises(IngestError, match="no sheet called"):
        ingest(raw, "book.xlsx", sheet="Nope")


def test_corrupt_xlsx():
    with pytest.raises(IngestError, match="couldn't open"):
        ingest(b"not a zip", "bad.xlsx")
