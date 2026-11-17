# Open-source stack for Vyuham

Vyuham is licensed **Apache-2.0**. Whether a project fits depends on how we use it:

| How we use it | Licenses that work |
|---|---|
| Copy code into Vyuham, or ship it inside Vyuham | MIT, Apache-2.0, BSD. MPL-2.0 works if its files stay separate. |
| Run it as a separate service next to Vyuham | AGPL and GPL are fine. If we change their code, we must publish those changes. |
| Avoid, to stay fully open source | FSL, BUSL, PolyForm, Dify's modified Apache. These are source-available licenses, not open source, and they restrict running the product as a service. |

Licenses and activity were checked with the GitHub API on 2026-11-17. Re-check before adopting anything,
because licenses change (Sentry, Terraform and Redis all have).

| # | Project | License | Verdict |
|---|---|---|---|
| 1 | Chatwoot | MIT core, `enterprise/` is paid | Optional later for live chat; tickets are built in |
| 2 | Zammad | AGPL-3.0 | Not needed: built-in support portal |
| 3 | FreeScout | AGPL-3.0 | Not needed |
| 4 | Frappe Helpdesk | AGPL-3.0 | Not needed (also needs the Frappe framework) |
| 5 | **GlitchTip** | **MIT** | **In use**: error tracking, fed by the Sentry SDKs |
| 6 | Sentry (server) | FSL-1.1 | **Avoid** the server; the SDKs are MIT and in use |
| 7 | SigNoz | MIT core, `ee/` is paid | Later, for logs and metrics (needs ClickHouse) |
| 8 | Bugsink | PolyForm Shield | **Avoid**: not open source |
| 9 | **OpenTelemetry Collector** | **Apache-2.0** | **Supported** (`app/telemetry.py`, `instrumentation.ts`) |
| 10 | Dify | Modified Apache, no multi-tenant use | **Avoid**: Vyuham is multi-tenant |
| 11 | RAGFlow | Apache-2.0 | Possible for AI support (heavy: Elasticsearch) |
| 12 | AnythingLLM | MIT | Possible, but it runs as a separate app |
| 13 | **Haystack** | **Apache-2.0** | **First choice for AI support**: a Python library for the FastAPI backend |
| 14 | LangChain | MIT | Works, but Haystack is leaner for our use |
| 15 | BookStack | MIT | Not needed: built-in help center |
| 16 | Wiki.js | AGPL-3.0 | Not needed |
| 17 | Documize | AGPL-3.0, little recent activity | Skip |
| 18 | OpsLedger | MIT, very small project | Skip |
| 19 | GLPI | GPL-3.0 | Not relevant yet (IT asset management) |
| 20 | iTop | AGPL-3.0 | Not relevant yet |
| 21–22 | Claude Code hooks repos | Mixed; popular ones have no license | Code without a license can't be reused; write our own or use the MIT ones |
| 23 | GitHub Actions Runner | MIT | Only if we need our own CI machines |
| 24 | **Renovate** | AGPL-3.0 | **In use** as the hosted GitHub App (`renovate.json`) |
| 25 | **Syft** | **Apache-2.0** | **In use**: SBOMs in CI |
| 26 | **Trivy** | **Apache-2.0** | **In use**: vulnerability scans in CI |
| 27 | **Gitleaks** | **MIT** | **In use**: secret scanning in CI |
| 28–29 | Supabase, Supabase CLI | Apache-2.0, MIT | Not needed: Postgres + SQLAlchemy + Alembic |
| 30 | **Docker Compose** | **Apache-2.0** | **In use** |
| 31 | **OpenTofu** | **MPL-2.0** | Use when we need infrastructure as code |
| 32 | Argo CD | Apache-2.0 | Only on Kubernetes |
| 33 | Terraform | BUSL-1.1 | **Avoid**; use OpenTofu |

## What is built in instead
- **Support tickets** (`/support`, `/support/admin`): replaces Zammad, FreeScout and Frappe Helpdesk.
- **Help center** (`/help`): replaces BookStack and Wiki.js. Articles come from solved tickets in one click.
- **Status page** (`/status`): health checks every minute, 90-day uptime, incidents.
- **The learning loop:** GlitchTip groups an error and its webhook creates an error group. Staff link
  a help article. The next person who hits that error sees the fix, and the API's 500 response points to it.
