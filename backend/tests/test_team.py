from datetime import date, timedelta

from tests.conftest import accept, add_user, invite
from tests.test_query import sign_in, upload

U1 = "tok-1.c2lnbmF0dXJl"


def as_user(client, cookie):
    client.cookies.set("better-auth.session_token", cookie)


def new_user(engine, uid, token, name="Ravi"):
    return add_user(engine, uid=uid, token=token, name=name, company=f"{name} Co")


def test_roles_and_owner_guards(client, engine):
    sign_in(client, engine)
    token = invite(client, "u2@acme.co", "viewer")
    as_user(client, new_user(engine, "u2", "tok-2"))
    assert accept(client, token).status_code == 200
    assert client.post("/invitations", json={"emails": ["x@acme.co"], "role": "analyst"}).status_code == 403  # viewers can't invite
    as_user(client, U1)
    assert client.patch("/workspace/members/u1", json={"role": "analyst"}).status_code == 409  # not your own role
    assert client.delete("/workspace/members/u1").status_code == 409
    assert client.patch("/workspace/members/u2", json={"role": "analyst"}).json()["role"] == "analyst"
    assert client.delete("/workspace/members/u2").status_code == 204
    assert [m["id"] for m in client.get("/workspace/members").json()] == ["u1"]


def test_tasks_crud_order_and_permissions(client, engine):
    sign_in(client, engine)
    ds = upload(client)
    token = invite(client, "u2@acme.co", "viewer")
    as_user(client, new_user(engine, "u2", "tok-2"))
    assert accept(client, token).status_code == 200
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
