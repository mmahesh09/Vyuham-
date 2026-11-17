# Observability: OpenTelemetry and Grafana

Vyuham can send **traces, metrics and logs** to a self-hosted, open-source Grafana stack. It is **off by
default**: with no `OTEL_EXPORTER_OTLP_ENDPOINT`, nothing is exported and the app behaves exactly as before.

## What you get

- **One trace per request**, from the Next.js app on Vercel through the API to the Celery worker. Each trace
  includes database calls, DuckDB queries, chart insights, uploads, reports and background jobs.
- **Dashboards** ("Vyuham overview" in Grafana):
  - requests per second, 5xx rate and p95 latency per route;
  - DuckDB query time by kind;
  - job outcomes and start delay;
  - report renders, uploads, Ask match rate;
  - errors by category and module.
- **Logs with trace ids.** Every API log line has `trace=<id>`. With OTLP logs on, Grafana jumps from a log
  line to its trace and from a trace to its logs.
- **Errors linked to traces.** A 500 response carries `trace_id` next to `error_ref`. GlitchTip events are
  tagged with `trace_id`, `module` and `error_category`.

## Architecture

```
Next.js (Vercel) --OTLP/HTTPS + bearer token--> Caddy /otel --> Collector :4319 (otlp/public)
API, worker, beat --OTLP/HTTP, private network----------------> Collector :4318 (otlp/internal)

Collector: memory_limiter -> drop health checks -> redact -> tail sampling -> batch
   |-- traces  --> Tempo        (14 days)
   |-- metrics --> Prometheus   (90 days, built-in OTLP receiver)
   '-- logs    --> Loki         (14 days)
                    \___________ Grafana (https://API_DOMAIN/grafana) ___________/
```

| Component | Image | Licence | Role |
|---|---|---|---|
| OpenTelemetry Collector | `otel/opentelemetry-collector-contrib:0.128.0` | Apache-2.0 | receive, redact, sample, route |
| Tempo | `grafana/tempo:2.8.1` | AGPL-3.0 | traces |
| Prometheus | `prom/prometheus:v3.4.2` | Apache-2.0 | metrics |
| Loki | `grafana/loki:3.5.1` | AGPL-3.0 | logs |
| Grafana OSS | `grafana/grafana-oss:12.0.2` | AGPL-3.0 | dashboards and exploration |

**Files:**
- `deploy/otel-collector.yaml`
- `deploy/observability/` (Tempo, Prometheus, Loki and Grafana provisioning, plus the dashboard)
- the `observability` profile in `docker-compose.prod.yml`
- the `/otel` and `/grafana` routes in `deploy/Caddyfile`

## What is collected and what never is

**Collected:**
- **Request data:** route, method, status, timing; service name, version and environment.
- **Vyuham operation details:** the kind of each operation (chart / sql / rows; upload type; job kind; report
  format) and counts (rows, columns, charts, attempts).
- **Workspace id:** `vyuham.workspace_id`, an opaque id, so staff can filter by customer.
- **Errors:** exception type, scrubbed message and stack frames.

**Never collected:**
- SQL text or values from customer data (DuckDB queries, customer databases);
- request or response bodies, cookies, `Authorization`, query strings;
- file, dataset or column names, and the text of questions asked in Ask;
- emails, passwords, tokens.

How this is enforced, in three layers:
1. **In the code.** The custom spans (`app/telemetry.py: span`) only receive safe attributes. Only the app's
   own database is auto-instrumented (its SQL has placeholders, never values).
2. **Before export.** `ScrubbingSpanExporter` scrubs emails and credentials from exception messages, stack
   traces and status text, including exceptions recorded by libraries. The 500 handler also scrubs the
   exception before it is re-raised.
3. **In the Collector.** `attributes/redact` deletes auth and cookie headers, `url.query`, `url.full` and any
   `*password|secret|token|api_key*` attribute. `transform/sql` removes SQL text for anything other than the
   app's Postgres, and masks emails and credentials in exception events.

Tests in `backend/tests/test_observability.py` assert that a secret value in a dataset, a SQL query and an
Ask question never appears in any span.

**Access:**
- Grafana has its own sign-in, with anonymous access and sign-up off.
- Tempo, Prometheus, Loki and the Collector have no public ports.
- The only public telemetry route is `/otel`, and Caddy refuses it unless the bearer token matches.

## Sampling and retention

| Setting | Default | Where |
|---|---|---|
| Keep all error traces | always | Collector `tail_sampling` |
| Keep traces slower than 2 s | always | Collector `tail_sampling` |
| Share of other traces kept | `OTEL_SAMPLE_PERCENT=10` | `.env.prod` |
| App-side sampling | `OTEL_TRACES_SAMPLER=parentbased_always_on` | `.env.prod` (leave it; the Collector samples) |
| Trace retention | `TEMPO_RETENTION=336h` (14 days) | `.env.prod` |
| Log retention | `LOKI_RETENTION=336h` (14 days) | `.env.prod` |
| Metric retention | `PROM_RETENTION=90d` | `.env.prod` |

Metrics are never sampled, so rates and percentiles stay accurate.

## Turn it on in production

**Before you start:** the stack's memory caps add up to about 1.9 GB (typically around 1 GB in use). On the
documented 4 GB server that is tight next to the API, the worker and Chromium, so plan on **8 GB**.

1. **In `.env.prod` on the server:**
   ```sh
   OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
   OTEL_COLLECTOR_TOKEN=<long random string>     # openssl rand -hex 32
   GRAFANA_ADMIN_PASSWORD=<long random string>
   ```
2. **Start everything, with the profile:**
   ```sh
   docker compose -f docker-compose.prod.yml --env-file .env.prod --profile observability up -d --build
   ```
3. **Sign in to Grafana** at `https://<API_DOMAIN>/grafana` as `admin` with your password. The data sources
   and the **Vyuham → Vyuham overview** dashboard are already there.
4. **In the Vercel project** (Settings → Environment Variables, Production), then redeploy:
   ```
   OTEL_EXPORTER_OTLP_ENDPOINT=https://<API_DOMAIN>/otel
   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <OTEL_COLLECTOR_TOKEN>
   OTEL_SERVICE_NAME=vyuham-web
   ```
5. **Check it:** in Grafana, Explore → Tempo → search by service `vyuham-web`. Open a trace and it continues
   into `vyuham-api` (and `vyuham-worker` for queued jobs).

**To turn it off:** remove `OTEL_EXPORTER_OTLP_ENDPOINT` and run `up -d` without the profile. The app is unchanged.

## Turn it on locally

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318 docker compose --profile observability up
```
This runs the all-in-one `grafana/otel-lgtm` image at http://localhost:3001 (admin/admin, local only).

To run the backend outside Docker, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`. The local image
doesn't apply the production Collector's redaction and sampling rules; the app-side protections still apply.

## Following an error to its cause

1. **A customer reports an error.** The 500 response, and the error screen, carry `error_ref` and `trace_id`.
2. **In Grafana:** Explore → Tempo → paste the `trace_id`. You see every step of that request (database, DuckDB,
   insights) with timings and the scrubbed exception.
3. **In GlitchTip:** the same error is grouped as an issue, tagged with `trace_id`, `module` and
   `error_category`:
   - `user`: bad input the customer can fix;
   - `dependency`: database, network or Redis trouble;
   - `bug`: everything else.
4. **Logs:** from the trace, "Logs for this span" opens the matching lines in Loki.

`error_groups` also stores `release` and `module` (from the GlitchTip webhook). A `last_trace_id` column is
ready for a future job that reads trace ids from GlitchTip's API.

## Custom instrumentation

```python
from app.telemetry import count, record, span, timed

with span("vyuham.something", **{"vyuham.workspace_id": ws_id, "vyuham.something.kind": kind}) as s:
    ...
    s.set_attribute("vyuham.something.rows", n)      # counts, kinds, ids only: never customer values
count("vyuham.something.runs", outcome="ok")          # counter
with timed("vyuham.something.duration", kind=kind):   # histogram in seconds
    ...
```

Exceptions raised inside `span()` are recorded with a scrubbed message and classified. Only `dependency` and
`bug` errors mark the span as failed, so the error rate means "something is wrong on our side".

## Troubleshooting

- **No data in Grafana.**
  - Check `OTEL_EXPORTER_OTLP_ENDPOINT` is set for the backend services (`docker compose exec backend env | grep OTEL`).
  - Check that `docker compose --profile observability ps` shows all five services up.
- **The frontend's traces are missing.**
  - Check the Vercel variables.
  - `curl -i https://<API_DOMAIN>/otel/v1/traces -H "Authorization: Bearer <token>" -d '{}'` should not return 401.
- **Collector health.** In Grafana, look at the dashboard panel "Collector: spans refused or dropped", or run
  `docker compose logs otel-collector`.
- **Memory pressure.** Lower `OTEL_SAMPLE_PERCENT`, shorten the retention, or move the stack to its own server.
  Point `OTEL_EXPORTER_OTLP_ENDPOINT` there and restrict that server's port 4318 to the API server's IP.
- **Timeout units.** `OTEL_EXPORTER_OTLP_TIMEOUT` is in **seconds** for the Python exporter (backend, set to 5)
  but in **milliseconds** for the Node exporter (frontend). Don't copy the same value between them.
