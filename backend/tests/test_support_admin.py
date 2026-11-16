"""Support administration: server-side authorization, audit log, metrics, and tenant restrictions."""

from types import SimpleNamespace

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth_tables import user_table
from app.support_ai.models import KnowledgeArticle, SupportAiSession, SupportAuditLog, SupportErrorGroup
from tests.conftest import add_user

ADMIN_ROUTES = [
    ("get", "/support/admin/me"),
    ("get", "/support/admin/overview"),
    ("get", "/support/admin/errors"),
    ("get", "/support/admin/ai-suggestions"),
    ("get", "/support/admin/feedback"),
    ("get", "/support/admin/tickets"),
    ("get", "/support/admin/audit"),
    ("get", "/support/knowledge"),
]


def user(client, engine, uid, verified=True):
    client.cookies.clear()
    client.cookies.set("better-auth.session_token", add_user(engine, uid=uid, token=f"tok-{uid}"))
    with engine.begin() as conn:
        conn.execute(update(user_table).where(user_table.c.id == uid).values(emailVerified=verified))
    return client.get("/me").json()["workspace"]["id"]


def as_user(client, uid):
    client.cookies.clear()
    client.cookies.set("better-auth.session_token", f"tok-{uid}.c2lnbmF0dXJl")


@pytest.fixture
def roles(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "support_admin_emails", "admin@acme.co")
    monkeypatch.setattr(get_settings(), "support_staff_emails", "agent@acme.co")


@pytest.fixture(autouse=True)
def _engine_on_client(client, engine):
    client.engine = engine


@pytest.fixture
def world(client, engine, roles):
    """Two customer workspaces with errors, plus an admin and a support agent."""
    ws_b = user(client, engine, "bob")
    ws_a = user(client, engine, "alice")
    sql_error = {"module": "sql_lab", "message": "Catalog Error: Table with name sales does not exist", "error_type": "QueryError", "app_version": "1.4.0"}
    for _ in range(3):
        client.post("/support/errors", json=sql_error)
    client.post("/support/errors", json={"module": "dashboard", "message": "Chart metric revenue not found", "app_version": "1.4.0", "details": {"api_key": "sk-live-abcdefghijklmnop1234"}})
    as_user(client, "bob")
    client.post("/support/errors", json={**sql_error, "app_version": "1.3.9"})
    user(client, engine, "admin")
    user(client, engine, "agent")
    return SimpleNamespace(ws_a=ws_a, ws_b=ws_b)


def groups(engine, **filters):
    with Session(engine) as db:
        return list(db.scalars(select(SupportErrorGroup).filter_by(**filters)))


# ── Authorization is enforced on the server ─────────────────────────────────────────────


def test_customers_and_unauthenticated_get_404_everywhere(world, client):
    as_user(client, "alice")
    for method, path in ADMIN_ROUTES:
        assert getattr(client, method)(path).status_code == 404, path
    gid = groups(client.engine, workspace_id=world.ws_a)[0].id
    assert client.post(f"/support/admin/errors/{gid}/resolve", json={"note": "fixed it myself"}).status_code == 404
    client.cookies.clear()
    for method, path in ADMIN_ROUTES:
        assert getattr(client, method)(path).status_code == 401, path


def test_unverified_email_gets_no_role(client, engine, roles):
    user(client, engine, "admin", verified=False)
    assert client.get("/support/admin/me").status_code == 404


def test_roles(world, client):
    as_user(client, "admin")
    assert client.get("/support/admin/me").json() == {"role": "admin", "email": "admin@acme.co"}
    as_user(client, "agent")
    assert client.get("/support/admin/me").json()["role"] == "staff"


def _article(client, scope, workspace_id=None):
    body = {"scope": scope, "title": "Fix missing tables", "symptoms": "Table does not exist", "root_cause": "Typo in table name", "resolution": "Use the table list"}
    if workspace_id:
        body["workspace_id"] = workspace_id
    res = client.post("/support/knowledge", json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


APPROVE = {"tested": True, "test_notes": "Reproduced on staging and verified the fix", "confirm_no_customer_data": True}


def test_global_knowledge_needs_an_admin_but_staff_handles_workspace_knowledge(world, client):
    as_user(client, "agent")
    global_id = _article(client, "global")  # staff may draft (it starts pending)
    tenant_id = _article(client, "tenant", world.ws_a)
    assert client.post(f"/support/knowledge/{global_id}/approve", json=APPROVE).status_code == 403
    assert client.post(f"/support/knowledge/{global_id}/reject", json={"note": "not good enough"}).status_code == 403
    assert client.patch(f"/support/knowledge/{global_id}", json={"title": "Edited by staff"}).status_code == 403
    assert client.post(f"/support/knowledge/{global_id}/archive").status_code == 403
    assert client.post(f"/support/knowledge/{tenant_id}/approve", json=APPROVE).json()["status"] == "approved"
    as_user(client, "admin")
    assert client.post(f"/support/knowledge/{global_id}/approve", json=APPROVE).json()["status"] == "approved"


# ── Audit log ───────────────────────────────────────────────────────────────────────────


def test_knowledge_changes_are_audited_with_actor_and_diff(world, client, engine):
    as_user(client, "admin")
    aid = _article(client, "global")
    client.patch(f"/support/knowledge/{aid}", json={"resolution": "Open SQL Lab's table list and copy the exact name"})
    client.post(f"/support/knowledge/{aid}/approve", json=APPROVE)
    client.post(f"/support/knowledge/{aid}/reject", json={"note": "Superseded by a better article"})
    entries = client.get("/support/admin/audit", params={"target_id": aid}).json()["entries"]
    assert [e["action"] for e in reversed(entries)] == ["article.create", "article.edit", "article.approve", "article.reject"]
    edit = next(e for e in entries if e["action"] == "article.edit")
    assert edit["actor"] == "admin@acme.co" and edit["role"] == "admin"
    assert edit["changes"]["resolution"] == ["Use the table list", "Open SQL Lab's table list and copy the exact name"]
    approve = next(e for e in entries if e["action"] == "article.approve")
    assert approve["changes"]["status"] == ["pending", "approved"] and approve["note"] == "confirmed no customer data"
    assert next(e for e in entries if e["action"] == "article.reject")["note"] == "Superseded by a better article"


def test_a_refused_action_leaves_no_audit_row(world, client, engine):
    as_user(client, "agent")
    gid = _article(client, "global")
    client.post(f"/support/knowledge/{gid}/approve", json=APPROVE)  # 403
    with Session(engine) as db:
        assert [r.action for r in db.scalars(select(SupportAuditLog).where(SupportAuditLog.target_id == gid))] == ["article.create"]


def test_audit_log_cannot_be_changed_through_the_api(world, client):
    from app.main import app

    audit_routes = [r for r in app.routes if getattr(r, "path", "").startswith("/support/admin/audit")]
    assert audit_routes and all(r.methods == {"GET"} for r in audit_routes)


# ── Errors: triage, regressions, ticket links ───────────────────────────────────────────


def test_resolve_reopen_and_regression(world, client, engine):
    as_user(client, "agent")
    g = groups(engine, workspace_id=world.ws_a, module="sql_lab")[0]
    res = client.post(f"/support/admin/errors/{g.id}/resolve", json={"note": "Fixed table lookup in 1.4.1"})
    assert res.json()["status"] == "resolved"
    assert client.get("/support/admin/errors", params={"status": "resolved"}).json()["total"] == 1
    as_user(client, "alice")  # it happens again
    client.post("/support/errors", json={"module": "sql_lab", "message": "Catalog Error: Table with name sales does not exist", "error_type": "QueryError"})
    reg = groups(engine, id=g.id)[0]
    assert reg.status == "open" and reg.regressed_at is not None
    as_user(client, "agent")
    actions = [e["action"] for e in client.get("/support/admin/audit", params={"target_id": g.id}).json()["entries"]]
    assert actions == ["error.resolve"]


def test_link_ticket_checks_the_conversation_belongs_to_the_same_workspace(world, client, engine, monkeypatch):
    from app import chatwoot
    from app.config import get_settings

    as_user(client, "agent")
    g = groups(engine, workspace_id=world.ws_a, module="sql_lab")[0]
    assert client.post(f"/support/admin/errors/{g.id}/ticket", json={"conversation_id": 5}).status_code == 409  # not configured
    s = get_settings()
    for k, v in {"chatwoot_base_url": "https://support.example.com", "chatwoot_account_id": 1, "chatwoot_inbox_id": 7, "chatwoot_website_token": "w", "chatwoot_api_token": "t"}.items():
        monkeypatch.setattr(s, k, v)
    convs = {
        5: {"id": 5, "inbox_id": 7, "meta": {"sender": {"identifier": f"vyuham:{world.ws_b}:bob"}}},
        6: {"id": 6, "inbox_id": 7, "meta": {"sender": {"identifier": f"vyuham:{world.ws_a}:alice"}}},
        7: {"id": 7, "inbox_id": 99, "meta": {"sender": {"identifier": f"vyuham:{world.ws_a}:alice"}}},
    }
    monkeypatch.setattr(chatwoot, "get_conversation", lambda cid: convs.get(cid))
    assert client.post(f"/support/admin/errors/{g.id}/ticket", json={"conversation_id": 5}).status_code == 422  # other tenant
    assert client.post(f"/support/admin/errors/{g.id}/ticket", json={"conversation_id": 7}).status_code == 422  # other inbox
    assert client.post(f"/support/admin/errors/{g.id}/ticket", json={"conversation_id": 404}).status_code == 422
    assert client.post(f"/support/admin/errors/{g.id}/ticket", json={"conversation_id": 6}).json()["chatwoot_conversation_id"] == 6
    assert client.delete(f"/support/admin/errors/{g.id}/ticket").json()["chatwoot_conversation_id"] is None
    actions = [e["action"] for e in client.get("/support/admin/audit", params={"target_id": g.id}).json()["entries"]]
    assert actions == ["error.unlink_ticket", "error.link_ticket"]


def test_error_detail_is_sanitized_and_tenant_scoped(world, client, engine):
    as_user(client, "admin")
    bob_private = _article(client, "tenant", world.ws_b)
    with Session(engine) as db:
        db.execute(update(KnowledgeArticle).where(KnowledgeArticle.id == bob_private).values(categories=["chart_config"]))
        db.commit()
    g = groups(engine, workspace_id=world.ws_a, module="dashboard")[0]
    detail = client.get(f"/support/admin/errors/{g.id}").json()
    assert detail["workspace"] == "Acme Co" and detail["events"][0]["details"] == {"api_key": "[redacted]"}
    assert detail["events"][0]["user"].startswith("u_") and "alice" not in str(detail)
    assert bob_private not in {a["id"] for a in detail["articles"]}  # another tenant's article isn't suggested


# ── Metrics ─────────────────────────────────────────────────────────────────────────────


def test_overview_numbers(world, client, engine):
    as_user(client, "agent")
    o = client.get("/support/admin/overview", params={"days": 7}).json()
    assert o["total_events"] == 5
    assert o["unique_fingerprints"] == 2  # the same SQL error in two workspaces counts once
    assert o["unresolved_errors"] == 3  # groups: alice sql, alice dashboard, bob sql
    assert {m["module"]: m["events"] for m in o["by_module"]} == {"sql_lab": 4, "dashboard": 1}
    assert {v["version"]: v["events"] for v in o["by_version"]} == {"1.4.0": 4, "1.3.9": 1}
    top = o["top_errors"][0]
    assert top["module"] == "sql_lab" and top["events"] == 4 and top["workspaces"] == 2
    assert sum(d["events"] for d in o["trend"]) == 5 and len(o["trend"]) == 8
    assert o["error_resolution_rate"] == 0 and o["open_tickets"] is None
    g = groups(engine, workspace_id=world.ws_a, module="dashboard")[0]
    client.post(f"/support/admin/errors/{g.id}/resolve", json={"note": "fixed"})
    assert client.get("/support/admin/overview", params={"days": 7}).json()["error_resolution_rate"] == round(1 / 3, 4)


def test_ai_suggestion_can_become_a_private_pending_draft(world, client, engine):
    with Session(engine) as db:
        s = SupportAiSession(thread_id="t" * 32, workspace_id=world.ws_a, user_id="alice", module="sql_lab", question="Why does my query fail?", status="answered",
                             answer={"summary": "Missing table", "likely_root_cause": "Typo", "steps": [{"text": "Check the name", "kind": "suggestion", "article_ids": []}], "grounded": False}, feedback="resolved")
        db.add(s)
        db.commit()
        sid = s.id
    as_user(client, "alice")
    assert client.post(f"/support/admin/sessions/{sid}/draft-article").status_code == 404
    as_user(client, "agent")
    listed = client.get("/support/admin/ai-suggestions", params={"feedback": "resolved"}).json()["sessions"]
    assert [x["id"] for x in listed] == [sid] and listed[0]["user"].startswith("u_")
    draft = client.post(f"/support/admin/sessions/{sid}/draft-article").json()
    assert draft["scope"] == "tenant" and draft["workspace_id"] == world.ws_a and draft["status"] == "pending"
    fb = client.get("/support/admin/feedback").json()
    assert fb["by_module"] == [{"module": "sql_lab", "resolved": 1, "unresolved": 0}]
