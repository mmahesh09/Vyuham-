"use client";

import "react-grid-layout/css/styles.css";

import { useEffect, useRef, type ReactNode } from "react";
import { ResponsiveGridLayout, useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";

import { cn } from "@/lib/utils";

import type { ChartRecord, KpiLayoutItem } from "./api";

const ROW = 56;
const MARGIN = 12;
// lg starts low: the report canvas shares the row with the side panes, and should keep its layout there.
const BREAKPOINTS = { lg: 680, md: 480, sm: 0 };
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

/** Pixel height left for the chart drawing in a tile `h` rows tall (minus its header). */
export const tileBodyHeight = (h: number) => Math.max(80, h * ROW + (h - 1) * MARGIN - 64);

type Props = {
  charts: ChartRecord[];
  layout: KpiLayoutItem[];
  editing: boolean;
  onLayoutChange?: (layout: KpiLayoutItem[]) => void;
  /** Draws one visual; `bodyHeight` is the space left for its chart. */
  renderTile: (chart: ChartRecord, bodyHeight: number) => ReactNode;
};

/** The report canvas: every visual on a free-form grid. Drag by the handle, resize from the edges. */
export function CanvasView({ charts, layout, editing, onLayoutChange, renderTile }: Props) {
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
    <div
      ref={containerRef}
      aria-label="Report canvas"
      role="region"
      data-tour="canvas"
      className={cn(
        "rounded-[8px] transition-colors",
        // While arranging, a faint 8px dot grid shows where tiles snap.
        editing && "bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-[length:16px_16px] outline-1 outline-dashed outline-offset-4 outline-line-strong",
      )}
    >
      {mounted && (
        <ResponsiveGridLayout
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          layouts={layouts}
          rowHeight={ROW}
          margin={[MARGIN, MARGIN]}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: editing, handle: ".canvas-handle", bounded: false, threshold: 3 }}
          resizeConfig={{ enabled: editing, handles: ["se", "e", "s"] }}
          onLayoutChange={(_l: Layout, all) => {
            if (editing && width >= BREAKPOINTS.lg && all.lg) save(all.lg as readonly LayoutItem[]);
          }}
        >
          {charts.map((c) => (
            <div key={c.id}>{renderTile(c, tileBodyHeight(h.get(c.id) ?? 4))}</div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
