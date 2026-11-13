/**
 * Chart colours and the ECharts "brand" theme, with no imports, so the browser charts
 * (echarts-setup.ts, canvas + Outfit) and the PDF renderer (src/app/internal/pdf, SVG on the server)
 * draw from the same source.
 */

export const BRAND = {
  primary: "#f07a2b",
  accent: "#f2545b",
  highlight: "#ffb37a",
  line: "#2a1e16",
  text: "#fbf6f1",
  muted: "#d1c2b4",
  faint: "#a8978a",
};

/** Same order as --chart-1..5 in globals.css. */
export const SERIES_COLORS = [BRAND.highlight, BRAND.primary, BRAND.accent, "#a8978a", "#8a4a24"];

export function brandTheme(fontFamily: string) {
  const axis = {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: BRAND.faint, fontSize: 11 },
    splitLine: { lineStyle: { color: "rgba(255,179,122,0.08)" } }, // --highlight at 8%: reads as a hairline on --surface
  };
  return {
    color: SERIES_COLORS,
    backgroundColor: "transparent",
    textStyle: { fontFamily, color: BRAND.muted },
    categoryAxis: axis,
    valueAxis: axis,
    tooltip: {
      backgroundColor: "rgba(28, 21, 16, 0.96)", // --surface-2
      borderColor: "#3a2a1e", // --line-strong
      textStyle: { color: BRAND.text, fontSize: 12 },
    },
    legend: { textStyle: { color: BRAND.muted } },
  };
}
