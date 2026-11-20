/**
 * The chart studio's state (Tableau-style shelves) and how it maps to and from a ChartSpec,
 * plus the "Show me" rules that pick a chart type from what is on the shelves.
 *
 * Pure and dependency-free so it runs under Node's test runner (model.test.ts).
 */
import type { ChartSpec } from "../chart-spec.ts";

export type ColumnType = "number" | "date" | "category" | "text";
export type Column = { name: string; type: ColumnType };
export type Aggregation = ChartSpec["metrics"][number]["agg"];
export type DateBucket = NonNullable<ChartSpec["dateBucket"]>;
export type ChartType = ChartSpec["chartType"];
export type SpecFilter = ChartSpec["filters"][number];
export type Shelf = "columns" | "rows" | "color" | "filters";

/** `{ field: "*", agg: "count" }` counts rows, as in chart-spec.ts. */
export const ROW_FIELD = "*";
export const MAX_MEASURES = 5;

/** Something in the Data pane: a column, "Rows" (row count) or an approved metric. */
export type Field =
  | { kind: "column"; key: string; name: string; type: ColumnType }
  | { kind: "rows"; key: string; name: "Rows" }
  | { kind: "metric"; key: string; name: string; metricId: string };

export type Measure = { field: string; agg: Aggregation; label?: string };

export type StudioState = {
  datasetId: string;
  columns: { field: string; bucket: DateBucket } | null;
  rows: Measure[];
  color: string | null;
  filters: SpecFilter[];
  /** Chosen in "Show me"; null follows the recommendation. */
  chartType: ChartType | null;
  /** Columns ⇄ Rows: bars run sideways. */
  swapped: boolean;
  title: string;
  titleTouched: boolean;
  sort: ChartSpec["sort"] | null;
  limit: number | null;
  hex: string | null;
  target: number | null;
};

export const AGG_NAME: Record<Aggregation, string> = {
  sum: "Total",
  avg: "Average",
  count: "Count",
  count_distinct: "Unique",
  min: "Lowest",
  max: "Highest",
  metric: "Metric",
};

export function emptyState(datasetId: string): StudioState {
  return {
    datasetId,
    columns: null,
    rows: [],
    color: null,
    filters: [],
    chartType: null,
    swapped: false,
    title: "",
    titleTouched: false,
    sort: null,
    limit: null,
    hex: null,
    target: null,
  };
}

export function fieldsFor(columns: Column[], metrics: { id: string; name: string }[]): { dimensions: Field[]; measures: Field[] } {
  return {
    dimensions: columns.filter((c) => c.type !== "number").map((c) => ({ kind: "column", key: `col:${c.name}`, name: c.name, type: c.type })),
    measures: [
      ...columns.filter((c) => c.type === "number").map((c): Field => ({ kind: "column", key: `col:${c.name}`, name: c.name, type: c.type })),
      { kind: "rows", key: "rows", name: "Rows" },
      ...metrics.map((m): Field => ({ kind: "metric", key: `metric:${m.id}`, name: m.name, metricId: m.id })),
    ],
  };
}

const typeOf = (columns: Column[], name: string | null | undefined) => columns.find((c) => c.name === name)?.type;

/** Which shelves a field can go on. Dimensions on Rows become a unique count, as in Tableau. */
export function shelvesFor(field: Field): Shelf[] {
  if (field.kind !== "column") return ["rows"];
  if (field.type === "number") return ["rows", "filters"];
  if (field.type === "date") return ["columns", "rows", "filters"];
  return ["columns", "rows", "color", "filters"];
}

/** The measure a field becomes on Rows. */
export function measureFor(field: Field): Measure {
  if (field.kind === "rows") return { field: ROW_FIELD, agg: "count" };
  if (field.kind === "metric") return { field: field.metricId, agg: "metric", label: field.name };
  return field.type === "number" ? { field: field.name, agg: "sum" } : { field: field.name, agg: "count_distinct" };
}

/** Aggregations that make sense for a measure. */
export function aggsFor(m: Measure, columns: Column[]): Aggregation[] {
  if (m.agg === "metric") return ["metric"];
  if (m.field === ROW_FIELD) return ["count"];
  return typeOf(columns, m.field) === "number" ? ["sum", "avg", "min", "max", "count", "count_distinct"] : ["count", "count_distinct"];
}

/** Put a field on a shelf. Returns the state unchanged when the drop isn't allowed. */
export function drop(state: StudioState, field: Field, shelf: Shelf, at?: number): StudioState {
  if (!shelvesFor(field).includes(shelf)) return state;
  if (shelf === "columns" && field.kind === "column") {
    const color = state.color === field.name ? null : state.color;
    return { ...state, columns: { field: field.name, bucket: state.columns?.bucket ?? "month" }, color };
  }
  if (shelf === "color" && field.kind === "column") {
    return state.columns?.field === field.name ? state : { ...state, color: field.name };
  }
  if (shelf === "filters" && field.kind === "column") {
    if (state.filters.some((f) => f.field === field.name)) return state;
    return { ...state, filters: [...state.filters, defaultFilter(field.name, field.type)] };
  }
  const m = measureFor(field);
  if (state.rows.length >= MAX_MEASURES || state.rows.some((r) => r.field === m.field && r.agg === m.agg)) return state;
  const rows = [...state.rows];
  rows.splice(at ?? rows.length, 0, m);
  return { ...state, rows };
}

/** A new filter starts as "not empty", so the chart doesn't change until the person picks values. */
export function defaultFilter(field: string, type: ColumnType): SpecFilter {
  return type === "category" || type === "text" ? { field, op: "in", value: [] } : { field, op: "not_empty", value: null };
}

/** Columns ⇄ Rows: bars turn sideways (and back). */
export function swap(state: StudioState): StudioState {
  const flip: Partial<Record<ChartType, ChartType>> = { bar: "hbar", hbar: "bar" };
  return { ...state, swapped: !state.swapped, chartType: state.chartType ? (flip[state.chartType] ?? state.chartType) : null };
}

export function moveMeasure(state: StudioState, from: number, to: number): StudioState {
  const rows = [...state.rows];
  const [m] = rows.splice(from, 1);
  rows.splice(to, 0, m);
  return { ...state, rows };
}

// ---------- Show me ----------

type Fit = { type: ChartType; ok: boolean; reason?: string };

const ALL_TYPES: ChartType[] = ["line", "area", "bar", "hbar", "combo", "scatter", "pie", "funnel", "treemap", "kpi", "gauge", "table"];

/** For every chart type: can the shelves draw it, and if not, why not (shown on hover). */
export function fits(state: StudioState, columns: Column[]): Fit[] {
  const dim = state.columns?.field;
  const n = state.rows.length;
  const split = !!state.color;
  return ALL_TYPES.map((type): Fit => {
    const need = (ok: boolean, reason: string): Fit => (ok ? { type, ok } : { type, ok, reason });
    if (n === 0) return need(false, "Drag a measure onto Rows first");
    switch (type) {
      case "line":
      case "area":
        return need(!!dim, "Needs a field on Columns");
      case "bar":
      case "hbar":
        return need(!!dim, "Needs a field on Columns");
      case "combo":
        return dim ? (n === 2 ? need(!split, "Can't be split by colour") : need(false, "Needs exactly two measures")) : need(false, "Needs a field on Columns");
      case "scatter":
        return dim ? (n === 2 ? need(!split, "Can't be split by colour") : need(false, "Needs exactly two measures")) : need(false, "Needs a field on Columns");
      case "pie":
      case "funnel":
      case "treemap":
        if (!dim) return need(false, "Needs a field on Columns");
        if (n > 1) return need(false, "Shows one measure only");
        if (typeOf(columns, dim) === "date" && type !== "funnel") return need(false, "Works best with categories, not dates");
        return need(!split, "Can't be split by colour");
      case "kpi":
      case "gauge":
        return dim ? need(false, "Clear Columns to show one number") : need(n === 1, "Shows one measure only");
      case "table":
        return { type, ok: true };
    }
  });
}

/** Tableau's "Show me": the chart that best fits what's on the shelves. */
export function recommend(state: StudioState, columns: Column[]): ChartType | null {
  const dim = state.columns?.field;
  const n = state.rows.length;
  if (n === 0) return null;
  if (!dim) return n === 1 ? "kpi" : "table";
  const isDate = typeOf(columns, dim) === "date";
  if (state.color) return n === 1 ? (isDate ? "line" : state.swapped ? "hbar" : "bar") : "table";
  if (n === 1) return isDate ? "line" : state.swapped ? "hbar" : "bar";
  if (n === 2) return "combo";
  return "table";
}

/** The chart type that will be drawn: the person's pick if it still fits, else the recommendation. */
export function effectiveType(state: StudioState, columns: Column[]): ChartType | null {
  if (state.chartType && fits(state, columns).find((f) => f.type === state.chartType)?.ok) return state.chartType;
  return recommend(state, columns);
}

// ---------- to and from ChartSpec ----------

function measureName(m: Measure) {
  if (m.agg === "metric") return m.label ?? "Metric";
  return m.field === ROW_FIELD ? "Rows" : `${AGG_NAME[m.agg]} ${m.field}`;
}

export function autoTitle(state: StudioState, columns: Column[]): string {
  if (!state.rows.length) return "New chart";
  const what = state.rows.map(measureName).join(" and ");
  const dim = state.columns?.field;
  if (!dim) return what;
  const by = typeOf(columns, dim) === "date" ? `${what} over time` : `${what} by ${dim}`;
  return state.color ? `${by}, split by ${state.color}` : by;
}

const SPLITTABLE = new Set<ChartType>(["line", "area", "bar", "hbar", "table"]);

export function toSpec(state: StudioState, columns: Column[]): ChartSpec | null {
  const chartType = effectiveType(state, columns);
  if (!state.datasetId || !chartType || !state.rows.length) return null;
  const dim = chartType === "kpi" || chartType === "gauge" ? undefined : state.columns?.field;
  const isDate = typeOf(columns, dim) === "date";
  const seriesBy = dim && state.color && SPLITTABLE.has(chartType) ? state.color : undefined;
  const measures = chartType === "combo" || chartType === "scatter" || chartType === "table" ? state.rows : state.rows.slice(0, 1);
  // A filter without values yet ("is one of" nothing) doesn't narrow anything, so it isn't sent.
  const filters = state.filters.filter((f) => !(f.op === "in" && Array.isArray(f.value) && f.value.length === 0));
  return {
    dataset: state.datasetId,
    metrics: measures.map((m) => ({ field: m.field, agg: m.agg, ...(m.label ? { label: m.label } : {}) })),
    groupBy: dim,
    seriesBy,
    dateBucket: dim && isDate ? state.columns!.bucket : undefined,
    filters,
    chartType,
    title: (state.titleTouched ? state.title : autoTitle(state, columns)).trim() || autoTitle(state, columns),
    sort: dim && state.sort ? state.sort : undefined,
    limit: dim && state.limit ? Math.max(1, Math.min(1000, state.limit)) : undefined,
    color: state.hex ?? undefined,
    target: chartType === "gauge" && state.target !== null ? state.target : undefined,
  };
}

/** Open an existing chart in the studio. */
export function fromSpec(spec: ChartSpec): StudioState {
  return {
    datasetId: spec.dataset,
    columns: spec.groupBy ? { field: spec.groupBy, bucket: spec.dateBucket ?? "month" } : null,
    rows: spec.metrics.map((m) => ({ field: m.field, agg: m.agg, ...(m.label ? { label: m.label } : {}) })),
    color: spec.seriesBy ?? null,
    filters: spec.filters ?? [],
    chartType: spec.chartType,
    swapped: spec.chartType === "hbar",
    title: spec.title,
    titleTouched: true,
    sort: spec.sort ?? null,
    limit: spec.limit ?? null,
    hex: spec.color ?? null,
    target: spec.target ?? null,
  };
}
