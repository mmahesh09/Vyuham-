"use client";

import { BarChart3, Inbox, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ChartSpec, ChartType } from "@/features/charts/chart-spec";
import { SaveToDashboard } from "@/features/command/save-to-dashboard";
import { ChartBody } from "@/features/dashboards/insight-card";
import { cn } from "@/lib/utils";

import type { Param, RunResult } from "./params";
import { ResultActions, ResultsGrid } from "./results-grid";

export type Pane = "rows" | "stats" | "plan" | "chart";

/**
 * A tab's last successful run (what the results, plan and chart describe) and, if the latest run
 * failed, its error. Kept per tab while the page is open.
 */
export type Output = {
  sql: string;
  params: Param[];
  result?: RunResult;
  error?: string;
  /** Editor line where the failed run's text started (running a selection), to place its error line. */
  errorFirstLine?: number;
};

const VIZ_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "hbar", label: "Ranking" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "treemap", label: "Treemap" },
  { value: "funnel", label: "Funnel" },
  { value: "table", label: "Table" },
];

/** Results, column stats, query plan and chart for a tab's last run. Fills its pane and scrolls inside it. */
export function ResultsPanel({
  output,
  result,
  pane,
  setPane,
  plan,
  name,
  datasetId,
  stale,
}: {
  output: Output;
  result: RunResult;
  pane: Pane;
  setPane: (p: Pane) => void;
  plan: { isPending: boolean; isFetching: boolean; data?: { plan: string }; error: Error | null };
  name: string;
  datasetId?: string;
  stale: boolean;
}) {
  const numeric = result.columns.filter((c) => result.rows.some((r) => typeof r[c] === "number"));
  const canChart = result.columns.length >= 2 && numeric.length > 0;
  const panes: { id: Pane; label: string; show: boolean }[] = [
    { id: "rows", label: "Results", show: true },
    { id: "stats", label: "Column stats", show: true },
    { id: "plan", label: "Query plan", show: true },
    { id: "chart", label: "Chart", show: canChart },
  ];

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-2.5", stale && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-[10px] border border-line bg-bg/60 p-0.5" role="tablist" aria-label="Result views">
          {panes
            .filter((p) => p.show)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pane === p.id}
                onClick={() => setPane(p.id)}
                className={cn(
                  "flex min-h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-medium",
                  pane === p.id ? "bg-surface-2 text-text shadow-sm" : "text-muted hover:text-text",
                )}
              >
                {p.id === "chart" && <BarChart3 className="size-3.5" aria-hidden />}
                {p.label}
              </button>
            ))}
        </div>
        <div className="ml-auto">
          <ResultActions result={result} name={name} query={{ sql: output.sql, params: output.params }} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto" data-lenis-prevent>
        {result.row_count === 0 && (pane === "rows" || pane === "stats") ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-center">
            <Inbox className="size-5 text-faint" aria-hidden />
            <p className="text-sm text-muted">The query ran but returned no rows.</p>
            <p className="text-xs text-faint">Check the filters in your WHERE clause, or the parameter values.</p>
          </div>
        ) : (
          <>
            {(pane === "rows" || pane === "stats") && <ResultsGrid result={result} view={pane} />}
            {pane === "plan" && (
              <div className="rounded-[12px] border border-line bg-bg/40 p-4">
                {plan.isFetching && !plan.data ? (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="size-4 animate-spin" /> Reading the plan…
                  </p>
                ) : plan.error ? (
                  <p className="font-mono text-[13px] text-accent">{plan.error.message}</p>
                ) : (
                  <>
                    <p className="mb-3 text-xs text-faint">
                      How DuckDB will run this query, read from the bottom up. Wide scans and big hash joins are the slow parts.
                    </p>
                    <pre className="font-mono text-[12px] leading-[1.35] text-muted">{plan.data?.plan}</pre>
                  </>
                )}
              </div>
            )}
            {pane === "chart" && canChart && <ChartPane output={output} result={result} numeric={numeric} datasetId={datasetId} />}
          </>
        )}
      </div>
    </div>
  );
}

function ChartPane({ output, result, numeric, datasetId }: { output: Output; result: RunResult; numeric: string[]; datasetId?: string }) {
  const [type, setType] = useState<ChartType>("bar");
  const [x, setX] = useState(result.columns[0] ?? "");
  const [y, setY] = useState(numeric.find((c) => c !== result.columns[0]) ?? numeric[0] ?? "");
  const [title, setTitle] = useState("");

  const spec: ChartSpec | null = useMemo(
    () =>
      x && y && datasetId
        ? {
            dataset: datasetId,
            sql: output.sql,
            ...(output.params.length ? { params: output.params } : {}),
            groupBy: x,
            metrics: [{ field: y, agg: "sum" }],
            chartType: type,
            title: title.trim() || `${y} by ${x}`,
            filters: [],
          }
        : null,
    [x, y, type, title, output, datasetId],
  );
  // Preview with the renderer's column names (the backend renames the same way when the chart is saved).
  const previewRows = useMemo(
    () => result.rows.map((r) => ({ [x]: r[x] as string | number | null, [`sum_${y}`]: r[y] as string | number | null })),
    [result.rows, x, y],
  );

  if (!spec) return null;
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg/40 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Chart
          <NativeSelect className="w-36" value={type} onChange={(e) => setType(e.target.value as ChartType)}>
            {VIZ_TYPES.map((t) => (
              <option key={t.value} value={t.value} className="bg-surface">
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Labels
          <NativeSelect className="w-36" value={x} onChange={(e) => setX(e.target.value)}>
            {result.columns.map((c) => (
              <option key={c} value={c} className="bg-surface">
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Values
          <NativeSelect className="w-36" value={y} onChange={(e) => setY(e.target.value)}>
            {numeric.map((c) => (
              <option key={c} value={c} className="bg-surface">
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
          Title
          <Input value={title} placeholder={`${y} by ${x}`} onChange={(e) => setTitle(e.target.value)} className="h-9" />
        </label>
        <SaveToDashboard spec={spec} />
      </div>
      <ChartBody spec={spec} rows={previewRows} height={260} />
      <p className="text-xs text-faint">
        Charts saved from SQL re-run the query each time{output.params.length ? ", with the parameter values used for this run" : ""}. Dashboard
        filters don&apos;t apply to them.
      </p>
    </div>
  );
}
