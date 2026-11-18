"use client";

import { EChartsPieChart } from "@/components/evilcharts/charts/echarts-pie-chart";

import { DemoFrame } from "./shared";

const data = [
  { channel: "direct", value: 42 },
  { channel: "email", value: 28 },
  { channel: "ads", value: 19 },
  { channel: "referral", value: 11 },
];
const config = {
  direct: { label: "Direct", colors: { light: ["#e8691c"], dark: ["#f59a58"] } },
  email: { label: "Email", colors: { light: ["#c2303c"], dark: ["#f2545b"] } },
  ads: { label: "Ads", colors: { light: ["#b14e0c"], dark: ["#ffb37a"] } },
  referral: { label: "Referral", colors: { light: ["#8a6f5d"], dark: ["#a8978a"] } },
};

export function PieDemo() {
  return (
    <DemoFrame title="Orders by channel" note="Each slice is a share of the total">
      <EChartsPieChart data={data} config={config} dataKey="value" nameKey="channel" className="h-full w-full">
        <EChartsPieChart.Tooltip />
        <EChartsPieChart.Pie innerRadius="52%" outerRadius="92%" paddingAngle={3} />
        <EChartsPieChart.Legend />
      </EChartsPieChart>
    </DemoFrame>
  );
}
