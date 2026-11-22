"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import type { EChartsCoreOption } from "echarts/core";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useIslandTheme } from "@/lib/use-island-theme";

import { lightColors } from "./brand";
import { echarts } from "./echarts-setup";

type Props = {
  option: EChartsCoreOption;
  /** Accessible description of what the chart shows. */
  label: string;
  height?: number;
  className?: string;
  /** Called with the category, slice or block name when a data point is clicked (cross-filtering). */
  onPick?: (name: string) => void;
  /** A picked name: every other point is dimmed. */
  selected?: string | null;
};

/** True on the print page (PDF reports): charts draw in one pass, with no animation to wait for. */
export const StaticChartsContext = createContext(false);

type Obj = Record<string, unknown>;
const DIM = { opacity: 0.28 };

/**
 * Fade every data point except the selected one, the way Power BI shows a cross-filter source.
 * Works on named data (pie, funnel, treemap) and on category axes (bars, lines).
 */
function dimExcept(option: EChartsCoreOption, name: string): EChartsCoreOption {
  const o = option as Obj;
  const axes = [o.xAxis, o.yAxis].flatMap((a) => (Array.isArray(a) ? a : a ? [a] : [])) as Obj[];
  const categories = axes.find((a) => a.type === "category" && Array.isArray(a.data))?.data as unknown[] | undefined;
  const series = (Array.isArray(o.series) ? o.series : o.series ? [o.series] : []) as Obj[];
  return {
    ...o,
    series: series.map((s) => {
      if (!Array.isArray(s.data)) return s;
      const data = (s.data as unknown[]).map((d, i) => {
        const isObj = d !== null && typeof d === "object" && !Array.isArray(d);
        const itemName = isObj ? (d as Obj).name : categories?.[i];
        if (itemName === undefined || String(itemName) === name) return d;
        return isObj ? { ...(d as Obj), itemStyle: { ...((d as Obj).itemStyle as Obj | undefined), ...DIM } } : { value: d, itemStyle: DIM };
      });
      return { ...s, data };
    }),
  };
}

/**
 * ECharts with the brand theme for the current light/dark mode. Options are written with the dark
 * palette; in light mode their brand colours are swapped for the light ones. Animation is off for
 * people who prefer reduced motion, and when printing.
 */
export function EChart({ option, label, height = 220, className, onPick, selected }: Props) {
  const staticCharts = useContext(StaticChartsContext);
  const [reduced, setReduced] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const mode = useIslandTheme(box);
  useEffect(() => {
    setReduced(staticCharts || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [staticCharts]);

  const themed = useMemo(() => {
    const base = mode === "light" ? lightColors(option) : option;
    return selected ? dimExcept(base, selected) : base;
  }, [mode, option, selected]);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);
  const events = useMemo(
    () => ({
      click: (p: { name?: unknown }) => {
        if (pick.current && p.name !== undefined && p.name !== null && String(p.name) !== "") pick.current(String(p.name));
      },
    }),
    [],
  );

  return (
    <div ref={box} role="img" aria-label={label} className={className} style={onPick ? { cursor: "pointer" } : undefined}>
      <ReactEChartsCore
        // A theme change needs a fresh chart instance.
        key={mode}
        echarts={echarts}
        theme={mode === "light" ? "brand-light" : "brand"}
        option={{ animation: !(reduced || staticCharts), animationDuration: 500, ...themed }}
        style={{ height, width: "100%" }}
        opts={{ renderer: "canvas" }}
        onEvents={onPick ? events : undefined}
        notMerge
      />
    </div>
  );
}
