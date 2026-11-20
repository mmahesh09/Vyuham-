// Run with: npm run test:unit   (Node's built-in test runner; Node 23 runs TypeScript directly)
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChartSpec } from "../chart-spec.ts";
import { drop, effectiveType, emptyState, fieldsFor, fits, fromSpec, moveMeasure, recommend, swap, toSpec, type Column, type Field } from "./model.ts";

const COLUMNS: Column[] = [
  { name: "Ordered", type: "date" },
  { name: "Region", type: "category" },
  { name: "Customer", type: "text" },
  { name: "Amount", type: "number" },
];
const { dimensions, measures } = fieldsFor(COLUMNS, [{ id: "m1", name: "MRR" }]);
const field = (name: string): Field => [...dimensions, ...measures].find((f) => f.name === name)!;

function build(...steps: [string, "columns" | "rows" | "color" | "filters"][]) {
  return steps.reduce((s, [name, shelf]) => drop(s, field(name), shelf), emptyState("ds1"));
}

test("fields are grouped like Tableau: dimensions, then measures with Rows and approved metrics", () => {
  assert.deepEqual(dimensions.map((f) => f.name), ["Ordered", "Region", "Customer"]);
  assert.deepEqual(measures.map((f) => f.name), ["Amount", "Rows", "MRR"]);
});

test("drops follow the shelf rules", () => {
  let s = build(["Amount", "columns"]);
  assert.equal(s.columns, null, "a number can't go on Columns");
  s = build(["Ordered", "color"]);
  assert.equal(s.color, null, "a date can't split by colour");
  s = build(["Region", "rows"]);
  assert.deepEqual(s.rows, [{ field: "Region", agg: "count_distinct" }], "a dimension on Rows becomes a unique count");
  s = build(["MRR", "rows"], ["Rows", "rows"]);
  assert.deepEqual(s.rows, [{ field: "m1", agg: "metric", label: "MRR" }, { field: "*", agg: "count" }]);
  s = build(["Amount", "rows"], ["Amount", "rows"]);
  assert.equal(s.rows.length, 1, "the same measure isn't added twice");
});

test("putting the Colour field on Columns clears Colour; Colour can't repeat Columns", () => {
  let s = build(["Region", "color"], ["Region", "columns"]);
  assert.equal(s.color, null);
  s = build(["Region", "columns"], ["Region", "color"]);
  assert.equal(s.color, null);
});

test("Show me recommends a chart from the shelves", () => {
  assert.equal(recommend(build(), COLUMNS), null);
  assert.equal(recommend(build(["Amount", "rows"]), COLUMNS), "kpi");
  assert.equal(recommend(build(["Ordered", "columns"], ["Amount", "rows"]), COLUMNS), "line");
  assert.equal(recommend(build(["Region", "columns"], ["Amount", "rows"]), COLUMNS), "bar");
  assert.equal(recommend(swap(build(["Region", "columns"], ["Amount", "rows"])), COLUMNS), "hbar");
  assert.equal(recommend(build(["Region", "columns"], ["Amount", "rows"], ["Rows", "rows"]), COLUMNS), "combo");
  assert.equal(recommend(build(["Ordered", "columns"], ["Amount", "rows"], ["Region", "color"]), COLUMNS), "line");
  assert.equal(recommend(build(["Region", "columns"], ["Amount", "rows"], ["Rows", "rows"], ["MRR", "rows"]), COLUMNS), "table");
});

test("chart types that don't fit say why, and a pick that stops fitting falls back", () => {
  const s = build(["Region", "columns"], ["Amount", "rows"], ["Customer", "color"]);
  const byType = Object.fromEntries(fits(s, COLUMNS).map((f) => [f.type, f]));
  assert.equal(byType.pie.ok, false);
  assert.match(byType.pie.reason!, /colour/);
  assert.equal(byType.kpi.reason, "Clear Columns to show one number");
  assert.equal(effectiveType({ ...s, chartType: "pie" }, COLUMNS), "bar");
  assert.equal(effectiveType({ ...s, chartType: "table" }, COLUMNS), "table");
});

test("the spec carries the split, the date bucket and only filters that narrow something", () => {
  let s = build(["Ordered", "columns"], ["Amount", "rows"], ["Region", "color"], ["Customer", "filters"], ["Amount", "filters"]);
  s = { ...s, columns: { field: "Ordered", bucket: "quarter" } };
  const spec = toSpec(s, COLUMNS)!;
  assert.equal(spec.chartType, "line");
  assert.equal(spec.groupBy, "Ordered");
  assert.equal(spec.seriesBy, "Region");
  assert.equal(spec.dateBucket, "quarter");
  assert.deepEqual(spec.filters, [{ field: "Amount", op: "not_empty", value: null }], "an empty 'is one of' isn't sent");
  assert.equal(spec.title, "Total Amount over time, split by Region");
});

test("charts that show one measure send one; combo and table send all", () => {
  const two = build(["Region", "columns"], ["Amount", "rows"], ["Rows", "rows"]);
  assert.equal(toSpec({ ...two, chartType: "bar" }, COLUMNS)!.metrics.length, 1);
  assert.equal(toSpec(two, COLUMNS)!.metrics.length, 2);
  assert.equal(toSpec({ ...two, chartType: "table" }, COLUMNS)!.metrics.length, 2);
});

test("reordering measures changes which one leads", () => {
  const s = moveMeasure(build(["Region", "columns"], ["Amount", "rows"], ["Rows", "rows"]), 1, 0);
  assert.deepEqual(s.rows.map((m) => m.field), ["*", "Amount"]);
});

test("every kind of saved chart opens in the studio and saves back unchanged", () => {
  const specs: ChartSpec[] = [
    { dataset: "ds1", metrics: [{ field: "Amount", agg: "sum" }], groupBy: "Ordered", dateBucket: "month", filters: [], chartType: "area", title: "Revenue", color: "#ff0000" },
    { dataset: "ds1", metrics: [{ field: "Amount", agg: "avg" }], groupBy: "Region", filters: [{ field: "Region", op: "in", value: ["North"] }], chartType: "hbar", title: "Avg", sort: "value_desc", limit: 10 },
    { dataset: "ds1", metrics: [{ field: "Amount", agg: "sum" }, { field: "*", agg: "count" }], groupBy: "Region", filters: [], chartType: "combo", title: "Combo" },
    { dataset: "ds1", metrics: [{ field: "Amount", agg: "sum" }], filters: [], chartType: "kpi", title: "Total" },
    { dataset: "ds1", metrics: [{ field: "Amount", agg: "sum" }], filters: [], chartType: "gauge", title: "Goal", target: 5000 },
    { dataset: "ds1", metrics: [{ field: "Amount", agg: "sum" }], groupBy: "Region", filters: [], chartType: "pie", title: "Share" },
    { dataset: "ds1", metrics: [{ field: "m1", agg: "metric", label: "MRR" }], groupBy: "Ordered", dateBucket: "year", seriesBy: "Region", filters: [], chartType: "bar", title: "MRR split" },
  ];
  const strip = (o: object) => JSON.parse(JSON.stringify(o));
  for (const spec of specs) assert.deepEqual(strip(toSpec(fromSpec(spec), COLUMNS)!), strip(spec), spec.title);
});
