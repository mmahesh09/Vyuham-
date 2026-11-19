"""Regression tests from the pre-launch security audit: two companies, one server, and everything between them."""

import socket
import threading
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import jobs, ratelimit, signing
from app.config import get_settings
from app.db import Base
from app.models import Alert, Connection, Dataset, JobRun, ReportRun, WorkspaceMember
from app.notify import WebhookError, check_webhook_url
from app.query import QueryError, connect, run_sql
from tests.conftest import add_user

CSV = b"region,seller,amount\nNorth,Asha,10\nSouth,Ravi,20\n"
SECRET_CSV = b"customer,salary\nTop Secret Ltd,999\n"
COOKIE = "better-auth.session_token"


class Tenant:
    def __init__(self, client, engine, uid):
        self.client, self.uid = client, uid
        self.cookie = add_user(engine, uid, token=f"tok-{uid}", company=f"Company {uid}")
        self.workspace = self.get("/me").json()["workspace"]["id"]

    def _use(self):
        self.client.cookies.clear()
        self.client.cookies.set(COOKIE, self.cookie)
        return self.client

    def get(self, path, **kw):
        return self._use().get(path, **kw)

    def post(self, path, **kw):
        return self._use().post(path, **kw)

    def request(self, method, path, **kw):
        return self._use().request(method, path, **kw)

    def upload(self, data=CSV, name="sales.csv"):
        r = self.post("/datasets", files={"file": (name, data, "text/csv")})
        assert r.status_code == 201, r.text
        return r.json()


def join(owner, engine, uid, role):
    member = Tenant(owner.client, engine, uid)
    token = owner.post("/workspace/invites", json={"role": role}).json()["token"]
    assert member.post(f"/invites/{token}/accept").status_code == 200
    return member


@pytest.fixture
def world(client, engine):
    """Company A with data of every kind; company B is the other customer on the same server."""
    a, b = Tenant(client, engine, "alpha"), Tenant(client, engine, "bravo")
    ds = a.upload(SECRET_CSV, "payroll.csv")
    spec = {"dataset": ds["id"], "title": "Pay", "chartType": "bar", "groupBy": "customer", "metrics": [{"field": "salary", "agg": "sum"}]}
    dash = a.post("/dashboards", json={"name": "Payroll"}).json()
    chart = a.post(f"/dashboards/{dash['id']}/charts", json={"spec": spec}).json()
    query = a.post("/sql/saved", json={"name": "Pay", "sql": "SELECT * FROM payroll"}).json()
    task = a.post("/tasks", json={"title": "Private task"}).json()
    channels = {"inapp": True, "emails": [], "webhook": None}
    alert = a.post("/alerts", json={
        "name": "High pay", "dataset_id": ds["id"], "metric": {"field": "salary", "agg": "sum"},
        "condition": "above", "threshold": 1, "channels": channels,
    }).json()
    report = a.post("/reports", json={"name": "R", "source": "dataset", "source_id": ds["id"], "format": "csv"}).json()
    run = a.post("/exports", json={"source": "dataset", "source_id": ds["id"], "format": "csv"}).json()
    metric = a.post("/metrics", json={"name": "Total pay", "dataset_id": ds["id"], "formula": "SUM(salary)"}).json()
    column = a.post("/calculated-columns", json={"dataset_id": ds["id"], "name": "Double", "formula": "salary * 2"}).json()
    dimension = a.post("/dimensions", json={"name": "Client", "dataset_id": ds["id"], "column": "customer"}).json()
    metric_test = a.post(f"/metrics/{metric['id']}/tests", json={"name": "t", "expected": 999}).json()
    ids = {
        "metric": metric["id"], "column": column["id"], "dimension": dimension["id"], "metric_test": metric_test["id"],
        "dataset": ds["id"], "dashboard": dash["id"], "chart": chart["id"], "query": query["id"], "task": task["id"],
        "alert": alert["id"], "report": report["id"], "run": run["id"],
    }
    assert all(ids.values())
    return a, b, ids, spec


# ---------- tenant isolation ----------


def test_every_route_with_an_id_refuses_the_other_company(world, client):
    """Walk the whole API: company B calls each route that takes an id, using company A's ids."""
    a, b, ids, _ = world
    by_param = {
        "dataset_id": ids["dataset"], "dashboard_id": ids["dashboard"], "chart_id": ids["chart"], "qid": ids["query"],
        "task_id": ids["task"], "rid": ids["report"], "run_id": ids["run"], "connection_id": "x", "ticket_id": "x",
        "column": "salary", "template_id": "sales",
        "metric_id": ids["metric"], "column_id": ids["column"], "dimension_id": ids["dimension"], "test_id": ids["metric_test"],
    }
    seen, leaks = 0, []
    for path, methods in client.get("/openapi.json").json()["paths"].items():
        if "{" not in path or path.startswith(("/support/admin", "/kb/admin", "/status/admin", "/public", "/print", "/report-files", "/invites")):
            continue
        for method in methods:
            url = path
            for name, value in by_param.items():
                url = url.replace("{" + name + "}", value)
            if "/alerts/{aid}" in url:
                url = url.replace("{aid}", ids["alert"])
            if "{" in url or url.startswith("/templates") or url.startswith("/workspace/"):
                continue
            seen += 1
            r = b.request(method.upper(), url, json={})
            if r.status_code < 400 or "Top Secret" in r.text:
                leaks.append((method, url, r.status_code))
    assert seen > 30
    assert leaks == []
    assert a.get(f"/datasets/{ids['dataset']}").status_code == 200  # company A still sees its own


def test_foreign_ids_in_request_bodies_are_refused(world):
    _, b, ids, spec = world
    own = b.post("/dashboards", json={"name": "Mine"}).json()
    own_ds = b.upload()
    attempts = [
        ("POST", f"/dashboards/{own['id']}/charts", {"spec": spec}),
        ("POST", "/charts/preview", {"spec": spec}),
        ("POST", "/tasks", {"title": "x", "dataset_id": ids["dataset"]}),
        ("POST", "/tasks", {"title": "x", "dashboard_id": ids["dashboard"]}),
        ("POST", "/exports", {"source": "dataset", "source_id": ids["dataset"], "format": "csv"}),
        ("POST", "/exports", {"source": "dashboard", "source_id": ids["dashboard"], "format": "csv"}),
        ("POST", "/exports", {"source": "saved_query", "source_id": ids["query"], "format": "csv"}),
        ("POST", "/reports", {"name": "x", "source": "dataset", "source_id": ids["dataset"], "format": "csv"}),
        ("PUT", f"/dashboards/{own['id']}/order", {"chart_ids": [ids["chart"]]}),
        ("PUT", "/tasks/order", {"status": "todo", "task_ids": [ids["task"]]}),
        ("POST", "/alerts", {"name": "x", "dataset_id": ids["dataset"], "metric": {"field": "salary", "agg": "sum"}, "condition": "above", "threshold": 1}),
    ]
    results = [(m, u, b.request(m, u, json=body)) for m, u, body in attempts]
    assert [(m, u, r.status_code) for m, u, r in results if r.status_code < 400] == []
    assert not [u for _, u, r in results if "Top Secret" in r.text]
    answer = b.post("/ask", json={"question": "total salary", "dataset_id": ids["dataset"]})  # answers from B's own data
    assert "Top Secret" not in answer.text and own_ds["id"] != ids["dataset"]


@pytest.mark.parametrize("sql", [
    "SELECT * FROM read_parquet('{other}/*.parquet')",
    "SELECT * FROM '{other}/{ds}.parquet'",
    "SELECT * FROM read_parquet('{mine}/../{other_id}/{ds}.parquet')",
    "SELECT * FROM read_csv('{root}/../.env')",
    "SELECT * FROM read_text('{root}/*')",
    "SELECT * FROM read_blob('{other}/{ds}.parquet')",
    "SELECT * FROM glob('{root}/*')",
    "SELECT * FROM parquet_metadata('{other}/{ds}.parquet')",
    "SELECT * FROM query('SELECT * FROM read_parquet(''{other}/{ds}.parquet'')')",
])
def test_sql_cannot_reach_another_workspace(world, sql, data_dir):
    a, b, ids, _ = world
    root = str(data_dir).replace("\\", "/")
    filled = sql.format(root=root, other=f"{root}/{a.workspace}", other_id=a.workspace, mine=f"{root}/{b.workspace}", ds=ids["dataset"])
    r = b.post("/sql/run", json={"sql": filled})
    assert r.status_code == 422, r.text
    assert "Top Secret" not in r.text


@pytest.mark.parametrize("sql", [
    "COPY (SELECT 1) TO 'x.csv'", "ATTACH 'x.db'", "INSTALL httpfs", "LOAD httpfs", "SET memory_limit='8GB'",
    "PRAGMA database_list", "CREATE TABLE t(a int)", "SELECT 1; SELECT 2", "SELECT getenv('HOME')",
])
def test_sql_lab_is_select_only(world, sql):
    _, b, _, _ = world
    assert b.post("/sql/run", json={"sql": sql}).status_code == 422


def test_query_spill_to_disk_is_off(world):
    a, _, _, _ = world
    con = connect(a.workspace, [])
    try:
        rows = run_sql(con, "SELECT current_setting('temp_directory') AS t")
    finally:
        con.close()
    assert rows[0]["t"] == ""


# ---------- roles ----------


def test_viewer_cannot_download_a_sql_lab_export(world, client, engine):
    a, _, ids, _ = world
    viewer = join(a, engine, "vera", "viewer")
    run = a.post("/exports", json={"source": "saved_query", "source_id": ids["query"], "format": "csv"}).json()
    assert a.get(f"/report-runs/{run['id']}/download").status_code == 200
    assert viewer.get(f"/report-runs/{run['id']}/download").status_code == 403


def test_viewer_does_not_see_where_alerts_are_sent(world, engine, monkeypatch):
    a, _, ids, _ = world
    monkeypatch.setattr("app.routers.alerts.check_webhook_url", lambda url: None)
    hook = "https://hooks.slack.com/services/T000/B000/secret"
    body = {
        "name": "Hook", "dataset_id": ids["dataset"], "metric": {"field": "salary", "agg": "sum"}, "condition": "above",
        "threshold": 1, "channels": {"inapp": True, "emails": ["boss@acme.co"], "webhook": hook},
    }
    assert a.post("/alerts", json=body).status_code == 201
    assert hook in a.get("/alerts").text
    viewer = join(a, engine, "vera", "viewer")
    text = viewer.get("/alerts").text
    assert hook not in text and "boss@acme.co" not in text


def test_invite_sent_to_an_address_only_works_for_that_address(client, engine):
    owner, stranger = Tenant(client, engine, "own"), Tenant(client, engine, "stranger")
    token = owner.post("/workspace/invites", json={"role": "owner", "email": "someone.else@acme.co"}).json()["token"]
    assert stranger.post(f"/invites/{token}/accept").status_code == 403
    assert stranger.get("/me").json()["workspace"]["id"] != owner.workspace
    invited = Tenant(client, engine, "invited")
    token = owner.post("/workspace/invites", json={"role": "editor", "email": "INVITED@acme.co"}).json()["token"]
    assert invited.post(f"/invites/{token}/accept").status_code == 200


# ---------- deleting a company's data ----------


def test_deleting_a_workspace_removes_its_report_files_and_connections(world, engine, data_dir):
    a, _, ids, _ = world
    with Session(engine) as s:
        s.add(Connection(workspace_id=a.workspace, name="db", kind="postgres", host="db.example.com", port=5432,
                         database="d", username="u", secret_enc="x", ssl_mode="require"))
        s.commit()
    assert a.get(f"/report-runs/{ids['run']}/download").status_code == 200
    assert list((data_dir / "reports" / a.workspace).glob("*"))
    assert a.request("DELETE", "/workspace", json={"confirm": f"Company {a.uid}"}).status_code == 204
    assert not (data_dir / "reports" / a.workspace).exists()
    with Session(engine) as s:
        assert s.scalars(select(Connection).where(Connection.workspace_id == a.workspace)).all() == []
        assert s.scalars(select(ReportRun).where(ReportRun.workspace_id == a.workspace)).all() == []
        for table in Base.metadata.sorted_tables:
            if "workspace_id" in table.c:
                assert s.execute(table.select().where(table.c.workspace_id == a.workspace)).first() is None, table.name


# ---------- limits between customers ----------


def test_workspace_storage_is_capped(client, engine, monkeypatch):
    t = Tenant(client, engine, "big")
    monkeypatch.setattr(get_settings(), "max_workspace_datasets", 2)
    monkeypatch.setattr(get_settings(), "rate_limit_enabled", False)
    t.upload(name="a.csv")
    t.upload(name="b.csv")
    r = t.post("/datasets", files={"file": ("c.csv", CSV, "text/csv")})
    assert r.status_code == 409
    assert "limit" in r.json()["detail"].lower()


def test_made_up_session_cookies_do_not_get_fresh_rate_limits(client, monkeypatch):
    monkeypatch.setattr(ratelimit, "RULES", [("*", "/status", "2/minute")])
    codes = []
    for i in range(4):
        client.cookies.clear()
        client.cookies.set(COOKIE, f"invented-{i}.c2ln")
        codes.append(client.get("/status").status_code)
    assert codes[-1] == 429, codes


def test_only_a_few_queries_run_at_once(monkeypatch):
    from app import query

    assert query.QUERY_SLOTS._value <= get_settings().max_concurrent_queries
    monkeypatch.setattr(query, "QUERY_WAIT_SECONDS", 0.05)
    held = []
    while query.QUERY_SLOTS.acquire(blocking=False):
        held.append(1)
    con = connect("nobody", [])
    try:
        with pytest.raises(QueryError, match="busy"):
            run_sql(con, "SELECT 1")
    finally:
        con.close()
        for _ in held:
            query.QUERY_SLOTS.release()


class SilentPostgres:
    """Logs anyone in, then never answers a query: a customer "database" built to hang our threads."""

    def __enter__(self):
        self.server = socket.create_server(("127.0.0.1", 0))
        self.port = self.server.getsockname()[1]
        self.open = []
        threading.Thread(target=self._serve, daemon=True).start()
        return self

    def __exit__(self, *_):
        self.server.close()
        for c in self.open:
            c.close()

    def _serve(self):
        try:
            while True:
                c, _ = self.server.accept()
                self.open.append(c)
                threading.Thread(target=self._talk, args=(c,), daemon=True).start()
        except OSError:
            pass

    def _talk(self, c):
        try:
            first = c.recv(8192)
            if first[4:8] == b"\x04\xd2\x16\x2f":  # SSLRequest
                c.sendall(b"N")
                c.recv(8192)
            auth_ok = b"R\x00\x00\x00\x08\x00\x00\x00\x00"
            ready = b"Z\x00\x00\x00\x05I"
            c.sendall(auth_ok + ready)
            while c.recv(8192):  # returns empty only once our side has cut the connection
                pass
            c.close()  # Windows only wakes a blocked client when the other end closes too
        except OSError:
            pass


def test_a_database_that_never_answers_cannot_hold_a_request_forever(monkeypatch):
    from app.connectors import base
    from app.connectors.base import ConnectorError, ConnSpec
    from app.connectors.introspect import list_tables

    monkeypatch.setattr(get_settings(), "connections_allow_private", True)
    monkeypatch.setattr(base, "INTERACTIVE_DEADLINE", 1.5)
    outcome = []

    def attempt(port):
        try:
            list_tables(ConnSpec("postgres", "127.0.0.1", port, "d", "u", "p", "disable"))
            outcome.append("answered")
        except ConnectorError as e:
            outcome.append(str(e))

    with SilentPostgres() as db:
        t = threading.Thread(target=attempt, args=(db.port,), daemon=True)
        t.start()
        t.join(12)
        assert not t.is_alive(), "the request is still stuck on the silent database"
    assert outcome and outcome[0] != "answered"


def test_one_company_cannot_use_every_database_slot(world, monkeypatch):
    from app.routers import connections

    a, b, _, _ = world
    monkeypatch.setattr(connections, "PER_WORKSPACE_CONNECTOR_CALLS", 1)
    monkeypatch.setattr("app.routers.connections.list_tables", lambda spec: [])
    body = {"kind": "postgres", "host": "db.example.com", "port": 5432, "database": "d", "username": "u", "password": "p", "ssl_mode": "require"}
    slot = connections.workspace_slot(a.workspace)
    assert slot.acquire(blocking=False)
    try:
        assert a.post("/connections/test", json=body).status_code == 429
        assert b.post("/connections/test", json=body).status_code == 200
    finally:
        slot.release()


# ---------- outbound requests ----------


@pytest.mark.parametrize("address", ["100.64.0.1", "192.0.0.8", "198.18.0.1", "::ffff:169.254.169.254", "127.0.0.1", "10.0.0.1"])
def test_webhooks_only_reach_public_addresses(monkeypatch, address):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(family, socket.SOCK_STREAM, 6, "", (address, 443))])
    with pytest.raises(WebhookError):
        check_webhook_url("https://hooks.example.com/x")


def test_webhook_connects_to_the_address_it_checked(monkeypatch):
    """DNS rebinding: the name is public when checked and internal when connected to."""
    from app import notify

    answers = iter(["93.184.216.34", "127.0.0.1"])
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (next(answers), 443))])
    dialled = []

    def fake_connection(address, *a, **k):
        dialled.append(address[0])
        raise OSError("stop here")

    monkeypatch.setattr(notify.socket, "create_connection", fake_connection)
    assert notify.send_webhook("https://rebind.example.com/x", {"title": "t", "body": "b"}).startswith("failed")
    assert dialled == ["93.184.216.34"]


# ---------- signed links ----------


def test_non_ascii_token_is_a_bad_token_not_a_crash():
    with pytest.raises(signing.BadToken):
        signing.verify("download", "abc.é")


def test_non_ascii_link_gets_a_404(client):
    assert client.get("/report-files/abc.%C3%A9").status_code == 404


def test_access_logs_do_not_keep_link_tokens():
    from app.telemetry import redact_link_tokens

    assert redact_link_tokens("GET /public/dashboards/abc123/view?f=1") == "GET /public/dashboards/[token]/view?f=1"
    assert redact_link_tokens("/report-files/abc.def") == "/report-files/[token]"
    assert redact_link_tokens("/invites/abc/accept") == "/invites/[token]/accept"
    assert redact_link_tokens("/support/webhooks/glitchtip?secret=abc") == "/support/webhooks/glitchtip?secret=[token]"
    assert redact_link_tokens("/datasets/abc") == "/datasets/abc"


# ---------- background jobs ----------


def _alert(engine, workspace, dataset_id, created):
    with Session(engine) as s:
        a = Alert(workspace_id=workspace, name="a", dataset_id=dataset_id, metric={"field": "salary", "agg": "sum"},
                  filters=[], condition="above", threshold=1, schedule="hourly", channels={"inapp": True}, enabled=True, created_at=created)
        s.add(a)
        s.commit()
        return a.id


def test_a_job_lost_from_the_queue_runs_again(world, engine):
    """Redis keeps nothing across a restart: the claim stays in Postgres, the message is gone."""
    a, _, ids, _ = world
    start = datetime.now(timezone.utc) - timedelta(hours=3)
    aid = _alert(engine, a.workspace, ids["dataset"], start)
    with Session(engine, expire_on_commit=False) as s:
        for other in s.scalars(select(Alert).where(Alert.id != aid)):
            other.enabled = False
        s.commit()
        lost = []
        jobs.tick(s, now=start + timedelta(hours=1), enqueue=lost.append)
        assert len(lost) == 1
        run = s.get(JobRun, lost[0])
        run.created_at = start + timedelta(hours=1)
        s.commit()
        again = []
        jobs.tick(s, now=datetime.now(timezone.utc), enqueue=again.append)
    assert again == lost


def test_a_job_still_in_the_queue_is_not_sent_twice(world, engine):
    a, _, ids, _ = world
    start = datetime.now(timezone.utc) - timedelta(hours=3)
    aid = _alert(engine, a.workspace, ids["dataset"], start)
    with Session(engine, expire_on_commit=False) as s:
        for other in s.scalars(select(Alert).where(Alert.id != aid)):
            other.enabled = False
        s.commit()
        first, second = [], []
        now = datetime.now(timezone.utc)
        jobs.tick(s, now=now, enqueue=first.append)
        jobs.tick(s, now=now + timedelta(minutes=1), enqueue=second.append)
    assert len(first) == 1 and second == []


def test_a_report_lost_from_the_queue_is_marked_failed(world, engine):
    from app.reports import runner

    a, _, ids, _ = world
    with Session(engine, expire_on_commit=False) as s:
        run = ReportRun(workspace_id=a.workspace, name="r", source="dataset", source_id=ids["dataset"], format="csv", options={},
                        created_at=datetime.now(timezone.utc) - timedelta(hours=2))
        s.add(run)
        s.commit()
        assert runner.fail_stale(s) == 1
        s.refresh(run)
        assert run.status == "failed" and run.error


def test_membership_is_one_workspace_per_person(world, engine):
    a, b, _, _ = world
    with Session(engine) as s:
        assert len(s.scalars(select(WorkspaceMember).where(WorkspaceMember.user_id == a.uid)).all()) == 1
        assert s.scalar(select(Dataset.workspace_id).where(Dataset.workspace_id == b.workspace)) is None
