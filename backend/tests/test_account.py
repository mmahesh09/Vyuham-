import io
import zipfile

from sqlalchemy import func, select, text

from app.auth_tables import session_table, user_table
from app.models import Dataset, UserProfile, WorkspaceMember
from tests.conftest import add_user
from tests.test_query import sign_in, upload

U1 = "tok-1.c2lnbmF0dXJl"


def test_export_contains_my_data(client, engine):
    sign_in(client, engine)
    upload(client)
    client.put("/me/profile", json={"job_role": "Finance lead"})
    client.post("/tasks", json={"title": "Check March"})
    r = client.get("/account/export")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(z.namelist())
    assert {"README.txt", "account.json", "tasks.json", "dashboards.json", "datasets/sales.csv"} <= names
    assert b"Finance lead" in z.read("account.json") and b"Check March" in z.read("tasks.json")
    assert b'"password"' not in z.read("account.json")  # hashes live in Better Auth's account table, never exported
    assert z.read("datasets/sales.csv").startswith(b"Date,Region,Product,Amount")


def test_delete_solo_account_erases_everything(client, engine, data_dir):
    ws = sign_in(client, engine)
    upload(client)
    client.put("/me/profile", json={"job_role": "Owner"})
    assert client.request("DELETE", "/account", json={"confirm": "wrong@x.co"}).status_code == 422
    assert client.request("DELETE", "/account", json={"confirm": "U1@ACME.CO"}).status_code == 204
    with engine.connect() as c:
        assert c.execute(select(func.count()).select_from(user_table)).scalar() == 0
        assert c.execute(select(func.count()).select_from(session_table)).scalar() == 0
        for model in (WorkspaceMember, UserProfile, Dataset):
            assert c.execute(select(func.count()).select_from(model)).scalar() == 0
        assert c.execute(text("SELECT COUNT(*) FROM workspaces")).scalar() == 0
    assert not (data_dir / ws).exists()
    assert client.get("/me").status_code == 401  # session is gone


def test_last_owner_with_teammates_cannot_delete_or_leave(client, engine):
    ws = sign_in(client, engine)
    token = client.post("/workspace/invites", json={"role": "editor"}).json()["token"]
    client.cookies.set("better-auth.session_token", add_user(engine, uid="u2", token="tok-2", name="Ravi", company="R"))
    client.post(f"/invites/{token}/accept")
    client.cookies.set("better-auth.session_token", U1)
    r = client.request("DELETE", "/account", json={"confirm": "u1@acme.co"})
    assert r.status_code == 409 and "only owner" in r.json()["detail"]
    assert client.post("/workspace/leave").status_code == 409
    # the editor can leave; their next visit gets a fresh workspace
    client.cookies.set("better-auth.session_token", "tok-2.c2lnbmF0dXJl")
    assert client.post("/workspace/leave").status_code == 204
    assert client.get("/me").json()["workspace"]["id"] != ws


def test_member_deleting_account_keeps_shared_work(client, engine):
    sign_in(client, engine)
    token = client.post("/workspace/invites", json={"role": "editor"}).json()["token"]
    client.cookies.set("better-auth.session_token", add_user(engine, uid="u2", token="tok-2", name="Ravi", company="R"))
    client.post(f"/invites/{token}/accept")
    ds = upload(client)
    t = client.post("/tasks", json={"title": "Mine", "assignee_id": "u2"}).json()
    assert client.request("DELETE", "/account", json={"confirm": "u2@acme.co"}).status_code == 204
    client.cookies.set("better-auth.session_token", U1)
    assert client.get(f"/datasets/{ds['id']}").status_code == 200  # shared data stays
    task = next(x for x in client.get("/tasks").json() if x["id"] == t["id"])
    assert task["assignee_id"] is None and task["created_by"] is None
    assert [m["id"] for m in client.get("/workspace/members").json()] == ["u1"]


def test_delete_workspace(client, engine, data_dir):
    ws = sign_in(client, engine)
    upload(client)
    client.post("/dashboards", json={"name": "D"})
    assert client.request("DELETE", "/workspace", json={"confirm": "acme"}).status_code == 422  # exact name
    assert client.request("DELETE", "/workspace", json={"confirm": "Acme"}).status_code == 204
    assert not (data_dir / ws).exists()
    me = client.get("/me").json()  # still signed in, with a new empty workspace
    assert me["workspace"]["id"] != ws and client.get("/datasets").json() == []
