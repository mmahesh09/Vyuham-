/**
 * A dashboard as a Forme PDF document: header with the report's period, the key numbers as one
 * strip, "What stands out", then one card per chart (headline, note, chart). Mirrors the print page
 * (print-dashboard.tsx) in the app's dark palette, but needs no browser: charts are SVG from
 * chart-svg.ts and Forme lays out and paginates the pages.
 */
import { renderDocument } from "@formepdf/core";
import { Cell, Document, Fixed, Page, Row, Svg, Table, Text, View } from "@formepdf/react";
import type { Style } from "@formepdf/react";
import { createElement as h, type ReactElement, type ReactNode } from "react";

import { axisLabel, buildOption, formatNumber, metricKey } from "@/features/charts/build-option";
import { metricLabel } from "@/features/charts/chart-spec";
import type { ChartRecord, ChartView, Dashboard, DashboardView, Insight } from "@/features/dashboards/api";

import { chartSvg } from "./chart-svg";

/** The app's dark palette (globals.css). */
const C = {
  bg: "#05040a",
  surface: "#110e22",
  surface2: "#17132e",
  line: "#221c4a",
  lineStrong: "#2e2660",
  text: "#f5f2ff",
  muted: "#b3a9d6",
  faint: "#8f86b3",
  highlight: "#cea3f5",
  accent: "#cb72d0",
};
const SIZES = { A4: { width: 595.28, height: 841.89 }, Letter: { width: 612, height: 792 } } as const;
const PAD = 32;
const CARD_PAD = 14;
const TABLE_ROWS = 25;
/** A 1x1 PNG of --bg, stretched behind each page: Page style only paints the content box, this covers the margins too. */
const PAGE_BG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgZeECAAAlABSJDL5AAAAAAElFTkSuQmCC";

export type PdfOptions = { pageSize?: keyof typeof SIZES; landscape?: boolean; generatedAt?: Date };

const trendColor = (t: Insight["trend"] | undefined) => (t === "up" ? C.highlight : t === "down" ? C.accent : C.faint);
const trendWord = (t: Insight["trend"] | undefined) => (t === "up" ? "Up" : t === "down" ? "Down" : "");

function kpiTile(chart: ChartRecord, view: ChartView | undefined, allTime: boolean, first: boolean): ReactElement {
  const insight = view?.insight;
  const raw = insight?.value ?? view?.rows[0]?.[metricKey(chart.spec.metrics[0])] ?? null;
  const change = insight?.change ?? null;
  const up = change !== null && change > 0.5;
  const down = change !== null && change < -0.5;
  const tile: Style = { flexGrow: 1, flexBasis: 0, padding: 12, borderLeftWidth: first ? 0 : 1, borderColor: C.line };
  return h(
    View,
    { key: chart.id, style: tile },
    h(Text, { style: { fontSize: 9, color: C.muted } }, chart.spec.title),
    view?.error
      ? h(Text, { style: { fontSize: 9, color: C.accent, marginTop: 6 } }, view.error)
      : h(Text, { style: { fontSize: 22, color: C.text, marginTop: 6 } }, formatNumber(raw)),
    change !== null
      ? h(
          Text,
          { style: { fontSize: 8.5, marginTop: 4, color: up ? C.highlight : down ? C.accent : C.faint } },
          `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs previous period`,
        )
      : h(Text, { style: { fontSize: 8.5, marginTop: 4, color: C.faint } }, allTime ? "All time" : insight?.note || " "),
  );
}

function resultTable(chart: ChartRecord, view: ChartView): ReactElement {
  const { spec } = chart;
  const group = spec.groupBy;
  const headers = [...(group ? [group] : []), ...spec.metrics.map((m) => metricLabel(m))];
  const cell: Style = { fontSize: 8.5, padding: 4, color: C.text };
  const rows = view.rows.slice(0, TABLE_ROWS);
  return h(
    View,
    null,
    h(
      Table,
      { columns: headers.map(() => ({ width: { fraction: 1 / headers.length } })) },
      h(Row, { header: true }, ...headers.map((t, i) => h(Cell, { key: i, style: { ...cell, color: C.muted, backgroundColor: C.surface2, textAlign: group && i === 0 ? "left" : "right" } }, h(Text, null, t)))),
      ...rows.map((r, n) =>
        h(
          Row,
          { key: n },
          ...(group ? [h(Cell, { key: "g", style: cell }, h(Text, null, axisLabel(String(r[group] ?? "-"))))] : []),
          ...spec.metrics.map((m) => h(Cell, { key: metricKey(m), style: { ...cell, textAlign: "right" } }, h(Text, null, formatNumber(r[metricKey(m)])))),
        ),
      ),
    ),
    view.rows.length > TABLE_ROWS
      ? h(Text, { style: { fontSize: 8, color: C.faint, marginTop: 4 } }, `First ${TABLE_ROWS} of ${view.rows.length} rows. Export to Excel for all of them.`)
      : null,
  );
}

function card(chart: ChartRecord, view: ChartView | undefined, innerWidth: number): ReactElement {
  const insight = view?.insight;
  const { spec } = chart;
  let body: ReactNode;
  if (!view) body = h(Text, { style: { fontSize: 9, color: C.faint, marginTop: 8 } }, "No data loaded for this chart.");
  else if (view.error) body = null;
  else if (!view.rows.length) body = h(Text, { style: { fontSize: 9, color: C.faint, marginTop: 8 } }, "No data for this report's period and filters.");
  else if (spec.chartType === "table") body = h(View, { style: { marginTop: 10 } }, resultTable(chart, view));
  else if (spec.chartType === "kpi")
    body = h(Text, { style: { fontSize: 30, color: C.text, marginTop: 8 } }, formatNumber(view.rows[0]?.[metricKey(spec.metrics[0])]));
  else {
    const height = spec.chartType === "line" || spec.chartType === "area" ? 210 : 190;
    const svg = chartSvg(buildOption(spec, view.rows, { highlightLast: spec.chartType === "bar" && spec.sort === "label" }), innerWidth, height);
    body = h(View, { style: { marginTop: 10 } }, h(Svg, { width: innerWidth, height, content: svg }));
  }
  const word = trendWord(insight?.trend);
  return h(
    View,
    {
      key: chart.id,
      wrap: false, // keep each card on one page
      style: { marginTop: 12, padding: CARD_PAD, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8 },
    },
    h(
      View,
      { style: { flexDirection: "row", alignItems: "flex-start", gap: 7 } },
      h(View, { style: { width: 6, height: 6, borderRadius: 3, marginTop: 5, backgroundColor: view?.error ? C.accent : trendColor(insight?.trend) } }),
      h(
        Text,
        { style: { fontSize: 13, fontWeight: 700, color: C.text, flexGrow: 1, flexBasis: 0 } },
        `${word && insight ? `${word}: ` : ""}${insight?.headline ?? spec.title}`,
      ),
    ),
    h(
      Text,
      { style: { fontSize: 9.5, color: view?.error ? C.accent : C.muted, marginTop: 4, marginLeft: 13 } },
      view?.error ?? (insight?.note || spec.title),
    ),
    chart.note ? h(Text, { style: { fontSize: 9, color: C.faint, marginTop: 3, marginLeft: 13 } }, `“${chart.note}”`) : null,
    body,
  );
}

export function dashboardPdf(dashboard: Dashboard, view: DashboardView, { pageSize = "A4", landscape = false, generatedAt = new Date() }: PdfOptions = {}) {
  const base = SIZES[pageSize] ?? SIZES.A4;
  const size = landscape ? { width: base.height, height: base.width } : base;
  const innerWidth = Math.floor(size.width - PAD * 2 - CARD_PAD * 2 - 2);
  const views = new Map(view.charts.map((c) => [c.id, c]));
  const kpis = dashboard.charts.filter((c) => c.kind === "kpi");
  const cards = dashboard.charts.filter((c) => c.kind === "card");
  const summary = cards
    .map((c) => views.get(c.id)?.insight)
    .filter((i): i is Insight => !!i)
    .sort((a, b) => Number(b.trend !== "flat") - Number(a.trend !== "flat"))
    .slice(0, 3);
  const subtitle = dashboard.description || (dashboard.datasets.length ? `From ${dashboard.datasets.map((d) => d.name).join(", ")}` : "");
  const generated = generatedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return h(
    Document,
    { title: dashboard.name, creator: "Vyuham", style: { fontFamily: "Helvetica", color: C.text } },
    h(
      Page,
      { size, margin: { top: PAD, bottom: PAD + 14, left: PAD, right: PAD }, backgroundImage: PAGE_BG, backgroundSize: "fill" },
      h(
        Fixed,
        { position: "footer", style: { flexDirection: "row", justifyContent: "space-between", paddingTop: 8 } },
        h(Text, { style: { fontSize: 7.5, color: C.faint } }, `${dashboard.name}, made with Vyuham`),
        h(Text, { style: { fontSize: 7.5, color: C.faint } }, "Page {{pageNumber}} of {{totalPages}}"),
      ),
      h(
        View,
        { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: C.line } },
        h(
          View,
          { style: { flexGrow: 1, flexBasis: 0 } },
          h(Text, { style: { fontSize: 22, fontWeight: 700, color: C.text } }, dashboard.name),
          subtitle ? h(Text, { style: { fontSize: 9.5, color: C.muted, marginTop: 4 } }, subtitle) : null,
        ),
        h(
          View,
          { style: { alignItems: "flex-end" } },
          h(Text, { style: { fontSize: 9.5, fontWeight: 700, color: C.text } }, view.label ?? "All time"),
          h(Text, { style: { fontSize: 8.5, color: C.muted, marginTop: 2 } }, `Generated ${generated} UTC`),
        ),
      ),
      kpis.length
        ? h(
            View,
            { wrap: false, style: { flexDirection: "row", marginTop: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 8 } },
            ...kpis.map((k, i) => kpiTile(k, views.get(k.id), !view.period, i === 0)),
          )
        : null,
      summary.length
        ? h(
            View,
            { wrap: false, style: { marginTop: 12, padding: CARD_PAD, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8 } },
            h(Text, { style: { fontSize: 12, fontWeight: 700, color: C.text } }, "What stands out"),
            ...summary.map((s) =>
              h(
                View,
                { key: s.headline, style: { marginTop: 7, paddingLeft: 9, borderLeftWidth: 2, borderColor: C.lineStrong } },
                h(Text, { style: { fontSize: 10.5, color: C.text } }, s.headline),
                s.note ? h(Text, { style: { fontSize: 9, color: C.muted, marginTop: 2 } }, s.note) : null,
              ),
            ),
          )
        : null,
      ...cards.map((c) => card(c, views.get(c.id), innerWidth)),
      !kpis.length && !cards.length ? h(Text, { style: { fontSize: 10, color: C.muted, marginTop: 16 } }, "This dashboard has no charts yet.") : null,
    ),
  );
}

/** Render to PDF bytes. Building and rendering in one module keeps a single copy of Forme's components. */
export async function renderDashboardPdf(dashboard: Dashboard, view: DashboardView, options?: PdfOptions): Promise<Uint8Array> {
  return renderDocument(dashboardPdf(dashboard, view, options));
}
