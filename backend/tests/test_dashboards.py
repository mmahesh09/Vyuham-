from sqlalchemy import update

from app.models import WorkspaceMember
from tests.test_query import sign_in, upload

PROFILE = {"job_role": "Owner", "dashboard_visibility": "anyone"}
U1_COOKIE = "tok-1.c2lnbmF0dXJl"


def spec(ds_id, **kw):
    return {"dataset": ds_id, "metrics": [{"field": "Amount", "agg": "sum"}], "chartType": "bar", "title": "Amount", **kw}


def new_dashboard(client, name="Sales"):
    r = client.post("/dashboards", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def add(client, d, **kw):
    r = client.post(f"/dashboards/{d['id']}/charts", json=kw)
    assert r.status_code == 201, r.text
    return r.json()


def by_id(view):
    return {c["id"]: c for c in view["charts"]}


def test_crud_and_list(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = new_dashboard(client)
    c1 = add(client, d, spec=spec(ds["id"], groupBy="Region"))
    add(client, d, spec=spec(ds["id"], chartType="kpi"), kind="kpi")
    got = client.get(f"/dashboards/{d['id']}").json()
    assert got["charts"][0]["id"] == c1["id"]
    assert got["date_fields"] == {ds["id"]: "Date"}  # picked up from the dataset automatically
    assert got["datasets"][0]["name"] == "sales" and got["can_edit"] is True
    listed = client.get("/dashboards").json()
    assert (listed[0]["chart_count"], listed[0]["kpi_count"], listed[0]["dataset_names"]) == (1, 1, ["sales"])

    assert client.patch(f"/dashboards/{d['id']}", json={"name": "Renamed", "filter_columns": ["Region"]}).json()["name"] == "Renamed"
    assert client.patch(f"/dashboards/{d['id']}", json={"date_fields": {ds["id"]: "Region"}}).status_code == 422
    assert client.patch(f"/charts/{c1['id']}", json={"note": "Watch the North"}).json()["note"] == "Watch the North"
    assert client.delete(f"/charts/{c1['id']}").status_code == 204
    assert client.delete(f"/dashboards/{d['id']}").status_code == 204
    assert client.get(f"/dashboards/{d['id']}").status_code == 404


def test_bad_chart_specs_rejected(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = new_dashboard(client)
    url = f"/dashboards/{d['id']}/charts"
    assert client.post(url, json={"spec": spec(ds["id"], groupBy="Ghost")}).status_code == 422
    assert client.post(url, json={"spec": spec("nope")}).status_code == 404
    assert client.post(url, json={"spec": spec(ds["id"], chartType="radar")}).status_code == 422
    assert client.post(url, json={"spec": spec(ds["id"], sql="DROP TABLE x")}).status_code == 422  # no extra keys
    assert client.post(url, json={"spec": spec(ds["id"], color="red")}).status_code == 422


def test_view_numbers_filters_and_insights(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = new_dashboard(client)
    client.patch(f"/dashboards/{d['id']}", json={"filter_columns": ["Region"]})
    trend = add(client, d, spec=spec(ds["id"], groupBy="Date", dateBucket="month", chartType="line"))
    kpi = add(client, d, spec=spec(ds["id"], chartType="kpi"), kind="kpi")
    bar = add(client, d, spec=spec(ds["id"], groupBy="Region"))

    # All time: the trend compares the last two months (Mar 300 vs Feb 225 = +33%)
    v = by_id(client.get(f"/dashboards/{d['id']}/view").json())
    assert [r["sum_Amount"] for r in v[trend["id"]]["rows"]] == [150, 225, 300]
    assert v[trend["id"]]["insight"]["headline"] == "Total Amount up 33% in Mar 2026"
    assert v[kpi["id"]]["rows"] == [{"sum_Amount": 675}]
    assert v[bar["id"]]["insight"]["headline"] == "North leads with 48% of total amount"

    # Feb vs the 28 days before it (Jan 4–31: 150) -> 225 is +50%
    r = client.get(f"/dashboards/{d['id']}/view", params={"from": "2026-02-01", "to": "2026-02-28"}).json()
    assert r["period"] == {"date_from": "2026-02-01", "date_to": "2026-02-28", "prev_from": "2026-01-04", "prev_to": "2026-01-31"}
    insight = by_id(r)[kpi["id"]]["insight"]
    assert (insight["headline"], insight["trend"]) == ("Total Amount up 50% to 225", "up")

    # Category filters apply only to the dashboard's filter columns
    r = client.get(f"/dashboards/{d['id']}/view", params={"f": '{"Region": "North"}'}).json()
    assert by_id(r)[kpi["id"]]["rows"] == [{"sum_Amount": 325}]
    r = client.get(f"/dashboards/{d['id']}/view", params={"f": '{"Product": "Pro"}'}).json()
    assert by_id(r)[kpi["id"]]["rows"] == [{"sum_Amount": 675}]
    assert client.get(f"/dashboards/{d['id']}/filter-values/Region").json() == ["North", "South", "West"]
    assert client.get(f"/dashboards/{d['id']}/view", params={"from": "2026-03-01", "to": "2026-01-01"}).status_code == 422
    assert client.get(f"/dashboards/{d['id']}/view", params={"f": "[1]"}).status_code == 422


def test_deleted_dataset_shows_error_card(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = new_dashboard(client)
    add(client, d, spec=spec(ds["id"]))
    client.delete(f"/datasets/{ds['id']}")
    assert "deleted" in client.get(f"/dashboards/{d['id']}/view").json()["charts"][0]["error"]


def test_reorder_duplicate_and_kpi_layout(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = new_dashboard(client)
    ids = [add(client, d, spec=spec(ds["id"], title=f"c{i}"))["id"] for i in range(3)]
    r = client.put(f"/dashboards/{d['id']}/order", json={"chart_ids": [ids[2], ids[0], ids[1]]})
    assert [c["id"] for c in r.json()] == [ids[2], ids[0], ids[1]]
    assert [c["spec"]["title"] for c in client.get(f"/dashboards/{d['id']}").json()["charts"]] == ["c2", "c0", "c1"]
    assert client.put(f"/dashboards/{d['id']}/order", json={"chart_ids": ["ghost"]}).status_code == 422
    client.patch(f"/dashboards/{d['id']}", json={"kpi_layout": [{"i": ids[0], "x": 0, "y": 0, "w": 4, "h": 1}]})
    copy = client.post(f"/dashboards/{d['id']}/duplicate").json()
    assert copy["name"] == "Sales (copy)" and len(copy["charts"]) == 3
    new_ids = {c["id"] for c in copy["charts"]}
    assert copy["kpi_layout"][0]["i"] in new_ids and copy["kpi_layout"][0]["i"] != ids[0]


def test_preview_and_starter_dashboard(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    p = client.post("/charts/preview", json={"spec": spec(ds["id"], groupBy="Product")}).json()
    assert {r["Product"]: r["sum_Amount"] for r in p["rows"]} == {"Setup": 500, "Pro": 175}
    bad = spec(ds["id"], metrics=[{"field": "Region", "agg": "sum"}])
    assert client.post("/charts/preview", json={"spec": bad}).status_code == 422

    d = client.post(f"/datasets/{ds['id']}/starter-dashboard").json()
    kinds = [c["kind"] for c in d["charts"]]
    assert kinds.count("kpi") >= 2 and kinds.count("card") >= 2
    types = [c["spec"]["chartType"] for c in d["charts"]]
    assert "line" in types and "bar" in types
    assert d["date_fields"] == {ds["id"]: "Date"} and "Region" in d["filter_columns"]
    view = client.get(f"/dashboards/{d['id']}/view").json()
    assert all(c["error"] is None and c["insight"] for c in view["charts"])


def test_share_link_rules(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = new_dashboard(client)
    add(client, d, spec=spec(ds["id"]))
    assert client.post(f"/dashboards/{d['id']}/share").status_code == 409  # profile still "team only"
    client.put("/me/profile", json=PROFILE)
    token = client.post(f"/dashboards/{d['id']}/share").json()["share_token"]
    assert token

    client.cookies.clear()  # anonymous visitor
    pub = client.get(f"/public/dashboards/{token}").json()
    assert pub["name"] == "Sales" and pub["share_token"] is None and pub["can_edit"] is False
    assert client.get(f"/public/dashboards/{token}/view").json()["charts"][0]["rows"] == [{"sum_Amount": 675}]
    assert client.get("/public/dashboards/wrong/view").status_code == 404

    # switching the profile back to "team only" disables existing links
    client.cookies.set("better-auth.session_token", U1_COOKIE)
    client.put("/me/profile", json={**PROFILE, "dashboard_visibility": "team"})
    client.cookies.clear()
    assert client.get(f"/public/dashboards/{token}/view").status_code == 403
    # revoking removes the link for good
    client.cookies.set("better-auth.session_token", U1_COOKIE)
    client.put("/me/profile", json=PROFILE)
    client.delete(f"/dashboards/{d['id']}/share")
    client.cookies.clear()
    assert client.get(f"/public/dashboards/{token}").status_code == 404


def test_isolation_and_viewers(client, engine):
    ws = sign_in(client, engine)
    ds = upload(client)
    d = new_dashboard(client)
    sign_in(client, engine, uid="u2", token="tok-2", company="Other")
    assert client.get(f"/dashboards/{d['id']}").status_code == 404
    assert client.get("/dashboards").json() == []
    mine = new_dashboard(client, "Mine")  # u2 can't chart u1's dataset
    assert client.post(f"/dashboards/{mine['id']}/charts", json={"spec": spec(ds["id"])}).status_code == 404
    with engine.begin() as conn:  # u2 becomes a viewer in u1's workspace
        conn.execute(update(WorkspaceMember).where(WorkspaceMember.user_id == "u2").values(workspace_id=ws, role="viewer"))
    assert client.get(f"/dashboards/{d['id']}").json()["can_edit"] is False
    assert client.get(f"/dashboards/{d['id']}/view").status_code == 200
    assert client.post("/dashboards", json={"name": "x"}).status_code == 403
    assert client.post(f"/dashboards/{d['id']}/charts", json={"spec": spec(ds["id"])}).status_code == 403
    assert client.post(f"/dashboards/{d['id']}/share").status_code == 403


def test_trend_skips_the_unfinished_month():
    from datetime import date

    from app.insights import describe
    from app.models import Dataset

    ds = Dataset(id="d", columns=[{"name": "Date", "type": "date"}, {"name": "Amount", "type": "number"}])
    spec = {"metrics": [{"field": "Amount", "agg": "sum"}], "groupBy": "Date", "dateBucket": "month", "chartType": "line"}
    rows = [{"Date": "2026-09", "sum_Amount": 100}, {"Date": "2026-10", "sum_Amount": 150}, {"Date": "2026-11", "sum_Amount": 20}]
    # On Nov 9 the November bucket is partial: compare Oct with Sep, mention Nov so far
    i = describe(spec, rows, None, ds, has_period=False, today=date(2026, 11, 9))
    assert i.headline == "Total Amount up 50% in Oct 2026"
    assert "Nov 2026 so far: 20" in i.note
    # In December, November is complete
    assert describe(spec, rows, None, ds, has_period=False, today=date(2026, 12, 2)).headline == "Total Amount down 87% in Nov 2026"
