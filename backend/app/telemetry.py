"""OpenTelemetry tracing, off unless OTEL_EXPORTER_OTLP_ENDPOINT is set.

With no endpoint, nothing is imported or started and the app behaves exactly as before. With one,
the API (requests), database (SQLAlchemy queries) and Celery (tasks, and the hop from the API that
queued them) send traces over OTLP/HTTP to any OpenTelemetry backend: Traceway, Grafana Tempo,
Honeycomb, Sentry and others. Everything else comes from the standard OTEL_* variables, e.g.

    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost/api/otel         # base URL; /v1/traces is appended
    OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <token>"
    OTEL_SERVICE_NAME=vyuham-api                                   # optional; defaults per process
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger("app.telemetry")
_started = False


def enabled() -> bool:
    return bool(os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"))


def setup_telemetry(service_name: str, *, app=None, celery: bool = False) -> bool:
    """Start tracing for this process. Returns False (and does nothing) when no endpoint is set."""
    global _started
    if not enabled():
        return False
    if not _started:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        from app.db import engine

        resource = Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME") or service_name})
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))  # endpoint and headers from OTEL_* env
        trace.set_tracer_provider(provider)
        SQLAlchemyInstrumentor().instrument(engine=engine)
        _started = True
        log.info("OpenTelemetry tracing on for %s", resource.attributes.get("service.name"))
    if app is not None:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        # Health checks run every few seconds; tracing them is noise.
        FastAPIInstrumentor.instrument_app(app, excluded_urls="health/live,health/ready")
    if celery:
        from opentelemetry.instrumentation.celery import CeleryInstrumentor

        CeleryInstrumentor().instrument()
    return True
