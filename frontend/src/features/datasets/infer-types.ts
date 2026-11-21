import { isValid, parse, parseISO } from "date-fns";

import type { ColumnProfile, ColumnType, DataRow } from "./types";

const SAMPLE = 500;
// Mirrors backend/app/ingest.py: thousands grouping (1,200,000) or Indian lakh/crore grouping (12,00,000).
const NUMBER_RE = /^[-+]?(\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})+,\d{3}|\d+)?(\.\d+)?$/;
// Cells meaning "no value": in number and date columns they count as empty (same list as the backend).
const PLACEHOLDERS = new Set(["n/a", "na", "n.a.", "-", "--", "—", "–", "null", "none", "nil", "nan", "#n/a", "#value!", "#ref!", "#div/0!", "#num!"]);
// A whole cell labelling a summary row at the end of a file: "Total", "Grand total", "Subtotal:".
const TOTAL_LABEL_RE = /^(grand\s+|sub-?\s*)?totals?\s*:?$/i;
const MAX_TOTAL_ROWS = 3;
const isPlaceholder = (v: string) => PLACEHOLDERS.has(v.trim().toLowerCase());
const DATE_FORMATS = ["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "dd-MM-yyyy", "d MMM yyyy", "MMM d, yyyy", "dd.MM.yyyy", "yyyy/MM/dd"];
const REF = new Date(2000, 0, 1);

/** "$1,240.50", "12%", "(300)" → numeric-looking string, or null. */
function normaliseNumber(v: string): string | null {
  let s = v.trim().replace(/^[$€£₹¥]/, "").replace(/%$/, "").replace(/\s/g, "");
  if (/^\(.*\)$/.test(s)) s = `-${s.slice(1, -1)}`;
  return s !== "" && NUMBER_RE.test(s) && /\d/.test(s) ? s : null;
}

function looksLikeDate(v: string): boolean {
  const s = v.trim();
  if (!/\d/.test(s) || s.length < 6 || s.length > 30) return false;
  if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s)) return isValid(parseISO(s));
  return DATE_FORMATS.some((f) => isValid(parse(s, f, REF)));
}

function inferType(values: string[], totalNonEmpty: number): ColumnType {
  if (values.length === 0) return "text";
  if (values.every((v) => normaliseNumber(v) !== null)) return "number";
  if (values.every(looksLikeDate)) return "date";
  const distinct = new Set(values.map((v) => v.trim().toLowerCase())).size;
  // Few distinct values relative to rows (status, region, product) → category.
  if (totalNonEmpty >= 10 && (distinct <= 20 || distinct / values.length <= 0.2)) return "category";
  return "text";
}

/** Summary rows at the very end of a file ("Total") aren't data; the backend leaves them out too. */
function withoutTotalRows(columns: string[], rows: DataRow[]): DataRow[] {
  let end = rows.length;
  while (end > 1 && rows.length - end < MAX_TOTAL_ROWS) {
    const row = rows[end - 1];
    const first = columns.map((c) => row[c]?.trim() ?? "").find((v) => v !== "");
    if (!first || !TOTAL_LABEL_RE.test(first)) break;
    end -= 1;
  }
  return end === rows.length ? rows : rows.slice(0, end);
}

export function profileColumns(columns: string[], allRows: DataRow[]): ColumnProfile[] {
  const rows = withoutTotalRows(columns, allRows);
  return columns.map((name) => {
    const nonEmpty: string[] = [];
    for (const row of rows) {
      const v = row[name];
      if (v !== undefined && v.trim() !== "") nonEmpty.push(v);
    }
    let values = nonEmpty;
    let type = inferType(values.slice(0, SAMPLE), values.length);
    // One "n/a" or "-" doesn't stop a column of numbers or dates being one (same rule as the backend).
    if (type !== "number" && type !== "date") {
      const real = nonEmpty.filter((v) => !isPlaceholder(v));
      const placeholders = nonEmpty.length - real.length;
      if (placeholders && real.length >= placeholders) {
        const relaxed = inferType(real.slice(0, SAMPLE), real.length);
        if (relaxed === "number" || relaxed === "date") [values, type] = [real, relaxed];
      }
    }
    return {
      name,
      type,
      emptyRatio: rows.length ? 1 - values.length / rows.length : 0,
      examples: [...new Set(values.slice(0, SAMPLE))].slice(0, 3),
    };
  });
}

/** Blank headers become "Column 3"; repeated headers get " (2)", " (3)". */
export function cleanHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = String(h ?? "").trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}
