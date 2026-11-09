from datetime import date, timedelta

from tests.conftest import add_user
from tests.test_query import sign_in, upload

U1 = "tok-1.c2lnbmF0dXJl"


def as_user(client, cookie):
    client.cookies.set("better-auth.session_token", cookie)


def new_user(engine, uid, token, name="Ravi"):
    return add_user(engine, uid=uid, token=token, name=name, company=f"{name} Co")


def invite(client, role="editor"):
    r = client.post("/workspace/invites", json={"role": role})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def test_invite_flow_new_user(client, engine):
    ws = sign_in(client, engine)
    token = invite(client, "editor")
    assert [i["token"] for i in client.get("/workspace/invites").json()] == [token]

    client.cookies.clear()
    info = client.get(f"/invites/{token}").json()
    assert info == {"workspace_name": "Acme", "role": "editor", "invited_by": "Asha Rao", "valid": True, "reason": None}

    # brand-new user who hasn't opened the app yet (no workspace)
    as_user(client, new_user(engine, "u2", "tok-2"))
    assert client.post(f"/invites/{token}/accept").status_code == 200
    me = client.get("/me").json()
    assert me["workspace"]["id"] == ws and me["role"] == "editor"
    assert client.post(f"/invites/{token}/accept").status_code == 410  # single use
    assert not client.get(f"/invites/{token}").json()["valid"]


def test_accept_replaces_only_an_empty_workspace(client, engine):
    sign_in(client, engine)
    token = invite(client)
    token2 = invite(client)
    # u2 already opened the app: an empty auto-created workspace is fine to drop
    as_user(client, new_user(engine, "u2", "tok-2"))
    own = client.get("/me").json()["workspace"]["id"]
    assert client.post(f"/invites/{token}/accept").status_code == 200
    assert client.get("/me").json()["workspace"]["id"] != own
    # u3 has data in their own workspace: refused, nothing lost
    as_user(client, new_user(engine, "u3", "tok-3", name="Meera"))
    client.get("/me")
    upload(client)
    r = client.post(f"/invites/{token2}/accept")
    assert r.status_code == 409 and "one workspace" in r.json()["detail"]
    assert len(client.get("/datasets").json()) == 1


def test_expired_and_revoked_invites(client, engine):
    from sqlalchemy import update

    from app.models import Invite

    sign_in(client, engine)
    token = invite(client)
    with engine.begin() as c:
        c.execute(update(Invite).values(expires_at=date.today() - timedelta(days=1)))
    assert "expired" in client.get(f"/invites/{token}").json()["reason"]
    t2 = invite(client)
    assert client.delete(f"/workspace/invites/{t2}").status_code == 204
    assert not client.get(f"/invites/{t2}").json()["valid"]


def test_roles_and_owner_guards(client, engine):
    sign_in(client, engine)
    token = invite(client, "viewer")
    as_user(client, new_user(engine, "u2", "tok-2"))
    client.post(f"/invites/{token}/accept")
    assert client.post("/workspace/invites", json={"role": "editor"}).status_code == 403  # viewers can't invite
    as_user(client, U1)
    assert client.patch("/workspace/members/u1", json={"role": "editor"}).status_code == 409  # last owner
    assert client.delete("/workspace/members/u1").status_code == 409
    assert client.patch("/workspace/members/u2", json={"role": "editor"}).json()["role"] == "editor"
    assert client.delete("/workspace/members/u2").status_code == 204
    assert [m["id"] for m in client.get("/workspace/members").json()] == ["u1"]


def test_tasks_crud_order_and_permissions(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    token = invite(client, "viewer")
    as_user(client, new_user(engine, "u2", "tok-2"))
    client.post(f"/invites/{token}/accept")
    as_user(client, U1)

    t1 = client.post("/tasks", json={"title": "Update March file", "assignee_id": "u2", "dataset_id": ds["id"], "due_date": "2026-04-01"}).json()
    t2 = client.post("/tasks", json={"title": "Check refunds", "priority": "high"}).json()
    assert client.post("/tasks", json={"title": "x", "assignee_id": "stranger"}).status_code == 422
    assert client.post("/tasks", json={"title": "x", "start_date": "2026-05-02", "due_date": "2026-05-01"}).status_code == 422
    assert [t["title"] for t in client.get("/tasks", params={"assignee": "u2"}).json()] == ["Update March file"]
    assert len(client.get("/tasks", params={"dataset_id": ds["id"]}).json()) == 1

    # drag both into "in_progress", in this order
    r = client.put("/tasks/order", json={"status": "in_progress", "task_ids": [t2["id"], t1["id"]]}).json()
    assert [(t["id"], t["status"], t["position"]) for t in r] == [(t2["id"], "in_progress", 0), (t1["id"], "in_progress", 1)]
    done = client.patch(f"/tasks/{t2['id']}", json={"status": "done"}).json()
    assert done["completed_at"] is not None
    assert client.patch(f"/tasks/{t2['id']}", json={"status": "todo"}).json()["completed_at"] is None
    kinds = [a["title"] for a in client.get("/workspace/activity").json() if a["kind"] == "task"]
    assert "Added a task" in kinds

    # the viewer can move their own task, nothing else
    as_user(client, "tok-2.c2lnbmF0dXJl")
    assert client.get("/tasks", params={"assignee": "me"}).json()[0]["id"] == t1["id"]
    assert client.patch(f"/tasks/{t1['id']}", json={"status": "review"}).status_code == 200
    assert client.patch(f"/tasks/{t1['id']}", json={"title": "renamed"}).status_code == 403
    assert client.patch(f"/tasks/{t2['id']}", json={"status": "done"}).status_code == 403
    assert client.post("/tasks", json={"title": "x"}).status_code == 403
    assert client.delete(f"/tasks/{t1['id']}").status_code == 403

    # removing a member unassigns their tasks
    as_user(client, U1)
    client.delete("/workspace/members/u2")
    assert client.get("/tasks", params={"assignee": "none"}).json()[0]["id"] == t1["id"]


def test_team_calendar_leaves(client, engine):
    sign_in(client, engine)
    today = date.today()
    client.put("/me/presence", json={"status": "on_leave", "leave": {
        "leave_type": "paid", "start_date": str(today), "end_date": str(today + timedelta(days=2)), "backup_name": "Priya"}})
    leaves = client.get("/workspace/leaves").json()
    assert [(lv["user_name"], lv["leave_type"], lv["backup_name"]) for lv in leaves] == [("Asha Rao", "paid", "Priya")]
