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


def add_user(engine, uid="u1", company="Acme Co", name="Asha Rao", expires=NOW + timedelta(days=7), token="tok-1"):
    """Insert rows the way Better Auth would after sign-up."""
    with engine.begin() as conn:
        conn.execute(
            insert(user_table).values(
                id=uid, name=name, email=f"{uid}@acme.co", emailVerified=False,
                company=company, createdAt=NOW, updatedAt=NOW,
            )
        )
        conn.execute(
            insert(session_table).values(
                id=f"s-{uid}", token=token, userId=uid, expiresAt=expires, createdAt=NOW, updatedAt=NOW
            )
        )
    return f"{token}.c2lnbmF0dXJl"  # cookie value is "<token>.<signature>"


