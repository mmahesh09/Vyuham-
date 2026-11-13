"use client";

import { Sparkle } from "lucide-react";
import { useEffect, useMemo } from "react";

import { StaticChartsContext } from "@/features/charts/echart";
import { type ChartRecord, printSource } from "@/features/dashboards/api";
import { useDashboardMeta, useDashboardView } from "@/features/dashboards/hooks";
import { KpiGrid } from "@/features/dashboards/kpi-grid";
import { StoryFeed } from "@/features/dashboards/story-feed";

declare global {
  interface Window {
    /** Set when the page is ready to print; the report worker's browser waits for it. */
    __vyuhamReady?: boolean;
    /** Set instead when the page can't be printed; the worker fails the report with this message. */
    __vyuhamError?: string;
  }
}

const NO_ACTIONS = (_: ChartRecord) => ({ onEdit: () => {}, onDelete: () => {} });

/** Waits for fonts and two painted frames, so every chart (drawn without animation) is on screen. */
async function settle() {
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 250));
}

/**
 * A dashboard laid out for paper: no buttons or filter bar, the report's period in the header,
 * and cards that don't split across pages. Opened only by the report worker, with a signed token.
 */
export function PrintDashboard({ token }: { token: string }) {
  const source = useMemo(() => printSource(token), [token]);
  const meta = useDashboardMeta(source);
  const chartIds = meta.data?.charts.map((c) => c.id).join(",") ?? "";
  const view = useDashboardView(source, { from: null, to: null, f: {} }, chartIds);
  const views = useMemo(() => new Map((view.data?.charts ?? []).map((c) => [c.id, c])), [view.data]);

  const error = meta.error ?? view.error;
  const ready = meta.isSuccess && view.isSuccess && !view.isPlaceholderData;

  useEffect(() => {
    if (error) window.__vyuhamError = error.message;
  }, [error]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void settle().then(() => {
      if (live) window.__vyuhamReady = true;
    });
    return () => {
      live = false;
    };
  }, [ready]);

  if (error) return <p role="alert" className="p-10 text-muted">{error.message}</p>;
  if (!meta.data || !view.data) return null;

  const dashboard = meta.data;
  const kpis = dashboard.charts.filter((c) => c.kind === "kpi");
  const cards = dashboard.charts.filter((c) => c.kind === "card");
  const summary = cards
    .map((c) => views.get(c.id)?.insight)
    .filter((i): i is NonNullable<typeof i> => !!i)
    .sort((a, b) => Number(b.trend !== "flat") - Number(a.trend !== "flat"))
    .slice(0, 3);

  return (
    <StaticChartsContext.Provider value>
      {/* Print rules: keep cards whole, and print the dark background as on screen. */}
      <style>{`
        @media print {
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          article, section, [data-print-keep] { break-inside: avoid; }
        }
      `}</style>
      <div className="mx-auto flex max-w-[1100px] flex-col gap-7 px-2 py-6">
        <header data-print-keep className="flex items-end justify-between gap-6 border-b border-line pb-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[34px] font-semibold tracking-[-0.03em]">{dashboard.name}</h1>
            <p className="text-[14px] text-muted">
              {dashboard.description || (dashboard.datasets.length ? `From ${dashboard.datasets.map((d) => d.name).join(", ")}` : "")}
            </p>
          </div>
          <div className="shrink-0 text-right text-[13px] text-muted">
            <p className="font-medium text-text">{view.data.label ?? "All time"}</p>
            <p>Generated {new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
          </div>
        </header>

        {kpis.length > 0 && (
          <div data-print-keep>
            <KpiGrid
              charts={kpis}
              views={views}
              layout={dashboard.kpi_layout}
              editing={false}
              canEdit={false}
              allTime={!view.data.period}
              actionsFor={NO_ACTIONS}
            />
          </div>
        )}

        {summary.length > 0 && (
          <section className="rounded-[18px] bg-line p-6">
            <h2 className="flex items-center gap-2.5 text-[19px] font-semibold">
              <Sparkle className="size-4 text-highlight" strokeWidth={2.2} aria-hidden />
              What stands out
            </h2>
            <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-6 text-[16px] leading-relaxed text-text/90">
              {summary.map((s) => (
                <li key={s.headline}>
                  {s.headline}
                  {s.note && <span className="text-muted"> — {s.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {cards.length > 0 ? (
          <StoryFeed charts={cards} views={views} canEdit={false} actionsFor={NO_ACTIONS} />
        ) : (
          kpis.length === 0 && <p className="text-muted">This dashboard has no charts yet.</p>
        )}
      </div>
    </StaticChartsContext.Provider>
  );
}
