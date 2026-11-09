"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import type { EChartsCoreOption } from "echarts/core";
import { useEffect, useState } from "react";

import { echarts } from "./echarts-setup";

type Props = {
  option: EChartsCoreOption;
  /** Accessible description of what the chart shows. */
  label: string;
  height?: number;
  className?: string;
};

/** ECharts with the brand theme. Animation is off for people who prefer reduced motion. */
export function EChart({ option, label, height = 220, className }: Props) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return (
    <div role="img" aria-label={label} className={className}>
      <ReactEChartsCore
        echarts={echarts}
        theme="brand"
        option={{ animation: !reduced, animationDuration: 500, ...option }}
        style={{ height, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
      />
    </div>
  );
}
