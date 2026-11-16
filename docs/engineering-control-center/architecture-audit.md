# VECC Phase 1: Architecture audit

*Vyuham Engineering Control Center. Audit of the existing project before any VECC code is written.*
Audited on 2026-11-16 against branch `ccr-8ee18ece-i4qf0t` of `github.com/mmahesh09/Vyuham-`
(the repository attached to this session).

**Status: Phase 1 complete. No VECC code, schema or configuration has been added yet.**

---

## 1. Findings that change the brief

The brief assumes several things this repository does not contain. Each is listed with the evidence
and what VECC should do instead.

| Brief says | What the repository shows | Evidence | Consequence for VECC |
|---|---|---|---|
| GitHub: `github.com/mmahesh09/Vyuham` | This checkout is **`mmahesh09/Vyuham-`** (trailing hyphen). It is the only Vyuham repository your account's GitHub connection lists. `mmahesh09/Vyuham` could not be verified: GitHub asks for credentials, which it does for both private and non-existent repositories. | `git remote -v`; repository listing | **Decision needed (§8, D1).** If `Vyuham` (no hyphen) is a different codebase, this audit does not describe it. |
| Website `vyuham-six.vercel.app` | Could not be reached from this environment (network policy). The repository has **no Vercel configuration** (`vercel.json`, Vercel workflow or project link). | `curl` refused; file search | Deployment tracking can't assume Vercel is wired to this repo. Phase 9 supports Vercel deployment webhooks *if* the project is on Vercel, plus GitHub Actions and Docker. |
| Supabase, "Supabase migrations", RLS, service-role keys | **No Supabase.** PostgreSQL (SQLite locally) accessed by FastAPI through SQLAlchemy; schema owned by **Alembic** (14 revisions). Auth is **Better Auth** in Next.js; FastAPI validates its session cookie. | `backend/app/db.py`, `backend/migrations/`, `frontend/src/lib/auth.ts`, `backend/app/security.py`; no `supabase` reference outside a vendored icon map | Implement VECC tables as **Alembic migrations** with PostgreSQL-native protections (append-only triggers, a restricted ingestion role, and RLS where it adds value). Every brief requirement is achievable without Supabase. Adding Supabase would replace the stack, which the brief forbids. |
| Modules: SQL Lab, Dashboard & Chart Builder, Automations, **Reports and PPT generation** | SQL Lab, dashboards and charts, alerts and automations (scheduled dashboard digests = "reports") exist. **There is no PPT generation.** | `backend/app/routers/`, `frontend/src/app/(app)/`; no `pptx`/PowerPoint code | VECC is module-agnostic, so nothing is blocked. PPT generation can be registered as a component once it exists. |
| Existing engineering logbook `docs/logbook/` | **Does not exist.** `docs/` holds five integration guides written in this session. `plan.md` is the original product plan. | `ls docs` | Create `docs/logbook/` as part of VECC and backfill it from git history and the existing docs (§6). |
| Existing `/api/*` routes in Next.js | Next.js owns only `/api/auth/*`. Every other `/api/*` is **proxied to FastAPI** (`next.config.ts` rewrite). | `frontend/next.config.ts` | `POST /api/engineering/events` works as requested, implemented in FastAPI at `/engineering/events` behind the existing proxy. Webhooks (GitHub, Vercel) reach FastAPI the same way. |
| Existing middleware | **None** (no `middleware.ts`). Auth is enforced per route: server components call `getSession()`, and FastAPI uses `current_user` dependencies. | file search | No middleware conflict. VECC follows the same per-route pattern. |
| Claude Code hooks | `.claude/` contains **skills only** (10 vendored, pinned in `skills-lock.json`). There are no hooks or `settings.json`. | `ls .claude` | Hooks are new. They'll be added in a committed `.claude/settings.json` and must fail open, so they never block development (§5.6). |

---

## 2. Existing architecture

```
Browser ──▶ Next.js 15 (App Router, TS, Tailwind v4, Base UI / ReUI)
              │  /api/auth/*  → Better Auth (sessions in the shared DB)
              │  /api/*       → rewrite to FastAPI (BACKEND_URL)
              ▼
            FastAPI (Python 3.13, SQLAlchemy 2, Alembic, DuckDB for queries)
              │  security.py: Better Auth session cookie → user → workspace membership
              │  scheduler.py / support_ai/jobs.py: in-process background workers
              ▼
            PostgreSQL 16 + pgvector (prod/docker)  ·  SQLite (local dev, tests)
```

| Area | Current state |
|---|---|
| Repository layout | Monorepo: `frontend/` (Next.js), `backend/` (FastAPI), `docs/`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.claude/skills/` |
| Frontend | Next.js 15.5, React 19.1, TypeScript, Tailwind v4, Base UI + ReUI, TanStack Query, zustand, nuqs, ECharts. Feature folders in `src/features/*`; routes in `src/app/(app)` (signed-in), `(auth)`, `(marketing)`. |
| Backend | FastAPI routers in `app/routers/*` (16), services in `app/*.py` and `app/support_ai/*`. Pydantic validation; per-route auth dependencies. |
| Auth | Better Auth (email + password, Google, Apple), tables owned by Alembic. FastAPI checks the session token against the `session` table. Users belong to **workspaces** (tenants), with roles owner/editor/viewer. |
| Internal admin | **Already exists:** Vyuham staff roles from verified emails (`SUPPORT_ADMIN_EMAILS`, `SUPPORT_STAFF_EMAILS`) in `app/support_ai/access.py`; the internal `/admin/support` dashboard; an **append-only audit log pattern** (`support_audit_log`, written in the same transaction as each change). |
| Database | 14 Alembic revisions. Conventions: 32-character hex string ids (`uuid4().hex`), timezone-aware timestamps, JSON columns, batch operations for SQLite compatibility. pgvector is required on PostgreSQL. |
| Migration execution | `backend/Dockerfile` runs `alembic upgrade head` on container start. CI runs migrations on a fresh Postgres. The applied revision lives in `alembic_version`. |
| Packages | **npm** (`frontend/package-lock.json`, lockfile v3, 863 packages; 51 dependencies + 12 dev). **pip** (`backend/requirements.txt`, 13 pinned; `requirements-dev.txt` adds pytest/httpx). No Python lockfile. |
| Containers | `docker-compose.yml`: `db` (pgvector/pgvector:pg16), `backend` (build), `frontend` (build). No container registry or deploy target in the repo. |
| CI/CD | One workflow (`ci.yml`, on push to `main` and pull requests): backend tests on SQLite and Postgres, migration up/down/up, frontend typecheck, lint, build. **No deployment workflow.** |
| Observability | GlitchTip/Sentry SDK (errors, release = git SHA), Chatwoot (support), AI support engine with its own error ingestion. |
| Secrets | `.env*` git-ignored; `.env.example` templates hold placeholders only. Secrets are read by Pydantic Settings on the backend. |
| Contributors in history | 20 commits: 16 by "Claude", 4 by the owner. |

---

## 3. Recommended integration points

| VECC part | Integration point | Why |
|---|---|---|
| Database | New Alembic revision(s) creating `vecc_*` tables (the 10 the brief names), following existing conventions, **except UUID primary keys as the brief asks** (native `uuid` on PostgreSQL, `CHAR(32)` on SQLite) | One migration system; reviewed like every other change |
| Ingestion API | New FastAPI package `backend/app/vecc/` (adapters, normalizer, redaction, ingestion service) and router `/engineering/*`, reached as `/api/engineering/*` | Matches every other API; keeps secrets server-side |
| Machine authentication | Per-source **ingestion tokens** (hashed at rest, scoped to source and environment, revocable), plus **HMAC signature verification** for GitHub and Vercel webhooks | Clients never assert their own identity; the token decides source and environment |
| Human authentication | Reuse Better Auth sessions + a new `ENGINEERING_ADMIN_EMAILS` role (verified emails), checked server-side on every route, the same pattern as `support_ai/access.py` | Proven pattern; least privilege, separate from support staff |
| Portal | `frontend/src/app/(app)/engineering-control-center/*` server-checked routes + `src/features/vecc/*`, using the existing components (Tabs, Table, Sheet, Badge, NativeSelect, ECharts theme) | Same look and structure as `/admin/support` |
| Background work | Reuse the DB-backed job queue pattern (`support_ai/jobs.py`) for retries and the dead-letter queue | Already tested; survives restarts; works with several workers |
| Claude Code | Committed `.claude/settings.json` with `PostToolUse` hooks calling a small script that posts to the ingestion API with a token | Hooks are the supported mechanism; explicit events cover what hooks can't see |
| GitHub | GitHub webhook → `/api/engineering/webhooks/github`; plus a CI step that posts workflow and migration results with a CI token | Covers commits, PRs, merges, releases, workflow runs |
| Packages | A collector (CLI and CI step) diffing `package.json` + `package-lock.json` and `requirements*.txt` between two commits | Deterministic; evidence is the commit pair and the lockfile hashes |
| Migrations | Two separate facts: **migration files** (from the repo) and **migration execution** (an Alembic hook / start script reports `alembic upgrade` start, end, result and DB revision) | The brief's rule: a file existing ≠ applied |
| Deployments | GitHub Actions deployment events, and a Vercel deployment webhook if the project is on Vercel. Rollback recorded as a deployment referencing an earlier SHA. | Only report what a platform confirms |
| Docker | Collector parsing `Dockerfile`s and `docker-compose.yml` → *configured* services. *Running* services only from an explicit runtime report (container start event) | The brief: distinguish configured from running |
| Logbook | `docs/logbook/` (new) + a generator that writes logbook entries from VECC events for VECC itself | The logbook doesn't exist yet |

---

## 4. Potential conflicts and risks

| Risk | Detail | Mitigation |
|---|---|---|
| **Repository identity** | The brief's repository and site may be a different codebase | Confirm before Phase 2 (D1) |
| **Supabase requirements** | RLS and service-role keys are Supabase terms | Same guarantees with PostgreSQL: append-only triggers, a separate ingestion DB role with `INSERT`/`SELECT` only, and RLS on VECC tables for the app role. Documented as equivalents. |
| Single DB role today | The app uses one `DATABASE_URL` user, which likely owns the tables. Owners bypass grants and (by default) RLS. | Triggers enforce append-only for **every** role, the owner included. Optional hardening: a dedicated `vecc_writer` role and connection, documented in the configuration guide. |
| SQLite in dev/tests | No RLS or roles | SQLite triggers (`RAISE(ABORT)`) give the same append-only behaviour; PostgreSQL-only protections are tested in CI's Postgres job |
| CI already red? | The Postgres job runs `alembic downgrade base`, which fails in a pre-existing migration (`type "datetime" does not exist`) | Not caused by VECC; flagged earlier. VECC migrations must downgrade cleanly; the old migration should be fixed separately. |
| Hooks slowing development | A failing hook could block Claude Code | Hooks run asynchronously, time out quickly, never block, and spool locally if the API is down (then replay) |
| Event volume | Hooks on every file edit can be noisy | File events are batched per session and coalesced; "important file" rules decide what becomes an event |
| Secrets in payloads | Commit messages, diffs, env files and command lines can contain secrets | One redaction layer on ingestion (reusing and extending `support_ai/redact.py`). Env files are reduced to **names only**. Diffs are never stored, only paths and counts. |
| Prompt injection | Event text (commit messages, PR titles) is untrusted | Stored and rendered as text only; never interpreted, never sent to an LLM by VECC, never used to build commands or SQL |
| Fake "success" | Sources can claim success | Status is derived from evidence (`requested → attempted → completed → verified`, or `failed`). Only verifiable sources (signed webhook, CI with run URL, DB revision check) can produce **verified**. |

---

## 5. Security considerations (design commitments)

1. **Portal access:** Better Auth session + verified email in `ENGINEERING_ADMIN_EMAILS`, checked on
   the server for every page and API call; 404 otherwise.
2. **Ingestion access:** a per-source bearer token (random 256-bit, stored as SHA-256, shown once) bound
   to one source and an allowed set of environments; webhooks additionally use HMAC
   (GitHub `X-Hub-Signature-256`, Vercel `x-vercel-signature`) checked in constant time.
3. **Identity is never taken from the payload.** The authenticated token or signature decides the
   source; actor fields from payloads are stored as *claimed* until a verifiable source confirms them.
4. **Append-only history:** `audit_events` rejects `UPDATE` and `DELETE` with database triggers (all
   roles). Corrections are new events referencing the original (`supersedes`). Archival moves rows
   to an archive table through a single privileged, audited function.
5. **Idempotency:** a unique `(source, idempotency_key)` constraint; webhooks use the delivery id;
   a replay returns the original event.
6. **Replay protection:** signed webhooks have a delivery id plus a timestamp window where the
   platform supplies one; token clients send a timestamp that must be within ±5 minutes.
7. **Rate limiting:** per token and per IP, counted in the database (the pattern used by the support
   engine).
8. **Redaction:** secret-shaped strings, credential URLs, JWTs, cookies and key=value secrets are
   removed before storage. Configuration events carry **variable names and safe metadata only**,
   never values.
9. **No execution:** no event field is ever executed, evaluated or interpolated into SQL (SQLAlchemy
   parameters only).
10. **Failures are visible:** rejected and failed events go to a dead-letter table with the reason.
    Per-source health is shown on the portal.

---

## 6. Proposed implementation plan

Each phase ends with tests, a docs update and a logbook entry. Nothing is reported complete without
evidence.

| Phase | Delivers | Evidence of completion |
|---|---|---|
| **1** | This audit | This document (committed) |
| **2** | Alembic migration for the 10 tables plus append-only triggers, a dead-letter table and an ingestion token table; `app/vecc/` normalizer, redaction, idempotency, rate limits; `POST /api/engineering/events`; token management (admin only) | Tests: auth, validation, idempotency, redaction, append-only on SQLite **and** PostgreSQL, rate limits, dead-letter |
| **3** | Portal shell (`/engineering-control-center`), overview, timeline with search, filters and pagination, event details, CSV/JSON export | Tests for search, filter and pagination; browser test; unauthorized → 404 |
| **4** | Component inventory and lifecycle (statuses as in the brief; "production ready" only with explicit evidence), component details | Lifecycle transition tests |
| **5** | GitHub webhook adapter (push, PR, merge, release, workflow run, deployment) with signatures, replay protection and idempotency; setup guide | Signature and replay tests using GitHub's documented examples |
| **6** | Claude Code hooks + spool/replay script + explicit event CLI | Hook script tests; a recorded session in the logbook |
| **7** | Package diff collector (npm lockfile v3, pip requirements) + CI step | Diff tests: add, remove, upgrade, downgrade |
| **8** | Migration tracking: files vs execution, with the execution reporter wired into the backend start command and CI | Tests: a file without execution stays "not applied" |
| **9** | Deployments (GitHub Actions; Vercel webhook if used; rollbacks) and Docker configured-vs-running | Adapter tests |
| **10** | Security and audit reports, export, source health, full test pass, final docs | Testing report with results |

**Backfill.** On first run, VECC imports the *existing* history as events with source `backfill`,
status `verified` only where the evidence is in git: the 20 commits, the dependency set at each
commit, the 14 migration files, and docker-compose services. Migration **execution** history isn't
in git, so backfilled migrations are recorded as files with execution status `unknown`.

---

## 7. What VECC will deliberately *not* do

- Store diffs, file contents, environment values or command output that may contain secrets.
- Mark anything successful without evidence. Unverifiable claims stay `unverified`.
- Run commands, SQL or deployments in response to events.
- Replace the existing stack or touch existing modules beyond a sidebar link for engineering admins
  and the hooks and CI steps listed above.

---

## 8. Decisions needed before Phase 2

| # | Question | Recommendation |
|---|---|---|
| **D1** | Is this repository (`mmahesh09/Vyuham-`, FastAPI + PostgreSQL + Better Auth) the Vyuham you want VECC built in? If `mmahesh09/Vyuham` is a different, Supabase-based codebase, it needs to be attached to the session and audited instead. | Build here, if it is the same project. |
| **D2** | Implement the "Supabase" requirements with PostgreSQL + Alembic equivalents (no Supabase added)? | Yes. Adding Supabase would replace the stack. |
| **D3** | Who can access VECC? | A new `ENGINEERING_ADMIN_EMAILS` list, separate from support staff |
| **D4** | Deployment platform for Phase 9: Vercel (frontend), and where does the backend run? | Answer when we reach Phase 9; adapters for GitHub Actions and Vercel are planned either way |
