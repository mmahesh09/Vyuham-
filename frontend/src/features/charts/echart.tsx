"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import type { EChartsCoreOption } from "echarts/core";
import { createContext, useContext, useEffect, useState } from "react";

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

/** ECharts with the brand theme. Animation is off for people who prefer reduced motion, and when printing. */
export function EChart({ option, label, height = 220, className }: Props) {
  const staticCharts = useContext(StaticChartsContext);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(staticCharts || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [staticCharts]);

  return (
    <div role="img" aria-label={label} className={className}>
      <ReactEChartsCore
        echarts={echarts}
        theme="brand"
        option={{ animation: !(reduced || staticCharts), animationDuration: 500, ...option }}
        style={{ height, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
      />
    </div>
  );
}
