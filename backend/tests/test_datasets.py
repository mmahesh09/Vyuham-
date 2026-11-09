import pandas as pd

from app.routers.datasets import parquet_path
from tests.conftest import add_user

SALES = b"Client,Amount\nAcme,100\nBolt,250\n"


def sign_in(client, engine, uid="u1", token="tok-1"):
    client.cookies.set("better-auth.session_token", add_user(engine, uid, token=token))
    return client.get("/me").json()["workspace"]["id"]


def upload(client, name="sales.csv", data=SALES, **form):
    return client.post("/datasets", files={"file": (name, data, "text/csv")}, data=form)


def test_upload_requires_session(client):
    assert upload(client).status_code == 401


def test_upload_saves_parquet_and_metadata(client, engine):
    ws = sign_in(client, engine)
    r = upload(client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "sales" and body["row_count"] == 2
    assert [c["type"] for c in body["columns"]] == ["text", "number"]

    frame = pd.read_parquet(parquet_path(ws, body["id"]))
    assert frame["Amount"].tolist() == [100, 250]

    listed = client.get("/datasets").json()
    assert [d["id"] for d in listed] == [body["id"]]
    assert client.get(f"/datasets/{body['id']}").json()["name"] == "sales"


def test_same_file_twice_gets_a_new_name(client, engine):
    sign_in(client, engine)
    upload(client)
    assert upload(client).json()["name"] == "sales (2)"


def test_bad_file_is_422_with_message(client, engine):
    sign_in(client, engine)
    r = upload(client, data=b"a,b\n")
    assert r.status_code == 422
    assert "no data" in r.json()["detail"]


def test_too_large_is_413(client, engine, monkeypatch):
    from app.config import get_settings

    sign_in(client, engine)
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 10)
    assert upload(client).status_code == 413


def test_client_path_in_filename_is_ignored(client, engine):
    sign_in(client, engine)
    r = upload(client, name="../../etc/sales.csv")
    assert r.json()["source_filename"] == "sales.csv"


def test_other_workspaces_cannot_see_dataset(client, engine):
    sign_in(client, engine, "a", "ta")
    ds = upload(client).json()["id"]
    sign_in(client, engine, "b", "tb")
    assert client.get(f"/datasets/{ds}").status_code == 404
    assert client.get("/datasets").json() == []
