import type { EChartsCoreOption } from "echarts/core";

import { BRAND } from "./brand";
import { ROW_FIELD, type ChartSpec, type ResultRow } from "./chart-spec";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The column name a metric produces in query results, e.g. "sum_amount". Matches backend metric_key(). */
export const metricKey = (m: ChartSpec["metrics"][number]) => `${m.agg}_${m.field}`;

/** "2026-10" -> "Oct 26", "2026-10-05" -> "Oct 5", "2026-Q3" and categories unchanged. */
export function axisLabel(v: string) {
  let m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1].slice(2)}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return v;
}

export const formatNumber = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : compact.format(Number(v)));

/** Lighter/transparent version of a "#rrggbb" colour for gradients. */
function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Turn a chart spec + query rows into an ECharts option (line, area, bar, pie).
 * KPI and table charts are rendered as HTML instead (see insight-card.tsx).
 * `highlightLast` paints the final bar/point in the accent colour (the "what changed" point).
 */
export function buildOption(spec: ChartSpec, rows: ResultRow[], { highlightLast = false } = {}): EChartsCoreOption {
  const x = spec.groupBy ?? "";
  const y = metricKey(spec.metrics[0]);
  const labels = rows.map((r) => String(r[x] ?? ""));
  const values = rows.map((r) => (r[y] === null || r[y] === undefined ? null : Number(r[y])));
  const main = spec.color ?? (spec.chartType === "bar" ? BRAND.primary : BRAND.highlight);
  const seriesName = spec.metrics[0].field === ROW_FIELD ? "Rows" : spec.metrics[0].field;

  if (spec.chartType === "pie") {
    return {
      tooltip: { trigger: "item", valueFormatter: formatNumber },
      legend: { orient: "vertical", right: 0, top: "middle", icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 12 } },
      series: [
        {
          type: "pie",
          name: seriesName,
          center: ["32%", "50%"],
          radius: ["55%", "85%"],
          padAngle: 2,
          itemStyle: { borderRadius: 4 },
          label: { show: false },
          data: rows.map((_, i) => ({
            name: labels[i],
            value: values[i],
            itemStyle: i === 0 ? { color: spec.color ?? BRAND.accent } : undefined,
          })),
        },
      ],
    };
  }

  if (spec.chartType === "funnel") {
    return {
      tooltip: { trigger: "item", valueFormatter: formatNumber },
      series: [
        {
          type: "funnel",
          name: seriesName,
          left: "8%",
          width: "84%",
          sort: "descending",
          gap: 3,
          label: { color: BRAND.text, formatter: "{b}" },
          itemStyle: { borderWidth: 0 },
          data: rows.map((_, i) => ({ name: labels[i], value: values[i] })),
        },
      ],
    };
  }

  if (spec.chartType === "treemap") {
    return {
      tooltip: { valueFormatter: formatNumber },
      series: [
        {
          type: "treemap",
          name: seriesName,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: "100%",
          height: "100%",
          label: { color: BRAND.text, fontSize: 12 },
          itemStyle: { borderColor: "#05040a", borderWidth: 2, gapWidth: 2 },
          data: rows.map((_, i) => ({ name: labels[i], value: values[i] })),
        },
      ],
    };
  }

  if (spec.chartType === "gauge") {
    const value = values[0] ?? 0;
    const max = spec.target && spec.target > 0 ? spec.target : Math.max(value * 1.25, 1);
    return {
      series: [
        {
          type: "gauge",
          min: 0,
          max,
          startAngle: 210,
          endAngle: -30,
          progress: { show: true, width: 14, itemStyle: { color: spec.color ?? BRAND.highlight } },
          axisLine: { lineStyle: { width: 14, color: [[1, "rgba(255,255,255,0.08)"]] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          anchor: { show: false },
          title: { show: !!spec.target, offsetCenter: [0, "38%"], color: BRAND.faint, fontSize: 12 },
          detail: { valueAnimation: true, offsetCenter: [0, "4%"], fontSize: 30, color: BRAND.text, formatter: (v: number) => compact.format(v) },
          data: [{ value, name: spec.target ? `${Math.round((value / max) * 100)}% of ${compact.format(max)} goal` : "" }],
        },
      ],
    };
  }

  if (spec.chartType === "scatter") {
    const y2 = spec.metrics[1] ? metricKey(spec.metrics[1]) : y;
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: { data: [number, number, string] }) => `${p.data[2]}<br/>${formatNumber(p.data[0])} · ${formatNumber(p.data[1])}`,
      },
      xAxis: { type: "value", name: spec.metrics[0].field, nameLocation: "middle", nameGap: 26, axisLabel: { formatter: (v: number) => compact.format(v) } },
      yAxis: { type: "value", name: spec.metrics[1]?.field, axisLabel: { formatter: (v: number) => compact.format(v) } },
      series: [
        {
          type: "scatter",
          symbolSize: 14,
          itemStyle: { color: main, opacity: 0.85 },
          data: rows.map((r, i) => [Number(r[y] ?? 0), Number(r[y2] ?? 0), labels[i]]),
        },
      ],
    };
  }

  if (spec.chartType === "hbar") {
    // Biggest at the top: ECharts draws category axes bottom-up.
    const order = [...labels.keys()].reverse();
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: formatNumber },
      xAxis: { type: "value", axisLabel: { formatter: (v: number) => compact.format(v) } },
      yAxis: { type: "category", data: order.map((i) => axisLabel(labels[i])), axisLabel: { width: 120, overflow: "truncate" } },
      series: [
        {
          type: "bar",
          name: seriesName,
          barMaxWidth: 22,
          itemStyle: { borderRadius: [0, 6, 6, 0], color: spec.color ?? BRAND.primary },
          label: { show: true, position: "right", color: BRAND.muted, fontSize: 11, formatter: (p: { value: number }) => compact.format(p.value) },
          data: order.map((i) => values[i]),
        },
      ],
    };
  }

  if (spec.chartType === "combo") {
    const second = spec.metrics[1];
    return {
      grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: formatNumber },
      legend: { top: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 12 } },
      xAxis: { type: "category", data: labels, axisLabel: { formatter: axisLabel, hideOverlap: true } },
      yAxis: [
        { type: "value", axisLabel: { formatter: (v: number) => compact.format(v) } },
        { type: "value", splitLine: { show: false }, axisLabel: { formatter: (v: number) => compact.format(v) } },
      ],
      series: [
        { type: "bar", name: seriesName, barMaxWidth: 30, itemStyle: { borderRadius: [6, 6, 0, 0], color: spec.color ?? BRAND.primary }, data: values },
        ...(second
          ? [
              {
                type: "line",
                name: second.field === ROW_FIELD ? "Rows" : second.field,
                yAxisIndex: 1,
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 2.5, color: BRAND.accent },
                itemStyle: { color: BRAND.accent },
                data: rows.map((r) => Number(r[metricKey(second)] ?? 0)),
              },
            ]
          : []),
      ],
    };
  }

  const base = {
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: formatNumber },
    xAxis: { type: "category", data: labels, boundaryGap: spec.chartType === "bar", axisLabel: { formatter: axisLabel, hideOverlap: true } },
    yAxis: { type: "value", axisLabel: { formatter: (v: number) => compact.format(v) } },
  };

  if (spec.chartType === "bar") {
    return {
      ...base,
      series: [
        {
          type: "bar",
          name: seriesName,
          barMaxWidth: 36,
          itemStyle: { borderRadius: [6, 6, 0, 0], color: main },
          data: values.map((v, i) => (highlightLast && i === values.length - 1 ? { value: v, itemStyle: { color: BRAND.accent } } : v)),
        },
      ],
    };
  }

  // line / area
  const area = spec.chartType === "area" || !spec.color;
  return {
    ...base,
    series: [
      {
        type: "line",
        name: seriesName,
        smooth: true,
        showSymbol: values.length < 3,
        connectNulls: true,
        lineStyle: { width: 2.5, color: main },
        itemStyle: { color: main },
        areaStyle: area
          ? {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: spec.color
                  ? [
                      { offset: 0, color: alpha(spec.color, 0.35) },
                      { offset: 1, color: alpha(spec.color, 0) },
                    ]
                  : [
                      { offset: 0, color: "rgba(203,114,208,0.35)" },
                      { offset: 1, color: "rgba(112,92,187,0)" },
                    ],
              },
            }
          : undefined,
        data: values,
        markPoint:
          highlightLast && values.length
            ? { symbol: "circle", symbolSize: 10, itemStyle: { color: BRAND.accent }, data: [{ coord: [labels.length - 1, values[values.length - 1]] }] }
            : undefined,
      },
    ],
  };
}
