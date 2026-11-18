"use client";

import { EChartsAreaChart } from "@/components/evilcharts/charts/echarts-area-chart";

import { DemoFrame, MONTHS, ORDER_COLORS, REVENUE_COLORS } from "./shared";

const config = { revenue: { label: "Revenue", colors: REVENUE_COLORS }, orders: { label: "Orders", colors: ORDER_COLORS } };

export function AreaDemo() {
  return (
    <DemoFrame title="Revenue and orders" note="Two measures over time">
      <EChartsAreaChart data={MONTHS} config={config} xDataKey="month" className="h-full w-full" curveType="monotone">
        <EChartsAreaChart.Grid />
        <EChartsAreaChart.XAxis dataKey="month" />
        <EChartsAreaChart.Tooltip />
        <EChartsAreaChart.Area dataKey="revenue" variant="gradient" strokeVariant="solid" strokeWidth={2} />
        <EChartsAreaChart.Area dataKey="orders" variant="gradient" strokeVariant="solid" strokeWidth={2} />
      </EChartsAreaChart>
    </DemoFrame>
  );
}
