import { BarChart, FunnelChart, GaugeChart, LineChart, PieChart, ScatterChart, TreemapChart } from "echarts/charts";
import { DatasetComponent, GridComponent, LegendComponent, MarkPointComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

import { outfit } from "@/lib/fonts";

// Register only what the app uses, so the bundle stays a fraction of full ECharts.
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  FunnelChart,
  TreemapChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

export const BRAND = {
  primary: "#705cbb",
  accent: "#cb72d0",
  highlight: "#cea3f5",
  line: "#221c4a",
  text: "#f5f2ff",
  muted: "#b3a9d6",
  faint: "#8f86b3",
};

const axis = {
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: BRAND.faint, fontSize: 11 },
  splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
};

echarts.registerTheme("brand", {
  color: [BRAND.highlight, BRAND.primary, BRAND.accent, "#8f86b3", "#4b3f8f"],
  backgroundColor: "transparent",
  textStyle: { fontFamily: `${outfit.style.fontFamily}, system-ui, sans-serif`, color: BRAND.muted },
  categoryAxis: axis,
  valueAxis: axis,
  tooltip: {
    backgroundColor: "rgba(20, 8, 29, 0.92)",
    borderColor: "rgba(255,255,255,0.1)",
    textStyle: { color: BRAND.text, fontSize: 12 },
  },
  legend: { textStyle: { color: BRAND.muted } },
});

export { echarts };
