# Plan: AI Dashboards for Small Companies (v1 MVP)

## Context
The user wants to launch a small startup that helps companies with 1–100 employees (startups, agencies, small businesses) that can't afford Power BI or Tableau, or don't have the people to run them. The project folder `C:\Users\mahes\Downloads\websitee` is empty, so this is a greenfield build. Decisions made: internal dashboards first; data from Excel/CSV + Google Sheets; Next.js + FastAPI; AI "ask your data" in v1; a focused free-beta first version (~8 weeks solo).

## The problem we solve
**Small companies have business data but can't get answers from it.**
- Data is scattered across Excel files, Google Sheets and exports from tools (Stripe, accounting, CRM, POS).
- Simple questions ("What's our revenue trend?", "Which product or client is most profitable?", "Where is the money going?") take hours of manual spreadsheet work, or never get answered.
- Power BI and Tableau cost more than the license (~$14–75/user/month). They also take setup time, training, and someone technical to build and maintain reports.
- Free tools (Looker Studio, Excel charts) still require you to know how to build reports.

**Target customers:** founders, owners and managers at 1–100 person companies.
- Startups: revenue, MRR, growth, burn for the team and investors.
- Small companies: sales, expenses, operations tracked in Excel.
- Agencies: their own internal numbers, plus sharing dashboards with clients by link (full client reporting comes later).

**Promise:** "Upload your spreadsheet, ask in plain English, get the answer and a chart in under a minute. No analyst needed."
**Pricing idea:** flat price per company, not per user (e.g. Free: 1 dashboard / 5 MB; Pro ~$29/mo; Team ~$79/mo). Charging is added after v1.

## How we differ from Power BI / Tableau (don't copy them)
| Them | Us |
|---|---|
| Blank canvas first | **Question first**: home is "What do you want to know?" |
| Manual data modeling (Power Query, relationships) | **Auto semantic layer**: AI describes columns and detects links between tables |
| DAX / calculated fields | Metrics defined in plain English, stored as JSON |
| A wall of charts | **Story feed**: each card = a one-line insight plus a chart |
| Desktop app, per-user pricing | Web only, flat per-company price |
| Proprietary chart language (VizQL/DAX) | A simple JSON chart spec shared by the AI and the builder |

## UI design: "Ask + Story feed"
```
+------------------------------------------+
| [ Ask anything about your data...     ] |
+------------------------------------------+
| ▲ Revenue up 18% vs last month           |
|   [ line chart ]                         |
| ▼ Marketing spend 30% over average       |
|   [ bar chart ]                          |
| ● Top client: Acme (22% of revenue)      |
|   [ pie chart ]                          |
+------------------------------------------+
```
- Left sidebar: Home (ask), Dashboards, Data, Templates.
- **Dashboard = ordered feed of cards**, not a pixel grid. Each card: insight headline, chart, optional note; reorder by drag (dnd-kit); KPI cards can sit in a row at the top.
- Filters bar (date range, category) at the top of each dashboard, applied to all cards.
- Each card has "Ask a follow-up" for drill-down questions.
- Chart builder opens as a side panel from any card ("Edit chart"), not as a separate canvas.

## v1 scope (free beta)
**Core**
1. Sign up / login, one workspace per account.
2. Data in: upload CSV/XLSX, plus a **Google Sheets connector** (OAuth, pick sheet/tab, hourly auto-refresh plus a "refresh now" button). Preview, auto-detect column types, saved dataset.
3. No-code chart builder: dataset → group by → measure (sum/count/avg/min/max) → chart (bar, line, pie, KPI number, table).
4. Dashboards: a story feed of saved chart cards, drag to reorder, **filters** (date range plus category) applied to every chart.
5. **Share by link**: public read-only dashboard; filters still work for viewers.

**AI (the differentiator)**
6. **Ask your data**: plain-English question → answer text + chart, then "Save to dashboard".
7. **Auto-dashboard**: right after upload/connect, AI proposes 4–6 charts and builds a starter dashboard the user can edit.
8. **Insights summary**: a panel on each dashboard with 3–5 plain-English findings (trends, biggest changes, top/bottom items), plus a "refresh insights" button. The numbers are computed in DuckDB first, and Claude only writes the explanation, so it can't invent figures.

**Templates**
9. Three templates: **Startup metrics** (MRR, growth, burn, runway), **Sales** (revenue, top products/clients, trend), **Expenses** (by category, month over month). The user maps their columns to template fields (AI suggests the mapping).

**Not in v1:** Stripe billing (free beta first), SQL editor, PDF export, email reports, team members, database/SaaS connectors, white-labeling.

## Architecture
```
Next.js (frontend)  --REST/JSON-->  FastAPI (backend)
                                      ├─ Postgres: users, workspaces, datasets, charts, dashboards, share links
                                      ├─ DuckDB: query engine over per-workspace Parquet files
                                      └─ Claude API (claude-sonnet-5-5): question -> SQL + chart spec
```
- **Semantic layer** (`app/semantic.py`, Postgres table `dataset_semantics`): on ingest, a JSON description per dataset/column (meaning, type, role = date/metric/category/id, example values, likely joins), generated by Claude and editable by the user. Ask-your-data, auto-dashboard, insights and template mapping all read it.
- **Chart spec** (JSON): `{dataset, metrics:[{field, agg}], group_by, filters, chart_type, title, insight}`. Both the builder and the AI write it; `query.py` compiles it to SQL. The AI writes raw SQL only when the spec can't express the question.
- An upload is converted with pandas to `data/<workspace_id>/<dataset_id>.parquet`.
- Queries run in a fresh in-memory DuckDB connection that can only see the workspace's Parquet files (registered as views; `enable_external_access=false` after registering). SELECT only, validated with `sqlglot`, with a row limit and a timeout.

## Repo layout
```
websitee/
  frontend/  Next.js (App Router, TypeScript, Tailwind, shadcn/ui, ECharts, dnd-kit)
    app/(auth)/login, signup
    app/datasets/            upload + preview
    app/ask/                 AI question page
    app/charts/new/          chart builder
    app/dashboards/[id]/     dashboard story feed
    app/s/[token]/           public shared dashboard
  backend/
    app/main.py
    app/auth.py              email+password, JWT in httpOnly cookie (passlib/bcrypt)
    app/models.py            SQLAlchemy models + Alembic migrations
    app/ingest.py            CSV/XLSX -> pandas -> types -> Parquet
    app/query.py             DuckDB sandboxed execution; chart-spec -> SQL builder
    app/ai.py                schema + sample rows -> Claude -> {sql, chart_type, x, y, answer}; validate; 1 retry on error
    app/routers/             auth, datasets, charts, dashboards, ai, share
    tests/
  docker-compose.yml         postgres + backend + frontend
```

## Milestones (~8 weeks solo)
- **Step 0:** design UI wireframes for the Home, Dashboard feed and Data screens before coding.
- **Week 1:** skeleton (docker-compose, FastAPI, Next.js, Postgres, Alembic), auth, workspace.
- **Week 2:** upload + preview + type detection; DuckDB query engine + sandbox.
- **Week 3:** chart builder + ECharts rendering; save charts.
- **Week 4:** dashboards (story feed) + filters; share links.
- **Week 5:** AI "Ask your data".
- **Week 6:** AI auto-dashboard + insights summary.
- **Week 7:** Google Sheets connector (OAuth, import, scheduled refresh with APScheduler) + 3 templates.
- **Week 8:** landing page with beta signup, polish, deploy (frontend on Vercel, backend + Postgres on Railway/Render/Fly), invite the first 10–20 beta users.

New backend files for the added scope: `app/sheets.py` (Google OAuth + sync), `app/insights.py` (stats in DuckDB → Claude explanation), `app/templates/` (template definitions + column mapping), `app/scheduler.py` (Sheets refresh).

## Verification
- `pytest`: ingest type inference (CSV/XLSX samples), sandbox rejects non-SELECT, file-path functions and other workspaces' data; AI flow with mocked Claude responses (valid SQL, bad SQL → retry).
- `pytest` also covers: insight statistics (correct % changes on known data), template column mapping, Sheets sync with a mocked Google API.
- End-to-end: `docker compose up`, sign up, upload a sample sales CSV, check that the auto-dashboard appears, ask "revenue by month", apply a date filter, check that the insights match the numbers, apply the Sales template, connect a test Google Sheet and edit it, then refresh. Finally, open the share link in a private window.
- Playwright smoke test of upload → auto-dashboard → ask → filter → share.
