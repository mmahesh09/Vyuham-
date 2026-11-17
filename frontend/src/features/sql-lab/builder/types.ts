/** The visual query builder's state. Saved with a query (saved_queries.builder_state) so it reopens in Builder. */

export type BuilderAgg = "sum" | "avg" | "min" | "max" | "count" | "count_distinct";
export type Bucket = "day" | "week" | "month" | "quarter" | "year";
export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between" | "in" | "contains" | "empty" | "not_empty";
/** "a" is the main table, "b" the joined one. */
export type Side = "a" | "b";
export type ColRef = { side: Side; column: string };

export type BuilderJoin = { table: string; left: string; right: string; kind: "inner" | "left"; normalized?: boolean };
export type GroupByItem = ColRef & { bucket?: Bucket };
/** `column: "*"` with agg "count" counts rows. */
export type Measure = ColRef & { agg: BuilderAgg };
export type Filter = ColRef & { op: FilterOp; value: string; value2?: string };

export type BuilderState = {
  version: 1;
  from: string;
  join: BuilderJoin | null;
  mode: "rows" | "summary";
  /** Rows mode: the columns to show; empty means every column. */
  columns: ColRef[];
  groupBy: GroupByItem[];
  measures: Measure[];
  filters: Filter[];
  sort: { by: string; dir: "asc" | "desc" } | null;
  limit: number;
};

export const MAX_LIMIT = 5000;

export function emptyBuilder(from: string): BuilderState {
  return { version: 1, from, join: null, mode: "summary", columns: [], groupBy: [], measures: [{ side: "a", column: "*", agg: "count" }], filters: [], sort: null, limit: 500 };
}

export const AGG_LABEL: Record<BuilderAgg, string> = {
  sum: "Sum of",
  avg: "Average of",
  min: "Smallest",
  max: "Largest",
  count: "Count of",
  count_distinct: "Number of different",
};

export const OP_LABEL: Record<FilterOp, string> = {
  eq: "is",
  neq: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  in: "is one of",
  contains: "contains",
  empty: "is empty",
  not_empty: "is not empty",
};
