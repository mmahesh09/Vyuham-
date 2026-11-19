"use client";

import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Columns3, Play, Plus, Sigma, Tags, Trash2, XCircle } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useMemo, useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/features/auth/hooks";
import { formatNumber } from "@/features/charts/build-option";
import { useDatasets, type Dataset } from "@/features/datasets/api";
import { cn } from "@/lib/utils";

import {
  isApproved,
  useAddMetricTest,
  useAddVersion,
  useApproveMetric,
  useCalculatedColumns,
  useCreateDimension,
  useCreateMetric,
  useDeleteCalculatedColumn,
  useDeleteDimension,
  useDeleteMetric,
  useDeleteMetricTest,
  useDimensions,
  useMetrics,
  useMetricTests,
  useMetricVersions,
  useRunMetricTests,
  useSaveCalculatedColumn,
  useUpdateMetric,
  type CalculatedColumn,
  type FormulaCheck,
  type Metric,
  type MetricDetails,
  type MetricFormat,
  type MetricTestResult,
} from "./api";
import { FormulaEditor } from "./formula-editor";
import { useFormula, useFormulaNames } from "./use-formula";

const TABS = ["metrics", "columns", "dimensions"] as const;
const today = () => new Date().toISOString().slice(0, 10);
const list = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="text-sm text-destructive">{message(error)}</p>;
}

function CheckLine({ check, checking, empty }: { check?: FormulaCheck; checking: boolean; empty: boolean }) {
  if (empty) return <p className="text-[13px] text-faint">Start typing. Press Ctrl+Space for columns and functions.</p>;
  if (checking || !check) return <p className="text-[13px] text-faint">Checking…</p>;
  if (!check.ok) return <p role="alert" className="flex items-start gap-1.5 text-[13px] text-destructive"><XCircle className="mt-0.5 size-3.5 shrink-0" />{check.error?.message}</p>;
  return <p className="flex items-center gap-1.5 text-[13px] text-muted"><CheckCircle2 className="size-3.5 text-primary" />Valid. {check.metrics.length ? `Uses ${check.metrics.join(", ")}.` : ""}</p>;
}

function PreviewTable({ rows, loading, error }: { rows?: Record<string, string | number | null>[]; loading: boolean; error: unknown }) {
  if (error) return <Problem error={error} />;
  if (loading && !rows) return <Skeleton className="h-16 w-full" />;
  if (!rows?.length) return <p className="text-[13px] text-faint">No rows to preview.</p>;
  const columns = Object.keys(rows[0]);
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-surface text-muted">
          <tr>{columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c === "value" ? "Result" : c === "label" ? "Group" : c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const v = r[c];
                return <td key={c} className="px-3 py-1.5 tabular-nums">{v === null ? <span className="text-faint">empty</span> : typeof v === "number" ? formatNumber(v) : v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- one metric ----------

type Draft = MetricDetails & { dataset_id: string; formula: string; effective_from: string; synonymsText: string };

function toDraft(m: Metric | null, datasetId: string): Draft {
  return {
    name: m?.name ?? "", dataset_id: m?.dataset_id ?? datasetId, formula: m?.formula ?? "", description: m?.description ?? null,
    format: m?.format ?? "number", currency: m?.currency ?? null, unit: m?.unit ?? null, default_date_column: m?.default_date_column ?? null,
    synonyms: m?.synonyms ?? [], synonymsText: (m?.synonyms ?? []).join(", "), effective_from: today(),
  };
}

function MetricEditor({ metric, datasets, canEdit, onSaved, onDeleted }: { metric: Metric | null; datasets: Dataset[]; canEdit: boolean; onSaved: (m: Metric) => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState(() => toDraft(metric, datasets[0]?.id ?? ""));
  const [groupBy, setGroupBy] = useState("");
  useEffect(() => {
    setDraft(toDraft(metric, datasets[0]?.id ?? ""));
    setGroupBy("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when a different metric, or a new version, opens
  }, [metric?.id, metric?.version]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const ds = datasets.find((d) => d.id === draft.dataset_id);
  const names = useFormulaNames(ds, "measure", metric?.id);
  const input = useMemo(
    () => ({ dataset_id: draft.dataset_id, formula: draft.formula, kind: "measure" as const, metric_id: metric?.id, group_by: groupBy || undefined }),
    [draft.dataset_id, draft.formula, metric?.id, groupBy],
  );
  const { check, checking, preview } = useFormula(input, canEdit);

  const create = useCreateMetric();
  const update = useUpdateMetric(metric?.id ?? "");
  const addVersion = useAddVersion(metric?.id ?? "");
  const approve = useApproveMetric(metric?.id ?? "");
  const remove = useDeleteMetric();
  const busy = create.isPending || update.isPending || addVersion.isPending;
  const formulaChanged = !!metric && draft.formula.trim() !== metric.formula;
  const details: MetricDetails = {
    name: draft.name.trim(), description: draft.description?.trim() || null, format: draft.format,
    currency: draft.format === "currency" ? draft.currency?.trim().toUpperCase() || null : null,
    unit: draft.unit?.trim() || null, default_date_column: draft.default_date_column || null, synonyms: list(draft.synonymsText),
  };

  const save = async () => {
    if (!metric) {
      onSaved(await create.mutateAsync({ ...details, dataset_id: draft.dataset_id, formula: draft.formula, effective_from: draft.effective_from }));
      return;
    }
    let saved = await update.mutateAsync(details);
    if (formulaChanged) saved = await addVersion.mutateAsync({ formula: draft.formula, effective_from: draft.effective_from });
    onSaved(saved);
  };

  const dates = ds?.columns.filter((c) => c.type === "date") ?? [];
  const ready = !!draft.name.trim() && !!draft.dataset_id && check?.ok === true && !busy;
  const needsApproval = !!metric && !formulaChanged && metric.approved_version !== metric.version;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-semibold">{metric?.name ?? "New metric"}</h2>
        {metric && (isApproved(metric) ? <Badge variant="success-light" size="sm">Approved v{metric.approved_version}</Badge> : <Badge variant="outline" size="sm">Draft</Badge>)}
        {needsApproval && isApproved(metric) && <Badge variant="outline" size="sm">v{metric.version} awaiting approval</Badge>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="m-name">Name</FieldLabel>
          <Input id="m-name" maxLength={120} disabled={!canEdit} placeholder="e.g. Revenue" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="m-ds">Dataset</FieldLabel>
          <NativeSelect id="m-ds" className="w-full" disabled={!!metric || !canEdit} value={draft.dataset_id} onChange={(e) => set({ dataset_id: e.target.value, default_date_column: null })}>
            {datasets.map((d) => <option key={d.id} value={d.id} className="bg-surface">{d.name}</option>)}
          </NativeSelect>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="m-formula">Formula</FieldLabel>
        <FormulaEditor id="m-formula" key={metric?.id ?? "new"} label="Metric formula" value={draft.formula} onChange={(formula) => set({ formula })} names={names} error={check?.error ?? null} readOnly={!canEdit} placeholderText="SUM([amount])" />
        <CheckLine check={check} checking={checking} empty={!draft.formula.trim()} />
        {metric?.approved_formula && metric.approved_formula !== draft.formula.trim() && (
          <FieldDescription>Charts use the approved formula until this one is approved: <code className="font-mono">{metric.approved_formula}</code></FieldDescription>
        )}
      </Field>

      {canEdit && check?.ok && (
        <section className="flex flex-col gap-2" aria-label="Preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Preview</h3>
            <NativeSelect aria-label="Group the preview by" className="w-48" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="" className="bg-surface">Overall</option>
              {ds?.columns.filter((c) => c.type !== "number").map((c) => <option key={c.name} value={c.name} className="bg-surface">By {c.name}</option>)}
            </NativeSelect>
          </div>
          <PreviewTable rows={preview.data?.rows} loading={preview.isFetching} error={preview.error} />
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="m-desc">What it means</FieldLabel>
          <Textarea id="m-desc" rows={2} maxLength={1000} disabled={!canEdit} placeholder="Paid order value before refunds." value={draft.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="m-syn">Other names people use</FieldLabel>
          <Input id="m-syn" disabled={!canEdit} placeholder="sales, turnover" value={draft.synonymsText} onChange={(e) => set({ synonymsText: e.target.value })} />
          <FieldDescription>Ask understands these once the metric is approved.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="m-date">Default date column</FieldLabel>
          <NativeSelect id="m-date" className="w-full" disabled={!canEdit} value={draft.default_date_column ?? ""} onChange={(e) => set({ default_date_column: e.target.value || null })}>
            <option value="" className="bg-surface">None</option>
            {dates.map((c) => <option key={c.name} value={c.name} className="bg-surface">{c.name}</option>)}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="m-format">Shown as</FieldLabel>
          <NativeSelect id="m-format" className="w-full" disabled={!canEdit} value={draft.format} onChange={(e) => set({ format: e.target.value as MetricFormat })}>
            <option value="number" className="bg-surface">Number</option>
            <option value="currency" className="bg-surface">Currency</option>
            <option value="percent" className="bg-surface">Percent</option>
          </NativeSelect>
        </Field>
        {draft.format === "currency" ? (
          <Field>
            <FieldLabel htmlFor="m-cur">Currency code</FieldLabel>
            <Input id="m-cur" maxLength={3} disabled={!canEdit} placeholder="INR" value={draft.currency ?? ""} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
          </Field>
        ) : (
          <Field>
            <FieldLabel htmlFor="m-unit">Unit</FieldLabel>
            <Input id="m-unit" maxLength={24} disabled={!canEdit} placeholder="orders" value={draft.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} />
          </Field>
        )}
        {canEdit && (!metric || formulaChanged) && (
          <Field>
            <FieldLabel htmlFor="m-eff">Takes effect</FieldLabel>
            <Input id="m-eff" type="date" value={draft.effective_from} onChange={(e) => set({ effective_from: e.target.value })} />
          </Field>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button disabled={!ready} onClick={() => void save().catch(() => undefined)}>{!metric ? "Create metric" : formulaChanged ? "Save as new version" : "Save details"}</Button>
            {needsApproval && <Button variant="outline" disabled={approve.isPending} onClick={() => approve.mutate()}>Approve v{metric.version}</Button>}
            {metric && (
              <Button variant="ghost" className="ml-auto" disabled={remove.isPending} onClick={() => window.confirm(`Delete “${metric.name}” and its history?`) && remove.mutate(metric.id, { onSuccess: onDeleted })}>
                <Trash2 data-icon="inline-start" />Delete
              </Button>
            )}
          </div>
          <Problem error={create.error ?? update.error ?? addVersion.error ?? approve.error ?? remove.error} />
        </div>
      )}

      {metric && <MetricTests metric={metric} dataset={ds} canEdit={canEdit} />}
      {metric && <VersionHistory metric={metric} />}
    </div>
  );
}

function MetricTests({ metric, dataset, canEdit }: { metric: Metric; dataset?: Dataset; canEdit: boolean }) {
  const tests = useMetricTests(metric.id);
  const add = useAddMetricTest(metric.id);
  const remove = useDeleteMetricTest(metric.id);
  const run = useRunMetricTests(metric.id);
  const [name, setName] = useState("");
  const [expected, setExpected] = useState("");
  const [column, setColumn] = useState("");
  const [value, setValue] = useState("");
  const results = new Map<string, MetricTestResult>((run.data ?? []).map((r) => [r.id, r]));
  const number = Number(expected);
  const valid = !!name.trim() && expected.trim() !== "" && Number.isFinite(number) && (!column || !!value.trim());

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-5" aria-label="Tests">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Tests</h3>
          <p className="text-[13px] text-muted">Numbers you know are right. All of them must pass before a version can be approved.</p>
        </div>
        {canEdit && !!tests.data?.length && <Button variant="outline" size="sm" disabled={run.isPending} onClick={() => run.mutate()}><Play data-icon="inline-start" />Run tests</Button>}
      </div>
      {tests.data?.map((t) => {
        const r = results.get(t.id);
        const filter = t.filters[0];
        return (
          <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
            <span className="font-medium">{t.name}</span>
            <span className="text-muted">expects {t.expected === null ? "empty" : formatNumber(t.expected)}{filter ? ` where ${filter.field} = ${String(filter.value)}` : ""}</span>
            {r && <Badge variant={r.status === "passed" ? "success-light" : "destructive-light"} size="sm">{r.status === "passed" ? "Passed" : r.status === "failed" ? `Got ${r.actual === null ? "empty" : formatNumber(r.actual)}` : "Error"}</Badge>}
            {r?.message && <span className="text-destructive">{r.message}</span>}
            {canEdit && <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Delete test ${t.name}`} onClick={() => remove.mutate(t.id)}><Trash2 /></Button>}
          </div>
        );
      })}
      {canEdit && (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_110px_140px_110px_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(
              { name: name.trim(), expected: number, tolerance: 0, filters: column ? [{ field: column, op: "eq", value: value.trim() }] : [] },
              { onSuccess: () => { setName(""); setExpected(""); setColumn(""); setValue(""); } },
            );
          }}
        >
          <Input aria-label="Test name" placeholder="January total" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <Input aria-label="Expected result" placeholder="Expected" inputMode="decimal" value={expected} onChange={(e) => setExpected(e.target.value)} />
          <NativeSelect aria-label="Only rows where" className="w-full" value={column} onChange={(e) => setColumn(e.target.value)}>
            <option value="" className="bg-surface">All rows</option>
            {dataset?.columns.map((c) => <option key={c.name} value={c.name} className="bg-surface">{c.name}</option>)}
          </NativeSelect>
          <Input aria-label="Equals" placeholder="equals" disabled={!column} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!valid || add.isPending}>Add test</Button>
        </form>
      )}
      <Problem error={add.error ?? run.error ?? remove.error} />
    </section>
  );
}

function VersionHistory({ metric }: { metric: Metric }) {
  const { data } = useMetricVersions(metric.id);
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-5" aria-label="Version history">
      <h3 className="text-sm font-semibold">Version history</h3>
      <ol className="flex flex-col gap-1.5">
        {data?.map((v) => (
          <li key={v.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
            <span className="font-medium">v{v.version}</span>
            <code className="min-w-0 break-all font-mono text-muted">{v.formula}</code>
            <span className="text-faint">from {v.effective_from} · {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}</span>
            {v.version === metric.approved_version && <Badge variant="success-light" size="sm">Approved</Badge>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function MetricsTab({ datasets, canEdit }: { datasets: Dataset[]; canEdit: boolean }) {
  const { data: metrics, isPending } = useMetrics();
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const current = metrics?.find((m) => m.id === selected) ?? null;
  const open = selected === "new" || !!current;

  if (isPending) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className={cn("flex flex-col gap-2", open && "hidden lg:flex")}>
        {canEdit && <Button variant="outline" onClick={() => setSelected("new")}><Plus data-icon="inline-start" />New metric</Button>}
        <ul className="flex flex-col gap-1">
          {metrics?.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setSelected(m.id)} aria-current={selected === m.id} className={cn("flex w-full min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2", selected === m.id && "bg-surface-2")}>
                <span className="min-w-0 truncate font-medium">{m.name}</span>
                <span className="shrink-0 text-xs text-faint">{isApproved(m) ? `v${m.approved_version}` : "Draft"}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className={cn("min-w-0", !open && "hidden lg:block")}>
        {open ? (
          <>
            <Button variant="ghost" size="sm" className="mb-3 lg:hidden" onClick={() => setSelected(null)}>All metrics</Button>
            <MetricEditor metric={current} datasets={datasets} canEdit={canEdit} onSaved={(m) => setSelected(m.id)} onDeleted={() => setSelected(null)} />
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Sigma /></EmptyMedia>
              <EmptyTitle>{metrics?.length ? "Pick a metric" : "Define your first metric"}</EmptyTitle>
              <EmptyDescription>A metric is one agreed calculation, like Revenue. Once approved, dashboards, alerts, SQL Lab and Ask all use the same number.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}

// ---------- calculated columns ----------

function ColumnForm({ column, datasets, onDone }: { column: CalculatedColumn | null; datasets: Dataset[]; onDone: () => void }) {
  const [datasetId, setDatasetId] = useState(column?.dataset_id ?? datasets[0]?.id ?? "");
  const [name, setName] = useState(column?.name ?? "");
  const [formula, setFormula] = useState(column?.formula ?? "");
  const ds = datasets.find((d) => d.id === datasetId);
  const names = useFormulaNames(ds, "column");
  const input = useMemo(() => ({ dataset_id: datasetId, formula, kind: "column" as const, column_id: column?.id }), [datasetId, formula, column?.id]);
  const { check, checking, preview } = useFormula(input, true);
  const save = useSaveCalculatedColumn();

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: column?.id, dataset_id: datasetId, name: name.trim(), formula: formula.trim() }, { onSuccess: onDone });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="c-ds">Dataset</FieldLabel>
          <NativeSelect id="c-ds" className="w-full" disabled={!!column} value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
            {datasets.map((d) => <option key={d.id} value={d.id} className="bg-surface">{d.name}</option>)}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="c-name">Column name</FieldLabel>
          <Input id="c-name" maxLength={120} placeholder="e.g. Margin" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="c-formula">Formula</FieldLabel>
        <FormulaEditor id="c-formula" key={column?.id ?? "new"} label="Column formula" value={formula} onChange={setFormula} names={names} error={check?.error ?? null} placeholderText="[amount] - [cost]" />
        <CheckLine check={check} checking={checking} empty={!formula.trim()} />
      </Field>
      {check?.ok && <PreviewTable rows={preview.data?.rows} loading={preview.isFetching} error={preview.error} />}
      <Problem error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!name.trim() || check?.ok !== true || save.isPending}>{column ? "Save column" : "Add column"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function ColumnsTab({ datasets, canEdit }: { datasets: Dataset[]; canEdit: boolean }) {
  const { data: columns, isPending } = useCalculatedColumns();
  const remove = useDeleteCalculatedColumn();
  const [editing, setEditing] = useState<CalculatedColumn | "new" | null>(null);
  const datasetName = (id: string) => datasets.find((d) => d.id === id)?.name ?? "Deleted dataset";
  if (isPending) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {canEdit && !editing && <Button variant="outline" className="self-start" onClick={() => setEditing("new")}><Plus data-icon="inline-start" />New calculated column</Button>}
      {editing && <ColumnForm key={editing === "new" ? "new" : editing.id} column={editing === "new" ? null : editing} datasets={datasets} onDone={() => setEditing(null)} />}
      {!columns?.length && !editing && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Columns3 /></EmptyMedia>
            <EmptyTitle>No calculated columns yet</EmptyTitle>
            <EmptyDescription>Add a column worked out row by row. It appears in charts, filters, SQL Lab and exports like any other column.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <ul className="flex flex-col gap-2">
        {columns?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-[13px]">
            <span className="font-medium">{c.name}</span>
            <span className="text-faint">{datasetName(c.dataset_id)}{c.type ? ` · ${c.type}` : ""}</span>
            <code className="min-w-0 basis-full break-all font-mono text-muted sm:order-last">{c.formula}</code>
            {c.error && <span role="alert" className="basis-full text-destructive sm:order-last">{c.error}</span>}
            {canEdit && (
              <span className="ml-auto flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>Edit</Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`} onClick={() => window.confirm(`Delete “${c.name}”? Charts using it will stop working.`) && remove.mutate(c.id)}><Trash2 /></Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <Problem error={remove.error} />
    </div>
  );
}

// ---------- dimensions ----------

function DimensionsTab({ datasets, canEdit }: { datasets: Dataset[]; canEdit: boolean }) {
  const { data: dimensions, isPending } = useDimensions();
  const create = useCreateDimension();
  const remove = useDeleteDimension();
  const [name, setName] = useState("");
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [column, setColumn] = useState("");
  const [synonyms, setSynonyms] = useState("");
  const ds = datasets.find((d) => d.id === datasetId);
  if (isPending) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted">Give columns the names your team uses, so “sales by territory” finds the region column.</p>
      {canEdit && (
        <form
          className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name: name.trim(), dataset_id: datasetId, column, description: null, synonyms: list(synonyms) }, { onSuccess: () => { setName(""); setColumn(""); setSynonyms(""); } });
          }}
        >
          <Field>
            <FieldLabel htmlFor="d-name">Business name</FieldLabel>
            <Input id="d-name" maxLength={120} placeholder="Territory" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="d-syn">Other names</FieldLabel>
            <Input id="d-syn" placeholder="area, zone" value={synonyms} onChange={(e) => setSynonyms(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="d-ds">Dataset</FieldLabel>
            <NativeSelect id="d-ds" className="w-full" value={datasetId} onChange={(e) => { setDatasetId(e.target.value); setColumn(""); }}>
              {datasets.map((d) => <option key={d.id} value={d.id} className="bg-surface">{d.name}</option>)}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="d-col">Column</FieldLabel>
            <NativeSelect id="d-col" className="w-full" value={column} onChange={(e) => setColumn(e.target.value)}>
              <option value="" className="bg-surface">Choose a column</option>
              {ds?.columns.filter((c) => c.type !== "number").map((c) => <option key={c.name} value={c.name} className="bg-surface">{c.name}</option>)}
            </NativeSelect>
          </Field>
          <div className="sm:col-span-2"><Button type="submit" variant="outline" disabled={!name.trim() || !column || create.isPending}>Add dimension</Button></div>
          <div className="sm:col-span-2"><Problem error={create.error} /></div>
        </form>
      )}
      {!dimensions?.length && !canEdit && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Tags /></EmptyMedia>
            <EmptyTitle>No dimensions yet</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      <ul className="flex flex-col gap-2">
        {dimensions?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-[13px]">
            <span className="font-medium">{d.name}</span>
            <span className="text-muted">{d.column}</span>
            <span className="text-faint">{datasets.find((x) => x.id === d.dataset_id)?.name}{d.synonyms.length ? ` · also ${d.synonyms.join(", ")}` : ""}</span>
            {canEdit && <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Delete ${d.name}`} onClick={() => remove.mutate(d.id)}><Trash2 /></Button>}
          </li>
        ))}
      </ul>
      <Problem error={remove.error} />
    </div>
  );
}

// ---------- page ----------

export function MetricsScreen() {
  const { data: me } = useMe();
  const { data: datasets, isPending } = useDatasets();
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("metrics"));
  const canEdit = !!me && me.role !== "viewer";

  return (
    <PageContainer>
      <PageHeader title="Metrics" description="Agreed definitions your whole workspace can rely on." />
      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !datasets?.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Sigma /></EmptyMedia>
            <EmptyTitle>Add data first</EmptyTitle>
            <EmptyDescription>Metrics are calculated from a dataset. Upload a file or connect a database on the Data page.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs value={tab} onValueChange={(v) => void setTab(v as (typeof TABS)[number])}>
          <TabsList>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="columns">Calculated columns</TabsTrigger>
            <TabsTrigger value="dimensions">Dimensions</TabsTrigger>
          </TabsList>
          <TabsContent value="metrics" className="pt-5"><MetricsTab datasets={datasets} canEdit={canEdit} /></TabsContent>
          <TabsContent value="columns" className="pt-5"><ColumnsTab datasets={datasets} canEdit={canEdit} /></TabsContent>
          <TabsContent value="dimensions" className="pt-5"><DimensionsTab datasets={datasets} canEdit={canEdit} /></TabsContent>
        </Tabs>
      )}
    </PageContainer>
  );
}
