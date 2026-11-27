"""The public pilot request form and the staff list that works it."""

import pytest
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import PilotRequest
from tests.conftest import add_user

FORM = {
    "name": "Asha Rao", "email": "Asha@Example.com", "company": "Acme Analytics", "database": "postgres",
    "team_size": "11-50", "need": "Give the sales team revenue numbers without exposing customer emails.",
}


@pytest.fixture(autouse=True)
def staff(monkeypatch):
    monkeypatch.setattr(get_settings(), "support_staff_emails", "staff@acme.co")


def login(client, engine, uid):
    add_user(engine, uid=uid, token=f"tok-{uid}")
    client.cookies.set("better-auth.session_token", f"tok-{uid}.sig")


def test_anyone_can_apply_without_signing_in(client, engine, caplog):
    r = client.post("/pilot-requests", json=FORM)
    assert r.status_code == 201 and r.json() == {"ok": True}
    with Session(engine) as db:
        rows = db.query(PilotRequest).all()
    assert len(rows) == 1 and rows[0].email == "asha@example.com" and rows[0].status == "new"
    assert any("Pilot request: Acme Analytics" in m for m in caplog.messages)  # staff notified (log-only email)


def test_bad_input_is_refused(client):
    assert client.post("/pilot-requests", json={**FORM, "email": "not-an-email"}).status_code == 422
    assert client.post("/pilot-requests", json={**FORM, "database": "oracle"}).status_code == 422
    assert client.post("/pilot-requests", json={**FORM, "need": "short"}).status_code == 422


def test_honeypot_stores_nothing(client, engine):
    r = client.post("/pilot-requests", json={**FORM, "website": "http://spam.example"})
    assert r.status_code == 201
    with Session(engine) as db:
        assert db.query(PilotRequest).count() == 0


def test_rate_limited_per_address(client):
    codes = [client.post("/pilot-requests", json=FORM).status_code for _ in range(6)]
    assert codes[:5] == [201] * 5 and codes[5] == 429


def test_only_staff_see_and_update_requests(client, engine):
    client.post("/pilot-requests", json=FORM)
    login(client, engine, "u1")
    assert client.get("/support/admin/pilots").status_code == 404  # staff routes don't advertise themselves
    login(client, engine, "staff")
    rows = client.get("/support/admin/pilots").json()
    assert len(rows) == 1 and rows[0]["company"] == "Acme Analytics"
    r = client.patch(f"/support/admin/pilots/{rows[0]['id']}", json={"status": "contacted", "note": "Call booked"})
    assert r.status_code == 200 and r.json()["status"] == "contacted" and r.json()["note"] == "Call booked"
    assert client.get("/support/admin/pilots?status_filter=new").json() == []
    assert client.delete(f"/support/admin/pilots/{rows[0]['id']}").status_code == 204
