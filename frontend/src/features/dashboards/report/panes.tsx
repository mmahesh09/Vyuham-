"use client";

import { BarChart3, Database, Filter, Hash, LayoutTemplate, MousePointerClick, PanelRightClose, Plus, Sigma, Type, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChartSpec } from "@/features/charts/chart-spec";
import { SWATCHES, TYPES } from "@/features/charts/studio/chart-studio";
import { describeFilter } from "@/features/charts/studio/filter-editor";
import {
  AGG_NAME,
  ROW_FIELD,
  drop,
  effectiveType,
  fieldsFor,
  fits,
  fromSpec,
  shelvesFor,
  toSpec,
  type Column,
  type Field,
  type Shelf,
  type StudioState,
} from "@/features/charts/studio/model";
import { useApprovedMetrics } from "@/features/metrics/api";
import { cn } from "@/lib/utils";

import type { ChartKind, ChartRecord, Dashboard, DashboardSource } from "../api";
import { DateRangePicker } from "../date-range-picker";
import { ColumnFilter } from "../filter-bar";
import { useDashboardFilters, useReportState } from "../filters";

export type PaneId = "filters" | "visualize" | "fields";

const PANES: { id: PaneId; label: string; icon: typeof Filter; editorsOnly: boolean }[] = [
  { id: "filters", label: "Filters", icon: Filter, editorsOnly: false },
  { id: "visualize", label: "Visualizations", icon: BarChart3, editorsOnly: true },
  { id: "fields", label: "Fields", icon: Database, editorsOnly: true },
];

/** Power BI's names for the studio's shelves. */
const WELL: Record<Shelf, string> = { columns: "Axis", rows: "Values", color: "Legend", filters: "Filters" };

export type ChartUpdate = { spec?: ChartSpec; kind?: ChartKind };

type Props = {
  dashboard: Dashboard;
  source: DashboardSource;
  canEdit: boolean;
  selected: ChartRecord | null;
  open: PaneId | null;
  onOpen: (pane: PaneId | null) => void;
  onUpdate: (chart: ChartRecord, body: ChartUpdate) => void;
  saving: boolean;
  onAddVisual: (kind: ChartKind) => void;
  onEditInStudio: (chart: ChartRecord) => void;
  /** In a sheet on small screens: no rail, every pane stacked. */
  stacked?: boolean;
};

const heading = "font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-faint";

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-b border-line px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className={heading}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ Filters */

function FiltersPane({ dashboard, source, selected }: { dashboard: Dashboard; source: DashboardSource; selected: ChartRecord | null }) {
  const [filters, setFilters] = useDashboardFilters();
  const [report, setReport] = useReportState();
  const hasDates = Object.keys(dashboard.date_fields).length > 0;
  const cross = Object.entries(report.x ?? {});
  const crossSource = dashboard.charts.find((c) => c.id === report.xs);

  return (
    <>
      <Section
        title="On all pages"
        action={
          Object.keys(filters.f).length > 0 || filters.from ? (
            <button type="button" className="text-[12px] text-highlight hover:underline" onClick={() => setFilters({ f: null, from: null, to: null })}>
              Clear
            </button>
          ) : undefined
        }
      >
        {hasDates && (
          <div className="flex flex-col gap-1.5 [&_[role=radiogroup]]:flex-wrap">
            <span className="text-[12.5px] text-muted">Date range</span>
            <DateRangePicker from={filters.from} to={filters.to} onChange={({ from, to }) => setFilters({ from, to })} />
          </div>
        )}
        {dashboard.filter_columns.map((c) => (
          <div key={c} className="flex flex-col gap-1.5 [&_select]:max-w-none">
            <span className="text-[12.5px] text-muted">{c}</span>
            <ColumnFilter
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
          </div>
        ))}
        {!hasDates && dashboard.filter_columns.length === 0 && (
          <p className="text-[13px] text-muted">No report filters yet.{" "}{dashboard.can_edit ? "Add filter columns in Settings." : ""}</p>
        )}
      </Section>

      <Section title="Cross-filter">
        {cross.length ? (
          cross.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 rounded-[4px] border border-highlight/40 bg-highlight/8 px-2.5 py-1.5">
              <span className="min-w-0 text-[13px] text-text">
                <span className="text-muted">{k} is</span> <span className="font-medium">{v}</span>
                {crossSource && <span className="block truncate text-[11.5px] text-faint">from {crossSource.spec.title}</span>}
              </span>
              <button type="button" aria-label={`Clear ${k} cross-filter`} onClick={() => setReport({ x: null, xs: null })} className="rounded-[3px] p-1 text-faint hover:bg-surface-2 hover:text-text">
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ))
        ) : (
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
            <MousePointerClick className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
            Click a bar or slice in a visual to filter the others by it. Click it again to clear.
          </p>
        )}
      </Section>

      <Section title={selected ? "On this visual" : "Visual filters"}>
        {!selected ? (
          <p className="text-[13px] text-muted">Select a visual to see the filters built into it.</p>
        ) : selected.spec.filters?.length ? (
          <ul className="flex flex-col gap-1.5">
            {selected.spec.filters.map((f, i) => (
              <li key={i} className="rounded-[4px] bg-surface-2 px-2.5 py-1.5 text-[13px] text-text">
                <span className="text-muted">{f.field}</span> {describeFilter(f)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">“{selected.spec.title}” has no filters of its own.</p>
        )}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ Visualizations + Fields */

/** The selected visual as studio state, with its dataset's columns and approved metrics. */
function useVisualModel(dashboard: Dashboard, chart: ChartRecord | null) {
  const ds = dashboard.datasets.find((d) => d.id === (chart?.dataset_id ?? chart?.spec.dataset)) ?? null;
  const approved = useApprovedMetrics(ds?.id);
  const columns: Column[] = useMemo(() => (ds?.columns ?? []).map((c) => ({ name: c.name, type: c.type })), [ds]);
  const fields = useMemo(() => fieldsFor(columns, approved.map((m) => ({ id: m.id, name: m.name }))), [columns, approved]);
  const state = useMemo(() => (chart && !chart.spec.sql ? fromSpec(chart.spec) : null), [chart]);
  return { ds, columns, fields, state };
}

function save(chart: ChartRecord, next: StudioState, columns: Column[], onUpdate: Props["onUpdate"]) {
  const spec = toSpec(next, columns);
  if (!spec) return false;
  onUpdate(chart, { spec, kind: spec.chartType === "kpi" ? "kpi" : "card" });
  return true;
}

function NoSelection({ onAddVisual, what }: { onAddVisual: Props["onAddVisual"]; what: string }) {
  return (
    <Section title="Nothing selected">
      <p className="text-[13px] leading-relaxed text-muted">Click a visual on the canvas to {what}, or add a new one to this page.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onAddVisual("card")}>
          <Plus /> Add visual
        </Button>
        <Button size="sm" variant="outline" onClick={() => onAddVisual("kpi")}>
          <Hash /> Key number
        </Button>
      </div>
    </Section>
  );
}

function VisualizePane({ dashboard, selected, onUpdate, saving, onAddVisual, onEditInStudio }: Props) {
  const { columns, state } = useVisualModel(dashboard, selected);
  const [title, setTitle] = useState<{ id: string; value: string } | null>(null);
  if (!selected) return <NoSelection onAddVisual={onAddVisual} what="change its type and format" />;
  if (!state)
    return (
      <Section title="SQL visual">
        <p className="text-[13px] text-muted">This visual comes from a SQL query. Change it in the studio.</p>
        <Button size="sm" variant="outline" onClick={() => onEditInStudio(selected)}>
          Open in studio
        </Button>
      </Section>
    );
  const current = effectiveType(state, columns);
  const typeFits = fits(state, columns);
  const titleValue = title?.id === selected.id ? title.value : selected.spec.title;

  return (
    <>
      <Section title="Visual type">
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Visual type">
          {TYPES.map(({ type, label, icon: Icon }) => {
            const fit = typeFits.find((f) => f.type === type);
            const active = current === type;
            return (
              <button
                key={type}
                type="button"
                disabled={!fit?.ok || saving}
                aria-pressed={active}
                title={fit?.ok ? label : `${label}: ${fit?.reason ?? ""}`}
                onClick={() => save(selected, { ...state, chartType: type, swapped: type === "hbar" ? true : type === "bar" ? false : state.swapped }, columns, onUpdate)}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-1 rounded-[6px] border text-[10.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-30",
                  active ? "border-highlight bg-highlight/10 text-text" : "border-line text-muted hover:border-line-strong hover:text-text",
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="w-full truncate px-0.5 text-center">{label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Format">
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <Type className="size-3.5" aria-hidden /> Title
          </span>
          <input
            value={titleValue}
            maxLength={120}
            onChange={(e) => setTitle({ id: selected.id, value: e.target.value })}
            onBlur={() => {
              const t = titleValue.trim();
              if (t && t !== selected.spec.title) save(selected, { ...state, title: t, titleTouched: true }, columns, onUpdate);
              setTitle(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-9 rounded-[6px] border border-line bg-bg px-2.5 text-[13.5px] text-text outline-none focus:border-highlight"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-muted">Colour</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
            {[null, ...SWATCHES].map((hex) => {
              const on = (state.hex ?? null) === hex;
              return (
                <button
                  key={hex ?? "auto"}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={hex ?? "Automatic"}
                  disabled={saving}
                  onClick={() => save(selected, { ...state, hex }, columns, onUpdate)}
                  className={cn("size-6 rounded-full border-2 transition-transform hover:scale-110", on ? "border-text" : "border-transparent")}
                  style={hex ? { background: hex } : { background: "conic-gradient(#ffb37a,#f07a2b,#5b8def,#3fbf9b,#ffb37a)" }}
                />
              );
            })}
          </div>
        </div>
        <Button size="sm" variant="outline" className="self-start" onClick={() => onEditInStudio(selected)}>
          <LayoutTemplate /> Open in studio
        </Button>
      </Section>
    </>
  );
}

function FieldsPane({ dashboard, selected, onUpdate, saving, onAddVisual }: Props) {
  const { ds, columns, fields, state } = useVisualModel(dashboard, selected);
  const [notice, setNotice] = useState<string | null>(null);
  if (!selected) return <NoSelection onAddVisual={onAddVisual} what="see and change its fields" />;
  if (!state || !ds)
    return (
      <Section title="Fields">
        <p className="text-[13px] text-muted">{ds ? "SQL visuals choose their columns in the query." : "The dataset behind this visual was deleted."}</p>
      </Section>
    );

  const apply = (next: StudioState) => {
    if (next === state) return setNotice("That field can't go there.");
    setNotice(save(selected, next, columns, onUpdate) ? null : "A visual needs at least one value.");
  };
  const wells: { shelf: Shelf; items: { key: string; label: string; remove: () => StudioState }[] }[] = [
    { shelf: "columns", items: state.columns ? [{ key: state.columns.field, label: state.columns.field, remove: () => ({ ...state, columns: null, color: null }) }] : [] },
    {
      shelf: "rows",
      items: state.rows.map((m, i) => ({
        key: `${m.field}-${m.agg}`,
        label: m.agg === "metric" ? (m.label ?? "Metric") : m.field === ROW_FIELD ? "Count of rows" : `${AGG_NAME[m.agg]} of ${m.field}`,
        remove: () => ({ ...state, rows: state.rows.filter((_, j) => j !== i) }),
      })),
    },
    { shelf: "color", items: state.color ? [{ key: state.color, label: state.color, remove: () => ({ ...state, color: null }) }] : [] },
  ];
  const fieldRow = (f: Field) => {
    const icon = f.kind === "column" && f.type !== "number" ? <Type className="size-3.5" aria-hidden /> : <Sigma className="size-3.5" aria-hidden />;
    return (
      <li key={f.key}>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={saving}
            className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[13px] text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <span className="text-faint">{icon}</span>
            <span className="truncate">{f.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Add to</DropdownMenuLabel>
            {shelvesFor(f).map((s) => (
              <DropdownMenuItem key={s} onClick={() => apply(drop(state, f, s))}>
                {WELL[s]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

  return (
    <>
      <Section title="Wells">
        {wells.map((w) => (
          <div key={w.shelf} className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">{WELL[w.shelf]}</span>
            {w.items.length ? (
              w.items.map((it) => (
                <span key={it.key} className="flex items-center justify-between gap-2 rounded-[4px] border border-line bg-surface-2 px-2 py-1 text-[12.5px] text-text">
                  <span className="truncate">{it.label}</span>
                  <button type="button" disabled={saving} aria-label={`Remove ${it.label}`} onClick={() => apply(it.remove())} className="rounded-[3px] p-0.5 text-faint hover:text-text">
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))
            ) : (
              <span className="rounded-[4px] border border-dashed border-line px-2 py-1 text-[12px] text-faint">Add a field</span>
            )}
          </div>
        ))}
        {notice && (
          <p role="status" className="text-[12.5px] text-accent">
            {notice}
          </p>
        )}
      </Section>
      <Section title={ds.name}>
        <p className="-mt-1 text-[12px] text-faint">Click a field to add it to the selected visual.</p>
        <ul className="-mx-2 flex flex-col" aria-label="Categories and dates">
          {fields.dimensions.map(fieldRow)}
        </ul>
        <ul className="-mx-2 flex flex-col border-t border-line pt-1" aria-label="Measures">
          {fields.measures.map(fieldRow)}
        </ul>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ shell */

/** The right-hand panes. Collapsed they're a rail of icons; open, one pane at a time, like Power BI. */
export function ReportPanes(props: Props) {
  const { canEdit, open, onOpen, stacked } = props;
  const panes = PANES.filter((p) => canEdit || !p.editorsOnly);
  const active = panes.find((p) => p.id === open) ?? null;

  const body = (id: PaneId) =>
    id === "filters" ? <FiltersPane dashboard={props.dashboard} source={props.source} selected={props.selected} /> : id === "visualize" ? <VisualizePane {...props} /> : <FieldsPane {...props} />;

  if (stacked)
    return (
      <div className="flex flex-col">
        {panes.map((p) => (
          <div key={p.id} className="flex flex-col">
            <h2 className="flex items-center gap-2 border-b border-line bg-surface-2/50 px-4 py-2.5 text-[13px] font-semibold text-text">
              <p.icon className="size-4 text-highlight" aria-hidden /> {p.label}
            </h2>
            {body(p.id)}
          </div>
        ))}
      </div>
    );

  return (
    <div className="flex h-full min-h-0">
      {active && (
        <aside aria-label={active.label} className="flex w-[288px] min-h-0 flex-col border-l border-line bg-surface">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
            <h2 className="text-[13.5px] font-semibold text-text">{active.label}</h2>
            <button type="button" onClick={() => onOpen(null)} aria-label="Collapse pane" className="rounded-[4px] p-1 text-faint hover:bg-surface-2 hover:text-text">
              <PanelRightClose className="size-4" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{body(active.id)}</div>
        </aside>
      )}
      <nav aria-label="Report panes" className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-line bg-bg-alt py-2">
        {panes.map((p) => {
          const on = p.id === active?.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-expanded={on}
              aria-label={p.label}
              title={p.label}
              onClick={() => onOpen(on ? null : p.id)}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-[6px] transition-colors",
                on ? "bg-surface text-highlight" : "text-faint hover:bg-surface hover:text-text",
              )}
            >
              {on && <span className="absolute left-0 top-1.5 h-6 w-0.5 rounded-full bg-highlight" aria-hidden />}
              <p.icon className="size-[18px]" aria-hidden />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
