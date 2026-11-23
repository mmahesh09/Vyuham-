"use client";

import { AlertTriangle, CheckCircle2, Eye, Lightbulb, Loader2, Play, RotateCcw, Save, ShieldCheck, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import WorkflowBlueprint, { type WorkflowApp, type WorkflowGraph, type WorkflowKind } from "@/components/ui/interactive-workflow-blueprint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useDatasets, type Dataset } from "@/features/datasets/api";
import {
  checkGraph, errorText, formatMs, previewStep, useAiStatus, useOptimize, usePipeline, usePipelineAction, usePipelineRuns, useSavePipeline,
  type Check, type Debug, type PGraph, type PNode, type Pipeline, type PipelineRun, type Preview, type StepConfig, type StepType,
} from "@/features/platform/api";
import { Chip, ErrorLine, RowsTable, SectionTitle, ago } from "@/features/platform/ui";
import { cn } from "@/lib/utils";

const TYPE_FOR_KIND: Record<WorkflowKind, StepType> = { trigger: "schedule", integration: "source", agent: "sql", review: "validate", delivery: "destination" };
const KIND_FOR_TYPE: Record<StepType, WorkflowKind> = { schedule: "trigger", source: "integration", sql: "agent", dedupe: "agent", validate: "review", destination: "delivery" };
const TYPE_LABEL: Record<StepType, string> = {
  schedule: "Start (schedule)", source: "Read a dataset", sql: "SQL transform", dedupe: "Remove duplicates", validate: "Quality checks", destination: "Write a table",
};
const slug = (s: string) => {
  const v = (s.toLowerCase().match(/[a-z0-9]+/g) ?? ["step"]).join("_").slice(0, 40);
  return /^\d/.test(v) ? `s_${v}` : v;
};
const tableName = (name: string) => {
  const base = (name.toLowerCase().match(/[a-z0-9]+/g) ?? ["data"]).join("_").slice(0, 40) || "data";
  return /^\d/.test(base) ? `t_${base}` : base;
};

function paletteApps(datasets: Dataset[]): WorkflowApp[] {
  return [
    {
      id: "sources", name: "Read datasets",
      actions: datasets.slice(0, 30).map((d) => ({
        label: `Read ${d.name}`.slice(0, 60), detail: `${d.row_count.toLocaleString()} rows${d.layer ? ` · ${d.layer}` : ""}`, kind: "integration" as const,
        tool: d.layer ? d.layer[0].toUpperCase() + d.layer.slice(1) : "Source",
        config: { type: "source", dataset_id: d.id, name: `raw_${tableName(d.name)}`.slice(0, 40) } satisfies StepConfig,
      })),
    },
    {
      id: "transform", name: "Transform",
      actions: [
        { label: "SQL transform", detail: "A SELECT over earlier steps or datasets.", kind: "agent", tool: "SQL", config: { type: "sql", sql: "" } satisfies StepConfig },
        { label: "Remove duplicates", detail: "Keep one row per key.", kind: "agent", tool: "Dedupe", config: { type: "dedupe", keys: [] } satisfies StepConfig },
      ],
    },
    {
      id: "quality", name: "Data quality",
      actions: [{ label: "Quality checks", detail: "Not null, unique, references…", kind: "review", tool: "Checks", config: { type: "validate", checks: [], on_fail: "fail" } satisfies StepConfig }],
    },
    {
      id: "load", name: "Load",
      actions: [
        { label: "Write Gold table", detail: "Business-ready output.", kind: "delivery", tool: "Gold", config: { type: "destination", layer: "gold", mode: "replace", target_name: "" } satisfies StepConfig },
        { label: "Write Silver table", detail: "Cleaned, validated rows.", kind: "delivery", tool: "Silver", config: { type: "destination", layer: "silver", mode: "replace", target_name: "" } satisfies StepConfig },
      ],
    },
    { id: "start", name: "Start", actions: [{ label: "Schedule", detail: "Where the run starts.", kind: "trigger", tool: "Trigger", config: { type: "schedule" } satisfies StepConfig }] },
  ];
}

function toCanvas(g: PGraph): WorkflowGraph {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, type: "blueprint", position: n.position ?? { x: 0, y: 0 }, data: { ...n.data, kind: n.data.kind ?? KIND_FOR_TYPE[n.data.config?.type ?? "sql"] } })),
    edges: g.edges.map((e) => ({ id: e.id ?? `${e.source}-${e.target}`, source: e.source, target: e.target, type: "blueprint" })),
  } as WorkflowGraph;
}

type Props = {
  pipelineId?: string;
  /** An AI draft that hasn't been saved yet. */
  draft?: { name: string; graph: PGraph; schedule: Pipeline["schedule"]; hour: number; actionId?: string | null };
};

export function PipelineEditor({ pipelineId, draft }: Props) {
  const router = useRouter();
  const pipeline = usePipeline(pipelineId ?? "");
  const p = pipelineId ? pipeline.data : undefined;
  const datasets = useDatasets();
  const source: PGraph | undefined = p?.graph ?? draft?.graph;
  const [canvasKey, setCanvasKey] = useState(0);
  const [canvas, setCanvas] = useState<WorkflowGraph | null>(null);
  const [configs, setConfigs] = useState<Record<string, StepConfig>>({});
  const [selected, setSelected] = useState("");
  const [name, setName] = useState(draft?.name ?? "");
  const [schedule, setSchedule] = useState<Pipeline["schedule"]>(draft?.schedule ?? "manual");
  const [hour, setHour] = useState(draft?.hour ?? 6);
  const [aiActionId, setAiActionId] = useState<string | null>(draft?.actionId ?? null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [check, setCheck] = useState<{ problems: string[]; steps: Record<string, string> } | null>(null);
  const [preview, setPreview] = useState<{ node: string; data?: Preview; error?: string; loading: boolean } | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const save = useSavePipeline(pipelineId);
  const actions = usePipelineAction(pipelineId ?? "");

  // Load the saved (or drafted) pipeline once, and again whenever it's replaced wholesale.
  const loadKey = p ? `${p.id}:${canvasKey}` : draft ? `draft:${canvasKey}` : null;
  useEffect(() => {
    if (!source || loadKey === loadedFor) return;
    setLoadedFor(loadKey);
    setCanvas(toCanvas(source));
    setConfigs(Object.fromEntries(source.nodes.map((n) => [n.id, n.data.config ?? {}])));
    if (p) {
      setName(p.name);
      setSchedule(p.schedule);
      setHour(p.hour);
    }
  }, [source, loadKey, loadedFor, p]);

  /** The document as it will be saved: canvas layout and labels, plus each step's config. */
  const merged: PGraph | null = useMemo(() => {
    if (!canvas) return null;
    return {
      nodes: canvas.nodes.map((n) => {
        const data = n.data as PNode["data"];
        const base = configs[n.id] ?? data.config ?? {};
        const type = base.type ?? TYPE_FOR_KIND[data.kind] ?? "sql";
        const config: StepConfig = { ...base, type };
        if (!["schedule", "destination"].includes(type) && !config.name) config.name = slug(data.label);
        return { id: n.id, type: "blueprint", position: n.position, data: { label: data.label, detail: data.detail, kind: data.kind, tool: data.tool, explanation: data.explanation, config } };
      }),
      edges: canvas.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: "blueprint" })),
    };
  }, [canvas, configs]);

  const sel = merged?.nodes.find((n) => n.id === selected);
  const setCfg = (patch: Partial<StepConfig>) => sel && setConfigs((c) => ({ ...c, [sel.id]: { ...sel.data.config, ...patch } }));
  const upstreamNames = sel && merged ? merged.edges.filter((e) => e.target === sel.id).map((e) => merged.nodes.find((n) => n.id === e.source)?.data.config?.name).filter(Boolean) : [];

  const body = () => ({ name: name.trim() || "Untitled pipeline", graph: merged!, schedule, hour, enabled: true, ai_action_id: aiActionId });
  const doSave = () =>
    merged &&
    save.mutate(body(), {
      onSuccess: (saved) => {
        setAiActionId(null);
        if (!pipelineId) router.push(`/pipelines/${saved.id}`);
      },
    });
  const doCheck = async () => merged && setCheck(await checkGraph(merged).catch((e) => ({ problems: [errorText(e)], steps: {} })));
  const doPreview = async (nodeId: string) => {
    if (!merged) return;
    setPreview({ node: nodeId, loading: true });
    try {
      setPreview({ node: nodeId, data: await previewStep(merged, nodeId), loading: false });
    } catch (e) {
      setPreview({ node: nodeId, error: errorText(e), loading: false });
    }
  };
  const applyGraph = (g: PGraph, actionId: string) => {
    // Replace the whole document (an AI fix): remount the canvas with it.
    setCanvas(toCanvas(g));
    setConfigs(Object.fromEntries(g.nodes.map((n) => [n.id, n.data.config ?? {}])));
    setAiActionId(actionId);
    // Mark the next canvas key as loaded, so the load effect doesn't put the saved graph back.
    setLoadedFor(p ? `${p.id}:${canvasKey + 1}` : `draft:${canvasKey + 1}`);
    setCanvasKey((k) => k + 1);
  };
  const dirtyProblems = p?.problems ?? [];

  if (pipelineId && pipeline.isPending) return <p className="text-sm text-faint">Loading pipeline…</p>;
  if (pipelineId && pipeline.error) return <ErrorLine error={pipeline.error} />;
  if (!canvas || !merged) return <p className="text-sm text-faint">Preparing the canvas…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[12px] text-faint">
          Pipeline name
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily revenue by region" maxLength={200} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Runs
          <NativeSelect value={schedule} onChange={(e) => setSchedule(e.target.value as Pipeline["schedule"])}>
            <option value="manual">When I start it</option>
            <option value="hourly">Every hour</option>
            <option value="daily">Every day</option>
          </NativeSelect>
        </label>
        {schedule === "daily" && (
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            At (UTC)
            <NativeSelect value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </NativeSelect>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={doCheck}><CheckCircle2 /> Check</Button>
          <Button size="sm" onClick={doSave} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {pipelineId ? "Save" : "Save draft"}</Button>
        </div>
      </div>
      <ErrorLine error={save.error} />
      {aiActionId && (
        <p className="flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-[13px] text-muted">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-highlight" />
          These steps were written by the AI. Saving keeps them as a draft that someone must approve before it can run.
        </p>
      )}
      {p?.needs_approval && <ApprovalBar pipeline={p} onApprove={() => actions.approve.mutate()} pending={actions.approve.isPending} error={actions.approve.error} />}

      {(check || dirtyProblems.length > 0) && <Problems check={check} saved={dirtyProblems} nodes={merged.nodes} />}

      <WorkflowBlueprint
        key={canvasKey}
        title={name || "Pipeline"}
        initialGraph={canvas}
        apps={paletteApps(datasets.data ?? [])}
        onChange={(g) => setCanvas(g)}
        onSelectionChange={setSelected}
        agentTemplate={{ label: "SQL transform", detail: "A SELECT over earlier steps.", kind: "agent", tool: "SQL", config: { type: "sql", sql: "" } }}
      />

      {sel ? (
        <Inspector
          node={sel}
          datasets={datasets.data ?? []}
          upstream={upstreamNames as string[]}
          problem={check?.steps[sel.id]}
          onChange={setCfg}
          onPreview={() => doPreview(sel.id)}
          preview={preview?.node === sel.id ? preview : null}
        />
      ) : (
        <p className="text-[13px] text-faint">Select a step on the canvas to configure it.</p>
      )}

      {pipelineId && p && (
        <RunsPanel
          pipeline={p}
          confirmOverwrite={confirmOverwrite}
          setConfirmOverwrite={setConfirmOverwrite}
          onApplyFix={applyGraph}
          nodes={merged.nodes}
        />
      )}
      {pipelineId && p && <OptimizePanel id={p.id} />}
      {pipelineId && p && (
        <div>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => {
            if (confirm(`Delete “${p.name}” and its run history? Tables it wrote are kept.`)) actions.remove.mutate(undefined, { onSuccess: () => router.push("/pipelines") });
          }}>
            <Trash2 /> Delete pipeline
          </Button>
        </div>
      )}
    </div>
  );
}

function ApprovalBar({ pipeline, onApprove, pending, error }: { pipeline: Pipeline; onApprove: () => void; pending: boolean; error: unknown }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/5 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-text"><ShieldCheck className="size-4 text-yellow-600" /> Waiting for approval</p>
      <p className="text-[13px] text-muted">
        The AI generated or changed these steps. Review each step (use Preview to see its rows), then approve. Until then “{pipeline.name}” can’t run, manually or on its schedule.
      </p>
      <div><Button size="sm" onClick={onApprove} disabled={pending || pipeline.problems.length > 0}>{pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Approve steps</Button></div>
      {pipeline.problems.length > 0 && <p className="text-[12px] text-faint">Fix the problems listed above first.</p>}
      <ErrorLine error={error} />
    </div>
  );
}

function Problems({ check, saved, nodes }: { check: { problems: string[]; steps: Record<string, string> } | null; saved: string[]; nodes: PNode[] }) {
  const problems = check ? check.problems : saved;
  const steps = check ? Object.entries(check.steps) : [];
  if (check && !problems.length && !steps.length)
    return <p className="flex items-center gap-2 text-[13px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" /> Every step checks out against the real tables.</p>;
  if (!problems.length && !steps.length) return null;
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-text"><AlertTriangle className="size-4 text-destructive" /> {check ? "Check found problems" : "This pipeline can't run yet"}</p>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
        {problems.map((x) => <li key={x}>{x}</li>)}
        {steps.map(([id, msg]) => <li key={id}><b className="text-text">{nodes.find((n) => n.id === id)?.data.label ?? id}:</b> {msg}</li>)}
      </ul>
    </div>
  );
}

function Inspector({ node, datasets, upstream, problem, onChange, onPreview, preview }: {
  node: PNode; datasets: Dataset[]; upstream: string[]; problem?: string; onChange: (p: Partial<StepConfig>) => void; onPreview: () => void;
  preview: { data?: Preview; error?: string; loading: boolean } | null;
}) {
  const c = node.data.config ?? {};
  const type = c.type ?? "sql";
  const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5" aria-label={`Configure ${node.data.label}`}>
      <SectionTitle action={type !== "schedule" && <Button variant="outline" size="sm" onClick={onPreview} disabled={preview?.loading}>{preview?.loading ? <Loader2 className="animate-spin" /> : <Eye />} Preview rows</Button>}>
        {node.data.label}
      </SectionTitle>
      {node.data.explanation && <p className="flex gap-2 text-[13px] text-muted"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-highlight" />{node.data.explanation}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Step type
          <NativeSelect value={type} onChange={(e) => onChange({ type: e.target.value as StepType })}>
            {(Object.keys(TYPE_LABEL) as StepType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </NativeSelect>
        </label>
        {type !== "schedule" && type !== "destination" && (
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            Name used in SQL
            <Input value={c.name ?? ""} onChange={(e) => onChange({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) })} className="font-mono" />
          </label>
        )}
      </div>
      {upstream.length > 0 && type !== "source" && <p className="text-[12px] text-faint">Reads: {upstream.map((u) => <code key={u} className="mr-1 rounded bg-surface-2 px-1 text-text">{u}</code>)}</p>}

      {type === "schedule" && <p className="text-[13px] text-muted">The run starts here. Set how often it runs at the top of the page.</p>}
      {type === "source" && (
        <label className="flex flex-col gap-1 text-[12px] text-faint">
          Dataset
          <NativeSelect value={c.dataset_id ?? ""} onChange={(e) => onChange({ dataset_id: e.target.value })}>
            <option value="">Choose a dataset</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.row_count.toLocaleString()} rows)</option>)}
          </NativeSelect>
        </label>
      )}
      {type === "sql" && (
        <>
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            SQL (one SELECT; read earlier steps by their names, or dataset tables)
            <Textarea value={c.sql ?? ""} onChange={(e) => onChange({ sql: e.target.value })} rows={7} className="font-mono text-[13px]" spellCheck={false}
              placeholder={upstream[0] ? `SELECT * FROM ${upstream[0]}` : "SELECT ..."} />
          </label>
          {c.python && (
            <details className="text-[12px] text-faint">
              <summary className="cursor-pointer">Python version (for export; Vyuham runs the SQL)</summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12px] text-text">{c.python}</pre>
            </details>
          )}
        </>
      )}
      {type === "dedupe" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            Duplicate when these columns match (comma separated)
            <Input value={(c.keys ?? []).join(", ")} onChange={(e) => onChange({ keys: list(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            Keep the latest by (optional)
            <Input value={c.order_by ?? ""} onChange={(e) => onChange({ order_by: e.target.value || undefined })} />
          </label>
        </div>
      )}
      {type === "validate" && <ChecksEditor checks={c.checks ?? []} onFail={c.on_fail ?? "fail"} onChange={onChange} />}
      {type === "destination" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            Table to write
            <Input value={c.target_name ?? ""} onChange={(e) => onChange({ target_name: e.target.value })} placeholder="Revenue by region" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            Layer
            <NativeSelect value={c.layer ?? "gold"} onChange={(e) => onChange({ layer: e.target.value as StepConfig["layer"] })}>
              <option value="bronze">Bronze (raw)</option>
              <option value="silver">Silver (cleaned)</option>
              <option value="gold">Gold (business-ready)</option>
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-faint">
            Write mode
            <NativeSelect value={c.mode ?? "replace"} onChange={(e) => onChange({ mode: e.target.value as StepConfig["mode"] })}>
              <option value="replace">Replace (full refresh)</option>
              <option value="append">Append every row</option>
              <option value="incremental">Incremental (only newer rows)</option>
            </NativeSelect>
          </label>
          {c.mode === "incremental" && (
            <label className="flex flex-col gap-1 text-[12px] text-faint">
              Watermark column (a date or always-increasing id)
              <Input value={c.watermark ?? ""} onChange={(e) => onChange({ watermark: e.target.value })} />
            </label>
          )}
        </div>
      )}
      {problem && <p role="alert" className="text-[13px] text-destructive">{problem}</p>}
      {preview && !preview.loading && (preview.error ? <ErrorLine error={preview.error} /> : preview.data && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-faint">{preview.data.row_count.toLocaleString()} rows{preview.data.elapsed_ms != null ? ` · computed in ${formatMs(preview.data.elapsed_ms)}` : ""} · nothing was written</p>
          <RowsTable columns={preview.data.columns} rows={preview.data.rows} />
        </div>
      ))}
    </section>
  );
}

const CHECK_LABEL: Record<Check["type"], string> = {
  not_null: "Never empty", unique: "Unique", accepted_values: "One of these values", references: "Exists in another table", row_count_min: "At least N rows", expression: "Condition holds",
};

function ChecksEditor({ checks, onFail, onChange }: { checks: Check[]; onFail: NonNullable<StepConfig["on_fail"]>; onChange: (p: Partial<StepConfig>) => void }) {
  const set = (i: number, patch: Partial<Check>) => onChange({ checks: checks.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="flex flex-col gap-3">
      <label className="flex max-w-xs flex-col gap-1 text-[12px] text-faint">
        When a check fails
        <NativeSelect value={onFail} onChange={(e) => onChange({ on_fail: e.target.value as StepConfig["on_fail"] })}>
          <option value="fail">Stop the run</option>
          <option value="warn">Log it and continue</option>
          <option value="drop">Drop the failing rows</option>
        </NativeSelect>
      </label>
      {checks.map((c, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[180px_1fr_1fr_auto]">
          <NativeSelect value={c.type} onChange={(e) => set(i, { type: e.target.value as Check["type"] })} aria-label="Check type">
            {(Object.keys(CHECK_LABEL) as Check["type"][]).map((t) => <option key={t} value={t}>{CHECK_LABEL[t]}</option>)}
          </NativeSelect>
          {c.type === "row_count_min" ? (
            <Input type="number" min={1} value={c.min ?? 1} onChange={(e) => set(i, { min: Number(e.target.value) })} aria-label="Minimum rows" />
          ) : c.type === "expression" ? (
            <Input value={c.sql ?? ""} onChange={(e) => set(i, { sql: e.target.value })} placeholder="amount >= 0" className="font-mono sm:col-span-2" aria-label="Condition" />
          ) : (
            <Input value={c.column ?? ""} onChange={(e) => set(i, { column: e.target.value })} placeholder="column" aria-label="Column" />
          )}
          {c.type === "accepted_values" && <Input value={(c.values ?? []).join(", ")} onChange={(e) => set(i, { values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="paid, refunded" aria-label="Allowed values" />}
          {c.type === "references" && (
            <div className="flex gap-2">
              <Input value={c.ref_table ?? ""} onChange={(e) => set(i, { ref_table: e.target.value })} placeholder="step or table" aria-label="Reference table" />
              <Input value={c.ref_column ?? ""} onChange={(e) => set(i, { ref_column: e.target.value })} placeholder="column" aria-label="Reference column" />
            </div>
          )}
          {!["accepted_values", "references", "expression"].includes(c.type) && <span className="hidden sm:block" />}
          <Button variant="ghost" size="icon-sm" aria-label="Remove check" onClick={() => onChange({ checks: checks.filter((_, j) => j !== i) })}><Trash2 /></Button>
        </div>
      ))}
      <div><Button variant="outline" size="sm" onClick={() => onChange({ checks: [...checks, { type: "not_null", column: "" }] })}>Add check</Button></div>
    </div>
  );
}

function RunsPanel({ pipeline, confirmOverwrite, setConfirmOverwrite, onApplyFix, nodes }: {
  pipeline: Pipeline; confirmOverwrite: boolean; setConfirmOverwrite: (v: boolean) => void; onApplyFix: (g: PGraph, actionId: string) => void; nodes: PNode[];
}) {
  const runs = usePipelineRuns(pipeline.id);
  const actions = usePipelineAction(pipeline.id);
  const ai = useAiStatus();
  const [openId, setOpenId] = useState<string | null>(null);
  const [debug, setDebug] = useState<Debug | null>(null);
  const open = runs.data?.find((r) => r.id === openId) ?? runs.data?.[0];
  const active = runs.data?.some((r) => r.status === "queued" || r.status === "running");
  const label = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? id;
  const start = (extra: { only_steps?: string[]; retry_of?: string } = {}) => actions.run.mutate({ ...extra, confirm_overwrite: confirmOverwrite }, { onSuccess: (r) => setOpenId(r.id) });

  return (
    <section className="flex flex-col gap-4" aria-label="Runs">
      <SectionTitle action={
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={confirmOverwrite} onChange={(e) => setConfirmOverwrite(e.target.checked)} className="size-4 accent-[var(--primary)]" />
            Confirm overwrite of existing tables
          </label>
          <Button size="sm" onClick={() => start()} disabled={actions.run.isPending || active || pipeline.needs_approval || pipeline.problems.length > 0}>
            {active ? <Loader2 className="animate-spin" /> : <Play />} Run now
          </Button>
        </div>
      }>Runs</SectionTitle>
      <ErrorLine error={actions.run.error} />
      {!runs.data?.length ? (
        <p className="text-[13px] text-faint">No runs yet. {pipeline.schedule !== "manual" && `It also runs ${pipeline.schedule === "hourly" ? "every hour" : `daily at ${String(pipeline.hour).padStart(2, "0")}:00 UTC`}.`}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <ul className="flex max-h-[420px] flex-col gap-1 overflow-auto" aria-label="Run history">
            {runs.data.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { setOpenId(r.id); setDebug(null); }}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[12px]", open?.id === r.id ? "border-line-strong bg-surface-2" : "border-line hover:bg-surface-2/60")}>
                  <span className="flex flex-col"><span className="text-text">{ago(r.created_at)}</span><span className="text-faint">{r.trigger} · {formatMs(r.duration_ms)}</span></span>
                  <Chip tone={r.status} />
                </button>
              </li>
            ))}
          </ul>
          {open && <RunDetail run={open} label={label} onRetry={(ids) => start({ only_steps: ids, retry_of: open.id })}
            onDebug={() => actions.debug.mutate(open.id, { onSuccess: setDebug })} debugging={actions.debug.isPending} debugError={actions.debug.error}
            aiEnabled={!!ai.data?.enabled} debug={debug} onApplyFix={(g, id) => { onApplyFix(g, id); setDebug(null); }} />}
        </div>
      )}
    </section>
  );
}

function RunDetail({ run, label, onRetry, onDebug, debugging, debugError, aiEnabled, debug, onApplyFix }: {
  run: PipelineRun; label: (id: string) => string; onRetry: (ids: string[]) => void; onDebug: () => void; debugging: boolean; debugError: unknown;
  aiEnabled: boolean; debug: Debug | null; onApplyFix: (g: PGraph, actionId: string) => void;
}) {
  const failed = Object.entries(run.steps).filter(([, s]) => s.status === "failed").map(([id]) => id);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Chip tone={run.status} />
        <span className="text-muted">{run.trigger === "retry" ? "Retry of selected steps" : `Started ${run.trigger}`} · {formatMs(run.duration_ms)}{run.rows_written != null ? ` · ${run.rows_written.toLocaleString()} rows written` : ""}</span>
      </div>
      {run.error && <p className="text-[13px] text-destructive">{run.error}</p>}
      {run.status === "failed" && (
        <div className="flex flex-wrap gap-2">
          {failed.length > 0 && <Button variant="outline" size="sm" onClick={() => onRetry(failed)}><RotateCcw /> Retry failed steps</Button>}
          <Button variant="outline" size="sm" onClick={onDebug} disabled={!aiEnabled || debugging} title={aiEnabled ? undefined : "AI isn't set up on this server"}>
            {debugging ? <Loader2 className="animate-spin" /> : <Wand2 />} Debug with AI
          </Button>
        </div>
      )}
      <ErrorLine error={debugError} />
      {debug && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3 text-[13px]">
          <p className="font-medium text-text">{debug.summary}</p>
          <p className="text-muted"><b className="text-text">Cause:</b> {debug.cause}</p>
          <p className="text-muted"><b className="text-text">Fix:</b> {debug.fix}</p>
          {debug.corrected_sql && <pre className="max-h-48 overflow-auto rounded border border-line p-2 font-mono text-[12px] text-text">{debug.corrected_sql}</pre>}
          {debug.graph && (
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={debug.valid ? "success" : "failed"}>{debug.valid ? "Fix checked against the real tables" : "The fix still has problems"}</Chip>
              <Button size="sm" onClick={() => onApplyFix(debug.graph!, debug.action_id)}>Apply fix to the canvas</Button>
              <span className="text-[12px] text-faint">Then save; the pipeline will need approval again.</span>
            </div>
          )}
          {Object.values(debug.check_problems ?? {}).map((x) => <p key={x} className="text-[12px] text-destructive">{x}</p>)}
        </div>
      )}
      <ol className="flex flex-col gap-2">
        {Object.entries(run.steps).map(([id, s]) => (
          <li key={id} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="font-medium text-text">{label(id)}</span>
              <span className="flex items-center gap-2 text-[12px] text-faint">
                {s.rows != null && `${s.rows.toLocaleString()} rows`}{s.duration_ms != null && ` · ${formatMs(s.duration_ms)}`}{s.reused && " · reused"}
                <Chip tone={s.status} />
              </span>
            </div>
            {s.checks?.length ? (
              <ul className="mt-2 space-y-0.5 text-[12px]">
                {s.checks.map((c) => <li key={c.check} className={c.passed ? "text-muted" : "text-destructive"}>{c.passed ? "✓" : "✗"} {c.check}{!c.passed && ` (${c.failed_rows} rows)`}</li>)}
              </ul>
            ) : null}
            {s.logs?.length ? (
              <details className="mt-2 text-[12px]" open={s.status === "failed"}>
                <summary className="cursor-pointer text-faint">Logs ({s.logs.length})</summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted">{s.logs.join("\n")}</pre>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function OptimizePanel({ id }: { id: string }) {
  const [on, setOn] = useState(false);
  const q = useOptimize(id, on);
  return (
    <section className="flex flex-col gap-3" aria-label="Optimization">
      <SectionTitle action={<Button variant="outline" size="sm" onClick={() => (on ? q.refetch() : setOn(true))}><Lightbulb /> {on ? "Re-check" : "Find improvements"}</Button>}>Optimization</SectionTitle>
      {!on && <p className="text-[13px] text-faint">Looks for unnecessary steps, joins without conditions, repeated scans of the same dataset, full rewrites that could be incremental, and pipelines that duplicate each other.</p>}
      {q.isFetching && <p className="text-[13px] text-faint">Checking…</p>}
      <ErrorLine error={q.error} />
      {q.data && (q.data.suggestions.length === 0 ? <p className="text-[13px] text-muted">Nothing to improve was found.</p> : (
        <ul className="flex flex-col gap-2">
          {q.data.suggestions.map((s, i) => (
            <li key={i} className="rounded-lg border border-line bg-surface p-3 text-[13px]">
              <p className="flex items-center gap-2 font-medium text-text"><Chip tone={s.severity === "high" ? "failed" : s.severity === "medium" ? "warn" : "pending"}>{s.severity}</Chip>{s.title}</p>
              <p className="mt-1 text-muted">{s.detail}</p>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
