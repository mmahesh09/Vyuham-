"""Database connections: secrets, safety checks, the API, syncing into Parquet and the sync schedule.

The customer's database is replaced by small fakes (`list_tables` / `extract`), so these tests run
without a Postgres or MySQL server. Everything after the read (typing, Parquet, SQL Lab, jobs) is real.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pandas as pd
import pytest
from sqlalchemy.orm import Session

from app import crypto, jobs
from app.config import get_settings
from app.connectors import base as connector_base
from app.connectors.base import ConnectorError, ConnSpec, resolve_public
from app.connectors.extract import validate_query
from app.connectors.introspect import TableInfo
from app.ingest import profile_frame
from app.models import Connection, Dataset
from app.routers.datasets import parquet_path
from tests.conftest import add_user

ORDERS = pd.DataFrame(
    {
        "id": [1, 2, 3],
        "customer": ["Acme", "Bolt", "Acme"],
        "amount": [Decimal("100.50"), Decimal("250.00"), Decimal("75.25")],
        "ordered_on": [date(2026, 10, 1), date(2026, 10, 2), date(2026, 11, 3)],
        "status": ["paid", "Paid", "refunded"],
    }
)
TABLES = [TableInfo("public", "orders", "table", 3), TableInfo("public", "customers", "table", 2)]
PG = {"kind": "postgres", "host": "db.example.com", "port": 5432, "database": "shop", "username": "reader", "ssl_mode": "require"}


@pytest.fixture
def fake_db(monkeypatch):
    """Stand-in for the customer's database: records the specs it was called with."""
    calls: list[ConnSpec] = []
    state = {"frame": ORDERS.copy(), "fail": None}

    def list_tables(spec):
        calls.append(spec)
        if spec.password != "s3cret":
            raise ConnectorError("The username or password was rejected.")
        return TABLES

    def extract(spec, *, table=None, query=None, max_rows=1_000_000):
        calls.append(spec)
        if state["fail"]:
            raise ConnectorError(state["fail"])
        if table is not None and table not in {t.key for t in TABLES}:
            raise ConnectorError(f"There's no table or view called “{table}” that this user can see.")
        return state["frame"].copy()

    monkeypatch.setattr("app.routers.connections.list_tables", list_tables)
    monkeypatch.setattr("app.sync.extract", extract)
    return {"calls": calls, "state": state}


def sign_in(client, engine, uid="u1", token="tok-1"):
    client.cookies.set("better-auth.session_token", add_user(engine, uid, token=token))
    return client.get("/me").json()["workspace"]["id"]


def connect(client, **overrides):
    return client.post("/connections", json={**PG, "name": "Shop DB", "password": "s3cret", **overrides})


# ---------- secrets and safety ----------


def test_password_is_encrypted_and_round_trips():
    token = crypto.encrypt("s3cret")
    assert "s3cret" not in token
    assert crypto.decrypt(token) == "s3cret"


def test_key_rotation_keeps_old_secrets_readable(monkeypatch):
    from cryptography.fernet import Fernet

    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setattr(get_settings(), "connections_key", old)
    crypto.reset()
    token = crypto.encrypt("s3cret")
    monkeypatch.setattr(get_settings(), "connections_key", f"{new},{old}")
    crypto.reset()
    assert crypto.decrypt(token) == "s3cret"
    monkeypatch.setattr(get_settings(), "connections_key", new)
    crypto.reset()
    with pytest.raises(crypto.SecretError):
        crypto.decrypt(token)
    crypto.reset()


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.10", "169.254.169.254", "::1"])
def test_private_hosts_are_refused(host):
    with pytest.raises(ConnectorError, match="private network"):
        resolve_public(host)


def test_private_hosts_allowed_when_switched_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "connections_allow_private", True)
    assert resolve_public("127.0.0.1") == "127.0.0.1"


@pytest.mark.parametrize("bad", ["db.example.com/x", "user@db.example.com", "", "a b"])
def test_host_must_be_a_plain_name(bad):
    with pytest.raises(ConnectorError):
        resolve_public(bad)


@pytest.mark.parametrize(
    "sql",
    ["DELETE FROM t", "SELECT 1; DROP TABLE t", "INSERT INTO t VALUES (1)", "SELECT * INTO x FROM t",
     "SELECT * FROM t FOR UPDATE", "UPDATE t SET a = 1", "CREATE TABLE x (a int)", "SET search_path = x", ""],
)
def test_only_single_selects_are_accepted(sql):
    with pytest.raises(ConnectorError):
        validate_query(sql, "postgres")


@pytest.mark.parametrize("sql", ["SELECT * FROM orders;", "WITH x AS (SELECT 1 AS a) SELECT * FROM x", "SELECT 1 UNION SELECT 2"])
def test_selects_are_accepted(sql):
    assert validate_query(sql, "mysql")


def test_friendly_errors_never_echo_the_password():
    spec = ConnSpec("postgres", "db.example.com", 5432, "shop", "reader", "hunter2-secret")
    msg = connector_base.friendly_error(RuntimeError("weird failure mentioning hunter2-secret"), spec)
    assert "hunter2-secret" not in msg


# ---------- typing database rows ----------


def test_profile_frame_keeps_database_types():
    result = profile_frame(ORDERS)
    types = {c.name: c.type for c in result.columns}
    assert types == {"id": "number", "customer": "category" if len(ORDERS) >= 10 else "text",
                     "amount": "number", "ordered_on": "date", "status": "text"}
    assert result.frame["amount"].tolist() == [100.5, 250.0, 75.25]
    assert str(result.frame["ordered_on"].dtype).startswith("datetime64")


def test_profile_frame_row_cap():
    with pytest.raises(Exception, match="more than 2 rows"):
        profile_frame(ORDERS, max_rows=2)


# ---------- API ----------


def test_test_endpoint_reports_without_saving(client, engine, fake_db):
    sign_in(client, engine)
    bad = client.post("/connections/test", json={**PG, "password": "wrong"}).json()
    assert bad == {"ok": False, "message": "The username or password was rejected.", "table_count": None}
    good = client.post("/connections/test", json={**PG, "password": "s3cret"}).json()
    assert good["ok"] and good["table_count"] == 2
    assert client.get("/connections").json() == []


def test_create_connection_never_returns_the_password(client, engine, fake_db):
    sign_in(client, engine)
    r = connect(client)
    assert r.status_code == 201, r.text
    assert "s3cret" not in r.text and "secret" not in r.json()
    with Session(engine) as s:
        stored = s.get(Connection, r.json()["id"])
        assert stored.secret_enc != "s3cret" and crypto.decrypt(stored.secret_enc) == "s3cret"
    assert connect(client).status_code == 409  # same name
    assert connect(client, name="Other", password="wrong").status_code == 422
    listed = client.get("/connections").json()
    assert [c["name"] for c in listed] == ["Shop DB"] and "s3cret" not in str(listed)


def test_viewers_cannot_manage_connections(client, engine, fake_db):
    sign_in(client, engine)
    with Session(engine) as s:
        from app.models import WorkspaceMember

        m = s.query(WorkspaceMember).first()
        m.role = "viewer"
        s.commit()
    assert connect(client).status_code == 403


def test_sync_tables_into_datasets_and_query_with_uploads(client, engine, fake_db):
    ws = sign_in(client, engine)
    conn = connect(client).json()
    r = client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders"], "refresh": "hourly"})
    assert r.status_code == 201, r.text
    ds = r.json()["datasets"][0]
    assert ds["source_kind"] == "postgres" and ds["source_table"] == "public.orders"
    assert ds["row_count"] == 3 and ds["refresh"] == "hourly" and ds["last_synced_at"]
    assert pd.read_parquet(parquet_path(ws, ds["id"]))["amount"].sum() == pytest.approx(425.75)

    # An uploaded file and the synced table, joined in one SQL Lab query.
    up = client.post("/datasets", files={"file": ("customers.csv", b"customer,region\nAcme,North\nBolt,South\n", "text/csv")})
    assert up.status_code == 201, up.text
    q = client.post("/sql/run", json={"sql": "SELECT c.region, SUM(o.amount) AS total FROM orders o "
                                             "JOIN customers c ON c.customer = o.customer GROUP BY 1 ORDER BY 1"})
    assert q.status_code == 200, q.text
    assert q.json()["rows"] == [{"region": "North", "total": pytest.approx(175.75)}, {"region": "South", "total": 250.0}]

    # A database-backed dataset can't be overwritten by an upload.
    replaced = client.put(f"/datasets/{ds['id']}/file", files={"file": ("x.csv", b"a\n1\n", "text/csv")})
    assert replaced.status_code == 409


def test_sync_from_a_query(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    bad = client.post(f"/connections/{conn['id']}/datasets", json={"query": "DELETE FROM orders", "name": "Oops"})
    assert bad.status_code == 422
    ok = client.post(f"/connections/{conn['id']}/datasets", json={"query": "SELECT * FROM orders", "name": "Paid orders"})
    assert ok.status_code == 201, ok.text
    assert ok.json()["datasets"][0]["name"] == "Paid orders"


def test_failed_tables_are_reported_and_not_created(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    r = client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders", "public.missing"]})
    assert r.status_code == 201
    assert [d["source_table"] for d in r.json()["datasets"]] == ["public.orders"]
    assert "public.missing" in r.json()["errors"]
    assert len(client.get("/datasets").json()) == 1


def test_failed_sync_keeps_the_last_good_data(client, engine, fake_db):
    ws = sign_in(client, engine)
    conn = connect(client).json()
    ds = client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders"]}).json()["datasets"][0]
    fake_db["state"]["fail"] = "The username or password was rejected."
    with Session(engine) as s:
        with pytest.raises(Exception):
            from app.sync import sync_dataset

            sync_dataset(s, s.get(Dataset, ds["id"]))
    after = client.get(f"/datasets/{ds['id']}").json()
    assert after["sync_error"] == "The username or password was rejected." and after["row_count"] == 3
    assert len(pd.read_parquet(parquet_path(ws, ds["id"]))) == 3
    assert client.get("/connections").json()[0]["status"] == "error"


def test_refresh_now_picks_up_new_rows(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    ds = client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders"]}).json()["datasets"][0]
    fake_db["state"]["frame"] = pd.concat([ORDERS, ORDERS.iloc[:1]], ignore_index=True)
    r = client.post(f"/datasets/{ds['id']}/sync")  # no Redis in tests: runs as a background task
    assert r.status_code == 202
    assert client.get(f"/datasets/{ds['id']}").json()["row_count"] == 4


def test_refresh_setting_only_for_connected_data(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    ds = client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders"]}).json()["datasets"][0]
    assert client.patch(f"/datasets/{ds['id']}", json={"refresh": "manual"}).json()["refresh"] == "manual"
    up = client.post("/datasets", files={"file": ("a.csv", b"a\n1\n", "text/csv")}).json()
    assert client.patch(f"/datasets/{up['id']}", json={"refresh": "daily"}).status_code == 422
    assert client.post(f"/datasets/{up['id']}/sync").status_code == 422


def test_deleting_a_connection_freezes_its_datasets(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    ds = client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders"]}).json()["datasets"][0]
    assert client.delete(f"/connections/{conn['id']}").status_code == 204
    frozen = client.get(f"/datasets/{ds['id']}").json()
    assert frozen["connection_id"] is None and frozen["refresh"] == "manual" and frozen["row_count"] == 3


def test_other_workspaces_cannot_see_connections(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    sign_in(client, engine, uid="u2", token="tok-2")
    assert client.get(f"/connections/{conn['id']}/tables").status_code == 404
    assert client.get("/connections").json() == []


# ---------- schedule ----------


def test_scheduled_syncs_run_when_due(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    ds = client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders"], "refresh": "hourly"}).json()["datasets"][0]
    with Session(engine) as s:
        synced_at = s.get(Dataset, ds["id"]).last_synced_at.replace(tzinfo=timezone.utc)
        assert jobs.tick(s, synced_at + timedelta(minutes=30))["datasets_synced"] == 0
        fake_db["state"]["frame"] = ORDERS.iloc[:2]
        assert jobs.tick(s, synced_at + timedelta(minutes=61))["datasets_synced"] == 1
        assert s.get(Dataset, ds["id"]).row_count == 2
        # Manual datasets are never scheduled.
        s.get(Dataset, ds["id"]).refresh = "manual"
        s.commit()
        assert jobs.tick(s, synced_at + timedelta(days=3))["datasets_synced"] == 0
