import { isValid, parse, parseISO } from "date-fns";

import type { ColumnProfile, ColumnType, DataRow } from "./types";

const SAMPLE = 500;
const NUMBER_RE = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/;
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

export function profileColumns(columns: string[], rows: DataRow[]): ColumnProfile[] {
  return columns.map((name) => {
    const nonEmpty: string[] = [];
    for (const row of rows) {
      const v = row[name];
      if (v !== undefined && v.trim() !== "") nonEmpty.push(v);
    }
    const sample = nonEmpty.slice(0, SAMPLE);
    const examples = [...new Set(sample)].slice(0, 3);
    return {
      name,
      type: inferType(sample, nonEmpty.length),
      emptyRatio: rows.length ? 1 - nonEmpty.length / rows.length : 0,
      examples,
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
