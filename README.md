# Vyuham — AI dashboards for small companies

Upload a spreadsheet, ask in plain English, get the answer and a chart. See `plan.md` for the full v1 plan.

## Structure
- `frontend/` — Next.js 15 (App Router, TypeScript, Tailwind v4). `/api/auth/*` is Better Auth; every other `/api/*` is proxied to the backend.
- `backend/` — FastAPI + SQLAlchemy + Alembic. SQLite locally, Postgres in Docker.

## Run locally (no Docker)
```bash
# Backend (terminal 1)
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt     # macOS/Linux: .venv/bin/pip
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload

# Frontend (terminal 2)
cd frontend
npm install
cp .env.example .env.local   # then set BETTER_AUTH_SECRET (and Google/Apple keys if you have them)
npm run dev
```

## Auth
Better Auth runs inside Next.js at `/api/auth/*` (`frontend/src/lib/auth.ts`): email + password,
Google, Apple, password reset. It shares the backend's database (SQLite `backend/dev.db` locally,
Postgres in Docker); Alembic owns the schema (`backend/app/auth_tables.py`). FastAPI reads the
session cookie (`backend/app/security.py`) and creates the user's workspace on first sign-in.
Password reset emails are printed to the Next.js console until an email provider is wired up.
**Both servers must be running.** If the backend is down you'll see a "signed in, but the API isn't answering"
screen after logging in. Keep `BACKEND_URL=http://127.0.0.1:8000` (not `localhost`: Node can resolve it to IPv6 `::1`
while uvicorn only listens on IPv4).

## UI components
shadcn style is `base-nova` (Base UI), because the ReUI blocks (`components/reui`, demos in `components/examples`)
use Base UI's `render` prop. Brand `--muted`/`--accent` are text colours, so after `npx shadcn add` rewrite
`bg-muted`/`bg-accent` → `bg-surface-2` in the vendored files (see the token bridge in `globals.css`).
Open http://localhost:3000.

## Run with Docker (Postgres)
Start Docker Desktop, then:
```bash
docker compose up --build
```
This starts Postgres, Redis, the API, the frontend, and the background job services:
- `worker` runs jobs: alert checks and digests now, reports later.
- `beat` queues a `tick` every minute. Run exactly one beat.
- `flower` is the job queue dashboard at http://localhost:5555. Its login is set by `FLOWER_BASIC_AUTH` (default `admin:admin`, local only).

Health checks: `GET /health/live` (the process is up) and `GET /health/ready` (database, Redis and the data folder all work; returns 503 otherwise).

## Tests
```bash
cd backend && .venv/Scripts/python -m pytest -q
cd frontend && npm run lint && npm run build
```

## Status
- [x] Week 1 — skeleton, sign up / log in / log out, one workspace per account, app shell with sidebar
- [x] Week 2 — upload CSV/XLSX, column types, Parquet per workspace; DuckDB query engine (sandboxed per workspace)
- [x] Data screen — dataset page with paged/sorted/searchable grid, type overrides, rename, replace file, delete
- [x] Dashboards — story feed + KPI row from your data, chart builder (live preview, colours), filters, drag to reorder, share links (`/s/<token>`)
- [x] Home + Ask — rule-based questions → answer + chart, save to dashboard (Claude comes next)
- [x] Templates — Sales, Startup metrics, Expenses with column mapping
- [x] Team — invite links, roles, data tasks (board / timeline / calendar with leave), presence and leave with backup
- [x] Profile, presence, DPDP privacy policy with recorded consent
- [x] Chart templates — gallery of 11 starting points; new types: ranking, bar + line, scatter, funnel, treemap, gauge vs goal
- [x] SQL Lab (`/sql`) — read-only SQL over your datasets with friendly table names, saved queries, results → chart
- [x] Dashboard Lab (`/lab`) — free-form canvas layout for any dashboard (`?layout=canvas`)
- [x] Alerts & automations (`/alerts`) — threshold / % change alerts, scheduled dashboard digests; in-app bell, email (logged), webhooks
- [x] Guided tour — first visit to Home, replay from "Take the tour"
- [ ] AI round — Claude for Ask, auto-dashboards and insight wording (numbers stay computed in DuckDB)
- [ ] Google Sheets connector, email delivery (invites, password reset), billing

## Backend layout (added this round)
- `app/query.py` — DuckDB sandbox + chart-spec → SQL compiler (bound parameters only)
- `app/insights.py` — plain-English insights from computed numbers, starter dashboards
- `app/ask.py` — rule-based question parser; `app/templates.py` — dashboard templates
- `app/alerts.py` — alert checks and digests
- `app/jobs.py` — background jobs: find what's due, claim it with a unique `job_runs` row (so nothing is sent twice), run it, record the outcome
- `app/worker.py` — the Celery app and tasks (`tick` every minute from beat, `run_job` with retries, a daily `prune`)
- `app/scheduler.py` — fallback for local dev without Redis: runs `jobs.tick` in a thread (`SCHEDULER_ENABLED=false` to turn off)
- `app/notify.py` — delivery: in-app, email (logged until a provider is set), webhooks (https only; private/internal addresses blocked)
- `app/routers/` — `sql_lab`, `alerts`, `datasets`, `dashboards` (+ public share), `ask`, `templates`, `team` (invites, members, tasks, leave calendar), `profile`, `presence`
