# Vyuham: project status

*Last updated 2026-11-18. Everything below comes from the repository (commits, branches, the stash, dependency
files and configs) and from measurements taken during development. Secrets are listed by name only.*

Vyuham is an AI-style dashboard tool for small businesses: upload a spreadsheet (or, soon, connect a database),
ask questions in plain English, get answers with charts, build dashboards, share them and get alerts and reports.

- **Live site:** https://vyuham-six.vercel.app (Vercel, deployed from `main`)
- **Repository:** github.com/mmahesh09/Vyuham- (default branch `main`)
- **Guides:** [DEPLOY.md](../DEPLOY.md), [observability](observability.md), [open-source stack review](open-source-stack.md)

### Status labels used in this file

| Label | Meaning |
|---|---|
| **Live** | On `main` and deployed to production on Vercel |
| **On main** | Merged into `main`; the backend part runs once the VPS is updated (`git pull` + `docker compose up`) |
| **Branch** | Pushed to GitHub on its own branch, not merged |
| **Stashed** | Built but uncommitted; saved locally in `git stash` (`stash@{0}`) |
| **Planned** | Not started |

---

## 1. At a glance

### Where the code is right now

| Ref | What it holds |
|---|---|
| `main` (`450278b`) | Everything merged so far, including the landing-page speed fix. Production builds from here. |
| `feat/observability` (`a908d95`) | OpenTelemetry + self-hosted Grafana. Pushed, not merged. |
| `stash@{0}` | Database connections (PostgreSQL/MySQL as data sources) and the landing FAQ wording for it. Not committed. |
| `origin/ccr-8ee18ece-i4qf0t` | A separate, earlier attempt at support (Chatwoot chat, an AI troubleshooting engine). Kept on GitHub; not merged on purpose. |

### Feature summary

| Area | Feature | Status |
|---|---|---|
| Data | CSV / Excel upload, typed columns, Parquet storage | On main |
| Data | Database connections (PostgreSQL, MySQL) with scheduled sync | Stashed |
| Analysis | Dashboards, charts and plain-English insights | On main |
| Analysis | Ask (plain-English questions → chart) | On main |
| Analysis | SQL Lab (editor, parameters, EXPLAIN) | On main |
| Automation | Alerts and automations on a schedule | On main |
| Sharing | Share links, PDF / CSV / Excel reports, decks | On main |
| Accounts | Sign-up, email verification, teams and invites, account export | On main |
| Support | Help center, support portal, staff admin, status page, GlitchTip error loop | On main |
| Public site | Landing page, blog, `/try` demo, `/support-center`, About, navbar | Live |
| Quality | Responsive layout on every device | Live |
| Quality | Landing-page speed fix | Live |
| Quality | Security hardening, rate limits, CI scanning | On main |
| Operations | Observability (OpenTelemetry → Grafana, Tempo, Prometheus, Loki) | Branch |

---

## 2. Architecture

```
Browser ──► Next.js 15 on Vercel (pages, Better Auth sign-in, /api proxy)
                │  /api/*  (trace context passed along)
                ▼
         Caddy (HTTPS) on one VPS ──► FastAPI (uvicorn)
                                        │      ├─ Postgres (managed; shared with Better Auth)
                                        │      ├─ Parquet files on the data volume
                                        │      │     └─ DuckDB, sandboxed per request (charts, SQL Lab, Ask)
                                        │      └─ Redis ──► Celery worker + beat (alerts, reports, syncs, status checks)
                                        └─ optional: GlitchTip (errors), Collector → Grafana stack (observability)
```

- **Frontend:** Next.js 15.5 (App Router, React 19, TypeScript, Tailwind CSS 4) on Vercel. The project's
  Root Directory is `frontend`, so every push to `main` deploys automatically.
- **Backend:** Python FastAPI on a VPS through Docker Compose (`docker-compose.prod.yml`), behind Caddy with automatic HTTPS.
- **Database:** PostgreSQL (SQLite for quick local development), via SQLAlchemy 2 and Alembic migrations.
- **Analytics engine:** every dataset is a Parquet file. Each request opens a fresh in-memory DuckDB that can only
  read that workspace's folder: no network, no extensions, and the configuration is locked.
- **Background work:** Celery with Redis. Without Redis (local development), a thread runs the same jobs.
- **Multi-tenancy:** every row carries `workspace_id`, and DuckDB is confined to the workspace's own files.

---

## 3. Major installations

### Backend (Python, `backend/requirements.txt`)

| Group | Packages |
|---|---|
| Web / API | `fastapi 0.162.0`, `starlette 1.10.0`, `uvicorn[standard] 0.34.2`, `python-multipart 0.0.33`, `pydantic-settings 2.9.1` |
| Database | `sqlalchemy 2.0.41`, `alembic 1.16.1`, `psycopg[binary] 3.2.9` |
| Data and analytics | `pandas 3.1.1`, `pyarrow 26.0.1`, `openpyxl 3.1.5`, `defusedxml 0.7.1`, `duckdb 1.5.6`, `sqlglot 30.29.0` |
| Background jobs | `celery[redis] 5.7.0`, `redis 8.1.0`, `flower 2.2.0` (monitor) |
| Rate limits | `limits 5.8.0` |
| Reports | `playwright 1.64.1` (Chromium fallback for PDFs) |
| Telemetry | `opentelemetry-sdk 1.45.2`, `opentelemetry-exporter-otlp-proto-http 1.45.2`; instrumentation `0.66b2` for FastAPI, Celery, SQLAlchemy, plus urllib, Redis, logging (the last three on `feat/observability`) |
| Errors | `sentry-sdk[fastapi,celery] 2.66.1` (sends to self-hosted GlitchTip) |
| Database connections (stashed) | `PyMySQL 1.1.1`, `cryptography 45.0.4` |

### Frontend (`frontend/package.json`)

| Group | Packages |
|---|---|
| Framework | `next 15.5.29`, `react 19.1.0`, `typescript`, `tailwindcss 4` |
| UI | `@base-ui/react`, `radix-ui`, shadcn components, Magic UI components (`animated-shiny-text`, particles), ReUI components, `lucide-react`, `sonner`, `cmdk`, `lenis` |
| Charts | `echarts 6`, `recharts 3`, (`svg-dotted-map`, build-time only for the world map) |
| Data grid and files | `@tanstack/react-table 9`, `@tanstack/react-virtual`, `papaparse`, `xlsx 0.20.3`, `react-grid-layout 2` |
| State and data | `@tanstack/react-query 5`, `zustand 5`, `nuqs`, `zod 4`, `react-hook-form` |
| SQL editor | CodeMirror 6 (`@codemirror/*`), `sql-formatter` |
| Auth | `better-auth 1.7`, `pg` |
| PDFs | `@formepdf/core` and `@formepdf/react 0.31.0` |
| Blog | `next-mdx-remote 6`, `gray-matter`, `shiki 4`, `remark-gfm`, `rehype-slug` |
| Security headers | `@nosecone/next 1.15.0` |
| Telemetry and errors | `@vercel/otel 2.3.0`, `@sentry/nextjs 11.10.0` |

### Services and images

| Service | Image | Where | Role |
|---|---|---|---|
| Caddy | `caddy:2.8.4-alpine` | production | HTTPS, routes to the API (and `/grafana`, `/otel` on the observability branch) |
| Redis | `redis:7-alpine` | dev + production | Celery broker |
| PostgreSQL | `postgres:16-alpine` | dev | App database (production uses managed Postgres) |
| GlitchTip | `glitchtip/glitchtip:6` + `postgres:18` | dev (profile `errors`) | Error tracking |
| MiniStack | `ministackorg/ministack:1.5.37` | dev (profile `dev`) | Local S3 for report storage tests |
| Collector, Tempo, Prometheus, Loki, Grafana | `otel/opentelemetry-collector-contrib:0.128.0`, `grafana/tempo:2.8.1`, `prom/prometheus:v3.4.2`, `grafana/loki:3.5.1`, `grafana/grafana-oss:12.0.2` | production, profile `observability` (branch) | Observability |
| Grafana all-in-one | `grafana/otel-lgtm:0.11.4` | dev, profile `observability` (branch) | Local observability |

### Tooling and CI

| Tool | Purpose | Where |
|---|---|---|
| GitHub Actions `CI` | Backend tests (SQLite and Postgres), lint, type-check, build | `.github/workflows/ci.yml` |
| GitHub Actions `Security` | Trivy vulnerability scans, Syft SBOMs | `.github/workflows/security.yml` |
| GitHub Actions `ZAP baseline` | OWASP ZAP scan of the site | `.github/workflows/zap.yml` |
| Renovate | Dependency updates (replaced Dependabot), GitHub Actions pinned to digests | `renovate.json` |
| Vercel CLI | Deploys, project settings | `frontend/.vercel/` (local link) |
| Claude Code skills | Content strategy, stop-slop copy checks, design and others | `skills-lock.json`, `.claude/` |

---

## 4. Connections and integrations

| Integration | What it does | Configured in | Status | How to turn it on |
|---|---|---|---|---|
| **Vercel** | Hosts the Next.js app; auto-deploys `main`, previews for branches | Vercel project `vyuham` (Root Directory `frontend`) | Live | Already on |
| **VPS (Docker Compose + Caddy)** | Runs the API, worker, beat and Redis | `docker-compose.prod.yml`, `deploy/Caddyfile`, `.env.prod` | On main | [DEPLOY.md](../DEPLOY.md) sections 1–5 |
| **Managed PostgreSQL** | App data and Better Auth users | `DATABASE_URL` (VPS and Vercel) | On main | [DEPLOY.md](../DEPLOY.md) section 1 |
| **Better Auth** | Sign-up, sign-in, sessions (the Next.js app writes, the API reads) | `frontend/src/lib/auth.ts`, `BETTER_AUTH_URL` | On main | Already on |
| **Resend** | Verification, invite, alert and report emails | `RESEND_API_KEY`, `EMAIL_FROM` | On main | Set the key; without it emails are only logged |
| **Reacher** | Checks invite addresses before sending | `REACHER_URL`, `REACHER_SECRET` | On main | Optional, self-hosted |
| **S3-compatible storage** | Stores generated reports (local disk by default) | `REPORT_STORAGE=s3`, `S3_*` | On main | Optional |
| **GlitchTip (Sentry SDKs)** | Error tracking for API, worker and web; its webhook creates error groups in the support admin | `SENTRY_DSN`, `GLITCHTIP_WEBHOOK_SECRET` | On main | [DEPLOY.md](../DEPLOY.md) section 6 |
| **OpenTelemetry → Grafana stack** | Traces, metrics and logs; Grafana at `https://<API_DOMAIN>/grafana` | `app/telemetry.py`, `deploy/otel-collector.yaml`, `deploy/observability/` | Branch | [observability.md](observability.md) |
| **Customer databases (PostgreSQL, MySQL)** | Pick tables or a query; synced hourly/daily into Parquet | `app/connectors/`, `app/sync.py`, `CONNECTIONS_KEY` | Stashed | Unstash, test, set `CONNECTIONS_KEY`, deploy |
| **Chatwoot / AI troubleshooting engine** | Live chat and an LLM support assistant | `origin/ccr-8ee18ece-i4qf0t` only | Not adopted | Decision pending (overlaps the built-in support portal) |

---

## 5. Features delivered

### Product

| Feature | What it does | Main files | Status |
|---|---|---|---|
| Uploads | CSV/Excel (10 MB, 1M rows) → typed columns (number, date, category, text) → Parquet | `backend/app/ingest.py`, `routers/datasets.py`, `frontend/src/features/datasets/` | On main |
| Dashboards and insights | Charts from a JSON spec, starter dashboards, a one-sentence insight per chart, filters, share links | `app/query.py`, `app/insights.py`, `routers/dashboards.py` | On main |
| Ask | Plain-English question → the matching chart. **Rule-based parser, not an LLM.** | `app/ask.py`, `routers/ask.py` | On main |
| SQL Lab | SQL editor with parameters, EXPLAIN plans, error line numbers, saved queries | `routers/sql_lab.py`, `features/sql-lab/` | On main |
| Alerts and automations | Threshold alerts and scheduled digests (in-app, email, webhook) | `app/alerts.py`, `app/jobs.py` | On main |
| Reports | Dashboard PDFs (Forme, Chromium fallback), CSV and Excel exports, saved reports | `app/reports/` | On main |
| Decks | Slide decks served at `/decks` | `my-deck/` | On main |
| Accounts and teams | Email verification, workspace members and invites, data export | `routers/account.py`, `routers/team.py` | On main |
| Security | Rate limits (Redis-backed middleware), security headers (Nosecone), review fixes | `app/ratelimit.py`, `frontend/src/middleware.ts` | On main |

### Public site and support

| Feature | What it does | Main files | Status |
|---|---|---|---|
| Landing page | Product story, live demo charts, comparison, pricing, FAQ | `frontend/src/app/(marketing)/page.tsx` | Live |
| Navbar | Home · Try Vyuham · About · Blog · Support, with a phone menu | `components/marketing/site-nav.tsx` | Live |
| `/try` | No-login demo: pick a question, see the scripted answer and chart | `app/(marketing)/try/page.tsx`, `components/marketing/try-ask.tsx` | Live |
| `/support-center` | Support portal: search, topics, status, how requests are handled, latest posts | `app/(marketing)/support-center/page.tsx` | Live |
| Announcement pills | Magic UI shiny text on hero, `/try`, `/support-center`, blog | `components/marketing/announcement.tsx` | Live |
| Blog | MDX posts, tag pages, RSS, share images | `app/(marketing)/blog/`, `content/blog/` | Live |
| Help center and status | Public help articles, live status page with 90-day uptime | `app/(marketing)/help/`, `app/(marketing)/status/` | Live (pages) / On main (API) |
| Support portal and admin | Customer requests, staff inbox, help-article editor, error groups, incidents | `features/support/`, `routers/support.py` | On main |

### Quality and operations

| Work | Result | Status |
|---|---|---|
| Responsive pass | No sideways scrolling at 360 / 768 / 1440 px; phone menu everywhere | Live |
| Speed fix | Precomputed world map, lazy below-the-fold demos, lighter particles (see section 7) | Live |
| Branch clean-up | All branches merged into `main`; duplicates removed (second navbar, second rate limiter, placeholder pages); 9 merged branches deleted | Done |
| Vercel fix | Root Directory set to `frontend`; pushes to `main` now deploy | Done |
| Observability | OpenTelemetry → Collector → Tempo, Prometheus, Loki, Grafana; errors linked to traces | Branch |
| Database connections | PostgreSQL/MySQL sources with encrypted passwords, read-only sessions, scheduled sync | Stashed |

---

## 6. What was done in this development session (in order)

1. **Responsive site and new navbar**: one shared navbar with a phone menu; responsive fixes across the landing page.
2. **Support center and `/try`**: the support portal (based on a reference design, recoloured to Vyuham's palette) and a no-login demo.
3. **Announcement pills**: the Magic UI `animated-shiny-text` component, wrapped as `Announcement`.
4. **Merged everything into `main`**:
   - kept one navbar and one rate limiter, folding PR #4's endpoint coverage into the existing limiter (PR #4 closed);
   - deleted 9 merged branches;
   - left the Chatwoot/AI `ccr` branch out on purpose;
   - fixed the Vercel Root Directory and deployed to production.
5. **Database connections** (designed and built; stashed):
   - PostgreSQL and MySQL;
   - passwords encrypted with Fernet (`CONNECTIONS_KEY`);
   - private and loopback hosts refused;
   - read-only sessions with a 60 s statement limit;
   - single-SELECT validation;
   - hourly or daily sync into Parquet through the existing job runner;
   - a 3-step "Connect a database" dialog. SQL Lab can join a database table with an uploaded CSV.
6. **Speed investigation and fix**:
   - measured in a real browser;
   - traced 7 s of main-thread work to the world map's geometry, and more to 450 KB of chart code and the particle canvases;
   - fixed all three and deployed.
7. **Observability**: the OpenTelemetry plan, then the build with self-hosted open-source Grafana (on `feat/observability`).

---

## 7. Measurements

### Landing page in production (headless Chrome; the phone test uses 4× CPU slowdown and a 4G-like network)

| Page | Metric | Before | After |
|---|---|---|---|
| Homepage, desktop | Main thread blocked (TBT) | 6.5 s | **2.0 s** |
| Homepage, desktop | Main content visible (LCP) | 4.6 s | **2.0 s** |
| Homepage, phone | Main thread blocked (TBT) | 16 s | **7 s** |
| `/try`, desktop | Main thread blocked (TBT) | 0.6 s | **0.1 s** |
| `/try` | First-load JavaScript | 300 KB | **162 KB** |

The server was never the bottleneck: every page's first byte arrives in about 0.13–0.43 s from Vercel's cache.

### Tests

| Suite | Result |
|---|---|
| Backend on `feat/observability` | 230 passed, 1 skipped (includes 18 new telemetry tests) |
| Database connections (in the stash) | 34 new tests; full backend suite 256 passed when it was last run with them |
| Frontend | TypeScript and ESLint clean |

---

## 8. Configuration checklist (names only)

| Where | Variable | Needed for | Status |
|---|---|---|---|
| VPS `.env.prod` | `DATABASE_URL`, `APP_URL`, `API_DOMAIN`, `SIGNING_SECRET` | The API (required) | On main |
| VPS `.env.prod` | `RESEND_API_KEY`, `EMAIL_FROM` | Emails | On main |
| VPS `.env.prod` | `SENTRY_DSN`, `GLITCHTIP_WEBHOOK_SECRET`, `SUPPORT_STAFF_EMAILS` | Error tracking, support staff | On main |
| VPS `.env.prod` | `REPORT_STORAGE`, `S3_*`, `REACHER_*` | Optional storage and invite checks | On main |
| VPS `.env.prod` | `CONNECTIONS_KEY` (**required**: the API won't start without it once connections ship), `PUBLIC_EGRESS_IP` | Database connections | Stashed |
| VPS `.env.prod` | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_COLLECTOR_TOKEN`, `GRAFANA_ADMIN_PASSWORD`, optional `OTEL_SAMPLE_PERCENT`, `*_RETENTION` | Observability | Branch |
| Vercel | `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `BACKEND_URL` | The web app | Live |
| Vercel | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | Frontend traces | Branch |

Full lists with comments: [`deploy/.env.prod.example`](../deploy/.env.prod.example), [`backend/.env.example`](../backend/.env.example).

---

## 9. Known gaps and next steps, per feature

| Feature | What's left |
|---|---|
| Landing speed | About 2 s of blocking remains on desktop. Earlier tests point at the two particle canvases (removing them dropped blocking to about 0.25 s). Option: remove the page-wide particle layer, or draw it once as a static image. |
| Database connections | Test against real PostgreSQL and MySQL servers. Commit from the stash. When merging after observability, re-point its migration (`9e2a6c1d5b38`) to follow `a3f9c7e1b2d4`. Set `CONNECTIONS_KEY` on the VPS before deploying. Add the `vyuham.sync` span (observability is ready for it). |
| Observability | Merge `feat/observability`. Start the profile on the VPS (plan on 8 GB of memory). Set the Vercel variables. Fill `error_groups.last_trace_id` from GlitchTip's API in a later job. |
| Landing FAQ | Still says Google Sheets "stay in sync automatically"; that feature doesn't exist. The stashed connections work rewrites this answer. |
| Ask | Rule-based today. A real AI layer is a future option; Haystack is the first choice in [open-source-stack.md](open-source-stack.md). |
| Support | Decide what to do with the `ccr` branch (Chatwoot live chat, AI troubleshooting). It overlaps the built-in support portal in 26 files. |
| Backend deploy | Recent backend changes (support portal, rate limits, migrations) are on `main`, but deploying the VPS is a manual step (`git pull` + `docker compose up -d --build`). |

---

## 10. Where to find more

- [DEPLOY.md](../DEPLOY.md): production setup, step by step
- [docs/observability.md](observability.md): telemetry, Grafana, privacy, sampling, troubleshooting
- [docs/open-source-stack.md](open-source-stack.md): which open-source projects we use or avoid, and why
- [`deploy/.env.prod.example`](../deploy/.env.prod.example) and [`backend/.env.example`](../backend/.env.example): every setting
