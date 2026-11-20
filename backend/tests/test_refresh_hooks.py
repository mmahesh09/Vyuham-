"""Refresh hooks: secret URLs that Airflow, Airbyte, Kubeflow or cron call to refresh connected datasets."""

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, RefreshHook, WorkspaceMember
from tests.test_connections import ORDERS, connect, fake_db, sign_in  # noqa: F401  (fake_db is a fixture)


def resume(client, token="tok-1"):
    """Sign back in as a user created earlier in the test."""
    client.cookies.set("better-auth.session_token", token)


def connected_dataset(client):
    conn = connect(client).json()
    return client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders"]}).json()["datasets"][0]


def make_hook(client, dataset_ids, name="Nightly DAG"):
    return client.post("/refresh-hooks", json={"name": name, "dataset_ids": dataset_ids})


def grow_source(fake_db):
    """The customer's table gains a row, so a refresh is visible as a new row count."""
    fake_db["state"]["frame"] = pd.concat([ORDERS, ORDERS.iloc[:1]], ignore_index=True)


def test_hook_refreshes_its_datasets(client, engine, fake_db):
    sign_in(client, engine)
    ds = connected_dataset(client)
    created = make_hook(client, [ds["id"]])
    assert created.status_code == 201
    path = created.json()["path"]
    assert path.startswith("/hooks/refresh/vyh_")

    grow_source(fake_db)
    client.cookies.clear()  # pipelines call without a session
    r = client.post(path)
    assert r.status_code == 202 and r.json() == {"accepted": True}

    resume(client)
    assert client.get(f"/datasets/{ds['id']}").json()["row_count"] == 4
    hook = client.get("/refresh-hooks").json()[0]
    assert hook["last_called_at"] is not None
    assert "path" not in hook and "token" not in hook  # the token is shown once only


def test_only_a_hash_of_the_token_is_stored(client, engine, fake_db):
    sign_in(client, engine)
    ds = connected_dataset(client)
    token = make_hook(client, [ds["id"]]).json()["path"].rsplit("/", 1)[1]
    with Session(engine) as s:
        row = s.scalars(select(RefreshHook)).one()
        assert row.token_hash != token and token not in row.token_hash
        assert row.token_hint == token[-4:]


def test_unknown_and_revoked_tokens_look_the_same_and_do_nothing(client, engine, fake_db):
    sign_in(client, engine)
    ds = connected_dataset(client)
    created = make_hook(client, [ds["id"]]).json()
    assert client.delete(f"/refresh-hooks/{created['id']}").status_code == 204
    grow_source(fake_db)

    client.cookies.clear()
    revoked = client.post(created["path"])
    unknown = client.post("/hooks/refresh/vyh_not-a-real-token")
    junk = client.post("/hooks/refresh/anything")
    assert revoked.status_code == unknown.status_code == junk.status_code == 202
    assert revoked.json() == unknown.json() == junk.json()

    resume(client)
    assert client.get(f"/datasets/{ds['id']}").json()["row_count"] == 3  # nothing was refreshed


def test_optional_body_narrows_which_datasets_refresh(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    both = client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders", "public.customers"]}).json()["datasets"]
    path = make_hook(client, [d["id"] for d in both]).json()["path"]
    grow_source(fake_db)

    client.cookies.clear()
    assert client.post(path, json={"dataset_ids": [both[0]["id"], "someone-elses-dataset"]}).status_code == 202

    resume(client)
    assert client.get(f"/datasets/{both[0]['id']}").json()["row_count"] == 4
    assert client.get(f"/datasets/{both[1]['id']}").json()["row_count"] == 3


def test_airbyte_style_payload_refreshes_everything(client, engine, fake_db):
    sign_in(client, engine)
    ds = connected_dataset(client)
    path = make_hook(client, [ds["id"]]).json()["path"]
    grow_source(fake_db)
    client.cookies.clear()
    airbyte = {"data": {"connection": {"name": "Stripe → Postgres"}, "success": True}}
    assert client.post(path, json=airbyte).status_code == 202
    assert client.post(path, content=b"not json", headers={"content-type": "text/plain"}).status_code == 202

    resume(client)
    assert client.get(f"/datasets/{ds['id']}").json()["row_count"] == 4


def test_hook_calls_are_audited_without_a_user(client, engine, fake_db):
    sign_in(client, engine)
    ds = connected_dataset(client)
    path = make_hook(client, [ds["id"]]).json()["path"]
    client.cookies.clear()
    client.post(path)
    with Session(engine) as s:
        actions = {(a.action, a.user_id) for a in s.scalars(select(AuditLog))}
    assert ("refresh_hook.create", "u1") in actions
    assert ("refresh_hook.call", None) in actions


def test_hooks_only_take_connected_datasets_from_your_workspace(client, engine, fake_db):
    sign_in(client, engine)
    upload = client.post("/datasets", files={"file": ("a.csv", b"a\n1\n", "text/csv")}).json()
    assert make_hook(client, [upload["id"]]).status_code == 422  # uploads have nothing to refresh from

    sign_in(client, engine, uid="u2", token="tok-2")
    theirs = connected_dataset(client)
    resume(client)
    assert make_hook(client, [theirs["id"]]).status_code == 422
    assert make_hook(client, []).status_code == 422


def test_other_workspaces_cannot_see_or_revoke_hooks(client, engine, fake_db):
    sign_in(client, engine)
    hook = make_hook(client, [connected_dataset(client)["id"]]).json()
    sign_in(client, engine, uid="u2", token="tok-2")
    assert client.get("/refresh-hooks").json() == []
    assert client.delete(f"/refresh-hooks/{hook['id']}").status_code == 404


def test_viewers_cannot_create_or_revoke_hooks(client, engine, fake_db):
    sign_in(client, engine)
    ds = connected_dataset(client)
    hook = make_hook(client, [ds["id"]]).json()
    with Session(engine) as s:
        s.query(WorkspaceMember).first().role = "viewer"
        s.commit()
    assert make_hook(client, [ds["id"]]).status_code == 403
    assert client.delete(f"/refresh-hooks/{hook['id']}").status_code == 403


def test_hook_url_is_rate_limited(client):
    codes = [client.post("/hooks/refresh/vyh_guess").status_code for _ in range(31)]
    assert codes[:30] == [202] * 30 and codes[30] == 429
