"""Invite addresses are checked with Reacher when REACHER_URL is set; only "invalid" blocks an invite."""

import pytest

from app import email, email_check
from app.config import get_settings
from tests.test_query import sign_in


@pytest.fixture
def reacher(monkeypatch):
    """Configure Reacher and capture calls; set .answer to what it should say (or an exception)."""
    s = get_settings()
    monkeypatch.setattr(s, "reacher_url", "http://reacher.test/")
    monkeypatch.setattr(s, "reacher_secret", "s3cret")
    monkeypatch.setattr(email, "send", lambda *a, **k: 1)

    class Fake:
        answer: object = {"is_reachable": "safe"}
        calls: list = []

        def __call__(self, url, payload, headers):
            self.calls.append((url, payload, headers))
            if isinstance(self.answer, Exception):
                raise self.answer
            return self.answer

    fake = Fake()
    fake.calls = []
    monkeypatch.setattr(email_check, "_post", fake)
    return fake


def invite(client, address="new@acme.co"):
    return client.post("/invitations", json={"role": "viewer", "emails": [address]})


def test_off_without_reacher_url(client, engine, monkeypatch):
    sign_in(client, engine)
    monkeypatch.setattr(get_settings(), "reacher_url", "")
    monkeypatch.setattr(email, "send", lambda *a, **k: 1)
    monkeypatch.setattr(email_check, "_post", lambda *a: pytest.fail("Reacher called while off"))
    assert email_check.check_email("x@y.co") == "skipped"
    assert invite(client).status_code == 201


def test_invalid_address_is_refused(client, engine, reacher):
    sign_in(client, engine)
    reacher.answer = {"is_reachable": "invalid"}
    r = invite(client, "nobody@acme.co")
    assert r.status_code == 201 and r.json()[0]["result"] == "invalid" and "can't receive email" in r.json()[0]["message"]
    assert client.get("/invitations").json() == []  # nothing created
    url, payload, headers = reacher.calls[0]
    assert url == "http://reacher.test/v0/check_email" and payload == {"to_email": "nobody@acme.co"} and headers == {"x-reacher-secret": "s3cret"}


@pytest.mark.parametrize("answer", [{"is_reachable": "safe"}, {"is_reachable": "risky"}, {"is_reachable": "unknown"}, {"weird": True}, TimeoutError("slow")])
def test_anything_else_still_invites(client, engine, reacher, answer):
    sign_in(client, engine)
    reacher.answer = answer
    r = invite(client)
    assert r.status_code == 201 and r.json()[0]["result"] == "invited"


def test_existing_members_skip_the_check(client, engine, reacher):
    sign_in(client, engine)
    r = invite(client, "u1@acme.co")  # already in the organization: no email, no lookup
    assert r.json()[0]["result"] == "already_member"
    assert reacher.calls == []
