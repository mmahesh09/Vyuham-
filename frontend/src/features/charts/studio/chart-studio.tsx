"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BarChart3,
  BarChartHorizontal,
  Calendar,
  ChartPie,
  ChartScatter,
  ChevronDown,
  Filter,
  Gauge,
  GripVertical,
  Hash,
  LayoutGrid,
  LineChart,
  Plus,
  Search,
  Sheet as SheetIcon,
  Star,
  Tag,
  TrendingUp,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ColorPicker } from "@/components/reui/color-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dashboardsApi, type ChartKind, type ChartRecord } from "@/features/dashboards/api";
import { ChartBody, InsightHeadline } from "@/features/dashboards/insight-card";
import { useDatasets } from "@/features/datasets/api";
import { useApprovedMetrics } from "@/features/metrics/api";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";

import type { ChartSpec } from "../chart-spec";
import { describeFilter, FilterEditor } from "./filter-editor";
import {
  AGG_NAME,
  aggsFor,
  drop,
  effectiveType,
  emptyState,
  fieldsFor,
  fits,
  fromSpec,
  moveMeasure,
  ROW_FIELD,
  shelvesFor,
  swap,
  toSpec,
  type Column,
  type DateBucket,
  type Field,
  type Measure,
  type Shelf,
  type StudioState,
} from "./model";

const SWATCHES = ["#ffb37a", "#f07a2b", "#f2545b", "#8b7fe0", "#5b8def", "#3fbf9b", "#f2b544", "#f0597a"];
const BUCKETS: DateBucket[] = ["year", "quarter", "month", "week", "day"];
const BUCKET_NAME: Record<DateBucket, string> = { year: "Year", quarter: "Quarter", month: "Month", week: "Week", day: "Day" };
const SHELF_NAME: Record<Shelf, string> = { columns: "Columns", rows: "Rows", color: "Colour", filters: "Filters" };

const TYPES: { type: ChartSpec["chartType"]; label: string; icon: LucideIcon }[] = [
  { type: "line", label: "Line", icon: LineChart },
  { type: "area", label: "Area", icon: TrendingUp },
  { type: "bar", label: "Bar", icon: BarChart3 },
  { type: "hbar", label: "Ranking", icon: BarChartHorizontal },
  { type: "combo", label: "Bar + line", icon: BarChart3 },
  { type: "scatter", label: "Scatter", icon: ChartScatter },
  { type: "pie", label: "Pie", icon: ChartPie },
  { type: "funnel", label: "Funnel", icon: Filter },
  { type: "treemap", label: "Treemap", icon: LayoutGrid },
  { type: "kpi", label: "Number", icon: Hash },
  { type: "gauge", label: "Gauge", icon: Gauge },
  { type: "table", label: "Table", icon: SheetIcon },
];

function fieldIcon(f: Field): LucideIcon {
  if (f.kind === "metric") return Star;
  if (f.kind === "rows") return Hash;
  return { number: Hash, date: Calendar, category: Tag, text: Type }[f.type];
}

// ---------- the Data pane ----------

function FieldChip({ field, onAdd }: { field: Field; onAdd: (shelf: Shelf) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `field:${field.key}`, data: { kind: "field", field } });
  const Icon = fieldIcon(field);
  const measure = field.kind !== "column" || field.type === "number";
  return (
    <li className={cn("group flex items-center gap-1 rounded-md", isDragging && "opacity-40")}>
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Drag ${field.name}`}
        className="flex min-h-9 min-w-0 flex-1 cursor-grab touch-none items-center gap-2 rounded-md px-2 text-left text-[13.5px] text-text hover:bg-surface-2 active:cursor-grabbing"
      >
        <Icon className={cn("size-3.5 shrink-0", measure ? "text-highlight" : "text-sky-400")} aria-hidden />
        <span className="truncate">{field.name}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Add ${field.name} to a shelf`} className="opacity-60 group-hover:opacity-100" />}
        >
          <Plus />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {shelvesFor(field).map((s) => (
            <DropdownMenuItem key={s} onClick={() => onAdd(s)}>
              Add to {SHELF_NAME[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function DataPane({ dimensions, measures, onAdd }: { dimensions: Field[]; measures: Field[]; onAdd: (f: Field, s: Shelf) => void }) {
  const [q, setQ] = useState("");
  const match = (f: Field) => f.name.toLowerCase().includes(q.trim().toLowerCase());
  const group = (title: string, fields: Field[]) => (
    <div className="flex flex-col gap-1">
      <p className="px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-faint">{title}</p>
      <ul className="flex flex-col">
        {fields.filter(match).map((f) => (
          <FieldChip key={f.key} field={f} onAdd={(s) => onAdd(f, s)} />
        ))}
      </ul>
    </div>
  );
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields" className="pl-8" aria-label="Search fields" />
      </div>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        {group("Dimensions", dimensions)}
        {group("Measures", measures)}
      </div>
    </div>
  );
}

// ---------- shelves ----------

function ShelfRow({ shelf, label, accepting, action, children }: { shelf: Shelf; label: string; accepting: boolean | null; action?: ReactNode; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `shelf:${shelf}`, data: { kind: "shelf", shelf } });
  return (
    <div className="flex items-start gap-3">
      <div className="flex w-[92px] shrink-0 items-center gap-1 pt-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">{label}</span>
        {action}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-11 flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 transition-colors",
          accepting === null ? "border-line" : accepting ? "border-highlight/60 bg-highlight/[0.04]" : "border-line opacity-50",
          isOver && accepting && "border-highlight bg-highlight/[0.08]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

const pill = "inline-flex h-8 items-center gap-1 rounded-md border border-line bg-surface-2 pl-2 pr-1 text-[13px] text-text";

function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Remove ${label}`} className="flex size-6 items-center justify-center rounded text-faint hover:text-text">
      <X className="size-3.5" aria-hidden />
    </button>
  );
}

function MeasurePill({ m, index, columns, onAgg, onRemove }: { m: Measure; index: number; columns: Column[]; onAgg: (agg: Measure["agg"]) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `m:${index}`, data: { kind: "measure", index } });
  const name = m.agg === "metric" ? (m.label ?? "Metric") : m.field === ROW_FIELD ? "Rows" : m.field;
  const aggs = aggsFor(m, columns);
  return (
    <span ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(pill, "pl-0.5", isDragging && "opacity-40")}>
      <button type="button" {...listeners} {...attributes} aria-label={`Reorder ${name}`} className="flex h-full cursor-grab touch-none items-center px-1 text-faint">
        <GripVertical className="size-3.5" aria-hidden />
      </button>
      {aggs.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" className="inline-flex items-center gap-1 font-medium text-highlight" />}>
            {AGG_NAME[m.agg]} <ChevronDown className="size-3" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-40">
            {aggs.map((a) => (
              <DropdownMenuItem key={a} onClick={() => onAgg(a)}>
                {AGG_NAME[a]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        m.agg !== "metric" && m.field !== ROW_FIELD && <span className="font-medium text-highlight">{AGG_NAME[m.agg]}</span>
      )}
      <span className="max-w-[160px] truncate">{name}</span>
      <Remove label={name} onClick={onRemove} />
    </span>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <span className="px-1 text-[12.5px] text-faint">{children}</span>;

// ---------- the studio ----------

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chart: ChartRecord | null;
  defaultKind?: ChartKind;
  defaultDatasetId?: string;
  saving: boolean;
  error?: string | null;
  onSave: (body: { spec: ChartSpec; kind: ChartKind; note: string | null }) => void;
};

/** Collisions from the pointer when there is one (mouse, touch), else from the dragged item's box (keyboard). */
const collisions: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

/** Tableau-style chart builder: drag fields onto Columns, Rows, Colour and Filters; the chart draws itself. */
export function ChartStudio({ open, onOpenChange, chart, defaultKind = "card", defaultDatasetId, saving, error, onSave }: Props) {
  const { data: datasets } = useDatasets();
  const [state, setState] = useState<StudioState | null>(null);
  const [dragging, setDragging] = useState<Field | null>(null);

  // Start fresh each time it opens: the chart being edited, or an empty canvas on the dashboard's dataset.
  useEffect(() => {
    if (!open) return;
    if (chart) setState(fromSpec(chart.spec));
    else if (datasets?.length) setState(emptyState((datasets.find((d) => d.id === defaultDatasetId) ?? datasets[0]).id));
  }, [open, chart, datasets, defaultDatasetId]);

  const ds = datasets?.find((d) => d.id === state?.datasetId);
  const approved = useApprovedMetrics(ds?.id);
  const columns: Column[] = useMemo(() => (ds?.columns ?? []).map((c) => ({ name: c.name, type: c.type })), [ds]);
  const { dimensions, measures } = useMemo(() => fieldsFor(columns, approved.map((m) => ({ id: m.id, name: m.name }))), [columns, approved]);
  const spec = useMemo(() => (state ? toSpec(state, columns) : null), [state, columns]);
  const chartType = state ? effectiveType(state, columns) : null;
  const typeFits = state ? fits(state, columns) : [];

  // Style changes (title, colour) don't need a new query, so they aren't part of the preview key.
  const settled = useDebounced(spec, 300);
  const previewKey = settled ? { ...settled, title: "", color: undefined } : null;
  const preview = useQuery({
    queryKey: ["chart-preview", previewKey],
    queryFn: () => dashboardsApi.preview({ spec: settled! }),
    enabled: open && !!settled,
    placeholderData: (prev) => prev,
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const update = (fn: (s: StudioState) => StudioState) => setState((s) => (s ? fn(s) : s));
  const add = (f: Field, shelf: Shelf) => update((s) => drop(s, f, shelf));

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { kind: string; field?: Field } | undefined;
    setDragging(data?.kind === "field" && data.field ? data.field : null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const from = e.active.data.current as { kind: string; field?: Field; index?: number } | undefined;
    const to = e.over?.data.current as { kind: string; shelf?: Shelf; index?: number } | undefined;
    if (!from || !to) return;
    if (from.kind === "field" && from.field) {
      if (to.kind === "shelf" && to.shelf) add(from.field, to.shelf);
      else if (to.kind === "measure") update((s) => drop(s, from.field!, "rows", to.index));
    } else if (from.kind === "measure" && to.kind === "measure" && from.index !== undefined && to.index !== undefined && from.index !== to.index) {
      update((s) => moveMeasure(s, from.index!, to.index!));
    }
  };

  const accepting = (shelf: Shelf) => (dragging ? shelvesFor(dragging).includes(shelf) : null);
  const typeOf = (name: string) => columns.find((c) => c.name === name)?.type;
  const kind: ChartKind = chartType === "kpi" && (chart?.kind ?? defaultKind) === "kpi" ? "kpi" : "card";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(900px,94dvh)] w-[min(1400px,96vw)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="border-b border-line px-5 py-4">
          <DialogTitle>{chart ? "Edit chart" : "Build a chart"}</DialogTitle>
          <DialogDescription>Drag fields onto Columns and Rows. Add Colour to split it, Filters to narrow it.</DialogDescription>
        </DialogHeader>

        {!state || !ds ? (
          <p className="p-6 text-[14px] text-muted">{datasets && !datasets.length ? "Upload or connect a dataset first." : "Loading…"}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={collisions} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
              {/* Data pane */}
              <aside className="flex min-h-0 flex-col gap-3 border-r border-line p-4">
                <NativeSelect
                  value={state.datasetId}
                  onChange={(e) => setState(emptyState(e.target.value))}
                  aria-label="Dataset"
                  className="w-full"
                >
                  {datasets?.map((d) => (
                    <NativeSelectOption key={d.id} value={d.id}>
                      {d.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <DataPane dimensions={dimensions} measures={measures} onAdd={add} />
              </aside>

              {/* Shelves, Show me, preview */}
              <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
                <div className="flex flex-col gap-2">
                  <ShelfRow
                    shelf="columns"
                    label="Columns"
                    accepting={accepting("columns")}
                    action={
                      <button
                        type="button"
                        onClick={() => update(swap)}
                        aria-label="Swap Columns and Rows"
                        title="Swap Columns and Rows"
                        className={cn("flex size-6 items-center justify-center rounded text-faint hover:text-text", state.swapped && "text-highlight")}
                      >
                        <ArrowLeftRight className="size-3.5" aria-hidden />
                      </button>
                    }
                  >
                    {state.columns ? (
                      <span className={pill}>
                        {typeOf(state.columns.field) === "date" ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<button type="button" className="inline-flex items-center gap-1 font-medium text-sky-400" />}>
                              {BUCKET_NAME[state.columns.bucket]} <ChevronDown className="size-3" aria-hidden />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-36">
                              {BUCKETS.map((b) => (
                                <DropdownMenuItem key={b} onClick={() => update((s) => ({ ...s, columns: s.columns && { ...s.columns, bucket: b } }))}>
                                  {BUCKET_NAME[b]}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                        <span className="max-w-[200px] truncate">{state.columns.field}</span>
                        <Remove label={state.columns.field} onClick={() => update((s) => ({ ...s, columns: null, color: null }))} />
                      </span>
                    ) : (
                      <Hint>Drop a date or category here</Hint>
                    )}
                  </ShelfRow>

                  <ShelfRow shelf="rows" label="Rows" accepting={accepting("rows")}>
                    <SortableContext items={state.rows.map((_, i) => `m:${i}`)} strategy={horizontalListSortingStrategy}>
                      {state.rows.map((m, i) => (
                        <MeasurePill
                          key={`${m.field}-${m.agg}`}
                          m={m}
                          index={i}
                          columns={columns}
                          onAgg={(agg) => update((s) => ({ ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, agg } : r)) }))}
                          onRemove={() => update((s) => ({ ...s, rows: s.rows.filter((_, j) => j !== i) }))}
                        />
                      ))}
                    </SortableContext>
                    {!state.rows.length && <Hint>Drop a measure here, like a number or Rows</Hint>}
                  </ShelfRow>

                  <div className="grid gap-2 xl:grid-cols-2">
                    <ShelfRow shelf="color" label="Colour" accepting={accepting("color")}>
                      {state.color ? (
                        <span className={pill}>
                          <span className="max-w-[200px] truncate">{state.color}</span>
                          <Remove label={state.color} onClick={() => update((s) => ({ ...s, color: null }))} />
                        </span>
                      ) : (
                        <Hint>Split by a category</Hint>
                      )}
                    </ShelfRow>
                    <ShelfRow shelf="filters" label="Filters" accepting={accepting("filters")}>
                      {state.filters.map((f, i) => (
                        <span key={f.field} className={pill}>
                          <Popover>
                            <PopoverTrigger render={<button type="button" className="max-w-[220px] truncate text-left" />}>{describeFilter(f)}</PopoverTrigger>
                            <PopoverContent align="start" className="w-auto">
                              <FilterEditor
                                datasetId={state.datasetId}
                                filter={f}
                                type={typeOf(f.field)}
                                onChange={(next) => update((s) => ({ ...s, filters: s.filters.map((x, j) => (j === i ? next : x)) }))}
                              />
                            </PopoverContent>
                          </Popover>
                          <Remove label={`${f.field} filter`} onClick={() => update((s) => ({ ...s, filters: s.filters.filter((_, j) => j !== i) }))} />
                        </span>
                      ))}
                      {!state.filters.length && <Hint>Narrow the data</Hint>}
                    </ShelfRow>
                  </div>
                </div>

                {/* Show me */}
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chart type">
                  <span className="mr-2 font-mono text-[11px] uppercase tracking-[0.08em] text-faint">Show me</span>
                  {TYPES.map(({ type, label, icon: Icon }) => {
                    const fit = typeFits.find((f) => f.type === type);
                    const active = chartType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={!fit?.ok}
                        aria-pressed={active}
                        title={fit?.ok ? label : `${label}: ${fit?.reason ?? ""}`}
                        onClick={() => update((s) => ({ ...s, chartType: type, swapped: type === "hbar" ? true : type === "bar" ? false : s.swapped }))}
                        className={cn(
                          "flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                          active ? "border-highlight bg-highlight/10 text-text" : "border-line text-muted hover:border-line-strong hover:text-text",
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden />
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Preview */}
                <div className="min-h-[300px] flex-1 rounded-xl border border-line bg-surface p-5">
                  {!spec ? (
                    <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 text-center">
                      <p className="text-[15px] text-text">Your chart appears here</p>
                      <p className="max-w-[44ch] text-[13.5px] text-muted">Drag a measure onto Rows to start. Add a date or category on Columns to break it down.</p>
                    </div>
                  ) : preview.isError ? (
                    <p className="text-[14px] text-accent">{preview.error.message}</p>
                  ) : !preview.data ? (
                    <p className="text-[14px] text-faint">Drawing…</p>
                  ) : (
                    <div className={cn("transition-opacity", preview.isFetching && "opacity-60")}>
                      <InsightHeadline insight={preview.data.insight} fallback={spec.title} />
                      <ChartBody spec={spec} rows={preview.data.rows} height={340} />
                    </div>
                  )}
                </div>

                {/* Settings */}
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-[12.5px] text-muted">
                    Title
                    <Input
                      value={state.titleTouched ? state.title : (spec?.title ?? "")}
                      onChange={(e) => update((s) => ({ ...s, title: e.target.value, titleTouched: true }))}
                      maxLength={200}
                    />
                  </label>
                  {state.columns && (
                    <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                      Sort
                      <NativeSelect value={state.sort ?? ""} onChange={(e) => update((s) => ({ ...s, sort: (e.target.value || null) as StudioState["sort"] }))}>
                        <NativeSelectOption value="">Automatic</NativeSelectOption>
                        <NativeSelectOption value="label">By label</NativeSelectOption>
                        <NativeSelectOption value="value_desc">Largest first</NativeSelectOption>
                        <NativeSelectOption value="value_asc">Smallest first</NativeSelectOption>
                      </NativeSelect>
                    </label>
                  )}
                  {state.columns && (
                    <label className="flex w-24 flex-col gap-1 text-[12.5px] text-muted">
                      Show top
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        value={state.limit ?? ""}
                        placeholder="All"
                        onChange={(e) => update((s) => ({ ...s, limit: e.target.value ? Number(e.target.value) : null }))}
                      />
                    </label>
                  )}
                  {chartType === "gauge" && (
                    <label className="flex w-32 flex-col gap-1 text-[12.5px] text-muted">
                      Goal
                      <Input
                        type="number"
                        value={state.target ?? ""}
                        onChange={(e) => update((s) => ({ ...s, target: e.target.value ? Number(e.target.value) : null }))}
                      />
                    </label>
                  )}
                  {!state.color && (
                    <div className="flex flex-col gap-1 text-[12.5px] text-muted">
                      <span id="studio-colour">Colour</span>
                      <ColorPicker
                        value={state.hex}
                        onValueChange={(v) => update((s) => ({ ...s, hex: v && /^#[0-9a-f]{6}$/i.test(v) ? v : s.hex }))}
                        swatches={SWATCHES}
                        aria-labelledby="studio-colour"
                      />
                    </div>
                  )}
                </div>
              </section>
            </div>

            <DragOverlay dropAnimation={null}>
              {dragging && (
                <span className={cn(pill, "pr-2 shadow-lg")}>
                  {(() => {
                    const Icon = fieldIcon(dragging);
                    return <Icon className="size-3.5 text-highlight" aria-hidden />;
                  })()}
                  {dragging.name}
                </span>
              )}
            </DragOverlay>
          </DndContext>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p className="min-w-0 truncate text-[13px] text-accent">{error}</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!spec || saving} onClick={() => spec && onSave({ spec, kind, note: chart?.note ?? null })}>
              {saving ? "Saving…" : chart ? "Save changes" : "Add to dashboard"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
