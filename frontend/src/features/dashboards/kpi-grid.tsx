"use client";

import "react-grid-layout/css/styles.css";

import { ArrowDownRight, ArrowUpRight, GripVertical, Minus } from "lucide-react";
import { useEffect, useRef } from "react";
import { ResponsiveGridLayout, useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";

import { metricKey, formatNumber } from "@/features/charts/build-option";
import { cn } from "@/lib/utils";

import type { ChartRecord, ChartView, KpiLayoutItem } from "./api";
import { ChartMenu, type ChartActions } from "./chart-menu";

const BREAKPOINTS = { lg: 1000, md: 600, sm: 0 };
const COLS = { lg: 12, md: 6, sm: 2 };

function defaultLayouts(ids: string[], saved: KpiLayoutItem[]) {
  const w = ids.length <= 4 ? 12 / Math.max(ids.length, 1) : 3;
  const known = new Map(saved.map((s) => [s.i, s]));
  return {
    lg: ids.map((i, n) => ({ ...(known.get(i) ?? { i, x: (n * w) % 12, y: Math.floor((n * w) / 12), w, h: 1 }), minW: 2, maxW: 12 })),
    md: ids.map((i, n) => ({ i, x: (n % 2) * 3, y: Math.floor(n / 2), w: 3, h: 1 })),
    sm: ids.map((i, n) => ({ i, x: n % 2, y: Math.floor(n / 2), w: 1, h: 1 })),
  };
}

function KpiTile({
  chart,
  view,
  editing,
  canEdit,
  allTime,
  actions,
}: {
  chart: ChartRecord;
  view?: ChartView;
  editing: boolean;
  canEdit: boolean;
  allTime: boolean;
  actions: ChartActions;
}) {
  const insight = view?.insight;
  const raw = insight?.value ?? view?.rows[0]?.[metricKey(chart.spec.metrics[0])] ?? null;
  const change = insight?.change ?? null;
  const up = change !== null && change > 0.5;
  const down = change !== null && change < -0.5;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;

  return (
    <div
      className={cn(
        "flex h-full flex-col justify-between gap-1 rounded-[16px] border bg-surface p-5",
        editing ? "border-primary/60" : "border-line",
      )}
      style={chart.spec.color ? { borderTopColor: chart.spec.color, borderTopWidth: 3 } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[14px] text-muted" title={chart.spec.title}>
          {chart.spec.title}
        </span>
        <span className="flex items-center">
          {editing && <GripVertical className="kpi-handle size-4 cursor-grab text-faint" aria-label="Drag to move" />}
          {canEdit && !editing && <ChartMenu title={chart.spec.title} {...actions} />}
        </span>
      </div>
      {view?.error ? (
        <span className="text-[13px] text-accent">{view.error}</span>
      ) : (
        <span className="truncate text-[30px] font-light tracking-[-0.02em] text-text tabular-nums">{view ? formatNumber(raw) : "…"}</span>
      )}
      {change !== null ? (
        <span className={cn("flex items-center gap-1 text-[13px] font-semibold", up ? "text-highlight" : down ? "text-accent" : "text-faint")}>
          <Icon className="size-3.5" strokeWidth={2.6} aria-hidden />
          {change >= 0 ? "+" : ""}
          {change.toFixed(1)}% <span className="font-normal text-faint">vs previous period</span>
        </span>
      ) : (
        <span className="truncate text-[12px] text-faint">{allTime ? "All time" : (insight?.note ?? " ")}</span>
      )}
    </div>
  );
}

type Props = {
  charts: ChartRecord[];
  views: Map<string, ChartView>;
  layout: KpiLayoutItem[];
  editing: boolean;
  canEdit: boolean;
  /** No date range picked: there's no previous period to compare with. */
  allTime: boolean;
  onLayoutChange?: (layout: KpiLayoutItem[]) => void;
  actionsFor: (chart: ChartRecord) => ChartActions;
};

/** KPI tiles on a responsive grid; in edit mode they can be dragged and widened (saved for everyone). */
export function KpiGrid({ charts, views, layout, editing, canEdit, allTime, onLayoutChange, actionsFor }: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  const ids = charts.map((c) => c.id);
  const layouts = defaultLayouts(ids, layout);

  // Save the large-screen layout a moment after the last drag/resize.
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const save = (items: readonly LayoutItem[]) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onLayoutChange?.(items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))), 600);
  };

  if (!charts.length) return null;
  return (
    <div ref={containerRef} aria-label="Key numbers" role="region">
      {mounted && (
        <ResponsiveGridLayout
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          layouts={layouts}
          rowHeight={136}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: editing, handle: ".kpi-handle", bounded: false, threshold: 3 }}
          resizeConfig={{ enabled: editing, handles: ["e"] }}
          onLayoutChange={(_layout: Layout, all) => {
            if (editing && width >= BREAKPOINTS.lg && all.lg) save(all.lg as readonly LayoutItem[]);
          }}
        >
          {charts.map((c) => (
            <div key={c.id}>
              <KpiTile chart={c} view={views.get(c.id)} editing={editing} canEdit={canEdit} allTime={allTime} actions={actionsFor(c)} />
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
