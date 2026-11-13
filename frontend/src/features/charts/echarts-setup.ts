import { BarChart, FunnelChart, GaugeChart, LineChart, PieChart, ScatterChart, TreemapChart } from "echarts/charts";
import { DatasetComponent, GridComponent, LegendComponent, MarkPointComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { LegacyGridContainLabel } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";

import { outfit } from "@/lib/fonts";

import { BRAND, brandTheme } from "./brand";

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
  // build-option.ts uses grid.containLabel so axis labels never get clipped; ECharts 6 needs this for it.
  LegacyGridContainLabel,
]);

echarts.registerTheme("brand", brandTheme(`${outfit.style.fontFamily}, system-ui, sans-serif`));

// Kept here too so existing imports of BRAND from this module keep working.
export { BRAND };
export { echarts };
