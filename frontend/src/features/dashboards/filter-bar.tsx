"use client";

import { X } from "lucide-react";

import type { DashboardSource } from "./api";
import { DateRangePicker } from "./date-range-picker";
import { useDashboardFilters } from "./filters";
import { useFilterValues } from "./hooks";

const select =
  "min-h-11 max-w-[220px] rounded-full border border-line bg-bg px-4 text-[14px] text-text hover:bg-surface focus:border-primary focus:outline-none";

function ColumnFilter({ source, column, value, onChange }: { source: DashboardSource; column: string; value: string; onChange: (v: string) => void }) {
  const { data } = useFilterValues(source, column);
  const id = `f-${column.replace(/\W+/g, "-")}`;
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {column}
      </label>
      <select id={id} className={select} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All {column}</option>
        {/* Keep a value from the URL selectable even before the list loads. */}
        {value && !data?.includes(value) && <option value={value}>{value}</option>}
        {data?.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </>
  );
}

/** Every filter writes to the URL; every chart on the page reads from it. */
export function FilterBar({ source, columns, hasDates }: { source: DashboardSource; columns: string[]; hasDates: boolean }) {
  const [filters, setFilters] = useDashboardFilters();
  const active = Object.entries(filters.f).filter(([k, v]) => v && columns.includes(k));

  return (
    <div role="search" aria-label="Dashboard filters" className="flex flex-wrap items-center gap-3">
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
          className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] text-muted hover:text-text"
        >
          <X className="size-4" aria-hidden />
          Clear
        </button>
      )}
    </div>
  );
}
