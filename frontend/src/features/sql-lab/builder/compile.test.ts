// Run with: npm run test:unit   (Node's built-in test runner; Node 23 runs TypeScript directly)
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import type { BuilderState } from "./types.ts";

const TABLES = [
  {
    table: "orders",
    columns: [
      { name: "Order ID", type: "number" },
      { name: "Customer", type: "category" },
      { name: "Amount", type: "number" },
      { name: "Ordered", type: "date" },
      { name: "Region", type: "category" },
    ],
  },
  { table: "customers", columns: [{ name: "company_name", type: "text" }, { name: "Region", type: "category" }, { name: "Tier", type: "category" }] },
];

const base = (patch: Partial<BuilderState> = {}): BuilderState => ({
  version: 1,
  from: "orders",
  join: null,
  mode: "summary",
  columns: [],
  groupBy: [],
  measures: [],
  filters: [],
  sort: null,
  limit: 100,
  ...patch,
});

test("rows mode with no columns selects everything", () => {
  const c = compile(base({ mode: "rows" }), TABLES);
  assert.equal(c.sql, 'SELECT *\nFROM "orders" AS a\nLIMIT 100');
  assert.deepEqual(c.params, []);
  assert.deepEqual(c.problems, []);
});

test("summary groups by bucketed dates and quotes every identifier", () => {
  const c = compile(
    base({
      groupBy: [{ side: "a", column: "Ordered", bucket: "month" }],
      measures: [{ side: "a", column: "Amount", agg: "sum" }, { side: "a", column: "*", agg: "count" }],
      sort: { by: "Ordered_month", dir: "asc" },
    }),
    TABLES,
  );
  assert.equal(
    c.sql,
    [
      `SELECT date_trunc('month', a."Ordered") AS "Ordered_month",`,
      `       SUM(a."Amount") AS "sum_Amount",`,
      `       COUNT(*) AS "rows"`,
      `FROM "orders" AS a`,
      `GROUP BY 1`,
      `ORDER BY "Ordered_month" ASC NULLS LAST`,
      `LIMIT 100`,
    ].join("\n"),
  );
  assert.deepEqual(c.columns, ["Ordered_month", "sum_Amount", "rows"]);
});

test("filter values become typed parameters, never SQL text", () => {
  const evil = "x' OR '1'='1";
  const c = compile(
    base({
      mode: "rows",
      filters: [
        { side: "a", column: "Customer", op: "eq", value: evil },
        { side: "a", column: "Amount", op: "between", value: "10", value2: "500" },
        { side: "a", column: "Ordered", op: "gte", value: "2026-01-01" },
        { side: "a", column: "Region", op: "in", value: "North, West" },
        { side: "a", column: "Customer", op: "contains", value: "co" },
        { side: "a", column: "Region", op: "empty", value: "" },
      ],
    }),
    TABLES,
  );
  assert.ok(!c.sql.includes(evil));
  assert.match(c.sql, /a\."Customer" = \{\{p1\}\}/);
  assert.match(c.sql, /a\."Amount" BETWEEN \{\{p2\}\} AND \{\{p3\}\}/);
  assert.match(c.sql, /a\."Ordered" >= \{\{p4\}\}/);
  assert.match(c.sql, /a\."Region" IN \(\{\{p5\}\}, \{\{p6\}\}\)/);
  assert.match(c.sql, /CAST\(a\."Customer" AS VARCHAR\) ILIKE '%' \|\| \{\{p7\}\} \|\| '%'/);
  assert.match(c.sql, /a\."Region" IS NULL/);
  assert.deepEqual(
    c.params.map((p) => [p.name, p.type, p.value]),
    [
      ["p1", "text", evil],
      ["p2", "number", "10"],
      ["p3", "number", "500"],
      ["p4", "date", "2026-01-01"],
      ["p5", "text", "North"],
      ["p6", "text", "West"],
      ["p7", "text", "co"],
    ],
  );
});

test("joins use aliases, prefix clashing columns and support case-insensitive matching", () => {
  const c = compile(
    base({
      join: { table: "customers", left: "Customer", right: "company_name", kind: "left", normalized: true },
      groupBy: [{ side: "b", column: "Region" }, { side: "b", column: "Tier" }],
      measures: [{ side: "a", column: "Amount", agg: "sum" }],
    }),
    TABLES,
  );
  assert.match(c.sql, /LEFT JOIN "customers" AS b ON lower\(trim\(CAST\(a\."Customer" AS VARCHAR\)\)\) = lower\(trim\(CAST\(b\."company_name" AS VARCHAR\)\)\)/);
  assert.match(c.sql, /b\."Region" AS "customers_Region"/); // both tables have Region
  assert.match(c.sql, /b\."Tier",/);
  assert.match(c.sql, /GROUP BY 1, 2/);
  assert.deepEqual(c.columns, ["customers_Region", "Tier", "sum_Amount"]);
});

test("problems are reported instead of producing broken SQL silently", () => {
  assert.ok(compile(base({ measures: [{ side: "a", column: "Customer", agg: "sum" }] }), TABLES).problems[0].includes("number column"));
  assert.ok(compile(base({ mode: "rows", filters: [{ side: "a", column: "Amount", op: "gt", value: " " }] }), TABLES).problems[0].includes("needs a value"));
  assert.ok(compile(base({ from: "missing" }), TABLES).problems[0].includes("Pick a table"));
  assert.ok(compile(base(), TABLES).problems.some((p) => p.includes("group by or a measure")));
});

test("the limit is clamped", () => {
  assert.match(compile(base({ mode: "rows", limit: 999999 }), TABLES).sql, /LIMIT 5000$/);
  assert.match(compile(base({ mode: "rows", limit: 0 }), TABLES).sql, /LIMIT 100$/);
});
