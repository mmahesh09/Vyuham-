"""Onboarding: one organization per setup, however many times the request is retried."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Organization, OrganizationMember, Workspace, WorkspaceMember
from tests.conftest import add_user


def fresh(client, engine, uid="u1", token="tok-1"):
    client.cookies.set("better-auth.session_token", add_user(engine, uid=uid, token=token, onboarded=False))


def counts(engine):
    with Session(engine) as s:
        return (
            s.scalar(select(func.count()).select_from(Organization)),
            s.scalar(select(func.count()).select_from(Workspace)),
            s.scalar(select(func.count()).select_from(OrganizationMember)),
        )


BODY = {"creation_key": "key-abc-123", "company_name": "Acme Traders", "company_size": "11-50", "industry": "Retail", "intended_use": ["Sales", "Finance"]}


def test_new_people_are_sent_to_onboarding_not_given_a_workspace(client, engine):
    fresh(client, engine)
    me = client.get("/me").json()
    assert me["needs_onboarding"] is True and me["workspace"] is None and me["role"] is None
    r = client.get("/datasets")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "onboarding_required"
    assert counts(engine) == (0, 0, 0)  # nothing created behind their back


def test_full_flow(client, engine):
    fresh(client, engine)
    s = client.post("/onboarding/organization", json=BODY).json()
    assert s["step"] == "invite" and s["organization"]["name"] == "Acme Traders"
    assert s["workspace"]["name"] == "Acme Traders workspace"
    me = client.get("/me").json()
    assert me["role"] == "owner" and me["organization"]["name"] == "Acme Traders" and me["needs_onboarding"] is True
    assert client.post("/onboarding/invite-step").json()["step"] == "personalize"
    p = client.patch("/onboarding/personalize", json={"departments": ["Sales", " "], "data_sources": ["Excel"], "workflows": ["Weekly report"]}).json()
    assert p["workspace"]["preferences"]["departments"] == ["Sales"]
    done = client.post("/onboarding/complete").json()
    assert done == {"needs_onboarding": False, "step": "done", "organization": None, "workspace": None}
    assert client.get("/me").json()["needs_onboarding"] is False
    with Session(engine) as db:
        org = db.scalar(select(Organization))
        assert org.company_size == "11-50" and org.intended_use == ["Sales", "Finance"] and org.onboarding_completed_at
        assert db.scalar(select(OrganizationMember.role)) == "owner"
        assert db.scalar(select(WorkspaceMember.role)) == "owner"


def test_retries_and_double_clicks_create_one_organization(client, engine):
    fresh(client, engine)
    for _ in range(3):
        assert client.post("/onboarding/organization", json=BODY).status_code == 200
    assert counts(engine) == (1, 1, 1)
    # A new key while setup is unfinished (say, a second tab) updates the same organization.
    r = client.post("/onboarding/organization", json={**BODY, "creation_key": "key-other-456", "company_name": "Acme Ltd", "workspace_name": "HQ"})
    assert r.json()["organization"]["name"] == "Acme Ltd" and r.json()["workspace"]["name"] == "HQ"
    assert counts(engine) == (1, 1, 1)


def test_validation(client, engine):
    fresh(client, engine)
    assert client.post("/onboarding/organization", json={**BODY, "company_name": "   "}).status_code == 422
    assert client.post("/onboarding/organization", json={**BODY, "company_size": "lots"}).status_code == 422
    assert client.post("/onboarding/organization", json={**BODY, "creation_key": "bad key!"}).status_code == 422
    assert counts(engine) == (0, 0, 0)


def test_only_owners_and_admins_personalize(client, engine):
    fresh(client, engine)
    client.post("/onboarding/organization", json=BODY)
    client.post("/onboarding/complete")
    from tests.conftest import accept, invite

    token = invite(client, "u2@acme.co", "analyst")
    client.cookies.set("better-auth.session_token", add_user(engine, uid="u2", token="tok-2", onboarded=False))
    accept(client, token)
    assert client.get("/me").json()["needs_onboarding"] is False  # joining by invite skips setup
    assert client.patch("/onboarding/personalize", json={"departments": ["x"]}).status_code == 403
