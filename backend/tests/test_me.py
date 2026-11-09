from datetime import timedelta

from tests.conftest import NOW, add_user


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_me_requires_session(client):
    assert client.get("/me").status_code == 401
    client.cookies.set("better-auth.session_token", "nope.sig")
    assert client.get("/me").status_code == 401


def test_me_creates_workspace_once(client, engine):
    client.cookies.set("better-auth.session_token", add_user(engine))
    first = client.get("/me")
    assert first.status_code == 200
    body = first.json()
    assert body["email"] == "u1@acme.co"
    assert body["role"] == "owner"
    assert body["workspace"]["name"] == "Acme Co"
    assert client.get("/me").json()["workspace"]["id"] == body["workspace"]["id"]


def test_workspace_name_falls_back_to_first_name(client, engine):
    client.cookies.set("__Secure-better-auth.session_token", add_user(engine, company=None))
    assert client.get("/me").json()["workspace"]["name"] == "Asha's workspace"


def test_expired_session_rejected(client, engine):
    client.cookies.set("better-auth.session_token", add_user(engine, expires=NOW - timedelta(minutes=1)))
    assert client.get("/me").status_code == 401


def test_users_get_separate_workspaces(client, engine):
    a = add_user(engine, "a", token="ta")
    b = add_user(engine, "b", token="tb")
    client.cookies.set("better-auth.session_token", a)
    wa = client.get("/me").json()["workspace"]["id"]
    client.cookies.set("better-auth.session_token", b)
    wb = client.get("/me").json()["workspace"]["id"]
    assert wa != wb


def test_production_refuses_unsafe_defaults():
    import pytest
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError, match="Postgres"):
        Settings(environment="production", database_url="sqlite:///./dev.db", data_dir="/data")
    with pytest.raises(ValidationError, match="DATA_DIR"):
        Settings(environment="production", database_url="postgresql+psycopg://x@db/app", data_dir="./data")
    assert Settings(environment="production", database_url="postgresql+psycopg://x@db/app", data_dir="/data").environment == "production"
