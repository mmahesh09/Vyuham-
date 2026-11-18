"""Connectors against real servers. Skipped unless these point at disposable test databases:

    TEST_POSTGRES_URL=postgresql://reader:pw@127.0.0.1:5432/shop
    TEST_POSTGRES_ADMIN_URL=postgresql://admin:pw@127.0.0.1:5432/shop   (optional)
    TEST_MYSQL_URL=mysql://reader:pw@127.0.0.1:3306/shop
    TEST_MYSQL_ADMIN_URL=mysql://root:pw@127.0.0.1:3306/shop            (optional)

Each database needs an `orders` table with an `id` column, more than 100 rows, readable by the reader.
The admin URLs prove that even a user allowed to write can't do so through a Vyuham session; the
UPDATE is refused, so no data changes. Never point these at a database you care about.
"""

import os

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.connectors import base
from app.connectors.base import ConnectorError, ConnSpec, QueryProblem, session
from app.connectors.extract import extract
from app.connectors.introspect import list_tables, preview
from app.ingest import profile_frame

KINDS = {"postgres": ("TEST_POSTGRES_URL", "TEST_POSTGRES_ADMIN_URL", "public.orders"), "mysql": ("TEST_MYSQL_URL", "TEST_MYSQL_ADMIN_URL", "orders")}
SLOW_QUERY = {
    "postgres": "SELECT count(*) AS n FROM generate_series(1, 100000000000) AS g",
    "mysql": "SELECT count(*) AS n FROM orders a, orders b, orders c, orders d WHERE a.id + b.id + c.id + d.id < 0",
}


def _spec(url: str, kind: str, **changes) -> ConnSpec:
    u = make_url(url)
    fields = {"kind": kind, "host": u.host, "port": u.port, "database": u.database, "username": u.username, "password": u.password or "", "ssl_mode": "require"}
    return ConnSpec(**{**fields, **changes})


@pytest.fixture(params=sorted(KINDS))
def live(request, monkeypatch):
    kind = request.param
    url = os.environ.get(KINDS[kind][0])
    if not url:
        pytest.skip(f"{KINDS[kind][0]} is not set")
    monkeypatch.setattr(get_settings(), "connections_allow_private", True)
    return kind, url, KINDS[kind][2]


def test_lists_previews_and_syncs(live):
    kind, url, table = live
    spec = _spec(url, kind)
    assert table in {t.key for t in list_tables(spec)}
    assert len(preview(spec, table)) == 50
    frame = extract(spec, table=table)
    assert len(profile_frame(frame, len(frame)).frame) == len(frame) > 100


def test_custom_queries_run_as_regenerated(live):
    kind, url, _ = live
    frame = extract(_spec(url, kind), query="SELECT id, ' :x 50%' AS label FROM orders WHERE id < 4 -- first rows")
    assert sorted(frame["id"]) == [1, 2, 3] and set(frame["label"]) == {" :x 50%"}


def test_row_cap(live):
    kind, url, table = live
    with pytest.raises(QueryProblem, match="more than 100 rows"):
        extract(_spec(url, kind), table=table, max_rows=100)


def test_session_is_read_only_even_for_a_user_who_can_write(live):
    kind, _, _ = live
    admin = os.environ.get(KINDS[kind][1])
    if not admin:
        pytest.skip(f"{KINDS[kind][1]} is not set")
    with pytest.raises(QueryProblem, match="only reads data"):
        with session(_spec(admin, kind)) as conn:
            conn.execute(text("UPDATE orders SET id = id WHERE id = 1"))


def test_slow_queries_are_stopped(live, monkeypatch):
    kind, url, _ = live
    monkeypatch.setattr(base, "STATEMENT_TIMEOUT_MS", 1000)
    with pytest.raises(QueryProblem, match="took longer"):
        extract(_spec(url, kind), query=SLOW_QUERY[kind])


@pytest.mark.parametrize(
    "changes,expected",
    [
        ({"password": "definitely-wrong"}, "username or password"),
        ({"username": "no_such_user"}, "username or password"),
        ({"port": 1}, "refused|in time"),
    ],
)
def test_connection_failures_are_explained(live, changes, expected):
    kind, url, _ = live
    with pytest.raises(ConnectorError, match=expected) as e:
        list_tables(_spec(url, kind, **changes))
    assert "definitely-wrong" not in str(e.value)
    assert not isinstance(e.value, QueryProblem)


def test_unverifiable_certificates_are_refused(live):
    kind, url, _ = live
    with pytest.raises(ConnectorError, match="SSL connection failed"):
        list_tables(_spec(url, kind, host="localhost", ssl_mode="verify-full"))


def test_hourly_and_daily_syncs_write_parquet_end_to_end(live, client, engine):
    """Through the API and the scheduler: connect, sync, refresh when due, and survive a broken password."""
    from datetime import timedelta, timezone

    import pandas as pd
    from sqlalchemy.orm import Session

    from app import crypto, jobs
    from app.models import Connection, Dataset
    from app.routers.datasets import parquet_path
    from tests.test_connections import sign_in

    kind, url, table = live
    workspace = sign_in(client, engine)
    spec = _spec(url, kind)
    body = {"name": "Live", "kind": kind, "host": spec.host, "port": spec.port, "database": spec.database,
            "username": spec.username, "password": spec.password, "ssl_mode": "require"}
    created = client.post("/connections", json=body)
    assert created.status_code == 201, created.text
    assert spec.password not in created.text
    connection_id = created.json()["id"]

    made = {}
    for refresh in ("hourly", "daily"):
        r = client.post(f"/connections/{connection_id}/datasets", json={"query": f"SELECT id FROM orders -- {refresh}", "name": refresh, "refresh": refresh})
        assert r.status_code == 201, r.text
        made[refresh] = r.json()["datasets"][0]["id"]
    rows = len(pd.read_parquet(parquet_path(workspace, made["hourly"])))
    assert rows > 100

    with Session(engine) as s:
        hourly, daily = s.get(Dataset, made["hourly"]), s.get(Dataset, made["daily"])
        start = max(hourly.last_synced_at, daily.last_synced_at).replace(tzinfo=timezone.utc)
        assert jobs.tick(s, start + timedelta(minutes=30))["datasets_synced"] == 0
        assert jobs.tick(s, start + timedelta(minutes=61))["datasets_synced"] == 1
        s.refresh(hourly), s.refresh(daily)
        assert hourly.last_synced_at.replace(tzinfo=timezone.utc) == start + timedelta(minutes=61)
        assert jobs.tick(s, start + timedelta(hours=24, minutes=1))["datasets_synced"] == 2

        s.get(Connection, connection_id).secret_enc = crypto.encrypt("definitely-wrong")
        s.commit()
        good = hourly.last_synced_at
        assert jobs.tick(s, start + timedelta(hours=26))["datasets_synced"] == 1  # the hourly one; daily ran at 24h
        s.refresh(hourly)
        assert hourly.sync_error == "The username or password was rejected." and hourly.last_synced_at == good
        assert s.get(Connection, connection_id).status == "error"
    assert len(pd.read_parquet(parquet_path(workspace, made["hourly"]))) == rows
