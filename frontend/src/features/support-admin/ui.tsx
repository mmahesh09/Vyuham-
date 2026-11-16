"use client";

import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const MODULE_LABEL: Record<string, string> = {
  sql_lab: "SQL Lab",
  dashboard: "Dashboards",
  automations: "Automations",
  reports: "Reports",
  datasets: "Data uploads",
  alerts: "Alerts",
  auth: "Sign-in",
  other: "Other",
};

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`);
export const num = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toLocaleString());
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");

export function Panel({ title, description, action, children, className }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-4 rounded-[20px] border border-line bg-surface p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          {description && <p className="text-[13px] text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A headline number. Text stays in text colours; a status badge carries meaning with words, not colour alone. */
export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: { label: string; variant: "success-light" | "warning-light" | "destructive-light" | "info-light" } }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[16px] border border-line bg-surface p-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-display text-[28px] font-semibold leading-tight tabular-nums">{value}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
        {tone && <Badge variant={tone.variant}>{tone.label}</Badge>}
        {hint}
      </span>
    </div>
  );
}

/** A chart with a table view of the same numbers, for screen readers, exact values and copying. */
export function ChartWithTable({ chart, rows, columns }: { chart: React.ReactNode; rows: (string | number)[][]; columns: string[] }) {
  const [table, setTable] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      {table ? (
        <div className="max-h-64 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>{columns.map((c, i) => <TableHead key={c} className={i ? "text-right" : ""}>{c}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>{r.map((v, j) => <TableCell key={j} className={j ? "text-right tabular-nums" : ""}>{typeof v === "number" ? v.toLocaleString() : v}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        chart
      )}
      <button type="button" onClick={() => setTable((t) => !t)} className="self-end text-[12px] text-faint hover:text-text">
        {table ? "Show as chart" : "Show as table"}
      </button>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "warning-light" | "success-light" | "destructive-light" | "secondary" | "info-light" }> = {
    open: { label: "Open", variant: "warning-light" },
    resolved: { label: "Resolved", variant: "success-light" },
    pending: { label: "Pending review", variant: "warning-light" },
    approved: { label: "Verified", variant: "success-light" },
    rejected: { label: "Rejected", variant: "destructive-light" },
    archived: { label: "Archived", variant: "secondary" },
  };
  const m = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function ScopeBadge({ scope, workspace }: { scope: "global" | "tenant"; workspace?: string | null }) {
  return scope === "global" ? <Badge variant="info-light">All customers</Badge> : <Badge variant="secondary">Workspace: {workspace ?? "private"}</Badge>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}
