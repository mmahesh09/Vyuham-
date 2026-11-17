# Deploying Vyuham

The web app (Next.js + Better Auth) runs on **Vercel**. The API, background jobs and Redis run on **one
VPS** with Docker Compose behind Caddy, which handles HTTPS. **Managed Postgres** is shared by both:
Better Auth writes sessions there and the API reads them.

```
Browser ──> Vercel (Next.js, Better Auth) ──/api/*──> https://api.<domain> (Caddy → API)
               │                                            │
               └──────────── managed Postgres ──────────────┤
                                                   VPS: API, worker, beat, Redis,
                                                        data volume (datasets)
```

Why one VPS: uploaded datasets are Parquet files on disk, and the API and the worker both read them.
Platforms that give each service its own disk can't share them.

## 1. Postgres
Create a database with a managed provider (for example Neon or Supabase) in the region nearest your users.
Copy its connection URL. `postgres://`, `postgresql://` and `postgresql+psycopg://` all work.

## 2. The VPS
About 2 vCPU and 4 GB of memory. DuckDB can use up to 512 MB per query, and the worker keeps Chromium
as the PDF fallback. Install Ubuntu and Docker.

1. Point a DNS A record, for example `api.example.com`, at the server.
2. On the server:
   ```sh
   git clone https://github.com/mmahesh09/Vyuham-.git /opt/vyuham && cd /opt/vyuham
   cp deploy/.env.prod.example .env.prod   # fill in every value; never commit it
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   ```
   The API runs `alembic upgrade head` on start, and Caddy fetches the HTTPS certificate.
3. Check it: `curl https://api.example.com/health/ready` should report `"status":"ok"`.
4. Back up the data volume every night. It's the only copy of uploaded datasets:
   ```sh
   chmod +x deploy/backup-data.sh
   (crontab -l; echo "15 2 * * * cd /opt/vyuham && ./deploy/backup-data.sh >> /var/log/vyuham-backup.log 2>&1") | crontab -
   ```

## 3. Vercel
In the `vyuham` project, set these **Production** environment variables, then redeploy:

| Variable | Value |
|---|---|
| `BACKEND_URL` | `https://api.example.com` |
| `DATABASE_URL` | the same Postgres URL as the API |
| `BETTER_AUTH_URL` | the site's address, for example `https://vyuham-six.vercel.app` |
| `BETTER_AUTH_SECRET` | already set (random) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional, for Google sign-in |

`frontend/vercel.json` runs the functions in Mumbai (`bom1`), close to the API and the database. Reconnect
GitHub under Project → Settings → Git with **Root Directory `frontend`**, so pushes to `main` deploy.

## 4. Email
Verify your sending domain in Resend, then set `RESEND_API_KEY` and `EMAIL_FROM` in `.env.prod` and
restart: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d`. Until then, emails
(invites, alerts, resets) are only logged.

## 5. Check it end to end
1. Sign up on the Vercel site, then confirm your email.
2. Upload a CSV and build a dashboard.
3. Export a PDF. The worker log shows it rendered by Forme, not the Chromium fallback.
4. Create an alert. It runs on the next one-minute tick (`docker compose -f docker-compose.prod.yml logs -f worker`).

## 6. Support, help center, errors and status
- **Staff:** set `SUPPORT_STAFF_EMAILS=you@example.com` in `.env.prod` (comma-separated). Those people see
  the support inbox at `/support/admin`, the help-article editor and the incident tools. Their email must be
  confirmed in production.
- **Status page:** `/status` is public. The beat checks the API, database, jobs and storage every minute,
  and it keeps 90 days of history. Post incidents at `/support/admin/status`. Also point an outside uptime
  monitor (for example Uptime Kuma) at `https://api.<domain>/health/ready`, which catches the whole server
  being down.
- **Error tracking (optional): GlitchTip (MIT, Sentry-SDK compatible).** Run it on the VPS or anywhere:
  1. Use the `glitchtip` and `glitchtip-db` services in `docker-compose.yml` (`--profile errors`), or
     GlitchTip's own compose file. Give it an HTTPS domain, and set `GLITCHTIP_DOMAIN` and `GLITCHTIP_SECRET_KEY`.
  2. Create an organisation and a project, then copy the project's DSN.
  3. Set `SENTRY_DSN` in `.env.prod` (API and worker), and set `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` in Vercel.
  4. Pick a random `GLITCHTIP_WEBHOOK_SECRET` and set it in `.env.prod`. In GlitchTip, go to Project →
     Alerts, add a **webhook** to `https://api.<domain>/support/webhooks/glitchtip?secret=<that value>`.
  5. Each new issue then appears at `/support/admin/errors`. Link it to a help article, and anyone who hits
     that error sees the fix on the error screen.
  Without a DSN, nothing is sent anywhere and the app behaves exactly as before.

## 7. Observability (optional): OpenTelemetry + Grafana
Traces, metrics and logs go to a self-hosted Grafana stack (Collector, Tempo, Prometheus, Loki, Grafana),
all on this server under the compose profile `observability`. It's off until you turn it on. The stack
needs about 1–2 GB of memory, so use an 8 GB server. Full guide: [docs/observability.md](docs/observability.md).

1. In `.env.prod`: `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`, `OTEL_COLLECTOR_TOKEN=<random>`,
   `GRAFANA_ADMIN_PASSWORD=<random>`.
2. `docker compose -f docker-compose.prod.yml --env-file .env.prod --profile observability up -d --build`
3. Sign in at `https://<API_DOMAIN>/grafana`.
4. In Vercel, set `OTEL_EXPORTER_OTLP_ENDPOINT=https://<API_DOMAIN>/otel`,
   `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <OTEL_COLLECTOR_TOKEN>` and `OTEL_SERVICE_NAME=vyuham-web`,
   then redeploy.

## Updating
```sh
cd /opt/vyuham && git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
With the observability stack on, add `--profile observability` to that command.
