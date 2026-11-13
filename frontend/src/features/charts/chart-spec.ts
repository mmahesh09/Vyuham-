import { z } from "zod";

/**
 * The one chart description shared by the chart builder, the backend and the renderer.
 * Mirrors backend/app/schemas.py ChartSpecIn; the backend compiles it to SQL (app/query.py).
 */
export const aggregationSchema = z.enum(["sum", "count", "avg", "min", "max", "count_distinct"]);
export const chartTypeSchema = z.enum(["line", "area", "bar", "hbar", "combo", "scatter", "pie", "funnel", "treemap", "gauge", "kpi", "table"]);
export const dateBucketSchema = z.enum(["day", "week", "month", "quarter", "year"]);

/** `{ field: "*", agg: "count" }` counts rows. */
export const ROW_FIELD = "*";

export const chartSpecSchema = z.object({
  dataset: z.string().min(1),
  metrics: z.array(z.object({ field: z.string().min(1), agg: aggregationSchema })).min(1).max(5),
  groupBy: z.string().optional(),
  dateBucket: dateBucketSchema.optional(),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "contains", "empty", "not_empty"]),
        value: z.unknown(),
      }),
    )
    .default([]),
  chartType: chartTypeSchema,
  title: z.string().min(1).max(200),
  sort: z.enum(["label", "value_desc", "value_asc"]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  /** Main series colour, "#rrggbb". */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  insight: z.string().optional(),
  /** Gauge: the goal the value is measured against. */
  target: z.number().optional(),
  /** Saved from SQL Lab: the query defines the chart; groupBy/metrics name its result columns. */
  sql: z.string().max(10_000).optional(),
  /** SQL charts: values for the query's {{name}} placeholders, fixed when the chart was saved. */
  params: z
    .array(z.object({ name: z.string(), type: z.enum(["text", "number", "date"]), value: z.string() }))
    .max(20)
    .optional(),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type ChartType = z.infer<typeof chartTypeSchema>;
export type Aggregation = z.infer<typeof aggregationSchema>;
export type DateBucket = z.infer<typeof dateBucketSchema>;

/** Rows as returned by a query: one object per row, keyed by column name. */
export type ResultRow = Record<string, string | number | null>;

export const AGG_LABEL: Record<Aggregation, string> = {
  sum: "Total",
  avg: "Average",
  count: "Count",
  count_distinct: "Unique count",
  min: "Lowest",
  max: "Highest",
};

export function metricLabel(m: ChartSpec["metrics"][number]) {
  if (m.field === ROW_FIELD) return "Rows";
  return `${AGG_LABEL[m.agg]} ${m.field}`;
}
