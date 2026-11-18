"use client";

import { EChartsLineChart } from "@/components/evilcharts/charts/echarts-line-chart";

import { DemoFrame, MONTHS, ORDER_COLORS, REVENUE_COLORS } from "./shared";

const config = { revenue: { label: "Revenue", colors: REVENUE_COLORS }, orders: { label: "Orders", colors: ORDER_COLORS } };

export function LineDemo() {
  return (
    <DemoFrame title="Monthly trend" note="Compare two lines month by month">
      <EChartsLineChart data={MONTHS} config={config} xDataKey="month" className="h-full w-full" curveType="monotone">
        <EChartsLineChart.Grid />
        <EChartsLineChart.YAxis />
        <EChartsLineChart.XAxis dataKey="month" />
        <EChartsLineChart.Tooltip />
        <EChartsLineChart.Line dataKey="revenue" strokeVariant="solid" strokeWidth={2} />
        <EChartsLineChart.Line dataKey="orders" strokeVariant="dashed" strokeWidth={1.5} />
      </EChartsLineChart>
    </DemoFrame>
  );
}
