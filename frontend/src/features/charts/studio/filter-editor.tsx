"use client";

import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useColumnValues } from "@/features/datasets/api";
import { cn } from "@/lib/utils";

import type { ColumnType, SpecFilter } from "./model";

/** A short description of a filter for its chip, e.g. "Region: North, South" or "Amount ≥ 100". */
export function describeFilter(f: SpecFilter): string {
  const v = f.value;
  switch (f.op) {
    case "in": {
      const list = Array.isArray(v) ? v.map(String) : [];
      if (!list.length) return `${f.field}: pick values`;
      return `${f.field}: ${list.length > 2 ? `${list.slice(0, 2).join(", ")} +${list.length - 2}` : list.join(", ")}`;
    }
    case "between":
      return Array.isArray(v) ? `${f.field}: ${String(v[0])} – ${String(v[1])}` : f.field;
    case "gte":
      return `${f.field} ≥ ${String(v)}`;
    case "lte":
      return `${f.field} ≤ ${String(v)}`;
    case "not_empty":
      return `${f.field}: any`;
    default:
      return f.field;
  }
}

/** "Is one of" with a searchable checkbox list of the column's values. */
function ValuesFilter({ datasetId, filter, onChange }: { datasetId: string; filter: SpecFilter; onChange: (f: SpecFilter) => void }) {
  const values = useColumnValues(datasetId, filter.field);
  const [q, setQ] = useState("");
  const picked = Array.isArray(filter.value) ? filter.value.map(String) : [];
  const shown = (values.data ?? []).filter((v) => v.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (v: string, on: boolean) => onChange({ ...filter, op: "in", value: on ? [...picked, v] : picked.filter((x) => x !== v) });

  return (
    <div className="flex flex-col gap-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search values" aria-label={`Search ${filter.field} values`} />
      {values.isLoading && <p className="py-2 text-[13px] text-faint">Loading values…</p>}
      {values.isError && <p className="py-2 text-[13px] text-accent">Couldn&apos;t load the values.</p>}
      <ul className="max-h-56 overflow-y-auto">
        {shown.map((v) => {
          const on = picked.includes(v);
          return (
            <li key={v}>
              <label className={cn("flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-[13.5px]", on && "bg-primary/[0.06]")}>
                <Checkbox checked={on} onCheckedChange={(c) => toggle(v, !!c)} aria-label={v} />
                <span className="truncate text-text">{v}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-faint">{picked.length ? `${picked.length} selected` : "Pick the values to keep."}</p>
    </div>
  );
}

/** From / to for numbers and dates. Leaving both empty keeps every row with a value. */
function RangeFilter({ filter, type, onChange }: { filter: SpecFilter; type: "number" | "date"; onChange: (f: SpecFilter) => void }) {
  const [lo, hi] =
    filter.op === "between" && Array.isArray(filter.value)
      ? [String(filter.value[0] ?? ""), String(filter.value[1] ?? "")]
      : filter.op === "gte"
        ? [String(filter.value ?? ""), ""]
        : filter.op === "lte"
          ? ["", String(filter.value ?? "")]
          : ["", ""];
  const parse = (s: string) => (type === "number" ? Number(s) : s);
  const set = (from: string, to: string) => {
    const a = from.trim();
    const b = to.trim();
    if (a && b) onChange({ field: filter.field, op: "between", value: [parse(a), parse(b)] });
    else if (a) onChange({ field: filter.field, op: "gte", value: parse(a) });
    else if (b) onChange({ field: filter.field, op: "lte", value: parse(b) });
    else onChange({ field: filter.field, op: "not_empty", value: null });
  };
  const inputType = type === "number" ? "number" : "date";
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        From
        <Input type={inputType} value={lo} onChange={(e) => set(e.target.value, hi)} />
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        To
        <Input type={inputType} value={hi} onChange={(e) => set(lo, e.target.value)} />
      </label>
      <p className="col-span-2 text-[12px] text-faint">Leave a side empty for no limit.</p>
    </div>
  );
}

export function FilterEditor({
  datasetId,
  filter,
  type,
  onChange,
}: {
  datasetId: string;
  filter: SpecFilter;
  type: ColumnType | undefined;
  onChange: (f: SpecFilter) => void;
}) {
  return (
    <div className="flex w-64 flex-col gap-3">
      <p className="text-[13px] font-medium text-text">Filter {filter.field}</p>
      {type === "number" || type === "date" ? (
        <RangeFilter filter={filter} type={type} onChange={onChange} />
      ) : (
        <ValuesFilter datasetId={datasetId} filter={filter} onChange={onChange} />
      )}
    </div>
  );
}
