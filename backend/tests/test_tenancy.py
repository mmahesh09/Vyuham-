"""Organizations and workspaces: switching, forged workspace ids, RBAC, private assets, role-aware caching."""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import OrganizationMember, Workspace
from tests.conftest import accept, add_user, invite
from tests.test_query import sign_in, upload

U1 = "tok-1.c2lnbmF0dXJl"
U2 = "tok-2.c2lnbmF0dXJl"


def as_user(client, cookie):
    client.cookies.clear()
    client.cookies.set("better-auth.session_token", cookie)


def teammate(client, engine, role, uid="u2", token="tok-2"):
    """u2 joins u1's organization with `role`; the client ends signed in as u2."""
    as_user(client, U1)
    t = invite(client, f"{uid}@acme.co", role)
    as_user(client, add_user(engine, uid=uid, token=token, name="Ravi Kumar", company=None, onboarded=False))
    assert accept(client, t).status_code == 200
    return f"{token}.c2lnbmF0dXJl"


# ---------- choosing a workspace ----------


def test_forged_workspace_header_is_refused(client, engine):
    a_ws = sign_in(client, engine)
    upload(client)
    sign_in(client, engine, uid="u2", token="tok-2", company="Bravo")
    for path in ("/datasets", "/dashboards", "/sql/saved", "/tasks", "/invitations", "/activity", "/organizations/current"):
        r = client.get(path, headers={"X-Workspace-Id": a_ws})
        assert r.status_code == 403, path
    assert client.get("/datasets", headers={"X-Workspace-Id": "not-an-id"}).status_code == 403
    assert client.put("/me/workspace", json={"workspace_id": a_ws}).status_code == 403
    assert client.get(f"/workspaces/{a_ws}").status_code == 404
    assert client.get("/datasets").json() == []  # still in their own workspace


def test_switching_workspaces_changes_everything_workspace_scoped(client, engine):
    first = sign_in(client, engine)
    upload(client)
    second = client.post("/workspaces", json={"name": "Finance"}).json()
    assert second["my_role"] == "owner"
    switched = client.put("/me/workspace", json={"workspace_id": second["id"]}).json()
    assert switched["current_workspace_id"] == second["id"]
    assert client.get("/me").json()["workspace"]["name"] == "Finance"
    assert client.get("/datasets").json() == []
    upload(client, name="ledger.csv")
    assert [d["name"] for d in client.get("/datasets").json()] == ["ledger"]
    assert len(client.get("/datasets", headers={"X-Workspace-Id": first}).json()) == 1  # per-request override
    assert {w["name"] for w in client.get("/workspaces").json()["workspaces"]} == {"Acme", "Finance"}


def test_analysts_only_see_workspaces_they_were_added_to(client, engine):
    sign_in(client, engine)
    finance = client.post("/workspaces", json={"name": "Finance"}).json()
    cookie = teammate(client, engine, "analyst")
    assert [w["name"] for w in client.get("/workspaces").json()["workspaces"]] == ["Acme"]
    assert client.put("/me/workspace", json={"workspace_id": finance["id"]}).status_code == 403
    as_user(client, U1)
    assert client.put(f"/workspaces/{finance['id']}/members/u2", json={"role": "viewer"}).status_code == 200
    as_user(client, cookie)
    assert client.put("/me/workspace", json={"workspace_id": finance["id"]}).json()["current_workspace_id"] == finance["id"]
    assert client.get("/me").json()["role"] == "viewer"  # their role in Finance
    as_user(client, U1)
    assert client.delete(f"/workspaces/{finance['id']}/members/u2").status_code == 204
    as_user(client, cookie)
    assert client.get("/me").json()["workspace"]["name"] == "Acme"  # back to one they can open


def test_admins_get_every_workspace_including_new_ones(client, engine):
    sign_in(client, engine)
    cookie = teammate(client, engine, "admin")
    as_user(client, U1)
    ops = client.post("/workspaces", json={"name": "Operations"}).json()
    as_user(client, cookie)
    assert client.put("/me/workspace", json={"workspace_id": ops["id"]}).status_code == 200
    assert client.get("/me").json()["role"] == "admin"


def test_workspace_rows_never_raise_access_above_the_org_role(client, engine):
    sign_in(client, engine)
    teammate(client, engine, "viewer")
    from sqlalchemy import update

    from app.models import WorkspaceMember

    with engine.begin() as c:  # a stale or tampered row
        c.execute(update(WorkspaceMember).where(WorkspaceMember.user_id == "u2").values(role="admin"))
    assert client.get("/me").json()["role"] == "viewer"
    assert client.post("/dashboards", json={"name": "x"}).status_code == 403


def test_removed_members_lose_access_immediately(client, engine):
    ws = sign_in(client, engine)
    cookie = teammate(client, engine, "analyst")
    assert client.get("/datasets").status_code == 200
    as_user(client, U1)
    assert client.delete("/organizations/current/members/u2").status_code == 204
    as_user(client, cookie)
    assert client.get("/datasets", headers={"X-Workspace-Id": ws}).status_code == 403
    assert client.get("/me").json()["needs_onboarding"] is True


# ---------- roles ----------

WRITES = [
    ("POST", "/dashboards", {"name": "x"}),
    ("POST", "/sql/saved", {"name": "q", "sql": "SELECT 1"}),
    ("POST", "/tasks", {"title": "t"}),
]


@pytest.mark.parametrize("role,can_write,can_invite,can_billing,can_activity", [
    ("viewer", False, False, False, False),
    ("analyst", True, False, False, False),
    ("admin", True, True, True, True),
])
def test_role_matrix(client, engine, role, can_write, can_invite, can_billing, can_activity):
    sign_in(client, engine)
    teammate(client, engine, role)
    for method, path, body in WRITES:
        r = client.request(method, path, json=body)
        assert (r.status_code < 400) == can_write, (role, path, r.status_code)
    r = client.post("/datasets", files={"file": ("s.csv", b"a,b\n1,2\n", "text/csv")})
    assert (r.status_code == 201) == can_write
    r = client.post("/invitations", json={"emails": ["z@acme.co"], "role": "viewer"})
    assert (r.status_code == 201) == can_invite
    assert (client.get("/organizations/current/billing").status_code == 200) == can_billing
    assert (client.get("/activity").status_code == 200) == can_activity
    assert (client.get("/organizations/current/members").status_code == 200) == can_invite
    # Nobody but the owner deletes the organization or moves ownership.
    assert client.request("DELETE", "/organizations/current", json={"confirm": "Acme"}).status_code == 403
    assert client.post("/organizations/current/transfer", json={"user_id": "u1"}).status_code in (403, 404)
    me = client.get("/me").json()
    assert ("content.write" in me["permissions"]) == can_write


def test_admins_cannot_touch_the_owner(client, engine):
    sign_in(client, engine)
    teammate(client, engine, "admin")
    assert client.patch("/organizations/current/members/u1", json={"role": "viewer"}).status_code == 403
    assert client.delete("/organizations/current/members/u1").status_code == 403
    assert client.patch("/organizations/current/members/u2", json={"role": "viewer"}).status_code == 409  # not yourself


def test_analysts_connect_sources_only_when_the_workspace_allows(client, engine):
    ws = sign_in(client, engine)
    teammate(client, engine, "analyst")
    body = {"kind": "postgres", "host": "db.example.com", "port": 5432, "database": "d", "username": "u", "password": "p"}
    assert client.post("/connections/test", json=body).status_code == 403
    assert "sources.manage" not in client.get("/me").json()["permissions"]
    as_user(client, U1)
    r = client.patch(f"/workspaces/{ws}", json={"preferences": {"analysts_can_connect_sources": True}})
    assert r.status_code == 200
    as_user(client, U2)
    assert "sources.manage" in client.get("/me").json()["permissions"]
    assert client.post("/connections/test", json=body).status_code != 403


def test_transfer_ownership(client, engine):
    sign_in(client, engine)
    teammate(client, engine, "analyst")
    as_user(client, U1)
    assert client.post("/organizations/current/transfer", json={"user_id": "u2"}).status_code == 409  # admins only
    client.patch("/organizations/current/members/u2", json={"role": "admin"})
    r = client.post("/organizations/current/transfer", json={"user_id": "u2"})
    assert r.status_code == 200 and r.json()["owner"]["id"] == "u2" and r.json()["my_role"] == "admin"
    with Session(engine) as s:
        roles = dict(s.execute(select(OrganizationMember.user_id, OrganizationMember.role)).all())
    assert roles == {"u1": "admin", "u2": "owner"}
    assert client.request("DELETE", "/organizations/current", json={"confirm": "Acme"}).status_code == 403


def test_owner_deletes_the_organization_softly(client, engine):
    ws = sign_in(client, engine)
    ds = upload(client)
    assert client.request("DELETE", "/organizations/current", json={"confirm": "acme"}).status_code == 422
    assert client.request("DELETE", "/organizations/current", json={"confirm": "Acme"}).status_code == 204
    assert client.get("/me").json()["needs_onboarding"] is True
    assert client.get(f"/datasets/{ds['id']}", headers={"X-Workspace-Id": ws}).status_code == 403
    with Session(engine) as s:
        assert s.get(Workspace, ws).deleted_at is not None  # soft: data kept for restore


def test_workspace_lifecycle(client, engine):
    first = sign_in(client, engine)
    assert client.post("/workspaces", json={"name": "acme"}).status_code == 409  # names are unique per org
    sales = client.post("/workspaces", json={"name": "Sales", "description": "Pipeline"}).json()
    r = client.patch(f"/workspaces/{sales['id']}", json={"name": "Sales team", "is_default": True, "logo_url": "https://cdn.example.com/l.png"})
    assert r.status_code == 200 and r.json()["is_default"] is True
    assert client.get(f"/workspaces/{first}").json()["is_default"] is False
    assert client.patch(f"/workspaces/{sales['id']}", json={"logo_url": "javascript:alert(1)"}).status_code == 422
    assert client.request("DELETE", f"/workspaces/{sales['id']}", json={"confirm": "Sales team"}).status_code == 204
    assert client.request("DELETE", f"/workspaces/{first}", json={"confirm": "Acme"}).status_code == 409  # the last one


# ---------- shared and private assets ----------


def test_private_assets_are_hidden_from_teammates_but_not_admins(client, engine):
    sign_in(client, engine)
    analyst = teammate(client, engine, "analyst")
    shared = client.post("/dashboards", json={"name": "Team board"}).json()
    private = client.post("/dashboards", json={"name": "Scratch", "visibility": "private"}).json()
    q = client.post("/sql/saved", json={"name": "Mine", "sql": "SELECT 1", "visibility": "private"}).json()
    assert shared["created_by"] == "u2" and private["visibility"] == "private"

    teammate(client, engine, "analyst", uid="u3", token="tok-3")
    names = [d["name"] for d in client.get("/dashboards").json()]
    assert names == ["Team board"]
    assert client.get(f"/dashboards/{private['id']}").status_code == 404
    assert client.put(f"/sql/saved/{q['id']}", json={"name": "x", "sql": "SELECT 1"}).status_code == 404
    assert q["id"] not in {x["id"] for x in client.get("/sql/saved").json()}
    assert client.patch(f"/dashboards/{private['id']}", json={"name": "x"}).status_code == 404
    # shared work: another analyst edits it, and it says who did
    r = client.patch(f"/dashboards/{shared['id']}", json={"name": "Team board v2"})
    assert r.status_code == 200 and r.json()["updated_by"] == "u3" and r.json()["created_by"] == "u2"
    assert client.patch(f"/dashboards/{shared['id']}", json={"visibility": "private"}).status_code == 403  # not theirs

    as_user(client, U1)  # the owner oversees everything
    assert {d["name"] for d in client.get("/dashboards").json()} == {"Team board v2", "Scratch"}
    as_user(client, analyst)
    assert client.patch(f"/dashboards/{private['id']}", json={"visibility": "workspace"}).status_code == 200


def test_dashboards_outlive_their_creator(client, engine):
    sign_in(client, engine)
    cookie = teammate(client, engine, "analyst")
    d = client.post("/dashboards", json={"name": "Shared"}).json()
    as_user(client, cookie)
    assert client.request("DELETE", "/account", json={"confirm": "u2@acme.co"}).status_code == 204
    as_user(client, U1)
    assert client.get(f"/dashboards/{d['id']}").json()["created_by"] is None


# ---------- caching respects roles ----------


def test_cached_chart_results_are_not_shared_across_masking(client, engine):
    """An owner's cached result must not be served to a viewer whose view masks the column."""
    from app import cache

    cache.clear()
    sign_in(client, engine)
    ds = upload(client, b"customer,amount\nTop Secret Ltd,10\nOther,5\n", "c.csv")
    r = client.put("/governance/access", json={"dataset_id": ds["id"], "column": "customer", "role": "viewer", "access": "masked"})
    assert r.status_code == 200, r.text
    spec = {"dataset": ds["id"], "title": "t", "chartType": "bar", "groupBy": "customer", "metrics": [{"field": "amount", "agg": "sum"}]}
    d = client.post("/dashboards", json={"name": "D"}).json()
    assert client.post(f"/dashboards/{d['id']}/charts", json={"spec": spec}).status_code == 201
    owner_view = client.get(f"/dashboards/{d['id']}/view")  # warms the cache as the owner
    assert "Top Secret Ltd" in owner_view.text
    teammate(client, engine, "viewer")
    viewer_view = client.get(f"/dashboards/{d['id']}/view")
    assert viewer_view.status_code == 200
    assert "Top Secret Ltd" not in viewer_view.text
