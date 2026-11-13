/**
 * Chart colours and the ECharts "brand" theme, with no imports, so the browser charts
 * (echarts-setup.ts, canvas + Outfit) and the PDF renderer (src/app/internal/pdf, SVG on the server)
 * draw from the same source.
 */

export const BRAND = {
  primary: "#705cbb",
  accent: "#cb72d0",
  highlight: "#cea3f5",
  line: "#221c4a",
  text: "#f5f2ff",
  muted: "#b3a9d6",
  faint: "#8f86b3",
};

/** Same order as --chart-1..5 in globals.css. */
export const SERIES_COLORS = [BRAND.highlight, BRAND.primary, BRAND.accent, "#8f86b3", "#4b3f8f"];

export function brandTheme(fontFamily: string) {
  const axis = {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: BRAND.faint, fontSize: 11 },
    splitLine: { lineStyle: { color: "rgba(206,163,245,0.08)" } }, // --highlight at 8%: reads as a hairline on --surface
  };
  return {
    color: SERIES_COLORS,
    backgroundColor: "transparent",
    textStyle: { fontFamily, color: BRAND.muted },
    categoryAxis: axis,
    valueAxis: axis,
    tooltip: {
      backgroundColor: "rgba(23, 19, 46, 0.96)", // --surface-2
      borderColor: "#2e2660", // --line-strong
      textStyle: { color: BRAND.text, fontSize: 12 },
    },
    legend: { textStyle: { color: BRAND.muted } },
  };
}
