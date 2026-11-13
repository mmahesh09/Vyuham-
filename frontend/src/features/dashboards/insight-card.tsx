"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Circle, GripVertical } from "lucide-react";

import { axisLabel, buildOption, formatNumber, metricKey } from "@/features/charts/build-option";
import { metricLabel, type ChartSpec, type ResultRow } from "@/features/charts/chart-spec";
import { EChart } from "@/features/charts/echart";
import { EmptyState } from "@/components/app/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { ChartRecord, ChartView, Insight } from "./api";
import { ChartMenu, type ChartActions } from "./chart-menu";

const TREND = {
  up: { icon: ArrowUpRight, tone: "text-highlight", label: "Up" },
  down: { icon: ArrowDownRight, tone: "text-accent", label: "Down" },
  flat: { icon: Circle, tone: "text-faint", label: "Flat" },
};

/** A small table for "table" charts: the group and each measure. */
function ResultTable({ spec, rows }: { spec: ChartSpec; rows: ResultRow[] }) {
  const group = spec.groupBy;
  return (
    <div className="mt-5 max-h-72 overflow-auto rounded-lg border border-line">
      <table className="w-full text-left text-[14px]">
        <thead className="sticky top-0 bg-surface-2 text-muted">
          <tr>
            {group && <th className="px-3 py-2 font-medium">{group}</th>}
            {spec.metrics.map((m) => (
              <th key={metricKey(m)} className="px-3 py-2 text-right font-medium">
                {metricLabel(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, n) => (
            <tr key={n}>
              {group && <td className="px-3 py-2">{axisLabel(String(r[group] ?? "—"))}</td>}
              {spec.metrics.map((m) => (
                <td key={metricKey(m)} className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(r[metricKey(m)])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The chart body only: used by the feed card, the chart builder preview and Ask answers. */
export function ChartBody({ spec, rows, height }: { spec: ChartSpec; rows: ResultRow[]; height?: number }) {
  if (!rows.length)
    return <EmptyState compact className="mt-5" title="No data for these filters" description="Widen the date range or clear a filter to see this chart." />;
  if (spec.chartType === "table") return <ResultTable spec={spec} rows={rows} />;
  if (spec.chartType === "kpi")
    return <p className="type-kpi mt-4 text-[44px]">{formatNumber(rows[0]?.[metricKey(spec.metrics[0])])}</p>;
  return (
    <EChart
      className="mt-5"
      height={height ?? (spec.chartType === "line" || spec.chartType === "area" ? 240 : 220)}
      label={spec.title}
      option={buildOption(spec, rows, { highlightLast: spec.chartType === "bar" && spec.sort === "label" })}
    />
  );
}

export function InsightHeadline({ insight, fallback }: { insight: Insight | null | undefined; fallback: string }) {
  const trend = insight?.trend ?? "flat";
  const { icon: Icon, tone, label } = TREND[trend];
  return (
    <h3 className="type-insight flex max-w-[68ch] items-start gap-2.5 text-text">
      <Icon className={cn("mt-1.5 size-4 shrink-0", tone, trend === "flat" && "size-3 fill-current")} strokeWidth={2.6} aria-hidden />
      {/* The arrow's colour isn't the only signal: screen readers hear the direction too. */}
      {insight && <span className="sr-only">{label}:</span>}
      {insight?.headline ?? fallback}
    </h3>
  );
}

type Props = { chart: ChartRecord; view?: ChartView; canEdit: boolean; draggable: boolean; actions: ChartActions };

/** One story card: the sentence first, then the chart. Draggable by its handle. */
export function InsightCard({ chart, view, canEdit, draggable, actions }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: chart.id,
    disabled: !draggable,
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "rounded-xl border border-line bg-surface p-5 sm:p-6",
        isDragging && "relative z-10 border-line-strong shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9)]",
      )}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          {view?.error ? (
            <h3 className="flex items-start gap-2.5 text-[17px] font-semibold text-text">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              {chart.spec.title}
            </h3>
          ) : (
            <InsightHeadline insight={view?.insight} fallback={chart.spec.title} />
          )}
          <p className="max-w-[72ch] pl-6.5 text-[14px] leading-relaxed text-muted">
            {view?.error ? <span className="text-accent">{view.error}</span> : (view?.insight?.note || chart.spec.title)}
          </p>
          {chart.note && <p className="max-w-[72ch] pl-6.5 text-[13px] italic text-faint">“{chart.note}”</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && <ChartMenu title={chart.spec.title} {...actions} />}
          {draggable && (
            <button
              ref={setActivatorNodeRef}
              type="button"
              aria-label={`Reorder card: ${chart.spec.title}`}
              className="flex size-10 cursor-grab touch-none items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface-2 hover:text-text active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-5" aria-hidden />
            </button>
          )}
        </div>
      </header>
      {!view ? (
        <Skeleton className="mt-5 h-[220px] rounded-lg" />
      ) : view.error ? null : (
        <ChartBody spec={chart.spec} rows={view.rows} />
      )}
    </article>
  );
}
