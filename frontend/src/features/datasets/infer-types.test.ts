// Run with: npm run test:unit   (Node's built-in test runner; Node 23 runs TypeScript directly)
// The upload preview must predict the same types the backend saves (backend/tests/test_ingest_messy.py).
import assert from "node:assert/strict";
import { test } from "node:test";

import { profileColumns } from "./infer-types.ts";

const rows = (header: string[], ...data: string[][]) => data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
const typeOf = (cols: ReturnType<typeof profileColumns>, name: string) => cols.find((c) => c.name === name)?.type;

test("a messy export: rupees, a placeholder and a trailing Total row", () => {
  const header = ["Invoice Date", "Amount"];
  const cols = profileColumns(
    header,
    rows(header, ["05/01/2026", "₹1,200"], ["20/01/2026", "₹950.50"], ["03/02/2026", "n/a"], ["15/03/2026", "(200)"], ["Total", "1,950.50"]),
  );
  assert.equal(typeOf(cols, "Invoice Date"), "date");
  assert.equal(typeOf(cols, "Amount"), "number");
  assert.equal(cols[1].emptyRatio, 1 / 4); // the n/a counts as empty; the Total row isn't a row
});

test("Indian lakh and crore grouping are numbers; bad grouping is not", () => {
  assert.equal(typeOf(profileColumns(["A"], rows(["A"], ["₹1,20,000"], ["12,34,56,789"], ["1,200,000"])), "A"), "number");
  assert.equal(typeOf(profileColumns(["A"], rows(["A"], ["1,2,3"], ["12,3456"])), "A"), "text");
});

test("mostly placeholders stay text, and text columns keep them", () => {
  assert.equal(typeOf(profileColumns(["A"], rows(["A"], ["-"], ["-"], ["5"])), "A"), "text");
  const cols = profileColumns(["Region"], rows(["Region"], ["North"], ["-"], ["n/a"]));
  assert.equal(typeOf(cols, "Region"), "text");
  assert.deepEqual(cols[0].examples, ["North", "-", "n/a"]);
});

test("only trailing summary rows are left out", () => {
  const header = ["Item", "Amount"];
  const cols = profileColumns(header, rows(header, ["Total Gym", "100"], ["Rowing", "50"], ["Subtotal", "150"], ["GRAND TOTAL:", "150"]));
  assert.deepEqual(cols[0].examples, ["Total Gym", "Rowing"]);
});
