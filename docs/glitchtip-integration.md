# GlitchTip error monitoring

Vyuham's Next.js frontend reports errors to [GlitchTip](https://glitchtip.com), an open-source,
self-hostable error tracker that speaks the Sentry protocol. We use the official Sentry Next.js SDK
(`@sentry/nextjs` v10) pointed at our own GlitchTip.

**Monitoring is off until a DSN is set.** Without `NEXT_PUBLIC_GLITCHTIP_DSN`, the app sends
nothing and behaves exactly as before.

- [1. What gets reported](#1-what-gets-reported)
- [2. Privacy: what is never sent](#2-privacy-what-is-never-sent)
- [3. GlitchTip: services, configuration, storage](#3-glitchtip-services-configuration-storage)
- [4. Development setup](#4-development-setup)
- [5. Production deployment](#5-production-deployment)
- [6. Vyuham configuration reference](#6-vyuham-configuration-reference)
- [7. Environments and releases](#7-environments-and-releases)
- [8. Source maps](#8-source-maps)
- [9. Testing](#9-testing)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Code map](#11-code-map)

---

## 1. What gets reported

| Where | What | How |
|---|---|---|
| Browser | Uncaught exceptions, unhandled promise rejections | SDK global handlers (`src/instrumentation-client.ts`) |
| Browser | Crashes that escape every boundary, including the root layout | `src/app/global-error.tsx` (renders Next's built-in error page, unchanged for users) |
| Browser | FastAPI **5xx** responses | `api()` in `src/lib/api/client.ts`; the UI still shows its usual message |
| Server (Node) | Errors in server components, route handlers, server actions | `onRequestError` in `src/instrumentation.ts` |
| Server (Node) | Backend unreachable or failing during the session check | `getSession()` in `src/lib/api/server.ts`, level `warning` |
| Server (Node) | Email provider (Resend) refusing a message | `sendEmail()` in `src/lib/email.ts`, without recipient or body |
| Edge | Errors in edge route handlers / middleware | `src/lib/monitoring/init-edge.ts` |

**Deliberately not reported** (filtered in `src/lib/monitoring/options.ts`):

- `ApiError` with a 4xx status: validation errors, signed out, forbidden. These are normal, already
  shown to the user, and would bury real bugs.
- `redirect()` / `notFound()`: Next.js control flow, not failures.
- The browser's redacted copy of a server-component crash ("An error occurred in the Server
  Components render…"): the server already reported the real error with the same digest.

Existing error handling is unchanged. Reporting was added next to it; nothing was replaced.

Performance tracing, session replay and the feedback widget are **off**. Only errors are sent.

## 2. Privacy: what is never sent

Every event and breadcrumb passes through `src/lib/monitoring/scrub.ts` before it leaves the
browser or server, and `sendDefaultPii` is `false`.

| Data | Treatment |
|---|---|
| Cookies, `Authorization` and every other request header | Dropped. Only `user-agent` is kept. |
| Request bodies, form data, uploaded files, SQL, dataset rows | Dropped (`request.data` is removed; bodies are removed from breadcrumbs) |
| IP address, email, name, username | Never attached. The user is identified only by the opaque Vyuham user id. |
| Share and invite links (`/s/<token>`, `/invite/<token>`) | Token replaced with `[token]` everywhere: URLs, breadcrumbs, transaction names |
| Query values for `token`, `code`, `state`, `email`, `password`, `key`, `secret`, `sig`, `signature`, `callbackURL` | Replaced with `[Filtered]`. Other query values are kept for debugging. |
| Email addresses and `Bearer …` tokens inside error messages | Masked as `[email]` / `Bearer [Filtered]` |
| Any field named like a secret (`password`, `token`, `secret`, `auth`, `cookie`, `session`, `api_key`, `dsn`, `credential`, `signature`, `email`, `phone`) in extra data, tags, contexts or breadcrumbs | `[Filtered]` |
| Console log arguments | Dropped (message text kept, emails masked) |
| Stack-frame local variables | Dropped |

**Secrets that never reach the browser bundle:** `SENTRY_AUTH_TOKEN`, `GLITCHTIP_DSN` (server
DSN), `GLITCHTIP_TUNNEL`, `GLITCHTIP_TEST_PAGE`. Only variables prefixed `NEXT_PUBLIC_` are
bundled. The browser DSN is public by design: it can only *submit* events to one project.

When adding new reporting, follow the same rules: report status codes and opaque ids, never
payloads, emails or tokens.

## 3. GlitchTip: services, configuration, storage

> The code lives on GitLab (`gitlab.com/glitchtip`). `github.com/glitchtip/glitchtip` holds only
> a profile README. This guide follows **GlitchTip 7.0** (released Nov 2026), which changed the
> architecture. The published install guide's sample compose file still shows the older
> web + worker split.

### Recommended deployment

**Docker Compose on a single server behind nginx with TLS** is the official recommendation for
most installs. Kubernetes users can use the official Helm chart; managed options are PikaPods,
Elestio and DigitalOcean App Platform.

### Services

| Service | Required | Notes |
|---|---|---|
| `glitchtip/glitchtip` | Yes | Since 7.0 **one process** runs the web server, task worker and scheduler. Scale by adding replicas of the same container. There is no separate worker any more. |
| PostgreSQL | Yes | **15 or newer** (enforced in 7.0). Recommended: `max_locks_per_transaction=512`. |
| Valkey / Redis | Optional | Cache and task broker; improves performance. Set `VALKEY_URL` (or legacy `REDIS_URL`); empty string disables it. Its data does not need backups. |
| Reverse proxy (nginx) | Yes in production | TLS termination, request buffering, `client_max_body_size 40M` for source-map uploads. |

Sizing: 1 GB RAM recommended (512 MB + swap minimum). Roughly 30 GB disk per 1 million events/month.

### Environment variables

Required:

| Variable | Example | Purpose |
|---|---|---|
| `SECRET_KEY` | `openssl rand -hex 32` | Django secret. GlitchTip refuses the default in production. |
| `DATABASE_URL` | `postgres://glitchtip:…@postgres:5432/glitchtip` | PostgreSQL connection |
| `GLITCHTIP_DOMAIN` | `https://glitchtip.example.com` | Public URL, with scheme. Used in DSNs and emails (alias: `GLITCHTIP_URL`). |
| `DEFAULT_FROM_EMAIL` | `glitchtip@example.com` | Sender for alerts and invites |
| `EMAIL_URL` | `smtp://user:pass@smtp.example.com:587` | SMTP. `consolemail://` prints mail to logs (dev only). Mailgun/SendGrid alternatives exist. |

Recommended for production:

| Variable | Value | Why |
|---|---|---|
| `ALLOWED_HOSTS` | `glitchtip.example.com` | Defaults to `*`; GlitchTip warns at startup |
| `CSRF_TRUSTED_ORIGINS` | `https://glitchtip.example.com` | Set it if logins or forms fail with CSRF errors behind the TLS proxy |
| `ENABLE_USER_REGISTRATION` | `false` | Stop strangers signing up after the first (admin) user |
| `ENABLE_ORGANIZATION_CREATION` | `false` (default) | Only superusers create organizations |
| `GLITCHTIP_RETENTION_DAYS` | `90` (default) | Event retention. **Renamed in 7.0** from `GLITCHTIP_MAX_EVENT_LIFE_DAYS`; the old name is ignored and retention falls back to the default. |
| `GLITCHTIP_FILE_RETENTION_DAYS` | default = retention days | Retention for uploaded files such as source maps |
| `TRUSTED_PROXIES` | `private` (default) | Which proxies' `X-Forwarded-For` is trusted. Use `cloudflare` or explicit networks if applicable. |
| `VALKEY_URL` | `redis://valkey:6379/0` | Optional cache/broker |

### Storage

| What | Where | Back up? |
|---|---|---|
| Events, issues, users, projects | PostgreSQL volume | **Yes**, `pg_dump` daily |
| Uploaded source maps and symbol caches | `/code/uploads` in the container (mount a volume), or S3 / GCS / Azure | Optional: can be re-uploaded by rebuilding a release |
| Valkey | Memory | No |

S3-compatible storage: set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_STORAGE_BUCKET_NAME`
and `AWS_S3_ENDPOINT_URL` (any non-AWS provider). Use a **private** bucket.

## 4. Development setup

### 4.1 Run GlitchTip locally

Save as `glitchtip-dev/compose.yml` **outside the repository** (or anywhere git-ignored):

```yaml
# GlitchTip 7 for local development. Not for production: no TLS, console email.
x-environment: &env
  DATABASE_URL: postgres://glitchtip:glitchtip@postgres:5432/glitchtip
  VALKEY_URL: redis://valkey:6379/0
  SECRET_KEY: ${GLITCHTIP_SECRET_KEY:-dev-only-change-me-0123456789abcdef0123456789abcdef}
  GLITCHTIP_DOMAIN: http://localhost:8001
  DEFAULT_FROM_EMAIL: glitchtip@localhost
  EMAIL_URL: consolemail://
  GLITCHTIP_RETENTION_DAYS: "30"
  PORT: "8000"

services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: glitchtip
      POSTGRES_PASSWORD: glitchtip
      POSTGRES_DB: glitchtip
    volumes: [pg-data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U glitchtip"]
      interval: 3s
      retries: 30
  valkey:
    image: valkey/valkey:8
  glitchtip:
    image: glitchtip/glitchtip:7.0
    depends_on:
      postgres: { condition: service_healthy }
      valkey: { condition: service_started }
    environment: *env
    ports: ["8001:8000"]   # Vyuham uses 3000 and FastAPI 8000
    volumes: [uploads:/code/uploads]

volumes:
  pg-data:
  uploads:
```

```bash
docker compose up -d
# wait until this prints 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8001/api/settings/
```

Migrations run automatically on start.

### 4.2 Create the project and keys

1. Open <http://localhost:8001>, register (the first user becomes the admin), create an
   organization, e.g. `vyuham-dev`.
2. Create a project with platform **Next.js**, e.g. `vyuham-frontend`.
3. Copy the **DSN** from the project's Issues page or *Settings → Client keys*.
4. For source maps (optional in dev): *Profile → Auth tokens → Create* with scopes
   `project:read`, `project:write`, `project:releases`, `org:read`.

### 4.3 Configure Vyuham

In `frontend/.env.local` (git-ignored, never commit it):

```bash
NEXT_PUBLIC_GLITCHTIP_DSN=http://<key>@localhost:8001/<project-id>
NEXT_PUBLIC_APP_ENV=development
GLITCHTIP_TEST_PAGE=true        # enables /debug/glitchtip
```

Then `npm run dev`, open <http://localhost:3000/debug/glitchtip> and click the buttons
(see [Testing](#9-testing)). Source maps are not needed in `next dev`.

## 5. Production deployment

### 5.1 Server

A small VM (1 vCPU, 1–2 GB RAM, 40 GB disk) with Docker and the Compose plugin. Point a DNS
name, e.g. `glitchtip.example.com`, at it.

### 5.2 Secrets file

Create `/opt/glitchtip/.env` with `chmod 600` on the server. It is not part of any repository:

```bash
SECRET_KEY=<openssl rand -hex 32>
POSTGRES_PASSWORD=<openssl rand -hex 24>
EMAIL_URL=smtp://<user>:<url-encoded-password>@smtp.example.com:587
```

### 5.3 `/opt/glitchtip/compose.yml`

```yaml
x-environment: &env
  DATABASE_URL: postgres://glitchtip:${POSTGRES_PASSWORD}@postgres:5432/glitchtip
  VALKEY_URL: redis://valkey:6379/0
  SECRET_KEY: ${SECRET_KEY}
  EMAIL_URL: ${EMAIL_URL}
  GLITCHTIP_DOMAIN: https://glitchtip.example.com
  DEFAULT_FROM_EMAIL: glitchtip@example.com
  ALLOWED_HOSTS: glitchtip.example.com
  CSRF_TRUSTED_ORIGINS: https://glitchtip.example.com
  ENABLE_USER_REGISTRATION: "false"
  GLITCHTIP_RETENTION_DAYS: "90"
  PORT: "8000"

services:
  postgres:
    image: postgres:17
    command: ["postgres", "-c", "max_locks_per_transaction=512"]
    environment:
      POSTGRES_USER: glitchtip
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: glitchtip
    volumes: [pg-data:/var/lib/postgresql/data]
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U glitchtip"]
      interval: 5s
      retries: 30
  valkey:
    image: valkey/valkey:8
    restart: unless-stopped
  glitchtip:
    image: glitchtip/glitchtip:7.0      # pin a minor version; upgrade deliberately
    depends_on:
      postgres: { condition: service_healthy }
      valkey: { condition: service_started }
    environment: *env
    ports: ["127.0.0.1:8000:8000"]      # only nginx can reach it
    volumes: [uploads:/code/uploads]
    restart: unless-stopped

volumes:
  pg-data:
  uploads:
```

With `ENABLE_USER_REGISTRATION=false` the first user can still register (and becomes the admin);
sign-up closes after that. Add teammates through organization invites, or create accounts with
`docker compose exec glitchtip ./manage.py createsuperuser`.

### 5.4 nginx + TLS

```nginx
server {
    server_name glitchtip.example.com;
    client_max_body_size 40M;            # source-map uploads

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then `certbot --nginx -d glitchtip.example.com`. Always serve GlitchTip over HTTPS in production:
DSNs and auth tokens travel in requests to it.

### 5.5 Operations

- **Backups:** `docker compose exec -T postgres pg_dump -U glitchtip glitchtip | gzip > glitchtip-$(date +%F).sql.gz`, run daily from cron, copied off the server.
- **Upgrades:** read the [CHANGELOG](https://gitlab.com/glitchtip/glitchtip-backend/-/blob/master/CHANGELOG) first, bump the image tag, `docker compose pull && docker compose up -d`. Migrations run on start.
- **Upgrading an existing 5.x/6.x install to 7.0:** upgrade PostgreSQL to 15+ first, then to the latest 6.x, let it migrate, then to 7.0. Remove any separate worker service, and rename retired variables (`GLITCHTIP_MAX_EVENT_LIFE_DAYS` → `GLITCHTIP_RETENTION_DAYS` etc.). An ignored retention variable **deletes data** older than the default.
- **Alerts:** *Project settings → Project alerts*. Email, webhook and Slack are supported, and since 7.0 can be filtered by environment (e.g. only `production`).

### 5.6 Staging

Either a second project in the same GlitchTip (separate DSN, cleaner) or the same project with
`NEXT_PUBLIC_APP_ENV=staging` and environment-filtered alerts. Both work; separate projects are
simpler to reason about.

## 6. Vyuham configuration reference

All optional. A template is in `frontend/.env.example`. Real values go in `.env.local` (dev) or
your host's secret settings (Vercel, CI, Docker); `.env*` files are git-ignored.

| Variable | When read | Public? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_GLITCHTIP_DSN` | **Build** (inlined) | Yes, by design | Browser DSN; also the server DSN if `GLITCHTIP_DSN` is unset. Empty = monitoring off. |
| `GLITCHTIP_DSN` | Runtime | No | Optional separate DSN for server/edge events |
| `NEXT_PUBLIC_APP_ENV` | **Build** | Yes | `development` / `staging` / `production` |
| `NEXT_PUBLIC_APP_RELEASE` | **Build** | Yes | Release name; defaults to the git SHA |
| `NEXT_PUBLIC_GLITCHTIP_TRACES_SAMPLE_RATE` | **Build** | Yes | 0–1, default `0` (no tracing) |
| `GLITCHTIP_TUNNEL` | Build **and** runtime | No | `true` routes browser events through `/sentry-tunnel` (past ad blockers) |
| `GLITCHTIP_TEST_PAGE` | Runtime | No | `true` enables `/debug/glitchtip` (always 404 in production) |
| `SENTRY_URL` | Build | No | GlitchTip base URL for source-map upload |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Build | No | GlitchTip organization / project **slugs** (case-sensitive since 7.0) |
| `SENTRY_AUTH_TOKEN` | Build | **Secret** | Enables source-map upload. Store in CI/host secrets only. |

"Build" means the value is baked in by `next build`, so changing it requires a rebuild.

### Per environment

| | Development | Staging | Production |
|---|---|---|---|
| `NEXT_PUBLIC_GLITCHTIP_DSN` | local GlitchTip, or empty | staging project | production project |
| `NEXT_PUBLIC_APP_ENV` | `development` | `staging` | `production` |
| `SENTRY_AUTH_TOKEN` + `SENTRY_*` | not needed | set in CI | set in CI |
| `GLITCHTIP_TEST_PAGE` | `true` when testing | `true` briefly when verifying | ignored (always 404) |
| `GLITCHTIP_TUNNEL` | `false` | optional | optional |

### Vercel

Add the variables in *Project → Settings → Environment Variables*, scoped per environment
(Production / Preview). Mark `SENTRY_AUTH_TOKEN` as **Sensitive**. If `NEXT_PUBLIC_APP_ENV` is
unset, Vercel production maps to `production` and previews to `staging`, and the release
defaults to `VERCEL_GIT_COMMIT_SHA`.

### Docker

The frontend `Dockerfile` copies the source without `.git`, and `NEXT_PUBLIC_*` values are
baked in at build, so pass them as build args, e.g. add to the build stage:

```dockerfile
ARG NEXT_PUBLIC_GLITCHTIP_DSN NEXT_PUBLIC_APP_ENV NEXT_PUBLIC_APP_RELEASE
ENV NEXT_PUBLIC_GLITCHTIP_DSN=$NEXT_PUBLIC_GLITCHTIP_DSN NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV NEXT_PUBLIC_APP_RELEASE=$NEXT_PUBLIC_APP_RELEASE
```

Pass `SENTRY_AUTH_TOKEN` as a [BuildKit secret](https://docs.docker.com/build/building/secrets/),
**not** as a build arg, because args are stored in the image history.

> Heads-up (pre-existing, not changed here): `frontend/.dockerignore` excludes `.env*.local` but
> not `.env`, so a `frontend/.env` file would be copied into the image. Consider adding `.env*`
> and `!.env.example` to it.

## 7. Environments and releases

Both are computed once in `frontend/next.config.ts` and baked into client and server bundles, so
browser and server events always agree.

- **Environment:** `NEXT_PUBLIC_APP_ENV`, else `VERCEL_ENV` (`production` → production,
  `preview` → staging), else `NODE_ENV`. Set it explicitly on every deployment; a self-hosted
  staging build without it would report as `production`.
- **Release:** `NEXT_PUBLIC_APP_RELEASE`, else `VERCEL_GIT_COMMIT_SHA`, else `GITHUB_SHA`, else
  `git rev-parse HEAD`. With a token set, the build also creates and finalizes the release in
  GlitchTip and ties the uploaded source maps to it.

GlitchTip's issue view then shows *first seen / last seen* per release, so you can tell whether a
deploy introduced or fixed an issue.

## 8. Source maps

Production bundles are minified. Source maps make GlitchTip show the original file and line.

**How it works:**

1. `next build` (Turbopack) emits maps.
2. When `SENTRY_AUTH_TOKEN` is set, `withSentryConfig` injects a **debug ID** into each JS file and
   its map, uploads them to GlitchTip as an *artifact bundle* tied to the release, then **deletes
   the browser maps from `.next/static`** so they are never served to the public.
3. At runtime the SDK sends the debug IDs with each event; GlitchTip matches them to the
   uploaded maps.

**Security:**

- The token is only read at build time and never gets a `NEXT_PUBLIC_` prefix, so it is not in
  any bundle (verified: no build output contains it).
- Give the token only `project:read`, `project:write`, `project:releases`, `org:read`. Prefer a
  token belonging to a dedicated "CI" GlitchTip user.
- `.next/static` contains **no** `.map` files after an upload build (verified). `.next/server`
  keeps server-side maps, which Next.js generates anyway; they are not web-accessible.
- If GlitchTip is unreachable during a build, the upload error is printed as a warning and the
  deploy continues without readable stack traces, so a GlitchTip outage never blocks a release.
- Build telemetry to sentry.io is disabled (`telemetry: false`).

**Known limitation (GlitchTip 7.0.0):** Turbopack names some *server* chunks
`[root-of-the-server]__….js`. Their source-map references are URL-encoded
(`%5Broot-of-the-server%5D….js.map`) and GlitchTip stores those files without their map
(it compares names exactly in `apps/files/assemble.py`). Effect: **server-component render
errors** from those chunks show minified frames. The error message, route, release,
environment and digest are still correct. Browser errors and route-handler errors are fully
readable (verified). Options if this matters: report it upstream to GlitchTip (decode the
`Sourcemap` header when pairing files), or use the digest to find the full stack in the server
logs.

## 9. Testing

### Sample errors

1. Set `GLITCHTIP_TEST_PAGE=true` (runtime) with a DSN configured, in dev or staging.
2. Open `/debug/glitchtip`. It shows the environment and release it will report.
3. Click each button:

| Button | Expected GlitchTip issue |
|---|---|
| Browser: unhandled exception | `GlitchTip test: unhandled browser exception` |
| Browser: unhandled promise rejection | `GlitchTip test: unhandled promise rejection` |
| Browser: captured exception | `GlitchTip test: captured browser exception` |
| Browser: render crash | `GlitchTip test: browser render crash` (Next's standard error page appears) |
| Server: route handler error | `GlitchTip test: Node route handler error` |
| Edge: route handler error | `GlitchTip test: Edge route handler error` |
| Server: server component crash | `GlitchTip test: server component crash` (Next's standard error page with a digest) |

4. In GlitchTip, check each issue's environment and release tags, and (in a source-map build) that
   browser frames point at `test-buttons.tsx` with the source line shown.
5. Turn `GLITCHTIP_TEST_PAGE` off again and resolve the test issues.

The page and its routes return 404 unless `GLITCHTIP_TEST_PAGE=true`, and always when
`NEXT_PUBLIC_APP_ENV=production`.

### Privacy check

Visit `/debug/glitchtip?token=abc&email=someone%40example.com&tab=x` and trigger an error. The
event's URL must read `?token=[Filtered]&email=[Filtered]&tab=x`, and it must have no cookies and
no user other than an id.

### What was verified during implementation

Against a real GlitchTip 7.0 (Docker), with a production build of Vyuham:

- All 7 sample errors arrived with environment `staging` and the expected release (both git SHA
  and an explicit `NEXT_PUBLIC_APP_RELEASE`).
- Browser and route-handler stack traces resolved to original source lines via uploaded maps.
- Fake token, email and session cookie added to the request were absent from every stored event.
- With `GLITCHTIP_TUNNEL=true`, the browser sent events only to the app's own `/sentry-tunnel`.
- With no GlitchTip variables set, the build makes **no** external requests, `/debug/glitchtip`
  and `/sentry-tunnel` return 404, and error pages look exactly as before.
- Typecheck passes; lint is unchanged (0 errors, same 62 existing warnings).

Cost: the SDK adds about 54 kB to the shared first-load JavaScript (201 → 255 kB as reported by
`next build`).

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| Nothing arrives | Is `NEXT_PUBLIC_GLITCHTIP_DSN` set **at build time**? Look for requests to `/api/<id>/envelope/` (or `/sentry-tunnel`) in the browser's network tab. Is GlitchTip reachable from the browser (HTTPS, CORS, firewall)? |
| Browser events missing, server events fine | An ad blocker. Enable `GLITCHTIP_TUNNEL=true` (set at build and at runtime). |
| Wrong environment | `NEXT_PUBLIC_APP_ENV` is baked at build; rebuild after changing it. |
| Minified browser stack traces | Was `SENTRY_AUTH_TOKEN` set for *that* build? Check the build log for "Uploaded files" and the release name. Do `SENTRY_ORG` / `SENTRY_PROJECT` match the slugs exactly (case-sensitive in 7.0)? |
| `upload failed` warning in build | GlitchTip down or token scopes missing; the app still deploys. |
| 413 on upload | Raise `client_max_body_size` in nginx. |
| Build warns "Found src/app/sentry-tunnel/route.ts, but the `tunnelRoute` option is not set" | Expected while the tunnel is disabled. Harmless. |

## 11. Code map

| File | Role |
|---|---|
| `frontend/src/instrumentation-client.ts` | Browser SDK init |
| `frontend/src/instrumentation.ts` | Server/edge init and `onRequestError` |
| `frontend/src/lib/monitoring/init-server.ts`, `init-edge.ts` | Runtime-specific init |
| `frontend/src/lib/monitoring/options.ts` | Shared options: DSN gate, environment, release, sampling, expected-error filter |
| `frontend/src/lib/monitoring/scrub.ts` | Privacy filter for events and breadcrumbs |
| `frontend/src/app/global-error.tsx` | Reports root-level crashes; renders Next's default page |
| `frontend/src/app/sentry-tunnel/route.ts` | Optional same-origin relay (no cookies forwarded, own DSN only) |
| `frontend/src/app/debug/glitchtip/*` | Opt-in sample-error page and routes |
| `frontend/next.config.ts` | Environment/release injection and `withSentryConfig` (source maps, tunnel) |
| `frontend/src/lib/api/client.ts`, `api/server.ts`, `email.ts`, `providers/app-providers.tsx` | Added reporting for 5xx, backend outages, email failures; opaque user id |

The FastAPI backend is not instrumented yet. It can report to the same GlitchTip with
`sentry-sdk[fastapi]` and its own DSN; apply the same privacy rules (`send_default_pii=False`, no
request bodies).
