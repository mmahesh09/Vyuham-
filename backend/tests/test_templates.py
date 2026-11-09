from tests.test_query import sign_in, upload


def test_list_suggest_apply(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    ids = [t["id"] for t in client.get("/templates").json()]
    assert ids == ["sales", "startup", "expenses"]

    m = client.get("/templates/sales/suggest", params={"dataset_id": ds["id"]}).json()
    assert m["date"] == "Date" and m["amount"] == "Amount" and m["product"] == "Product" and m["region"] == "Region"
    assert m["customer"] is None  # no customer-like column

    d = client.post("/templates/sales/apply", json={"dataset_id": ds["id"], "mapping": m}).json()
    titles = [c["spec"]["title"] for c in d["charts"]]
    assert "Revenue" in titles and "Revenue by product" in titles
    assert "Top customers" not in titles and "Customers" not in titles  # optional field left out
    assert d["date_fields"] == {ds["id"]: "Date"} and d["filter_columns"] == ["Region", "Product"]
    view = client.get(f"/dashboards/{d['id']}/view").json()["charts"]
    assert all(c["error"] is None for c in view)
    kpi = next(c for c in d["charts"] if c["spec"]["title"] == "Revenue")
    assert next(v for v in view if v["id"] == kpi["id"])["rows"] == [{"sum_Amount": 675}]


def test_apply_validates_mapping(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    url = "/templates/expenses/apply"
    assert client.post(url, json={"dataset_id": ds["id"], "mapping": {"date": "Date", "amount": "Amount"}}).status_code == 422  # category required
    bad_type = {"date": "Date", "amount": "Region", "category": "Product"}
    r = client.post(url, json={"dataset_id": ds["id"], "mapping": bad_type})
    assert r.status_code == 422 and "needs a number" in r.json()["detail"]
    assert client.post(url, json={"dataset_id": ds["id"], "mapping": {"date": "Ghost", "amount": "Amount", "category": "Product"}}).status_code == 422
    assert client.post("/templates/nope/apply", json={"dataset_id": ds["id"], "mapping": {}}).status_code == 404
    ok = client.post(url, json={"dataset_id": ds["id"], "mapping": {"date": "Date", "amount": "Amount", "category": "Product"}, "name": "Q1 costs"})
    assert ok.status_code == 201 and ok.json()["name"] == "Q1 costs"
