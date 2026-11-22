"use client";

import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, ChevronDown, CircleAlert, CircleX, LoaderCircle, Play, Plus, ShieldCheck, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { InlineAlert } from "@/components/app/inline-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { Dataset } from "./api";
import { useQuality, useQualityMutations, type QualityRun, type Rule, type RuleInput, type RuleKind, type RuleResult } from "./platform-api";

const KINDS: { value: RuleKind; label: string; hint: string; column: boolean; types?: string[] }[] = [
  { value: "not_null", label: "No blanks", hint: "Every row has a value", column: true },
  { value: "unique", label: "Unique", hint: "No value appears twice", column: true },
  { value: "accepted_values", label: "Allowed values", hint: "Only values from a list", column: true },
  { value: "range", label: "Within range", hint: "Numbers between a min and max", column: true, types: ["number"] },
  { value: "regex", label: "Matches a pattern", hint: "Like an email or a code format", column: true },
  { value: "freshness", label: "Fresh data", hint: "The newest date isn't too old", column: true, types: ["date"] },
  { value: "row_count", label: "Row count", hint: "The table isn't unexpectedly small or big", column: false },
  { value: "sql", label: "Custom SQL", hint: "A SELECT that returns the bad rows", column: false },
];

const STATUS = {
  pass: { icon: CheckCircle2, tone: "text-success", label: "Passed" },
  warn: { icon: TriangleAlert, tone: "text-warning", label: "Warnings" },
  fail: { icon: CircleX, tone: "text-accent", label: "Failed" },
  error: { icon: CircleAlert, tone: "text-faint", label: "Couldn't run" },
} as const;

function StatusIcon({ status, className }: { status: keyof typeof STATUS; className?: string }) {
  const s = STATUS[status];
  return (
    <>
      <s.icon className={cn("size-4 shrink-0", s.tone, className)} aria-hidden />
      <span className="sr-only">{s.label}: </span>
    </>
  );
}

function AddRule({ dataset, onAdd, pending, error }: { dataset: Dataset; onAdd: (r: RuleInput) => void; pending: boolean; error?: string }) {
  const [kind, setKind] = useState<RuleKind>("not_null");
  const [column, setColumn] = useState(dataset.columns[0]?.name ?? "");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [severity, setSeverity] = useState<"error" | "warn">("error");
  const meta = KINDS.find((k) => k.value === kind)!;
  const columns = dataset.columns.filter((c) => !meta.types || meta.types.includes(c.type));
  const col = columns.some((c) => c.name === column) ? column : (columns[0]?.name ?? "");
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = () => {
    const params: Record<string, unknown> =
      kind === "accepted_values"
        ? { values: a.split(",").map((v) => v.trim()).filter(Boolean) }
        : kind === "range" || kind === "row_count"
          ? { min: num(a), max: num(b) }
          : kind === "regex"
            ? { pattern: a }
            : kind === "freshness"
              ? { max_age_days: Number(a || 1) }
              : kind === "sql"
                ? { sql: a }
                : {};
    onAdd({ kind, column: meta.column ? col : null, params, severity });
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-[8px] border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1.5 text-[12.5px] text-muted">
          Check
          <NativeSelect value={kind} onChange={(e) => (setKind(e.target.value as RuleKind), setA(""), setB(""))}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label} — {k.hint}
              </option>
            ))}
          </NativeSelect>
        </label>
        {meta.column && (
          <label className="flex flex-col gap-1.5 text-[12.5px] text-muted">
            Column
            <NativeSelect value={col} onChange={(e) => setColumn(e.target.value)}>
              {columns.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </NativeSelect>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-[12.5px] text-muted">
          If it fails
          <NativeSelect value={severity} onChange={(e) => setSeverity(e.target.value as "error" | "warn")}>
            <option value="error">Fail the check</option>
            <option value="warn">Just warn</option>
          </NativeSelect>
        </label>
      </div>
      {kind === "accepted_values" && <Input value={a} onChange={(e) => setA(e.target.value)} placeholder="paid, refunded, pending" aria-label="Allowed values, comma separated" />}
      {(kind === "range" || kind === "row_count") && (
        <div className="grid grid-cols-2 gap-3">
          <Input inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} placeholder="Minimum" aria-label="Minimum" />
          <Input inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} placeholder="Maximum" aria-label="Maximum" />
        </div>
      )}
      {kind === "regex" && <Input value={a} onChange={(e) => setA(e.target.value)} placeholder="[^@]+@[^@]+\.[a-z]+" aria-label="Pattern" className="font-mono" />}
      {kind === "freshness" && <Input inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} placeholder="Days, e.g. 1" aria-label="Maximum age in days" />}
      {kind === "sql" && (
        <textarea
          value={a}
          onChange={(e) => setA(e.target.value)}
          rows={3}
          placeholder="SELECT * FROM orders WHERE amount < 0"
          aria-label="SQL returning the rows that break the rule"
          className="rounded-[6px] border border-line bg-bg px-3 py-2 font-mono text-[13px] text-text outline-none focus:border-highlight"
        />
      )}
      {error && <p className="text-[13px] text-accent">{error}</p>}
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        <Plus /> {pending ? "Adding…" : "Add check"}
      </Button>
    </form>
  );
}

function ResultRow({ r }: { r: RuleResult }) {
  const [open, setOpen] = useState(false);
  const cols = r.sample.length ? Object.keys(r.sample[0]).slice(0, 6) : [];
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <StatusIcon status={r.status === "fail" && r.severity === "warn" ? "warn" : r.status === "fail" ? "fail" : r.status} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14px] text-text">{r.description}</span>
          <span className="text-[12.5px] text-faint">{r.message}</span>
        </div>
        {r.sample.length > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-[12.5px] text-highlight hover:underline">
            {open ? "Hide" : "Show"} rows <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <div className="overflow-x-auto rounded-[6px] border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-surface-2 text-muted">
              <tr>
                {cols.map((c) => (
                  <th key={c} className="px-2.5 py-1.5 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.sample.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c} className="max-w-[200px] truncate px-2.5 py-1.5 text-text">
                      {row[c] === null || row[c] === undefined ? <span className="text-faint">blank</span> : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

function LastRun({ run }: { run: QualityRun }) {
  const failed = run.results.filter((r) => r.status === "fail").length;
  return (
    <section aria-labelledby="last-run" className="overflow-hidden rounded-[8px] border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <StatusIcon status={run.status} />
        <h3 id="last-run" className="text-[14.5px] font-semibold text-text">
          {run.status === "pass" ? "All checks passed" : run.status === "error" ? "The checks couldn't run" : `${failed} check${failed === 1 ? "" : "s"} failed`}
        </h3>
        <span className="text-[12.5px] text-faint">
          {run.trigger === "manual" ? "Run by hand" : run.trigger === "refresh" ? "After a refresh" : "Daily check"} ·{" "}
          {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
        </span>
      </header>
      <ul className="divide-y divide-line">
        {run.results.map((r, i) => (
          <ResultRow key={r.rule_id ?? i} r={r} />
        ))}
      </ul>
    </section>
  );
}

/** Data quality checks: add rules (or accept suggestions), run them, and see which rows break them. */
export function QualityPanel({ dataset, canEdit }: { dataset: Dataset; canEdit: boolean }) {
  const { data, isPending, error } = useQuality(dataset.id);
  const m = useQualityMutations(dataset.id);
  const [adding, setAdding] = useState(false);
  if (isPending) return <Skeleton className="h-64 rounded-[8px]" />;
  if (error) return <InlineAlert>{error.message}</InlineAlert>;
  const last = data.runs[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="type-section">Checks</h2>
            <p className="text-[13px] text-muted">Run after every refresh and once a day. A failed check notifies your workspace.</p>
          </div>
          <div className="flex gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
                <Plus /> Add a check
              </Button>
            )}
            <Button size="sm" onClick={() => m.run.mutate()} disabled={!data.rules.length || m.run.isPending}>
              {m.run.isPending ? <LoaderCircle className="animate-spin" /> : <Play />} Run checks
            </Button>
          </div>
        </div>
        {m.run.isError && <InlineAlert>{m.run.error.message}</InlineAlert>}
        {adding && canEdit && (
          <AddRule
            dataset={dataset}
            pending={m.add.isPending}
            error={m.add.error?.message}
            onAdd={(r) => m.add.mutate(r, { onSuccess: () => setAdding(false) })}
          />
        )}
        {data.rules.length === 0 ? (
          <EmptyState
            compact
            icon={<ShieldCheck />}
            title="No checks yet"
            description="Checks catch bad data before it reaches a dashboard: blanks, duplicates, values out of range, data that stopped arriving."
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[8px] border border-line bg-surface">
            {data.rules.map((r: Rule) => {
              const result = last?.results.find((x) => x.rule_id === r.id);
              return (
                <li key={r.id} className={cn("flex items-center gap-3 px-4 py-2.5", !r.enabled && "opacity-60")}>
                  {result ? <StatusIcon status={result.status === "fail" && r.severity === "warn" ? "warn" : result.status} /> : <span className="size-4 rounded-full border border-line-strong" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate text-[14px] text-text">{r.description}</span>
                  <span className={cn("rounded-[4px] px-1.5 py-0.5 text-[11px]", r.severity === "error" ? "bg-accent/10 text-accent" : "bg-warning/10 text-warning")}>
                    {r.severity === "error" ? "Fails" : "Warns"}
                  </span>
                  {canEdit && (
                    <>
                      <button type="button" onClick={() => m.update.mutate({ ruleId: r.id, enabled: !r.enabled })} className="text-[12.5px] text-muted hover:text-text">
                        {r.enabled ? "Pause" : "Resume"}
                      </button>
                      <button type="button" aria-label={`Delete check: ${r.description}`} onClick={() => m.remove.mutate(r.id)} className="rounded p-1 text-faint hover:text-accent">
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {last && <LastRun run={last} />}
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        {canEdit && data.suggestions.length > 0 && (
          <section className="flex flex-col gap-2.5 rounded-[8px] border border-line bg-surface p-4" aria-labelledby="suggested">
            <h3 id="suggested" className="flex items-center gap-2 text-[14px] font-semibold text-text">
              <Sparkles className="size-4 text-highlight" aria-hidden /> Suggested from the data
            </h3>
            <ul className="flex flex-col gap-2">
              {data.suggestions.map((s) => (
                <li key={`${s.kind}-${s.column}`} className="flex items-start gap-2.5 rounded-[6px] bg-surface-2/60 px-3 py-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13px] text-text">{s.description}</span>
                    <span className="text-[12px] text-faint">{s.why}</span>
                  </span>
                  <Button size="sm" variant="outline" disabled={m.add.isPending} onClick={() => m.add.mutate({ kind: s.kind, column: s.column, params: s.params, severity: s.severity })}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.runs.length > 1 && (
          <section className="flex flex-col gap-2 rounded-[8px] border border-line bg-surface p-4" aria-labelledby="history">
            <h3 id="history" className="text-[14px] font-semibold text-text">
              History
            </h3>
            <ol className="flex flex-col gap-1.5">
              {data.runs.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[13px]">
                  <StatusIcon status={r.status} />
                  <span className="text-text">{STATUS[r.status].label}</span>
                  <span className="ml-auto text-faint">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </aside>
    </div>
  );
}
