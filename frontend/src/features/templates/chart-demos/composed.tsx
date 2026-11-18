"use client";

import { EChartsComposedChart } from "@/components/evilcharts/charts/echarts-composed-chart";

import { DemoFrame, MONTHS, ORDER_COLORS, REVENUE_COLORS } from "./shared";

const config = { revenue: { label: "Revenue", colors: REVENUE_COLORS }, orders: { label: "Orders", colors: ORDER_COLORS } };

export function ComposedDemo() {
  return (
    <DemoFrame title="Revenue against orders" note="Bars and a line on one chart">
      <EChartsComposedChart data={MONTHS} config={config} xDataKey="month" className="h-full w-full" curveType="monotone">
        <EChartsComposedChart.Grid />
        <EChartsComposedChart.XAxis dataKey="month" />
        <EChartsComposedChart.Tooltip />
        <EChartsComposedChart.Bar dataKey="revenue" />
        <EChartsComposedChart.Line dataKey="orders" strokeVariant="solid" />
      </EChartsComposedChart>
    </DemoFrame>
  );
}
