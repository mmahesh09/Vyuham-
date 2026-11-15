"""Regression tests for the 2026-11-15 security review (see the report for the write-ups)."""

import io
import zipfile

import pandas as pd
import pytest
from openpyxl import load_workbook

from app.ingest import IngestError, ingest
from tests.conftest import add_user
from tests.test_dashboards import PROFILE, U1_COOKIE, add, new_dashboard, spec
from tests.test_query import sign_in, upload
from tests.test_reports import _csv, _export

U2_COOKIE = "tok-2.c2lnbmF0dXJl"


def _join_as(client, engine, role="editor"):
    """u2 joins u1's workspace through an invite; leaves the client signed in as u2."""
    token = client.post("/workspace/invites", json={"role": role}).json()["token"]
    client.cookies.set("better-auth.session_token", add_user(engine, uid="u2", token="tok-2", name="Ravi", company="R"))
    assert client.post(f"/invites/{token}/accept").status_code == 200


# ---------- 1. a removed member can't export the old workspace's data ----------


def test_removed_member_export_leaves_old_workspace_behind(client, engine):
    sign_in(client, engine)
    _join_as(client, engine)
    upload(client, name="customers.csv")  # u2 uploads into u1's workspace
    new_dashboard(client, "Ravi's board")
    client.post("/tasks", json={"title": "Call the bank"})
    client.cookies.set("better-auth.session_token", U1_COOKIE)
    assert client.delete("/workspace/members/u2").status_code == 204

    client.cookies.set("better-auth.session_token", U2_COOKIE)
    r = client.get("/account/export")
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert not [n for n in z.namelist() if n.startswith("datasets/")]
    assert b"Ravi's board" not in z.read("dashboards.json")
    assert b"Call the bank" not in z.read("tasks.json")


def test_export_still_includes_current_workspace_uploads(client, engine):
    sign_in(client, engine)
    upload(client)
    z = zipfile.ZipFile(io.BytesIO(client.get("/account/export").content))
    assert "datasets/sales.csv" in z.namelist()


# ---------- 2. share links show charts, not raw column values ----------


def test_share_link_hides_raw_values(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = new_dashboard(client)
    client.patch(f"/dashboards/{d['id']}", json={"filter_columns": ["Region"]})
    add(client, d, spec=spec(ds["id"], groupBy="Region"))
    sql = "SELECT Region, SUM(Amount) AS Amount FROM sales GROUP BY 1"
    add(client, d, spec=spec(ds["id"], groupBy="Region", sql=sql))
    client.put("/me/profile", json=PROFILE)
    token = client.post(f"/dashboards/{d['id']}/share").json()["share_token"]

    # signed-in members still see everything
    mine = client.get(f"/dashboards/{d['id']}").json()
    assert any(c["examples"] for c in mine["datasets"][0]["columns"])
    assert any(c["spec"].get("sql") for c in mine["charts"])

    client.cookies.clear()
    pub = client.get(f"/public/dashboards/{token}").json()
    assert all(c["examples"] == [] for c in pub["datasets"][0]["columns"])
    assert not any("sql" in c["spec"] or "params" in c["spec"] for c in pub["charts"])
    assert client.get(f"/public/dashboards/{token}/filter-values/Region").json() == ["North", "South", "West"]
    assert client.get(f"/public/dashboards/{token}/filter-values/Product").json() == []  # not a filter column
    # the SQL chart still draws for the anonymous reader
    view = client.get(f"/public/dashboards/{token}/view").json()
    assert all(c.get("error") is None for c in view["charts"])


# ---------- 3. exports don't carry live formulas ----------

FORMULAS = (
    b"Region,Note,Amount\n"
    b'North,"=HYPERLINK(""https://evil.example"",""x"")",1\n'
    b"South,-5,2\n"
    b"West,@SUM(A1),3\n"
    b"East,+cmd,4\n"
    b"East,plain,5\n"
)


def test_csv_export_neutralises_formulas(client, engine):
    sign_in(client, engine)
    ds = upload(client, data=FORMULAS, name="notes.csv")
    run = _export(client, source="dataset", source_id=ds["id"], format="csv")
    rows = _csv(client.get(f"/report-runs/{run['id']}/download").content)
    notes = [r[1] for r in rows[1:]]
    assert notes == ['\'=HYPERLINK("https://evil.example","x")', "-5", "'@SUM(A1)", "'+cmd", "plain"]


def test_xlsx_export_writes_formulas_as_text(client, engine):
    sign_in(client, engine)
    ds = upload(client, data=FORMULAS, name="notes.csv")
    run = _export(client, source="dataset", source_id=ds["id"], format="xlsx")
    ws = load_workbook(io.BytesIO(client.get(f"/report-runs/{run['id']}/download").content)).active
    cells = [ws.cell(row=i, column=2) for i in range(2, 7)]
    assert all(c.data_type == "s" for c in cells)
    assert cells[0].value.startswith("'=HYPERLINK")


# ---------- 4. SQL charts are for editors ----------


def test_viewer_cannot_run_sql_through_chart_preview(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    body = {"spec": spec(ds["id"], groupBy="Region", sql="SELECT Region, SUM(Amount) AS Amount FROM sales GROUP BY 1")}
    assert client.post("/charts/preview", json=body).status_code == 200  # owner
    _join_as(client, engine, role="viewer")
    assert client.post("/charts/preview", json=body).status_code == 403
    assert client.post("/charts/preview", json={"spec": spec(ds["id"], groupBy="Region")}).status_code == 200


# ---------- upload hardening ----------


def _xlsx(frame: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    frame.to_excel(buf, index=False)
    return buf.getvalue()


def test_xlsx_that_unpacks_too_large_is_refused(monkeypatch):
    from app.config import get_settings

    raw = _xlsx(pd.DataFrame({"a": ["x" * 100] * 2000}))  # compresses well
    assert ingest(raw, "ok.xlsx").columns[0].name == "a"
    monkeypatch.setattr(get_settings(), "max_xlsx_uncompressed_bytes", 50_000)
    with pytest.raises(IngestError, match="unpacks to more than"):
        ingest(raw, "big.xlsx")


def test_not_a_zip_is_a_clear_error():
    with pytest.raises(IngestError, match="valid .xlsx"):
        ingest(b"not a zip at all", "fake.xlsx")


# ---------- rate limits ----------


def test_public_links_are_rate_limited(client):
    codes = [client.get("/public/dashboards/nope").status_code for _ in range(61)]
    assert codes[:60] == [404] * 60 and codes[60] == 429
    r = client.get("/public/dashboards/nope")
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
    assert client.get("/health").status_code == 200  # health checks are never limited


def test_limits_are_per_account(client, engine):
    sign_in(client, engine)
    for _ in range(5):
        assert client.get("/account/export").status_code == 200
    assert client.get("/account/export").status_code == 429
    sign_in(client, engine, uid="u2", token="tok-2", company="Other")
    assert client.get("/account/export").status_code == 200  # a different person has their own budget
