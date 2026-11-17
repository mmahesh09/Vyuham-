/**
 * Builder state → SQL. Pure, no React, so it can be tested on its own (compile.test.ts).
 *
 * Identifiers are always double-quoted (like backend/app/query.py `quote`). Filter values are never written
 * into the SQL: each becomes a `{{p1}}` parameter that the backend binds (app/sql_params.py), with a type
 * taken from the column (number, date or text). The result runs through POST /sql/run like any other query,
 * so the same read-only checks, sandbox and limits apply.
 */

import type { BuilderState, ColRef, Filter, Measure } from "./types.ts";
import { MAX_LIMIT } from "./types.ts";

export type ParamType = "text" | "number" | "date";
export type CompiledParam = { name: string; type: ParamType; value: string };
export type TableInfo = { table: string; columns: { name: string; type: string }[] };
export type Compiled = { sql: string; params: CompiledParam[]; columns: string[]; problems: string[] };

export const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

const AGG_SQL = { sum: "SUM", avg: "AVG", min: "MIN", max: "MAX", count: "COUNT" } as const;
const CMP = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

function colType(tables: TableInfo[], state: BuilderState, ref: ColRef): string | undefined {
  const tableName = ref.side === "a" ? state.from : state.join?.table;
  return tables.find((t) => t.table === tableName)?.columns.find((c) => c.name === ref.column)?.type;
}

/** Output name for a column: plain name, or prefixed with the joined table when both tables have it. */
function columnAlias(state: BuilderState, tables: TableInfo[], ref: ColRef): string {
  if (!state.join || ref.side === "a") return ref.column;
  const main = tables.find((t) => t.table === state.from);
  return main?.columns.some((c) => c.name === ref.column) ? `${state.join.table}_${ref.column}` : ref.column;
}

export function measureAlias(m: Measure): string {
  if (m.agg === "count" && m.column === "*") return "rows";
  return `${m.agg}_${m.column}`;
}

export function compile(state: BuilderState, tables: TableInfo[]): Compiled {
  const problems: string[] = [];
  const params: CompiledParam[] = [];
  const ref = (c: ColRef) => `${c.side}.${q(c.column)}`;
  const addParam = (type: ParamType, value: string) => {
    const name = `p${params.length + 1}`;
    params.push({ name, type, value });
    return `{{${name}}}`;
  };

  if (!tables.some((t) => t.table === state.from)) problems.push("Pick a table to start from.");

  // FROM / JOIN
  let from = `FROM ${q(state.from)} AS a`;
  if (state.join) {
    const j = state.join;
    const on = j.normalized
      ? `lower(trim(CAST(a.${q(j.left)} AS VARCHAR))) = lower(trim(CAST(b.${q(j.right)} AS VARCHAR)))`
      : `a.${q(j.left)} = b.${q(j.right)}`;
    from += `\n${j.kind === "left" ? "LEFT JOIN" : "JOIN"} ${q(j.table)} AS b ON ${on}`;
  }

  // SELECT
  const select: string[] = [];
  const columns: string[] = [];
  let groupCount = 0;
  if (state.mode === "rows") {
    if (state.columns.length === 0) {
      select.push(state.join ? "a.*, b.*" : "*");
    } else {
      for (const c of state.columns) {
        const alias = columnAlias(state, tables, c);
        select.push(alias === c.column ? ref(c) : `${ref(c)} AS ${q(alias)}`);
        columns.push(alias);
      }
    }
  } else {
    for (const g of state.groupBy) {
      const alias = g.bucket ? `${columnAlias(state, tables, g)}_${g.bucket}` : columnAlias(state, tables, g);
      select.push(g.bucket ? `date_trunc('${g.bucket}', ${ref(g)}) AS ${q(alias)}` : alias === g.column ? ref(g) : `${ref(g)} AS ${q(alias)}`);
      columns.push(alias);
      groupCount++;
    }
    for (const m of state.measures) {
      const alias = measureAlias(m);
      let expr: string;
      if (m.agg === "count" && m.column === "*") expr = "COUNT(*)";
      else if (m.agg === "count_distinct") expr = `COUNT(DISTINCT ${ref(m)})`;
      else {
        if ((m.agg === "sum" || m.agg === "avg") && colType(tables, state, m) !== "number")
          problems.push(`${m.agg === "sum" ? "Sum" : "Average"} needs a number column, and “${m.column}” isn't one.`);
        expr = `${AGG_SQL[m.agg]}(${ref(m)})`;
      }
      select.push(`${expr} AS ${q(alias)}`);
      columns.push(alias);
    }
    if (!select.length) problems.push("Add something to group by or a measure.");
  }

  // WHERE
  const where: string[] = [];
  for (const f of state.filters) {
    const clause = filterSql(f, ref(f), (colType(tables, state, f) ?? "text") as string, addParam);
    if (clause) where.push(clause);
    else if (f.op !== "empty" && f.op !== "not_empty") problems.push(`The filter on “${f.column}” needs a value.`);
  }

  const lines = [`SELECT ${select.join(",\n       ") || "*"}`, from];
  if (where.length) lines.push(`WHERE ${where.join("\n  AND ")}`);
  if (state.mode === "summary" && groupCount && state.measures.length)
    lines.push(`GROUP BY ${Array.from({ length: groupCount }, (_, i) => i + 1).join(", ")}`);
  if (state.sort && (columns.includes(state.sort.by) || state.mode === "rows"))
    lines.push(`ORDER BY ${q(state.sort.by)} ${state.sort.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`);
  const limit = Math.max(1, Math.min(Math.floor(state.limit) || 100, MAX_LIMIT));
  lines.push(`LIMIT ${limit}`);

  return { sql: lines.join("\n"), params, columns, problems };
}

function paramType(colType: string): ParamType {
  return colType === "number" ? "number" : colType === "date" ? "date" : "text";
}

function filterSql(f: Filter, col: string, type: string, addParam: (t: ParamType, v: string) => string): string | null {
  const t = paramType(type);
  const v = f.value.trim();
  switch (f.op) {
    case "empty":
      return `${col} IS NULL`;
    case "not_empty":
      return `${col} IS NOT NULL`;
    case "contains":
      return v ? `CAST(${col} AS VARCHAR) ILIKE '%' || ${addParam("text", v)} || '%'` : null;
    case "between": {
      const v2 = (f.value2 ?? "").trim();
      return v && v2 ? `${col} BETWEEN ${addParam(t, v)} AND ${addParam(t, v2)}` : null;
    }
    case "in": {
      const items = v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
      return items.length ? `${col} IN (${items.map((i) => addParam(t, i)).join(", ")})` : null;
    }
    default:
      return v ? `${col} ${CMP[f.op]} ${addParam(t, v)}` : null;
  }
}
