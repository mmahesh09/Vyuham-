"use client";

import dynamic from "next/dynamic";
import { useState, type ComponentType, type CSSProperties } from "react";

import { LazyMount } from "@/components/marketing/lazy-mount";
import { cn } from "@/lib/utils";

const FAMILIES = ["Area", "Line", "Bar", "Composed", "Radar", "Pie", "Radial", "Sankey", "Heatmap"] as const;
type Family = (typeof FAMILIES)[number];
type ChartTemplate = { id: string; name: string; family: Family; Chart: ComponentType };

function ChartLoading() {
  return <div className="h-full animate-pulse bg-surface-2" />;
}

// Every chart is its own download, fetched only when its card scrolls near the screen.
const TEMPLATES: ChartTemplate[] = [
  { id: "area", name: "Area", family: "Area", Chart: dynamic(() => import("./chart-demos/area").then((m) => m.AreaDemo), { ssr: false, loading: ChartLoading }) },
  { id: "audience", name: "Audience reach", family: "Area", Chart: dynamic(() => import("@/components/evilcharts/blocks/audience-echarts-area-chart").then((m) => m.EChartsAudienceAreaChart), { ssr: false, loading: ChartLoading }) },
  { id: "benchmark", name: "Benchmark", family: "Area", Chart: dynamic(() => import("@/components/evilcharts/blocks/benchmark-echarts-area-chart").then((m) => m.EChartsBenchmarkAreaChart), { ssr: false, loading: ChartLoading }) },
  { id: "latency", name: "Latency", family: "Area", Chart: dynamic(() => import("@/components/evilcharts/blocks/latency-echarts-area-chart").then((m) => m.EChartsLatencyAreaChart), { ssr: false, loading: ChartLoading }) },
  { id: "portfolio", name: "Portfolio", family: "Area", Chart: dynamic(() => import("@/components/evilcharts/blocks/portfolio-echarts-area-chart").then((m) => m.EChartsPortfolioAreaChart), { ssr: false, loading: ChartLoading }) },
  { id: "line", name: "Line", family: "Line", Chart: dynamic(() => import("./chart-demos/line").then((m) => m.LineDemo), { ssr: false, loading: ChartLoading }) },
  { id: "payouts", name: "Payouts", family: "Line", Chart: dynamic(() => import("@/components/evilcharts/blocks/payouts-echarts-line-chart").then((m) => m.EChartsPayoutsLineChart), { ssr: false, loading: ChartLoading }) },
  { id: "shipments", name: "Shipments", family: "Line", Chart: dynamic(() => import("@/components/evilcharts/blocks/shipments-echarts-line-chart").then((m) => m.EChartsShipmentsLineChart), { ssr: false, loading: ChartLoading }) },
  { id: "bar", name: "Bar", family: "Bar", Chart: dynamic(() => import("./chart-demos/bar").then((m) => m.BarDemo), { ssr: false, loading: ChartLoading }) },
  { id: "peak", name: "Peak week", family: "Bar", Chart: dynamic(() => import("@/components/evilcharts/blocks/peak-echarts-bar-chart").then((m) => m.EChartsPeakBarChart), { ssr: false, loading: ChartLoading }) },
  { id: "grid", name: "Block grid", family: "Bar", Chart: dynamic(() => import("@/components/evilcharts/blocks/grid-echarts-bar-chart").then((m) => m.EChartsGridBarChart), { ssr: false, loading: ChartLoading }) },
  { id: "monospace", name: "Monospace", family: "Bar", Chart: dynamic(() => import("@/components/evilcharts/blocks/monospace-echarts-bar-chart").then((m) => m.EChartsMonospaceBarChart), { ssr: false, loading: ChartLoading }) },
  { id: "composed", name: "Bars and line", family: "Composed", Chart: dynamic(() => import("./chart-demos/composed").then((m) => m.ComposedDemo), { ssr: false, loading: ChartLoading }) },
  { id: "radar", name: "Radar", family: "Radar", Chart: dynamic(() => import("./chart-demos/radar").then((m) => m.RadarDemo), { ssr: false, loading: ChartLoading }) },
  { id: "pie", name: "Pie", family: "Pie", Chart: dynamic(() => import("./chart-demos/pie").then((m) => m.PieDemo), { ssr: false, loading: ChartLoading }) },
  { id: "market-share", name: "Market share", family: "Pie", Chart: dynamic(() => import("@/components/evilcharts/blocks/market-share-echarts-pie-chart").then((m) => m.EChartsMarketSharePieChart), { ssr: false, loading: ChartLoading }) },
  { id: "progress-rings", name: "Progress rings", family: "Pie", Chart: dynamic(() => import("@/components/evilcharts/blocks/progress-rings-echarts-pie-chart").then((m) => m.EChartsProgressRingsPieChart), { ssr: false, loading: ChartLoading }) },
  { id: "reliability", name: "Reliability score", family: "Pie", Chart: dynamic(() => import("@/components/evilcharts/blocks/reliability-score-echarts-pie-chart").then((m) => m.EChartsReliabilityScorePieChart), { ssr: false, loading: ChartLoading }) },
  { id: "radial", name: "Radial", family: "Radial", Chart: dynamic(() => import("./chart-demos/radial").then((m) => m.RadialDemo), { ssr: false, loading: ChartLoading }) },
  { id: "budget", name: "Budget", family: "Radial", Chart: dynamic(() => import("@/components/evilcharts/blocks/budget-echarts-radial-chart").then((m) => m.EChartsBudgetRadialChart), { ssr: false, loading: ChartLoading }) },
  { id: "ride", name: "Ride stats", family: "Radial", Chart: dynamic(() => import("@/components/evilcharts/blocks/ride-echarts-radial-chart").then((m) => m.EChartsRideRadialChart), { ssr: false, loading: ChartLoading }) },
  { id: "cache-tiers", name: "Tiers", family: "Radial", Chart: dynamic(() => import("@/components/evilcharts/blocks/cache-tiers-echarts-radial-chart").then((m) => m.EChartsCacheTiersRadialChart), { ssr: false, loading: ChartLoading }) },
  { id: "allocation", name: "Allocation", family: "Sankey", Chart: dynamic(() => import("@/components/evilcharts/blocks/allocation-echarts-sankey-chart").then((m) => m.EChartsAllocationSankeyChart), { ssr: false, loading: ChartLoading }) },
  { id: "pipeline", name: "Pipeline", family: "Sankey", Chart: dynamic(() => import("@/components/evilcharts/blocks/pipeline-echarts-sankey-chart").then((m) => m.EChartsPipelineSankeyChart), { ssr: false, loading: ChartLoading }) },
  { id: "heatmap", name: "Calendar heatmap", family: "Heatmap", Chart: dynamic(() => import("./chart-demos/heatmap").then((m) => m.HeatmapDemo), { ssr: false, loading: ChartLoading }) },
  { id: "contributions", name: "Activity year", family: "Heatmap", Chart: dynamic(() => import("@/components/evilcharts/blocks/contributions-echarts-heatmap-chart").then((m) => m.EChartsContributionsHeatmapChart), { ssr: false, loading: ChartLoading }) },
  { id: "sales-heatmap", name: "Sales calendar", family: "Heatmap", Chart: dynamic(() => import("@/components/evilcharts/blocks/sales-echarts-heatmap-chart").then((m) => m.EChartsSalesHeatmapChart), { ssr: false, loading: ChartLoading }) },
  { id: "workouts", name: "Weekly plan", family: "Heatmap", Chart: dynamic(() => import("@/components/evilcharts/blocks/workouts-echarts-heatmap-chart").then((m) => m.EChartsWorkoutsHeatmapChart), { ssr: false, loading: ChartLoading }) },
];

// These charts expect the usual shadcn meanings: "primary" is the text colour and "muted" a soft surface.
const CHART_THEME = {
  "--primary": "var(--text)",
  "--color-primary": "var(--text)",
  "--muted": "var(--surface-2)",
  "--color-muted": "var(--surface-2)",
} as CSSProperties;

export function ChartTemplateGallery() {
  const [family, setFamily] = useState<Family | "All">("All");
  const shown = family === "All" ? TEMPLATES : TEMPLATES.filter((t) => t.family === family);

  return (
    <section aria-labelledby="chart-templates" className="mt-12 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="chart-templates" className="text-xl font-semibold">Chart templates</h2>
        <p className="max-w-[68ch] text-sm text-muted">
          {TEMPLATES.length} chart styles to browse. These previews use sample data and can&apos;t be connected to your datasets yet.
        </p>
      </div>

      <div role="group" aria-label="Filter chart templates" className="flex flex-wrap gap-2">
        {(["All", ...FAMILIES] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={family === f}
            onClick={() => setFamily(f)}
            className={cn(
              "min-h-9 rounded-full border px-3.5 text-[13px] transition-colors",
              family === f ? "border-primary bg-primary/15 text-text" : "border-line text-muted hover:text-text",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {shown.map(({ id, name, family: kind, Chart }) => (
          <li key={id} className="flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-line bg-surface">
            <div className="@container h-[360px] min-w-0" style={CHART_THEME}>
              <LazyMount minHeight="360px" className="h-full">
                <Chart />
              </LazyMount>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
              <h3 className="truncate text-sm font-medium">{name}</h3>
              <span className="shrink-0 text-xs text-faint">{kind}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
