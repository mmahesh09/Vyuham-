"use client";

import "react-grid-layout/css/styles.css";

import { AlertCircle, GripVertical } from "lucide-react";
import { useEffect, useRef } from "react";
import { ResponsiveGridLayout, useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";

import { formatNumber, metricKey } from "@/features/charts/build-option";
import { cn } from "@/lib/utils";

import type { ChartRecord, ChartView, KpiLayoutItem } from "./api";
import { ChartMenu, type ChartActions } from "./chart-menu";
import { ChartBody, InsightHeadline } from "./insight-card";

const ROW = 56;
const BREAKPOINTS = { lg: 1000, md: 640, sm: 0 };
const COLS = { lg: 12, md: 6, sm: 1 };

/** Sensible first layout: key numbers in a row of four, charts two per row. */
function defaultLayout(charts: ChartRecord[]): KpiLayoutItem[] {
  const out: KpiLayoutItem[] = [];
  let kx = 0;
  let ky = 0;
  for (const c of charts.filter((c) => c.kind === "kpi")) {
    out.push({ i: c.id, x: kx, y: ky, w: 3, h: 2 });
    kx += 3;
    if (kx >= 12) {
      kx = 0;
      ky += 2;
    }
  }
  const y = ky + (kx ? 2 : 0);
  charts
    .filter((c) => c.kind === "card")
    .forEach((c, n) => {
      out.push({ i: c.id, x: (n % 2) * 6, y: y + Math.floor(n / 2) * 6, w: 6, h: 6 });
    });
  return out;
}

function Tile({ chart, view, h, editing, canEdit, actions }: { chart: ChartRecord; view?: ChartView; h: number; editing: boolean; canEdit: boolean; actions: ChartActions }) {
  const bodyHeight = Math.max(80, h * ROW + (h - 1) * 12 - 74);
  const isKpi = chart.kind === "kpi" || chart.spec.chartType === "kpi";
  const value = view?.insight?.value ?? view?.rows[0]?.[metricKey(chart.spec.metrics[0])] ?? null;
  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-[16px] border bg-surface p-4", editing ? "border-primary/60" : "border-line")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {view?.error ? (
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
              <AlertCircle className="size-4 text-accent" aria-hidden /> {chart.spec.title}
            </p>
          ) : isKpi ? (
            <p className="truncate text-sm text-muted">{chart.spec.title}</p>
          ) : (
            <div className="[&_h3]:text-[15px] [&_h3]:leading-tight">
              <InsightHeadline insight={view?.insight} fallback={chart.spec.title} />
            </div>
          )}
        </div>
        <span className="flex shrink-0 items-center">
          {editing ? <GripVertical className="canvas-handle size-4 cursor-grab text-faint" aria-label="Drag to move" /> : canEdit && <ChartMenu title={chart.spec.title} {...actions} />}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {!view ? (
          <div className="mt-3 h-full animate-pulse rounded-lg bg-line/40" />
        ) : view.error ? (
          <p className="mt-2 text-[13px] text-accent">{view.error}</p>
        ) : isKpi ? (
          <div className="flex h-full flex-col justify-center">
            <span className="truncate text-[clamp(24px,3vw,36px)] font-light tabular-nums">{formatNumber(value)}</span>
            {view.insight?.change != null && (
              <span className={cn("text-[13px] font-semibold", view.insight.change > 0 ? "text-highlight" : view.insight.change < 0 ? "text-accent" : "text-faint")}>
                {view.insight.change > 0 ? "+" : ""}
                {view.insight.change.toFixed(1)}% vs previous period
              </span>
            )}
          </div>
        ) : (
          <div className="-mt-2">
            <ChartBody spec={chart.spec} rows={view.rows} height={bodyHeight} />
          </div>
        )}
      </div>
    </div>
  );
}

type Props = {
  charts: ChartRecord[];
  views: Map<string, ChartView>;
  layout: KpiLayoutItem[];
  editing: boolean;
  canEdit: boolean;
  onLayoutChange?: (layout: KpiLayoutItem[]) => void;
  actionsFor: (chart: ChartRecord) => ChartActions;
};

/** Dashboard Lab: every chart on a free-form grid. Drag by the handle, resize from the corner. */
export function CanvasView({ charts, views, layout, editing, canEdit, onLayoutChange, actionsFor }: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  const saved = new Map(layout.map((l) => [l.i, l]));
  const fallback = new Map(defaultLayout(charts).map((l) => [l.i, l]));
  const lg = charts.map((c) => ({ ...(saved.get(c.id) ?? fallback.get(c.id)!), minW: 2, minH: 2 }));
  const layouts = {
    lg,
    md: lg.map((l) => ({ ...l, x: l.x >= 6 ? 0 : l.x, w: Math.min(l.w, 6) })),
    sm: lg.map((l, n) => ({ ...l, x: 0, y: n * l.h, w: 1 })),
  };
  const h = new Map(lg.map((l) => [l.i, l.h]));

  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const save = (items: readonly LayoutItem[]) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onLayoutChange?.(items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))), 600);
  };

  return (
    <div ref={containerRef} aria-label="Dashboard canvas" role="region" data-tour="canvas">
      {mounted && (
        <ResponsiveGridLayout
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          layouts={layouts}
          rowHeight={ROW}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: editing, handle: ".canvas-handle", bounded: false, threshold: 3 }}
          resizeConfig={{ enabled: editing, handles: ["se", "e", "s"] }}
          onLayoutChange={(_l: Layout, all) => {
            if (editing && width >= BREAKPOINTS.lg && all.lg) save(all.lg as readonly LayoutItem[]);
          }}
        >
          {charts.map((c) => (
            <div key={c.id}>
              <Tile chart={c} view={views.get(c.id)} h={h.get(c.id) ?? 4} editing={editing} canEdit={canEdit} actions={actionsFor(c)} />
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
