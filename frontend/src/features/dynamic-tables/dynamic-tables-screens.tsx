"use client";

import { ArrowRight, CheckCircle2, Loader2, Pause, Play, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel, PanelRow } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  errorText, formatMs, useDynamicGraph, useDynamicMutations, useDynamicPreview, useDynamicTable, useDynamicTables, useRefreshes, validateDynamic,
  type DynamicBody, type DynamicTable,
} from "@/features/platform/api";
import { Chip, ErrorLine, RowsTable, SectionTitle, ago } from "@/features/platform/ui";
import { useDebounced } from "@/lib/use-debounced";

const INTERVALS: { label: string; value: number | null }[] = [
  { label: "Only when I refresh it", value: null },
  { label: "Every 15 minutes", value: 15 },
  { label: "Every hour", value: 60 },
  { label: "Every 6 hours", value: 360 },
  { label: "Every day", value: 1440 },
  { label: "Every week", value: 10080 },
];
const every = (m: number | null) => INTERVALS.find((i) => i.value === m)?.label ?? (m ? `Every ${m} minutes` : "Manual");

export function DynamicTablesList() {
  const tables = useDynamicTables();
  const [creating, setCreating] = useState(false);
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Dynamic tables"
        description="Tables defined by a SQL query that Vyuham keeps fresh. Dependencies are found from the query, refreshes run in the background in dependency order, and every refresh is recorded."
        actions={<Button onClick={() => setCreating((v) => !v)}><Plus /> New dynamic table</Button>}
      />
      {creating && <TableForm onDone={() => setCreating(false)} />}
      <DependencyGraph />
      {tables.isPending ? <p className="text-sm text-faint">Loading…</p> : tables.error ? <ErrorLine error={tables.error} /> : !tables.data?.length ? (
        <Panel><p className="text-[13px] text-muted">No dynamic tables yet. Write a query over your datasets and choose how fresh it should be.</p></Panel>
      ) : (
        <Panel variant="list">
          {tables.data.map((t) => (
            <PanelRow key={t.id} interactive>
              <Link href={`/dynamic-tables/${t.id}`} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-text">{t.name}</span>
                  <span className="text-[12px] text-faint">
                    {t.row_count.toLocaleString()} rows · {every(t.interval_minutes)}{t.on_upstream_change ? " · on upstream change" : ""} · {t.refresh_mode === "incremental" ? "incremental" : "full refresh"} · refreshed {ago(t.last_refresh_at)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {t.layer && <Chip tone="pending">{t.layer}</Chip>}
                  <Chip tone={t.status} />
                </span>
              </Link>
            </PanelRow>
          ))}
        </Panel>
      )}
    </PageContainer>
  );
}

/** Upstream datasets on the left, dynamic tables to the right, by dependency depth. */
function DependencyGraph() {
  const g = useDynamicGraph();
  const layers = useMemo(() => {
    if (!g.data?.nodes.length) return [];
    const ups = new Map<string, string[]>();
    g.data.edges.forEach((e) => ups.set(e.to, [...(ups.get(e.to) ?? []), e.from]));
    const depth = new Map<string, number>();
    const level = (id: string, seen: Set<string>): number => {
      if (depth.has(id)) return depth.get(id)!;
      const d = 1 + Math.max(-1, ...(ups.get(id) ?? []).filter((u) => !seen.has(u)).map((u) => level(u, new Set([...seen, u]))));
      depth.set(id, d);
      return d;
    };
    g.data.nodes.forEach((n) => level(n.id, new Set([n.id])));
    const cols: (typeof g.data.nodes)[] = [];
    g.data.nodes.forEach((n) => (cols[depth.get(n.id)!] ??= []).push(n));
    return cols.filter(Boolean);
  }, [g]);
  if (!layers.length) return null;
  const ups = (id: string) => g.data!.edges.filter((e) => e.to === id).map((e) => g.data!.nodes.find((n) => n.id === e.from)?.name).filter(Boolean);
  return (
    <section className="flex flex-col gap-3" aria-label="Dependency graph">
      <SectionTitle>Dependency graph</SectionTitle>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {layers.map((col, i) => (
          <div key={i} className="flex items-center gap-3">
            {i > 0 && <ArrowRight className="size-4 shrink-0 text-faint" aria-hidden />}
            <ul className="flex min-w-[180px] flex-col gap-2">
              {col.map((n) => (
                <li key={n.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px]">
                  {n.table_id ? <Link href={`/dynamic-tables/${n.table_id}`} className="font-medium text-text hover:underline">{n.name}</Link> : <span className="font-medium text-text">{n.name}</span>}
                  <span className="mt-0.5 flex items-center gap-1.5 text-faint">
                    {n.kind === "dynamic" ? <Chip tone={n.status ?? "pending"} /> : "dataset"}{n.layer && ` · ${n.layer}`}
                  </span>
                  {ups(n.id).length > 0 && <span className="sr-only">Reads {ups(n.id).join(", ")}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function TableForm({ table, onDone }: { table?: DynamicTable; onDone: () => void }) {
  const router = useRouter();
  const m = useDynamicMutations(table?.id);
  const [form, setForm] = useState<DynamicBody>({
    name: table?.name ?? "", sql: table?.sql ?? "", layer: (table?.layer as DynamicBody["layer"]) ?? "silver", interval_minutes: table?.interval_minutes ?? 60,
    on_upstream_change: table?.on_upstream_change ?? false, refresh_mode: table?.refresh_mode ?? "full", watermark_column: table?.watermark_column ?? "",
  });
  const set = (p: Partial<DynamicBody>) => setForm((f) => ({ ...f, ...p }));
  const sql = useDebounced(form.sql, 600);
  const [check, setCheck] = useState<{ ok: boolean; error: string | null; dependencies: { id: string; name: string }[] } | null>(null);
  useEffect(() => {
    if (!sql.trim()) return setCheck(null);
    let live = true;
    validateDynamic(sql, table?.id).then((r) => live && setCheck(r)).catch((e) => live && setCheck({ ok: false, error: errorText(e), dependencies: [] }));
    return () => { live = false; };
  }, [sql, table?.id]);

  const submit = () =>
    m.save.mutate({ ...form, watermark_column: form.refresh_mode === "incremental" ? form.watermark_column : null }, {
      onSuccess: (t) => { onDone(); if (!table) router.push(`/dynamic-tables/${t.id}`); },
    });
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5" aria-label={table ? "Edit definition" : "New dynamic table"}>
      <SectionTitle>{table ? "Edit definition" : "New dynamic table"}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[12px] text-faint sm:col-span-2">
          Name
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} disabled={!!table} placeholder="Customer revenue" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Layer
          <NativeSelect value={form.layer ?? ""} onChange={(e) => set({ layer: (e.target.value || null) as DynamicBody["layer"] })}>
            <option value="">None</option><option value="bronze">Bronze</option><option value="silver">Silver</option><option value="gold">Gold</option>
          </NativeSelect>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[12px] text-faint">
        Query (one read-only SELECT over your datasets)
        <Textarea value={form.sql} onChange={(e) => set({ sql: e.target.value })} rows={8} className="font-mono text-[13px]" spellCheck={false} placeholder="SELECT region, SUM(amount) AS revenue FROM orders GROUP BY 1" />
      </label>
      {check && (check.ok ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted"><CheckCircle2 className="size-4 text-emerald-500" /> Valid. Depends on {check.dependencies.map((d) => <Chip key={d.id} tone="pending">{d.name}</Chip>)}</p>
      ) : <p className="flex items-start gap-1.5 text-[13px] text-destructive"><XCircle className="mt-0.5 size-4 shrink-0" />{check.error}</p>)}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Target freshness
          <NativeSelect value={form.interval_minutes ?? ""} onChange={(e) => set({ interval_minutes: e.target.value ? Number(e.target.value) : null })}>
            {INTERVALS.map((i) => <option key={i.label} value={i.value ?? ""}>{i.label}</option>)}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Refresh mode
          <NativeSelect value={form.refresh_mode} onChange={(e) => set({ refresh_mode: e.target.value as DynamicBody["refresh_mode"] })}>
            <option value="full">Full refresh</option>
            <option value="incremental">Incremental (append-only sources)</option>
          </NativeSelect>
        </label>
        {form.refresh_mode === "incremental" && (
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            Watermark column
            <Input value={form.watermark_column ?? ""} onChange={(e) => set({ watermark_column: e.target.value })} placeholder="ordered_at" />
          </label>
        )}
      </div>
      {form.refresh_mode === "incremental" && (
        <p className="text-[12px] text-faint">Incremental refresh appends rows whose watermark is newer than the last refresh. Rows changed or deleted upstream only show after a full refresh. The first refresh is always full.</p>
      )}
      <label className="flex items-center gap-2 text-[13px] text-muted">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!form.on_upstream_change} onChange={(e) => set({ on_upstream_change: e.target.checked })} />
        Also refresh when a table it reads changes
      </label>
      <ErrorLine error={m.save.error} />
      <div className="flex gap-2">
        <Button onClick={submit} disabled={m.save.isPending || !form.name.trim() || !check?.ok}>{m.save.isPending && <Loader2 className="animate-spin" />} {table ? "Save and rebuild" : "Create and refresh"}</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </section>
  );
}

export function DynamicTableScreen({ id }: { id: string }) {
  const router = useRouter();
  const t = useDynamicTable(id);
  const history = useRefreshes(id);
  const m = useDynamicMutations(id);
  const [editing, setEditing] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const preview = useDynamicPreview(id, showPreview && !!t.data?.last_refresh_at);
  if (t.isPending) return <PageContainer><p className="text-sm text-faint">Loading…</p></PageContainer>;
  if (t.error || !t.data) return <PageContainer><ErrorLine error={t.error} /></PageContainer>;
  const d = t.data;
  const busy = d.status === "refreshing" || d.status === "pending" || m.refresh.isPending;
  return (
    <PageContainer width="wide">
      <PageHeader
        title={d.name}
        crumb={d.name}
        back={{ href: "/dynamic-tables", label: "Dynamic tables" }}
        description={<span className="flex flex-wrap items-center gap-2"><Chip tone={d.status} /> {d.row_count.toLocaleString()} rows · refreshed {ago(d.last_refresh_at)}{d.next_refresh_at && !d.paused ? ` · next ${ago(d.next_refresh_at)}` : ""}</span>}
        actions={
          <>
            <Button variant="outline" onClick={() => m.refresh.mutate(false)} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh now</Button>
            {d.refresh_mode === "incremental" && <Button variant="outline" onClick={() => m.refresh.mutate(true)} disabled={busy}>Full refresh</Button>}
            <Button variant="outline" onClick={() => m.patch.mutate({ paused: !d.paused })}>{d.paused ? <Play /> : <Pause />} {d.paused ? "Resume" : "Pause"}</Button>
            <Button variant="ghost" onClick={() => setEditing((v) => !v)}>{editing ? "Close editor" : "Edit definition"}</Button>
          </>
        }
      />
      <ErrorLine error={m.refresh.error ?? m.patch.error} />
      {d.last_error && d.status === "failed" && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-[13px]">
          <p className="font-medium text-text">The last refresh failed{d.failures > 1 ? ` (${d.failures} times in a row)` : ""}</p>
          <p className="mt-1 font-mono text-[12px] text-destructive">{d.last_error}</p>
          {d.next_refresh_at && <p className="mt-1 text-faint">It will be retried {ago(d.next_refresh_at)}.</p>}
        </div>
      )}
      {editing && <TableForm table={d} onDone={() => setEditing(false)} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="flex flex-col gap-2 lg:col-span-2">
          <SectionTitle>Definition</SectionTitle>
          <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12px] text-text">{d.sql}</pre>
          <p className="text-[12px] text-faint">{d.refresh_mode_note}</p>
        </Panel>
        <Panel className="flex flex-col gap-3">
          <SectionTitle>Freshness</SectionTitle>
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            Refresh
            <NativeSelect value={d.interval_minutes ?? ""} onChange={(e) => m.patch.mutate(e.target.value ? { interval_minutes: Number(e.target.value) } : { clear_interval: true })}>
              {INTERVALS.map((i) => <option key={i.label} value={i.value ?? ""}>{i.label}</option>)}
            </NativeSelect>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={d.on_upstream_change} onChange={(e) => m.patch.mutate({ on_upstream_change: e.target.checked })} />
            Refresh after upstream changes
          </label>
          <div className="text-[12px] text-faint">
            Reads: {d.upstream.map((u) => <Chip key={u.id} tone="pending" className="mr-1">{u.name}</Chip>)}
          </div>
          <Link href={`/data/${d.dataset_id}`} className="text-[13px] text-highlight hover:underline">Open the table in Data</Link>
        </Panel>
      </div>

      <section className="flex flex-col gap-3">
        <SectionTitle action={<Button variant="ghost" size="sm" onClick={() => setShowPreview((v) => !v)}>{showPreview ? "Hide" : "Show"}</Button>}>Output preview</SectionTitle>
        {showPreview && (preview.isPending && d.last_refresh_at ? <p className="text-[13px] text-faint">Loading…</p> : preview.data ? <RowsTable columns={preview.data.columns} rows={preview.data.rows} /> : <p className="text-[13px] text-faint">The table hasn’t been built yet.</p>)}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Refresh history</SectionTitle>
        {!history.data?.length ? <p className="text-[13px] text-faint">No refreshes yet.</p> : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-surface text-muted">
                <tr>{["When", "Status", "Trigger", "Mode", "Rows", "Added", "Duration", "Details"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.data.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-text">{ago(r.created_at)}</td>
                    <td className="px-3 py-2"><Chip tone={r.status} /></td>
                    <td className="px-3 py-2 text-muted">{r.trigger}{r.attempt > 1 ? ` (attempt ${r.attempt})` : ""}</td>
                    <td className="px-3 py-2 text-muted">{r.mode === "incremental" ? "Incremental" : "Full"}</td>
                    <td className="px-3 py-2 tabular-nums">{r.rows?.toLocaleString() ?? "–"}</td>
                    <td className="px-3 py-2 tabular-nums">{r.rows_added?.toLocaleString() ?? "–"}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMs(r.duration_ms)}</td>
                    <td className="max-w-[360px] px-3 py-2 text-muted">
                      {r.error && <span className="font-mono text-destructive">{r.error}</span>}
                      {r.schema_change && (
                        <span>Schema changed: {[r.schema_change.added.length && `added ${r.schema_change.added.join(", ")}`, r.schema_change.removed.length && `removed ${r.schema_change.removed.join(", ")}`, r.schema_change.retyped.length && `retyped ${r.schema_change.retyped.join(", ")}`].filter(Boolean).join("; ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => {
          const keep = confirm(`Stop maintaining “${d.name}”?\n\nOK keeps its last result as an ordinary dataset. Cancel to choose deleting it.`);
          if (keep) return m.remove.mutate(true, { onSuccess: () => router.push("/dynamic-tables") });
          if (confirm(`Delete “${d.name}” and its data? This can't be undone.`)) m.remove.mutate(false, { onSuccess: () => router.push("/dynamic-tables") });
        }}><Trash2 /> Remove</Button>
      </div>
    </PageContainer>
  );
}
