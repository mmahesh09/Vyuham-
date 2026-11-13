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

## Updating
```sh
cd /opt/vyuham && git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
