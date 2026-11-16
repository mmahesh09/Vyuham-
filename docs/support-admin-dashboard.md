# Support administration dashboard

An internal dashboard at **`/admin/support`** where Vyuham administrators and support staff watch
error health, triage errors, review AI-suggested solutions, curate the knowledge base, and follow
tickets and customer feedback. It sits on top of the
[AI troubleshooting engine](rag-support-engine.md) and the [Chatwoot integration](chatwoot-integration.md).

- [Who can use it](#who-can-use-it)
- [What it shows](#what-it-shows)
- [Admin actions](#admin-actions)
- [Security model](#security-model)
- [Audit log](#audit-log)
- [Metric definitions](#metric-definitions)
- [API reference](#api-reference)
- [Data model](#data-model)
- [Setup](#setup)
- [Testing](#testing)
- [Code map](#code-map)
- [Limitations](#limitations)

## Who can use it

Access is granted by configuration, for **verified** email addresses only:

| Role | Setting | Can do |
|---|---|---|
| **Administrator** | `SUPPORT_ADMIN_EMAILS` | Everything staff can do, plus approve, reject, edit and archive **global** knowledge (the articles every customer's assistant can use) |
| **Support staff** | `SUPPORT_STAFF_EMAILS` | View the dashboard; triage errors (resolve, reopen, link tickets); draft knowledge, including global drafts; approve, reject, edit and archive **workspace-private** knowledge; draft articles from AI answers |
| Everyone else | | Nothing. Every admin API returns **404**, and the page renders Next.js's 404, so the dashboard's existence isn't revealed. |

Settings are comma-separated lists on the backend, for example
`SUPPORT_ADMIN_EMAILS=lead@vyuham.app` and `SUPPORT_STAFF_EMAILS=agent1@vyuham.app,agent2@vyuham.app`.
Someone with an unverified email gets no role even if listed. Staff sign in with their normal
Vyuham account.

## What it shows

**Header:** the period selector (7, 30 or 90 days, kept in the URL) and the signed-in person's role.

| Tab | Contents |
|---|---|
| **Overview** | Stat tiles: error events, unique fingerprints, unresolved errors, error resolution rate, AI resolution rate ("AI answers solved it"), open support tickets, knowledge to review (with verified and rejected counts). Charts: **error trend** (events per day), **errors by module**, **errors by app version** (top 10). Each chart has a *Show as table* view. **Most frequent errors**: grouped by fingerprint across workspaces, with module, category, error type, events, number of workspaces affected, status and last seen. Selecting one opens the Errors tab filtered to that fingerprint. |
| **Errors** | Error groups (one per workspace and fingerprint), filterable by status, module and text. Each row shows workspace, count, status (with a *regressed* marker), linked ticket and last seen. Selecting a row opens the error details. |
| **Knowledge** | Articles by status: *Pending review*, *Verified* (approved and tested), *Rejected*, *Archived*. Shows who sees each one ("All customers" or "Workspace: …"), source ("AI-suggested", "Written by staff", "Promoted…"), and helpful votes. *New article* creates a draft. |
| **AI suggestions** | Recent assistant answers with question, summary, steps (verified fix / suggestion / check), whether verified articles backed them, customer feedback and comments, and escalation ticket. Filter by feedback. |
| **Feedback** | "Did the assistant solve it?" by module with rates; articles ranked by helpful / not-helpful votes; recent feedback with comments. |
| **Tickets** | Open conversations in the Vyuham Support inbox (count, labels, workspace), and errors linked to tickets. Shows "Chatwoot isn't connected" if it isn't configured. |
| **Audit log** | Every knowledge and error change, newest first, with actor, role, field-level changes and notes. |

**Error details** (side panel):
- **Header:** status, regression marker, module, category, the redacted message, workspace,
  occurrence count, first and last seen, fingerprint and resolution note.
- **Actions:** *Mark as resolved* (with a note) or *Reopen*; *Link ticket* or *Unlink*.
- **Recent occurrences:** the last 20, each with time, app version, a pseudonymous user reference
  (`u_…`) and expandable **Sanitized diagnostics**.
- **AI answers for this error**, with confidence, grounding and customer feedback.
- **Related knowledge:** global articles and this workspace's own only.
- **History:** the audit entries for this error.

**Article panel:** the full article, review notes, votes, *Edit*, *Archive*, the **Approve** form
(tested checkbox, required test notes, and for global articles a "contains no customer-specific
information" confirmation), the **Reject** form (with a reason), and the article's audit history.
For staff, global articles show a notice and no actions. That's a convenience; the server enforces
the rule.

**Design:** it uses the app's existing components and tokens: `rounded-[20px] border-line bg-surface`
panels, `Tabs`, `Table`, `Sheet`, `Dialog`, `NativeSelect`, ReUI `Badge` variants, and the brand
ECharts theme. Every chart is single-series with no legend: bars use `--primary`, the trend line
uses `--highlight`, and both pass a ≥3:1 contrast check against the dark surface. Charts have hover
tooltips and table views; status is shown with words, not colour alone. The layout is responsive:
tiles reflow from 2 to 7 columns, tables scroll horizontally, and nothing scrolls sideways on a
390px phone.

## Admin actions

| Action | Where | Who | Rules |
|---|---|---|---|
| Review error details | Errors → row | staff, admin | Redacted data only (see Security) |
| Mark resolved / reopen | Error details | staff, admin | A resolution note is required. If the error happens again it **reopens automatically** and is flagged as a regression. |
| Link / unlink a Chatwoot ticket | Error details | staff, admin | The server fetches the conversation from Chatwoot and only links it if it is in the Vyuham Support inbox **and its contact belongs to the same workspace** as the error |
| Approve a solution | Knowledge → article | admin for global; staff or admin for workspace-private | Must be marked tested with test notes. Global also needs the no-customer-data confirmation. A customer-suggested solution can't be approved as global directly; promote it into a new global article. |
| Reject a solution | Knowledge → pending article | as above | Reason required (stored in the article and the audit log) |
| Edit an article | Knowledge → article → Edit | as above | Saving sends it back to *Pending review* and removes it from retrieval until re-approved |
| Archive | Knowledge → verified article | as above | Removes it from retrieval |
| Create a draft | Knowledge → New article | staff, admin | Starts pending; global drafts need an admin to approve |
| Draft from an AI answer | AI suggestions → Draft knowledge article | staff, admin | Creates a **pending, workspace-private** article from the redacted answer. Never global, never auto-approved. |
| View sanitized diagnostics | Error details → occurrence | staff, admin | Shown exactly as stored after redaction |

## Security model

- **Authorization is server-side.** Every `/support/admin/*` and `/support/knowledge/*` route
  depends on `require_support_staff` (`backend/app/support_ai/access.py`). It resolves the user from
  the Better Auth session, requires a verified email in one of the two lists, and returns 404
  otherwise.
- **The page checks too.** `/admin/support` is a server component that calls `/support/admin/me`
  with the visitor's cookie and renders 404 if access is denied.
- **The frontend role is a hint only.** The sidebar link and the locked state on global articles
  come from `/support/admin/me`. Hiding them grants nothing, and showing them grants nothing. The
  admin-only rule for global knowledge lives in the approval service (`approval.py`), so it holds
  whichever route calls it.
- **Tenant access restrictions.** Staff work across customer workspaces by design, but only with
  support data that was redacted on the way in:
  - **Never shown:** customer datasets, dashboards, query results, user emails or names. Users
    appear as `u_` plus 10 hex characters (a SHA-256 pseudonym of the user id).
  - **Workspaces appear by name** so staff can tell customers apart; ticket links are verified
    against the same workspace.
  - **Article suggestions in error details** come only from global knowledge and the error's own
    workspace.
  - **Drafts made from an AI answer** stay private to the workspace that asked.
  - **Customer-facing retrieval rules are unchanged:** customers only ever retrieve approved global
    articles and their own workspace's (see the engine doc).
- **Inputs are validated** (lengths, enums, ranges). Mutations write their audit row in the same
  database transaction, and a refused action writes nothing.

## Audit log

Table `support_audit_log`, written by `backend/app/support_ai/audit.py`:

| Field | Meaning |
|---|---|
| `actor_id`, `actor_email`, `actor_role` | Who did it, and with which role at the time |
| `action` | `article.create`, `article.edit`, `article.approve`, `article.reject`, `article.archive`, `article.promote`, `article.draft_from_ai`, `error.resolve`, `error.reopen`, `error.link_ticket`, `error.unlink_ticket` |
| `target_type`, `target_id` | `article` or `error_group`, and its id |
| `workspace_id` | The tenant the target belongs to (empty for global articles) |
| `changes` | Field-level `{field: [before, after]}`, secrets stripped |
| `note` | Rejection reason, resolution note, "confirmed no customer data", source of a promotion or draft |
| `created_at` | When |

The log is **append-only**: no code path updates or deletes rows, and the API exposes only `GET`
(a test asserts this). For tamper-evidence beyond the application, restrict `UPDATE` and `DELETE` on
the table at the database level, or stream it to an external log store.

## Metric definitions

All counts are over the selected period unless noted.

| Metric | Definition |
|---|---|
| Error events | Rows in `support_error_events` created in the period |
| Unique fingerprints | Distinct fingerprints among groups with events in the period. The same problem in several workspaces counts once. |
| Unresolved errors | Error groups with `status = 'open'` (all time) |
| Errors by module / version | Events in the period by group module and by event `app_version` (missing → "unknown"; top 10 versions) |
| Most frequent errors | Events in the period grouped by fingerprint: events, workspaces affected, groups still open, last seen (top 10) |
| Error trend | Events per calendar day (UTC), days with none shown as 0 |
| Error resolution rate | Of the error groups seen in the period, the share currently resolved |
| AI resolution rate | Of assistant answers in the period that got feedback, the share marked "solved" |
| Open support tickets | Chatwoot's open conversation count for the Vyuham Support inbox (`–` when not connected) |
| Pending / verified / rejected knowledge | Articles by status (all time) |

The app version comes from `NEXT_PUBLIC_APP_RELEASE` (see [glitchtip-integration.md](glitchtip-integration.md#7-environments-and-releases)),
which the assistant sends with captured errors.

## API reference

All routes are under `/api` from the browser. Staff or admin is required everywhere; anyone else
gets 404.

| Method & path | Notes |
|---|---|
| `GET /support/admin/me` | `{role, email}` |
| `GET /support/admin/overview?days=` | All overview metrics (1–365 days) |
| `GET /support/admin/errors?status=&module=&fingerprint=&q=&limit=&offset=` | Error groups |
| `GET /support/admin/errors/{id}` | Details, occurrences, AI answers, related knowledge, history |
| `POST /support/admin/errors/{id}/resolve` | `{note}` |
| `POST /support/admin/errors/{id}/reopen` | |
| `POST /support/admin/errors/{id}/ticket` · `DELETE …/ticket` | `{conversation_id}`; same-workspace check against Chatwoot |
| `GET /support/admin/ai-suggestions?feedback=resolved\|unresolved\|none` | Recent answers |
| `POST /support/admin/sessions/{id}/draft-article` | Pending, workspace-private draft |
| `GET /support/admin/feedback?days=` | By module, recent, articles by votes |
| `GET /support/admin/tickets` | Open Chatwoot tickets and linked errors |
| `GET /support/admin/audit?target_id=&action=&limit=` | Audit entries |
| `/support/knowledge…` | List (with workspace names), create, get, edit, approve, reject, archive, promote. See [rag-support-engine.md](rag-support-engine.md#9-api-reference). Admin is required for global approve, reject, edit and archive (403 for staff). |

## Data model

Migration `e5b9a0c47d12` (`alembic upgrade head`):

| Change | Columns |
|---|---|
| `support_error_groups` | `status` (`open`/`resolved`, default `open`, indexed), `resolved_at`, `resolved_by`, `resolution_note`, `regressed_at`, `chatwoot_conversation_id` |
| `support_error_events` | `app_version` (indexed) |
| `support_audit_log` | New table, described above; indexes on `action`, `target_id`, `created_at` |

It follows the existing conventions: 32-character hex ids, timezone-aware timestamps, JSON columns
and Alembic batch operations, so it works on SQLite as well as PostgreSQL. Existing error groups
become `open`.

## Setup

1. Run `alembic upgrade head`.
2. Set `SUPPORT_ADMIN_EMAILS` and `SUPPORT_STAFF_EMAILS` on the backend (placeholders are in
   `backend/.env.example`). People sign up normally and confirm their email address.
3. For ticket counts and links, configure Chatwoot with an API token (see the Chatwoot doc).
4. Set `NEXT_PUBLIC_APP_RELEASE` per build so "Errors by app version" is meaningful.
5. Staff open **Support admin** in the sidebar, or go to `/admin/support`.

## Testing

**Backend:** `cd backend && pytest tests/test_support_admin.py` (12 tests). The full suite (188)
passes.
- **Access:** customers get 404 on every admin route; unauthenticated requests get 401;
  unverified emails get no role; admin and staff roles are reported correctly.
- **Global vs workspace knowledge:** staff can draft global articles but get 403 approving,
  rejecting, editing or archiving them; staff can approve workspace articles; admins can approve
  global ones.
- **Audit:** create, edit, approve and reject are recorded in order with actor, role, field diffs
  and notes; a refused action leaves no audit row; audit routes are GET-only.
- **Errors:** resolve and reopen; a new occurrence reopens the group as a regression; ticket
  linking refuses another workspace's conversation, another inbox and unknown ids, and works
  within the same workspace; linking and unlinking are audited.
- **Error details:** diagnostics are redacted, users are pseudonymous, and another tenant's article
  isn't suggested.
- **Overview numbers:** events, unique fingerprints across workspaces, unresolved, by module, by
  version, top errors with workspace counts, trend total and resolution rate are all checked
  against seeded data.
- **AI suggestions:** they become private pending drafts; customers can't draft; feedback stats
  are correct.

Removing the global-knowledge admin check, the same-workspace ticket check or the staff gate each
makes these tests fail.

**End-to-end (verified during implementation, production build):**
- Seeded data: two customer workspaces, an administrator, a support agent, 15 error events across
  modules and versions, and three assistant answers (through a local stand-in for the Claude API).
- The overview tiles matched the data (15 events, 6 fingerprints, 6 unresolved, 50% AI resolution,
  2 to review), and the charts and their table views rendered.
- Drill-down from the top error → details showed the SQL with `email = '?'`, no email address, and
  a `u_…` user. Resolving recorded `error.resolve by admin@vyuham.test (admin)`.
- The admin approved the agent's global draft; it moved to Verified, with
  `article.create (staff)` and `article.approve (admin)` in the audit log. Drafting from an AI
  answer was audited as `article.draft_from_ai`.
- The agent saw the "Only Vyuham administrators…" notice and no edit controls on the global article.
- A customer saw no sidebar link and got a 404 for `/admin/support` and for the admin API.
- On a phone viewport the page didn't scroll sideways. There were no page errors.

## Code map

| File | Role |
|---|---|
| `backend/app/support_ai/access.py` | Roles from verified emails; `require_support_staff`, `require_support_admin` |
| `backend/app/support_ai/audit.py` | Audit snapshots, diffs and records |
| `backend/app/support_ai/approval.py` | Knowledge workflow, now taking an `Actor`, admin-only rules for global articles, audit writes |
| `backend/app/routers/support_admin.py` | Dashboard API |
| `backend/app/routers/knowledge.py` | Knowledge API (now role-aware, with workspace names) |
| `backend/app/support_ai/ingestion.py` | Records app version; reopens resolved groups as regressions |
| `backend/app/chatwoot.py` | `get_conversation`, `open_conversations` |
| `backend/migrations/versions/e5b9a0c47d12_support_admin.py` | Schema changes |
| `frontend/src/app/(app)/admin/support/page.tsx` | Server-checked route |
| `frontend/src/features/support-admin/*` | Screen, tabs, error and article panels, data hooks |
| `frontend/src/components/layout/sidebar.tsx` | "Support admin" link for staff (6 lines) |

## Limitations

- **The workspace field on new articles takes an id.** Staff copy it from an error's details. A
  workspace picker would be friendlier.
- **Ticket numbers aren't clickable.** The Tickets tab lists open conversation numbers; open them
  in Chatwoot. A deep link needs the Chatwoot account URL, which could be added as a setting.
- **Metrics are computed on request.** That's fine at current volumes. For very large event tables,
  add a daily rollup or partition `support_error_events` by month.
- **Roles live in configuration.** Changing them needs a backend restart.
