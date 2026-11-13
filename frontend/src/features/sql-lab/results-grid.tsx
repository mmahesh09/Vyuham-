"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Check, ClipboardCopy, Download } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Cell, RunResult } from "./params";

const ROW_HEIGHT = 32;
const MIN_W = 64;
const MAX_W = 900;

type Sort = { col: string; dir: "asc" | "desc" } | null;
type Kind = "number" | "date" | "boolean" | "text";

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?/;

function kindOf(values: Cell[]): Kind {
  const present = values.filter((v) => v !== null);
  if (!present.length) return "text";
  if (present.every((v) => typeof v === "number")) return "number";
  if (present.every((v) => typeof v === "boolean")) return "boolean";
  if (present.every((v) => typeof v === "string" && DATE_RE.test(v))) return "date";
  return "text";
}

function compare(a: Cell, b: Cell): number {
  if (a === b) return 0;
  if (a === null) return 1; // nulls last either way (flipped back below)
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

const fmt = (v: Cell) => (v === null ? "" : typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(v));

function defaultWidth(col: string, values: Cell[]): number {
  const longest = Math.max(col.length + 3, ...values.slice(0, 200).map((v) => fmt(v).length));
  return Math.min(360, Math.max(MIN_W + 16, longest * 7.6 + 28));
}

function delimited(columns: string[], rows: Record<string, Cell>[], sep: "," | "\t"): string {
  const esc = (v: Cell) => {
    const s = v === null ? "" : String(v);
    if (sep === "\t") return s.replace(/[\t\r\n]+/g, " ");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(sep), ...rows.map((r) => columns.map((c) => esc(r[c])).join(sep))].join("\n");
}

/** Sortable, resizable, virtualized result grid with a per-column stats view and copy/download. */
export function ResultsGrid({ result, view }: { result: RunResult; view: "rows" | "stats" }) {
  const { columns, rows } = result;
  const [sort, setSort] = useState<Sort>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const kinds = useMemo(() => Object.fromEntries(columns.map((c) => [c, kindOf(rows.map((r) => r[c]))])) as Record<string, Kind>, [columns, rows]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.col];
      const y = b[sort.col];
      if (x === null || y === null) return compare(x, y); // keep nulls at the bottom
      return compare(x, y) * mul;
    });
  }, [rows, sort]);

  const widthOf = (c: string) => widths[c] ?? defaultWidth(c, rows.map((r) => r[c]));
  const template = `56px ${columns.map((c) => `${widthOf(c)}px`).join(" ")}`;
  const totalWidth = 56 + columns.reduce((a, c) => a + widthOf(c), 0);

  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: sorted.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_HEIGHT, overscan: 12 });

  const toggleSort = (col: string) =>
    setSort((s) => (s?.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null));

  const startResize = (col: string, e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(col);
    const move = (ev: globalThis.PointerEvent) =>
      setWidths((w) => ({ ...w, [col]: Math.min(MAX_W, Math.max(MIN_W, startW + ev.clientX - startX)) }));
    const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const keyResize = (col: string, e: KeyboardEvent<HTMLSpanElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setWidths((w) => ({ ...w, [col]: Math.min(MAX_W, Math.max(MIN_W, widthOf(col) + (e.key === "ArrowRight" ? step : -step))) }));
  };

  if (!columns.length) return <p className="rounded-[16px] border border-line px-3 py-8 text-center text-sm text-faint">The query returned no columns.</p>;
  if (view === "stats") return <ColumnStats columns={columns} rows={rows} kinds={kinds} />;

  return (
    <div
      ref={scroller}
      className="relative h-[min(520px,60vh)] overflow-auto rounded-[16px] border border-line"
      role="table"
      aria-label="Query results"
      aria-rowcount={sorted.length + 1}
    >
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        <div role="row" className="sticky top-0 z-10 grid border-b border-line bg-surface-2 text-[12px] text-muted" style={{ gridTemplateColumns: template }}>
          <span role="columnheader" className="px-3 py-2 text-right text-faint">
            #
          </span>
          {columns.map((c) => {
            const dir = sort?.col === c ? sort.dir : null;
            return (
              <span
                key={c}
                role="columnheader"
                aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                className="relative flex min-w-0 items-center"
              >
                <button
                  type="button"
                  onClick={() => toggleSort(c)}
                  className={cn("flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left font-medium hover:text-text", kinds[c] === "number" && "justify-end")}
                  title={`Sort by ${c}`}
                >
                  <span className="truncate">{c}</span>
                  {dir === "asc" ? <ArrowUp className="size-3 shrink-0 text-highlight" /> : dir === "desc" ? <ArrowDown className="size-3 shrink-0 text-highlight" /> : null}
                </button>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${c}`}
                  aria-valuenow={Math.round(widthOf(c))}
                  aria-valuemin={MIN_W}
                  aria-valuemax={MAX_W}
                  tabIndex={0}
                  onPointerDown={(e) => startResize(c, e)}
                  onKeyDown={(e) => keyResize(c, e)}
                  onDoubleClick={() => setWidths((w) => ({ ...w, [c]: defaultWidth(c, rows.map((r) => r[c])) }))}
                  className="absolute right-0 top-1 bottom-1 w-2 cursor-col-resize touch-none border-r border-line hover:border-highlight focus-visible:border-highlight focus-visible:outline-none"
                />
              </span>
            );
          })}
        </div>

        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((vr) => {
            const r = sorted[vr.index];
            return (
              <div
                key={vr.key}
                role="row"
                aria-rowindex={vr.index + 2}
                className="absolute left-0 grid w-full border-b border-line/60 text-[13px] hover:bg-surface-2/60"
                style={{ height: ROW_HEIGHT, transform: `translateY(${vr.start}px)`, gridTemplateColumns: template }}
              >
                <span role="cell" className="px-3 py-1.5 text-right text-[11px] tabular-nums text-faint">
                  {vr.index + 1}
                </span>
                {columns.map((c) => {
                  const v = r[c];
                  return (
                    <span
                      key={c}
                      role="cell"
                      title={v === null ? "null" : String(v)}
                      className={cn("truncate px-3 py-1.5", (kinds[c] === "number" || typeof v === "number") && "text-right tabular-nums")}
                    >
                      {v === null ? <span className="text-faint">null</span> : fmt(v)}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
        {!sorted.length && <p className="px-3 py-8 text-center text-sm text-faint">No rows.</p>}
      </div>
    </div>
  );
}

/** Copy the returned rows as TSV (pastes into spreadsheets) or CSV, or download them as a CSV file. */
export function ResultActions({ result, name }: { result: RunResult; name: string }) {
  const [copied, setCopied] = useState<"csv" | "tsv" | null>(null);
  const copy = async (sep: "," | "\t") => {
    try {
      await navigator.clipboard.writeText(delimited(result.columns, result.rows, sep));
      setCopied(sep === "," ? "csv" : "tsv");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const download = () => {
    const blob = new Blob(["﻿" + delimited(result.columns, result.rows, ",")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `${name.replace(/[^\w.-]+/g, "_") || "query"}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => copy("\t")} title="Copy as tab-separated (pastes into spreadsheets)">
        {copied === "tsv" ? <Check /> : <ClipboardCopy />} Copy
      </Button>
      <Button variant="ghost" size="sm" onClick={() => copy(",")} title="Copy as CSV">
        {copied === "csv" ? <Check /> : <ClipboardCopy />} CSV
      </Button>
      <Button variant="ghost" size="sm" onClick={download} title="Download these rows as CSV">
        <Download /> Download
      </Button>
    </div>
  );
}

/* ---------- stats ---------- */

type Stat = { col: string; kind: Kind; filled: number; nulls: number; distinct: number; min: Cell; max: Cell; avg: number | null; top: [string, number] | null };

function stats(columns: string[], rows: Record<string, Cell>[], kinds: Record<string, Kind>): Stat[] {
  return columns.map((col) => {
    const counts = new Map<string, number>();
    let nulls = 0;
    let sum = 0;
    let min: Cell = null;
    let max: Cell = null;
    for (const r of rows) {
      const v = r[col];
      if (v === null) {
        nulls++;
        continue;
      }
      const k = String(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (typeof v === "number") sum += v;
      if (min === null || compare(v, min) < 0) min = v;
      if (max === null || compare(v, max) > 0) max = v;
    }
    const filled = rows.length - nulls;
    let top: [string, number] | null = null;
    for (const e of counts) if (!top || e[1] > top[1]) top = e;
    return { col, kind: kinds[col], filled, nulls, distinct: counts.size, min, max, avg: kinds[col] === "number" && filled ? sum / filled : null, top };
  });
}

function ColumnStats({ columns, rows, kinds }: { columns: string[]; rows: Record<string, Cell>[]; kinds: Record<string, Kind> }) {
  const data = useMemo(() => stats(columns, rows, kinds), [columns, rows, kinds]);
  const n = rows.length || 1;
  return (
    <div className="max-h-[min(520px,60vh)] overflow-auto rounded-[16px] border border-line">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">Statistics for each result column</caption>
        <thead className="sticky top-0 bg-surface-2 text-[12px] text-muted">
          <tr>
            {["Column", "Type", "Filled", "Empty", "Distinct", "Min", "Max", "Average", "Most common"].map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((s) => (
            <tr key={s.col}>
              <th scope="row" className="max-w-[24ch] truncate px-3 py-2 font-mono text-[12px] font-normal">
                {s.col}
              </th>
              <td className="px-3 py-2 text-faint">{s.kind}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line" aria-hidden>
                    <span className="block h-full rounded-full bg-highlight" style={{ width: `${(s.filled / n) * 100}%` }} />
                  </span>
                  <span className="tabular-nums">{Math.round((s.filled / n) * 100)}%</span>
                </div>
              </td>
              <td className={cn("px-3 py-2 tabular-nums", s.nulls ? "text-accent" : "text-faint")}>{s.nulls.toLocaleString()}</td>
              <td className="px-3 py-2 tabular-nums">{s.distinct.toLocaleString()}</td>
              <td className="max-w-[18ch] truncate px-3 py-2 tabular-nums" title={fmt(s.min)}>
                {fmt(s.min) || <span className="text-faint">—</span>}
              </td>
              <td className="max-w-[18ch] truncate px-3 py-2 tabular-nums" title={fmt(s.max)}>
                {fmt(s.max) || <span className="text-faint">—</span>}
              </td>
              <td className="px-3 py-2 tabular-nums">{s.avg === null ? <span className="text-faint">—</span> : fmt(Math.round(s.avg * 100) / 100)}</td>
              <td className="max-w-[22ch] truncate px-3 py-2" title={s.top ? `${s.top[0]} (${s.top[1]})` : ""}>
                {!s.filled ? (
                  <span className="text-faint">—</span>
                ) : s.top && s.distinct < s.filled ? (
                  <>
                    {s.top[0]} <span className="text-faint">×{s.top[1].toLocaleString()}</span>
                  </>
                ) : (
                  <span className="text-faint">all unique</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-faint">Computed from the {rows.length.toLocaleString()} rows returned.</p>
    </div>
  );
}
