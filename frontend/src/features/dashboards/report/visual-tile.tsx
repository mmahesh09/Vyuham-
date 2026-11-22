"use client";

import { AlertCircle, ArrowLeft, Download, FileInput, GripVertical, Maximize2, MoreHorizontal, Pencil, Table2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatNumber } from "@/features/charts/build-option";
import type { ResultRow } from "@/features/charts/chart-spec";
import { cn } from "@/lib/utils";

import type { ChartRecord, ChartView, ReportPage } from "../api";
import { ChartBody, InsightHeadline, ResultTable } from "../insight-card";
import { kpiValue } from "../kpi-grid";

export type VisualActions = {
  onEdit?: () => void;
  onDelete?: () => void;
  onMove?: (pageId: string) => void;
  onFocus?: () => void;
};

type Props = {
  chart: ChartRecord;
  view?: ChartView;
  /** Height for the chart drawing, in px. */
  bodyHeight: number;
  editing?: boolean;
  canEdit?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  actions: VisualActions;
  /** Other pages this visual can move to. */
  pages?: ReportPage[];
  /** This visual is the cross-filter source: the picked category. */
  picked?: string | null;
  onPick?: (value: string) => void;
  onClearPick?: () => void;
  /** Focus mode: fills the canvas, with a way back. */
  focused?: boolean;
  onExitFocus?: () => void;
};

const iconBtn =
  "flex size-7 items-center justify-center rounded-[4px] text-faint transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-highlight";

/** The rows behind a visual as a CSV file, built in the browser from what's already on screen. */
function downloadCsv(title: string, rows: ResultRow[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Quote when needed, and stop spreadsheet formulas from running (=, +, -, @ at the start).
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w\- ]+/g, "").trim() || "chart"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * One visual on the report canvas, with Power BI-style chrome: focus mode, show as table, export data
 * and a "…" menu. Clicking the frame selects it for the side panes; clicking a bar cross-filters.
 */
export function VisualTile({
  chart,
  view,
  bodyHeight,
  editing = false,
  canEdit = false,
  selected = false,
  onSelect,
  actions,
  pages = [],
  picked = null,
  onPick,
  onClearPick,
  focused = false,
  onExitFocus,
}: Props) {
  const [asTable, setAsTable] = useState(false);
  // The chart gets exactly the room left under the header (which grows with a two-line headline).
  const body = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRoom(Math.round(e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const chartHeight = room ? Math.max(80, room - 10) : bodyHeight;
  const isKpi = chart.kind === "kpi" || chart.spec.chartType === "kpi";
  const { raw, change } = kpiValue(chart, view);
  const rows = view?.rows ?? [];
  const title = chart.spec.title;

  return (
    <div
      role="group"
      aria-label={title}
      aria-current={selected || undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" && actions.onFocus && !focused) actions.onFocus();
        if (e.key.toLowerCase() === "t" && !isKpi) setAsTable((v) => !v);
        if (e.key === "Escape" && focused) onExitFocus?.();
      }}
      tabIndex={0}
      className={cn(
        "group/visual relative flex h-full flex-col overflow-hidden rounded-[8px] border bg-surface px-4 pb-3 pt-2.5 outline-none transition-[border-color,box-shadow] duration-200",
        "shadow-[0_1px_2px_rgba(0,0,0,0.18),0_8px_24px_-16px_rgba(0,0,0,0.5)] focus-visible:ring-2 focus-visible:ring-highlight/60",
        selected ? "border-highlight/80 ring-1 ring-highlight/40" : editing ? "border-primary/50" : "border-line hover:border-line-strong",
      )}
      style={chart.spec.color && isKpi ? { boxShadow: `inset 0 2px 0 ${chart.spec.color}` } : undefined}
    >
      <div className="flex min-h-7 items-start justify-between gap-2">
        <div className="min-w-0 flex-1 pt-1">
          {focused && (
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), onExitFocus?.())}
              className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-highlight hover:underline"
            >
              <ArrowLeft className="size-3.5" aria-hidden /> Back to report
            </button>
          )}
          {view?.error ? (
            <p className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold text-text">
              <AlertCircle className="size-4 shrink-0 text-accent" aria-hidden /> {title}
            </p>
          ) : isKpi ? (
            <p className="truncate text-[13px] text-muted">{title}</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              <p className="truncate text-[12px] font-medium uppercase tracking-[0.06em] text-faint">{title}</p>
              <div className="[&_h3]:text-[14.5px] [&_h3]:leading-snug">
                <InsightHeadline insight={view?.insight} fallback={title} />
              </div>
            </div>
          )}
          {picked && (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-[4px] bg-highlight/12 px-1.5 py-0.5 text-[11.5px] text-highlight">
              Filtering other visuals: {picked}
              {onClearPick && (
                <button type="button" aria-label="Clear cross-filter" onClick={(e) => (e.stopPropagation(), onClearPick())} className="rounded-[3px] hover:bg-highlight/20">
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </span>
          )}
        </div>

        {/* Visual header: visible on hover, focus or selection, like Power BI. */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity duration-150",
            editing || selected || focused ? "opacity-100" : "opacity-0 group-focus-within/visual:opacity-100 group-hover/visual:opacity-100 max-lg:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {editing ? (
            <GripVertical className="canvas-handle size-4 cursor-grab text-faint" aria-label="Drag to move" />
          ) : (
            <>
              {!isKpi && !view?.error && (
                <button type="button" className={cn(iconBtn, asTable && "bg-surface-2 text-text")} aria-pressed={asTable} title="Show as table (T)" onClick={() => setAsTable((v) => !v)}>
                  <Table2 className="size-3.5" aria-hidden />
                  <span className="sr-only">Show as table</span>
                </button>
              )}
              {actions.onFocus && !focused && (
                <button type="button" className={iconBtn} title="Focus mode (Enter)" onClick={actions.onFocus}>
                  <Maximize2 className="size-3.5" aria-hidden />
                  <span className="sr-only">Focus mode</span>
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More options for ${title}`} className="size-7 rounded-[4px] text-faint hover:text-text" />}>
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem disabled={!rows.length} onClick={() => downloadCsv(title, rows)}>
                    <Download /> Export data (CSV)
                  </DropdownMenuItem>
                  {canEdit && (
                    <>
                      {actions.onEdit && (
                        <DropdownMenuItem onClick={actions.onEdit}>
                          <Pencil /> Edit in studio
                        </DropdownMenuItem>
                      )}
                      {actions.onMove && pages.length > 0 && (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <FileInput /> Move to page
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {pages.map((p) => (
                              <DropdownMenuItem key={p.id} onClick={() => actions.onMove?.(p.id)}>
                                {p.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )}
                      {actions.onDelete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={actions.onDelete}>
                            <Trash2 /> Remove
                          </DropdownMenuItem>
                        </>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      <div ref={body} className="min-h-0 flex-1">
        {!view ? (
          <div className="mt-3 h-[calc(100%-12px)] min-h-16 animate-pulse rounded-[6px] bg-line/40" />
        ) : view.error ? (
          <p className="mt-2 text-[13px] text-accent">{view.error}</p>
        ) : isKpi ? (
          <div className="flex h-full flex-col justify-center gap-1">
            <span className="type-kpi truncate">{formatNumber(raw)}</span>
            {change != null && (
              <span className={cn("text-[12.5px] font-semibold", change > 0.5 ? "text-highlight" : change < -0.5 ? "text-accent" : "text-faint")}>
                {change > 0 ? "+" : ""}
                {change.toFixed(1)}% <span className="font-normal text-faint">vs previous period</span>
              </span>
            )}
          </div>
        ) : asTable ? (
          <ResultTable spec={chart.spec} rows={rows} className="mt-2 h-[calc(100%-8px)]" maxHeight="" />
        ) : (
          <div className="-mt-3">
            <ChartBody spec={chart.spec} rows={rows} height={chartHeight} onPick={onPick} selected={picked} />
          </div>
        )}
      </div>
    </div>
  );
}
