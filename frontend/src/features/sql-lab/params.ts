/** SQL Lab `{{name}}` parameters. Mirrors backend/app/sql_params.py: values are sent separately and bound, never pasted into the SQL. */

export type ParamType = "text" | "number" | "date";
export type Param = { name: string; type: ParamType; value: string };

export type Table = { table: string; dataset_id: string; dataset_name: string; row_count: number; columns: { name: string; type: string }[] };
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

export function exampleSql(t?: Table) {
  if (!t) return "SELECT 1 AS hello";
  const cat = t.columns.find((c) => c.type === "category" || c.type === "text");
  const num = t.columns.find((c) => c.type === "number");
  if (cat && num)
    return `SELECT ${quoteIdent(cat.name)}, SUM(${quoteIdent(num.name)}) AS total\nFROM ${t.table}\nGROUP BY 1\nORDER BY total DESC\nLIMIT 20`;
  return `SELECT *\nFROM ${t.table}\nLIMIT 100`;
}
