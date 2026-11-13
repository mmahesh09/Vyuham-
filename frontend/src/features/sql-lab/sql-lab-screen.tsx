"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Clock, Database, FileCode2, Loader2, Play, Plus, Save, Search, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SQLNamespace } from "@codemirror/lang-sql";

import { NativeSelect } from "@/components/ui/native-select";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChartSpec, ChartType } from "@/features/charts/chart-spec";
import { SaveToDashboard } from "@/features/command/save-to-dashboard";
import { ChartBody } from "@/features/dashboards/insight-card";
import { useMe } from "@/features/auth/hooks";
import { ExportMenu } from "@/features/reports/export-menu";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

import { exampleSql, paramsFor, quoteIdent, type Param, type ParamType, type RunResult, type Saved, type Table } from "./params";
import { ResultActions, ResultsGrid } from "./results-grid";
import { SqlEditor, type SqlEditorHandle } from "./sql-editor";
import { isDirty, useLabState, type Tab } from "./use-lab-state";

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

/**
 * A tab's last successful run (what the results, plan and chart describe) and, if the latest run
 * failed, its error. Kept per tab while the page is open.
 */
type Output = {
  sql: string;
  params: Param[];
  result?: RunResult;
  error?: string;
  /** Editor line where the failed run's text started (running a selection), to place its error line. */
  errorFirstLine?: number;
};

type Pane = "rows" | "stats" | "plan" | "chart";
type Side = "tables" | "saved" | "history";

const errorLineOf = (out?: Output) => {
  const m = out?.error?.match(/\(line (\d+)\)/);
  return m ? Number(m[1]) + ((out!.errorFirstLine ?? 1) - 1) : null;
};

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** SQL Lab: a read-only SQL workbench over the workspace's datasets. */
export function SqlLabScreen() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const allowed = me?.role !== "viewer";
  const schema = useQuery({ queryKey: ["sql", "schema"], queryFn: () => api<Table[]>("/sql/schema"), enabled: allowed });
  const saved = useQuery({ queryKey: ["sql", "saved"], queryFn: () => api<Saved[]>("/sql/saved"), enabled: allowed });
  const lab = useLabState(me?.workspace.id);
  const { active, openTab, updateTab } = lab;

  const editor = useRef<SqlEditorHandle>(null);
  const [outputs, setOutputs] = useState<Record<string, Output>>({});
  const [pane, setPane] = useState<Pane>("rows");
  const [side, setSide] = useState<Side>("tables");
  const [hasSelection, setHasSelection] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // First visit: one tab with a query that works on the first dataset.
  useEffect(() => {
    if (lab.ready && !lab.tabs.length && !schema.isPending) openTab({ sql: exampleSql(schema.data?.[0]) });
  }, [lab.ready, lab.tabs.length, schema.isPending, schema.data, openTab]);

  // The name box follows the tab.
  useEffect(() => setName(active?.savedId ? active.title : ""), [active?.id, active?.savedId, active?.title]);

  const completion: SQLNamespace = useMemo(
    () =>
      Object.fromEntries(
        (schema.data ?? []).map((t) => [
          t.table,
          t.columns.map((c) => ({ label: c.name, apply: quoteIdent(c.name), detail: c.type, type: "property" })),
        ]),
      ),
    [schema.data],
  );

  const out = active ? outputs[active.id] : undefined;
  const setOut = (id: string, o: Output) => setOutputs((all) => ({ ...all, [id]: o }));

  const run = useMutation({
    mutationFn: (v: { tabId: string; sql: string; params: Param[]; firstLine: number }) =>
      api<RunResult>("/sql/run", { method: "POST", body: JSON.stringify({ sql: v.sql, params: v.params }) }),
    onMutate: () => setNotice(null),
    onSuccess: (result, v) => {
      setOut(v.tabId, { sql: v.sql, params: v.params, result });
      lab.addHistory({ sql: v.sql, params: v.params, ok: true, rows: result.row_count, ms: result.elapsed_ms });
      setPane((p) => (p === "plan" ? "rows" : p));
    },
    onError: (e, v) => {
      // Keep the last good result (and the SQL it came from) on screen, marked as stale.
      const prev = outputs[v.tabId];
      setOut(v.tabId, { ...(prev?.result ? prev : { sql: v.sql, params: v.params }), error: e.message, errorFirstLine: v.firstLine });
      lab.addHistory({ sql: v.sql, params: v.params, ok: false, error: e.message });
    },
  });

  const doRun = useCallback(() => {
    if (!active || !editor.current) return;
    const r = editor.current.runnable();
    if (!r.sql.trim()) return;
    run.mutate({ tabId: active.id, sql: r.sql, params: paramsFor(r.sql, active.params), firstLine: r.firstLine });
  }, [active, run]);

  const explain = useQuery({
    queryKey: ["sql", "explain", out?.sql, out?.params],
    queryFn: () => api<{ plan: string }>("/sql/explain", { method: "POST", body: JSON.stringify({ sql: out!.sql, params: out!.params }) }),
    enabled: pane === "plan" && !!out?.sql,
    retry: false,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: (tab: Tab) => {
      const body = JSON.stringify({ name: name.trim() || (tab.savedId ? tab.title : "Untitled query"), sql: tab.sql, params: paramsFor(tab.sql, tab.params) });
      return tab.savedId ? api<Saved>(`/sql/saved/${tab.savedId}`, { method: "PUT", body }) : api<Saved>("/sql/saved", { method: "POST", body });
    },
    onSuccess: (q, tab) => {
      updateTab(tab.id, { savedId: q.id, title: q.name, sql: q.sql, params: q.params, savedSql: q.sql, savedParams: q.params });
      setNotice(`Saved “${q.name}”.`);
      qc.invalidateQueries({ queryKey: ["sql", "saved"] });
    },
    onError: (e) => setNotice(e.message),
  });
  const doSave = useCallback(() => {
    if (active?.sql.trim() && !save.isPending) save.mutate(active);
  }, [active, save]);

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/sql/saved/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      // Tabs that were editing it become plain scratch tabs.
      lab.tabs.filter((t) => t.savedId === id).forEach((t) => updateTab(t.id, { savedId: null, savedSql: null, savedParams: null }));
      qc.invalidateQueries({ queryKey: ["sql", "saved"] });
    },
  });

  const openSaved = (q: Saved) => {
    const existing = lab.tabs.find((t) => t.savedId === q.id);
    if (existing) return lab.setActive(existing.id);
    openTab({ title: q.name, sql: q.sql, params: q.params, savedId: q.id, savedSql: q.sql, savedParams: q.params });
  };

  const format = () => {
    try {
      editor.current?.format();
      setNotice(null);
    } catch {
      setNotice("Couldn't format this query. Check it for syntax errors first.");
    }
  };

  const params = active ? paramsFor(active.sql, active.params) : [];
  const setParam = (name: string, patch: Partial<Param>) =>
    active && updateTab(active.id, { params: params.map((p) => (p.name === name ? { ...p, ...patch } : p)) });

  if (me && !allowed)
    return <p className="mx-auto max-w-[720px] pt-16 text-muted">SQL Lab is for owners and editors. Ask an owner for editor access if you need it.</p>;

  const pending = run.isPending && run.variables?.tabId === active?.id;
  const errorLine = errorLineOf(out);
  const dirty = active ? isDirty(active) : false;

  return (
    <PageContainer width="wide" className="gap-5">
      <PageHeader
        title="SQL Lab"
        description={
          <>
            Query your datasets with SQL (DuckDB dialect). Read-only: only <code className="text-highlight">SELECT</code>, and only this workspace&apos;s data. Write{" "}
            <code className="text-accent">{"{{name}}"}</code> to add a parameter.
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Sidebar
          side={side}
          setSide={setSide}
          schema={schema}
          saved={saved.data}
          history={lab.history}
          activeSavedId={active?.savedId ?? null}
          onInsert={(s) => editor.current?.insert(s)}
          onOpenSaved={openSaved}
          onDeleteSaved={(id) => remove.mutate(id)}
          onOpenHistory={(h) => openTab({ sql: h.sql, params: h.params })}
          onClearHistory={lab.clearHistory}
          onNewFromTable={(t) => openTab({ title: t.table, sql: `SELECT *\nFROM ${t.table}\nLIMIT 100` })}
        />

        <section className="flex min-w-0 flex-col gap-4">
          {/* Tabs */}
          <div className="flex items-end gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Open queries">
            {lab.tabs.map((t) => {
              const on = t.id === active?.id;
              return (
                <div
                  key={t.id}
                  className={cn(
                    "group flex shrink-0 items-center gap-1 rounded-t-[10px] border border-b-0 pl-3 pr-1 text-sm",
                    on ? "border-line bg-surface text-text" : "border-transparent text-muted hover:text-text",
                  )}
                >
                  <button type="button" role="tab" aria-selected={on} onClick={() => lab.setActive(t.id)} className="flex max-w-[180px] items-center gap-1.5 py-2">
                    {t.savedId ? <FileCode2 className="size-3.5 shrink-0 text-highlight" aria-hidden /> : null}
                    <span className="truncate">{t.title}</span>
                    {isDirty(t) && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="unsaved changes" />}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${t.title}`}
                    onClick={() => lab.closeTab(t.id)}
                    className="rounded p-1 text-faint opacity-60 hover:bg-surface-2 hover:text-text group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
            <Button variant="ghost" size="icon-xs" className="mb-1.5 ml-1" aria-label="New query tab" onClick={() => openTab({ sql: "" })}>
              <Plus />
            </Button>
          </div>

          {active && (
            <>
              <div className="flex flex-col overflow-hidden rounded-[16px] border border-line bg-surface" data-tour="sql-editor">
                <div className="h-[clamp(220px,32vh,420px)] resize-y overflow-hidden">
                  <SqlEditor
                    ref={editor}
                    value={active.sql}
                    onChange={(sql) => updateTab(active.id, { sql })}
                    schema={completion}
                    onRun={doRun}
                    onSave={doSave}
                    onSelectionChange={setHasSelection}
                    errorLine={errorLine}
                  />
                </div>

                {params.length > 0 && (
                  <div className="flex flex-wrap items-end gap-3 border-t border-line bg-surface-2/40 px-3 py-3" aria-label="Query parameters">
                    {params.map((p) => (
                      <ParamField key={p.name} param={p} onChange={(patch) => setParam(p.name, patch)} onEnter={doRun} />
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
                  <Button onClick={doRun} disabled={pending || !active.sql.trim()}>
                    {pending ? <Loader2 className="animate-spin" /> : <Play />} {hasSelection ? "Run selection" : "Run"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={format} disabled={!active.sql.trim()} title="Format (Shift+Alt+F)">
                    <Wand2 /> Format
                  </Button>
                  <span className="hidden text-xs text-faint sm:inline">Ctrl/⌘+Enter run · Ctrl/⌘+S save · Shift+Alt+F format</span>
                  <div className="ml-auto flex items-center gap-2">
                    <Input
                      aria-label="Query name"
                      placeholder={active.savedId ? active.title : "Query name"}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-8 w-44"
                    />
                    <Button variant="outline" size="sm" onClick={doSave} disabled={save.isPending || !active.sql.trim()}>
                      <Save /> {active.savedId ? "Update" : "Save"}
                    </Button>
                    {/* Exports run the saved query, so save edits first. */}
                    {active.savedId && <ExportMenu source="saved_query" sourceId={active.savedId} disabled={dirty} />}
                  </div>
                </div>
              </div>

              {notice && (
                <p role="status" className="text-sm text-muted">
                  {notice}
                </p>
              )}

              {out?.error && (
                <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3">
                  <p className="min-w-0 flex-1 font-mono text-[13px]">{out.error}</p>
                  {errorLine && (
                    <Button variant="ghost" size="sm" onClick={() => editor.current?.focusLine(errorLine)}>
                      Go to line {errorLine}
                    </Button>
                  )}
                </div>
              )}

              {out?.result && (
                <ResultsPanel
                  key={active.id}
                  output={out}
                  result={out.result}
                  pane={pane}
                  setPane={setPane}
                  plan={explain}
                  name={active.title}
                  datasetId={schema.data?.[0]?.dataset_id}
                  stale={!!out.error}
                />
              )}

              {!out && !pending && (
                <div className="flex flex-col items-center gap-2 rounded-[16px] border border-dashed border-line px-6 py-10 text-center">
                  <Sparkles className="size-5 text-highlight" aria-hidden />
                  <p className="text-sm text-muted">Run the query to see results. Select part of it to run just that part.</p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </PageContainer>
  );
}

/* ---------- parameters ---------- */

function ParamField({ param, onChange, onEnter }: { param: Param; onChange: (p: Partial<Param>) => void; onEnter: () => void }) {
  const id = `param-${param.name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-[12px] text-accent">
        {`{{${param.name}}}`}
      </label>
      <div className="flex">
        <select
          aria-label={`Type of ${param.name}`}
          value={param.type}
          onChange={(e) => onChange({ type: e.target.value as ParamType })}
          className="h-8 rounded-l-md border border-r-0 border-input bg-transparent px-1.5 text-xs text-muted"
        >
          <option value="text" className="bg-surface">text</option>
          <option value="number" className="bg-surface">number</option>
          <option value="date" className="bg-surface">date</option>
        </select>
        <Input
          id={id}
          type={param.type === "date" ? "date" : "text"}
          inputMode={param.type === "number" ? "decimal" : undefined}
          value={param.value}
          placeholder={param.type === "number" ? "0" : param.type === "date" ? "" : "value"}
          onChange={(e) => onChange({ value: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onEnter())}
          className="h-8 w-40 rounded-l-none"
        />
      </div>
    </div>
  );
}

/* ---------- sidebar ---------- */

function Sidebar(props: {
  side: Side;
  setSide: (s: Side) => void;
  schema: { isPending: boolean; data?: Table[] };
  saved?: Saved[];
  history: ReturnType<typeof useLabState>["history"];
  activeSavedId: string | null;
  onInsert: (s: string) => void;
  onOpenSaved: (q: Saved) => void;
  onDeleteSaved: (id: string) => void;
  onOpenHistory: (h: { sql: string; params: Param[] }) => void;
  onClearHistory: () => void;
  onNewFromTable: (t: Table) => void;
}) {
  const { side, setSide } = props;
  const [filter, setFilter] = useState("");
  const tabs: { id: Side; label: string; icon: typeof Database }[] = [
    { id: "tables", label: "Tables", icon: Database },
    { id: "saved", label: "Saved", icon: FileCode2 },
    { id: "history", label: "History", icon: Clock },
  ];
  const f = filter.trim().toLowerCase();

  return (
    <aside className="flex min-w-0 flex-col gap-3" aria-label="Tables, saved queries and history">
      <div className="grid grid-cols-3 gap-1 rounded-[12px] border border-line bg-surface p-1" role="tablist">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={side === id}
            onClick={() => setSide(id)}
            className={cn(
              "flex min-h-8 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium transition-colors",
              side === id ? "bg-line text-text" : "text-muted hover:text-text",
            )}
          >
            <Icon className="size-3.5" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {side !== "history" && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <Input
            aria-label={side === "tables" ? "Filter tables and columns" : "Filter saved queries"}
            placeholder={side === "tables" ? "Filter tables and columns" : "Filter saved queries"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 pl-8"
          />
        </div>
      )}

      {side === "tables" &&
        (props.schema.isPending ? (
          <div className="h-40 animate-pulse rounded-xl bg-surface" />
        ) : !props.schema.data?.length ? (
          <p className="text-sm text-faint">No datasets yet. Add one on the Data page.</p>
        ) : (
          <ul className="flex max-h-[62vh] flex-col gap-1 overflow-y-auto rounded-xl border border-line p-2">
            {props.schema.data
              .map((t) => ({ t, cols: f ? t.columns.filter((c) => c.name.toLowerCase().includes(f)) : t.columns }))
              .filter(({ t, cols }) => !f || t.table.includes(f) || t.dataset_name.toLowerCase().includes(f) || cols.length)
              .map(({ t, cols }) => (
                <li key={t.table}>
                  <details className="group" open={!!f}>
                    <summary className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                      <Database className="size-3.5 shrink-0 text-highlight" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{t.table}</span>
                      <button type="button" className="text-[11px] text-highlight hover:underline" onClick={(e) => (e.preventDefault(), props.onInsert(t.table))}>
                        insert
                      </button>
                      <button type="button" className="text-[11px] text-muted hover:text-text hover:underline" onClick={(e) => (e.preventDefault(), props.onNewFromTable(t))}>
                        open
                      </button>
                    </summary>
                    <p className="px-2 pb-1 text-[11px] text-faint">
                      {t.dataset_name} · {t.row_count.toLocaleString()} rows
                    </p>
                    <ul className="flex flex-col pb-1 pl-6">
                      {(f && !t.table.includes(f) ? cols : t.columns).map((c) => (
                        <li key={c.name}>
                          <button
                            type="button"
                            onClick={() => props.onInsert(quoteIdent(c.name))}
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
        ))}

      {side === "saved" &&
        (!props.saved?.length ? (
          <p className="text-sm text-faint">Save a query (Ctrl/⌘+S) to reuse it, export it, or share it with your team.</p>
        ) : (
          <ul className="flex max-h-[62vh] flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {props.saved
              .filter((q) => !f || q.name.toLowerCase().includes(f) || q.sql.toLowerCase().includes(f))
              .map((q) => (
                <li key={q.id} className={cn("flex items-center gap-1 px-2 py-1.5", props.activeSavedId === q.id && "bg-line/40")}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => props.onOpenSaved(q)}>
                    <span className="block truncate text-sm hover:text-highlight">{q.name}</span>
                    <span className="block truncate font-mono text-[11px] text-faint">{q.sql.replace(/\s+/g, " ")}</span>
                  </button>
                  {q.params.length > 0 && <span className="rounded bg-accent/15 px-1.5 text-[10px] text-accent">{q.params.length} param</span>}
                  <Button variant="ghost" size="icon-xs" aria-label={`Delete ${q.name}`} onClick={() => props.onDeleteSaved(q.id)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
          </ul>
        ))}

      {side === "history" &&
        (!props.history.length ? (
          <p className="text-sm text-faint">Queries you run show up here, in this browser.</p>
        ) : (
          <>
            <ul className="flex max-h-[62vh] flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {props.history.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => props.onOpenHistory(h)} className="flex w-full flex-col gap-0.5 px-2.5 py-2 text-left hover:bg-surface-2" title="Open in a new tab">
                    <span className="line-clamp-2 font-mono text-[11.5px] text-text">{h.sql.replace(/\s+/g, " ")}</span>
                    <span className={cn("text-[11px]", h.ok ? "text-faint" : "text-accent")}>
                      {ago(h.at)} · {h.ok ? `${h.rows?.toLocaleString()} rows · ${h.ms} ms` : "failed"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" className="self-start" onClick={props.onClearHistory}>
              <Trash2 /> Clear history
            </Button>
          </>
        ))}
    </aside>
  );
}

/* ---------- results ---------- */

function ResultsPanel({
  output,
  result,
  pane,
  setPane,
  plan,
  name,
  datasetId,
  stale,
}: {
  output: Output;
  result: RunResult;
  pane: Pane;
  setPane: (p: Pane) => void;
  plan: { isPending: boolean; isFetching: boolean; data?: { plan: string }; error: Error | null };
  name: string;
  datasetId?: string;
  stale: boolean;
}) {
  const numeric = result.columns.filter((c) => result.rows.some((r) => typeof r[c] === "number"));
  const canChart = result.columns.length >= 2 && numeric.length > 0;
  const panes: { id: Pane; label: string; show: boolean }[] = [
    { id: "rows", label: "Results", show: true },
    { id: "stats", label: "Column stats", show: true },
    { id: "plan", label: "Query plan", show: true },
    { id: "chart", label: "Chart", show: canChart },
  ];

  return (
    <div className={cn("flex flex-col gap-3", stale && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-[10px] border border-line bg-surface p-0.5" role="tablist" aria-label="Result views">
          {panes
            .filter((p) => p.show)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pane === p.id}
                onClick={() => setPane(p.id)}
                className={cn("flex min-h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium", pane === p.id ? "bg-line text-text" : "text-muted hover:text-text")}
              >
                {p.id === "chart" && <BarChart3 className="size-3.5" aria-hidden />}
                {p.label}
              </button>
            ))}
        </div>
        <p className="text-sm text-muted">
          {result.row_count.toLocaleString()} rows · {result.elapsed_ms} ms
          {result.truncated ? " · first 5,000 shown (export for all)" : ""}
          {stale ? " · from the last successful run" : ""}
        </p>
        <div className="ml-auto">
          <ResultActions result={result} name={name} />
        </div>
      </div>

      {(pane === "rows" || pane === "stats") && <ResultsGrid result={result} view={pane} />}
      {pane === "plan" && (
        <div className="overflow-auto rounded-[16px] border border-line bg-surface p-4">
          {plan.isFetching && !plan.data ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> Reading the plan…
            </p>
          ) : plan.error ? (
            <p className="font-mono text-[13px] text-accent">{plan.error.message}</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-faint">How DuckDB will run this query, read from the bottom up. Wide scans and big hash joins are the slow parts.</p>
              <pre className="font-mono text-[12px] leading-[1.35] text-muted">{plan.data?.plan}</pre>
            </>
          )}
        </div>
      )}
      {pane === "chart" && canChart && <ChartPane output={output} result={result} numeric={numeric} datasetId={datasetId} />}
    </div>
  );
}

function ChartPane({ output, result, numeric, datasetId }: { output: Output; result: RunResult; numeric: string[]; datasetId?: string }) {
  const [type, setType] = useState<ChartType>("bar");
  const [x, setX] = useState(result.columns[0] ?? "");
  const [y, setY] = useState(numeric.find((c) => c !== result.columns[0]) ?? numeric[0] ?? "");
  const [title, setTitle] = useState("");

  const spec: ChartSpec | null = useMemo(
    () =>
      x && y && datasetId
        ? {
            dataset: datasetId,
            sql: output.sql,
            ...(output.params.length ? { params: output.params } : {}),
            groupBy: x,
            metrics: [{ field: y, agg: "sum" }],
            chartType: type,
            title: title.trim() || `${y} by ${x}`,
            filters: [],
          }
        : null,
    [x, y, type, title, output, datasetId],
  );
  // Preview with the renderer's column names (the backend renames the same way when the chart is saved).
  const previewRows = useMemo(() => result.rows.map((r) => ({ [x]: r[x] as string | number | null, [`sum_${y}`]: r[y] as string | number | null })), [result.rows, x, y]);

  if (!spec) return null;
  return (
    <div className="flex flex-col gap-3 rounded-[16px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Chart
          <NativeSelect className="w-40" value={type} onChange={(e) => setType(e.target.value as ChartType)}>
            {VIZ_TYPES.map((t) => (
              <option key={t.value} value={t.value} className="bg-surface">
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Labels
          <NativeSelect className="w-40" value={x} onChange={(e) => setX(e.target.value)}>
            {result.columns.map((c) => (
              <option key={c} value={c} className="bg-surface">
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Values
          <NativeSelect className="w-40" value={y} onChange={(e) => setY(e.target.value)}>
            {numeric.map((c) => (
              <option key={c} value={c} className="bg-surface">
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
          Title
          <Input value={title} placeholder={`${y} by ${x}`} onChange={(e) => setTitle(e.target.value)} className="h-9" />
        </label>
        <SaveToDashboard spec={spec} />
      </div>
      <ChartBody spec={spec} rows={previewRows} height={280} />
      <p className="text-xs text-faint">
        Charts saved from SQL re-run the query each time{output.params.length ? ", with the parameter values used for this run" : ""}. Dashboard filters don&apos;t apply to them.
      </p>
    </div>
  );
}
