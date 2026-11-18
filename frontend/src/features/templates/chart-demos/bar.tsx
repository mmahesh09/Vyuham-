"use client";

import { EChartsBarChart } from "@/components/evilcharts/charts/echarts-bar-chart";

import { DemoFrame, MONTHS, REVENUE_COLORS } from "./shared";

const config = { revenue: { label: "Revenue", colors: REVENUE_COLORS } };

export function BarDemo() {
  return (
    <DemoFrame title="Revenue by month" note="One measure, side by side">
      <EChartsBarChart data={MONTHS} config={config} xDataKey="month" className="h-full w-full" barCategoryGap={14}>
        <EChartsBarChart.XAxis dataKey="month" />
        <EChartsBarChart.Tooltip />
        <EChartsBarChart.Bar dataKey="revenue" />
      </EChartsBarChart>
    </DemoFrame>
  );
}
