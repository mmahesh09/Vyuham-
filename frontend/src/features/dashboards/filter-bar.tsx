"use client";

import { X } from "lucide-react";

import { NativeSelect } from "@/components/ui/native-select";

import type { DashboardSource } from "./api";
import { DateRangePicker } from "./date-range-picker";
import { useDashboardFilters } from "./filters";
import { useFilterValues } from "./hooks";

function ColumnFilter({ source, column, value, onChange }: { source: DashboardSource; column: string; value: string; onChange: (v: string) => void }) {
  const { data } = useFilterValues(source, column);
  const id = `f-${column.replace(/\W+/g, "-")}`;
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {column}
      </label>
      <NativeSelect id={id} className="max-w-[220px]" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All {column}</option>
        {/* Keep a value from the URL selectable even before the list loads. */}
        {value && !data?.includes(value) && <option value={value}>{value}</option>}
        {data?.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}

/** Every filter writes to the URL; every chart on the page reads from it. */
export function FilterBar({ source, columns, hasDates }: { source: DashboardSource; columns: string[]; hasDates: boolean }) {
  const [filters, setFilters] = useDashboardFilters();
  const active = Object.entries(filters.f).filter(([k, v]) => v && columns.includes(k));

  return (
    <div role="search" aria-label="Dashboard filters" className="flex flex-wrap items-center gap-2">
      {hasDates && <DateRangePicker from={filters.from} to={filters.to} onChange={({ from, to }) => setFilters({ from, to })} />}
      {columns.map((c) => (
        <ColumnFilter
          key={c}
          source={source}
          column={c}
          value={filters.f[c] ?? ""}
          onChange={(v) => {
            const next = { ...filters.f };
            if (v) next[c] = v;
            else delete next[c];
            setFilters({ f: Object.keys(next).length ? next : null });
          }}
        />
      ))}
      {active.length > 0 && (
        <button
          type="button"
          onClick={() => setFilters({ f: null })}
          className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13.5px] text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <X className="size-4" aria-hidden />
          Clear
        </button>
      )}
    </div>
  );
}
