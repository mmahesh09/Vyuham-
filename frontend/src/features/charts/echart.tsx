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
};

/** True on the print page (PDF reports): charts draw in one pass, with no animation to wait for. */
export const StaticChartsContext = createContext(false);

/**
 * ECharts with the brand theme for the current light/dark mode. Options are written with the dark
 * palette; in light mode their brand colours are swapped for the light ones. Animation is off for
 * people who prefer reduced motion, and when printing.
 */
export function EChart({ option, label, height = 220, className }: Props) {
  const staticCharts = useContext(StaticChartsContext);
  const [reduced, setReduced] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const mode = useIslandTheme(box);
  useEffect(() => {
    setReduced(staticCharts || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [staticCharts]);

  const themed = useMemo(() => (mode === "light" ? lightColors(option) : option), [mode, option]);

  return (
    <div ref={box} role="img" aria-label={label} className={className}>
      <ReactEChartsCore
        // A theme change needs a fresh chart instance.
        key={mode}
        echarts={echarts}
        theme={mode === "light" ? "brand-light" : "brand"}
        option={{ animation: !(reduced || staticCharts), animationDuration: 500, ...themed }}
        style={{ height, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
      />
    </div>
  );
}
