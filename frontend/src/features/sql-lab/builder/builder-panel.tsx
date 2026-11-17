"use client";

import { ArrowDownUp, Code2, Filter as FilterIcon, Link2, ListChecks, Plus, Sigma, Table2, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import type { JoinHint, Table } from "../params";
import type { Compiled } from "./compile";
import { AGG_LABEL, OP_LABEL, emptyBuilder, type BuilderAgg, type BuilderState, type Bucket, type ColRef, type Filter, type FilterOp, type Side } from "./types";

const BUCKETS: Bucket[] = ["day", "week", "month", "quarter", "year"];
const OPS_BY_TYPE: Record<string, FilterOp[]> = {
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "empty", "not_empty"],
  date: ["eq", "gt", "gte", "lt", "lte", "between", "empty", "not_empty"],
  category: ["eq", "neq", "in", "contains", "empty", "not_empty"],
  text: ["eq", "neq", "in", "contains", "empty", "not_empty"],
};

type Col = ColRef & { type: string; label: string };

function Section({ icon: Icon, title, children, action }: { icon: typeof Table2; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-bg/40 p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-highlight" aria-hidden />
        <h3 className="text-[12.5px] font-semibold text-text">{title}</h3>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

const key = (c: ColRef) => `${c.side}:${c.column}`;
const parseKey = (k: string): ColRef => ({ side: k.slice(0, 1) as Side, column: k.slice(2) });

/**
 * Builder mode: pick a table, an optional join, what to show (rows or a summary), filters, sort and limit.
 * Every change recompiles to SQL (shown underneath); running and saving use that SQL like any other query.
 */
export function BuilderPanel({
  state,
  tables,
  joins,
  compiled,
  onChange,
  onOpenInSql,
}: {
  state: BuilderState;
  tables: Table[];
  joins: JoinHint[];
  compiled: Compiled;
  onChange: (next: BuilderState) => void;
  onOpenInSql: () => void;
}) {
  const main = tables.find((t) => t.table === state.from);
  const joined = state.join ? tables.find((t) => t.table === state.join!.table) : undefined;
  const cols: Col[] = [
    ...(main?.columns ?? []).map((c) => ({ side: "a" as const, column: c.name, type: c.type, label: state.join ? `${state.from}.${c.name}` : c.name })),
    ...(joined?.columns ?? []).map((c) => ({ side: "b" as const, column: c.name, type: c.type, label: `${joined!.table}.${c.name}` })),
  ];
  const typeOf = (c: ColRef) => cols.find((x) => x.side === c.side && x.column === c.column)?.type ?? "text";
  const set = (patch: Partial<BuilderState>) => onChange({ ...state, ...patch });
  // Join suggestions involving the main table, oriented so the main table is on the left.
  const suggestions = joins
    .filter((j) => j.left_table === state.from || j.right_table === state.from)
    .map((j) =>
      j.left_table === state.from
        ? { table: j.right_table, left: j.left_column, right: j.right_column, normalized: j.normalized, overlap: j.overlap }
        : { table: j.left_table, left: j.right_column, right: j.left_column, normalized: j.normalized, overlap: j.overlap },
    );
  const sortOptions = state.mode === "summary" ? compiled.columns : cols.filter((c) => c.side === "a").map((c) => c.column);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-lenis-prevent>
        <div className="grid gap-3 xl:grid-cols-2">
          {/* 1. Data */}
          <Section icon={Table2} title="Start from">
            <NativeSelect
              aria-label="Table"
              value={state.from}
              onChange={(e) => onChange({ ...emptyBuilder(e.target.value), mode: state.mode, limit: state.limit })}
            >
              {tables.map((t) => (
                <option key={t.table} value={t.table} className="bg-surface">
                  {t.table} ({t.row_count.toLocaleString()} rows)
                </option>
              ))}
            </NativeSelect>
            {state.join ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-[12.5px]">
                <Link2 className="size-3.5 text-highlight" aria-hidden />
                <span className="font-mono">
                  {state.join.kind === "left" ? "with matching" : "only rows matching"} {state.join.table} ({state.join.left} = {state.join.right})
                </span>
                <NativeSelect
                  aria-label="Join type"
                  className="h-7 w-auto text-[12px]"
                  value={state.join.kind}
                  onChange={(e) => set({ join: { ...state.join!, kind: e.target.value as "inner" | "left" } })}
                >
                  <option value="left" className="bg-surface">Keep all {state.from}</option>
                  <option value="inner" className="bg-surface">Only matches</option>
                </NativeSelect>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  aria-label="Remove join"
                  onClick={() => set({ join: null, columns: state.columns.filter((c) => c.side === "a"), groupBy: state.groupBy.filter((c) => c.side === "a"), measures: state.measures.filter((c) => c.side === "a"), filters: state.filters.filter((c) => c.side === "a") })}
                >
                  <X />
                </Button>
              </div>
            ) : suggestions.length ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11.5px] text-faint">Combine with a related table:</p>
                {suggestions.map((s) => (
                  <button
                    key={`${s.table}.${s.right}`}
                    type="button"
                    onClick={() => set({ join: { table: s.table, left: s.left, right: s.right, kind: "left", normalized: s.normalized } })}
                    className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:border-primary/40 hover:text-text"
                  >
                    <Plus className="size-3.5 shrink-0 text-highlight" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {s.table} on {s.left} = {s.right}
                    </span>
                    <span className="shrink-0 text-[11px] text-faint">{Math.round(s.overlap * 100)}% match</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-faint">No related tables found for {state.from}.</p>
            )}
          </Section>

          {/* 2. Show */}
          <Section
            icon={state.mode === "summary" ? Sigma : ListChecks}
            title="Show"
            action={
              <div className="flex gap-0.5 rounded-[8px] border border-line p-0.5" role="radiogroup" aria-label="What to show">
                {(["summary", "rows"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={state.mode === m}
                    onClick={() => set({ mode: m, sort: null })}
                    className={cn("rounded-[6px] px-2 py-0.5 text-[11.5px]", state.mode === m ? "bg-surface-2 text-text" : "text-muted")}
                  >
                    {m === "summary" ? "Summary" : "Rows"}
                  </button>
                ))}
              </div>
            }
          >
            {state.mode === "rows" ? (
              <div className="flex flex-wrap gap-1.5">
                {cols.map((c) => {
                  const on = state.columns.some((x) => key(x) === key(c));
                  return (
                    <button
                      key={key(c)}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ columns: on ? state.columns.filter((x) => key(x) !== key(c)) : [...state.columns, { side: c.side, column: c.column }] })}
                      className={cn(
                        "rounded-full border px-2.5 py-1 font-mono text-[11.5px]",
                        on ? "border-primary/60 bg-primary/15 text-text" : "border-line text-muted hover:text-text",
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
                <p className="w-full text-[11px] text-faint">{state.columns.length ? `${state.columns.length} selected` : "None selected: every column is shown."}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[11.5px] text-faint">Group by</p>
                {state.groupBy.map((g, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <NativeSelect
                      aria-label="Group by column"
                      className="min-w-0 flex-1 text-[12.5px]"
                      value={key(g)}
                      onChange={(e) => set({ groupBy: state.groupBy.map((x, j) => (j === i ? { ...parseKey(e.target.value) } : x)) })}
                    >
                      {cols.map((c) => (
                        <option key={key(c)} value={key(c)} className="bg-surface">
                          {c.label}
                        </option>
                      ))}
                    </NativeSelect>
                    {typeOf(g) === "date" && (
                      <NativeSelect
                        aria-label="Date bucket"
                        className="w-28 text-[12.5px]"
                        value={g.bucket ?? ""}
                        onChange={(e) => set({ groupBy: state.groupBy.map((x, j) => (j === i ? { ...x, bucket: (e.target.value || undefined) as Bucket | undefined } : x)) })}
                      >
                        <option value="" className="bg-surface">exact date</option>
                        {BUCKETS.map((b) => (
                          <option key={b} value={b} className="bg-surface">
                            by {b}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                    <Button variant="ghost" size="icon-xs" aria-label="Remove group" onClick={() => set({ groupBy: state.groupBy.filter((_, j) => j !== i) })}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="xs"
                  className="self-start text-highlight"
                  disabled={!cols.length}
                  onClick={() => {
                    const pick = cols.find((c) => c.type === "category") ?? cols.find((c) => c.type === "date") ?? cols[0];
                    set({ groupBy: [...state.groupBy, { side: pick.side, column: pick.column, ...(pick.type === "date" ? { bucket: "month" as Bucket } : {}) }] });
                  }}
                >
                  <Plus /> Group by a column
                </Button>

                <p className="mt-1 text-[11.5px] text-faint">Measures</p>
                {state.measures.map((m, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <NativeSelect
                      aria-label="Calculation"
                      className="w-40 text-[12.5px]"
                      value={m.agg}
                      onChange={(e) => {
                        const agg = e.target.value as BuilderAgg;
                        const fixCol = (agg === "sum" || agg === "avg") && typeOf(m) !== "number";
                        const num = cols.find((c) => c.type === "number");
                        set({
                          measures: state.measures.map((x, j) =>
                            j === i ? { ...x, agg, ...(m.column === "*" && agg !== "count" ? { side: (num ?? cols[0]).side, column: (num ?? cols[0]).column } : fixCol && num ? { side: num.side, column: num.column } : {}) } : x,
                          ),
                        });
                      }}
                    >
                      {(Object.keys(AGG_LABEL) as BuilderAgg[]).map((a) => (
                        <option key={a} value={a} className="bg-surface">
                          {AGG_LABEL[a]}
                        </option>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      aria-label="Measure column"
                      className="min-w-0 flex-1 text-[12.5px]"
                      value={m.column === "*" ? "*" : key(m)}
                      onChange={(e) => set({ measures: state.measures.map((x, j) => (j === i ? (e.target.value === "*" ? { ...x, side: "a", column: "*" } : { ...x, ...parseKey(e.target.value) }) : x)) })}
                    >
                      {m.agg === "count" && (
                        <option value="*" className="bg-surface">
                          rows
                        </option>
                      )}
                      {cols
                        .filter((c) => (m.agg === "sum" || m.agg === "avg" ? c.type === "number" : true))
                        .map((c) => (
                          <option key={key(c)} value={key(c)} className="bg-surface">
                            {c.label}
                          </option>
                        ))}
                    </NativeSelect>
                    <Button variant="ghost" size="icon-xs" aria-label="Remove measure" onClick={() => set({ measures: state.measures.filter((_, j) => j !== i) })}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="xs"
                  className="self-start text-highlight"
                  onClick={() => {
                    const num = cols.find((c) => c.type === "number");
                    set({ measures: [...state.measures, num ? { side: num.side, column: num.column, agg: "sum" } : { side: "a", column: "*", agg: "count" }] });
                  }}
                >
                  <Plus /> Add a measure
                </Button>
              </div>
            )}
          </Section>

          {/* 3. Filters */}
          <Section
            icon={FilterIcon}
            title="Filters"
            action={
              <Button
                variant="ghost"
                size="xs"
                className="text-highlight"
                disabled={!cols.length}
                onClick={() => {
                  const c = cols[0];
                  set({ filters: [...state.filters, { side: c.side, column: c.column, op: OPS_BY_TYPE[c.type]?.[0] ?? "eq", value: "" }] });
                }}
              >
                <Plus /> Add
              </Button>
            }
          >
            {!state.filters.length && <p className="text-[11.5px] text-faint">No filters: every row is used.</p>}
            {state.filters.map((f, i) => (
              <FilterRow
                key={i}
                filter={f}
                cols={cols}
                type={typeOf(f)}
                onChange={(next) => set({ filters: state.filters.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => set({ filters: state.filters.filter((_, j) => j !== i) })}
              />
            ))}
          </Section>

          {/* 4. Sort and limit */}
          <Section icon={ArrowDownUp} title="Sort and limit">
            <div className="flex flex-wrap items-center gap-1.5">
              <NativeSelect
                aria-label="Sort by"
                className="min-w-0 flex-1 text-[12.5px]"
                value={state.sort?.by ?? ""}
                onChange={(e) => set({ sort: e.target.value ? { by: e.target.value, dir: state.sort?.dir ?? "desc" } : null })}
              >
                <option value="" className="bg-surface">No sorting</option>
                {sortOptions.map((c) => (
                  <option key={c} value={c} className="bg-surface">
                    {c}
                  </option>
                ))}
              </NativeSelect>
              {state.sort && (
                <NativeSelect
                  aria-label="Sort direction"
                  className="w-36 text-[12.5px]"
                  value={state.sort.dir}
                  onChange={(e) => set({ sort: { ...state.sort!, dir: e.target.value as "asc" | "desc" } })}
                >
                  <option value="desc" className="bg-surface">Largest first</option>
                  <option value="asc" className="bg-surface">Smallest first</option>
                </NativeSelect>
              )}
              <label className="flex items-center gap-1.5 text-[12px] text-muted">
                Limit
                <Input
                  type="number"
                  min={1}
                  max={5000}
                  value={state.limit}
                  onChange={(e) => set({ limit: Number(e.target.value) || 100 })}
                  className="h-8 w-24 text-[12.5px]"
                />
              </label>
            </div>
          </Section>
        </div>
      </div>

      {/* Live SQL */}
      <div className="shrink-0 border-t border-line bg-bg/50 px-3 py-2">
        <div className="mb-1 flex items-center gap-2">
          <Code2 className="size-3.5 text-faint" aria-hidden />
          <span className="text-[11.5px] text-faint">SQL this builds</span>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={onOpenInSql} title="Edit this SQL by hand (the builder stops following it)">
            Open in SQL
          </Button>
        </div>
        {compiled.problems.length > 0 && (
          <p role="status" className="mb-1 text-[12px] text-accent">
            {compiled.problems[0]}
          </p>
        )}
        <pre className="max-h-28 overflow-auto font-mono text-[11.5px] leading-snug text-muted" data-lenis-prevent>
          {compiled.sql}
        </pre>
      </div>
    </div>
  );
}

function FilterRow({ filter: f, cols, type, onChange, onRemove }: { filter: Filter; cols: Col[]; type: string; onChange: (f: Filter) => void; onRemove: () => void }) {
  const ops = OPS_BY_TYPE[type] ?? OPS_BY_TYPE.text;
  const inputType = type === "date" ? "date" : type === "number" ? "number" : "text";
  const needsValue = f.op !== "empty" && f.op !== "not_empty";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <NativeSelect
        aria-label="Filter column"
        className="min-w-0 flex-1 text-[12.5px]"
        value={key(f)}
        onChange={(e) => {
          const next = parseKey(e.target.value);
          const nextType = cols.find((c) => key(c) === e.target.value)?.type ?? "text";
          onChange({ ...f, ...next, op: (OPS_BY_TYPE[nextType] ?? OPS_BY_TYPE.text).includes(f.op) ? f.op : "eq", value: "", value2: "" });
        }}
      >
        {cols.map((c) => (
          <option key={key(c)} value={key(c)} className="bg-surface">
            {c.label}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label="Condition" className="w-36 text-[12.5px]" value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as FilterOp })}>
        {ops.map((o) => (
          <option key={o} value={o} className="bg-surface">
            {OP_LABEL[o]}
          </option>
        ))}
      </NativeSelect>
      {needsValue && (
        <Input
          aria-label="Value"
          type={f.op === "in" || f.op === "contains" ? "text" : inputType}
          placeholder={f.op === "in" ? "a, b, c" : "value"}
          value={f.value}
          onChange={(e) => onChange({ ...f, value: e.target.value })}
          className="h-8 w-32 text-[12.5px]"
        />
      )}
      {f.op === "between" && (
        <Input aria-label="Second value" type={inputType} placeholder="and" value={f.value2 ?? ""} onChange={(e) => onChange({ ...f, value2: e.target.value })} className="h-8 w-32 text-[12.5px]" />
      )}
      <Button variant="ghost" size="icon-xs" aria-label="Remove filter" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}
