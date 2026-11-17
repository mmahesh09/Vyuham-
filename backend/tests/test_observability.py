"""OpenTelemetry instrumentation: what is traced, what is never recorded, and that telemetry can't break the app.

Spans and metrics go to in-memory exporters in this process (no network). The request-level tests
instrument the FastAPI app for this module only and remove the instrumentation afterwards.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from opentelemetry import metrics, trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from app import telemetry
from app.main import app
from tests.conftest import add_user

ROOT = Path(__file__).resolve().parents[2]
MARKER = "SECRET-MARKER-7f3a"  # a customer value that must never appear in telemetry
_EXPORTER = InMemorySpanExporter()
_READER = InMemoryMetricReader()
_installed = False


class _SwitchableProcessor(SimpleSpanProcessor):
    """OpenTelemetry's global provider can't be removed, so recording is switched off after this module:
    otherwise every later test would keep collecting spans in memory."""

    active = True

    def on_end(self, span):
        if self.active:
            super().on_end(span)


_PROCESSOR = _SwitchableProcessor(telemetry.ScrubbingSpanExporter(_EXPORTER))


@pytest.fixture(scope="module")
def otel():
    """Install in-memory providers once per process (OpenTelemetry's globals can only be set once)."""
    global _installed
    if not _installed:
        provider = TracerProvider()
        provider.add_span_processor(_PROCESSOR)
        trace.set_tracer_provider(provider)
        metrics.set_meter_provider(MeterProvider(metric_readers=[_READER]))
        _installed = True
    _PROCESSOR.active = True
    FastAPIInstrumentor.instrument_app(app, excluded_urls="health/live,health/ready")
    app.middleware_stack = None  # rebuilt on the next request, now with the tracing middleware
    yield _EXPORTER
    FastAPIInstrumentor.uninstrument_app(app)
    app.middleware_stack = None
    _PROCESSOR.active = False
    _EXPORTER.clear()


@pytest.fixture
def spans(otel):
    otel.clear()
    return otel


def _all_text(span_list) -> str:
    """Every attribute and event value of every span, as one string to search for leaks."""
    parts = []
    for s in span_list:
        parts.append(s.name)
        parts.extend(f"{k}={v}" for k, v in (s.attributes or {}).items())
        for e in s.events:
            parts.extend(f"{k}={v}" for k, v in (e.attributes or {}).items())
    return "\n".join(parts)


def _metric_points(name: str) -> list:
    data = _READER.get_metrics_data()
    points = []
    for rm in data.resource_metrics if data else []:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                if m.name == name:
                    points.extend(m.data.data_points)
    return points


def sign_in(client, engine):
    client.cookies.set("better-auth.session_token", add_user(engine))
    return client.get("/me").json()["workspace"]["id"]


def upload(client, data: bytes, name: str = "sales.csv"):
    r = client.post("/datasets", files={"file": (name, data, "text/csv")})
    assert r.status_code == 201, r.text
    return r.json()


SALES = f"Client,Amount,Day\nAcme,100,2026-10-01\n{MARKER},250,2026-10-02\nBolt,75,2026-11-03\n".encode()


# 1. Successful requests generate traces
def test_successful_request_has_a_server_span(client, engine, spans):
    sign_in(client, engine)
    spans.clear()
    assert client.get("/datasets").status_code == 200
    server = [s for s in spans.get_finished_spans() if s.kind == trace.SpanKind.SERVER]
    assert server, [s.name for s in spans.get_finished_spans()]
    attrs = server[-1].attributes
    assert attrs.get("http.route") == "/datasets"
    assert attrs.get("http.response.status_code", attrs.get("http.status_code")) == 200


# 2. Failed requests generate error information
def test_unhandled_error_is_recorded_with_a_trace_id(client, engine, spans):
    from fastapi.testclient import TestClient

    # Built at runtime, like real customer data: the source line itself holds no secret.
    email, secret = "asha" + "@example.com", "hunter" + "2"
    message = f"broke while emailing {email} with password={secret}"

    @app.get("/__boom")
    def boom():
        raise RuntimeError(message)

    try:
        with TestClient(app, raise_server_exceptions=False) as c:
            r = c.get("/__boom")
    finally:
        app.router.routes = [rt for rt in app.router.routes if getattr(rt, "path", None) != "/__boom"]
        app.middleware_stack = None
    assert r.status_code == 500
    body = r.json()
    assert body["error_ref"] and len(body["trace_id"]) == 32
    server = [s for s in spans.get_finished_spans() if s.kind == trace.SpanKind.SERVER][-1]
    assert format(server.context.trace_id, "032x") == body["trace_id"]
    assert server.status.status_code == StatusCode.ERROR
    assert server.attributes.get("vyuham.error.category") == "bug"
    text = _all_text([server])
    assert "RuntimeError" in text
    assert "asha@example.com" not in text and "hunter2" not in text  # scrubbed
    assert any(p.attributes.get("category") == "bug" for p in _metric_points("vyuham.errors"))


# 3. Database operations generate spans (app database, no parameter values)
def test_app_database_queries_are_traced_without_values(client, engine, spans):
    SQLAlchemyInstrumentor().instrument(engine=engine)
    try:
        sign_in(client, engine)
        spans.clear()
        client.patch("/datasets/does-not-exist", json={"name": MARKER})
    finally:
        SQLAlchemyInstrumentor().uninstrument()
    db_spans = [s for s in spans.get_finished_spans() if (s.attributes or {}).get("db.system")]
    assert db_spans, "expected SQLAlchemy spans"
    assert MARKER not in _all_text(db_spans)


# 4. SQL execution is traced without exposing the query or its values
def test_queries_are_traced_without_sql_or_values(client, engine, spans):
    sign_in(client, engine)
    upload(client, SALES)
    spans.clear()
    r = client.post("/sql/run", json={"sql": f"SELECT Client, Amount FROM sales WHERE Client = '{MARKER}'"})
    assert r.status_code == 200, r.text
    assert r.json()["rows"][0]["Client"] == MARKER  # the query really returned the secret row
    queries = [s for s in spans.get_finished_spans() if s.name == "vyuham.query"]
    assert queries and queries[0].attributes["vyuham.query.op"] == "sql"
    assert queries[0].attributes["vyuham.query.rows"] == 1
    text = _all_text(spans.get_finished_spans())
    assert MARKER not in text
    assert "SELECT" not in text and "WHERE" not in text
    assert _metric_points("vyuham.query.duration")


# 5. Background jobs generate telemetry
def test_jobs_are_traced_and_counted(client, engine, spans):
    from datetime import datetime, timezone

    from sqlalchemy.orm import Session

    from app import jobs
    from app.models import Alert

    ws = sign_in(client, engine)
    ds = upload(client, SALES)
    with Session(engine) as s:
        s.add(Alert(
            workspace_id=ws, dataset_id=ds["id"], name="Sales check", metric={"field": "Amount", "agg": "sum"},
            condition="above", threshold=1, schedule="hourly", enabled=True,
        ))
        s.commit()
        spans.clear()
        jobs.tick(s, datetime.now(timezone.utc))
    job_spans = [s for s in spans.get_finished_spans() if s.name == "vyuham.job"]
    assert job_spans and job_spans[0].attributes["vyuham.job.kind"] == "alert"
    assert job_spans[0].attributes["vyuham.job.status"] in ("done", "failed")
    assert any(p.attributes.get("kind") == "alert" for p in _metric_points("vyuham.jobs"))


# 6. "AI" operations (Ask's question parser and insights) generate traces
def test_ask_is_traced_without_the_question(client, engine, spans):
    sign_in(client, engine)
    upload(client, SALES)
    spans.clear()
    question = f"total amount by client {MARKER}"
    client.post("/ask", json={"question": question})
    parse = [s for s in spans.get_finished_spans() if s.name == "vyuham.ask.parse"]
    assert parse and "vyuham.ask.matched" in parse[0].attributes
    text = _all_text(spans.get_finished_spans())
    assert MARKER not in text and question not in text


# 7. Dashboard generation generates traces
def test_dashboard_view_has_chart_and_query_spans(client, engine, spans):
    sign_in(client, engine)
    ds = upload(client, SALES)
    starter = client.post(f"/datasets/{ds['id']}/starter-dashboard")
    assert starter.status_code == 201, starter.text
    spans.clear()
    assert client.get(f"/dashboards/{starter.json()['id']}/view").status_code == 200
    finished = spans.get_finished_spans()
    view = [s for s in finished if s.name == "vyuham.dashboard.view"]
    assert view and view[0].attributes["vyuham.dashboard.charts"] > 0
    view_id = view[0].context.span_id
    insights = [s for s in finished if s.name == "vyuham.insights" and s.parent and s.parent.span_id == view_id]
    assert insights, "chart insights should be children of the dashboard view"
    assert any(s.name == "vyuham.query" and s.parent and s.parent.span_id in {i.context.span_id for i in insights} for s in finished)
    assert MARKER not in _all_text(finished)


# 8. Trace ids are continued across services
def test_incoming_trace_context_is_continued(client, engine, spans):
    sign_in(client, engine)
    spans.clear()
    trace_id = "4bf92f3577b34da6a3ce929d0e0e4736"
    client.get("/datasets", headers={"traceparent": f"00-{trace_id}-00f067aa0ba902b7-01"})
    server = [s for s in spans.get_finished_spans() if s.kind == trace.SpanKind.SERVER][-1]
    assert format(server.context.trace_id, "032x") == trace_id


# 9. The Collector config is complete: receivers, redaction, sampling, three backends
def test_collector_config_wires_every_signal():
    cfg = yaml.safe_load((ROOT / "deploy" / "otel-collector.yaml").read_text(encoding="utf-8"))
    pipelines = cfg["service"]["pipelines"]
    assert set(pipelines) >= {"traces", "metrics", "logs"}
    for name in ("traces", "metrics", "logs"):
        p = pipelines[name]
        assert {"otlp/internal", "otlp/public"} <= set(p["receivers"])
        assert p["processors"][0] == "memory_limiter" and p["processors"][-1] == "batch"
        assert "attributes/redact" in p["processors"]
    assert "tail_sampling" in pipelines["traces"]["processors"]
    assert pipelines["traces"]["exporters"] == ["otlp/tempo"]
    assert pipelines["metrics"]["exporters"] == ["otlphttp/prometheus"]
    assert pipelines["logs"]["exporters"] == ["otlphttp/loki"]
    assert cfg["receivers"]["otlp/public"]["protocols"]["http"]["auth"]["authenticator"] == "bearertokenauth"
    deleted = {a.get("key") for a in cfg["processors"]["attributes/redact"]["actions"] if a["action"] == "delete"}
    assert {"http.request.header.authorization", "http.request.header.cookie", "url.query"} <= deleted
    policies = {p["type"] for p in cfg["processors"]["tail_sampling"]["policies"]}
    assert {"status_code", "latency", "probabilistic"} <= policies


# 10. Telemetry failures never break the app
def test_setup_failure_is_ignored(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9")
    monkeypatch.setattr(telemetry, "_started", False)

    def broken(_name):
        raise RuntimeError("collector config is wrong")

    monkeypatch.setattr(telemetry, "_start_providers", broken)
    assert telemetry.setup_telemetry("vyuham-test") is False


def test_unreachable_collector_does_not_break_requests(tmp_path):
    # A fresh process with real exporters pointed at a closed port.
    script = (
        "from fastapi.testclient import TestClient\n"
        "from opentelemetry import trace\n"
        "from app.main import app\n"
        "r = TestClient(app).get('/health/live')\n"
        "assert r.status_code == 200, r.status_code\n"
        "r = TestClient(app).get('/', follow_redirects=False)\n"
        "assert r.status_code < 500, r.status_code\n"
        "trace.get_tracer_provider().force_flush(2000)\n"
        "print('ok')\n"
    )
    env = {
        **os.environ,
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:9",
        "OTEL_EXPORTER_OTLP_TIMEOUT": "1",  # seconds in the Python exporter (not ms, despite the spec)
        "DATABASE_URL": f"sqlite:///{tmp_path / 'otel.db'}",
        "SCHEDULER_ENABLED": "false",
        "REDIS_URL": "",
    }
    done = subprocess.run([sys.executable, "-c", script], env=env, cwd=ROOT / "backend", capture_output=True, text=True, timeout=90)
    assert done.returncode == 0, done.stderr
    assert "ok" in done.stdout


def test_scrub_removes_credentials_and_emails():
    text = telemetry.scrub("postgres://admin:s3cret@db.example.com/x failed for bo@acme.io token=abc123 password: hunter2")
    assert "s3cret" not in text and "bo@acme.io" not in text and "abc123" not in text and "hunter2" not in text


def test_errors_are_classified():
    from fastapi import HTTPException

    from app.query import QueryError

    assert telemetry.classify(QueryError("bad column")) == "user"
    assert telemetry.classify(HTTPException(404)) == "user"
    assert telemetry.classify(TimeoutError()) == "dependency"
    assert telemetry.classify(KeyError("x")) == "bug"


def test_observability_stack_is_opt_in_and_bounded():
    compose = yaml.safe_load((ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8"))
    stack = {"otel-collector", "tempo", "prometheus", "loki", "grafana"}
    services = compose["services"]
    assert stack <= set(services)
    for name in stack:
        assert services[name].get("profiles") == ["observability"], name  # nothing starts without --profile
        assert services[name].get("mem_limit"), name
        assert ":" in services[name]["image"] and not services[name]["image"].endswith(":latest"), name
    for name in ("backend", "worker", "beat", "caddy", "redis"):
        assert not services[name].get("profiles"), name  # the app itself is unchanged
    grafana = services["grafana"]
    assert grafana["environment"]["GF_AUTH_ANONYMOUS_ENABLED"] == "false"
    assert "GF_SECURITY_ADMIN_PASSWORD" in " ".join(grafana["entrypoint"])  # refuses to start without a password
    caddy = (ROOT / "deploy" / "Caddyfile").read_text(encoding="utf-8")
    assert "otel-collector:4319" in caddy and 'not header Authorization "Bearer "' in caddy
    assert "grafana:3000" in caddy
