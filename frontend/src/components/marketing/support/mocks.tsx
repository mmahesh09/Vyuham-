import { Check, CircleDot, Paperclip, Sparkle } from "lucide-react";

/* Static product illustrations for the support center. Sample content only; nothing here is live data. */

const frame = "rounded-[20px] border border-white/10 bg-[#0f0b08]/90 shadow-[0_40px_120px_-40px_rgba(240,122,43,0.35)]";

function WindowDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      <span className="size-2.5 rounded-full bg-white/15" />
      <span className="size-2.5 rounded-full bg-white/15" />
      <span className="size-2.5 rounded-full bg-white/15" />
    </div>
  );
}

/** The hero frame: a support request from first message to resolution. */
export function TicketFrame({ articleCount, statusLabel }: { articleCount: number | null; statusLabel: string }) {
  const tiles = [
    { label: "Help articles", value: articleCount === null ? "—" : String(articleCount), tone: "text-highlight" },
    { label: "First reply", value: "≤ 1 working day", tone: "text-white" },
    { label: "Read by", value: "A person", tone: "text-white" },
    { label: "System status", value: statusLabel, tone: "text-success" },
  ];
  return (
    <div className={`${frame} p-2 sm:p-3`} role="img" aria-label="Example support request: a question about dates in a CSV upload, answered and resolved">
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <WindowDots />
        <span className="font-mono text-[11px] text-white/35">vyuham.app/support</span>
        <span className="w-10" aria-hidden />
      </div>
      <div className="rounded-[14px] border border-white/[0.07] bg-black/40 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/20 font-semibold text-highlight">P</span>
            <div className="text-left">
              <p className="text-[15px] font-medium text-white">Hello Priya, here&apos;s your request</p>
              <p className="text-[12.5px] text-white/50">Dates in my CSV show up as text</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-[12px] font-medium text-success">
            <Check className="size-3.5" strokeWidth={2.6} aria-hidden /> Resolved
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-3 text-left">
              <dt className="text-[11px] text-white/45">{t.label}</dt>
              <dd className={`mt-1 truncate text-[15px] font-semibold sm:text-[17px] ${t.tone}`}>{t.value}</dd>
            </div>
          ))}
        </dl>

        <ol className="mt-5 flex flex-col gap-3 text-left">
          <li className="max-w-[88%] rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.04] px-4 py-3">
            <p className="text-[11.5px] text-white/45">You · 9:14</p>
            <p className="mt-1 text-[14px] leading-relaxed text-white/80">
              I uploaded sales.csv and the “Order date” column is treated as text, so I can&apos;t filter by month.
            </p>
          </li>
          <li className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md border border-primary/30 bg-primary/10 px-4 py-3">
            <p className="text-[11.5px] text-highlight">Vyuham support · 11:02</p>
            <p className="mt-1 text-[14px] leading-relaxed text-white/85">
              Your dates use day-first format. Open the column, choose “Date (DD/MM/YYYY)” and every chart updates.
            </p>
          </li>
        </ol>
      </div>
    </div>
  );
}

/** A reply being written, for the "talk to a person" card. */
export function ReplyMock() {
  return (
    <div className={`${frame} p-4`} aria-hidden>
      <div className="flex items-center justify-between">
        <WindowDots />
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/50">New request</span>
      </div>
      <div className="mt-4 flex flex-col gap-2.5 text-[13px]">
        <div className="flex items-center gap-3 border-b border-white/[0.07] pb-2.5">
          <span className="w-16 text-white/40">Topic</span>
          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-highlight">How do I…?</span>
        </div>
        <div className="flex items-center gap-3 border-b border-white/[0.07] pb-2.5">
          <span className="w-16 text-white/40">Subject</span>
          <span className="truncate text-white/85">Share a dashboard without filters</span>
        </div>
        <p className="min-h-16 pt-1 leading-relaxed text-white/60">
          Can I send the board a link where they can&apos;t change the date range?
          <span className="ml-0.5 inline-block h-3.5 w-px animate-pulse bg-white/70 align-middle" />
        </p>
        <div className="flex items-center justify-between pt-1">
          <Paperclip className="size-4 text-white/35" />
          <span className="rounded-full bg-primary px-4 py-1.5 text-[12.5px] font-semibold text-[#1a0e05]">Send</span>
        </div>
      </div>
    </div>
  );
}

/** A small request list, for the "your requests" card. */
export function RequestListMock() {
  const rows = [
    { s: "Share a dashboard without filters", st: "Waiting on support", tone: "bg-info/15 text-info", t: "2m" },
    { s: "Totals don't match the bank export", st: "Waiting on you", tone: "bg-warning/15 text-warning", t: "1d" },
    { s: "Dates in my CSV show up as text", st: "Resolved", tone: "bg-success/15 text-success", t: "3d" },
    { s: "Add a second database", st: "Resolved", tone: "bg-success/15 text-success", t: "1w" },
  ];
  return (
    <div className="overflow-hidden rounded-[14px] border border-white/[0.07] bg-black/30" aria-hidden>
      <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/[0.07] px-4 py-2.5 text-[11px] uppercase tracking-[0.08em] text-white/35 sm:grid-cols-[1fr_9rem_3rem]">
        <span>Request</span>
        <span className="hidden sm:block">Status</span>
        <span className="text-right">Updated</span>
      </div>
      {rows.map((r) => (
        <div key={r.s} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-white/[0.05] px-4 py-3 text-[13px] last:border-0 sm:grid-cols-[1fr_9rem_3rem]">
          <span className="flex min-w-0 items-center gap-2.5 text-white/80">
            <CircleDot className="size-3.5 shrink-0 text-white/30" />
            <span className="truncate">{r.s}</span>
          </span>
          <span className={`hidden w-fit rounded-full px-2.5 py-0.5 text-[11.5px] sm:block ${r.tone}`}>{r.st}</span>
          <span className="text-right font-mono text-[12px] text-white/40">{r.t}</span>
        </div>
      ))}
    </div>
  );
}

/** The request lifecycle, drawn like a log. */
export function LifecycleLog() {
  const lines = [
    { t: "09:14", k: "sent", v: "Request received, with your workspace and the page you were on" },
    { t: "09:40", k: "read", v: "Read by a person on the team, not a bot" },
    { t: "11:02", k: "reply", v: "Answer sent to your email and to /support" },
    { t: "11:30", k: "resolved", v: "You confirm it works; we turn the answer into a help article" },
  ];
  return (
    <div className={`${frame} p-4 font-mono text-[12px] sm:text-[12.5px]`} aria-hidden>
      <div className="mb-3 flex items-center gap-2 text-white/40">
        <Sparkle className="size-3.5 text-highlight" /> request #2481
      </div>
      <ol className="flex flex-col gap-2.5">
        {lines.map((l) => (
          <li key={l.k} className="grid grid-cols-[3rem_4.5rem_1fr] gap-2 leading-relaxed sm:grid-cols-[3.25rem_5rem_1fr]">
            <span className="text-white/35">{l.t}</span>
            <span className="text-highlight">{l.k}</span>
            <span className="font-sans text-white/70">{l.v}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
