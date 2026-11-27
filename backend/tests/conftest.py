"""Shared fixtures: an in-memory database and a client signed in the way Better Auth would."""

import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("SCHEDULER_ENABLED", "false")  # tests drive alerts.tick() directly

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, insert
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth_tables import session_table, user_table
from app.db import Base, get_db
from app.main import app

NOW = datetime.now(timezone.utc)


@pytest.fixture
def engine():
    """In-memory SQLite by default; a real Postgres when TEST_DATABASE_URL is set (CI runs both)."""
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        eng = create_engine(url)
        Base.metadata.drop_all(eng)
        Base.metadata.create_all(eng)
        yield eng
        Base.metadata.drop_all(eng)
        eng.dispose()
        return
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    yield eng


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """Parquet files go to a temp folder per test."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "data_dir", str(tmp_path / "data"))
    return tmp_path / "data"


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    """Every test starts with empty rate-limit counters (they're per process, in memory, in tests)."""
    from app import ratelimit

    ratelimit.reset()
    yield
    ratelimit.reset()


@pytest.fixture
def client(engine):
    TestSession = sessionmaker(bind=engine, expire_on_commit=False)

    def _get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def add_user(
    engine, uid="u1", company="Acme Co", name="Asha Rao", expires=NOW + timedelta(days=7), token="tok-1",
    *, onboarded=True, verified=False, email=None,
):
    """Insert rows the way Better Auth would after sign-up.

    With `onboarded` (the default) the person has also finished onboarding: they own an organization
    with one workspace, named like the old first-request workspace was ("Acme Co", or "Asha's workspace").
    """
    with engine.begin() as conn:
        conn.execute(
            insert(user_table).values(
                id=uid, name=name, email=email or f"{uid}@acme.co", emailVerified=verified,
                company=company, createdAt=NOW, updatedAt=NOW,
            )
        )
        conn.execute(
            insert(session_table).values(
                id=f"s-{uid}", token=token, userId=uid, expiresAt=expires, createdAt=NOW, updatedAt=NOW
            )
        )
    if onboarded:
        add_org(engine, uid, (company or "").strip() or f"{name.split(' ')[0] or 'My'}'s workspace")
    return f"{token}.c2lnbmF0dXJl"  # cookie value is "<token>.<signature>"


def add_org(engine, uid, name="Acme Co", workspace_name=None):
    """An organization owned by `uid`, with its default workspace. Returns (org_id, workspace_id)."""
    from sqlalchemy.orm import Session

    from app import tenancy

    with Session(engine) as db:
        db.info["rls_bypass"] = True
        org, ws = tenancy.create_organization(db, uid, name, workspace_name or name, completed=True)
        db.commit()
        return org.id, ws.id


def join(engine, uid, workspace_id, role="analyst"):
    """Add `uid` to the workspace's organization (and that workspace) with `role`."""
    from sqlalchemy.orm import Session

    from app import tenancy
    from app.models import OrganizationMember, Workspace, WorkspaceMember

    with Session(engine) as db:
        db.info["rls_bypass"] = True
        ws = db.get(Workspace, workspace_id)
        om = db.get(OrganizationMember, (ws.organization_id, uid))
        if om is None:
            db.add(OrganizationMember(organization_id=ws.organization_id, user_id=uid, role=role))
            db.flush()
        else:
            om.role, om.status = role, "active"
        if role in ("owner", "admin"):
            tenancy.sync_full_access(db, ws.organization_id, uid, role)
        elif db.get(WorkspaceMember, (workspace_id, uid)) is None:
            db.add(WorkspaceMember(workspace_id=workspace_id, user_id=uid, role=role))
        tenancy.remember(db, uid, workspace_id)
        db.commit()





def set_role(engine, uid="u1", role="viewer"):
    """Change `uid`'s role in their organization(s) and workspaces (tests demoting the only member)."""
    from sqlalchemy import update

    from app.models import OrganizationMember, WorkspaceMember

    with engine.begin() as conn:
        conn.execute(update(OrganizationMember).where(OrganizationMember.user_id == uid).values(role=role))
        conn.execute(update(WorkspaceMember).where(WorkspaceMember.user_id == uid).values(role=role))



def invite(client, email, role="analyst", workspace_id=None):
    """Invite `email` as the signed-in person; returns the token from the one-time accept link."""
    body = {"emails": [email], "role": role}
    if workspace_id:
        body["workspace_id"] = workspace_id
    r = client.post("/invitations", json=body)
    assert r.status_code == 201, r.text
    res = r.json()[0]
    assert res["result"] == "invited", res
    return res["accept_url"].rsplit("/", 1)[-1]


def accept(client, token):
    return client.post("/invitations/accept", json={"token": token})
