/**
 * Server-side chart rendering for PDFs: the same ECharts options the app draws (build-option.ts),
 * rendered to an SVG string with no browser. Registers the SVG renderer and a "brand-pdf" theme
 * that matches the app's "brand" theme with a font every PDF viewer has.
 */
import { BarChart, FunnelChart, GaugeChart, LineChart, PieChart, ScatterChart, TreemapChart } from "echarts/charts";
import { DatasetComponent, GridComponent, LegendComponent, MarkPointComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { LegacyGridContainLabel } from "echarts/features";
import type { EChartsCoreOption } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

import { brandTheme } from "@/features/charts/brand";

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
  SVGRenderer,
  // build-option.ts uses grid.containLabel so axis labels never get clipped; ECharts 6 needs this for it.
  LegacyGridContainLabel,
]);
echarts.registerTheme("brand-pdf", brandTheme("Helvetica, Arial, sans-serif"));

export function chartSvg(option: EChartsCoreOption, width: number, height: number): string {
  const chart = echarts.init(null, "brand-pdf", { renderer: "svg", ssr: true, width, height });
  try {
    chart.setOption({ ...option, animation: false });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}
