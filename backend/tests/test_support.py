"""Chatwoot support: identity from the session only, tenant isolation, and signed webhooks."""

import hashlib
import hmac
import json
import re
import time

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import chatwoot
from app.models import Notification
from app.routers import support
from tests.conftest import add_user

SECRET = "whsec-test"
HMAC_TOKEN = "inbox-hmac-test"


@pytest.fixture
def cw(monkeypatch):
    """Chatwoot configured, with its HTTP API replaced by an in-memory fake."""
    from app.config import get_settings

    s = get_settings()
    for k, v in {
        "chatwoot_base_url": "https://support.example.com",
        "chatwoot_account_id": 1,
        "chatwoot_inbox_id": 7,
        "chatwoot_website_token": "web-token",
        "chatwoot_hmac_token": HMAC_TOKEN,
        "chatwoot_api_token": "api-secret",
        "chatwoot_webhook_secret": SECRET,
        "chatwoot_help_center_url": "https://support.example.com/hc/vyuham",
    }.items():
        monkeypatch.setattr(s, k, v)
    fake = FakeChatwoot()
    monkeypatch.setattr(chatwoot, "_request", fake.request)
    support._report_times.clear()
    return fake


class FakeChatwoot:
    def __init__(self):
        self.contacts: dict[int, dict] = {}
        self.conversations: list[dict] = []
        self.calls: list[tuple[str, str]] = []

    def add_contact(self, identifier, inbox_id=7):
        cid = len(self.contacts) + 1
        self.contacts[cid] = {"id": cid, "identifier": identifier, "contact_inboxes": [{"source_id": f"src-{cid}", "inbox": {"id": inbox_id}}]}
        return cid

    def add_conversation(self, contact_id, inbox_id=7, messages=None, status="open"):
        conv = {
            "id": len(self.conversations) + 101, "contact_id": contact_id, "inbox_id": inbox_id, "status": status,
            "created_at": 1700000000, "last_activity_at": 1700000100, "unread_count": 1,
            "meta": {"sender": {"identifier": self.contacts[contact_id]["identifier"]}},
            "messages": messages or [{"content": "hello", "message_type": 0, "private": False}],
        }
        self.conversations.append(conv)
        return conv

    def request(self, method, path, body=None):
        self.calls.append((method, path))
        if (method, path) == ("POST", "/contacts/filter"):
            wanted = body["payload"][0]["values"][0]
            # Deliberately LIKE-style, like Chatwoot's search: the code must still pick the exact one.
            return {"payload": [c for c in self.contacts.values() if wanted in c["identifier"]]}
        if m := re.fullmatch(r"/contacts/(\d+)/conversations", path):
            return {"payload": [c for c in self.conversations if c["contact_id"] == int(m[1])]}
        if (method, path) == ("POST", "/contacts"):
            cid = self.add_contact(body["identifier"], body["inbox_id"])
            self.contacts[cid].update({k: body.get(k) for k in ("name", "email", "custom_attributes")})
            return {"payload": {"contact": self.contacts[cid]}}
        if (method, path) == ("POST", "/conversations"):
            conv = self.add_conversation(body["contact_id"], body["inbox_id"], [{"content": body["message"]["content"], "message_type": 0}])
            return {"id": conv["id"]}
        if method == "POST" and re.fullmatch(r"/conversations/\d+/labels", path):
            return {"payload": body["labels"]}
        raise AssertionError(f"unexpected call {method} {path}")


def signed_in(client, engine, uid):
    client.cookies.clear()
    client.cookies.set("better-auth.session_token", add_user(engine, uid=uid, token=f"tok-{uid}"))
    return client.get("/me").json()["workspace"]["id"]


def sign(body: bytes, ts: int | None = None, secret: str = SECRET):
    ts = ts if ts is not None else int(time.time())
    return {"X-Chatwoot-Timestamp": str(ts), "X-Chatwoot-Signature": "sha256=" + hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()}


# ── Config and identity ─────────────────────────────────────────────────────────────────


def test_disabled_without_configuration(client, engine):
    signed_in(client, engine, "u1")
    assert client.get("/support/config").json()["enabled"] is False
    assert client.get("/support/identity").status_code == 404
    assert client.get("/support/conversations").status_code == 404


def test_config_exposes_no_secrets(client, engine, cw):
    signed_in(client, engine, "u1")
    res = client.get("/support/config")
    assert res.json()["enabled"] is True and res.json()["website_token"] == "web-token"
    for secret in ("api-secret", SECRET, HMAC_TOKEN):
        assert secret not in res.text


def test_support_requires_sign_in(client, cw):
    for path in ("/support/config", "/support/identity", "/support/conversations"):
        assert client.get(path).status_code == 401
    assert client.post("/support/report", json={"description": "Something broke here"}).status_code == 401


def test_identity_is_signed_and_comes_from_session(client, engine, cw):
    ws = signed_in(client, engine, "u1")
    # Query parameters naming someone else are ignored: identity only comes from the cookie.
    body = client.get("/support/identity", params={"identifier": "vyuham:other:u2", "user_id": "u2"}).json()
    assert body["identifier"] == f"vyuham:{ws}:u1"
    assert body["identifier_hash"] == hmac.new(HMAC_TOKEN.encode(), body["identifier"].encode(), hashlib.sha256).hexdigest()
    assert body["email"] == "u1@acme.co" and body["name"] == "Asha Rao"
    assert set(body) == {"identifier", "identifier_hash", "name", "email", "workspace_id"}


def test_email_can_be_withheld(client, engine, cw, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "chatwoot_share_email", False)
    signed_in(client, engine, "u1")
    assert client.get("/support/identity").json()["email"] is None


# ── Conversations: isolation ────────────────────────────────────────────────────────────


def test_lists_only_own_conversations(client, engine, cw):
    ws2 = signed_in(client, engine, "u2")
    ws1 = signed_in(client, engine, "u1")
    mine = cw.add_contact(f"vyuham:{ws1}:u1")
    # Someone whose identifier *contains* mine (would match a LIKE search) and another customer.
    trap = cw.add_contact(f"vyuham:{ws1}:u1x")
    other = cw.add_contact(f"vyuham:{ws2}:u2")
    cw.add_conversation(trap, messages=[{"content": "not yours", "message_type": 0}])
    cw.add_conversation(other, messages=[{"content": "also not yours", "message_type": 0}])
    cw.add_conversation(mine, messages=[{"content": "my question", "message_type": 0}, {"content": "agent-only note", "message_type": 1, "private": True}])
    cw.add_conversation(mine, inbox_id=99)  # another inbox on the same Chatwoot account

    res = client.get("/support/conversations")
    assert res.status_code == 200
    convs = res.json()["conversations"]
    assert len(convs) == 1
    assert convs[0]["last_message"] == {"from": "you", "text": "my question"}  # private note skipped
    assert "not yours" not in res.text and "agent-only note" not in res.text


def test_no_contact_means_no_conversations(client, engine, cw):
    signed_in(client, engine, "u1")
    assert client.get("/support/conversations").json() == {"conversations": []}


def test_chatwoot_outage_is_a_clean_502(client, engine, cw, monkeypatch):
    signed_in(client, engine, "u1")

    def down(*_a, **_k):
        raise chatwoot.ChatwootError("Couldn't reach Chatwoot")

    monkeypatch.setattr(chatwoot, "_request", down)
    res = client.get("/support/conversations")
    assert res.status_code == 502 and "api-secret" not in res.text


# ── Report a problem ────────────────────────────────────────────────────────────────────


def test_report_creates_labelled_conversation_with_safe_context(client, engine, cw):
    ws = signed_in(client, engine, "u1")
    res = client.post(
        "/support/report",
        json={"description": "The chart on my dashboard is blank", "page": "/s/SECRETTOKEN?token=abc#x", "release": "abc123", "error_id": "0123456789abcdef0123456789abcdef"},
        headers={"user-agent": "TestBrowser/1.0"},
    )
    assert res.status_code == 201
    contact = next(c for c in cw.contacts.values() if c["identifier"] == f"vyuham:{ws}:u1")
    assert contact["custom_attributes"] == {"workspace_id": ws}
    content = cw.conversations[-1]["messages"][0]["content"]
    assert "Page: /s/[token]" in content and "SECRETTOKEN" not in content and "token=abc" not in content
    assert "App version: abc123" in content and "Browser: TestBrowser/1.0" in content
    assert ("POST", f"/conversations/{res.json()['conversation_id']}/labels") in cw.calls


def test_report_reuses_existing_contact(client, engine, cw):
    ws = signed_in(client, engine, "u1")
    cid = cw.add_contact(f"vyuham:{ws}:u1")
    client.post("/support/report", json={"description": "Uploads fail every time"})
    assert len(cw.contacts) == 1 and cw.conversations[-1]["contact_id"] == cid


def test_report_is_rate_limited(client, engine, cw):
    signed_in(client, engine, "u1")
    codes = [client.post("/support/report", json={"description": f"Problem number {i}"}).status_code for i in range(6)]
    assert codes == [201] * 5 + [429]


def test_report_validates_description(client, engine, cw):
    signed_in(client, engine, "u1")
    assert client.post("/support/report", json={"description": "short"}).status_code == 422


# ── Webhook ─────────────────────────────────────────────────────────────────────────────


def agent_reply(identifier, inbox_id=7, account_id=1, private=False, message_type="outgoing", content="We fixed it"):
    return {
        "event": "message_created", "content": content, "message_type": message_type, "private": private,
        "sender": {"type": "user"}, "account": {"id": account_id}, "inbox": {"id": inbox_id},
        "conversation": {"id": 101, "inbox_id": inbox_id, "meta": {"sender": {"identifier": identifier}}},
    }


def post_webhook(client, payload, headers=None, delivery=None):
    body = json.dumps(payload).encode()
    h = {"Content-Type": "application/json", **(headers if headers is not None else sign(body))}
    if delivery:
        h["X-Chatwoot-Delivery"] = delivery
    return client.post("/support/chatwoot/webhook", content=body, headers=h)


def notifications(engine, uid):
    with Session(engine) as db:
        return list(db.scalars(select(Notification).where(Notification.user_id == uid)))


def test_webhook_rejects_bad_signatures(client, engine, cw):
    ws = signed_in(client, engine, "u1")
    payload = agent_reply(f"vyuham:{ws}:u1")
    body = json.dumps(payload).encode()
    assert post_webhook(client, payload, headers={}).status_code == 401
    assert post_webhook(client, payload, headers=sign(body, secret="wrong")).status_code == 401
    assert post_webhook(client, payload, headers=sign(body, ts=int(time.time()) - 600)).status_code == 401  # replay
    tampered = sign(body)
    assert client.post("/support/chatwoot/webhook", content=body + b" ", headers=tampered).status_code == 401
    assert notifications(engine, "u1") == []


def test_webhook_disabled_without_secret(client, engine, cw, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "chatwoot_webhook_secret", "")
    assert post_webhook(client, agent_reply("x"), headers={}).status_code == 404


def test_agent_reply_notifies_the_right_customer_once(client, engine, cw):
    ws = signed_in(client, engine, "u1")
    signed_in(client, engine, "u2")
    payload = agent_reply(f"vyuham:{ws}:u1")
    assert post_webhook(client, payload, delivery="d-1").json() == {"status": "notified"}
    assert post_webhook(client, payload, delivery="d-1").json() == {"status": "duplicate"}
    got = notifications(engine, "u1")
    assert len(got) == 1 and got[0].kind == "support" and got[0].link == "/support" and got[0].workspace_id == ws
    assert notifications(engine, "u2") == []


def test_webhook_ignores_what_it_should(client, engine, cw):
    ws1 = signed_in(client, engine, "u1")
    ws2 = signed_in(client, engine, "u2")
    cases = [
        agent_reply(f"vyuham:{ws1}:u1", private=True),  # agent's private note
        agent_reply(f"vyuham:{ws1}:u1", message_type="incoming"),  # the customer's own message
        agent_reply(f"vyuham:{ws1}:u1", inbox_id=99),  # another inbox
        agent_reply(f"vyuham:{ws1}:u1", account_id=2),  # another Chatwoot account
        agent_reply(f"vyuham:{ws2}:u1"),  # u1 is not a member of u2's workspace: no cross-tenant notice
        agent_reply("someone@example.com"),  # not one of our identifiers
        {"event": "conversation_created", "account_id": 1, "inbox_id": 7},
    ]
    for i, payload in enumerate(cases):
        assert post_webhook(client, payload, delivery=f"i-{i}").json() == {"status": "ignored"}, payload
    assert notifications(engine, "u1") == [] and notifications(engine, "u2") == []


def test_resolution_notifies(client, engine, cw):
    ws = signed_in(client, engine, "u1")
    payload = {"event": "conversation_status_changed", "status": "resolved", "account_id": 1, "inbox_id": 7, "meta": {"sender": {"identifier": f"vyuham:{ws}:u1"}}}
    assert post_webhook(client, payload).json() == {"status": "notified"}
    assert notifications(engine, "u1")[0].title == "Your support conversation was resolved"


def test_parse_identifier_is_strict():
    assert chatwoot.parse_identifier("vyuham:w1:u1") == ("w1", "u1")
    for bad in ("vyuham:w1", "vyuham:w1:u1:x", "other:w1:u1", "vyuham::u1", None, 5):
        assert chatwoot.parse_identifier(bad) is None


def test_find_contact_requires_exact_identifier(cw):
    cw.add_contact("vyuham:w1:u10")  # returned first by a LIKE-style match for "vyuham:w1:u1"
    exact = cw.add_contact("vyuham:w1:u1")
    assert chatwoot.find_contact("vyuham:w1:u1").id == exact
    assert chatwoot.find_contact("vyuham:w1:u") is None
