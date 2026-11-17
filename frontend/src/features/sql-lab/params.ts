/** SQL Lab `{{name}}` parameters. Mirrors backend/app/sql_params.py: values are sent separately and bound, never pasted into the SQL. */

export type ParamType = "text" | "number" | "date";
export type Param = { name: string; type: ParamType; value: string };

export type Column = { name: string; type: string; empty_ratio?: number; examples?: string[] };
export type Table = { table: string; dataset_id: string; dataset_name: string; row_count: number; columns: Column[] };
/** A suggested relationship between two datasets (backend/app/joins.py). Percentages only, never values. */
export type JoinHint = {
  left_table: string;
  left_column: string;
  right_table: string;
  right_column: string;
  overlap: number;
  normalized: boolean;
  cardinality: "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
  sql: string;
};
export type Cell = string | number | boolean | null;
export type RunResult = { columns: string[]; rows: Record<string, Cell>[]; row_count: number; truncated: boolean; elapsed_ms: number };
export type Saved = { id: string; name: string; sql: string; params: Param[]; updated_at: string };

const PARAM_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}/g;
/** For CodeMirror decorations and the formatter: the same pattern as a source string. */
export const PARAM_PATTERN = PARAM_RE.source;

/** Placeholder names in order of first use. */
export function paramNames(sql: string): string[] {
  return [...new Set(Array.from(sql.matchAll(PARAM_RE), (m) => m[1]))];
}

/** A first guess at a parameter's type from its name (`since`, `start_date` → date; `min`, `limit` → number). */
export function guessType(name: string): ParamType {
  const n = name.toLowerCase();
  if (/(date|day|since|until|from|to|start|end)$/.test(n) || /^(date|day)/.test(n)) return "date";
  if (/(min|max|limit|count|amount|qty|threshold|top|n)$/.test(n)) return "number";
  return "text";
}

/** Values for exactly the placeholders `sql` uses, keeping what's already been typed. */
export function paramsFor(sql: string, current: Param[]): Param[] {
  const byName = new Map(current.map((p) => [p.name, p]));
  return paramNames(sql).map((name) => byName.get(name) ?? { name, type: guessType(name), value: "" });
}

export const quoteIdent = (s: string) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

/** Number columns that are amounts, not identifiers ("Order ID", "Invoice No", "Zip code"). */
const ID_LIKE = /(^|[^a-z])(id|no|number|num|code|zip|postcode|pin|phone|year)$/i;
const measureOf = (t: Table) => t.columns.find((c) => c.type === "number" && !ID_LIKE.test(c.name.trim()));

export function exampleSql(t?: Table) {
  if (!t) return "SELECT 1 AS hello";
  const cat = t.columns.find((c) => c.type === "category" || c.type === "text");
  const num = measureOf(t);
  if (cat && num)
    return `SELECT ${quoteIdent(cat.name)}, SUM(${quoteIdent(num.name)}) AS total\nFROM ${t.table}\nGROUP BY 1\nORDER BY total DESC\nLIMIT 20`;
  return `SELECT *\nFROM ${t.table}\nLIMIT 100`;
}

/** Three starter queries built from the workspace's own tables, for the first-run card. */
export function sampleQueries(tables: Table[]): { title: string; sql: string }[] {
  const t = tables[0];
  if (!t) return [];
  const out = [{ title: `Look at ${t.table}`, sql: `SELECT *
FROM ${t.table}
LIMIT 100` }];
  const cat = t.columns.find((c) => c.type === "category");
  const num = measureOf(t);
  const date = t.columns.find((c) => c.type === "date");
  if (cat)
    out.push({
      title: `Rows per ${cat.name}`,
      sql: `SELECT ${quoteIdent(cat.name)}, COUNT(*) AS rows
FROM ${t.table}
GROUP BY 1
ORDER BY rows DESC`,
    });
  if (date && num)
    out.push({
      title: `${num.name} by month`,
      sql: `SELECT date_trunc('month', ${quoteIdent(date.name)}) AS month, SUM(${quoteIdent(num.name)}) AS total
FROM ${t.table}
GROUP BY 1
ORDER BY 1`,
    });
  else if (tables[1]) out.push({ title: `Look at ${tables[1].table}`, sql: `SELECT *
FROM ${tables[1].table}
LIMIT 100` });
  return out.slice(0, 3);
}
