"""Tenant isolation and retrieval permissions for the AI support engine.

Two workspaces (Acme = u1, Beta = u2), with knowledge in every state. Claude is a fake that records
what it was sent and returns what each test tells it to, including attempts to cite things it must not.
"""

import json
from types import SimpleNamespace

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth_tables import user_table
from app.support_ai import embeddings, generation, jobs, search
from app.support_ai.models import KnowledgeArticle, KnowledgeEmbedding, SupportAiSession
from tests.conftest import add_user

SECRET_TEXT = "BETA-ONLY: rotate the warehouse credentials in the Beta billing system"


class FakeClaude:
    """Stands in for anthropic.Anthropic(). Records requests; replies with the configured answer."""

    def __init__(self):
        self.requests: list[dict] = []
        self.reply: dict | None = None
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        text = json.dumps(self.reply)
        return SimpleNamespace(
            stop_reason="end_turn",
            content=[SimpleNamespace(type="text", text=text)],
            usage=SimpleNamespace(input_tokens=100, output_tokens=50),
            model="claude-opus-5-5",
            _request_id="req_test",
        )

    def prompt(self, i=-1) -> str:
        return self.requests[i]["messages"][0]["content"]


@pytest.fixture
def ai(monkeypatch):
    from app.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "anthropic_api_key", "test-key-not-real")
    monkeypatch.setattr(s, "embedding_provider", "hash")
    monkeypatch.setattr(s, "support_staff_emails", "")
    monkeypatch.setattr(s, "support_admin_emails", "staff@acme.co")  # the reviewer in these tests is an administrator
    monkeypatch.setattr(s, "support_ai_min_similarity", 0.05)
    fake = FakeClaude()
    monkeypatch.setattr(generation, "_get_client", lambda: fake)
    return fake


def sign_in(client, engine, uid, verified=False):
    client.cookies.clear()
    client.cookies.set("better-auth.session_token", add_user(engine, uid=uid, token=f"tok-{uid}"))
    if verified:
        with engine.begin() as conn:
            conn.execute(update(user_table).where(user_table.c.id == uid).values(emailVerified=True))
    return client.get("/me").json()["workspace"]["id"]


def as_user(client, uid):
    client.cookies.clear()
    client.cookies.set("better-auth.session_token", f"tok-{uid}.c2lnbmF0dXJl")


def run_jobs(engine):
    with Session(engine) as db:
        return jobs.process_pending(db)


def make_article(engine, *, scope, workspace_id=None, status="approved", title="", text="", fingerprints=None):
    with Session(engine) as db:
        a = KnowledgeArticle(
            scope=scope, workspace_id=workspace_id, title=title, symptoms=text, root_cause=text, resolution=f"Resolution for {title}",
            modules=["sql_lab"], categories=[], fingerprints=fingerprints or [], status=status, tested=status == "approved", source="staff",
        )
        db.add(a)
        db.commit()
        if status == "approved":
            embeddings.embed_article(db, a.id)
        else:  # simulate a stale embedding left behind: retrieval must still exclude it
            db.add(KnowledgeEmbedding(article_id=a.id, model=embeddings.model_name(), content_hash="x", embedding=embeddings.embed([embeddings.article_text(a)])[0]))
            db.commit()
        return a.id


@pytest.fixture
def world(client, engine, ai):
    ws2 = sign_in(client, engine, "u2")
    ws1 = sign_in(client, engine, "u1")
    sign_in(client, engine, "staff", verified=True)
    text = "duckdb conversion error could not convert string to integer in sql lab query"
    ids = {
        "global": make_article(engine, scope="global", title="Fix integer conversion errors", text=text),
        "global_pending": make_article(engine, scope="global", status="pending", title="Unreviewed global tip", text=text),
        "own": make_article(engine, scope="tenant", workspace_id=ws1, title="Acme: cast the order_id column", text=text),
        "own_rejected": make_article(engine, scope="tenant", workspace_id=ws1, status="rejected", title="Acme rejected idea", text=text),
        "own_pending": make_article(engine, scope="tenant", workspace_id=ws1, status="pending", title="Acme pending idea", text=text),
        "other": make_article(engine, scope="tenant", workspace_id=ws2, title=SECRET_TEXT, text=text + " " + SECRET_TEXT),
    }
    as_user(client, "u1")
    return SimpleNamespace(ws1=ws1, ws2=ws2, ids=ids)


def good_reply(**overrides):
    reply = {
        "summary": "A text value is being converted to a number.",
        "likely_root_cause": "The column has text in it.",
        "confidence": "medium",
        "steps": [],
        "uncertainty": "",
        "needs_human": False,
        "cited_article_ids": [],
    }
    reply.update(overrides)
    return reply


def ask(client, question="Why does my SQL fail with a conversion error?", **body):
    res = client.post("/support/assistant/ask", json={"question": question, "module": "sql_lab", **body})
    assert res.status_code == 202, res.text
    return res.json()


# ── Retrieval permissions ───────────────────────────────────────────────────────────────


def test_visible_articles_are_global_approved_plus_own_approved(world, engine):
    with Session(engine) as db:
        ws1 = {a.id for a in db.scalars(search.visible_articles(world.ws1))}
        ws2 = {a.id for a in db.scalars(search.visible_articles(world.ws2))}
    assert ws1 == {world.ids["global"], world.ids["own"]}
    assert ws2 == {world.ids["global"], world.ids["other"]}


def test_search_never_returns_other_tenants_or_unapproved(world, engine):
    with Session(engine) as db:
        # A query that matches the other tenant's private article best.
        hits = search.search(db, world.ws1, SECRET_TEXT + " conversion error", limit=10)
    ids = {h.article.id for h in hits}
    assert world.ids["other"] not in ids
    assert not ids & {world.ids["global_pending"], world.ids["own_rejected"], world.ids["own_pending"]}
    assert ids <= {world.ids["global"], world.ids["own"]} and ids


def test_exact_fingerprint_match_respects_visibility(world, engine):
    with Session(engine) as db:
        other_fp = make_article(engine, scope="tenant", workspace_id=world.ws2, title="Beta fingerprinted", text="x", fingerprints=["f" * 64])
        hits = search.search(db, world.ws1, "anything", fingerprint="f" * 64, limit=10)
    assert other_fp not in {h.article.id for h in hits}


def test_search_requires_a_workspace(world, engine):
    with Session(engine) as db, pytest.raises(ValueError):
        search.search(db, "", "query")


def test_article_endpoint_hides_other_tenants_and_unapproved(world, client):
    assert client.get(f"/support/assistant/articles/{world.ids['global']}").status_code == 200
    assert client.get(f"/support/assistant/articles/{world.ids['own']}").status_code == 200
    for key in ("other", "global_pending", "own_pending", "own_rejected"):
        assert client.get(f"/support/assistant/articles/{world.ids[key]}").status_code == 404, key


# ── What reaches Claude, and what comes back ────────────────────────────────────────────


def test_prompt_contains_only_permitted_knowledge_and_no_secrets(world, client, ai):
    ai.reply = good_reply()
    ask(
        client,
        question="My query fails. My password=hunter2 and email me at jane@acme.co",
        error={"module": "sql_lab", "message": "Conversion Error: Could not convert string 'ACME-SECRET-VALUE' to INT32", "error_type": "QueryError", "http_status": 422},
        context={"sql": "SELECT * FROM orders WHERE customer = 'Jane Doe' AND total > 1000", "api_key": "sk-live-abcdefghijklmnop1234"},
    )
    assert run_jobs(client.engine) == 1
    prompt = ai.prompt()
    assert SECRET_TEXT not in prompt and world.ids["other"] not in prompt
    assert world.ids["global_pending"] not in prompt and world.ids["own_pending"] not in prompt
    for secret in ("hunter2", "jane@acme.co", "ACME-SECRET-VALUE", "Jane Doe", "1000", "sk-live-abcdefghijklmnop1234", "test-key-not-real"):
        assert secret not in json.dumps(ai.requests[-1]), secret
    assert world.ids["global"] in prompt or world.ids["own"] in prompt


@pytest.fixture(autouse=True)
def _expose_engine(client, engine):
    client.engine = engine


def test_invented_and_foreign_citations_are_removed_and_unbacked_fixes_downgraded(world, client, ai):
    ai.reply = good_reply(
        confidence="high",
        steps=[
            {"text": "Use the Beta procedure", "kind": "verified_fix", "article_ids": [world.ids["other"]]},
            {"text": "Made-up fix", "kind": "verified_fix", "article_ids": ["deadbeef" * 4]},
            {"text": "Cast the column", "kind": "verified_fix", "article_ids": [world.ids["global"]]},
            {"text": "Use the pending tip", "kind": "verified_fix", "article_ids": [world.ids["global_pending"]]},
        ],
        cited_article_ids=[world.ids["other"], world.ids["global"], "invented"],
    )
    session = ask(client)
    run_jobs(client.engine)
    out = client.get(f"/support/assistant/sessions/{session['id']}").json()
    steps = out["answer"]["steps"]
    assert [s["kind"] for s in steps] == ["suggestion", "suggestion", "verified_fix", "suggestion"]
    assert steps[0]["article_ids"] == [] and steps[1]["article_ids"] == [] and steps[3]["article_ids"] == []
    assert out["answer"]["cited_article_ids"] == [world.ids["global"]]
    assert world.ids["other"] not in json.dumps(out) and SECRET_TEXT not in json.dumps(out)
    assert {r["id"] for r in out["references"]} <= {world.ids["global"], world.ids["own"]}


def test_no_knowledge_caps_confidence_and_states_uncertainty(world, client, ai, engine):
    with Session(engine) as db:
        db.execute(update(KnowledgeArticle).values(status="archived"))
        db.commit()
    ai.reply = good_reply(confidence="high", uncertainty="")
    session = ask(client)
    run_jobs(client.engine)
    answer = client.get(f"/support/assistant/sessions/{session['id']}").json()["answer"]
    assert answer["confidence"] == "low" and answer["uncertainty"] and answer["grounded"] is False
    assert "No knowledge articles matched" in ai.prompt()


# ── Sessions, threads and feedback belong to one person ─────────────────────────────────


def test_other_users_cannot_read_continue_or_rate_a_session(world, client, ai):
    ai.reply = good_reply()
    session = ask(client)
    run_jobs(client.engine)
    as_user(client, "u2")
    sid, tid = session["id"], session["thread_id"]
    assert client.get(f"/support/assistant/sessions/{sid}").status_code == 404
    assert client.get(f"/support/assistant/threads/{tid}").status_code == 404
    assert client.post("/support/assistant/ask", json={"question": "continue", "thread_id": tid}).status_code == 404
    assert client.post(f"/support/assistant/sessions/{sid}/feedback", json={"resolved": True}).status_code == 404
    assert client.post(f"/support/assistant/sessions/{sid}/escalate", json={}).status_code == 404
    assert client.get("/support/assistant/threads").json() == {"threads": []}


def test_same_workspace_teammate_cannot_see_my_sessions(world, client, engine, ai):
    """u3 joins Acme (u1's workspace) and still can't read u1's assistant conversations."""
    from app.models import WorkspaceMember

    add_user(engine, uid="u3", token="tok-u3")
    with Session(engine) as db:
        db.add(WorkspaceMember(workspace_id=world.ws1, user_id="u3", role="editor"))
        db.commit()
    ai.reply = good_reply()
    session = ask(client)
    run_jobs(client.engine)
    as_user(client, "u3")
    assert client.get(f"/support/assistant/sessions/{session['id']}").status_code == 404


def test_feedback_creates_private_pending_candidate_never_global(world, client, engine, ai):
    with Session(engine) as db:
        db.execute(update(KnowledgeArticle).values(status="archived"))  # nothing to ground on -> ungrounded answer
        db.commit()
    ai.reply = good_reply(steps=[{"text": "Wrap the column in TRY_CAST", "kind": "suggestion", "article_ids": []}])
    session = ask(client)
    run_jobs(client.engine)
    res = client.post(f"/support/assistant/sessions/{session['id']}/feedback", json={"resolved": True, "comment": "worked, thanks jane@acme.co"})
    assert res.status_code == 200
    assert client.post(f"/support/assistant/sessions/{session['id']}/feedback", json={"resolved": False}).status_code == 409
    with Session(engine) as db:
        cand = db.scalar(select(KnowledgeArticle).where(KnowledgeArticle.source == "customer_feedback"))
        assert cand.scope == "tenant" and cand.workspace_id == world.ws1 and cand.status == "pending" and not cand.tested
        assert db.scalar(select(SupportAiSession.feedback_comment)) == "worked, thanks [email]"
        assert cand.id not in {a.id for a in db.scalars(search.visible_articles(world.ws1))}
        assert cand.id not in {a.id for a in db.scalars(search.visible_articles(world.ws2))}


def test_feedback_on_grounded_answer_counts_but_changes_no_status(world, client, engine, ai):
    ai.reply = good_reply(steps=[{"text": "Cast it", "kind": "verified_fix", "article_ids": [world.ids["global"]]}], cited_article_ids=[world.ids["global"]])
    session = ask(client)
    run_jobs(client.engine)
    client.post(f"/support/assistant/sessions/{session['id']}/feedback", json={"resolved": False})
    with Session(engine) as db:
        a = db.get(KnowledgeArticle, world.ids["global"])
        assert a.unhelpful_count == 1 and a.status == "approved"
        assert db.scalar(select(KnowledgeArticle).where(KnowledgeArticle.source == "customer_feedback")) is None


# ── Knowledge approval ──────────────────────────────────────────────────────────────────


def test_only_staff_can_review_knowledge(world, client):
    assert client.get("/support/knowledge").status_code == 404
    assert client.post(f"/support/knowledge/{world.ids['own_pending']}/approve", json={"tested": True, "test_notes": "tested it myself"}).status_code == 404
    as_user(client, "staff")
    assert client.get("/support/knowledge").status_code == 200


def test_unverified_staff_email_is_not_staff(world, client, engine, monkeypatch):
    from app.config import get_settings

    add_user(engine, uid="staff2", token="tok-staff2")  # email staff2@acme.co, not verified
    monkeypatch.setattr(get_settings(), "support_staff_emails", "staff2@acme.co")
    as_user(client, "staff2")
    assert client.get("/support/knowledge").status_code == 404


def test_approval_requires_testing_and_global_requires_confirmation(world, client, engine):
    as_user(client, "staff")
    pend = world.ids["global_pending"]
    assert client.post(f"/support/knowledge/{pend}/approve", json={"tested": False, "test_notes": "looked fine to me"}).status_code == 422
    assert client.post(f"/support/knowledge/{pend}/approve", json={"tested": True, "test_notes": "reproduced and fixed on staging"}).status_code == 422
    res = client.post(f"/support/knowledge/{pend}/approve", json={"tested": True, "test_notes": "reproduced and fixed on staging", "confirm_no_customer_data": True})
    assert res.status_code == 200 and res.json()["status"] == "approved"
    assert run_jobs(engine) == 1  # embedding happens in the background
    with Session(engine) as db:
        assert db.get(KnowledgeEmbedding, pend) is not None
        assert pend in {a.id for a in db.scalars(search.visible_articles(world.ws2))}


def test_customer_candidates_cannot_go_global_without_rewrite(world, client, engine):
    as_user(client, "staff")
    own = world.ids["own"]
    bad = client.post(f"/support/knowledge/{own}/promote", json={"title": "x" * 3, "symptoms": "", "root_cause": "y" * 3, "resolution": "z" * 3})
    assert bad.status_code == 422
    res = client.post(f"/support/knowledge/{own}/promote", json={"title": "Cast text columns", "symptoms": "Conversion errors", "root_cause": "Text in a number column", "resolution": "Use TRY_CAST"})
    assert res.status_code == 201
    new = res.json()
    assert new["scope"] == "global" and new["workspace_id"] is None and new["status"] == "pending" and new["source_ref"] == own
    with Session(engine) as db:  # pending: not retrievable by anyone yet
        assert new["id"] not in {a.id for a in db.scalars(search.visible_articles(world.ws2))}
        assert db.get(KnowledgeArticle, own).scope == "tenant"  # the original stays private


def test_editing_an_approved_article_pulls_it_from_retrieval(world, client, engine):
    as_user(client, "staff")
    res = client.patch(f"/support/knowledge/{world.ids['global']}", json={"resolution": "New steps"})
    assert res.json()["status"] == "pending"
    with Session(engine) as db:
        assert world.ids["global"] not in {a.id for a in db.scalars(search.visible_articles(world.ws1))}
        assert db.get(KnowledgeEmbedding, world.ids["global"]) is None


def test_database_refuses_inconsistent_scope_or_untested_approval(engine, world):
    from sqlalchemy.exc import IntegrityError

    for bad in (
        dict(scope="global", workspace_id=world.ws1, status="pending", tested=False),
        dict(scope="tenant", workspace_id=None, status="pending", tested=False),
        dict(scope="global", workspace_id=None, status="approved", tested=False),
    ):
        with Session(engine) as db, pytest.raises(IntegrityError):
            db.add(KnowledgeArticle(title="t", symptoms="s", root_cause="r", resolution="x", modules=[], categories=[], fingerprints=[], source="staff", **bad))
            db.commit()


# ── Context and escalation ──────────────────────────────────────────────────────────────


def test_context_for_another_workspaces_dashboard_is_empty(world, client, engine):
    from app.models import Dashboard

    with Session(engine) as db:
        d = Dashboard(workspace_id=world.ws2, name="Beta revenue board")
        db.add(d)
        db.commit()
        did = d.id
    body = client.get("/support/assistant/context", params={"module": "dashboard", "dashboard_id": did}).json()
    assert body == {"module": "dashboard"} and "Beta revenue" not in json.dumps(body)


def test_escalation_shares_diagnostics_only_with_consent(world, client, ai, monkeypatch):
    from app import chatwoot
    from app.config import get_settings

    s = get_settings()
    for k, v in {"chatwoot_base_url": "https://support.example.com", "chatwoot_account_id": 1, "chatwoot_inbox_id": 7, "chatwoot_website_token": "w", "chatwoot_api_token": "t"}.items():
        monkeypatch.setattr(s, k, v)
    notes = []
    monkeypatch.setattr(chatwoot, "ensure_contact", lambda identifier, *a: chatwoot.Contact(id=1, source_id="src") if identifier.endswith(":u1") else pytest.fail(identifier))
    monkeypatch.setattr(chatwoot, "create_conversation", lambda contact, note, labels: notes.append((note, labels)) or len(notes))
    ai.reply = good_reply()
    first = ask(client, error={"module": "sql_lab", "message": "Binder Error: column foo not found"}, context={"recent_errors": [{"path": "/sql/run", "status": 422}]})
    second = ask(client, error={"module": "sql_lab", "message": "Binder Error: column bar not found"}, context={"recent_errors": [{"path": "/sql/run"}]})
    run_jobs(client.engine)
    assert client.post(f"/support/assistant/sessions/{first['id']}/escalate", json={"include_diagnostics": False}).json() == {"conversation_id": 1}
    assert client.post(f"/support/assistant/sessions/{second['id']}/escalate", json={"include_diagnostics": True}).json() == {"conversation_id": 2}
    assert "not shared by the customer" in notes[0][0] and "recent_errors" not in notes[0][0]
    assert "recent_errors" in notes[1][0] and notes[1][1] == ["ai-escalation"]
