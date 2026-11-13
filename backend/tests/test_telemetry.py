"""Tracing is off by default, and sends OTLP traces when an endpoint is set."""

import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from app.telemetry import enabled, setup_telemetry


def test_off_without_an_endpoint(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", raising=False)
    assert not enabled()
    assert setup_telemetry("test") is False


class _Collector(BaseHTTPRequestHandler):
    received: list[tuple[str, str, int]] = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.received.append((self.path, self.headers.get("Authorization", ""), len(body)))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):  # keep test output quiet
        pass


def test_sends_traces_when_an_endpoint_is_set(tmp_path):
    server = HTTPServer(("127.0.0.1", 0), _Collector)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    _Collector.received.clear()
    # A fresh process: OpenTelemetry's tracer provider is global and can only be set once.
    script = (
        "from fastapi.testclient import TestClient\n"
        "from opentelemetry import trace\n"
        "from app.main import app\n"
        "TestClient(app).get('/', follow_redirects=False)\n"
        "trace.get_tracer_provider().force_flush()\n"
    )
    env = {
        **os.environ,
        "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{server.server_port}/api/otel",
        "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer test-token",
        "DATABASE_URL": f"sqlite:///{tmp_path / 'otel.db'}",
        "SCHEDULER_ENABLED": "false",
        "REDIS_URL": "",
    }
    try:
        done = subprocess.run([sys.executable, "-c", script], env=env, cwd=os.path.dirname(os.path.dirname(__file__)), capture_output=True, text=True, timeout=60)
    finally:
        server.shutdown()
    assert done.returncode == 0, done.stderr
    assert any(path == "/api/otel/v1/traces" and auth == "Bearer test-token" and size > 0 for path, auth, size in _Collector.received), _Collector.received
