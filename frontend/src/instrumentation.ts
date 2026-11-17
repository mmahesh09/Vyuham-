import type { Instrumentation } from "next";

/**
 * Server start-up hooks, each off unless configured.
 *
 * Tracing: OpenTelemetry for the Next.js server (auth routes, the /api proxy, server rendering) when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set. Uses the standard OTEL_* variables, the same ones as the backend
 * (backend/app/telemetry.py), so both send to one OTLP backend such as Traceway. Calls to the backend
 * carry the trace context, so a request shows up as one trace across both.
 *
 * Errors: the Sentry SDK, sending server errors to a self-hosted GlitchTip, when SENTRY_DSN is set.
 * With tracing also on, Sentry leaves OpenTelemetry to @vercel/otel and only reports errors.
 */
const otel = !!(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
const sentryDsn = process.env.SENTRY_DSN;

export async function register() {
  if (otel) {
    const { registerOTel } = await import("@vercel/otel");
    const backend = process.env.BACKEND_URL;
    registerOTel({
      serviceName: process.env.OTEL_SERVICE_NAME || "vyuham-web",
      // Same labels as the backend, so Grafana can split by environment and deploy.
      attributes: {
        "deployment.environment": process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
        ...(process.env.VERCEL_GIT_COMMIT_SHA ? { "service.version": process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12) } : {}),
      },
      instrumentationConfig: { fetch: { propagateContextUrls: backend ? [backend] : [] } },
    });
  }
  if (sentryDsn && process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
      release: process.env.RELEASE || undefined,
      // No cookies, headers, bodies or query strings leave the server or browser; users only by opaque id.
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
      tracesSampleRate: 0,
      // With @vercel/otel running, let it own the tracer provider; Sentry only reports errors.
      enableOpenTelemetrySetup: !otel,
    });
  }
}

/** Errors thrown while rendering server components and route handlers. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!sentryDsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
