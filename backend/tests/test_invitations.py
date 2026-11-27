"""Invitations: hashed tokens, email-bound acceptance, expiry, revoke, resend, no role escalation."""

import hashlib
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import email
from app.config import get_settings
from app.models import AuditLog, Invitation, OrganizationMember
from tests.conftest import accept, add_user, invite
from tests.test_query import sign_in, upload

U1 = "tok-1.c2lnbmF0dXJl"


def as_user(client, cookie):
    client.cookies.clear()
    client.cookies.set("better-auth.session_token", cookie)


def newcomer(engine, uid="u2", token="tok-2", **kw):
    """Someone who signed up but has no organization yet (they'll join by invitation)."""
    return add_user(engine, uid=uid, token=token, name="Ravi Kumar", company=None, onboarded=False, **kw)


def test_only_a_hash_of_the_token_is_stored(client, engine):
    sign_in(client, engine)
    token = invite(client, "u2@acme.co")
    with Session(engine) as s:
        inv = s.scalar(select(Invitation))
        assert inv.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert token not in {str(v) for v in inv.__dict__.values()}
    listed = client.get("/invitations").json()
    assert listed[0]["email"] == "u2@acme.co" and "token" not in str(listed) and token not in str(listed)


def test_new_user_joins_with_exactly_the_invited_role(client, engine):
    ws = sign_in(client, engine)
    upload(client)
    token = invite(client, "u2@acme.co", "viewer")
    client.cookies.clear()
    info = client.get(f"/invitations/lookup/{token}").json()
    assert info["valid"] and info["organization_name"] == "Acme" and info["role"] == "viewer"
    assert info["invited_by"] == "Asha Rao" and info["email_hint"] == "u2*@acme.co"

    as_user(client, newcomer(engine))
    assert client.get("/me").json()["needs_onboarding"] is True
    r = accept(client, token)
    assert r.status_code == 200 and r.json()["role"] == "viewer"
    me = client.get("/me").json()
    assert me["workspace"]["id"] == ws and me["role"] == "viewer" and me["needs_onboarding"] is False
    assert "content.write" not in me["permissions"]
    assert len(client.get("/datasets").json()) == 1  # sees the team's data
    assert accept(client, token).status_code == 410  # single use
    assert client.get(f"/invitations/lookup/{token}").json()["code"] == "used"


def test_existing_user_with_their_own_org_joins_a_second_one(client, engine):
    sign_in(client, engine)
    token = invite(client, "u2@acme.co", "analyst")
    as_user(client, add_user(engine, uid="u2", token="tok-2", company="Ravi Co"))
    own = client.get("/me").json()["workspace"]["id"]
    upload(client)  # their own data stays put
    assert accept(client, token).status_code == 200
    me = client.get("/me").json()
    assert me["workspace"]["id"] != own and me["role"] == "analyst"
    assert {w["organization_name"] for w in me["workspaces"]} == {"Acme", "Ravi Co"}
    assert client.put("/me/workspace", json={"workspace_id": own}).status_code == 200
    assert len(client.get("/datasets").json()) == 1


def test_only_the_invited_address_can_accept(client, engine):
    sign_in(client, engine)
    token = invite(client, "someone@acme.co")
    as_user(client, newcomer(engine))
    r = accept(client, token)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "wrong_email"
    assert "someone@acme.co" not in r.text  # the full address isn't revealed
    with Session(engine) as s:
        assert s.scalar(select(Invitation.status)) == "pending"  # still usable by the right person


def test_invited_address_must_be_verified_in_production(client, engine, monkeypatch):
    sign_in(client, engine)
    from sqlalchemy import update as upd

    from app.auth_tables import user_table

    with engine.begin() as c:
        c.execute(upd(user_table).where(user_table.c.id == "u1").values(emailVerified=True))
    monkeypatch.setattr(get_settings(), "environment", "production")
    token = invite(client, "u2@acme.co")
    as_user(client, newcomer(engine))
    r = accept(client, token)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "email_unverified"
    with engine.begin() as c:
        c.execute(upd(user_table).where(user_table.c.id == "u2").values(emailVerified=True))
    assert accept(client, token).status_code == 200


def test_expired_and_revoked_invitations_cannot_be_used(client, engine):
    sign_in(client, engine)
    expired = invite(client, "u2@acme.co")
    revoked = invite(client, "u3@acme.co")
    with engine.begin() as c:
        c.execute(update(Invitation).where(Invitation.email == "u2@acme.co").values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
    rid = next(i["id"] for i in client.get("/invitations").json() if i["email"] == "u3@acme.co")
    assert client.delete(f"/invitations/{rid}").status_code == 204
    assert client.get(f"/invitations/lookup/{expired}").json()["code"] == "expired"
    assert client.get(f"/invitations/lookup/{revoked}").json()["code"] == "revoked"
    as_user(client, newcomer(engine))
    assert accept(client, expired).status_code == 410
    as_user(client, newcomer(engine, uid="u3", token="tok-3"))
    assert accept(client, revoked).status_code == 410
    assert client.get("/invitations/lookup/not-a-real-token-at-all").json()["code"] == "not_found"


def test_one_open_invitation_per_address_and_resend_rotates_the_link(client, engine, monkeypatch):
    sign_in(client, engine)
    sent = []
    monkeypatch.setattr(email, "send", lambda to, subject, html, text: sent.append(text) or 1)
    first = invite(client, "u2@acme.co")
    r = client.post("/invitations", json={"emails": ["U2@acme.co", "u3@acme.co", "nope"], "role": "viewer"})
    results = {x["email"]: x["result"] for x in r.json()}
    assert results == {"u2@acme.co": "already_invited", "u3@acme.co": "invited", "nope": "invalid"}
    inv = next(i for i in client.get("/invitations").json() if i["email"] == "u2@acme.co")
    with engine.begin() as c:  # pretend the first send was a while ago (resend has a cooldown)
        c.execute(update(Invitation).where(Invitation.id == inv["id"]).values(last_sent_at=datetime.now(timezone.utc) - timedelta(minutes=5)))
    r = client.post(f"/invitations/{inv['id']}/resend")
    assert r.status_code == 200
    second = r.json()["accept_url"].rsplit("/", 1)[-1]
    assert second != first and second in sent[-1]
    assert client.post(f"/invitations/{inv['id']}/resend").status_code == 429  # cooldown
    as_user(client, newcomer(engine))
    assert accept(client, first).status_code == 410  # the old link stopped working
    assert accept(client, second).status_code == 200


def test_roles_can_only_be_invited_up_to_your_own(client, engine):
    ws = sign_in(client, engine)
    assert client.post("/invitations", json={"emails": ["x@acme.co"], "role": "owner"}).status_code == 422
    token = invite(client, "u2@acme.co", "analyst")
    as_user(client, newcomer(engine))
    accept(client, token)
    r = client.post("/invitations", json={"emails": ["x@acme.co"], "role": "viewer"})
    assert r.status_code == 403  # analysts don't invite
    as_user(client, U1)
    client.patch("/organizations/current/members/u2", json={"role": "admin"})
    as_user(client, "tok-2.c2lnbmF0dXJl")
    r = client.post("/invitations", json={"emails": ["x@acme.co"], "role": "admin", "workspace_id": ws})
    assert r.status_code == 201 and r.json()[0]["result"] == "invited"  # admins invite up to admin


def test_accepting_never_lowers_an_existing_role(client, engine):
    sign_in(client, engine)
    token = invite(client, "u2@acme.co", "admin")
    as_user(client, newcomer(engine))
    accept(client, token)
    # A leftover viewer invitation (the API won't send one to a member, so plant it) can't demote them.
    with Session(engine) as s:
        org_id = s.scalar(select(OrganizationMember.organization_id).where(OrganizationMember.user_id == "u2"))
        s.add(Invitation(
            organization_id=org_id, email="u2@acme.co", role="viewer", token_hash=hashlib.sha256(b"leftover-token-1234").hexdigest(),
            status="pending", expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        ))
        s.commit()
    assert accept(client, "leftover-token-1234").status_code == 200
    assert client.get("/me").json()["role"] == "admin"


def test_the_claim_is_atomic_even_after_a_stale_check(client, engine, monkeypatch):
    """Two tabs both pass the "is it still pending?" check; only the UPDATE ... WHERE status='pending' decides."""
    from app.routers import invitations

    sign_in(client, engine)
    token = invite(client, "u2@acme.co")
    as_user(client, newcomer(engine))
    assert accept(client, token).status_code == 200
    monkeypatch.setattr(invitations, "_problem", lambda inv: None)  # the second tab read it before the first committed
    r = accept(client, token)
    assert r.status_code == 410 and r.json()["detail"]["code"] == "used"
    with Session(engine) as s:
        assert len(s.scalars(select(OrganizationMember).where(OrganizationMember.user_id == "u2")).all()) == 1


def test_invitation_events_are_audited(client, engine):
    sign_in(client, engine)
    token = invite(client, "u2@acme.co")
    rid = client.get("/invitations").json()[0]["id"]
    invite(client, "u3@acme.co")
    as_user(client, newcomer(engine))
    accept(client, token)
    as_user(client, U1)
    rid3 = next(i["id"] for i in client.get("/invitations").json() if i["email"] == "u3@acme.co")
    client.delete(f"/invitations/{rid3}")
    client.patch("/organizations/current/members/u2", json={"role": "viewer"})
    with Session(engine) as s:
        actions = [a for a in s.scalars(select(AuditLog.action))]
    assert {"invite.create", "invite.accept", "invite.revoke", "member.role"} <= set(actions)
    page = client.get("/activity", params={"scope": "organization"}).json()
    assert {"invite.accept", "member.role"} <= {i["action"] for i in page["items"]}
    assert rid


def test_seat_limit_counts_pending_invitations(client, engine):
    sign_in(client, engine)
    from app.models import Organization

    with engine.begin() as c:
        c.execute(update(Organization).values(seat_limit=2))
    invite(client, "u2@acme.co")
    r = client.post("/invitations", json={"emails": ["u3@acme.co"], "role": "viewer"})
    assert r.status_code == 402 and "seats" in r.json()["detail"]
