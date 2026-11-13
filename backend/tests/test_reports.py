"""Reports: quick exports, saved reports, downloads, print tokens, PDF runs, retention."""

import csv
import io
import time
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from openpyxl import load_workbook
from sqlalchemy import update
from sqlalchemy.orm import Session

from app import signing
from app.models import ReportRun, WorkspaceMember
from app.reports import pdf, runner
from tests.test_query import sign_in, upload


def _csv(content: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))


def _export(client, **body):
    r = client.post("/exports", json=body)
    assert r.status_code == 202, r.text
    run = client.get(f"/report-runs/{r.json()['id']}").json()  # ran in the background after the response
    return run


def _dashboard(client):
    ds = upload(client)
    d = client.post(f"/datasets/{ds['id']}/starter-dashboard").json()
    return ds, d


# ---------- quick exports ----------


def test_dataset_csv_has_every_row(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    run = _export(client, source="dataset", source_id=ds["id"], format="csv")
    assert run["status"] == "done" and run["rows"] == 6 and run["file_name"] == "sales.csv", run
    r = client.get(f"/report-runs/{run['id']}/download")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="sales.csv"' in r.headers["content-disposition"]
    rows = _csv(r.content)
    assert rows[0] == ["Date", "Region", "Product", "Amount"] and len(rows) == 7
    assert rows[1][1:] == ["North", "Pro", "100.0"]


def test_dataset_xlsx(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    run = _export(client, source="dataset", source_id=ds["id"], format="xlsx", name="Q1 sales")
    assert run["status"] == "done" and run["file_name"] == "Q1-sales.xlsx"
    wb = load_workbook(io.BytesIO(client.get(f"/report-runs/{run['id']}/download").content))
    ws = wb.worksheets[0]
    values = list(ws.values)
    assert values[0] == ("Date", "Region", "Product", "Amount") and len(values) == 7
    assert values[1][3] == 100 and values[6][1] is None


def test_row_cap_fails_with_a_clear_message(client, engine, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "report_max_rows", 3)
    sign_in(client, engine)
    ds = upload(client)
    run = _export(client, source="dataset", source_id=ds["id"], format="csv")
    assert run["status"] == "failed" and "more than 3 rows" in run["error"]
    assert client.get(f"/report-runs/{run['id']}/download").status_code == 409


def test_dashboard_xlsx_has_summary_and_a_sheet_per_chart(client, engine):
    sign_in(client, engine)
    _, d = _dashboard(client)
    run = _export(client, source="dashboard", source_id=d["id"], format="xlsx")
    assert run["status"] == "done", run
    wb = load_workbook(io.BytesIO(client.get(f"/report-runs/{run['id']}/download").content))
    assert wb.sheetnames[0] == "Summary" and len(wb.sheetnames) == 1 + len(d["charts"])
    summary = [r[0] for r in wb["Summary"].values]
    assert summary[0] == d["name"] and "What stands out" in summary
    titles = {c["spec"]["title"][:28] for c in d["charts"]}
    assert any(name in titles for name in wb.sheetnames[1:])


def test_dashboard_csv_is_a_zip_of_charts(client, engine):
    sign_in(client, engine)
    _, d = _dashboard(client)
    run = _export(client, source="dashboard", source_id=d["id"], format="csv", options={"period_days": 30})
    assert run["status"] == "done" and run["file_name"].endswith(".zip")
    z = zipfile.ZipFile(io.BytesIO(client.get(f"/report-runs/{run['id']}/download").content))
    assert len(z.namelist()) == len(d["charts"]) and all(n.endswith(".csv") for n in z.namelist())
    first = _csv(z.read(sorted(z.namelist())[0]))
    assert len(first[0]) >= 1  # a header row, metric columns labelled ("Total Amount", not "sum_Amount")
    assert not any(h.startswith("sum_") for n in z.namelist() for h in _csv(z.read(n))[0])


def test_saved_query_export_and_editor_rule(client, engine):
    ws = sign_in(client, engine)
    upload(client)
    q = client.post("/sql/saved", json={"name": "By region", "sql": 'SELECT "Region", SUM("Amount") AS total FROM sales GROUP BY 1 ORDER BY 2 DESC'}).json()
    run = _export(client, source="saved_query", source_id=q["id"], format="csv")
    assert run["status"] == "done" and run["name"] == "By region"
    assert _csv(client.get(f"/report-runs/{run['id']}/download").content)[1] == ["North", "325.0"]

    sign_in(client, engine, uid="u2", token="tok-2", company="Other")
    with engine.begin() as c:
        c.execute(update(WorkspaceMember).where(WorkspaceMember.user_id == "u2").values(workspace_id=ws, role="viewer"))
    assert client.post("/exports", json={"source": "saved_query", "source_id": q["id"], "format": "csv"}).status_code == 403


def test_fixed_range_export_and_validation(client, engine):
    sign_in(client, engine)
    _, d = _dashboard(client)
    opts = {"date_from": "2026-01-01", "date_to": "2026-01-31"}
    run = _export(client, source="dashboard", source_id=d["id"], format="xlsx", options=opts)
    wb = load_workbook(io.BytesIO(client.get(f"/report-runs/{run['id']}/download").content))
    assert list(wb["Summary"].values)[1] == ("Period", "Jan 01, 2026 – Jan 31, 2026")
    for bad in ({"date_from": "2026-01-01"}, {"date_from": "2026-02-01", "date_to": "2026-01-01"}):
        assert client.post("/exports", json={"source": "dashboard", "source_id": d["id"], "format": "csv", "options": bad}).status_code == 422


def test_pdf_is_only_for_dashboards(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    r = client.post("/exports", json={"source": "dataset", "source_id": ds["id"], "format": "pdf"})
    assert r.status_code == 422 and "dashboards" in r.json()["detail"]


def test_other_workspaces_cant_see_or_download(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    run = _export(client, source="dataset", source_id=ds["id"], format="csv")
    sign_in(client, engine, uid="u2", token="tok-2", company="Other")
    assert client.get(f"/report-runs/{run['id']}").status_code == 404
    assert client.get(f"/report-runs/{run['id']}/download").status_code == 404
    assert client.get("/report-runs").json() == []
    assert client.post("/exports", json={"source": "dataset", "source_id": ds["id"], "format": "csv"}).status_code == 404


# ---------- saved reports ----------


def test_saved_report_crud_and_run(client, engine):
    ws = sign_in(client, engine)
    _, d = _dashboard(client)
    body = {"name": "Weekly sales", "source": "dashboard", "source_id": d["id"], "format": "xlsx", "options": {"period_days": 7}}
    rep = client.post("/reports", json=body).json()
    assert rep["source_name"] == d["name"] and rep["last_run"] is None and rep["options"]["period_days"] == 7
    run = client.post(f"/reports/{rep['id']}/run").json()
    assert client.get(f"/reports/{rep['id']}").json()["last_run"]["id"] == run["id"]
    assert [r["id"] for r in client.get("/report-runs", params={"report_id": rep["id"]}).json()] == [run["id"]]

    upd = client.put(f"/reports/{rep['id']}", json={**body, "name": "Monthly", "format": "csv"}).json()
    assert (upd["name"], upd["format"]) == ("Monthly", "csv")

    # viewers can run and download, not create or delete
    sign_in(client, engine, uid="u2", token="tok-2", company="Other")
    with engine.begin() as c:
        c.execute(update(WorkspaceMember).where(WorkspaceMember.user_id == "u2").values(workspace_id=ws, role="viewer"))
    assert client.post("/reports", json=body).status_code == 403
    assert client.delete(f"/reports/{rep['id']}").status_code == 403
    viewer_run = client.post(f"/reports/{rep['id']}/run").json()
    assert client.get(f"/report-runs/{viewer_run['id']}/download").status_code == 200

    client.cookies.set("better-auth.session_token", "tok-1.c2lnbmF0dXJl")  # back to the owner
    assert client.delete(f"/reports/{rep['id']}").status_code == 204
    # history survives the report, unlinked
    assert {r["report_id"] for r in client.get("/report-runs").json()} == {None}


# ---------- print page and signed links ----------


def test_print_endpoints_use_the_token_period(client, engine):
    sign_in(client, engine)
    _, d = _dashboard(client)
    with Session(engine) as s:
        from app.models import Dashboard

        token = runner.print_token(s.get(Dashboard, d["id"]), {"period_days": 30})
    client.cookies.clear()  # no session: the token is the only credential
    assert client.get(f"/print/dashboards/{token}").json()["id"] == d["id"]
    view = client.get(f"/print/dashboards/{token}/view", params={"from": "2000-01-01"}).json()
    assert len(view["charts"]) == len(d["charts"]) and view["label"] != "All time"
    assert client.get(f"/print/dashboards/{token}x/view").status_code == 404
    assert client.get(f"/print/dashboards/{token}/filter-values/Region").json() == []


def test_signing_rejects_tampering_expiry_and_purpose():
    t = signing.sign("print", {"d": "abc"}, 60)
    assert signing.verify("print", t) == {"d": "abc"}
    body, mac = t.split(".")
    for bad in (f"{body}x.{mac}", f"{body}.{mac[:-2]}AA", "nonsense"):
        with pytest.raises(signing.BadToken):
            signing.verify("print", bad)
    with pytest.raises(signing.BadToken, match="purpose"):
        signing.verify("download", t)
    with pytest.raises(signing.BadToken, match="expired"):
        signing.verify("print", signing.sign("print", {}, 60, now=time.time() - 120))


def test_signed_download_link(client, engine):
    from app.routers.reports import download_link

    sign_in(client, engine)
    ds = upload(client)
    run_id = _export(client, source="dataset", source_id=ds["id"], format="csv")["id"]
    with Session(engine) as s:
        link = download_link(s.get(ReportRun, run_id))
    path = link.split("/api", 1)[1]
    client.cookies.clear()
    assert client.get(path).status_code == 200
    assert client.get(path[:-3] + "abc").status_code == 404


# ---------- PDF runs (browser mocked; the real render is checked end to end in Docker) ----------


def test_pdf_run_renders_and_stores(client, engine, monkeypatch):
    seen = {}

    def fake_render(token, out_path, *, landscape, page_size, **_):
        seen.update(data=signing.verify("print", token), landscape=landscape, page_size=page_size)
        with open(out_path, "wb") as f:
            f.write(b"%PDF-1.7 fake")

    monkeypatch.setattr(pdf, "render_dashboard_pdf", fake_render)
    sign_in(client, engine)
    _, d = _dashboard(client)
    run = _export(client, source="dashboard", source_id=d["id"], format="pdf", options={"orientation": "landscape", "page_size": "Letter", "filters": {"Region": "North"}})
    assert run["status"] == "done" and run["file_name"].endswith(".pdf"), run
    assert seen["landscape"] is True and seen["page_size"] == "Letter" and seen["data"]["f"] == {"Region": "North"}
    r = client.get(f"/report-runs/{run['id']}/download")
    assert r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")


def test_render_crash_fails_the_run_in_process(client, engine, monkeypatch):
    def crash(*_a, **_k):
        raise pdf.RenderError("Couldn't render the PDF: browser closed")

    monkeypatch.setattr(pdf, "render_dashboard_pdf", crash)
    sign_in(client, engine)
    _, d = _dashboard(client)
    run = _export(client, source="dashboard", source_id=d["id"], format="pdf")
    assert run["status"] == "failed" and "try again" in run["error"].lower()


def test_celery_report_task_eager(client, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker

    from app import worker
    from app.config import get_settings

    sign_in(client, engine)
    ds = upload(client)
    monkeypatch.setattr(worker, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False))
    monkeypatch.setattr(get_settings(), "redis_url", "redis://example.invalid:6379/0")  # dispatch goes to Celery
    worker.celery_app.conf.task_always_eager = True
    try:
        run_id = client.post("/exports", json={"source": "dataset", "source_id": ds["id"], "format": "csv"}).json()["id"]
    finally:
        worker.celery_app.conf.task_always_eager = False
    assert client.get(f"/report-runs/{run_id}").json()["status"] == "done"


# ---------- retention ----------


def test_prune_deletes_old_runs_and_files(client, engine):
    from app.reports.storage import get_storage

    sign_in(client, engine)
    ds = upload(client)
    old_id = _export(client, source="dataset", source_id=ds["id"], format="csv")["id"]
    new_id = _export(client, source="dataset", source_id=ds["id"], format="csv")["id"]
    with Session(engine) as s:
        old = s.get(ReportRun, old_id)
        key = old.file_key
        old.created_at = datetime.now(timezone.utc) - timedelta(days=40)
        s.commit()
        assert get_storage().local_path(key)
        assert runner.prune(s, keep_days=30) == 1
        assert get_storage().local_path(key) is None
        assert s.get(ReportRun, new_id) is not None
