"use client";

import { formatDistanceToNow } from "date-fns";

import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  over: "border-destructive/30 bg-destructive/10 text-destructive",
  running: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  refreshing: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  queued: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  pending: "border-line bg-surface-2 text-muted",
  skipped: "border-line bg-surface-2 text-faint",
  paused: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  warn: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  restricted: "border-destructive/30 bg-destructive/10 text-destructive",
  confidential: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  internal: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  public: "border-line bg-surface-2 text-muted",
};

const WORDS: Record<string, string> = {
  success: "Succeeded", ok: "Up to date", failed: "Failed", running: "Running", refreshing: "Refreshing", queued: "Queued",
  pending: "Waiting", skipped: "Skipped", paused: "Paused", warn: "Near budget", over: "Over budget", error: "Error",
};

/** A small status label. Colour is never the only signal: the word is always there. */
export function Chip({ tone, children, className }: { tone: string; children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", TONES[tone] ?? TONES.pending, className)}>
      {children ?? WORDS[tone] ?? tone}
    </span>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface p-4", className)}>
      <p className="text-[12px] text-faint">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-text">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

export function ago(at: string | null | undefined) {
  if (!at) return "never";
  try {
    return formatDistanceToNow(new Date(at), { addSuffix: true });
  } catch {
    return at;
  }
}

/** A plain scrolling table for result rows (previews, samples). */
export function RowsTable({ columns, rows, max = 100, empty = "No rows." }: { columns: string[]; rows: Record<string, unknown>[]; max?: number; empty?: string }) {
  if (!rows.length) return <p className="text-[13px] text-faint">{empty}</p>;
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-line">
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-surface text-muted">
          <tr>{columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, max).map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className="max-w-[260px] truncate px-3 py-1.5 tabular-nums text-text">{r[c] == null ? <span className="text-faint">–</span> : String(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-text">{children}</h2>
      {action}
    </div>
  );
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="text-[13px] text-destructive">{error instanceof Error ? error.message : String(error)}</p>;
}
