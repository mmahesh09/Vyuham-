/**
 * OpenTelemetry tracing for the Next.js server (auth routes, the /api proxy, server rendering),
 * off unless OTEL_EXPORTER_OTLP_ENDPOINT is set. Uses the standard OTEL_* variables, the same ones as
 * the backend (backend/app/telemetry.py), so both send to one OTLP backend such as Traceway.
 * Calls to the backend carry the trace context, so a request shows up as one trace across both.
 */
export async function register() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return;
  const { registerOTel } = await import("@vercel/otel");
  const backend = process.env.BACKEND_URL;
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME || "vyuham-web",
    instrumentationConfig: { fetch: { propagateContextUrls: backend ? [backend] : [] } },
  });
}
