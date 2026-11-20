"""The Colour shelf: `seriesBy` splits a chart into one series per value of a second dimension."""

from tests.test_dashboards import spec
from tests.test_query import sign_in, upload


def preview(client, s):
    return client.post("/charts/preview", json={"spec": s})


def test_split_by_colour_gives_one_row_per_label_and_series(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    r = preview(client, spec(ds["id"], chartType="line", groupBy="Date", dateBucket="month", seriesBy="Region"))
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    got = {(row["Date"], row["Region"]): row["sum_Amount"] for row in rows}
    assert list(got.values()) == [100, 50, 225, 300]  # months in order, series sorted within a month
    assert {region for _, region in got} == {"North", "South", "West"}  # the empty region is left out
    assert [d for d, _ in got] == sorted(d for d, _ in got)


def test_headline_describes_the_whole_chart(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    split = preview(client, spec(ds["id"], groupBy="Product", seriesBy="Region")).json()
    whole = preview(client, spec(ds["id"], groupBy="Product")).json()
    assert split["insight"] == whole["insight"]


def test_only_the_eight_largest_series_are_kept(client, engine):
    sign_in(client, engine)
    lines = [b"Month,Store,Amount"]
    for i in range(10):  # store s9 sells most, s0 least
        lines += [f"2026-01-01,s{i},{(i + 1) * 10}".encode(), f"2026-02-01,s{i},{(i + 1) * 10}".encode()]
    ds = upload(client, b"\n".join(lines) + b"\n", name="stores.csv")
    rows = preview(client, spec(ds["id"], chartType="bar", groupBy="Month", dateBucket="month", seriesBy="Store")).json()["rows"]
    stores = {r["Store"] for r in rows}
    assert stores == {f"s{i}" for i in range(2, 10)}
    assert len(rows) == 16


def test_value_sort_orders_labels_by_their_total_across_series(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    rows = preview(client, spec(ds["id"], groupBy="Product", seriesBy="Region", sort="value_desc")).json()["rows"]
    assert [r["Product"] for r in rows][0] == "Setup"  # Setup 500 > Pro 175


def test_split_is_refused_where_it_cannot_be_drawn(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    for chart_type in ("pie", "kpi", "gauge", "funnel", "treemap", "scatter"):
        assert preview(client, spec(ds["id"], chartType=chart_type, groupBy="Product", seriesBy="Region")).status_code == 422
    assert preview(client, spec(ds["id"], seriesBy="Region")).status_code == 422  # nothing on Columns
    assert preview(client, spec(ds["id"], groupBy="Region", seriesBy="Region")).status_code == 422  # same field twice
    assert preview(client, spec(ds["id"], groupBy="Product", seriesBy="Amount")).status_code == 422  # a number
    assert preview(client, spec(ds["id"], groupBy="Product", seriesBy="Nope")).status_code == 422  # not a column
    sql = spec(ds["id"], groupBy="Product", seriesBy="Region", sql="SELECT 1")
    assert preview(client, sql).status_code == 422


def test_split_charts_save_and_render_on_dashboards(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    d = client.post("/dashboards", json={"name": "Sales"}).json()
    r = client.post(f"/dashboards/{d['id']}/charts", json={"spec": spec(ds["id"], groupBy="Product", seriesBy="Region")})
    assert r.status_code == 201, r.text
    view = client.get(f"/dashboards/{d['id']}/view").json()
    chart = view["charts"][0]
    assert chart.get("error") is None
    assert {row["Region"] for row in chart["rows"]} == {"North", "South", "West"}
