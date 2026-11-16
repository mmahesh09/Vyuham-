# AI support interface

The customer-facing side of the [AI troubleshooting engine](rag-support-engine.md): a side panel
where customers describe a problem and get an explanation, troubleshooting steps, references to help
articles, and a way to reach a person.

- [Where it lives](#where-it-lives)
- [What customers see](#what-customers-see)
- [Context awareness](#context-awareness)
- [Privacy and consent](#privacy-and-consent)
- [Verified fix vs suggestion](#verified-fix-vs-suggestion)
- [Feedback, tickets and history](#feedback-tickets-and-history)
- [Design and responsiveness](#design-and-responsiveness)
- [Code map](#code-map)
- [Testing](#testing)

## Where it lives

- **Sidebar:** **Ask AI support** (sparkles icon), above "Take the tour", on every page of the
  signed-in app.
- **Help & Support page:** an **Ask the AI assistant** card at the top.
- **The panel** is a right-hand sheet mounted once in `AppProviders`, so it keeps its state while
  the customer moves between pages. It needs no configuration to appear. Without an Anthropic key,
  it answers from approved help articles only (see the engine doc).

All AI requests go to Vyuham's own server (`/api/support/assistant/*`). The browser never contacts
Claude or the embedding provider and holds no keys.

## What customers see

1. **Helping with:** the detected module (changeable), and a short note explaining verified fixes
   vs suggestions.
2. **Suggested questions** for that module, one tap to ask.
3. **Share diagnostics:** an opt-in checkbox with a *Review* preview (see Privacy).
4. **The answer card:**
   - **Confidence badge:** Confident, Likely, Not sure, or Not enough information. A
     *No verified article matched* badge appears when nothing backed the answer.
   - **Summary** and **Likely cause**.
   - **Try this:** ordered steps, each labelled **Verified fix**, **Suggestion** or **Check**, with
     the source article(s) for verified fixes.
   - **Uncertainty note** when evidence is weak.
   - **Help articles:** retrieved references with scope ("Vyuham help" or "Your workspace"),
     verification status, whether the answer used them, and a short ref id. Tapping one opens the
     article in place.
   - A reminder that the assistant never runs anything, and that SQL should be reviewed before use.
   - **Did this solve it? Yes / No.**
5. **Follow-ups** continue the same conversation; earlier turns are sent as context.
6. **History tab:** the customer's own assistant conversations and their support tickets.

Answers usually take a few seconds; a "Looking through help articles and your error…" status shows
while the background job runs.

## Context awareness

The module is detected from the page the customer is on. On the Help & Support page, the page they
came from is used instead:

| Page | Module | Diagnostics that can be shared |
|---|---|---|
| `/sql` | SQL Lab | The last failed queries in this tab: the error message and the query **shape** (`WHERE email = '?' AND total > ?`), never values or results |
| `/dashboards/{id}` | Dashboards | Dashboard name; each chart's configuration (kind, metrics and aggregations, group by, time bucket, filter *field names*, SQL shape) and its current error, if any |
| `/dashboards`, `/lab` | Dashboards | Recent failed dashboard and chart calls |
| `/alerts` | Automations | Failing automations (last status, last run) and alerts in an error state |
| (picker) | Scheduled reports | Recent report deliveries that failed, per channel (e.g. webhook HTTP 500) |
| `/data` | Data uploads | Recent failed upload calls |

Two sources feed this:
- **In the browser:** `lib/api/recent-errors.ts` keeps the last 10 failed API calls of the tab in
  memory. That's the one-line hook in `api()`. Ids in paths are masked; for SQL Lab only the
  query shape is kept. It is never sent by itself.
- **On the server:** `GET /api/support/assistant/context` builds diagnostics from the customer's
  own workspace (`backend/app/support_ai/context.py`). It reads existing tables only; existing
  modules weren't changed.

## Privacy and consent

- **Nothing is collected automatically.** Diagnostics are attached only if the customer ticks
  **Share diagnostics**, and they can **Review** exactly what will be sent first.
- **Tickets have their own consent.** Creating a support ticket has a separate **Attach
  diagnostics** checkbox, unticked by default, with its own preview. Without it, the ticket
  contains the question, the assistant's summary and steps, and the note "Diagnostics: not shared
  by the customer."
- **Never collected:** dataset contents, query results, chart data, credentials, connection
  strings, webhook URLs or secrets.
- **Defence in depth.** The browser masks values, and the server redacts everything again before
  storing it or sending it to Claude (see the engine's Redaction section).
- **The composer** reminds customers not to include passwords or customer data.
- **Diagnostics consent resets** for each new question.

## Verified fix vs suggestion

| Label | Meaning | Who decides |
|---|---|---|
| **Verified fix** (green, shield) | The step comes from a help article our team approved **as tested**. Its source is linked. | The server: a step keeps this label only if it cites a retrieved, approved, tested article; otherwise it is downgraded, whatever the model said |
| **Suggestion** (amber, lightbulb) | The assistant's reasoning, not verified by our team | |
| **Check** (grey, magnifier) | A step that gathers information or rules something out | |

Each answer also carries the explanatory line: *"Verified fixes come from help articles our team
has tested. Suggestions are the assistant's best guess, so check them before relying on them."*

## Feedback, tickets and history

- **Yes:** records that it worked (article counters go up; nothing becomes "verified" from feedback).
- **No:** if human support (Chatwoot) is configured, shows **Create a support ticket**: an
  optional note, the diagnostics consent checkbox, then **Create ticket**. On success it shows
  "Ticket #N created" and **Open support chat**. If Chatwoot isn't configured, it says human
  support isn't set up yet.
- **Answers that recommend a person** (`needs_human`) or failed answers offer the ticket form directly.
- **History:**
  - *Assistant conversations:* only the signed-in person's own, never teammates'.
  - *Support tickets:* their Chatwoot conversations via the existing
    `/api/support/conversations`, which only returns the customer's own.

## Design and responsiveness

- **Built from existing components:** `Sheet`, `Tabs`, `Dialog`, `Button`, `Checkbox`,
  `Textarea`, `Spinner`, and ReUI `Badge` variants (`success-light`, `warning-light`,
  `info-light`, `destructive-light`), with lucide icons.
- **Uses existing design tokens:** `border-line`, `text-muted`, `text-faint`, `text-highlight`,
  `text-accent`, `bg-surface-2`.
- **Layout:** full width on phones and `max-w-lg` from the `sm` breakpoint. Content scrolls inside
  the panel; the composer stays pinned at the bottom. Verified on a 390px-wide phone viewport with
  no horizontal scrolling.
- **Safe rendering:** all AI text is rendered as plain text with preserved line breaks
  (`whitespace-pre-wrap`); there is no HTML or Markdown rendering of model output.
- **Keyboard:** Enter sends, Shift+Enter adds a new line. The panel is a labelled dialog;
  checkboxes and buttons have labels.

## Code map

| File | Role |
|---|---|
| `frontend/src/features/assistant/assistant-panel.tsx` | Panel, tabs, composer, history, article dialog |
| `frontend/src/features/assistant/answer-card.tsx` | Answer rendering, feedback, ticket form |
| `frontend/src/features/assistant/api.ts` | Typed hooks for `/api/support/assistant/*` (polling while answering) |
| `frontend/src/features/assistant/module-context.ts` | Page → module, labels, suggested questions, which recent errors belong to a module |
| `frontend/src/features/assistant/store.ts` | Panel open state (zustand) |
| `frontend/src/lib/api/recent-errors.ts` | In-memory buffer of recent failed calls |
| Small additions to existing files | `sidebar.tsx` (entry button), `app-providers.tsx` (mount), `support-screen.tsx` (card), `lib/api/client.ts` (one `recordApiError` call) |

## Testing

**Automated (backend):** see the engine doc. Tenant isolation, retrieval permissions, consent for
ticket diagnostics, and the verified-vs-suggestion rule are covered by
`backend/tests/test_support_ai_isolation.py` and `test_support_ai_engine.py`.

**End-to-end (verified during implementation, production build):**
- Running a failing query in SQL Lab, then opening the assistant, detected **SQL Lab**. The
  diagnostics preview showed `FROM sales WHERE email = '?' AND total > ?`, without the email or
  amount.
- The answer showed confidence, likely cause, and Verified fix / Suggestion / Check steps. The
  verified fix linked the approved article, which opened in place. Another workspace's private
  article never appeared.
- **No** showed the follow-up; with Chatwoot not configured, it said human support isn't set up.
  The ticket path with Chatwoot is covered by backend tests and the Chatwoot integration.
- On `/dashboards` on a phone (390px): module **Dashboards**, a suggested question worked, the
  panel was full width with no sideways scrolling, and History listed the customer's
  conversations. Another customer's History was empty.
- No console errors other than the intentional failing SQL request.

**Manual checklist with a real Anthropic key:**
1. Set `ANTHROPIC_API_KEY`, `EMBEDDING_PROVIDER=voyage`, `VOYAGE_API_KEY`, and approve a few global
   articles as staff.
2. In SQL Lab, run `SELECT * FROM does_not_exist`, open **Ask AI support**, tick **Share
   diagnostics**, review it, then ask. Expect a cited verified fix if an article covers it.
3. Ask something no article covers. Expect "Not sure" or "Not enough information", suggestions
   only, and an uncertainty note.
4. Click **No** and create a ticket with and without diagnostics; check both in Chatwoot.
5. Sign in as a user in another workspace and confirm History is empty and the first user's
   tenant articles never show up.
