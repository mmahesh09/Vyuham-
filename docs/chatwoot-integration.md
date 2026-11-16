# Chatwoot customer support

Vyuham uses [Chatwoot](https://github.com/chatwoot/chatwoot) (open source, self-hosted) for customer
support. Chatwoot runs as its **own service on its own domain with its own database**. Vyuham embeds
its website widget for signed-in customers and talks to its API from the backend only.

**Support is off until configured.** With no `CHATWOOT_*` settings, no widget loads, no request goes
to Chatwoot, and the Help & Support page says support isn't set up yet.

- [1. What customers get](#1-what-customers-get)
- [2. How it fits together](#2-how-it-fits-together)
- [3. Security model](#3-security-model)
- [4. Deploying Chatwoot](#4-deploying-chatwoot)
- [5. Configuring the Vyuham support inbox](#5-configuring-the-vyuham-support-inbox)
- [6. Configuring Vyuham](#6-configuring-vyuham)
- [7. Webhook events](#7-webhook-events)
- [8. Testing](#8-testing)
- [9. Operations and privacy](#9-operations-and-privacy)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Code map](#11-code-map)

> Note on the stack: Vyuham does **not** use Supabase. Sign-in is Better Auth (Next.js), the API is
> FastAPI, and data is PostgreSQL (SQLite locally). Tenants are **workspaces**.

---

## 1. What customers get

- **Chat widget** on every page of the signed-in app (not on public marketing pages), already
  signed in as them. History is kept, and if they leave, agents can reply by email.
- **Help & Support** in the sidebar, opening `/support` with:
  - **Contact support:** opens the chat.
  - **Your conversations:** their own conversations in the Vyuham inbox with status, last public
    message and unread count. "Open" brings up the chat; Chatwoot's own widget shows the thread.
  - **Help documentation:** a link to the Chatwoot Help Center (portal), when configured.
  - **Report a problem:** a short form that opens a conversation labelled `problem-report` with
    useful context for agents.
- **Bell notifications** when an agent replies or resolves their conversation.

Everything chat-related is Chatwoot's own UI and features; Vyuham does not reimplement messaging,
history, email follow-up, the help center or the agent dashboard.

## 2. How it fits together

```
 Browser (signed in) ── widget (website token + signed identity) ──▶ Chatwoot
   │
   └─ /api/support/*  ─▶ FastAPI ── API token (server only) ──▶ Chatwoot Application API
         identity from the session cookie

 Chatwoot ── signed webhook ──▶ /api/support/chatwoot/webhook (FastAPI)
              verify HMAC + timestamp, de-duplicate ──▶ in-app notification (bell)
```

| Endpoint (FastAPI, behind `/api` in Next.js) | Auth | Purpose |
|---|---|---|
| `GET /support/config` | session | Enabled flag, widget base URL and website token (public), help center URL |
| `GET /support/identity` | session | The current person's signed widget identity |
| `GET /support/conversations` | session | The current person's conversations in the Vyuham inbox |
| `POST /support/report` | session | "Report a problem": opens a labelled conversation |
| `POST /support/chatwoot/webhook` | Chatwoot signature | Incoming support events |

## 3. Security model

| Requirement | How it is met |
|---|---|
| API tokens never in frontend code | `CHATWOOT_API_TOKEN`, `CHATWOOT_HMAC_TOKEN` and `CHATWOOT_WEBHOOK_SECRET` are backend settings only. `/support/config` returns only the website token, which Chatwoot designs to be public. Verified by a test that greps the response. |
| Don't trust browser-supplied customer ids | The backend never reads an identifier from the request. Identity is `vyuham:<workspace_id>:<user_id>`, built from the Better Auth session (`current_user` / `current_membership`). Query parameters naming someone else are ignored (tested). |
| Identity verified by Chatwoot | The widget sends `identifier_hash = HMAC-SHA256(inbox secret, identifier)`, computed server-side. With **Enforce user identity validation** on, Chatwoot rejects anything else. Verified live: setting another customer's identifier, with a valid signature for a different identifier or a made-up one, got `401` from Chatwoot. |
| Tenant isolation | The workspace is part of the identifier, so support history never follows a person into another workspace. Contact custom attribute `workspace_id` lets agents see the tenant. Webhook events only notify a user who is *currently* a member of the workspace in the identifier. |
| No access to another customer's conversations | The list endpoint looks the contact up with Chatwoot's exact `equal_to` filter, re-checks the identifier (Chatwoot's *search* does `LIKE '%q%'` and could return `…:u10` for `…:u1`), keeps only the Vyuham inbox and conversations whose sender identifier matches. Each layer has a test that fails if it is removed. |
| Agents' internal notes stay internal | Previews skip private notes; webhook ignores private messages. Verified live: a private note never appeared in the customer's list or bell. |
| Webhook authenticity | `X-Chatwoot-Signature: sha256=HMAC-SHA256(secret, "<X-Chatwoot-Timestamp>.<raw body>")`, compared in constant time; timestamps older or newer than 5 minutes are rejected (replays); `X-Chatwoot-Delivery` is stored so retries are processed once. Verified live: unsigned, wrong-secret and 15-minute-old requests all got `401`. |
| Shared devices | Logout calls `$chatwoot.reset()`. Verified live: after logout the browser holds only a new anonymous visitor session with no conversations, and the next person to sign in sees none of the previous person's messages. |
| Least privilege for the API | The token belongs to a dedicated agent user that is a member of the Vyuham inbox only. Chatwoot itself limits what that user can see. |
| Production safety | With `ENVIRONMENT=production`, the backend refuses to start if Chatwoot is enabled over plain `http`, or without the HMAC token, webhook secret and API token. |

### Data shared with Chatwoot (minimum)

| Field | Why |
|---|---|
| Identifier `vyuham:<workspace_id>:<user_id>` | Opaque ids; ties the chat to one person in one workspace |
| Display name | So agents can address the customer |
| Email | So agents can follow up by email after the customer leaves (`CHATWOOT_SHARE_EMAIL=false` withholds it) |
| Custom attribute `workspace_id` | Lets agents see the tenant |

Not shared: role, company, phone, datasets, dashboards, IP address set by Vyuham, or anything else.
Problem reports add the previous **path** (no query string; share/invite tokens masked), the app
version, the browser's user-agent, and the GlitchTip error id if an error was just reported.

## 4. Deploying Chatwoot

Chatwoot's supported self-hosted method is **Docker Compose** (`docker-compose.production.yaml` in
its repository); Kubernetes (Helm) and Linux VM scripts also exist. Run it **separately** from
Vyuham, on its own host or VM and domain, e.g. `support.example.com`. This guide follows
**Chatwoot v4.19.1**.

### Services

| Service | Image | Notes |
|---|---|---|
| `rails` | `chatwoot/chatwoot:v4.19.1` | Web app and API (port 3000) |
| `sidekiq` | same image | Background jobs: webhooks, emails, notifications. Required. |
| `postgres` | `pgvector/pgvector:pg16` | Chatwoot's **own** database. Needs the pgvector extension. Do not share Vyuham's database. |
| `redis` | `redis:7-alpine` | Queues and real-time; password-protected |
| Volume `storage_data` | | Attachments when `ACTIVE_STORAGE_SERVICE=local`; or use S3 |

Size: 2 vCPU / 4 GB RAM is a comfortable start (the image alone is 2.7 GB).

### Environment (`/opt/chatwoot/.env`, `chmod 600`, never committed)

| Variable | Value |
|---|---|
| `SECRET_KEY_BASE` | `openssl rand -hex 64` |
| `FRONTEND_URL` | `https://support.example.com` |
| `FORCE_SSL` | `true` |
| `ENABLE_ACCOUNT_SIGNUP` | `false` (create agents by invitation) |
| `POSTGRES_HOST` / `POSTGRES_USERNAME` / `POSTGRES_PASSWORD` / `POSTGRES_DATABASE` | `postgres` / `postgres` / strong random / `chatwoot` |
| `REDIS_URL` / `REDIS_PASSWORD` | `redis://redis:6379` / strong random |
| `RAILS_ENV` | `production` |
| `MAILER_SENDER_EMAIL` | `"Vyuham Support <support@example.com>"` (quote values with spaces) |
| `SMTP_ADDRESS`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_AUTHENTICATION`, `SMTP_ENABLE_STARTTLS_AUTO` | Your SMTP provider. Needed for agent invites and email follow-up. |
| `ACTIVE_STORAGE_SERVICE` | `local`, or `amazon` with `S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (private bucket) |
| `RAILS_LOG_TO_STDOUT` | `true` |
| `SAFE_FETCH_ALLOW_PRIVATE_NETWORK` | **leave unset in production.** Only for local development, where the webhook target is a private address. |

### `/opt/chatwoot/docker-compose.yaml`

Use Chatwoot's `docker-compose.production.yaml` with these changes: pin the image
(`chatwoot/chatwoot:v4.19.1` instead of `latest`), set `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}`,
keep `ports` bound to `127.0.0.1`, and add `restart: unless-stopped`.

```bash
cd /opt/chatwoot
docker compose run --rm rails bundle exec rails db:chatwoot_prepare   # first install and after upgrades
docker compose up -d
curl -s https://support.example.com/api      # {"version":"4.19.1",...,"queue_services":"ok","data_services":"ok"}
```

### nginx + TLS

```nginx
server {
    server_name support.example.com;
    client_max_body_size 40M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;     # websockets for live chat
        proxy_set_header Connection "upgrade";
    }
}
```

Then `certbot --nginx -d support.example.com`.

### First admin

Open `https://support.example.com`, complete onboarding (creates the super admin and the first
account), or run `docker compose exec rails bundle exec rails c` if you prefer the console.

### Operations

- **Backups:** daily `docker compose exec -T postgres pg_dump -U postgres chatwoot | gzip > chatwoot-$(date +%F).sql.gz`, plus the `storage_data` volume (or the S3 bucket).
- **Upgrades:** read Chatwoot's release notes, bump the image tag, `docker compose pull`, run `db:chatwoot_prepare`, `docker compose up -d`.

### Local development

The same compose file works locally with `FRONTEND_URL=http://localhost:3200`, the rails port
mapped to `127.0.0.1:3200:3000` (Vyuham uses 3000, its API 8000), and:

```yaml
extra_hosts: ["host.docker.internal:host-gateway"]   # on rails and sidekiq: reach Vyuham's backend
```

plus `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` in `.env` so webhooks may reach your machine. Point the
webhook at `http://host.docker.internal:8000/support/chatwoot/webhook`.

## 5. Configuring the Vyuham support inbox

In Chatwoot (as an administrator):

1. **Inbox:** *Settings → Inboxes → Add inbox → Website*.
   - Name: `Vyuham Support`; Website URL: Vyuham's URL; widget colour `#705cbb` (Vyuham purple).
   - Agents: your support team.
   - After creating it, open the inbox → **Configuration**:
     - Copy the **website token** (`CHATWOOT_WEBSITE_TOKEN`) and note the inbox id from the URL (`CHATWOOT_INBOX_ID`; the account id is also in the URL, `CHATWOOT_ACCOUNT_ID`).
     - Copy the **HMAC token** under *Identity validation* (`CHATWOOT_HMAC_TOKEN`) and turn on **Enforce user identity validation**.
   - *Settings* tab: turn on **Enable email collect box / continuity via email** if you want agents to reply by email.
2. **API agent:** *Settings → Agents → Add agent* `vyuham-api@your-domain` (role **Agent**). Add it as a
   member of **only** the Vyuham Support inbox. Sign in as it once, open *Profile settings* and copy
   the **Access Token** (`CHATWOOT_API_TOKEN`).
3. **Label:** *Settings → Labels → Add* `problem-report`.
4. **Webhook:** *Settings → Integrations → Webhooks → Add new webhook*:
   - URL: `https://<vyuham-domain>/api/support/chatwoot/webhook`
   - Events: **Message created** and **Conversation status changed**
   - Copy the webhook's **secret** (`CHATWOOT_WEBHOOK_SECRET`). Chatwoot generates it and signs every delivery with it.
5. **Help center (optional):** *Help Center → New portal*, write articles, and use the portal's public
   URL as `CHATWOOT_HELP_CENTER_URL`.
6. **Recommended:** business hours and an away message on the inbox, a CSAT survey, and canned
   responses for common questions.

## 6. Configuring Vyuham

All settings belong to the **FastAPI backend**. The Next.js app needs nothing new: it fetches the
public values from `/api/support/config`. Placeholders are in `backend/.env.example`. Store real
values in your host's secret settings; `.env` files are git-ignored.

| Variable | Secret? | Value |
|---|---|---|
| `CHATWOOT_BASE_URL` | no | `https://support.example.com` (what browsers load the widget from). Empty = support off. |
| `CHATWOOT_API_URL` | no | Optional private URL for backend → Chatwoot calls; defaults to the base URL |
| `CHATWOOT_ACCOUNT_ID` | no | e.g. `1` |
| `CHATWOOT_INBOX_ID` | no | The Vyuham Support inbox id |
| `CHATWOOT_WEBSITE_TOKEN` | no (public by design) | Inbox website token |
| `CHATWOOT_HMAC_TOKEN` | **yes** | Inbox identity-validation token |
| `CHATWOOT_API_TOKEN` | **yes** | Access token of the dedicated API agent |
| `CHATWOOT_WEBHOOK_SECRET` | **yes** | The webhook's secret |
| `CHATWOOT_HELP_CENTER_URL` | no | Portal URL for "Help documentation" (optional) |
| `CHATWOOT_SHARE_EMAIL` | no | `true` (default) or `false` |

Partial setups degrade gracefully: without the API token, the chat still works but "Your
conversations" and the report form are replaced by a "Tell us in the chat" button; without the
webhook secret, the webhook endpoint returns 404.

Then run migrations (`alembic upgrade head`) for the new `chatwoot_webhook_deliveries` table.

**Content Security Policy:** Vyuham doesn't set a CSP today. If you add one, allow
`script-src`, `frame-src` and `connect-src` (including `wss:`) for the Chatwoot domain.

## 7. Webhook events

| Chatwoot event | Condition | Vyuham action |
|---|---|---|
| `message_created` | Public (`private: false`), `outgoing`, sent by an agent or agent bot, in the Vyuham inbox and account | Bell notification "Support replied to your conversation" with the first 140 characters, linking to `/support` |
| `conversation_status_changed` | `status: resolved` | Bell notification "Your support conversation was resolved" |
| anything else, private notes, customer messages, other inboxes or accounts, anonymous contacts, identifiers whose membership no longer exists | | Ignored with `200 {"status": "ignored"}` so Chatwoot doesn't retry |

Responses: `401` invalid signature, `404` webhook secret not configured, `200` with
`notified` / `ignored` / `duplicate`.

## 8. Testing

### Automated (backend)

`cd backend && pytest tests/test_support.py`: 19 tests covering disabled mode, no secrets in config,
sign-in required, identity only from the session, email withholding, isolation (including the
`LIKE` trap and other inboxes), private-note filtering, Chatwoot outages (clean 502, no token in
errors), report context sanitising and rate limit, and webhook signature, replay, de-duplication and
cross-tenant checks. CI runs them on SQLite and Postgres.

### End-to-end (verified during implementation)

Against a real Chatwoot v4.19.1 in Docker and a production build of Vyuham with two customers in
different workspaces:

1. Alice opened Help & Support; the widget loaded with no console errors and sent exactly
   identifier, name, email, signature and `workspace_id`. Chatwoot marked her `hmac_verified=true`.
2. Alice sent a chat message; it arrived in the Vyuham Support inbox.
3. An agent added a private note, then a public reply. Alice's bell showed the reply; her
   conversation list showed it as the last message; the private note appeared nowhere.
4. The agent resolved it; Alice got the "resolved" notification.
5. Alice sent "Report a problem" from the Data page; a `problem-report` conversation opened with the
   report as an attributed note and context `Page: /data`, app version and browser. No false
   notification.
6. Bob saw no conversations and no notifications; asking the API for Alice's identifier by parameter
   returned nothing; forcing Alice's identifier into the widget got `401` from Chatwoot.
7. After Alice logged out, the browser held only a new anonymous session; Bob signing in on the same
   browser saw none of her messages.
8. Unsigned, wrong-secret and replayed webhooks to the public URL got `401`.
9. With Chatwoot unconfigured, `/support` said so and the app made zero requests to Chatwoot.

### Manual checklist for a new environment

1. Sign in, open **Help & Support**, click **Start a chat**, send a message.
2. In Chatwoot, check the contact's identifier starts with `vyuham:` and shows a verified badge.
3. Reply as an agent; within a few seconds the Vyuham bell shows it.
4. Send a test **Report a problem**; check the label and the context note.
5. Sign out; the chat bubble's history should be gone.
6. *Settings → Integrations → Webhooks* in Chatwoot shows delivery status if something fails.

## 9. Operations and privacy

- **Where data lives:** chat transcripts, contacts and attachments live in Chatwoot's database and
  storage, not Vyuham's. Vyuham stores only bell notifications and webhook delivery ids.
- **Retention of delivery ids:** rows in `chatwoot_webhook_deliveries` are tiny; prune rows older
  than 30 days periodically if desired (`DELETE ... WHERE received_at < now() - interval '30 days'`).
- **Account deletion / data export:** Vyuham's existing deletion removes notifications. Support data
  in Chatwoot must be handled there: delete or export the contact whose identifier contains the
  user id. Mention Chatwoot as a processor in the privacy policy if you self-host it for customers.
- **Rate limit:** problem reports are limited to 5 per user per hour, per backend process.

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| No chat bubble | `/api/support/config` returns `enabled: true`? Widget script blocked by an ad blocker or a CSP? Browser console errors? |
| Widget shows "HMAC failed" / customer appears anonymous | `CHATWOOT_HMAC_TOKEN` must be the token of the **same** inbox as `CHATWOOT_WEBSITE_TOKEN` |
| "Support is temporarily unavailable" on /support | The backend can't reach Chatwoot or the API token is wrong (backend log says which); is the API agent a member of the inbox? |
| Conversations list empty although the customer chatted | Is `CHATWOOT_INBOX_ID` the Vyuham Support inbox? Is the API agent a member of it? |
| No bell notifications | Webhook URL reachable from Chatwoot? Events include *Message created* and *Conversation status changed*? `CHATWOOT_WEBHOOK_SECRET` matches? Sidekiq running? Backend logs `401` = secret mismatch or clock skew over 5 minutes (run NTP on both hosts). |
| Webhooks never leave Chatwoot locally | Private addresses are blocked by Chatwoot's SafeFetch; set `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` **in development only** |
| Report fails with 422 from Chatwoot | A contact with the same email but a different identifier already exists (for example created by hand). Merge or remove the duplicate contact in Chatwoot. |

## 11. Code map

| File | Role |
|---|---|
| `backend/app/chatwoot.py` | Identity and HMAC, webhook signature check, Application API client (exact contact lookup, contact/conversation creation) |
| `backend/app/routers/support.py` | `/support/*` endpoints and the webhook handler |
| `backend/app/config.py` | `CHATWOOT_*` settings and production checks |
| `backend/app/models.py`, `migrations/versions/c4a7e2f19d30_*` | `chatwoot_webhook_deliveries` table |
| `backend/tests/test_support.py` | Tests with an in-memory fake Chatwoot |
| `frontend/src/features/support/widget.tsx` | Loads and identifies the widget; `openSupportChat`, `resetSupportChat` |
| `frontend/src/features/support/support-screen.tsx`, `api.ts` | The `/support` page and its data hooks |
| `frontend/src/app/(app)/support/page.tsx` | Route |
| Small additions to existing modules | Sidebar entry, `<SupportWidget />` in `AppProviders`, `resetSupportChat()` in logout, support icon in the bell, router registration |

### Why "Report a problem" is a private note

Chatwoot only lets the API post messages *as the customer* in API-type inboxes, not website inboxes
(`app/builders/messages/message_builder.rb`). Posting the report as a normal message would show the
customer's words as an agent reply (and notify the customer that "support replied"), so the report is
added as a private note that names its author. The customer gets the conversation number on screen,
sees agent replies in the widget and by email, and the conversation appears in their list.
