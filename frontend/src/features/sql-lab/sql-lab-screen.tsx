"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Database, Loader2, Play, Save, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChartSpec, ChartType } from "@/features/charts/chart-spec";
import { SaveToDashboard } from "@/features/command/save-to-dashboard";
import { ChartBody } from "@/features/dashboards/insight-card";
import { useMe } from "@/features/auth/hooks";
import { ExportMenu } from "@/features/reports/export-menu";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type Table = { table: string; dataset_id: string; dataset_name: string; row_count: number; columns: { name: string; type: string }[] };
type RunResult = { columns: string[]; rows: Record<string, string | number | null>[]; row_count: number; truncated: boolean; elapsed_ms: number };
type Saved = { id: string; name: string; sql: string; updated_at: string };

const quoteIdent = (s: string) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);
const VIZ_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "hbar", label: "Ranking" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "treemap", label: "Treemap" },
  { value: "funnel", label: "Funnel" },
  { value: "table", label: "Table" },
];
const selectClass = "h-9 rounded-md border border-input bg-transparent px-2 text-sm text-text";

function exampleSql(t?: Table) {
  if (!t) return "SELECT 1 AS hello";
  const cat = t.columns.find((c) => c.type === "category" || c.type === "text");
  const num = t.columns.find((c) => c.type === "number");
  if (cat && num)
    return `SELECT ${quoteIdent(cat.name)}, SUM(${quoteIdent(num.name)}) AS total\nFROM ${t.table}\nGROUP BY 1\nORDER BY total DESC\nLIMIT 20`;
  return `SELECT *\nFROM ${t.table}\nLIMIT 100`;
}

/** SQL Lab: read-only SQL over your datasets. Results can become a chart on a dashboard. */
export function SqlLabScreen() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const allowed = me?.role !== "viewer";
  const schema = useQuery({ queryKey: ["sql", "schema"], queryFn: () => api<Table[]>("/sql/schema"), enabled: allowed });
  const saved = useQuery({ queryKey: ["sql", "saved"], queryFn: () => api<Saved[]>("/sql/saved"), enabled: allowed });
  const [sql, setSql] = useState<string | null>(null);
  const [current, setCurrent] = useState<Saved | null>(null);
  const [name, setName] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const text = sql ?? exampleSql(schema.data?.[0]);

  const run = useMutation({ mutationFn: (q: string) => api<RunResult>("/sql/run", { method: "POST", body: JSON.stringify({ sql: q }) }) });
  const save = useMutation({
    mutationFn: () =>
      current
        ? api<Saved>(`/sql/saved/${current.id}`, { method: "PUT", body: JSON.stringify({ name: name.trim() || current.name, sql: text }) })
        : api<Saved>("/sql/saved", { method: "POST", body: JSON.stringify({ name: name.trim() || "Untitled query", sql: text }) }),
    onSuccess: (q) => (setCurrent(q), setName(q.name), qc.invalidateQueries({ queryKey: ["sql", "saved"] })),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/sql/saved/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => (current?.id === id && setCurrent(null), qc.invalidateQueries({ queryKey: ["sql", "saved"] })),
  });

  const insert = (snippet: string) => {
    const el = editor.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setSql(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  if (me && !allowed)
    return <p className="mx-auto max-w-[720px] pt-16 text-muted">SQL Lab is for owners and editors. Ask an owner for editor access if you need it.</p>;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 pt-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[38px] font-semibold tracking-[-0.03em]">SQL Lab</h1>
        <p className="text-[15px] text-muted">
          Query your datasets with SQL (DuckDB dialect). Read-only: only <code className="text-highlight">SELECT</code>, and only this workspace&apos;s data.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Schema + saved */}
        <aside className="flex flex-col gap-5" aria-label="Tables and saved queries">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Tables</h2>
            {schema.isPending ? (
              <div className="h-32 animate-pulse rounded-xl bg-surface" />
            ) : !schema.data?.length ? (
              <p className="text-sm text-faint">No datasets yet. Add one on the Data page.</p>
            ) : (
              <ul className="flex max-h-[420px] flex-col gap-1 overflow-y-auto rounded-xl border border-line p-2">
                {schema.data.map((t) => (
                  <li key={t.table}>
                    <details className="group">
                      <summary className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                        <Database className="size-3.5 text-highlight" aria-hidden />
                        <span className="flex-1 truncate font-mono text-[13px]">{t.table}</span>
                        <button type="button" className="text-[11px] text-highlight hover:underline" onClick={(e) => (e.preventDefault(), insert(t.table))}>
                          insert
                        </button>
                      </summary>
                      <p className="px-2 pb-1 text-[11px] text-faint">
                        {t.dataset_name} · {t.row_count.toLocaleString()} rows
                      </p>
                      <ul className="flex flex-col pb-1 pl-6">
                        {t.columns.map((c) => (
                          <li key={c.name}>
                            <button
                              type="button"
                              onClick={() => insert(quoteIdent(c.name))}
                              className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-[12px] hover:bg-surface-2"
                              title={`Insert ${c.name}`}
                            >
                              <span className="truncate font-mono">{c.name}</span>
                              <span className="text-[10px] text-faint">{c.type}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Saved queries</h2>
            {!saved.data?.length ? (
              <p className="text-sm text-faint">Save a query to reuse it.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
                {saved.data.map((q) => (
                  <li key={q.id} className={cn("flex items-center gap-1 px-2 py-1.5", current?.id === q.id && "bg-line/40")}>
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:text-highlight" onClick={() => (setSql(q.sql), setCurrent(q), setName(q.name))}>
                      {q.name}
                    </button>
                    <Button variant="ghost" size="icon-xs" aria-label={`Delete ${q.name}`} onClick={() => remove.mutate(q.id)}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        {/* Editor + results */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col overflow-hidden rounded-[16px] border border-line bg-surface" data-tour="sql-editor">
            <label htmlFor="sql-editor" className="sr-only">
              SQL query
            </label>
            <textarea
              id="sql-editor"
              ref={editor}
              value={text}
              spellCheck={false}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  run.mutate(text);
                }
              }}
              rows={9}
              className="min-h-48 w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed text-text outline-none"
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
              <Button onClick={() => run.mutate(text)} disabled={run.isPending || !text.trim()}>
                {run.isPending ? <Loader2 className="animate-spin" /> : <Play />} Run
              </Button>
              <span className="text-xs text-faint">Ctrl/⌘ + Enter</span>
              <div className="ml-auto flex items-center gap-2">
                <Input aria-label="Query name" placeholder={current?.name ?? "Query name"} value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-44" />
                <Button variant="outline" size="sm" onClick={() => save.mutate()} disabled={save.isPending || !text.trim()}>
                  <Save /> {current ? "Update" : "Save"}
                </Button>
                {/* Exports run the saved query, so save edits first. */}
                {current && <ExportMenu source="saved_query" sourceId={current.id} disabled={current.sql !== text} />}
              </div>
            </div>
          </div>

          {run.isError && (
            <p role="alert" className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 font-mono text-[13px]">
              {run.error.message}
            </p>
          )}
          {run.data && <Results result={run.data} sql={text} datasetId={schema.data?.[0]?.dataset_id} />}
        </section>
      </div>
    </div>
  );
}

function Results({ result, sql, datasetId }: { result: RunResult; sql: string; datasetId?: string }) {
  const [viz, setViz] = useState(false);
  const [type, setType] = useState<ChartType>("bar");
  const [x, setX] = useState(result.columns[0] ?? "");
  const numeric = result.columns.filter((c) => result.rows.some((r) => typeof r[c] === "number"));
  const [y, setY] = useState(numeric.find((c) => c !== result.columns[0]) ?? numeric[0] ?? "");
  const [title, setTitle] = useState("");

  const spec: ChartSpec | null = useMemo(
    () =>
      x && y && datasetId
        ? { dataset: datasetId, sql, groupBy: x, metrics: [{ field: y, agg: "sum" }], chartType: type, title: title.trim() || `${y} by ${x}`, filters: [] }
        : null,
    [x, y, type, title, sql, datasetId],
  );
  // Preview with the renderer's column names (the backend renames the same way when the chart is saved).
  const previewRows = useMemo(() => result.rows.map((r) => ({ [x]: r[x], [`sum_${y}`]: r[y] })), [result.rows, x, y]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {result.row_count.toLocaleString()} rows · {result.elapsed_ms} ms{result.truncated ? " · showing the first 5,000" : ""}
        </p>
        {result.columns.length >= 2 && numeric.length > 0 && (
          <Button variant={viz ? "default" : "outline"} size="sm" onClick={() => setViz((v) => !v)} aria-pressed={viz}>
            <BarChart3 /> Visualize
          </Button>
        )}
      </div>

      {viz && spec && (
        <div className="flex flex-col gap-3 rounded-[16px] border border-line bg-surface p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Chart
              <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as ChartType)}>
                {VIZ_TYPES.map((t) => (
                  <option key={t.value} value={t.value} className="bg-surface">
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Labels
              <select className={selectClass} value={x} onChange={(e) => setX(e.target.value)}>
                {result.columns.map((c) => (
                  <option key={c} value={c} className="bg-surface">
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Values
              <select className={selectClass} value={y} onChange={(e) => setY(e.target.value)}>
                {numeric.map((c) => (
                  <option key={c} value={c} className="bg-surface">
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
              Title
              <Input value={title} placeholder={`${y} by ${x}`} onChange={(e) => setTitle(e.target.value)} className="h-9" />
            </label>
            <SaveToDashboard spec={spec} />
          </div>
          <ChartBody spec={spec} rows={previewRows} height={260} />
          <p className="text-xs text-faint">Charts saved from SQL re-run the query each time. Dashboard filters don&apos;t apply to them.</p>
        </div>
      )}

      <div className="max-h-[480px] overflow-auto rounded-[16px] border border-line">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0 bg-surface-2 text-muted">
            <tr>
              {result.columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {result.rows.slice(0, 500).map((r, i) => (
              <tr key={i}>
                {result.columns.map((c) => (
                  <td key={c} className={cn("max-w-[28ch] truncate whitespace-nowrap px-3 py-1.5", typeof r[c] === "number" && "text-right tabular-nums")}>
                    {r[c] === null ? <span className="text-faint">—</span> : String(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {result.rows.length > 500 && <p className="px-3 py-2 text-xs text-faint">Showing the first 500 rows here.</p>}
        {!result.rows.length && <p className="px-3 py-6 text-center text-sm text-faint">No rows.</p>}
      </div>
    </div>
  );
}
