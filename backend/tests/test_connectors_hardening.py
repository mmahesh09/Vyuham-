"""Database connections: what must never happen, and how failures and the sync schedule behave.

Nothing here needs a Postgres or MySQL server. tests/test_connectors_live.py covers real servers.
"""

import socket
import struct
import threading
from datetime import timedelta, timezone
from pathlib import Path

import pandas as pd
import pymysql
import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app import jobs
from app.config import Settings, get_settings
from app.connectors import extract as extract_module
from app.connectors.base import ConnectorError, ConnSpec, QueryProblem, friendly_error, resolve_public, session
from app.connectors.extract import extract, validate_query
from app.models import Connection, Dataset, JobRun, WorkspaceMember
from app.routers.datasets import parquet_path
from app.schemas import ConnectionIn, ConnectionPatch, ConnectionTestIn
from app.sync import INTERNAL_FAILURE, RETRY_AFTER, SyncError, next_sync_at, sync_dataset, sync_in_progress, sync_slot
from tests.test_connections import ORDERS, PG, connect, fake_db, sign_in  # noqa: F401  (fake_db is a fixture)

SPEC = ConnSpec("postgres", "db.example.com", 5432, "shop", "russell", "hunter2-secret")
MY_SPEC = ConnSpec("mysql", "db.example.com", 3306, "shop", "reader", "hunter2-secret")


# ---------- only safe SELECTs ----------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT pg_sleep(3600)", "SELECT pg_terminate_backend(1)", "SELECT pg_catalog.pg_terminate_backend(1)",
        'SELECT "pg_sleep"(5)', 'SELECT "pg_catalog"."pg_cancel_backend"(1)', "SELECT * FROM pg_sleep(5)",
        "SELECT set_config('statement_timeout', '0', true)", "SELECT current_setting('data_directory')",
        "SELECT dblink_exec('dbname=x', 'DROP TABLE t')", "SELECT * FROM dblink('host=x', 'DELETE FROM t') AS t(a int)",
        "SELECT pg_read_file('/etc/passwd')", "SELECT lo_export(1, '/tmp/x')", "SELECT nextval('s')",
        "SELECT pg_advisory_lock(1)", "SELECT query_to_xml('select 1', true, true, '')",
        "SELECT * FROM pg_shadow", 'SELECT * FROM "pg_authid"', "SELECT * FROM pg_catalog.pg_authid",
        "SELECT * FROM information_schema.tables",
        "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "SELECT * INTO x FROM t", "SELECT * FROM t FOR SHARE",
        "COPY t TO '/tmp/x'", "EXPLAIN ANALYZE DELETE FROM t", "DROP TABLE t", "SELECT 1; DROP TABLE t", "SELECT 'unterminated",
    ],
)
def test_postgres_queries_refused(sql):
    with pytest.raises(QueryProblem):
        validate_query(sql, "postgres")


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT SLEEP(3600)", "SELECT sleep(1) FROM t", "SELECT BENCHMARK(1000000000, MD5(1))", "SELECT GET_LOCK('a', 100)",
        "SELECT LOAD_FILE('/etc/passwd')", "SELECT * FROM t INTO OUTFILE '/tmp/x'", "SELECT 1 INTO DUMPFILE '/tmp/x'",
        "SELECT 1 INTO @a", "SELECT @a := 1", "SELECT @@global.max_connections", "SELECT * FROM t FOR UPDATE",
        "SELECT * FROM t LOCK IN SHARE MODE", "SELECT * FROM mysql.user", "SELECT * FROM `mysql`.`user`",
        "SELECT 1 /*! INTO OUTFILE '/tmp/x' */", "SELECT * FROM t /*!50000 FOR UPDATE */", "SELECT 1 /*M!, SLEEP(9) */",
        "SELECT 1 --SLEEP(3600)", "SELECT /*+ SET_VAR(max_execution_time=0) */ 1",
    ],
)
def test_mysql_queries_refused(sql):
    with pytest.raises(QueryProblem):
        validate_query(sql, "mysql")


def test_what_runs_is_regenerated_without_comments():
    assert validate_query("SELECT id FROM orders -- recent\n;", "postgres") == "SELECT id FROM orders"
    assert "secret" not in validate_query("SELECT /* secret */ 1", "mysql")


@pytest.mark.parametrize(
    "kind,sql",
    [
        ("postgres", "SELECT a::int, b->>'x' FROM t WHERE c ILIKE '%x%' AND d > now() - interval '1 day'"),
        ("postgres", "SELECT pg_typeof(a), ' :not_a_param' FROM public.t"),
        ("mysql", "SELECT `a`, DATE_FORMAT(d, '%Y-%m') FROM `t` WHERE d > NOW() - INTERVAL 1 DAY"),
        ("mysql", "SELECT a FROM t UNION ALL SELECT b FROM u"),
    ],
)
def test_ordinary_analytics_queries_are_kept(kind, sql):
    assert validate_query(sql, kind)


def _sqlite_session(rows_sql):
    engine = create_engine("sqlite://")
    from contextlib import contextmanager

    @contextmanager
    def fake(_spec):
        with engine.connect() as conn:
            conn.exec_driver_sql(rows_sql)
            yield conn

    return fake


def test_extract_reads_without_pandas_read_sql(monkeypatch):
    """pandas.read_sql rejects our pinned SQLAlchemy; this failed for every real sync."""
    monkeypatch.setattr(extract_module, "session", _sqlite_session("CREATE TEMP TABLE t AS SELECT 1 AS a, 'x:y%' AS b"))
    frame = extract(MY_SPEC, query="SELECT a, b FROM t")
    assert frame.to_dict("records") == [{"a": 1, "b": "x:y%"}]


def test_extract_enforces_the_row_cap(monkeypatch):
    monkeypatch.setattr(extract_module, "session", _sqlite_session("CREATE TEMP TABLE t AS SELECT 1 AS a UNION ALL SELECT 2 UNION ALL SELECT 3"))
    with pytest.raises(QueryProblem, match="more than 2 rows"):
        extract(MY_SPEC, query="SELECT a FROM t", max_rows=2)


def test_extract_stops_at_the_deadline(monkeypatch):
    monkeypatch.setattr(extract_module, "session", _sqlite_session("CREATE TEMP TABLE t AS SELECT 1 AS a"))
    monkeypatch.setattr(extract_module, "READ_DEADLINE_SECONDS", -1)
    with pytest.raises(QueryProblem, match="took longer"):
        extract(MY_SPEC, query="SELECT a FROM t")


# ---------- passwords ----------


def test_passwords_stay_out_of_reprs():
    secret = "hunter2-secret"
    fields = {k: v for k, v in PG.items()}
    assert secret not in repr(SPEC)
    assert secret not in repr(ConnectionIn(**fields, name="n", password=secret))
    assert secret not in repr(ConnectionTestIn(**fields, password=secret))
    assert secret not in repr(ConnectionPatch(password=secret))


def test_invalid_connections_key_is_refused_without_echoing_it():
    with pytest.raises(ValueError) as e:
        Settings(connections_key="my-secret-but-invalid")
    assert "Fernet" in str(e.value) and "my-secret-but-invalid" not in str(e.value)


@pytest.mark.parametrize(
    "change",
    [{"host": "attacker.example.com"}, {"port": 6543}, {"kind": "mysql"}, {"ssl_mode": "disable"}],
)
def test_test_endpoint_never_sends_a_saved_password_elsewhere(client, engine, fake_db, change):
    sign_in(client, engine)
    conn = connect(client).json()
    fake_db["calls"].clear()
    r = client.post("/connections/test", json={**PG, **change, "password": "", "connection_id": conn["id"]})
    assert r.status_code == 200 and r.json()["ok"] is False and "password again" in r.json()["message"]
    assert fake_db["calls"] == []


def test_test_endpoint_can_reuse_the_password_for_the_same_server(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    body = {**PG, "database": "other", "username": "other", "ssl_mode": "verify-full", "password": "", "connection_id": conn["id"]}
    assert client.post("/connections/test", json=body).json()["ok"] is True
    assert fake_db["calls"][-1].password == "s3cret"


def test_test_endpoint_needs_a_password_without_a_saved_connection(client, engine, fake_db):
    sign_in(client, engine)
    assert client.post("/connections/test", json={**PG, "password": ""}).json()["ok"] is False
    assert fake_db["calls"] == []


@pytest.mark.parametrize("change", [{"host": "attacker.example.com"}, {"port": 6543}, {"ssl_mode": "disable"}])
def test_update_never_sends_a_saved_password_elsewhere(client, engine, fake_db, change):
    sign_in(client, engine)
    conn = connect(client).json()
    fake_db["calls"].clear()
    r = client.patch(f"/connections/{conn['id']}", json=change)
    assert r.status_code == 422 and "password again" in r.json()["detail"] and fake_db["calls"] == []
    assert client.patch(f"/connections/{conn['id']}", json={**change, "password": "s3cret"}).status_code == 200


def test_rotating_a_password_repairs_a_failing_connection(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    with Session(engine) as s:
        row = s.get(Connection, conn["id"])
        row.status, row.last_error = "error", "The username or password was rejected."
        s.commit()
    fixed = client.patch(f"/connections/{conn['id']}", json={"password": "s3cret", "name": "Renamed", "host": None}).json()
    assert fixed["status"] == "ok" and fixed["last_error"] is None and fixed["name"] == "Renamed" and fixed["host"] == PG["host"]


def test_viewers_cannot_see_the_database_behind_a_connection(client, engine, fake_db):
    sign_in(client, engine)
    conn = connect(client).json()
    with Session(engine) as s:
        s.query(WorkspaceMember).first().role = "viewer"
        s.commit()
    assert client.get("/connections").status_code == 403
    assert client.get(f"/connections/{conn['id']}/tables").status_code == 403
    assert client.get(f"/connections/{conn['id']}/preview", params={"table": "public.orders"}).status_code == 403


# ---------- hosts and TLS ----------


@pytest.mark.parametrize("host", ["a" * 70 + ".example.com", "x..y", ".", "db\x00.example.com"])
def test_malformed_hosts_are_a_friendly_error(host):
    with pytest.raises(ConnectorError):
        resolve_public(host)


@pytest.mark.parametrize("host", ["::ffff:127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "100.64.0.1", "fd00:ec2::254", "169.254.170.2", "0.0.0.0"])
def test_disguised_private_addresses_are_refused(host):
    with pytest.raises(ConnectorError, match="private network"):
        resolve_public(host)


def test_one_private_address_among_public_ones_is_refused(monkeypatch):
    infos = [(0, 0, 0, "", ("8.8.8.8", 0)), (0, 0, 0, "", ("10.0.0.5", 0))]
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: infos)
    with pytest.raises(ConnectorError, match="private network"):
        resolve_public("rebind.example.com")


def test_ipv4_is_preferred(monkeypatch):
    infos = [(0, 0, 0, "", ("2001:4860:4860::8888", 0, 0, 0)), (0, 0, 0, "", ("8.8.8.8", 0))]
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: infos)
    assert resolve_public("dns.example.com") == "8.8.8.8"


def test_mysql_system_databases_are_refused():
    with pytest.raises(ConnectorError, match="system database"):
        ConnSpec("mysql", "db.example.com", 3306, "mysql", "root", "pw")


def _mysql_greeting_without_tls() -> bytes:
    caps = 0x0008_8200  # protocol 41, secure connection, plugin auth; no SSL bit
    body = (
        b"\x0a8.0.0\x00" + struct.pack("<I", 1) + b"12345678\x00" + struct.pack("<H", caps & 0xFFFF)
        + b"\x21" + struct.pack("<H", 2) + struct.pack("<H", caps >> 16) + b"\x15" + b"\x00" * 10
        + b"123456789012\x00" + b"mysql_native_password\x00"
    )
    return struct.pack("<I", len(body))[:3] + b"\x00" + body


def test_mysql_refuses_a_server_without_tls_before_sending_credentials(monkeypatch):
    monkeypatch.setattr(get_settings(), "connections_allow_private", True)
    server = socket.create_server(("127.0.0.1", 0))
    received: list[bytes] = []

    def serve():
        client, _ = server.accept()
        client.settimeout(3)
        client.sendall(_mysql_greeting_without_tls())
        try:
            received.append(client.recv(4096))
        except OSError:
            received.append(b"")
        client.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    spec = ConnSpec("mysql", "127.0.0.1", server.getsockname()[1], "shop", "reader", "hunter2-secret", "require")
    with pytest.raises(ConnectorError, match="doesn't offer SSL"):
        with session(spec):
            pass
    thread.join(5)
    server.close()
    assert received == [b""]  # closed without a login packet


# ---------- error messages ----------


def _pg_error(message, sqlstate=None):
    orig = Exception(message)
    orig.sqlstate = sqlstate
    return OperationalError("stmt", {}, orig)


def _my_error(errno, message):
    return OperationalError("stmt", {}, pymysql.err.OperationalError(errno, message))


@pytest.mark.parametrize(
    "error,expected",
    [
        (_pg_error("canceling statement due to statement timeout", "57014"), "longer than 60 seconds"),
        (_pg_error('column "ssl_flag" does not exist', "42703"), "column that doesn't exist"),
        (_pg_error('relation "database_x" does not exist', "42P01"), "table doesn't exist"),
        (_pg_error("permission denied for table timeouts", "42501"), "isn't allowed to read"),
        (_pg_error('FATAL: password authentication failed for user "russell"'), "username or password"),
        (_pg_error('FATAL: role "ssl_user" does not exist'), "username or password"),
        (_pg_error('FATAL: database "nope" does not exist'), "no database called"),
        (_pg_error('no pg_hba.conf entry for host "1.2.3.4", user "russell", database "shop", no encryption'), "doesn't accept connections"),
        (_pg_error("server does not support SSL, but SSL was required"), "doesn't offer SSL"),
        (_pg_error("connection timeout expired"), "in time"),
        (_my_error(1045, "Access denied for user 'r'@'h'"), "username or password"),
        (_my_error(3024, "Query execution was interrupted, maximum statement execution time exceeded"), "longer than 60 seconds"),
        (_my_error(2003, "Can't connect to MySQL server on 'ssl.example.com' (timed out)"), "in time"),
        (_my_error(2003, "Can't connect to MySQL server on 'x' ([Errno 111] Connection refused)"), "refused the connection"),
        (_my_error(2003, "Can't connect to MySQL server on 'x' ([SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed)"), "SSL connection failed"),
        (_my_error(1060, "Duplicate column name 'id'"), "same name"),
    ],
)
def test_errors_get_the_right_message(error, expected):
    assert expected in friendly_error(error, SPEC)


def test_unknown_driver_errors_never_echo_the_password():
    message = friendly_error(_pg_error("strange failure near hunter2-secret\nDETAIL: more"), SPEC)
    assert "hunter2-secret" not in message and "DETAIL" not in message
    assert "hunter2-secret" not in friendly_error(_my_error(9999, "strange hunter2-secret"), MY_SPEC)


# ---------- sync failures and schedule ----------


def _synced(client, engine, refresh="hourly"):
    conn = connect(client).json()
    made = client.post(f"/connections/{conn['id']}/datasets", json={"tables": ["public.orders"], "refresh": refresh}).json()
    return made["datasets"][0]["id"]


def _utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def test_a_failed_sync_is_not_reported_as_synced(client, engine, fake_db):
    sign_in(client, engine)
    ds_id = _synced(client, engine)
    before = client.get(f"/datasets/{ds_id}").json()
    fake_db["state"]["fail"] = "The username or password was rejected."
    with Session(engine) as s, pytest.raises(SyncError):
        sync_dataset(s, s.get(Dataset, ds_id))
    after = client.get(f"/datasets/{ds_id}").json()
    assert after["last_synced_at"] == before["last_synced_at"]
    assert after["sync_finished_at"] != before["sync_finished_at"] and after["sync_error"]


@pytest.mark.parametrize("refresh", ["hourly", "daily"])
def test_failed_syncs_retry_after_an_hour(client, engine, fake_db, refresh):
    sign_in(client, engine)
    ds_id = _synced(client, engine, refresh)
    fake_db["state"]["fail"] = "Couldn't reach the database."
    with Session(engine) as s:
        ds = s.get(Dataset, ds_id)
        attempt = _utc(ds.last_synced_at) + (timedelta(hours=1) if refresh == "hourly" else timedelta(days=1))
        assert jobs.tick(s, attempt + timedelta(minutes=1))["datasets_synced"] == 1
        s.refresh(ds)
        assert ds.sync_error
        retry = _utc(ds.sync_started_at) + RETRY_AFTER
        assert _utc(next_sync_at(ds)) == retry
        assert jobs.tick(s, retry - timedelta(minutes=1))["datasets_synced"] == 0
        fake_db["state"]["fail"] = None
        assert jobs.tick(s, retry + timedelta(minutes=1))["datasets_synced"] == 1
        s.refresh(ds)
        assert ds.sync_error is None


def test_a_lost_job_does_not_stop_syncing_forever(client, engine, fake_db):
    sign_in(client, engine)
    ds_id = _synced(client, engine)
    lost: list[str] = []
    with Session(engine) as s:
        due = _utc(s.get(Dataset, ds_id).last_synced_at) + timedelta(hours=1)
        assert jobs.tick(s, due + timedelta(minutes=1), enqueue=lost.append)["datasets_synced"] == 1  # never runs
        assert jobs.tick(s, due + timedelta(minutes=2), enqueue=lost.append)["skipped"] == 1  # still claimed
        assert jobs.tick(s, due + RETRY_AFTER + timedelta(minutes=1), enqueue=lost.append)["datasets_synced"] == 1
        assert s.query(JobRun).filter(JobRun.kind == "sync").count() == 2


def test_sync_slot_is_stable_within_the_retry_window():
    from datetime import datetime

    due = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert sync_slot(due, due + timedelta(minutes=59)) == due
    assert sync_slot(due, due + timedelta(minutes=61)) == due + RETRY_AFTER


def test_a_bad_table_does_not_mark_the_connection_broken(client, engine, fake_db, monkeypatch):
    sign_in(client, engine)
    ds_id = _synced(client, engine)

    def fails(*_a, **_k):
        raise QueryProblem("The query names a column that doesn't exist.")

    monkeypatch.setattr("app.sync.extract", fails)
    with Session(engine) as s, pytest.raises(SyncError):
        sync_dataset(s, s.get(Dataset, ds_id))
    assert client.get("/connections").json()[0]["status"] == "ok"
    assert "column" in client.get(f"/datasets/{ds_id}").json()["sync_error"]


def test_an_internal_failure_is_recorded_and_re_raised(client, engine, fake_db, monkeypatch):
    ws = sign_in(client, engine)
    ds_id = _synced(client, engine)

    def disk_full(*_a, **_k):
        raise OSError("No space left: /data/secret/path")

    monkeypatch.setattr("app.sync.write_parquet", disk_full)
    with Session(engine) as s, pytest.raises(OSError):
        sync_dataset(s, s.get(Dataset, ds_id))
    after = client.get(f"/datasets/{ds_id}").json()
    assert after["sync_error"] == INTERNAL_FAILURE and after["row_count"] == 3
    assert len(pd.read_parquet(parquet_path(ws, ds_id))) == 3


def test_refresh_now_does_not_start_a_second_sync(client, engine, fake_db):
    from datetime import datetime

    sign_in(client, engine)
    ds_id = _synced(client, engine)
    with Session(engine) as s:
        s.get(Dataset, ds_id).sync_started_at = datetime.now(timezone.utc)
        s.commit()
        before = s.query(JobRun).count()
        assert sync_in_progress(s.get(Dataset, ds_id))
    assert client.post(f"/datasets/{ds_id}/sync").status_code == 202
    with Session(engine) as s:
        assert s.query(JobRun).count() == before


def test_a_crashed_sync_stops_counting_as_running():
    from datetime import datetime

    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert not sync_in_progress(Dataset(sync_started_at=now - timedelta(minutes=7)), now)
    assert sync_in_progress(Dataset(sync_started_at=now - timedelta(minutes=1)), now)


def test_infinite_numbers_become_empty(monkeypatch):
    from decimal import Decimal

    from app.ingest import profile_frame

    frame = profile_frame(pd.DataFrame({"n": [Decimal("1.5"), Decimal("Infinity"), Decimal("NaN")]})).frame
    assert frame["n"].iloc[0] == 1.5 and frame["n"].isna().sum() == 2


def test_migrations_have_one_head():
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "migrations"))
    assert len(ScriptDirectory.from_config(config).get_heads()) == 1
