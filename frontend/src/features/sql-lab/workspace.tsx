"use client";

import type { SQLNamespace } from "@codemirror/lang-sql";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, CalendarClock, Code2, FileCode2, Keyboard, Loader2, PanelBottom, PanelLeft, Play, Plus, Save, Sparkles, Square, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMe } from "@/features/auth/hooks";
import { useProjects } from "@/features/platform/api";
import { ExportMenu } from "@/features/reports/export-menu";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

import { AiAssist } from "./ai-assist";
import { BuilderPanel } from "./builder/builder-panel";
import { compile } from "./builder/compile";
import { emptyBuilder, type BuilderState } from "./builder/types";
import { Explorer } from "./explorer/explorer";
import { ParamField } from "./param-field";
import { exampleSql, paramsFor, quoteIdent, sampleQueries, type JoinHint, type Param, type RunResult, type Saved, type Table } from "./params";
import { ResultsPanel, type Output, type Pane } from "./results-panel";
import { ScheduleDialog } from "./schedule-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { SqlEditor, type SqlEditorHandle } from "./sql-editor";
import { isDirty, useLabState, type Tab } from "./use-lab-state";

type MobileView = "schema" | "query" | "results";

const errorLineOf = (out?: Output) => {
  const m = out?.error?.match(/\(line (\d+)\)/);
  return m ? Number(m[1]) + ((out!.errorFirstLine ?? 1) - 1) : null;
};

/** md and up: the three-pane desktop layout. Server render assumes desktop; phones switch after mount. */
function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 768px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * SQL Lab: a read-only SQL workspace over the workspace's datasets.
 * Desktop: schema explorer | editor over results, all resizable (sizes remembered in this browser).
 * Phones: one pane at a time (Schema / Query / Results).
 */

/** The panel library defaults to localStorage, which doesn't exist while the page renders on the server. */
const panelStorage = {
  getItem(key: string) {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage blocked: the layout just isn't remembered */
    }
  },
};

export function SqlWorkspace() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const allowed = me?.role !== "viewer";
  const schema = useQuery({ queryKey: ["sql", "schema"], queryFn: () => api<Table[]>("/sql/schema"), enabled: allowed });
  const saved = useQuery({ queryKey: ["sql", "saved"], queryFn: () => api<Saved[]>("/sql/saved"), enabled: allowed });
  // Same query (and cache) as the explorer's Relationships section; the builder offers these joins.
  const joins = useQuery({
    queryKey: ["sql", "joins"],
    queryFn: () => api<JoinHint[]>("/sql/schema/joins"),
    enabled: allowed && (schema.data?.length ?? 0) > 1,
    staleTime: 60_000,
  });
  const lab = useLabState(me?.workspace.id);
  const { active, openTab, updateTab } = lab;
  const desktop = useIsDesktop();

  const editor = useRef<SqlEditorHandle>(null);
  const explorerPanel = usePanelRef();
  const resultsPanel = usePanelRef();
  const outer = useDefaultLayout({ id: "vyuham:sql-lab:outer", panelIds: ["explorer", "main"], storage: panelStorage });
  const inner = useDefaultLayout({ id: "vyuham:sql-lab:inner", panelIds: ["editor", "results"], storage: panelStorage });

  const [outputs, setOutputs] = useState<Record<string, Output>>({});
  const [pane, setPane] = useState<Pane>("rows");
  const [mobileView, setMobileView] = useState<MobileView>("query");
  const [hasSelection, setHasSelection] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [folder, setFolder] = useState("");
  const projects = useProjects();
  // The running query, so Cancel can abort the request and stop it on the server.
  const running = useRef<{ runId: string; controller: AbortController } | null>(null);

  // First visit: one tab with a query that works on the first dataset.
  useEffect(() => {
    if (lab.ready && !lab.tabs.length && !schema.isPending) openTab({ sql: exampleSql(schema.data?.[0]) });
  }, [lab.ready, lab.tabs.length, schema.isPending, schema.data, openTab]);

  // The name box follows the tab.
  useEffect(() => setName(active?.savedId ? active.title : ""), [active?.id, active?.savedId, active?.title]);
  // So do its project and folder.
  const savedRow = saved.data?.find((q) => q.id === active?.savedId);
  useEffect(() => {
    setProjectId(savedRow?.project_id ?? "");
    setFolder(savedRow?.folder ?? "");
  }, [active?.id, savedRow?.project_id, savedRow?.folder]);

  const completion: SQLNamespace = useMemo(
    () =>
      Object.fromEntries(
        (schema.data ?? []).map((t) => [t.table, t.columns.map((c) => ({ label: c.name, apply: quoteIdent(c.name), detail: c.type, type: "property" }))]),
      ),
    [schema.data],
  );

  const inBuilder = active?.mode === "builder" && !!active.builder;
  const compiled = useMemo(
    () => (inBuilder && active?.builder ? compile(active.builder, schema.data ?? []) : null),
    [inBuilder, active?.builder, schema.data],
  );

  /** Builder edits recompile into the tab's SQL and params, so Run, Save, history and export work as usual. */
  const setBuilder = useCallback(
    (tabId: string, next: BuilderState) => {
      const c = compile(next, schema.data ?? []);
      updateTab(tabId, { builder: next, sql: c.sql, params: c.params });
    },
    [schema.data, updateTab],
  );

  /** Builder mode: this tab if it's empty, otherwise a new tab (typed SQL is never thrown away). */
  const openBuilder = useCallback(() => {
    const first = schema.data?.[0]?.table;
    if (!first) return;
    const state = emptyBuilder(first);
    const c = compile(state, schema.data ?? []);
    if (active && !active.sql.trim() && !active.savedId) updateTab(active.id, { mode: "builder", builder: state, sql: c.sql, params: c.params });
    else openTab({ title: "Builder query", sql: c.sql, params: c.params, mode: "builder", builder: state });
  }, [schema.data, active, updateTab, openTab]);

  const out = active ? outputs[active.id] : undefined;
  const setOut = (id: string, o: Output) => setOutputs((all) => ({ ...all, [id]: o }));

  const run = useMutation({
    mutationFn: (v: { tabId: string; sql: string; params: Param[]; firstLine: number }) => {
      const runId = Math.random().toString(36).slice(2, 12);
      const controller = new AbortController();
      running.current = { runId, controller };
      const savedId = lab.tabs.find((t) => t.id === v.tabId)?.savedId ?? undefined;
      return api<RunResult>("/sql/run", {
        method: "POST", body: JSON.stringify({ sql: v.sql, params: v.params, run_id: runId, saved_id: savedId }), signal: controller.signal,
      }).finally(() => {
        if (running.current?.runId === runId) running.current = null;
      });
    },
    onMutate: () => setNotice(null),
    onSuccess: (result, v) => {
      setOut(v.tabId, { sql: v.sql, params: v.params, result });
      lab.addHistory({ sql: v.sql, params: v.params, ok: true, rows: result.row_count, ms: result.elapsed_ms });
      setPane((p) => (p === "plan" ? "rows" : p));
      if (resultsPanel.current?.isCollapsed()) resultsPanel.current.expand();
      if (!desktop) setMobileView("results");
    },
    onError: (e, v) => {
      if (e.name === "AbortError" || e.message === "Query cancelled.") {
        setNotice("Query cancelled.");
        return;
      }
      // Keep the last good result (and the SQL it came from) on screen, marked as stale.
      setOutputs((all) => {
        const prev = all[v.tabId];
        return { ...all, [v.tabId]: { ...(prev?.result ? prev : { sql: v.sql, params: v.params }), error: e.message, errorFirstLine: v.firstLine } };
      });
      lab.addHistory({ sql: v.sql, params: v.params, ok: false, error: e.message });
    },
  });

  const doRun = useCallback(() => {
    if (!active) return;
    if (active.mode === "builder") {
      if (compiled?.problems.length) return setNotice(compiled.problems[0]);
      run.mutate({ tabId: active.id, sql: active.sql, params: active.params, firstLine: 1 });
      return;
    }
    if (!editor.current) return;
    const r = editor.current.runnable();
    if (!r.sql.trim()) return;
    run.mutate({ tabId: active.id, sql: r.sql, params: paramsFor(r.sql, active.params), firstLine: r.firstLine });
  }, [active, run, compiled]);

  const cancel = useCallback(() => {
    const r = running.current;
    if (!r) return;
    running.current = null;
    // Stop it on the server first (frees the slot), then drop the request.
    void api(`/sql/cancel/${r.runId}`, { method: "POST" }).catch(() => undefined);
    r.controller.abort();
  }, []);

  /** New tab with this SQL; with `andRun`, run it straight away (no editor needed). */
  const openSql = useCallback(
    (title: string, sql: string, andRun = false) => {
      const id = openTab({ title, sql });
      if (andRun) run.mutate({ tabId: id, sql, params: paramsFor(sql, []), firstLine: 1 });
      if (!desktop) setMobileView(andRun ? "results" : "query");
    },
    [openTab, run, desktop],
  );

  const explain = useQuery({
    queryKey: ["sql", "explain", out?.sql, out?.params],
    queryFn: () => api<{ plan: string }>("/sql/explain", { method: "POST", body: JSON.stringify({ sql: out!.sql, params: out!.params }) }),
    enabled: pane === "plan" && !!out?.sql,
    retry: false,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: (tab: Tab) => {
      const body = JSON.stringify({
        name: name.trim() || (tab.savedId ? tab.title : "Untitled query"),
        sql: tab.sql,
        params: paramsFor(tab.sql, tab.params),
        builder_state: tab.mode === "builder" ? tab.builder ?? null : null,
        project_id: projectId || null,
        folder: folder.trim() || null,
      });
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
    if (existing) lab.setActive(existing.id);
    else
      openTab({
        title: q.name, sql: q.sql, params: q.params, savedId: q.id, savedSql: q.sql, savedParams: q.params,
        ...(q.builder_state ? { mode: "builder" as const, builder: q.builder_state } : {}),
      });
    if (!desktop) setMobileView("query");
  };

  const format = () => {
    try {
      editor.current?.format();
      setNotice(null);
    } catch {
      setNotice("Couldn't format this query. Check it for syntax errors first.");
    }
  };

  const togglePanel = useCallback((ref: typeof explorerPanel) => {
    const p = ref.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  }, []);

  // Workspace shortcuts (the editor handles Run, Save and Format itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // The editor runs its own Ctrl/⌘+Enter; this covers focus anywhere else (e.g. after "Use this join").
      if (mod && e.key === "Enter" && !(e.target instanceof HTMLElement && e.target.closest(".cm-editor"))) {
        e.preventDefault();
        doRun();
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        togglePanel(explorerPanel);
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        togglePanel(resultsPanel);
      } else if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setAiOpen((v) => !v);
      } else if (e.key === "Escape" && running.current) {
        e.preventDefault();
        cancel();
      } else if (e.key === "?" && !mod && !isTyping(e.target)) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel, explorerPanel, resultsPanel, doRun, cancel]);

  const params = active ? paramsFor(active.sql, active.params) : [];
  const setParam = (pname: string, patch: Partial<Param>) =>
    active && updateTab(active.id, { params: params.map((p) => (p.name === pname ? { ...p, ...patch } : p)) });

  if (me && !allowed)
    return <p className="mx-auto max-w-[720px] pt-16 text-muted">SQL Lab is for owners and editors. Ask an owner for editor access if you need it.</p>;

  const pending = run.isPending && run.variables?.tabId === active?.id;
  const savedSchedule = saved.data?.find((q) => q.id === active?.savedId)?.schedule ?? null;
  const errorLine = errorLineOf(out);
  const dirty = active ? isDirty(active) : false;

  const explorer = (
    <Explorer
      schema={schema}
      saved={saved.data}
      history={lab.history}
      activeSavedId={active?.savedId ?? null}
      onInsert={(s) => {
        editor.current?.insert(s);
        if (!desktop) setMobileView("query");
      }}
      onOpenSql={openSql}
      onOpenSaved={openSaved}
      onDeleteSaved={(id) => remove.mutate(id)}
      onOpenHistory={(h) => {
        openTab({ sql: h.sql, params: h.params });
        if (!desktop) setMobileView("query");
      }}
      onClearHistory={lab.clearHistory}
    />
  );

  const tabs = (
    <div className="flex items-end gap-0.5 overflow-x-auto border-b border-line px-2 pt-1.5" role="tablist" aria-label="Open queries">
      {lab.tabs.map((t) => {
        const on = t.id === active?.id;
        return (
          <div
            key={t.id}
            className={cn(
              "group flex shrink-0 items-center gap-1 rounded-t-[8px] border border-b-0 pl-2.5 pr-1 text-[13px]",
              on ? "border-line bg-bg/70 text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            <button type="button" role="tab" aria-selected={on} onClick={() => lab.setActive(t.id)} className="flex max-w-[180px] items-center gap-1.5 py-1.5">
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
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <Button variant="ghost" size="icon-xs" className="mb-1 ml-1" aria-label="New query tab" onClick={() => openTab({ sql: "" })}>
        <Plus />
      </Button>
      <div className="mb-1 ml-auto flex shrink-0 gap-0.5 rounded-[8px] border border-line p-0.5" role="radiogroup" aria-label="Query mode">
        <button
          type="button"
          role="radio"
          aria-checked={!inBuilder}
          onClick={() => active && inBuilder && updateTab(active.id, { mode: "sql", builder: undefined })}
          title={inBuilder ? "Edit this query as SQL (the builder stops following it)" : "SQL mode"}
          className={cn("flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[12px]", !inBuilder ? "bg-surface-2 text-text" : "text-muted hover:text-text")}
        >
          <Code2 className="size-3.5" aria-hidden /> SQL
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={inBuilder}
          onClick={() => !inBuilder && openBuilder()}
          disabled={!schema.data?.length}
          title="Build a query by picking columns, filters and totals"
          className={cn("flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[12px] disabled:opacity-50", inBuilder ? "bg-surface-2 text-text" : "text-muted hover:text-text")}
        >
          <Blocks className="size-3.5" aria-hidden /> Builder
        </button>
      </div>
    </div>
  );

  const toolbar = active && (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-2.5 py-2">
      {pending ? (
        <Button size="sm" variant="destructive" onClick={cancel} title="Cancel the running query (Esc)">
          <Square /> Cancel
        </Button>
      ) : (
        <Button size="sm" onClick={doRun} disabled={!active.sql.trim()} title="Run (Ctrl/⌘+Enter)">
          <Play /> {hasSelection ? "Run selection" : "Run"}
        </Button>
      )}
      <Button variant={aiOpen ? "secondary" : "ghost"} size="sm" onClick={() => setAiOpen((v) => !v)} aria-pressed={aiOpen} title="AI assistant (Ctrl/⌘+I)">
        <Sparkles /> AI
      </Button>
      {!inBuilder && (
        <Button variant="ghost" size="sm" onClick={format} disabled={!active.sql.trim()} title="Format (Shift+Alt+F)">
          <Wand2 /> Format
        </Button>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <Input
          aria-label="Query name"
          placeholder={active.savedId ? active.title : "Query name"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-36 text-[13px] sm:w-44"
        />
        <NativeSelect aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-8 max-w-[140px] text-[13px]" title="Save to a project">
          <option value="">No project</option>
          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
        <Input aria-label="Folder" placeholder="Folder" value={folder} onChange={(e) => setFolder(e.target.value)} className="h-8 w-24 text-[13px] sm:w-28" title="Folder inside the project, e.g. Monthly/Revenue" />
        <Button variant="outline" size="sm" onClick={doSave} disabled={save.isPending || !active.sql.trim()} title="Save (Ctrl/⌘+S)">
          <Save /> {active.savedId ? "Update" : "Save"}
        </Button>
        {/* Exports and schedules run the saved query, so save edits first. */}
        {active.savedId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScheduleOpen(true)}
            disabled={dirty}
            title={dirty ? "Save your changes first" : savedSchedule ?? "Run this query on a schedule and send the result"}
          >
            <CalendarClock className={savedSchedule ? "text-highlight" : undefined} /> <span className="max-sm:sr-only">{savedSchedule ? "Scheduled" : "Schedule"}</span>
          </Button>
        )}
        {active.savedId && <ExportMenu source="saved_query" sourceId={active.savedId} disabled={dirty} />}
      </div>
    </div>
  );

  const queryArea = (
    <div className="flex h-full min-h-0 flex-col" data-tour="sql-editor">
      {tabs}
      {active ? (
        <>
          {inBuilder && active.builder && compiled ? (
            <div className="min-h-0 flex-1 bg-bg/40">
              <BuilderPanel
                state={active.builder}
                tables={schema.data ?? []}
                joins={joins.data ?? []}
                compiled={compiled}
                onChange={(next) => setBuilder(active.id, next)}
                onOpenInSql={() => updateTab(active.id, { mode: "sql", builder: undefined })}
              />
            </div>
          ) : (
          <div className="min-h-0 flex-1 bg-bg/40">
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
          )}
          {!inBuilder && params.length > 0 && (
            <div className="flex flex-wrap items-end gap-3 border-t border-line bg-surface-2/40 px-3 py-2.5" aria-label="Query parameters">
              {params.map((p) => (
                <ParamField key={p.name} param={p} onChange={(patch) => setParam(p.name, patch)} onEnter={doRun} />
              ))}
            </div>
          )}
          {toolbar}
          {aiOpen && (
            <AiAssist
              sql={active.sql}
              params={params}
              error={out?.error}
              onReplace={(s) => updateTab(active.id, { sql: s, ...(inBuilder ? { mode: "sql" as const, builder: undefined } : {}) })}
              onNewTab={(s) => openTab({ title: "AI query", sql: s })}
              onClose={() => setAiOpen(false)}
            />
          )}
          {notice && (
            <p role="status" className="border-t border-line px-3 py-1.5 text-[13px] text-muted">
              {notice}
            </p>
          )}
          {out?.error && (
            <div role="alert" className="flex flex-wrap items-start gap-3 border-t border-accent/40 bg-accent/10 px-3 py-2.5">
              <p className="min-w-0 flex-1 font-mono text-[12.5px]">{out.error}</p>
              {errorLine && (
                <Button variant="ghost" size="xs" onClick={() => editor.current?.focusLine(errorLine)}>
                  Go to line {errorLine}
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <Button variant="outline" onClick={() => openTab({ sql: "" })}>
            <Plus /> New query
          </Button>
        </div>
      )}
    </div>
  );

  const samples = sampleQueries(schema.data ?? []);
  const resultsArea = (
    <div className="flex h-full min-h-0 flex-col p-3">
      {out?.result ? (
        <ResultsPanel
          key={active?.id}
          output={out}
          result={out.result}
          pane={pane}
          setPane={setPane}
          plan={explain}
          name={active?.title ?? "query"}
          datasetId={schema.data?.[0]?.dataset_id}
          stale={!!out.error}
        />
      ) : pending ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin text-highlight" /> Running…
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 text-center" data-lenis-prevent>
          <Sparkles className="size-5 text-highlight" aria-hidden />
          <div>
            <p className="text-sm text-text">Run a query to see results here.</p>
            <p className="text-xs text-faint">Select part of the SQL to run just that part.</p>
          </div>
          {samples.length > 0 && (
            <div className="flex w-full max-w-md flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Or start from</p>
              {samples.map((s) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => openSql(s.title, s.sql, true)}
                  className="flex items-center gap-2 rounded-lg border border-line bg-bg/50 px-3 py-2 text-left text-[13px] text-muted transition-colors hover:border-primary/40 hover:text-text"
                >
                  <Play className="size-3.5 shrink-0 text-highlight" aria-hidden />
                  <span className="truncate">{s.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {out?.result && (
        <p className="mt-2 shrink-0 border-t border-line pt-2 text-[12px] text-faint" aria-live="polite">
          {out.result.row_count.toLocaleString()} rows · {out.result.elapsed_ms} ms
          {out.result.truncated ? " · first 5,000 shown (export for all)" : ""}
          {out.error ? " · showing the last successful run" : ""}
        </p>
      )}
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h1 className="type-page-title text-text">SQL Workbench</h1>
        <p className="text-[13px] text-muted">
          Read-only SQL (DuckDB) over this workspace&apos;s data, with a 10-second limit per query. Write <code className="text-accent">{"{{name}}"}</code> to add a parameter.
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        {desktop && (
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Show or hide the schema panel (Ctrl/⌘+B)" title="Schema panel (Ctrl/⌘+B)" onClick={() => togglePanel(explorerPanel)}>
              <PanelLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Show or hide the results panel (Ctrl/⌘+J)" title="Results panel (Ctrl/⌘+J)" onClick={() => togglePanel(resultsPanel)}>
              <PanelBottom />
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}>
          <Keyboard />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] min-h-[560px] w-full max-w-[1600px] flex-col gap-3">
      {header}

      {desktop ? (
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={outer.defaultLayout}
          onLayoutChanged={outer.onLayoutChanged}
          className="min-h-0 flex-1 overflow-hidden rounded-[16px] border border-line bg-surface"
        >
          <ResizablePanel id="explorer" panelRef={explorerPanel} defaultSize="22" minSize={200} maxSize="45" collapsible collapsedSize={0}>
            {explorer}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="main" minSize="40">
            <ResizablePanelGroup orientation="vertical" defaultLayout={inner.defaultLayout} onLayoutChanged={inner.onLayoutChanged}>
              <ResizablePanel id="editor" defaultSize="50" minSize={150}>
                {queryArea}
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="results" panelRef={resultsPanel} defaultSize="50" minSize={120} collapsible collapsedSize={0}>
                {resultsArea}
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1 rounded-[12px] border border-line bg-surface p-1" role="tablist" aria-label="SQL Lab panels">
            {(["schema", "query", "results"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={mobileView === v}
                onClick={() => setMobileView(v)}
                className={cn(
                  "flex min-h-10 items-center justify-center rounded-[8px] text-[13px] font-medium capitalize",
                  mobileView === v ? "bg-surface-2 text-text" : "text-muted",
                )}
              >
                {v}
                {v === "results" && out?.result ? <span className="ml-1 text-[11px] text-faint">{out.result.row_count.toLocaleString()}</span> : null}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-[16px] border border-line bg-surface">
            {mobileView === "schema" ? explorer : mobileView === "query" ? queryArea : resultsArea}
          </div>
        </>
      )}

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {active?.savedId && <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} savedId={active.savedId} name={active.title} />}
    </div>
  );
}
