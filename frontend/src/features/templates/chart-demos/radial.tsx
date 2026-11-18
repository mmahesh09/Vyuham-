"use client";

import { EChartsRadialChart } from "@/components/evilcharts/charts/echarts-radial-chart";

import { DemoFrame } from "./shared";

const data = [
  { goal: "revenue", value: 82 },
  { goal: "orders", value: 67 },
  { goal: "margin", value: 54 },
];
const config = {
  revenue: { label: "Revenue goal", colors: { light: ["#e8691c"], dark: ["#f59a58"] } },
  orders: { label: "Orders goal", colors: { light: ["#c2303c"], dark: ["#f2545b"] } },
  margin: { label: "Margin goal", colors: { light: ["#b14e0c"], dark: ["#ffb37a"] } },
};

export function RadialDemo() {
  return (
    <DemoFrame title="Progress to goal" note="Each ring is one target">
      <EChartsRadialChart data={data} config={config} nameKey="goal" max={100} innerRadius="30%" outerRadius="96%" className="h-full w-full">
        <EChartsRadialChart.Tooltip />
        <EChartsRadialChart.RadialBar dataKey="value" cornerRadius={6} />
        <EChartsRadialChart.Legend />
      </EChartsRadialChart>
    </DemoFrame>
  );
}
