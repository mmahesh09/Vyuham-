"use client";

import { AlertTriangle, Copy, Fingerprint, Rows3 } from "lucide-react";

import { InlineAlert } from "@/components/app/inline-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/features/charts/build-option";
import { cn } from "@/lib/utils";

import type { Dataset } from "./api";
import { TypeBadge } from "./column-summary";
import { useProfile, type ColumnStats } from "./platform-api";

const nf = new Intl.NumberFormat("en-US");
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

function show(v: string | number | null | undefined) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return formatNumber(v);
  return /^\d{4}-\d{2}-\d{2}T00:00:00/.test(v) ? v.slice(0, 10) : v.slice(0, 40);
}

/** Small vertical bars: a histogram or a timeline. */
function Bars({ values, labels, label }: { values: number[]; labels: string[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={label} className="flex h-14 items-end gap-[2px]">
      {values.map((v, i) => (
        <span
          key={i}
          title={`${labels[i]}: ${nf.format(v)}`}
          className="min-w-[3px] flex-1 rounded-t-[2px] bg-highlight/70 transition-colors hover:bg-highlight"
          style={{ height: `${Math.max(v ? 6 : 0, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function TopValues({ top, filled }: { top: NonNullable<ColumnStats["top"]>; filled: number }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Most common values">
      {top.slice(0, 5).map((t) => (
        <li key={t.value} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-[12.5px]">
          <span className="relative h-5 overflow-hidden rounded-[3px] bg-surface-2">
            <span className="absolute inset-y-0 left-0 bg-primary/25" style={{ width: `${(t.count / Math.max(1, filled)) * 100}%` }} />
            <span className="relative truncate px-1.5 leading-5 text-text">{t.value || "(empty text)"}</span>
          </span>
          <span className="tabular-nums text-faint">{nf.format(t.count)}</span>
        </li>
      ))}
    </ul>
  );
}

function ColumnCard({ c, rows }: { c: ColumnStats; rows: number }) {
  const facts: [string, string][] = [
    ["Filled", `${pct(rows ? c.filled / rows : 0)}`],
    ["Distinct", nf.format(c.distinct)],
  ];
  if (c.type === "number") facts.push(["Min", show(c.min)], ["Median", show(c.median)], ["Max", show(c.max)], ["Mean", show(c.mean)]);
  else if (c.type === "date") facts.push(["From", show(c.min)], ["To", show(c.max)]);
  else facts.push(["Avg length", String(c.avg_length ?? "—")]);

  return (
    <article className="flex flex-col gap-3 rounded-[8px] border border-line bg-surface p-4">
      <header className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[14.5px] font-semibold text-text" title={c.name}>
          {c.name}
        </h3>
        <TypeBadge type={c.type} />
      </header>
      {/* Filled vs empty, at a glance */}
      <div className="flex h-1.5 overflow-hidden rounded-full bg-accent/30" aria-hidden>
        <span className="bg-success/80" style={{ width: `${rows ? (c.filled / rows) * 100 : 0}%` }} />
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12.5px]">
        {facts.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col">
            <dt className="text-faint">{k}</dt>
            <dd className="truncate font-medium tabular-nums text-text" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {c.histogram && c.histogram.length > 1 && (
        <Bars values={c.histogram.map((b) => b.count)} labels={c.histogram.map((b) => `${formatNumber(b.from)}–${formatNumber(b.to)}`)} label={`Distribution of ${c.name}`} />
      )}
      {c.timeline && c.timeline.points.length > 1 && (
        <Bars values={c.timeline.points.map((p) => p.count)} labels={c.timeline.points.map((p) => p.at)} label={`Rows per ${c.timeline.unit} by ${c.name}`} />
      )}
      {c.top && c.top.length > 0 && <TopValues top={c.top} filled={c.filled} />}
      <div className="flex flex-wrap gap-1.5">
        {c.unique && c.filled > 1 && (
          <span className="flex items-center gap-1 rounded-[4px] bg-highlight/10 px-1.5 py-0.5 text-[11.5px] text-highlight">
            <Fingerprint className="size-3" aria-hidden /> Every value different
          </span>
        )}
        {c.empty_ratio >= 0.2 && (
          <span className="flex items-center gap-1 rounded-[4px] bg-accent/10 px-1.5 py-0.5 text-[11.5px] text-accent">
            <AlertTriangle className="size-3" aria-hidden /> {pct(c.empty_ratio)} blank
          </span>
        )}
      </div>
    </article>
  );
}

/** Column-by-column statistics, computed on the server over the whole dataset. */
export function ProfilePanel({ dataset }: { dataset: Dataset }) {
  const { data, isPending, error } = useProfile(dataset.id);
  if (isPending)
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Profiling">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-56 rounded-[8px]" />
        ))}
      </div>
    );
  if (error) return <InlineAlert>{error.message}</InlineAlert>;

  const tiles = [
    { icon: Rows3, label: "Rows", value: nf.format(data.rows) },
    { icon: Fingerprint, label: "Cells filled", value: pct(data.completeness), tone: data.completeness < 0.9 ? "warn" : undefined },
    { icon: Copy, label: "Duplicate rows", value: nf.format(data.duplicate_rows), tone: data.duplicate_rows ? "warn" : undefined },
  ];
  return (
    <div className="flex flex-col gap-5">
      <ul className="grid grid-cols-3 gap-3" aria-label="Dataset summary">
        {tiles.map((t) => (
          <li key={t.label} className="flex items-center gap-3 rounded-[8px] border border-line bg-surface px-4 py-3">
            <span className={cn("flex size-9 items-center justify-center rounded-lg", t.tone ? "bg-accent/10 text-accent" : "bg-primary/10 text-highlight")}>
              <t.icon className="size-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[12px] text-faint">{t.label}</span>
              <span className="text-[18px] font-semibold tabular-nums text-text">{t.value}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.columns.map((c) => (
          <ColumnCard key={c.name} c={c} rows={data.rows} />
        ))}
      </div>
    </div>
  );
}
