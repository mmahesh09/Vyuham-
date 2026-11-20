"use client";

import { CheckCircle2, ChevronDown, CircleAlert, ListChecks, Table2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useDatasetRows } from "@/features/datasets/api";

import type { AnswerWork as Work } from "./ask-api";

const PREVIEW_ROWS = 20;

/** Exact, not compact: these are the figures an owner checks against their own spreadsheet. */
const exact = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const fmt = (n: number) => exact.format(n);

function checkSentence(c: NonNullable<Work["check"]>): string {
  const what = c.metric === "Rows" ? "rows" : `total ${c.metric}`;
  if (c.limited && c.shown !== c.total) {
    const pct = c.total ? Math.round((c.shown / c.total) * 100) : 0;
    return `These ${c.groups_shown} add up to ${fmt(c.shown)} of ${fmt(c.total)} ${what} (${pct}%).`;
  }
  if (Math.abs(c.shown - c.total) < 0.005) {
    return `The ${c.groups_shown} values in the chart add up to ${fmt(c.total)}, the same as the ${what} across these rows.`;
  }
  return `The chart shows ${c.groups_shown} groups adding up to ${fmt(c.shown)} of ${fmt(c.total)} ${what}.`;
}

/** The rows behind an answer, fetched with exactly the answer's filters. Mounted only when asked for. */
function RowsPreview({ datasetId, datasetName, work }: { datasetId: string; datasetName: string; work: Work }) {
  const rows = useDatasetRows(datasetId, { page: 0, size: PREVIEW_ROWS, filters: work.row_filters });
  if (rows.isPending) return <p className="text-[13px] text-faint">Loading the rows…</p>;
  if (rows.isError) return <p className="text-[13px] text-accent">We couldn’t load the rows. Try again in a moment.</p>;
  const data = rows.data.rows;
  const columns = data.length ? Object.keys(data[0]) : [];
  return (
    <div className="flex flex-col gap-2">
      {data.length ? (
        <div className="max-h-[320px] overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                {columns.map((c) => (
                  <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 font-medium text-muted">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {columns.map((c) => (
                    <td key={c} className="whitespace-nowrap px-3 py-1.5 tabular-nums text-text">
                      {r[c] === null || r[c] === "" ? <span className="text-faint">empty</span> : String(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-faint">No rows matched.</p>
      )}
      <p className="text-[12px] text-faint">
        Showing {fmt(data.length)} of {fmt(rows.data.total)} rows.{" "}
        <Link href={`/data/${datasetId}`} className="text-highlight underline-offset-4 hover:underline">
          Open {datasetName} in Data
        </Link>{" "}
        to see them all.
      </p>
    </div>
  );
}

/**
 * "How this was worked out": the query in plain words, the rows used and left out, and a total to check.
 * The summary line is always visible; the steps and rows open on demand.
 */
export function AnswerWorkPanel({ work, datasetId, datasetName }: { work: Work; datasetId: string; datasetName: string }) {
  const [open, setOpen] = useState(false);
  const [showRows, setShowRows] = useState(false);
  const allRows = work.rows_used === work.rows_total;

  return (
    <section aria-label="How this answer was worked out" className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <ListChecks className="size-4 shrink-0 text-highlight" aria-hidden />
          <span>
            Used <strong className="font-semibold text-text">{fmt(work.rows_used)}</strong>
            {allRows ? ` row${work.rows_used === 1 ? "" : "s"}, all of` : ` of ${fmt(work.rows_total)} rows from`} {datasetName}
            {work.left_out.length ? ` · ${work.left_out.length} note${work.left_out.length === 1 ? "" : "s"}` : ""}
          </span>
        </p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-highlight transition-colors hover:bg-surface-2"
        >
          How this was worked out
          <ChevronDown className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-4 rounded-lg bg-surface-2/60 p-4">
          <ol className="flex flex-col gap-1.5 text-[13.5px] text-text">
            {work.steps.map((s, i) => (
              <li key={s} className="grid grid-cols-[22px_1fr] gap-2">
                <span className="font-mono text-[12px] leading-5 text-faint">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>

          {!!work.left_out.length && (
            <ul className="flex flex-col gap-1.5 text-[13px] text-muted">
              {work.left_out.map((n) => (
                <li key={n} className="flex items-start gap-2">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  {n}
                </li>
              ))}
            </ul>
          )}

          {work.check && (
            <p className="flex items-start gap-2 text-[13px] text-muted">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden />
              {checkSentence(work.check)}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setShowRows((s) => !s)}
              aria-expanded={showRows}
              className="flex min-h-9 w-fit items-center gap-2 rounded-lg border border-line-strong px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface"
            >
              <Table2 className="size-4 text-highlight" aria-hidden />
              {showRows ? "Hide the rows" : `See the ${fmt(work.rows_used)} rows`}
            </button>
            {showRows && <RowsPreview datasetId={datasetId} datasetName={datasetName} work={work} />}
          </div>
        </div>
      )}
    </section>
  );
}
