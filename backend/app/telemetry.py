"""OpenTelemetry: traces, metrics and logs, off unless OTEL_EXPORTER_OTLP_ENDPOINT is set.

With no endpoint, no exporter is started and the app behaves exactly as before; the helpers below
(`span`, `count`, `record`) are then free no-ops. With one, the API, worker and beat send OTLP over
HTTP to an OpenTelemetry Collector (deploy/otel-collector.yaml), which feeds the self-hosted Grafana
stack (Tempo, Prometheus, Loki). See docs/observability.md. Configuration is the standard OTEL_* set:

    OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318   # base URL; /v1/traces etc. are appended
    OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <token>"  # only when going through a public route
    OTEL_SERVICE_NAME=vyuham-api                              # optional; defaults per process
    OTEL_TRACES_SAMPLER=parentbased_traceidratio  OTEL_TRACES_SAMPLER_ARG=1.0
    OTEL_METRICS_EXPORTER=none                                 # turn metrics off (default: on)
    OTEL_LOGS_EXPORTER=otlp                                    # also ship log records (default: off)

What is never recorded: SQL text or values from customer data (DuckDB and customer databases), request
or response bodies, cookies, auth headers, query strings, file and column names, question text. Error
messages are scrubbed of emails and credentials. The Collector strips the same fields again.

Telemetry must never break the app: setup failures are logged and ignored, and exporting happens in
background threads with short timeouts.
"""

from __future__ import annotations

import logging
import os
import re
import time
import traceback
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from opentelemetry import metrics, trace
from opentelemetry.trace import Span, Status, StatusCode

log = logging.getLogger("app.telemetry")
_started = False

# The API's own tracer and meter. Both are proxies: no-ops until a provider is installed.
tracer = trace.get_tracer("vyuham")
meter = metrics.get_meter("vyuham")


def enabled() -> bool:
    return bool(os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"))


def _resource(service_name: str):
    from opentelemetry.sdk.resources import Resource

    from app.config import get_settings

    s = get_settings()
    attrs: dict[str, Any] = {
        "service.name": os.environ.get("OTEL_SERVICE_NAME") or service_name,
        "deployment.environment": s.environment,
    }
    if s.release:
        attrs["service.version"] = s.release
    # Resource.create also merges OTEL_RESOURCE_ATTRIBUTES from the environment.
    return Resource.create(attrs)


def _start_providers(service_name: str) -> None:
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.redis import RedisInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    from opentelemetry.instrumentation.urllib import URLLibInstrumentor
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    from app.db import engine

    resource = _resource(service_name)
    # The sampler comes from OTEL_TRACES_SAMPLER / _ARG (read by the SDK); the Collector does tail sampling.
    provider = TracerProvider(resource=resource)
    # Endpoint, headers and timeout come from OTEL_* (the timeout is in seconds for this exporter).
    provider.add_span_processor(BatchSpanProcessor(ScrubbingSpanExporter(OTLPSpanExporter())))
    trace.set_tracer_provider(provider)

    if os.environ.get("OTEL_METRICS_EXPORTER", "otlp").lower() != "none":
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader

        reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=60_000)
        metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))

    if os.environ.get("OTEL_LOGS_EXPORTER", "none").lower() == "otlp":
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

        logger_provider = LoggerProvider(resource=resource)
        logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
        set_logger_provider(logger_provider)
        level = getattr(logging, os.environ.get("OTEL_LOG_LEVEL", "WARNING").upper(), logging.WARNING)
        logging.getLogger().addHandler(LoggingHandler(level=level, logger_provider=logger_provider))

    # Only the app's own database. Customer databases (app/connectors) are never auto-instrumented,
    # so their SQL text can't end up in a span.
    SQLAlchemyInstrumentor().instrument(engine=engine)
    URLLibInstrumentor().instrument()  # email (Resend), invite checks, webhooks
    RedisInstrumentor().instrument()  # the Celery broker
    log.info("OpenTelemetry on for %s", resource.attributes.get("service.name"))


def setup_telemetry(service_name: str, *, app=None, celery: bool = False) -> bool:
    """Start telemetry for this process. Returns False (and does nothing) when no endpoint is set or setup fails."""
    global _started
    if not enabled():
        return False
    try:
        if not _started:
            _start_providers(service_name)
            _started = True
        if app is not None:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            # Health checks run every few seconds; tracing them is noise.
            FastAPIInstrumentor.instrument_app(app, excluded_urls="health/live,health/ready")
        if celery:
            from opentelemetry.instrumentation.celery import CeleryInstrumentor

            CeleryInstrumentor().instrument()
        return True
    except Exception:  # telemetry must never stop the app from starting
        log.warning("OpenTelemetry setup failed; continuing without telemetry", exc_info=True)
        return False


# ---------- logging ----------


class _TraceIdFilter(logging.Filter):
    """Adds `trace_id` to every log record (empty outside a trace), so logs and traces can be joined."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "trace_id"):
            record.trace_id = current_trace_id() or "-"
        return True


_LINK_TOKEN = re.compile(r"(/(?:public/dashboards|print/dashboards|report-files|invites)/)[^/?\s\"]+|([?&]secret=)[^&\s\"]+")


def redact_link_tokens(text: str) -> str:
    """Share links, invites and download links work without signing in, so they stay out of access logs."""
    return _LINK_TOKEN.sub(lambda m: f"{m.group(1) or m.group(2)}[token]", text)


class _AccessLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(redact_link_tokens(a) if isinstance(a, str) else a for a in record.args)
        return True


def configure_logging(level: str | None = None) -> None:
    """Give the API process a log handler (uvicorn only configures its own loggers, so app INFO logs were
    dropped). Leaves logging alone when something (e.g. Celery) already configured the root logger."""
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, _AccessLogFilter) for f in access.filters):
        access.addFilter(_AccessLogFilter())
    root = logging.getLogger()
    if root.handlers:
        for h in root.handlers:
            if not any(isinstance(f, _TraceIdFilter) for f in h.filters):
                h.addFilter(_TraceIdFilter())
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s trace=%(trace_id)s %(message)s"))
    handler.addFilter(_TraceIdFilter())
    root.addHandler(handler)
    logging.getLogger("app").setLevel((level or os.environ.get("LOG_LEVEL", "INFO")).upper())


# ---------- spans, metrics and errors ----------

USER_ERRORS = {"QueryError", "IngestError", "ConnectorError", "SyncError", "SecretError", "RequestValidationError", "ValidationError"}
DEPENDENCY_ERRORS = {
    "OperationalError", "InterfaceError", "DisconnectionError", "TimeoutError", "ConnectionError", "URLError",
    "RedisError", "timeout", "ConnectTimeout", "ReadTimeout",
}
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_URL_CREDENTIALS = re.compile(r"(\w+://)[^/\s:@]+:[^/\s@]+@")
_SECRET_PAIR = re.compile(r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)\b(\s*[=:]\s*)\S+")


def scrub(text: str) -> str:
    """Remove emails and credentials from an error message before it leaves the process."""
    text = _URL_CREDENTIALS.sub(r"\1[credentials]@", text)
    text = _EMAIL.sub("[email]", text)
    return _SECRET_PAIR.sub(r"\1\2[redacted]", text)


def classify(exc: BaseException) -> str:
    """"user" (bad input the customer can fix), "dependency" (database, network, Redis) or "bug"."""
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int) and type(exc).__name__ == "HTTPException":
        return "user" if status_code < 500 else "bug"
    names = {c.__name__ for c in type(exc).__mro__}
    if names & USER_ERRORS:
        return "user"
    if names & DEPENDENCY_ERRORS:
        return "dependency"
    return "bug"


def record_error(s: Span, exc: BaseException) -> str:
    """Attach a scrubbed exception to a span; dependency failures and bugs mark it as an error."""
    category = classify(exc)
    s.set_attribute("vyuham.error.category", category)
    s.add_event(
        "exception",
        {
            "exception.type": type(exc).__name__,
            "exception.message": scrub(str(exc))[:500],
            # Frames only (file, line, function, code); the message is the scrubbed one above.
            "exception.stacktrace": scrub("".join(traceback.format_tb(exc.__traceback__)))[-4000:],
        },
    )
    if category != "user":
        s.set_status(Status(StatusCode.ERROR, type(exc).__name__))
    return category


_SCRUBBED_EVENT_KEYS = ("exception.message", "exception.stacktrace")


def _scrub_span(s):
    """A copy of a finished span with exception text and status description scrubbed."""
    from opentelemetry.sdk.trace import Event, ReadableSpan

    events = []
    changed = False
    for e in s.events:
        attrs = dict(e.attributes or {})
        for key in _SCRUBBED_EVENT_KEYS:
            if isinstance(attrs.get(key), str):
                clean = scrub(attrs[key])
                changed |= clean != attrs[key]
                attrs[key] = clean
        events.append(Event(e.name, attrs, e.timestamp))
    status = s.status
    if status.description:
        clean = scrub(status.description)
        if clean != status.description:
            status, changed = Status(status.status_code, clean), True
    if not changed:
        return s
    return ReadableSpan(
        name=s.name, context=s.context, parent=s.parent, resource=s.resource, attributes=s.attributes,
        events=events, links=s.links, kind=s.kind, status=status, start_time=s.start_time, end_time=s.end_time,
        instrumentation_scope=s.instrumentation_scope,
    )


class ScrubbingSpanExporter:
    """Wraps a span exporter and scrubs emails and credentials from exception events before export.

    Libraries (e.g. the FastAPI middleware) record exceptions with their raw message and traceback; this is
    the last stop in the process before anything leaves it. The Collector applies the same rules again.
    """

    def __init__(self, delegate):
        self._delegate = delegate

    def export(self, spans):
        try:
            spans = [_scrub_span(s) for s in spans]
        except Exception:  # never drop telemetry over a scrubbing bug; but never send it unscrubbed either
            log.debug("span scrubbing failed; dropping the batch", exc_info=True)
            from opentelemetry.sdk.trace.export import SpanExportResult

            return SpanExportResult.FAILURE
        return self._delegate.export(spans)

    def shutdown(self):
        return self._delegate.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        flush = getattr(self._delegate, "force_flush", None)
        return flush(timeout_millis) if flush else True


def _clean(attrs: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in attrs.items() if isinstance(v, (str, bool, int, float))}


@contextmanager
def span(name: str, **attrs: Any) -> Iterator[Span]:
    """A child span around one Vyuham operation. Only pass safe attributes: ids, kinds, counts."""
    with tracer.start_as_current_span(name, record_exception=False, set_status_on_exception=False) as s:
        for k, v in _clean(attrs).items():
            s.set_attribute(k, v)
        try:
            yield s
        except Exception as e:
            record_error(s, e)
            raise


_instruments: dict[str, Any] = {}


def count(name: str, value: int = 1, **attrs: Any) -> None:
    """Add to a counter metric, e.g. count("vyuham.jobs", kind="alert", status="done")."""
    try:
        c = _instruments.get(name) or _instruments.setdefault(name, meter.create_counter(name))
        c.add(value, _clean(attrs))
    except Exception:  # a metric must never break the operation it measures
        log.debug("metric %s failed", name, exc_info=True)


def record(name: str, value: float, unit: str = "s", **attrs: Any) -> None:
    """Record a value in a histogram metric, e.g. a duration in seconds."""
    try:
        h = _instruments.get(name) or _instruments.setdefault(name, meter.create_histogram(name, unit=unit))
        h.record(value, _clean(attrs))
    except Exception:
        log.debug("metric %s failed", name, exc_info=True)


@contextmanager
def timed(metric: str, **attrs: Any) -> Iterator[dict[str, Any]]:
    """Record how long a block took in `metric`; the yielded dict can add attributes (e.g. outcome)."""
    extra: dict[str, Any] = {}
    started = time.perf_counter()
    try:
        yield extra
    finally:
        record(metric, time.perf_counter() - started, **attrs, **extra)


def current_trace_id() -> str | None:
    """The current trace id as 32 hex characters, or None outside a (sampled) trace."""
    ctx = trace.get_current_span().get_span_context()
    return format(ctx.trace_id, "032x") if ctx.is_valid else None
