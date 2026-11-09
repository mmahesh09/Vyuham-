import json
import urllib.error

from app import email
from app.config import get_settings


def test_render_escapes_user_text():
    out = email.render("Hi <b>", ['Name: <script>alert(1)</script>'], ("Open", 'https://x.test/a?b=1&c="2"'))
    assert "<script>" not in out and "&lt;script&gt;" in out
    assert "Hi &lt;b&gt;" in out
    assert 'href="https://x.test/a?b=1&amp;c=&quot;2&quot;"' in out


def test_log_only_without_key(monkeypatch, caplog):
    monkeypatch.setattr(get_settings(), "resend_api_key", "")
    called = []
    monkeypatch.setattr(email.urllib.request, "urlopen", lambda *a, **k: called.append(a))
    assert email.send(["a@x.co", "b@x.co"], "Subject", "<p>x</p>", "text body") == 2
    assert not called and "log-only" in caplog.text


class _Resp:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_sends_one_request_per_recipient(monkeypatch):
    monkeypatch.setattr(get_settings(), "resend_api_key", "re_test")
    monkeypatch.setattr(get_settings(), "email_from", "Vyuham <hi@vyuham.test>")
    sent = []

    def fake_urlopen(req, timeout):
        sent.append((req.full_url, req.headers["Authorization"], json.loads(req.data)))
        return _Resp()

    monkeypatch.setattr(email.urllib.request, "urlopen", fake_urlopen)
    assert email.send(["a@x.co", "b@x.co"], "Hello", "<p>h</p>", "h") == 2
    assert [p["to"] for _, _, p in sent] == [["a@x.co"], ["b@x.co"]]  # nobody sees the other address
    assert sent[0][0] == email.RESEND_URL and sent[0][1] == "Bearer re_test"
    assert sent[0][2]["from"] == "Vyuham <hi@vyuham.test>" and sent[0][2]["text"] == "h"


def test_failures_never_raise(monkeypatch):
    monkeypatch.setattr(get_settings(), "resend_api_key", "re_test")

    def boom(req, timeout):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(email.urllib.request, "urlopen", boom)
    assert email.send("a@x.co", "S", "<p/>", "t") == 0


def test_invite_email_sent(client, engine, monkeypatch):
    from tests.test_query import sign_in

    sign_in(client, engine)
    monkeypatch.setattr(get_settings(), "app_url", "https://app.vyuham.test")
    got = []
    monkeypatch.setattr(email, "send", lambda to, subject, html, text: got.append((to, subject, text)) or 1)
    token = client.post("/workspace/invites", json={"role": "viewer", "email": "new@acme.co"}).json()["token"]
    assert got[0][0] == "new@acme.co" and "Asha Rao invited you to Acme" in got[0][1]
    assert f"https://app.vyuham.test/invite/{token}" in got[0][2]


def test_production_requires_verified_email_for_outbound(client, engine, monkeypatch):
    from tests.test_query import sign_in, upload

    sign_in(client, engine)
    ds = upload(client)
    assert client.get("/me").json()["email_verified"] is False
    monkeypatch.setattr(get_settings(), "environment", "production")
    r = client.post("/workspace/invites", json={"role": "viewer"})
    assert r.status_code == 403 and "Confirm your email" in r.json()["detail"]
    alert = {"name": "a", "dataset_id": ds["id"], "metric": {"field": "Amount", "agg": "sum"}, "window_days": 0,
             "condition": "above", "threshold": 1}
    assert client.post("/alerts", json={**alert, "channels": {"emails": ["x@acme.co"]}}).status_code == 403
    assert client.post("/alerts", json={**alert, "channels": {"inapp": True}}).status_code == 201  # in-app only is fine
    from sqlalchemy import update

    from app.auth_tables import user_table

    with engine.begin() as c:
        c.execute(update(user_table).values(emailVerified=True))
    assert client.post("/workspace/invites", json={"role": "viewer"}).status_code == 201
