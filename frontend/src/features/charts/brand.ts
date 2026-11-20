/**
 * Chart colours and the ECharts "brand" themes, with no imports, so the browser charts
 * (echarts-setup.ts, canvas + Outfit) and the PDF renderer (src/app/internal/pdf, SVG on the server)
 * draw from the same source.
 *
 * Chart options are built with the dark palette (BRAND). In light mode, EChart swaps each BRAND
 * colour for its LIGHT counterpart (lightColors) and draws with the "brand-light" theme.
 */

export type ChartMode = "dark" | "light";

export const BRAND = {
  primary: "#f07a2b",
  accent: "#f2545b",
  highlight: "#ffb37a",
  line: "#2a1e16",
  text: "#fbf6f1",
  muted: "#d1c2b4",
  faint: "#a8978a",
};

/** The light theme's chart palette (globals.css :root.light), readable on white. */
export const BRAND_LIGHT: typeof BRAND = {
  primary: "#e8691c",
  accent: "#c2303c",
  highlight: "#b14e0c",
  line: "#e7dbcf",
  text: "#1e150f",
  muted: "#5b4b3f",
  faint: "#6f5f53",
};

/**
 * Same order as --chart-1..5 in globals.css, then three muted extras so a chart split by colour
 * (up to 8 series) never repeats a colour.
 */
export const SERIES_COLORS = [BRAND.highlight, BRAND.primary, BRAND.accent, "#a8978a", "#8a4a24", "#e8c872", "#6fb7a8", "#c98bb9"];
const SERIES_COLORS_LIGHT = [BRAND_LIGHT.highlight, BRAND_LIGHT.primary, BRAND_LIGHT.accent, "#8a7768", "#a5531f", "#9a7a12", "#2f7d6d", "#9c4f86"];

/** Dark hex (lowercase) -> light hex, for recolouring options built with BRAND. */
const TO_LIGHT: Record<string, string> = Object.fromEntries([
  ...(Object.keys(BRAND) as (keyof typeof BRAND)[]).map((k) => [BRAND[k], BRAND_LIGHT[k]]),
  ...SERIES_COLORS.map((c, i) => [c, SERIES_COLORS_LIGHT[i]]),
]);
const RGB_TO_LIGHT: Record<string, string> = {
  ...Object.fromEntries(Object.entries(TO_LIGHT).map(([dark, light]) => [hexToRgb(dark), hexToRgb(light)])),
  // Translucent white (gauge tracks, hairlines) would vanish on white: use the light theme's ink.
  "255,255,255": "30,21,15",
};

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** Swap brand colours (hex or rgba(...)) inside any string. */
function lightString(v: string): string {
  const hex = TO_LIGHT[v.toLowerCase()];
  if (hex) return hex;
  return v.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g, (m, r, g, b) => {
    const light = RGB_TO_LIGHT[`${r},${g},${b}`];
    return light ? `${m.slice(0, m.indexOf("(") + 1)}${light}` : m;
  });
}

/** A deep copy of an ECharts option with every brand colour swapped for its light counterpart. */
export function lightColors<T>(value: T): T {
  if (typeof value === "string") return lightString(value) as T;
  if (Array.isArray(value)) return value.map(lightColors) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, lightColors(v)])) as T;
  }
  return value; // functions (formatters), gradients built by echarts, numbers
}

export function brandTheme(fontFamily: string, mode: ChartMode = "dark") {
  const p = mode === "light" ? BRAND_LIGHT : BRAND;
  const axis = {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: p.faint, fontSize: 11 },
    // A hairline grid: --highlight at 8% on dark, warm grey on light.
    splitLine: { lineStyle: { color: mode === "light" ? "rgba(30,21,15,0.08)" : "rgba(255,179,122,0.08)" } },
  };
  return {
    color: mode === "light" ? SERIES_COLORS_LIGHT : SERIES_COLORS,
    backgroundColor: "transparent",
    textStyle: { fontFamily, color: p.muted },
    categoryAxis: axis,
    valueAxis: axis,
    tooltip:
      mode === "light"
        ? { backgroundColor: "rgba(255, 255, 255, 0.97)", borderColor: "#d3c2b1", textStyle: { color: p.text, fontSize: 12 } }
        : { backgroundColor: "rgba(28, 21, 16, 0.96)", borderColor: "#3a2a1e", textStyle: { color: p.text, fontSize: 12 } },
    legend: { textStyle: { color: p.muted } },
  };
}
