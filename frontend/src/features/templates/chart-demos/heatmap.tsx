"use client";

import { EChartsHeatmapChart, type HeatmapDatum } from "@/components/evilcharts/charts/echarts-heatmap-chart";

import { DemoFrame } from "./shared";

// A repeatable pattern: busier on weekdays, with a slow rise and fall across the months.
const data: HeatmapDatum[] = Array.from({ length: 181 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 0, 1 + i));
  const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
  return { date: day.toISOString().slice(0, 10), value: Math.round((weekend ? 3 : 9) + 6 * Math.abs(Math.sin(i / 17))) };
});

const config = { orders: { label: "Orders", colors: { light: ["#fbd9bd", "#f5a66d", "#e8691c", "#a84509"], dark: ["#3a1f10", "#7a3a14", "#c75f1e", "#f59a58"] } } };

export function HeatmapDemo() {
  return (
    <DemoFrame title="Orders per day" note="Spot busy days across the calendar">
      <EChartsHeatmapChart className="h-full w-full" data={data} config={config} range={["2026-01-01", "2026-06-30"]}>
        <EChartsHeatmapChart.Cell dataKey="orders" radius={2} gap={3} />
        <EChartsHeatmapChart.MonthLabel />
        <EChartsHeatmapChart.DayLabel />
        <EChartsHeatmapChart.Tooltip />
        <EChartsHeatmapChart.Legend />
      </EChartsHeatmapChart>
    </DemoFrame>
  );
}
