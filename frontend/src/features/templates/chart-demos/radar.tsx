"use client";

import { EChartsRadarChart } from "@/components/evilcharts/charts/echarts-radar-chart";

import { DemoFrame, ORDER_COLORS, REVENUE_COLORS } from "./shared";

const data = [
  { area: "Sales", thisYear: 82, lastYear: 64 },
  { area: "Repeat", thisYear: 58, lastYear: 66 },
  { area: "Margin", thisYear: 71, lastYear: 52 },
  { area: "Support", thisYear: 88, lastYear: 74 },
  { area: "Delivery", thisYear: 64, lastYear: 70 },
];
const config = { thisYear: { label: "This year", colors: REVENUE_COLORS }, lastYear: { label: "Last year", colors: ORDER_COLORS } };

export function RadarDemo() {
  return (
    <DemoFrame title="Business scorecard" note="Several measures at a glance">
      <EChartsRadarChart data={data} config={config} className="h-full w-full">
        <EChartsRadarChart.PolarGrid />
        <EChartsRadarChart.PolarAngleAxis dataKey="area" />
        <EChartsRadarChart.Tooltip />
        <EChartsRadarChart.Radar dataKey="thisYear" variant="filled" />
        <EChartsRadarChart.Radar dataKey="lastYear" variant="lines" />
      </EChartsRadarChart>
    </DemoFrame>
  );
}
