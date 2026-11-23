"use client";

import { Info, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/features/auth/hooks";
import { formatBytes, formatMs, useCostSettings, useSaveCostSettings, useUsage, type CostSettings, type UsageSummary } from "@/features/platform/api";
import { Chip, ErrorLine, SectionTitle, Stat, ago } from "@/features/platform/ui";

const money = (v: number, c: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: v < 1 ? 4 : 2 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${c}`;
  }
};
const KIND: Record<string, string> = { query: "Query", pipeline: "Pipeline", dynamic_table: "Dynamic table", dataset: "Dataset" };

export function UsageScreen() {
  const [days, setDays] = useState(30);
  const q = useUsage(days);
  const s = q.data;
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Workload & cost"
        description="What your queries, pipelines, dynamic tables, storage and AI requests actually used, and what that would cost at your own rates."
        actions={
          <NativeSelect value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </NativeSelect>
        }
      />
      {q.isPending ? <p className="text-sm text-faint">Loading…</p> : q.error ? <ErrorLine error={q.error} /> : s && <Body s={s} />}
    </PageContainer>
  );
}

function Legend() {
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-surface p-4 text-[12px] text-muted sm:grid-cols-4">
      <p><b className="text-text">Billed cost</b> — not available. Vyuham isn’t connected to a cloud bill and never invents one.</p>
      <p><b className="text-text">Measured</b> — time, rows, storage and AI tokens Vyuham recorded itself.</p>
      <p><b className="text-text">Estimated</b> — measured usage × the rates you enter below.</p>
      <p><b className="text-text">Potential savings</b> — estimates; each one says what it assumes.</p>
    </div>
  );
}

function Body({ s }: { s: UsageSummary }) {
  const m = s.measured;
  const e = s.estimated;
  const compute = m.query_ms + m.pipeline_ms + m.refresh_ms;
  return (
    <>
      <Legend />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Billed cost" value={<span className="text-faint">Not connected</span>} hint={s.billed.reason} />
        <Stat label="Measured compute time" value={formatMs(compute)} hint={`${m.queries} queries · ${m.pipeline_runs} pipeline runs · ${m.refreshes} refreshes`} />
        <Stat label="Estimated cost" value={e.rates_set ? money(e.total, e.currency) : <span className="text-faint">Set your rates</span>} hint={e.rates_set ? `For the last ${s.period_days} days` : "Estimates appear once you enter rates."} />
        <Stat label="Storage (measured)" value={formatBytes(m.storage_bytes)} hint={`${m.datasets} datasets`} />
        <Stat label="Data scanned (upper bound)" value={formatBytes(m.scanned_bytes_upper_bound)} hint="Size of the datasets queries read; DuckDB often reads less." />
        <Stat label="AI requests" value={m.ai_requests.toLocaleString()} hint={`${(m.ai_input_tokens + m.ai_output_tokens).toLocaleString()} tokens${m.ai_requests_without_usage ? ` · ${m.ai_requests_without_usage} without token data` : ""}`} />
        <Stat label="Time spent on failures" value={formatMs(m.failed_ms)} hint={e.rates_set ? `≈ ${money(e.failed_work, e.currency)} estimated` : "Failed runs still use resources."} />
        <Stat label="Notebook time" value={<span className="text-faint">Not tracked</span>} hint={m.notebooks.reason} />
      </div>
      {s.budget && <Budget b={s.budget} currency={e.currency} />}
      {s.suggestions.length > 0 && (
        <Panel className="flex flex-col gap-2">
          <SectionTitle>Suggestions</SectionTitle>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">{s.suggestions.map((x) => <li key={x}>{x}</li>)}</ul>
        </Panel>
      )}
      <Trend s={s} />
      <Tabs defaultValue="ranking">
        <TabsList className="flex-wrap">
          <TabsTrigger value="ranking">Workload ranking</TabsTrigger>
          <TabsTrigger value="queries">Queries</TabsTrigger>
          <TabsTrigger value="pipelines">Pipelines & tables</TabsTrigger>
          <TabsTrigger value="datasets">Datasets</TabsTrigger>
          <TabsTrigger value="people">People & projects</TabsTrigger>
          <TabsTrigger value="waste">Idle & savings</TabsTrigger>
          <TabsTrigger value="rates">Rates & budget</TabsTrigger>
        </TabsList>
        <TabsContent value="ranking" className="pt-4">
          <Table head={["Operation", "Kind", "Total time", "Runs", "Average", "Est. cost", "Opportunity"]}
            rows={s.ranking.map((r) => [r.name, KIND[r.kind], formatMs(r.total_ms), r.runs, formatMs(r.avg_ms), e.rates_set ? money(r.estimated_cost, e.currency) : "–", r.opportunity ?? <span className="text-faint">–</span>])}
            empty="Nothing has run in this period." />
          <h3 className="mt-6 mb-2 text-[13px] font-medium text-text">Long-running workloads</h3>
          <Table head={["When", "Kind", "Name", "Duration", "Status", "By"]} rows={s.long_running.map((r) => [ago(r.at), KIND[r.kind] ?? r.kind, r.name, formatMs(r.duration_ms), <Chip key="s" tone={r.status === "ok" ? "success" : r.status} />, r.user ?? "–"])}
            empty="No query over 5 seconds or run over a minute." />
        </TabsContent>
        <TabsContent value="queries" className="pt-4">
          <p className="mb-2 text-[12px] text-faint">Grouped by query shape: the same query with different values counts as one. Vyuham stores a fingerprint, not the SQL.</p>
          <Table head={["Query", "Runs", "Total", "Average", "Slowest", "Rows", "Scanned (≤)", "Errors", "People", "Last run"]}
            rows={s.by_query.map((r) => [r.name ?? <code key="f">{r.fingerprint.slice(0, 8)}</code>, r.runs, formatMs(r.total_ms), formatMs(r.avg_ms), formatMs(r.max_ms), r.rows.toLocaleString(), formatBytes(r.scanned_bytes), r.errors, r.users, ago(r.last_at)])}
            empty="No SQL queries in this period." />
          <h3 className="mt-6 mb-2 text-[13px] font-medium text-text">Repeated expensive queries</h3>
          <Table head={["Query", "Runs", "Average", "Total"]} rows={s.repeated_expensive.map((r) => [r.name ?? r.fingerprint.slice(0, 8), r.runs, formatMs(r.avg_ms), formatMs(r.total_ms)])}
            empty="None: no query ran 5+ times at over a second each." />
        </TabsContent>
        <TabsContent value="pipelines" className="pt-4">
          <Table head={["Pipeline", "Runs", "Failed", "Total", "Slowest", "Rows written"]}
            rows={s.by_pipeline.map((r) => [<Link key="l" href={`/pipelines/${r.pipeline_id}`} className="text-highlight hover:underline">{r.name}</Link>, r.runs, r.failed, formatMs(r.total_ms), formatMs(r.max_ms), r.rows_written.toLocaleString()])}
            empty="No pipeline runs in this period." />
          <h3 className="mt-6 mb-2 text-[13px] font-medium text-text">Dynamic tables</h3>
          <Table head={["Table", "Refreshes", "Incremental", "Failed", "Total", "Slowest"]}
            rows={s.by_dynamic_table.map((r) => [<Link key="l" href={`/dynamic-tables/${r.table_id}`} className="text-highlight hover:underline">{r.name}</Link>, r.refreshes, r.incremental, r.failed, formatMs(r.total_ms), formatMs(r.max_ms)])}
            empty="No refreshes in this period." />
        </TabsContent>
        <TabsContent value="datasets" className="pt-4">
          <Table head={["Dataset", "Layer", "Storage", "Rows", "Reads", "Scanned (≤)", "Last read", "Storage / month"]}
            rows={s.by_dataset.map((r) => [r.name, r.layer ?? "–", formatBytes(r.storage_bytes), r.rows.toLocaleString(), r.reads, formatBytes(r.scanned_bytes), ago(r.last_read_at), e.rates_set ? money(r.storage_cost_month, e.currency) : "–"])}
            empty="No datasets." />
        </TabsContent>
        <TabsContent value="people" className="pt-4">
          <Table head={["Person", "Queries", "Query time", "Pipeline time", "AI tokens", "Scanned (≤)"]}
            rows={s.by_user.map((r) => [r.name, r.queries, formatMs(r.query_ms), formatMs(r.pipeline_ms), r.ai_tokens.toLocaleString(), formatBytes(r.scanned_bytes)])} empty="No usage." />
          <h3 className="mt-6 mb-2 text-[13px] font-medium text-text">By project</h3>
          <Table head={["Project", "Queries", "Pipelines", "Dynamic tables", "Total"]}
            rows={s.by_project.map((r) => [r.name, formatMs(r.query_ms), formatMs(r.pipeline_ms), formatMs(r.refresh_ms), formatMs(r.total_ms)])} empty="No usage." />
        </TabsContent>
        <TabsContent value="waste" className="pt-4">
          <Table head={["Resource", "Kind", "Why", "Storage", "Monthly (est.)"]}
            rows={s.idle.map((r) => [r.name, KIND[r.kind] ?? r.kind, r.detail, r.storage_bytes ? formatBytes(r.storage_bytes) : "–", e.rates_set ? money(r.monthly_cost, e.currency) : "–"])}
            empty="Nothing looks idle." />
          <h3 className="mt-6 mb-2 text-[13px] font-medium text-text">Potential savings (estimates)</h3>
          <Table head={["Change", "Time saved (measured basis)", "Estimated saving", "Assumes"]}
            rows={s.savings.map((r) => [r.what, r.measured_ms ? formatMs(r.measured_ms) : "–", e.rates_set ? money(r.estimated, e.currency) : "Set rates", r.assumes])}
            empty="No savings found." />
        </TabsContent>
        <TabsContent value="rates" className="pt-4"><RatesForm /></TabsContent>
      </Tabs>
    </>
  );
}

function Budget({ b, currency }: { b: NonNullable<UsageSummary["budget"]>; currency: string }) {
  const pct = Math.min(100, b.projected_pct);
  return (
    <Panel className="flex flex-col gap-3">
      <SectionTitle action={<Chip tone={b.status} />}>Monthly budget (estimated)</SectionTitle>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(b.projected_pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Projected share of budget">
        <div className={b.status === "over" ? "h-full bg-destructive" : b.status === "warn" ? "h-full bg-yellow-500" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[13px] text-muted">
        {money(b.month_to_date, currency)} so far this month; at this pace about <b className="text-text">{money(b.projected, currency)}</b> of {money(b.monthly_budget, currency)} ({b.projected_pct}%). You’re warned at {b.threshold_pct}%.
      </p>
    </Panel>
  );
}

function Trend({ s }: { s: UsageSummary }) {
  const max = Math.max(1, ...s.trend.map((d) => d.query_ms + d.pipeline_ms + d.refresh_ms));
  const total = s.trend.reduce((a, d) => a + d.query_ms + d.pipeline_ms + d.refresh_ms, 0);
  return (
    <Panel className="flex flex-col gap-3">
      <SectionTitle>Compute time per day</SectionTitle>
      {total === 0 ? <p className="text-[13px] text-faint">Nothing ran in this period.</p> : (
        <>
          <div className="flex h-36 items-end gap-[2px]" role="img" aria-label={`Daily compute time over ${s.period_days} days; total ${formatMs(total)}`}>
            {s.trend.map((d) => {
              const h = (v: number) => `${(v / max) * 100}%`;
              return (
                <div key={d.day} className="group relative flex h-full min-w-[3px] flex-1 flex-col justify-end" title={`${d.day}: queries ${formatMs(d.query_ms)}, pipelines ${formatMs(d.pipeline_ms)}, refreshes ${formatMs(d.refresh_ms)}`}>
                  <div style={{ height: h(d.refresh_ms) }} className="bg-sky-500/80" />
                  <div style={{ height: h(d.pipeline_ms) }} className="bg-highlight/80" />
                  <div style={{ height: h(d.query_ms) }} className="rounded-t-[2px] bg-primary" />
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-4 text-[12px] text-muted">
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-primary" /> Queries</span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-highlight/80" /> Pipelines</span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-sky-500/80" /> Dynamic table refreshes</span>
          </div>
        </>
      )}
    </Panel>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="text-[13px] text-faint">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-[12px]">
        <thead className="bg-surface text-muted"><tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => <tr key={i} className="align-top">{r.map((c, j) => <td key={j} className="px-3 py-2 tabular-nums text-text">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

const RATE_FIELDS: { key: keyof CostSettings; label: string; hint: string }[] = [
  { key: "compute_per_hour", label: "Compute, per hour", hint: "What an hour of query/pipeline time costs you (server or warehouse)." },
  { key: "storage_per_gb_month", label: "Storage, per GB-month", hint: "Disk or object storage." },
  { key: "scan_per_gb", label: "Data scanned, per GB", hint: "For engines that bill per byte read." },
  { key: "ai_input_per_mtok", label: "AI input, per million tokens", hint: "From your AI provider's price list." },
  { key: "ai_output_per_mtok", label: "AI output, per million tokens", hint: "" },
];

function RatesForm() {
  const me = useMe();
  const settings = useCostSettings();
  const save = useSaveCostSettings();
  const [form, setForm] = useState<CostSettings | null>(null);
  useEffect(() => { if (settings.data && !form) setForm(settings.data); }, [settings.data, form]);
  if (!form) return <p className="text-sm text-faint">Loading…</p>;
  const owner = me.data?.role === "owner";
  const num = (v: string) => (v === "" ? 0 : Math.max(0, Number(v)));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="flex items-start gap-2 text-[13px] text-muted"><Info className="mt-0.5 size-4 shrink-0" /> These are your own estimates of what your infrastructure costs. Vyuham multiplies measured usage by them; it never reads or claims a real bill.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Currency (ISO code)
          <Input value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} disabled={!owner} />
        </label>
        {RATE_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-[12px] text-faint">
            {f.label}
            <Input type="number" min={0} step="0.0001" value={String(form[f.key] ?? 0)} onChange={(e) => setForm({ ...form, [f.key]: num(e.target.value) })} disabled={!owner} />
            {f.hint && <span>{f.hint}</span>}
          </label>
        ))}
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Monthly budget (optional)
          <Input type="number" min={0} value={form.monthly_budget ?? ""} onChange={(e) => setForm({ ...form, monthly_budget: e.target.value === "" ? null : num(e.target.value) })} disabled={!owner} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Warn at (% of budget)
          <Input type="number" min={1} max={100} value={form.alert_threshold_pct} onChange={(e) => setForm({ ...form, alert_threshold_pct: Math.min(100, Math.max(1, Number(e.target.value) || 80)) })} disabled={!owner} />
        </label>
      </div>
      {owner ? (
        <div><Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} Save rates</Button></div>
      ) : <p className="text-[12px] text-faint">Only owners can change rates and the budget.</p>}
      <ErrorLine error={save.error} />
      {save.isSuccess && <p className="text-[13px] text-muted">Saved. Estimates now use these rates.</p>}
    </div>
  );
}
