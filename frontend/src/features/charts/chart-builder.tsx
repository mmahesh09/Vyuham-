"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, BarChartHorizontal, ChartPie, ChartScatter, Filter, Gauge, Hash, LayoutGrid, LineChart, Loader2, Sheet as SheetIcon, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { ColorPicker } from "@/components/reui/color-picker";
import { Stepper, StepperIndicator, StepperItem, StepperNav, StepperSeparator, StepperTitle, StepperTrigger } from "@/components/reui/stepper";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { dashboardsApi, type ChartKind, type ChartRecord } from "@/features/dashboards/api";
import { ChartBody, InsightHeadline } from "@/features/dashboards/insight-card";
import { useDatasets, type Dataset } from "@/features/datasets/api";
import { cn } from "@/lib/utils";

import { AGG_LABEL, ROW_FIELD, type Aggregation, type ChartSpec, type ChartType, type DateBucket } from "./chart-spec";

const STEPS = ["Data", "Measure", "Group", "Type", "Style"] as const;
const SWATCHES = ["#cea3f5", "#705cbb", "#cb72d0", "#8b7fe0", "#5b8def", "#3fbf9b", "#f2b544", "#f0597a"];
type Icon = ComponentType<{ className?: string }>;
const CHART_TYPES: { value: Exclude<ChartType, "kpi" | "gauge">; label: string; icon: Icon; dates: boolean; categories: boolean }[] = [
  { value: "line", label: "Line", icon: LineChart, dates: true, categories: false },
  { value: "area", label: "Area", icon: TrendingUp, dates: true, categories: false },
  { value: "bar", label: "Bar", icon: BarChart3, dates: true, categories: true },
  { value: "hbar", label: "Ranking", icon: BarChartHorizontal, dates: false, categories: true },
  { value: "combo", label: "Bar + line", icon: BarChart3, dates: true, categories: true },
  { value: "pie", label: "Pie", icon: ChartPie, dates: false, categories: true },
  { value: "funnel", label: "Funnel", icon: Filter, dates: false, categories: true },
  { value: "treemap", label: "Treemap", icon: LayoutGrid, dates: false, categories: true },
  { value: "scatter", label: "Scatter", icon: ChartScatter, dates: false, categories: true },
  { value: "table", label: "Table", icon: SheetIcon, dates: true, categories: true },
];
const TWO_MEASURES = new Set(["combo", "scatter", "table"]);
const AMOUNT = /revenue|amount|sales|total|price|value|cost|spend|profit/i;
const ENTITY = /client|customer|user|account|company|vendor|product/i;
const STAGE = /status|stage|step|phase|funnel|state/i;

/** Starting points for the gallery: each fills the draft from the dataset's own columns. */
type Template = { id: string; label: string; hint: string; icon: Icon; apply: (ds: Dataset) => Partial<Draft> | null };
const pick = (ds: Dataset) => {
  const nums = ds.columns.filter((c) => c.type === "number");
  const cats = ds.columns.filter((c) => c.type === "category" || c.type === "text");
  return {
    amount: (nums.find((c) => AMOUNT.test(c.name)) ?? nums[0])?.name,
    date: ds.columns.find((c) => c.type === "date")?.name,
    entity: (cats.find((c) => ENTITY.test(c.name)) ?? cats[0])?.name,
    small: (cats.find((c) => c.type === "category" && !ENTITY.test(c.name)) ?? cats[1] ?? cats[0])?.name,
    stage: (cats.find((c) => STAGE.test(c.name)) ?? cats[0])?.name,
  };
};
const measure = (amount?: string) => (amount ? { field: amount, agg: "sum" as Aggregation } : { field: ROW_FIELD, agg: "count" as Aggregation });
const TEMPLATES: Template[] = [
  { id: "trend", label: "Trend over time", hint: "A line of the total per month", icon: LineChart,
    apply: (ds) => { const p = pick(ds); return p.date ? { kind: "card", ...measure(p.amount), groupBy: p.date, dateBucket: "month", chartType: "area" } : null; } },
  { id: "monthly", label: "Monthly bars", hint: "One bar per month, oldest first", icon: BarChart3,
    apply: (ds) => { const p = pick(ds); return p.date ? { kind: "card", ...measure(p.amount), groupBy: p.date, dateBucket: "month", chartType: "bar", sort: "label" } : null; } },
  { id: "ranking", label: "Top 10 ranking", hint: "Who or what brings the most", icon: BarChartHorizontal,
    apply: (ds) => { const p = pick(ds); return p.entity ? { kind: "card", ...measure(p.amount), groupBy: p.entity, chartType: "hbar", sort: "value_desc", limit: "10" } : null; } },
  { id: "share", label: "Share of total", hint: "How a total splits across groups", icon: ChartPie,
    apply: (ds) => { const p = pick(ds); return p.small ? { kind: "card", ...measure(p.amount), groupBy: p.small, chartType: "pie", limit: "8" } : null; } },
  { id: "combo", label: "Value vs volume", hint: "Bars for the total, a line for the count", icon: TrendingUp,
    apply: (ds) => { const p = pick(ds); const g = p.date ?? p.entity; return g && p.amount ? { kind: "card", ...measure(p.amount), field2: ROW_FIELD, agg2: "count", groupBy: g, dateBucket: "month", chartType: "combo" } : null; } },
  { id: "scatter", label: "Compare two measures", hint: "Each group as a dot: total vs count", icon: ChartScatter,
    apply: (ds) => { const p = pick(ds); return p.entity && p.amount ? { kind: "card", ...measure(p.amount), field2: ROW_FIELD, agg2: "count", groupBy: p.entity, chartType: "scatter" } : null; } },
  { id: "funnel", label: "Funnel by stage", hint: "Counts per status or stage", icon: Filter,
    apply: (ds) => { const p = pick(ds); return p.stage ? { kind: "card", field: ROW_FIELD, agg: "count", groupBy: p.stage, chartType: "funnel" } : null; } },
  { id: "treemap", label: "Treemap breakdown", hint: "Boxes sized by each group's total", icon: LayoutGrid,
    apply: (ds) => { const p = pick(ds); return p.entity ? { kind: "card", ...measure(p.amount), groupBy: p.entity, chartType: "treemap", limit: "20" } : null; } },
  { id: "gauge", label: "Progress to a goal", hint: "A gauge against a target you set", icon: Gauge,
    apply: (ds) => ({ kind: "card", ...measure(pick(ds).amount), groupBy: "", chartType: "gauge" }) },
  { id: "table", label: "Summary table", hint: "Totals and counts per group", icon: SheetIcon,
    apply: (ds) => { const p = pick(ds); const g = p.entity ?? p.date; return g ? { kind: "card", ...measure(p.amount), field2: ROW_FIELD, agg2: "count", groupBy: g, chartType: "table" } : null; } },
  { id: "kpi", label: "Key number", hint: "One big number at the top", icon: Hash,
    apply: (ds) => ({ kind: "kpi", ...measure(pick(ds).amount), groupBy: "" }) },
];
const BUCKETS: DateBucket[] = ["day", "week", "month", "quarter", "year"];

type Draft = {
  datasetId: string;
  kind: ChartKind;
  field: string;
  agg: Aggregation;
  groupBy: string;
  dateBucket: DateBucket;
  chartType: Exclude<ChartType, "kpi">;
  /** Second measure, for bar + line, scatter and tables. */
  field2: string;
  agg2: Aggregation;
  /** Gauge goal. */
  target: string;
  title: string;
  titleTouched: boolean;
  sort: "label" | "value_desc" | "value_asc" | "";
  limit: string;
  color: string | null;
  note: string;
};

function autoTitle(d: Draft, ds?: Dataset) {
  const what = d.field === ROW_FIELD ? "Rows" : `${AGG_LABEL[d.agg]} ${d.field}`;
  if (d.kind === "kpi" || !d.groupBy) return what;
  const isDate = ds?.columns.find((c) => c.name === d.groupBy)?.type === "date";
  return isDate ? `${what} over time` : `${what} by ${d.groupBy}`;
}

function fromRecord(c: ChartRecord): Draft {
  const s = c.spec;
  return {
    datasetId: s.dataset,
    kind: c.kind,
    field: s.metrics[0].field,
    agg: s.metrics[0].agg,
    groupBy: s.groupBy ?? "",
    dateBucket: s.dateBucket ?? "month",
    chartType: s.chartType === "kpi" ? "bar" : s.chartType,
    field2: s.metrics[1]?.field ?? "",
    agg2: s.metrics[1]?.agg ?? "count",
    target: s.target !== undefined ? String(s.target) : "",
    title: s.title,
    titleTouched: true,
    sort: s.sort ?? "",
    limit: s.limit ? String(s.limit) : "",
    color: s.color ?? null,
    note: c.note ?? "",
  };
}

function initialDraft(ds: Dataset | undefined, kind: ChartKind): Draft {
  const num = ds?.columns.find((c) => c.type === "number");
  const date = ds?.columns.find((c) => c.type === "date");
  const cat = ds?.columns.find((c) => c.type === "category");
  const groupBy = kind === "kpi" ? "" : (date?.name ?? cat?.name ?? "");
  return {
    datasetId: ds?.id ?? "",
    kind,
    field: num?.name ?? ROW_FIELD,
    agg: num ? "sum" : "count",
    groupBy,
    dateBucket: "month",
    chartType: groupBy && groupBy === date?.name ? "line" : "bar",
    field2: "",
    agg2: "count",
    target: "",
    title: "",
    titleTouched: false,
    sort: "",
    limit: "",
    color: null,
    note: "",
  };
}

export function toSpec(d: Draft, ds?: Dataset): ChartSpec | null {
  if (!d.datasetId || !d.field) return null;
  const gauge = d.kind === "card" && d.chartType === "gauge";
  const groupBy = d.kind === "kpi" || gauge ? undefined : d.groupBy || undefined;
  const isDate = groupBy && ds?.columns.find((c) => c.name === groupBy)?.type === "date";
  const metrics: ChartSpec["metrics"] = [{ field: d.field, agg: d.field === ROW_FIELD ? "count" : d.agg }];
  if (groupBy && TWO_MEASURES.has(d.chartType) && d.field2) metrics.push({ field: d.field2, agg: d.field2 === ROW_FIELD ? "count" : d.agg2 });
  const target = gauge && d.target.trim() ? Number(d.target) : undefined;
  return {
    dataset: d.datasetId,
    metrics,
    groupBy,
    dateBucket: isDate ? d.dateBucket : undefined,
    filters: [],
    chartType: d.kind === "kpi" ? "kpi" : gauge ? "gauge" : groupBy ? d.chartType : "kpi",
    target: target !== undefined && Number.isFinite(target) ? target : undefined,
    title: (d.titleTouched ? d.title : autoTitle(d, ds)).trim() || autoTitle(d, ds),
    sort: d.sort || undefined,
    limit: d.limit ? Math.max(1, Math.min(1000, Number(d.limit))) : undefined,
    color: d.color ?? undefined,
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing chart, or null to add one. */
  chart: ChartRecord | null;
  defaultKind?: ChartKind;
  defaultDatasetId?: string;
  saving: boolean;
  error?: string | null;
  onSave: (body: { spec: ChartSpec; kind: ChartKind; note: string | null }) => void;
};

/** Side panel to build or edit a chart: Data → Measure → Group → Type → Style, with a live preview. */
export function ChartBuilder({ open, onOpenChange, chart, defaultKind = "card", defaultDatasetId, saving, error, onSave }: Props) {
  const { data: datasets } = useDatasets();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Reset every time the panel opens.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    if (chart) setDraft(fromRecord(chart));
    else setDraft(datasets ? initialDraft(datasets.find((d) => d.id === defaultDatasetId) ?? datasets[0], defaultKind) : null);
  }, [open, chart, datasets, defaultDatasetId, defaultKind]);

  const ds = datasets?.find((d) => d.id === draft?.datasetId);
  const spec = useMemo(() => (draft ? toSpec(draft, ds) : null), [draft, ds]);

  // Debounce the preview so typing a title doesn't fire a query per key.
  const [debounced, setDebounced] = useState<ChartSpec | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(spec), 300);
    return () => window.clearTimeout(t);
  }, [spec]);
  const previewKey = debounced ? { ...debounced, title: "", color: undefined } : null; // style changes don't need a refetch
  const preview = useQuery({
    queryKey: ["chart-preview", previewKey],
    queryFn: () => dashboardsApi.preview({ spec: debounced! }),
    enabled: open && !!debounced,
    placeholderData: (prev) => prev,
  });

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const column = (name: string) => ds?.columns.find((c) => c.name === name);
  const isNumber = draft?.field !== ROW_FIELD && column(draft?.field ?? "")?.type === "number";
  const aggs: Aggregation[] = draft?.field === ROW_FIELD ? ["count"] : isNumber ? ["sum", "avg", "min", "max", "count", "count_distinct"] : ["count", "count_distinct"];
  const groupIsDate = column(draft?.groupBy ?? "")?.type === "date";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b border-line">
          <SheetTitle>{chart ? "Edit chart" : draft?.kind === "kpi" ? "Add a key number" : "Add a chart"}</SheetTitle>
          <SheetDescription>Pick the data and how to summarise it. The preview updates as you go.</SheetDescription>
        </SheetHeader>

        {!datasets ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-highlight" aria-label="Loading" />
          </div>
        ) : datasets.length === 0 ? (
          <p className="p-6 text-sm text-muted">Add a dataset on the Data page first, then come back to build charts from it.</p>
        ) : draft ? (
          <div className="flex flex-col gap-6 p-4 sm:p-6">
            {/* Live preview */}
            <section aria-label="Preview" className="rounded-[16px] border border-line bg-bg/60 p-4">
              {preview.isError ? (
                <p className="text-sm text-accent">{preview.error.message}</p>
              ) : !preview.data || !spec ? (
                <div className="h-[220px] animate-pulse rounded-xl bg-line/40" />
              ) : (
                <div className={cn("transition-opacity", preview.isFetching && "opacity-60")}>
                  <InsightHeadline insight={preview.data.insight} fallback={spec.title} />
                  <p className="pl-6 text-[13px] text-muted">{spec.title}</p>
                  <ChartBody spec={spec} rows={preview.data.rows} height={200} />
                </div>
              )}
            </section>

            <Stepper value={step} onValueChange={setStep} aria-label="Chart steps">
              <StepperNav className="gap-1">
                {STEPS.map((title, i) => (
                  <StepperItem key={title} step={i + 1} completed={step > i + 1} className="relative flex-1 items-start">
                    <StepperTrigger className="flex w-full flex-col items-start gap-1.5">
                      <StepperIndicator className="size-6 text-[11px]">{i + 1}</StepperIndicator>
                      <StepperTitle className="text-xs">{title}</StepperTitle>
                    </StepperTrigger>
                    {i < STEPS.length - 1 && <StepperSeparator className="absolute inset-x-0 left-8 top-3 m-0 group-data-[orientation=horizontal]/stepper-nav:w-[calc(100%-2.5rem)]" />}
                  </StepperItem>
                ))}
              </StepperNav>
            </Stepper>

            <div className="flex min-h-48 flex-col gap-5">
              {step === 1 && (
                <>
                  {!chart && ds && (
                    <section aria-labelledby="cb-gallery" className="flex flex-col gap-2" data-tour="chart-templates">
                      <h3 id="cb-gallery" className="flex items-center gap-1.5 text-sm font-semibold">
                        <Sparkles className="size-4 text-highlight" aria-hidden /> Start from a template
                      </h3>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="list">
                        {TEMPLATES.map((t) => {
                          const patch = t.apply(ds);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              role="listitem"
                              disabled={!patch}
                              title={patch ? t.hint : "This dataset doesn't have the columns for this one"}
                              onClick={() => {
                                if (!patch) return;
                                setDraft({ ...initialDraft(ds, patch.kind ?? "card"), ...patch, title: "", titleTouched: false, note: draft.note });
                                setStep(patch.chartType === "gauge" ? 5 : 2);
                              }}
                              className="flex flex-col items-start gap-1 rounded-xl border border-line p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <t.icon className="size-4 text-highlight" />
                              <span className="text-[13px] font-semibold leading-tight">{t.label}</span>
                              <span className="text-[11px] leading-snug text-muted">{t.hint}</span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-faint">Or set it up step by step below.</p>
                    </section>
                  )}
                  <Field>
                    <FieldLabel htmlFor="cb-dataset">Dataset</FieldLabel>
                    <NativeSelect
 id="cb-dataset"
                      className="w-full"
                      value={draft.datasetId}
                      onChange={(e) => setDraft({ ...initialDraft(datasets.find((d) => d.id === e.target.value), draft.kind), note: draft.note })}
                    >
                      {datasets.map((d) => (
                        <option key={d.id} value={d.id} className="bg-surface">
                          {d.name} ({d.row_count.toLocaleString()} rows)
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel>Show it as</FieldLabel>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Show it as">
                      {(
                        [
                          ["card", "A chart", "With an insight sentence, in the story feed", BarChart3],
                          ["kpi", "A key number", "One big number in the row at the top", Hash],
                        ] as const
                      ).map(([value, label, hint, Icon]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={draft.kind === value}
                          onClick={() => set({ kind: value, groupBy: value === "kpi" ? "" : draft.groupBy || initialDraft(ds, "card").groupBy })}
                          className={cn(
                            "flex flex-col items-start gap-1 rounded-xl border border-line p-3 text-left hover:bg-surface-2",
                            draft.kind === value && "border-primary bg-line/40",
                          )}
                        >
                          <Icon className="size-4 text-highlight" />
                          <span className="text-sm font-semibold">{label}</span>
                          <span className="text-xs text-muted">{hint}</span>
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}

              {step === 2 && ds && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="cb-field">Measure</FieldLabel>
                    <NativeSelect
 id="cb-field"
                      className="w-full"
                      value={draft.field}
                      onChange={(e) => {
                        const f = e.target.value;
                        const num = ds.columns.find((c) => c.name === f)?.type === "number";
                        set({ field: f, agg: f === ROW_FIELD ? "count" : num ? (draft.agg === "count" || draft.agg === "count_distinct" ? "sum" : draft.agg) : "count_distinct" });
                      }}
                    >
                      <option value={ROW_FIELD} className="bg-surface">
                        Number of rows
                      </option>
                      {ds.columns.map((c) => (
                        <option key={c.name} value={c.name} className="bg-surface">
                          {c.name} ({c.type})
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="cb-agg">Calculation</FieldLabel>
                    <NativeSelect id="cb-agg" className="w-full" value={draft.agg} onChange={(e) => set({ agg: e.target.value as Aggregation })} disabled={aggs.length === 1}>
                      {aggs.map((a) => (
                        <option key={a} value={a} className="bg-surface">
                          {AGG_LABEL[a]}
                        </option>
                      ))}
                    </NativeSelect>
                    {!isNumber && draft.field !== ROW_FIELD && <FieldDescription>Text and category columns can only be counted.</FieldDescription>}
                  </Field>
                  {draft.kind === "card" && TWO_MEASURES.has(draft.chartType) && (
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="cb-field2">
                        {draft.chartType === "combo" ? "Line measure" : draft.chartType === "scatter" ? "Second measure (up/down axis)" : "Second column (optional)"}
                      </FieldLabel>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <NativeSelect
 id="cb-field2"
                          className="w-full"
                          value={draft.field2}
                          onChange={(e) =>
                            set({
                              field2: e.target.value,
                              agg2: e.target.value === ROW_FIELD ? "count" : ds.columns.find((c) => c.name === e.target.value)?.type === "number" ? "sum" : "count_distinct",
                            })
                          }
                        >
                          <option value="" className="bg-surface">
                            None
                          </option>
                          <option value={ROW_FIELD} className="bg-surface">
                            Number of rows
                          </option>
                          {ds.columns.map((c) => (
                            <option key={c.name} value={c.name} className="bg-surface">
                              {c.name} ({c.type})
                            </option>
                          ))}
                        </NativeSelect>
                        {draft.field2 && draft.field2 !== ROW_FIELD && (
                          <NativeSelect aria-label="Second calculation" className="w-full" value={draft.agg2} onChange={(e) => set({ agg2: e.target.value as Aggregation })}>
                            {(ds.columns.find((c) => c.name === draft.field2)?.type === "number"
                              ? (["sum", "avg", "min", "max", "count", "count_distinct"] as Aggregation[])
                              : (["count", "count_distinct"] as Aggregation[])
                            ).map((a) => (
                              <option key={a} value={a} className="bg-surface">
                                {AGG_LABEL[a]}
                              </option>
                            ))}
                          </NativeSelect>
                        )}
                      </div>
                    </Field>
                  )}
                </div>
              )}

              {step === 3 && ds && (
                draft.kind === "kpi" ? (
                  <p className="text-sm text-muted">Key numbers show one total, so there&apos;s nothing to group by. Use the dashboard&apos;s date and filter bar to slice them.</p>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="cb-group">Group by</FieldLabel>
                      <NativeSelect
 id="cb-group"
                        className="w-full"
                        value={draft.groupBy}
                        onChange={(e) => {
                          const g = e.target.value;
                          const isDate = ds.columns.find((c) => c.name === g)?.type === "date";
                          set({ groupBy: g, chartType: isDate && draft.chartType === "pie" ? "line" : !isDate && (draft.chartType === "line" || draft.chartType === "area") ? "bar" : draft.chartType });
                        }}
                      >
                        <option value="" className="bg-surface">
                          Nothing (one total)
                        </option>
                        {ds.columns
                          .filter((c) => c.type !== "number")
                          .map((c) => (
                            <option key={c.name} value={c.name} className="bg-surface">
                              {c.name} ({c.type === "date" ? "over time" : c.type})
                            </option>
                          ))}
                      </NativeSelect>
                    </Field>
                    {groupIsDate && (
                      <Field>
                        <FieldLabel htmlFor="cb-bucket">Per</FieldLabel>
                        <NativeSelect id="cb-bucket" className="w-full" value={draft.dateBucket} onChange={(e) => set({ dateBucket: e.target.value as DateBucket })}>
                          {BUCKETS.map((b) => (
                            <option key={b} value={b} className="bg-surface">
                              {b[0].toUpperCase() + b.slice(1)}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                    )}
                  </div>
                )
              )}

              {step === 4 && (
                draft.kind === "kpi" ? (
                  <p className="text-sm text-muted">Key numbers show as one big number in the row at the top.</p>
                ) : !draft.groupBy || draft.chartType === "gauge" ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-muted">One total: show it as a number, or as a gauge against a goal.</p>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Single value style">
                      {(
                        [
                          ["bar", "Number", Hash],
                          ["gauge", "Gauge", Gauge],
                        ] as const
                      ).map(([value, label, ValueIcon]) => {
                        const selected = (value === "gauge") === (draft.chartType === "gauge");
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => set({ chartType: value, groupBy: "" })}
                            className={cn(
                              "flex flex-col items-center gap-1.5 rounded-xl border border-line px-2 py-3 text-xs hover:bg-surface-2",
                              selected && "border-primary bg-line/40 font-semibold",
                            )}
                          >
                            <ValueIcon className="size-5 text-highlight" />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Chart type">
                    {CHART_TYPES.filter((t) => (groupIsDate ? t.dates : t.categories)).map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={draft.chartType === value}
                        onClick={() => set({ chartType: value })}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-xl border border-line px-2 py-3 text-xs hover:bg-surface-2",
                          draft.chartType === value && "border-primary bg-line/40 font-semibold",
                        )}
                      >
                        <Icon className="size-5 text-highlight" />
                        {label}
                      </button>
                    ))}
                  </div>
                )
              )}

              {step === 5 && (
                <div className="flex flex-col gap-5">
                  <Field>
                    <FieldLabel htmlFor="cb-title">Title</FieldLabel>
                    <Input
                      id="cb-title"
                      maxLength={200}
                      value={draft.titleTouched ? draft.title : autoTitle(draft, ds)}
                      onChange={(e) => set({ title: e.target.value, titleTouched: true })}
                    />
                  </Field>
                  {draft.kind === "card" && draft.chartType === "gauge" && (
                    <Field>
                      <FieldLabel htmlFor="cb-target">Goal</FieldLabel>
                      <Input id="cb-target" type="number" inputMode="decimal" placeholder="e.g. 300000" value={draft.target} onChange={(e) => set({ target: e.target.value })} />
                      <FieldDescription>The gauge fills up as the value gets closer to this.</FieldDescription>
                    </Field>
                  )}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel id="cb-color-label">Colour</FieldLabel>
                      <div className="flex items-center gap-2">
                        <ColorPicker
                          value={draft.color}
                          onValueChange={(v) => set({ color: v && /^#[0-9a-f]{6}$/i.test(v) ? v : draft.color })}
                          swatches={SWATCHES}
                          aria-labelledby="cb-color-label"
                          placeholder="Brand default"
                          className="flex-1"
                        />
                        {draft.color && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => set({ color: null })}>
                            Reset
                          </Button>
                        )}
                      </div>
                      <FieldDescription>Also handy for colour-coding a report.</FieldDescription>
                    </Field>
                    {draft.kind === "card" && draft.groupBy && (
                      <Field>
                        <FieldLabel htmlFor="cb-sort">Order</FieldLabel>
                        <NativeSelect id="cb-sort" className="w-full" value={draft.sort} onChange={(e) => set({ sort: e.target.value as Draft["sort"] })}>
                          <option value="" className="bg-surface">
                            {groupIsDate ? "Oldest first" : "Biggest first"}
                          </option>
                          <option value="value_desc" className="bg-surface">
                            Biggest first
                          </option>
                          <option value="value_asc" className="bg-surface">
                            Smallest first
                          </option>
                          <option value="label" className="bg-surface">
                            A → Z / oldest first
                          </option>
                        </NativeSelect>
                      </Field>
                    )}
                  </div>
                  {draft.kind === "card" && draft.groupBy && !groupIsDate && (
                    <Field>
                      <FieldLabel htmlFor="cb-limit">Show at most</FieldLabel>
                      <Input id="cb-limit" type="number" min={1} max={1000} placeholder="All groups" value={draft.limit} onChange={(e) => set({ limit: e.target.value })} />
                    </Field>
                  )}
                  <Field>
                    <FieldLabel htmlFor="cb-note">Note for your team</FieldLabel>
                    <Textarea id="cb-note" rows={2} maxLength={500} value={draft.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. Excludes refunds" />
                  </Field>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <SheetFooter className="mt-auto flex-row items-center justify-between border-t border-line">
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
            {step < STEPS.length && (
              <Button type="button" variant="outline" onClick={() => setStep((s) => s + 1)}>
                Next
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {error && <p className="max-w-56 text-right text-[13px] text-accent">{error}</p>}
            <Button
              type="button"
              disabled={!spec || saving || preview.isError}
              onClick={() => spec && draft && onSave({ spec, kind: draft.kind, note: draft.note.trim() || null })}
            >
              {saving ? "Saving…" : chart ? "Save changes" : "Add to dashboard"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
